import { TaskStatus, TaskType, InviterType, ReferralRole } from '../types';
import {
  isTaskCommissionEligible,
  getCommissionThreshold,
  getOneTimeBonus,
  getPerTaskRate,
  isOneTimePayable,
  isDirectPerTaskActive,
  isRecruiterLink,
  getIndirectChainCutoff,
  isTaskAfterChainEstablished,
} from '../services/commission-rules';

const RATES = {
  normalInviteBonus: 100,
  normalInviteTaskThreshold: 2,
  specialInviteBonus: 50,
  specialInviteTaskThreshold: 1,
  specialPerComment: 10,
  specialPerPost: 20,
  updatedAt: new Date('2026-01-01'),
  updatedBy: 'system',
};

describe('isTaskCommissionEligible', () => {
  it('accepts completed tasks without a cancelled reason', () => {
    expect(isTaskCommissionEligible({ status: TaskStatus.COMPLETED, cancelledReason: null })).toBe(true);
    expect(isTaskCommissionEligible({ status: TaskStatus.ARCHIVED, cancelledReason: null })).toBe(true);
  });

  it('rejects deleted/cancelled tasks regardless of deleted status', () => {
    expect(isTaskCommissionEligible({ status: TaskStatus.COMPLETED, cancelledReason: 'deleted' })).toBe(false);
    expect(isTaskCommissionEligible({ status: TaskStatus.COMPLETED, cancelledReason: 'deleted_later' })).toBe(false);
    expect(isTaskCommissionEligible({ status: TaskStatus.CANCELLED, cancelledReason: null })).toBe(false);
    expect(isTaskCommissionEligible({ status: TaskStatus.PENDING, cancelledReason: null })).toBe(false);
  });
});

describe('commission rates usage', () => {
  it('applies normal vs special thresholds', () => {
    expect(getCommissionThreshold('normal' as InviterType, RATES)).toBe(2);
    expect(getCommissionThreshold('special' as InviterType, RATES)).toBe(1);
  });

  it('applies normal vs special one-time bonuses', () => {
    expect(getOneTimeBonus('normal' as InviterType, RATES)).toBe(100);
    expect(getOneTimeBonus('special' as InviterType, RATES)).toBe(50);
  });

  it('per-task rate by task type', () => {
    expect(getPerTaskRate(TaskType.POST, RATES)).toBe(20);
    expect(getPerTaskRate(TaskType.COMMENT, RATES)).toBe(10);
  });
});

describe('isOneTimePayable', () => {
  it('normal ₹100 only after the 2-task threshold', () => {
    expect(isOneTimePayable(false, 1, 2, 100)).toBe(false);
    expect(isOneTimePayable(false, 2, 2, 100)).toBe(true);
    expect(isOneTimePayable(false, 3, 2, 100)).toBe(true);
  });

  it('never pays again once already paid', () => {
    expect(isOneTimePayable(true, 5, 1, 50)).toBe(false);
  });

  it('never pays when bonus amount is zero', () => {
    expect(isOneTimePayable(false, 5, 1, 0)).toBe(false);
  });
});

describe('isDirectPerTaskActive', () => {
  it('activates once per-type active flag set', () => {
    expect(isDirectPerTaskActive(true, 'normal' as InviterType, true, true)).toBe(true);
  });

  it('special starts per-task at first threshold meet', () => {
    expect(isDirectPerTaskActive(false, 'special' as InviterType, true, true)).toBe(true);
  });

  it('normal inviter never gets per-task (₹0)', () => {
    expect(isDirectPerTaskActive(false, 'normal' as InviterType, true, true)).toBe(false);
  });
});

describe('isRecruiterLink', () => {
  it('recruiter rows generate nothing', () => {
    expect(isRecruiterLink({ role: 'recruiter' as ReferralRole })).toBe(true);
    expect(isRecruiterLink({ role: 'worker' as ReferralRole })).toBe(false);
  });
});

describe('indirect chain cutoff (no retroactivity)', () => {
  const workerCreated = new Date('2026-01-05T00:00:00Z');
  const linkCreated = new Date('2026-01-10T00:00:00Z');

  it('cutoff = later of worker referral and recruiter link creation', () => {
    expect(getIndirectChainCutoff(workerCreated, linkCreated)).toEqual(linkCreated);
    expect(getIndirectChainCutoff(linkCreated, workerCreated)).toEqual(linkCreated);
    expect(getIndirectChainCutoff(workerCreated, workerCreated)).toEqual(workerCreated);
  });

  it('tasks before the chain existed are excluded', () => {
    const cutoff = getIndirectChainCutoff(workerCreated, linkCreated);
    expect(isTaskAfterChainEstablished(new Date('2026-01-09T23:59:00Z'), cutoff)).toBe(false);
    expect(isTaskAfterChainEstablished(new Date('2026-01-10T00:00:00Z'), cutoff)).toBe(true);
    expect(isTaskAfterChainEstablished(new Date('2026-01-15T00:00:00Z'), cutoff)).toBe(true);
  });
});