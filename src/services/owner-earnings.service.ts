import { Task, TaskStatus, TaskType, Referral } from '../types';
import { referralRepository } from '../database/repositories/referral.repository';
import { commissionRepository } from '../database/repositories/commission.repository';
import { commissionService } from './commission.service';
import { settingsService } from './settings.service';
import { toTask, toReferral } from '../database/converters';
import { getDb } from '../database/db';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Owner-confirmed revenue (per post / per comment). No settings table exists
// for revenue, so these stay hardcoded by design (worker cost + commissions
// below are read live from settings so admin rate changes apply).
const REVENUE_PER_POST = 250;
const REVENUE_PER_COMMENT = 100;

type EarningsSummary = {
  totalTasks: number;
  posts: number;
  comments: number;
  totalRevenue: number;
  totalWorkerCost: number;
  totalSpecialPerTaskComm: number;
  totalNormalBonuses: number;
  totalSpecialBonuses: number;
  totalEarnings: number;
};

type TaskBreakdownItem = {
  taskId: string;
  workerId: string;
  workerName: string | null;
  taskType: string;
  status: string;
  revenue: number;
  workerCost: number;
  perTaskComm: number;
  net: number;
  inviterType: string | null;
};

type ReferralDeduction = {
  referralId: string;
  inviterId: string;
  inviterName: string;
  inviteeId: string;
  inviteeName: string;
  inviterType: string;
  tasksDone: number;
  deductionType: string;
  amount: number;
  alreadyPaid: boolean;
};

type SharedData = {
  payoutRates: { commentRate: number; postRate: number };
  commRates: {
    normalInviteBonus: number;
    normalInviteTaskThreshold: number;
    specialInviteBonus: number;
    specialInviteTaskThreshold: number;
    specialPerComment: number;
    specialPerPost: number;
  };
  activeRefs: Referral[];
  qualifiedByRef: Map<string, boolean>;
  perTaskQualifiedByRef: Map<string, boolean>;
  bonusTaskByRef: Map<string, Task | null>;
  paidOneTime: Set<string>;
  refsByInvitee: Map<string, Referral[]>;
  refsByChannel: Map<string, Referral[]>;
};

class OwnerEarningsService {
  /**
   * Creation-basis universe (owner requirement): every task CREATED in the
   * window counts for revenue + worker cost, EXCEPT failures.
   * Excluded = CANCELLED status OR any non-null cancelledReason
   * ('deleted' / 'deleted_later' / any future value). This matches the payout
   * (`payout.service findEligibleTasks`) and commission (`getCompletedTasks*`)
   * rule of "any cancelledReason = not payable", so deleted posts contribute
   * exactly zero everywhere. Recomputed on-demand, so a task created Monday
   * then marked deleted Thursday disappears from Monday's row too.
   */
  private isExcluded(task: Task): boolean {
    if (task.status === TaskStatus.CANCELLED) return true;
    return task.cancelledReason !== null && task.cancelledReason !== undefined;
  }

  private istDayBounds(offsetDaysAgo: number): { startUTC: Date; endUTC: Date } {
    const nowUTC = new Date();
    const istNow = new Date(nowUTC.getTime() + IST_OFFSET_MS);
    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();
    const startIST = new Date(Date.UTC(year, month, day - offsetDaysAgo, 0, 0, 0, 0));
    const endIST = new Date(Date.UTC(year, month, day - offsetDaysAgo, 23, 59, 59, 999));
    return {
      startUTC: new Date(startIST.getTime() - IST_OFFSET_MS),
      endUTC: new Date(endIST.getTime() - IST_OFFSET_MS),
    };
  }

