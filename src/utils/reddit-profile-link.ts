import {
  REDDIT_PROFILE_INFO_CHANNEL_ID,
  REDDIT_PROFILE_MIN_AGE_DAYS,
  REDDIT_PROFILE_MIN_KARMA,
  TICKET_GUIDE_CHANNEL_IDS,
  TICKET_REDDIT_PROFILE_REASK_MESSAGE,
} from '../config/constants';

/**
 * Pure logic for the ticket Reddit profile check: pulling a profile username
 * out of whatever the worker typed, totalling karma, picking the verdict, and
 * wording every message the flow sends.
 *
 * Deliberately pure. Deciding "is this actually a profile link" and "which
 * message does this worker get" is where the mistakes are expensive — a
 * post-permalink mistaken for a profile, or a banned worker told to raise
 * their karma — so all of it lives here where it is directly testable and
 * the Discord/network side stays in the services.
 */

/**
 * Lifecycle of a ticket's profile check. `null` in the database (not this
 * union) means "not enrolled", which is how the ~250 tickets that predate
 * this feature are kept untouched.
 */
export type ProfileCheckStatus =
  /** Asked on ticket creation, no usable link yet. */
  | 'PENDING'
  /** Not suspended and karma >= threshold: guide sent, admin DM'd. */
  | 'PASSED'
  /** Reddit reports the account as suspended. */
  | 'BANNED'
  /** Live account, but below the karma threshold. */
  | 'LOW_KARMA'
  /** Could not reach a verdict (no session, rate limit, unknown username). */
  | 'UNVERIFIABLE';

/** Terminal verdicts: nothing further happens in this ticket automatically. */
const TERMINAL_STATUSES: ReadonlySet<ProfileCheckStatus> = new Set<ProfileCheckStatus>(['PASSED']);

const KNOWN_STATUSES: ReadonlySet<string> = new Set<ProfileCheckStatus>([
  'PENDING',
  'PASSED',
  'BANNED',
  'LOW_KARMA',
  'UNVERIFIABLE',
]);

/**
 * Narrows the raw `TicketOnboarding.profileCheckStatus` string to the union.
 *
 * The column is TEXT (no DB enum), so an unrecognized value is possible after a
 * typo or a hand edit. Returning null makes the caller treat the ticket as
 * not enrolled, which fails safe: the worker is left alone rather than
 * something acting on a status nobody understands.
 */
export function asProfileCheckStatus(raw: string | null | undefined): ProfileCheckStatus | null {
  if (!raw) return null;
  return KNOWN_STATUSES.has(raw) ? (raw as ProfileCheckStatus) : null;
}

export function isTerminalProfileStatus(status: ProfileCheckStatus | null | undefined): boolean {
  return status != null && TERMINAL_STATUSES.has(status);
}

/** Reddit usernames: 3-20 chars, letters/digits/underscore/dash. */
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/;

/**
 * Matches a Reddit *user profile* URL, with or without a scheme, on any of
 * Reddit's hosts. Deliberately does not match post or subreddit URLs, and
 * does not match a bare word — "ok" or "done" is not a profile link, and
 * treating bare words as usernames would check a random account.
 */
const PROFILE_URL_PATTERN =
  /(?:https?:\/\/)?(?:www\.|old\.|new\.|np\.|amp\.|i\.)?reddit\.com\/(?:user|u)\/([A-Za-z0-9_-]{1,30})/gi;

/** Same, for a bare `u/name` or `/u/name` pasted without a domain. */
const BARE_PROFILE_PATH_PATTERN = /(?:^|\s|\()\/?u\/([A-Za-z0-9_-]{1,30})(?=$|\s|[)\]])/gi;

const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

function normalizeUsername(raw: string): string | null {
  const name = raw.replace(TRAILING_PUNCTUATION, '');
  return USERNAME_PATTERN.test(name) ? name : null;
}

/**
 * Pulls a Reddit profile username out of a message.
 *
 * Returns null when the message is not a profile link, AND when it names two
 * or more *different* profiles — an ambiguous message is re-asked rather than
 * guessed at, because checking the wrong account would hand a real verdict to
 * the wrong person.
 */
