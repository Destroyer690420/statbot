import {
  Task,
  TaskStatus,
  TaskType,
  PayoutBatch,
  PayoutItem,
  AuditAction,
} from '../types';
import {
  tasksCollection,
  payoutBatchesCollection,
  payoutItemsCollection,
  toDate,
  toTimestamp,
} from '../database/firebase';
import { generateBatchId, generatePayoutItemId } from '../utils/id-generator';
import { reminderService } from './reminder.service';
import { settingsService } from './settings.service';
import { auditLogService } from './audit.service';
import { logger } from '../utils/logger';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

class PayoutService {
  // ─── Week Calculations ────────────────────────────────────────

  /**
   * Get the current ongoing payout week boundaries in IST.
   *
   * Payout week runs Sunday 00:00:00 IST → Saturday 23:59:59 IST.
   * Returns the week that contains today.
   */
  getCurrentPayoutWeek(): { weekStart: Date; weekEnd: Date } {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);

    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();
    const dayOfWeek = istNow.getUTCDay(); // 0 = Sunday

    // Sunday of the current week in IST
    const sundayIST = new Date(Date.UTC(year, month, day - dayOfWeek, 0, 0, 0, 0));
    // Saturday of the current week in IST
    const saturdayIST = new Date(Date.UTC(year, month, day - dayOfWeek + 6, 23, 59, 59, 999));

