import {
  Task,
  CreateTaskInput,
  TaskStatus,
  TaskFilters,
  AuditAction,
} from '../types';
import { taskRepository, payoutRepository } from '../database/repositories';
import { getDb } from '../database/db';
import { generateTaskId } from '../utils/id-generator';
import { isValidRedditUrl, isValidNotes, isValidTaskId } from '../utils/validators';
import { logger } from '../utils/logger';
import { MAX_NOTES_LENGTH } from '../config/constants';
import { canTransition, transition } from './state-machine';
import { auditLogService } from './audit.service';
import { toTask } from '../database/converters';

class TaskService {
  async create(input: CreateTaskInput): Promise<Task> {
    if (input.taskId) {
      if (!isValidTaskId(input.taskId)) {
        throw new Error('Invalid task ID. Use uppercase letters, numbers, hyphens, or underscores (1-32 chars).');
      }
      const existing = await this.findById(input.taskId);
      if (existing) {
        throw new Error('This task ID already exists.');
      }
    }

    if (!isValidRedditUrl(input.redditUrl)) {
      throw new Error('Invalid Reddit URL.');
    }

    if (input.notes && !isValidNotes(input.notes)) {
      throw new Error(`Notes must be ${MAX_NOTES_LENGTH} characters or less.`);
    }

    const duplicate = await taskRepository.findByRedditUrl(input.redditUrl, input.guildId);
    if (duplicate) {
      throw new Error('This Reddit URL already exists.');
    }

    const now = new Date();
    const task: Task = {
      id: input.taskId || generateTaskId(),
      redditUrl: input.redditUrl.trim(),
      type: input.type,
      status: TaskStatus.PENDING,
      guildId: input.guildId,
      channelId: input.channelId,
      channelName: input.channelName || null,
      assignedUserId: input.assignedUserId,
      assignedUserName: input.assignedUserName || null,
      createdById: input.createdById,
      notes: input.notes || null,
      cancelledReason: null,
      source: null,
      externalTaskId: null,
      sourceUrl: null,
      subreddit: null,
      subredditUrl: null,
      flair: null,
      title: null,
      postLink: null,
      contentHtml: null,
      formattedContent: null,
      payment: null,
      deadline: null,
      taskImages: null,
      deliveryMessages: null,
      assignmentStatus: null,
      assignmentError: null,
      submittedRedditUrl: null,
      submittedAt: null,
      submittedBy: null,
      reviewedAt: null,
      reviewedBy: null,
      createdAt: now,
      updatedAt: now,
    };

    await taskRepository.create({
      id: task.id,
      redditUrl: task.redditUrl,
      type: task.type,
      status: task.status,
      guildId: task.guildId,
      channelId: task.channelId,
      channelName: task.channelName,
      assignedUserId: task.assignedUserId,
      assignedUserName: task.assignedUserName,
      createdById: task.createdById,
      notes: task.notes,
      cancelledReason: task.cancelledReason,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });

    logger.info('Task created', { taskId: task.id, type: task.type });
    await auditLogService.log(AuditAction.TASK_CREATED, task.id, input.createdById, `Task created: ${task.type}`);

    return task;
  }

  async findById(id: string): Promise<Task | null> {
    const doc = await taskRepository.findById(id);
    return doc ? toTask(doc) : null;
  }

  async findByRedditUrl(url: string, guildId: string): Promise<Task | null> {
    const doc = await taskRepository.findByRedditUrl(url.trim(), guildId);
    return doc ? toTask(doc) : null;
  }

  async search(filters: TaskFilters, limit = 20, page = 1): Promise<Task[]> {
    if (filters.taskId) {
      const task = await this.findById(filters.taskId);
      return task ? [task] : [];
    }

    const where: any = {};
    if (filters.status) {
      where.status = filters.status;
    } else {
      // Accepted (queued) tasks are not part of the active task list.
      where.status = { notIn: [TaskStatus.ACCEPTED] };
    }
    if (filters.type) where.type = filters.type;
    if (filters.assignedUserId) where.assignedUserId = filters.assignedUserId;
    if (filters.channelId) where.channelId = filters.channelId;

    const tasks = await getDb().task.findMany({ where });
    let result = tasks.map(toTask);

    result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (filters.redditUrl) {
      const search = filters.redditUrl.toLowerCase();
      result = result.filter((t) => (t.redditUrl || '').toLowerCase().includes(search));
    }

    if (filters.dateFrom) {
      result = result.filter((t) => t.createdAt >= filters.dateFrom!);
    }
    if (filters.dateTo) {
      result = result.filter((t) => t.createdAt <= filters.dateTo!);
    }

    const offset = (page - 1) * limit;
    if (offset >= result.length) return [];
    if (offset > 0) result = result.slice(offset);

    return result.slice(0, limit);
  }

  async findByStatus(status: TaskStatus, guildId?: string): Promise<Task[]> {
    const tasks = await taskRepository.findByStatus(status, guildId);
    return tasks.map(toTask);
  }

  async updateStatus(taskId: string, newStatus: TaskStatus, userId?: string): Promise<Task> {
    const task = await this.findById(taskId);
    if (!task) throw new Error('Task not found.');

    const validatedStatus = transition(task.status, newStatus);

    await taskRepository.updateStatus(taskId, validatedStatus);

    logger.info('Task status updated', {
      taskId,
      from: task.status,
      to: validatedStatus,
    });

    await auditLogService.log(
      AuditAction.TASK_UPDATED,
      taskId,
      userId || null,
      `Status: ${task.status} → ${validatedStatus}`,
    );

    return { ...task, status: validatedStatus, updatedAt: new Date() };
  }

