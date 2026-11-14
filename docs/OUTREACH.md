# OUTREACH.md — Daily Worker Outreach

Verified 2026-08-18 — **deployed** (`4f1b84c` live on `161.118.164.85`; tables applied, route mounted, verified).
Blast campaigns added 2026-09-09 — **deployed** (`d3153f3` live; `OutreachBlast`/`OutreachBlastMessage`/`OutreachReply` tables applied, verified).
Worker Portal access column added 2026-09-25 — **deployed** at `675c618` (code `0122775`): `WorkerPortalAccess` table applied to production (empty, no backfill) + admin Daily Outreach indicator live.
Default message copy changed 2026-10-24 (post-only, no comment) — **deployed** at `1f88575`; no stored `OutreachSettings` override existed, so the new default is live.
Per-ticket `dailyPostLimit` enforcement fixed end-to-end 2026-11-08 — **deployed at `de34626`** (backend-only app rebuild, no migration): `GET /outreach` returns the stored limit (the dropdown no longer snaps back to 2) and blast send, blast reply acceptance, burst claim intake, the failed-claim retry path and `/automation/rehearse` all honour the ticket's limit instead of hardcoded 2.
Explicit **Yes / No availability buttons** added 2026-11-14 — app-only rebuild; **no migration, no env change**. The blast message now carries two buttons, and only the Yes button can mark a worker Available or win a blast slot. A normal text message (including an insight screenshot) never claims a post; it gets one short nudge per round pointing at the button instead. See §11.

## 1. What It Is

A per-ticket-channel daily availability tracker, surfaced as the **Daily Outreach** dashboard page (`/outreach`).
Manager workflow per day:
1. Opens `/outreach` — the table lists **only the tickets selected on previous days** (selection is remembered; unselected tickets are hidden).
2. Checks/unchecks tickets in the **Select Tickets** modal (lists ALL tickets with their current state) → Save Selection — newly checked tickets appear on the page, unchecked ones disappear.
3. Clicks **Send Message** — the configurable daily message plus **Yes / No** buttons is posted by the bot into each checked ticket.
4. When the worker taps **Yes**, **Available** flips to ✅ and the ticket wins a blast slot. Tapping **No**, staying silent, or sending a normal message claims nothing.
5. **Post/Comment** columns reflect tasks created in the channel today (IST), derived from the Task table — nothing manual.

Daily cycle = IST day. At **00:00 IST** the Available/Post/Comment state lazily resets to a fresh day while the ticket selection is remembered.

## 2. Time Model (`src/utils/ist-time.ts`)

- `IST_OFFSET_MS = 5.5h`; IST day boundaries computed the same way payout weeks are (`owner-earnings.service.ts` pattern): `getIstDayBoundaries(now)` → `{ dayStart, dayEnd, dayKey }` where `dayKey = 'YYYY-MM-DD'` in IST.
- Example: `2026-08-18T18:00:00.000Z` → `dayStart 2026-08-17T18:30:00.000Z`, `dayEnd 2026-08-18T18:30:00.000Z`, `dayKey '2026-08-18'`.
- `isStaleDailyCycle(messageSentAt, now)` → `messageSentAt == null || messageSentAt < dayStart` (pure, tested).

## 3. Data Model

### `TicketOutreach` (one row per ticket channel)

| Field | Meaning |
|---|---|
| `id` | PK |
| `channelId` | Discord channel ID, **unique** |
| `selected` | Checked in the Select Tickets modal — **or via the `add to daily outreach` button** on a passed profile check (see below); **never auto-reset** |
| `messageSentAt` | Last successful daily send (cycle-scoped) |
| `availableAt` | First worker message of the cycle (cycle-scoped) |
| `updatedAt` | — |

### `WorkerPortalAccess` (one row per ticket channel)

| Field | Meaning |
|---|---|
| `channelId` | Discord ticket channel ID, **primary key** — access is tracked per ticket, not per worker |
| `workerId` | Worker who most recently completed ticket-OTP login from this ticket |
| `firstSeenAt` | First successful Worker Portal login from this ticket; never changed by later logins |
| `lastSeenAt` | Most recent successful Worker Portal login from this ticket |
| `updatedAt` | — |

