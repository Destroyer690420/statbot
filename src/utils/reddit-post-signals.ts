/**
 * Pure Reddit post-signal extraction (no I/O — safe for unit tests).
 *
 * Phase 0 of the removal-state work: before the bot acts on (or even names)
 * a post's removal state, we record exactly which signals Reddit's authed
 * `.json` exposes for each real-world state. `fetchRedditPost` today reads
 * only title/selftext/author/subreddit; this module reads the full removal
 * field set so the Phase 0 probe can dump it, and Phase 1 will reuse it to
 * build the precise verdict.
 *
 * Field notes (old.reddit + www, authenticated as a non-mod third party):
 * - `removed_by_category`: Reddit's own token when it strips a post
 *   (`"moderator"`, `"automod_filtered"`, `"reddit"`, `"deleted"`, `"author"`,
 *   or null when the post stands). This is the primary discriminator.
 * - `banned_by`: who actioned it (`true`/username) or null/False.
 * - `approved` / `approved_by` / `approved_at_utc`: set once a mod approves.
 * - `removal_reason` / `mod_reason_title`: free-text reason when given.
 * - A user-deleted post keeps its shell with author/title/selftext redacted
 *   to `[deleted]`; a never-existed id returns an empty listing or 404.
 */

export interface RedditPostSignals {
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  /** Raw removal tokens, exactly as Reddit sent them (null when absent). */
  removedByCategory: string | null;
  bannedBy: string | null;
  approved: boolean | null;
  approvedBy: string | null;
  approvedAtUtc: number | null;
  bannedAtUtc: number | null;
  removalReason: string | null;
  modReasonTitle: string | null;
  distinguished: string | null;
  locked: boolean | null;
  archived: boolean | null;
  spam: boolean | null;
  numReports: number | null;
  over18: boolean | null;
  createdUtc: number | null;
  /** Every key present on the raw object (drift detector for the matrix). */
  rawKeys: string[];
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  return v;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

function asBoolean(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

/**
 * Pulls the signal set out of one `.json` post object
 * (`listing[0].data.children[0].data`). Returns null when the shape is not a
 * post at all (empty listing, comment-only payload, HTML shell) — the caller
 * records *that* as its own signal (missing/empty/unparseable).
 */
export function summarizeRawPost(post: unknown): RedditPostSignals | null {
  if (!post || typeof post !== 'object') return null;
  const p = post as Record<string, unknown>;
  // A real post object always carries at least a name/subreddit/id triple.
  if (typeof p.name !== 'string' || typeof p.subreddit !== 'string') return null;
  const bannedByRaw = p.banned_by;
  return {
    title: typeof p.title === 'string' ? p.title : '',
    selftext: typeof p.selftext === 'string' ? p.selftext : '',
    author: typeof p.author === 'string' ? p.author : '',
    subreddit: p.subreddit,
    removedByCategory: asString(p.removed_by_category),
    bannedBy:
      bannedByRaw === true ? 'true' : bannedByRaw === false ? null : asString(bannedByRaw),
    approved: asBoolean(p.approved),
    approvedBy: asString(p.approved_by),
    approvedAtUtc: asNumber(p.approved_at_utc),
    bannedAtUtc: asNumber(p.banned_at_utc),
    removalReason: asString(p.removal_reason),
    modReasonTitle: asString(p.mod_reason_title),
    distinguished: asString(p.distinguished),
    locked: asBoolean(p.locked),
    archived: asBoolean(p.archived),
    spam: asBoolean(p.spam),
    numReports: asNumber(p.num_reports),
    over18: asBoolean(p.over_18),
    createdUtc: asNumber(p.created_utc),
    rawKeys: Object.keys(p).sort(),
  };
}

/**
 * One-line human summary for the Phase 0 matrix: markers + removal tokens.
 * Pure formatting — the verdict rules come in Phase 1, after the probe.
 */
export function describeSignals(s: RedditPostSignals): string {
  const markers: string[] = [];
  const blob = `${s.title}\n${s.selftext}\n${s.author}`;
  if (blob.includes('[removed]')) markers.push('has[removed]');
  if (blob.includes('[deleted]')) markers.push('has[deleted]');
  const tokens: string[] = [];
  if (s.removedByCategory) tokens.push(`removed_by_category=${s.removedByCategory}`);
  if (s.bannedBy) tokens.push(`banned_by=${s.bannedBy}`);
  if (s.approved === true) tokens.push(`approved(by=${s.approvedBy ?? '?'})`);
  if (s.removalReason) tokens.push(`removal_reason=${s.removalReason.slice(0, 60)}`);
  if (s.modReasonTitle) tokens.push(`mod_reason=${s.modReasonTitle.slice(0, 60)}`);
  if (s.spam === true) tokens.push('spam=true');
  return [...markers, ...tokens].join(' | ') || 'stands (no markers, no removal tokens)';
}

/**
 * Precise removal state, derived ONLY from probed signals
 * (`docs/REMOVAL_SIGNALS.md`). Phase 1 of the removal-state work.
 *
 * Certainty discipline (a wrong verdict auto-marks tasks in Phase 3, so the
 * default is LIVE unless the evidence is explicit):
 * - `approved === true` always wins → LIVE (a mod put it back up, even if a
 *   stale removal token lingers).
 * - A `[deleted]` author ALONE (full content, no category) → LIVE: the
 *   account is gone but the post stands (`REMOVAL_SIGNALS.md` rule 4).
 * - Post-state evidence outranks account-state: a `removed_by_category`
 *   token decides the bucket even when the author is also `[deleted]` (the
 *   token describes the post's visibility; the author field describes the
 *   account).
 * - Any other non-null `removed_by_category` we have not observed live
 *   (`automod_filtered` counts as filter) lands in REMOVED_OTHER, never in a
 *   named bucket we cannot prove.
 */
export type RemovalState =
  | 'LIVE'
  | 'DELETED_BY_USER'
  | 'REMOVED_BY_MODS'
  | 'REMOVED_BY_FILTER'
  | 'REMOVED_OTHER';

function isRedactedExact(text: string): boolean {
  const val = text.trim();
  return val === '[deleted]' || val === '[removed]';
}

/** `[ Removed by moderator ]` and case/spacing variants (probed 2026-10-08). */
function isModRemovalTitle(title: string): boolean {
  return /^\[\s*removed\s+by\s+moderator\s*\]$/i.test(title.trim());
}

export function classifyRemoval(s: RedditPostSignals): RemovalState {
  // A mod approval puts the post back up — trust it over stale tokens.
  if (s.approved === true) return 'LIVE';

  const titleGone = isRedactedExact(s.title) || isModRemovalTitle(s.title);
  const textGone = isRedactedExact(s.selftext);
  const authorGone = s.author.trim() === '[deleted]';
  const category = (s.removedByCategory || '').toLowerCase();

  // Account gone but content fully standing: not a deletion signal.
  if (authorGone && !titleGone && !textGone && !category) return 'LIVE';

  if (!titleGone && !textGone && !authorGone) return 'LIVE';

  if (category === 'moderator' || isModRemovalTitle(s.title)) return 'REMOVED_BY_MODS';
  if (category === 'deleted' || category === 'author') return 'DELETED_BY_USER';
  if (category === 'reddit' || category === 'automod_filtered') return 'REMOVED_BY_FILTER';
  if (authorGone && (titleGone || textGone)) return 'DELETED_BY_USER';
  if (titleGone || textGone) {
    if (category && category !== 'null') return 'REMOVED_OTHER';
    // Bare redaction markers with no token: historically user deletion, and
    // this is exactly what production already treats as deleted.
    return 'DELETED_BY_USER';
  }
  return 'LIVE';
}
