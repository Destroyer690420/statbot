import { TaskType } from '../types';

/**
 * Builds the user-facing task ID used for GoPartTime tasks,
 * matching the format shown on the GoPartTime page
 * (e.g. "Comment #589482", "Post #589482").
 */
export function buildGoPartTimeTaskId(type: TaskType | string, externalTaskId: string): string {
  const label = String(type).toUpperCase() === TaskType.POST ? 'Post' : 'Comment';
  return `${label} #${externalTaskId}`;
}

/**
 * Returns the user-facing ID for a task. Tasks coming from an external
 * source (GoPartTime) display as "<Type> #<externalTaskId>"; everything
 * else falls back to the internal ID.
 */
export function displayTaskId(
  id: string,
  type: TaskType | string | null | undefined,
  externalTaskId?: string | null,
): string {
  if (externalTaskId) {
    return buildGoPartTimeTaskId(type ?? '', externalTaskId);
  }
  return id;
}
