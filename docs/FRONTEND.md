# FRONTEND.md — Admin Dashboard

> Verified against `dashboard/src/**`, `dashboard/package.json`, `dashboard/vite.config.ts`, `dashboard/nginx.conf` on 2026-09-25 (worker visual redesign section re-verified after deployment). Admin premium redesign (§10) verified against `dashboard/src/**` on 2026-10-02 and DEPLOYED live at `bafeede` (dashboard-only rebuild). Worker admin-style task cards, wallet simplification and admin-aligned colour tokens verified against `dashboard/src/**` on 2026-11-03 and deployed at `9432edb`.

---

## 1. Stack & Scripts

React 18 + TypeScript 5.7 + Vite 6 + Tailwind 3 + TanStack React Query 5 + Recharts 2 + axios + react-router-dom 6 + lucide-react. Package `rtm-dashboard`.

| Script | Command | Notes |
|---|---|---|
| dev | `npm run dev` | Vite on **:5173**, proxy `/api` → `VITE_API_TARGET \|\| 'https://161.118.164.85'` (working tree has an uncommitted change `http:` → `https:`) |
| build | `npm run build` | `tsc && vite build` → `dist/` |

## 2. Routing (App.tsx, 13 routes)

| Path | Page | Notes |
|---|---|---|
| `/login` | Login | public |
| `/` | Dashboard | ProtectedRoute + Layout |
| `/tasks` | Tasks | |
| `/accepted` | AcceptedTasks | |
| `/outreach` | DailyOutreach | Daily Worker Outreach page (see below) |
| `/automation` | Automation | Auto-accept panel: status/switches, cycles + drill-down, rehearse, blocked editor (see below) |
| `/tasks/:id` | TaskDetails | |
| `/analytics` | Analytics | |
| `/archives` | Archives | |
| `/settings` | Settings | contains Owner PIN gate |
| `/owner-earnings` | OwnerEarnings | **not in sidebar**; JWT-only protection (PIN not enforced per-request) |
| `/payout` | PayoutLayout | sub-navigation layout; redirects to `/payout/tasks` |
| `/payout/tasks` | TaskPayments | Task payments tab |
| `/payout/commissions` | Commissions | Commissions tab |
| `/referrals` | Referrals | |
| `*` | NotFound | standalone, no auth |

## 3. Auth (useAuth.tsx, client.ts, ProtectedRoute.tsx)

