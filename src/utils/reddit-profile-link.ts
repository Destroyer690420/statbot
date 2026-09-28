import {
  REDDIT_PROFILE_INFO_CHANNEL_ID,
  REDDIT_PROFILE_MIN_KARMA,
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
const TERMINAL_STATUSES: ReadonlySet<ProfileCheckStatus> = new Set<ProfileCheckStatus>(['PASSED', 'BANNED']);

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

function infoChannelMention(): string {
  return `<#${REDDIT_PROFILE_INFO_CHANNEL_ID}>`;
}

export function formatReaskMessage(workerId: string): string {
  return TICKET_REDDIT_PROFILE_REASK_MESSAGE.replace('{user}', `<@${workerId}>`);
}

/** Sent in-ticket when the account is not suspended and clears the bar. */
export function formatVerifiedMessage(karma: number): string {
  return `✅ your reddit account has been verified (${karma} karma). you are all set — please read the channels below to get started.`;
}

/** Sent in-ticket when the account is live but under the karma threshold. */
export function formatLowKarmaMessage(karma: number, minKarma = REDDIT_PROFILE_MIN_KARMA): string {
  return (
    `your reddit account has only ${karma} karma but you need at least ${minKarma} to start. ` +
    `please increase the karma of your account, or create a new account and build karma, then you can start hiring for us — ` +
    `you will get ₹100 per successful hire. please read ${infoChannelMention()} for more info.`
  );
}

/** DM'd to the worker when Reddit reports the account as suspended. */
export function formatBannedDmMessage(): string {
  return (
    'your reddit account is banned. you can create a new account and start hiring for us — ' +
    `you will get ₹100 per successful hire. please read ${infoChannelMention()} for more info.`
  );
}

/**
 * DM'd to the approver when a worker passes. Carries the ticket name (not the
 * channel id) so it can be found in the dashboard's Daily Outreach list
 * without a lookup.
 */
export function formatApprovalDm(args: {
  channelName: string;
  workerId: string;
  username: string;
  karma: number;
}): string {
  return (
    `new reddit profile passed ✅\n` +
    `ticket: ${args.channelName}\n` +
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
