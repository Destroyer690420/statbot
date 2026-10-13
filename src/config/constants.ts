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

/** BullMQ queue name for 10-minute survival screenshots (separate from reminders) */
export const SURVIVAL_QUEUE_NAME = 'survival-queue';

/**
 * BullMQ queue for post-link nudges (10-min reminder + 15-min escalation).
 * Delayed jobs only — the worker sends the tagged reminder, then hands
 * overdue tasks to the escalation flow. Re-deliveries replace the pending
 * job (stable id, latest wins); every fire re-reads task state, so stale
 * jobs self-cancel.
 */
export const NUDGE_QUEUE_NAME = 'nudge-queue';
/** Delay from post delivery (SENT) to the tagged link reminder. */
export const LINK_NUDGE_DELAY_MS = 10 * 60 * 1000;
/** Delay from the reminder to escalation when the link still has not arrived. */
export const LINK_ESCALATE_DELAY_MS = 5 * 60 * 1000;
/** Boot backfill ignores tasks delivered longer ago than this (ancient
 *  tickets need a manager, not an automated nudge). */
export const NUDGE_BACKFILL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * BullMQ queue for GoPartTime link auto-submit (browser-tab executor).
 * The queue is a schedule/lease store only — no server worker ever pops it
 * (the datacenter IP is Vercel-blocked, so only the manager's browser can
 * touch GoPartTime). The executor tab polls GET /submit-jobs/pending.
 */
export const SUBMISSION_QUEUE_NAME = 'submission-queue';
/** Grace window after a submission before the executor may pick it up — a
 *  corrected resubmission inside this window replaces the pending job. */
export const SUBMISSION_INITIAL_DELAY_MS = 60 * 1000;
/** Transient-failure retries (page not loaded, dialog missing), then give up. */
export const SUBMISSION_RETRY_DELAYS_MS = [2 * 60 * 1000, 5 * 60 * 1000] as const;
/** Maximum submit attempts (initial + retries). */
export const SUBMISSION_MAX_ATTEMPTS = 3;
/** Executor lease: a job held longer than this without a verdict is
 *  reclaimable (stuck-tab reclaim, mirrors the accept-claim lease). */
export const SUBMISSION_LEASE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Deadline protection (owner directive, 2026-10-12): every task link must be
 * submitted no later than this margin before the task-site deadline, and a
 * link-less task gets one "submitting in a bit" feedback at the margin so
 * the task does not expire. Deadlines arrive as site-local display text
 * ("Today 4:50 PM", "Oct 11 1:50 PM" — Asia/Kolkata, see utils/deadline.ts).
 */
export const DEADLINE_SUBMIT_MARGIN_MS = 5 * 60 * 1000;
/** Execution slack so the first submit attempt lands before the margin:
 * executor poll (~5s) + list reload + card hunt + submit + verify. */
export const SUBMIT_DEADLINE_SLACK_MS = 60 * 1000;
/** Feedback is quicker (one dialog, no hunt across submit retries), so its
 *  slack is smaller — the notice lands just ahead of the margin. */
export const FEEDBACK_DEADLINE_SLACK_MS = 30 * 1000;

/**
 * BullMQ queue for deadline feedback ("submitting in a bit") — same
 * schedule/lease-store shape as the submission-queue, no server worker.
 * The executor tab polls it alongside submit jobs and clicks the task
 * card's Feedback button in-page. One shot per task (server guards via the
 * FEEDBACK_SENT audit; the job id is stable so re-schedules never double).
 */
export const FEEDBACK_QUEUE_NAME = 'feedback-queue';
/** Feedback text written into the site dialog (matches the established
 *  wording already present on real tasks). */
export const FEEDBACK_TEXT = 'submitting in a bit';
/** One retry after a transient failure, then give up (the +15min
 *  escalation reassigns the post anyway). */
export const FEEDBACK_RETRY_DELAY_MS = 2 * 60 * 1000;
/** Maximum feedback attempts (initial + one retry). */
export const FEEDBACK_MAX_ATTEMPTS = 2;
/** Executor lease, same stuck-tab reclaim as submit jobs. */
export const FEEDBACK_LEASE_TIMEOUT_MS = 5 * 60 * 1000;
/** Deadlines older than this never get a notice — the site-side task is long
 *  gone (late accepts carry already-past deadlines; only recent ones hold). */
