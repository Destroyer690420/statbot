# BACKGROUND_JOBS.md — Queues, Timers & Scheduled Work

> Verified against `src/index.ts`, `src/scheduler/**` on 2026-08-11. **There is no cron in this project.** Everything is BullMQ delayed jobs or in-process `setInterval`.

---

## 1. BullMQ Queue — `reminder-queue` (`src/scheduler/queue.ts`)

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

## 3. In-Process Timers (`src/index.ts`)

| Timer | Interval | First run | Job | Failure behavior |
|---|---|---|---|---|
| Auto-archive | 24 h | +1 h after boot | `taskService.archiveOld(now − 30d)` — COMPLETED/CANCELLED **paid** tasks → ARCHIVED | logged, continues |
| Sunday archive | weekly (next UTC Sunday 00:00, self-rescheduling) | +1 h after boot | `taskService.archiveAllCompleted()` — all **paid** COMPLETED → ARCHIVED | logged, re-schedules |
| Insight image cleanup | 60 min | immediately (interval) | `insightStorageService.cleanup()` — delete files >30h old, prune empty dirs | logged |
| Reminder re-hydration | 30 min | immediately (interval; also at boot step 5) | `rehydrateReminders()` — recreate missing primary/retry jobs from DB | logged |

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
- No queue-based work other than reminders.
- No scheduled Discord purge/cleanup of delivery messages (deleted only on task deletion/reassign best-effort).
- No health-check consumer (the `/health` endpoint exists but nothing polls it).