- Token `rtm_token` in **localStorage**; request interceptor adds `Authorization: Bearer`.
- Response interceptor: on 401 → remove token + `window.location.href='/login'` (hard redirect).
- `ProtectedRoute`: spinner while loading; redirect to `/login` with `state.from`; Login returns there after success.
- Single account (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` server-side).

## 4. API Client (`src/api/client.ts`)

baseURL `/api/v1`. All functions used by pages (see `docs/API.md` for endpoint semantics):
`login`, `getTasks`, `getTask`, `deleteTask`, `updateTask`, `doneTask`, `reassignTask`, `retryAssignment`, `submitTaskUrl`, `recheckFormat`, `getTickets`, `getReminders`, `getStats`, `getDailyStats`, `getTypeDistribution`, `getEmployeePerformance`, `downloadCsv`, `getOutreach`, `getOutreachSettings`, `updateOutreachSettings`, `saveOutreachSelection`, `sendOutreachMessage`, `getAutomationStatus`, `updateAutomationSettings`, `startAutomationCycle`, `stopAutomation`, `getAutomationCycles`, `getAutomationCycle`, `getBlockedSubreddits`, `addBlockedSubreddit`, `removeBlockedSubreddit`, `saveAutomationSession`, `sendTestContact`, `sendTestAccept`, `sendRehearse`, `getAutomationCompanion`, `getAutomationClaims`, `getPayoutWeek/Summary/Eligible/WorkerDetail`, `payWorker`, `getWorkerQrCode`, `payAll`, `getBatchHistory/Detail`, `downloadPayoutCsv`, `get/updatePayoutRates`, `getCommissionSummary/Breakdown/InviterDetail`, `getReferrals`, `createReferral` (**unused by UI**), `deleteReferral`, `updateReferral`, `payInviter`, `payAllCommissions`, `get/updateCommissionRates`, `getCommissionBatchHistory/Detail`, `getInviteDetections`, `approveInviteDetection`, `rejectInviteDetection`, `updateInviteDetection`, `downloadCommissionCsv`, `restoreUnpaidArchived`, `verifyOwnerPin`, `getDailyEarnings`, `getDailyEarningsHistory`, `getWeeklyEarnings`.
Unused API functions: `getUpcomingReminders`, `getExportCsvUrl`, `getHealth`, `createReferral`.

## 5. Pages

### Dashboard
4 subtle metric cards (Total/Pending/Completed/Overdue, white numbers + muted labels + thin accent bars) + 7-day AreaChart (`#6C8CFF` on `#20252C` grid) + secondary activity cards; skeleton loaders while loading (no spinner). No in-page heading (top bar shows the title).

### Tasks
Search (id, url, channel), 15/page client-side pagination, status filter; desktop table / mobile cards. Actions: cancelledReason dropdown (OK/Deleted/Deleted Later → PATCH), Download latest insight image, Copy submitted link, Request insight screenshot (MessageSquare → `POST /tasks/:id/request-insight`, read-only nudge with spinner + green check), View, Delete (confirm). CSV export. **Ticket numbers are clickable** (`TicketLink` → `https://discord.com/channels/<guildId>/<channelId>` in a new tab; plain text when `channelId` is missing).

### TaskDetails
Task info + GoPartTime external block (assignmentStatus badge, Retry Delivery on FAILED, error text, externalTaskId/subreddit/flair/payment/deadline/sourceUrl/postLink/formattedContent/taskImages grid) + Submission section (record/replace URL, Mark as Done when ACCEPTED, format-check badge + checked-at + diff modal) + **10-Minute Survival Proof (POST only: precise-state badge from `survivalRemovalState` — SURVIVED 10+ MIN / DELETED / REMOVED BY MODERATORS / REMOVED BY REDDIT FILTERS + modqueue hint / REMOVED / POST NOT FOUND + hint, falling back to the coarse `survivalStatus` badge on pre-Phase-2 rows — + captured-at + download when present; scheduled-for countdown at PENDING; error + Retry Capture → `POST /tasks/:id/retry-survival` on hard failure; idle hint before any URL)** + Reminder Timeline (built from `RETRY_DELAYS` 2h/6h assumptions) + Submitted Screenshots (each reminder's `insightImageUrl`, click-to-open, download).

### AcceptedTasks
Queue of ACCEPTED tasks; Reassign (ticket select with `busy` badge for `awaiting-submission` channels), Done (activation), copy link, delete; 15/page with chevron pagination. Live queue: auto-refresh every **5s** (`refetchInterval: 5_000` — faster than the 30s Automation/DailyOutreach polls so watcher accepts show up almost immediately). **Format column** (`FormatBadge` from the stored `formatCheckStatus/Detail` — text-only Match / para-mismatch / title-text-mismatch / verify-failed badges in muted semantic colors, — for comments, No URL/Unchecked otherwise; mismatch badges open `FormatDiffModal`: browser-direct live Reddit fetch vs delivered content, per-paragraph highlighting, title row, server-side Recheck button → `POST /tasks/:id/recheck-format`). No in-page heading (top bar shows "Accepted Tasks"; "N queued" badge top-right). **Ticket numbers are clickable** in both the desktop table and mobile cards (`TicketLink` → `https://discord.com/channels/<guildId>/<channelId>` in a new tab; plain text when `channelId` is missing).

### Archives
Read-only ARCHIVED list + search + CSV; spec table header (12px muted on `#111418`), neutral Archived badges, desktop table + mobile cards + empty states; chevron pagination.

### Payments (`dashboard/src/pages/payout/`)
Modular redesign split across 17 clean components:
- `PayoutLayout.tsx`: no page header (the old `PayoutHeader` with the "Payments" title, week-range line, Restore Unpaid + Export CSV buttons is no longer rendered — the file stays in place with its logic intact). Full-width 2-column sub-navigation tabs (`/payout/tasks` & `/payout/commissions`, equal 50/50 halves, centered labels), segmented-control DateFilter (Previous/Current only — `FilterMode` still includes `all`/`custom` and the custom-range logic is untouched, just not selectable), shared week query & Outlet context.
- `TaskPayments.tsx`: muted summary cards (thin accent bars, no left-border rainbows), worker breakdown table (desktop) / cards (mobile) with inline accordion worker details, collapsible Payout History. No Pay All banner (the `payAll` API + `PayAllBanner` component are untouched, only the banner UI + its mutation wiring were removed). Per-worker "Pay Worker" buttons unchanged.
- `WorkerBreakdown.tsx` + `PayWorkerModal.tsx`: the "Pay Worker" button (desktop row + both mobile-card spots) opens a QR popup (`workerId`, `workerName`, `totalAmount`, `dateParams`, `onClose`, `onPaid`) instead of the old inline `ConfirmPayButton` confirm. The modal fetches `getWorkerQrCode(workerId)` (`['worker-qr', workerId]`), shows the QR beside the name + amount (skeleton while loading, "No QR code uploaded yet" placeholder when missing — Confirm stays enabled either way; click the code for a near-natural-size lightbox since uploads are often full posters), plus the decoded `upiId` with a `CopyButton` when present, and Confirms through the same `payWorker(workerId, dateParams)` mutation + invalidation before closing; mutation errors surface inside the modal. `ConfirmPayButton` remains in the codebase but the referral/commission flow now uses `PayInviterModal` (`InviterBreakdown.tsx`).
- `InviterBreakdown.tsx` + `PayInviterModal.tsx`: the "Pay Inviter" button (desktop row + both mobile-card spots) opens the inviter QR popup. The modal receives `inviterId`, `inviterName`, `inviterType` and `totalCommission`, fetches `getInviterQrCode(inviterId)` (`['inviter-qr', inviterId]`), and shows the uploaded/generated QR + copyable UPI ID. **Special inviters only:** `computeSpecialInviterPayout` (`payout/utils/specialInviterPayout.ts`) adds the 30% payment bonus; the modal shows **Actual amount**, **Special inviter bonus (+30%)** and **Total to pay**, and the generated `upi://pay` QR uses the total. Normal inviters keep the previous single-amount layout and QR. Confirm runs the unchanged `payInviter(inviterId)` mutation, so the backend records only the actual commission.
- `Commissions.tsx`: muted summary cards, inviter breakdown table/cards with inline inviter details, collapsible Commission History. No Pay All Commissions banner (the `payAllCommissions` API + `PayAllBanner` component are untouched, only the banner UI + its mutation wiring were removed).
- Restore Unpaid Archived + CSV export logic lives on in `PayoutHeader.tsx` / `api/client.ts` but no payout page renders those buttons anymore.
- Date formatters in `payout/utils.ts`.

### OwnerEarnings
Daily + Weekly `EarningsCard` (Tasks, Revenue, Worker Cost, Net Earnings; collapsible Deductions + Referral Activity), Last-30-Days HistoryTable; Refresh; Lock Panel → `/settings`.

### Referrals
List with search + pagination (15/page); **no create UI** (empty state directs to `/referral add` bot command); edit modal (inviter/invitee **IDs** + names + ticket select from live channels; snowflake-validated; inviter change re-derives type + chain server-side); delete with confirm; ticket display resolves `<#id>`/snowflake → live channel name via `getTickets()`. No Pending Invites section (removed 2026-09-10 — detected joins auto-approve server-side; the `getInviteDetections`/`approveInviteDetection`/`rejectInviteDetection`/`updateInviteDetection` client helpers are now **unused by UI**).

### Analytics
7 stat cards (Tasks Today/This Week/Month, Completion %, Avg Completion h, Overdue, Cancelled) + AreaChart (30d) + PieChart (types) + BarChart (employee performance).

### Daily Outreach
`/outreach` — table Ticket | Worker | Post | Daily Limit | Action. **Shows only selected tickets** (rows = `tickets.filter(t => t.selected)`); empty state prompts opening Select Tickets. Page top (no heading — top bar shows "Daily Outreach"): toolbar row `flex-col md:flex-row md:items-center md:justify-between` — info block left on desktop / first on mobile (selected-count `status-badge` pill + "They will receive the daily message.", or "No tickets selected yet — open Select Tickets to add." when 0), buttons right: `Select Tickets` (checkbox modal — first checkboxes in the app, `accent-primary-500`; lists **all** tickets with their current state, draft until Save Selection → `PUT /outreach/selection` — newly checked tickets appear on the page after save, unchecked ones disappear), `Send Message` (confirm dialog → `POST /outreach/send`, disabled with 0 selected; inline ✅/❌ result with per-channel failures), Refresh (fixed icon square). Select Tickets / Send Message are `flex-1 md:flex-none` — full-width split on mobile, with compact mobile sizing (`text-[13px] md:text-sm`, `py-2 md:py-2.5`, `px-3 md:px-6`, smaller icons; desktop unchanged). The modal has a search box filtering by channel or worker name (case-insensitive, resets on open; checkbox draft state is unaffected by filtering). Auto-refresh every 30s (`refetchInterval`). Desktop table + mobile cards (Tasks.tsx pattern). Post = count number in green when `>0`, `X` dark when `0` (count of tasks created today IST, any status). **Daily Limit** = dropdown selector (`2 posts (1 ID)` .. `12 posts (6 IDs)`) allowing workers with multiple Reddit accounts to accept more tasks per day; changes are optimistically saved via `PUT /api/v1/outreach/tickets/:channelId/limit`. Action column allows removing the ticket from outreach (`DELETE /outreach/tickets/:channelId`). The legacy Portal, Available, and Comment columns were cleaned up to streamline the daily outreach workflow.

### Automation
`/automation` — auto-accept control panel. Status badge (Live/Dry run/Stopped) + Run Cycle Now / Stop / Refresh; stat cards (last cycle eligible/confirmed/accepted, blocked count); Browser Watcher card (online pill, last-seen/version, fresh sightings, pending claims with task→ticket rows); Switches (enabled/dry-run/server-polling-dormant checkboxes → `PUT /automation/settings`); Manual Single-Task Test card (test-contact/test-accept, 3-step); **Rehearse card** (task ID + ticket + optional subreddit + Live checkbox with confirm → `POST /automation/rehearse`); Blocked Subreddits editor (add with optional reason, per-row remove; exact match); GoPartTime Session paste (encrypted vault); Recent Cycles desktop table (detected/eligible/confirmed/**accepted**) + mobile cards, row click → drill-down (worker contacts, per-task decisions, **linked blasts with slots filled/total + task IDs**). Auto-refresh 30–60s per query (`refetchInterval`).

### Settings
Theme picker (**stub — no effect**; `<html class="dark">` is hardcoded); Payout Rates editor; static Reminder Delays + Retry Configuration cards; Commission Rates editor; **Daily Outreach Message editor** (textarea ≤2000 chars → `PUT /outreach/settings`; hint notes `{user}` tags the ticket's worker); Danger Zone PIN modal → OwnerEarnings.

## 6. Components

- `Layout.tsx`: sidebar (10 nav items, no admin gating; flat `#111418` bg, muted 13px items, blue-muted active pill + indicator bar), mobile off-canvas drawer + hamburger, auto-hiding header on scroll, PWA install button (`beforeinstallprompt`), logout. Content constrained to `max-w-[1200px]`.
- `CopyButton.tsx`: clipboard with execCommand fallback, "Copied!" 1.5s.
- `TicketLink.tsx`: ticket label (`#name`, else channel ID) that opens `https://discord.com/channels/<guildId>/<channelId>` in a new tab (`noopener noreferrer`); identical at rest, underline + link color on hover; falls back to plain text when either ID is missing. `guildId` comes from the `GET /tasks` list response.
- `ProtectedRoute.tsx`: auth gate.

## 7. PWA & Static

- `manifest.json` (name "Reddit Task Manager", standalone), `sw.js`: precache shell; **`/api/` → network-first with offline 503 fallback**; navigations → network-first → cached index.html; static → cache-first.
- Icons: favicon/logo/icon-192/icon-512. `index.html`: `<html class="dark">`, no-zoom viewport, Inter font.

## 8. Serving (nginx, `dashboard/nginx.conf`)

- 80 → redirect 301 https (except ACME webroot); 443 server_name `statbot.duckdns.org`, LetsEncrypt certs.
- `/api/` → `proxy_pass http://app:3000` (resolver 127.0.0.11 for Docker DNS); SPA fallback `try_files ... /index.html` (no-store on index.html); `/assets/` immutable 1y; security headers.

## 9. Known UI Quirks

- Theme picker non-functional; OwnerEarnings route JWT-only; `getUpcomingReminders`/`getHealth`/`getExportCsvUrl`/`createReferral` client fns unused.
- Green row wash means `deleted_later` in Tasks but "replied" in Daily Outreach (pre-existing semantic collision, kept).

## 10. Admin Design System (premium redesign, DEPLOYED 2026-10-02 at `bafeede`, dashboard-only rebuild)

Worker portal (`worker/*`, `--wp-*` tokens, Sora display face, `wallet-gradient`) is explicitly out of scope and untouched.

- **Tokens** (`tailwind.config.js`): remapped `dark` scale to the app hierarchy (`950 #0B0D0F` → `900 #111418` → `800 #171B20`, borders `700 #272D35`, text `500 #66707C` / `400/300 #98A1AD` / `50 #F2F4F7`); `primary` centered on `#6C8CFF` (hover `#829EFF`); explicit `background`/`surface`/`appborder`/`text-*` colors plus `success #4CAF82` / `warning #D6A85A` / `danger #D66B72` / `info #6C8CFF` with `*-muted` fills; radius 6–12px; `pop`/`subtle` shadows only.
- **Components** (`index.css`): `glass-card`/`stat-card`/`summary-card` (surface + border, no blur/glow), `btn-primary`/`btn-secondary`/`btn-danger` (+ legacy bare `.btn` → secondary), `input-field` (blue focus ring), `status-badge` + `badge-{success,warning,danger,info,neutral}`, `app-table` (muted 12px header on `#111418`), `segmented-control`, `skeleton`, `empty-state`, `modal-panel` (150ms fade+scale, replacing the inert `animate-in` classes), backdrop `bg-black/65`.
- **Conventions**: no gradients/glows in admin chrome, no emoji in badges/notes, compact icon buttons, chevron pagination everywhere, Inter only.

## 11. Worker Portal (`/worker/*` — visual redesign deployed 2026-09-25; home + navigation redesigned 2026-11-02; admin-style cards + theme 2026-11-03)

Read-only self-service portal, visually redesigned on 2026-09-25 without changing its API, routes, data contracts, permissions, or business rules. Lazy-loaded pages remain outside the admin `ProtectedRoute`; the dedicated `workerApi` axios instance and `rtm_worker_token` behavior are unchanged. The admin token still cannot open worker pages.

### Design system

- Worker-only Tailwind tokens live in `dashboard/tailwind.config.js` under `theme.extend.colors.worker`; CSS variables `--wp-*` and reusable classes are in `dashboard/src/index.css`.
- **2026-11-03: the worker palette now mirrors the admin tokens exactly** in both places (`theme.extend.colors.worker` and `--wp-*`): bg `#0B0D0F`, surface `#171B20`, surface-2 `#1D2229`, border `#272D35`, text `#F2F4F7`, muted `#98A1AD`, faint `#66707C`, accent `#6C8CFF`, accent-hover `#829EFF`, success `#4CAF82`, warning `#D6A85A`, danger `#D66B72`, info `#6C8CFF`. The one gradient (`wallet-gradient`) is the admin-primary blend `linear-gradient(135deg, #4A63D8 0%, #6C8CFF 55%, #829EFF 100%)`. Worker pages therefore read as the same product as the admin panel.
- Sora is used for display/heading/number text; Inter remains the body face. Money and counts use `tabular-nums`.
- Worker cards use one 12px radius, 1px `--wp-border` borders, surface-color elevation, and no broad shadow stack. The wallet hero and the matching Home wallet card are the only worker gradients.
- Shared presentational primitives are in `dashboard/src/components/worker/WorkerUI.tsx` and `WorkerTaskCard.tsx`; the existing route entry files remain in place. `WorkerTaskCard.tsx` follows the **admin mobile task-card layout**: a mono bold header (task display id linking to detail) with a status pill on the right, a 3-column metadata strip (`Task ID` / `Created` / `Rate`), a `link` row pointing at the Reddit post (or "No link yet"), an optional action callout with countdown, and a footer with a **View task** button. It intentionally drops the old worker-only insight/payout chips and the subreddit/next-due/reward layout.

### Responsive shell

- **Navigation layout (2026-11-10)**:
  - `≥1024px` (`lg` / PC / desktop): permanent **static left sidebar** (`w-64`, 256px, `sticky top-0 h-screen`, `bg-worker-surface border-r border-worker-border`) containing the brand header ("Reddit Tasks" + logo), navigation tab links (`WorkerNavLink`), and pinned logout footer. The top bar hamburger button is hidden (`lg:hidden`). Top bar displays the page-aware title (`Home` on `/worker`, `Tasks`, `Wallet`, `Invites`, `How-to`, `Task details` on `/worker/tasks/:id`) aligned with the main content container (`max-w-6xl`).
  - `<1024px` (`< lg` / mobile & tablet): sticky **top bar** with hamburger button on the left, opening the left-side slide-out drawer (`288px`, capped at 85vw) with backdrop dismiss, Escape key dismiss, and route-change auto-close.
- `<768px`: 16px page gutters, Home shows the four **stacked full-width KPI cards**, then the wallet card, then Action needed; Tasks keeps only the status tabs (the Completed payment sub-filter was removed 2026-11-03).
- `768–1023px`: mobile shell (top bar + drawer); content grids expand to two columns where appropriate.
- `≥1024px`: static desktop sidebar + top bar; Home/Tasks use `max-w-6xl`/`max-w-5xl`, detail/How-to use `max-w-3xl`; Tasks grid is two columns and becomes three at `≥1440px`.
- New route cross-fade, tab transitions, skeleton pulses, and overdue status dot honor `prefers-reduced-motion`.

| Path | Page | Notes |
|---|---|---|
| `/worker/login` | WorkerLogin | public; a two-tab mode switch — **I have a ticket** (unchanged: ticket finder 3+ chars, ≤5 matches, debounced, last ticket in `rtm_worker_last_ticket` → 8-character code entry with countdown, cooldown-gated Resend, Change ticket) and **I only invite** (Discord username → code sent to their DMs → same 8-character entry, "DMs closed? run /logincode" hint). Both paths land on `/worker`; the index route chooses the inviter Home or the task Home from `/me` capabilities. Inline results, selected-ticket chip, kill-switch panel, no code or identity ever echoed back |
| `/worker` | WorkerIndex → `WorkerHome` / `WorkerInviterHome` | The index route picks from `/me` capabilities: `!hasTasks && (hasInvites || hasTeam)` renders **WorkerInviterHome** (a real inviter Home, added 2026-11-05); everyone else gets **WorkerHome**. The old `/worker → /worker/invites` redirect was removed, so a pure inviter now has a Home tab. While capabilities load, the task Home renders first to avoid a navigation flicker. **WorkerHome (2026-11-02 redesign to the dark mobile mock**, deployed `8908589`; task-mix strip removed 2026-11-03 at `ba03297`; order + wallet restyled 2026-11-03 at `9432edb`; still one `GET /worker/home` @ 60s refetch): no hero, greeting, eyebrow, subtitle or blurb. Order is now **four stacked full-width KPI link cards → the gradient wallet card → Action needed**. The KPI cards match the admin `Dashboard.tsx` `stat-card` style — label top-left, tone icon top-right, 28px number, then a 2px tone track with a 40% fill (Total tasks → `/worker/tasks` blue; Completed → `?tab=completed` green; Paid → `?tab=completed` blue; Insights to submit → `?tab=todo`, amber when > 0 and blue at 0; the loading skeleton is one column). The wallet card shows only "Awaiting payment" + `~₹{estimated}` with a wallet icon, then a divider and two columns **"Last week payment"** and **"Lifetime payment"** (from `walletSnapshot { awaitingEstimated, lastWeekPaid, lifetimePaid }`; `lastWeekPaid` = actual paid for the previous IST payout week). **Action needed** section (empty state = green tick + "Nothing needs your attention right now.", non-empty = urgent action cards with countdowns) with a "View all →" deep-link. No horizontal KPI carousel. Activity-chart follow-up is explicitly not built because it needs a new endpoint |
| `/worker` (inviter) | WorkerInviterHome | **Added 2026-11-05** for ticket-less inviters. Reuses `GET /worker/invites` under the shared `['worker-invites']` query key (no new endpoint), so Home, Wallet and the Invites page share one cache. Blocks: **no greeting header** (removed 2026-11-05); the same three-section wallet card as the ticket Home — **Awaiting payment** (`directPending + chainPending`), then a two-column footer **Last payment** (the most recent commission batch) and **Lifetime payment** (`paid`); three separate stat cards (People invited; Bonus unlocked `qualified of invited`; Total paid); **Next to nudge** — up to 5 unqualified invitees, closest to the threshold first with no-ticket people last, clickable name → profile URL, `n/threshold` or a "No ticket yet" pill, "View all →" to `/worker/invites`, and an empty state; and, for special inviters only, a slim **"Your team: N people, M qualified"** card linking to the Team tab (N/M from `GET /worker/invites/team`'s `total`/`qualified`, fetched only when `capabilities.hasTeam`). The Payment QR card now lives on the inviter Wallet page instead of Home (2026-11-05). No charts, activity feed or new colors |
| `/worker/tasks` | WorkerTasks | To-do/Completed/Failed tabs with counts and **initial `?tab=todo\|completed\|failed` honored from the URL query string** (whitelisted values only, other params ignored; used by the Home deep-links; tab clicks still swap local state only), page-based pagination, responsive task-card grid with `min-w-0`/overflow containment for narrow phones. **2026-11-03 (`9432edb`):** the Completed payment sub-filter (All/Awaiting payment/Paid) is **gone** — completed simply lists every completed task — and each card is the new admin-style `WorkerTaskCard` (display id + status pill, Task ID / Created / Rate strip, Reddit `link`, optional action callout, **View task** button). No visible page heading and **no search/type filters** (removed 2026-11-03 at `ba03297`) |
| `/worker/tasks/:id` | WorkerTaskDetail | status + next-action callout, copyable Reddit link, reminder checklist, payout block, done/future timeline stepper; no inferred current-step state |
| `/worker/wallet` | WorkerWalletRoute → `WorkerWallet` / `WorkerInviterWallet` | The route picks from `/me` capabilities exactly like Home: `!hasTasks && (hasInvites \|\| hasTeam)` renders **WorkerInviterWallet**, everyone else **WorkerWallet**. **WorkerWallet:** **No visible H1/subtitle (removed 2026-11-03)**; the gradient hero is now **only "Awaiting payment" + the estimated amount** (no task count, no billing blurb, no "View payment history" button — removed 2026-11-03 at `9432edb`). Below it a two-column grid of **Last week** and **Lifetime paid** — the **This week** card was removed. Rate hints render the live settings values, which resolve to **₹60 per post** and **₹30 per comment** in production. Then the billing notice and the expandable worker-scoped payment history. **Payment QR card on top**: empty state is a dashed upload area ("Add your payment QR code so you get paid faster" + Upload button, `image/png,image/jpeg,image/webp` picker); uploaded state shows a thumbnail preview (tap for a full-size lightbox), the upload date and a "Change QR code" button that re-uploads over the same file. Client-side type + 3 MB checks with inline errors, loading state during upload, preview refreshed from the response; all requests through `workerApi` (`getWorkerQrCode`/`uploadWorkerQrCode`). **WorkerInviterWallet (added 2026-11-05):** Payment QR card on top, then the same three-section wallet card as the inviter Home (Awaiting / Last / Lifetime), then **Paid in last batch** (amount + `Batch #N · date`), **Total paid** (with the direct/team split for special inviters) and **Awaiting payment** (same split) detail cards, the chain explainer when `teamPaid > 0 \|\| chainPending > 0`, and a payment note. All figures come from the shared `GET /worker/invites` payload |
| `/worker/invites` | WorkerInvites | **2026-11-05: trimmed to just the two invite lists** — the summary cards (people invited / paid in last batch / total paid / awaiting payment), the Payment QR card, the chain explainer strip and the bottom explainer moved to the inviter Wallet page. What remains is an optional `Direct (n) \| Team (m)` segmented control followed by the list. Direct rows: avatar initial, a **clickable invitee name** (opens that person's Discord profile in a new tab via the server-resolved `dmRef` and its `profileUrl`; underlined on hover, disabled while opening, with an inline error on failure), a green mono `# ticket-0036` plus muted `₹X earned` (or "No ticket yet" when unresolved), and **task progress** `n/threshold` with a green tick once qualified. Rows are ordered by progress, then earnings. The Team view (special inviters only, gated on `capabilities.hasTeam`) has a name search, rows showing `via {invitedBy}`, progress with the qualified tick and click-to-DM, a "Load more" pagination button (20/page), and skeleton/empty/error states — no earnings, ticket, or "No ticket yet" wording. The page heading is the top-bar "Invites" title only. Empty state explains how invites appear; no per-invitee drill-down and no rates |
| `/worker/how-to` | WorkerHowTo | **No visible H1/subtitle (removed 2026-11-03)**; guide content with numbered sequence sections and checklist treatment for non-sequential sections. Desktop (≥1024px) shows a sticky table of contents with IntersectionObserver active state. Narrow screens get a sticky **jump-to-section `<select>`** (2026-11-05) instead of the old horizontally scrolling chip strip — one compact 44px row, no horizontal scrollbar, and the selected value follows the section in view. Tapping an option scrolls the card into view (`scroll-mt-32`, `scroll-mt-28` on desktop) |

`WorkerLayout` preserves the existing `/auth/logout` call and its navigation destinations — **five**: Home, Tasks, Wallet, Invites, How-to — now shown in a single **left-side slide-out drawer** opened by the left-hand hamburger in the top bar at every viewport (the 220px desktop sidebar and the mobile bottom nav were removed 2026-11-02; direction changed 2026-11-03). The drawer is 288px (max 85vw) and styled like the admin sidebar: a brand row with `https://statbot.duckdns.org/logo.png` and "Reddit Tasks", a flat icon+label list with a rounded `bg-worker-accent/10` active row (accent icon), and a **red Logout** pinned at the bottom. The worker avatar/"Signed in" block and the ticket link were removed from the footer. **The drawer's ×/close control was also removed (2026-11-03 at `9432edb`):** it now closes only on a route change, Escape or the backdrop, locks body scroll while open, and moves focus to the drawer itself (`tabIndex={-1}`) rather than a close button. The list is **capability-filtered** from `/me`: **Home always** (the index route renders the inviter Home or the task Home); Tasks only when the account has tasks; Wallet when it has tasks, invites **or a team** (the wallet route picks the task or inviter wallet); Invites when `hasInvites || hasTeam`; How-to always. **2026-11-05:** the former `/worker → /worker/invites` redirect was removed, so a ticket-less inviter (`hasTasks:false`) sees **Home, Wallet, Invites, How-to** with `/worker` as the landing page; `WorkerInviterHome` is the Home and `WorkerInviterWallet` is the Wallet. While `/me` is still loading the full list renders, to avoid a nav flicker. The top bar title follows the active route (`Home`/`Tasks`/`Wallet`/`Invites`/`How-to`/`Task details`) and the drawer header keeps the "Reddit Tasks" brand; Tasks/Wallet/How-to no longer render a duplicate page heading, while Invites keeps its own. Worker pages set `<meta name="robots" content="noindex">` while mounted. Never `dangerouslySetInnerHTML`; `manifest.json`/`sw.js` untouched.

### Verification

- `cd dashboard && npm run build` passes (`tsc && vite build`).
- Root `npm run typecheck`, root `npm run build`, and `npm test -- --runInBand` pass (33 suites, 414 tests).
- Root `npm run lint` remains blocked by the pre-existing missing ESLint 9 flat config; no lint configuration was changed in this visual pass.
- Live dashboard deployment verified 2026-09-25 at commit `a667715`: worker routes return SPA 200, new hashed assets return 200, `/api/v1/health` is healthy, worker auth status remains enabled, and unauthenticated `/api/v1/worker/me` remains 401. Home now has no horizontal KPI carousel; Tasks fixes prevent desktop search/filter flex collapse and narrow-mobile horizontal overflow.
