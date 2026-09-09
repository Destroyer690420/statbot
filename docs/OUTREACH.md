# OUTREACH.md — Daily Worker Outreach

Verified 2026-08-18 — **deployed** (`4f1b84c` live on `161.118.164.85`; tables applied, route mounted, verified).
Blast campaigns added 2026-09-09 — **deployed** (`d3153f3` live; `OutreachBlast`/`OutreachBlastMessage`/`OutreachReply` tables applied, verified).

## 1. What It Is

A per-ticket-channel daily availability tracker, surfaced as the **Daily Outreach** dashboard page (`/outreach`).
Manager workflow per day:
1. Opens `/outreach` — the table lists **only the tickets selected on previous days** (selection is remembered; unselected tickets are hidden).
2. Checks/unchecks tickets in the **Select Tickets** modal (lists ALL tickets with their current state) → Save Selection — newly checked tickets appear on the page, unchecked ones disappear.
3. Clicks **Send Message** — the configurable daily message is posted by the bot into each checked ticket.
4. As workers reply in their tickets, **Available** flips to ✅ automatically (first worker message after the send).
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
| `selected` | Checked in the Select Tickets modal; **never auto-reset** |
| `messageSentAt` | Last successful daily send (cycle-scoped) |
| `availableAt` | First worker message of the cycle (cycle-scoped) |
| `updatedAt` | — |

### `OutreachSettings` (singleton `id = 'outreach-message'`)

| Field | Meaning |
|---|---|
| `message` | Daily broadcast text (1–2000 chars; default `DEFAULT_OUTREACH_MESSAGE` in `src/config/constants.ts`: `'Hey, I have got a post and a comment for you. wanna do it? message me once you are free'`) |
| `updatedAt` / `updatedBy` | audit trail of edits |

Migration: `CREATE TABLE IF NOT EXISTS` × 2 + `CREATE UNIQUE INDEX IF NOT EXISTS` + `ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'OUTREACH_MESSAGE_SENT'` — appended to `prisma/migrations/migration.sql` (idempotent, applied manually per Decision 2).

## 4. Status Semantics (service + row builder)

`buildOutreachRows` (`src/utils/outreach-rows.ts`, pure/tested) computes per ticket:

