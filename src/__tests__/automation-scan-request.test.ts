/**
 * On-demand `/scan` request store. Pure in-memory module — no env or DB.
 * Pins: oldest-first pickup, atomic first-wins consume, live+consumed
 * routing (forged ids stay unknown), and test-hook reset.
 */
import {
  clearRequests,
  clearScanCooldown,
  consumeRequest,
  isConsumedRequest,
  isKnownRequest,
  isScanRetry,
  pendingRequest,
  requestScan,
  requestScanCommand,
  takeRequest,
  wasRequested,
} from '../services/automation/scan-request.service';

beforeEach(() => {
  clearRequests();
  clearScanCooldown();
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

describe('wasRequested (duplicate-report silence)', () => {
  it('is true for live and consumed ids, false for forged ones', () => {
    const req = requestScan('user-1');
    expect(wasRequested(req.requestId)).toBe(true);
    expect(isConsumedRequest(req.requestId)).toBe(false);
    takeRequest(req.requestId);
    expect(wasRequested(req.requestId)).toBe(true);
    expect(isConsumedRequest(req.requestId)).toBe(true);
    expect(wasRequested('req-forged-123')).toBe(false);
    expect(isConsumedRequest('req-forged-123')).toBe(false);
  });

  it('must NOT route freshCycleOnly: consumed ids stay true (2026-10-10 stranded-message incident)', () => {
    // The /burst route claims the request with takeRequest BEFORE the flow:
    // the winner gets its own cycle + manual DM, same-id duplicates get null
    // and merge into the hour blast. Routing on wasRequested instead opened
    // one competing blast per tab, each supersede-closing the previous
    // without cleanup (~50 stranded loser messages per blast).
    const req = requestScan('hourly');
    expect(takeRequest(req.requestId)?.requestId).toBe(req.requestId);
    expect(takeRequest(req.requestId)).toBeNull();
    expect(wasRequested(req.requestId)).toBe(true);
  });
});

describe('requestScanCommand (shared trigger)', () => {
  it('creates a request on first trigger', () => {
    const result = requestScanCommand('user-1');
    expect(isScanRetry(result)).toBe(false);
    if (!isScanRetry(result)) {
      expect(result.reused).toBe(false);
      expect(result.request.requestedBy).toBe('user-1');
    }
  });

  it('reuses the waiting request instead of queueing twice', () => {
    const first = requestScanCommand('user-1');
    clearScanCooldown();
    const second = requestScanCommand('user-2');
    if (!isScanRetry(first) && !isScanRetry(second)) {
      expect(second.request.requestId).toBe(first.request.requestId);
      expect(second.reused).toBe(true);
    } else {
      throw new Error('expected two live requests');
    }
  });

  it('enforces a per-user cooldown', () => {
    requestScanCommand('user-1');
    const retry = requestScanCommand('user-1');
    expect(isScanRetry(retry)).toBe(true);
  });
});
