# BACKGROUND_JOBS.md — Queues, Timers & Scheduled Work

> Verified against `src/index.ts`, `src/scheduler/**`, `src/services/survival*` on 2026-10-08. **There is no cron in this project.** Everything is BullMQ delayed jobs or in-process `setInterval`.

---

## 1. BullMQ Queues

### 1a. Reminder queue — `reminder-queue` (`src/scheduler/queue.ts`)

| Property | Value |
|---|---|
| Queue name | `reminder-queue` |
| Broker | Redis (`REDIS_URL`; `maxRetriesPerRequest: null`, `enableReadyCheck: false`) |
| Job options | `removeOnComplete: {count:100}`, `removeOnFail: {count:50}`, `attempts: 3`, `backoff: {type:'exponential', delay: 5000}` |
| Worker | concurrency **5**; own IORedis connection; shares the Discord client |

## 2. Job Inventory

| Job | ID | When scheduled | Purpose | Processor |
|---|---|---|---|---|
| Reminder (primary) | `reminder-{id}` | task create / reschedule / send-now / re-hydration; `delay = max(0, dueAt − now)` | Send the 20h/70h reminder embed, advance status | `src/scheduler/worker.ts` |
| Reminder retry | `retry-{id}-{n}` (n=1,2) | after each unanswered send; delay `+2h` (n=1), `+6h` (n=2) | Re-send the reminder (WARNING-color embed, "Retry N of 3") | same worker |
| (None for payouts, commissions, analytics) | — | — | All payouts/commissions are dashboard-triggered API calls | — |

**Retry lifecycle** (`worker.on('completed')`): if reminder sent-but-unanswered and `retryCount < 3` → schedule `retry-{id}-{n+1}`; if `scheduleRetryJob` returns null or `retryCount >= 3` → `notifyAdminOverdue` (embed + @admins/@managers in the ticket). `worker.on('failed')` → log + `notifyAdminOverdue`.

### 1b. Survival queue — `survival-queue` (`src/services/survival.service.ts`, worker `src/scheduler/survival-worker.ts`)

| Property | Value |
|---|---|
| Queue name | `survival-queue` |
| Broker | Same Redis (`REDIS_URL`); own IORedis connections for queue + worker |
| Job options | `removeOnComplete: true`, `removeOnFail: {count:50}`, `attempts: 1` (retries are explicit re-schedules, not BullMQ attempts) |
| Worker | concurrency **2** (each job launches Chromium and renders the full Reddit page); shares the Discord client for failure DMs |
| Job | `survival-{taskId}` (stable id; retries `survival-{taskId}-r{attempt}`), payload `{ taskId, redditUrl, attempt }`, `delay = max(0, dueAt − now)` |

Timer starts at `recordSubmission` (`submittedAt`, latest URL wins — old job cancelled, proof reset to PENDING) for GoPartTime posts, or at creation (`createdAt`) for manual `/task` POSTs. Capture at `anchor + 11min` via `captureSurvivalScreenshot` (vaulted spare-account cookie + browser UA, `www` → `old` fallback, full-page PNG) with the ALIVE/REMOVED/DELETED verdict from the same authed `.json` path the format check uses. Transient failures (429/network) reschedule at `+2min`/`+5min` (max 3 attempts); hard failures (`NO_SESSION`/`SESSION_EXPIRED`/`BLOCKED`) persist the status + `survivalError` with no image and DM all admin/manager IDs (`notifyAdminsSurvivalFailed`). Stale jobs (URL resubmitted since) and already-recorded tasks no-op. Files at `uploads/survival/<taskId>/survival-<attempt>.png` on the existing uploads volume. `POST /tasks/:id/retry-survival` recaptures immediately (a post alive now necessarily survived 10 min).

## 3. In-Process Timers (`src/index.ts`)

| Timer | Interval | First run | Job | Failure behavior |
|---|---|---|---|---|
| Auto-archive | 24 h | +1 h after boot | `taskService.archiveOld(now − 30d)` — COMPLETED/CANCELLED **paid** tasks → ARCHIVED | logged, continues |
| Sunday archive | weekly (next UTC Sunday 00:00, self-rescheduling) | +1 h after boot | `taskService.archiveAllCompleted()` — all **paid** COMPLETED → ARCHIVED | logged, re-schedules |
| Insight image cleanup | 60 min | immediately (interval) | `insightStorageService.cleanup()` — delete files >60h old, prune empty dirs | logged |
| Survival proof cleanup | 60 min | immediately (interval) | `survivalStorageService.cleanup()` — delete files >15d old, prune empty dirs | logged |
| Reminder re-hydration | 30 min | immediately (interval; also at boot step 5) | `rehydrateReminders()` — recreate missing primary/retry jobs from DB | logged |
| Survival re-hydration | 30 min (same tick) | immediately (interval; also at boot) | `rehydrateSurvivalJobs()` — recreate missing `survival-{taskId}` jobs for POST tasks with NULL/PENDING proof submitted <24h ago (older windows are left without proof, not backfilled) | logged |

## 4. Re-Hydration Details (`rehydrateReminders`)

1. `reminderRepository.findPending()` (unsent, incomplete): skip tasks that are CANCELLED/ARCHIVED or have `cancelledReason`; skip if job `reminder-{id}` already exists; else `scheduleReminderJob`.
2. `reminderRepository.findPendingSent()` (sent, incomplete): if `retryCount < 3`, schedule `retry-{id}-{retryCount+1}` if absent.
Counts logged; this is the crash-recovery mechanism.

## 5. One-Shot CLI Scripts (not background jobs)

| Script | Purpose |
|---|---|
| `npm run deploy-commands` → `src/bot/deploy-commands.ts` | Register guild slash commands (must be run after command edits) |
| `npx tsx scripts/import-postgres.ts` | One-time Firestore→PostgreSQL import tool |
| `query-tasks.ts/.js` | ad-hoc debug queries (untracked) |

## 6. What Does NOT Exist (verified)

- No cron entries, no `node-cron`, no `setInterval`-based payout automation.
- No queue-based work other than reminders + survival screenshots.
- No scheduled Discord purge/cleanup of delivery messages (deleted only on task deletion/reassign best-effort).
- No health-check consumer (the `/health` endpoint exists but nothing polls it).