# BROWSER_EXTENSION.md — GoPartTime Userscript

> Verified against `scripts/goparttime-send.user.js` (identical to `dashboard/public/goparttime-send.user.js`) on 2026-10-09 (v1.6.1). Served publicly at `https://statbot.duckdns.org/goparttime-send.user.js`.
>
> `scripts/goparttime-auto.user.js` (the auto-accept watcher, SHA-256 `0B2715A8…`) carries the **same** media extractor at v1.6.0 — parity is asserted by `src/__tests__/userscript-media.test.ts`.

---

## 1. Identity

Tampermonkey userscript **"Discord Task Sender"** (v1.6.1, author "Manager"), designed for desktop and mobile (Kiwi Browser / Edge Canary noted in the header and `ANDROID_SETUP.md`). Works as a plain bookmarklet/non-GM fallback too (localStorage + fetch). **v1.6.1 made Submit Link silent on success** (popup only when no link exists yet or on error — see §5d). **v1.6.0 extracts `<video>` media** (see §5f) — a task whose media is a video previously sent nothing at all, because its markup contains no `<img>`. **v1.5.0 added Submit Link autofill** (see §5d) — clicking a card's "Submit Task" button prefills the dialog with the link the worker already sent in Discord. v1.4.3 **surfaces Zod validation details** (`Validation failed: field: message` + `errors` array shown in Tampermonkey) and keeps v1.4.2 image-only fix (empty `div.prose` allowed when `images>0` e.g. #880072 `r/Nocfree`); v1.4.0 disabled Submit View on narrow (mobile) viewports — insights are only submitted from the PC; everything else (Send Task, settings, desktop preview) is unchanged. v1.3.0 added the **insight screenshot preview** to the v1.2.0 **Submit View** automation (which itself sits on top of v1.1.0's send flow).

## 2. Metadata & Permissions

| Field | Value |
|---|---|
| `@match` | `*://goparttime.net/*`, `*://www.goparttime.net/*` |
| `@grant` | `GM_getValue`, `GM_setValue`, `GM_registerMenuCommand`, `GM_xmlhttpRequest` |
| `@connect` | `statbot.duckdns.org`, `161.118.164.85`, `localhost`, `127.0.0.1` |
| `@run-at` | `document-idle` |

## 3. Injected UI

- **Floating "Send Task" button** (`#gpt-send-task-button`): bottom-right, z-index 2147483647, Discord blue `#5865F2`; circle 56px with paper-plane icon on mobile (≤767px), pill on desktop. `pointerdown` handler with `stopPropagation()` so Radix/Vaul dialogs stay open while capturing.
- **Floating "Submit View" button** (`#gpt-submit-view-button`, v1.2.0, **desktop only since v1.4.0**): green `#2FBF71`, stacked above Send Task (bottom 72px desktop / 80px mobile); circle with bar-chart icon on mobile, pill on desktop. `pointerdown` → `stopPropagation()` only; the click runs `submitViewFlow()`. Not created on narrow (≤767px) viewports — `submitViewEnabled()` (auto `!isNarrow()`, override storage `gpt_submit_view_enabled` `1`/`0`) guards the whole Submit View + preview block; the Tampermonkey menu "📊 Submit View: ON/OFF" flips the override and reloads.
- **Screenshot preview panel** (`#gpt-insight-preview`, v1.3.0): floating left-edge card (`left:16px`, `bottom:140px`, `width:min(92vw,380px)`, `max-height:70vh`) with header (step + reminder type + ✕ close), scrollable `<img>` on a dark background, and a footer with `− Zoom` / `Zoom +` (0.5×–5×, step 0.25, `transform: scale()` + center origin) and an `Open ↗` link to the full-size image. Same dialog protections as the buttons.
- **Modal "Assign Task"** (`#gpt-modal`): ticket `<select id="gpt-ticket-select">`, status line `#gpt-status`, settings (gear) + debug (magnifier) buttons, Cancel, Send (disabled until a task is captured). Click-outside closes.
- **Tampermonkey menu commands**: "Configure Sender...", "Debug Task Detection", and "Submit View: ON/OFF" (v1.4.0 toggle; reloads the page to apply).

