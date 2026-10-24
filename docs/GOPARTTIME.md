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
   → since userscript v1.4.4 the tracked click ALSO auto-runs the whole flow immediately (the floating
   "📊 Submit View" button stays only as a manual fallback)
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
- Task row: `createdById: 'goparttime-api'`, `formattedContent = htmlToDiscord(contentHtml)`, `taskImages` mapped `[{order,url,kind}]`, everything else copied; status `ACCEPTED`, assignment `PENDING`.
- **Pipeline delivery (live 2026-10-12 at `4e72387`, Decision 36): persist first, return at once (route → 201), deliver in the background** via the `delivery-queue` worker (`deliver-<taskId>`, concurrency 3) so acceptor tabs move to the next claim without waiting out downloads + sequential Discord sends. Enqueue failure → `FAILED` (same outcome as an old delivery failure; dashboard Retry recovers synchronously). No userscript change — tabs await `/assign` exactly as before, it just answers fast.
- Delivery (`deliverPendingTask`, the only fresh-delivery writer): crash-redelivery cleanup of row-listed partials (never duplicates), then sends each metadata label/value pair as **its own message** (copy-friendly: label, blank line, value), content chunks via `buildTaskMessagePlan` (paragraph-aware `chunkText`, ≤2000 chars, sensitive formatting preserved), then each media item **in stored `order`** via `sendMedia` (see below), then the instruction embed reply-with-link prompt — workers always see image 1 first, then 2, and so on (pinned by `delivery-order.test.ts`).

#### Media delivery — `sendMedia(channel, {order, url, kind})`
`kind` comes from the payload (`'image'` default) and picks the toolchain. Delivery records keep the `images` kind for both, since that is one delivery step.

- **Images** → `prepareImage`: ≤10 MB unchanged (byte-identical), >10 MB compressed to ~9 MB WebP (quality ladder, alpha preserved).
- **Videos** → `prepareVideo`: ≤24 MB unchanged (byte-identical), >24 MB compressed with **ffmpeg** (`src/utils/video-processor.ts`). Discord rejects anything over its 25 MB per-file limit with a 413, and most task clips are far above it, so this is the difference between a delivered video and a failed assignment.
  - Ladder, cheapest quality loss first, first result under the limit wins: `-c copy` remux (free when only the container is wasteful) → CRF `30/33/36/39` at `veryfast`, same resolution → CRF + `scale=-2:720/480/360/270`. Output is always H.264 `yuv420p` + AAC in a `+faststart` MP4.
  - Download is capped (300 MB) and read incrementally, so a pathological URL cannot OOM the box. Timeout 120 s.
  - When compression happens the message carries `Video compressed from X to Y to fit Discord's upload limit, so it looks lower quality than the original.` — otherwise a worker who notices the drop in quality has no way to know why. The service logs the before/after sizes.
  - A video that cannot be brought under the limit **throws**, exactly like an image: the assignment goes `FAILED` with the reason and is retryable. Nothing is silently dropped.
- Neither path is a silent drop: any failure fails the assignment (see below).

> **ffmpeg is a hard runtime dependency for oversized videos.** It is installed in the Docker image (`apk add ffmpeg`) and probed at boot (`isFfmpegAvailable()`), which logs a warning if it is missing. Override the binary with `FFMPEG_PATH` (read in `src/config/constants.ts` as `MEDIA.FFMPEG_PATH`, not through `config/env.ts`, so the module stays unit-testable without a full environment).
- Success → compare-and-set `PENDING→SENT` (only when the ticket, worker, and PENDING state are untouched — a reassign mid-flight makes the write match zero rows and the stale run stands down, deleting only its own partial sends) + `updateDeliveryMessages` (saved progressively per send, so crash-redeliveries clean up instead of duplicating) + audit `TASK_ASSIGNED` "Assigned from external source (task X) to <@worker>" + nudge + feedback clocks start.
- Failure → `updateAssignment('FAILED', message)` + audit "Assignment failed (external task X): msg" → dashboard Retry recovers (same outcome as the old synchronous path; the tab already moved on).
- Reassign takes over a queued job first (`removeDeliveryJob`); an actively sending run trips on the ticket/worker change and stands down. Retry/reassign themselves still deliver synchronously (manager waits, gets confirmation) — untouched.

### `listTickets(client)` → `TicketInfo[]`
Every guild's TextChannels; `taskStatus`: `awaiting-submission` (a task awaiting a URL in the channel) | `active` (any non-terminal GoPartTime task) | `idle`. Used by the extension dropdown and the dashboard (GET `/discord/tickets`).

