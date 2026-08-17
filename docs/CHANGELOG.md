# CHANGELOG.md — Project Change Log

> Compiled from git history (68 commits, branch `main`, single author) on 2026-08-11. Dates are commit-author dates. Entries before 2026-07-19 do not exist (initial commit). Grouped by day, newest first. Commit hashes reference `git log`.

## 2026-08-17
### Deployed
- **Submit View manual-task fallback deployed** (`161.118.164.85`) at commit `60a62b8` (app-only rebuild, backup `rtm-backup-20260817-1655-pre-60a62b8.tar.gz`). Verified live for the reported task `POST #688318`: `?step=1` → `POST_20H`, `?step=2` → `POST_70H` (screenshot download 200/70.7 KB), no-step → `POST_20H`. (20h screenshot file itself had already expired via the 30h TTL — uploads from Aug 14 are gone; step-1 download 404s until a newer screenshot exists.)
### Fixed
- **Submit View now resolves manually-created tasks**: the insight endpoint previously 404'd for tasks created via the slash command/dashboard (`POST #688318`, no `source`/`externalTaskId`) because it only matched `(source='goparttime', externalTaskId)`. Now falls back to `buildManualTaskIdCandidates` (`POST #` / `Comment #` / `Post #` / `COMMENT #` + number), accepting only source-less tasks so GoPartTime-linked ones always win. (Reported live: task `POST #688318` had both screenshots on disk but the script alerted "Task not found.")
### Deployed
- Submit View automation deployed to production (`161.118.164.85`) at commit `e0112f2` via git bundle (backup `rtm-backup-20260817-1551-pre-e0112f2.tar.gz`, `docker compose up -d --build`, no DB migration). Verified: health healthy, boot log "All systems online!", userscript v1.2.0 served, endpoint live-tested (task `723770`: step 1 → `POST_20H`, step 2 → `POST_70H`, screenshot download 200/69 KB; 404/400/401 paths OK; expired-screenshot 404 = expected 30h TTL).
### Added
- **GoPartTime Submit View automation**: userscript v1.2.0 ("📊 Submit View" floating button; tracks clicked card buttons `Submit View`/`Available to submit view in …`; fetches the stored Statbot insight screenshot and attaches it to the GoPartTime View dialog's file input via DataTransfer). Backend: read-only `GET /api/v1/goparttime/insight/:externalTaskId?step=1|2` (extension key) + `resolveInsightReminder` (`src/services/goparttime-insight.service.ts`: step 1 = 20h reminder, step 2 = 70h post reminder, no-step fallbacks) + 10 resolver tests. **Deliberately manual**: view-count entry, Submit click, and success verification stay with the manager — no confirm endpoint, no DB/state changes, `messageCreate.ts` untouched. Verified: 129/129 jest tests, typecheck, backend + dashboard builds; both userscript copies SHA-256 byte-identical.

## 2026-08-13
### Deployed
- Re-deployed the two-level referral to production (`161.118.164.85`) at commit `a558f1d` (user commit: migration safety fix + `scripts/restore-accepted.ts` + docs). Safe procedure: backup (`rtm-backup-20260812-pre-redeploy-a558f1d.tar.gz`), git bundle + reset, verified `migration.sql` has zero data statements, applied schema-only migration (`indirectSpecialInviterId` column+index, `per_task_indirect` enum — all `IF NOT EXISTS`), snapshot-verified statuses unchanged (ACCEPTED=0, PENDING=93, 510 reminders), rebuilt images, re-deployed 12 slash commands, health/dashboard/userscript/bot OK, no log errors.
### Fixed
- `prisma/migrations/migration.sql` one-time backfill permanently removed and committed (`a558f1d`, with DANGER comment); the schema-only rule is now enforced in the repo itself, not just on the server.

## 2026-08-12
### Fixed
- **Accepted-tasks regression** (caused earlier same day): the 11:00 deploy re-ran `prisma/migrations/migration.sql`, which still contained the one-time data backfill from the 2026-08-04 Accepted-Tasks cutover (`UPDATE Task SET status='ACCEPTED' ... WHERE status='PENDING'` + `DELETE FROM "Reminder"`). Re-running it reverted all 48 activated GoPartTime tasks to ACCEPTED and deleted their reminders. Fix: removed the backfill from `migration.sql` (local + server, DANGER comment added), added reusable `scripts/restore-accepted.ts`, restored all 48 tasks to PENDING with reminders recreated and scheduled (past-due jobs for deleted tasks are skipped by the worker). Verified: ACCEPTED=0, health OK. New rule: migration.sql is schema-only; data changes belong in versioned one-off scripts.
### Deployed
- Deployed `5797667` (two-level referral) to production `161.118.164.85` via git bundle: DB migration applied (`Referral.indirectSpecialInviterId` + index + `per_task_indirect` enum), `docker compose up -d --build`, 12 slash commands re-deployed; health/dashboard/bot/DB verified.
### Rolled back
- **Rolled back `5797667` to `1a70dbf`** on production the same day: code reset via git bundle, DB reverted (dropped `Referral.indirectSpecialInviterId` column+index; `CommissionKind` recreated without `per_task_indirect` — PG has no `DROP VALUE`, so the enum was recreated via rename → create → alter column → drop), images rebuilt, commands re-deployed. Trigger: reported unexpected Accepted-tasks after deploy; investigation found the 48 ACCEPTED tasks pre-dated the deploy (2026-08-04→08-12, all created before 11:00) — rollback done per request anyway.
### Added
- Two-level referral system: auto-detects when a normal inviter was referred by a special inviter (`indirectSpecialInviterId`). Normal inviter gets ₹100 bonus after 2 tasks, while the upstream special inviter earns indirect per-task commissions (₹20/post, ₹10/comment) on the worker's completed tasks with no one-time bonus. Added `per_task_indirect` `CommissionKind`, DB migration, auto-chain detection, payment flow support, owner-earnings deductions, bot embed indirect label, and dashboard color-coded Indirect badge.
### Changed
- Dashboard Payments page redesign: refactored 1,382-line `Payout.tsx` monolith into 17 modular components in `dashboard/src/pages/payout/`.
- Introduced sub-navigation routing: `/payout/tasks` (Task Payments) and `/payout/commissions` (Commissions) under `PayoutLayout`.
- UI/UX polish: compact segmented-control date filter (Previous/Current/All/Custom), color-accented summary cards, responsive mobile cards for breakdowns, inline accordion expansion for worker and inviter details, and collapsed-by-default history sections.

## 2026-08-11
- Documentation session: created `AGENTS.md` + full `docs/` system (this change log is the only record; no app code changed).

## 2026-08-09
### Added
- Two-level referral feature (`9348d2d`): special inviter gets ₹20/post, ₹10/comment on the recruiter's workers via recruiter links (`ReferralRole` enum, `Referral.role`, `Referral.indirectSpecialInviterId`, new unique index).
### Reverted
- **`ac441e2`** — full revert of the two-level referral. Schema, migration, and code return to single-level referrals. **Current repo state contains no trace of it.**

## 2026-08-05
### Added
- Owner earnings: daily income from added non-deleted tasks, last-7-days table (`874ff60`).
- GoPartTime userscript updated and served from the dashboard; Android setup docs (`0af8cbf`).

## 2026-08-04
### Changed
- GoPartTime: plain task-message copy-link UX, embed updates, goparttime service fixes (`e267974`).

## 2026-08-03
### Added
- GoPartTime extension integration: page-format task IDs (`Post #<id>`/`Comment #<id>`), dashboard copy-link UX (`445e7cf`). Migration append: GoPartTime delivery columns, unique `(source, externalTaskId)`, `ACCEPTED` status, new audit actions, backfill of pending GoPartTime tasks to ACCEPTED.

## 2026-08-02
### Added
- Dashboard Referrals page (`ba2339e`); ticket channel-name normalization, `#ticket-XXXX` resolution (`a246eb8`); edit + delete actions, removed status/type columns, fixed admin guard on referral routes (`b4f7842`).

## 2026-07-27
### Added
- Owner earnings: PIN-protected Danger Zone (`d37daef`, `4d9122e`), full-page `/owner-earnings` route + weekly endpoint (`88d568e`, `c66842f`), daily earnings panel with commission-aware calculation (`e1f2fbe`).
### Removed
- Owner Earnings panel removed (`9dbee0f`) then re-added in revised form (see above; net effect: feature landed).
### Fixed
- Earnings use `createdAt` instead of `updatedAt`; payout worker detail shows created date (`6331318`, `72ef132`, `2e2f83e`).

## 2026-07-26
### Changed (Firestore → PostgreSQL cutover, Phase 4 + 5)
- Phase 4: rewrite all services with repository pattern (`1f01cc2`); 1325 documents imported to PostgreSQL.
- Phase 5: complete cutover (`702520a`) — Firebase runtime removed, health endpoint uses Prisma `SELECT 1`, re-hydration from Postgres.
- Docker: `host.docker.internal` for PostgreSQL (`9a0f751`), server `.env` password (removed hardcoded DATABASE_URL override, `afb2954`), prisma generate order fix in Dockerfile (`dbf4e61`), `initializeDatabase()` in startup (`1df88de`).
- Cleanup: Firebase env vars removed from `env.ts` (`57338de`); export-firestore.ts deleted (`67f15b5`).
### Added
- Archive tasks on pay and when cancelledReason is deleted/deleted_later (`717b4a1`); only archive paid tasks, restore unpaid archived to COMPLETED (`500340a`).
- Payout/commission breakdown refinements: unpaid-only workers (`b7a4ace`, `2ed465b`), paid commissions filtered + batch history (`072aca9`), per-task commissions in initial payout for special inviters (`be9aa03`), all inviters incl. zero (`6889d46`).

## 2026-07-25
### Added
- Referral commission tracking + payout dashboard tab (`1b36416`).
- `/referral add` uses ticket option, auto-detects inviter type (`8584385`).

## 2026-07-24
### Added
- Automated weekly payout management system + CSV exports (`3792396`); favicon + PWA app icon (`b524eff`); PWA (`9287f61`).
### Fixed
- Payout week-boundary calculation, admin check, cancelledReason filter (`fa6d598`); completedAt fallback to task.updatedAt (`5f3281e`).
### Changed
- Navbar redesign (`cda27aa`, `45f55a4`); dynamic navbar title, compact mobile toolbar (`aca51b4`).

## 2026-07-23
### Added
- Insight screenshots saved to disk, served on dashboard, 30h auto-cleanup (`dddd658`); download buttons (`1dc1c23`); per-type + deletion stats (`0a1a73e`, `9f3f8cd`); mobile task cards + image downloader (`1c29e21`).
### Changed
- Auth removed from insight image upload route (`5415407`).

## 2026-07-21
### Changed
- Manual deletion override dropdown replaces auto-detection; weekly Sunday archive; Archives page; 1000-task API limit (`148c75b`).

## 2026-07-20
### Added
- Automatic Reddit deletion detection with early/late reason tracking (`442c84c`); Deleted/Deleted Later status in dashboard Tasks table (`e7472e3`); Activity Log page + audit trail + TaskDetails section (`1df3182`); reminder visual timeline in TaskDetails (`9b4e504`, `c1807e3`).
### Changed
- Mega commit (`d91f4b8`): dashboard column reorder, ticket channel name, encodeURIComponent on task IDs, axios CSV with JWT, API trust proxy, case-insensitive delete/status/find/reschedule, channelName+assignedUserName stored, nginx DNS resolver, REMINDER_DELAYS back to 20h/70h, compose cleanup.

## 2026-07-19
### Added
- Initial commit (`ed82c7a`): Firestore-based Reddit Task Manager (Discord bot + REST API + dashboard scaffolding; `firebase.json`, `firestore.indexes.json`, `firebase-admin`).

---

## Note on History Completeness

- No tags exist; dates are author dates (IST). Pre-2026-07-19 history does not exist.
- Deployment history (when each release reached production) is **not recorded** in the repository — no deployment log exists. `docs/DEPLOYMENT.md` documents the current declared architecture; actual deploy dates are UNKNOWN.