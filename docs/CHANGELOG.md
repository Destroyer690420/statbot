# CHANGELOG.md — Project Change Log

> Compiled from git history (68 commits, branch `main`, single author) on 2026-08-11. Dates are commit-author dates. Entries before 2026-07-19 do not exist (initial commit). Grouped by day, newest first. Commit hashes reference `git log`.

## Unreleased (implemented 2026-09-10, NOT yet deployed)
### Changed
- **/mystats week-only + /myinvites ticket + capped progress**: `/mystats` card drops the All Time section (This Week only — done posts/comments, paid ₹, pending ~₹). `/myinvites` per-invitee ticket now renders as a clickable `#ticket-name` channel mention (stored `<#channelId>`/raw id/name all normalized; `no ticket yet` when null) instead of a backticked raw id, and the tasks counter caps at the threshold (2/2 stays 2/2 for normal, 1/1 for special). Implementation: `workerStatsEmbed` (All Time field removed), `formatInviteTicket` helper + `inviterStatsEmbed` in `src/bot/embeds/index.ts`, `Math.min(taskCount, threshold)` in `member-stats.service.ts`, help text updated. Tests: 6 new embed cases (15/15 member-stats file, 230/230 total); typecheck + build clean. No DB migration, dashboard untouched.

## 2026-09-09
### Deployed
- **Moderators excluded from worker detection live** (`161.118.164.85`) at commit `dd95aeb` (app rebuild, backup `rtm-backup-20260910-pre-dd95aeb.tar.gz`; pushed to GitHub; `MODERATOR_USER_IDS` appended to server `.env`). All task/outreach/assignment flows filter them via `getAllAdminIds()`; no command privileges. Verified: health healthy, live IDs resolve as moderators, 224/224 jest.
- **Outreach Blast green highlight live** (`161.118.164.85`) at commit `2d10aa1` (app + dashboard rebuild, backup `rtm-backup-20260909-pre-2d10aa1.tar.gz`; pushed to GitHub). Tickets that replied in the current burst render green (Tasks tint language) and sort to the top, desktop + mobile; greens reset on the next burst. Verified: health healthy, 221/221 jest.
- **Outreach Blast live** (`161.118.164.85`) at commit `d3153f3` (app + dashboard rebuild, backup `rtm-backup-20260909-pre-d3153f3.tar.gz`; migration excerpt applied: `OutreachBlast`/`OutreachBlastMessage`/`OutreachReply`; pushed to GitHub `de90191..d3153f3`). Send now asks posts-available `n`; first-n repliers win and the message is deleted from all other tickets; 2-post/day IST cap enforced at send + reply; repeatable anytime. Verified: health healthy, boot clean, 221/221 jest, tables exist.