export const FEEDBACK_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Server-side delivery pipeline (owner directive, 2026-10-12): POST /assign
 * persists the task and returns at once; a BullMQ worker delivers the ticket
 * messages in the background so acceptor tabs move to the next claim without
 * waiting out image downloads + sequential Discord sends. No browser work —
 * delivery is server→Discord only.
 */
export const DELIVERY_QUEUE_NAME = 'delivery-queue';
/** Parallel ticket deliveries (independent channels; discord.js backs off on 429). */
export const DELIVERY_JOB_CONCURRENCY = 3;
/** A PENDING-delivery row older than this with no live delivery is stuck
 *  (healthy deliveries finish in seconds) — the sweep re-enqueues it. */
export const DELIVERY_STUCK_AFTER_MS = 5 * 60 * 1000;
/**
 * Delay from Reddit URL submission to the survival screenshot.
 * Proof that a post survived >10 minutes: capture at 11 minutes.
 */
export const SURVIVAL_CHECK_DELAY_MS = 11 * 60 * 1000;

/** Survival screenshot retries after a transient failure (rate-limit/network). */
export const SURVIVAL_RETRY_DELAYS_MS = [2 * 60 * 1000, 5 * 60 * 1000] as const;

/** Maximum survival capture attempts (initial + retries). */
export const SURVIVAL_MAX_ATTEMPTS = 3;

/**
 * Survival proof retention. Payment evidence, so much longer than the 60h
 * insight TTL — 15 days, then swept by the same housekeeping loop.
 */
export const SURVIVAL_TTL_MS = 15 * 24 * 60 * 60 * 1000;

/** Source identifier for tasks delivered from the GoPartTime extension */
export const GOPARTTIME_SOURCE = 'goparttime';

/**
 * Tier-0/Tier-1 automatic content screen for new subreddits (language / sex / vape).
 *
 * Shadow mode: DRY_RUN=true logs WOULD_BLOCK + signal + triggering text without
 * calling addBlocked or aborting any accept. Tune the lists against real traffic,
 * then flip DRY_RUN to false to enforce. Rollback = flip back to true (no revert).
 *
 * The BLOCK_KEYWORDS_* lists below are the single source of truth. The
 * Tampermonkey companion (scripts/goparttime-auto.user.js) carries a
 * MANUALLY SYNCED copy — the userscript cannot import this file, so when these
 * lists change, paste them into the script's content-screen block verbatim
 * (same terms, same thresholds below).
 *
 * Matching contract (implemented in src/utils/content-screen.ts, mirrored in
 * the userscript): every term matches as a whole word / literal phrase
 * (case-insensitive `\bterm\b`) — never as a plain substring, so "class"
 * cannot trip on "ass". HIGH_CONFIDENCE terms (words and phrases) trigger on
 * their own. AMBIGUOUS single words NEVER trigger alone — they only enrich
 * the log detail when a high-confidence hit fired alongside, or match as an
 * exact multi-word phrase (multi-word AMBIGUOUS entries only).
 *
 * Subreddit NAMES play by deliberately different rules (see
 * `screenSubredditName`): short identifiers where a related fragment is
 * strong evidence, matched as SUBSTRINGS over high singles + NAME_ROOTS
 * (+ exact-only acronyms), with ambiguous singles quarantining instead of
 * blocking. Owner directive: recall over precision on names (even
 * `middlesex`-shaped names block); content keeps whole-word precision.
 *
 * Upkeep: vape brand names turn over fast — revisit this list periodically.
 * The dry-run WOULD_BLOCK logs are the drift detector.
 */
