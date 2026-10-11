/**
 * Post-link nudge — pure scheduling/wording logic.
 *
 * Pure module (no env, no DB, no Redis). The thin BullMQ wrapper lives in
 * services/nudge.service.ts; everything decidable lives here and is
 * unit-tested. Follows the utils/submission-queue.ts split (TESTING.md §1).
 *
 * Clock: delivery time = newest instruction delivery message, falling back
 * to task creation (seconds apart in practice). Re-deliveries (retry /
 * reassign) write fresh delivery records, so the clock restarts for the new
 * worker with no cancellation plumbing — every job fire re-reads state.
 */
import {
  LINK_ESCALATE_DELAY_MS,
  LINK_NUDGE_DELAY_MS,
} from '../config/constants';
import { TaskStatus, TaskType } from '../types';

/** Minimal task shape the nudge decisions need (structural, not the full Task). */
export interface NudgeTaskState {
  id: string;
  type: TaskType | string;
  status: TaskStatus | string;
  assignmentStatus: string | null;
  cancelledReason: string | null;
  submittedRedditUrl: string | null;
  createdAt: Date;
  channelId: string;
  assignedUserId: string | null;
  deliveryMessages: Array<{ kind: string; createdAt: string }> | null;
}

/** Stable job id per task — a re-delivery replaces the pending job. */
export function nudgeJobIdFor(taskId: string): string {
  return `nudge-${taskId}`;
}

/** When the post reached the worker's ticket (delivery SENT time). */
export function deliverySentAt(task: NudgeTaskState): Date {
  let latest: Date | null = null;
  for (const m of task.deliveryMessages || []) {
    if (m.kind !== 'instruction' || !m.createdAt) continue;
    const at = new Date(m.createdAt);
    if (!Number.isNaN(at.getTime()) && (!latest || at > latest)) latest = at;
  }
  return latest ?? task.createdAt;
}

/**
 * Nudge-eligible: a delivered GoPartTime POST still waiting for its link.
 * ACCEPTED only — reassign (the escalation tool) refuses PENDING, and a
 * PENDING task means the manager already took over review.
 */
export function isNudgeCandidate(task: NudgeTaskState): boolean {
  if (task.type !== TaskType.POST) return false;
  if (task.status !== TaskStatus.ACCEPTED) return false;
  if (task.assignmentStatus !== 'SENT') return false;
  if (task.cancelledReason !== null) return false;
  if (task.submittedRedditUrl && task.submittedRedditUrl.trim()) return false;
  return true;
}

/** +10 min with no link → tagged reminder + warning. */
export function isNudgeDue(task: NudgeTaskState, nowMs: number = Date.now()): boolean {
  if (!isNudgeCandidate(task)) return false;
  return nowMs - deliverySentAt(task).getTime() >= LINK_NUDGE_DELAY_MS;
}

/** +15 min with no link → escalation re-blast. */
export function isEscalateDue(task: NudgeTaskState, nowMs: number = Date.now()): boolean {
  if (!isNudgeCandidate(task)) return false;
  return nowMs - deliverySentAt(task).getTime() >= LINK_NUDGE_DELAY_MS + LINK_ESCALATE_DELAY_MS;
}

/** Milliseconds until the nudge fires (0 when already due). */
export function msUntilNudge(task: NudgeTaskState, nowMs: number = Date.now()): number {
  return Math.max(0, deliverySentAt(task).getTime() + LINK_NUDGE_DELAY_MS - nowMs);
}

/** Milliseconds until escalation fires (0 when already due). */
export function msUntilEscalation(task: NudgeTaskState, nowMs: number = Date.now()): number {
  return Math.max(0, deliverySentAt(task).getTime() + LINK_NUDGE_DELAY_MS + LINK_ESCALATE_DELAY_MS - nowMs);
}

/** The +10 min tagged reminder: ask for the link, warn of reassignment. */
export function buildNudgeMessage(workerId: string | null | undefined): string {
  const tag = workerId ? `<@${workerId}> ` : '';
  return (
    `${tag}⚠️ 10 minutes are up and I still don't have your post link. ` +
    `Reply to the 📌 IMPORTANT message with your link within the next 5 minutes — ` +
    `after that this post will be given to someone else.`
  );
}
