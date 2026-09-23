/**
 * On-demand scan requests (DM-text "scan" + scheduled hourly trigger).
 *
 * The scan itself lives in the manager's browser tabs — the server cannot
 * scan GoPartTime directly. A request created here rides the next
 * `GET /claims/pending` poll (`scanNow`), the watcher performs one immediate
 * full scan + settled `/burst` report tagged with the request id, and the
 * first such report consumes the request (second tab's same-id report merges
 * as a normal duplicate). Expiry is lazy: a request older than
 * SCAN_REQUEST_TTL_MS is invisible and swept on next access.
 */
import { randomUUID } from 'node:crypto';

export interface ScanRequest {
  requestId: string;
  requestedBy: string;
  requestedAt: number;
}

const SCAN_REQUEST_TTL_MS = 10 * 60 * 1000;

const requests = new Map<string, ScanRequest>();
// Consumed request ids (with consume timestamps): the second tab's same-id
// report must still count as "manual" (answered by the manual DM / silence)
// even though the live entry is gone. Swept lazily with the live map.
const consumed = new Map<string, number>();

function sweepExpired(now: number): void {
  for (const [id, req] of requests) {
    if (now - req.requestedAt > SCAN_REQUEST_TTL_MS) requests.delete(id);
  }
  for (const [id, at] of consumed) {
    if (now - at > SCAN_REQUEST_TTL_MS) consumed.delete(id);
  }
}

/** Creates a scan request. Returns the request the watcher will pick up. */
export function requestScan(requestedBy: string): ScanRequest {
  const now = Date.now();
  sweepExpired(now);
  const req: ScanRequest = {
    requestId: `req-${now.toString(36)}-${randomUUID().slice(0, 8)}`,
    requestedBy,
    requestedAt: now,
  };
  requests.set(req.requestId, req);
  return req;
}

/** The oldest live request, or null when none is waiting. */
export function pendingRequest(): ScanRequest | null {
  const now = Date.now();
  sweepExpired(now);
  let oldest: ScanRequest | null = null;
  for (const req of requests.values()) {
    if (!oldest || req.requestedAt < oldest.requestedAt) oldest = req;
  }
  return oldest;
}

/**
 * Atomically consumes a request. Returns true only for the first caller —
 * the winning tab's report; later same-id reports merge as duplicates.
 * Records the consume so wasRequested/isConsumedRequest stay consistent.
 */
export function consumeRequest(requestId: string): boolean {
  const now = Date.now();
  const req = requests.get(requestId);
  if (!req) return false;
  requests.delete(requestId);
  consumed.set(requestId, now);
  if (now - req.requestedAt > SCAN_REQUEST_TTL_MS) {
    return false;
  }
  return true;
}

/** True when the id is (or was) a known live request. Never throws. */
export function isKnownRequest(requestId: string): boolean {
  try {
    return requests.has(requestId);
  } catch {
    return false;
  }
}

/**
 * Atomically takes a request (get + delete). Returns the request only for
 * the first caller — the winning tab's report; later same-id reports merge
 * as duplicates. Returns null for unknown or expired ids.
 */
export function takeRequest(requestId: string): ScanRequest | null {
  const now = Date.now();
  const req = requests.get(requestId);
  if (!req) return null;
  requests.delete(requestId);
  consumed.set(requestId, now);
  if (now - req.requestedAt > SCAN_REQUEST_TTL_MS) return null;
  return req;
}

/** True when the id is a live or already-consumed request (never a forged
 *  or ancient id). Used to route same-id duplicate reports to silence. */
export function wasRequested(requestId: string): boolean {
  const now = Date.now();
  sweepExpired(now);
  return requests.has(requestId) || consumed.has(requestId);
}

/** True when the id was already consumed by a report (hourly watchdog). */
export function isConsumedRequest(requestId: string): boolean {
  try {
    return consumed.has(requestId);
  } catch {
    return false;
  }
}

/** Test hook: clears all requests. */
export function clearRequests(): void {
  requests.clear();
  consumed.clear();
}

// Shared trigger logic for every on-demand surface (DM text, hourly).
// Per-user cooldown against accidental double-taps; an already-waiting
// request is REUSED (never queued twice), so two triggers can never
// produce two digest DMs.
const SCAN_COMMAND_COOLDOWN_MS = 60 * 1000;
const lastScanAt = new Map<string, number>();

export type ScanCommandResult =
  | { request: ScanRequest; reused: boolean }
  | { retryAfterSec: number };

export function isScanRetry(result: ScanCommandResult): result is { retryAfterSec: number } {
  return (result as { retryAfterSec: number }).retryAfterSec !== undefined;
}

export function requestScanCommand(userId: string): ScanCommandResult {
  const now = Date.now();
  const last = lastScanAt.get(userId) ?? 0;
  if (now - last < SCAN_COMMAND_COOLDOWN_MS) {
    return { retryAfterSec: Math.ceil((SCAN_COMMAND_COOLDOWN_MS - (now - last)) / 1000) };
  }
  const waiting = pendingRequest();
  if (waiting) {
    lastScanAt.set(userId, now);
    return { request: waiting, reused: true };
  }
  lastScanAt.set(userId, now);
  return { request: requestScan(userId), reused: false };
}

/** Test hook: clears the per-user trigger cooldown. */
export function clearScanCooldown(): void {
  lastScanAt.clear();
}
