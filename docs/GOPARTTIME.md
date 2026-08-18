# GOPARTTIME.md — GoPartTime Integration

> Verified against `src/services/goparttime.service.ts`, `src/utils/goparttime-payload.ts`, `scripts/goparttime-send.user.js`, `src/api/routes/goparttime.ts`, `src/bot/events/messageCreate.ts` on 2026-08-11.

---

## 1. What It Is

A pipeline that lets workers **send an open GoPartTime task from goparttime.net directly into their Discord ticket**. A Tampermonkey userscript in the worker's browser extracts the task's detail from the page and POSTs it to the backend, which creates the task, auto-detects the worker's ticket, delivers the full task content into Discord, and manages the submission/activation lifecycle. Design specs: `sending.md` (2049-line plan) and `goparttime_discord_dom_and_limits_spec.md` (DOM + Discord limits spec) at repo root.

## 2. End-to-End Workflow

```
1. Worker opens a task detail on goparttime.net (my-tasks/todo dialog)
2. Click "Send Task" floating button → userscript detects + extracts fields
3. Pick ticket from dropdown (GET /api/v1/goparttime/tickets) → Send
4. POST /api/v1/goparttime/assign (Bearer GOPARTTIME_API_KEY)
5. Backend:
   a. zod validate → dedupe on (source='goparttime', externalTaskId) → 409 if exists
   b. resolveChannel(ticket — snowflake or name)
   c. one-task-per-ticket guard (another task awaiting submission? → error)
   d. detectWorker(channel) — exactly one non-bot, non-admin/manager member
   e. create Task: status=ACCEPTED, redditUrl=null, assignmentStatus=PENDING
   f. delivery: metadata msgs (label+value pairs, copy-friendly) → content chunks
      (≤2000 chars, paragraph-aware) → images (≤10MB, compressed otherwise) → instruction embed
   g. assignmentStatus=SENT; audit TASK_ASSIGNED
   h. send failure → assignmentStatus=FAILED + error; task stays ACCEPTED for retry
6. Worker publishes on Reddit, then REPLIES to the instruction message with the link
   (exactly one valid reddit.com URL; latest-wins replacement)
7. Manager presses "Mark as Done" (POST /api/v1/tasks/:id/done):
   ACCEPTED → PENDING, submitted URL bound to task.redditUrl, reminders scheduled
8. Normal lifecycle continues (reminders/insights/payout) — same as manual tasks
```

### View-data (insight) submission — Submit View automation (userscript v1.4.0, 2026-08-17)
```
1. Manager opens the View dialog for a task on goparttime.net ("Submit view data" = step 1 / 20h insight,
   "Submit second view data" = step 2 / 70h insight, posts only)
2. Clicking a card's "Submit View" (or disabled countdown) button makes the userscript track that card
   → "📊 Submit View" floating button reads GET /api/v1/goparttime/insight/:taskId?step=1|2
3. Backend resolves the matching Reminder (step 1 → POST_20H/COMMENT_20H, step 2 → POST_70H;
   see src/services/goparttime-insight.service.ts) and returns its stored screenshot URL
4. Userscript downloads the image (Blob), ensures the View dialog is open, injects the file via DataTransfer
5. Manager reads the view count from the screenshot, types it, clicks Submit, and verifies success in GoPartTime
   — the script NEVER submits, enters counts, or confirms; the Discord reply flow stays the only completion path
```

## 3. Payload Schema (`src/utils/goparttime-payload.ts`, shared by extension + API)

`goPartTimePayloadSchema` (zod + superRefine):

| Field | Type | Rules |
|---|---|---|
| `taskId` | string | positive int or digit-string → coerced to string |
| `type` | `'post'\|'comment'` | required |
| `ticket` | string 1–64 | channel snowflake or channel name |
| `deadline` | string? ≤64 | stored **opaque** (no parsing/enforcement) |
| `payment` | string? ≤32 | e.g. `$2.50`; displayed only |
| `subreddit` | string? 1–64 | **post only**, required |
| `subredditUrl` | url? | post only |
| `flair` | string? ≤64 | post only |
| `title` | string? ≤300 | **post only, required** |
| `postLink` | url? | **comment only, required** |
| `contentHtml` | string 1–100000 | must not be whitespace-only |
| `images` | array ≤20 | `{ order (sequential from 1), url }` |
| `sourceUrl` | url? | page URL for audit/debug |

