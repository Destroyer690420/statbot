import { nanoid } from 'nanoid';

/**
 * Generate a short, unique task ID.
 * Format: TSK-XXXXXXXX (8 chars)
 */
export function generateTaskId(): string {
  return `TSK-${nanoid(8).toUpperCase()}`;
}

/**
 * Generate a short, unique reminder ID.
 * Format: REM-XXXXXXXX (8 chars)
 */
export function generateReminderId(): string {
  return `REM-${nanoid(8).toUpperCase()}`;
}

/**
 * Generate a short, unique audit log ID.
 * Format: LOG-XXXXXXXX (8 chars)
 */
export function generateLogId(): string {
  return `LOG-${nanoid(8).toUpperCase()}`;
}

/**
 * Generate a short, unique payout batch ID.
 * Format: PB-XXXXXXXX (8 chars)
 */
export function generateBatchId(): string {
  return `PB-${nanoid(8).toUpperCase()}`;
}

/**
 * Generate a short, unique payout item ID.
 * Format: PI-XXXXXXXX (8 chars)
 */
export function generatePayoutItemId(): string {
  return `PI-${nanoid(8).toUpperCase()}`;
}
