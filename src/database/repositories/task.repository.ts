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

  async create(data: {
    id: string;
    redditUrl: string;
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
