# REMINDER_SYSTEM.md — Reminder Engine

> Verified against `src/scheduler/**`, `src/services/reminder.service.ts`, `src/config/constants.ts`, `src/index.ts` on 2026-08-11.

---

## 1. Overview

Reminders are **deadline-based BullMQ delayed jobs** whose absolute due time derives from task `createdAt`. **There is no cron anywhere.** A periodic re-hydration loop (every 30 min + at boot) re-creates lost jobs from PostgreSQL, making the system resilient to Redis/bot restarts.

## 2. Reminder Types & Creation

`reminderService.createForTask(taskId, taskType, createdAt)` (`src/services/reminder.service.ts`):

| Task type | Reminders created | Due time |
|---|---|---|
| COMMENT | 1 × `COMMENT_20H` | `createdAt + 20h` |
| POST | 2 × `POST_20H`, `POST_70H` | `createdAt + 20h`, `createdAt + 70h` |

Constants (`src/config/constants.ts`): `REMINDER_DELAYS = { POST_20H: 72_000_000, POST_70H: 252_000_000, COMMENT_20H: 72_000_000 }` ms.

Each Reminder row: id `REM-XXXXXXXX`, `dueAt`, `sent=false`, `completed=false`, `retryCount=0`. Jobs are created afterwards via `scheduleAllReminders(reminders)`; the BullMQ `jobId` is persisted back (`reminder.jobId`) by `updateJobId`.

## 3. Scheduling (`src/scheduler/jobs.ts`)

| Job | ID | Delay | Options |
|---|---|---|---|
| Primary | `reminder-{reminderId}` | `max(0, dueAt − now)` | `removeOnComplete: true`, dedupe by jobId (BullMQ replaces same-ID jobs) |
| Retry n | `retry-{reminderId}-{n}` | `RETRY_DELAYS[n-1]` = **+2h** (n=1), **+6h** (n=2); `retryCount >= 3` → not scheduled (returns null) | `removeOnComplete: true` |

Queue (`src/scheduler/queue.ts`): `QUEUE_NAME='reminder-queue'`; default job options `removeOnComplete: {count:100}`, `removeOnFail: {count:50}`, `attempts: 3`, `backoff: exponential 5000ms` (BullMQ-level retry on worker thrown errors — **in addition to** the 2h/6h reminder-level retries). Redis: `IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false })`; shared singleton connection, worker has its own.

Cancellation: `cancelJob(jobId)` (remove single), `cancelTaskJobs(taskId)` (removes primary + `retry-{id}-1..3`).

## 4. Worker Processing (`src/scheduler/worker.ts`)

`initializeWorker(discordClient)` — BullMQ `Worker`, **concurrency 5**; processor:

1. Load task by `taskId`; skip if missing.
2. Skip if `CANCELLED` / `ARCHIVED` / `cancelledReason !== null`.
3. Load reminder; skip if missing or `completed`.
4. Fetch `task.channelId` → must be a `TextChannel` (else error + skip).
5. Send embed: `channel.send({ content: '<@assignedUser>', embeds: [reminderEmbed] })`.
6. Persist `reminderMessageId` (this enables reply detection later).
7. If not yet `sent`: `markSent` + state advance — `PENDING → REMINDER_20_SENT`, `INSIGHT_20_RECEIVED → REMINDER_70_SENT` (`state-machine.getStatusAfterReminderSent`).
8. Send failure → log + **rethrow** (triggers BullMQ's own 3 attempts with 5s exponential backoff).

### After-completion hook
`worker.on('completed')`: if not terminal and reminder sent-but-not-completed and `retryCount < 3` → `updateRetryCount` + `scheduleRetryJob(n+1)`; if `scheduleRetryJob` returns null **or** `retryCount >= 3` → `notifyAdminOverdue`.

- Effective schedule: send @dueAt → retry1 @+2h → retry2 @+6h (i.e. dueAt+8h) → overdue alert.
- `worker.on('failed')` → log + `notifyAdminOverdue` (job-level failure).

### Overdue alert (`notifyAdminOverdue`)
Embed "⚠️ Overdue Task" (Assigned, Task, Reminder 20H/70H, Ticket) posted into the task channel with content `<adminPings> — Task overdue after 3 reminder attempts`. `getAllAdminIds()` = **admins + managers**.

## 5. Re-Hydration (`src/index.ts` `rehydrateReminders()`)

Runs at startup (step 5/6) and every **30 minutes** (`setInterval`):

1. `reminderRepository.findPending()` (unsent, incomplete) → skip if task missing/terminal → if job `reminder-{id}` absent, `scheduleReminderJob`.
2. `reminderRepository.findPendingSent()` (sent, incomplete) → if `retryCount < MAX_REMINDER_ATTEMPTS (3)` and `retry-{id}-{n+1}` absent → `scheduleRetryJob`.

## 6. Manual Rescheduling

- `/reschedule` (bot) or `PATCH /api/v1/reminders/:id` (API): sets `dueAt = new date`, resets `sent=false, sentAt=null`; cancels existing job; schedules anew (API path: audit `REMINDER_RESCHEDULED`).
- `/send-now` (bot): same reset with `dueAt = now`, cancels main + all retry jobs, fires immediately.

## 7. Reminder ↔ Insight Flow

- Worker sends message → `reminderMessageId` stored → worker replies to that message with a screenshot → `messageCreate.handleInsightUpload` finds the reminder by `reminder.reminderMessageId` → `markCompleted` (+ `completedAt=now`) → state machine advance (+ possibly COMPLETED).
- Dashboard shows timeline via `GET /tasks/:id` (reminders) / `GET /tasks/:taskId/reminders`.

## 8. Database Representation

`Reminder` table: `id, taskId(FK CASCADE), type, dueAt, sent, completed, sentAt, completedAt, retryCount, jobId, reminderMessageId, insightImageUrl, insightImageName, insightUploadedAt`; indexes on `(taskId)`, `(sent, completed)`, `(reminderMessageId)`.

## 9. Failure Behavior Matrix

| Failure | Behavior |
|---|---|
| Task deleted / cancelled before due | Job skipped by worker guard (or jobs cancelled on delete) |
| Channel missing/renamed/deleted | Worker logs error, rethrows → BullMQ retries ×3 (5s backoff) → `failed` handler → overdue alert |
| Discord API error sending | Same as above |
| Redis down at boot | `initializeQueue` fails → process exits (fatal) |
| Reminder already completed | Worker skips silently |
| Job lost from Redis (restart) | Re-hydration recreates it from PostgreSQL |

## 10. Known Limitations

- Due times are fixed from `createdAt`; `/reschedule` and `/send-now` override manually.
- `jobId` on the Reminder row is written post-schedule; if the write fails, re-hydration may double-schedule (deduped by BullMQ jobId).
- Comment tasks have only the 20h reminder (no 70h phase); `/reschedule 70h` on a comment reports "Reminder not found for this task."