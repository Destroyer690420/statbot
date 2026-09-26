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
    weekStart: Date;
    weekEnd: Date;
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

  async findBatchById(batchId: string) {
    return getDb().commissionBatch.findUnique({ where: { id: batchId } });
  }

  async findBatchHistory(limit = 20) {
    return getDb().commissionBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
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

  async findIndirectPerTaskCommission(inviterId: string, sourceTaskId: string) {
    return getDb().commissionItem.findFirst({
      where: {
        inviterId,
        sourceTaskId,
        commissionKind: 'per_task_indirect',
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

  /**
   * Every commission credited to one inviter, direct and multi-level
   * (`per_task_indirect`) alike, with the batch's payout week so callers can
   * attribute earnings to a week. Scoped to that inviter and projected down to
   * the few fields a worker-facing total needs.
   */
  async findItemsByInviterId(inviterId: string) {
    return getDb().commissionItem.findMany({
      where: { inviterId },
      select: {
        referralId: true,
        commissionKind: true,
        amount: true,
        batch: { select: { weekStart: true } },
      },
    });
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