### `recordSubmission(taskId, url, submittedBy)`
- Guards: source must be `goparttime`; `assignmentStatus === 'SENT'` (FAILED → "…use retry before submitting."); status `PENDING|ACCEPTED`; valid Reddit URL; not already submitted for a *different* task (→ 409).
- **Latest-wins replacement**: `markSubmitted` sets `submittedRedditUrl`, `submittedBy`, `submittedAt`, and mirrors `redditUrl`; audit `URL_SUBMITTED` ("URL replaced: old → new" when changed).
- **Automatic format check** (POST tasks only): fetches the live post's raw `title`/`selftext` via `.json` (`src/services/reddit-check.service.ts`, `www` → `old` fallback, 12s timeout) **authenticated with the spare account's login cookie** from the `RedditSession` vault (browser UA; Reddit killed anonymous `.json` — www 403s, old login-gates, datacenter IPs hard-blocked). Mobile `/s/` share links (what workers actually submit) are followed to their canonical permalink first — the redirect chain, not the landing HTML status, is the source of truth. Comparison is against delivered `title`/`formattedContent` with normalized comparison (`src/utils/reddit-format.ts` — case/whitespace/markdown-insensitive). Paragraph-count rule (2026-10-11): MORE paragraphs than delivered passes (collapsed GoPartTime content re-pasted with proper blank lines is correct); only FEWER fails (`PARA_SHORT` — link not queued, worker asked to repost, owner tagged in the ticket); title/wording differences pass (`TITLE_MISMATCH`/`TEXT_MISMATCH` — link queued). Short-count failure wins over a title mismatch. Whitespace normalization (2026-10-22, DEPLOYED live at `6e162b0`): `splitParagraphs` normalizes `\r\n?` to `\n` and strips trailing spaces/tabs/NBSP on every line (`/[ \t\u00a0]+$/gm`) before splitting, because Reddit's rich-text editor stores a visually blank separator as `"   \n  \n"` — the blank line is not empty, and a bare `/\n{2,}/` split counted a correctly spaced 3-paragraph post as 1/3 (`PARA_SHORT`, false rejection; live task 1326259, Rechecked to MATCH 3/3 and queued on deploy day). The same normalization is mirrored in `dashboard/src/utils/redditFormat.ts` and both format-check userscripts (v1.1.1). Verdict persisted via `saveFormatCheck` (`formatCheckStatus` MATCH|PARA_EXTRA|PARA_SHORT|TITLE_MISMATCH|TEXT_MISMATCH|FETCH_ERROR|DELETED|NO_SESSION|SESSION_EXPIRED, `formatCheckDetail` JSON counts, `formatCheckedAt`); never fails the submission. Audit detail appends `Format check: …`. COMMENT tasks persist `SKIPPED`. Multi-image posts (2+ `taskImages`) get an order reminder right after the instruction message at delivery time (all three delivery paths, sent once).

### `recheckFormat(taskId)` — dashboard Recheck
- Re-runs the same check for a task that already has a `submittedRedditUrl` (fresh posts can 404 for ~30s; 429s recover). Backed by `POST /api/v1/tasks/:id/recheck-format`.

### Post-link nudge + escalation re-blast (live behavior)
- Every delivered POST (ACCEPTED + SENT, no link) runs a 10-min clock from delivery (`nudge-queue`, `src/services/nudge.service.ts`, stable `nudge-<taskId>` id, latest-wins on re-delivery). +10 min → tagged reminder + 5-min reassignment warning (audit `LINK_NUDGE_SENT`); +15 min → combined escalation re-blast for everything overdue (sender `link-escalation`, slackers excluded via `excludeWorkerIds`, winners paired most-overdue-first and reassigned via `reassignTask`, fresh clock for the new worker; audit `LINK_ESCALATED`). Foreign open rounds are never superseded (defer). No winners → owner tagged in the stuck tickets, posts stay pooled. PENDING tasks are nudged never (manager owns them). Boot backfills clocks for posts delivered within 24h.

### Session format pre-check (manager browser, display-only)- The VPS-side fetch above can hit Reddit 429s (shared IP) and 404s on fresh posts. The separate Tampermonkey script **`scripts/reddit-format-check.user.js` v1.1.1** (byte-identical `dashboard/public/` copy, served at `/reddit-format-check.user.js`) runs on **reddit.com** post pages: it fetches the live post `.json?raw_json=1` **same-origin with the manager's logged-in session** (cookies + home IP — no VPS exposure), fetches the exact expected text from Statbot via read-only `GET /api/v1/goparttime/expected/:externalTaskId` (extension key; `title` + `formattedContent`, i.e. precisely what Discord received), compares locally with a verbatim port of `src/utils/reddit-format.ts` (same extra-passes/short-fails rule), and shows MATCH/accepted/SHORT + per-paragraph diff in a floating panel. **Never writes back** — the bot reply + dashboard badge stay the only official verdict. See `docs/BROWSER_EXTENSION.md` §10.

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
| `GET /api/v1/goparttime/expected/:externalTaskId` | extension key | **read-only**; exact expected text Statbot delivered to Discord (`title`, `formattedContent`, `type`, `subreddit`, `submittedRedditUrl`, `formatCheckStatus`); used by the session format-check script (`reddit-format-check.user.js` v1.0.0). Same task resolution as insight (source+external, manual-id fallback); 400 non-numeric id, 404 not found |
| `POST /api/v1/goparttime/reddit-session` | extension key | paste/refresh the spare Reddit account's login cookie (self-service, no SSH); validated + AES-vaulted, never echoed back |
| `POST /api/v1/goparttime/failed-tasks/scan` | extension key | failed-task checker (2026-10-24, built — NOT deployed): classify a batch of GoPartTime failed task IDs against Statbot, persist `FailedTaskCheck`, DM the owner once per new `MISMATCH` |
| `GET /api/v1/discord/tickets` | JWT + admin username | same list for dashboard |
| `POST /api/v1/tasks/assign-from-goparttime` | JWT | dashboard twin (same service) |
| `POST /api/v1/tasks/:id/submit-url` | JWT | dashboard URL submission (also runs the auto format check) |
| `POST /api/v1/tasks/:id/recheck-format` | JWT | re-run format check for a submitted URL |
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

**Settle-once reporting.** The watcher waits a fixed countdown after first eligible sighting (20s early-window since v1.4.9 — drops land at xx:10 +-20s; 10s near the tail), then POSTs the current set once per hour and retries until the server confirms the blast (retries are server no-ops). No signature comparison (churn-proof). Streaming completions that arrive within the 5-min merge grace join the pool silently (slots grow, zero new messages); later arrivals wait for next hour — pools freeze.

