import { getDb } from '../database/db';
import { toTask } from '../database/converters';
import { Task } from '../types';

export interface WorkerOverview {
  channelId: string;
  channelName: string | null;
  workerId: string | null;
  workerName: string | null;
  totals: {
    all: number;
    posts: number;
    comments: number;
    completed: number;
    active: number;
    cancelled: number;
  };
  byStatus: Record<string, number>;
}

const ACTIVE_STATUSES = ['PENDING', 'REMINDER_20_SENT', 'INSIGHT_20_RECEIVED', 'REMINDER_70_SENT', 'INSIGHT_70_RECEIVED', 'ACCEPTED'];

function sanitizeTask(task: Task): Record<string, unknown> {
  // Worker-visible subset only: no delivery internals, no assignment errors.
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    channelId: task.channelId,
    channelName: task.channelName,
    assignedUserName: task.assignedUserName,
    title: task.title,
    subreddit: task.subreddit,
    subredditUrl: task.subredditUrl,
    postLink: task.postLink,
    commentLink: task.commentLink,
    redditUrl: task.redditUrl,
    submittedRedditUrl: task.submittedRedditUrl,
    submittedAt: task.submittedAt,
    payment: task.payment,
    deadline: task.deadline,
    formatCheckStatus: task.formatCheckStatus,
    cancelledReason: task.cancelledReason,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export async function getWorkerOverview(channelId: string): Promise<WorkerOverview> {
  const rows = await getDb().task.findMany({ where: { channelId } });
  const tasks = rows.map(toTask);

  const byStatus: Record<string, number> = {};
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;

  const first = tasks[0];
  return {
    channelId,
    channelName: first?.channelName ?? null,
    workerId: first?.assignedUserId ?? null,
    workerName: first?.assignedUserName ?? null,
    totals: {
      all: tasks.length,
      posts: tasks.filter((t) => t.type === 'POST').length,
      comments: tasks.filter((t) => t.type === 'COMMENT').length,
      completed: (byStatus['COMPLETED'] || 0) + (byStatus['ARCHIVED'] || 0),
      active: tasks.filter((t) => ACTIVE_STATUSES.includes(t.status)).length,
      cancelled: byStatus['CANCELLED'] || 0,
    },
    byStatus,
  };
}

export async function listWorkerTasks(
  channelId: string,
  filters: { status?: string; type?: string },
  limit = 50,
  page = 1,
): Promise<{ tasks: Record<string, unknown>[]; total: number }> {
  const where: any = { channelId };
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;

  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safePage = Math.max(page, 1);

  const [rows, total] = await Promise.all([
    getDb().task.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      skip: (safePage - 1) * safeLimit,
    }),
    getDb().task.count({ where }),
  ]);

  return { tasks: rows.map(toTask).map(sanitizeTask), total };
}

export async function getWorkerTask(channelId: string, taskId: string): Promise<{ task: Record<string, unknown>; reminders: unknown[] } | null> {
  const row = await getDb().task.findFirst({ where: { id: taskId, channelId } });
  if (!row) return null;
  const reminders = await getDb().reminder.findMany({
    where: { taskId: row.id },
    orderBy: { dueAt: 'asc' },
  });
  const safeReminders = reminders.map((r) => ({
    id: r.id,
    type: r.type,
    dueAt: r.dueAt,
    sent: r.sent,
    completed: r.completed,
    sentAt: r.sentAt,
    completedAt: r.completedAt,
  }));
  return { task: sanitizeTask(toTask(row)), reminders: safeReminders };
}

/** Public ticket list: distinct channelId/channelName pairs that have tasks. */
export async function listWorkerTickets(limit = 500): Promise<{ channelId: string; channelName: string | null; taskCount: number }[]> {
  const rows = await getDb().task.findMany({
    select: { channelId: true, channelName: true },
  });
  const map = new Map<string, { channelId: string; channelName: string | null; taskCount: number }>();
  for (const r of rows) {
    const existing = map.get(r.channelId);
    if (existing) {
      existing.taskCount += 1;
      if (!existing.channelName && r.channelName) existing.channelName = r.channelName;
    } else {
      map.set(r.channelId, { channelId: r.channelId, channelName: r.channelName, taskCount: 1 });
    }
  }
  return [...map.values()]
    .sort((a, b) => (a.channelName || '').localeCompare(b.channelName || ''))
    .slice(0, Math.min(Math.max(limit, 1), 1000));
}