## 4. Data Extracted by the Userscript (see `docs/BROWSER_EXTENSION.md` for DOM details)

- From dialog labels: Task ID, Task Type (→ post/comment), Deadline, Payment.
- `contentHtml` = `div.prose.innerHTML`.
- Post: `input[name="subreddit"]` (r/ stripped, subredditUrl constructed), `input[name="flair"]`, `input[name="title"]`.
- Comment: `input[name="post_link"]`.
- `images`: `img` with http(s) alt/src, `naturalWidth ≥ 60`, not in buttons, max 20, DOM order, prefer `alt` original URL.
- `sourceUrl` = `window.location.href`.

## 5. Backend Processing Details (`src/services/goparttime.service.ts`)

### `assignFromGoPartTime(payload, discordClient)` → `AssignmentResult {task, created, failed?, error?}`
- Returns `{task, created: false}` on dedupe (route → 409).
- `resolveChannel`: channel ID (cache → fetch) or channel name searched in first guild's cache; must be `TextChannel` ("Ticket channel not found…").
- `detectWorker`: non-bot, non-admin/manager members; 0 → error; >1 → error listing names (channel must contain exactly one worker).
- Task row: `createdById: 'goparttime-api'`, `formattedContent = htmlToDiscord(contentHtml)`, `taskImages` mapped `[{order,url}]`, everything else copied; status `ACCEPTED`, assignment `PENDING`.
- Delivery (`deliverToChannel`/`deliverTaskToChannel`): sends each metadata label/value pair as **its own message** (copy-friendly: label, blank line, value), content chunks via `buildTaskMessagePlan` (paragraph-aware `chunkText`, ≤2000 chars, sensitive formatting preserved), images individually after `prepareImage` (≤10MB unchanged; >10MB compressed to ~9MB WebP, quality ladder; never silently dropped — failure marks assignment FAILED), then the instruction embed reply-with-link prompt.
- Success → `updateAssignment('SENT')` + `updateDeliveryMessages` (JSONB records of kind `metadata|content|images|instruction` + messageIds + order) + audit `TASK_ASSIGNED` "Assigned from external source (task X) to <@worker>".
- Failure → `updateAssignment('FAILED', message)` + audit "Assignment failed (external task X): msg" → route returns 200 with `failed:true` (task stays ACCEPTED/FAILED, retryable).

### `listTickets(client)` → `TicketInfo[]`
Every guild's TextChannels; `taskStatus`: `awaiting-submission` (a task awaiting a URL in the channel) | `active` (any non-terminal GoPartTime task) | `idle`. Used by the extension dropdown and the dashboard (GET `/discord/tickets`).

### `recordSubmission(taskId, url, submittedBy)`
- Guards: source must be `goparttime`; `assignmentStatus === 'SENT'` (FAILED → "…use retry before submitting."); status `PENDING|ACCEPTED`; valid Reddit URL; not already submitted for a *different* task (→ 409).
- **Latest-wins replacement**: `markSubmitted` sets `submittedRedditUrl`, `submittedBy`, `submittedAt`, and mirrors `redditUrl`; audit `URL_SUBMITTED` ("URL replaced: old → new" when changed).

### `activateTask(taskId, by)` — the "Done" action
- Guards: `assignmentStatus === 'SENT'`, status `ACCEPTED`.
- `ACCEPTED → PENDING`; binds `redditUrl = submittedRedditUrl || null`; creates + schedules insight reminders; audit `TASK_ACCEPTED` (logs submitted URL or "no URL submitted").

### `reassignTask(taskId, ticket, client)` / `retryAssignment(taskId, client)`
- Reassign: ACCEPTED only; resolves new channel (must differ); best-effort deletes old delivery messages; resets channel/worker/deliveryMessages; `PENDING` → re-deliver → `SENT` + audit; failure → `FAILED` + rethrow.
- Retry: requires `FAILED` + no submission; sends only the **missing tail** (counts existing kind indexes), sets `SENT`, audit `ASSIGNMENT_RETRIED`.

