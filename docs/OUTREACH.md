# OUTREACH.md — Daily Worker Outreach

Verified 2026-08-18 — **deployed** (`4f1b84c` live on `161.118.164.85`; tables applied, route mounted, verified).

## 1. What It Is

A per-ticket-channel daily availability tracker, surfaced as the **Daily Outreach** dashboard page (`/outreach`).

Manager workflow per day:
1. Opens `/outreach` — table lists every ticket channel with its assigned worker.
2. Checks the tickets they want to reach in the **Select Tickets** modal → Save Selection (persists, survives day changes).
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
| `post` / `comment` | **any** task of that type with `createdAt` inside today's IST window (any status — the manager decides what counts) |
| `stale` | cycle needs reset (see §2) — GET re-applies the reset lazily |

## 5. Backend

- **Service** `src/services/outreach.service.ts`: `getStatus(client)`, `saveSelection(selections)`, `sendMessage(client, senderId)` (broadcasts only to `selected` channels; per-channel try/catch → `{ sent: [{channelId, channelName, ok, error?}] }`; audit `OUTREACH_MESSAGE_SENT` per channel), `onWorkerMessage(channelId, authorId)` (marks Available — called from `messageCreate.ts` first, best-effort, never throws), `getMessage` / `updateMessage` (OutreachSettings).
- **Repository** `src/database/repositories/outreach.repository.ts` (Prisma, upserts/transactions).
- **Routes** `src/api/routes/outreach.ts` (factory `createOutreachRoutes(discordClient)`; all `requireDashboardAdmin` — middleware extracted to `src/api/middleware/auth.ts`, shared with discord routes):
  - `GET /api/v1/outreach` → `{ istDate, message, tickets[] }`
  - `PUT /api/v1/outreach/selection` `{ selections: [{channelId, selected}] }` (max 500)
  - `POST /api/v1/outreach/send`
  - `GET/PUT /api/v1/outreach/settings` `{ message }`
- **Bot hook** `src/bot/events/messageCreate.ts`: `outreachService.onWorkerMessage` runs first; managers/bots excluded via `getAllAdminIds()`; failures swallowed (logging only).

## 6. Dashboard (`dashboard/src/pages/DailyOutreach.tsx`)

- Route `/outreach`; sidebar item **Daily Outreach** (`Users` icon) between Accepted and Archives; title branch in `Layout.tsx`.
- Table (desktop) + cards (mobile, Tasks pattern); columns Ticket | Worker | Available | Post | Comment.
- Toolbar: `Select Tickets` (checkbox modal — first checkboxes in the app, `accent-primary-500`; draft until **Save Selection** → `PUT /outreach/selection`), `Send Message` (confirm dialog; disabled when 0 selected; inline per-channel ✅/❌ result), Refresh.
- Auto-refresh every 30s (`refetchInterval`); subtitle shows today's IST date.
- Settings page: **Daily Outreach Message** card (textarea, ≤2000 chars, Save → `PUT /outreach/settings`).
- Client fns in `dashboard/src/api/client.ts`: `getOutreach`, `getOutreachSettings`, `updateOutreachSettings`, `saveOutreachSelection`, `sendOutreachMessage`.

## 7. Tests

`src/__tests__/outreach.test.ts` (pure functions only — importing the service would pull env/DB): IST boundary math, `isStaleDailyCycle`, `buildOutreachRows` (selection, availability gating, post/comment derivation, no-tickets case). 13 tests; suite total 144.

## 8. Limitations / Notes

- Availability = **any** worker message after the send (not strictly a reply to the broadcast).
- No auto-resend: per-channel failures are shown in the UI; the manager re-clicks Send Message (already-sent channels are skipped by the cycle check).
- Post/Comment counts **any** status task today — including ACCEPTED-not-yet-activated ones.
- `selected` is remembered forever unless changed; the manager must actively uncheck.