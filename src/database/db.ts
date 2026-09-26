import { PrismaClient as PrismaClientClass } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';
import { logger } from '../utils/logger';

let prisma: PrismaClientClass;

export function initializeDatabase(): PrismaClientClass {
  if (prisma) return prisma;

  try {
    // Pool size: node-postgres defaults to 10, which serialises every
    // concurrent request behind 10 sockets. Read-heavy endpoints (outreach
    // status, ticket lists) issue several queries each, so the default is the
    // ceiling on dashboard throughput. Postgres `max_connections` on the host is
    // 100, and steady-state app usage is well under 20, so 20 is safe.
    const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, max: 20 });
    prisma = new PrismaClientClass({ adapter });

    logger.info('Prisma client initialized successfully');
    return prisma;
  } catch (error) {
    logger.error('Failed to initialize Prisma client', { error });
    process.exit(1);
  }
}

export function getDb(): PrismaClientClass {
  if (!prisma) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return prisma;
}
