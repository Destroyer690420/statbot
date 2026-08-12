import { Task, TaskStatus, TaskType, Referral } from '../types';
import { taskRepository } from '../database/repositories/task.repository';
import { referralRepository } from '../database/repositories/referral.repository';
import { commissionService } from './commission.service';
import { toTask, toReferral } from '../database/converters';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

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

class OwnerEarningsService {
  private isTaskDeleted(task: Task): boolean {
    return (
      task.cancelledReason === 'deleted' ||
      task.cancelledReason === 'deleted_later'
    );
  }

  private async calculateEarnings(tasks: Task[]): Promise<{
    summary: EarningsSummary;
    taskBreakdown: TaskBreakdownItem[];
    referralDeductions: ReferralDeduction[];
  }> {
    const REVENUE_PER_POST = 250;
    const REVENUE_PER_COMMENT = 100;
    const WORKER_COST_POST = 60;
    const WORKER_COST_COMMENT = 30;

    const commRates = await commissionService.getCommissionRates();

    const allReferrals = await referralRepository.findAll();
    const activeReferrals = allReferrals.filter((r) => r.status !== 'closed');

    const referralByInvitee = new Map<string, Referral>();
    for (const raw of activeReferrals) {
      const ref = toReferral(raw as any);
      referralByInvitee.set(ref.inviteeId, ref);
    }

    let totalTaskEarnings = 0;
    let totalRevenue = 0;
    let totalWorkerCost = 0;
    let totalSpecialPerTaskComm = 0;
    let postCount = 0;
    let commentCount = 0;

    const taskBreakdown: TaskBreakdownItem[] = [];
    const tasksByReferralId = new Map<string, number>();

    for (const task of tasks) {
      const isPost = task.type === TaskType.POST;
      const revenue = isPost ? REVENUE_PER_POST : REVENUE_PER_COMMENT;
      const workerCost = isPost ? WORKER_COST_POST : WORKER_COST_COMMENT;
      let perTaskComm = 0;

      const ref = referralByInvitee.get(task.assignedUserId);
      if (ref && (ref.inviterType === 'special' || ref.indirectSpecialInviterId)) {
        perTaskComm = isPost ? commRates.specialPerPost : commRates.specialPerComment;
        totalSpecialPerTaskComm += perTaskComm;
      }

      const taskNet = revenue - workerCost - perTaskComm;
      totalTaskEarnings += taskNet;
      totalRevenue += revenue;
      totalWorkerCost += workerCost;

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
        net: taskNet,
        inviterType: ref?.inviterType || null,
      });

