import { getDb } from '../db';
import { TaskStatus } from '../../types';

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

  async findByWorkerId(workerId: string) {
    return getDb().task.findFirst({
      where: { assignedUserId: workerId },
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
