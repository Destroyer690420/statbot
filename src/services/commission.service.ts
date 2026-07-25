import {
  Task,
  TaskStatus,
  TaskType,
  Referral,
  ReferralStatus,
  InviterType,
  CommissionItem,
  CommissionKind,
  CommissionBatch,
  CommissionRates,
  AuditAction,
} from '../types';
import {
  referralsCollection,
  commissionItemsCollection,
  commissionBatchesCollection,
  tasksCollection,
  settingsCollection,
  toDate,
  toTimestamp,
} from '../database/firebase';
import { generateReferralId, generateCommissionBatchId, generateCommissionItemId } from '../utils/id-generator';
import { auditLogService } from './audit.service';
import { logger } from '../utils/logger';

const COMMISSION_RATES_DOC_ID = 'commission-rates';

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
  // ─── Rates ─────────────────────────────────────────────────────

  async getCommissionRates(): Promise<CommissionRates> {
    try {
      const doc = await settingsCollection().doc(COMMISSION_RATES_DOC_ID).get();
      if (!doc.exists) return { ...DEFAULT_RATES };
      const data = doc.data()!;
      return {
        normalInviteBonus: data.normalInviteBonus ?? DEFAULT_RATES.normalInviteBonus,
        normalInviteTaskThreshold: data.normalInviteTaskThreshold ?? DEFAULT_RATES.normalInviteTaskThreshold,
        specialInviteBonus: data.specialInviteBonus ?? DEFAULT_RATES.specialInviteBonus,
        specialInviteTaskThreshold: data.specialInviteTaskThreshold ?? DEFAULT_RATES.specialInviteTaskThreshold,
        specialPerComment: data.specialPerComment ?? DEFAULT_RATES.specialPerComment,
        specialPerPost: data.specialPerPost ?? DEFAULT_RATES.specialPerPost,
        updatedAt: toDate(data.updatedAt) || new Date(),
        updatedBy: data.updatedBy || 'system',
      };
    } catch (error) {
      logger.error('Failed to read commission rates, using defaults', { error });
      return { ...DEFAULT_RATES };
    }
  }

  async updateCommissionRates(rates: Omit<CommissionRates, 'updatedAt' | 'updatedBy'>, userId: string): Promise<void> {
    await settingsCollection().doc(COMMISSION_RATES_DOC_ID).set({
      ...rates,
      updatedAt: toTimestamp(new Date()),
      updatedBy: userId,
    });
    logger.info('Commission rates updated', { rates, userId });
  }

  // ─── Helpers ───────────────────────────────────────────────────

  private async getCompletedTasksForUser(userId: string, weekStart?: Date, weekEnd?: Date): Promise<Task[]> {
    const statuses = [TaskStatus.COMPLETED, TaskStatus.ARCHIVED];
    const all: Task[] = [];
    for (const status of statuses) {
      const snapshot = await tasksCollection()
        .where('assignedUserId', '==', userId)
        .where('status', '==', status)
        .get();
      for (const doc of snapshot.docs) {
        const task = this.docToTask(doc);
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
    const statuses = [TaskStatus.COMPLETED, TaskStatus.ARCHIVED];
    const all: Task[] = [];
    for (const status of statuses) {
      const snapshot = await tasksCollection()
        .where('channelName', '==', channelName)
        .where('status', '==', status)
        .get();
      for (const doc of snapshot.docs) {
        const task = this.docToTask(doc);
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
    const { reminderService } = await import('./reminder.service');
    const reminders = await reminderService.findByTaskId(taskId);
    const completed = reminders
      .filter((r) => r.completed && r.completedAt)
      .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());

    if (completed[0]?.completedAt) return completed[0].completedAt;

    const task = await tasksCollection().doc(taskId).get();
    if (!task.exists) return null;
    return toDate(task.data()!.updatedAt);
  }

  // ─── Referral CRUD ────────────────────────────────────────────

  async getReferrals(): Promise<Referral[]> {
    const snapshot = await referralsCollection().orderBy('createdAt', 'desc').get();
    return snapshot.docs.map((doc) => this.docToReferral(doc));
  }

  async createReferral(data: {
    inviterId: string;
    inviterName: string;
    inviteeId: string;
    inviteeName: string;
    inviterType: InviterType;
    ticketId?: string;
  }, createdBy: string): Promise<Referral> {
    const existing = await referralsCollection()
      .where('inviteeId', '==', data.inviteeId)
      .where('inviterId', '==', data.inviterId)
      .limit(1)
      .get();

    if (!existing.empty) {
      throw new Error(`A referral already exists for invitee <@${data.inviteeId}>.`);
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
      createdAt: now,
      updatedAt: now,
    };

    await referralsCollection().doc(referral.id).set(this.serializeReferral(referral));

    await auditLogService.log(
      AuditAction.REFERRAL_ADDED,
      null,
      createdBy,
      `Referral ${referral.id} — ${data.inviterName} → ${data.inviteeName} (${data.inviterType})`,
    );

    logger.info('Referral created', { referralId: referral.id });
    return referral;
  }

  async deleteReferral(referralId: string, deletedBy: string): Promise<void> {
    const doc = await referralsCollection().doc(referralId).get();
    if (!doc.exists) throw new Error('Referral not found.');

    await referralsCollection().doc(referralId).delete();

    await auditLogService.log(
      AuditAction.REFERRAL_REMOVED,
      null,
      deletedBy,
      `Referral ${referralId} removed`,
    );

    logger.info('Referral deleted', { referralId });
  }

  // ─── Commission Computation ──────────────────────────────────

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

  // ─── Duplicate Protection ─────────────────────────────────────

  async hasExistingOneTimeCommission(referralId: string, inviterId: string): Promise<boolean> {
    const snapshot = await commissionItemsCollection()
      .where('referralId', '==', referralId)
      .where('inviterId', '==', inviterId)
      .where('commissionKind', '==', 'one_time')
      .limit(1)
      .get();
    return !snapshot.empty;
  }

  async hasExistingPerTaskCommission(inviterId: string, sourceTaskId: string): Promise<boolean> {
    const snapshot = await commissionItemsCollection()
      .where('inviterId', '==', inviterId)
      .where('sourceTaskId', '==', sourceTaskId)
      .where('commissionKind', '==', 'per_task')
      .limit(1)
      .get();
    return !snapshot.empty;
  }

  async getPaidCommissionAmountsByReferral(): Promise<Map<string, { total: number; bonus: number; perTask: number; paid: boolean }>> {
    const snapshot = await commissionItemsCollection().get();
    const map = new Map<string, { total: number; bonus: number; perTask: number; paid: boolean }>();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const refId = data.referralId as string;
      const inviterId = data.inviterId as string;
      const key = `${refId}_${inviterId}`;
      const amount = data.amount as number;
      const kind = (data.commissionKind || data.type) as string;

      const existing = map.get(key) || { total: 0, bonus: 0, perTask: 0, paid: true };
      existing.total += amount;
      if (kind === 'one_time' || kind === 'bonus') existing.bonus += amount;
      else existing.perTask += amount;
      map.set(key, existing);
    }

    return map;
  }

  // ─── Payable Items (for payout engine) ────────────────────────

  async getPayableItems(ref: Referral, rates: CommissionRates): Promise<{
    commissionKind: CommissionKind;
    amount: number;
    sourceTaskId: string | null;
  }[]> {
    const items: { commissionKind: CommissionKind; amount: number; sourceTaskId: string | null }[] = [];

    if (ref.status === 'closed') return items;

    // One-time bonus
    if (!ref.oneTimeCommissionPaid) {
      const threshold = ref.inviterType === 'special'
        ? rates.specialInviteTaskThreshold
        : rates.normalInviteTaskThreshold;
      const tasks = await this.getCompletedTasksForUser(ref.inviteeId);
      if (tasks.length >= threshold) {
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
    }

    // Per-task commission
    if (ref.perTaskCommissionActive && ref.inviterType === 'special') {
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

  // ─── Summary & Breakdown ──────────────────────────────────────

  async getSummary(weekStart?: Date, weekEnd?: Date): Promise<{
    totalInviters: number;
    totalSuccessfulInvites: number;
    totalCommission: number;
    totalBonusAmount: number;
    totalPerTaskAmount: number;
    alreadyPaidCommission: number;
  }> {
    const referrals = await this.getReferrals();
    const rates = await this.getCommissionRates();
    const paidByInviter = await this.getPaidAmountsByInviter();

    const activeReferrals = referrals.filter((r) => r.status !== 'closed');
    const uniqueInviters = new Set(activeReferrals.map((r) => r.inviterId));
    let totalSuccessfulInvites = 0;
    let totalBonusAmount = 0;
    let totalPerTaskAmount = 0;
    let alreadyPaidCommission = 0;

    for (const referral of activeReferrals) {
      const status = await this.computeReferralStatus(referral, rates, weekStart, weekEnd);
      if (status.isSuccessful) {
        totalSuccessfulInvites++;
        totalBonusAmount += status.bonusAmount;
        totalPerTaskAmount += status.perTaskAmount;
      }
    }

    for (const amount of paidByInviter.values()) {
      alreadyPaidCommission += amount;
    }

    return {
      totalInviters: uniqueInviters.size,
      totalSuccessfulInvites,
      totalCommission: totalBonusAmount + totalPerTaskAmount,
      totalBonusAmount,
      totalPerTaskAmount,
      alreadyPaidCommission,
    };
  }

  private async getPaidAmountsByInviter(): Promise<Map<string, number>> {
    const snapshot = await commissionItemsCollection().get();
    const map = new Map<string, number>();
    for (const doc of snapshot.docs) {
      const inviterId = doc.data().inviterId as string;
      const amount = doc.data().amount as number;
      map.set(inviterId, (map.get(inviterId) || 0) + amount);
    }
    return map;
  }

  async getBreakdown(weekStart?: Date, weekEnd?: Date): Promise<{
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
    const paidByReferral = await this.getPaidCommissionAmountsByReferral();

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
      let successfulReferrals = 0;
      let totalCommission = 0;
      let allPaid = true;
      let anySuccessful = false;

      for (const ref of data.referrals) {
        const status = await this.computeReferralStatus(ref, rates, weekStart, weekEnd);
        if (status.isSuccessful) {
          successfulReferrals++;
          totalCommission += status.bonusAmount + status.perTaskAmount;
          anySuccessful = true;

          const paidKey = `${ref.id}_${inviterId}`;
          const paidInfo = paidByReferral.get(paidKey);
          if (!paidInfo?.paid) allPaid = false;
        }
      }

      if (!anySuccessful) continue;

      result.push({
        inviterId,
        inviterName: data.inviterName,
        inviterType: data.inviterType,
        totalReferrals: data.referrals.length,
        successfulReferrals,
        totalCommission,
        status: allPaid ? 'Paid' : 'Ready',
      });
    }

    result.sort((a, b) => {
      if (a.status === b.status) return b.totalCommission - a.totalCommission;
      return a.status === 'Ready' ? -1 : 1;
    });

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
    const snapshot = await referralsCollection()
      .where('inviterId', '==', inviterId)
      .get();

    if (snapshot.empty) return null;

    const referrals: Referral[] = snapshot.docs
      .map((doc) => this.docToReferral(doc))
      .filter((r) => r.status !== 'closed');

    if (referrals.length === 0) return null;

    const rates = await this.getCommissionRates();
    const paidByReferral = await this.getPaidCommissionAmountsByReferral();

    let totalBonus = 0;
    let totalPerTask = 0;
    let allPaid = true;
    let anySuccessful = false;

    const referralDetails = [];
    for (const ref of referrals) {
      const status = await this.computeReferralStatus(ref, rates, weekStart, weekEnd);
      const paidKey = `${ref.id}_${inviterId}`;
      const paidInfo = paidByReferral.get(paidKey);
      const bonusPaid = !!paidInfo;

      referralDetails.push({
        referralId: ref.id,
        inviteeName: ref.inviteeName,
        inviteeTasks: { total: status.taskCount, posts: status.posts, comments: status.comments },
        bonusAmount: status.bonusAmount,
        perTaskAmount: status.perTaskAmount,
        isSuccessful: status.isSuccessful,
        bonusPaid,
      });

      if (status.isSuccessful) {
        anySuccessful = true;
        totalBonus += status.bonusAmount;
        totalPerTask += status.perTaskAmount;
        if (!bonusPaid) allPaid = false;
      }
    }

    return {
      inviterName: referrals[0].inviterName,
      inviterType: referrals[0].inviterType,
      status: anySuccessful ? (allPaid ? 'Paid' : 'Ready') : 'Ready',
      referrals: referralDetails,
      totalBonus,
      totalPerTask,
      totalCommission: totalBonus + totalPerTask,
    };
  }

  // ─── Payment ──────────────────────────────────────────────────

  private async getOrCreateCommissionBatch(): Promise<CommissionBatch> {
    const allBatches = await commissionBatchesCollection()
      .orderBy('batchNumber', 'desc')
      .limit(1)
      .get();

    const nextNumber = allBatches.empty ? 1 : (allBatches.docs[0].data().batchNumber as number) + 1;

    const now = new Date();
    const batch: CommissionBatch = {
      id: generateCommissionBatchId(),
      batchNumber: nextNumber,
      totalInviters: 0,
      totalAmount: 0,
      paidAt: now,
      createdAt: now,
    };

    await commissionBatchesCollection().doc(batch.id).set({
      ...batch,
      paidAt: toTimestamp(batch.paidAt!),
      createdAt: toTimestamp(batch.createdAt),
    });

    return batch;
  }

  async payInviter(inviterId: string, createdBy: string): Promise<{ batch: CommissionBatch; items: CommissionItem[] }> {
    const snapshot = await referralsCollection()
      .where('inviterId', '==', inviterId)
      .get();

    if (snapshot.empty) throw new Error('No referrals found for this inviter.');

    const referrals: Referral[] = snapshot.docs
      .map((doc) => this.docToReferral(doc))
      .filter((r) => r.status !== 'closed');

    if (referrals.length === 0) throw new Error('No active referrals found for this inviter.');

    const rates = await this.getCommissionRates();
    const items: CommissionItem[] = [];
    const now = new Date();
    let totalAmount = 0;

    for (const ref of referrals) {
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
        ref.oneTimeCommissionPaid = true;
        ref.oneTimeCommissionPaidAt = now;
        if (ref.inviterType === 'special') {
          ref.perTaskCommissionActive = true;
          ref.status = 'active_per_task';
        } else {
          ref.status = 'qualified';
        }
        ref.updatedAt = now;
        await referralsCollection().doc(ref.id).update({
          oneTimeCommissionPaid: true,
          oneTimeCommissionPaidAt: toTimestamp(now),
          status: ref.status,
          perTaskCommissionActive: ref.perTaskCommissionActive,
          updatedAt: toTimestamp(now),
        });
      }
    }

    if (items.length === 0) {
      throw new Error('No unpaid commissions available for this inviter.');
    }

    const batch = await this.getOrCreateCommissionBatch();
    batch.totalInviters = 1;
    batch.totalAmount = totalAmount;

    const firestoreBatch = commissionItemsCollection().firestore.batch();

    for (const item of items) {
      item.batchId = batch.id;
      const docRef = commissionItemsCollection().doc(item.id);
      firestoreBatch.set(docRef, {
        ...item,
        createdAt: toTimestamp(item.createdAt),
      });
    }

    firestoreBatch.update(commissionBatchesCollection().doc(batch.id), {
      totalInviters: batch.totalInviters,
      totalAmount: batch.totalAmount,
    });

    await firestoreBatch.commit();

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
          ref.oneTimeCommissionPaid = true;
          ref.oneTimeCommissionPaidAt = now;
          if (ref.inviterType === 'special') {
            ref.perTaskCommissionActive = true;
            ref.status = 'active_per_task';
          } else {
            ref.status = 'qualified';
          }
          ref.updatedAt = now;
          await referralsCollection().doc(ref.id).update({
            oneTimeCommissionPaid: true,
            oneTimeCommissionPaidAt: toTimestamp(now),
            status: ref.status,
            perTaskCommissionActive: ref.perTaskCommissionActive,
            updatedAt: toTimestamp(now),
          });
        }
      }

      if (inviterItems.length > 0) {
        items.push(...inviterItems);
        totalAmount += inviterAmount;
        invitersPaid++;
      }
    }

    if (items.length === 0) {
      throw new Error('No unpaid commissions available.');
    }

    const batch = await this.getOrCreateCommissionBatch();
    batch.totalInviters = invitersPaid;
    batch.totalAmount = totalAmount;

    const firestoreBatch = commissionItemsCollection().firestore.batch();

    for (const item of items) {
      item.batchId = batch.id;
      const docRef = commissionItemsCollection().doc(item.id);
      firestoreBatch.set(docRef, {
        ...item,
        createdAt: toTimestamp(item.createdAt),
      });
    }

    firestoreBatch.update(commissionBatchesCollection().doc(batch.id), {
      totalInviters: batch.totalInviters,
      totalAmount: batch.totalAmount,
    });

    await firestoreBatch.commit();

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

  // ─── Export ───────────────────────────────────────────────────

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
      const snapshot = await commissionItemsCollection()
        .where('batchId', '==', batchId)
        .get();

      const items = snapshot.docs.map((d) => this.docToCommissionItem(d));
      const referrals = await this.getReferrals();
      const refMap = new Map(referrals.map((r) => [r.id, r]));

      const rows = items.map((item) => {
        const ref = refMap.get(item.referralId);
        return {
          inviterName: ref?.inviterName || item.inviterId.slice(0, 8),
          inviterType: ref?.inviterType || 'normal',
          inviteeName: ref?.inviteeName || item.invitedWorkerId.slice(0, 8),
          bonusAmount: item.commissionKind === 'one_time' ? item.amount : 0,
          perTaskAmount: item.commissionKind === 'per_task' ? item.amount : 0,
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

  // ─── Document Converters ──────────────────────────────────────

  private serializeReferral(ref: Referral): Record<string, unknown> {
    return {
      inviterId: ref.inviterId,
      inviterName: ref.inviterName,
      inviteeId: ref.inviteeId,
      inviteeName: ref.inviteeName,
      inviterType: ref.inviterType,
      status: ref.status,
      oneTimeCommissionPaid: ref.oneTimeCommissionPaid,
      oneTimeCommissionPaidAt: ref.oneTimeCommissionPaidAt ? toTimestamp(ref.oneTimeCommissionPaidAt) : null,
      perTaskCommissionActive: ref.perTaskCommissionActive,
      ticketId: ref.ticketId || null,
      createdAt: toTimestamp(ref.createdAt),
      updatedAt: toTimestamp(ref.updatedAt),
    };
  }

  private docToReferral(doc: FirebaseFirestore.DocumentSnapshot): Referral {
    const data = doc.data()!;
    return {
      id: doc.id,
      inviterId: data.inviterId,
      inviterName: data.inviterName || '',
      inviteeId: data.inviteeId,
      inviteeName: data.inviteeName || '',
      inviterType: (data.inviterType as InviterType) || 'normal',
      status: (data.status as ReferralStatus) || 'pending',
      oneTimeCommissionPaid: data.oneTimeCommissionPaid ?? false,
      oneTimeCommissionPaidAt: toDate(data.oneTimeCommissionPaidAt),
      perTaskCommissionActive: data.perTaskCommissionActive ?? false,
      ticketId: data.ticketId || null,
      createdAt: toDate(data.createdAt) || new Date(),
      updatedAt: toDate(data.updatedAt) || new Date(),
    };
  }

  private docToCommissionItem(doc: FirebaseFirestore.DocumentSnapshot): CommissionItem {
    const data = doc.data()!;
    return {
      id: doc.id,
      batchId: data.batchId,
      referralId: data.referralId,
      inviterId: data.inviterId,
      invitedWorkerId: data.invitedWorkerId || data.inviteeId || '',
      sourceTaskId: data.sourceTaskId || null,
      commissionKind: (data.commissionKind || data.type || 'one_time') as CommissionKind,
      amount: data.amount ?? 0,
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

export const commissionService = new CommissionService();
