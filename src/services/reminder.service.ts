import {
  Reminder,
  ReminderType,
  TaskType,
  AuditAction,
} from '../types';
import { remindersCollection, toDate, toTimestamp } from '../database/firebase';
import { generateReminderId } from '../utils/id-generator';
import { REMINDER_DELAYS } from '../config/constants';
import { logger } from '../utils/logger';
import { auditLogService } from './audit.service';

class ReminderService {
  /**
   * Create reminders for a task based on its type.
   * - Comment: 1 reminder (COMMENT_20H)
   * - Post: 2 reminders (POST_20H, POST_70H)
   */
  async createForTask(taskId: string, taskType: TaskType, createdAt: Date): Promise<Reminder[]> {
    const reminders: Reminder[] = [];

    if (taskType === TaskType.COMMENT) {
      reminders.push(this.buildReminder(taskId, ReminderType.COMMENT_20H, createdAt, REMINDER_DELAYS.COMMENT_20H));
    } else {
      reminders.push(this.buildReminder(taskId, ReminderType.POST_20H, createdAt, REMINDER_DELAYS.POST_20H));
      reminders.push(this.buildReminder(taskId, ReminderType.POST_70H, createdAt, REMINDER_DELAYS.POST_70H));
    }

    // Save all reminders
    for (const reminder of reminders) {
      await remindersCollection().doc(reminder.id).set({
        ...reminder,
        dueAt: toTimestamp(reminder.dueAt),
        sentAt: reminder.sentAt ? toTimestamp(reminder.sentAt) : null,
        completedAt: reminder.completedAt ? toTimestamp(reminder.completedAt) : null,
      });
    }

    logger.info('Reminders created', {
      taskId,
      count: reminders.length,
      types: reminders.map((r) => r.type),
    });

    return reminders;
  }

  /**
   * Find a reminder by ID.
   */
  async findById(id: string): Promise<Reminder | null> {
    const doc = await remindersCollection().doc(id).get();
    if (!doc.exists) return null;
    return this.docToReminder(doc);
  }

  /**
   * Get all reminders for a task.
   */
  async findByTaskId(taskId: string): Promise<Reminder[]> {
    const snapshot = await remindersCollection()
      .where('taskId', '==', taskId)
      .get();

    const reminders = snapshot.docs.map((doc) => this.docToReminder(doc));
    reminders.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    return reminders;
  }

  /**
   * Find the next pending (unsent) reminder for a task.
   */
  async findNextPending(taskId: string): Promise<Reminder | null> {
    const snapshot = await remindersCollection()
      .where('taskId', '==', taskId)
      .where('sent', '==', false)
      .where('completed', '==', false)
      .get();

    if (snapshot.empty) return null;
    const reminders = snapshot.docs.map((doc) => this.docToReminder(doc));
    reminders.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    return reminders[0];
  }

  /**
   * Find the next sent-but-not-completed reminder for a task.
   * This is the reminder waiting for an insight upload.
   */
  async findWaitingForInsight(taskId: string): Promise<Reminder | null> {
    const snapshot = await remindersCollection()
      .where('taskId', '==', taskId)
      .where('sent', '==', true)
      .where('completed', '==', false)
      .get();

    if (snapshot.empty) return null;
    const reminders = snapshot.docs.map((doc) => this.docToReminder(doc));
    reminders.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    return reminders[0];
  }

  /**
   * Mark a reminder as sent.
   */
  async markSent(reminderId: string): Promise<void> {
    const now = new Date();
    await remindersCollection().doc(reminderId).update({
      sent: true,
      sentAt: toTimestamp(now),
    });

    logger.info('Reminder marked as sent', { reminderId });
    await auditLogService.log(AuditAction.REMINDER_SENT, null, null, `Reminder ${reminderId} sent`);
  }

  /**
   * Mark a reminder as completed (insight received).
   */
  async markCompleted(reminderId: string, userId?: string): Promise<void> {
    const now = new Date();
    await remindersCollection().doc(reminderId).update({
      completed: true,
      completedAt: toTimestamp(now),
    });

    logger.info('Reminder completed', { reminderId });
    await auditLogService.log(
      AuditAction.REMINDER_COMPLETED,
      null,
      userId || null,
      `Reminder ${reminderId} completed`,
    );
  }

