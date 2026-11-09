import { TaskType } from '../types';

/**
 * The dashboard "Request insight" action is a read-only nudge: it sends one
 * message into the task's ticket and changes no task/reminder state. Keeping
 * the text in a pure helper makes the exact wording testable.
 */

export interface InsightRequestParams {
  /** Discord id of the worker who should be mentioned. */
  workerId: string;
  /** Discord id of the admin to tag once the screenshot is sent (admin mac). */
  adminId: string;
  /** Task type decides whether the message says "post" or "comment". */
  type: TaskType;
  /** The worker's submitted link (fallback: the task's Reddit link). */
  link?: string | null;
}

/**
 * Builds the insight-request message.
 *
 * - Post tasks:  "... insights screenshot of this post ..."
 * - Comment tasks: "... insights screenshot of this comment ..."
 * - The post/comment link is appended on its own line when known.
 * - A final line asks the worker to tag the admin once the insight is sent.
 */
export function formatInsightRequestMessage({ workerId, adminId, type, link }: InsightRequestParams): string {
  const noun = type === TaskType.COMMENT ? 'comment' : 'post';
  const base = `Hey <@${workerId}>, can you please send the insights screenshot of this ${noun}, its quite urgent.`;
  const trimmed = link?.trim();
  const withLink = trimmed ? `${base}\n${trimmed}` : base;
  return `${withLink}\nplease tag <@${adminId}> once you have sent the insight`;
}

/** Picks the most relevant link to include with an insight request. */
export function pickInsightRequestLink(task: {
  submittedRedditUrl?: string | null;
  redditUrl?: string | null;
  postLink?: string | null;
  commentLink?: string | null;
}): string | null {
  return (
    task.submittedRedditUrl?.trim() ||
    task.redditUrl?.trim() ||
    task.postLink?.trim() ||
    task.commentLink?.trim() ||
    null
  );
}
