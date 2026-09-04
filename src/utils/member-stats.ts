import { TaskStatus, TaskType } from '../types';

/**
 * Pure aggregation for the /mystats + /myinvites self-service commands.
 * All database reads happen in `member-stats.service.ts`; everything here is
 * a deterministic function over plain rows (unit-tested, no env/DB imports).
 */

export interface WorkerTaskRow {
  id: string;
  type: TaskType;
  status: TaskStatus;
  hasCancelledReason: boolean;
  /** Completion instant (ms) for COMPLETED/ARCHIVED tasks; null when unknown. */
  completedAtMs: number | null;
}

export interface WorkerPaidItemRow {
  taskId: string;
  taskType: TaskType;
  amount: number;
  /** True once the item's batch is marked paid (`paidAt` set). */
  batchPaid: boolean;
}

export interface TaskMoneySplit {
  tasks: number;
  posts: number;
  comments: number;
  amount: number;
}

export interface WorkerStatsSection {
  completed: number;
  posts: number;
  comments: number;
  paid: TaskMoneySplit;
  pending: TaskMoneySplit;
}

export interface WorkerStats {
  weekLabel: string;
  week: WorkerStatsSection;
  allTime: {
    total: number;
    posts: number;
    comments: number;
    completed: number;
    inProgress: number;
    paid: TaskMoneySplit;
    pending: TaskMoneySplit;
  };
}

export interface StatsRates {
  postRate: number;
  commentRate: number;
}

export interface StatsWeek {
  startMs: number;
  endMs: number;
  label: string;
}

function emptySplit(): TaskMoneySplit {
  return { tasks: 0, posts: 0, comments: 0, amount: 0 };
}

/**
 * A task counts as done (all insights received) once COMPLETED; ARCHIVED is
 * the paid-side terminal state (the pay flow archives on item creation).
 */
export function isWorkDone(status: TaskStatus): boolean {
  return status === TaskStatus.COMPLETED || status === TaskStatus.ARCHIVED;
}

function isPost(type: TaskType): boolean {
  return type === TaskType.POST;
}

/**
 * Build week + all-time worker stats.
 *
 * Money rules (must match the payout flow):
 * - Paid = distinct tasks with a payout item in a PAID batch (actual amounts).
 * - Pending = done tasks (COMPLETED/ARCHIVED, no cancelled reason) with NO
 *   paid-batch item — i.e. no item yet, or an item in an still-unpaid batch —
 *   estimated at current rates. Tasks still awaiting insight screenshots are
 *   never pending money.
 * - Cancelled tasks are excluded from every count.
 */
export function buildWorkerStats(
  rows: WorkerTaskRow[],
  paidItems: WorkerPaidItemRow[],
  rates: StatsRates,
  week: StatsWeek,
): WorkerStats {
  const live = rows.filter((r) => r.status !== TaskStatus.CANCELLED);
  const done = live.filter((r) => isWorkDone(r.status) && !r.hasCancelledReason);

  const paidAmountByTask = new Map<string, { posts: number; comments: number; amount: number }>();
  for (const item of paidItems) {
    if (!item.batchPaid) continue;
    const existing = paidAmountByTask.get(item.taskId) ?? { posts: 0, comments: 0, amount: 0 };
    if (isPost(item.taskType)) existing.posts += 1;
    else existing.comments += 1;
    existing.amount += item.amount;
    paidAmountByTask.set(item.taskId, existing);
  }

  const paid: TaskMoneySplit = { tasks: paidAmountByTask.size, posts: 0, comments: 0, amount: 0 };
  for (const entry of paidAmountByTask.values()) {
    paid.posts += entry.posts;
    paid.comments += entry.comments;
    paid.amount += entry.amount;
  }

  const pendingRows = done.filter((r) => !paidAmountByTask.has(r.id));
  const pendingPosts = pendingRows.filter((r) => isPost(r.type)).length;
  const pendingComments = pendingRows.length - pendingPosts;
  const pending: TaskMoneySplit = {
    tasks: pendingRows.length,
    posts: pendingPosts,
    comments: pendingComments,
    amount: pendingPosts * rates.postRate + pendingComments * rates.commentRate,
  };

  const weekDone = done.filter(
    (r) => r.completedAtMs !== null && r.completedAtMs >= week.startMs && r.completedAtMs <= week.endMs,
  );
  const weekPosts = weekDone.filter((r) => isPost(r.type)).length;
  const weekComments = weekDone.length - weekPosts;

  const weekPaidIds = new Set(weekDone.filter((r) => paidAmountByTask.has(r.id)).map((r) => r.id));
  const weekPaid: TaskMoneySplit = emptySplit();
  weekPaid.tasks = weekPaidIds.size;
  for (const id of weekPaidIds) {
    const entry = paidAmountByTask.get(id)!;
    weekPaid.posts += entry.posts;
    weekPaid.comments += entry.comments;
    weekPaid.amount += entry.amount;
  }

  const weekPendingRows = weekDone.filter((r) => !paidAmountByTask.has(r.id));
  const weekPendingPosts = weekPendingRows.filter((r) => isPost(r.type)).length;
  const weekPendingComments = weekPendingRows.length - weekPendingPosts;
  const weekPending: TaskMoneySplit = {
    tasks: weekPendingRows.length,
    posts: weekPendingPosts,
    comments: weekPendingComments,
    amount: weekPendingPosts * rates.postRate + weekPendingComments * rates.commentRate,
  };

  const allPosts = live.filter((r) => isPost(r.type)).length;

  return {
    weekLabel: week.label,
    week: {
      completed: weekDone.length,
      posts: weekPosts,
      comments: weekComments,
      paid: weekPaid,
      pending: weekPending,
    },
    allTime: {
      total: live.length,
      posts: allPosts,
      comments: live.length - allPosts,
      completed: done.length,
      inProgress: live.length - done.length,
      paid,
      pending,
    },
  };
}
