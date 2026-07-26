import { getDb } from '../database/db';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const REVENUE_POST = 250;
const REVENUE_COMMENT = 100;
const WORKER_PAY_POST = 60;
const WORKER_PAY_COMMENT = 30;
const SPECIAL_PER_POST_COMM = 20;
const SPECIAL_PER_COMMENT_COMM = 10;

export interface PeriodBounds {
  start: Date | null;
  end: Date | null;
}

export interface VerificationComponent {
  method1: number;
  method2: number;
  match: boolean;
  label: string;
}

export interface EarningsBreakdown {
  period: PeriodBounds;
  tasks: {
    totalPosts: number;
    totalComments: number;
  };
  breakdown: {
    directInvite: { posts: number; comments: number; netEarnings: number };
    normalInvite: { posts: number; comments: number; netEarnings: number; oneTimeCosts: number };
    specialInvite: { posts: number; comments: number; netEarnings: number; oneTimeCosts: number };
  };
  verification: {
    method1: number;
    method2: number;
    match: boolean;
    components: VerificationComponent[];
  };
}

export interface OwnerEarningsResponse {
  daily: EarningsBreakdown;
  weekly: EarningsBreakdown;
  allTime: EarningsBreakdown;
}

class OwnerEarningsService {
  private getISTDateBoundaries(): { todayStart: Date; todayEnd: Date; weekStart: Date; weekEnd: Date } {
    const now = new Date();
    const istNow = new Date(now.getTime() + IST_OFFSET_MS);

    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();

    const todayStartUTC = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    const todayEndUTC = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

    const dayOfWeek = istNow.getUTCDay();
    const weekStartUTC = new Date(Date.UTC(year, month, day - dayOfWeek, 0, 0, 0, 0));
    const weekEndUTC = new Date(Date.UTC(year, month, day - dayOfWeek + 6, 23, 59, 59, 999));

    return {
      todayStart: new Date(todayStartUTC.getTime() - IST_OFFSET_MS),
      todayEnd: new Date(todayEndUTC.getTime() - IST_OFFSET_MS),
      weekStart: new Date(weekStartUTC.getTime() - IST_OFFSET_MS),
      weekEnd: new Date(weekEndUTC.getTime() - IST_OFFSET_MS),
    };
  }

  private async getTaskCompletionMap(taskIds: string[]): Promise<Map<string, Date>> {
    if (taskIds.length === 0) return new Map();

    const db = getDb();
    const reminders = await db.reminder.findMany({
      where: { taskId: { in: taskIds }, completed: true, completedAt: { not: null } },
      select: { taskId: true, completedAt: true },
    });

    const completionMap = new Map<string, Date>();
    for (const r of reminders) {
      if (!r.completedAt) continue;
      const existing = completionMap.get(r.taskId);
      if (!existing || r.completedAt.getTime() > existing.getTime()) {
        completionMap.set(r.taskId, r.completedAt);
      }
    }
    return completionMap;
  }

  async getEarnings(): Promise<OwnerEarningsResponse> {
    const { todayStart, todayEnd, weekStart, weekEnd } = this.getISTDateBoundaries();

    const daily = await this.computeForPeriod({ start: todayStart, end: todayEnd });
    const weekly = await this.computeForPeriod({ start: weekStart, end: weekEnd });
    const allTime = await this.computeForPeriod({ start: null, end: null });

    return { daily, weekly, allTime };
  }

