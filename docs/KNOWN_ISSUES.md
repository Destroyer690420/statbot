# KNOWN_ISSUES.md — Known Issues, Limitations & Debt

> All items verified from the repository on 2026-08-11. Severity: Critical / High / Medium / Low.

---

## Recently fixed

### 0a. Insight screenshot dropped when replying to an older reminder message (resolved 2026-10-28)
- **Was**: a reminder is re-sent up to 3 times, and each send overwrote the single `Reminder.reminderMessageId`. `handleInsightUpload` resolved a reply only through that scalar, so replying to the first reminder or an earlier retry matched no reminder and the screenshot vanished with no bot response. Replying to the finished 20h reminder with the 70h view data was also rejected as "Insight already received".
- **Resolved**: `Reminder.reminderMessageIds TEXT[]` (GIN-indexed) stores every send/retry ID and `findByMessageId` matches it (scalar fallback for old rows); `src/utils/insight-reply.ts` attributes an already-completed reply to the single later pending step, derives task status from the completed steps, and names the step in the confirmation. `REMINDER_20_SENT → INSIGHT_70_RECEIVED` added so a 70h-only reply completes the task. Deployed 2026-10-28 at `96d83db` (app + dashboard rebuild, idempotent migration; column + GIN index verified on the host DB; live-dist gates green). 16 tests in `insight-reply.test.ts`.
- **Still open (not a bug)**: the new behaviour has not yet been exercised by a real reply to an older reminder in production. See `docs/INSIGHT_SYSTEM.md` §3.

### 0b. GoPartTime failed-task checker not deployed (resolved 2026-10-24)
- **Was**: the `/my-tasks/failed` checker existed only in the working tree — no `FailedTaskCheck` table, no live route, no served script.
- **Resolved**: deployed at `1df8027` — `FailedTaskCheck` DDL applied (psql exit 0, 0 unexpected errors; table + 3 indexes + PK verified), app + dashboard rebuilt, 3 services Up, health `200`, boot "All systems online!", route **401** without a key and **200** with it, an empty batch returned zero counts with no DM, a throwaway unknown ID was persisted as `NOT_FOUND` and then removed (table back to 0 rows), and `https://statbot.duckdns.org/goparttime-failed.user.js` serves the exact source bytes. Rollback: restore `rtm-backup-20261024-123214.tar.gz` or rebundle `0fd61dd` + rebuild.
- **Follow-up deployed 2026-10-24 at `9100667`**: userscript **v1.1.0** (single page only, no pagination/fetch/reload; legacy scan cache deleted on load) and server-side unseen-only processing (`skippedKnown`; no resolve/upsert for known IDs). Also fixed the live `tasks.N.failedReason` validation failure — the zod cap was 300 chars; it is now 2000 (live-verified with a 1,500-char reason), with `reward` 64 / `deadline` 128. Backup `rtm-backup-20261024-131628.tar.gz`; no migration.
- **Still open (not a bug)**: the script is **not installed in Tampermonkey yet**, so the first real browser scan (GoPartTime failed-page DOM) and the first genuine `MISMATCH` owner DM remain unverified. See `docs/GOPARTTIME.md` §20.