  private fmtISTDay(d: Date): string {
    const ist = new Date(d.getTime() + IST_OFFSET_MS);
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(ist.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  /**
   * Qualification snapshot (global, not windowed): for every active referral,
   * the all-time payable-completed task list Q (COMPLETED|ARCHIVED, no
   * cancelledReason — same predicate as payouts/commissions), sorted by
   * completion time (latest completed reminder completedAt, fallback
   * updatedAt — same helper semantics as payout/commission). Includes the
   * channel-name fallback for invitees with no direct tasks (same rule as
   * commission `getTasksForReferral`), so owner matches actual cash owed.
   */
  private async loadShared(): Promise<SharedData> {
    const [payoutRates, commRates] = await Promise.all([
      settingsService.getPayoutRates(),
      commissionService.getCommissionRates(),
    ]);

    const rawRefs = await referralRepository.findAll();
    const activeRefs = rawRefs
      .map((r) => toReferral(r as any))
      .filter((r) => r.status !== 'closed');

    const db = getDb() as any;

    // --- Q source rows: payable completed tasks for all invitees ---
    const inviteeIds = [...new Set(activeRefs.map((r) => r.inviteeId))];
    let inviteeRows: any[] = [];
    if (inviteeIds.length > 0) {
      inviteeRows = await db.task.findMany({
        where: {
          assignedUserId: { in: inviteeIds },
          status: { in: ['COMPLETED', 'ARCHIVED'] },
          cancelledReason: null,
        },
      });
    }
    const tasksByInvitee = new Map<string, Task[]>();
    for (const row of inviteeRows) {
      const t = toTask(row as any);
      const list = tasksByInvitee.get(t.assignedUserId) ?? [];
      list.push(t);
      tasksByInvitee.set(t.assignedUserId, list);
    }

    // --- Fallback rows for refs whose invitee has no direct tasks ---
    const needFallback: string[] = [];
    for (const ref of activeRefs) {
      if ((tasksByInvitee.get(ref.inviteeId) ?? []).length === 0 && ref.ticketId) {
        needFallback.push(ref.ticketId);
      }
    }
    const tasksByChannel = new Map<string, Task[]>();
    const uniqTickets = [...new Set(needFallback)];
    if (uniqTickets.length > 0) {
      const chRows: any[] = await db.task.findMany({
        where: {
          channelName: { in: uniqTickets },
          status: { in: ['COMPLETED', 'ARCHIVED'] },
          cancelledReason: null,
        },
      });
      for (const row of chRows) {
        const t = toTask(row as any);
        const key = (t.channelName ?? '') as string;
        const list = tasksByChannel.get(key) ?? [];
        list.push(t);
        tasksByChannel.set(key, list);
      }
    }

    // --- Q per referral (sorted later once completion times are known) ---
    const qByRef = new Map<string, Task[]>();
    const allQIds: string[] = [];
    for (const ref of activeRefs) {
      let q = tasksByInvitee.get(ref.inviteeId) ?? [];
      if (q.length === 0 && ref.ticketId) {
        q = tasksByChannel.get(ref.ticketId) ?? [];
      }
      qByRef.set(ref.id, q.slice());
      for (const t of q) allQIds.push(t.id);
    }

    // --- Bulk completion times (default updatedAt, override with max completedAt) ---
    const completionByTask = new Map<string, Date>();
    for (const [, q] of qByRef) {
      for (const t of q) completionByTask.set(t.id, t.updatedAt);
    }
    const CHUNK = 1000;
    for (let i = 0; i < allQIds.length; i += CHUNK) {
      const chunk = allQIds.slice(i, i + CHUNK);
      if (chunk.length === 0) continue;
      const rems: any[] = await db.reminder.findMany({ where: { taskId: { in: chunk } } });
      for (const r of rems) {
        if (r.completed && r.completedAt) {
          const cur = new Date(r.completedAt);
          const prev = completionByTask.get(r.taskId);
          if (!prev || cur.getTime() > prev.getTime()) completionByTask.set(r.taskId, cur);
        }
      }
    }

    const qualifiedByRef = new Map<string, boolean>();
    const perTaskQualifiedByRef = new Map<string, boolean>();
    const bonusTaskByRef = new Map<string, Task | null>();
    for (const ref of activeRefs) {
      // Bonus threshold follows the referral's own type (normal 2 / special 1).
      // Per-task threshold follows the special schedule whenever a special
      // commission exists (direct special OR indirect via a normal ref).
      const bonusThreshold =
        ref.inviterType === 'special'
          ? commRates.specialInviteTaskThreshold
          : commRates.normalInviteTaskThreshold;
      const perTaskApplies = ref.inviterType === 'special' || ref.indirectSpecialInviterId != null;
      const q = (qByRef.get(ref.id) ?? []).slice().sort((a, b) => {
        const ca = completionByTask.get(a.id)?.getTime() ?? 0;
        const cb = completionByTask.get(b.id)?.getTime() ?? 0;
        if (ca !== cb) return ca - cb;
        return a.id < b.id ? -1 : 1;
      });
      qByRef.set(ref.id, q);
      const bonusQualified = q.length >= bonusThreshold;
      qualifiedByRef.set(ref.id, bonusQualified);
      perTaskQualifiedByRef.set(
        ref.id,
        perTaskApplies && q.length >= commRates.specialInviteTaskThreshold,
      );
      bonusTaskByRef.set(ref.id, bonusQualified ? q[bonusThreshold - 1] : null);
    }

    // --- Paid one-time set (bonus already disbursed on some Sunday) ---
    const paidOneTime = new Set<string>();
    const items: any[] = await commissionRepository.findAllItems();
    for (const it of items) {
      if (it.commissionKind === 'one_time') {
        paidOneTime.add(`${it.referralId}_${it.inviterId}`);
      }
    }

    // --- Window-matching maps (every referral kept separately; no last-wins) ---
    const refsByInvitee = new Map<string, Referral[]>();
    for (const ref of activeRefs) {
      const list = refsByInvitee.get(ref.inviteeId) ?? [];
      list.push(ref);
      refsByInvitee.set(ref.inviteeId, list);
    }
    const refsByChannel = new Map<string, Referral[]>();
    for (const ref of activeRefs) {
      const inviteeCount = (tasksByInvitee.get(ref.inviteeId) ?? []).length;
      if (inviteeCount === 0 && ref.ticketId) {
        const list = refsByChannel.get(ref.ticketId) ?? [];
        list.push(ref);
        refsByChannel.set(ref.ticketId, list);
      }
    }

    return {
      payoutRates,
      commRates,
      activeRefs,
      qualifiedByRef,
      perTaskQualifiedByRef,
      bonusTaskByRef,
      paidOneTime,
      refsByInvitee,
      refsByChannel,
    };
  }

  private async loadWindowTasks(dateStartUTC: Date, dateEndUTC: Date): Promise<Task[]> {
    const db = getDb() as any;
    const rows: any[] = await db.task.findMany({
      where: {
        createdAt: { gte: dateStartUTC, lte: dateEndUTC },
        status: { notIn: ['CANCELLED'] },
        cancelledReason: null,
      },
    });
    return (rows as any[])
      .map((r) => toTask(r as any))
      .filter((t) => !this.isExcluded(t));
  }

  /**
   * Pure bucketing over one creation window. Revenue + worker cost accrue for
   * every included task on its creation day. Per-task commission accrues on
   * the same creation day but ONLY when the invitee is actually qualified
   * (all-time completed >= special threshold). Each one-time bonus is
   * deducted EXACTLY ONCE, in the window containing the creation instant of
   * the threshold-reaching task (Q[threshold-1].createdAt) — never repeated
   * across days. Paid status only flips the row label (awaiting → paid);
   * totals are accrual-based so Sunday payment never moves profit.
   */
  private buildForWindow(
    windowTasks: Task[],
    shared: SharedData,
    rangeStartUTC: Date,
    rangeEndUTC: Date,
  ): {
    summary: EarningsSummary;
    taskBreakdown: TaskBreakdownItem[];
    referralDeductions: ReferralDeduction[];
  } {
    const { payoutRates, commRates, activeRefs, qualifiedByRef, perTaskQualifiedByRef, bonusTaskByRef, paidOneTime, refsByInvitee, refsByChannel } = shared;

    let totalRevenue = 0;
    let totalWorkerCost = 0;
    let totalSpecialPerTaskComm = 0;
    let postCount = 0;
    let commentCount = 0;

    const taskBreakdown: TaskBreakdownItem[] = [];
    const windowCountByRef = new Map<string, number>();

    for (const task of windowTasks) {
      const isPost = task.type === TaskType.POST;
      const revenue = isPost ? REVENUE_PER_POST : REVENUE_PER_COMMENT;
      const workerCost = isPost ? payoutRates.postRate : payoutRates.commentRate;

      const seen = new Set<string>();
      const candidates: Referral[] = [];
      for (const r of refsByInvitee.get(task.assignedUserId) ?? []) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          candidates.push(r);
        }
      }
      if (task.channelName) {
        for (const r of refsByChannel.get(task.channelName) ?? []) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            candidates.push(r);
          }
        }
      }