export const BLOCK_KEYWORDS_SEXUAL_HIGH_CONFIDENCE = [
  'porn', 'porno', 'pornography', 'nsfw', 'xxx', 'hentai', 'rule34',
  'nude', 'nudes', 'nudity', 'naked', 'sext', 'sexting',
  'masturbate', 'masturbating', 'masturbation', 'jerking off', 'jerk off',
  'blowjob', 'handjob', 'deepthroat', 'deepthroating',
  'anal sex', 'anal beads', 'buttplug', 'butt plug',
  'dildo', 'vibrator', 'fleshlight', 'sex doll', 'sex toy', 'sex toys',
  'cumshot', 'creampie', 'bukkake', 'gangbang', 'threesome', 'orgy',
  'squirting', 'orgasm', 'orgasms',
  'dick pic', 'dick pics', 'cock pic', 'nude pic', 'nude pics',
  'onlyfans', 'only fans', 'fansly',
  'camgirl', 'cam girl', 'cam boy', 'webcam girl',
  'escort', 'escorts', 'hooker', 'prostitute', 'stripper', 'strip club',
  'bdsm', 'dominatrix', 'fetish porn',
  'condom', 'condoms', 'lube', 'lubricant',
  'milf', 'pussy', 'vagina', 'penis', 'cock', 'dick', 'boobs', 'tits',
] as const;

export const BLOCK_KEYWORDS_SEXUAL_AMBIGUOUS = [
  // Use only as part of an exact phrase, or alongside a high-confidence hit.
  'kink',        // kink-shaming, kinky hair (phrase: "kink community", "into kink")
  'submissive',  // dog training, corporate culture (phrase: "submissive partner")
  'sexy',        // "sexy car", "sexy recipe" are extremely common SFW slang
  'breasts',     // breastfeeding/medical subreddits use this constantly
  'adult content', // "adult content creator" vs "adult content warning"
  'fetish',      // "food fetish", "shoe fetish" as harmless hyperbole
] as const;

export const BLOCK_KEYWORDS_VAPE_HIGH_CONFIDENCE = [
  'vape', 'vaping', 'vaper', 'vapers', 'vape pen', 'vape mod', 'box mod',
  'vape juice', 'e-liquid', 'eliquid', 'e juice', 'e-juice',
  'e-cig', 'ecig', 'e-cigarette', 'ecigarette', 'e cigarette',
  'nicotine', 'nic salt', 'nic salts', 'nicsalt',
  'disposable vape', 'puff bar', 'elf bar', 'geek bar', 'lost mary',
  'esco bar', 'flum pebble', 'juul', 'juuling', 'juulpod',
  'vape shop', 'vape store', 'vape trick', 'vape tricks',
  'cloud chasing', 'sub ohm', 'sub-ohm',
  'rda', 'rta', 'rdta', // rebuildable-coil tech acronyms — rarely used outside vaping
] as const;

export const BLOCK_KEYWORDS_VAPE_AMBIGUOUS = [
  // Standalone, these are hopeless false-positive magnets.
  'mod',    // Reddit moderator — would false-positive on huge swaths of Reddit
  'pod',    // generic word; pair as "vape pod" instead
  'cart',   // shopping cart, golf cart; pair as "vape cart"/"thc cart" instead
  'coil',   // guitar pickups, plumbing, electronics subreddits all use this
  'mech mod', // "mod" problem again, but the full phrase is safer than bare "mod"
  'smoking', // covers tobacco cigarettes and cannabis too, not vape-specific
  // 'dab pen' deliberately excluded: cannabis concentrate device, adjacent but
  // not vape/nicotine — out of scope until it gets its own category.
] as const;

/**
 * Bare roots for SUBREDDIT-NAME screening only (never content). Phrases
 * cannot occur in subreddit names (no spaces allowed), so without these the
 * name check could never fire on `sexpositive`-shaped names — no listed term
 * covers them. Whole-token/substring matching keeps `Essex`/`Middlesex`-style
 * names matching honestly (owner directive: block them too); content
 * screening keeps its lists untouched so `sex education`-style post text
 * never triggers on these.
 */
export const BLOCK_KEYWORDS_NAME_ROOTS = ['sex', 'anal', 'masturbat', 'jerkoff'] as const;

/**
 * Terms that match subreddit names EXACTLY only (full name or whole
 * underscore-token), never as substrings. Short acronyms collide with
 * ordinary words (`rta` sits inside `startups`, `portable`, `mortal`), so
 * substringing them would torch big legit subs.
 */