## 6. API Endpoints (see `docs/API.md` for full detail)

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/v1/goparttime/tickets` | extension key | ticket dropdown data |
| `POST /api/v1/goparttime/assign` | extension key | assign + deliver |
| `GET /api/v1/goparttime/insight/:externalTaskId` | extension key | **read-only**; the stored insight screenshot for a task's view-data step (`?step=1\|2`, default: resolve automatically); used by Submit View (v1.4.0) |
| `GET /api/v1/discord/tickets` | JWT + admin username | same list for dashboard |
| `POST /api/v1/tasks/assign-from-goparttime` | JWT | dashboard twin (same service) |
| `POST /api/v1/tasks/:id/submit-url` | JWT | dashboard URL submission |
| `POST /api/v1/tasks/:id/done` | JWT | activation |
| `POST /api/v1/tasks/:id/reassign` | JWT | reassign |
| `POST /api/v1/tasks/:id/retry-assignment` | JWT | retry failed delivery |

Note: `TASK_REVIEWED`/`markReviewed` exist (model + repo) but no current flow calls them.

## 7. Discord Delivery Formatting Rules (also in the spec md)

- Metadata pair = own message: `Label:` newline newline `value` (workers can copy the value alone).
- URL field sent as **raw text** (native Discord embed/preview), never `[text](url)`.
- `deadline` field: extracted but **never sent to Discord** (deliberate, per `plain-task-message.ts`).
- Content: paragraph-aware chunks ≤2000 chars; bold/italic/links/strikethrough/code preserved across chunk boundaries.
- Images: own messages, ≤10MB or compressed; order preserved.
- Instruction embed (post): "Post everything exactly as it is. Then reply to THIS message with the link of your post within 10 minutes."
- Instruction embed (comment): 3 steps — post a random comment → edit after 10 min → reply with link.

## 8. Error Handling Overview

| Failure | Behaviour |
|---|---|
| Invalid payload (zod) | 400 with field errors |
| Duplicate externalTaskId | 409 "Task has already been assigned (task <id>)." (idempotent re-send safe) |
| Ticket not found / wrong type | 400 "Ticket channel not found…" |
| Zero/multiple workers in ticket | 400 with guidance |
| Delivery send fails mid-way | task FAILED + error message; retry endpoint completes the tail; dashboard shows the error |
| Image >10MB after all compression attempts | throws → assignment FAILED (never silent drop) |
| Worker replies URL while FAILED | rejected with "use retry before submitting." |

## 9. Current Limitations

1. `deadline` is display-only — no enforcement or expiry handling.
2. `payment` display-only (USD string), unrelated to the ₹ payout system.
3. One awaiting-submission task per ticket at a time (guard) — subsequent assigns fail until the earlier task is activated or deleted.
4. Worker detection requires exactly one non-admin member in the ticket channel.
5. Channel-name resolution searches only the **first guild's cache**.
6. Submitted URL is bound at activation time; a new submission replaces it any time before that.
7. The extension key is a single shared secret for all workers (`GOPARTTIME_API_KEY`).
8. Two copies of the userscript exist (`scripts/` and `dashboard/public/`) and must be kept identical (they currently are, byte-for-byte).
9. Submit View is **deliberately manual** at the end: no success detection, no confirm endpoint, no DB writes — the manager reads the count, clicks Submit, and verifies. The userscript's step-2 request for a comment task errors ("Comments have only one view-data step (COMMENT_20H).") and comments currently render no "Submit View" button in the GoPartTime UI (step 1 is assumed).
10. Submit View is **desktop-only** (userscript v1.4.0): auto-disabled on narrow/mobile viewports (insights are submitted from the PC only); the Tampermonkey menu "📊 Submit View: ON/OFF" can force it on via the `gpt_submit_view_enabled` storage override.
11. Insight screenshots expire from disk after 60h (see `docs/INSIGHT_SYSTEM.md`); Submit View after expiry returns no image.
11. **Manual-task fallback** (2026-08-17): the insight endpoint also resolves manually-created tasks (slash command / dashboard) whose id embeds the GoPartTime number (`POST #688318`, `Comment #688318`, case-insensitive) — it only matches tasks with no `source`, so GoPartTime-linked tasks always win. Manual ids in a different format can't be matched.