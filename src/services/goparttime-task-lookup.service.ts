import { Task } from '../types';

/**
 * Pure helpers for resolving a GoPartTime task number to Statbot task data.
 *
 * Deliberately free of database imports: this module is imported by tests and
 * by the insight service, so keeping it pure means the resolution rules can be
 * unit-tested without standing up Postgres or an env. The repository lookup
 * itself lives in the goparttime routes, which own the orchestration.
 */

/**
 * Candidate task IDs for manually-created tasks whose id embeds the
 * GoPartTime number ("POST #688318", "Comment #688318", ...). Both case
 * conventions are covered: uppercase (manual "/task" convention) first,
 * then the lowercase GoPartTime format. Uppercase-first keeps the lookup
 * deterministic when both variants somehow exist.
 */
export function buildManualTaskIdCandidates(externalTaskId: string): string[] {
  return [
    `POST #${externalTaskId}`,
    `Comment #${externalTaskId}`,
    `Post #${externalTaskId}`,
    `COMMENT #${externalTaskId}`,
  ];
}

/**
 * The Reddit link a worker submitted for a task, or null when there is none.
 *
 * `submittedRedditUrl` is the canonical field: it is what
 * `recordSubmission` writes when the worker replies to the assignment message
 * in their Discord ticket, and it is the column the dashboard's Accepted
 * section renders. `redditUrl` is only a fallback — manually-created tasks
 * (slash command / dashboard) validate and store `redditUrl` at creation time
 * while leaving `submittedRedditUrl` null, so a link can exist there without
 * ever going through the Discord reply flow. Mirrors the same
 * `submittedRedditUrl ?? redditUrl` precedence used by `worker-view.ts`.
 */
export function resolveSubmittedRedditUrl(
  task: Pick<Task, 'submittedRedditUrl' | 'redditUrl'>,
): string | null {
  return (task.submittedRedditUrl || '').trim() || (task.redditUrl || '').trim() || null;
}