| Column | Rule |
|---|---|
| `taskStatus` | `active` = any task today; `awaiting-submission` = any task not yet submitted (derived); else `idle` |
| `workerName` | first non-bot, non-admin guild member (cached via `resolveWorkerNames`) |
| `selected` | stored |
| `messageSentAt` | stored (null → Send Message enabled) |
| `available` | `availableAt != null` AND set in the current cycle (i.e. after today's send) |
| `post` / `comment` | **counts** of tasks of that type with `createdAt` inside today's IST window (any status — the manager decides what counts). `0` → cross, `>0` → count number |
| `stale` | cycle needs reset (see §2) — GET re-applies the reset lazily |

## 5. Backend

- **Service** `src/services/outreach.service.ts`: `getStatus(client)` (+ open-blast state), `saveSelection(selections)`, `sendBlast(client, slotsTotal, senderId)` (new blast per send; skips capped/worker-less tickets, records message IDs; audit `OUTREACH_MESSAGE_SENT`), `onWorkerMessage(channelId, authorId, client)` (daily Available + first-n blast replies, close + bulk delete on fill, cap re-check at reply), `countPostsAssignedToday` (2-post IST cap basis), `getMessage` / `updateMessage` (OutreachSettings).
- **Repository** `src/database/repositories/outreach.repository.ts` (Prisma, upserts/transactions; blast/message/reply CRUD).
- **Routes** `src/api/routes/outreach.ts` (factory `createOutreachRoutes(discordClient)`; all `requireDashboardAdmin` — middleware extracted to `src/api/middleware/auth.ts`, shared with discord routes):
  - `GET /api/v1/outreach` → `{ istDate, message, tickets[], blast }`
  - `PUT /api/v1/outreach/selection` `{ selections: [{channelId, selected}] }` (max 500)
  - `POST /api/v1/outreach/send` `{ slots: 1..500 }` → `{ blast, sent[], skipped[] }`
  - `GET/PUT /api/v1/outreach/settings` `{ message }`
- **Bot hook** `src/bot/events/messageCreate.ts`: `outreachService.onWorkerMessage` runs first (now with `message.client` for deletions); managers/bots excluded via `getAllAdminIds()`; failures swallowed (logging only).

## 6. Dashboard (`dashboard/src/pages/DailyOutreach.tsx`)

- Route `/outreach`; sidebar item **Daily Outreach** (`Users` icon) between Accepted and Archives; title branch in `Layout.tsx`.
- Table (desktop) + cards (mobile, Tasks pattern); columns Ticket | Worker | Available | Post | Comment. **Rows = selected tickets only** (`tickets.filter(t => t.selected)` — the API returns all tickets with their `selected` flag; the modal needs the full list to add new ones).
- Toolbar: `Select Tickets` (checkbox modal — first checkboxes in the app, `accent-primary-500`; lists all tickets with current state; draft until **Save Selection** → `PUT /outreach/selection`), `Send Message` (slots prompt modal → `POST /outreach/send {slots}`; inline ✅/❌ result + skipped note), Refresh.
- Blast banner (when a blast is OPEN): `x/y replied`, auto-updates every 30s.
- Auto-refresh every 30s (`refetchInterval`); subtitle shows today's IST date.
- Settings page: **Daily Outreach Message** card (textarea, ≤2000 chars, Save → `PUT /outreach/settings`; supports the `{user}` tag placeholder — hint shown under the box).
- Client fns in `dashboard/src/api/client.ts`: `getOutreach`, `getOutreachSettings`, `updateOutreachSettings`, `saveOutreachSelection`, `sendOutreachMessage`.

## 6b. Worker tagging in the sent message

- `sendMessage` resolves each ticket's worker (first non-bot, non-admin in `channel.members` — same rule as the Worker column; members fetched once per guild beforehand) and formats the text with `formatOutreachMessage` (`src/utils/outreach-rows.ts`, pure/tested, re-exported by the service).
- `{user}` in the message is replaced with `<@workerId>` (all occurrences); messages without the placeholder get the mention **prepended**, so previously saved custom texts start tagging with no dashboard edit; unknown worker (left server / not cached) sends the message untagged + `logger.warn`, never fails the channel.
- Default message is `Hey {user}, I have got a post and a comment for you. wanna do it? message me once you are free` (`DEFAULT_OUTREACH_MESSAGE`); the stored `OutreachSettings` copy wins when customized.

## 7. Tests

`src/__tests__/outreach.test.ts` (pure functions only — importing the service would pull env/DB): IST boundary math, `isStaleDailyCycle`, `buildOutreachRows` (selection, availability gating, post/comment derivation, no-tickets case), `formatOutreachMessage` (placeholder replaced, all occurrences, prepend fallback, null worker). 19 tests; suite total 185.
`src/__tests__/outreach-blast.test.ts`: slot-winner math (`isSlotWinner`), close condition (`isBlastFull`), cap boundary (`isAtDailyCap`).

## 8. Limitations / Notes

- Availability = **any** worker message after the send (not strictly a reply to the broadcast).
- Blast shortfall stays open: if fewer than `slotsTotal` reply, late replies still count until the next Send (which supersedes) or day end.
- A worker hitting the 2-post cap after replying stops consuming slots; capped repliers never count.
- `selected` is remembered forever unless changed; the manager must actively uncheck.

## 9. Blast campaigns (2026-09-09)

- Each **Send Message** asks posts-available `n` and opens an `OutreachBlast` (`slotsTotal=n`, `OPEN`); a newer send auto-closes any open blast (its messages stay — only the new blast auto-cleans).
- Sends skip tickets with no worker and workers already at 2 assigned Posts today IST; skips are reported inline.
- First-n repliers win (one slot per channel; cap re-checked at reply time). On fill the blast closes and the bot deletes **its own** outreach message from all other contacted tickets (best-effort; hand-deleted messages are skipped, winners keep theirs).
- Repeatable anytime; cap resets 00:00 IST. Tables: `OutreachBlast`, `OutreachBlastMessage` (message IDs for deletion), `OutreachReply` (unique per blast+channel). Pure helpers in `src/utils/outreach-blast.ts`.