  private async computeForPeriod(period: PeriodBounds): Promise<EarningsBreakdown> {
    const db = getDb();

    const allTasks = await db.task.findMany({
      where: {
        status: { in: ['COMPLETED', 'ARCHIVED'] },
      },
    });

    const nonCancelled = allTasks.filter((t) => t.cancelledReason === null || t.cancelledReason === undefined);

    const completionMap = await this.getTaskCompletionMap(nonCancelled.map((t) => t.id));

    const tasksWithCompletion = nonCancelled.map((t) => ({
      ...t,
      completedAt: completionMap.get(t.id) || t.updatedAt,
    }));

    let filtered = tasksWithCompletion;
    if (period.start && period.end) {
      filtered = tasksWithCompletion.filter(
        (t) => t.completedAt >= period.start! && t.completedAt <= period.end!,
      );
    }

    const referrals = await db.referral.findMany({
      where: { status: { not: 'closed' } },
    });
    const refByInvitee = new Map(referrals.map((r) => [r.inviteeId, r]));

    const commissionItems = await db.commissionItem.findMany({
      where: period.start && period.end
        ? { createdAt: { gte: period.start, lte: period.end } }
        : {},
    });
    const oneTimeCommissionItems = commissionItems.filter((ci) => ci.commissionKind === 'one_time');

    let totalPosts = 0;
    let totalComments = 0;

    let directPosts = 0;
    let directComments = 0;
    let directEarningsM1 = 0;

    let normalPosts = 0;
    let normalComments = 0;
    let normalEarningsM1 = 0;

    let specialPosts = 0;
    let specialComments = 0;
    let specialEarningsM1 = 0;

    let perTaskCommissionsM1 = 0;

    for (const task of filtered) {
      const isPost = task.type === 'POST';
      totalPosts += isPost ? 1 : 0;
      totalComments += isPost ? 0 : 1;

      const revenue = isPost ? REVENUE_POST : REVENUE_COMMENT;
      const workerPay = isPost ? WORKER_PAY_POST : WORKER_PAY_COMMENT;
      let taskEarning = revenue - workerPay;

      const ref = refByInvitee.get(task.assignedUserId);

      if (!ref) {
        directPosts += isPost ? 1 : 0;
        directComments += isPost ? 0 : 1;
        directEarningsM1 += taskEarning;
      } else if (ref.inviterType === 'normal') {
        normalPosts += isPost ? 1 : 0;
        normalComments += isPost ? 0 : 1;
        normalEarningsM1 += taskEarning;
      } else {
        const perTaskComm = isPost ? SPECIAL_PER_POST_COMM : SPECIAL_PER_COMMENT_COMM;
        taskEarning -= perTaskComm;
        perTaskCommissionsM1 += perTaskComm;
        specialPosts += isPost ? 1 : 0;
        specialComments += isPost ? 0 : 1;
        specialEarningsM1 += taskEarning;
      }
    }

    const oneTimeCostsM1 = oneTimeCommissionItems.reduce((sum, ci) => sum + ci.amount, 0);

    const netMethod1 = directEarningsM1 + normalEarningsM1 + specialEarningsM1 - oneTimeCostsM1;

    const totalRevenue = totalPosts * REVENUE_POST + totalComments * REVENUE_COMMENT;
    const totalWorkerPay = totalPosts * WORKER_PAY_POST + totalComments * WORKER_PAY_COMMENT;
    const oneTimeCostsM2 = oneTimeCostsM1;
    const perTaskCostsM2 = perTaskCommissionsM1;
    const netMethod2 = totalRevenue - totalWorkerPay - oneTimeCostsM2 - perTaskCostsM2;

    const match = netMethod1 === netMethod2;

    const components: VerificationComponent[] = [
      { label: 'Revenue', method1: totalRevenue, method2: totalRevenue, match: true },
      { label: 'Worker Payments', method1: -totalWorkerPay, method2: -totalWorkerPay, match: true },
      { label: 'One-time Bonuses', method1: -oneTimeCostsM1, method2: -oneTimeCostsM2, match: oneTimeCostsM1 === oneTimeCostsM2 },
      { label: 'Per-task Commissions', method1: -perTaskCommissionsM1, method2: -perTaskCostsM2, match: perTaskCommissionsM1 === perTaskCostsM2 },
      { label: 'Net Earnings', method1: netMethod1, method2: netMethod2, match },
    ];

    return {
      period,
      tasks: { totalPosts, totalComments },
      breakdown: {
        directInvite: { posts: directPosts, comments: directComments, netEarnings: directEarningsM1 },
        normalInvite: { posts: normalPosts, comments: normalComments, netEarnings: normalEarningsM1, oneTimeCosts: oneTimeCostsM1 },
        specialInvite: { posts: specialPosts, comments: specialComments, netEarnings: specialEarningsM1, oneTimeCosts: oneTimeCostsM1 },
      },
      verification: {
        method1: netMethod1,
        method2: netMethod2,
        match,
        components,
      },
    };
  }
}

export const ownerEarningsService = new OwnerEarningsService();
