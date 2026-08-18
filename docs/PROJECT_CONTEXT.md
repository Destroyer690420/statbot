# PROJECT_CONTEXT.md — Reddit Task Manager

> **Persistent project memory.** Future OpenCode sessions MUST read this file first.
> Repository: `reddit-task-manager` · Last verified: 2026-08-18 — Outreach top toolbar polish **LIVE** (`161.118.164.85`, git HEAD `8252e35`, dashboard-only rebuild; responsive toolbar — info pill + text left, buttons right on PC; stacked full-width buttons on mobile; served bundle `index-CM53e94s.js`, health healthy).

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
8. **Payout system**: weekly (IST Sunday→Saturday) totals from `PayoutSettings` rates (defaults ₹30/comment, ₹60/post); workers paid per completed task; pay-worker/pay-all create `PayoutBatch` + `PayoutItem`, mark paid COMPLETED tasks ARCHIVED; CSV export; batch history. See `docs/PAYOUT_SYSTEM.md`.
9. **Referral commissions**: `/referral add` (admins) records inviter→invitee links; normal inviters get a one-time ₹100 bonus after the invitee completes 2 tasks; special inviters (hardcoded list of 3 Discord IDs) get ₹50 one-time bonus after 1 task + ₹10/comment, ₹20/post per task. **Two-Level Referrals**: auto-detects when a normal inviter was referred by a special inviter (`indirectSpecialInviterId`), paying the normal inviter their standard bonus and paying the upstream special inviter per-task commissions (₹20/post, ₹10/comment) on the worker's tasks (no one-time bonus). Commission batches/CSV/history in the dashboard. See `docs/REFERRAL_SYSTEM.md`.
10. **Owner earnings**: daily/weekly net earnings (hardcoded revenue ₹250/post, ₹100/comment; worker cost ₹60/₹30) minus per-task/one-time commissions (including indirect special per-task commissions); PIN (default `7977` via `OWNER_PIN`) gates navigation from Settings but the API endpoints are unauthenticated. See `docs/FRONTEND.md`.
11. **Dashboard**: 13 routes — Dashboard, Tasks, TaskDetails, AcceptedTasks, Daily Outreach, Archives, PayoutLayout (`/payout/tasks` & `/payout/commissions`), Referrals (with Indirect referral badge), Analytics, Settings, OwnerEarnings, Login, NotFound. JWT auth via single dashboard account (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`). See `docs/FRONTEND.md`.
12. **Audit log**: `AuditLog` rows for task/payout/commission/referral/reminder/command/outreach events; no dashboard consumer since the Activity page was removed (2026-08-18) — `GET /api/v1/audit-logs` kept for debugging.
13. **Daily Worker Outreach**: per-ticket daily availability tracking. Manager selects tickets (persisted in `TicketOutreach`, survives day changes), `POST /api/v1/outreach/send` broadcasts the configurable daily message (`OutreachSettings`, default constant) to checked tickets only; any worker (non-bot/non-admin) message in a checked ticket after the send marks it Available (`messageCreate.ts` hook → `outreachService.onWorkerMessage`). Post/Comment columns auto-derive from today's tasks per channel — assignment workflow unchanged. Daily cycle = IST day (resets at 00:00 IST: Available/Post/Comment go fresh, selection is remembered). See `docs/OUTREACH.md`.

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
| Two-level referral (indirect special commissions) | **Deployed to production 2026-08-13** (`a558f1d`): schema + code live; migration applied schema-only (no data statements); task statuses verified untouched (ACCEPTED=0) |
| Auto Reddit-deletion detection | **Removed/deprecated** (manual `cancelledReason` override instead); `check-reddit.ts` is dead code |
| Owner earnings | Implemented (daily, 7-day history, weekly) |
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
→ recordSubmission → manager clicks Done (POST /tasks/:id/done) → ACCEPTED→PENDING + reminders scheduled
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

- PostgreSQL via Prisma 7 (`PrismaPg` driver adapter), `DATABASE_URL` env. Tables: `Task`, `Reminder`, `AuditLog`, `PayoutBatch`, `PayoutItem`, `Referral`, `CommissionBatch`, `CommissionItem`, `PayoutSettings`, `CommissionRates`, `TicketOutreach`, `OutreachSettings` (12 models, 7 enums).
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