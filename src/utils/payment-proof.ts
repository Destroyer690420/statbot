/**
 * Pure helpers that turn the items a payout/commission batch just created into
 * one payment-proof entry per payee. The payments-channel proof only needs the
 * payee and the total, so grouping/summing stays testable without a client or
 * a database.
 */

export interface PayoutItemLike {
  workerId: string;
  amount: number;
}

export interface WorkerPaymentSummary {
  workerId: string;
  totalAmount: number;
}

/**
 * One entry per worker, in first-seen order. A worker paid for 2 posts and
 * 1 comment becomes `{ workerId, totalAmount: 180 }`.
 */
export function summarizePayoutItemsByWorker(items: PayoutItemLike[]): WorkerPaymentSummary[] {
  const byWorker = new Map<string, WorkerPaymentSummary>();

  for (const item of items) {
    let summary = byWorker.get(item.workerId);
    if (!summary) {
      summary = { workerId: item.workerId, totalAmount: 0 };
      byWorker.set(item.workerId, summary);
    }
    summary.totalAmount += item.amount;
  }

  return [...byWorker.values()];
}

export interface CommissionItemLike {
  inviterId: string;
  amount: number;
}

export interface InviterCommissionSummary {
  inviterId: string;
  totalAmount: number;
}

/**
 * One entry per inviter, in first-seen order. Direct (`one_time`, `per_task`)
 * and multi-level (`per_task_indirect`) items are summed together — the proof
 * card shows one amount per payment.
 */
export function summarizeCommissionItemsByInviter(
  items: CommissionItemLike[],
): InviterCommissionSummary[] {
  const byInviter = new Map<string, InviterCommissionSummary>();

  for (const item of items) {
    let summary = byInviter.get(item.inviterId);
    if (!summary) {
      summary = { inviterId: item.inviterId, totalAmount: 0 };
      byInviter.set(item.inviterId, summary);
    }
    summary.totalAmount += item.amount;
  }

  return [...byInviter.values()];
}
