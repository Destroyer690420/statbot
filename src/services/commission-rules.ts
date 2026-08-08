import { Task, TaskStatus, TaskType, Referral, InviterType, CommissionRates } from '../types';

export function isTaskCommissionEligible(task: Pick<Task, 'status' | 'cancelledReason'>): boolean {
  if (task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.ARCHIVED) return false;
  return task.cancelledReason === null || task.cancelledReason === undefined;
}

export function getCommissionThreshold(inviterType: InviterType, rates: CommissionRates): number {
  return inviterType === 'special' ? rates.specialInviteTaskThreshold : rates.normalInviteTaskThreshold;
}

export function getOneTimeBonus(inviterType: InviterType, rates: CommissionRates): number {
  return inviterType === 'special' ? rates.specialInviteBonus : rates.normalInviteBonus;
}

export function getPerTaskRate(taskType: TaskType, rates: CommissionRates): number {
  return taskType === TaskType.POST ? rates.specialPerPost : rates.specialPerComment;
}

export function isOneTimePayable(
  alreadyPaid: boolean,
  completedCount: number,
  threshold: number,
  bonusAmount: number,
): boolean {
  return !alreadyPaid && completedCount >= threshold && bonusAmount > 0;
}

export function isDirectPerTaskActive(
  perTaskCommissionActive: boolean,
  inviterType: InviterType,
  oneTimePayable: boolean,
  thresholdMet: boolean,
): boolean {
  return perTaskCommissionActive || (inviterType === 'special' && oneTimePayable && thresholdMet);
}

export function isRecruiterLink(ref: Pick<Referral, 'role'>): boolean {
  return ref.role === 'recruiter';
}

/**
 * Indirect commissions only count for tasks completed AFTER both the
 * worker's referral and the recruiter link existed (no retroactivity).
 */
export function getIndirectChainCutoff(workerReferralCreatedAt: Date, recruiterLinkCreatedAt: Date): Date {
  return new Date(Math.max(workerReferralCreatedAt.getTime(), recruiterLinkCreatedAt.getTime()));
}

export function isTaskAfterChainEstablished(completedAt: Date, cutoff: Date): boolean {
  return completedAt.getTime() >= cutoff.getTime();
}