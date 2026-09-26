/**
 * Phase-2 parallel-tab claim leasing picker. Pure module — no env or DB
 * needed. The repository enforces the same rule atomically in its UPDATE
 * guard; these tests pin the selection semantics.
 */
import { isLeaseFree, pickLeaseCandidate, LeaseCandidate } from '../services/automation/claim-lease';

const LEASE_MS = 3 * 60 * 1000;
const NOW = new Date('2026-09-16T12:00:00.000Z').getTime();

function claim(overrides: Partial<LeaseCandidate> & { id: string }): LeaseCandidate {
  return {
    status: 'PENDING',
    createdAt: new Date(NOW - 60000),
    expiresAt: new Date(NOW + 3600000),
    leasedBy: null,
    leasedAt: null,
    ...overrides,
  };
}

describe('isLeaseFree', () => {
  it('is free when never leased', () => {
    expect(isLeaseFree({ leasedBy: null, leasedAt: null }, NOW, LEASE_MS)).toBe(true);
  });

  it('is held while another tab leases it', () => {
    expect(
      isLeaseFree({ leasedBy: 'tab-a', leasedAt: new Date(NOW - 10000) }, NOW, LEASE_MS),
    ).toBe(false);
  });

  it('is free once the lease lapses (stuck-tab reclaim)', () => {
    expect(
      isLeaseFree({ leasedBy: 'tab-a', leasedAt: new Date(NOW - LEASE_MS) }, NOW, LEASE_MS),
    ).toBe(true);
    expect(
      isLeaseFree({ leasedBy: 'tab-a', leasedAt: new Date(NOW - LEASE_MS - 1) }, NOW, LEASE_MS),
    ).toBe(true);
  });

  it('treats a lease marker without timestamp as free (defensive)', () => {
    expect(isLeaseFree({ leasedBy: 'tab-a', leasedAt: null }, NOW, LEASE_MS)).toBe(true);
  });

  it('is free for the holding tab itself (parked-claim retry)', () => {
    // The regression this pins: a tab that left its claim PENDING across a
    // reload / return-to-/tasks must be able to re-lease it on its very next
    // poll, not wait out the whole lease timeout.
    expect(
      isLeaseFree({ leasedBy: 'tab-a', leasedAt: new Date(NOW - 1000) }, NOW, LEASE_MS, 'tab-a'),
    ).toBe(true);
  });

  it('still holds a live lease against every other tab', () => {
    expect(
      isLeaseFree({ leasedBy: 'tab-a', leasedAt: new Date(NOW - 1000) }, NOW, LEASE_MS, 'tab-b'),
    ).toBe(false);
  });

  it('never lets an empty asking tab claim someone else live lease', () => {
    // An empty tab id carries no identity, so it must not match a holder -
    // and an empty lease marker is not a holder either (defensive: the route
    // rejects empty tab ids, so this shape never reaches the picker).
    expect(isLeaseFree({ leasedBy: null, leasedAt: null }, NOW, LEASE_MS, '')).toBe(true);
    expect(isLeaseFree({ leasedBy: 'tab-a', leasedAt: new Date(NOW) }, NOW, LEASE_MS, '')).toBe(false);
  });
});

describe('pickLeaseCandidate', () => {
  it('returns null for an empty pool', () => {
    expect(pickLeaseCandidate([], NOW, LEASE_MS)).toBeNull();
  });

  it('picks the oldest PENDING unexpired claim regardless of input order', () => {
    const newer = claim({ id: 'new', createdAt: new Date(NOW - 10000) });
    const older = claim({ id: 'old', createdAt: new Date(NOW - 50000) });
    expect(pickLeaseCandidate([newer, older], NOW, LEASE_MS)?.id).toBe('old');
    expect(pickLeaseCandidate([older, newer], NOW, LEASE_MS)?.id).toBe('old');
  });

  it('skips non-PENDING and expired claims', () => {
    const pool = [
      claim({ id: 'claimed', status: 'CLAIMED' }),
      claim({ id: 'failed', status: 'FAILED' }),
      claim({ id: 'expired', expiresAt: new Date(NOW - 1000) }),
      claim({ id: 'edge-expired', expiresAt: new Date(NOW) }),
      claim({ id: 'good', createdAt: new Date(NOW - 5000) }),
    ];
    expect(pickLeaseCandidate(pool, NOW, LEASE_MS)?.id).toBe('good');
  });

  it('skips claims held by a live tab but takes stale ones', () => {
    const pool = [
      claim({ id: 'held', leasedBy: 'tab-a', leasedAt: new Date(NOW - 10000) }),
      claim({ id: 'stale', leasedBy: 'tab-a', leasedAt: new Date(NOW - LEASE_MS - 1000) }),
    ];
    expect(pickLeaseCandidate(pool, NOW, LEASE_MS)?.id).toBe('stale');
  });

  it('returns null when everything is held or resolved', () => {
    const pool = [
      claim({ id: 'held', leasedBy: 'tab-a', leasedAt: new Date(NOW - 1000) }),
      claim({ id: 'done', status: 'CLAIMED' }),
    ];
    expect(pickLeaseCandidate(pool, NOW, LEASE_MS)).toBeNull();
  });

  it('skips malformed entries without throwing', () => {
    const pool = [null, undefined, claim({ id: 'good' })] as never[];
    expect(pickLeaseCandidate(pool, NOW, LEASE_MS)?.id).toBe('good');
  });

  it('hands the owner its own parked claim instead of stalling', () => {
    const pool = [claim({ id: 'mine', leasedBy: 'tab-a', leasedAt: new Date(NOW - 2000) })];
    expect(pickLeaseCandidate(pool, NOW, LEASE_MS, 'tab-a')?.id).toBe('mine');
    expect(pickLeaseCandidate(pool, NOW, LEASE_MS, 'tab-b')).toBeNull();
  });

  it('finishes a parked claim before taking newer work (reply order kept)', () => {
    const pool = [
      claim({ id: 'parked', leasedBy: 'tab-a', leasedAt: new Date(NOW - 2000), createdAt: new Date(NOW - 60000) }),
      claim({ id: 'fresh', createdAt: new Date(NOW - 1000) }),
    ];
    expect(pickLeaseCandidate(pool, NOW, LEASE_MS, 'tab-a')?.id).toBe('parked');
  });

  it('never hands a resolved or expired parked claim back to its owner', () => {
    const pool = [
      claim({ id: 'verdicted', status: 'CLAIMED', leasedBy: 'tab-a', leasedAt: new Date(NOW) }),
      claim({ id: 'gone', expiresAt: new Date(NOW - 1), leasedBy: 'tab-a', leasedAt: new Date(NOW) }),
    ];
    expect(pickLeaseCandidate(pool, NOW, LEASE_MS, 'tab-a')).toBeNull();
  });
});