### 0c. Link-submit executor missed cards on earlier todo pages (resolved + deployed 2026-10-29 at `09a00c0`)
- **Was**: with 3–4 pages on `/my-tasks/todo`, the executor (`goparttime-submit.user.js` v1.2.1) walked `?page=N` forward only from the page the tab was left on. After the previous job left the tab on page 4, a card on page 2 was never searched: the walk reported "card not found" at the last page instead of wrapping back to page 1. The `?page=` hop is a full reload, so no earlier-page knowledge survived.
- **Resolved (deployed)**: v1.2.2 persists the hunt in the in-flight job (`active.scan`: `visited`, `maxPages`, `sawCards`) and wraps forward (`4 → 1 → 2 → 3`) until every page 1..max was checked once; empty/out-of-range pages advance instead of aborting. Same for feedback jobs. Both copies byte-identical, `node --check` clean, userscript tests 33/33 green (new `submit-page-scan.test.ts` pins the wrap-around, out-of-range recovery, and `MAX_PAGES` cap). Deployed 2026-10-29 with a dashboard-only rebuild: served `/goparttime-submit.user.js` verified at `@version 1.2.2` (SHA-256 matches the source, both `page-scan` sentinels + `nextUnvisitedPage` present), health `200`, dashboard `200`, 0 dashboard errors. Backup `rtm-backup-20261029-054631.tar.gz`.
- **Still open (not a bug)**: the executor tab needs a Tampermonkey update to v1.2.2; until then the open tab keeps the forward-only v1.2.1 walk (v1.2.2 supersedes the pending v1.2.1 tab update).
- **Follow-up (local 2026-10-31 — NOT deployed)**: v1.2.2 still started its hunt from the tab's current `?page=N` and depended on `maxTodoPages()` reading the pagination markup. The served copy was updated, but the executor tab kept running v1.2.1 (the Tampermonkey update was never applied), which is why the reported "page 3/4 only, never back to page 2" behaviour continued. **v1.3.0** replaces the wrap-around with a deterministic forward walk that always begins at page 1 (`1 → 2 → 3 …`), persists the next page in the in-flight job across full-page `?page=` hops, ends on an empty page or a repeated card set (the site ignored `?page=`), retries a failed/redirected navigation once, and is bounded by `MAX_PAGES` (10). It also adds `@updateURL`/`@downloadURL` so future fixes can auto-update. Source + `dashboard/public/` mirror byte-identical; `submit-page-scan.test.ts` 10 cases; full suite 94/94 suites / 1,283 tests green; typecheck clean. **Still requires a manual Tampermonkey update to v1.3.0** — an installed v1.2.x script has no update URL, so the new metadata cannot reach it until v1.3.0 is installed once. See `docs/BROWSER_EXTENSION.md` §5h.

### 0d. Link escalation permanently lost behind an under-filled burst round (fixed locally 2026-10-31 — NOT deployed)
- **Was**: the +10 min link warning fired normally, but the +15 min availability blast/reassignment stopped happening (last successful reassignment 2026-10-28 06:20; only nudge audits afterwards). Production logs showed `Escalation deferred: a live round is open (retry on next trigger)` at every escalation; the blocking blast was always `createdBy='burst'`. A burst blast stays OPEN until it fills or the next :10 IST round supersedes it (late replies within the hour still convert by design), so an under-filled round (e.g. 12 slots / 1 filled, 9 / 6, 11 / 2) blocked escalation for the whole hour. The +15 min job is one-shot and `deferred` was returned without re-scheduling, so the escalation was consumed and never retried.
- **Fixed locally**: a **burst** round only defers escalation for `LINK_ESCALATION_BURST_GRACE_MS` (6 min, the :10–:16 reply window); after that escalation supersedes it. Manual and `link-escalation` rounds are never implicitly superseded, and adoption is restricted to `createdBy='link-escalation'` so a burst's replies cannot be stolen. A **2-min recovery sweep** (`LINK_ESCALATION_SWEEP_INTERVAL_MS`, boot-registered in `src/index.ts`, cleared on shutdown) re-pools posts delivered within `NUDGE_BACKFILL_MAX_AGE_MS` (24h), so a deferred/lost trigger recovers in ~2 min. `escalateDueTasks` is serialized so the sweep and a +15 job cannot open competing rounds; an already-tracked round with no new posts is a no-op. Boot rehydration sends posts already past +15 min straight to escalation (no duplicate +10 warning). App-only — no schema/migration/env change. `src/__tests__/link-escalation.test.ts` has 13 cases (fresh burst defers, stale burst superseded, manual never superseded, own-round no-op, join-with-new-task). See `docs/GOPARTTIME.md` §"Post-link nudge + escalation re-blast", Decision 50.
- **Still open (not a bug)**: the fix is tested locally but **production still runs the old build**, so the deferred-forever behaviour persists until an app rebuild/deploy. Verify on deploy: boot log `Link-escalation recovery sweep scheduled (every 2 minutes)`, and escalations should no longer end only with `deferred`.