  async cancelTask(taskId: string, userId: string, reason?: string): Promise<Task> {
    const task = await this.findById(taskId);
    if (!task) throw new Error('Task not found.');

    const validatedStatus = transition(task.status, TaskStatus.CANCELLED);

    await taskRepository.updateStatus(taskId, validatedStatus);
    if (reason) {
      await taskRepository.updateCancelledReason(taskId, reason);
    }

    logger.info('Task cancelled', { taskId, reason, from: task.status });

    await auditLogService.log(
      AuditAction.TASK_CANCELLED,
      taskId,
      userId,
      reason ? `Task cancelled (${reason})` : 'Task cancelled',
    );

    return { ...task, status: validatedStatus, updatedAt: new Date(), cancelledReason: reason || null };
  }

  async restoreCancelledTask(taskId: string, userId: string): Promise<Task> {
    const task = await this.findById(taskId);
    if (!task) throw new Error('Task not found.');
    if (task.status !== TaskStatus.CANCELLED) throw new Error('Task is not cancelled; cannot restore.');

    await taskRepository.restoreToPending(taskId);

    logger.info('Task restored from CANCELLED to PENDING', { taskId });

    await auditLogService.log(
      AuditAction.TASK_UPDATED,
      taskId,
      userId,
      `Task uncancelled: ${task.status} → PENDING, cancelledReason cleared`,
    );

    return { ...task, status: TaskStatus.PENDING, cancelledReason: null, updatedAt: new Date() };
  }

  async updateCancelledReason(taskId: string, reason: string | null, userId: string): Promise<Task> {
    const task = await this.findById(taskId);
    if (!task) throw new Error('Task not found.');

    await taskRepository.updateCancelledReason(taskId, reason);

    const logReason = reason === null ? 'cleared' : reason;
    logger.info('Task cancelledReason updated', { taskId, reason: logReason });

    await auditLogService.log(
      AuditAction.TASK_UPDATED,
      taskId,
      userId,
      `Cancelled reason override: ${task.cancelledReason || 'null'} → ${logReason}`,
    );

    return { ...task, cancelledReason: reason, updatedAt: new Date() };
  }

  async delete(taskId: string, userId: string): Promise<void> {
    const task = await this.findById(taskId);
    if (!task) throw new Error('Task not found.');

    const db = getDb();
    await db.$transaction([
      db.reminder.deleteMany({ where: { taskId } }),
      db.task.delete({ where: { id: taskId } }),
    ]);

    logger.info('Task deleted', { taskId });
    await auditLogService.log(AuditAction.TASK_DELETED, taskId, userId, 'Task deleted');
  }

  async findByChannel(channelId: string): Promise<Task[]> {
    const tasks = await taskRepository.findByChannel(channelId);
    return tasks.map(toTask);
  }

  async findOverdue(): Promise<Task[]> {
    const tasks = await taskRepository.findOverdue();
    return tasks.map(toTask);
  }

  async findCompleted(dateFrom?: Date, dateTo?: Date): Promise<Task[]> {
    const tasks = await taskRepository.findCompleted(dateFrom, dateTo);
    return tasks.map(toTask);
  }

  async findAll(guildId?: string): Promise<Task[]> {
    const tasks = await taskRepository.findAll(guildId);
    return tasks.map(toTask);
  }

  async archiveOld(thresholdDate: Date): Promise<number> {
    const archiveStatuses = [TaskStatus.COMPLETED, TaskStatus.CANCELLED];
    const paidTaskIds = await payoutRepository.getPaidTaskIds();
    const db = getDb();

    let archivedCount = 0;

    for (const status of archiveStatuses) {
      const tasks = await taskRepository.findByStatus(status);

      for (const task of tasks) {
        if (
          task.updatedAt < thresholdDate
          && canTransition(task.status as unknown as TaskStatus, TaskStatus.ARCHIVED)
          && paidTaskIds.has(task.id)
        ) {
          await db.task.update({
            where: { id: task.id },
            data: { status: 'ARCHIVED' as any, updatedAt: new Date() },
          });
          archivedCount++;
        }
      }
    }

    if (archivedCount > 0) {
      logger.info(`Archived ${archivedCount} old tasks`);
    }

    return archivedCount;
  }

  async archiveAllCompleted(): Promise<number> {
    const paidTaskIds = await payoutRepository.getPaidTaskIds();
    const db = getDb();

    const tasks = await taskRepository.findByStatus(TaskStatus.COMPLETED);

    let archivedCount = 0;
    for (const task of tasks) {
      if (canTransition(task.status as unknown as TaskStatus, TaskStatus.ARCHIVED) && paidTaskIds.has(task.id)) {
        await db.task.update({
          where: { id: task.id },
          data: { status: 'ARCHIVED' as any, updatedAt: new Date() },
        });
        archivedCount++;
      }
    }

    if (archivedCount > 0) {
      logger.info(`Archived ${archivedCount} completed tasks (weekly archive)`);
    }

    return archivedCount;
  }

  async restoreUnpaidArchivedTasks(): Promise<number> {
    const paidTaskIds = await payoutRepository.getPaidTaskIds();
    const db = getDb();

    const tasks = await taskRepository.findByStatus(TaskStatus.ARCHIVED);

    let restoredCount = 0;
    for (const task of tasks) {
      if (!paidTaskIds.has(task.id)) {
        await db.task.update({
          where: { id: task.id },
          data: { status: 'COMPLETED' as any, updatedAt: new Date() },
        });
        restoredCount++;
      }
    }

    if (restoredCount > 0) {
      logger.info(`Restored ${restoredCount} unpaid archived tasks to COMPLETED`);
    }

    return restoredCount;
  }
}

export const taskService = new TaskService();
