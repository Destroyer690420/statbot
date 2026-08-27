# CHANGELOG.md — Project Change Log

> Compiled from git history (68 commits, branch `main`, single author) on 2026-08-11. Dates are commit-author dates. Entries before 2026-07-19 do not exist (initial commit). Grouped by day, newest first. Commit hashes reference `git log`.

## 2026-08-27
### Deployed
- **Member join welcome deployed** (`161.118.164.85`) at commit `c206c5d` (app-only rebuild, backup `rtm-backup-20260827-193224-pre-c206c5d.tar.gz`). Verified: health healthy (DB+Redis, `All systems online!`), dashboard 200, `dist/bot/events/guildMemberAdd.js` + `dist/bot/index.js` (`GuildMemberAdd` + `GuildMember` partial) wired, `TicketOnboarding` still exists, 155/155 jest pass. No DB migration.
- **Ticket onboarding guide deployed** (`161.118.164.85`) at commit `454fafa` (app-only rebuild + `TicketOnboarding` table, backup `rtm-backup-20260827-190711-pre-454fafa.tar.gz`). Verified: health healthy (DB+Redis, `All systems online!`), dashboard 200, `dist/bot/events/channelCreate.js` + `dist/bot/events/messageCreate.js` wired, `TicketOnboarding` table exists, 155/155 jest pass. Migration `CREATE TABLE IF NOT EXISTS "TicketOnboarding"` via `docker exec` prisma.
- **Ticket auto-welcome deployed** (`161.118.164.85`) at commit `50f4378` (app-only rebuild, backup `rtm-backup-20260827-140805-pre-50f4378.tar.gz`). Verified: health healthy (DB+Redis, `All systems online!`), dashboard 200, `dist/bot/events/channelCreate.js` + `dist/bot/index.js` wired, 155/155 jest pass. No DB migration.
- **Outreach post/comment counts deployed** (`161.118.164.85`) at commit `346fec7` (app + dashboard rebuild, backup `rtm-backup-20260827-104537-pre-346fec7.tar.gz`). Verified: health healthy (DB+Redis, `All systems online!`), dashboard 200, backend `dist/utils/outreach-rows.js` uses `filter().length`, 155/155 jest pass. No DB migration.
### Added
- **Member join welcome**: `src/bot/events/guildMemberAdd.ts` + `src/bot/index.ts` (`GuildMember` partial + `Events.GuildMemberAdd`); on `guildMemberAdd` (every join, bots skipped, immediate) sends in `#invites` (`1520616800063328437`) `hey @user please create your ticket in #verification` (`1520483343018496104`, clickable) `then we can get started`. Constants `INVITES_CHANNEL_ID`, `VERIFICATION_CHANNEL_ID`, `MEMBER_WELCOME_MESSAGE` in `src/config/constants.ts`.
- **Ticket auto-welcome**: `src/bot/events/channelCreate.ts` + `src/bot/index.ts` `channelCreate` listener; on new `TextChannel` sends `Hey, @user Can you please share your reddit profile link?` tagging the opener (constant `TICKET_WELCOME_MESSAGE`). Creator resolved via audit log (`ChannelCreate`, 15 s window, non-bot non-admin) with fallback to single non-bot non-admin `channel.members` (2.5 s delay + 3 s retry); admin/manager and public channels (0 or >1 candidates) are skipped. Persistence: `TicketOnboarding.welcomeSentAt`.
- **Ticket onboarding guide**: `src/bot/events/messageCreate.ts:handleTicketGuide` — on the opener's **first** message (any content) in a new ticket where welcome was sent (`welcomeSentAt` exists, `guideSentAt` is null) and ticket-like (exactly one non-bot non-admin viewer and author is that viewer), sends `TICKET_GUIDE_MESSAGE` with 3 clickable mentions `<#1520466000477163550>`, `<#1520481331773968384>`, `<#1520620297399828571>` — exactly once per `channelId` (`TicketOnboarding.guideSentAt`), old tickets never get the guide.
### Changed
- **Daily Outreach Post/Comment now shows counts** instead of boolean ticks: backend `OutreachRow` `post`/`comment` `boolean` → `number` (`src/utils/outreach-rows.ts` `some` → `filter().length`); frontend `OutreachTicket` `post`/`comment` `boolean` → `number` + new `CountCell` (`dashboard/src/pages/DailyOutreach.tsx`): `0` → `X` (dark), `>0` → green count number; applied to desktop table and mobile cards; `Available` unchanged. Docs updated (`OUTREACH.md`, `API.md`, `FRONTEND.md`). Tests updated + new multi-count case (`post:2 comment:3`).

