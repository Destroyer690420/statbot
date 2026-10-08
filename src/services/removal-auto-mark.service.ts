import { taskService } from './task.service';
import { taskRepository } from '../database/repositories';
import { auditLogService } from './audit.service';
import { cancelTaskJobs } from '../scheduler/jobs';
import { TaskStatus, TaskType, AuditAction } from '../types';
import { logger } from '../utils/logger';

/**
 * Phase 3: auto-mark `cancelledReason = 'deleted'` when the bot is 100% sure
 * the post is gone. Certainty rules come from `docs/REMOVAL_SIGNALS.md`:
 * only explicit removal signals ever mark — never NOT_FOUND, never
 * REMOVED_OTHER, never infrastructure states.
 *
 * Deliberate boundaries (each pinned by test):
 * - POST only (format check SKIPs comments; survival never runs for them).
 * - Active pipeline statuses only: COMPLETED/ARCHIVED/CANCELLED are left for
 *   the admin (a paid task must never be auto-touched).
 * - First mark wins: an existing non-null `cancelledReason` (manual or a
 *   prior auto-mark) is never overwritten.
 * - The mark stops future *reminder* jobs (a gone post has no insights to
 *   collect) but NEVER the survival job — the 11-minute screenshot is still
 *   wanted as proof. Callers schedule/keep the survival job independently.
 */
const AUTO_MARKABLE_STATES = new Set(['REMOVED_BY_MODS', 'REMOVED_BY_FILTER', 'DELETED_BY_USER']);

/** Exported for unit tests: the 100%-sure gate, nothing else. */
export function isAutoMarkableState(removalState: string | null | undefined): boolean {
  return typeof removalState === 'string' && AUTO_MARKABLE_STATES.has(removalState);
}

/** Exported for unit tests and Phase 4 messages. */
export function describeRemovalState(removalState: string): string {
  switch (removalState) {
    case 'REMOVED_BY_MODS':
      return 'removed by moderators';
    case 'REMOVED_BY_FILTER':
      return "removed by Reddit's filters";
    case 'DELETED_BY_USER':
      return 'deleted';
    default:
      return 'removed';
  }
}

const AUTO_MARKABLE_STATUSES = new Set([
  TaskStatus.ACCEPTED,
  TaskStatus.PENDING,
  TaskStatus.REMINDER_20_SENT,
  TaskStatus.INSIGHT_20_RECEIVED,
  TaskStatus.REMINDER_70_SENT,
  TaskStatus.INSIGHT_70_RECEIVED,
]);

export async function maybeAutoMarkDeleted(
  taskId: string,
  removalState: string | null | undefined,
  source: string,
): Promise<boolean> {
  if (!isAutoMarkableState(removalState)) return false;

  const task = await taskService.findById(taskId);
  if (!task) return false;
  if (task.type !== TaskType.POST) return false;
  if (!AUTO_MARKABLE_STATUSES.has(task.status)) return false;
  if (task.cancelledReason !== null) return false;

  await taskRepository.updateCancelledReason(taskId, 'deleted');
  await cancelTaskJobs(taskId);

  const detail = `Post ${describeRemovalState(removalState!)} — auto-marked deleted (${source})`;
  await auditLogService.log(AuditAction.AUTO_MARKED_DELETED, taskId, 'system', detail).catch(() => undefined);
  logger.info('Task auto-marked deleted', { taskId, removalState, source });
  return true;
}
