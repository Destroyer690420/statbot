/** Reminder delay constants (in milliseconds) */
export const REMINDER_DELAYS = {
  POST_20H: 20 * 60 * 60 * 1000,   // 20 hours
  POST_70H: 70 * 60 * 60 * 1000,   // 70 hours
  COMMENT_20H: 20 * 60 * 60 * 1000, // 20 hours
} as const;

/** Retry delays for unresponded reminders (in milliseconds) */
export const RETRY_DELAYS = [
  2 * 60 * 60 * 1000,   // +2 hours
  6 * 60 * 60 * 1000,   // +6 hours
] as const;

/** Maximum total reminder attempts (initial send + retries) */
export const MAX_REMINDER_ATTEMPTS = 3;

/** Auto-archive threshold (in days) */
export const ARCHIVE_AFTER_DAYS = 30;

/** Threshold for early vs late deletion detection (30 minutes) */
export const DELETED_DETECTION_THRESHOLD_MS = 30 * 60 * 1000;

/** Maximum search results */
export const MAX_SEARCH_RESULTS = 20;

/** Maximum notes length */
export const MAX_NOTES_LENGTH = 500;

/** Supported image extensions for insight uploads */
export const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;

/**
 * Task media delivery knobs.
 *
 * `FFMPEG_PATH` is read straight from `process.env` (falling back to PATH)
 * rather than through `config/env.ts` on purpose: `env.ts` calls
 * `process.exit(1)` when the environment is incomplete, and
 * `utils/video-processor.ts` is unit-tested in isolation without one. The
 * Docker image installs ffmpeg via apk, so the default resolves there.
 */
export const MEDIA = {
  FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg',
} as const;

/** BullMQ queue name */
export const QUEUE_NAME = 'reminder-queue';

/** Source identifier for tasks delivered from the GoPartTime extension */
export const GOPARTTIME_SOURCE = 'goparttime';

/** Automated GoPartTime acceptance — human-like, Oracle-safe schedule */
export const AUTOMATION = {
  /** Mandatory scans each hour (minutes) + routine 10-min grid */
  SCAN_MINUTES: [0, 10, 11, 20, 30, 40, 50] as const,
  /** Jitter windows (ms): mandatory scans tighter, routine scans wider */
  MANDATORY_JITTER_MS: 30 * 1000,
  ROUTINE_JITTER_MS: 60 * 1000,
  /** Worker Stage-2 confirmation window */
  CONTACT_WINDOW_MS: 5 * 60 * 1000,
  /** Max accepted posts per worker per IST day */
  DAILY_POST_CAP: 2,
  /** Stage-2 confirmation message (tagged worker) */
  CONFIRM_MESSAGE: 'hey {user}, should i send a post?',
  /** Random pre-accept delay to look human (never instant snipe) */
  ACCEPT_DELAY_MIN_MS: 3000,
  ACCEPT_DELAY_MAX_MS: 8000,
  /** Backoff on 429 / checkpoint (keep browser context alive) */
  BACKOFF_MS: [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000] as const,
  /** Burst-flow claim TTL: winners are served however long it takes — claims
   *  never expire while their burst is open. Closed-burst orphans are swept
   *  by the queue tick, so this is only a backstop, not a deadline. */
  BURST_CLAIM_TTL_MS: 24 * 60 * 60 * 1000,
  /** Phase-2 parallel tabs: a per-tab claim lease lapses after this long
   *  without a verdict, so a stuck tab's claim becomes leasable again.
   *  Generous on purpose — normal accepts finish in seconds. */
  CLAIM_LEASE_TIMEOUT_MS: 3 * 60 * 1000,
  /** Merge grace: streaming completions may join an open blast's pool (slots
   *  grow, zero new messages) only within this window after blast creation.
   *  Later arrivals wait for next hour — the pool freezes. */
  BURST_MERGE_GRACE_MS: 5 * 60 * 1000,
} as const;

