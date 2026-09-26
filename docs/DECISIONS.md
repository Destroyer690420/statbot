# DECISIONS.md — Architectural Decision Log

> Every decision below is established from the repository (code, git history, specs). Unknown motivations are marked UNKNOWN. Verified 2026-08-11.

---

## Decision 1: PostgreSQL over Firestore (Prisma 7)

- **Context**: The app launched on Firestore (`ed82c7a`, 2026-07-19; `firebase-admin`, collection helpers, 23 composite indexes). Queries like weekly payouts, aggregates, and range filters required either composite index gymnastics or in-memory work; the team wanted ownership/control.
- **Decision**: Migrate to PostgreSQL with Prisma 7 (`prisma-client` generator, `@prisma/adapter-pg`), repository pattern.
- **Reason**: relational queries/aggregates/transactions; cost control; no vendor lock-in (per `plan.md` sections 02-03).
- **Consequences**: single-file manual migrations; a one-time export/import migration (`export-firestore.ts` → `import-postgres.ts`, 1325 docs); repositories + converters layer; two-day phased rollout (Phase 4 `1f01cc2` rewrite, Phase 5 `702520a` cutover).
- **Status**: **Complete** (2026-07-26). Firestore references remain only as inert config/comment/helper artifacts.

## Decision 2: Single hand-maintained idempotent migration file

- **Context**: Prisma's standard migration folders would add moving parts to a manually-administered VPS.
- **Decision**: One `prisma/migrations/migration.sql`, written `IF NOT EXISTS`-safe, applied by hand; schema.prisma kept in sync by hand.
- **Reason**: simple, auditable, re-runnable, no `migrate deploy` dependency in any pipeline.
- **Consequences**: manual discipline required; drift between SQL and schema possible (a stale generated client already demonstrated the class of problem).
- **Status**: Current practice; documented in `docs/DATABASE.md`.

## Decision 3: No cron — BullMQ delayed jobs + setInterval

- **Context**: Reminder deadlines are absolute (`createdAt + 20h/70h`); the system must survive Redis/bot restarts.
- **Decision**: BullMQ `reminder-queue` with deterministic job IDs (`reminder-{id}`, `retry-{id}-{n}`), delay computed from `dueAt − now`; in-process `setInterval` loops for archive/cleanup/re-hydration.
- **Reason**: deadlines are event-like; re-hydration from PostgreSQL makes jobs durable; deterministic IDs dedupe naturally.
- **Consequences**: no cron dependency; Redis loss loses only pending jobs (recovered ≤30 min); all "scheduled" logic is now split across worker hooks and index.ts timers.
- **Status**: Current practice (`src/scheduler/**`, `src/index.ts`).

## Decision 4: Reminder deadlines derive from `createdAt`

- **Context**: Reminder timing must be stable and predictable for workers.
- **Decision**: `dueAt = task.createdAt + REMINDER_DELAYS[type]`; retries add `RETRY_DELAYS` (2h/6h), max 3 sends, then admin overdue ping.
- **Reason**: stable across reschedules/re-hydration; simple mental model (20h/70h from task creation).
- **Consequences**: rescheduling is an explicit override (`/reschedule`, `PATCH /reminders/:id`, `/send-now`).
- **Status**: Current practice.

## Decision 5: Guild-scoped commands with per-command permission checks

- **Context**: Single-guild deployment; admin/manager split via env ID lists.
- **Decision**: Deploy via `applicationGuildCommands` (guild-scoped), permission checks inside each command's `execute`.
- **Reason**: simpler than central middleware for a 1-guild bot; explicit per-command semantics (some commands public).
- **Consequences**: re-deploy needed after command edits; permission logic duplicated 12×; `/delete` uses interactive button confirmation.
- **Status**: Current practice.

## Decision 6: Local disk insight storage with 60h TTL, unauthenticated serving

- **Context**: Screenshots must be viewable in the dashboard; no object storage budget.
- **Decision**: Save to `<cwd>/uploads/insights/<taskId>/<reminderId>.<ext>`; serve via `GET /uploads/insights/:taskId/:filename` (no auth, traversal-guarded); hourly cleanup deletes files older than 60h. (TTL raised from 30h → 60h on 2026-08-17: GoPartTime Submit View needs the 70h screenshots to stay downloadable while the manager submits view data.)
- **Reason**: simple; TTL bounds storage and exposure.
- **Consequences**: public URLs for ≤60h; images vanish before slow admins might view them; volume must be mounted in Docker.
- **Status**: Current practice (`src/services/insight-storage.service.ts`).