export function extractProfileUsername(content: string): string | null {
  if (!content) return null;

  const found = new Set<string>();

  for (const match of content.matchAll(PROFILE_URL_PATTERN)) {
    const name = normalizeUsername(match[1]);
    if (name) found.add(name.toLowerCase());
  }

  // Only consider a bare `u/name` when the message is not a full profile URL
  // we already matched — otherwise both patterns would double-count.
  if (found.size === 0) {
    for (const match of content.matchAll(BARE_PROFILE_PATH_PATTERN)) {
      const name = normalizeUsername(match[1]);
      if (name) found.add(name.toLowerCase());
    }
  }

  return found.size === 1 ? [...found][0] : null;
}

/** The pieces of Reddit's user payload this feature actually reads. */
export interface RedditProfileSummary {
  username: string;
  linkKarma: number;
  commentKarma: number;
  createdUtc?: number | null;
}

function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Total karma = link + comment. Award karma is excluded on purpose: it is not
 * what AutoModerator's karma filters count, so including it would let an
 * account pass a gate its posts would still fail.
 */
export function totalKarma(profile: Pick<RedditProfileSummary, 'linkKarma' | 'commentKarma'>): number {
  return toCount(profile.linkKarma) + toCount(profile.commentKarma);
}

export interface ProfileVerdict {
  status: Extract<ProfileCheckStatus, 'PASSED' | 'LOW_KARMA'>;
  karma: number;
  passes: boolean;
}

/** The single place the 50-karma rule is applied, so it cannot drift. */
export function evaluateKarma(profile: RedditProfileSummary, minKarma = REDDIT_PROFILE_MIN_KARMA): ProfileVerdict {
  const karma = totalKarma(profile);
  const passes = karma >= minKarma;
  return { status: passes ? 'PASSED' : 'LOW_KARMA', karma, passes };
}

/** Whole days between a Reddit `created_utc` (seconds) and now. Null when unknown. */
export function getAccountAgeDays(
  createdUtc: number | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (typeof createdUtc !== 'number' || !Number.isFinite(createdUtc) || createdUtc <= 0) return null;
  const ageMs = nowMs - createdUtc * 1000;
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  return Math.floor(ageMs / (24 * 60 * 60 * 1000));
}

/**
 * True when the account clears the minimum-age rule. A missing `created_utc`
 * never blocks: old rows and unexpected payloads fall back to the karma rule
 * alone rather than locking a worker out over a field Reddit did not send.
 */
export function isAccountOldEnough(
  createdUtc: number | null | undefined,
  nowMs: number = Date.now(),
  minAgeDays: number = REDDIT_PROFILE_MIN_AGE_DAYS,
): boolean {
  const ageDays = getAccountAgeDays(createdUtc, nowMs);
  if (ageDays === null) return true;
  return ageDays >= minAgeDays;
}

export type ProfileEligibilityReason = 'ok' | 'low_karma' | 'too_young' | 'too_young_and_low_karma';

export interface ProfileEligibility {
  passes: boolean;
  karma: number;
  ageDays: number | null;
  reason: ProfileEligibilityReason;
}

/**
 * Combined gate for a live (non-suspended) profile: karma AND age. Single
 * place both rules are applied so onboarding and the daily ban scan cannot
 * drift. `too_young_and_low_karma` is reported distinctly so the message can
 * name both bars instead of sending the worker off to fix one and failing
 * the other on the next share.
 */
export function evaluateProfileEligibility(
  profile: RedditProfileSummary,
  nowMs: number = Date.now(),
  minKarma: number = REDDIT_PROFILE_MIN_KARMA,
  minAgeDays: number = REDDIT_PROFILE_MIN_AGE_DAYS,
): ProfileEligibility {
  const karma = totalKarma(profile);
  const ageDays = getAccountAgeDays(profile.createdUtc ?? null, nowMs);
  const karmaOk = karma >= minKarma;
  const ageOk = ageDays === null ? true : ageDays >= minAgeDays;
  let reason: ProfileEligibilityReason = 'ok';
  if (!karmaOk && !ageOk) reason = 'too_young_and_low_karma';
  else if (!karmaOk) reason = 'low_karma';
  else if (!ageOk) reason = 'too_young';
  return { passes: karmaOk && ageOk, karma, ageDays, reason };
}

