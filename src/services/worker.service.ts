import { getDb } from '../database/db';
import { toTask } from '../database/converters';
import { payoutRepository } from '../database/repositories';
import { payoutService } from './payout.service';
import { settingsService } from './settings.service';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { displayTaskId } from '../utils/task-display';
import {
  TaskLike,
  ReminderLike,
  PayoutItemLike,
  PayoutBatchLike,
  RatePair,
  deriveWorkerStatus,
  computeHomeStats,
  buildActionNeeded,
  buildWalletSummary,
  toWorkerTaskDto,
  buildTimeline,
  getPayoutInfo,
  compareTodo,
  compareNewestFirst,
  WorkerTaskDto,
} from '../utils/worker-view';

/**
 * Worker-scoped data access. Every query is scoped by the token's `sub`
 * (assignedUserId). There is no endpoint that accepts a worker id.
 * A task that isn't theirs returns the same 404 as one that doesn't exist.
 */

export interface TicketIdentity {
  workerId: string;
  workerName: string | null;
  channelName: string | null;
}

export async function resolveWorkerIdentityForChannel(channelId: string): Promise<TicketIdentity | null> {
  const rows = await getDb().task.findMany({
    where: { channelId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { assignedUserId: true, assignedUserName: true, channelName: true },
  });
  if (rows.length === 0) return null;
  const distinct = new Set(rows.map((r) => r.assignedUserId));
  if (distinct.size > 1) {
    logger.warn('Worker portal ticket has tasks from multiple workers, using newest', { channelId });
  }
  return {
    workerId: rows[0].assignedUserId,
    workerName: rows[0].assignedUserName ?? null,
    channelName: rows[0].channelName ?? null,
  };
}

export interface WorkerBundle {
  tasks: TaskLike[];
  remindersByTask: Map<string, ReminderLike[]>;
  payoutItemByTask: Map<string, PayoutItemLike>;
  payoutItems: PayoutItemLike[];
  batchesById: Map<string, PayoutBatchLike>;
  rates: RatePair;
}

function toTaskLike(t: ReturnType<typeof toTask>): TaskLike {
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    cancelledReason: t.cancelledReason,
    assignmentStatus: t.assignmentStatus,
    submittedRedditUrl: t.submittedRedditUrl,
    submittedAt: t.submittedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    subreddit: t.subreddit,
    title: t.title,
    redditUrl: t.redditUrl,
    postLink: t.postLink,
    commentLink: t.commentLink,
    externalTaskId: t.externalTaskId,
    formatCheckStatus: t.formatCheckStatus,
  };
}

/** Load the worker's tasks once, then reminders + payout items + batches (no per-task queries). */
export async function loadWorkerBundle(workerId: string): Promise<WorkerBundle> {
  const rows = await getDb().task.findMany({
    where: { assignedUserId: workerId },
    orderBy: { createdAt: 'desc' },
  });
  const tasks = rows.map((r) => toTaskLike(toTask(r as never)));
  const rates = await settingsService.getPayoutRates();

  const remindersByTask = new Map<string, ReminderLike[]>();
  if (tasks.length > 0) {
    const rems = await getDb().reminder.findMany({
      where: { taskId: { in: tasks.map((t) => t.id) } },
      orderBy: { dueAt: 'asc' },
    });
    for (const r of rems) {
      const list = remindersByTask.get(r.taskId) ?? [];
      list.push({
        id: r.id,
        type: r.type,
        dueAt: r.dueAt,
        sent: r.sent,
        sentAt: r.sentAt,
        completed: r.completed,
        completedAt: r.completedAt,
        retryCount: r.retryCount,
      });
      remindersByTask.set(r.taskId, list);
    }
  }

  const rawItems = await payoutRepository.findItemsByWorkerId(workerId);
  const payoutItems: PayoutItemLike[] = rawItems.map((i) => ({
    taskId: i.taskId,
    amount: i.amount,
    batchId: i.batchId,
    taskType: i.taskType,
    createdAt: i.createdAt,
    completedAt: (i as { completedAt?: Date }).completedAt ?? null,
  }));
  const payoutItemByTask = new Map(payoutItems.map((i) => [i.taskId, i]));

  const batchesById = new Map<string, PayoutBatchLike>();
  const batchIds = [...new Set(payoutItems.map((i) => i.batchId))];
  if (batchIds.length > 0) {
    const batches = await getDb().payoutBatch.findMany({ where: { id: { in: batchIds } } });
    for (const b of batches) {
      batchesById.set(b.id, {
        id: b.id,
        batchNumber: b.batchNumber,
        weekStart: b.weekStart,
        weekEnd: b.weekEnd,
      });
    }
  }

  return { tasks, remindersByTask, payoutItemByTask, payoutItems, batchesById, rates };
}

function onMissingPaidItem(taskId: string): void {
  logger.warn('Worker portal: ARCHIVED task without PayoutItem treated as paid', { taskId });
}