  /**
   * Increment the retry count for a reminder.
   */
  async incrementRetry(reminderId: string): Promise<number> {
    const reminder = await this.findById(reminderId);
    if (!reminder) throw new Error('Reminder not found.');

    const newCount = reminder.retryCount + 1;
    await remindersCollection().doc(reminderId).update({
      retryCount: newCount,
    });

    await auditLogService.log(AuditAction.REMINDER_RETRY, null, null, `Retry ${newCount} for ${reminderId}`);
    return newCount;
  }

  /**
   * Update the job ID reference for a reminder.
   */
  async updateJobId(reminderId: string, jobId: string): Promise<void> {
    await remindersCollection().doc(reminderId).update({ jobId });
  }

  /**
   * Store the Discord message ID for a sent reminder.
   */
  async updateReminderMessageId(reminderId: string, messageId: string): Promise<void> {
    await remindersCollection().doc(reminderId).update({ reminderMessageId: messageId });
  }

  /**
   * Store the insight image URL for a completed reminder.
   */
  async updateInsightImage(reminderId: string, imageUrl: string, imageName: string): Promise<void> {
    await remindersCollection().doc(reminderId).update({
      insightImageUrl: imageUrl,
      insightImageName: imageName,
      insightUploadedAt: toTimestamp(new Date()),
    });

    logger.info('Insight image saved for reminder', { reminderId, imageUrl });
  }

  /**
   * Find a reminder by its Discord reminder message ID.
   */
  async findByMessageId(messageId: string): Promise<Reminder | null> {
    const snapshot = await remindersCollection()
      .where('reminderMessageId', '==', messageId)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    return this.docToReminder(snapshot.docs[0]);
  }

  /**
   * Reschedule a reminder to a new time.
   */
  async reschedule(reminderId: string, newDueAt: Date): Promise<Reminder> {
    await remindersCollection().doc(reminderId).update({
      dueAt: toTimestamp(newDueAt),
      sent: false,
      sentAt: null,
    });

    const updated = await this.findById(reminderId);
    if (!updated) throw new Error('Reminder not found after update.');

    logger.info('Reminder rescheduled', { reminderId, newDueAt });
    await auditLogService.log(AuditAction.REMINDER_RESCHEDULED, null, null, `Rescheduled to ${newDueAt.toISOString()}`);

    return updated;
  }

  /**
   * Delete all reminders for a task.
   */
  async deleteByTaskId(taskId: string): Promise<void> {
    const snapshot = await remindersCollection()
      .where('taskId', '==', taskId)
      .get();

    const batch = remindersCollection().firestore.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    logger.info('Reminders deleted for task', { taskId, count: snapshot.size });
  }

  /**
   * Get upcoming reminders (for dashboard display).
   */
  async findUpcoming(limit = 10): Promise<Reminder[]> {
    const snapshot = await remindersCollection()
      .where('sent', '==', false)
      .where('completed', '==', false)
      .get();

    const reminders = snapshot.docs.map((doc) => this.docToReminder(doc));
    reminders.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    return reminders.slice(0, limit);
  }

  // ─── Private Helpers ─────────────────────────────────────────

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

  private docToReminder(doc: FirebaseFirestore.DocumentSnapshot): Reminder {
    const data = doc.data()!;
    return {
      id: doc.id,
      taskId: data.taskId,
      type: data.type as ReminderType,
      dueAt: toDate(data.dueAt) || new Date(),
      sent: data.sent ?? false,
      completed: data.completed ?? false,
      sentAt: toDate(data.sentAt),
      completedAt: toDate(data.completedAt),
      retryCount: data.retryCount ?? 0,
      jobId: data.jobId || null,
      reminderMessageId: data.reminderMessageId || null,
      insightImageUrl: data.insightImageUrl || null,
      insightImageName: data.insightImageName || null,
      insightUploadedAt: toDate(data.insightUploadedAt),
    };
  }
}

export const reminderService = new ReminderService();
