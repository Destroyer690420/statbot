import {
  Task,
  TaskStatus,
  TaskType,
  Referral,
  InviterType,
  CommissionItem,
  CommissionKind,
  CommissionBatch,
  CommissionRates,
  AuditAction,
} from '../types';
import { taskRepository, referralRepository, commissionRepository, settingsRepository } from '../database/repositories';
import { getDb } from '../database/db';
import { generateReferralId, generateBatchId, generateCommissionItemId } from '../utils/id-generator';
import { auditLogService } from './audit.service';
import { toTask, toReferral, toCommissionBatch } from '../database/converters';
import { logger } from '../utils/logger';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const MAX_INDIRECT_CHAIN_DEPTH = 10;

/**
 * Walk the referral ancestor chain upward from `inviterId` (level by level,
 * across all parent paths) and return the first non-closed SPECIAL inviter
 * found at ANY depth — or null when the chain has no special inviter.
 * Cycle-safe via a visited set, with a hard depth cap.
 */
export async function resolveIndirectSpecialInviterId(inviterId: string): Promise<string | null> {
  const visited = new Set<string>([inviterId]);
  let frontier: string[] = [inviterId];

  for (let depth = 0; depth < MAX_INDIRECT_CHAIN_DEPTH && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];
    for (const currentId of frontier) {
      const parentRefs = await referralRepository.findByInviteeId(currentId);
      for (const parent of parentRefs) {
        if ((parent as any).inviterType === 'special' && (parent as any).status !== 'closed') {
          return parent.inviterId;
        }
        // Not an open special: keep exploring through this ancestor
        // (deduped so cycles terminate); a special seen only through a
        // closed link stays discoverable via an open link later.
        if (!visited.has(parent.inviterId)) {
          visited.add(parent.inviterId);
          nextFrontier.push(parent.inviterId);
        }
      }
    }
    frontier = nextFrontier;
  }

  return null;
}

const DEFAULT_RATES: CommissionRates = {
  normalInviteBonus: 100,
  normalInviteTaskThreshold: 2,
  specialInviteBonus: 50,
  specialInviteTaskThreshold: 1,
  specialPerComment: 10,
  specialPerPost: 20,
  updatedAt: new Date(),
  updatedBy: 'system',
};

class CommissionService {
  async getCommissionRates(): Promise<CommissionRates> {
    try {
      const doc = await settingsRepository.getCommissionRates();
      if (!doc) return { ...DEFAULT_RATES };
      return {
        normalInviteBonus: doc.normalInviteBonus ?? DEFAULT_RATES.normalInviteBonus,
        normalInviteTaskThreshold: doc.normalInviteTaskThreshold ?? DEFAULT_RATES.normalInviteTaskThreshold,
        specialInviteBonus: doc.specialInviteBonus ?? DEFAULT_RATES.specialInviteBonus,
        specialInviteTaskThreshold: doc.specialInviteTaskThreshold ?? DEFAULT_RATES.specialInviteTaskThreshold,
        specialPerComment: doc.specialPerComment ?? DEFAULT_RATES.specialPerComment,
        specialPerPost: doc.specialPerPost ?? DEFAULT_RATES.specialPerPost,
        updatedAt: doc.updatedAt,
        updatedBy: doc.updatedBy,
      };
    } catch (error) {
      logger.error('Failed to read commission rates, using defaults', { error });
      return { ...DEFAULT_RATES };
    }
  }

  async updateCommissionRates(rates: Omit<CommissionRates, 'updatedAt' | 'updatedBy'>, userId: string): Promise<void> {
    await settingsRepository.setCommissionRates({
      ...rates,
      updatedAt: new Date(),
      updatedBy: userId,
    });
    logger.info('Commission rates updated', { rates, userId });
  }

  private async getCompletedTasksForUser(userId: string, weekStart?: Date, weekEnd?: Date): Promise<Task[]> {
    const statuses: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.ARCHIVED];
    const all: Task[] = [];
    for (const status of statuses) {
      const tasks = await taskRepository.findByAssignedUserIdAndStatus(userId, status);
      for (const t of tasks) {
        const task = toTask(t);
        if (task.cancelledReason !== null && task.cancelledReason !== undefined) continue;
        all.push(task);
      }
    }

    if (weekStart && weekEnd) {
      const filtered: Task[] = [];
      for (const task of all) {
        const ct = await this.getTaskCompletionTime(task.id);
        if (ct && ct >= weekStart && ct <= weekEnd) {
          filtered.push(task);
        }
      }
      return filtered;
    }