    return {
      weekStart: new Date(sundayIST.getTime() - istOffset),
      weekEnd: new Date(saturdayIST.getTime() - istOffset),
    };
  }

  /**
   * Get the previous payout week boundaries.
   */
  getPreviousPayoutWeek(): { weekStart: Date; weekEnd: Date } {
    const current = this.getCurrentPayoutWeek();
    return {
      weekStart: new Date(current.weekStart.getTime() - 7 * 24 * 60 * 60 * 1000),
      weekEnd: new Date(current.weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000),
    };
  }

  /**
   * Get a week range for display in IST.
   */
  getWeekLabel(weekStart: Date, weekEnd: Date): string {
    const startIST = new Date(weekStart.getTime() + IST_OFFSET_MS);
    const endIST = new Date(weekEnd.getTime() + IST_OFFSET_MS);
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return `${fmt(startIST)} — ${fmt(endIST)}`;
  }

  /**
   * Get week boundaries and label for the given range or current week.
   */
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

  // ─── Task Completion ──────────────────────────────────────────

  /**
   * Get a task's completion time from its last completed reminder.
   */
  async getTaskCompletionTime(taskId: string): Promise<Date | null> {
    const reminders = await reminderService.findByTaskId(taskId);
    const completed = reminders
      .filter((r) => r.completed && r.completedAt)
      .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());

    if (completed[0]?.completedAt) return completed[0].completedAt;

    const task = await tasksCollection().doc(taskId).get();
    if (!task.exists) return null;
    const data = task.data()!;
    return toDate(data.updatedAt);
  }

  // ─── Payment Status Checks ────────────────────────────────────

  /**
   * Check if a task already has a payout item.
   */
  async isTaskPaid(taskId: string): Promise<boolean> {
    const snapshot = await payoutItemsCollection()
      .where('taskId', '==', taskId)
      .limit(1)
      .get();
    return !snapshot.empty;
  }

  /**
   * Get all paid task IDs for bulk filtering.
   */
  async getPaidTaskIds(): Promise<Set<string>> {
    const snapshot = await payoutItemsCollection().get();
    return new Set(snapshot.docs.map((doc) => doc.data().taskId as string));
  }

  // ─── Task Retrieval ───────────────────────────────────────────

  /**
   * Get all completed or archived tasks.
   */
  private async getCompletedOrArchivedTasks(): Promise<Task[]> {
    const statuses = [TaskStatus.COMPLETED, TaskStatus.ARCHIVED];
    const all: Task[] = [];

    for (const status of statuses) {
      const snapshot = await tasksCollection()
        .where('status', '==', status)
        .get();
      for (const doc of snapshot.docs) {
        all.push(this.docToTask(doc));
      }
    }

    return all;
  }

  /**
   * Find all eligible (unpaid, completed) tasks.
   * If weekStart/weekEnd are provided, only returns tasks completed within that range.
   * If no dates are provided, returns ALL unpaid completed tasks.
   */
  async findEligibleTasks(weekStart?: Date, weekEnd?: Date): Promise<Task[]> {
    const tasks = await this.getCompletedOrArchivedTasks();
    const paidTaskIds = await this.getPaidTaskIds();
    const eligible: Task[] = [];

    for (const task of tasks) {
      if (paidTaskIds.has(task.id)) continue;
      if (task.cancelledReason !== null && task.cancelledReason !== undefined) continue;

      // Only filter by date range if explicitly provided
      if (weekStart && weekEnd) {
        const completionTime = await this.getTaskCompletionTime(task.id);
        if (!completionTime) continue;
        if (completionTime < weekStart || completionTime > weekEnd) continue;
      }

      eligible.push(task);
    }

    return eligible;
  }

  // ─── Summary & Breakdown ──────────────────────────────────────

  /**
   * Get payout summary for dashboard cards.
   * Optionally filter by a custom week range.
   */
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

    // Calculate already paid total across all batches
    const allItems = await payoutItemsCollection().get();
    let alreadyPaid = 0;
    for (const doc of allItems.docs) {
      alreadyPaid += doc.data().amount || 0;
    }

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

  /**
   * Get ALL completed tasks for a week grouped by worker.
   * Includes both paid and unpaid tasks, with paid status per worker.
   * Worker name is resolved from channelName (ticket).
   */
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

    // Find completed tasks matching the filter (or all if no filter)
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

    // Group by worker
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
      // Use channelName (ticket) as worker name
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

    // Sort: Ready workers first, then Paid; within same status, sort by amount descending
    result.sort((a, b) => {
      if (a.status === b.status) return b.totalAmount - a.totalAmount;
      return a.status === 'Ready' ? -1 : 1;
    });

    return result;
  }

  /**
   * Get detailed payout breakdown for a single worker.
   * Returns dynamic rates, enriched task list with completion dates, and paid status.
   */
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

    // Find worker's tasks matching the filter (or all if no filter)
    const workerTasks: Task[] = [];
    for (const task of allTasks) {
      if (task.assignedUserId !== workerId) continue;
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

    // Build enriched task list with completion dates
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

  // ─── Batch Management ─────────────────────────────────────────

  /**
   * Get or create a payout batch for the current week.
   */
  async getOrCreateCurrentBatch(createdBy: string): Promise<PayoutBatch> {
    const { weekStart, weekEnd } = this.getCurrentPayoutWeek();

    // Check if a batch already exists for this week
    const existing = await payoutBatchesCollection()
      .where('weekStart', '==', toTimestamp(weekStart))
      .where('weekEnd', '==', toTimestamp(weekEnd))
      .limit(1)
      .get();

    if (!existing.empty) {
      const doc = existing.docs[0];
      return this.docToBatch(doc);
    }

    // Find the next batch number
    const allBatches = await payoutBatchesCollection()
      .orderBy('batchNumber', 'desc')
      .limit(1)
      .get();

    const nextNumber = allBatches.empty ? 1 : (allBatches.docs[0].data().batchNumber as number) + 1;

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

    await payoutBatchesCollection().doc(batch.id).set({
      ...batch,
      weekStart: toTimestamp(batch.weekStart),
      weekEnd: toTimestamp(batch.weekEnd),
      paidAt: null,
      createdAt: toTimestamp(batch.createdAt),
    });

    logger.info('Payout batch created', { batchId: batch.id, batchNumber: nextNumber });
    await auditLogService.log(AuditAction.PAYOUT_BATCH_CREATED, null, createdBy, `Batch #${nextNumber} created`);

    return batch;
  }

  /**
   * Pay a single worker — create payout items for all their eligible tasks.
   */
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

    // Use Firestore batch for atomicity
    const firestoreBatch = payoutItemsCollection().firestore.batch();

    for (const task of workerTasks) {
      // Double-check: skip if already paid (race condition guard)
      const alreadyPaid = await this.isTaskPaid(task.id);
      if (alreadyPaid) {
        logger.warn('Skipping already-paid task during payWorker', { taskId: task.id, workerId });
        continue;
      }

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

      const docRef = payoutItemsCollection().doc(item.id);
      firestoreBatch.set(docRef, {
        ...item,
        completedAt: toTimestamp(item.completedAt),
        createdAt: toTimestamp(item.createdAt),
      });

      items.push(item);
    }

    if (items.length === 0) {
      throw new Error('All tasks for this worker have already been paid.');
    }

    // Update batch totals
    const batchPosts = posts;
    const batchComments = comments;
    const batchAmount = items.reduce((sum, i) => sum + i.amount, 0);

    firestoreBatch.update(payoutBatchesCollection().doc(batch.id), {
      totalWorkers: batch.totalWorkers + 1,
      totalTasks: batch.totalTasks + items.length,
      totalPosts: batch.totalPosts + batchPosts,
      totalComments: batch.totalComments + batchComments,
      totalAmount: batch.totalAmount + batchAmount,
    });

    await firestoreBatch.commit();

    // Log each payout item
    for (const item of items) {
      await auditLogService.log(
        AuditAction.PAYOUT_ITEM_CREATED,
        item.taskId,
        createdBy,
        `Payout ₹${item.amount} for ${item.taskType} — Batch #${batch.batchNumber}`,
      );
    }

    logger.info('Worker paid', { workerId, batchId: batch.id, itemsCreated: items.length, amount: batchAmount });

    return { batch: { ...batch, totalTasks: batch.totalTasks + items.length, totalAmount: batch.totalAmount + batchAmount }, items };
  }

  /**
   * Pay ALL eligible workers — create batch + payout items atomically.
   */
  async payAll(createdBy: string): Promise<{ batch: PayoutBatch; items: PayoutItem[] }> {
    const eligible = await this.findEligibleTasks();
    if (eligible.length === 0) {
      throw new Error('No eligible tasks for payout.');
    }

    const rates = await settingsService.getPayoutRates();
    const { weekStart, weekEnd } = this.getCurrentPayoutWeek();

    // Find next batch number
    const allBatches = await payoutBatchesCollection()
      .orderBy('batchNumber', 'desc')
      .limit(1)
      .get();

    const nextNumber = allBatches.empty ? 1 : (allBatches.docs[0].data().batchNumber as number) + 1;

    const uniqueWorkers = new Set(eligible.map((t) => t.assignedUserId));
    const posts = eligible.filter((t) => t.type === TaskType.POST).length;
    const comments = eligible.filter((t) => t.type === TaskType.COMMENT).length;
    const now = new Date();

    // Calculate totals
    let totalAmount = 0;
    for (const task of eligible) {
      totalAmount += task.type === TaskType.POST ? rates.postRate : rates.commentRate;
    }

    // Create batch document first
    const batch: PayoutBatch = {
      id: generateBatchId(),
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
    };

    // Use Firestore batch write for atomicity
    const firestoreBatch = payoutItemsCollection().firestore.batch();

    // Save batch
    firestoreBatch.set(payoutBatchesCollection().doc(batch.id), {
      ...batch,
      weekStart: toTimestamp(batch.weekStart),
      weekEnd: toTimestamp(batch.weekEnd),
      paidAt: toTimestamp(batch.paidAt!),
      createdAt: toTimestamp(batch.createdAt),
    });

    // Create payout items
    const items: PayoutItem[] = [];
    for (const task of eligible) {
      // Double-check: skip if already paid (race condition guard)
      const alreadyPaid = await this.isTaskPaid(task.id);
      if (alreadyPaid) {
        logger.warn('Skipping already-paid task during payAll', { taskId: task.id });
        continue;
      }

      const amount = task.type === TaskType.POST ? rates.postRate : rates.commentRate;
      const completionTime = await this.getTaskCompletionTime(task.id);

      const item: PayoutItem = {
        id: generatePayoutItemId(),
        batchId: batch.id,
        taskId: task.id,
        workerId: task.assignedUserId,
        taskType: task.type,
        amount,
        completedAt: completionTime || now,
        createdAt: now,
      };

      const docRef = payoutItemsCollection().doc(item.id);
      firestoreBatch.set(docRef, {
        ...item,
        completedAt: toTimestamp(item.completedAt),
        createdAt: toTimestamp(item.createdAt),
      });

      items.push(item);
    }

    if (items.length === 0) {
      throw new Error('All eligible tasks have already been paid.');
    }

    // Update batch totals if some tasks were already paid
    if (items.length !== eligible.length) {
      const itemPosts = items.filter((i) => i.taskType === TaskType.POST).length;
      const itemComments = items.filter((i) => i.taskType === TaskType.COMMENT).length;
      const itemAmount = items.reduce((sum, i) => sum + i.amount, 0);
      const itemWorkers = new Set(items.map((i) => i.workerId));

      firestoreBatch.update(payoutBatchesCollection().doc(batch.id), {
        totalWorkers: itemWorkers.size,
        totalTasks: items.length,
        totalPosts: itemPosts,
        totalComments: itemComments,
        totalAmount: itemAmount,
      });

      batch.totalWorkers = itemWorkers.size;
      batch.totalTasks = items.length;
      batch.totalPosts = itemPosts;
      batch.totalComments = itemComments;
      batch.totalAmount = itemAmount;
    }

    await firestoreBatch.commit();

    // Log batch creation
    await auditLogService.log(
      AuditAction.PAYOUT_BATCH_CREATED,
      null,
      createdBy,
      `Batch #${batch.batchNumber} — ${items.length} tasks, ₹${batch.totalAmount}`,
    );

    // Log each payout item
    for (const item of items) {
      await auditLogService.log(
        AuditAction.PAYOUT_ITEM_CREATED,
        item.taskId,
        createdBy,
        `Payout ₹${item.amount} for ${item.taskType} — Batch #${batch.batchNumber}`,
      );
    }

    logger.info('Pay all completed', {
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      itemsCreated: items.length,
      amount: batch.totalAmount,
      workers: batch.totalWorkers,
    });

    return { batch, items };
  }

  // ─── History & Detail ─────────────────────────────────────────

  /**
   * Get payout batch history.
   */
  async getBatchHistory(limit = 20): Promise<PayoutBatch[]> {
    const snapshot = await payoutBatchesCollection()
      .orderBy('weekEnd', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => this.docToBatch(doc));
  }

  /**
   * Get a single payout batch with its items and worker names.
   */
  async getBatchDetail(batchId: string): Promise<{
    batch: PayoutBatch;
    items: PayoutItem[];
    workerNames: Record<string, string>;
  } | null> {
    const doc = await payoutBatchesCollection().doc(batchId).get();
    if (!doc.exists) return null;

    const batch = this.docToBatch(doc);

    const itemsSnapshot = await payoutItemsCollection()
      .where('batchId', '==', batchId)
      .get();

    const items = itemsSnapshot.docs.map((d) => this.docToPayoutItem(d));

    // Resolve worker names from their tasks (channelName = ticket)
    const workerIds = [...new Set(items.map((i) => i.workerId))];
    const workerNames: Record<string, string> = {};
    for (const wId of workerIds) {
      const taskDoc = await tasksCollection()
        .where('assignedUserId', '==', wId)
        .limit(1)
        .get();
      if (!taskDoc.empty) {
        workerNames[wId] = taskDoc.docs[0].data().channelName || wId.slice(0, 8);
      } else {
        workerNames[wId] = wId.slice(0, 8);
      }
    }

    return { batch, items, workerNames };
  }

  /**
   * Get all paid task IDs for a batch (to check if a task was paid).
   */
  async getBatchTaskIds(batchId: string): Promise<string[]> {
    const snapshot = await payoutItemsCollection()
      .where('batchId', '==', batchId)
      .get();

    return snapshot.docs.map((d) => d.data().taskId as string);
  }

  // ─── Export ───────────────────────────────────────────────────

  /**
   * Get structured data for CSV export.
   * If batchId is provided, exports from that batch.
   * Otherwise, exports the current eligible worker breakdown.
   */
  async getPayoutExportData(batchId?: string, weekStart?: Date, weekEnd?: Date): Promise<{
    rows: { workerName: string; posts: number; comments: number; totalAmount: number; paymentDate: string; batchNumber: number }[];
  }> {
    if (batchId) {
      // Export from a specific batch
      const detail = await this.getBatchDetail(batchId);
      if (!detail) throw new Error('Batch not found.');

      const { batch, items, workerNames } = detail;
      const workerMap = new Map<string, { posts: number; comments: number; amount: number }>();

      for (const item of items) {
        const existing = workerMap.get(item.workerId) || { posts: 0, comments: 0, amount: 0 };
        if (item.taskType === TaskType.POST) existing.posts++;
        else existing.comments++;
        existing.amount += item.amount;
        workerMap.set(item.workerId, existing);
      }

      const rows = [];
      for (const [wId, data] of workerMap) {
        rows.push({
          workerName: workerNames[wId] || wId.slice(0, 8),
          posts: data.posts,
          comments: data.comments,
          totalAmount: data.amount,
          paymentDate: batch.paidAt
            ? new Date(batch.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
            : '',
          batchNumber: batch.batchNumber,
        });
      }

      return { rows };
    } else {
      // Export current eligible breakdown
      const breakdown = await this.getWorkerBreakdown(weekStart, weekEnd);
      const rows = breakdown.map((w) => ({
        workerName: w.workerName,
        posts: w.posts,
        comments: w.comments,
        totalAmount: w.totalAmount,
        paymentDate: '',
        batchNumber: 0,
      }));
      return { rows };
    }
  }

  // ─── Document Converters ──────────────────────────────────────

  private docToBatch(doc: FirebaseFirestore.DocumentSnapshot): PayoutBatch {
    const data = doc.data()!;
    return {
      id: doc.id,
      batchNumber: data.batchNumber,
      weekStart: toDate(data.weekStart) || new Date(),
      weekEnd: toDate(data.weekEnd) || new Date(),
      totalWorkers: data.totalWorkers ?? 0,
      totalTasks: data.totalTasks ?? 0,
      totalPosts: data.totalPosts ?? 0,
      totalComments: data.totalComments ?? 0,
      totalAmount: data.totalAmount ?? 0,
      paidAt: toDate(data.paidAt),
      createdBy: data.createdBy || '',
      createdAt: toDate(data.createdAt) || new Date(),
    };
  }

  private docToPayoutItem(doc: FirebaseFirestore.DocumentSnapshot): PayoutItem {
    const data = doc.data()!;
    return {
      id: doc.id,
      batchId: data.batchId,
      taskId: data.taskId,
      workerId: data.workerId,
      taskType: data.taskType as TaskType,
      amount: data.amount ?? 0,
      completedAt: toDate(data.completedAt) || new Date(),
      createdAt: toDate(data.createdAt) || new Date(),
    };
  }

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

export const payoutService = new PayoutService();
