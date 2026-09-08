# API.md — REST API Reference

> All endpoints are mounted under `/api/v1` on Express (`src/api/server.ts`), port `env.PORT` (default 3000), behind nginx at production. Verified 2026-08-11.
> Envelope: success `{ success: true, data }`, errors `{ success: false, message, errors?: string[] }`.

---

## 1. Global Middleware (src/api/server.ts, in order)

| Concern | Config |
|---|---|
| `trust proxy` | `app.set('trust proxy', 1)` |
| helmet | defaults |
| CORS | `origin: [DASHBOARD_URL, 'https://goparttime.net', 'https://www.goparttime.net']`, `credentials: true` (extension uses `GM_xmlhttpRequest` which bypasses CORS; plain fetch from goparttime.net allowed) |
| Rate limit | `express-rate-limit`: **100 requests / 15 min / IP** on `/api/`, `standardHeaders: true`, custom JSON 429 message |
| Body | `express.json({ limit: '1mb' })` + urlencoded |
| 404 | `{ success:false, message: 'Route <METHOD> <path> not found.' }` |
| 500 | `{ success:false, message }` (`err.message` dev / `'Internal server error.'` prod) |

**No WebSocket, no express.static** (insight images served by route).

---

## 2. Authentication Model

| Scheme | Where | Token |
|---|---|---|
| **JWT** (`authMiddleware` in `src/api/middleware/auth.ts`) | dashboard routes; `Authorization: Bearer <jwt>`; payload `{username, iat}`, HS256, expires **24h**; sets `req.userId = decoded.username` | issued by `POST /auth/login` from `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` env |
| **Admin (username)** `requireDashboardAdmin` | in-file helper in discord.ts/payouts.ts/commissions.ts: `req.userId === env.DASHBOARD_USERNAME` else 403 "Admin access required." | — |
| **Admin (Discord IDs)** `isAdmin(userId)` from `src/utils/permissions.ts` | settings.ts PUT, commissions.ts rates PUT: checks `env.ADMIN_USER_IDS` | — |
| **Extension Bearer** (`extensionAuth` in `src/api/middleware/extensionAuth.ts`) | all `/goparttime/*`; token compared with `crypto.timingSafeEqual` vs `env.GOPARTTIME_API_KEY`; 503 if key unconfigured, 401 mismatch; sets `req.userId='goparttime-extension'` | `GOPARTTIME_API_KEY` |

**Unauthenticated endpoints**: `POST /auth/login`, `POST /auth/verify`, `GET /health`, `POST /owner/verify`, `GET /owner/daily-earnings`, `GET /owner/daily-earnings/history`, `GET /owner/weekly-earnings`, `GET /uploads/insights/:taskId/:filename`.

---

## 3. Auth — `src/api/routes/auth.ts`

| Method | Path | Purpose | Body | Response | Errors |
|---|---|---|---|---|---|
| POST | `/api/v1/auth/login` | Dashboard login | `{username, password}` (manual validation) | `{ success, data: { token, expiresIn: '24h' } }` | 400 missing fields; 401 `'Invalid credentials.'`; 500 |
| POST | `/api/v1/auth/verify` | Token validity check | `{ token }` | 200 `{ success, data: { valid: true, decoded } }` or `{ valid: false }` | 400 missing token |

---

## 4. Health — `src/api/routes/health.ts`

| Method | Path | Response |
|---|---|---|
| GET | `/api/v1/health` | 200 `{ success, data: { status:'healthy'|'degraded', uptime, version:'1.0.0', services:{ database, redis }, timestamp } }` — **200 only if DB (`SELECT 1`) AND Redis (PING) both OK; else 503** |

---

## 5. Tasks — `src/api/routes/tasks.ts` (all JWT)

Query params shared: `status`, `type`, `assignedUserId`, `channelId`, `redditUrl`, `limit` (default **1000**, uncapped).

