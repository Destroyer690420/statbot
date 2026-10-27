/**
 * Pure week math for the weekly owner digest. The digest week runs
 * Thursday 00:00 IST → Wednesday 24:00 IST (owner requirement), and the DM is
 * sent Thursday 00:10 IST — ten minutes after the week closes, so the whole
 * Wednesday is inside the window.
 *
 * The week KEY is the ISO date (IST) of the THURSDAY THE WEEK STARTS ON,
 * e.g. the week [2026-10-15 → 2026-10-22) has key '2026-10-15'. The key is
 * the exactly-once unit: one DIGEST_SENT audit row per key.
 *
 * Zero imports — safe for unit tests (the digest service pulls the DB layer,
 * which validates env at import time). IST has no DST; fixed offset.
 */

export const DIGEST_IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
/** The digest week starts on Thursday (getUTCDay: Sun=0 … Thu=4). */
export const DIGEST_SEND_DOW_IST = 4;
/** Fire time, IST wall clock on Thursday: 00:10 (after the week closes). */
export const DIGEST_SEND_HOUR_IST = 0;
export const DIGEST_SEND_MIN_IST = 10;
/** A late fire serves the week within seconds, never instantly (ordering). */
export const DIGEST_LATE_DELAY_MS = 5 * 1000;
/**
 * Boot later than this after the send moment does NOT catch up a missed
 * week — a deploy days after a restart would otherwise DM a stale week out
 * of nowhere. Within the grace (e.g. the app was down at Thursday 00:10 and
 * came back the same morning) the missed week is still delivered late.
 */
export const DIGEST_CATCHUP_GRACE_MS = 24 * 60 * 60 * 1000;
/** Audit details prefix; the week key follows it. */
export const DIGEST_AUDIT_PREFIX = 'owner-digest:';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DigestPlan {
  /** ms from nowMs until the trigger should fire. */
  delayMs: number;
  /** Week key being served (exactly-once guard). */
  key: string;
  /** True when the send moment already passed (boot catch-up within grace). */
  late: boolean;
}

interface IstParts {
  y: number;
  mo: number;
  d: number;
  dow: number;
}

function istParts(epochMs: number): IstParts {
  const d = new Date(epochMs + DIGEST_IST_OFFSET_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() };
}

