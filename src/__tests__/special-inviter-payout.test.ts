import { SPECIAL_INVITER_IDS } from '../config/constants';
import {
  computeSpecialInviterPayout,
  SPECIAL_INVITER_BONUS_RATE,
} from '../utils/special-inviter-payout';

const SPECIAL = SPECIAL_INVITER_IDS[0];
const NORMAL = '111111111111111111';

describe('computeSpecialInviterPayout', () => {
  it('keeps the bonus rate at 30%', () => {
    expect(SPECIAL_INVITER_BONUS_RATE).toBe(0.3);
  });

  it('adds 30% for each hardcoded special inviter', () => {
    for (const id of SPECIAL_INVITER_IDS) {
      const payout = computeSpecialInviterPayout(140, id);
      expect(payout).toEqual({
        isSpecial: true,
        actualAmount: 140,
        bonusAmount: 42,
        totalAmount: 182,
      });
    }
  });

  it('returns normal inviters unchanged', () => {
    expect(computeSpecialInviterPayout(140, NORMAL)).toEqual({
      isSpecial: false,
      actualAmount: 140,
      bonusAmount: 0,
      totalAmount: 140,
    });
  });

  it('treats a missing/short-circuited id as not special', () => {
    for (const id of [null, undefined, '', '  ']) {
      const payout = computeSpecialInviterPayout(50, id);
      expect(payout.isSpecial).toBe(false);
      expect(payout.totalAmount).toBe(50);
    }
  });

  it('recognises special inviter by inviterType even if id is unknown', () => {
    const payout = computeSpecialInviterPayout(100, 'unknown_id', 'special');
    expect(payout.isSpecial).toBe(true);
    expect(payout.totalAmount).toBe(130);
  });

  it('rounds the bonus and the total to paise', () => {
    // 10.01 * 0.3 = 3.003 → 3.00 ; total 13.01
    expect(computeSpecialInviterPayout(10.01, SPECIAL)).toEqual({
      isSpecial: true,
      actualAmount: 10.01,
      bonusAmount: 3,
      totalAmount: 13.01,
    });

    // 20.55 * 0.3 = 6.165 → 6.17 (half-up) ; total 26.72
    const rounded = computeSpecialInviterPayout(20.55, SPECIAL);
    expect(rounded.bonusAmount).toBe(6.17);
    expect(rounded.totalAmount).toBe(26.72);
  });

  it('handles zero and non-numeric input without producing NaN', () => {
    expect(computeSpecialInviterPayout(0, SPECIAL)).toEqual({
      isSpecial: true,
      actualAmount: 0,
      bonusAmount: 0,
      totalAmount: 0,
    });
    expect(computeSpecialInviterPayout(Number.NaN, SPECIAL).totalAmount).toBe(0);
    expect(computeSpecialInviterPayout(Number.NaN, NORMAL).totalAmount).toBe(0);
  });
});