function infoChannelMention(): string {
  return `<#${REDDIT_PROFILE_INFO_CHANNEL_ID}>`;
}

export function formatReaskMessage(workerId: string): string {
  return TICKET_REDDIT_PROFILE_REASK_MESSAGE.replace('{user}', `<@${workerId}>`);
}

/**
 * Sent in-ticket when the account is not suspended and clears the bar.
 *
 * This is the ticket's whole pass message: the verified line and the
 * three-channel reading pointer in one short string. The channel mentions
 * come from `TICKET_GUIDE_CHANNEL_IDS` — the same list `TICKET_GUIDE_MESSAGE`
 * is built from — so the ids are never written twice.
 */
export function formatVerifiedMessage(karma: number): string {
  const [first, second, third] = TICKET_GUIDE_CHANNEL_IDS;
  return (
    `✅ verified (${karma} karma) — you're in.\n\n` +
    `Quick read before we start: <#${first}> · <#${second}> · <#${third}> (~10 min).\n` +
    `Reply "done" once you've read them and we'll get going.`
  );
}

/**
 * Sent in-ticket when the account is live but under the karma threshold.
 *
 * Two things this must not do:
 *
 * 1. Suggest creating a new account. That is the BANNED remedy; applied to a
 *    worker whose account works fine, it reads as if their account were
 *    unusable and pushes them to abandon a usable profile.
 * 2. State that the threshold is required. Hiring is allowed below it, so
 *    "you need at least N to start" is false and would gate a worker who is
 *    free to take tasks right now.
 *
 * The bar is framed as a recommendation with the alternative spelled out:
 * raise the karma, or just start hiring with what they have.
 */
export function formatLowKarmaMessage(karma: number, minKarma = REDDIT_PROFILE_MIN_KARMA): string {
  return (
    `your reddit account has only ${karma} karma. we recommend at least ${minKarma} before you start, ` +
    `but you can also start hiring with the karma your account has right now. ` +
    `you will get ₹100 per successful hire. please read ${infoChannelMention()} for more info.`
  );
}

/** DM'd to the worker when Reddit reports the account as suspended. */
export function formatBannedDmMessage(
  minAgeDays: number = REDDIT_PROFILE_MIN_AGE_DAYS,
  minKarma: number = REDDIT_PROFILE_MIN_KARMA,
): string {
  return (
    'your reddit account is banned. you can create a new account and start hiring for us — ' +
    `your new account must be at least ${minAgeDays} days old and have ${minKarma}+ karma. ` +
    'once you have it, please share the new reddit profile link in your ticket so we can verify it. ' +
    `you will get ₹100 per successful hire. please read ${infoChannelMention()} for more info.`
  );
}

/**
 * In-ticket line when a live account is too young. Kept distinct from the
 * low-karma line so the worker knows which bar they missed: a 200-karma
 * 3-day-old account needs patience, not more karma. Non-blocking like the
 * karma line — the ticket stays actionable and a re-shared link re-checks.
 */
export function formatTooYoungMessage(
  karma: number,
  ageDays: number | null,
  minAgeDays: number = REDDIT_PROFILE_MIN_AGE_DAYS,
  minKarma: number = REDDIT_PROFILE_MIN_KARMA,
): string {
  const agePart = ageDays === null ? 'your account looks too new' : `your account is only ${ageDays} day(s) old`;
  return (
    `${agePart}. we need an account at least ${minAgeDays} days old with at least ${minKarma} karma ` +
    `(you have ${karma} karma right now). you can keep this account and grow it, or start with an older one — ` +
    `just share the profile link again once it qualifies. please read ${infoChannelMention()} for more info.`
  );
}

/**
 * Worker DM sent by the daily 7am outreach ban scan when a stored profile is
 * found suspended. Names the old profile (so a worker with several accounts
 * knows which one died), states the replacement bars, and points back at the
 * ticket — the re-shared link is what re-opens the check.
 */
