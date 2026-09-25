# FRONTEND.md — Admin Dashboard

> Verified against `dashboard/src/**`, `dashboard/package.json`, `dashboard/vite.config.ts`, `dashboard/nginx.conf` on 2026-09-25 (worker visual redesign section re-verified after deployment).

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
`login`, `getTasks`, `getTask`, `deleteTask`, `updateTask`, `doneTask`, `reassignTask`, `retryAssignment`, `submitTaskUrl`, `recheckFormat`, `getTickets`, `getReminders`, `getStats`, `getDailyStats`, `getTypeDistribution`, `getEmployeePerformance`, `downloadCsv`, `getOutreach`, `getOutreachSettings`, `updateOutreachSettings`, `saveOutreachSelection`, `sendOutreachMessage`, `getAutomationStatus`, `updateAutomationSettings`, `startAutomationCycle`, `stopAutomation`, `getAutomationCycles`, `getAutomationCycle`, `getBlockedSubreddits`, `addBlockedSubreddit`, `removeBlockedSubreddit`, `saveAutomationSession`, `sendTestContact`, `sendTestAccept`, `sendRehearse`, `getAutomationCompanion`, `getAutomationClaims`, `getPayoutWeek/Summary/Eligible/WorkerDetail`, `payWorker`, `payAll`, `getBatchHistory/Detail`, `downloadPayoutCsv`, `get/updatePayoutRates`, `getCommissionSummary/Breakdown/InviterDetail`, `getReferrals`, `createReferral` (**unused by UI**), `deleteReferral`, `updateReferral`, `payInviter`, `payAllCommissions`, `get/updateCommissionRates`, `getCommissionBatchHistory/Detail`, `getInviteDetections`, `approveInviteDetection`, `rejectInviteDetection`, `updateInviteDetection`, `downloadCommissionCsv`, `restoreUnpaidArchived`, `verifyOwnerPin`, `getDailyEarnings`, `getDailyEarningsHistory`, `getWeeklyEarnings`.
Unused API functions: `getUpcomingReminders`, `getExportCsvUrl`, `getHealth`, `createReferral`.

## 5. Pages

