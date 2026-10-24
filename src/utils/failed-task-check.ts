import { z } from 'zod';

/**
 * Pure helpers for the GoPartTime failed-task checker.
 *
 * The checker answers one question: GoPartTime marked a task as Failed, but is
 * it still OK in Statbot? "Deleted" here means exactly what the dashboard
 * dropdown means — `cancelledReason` is set (deleted / deleted_later).
 * Everything else is compared only when there is a submitted Reddit link;
 * a task that never got a link cannot prove it was done, so it is reported as
 * NOT_COMPARABLE instead of becoming a false accusation.
 *
 * No database/client imports: this module is imported by the route, the
 * service, and the tests, so the rules can be pinned without standing up
 * Postgres or Discord.
 */

export const FAILED_TASK_VERDICTS = [
  'MISMATCH',
  'DELETED',
  'NOT_COMPARABLE',
  'NOT_FOUND',
] as const;

export type FailedTaskVerdict = (typeof FAILED_TASK_VERDICTS)[number];

export interface FailedTaskSnapshot {
  status: string;
  cancelledReason: string | null;
  submittedRedditUrl: string | null;
  redditUrl: string | null;
}

/**
 * The single verdict rule.
 *
 * - cancelledReason set (deleted / deleted_later / anything else an admin
 *   typed) -> DELETED: GoPartTime's failure is expected.
 * - CANCELLED with no reason -> NOT_COMPARABLE: the task was pulled from the
 *   pipeline for a non-deletion reason, so "OK" would be a guess.
 * - no submitted/known Reddit link -> NOT_COMPARABLE: nothing was delivered to
 *   Reddit that could still be live.
 * - has a link and was not marked deleted -> MISMATCH: worth a human look.
 */
export function classifyFailedTask(task: FailedTaskSnapshot | null): FailedTaskVerdict {
  if (!task) return 'NOT_FOUND';
  if ((task.cancelledReason || '').trim()) {
    return 'DELETED';
  }
  if (String(task.status || '').toUpperCase() === 'CANCELLED') {
    return 'NOT_COMPARABLE';
  }
  const link =
    (task.submittedRedditUrl || '').trim() || (task.redditUrl || '').trim();
  return link ? 'MISMATCH' : 'NOT_COMPARABLE';
}

const externalTaskIdSchema = z.preprocess(
  (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string') return value.trim();
    return value;
  },
  z
    .string()
    .regex(/^\d{1,12}$/, 'Task ID must be a numeric GoPartTime task ID.'),
);

export const failedTaskScanItemSchema = z.object({
  externalTaskId: externalTaskIdSchema,
  type: z.enum(['post', 'comment']).optional(),
  failedReason: z.string().trim().max(300).optional(),
  reward: z.string().trim().max(32).optional(),
  deadline: z.string().trim().max(64).optional(),
});

export const failedTaskScanSchema = z.object({
  // 500 covers many pages of failures; the browser sends every card it saw.
  tasks: z.array(failedTaskScanItemSchema).max(500),
  pagesScanned: z.number().int().min(0).max(1000).optional(),
});

export type FailedTaskScanInput = z.infer<typeof failedTaskScanSchema>;
export type FailedTaskScanItem = z.infer<typeof failedTaskScanItemSchema>;

export interface FailedTaskDmRow {
  externalTaskId: string;
  taskType?: string | null;
  taskStatus?: string | null;
  reward?: string | null;
}

function formatTaskType(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'post') return 'Post';
  if (normalized === 'comment') return 'Comment';
  return String(value).trim() || null;
}

/**
 * Builds the one consolidated owner DM. ID-first lines stay copy-friendly, and
 * the result is capped so it always fits inside Discord's 2000-char limit even
 * with long rewards. Returns null when there is nothing to report.
 */
export function buildFailedTaskMismatchDm(
  rows: FailedTaskDmRow[],
  options: { maxRows?: number; maxLength?: number } = {},
): string | null {
  if (!rows.length) return null;

  const maxRows = Math.max(1, options.maxRows ?? 40);
  const maxLength = Math.max(200, options.maxLength ?? 1900);
  const header = `Possible wrongful GoPartTime failure(s): ${rows.length}`;
  const footer =
    'Marked Failed on GoPartTime but NOT Deleted in Statbot. Verify before reporting.';

  const render = (shownCount: number): string => {
    const lines = rows.slice(0, shownCount).map((row) => {
      const parts: string[] = [row.externalTaskId];
      const type = formatTaskType(row.taskType);
      if (type) parts.push(type);
      if (row.taskStatus) parts.push(`Statbot: ${row.taskStatus} (OK)`);
      if (row.reward) parts.push(row.reward);
      return parts.join(' - ');
    });
    const remaining = rows.length - shownCount;
    if (remaining > 0) {
      lines.push(
        `+${remaining} more - open /my-tasks/failed and run the check to see the full list.`,
      );
    }
    return [header, '', lines.join('\n'), '', footer].join('\n');
  };

  let shown = Math.min(rows.length, maxRows);
  let message = render(shown);
  while (shown > 1 && message.length > maxLength) {
    shown -= 1;
    message = render(shown);
  }
  return message;
}
