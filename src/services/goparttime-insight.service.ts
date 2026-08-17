import { Reminder, TaskType } from '../types';

export interface InsightResolution {
  reminder: Reminder | null;
  step: number;
}

/**
 * Resolves the Statbot reminder that corresponds to a GoPartTime view-data
 * step, mirroring the lifecycle order:
 *
 *   step 1 → POST_20H / COMMENT_20H (first reminder in dueAt order)
 *   step 2 → POST_70H              (second reminder; posts only)
 *
 * When no step is provided, falls back to the first pending reminder
 * (sent && !completed), then the first reminder with a stored screenshot,
 * then the earliest reminder.
 */
export function resolveInsightReminder(
  reminders: Reminder[],
  taskType: TaskType,
  step?: number,
): InsightResolution {
  const sorted = [...reminders].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  if (step !== undefined) {
    if (step !== 1 && step !== 2) {
      throw new Error('Invalid step. Use 1 or 2.');
    }
    if (step === 2 && taskType === TaskType.COMMENT) {
      throw new Error('Comments have only one view-data step (COMMENT_20H).');
    }
    return { reminder: sorted[step - 1] || null, step };
  }

  const pendingIndex = sorted.findIndex((r) => r.sent && !r.completed);
  if (pendingIndex !== -1) return { reminder: sorted[pendingIndex], step: pendingIndex + 1 };

  const withImageIndex = sorted.findIndex((r) => r.insightImageUrl);
  if (withImageIndex !== -1) return { reminder: sorted[withImageIndex], step: withImageIndex + 1 };

  const first = sorted[0] || null;
  return { reminder: first, step: first ? 1 : 0 };
}