### 0e. "Unknown Channel" blast errors for tickets deleted by the inactivity sweep (expected, has a remedy)
- **Symptom**: after the 2026-11-11 7/10/15 deploy, the hourly outreach blast logs `Outreach blast channel resolve failed {"error":"Unknown Channel"}` for some channels (17 such lines in the first 30 min after the :40 round).
- **Cause**: **not a bug in the sweep.** Deleting ticket channels leaves their `TicketOutreach` rows behind (pre-existing, deliberate behaviour — outreach rows are only removed through the Dead Tickets cleanup or the per-ticket delete button). Every blast still tries those selected rows, Discord answers `Unknown Channel`, and the blast continues with the remaining tickets.
- **Remedy**: Settings → **Dead Tickets** → scan → delete all (`GET`/`DELETE /api/v1/outreach/dead-tickets`, admin JWT). This removes rows whose channel no longer resolves and stops the log noise.
- **Note**: any operator-initiated mass channel cleanup (initial cleanup at `5a7da7e`, the 89-ticket sweep on 2026-11-11) should be followed by a Dead Tickets scan.

### 0f. Worker "See Details" always showed `(No content)` (fixed + deployed 2026-11-14 at `b6714854`)
- **Was**: every card in the worker live feed at `/worker` rendered `(No content)` when expanded, so workers could not read the post body before claiming.
- **Root cause**: two independent races. (1) `availableTasksService.updateTaskContent()` silently discarded peeker payloads for tasks not yet in the in-memory pool; the peeker extracts a drop ~1s after it lands while the watcher only reports it after a 1.5s settle, so content arrived first and was dropped — and the card had already been marked peeked. (2) `goparttime-content.user.js` v1.2.0 resolved the drawer as soon as `input[name="title"]` existed, read an empty `div.prose`, sent nothing, and still marked the card peeked forever.
- **Fixed + deployed 2026-11-14 at `b6714854`** (app + dashboard rebuild): a bounded 6h/1000-entry enrichment cache in `available-tasks.service.ts` queues content/title until the task is reported and survives pool eviction; `updateTaskContent()` returns `{ applied, queued }`; `/automation/task-content` returns `{ updated, queued }`; peeker **v1.3.0** waits up to 2s for readable prose, only tags cards after the server accepts, retries failed/401 sends (5s cooldown) and empty drawers (3 attempts), and uses a version-scoped `sessionStorage` key. `npm run typecheck` clean; full suite 102/102 suites / 1,379 tests green; live verification: 3 services Up, health `200` healthy DB+Redis, boot "All systems online!", v1.3.0 served, dashboard `200`.
- **Manual step remaining**: install/enable `goparttime-content.user.js` v1.3.0 in Tampermonkey (`https://statbot.duckdns.org/goparttime-content.user.js`) on `https://goparttime.net/tasks?peeker=1`. No migration, no env change.

---

## Verified 2026-08-17

### 0. `npm run lint` broken repo-wide (no ESLint config)
- **Description**: ESLint 9.x requires a flat `eslint.config.js`; the repo has never shipped one (no `.eslintrc*`, no `eslint.config.*`). `npm run lint` fails immediately with "ESLint couldn't find an eslint.config.(js|mjs|cjs) file."
- **Severity**: Medium (CI/dev annoyance; typecheck + tests still run).
- **Status**: Open.
- **Cause**: ESLint dependency bumped to ^9 without migrating config format.
- **Next step**: add an `eslint.config.js` (flat config) matching the current lint script (`eslint src/ --ext .ts`).

---

## Confirmed Bugs / Risks

### 1. Owner-earnings endpoints are unauthenticated
- **Description**: `GET /owner/daily-earnings`, `/daily-earnings/history`, `/weekly-earnings` have no JWT and no PIN; only rate-limited.
- **Severity**: High (financial data exposure).
- **Status**: Open.
- **Cause**: route file mounts them without auth middleware.
- **Workaround**: none (anyone with network access can query).
- **Files**: `src/api/routes/owner.ts`, `src/api/server.ts`.
- **Next step**: require JWT (and/or PIN) on these routes; add role claim checks.

