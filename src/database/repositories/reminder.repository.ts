import { getDb } from '../db';

export class ReminderRepository {
  async findById(id: string) {
    return getDb().reminder.findUnique({ where: { id } });
  }

  async findByTaskId(taskId: string) {
    return getDb().reminder.findMany({
      where: { taskId },
      orderBy: { dueAt: 'asc' },
    });
  }

  async findNextPending(taskId: string) {
    return getDb().reminder.findFirst({
      where: { taskId, sent: false, completed: false },
      orderBy: { dueAt: 'asc' },
    });
  }

  async findWaitingForInsight(taskId: string) {
    return getDb().reminder.findFirst({
      where: { taskId, sent: true, completed: false },
      orderBy: { dueAt: 'asc' },
    });
  }

  async findByMessageId(messageId: string) {
    return getDb().reminder.findFirst({
      where: { reminderMessageId: messageId },
    });
  }

  async findUpcoming(limit = 10) {
    return getDb().reminder.findMany({
      where: { sent: false, completed: false },
      orderBy: { dueAt: 'asc' },
      take: limit,
    });
  }

  async findPendingSent() {
    return getDb().reminder.findMany({
      where: { sent: true, completed: false },
    });
  }

  async findPending() {
    return getDb().reminder.findMany({
      where: { sent: false, completed: false },
    });
  }

  async create(data: {
    id: string;
    taskId: string;
    type: string;
    dueAt: Date;
    sent: boolean;
    completed: boolean;
    sentAt: Date | null;
    completedAt: Date | null;
    retryCount: number;
    jobId: string | null;
    reminderMessageId: string | null;
    insightImageUrl: string | null;
    insightImageName: string | null;
    insightUploadedAt: Date | null;
  }) {
    return getDb().reminder.create({ data: data as any });
  }

  async markSent(reminderId: string) {
    return getDb().reminder.update({
      where: { id: reminderId },
      data: { sent: true, sentAt: new Date() },
    });
  }

  async markCompleted(reminderId: string) {
    return getDb().reminder.update({
      where: { id: reminderId },
      data: { completed: true, completedAt: new Date() },
    });
  }

  async updateRetryCount(reminderId: string, retryCount: number) {
    return getDb().reminder.update({
      where: { id: reminderId },
      data: { retryCount },
    });
  }

  async updateJobId(reminderId: string, jobId: string) {
    return getDb().reminder.update({
      where: { id: reminderId },
      data: { jobId },
    });
  }

  async updateReminderMessageId(reminderId: string, reminderMessageId: string) {
    return getDb().reminder.update({
      where: { id: reminderId },
      data: { reminderMessageId },
    });
  }

  async updateInsightImage(reminderId: string, insightImageUrl: string, insightImageName: string) {
    return getDb().reminder.update({
      where: { id: reminderId },
      data: { insightImageUrl, insightImageName, insightUploadedAt: new Date() },
    });
  }

  async reschedule(reminderId: string, dueAt: Date) {
    return getDb().reminder.update({
      where: { id: reminderId },
      data: { dueAt, sent: false, sentAt: null },
    });
  }

  async deleteByTaskId(taskId: string) {
    return getDb().reminder.deleteMany({ where: { taskId } });
  }

  async upsert(data: {
    id: string;
    taskId: string;
    type: string;
    dueAt: Date;
    sent: boolean;
    completed: boolean;
    sentAt: Date | null;
    completedAt: Date | null;
    retryCount: number;
    jobId: string | null;
    reminderMessageId: string | null;
    insightImageUrl: string | null;
    insightImageName: string | null;
    insightUploadedAt: Date | null;
  }) {
    return getDb().reminder.upsert({
      where: { id: data.id },
      create: data as any,
      update: data as any,
    });
  }
}

export const reminderRepository = new ReminderRepository();