      if (ref) {
        const current = tasksByReferralId.get(ref.id) || 0;
        tasksByReferralId.set(ref.id, current + 1);
      }
    }

    let totalNormalBonuses = 0;
    let totalSpecialBonuses = 0;
    const referralDeductions: ReferralDeduction[] = [];

    for (const raw of activeReferrals) {
      const ref = toReferral(raw as any);
      const inviteeTaskCount = tasksByReferralId.get(ref.id) || 0;
      if (inviteeTaskCount === 0) continue;

      const threshold = ref.inviterType === 'special'
        ? commRates.specialInviteTaskThreshold
        : commRates.normalInviteTaskThreshold;

      if (inviteeTaskCount < threshold) {
        referralDeductions.push({
          referralId: ref.id,
          inviterId: ref.inviterId,
          inviterName: ref.inviterName,
          inviteeId: ref.inviteeId,
          inviteeName: ref.inviteeName,
          inviterType: ref.inviterType,
          tasksDone: inviteeTaskCount,
          deductionType: 'none',
          amount: 0,
          alreadyPaid: false,
        });
        continue;
      }

      if (ref.oneTimeCommissionPaid) {
        referralDeductions.push({
          referralId: ref.id,
          inviterId: ref.inviterId,
          inviterName: ref.inviterName,
          inviteeId: ref.inviteeId,
          inviteeName: ref.inviteeName,
          inviterType: ref.inviterType,
          tasksDone: inviteeTaskCount,
          deductionType: 'none',
          amount: 0,
          alreadyPaid: true,
        });
        continue;
      }

      if (ref.inviterType === 'normal') {
        totalNormalBonuses += commRates.normalInviteBonus;
        totalTaskEarnings -= commRates.normalInviteBonus;
        referralDeductions.push({
          referralId: ref.id,
          inviterId: ref.inviterId,
          inviterName: ref.inviterName,
          inviteeId: ref.inviteeId,
          inviteeName: ref.inviteeName,
          inviterType: 'normal',
          tasksDone: inviteeTaskCount,
          deductionType: 'one_time_bonus',
          amount: commRates.normalInviteBonus,
          alreadyPaid: false,
        });
      } else if (ref.inviterType === 'special') {
        totalSpecialBonuses += commRates.specialInviteBonus;
        totalTaskEarnings -= commRates.specialInviteBonus;
        referralDeductions.push({
          referralId: ref.id,
          inviterId: ref.inviterId,
          inviterName: ref.inviterName,
          inviteeId: ref.inviteeId,
          inviteeName: ref.inviteeName,
          inviterType: 'special',
          tasksDone: inviteeTaskCount,
          deductionType: 'one_time_bonus',
          amount: commRates.specialInviteBonus,
          alreadyPaid: false,
        });
      }
    }

    return {
      summary: {
        totalTasks: tasks.length,
        posts: postCount,
        comments: commentCount,
        totalRevenue,
        totalWorkerCost,
        totalSpecialPerTaskComm,
        totalNormalBonuses,
        totalSpecialBonuses,
        totalEarnings: totalTaskEarnings,
      },
      taskBreakdown,
      referralDeductions,
    };
  }

  private async computeEarnings(dateStartUTC: Date, dateEndUTC: Date): Promise<{
    summary: EarningsSummary;
    taskBreakdown: TaskBreakdownItem[];
    referralDeductions: ReferralDeduction[];
  }> {
    const terminalStatuses: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.ARCHIVED, TaskStatus.CANCELLED];
    const rawTasks = await taskRepository.findByStatusIn(terminalStatuses);
    const allTerminalTasks = rawTasks.map((t: any) => toTask(t));

    const filteredTasks = allTerminalTasks.filter((t) => {
      if (t.createdAt < dateStartUTC || t.createdAt > dateEndUTC) return false;
      if (t.status === TaskStatus.COMPLETED || t.status === TaskStatus.ARCHIVED) return true;
      if (this.isTaskDeleted(t)) return true;
      return false;
    });

    return this.calculateEarnings(filteredTasks);
  }

  private async getDayTasks(dateStartUTC: Date, dateEndUTC: Date): Promise<Task[]> {
    const rawTasks = await taskRepository.findByCreatedAt(dateStartUTC, dateEndUTC);
    return rawTasks.map((t: any) => toTask(t)).filter((t) => !this.isTaskDeleted(t));
  }

  async getDailyEarnings(): Promise<{
    date: string;
    summary: EarningsSummary;
    taskBreakdown: TaskBreakdownItem[];
    referralDeductions: ReferralDeduction[];
  }> {
    const nowUTC = new Date();
    const istNow = new Date(nowUTC.getTime() + IST_OFFSET_MS);

    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();

    const dayStartIST = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    const dayEndIST = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

    const dayStartUTC = new Date(dayStartIST.getTime() - IST_OFFSET_MS);
    const dayEndUTC = new Date(dayEndIST.getTime() - IST_OFFSET_MS);

    const tasks = await this.getDayTasks(dayStartUTC, dayEndUTC);
    const result = await this.calculateEarnings(tasks);

    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    return { date: dateStr, ...result };
  }

  async getLastNDaysHistory(days: number): Promise<{ date: string; summary: EarningsSummary }[]> {
    const nowUTC = new Date();
    const istNow = new Date(nowUTC.getTime() + IST_OFFSET_MS);

    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();

    const historyStartIST = new Date(Date.UTC(year, month, day - (days - 1), 0, 0, 0, 0));
    const historyEndIST = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

    const tasks = await this.getDayTasks(
      new Date(historyStartIST.getTime() - IST_OFFSET_MS),
      new Date(historyEndIST.getTime() - IST_OFFSET_MS),
    );

    const fmt = (d: Date) => {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };

    const rows: { date: string; summary: EarningsSummary }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayStartIST = new Date(Date.UTC(year, month, day - i, 0, 0, 0, 0));
      const dayEndIST = new Date(Date.UTC(year, month, day - i, 23, 59, 59, 999));
      const dayStartUTC = new Date(dayStartIST.getTime() - IST_OFFSET_MS);
      const dayEndUTC = new Date(dayEndIST.getTime() - IST_OFFSET_MS);

      const dayTasks = tasks.filter((t) => t.createdAt >= dayStartUTC && t.createdAt <= dayEndUTC);
      const result = await this.calculateEarnings(dayTasks);
      rows.push({ date: fmt(dayStartIST), summary: result.summary });
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

    const result = await this.computeEarnings(weekStartUTC, nowUTC);

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