| Method | Path | Purpose | Body/Params | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/v1/tasks` | List/search tasks (excludes ACCEPTED unless `status` filter given; newest first) | query | `{ success, data: Task[], total }` | 500 |
| GET | `/api/v1/tasks/:id` | Task + reminders | path | `{ success, data: { ...task, reminders } }` | 404 |
| POST | `/api/v1/tasks` | Create manual task (creates reminders + schedules BullMQ jobs) | `createTaskSchema`: `redditUrl`, `type` (POST/COMMENT), `channelId`, `assignedUserId`, `guildId`, `createdById` required; `channelName?`, `assignedUserName?`, `notes? ≤500` | 201 `{ success, data: { ...task, reminders } }` | 400 invalid URL/ID/notes/dup URL; **409 dup task ID** |
| POST | `/api/v1/tasks/assign-from-goparttime` | JWT twin of `/goparttime/assign` (dashboard) | `goPartTimePayloadSchema` | 201 `{ success, data: result.task, failed }` | **409** `'Task for task <id> already exists.'`; 400; 500 |
| POST | `/api/v1/tasks/:id/submit-url` | Record worker's submitted Reddit URL (GoPartTime tasks) | `{ redditUrl }` | `{ success, data: task }` | 400 invalid/wrong-state; **409 dup URL on another task** |
| POST | `/api/v1/tasks/:id/done` | Activate ACCEPTED task → PENDING + schedule reminders | — | `{ success, data: task }` | 404; 400 not SENT/not ACCEPTED |
| POST | `/api/v1/tasks/:id/reassign` | Move ACCEPTED task to another ticket (delete old delivery, re-deliver) | `{ ticket }` | `{ success, data: task }` | 404; 400 not ACCEPTED/bad channel/multiple workers/same ticket |
| POST | `/api/v1/tasks/:id/retry-assignment` | Re-deliver FAILED assignment (sends only missing tail) | — | `{ success, data: task }` | 400 not FAILED or already submitted |
| POST | `/api/v1/tasks/restore-unpaid-archived` | All ARCHIVED-but-unpaid → COMPLETED | — | `{ success, data: { restored } }` | 500 |
| PATCH | `/api/v1/tasks/:id` | Update status/notes or manage `cancelledReason` | `updateTaskSchema` | `{ success, data: task }` | 404; 400 illegal transition |
| DELETE | `/api/v1/tasks/:id` | Delete task + reminders (cancels jobs first) | — | `{ success, data: { deleted } }` | 404; 500 (RESTRICT if payout items exist) |

PATCH semantics: `cancelledReason` non-null → `updateCancelledReason` + job cancel; null on a CANCELLED task → restore to PENDING (or clear reason + reschedule); else plain status update (state machine).

---

## 6. GoPartTime — `src/api/routes/goparttime.ts` (extension Bearer key)

| Method | Path | Purpose | Response | Errors |
|---|---|---|---|---|
| GET | `/api/v1/goparttime/tickets` | Ticket channels + per-channel task state for the extension dropdown | `{ success, data: TicketInfo[] }` `{ channelId, channelName, guildId, taskStatus: idle\|active\|awaiting-submission }` | 500 |
| POST | `/api/v1/goparttime/assign` | Create + deliver task from extension payload | 201 `{ success, data: task, failed: false }` or 200 `{ success, data, failed: true, error }` (delivery failure) | **409** already assigned; 400 validation; 503 key unconfigured |
| GET | `/api/v1/goparttime/insight/:externalTaskId` | **Read-only** (v1.4.0 Submit View): the stored insight screenshot for the task's view-data step; `?step=1\|2`, optional (auto-resolve). Task resolved via `(source='goparttime', externalTaskId)`; falls back to manually-created tasks whose id embeds the number (`POST #688318` / `Comment #688318` / lowercase variants), accepting only tasks with no source | `{ success, data: { taskId, internalTaskId, type, reminderId, reminderType, step, completed, imageUrl } }`; no reminder → `reminderId: null` + `message` | 400 non-numeric id / invalid step / step-2-on-comment; 404 `'Task not found.'`; 500 |

---

## 7. Discord — `src/api/routes/discord.ts` (JWT + `requireDashboardAdmin`)

| Method | Path | Purpose | Errors |
|---|---|---|---|
| GET | `/api/v1/discord/tickets` | Same ticket list as GoPartTime, for the dashboard | 403 non-admin; 500 |

---

## 7b. Automation — `src/api/routes/automation.ts` (JWT + `requireDashboardAdmin`)

| Method | Path | Purpose | Body | Errors |
|---|---|---|---|---|
| GET | `/automation/status` | Master switches + running/last cycle + blocked count | — | 500 |
| PUT | `/automation/settings` | `{ enabled, dryRun, pollEnabled }` | settings | 400; 500 |
| POST | `/automation/start?forced=1` | Run one cycle now | — | 400 |
| POST | `/automation/stop` | Mark running cycle STOPPED (no new accepts) | — | 500 |
| GET | `/automation/cycles` | Last 20 cycles | — | 500 |
| GET | `/automation/cycles/:id` | Cycle + contacts + task logs | — | 404; 500 |
| GET | `/automation/blocked` | Blocked subreddit list | — | 500 |
| PUT | `/automation/blocked` | Add (normalized exact match) | `{ subreddit, reason? }` | 400; 500 |
| DELETE | `/automation/blocked/:subreddit` | Remove | — | 500 |
| POST | `/automation/session` | Save cookies to encrypted vault | `{ sessionToken ≥50ch, csrfToken, callbackUrl?, nextAction 64-hex?, userAgent? }` | 400 vault unconfigured/invalid |

