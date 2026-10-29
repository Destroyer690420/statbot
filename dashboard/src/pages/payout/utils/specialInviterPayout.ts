/**
 * Special inviter payout math for the Pay Inviter popup.
 *
 * Special inviters (the three hardcoded Discord IDs on the backend) are paid
 * an extra 30% on top of their commission. The extra amount is display/payment
 * only: the backend still records the actual commission amount, exactly as
 * before. Normal inviters are returned unchanged.
 */
export const SPECIAL_INVITER_BONUS_RATE = 0.3;

export interface InviterPayableAmount {
  isSpecial: boolean;
  actualAmount: number;
  bonusAmount: number;
  totalAmount: number;
}

function roundPaise(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function computeSpecialInviterPayout(
  totalCommission: number,
  inviterType: string | null | undefined,
): InviterPayableAmount {
  const actualAmount = roundPaise(Number(totalCommission) || 0);

  if (inviterType !== 'special') {
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