function weekLabelFor(weekStart: Date, weekEnd: Date): string {
  return payoutService.getWeekLabel(weekStart, weekEnd);
}

export async function getMeData(workerId: string, ticketChannelId: string): Promise<{
  workerId: string;
  name: string | null;
  ticket: { channelId: string; channelName: string | null; discordUrl: string };
  weekLabel: string;
  rates: { post: number; comment: number };
}> {
  const [bundle, identity, nameRow] = await Promise.all([
    loadWorkerBundle(workerId),
    resolveWorkerIdentityForChannel(ticketChannelId),
    getDb().task.findFirst({
      where: { assignedUserId: workerId },
      orderBy: { createdAt: 'desc' },
      select: { assignedUserName: true },
    }),
  ]);
  const current = payoutService.getCurrentPayoutWeek();
  return {
    workerId,
    name: nameRow?.assignedUserName ?? null,
    ticket: {
      channelId: ticketChannelId,
      channelName: identity?.channelName ?? null,
      discordUrl: `https://discord.com/channels/${env.GUILD_ID}/${ticketChannelId}`,
    },
    weekLabel: payoutService.getWeekLabel(current.weekStart, current.weekEnd),
    rates: { post: bundle.rates.postRate, comment: bundle.rates.commentRate },
  };
}

export async function getHomeData(workerId: string): Promise<{
  stats: ReturnType<typeof computeHomeStats>;
  actionNeeded: ReturnType<typeof buildActionNeeded>;
  walletSnapshot: { thisWeekTotal: number; awaitingEstimated: number; lifetimePaid: number };
}> {
  const bundle = await loadWorkerBundle(workerId);
  const now = new Date();
  const stats = computeHomeStats(bundle.tasks, bundle.remindersByTask, now);
  const actionNeeded = buildActionNeeded(bundle.tasks, bundle.remindersByTask, now, 5);
  const current = payoutService.getCurrentPayoutWeek();
  const previous = payoutService.getPreviousPayoutWeek();
  const wallet = buildWalletSummary({
    tasks: bundle.tasks,
    remindersByTask: bundle.remindersByTask,
    payoutItems: bundle.payoutItems,
    batchesById: bundle.batchesById,
    rates: bundle.rates,
    currentWeek: {
      weekStart: current.weekStart,
      weekEnd: current.weekEnd,
      weekLabel: payoutService.getWeekLabel(current.weekStart, current.weekEnd),
    },
    previousWeek: {
      weekStart: previous.weekStart,
      weekEnd: previous.weekEnd,
      weekLabel: payoutService.getWeekLabel(previous.weekStart, previous.weekEnd),
    },
    weekLabelFor,
  });
  return {
    stats,
    actionNeeded,
    walletSnapshot: {
      thisWeekTotal: wallet.thisWeek.total,
      awaitingEstimated: wallet.awaitingAll.estimated,
      lifetimePaid: wallet.lifetimePaid,
    },
  };
}

export type TaskTab = 'todo' | 'completed' | 'failed';

export interface ListTasksResult {
  tasks: WorkerTaskDto[];
  total: number;
  page: number;
  limit: number;
  counts: { todo: number; completed: number; failed: number };
}

