import { buildOwnerDigestMessage, OwnerDigestMessageInput } from '../utils/owner-digest-message';

function input(partial: Partial<OwnerDigestMessageInput> = {}): OwnerDigestMessageInput {
  return {
    startLabel: 'Thu 15 Oct 2026',
    endLabel: 'Wed 21 Oct 2026',
    cohort: { total: 87, posts: 41, comments: 46, completed: 62, deleted: 9, open: 16 },
    money: {
      revenue: 11250,
      workerCost: 3720,
      perTaskCommissions: 1100,
      oneTimeBonuses: 240,
      saved: 11250 - 3720 - 1100 - 240,
    },
    rates: { revenuePerPost: 250, revenuePerComment: 100, workerPerPost: 60, workerPerComment: 30 },
    ...partial,
  };
}

describe('buildOwnerDigestMessage', () => {
  it('renders the week, the reconciled task counts and every money line the owner asked for', () => {
    const text = buildOwnerDigestMessage(input());

    expect(text).toContain('📊 **Weekly Owner Digest**');
    expect(text).toContain('**Thu 15 Oct 2026 → Wed 21 Oct 2026** (IST)');
    expect(text).toContain('**Tasks created:** 87 (posts 41 · comments 46)');
    expect(text).toContain('✅ Completed: 62');
    expect(text).toContain('🗑️ Deleted: 9');
    expect(text).toContain('⏳ Still open: 16');
    // 62 completed + 16 open = the 78 live tasks money is counted on.
    expect(text).toContain('Counted for money (live tasks): 78');
    expect(text).toContain('Revenue: **₹11,250**');
    expect(text).toContain('Worker pay: **−₹3,720**');
    expect(text).toContain('Commissions: **−₹1,340** (per-task ₹1,100 + one-time bonuses ₹240)');
    expect(text).toContain('💎 **Saved (net): ₹6,190**');
    expect(text).toContain('₹250/post · ₹100/comment');
    expect(text).toContain('₹60/post · ₹30/comment');
  });

  it('groups large amounts the Indian way', () => {
    const text = buildOwnerDigestMessage(
      input({
        cohort: { total: 500, posts: 450, comments: 50, completed: 450, deleted: 20, open: 30 },
        money: {
          revenue: 112500,
          workerCost: 28500,
          perTaskCommissions: 0,
          oneTimeBonuses: 0,
          saved: 112500 - 28500,
        },
      }),
    );
    expect(text).toContain('Revenue: **₹1,12,500**');
    expect(text).toContain('Worker pay: **−₹28,500**');
    expect(text).toContain('Commissions: **−₹0** (per-task ₹0 + one-time bonuses ₹0)');
    expect(text).toContain('💎 **Saved (net): ₹84,000**');
  });

  it('stays inside Discord message limits even for extreme inputs', () => {
    const text = buildOwnerDigestMessage(
      input({
        cohort: { total: 999999, posts: 999000, comments: 999, completed: 900000, deleted: 90000, open: 9999 },
        money: {
          revenue: 999999999,
          workerCost: 12345678,
          perTaskCommissions: 999999,
          oneTimeBonuses: 888888,
          saved: 999999999 - 12345678 - 999999 - 888888,
        },
      }),
    );
    expect(text.length).toBeLessThan(2000);
  });

  it('renders an empty week without throwing', () => {
    const text = buildOwnerDigestMessage(
      input({
        cohort: { total: 0, posts: 0, comments: 0, completed: 0, deleted: 0, open: 0 },
        money: { revenue: 0, workerCost: 0, perTaskCommissions: 0, oneTimeBonuses: 0, saved: 0 },
      }),
    );
    expect(text).toContain('**Tasks created:** 0 (posts 0 · comments 0)');
    expect(text).toContain('💎 **Saved (net): ₹0**');
  });

  it('refuses to render cohorts that do not reconcile', () => {
    expect(() =>
      buildOwnerDigestMessage(
        input({ cohort: { total: 87, posts: 41, comments: 46, completed: 61, deleted: 9, open: 16 } }),
      ),
    ).toThrow(/reconcile/);
  });

  it('refuses to render money that does not reconcile', () => {
    expect(() =>
      buildOwnerDigestMessage(
        input({
          money: {
            revenue: 11250,
            workerCost: 3720,
            perTaskCommissions: 1100,
            oneTimeBonuses: 240,
            saved: 1,
          },
        }),
      ),
    ).toThrow(/reconcile/);
  });
});