## 2026-08-21
### Deployed
- **Multi-level indirect referral fix deployed** (`161.118.164.85`) at commit `72e264c` (app-only rebuild; backup `rtm-backup-20260821-181410-pre-72e264c.tar.gz`; no DB migration — schema unchanged). Backfill run on host (host-side `npx prisma generate` first — stale generated client): 42 normal-inviter referrals checked, **9 linked, 0 cleared**; psql-verified chain: `notshagunatp` / `bavish.exe` / `batman_441` all → `indirectSpecialInviterId = 1202294567706316911` (isee_speed). Verified live: health healthy, boot "All systems online!", dashboard 200, no app errors.
### Fixed
- **Multi-level indirect referral attribution** (implemented + verified locally, NOT yet deployed): referral creation checked only ONE level up the invite chain, so below `special → A → B → C → D` only A's invitees were linked to the special inviter; B/C/D's referrals got `indirectSpecialInviterId = null` and the special was never paid per-task commissions on their tasks. Replaced with `resolveIndirectSpecialInviterId(inviterId)` (`commission.service.ts`) — BFS walk of the full ancestor chain via `findByInviteeId`: cycle-safe (visited set), depth cap 10 (`MAX_INDIRECT_CHAIN_DEPTH`), shallowest open special wins on branching chains, closed links skipped without blocking open paths elsewhere. Wired into `createReferral` for normal inviters (covers `/referral add` + dashboard POST). No schema change.
### Added
- **`scripts/backfill-indirect-referrers.ts`**: one-off data repair for rows created before the fix — recomputes `indirectSpecialInviterId` from scratch for every normal-inviter referral (sets correct values AND clears stale ones; only changed rows updated; idempotent). Run manually against prod DB after deploy: `npx tsx scripts/backfill-indirect-referrers.ts`.
- **`src/__tests__/commission-indirect.test.ts`** (10 tests): one/two/four-level chains (the reported isee_speed scenario), no-chain null, all-normal null, closed-link skip + continue, branching shallowest-wins, cycle termination, `createReferral` wiring (stores resolved id; skips detection for direct special inviters). Total suite now 154/154.