export async function listTasksForWorker(
  workerId: string,
  args: { tab: TaskTab; sub: 'all' | 'awaiting' | 'paid'; type?: 'POST' | 'COMMENT'; q?: string; page: number; limit: number },
): Promise<ListTasksResult> {
  const bundle = await loadWorkerBundle(workerId);
  const now = new Date();
  const needle = (args.q || '').trim().toLowerCase();

  const matchesSearch = (t: TaskLike): boolean => {
    if (!needle) return true;
    const hay = [
      displayTaskId(t.id, t.type, t.externalTaskId ?? null),
      t.id,
      t.subreddit ?? '',
      t.title ?? '',
      t.submittedRedditUrl ?? '',
      t.redditUrl ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(needle);
  };

  const matchesType = (t: TaskLike): boolean => {
    if (!args.type) return true;
    return String(t.type).toUpperCase() === args.type;
  };

  // Counts per tab AFTER type/search filters (before the tab filter) for badges.
  let todo = 0;
  let completed = 0;
  let failed = 0;
  const inScope: { task: TaskLike; tab: TaskTab; sub: 'awaiting' | 'paid' | 'other' }[] = [];
  for (const t of bundle.tasks) {
    if (!matchesType(t) || !matchesSearch(t)) continue;
    const derived = deriveWorkerStatus(t, bundle.remindersByTask.get(t.id) ?? [], now);
    let sub: 'awaiting' | 'paid' | 'other' = 'other';
    if (derived.tab === 'completed') sub = derived.key === 'paid' ? 'paid' : 'awaiting';
    if (derived.tab === 'todo') todo += 1;
    else if (derived.tab === 'completed') completed += 1;
    else failed += 1;
    inScope.push({ task: t, tab: derived.tab, sub });
  }

  let filtered = inScope.filter((e) => e.tab === args.tab);
  if (args.tab === 'completed' && args.sub !== 'all') {
    filtered = filtered.filter((e) => e.sub === args.sub);
  }

  // Sort: to-do by urgency, completed/failed newest first.
  const withDerived = filtered.map((e) => ({
    ...e,
    derived: deriveWorkerStatus(e.task, bundle.remindersByTask.get(e.task.id) ?? [], now),
  }));
  if (args.tab === 'todo') {
    withDerived.sort((a, b) =>
      compareTodo(
        { derived: a.derived, createdAt: a.task.createdAt },
        { derived: b.derived, createdAt: b.task.createdAt },
      ),
    );
  } else {
    withDerived.sort((a, b) => compareNewestFirst({ createdAt: a.task.createdAt }, { createdAt: b.task.createdAt }));
  }

  const total = withDerived.length;
  const start = (args.page - 1) * args.limit;
  const page = withDerived.slice(start, start + args.limit).map((e) =>
    toWorkerTaskDto(
      e.task,
      bundle.remindersByTask.get(e.task.id) ?? [],
      bundle.payoutItemByTask.get(e.task.id),
      lookupBatch(bundle, e.task.id),
      bundle.rates,
      now,
      { onMissingPaidItem, weekLabelFor },
    ),
  );

  return { tasks: page, total, page: args.page, limit: args.limit, counts: { todo, completed, failed } };
}

function lookupBatch(bundle: WorkerBundle, taskId: string): PayoutBatchLike | null {
  const item = bundle.payoutItemByTask.get(taskId);
  if (!item) return null;
  return bundle.batchesById.get(item.batchId) ?? null;
}

export async function getTaskForWorker(
  workerId: string,
  taskId: string,
): Promise<{ task: WorkerTaskDto; timeline: ReturnType<typeof buildTimeline> } | null> {
  // Scoped lookup: same 404 whether missing or belongs to someone else.
  const row = await getDb().task.findFirst({ where: { id: taskId, assignedUserId: workerId } });
  if (!row) return null;
  const bundle = await loadWorkerBundle(workerId);
  const task = bundle.tasks.find((t) => t.id === row.id);
  if (!task) return null;
  const reminders = bundle.remindersByTask.get(task.id) ?? [];
  const item = bundle.payoutItemByTask.get(task.id);
  const dto = toWorkerTaskDto(task, reminders, item, lookupBatch(bundle, task.id), bundle.rates, new Date(), {
    onMissingPaidItem,
    weekLabelFor,
  });
  return { task: dto, timeline: buildTimeline(task, reminders, item) };
}

export async function getWalletForWorker(workerId: string): Promise<ReturnType<typeof buildWalletSummary>> {
  const bundle = await loadWorkerBundle(workerId);
  const current = payoutService.getCurrentPayoutWeek();
  const previous = payoutService.getPreviousPayoutWeek();
  return buildWalletSummary({
    tasks: bundle.tasks,
    remindersByTask: bundle.remindersByTask,
    payoutItems: bundle.payoutItems,
    batchesById: bundle.batchesById,
    rates: bundle.rates,
    currentWeek: {
      weekStart: current.weekStart,
      weekEnd: current.weekEnd,
      weekLabel: payoutService.getWeekLabel(current.weekStart, current.weekEnd),
    },
    previousWeek: {
      weekStart: previous.weekStart,
      weekEnd: previous.weekEnd,
      weekLabel: payoutService.getWeekLabel(previous.weekStart, previous.weekEnd),
    },
    weekLabelFor,
  });
}

/**
 * Worker-scoped payable tasks for a week window — batched equivalent of
 * payoutService.findEligibleTasks filtered to one worker (used for parity).
 * Rule parity: COMPLETED or ARCHIVED, no PayoutItem, no cancelledReason,
 * completion time (latest completed reminder completedAt, fallback updatedAt)
 * inside [weekStart, weekEnd].
 */
export async function findPayableTasksForWorkerWeek(
  workerId: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<{ taskId: string; completionTime: Date }[]> {
  const bundle = await loadWorkerBundle(workerId);
  const out: { taskId: string; completionTime: Date }[] = [];
  for (const t of bundle.tasks) {
    if (t.status !== 'COMPLETED' && t.status !== 'ARCHIVED') continue;
    if (t.cancelledReason !== null && t.cancelledReason !== undefined) continue;
    if (bundle.payoutItemByTask.has(t.id)) continue;
    const rems = bundle.remindersByTask.get(t.id) ?? [];
    const done = rems
      .filter((r) => r.completed && r.completedAt)
      .sort((a, b) => new Date(b.completedAt as Date).getTime() - new Date(a.completedAt as Date).getTime());
    const completion = done[0]?.completedAt ? new Date(done[0].completedAt as Date) : new Date(t.updatedAt);
    if (completion < weekStart || completion > weekEnd) continue;
    out.push({ taskId: t.id, completionTime: completion });
  }
  return out;
}

export { getPayoutInfo };