## Decision 7: Two-level referral — added then reverted (same day)

- **Context**: Recruiter-based multi-level referral was requested; implemented in `9348d2d` (2026-08-09): `ReferralRole`, `Referral.role`, `Referral.indirectSpecialInviterId`, unique index, dedup DELETE.
- **Decision Made**: **Reverted** in `ac441e2` the same day.
- **Reason**: UNKNOWN (no commit message rationale beyond "Revert").
- **Consequences**: schema/code clean; if revived, must be re-designed from scratch. History kept only in git.
- **Status**: Reverted.

## Decision 8: Single dashboard account + JWT, separate owner PIN

- **Context**: Admin surface is small; the owner wants a private earnings view.
- **Decision**: One env-configured dashboard user (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`), JWT 24h; a separate 4-digit `OWNER_PIN` gates the owner-earnings page.
- **Reason**: no user table needed; minimal attack surface.
- **Consequences**: token has no roles (admin = "username matches"); owner endpoints themselves are unauthenticated (known issue); PIN default is weak (`7977`).
- **Status**: Current practice; flagged in `docs/SECURITY.md`.

## Decision 9: GoPartTime ingest uses an ACCEPTED queue with explicit activation

- **Context**: External tasks need dedup + review before entering the reminder pipeline; workers submit Reddit URLs after publishing.
- **Decision**: Extension assigns → task `ACCEPTED` (`assignmentStatus PENDING→SENT→FAILED`); worker replies URL; manager activates via `/done` → `PENDING` + reminders.
- **Reason**: dedupe on `(source, externalTaskId)`, one-task-per-ticket guard, and human review before deadlines start.
- **Consequences**: tasks can sit un-activated indefinitely; retry/reassign mechanics required; `TASK_REVIEWED` action defined but unused.
- **Status**: Current practice (`src/services/goparttime.service.ts`).

## Decision 10: Payout week = IST Sunday–Saturday, dashboard-triggered

- **Context**: Business week in India; payout runs manually.
- **Decision**: Week window `Sunday 00:00 IST → Saturday 23:59:59.999 IST` (5.5h shift trick); payouts via dashboard only (`pay-worker`/`pay-all`); completion time derived from reminders.
- **Reason**: matches business reality; manual control over payments.
- **Consequences**: no automation (nothing pays on Sunday automatically); derived completion times can misplace tasks across weeks (known issue).
- **Status**: Current practice.

## Decision 11: Auto-archive only for paid tasks; restore path for unpaid

- **Context**: ARCHIVED hides tasks from active lists; unpaid tasks must not be lost.
- **Decision**: daily 30-day sweep + weekly Sunday archive require a PayoutItem; `POST /tasks/restore-unpaid-archived` reverts over-archived tasks.
- **Reason**: payment records protect against data loss; restore provides safety.
- **Consequences**: paid tasks are effectively immutable (FK RESTRICT); restore is a blunt all-or-nothing tool.
- **Status**: Current practice.

## Decision 12: Manual deletion override instead of auto Reddit-deletion detection

- **Context**: Auto-detection (`check-reddit.ts`, `isPostDeleted`) proved unreliable for the workflow.
- **Decision**: Remove auto-detection (07-21 `148c75b`); admins set `cancelledReason = 'deleted' | 'deleted_later'` via the dashboard.
- **Reason**: accuracy/control; deletion is a business decision.
- **Consequences**: `check-reddit.ts` remains as dead code; deletion stats rely on manual flags.
- **Status**: Current practice.

## Decision 13: Docker Compose (nginx front, backend internal) + DuckDNS + LetsEncrypt

- **Context**: Public web dashboard + bot on one VPS with a dynamic DNS domain.
- **Decision**: compose services `app` (no public ports) + `redis` (no persistence) + `dashboard` (nginx 80/443, TLS webroot); PostgreSQL external on host; `statbot.duckdns.org`; PM2 config retained as alternative.
- **Reason**: TLS termination at nginx; backend unreachable from the internet; domain via DuckDNS for a dynamic IP.
- **Consequences**: no container healthchecks; LetsEncrypt renewal relies on host cron (not in repo); Redis data loss tolerable via re-hydration.
- **Status**: Current declared architecture; actual last deployment date UNKNOWN.

## Decision 14: Daily outreach cycle = IST day, lazy reset, persistent selection

- **Context**: Manager broadcasts a daily availability message to ticket channels and tracks who replied; the cycle must follow the IST business day (00:00 IST reset) and survive server restarts.
- **Decision**: `TicketOutreach` row per channel (`selected` persists across days; `messageSentAt`/`availableAt` are cycle-scoped) + `OutreachSettings` singleton for the message text. No cron/queue: the "reset" is lazy — when `messageSentAt < today's IST midnight` the row is treated as a fresh cycle (Post/Comment are always derived from tasks created today in the channel, never stored). Availability = first worker message after today's send (`messageCreate.ts` hook; bots and admin/manager IDs never count). Message delivery is broadcast-only to checked tickets (no per-worker targeting).
- **Reason**: matches the established IST-week pattern (Decision 10); zero scheduled infra; selection as a remembered preference avoids re-checking 30+ tickets daily; deriving Post/Comment keeps a single source of truth (Task table).
- **Consequences**: new tables + `AuditAction OUTREACH_MESSAGE_SENT`; availability can be marked by any worker message (not just a reply to the broadcast); no auto-re-send if the message fails mid-broadcast (per-channel result shown in UI, manager re-clicks).
- **Status**: Current practice (`src/services/outreach.service.ts`, `src/utils/ist-time.ts`).

## Decision 15: Hybrid companion flow after Vercel hard-blocks the datacenter

- **Context**: Automated GoPartTime acceptance needs 24/7 task monitoring, but Vercel's bot management returns Code 11 ("Failed to verify your browser") for every server-side client tried with fresh cookies — Node fetch, Alpine Chromium headless/headful under Xvfb, genuine Chrome-for-Testing with stealth flags — while the manager's desktop browser works fine. Verdict implicates datacenter IP reputation + server signals, not the session or binary.
- **Decision**: The manager's trusted browser (new `goparttime-auto.user.js` companion) reports task sightings and performs the in-page accept; the server validates, matches workers, and queues claims, but never fetches GoPartTime in this mode (`pollEnabled` stays off; the Playwright poller code remains dormant behind its flag). Session cookies never leave the browser.
- **Reason**: zero Vercel exposure from the Oracle IP; genuine session/TLS/IP on every GoPartTime request; full task detail available from the DOM for the existing assign pipeline (no flight-data content resolution needed).
- **Consequences**: requires the manager's browser open (not true 24/7); claim queue + heartbeat + expiry machinery; stale claims release workers; dashboard shows watcher online/offline.
- **Status**: Implemented 2026-09-08 (`src/services/automation/queue.service.ts`, `src/api/routes/automation.ts` incl. companion endpoints, `scripts/goparttime-auto.user.js`). Single router with per-path auth dispatch (JWT vs extension key) — two routers on one prefix cannot work because the first router's `use(auth)` intercepts the other's paths.

## Decision 16: Spare-account session vault for server-side Reddit fetch

- **Context**: Reddit killed anonymous `.json` access (www → 403 for any client on any IP, old → login gate, Oracle ASN hard-blocked — probed locally and from the VPS 2026-09-13). The server format check therefore NEVER succeeded live; OAuth app registration was unavailable, so only a login session works.
- **Decision**: A dedicated spare Reddit account's full Cookie header lives AES-256-GCM-encrypted in a new `RedditSession` singleton vault row (existing `GOPARTTIME_SESSION_KEY`, never logged); the server sends it verbatim with a browser UA. The manager pastes/refreshes it self-service (dashboard Settings card via JWT, or extension-key endpoint — no SSH). New `NO_SESSION` / `SESSION_EXPIRED` statuses make the failure mode explicit instead of a misleading FETCH_ERROR. Cookie belongs to a spare account so a VPS-IP flag never touches the manager's main account.
- **Reason**: only working server-side path; matches the existing GoPartTime vault pattern; self-service refresh avoids SSH on every expiry.
- **Consequences**: new table + audit value (additive DDL); cookie re-paste needed on expiry/password change; if Reddit ever gates cookie-auth from datacenter ASNs, the Tampermonkey session script remains the fallback.
- **Status**: Implemented + deployed 2026-09-13 (`src/services/reddit-session.service.ts`, `src/services/reddit-check.service.ts`, `GET /tasks/:id/live-reddit`).

## Decision 17: Worker portal — ticket-OTP login, read-only, separate JWT secret

- **Context**: Workers (Discord users, one ticket channel each) see nothing today; the admin dashboard knows everything. The 2026-09-22 portal (`4c75858`) was reverted same-day (`4339cea`+`5d23ad5`): worker JWTs shared the admin secret with no claim checks (a worker token passed admin routes), it exposed owner USD `payment`/`deadline`, listed every ticket with counts, had weak OTPs (6-digit, no cooldown, leftover messages, in-memory fallback, heavy guild-member identity), and showed no payment/insight info.
- **Decision**: Rebuilt 2026-09-24 and deployed 2026-09-24; ticket-OTP login kept per owner decision, but (1) worker tokens use a separate `WORKER_JWT_SECRET` with `typ/sub/tid/name/jti/aud/iss` claims while the admin middleware pins HS256 + requires the dashboard username; (2) identity comes only from the token `sub`, newest task in the login channel resolves the worker (no guild-member fetch); (3) portal is read-only (insights stay Discord-reply-only); (4) owner rule ARCHIVED = paid / COMPLETED = awaiting payment / any `cancelledReason` or CANCELLED = failed, with precedence failed > paid > payable > to-do; (5) wallet reuses payout rates, IST week helpers, and the completion-time rule via batched worker-scoped queries (never `PayoutBatch.paidAt` — pay-worker batches keep it null forever); (6) kill switch `WORKER_PORTAL_ENABLED` defaults off; (7) strict isolation tested by a two-worker regression suite. A visual-only worker UI redesign was deployed 2026-09-25 at `e5b413e` without changing these contracts.
- **Reason**: Workers need self-service visibility into their own tasks/insights/earnings; read-only keeps the Discord reminder flow authoritative; a separate secret + claim checks + whitelist DTOs close every defect class of the reverted attempt.
- **Consequences**: New `WORKER_JWT_SECRET`/`WORKER_PORTAL_ENABLED` envs (optional, portal disabled unless set); no schema/migration; bot must be able to send + delete its own messages in tickets.
- **Status**: Implemented + deployed 2026-09-24 (git HEAD `5cc0f8c`; no migration; verified live); visual-only UI redesign deployed 2026-09-25 (git HEAD `e5b413e`; no migration; verified live).

## Decision 18: Worker Portal access tracking is per ticket, successful logins only

- **Context**: The owner needs a tick in the admin Daily Outreach page for tickets whose workers have used the Worker Portal. The portal issues a 7-day token after ticket-OTP login; no live session registry exists, and logout only denylists the current `jti`.
- **Decision**: Track access in a new `WorkerPortalAccess` table keyed by Discord `channelId` (not worker ID), so each ticket has an independent status even when one worker owns several tickets. `firstSeenAt` is write-once; `lastSeenAt` and `workerId` update only after a successful ticket-OTP verification. The admin `/outreach` response adds `portalAccessed` and `portalLastSeenAt`; the dashboard shows a tick plus a last-login tooltip. No write occurs for normal browsing.
- **Reason**: The login ticket is the real access boundary; this matches the owner's requested per-ticket tick, avoids per-request writes, and never treats a long-lived token as a live session.
- **Consequences**: Additive idempotent migration; login tracking is best-effort and cannot block authentication; outreach read is fail-open if the table is not yet applied. No historical backfill exists because the previous release kept no access ledger. Admin-only fields never enter worker DTOs.
- **Status**: Implemented and deployed 2026-09-25 (git HEAD `675c618`, code `0122775`; migration applied — `WorkerPortalAccess` created empty; verified live including a production-DB repository upsert/read check; no live OTP login test because it would post a real code in a ticket).

## Decision 19: Workers see their own invite list and invite earnings, multi-level money anonymised

- **Context**: referral money was only ever visible to admins (dashboard) or through the Discord `/myinvites` command, so a worker could not see from the panel how many people they invited, which tickets those people got, or what they had earned. The commission engine also records `per_task_indirect` items for a special inviter on referrals that inviter does not own, which the existing command never showed.
- **Decision**: (1) new read-only `GET /worker/invites` + a fifth worker-panel tab ("Invites"), reusing the existing commission rules rather than a parallel calculation — `paid` from that inviter's `CommissionItem` rows, `directPending` from the same `commissionService.getPayableItems` engine the payout buttons use, so the panel and Discord `/myinvites` cannot disagree; (2) per invitee show only display name, ticket *number* and **task progress capped at the threshold** (owner choice: totals only, no drill-down, no rates) — amended 2026-09-26 from a per-invitee rupee figure to `tasks/threshold` because the bonus pays once at the threshold, so per-row money reads ₹0 until a payout runs and then stops moving, while the count explains *why* the ₹100 is pending; (3) multi-level earnings are surfaced as one anonymous `teamPaid` figure inside the total, never attributed to the downstream workers who generated them; (4) no Discord id, referral id, commission kind, inviter type, or rate crosses the worker boundary, and an unresolvable ticket reference returns `null` instead of an id.
- **Reason**: the worker panel is where workers already look, and the numbers come from the one payable engine rather than a reimplementation; anonymising the chain earnings keeps the feature informative for the three special inviters without exposing workers who did not consent to being tracked by an upstream inviter.
- **Consequences**: no schema or env change; one new repository method (`findItemsByInviterId`, scoped + projected) and one new service module; the invitee ticket number depends on `Task.channelName` being recorded for that channel, otherwise it shows "No ticket yet"; pending money is computed per referral at read time (N+1 for inviters with many referrals, acceptable for a page that is not polled).
- **Status**: Implemented and deployed 2026-09-26 at `56abf0b` (per-row metric change). Ticket-less inviter login: implemented 2026-09-26, NOT deployed.

## Decision 20: A ticket-less inviter login, proven by a Discord DM code

- **Context**: the portal identifies a worker *only* through `Task.assignedUserId` (Decision 17). A person who only invites and never receives a task therefore has no identity in the system at all — their ticket is unsearchable, `resolveWorkerIdentityForChannel` returns null, and login is impossible. Measured on 2026-09-26: of 244 live `ticket-*` channels, only **87** have a task; **157 cannot log in at all**. That set includes a top inviter with 40 referrals. Their referral identity *does* exist (`Referral.inviterId`), and `/myinvites` already serves them in Discord because it uses the command author's id.
- **Decision**: add a second login path that authenticates the **Discord account** instead of a ticket. (1) The worker enters their Discord username; the server resolves a guild member and **DMs** a one-time code, reusing the existing OTP machinery (same alphabet, HMAC-only storage, 5-min TTL, cooldown, hourly cap, attempt lockout) under a per-user Redis namespace. (2) `/logincode` is the fallback for closed DM inboxes, replying ephemerally. (3) The token gains `scope: 'ticket' | 'inviter'`; only inviter tokens may carry an empty `tid`, and legacy tokens without the claim stay `ticket`. (4) `/me` reports `capabilities {hasTasks, hasInvites}` and a nullable `ticket`, and the panel hides the work tabs for an account with no tasks and lands them on Invites. (5) `paidThisWeek` is attributed to the disbursing **batch's** IST payout week.
- **Reason**: a DM proves control of the Discord account itself, which is strictly stronger than the ticket-channel code any member can read, and it needs no new external setup (no OAuth app, no secret). Keeping it a *separate* path leaves the ticket flow that 87 working tickets depend on untouched, so people who both invite and work keep exactly the experience they have now — the explicit owner requirement.
- **Consequences**: unknown/non-member usernames get a byte-identical success response (no account, membership or invite enumeration); a code only verifies for the account it was sent to; IP rate limits bound DM spam. `/me` and the nav become capability-driven. A worker who neither invites nor has tasks sees only How-to. The ticket-less path deliberately does **not** try to identify task-less tickets via guild-member or audit-log lookup: audit logs are already trimmed for these tickets and the REST member route is privileged, so neither can be verified for historical tickets — a Decision 17-compatible fallback is still open.
- **Status**: Implemented 2026-09-26, NOT deployed. 35 suites / 463 tests pass locally.