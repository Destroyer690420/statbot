import {
  Reminder,
  ReminderType,
  TaskType,
  AuditAction,
} from '../types';
import { reminderRepository } from '../database/repositories';
import { generateReminderId } from '../utils/id-generator';
import { REMINDER_DELAYS } from '../config/constants';
import { logger } from '../utils/logger';
import { toReminder } from '../database/converters';
import { auditLogService } from './audit.service';

class ReminderService {
  async createForTask(taskId: string, taskType: TaskType, createdAt: Date): Promise<Reminder[]> {
    const reminders: Reminder[] = [];

    if (taskType === TaskType.COMMENT) {
      reminders.push(this.buildReminder(taskId, ReminderType.COMMENT_20H, createdAt, REMINDER_DELAYS.COMMENT_20H));
    } else {
      reminders.push(this.buildReminder(taskId, ReminderType.POST_20H, createdAt, REMINDER_DELAYS.POST_20H));
      reminders.push(this.buildReminder(taskId, ReminderType.POST_70H, createdAt, REMINDER_DELAYS.POST_70H));
    }

    for (const reminder of reminders) {
      await reminderRepository.create({
        id: reminder.id,
        taskId: reminder.taskId,
        type: reminder.type,
        dueAt: reminder.dueAt,
        sent: reminder.sent,
        completed: reminder.completed,
        sentAt: reminder.sentAt,
        completedAt: reminder.completedAt,
        retryCount: reminder.retryCount,
        jobId: reminder.jobId,
        reminderMessageId: reminder.reminderMessageId,
        insightImageUrl: reminder.insightImageUrl,
        insightImageName: reminder.insightImageName,
        insightUploadedAt: reminder.insightUploadedAt,
      });
    }

    logger.info('Reminders created', {
      taskId,
      count: reminders.length,
      types: reminders.map((r) => r.type),
    });

    return reminders;
  }

  async findById(id: string): Promise<Reminder | null> {
    const doc = await reminderRepository.findById(id);
    return doc ? toReminder(doc) : null;
  }

  async findByTaskId(taskId: string): Promise<Reminder[]> {
    const reminders = await reminderRepository.findByTaskId(taskId);
    return reminders.map(toReminder);
  }

  async findNextPending(taskId: string): Promise<Reminder | null> {
    const doc = await reminderRepository.findNextPending(taskId);
    return doc ? toReminder(doc) : null;
  }

  async findWaitingForInsight(taskId: string): Promise<Reminder | null> {
    const doc = await reminderRepository.findWaitingForInsight(taskId);
    return doc ? toReminder(doc) : null;
  }

  async markSent(reminderId: string): Promise<void> {
    await reminderRepository.markSent(reminderId);
    logger.info('Reminder marked as sent', { reminderId });
    await auditLogService.log(AuditAction.REMINDER_SENT, null, null, `Reminder ${reminderId} sent`);
  }

  async markCompleted(reminderId: string, userId?: string): Promise<void> {
    await reminderRepository.markCompleted(reminderId);
    logger.info('Reminder completed', { reminderId });
    await auditLogService.log(
      AuditAction.REMINDER_COMPLETED,
      null,
      userId || null,
      `Reminder ${reminderId} completed`,
    );
  }

  async incrementRetry(reminderId: string): Promise<number> {
    const reminder = await reminderRepository.findById(reminderId);
    if (!reminder) throw new Error('Reminder not found.');

    const newCount = reminder.retryCount + 1;
    await reminderRepository.updateRetryCount(reminderId, newCount);

    await auditLogService.log(AuditAction.REMINDER_RETRY, null, null, `Retry ${newCount} for ${reminderId}`);
    return newCount;
  }

  async updateJobId(reminderId: string, jobId: string): Promise<void> {
    await reminderRepository.updateJobId(reminderId, jobId);
  }

  async updateReminderMessageId(reminderId: string, messageId: string): Promise<void> {
    await reminderRepository.updateReminderMessageId(reminderId, messageId);
  }

  async updateInsightImage(reminderId: string, imageUrl: string, imageName: string): Promise<void> {
    await reminderRepository.updateInsightImage(reminderId, imageUrl, imageName);
    logger.info('Insight image saved for reminder', { reminderId, imageUrl });
  }

  async findByMessageId(messageId: string): Promise<Reminder | null> {
    const doc = await reminderRepository.findByMessageId(messageId);
    return doc ? toReminder(doc) : null;
  }

  async reschedule(reminderId: string, newDueAt: Date): Promise<Reminder> {
    await reminderRepository.reschedule(reminderId, newDueAt);

    const updated = await reminderRepository.findById(reminderId);
    if (!updated) throw new Error('Reminder not found after update.');

    logger.info('Reminder rescheduled', { reminderId, newDueAt });
    await auditLogService.log(AuditAction.REMINDER_RESCHEDULED, null, null, `Rescheduled to ${newDueAt.toISOString()}`);

    return toReminder(updated);
  }

  async deleteByTaskId(taskId: string): Promise<void> {
    const result = await reminderRepository.deleteByTaskId(taskId);
    logger.info('Reminders deleted for task', { taskId, count: result.count });
  }

  async findUpcoming(limit = 10): Promise<Reminder[]> {
    const reminders = await reminderRepository.findUpcoming(limit);
    return reminders.map(toReminder);
  }

  private buildReminder(
    taskId: string,
    type: ReminderType,
    createdAt: Date,
    delayMs: number,
  ): Reminder {
    return {
      id: generateReminderId(),
      taskId,
      type,
      dueAt: new Date(createdAt.getTime() + delayMs),
      sent: false,
      completed: false,
      sentAt: null,
      completedAt: null,
      retryCount: 0,
      jobId: null,
      reminderMessageId: null,
      insightImageUrl: null,
      insightImageName: null,
      insightUploadedAt: null,
    };
  }
}

export const reminderService = new ReminderService();
