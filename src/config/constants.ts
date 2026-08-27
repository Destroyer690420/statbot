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

/** Task ID validation pattern (alphanumeric, spaces, hash, hyphens, underscores, 1-32 chars) */
export const TASK_ID_PATTERN = /^[A-Za-z0-9 _#-]{1,32}$/;

/** Reddit URL regex pattern */
export const REDDIT_URL_PATTERN = /^https?:\/\/(www\.|old\.|new\.)?reddit\.com\/.+/i;
/** Default daily worker outreach message (configurable via OutreachSettings) */
export const DEFAULT_OUTREACH_MESSAGE =
  'Hey, I have got a post and a comment for you. wanna do it? message me once you are free';

/** Welcome message sent automatically when a ticket channel is created (tag placeholder {user} is replaced) */
export const TICKET_WELCOME_MESSAGE = 'Hey, {user} Can you please share your reddit profile link?';

/** Onboarding guide sent once per new ticket when the opener sends their first message */
export const TICKET_GUIDE_MESSAGE =
  'To understand everything i would advise you to read <#1520466000477163550>, <#1520481331773968384>, <#1520620297399828571>. it will barely take 10 mins to read it all but you will understand everything after reading these. and once you are done you can ask me your doubts and after that we can get started, so lemme know once you are done reading we will start after that. ok?';

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