A successful OTP verification upserts this row once. The write is best-effort: a tracking failure logs a warning but never fails login. There is no historical backfill; tickets used before 2026-09-25 remain untracked until the next successful login.

### `OutreachSettings` (singleton `id = 'outreach-message'`)

| Field | Meaning |
|---|---|
| `message` | Daily broadcast text (1–2000 chars; default `DEFAULT_OUTREACH_MESSAGE` in `src/config/constants.ts`: `'Hey {user}, I have got a post for you. wanna do it? message me once you are free'`) |
| `updatedAt` / `updatedBy` | audit trail of edits |

Migration: `CREATE TABLE IF NOT EXISTS` for the outreach tables + `CREATE UNIQUE INDEX IF NOT EXISTS` + `ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'OUTREACH_MESSAGE_SENT'`; Worker Portal access adds an idempotent `WorkerPortalAccess` table block (2026-09-25, applied in production at `675c618`) — all appended to `prisma/migrations/migration.sql` (idempotent, applied manually per Decision 2).

## 4. Status Semantics (service + row builder)

`buildOutreachRows` (`src/utils/outreach-rows.ts`, pure/tested) computes per ticket:

| Column | Rule |
|---|---|
| `taskStatus` | `active` = any task today; `awaiting-submission` = any task not yet submitted (derived); else `idle` |
| `workerName` | first non-bot, non-admin guild member (cached via `resolveWorkerNames`) |
| `selected` | stored |
| `messageSentAt` | stored (null → Send Message enabled) |
| `available` | `availableAt != null` AND set in the current cycle (i.e. after today's send). Set **only** by an explicit Yes button click. |
| `post` / `comment` | **counts** of tasks of that type with `createdAt` inside today's IST window (any status — the manager decides what counts). `0` → cross, `>0` → count number |
| `dailyPostLimit` | stored per-ticket daily post allowance (`TicketOutreach.dailyPostLimit`, default 2). 2 posts per Reddit ID: 1 ID → 2, 2 IDs → 4, 3 IDs → 6, … |
| `portalAccessed` | `true` when `WorkerPortalAccess` has a row for this ticket (ever completed a successful portal login from it); independent of the daily outreach cycle |
| `portalLastSeenAt` | ISO timestamp of that ticket's most recent successful portal login; never resets at midnight |
| `stale` | cycle needs reset (see §2) — GET re-applies the reset lazily |

## 5. Backend

- **Service** `src/services/outreach.service.ts`: `getStatus(client)` (+ open-blast state; returns each ticket's stored `dailyPostLimit`), `saveSelection(selections)`, `sendBlast(client, slotsTotal, senderId)` (new blast per send; skips tickets whose worker reached that ticket's `dailyPostLimit` or that have no worker, records message IDs; sends the message with the Yes/No component row; audit `OUTREACH_MESSAGE_SENT`), `onAvailabilityClaim(channelId, workerId, client, expectedBlastId)` (explicit **Yes**: validates the exact blast is still OPEN and messaged this ticket, marks Available, re-checks the per-ticket limit and busy ticket, records the slot and fires the burst/escalation hook; returns a typed outcome), `onAvailabilityDecline(...)` (explicit **No**: validates the same way, records nothing), `onWorkerTextMessage(channelId, writerId, client)` (plain message: **never claims**; one nudge per ticket per round pointing at the buttons), `countPostsAssignedToday` (per-ticket `dailyPostLimit` basis, default 2), `getMessage` / `updateMessage` (OutreachSettings).
- **Repositories** `src/database/repositories/outreach.repository.ts` (Prisma, upserts/transactions; blast/message/reply CRUD) and `worker-portal-access.repository.ts` (per-ticket `recordSuccessfulLogin` upsert + `findAll`).
- **Button handler** `src/services/outreach-availability.service.ts` + pure helpers in `src/utils/outreach-availability.ts` (custom-id build/parse, component row, nudge text, worker rule). Routed in `interactionCreate.ts` on the `outreach_avail:` prefix before the `blast:` branch. Only the ticket's worker (first non-bot, non-admin member) can answer; admins see an ephemeral refusal and the worker's buttons are untouched. The message's buttons are removed and the decision appended after the answer.
- **Routes** `src/api/routes/outreach.ts` (factory `createOutreachRoutes(discordClient)`; all `requireDashboardAdmin` — middleware extracted to `src/api/middleware/auth.ts`, shared with discord routes):
  - `GET /api/v1/outreach` → `{ istDate, message, tickets[], blast }`
  - `PUT /api/v1/outreach/selection` `{ selections: [{channelId, selected}] }` (max 500)
  - **Not an API route:** the same `selected` write is also reachable from Discord via the `add to daily outreach` button on the approver DM for a passed profile check. It calls `outreachRepository.upsertSelection` directly (`src/services/outreach-selection.service.ts`), not this endpoint — see `docs/DISCORD_BOT.md` §5.1. Approver/admin only, idempotent.
  - `POST /api/v1/outreach/send` `{ slots: 1..500 }` → `{ blast, sent[], skipped[] }`
  - `GET/PUT /api/v1/outreach/settings` `{ message }`
- **Bot hook** `src/bot/events/messageCreate.ts`: `outreachService.onWorkerTextMessage` runs first; managers/bots excluded via `getAllAdminIds()`; failures swallowed (logging only). It never marks Available and never records a reply.

## 6. Dashboard (`dashboard/src/pages/DailyOutreach.tsx`)

- Route `/outreach`; sidebar item **Daily Outreach** (`Users` icon) between Accepted and Archives; title branch in `Layout.tsx`.
- Table (desktop) + cards (mobile, Tasks pattern); columns Ticket | Worker | **Post** | **Daily Limit** | Action. **Rows = selected tickets only** (`tickets.filter(t => t.selected)` — the API returns all tickets with their `selected` flag; the modal needs the full list to add new ones). **Daily Limit** is an optimistic-save dropdown (`2 posts (1 ID)`, `4 posts (2 IDs)`, `6 posts (3 IDs)`, … up to 12) backed by `PUT /outreach/tickets/:channelId/limit`; the saved value is returned by `GET /outreach` so it survives refreshes.
- Toolbar: `Select Tickets` (checkbox modal — first checkboxes in the app, `accent-primary-500`; lists all tickets with current state; draft until **Save Selection** → `PUT /outreach/selection`), `Send Message` (slots prompt modal → `POST /outreach/send {slots}`; inline ✅/❌ result + skipped note), Refresh.
- Blast banner (when a blast is OPEN): `x/y replied`, auto-updates every 30s.
- Burst-reply highlight: tickets that replied in the current burst render green (Tasks-section tint language) and sort to the top, desktop + mobile; greens reset on the next burst (`blastReplied` from `GET /outreach`).
- Auto-refresh every 30s (`refetchInterval`); subtitle shows today's IST date.
- Settings page: **Daily Outreach Message** card (textarea, ≤2000 chars, Save → `PUT /outreach/settings`; supports the `{user}` tag placeholder — hint shown under the box).
- Client fns in `dashboard/src/api/client.ts`: `getOutreach`, `getOutreachSettings`, `updateOutreachSettings`, `saveOutreachSelection`, `sendOutreachMessage`, `deleteOutreachTicket`, `updateOutreachTicketLimit`.

## 6b. Worker tagging in the sent message

- `sendMessage` resolves each ticket's worker (first non-bot, non-admin in `channel.members` — same rule as the Worker column; members fetched once per guild beforehand) and formats the text with `formatOutreachMessage` (`src/utils/outreach-rows.ts`, pure/tested, re-exported by the service).
- `{user}` in the message is replaced with `<@workerId>` (all occurrences); messages without the placeholder get the mention **prepended**, so previously saved custom texts start tagging with no dashboard edit; unknown worker (left server / not cached) sends the message untagged + `logger.warn`, never fails the channel.
- Default message is `Hey {user}, I have got a post for you. wanna do it? Tap Yes if you want it.` (`DEFAULT_OUTREACH_MESSAGE`); the stored `OutreachSettings` copy wins when customized. The buttons are added by the code, not the copy, so old saved texts keep working — but a saved text that tells workers to "reply" should be edited in Settings, because a normal reply no longer claims.
- Every message carries one action row: **✅ Yes** (green) and **❌ No** (grey), custom ids `outreach_avail:<blastId>:yes|no`.

## 7. Tests

`src/__tests__/outreach.test.ts` (pure functions only — importing the service would pull env/DB): IST boundary math, `isStaleDailyCycle`, `buildOutreachRows` (selection, availability gating, per-ticket portal access, post/comment derivation, no-tickets case), `formatOutreachMessage` (placeholder replaced, all occurrences, prepend fallback, null worker). `src/__tests__/worker-portal-access.test.ts` covers repository upsert/select behavior.
`src/__tests__/outreach-blast.test.ts`: slot-winner math (`isSlotWinner`), close condition (`isBlastFull`), cap boundary (`isAtDailyCap`).
`src/__tests__/blast-send-equivalence.test.ts`: send/skip classification, stop-the-send, hook routing, keeper cleanup, **per-ticket `dailyPostLimit` enforcement** (a 4-post ticket is still messaged at 2 posts today, skipped at 4 with reason `worker at daily cap (4/4)`, and the reply path accepts at 2 / ignores at 4), plus `getStatus` returning the saved limit instead of always 2. `src/__tests__/perf-batch-a.test.ts` pins `buildOutreachRows` equivalence including `dailyPostLimit`.

## 8. Limitations / Notes

- Availability = **an explicit Yes button click** on that round's availability message. A plain text message, screenshot or reminder reply never marks Available and never claims; while the round is open the worker is nudged once to tap the button.
- Blast shortfall stays open: if fewer than `slotsTotal` workers tap Yes, late Yes clicks still count until the next Send (which supersedes) or day end.
- A worker hitting their ticket's `dailyPostLimit` (default 2) after tapping Yes stops consuming slots; capped workers get an ephemeral reason and their buttons are removed.
- A Yes on a round that is no longer OPEN, or on a message that round never sent into that ticket, is refused as "already ended" — an old message can never win a newer round.
- Pressing No removes the buttons and records nothing; the slot stays free for other workers and the worker is not marked Available.
- `selected` is remembered forever unless changed; the manager must actively uncheck. The Discord button only ever sets it to `true` — removing a ticket is still a dashboard action.
- Portal access is per ticket, updates only on successful ticket-OTP login, and has no historical backfill; the tick means "has logged in from this ticket", never "currently online".

## 9. Blast campaigns (2026-09-09)

- Each **Send Message** asks posts-available `n` and opens an `OutreachBlast` (`slotsTotal=n`, `OPEN`); a newer send auto-closes any open blast (its messages stay — only the new blast auto-cleans).
- Sends skip tickets with no worker and workers already at their ticket's `dailyPostLimit` for assigned Posts today IST (default 2; a ticket set to 2 IDs = 4 posts keeps receiving outreach until 4); skips are reported inline.
- First-n **Yes clicks** win (one slot per channel; per-ticket limit re-checked at click time). On fill the blast closes and the bot deletes **its own** outreach message from all other contacted tickets (best-effort; hand-deleted messages are skipped, winners keep theirs).
- Repeatable anytime; limit resets 00:00 IST. Tables: `OutreachBlast`, `OutreachBlastMessage` (message IDs for deletion), `OutreachReply` (unique per blast+channel; one row per winning Yes). Pure helpers in `src/utils/outreach-blast.ts`.

## 10. Daily 7am IST ban scan (2026-10-14 — DEPLOYED live at `79420af`; app rebuild only, no migration)

- **What**: every ticket with `TicketOutreach.selected = true` gets its stored `TicketOnboarding.profileUsername` re-checked once a day at **07:00:05 IST** (`src/services/outreach-ban-scan.service.ts` + pure planner `outreach-ban-scan-plan.ts`, self-rescheduling `setTimeout` chain like the hourly trigger, exactly-once per IST day key, started/stopped in `src/index.ts`). No cron, no queue, no new table.
- **Suspension-only.** `suspended` → remove (`selected = false`) + stamp `BANNED` (non-terminal, so a re-shared link re-checks) + worker DM naming `u/name` with the replacement bars (14+ days old, 50+ karma, share the new link in the ticket; closed-DM fallback posts it in the ticket) + owner tag in the ticket (`<@OWNER> ⚠️ u/name is banned — removed…`) + `OUTREACH_MESSAGE_SENT` audit (reused enum, no migration) + one admin summary DM (counts + session warning). `ok` → nothing. `not_found` / `no_session` / `session_expired` / `rate_limited` / `error` → skip, never remove (`not_found` covers shadowban ambiguity — removing on it would drop healthy workers on typos).
- **Missing username** (selected ticket, no stored profile) → in-ticket ask tagging the worker (`formatMissingProfileAskMessage`), so the next scan has something to check. No worker resolvable → skipped, never tagged blindly.
- **Re-entry**: the banned worker shares a new link in their ticket → normal `handleTicketProfileFlow` lookup runs (BANNED is actionable since this feature) → live + 50 karma + 14d age → `PASSED` + approver DM + button; too young / low karma → `LOW_KARMA` line naming the missed bar.
- **Ops**: vault session missing/expired → nobody removed for those tickets; admin DM carries the session warning. Best-effort per ticket (one bad channel never aborts the sweep); `runOutreachBanScan` never throws. Tests: `outreach-ban-scan-plan` (timing), `outreach-ban-scan-age` (eligibility/messages), `outreach-ban-scan` (sweep decisions).

## 11. Availability buttons (Yes / No) — 2026-11-14

**Problem.** Availability used to be "any worker message after the send". A worker uploading an insight screenshot — or just saying anything — silently won a slot and a post they never asked for, which then sat unfinished. Workers who did not want that post had no way to decline.

**Now.** Every availability message is sent with an action row: **✅ Yes** and **❌ No** (`outreach_avail:<blastId>:yes|no`).

| Action | Effect |
|---|---|
| **Yes** | Marks the ticket Available, re-checks the daily limit and busy-ticket guard, records one `OutreachReply` slot, fires the burst/escalation hook (which hands out the post), closes + cleans up on fill. Buttons removed, message gets `✅ <@worker> is taking this post.` |
| **No** | Records nothing, consumes no slot, does not mark Available. Buttons removed, message gets `❌ <@worker> passed on this post.` The slot stays open for other workers. |
| **Silence** | Nothing. No slot, no post, no Available flag. |
| **Plain text / screenshot** | Never claims. If the round is open in that ticket the worker gets **one** nudge per round pointing at the Yes button. |

Implementation notes:

- `sendBlastMessages` attaches the component row to every blast message (manual outreach sends, automatic bursts and escalation re-blasts all use it).
- `onAvailabilityClaim(channelId, workerId, client, expectedBlastId)` resolves the **exact** blast named in the custom id, requires it to be `OPEN`, and requires that blast to have messaged this ticket. An old message's buttons can therefore never win a newer round, even if message cleanup failed.
- Outcomes are typed so the worker gets a clear ephemeral reason instead of silence: `claimed`, `claimed_no_post`, `already_claimed`, `daily_cap` (with `assignedToday/dailyLimit`), `ticket_busy`, `no_open_blast`, `wrong_blast`, `stale_cycle`, `not_selected`, `no_message_sent`, `admin`, `error`. Every non-claim path removes the buttons so nobody keeps tapping a dead request.
- Only the ticket's worker (the same first non-bot, non-admin member used to address the message) can answer. Admins/managers/other members get an ephemeral refusal and the message is left untouched.
- The `No` decision is intentionally not persisted (no schema change): the buttons are gone, and the slot simply remains available. A worker cannot change their mind on that message; a later round's message asks again.
- `messageCreate` no longer calls the old claim path. `onWorkerTextMessage` only nudges (bounded `Map<channelId, blastId>`, so one nudge per round per ticket) and returns immediately when the round is closed.
- No migration, no env change. Tests: `src/__tests__/outreach-availability.test.ts` (custom ids, components, worker rule, nudge copy), `blast-send-equivalence.test.ts` (component row on send, stale/wrong-round refusal, daily-cap outcome, no-post outcome, one-nudge behaviour), `interaction-create-buttons.test.ts` (routing).