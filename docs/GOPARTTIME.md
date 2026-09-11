# GOPARTTIME.md — GoPartTime Integration

> Verified against `src/services/goparttime.service.ts`, `src/utils/goparttime-payload.ts`, `scripts/goparttime-send.user.js` v1.4.3, `src/api/routes/goparttime.ts` (`validateBody` now `Validation failed: field: msg; …` + `errors`), `src/bot/events/messageCreate.ts` on 2026-08-30.

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
| `contentHtml` | string 0–100000, default `""` | empty allowed **only** when `images.length>0` (image-only posts e.g. #880072 `r/Nocfree`, v1.4.2); else “Content or images required.” |
| `images` | array ≤20 | `{ order (sequential from 1), url }` |
| `sourceUrl` | url? | page URL for audit/debug |

## 4. Data Extracted by the Userscript (see `docs/BROWSER_EXTENSION.md` for DOM details)

- From dialog labels: Task ID, Task Type (→ post/comment), Deadline, Payment.
- `contentHtml` = `div.prose.innerHTML` (`""` when no prose but `images.length>0` — v1.4.2 image-only fix).
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

## 11. Hybrid Companion Flow (2026-09-08 — server never fetches GoPartTime)

Vercel's bot management hard-blocks the Oracle datacenter (Code 11 on every client: Node fetch, Alpine Chromium headless/headful, genuine Chrome-for-Testing — all with fresh cookies), so server-side polling is dormant (`pollEnabled` off). Instead the **manager's trusted browser** does all GoPartTime I/O via `goparttime-auto.user.js` v1.0.0 (`scripts/` + byte-identical `dashboard/public/` copy, served for install like the send script):

- **Monitor** (60s + jitter, `/tasks` only): parses flight-data `sub_task` blocks (available + unclaimed only) → `POST /api/v1/automation/sightings` (extension key). Also the heartbeat source. (Superseded in the burst window by §12 — no sightings are posted there.)
- **Queue** (server, 60s tick, `processSightingQueue`): expires stale claims (releasing workers) → validates fresh NEW sightings (Post/duplicate/blocked, 15-min TTL) → runs one companion-strategy cycle (existing worker Stage-2 flow, then a claim per pair instead of a server accept).
- **Claim** (companion polls `GET /claims/pending` every 30s routine / 5s in-window): on a pending claim performs the accept POST in-page (genuine session/TLS/IP), reports via `POST /claims/:id/result`, then attempts the full detail push through the existing `/goparttime/assign` (same extraction as Send Task; falls back to manual push).
- **Safety**: claims expire in 10 min (worker released); dry-run logs `WOULD_ACCEPT` with no GoPartTime mutation (Discord contact messages are still really sent, as with all dry-runs); malformed sightings parked; idempotent by `sub_task_id`.
- **Visibility**: dashboard Automation page shows watcher online/offline (3-min heartbeat), fresh sighting count, pending claims; cycles table unchanged.
- Tables: `AutomationSighting` (status NEW/CONTACTING/DONE), `AutomationClaim` (PENDING/CLAIMED/FAILED/EXPIRED), `CompanionStatus` heartbeat.

## 10. Automated Post Acceptance (foundation, 2026-09-07 — NOT deployed, dry-run default)

Server-side loop that monitors GoPartTime without the manager's PC. Verified findings: GoPartTime is Next.js RSC on Vercel; task list lives in `/tasks` flight data as `detail.sub_task {id, type post|comment, status 0=available, task_id, grab_user_id 0=unclaimed, karma_limit, earnings}` + parent `task {subreddit_name, title}`; accept is `POST /tasks` with `Next-Action: <64-hex>` + `[{sub_task_id}]` → `{"success":true}`; plain Node fetch gets `429 + Vercel Security Checkpoint`, so the poller uses persistent Chromium (Playwright, `.goparttime/browser-profile`) and accepts from inside the page context.

- **Schedule**: scans at :00 :10 :11 :20 :30 :40 :50 + jitter (mandatory :10/:11), 7/hour, 30s tick (`src/services/automation/scheduler.ts`). Expires timed-out contacts each tick.
- **Cycle** (`cycle.service.ts`, eligible-gated, max 6 batches): poll → validate (Post-only, duplicate via `(source,externalTaskId)`, exact-match blocked) → ping exactly N workers (`hey @user, should i send a post?`, new tagged message) → 5-min window → accept min(eligible,confirmed) → re-poll remaining.
- **RETIRED from automatic use (burst-only everywhere)**: no scheduler or queue tick calls the 5-min cycle anymore — the 60s sighting tick feeds detections into the §12 burst flow instead. The cycle code stays for manual `POST /automation/start` + test endpoints only.
- **Workers** (`worker-manager.service.ts`): outreach-selected pool, 1-active-post guard (`findAwaitingSubmissionInChannel`), 2/day IST cap, earliest-reply-first matching, stale replies ignored (`messageCreate.ts` hook).
- **Safety**: `AutomationSettings.dryRun` default true (logs `WOULD_ACCEPT`, never accepts) + `GOPARTTIME_AUTO_ACCEPT=false` default (real `acceptTask` needs both off). Cookies in `GoPartTimeSession` AES-256-GCM (`GOPARTTIME_SESSION_KEY`), never logged. Human-like: 3–8s pre-accept delay, single page, images blocked, checkpoint backoff 1m→5m→15m.
- **Observability**: `AutomationCycle`/`AutomationContact`/`AutomationTaskLog` rows + audit actions + dashboard `Automation` page (`/automation`).
- **Deploy checklist**: apply `migration.sql` automation excerpt manually, set `GOPARTTIME_SESSION_KEY` (32-byte hex) + optionally `GOPARTTIME_AUTO_ACCEPT`, `docker compose up -d --build`, paste fresh cookies via Automation → Session, enable with dry-run first, server needs system Chrome/Chromium for Playwright.

## 12. Burst Auto-Accept (2026-09-11 — deployed `1d48739`; burst-only everywhere)

The exact hourly contract (all server-enforced): scan at exactly xx:10 → validate → freshness gate → one auto-blast (slots = fresh N) → each blast reply becomes one claim → accept all N, delivered one-by-one in reply order however long it takes (claims never expire while the burst is open) → fill deletes losers' messages immediately → next :10 supersedes. Lazy accept throughout: nothing is ever accepted on GoPartTime without a named winner (accepted tasks cannot be returned there). No worker-facing time limit: the blast stays open until slots fill (late replies within the hour still convert); the 24h claim TTL is only a backstop and closed-burst orphans are swept.

**Settle-once reporting.** The watcher waits for two consecutive identical scans, POSTs once per hour, and retries the same set until the server confirms the blast (retries are server no-ops). Late sets (e.g. :12–:15 leaks) wait for next hour — pools freeze after the settled report.

**Freeze semantics.** `enabled=false` or dry-run on means validate + log only: no blasts, no burst-row writes, and no new claims from replies (in-flight rounds halt at the next reply). The switches mean what they say.

**Whole-page count.** Every validated-eligible listed post counts toward the blast — blocked / unreadable-subreddit / comment rules still exclude, but there is deliberately NO duplicate/history filter: listed + available means takeable (an accepted task vanishes from the listing, so history never disqualifies a listed task). The `/assign` 409 backstop still guards double delivery. Leftovers re-blast hourly, capped at one message per worker per hour by the one-blast dedupe.

**Winner visibility.** `GET /cycles/:id` returns per-blast `replies[]` (channel, worker, time); the panel drill-down lists winners under each blast (worker contacts stay empty for bursts — wins live in blast replies).

**One blast per IST hour (anti-spam rule).** The hour's FIRST eligible report opens the blast — each worker is messaged exactly once. Later reports in the same hour only APPEND brand-new task ids to the pool (slots grow, zero new messages); reports with nothing new are silent no-ops (no cycle row). Previous hours' still-open bursts close and union their unheld tasks. If the hour's blast already filled (first-N won, losers' messages deleted), late tasks wait for the next hour's scan. Hour boundaries use IST (`getIstHourStart`), matching the drop schedule. Dry-run never touches real burst rows (validate + log only).

