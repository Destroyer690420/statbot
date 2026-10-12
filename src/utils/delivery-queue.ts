/**
 * Server-side delivery pipeline — pure helpers, no env, no DB, no Redis.
 *
 * The worker (scheduler/delivery-worker.ts) is the only writer of fresh
 * deliveries; reassign/retry deliver synchronously as before. Because two
 * flows can touch the same task within seconds (a manager reassigning right
 * after an auto-accept), the worker checkpoints every run: it proceeds only
 * while the ticket, worker, and PENDING-delivery state are exactly what the
 * enqueue saw. Anything else means a newer flow owns the task and the worker
 * stands down without touching the row.
 */

import { TaskStatus } from '../types';

/** Stable job id per task — re-enqueues never double (latest wins). */
export function deliveryJobIdFor(taskId: string): string {
  return `deliver-${taskId}`;
}

/** Minimal row snapshot a delivery run is bound to. */
export interface DeliveryScope {
  channelId: string;
  assignedUserId: string;
  assignmentStatus: string | null;
  status: TaskStatus | string | null | undefined;
}

/**
 * True when the worker must stand down: the ticket or worker changed
 * (reassigned), the delivery left PENDING (failed/completed elsewhere), or
 * the pipeline moved on (terminal status). Submit-time touches (URL, format
 * check) never alter these fields, so a fast worker link never aborts a
 * delivery.
 */
export function isDeliverySuperseded(
  bound: DeliveryScope,
  fresh: DeliveryScope,
): boolean {
  if (fresh.assignmentStatus !== 'PENDING') return true;
  if (fresh.channelId !== bound.channelId) return true;
  if ((fresh.assignedUserId ?? null) !== (bound.assignedUserId ?? null)) return true;  if (
    fresh.status === TaskStatus.COMPLETED ||
    fresh.status === TaskStatus.ARCHIVED ||
    fresh.status === TaskStatus.CANCELLED
  ) {
    return true;
  }
  return false;
}