## Unreleased (hybrid companion flow, deployed `47b79f1`)
### Fixed
- **In-page drawer acceptance fix (v1.0.8)**: `goparttime-auto.user.js` (and byte-identical `dashboard/public/goparttime-auto.user.js`) updated to use the true in-page drawer flow: clicking "Accept Task" on the matching card in `/tasks` opens the modal drawer (`role="dialog"`), extracts full task details (`Task ID`, `Subreddit`, `Title`, `Content` with HTML, `Flair`, `Deadline`, `Payment`), clicks `"Confirm acceptance"`, intercepts the server response (or waits for drawer close), and pushes full details to `/api/v1/goparttime/assign`. Replaces the broken `findNextAction()` regex (which looked for non-existent 64-char hex in raw HTML) and broken card-lookup.
- **Watcher script encoding (deployed `f961f1b`, dashboard rebuild, backup `rtm-backup-20260908-pre-f961f1b.tar.gz`)**: Tampermonkey menu showed mojibake — nginx served `.user.js` with no charset so decoding fell back to Latin-1. Script is now 100% ASCII (v1.0.1) and nginx sends `charset=utf-8`. Verified live via headers + `@version`.
- **Watcher always-on (deployed `4796e34`, dashboard rebuild, backup `rtm-backup-20260908-pre-4796e34.tar.gz`)**: removed the ON/OFF menu toggle; watcher starts with every page load (v1.0.2). Verified served copy has no toggle.
- **Watcher diagnostics (deployed `3a1293d`, dashboard rebuild, backup `rtm-backup-20260908-pre-3a1293d.tar.gz`)**: on-page status pill (green/red with last error), explicit "check API key" message on 401, version constant synced (v1.0.3). Reason: watcher polled with a wrong key (HTTP 401) while the dashboard only said Offline.
- **Key format check (deployed `cff6163`, dashboard rebuild, backup `rtm-backup-20260908-pre-cff6163.tar.gz`)**: Configure dialog validates the 64-hex shape on save and warns immediately on mismatch (v1.0.4). Server key verified byte-for-byte correct — the stored browser copy was mistyped.
- **Rate-limit fix (deployed `a995a38`, full rebuild, backup `rtm-backup-20260908-pre-a995a38.tar.gz`)**: dashboard + watcher from one home IP exceeded 100 req/15min (dashboard alone polled ~14/min). Companion sightings/claims-pending endpoints exempted from the limiter (extension key is the gate); dashboard automation polls slowed to 30–60s; watcher claims loop 30s + 1-min pause on 429 with a clear pill message (v1.0.6).
- **Sightings parse fix (deployed `c1d2d50`, full rebuild, backup `rtm-backup-20260908-pre-c1d2d50.tar.gz`)**: empty sightings table despite live tasks — flight-data regexes expected doubled backslashes (a DevTools-console artifact) while live bytes use one; parsers now tolerate both (verified both ways in Node + jest). Watcher fetches fresh page HTML first (React may strip flight scripts from the live DOM) with DOM fallback, and reports parse diagnostics on zero-task scans (v1.0.7). Stale manual RUNNING test cycles closed.
- **Push visibility + dashboard page removal (deployed `1dee1c1`, full rebuild, backup `rtm-backup-20260909-pre-1dee1c1.tar.gz`)**: task 960827 was claimed on GoPartTime but the companion's detail push never reached the backend (silent failure + `/assign` not rate-limit exempt) while the cycle logged a false ACCEPTED. Fixed: companion reports push outcome, server records NEEDS_PUSH, failed pushes release cleanly, `/assign` exempted from the limiter, no more double bookkeeping; watcher v1.0.9. Automation dashboard page removed per request (backend automation APIs keep running).
- **Auth diagnostics (deployed `7545123`, app rebuild)**: failing extension tokens now log length + truncated sha256 (unreconstructable) to distinguish wrong-value vs missing-header; watcher menu renamed to distinct "Configure Watcher..." (v1.0.5). No backup (tiny change, prior backup current).
- **Auth dispatch fix (deployed `4826d90`, app rebuild, backup `rtm-backup-20260908-pre-4826d90.tar.gz`)**: companion 401 root cause — two routers on `/api/v1/automation` meant the JWT router's `use(auth)` rejected extension-key paths before they reached their router (proven: even the correct key 401'd with JWT logs). Single router with per-path dispatch now; verified correct key → 200, wrong key → 401 + hash log.
### Added
- **Hybrid companion flow (deployed `47b79f1`, app + dashboard rebuild, backup `rtm-backup-20260908-pre-47b79f1.tar.gz`)**: manager-browser watcher (`goparttime-auto.user.js` v1.0.0, served at `/goparttime-auto.user.js`) reports sightings + performs in-page accepts; server validates/matches workers via claim queue (`AutomationSighting`/`AutomationClaim`/`CompanionStatus` tables, migration excerpt applied, no data touched); sighting queue tick (60s) + claim sweeper; dashboard watcher status + pending claims. Verified: health healthy, boot clean incl. sighting queue, script served 200. Reason: Vercel Code 11 hard-blocks all server-side clients (server poller dormant).
### Fixed
- **Chromium-valid cookie flags + vault self-refresh (deployed `f882f2e`, app rebuild, backup `rtm-backup-20260908-pre-f882f2e.tar.gz`)**: `addCookies` sent `__Host-` with a Domain and no `secure` flag — Chromium rejected every scan with `Invalid cookie fields`. Fixed per RFC 6265bis (`__Host-` via URL, no domain; `secure` everywhere) with a clear repaste error; vault now self-refreshes live cookies + Next-Action after each scan (paste-once); save-time validation/sanitization for paste artifacts. Verified: health healthy, boot clean; 8 new cookie tests.
### Fixed
- **CONFIRMED-contact lookup (deployed `f27832e`, app rebuild, backup `rtm-backup-20260908-pre-f27832e.tar.gz`)**: `test-accept` searched only `CONTACTED` rows, so a worker reply (which flips the row to `CONFIRMED`) made acceptance impossible — the exact reported error. Fixed with `findConfirmedContact` (CONFIRMED + unexpired) plus precise errors (expired window vs no reply vs already used); cycle batches now pair only current-window confirmations (Rules 6/7). Verified: health healthy, boot clean.
### Added
- **Dashboard UI fix (deployed `1940026`, dashboard rebuild, backup `rtm-backup-20260908-pre-1940026.tar.gz`)**: Automation page rewritten in the site dark system (`glass-card`/`stat-card`/`btn-primary|secondary|danger`/`input-field`/`status-badge`, desktop table + mobile cards, cycle drill-down, confirm dialog on real accept); sidebar title mapping added. Verified: dashboard 200, health healthy.
### Added
- **Manual single-task test endpoints (deployed `a3670fa`, app + dashboard rebuild, backup `rtm-backup-20260907-pre-a3670fa.tar.gz`)**: `POST /automation/test-contact` (one-ticket Stage-2 message + 5-min contact window, exact-one-worker guard, busy guard) and `POST /automation/test-accept` (requires ACTIVE+CONFIRMED contact, live poller scan, Post/duplicate/blocked validation, real accept only with `accept:true` + `GOPARTTIME_AUTO_ACCEPT=true` + dryRun off, else `WOULD_ACCEPT`); dashboard Automation page gained a Manual Single-Task Test card. Verified: health healthy, boot clean, `/test-contact` 401 without token. Purpose: controlled one-task test (Post #955126 → ticket-0188).

### Added
- **Automated GoPartTime Post acceptance foundation (dry-run default)**: persistent-Chromium poller (`src/services/automation/poller.service.ts`, `playwright-core`, single persistent context `.goparttime/browser-profile`, images/fonts blocked, Vercel checkpoint backoff 1m→5m→15m, accept from inside page context with human 3–8s delay), flight-data parser (`parser.ts`, `sub_task {id,type,status,grab_user_id,task_id,karma,earnings}` + parent `task {subreddit_name,title}`), validator (Post-only / duplicate via `(source,externalTaskId)` / exact-match blocked subreddits), AES-256-GCM session vault (`GOPARTTIME_SESSION_KEY`, `GoPartTimeSession` ciphers, never logged), eligible-gated iterative cycles (`cycle.service.ts`: poll → count x → ping x → 5-min window → accept min(eligible,confirmed) → re-poll, max 6 batches), worker Stage-2 (`worker-manager.service.ts`: outreach-selected pool, 1-active-post guard, 2/day IST cap, `hey @user, should i send a post?` new tagged message, reply correlation in `messageCreate.ts`, earliest-reply-first matching), scheduler (`scheduler.ts`: scans at :00 :10 :11 :20 :30 :40 :50 + jitter, 7/hour, 30s tick), API (`/api/v1/automation/*`: status/settings/start/stop/cycles/blocked/session, JWT+admin), dashboard `Automation` page (status/dry-run controls, blocked editor, session paste, cycle table, sidebar `Bot` icon). Real acceptance additionally gated by `GOPARTTIME_AUTO_ACCEPT=true` (default false). New DB models `BlockedSubreddit`/`AutomationSettings`/`GoPartTimeSession`/`AutomationCycle`/`AutomationContact`/`AutomationTaskLog` + 8 `AuditAction` values (idempotent `migration.sql` block; **apply manually before deploy**). Verified: typecheck clean, 204/204 jest (12 new: subreddit/parser/crypto), backend + dashboard builds clean. `npm i -S playwright-core` (+1 dep). Docs: PROJECT_CONTEXT/GOPARTTIME/DATABASE/API/FRONTEND pending this entry.


## 2026-09-04
### Deployed
- **Self-service /mystats + /myinvites deployed** (`161.118.164.85`) at commit `441fc12` (app-only rebuild, backup `rtm-backup-20260904-073430-pre-441fc12.tar.gz`; commands registered via in-container `node dist/bot/deploy-commands.js` — 14 total). Workers check week + all-time tasks (posts/comments), completed/in-progress, paid ₹ (actual) vs pending ~₹ (COMPLETED-only, current rates); inviters see per-invitee ticket, X/threshold progress, bonus paid/pending + commission totals. Public replies for ticket use; optional `user` lookup gated to admins/managers. Verified: health healthy (DB+Redis), boot "All systems online!" + bot login + invite snapshot, compiled `mystats`/`myinvites`/`member-stats` in `dist/`, 194/194 jest pass (9 new). No DB migration, dashboard untouched.
### Added
- **Worker/inviter self-service commands**: new `memberStatsService` (`getWorkerStats`/`getInviterStats`) + pure `utils/member-stats.ts` (`buildWorkerStats`: paid = item in paid batch, pending = done-but-unpaid at current rates, cancelled excluded, week filter by completion time); new repo queries `findAllByWorkerId`, `findItemsByWorkerId`; embeds `workerStatsEmbed`/`inviterStatsEmbed`; commands wired into `deploy-commands.ts` + `interactionCreate.ts` + `help.ts`. Tests: 9 new `member-stats` cases. Docs: DISCORD_BOT updated (14 commands).
- **Outreach worker tagging deployed** (`161.118.164.85`) at commit `7a59efd` (app + dashboard rebuild, backup `rtm-backup-20260904-061828-pre-7a59efd.tar.gz`). `POST /api/v1/outreach/send` now mentions each ticket's worker (`{user}` → `<@workerId>`; prepend fallback; untagged + warn on unknown worker). Verified: health healthy (DB+Redis), boot "All systems online!", compiled `formatOutreachMessage` + new default live in `dist/`, dashboard 200 with bundle `index-DmgAvYSt.js` (hash matches local build, hint text present), 185/185 jest pass. No DB migration, no slash-command redeploy. Bundles + host scratch cleaned.
### Added
- **Daily outreach tags the worker**: `POST /api/v1/outreach/send` now mentions the ticket's worker in every sent message. New pure `formatOutreachMessage(message, workerId)` (`src/utils/outreach-rows.ts`, re-exported by the service): `{user}` placeholders → `<@workerId>` (all occurrences); messages without the placeholder get the mention prepended (previously saved custom texts tag with no dashboard edit); unknown worker sends untagged + warn, never fails the channel. `sendMessage` warms the guild member cache, then resolves each ticket's worker with the same first-non-bot-non-admin rule as the Worker column. Default message updated to `Hey {user}, I have got a post and a comment for you…`; Settings page gained a "`{user}` tags the worker" hint. Tests: 5 new `formatOutreachMessage` cases (19/19 outreach file, 185/185 total). No DB migration.

## Unreleased (implemented 2026-09-03, NOT yet deployed)
### Added
- **Referral editing by IDs + pending-invite editing**: `PATCH /commissions/referrals/:id` now accepts `inviterId`/`inviteeId` (snowflake-validated) alongside names + ticket — an inviter change re-derives special/normal type from the hardcoded list and recomputes `indirectSpecialInviterId` via the full chain walk (pair stays unique, keep-first). New `PATCH /commissions/invite-detections/:id` edits pending rows (set the inviter on unknown/backfilled rows before approving). Dashboard Referrals edit modal gained Inviter/Invitee ID fields; Pending Invites rows gained an Edit (pencil) modal. Tests: 5 new `updateReferral` cases + 3 new `updateDetection` cases (176/176 total).

## 2026-09-03
### Deployed
- **Inviter auto-fill deployed** (`161.118.164.85`) at commit `7a4dc76` (app-only rebuild, no migration, no command redeploy). Saving a pending invite with an inviter ID + empty name now auto-fills the current Discord display name server-side (bot-token REST lookup, best-effort); Approve falls back the same way. Verified: compiled code live, live REST lookup as the bot resolves a real user, health healthy, boot "All systems online!". Tests: 4 new auto-fill cases (20/20 invite suite).
- **Invite auto-detection approval queue deployed** (`161.118.164.85`) at commits `ca4471e` + `e60ed28` (app + dashboard rebuild, backup `rtm-backup-20260903-ca4471e.tar.gz`). Migration applied as an excerpt (`InviteDetection` table + 3 `AuditAction` values; full-file re-run avoided per the 2026-08-12 rule). Backfill `--since 2026-08-29` run on host: 49 members joined → **49 staged (31 with ticket)**, inviters unknown. Follow-up `e60ed28` fixed `schema.prisma` missing the `INVITE_*` enum values (first build staged rows but dropped their audits non-fatally) + repair script inserted the 49 missing `INVITE_DETECTED` audits. Verified: health healthy (DB+Redis), boot "All systems online!" + "Invite tracker: snapshot complete", dashboard 200, task counts unchanged (149/6/17/7/55/366). No slash-command redeploy. Bundles + host scratch cleaned.

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