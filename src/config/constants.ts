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
  /** Burst freshness window: only tasks first seen within the last 25 min
   *  count as new arrivals. Older listings are logged STALE and excluded,
   *  so blasts fire for fresh drops, never for stale leftovers. */
  BURST_FRESH_MS: 25 * 60 * 1000,
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

/** Onboarding guide sent once per new ticket when the opener sends their first message */
export const TICKET_GUIDE_MESSAGE =
  'To understand everything i would advise you to read <#1520466000477163550>, <#1520481331773968384>, <#1520620297399828571>. it will barely take 10 mins to read it all but you will understand everything after reading these. and once you are done you can ask me your doubts and after that we can get started, so lemme know once you are done reading we will start after that. ok?';

/** Member join welcome sent in #invites when someone joins the guild */
export const INVITES_CHANNEL_ID = '1520616800063328437';
export const VERIFICATION_CHANNEL_ID = '1520483343018496104';
export const MEMBER_WELCOME_MESSAGE = 'hey {user} please create your ticket in <#{verification}> then we can get started';

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
