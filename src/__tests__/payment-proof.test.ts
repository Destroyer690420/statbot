import {
  summarizeCommissionItemsByInviter,
  summarizePayoutItemsByWorker,
} from '../utils/payment-proof';

describe('summarizePayoutItemsByWorker', () => {
  it('returns one total per worker, in first-seen order', () => {
    const summaries = summarizePayoutItemsByWorker([
      { workerId: 'w1', amount: 60 },
      { workerId: 'w2', amount: 30 },
      { workerId: 'w1', amount: 30 },
    ]);

    expect(summaries).toEqual([
      { workerId: 'w1', totalAmount: 90 },
      { workerId: 'w2', totalAmount: 30 },
    ]);
  });

  it('keeps decimal amounts exact enough for display', () => {
    const summaries = summarizePayoutItemsByWorker([
      { workerId: 'w1', amount: 30.5 },
      { workerId: 'w1', amount: 30.25 },
    ]);

    expect(summaries[0].totalAmount).toBeCloseTo(60.75);
  });

  it('returns an empty list when nothing was paid', () => {
    expect(summarizePayoutItemsByWorker([])).toEqual([]);
  });
});

describe('summarizeCommissionItemsByInviter', () => {
  it('sums every commission kind into one total per inviter', () => {
    const summaries = summarizeCommissionItemsByInviter([
      { inviterId: 'i1', amount: 100 },
      { inviterId: 'i2', amount: 20 },
      { inviterId: 'i1', amount: 10 },
    ]);

    expect(summaries).toEqual([
      { inviterId: 'i1', totalAmount: 110 },
      { inviterId: 'i2', totalAmount: 20 },
    ]);
  });

  it('returns an empty list when nothing was paid', () => {
    expect(summarizeCommissionItemsByInviter([])).toEqual([]);
  });
});