### 2. Hardcoded default owner PIN `'7977'`
- **Description**: `OWNER_PIN` defaults to `'7977'` in `env.ts`; `/owner/verify` returns HTTP 200 even for a wrong PIN (client checks `success`).
- **Severity**: High if env var not overridden.
- **Status**: Open.
- **Files**: `src/config/env.ts`, `src/api/routes/owner.ts`, `dashboard/src/pages/Settings.tsx`.
- **Next step**: require explicit env value; change verify semantics.

### 3. Secret-bearing debug scripts at repo root
- **Description**: `query-tasks.ts` / `query-tasks.js` (untracked) contain a hardcoded PostgreSQL password.
- **Severity**: Critical (credential leak risk).
- **Status**: Open.
- **Workaround**: none; **delete these files**.
- **Next step**: remove from disk and from any history; rotate the DB password.

### 4. Private SSH key in repo root
- **Description**: `ssh-key-2026-07-19.key` sits in the working directory (gitignored, untracked).
- **Severity**: Critical (if ever committed or exfiltrated).
- **Status**: Open (not tracked by git, but present on disk).
- **Next step**: move to a secure location and delete from the repo directory.

### 5. Stale generated Prisma client
- **Description**: `src/generated/prisma/enums.ts` lacks `TaskStatus.ACCEPTED` and 5 `AuditAction` values present in `schema.prisma`.
- **Severity**: Medium (type-level drift; regenerated in Docker builds, so production is likely fine).
- **Status**: Open.
- **Cause**: `prisma generate` not re-run after the GoPartTime migration.
- **Solution**: `npx prisma generate`.
- **Files**: `src/generated/prisma/enums.ts` vs `prisma/schema.prisma`.

### 6. Stale root `dist/` build
- **Description**: `dist/` is a partial older compile (missing newer modules, stale tests compiled in).
- **Severity**: Medium (only matters if someone runs `node dist/index.js` manually).
- **Status**: Open (gitignored; Docker builds fresh).
- **Next step**: delete or rebuild; never trust it.

### 7. Payout/commission completion-time derivation
- **Description**: eligibility week windows use the most recent completed reminder's `completedAt` (fallback `updatedAt`); the task stores no completion timestamp.
- **Severity**: Medium (tasks can land in the wrong payout week after reschedules/manual status changes).
- **Files**: `src/services/payout.service.ts`, `src/services/commission.service.ts`.
- **Next step**: store `completedAt` on the task at completion time.

### 8. Deleting a paid referral fails (DB RESTRICT)
- **Description**: `DELETE /commissions/referrals/:referralId` on a referral with commission items → FK RESTRICT error (surfaces as 400/500).
- **Severity**: Low–Medium (dashboard delete button errors without explanation).
- **Status**: Open.
- **Files**: schema FK `CommissionItem.referralId`, `src/api/routes/commissions.ts`.
- **Next step**: soft-delete referrals or friendly error handling.

### 9. Theme picker is a stub
- **Description**: Settings theme buttons do nothing; `<html class="dark">` is hardcoded.
- **Severity**: Low.
- **Files**: `dashboard/src/pages/Settings.tsx`, `index.html`.
- **Next step**: implement or remove.

