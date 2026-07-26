import { getDb } from '../db';

export class PayoutRepository {
  // ─── Payout Batches ──────────────────────────────────────────

  async findBatchById(batchId: string) {
    return getDb().payoutBatch.findUnique({ where: { id: batchId } });
  }

  async findBatchByWeek(weekStart: Date, weekEnd: Date) {
    return getDb().payoutBatch.findFirst({
      where: { weekStart, weekEnd },
    });
  }

  async findLatestBatch() {
    return getDb().payoutBatch.findFirst({
      orderBy: { batchNumber: 'desc' },
    });
  }

  async findBatchHistory(limit = 20) {
    return getDb().payoutBatch.findMany({
      orderBy: { weekEnd: 'desc' },
      take: limit,
    });
  }

  async createBatch(data: {
    id: string;
    batchNumber: number;
    weekStart: Date;
    weekEnd: Date;
    totalWorkers: number;
    totalTasks: number;
    totalPosts: number;
    totalComments: number;
    totalAmount: number;
    paidAt: Date | null;
    createdBy: string;
    createdAt: Date;
  }) {
    return getDb().payoutBatch.create({ data: data as any });
  }

  async updateBatchTotals(
    batchId: string,
    totals: {
      totalWorkers: number;
      totalTasks: number;
      totalPosts: number;
      totalComments: number;
      totalAmount: number;
    },
  ) {
    return getDb().payoutBatch.update({
      where: { id: batchId },
      data: totals,
    });
  }

  // ─── Payout Items ────────────────────────────────────────────

  async findItemByTaskId(taskId: string) {
    return getDb().payoutItem.findFirst({
      where: { taskId },
    });
  }

  async findItemsByBatchId(batchId: string) {
    return getDb().payoutItem.findMany({
      where: { batchId },
    });
  }

  async findAllItems() {
    return getDb().payoutItem.findMany();
  }

  async createItem(data: {
    id: string;
    batchId: string;
    taskId: string;
    workerId: string;
    taskType: string;
    amount: number;
    completedAt: Date;
    createdAt: Date;
  }) {
    return getDb().payoutItem.create({ data: data as any });
  }

  async getPaidTaskIds(): Promise<Set<string>> {
    const items = await getDb().payoutItem.findMany({ select: { taskId: true } });
    return new Set(items.map((i) => i.taskId));
  }

  async getTotalPaid(): Promise<number> {
    const result = await getDb().payoutItem.aggregate({ _sum: { amount: true } });
    return result._sum.amount || 0;
  }
}

export const payoutRepository = new PayoutRepository();
