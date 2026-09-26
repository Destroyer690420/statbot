import { TaskStatus, TaskType } from '../types';
import { displayTaskId } from './task-display';

/**
 * Canonical worker-facing view rules (pure, no DB/env imports).
 *
 * Owner-defined payout rules (follow exactly):
 * - PAID ⇔ status ARCHIVED (archived only when paid).
 * - PAYABLE ⇔ status COMPLETED (all insights in, not yet paid).
 * - NOT PAYABLE (failed) ⇔ cancelledReason set (any non-null) or CANCELLED.
 * - Precedence: failed > paid > payable > to-do.
 * - NEVER use PayoutBatch.paidAt (pay-worker batches keep paidAt null forever).
 */

export type WorkerTab = 'todo' | 'completed' | 'failed';
export type PayoutState = 'paid' | 'awaiting' | 'none';
export type WorkerTone = 'success' | 'warning' | 'danger' | 'info' | 'muted';

export interface TaskLike {
  id: string;
  type: TaskType | string;
  status: TaskStatus | string;
  cancelledReason?: string | null;
  assignmentStatus?: string | null;
  submittedRedditUrl?: string | null;
  submittedAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  subreddit?: string | null;
  title?: string | null;
  redditUrl?: string | null;
  postLink?: string | null;
  commentLink?: string | null;
  externalTaskId?: string | null;
  formatCheckStatus?: string | null;
}

export interface ReminderLike {
  id?: string;
  type: string;
  dueAt: Date | string;
  sent: boolean;
  sentAt?: Date | string | null;
  completed: boolean;
  completedAt?: Date | string | null;
  retryCount?: number | null;
}

export interface PayoutItemLike {
  taskId: string;
  amount: number;
  batchId: string;
  taskType?: string;
  createdAt: Date | string;
  completedAt?: Date | string | null;
}

export interface PayoutBatchLike {
  id: string;
  batchNumber: number;
  weekStart: Date | string;
  weekEnd: Date | string;
}