### 10. Format checker counted space-padded paragraph breaks as ONE paragraph
- **Description**: Reddit's rich-text editor keeps markdown hard-break spaces, so a visually blank separator is stored as `"   \n  \n"`. `splitParagraphs` split on `/\n{2,}/` only, so a correctly formatted 3-paragraph post counted as 1 and the bot replied "Formatting failed (1/3 ¶)", tagged the owner, and did not queue the link. Confirmed live on task 1326259 (`r/Big4`, post `1xcm5ab`, 2026-10-22): raw `selftext` = `"...CFO.   \n  \nOn paper..."` → old splitter 1 paragraph, fixed splitter 3.
- **Severity**: High (false rejection of valid submissions; link not queued for auto-submit).
- **Status**: **Fixed (2026-10-22) and DEPLOYED live at `6e162b0`** (app + dashboard rebuild, no migration). Verified end-to-end: Recheck of task 1326259 returned `MATCH` 3/3 (was `PARA_SHORT` 3/1) and `Submission job scheduled` fired. Tampermonkey copy needs a v1.1.1 script update.
- **Fix**: strip trailing whitespace incl. NBSP from every line (`/[ \t\u00a0]+$/gm`) and normalize `\r\n?` before splitting — `src/utils/reddit-format.ts`, `dashboard/src/utils/redditFormat.ts`, `scripts/reddit-format-check.user.js` + `dashboard/public/` mirror (v1.1.1).
- **Recovery for already-failed tasks**: fixed ones need a **Recheck** from the dashboard (it re-runs the check and queues the link through the normal submit gate); task 1326259 was recovered this way on deploy day.
- **Files**: `src/utils/reddit-format.ts`, `dashboard/src/utils/redditFormat.ts`, `scripts/reddit-format-check.user.js`, `dashboard/public/reddit-format-check.user.js`.

## Known Limitations (by design / accepted)

| # | Limitation | Notes |
|---|---|---|
| 11 | Insight images unauthenticated + 60h TTL | Public URL for 60h then auto-deleted; viewers must act fast (`docs/INSIGHT_SYSTEM.md`) |
| 12 | `alreadyPaid` summary is all-time, not weekly | `payoutRepository.getTotalPaid()` global sum |
| 13 | payWorker batches keep `paidAt = null` | Never filled later; payAll batches set it at creation |
| 14 | No auto-payout for commissions or workers | Both are dashboard-manual |
| 15 | `deadline`/`payment` from GoPartTime are display-only | No enforcement |
| 16 | One awaiting-submission task per ticket | Guard in `assignFromGoPartTime` |
| 17 | Worker detection = exactly one non-admin member in channel | Multi-worker tickets rejected |
| 18 | Special inviter list hardcoded in `referral.ts` | Requires code edit to change |
| 19 | No per-worker identity on the extension channel | Shared `GOPARTTIME_API_KEY` |
| 20 | Redis without persistence | Jobs recovered from Postgres via re-hydration |
| 21 | No container healthchecks | `/health` exists but unused |
| 22 | No DB backup/restore mechanism in repo | UNKNOWN how production handles it |

## Technical Debt

