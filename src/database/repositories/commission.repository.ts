import { getDb } from '../db';

export class CommissionRepository {
  // ─── Commission Batches ──────────────────────────────────────

  async findLatestBatch() {
    return getDb().commissionBatch.findFirst({
      orderBy: { batchNumber: 'desc' },
    });
  }

  async createBatch(data: {
    id: string;
    batchNumber: number;
    totalInviters: number;
    totalAmount: number;
    paidAt: Date | null;
    createdAt: Date;
  }) {
    return getDb().commissionBatch.create({ data: data as any });
  }

  async updateBatchTotals(batchId: string, totals: {
    totalInviters: number;
    totalAmount: number;
  }) {
    return getDb().commissionBatch.update({
      where: { id: batchId },
      data: totals,
    });
  }

  // ─── Commission Items ────────────────────────────────────────

  async findOneTimeCommission(referralId: string, inviterId: string) {
    return getDb().commissionItem.findFirst({
      where: {
        referralId,
        inviterId,
        commissionKind: 'one_time',
      },
    });
  }

  async findPerTaskCommission(inviterId: string, sourceTaskId: string) {
    return getDb().commissionItem.findFirst({
      where: {
        inviterId,
        sourceTaskId,
        commissionKind: 'per_task',
      },
    });
  }

  async findItemsByBatchId(batchId: string) {
    return getDb().commissionItem.findMany({
      where: { batchId },
    });
  }

  async findAllItems() {
    return getDb().commissionItem.findMany();
  }

  async createItem(data: {
    id: string;
    batchId: string;
    referralId: string;
    inviterId: string;
    invitedWorkerId: string;
    sourceTaskId: string | null;
    commissionKind: string;
    amount: number;
    createdAt: Date;
  }) {
    return getDb().commissionItem.create({ data: data as any });
  }
}

export const commissionRepository = new CommissionRepository();