export interface RatePair {
  postRate: number;
  commentRate: number;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toMs(v: Date | string | null | undefined): number | null {
  const d = toDate(v);
  return d ? d.getTime() : null;
}

export function isFailedTask(task: TaskLike): boolean {
  if (task.cancelledReason !== null && task.cancelledReason !== undefined) return true;
  return task.status === TaskStatus.CANCELLED;
}

export function rateForType(type: TaskType | string, rates: RatePair): number {
  return String(type).toUpperCase() === TaskType.POST ? rates.postRate : rates.commentRate;
}

export interface PayoutInfo {
  state: PayoutState;
  amount: number;
  estimated: boolean;
  missingItem: boolean;
}

/** Owner rule: ARCHIVED = paid (even without a PayoutItem — anomaly, estimate at current rates). */
export function getPayoutInfo(
  task: TaskLike,
  payoutItem: PayoutItemLike | null | undefined,
  rates: RatePair,
  opts?: { onMissingPaidItem?: (taskId: string) => void },
): PayoutInfo {
  if (isFailedTask(task)) return { state: 'none', amount: 0, estimated: false, missingItem: false };
  if (task.status === TaskStatus.ARCHIVED) {
    if (payoutItem) return { state: 'paid', amount: payoutItem.amount, estimated: false, missingItem: false };
    opts?.onMissingPaidItem?.(task.id);
    return { state: 'paid', amount: rateForType(task.type, rates), estimated: true, missingItem: true };
  }
  if (task.status === TaskStatus.COMPLETED) {
    return { state: 'awaiting', amount: rateForType(task.type, rates), estimated: true, missingItem: false };
  }
  return { state: 'none', amount: 0, estimated: false, missingItem: false };
}

// ─── Derived worker status ───────────────────────────────────────────

export interface WorkerStatus {
  key: string;
  label: string;
  tone: WorkerTone;
  tab: WorkerTab;
  actionRequired: boolean;
  hint: string | null;
  action: string | null;
  nextDueAt: string | null;
  overdue: boolean;
}

export const SCREENSHOT_ACTION =
  "Reply to the bot's reminder in your ticket with a screenshot of your view data";

function reminderByType(reminders: ReminderLike[], needle: string): ReminderLike | null {
  const sorted = [...reminders].sort(
    (a, b) => (toMs(a.dueAt) ?? 0) - (toMs(b.dueAt) ?? 0),
  );
  return sorted.find((r) => String(r.type).includes(needle)) ?? null;
}

function earliestPending(reminders: ReminderLike[]): ReminderLike | null {
  const pending = reminders.filter((r) => !r.completed);
  if (pending.length === 0) return null;
  return [...pending].sort((a, b) => (toMs(a.dueAt) ?? 0) - (toMs(b.dueAt) ?? 0))[0];
}

function isOverdue(r: ReminderLike | null, nowMs: number): boolean {
  if (!r || !r.sent || r.completed) return false;
  const due = toMs(r.dueAt);
  return due !== null && nowMs > due;
}

function remindedTimes(r: ReminderLike): number {
  return (r.retryCount ?? 0) + (r.sent ? 1 : 0);
}

/** Infrastructure states are never shown; workers see "Waiting for manager review". */
export function mapFormatCheckHint(status: string | null | undefined): string {
  switch (status) {
    case 'MATCH':
      return 'Post matches \u2705';
    case 'PARA_MISMATCH':
      return 'Paragraphs look collapsed \u2014 leave a blank line between paragraphs';
    case 'TITLE_MISMATCH':
      return "Title doesn't match \u2014 copy it exactly";
    case 'TEXT_MISMATCH':
      return 'Text differs from the task';
    default:
      return 'Waiting for manager review';
  }
}

export function deriveWorkerStatus(
  task: TaskLike,
  reminders: ReminderLike[],
  now: Date = new Date(),
): WorkerStatus {
  const nowMs = now.getTime();
  // 1. FAILED tab
  if (task.cancelledReason !== null && task.cancelledReason !== undefined) {
    return {
      key: 'deleted',
      label: 'Deleted from Reddit \u2014 not paid, no insights needed',
      tone: 'muted',
      tab: 'failed',
      actionRequired: false,
      hint: null,
      action: null,
      nextDueAt: null,
      overdue: false,
    };
  }
  if (task.status === TaskStatus.CANCELLED) {
    return {
      key: 'cancelled',
      label: 'Cancelled',
      tone: 'muted',
      tab: 'failed',
      actionRequired: false,
      hint: null,
      action: null,
      nextDueAt: null,
      overdue: false,
    };
  }
  // 2. COMPLETED tab — paid
  if (task.status === TaskStatus.ARCHIVED) {
    return {
      key: 'paid',
      label: 'Paid',
      tone: 'success',
      tab: 'completed',
      actionRequired: false,
      hint: null,
      action: null,
      nextDueAt: null,
      overdue: false,
    };
  }
  // 3. COMPLETED tab — awaiting payment
  if (task.status === TaskStatus.COMPLETED) {
    return {
      key: 'payable',
      label: 'Completed \u2014 payment pending',
      tone: 'success',
      tab: 'completed',
      actionRequired: false,
      hint: null,
      action: null,
      nextDueAt: null,
      overdue: false,
    };
  }
  // 4. TO-DO tab
  const isPost = String(task.type).toUpperCase() === TaskType.POST;
  if (task.status === TaskStatus.ACCEPTED && !task.submittedRedditUrl) {
    if (task.assignmentStatus === 'SENT') {
      return {
        key: 'awaiting_link',
        label: 'Post it on Reddit',
        tone: 'warning',
        tab: 'todo',
        actionRequired: true,
        hint: null,
        action: 'Post it on Reddit, then reply to the task message in your ticket with the link',
        nextDueAt: null,
        overdue: false,
      };
    }
    return {
      key: 'preparing',
      label: 'Assigned \u2014 being prepared',
      tone: 'info',
      tab: 'todo',
      actionRequired: false,
      hint: null,
      action: null,
      nextDueAt: null,
      overdue: false,
    };
  }
  if (task.status === TaskStatus.ACCEPTED && task.submittedRedditUrl) {
    return {
      key: 'under_review',
      label: 'Link received \u2014 waiting for manager approval',
      tone: 'info',
      tab: 'todo',
      actionRequired: false,
      hint: mapFormatCheckHint(task.formatCheckStatus),
      action: null,
      nextDueAt: null,
      overdue: false,
    };
  }
  if (task.status === TaskStatus.PENDING) {
    const first = earliestPending(reminders);
    const due = first ? toDate(first.dueAt) : null;
    return {
      key: 'live',
      label: due ? `Live \u2014 first insight due ${formatIST(due)}` : 'Live',
      tone: 'info',
      tab: 'todo',
      actionRequired: false,
      hint: null,
      action: null,
      nextDueAt: due ? due.toISOString() : null,
      overdue: false,
    };
  }
  if (task.status === TaskStatus.REMINDER_20_SENT) {
    const r = reminderByType(reminders, '20H');
    const overdue = isOverdue(r, nowMs);
    const times = r ? remindedTimes(r) : 0;
    return {
      key: 'insight_20_due',
      label: '20h insight due',
      tone: overdue ? 'danger' : 'warning',
      tab: 'todo',
      actionRequired: true,
      hint: times > 0 ? `Reminded ${times} time${times === 1 ? '' : 's'}` : null,
      action: SCREENSHOT_ACTION,
      nextDueAt: r && toDate(r.dueAt) ? toDate(r.dueAt)!.toISOString() : null,
      overdue,
    };
  }
  if (task.status === TaskStatus.INSIGHT_20_RECEIVED) {
    if (isPost) {
      const r70 = reminderByType(reminders, '70H');
      const due = r70 ? toDate(r70.dueAt) : null;
      return {
        key: 'waiting_70h',
        label: due
          ? `20h insight received \u2014 next insight due ${formatIST(due)}`
          : '20h insight received \u2014 next insight due soon',
        tone: 'info',
        tab: 'todo',
        actionRequired: false,
        hint: null,
        action: null,
        nextDueAt: due ? due.toISOString() : null,
        overdue: false,
      };
    }
    return {
      key: 'finalizing',
      label: 'Insight received \u2014 finalizing',
      tone: 'info',
      tab: 'todo',
      actionRequired: false,
      hint: null,
      action: null,
      nextDueAt: null,
      overdue: false,
    };
  }
  if (task.status === TaskStatus.REMINDER_70_SENT) {
    const r = reminderByType(reminders, '70H');
    const overdue = isOverdue(r, nowMs);
    const times = r ? remindedTimes(r) : 0;
    return {
      key: 'insight_70_due',
      label: '70h insight due',
      tone: overdue ? 'danger' : 'warning',
      tab: 'todo',
      actionRequired: true,
      hint: times > 0 ? `Reminded ${times} time${times === 1 ? '' : 's'}` : null,
      action: SCREENSHOT_ACTION,
      nextDueAt: r && toDate(r.dueAt) ? toDate(r.dueAt)!.toISOString() : null,
      overdue,
    };
  }
  if (task.status === TaskStatus.INSIGHT_70_RECEIVED) {
    return {
      key: 'finalizing',
      label: 'Insight received \u2014 finalizing',
      tone: 'info',
      tab: 'todo',
      actionRequired: false,
      hint: null,
      action: null,
      nextDueAt: null,
      overdue: false,
    };
  }
  // Unknown future states land in To-do, non-blocking.
  return {
    key: 'live',
    label: 'In progress',
    tone: 'info',
    tab: 'todo',
    actionRequired: false,
    hint: null,
    action: null,
    nextDueAt: null,
    overdue: false,
  };
}

// ─── Sorting ─────────────────────────────────────────────────────────

export interface SortableTask {
  derived: WorkerStatus;
  createdAt: Date | string;
}

/** To-do: action-needed + overdue first, then by next due time. Completed/Failed: newest first. */
export function compareTodo(
  a: { derived: WorkerStatus; createdAt: Date | string },
  b: { derived: WorkerStatus; createdAt: Date | string },
): number {
  const rank = (d: WorkerStatus): number => {
    if (d.actionRequired && d.overdue) return 0;
    if (d.actionRequired) return 1;
    if (d.overdue) return 2;
    return 3;
  };
  const ra = rank(a.derived);
  const rb = rank(b.derived);
  if (ra !== rb) return ra - rb;
  const da = a.derived.nextDueAt ? new Date(a.derived.nextDueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const db = b.derived.nextDueAt ? new Date(b.derived.nextDueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (da !== db) return da - db;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export function compareNewestFirst(
  a: { createdAt: Date | string },
  b: { createdAt: Date | string },
): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

// ─── Completion time (same rule as payout.service) ───────────────────

export function getCompletionTime(task: TaskLike, reminders: ReminderLike[]): Date | null {
  const done = reminders
    .filter((r) => r.completed && r.completedAt)
    .sort((a, b) => (toMs(b.completedAt) ?? 0) - (toMs(a.completedAt) ?? 0));
  const first = done[0]?.completedAt;
  if (first) return toDate(first);
  return toDate(task.updatedAt);
}

// ─── Home stats ──────────────────────────────────────────────────────

export interface HomeStats {
  total: number;
  completed: number;
  paid: number;
  awaitingPayment: number;
  insightsDue: number;
  insightsOverdue: number;
  inProgress: number;
  failed: number;
}

export function computeHomeStats(
  tasks: TaskLike[],
  remindersByTask: Map<string, ReminderLike[]> | Record<string, ReminderLike[]>,
  now: Date = new Date(),
): HomeStats {
  const get = (id: string): ReminderLike[] => {
    if (remindersByTask instanceof Map) return remindersByTask.get(id) ?? [];
    return remindersByTask[id] ?? [];
  };
  let completed = 0;
  let paid = 0;
  let awaitingPayment = 0;
  let insightsDue = 0;
  let insightsOverdue = 0;
  let failed = 0;
  let todoOther = 0;
  for (const t of tasks) {
    if (isFailedTask(t)) {
      failed += 1;
      continue;
    }
    if (t.status === TaskStatus.ARCHIVED) {
      completed += 1;
      paid += 1;
      continue;
    }
    if (t.status === TaskStatus.COMPLETED) {
      completed += 1;
      awaitingPayment += 1;
      continue;
    }
    const derived = deriveWorkerStatus(t, get(t.id), now);
    if (derived.key === 'insight_20_due' || derived.key === 'insight_70_due') {
      insightsDue += 1;
      if (derived.overdue) insightsOverdue += 1;
    } else {
      todoOther += 1;
    }
  }
  return {
    total: tasks.length,
    completed,
    paid,
    awaitingPayment,
    insightsDue,
    insightsOverdue,
    inProgress: todoOther,
    failed,
  };
}

export interface ActionItem {
  taskId: string;
  displayId: string;
  action: string;
  dueAt: string | null;
  overdue: boolean;
  statusKey: string;
}

export function buildActionNeeded(
  tasks: TaskLike[],
  remindersByTask: Map<string, ReminderLike[]> | Record<string, ReminderLike[]>,
  now: Date = new Date(),
  max = 5,
): ActionItem[] {
  const get = (id: string): ReminderLike[] => {
    if (remindersByTask instanceof Map) return remindersByTask.get(id) ?? [];
    return remindersByTask[id] ?? [];
  };
  const items: (ActionItem & { sortDue: number; urgent: number })[] = [];
  for (const t of tasks) {
    if (isFailedTask(t)) continue;
    if (t.status === TaskStatus.ARCHIVED || t.status === TaskStatus.COMPLETED) continue;
    const derived = deriveWorkerStatus(t, get(t.id), now);
    if (!derived.actionRequired || !derived.action) continue;
    items.push({
      taskId: t.id,
      displayId: displayTaskId(t.id, t.type, t.externalTaskId ?? null),
      action: derived.action,
      dueAt: derived.nextDueAt,
      overdue: derived.overdue,
      statusKey: derived.key,
      sortDue: derived.nextDueAt ? new Date(derived.nextDueAt).getTime() : Number.MAX_SAFE_INTEGER,
      urgent: derived.overdue ? 0 : 1,
    });
  }
  items.sort((a, b) => a.urgent - b.urgent || a.sortDue - b.sortDue);
  return items.slice(0, max).map(({ sortDue: _s, urgent: _u, ...rest }) => rest);
}

// ─── Wallet ──────────────────────────────────────────────────────────

export interface WeekWindow {
  weekStart: Date;
  weekEnd: Date;
  weekLabel: string;
}

export interface WeekSummary {
  weekLabel: string;
  tasks: number;
  posts: number;
  comments: number;
  total: number;
  paid: number;
  awaiting: number;
}

export interface PaymentHistoryEntry {
  batchNumber: number;
  weekLabel: string;
  paidAt: string | null;
  taskCount: number;
  total: number;
  tasks: { taskId: string; displayId: string; type: string; amount: number }[];
}

export interface WalletSummary {
  thisWeek: WeekSummary;
  lastWeek: WeekSummary;
  awaitingAll: { count: number; estimated: number };
  lifetimePaid: number;
  lifetimePaidTasks: number;
  rates: RatePair;
  payments: PaymentHistoryEntry[];
}

function weekSummaryFor(
  tasks: TaskLike[],
  completionByTask: Map<string, Date | null>,
  payoutItemByTask: Map<string, PayoutItemLike>,
  rates: RatePair,
  week: WeekWindow,
): WeekSummary {
  let count = 0;
  let posts = 0;
  let comments = 0;
  let paid = 0;
  let awaiting = 0;
  for (const t of tasks) {
    if (isFailedTask(t)) continue;
    if (t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.ARCHIVED) continue;
    const c = completionByTask.get(t.id);
    if (!c) continue;
    if (c < week.weekStart || c > week.weekEnd) continue;
    count += 1;
    const isPost = String(t.type).toUpperCase() === TaskType.POST;
    if (isPost) posts += 1;
    else comments += 1;
    const item = payoutItemByTask.get(t.id);
    if (item) paid += item.amount;
    else awaiting += rateForType(t.type, rates);
  }
  return { weekLabel: week.weekLabel, tasks: count, posts, comments, total: paid + awaiting, paid, awaiting };
}

export function buildWalletSummary(args: {
  tasks: TaskLike[];
  remindersByTask: Map<string, ReminderLike[]> | Record<string, ReminderLike[]>;
  payoutItems: PayoutItemLike[];
  batchesById: Map<string, PayoutBatchLike> | Record<string, PayoutBatchLike>;
  rates: RatePair;
  currentWeek: WeekWindow;
  previousWeek: WeekWindow;
  weekLabelFor: (weekStart: Date, weekEnd: Date) => string;
}): WalletSummary {
  const { tasks, remindersByTask, payoutItems, batchesById, rates, currentWeek, previousWeek, weekLabelFor } = args;
  const get = (id: string): ReminderLike[] => {
    if (remindersByTask instanceof Map) return remindersByTask.get(id) ?? [];
    return (remindersByTask as Record<string, ReminderLike[]>)[id] ?? [];
  };
  const getBatch = (id: string): PayoutBatchLike | null => {
    if (batchesById instanceof Map) return batchesById.get(id) ?? null;
    return (batchesById as Record<string, PayoutBatchLike>)[id] ?? null;
  };
  const itemByTask = new Map<string, PayoutItemLike>();
  for (const item of payoutItems) itemByTask.set(item.taskId, item);
  const completionByTask = new Map<string, Date | null>();
  for (const t of tasks) completionByTask.set(t.id, getCompletionTime(t, get(t.id)));

  const thisWeek = weekSummaryFor(tasks, completionByTask, itemByTask, rates, currentWeek);
  const lastWeek = weekSummaryFor(tasks, completionByTask, itemByTask, rates, previousWeek);

  let awaitingCount = 0;
  let awaitingEst = 0;
  for (const t of tasks) {
    if (isFailedTask(t)) continue;
    if (t.status !== TaskStatus.COMPLETED) continue;
    awaitingCount += 1;
    awaitingEst += rateForType(t.type, rates);
  }

  // Lifetime paid: actual item amounts; ARCHIVED-without-item anomaly counts at current rates.
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  let lifetimePaid = 0;
  let lifetimePaidTasks = 0;
  const counted = new Set<string>();
  for (const item of payoutItems) {
    lifetimePaid += item.amount;
    if (!counted.has(item.taskId)) {
      counted.add(item.taskId);
      lifetimePaidTasks += 1;
    }
  }
  for (const t of tasks) {
    if (isFailedTask(t)) continue;
    if (t.status !== TaskStatus.ARCHIVED) continue;
    if (itemByTask.has(t.id)) continue;
    lifetimePaid += rateForType(t.type, rates);
    lifetimePaidTasks += 1;
  }

  // Payment history grouped by batch (worker-scoped items only).
  const byBatch = new Map<string, PayoutItemLike[]>();
  for (const item of payoutItems) {
    const list = byBatch.get(item.batchId) ?? [];
    list.push(item);
    byBatch.set(item.batchId, list);
  }
  const payments: PaymentHistoryEntry[] = [];
  for (const [batchId, items] of byBatch) {
    const batch = getBatch(batchId);
    const sorted = [...items].sort(
      (a, b) => (toMs(a.createdAt) ?? 0) - (toMs(b.createdAt) ?? 0),
    );
    const weekLabel = batch
      ? weekLabelFor(new Date(batch.weekStart), new Date(batch.weekEnd))
      : currentWeek.weekLabel;
    payments.push({
      batchNumber: batch?.batchNumber ?? 0,
      weekLabel,
      paidAt: sorted[0]?.createdAt ? toDate(sorted[0].createdAt)!.toISOString() : null,
      taskCount: items.length,
      total: items.reduce((s, i) => s + i.amount, 0),
      tasks: items.map((i) => {
        const t = taskById.get(i.taskId);
        return {
          taskId: i.taskId,
          displayId: t ? displayTaskId(t.id, t.type, t.externalTaskId ?? null) : i.taskId,
          type: String(t?.type ?? i.taskType ?? ''),
          amount: i.amount,
        };
      }),
    });
  }
  payments.sort((a, b) => b.batchNumber - a.batchNumber);

  return {
    thisWeek,
    lastWeek,
    awaitingAll: { count: awaitingCount, estimated: awaitingEst },
    lifetimePaid,
    lifetimePaidTasks,
    rates: { postRate: rates.postRate, commentRate: rates.commentRate },
    payments,
  };
}

// ─── Whitelisted task DTO ────────────────────────────────────────────

export interface WorkerReminderDto {
  type: string;
  dueAt: string;
  sent: boolean;
  sentAt: string | null;
  completed: boolean;
  completedAt: string | null;
  retryCount: number;
}

export interface WorkerTaskDto {
  id: string;
  displayId: string;
  type: string;
  status: string;
  workerStatus: WorkerStatus;
  tab: WorkerTab;
  subreddit: string | null;
  title: string | null;
  redditLink: string | null;
  commentLink: string | null;
  postLink: string | null;
  createdAt: string;
  submittedAt: string | null;
  reminders: WorkerReminderDto[];
  payout: {
    state: PayoutState;
    amount: number;
    estimated: boolean;
    paidAt: string | null;
    batchNumber: number | null;
    weekLabel: string | null;
  };
}

export function toWorkerReminderDto(r: ReminderLike): WorkerReminderDto {
  return {
    type: String(r.type),
    dueAt: toDate(r.dueAt)!.toISOString(),
    sent: r.sent,
    sentAt: toDate(r.sentAt ?? null)?.toISOString() ?? null,
    completed: r.completed,
    completedAt: toDate(r.completedAt ?? null)?.toISOString() ?? null,
    retryCount: r.retryCount ?? 0,
  };
}

export function toWorkerTaskDto(
  task: TaskLike,
  reminders: ReminderLike[],
  payoutItem: PayoutItemLike | null | undefined,
  batch: PayoutBatchLike | null | undefined,
  rates: RatePair,
  now: Date = new Date(),
  opts?: { onMissingPaidItem?: (taskId: string) => void; weekLabelFor?: (s: Date, e: Date) => string },
): WorkerTaskDto {
  const derived = deriveWorkerStatus(task, reminders, now);
  const payout = getPayoutInfo(task, payoutItem, rates, opts);
  const sorted = [...reminders].sort((a, b) => (toMs(a.dueAt) ?? 0) - (toMs(b.dueAt) ?? 0));
  const isComment = String(task.type).toUpperCase() === TaskType.COMMENT;
  return {
    id: task.id,
    displayId: displayTaskId(task.id, task.type, task.externalTaskId ?? null),
    type: String(task.type),
    status: String(task.status),
    workerStatus: derived,
    tab: derived.tab,
    subreddit: task.subreddit ?? null,
    title: task.title ?? null,
    redditLink: task.submittedRedditUrl ?? task.redditUrl ?? null,
    commentLink: isComment ? (task.commentLink ?? null) : null,
    postLink: isComment ? (task.postLink ?? null) : null,
    createdAt: toDate(task.createdAt)!.toISOString(),
    submittedAt: toDate(task.submittedAt ?? null)?.toISOString() ?? null,
    reminders: sorted.map(toWorkerReminderDto),
    payout: {
      state: payout.state,
      amount: payout.amount,
      estimated: payout.estimated,
      paidAt: payoutItem ? toDate(payoutItem.createdAt)!.toISOString() : null,
      batchNumber: batch?.batchNumber ?? null,
      weekLabel:
        batch && opts?.weekLabelFor
          ? opts.weekLabelFor(new Date(batch.weekStart), new Date(batch.weekEnd))
          : null,
    },
  };
}

// ─── Timeline ────────────────────────────────────────────────────────

export interface TimelineEntry {
  key: string;
  label: string;
  at: string | null;
  done: boolean;
}

export function buildTimeline(
  task: TaskLike,
  reminders: ReminderLike[],
  payoutItem: PayoutItemLike | null | undefined,
): TimelineEntry[] {
  const r20 = reminderByType(reminders, '20H');
  const r70 = reminderByType(reminders, '70H');
  const created = toDate(task.createdAt)?.toISOString() ?? null;
  const submitted = toDate(task.submittedAt ?? null)?.toISOString() ?? null;
  const isPost = String(task.type).toUpperCase() === TaskType.POST;
  const done = task.status === TaskStatus.COMPLETED || task.status === TaskStatus.ARCHIVED;
  const entries: TimelineEntry[] = [
    { key: 'assigned', label: 'Assigned', at: created, done: true },
  ];
  if (task.submittedRedditUrl) {
    entries.push({ key: 'link_submitted', label: 'Link submitted', at: submitted, done: true });
    entries.push({
      key: 'format_check',
      label: `Format check: ${mapFormatCheckHint(task.formatCheckStatus)}`,
      at: submitted,
      done: true,
    });
  }
  entries.push({ key: 'started', label: 'Started', at: created, done: true });
  if (r20) {
    entries.push({
      key: 'reminder_20_sent',
      label: '20h reminder sent',
      at: toDate(r20.sentAt ?? null)?.toISOString() ?? null,
      done: r20.sent,
    });
    entries.push({
      key: 'insight_20_received',
      label: '20h insight received',
      at: toDate(r20.completedAt ?? null)?.toISOString() ?? null,
      done: r20.completed,
    });
  }
  if (isPost && r70) {
    entries.push({
      key: 'reminder_70_sent',
      label: '70h reminder sent',
      at: toDate(r70.sentAt ?? null)?.toISOString() ?? null,
      done: r70.sent,
    });
    entries.push({
      key: 'insight_70_received',
      label: '70h insight received',
      at: toDate(r70.completedAt ?? null)?.toISOString() ?? null,
      done: r70.completed,
    });
  }
  entries.push({
    key: 'completed',
    label: 'Completed',
    at: done ? (getCompletionTime(task, reminders)?.toISOString() ?? null) : null,
    done,
  });
  entries.push({
    key: 'paid',
    label: payoutItem ? 'Paid' : 'Payment pending',
    at: payoutItem ? (toDate(payoutItem.createdAt)?.toISOString() ?? null) : null,
    done: !!payoutItem || task.status === TaskStatus.ARCHIVED,
  });
  return entries;
}

// ─── Invites ──────────────────────────────────────────────────────────

export interface WorkerInviteInput {
  inviteeName: string;
  ticketName: string | null;
  paid: number;
}

export interface WorkerInvitesTotals {
  invited: number;
  withTicket: number;
  paid: number;
  directPaid: number;
  directPending: number;
  teamPaid: number;
}

export interface WorkerInviteeDto {
  name: string;
  ticket: string | null;
  paid: number;
}

export interface WorkerInvitesDto {
  summary: WorkerInvitesTotals;
  invitees: WorkerInviteeDto[];
}

function roundMoney(amount: number): number {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

/**
 * Referral view for the signed-in inviter.
 *
 * Money already received comes from that inviter's CommissionItem rows;
 * `directPending` is the payable engine's not-yet-created items. Multi-level
 * earnings are a single anonymous `teamPaid` total — the downstream workers
 * behind them are never named to the inviter, and no Discord ids cross this
 * boundary (only display names and ticket numbers).
 */
export function buildInvitesSummary(input: {
  directPaid: number;
  directPending: number;
  teamPaid: number;
  invitees: WorkerInviteInput[];
}): WorkerInvitesDto {
  const invitees = input.invitees
    .map((i) => ({
      name: i.inviteeName,
      ticket: i.ticketName,
      paid: roundMoney(i.paid),
    }))
    .sort((a, b) => b.paid - a.paid || a.name.localeCompare(b.name));

  const directPaid = roundMoney(input.directPaid);
  const teamPaid = roundMoney(input.teamPaid);

  return {
    summary: {
      invited: invitees.length,
      withTicket: invitees.filter((i) => i.ticket !== null).length,
      paid: roundMoney(directPaid + teamPaid),
      directPaid,
      directPending: roundMoney(input.directPending),
      teamPaid,
    },
    invitees,
  };
}

// ─── Formatting ──────────────────────────────────────────────────────

export function formatMoney(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const str = Number.isInteger(rounded)
    ? rounded.toLocaleString('en-IN', { maximumFractionDigits: 0 })
    : rounded.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  return `\u20B9${str}`;
}

export function formatIST(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export function relativeCountdown(now: Date, dueAt: Date): string {
  const diff = dueAt.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const text = h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
  if (diff < 0) {
    const over = h > 0 ? `${h}h ${m}m overdue` : `${m}m overdue`;
    return over;
  }
  return text;
}

/** Field names that must NEVER appear in any worker response (incl. nested). */
export const WORKER_FORBIDDEN_FIELDS = [
  'payment',
  'deadline',
  'sourceUrl',
  'source',
  'notes',
  'createdById',
  'reviewedBy',
  'reviewedAt',
  'assignmentError',
  'assignmentStatus',
  'deliveryMessages',
  'guildId',
  'contentHtml',
  'formattedContent',
  'taskImages',
  'insightImageUrl',
  'insightImageName',
  'jobId',
  'reminderMessageId',
  'totalWorkers',
  'totalAmount',
  'assignedUserId',
  'externalTaskId',
  'inviterId',
  'inviteeId',
  'invitedWorkerId',
  'inviterType',
  'indirectSpecialInviterId',
  'referralId',
  'sourceTaskId',
  'commissionKind',
  'ticketId',
  'oneTimeCommissionPaid',
  'oneTimeCommissionPaidAt',
  'perTaskCommissionActive',
];