## 4. Data Extraction (GoPartTime DOM)

- `findTaskRoot()`: `[role="dialog"]`, else ancestor containing both a leaf text node `"Task ID"` and `div.prose`.
- `findField(label)`: leaf `div`/`span` with the exact label → value from `nextElementSibling`.
- Extracted: `taskId` ("Task ID"), `type` ("Task Type" → post/comment; throws if neither), `deadline` ("Deadline"), `payment` ("Payment").
- `contentHtml` = `div.prose.innerHTML` (empty `""` allowed when `images.length>0` — image-only posts like #880072 `r/Nocfree` have no prose block; the script throws only when both prose and images are empty — v1.4.2).
- Post-only: `subreddit` from `input[name="subreddit"]` (r/ stripped), `subredditUrl` = `https://www.reddit.com/r/<name>/`, `flair` from `input[name="flair"]`, `title` from `input[name="title"]`.
- Comment-only: `postLink` from `input[name="post_link"]`.
- `images`: `img` with http(s) `alt` or `src`, not inside a `button`, `naturalWidth >= 60` (skips icon UI images), max 20, DOM order, prefer `alt` (original URL — avoids Next.js-optimized `src`).
- `sourceUrl` = `window.location.href`.
- Debug command prints dialogFound/proseFound, label/input presence, and extracted values.

## 5. API Communication

- Base URL default `https://statbot.duckdns.org/api/v1/goparttime` (`DEFAULTS.apiUrl`), key from `GOPARTTIME_API_KEY` — both overridable via settings (GM storage or `gpt_`-prefixed localStorage).
- `GET {base}/tickets` → populates the dropdown (`channelId`, `channelName`, `taskStatus`).
- `POST {base}/assign` with the payload (see `docs/GOPARTTIME.md` §3).
- Transport: `GM_xmlhttpRequest` (30s timeout) with plain `fetch` + `AbortController` (30s, `credentials:"omit"`) fallback for non-GM contexts (CORS allows goparttime.net origins).
- Auth header: `Authorization: Bearer <apiKey>`.
- v1.4.0 Submit View calls: `GET {base}/insight/{taskId}?step={1|2}` (see §5b) and downloads the returned `imageUrl` (same-origin backend, no auth needed).
- v1.5.0 Submit Link calls: `GET {base}/submission/{taskId}` (see §5d/§5e). No injected UI — it reuses the site's own dialog and adds no button of its own.

## 5b. Submit View Flow (v1.4.0)

**Purpose**: attach the Statbot-stored insight screenshot to the GoPartTime "View" dialog so the manager can submit view data without hunting for the image. Submission stays manual (see §5c). **Only active when `submitViewEnabled()`** — auto-off on narrow (≤767px) viewports (phones), forceable via the `gpt_submit_view_enabled` storage override / menu toggle. When off, the button, tracking, and preview are not created at all.

1. **Card tracking** — a capture-phase `click` listener on `document` finds any clicked `button[data-slot="button"]` whose text matches `/^(Submit View|Available to submit view)/` and records `trackedViewCard = { card, taskId, step, buttonText }` (card = nearest `div[data-slot="card"]`; Task ID = leaf "Task ID" label → next sibling; step = 2 if the card's `div[data-slot="popover-trigger"]` h4 says "second", else 1).
2. **Guard** — no tracked card → alert to click a card button first; the card's button disabled (countdown text) → alert showing its text; unconfigured key → settings prompt.
3. **Fetch** — `GET /insight/{taskId}?step={step}` → `{ reminderId, reminderType, step, completed, imageUrl }`. No reminder → message; no `imageUrl` → "No screenshot uploaded yet for <type>.".
4. **Download** — `fetchImageBlob()`: `GM_xmlhttpRequest` with `responseType:'blob'` (fallback `arraybuffer` → `new Blob`), plain `fetch` as non-GM fallback; URL absolutized via `new URL(imageUrl, apiBase + '/')` where apiBase strips `/api/v1/goparttime` from `settings.apiUrl`.
5. **Preview** — `openInsightPreview(blob, …)` (v1.3.0): `URL.createObjectURL` from the **same Blob** as the upload (no second download — critical rule); floating panel on the left edge shows the screenshot while the dialog is open; zoom ±0.25 steps (clamped 0.5–5×, reset to 1 on open), `Open ↗` opens the blob URL full-size in a new tab. The preview stays until the user clicks ✕ or the view dialog leaves the DOM (1s interval check on `findViewDialog()` — proxy for "submission done"; it never auto-closes mid-flow).
6. **Dialog** — `ensureViewDialog(card)`: reuses an open dialog, else clicks the card's enabled Submit View button and polls ≤2s for `div[role="dialog"][data-slot="dialog-content"]` containing `input[name="exposure_count"]`.
7. **Attach** — `attachImageToDialog()`: `DataTransfer` + `new File([blob], 'view-<taskId>-step-<step>.png')` assigned to the dialog's hidden `input[type="file"][accept="image/*"]`, then `input` + `change` events dispatched (same as the site's dropzone).
8. **Handoff** — success alert: screenshot attached → read the view count **from the preview**, type it, click Submit, verify in GoPartTime.

**Deliberate non-features**: the script never fills `input[name="exposure_count"]`, never clicks the dialog's Submit, and never reports success — success verification is the manager's job (GoPartTime UI), and reminder completion still happens only via the Discord reply flow.

## 5c. Submit View API — `GET {base}/insight/{taskId}?step=1|2`

| Response field | Meaning |
|---|---|
| `taskId` / `internalTaskId` | GoPartTime id / internal `Post #…`/`Comment #…` id |
| `type` | `POST` / `COMMENT` |
| `reminderId` / `reminderType` | matched Reminder (null + `message` when none) |
| `step` | resolved step (0 when no reminders) |
| `completed` | whether the insight was already submitted in Discord |
| `imageUrl` | `Reminder.insightImageUrl` (screenshot URL) or null |

Step 2 on a comment → 400 "Comments have only one view-data step (COMMENT_20H)."; invalid step → 400; unknown task → 404 "Task not found."; non-numeric id → 400. Tasks created manually (not via the userscript) are found too — the backend falls back to ids like `POST #688318`/`Comment #688318` (both case conventions) when no GoPartTime-linked task exists.

## 5d. Submit Link Autofill (v1.5.0, silent-success since v1.6.1)

**Purpose**: GoPartTime's `/my-tasks` page has a per-card **Submit Task** button that opens a dialog asking for the post/comment URL. That URL already exists on Statbot — the worker replied with it in their Discord ticket, `recordSubmission` stored it in `Task.submittedRedditUrl`, and the dashboard's Accepted section renders it — so without help the manager has to alt-tab to the dashboard, find the task, copy the link and paste it by hand, once per task. This flow closes that loop.

**Trigger** (auto, no button tap): a capture-phase `click` listener on `document` matches `button[data-slot="button"]` whose trimmed text is exactly `Submit Task`, reads the task number off the enclosing `div[data-slot="card"]` (leaf "Task ID" label → next sibling), and records `trackedSubmitCard = { card, taskId }`, then runs the flow immediately. The exact-text match is what keeps it off the dialog's own inner **Submit** button (text `Submit`), and the card is read at capture time before React re-renders the list.

**Unlike Submit View, this is NOT desktop-gated.** It is one small GET plus a text-field fill — no upload, no preview — so it runs on phones too. `sleep()` and `detectCardTaskId()` were hoisted out of the `submitViewEnabled()` block to module scope so both features share them without inheriting the desktop-only gate.

1. **Fetch** — `GET /submission/{taskId}` (see §5e) → `{ redditUrl, … }`.
2. **Dialog** — reused if already open, else polled for ≤2 s for `div[role="dialog"][data-slot="dialog-content"]` containing `input[name="redditUrl"]` (the dialog is opened by the very click being reacted to, so it may not be mounted yet).
3. **Fill** — `setReactInputValue()` writes through the native `HTMLInputElement.prototype` value setter and dispatches a bubbling `input` event. Assigning `input.value` directly is **not** enough: the field is React-controlled, so a plain assignment updates the DOM but not React's state tracker and the next render reverts it to empty. This is the one non-obvious requirement in the whole flow.
4. **Never clobber** — if the field already has a non-empty value (typed or corrected by hand), the flow leaves it alone silently (console log only, no popup).
5. **Handoff (v1.6.1: silent success)** — when the link is filled, there is **no alert popup**: the link is pasted, the manager reviews it and clicks Submit. The alert popup appears **only when there is no link to fill yet** (or on a real error), so the manager is interrupted only when action is needed.

**Deliberate non-features**, matching the rest of the script: it never clicks the dialog's Submit button and never reports success to GoPartTime. The manager still reviews the link and submits.

**Failure messaging** is specific about the actual cause, because "no link" almost always means the worker has not replied in Discord yet: *No submitted URL for this task yet. Ask the worker to reply to the assignment message in their Discord ticket with their post/comment link — that reply is what stores it here.*

## 5e. Submit Link API — `GET {base}/submission/{taskId}`

Read-only, extension-key authenticated, no status filter (the link is written while the task sits in `ACCEPTED`, but the manager may submit on GoPartTime at any point afterwards — including after the task moved on to `PENDING` — and the answer is the same link, so filtering on status would break the helper exactly when it is still useful).

| Response field | Meaning |
|---|---|
| `taskId` / `internalTaskId` | GoPartTime id / internal `Post #…`/`Comment #…` id |
| `type` / `status` | task type and current status (informational) |
| `redditUrl` | the worker's submitted link, or `null` (+ `message`) when none |
| `submittedAt` / `formatCheckStatus` | submission timestamp / format-check verdict |

URL resolution is `submittedRedditUrl ?? redditUrl` (mirroring `worker-view.ts`): the former is what `recordSubmission` writes from the Discord reply, the latter only carries manually-created slash-command/dashboard tasks, which validate and store `redditUrl` at creation while leaving `submittedRedditUrl` null. Unknown task → 404; non-numeric id → 400; same manual-id fallback as `/insight/` and `/expected/`.

## 5f. Media extraction — images **and** video (v1.6.0)

`extractImages(root)` walks `querySelectorAll('img, video')` in **document order** and returns `[{order, url, kind}]`, capped at 20 items. The `order` numbering is shared across both kinds, which is what keeps a mixed image+video task in the order GoPartTime displayed it.

**Why the `kind` field exists.** A GoPartTime video task renders as

```html
<div class="flex gap-2 overflow-x-auto">
  <video class="h-12 w-24 …" poster="https://pbs.twimg.com/amplify_video_thumb/…/img/….jpg" width="96">
    <source src="https://video.twimg.com/amplify_video/…/vid/avc1/1280x720/….mp4?tag=29">
  </video>
</div>
```

There is **no `<img>`** — the thumbnail is a `poster` attribute, not an element. The original img-only extractor therefore produced an empty media list for a video task, and the video never reached the backend at all. Nothing about size was ever involved in that failure: it was dropped in the browser, before any limit applied. The extractor now reads `<video>` and tags each item so the backend picks the right toolchain (`prepareImage`/sharp vs `prepareVideo`/ffmpeg).

| Case | Result |
|---|---|
| `<img>` with an http(s) `alt` | `kind: 'image'`, `url` = `alt` (the original, not the Next.js-optimized `src`) |
| `<img>` inside a button | skipped |
| `<img>` with `naturalWidth < 60` | skipped (UI icons) |
| `<video>` with a `<source>`/attr URL ending `.mp4/.m4v/.mov/.webm/.mkv` (query string allowed) | `kind: 'video'` |
| `<video>` with only an HLS `.m3u8` or no extension | falls back to `poster` as `kind: 'image'` — Discord cannot play a playlist, and the poster frame beats no media at all |
| `<video>` with neither | dropped (not faked) |

`kind` is optional in the backend schema and **defaults to `image`**, so an older installed script keeps working unchanged. Server side it is `TaskImage.kind` in the existing `taskImages` JSONB column — **no migration** (see `docs/GOPARTTIME.md` §5).

Both scripts (`goparttime-send.user.js` and the auto-accept `goparttime-auto.user.js`) carry an identical copy of this extractor, bracketed by `// ─── media-extraction:start/end ───` sentinels. `src/__tests__/userscript-media.test.ts` lifts that block out of both shipped files and runs it against a DOM stub, so the extractor cannot silently regress, and it also asserts the `scripts/` and `dashboard/public/` copies stay byte-identical (the sync rule `docs/KNOWN_ISSUES.md` #11 records as manual).

Compression of an oversized video is **server-side only** — the browser never touches the bytes. See `docs/GOPARTTIME.md` §5 for the ladder.

## 5g. Mobile companion — `goparttime-mobile.user.js` (v1.0.0)

A stripped-down script for phones with exactly two jobs and no Submit View
baggage: a floating 📤 button (Send Task → ticket picker → `POST /assign`)
and automatic Submit Link autofill that runs when the site's own
**Submit Task** button is tapped (no second button — the fill is the feature).
Same silent-success rule as §5d (popup only on no-link / error), plus a
small auto-hiding toast for feedback instead of desktop alerts.

Mobile hardening: the card-button match is tolerant (`includes('Submit Task')`
in case mobile wraps the label), card lookup falls back to climbing ancestors
for the "Task ID" label, the submit dialog is waited up to ~4s, and the media
extractor is the same sentinel-bracketed copy (video-capable). It shares
storage keys (`gpt_api_url`, `gpt_api_key`) with the desktop script, so a key
already saved on the device is reused; first run with no key prompts once.
Source: `scripts/goparttime-mobile.user.js`; served at
`https://statbot.duckdns.org/goparttime-mobile.user.js`. Install it
**instead of** (not alongside) the desktop script on the phone — running both
would double-fire the autofill.

## 6. User-Facing Error Mapping (`parseStatus`)

| Backend status | Message shown |
|---|---|
| 2xx | ok |
| 409 | "Task has already been assigned." |
| 401 | "Authentication failed. Check your API key." |
| 503 | "Extension endpoint is not configured on the server." |
| other 400 `Validation failed` | `message` + `errors` joined `; ` — e.g. `Validation failed: contentHtml: Content or images required.; title: Title is required for posts.` (v1.4.3) |
| other | server `message` or "Server error (status)" |
| network/timeout | "Server is unavailable." / "(timeout)" |

## 7. UI States

- "Loading tickets..." → "Detected: Task #NNN — Post|Comment" → "Sending to backend…" → "✅ Task assigned successfully." (auto-close 1200ms).
- Warnings for: no task captured, no ticket selected, extraction failure ("Open a task to see its detail view...", "Could not detect task ID.", "Could not determine task type.", "Could not extract task content."), unconfigured key (prompts settings).
- Delivery failure: "Task created but delivery failed: ... Retry in the dashboard." — Send re-enabled (task exists server-side as ACCEPTED/FAILED; `POST /tasks/:id/retry-assignment` from the dashboard completes it).

## 8. Installation / Build

- No build step — it's a plain user script. Source copy: `scripts/goparttime-send.user.js`; deployed copy: `dashboard/public/goparttime-send.user.js` (served by nginx at `/goparttime-send.user.js`).
- Install into Tampermonkey from the public URL (desktop) or Edge Canary + Tampermonkey (Android, see `ANDROID_SETUP.md`). Updates: re-open the install link.
- **Keep the two copies in sync** when editing.

## 9. Known Limitations

- No "copy link" behavior in the userscript itself (copy-friendly Discord formatting is handled by the backend's message layout).
- Depends on GoPartTime's DOM structure (Radix/Vaul dialogs, `div.prose`, named inputs) — fragile to site changes; hence the debug tool.
- Single shared API key for all workers (no per-worker identity).
- Submit View: desktop-only (auto-disabled on narrow/mobile viewports, v1.4.0); works only after a card's Submit View/countdown button was clicked (tracking); comments currently render no Submit View button in the GoPartTime UI (step 1 assumed); screenshots expire after 60h; the preview lets the manager read the count but the script still does not verify GoPartTime actually accepted the attached file.
- Submit Link (v1.5.0, silent success since v1.6.1): depends on the GoPartTime card button text being exactly "Submit Task" and the dialog input being `name="redditUrl"`; depends on the React-controlled-input technique holding if GoPartTime changes framework; only fills an **empty** field, so a retry after a failed submit needs the field cleared first; useless for any task whose worker never replied with a link in Discord (no such link exists server-side to fetch — this is the one case that still pops an alert).

## 10. Second Script — Reddit Format Check (Session, v1.0.0)

> Source: `scripts/reddit-format-check.user.js`, byte-identical `dashboard/public/reddit-format-check.user.js`, served at `https://statbot.duckdns.org/reddit-format-check.user.js`. **Display-only pre-check** — the server verdict (bot reply + dashboard badge) stays the source of truth.

| Field | Value |
|---|---|
| `@match` | `*://reddit.com/*`, `*://www.reddit.com/*`, `*://old.reddit.com/*`, `*://new.reddit.com/*`, `*://sh.reddit.com/*` |
| `@grant` | `GM_getValue`, `GM_setValue`, `GM_registerMenuCommand`, `GM_xmlhttpRequest` |
| `@connect` | backend hosts (`statbot.duckdns.org`, `161.118.164.85`, `localhost`, `127.0.0.1`) + reddit hosts (`reddit.com`, `www/old/new/sh.reddit.com`) |
| `@run-at` | `document-idle` |

Why it exists: the server format check fetches Reddit JSON from the VPS IP (429-prone, 404s ~30s on fresh posts). This script fetches the same `.json?raw_json=1` **same-origin from the manager's logged-in tab** (session cookies + home IP), so gated/fresh/throttled posts verify fine.

Flow: open the worker's post → floating "Check Format" button → enter the GoPartTime task number → script `GET`s expected text from `GET /api/v1/goparttime/expected/:taskId` (extension key; exact `title` + `formattedContent` Discord received) via `GM_xmlhttpRequest` (bypasses CORS — reddit.com is not in the backend allowlist, so Tampermonkey is required), fetches live JSON same-origin first then `old.reddit.com` fallback (12s timeout each), compares with a verbatim port of `src/utils/reddit-format.ts` (`splitParagraphs` / `normalizeInline` / `compareRedditFormat` — normalized text, strict paragraph structure), renders MATCH / TITLE_MISMATCH / PARA_MISMATCH / TEXT_MISMATCH + per-paragraph Exp-vs-Live diff + the same hints as the bot reply. COMMENT tasks report SKIPPED; deleted posts report DELETED; a tab URL differing from the worker-submitted URL gets a warning line. Recheck button covers fresh-post 404s. Settings (backend URL + `GOPARTTIME_API_KEY`) via the Tampermonkey "Configure Format Check..." menu, same storage pattern as the sender script; last task ID remembered.

Deliberate non-features: no POST back to Statbot (no verdict persistence, no audit) — advisory only.