    return all;
  }

  private async getCompletedTasksByChannelName(channelName: string, weekStart?: Date, weekEnd?: Date): Promise<Task[]> {
    const statuses: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.ARCHIVED];
    const all: Task[] = [];
    for (const status of statuses) {
      const tasks = await taskRepository.findByChannelNameAndStatus(channelName, status);
      for (const t of tasks) {
        const task = toTask(t);
        if (task.cancelledReason !== null && task.cancelledReason !== undefined) continue;
        all.push(task);
      }
    }

    if (weekStart && weekEnd) {
      const filtered: Task[] = [];
      for (const task of all) {
        const ct = await this.getTaskCompletionTime(task.id);
        if (ct && ct >= weekStart && ct <= weekEnd) {
          filtered.push(task);
        }
      }
      return filtered;
    }

    return all;
  }

  private async getTasksForReferral(ref: Referral, weekStart?: Date, weekEnd?: Date): Promise<Task[]> {
    let tasks = await this.getCompletedTasksForUser(ref.inviteeId, weekStart, weekEnd);
    if (tasks.length === 0 && ref.ticketId) {
      tasks = await this.getCompletedTasksByChannelName(ref.ticketId, weekStart, weekEnd);
    }
    return tasks;
  }

  private async getTaskCompletionTime(taskId: string): Promise<Date | null> {
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

  async getReferrals(): Promise<Referral[]> {
    const referrals = await referralRepository.findAll();
    return referrals.map(toReferral);
  }

  async createReferral(data: {
    inviterId: string;
    inviterName: string;
    inviteeId: string;
    inviteeName: string;
    inviterType: InviterType;
    ticketId?: string;
  }, createdBy: string): Promise<Referral> {
    const existing = await referralRepository.findByInviteeAndInviter(data.inviteeId, data.inviterId);
    if (existing) {
      throw new Error(`A referral already exists for invitee <@${data.inviteeId}>.`);
    }

    // Auto-detect multi-level chain: walk this normal inviter's ancestor
    // chain upward to find a special inviter at ANY depth (not just one level)
    let indirectSpecialInviterId: string | null = null;
    if (data.inviterType === 'normal') {
      indirectSpecialInviterId = await resolveIndirectSpecialInviterId(data.inviterId);
      if (indirectSpecialInviterId) {
        logger.info('Indirect special inviter detected', {
          normalInviter: data.inviterId,
          specialInviter: indirectSpecialInviterId,
          invitee: data.inviteeId,
        });
      }
    }

    const now = new Date();
    const referral: Referral = {
      id: generateReferralId(),
      inviterId: data.inviterId,
      inviterName: data.inviterName,
      inviteeId: data.inviteeId,
      inviteeName: data.inviteeName,
      inviterType: data.inviterType,
      status: 'pending',
      oneTimeCommissionPaid: false,
      oneTimeCommissionPaidAt: null,
      perTaskCommissionActive: false,
      ticketId: data.ticketId || null,
      indirectSpecialInviterId,
      createdAt: now,
      updatedAt: now,
    };

    await referralRepository.create({
      id: referral.id,
      inviterId: referral.inviterId,
      inviterName: referral.inviterName,
      inviteeId: referral.inviteeId,
      inviteeName: referral.inviteeName,
      inviterType: referral.inviterType,
      status: referral.status,
      oneTimeCommissionPaid: referral.oneTimeCommissionPaid,
      oneTimeCommissionPaidAt: referral.oneTimeCommissionPaidAt,
      perTaskCommissionActive: referral.perTaskCommissionActive,
      ticketId: referral.ticketId,
      indirectSpecialInviterId: referral.indirectSpecialInviterId,
      createdAt: referral.createdAt,
      updatedAt: referral.updatedAt,
    });

    await auditLogService.log(
      AuditAction.REFERRAL_ADDED,
      null,
      createdBy,
      `Referral ${referral.id} — ${data.inviterName} → ${data.inviteeName} (${data.inviterType})${indirectSpecialInviterId ? ` [indirect: ${indirectSpecialInviterId}]` : ''}`,
    );

    logger.info('Referral created', { referralId: referral.id, indirectSpecialInviterId });
    return referral;
  }

  async updateReferral(
    referralId: string,
    data: { inviterId?: string; inviteeId?: string; inviterName?: string; inviteeName?: string; ticketId?: string | null },
    updatedBy: string,
  ): Promise<Referral> {
    const ref = await referralRepository.findById(referralId);
    if (!ref) throw new Error('Referral not found.');
    const current = toReferral(ref as any);

    const newInviterId = data.inviterId ?? current.inviterId;
    const newInviteeId = data.inviteeId ?? current.inviteeId;
    if (!/^\d{17,20}$/.test(newInviterId)) throw new Error('Invalid inviter ID.');
    if (!/^\d{17,20}$/.test(newInviteeId)) throw new Error('Invalid invitee ID.');

    // Keep-first: the (invitee, inviter) pair must stay unique.
    if (newInviterId !== current.inviterId || newInviteeId !== current.inviteeId) {
      const dup = await referralRepository.findByInviteeAndInviter(newInviteeId, newInviterId);
      if (dup && (dup as any).id !== referralId) {
        throw new Error(`Another referral already exists for invitee <@${newInviteeId}>.`);
      }
    }

    const updateData: {
      inviterId?: string;
      inviterName?: string;
      inviteeId?: string;
      inviteeName?: string;
      inviterType?: string;
      indirectSpecialInviterId?: string | null;
      ticketId?: string | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (data.inviterName !== undefined) updateData.inviterName = data.inviterName;
    if (data.inviteeName !== undefined) updateData.inviteeName = data.inviteeName;
    if (data.ticketId !== undefined) updateData.ticketId = data.ticketId;
    if (data.inviterId !== undefined) updateData.inviterId = data.inviterId;
    if (data.inviteeId !== undefined) updateData.inviteeId = data.inviteeId;

    // Inviter change re-derives type + indirect chain (same rule as creation:
    // hardcoded special list; normal inviters walk the ancestor chain).
    if (data.inviterId !== undefined && data.inviterId !== current.inviterId) {
      const SPECIAL_INVITER_IDS = [
        '582595416294555649',
        '1202294567706316911',
        '1506900129792135211',
      ];
      const newType = SPECIAL_INVITER_IDS.includes(newInviterId) ? 'special' : 'normal';
      updateData.inviterType = newType;
      updateData.indirectSpecialInviterId =
        newType === 'normal' ? await resolveIndirectSpecialInviterId(newInviterId) : null;
    }

    await referralRepository.update(referralId, updateData);

    const updated = await referralRepository.findById(referralId);
    if (!updated) throw new Error('Referral not found after update.');

    await auditLogService.log(
      AuditAction.REFERRAL_UPDATED,
      null,
      updatedBy,
      `Referral ${referralId} updated — ${updateData.inviterName ?? ''} → ${updateData.inviteeName ?? ''}`,
    );

    logger.info('Referral updated', { referralId });
    return toReferral(updated);
  }

  async deleteReferral(referralId: string, deletedBy: string): Promise<void> {
    const ref = await referralRepository.findById(referralId);
    if (!ref) throw new Error('Referral not found.');

    await referralRepository.delete(referralId);

    await auditLogService.log(
      AuditAction.REFERRAL_REMOVED,
      null,
      deletedBy,
      `Referral ${referralId} removed`,
    );

    logger.info('Referral deleted', { referralId });
  }

  async computeReferralStatus(
    ref: Referral,
    rates: CommissionRates,
    weekStart?: Date,
    weekEnd?: Date,
  ): Promise<{
    isSuccessful: boolean;
    taskCount: number;
    posts: number;
    comments: number;
    bonusAmount: number;
    perTaskAmount: number;
  }> {
    if (ref.status === 'closed') {
      return { isSuccessful: false, taskCount: 0, posts: 0, comments: 0, bonusAmount: 0, perTaskAmount: 0 };
    }

    const tasks = await this.getCompletedTasksForUser(ref.inviteeId, weekStart, weekEnd);
    const posts = tasks.filter((t) => t.type === TaskType.POST).length;
    const comments = tasks.filter((t) => t.type === TaskType.COMMENT).length;
    const taskCount = tasks.length;

    const threshold = ref.inviterType === 'special'
      ? rates.specialInviteTaskThreshold
      : rates.normalInviteTaskThreshold;

    const thresholdMet = taskCount >= threshold;
    let bonusAmount = 0;
    let perTaskAmount = 0;

    if (thresholdMet && !ref.oneTimeCommissionPaid) {
      bonusAmount = ref.inviterType === 'special'
        ? rates.specialInviteBonus
        : rates.normalInviteBonus;
    }

    if (ref.perTaskCommissionActive || (thresholdMet && ref.inviterType === 'special')) {
      perTaskAmount = posts * rates.specialPerPost + comments * rates.specialPerComment;
    }

    return {
      isSuccessful: thresholdMet,
      taskCount,
      posts,
      comments,
      bonusAmount,
      perTaskAmount,
    };
  }

  async hasExistingOneTimeCommission(referralId: string, inviterId: string): Promise<boolean> {
    const item = await commissionRepository.findOneTimeCommission(referralId, inviterId);
    return item !== null;
  }

  async hasExistingPerTaskCommission(inviterId: string, sourceTaskId: string): Promise<boolean> {
    const item = await commissionRepository.findPerTaskCommission(inviterId, sourceTaskId);
    return item !== null;
  }

  async hasExistingIndirectPerTaskCommission(inviterId: string, sourceTaskId: string): Promise<boolean> {
    const item = await commissionRepository.findIndirectPerTaskCommission(inviterId, sourceTaskId);
    return item !== null;
  }

  async getPaidCommissionAmountsByReferral(): Promise<Map<string, { total: number; bonus: number; perTask: number; paid: boolean }>> {
    const items = await commissionRepository.findAllItems();
    const map = new Map<string, { total: number; bonus: number; perTask: number; paid: boolean }>();

    for (const data of items) {
      const refId = data.referralId;
      const inviterId = data.inviterId;
      const key = `${refId}_${inviterId}`;
      const amount = data.amount;
      const kind = data.commissionKind;

      const existing = map.get(key) || { total: 0, bonus: 0, perTask: 0, paid: true };
      existing.total += amount;
      if (kind === 'one_time') existing.bonus += amount;
      else existing.perTask += amount;
      map.set(key, existing);
    }

    return map;
  }

  async getPayableItems(ref: Referral, rates: CommissionRates): Promise<{
    commissionKind: CommissionKind;
    amount: number;
    sourceTaskId: string | null;
  }[]> {
    const items: { commissionKind: CommissionKind; amount: number; sourceTaskId: string | null }[] = [];

    if (ref.status === 'closed') return items;

    const threshold = ref.inviterType === 'special'
      ? rates.specialInviteTaskThreshold
      : rates.normalInviteTaskThreshold;

    const payableOneTime = !ref.oneTimeCommissionPaid;
    const meetsThreshold = (await this.getCompletedTasksForUser(ref.inviteeId)).length >= threshold;
    const perTaskActive = ref.perTaskCommissionActive ||
      (ref.inviterType === 'special' && payableOneTime && meetsThreshold);

    if (payableOneTime && meetsThreshold) {
      const bonusAmount = ref.inviterType === 'special'
        ? rates.specialInviteBonus
        : rates.normalInviteBonus;
      if (bonusAmount > 0) {
        const existing = await this.hasExistingOneTimeCommission(ref.id, ref.inviterId);
        if (!existing) {
          items.push({ commissionKind: 'one_time', amount: bonusAmount, sourceTaskId: null });
        }
      }
    }

    if (perTaskActive && ref.inviterType === 'special') {
      const tasks = await this.getTasksForReferral(ref);
      for (const task of tasks) {
        const amount = task.type === TaskType.POST ? rates.specialPerPost : rates.specialPerComment;
        if (amount > 0) {
          const existing = await this.hasExistingPerTaskCommission(ref.inviterId, task.id);
          if (!existing) {
            items.push({ commissionKind: 'per_task', amount, sourceTaskId: task.id });
          }
        }
      }
    }

    return items;
  }

  /**
   * Compute indirect per-task commissions for a special inviter.
   * For each referral where indirectSpecialInviterId === specialInviterId,
   * the special inviter earns per-task commissions on the invitee's completed tasks.
   * No one-time bonus. Threshold is the special invite threshold (default 1).
   */
  async getIndirectPayableItems(specialInviterId: string, rates: CommissionRates): Promise<{
    commissionKind: CommissionKind;
    amount: number;
    sourceTaskId: string | null;
    referralId: string;
    invitedWorkerId: string;
  }[]> {
    const indirectRefs = await referralRepository.findByIndirectSpecialInviterId(specialInviterId);
    const items: { commissionKind: CommissionKind; amount: number; sourceTaskId: string | null; referralId: string; invitedWorkerId: string }[] = [];

    for (const raw of indirectRefs) {
      const ref = toReferral(raw as any);
      if (ref.status === 'closed') continue;

      // Use special threshold (default 1) for indirect commissions
      const tasks = await this.getTasksForReferral(ref);
      if (tasks.length < rates.specialInviteTaskThreshold) continue;

      for (const task of tasks) {
        const amount = task.type === TaskType.POST ? rates.specialPerPost : rates.specialPerComment;
        if (amount > 0) {
          const existing = await this.hasExistingIndirectPerTaskCommission(specialInviterId, task.id);
          if (!existing) {
            items.push({
              commissionKind: 'per_task_indirect',
              amount,
              sourceTaskId: task.id,
              referralId: ref.id,
              invitedWorkerId: ref.inviteeId,
            });
          }
        }
      }
    }

    return items;
  }

  async getSummary(_weekStart?: Date, _weekEnd?: Date): Promise<{
    totalInviters: number;
    totalSuccessfulInvites: number;
    totalCommission: number;
    totalBonusAmount: number;
    totalPerTaskAmount: number;
    alreadyPaidCommission: number;
  }> {
    const referrals = await this.getReferrals();
    const rates = await this.getCommissionRates();

    const activeReferrals = referrals.filter((r) => r.status !== 'closed');
    const paidItems = await commissionRepository.findAllItems();
    const alreadyPaidCommission = paidItems.reduce((sum, i) => sum + i.amount, 0);

    const inviterSet = new Set<string>();
    let totalSuccessfulInvites = 0;
    let totalBonusAmount = 0;
    let totalPerTaskAmount = 0;

    for (const referral of activeReferrals) {
      const payableItems = await this.getPayableItems(referral, rates);
      if (payableItems.length > 0) {
        inviterSet.add(referral.inviterId);
        totalSuccessfulInvites++;
        for (const item of payableItems) {
          if (item.commissionKind === 'one_time') totalBonusAmount += item.amount;
          else totalPerTaskAmount += item.amount;
        }
      }
    }

    // Include indirect commissions for special inviters
    const specialInviterIds = new Set<string>();
    for (const ref of activeReferrals) {
      if (ref.indirectSpecialInviterId) {
        specialInviterIds.add(ref.indirectSpecialInviterId);
      }
    }
    for (const specialInviterId of specialInviterIds) {
      const indirectItems = await this.getIndirectPayableItems(specialInviterId, rates);
      if (indirectItems.length > 0) {
        inviterSet.add(specialInviterId);
        for (const item of indirectItems) {
          totalPerTaskAmount += item.amount;
        }
      }
    }

    return {
      totalInviters: inviterSet.size,
      totalSuccessfulInvites,
      totalCommission: totalBonusAmount + totalPerTaskAmount,
      totalBonusAmount,
      totalPerTaskAmount,
      alreadyPaidCommission,
    };
  }

  async getBreakdown(_weekStart?: Date, _weekEnd?: Date): Promise<{
    inviterId: string;
    inviterName: string;
    inviterType: InviterType;
    totalReferrals: number;
    successfulReferrals: number;
    totalCommission: number;
    status: 'Ready' | 'Paid';
  }[]> {
    const referrals = await this.getReferrals();
    const rates = await this.getCommissionRates();

    const inviterMap = new Map<string, {
      inviterName: string;
      inviterType: InviterType;
      referrals: Referral[];
    }>();

    for (const ref of referrals) {
      if (ref.status === 'closed') continue;
      const existing = inviterMap.get(ref.inviterId) || {
        inviterName: ref.inviterName,
        inviterType: ref.inviterType,
        referrals: [],
      };
      existing.referrals.push(ref);
      inviterMap.set(ref.inviterId, existing);
    }

    const result: {
      inviterId: string;
      inviterName: string;
      inviterType: InviterType;
      totalReferrals: number;
      successfulReferrals: number;
      totalCommission: number;
      status: 'Ready' | 'Paid';
    }[] = [];

    for (const [inviterId, data] of inviterMap) {
      let totalCommission = 0;
      let activeReferrals = 0;

      for (const ref of data.referrals) {
        const payableItems = await this.getPayableItems(ref, rates);
        if (payableItems.length > 0) {
          activeReferrals++;
          for (const item of payableItems) {
            totalCommission += item.amount;
          }
        }
      }

      // Add indirect commissions for special inviters
      if (data.inviterType === 'special') {
        const indirectItems = await this.getIndirectPayableItems(inviterId, rates);
        for (const item of indirectItems) {
          totalCommission += item.amount;
        }
      }

      result.push({
        inviterId,
        inviterName: data.inviterName,
        inviterType: data.inviterType,
        totalReferrals: data.referrals.length,
        successfulReferrals: activeReferrals,
        totalCommission,
        status: 'Ready',
      });
    }

    result.sort((a, b) => b.totalCommission - a.totalCommission);

    return result;
  }

  async getInviterDetail(inviterId: string, weekStart?: Date, weekEnd?: Date): Promise<{
    inviterName: string;
    inviterType: InviterType;
    status: 'Ready' | 'Paid';
    referrals: {
      referralId: string;
      inviteeName: string;
      inviteeTasks: { total: number; posts: number; comments: number };
      bonusAmount: number;
      perTaskAmount: number;
      isSuccessful: boolean;
      bonusPaid: boolean;
    }[];
    totalBonus: number;
    totalPerTask: number;
    totalCommission: number;
  } | null> {
    const referrals = await referralRepository.findByInviterId(inviterId);

    if (referrals.length === 0) return null;

    const refs = referrals.map(toReferral).filter((r) => r.status !== 'closed');
    if (refs.length === 0) return null;

    const rates = await this.getCommissionRates();

    let totalBonus = 0;
    let totalPerTask = 0;

    const referralDetails = [];
    for (const ref of refs) {
      const payableItems = await this.getPayableItems(ref, rates);
      if (payableItems.length === 0) continue;

      const status = await this.computeReferralStatus(ref, rates, weekStart, weekEnd);

      const bonusAmount = payableItems
        .filter((i) => i.commissionKind === 'one_time')
        .reduce((sum, i) => sum + i.amount, 0);
      const perTaskAmount = payableItems
        .filter((i) => i.commissionKind === 'per_task')
        .reduce((sum, i) => sum + i.amount, 0);

      referralDetails.push({
        referralId: ref.id,
        inviteeName: ref.inviteeName,
        inviteeTasks: { total: status.taskCount, posts: status.posts, comments: status.comments },
        bonusAmount,
        perTaskAmount,
        isSuccessful: true,
        bonusPaid: false,
      });

      totalBonus += bonusAmount;
      totalPerTask += perTaskAmount;
    }

    // Include indirect commissions for special inviters
    if (refs[0].inviterType === 'special') {
      const indirectRefs = await referralRepository.findByIndirectSpecialInviterId(inviterId);
      for (const raw of indirectRefs) {
        const indRef = toReferral(raw as any);
        if (indRef.status === 'closed') continue;

        const tasks = await this.getTasksForReferral(indRef);
        if (tasks.length < rates.specialInviteTaskThreshold) continue;

        let indirectPerTask = 0;
        for (const task of tasks) {
          const amount = task.type === TaskType.POST ? rates.specialPerPost : rates.specialPerComment;
          if (amount > 0) {
            const existing = await this.hasExistingIndirectPerTaskCommission(inviterId, task.id);
            if (!existing) {
              indirectPerTask += amount;
            }
          }
        }

        if (indirectPerTask > 0) {
          const posts = tasks.filter((t) => t.type === TaskType.POST).length;
          const comments = tasks.filter((t) => t.type === TaskType.COMMENT).length;
          referralDetails.push({
            referralId: indRef.id,
            inviteeName: `${indRef.inviteeName} (indirect)`,
            inviteeTasks: { total: tasks.length, posts, comments },
            bonusAmount: 0,
            perTaskAmount: indirectPerTask,
            isSuccessful: true,
            bonusPaid: false,
          });
          totalPerTask += indirectPerTask;
        }
      }
    }

    if (referralDetails.length === 0) return null;

    return {
      inviterName: refs[0].inviterName,
      inviterType: refs[0].inviterType,
      status: 'Ready',
      referrals: referralDetails,
      totalBonus,
      totalPerTask,
      totalCommission: totalBonus + totalPerTask,
    };
  }

  private getCurrentPayoutWeek(): { weekStart: Date; weekEnd: Date } {
    const now = new Date();
    const istNow = new Date(now.getTime() + IST_OFFSET_MS);

    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();
    const dayOfWeek = istNow.getUTCDay();

    const sundayIST = new Date(Date.UTC(year, month, day - dayOfWeek, 0, 0, 0, 0));
    const saturdayIST = new Date(Date.UTC(year, month, day - dayOfWeek + 6, 23, 59, 59, 999));

    return {
      weekStart: new Date(sundayIST.getTime() - IST_OFFSET_MS),
      weekEnd: new Date(saturdayIST.getTime() - IST_OFFSET_MS),
    };
  }

  private async getOrCreateCommissionBatch(): Promise<CommissionBatch> {
    const latest = await commissionRepository.findLatestBatch();
    const nextNumber = latest ? latest.batchNumber + 1 : 1;
    const { weekStart, weekEnd } = this.getCurrentPayoutWeek();

    const now = new Date();
    const batch: CommissionBatch = {
      id: generateBatchId(),
      batchNumber: nextNumber,
      weekStart,
      weekEnd,
      totalInviters: 0,
      totalAmount: 0,
      paidAt: now,
      createdAt: now,
    };

    await commissionRepository.createBatch({
      id: batch.id,
      batchNumber: batch.batchNumber,
      weekStart: batch.weekStart,
      weekEnd: batch.weekEnd,
      totalInviters: batch.totalInviters,
      totalAmount: batch.totalAmount,
      paidAt: batch.paidAt,
      createdAt: batch.createdAt,
    });

    return batch;
  }

  async payInviter(inviterId: string, createdBy: string): Promise<{ batch: CommissionBatch; items: CommissionItem[] }> {
    const referrals = await referralRepository.findByInviterId(inviterId);

    if (referrals.length === 0) throw new Error('No referrals found for this inviter.');

    const refs = referrals.map(toReferral).filter((r) => r.status !== 'closed');
    if (refs.length === 0) throw new Error('No active referrals found for this inviter.');

    const rates = await this.getCommissionRates();
    const items: CommissionItem[] = [];
    const now = new Date();
    let totalAmount = 0;

    for (const ref of refs) {
      const payableItems = await this.getPayableItems(ref, rates);
      if (payableItems.length === 0) continue;

      const hasOneTime = payableItems.some((pi) => pi.commissionKind === 'one_time');

      for (const pi of payableItems) {
        items.push({
          id: generateCommissionItemId(),
          batchId: '',
          referralId: ref.id,
          inviterId,
          invitedWorkerId: ref.inviteeId,
          sourceTaskId: pi.sourceTaskId,
          commissionKind: pi.commissionKind,
          amount: pi.amount,
          createdAt: now,
        });
        totalAmount += pi.amount;
      }

      if (hasOneTime) {
        const updateData: any = {
          oneTimeCommissionPaid: true,
          oneTimeCommissionPaidAt: now,
          updatedAt: now,
        };
        if (ref.inviterType === 'special') {
          updateData.perTaskCommissionActive = true;
          updateData.status = 'active_per_task';
        } else {
          updateData.status = 'qualified';
        }
        await referralRepository.update(ref.id, updateData);
      }
    }

    // Collect indirect commissions for special inviters
    if (refs[0].inviterType === 'special') {
      const indirectItems = await this.getIndirectPayableItems(inviterId, rates);
      for (const pi of indirectItems) {
        items.push({
          id: generateCommissionItemId(),
          batchId: '',
          referralId: pi.referralId,
          inviterId,
          invitedWorkerId: pi.invitedWorkerId,
          sourceTaskId: pi.sourceTaskId,
          commissionKind: pi.commissionKind,
          amount: pi.amount,
          createdAt: now,
        });
        totalAmount += pi.amount;
      }
    }

    if (items.length === 0) {
      throw new Error('No unpaid commissions available for this inviter.');
    }

    const batch = await this.getOrCreateCommissionBatch();

    const db = getDb();
    await db.$transaction(async (tx: any) => {
      for (const item of items) {
        item.batchId = batch.id;
        await tx.commissionItem.create({
          data: {
            id: item.id, batchId: item.batchId, referralId: item.referralId,
            inviterId: item.inviterId, invitedWorkerId: item.invitedWorkerId,
            sourceTaskId: item.sourceTaskId, commissionKind: item.commissionKind,
            amount: item.amount, createdAt: item.createdAt,
          },
        });
      }

      await tx.commissionBatch.update({
        where: { id: batch.id },
        data: { totalInviters: 1, totalAmount },
      });
    });

    batch.totalInviters = 1;
    batch.totalAmount = totalAmount;

    await auditLogService.log(
      AuditAction.COMMISSION_PAID,
      null,
      createdBy,
      `Commission paid for inviter ${inviterId} — Batch #${batch.batchNumber}, ₹${totalAmount}`,
    );

    logger.info('Inviter commission paid', { inviterId, batchId: batch.id, amount: totalAmount });

    return { batch, items };
  }

  async payAll(createdBy: string): Promise<{ batch: CommissionBatch; items: CommissionItem[] }> {
    const referrals = (await this.getReferrals()).filter((r) => r.status !== 'closed');
    const rates = await this.getCommissionRates();

    const uniqueInviters = [...new Set(referrals.map((r) => r.inviterId))];
    const items: CommissionItem[] = [];
    const now = new Date();
    let totalAmount = 0;
    let invitersPaid = 0;

    for (const inviterId of uniqueInviters) {
      const inviterRefs = referrals.filter((r) => r.inviterId === inviterId);
      if (inviterRefs.length === 0) continue;

      let inviterAmount = 0;
      const inviterItems: CommissionItem[] = [];

      for (const ref of inviterRefs) {
        const payableItems = await this.getPayableItems(ref, rates);
        if (payableItems.length === 0) continue;

        const hasOneTime = payableItems.some((pi) => pi.commissionKind === 'one_time');

        for (const pi of payableItems) {
          inviterItems.push({
            id: generateCommissionItemId(),
            batchId: '',
            referralId: ref.id,
            inviterId,
            invitedWorkerId: ref.inviteeId,
            sourceTaskId: pi.sourceTaskId,
            commissionKind: pi.commissionKind,
            amount: pi.amount,
            createdAt: now,
          });
          inviterAmount += pi.amount;
        }

        if (hasOneTime) {
          const updateData: any = {
            oneTimeCommissionPaid: true,
            oneTimeCommissionPaidAt: now,
            updatedAt: now,
          };
          if (ref.inviterType === 'special') {
            updateData.perTaskCommissionActive = true;
            updateData.status = 'active_per_task';
          } else {
            updateData.status = 'qualified';
          }
          await referralRepository.update(ref.id, updateData);
        }
      }

      if (inviterItems.length > 0) {
        items.push(...inviterItems);
        totalAmount += inviterAmount;
        invitersPaid++;
      }
    }

    // Collect indirect commissions for special inviters
    const specialInviterIdsWithIndirect = new Set<string>();
    for (const ref of referrals) {
      if (ref.indirectSpecialInviterId) {
        specialInviterIdsWithIndirect.add(ref.indirectSpecialInviterId);
      }
    }
    for (const specialInviterId of specialInviterIdsWithIndirect) {
      const indirectItems = await this.getIndirectPayableItems(specialInviterId, rates);
      if (indirectItems.length > 0) {
        let indirectAmount = 0;
        for (const pi of indirectItems) {
          items.push({
            id: generateCommissionItemId(),
            batchId: '',
            referralId: pi.referralId,
            inviterId: specialInviterId,
            invitedWorkerId: pi.invitedWorkerId,
            sourceTaskId: pi.sourceTaskId,
            commissionKind: pi.commissionKind,
            amount: pi.amount,
            createdAt: now,
          });
          indirectAmount += pi.amount;
        }
        totalAmount += indirectAmount;
        // Only count as a new paid inviter if not already counted in direct payouts
        if (!uniqueInviters.includes(specialInviterId) || !items.some((i) => i.inviterId === specialInviterId && i.commissionKind !== 'per_task_indirect')) {
          invitersPaid++;
        }
      }
    }

    if (items.length === 0) {
      throw new Error('No unpaid commissions available.');
    }

    const batch = await this.getOrCreateCommissionBatch();

    const db = getDb();
    await db.$transaction(async (tx: any) => {
      for (const item of items) {
        item.batchId = batch.id;
        await tx.commissionItem.create({
          data: {
            id: item.id, batchId: item.batchId, referralId: item.referralId,
            inviterId: item.inviterId, invitedWorkerId: item.invitedWorkerId,
            sourceTaskId: item.sourceTaskId, commissionKind: item.commissionKind,
            amount: item.amount, createdAt: item.createdAt,
          },
        });
      }

      await tx.commissionBatch.update({
        where: { id: batch.id },
        data: { totalInviters: invitersPaid, totalAmount },
      });
    });

    batch.totalInviters = invitersPaid;
    batch.totalAmount = totalAmount;

    await auditLogService.log(
      AuditAction.COMMISSION_BATCH_CREATED,
      null,
      createdBy,
      `Commission Batch #${batch.batchNumber} — ${items.length} items, ₹${totalAmount}, ${invitersPaid} inviters`,
    );

    logger.info('All commissions paid', {
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      items: items.length,
      amount: totalAmount,
      inviters: invitersPaid,
    });

    return { batch, items };
  }

  async getCommissionExportData(batchId?: string, weekStart?: Date, weekEnd?: Date): Promise<{
    rows: {
      inviterName: string;
      inviterType: string;
      inviteeName: string;
      bonusAmount: number;
      perTaskAmount: number;
      totalCommission: number;
      status: string;
    }[];
  }> {
    if (batchId) {
      const items = await commissionRepository.findItemsByBatchId(batchId);
      const referrals = await this.getReferrals();
      const refMap = new Map(referrals.map((r) => [r.id, r]));

      const rows = items.map((item) => {
        const ref = refMap.get(item.referralId);
        return {
          inviterName: ref?.inviterName || item.inviterId.slice(0, 8),
          inviterType: ref?.inviterType || 'normal',
          inviteeName: ref?.inviteeName || item.invitedWorkerId.slice(0, 8),
          bonusAmount: item.commissionKind === 'one_time' ? item.amount : 0,
          perTaskAmount: (item.commissionKind === 'per_task' || item.commissionKind === 'per_task_indirect') ? item.amount : 0,
          totalCommission: item.amount,
          status: 'Paid',
        };
      });

      return { rows };
    }

    const breakdown = await this.getBreakdown(weekStart, weekEnd);
    const referrals = await this.getReferrals();
    const rates = await this.getCommissionRates();

    const rows = [];
    for (const inv of breakdown) {
      const invReferrals = referrals.filter((r) => r.inviterId === inv.inviterId && r.status !== 'closed');
      for (const ref of invReferrals) {
        const status = await this.computeReferralStatus(ref, rates, weekStart, weekEnd);
        rows.push({
          inviterName: inv.inviterName,
          inviterType: inv.inviterType,
          inviteeName: ref.inviteeName,
          bonusAmount: status.isSuccessful ? status.bonusAmount : 0,
          perTaskAmount: status.isSuccessful ? status.perTaskAmount : 0,
          totalCommission: status.isSuccessful ? status.bonusAmount + status.perTaskAmount : 0,
          status: inv.status,
        });
      }
    }

    return { rows };
  }

  async getItemsByBatchId(batchId: string): Promise<CommissionItem[]> {
    const items = await commissionRepository.findItemsByBatchId(batchId);
    return items.map((i) => ({
      id: i.id, batchId: i.batchId, referralId: i.referralId,
      inviterId: i.inviterId, invitedWorkerId: i.invitedWorkerId,
      sourceTaskId: i.sourceTaskId, commissionKind: i.commissionKind as CommissionKind,
      amount: i.amount, createdAt: i.createdAt,
    }));
  }

  async getBatchHistory(limit = 20): Promise<CommissionBatch[]> {
    const batches = await commissionRepository.findBatchHistory(limit);
    return batches.map(toCommissionBatch);
  }

  async getBatchDetail(batchId: string): Promise<{
    batch: CommissionBatch;
    items: {
      id: string;
      inviterName: string;
      inviterType: InviterType;
      inviteeName: string;
      bonusAmount: number;
      perTaskAmount: number;
      totalCommission: number;
    }[];
  } | null> {
    const batch = await commissionRepository.findBatchById(batchId);
    if (!batch) return null;

    const items = await commissionRepository.findItemsByBatchId(batchId);
    const referrals = await this.getReferrals();
    const refMap = new Map(referrals.map((r) => [r.id, r]));

    const enrichedItems = items.map((item) => {
      const ref = refMap.get(item.referralId);
      return {
        id: item.id,
        inviterName: ref?.inviterName || item.inviterId.slice(0, 8),
        inviterType: (ref?.inviterType || 'normal') as InviterType,
        inviteeName: ref?.inviteeName || item.invitedWorkerId.slice(0, 8),
        bonusAmount: item.commissionKind === 'one_time' ? item.amount : 0,
        perTaskAmount: (item.commissionKind === 'per_task' || item.commissionKind === 'per_task_indirect') ? item.amount : 0,
        totalCommission: item.amount,
      };
    });

    return { batch: toCommissionBatch(batch), items: enrichedItems };
  }
}

export const commissionService = new CommissionService();
