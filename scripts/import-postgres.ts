import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient as PrismaClientClass } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const EXPORT_DIR = path.resolve(__dirname, '../export');

const COLLECTION_MODEL_MAP: Record<string, string> = {
  tasks: 'task',
  reminders: 'reminder',
  auditLogs: 'auditLog',
  payoutBatches: 'payoutBatch',
  payoutItems: 'payoutItem',
  referrals: 'referral',
  commissionBatches: 'commissionBatch',
  commissionItems: 'commissionItem',
};

const INSERT_ORDER = [
  'tasks',
  'reminders',
  'auditLogs',
  'payoutBatches',
  'payoutItems',
  'settings',
  'referrals',
  'commissionBatches',
  'commissionItems',
];

function readCollection(name: string): any[] {
  const filePath = path.join(EXPORT_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠ ${name}: file not found, skipping`);
    return [];
  }
  const data = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(data);
}

function parseISOFields(obj: any): any {
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      result[key] = new Date(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function importCollection(prisma: any, collectionName: string, modelName: string): Promise<{ imported: number; skipped: number }> {
  const docs = readCollection(collectionName);
  if (docs.length === 0) return { imported: 0, skipped: 0 };

  let imported = 0;
  let skipped = 0;

  console.log(`Importing ${collectionName} → ${modelName} (${docs.length} documents)...`);

  for (const doc of docs) {
    const data = parseISOFields(doc);
    const id = data.id;
    delete data.id;

    try {
      await prisma[modelName].create({ data: { id, ...data } });
      imported++;
    } catch (err: any) {
      if (err.code === 'P2002') {
        skipped++;
      } else {
        skipped++;
      }
    }
  }

  console.log(`  ✓ ${collectionName}: ${imported} imported, ${skipped} skipped`);
  return { imported, skipped };
}

async function main() {
  if (!fs.existsSync(EXPORT_DIR)) {
    console.error(`Export directory not found: ${EXPORT_DIR}`);
    console.error('Run the export-firestore.ts script first.');
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClientClass({ adapter });

  console.log('Starting PostgreSQL import...\n');

  let totalImported = 0;
  let totalSkipped = 0;

  for (const name of INSERT_ORDER) {
    if (name === 'settings') {
      console.log('Skipping settings collection (handled by service defaults)');
      continue;
    }

    const modelName = COLLECTION_MODEL_MAP[name];
    if (!modelName) {
      console.log(`  ⚠ ${name}: no model mapping, skipping`);
      continue;
    }

    const result = await importCollection(prisma, name, modelName);
    totalImported += result.imported;
    totalSkipped += result.skipped;
  }

  console.log(`\nImport complete: ${totalImported} imported, ${totalSkipped} skipped`);

  // Verify counts
  console.log('\nVerification:');
  for (const [coll, model] of Object.entries(COLLECTION_MODEL_MAP)) {
    try {
      const count = await (prisma as any)[model].count();
      console.log(`  ${coll}: ${count} rows`);
    } catch {
      console.log(`  ${coll}: error counting`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