### Dashboard
Server stat cards (Total/Pending/Completed/Overdue) + AreaChart (7-day activity) + client-side today stats from full task list (Today's Posts/Comments/Deleted, Total Deleted; `cancelledReason` `deleted|deleted_later` = deleted).

### Tasks
Search (id, url, channel), 15/page client-side pagination, status filter; desktop table / mobile cards. Actions: cancelledReason dropdown (OK/Deleted/Deleted Later → PATCH), Download latest insight image, Copy submitted link, View, Delete (confirm). CSV export.

### TaskDetails
Task info + GoPartTime external block (assignmentStatus badge, Retry Delivery on FAILED, error text, externalTaskId/subreddit/flair/payment/deadline/sourceUrl/postLink/formattedContent/taskImages grid) + Submission section (record/replace URL, Mark as Done when ACCEPTED, format-check badge + checked-at + diff modal) + Reminder Timeline (built from `RETRY_DELAYS` 2h/6h assumptions) + Submitted Screenshots (each reminder's `insightImageUrl`, click-to-open, download).

### AcceptedTasks
Queue of ACCEPTED tasks; Reassign (ticket select with `(busy)` marker for `awaiting-submission` channels), Done (activation), copy link, delete; 15/page. **Format column** (`FormatBadge` from the stored `formatCheckStatus/Detail` — 🟢 Match, 🔴 para mismatch, 🟡 title/text mismatch, ⚠️ verify-failed, — for comments, No URL/Unchecked otherwise; mismatch badges open `FormatDiffModal`: browser-direct live Reddit fetch vs delivered content, per-paragraph highlighting, title row, server-side Recheck button → `POST /tasks/:id/recheck-format`). No in-page heading (top bar shows "Accepted Tasks"; "N queued" badge top-right).

### Archives
Read-only ARCHIVED list + search + CSV; table-only (scrolls horizontally).

### Payments (`dashboard/src/pages/payout/`)
Modular redesign split across 17 clean components:
- `PayoutLayout.tsx`: Header, sub-navigation tabs (`/payout/tasks` & `/payout/commissions`), segmented-control DateFilter (Previous/Current/All/Custom), shared week query & Outlet context.
- `TaskPayments.tsx`: Color-accented summary cards, Pay All banner, worker breakdown table (desktop) / cards (mobile) with inline accordion worker details, collapsible Payout History.
- `Commissions.tsx`: Color-accented summary cards, Pay All Commissions banner, inviter breakdown table/cards with inline inviter details, collapsible Commission History.
- Restore Unpaid Archived button & CSV exports per tab.
- Date formatters in `payout/utils.ts`.

### OwnerEarnings
Daily + Weekly `EarningsCard` (Tasks, Revenue, Worker Cost, Net Earnings; collapsible Deductions + Referral Activity), Last-30-Days HistoryTable; Refresh; Lock Panel → `/settings`.

### Referrals
List with search + pagination (15/page); **no create UI** (empty state directs to `/referral add` bot command); edit modal (inviter/invitee **IDs** + names + ticket select from live channels; snowflake-validated; inviter change re-derives type + chain server-side); delete with confirm; ticket display resolves `<#id>`/snowflake → live channel name via `getTickets()`. No Pending Invites section (removed 2026-09-10 — detected joins auto-approve server-side; the `getInviteDetections`/`approveInviteDetection`/`rejectInviteDetection`/`updateInviteDetection` client helpers are now **unused by UI**).

### Analytics
7 stat cards (Tasks Today/This Week/Month, Completion %, Avg Completion h, Overdue, Cancelled) + AreaChart (30d) + PieChart (types) + BarChart (employee performance).

### Daily Outreach
`/outreach` — table Ticket | Worker | Available | Post | Comment. **Shows only selected tickets** (rows = `tickets.filter(t => t.selected)`); empty state prompts opening Select Tickets. Page top (no heading — top bar shows "Daily Outreach"): toolbar row `flex-col md:flex-row md:items-center md:justify-between` — info block left on desktop / first on mobile (selected-count `status-badge` pill + "They will receive the daily message.", or "No tickets selected yet — open Select Tickets to add." when 0), buttons right: `Select Tickets` (checkbox modal — first checkboxes in the app, `accent-primary-500`; lists **all** tickets with their current state, draft until Save Selection → `PUT /outreach/selection` — newly checked tickets appear on the page after save, unchecked ones disappear), `Send Message` (confirm dialog → `POST /outreach/send`, disabled with 0 selected; inline ✅/❌ result with per-channel failures), Refresh (fixed icon square). Select Tickets / Send Message are `flex-1 md:flex-none` — full-width split on mobile, with compact mobile sizing (`text-[13px] md:text-sm`, `py-2 md:py-2.5`, `px-3 md:px-6`, smaller icons; desktop unchanged). Auto-refresh every 30s (`refetchInterval`). Desktop table + mobile cards (Tasks.tsx pattern). Status: `Available` = `Check` green / `X` dark; `Post`/`Comment` = count number in green when `>0`, `X` dark when `0` (counts of tasks created today IST, any status).

### Automation
`/automation` — auto-accept control panel. Status badge (Live/Dry run/Stopped) + Run Cycle Now / Stop / Refresh; stat cards (last cycle eligible/confirmed/accepted, blocked count); Browser Watcher card (online pill, last-seen/version, fresh sightings, pending claims with task→ticket rows); Switches (enabled/dry-run/server-polling-dormant checkboxes → `PUT /automation/settings`); Manual Single-Task Test card (test-contact/test-accept, 3-step); **Rehearse card** (task ID + ticket + optional subreddit + Live checkbox with confirm → `POST /automation/rehearse`); Blocked Subreddits editor (add with optional reason, per-row remove; exact match); GoPartTime Session paste (encrypted vault); Recent Cycles desktop table (detected/eligible/confirmed/**accepted**) + mobile cards, row click → drill-down (worker contacts, per-task decisions, **linked blasts with slots filled/total + task IDs**). Auto-refresh 30–60s per query (`refetchInterval`).

### Settings
Theme picker (**stub — no effect**; `<html class="dark">` is hardcoded); Payout Rates editor; static Reminder Delays + Retry Configuration cards; Commission Rates editor; **Daily Outreach Message editor** (textarea ≤2000 chars → `PUT /outreach/settings`; hint notes `{user}` tags the ticket's worker); Danger Zone PIN modal → OwnerEarnings.

## 6. Components

- `Layout.tsx`: sidebar (10 nav items, no admin gating), mobile off-canvas drawer + hamburger, auto-hiding header on scroll, PWA install button (`beforeinstallprompt`), logout.
- `CopyButton.tsx`: clipboard with execCommand fallback, "Copied!" 1.5s.
- `ProtectedRoute.tsx`: auth gate.

## 7. PWA & Static

- `manifest.json` (name "Reddit Task Manager", standalone), `sw.js`: precache shell; **`/api/` → network-first with offline 503 fallback**; navigations → network-first → cached index.html; static → cache-first.
- Icons: favicon/logo/icon-192/icon-512. `index.html`: `<html class="dark">`, no-zoom viewport, Inter font.

## 8. Serving (nginx, `dashboard/nginx.conf`)

- 80 → redirect 301 https (except ACME webroot); 443 server_name `statbot.duckdns.org`, LetsEncrypt certs.
- `/api/` → `proxy_pass http://app:3000` (resolver 127.0.0.11 for Docker DNS); SPA fallback `try_files ... /index.html` (no-store on index.html); `/assets/` immutable 1y; security headers.

## 9. Known UI Quirks

- `w-4.5 h-4.5` classes have no Tailwind definition (icons render default size).
- `animate-in fade-in`/`zoom-in-95` classes inert (tailwindcss-animate not installed).
- Theme picker non-functional; OwnerEarnings route JWT-only; `getUpcomingReminders`/`getHealth`/`getExportCsvUrl`/`createReferral` client fns unused.

## 10. Worker Portal (`/worker/*` — visual redesign deployed 2026-09-25)

Read-only self-service portal, visually redesigned on 2026-09-25 without changing its API, routes, data contracts, permissions, or business rules. Lazy-loaded pages remain outside the admin `ProtectedRoute`; the dedicated `workerApi` axios instance and `rtm_worker_token` behavior are unchanged. The admin token still cannot open worker pages.

### Design system

- Worker-only Tailwind tokens live in `dashboard/tailwind.config.js` under `theme.extend.colors.worker`; CSS variables `--wp-*` and reusable classes are in `dashboard/src/index.css`.
- Sora is used for display/heading/number text; Inter remains the body face. Money and counts use `tabular-nums`.
- Worker cards use one 12px radius, 1px `--wp-border` borders, surface-color elevation, and no broad shadow stack. The wallet hero is the only worker gradient.
- Shared presentational primitives are in `dashboard/src/components/worker/WorkerUI.tsx` and `WorkerTaskCard.tsx`; the existing route entry files remain in place.

### Responsive shell

- `<768px`: sticky worker identity/ticket header, four-item bottom navigation, 16px page gutters, horizontally scrollable Home KPI row, bottom-sheet Tasks filters.
- `768–1023px`: bottom navigation remains; content grids expand to two columns where appropriate.
- `≥1024px`: 220px left sidebar replaces bottom navigation; slim page-title header remains; Home/Tasks/Wallet use `max-w-5xl`, detail/How-to use `max-w-3xl`; Tasks grid is two columns and becomes three at `≥1440px`.
- New route cross-fade, tab transitions, skeleton pulses, and overdue status dot honor `prefers-reduced-motion`.

| Path | Page | Notes |
|---|---|---|
| `/worker/login` | WorkerLogin | public; ticket finder (3+ chars, ≤5 matches, debounced, last ticket in `rtm_worker_last_ticket`) → 8-character code entry (autofocus, auto-uppercase, `one-time-code`, expiry countdown, cooldown-gated Resend, Change ticket); inline results and selected-ticket chip; skips ahead when a valid worker token exists; shows "Worker portal is not available" when disabled |
| `/worker` | WorkerHome | greeting, four primary KPI cards, three secondary totals, urgent action cards with countdowns, wallet teaser; refetch 60s. Activity-chart follow-up is explicitly not built because it needs a new endpoint |
| `/worker/tasks` | WorkerTasks | To-do/Completed/Failed tabs with counts, Completed sub-filter, mobile filter sheet/desktop inline filters, debounced server search, page-based pagination, insight and payout chips, responsive task-card grid |
| `/worker/tasks/:id` | WorkerTaskDetail | status + next-action callout, copyable Reddit link, reminder checklist, payout block, done/future timeline stepper; no inferred current-step state |
| `/worker/wallet` | WorkerWallet | gradient awaiting-payment hero, This/Last week cards, lifetime paid, rates, billing notice, expandable worker-scoped payment history |
| `/worker/how-to` | WorkerHowTo | unchanged guide content with numbered sequence sections, checklist treatment for non-sequential sections, mobile jump chips, desktop table of contents with IntersectionObserver active state |

`WorkerLayout` preserves the existing `/auth/logout` call and four navigation destinations. Worker pages set `<meta name="robots" content="noindex">` while mounted. Never `dangerouslySetInnerHTML`; `manifest.json`/`sw.js` untouched.

### Verification

- `cd dashboard && npm run build` passes (`tsc && vite build`).
- Root `npm run typecheck`, root `npm run build`, and `npm test -- --runInBand` pass (33 suites, 414 tests).
- Root `npm run lint` remains blocked by the pre-existing missing ESLint 9 flat config; no lint configuration was changed in this visual pass.
- Live dashboard deployment verified 2026-09-25 at commit `a48e404`: worker routes return SPA 200, new hashed assets return 200, `/api/v1/health` is healthy, worker auth status remains enabled, and unauthenticated `/api/v1/worker/me` remains 401.