---

## 7c. Automation Companion — `src/api/routes/automation-companion.ts` (extension Bearer key)

| Method | Path | Purpose | Body | Errors |
|---|---|---|---|---|
| POST | `/automation/sightings` | Watcher task-list snapshot (upserts + heartbeat) | `{ companionId?, version?, tasks: [{ subTaskId, type: post\|comment, subreddit?, title? }] ≤100 }` | 400 |
| GET | `/automation/claims/pending?companionId&version` | Oldest actionable claim (also heartbeat) | — | 500 |
| POST | `/automation/claims/:id/result` | In-page accept verdict | `{ ok, failureReason? }` | 404 resolved; 410 expired; 500 |

---

## 8. Reminders — `src/api/routes/reminders.ts` (JWT; mounted at `/api/v1` AFTER uploads)

| Method | Path | Purpose | Params | Errors |
|---|---|---|---|---|
| GET | `/api/v1/tasks/:taskId/reminders` | All reminders for a task | path | 500 |
| GET | `/api/v1/reminders/upcoming` | Upcoming unsent reminders | `limit` default 10 (uncapped) | 500 |
| PATCH | `/api/v1/reminders/:id` | Reschedule (manual validation) | `{ dueAt: string → Date }` | 400 required/invalid date; 500 |

Route-order note: reminder routes mounted last because `:taskId`/`:id` patterns would otherwise swallow nested paths.

---

## 9. Stats — `src/api/routes/stats.ts` (JWT)

| Method | Path | Purpose | Query | `data` shape |
|---|---|---|---|---|
| GET | `/api/v1/stats` | Overview cards | `guildId?` | `{ total, pending, completed, cancelled, overdue, completionRate, avgCompletionTimeHours, tasksToday, tasksThisWeek, todayPosts, todayComments, todayDeleted, totalDeleted }` |
| GET | `/api/v1/stats/daily` | Tasks/day last N days | `days?` (default 30), `guildId?` | `[{ date:'YYYY-MM-DD', count }]` |
| GET | `/api/v1/stats/types` | POST vs COMMENT | `guildId?` | `[{ type, count }]` |
| GET | `/api/v1/stats/employees` | Per-worker performance | `guildId?` | `[{ userId, total, completed, pending, avgCompletionHours }]` |

All computed in memory over `taskService.findAll` (`src/services/analytics.service.ts`).

---

## 10. Export — `src/api/routes/export.ts` (JWT)

| Method | Path | Purpose | Query | Notes |
|---|---|---|---|---|
| GET | `/api/v1/export/csv` | Tasks CSV | `status?`, `type?`, `guildId?` | `text/csv`, `tasks-export-<ts>.csv`; headers `ID, Type, Status, Reddit URL, Assigned User, Ticket, Notes, Created At, Updated At`; ACCEPTED excluded; display ID (`Post #589482`) |

---

## 11. Audit Logs — `src/api/routes/audit.ts` (JWT)

| Method | Path | Purpose | Query | Notes |
|---|---|---|---|---|
| GET | `/api/v1/audit-logs` | Recent logs | `taskId?`, `action?`, `limit?` (default 50, **capped 100**) | enriched with `externalTaskId`/`taskType` from the task |

---

## 11b. Outreach — `src/api/routes/outreach.ts` (JWT + `requireDashboardAdmin`; factory with discordClient)

| Method | Path | Purpose | Body | Response | Errors |
|---|---|---|---|---|---|
| GET | `/outreach` | Full daily page state | — | `{ istDate: 'YYYY-MM-DD' (IST), message, tickets: [{ channelId, channelName, guildId, taskStatus: 'idle'\|'active'\|'awaiting-submission', workerName, selected, messageSentAt, available: boolean, post: number, comment: number }] }` (sorted by channel name; stale daily cycles lazily reset; `post`/`comment` are counts of tasks created today IST — `0` shows cross, `>0` shows number) | 500 |
| PUT | `/outreach/selection` | Persist checkbox selection | `{ selections: [{ channelId, selected }] }` (max 500) | `{ updated }` (transactional upserts; selection survives day changes) | 400; 500 |
| POST | `/outreach/send` | Send daily message to **selected** tickets only | — | `{ sent: [{ channelId, channelName, ok, error? }] }` — per-channel, non-fatal; audit `OUTREACH_MESSAGE_SENT` | 500 |
| GET | `/outreach/settings` | Current message | — | `{ message }` (defaults to `DEFAULT_OUTREACH_MESSAGE`) | 500 |
| PUT | `/outreach/settings` | Update message | `{ message: 1..2000 chars }` | `{ message }` | 400; 500 |

