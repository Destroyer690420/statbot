# BROWSER_EXTENSION.md — GoPartTime Userscript

> Verified against `scripts/goparttime-send.user.js` (identical to `dashboard/public/goparttime-send.user.js`, SHA-256 verified byte-for-byte) on 2026-08-11. Served publicly at `https://statbot.duckdns.org/goparttime-send.user.js`.

---

## 1. Identity

Tampermonkey userscript **"Discord Task Sender"** (v1.1.0, author "Manager"), designed for desktop and mobile (Kiwi Browser / Edge Canary noted in the header and `ANDROID_SETUP.md`). Works as a plain bookmarklet/non-GM fallback too (localStorage + fetch).

## 2. Metadata & Permissions

| Field | Value |
|---|---|
| `@match` | `*://goparttime.net/*`, `*://www.goparttime.net/*` |
| `@grant` | `GM_getValue`, `GM_setValue`, `GM_registerMenuCommand`, `GM_xmlhttpRequest` |
| `@connect` | `statbot.duckdns.org`, `161.118.164.85`, `localhost`, `127.0.0.1` |
| `@run-at` | `document-idle` |

## 3. Injected UI

- **Floating "Send Task" button** (`#gpt-send-task-button`): bottom-right, z-index 2147483647, Discord blue `#5865F2`; circle 56px with paper-plane icon on mobile (≤767px), pill on desktop. `pointerdown` handler with `stopPropagation()` so Radix/Vaul dialogs stay open while capturing.
- **Modal "Assign Task"** (`#gpt-modal`): ticket `<select id="gpt-ticket-select">`, status line `#gpt-status`, settings (gear) + debug (magnifier) buttons, Cancel, Send (disabled until a task is captured). Click-outside closes.
- **Tampermonkey menu commands**: "Configure Sender..." and "Debug Task Detection".

## 4. Data Extraction (GoPartTime DOM)

- `findTaskRoot()`: `[role="dialog"]`, else ancestor containing both a leaf text node `"Task ID"` and `div.prose`.
- `findField(label)`: leaf `div`/`span` with the exact label → value from `nextElementSibling`.
- Extracted: `taskId` ("Task ID"), `type` ("Task Type" → post/comment; throws if neither), `deadline` ("Deadline"), `payment` ("Payment").
- `contentHtml` = `div.prose.innerHTML` (required).
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

## 6. User-Facing Error Mapping (`parseStatus`)

| Backend status | Message shown |
|---|---|
| 2xx | ok |
| 409 | "Task has already been assigned." |
| 401 | "Authentication failed. Check your API key." |
| 503 | "Extension endpoint is not configured on the server." |
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