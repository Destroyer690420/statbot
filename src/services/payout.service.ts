import {
  Task,
  TaskStatus,
  TaskType,
  PayoutBatch,
  PayoutItem,
  AuditAction,
} from '../types';
import { taskRepository, payoutRepository } from '../database/repositories';
import { getDb } from '../database/db';
import { generateBatchId, generatePayoutItemId } from '../utils/id-generator';
import { settingsService } from './settings.service';
import { auditLogService } from './audit.service';
import { toTask, toPayoutBatch, toPayoutItem } from '../database/converters';
import { logger } from '../utils/logger';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

class PayoutService {
  getCurrentPayoutWeek(): { weekStart: Date; weekEnd: Date } {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);

    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();
    const dayOfWeek = istNow.getUTCDay();

    const sundayIST = new Date(Date.UTC(year, month, day - dayOfWeek, 0, 0, 0, 0));
    const saturdayIST = new Date(Date.UTC(year, month, day - dayOfWeek + 6, 23, 59, 59, 999));

    return {
      weekStart: new Date(sundayIST.getTime() - istOffset),
      weekEnd: new Date(saturdayIST.getTime() - istOffset),
    };
  }

  getPreviousPayoutWeek(): { weekStart: Date; weekEnd: Date } {
    const current = this.getCurrentPayoutWeek();
    return {
      weekStart: new Date(current.weekStart.getTime() - 7 * 24 * 60 * 60 * 1000),
      weekEnd: new Date(current.weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000),
    };
  }

  getWeekLabel(weekStart: Date, weekEnd: Date): string {
    const startIST = new Date(weekStart.getTime() + IST_OFFSET_MS);
    const endIST = new Date(weekEnd.getTime() + IST_OFFSET_MS);
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return `${fmt(startIST)} — ${fmt(endIST)}`;
  }

  getPayoutWeekInfo(): {
    current: { weekStart: Date; weekEnd: Date; weekLabel: string };
    previous: { weekStart: Date; weekEnd: Date; weekLabel: string };
  } {
    const curr = this.getCurrentPayoutWeek();
    const prev = this.getPreviousPayoutWeek();
    return {
      current: { ...curr, weekLabel: this.getWeekLabel(curr.weekStart, curr.weekEnd) },
      previous: { ...prev, weekLabel: this.getWeekLabel(prev.weekStart, prev.weekEnd) },
    };
  }

  async getTaskCompletionTime(taskId: string): Promise<Date | null> {
    const { reminderService } = require('./reminder.service');
    const reminders: any[] = await reminderService.findByTaskId(taskId);
    const completed = reminders
      .filter((r: any) => r.completed && r.completedAt)
      .sort((a: any, b: any) => b.completedAt!.getTime() - a.completedAt!.getTime());

    if (completed[0]?.completedAt) return completed[0].completedAt;

    const task = await taskRepository.findById(taskId);
    if (!task) return null;
    return task.updatedAt;
  }

  async isTaskPaid(taskId: string): Promise<boolean> {
    const item = await payoutRepository.findItemByTaskId(taskId);
    return item !== null;
  }

  async getPaidTaskIds(): Promise<Set<string>> {
    return payoutRepository.getPaidTaskIds();
  }

  private async getCompletedOrArchivedTasks(): Promise<Task[]> {
    const tasks = await taskRepository.findCompletedOrArchived();
    return tasks.map(toTask);
  }

  async findEligibleTasks(weekStart?: Date, weekEnd?: Date): Promise<Task[]> {
    const tasks = await this.getCompletedOrArchivedTasks();
    const paidTaskIds = await this.getPaidTaskIds();
    const eligible: Task[] = [];

    for (const task of tasks) {
      if (paidTaskIds.has(task.id)) continue;
      if (task.cancelledReason !== null && task.cancelledReason !== undefined) continue;

      if (weekStart && weekEnd) {
        const completionTime = await this.getTaskCompletionTime(task.id);
        if (!completionTime) continue;
        if (completionTime < weekStart || completionTime > weekEnd) continue;
      }

      eligible.push(task);
    }

    return eligible;
  }

  async getSummary(weekStart?: Date, weekEnd?: Date): Promise<{
    workersToPay: number;
    completedTasks: number;
    pendingAmount: number;
    alreadyPaid: number;
    totalPosts: number;
    totalComments: number;
    weekLabel: string;
  }> {
    const eligible = await this.findEligibleTasks(weekStart, weekEnd);
    const rates = await settingsService.getPayoutRates();

    const uniqueWorkers = new Set(eligible.map((t) => t.assignedUserId));
    const totalPosts = eligible.filter((t) => t.type === TaskType.POST).length;
    const totalComments = eligible.filter((t) => t.type === TaskType.COMMENT).length;
    const totalAmount = totalPosts * rates.postRate + totalComments * rates.commentRate;

    const alreadyPaid = await payoutRepository.getTotalPaid();

    const weekLabel = weekStart && weekEnd
      ? this.getWeekLabel(weekStart, weekEnd)
      : 'All Unpaid Tasks';

    return {
      workersToPay: uniqueWorkers.size,
      completedTasks: eligible.length,
      pendingAmount: totalAmount,
      alreadyPaid,
      totalPosts,
      totalComments,
      weekLabel,
    };
  }

  async getWorkerBreakdown(weekStart?: Date, weekEnd?: Date): Promise<
    {
      workerId: string;
      workerName: string;
      posts: number;
      comments: number;
      totalAmount: number;
      status: string;
      tasks: Task[];
    }[]
  > {
    const allTasks = await this.getCompletedOrArchivedTasks();
    const paidTaskIds = await this.getPaidTaskIds();
    const rates = await settingsService.getPayoutRates();

    const matchingTasks: Task[] = [];
    for (const task of allTasks) {
      if (task.cancelledReason !== null && task.cancelledReason !== undefined) continue;

      if (weekStart && weekEnd) {
        const completionTime = await this.getTaskCompletionTime(task.id);
        if (!completionTime) continue;
        if (completionTime < weekStart || completionTime > weekEnd) continue;
      }

      matchingTasks.push(task);
    }

    const workerMap = new Map<string, Task[]>();
    for (const task of matchingTasks) {
      const existing = workerMap.get(task.assignedUserId) || [];
      existing.push(task);
      workerMap.set(task.assignedUserId, existing);
    }

    const result = [];
    for (const [workerId, tasks] of workerMap) {
      const posts = tasks.filter((t) => t.type === TaskType.POST).length;
      const comments = tasks.filter((t) => t.type === TaskType.COMMENT).length;
      const totalAmount = posts * rates.postRate + comments * rates.commentRate;
      const allPaid = tasks.every((t) => paidTaskIds.has(t.id));
      const workerName = tasks[0]?.channelName || workerId.slice(0, 8);

      result.push({
        workerId,
        workerName,
        posts,
        comments,
        totalAmount,
        status: allPaid ? 'Paid' : 'Ready',
        tasks,
      });
    }

    result.sort((a, b) => {
      if (a.status === b.status) return b.totalAmount - a.totalAmount;
      return a.status === 'Ready' ? -1 : 1;
    });

    return result.filter((w) => w.status !== 'Paid');
  }

  async getWorkerDetail(workerId: string, weekStart?: Date, weekEnd?: Date): Promise<{
    workerName: string;
    posts: number;
    comments: number;
    totalAmount: number;
    postsEarnings: number;
    commentsEarnings: number;
    postRate: number;
    commentRate: number;
    status: string;
    tasks: { id: string; type: TaskType; completedAt: string | null; amount: number; paid: boolean }[];
  } | null> {
    const allTasks = await this.getCompletedOrArchivedTasks();
    const paidTaskIds = await this.getPaidTaskIds();
    const rates = await settingsService.getPayoutRates();

    const workerTasks: Task[] = [];
    for (const task of allTasks) {
      if (task.assignedUserId !== workerId) continue;
      if (paidTaskIds.has(task.id)) continue;
      if (task.cancelledReason !== null && task.cancelledReason !== undefined) continue;

      if (weekStart && weekEnd) {
        const completionTime = await this.getTaskCompletionTime(task.id);
        if (!completionTime) continue;
        if (completionTime < weekStart || completionTime > weekEnd) continue;
      }

      workerTasks.push(task);
    }

    if (workerTasks.length === 0) return null;

    const posts = workerTasks.filter((t) => t.type === TaskType.POST).length;
    const comments = workerTasks.filter((t) => t.type === TaskType.COMMENT).length;
    const postsEarnings = posts * rates.postRate;
    const commentsEarnings = comments * rates.commentRate;
    const workerName = workerTasks[0]?.channelName || workerId.slice(0, 8);
    const allPaid = workerTasks.every((t) => paidTaskIds.has(t.id));

    const enrichedTasks = [];
    for (const task of workerTasks) {
      const completedAt = await this.getTaskCompletionTime(task.id);
      const amount = task.type === TaskType.POST ? rates.postRate : rates.commentRate;
      enrichedTasks.push({
        id: task.id,
        type: task.type,
        completedAt: completedAt ? completedAt.toISOString() : null,
        amount,
        paid: paidTaskIds.has(task.id),
      });
    }

    return {
      workerName,
      posts,
      comments,
      totalAmount: postsEarnings + commentsEarnings,
      postsEarnings,
      commentsEarnings,
      postRate: rates.postRate,
      commentRate: rates.commentRate,
      status: allPaid ? 'Paid' : 'Ready',
      tasks: enrichedTasks,
    };
  }

  async getOrCreateCurrentBatch(createdBy: string): Promise<PayoutBatch> {
    const { weekStart, weekEnd } = this.getCurrentPayoutWeek();

    const existing = await payoutRepository.findBatchByWeek(weekStart, weekEnd);
    if (existing) return toPayoutBatch(existing);

    const latest = await payoutRepository.findLatestBatch();
    const nextNumber = latest ? latest.batchNumber + 1 : 1;

    const now = new Date();
    const batch: PayoutBatch = {
      id: generateBatchId(),
      batchNumber: nextNumber,
      weekStart,
      weekEnd,
      totalWorkers: 0,
      totalTasks: 0,
      totalPosts: 0,
      totalComments: 0,
      totalAmount: 0,
      paidAt: null,
      createdBy,
      createdAt: now,
    };

    await payoutRepository.createBatch({
      id: batch.id,
      batchNumber: batch.batchNumber,
      weekStart: batch.weekStart,
      weekEnd: batch.weekEnd,
      totalWorkers: batch.totalWorkers,
      totalTasks: batch.totalTasks,
      totalPosts: batch.totalPosts,
      totalComments: batch.totalComments,
      totalAmount: batch.totalAmount,
      paidAt: batch.paidAt,
      createdBy: batch.createdBy,
      createdAt: batch.createdAt,
    });

    logger.info('Payout batch created', { batchId: batch.id, batchNumber: nextNumber });
    await auditLogService.log(AuditAction.PAYOUT_BATCH_CREATED, null, createdBy, `Batch #${nextNumber} created`);

    return batch;
  }

  async payWorker(workerId: string, createdBy: string): Promise<{ batch: PayoutBatch; items: PayoutItem[] }> {
    const eligible = await this.findEligibleTasks();
    const workerTasks = eligible.filter((t) => t.assignedUserId === workerId);

    if (workerTasks.length === 0) {
      throw new Error('No eligible tasks found for this worker.');
    }

    const rates = await settingsService.getPayoutRates();
    const batch = await this.getOrCreateCurrentBatch(createdBy);
    const items: PayoutItem[] = [];
    const posts = workerTasks.filter((t) => t.type === TaskType.POST).length;
    const comments = workerTasks.filter((t) => t.type === TaskType.COMMENT).length;

    const now = new Date();
    const db = getDb();

    await db.$transaction(async (tx: any) => {
      for (const task of workerTasks) {
        const existingItem = await tx.payoutItem.findFirst({ where: { taskId: task.id } });
        if (existingItem) continue;

        const amount = task.type === TaskType.POST ? rates.postRate : rates.commentRate;
        const completionTime = await this.getTaskCompletionTime(task.id);

        const item: PayoutItem = {
          id: generatePayoutItemId(),
          batchId: batch.id,
          taskId: task.id,
          workerId,
          taskType: task.type,
          amount,
          completedAt: completionTime || now,
          createdAt: now,
        };

        await tx.payoutItem.create({
          data: {
            id: item.id, batchId: item.batchId, taskId: item.taskId,
            workerId: item.workerId, taskType: item.taskType,
            amount: item.amount, completedAt: item.completedAt, createdAt: item.createdAt,
          },
        });

        if (task.status === TaskStatus.COMPLETED) {
          await tx.task.update({
            where: { id: task.id },
            data: { status: 'ARCHIVED' as any, updatedAt: now },
          });
        }

        items.push(item);
      }

      if (items.length === 0) {
        throw new Error('All tasks for this worker have already been paid.');
      }

      const batchPosts = posts;
      const batchComments = comments;
      const batchAmount = items.reduce((sum, i) => sum + i.amount, 0);

      await tx.payoutBatch.update({
        where: { id: batch.id },
        data: {
          totalWorkers: { increment: 1 },
          totalTasks: { increment: items.length },
          totalPosts: { increment: batchPosts },
          totalComments: { increment: batchComments },
          totalAmount: { increment: batchAmount },
        },
      });
    });

    for (const item of items) {
      await auditLogService.log(
        AuditAction.PAYOUT_ITEM_CREATED,
        item.taskId,
        createdBy,
        `Payout ₹${item.amount} for ${item.taskType} — Batch #${batch.batchNumber}`,
      );
    }

    logger.info('Worker paid', { workerId, batchId: batch.id, itemsCreated: items.length });

    return { batch, items };
  }

  async payAll(createdBy: string): Promise<{ batch: PayoutBatch; items: PayoutItem[] }> {
    const eligible = await this.findEligibleTasks();
    if (eligible.length === 0) {
      throw new Error('No eligible tasks for payout.');
    }

    const rates = await settingsService.getPayoutRates();
    const { weekStart, weekEnd } = this.getCurrentPayoutWeek();

    const latest = await payoutRepository.findLatestBatch();
    const nextNumber = latest ? latest.batchNumber + 1 : 1;

    const uniqueWorkers = new Set(eligible.map((t) => t.assignedUserId));
    const posts = eligible.filter((t) => t.type === TaskType.POST).length;
    const comments = eligible.filter((t) => t.type === TaskType.COMMENT).length;
    const now = new Date();

    let totalAmount = 0;
    for (const task of eligible) {
      totalAmount += task.type === TaskType.POST ? rates.postRate : rates.commentRate;
    }

    const batchId = generateBatchId();
    const items: PayoutItem[] = [];

    const db = getDb();

    await db.$transaction(async (tx: any) => {
      await tx.payoutBatch.create({
        data: {
          id: batchId,
          batchNumber: nextNumber,
          weekStart,
          weekEnd,
          totalWorkers: uniqueWorkers.size,
          totalTasks: eligible.length,
          totalPosts: posts,
          totalComments: comments,
          totalAmount,
          paidAt: now,
          createdBy,
          createdAt: now,
        },
      });

      for (const task of eligible) {
        const existingItem = await tx.payoutItem.findFirst({ where: { taskId: task.id } });
        if (existingItem) continue;

        const amount = task.type === TaskType.POST ? rates.postRate : rates.commentRate;
        const completionTime = await this.getTaskCompletionTime(task.id);

        const item: PayoutItem = {
          id: generatePayoutItemId(),
          batchId,
          taskId: task.id,
          workerId: task.assignedUserId,
          taskType: task.type,
          amount,
          completedAt: completionTime || now,
          createdAt: now,
        };

        await tx.payoutItem.create({
          data: {
            id: item.id, batchId: item.batchId, taskId: item.taskId,
            workerId: item.workerId, taskType: item.taskType,
            amount: item.amount, completedAt: item.completedAt, createdAt: item.createdAt,
          },
        });

        if (task.status === TaskStatus.COMPLETED) {
          await tx.task.update({
            where: { id: task.id },
            data: { status: 'ARCHIVED' as any, updatedAt: now },
          });
        }

        items.push(item);
      }

      if (items.length === 0) {
        throw new Error('All eligible tasks have already been paid.');
      }

      if (items.length !== eligible.length) {
        const itemPosts = items.filter((i) => i.taskType === TaskType.POST).length;
        const itemComments = items.filter((i) => i.taskType === TaskType.COMMENT).length;
        const itemAmount = items.reduce((sum, i) => sum + i.amount, 0);
        const itemWorkers = new Set(items.map((i) => i.workerId));

        await tx.payoutBatch.update({
          where: { id: batchId },
          data: {
            totalWorkers: itemWorkers.size,
            totalTasks: items.length,
            totalPosts: itemPosts,
            totalComments: itemComments,
            totalAmount: itemAmount,
          },
        });
      }
    });

    const updatedBatch = await payoutRepository.findBatchById(batchId);

    await auditLogService.log(
      AuditAction.PAYOUT_BATCH_CREATED,
      null,
      createdBy,
      `Batch #${nextNumber} — ${items.length} tasks, ₹${totalAmount}`,
    );

    for (const item of items) {
      await auditLogService.log(
        AuditAction.PAYOUT_ITEM_CREATED,
        item.taskId,
        createdBy,
        `Payout ₹${item.amount} for ${item.taskType} — Batch #${nextNumber}`,
      );
    }

    logger.info('Pay all completed', {
      batchId,
      batchNumber: nextNumber,
      itemsCreated: items.length,
      amount: totalAmount,
      workers: uniqueWorkers.size,
    });

    return { batch: updatedBatch ? toPayoutBatch(updatedBatch) : { id: batchId, batchNumber: nextNumber, weekStart, weekEnd, totalWorkers: uniqueWorkers.size, totalTasks: items.length, totalPosts: posts, totalComments: comments, totalAmount, paidAt: now, createdBy, createdAt: now }, items };
  }

  async getBatchHistory(limit = 20): Promise<PayoutBatch[]> {
    const batches = await payoutRepository.findBatchHistory(limit);
    return batches.map(toPayoutBatch);
  }

  async getBatchDetail(batchId: string): Promise<{
    batch: PayoutBatch;
    items: PayoutItem[];
    workerNames: Record<string, string>;
  } | null> {
    const batch = await payoutRepository.findBatchById(batchId);
    if (!batch) return null;

    const items = await payoutRepository.findItemsByBatchId(batchId);

    const workerIds = [...new Set(items.map((i) => i.workerId))];
    const workerNames: Record<string, string> = {};
    for (const wId of workerIds) {
      const taskDoc = await taskRepository.findByWorkerId(wId);
      if (taskDoc) {
        workerNames[wId] = taskDoc.channelName || wId.slice(0, 8);
      } else {
        workerNames[wId] = wId.slice(0, 8);
      }
    }

    return { batch: toPayoutBatch(batch), items: items.map(toPayoutItem), workerNames };
  }

  async getBatchTaskIds(batchId: string): Promise<string[]> {
    const items = await payoutRepository.findItemsByBatchId(batchId);
    return items.map((i) => i.taskId);
  }

  async getPayoutExportData(batchId?: string, weekStart?: Date, weekEnd?: Date): Promise<{
    rows: {
      workerName: string;
      posts: number;
      comments: number;
      totalAmount: number;
      paymentDate: string;
      batchNumber: number | null;
    }[];
  }> {
    if (batchId) {
      const batch = await payoutRepository.findBatchById(batchId);
      if (!batch) return { rows: [] };

      const items = await payoutRepository.findItemsByBatchId(batchId);
      const workerMap = new Map<string, { posts: number; comments: number; totalAmount: number }>();

      for (const item of items) {
        const existing = workerMap.get(item.workerId) || { posts: 0, comments: 0, totalAmount: 0 };
        existing.totalAmount += item.amount;
        if (item.taskType === 'POST') existing.posts++;
        else existing.comments++;
        workerMap.set(item.workerId, existing);
      }

      const rows = [];
      for (const [workerId, data] of workerMap) {
        const taskDoc = await taskRepository.findByWorkerId(workerId);
        rows.push({
          workerName: taskDoc?.channelName || workerId.slice(0, 8),
          posts: data.posts,
          comments: data.comments,
          totalAmount: data.totalAmount,
          paymentDate: batch.weekStart.toLocaleDateString('en-IN'),
          batchNumber: batch.batchNumber,
        });
      }

      return { rows };
    }

    const breakdown = await this.getWorkerBreakdown(weekStart, weekEnd);
    const rows = breakdown.map((b) => ({
      workerName: b.workerName,
      posts: b.posts,
      comments: b.comments,
      totalAmount: b.totalAmount,
      paymentDate: '',
      batchNumber: null as number | null,
    }));

    return { rows };
  }
}

export const payoutService = new PayoutService();
