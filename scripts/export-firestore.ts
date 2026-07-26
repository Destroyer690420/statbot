import * as fs from 'fs';
import * as path from 'path';
import { initializeFirebase, getDb } from '../src/database/firebase';

const EXPORT_DIR = path.resolve(__dirname, '../export');

const COLLECTIONS = [
  'tasks',
  'reminders',
  'auditLogs',
  'payoutBatches',
  'payoutItems',
  'settings',
  'referrals',
  'commissionItems',
  'commissionBatches',
];

interface ExportResult {
  collection: string;
  count: number;
  file: string;
}

function serializeTimestamps(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && 'toDate' in (value as object) && typeof (value as any).toDate === 'function') {
      result[key] = (value as any).toDate().toISOString();
    } else if (value && typeof value === 'object' && 'seconds' in (value as object) && 'nanoseconds' in (value as object)) {
      result[key] = new Date((value as any).seconds * 1000).toISOString();
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function exportCollection(collectionName: string): Promise<ExportResult> {
  const db = getDb();
  const snapshot = await db.collection(collectionName).get();

  const docs = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...serializeTimestamps(doc.data() as Record<string, unknown>),
  }));

  const filePath = path.join(EXPORT_DIR, `${collectionName}.json`);
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));

  console.log(`  ✓ ${collectionName}: ${docs.length} documents → export/${collectionName}.json`);
  return { collection: collectionName, count: docs.length, file: filePath };
}

async function main() {
  console.log('Starting Firestore export...\n');

  initializeFirebase();

  const results: ExportResult[] = [];
  for (const name of COLLECTIONS) {
    try {
      const result = await exportCollection(name);
      results.push(result);
    } catch (err) {
      console.error(`  ✗ ${name}: ${(err as Error).message}`);
    }
  }

  const total = results.reduce((sum, r) => sum + r.count, 0);
  console.log(`\nExport complete: ${total} total documents across ${results.length} collections.`);

  // Write a summary file
  const summaryPath = path.join(EXPORT_DIR, '_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));
  console.log(`Summary written to export/_summary.json`);
}

main().catch(console.error);