## 2026-08-18
### Deployed
- **Outreach mobile button polish deployed** (`161.118.164.85`) at commit `fd69a2d` (dashboard-only rebuild, backup `rtm-backup-20260818-1917-pre-fd69a2d.tar.gz`). Verified: served bundle `index-BslzhJQE.js` contains the compact mobile button classes; health healthy. No backend/DB change.
- **Outreach top toolbar polish deployed** (`161.118.164.85`) at commit `8252e35` (dashboard-only rebuild, backup `rtm-backup-20260818-1913-pre-8252e35.tar.gz`). Verified: served bundle `index-CM53e94s.js` contains the selected-count pill + new toolbar copy; health healthy. No backend/DB change.
- **Redundant page headers removed deployed** (`161.118.164.85`) at commit `d52ee94` (dashboard-only rebuild, backup `rtm-backup-20260818-1903-pre-d52ee94.tar.gz`). Verified: served bundle `index-DuSGd8jY.js` — neither removed string present; health healthy. No backend/DB change.
- **Outreach page shows only selected tickets deployed** (`161.118.164.85`) at commit `27738d4` (dashboard-only rebuild, backup `rtm-backup-20260818-1852-pre-27738d4.tar.gz`). Verified: served bundle `index-Cnk5Q6fj.js` contains the selected-only filter + new empty state; health healthy. No backend/DB change.
- **Daily Worker Outreach deployed** (`161.118.164.85`) at commit `4f1b84c` (app + dashboard rebuild, backup `rtm-backup-20260818-1840-pre-4f1b84c.tar.gz`). Migration applied **manually**: the append block (lines 352–373 of `migration.sql` — `TicketOutreach` + `OutreachSettings` tables, unique index, `OUTREACH_MESSAGE_SENT` enum value) via `prisma db execute --stdin` (the full cumulative file cannot be re-run: initial `CREATE TYPE` is not `IF NOT EXISTS`-guarded). Verified: health healthy (external `statbot.duckdns.org`), bot logged in, `TicketOutreach`/`OutreachSettings` tables live (0 rows), `GET /api/v1/outreach` mounted (401 without token), served bundle `index-B5Ly915_.js`, no log errors.
- **Activity page removal deployed** (`161.118.164.85`) at commit `44df94b` (dashboard-only rebuild, backup `rtm-backup-20260818-1743-pre-44df94b.tar.gz`). Verified: dashboard 200 via `statbot.duckdns.org`, health healthy, served `index-BffsGtZE.js` contains no Activity-page/Activity-Log/audit-logs code; `/activity` now renders the NotFound page (route removed). App + redis containers untouched.
### Removed
- **Dashboard Activity page removed** (frontend-only): deleted `dashboard/src/pages/Activity.tsx`, the `/activity` route (`App.tsx`), the sidebar item + page-title branch + unused `History` icon (`Layout.tsx`), the per-task "Activity Log" card + its query + invalidations (`TaskDetails.tsx`), and the now-unused `getAuditLogs()` client fn (`api/client.ts`). Backend untouched: audit-log writes in all core flows and `GET /api/v1/audit-logs` remain (used for debugging; `/activity` URLs now 404 → NotFound).
### Added
- **Daily Worker Outreach** (dashboard `/outreach` + backend `/api/v1/outreach`): per-ticket daily availability tracking. New tables `TicketOutreach` (one row per ticket channel: `selected` persists across days; `messageSentAt`/`availableAt` = current daily cycle) and `OutreachSettings` (singleton `outreach-message`, configurable text, default = the standard availability message). New `outreach` service + repository, `AuditAction OUTREACH_MESSAGE_SENT`. Flow: manager checks tickets in the Select Tickets modal → Save Selection (persisted) → Send Message broadcasts only to checked tickets → any worker message in a checked ticket after the send marks it **Available** (managers/bots never count; hook in `messageCreate.ts` → `outreachService.onWorkerMessage`). **Post/Comment** columns auto-derive from tasks created today in the channel (existing assignment workflow untouched). Daily cycle is **IST** (`src/utils/ist-time.ts`, +5.5h shift like payout week): at 00:00 IST the Available/Post/Comment state lazily resets to fresh while the selection is remembered. Settings page gained a "Daily Outreach Message" editor card. New pure-function tests (`src/__tests__/outreach.test.ts`: IST boundaries, stale-cycle reset, row builder) — 144/144 total.
### Changed
- **Outreach toolbar buttons compact on mobile** (`fd69a2d`, dashboard-only): Select Tickets / Send Message get `text-[13px] md:text-sm`, `py-2 md:py-2.5`, `px-3 md:px-6`, `gap-1.5 md:gap-2`, icons `w-3.5 md:w-4`; Refresh becomes `p-2 md:p-2.5` with `w-4 md:w-5` icon. Phone buttons are shorter/leaner (fixes "too tall, not wide" look); desktop unchanged. No backend/API change.
- **Outreach page top toolbar polish** (`8252e35`, dashboard-only): header row reworked into `flex-col md:flex-row md:items-center md:justify-between`. Desktop: info block left (selected-count `status-badge` pill + "They will receive the daily message." — or "No tickets selected yet — open Select Tickets to add." when 0) and buttons right, vertically centered. Mobile: info text on top, buttons in a clean full-width row — Select Tickets / Send Message get `flex-1 md:flex-none` (split width evenly on phones), Refresh stays a fixed icon square (`shrink-0`). Old detached "N ticket(s) selected…" note replaced by the pill. No backend/API change.
- **Outreach page shows only selected tickets** (`27738d4`, dashboard-only): the page table/mobile cards now render `tickets.filter(t => t.selected)` — unselected tickets are hidden; the Select Tickets modal still lists ALL tickets so new ones can be checked and appear after Save Selection (unchecking removes them). Redundant "selected" badges removed; empty state: "No tickets selected yet — open Select Tickets to add." No backend/API change.
- **Redundant page headers removed** (`d52ee94`, dashboard-only): Daily Outreach page lost its in-page `h1` "Daily Worker Outreach" + IST subtitle ("Today (IST): … resets at 12:00 AM IST"); Accepted Tasks page lost its `h2` "Accepted Tasks" + "External tasks awaiting activation…" subtitle. Both titles are already rendered by the Layout top bar (`Layout.tsx` branch on `/accepted` → "Accepted Tasks", `/outreach` → "Daily Outreach"); the Accepted page keeps its "N queued" badge (now right-aligned alone). No backend/API change.

