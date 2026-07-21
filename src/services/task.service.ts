import {
  Task,
  CreateTaskInput,
  TaskStatus,
  TaskType,
  TaskFilters,
  AuditAction,
} from '../types';
import { tasksCollection, toDate, toTimestamp } from '../database/firebase';
import { generateTaskId } from '../utils/id-generator';
import { isValidRedditUrl, isValidNotes, isValidTaskId } from '../utils/validators';
import { logger } from '../utils/logger';
import { MAX_NOTES_LENGTH } from '../config/constants';
import { canTransition, transition } from './state-machine';
import { auditLogService } from './audit.service';

class TaskService {
  /**
   * Create a new task.
   */
  async create(input: CreateTaskInput): Promise<Task> {
    // Validate custom task ID if provided
    if (input.taskId) {
      if (!isValidTaskId(input.taskId)) {
        throw new Error('Invalid task ID. Use uppercase letters, numbers, hyphens, or underscores (1-32 chars).');
      }
      const existing = await this.findById(input.taskId);
      if (existing) {
        throw new Error('This task ID already exists.');
      }
    }

    // Validate Reddit URL
    if (!isValidRedditUrl(input.redditUrl)) {
      throw new Error('Invalid Reddit URL.');
    }

    // Validate notes length
    if (input.notes && !isValidNotes(input.notes)) {
      throw new Error(`Notes must be ${MAX_NOTES_LENGTH} characters or less.`);
    }

    // Check for duplicate URL in the same guild
    const duplicate = await this.findByRedditUrl(input.redditUrl, input.guildId);
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
      createdAt: now,
      updatedAt: now,
    };

    await tasksCollection().doc(task.id).set({
      ...task,
      createdAt: toTimestamp(task.createdAt),
      updatedAt: toTimestamp(task.updatedAt),
    });

    logger.info('Task created', { taskId: task.id, type: task.type });
    await auditLogService.log(AuditAction.TASK_CREATED, task.id, input.createdById, `Task created: ${task.type}`);

