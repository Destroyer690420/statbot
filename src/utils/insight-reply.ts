import { Reminder, ReminderType, TaskStatus } from '../types';

/**
 * Resolve which reminder an image reply actually belongs to.
 *
 * `resolved` is the reminder whose message the worker replied to — the initial
 * send or ANY retry, because every message ID of a reminder is persisted in
 * `Reminder.reminderMessageIds`. If that reminder is still waiting for its
 * screenshot, the reply is for it, full stop.
 *
 * The fall-forward case: the worker replies to an already-completed step (the
 * classic "reply to the old 20h reminder with the 70h screenshot"). When
 * exactly one later reminder is still waiting for its screenshot, the image is
 * treated as that pending step instead of being dropped as a duplicate.
 * Anything else is a genuine duplicate and returns `null`.
 */
export function pickInsightReminder(
  resolved: Reminder,
  reminders: Reminder[],
): Reminder | null {
  if (!resolved.completed) return resolved;

  const later = reminders.filter(
    (r) =>
      r.id !== resolved.id &&
      r.sent &&
      !r.completed &&
      r.dueAt.getTime() > resolved.dueAt.getTime(),
  );

  return later.length === 1 ? later[0] : null;
}

/**
 * Task status implied by the reminders that already have their screenshot.
 * The 70h step wins because it is the final insight for a POST; a COMMENT
 * only ever has the 20h step. Returns `null` when nothing is completed.
 */
export function statusForCompletedInsights(
  reminders: Reminder[],
): TaskStatus | null {
  if (reminders.some((r) => r.completed && r.type === ReminderType.POST_70H)) {
    return TaskStatus.INSIGHT_70_RECEIVED;
  }
  if (
    reminders.some(
      (r) =>
        r.completed &&
        (r.type === ReminderType.POST_20H ||
          r.type === ReminderType.COMMENT_20H),
    )
  ) {
    return TaskStatus.INSIGHT_20_RECEIVED;
  }
  return null;
}

/** Human label for the insight step, used in the bot's confirmation. */
export function insightStepLabel(type: ReminderType): string {
  return type === ReminderType.POST_70H ? '70-hour' : '20-hour';
}