**Blocked-list enforcement (fail-closed).** A post with no readable subreddit is NEVER eligible (`NO_SUBREDDIT`) — on the server validator, in the in-page mirror, and in leftover re-validation. Pooled bursts persist per-task `{id, subreddit, title}` (`AutomationBurst.taskDetails`) so leftovers keep their blocked-check teeth across merges. Subreddit association is windowed: each `sub_task` match reads parent fields only from its own `detail` neighborhood (bounded by the next task — dense lists can't mix up neighbors), trying `subreddit_name` → `subreddit` → `post_link`/`reddit_url`, never guessing by parent key name. The watcher extracts with the same windowed logic and refreshes its blocked bundle every 15 min. As a final net, each claim carries its expected subreddit and the browser aborts the accept when the open drawer's real subreddit disagrees.

**Newest-first priority.** Page bottom carries the newest drop: burst reports, the server parser, and the sighting queue all order newest-first, so the first replier wins the newest eligible post. Card-index drawer matching stays in DOM order internally and is unaffected.

- **Watcher v1.1.1** (`scripts/` + byte-identical `dashboard/public/` copy, pure ASCII): burst window **:09:50–:15 browser-local** (covers :10/:11 drops + :14/:15 leaks, `isBurstWindow` mirrors server `isBurstActive`). In-window: 2–3s DOM-first scans (no extra page load), in-page eligibility via cached `GET /eligibility-bundle` (blocked + last-200 accepted ids, 1h TTL, fail-open), change-triggered `POST /burst` only (no `/sightings` in-window — avoids double-processing via the 60s sighting queue), 5s claim poll. Accept: drawer open + detail extract, then **fast Server-Action POST** (~300ms, definitive verdicts only) with drawer-Confirm fallback, then existing `/goparttime/assign` push + verdict report. Routine 60s/30s loops unchanged outside the window. Settings via the on-page gear button (bottom-right, every goparttime.net page) or the Tampermonkey "Configure Watcher..." menu (visible only on goparttime.net tabs).
- **Backend** (`src/services/automation/burst.service.ts`, wired at boot in `src/index.ts` step 8): `POST /burst` re-validates every task (Post/duplicate/blocked via `validator.service.ts`), merges unheld leftovers from still-open bursts (older tasks first — the new blast supersedes the old one), opens the blast, stores `AutomationBurst {blastId, cycleId, taskIds[]}`. Blast reply/close hooks (setter-injected into `outreach.service.ts` — manual blasts unaffected) convert wins to 3-min-TTL claims (`AUTOMATION.BURST_CLAIM_TTL_MS`), guarded by ticket-idle + cap re-checks; concurrent replies serialized by an in-process mutex. Dry-run: validates + logs only, no blast, no claims.
- **Rehearsal**: `POST /api/v1/automation/rehearse` (JWT+admin) `{externalTaskId, channelId, taskType?, subreddit?, title?, live?}` — runs all pre-flight checks (ticket, exactly-one-worker, busy, daily cap, validator) and returns `wouldAccept` dry check, or queues a real 10-min claim when `live:true` + dryRun off + `GOPARTTIME_AUTO_ACCEPT=true`. Rehearse one post → ticket-0154 before enabling burst mode:
  ```
  # 1. Safe dry check (creates nothing) — copy JWT from dashboard login:
  curl -s -X POST https://statbot.duckdns.org/api/v1/automation/rehearse \
    -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" \
    -d '{"externalTaskId":"<sub_task_id>","channelId":"<ticket-0154-id>","subreddit":"<name>"}'
  # 2. After wouldAccept:true + dryRun off + GOPARTTIME_AUTO_ACCEPT=true: same call with "live":true.
  #    The watcher (tab open on /tasks) picks the claim up within ~30s, accepts, pushes, reports.
  ```
- **Deploy checklist**: apply the `AutomationBurst` DDL from `migration.sql` manually, `docker compose up -d --build`, rehearse with `live:true`, then dry-run one drop (`WOULD_ACCEPT` + real blast) before going live.

## 13. Automation Panel (dashboard `/automation` — restored, deployed with burst-only update)

Full panel (restored Sept 11 from the Sept-9-removed page, plus new cards): live/dry-run status + master switches (enabled/dry-run/server-polling-dormant), stat cards (last cycle eligible/confirmed/accepted, blocked count), browser-watcher heartbeat + pending claims, manual single-task test card, **rehearse card** (task ID + ticket + optional subreddit + Live checkbox → real claim or dry check), blocked-subreddit editor (exact match, add/remove), session paste, recent-cycles table (detected/eligible/confirmed/**accepted**) with drill-down (worker contacts, per-task decisions, **linked blasts with slots filled/total + task IDs**). Backend: same `/api/v1/automation/*` endpoints; `GET /cycles/:id` additionally returns `bursts[]` (blast link, ordered task ids, live fill).