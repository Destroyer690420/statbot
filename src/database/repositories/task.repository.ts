import { getDb } from '../db';
import { TaskStatus, TaskType } from '../../types';
import { GOPARTTIME_SOURCE } from '../../config/constants';

export class TaskRepository {
  async findById(id: string) {
    return getDb().task.findUnique({ where: { id } });
  }

  async findByRedditUrl(url: string, guildId: string) {
    return getDb().task.findFirst({
      where: { redditUrl: url, guildId },
    });
  }

  async findByStatus(status: TaskStatus, guildId?: string) {
    return getDb().task.findMany({
      where: { status: status as any, ...(guildId ? { guildId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOverdue() {
    return getDb().task.findMany({
      where: {
        status: { in: ['REMINDER_20_SENT' as any, 'REMINDER_70_SENT' as any] },
      },
      orderBy: { updatedAt: 'asc' },
    });
  }

  async findCompleted(dateFrom?: Date, dateTo?: Date) {
    const tasks = await getDb().task.findMany({
      where: { status: 'COMPLETED' as any },
    });
    return tasks
      .filter((t) => {
        if (dateFrom && t.updatedAt < dateFrom) return false;
        if (dateTo && t.updatedAt > dateTo) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async findCompletedOrArchived() {
    return getDb().task.findMany({
      where: {
        status: { in: ['COMPLETED' as any, 'ARCHIVED' as any] },
      },
    });
  }

  async findByChannel(channelId: string) {
    return getDb().task.findMany({
      where: {
        channelId,
        status: { notIn: ['ARCHIVED' as any, 'CANCELLED' as any] },
      },
    });
  }

  /** Most recent task in a channel (any status) — last-known ticket/worker names. */
  async findLatestByChannelId(channelId: string) {
    return getDb().task.findFirst({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
      select: { channelName: true, assignedUserName: true },
    });
  }

  async findByDeliveryMessageId(channelId: string, messageId: string) {
    const tasks = await getDb().task.findMany({
      where: {
        channelId,
        status: { notIn: ['ARCHIVED' as any, 'CANCELLED' as any] },
      },
    });
    return (
      tasks.find((t) =>
        ((t.deliveryMessages as any[]) || []).some((m) => m && m.messageId === messageId),
      ) || null
    );
  }

  async findAll(guildId?: string) {
    return getDb().task.findMany({
      where: guildId ? { guildId } : {},
    });
  }

  async findByStatusIn(statuses: TaskStatus[]) {
    return getDb().task.findMany({
      where: { status: { in: statuses as any[] } },
    });
  }

  async findByCreatedAt(from: Date, to: Date) {
    return getDb().task.findMany({
      where: { createdAt: { gte: from, lte: to } },
    });
  }

  /**
   * Per-worker count of GoPartTime POST tasks created in [from, to] whose
   * status is not terminal — the daily-cap basis — for MANY workers at once.
   *
   * This is the exact predicate `countPostsAssignedToday` used to evaluate in
   * JavaScript after loading every task in the window WITH all of its columns
   * (contentHtml included), once per ticket. Verified identical for every
   * worker against production data; the win is one indexed, covering query
   * instead of N full-row reads (285 kB -> 3.9 kB per call on real volume).
   *
   * Workers with no matching task are simply absent from the map; callers must
   * treat a missing entry as 0, exactly as the old per-worker filter did.
   */
  async countGoPartTimePostsByWorkerInRange(
    workerIds: readonly string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, number>> {
    const ids = workerIds.filter((id) => typeof id === 'string' && id.length > 0);
    const counts = new Map<string, number>();
    if (ids.length === 0) return counts;

    const rows = await getDb().task.groupBy({
      by: ['assignedUserId'],
      where: {
        createdAt: { gte: from, lte: to },
        source: GOPARTTIME_SOURCE,
        type: 'POST' as TaskType,
        status: { notIn: ['CANCELLED' as TaskStatus, 'ARCHIVED' as TaskStatus] },
        assignedUserId: { in: [...new Set(ids)] },
      },
      _count: { _all: true },
    });

    for (const row of rows) {
      counts.set(row.assignedUserId, row._count._all);
    }
    return counts;
  }

  async findByWorkerId(workerId: string) {
    return getDb().task.findFirst({
      where: { assignedUserId: workerId },
    });
  }

  async findAllByWorkerId(workerId: string) {
    return getDb().task.findMany({
      where: { assignedUserId: workerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByAssignedUserIdAndStatus(userId: string, status: TaskStatus) {
    return getDb().task.findMany({
      where: { assignedUserId: userId, status: status as any },
    });
  }

  async findByChannelNameAndStatus(channelName: string, status: TaskStatus) {
    return getDb().task.findMany({
      where: { channelName, status: status as any },
    });
  }

  async findBySourceExternal(source: string, externalTaskId: string) {
    return getDb().task.findFirst({
      where: { source, externalTaskId },
    });
  }

  async findBySubmittedRedditUrl(url: string) {
    return getDb().task.findFirst({
      where: { submittedRedditUrl: url },
    });
  }

  async findAwaitingSubmission(channelId: string, assignedUserId: string) {
    return getDb().task.findFirst({
      where: {
        source: 'goparttime',
        channelId,
        assignedUserId,
        status: { in: ['PENDING' as any, 'ACCEPTED' as any] },
        submittedRedditUrl: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAnyGoparttimeInChannel(channelId: string) {
    return getDb().task.findFirst({
      where: {
        source: 'goparttime',
        channelId,
        status: { notIn: ['ARCHIVED' as any, 'CANCELLED' as any] },
      },
    });
  }

  async findAwaitingSubmissionInChannel(channelId: string) {
    return getDb().task.findFirst({
      where: {
        source: 'goparttime',
        channelId,
        status: { in: ['PENDING' as any, 'ACCEPTED' as any] },
        submittedRedditUrl: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Batched projection of the two fields callers need to decorate a row with a
   * task reference. Used by the audit-log enrich, which previously issued one
   * `findById` per log row.
   */
  async findManyByIds(ids: string[]): Promise<{ id: string; externalTaskId: string | null; type: string }[]> {
    return getDb().task.findMany({
      where: { id: { in: ids } },
      select: { id: true, externalTaskId: true, type: true },
    });
  }

  /**
   * Bulk equivalent of calling `findAwaitingSubmissionInChannel` +
   * `findAnyGoparttimeInChannel` once per ticket channel.
   *
   * Returns two sets of channel ids instead of two round-trips per channel:
   *  - `awaiting`: has a GoPartTime task in PENDING/ACCEPTED with no submitted URL
   *  - `active`:   has any GoPartTime task that is not ARCHIVED/CANCELLED
   *
   * The per-channel `taskStatus` derivation is `awaiting ? 'awaiting-submission'
   * : active ? 'active' : 'idle'`, which is exactly what callers computed from
   * the two `findFirst` probes — only the query count changes (2 instead of
   * 2 x channels).
   */
  async findChannelTaskStatusSets(): Promise<{ awaiting: Set<string>; active: Set<string> }> {
    const [awaitingRows, activeRows] = await Promise.all([
      getDb().task.findMany({
        where: {
          source: 'goparttime',
          status: { in: ['PENDING' as any, 'ACCEPTED' as any] },
          submittedRedditUrl: null,
        },
        select: { channelId: true },
        distinct: ['channelId'],
      }),
      getDb().task.findMany({
        where: {
          source: 'goparttime',
          status: { notIn: ['ARCHIVED' as any, 'CANCELLED' as any] },
        },
        select: { channelId: true },
        distinct: ['channelId'],
      }),
    ]);

    return {
      awaiting: new Set(awaitingRows.map((r) => r.channelId)),
      active: new Set(activeRows.map((r) => r.channelId)),
    };
  }

  async updateAssignment(taskId: string, data: { assignmentStatus?: string; assignmentError?: string | null }) {
    return getDb().task.update({
      where: { id: taskId },
      data: { ...data, updatedAt: new Date() },
    });
  }

  async updateDeliveryMessages(taskId: string, deliveryMessages: any[]) {
    return getDb().task.update({
      where: { id: taskId },
      data: { deliveryMessages: deliveryMessages as any, updatedAt: new Date() },
    });
  }

  async markSubmitted(taskId: string, submittedRedditUrl: string, submittedBy: string) {
    return getDb().task.update({
      where: { id: taskId },
      data: {
        submittedRedditUrl,
        submittedBy,
        submittedAt: new Date(),
        redditUrl: submittedRedditUrl,
        updatedAt: new Date(),
      },
    });
  }

  async saveFormatCheck(taskId: string, data: { status: string; detail: string | null }) {
    return getDb().task.update({
      where: { id: taskId },
      data: {
        formatCheckStatus: data.status,
        formatCheckDetail: data.detail,
        formatCheckedAt: new Date(),
        updatedAt: new Date(),
      } as any,
    });
  }

  async markReviewed(taskId: string, reviewedBy: string) {
    return getDb().task.update({
      where: { id: taskId },
      data: {
        reviewedAt: new Date(),
        reviewedBy,
        updatedAt: new Date(),
      },
    });
  }

  async create(data: {
    id: string;
    redditUrl: string | null;
    type: string;
    status: string;
    guildId: string;
    channelId: string;
    channelName: string | null;
    assignedUserId: string;
    assignedUserName: string | null;
    createdById: string;
    notes: string | null;
    cancelledReason: string | null;
    source?: string | null;
    externalTaskId?: string | null;
    sourceUrl?: string | null;
    subreddit?: string | null;
    subredditUrl?: string | null;
    flair?: string | null;
    title?: string | null;
    postLink?: string | null;
    commentLink?: string | null;
    contentHtml?: string | null;
    formattedContent?: string | null;
    payment?: string | null;
    deadline?: string | null;
    taskImages?: any[] | null;
    deliveryMessages?: any[] | null;
    assignmentStatus?: string | null;
    assignmentError?: string | null;
    submittedRedditUrl?: string | null;
    submittedAt?: Date | null;
    submittedBy?: string | null;
    reviewedAt?: Date | null;
    reviewedBy?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return getDb().task.create({ data: data as any });
  }

  async updateStatus(taskId: string, status: TaskStatus) {
    return getDb().task.update({
      where: { id: taskId },
      data: { status: status as any, updatedAt: new Date() },
    });
  }

  async updateCancelledReason(taskId: string, cancelledReason: string | null) {
    return getDb().task.update({
      where: { id: taskId },
      data: { cancelledReason, updatedAt: new Date() },
    });
  }

  async restoreToPending(taskId: string) {
    return getDb().task.update({
      where: { id: taskId },
      data: { status: 'PENDING' as any, cancelledReason: null, updatedAt: new Date() },
    });
  }

  async archiveTask(taskId: string) {
    return getDb().task.update({
      where: { id: taskId },
      data: { status: 'ARCHIVED' as any, updatedAt: new Date() },
    });
  }

  async delete(taskId: string) {
    return getDb().task.delete({ where: { id: taskId } });
  }
}

export const taskRepository = new TaskRepository();
