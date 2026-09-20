/**
 * On-demand `/scan` request store. Pure in-memory module — no env or DB.
 * Pins: oldest-first pickup, atomic first-wins consume, live+consumed
 * routing (forged ids stay unknown), and test-hook reset.
 */
import {
  clearRequests,
  consumeRequest,
  isKnownRequest,
  pendingRequest,
  requestScan,
  takeRequest,
  wasRequested,
} from '../services/automation/scan-request.service';

beforeEach(() => {
  clearRequests();
});

describe('requestScan / pendingRequest', () => {
  it('returns null when nothing is waiting', () => {
    expect(pendingRequest()).toBeNull();
  });

  it('picks up the created request', () => {
    const req = requestScan('user-1');
    expect(req.requestId.length).toBeGreaterThan(0);
    expect(pendingRequest()?.requestId).toBe(req.requestId);
  });
});

describe('takeRequest (atomic first-wins)', () => {
  it('first taker wins, second gets null', () => {
    const req = requestScan('user-1');
    const first = takeRequest(req.requestId);
    expect(first?.requestedBy).toBe('user-1');
    expect(takeRequest(req.requestId)).toBeNull();
    expect(pendingRequest()).toBeNull();
  });

  it('unknown ids take nothing', () => {
    expect(takeRequest('req-nope')).toBeNull();
  });
});

describe('consumeRequest / isKnownRequest', () => {
  it('consumes live ids once', () => {
    const req = requestScan('user-1');
    expect(isKnownRequest(req.requestId)).toBe(true);
    expect(consumeRequest(req.requestId)).toBe(true);
    expect(consumeRequest(req.requestId)).toBe(false);
    expect(isKnownRequest(req.requestId)).toBe(false);
  });
});

describe('wasRequested (manual-report routing)', () => {
  it('is true for live and consumed ids, false for forged ones', () => {
    const req = requestScan('user-1');
    expect(wasRequested(req.requestId)).toBe(true);
    takeRequest(req.requestId);
    expect(wasRequested(req.requestId)).toBe(true);
    expect(wasRequested('req-forged-123')).toBe(false);
  });
});
