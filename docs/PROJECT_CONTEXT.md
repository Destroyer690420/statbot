# PROJECT_CONTEXT.md — Reddit Task Manager

> **Persistent project memory.** Future OpenCode sessions MUST read this file first.
> Repository: `reddit-task-manager` · Last verified: 2026-09-13 — Reddit session vault + share-link fix DEPLOYED (`161.118.164.85`, git HEAD `e4d6f95`; backups `rtm-backup-20260913-redditsess.tar.gz` + `rtm-backup-20260913-sharefix.tar.gz`; migration excerpt applied live: `RedditSession` + `REDDIT_SESSION_UPDATED`; spare-account cookie vaulted; pushed to GitHub; verified: health healthy, boot "All systems online!", dashboard 200, live recheck on real worker share link → **MATCH 6/6**, 277/277 jest). Previous: Session format pre-check script (`004fea7`).

---

## 1. Project Overview

A production system that runs a **Discord bot + REST API + React admin dashboard** to manage Reddit posting tasks:

- Workers are assigned tasks (Reddit posts or comments) inside Discord **ticket channels**.
- Tasks carry **insight (view-data) requirements**: workers must reply to bot reminders with screenshots of view data at **20 hours** (comments and posts' first check) and **70 hours** (posts' second check).
- Tasks can be created manually by admins via slash commands or the dashboard, or ingested automatically from the **GoPartTime** job website via a Tampermonkey userscript.
- Completed tasks earn money: **weekly payout batches** are computed for workers and **referral commissions** for inviters.
- An **owner earnings** view estimates net daily/weekly profit (revenue − worker cost − commissions).
- All scheduling is event-driven (BullMQ delayed jobs + in-process `setInterval` housekeeping). **There is no cron.**

---

## 2. Current Architecture (high level)

```
GoPartTime (goparttime.net)          Discord (ticket channels)
   │ userscript (Tampermonkey)               ▲   ▲
   │ POST /api/v1/goparttime/assign          │   │ messages/reminders/replies
   ▼                                         │   │
Docker: nginx (80/443, DuckDNS, TLS)  ───►  Express REST API (:3000, internal)
   │ dashboard SPA (/api proxied)            │
   ▼                                         ▼
React dashboard (nginx)           PostgreSQL (Prisma 7, external host) + Redis 7 (BullMQ reminder-queue)
```

- **Backend** (`src/`): Express 4 REST API (`/api/v1`), discord.js 14 bot, BullMQ worker, services/repositories pattern with Prisma 7 (PostgreSQL via `@prisma/adapter-pg`).
- **Frontend** (`dashboard/`): React 18 + Vite + Tailwind + Recharts SPA served by nginx; PWA-capable.
- **Database**: PostgreSQL (single hand-maintained migration file), previously Firestore (fully cut over 2026-07-26, legacy config files remain).
- **Scheduling**: Redis + BullMQ queue `reminder-queue`; delayed jobs for reminders; `setInterval` loops for auto-archive, insight-image cleanup (60h TTL), and reminder re-hydration.
- **External integrations**: GoPartTime (userscript → API), Discord (bot), Reddit (submitted URLs validated, deletion tracking via manual override), sentry-style local logging (winston).

---

## 3. Technology Stack

| Technology | Version | Purpose | Where |
|---|---|---|---|
| Node.js | >= 18 (container: 20-alpine) | Runtime | backend, dashboard build |
| TypeScript | ^5.7.2 | Language | all code |
| Express | ^4.21.1 | REST API | `src/api/` |
| discord.js | ^14.16.3 | Discord bot | `src/bot/` |
| Prisma | ^7.9.0 (client + CLI) | ORM | `prisma/`, `src/database/` |
| PostgreSQL | (external, version UNKNOWN) | Database | database |
| Redis | 7-alpine (container) | BullMQ broker | `docker-compose.yml` |
| BullMQ | ^5.25.6 / ioredis ^5.4.1 | Delayed reminder jobs | `src/scheduler/` |
| React / ReactDOM | ^18.3.1 | Dashboard UI | `dashboard/src/` |
| Vite | ^6.0.3 | Dashboard bundler/dev server | `dashboard/` |
| Tailwind CSS | ^3.4.16 | Styling | `dashboard/` |
| TanStack React Query | ^5.62.0 | Data fetching | `dashboard/src/` |
| Recharts | ^2.14.1 | Charts | `dashboard/` |
| axios | ^1.7.9 | HTTP client | `dashboard/src/api/` |
| helmet / cors / express-rate-limit | ^8 / ^2.8.5 / ^7.4.1 | Security middleware | `src/api/server.ts` |
| jsonwebtoken | ^9.0.2 | Dashboard JWT auth | `src/api/routes/auth.ts` |
| zod | ^3.24.1 | Validation | `src/utils/goparttime-payload.ts`, routes |
| winston | ^3.17.0 | Logging | `src/utils/logger.ts` |
| sharp | ^0.35.3 | Image compression for Discord delivery | `src/utils/image-processor.ts` |
| node-html-parser | ^9.0.1 | GoPartTime HTML → markdown | `src/utils/html-to-discord.ts` |
| nanoid | ^3.3.7 | ID generation | `src/utils/id-generator.ts` |
| dayjs | ^1.11.13 | Date math | `src/services/analytics.service.ts` |
| Jest + ts-jest | ^30 / ^29 | Tests | `src/__tests__/` |

---

## 4. Repository Structure

```
├── AGENTS.md                    # OpenCode session instructions (this file's sibling)
├── src/                         # Backend (bot + API + services)
│   ├── index.ts                 # Boot sequence (6 steps) + in-process housekeeping timers
│   ├── api/                     # Express: server.ts, middleware/{auth,extensionAuth,errorHandler,validate}, routes/*.ts (14 files)
│   ├── bot/                     # Discord: index.ts, deploy-commands.ts, commands/ (12), events/{interactionCreate,messageCreate}, embeds/
│   ├── config/                  # env.ts (zod), constants.ts (all delays/thresholds)
│   ├── database/                # db.ts (PrismaPg), converters.ts, repositories/ (7 repos)
│   ├── scheduler/               # queue.ts, jobs.ts, worker.ts (BullMQ reminder engine)
│   ├── services/                # task, state-machine, reminder, insight-storage, payout, commission, referral(→commission), owner-earnings, analytics, audit, settings, goparttime, goparttime-insight, outreach
│   ├── __tests__/               # 8 jest test files
│   └── utils/                   # validators, goparttime-payload, html-to-discord, plain-task-message, discord-chunker, image-processor, id-generator, logger, permissions, task-display, check-reddit (UNUSED)
├── dashboard/                   # React SPA + Dockerfile (nginx) + nginx.conf + public/goparttime-send.user.js
├── prisma/                      # schema.prisma + migrations/migration.sql (single hand-maintained file)
├── scripts/                     # goparttime-send.user.js (source userscript), import-postgres.ts (one-time migration tool), page-before/after.html
├── dist/                        # STALE prebuilt backend output (gitignored; do not trust)
├── Dockerfile                   # Backend only (bot+API); dashboard has its own Dockerfile
├── docker-compose.yml           # app + redis + dashboard(nginx 80/443, TLS via LetsEncrypt)
├── ecosystem.config.js          # PM2 config (non-Docker path)
├── prisma.config.ts             # Prisma 7 config (URL from DATABASE_URL)
├── firebase.json / firestore.indexes.json  # LEGACY Firestore artifacts (inactive)
├── plan.md, sending.md, goparttime_discord_dom_and_limits_spec.md, ANDROID_SETUP.md  # design/spec docs (root)
└── .env.example                 # STALE in places (still lists FIREBASE_*, missing DATABASE_URL)
```

Full file inventory and responsibilities: `docs/ARCHITECTURE.md`.

---

## 5. Major Features (all implemented and verified)

