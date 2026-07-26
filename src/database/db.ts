import { PrismaClient as PrismaClientClass } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';
import { logger } from '../utils/logger';

let prisma: PrismaClientClass;

export function initializeDatabase(): PrismaClientClass {
  if (prisma) return prisma;

  try {
    const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
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
