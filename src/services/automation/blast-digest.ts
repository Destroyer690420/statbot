import type { BurstTaskInput } from './burst.service';
import { normalizeSubreddit } from './subreddit';

/**
 * Pre-blast DM digest — pure logic for the manager phone-approval flow.
 *
 * After a settled auto-report (no blast opened), the bot DMs the manager a
 * digest of the drop with Blast / Hold / per-subreddit Block buttons. All
 * set comparisons use exact normalized subreddits, mirroring the validator.
 * Pure module — no env, DB, or Discord needed.
 */

export interface DigestTaskLog {
  externalTaskId: string;
  taskType: string;
  subreddit: string | null;
  status: string;
}

export interface DigestSub {
  /** Normalized subreddit. */
  sub: string;
  count: number;
  /** Up to 3 sample task ids for the message. */
  ids: string[];
}

export interface BlastDigest {
  cycleId: string;
  scanned: number;
  eligible: number;
  blocked: number;
  /** Eligible subs in first-seen order. */
  subs: DigestSub[];
  /** Eligible subs never seen before and not blocked — need review. */
  newSubs: string[];
}

export type BlastButtonAction = 'go' | 'hold' | 'block';

export interface ButtonSpec {
  action: BlastButtonAction;
  label: string;
  /** 'primary' | 'secondary' | 'danger' — mapped to discord.js styles by the service. */
  style: 'primary' | 'secondary' | 'danger';
  customId: string;
}

/** Max block buttons rendered in the DM (Discord caps at 5 rows x 5). */
export const MAX_BLOCK_BUTTONS = 20;

/** Task-log statuses that count as validated-eligible in a settled report. */
export function isEligibleLogStatus(status: string): boolean {
  return status === 'ELIGIBLE';
}

function normalizeSet(values: readonly (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const v of values) {
    const n = normalizeSubreddit(v);
    if (n) out.add(n);
  }
  return out;
}

/**
 * Builds the digest for one settled cycle. `logs` are the cycle's task
 * logs, `blockedSubs` the current blocked list, `seenSubs` subreddits from
 * any prior scan (seen-history). Counts mirror the cycle row.
 */
export function buildBlastDigest(
  cycleId: string,
  logs: DigestTaskLog[],
  blockedSubs: readonly (string | null | undefined)[],
  seenSubs: readonly (string | null | undefined)[],
  counts: { scanned: number; eligible: number; blocked: number },
): BlastDigest {
  const blocked = normalizeSet(blockedSubs);
  const seen = normalizeSet(seenSubs);
  const subs: DigestSub[] = [];
  const bySub = new Map<string, DigestSub>();
  for (const log of logs) {
    if (!log || !isEligibleLogStatus(log.status)) continue;
    const norm = normalizeSubreddit(log.subreddit);
    if (!norm) continue;
    let entry = bySub.get(norm);
    if (!entry) {
      entry = { sub: norm, count: 0, ids: [] };
      bySub.set(norm, entry);
      subs.push(entry);
    }
    entry.count += 1;
    if (entry.ids.length < 3) entry.ids.push(log.externalTaskId);
  }
  const newSubs = subs.filter((s) => !blocked.has(s.sub) && !seen.has(s.sub)).map((s) => s.sub);
  return { cycleId, scanned: counts.scanned, eligible: counts.eligible, blocked: counts.blocked, subs, newSubs };
}

/** One-line-per-sub breakdown, capped to fit a 2000-char DM. */
export function formatDigestMessage(digest: BlastDigest): string {
  const lines: string[] = [
    `Drop ${digest.cycleId}: ${digest.eligible} eligible (${digest.scanned} scanned, ${digest.blocked} blocked)`,
  ];
  for (const s of digest.subs) {
    lines.push(`• r/${s.sub} x${s.count} (${s.ids.join(', ')})`);
  }
  if (digest.newSubs.length > 0) {
    lines.push(`NEW - never seen before: ${digest.newSubs.map((s) => `r/${s}`).join(', ')}`);
    lines.push('Hold + review, or block a sub above. Tapping Blast releases the current set.');
  } else {
    lines.push('No new subreddits. Tap Blast to release, Hold to skip this round.');
  }
  let text = lines.join('\n');
  if (text.length > 1900) text = `${text.slice(0, 1900)}…`;
  return text;
}

/** Row 0: Blast + Hold. Following rows: Block buttons (capped). */
export function buildDigestButtons(digest: BlastDigest): ButtonSpec[][] {
  const rows: ButtonSpec[][] = [
    [
      { action: 'go', label: 'Blast now', style: 'primary', customId: `blast:go:${digest.cycleId}` },
      { action: 'hold', label: 'Hold', style: 'secondary', customId: `blast:hold:${digest.cycleId}` },
    ],
  ];
  const subs = digest.newSubs.slice(0, MAX_BLOCK_BUTTONS);
  let row: ButtonSpec[] = [];
  for (const sub of subs) {
    row.push({
      action: 'block',
      label: `Block r/${sub}`.slice(0, 80),
      style: 'danger',
      customId: `blast:block:${digest.cycleId}:${sub}`,
    });
    if (row.length === 5) {
      rows.push(row);
      if (rows.length === 5) break;
      row = [];
    }
  }
  if (row.length > 0 && rows.length < 5) rows.push(row);
  return rows;
}

export interface ParsedBlastButton {
  action: BlastButtonAction;
  cycleId: string;
  /** Normalized subreddit for block buttons. */
  sub: string | null;
}

const CYCLE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SUB_RE = /^[a-z0-9_]{1,32}$/;

/**
 * Strict parse of a blast DM button id (`blast:<go|hold|block>:<cycleId>[:<sub>]`).
 * Colons separate fields because cycle ids and subs never contain them.
 * Returns null on any mismatch.
 */
export function parseBlastButtonId(customId: string): ParsedBlastButton | null {
  if (typeof customId !== 'string') return null;
  const parts = customId.split(':');
  if (parts.length < 3 || parts.length > 4 || parts[0] !== 'blast') return null;
  const action = parts[1];
  if (action !== 'go' && action !== 'hold' && action !== 'block') return null;
  const cycleId = parts[2];
  if (!CYCLE_ID_RE.test(cycleId)) return null;
  if (action === 'block') {
    if (parts.length !== 4 || !SUB_RE.test(parts[3])) return null;
    return { action, cycleId, sub: parts[3] };
  }
  if (parts.length !== 3) return null;
  return { action, cycleId, sub: null };
}

/**
 * Release inputs for an approved round: validated-eligible logs,
 * newest-first (matches the watcher report order, so winner 1 gets the
 * newest post). Titles are unavailable in task logs — null, same as a
 * fresh scan before extraction.
 */
export function buildReleaseInputs(logs: DigestTaskLog[]): BurstTaskInput[] {
  return [...logs]
    .reverse()
    .filter((l) => l && isEligibleLogStatus(l.status))
    .map((l) => ({
      subTaskId: l.externalTaskId,
      type: (l.taskType === 'comment' ? 'comment' : 'post') as 'post' | 'comment',
      subreddit: normalizeSubreddit(l.subreddit),
      title: null,
    }));
}