1. **Slash commands** (12): `/task /status /find /delete /pending /completed /overdue /stats /reschedule /send-now /help /referral add` — guild-scoped, permission-checked per command. See `docs/DISCORD_BOT.md`.
2. **Reminder engine**: BullMQ delayed jobs; POST tasks 20h + 70h reminders, COMMENT tasks 20h only; 2 retries (+2h, +6h); max 3 sends then admin overdue alert; 30-min re-hydration from DB. See `docs/REMINDER_SYSTEM.md`.
3. **Insight system**: workers reply to reminder messages with a screenshot (png/jpg/jpeg/webp); reply detection by stored `reminderMessageId`; insight images stored on disk under `<cwd>/uploads/insights/<taskId>/` with 60h TTL cleanup; served unauthenticated via `/api/v1/uploads/insights/...`. See `docs/INSIGHT_SYSTEM.md`.
4. **Task state machine**: `ACCEPTED → PENDING → REMINDER_20_SENT → INSIGHT_20_RECEIVED → (REMINDER_70_SENT → INSIGHT_70_RECEIVED) → COMPLETED → ARCHIVED` + `CANCELLED`; see `docs/TASK_SYSTEM.md` (also `src/services/state-machine.ts`).
5. **Deletion tracking**: admin sets `cancelledReason` = `deleted`/`deleted_later` via the dashboard dropdown (auto Reddit-deletion detection was removed — `check-reddit.ts` is now dead code).
6. **Auto-archive**: daily sweep archives paid COMPLETED/CANCELLED older than 30 days; weekly Sunday archive moves all paid COMPLETED → ARCHIVED; unpaid archived tasks can be restored to COMPLETED (`POST /tasks/restore-unpaid-archived`).
7. **GoPartTime integration**: Tampermonkey userscript extracts task details from goparttime.net, posts to `/api/v1/goparttime/assign` (Bearer `GOPARTTIME_API_KEY`), backend creates the task as `ACCEPTED`, auto-detects the single worker in the ticket channel, delivers formatted task content into Discord, worker replies with the Reddit URL, manager activates (`/done` → PENDING + reminders). Retry/reassign supported on failures. **Submit View automation (v1.4.0)**: the userscript's "📊 Submit View" floating button (desktop only — auto-disabled on narrow/mobile viewports since v1.4.0, override via `gpt_submit_view_enabled` + menu toggle) fetches the stored Statbot insight screenshot for the tracked task card's current view-data step via `GET /api/v1/goparttime/insight/:externalTaskId?step=1|2` (read-only), shows it in a floating zoomable preview (same Blob as the upload — no second download), and attaches it to the GoPartTime view dialog's file input; view-count entry, clicking Submit, and success verification remain **manual** (no confirm endpoint — the Discord reply flow is still the only reminder-completion path). See `docs/GOPARTTIME.md` + `docs/BROWSER_EXTENSION.md`.
8. **Payout system**: weekly (IST Sunday→Saturday) totals from `PayoutSettings` rates (defaults ₹30/comment, ₹60/post); workers paid per completed task; pay-worker/pay-all create `PayoutBatch` + `PayoutItem`, mark paid COMPLETED tasks ARCHIVED; CSV export; batch history. Pay Worker (only) posts a best-effort payment-credited embed in the worker's ticket (worker tag, amount + breakdown, IST time, screenshot-channel pointer). See `docs/PAYOUT_SYSTEM.md`.
9. **Referral commissions**: `/referral add` (admins) records inviter→invitee links; normal inviters get a one-time ₹100 bonus after the invitee completes 2 tasks; special inviters (hardcoded list of 3 Discord IDs) get ₹50 one-time bonus after 1 task + ₹10/comment, ₹20/post per task. **Multi-Level Referrals**: every referral below a special inviter anywhere up its invite chain gets `indirectSpecialInviterId` (resolved by walking the FULL ancestor chain, cycle-safe) — the normal inviter keeps their standard bonus and the upstream special inviter earns per-task commissions (`per_task_indirect`, ₹20/post ₹10/comment) on ALL descendant workers' tasks (no one-time bonus). **Invite auto-detection (auto-approve, LIVE 2026-09-10 at `13823d6`)**: Discord joins staged as `InviteDetection` rows (inviter via invite-use diff snapshot, invitee, invite code; invitee's first ticket linked on `channelCreate`) — rows with a known inviter auto-approve at join time (audited by `system`); unknown-inviter joins are skipped entirely (log + audit, no row). No manual queue anywhere — the dashboard Pending Invites section was removed (2026-09-10, code ready, NOT yet deployed). One-off sweep `scripts/approve-pending-detections.ts` (`--dry-run`) clears manual-era backlogs. Referral edit modal covers inviter/invitee **IDs** + names + ticket (inviter change re-derives special/normal type + indirect chain); pending rows are editable too (set the inviter on unknown rows before approving). Backfill `scripts/backfill-invite-detections.ts` (`--since`, `--dry-run`) stages historical joins with inviter unknown. Commission batches/CSV/history in the dashboard. See `docs/REFERRAL_SYSTEM.md`.
10. **Owner earnings**: daily/weekly net earnings (hardcoded revenue ₹250/post, ₹100/comment; worker cost ₹60/₹30) minus per-task/one-time commissions (including indirect special per-task commissions); PIN (default `7977` via `OWNER_PIN`) gates navigation from Settings but the API endpoints are unauthenticated. See `docs/FRONTEND.md`.
11. **Dashboard**: 14 routes — Dashboard, Tasks, TaskDetails, AcceptedTasks, Daily Outreach, Automation, Archives, PayoutLayout (`/payout/tasks` & `/payout/commissions`), Referrals (with Indirect referral badge), Analytics, Settings, OwnerEarnings, Login, NotFound. JWT auth via single dashboard account (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`). See `docs/FRONTEND.md`.
12. **Audit log**: `AuditLog` rows for task/payout/commission/referral/reminder/command/outreach events; no dashboard consumer since the Activity page was removed (2026-08-18) — `GET /api/v1/audit-logs` kept for debugging.
13. **Daily Worker Outreach**: per-ticket daily availability tracking. Manager selects tickets (persisted in `TicketOutreach`, survives day changes), `POST /api/v1/outreach/send` broadcasts the configurable daily message (`OutreachSettings`, default constant) to checked tickets only, **tagging each ticket's worker** (`{user}` placeholder → `<@workerId>`; no placeholder → mention prepended; unknown worker → untagged, never fails); any worker (non-bot/non-admin) message in a checked ticket after the send marks it Available (`messageCreate.ts` hook → `outreachService.onWorkerMessage`). Post/Comment columns show **counts** of tasks created today per channel (any status; `0` → cross, `>0` → green count) — assignment workflow unchanged. Daily cycle = IST day (resets at 00:00 IST: Available/Post/Comment go fresh, selection is remembered). See `docs/OUTREACH.md`.
14. **Ticket Onboarding (Welcome + Guide)**: bot listens to `channelCreate` — when a new ticket `TextChannel` (exactly one non-bot non-admin viewer) is created, it auto-sends `Hey, @user Can you please share your reddit profile link?` tagging the opener (2.5 s delay + 3 s retry; audit-log or member detection). Then on the opener's **first** message in that ticket (any content), it sends the onboarding guide with 3 clickable channel mentions (`<#1520466000477163550>`, `<#1520481331773968384>`, `<#1520620297399828571>`) — exactly once per `channelId` (persisted in `TicketOnboarding`: `welcomeSentAt`/`guideSentAt`), old tickets never get the guide. See `src/bot/events/channelCreate.ts`, `src/bot/events/messageCreate.ts:handleTicketGuide`, `src/config/constants.ts:47-48`, `src/database/repositories/onboarding.repository.ts`.
15. **Member Join Welcome**: bot listens to `guildMemberAdd` (immediate, every join, bots skipped) — sends in `#invites` (`1520616800063328437`) `hey @user please create your ticket in #verification` (`1520483343018496104`, clickable) then we can get started. See `src/bot/events/guildMemberAdd.ts`, `src/config/constants.ts:54`, `src/bot/index.ts` (`GuildMember` partial + `guildMemberAdd` listener).
16. **GoPartTime Auto-Accept foundation (NOT deployed, dry-run default)**: persistent-Chromium poller (Playwright, 7 scans/hour at :00 :10 :11 :20 :30 :40 :50 + jitter, Vercel-checkpoint backoff, accept inside page context with 3–8s human delay), eligible-gated iterative cycles (poll → count x → ping x workers `hey @user, should i send a post?` → 5-min window → accept min(eligible,confirmed) → re-poll), validator (Post-only, duplicate via `(source,externalTaskId)`, exact-match blocked list), AES-256-GCM session vault (`GOPARTTIME_SESSION_KEY`), worker guards (outreach-selected pool, 1 active post, 2/day IST cap, earliest-reply-first), API `/api/v1/automation/*` + dashboard `Automation` page (status/dry-run controls, blocked editor, session paste, cycle table). Real acceptance additionally gated by `GOPARTTIME_AUTO_ACCEPT=true`. Models: `BlockedSubreddit`, `AutomationSettings`, `GoPartTimeSession`, `AutomationCycle`, `AutomationContact`, `AutomationTaskLog`. See `docs/GOPARTTIME.md` §10 + `src/services/automation/`.
17. **Burst auto-accept (current)**: settle-once reporting (fixed countdown, retry till confirmed), blasts only :10–:16 IST, whole-page eligible count (post + readable + non-blocked; no history filter), frozen pools, non-expiring open-burst claims, reply-order pairing with move-on retry, fill deletes losers, next :10 supersedes. Watcher v1.1.9. `AutomationBurst` table live. Dashboard `/automation` panel (switches, watcher/claims, manual test + rehearse cards, blocked editor, cycles + accepted counts + blast drill-down with winners). See `docs/GOPARTTIME.md` §12–13.

---

## 6. Current System State

| Area | State |
|---|---|
| Firestore → PostgreSQL cutover | **Complete** (2026-07-26). Legacy: `firebase.json`, `firestore.indexes.json`, stale `.env.example` block, one stale comment in `src/index.ts:156`, `formatFirestoreDate` helper in `dashboard/src/pages/Payout.tsx` |
| Discord bot + commands | Implemented (12 commands, guild-scoped) |
| Reminder/insight engine | Implemented (20h/70h, retries, overdue pings) |
| Insight image storage | Implemented (local disk, 60h TTL); `deleteTaskDir()` helper unused |
| GoPartTime integration | Implemented (userscript + backend + delivery + submission + activation + reassign/retry + Submit View screenshot automation + preview + mobile-disable — userscript v1.4.0 + `GET /goparttime/insight/:externalTaskId`, **deployed 2026-08-17 at `e0112f2`**) |
| Payout system | Implemented (weekly IST window, batches, CSV, restore-unpaid) |
| Referral commissions | Implemented (normal/special, one-time + per-task, batches, CSV) |
| Two-level referral (indirect special commissions) | **Deployed 2026-08-13** (`a558f1d`); **multi-level chain-walk fix DEPLOYED 2026-08-21** (`72e264c`, app-only rebuild) + backfill run live: 42 normal-inviter referrals checked, 9 linked (incl. bavish.exe + batman_441 → `1202294567706316911`), verified in DB |
| Auto Reddit-deletion detection | **Removed/deprecated** (manual `cancelledReason` override instead); `check-reddit.ts` is dead code |
| Owner earnings | Implemented (daily, 30-day history, weekly) |
| Dashboard theme picker | **Stub** (UI-only, does nothing) |
| PWA | Implemented (manifest, sw.js network-first API fallback) |
| `dist/` (root) | **Stale build** (gitignored, regenerated by Docker); do not use |
| Generated Prisma client (`src/generated/prisma`) | **Stale locally** (missing `ACCEPTED` + 5 AuditAction enum values vs schema); regenerated at Docker build |
| Cron | **None anywhere.** All timing is BullMQ delayed jobs + `setInterval` |

---

## 7. Important Data Flows

### GoPartTime → task creation (see docs/GOPARTTIME.md)
```
goPartTime.net → userscript extracts {taskId,type,ticket,title,subreddit,flair,payment,deadline,contentHtml,images,postLink,sourceUrl}
→ POST /api/v1/goparttime/assign (Bearer GOPARTTIME_API_KEY)
→ zod validate → dedupe on (source, externalTaskId) → resolve ticket channel → one-task-per-ticket guard
→ detect single non-admin worker in channel → create Task (status ACCEPTED, assignmentStatus PENDING)
→ deliver metadata/content/images/instruction messages into the ticket → assignmentStatus SENT
→ worker replies to instruction message with Reddit URL (exactly 1, validated)
→ recordSubmission (+ automatic format check for POSTs → bot verdict reply; verdict in `formatCheckStatus/Detail/CheckedAt`)
→ manager reviews format badge/diff (Recheck if needed) → clicks Done (POST /tasks/:id/done) → ACCEPTED→PENDING + reminders scheduled
```

### GoPartTime view-data submission (Submit View, userscript v1.4.0; see docs/BROWSER_EXTENSION.md)
```
Manager opens a task's View dialog on goparttime.net (view data at 20h / second view data at 70h)
→ click card "Submit View" button → userscript tracks {card, taskId, step} (disabled countdown button also tracked)
→ click "📊 Submit View" floating button → GET /api/v1/goparttime/insight/:taskId?step=1|2 (read-only, extension key)
→ backend: task lookup (source='goparttime', externalTaskId) → reminders → resolveInsightReminder (step1=20h, step2=70h)
→ userscript downloads Reminder.insightImageUrl as Blob → opens/attaches via DataTransfer to the dialog file input
→ manager reads the view count, types it, clicks Submit, verifies success manually (script never submits or confirms)
```

### Task → reminder → completion → payout
```
Task created (PENDING) → reminders scheduled (BullMQ, dueAt = createdAt + 20h/70h)
→ worker sends reminder embed to ticket; status advance → worker replies screenshot
→ insight stored + reminder completed → status advance (Comment completes @ INSIGHT_20_RECEIVED, Post @ INSIGHT_70_RECEIVED)
→ COMPLETED → weekly payout window (IST Sun–Sat) → dashboard Pay Worker / Pay All
→ PayoutBatch + PayoutItem; paid COMPLETED tasks → ARCHIVED → weekly Sunday archive
```

### Owner earnings (see docs/FRONTEND.md + docs/REFERRAL_SYSTEM.md)
```
tasks created on a given IST day (COMPLETED/ARCHIVED/CANCELLED-deleted)
→ ₹250/post, ₹100/comment revenue − ₹60/₹30 worker cost − special per-task commissions − one-time bonuses (below threshold) → net
```

---

## 8. Database (summary — details in docs/DATABASE.md)

- PostgreSQL via Prisma 7 (`PrismaPg` driver adapter), `DATABASE_URL` env. Tables: `Task`, `Reminder`, `AuditLog`, `PayoutBatch`, `PayoutItem`, `Referral`, `CommissionBatch`, `CommissionItem`, `PayoutSettings`, `CommissionRates`, `TicketOutreach`, `OutreachSettings`, `TicketOnboarding`, `InviteDetection` (14 models, 7 enums).
- FKs: Reminder→Task (cascade delete); AuditLog→Task (set null); PayoutItem→Batch/Task (restrict); CommissionItem→Batch/Referral/SourceTask (set-null for task).
- Unique constraints: Task `(source, externalTaskId)` (GoPartTime dedupe). 26 indexes.
- Migrations: **single hand-maintained, idempotent** `prisma/migrations/migration.sql`, applied manually (NOT `prisma migrate deploy`). Keep SQL ↔ schema.prisma in sync and `IF NOT EXISTS`-safe. **Schema-only, no data statements** — a one-time data backfill (UPDATE/DELETE) that lived there was removed 2026-08-12 after a re-run corrupted 48 activated tasks (recovery tool: `scripts/restore-accepted.ts`; see DEPLOYMENT.md §4).
- Firestore: **inactive/legacy** — `firebase.json` + `firestore.indexes.json` remain but nothing in `src/` uses Firebase.

---

## 9. Deployment (summary — details in docs/DEPLOYMENT.md)

- Docker Compose on a host at IP `161.118.164.85`, duckdns domain **statbot.duckdns.org** (TLS via LetsEncrypt, webroot ACME).
- Services: `app` (backend, port 3000 internal), `redis` (7-alpine, maxmemory 128mb), `dashboard` (nginx, 80/443 public, proxies `/api/` → `app:3000`).
- Hosting provider **UNKNOWN** (no references in repo; plan.md mentions "Ubuntu VPS" + PM2 as the original non-Docker option; no Oracle references exist despite prior assumptions).
- PostgreSQL runs outside compose (`host.docker.internal` via `host-gateway`), credentials from server `.env`.
- Backend build: `npm ci → npx prisma generate → npm run build` (Dockerfile). Dashboard: `tsc && vite build` → nginx.
- PM2 alternative path: `ecosystem.config.js` (`dist/index.js`, NODE_ENV=production).

---

## 10. Known Issues (verified — details in docs/KNOWN_ISSUES.md)

1. **Auth gap**: `/api/v1/owner/daily-earnings`, `/history`, `/weekly-earnings` are unauthenticated; PIN default `7977` hardcoded in `env.ts`.
2. **`query-tasks.ts`/`query-tasks.js`** at repo root embed a real Postgres password (untracked debug scripts).
3. **`ssh-key-2026-07-19.key`** (private SSH key) sits in the repo root (gitignored).
4. **Stale generated Prisma client** locally (enum mismatches) — regenerate with `npx prisma generate`.
5. **Stale root `dist/`** build (missing newer modules like `html-to-discord`), gitignored.
6. **`.env.example` stale**: still lists removed `FIREBASE_*` vars, missing required `DATABASE_URL`.
7. Payout week windows rely on **post-completion times derived from reminder `.completedAt`**, not stored completion times; edge cases exist (see docs/PAYOUT_SYSTEM.md).
8. Dashboard: Theme picker stub; `w-4.5` invalid Tailwind class; `tailwindcss-animate` classes inert; OwnerEarnings route JWT-only (PIN not enforced server-side per request).
9. Rate limit (100 req/15 min/IP) applies to the whole `/api/` prefix including health/login.
10. `insightStorageService.deleteTaskDir`, `check-reddit.ts` (`isPostDeleted`), `DELETED_DETECTION_THRESHOLD_MS`, `generateCommissionBatchId` — dead code.
11. Duplicate userscript copies (`scripts/` and `dashboard/public/`) must stay in sync.
12. `GET /api/v1/tasks` has a default `limit` of 1000 with no cap — the dashboard fetches everything and paginates client-side (scales poorly).
13. **`npm run lint` is broken repo-wide**: ESLint 9 (flat-config-only) finds no `eslint.config.js` — the repo has never shipped one (verified 2026-08-17). Fix = add a flat config; not yet done.

---

## 11. Pending Work (details in docs/ROADMAP.md)

- No TODO/FIXME comments exist in `src/` or `dashboard/src/` (verified by grep).
- `sending.md` Phase-23 acceptance checklists are all unchecked (spec, not tracker).
- `plan.md` outlines future ideas (monitoring, notifications, backup, roles) with no implementation.
- Obvious unfinished items: owner-earnings auth, theme picker, one-task-per-ticket Post-70H follow-up handling for comments? (not implemented — `COMMENT` only has a 20h reminder).

---

## 12. Important Decisions (details in docs/DECISIONS.md)

| Decision | Reason |
|---|---|
| PostgreSQL over Firestore (Prisma v7 + pg adapter) | Queries/aggregates/transactions, ownership, cost |
| Single hand-maintained idempotent `migration.sql` | Simple, manual control; NOT `prisma migrate deploy` |
| No cron; BullMQ delayed jobs + setInterval | Deadline-based reminders with restart recovery |
| Reminder deadlines absolute from `createdAt` | Stable across retries/rehydration |
| Guild-scoped commands + per-command permission checks | Simpler than central guard; interactive confirm for `/delete` |
| Local disk for insight images with 60h TTL | Simple; served unauthenticated (accepted risk) |
| Two-level referral added then reverted (same day 2026-08-09) | Reverted — risk/complexity (see DECISIONS.md) |
| Single dashboard account (env username/password) + JWT | Small admin surface, no user table; owner PIN separate |
| GoPartTime ingest status `ACCEPTED` + explicit activation | Review/dedup before entering the reminder pipeline |

---

## 13. Recent Changes

- **2026-09-22**: **REVERTED v1.5.0, v1.4.9 restored live** (`161.118.164.85`, git HEAD `34d634d` — history-preserving revert of `5d8ce3e`+`4738baa`; full rebuild; backup `rtm-backup-20260922-revert150.tar.gz`; unused `AutomationTaskLog.media` column stays in live DB, harmless; pushed to GitHub; verified: health healthy, boot "All systems online!", `mediaBadge` 0 refs live, `blockableSubs` intact, served v1.4.9 hash-matches; locally typecheck + build clean, 331/331 jest). Manager must downgrade script #2 to v1.4.9 + reload tabs.
- **2026-09-22**: **DEPLOYED owner earnings 30-day history** (`161.118.164.85`, git HEAD `2c95baa`; backup `rtm-backup-20260922-30day.tar.gz`; dashboard-only rebuild; no DB migration; pushed to GitHub; verified: health healthy, dashboard 200, `GET /owner/daily-earnings/history?days=30` returns 30 rows, served bundle `index-DaIrKVRZ.js` contains "Last 30 Days"; locally dashboard `tsc --noEmit` clean). Backend already supported `days` clamped 1–30; frontend now requests 30.
- **2026-09-21**: **DEPLOYED /task worker auto-detect fix** (`161.118.164.85`, git HEAD `c282411`; backup `rtm-backup-taskfix-20260921-183249.tar.gz`; app-only rebuild; no DB migration; no slash-command redeploy — no signatures changed; NOT pushed to GitHub; verified: health healthy, boot "All systems online!", `getAllAdminIds` in live `dist/bot/commands/task.js`, dashboard 200; locally typecheck + build clean, 331/331 jest). Root cause: `/task` excluded only the invoking admin (`m.id !== interaction.user.id`) while admins bypass channel overwrites and appear in every ticket — always tripping the "multiple users" error. Now excludes all staff (admins/managers/moderators) like every other detection site; error names the conflicting users.
- **2026-09-20**: **DEPLOYED DM Block-for-any-sub** (`161.118.164.85`, git HEAD `bb22e21`; backup `rtm-backup-20260920-blockbtn.tar.gz`; app-only rebuild; no DB migration; pushed to GitHub; verified: health healthy, boot "All systems online!", `blockableSubs` live; locally typecheck + build clean, 331/331 jest). No script update needed.
- **2026-09-20**: **DEPLOYED pay-worker ticket payment notice** (`161.118.164.85`, git HEAD `4642914`; backup `rtm-backup-20260920-payoutnotice.tar.gz`; app-only rebuild; no DB migration; pushed to GitHub; verified: health healthy, boot "All systems online!", new code in live `dist/`, dashboard 200; locally typecheck + build clean, 328/328 jest). Pay Worker confirm posts an aesthetic embed in the worker's ticket tagging the worker (amount + breakdown, batch # + week label, IST time, screenshot pointer). See `docs/PAYOUT_SYSTEM.md` §4a.
- **2026-09-16**: **DEPLOYED faster auto report** (`161.118.164.85`, git HEAD `149e892`; dashboard-only rebuild; backup `rtm-backup-20260920-v149fastreport.tar.gz`; server untouched; pushed to GitHub; verified: served v1.4.9 hash-matches; locally identical copies, ASCII, `node --check`). Early-window countdown 45s → 20s; DM ~xx:10:40-xx:11. Manager must update script #2 to v1.4.9 + reload tabs.
- **2026-09-16**: **DEPLOYED blast-button colon fix** (`161.118.164.85`, git HEAD `1c296e6`; backup `rtm-backup-20260920-v150blastcolon.tar.gz`; full rebuild; no DB migration; pushed to GitHub; verified: health healthy, boot "All systems online!", `isValidCycleId` live; locally typecheck + build clean, 323/323 jest). All `blast:*` taps since feature ship died silent on the HH:MM colon; now parse + unreadable ids log/answer loudly. Existing digest buttons work with no script update.
- **2026-09-16**: **DEPLOYED DM-text `scan` trigger** (`161.118.164.85`, git HEAD `e5225e2`; backup `rtm-backup-20260920-v149dmtext.tar.gz`; full rebuild; no DB migration; pushed to GitHub; verified: health healthy, boot "All systems online!", `handleDirectMessage` live; stale global `/scan` cleared; locally typecheck + build clean, 322/322 jest). No script update needed (watcher stays v1.4.8).
- **2026-09-16**: **DEPLOYED on-demand `/scan`** (`161.118.164.85`, git HEAD `58d172c`; backup `rtm-backup-20260919-v148ondemand.tar.gz`; full rebuild; no DB migration; pushed to GitHub; verified: health healthy, boot "All systems online!", served v1.4.8 hash-matches, `sendManualDigest` + `scanNow` live; `deploy-commands`: 14 guild + global `/scan`; locally typecheck + build clean, 319/319 jest). Manager must update script #2 to v1.4.8 + reload tabs (global /scan up to ~1h to appear in DMs).
- **2026-09-16**: **DEPLOYED auditable report POST** (`161.118.164.85`, git HEAD `81759cc`; backup `rtm-backup-20260919-v147auditpost.tar.gz`; full rebuild; no DB migration; pushed to GitHub; verified: health healthy, boot "All systems online!", served v1.4.7 hash-matches, telemetry live; locally typecheck + build clean, 313/313 jest). Manager must update script #2 to v1.4.7 + reload tabs.

- **2026-09-16**: **DEPLOYED empty-DM fix + scan telemetry** (`161.118.164.85`, git HEAD `e9dc07a`; backup `rtm-backup-20260919-v146telemetry.tar.gz`; full rebuild; no DB migration; pushed to GitHub; verified: health healthy, boot "All systems online!", served v1.4.6 hash-matches, both fixes live; locally typecheck + build clean, 313/313 jest). Manager must update script #2 to v1.4.6 + reload tabs.

- **2026-09-16**: **DEPLOYED DM-every-hour** (`161.118.164.85`, git HEAD `1459441`; backup `rtm-backup-20260919-v145dmhour.tar.gz`; full rebuild; no DB migration; pushed to GitHub; verified: health healthy, boot "All systems online!", served v1.4.5 hash-matches, trigger code live; locally typecheck + build clean, 313/313 jest). Manager must update script #2 to v1.4.5 + reload tabs.

- **2026-09-16**: **DEPLOYED digest all-scanned view + version radar** (`161.118.164.85`, git HEAD `086f0c8`; backup `rtm-backup-20260919-dmall.tar.gz`; app-only rebuild; no DB migration; pushed to GitHub; verified: health healthy, boot "All systems online!", new code in live `dist/`; locally typecheck + build clean, 312/312 jest).

- **2026-09-16**: **DEPLOYED watcher v1.4.4 hourly :10 refresh** (`161.118.164.85`, git HEAD `e125869`; backup `rtm-backup-20260917-watcher144.tar.gz`; dashboard-only rebuild; no DB migration; pushed to GitHub; verified: dashboard 200, served v1.4.4 hash-matches local). Manager must update Tampermonkey script #2 to v1.4.4.

- **2026-09-16**: **DEPLOYED digest all-posts view + race guards** (`161.118.164.85`, git HEAD `3f0d178`; backup `rtm-backup-20260917-digestall.tar.gz`; app-only rebuild; no DB migration; pushed to GitHub; verified: health healthy, boot "All systems online!", new code in live `dist/`; locally typecheck + build clean, 308/308 jest).

- **2026-09-16**: **Blast-approval race guards implemented (NOT yet deployed)** — duplicate-DM and double-tap release guards. Verified: typecheck + build clean, 307/307 jest. Will ride the next app deploy.

- **2026-09-16**: **DEPLOYED watcher v1.4.3 flap-proof countdown** (`161.118.164.85`, git HEAD `ad8c345`; backup `rtm-backup-20260917-watcher143.tar.gz`; dashboard-only rebuild; no DB migration; pushed to GitHub; verified: dashboard 200, served v1.4.3 hash-matches local). Manager must update Tampermonkey script #2 to v1.4.3.

- **2026-09-16**: **DEPLOYED watcher v1.4.2 cache-bypass fetch** (`161.118.164.85`, git HEAD `d550a1c`; backup `rtm-backup-20260917-watcher142.tar.gz`; dashboard-only rebuild; no DB migration; pushed to GitHub; verified: dashboard 200, served v1.4.2 hash-matches local). Manager must update Tampermonkey script #2 to v1.4.2.

- **2026-09-16**: **DEPLOYED watcher v1.4.1 fresh-list guarantee** (`161.118.164.85`, git HEAD `d741bf9`; backup `rtm-backup-20260917-watcher141.tar.gz`; dashboard-only rebuild; no DB migration; pushed to GitHub; verified: dashboard 200, served v1.4.1 hash-matches local). Manager must update Tampermonkey script #2 to v1.4.1.

- **2026-09-16**: **DEPLOYED phone-approval blast DMs** (`161.118.164.85`, git HEAD `43be8c4` + delivery fix `efe1989`; backups `rtm-backup-20260917-blastdm.tar.gz` + `rtm-backup-20260917-dmfix.tar.gz`; no DB migration; pushed to GitHub; verified: health healthy, boot "All systems online!", new code in live `dist/`, test DM delivered to the manager server-confirmed; locally typecheck + build clean, 307/307 jest). Settled reports DM the manager Blast/Hold/Block buttons — no Remote Desktop needed. Next: live DM test on a real drop.

- **2026-09-16**: **DEPLOYED accept-speed phases 0–2** (`161.118.164.85`, git HEAD `196e708`; backup `rtm-backup-20260916-speedphases.tar.gz`; migration excerpt applied live: `AutomationClaim.leasedBy/leasedAt`; pushed to GitHub; verified: health healthy, boot "All systems online!", dashboard 200, watcher v1.4.0 served, lease + timings code in live `dist/`; locally typecheck + build clean, 293/293 jest). Watcher v1.4.0: step timings, 2s burst-open poll, back-nav, per-tab leasing. Manager must update Tampermonkey script #2 to v1.4.0 + open 2 `/tasks` tabs. Next: live batch confirming ≤5s/task, ≤50s/10, zero double-accepts.

- **2026-09-16**: **Phase-1 accept speed implemented (deployed with phases 0–2 above in v1.4.0)** — 2–3.5s claim poll while any burst is open, back-nav, settle skip, caps. Included in the `196e708` deploy; Tampermonkey v1.4.0 covers it.

- **2026-09-16**: **Phase-0 claim step timings implemented (deployed with phases 0–2 above in v1.4.0)** — per-claim timings in verdicts + `Claim timings` server log. Included in the `196e708` deploy.

- **2026-09-14**: **DEPLOYED send script v1.4.4 auto Submit View** (`161.118.164.85`) at commit `e4927e8` (dashboard-only rebuild; backup `rtm-backup-send144.tar.gz`; no DB migration; pushed to GitHub; host + local bundles/scratch cleaned). Native "Submit View" click now auto-runs fetch + attach + preview (floating 📊 stays as fallback). Verified live: `/goparttime-send.user.js` 200 serving v1.4.4, health healthy, dashboard 200. Manager must update Tampermonkey to v1.4.4.

- **2026-09-13**: **DEPLOYED blast fill-safe sending** (`161.118.164.85`) at commit `c35d883` (app + dashboard rebuild; backup `rtm-backup-blastfillsafe.tar.gz`; no DB migration; no slash-command redeploy; pushed to GitHub; host + local bundles/scratch cleaned). Root cause of stranded messages: fast first reply filled the blast mid-send while the loop kept messaging (ticket-0155 round: 43 sent, 12 cleaned, 30 stranded) — `sendBlastMessages` now stops once the blast closes + post-send sweeps non-winner messages on filled blasts. Verified live: health healthy (DB+Redis), boot "All systems online!", dashboard 200, fix strings in live container `dist/`. Locally: typecheck + build clean, 277/277 jest.

- **2026-09-13**: **DEPLOYED watcher v1.2.2 Blast Now layout fix** (`161.118.164.85`) at commit `f14cffa` (dashboard-only rebuild; backup `rtm-backup-watcher122.tar.gz`; no DB migration; pushed to GitHub; host + local bundles/scratch cleaned). Blast Now was at bottom:54px overlapping Send Task + Submit View — now parks above both (124px desktop, 144px narrow). Verified live: health healthy, `/goparttime-auto.user.js` 200 serving v1.2.2. Manager must update Tampermonkey to v1.2.2.

- **2026-09-13**: **DEPLOYED watcher v1.2.1 force-return to /tasks** (`161.118.164.85`) at commit `4434644` (dashboard-only rebuild; backup `rtm-backup--watcher121.tar.gz`; no DB migration; pushed to GitHub; host + local bundles/scratch cleaned). GoPartTime auto-navigates the tab to `/my-tasks/todo` on every accept — after each claim verdict (success or failure) the script now navigates the same tab back to `/tasks` (pathname-guarded `returnToTasks()`, after `reportClaim`). Verified live: health healthy (DB+Redis), dashboard 200, `/goparttime-auto.user.js` 200 serving v1.2.1 with the fix. Manager must update the Tampermonkey script to v1.2.1 in the browser.

- **2026-09-13**: **DEPLOYED Reddit session vault + share-link fix** (`161.118.164.85`) at commits `8b48f85` + `1afeba7` + `e4d6f95` (app + dashboard rebuilds; backups `rtm-backup-20260913-redditsess.tar.gz` + `rtm-backup-20260913-sharefix.tar.gz`; migration excerpt applied live: `RedditSession` table + `REDDIT_SESSION_UPDATED` enum; spare-account cookie pasted to vault by manager; pushed to GitHub; no slash-command redeploy; all scratch cleaned). Root cause fixed: Reddit killed anonymous `.json` (www 403 any UA/IP, old login-gate/VPS-block — the server check NEVER succeeded live; verified by local + VPS probes). Server now fetches authed with a spare account's login cookie (AES vault, self-service paste via Settings/extension endpoint; `NO_SESSION`/`SESSION_EXPIRED` statuses + bot replies; `GET /tasks/:id/live-reddit` powers the diff modal server-first). Follow-up fixes live: mobile `/s/` share links resolve to canonical permalinks first (workers submit share links — first live recheck returned HTML), and the redirect chain (not the landing HTML status) is the source of truth. Verified live: health healthy (DB+Redis), boot "All systems online!", dashboard 200 (`index-B9ciLHv5.js`, hash matches local build), new routes in live `dist/`, endpoints 401-gated, live recheck on real worker share link (task 1009242) → **MATCH 6/6, title OK** — identical to the session-script verdict. Locally: typecheck 0 errors, builds clean, 277/277 jest (23 suites).

- **2026-09-13**: **DEPLOYED session format pre-check** (`161.118.164.85`) at commit `004fea7` (app + dashboard rebuild; backup `rtm-backup-20260913-sessionfmt.tar.gz`; pushed to GitHub; no DB migration, no slash-command redeploy; host + local bundles/scratch cleaned). Tampermonkey script `reddit-format-check.user.js` v1.0.0 (reddit.com, manager-session live JSON, no VPS exposure) + read-only `GET /api/v1/goparttime/expected/:externalTaskId` (exact Discord-delivered text), local verbatim-port compare, display-only. Verified live: health healthy (DB+Redis), boot "All systems online!", dashboard 200, `/reddit-format-check.user.js` v1.0.0 served 200, `expected` route in live `dist/`, endpoint 401-without-key. Locally: `node --check` clean, 3/3 comparator parity, typecheck + build clean, 258/258 jest (21 suites).

- **2026-09-12**: **DEPLOYED Reddit format auto-check** (`161.118.164.85`) at commit `4d8cd87` (app + dashboard rebuild; backup `rtm-backup-20260912-formatchk.tar.gz`; migration excerpt applied live: `formatCheckStatus/Detail/CheckedAt`; no slash-command redeploy — no command files changed; pushed to GitHub; host + local bundles/scratch cleaned). Worker submissions auto-verified server-side (live post title/selftext vs delivered content, normalized text + strict paragraphs); bot replies MATCH/MISMATCH instantly; verdict persisted; Accepted Tasks Format badges + side-by-side diff modal (browser-direct live fetch, server Recheck `POST /tasks/:id/recheck-format`); COMMENTs skipped. Verified live: health healthy (DB+Redis), boot "All systems online!", dashboard 200 with served bundle `index-D8JG9sSP.js` (hash matches local build, `recheck-format` present), `formatSubmissionReply` + `recheck-format` in live `dist/`, 9/9 new jest (`reddit-format.test.ts`), backend typecheck 107 before = 107 after (all pre-existing stale-client). Note: repo-root `ssh-key-2026-07-19.key` is unparseable (`ssh-keygen -y` exit 255); deploy used the owner-pasted key via temp file (deleted after).

- **2026-09-12**: **DEPLOYED burst-round survival** (`161.118.164.85`) at commit `407a9a7` (app + dashboard rebuild; pushed to GitHub; no DB migration; host + local bundles/scratch cleaned). Diagnosed dead round: early replies arrived before the burst pool existed (slots burned, no claims) + orphan sweep executed winners' claims 40s after fill-close; refresh was incidental. Fixed pool-before-send + sweep spares fill-closed winners. Verified: health healthy, boot clean, 249/249 jest (20 suites).

- **2026-09-12**: **DEPLOYED auto-burst pause** (`161.118.164.85`) at commit `7591625` (app + dashboard rebuild; pushed to GitHub; no DB migration; host + local bundles/scratch cleaned). Automatic :10 bursts off — rounds start only from manual Blast Now; auto-reports validate + log only. Verified: health healthy, boot clean, 249/249 jest (20 suites).

- **2026-09-12**: **DEPLOYED serial winner serving** (`161.118.164.85`) at commit `c503367` (app + dashboard rebuild; pushed to GitHub; no DB migration; host + local bundles/scratch cleaned). Replies served strictly first-reply-first via FIFO; one win per worker per blast; busy/cap/duplicate filtered before slot use; one-task-per-burst backstop at claim gate. Verified: health healthy, boot clean, 249/249 jest (20 suites).

- **2026-09-11**: **DEPLOYED rate-limit relief** (`161.118.164.85`) at commit `ac7b4bf` (app + dashboard rebuild; pushed to GitHub; no DB migration; host + local bundles/scratch cleaned). One home IP tripped the 100/15min cap (429s blanked all data views); now 300 + slower automation polls. Verified: health healthy, boot clean.

- **2026-09-11**: **DEPLOYED Blast Now + no-blast reasons** (`161.118.164.85`) at commit `a96807f` (app + dashboard rebuild; pushed to GitHub; no DB migration; host + local bundles/scratch cleaned). On-demand button v1.2.0 served; force path; reasons surfaced. Verified: health healthy, boot clean, 247/247 jest (19 suites).

- **2026-09-11**: **DEPLOYED monitor anti-wedge** (`161.118.164.85`) at commit `4a44bfc` (dashboard-only rebuild; pushed to GitHub; host + local bundles/scratch cleaned). Fixed frozen-pill wedge (stalled fetch, stuck tick). Watcher v1.1.10 served. Verified: node --check, ASCII/hash/harness clean.

- **2026-09-11**: **DEPLOYED 17:10 hardening** (`161.118.164.85`) at commit `05c0cfa` (app + dashboard rebuild; pushed to GitHub; no DB migration; host + local bundles/scratch cleaned). :10–:16 window, adaptive countdown, limiter exemptions. Watcher v1.1.9 served. Verified: health healthy, boot clean, 247/247 jest.

- **2026-09-11**: **DEPLOYED deadlock-proof reporting + merge grace** (`161.118.164.85`) at commit `e2b7e76` (app + dashboard rebuild; pushed to GitHub; no DB migration; host + local bundles/scratch cleaned). Fixed 45s report, hourly retry, 5-min append grace. Watcher v1.1.8 served. Verified: health healthy, boot clean, 247/247 jest (19 suites).

- **2026-09-11**: **DEPLOYED listed-takeable + move-on retry** (`161.118.164.85`) at commit `9bcf135` (app + dashboard rebuild; pushed to GitHub; no DB migration; host + local bundles/scratch cleaned). Listed+available always counts; failed claims retry same worker; FAILED never re-queued. Watcher v1.1.7 served. Verified: health healthy, boot clean, 245/245 jest (19 suites).

- **2026-09-11**: **DEPLOYED settle-deadlock fix** (`161.118.164.85`) at commit `c0bedbf` (dashboard-only rebuild; pushed to GitHub; host + local bundles/scratch cleaned). Fixes silent 11:10/12:10 rounds (churning drops never settled). Watcher v1.1.6 served. Verified: node --check, ASCII/hash/harness clean.

- **2026-09-11**: **DEPLOYED whole-page count + winner visibility** (`161.118.164.85`) at commit `832f138` (app + dashboard rebuild; pushed to GitHub; no DB migration; host + local bundles/scratch cleaned). All eligible listed count; dead code pruned; winners visible. Verified: health healthy, boot clean, 245/245 jest (19 suites).

- **2026-09-11**: **DEPLOYED true freeze semantics** (`161.118.164.85`) at commit `b26942a` (app + dashboard rebuild; pushed to GitHub; no DB migration; host + local bundles/scratch cleaned). Disabled/dry-run now blocks blasts, burst writes, and new claims. Verified: health healthy, boot clean, 250/250 jest.

- **2026-09-11**: **DEPLOYED exact-:10 contract** (`161.118.164.85`) at commit `67ac39d` (app + dashboard rebuild; pushed to GitHub; no DB migration; host + local bundles/scratch cleaned). Settle-once; :10–:15-only blasts; freshness + STALE; frozen pools; non-expiring claims; reply-order delivery. Watcher v1.1.5 served. Verified: health healthy, boot clean, 250/250 jest.

- **2026-09-11**: **DEPLOYED subreddit reader fix + newest-first** (`161.118.164.85`) at commit `b811592` (app + dashboard rebuild; pushed to GitHub; no DB migration; host + local bundles/scratch cleaned). Windowed association (neighbor-safe); drawer abort on mismatch; newest-first everywhere. Watcher v1.1.4 served. Verified: health healthy, boot clean, 249/249 jest.

- **2026-09-11**: **DEPLOYED blocked enforcement + claim throughput** (`161.118.164.85`) at commit `fd0f86d` (app + dashboard rebuild; pushed to GitHub; migration excerpt applied: `taskDetails`; no slash-command redeploy; host + local bundles/scratch cleaned). Fail-closed null-subreddit rejection; pooled subreddits; 10-min TTL; orphan sweep; late verdicts. Watcher v1.1.3 served. Verified: health healthy, boot clean, 245/245 jest.

- **2026-09-11**: **DEPLOYED one-blast-per-hour anti-spam** (`161.118.164.85`) at commit `e50d2f6` (app + dashboard rebuild; pushed to GitHub; no DB migration — schema unchanged; no slash-command redeploy; host + local bundles/scratch cleaned). One message per worker per hour; later reports merge silently; watcher v1.1.2 served. Verified: health healthy, boot "All systems online!", merge code in live `dist/`, 242/242 jest.

- **2026-09-11**: **DEPLOYED burst-only everywhere + automation panel** (`161.118.164.85`) at commit `5b6e883` (app + dashboard rebuild; backup `rtm-backup-20260910-203727-pre-panel.tar.gz`; pushed to GitHub; no DB migration — schema unchanged; no slash-command redeploy; host + local bundles/scratch cleaned). Verified live: health healthy (DB+Redis), boot "All systems online!", `/automation` 200 with served bundle `index-Br9Nq6Xz.js` (hash matches local build), `createBurstFlow` in live queue `dist/`, typecheck + both builds clean, 239/239 jest. Next: rehearse one post from the panel, then dry-run a drop.

- **2026-09-10**: **DEPLOYED Pending Invites removal** (`161.118.164.85`) at commit `bcab738` (app + dashboard rebuild; backup `rtm-backup-20260910-bcab738.tar.gz`; no DB migration — schema unchanged; no slash-command redeploy; pushed to GitHub; host + local bundles/scratch cleaned). Verified live: health healthy (DB+Redis), boot "All systems online!", dashboard 200, `Pending Invites` absent from the served JS bundle, unknown-inviter skip in live `dist/`, 232/232 jest, backend + dashboard builds clean.

- **2026-09-10**: **DEPLOYED invite auto-approve** (`161.118.164.85`) at commit `13823d6` (app-only rebuild; backup `rtm-backup-20260910-13823d6.tar.gz`; no DB migration — schema unchanged; dashboard untouched; no slash-command redeploy; pushed to GitHub; host + local bundles/scratch cleaned). Backlog sweep (`scripts/approve-pending-detections.ts`, host-side `prisma generate` first) dry-run found **0 pending rows** — no live approval run needed. Verified live: health healthy (DB+Redis), boot "All systems online!", `AUTO_APPROVE_BY` in `dist/`, 232/232 jest, typecheck + build clean.

- **2026-09-10**: **DEPLOYED /mystats week-only + /myinvites ticket-mention + capped progress** (`161.118.164.85`) at commit `126a05a` (app-only rebuild; backup `rtm-backup-20260910-126a05a.tar.gz`; no DB migration — schema unchanged; dashboard untouched; no slash-command redeploy — no command signatures changed; pushed to GitHub; host + local bundles cleaned). `/mystats` card drops the All Time section (This Week only); `/myinvites` per-invitee ticket renders as a clickable `#ticket-name` channel mention and tasks cap at the threshold (2/2 stays 2/2 normal, 1/1 special). Verified live: health healthy (DB+Redis), boot "All systems online!", compiled `formatInviteTicket` + `Math.min(status.taskCount` in `dist/`, zero `All Time` in embeds, 230/230 jest, typecheck + build clean.

- **2026-09-10**: **DEPLOYED moderator exclusion** (`161.118.164.85`) at commit `dd95aeb` (app rebuild; pushed to GitHub). `MODERATOR_USER_IDS` env + `isModerator()`; included in `getAllAdminIds()` so every worker-detection site ignores them; no slash-command access. Verified live, 224/224 jest.

- **2026-09-10**: **DEPLOYED Outreach green burst highlight** (`161.118.164.85`) at commit `2d10aa1` (app + dashboard rebuild; pushed to GitHub). Burst repliers render green + sort to top; reset on next burst. Verified: health healthy, 221/221 jest.

- **2026-09-09**: **DEPLOYED Outreach Blast** (`161.118.164.85`) at commit `d3153f3` (app + dashboard rebuild; pushed to GitHub; backup `rtm-backup-20260909-pre-d3153f3.tar.gz`). Send asks posts-available `n`; first-n repliers win and the message is deleted from all other tickets; 2-post/day IST cap at send + reply; repeatable anytime. Verified: health healthy, tables exist, 221/221 jest.

- **2026-09-09**: **DEPLOYED push-visibility fix + removed Automation dashboard page** (`161.118.164.85`) at commit `1dee1c1` (full rebuild; backup `rtm-backup-20260909-pre-1dee1c1.tar.gz`). Companion reports push outcome (NEEDS_PUSH tracked), `/assign` rate-limit exempt, no double bookkeeping; watcher v1.0.9. Verified live: health healthy, served script v1.0.9, 217/217 jest.
- **2026-09-08**: **GoPartTime in-page drawer acceptance fix** (`goparttime-auto.user.js` v1.0.8, synced to `dashboard/public/`). Uses the genuine two-step drawer flow on `/tasks`: opens the modal drawer (`role="dialog"`) by clicking "Accept Task" on the candidate card, extracts full task details while open (`Task ID`, `Subreddit`, `Title`, `Content`, `Flair`, `Deadline`, `Payment`), clicks `"Confirm acceptance"` to invoke GoPartTime's native Server Action, intercepts the server response / detects drawer closing, and pushes the extracted task details to the Discord ticket (`POST /api/v1/goparttime/assign`). Eliminates the broken `findNextAction()` regex and card text matching.
- **2026-09-08**: **DEPLOYED hybrid companion flow** (`161.118.164.85`) at commit `47b79f1` (app + dashboard rebuild; backup `rtm-backup-20260908-pre-47b79f1.tar.gz`). Browser watcher + claim queue + sighting tick; server poller dormant after Vercel Code 11 evidence. Verified live: health healthy, boot clean + sighting queue, `/goparttime-auto.user.js` 200.
- **2026-09-07**: **DEPLOYED GoPartTime auto-accept foundation** (`161.118.164.85`) at commit `54bf6f7` (app + dashboard rebuild; backup `rtm-backup-20260907-pre-de9ad85.tar.gz`; no slash-command redeploy — no command files changed). Pre-deploy: `GOPARTTIME_SESSION_KEY` (32-byte hex) generated + `GOPARTTIME_AUTO_ACCEPT=false` appended to server `.env`; migration excerpt applied (6 tables + 8 audit values, task snapshot identical before/after: 153/5/13/7/39/428/2); Playwright Chromium deps installed on host (`install --with-deps`), then host browser caches removed (~2GB freed — container uses baked-in Alpine Chromium 149 + `browser-profile` volume); lockfile fixed server-side with npm 10 (npm 11 had pruned 2 `@emnapi/*` entries → `npm ci` failure, fixed with zero other changes). Verified live: compose all Up, health healthy (DB+Redis), boot "All systems online!" + "Automation scheduler started [0,10,11,20,30,40,50]", dashboard 200, userscript 200, `/automation/status` 401 without token, Chromium + 8 compiled automation modules in container, host scratch cleaned. Dry-run default — session paste + enable still pending (Automation → Session).


- **2026-09-04**: **DEPLOYED self-service /mystats + /myinvites** (`161.118.164.85`) at commit `441fc12` (app-only rebuild; backup `rtm-backup-20260904-073430-pre-441fc12.tar.gz`; no DB migration — schema unchanged; dashboard untouched; commands registered via in-container `node dist/bot/deploy-commands.js` — 14 total, local `.env` absent so host-side run). Public (non-ephemeral) replies for ticket use; optional `user` lookup gated to admins/managers. `/mystats`: This Week (payout-week Sun–Sat IST) + All Time — totals posts/comments, completed/in-progress, paid ₹ (actual, item in paid batch) vs pending ~₹ (COMPLETED-only, current rates); cancelled excluded. `/myinvites`: per direct invitee — ticket (`no ticket yet`), tasks X/threshold (2 normal, 1 special), bonus paid/pending + commission totals. Verified live: health healthy (DB+Redis), boot "All systems online!" + bot login + invite snapshot, compiled commands + `member-stats` in `dist/`, 194/194 jest pass (9 new), backend build clean. Bundles + host scratch cleaned.
  Implementation: `src/utils/member-stats.ts` (pure `buildWorkerStats`/`isWorkDone`), `src/services/member-stats.service.ts` (`getWorkerStats`/`getInviterStats`, reuses `computeReferralStatus`/`getPayableItems`; invitee tasks capped at threshold via `Math.min`), `src/database/repositories/task.repository.ts` (`findAllByWorkerId`), `src/database/repositories/payout.repository.ts` (`findItemsByWorkerId`), `src/bot/commands/mystats.ts` + `myinvites.ts`, `src/bot/embeds/index.ts` (`workerStatsEmbed` week-only/`inviterStatsEmbed` with `formatInviteTicket` channel mentions), wiring in `deploy-commands.ts` + `interactionCreate.ts` + `help.ts`, `src/__tests__/member-stats.test.ts`.

- **2026-09-04**: **DEPLOYED outreach worker tagging** (`161.118.164.85`) at commit `7a59efd` (app + dashboard rebuild; backup `rtm-backup-20260904-061828-pre-7a59efd.tar.gz`; no DB migration — schema unchanged; no slash-command redeploy). `POST /api/v1/outreach/send` now tags each ticket's worker (`{user}` → `<@workerId>`; prepend fallback; untagged + warn on unknown worker). Verified live: health healthy (DB+Redis), boot "All systems online!" + invite snapshot, compiled `formatOutreachMessage` + new default in `dist/`, dashboard 200 with bundle `index-DmgAvYSt.js` (hash matches local build, hint text present), 185/185 jest pass, backend + dashboard builds clean. Bundles + host scratch cleaned.
  Implementation: `src/utils/outreach-rows.ts` (`OUTREACH_USER_PLACEHOLDER`, `formatOutreachMessage`), `src/services/outreach.service.ts` (member-cache warm + per-channel worker resolve + format), `src/config/constants.ts:43` (default text), `dashboard/src/pages/Settings.tsx` (hint + placeholder), `src/__tests__/outreach.test.ts` (5 new cases).

- **2026-09-03**: **DEPLOYED invite auto-detection approval queue** (`161.118.164.85`) at commits `ca4471e` + `e60ed28` (app + dashboard rebuild; backup `rtm-backup-20260903-ca4471e.tar.gz`; migration `InviteDetection` table + 3 `AuditAction` values applied via excerpt script). Backfill `scripts/backfill-invite-detections.ts --since 2026-08-29` run on host (host-side `npx prisma generate` first; `DATABASE_URL` localhost-substituted): 49 members joined, **49 staged (31 with ticket)**, inviters unknown (not reconstructible) — set via Pending Invites edit, then Approve. Follow-up fix `e60ed28`: `INVITE_*` added to `schema.prisma` (first build's client rejected the new audit actions — rows staged fine, audits failed non-fatally) + `scripts/repair-invite-detected-audits.ts` inserted the 49 missing audits. Verified live: health healthy (DB+Redis), boot log "All systems online!" + "Invite tracker: snapshot complete", dashboard 200, invite route 401-without-token, task counts unchanged pre/post (149/6/17/7/55/366), 176/176 jest pass (19 new tests), backend + dashboard builds clean. Also shipped: referral edit by inviter/invitee IDs + ticket (type + indirect chain re-derived on inviter change) and pending-row editing in the Referrals page.
  Deploy checklist (done): migration excerpt applied; bot role already had invite-listing access (snapshot succeeded — no Manage Guild change needed); app + dashboard rebuilt; no slash-command redeploy (no command changes); bundles + host scratch cleaned.

- **2026-08-27**: **DEPLOYED member join welcome** (`161.118.164.85`) at commit `c206c5d` (app-only rebuild; backup `rtm-backup-20260827-193224-pre-c206c5d.tar.gz`; no DB migration — schema unchanged). `guildMemberAdd` (every join, bots skipped, immediate) sends in `#invites` (`1520616800063328437`) `hey @user please create your ticket in #verification` (`1520483343018496104`, clickable) `then we can get started`. Verified live: health healthy (DB+Redis), boot log "All systems online!", dashboard 200, `dist/bot/events/guildMemberAdd.js` + `dist/bot/index.js` (`GuildMemberAdd` + `GuildMember` partial) + `dist/config/constants.js` (`INVITES_CHANNEL_ID`, `VERIFICATION_CHANNEL_ID`, `MEMBER_WELCOME_MESSAGE`) verified, 155/155 jest pass.
  Implementation: `src/config/constants.ts:54` (`INVITES_CHANNEL_ID`, `VERIFICATION_CHANNEL_ID`, `MEMBER_WELCOME_MESSAGE`), `src/bot/events/guildMemberAdd.ts` (new), `src/bot/index.ts` (`GuildMember` partial + `guildMemberAdd` listener).
- **2026-08-27**: **DEPLOYED ticket onboarding guide** (`161.118.164.85`) at commit `454fafa` (app-only rebuild + `TicketOnboarding` table; backup `rtm-backup-20260827-190711-pre-454fafa.tar.gz`; migration `CREATE TABLE IF NOT EXISTS "TicketOnboarding"` applied via `docker exec` prisma). Welcome on `channelCreate` (same) + guide on opener's first message (any content) with 3 clickable mentions (`<#1520466000477163550>`, `<#1520481331773968384>`, `<#1520620297399828571>`) — once per `channelId`, deactivates after one use, old tickets never get guide. Verified live: health healthy (DB+Redis), boot log "All systems online!", dashboard 200, `dist/bot/events/channelCreate.js` (welcome + `markWelcomeSent`) + `dist/bot/events/messageCreate.js` (`handleTicketGuide` + `TICKET_GUIDE_MESSAGE`) + `dist/config/constants.js` verified, `TicketOnboarding` table exists, 155/155 jest pass.
  Implementation: `prisma/schema.prisma` + `prisma/migrations/migration.sql` (`TicketOnboarding`), `src/database/repositories/onboarding.repository.ts` (new), `src/config/constants.ts:48` (`TICKET_GUIDE_MESSAGE`), `src/bot/events/channelCreate.ts` (`markWelcomeSent`), `src/bot/events/messageCreate.ts` (`handleTicketGuide` — welcomeSentAt+guideSentAt check, ticket-like + opener guard, any message).
- **2026-08-27**: **DEPLOYED ticket auto-welcome** (`161.118.164.85`) at commit `50f4378` (app-only rebuild; backup `rtm-backup-20260827-140805-pre-50f4378.tar.gz`; no DB migration — schema unchanged). Bot now listens to `channelCreate` — on new ticket `TextChannel` it sends `Hey, @user Can you please share your reddit profile link?` tagging the opener. Verified live: health healthy (DB+Redis), boot log "All systems online!", dashboard 200, `dist/bot/events/channelCreate.js` + `dist/bot/index.js` show `channelCreate` handler, 155/155 jest pass.
  Implementation: `src/bot/events/channelCreate.ts` (audit log + single-member fallback, 2.5 s delay + 3 s retry, admin/manager + public-channel guards), `src/bot/index.ts` (`channelCreate` listener), `src/config/constants.ts:47` (`TICKET_WELCOME_MESSAGE`).
- **2026-08-27**: **DEPLOYED outreach post/comment counts** (`161.118.164.85`) at commit `346fec7` (app + dashboard rebuild; backup `rtm-backup-20260827-104537-pre-346fec7.tar.gz`; no DB migration — schema unchanged). Daily Outreach Post/Comment now show numeric counts (any task created today IST; `0` → cross, `>0` → green count) instead of boolean ticks; Available stays tick/cross. Verified live: health healthy (DB+Redis), boot log "All systems online!", dashboard 200, `dist/utils/outreach-rows.js` shows `filter().length`, 155/155 jest pass (new multi-count test). Docs: OUTREACH, API, FRONTEND updated.
  Implementation: `src/utils/outreach-rows.ts` (`post`/`comment`: `boolean` → `number`, `some` → `filter().length`), `dashboard/src/pages/DailyOutreach.tsx` (`OutreachTicket` numbers + `CountCell` — X for 0, green number for >0, desktop table + mobile cards), `src/__tests__/outreach.test.ts` (boolean → count assertions + multi-count case).

- **2026-08-21**: **DEPLOYED the multi-level indirect referral fix** (`161.118.164.85`) at commit `72e264c` (app-only rebuild; backup `rtm-backup-20260821-181410-pre-72e264c.tar.gz`; no DB migration — schema unchanged). Backfill `scripts/backfill-indirect-referrers.ts` run on the host (needed a host-side `npx prisma generate` first — the host tree's generated client was stale): 42 normal-inviter referrals checked, **9 linked** (0 cleared), including the reported chain — `notshagunatp`, `bavish.exe`, `batman_441` all now carry `indirectSpecialInviterId = 1202294567706316911` (isee_speed), verified via psql. Verified live: health healthy (DB+Redis), boot log "All systems online!", dashboard 200, no errors in app logs. Host scratch files (bundle, runner scripts) cleaned.
  Implementation: `resolveIndirectSpecialInviterId()` BFS walk-up in `commission.service.ts` (replaces one-level-only check), backfill script idempotent, 10 new jest tests (`src/__tests__/commission-indirect.test.ts`), 154/154 pass. Docs: REFERRAL_SYSTEM.md rewritten.

- **2026-08-17**: **DEPLOYED the reassign picker fix** (`161.118.164.85`) at commit `0fa702c` (dashboard-only rebuild; backup `rtm-backup-20260817-1915-pre-0fa702c.tar.gz`; bundle cleaned). Verified: dashboard 200, health healthy. Pending: user verification on phone (Accepted Tasks → Reassign → modal ticket list).

- **2026-08-17**: **DEPLOYED userscript v1.4.0 — Submit View disabled on phones** (`161.118.164.85`) at commit `b98bf68` (dashboard-only rebuild; backup `rtm-backup-20260817-1830-pre-b98bf68.tar.gz`; bundle cleaned). Verified: health healthy, served `/goparttime-send.user.js` reports `@version 1.4.0` and hashes `9BD9776A…` (SHA-256) — byte-identical to both local copies. New behavior: on narrow (≤767px) viewports the `📊 Submit View` button, card tracking, and preview are **never created** (insights are only submitted from the PC); override via Tampermonkey menu "📊 Submit View: ON/OFF" (storage `gpt_submit_view_enabled`, reloads to apply). Send Task untouched. Pending manual test: reinstall script on phone + PC.

- **2026-08-17**: **DEPLOYED userscript v1.3.0 — insight screenshot preview** (`161.118.164.85`) at commit `138c317` (dashboard-only rebuild; backup `rtm-backup-20260817-1745-pre-138c317.tar.gz`; bundle cleaned). Verified: health healthy, all containers Up, served `/goparttime-send.user.js` reports `@version 1.3.0` and hashes `97A16E73…` (SHA-256) — byte-identical to both local copies. Follow-up commit `c277eb0` pins `*.user.js` to LF via `.gitattributes` (Windows `core.autocrlf` had been CRLF-converting local checkouts; git/sever always stored LF — no functional change, no redeploy). Manual test still pending on goparttime.net: preview panel, zoom, ✕, auto-close on dialog close.

- **2026-08-17**: **DEPLOYED the insight screenshot TTL change (30h → 60h)** (`161.118.164.85`) at commit `cba8a35` (app-only rebuild; backup `rtm-backup-20260817-1720-pre-cba8a35.tar.gz`; bundle cleaned). Verified live: health healthy, compiled `INSIGHT_TTL_MS = 60` hours, existing 26.5h-old screenshot still retained. Rationale: GoPartTime Submit View needs the 70h screenshots downloadable while the manager submits view data.

- **2026-08-17**: **Implemented userscript v1.3.0 — insight screenshot preview**: `openInsightPreview()` in `scripts/goparttime-send.user.js` (+ byte-identical `dashboard/public` copy, SHA-256 verified) creates `URL.createObjectURL` from the **same Blob** that `attachImageToDialog()` uploads (no second download); floating left-edge panel (`#gpt-insight-preview`) with header (step/type + ✕), scrollable image, `− Zoom`/`Zoom +` (0.5×–5×, step 0.25) and `Open ↗` full-size link; pointer-events/pointerdown protection so the GoPartTime Radix dialog stays open; auto-closes when the view dialog leaves the DOM (1s watcher) or on ✕ (revokes the object URL); opened before `ensureViewDialog` so the count is readable while the dialog opens. Success alert now points at the preview.
- **2026-08-17**: **DEPLOYED the Submit View manual-task fallback** (`161.118.164.85`) at commit `60a62b8` (app-only: `docker compose build app && docker compose up -d app`; backup `rtm-backup-20260817-1655-pre-60a62b8.tar.gz`; bundle cleaned). Verified live: health healthy, boot log OK, `GET /insight/688318?step=1` → `POST_20H`, `?step=2` → `POST_70H` (image on disk, download 200/70.7 KB); no-step → `POST_20H`. Note: the 20h screenshot file itself was already removed by the 30h TTL (uploaded Aug 14) — step-1 download will 404 until a newer screenshot exists.

- **2026-08-17**: **Submit View manual-task fallback fixed + deployed**: the insight endpoint now also resolves manually-created tasks whose id embeds the GoPartTime number (`POST #688318` etc., both case conventions) via `buildManualTaskIdCandidates` (src/services/goparttime-insight.service.ts) — manual tasks only (no `source`), so GoPartTime-linked tasks always win. Triggered by a live report: task `POST #688318` (manual, COMPLETED, both screenshots on disk) 404'd with "Task not found." Verified: 131/131 jest tests, typecheck, build; deployed via git bundle (backup `rtm-backup-20260817-...tar.gz`, `docker compose build app && up -d app`), live-checked `GET /insight/688318?step=2` → `POST_70H` + image download 200.

- **2026-08-17**: **DEPLOYED the GoPartTime Submit View automation to production** (`161.118.164.85`) at commit `e0112f2` via the git-bundle flow: pre-deploy backup `rtm-backup-20260817-1551-pre-e0112f2.tar.gz`, `docker compose up -d --build` (app + dashboard), no DB migration (schema unchanged). Verified: `docker compose ps` all Up, health healthy (DB + Redis), boot log "All systems online!", userscript served at v1.2.0, endpoint tested live — real task `723770` step 1 → `POST_20H` / step 2 → `POST_70H` with `imageUrl`, screenshot download HTTP 200 (69 KB), unknown task 404, invalid step 400, missing key 401. (One earlier 404 was a screenshot expired by the 30h TTL — expected.) Bundle cleaned from the host; local `statbot-main.bundle` deleted.
- **2026-08-17**: **GoPartTime Submit View automation implemented**: new `src/services/goparttime-insight.service.ts` (`resolveInsightReminder` — step 1 = 20h reminder, step 2 = 70h reminder for posts; no-step fallback: pending → has-image → earliest), read-only `GET /api/v1/goparttime/insight/:externalTaskId?step=1|2` behind the extension key, 10 new jest tests (`src/__tests__/goparttime-insight.test.ts`), and userscript **v1.2.0** (both copies, SHA-256 byte-identical): "📊 Submit View" floating button + card tracking (`Submit View` / `Available to submit view in …` buttons on `div[data-slot="card"]`), fetches the screenshot Blob (GM_xmlhttpRequest blob/arraybuffer, fetch fallback), opens the View dialog (`div[role="dialog"][data-slot="dialog-content"]` + `input[name="exposure_count"]`), attaches via `DataTransfer` to the hidden `input[type="file"][accept="image/*"]`. **Deliberately manual**: view-count entry, Submit click, and success verification are the manager's job — no confirm endpoint, no backend state changes, `messageCreate.ts` untouched. Verified: 129/129 jest tests, typecheck, backend + dashboard builds.

- **2026-08-13**: **Re-deployed the two-level referral to production** (`161.118.164.85`) at commit `a558f1d` (user committed the migration safety fix + `scripts/restore-accepted.ts` + docs into `a558f1d`). Safe procedure used: server tree backed up (`/home/ubuntu/rtm-backup-20260812-pre-redeploy-a558f1d.tar.gz`), git bundle shipped + `git reset --hard refs/remotes/origin/main`, **verified server `migration.sql` contains zero UPDATE/DELETE/INSERT statements** (backfill permanently removed), ran the schema-only migration (added `Referral.indirectSpecialInviterId` + index + `per_task_indirect` enum — all `IF NOT EXISTS`), snapshot-verified task statuses unchanged before/after (ACCEPTED=0, PENDING=93, reminders=510, 122 CommissionItem rows intact), `docker compose up -d --build`, 12 slash commands re-deployed, health/dashboard/userscript/bot verified, no errors in logs. Bundles cleaned up.
- **2026-08-12**: **Fixed the Accepted-tasks regression** (root cause found & repaired): re-running `migration.sql` during the 11:00 deploy re-executed a one-time data backfill from the 2026-08-04 cutover (`UPDATE Task SET status='ACCEPTED' WHERE source='goparttime' AND status='PENDING'` + `DELETE FROM "Reminder"`), reverting all 48 activated GoPartTime tasks to ACCEPTED and deleting their reminders. Fix: removed the backfill from `migration.sql` (local + server, with DANGER comment), added reusable `scripts/restore-accepted.ts`, restored all 48 tasks → PENDING with reminders recreated/scheduled via the activation logic (deleted ones' jobs are skipped by the worker). Verified: ACCEPTED=0, reminders scheduled, health OK. **Rule going forward: migration.sql is schema-only; data changes go in versioned one-off scripts.**
- **2026-08-12**: **Rolled back the `5797667` deploy to `1a70dbf`** on production (`161.118.164.85`): user reported unexpected tasks in the dashboard Accepted section after the deploy. Investigation showed the 48 ACCEPTED tasks predate the deploy (created 2026-08-04 → 2026-08-12, all before 11:00; the referral commit cannot create tasks) — the rollback was done anyway per request. Full rollback: git reset to `1a70dbf`, DB reverted (`Referral.indirectSpecialInviterId` column+index dropped; `CommissionKind` enum recreated without `per_task_indirect`; 122 `CommissionItem` rows untouched), images rebuilt, 12 commands re-deployed, health/dashboard/bot/DB verified. Safety backup of the reverted state: `/home/ubuntu/rtm-backup-20260812-rollback5797667.tar.gz`. Note: PG has no `ALTER TYPE ... DROP VALUE`; enum values are removed by recreate-the-type (rename → create → alter column → drop).
- **2026-08-12**: Deployed `5797667` (two-level referral system) to production (`161.118.164.85`): shipped as a git bundle, working-tree backup taken (`rtm-backup-20260812-105700.tar.gz`), DB migration applied (idempotent `migration.sql`: `Referral.indirectSpecialInviterId` column + index + `per_task_indirect` enum), `docker compose up -d --build`, 12 slash commands re-deployed, health/dashboard/bot/DB verified. *(Superseded by the rollback above.)*
- **2026-08-12**: Deployed `1a70dbf` to production (`161.118.164.85`): code shipped as a git bundle (server repo `/home/ubuntu/rtm` cannot `git pull` — private GitHub repo, no host credentials), `docker compose up -d --build`, no DB migration needed (schema already matched), 12 slash commands re-deployed, health/dashboard/bot verified.
- **2026-08-12**: Payments page UI redesign: split 1,382-line monolith into 17 modular components (`dashboard/src/pages/payout/`), sub-navigation routes (`/payout/tasks` & `/payout/commissions`), responsive mobile cards, inline accordion expansion, segmented-control date filter, collapsed-by-default history.
- **2026-08-09**: Two-level referral implemented (`9348d2d`) then **reverted** (`ac441e2`).
- **2026-08-05**: Owner earnings gained daily income from added non-deleted tasks + last-7-days table (`874ff60`); userscript updated and served from the dashboard; Android setup docs (`0af8cbf`).
- **2026-08-04**: Plain task-message copy-link UX, embed updates, goparttime service fixes (`e267974`).
- **2026-08-03**: GoPartTime extension integration + page-format task IDs + dashboard copy-link UX (`445e7cf`).
- **2026-08-02**: Referrals dashboard page; edit/delete actions; ticket-name normalization, admin-guard fix (`ba2339e`, `a246eb8`, `b4f7842`).
- **2026-07-27**: Owner earnings route + weekly endpoint; createdAt-based counts.
- **2026-07-26**: Firestore → PostgreSQL cutover (Phase 4 repository pattern `1f01cc2`, Phase 5 cutover `702520a`, cleanup commits thereafter).
- **2026-07-25**: Referral commission tracking (`1b36416`), `/referral add` ticket option (`8584385`).
- **2026-07-24**: Payout system + CSV (`3792396`), week-boundary fix (`fa6d598`), PWA (`9287f61`).
- **2026-07-23**: Insight screenshots saved + 30h cleanup (`dddd658`), deletion stats, mobile cards, navbar.
- **2026-07-21**: Manual deletion override (auto-detection removed), Sunday archive, Archives page.
- **2026-07-20**: Deletion detection (early/late), Activity Log page, timeline.
- **2026-07-19**: Initial commit (Firestore-based).

---

## 14. Docs Index

| Doc | Covers |
|---|---|
| `docs/ARCHITECTURE.md` | System components, communication flow, service boundaries |
| `docs/DISCORD_BOT.md` | Bot, all 12 commands, events, embeds, workflows |
| `docs/GOPARTTIME.md` | GoPartTime integration end-to-end |
| `docs/BROWSER_EXTENSION.md` | The userscript (Tampermonkey) |
| `docs/TASK_SYSTEM.md` | Task lifecycle, state machine, validation |
| `docs/REMINDER_SYSTEM.md` | Reminder engine, scheduling, retries, re-hydration |
| `docs/INSIGHT_SYSTEM.md` | Insight submission, screenshots, storage |
| `docs/OUTREACH.md` | Daily Worker Outreach feature (IST daily cycle, availability) |
| `docs/PAYOUT_SYSTEM.md` | Weekly payout computation, batches, edge cases |
| `docs/REFERRAL_SYSTEM.md` | Inviters, commissions, batches |
| `docs/DATABASE.md` | Schema, ER diagram, migrations, indexes |
| `docs/API.md` | All 58 REST endpoints |
| `docs/FRONTEND.md` | Dashboard pages, components, auth, PWA |
| `docs/DEPLOYMENT.md` | Docker/nginx/DuckDNS/PM2 deployment |
| `docs/ENVIRONMENT.md` | All env vars (names only) |
| `docs/BACKGROUND_JOBS.md` | All timers/jobs/queues |
| `docs/SECURITY.md` | Auth model, risks |
| `docs/TESTING.md` | Test setup, coverage, regression checklist |
| `docs/TROUBLESHOOTING.md` | Verified issues + solutions |
| `docs/CHANGELOG.md` | Chronological change log (from git history) |
| `docs/KNOWN_ISSUES.md` | Bugs, limitations, debt |
| `docs/ROADMAP.md` | In-progress/planned/debt/ideas |
| `docs/DECISIONS.md` | Architectural decision log |