Availability semantics: a ticket becomes `available` only when its worker (non-bot, non-admin) sends any message in it **after** today's `Send Message` (first reply only). Post/Comment are **counts** of tasks created today (IST) in the channel — any status.

---

## 12. Payouts — `src/api/routes/payouts.ts` (JWT; pay-* also `requireDashboardAdmin`)

Week params (`weekStart`/`weekEnd`) accepted in **query or body** (parsed as Dates; invalid ignored).

| Method | Path | Purpose | Params | Response | Errors |
|---|---|---|---|---|---|
| GET | `/payouts/week` | Current + previous IST week windows | — | `{ current: {weekStart, weekEnd, weekLabel}, previous: {...} }` | 500 |
| GET | `/payouts/summary` | Dashboard cards | week params | `{ workersToPay, completedTasks, pendingAmount, alreadyPaid, totalPosts, totalComments, weekLabel }` | 500 |
| GET | `/payouts/eligible` | Eligible tasks grouped by worker (unpaid only) | week params | `[{ workerId, workerName, posts, comments, totalAmount, status:'Ready', tasks[] }]` sorted ₹ desc | 500 |
| GET | `/payouts/workers/:workerId` | Worker detail | week params | `{ workerName, posts, comments, totalAmount, postsEarnings, commentsEarnings, postRate, commentRate, status, tasks[{id,type,externalTaskId,createdAt,completedAt,amount,paid}] }` | 404 no eligible tasks |
| POST | `/payouts/pay-worker/:workerId` | Pay one worker (creates/reuses week batch; COMPLETED→ARCHIVED) | week params in body/query | `{ batch, items }` | 403; 400 none eligible/already paid |
| POST | `/payouts/pay-all` | Pay all eligible workers (new batch, `paidAt=now`) | week params | `{ batch, items }` | 403; 400 |
| GET | `/payouts/batches` | Batch history | `limit?` (default 20, cap 100) | `PayoutBatch[]` | 500 |
| GET | `/payouts/batches/:batchId` | Batch detail with items + worker names | — | `{ batch, items[], workerNames{} }` | 404 |
| GET | `/payouts/export/csv` | Batch/week CSV | `batchId?`, week params | `payout-batch-<id>-<ts>.csv`; headers `Worker Name, Posts, Comments, Total Amount (₹), Payment Date, Batch Number` | 500 |

---

## 13. Settings — `src/api/routes/settings.ts` (JWT; PUT admin by Discord ID)

| Method | Path | Purpose | Body | Errors |
|---|---|---|---|---|
| GET | `/api/v1/settings/payout-rates` | Rates (defaults 30/60 when unset) | — | 500 |
| PUT | `/api/v1/settings/payout-rates` | Update rates | `{ commentRate 1..1000, postRate 1..10000 }` | 400; 403 `'Admin access required.'`; 500 |

---

## 14. Commissions — `src/api/routes/commissions.ts` (JWT; referral/pay ops `requireDashboardAdmin`; rates PUT `isAdmin` Discord)