/** Task ID validation pattern (alphanumeric, spaces, hash, hyphens, underscores, 1-32 chars) */
export const TASK_ID_PATTERN = /^[A-Za-z0-9 _#-]{1,32}$/;

/** Reddit URL regex pattern */
export const REDDIT_URL_PATTERN = /^https?:\/\/(www\.|old\.|new\.)?reddit\.com\/.+/i;
/** Default daily worker outreach message (configurable via OutreachSettings; {user} tags the ticket's worker) */
export const DEFAULT_OUTREACH_MESSAGE =
  'Hey {user}, I have got a post and a comment for you. wanna do it? message me once you are free';

/** Welcome message sent automatically when a ticket channel is created (tag placeholder {user} is replaced) */
export const TICKET_WELCOME_MESSAGE = 'Hey, {user} Can you please share your reddit profile link?';

/**
 * One-time per-ticket ask for the Reddit profile a worker will post from.
 * {user} is replaced with the ticket worker's mention.
 *
 * Unlike TICKET_WELCOME_MESSAGE this is NOT sent on channelCreate: it is a
 * deliberate sweep over the tickets that already exist, run once by
 * `scripts/ask-reddit-profile-links.ts` (delivered tickets are recorded in
 * `TicketOnboarding.redditProfileRequestedAt`, so a re-run cannot re-ask).
 */
export const TICKET_REDDIT_PROFILE_REQUEST_MESSAGE =
  'Hey {user}, please share the reddit profile link you will be posting from. if you are posting or wanna start posting, sharing your reddit profile link is mandatory.';

/**
 * Sent when the worker replies with anything that is not a Reddit profile
 * link. Separate from TICKET_WELCOME_MESSAGE (the ask on ticket creation) so
 * the nudge can be worded differently without changing what 250+ existing
 * tickets were already sent.
 */
export const TICKET_REDDIT_PROFILE_REASK_MESSAGE =
  'Hey {user} i still need your reddit profile link to move forward. please share it like this: https://www.reddit.com/user/yourusername';

/**
 * Minimum total karma (link + comment) a worker needs to pass the profile
 * check. Link + comment is what subreddit AutoModerator karma filters
 * actually count, so it predicts whether their posts will survive.
 */
export const REDDIT_PROFILE_MIN_KARMA = 50;

/**
 * The one admin asked to add passing tickets to the daily outreach. A single
 * id rather than the whole staff list: this is a personal approval request,
 * and pinging every admin/manager would notify people who cannot action it.
 */
export const REDDIT_PROFILE_APPROVAL_ADMIN_ID = '1299323714101317715';

/** "read this for more info" channel linked in the rejected-worker messages. */
export const REDDIT_PROFILE_INFO_CHANNEL_ID = '1545416325776678952';

/**
 * Automatic re-asks per ticket, on top of the ask on ticket creation. Bounded
 * because an unbounded re-ask turns every bit of small talk ("hi", "ok", a
 * sticker) into a bot message; a worker who is actually interested just
 * re-sends the link, which is never re-ask-capped.
 */
export const REDDIT_PROFILE_MAX_REASKS = 3;

/**
 * Minimum gap between two Reddit profile lookups. Reddit throttles
 * authenticated traffic aggressively, and several tickets opening at once
 * would otherwise fire simultaneous lookups at the same spare account.
 */
export const REDDIT_PROFILE_MIN_INTERVAL_MS = 1500;

/**
 * The five states a ticket's Reddit profile check can be in, persisted in
 * `TicketOnboarding.profileCheckStatus`. Kept as plain strings (like
 * `Task.formatCheckStatus`) so the migration needs no CREATE TYPE; the
 * TypeScript union lives in `src/utils/reddit-profile-link.ts`.
 */
export const PROFILE_CHECK_PENDING = 'PENDING';
export const PROFILE_CHECK_PASSED = 'PASSED';
export const PROFILE_CHECK_BANNED = 'BANNED';
export const PROFILE_CHECK_LOW_KARMA = 'LOW_KARMA';
export const PROFILE_CHECK_UNVERIFIABLE = 'UNVERIFIABLE';

/** Onboarding guide sent once per new ticket, only after the worker passes the profile check */
export const TICKET_GUIDE_MESSAGE =
  'To understand everything i would advise you to read <#1520466000477163550>, <#1520481331773968384>, <#1520620297399828571>. it will barely take 10 mins to read it all but you will understand everything after reading these. and once you are done you can ask me your doubts and after that we can get started, so lemme know once you are done reading we will start after that. ok?';

/** Member join welcome sent in #invites when someone joins the guild */
export const INVITES_CHANNEL_ID = '1520616800063328437';
export const VERIFICATION_CHANNEL_ID = '1520483343018496104';
export const MEMBER_WELCOME_MESSAGE = 'hey {user} please create your ticket in <#{verification}> then we can get started';

/** Payment proof channel where workers may share payment screenshots */
export const PAYMENT_PROOF_CHANNEL_ID = '1520613959315488930';

/** Embed colors */
export const COLORS = {
  SUCCESS: 0x00d26a,
  ERROR: 0xff4757,
  WARNING: 0xffa502,
  INFO: 0x3742fa,
  PENDING: 0xffc312,
  COMPLETED: 0x00d26a,
  OVERDUE: 0xff6348,
} as const;