export const BLOCK_KEYWORDS_NAME_EXACT_ONLY = ['rda', 'rta', 'rdta'] as const;

export const CONTENT_SCREEN = {
  // ENFORCE MODE: Tier-1 hits really block (auto-content:*) + instant admin
  // DM per block. Flip back to true for shadow mode (log-only WOULD_BLOCK).
  DRY_RUN: false,
  /** Short common-English-word list for the lightweight non-English signal. */
  COMMON_ENGLISH_WORDS: [
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for',
    'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his',
    'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or', 'an', 'will', 'my',
    'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if',
    'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like',
    'just', 'know', 'take', 'into', 'your', 'good', 'some', 'could', 'them',
    'see', 'other', 'than', 'then', 'now', 'only', 'come', 'its', 'over',
    'also', 'after', 'how', 'our', 'well', 'even', 'new', 'want', 'any',
    'these', 'give', 'most', 'is', 'are', 'was', 'were', 'has', 'had', 'been',
  ] as readonly string[],
  /** Minimum letters before the non-Latin-ratio check may fire. */
  NON_LATIN_MIN_LETTERS: 8,
  /** Fires when fewer than this fraction of the text's letters are Latin. */
  NON_LATIN_MAX_LATIN_FRACTION: 0.5,
  /** Minimum words before the common-word-fraction check may fire. */
  COMMON_WORD_MIN_WORDS: 8,
  /** Fires when fewer than this fraction of the text's words are common English. */
  COMMON_WORD_MIN_FRACTION: 0.2,
  /** Reason-string prefix for automatic blocks (reads differently from manual blocks). */
  AUTO_BLOCK_REASON_PREFIX: 'auto-content',
} as const;

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
 * Minimum Reddit account age (in days) a worker's profile must have to pass.
 * A replacement account after a ban must be at least this old AND clear the
 * karma bar. `created_utc` comes from the same `about.json` payload as the
 * karma counts, so no extra fetch is needed. A missing `created_utc` (old
 * rows, unexpected payload) never blocks — the karma rule alone decides.
 */
export const REDDIT_PROFILE_MIN_AGE_DAYS = 14;

/**
 * Daily outreach ban scan: every selected outreach ticket's stored Reddit
 * profile is re-checked once a day at this IST wall-clock time. Suspension
 * only — low karma / young accounts are never removed by the scan.
 * IST has no DST; the offset is fixed (see `src/utils/ist-time.ts`).
 */
export const OUTREACH_BAN_SCAN_HOUR_IST = 7;
export const OUTREACH_BAN_SCAN_MIN_IST = 0;
export const OUTREACH_BAN_SCAN_SEC_IST = 5;

/**
 * The one admin asked to add passing tickets to the daily outreach. A single
 * id rather than the whole staff list: this is a personal approval request,
 * and pinging every admin/manager would notify people who cannot action it.
 */
export const REDDIT_PROFILE_APPROVAL_ADMIN_ID = '1299323714101317715';

/**
 * The owner (same id as the profile-approval admin and the digest DM
 * recipient). Personal pings that must reach exactly one human — e.g. the
 * short-post format failure — tag this id, never the whole staff list.
 */
export const OWNER_USER_ID = '1299323714101317715';

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

/**
 * The three onboarding channels the passing worker is asked to read. Single
 * source of truth: both `TICKET_GUIDE_MESSAGE` and the short verified message
 * (`formatVerifiedMessage`) derive their mentions from this list, so the ids
 * are written exactly once.
 */
export const TICKET_GUIDE_CHANNEL_IDS = [
  '1520466000477163550',
  '1520481331773968384',
  '1520620297399828571',
] as const;

/** Onboarding guide sent once per new ticket, only after the worker passes the profile check */
export const TICKET_GUIDE_MESSAGE =
  `To understand everything i would advise you to read ${TICKET_GUIDE_CHANNEL_IDS.map((id) => `<#${id}>`).join(', ')}. it will barely take 10 mins to read it all but you will understand everything after reading these. and once you are done you can ask me your doubts and after that we can get started, so lemme know once you are done reading we will start after that. ok?`;

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