**Winner serving (strictly serial, one win each).** Blast replies are processed through a FIFO queue in Discord-arrival order, so the first replier always claims first — never in database-race order. The burst pool is registered before the first blast message goes out, so even replies arriving mid-send get claims. Each worker wins at most once per blast (a worker with two tickets cannot take two tasks), and busy-ticket / capped / duplicate replies are filtered BEFORE a slot is consumed, so every recorded win maps to exactly one claim. Winners of a filled blast keep their claims until the claim TTL even after the burst closes — the orphan sweep only expires claims from bursts cut short before filling. The claim gate re-checks the one-task rule as a backstop. A second task for the same worker only ever comes from a later burst (each burst is a fresh claim cycle).

**Parked-claim pickup (2026-09-26, DEPLOYED `a720f8a`).** The watcher deliberately leaves a claim PENDING (no verdict) in three situations: the tab is not on `/tasks`, the card list has not rendered yet (3s budget), or the task's card is missing and the tab reloads once for a fresh list. `pickLeaseCandidate`/`isLeaseFree` judged leases tab-agnostically ("is this stale?"), so a tab could never re-lease its OWN live claim and neither could any other tab: one hiccup froze that task — in practice always the newest/last task of the blast — for the full `CLAIM_LEASE_TIMEOUT_MS` (3 min), matching the reported "first tasks instant, last task 2–5 min" and "single-task blast 2–3 min". The picker now takes the asking tab id and treats its own lease as takeable (the repository's atomic UPDATE guard already allowed `{leasedBy: tabId}`; that branch was unreachable dead code), so a parked claim is retried on the very next ~2s poll while other tabs still need the 3-min stale-lease reclaim and the verdict gate is untouched. `burstOpen` (the fast-poll flag) is now also true while ANY claim is PENDING — the fill closes the burst on the same reply that creates the last claim, so gating on the burst row alone dropped the final task of every blast back to the 30–40s cadence. Server-side only: no userscript change, no Tampermonkey update, no migration. Oldest-first order is preserved, so a tab finishes its parked claim before taking newer work and reply-order pairing is unchanged.

**Deferred retry (watcher v1.6.5, DEPLOYED 2026-10-12 at `7c3a19d` — Tampermonkey update required on both watcher tabs).** Fast parallel tabs trip the site's accept rate limit ("The operation is too frequent, please try again later" — observed live 2026-10-12: 3 accepts in ~15s, third failed, post lost). A claim that fails once AT/AFTER the accept step on a verified-good task now parks instead of verdicting (per-tab session list, cap 20, 30-min TTL). The claim poll takes a `defer` list: `pickLeaseCandidate` hands other actionable work first and returns a deferred claim only when nothing else is leasable, so the retry runs last by construction and never jumps fresh claims. Retry = 2s pause, reload, one full accept; its verdict is final (move-on/delete as today), so the winner message is never deleted before the retry. Safety aborts (subreddit mismatch, auto-block) and missing cards verdict at once — retrying those is pointless or unsafe. If the parking tab dies, the 3-min stale lease lets the other tab take the claim as a normal accept.Lease rules and the atomic UPDATE guard are untouched (exactly-once preserved); no migration. See Decision 37.

**Fill-safe sending (2026-09-13).** Discord sends are slow and a fast first reply can fill the blast mid-send — sends that raced in after the one-shot fill-cleanup used to stay forever (incident: 1-slot blast, winner ticket-0155, 30 stranded messages). `sendBlastMessages` now re-checks the blast row before each send and stops once it is closed (late tickets logged as skipped `blast closed before send`), then runs a post-send sweep deleting non-winner messages when the blast actually filled (supersede-closed blasts keep seen messages by design).