function keyOf(p: IstParts): string {
  return `${p.y}-${String(p.mo + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Thursday 00:10 IST of the IST date given as y/mo/d (0-based month), as a UTC instant. */
function sendMoment(y: number, mo: number, d: number): number {
  return Date.UTC(y, mo, d, DIGEST_SEND_HOUR_IST, DIGEST_SEND_MIN_IST, 0, 0) - DIGEST_IST_OFFSET_MS;
}

/**
 * Pure next-fire computation for the weekly digest.
 *
 * The candidate is always this (IST) week's Thursday 00:10. Before it: fire
 * then, serving the week that started the Thursday before. After it: the week
 * whose send moment just passed is served LATE (within the catch-up grace)
 * unless the caller already served it (`skipKey`); otherwise the next
 * Thursday is scheduled. Month/year rollover handled by decomposition, never
 * manual +1 day. Never throws — callers must never break boot on a clock
 * anomaly.
 */
export function planNextDigest(nowMs: number, skipKey?: string | null): DigestPlan {
  try {
    if (!Number.isFinite(nowMs)) throw new Error('non-finite clock');
    const p = istParts(nowMs);
    const daysSinceThursday = (p.dow - DIGEST_SEND_DOW_IST + 7) % 7;
    const thisSend = sendMoment(p.y, p.mo, p.d - daysSinceThursday);
    // The week served at thisSend started the Thursday before it.
    const servedWeekStart = istParts(thisSend - 7 * DAY_MS);
    const candidateKey = keyOf(servedWeekStart);

    if (thisSend > nowMs) {
      return { delayMs: thisSend - nowMs, key: candidateKey, late: false };
    }
    if (candidateKey !== skipKey && nowMs - thisSend < DIGEST_CATCHUP_GRACE_MS) {
      return { delayMs: DIGEST_LATE_DELAY_MS, key: candidateKey, late: true };
    }
    // Already served (or far too late): next Thursday, decomposed +7 days.
    const n = istParts(thisSend + 7 * DAY_MS);
    const nextSend = sendMoment(n.y, n.mo, n.d);
    const nextServedWeekStart = istParts(nextSend - 7 * DAY_MS);
    const delayMs = nextSend - nowMs;
    return {
      delayMs: Number.isFinite(delayMs) && delayMs > 1000 ? delayMs : 1000,
      key: keyOf(nextServedWeekStart),
      late: false,
    };
  } catch {
    // Clock anomaly: retry in a minute, never crash the chain.
    return { delayMs: 60 * 1000, key: `retry-${Date.now()}`, late: false };
  }
}

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseKeyParts(key: string): IstParts {
  if (!KEY_RE.test(key)) throw new Error(`Invalid digest week key: ${key}`);
  const [y, mo, d] = key.split('-').map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d) + DIGEST_IST_OFFSET_MS).getUTCDay();
  if (dow !== DIGEST_SEND_DOW_IST) throw new Error(`Digest week key must be a Thursday (IST): ${key}`);
  return { y, mo: mo - 1, d, dow };
}

/**
 * UTC instants of the digest week for a key: [Thursday 00:00 IST, next
 * Thursday 00:00 IST). The end is inclusive-compatible with the rest of the
 * codebase (…23:59:59.999 IST), so a task stamped exactly on the boundary
 * instant can never fall into two weeks.
 */
export function digestWindowFromKey(key: string): { startUTC: Date; endUTC: Date } {
  const p = parseKeyParts(key);
  const startMs = Date.UTC(p.y, p.mo, p.d, 0, 0, 0, 0) - DIGEST_IST_OFFSET_MS;
  const endMs = Date.UTC(p.y, p.mo, p.d + 7, 0, 0, 0, 0) - DIGEST_IST_OFFSET_MS - 1;
  return { startUTC: new Date(startMs), endUTC: new Date(endMs) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function istLabel(epochMs: number): string {
  const ist = new Date(epochMs + DIGEST_IST_OFFSET_MS);
  return `${DOWS[ist.getUTCDay()]} ${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
}

/** 'Thu 15 Oct 2026' → 'Wed 21 Oct 2026' pair for the digest header. */
export function describeDigestWeek(key: string): { startLabel: string; endLabel: string } {
  const { startUTC, endUTC } = digestWindowFromKey(key);
  return { startLabel: istLabel(startUTC.getTime()), endLabel: istLabel(endUTC.getTime()) };
}

/**
 * The key of the most recently COMPLETED digest week as of nowMs (the window
 * has fully ended even if its send moment has not been reached yet). Used by
 * the one-off test script to pick "last week".
 */
export function lastCompletedDigestWeekKey(nowMs: number = Date.now()): string {
  const p = istParts(nowMs);
  const daysSinceThursday = (p.dow - DIGEST_SEND_DOW_IST + 7) % 7;
  // Most recent Thursday 00:00 IST (today when today IS Thursday).
  const thisThursdayStart = Date.UTC(p.y, p.mo, p.d - daysSinceThursday, 0, 0, 0, 0) - DIGEST_IST_OFFSET_MS;
  return keyOf(istParts(thisThursdayStart - 7 * DAY_MS));
}

/** 'owner-digest:2026-10-15 …' → '2026-10-15', else null. */
export function parseDigestAuditDetails(details: string | null | undefined): string | null {
  if (!details || !details.startsWith(DIGEST_AUDIT_PREFIX)) return null;
  const key = details.slice(DIGEST_AUDIT_PREFIX.length).split(' ')[0];
  return KEY_RE.test(key) ? key : null;
}