    return task;
  }

  /**
   * Find a task by ID.
   */
  async findById(id: string): Promise<Task | null> {
    const doc = await tasksCollection().doc(id).get();
    if (!doc.exists) return null;
    return this.docToTask(doc);
  }

  /**
   * Find a task by Reddit URL in a specific guild.
   */
  async findByRedditUrl(url: string, guildId: string): Promise<Task | null> {
    const snapshot = await tasksCollection()
      .where('redditUrl', '==', url.trim())
      .where('guildId', '==', guildId)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    return this.docToTask(snapshot.docs[0]);
  }

  /**
   * Search tasks with filters.
   */
  async search(filters: TaskFilters, limit = 20, page = 1): Promise<Task[]> {
    let query: FirebaseFirestore.Query = tasksCollection();

    if (filters.taskId) {
      const task = await this.findById(filters.taskId);
      return task ? [task] : [];
    }

    if (filters.status) {
      query = query.where('status', '==', filters.status);
    }
    if (filters.type) {
      query = query.where('type', '==', filters.type);
    }
    if (filters.assignedUserId) {
      query = query.where('assignedUserId', '==', filters.assignedUserId);
    }
    if (filters.channelId) {
      query = query.where('channelId', '==', filters.channelId);
    }

    const snapshot = await query.get();
    let tasks = snapshot.docs.map((doc) => this.docToTask(doc));

    // Sort by createdAt descending (client-side to avoid composite index requirements)
    tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Filter by partial Reddit URL (client-side, Firestore can't do partial matches)
    if (filters.redditUrl) {
      const search = filters.redditUrl.toLowerCase();
      tasks = tasks.filter((t) => t.redditUrl.toLowerCase().includes(search));
    }

    // Filter by date range (client-side for simplicity)
    if (filters.dateFrom) {
      tasks = tasks.filter((t) => t.createdAt >= filters.dateFrom!);
    }
    if (filters.dateTo) {
      tasks = tasks.filter((t) => t.createdAt <= filters.dateTo!);
    }

    // Apply offset for pagination
    const offset = (page - 1) * limit;
    if (offset >= tasks.length) {
      return [];
    }
    if (offset > 0) {
      tasks = tasks.slice(offset);
    }

    return tasks.slice(0, limit);
  }

  /**
   * Get all tasks with a specific status.
   */
  async findByStatus(status: TaskStatus, guildId?: string): Promise<Task[]> {
    let query: FirebaseFirestore.Query = tasksCollection().where('status', '==', status);
    if (guildId) {
      query = query.where('guildId', '==', guildId);
    }

    const snapshot = await query.get();
    const tasks = snapshot.docs.map((doc) => this.docToTask(doc));
    tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return tasks;
  }

  /**
   * Update the task status using the state machine.
   */
  async updateStatus(taskId: string, newStatus: TaskStatus, userId?: string): Promise<Task> {
    const task = await this.findById(taskId);
    if (!task) throw new Error('Task not found.');

    const validatedStatus = transition(task.status, newStatus);

    await tasksCollection().doc(taskId).update({
      status: validatedStatus,
      updatedAt: toTimestamp(new Date()),
    });

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

  /**
   * Cancel a task with an optional reason tag.
   * reason: 'deleted' (early detection) or 'deleted_later' (after reminder sent / >30m).
   */
  async cancelTask(taskId: string, userId: string, reason?: string): Promise<Task> {
    const task = await this.findById(taskId);
    if (!task) throw new Error('Task not found.');

    const validatedStatus = transition(task.status, TaskStatus.CANCELLED);

    const updateData: Record<string, unknown> = {
      status: validatedStatus,
      updatedAt: toTimestamp(new Date()),
    };

    if (reason) {
      updateData.cancelledReason = reason;
    }

    await tasksCollection().doc(taskId).update(updateData);

    logger.info('Task cancelled', { taskId, reason, from: task.status });

    await auditLogService.log(
      AuditAction.TASK_CANCELLED,
      taskId,
      userId,
      reason ? `Task cancelled (${reason})` : 'Task cancelled',
    );

    return { ...task, status: validatedStatus, updatedAt: new Date(), cancelledReason: reason || null };
  }

  /**
   * Restore a previously auto-cancelled task back to PENDING and clear its cancelledReason.
   * Only works if task status is CANCELLED.
   */
  async restoreCancelledTask(taskId: string, userId: string): Promise<Task> {
    const task = await this.findById(taskId);
    if (!task) throw new Error('Task not found.');
    if (task.status !== TaskStatus.CANCELLED) throw new Error('Task is not cancelled; cannot restore.');

    await tasksCollection().doc(taskId).update({
      status: TaskStatus.PENDING,
      cancelledReason: null,
      updatedAt: toTimestamp(new Date()),
    });

    logger.info('Task restored from CANCELLED to PENDING', { taskId });

    await auditLogService.log(
      AuditAction.TASK_UPDATED,
      taskId,
      userId,
      `Task uncancelled: ${task.status} → PENDING, cancelledReason cleared`,
    );

    return { ...task, status: TaskStatus.PENDING, cancelledReason: null, updatedAt: new Date() };
  }

  /**
   * Update only the cancelledReason field (manual admin override).
   * Does NOT change task status.
   * Non-null value stops further reminders; null restores normal operation.
   */
  async updateCancelledReason(taskId: string, reason: string | null, userId: string): Promise<Task> {
    const task = await this.findById(taskId);
    if (!task) throw new Error('Task not found.');

    await tasksCollection().doc(taskId).update({
      cancelledReason: reason,
      updatedAt: toTimestamp(new Date()),
    });

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

  /**
   * Delete a task and its associated reminders.
   */
  async delete(taskId: string, userId: string): Promise<void> {
    const task = await this.findById(taskId);
    if (!task) throw new Error('Task not found.');

    // Delete associated reminders
    const remindersSnap = await tasksCollection()
      .firestore.collection('reminders')
      .where('taskId', '==', taskId)
      .get();

    const batch = tasksCollection().firestore.batch();
    remindersSnap.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(tasksCollection().doc(taskId));
    await batch.commit();

    logger.info('Task deleted', { taskId });
    await auditLogService.log(AuditAction.TASK_DELETED, taskId, userId, `Task deleted`);
  }

  /**
   * Get all tasks in a specific ticket channel.
   */
  async findByChannel(channelId: string): Promise<Task[]> {
    const snapshot = await tasksCollection()
      .where('channelId', '==', channelId)
      .where('status', 'not-in', [TaskStatus.ARCHIVED, TaskStatus.CANCELLED])
      .get();

    return snapshot.docs.map((doc) => this.docToTask(doc));
  }

  /**
   * Get overdue tasks (reminders sent but not completed).
   */
  async findOverdue(): Promise<Task[]> {
    const overdueStatuses = [
      TaskStatus.REMINDER_20_SENT,
      TaskStatus.REMINDER_70_SENT,
    ];

    const tasks: Task[] = [];
    for (const status of overdueStatuses) {
      const snapshot = await tasksCollection()
        .where('status', '==', status)
        .get();
      tasks.push(...snapshot.docs.map((doc) => this.docToTask(doc)));
    }

    tasks.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
    return tasks;
  }

  /**
   * Get completed tasks within a date range.
   */
  async findCompleted(dateFrom?: Date, dateTo?: Date): Promise<Task[]> {
    let query: FirebaseFirestore.Query = tasksCollection()
      .where('status', '==', TaskStatus.COMPLETED);

    const snapshot = await query.get();
    let tasks = snapshot.docs.map((doc) => this.docToTask(doc));

    if (dateFrom) {
      tasks = tasks.filter((t) => t.updatedAt >= dateFrom);
    }
    if (dateTo) {
      tasks = tasks.filter((t) => t.updatedAt <= dateTo);
    }

    tasks.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return tasks;
  }

  /**
   * Get all tasks (for stats calculation).
   */
  async findAll(guildId?: string): Promise<Task[]> {
    let query: FirebaseFirestore.Query = tasksCollection();
    if (guildId) {
      query = query.where('guildId', '==', guildId);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => this.docToTask(doc));
  }

  /**
   * Archive old completed/cancelled tasks.
   */
  async archiveOld(thresholdDate: Date): Promise<number> {
    const archiveStatuses = [TaskStatus.COMPLETED, TaskStatus.CANCELLED];
    let archivedCount = 0;

    for (const status of archiveStatuses) {
      const snapshot = await tasksCollection()
        .where('status', '==', status)
        .get();

      for (const doc of snapshot.docs) {
        const task = this.docToTask(doc);
        if (task.updatedAt < thresholdDate && canTransition(task.status, TaskStatus.ARCHIVED)) {
          await doc.ref.update({
            status: TaskStatus.ARCHIVED,
            updatedAt: toTimestamp(new Date()),
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

  /**
   * Archive all completed tasks (moves them to ARCHIVED status).
   * Designed to run weekly (every Sunday).
   */
  async archiveAllCompleted(): Promise<number> {
    const snapshot = await tasksCollection()
      .where('status', '==', TaskStatus.COMPLETED)
      .get();

    let archivedCount = 0;
    for (const doc of snapshot.docs) {
      const task = this.docToTask(doc);
      if (canTransition(task.status, TaskStatus.ARCHIVED)) {
        await doc.ref.update({
          status: TaskStatus.ARCHIVED,
          updatedAt: toTimestamp(new Date()),
        });
        archivedCount++;
      }
    }

    if (archivedCount > 0) {
      logger.info(`Archived ${archivedCount} completed tasks (weekly archive)`);
    }

    return archivedCount;
  }

  /**
   * Convert a Firestore document to a Task object.
   */
  private docToTask(doc: FirebaseFirestore.DocumentSnapshot): Task {
    const data = doc.data()!;
    return {
      id: doc.id,
      redditUrl: data.redditUrl,
      type: data.type as TaskType,
      status: data.status as TaskStatus,
      guildId: data.guildId,
      channelId: data.channelId,
      channelName: data.channelName || null,
      assignedUserId: data.assignedUserId,
      assignedUserName: data.assignedUserName || null,
      createdById: data.createdById,
      notes: data.notes || null,
      cancelledReason: data.cancelledReason || null,
      createdAt: toDate(data.createdAt) || new Date(),
      updatedAt: toDate(data.updatedAt) || new Date(),
    };
  }
}

export const taskService = new TaskService();