export function formatBanRemovalDmMessage(
  username: string,
  minAgeDays: number = REDDIT_PROFILE_MIN_AGE_DAYS,
  minKarma: number = REDDIT_PROFILE_MIN_KARMA,
): string {
  return (
    `your reddit account u/${username} is banned, so you have been removed from the daily outreach list. ` +
    `you can keep working — just share the new reddit profile link you want to work with in your ticket. ` +
    `the new account must be at least ${minAgeDays} days old and have ${minKarma}+ karma. ` +
    `please read ${infoChannelMention()} for more info.`
  );
}

/**
 * In-ticket line posted by the daily ban scan alongside the removal. Tags the
 * owner (the scan's reviewer) — never the worker, who already got a DM — and
 * names the dead profile so the ticket transcript explains why outreach
 * stopped. The worker's fallback (closed DMs) is handled by repeating the DM
 * text in the ticket instead; this line is always posted.
 */
export function formatBanRemovalTicketMessage(ownerId: string, username: string): string {
  return (
    `<@${ownerId}> ⚠️ u/${username} is banned — removed this ticket from the daily outreach list. ` +
    `the worker was DM'd to share a new profile link (14+ days old, 50+ karma) for re-verification.`
  );
}

/** In-ticket ask for outreach tickets with no stored profile username. */
export function formatMissingProfileAskMessage(workerId: string): string {
  return TICKET_REDDIT_PROFILE_REASK_MESSAGE.replace('{user}', `<@${workerId}>`);
}

/** Admin DM summary after each daily ban scan run. */
export function formatBanScanSummary(args: {
  dayKey: string;
  selectedTotal: number;
  checked: number;
  bannedCount: number;
  missingAsked: number;
  skipped: number;
  sessionIssue: boolean;
}): string {
  const lines = [
    `daily reddit ban scan — ${args.dayKey}`,
    `outreach tickets: ${args.selectedTotal} | checked: ${args.checked} | banned + removed: ${args.bannedCount} | missing-link asked: ${args.missingAsked} | skipped: ${args.skipped}`,
  ];
  if (args.bannedCount === 0 && args.missingAsked === 0 && !args.sessionIssue) {
    lines.push('nothing to do — all stored profiles are live.');
  }
  if (args.sessionIssue) {
    lines.push('⚠️ the reddit checker session failed (no session / expired / rate-limited) — no one was removed for those tickets; please check the vault.');
  }
  return lines.join('\n');
}

/**
 * DM'd to the approver when a worker passes, carrying the button that
 * selects the ticket for the daily outreach.
 *
 * This used to be posted in the ticket; it moved back to a DM so the worker
 * never sees the outreach discussion at all. Because the reader is no longer
 * looking at the ticket, the notice names it with a channel-jump link —
 * one click takes the approver straight to the right ticket, no manual
 * matching. Shaped like the `ticket:` line in `formatUnverifiableDm`.
 *
 * No approver mention: the DM itself is the ping, and a self-mention in
 * one's own inbox is noise.
 */
export function formatTicketApprovalNotice(args: {
  channelId: string;
  workerId: string;
  username: string;
  karma: number;
}): string {
  return (
    `new reddit profile passed ✅\n` +
    `ticket: <#${args.channelId}>\n` +
    `worker: <@${args.workerId}>\n` +
    `profile: u/${args.username}\n` +
    `karma: ${args.karma} (>= ${REDDIT_PROFILE_MIN_KARMA})\n\n` +
    `add this ticket to the daily outreach when you can.`
  );
}

/** Alert for the approver when we could not reach a verdict at all. */
export function formatUnverifiableDm(args: { channelName: string; workerId: string; username: string; reason: string }): string {
  return (
    `could not verify a reddit profile ⚠️\n` +
    `ticket: ${args.channelName}\n` +
    `worker: <@${args.workerId}>\n` +
    `profile: u/${args.username}\n` +
    `reason: ${args.reason}\n\n` +
    `please check this ticket manually.`
  );
}

/** In-ticket nudge when the check itself could not run. */
export function formatUnverifiableMessage(reason: string): string {
  return `⚠️ i could not verify your reddit profile right now (${reason}). please send the link again in a minute.`;
}
