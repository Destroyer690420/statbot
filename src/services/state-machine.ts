import { TaskStatus, TaskType } from '../types';

/**
 * Defines valid state transitions for the task state machine.
 * Key = current state, Value = array of allowed next states.
 */
const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.PENDING]: [
    TaskStatus.REMINDER_20_SENT,
    TaskStatus.CANCELLED,
  ],
  [TaskStatus.REMINDER_20_SENT]: [
    TaskStatus.INSIGHT_20_RECEIVED,
    TaskStatus.CANCELLED,
  ],
  [TaskStatus.INSIGHT_20_RECEIVED]: [
    TaskStatus.REMINDER_70_SENT,   // Post only
    TaskStatus.COMPLETED,           // Comment (no 70h)
    TaskStatus.CANCELLED,
  ],
  [TaskStatus.REMINDER_70_SENT]: [
    TaskStatus.INSIGHT_70_RECEIVED,
    TaskStatus.CANCELLED,
  ],
  [TaskStatus.INSIGHT_70_RECEIVED]: [
    TaskStatus.COMPLETED,
    TaskStatus.CANCELLED,
  ],
  [TaskStatus.COMPLETED]: [
    TaskStatus.ARCHIVED,
  ],
  [TaskStatus.ARCHIVED]: [],    // Terminal state
  [TaskStatus.CANCELLED]: [],   // Terminal state
};

/**
 * Check if a state transition is valid.
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  const allowed = TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Attempt a state transition, throwing if invalid.
 */
export function transition(from: TaskStatus, to: TaskStatus): TaskStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid state transition: ${from} → ${to}`);
  }
  return to;
}

/**
 * Get the next expected status when a reminder is sent.
 */
export function getStatusAfterReminderSent(currentStatus: TaskStatus): TaskStatus {
  if (currentStatus === TaskStatus.PENDING) {
    return TaskStatus.REMINDER_20_SENT;
  }
  if (currentStatus === TaskStatus.INSIGHT_20_RECEIVED) {
    return TaskStatus.REMINDER_70_SENT;
  }
  return currentStatus;
}

/**
 * Get the next expected status when an insight is received.
 */
export function getStatusAfterInsightReceived(
  currentStatus: TaskStatus,
  _taskType: TaskType,
): TaskStatus {
  if (currentStatus === TaskStatus.REMINDER_20_SENT) {
    return TaskStatus.INSIGHT_20_RECEIVED;
  }
  if (currentStatus === TaskStatus.REMINDER_70_SENT) {
    return TaskStatus.INSIGHT_70_RECEIVED;
  }
  return currentStatus;
}

/**
 * Check if a task should be marked as completed.
 * - Comment tasks: complete after INSIGHT_20_RECEIVED
 * - Post tasks: complete after INSIGHT_70_RECEIVED
 */
export function shouldComplete(status: TaskStatus, taskType: TaskType): boolean {
  if (taskType === TaskType.COMMENT && status === TaskStatus.INSIGHT_20_RECEIVED) {
    return true;
  }
  if (taskType === TaskType.POST && status === TaskStatus.INSIGHT_70_RECEIVED) {
    return true;
  }
  return false;
}

/**
 * Check if a task is in a terminal state (no further transitions).
 */
export function isTerminal(status: TaskStatus): boolean {
  return status === TaskStatus.ARCHIVED || status === TaskStatus.CANCELLED;
}

/**
 * Check if a task is cancellable.
 */
export function isCancellable(status: TaskStatus): boolean {
  return canTransition(status, TaskStatus.CANCELLED);
}