| Method | Path | Purpose | Body/Query | Errors |
|---|---|---|---|---|
| GET | `/commissions/rates` | Commission rate config (defaults when unset) | — | 500 |
| PUT | `/commissions/rates` | Update rates | `{ normalInviteBonus 0..10000, normalInviteTaskThreshold 1..100, specialInviteBonus 0..10000, specialInviteTaskThreshold 1..100, specialPerComment 0..1000, specialPerPost 0..10000 }` | 400; 403; 500 |
| GET | `/commissions/summary` | Dashboard cards | week params | `{ totalInviters, totalSuccessfulInvites, totalCommission, totalBonusAmount, totalPerTaskAmount, alreadyPaidCommission }` |
| GET | `/commissions/breakdown` | Per-inviter breakdown | week params | `[{ inviterId, inviterName, inviterType, totalReferrals, successfulReferrals, totalCommission, status:'Ready' }]` |
| GET | `/commissions/inviters/:inviterId` | Inviter detail | week params | `{ inviterName, inviterType, status, referrals[{referralId, inviteeName, inviteeTasks, bonusAmount, perTaskAmount, isSuccessful, bonusPaid}], totalBonus, totalPerTask, totalCommission }` |
| GET | `/commissions/referrals` | All referrals | — | `Referral[]` |
| POST | `/commissions/referrals` | Create referral (admin) | `{ inviterId, inviterName, inviteeId, inviteeName, inviterType }` (`ticketId` accepted by service but NOT in zod) | 201; 400 dup invitee+inviter |
| PATCH | `/commissions/referrals/:referralId` | Update (names, inviter/invitee IDs, ticketId; inviter change re-derives type + chain) | `{ inviterId?, inviteeId? (snowflakes), inviterName?, inviteeName?, ticketId? nullable }` | 403; 404; 400 |
| DELETE | `/commissions/referrals/:referralId` | Delete | — | 403; 400 |
| POST | `/commissions/pay-inviter/:inviterId` | Pay one inviter (batch + items + referral flags) | — | 403; 400 |
| POST | `/commissions/pay-all` | Pay all inviters in one batch | — | 403; 400 `'No unpaid commissions available.'` |
| GET | `/commissions/invite-detections` | Approval queue (auto-detected joins) | `status?` (`pending` default, `all`), `limit?` (default 100, cap 500) | 500 |
| POST | `/commissions/invite-detections/:id/approve` | Approve → creates the real Referral | — | 403; 400 (unknown inviter / dup / already handled) |
| POST | `/commissions/invite-detections/:id/reject` | Reject a pending detection | — | 403; 400 |
| PATCH | `/commissions/invite-detections/:id` | Edit a pending detection (set inviter etc.) | `{ inviterId? (snowflake, nullable), inviterName? (nullable), inviteeName? }` | 403; 400 |
| GET | `/commissions/export/csv` | CSV | `batchId?`, week params | `commission-batch-<id>-<ts>.csv`; headers `Inviter Name, Inviter Type, Invitee Name, Bonus (₹), Per-Task (₹), Total Commission (₹), Status` |
| GET | `/commissions/batches` | Batch history | `limit?` (default 20, cap 100) | 500 |
| GET | `/commissions/batches/:batchId` | Batch detail | — | 404 |

---

## 15. Owner — `src/api/routes/owner.ts` (NO JWT)

| Method | Path | Purpose | Body | Response | Errors |
|---|---|---|---|---|---|
| POST | `/owner/verify` | PIN gate for the owner panel | `{ pin }` | correct → 200 `{ success:true, message:'Access granted.' }`; wrong → **200** `{ success:false, message:'Invalid PIN.' }` | 400 `'PIN is required.'`; 500 |
| GET | `/owner/daily-earnings` | Today's (IST) net earnings; **no auth** | — | `{ date, summary{ totalTasks, posts, comments, totalRevenue, totalWorkerCost, totalSpecialPerTaskComm, totalNormalBonuses, totalSpecialBonuses, totalEarnings }, taskBreakdown[], referralDeductions[] }` | 500 |
| GET | `/owner/daily-earnings/history` | Last N days; **no auth** | `days?` (default 7, clamped 1–30) | `{ rows: [{ date, summary }] }` | 500 |
| GET | `/owner/weekly-earnings` | Sunday→today IST; **no auth** | — | `{ weekStart, weekEnd, summary, taskBreakdown[], referralDeductions[] }` | 500 |

Hardcoded model: revenue ₹250/post, ₹100/comment; worker cost ₹60/₹30; commission rates from settings (see `docs/REFERRAL_SYSTEM.md`).

---

## 16. Uploads — `src/api/routes/uploads.ts` (NO auth; mounted before reminders)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/v1/uploads/insights/:taskId/:filename` | Serve insight screenshot from `<cwd>/uploads/insights/` | Rejects `..`/`/` in both params (400 `'Invalid path.'`); 404 `'Image not found.'`; sendFile |

---

## 17. Callers Map (who calls what)

| Caller | Endpoints used |
|---|---|
| Dashboard `api/client.ts` | almost all JWT endpoints (full list in `docs/FRONTEND.md`) |
| Extension userscript | `GET /goparttime/tickets`, `POST /goparttime/assign`, `GET /goparttime/insight/:externalTaskId` (Submit View, v1.4.0) |
| Discord bot | commands hit repositories/services directly (no HTTP); only the API serves `/discord/tickets` |
| Health watch | `GET /health` (no consumer found in repo — nothing polls it) |