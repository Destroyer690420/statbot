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
});