## 2026-08-17
### Deployed
- **Reassign ticket-picker modal deployed** (`161.118.164.85`) at commit `0fa702c` (dashboard-only rebuild, backup `rtm-backup-20260817-1915-pre-0fa702c.tar.gz`). Verified: dashboard 200, health healthy, all containers Up.
- **Userscript v1.4.0 deployed** (`161.118.164.85`) at commit `b98bf68` (dashboard-only rebuild, backup `rtm-backup-20260817-1830-pre-b98bf68.tar.gz`). Verified: served `/goparttime-send.user.js` = `@version 1.4.0`, SHA-256 `9BD9776A…` byte-identical to local copies; health healthy.
- **Insight screenshot TTL change deployed** (`161.118.164.85`) at commit `cba8a35` (app-only rebuild, backup `rtm-backup-20260817-1720-pre-cba8a35.tar.gz`). Verified: health healthy, compiled `INSIGHT_TTL_MS = 60` hours, existing screenshots retained.
- **Userscript v1.3.0 preview deployed** (`161.118.164.85`) at commit `138c317` (dashboard-only rebuild, backup `rtm-backup-20260817-1745-pre-138c317.tar.gz`). Verified: served `/goparttime-send.user.js` = `@version 1.3.0`, SHA-256 `97A16E73…` byte-identical to local copies; health healthy. `.gitattributes` (`c277eb0`) pins `*.user.js` to LF so Windows checkouts can't diverge.
### Changed
- **Userscript v1.4.0 — Submit View disabled on phones**: `submitViewEnabled()` (auto: `!isNarrow()`; override storage `gpt_submit_view_enabled`) guards the entire Submit View + preview block — on narrow (≤767px) viewports the `📊 Submit View` button, card tracking, and preview are never created (insights are only submitted from the PC). Send Task and everything else unchanged. New Tampermonkey menu command "📊 Submit View: ON/OFF" flips the override and reloads. Both copies byte-identical (SHA-256); no backend change.
- **Insight screenshot TTL raised 30h → 60h** (`INSIGHT_TTL_MS` in `src/services/insight-storage.service.ts`): GoPartTime Submit View needs the 70h screenshots to stay downloadable while the manager submits view data. Cleanup semantics unchanged (mtime-based, hourly sweep, up to ~1h lag).
- **Userscript v1.3.0 — insight screenshot preview**: `openInsightPreview()` builds `URL.createObjectURL` from the **same Blob** that is attached to the file input (no second download). Floating left-edge panel (`#gpt-insight-preview`): header (step + reminder type + ✕), scrollable image, `− Zoom`/`Zoom +` (0.5×–5×, step 0.25, `transform: scale()`), `Open ↗` full-size blob link; dialog-safe (`pointer-events:auto!important` + `pointerdown` stopPropagation, z-index 2147483647); auto-closes when the view dialog leaves the DOM (1s watcher) or on ✕ (revokes the object URL). Both copies byte-identical (SHA-256); no backend change.
### Deployed
- **Submit View manual-task fallback deployed** (`161.118.164.85`) at commit `60a62b8` (app-only rebuild, backup `rtm-backup-20260817-1655-pre-60a62b8.tar.gz`). Verified live for the reported task `POST #688318`: `?step=1` → `POST_20H`, `?step=2` → `POST_70H` (screenshot download 200/70.7 KB), no-step → `POST_20H`. (20h screenshot file itself had already expired via the 30h TTL — uploads from Aug 14 are gone; step-1 download 404s until a newer screenshot exists.)
### Fixed
- **Dashboard: reassign ticket picker broken on mobile**: `AcceptedTasks.tsx` used an inline `<select>` with `onBlur={() => setTicketFor(null)}` — opening the native OS picker on phones blurs the select, unmounting it before the ticket list could show (PC kept focus, so it worked). Replaced with a proper modal (dark glass-card, same overlay pattern as the PIN modal): tappable `#channelName` rows + busy marker, loading/empty states, ✕ + Cancel, disabled while mutating; used by both the desktop table and mobile cards. No backend change.
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