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