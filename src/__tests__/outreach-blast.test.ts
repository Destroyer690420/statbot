import { isSlotWinner, isBlastFull, isAtDailyCap } from '../utils/outreach-blast';

describe('isSlotWinner', () => {
  it('first n replies win', () => {
    expect(isSlotWinner(1, 5)).toBe(true);
    expect(isSlotWinner(5, 5)).toBe(true);
    expect(isSlotWinner(6, 5)).toBe(false);
  });

  it('rejects invalid inputs', () => {
    expect(isSlotWinner(0, 5)).toBe(false);
    expect(isSlotWinner(1, 0)).toBe(false);
    expect(isSlotWinner(1.5, 5)).toBe(false);
  });
});

describe('isBlastFull', () => {
  it('closes exactly at total', () => {
    expect(isBlastFull(4, 5)).toBe(false);
    expect(isBlastFull(5, 5)).toBe(true);
    expect(isBlastFull(7, 5)).toBe(true);
  });
});

describe('isAtDailyCap', () => {
  it('skips workers with 2+ posts assigned today', () => {
    expect(isAtDailyCap(0, 2)).toBe(false);
    expect(isAtDailyCap(1, 2)).toBe(false);
    expect(isAtDailyCap(2, 2)).toBe(true);
    expect(isAtDailyCap(3, 2)).toBe(true);
  });
});