| # | Item | Where |
|---|---|---|
| 23 | `.env.example` stale (FIREBASE_*, no `DATABASE_URL`) | repo root |
| 24 | Legacy Firestore artifacts: `firebase.json`, `firestore.indexes.json`, stale comment in `src/index.ts:156`, `formatFirestoreDate` in `dashboard/src/pages/Payout.tsx` | repo root, src, dashboard |
| 25 | Dead code: `check-reddit.ts` (`isPostDeleted`), `DELETED_DETECTION_THRESHOLD_MS`, `generateCommissionBatchId`, `insightStorageService.deleteTaskDir`, `reviewedAt`/`reviewedBy`/`markReviewed` (unused), `referralRepository.findById` (unused?), `onboardingRepository.hasGuideBeenSent` (unused) | `src/utils`, `src/services`, `src/database` |
| 26 | Duplicate userscript copies (`scripts/` + `dashboard/public/`) must stay in sync | **Now automated for the two GoPartTime scripts** — `userscript-media.test.ts` asserts `scripts/` and `dashboard/public/` are byte-identical. `reddit-format-check.user.js` is still unchecked (its two copies are not covered by any test) |
| 27 | In-memory filtering/sorting in `findCompleted`, `findCompletedOrArchived`, `search` (redditUrl substring), `findByDeliveryMessageId` JSONB scan | `task.repository.ts` |
| 28 | Dashboard unused API fns (`getUpcomingReminders`, `getHealth`, `getExportCsvUrl`, `createReferral`) | `dashboard/src/api/client.ts` |
| 29 | Inconsistent admin checks (Discord-ID `isAdmin` vs username `requireDashboardAdmin`) | routes |
| 30 | JWT carries no roles | `auth.ts` middleware |
| 31 | **Reddit profile check depends on the `RedditSession` vault.** With no cookie stored (or an expired one) every new ticket reports `UNVERIFIABLE` and DMs the approver. Reddit blocks anonymous `.json` access from datacenter IPs (verified 2026-09-28: 403 "You've been blocked by network security"), so there is no anonymous fallback. | `reddit-profile-check.service.ts`, dashboard Settings |
| 32 | **Shadowbanned Reddit accounts are not detected** by the profile check. Reddit exposes suspensions through the API but a shadowban is invisible to every authenticated view; a logged-out 404 is indistinguishable from a typo'd username, so it is reported as `not_found`, never as banned. Catching it would need a Playwright logged-out tab (ruled out as too fragile). | `reddit-profile-check.service.ts` |
| 33 | Profile-check **suspended** verdict is unverified against a live Reddit response (no known-suspended account was available to test). The `ok` and `not_found` paths WERE verified live on 2026-09-28. Failure mode is safe: an unmatched response degrades to `not_found`/`session_expired` + an admin alert, never a wrong "your account is banned". | `reddit-profile-check.service.ts` |
| 35 | `redditSessionService.loadCookie()` **swallows any DB error into `null`**, so a DB failure is indistinguishable from a missing vault. Cannot happen in the app (the DB is initialized at boot) but it made an operator script report `no_session` for every case on 2026-09-28 and nearly caused a bad deploy. Treat a `no_session` verdict outside the app as ambiguous until `initializeDatabase()` is confirmed. | `reddit-session.service.ts` |
| 36 | **Stuck reminder `REM-LIO5I6GP`** (task `POST #792643`, `ticket-0137`, `POST_70H`, `sentAt 2026-08-24`) on a task still in `REMINDER_20_SENT`. Re-hydrated at every boot and logs `Max retries reached`, so it warns on every deploy. Not auto-fixed: cancelling fires the admin overdue alert, which is a staffing decision. | `Reminder` row |
| 34 | **Two long suites flake under full-suite parallel load** — both pass in isolation and the suite as a whole passes on re-run. `image-processor` (~116–148 s, long known) and `worker-isolation` (spins a real Express server; failed 1 of 4 full runs on 2026-09-28, once alongside a "worker process failed to exit gracefully" warning). **Not caused by the profile-check work:** the new suites were run together with `--detectOpenHandles` and leak nothing. Worth `--runInBand` or a per-suite timeout if it becomes a nuisance. The "worker process has failed to exit gracefully" warning still appears on otherwise-green full runs (reproduced on the 2026-10-02 baseline too), so it is not a signal from any recent suite. | `src/__tests__` |
| 37 | **Oversized task videos depend on ffmpeg being installed in the runtime image.** It is added via `apk add ffmpeg` and probed at boot (warns if missing), but a non-Docker/PM2 host without ffmpeg can only deliver videos under 24 MB — anything larger fails the assignment with a compression error instead of a 413. | `utils/video-processor.ts`, `Dockerfile`, `MEDIA.FFMPEG_PATH` |
| 38 | **Video extraction is verified against the pasted task-DOM markup, not the live page.** The `<video poster=…><source src=….mp4>` shape came from the manager's pasted DOM (task #1175361), and the extractor is unit-tested against a stub of exactly that. If GoPartTime changes its media markup, a video could go back to being silently absent until someone notices — there is no server-side assertion that a task actually had media. | `scripts/*.user.js`, `userscript-media.test.ts` |

## Unknown / Unverified (do not assume)

| # | Item |
|---|---|
| 31 | Hosting provider (no reference; "Ubuntu VPS" only in plan.md; **no Oracle Cloud references exist**) |
| 32 | PostgreSQL version / production DB config |
| 33 | Backups, monitoring, alerting in production |
| 34 | Whether production uses Docker (compose present) or PM2 (`ecosystem.config.js` present) — both declared |
| 35 | `sending.md` acceptance checkboxes all unchecked — feature is implemented in code (08-03..08-05); spec was never marked complete |
| 36 | Why `ReferralStatus` has 4 values but only 3 are ever written (`pending`, `qualified`, `active_per_task`; `closed` read in compute logic) |