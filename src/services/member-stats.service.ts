import { InviterType } from '../types';
import {
  taskRepository,
  payoutRepository,
  referralRepository,
  commissionRepository,
} from '../database/repositories';
import { toTask, toReferral } from '../database/converters';
import { payoutService } from './payout.service';
import { commissionService } from './commission.service';
import { settingsService } from './settings.service';
import {
  buildWorkerStats,
  isWorkDone,
  WorkerStats,
  WorkerTaskRow,
  WorkerPaidItemRow,
} from '../utils/member-stats';
import { logger } from '../utils/logger';

export { WorkerStats };

export interface InviteeProgress {
  inviteeId: string;
  inviteeName: string;
  ticketId: string | null;
  tasks: number;
  posts: number;
  comments: number;
  threshold: number;
  thresholdMet: boolean;
  bonusPaid: number;
  bonusPending: number;
}

export interface InviterStats {
  inviterId: string;
  inviterName: string;
  inviterType: InviterType;
  totals: {
    invited: number;
    ticketsCreated: number;
    qualified: number;
    bonusPaid: number;
    bonusPending: number;
    perTaskPaid: number;
    perTaskPending: number;
  };
  invitees: InviteeProgress[];
}

class MemberStatsService {
  /**
   * Week + all-time stats for one worker (by Discord user id).
   * Returns null when the worker has no tasks at all.
   */
  async getWorkerStats(workerId: string): Promise<WorkerStats | null> {
    const raw = await taskRepository.findAllByWorkerId(workerId);
    if (raw.length === 0) return null;

    const tasks = raw.map(toTask);
    const { weekStart, weekEnd } = payoutService.getCurrentPayoutWeek();
    const weekLabel = payoutService.getWeekLabel(weekStart, weekEnd);
    const rates = await settingsService.getPayoutRates();

    const items = await payoutRepository.findItemsByWorkerId(workerId);
    const batchPaid = new Map<string, boolean>();
    for (const item of items) {
      if (!batchPaid.has(item.batchId)) {
        const batch = await payoutRepository.findBatchById(item.batchId);
        batchPaid.set(item.batchId, batch?.paidAt != null);
      }
    }
    const paidItems: WorkerPaidItemRow[] = items.map((item) => ({
      taskId: item.taskId,
      taskType: item.taskType as WorkerPaidItemRow['taskType'],
      amount: item.amount,
      batchPaid: batchPaid.get(item.batchId) ?? false,
    }));

    const rows: WorkerTaskRow[] = [];
    for (const task of tasks) {
      let completedAtMs: number | null = null;
      if (isWorkDone(task.status)) {
        try {
          const completedAt = await payoutService.getTaskCompletionTime(task.id);
          completedAtMs = completedAt ? completedAt.getTime() : null;
        } catch (error) {
          logger.warn('Worker stats: completion time lookup failed', { taskId: task.id, error });
        }
      }
      rows.push({
        id: task.id,
        type: task.type,
        status: task.status,
        hasCancelledReason: task.cancelledReason !== null && task.cancelledReason !== undefined,
        completedAtMs,
      });
    }

    return buildWorkerStats(
      rows,
      paidItems,
      rates,
      { startMs: weekStart.getTime(), endMs: weekEnd.getTime(), label: weekLabel },
    );
  }

  /**
   * Invite progress for one inviter (by Discord user id), direct referrals
   * only. Returns null when the inviter has no active referrals.
   */
  async getInviterStats(inviterId: string): Promise<InviterStats | null> {
    const refs = (await referralRepository.findByInviterId(inviterId))
      .map(toReferral)
      .filter((r) => r.status !== 'closed');
    if (refs.length === 0) return null;

    const rates = await commissionService.getCommissionRates();
    const allItems = await commissionRepository.findAllItems();

    const batchPaid = new Map<string, boolean>();
    const isBatchPaid = async (batchId: string): Promise<boolean> => {
      if (!batchPaid.has(batchId)) {
        const batch = await commissionRepository.findBatchById(batchId);
        batchPaid.set(batchId, batch?.paidAt != null);
      }
      return batchPaid.get(batchId) ?? false;
    };

    const invitees: InviteeProgress[] = [];
    let ticketsCreated = 0;
    let qualified = 0;
    let bonusPaid = 0;
    let bonusPending = 0;
    let perTaskPaid = 0;
    let perTaskPending = 0;

    for (const ref of refs) {
      const status = await commissionService.computeReferralStatus(ref, rates);
      const threshold =
        ref.inviterType === 'special' ? rates.specialInviteTaskThreshold : rates.normalInviteTaskThreshold;

      if (ref.ticketId) ticketsCreated += 1;
      if (status.isSuccessful) qualified += 1;

      let refBonusPaid = 0;
      let refPerTaskPaid = 0;
      for (const item of allItems) {
        if (item.inviterId !== inviterId || item.referralId !== ref.id) continue;
        if (!(await isBatchPaid(item.batchId))) continue;
        if (item.commissionKind === 'one_time') refBonusPaid += item.amount;
        else refPerTaskPaid += item.amount;
      }

      const payable = await commissionService.getPayableItems(ref, rates);
      const refPerTaskPending = payable
        .filter((p) => p.commissionKind !== 'one_time')
        .reduce((sum, p) => sum + p.amount, 0);

      bonusPaid += refBonusPaid;
      bonusPending += status.bonusAmount;
      perTaskPaid += refPerTaskPaid;
      perTaskPending += refPerTaskPending;

      invitees.push({
        inviteeId: ref.inviteeId,
        inviteeName: ref.inviteeName,
        ticketId: ref.ticketId,
        // Cap the displayed count at the threshold (e.g. 2/2 stays 2/2 even
        // if the invitee goes on to complete more tasks).
        tasks: Math.min(status.taskCount, threshold),
        posts: status.posts,
        comments: status.comments,
        threshold,
        thresholdMet: status.isSuccessful,
        bonusPaid: refBonusPaid,
        bonusPending: status.bonusAmount,
      });
    }

    invitees.sort((a, b) => b.tasks - a.tasks || Number(b.thresholdMet) - Number(a.thresholdMet));

    return {
      inviterId,
      inviterName: refs[0].inviterName,
      inviterType: refs[0].inviterType,
      totals: {
        invited: refs.length,
        ticketsCreated,
        qualified,
        bonusPaid,
        bonusPending,
        perTaskPaid,
        perTaskPending,
      },
      invitees,
    };
  }
}

export const memberStatsService = new MemberStatsService();