**Manual Blast Now (watcher v1.2.0).** An orange button on `/tasks` (above the gear) runs an immediate round on click: full scan → eligible count → `POST /burst` with `force:true`, which bypasses ONLY the window gate (live gate, validation, one-blast dedupe all still apply; the pill shows the server's `reason` when no blast opens). Winners are served exactly like hourly rounds. Double-clicks ignored while a manual round is in flight.

**Pre-blast digest DM (report-first, no tap needed).** After a settled auto-report validates with eligible tasks, the bot DMs the manager an embed — title/color state the verdict at a glance (green = eligible, amber = new sub or NAME-CHECK needs a look, blue = nothing usable), one monospace Breakdown field per subreddit (no task-id lists), own fields for new subs and name-checks, footer carries the cycle id — and the DM is awaited BEFORE the blast opens, so the report provably precedes the first worker message. Then the blast opens by itself. Buttons: **Block r/X** stays unconditional (acts on future rounds AND shrinks any live round holding pooled posts from that sub — slots drop, excess winners' messages go; eligible first, then tagged; unknown and already-blocked excluded; max 20); **Blast now** / **Hold** render only when a tap could still do something (cycle unreleased, eligible present, no imminent auto-open) — on released rounds they are omitted instead of answering "already released". One DM per IST hour (resends only if the eligible set grew); buttons expire after 90 min or once released. The on-page Blast Now button stays as manual override + fallback. Implementation: pure `blast-digest.ts` + embed builder in `bot/embeds` + `blast-approval.service.ts` (`maybeSendDigest`, awaited inside `createBurstFlow` via dynamic import — the approval module imports the burst module back, so a static import would cycle) + `blast:*` button branch in `interactionCreate`.

**On-demand scan (deployed, watcher v1.4.8).** The manager types `scan` (exact word, any case) in the bot DM — no slash command. `messageCreate` handles DMs (requires the `DirectMessages` intent): non-managers and non-matching text stay silent; a match queues one scan request via the shared `requestScanCommand` trigger (per-user 60s cooldown, reuses an already-waiting request so two triggers never make two DMs). The next `GET /claims/pending` poll carries `scanNow: <requestId>`; the watcher tab runs one immediate full scan + settled `POST /burst` tagged `scanRequestId` (no countdown, no hourly gates; same attempt-log + 35s timeout + telemetry). The first report consumes the request and ALWAYS gets its own "Manual scan" digest DM (same builder/buttons/rules, empty scans DM "nothing listed"); same-id duplicates stay silent and never trigger the auto digest; the automatic hour state is untouched. Implementation: `scan-request.service.ts` + DM branch in `messageCreate` + `sendManualDigest` in `blast-approval.service.ts` + `scanNow`/`scanRequestId` in `automation.ts` + watcher v1.4.8. (The `/scan` slash command was removed after one deploy — DM text is the only trigger; `deploy-commands` clears the stale global command.)

**Scheduled hourly scan (IST xx:10:05).** `hourly-scan.service.ts` fires the same shared `requestScanCommand` trigger as the DM text (id `hourly`, own cooldown slot) on a self-rescheduling second-precision chain - pure IST math in `hourly-scan-plan.ts` (every hour's :10:05, keyed by round hour), exactly-once per round, late-boot grace (serves the round if booting within 5 min after :10:05), +3 min unconsumed watchdog (warns when tabs are closed). The digest arrives labeled `Scheduled hourly scan`; a user scan just before :10:05 is reused (one DM, never two). Gated on the live condition (`enabled && !dryRun` - the scan only runs when rounds are live; `pollEnabled` only gates legacy scheduler cycles). The digest is a report, not a gate: the round's blast normally opens by itself first and the digest carries no Blast/Hold row (taps would only answer "already released"); the row appears solely when the round hasn't released yet (late/out-of-window report, dry-run, send failure), where the tap is still a real fallback. The automatic round is untouched - both DMs arrive by design.

**Hourly timing fix (2026-09-26, DEPLOYED `9fed6c6`) — the skip is a `skipKey`, never a re-plan.** The chain used to re-plan with `planNextHourlyScan(lastServed.at + LATE_GRACE_MS + 1000)` and then arm that `delayMs` as if it came from now, but `delayMs` is relative to the `nowMs` passed in — so every post-fire round landed `now − (lastServed.at + 301s)` early, ~5 min, i.e. at :05:05 **before** the drop (the digest then reported an empty/stale listing). The same stale reference kept re-returning the hour just served, so the chain also spun on 5s no-op re-plans for ~5 min after each early fire (~50 wasted wakeups + log lines per hour) and only re-aligned every other hour — the reported "sometimes :10, mostly :05/:06", which also dragged the fire across :05–:06. `planNextHourlyScan(nowMs, skipKey)` now takes the already-served round key: that hour is never returned again (on time or through the late grace) and `delayMs` stays relative to `nowMs` in every branch; the service passes `lastServed.key`, so the chain advances straight to the next :10:05 with zero no-ops. A fresh process start passes no `skipKey`, so a boot inside the 5-min grace still late-serves the current round. **Never re-plan this chain from any reference other than `Date.now()`.** (Second attempt: `a6f82bf`'s "no-reloop chain" shipped the same stale-reference skip-ahead on 2026-09-22.)

**Force-return to /tasks (watcher v1.2.1).** GoPartTime auto-navigates the tab to `/my-tasks/todo` on every accept, which stalled the watcher (monitor + drawer matching only run on `/tasks`). After each claim verdict — success or failure — the script now navigates the same tab back to `/tasks` (pathname-guarded, never a reload loop), so the next claim proceeds with no manual reload.

**Blast Now layout (watcher v1.2.2).** The Blast Now button parks above the Send script's Send Task + Submit View buttons (bottom:124px desktop, 144px narrow) so the three never overlap.

**Blast window :10–:16 IST.** The :16 tail absorbs delayed reports; nothing may message outside it. **Automatic hourly bursts are live**: each settled :10 report validates, DMs the digest (report-first, awaited), then opens the blast itself — no tap needed. The Blast Now button stays as a manual override (force-bypasses only the window gate) and as fallback. The companion `/burst` + `/eligibility-bundle` endpoints are rate-limit exempt (shared extension key is the gate, same as the other companion endpoints).

**Freeze semantics.** `enabled=false` or dry-run on means validate + log only: no blasts, no burst-row writes, and no new claims from replies (in-flight rounds halt at the next reply). The switches mean what they say.

**Whole-page count.** Every validated-eligible listed post counts toward the blast — blocked / unreadable-subreddit / comment rules still exclude, but there is deliberately NO duplicate/history filter: listed + available means takeable (an accepted task vanishes from the listing, so history never disqualifies a listed task). The `/assign` 409 backstop still guards double delivery. Leftovers re-blast hourly, capped at one message per worker per hour by the one-blast dedupe.

**Winner visibility.** `GET /cycles/:id` returns per-blast `replies[]` (channel, worker, time); the panel drill-down lists winners under each blast (worker contacts stay empty for bursts — wins live in blast replies).

**Fresh-scan restart (manual override of a stalled batch).** An on-demand report (`scan` text / scheduled hourly) always lands in its OWN cycle (`freshCycleOnly`) and never closes a live batch — merging would log the new scan into the open hour blast's cycle, so the digest rebuilt the PREVIOUS batch's list (claimed posts still shown). While a batch is open, an eligible digest's Blast button renders as **Restart batch** (`blast:go:<cycleId>:restart`); tapping it closes the open blast, deletes its messages from every non-winner ticket, excludes every task that batch handed out (PENDING/CLAIMED claims), re-validates the remaining tasks for availability, then opens a fresh batch sized to the survivors and sends to the re-checked contact set (ticket-busy / daily-cap / no-worker filters apply per ticket, so nobody mid-task is re-pinged). Automatic hourly reports keep merge behavior unchanged.

**One blast per IST hour (anti-spam rule).** The hour's FIRST eligible report opens the blast — each worker is messaged exactly once. Later reports in the same hour only APPEND brand-new task ids to the pool (slots grow, zero new messages); reports with nothing new are silent no-ops (no cycle row). Previous hours' still-open bursts close and union their unheld tasks. If the hour's blast already filled (first-N won, losers' messages deleted), late tasks wait for the next hour's scan. Hour boundaries use IST (`getIstHourStart`), matching the drop schedule. Dry-run never touches real burst rows (validate + log only).

**Blocked-list enforcement (fail-closed).** A post with no readable subreddit is NEVER eligible (`NO_SUBREDDIT`) — on the server validator, in the in-page mirror, and in leftover re-validation. Pooled bursts persist per-task `{id, subreddit, title}` (`AutomationBurst.taskDetails`) so leftovers keep their blocked-check teeth across merges. Subreddit association is windowed: each `sub_task` match reads parent fields only from its own `detail` neighborhood (bounded by the next task — dense lists can't mix up neighbors), trying `subreddit_name` → `subreddit` → `post_link`/`reddit_url`, never guessing by parent key name. The watcher extracts with the same windowed logic and refreshes its blocked bundle every 15 min. As a final net, each claim carries its expected subreddit and the browser aborts the accept when the open drawer's real subreddit disagrees.

**Newest-first priority.** Page bottom carries the newest drop: burst reports, the server parser, and the sighting queue all order newest-first, so the first replier wins the newest eligible post. Card-index drawer matching stays in DOM order internally and is unaffected.

- **Watcher v1.4.5** (`scripts/` + byte-identical `dashboard/public/` copy, pure ASCII): countdown latches on any scanned post (banned/unreadable count); :15 tail sweep reports even fully empty drops once; report body eligible-first plus the rest, cap 20; comments never count; hourly :10 hard reload. Otherwise identical to v1.4.3 below: flap-proof countdown — empty scan ticks no longer restart the 45s clock. Burst window **:10–:16 browser-local** (`isBurstWindow` mirrors server `isBurstActive`); in-window 2–3s DOM-first scans, in-page eligibility via cached `GET /eligibility-bundle` (blocked list, 15-min TTL, fail-open); fixed-countdown report (20s since v1.4.9, 10s near the tail) once per hour + retry till confirmed; claim poll 5s in-window / 30s routine, **2–3.5s whenever any burst is open on the server** (new `burstOpen` poll flag — covers manual rounds outside the window). **Parallel tabs**: each tab sends a stable per-tab id and the server leases every claim to exactly one tab (`AutomationClaim.leasedBy/leasedAt`, 3-min stuck reclaim; status stays PENDING till verdict, so all held/taken filters, verdict gate, and move-on retry are unchanged) — 2–3 open tabs accept different tasks concurrently; serial flow per tab. Accept: drawer open + detail extract with subreddit ground-truth abort, then **fast Server-Action POST** (~300ms, definitive verdicts only, capped 2 tries x 3s) with drawer-Confirm fallback, then existing `/goparttime/assign` push + verdict report (failures auto-retry the worker on the next task). Post-accept return is client-side back-navigation (one-shot reload fallback); a still-loading card list leaves the claim PENDING instead of failing it. v1.3.0 added per-claim step timings (poll-received / drawer-opened / accepted / pushed) to the verdict body; the server logs one `Claim timings` line per verdict — zero behavior change. Routine 60s/30s loops unchanged outside the window. Settings via the on-page gear button (bottom-right, every goparttime.net page) or the Tampermonkey "Configure Watcher..." menu (visible only on goparttime.net tabs).
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

## 14. Automatic content screen for new subreddits (Tier-0/Tier-1, ENFORCE — DEPLOYED 2026-10-10 at `488a323`)

Two-tier auto-decide for never-seen-before subreddits (language / sex / vape / dojo / crypto), additive to the exact-match `BlockedSubreddit` list (which, `isBlocked`, and the manual digest Block buttons all work exactly as before). See Decision 26.

- **Tier-0 (title-only, flag-only)**: `evaluateForBurst` + `validateDetectedTask` (`validator.service.ts`, pure `utils/content-screen.ts`) flag unseen-subreddit candidates whose title hits the keyword lists (`BLOCK_KEYWORDS_SEXUAL/VAPE/DOJO_HIGH_CONFIDENCE` trigger alone; `*_AMBIGUOUS` singles never trigger alone — they only enrich the hit detail, or match as exact multi-word phrases; longest listed term wins; whole-word/phrase, case-insensitive, never substring) or the lightweight non-English signal (common-word fraction + non-Latin ratio, no library/network). Lists live in `src/config/constants.ts` (single source of truth, manually synced into the userscript; 'dab pen' deliberately excluded as cannabis-adjacent/out-of-scope). `dojo` is a whole-word high-confidence term (matches Dojo/DOJO/dojo, never `dojos` alone). Place/university terms (`BLOCK_KEYWORDS_PLACE_*`, `BLOCK_KEYWORDS_UNI_*`) are NAME-screening only and never touch title/content. Subreddit names containing `dojo` block as substrings (same as sex/vape high terms). Sets `ValidationResult.needsContentReview`/`screenSignal`; `eligible` NEVER changes. Mirrored in the watcher's in-page `filterEligible` (`review` field, stripped by the `/burst` schema — informational only). "Seen before" excludes the current cycle's own logs (`loadSeenSubs`), else the check could never fire.
- **Tier-1 (authoritative, full-content)**: watcher v1.6.7, at drawer-extract time right before Confirm — same lists against title + drawer text for still-unblocked + still-unseen subs. Hit → abort via the ground-truth-mismatch cancel path + `autoBlock` on the claim verdict → server `handleAutoBlockReport` does `addBlocked(sub, 'auto-content:<signal>')` + `AUTOMATION_BLOCKED` audit + instant admin DM (`sendAutoBlockNotice`, points at the dashboard blocked editor for unblock). A `dojo` hit aborts the post and blocks the subreddit exactly like sex/vape (`auto-content:dojo`); a crypto hit (`investing`, `crypto`, `bitcoin`, `cryptocurrency`, `ethereum`, `btc`, `defi`, `nft`, `web3`) does the same (`auto-content:crypto`), and crypto-named subs block pre-blast as substrings. Every verdict also carries `screenReport` (sub/signal/matched, hit or pass) into the in-memory screen event feed. Claim payload carries `seenBefore`/`contentReview` (Tier-0 flag, extra-suspicion logging). Force-refreshed blocked re-check immediately before Confirm covers the two-tab race.
- **DM report**: message `blocks` (exact word, any case) in the bot DM (managers only, same pattern as `scan`) → replies with recent auto-blocks from the DB (`listAutoBlocked`, reason `auto-content:*`, newest 20) + recent dry-run WOULD_BLOCK candidates from the event feed (shadow mode only; bounded 100, 7-day TTL, restart-volatile by design — the DB stays the record of real blocks). Instant per-block DMs fire on every actual auto-block regardless.
- **Rollout**: ENFORCE since v1.6.3 (`CONTENT_SCREEN.DRY_RUN=false` server + script — Tier-1 hits really block). Rollback = flip both flags back to true (log-only WOULD_BLOCK, no revert). No migration, no new tables. Requires a Tampermonkey update to the matching watcher version (`scripts/` + byte-identical `dashboard/public/` copy).
- **NSFW over18 screen (server-side, DEPLOYED 2026-10-16 at `3f8c335`, enforcing from boot)**: Reddit's own subreddit-level `over18` flag from `/r/<sub>/about.json` (subreddit endpoint, NOT the post-level `over_18` field — different endpoint/payload, never conflated). Anonymous fetch (`www` → `old`, same timeout shape as `reddit-check.service`, no vault cookie), strict-boolean read, fail-open null on 404/timeout/private/quarantined/banned/malformed; permanent per-process cache (no TTL) + shared in-flight fetches. `validateInputs` fires `checkAndAutoBlockNsfw(sub, seenSubs)` fire-and-forget (never awaited — zero hot-path latency) for unseen + unblocked post-task subs; on strict `true` the same `handleAutoBlockReport` lands `auto-content:nsfw` + audit (actor `system:nsfw-screen`, `CONTENT_SCREEN.DRY_RUN`-gated shadow mode). Validators stay pure. ACCEPTED RACE, STATED PLAINLY: ~100–400ms before the block lands, so the very first post from a brand-new NSFW sub can slip through (same narrow race as sex/vape); every later post is blocked-list covered. No companion change, no migration, no `scripts/` change.

## 15. GoPartTime link auto-submit (dedicated executor tab — DEPLOYED 2026-10-10 at `144139e`)

Closes the Submit Link loop: the worker's Discord-submitted link is submitted on GoPartTime automatically once verified, instead of the manager copy-pasting it into the Submit Task dialog. See Decision 27.

- **Gate** (`utils/submission-queue.ts`, pure + tested): POST + `MATCH`/`PARA_EXTRA`/`TITLE_MISMATCH`/`TEXT_MISMATCH` → submit; POST + `DELETED` (removed by Reddit/mods/filters, deleted by the user, any removal state) → submit anyway (owner directive 2026-10-12 — a gone post's link still counts on the task site); COMMENT + `SKIPPED` → submit; everything else (`PARA_SHORT`, `FETCH_ERROR`, session states, null) → never submit, manager reviews as today. Enqueued fire-and-forget from `recordSubmission` (never blocks the Discord reply) and from `recheckFormat` (a recheck can flip a task submittable with no resubmission); latest submission replaces the pending job (`submit-<taskId>`, 60s correction window).
- **Queue** (`submission-queue` BullMQ, survival pattern): schedule/lease store only — NO server worker pops it (datacenter IP is Vercel-blocked). Retries +2/+5min, max 3 attempts, then give-up removes the job, audits `GPT_LINK_SUBMIT_FAILED`, and tags the manager in the ticket (same as a format mismatch). Success audits `GPT_LINK_SUBMITTED`. Per-tab lease (`leasedBy`/`leasedAt`, 5-min stuck reclaim) on the job itself — a separate lease from accept-claims, never the `AutomationClaim` table.
- **API** (extension key, `goparttime.ts`): `GET /submit-jobs/pending` (due + unleased), `POST /submit-jobs/:id/lease` (409 when foreign-held), `POST /submit-jobs/:id/result`. Dashboard: `POST /tasks/:id/retry-submission` + "Retry Auto-Submit" button in TaskDetails (mirrors Retry Capture; re-gates, so a still-short link stays manual).
- **Executor** (`scripts/goparttime-submit.user.js` v1.1.0, byte-identical `dashboard/public/` copy, served at `/goparttime-submit.user.js`): runs ALONE on its tab (never the watcher tab). Polls pending every ~5s, leases one job, walks `/my-tasks/todo?page=N` (bounded 10) for the card by Task ID, then submits fast-path-first — direct Server Action POST to the page URL (`Accept: text/x-component`, `Content-Type: text/plain;charset=UTF-8`, `Next-Action: <64-hex scraped like the accept flow>`, body `[{"sub_task_id":<id>,"reddit_url":"<url>"}]`, 2 tries × 3s, definitive verdicts only) — with the dialog flow as fallback (exact-text Submit Task button → `input[name="redditUrl"]` via the React-input technique, never clobbers a manager-typed value → 3–8s human-like wait → dialog Submit click). Verification is authoritative since v1.1.0: intercepted `success:true/false` decides when present, else dialog-closed + the card's Submit Task button gone (both corroborated against a real manual Submit capture). Reports back; retries handled server-side. Active job survives `?page=` hops via sessionStorage. Never touches `/tasks`, claims, or accept buttons.
- **Deploy checklist**: apply the `GPT_LINK_SUBMITTED/FAILED` audit-enum excerpt from `migration.sql` manually (idempotent re-run), `docker compose up -d --build` (app + dashboard), install the submit script on ONE dedicated tab + reload, then watch the first real submission end-to-end before leaving it unattended. Rollback: close the executor tab (server flow is unchanged; nothing submits without it).

## 16. Fully automatic hourly blasts (report-first DM, no tap — live 2026-10-10)

Each settled :10 report validates, DMs the digest (awaited — the report provably precedes the first worker message), then opens the blast itself when live + in-window. Manual Blast Now stays as window-gate override + fallback (it skips the pre-blast digest; the manager is looking at the page). On-demand `scan` digests are untouched (own cycle, own per-request DM). See Decision 28.
- **Supersede rule (live 2026-10-11 at `a9bf75c`):** any new blast deletes the previous blast's loser messages first (winners keep theirs) — starting a round can never strand messages again. Same-scan duplicate reports no longer open competing blasts at all: the first report claims the scan request atomically, the rest merge into the hour blast (slots grow, zero new messages).
- **Shrink rule:** winners who never get the post lose the availability message, whatever the reason. Fill/close cleanup keeps task holders only (PENDING/CLAIMED claims) — pool-exhausted replies and failed claims are deleted, not kept. Terminal claim failures (no move-on recovery) and expiries delete that winner's message late. A mid-blast block of pooled posts shrinks the slots (7→5) and closes early when covered, with holder-only cleanup.

## 17. Quarantine for doubtful subreddit names (live 2026-10-11 at `a9bf75c`)
Tri-state name screening (see Decision 29): confident name hits auto-block **pre-blast** (the name is fully visible at scan time — no worker is ever messaged for the sub, via the same `handleAutoBlockReport` + `AUTOMATION_BLOCKED` audit, actor `auto-screen:scan`, dry-run aware); doubtful hits (ambiguous singles only: `mod`, `pod`, `sexy`, `smoking`, …) are **held from the blast pool**, logged `QUARANTINED`, and digest-flagged `[NAME-CHECK]` with the full name + count + the normal Block button. One `allow r/x` bot-DM (or dashboard Cleared section) clears a name forever; one Block tap ends it forever. Cleared names skip *name* screening only — content screening and manual blocks still apply, and blocks always win. No companion change: pool exclusion is server-side, and the pre-Confirm blocked re-check already covers mid-hour blocks. Rollback: flip `DRY_RUN` back to true (blocks and holds both stop, no revert). Deploy needs the migration re-run (`AllowedSubreddit` table + `AutomationCycle.quarantined` + `AUTOMATION_ALLOWED`) + app/dashboard rebuild. Known accepted substring casualties (`cockpit`, `dataanalysis`, `asexual`, …) reverse in one tap.

## 18. Deadline protection — expedited submits + "submitting in a bit" feedback (DEPLOYED 2026-10-12 at `4e72387`)
Every task carries a site-local deadline (`Task.deadline`: "Today 4:50 PM" / "Oct 11 1:50 PM", Asia/Kolkata — parsed to UTC by pure `utils/deadline.ts`; unparseable/missing means no pressure, past means hurry). Two guarantees (owner directive, Decision 35):
- **Link present**: the submit job fires no later than deadline − 5min − 60s slack — the 60s correction window is cut short under pressure (retries keep +2/+5min backoff except past the margin, where they fire at once). `SubmissionJobData` carries `deadlineMs` (absent on pre-feature jobs → old behavior).
- **No link at deadline − 5min − 30s**: a one-shot `feedback-queue` job (`feedback-<taskId>`, own queue, no server worker) goes to the executor tab, which clicks the card's Feedback button, writes "submitting in a bit" into `textarea[name="reason"]`, and Submits (dialog auto-closes; manager-typed notices win). `FEEDBACK_SENT` audit is the durable one-shot guard (Redis has no persistence); the job drops the moment a link arrives and refuses the lease if the task gained one, went terminal, or was already held. One retry, then give-up tags the manager in the ticket (brand-free) so the notice goes out by hand. The +10 nudge / +15 escalation reassignment runs unchanged.
- Scheduling: at every delivery (assign/retry/reassign), on boot + every 30min re-hydration (`findFeedbackCandidates`: SENT, ACCEPTED/PENDING, no URL, any type); deadlines >24h past never schedule. Endpoints: `feedbackJobs` folded into `GET /submit-jobs/pending` (one poll loop; old tabs ignore it) + `POST /feedback-jobs/:id/lease|result`. Executor v1.2.0 required on the tab for feedback (expedited submits need no tab change). Deploy needs the migration re-run (`FEEDBACK_SENT`/`FEEDBACK_FAILED` enum) + app + dashboard rebuild.

## 19. Async delivery pipeline — persist first, deliver in background (DEPLOYED 2026-10-12 at `21f3fa9`)

Acceptor tabs were idle while the server downloaded images + sent ticket messages one-by-one inside the awaited `/assign` call (5–30s per image post), so post #3 waited ~80–90s with 2 tabs. Now `assignFromGoPartTime` persists the row and returns at once (route → 201, same shape); a `delivery-queue` worker (`deliver-<taskId>`, concurrency 3, no browser work — delivery is server→Discord only) runs the identical send sequence and flips `PENDING→SENT` via compare-and-set. No userscript change — tabs await `/assign` exactly as before, it just answers fast. See Decision 36.
- **Order guarantee**: metadata → content → images in stored `order` → instruction → image-order reminder, single send path (`deliverTaskToChannel`), pinned by `delivery-order.test.ts` (shuffled input still sends 1, 2, 3).
- **Races**: reassign removes the queued job and takes over synchronously; an actively sending run checkpoints ticket/worker/PENDING before every send and stands down (deleting only its own partials) when the row moved; crash-redeliveries clean row-listed partials first (records saved progressively), never duplicate. Stale `SENT`/`FAILED` rows make a run return without sending (idempotent).
- **Failures**: send throw → `FAILED` + error, exactly like the old path (dashboard Retry recovers synchronously); enqueue failure → same `FAILED` shape. NEEDS_PUSH still fires only on persist-time errors (unchanged tab contract: 2xx = accepted-for-delivery).
- **Recovery**: boot re-enqueues every `PENDING`-delivery ACCEPTED row; the 30-min sweep re-enqueues rows stuck >5min (live synchronous retry/reassign deliveries are seconds old). No migration (no schema change). Nudge + feedback clocks start at SENT-flip, same anchor as before. Rollback: rebundle + app rebuild.
## 20. Failed-task checker — manual scan of `/my-tasks/failed` (BUILT 2026-10-24, NOT deployed)

**Purpose:** replace the daily manual check of `https://goparttime.net/my-tasks/failed`. The manager opens the failed page and clicks one button; a dedicated userscript walks every failed-task page, sends the task IDs to Statbot, and the backend reports which failures are contradicted by Statbot (the task still has a delivered Reddit link and was not marked deleted). A task that is OK in Statbot but Failed on GoPartTime is a possible wrongful failure worth reviewing.

**End-to-end flow:**
```
manager opens goparttime.net/my-tasks/failed
→ clicks "Check failed tasks" (new userscript; manual only, no auto-scan)
→ script collects every Failed card across ?page=N (fetch-first; full reload fallback for client-rendered pages)
→ POST /api/v1/goparttime/failed-tasks/scan { tasks:[{externalTaskId,type,failedReason,reward,deadline}], pagesScanned }
→ backend resolves each externalTaskId to a Task (shared two-step resolver: exact (source,externalTaskId) link, then manual "POST #123" id fallback when source is empty)
→ per-task verdict from Statbot data → upsert FailedTaskCheck
→ one consolidated owner DM for every currently-unnotified MISMATCH (OWNER_USER_ID); notifiedAt stamped only after Discord accepts
→ script renders counts + mismatch cards (with Copy / Copy all IDs); "Not in Statbot" IDs are listed but never DM'd
```

**Verdicts (`src/utils/failed-task-check.ts: classifyFailedTask`):**

| Verdict | Rule | DM? |
|---|---|---|
| `MISMATCH` | not deleted + has `submittedRedditUrl` (or manual-task `redditUrl`) | yes, once |
| `DELETED` | `cancelledReason` is set (`deleted`, `deleted_later`, or any admin-entered reason) — matches the dashboard dropdown | no |
| `NOT_COMPARABLE` | `CANCELLED` without a reason, or no Reddit link at all | no |
| `NOT_FOUND` | no Statbot task for that GoPartTime ID | no; shown in the panel only |

**Persistence (`FailedTaskCheck`, one row per externalTaskId):** `taskId/taskType/failedReason/reward/deadline` (last-seen snapshot), `verdict/taskStatus/cancelledReason` (last scan), `firstSeenAt` (insert only — defines "new"), `lastSeenAt/verdictAt`, `notifiedAt` (one-shot DM guard), `notifyError` (last DM failure; row stays retryable). `taskType` prefers the resolved Statbot task's stored type; the browser's card hint is used only for `NOT_FOUND` rows, so a card-layout change cannot mislabel a real task. Upserts run in 50-row transactions; the scan result is capped at 500 cards. A process-level in-flight lock returns 429 for a concurrent scan.

**Read-only guarantee:** the script never clicks a card, never opens Feedback, and never writes/submits anything on GoPartTime. No live Reddit re-check is performed; "deleted" is exactly the Statbot `cancelledReason` decision above.

**Files:**
- `scripts/goparttime-failed.user.js` + byte-identical `dashboard/public/goparttime-failed.user.js` (served at `/goparttime-failed.user.js`)
- `src/api/routes/goparttime.ts` → `POST /failed-tasks/scan`
- `src/utils/failed-task-check.ts` (classifier, zod schema, DM builder)
- `src/services/failed-task-check.service.ts` (orchestration + owner DM)
- `src/services/goparttime-task-resolver.service.ts` (shared batch resolver, now also used by `/insight`, `/expected`, `/submission`)
- `src/database/repositories/failed-task-check.repository.ts`
- `src/database/repositories/task.repository.ts` (`findBySourceExternalIds`, `findByIds`)
- Tests: `failed-task-check.test.ts`, `failed-task-check-service.test.ts`, `goparttime-task-resolver.test.ts` (44 tests)

**Deploy prerequisites (when approved):** apply the `FailedTaskCheck` DDL at the end of `prisma/migrations/migration.sql` manually (idempotent, schema-only), rebuild app + dashboard, and install/update the userscript from `https://statbot.duckdns.org/goparttime-failed.user.js` with the shared `GOPARTTIME_API_KEY`. The first real scan is also the first live test of the fetch-vs-reload pagination path (the page is a client-rendered app; the script reloads a page once if the HTML has no cards).
