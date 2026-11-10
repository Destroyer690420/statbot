/**
 * Special-inviter payment bonus (backend counterpart of the dashboard's
 * `dashboard/src/pages/payout/utils/specialInviterPayout.ts`).
 *
 * The owner pays the three hardcoded special inviters an extra 30% on top of
 * their recorded commission. `SPECIAL_INVITER_IDS` stays the single source of
 * truth, so a special inviter is recognised here exactly as the commission
 * engine recognises one.
 *
 * This is a payment-surface rule only: the commission items, the batch total,
 * the CSV export and the worker portal figures all keep the actual amount. The
 * extra 30% appears only on the amount that is actually paid out — the Pay
 * Inviter QR (dashboard) and the payments-channel receipt (backend).
 */
import { isSpecialInviter } from '../config/constants';

/** Extra share paid to special inviters on top of their commission. */
export const SPECIAL_INVITER_BONUS_RATE = 0.3;

export interface SpecialInviterPayout {
  /** True when `inviterId` is one of `SPECIAL_INVITER_IDS`. */
  isSpecial: boolean;
  /** The recorded commission (what the ledger and batch hold). */
  actualAmount: number;
  /** The extra 30% added at payment time. */
  bonusAmount: number;
  /** What is actually paid: `actualAmount + bonusAmount`. */
  totalAmount: number;
}

function roundPaise(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Resolve the amount actually paid to an inviter.
 * Normal inviters are returned unchanged (`totalAmount === actualAmount`).
 */
export function computeSpecialInviterPayout(
  totalCommission: number,
  inviterId: string | null | undefined,
  inviterType?: string | null | undefined,
): SpecialInviterPayout {
  const actualAmount = roundPaise(Number(totalCommission) || 0);

  const isSpecial = isSpecialInviter(inviterId) || inviterType === 'special';
  if (!isSpecial) {
    return { isSpecial: false, actualAmount, bonusAmount: 0, totalAmount: actualAmount };
  }

  const bonusAmount = roundPaise(actualAmount * SPECIAL_INVITER_BONUS_RATE);
  return {
    isSpecial: true,
    actualAmount,
    bonusAmount,
    totalAmount: roundPaise(actualAmount + bonusAmount),
  };
}
