# TROUBLESHOOTING.md — Verified Issues & Solutions

> Only issues verified from the repository/code are listed. Each entry: Problem → Cause → Diagnosis → Solution → Relevant files.

---

## 1. Discord / Bot

### Reminders never sent / jobs missing after restart
- **Cause**: Redis lost delayed jobs (restart/flush) or the bot was down at due time.
- **Diagnosis**: check `docker compose logs app` for "Re-hydrated N reminder jobs" or "no orphaned reminders found"; `GET /api/v1/health` for Redis state.
- **Solution**: re-hydration runs at boot + every 30 min automatically; nothing to do manually. If jobs are still missing, check that the task is not CANCELLED/ARCHIVED and that `reminder.dueAt` is in the past (past due jobs fire immediately).

### "An error occurred while executing this command."
- **Cause**: thrown error in command execution (e.g. DB down, invalid transition).
- **Diagnosis**: bot logs (`logger.error`), audit `COMMAND_USED` shows the command name; check Discord API status for send failures.
- **Solution**: depends on the underlying error; retry after fixing the cause. `/delete` confirmations time out after 30 s.

### Slash commands not appearing / stale options
- **Cause**: commands are **guild-scoped**; changes require re-deploy.
- **Solution**: `npm run deploy-commands` (needs `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`), then wait a few seconds; Discord caches options.

### Worker replies "not recorded" / "Submission recorded" never appears
- **Cause**: reply must be to the **instruction delivery message**; author must be the assigned worker; task must be ACCEPTED/PENDING with `assignmentStatus='SENT'`; exactly one valid URL in the message.
- **Diagnosis**: check `assignmentStatus` in TaskDetails; verify message is a reply (not a new message).
- **Solution**: use `retry-assignment` if FAILED; reply to the correct message with one reddit.com URL.

### Insight reply "⚠️ Insight already received."
- **Cause**: reminder already `completed` (duplicate screenshot).
- **Solution**: informational; nothing to do.

## 2. GoPartTime / Extension

### "Task has already been assigned."
- **Cause**: the GoPartTime task was already ingested (unique `(source, externalTaskId)`).
- **Solution**: find it in the dashboard (Accepted or Tasks), activate or delete it.

### "Task created but delivery failed" (failed: true)
- **Cause**: channel fetch/worker detection succeeded but a Discord send failed (image too big after compression, channel permissions, rate limits).
- **Diagnosis**: TaskDetails → External Assignment block shows `assignmentError`; check bot logs.
- **Solution**: dashboard "Retry Delivery" (`POST /tasks/:id/retry-assignment`) — sends only the missing tail.

### "Authentication failed. Check your API key."
- **Cause**: userscript key ≠ `GOPARTTIME_API_KEY`.
- **Solution**: gear icon → re-enter key; restart the page. Backend returns 503 when the key is unset server-side.

### Task detection fails ("Could not extract task content." etc.)
- **Cause**: GoPartTime DOM changed (Radix dialog, `div.prose`, named inputs).
- **Diagnosis**: userscript debug tool (magnifier) prints detected fields.
- **Solution**: update the userscript selectors (both copies: `scripts/` and `dashboard/public/`), update the spec doc.

## 3. Database

### Stale enum values / TypeScript mismatch after schema change
- **Cause**: `src/generated/prisma` not regenerated (it's gitignored).
- **Diagnosis**: `TaskStatus` enum missing `ACCEPTED`; `AuditAction` missing TASK_ASSIGNED etc.
- **Solution**: `npx prisma generate`.

### Migration not applied / relation doesn't exist
- **Cause**: migrations are manual.
- **Solution**: run `prisma/migrations/migration.sql` against the DB (idempotent), then `npx prisma generate`.

### Deleting a task fails ("constraint" / RESTRICT)
- **Cause**: `PayoutItem.taskId` / `CommissionItem.sourceTaskId` FKs RESTRICT deletion of paid/referenced tasks.
- **Solution**: that's by design — paid tasks are archived, not deleted. Use archive/restore paths.

## 4. Deployment / Docker

### Backend container exits at startup
- **Cause**: env validation fails (`env.ts` exits on missing vars, e.g. `DATABASE_URL`).
- **Diagnosis**: `docker compose logs app` → "❌ Environment validation failed: …".
- **Solution**: fix `.env` (see `docs/ENVIRONMENT.md`).

### "ECONNREFUSED" to database from container
- **Cause**: PostgreSQL runs on the host; container needs `host.docker.internal` (extra_hosts configured in compose).
- **Solution**: ensure `DATABASE_URL` host is `host.docker.internal` (or reachable), pg listening on 0.0.0.0, and credentials correct.

### Insight images 404 in dashboard
- **Cause**: files cleaned after 60h TTL (mtime-based), or the uploads volume wasn't mounted on the new container, or image URL contains a stale taskId.
- **Diagnosis**: check `/app/uploads/insights/<taskId>/` in the container.
- **Solution**: none for expired files (by design); keep the `insight-uploads` volume.

### Let's Encrypt renewal failing
- **Cause**: webroot mount missing / domain record changed.
- **Diagnosis**: nginx ACME path `/.well-known/acme-challenge/` served from `/var/www/letsencrypt`.
- **Solution**: ensure the volume mount and the certbot renew command (not in repo — UNKNOWN).

## 5. Reminders / Insight storage

### Duplicate reminder jobs after restart
- **Cause**: job IDs are deterministic (`reminder-{id}`) and re-hydration skips existing ones; duplicates only if `jobId` write failed.
- **Diagnosis**: BullMQ jobs list.
- **Solution**: cancel via `cancelJob` (not exposed via API; use `/reschedule`/`/send-now` or DB).

### Screenshot saved but reminder not completed
- **Cause**: image save failure is **non-fatal** — completion happens regardless; conversely if the reply wasn't a reply to the reminder message, nothing happens.
- **Diagnosis**: reminder row `completed`/`insightImageUrl` in TaskDetails.

## 6. Payout / Commission

### Summary "alreadyPaid" seems wrong
- **Cause**: `alreadyPaid` = **all-time** sum of all payout items, not week-scoped.
- **Solution**: read it as a global counter; per-week numbers come from batches.

### Worker shows in breakdown but Pay Worker errors "no eligible tasks"
- **Cause**: all its tasks got paid between the two reads (or cancelledReason set).
- **Solution**: refresh; filter by week.

### "All eligible tasks have already been paid."
- **Cause**: duplicate pay-all call.
- **Solution**: informational; check `GET /payouts/batches`.

## 7. Auth / API

### Dashboard kicks to /login constantly
- **Cause**: JWT expired (24h) or removed on 401.
- **Solution**: log in again.

### 429 "Too many requests"
- **Cause**: 100 req/15 min/IP on `/api/`.
- **Solution**: wait; raise `max` in `server.ts` if needed.

### 503 on /goparttime/assign
- **Cause**: `GOPARTTIME_API_KEY` empty.
- **Solution**: set the env var and restart.

## 8. Build / Environment

### `npm run typecheck` fails on generated code
- **Cause**: stale `src/generated/prisma` or missing generation.
- **Solution**: `npx prisma generate`.

### `.env.example` confusion
- **Cause**: example is stale (FIREBASE_* listed, `DATABASE_URL` missing).
- **Solution**: validate against `src/config/env.ts`.

### Dashboard dev proxy fails
- **Cause**: `VITE_API_TARGET` default changed http→https (uncommitted working-tree change); certificate is self-signed/legacy (secure:false).
- **Solution**: set `VITE_API_TARGET` explicitly if needed.