      let perTaskComm = 0;
      let firstType: string | null = null;
      if (candidates.length > 0) firstType = candidates[0].inviterType;
      for (const ref of candidates) {
        windowCountByRef.set(ref.id, (windowCountByRef.get(ref.id) ?? 0) + 1);
        if (perTaskQualifiedByRef.get(ref.id)) {
          perTaskComm += isPost ? commRates.specialPerPost : commRates.specialPerComment;
        }
      }

      totalRevenue += revenue;
      totalWorkerCost += workerCost;
      totalSpecialPerTaskComm += perTaskComm;
      if (isPost) postCount++;
      else commentCount++;

      taskBreakdown.push({
        taskId: task.id,
        workerId: task.assignedUserId,
        workerName: task.assignedUserName,
        taskType: task.type,
        status: task.status,
        revenue,
        workerCost,
        perTaskComm,
        net: revenue - workerCost - perTaskComm,
        inviterType: firstType,
      });
    }

    let totalNormalBonuses = 0;
    let totalSpecialBonuses = 0;
    const referralDeductions: ReferralDeduction[] = [];

    for (const ref of activeRefs) {
      const count = windowCountByRef.get(ref.id) ?? 0;
      if (count === 0) continue;

      const bonusTask = bonusTaskByRef.get(ref.id);
      const bonusInWindow =
        bonusTask != null &&
        bonusTask.createdAt >= rangeStartUTC &&
        bonusTask.createdAt <= rangeEndUTC;
      const paid = ref.oneTimeCommissionPaid || paidOneTime.has(`${ref.id}_${ref.inviterId}`);

      if (bonusInWindow) {
        const amount =
          ref.inviterType === 'special' ? commRates.specialInviteBonus : commRates.normalInviteBonus;
        if (ref.inviterType === 'normal') totalNormalBonuses += amount;
        else totalSpecialBonuses += amount;
        referralDeductions.push({
          referralId: ref.id,
          inviterId: ref.inviterId,
          inviterName: ref.inviterName,
          inviteeId: ref.inviteeId,
          inviteeName: ref.inviteeName,
          inviterType: ref.inviterType,
          tasksDone: count,
          deductionType: 'one_time_bonus',
          amount,
          alreadyPaid: paid,
        });
      } else {
        const qualified = qualifiedByRef.get(ref.id) ?? false;
        referralDeductions.push({
          referralId: ref.id,
          inviterId: ref.inviterId,
          inviterName: ref.inviterName,
          inviteeId: ref.inviteeId,
          inviteeName: ref.inviteeName,
          inviterType: ref.inviterType,
          tasksDone: count,
          deductionType: 'none',
          amount: 0,
          alreadyPaid: qualified ? paid : false,
        });
      }
    }

    return {
      summary: {
        totalTasks: windowTasks.length,
        posts: postCount,
        comments: commentCount,
        totalRevenue,
        totalWorkerCost,
        totalSpecialPerTaskComm,
        totalNormalBonuses,
        totalSpecialBonuses,
        totalEarnings:
          totalRevenue - totalWorkerCost - totalSpecialPerTaskComm - totalNormalBonuses - totalSpecialBonuses,
      },
      taskBreakdown,
      referralDeductions,
    };
  }

  private async calculateForRange(dateStartUTC: Date, dateEndUTC: Date): Promise<{
    summary: EarningsSummary;
    taskBreakdown: TaskBreakdownItem[];
    referralDeductions: ReferralDeduction[];
  }> {
    const shared = await this.loadShared();
    const windowTasks = await this.loadWindowTasks(dateStartUTC, dateEndUTC);
    return this.buildForWindow(windowTasks, shared, dateStartUTC, dateEndUTC);
  }

  async getDailyEarnings(): Promise<{
    date: string;
    summary: EarningsSummary;
    taskBreakdown: TaskBreakdownItem[];
    referralDeductions: ReferralDeduction[];
  }> {
    const { startUTC, endUTC } = (() => {
      const b = this.istDayBounds(0);
      return { startUTC: b.startUTC, endUTC: b.endUTC };
    })();
    const result = await this.calculateForRange(startUTC, endUTC);
    return { date: this.fmtISTDay(new Date(startUTC.getTime() + IST_OFFSET_MS)), ...result };
  }

  async getLastNDaysHistory(days: number): Promise<{ date: string; summary: EarningsSummary }[]> {
    const oldest = this.istDayBounds(days - 1);
    const today = this.istDayBounds(0);
    const fullStart = oldest.startUTC;
    const fullEnd = today.endUTC;

    // Single shared load + single window load, then pure in-memory bucketing
    // so the 30 rows are guaranteed additive and need no per-day queries.
    const shared = await this.loadShared();
    const fullWindow = await this.loadWindowTasks(fullStart, fullEnd);

    const rows: { date: string; summary: EarningsSummary }[] = [];
    const nowUTC = new Date();
    const istNow = new Date(nowUTC.getTime() + IST_OFFSET_MS);
    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();

    for (let i = days - 1; i >= 0; i--) {
      const dayStartIST = new Date(Date.UTC(year, month, day - i, 0, 0, 0, 0));
      const dayEndIST = new Date(Date.UTC(year, month, day - i, 23, 59, 59, 999));
      const dayStartUTC = new Date(dayStartIST.getTime() - IST_OFFSET_MS);
      const dayEndUTC = new Date(dayEndIST.getTime() - IST_OFFSET_MS);
      const dayTasks = fullWindow.filter((t) => t.createdAt >= dayStartUTC && t.createdAt <= dayEndUTC);
      const built = this.buildForWindow(dayTasks, shared, dayStartUTC, dayEndUTC);
      const y = dayStartIST.getUTCFullYear();
      const m = String(dayStartIST.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(dayStartIST.getUTCDate()).padStart(2, '0');
      rows.push({ date: `${y}-${m}-${dd}`, summary: built.summary });
    }

    return rows;
  }

  async getWeeklyEarnings(): Promise<{
    weekStart: string;
    weekEnd: string;
    summary: EarningsSummary;
    taskBreakdown: TaskBreakdownItem[];
    referralDeductions: ReferralDeduction[];
  }> {
    const nowUTC = new Date();
    const istNow = new Date(nowUTC.getTime() + IST_OFFSET_MS);

    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();
    const dayOfWeek = istNow.getUTCDay();

    const weekStartIST = new Date(Date.UTC(year, month, day - dayOfWeek, 0, 0, 0, 0));
    const weekStartUTC = new Date(weekStartIST.getTime() - IST_OFFSET_MS);

    // Creation-basis week: tasks CREATED since Sunday 00:00 IST.
    const result = await this.calculateForRange(weekStartUTC, nowUTC);

    const fmt = (d: Date) => {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };

    return {
      weekStart: fmt(weekStartIST),
      weekEnd: fmt(istNow),
      ...result,
    };
  }
}

export const ownerEarningsService = new OwnerEarningsService();
