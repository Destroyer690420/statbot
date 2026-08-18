# FRONTEND.md — Admin Dashboard

> Verified against `dashboard/src/**`, `dashboard/package.json`, `dashboard/vite.config.ts`, `dashboard/nginx.conf` on 2026-08-18.

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
`login`, `getTasks`, `getTask`, `deleteTask`, `updateTask`, `doneTask`, `reassignTask`, `retryAssignment`, `submitTaskUrl`, `getTickets`, `getReminders`, `getStats`, `getDailyStats`, `getTypeDistribution`, `getEmployeePerformance`, `downloadCsv`, `getOutreach`, `getOutreachSettings`, `updateOutreachSettings`, `saveOutreachSelection`, `sendOutreachMessage`, `getPayoutWeek/Summary/Eligible/WorkerDetail`, `payWorker`, `payAll`, `getBatchHistory/Detail`, `downloadPayoutCsv`, `get/updatePayoutRates`, `getCommissionSummary/Breakdown/InviterDetail`, `getReferrals`, `createReferral` (**unused by UI**), `deleteReferral`, `updateReferral`, `payInviter`, `payAllCommissions`, `get/updateCommissionRates`, `getCommissionBatchHistory/Detail`, `downloadCommissionCsv`, `restoreUnpaidArchived`, `verifyOwnerPin`, `getDailyEarnings`, `getDailyEarningsHistory`, `getWeeklyEarnings`.
Unused API functions: `getUpcomingReminders`, `getExportCsvUrl`, `getHealth`, `createReferral`.

## 5. Pages

### Dashboard
Server stat cards (Total/Pending/Completed/Overdue) + AreaChart (7-day activity) + client-side today stats from full task list (Today's Posts/Comments/Deleted, Total Deleted; `cancelledReason` `deleted|deleted_later` = deleted).

### Tasks
Search (id, url, channel), 15/page client-side pagination, status filter; desktop table / mobile cards. Actions: cancelledReason dropdown (OK/Deleted/Deleted Later → PATCH), Download latest insight image, Copy submitted link, View, Delete (confirm). CSV export.

### TaskDetails
Task info + GoPartTime external block (assignmentStatus badge, Retry Delivery on FAILED, error text, externalTaskId/subreddit/flair/payment/deadline/sourceUrl/postLink/formattedContent/taskImages grid) + Submission section (record/replace URL, Mark as Done when ACCEPTED) + Reminder Timeline (built from `RETRY_DELAYS` 2h/6h assumptions) + Submitted Screenshots (each reminder's `insightImageUrl`, click-to-open, download).

### AcceptedTasks
Queue of ACCEPTED tasks; Reassign (ticket select with `(busy)` marker for `awaiting-submission` channels), Done (activation), copy link, delete; 15/page.

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
Daily + Weekly `EarningsCard` (Tasks, Revenue, Worker Cost, Net Earnings; collapsible Deductions + Referral Activity), Last-7-Days HistoryTable; Refresh; Lock Panel → `/settings`.

### Referrals
List with search + pagination (15/page); **no create UI** (empty state directs to `/referral add` bot command); edit modal (names + ticket select from live channels); delete with confirm; ticket display resolves `<#id>`/snowflake → live channel name via `getTickets()`.

### Analytics
7 stat cards (Tasks Today/This Week/Month, Completion %, Avg Completion h, Overdue, Cancelled) + AreaChart (30d) + PieChart (types) + BarChart (employee performance).

### Daily Outreach
`/outreach` — table Ticket | Worker | Available | Post | Comment. **Shows only selected tickets** (rows = `tickets.filter(t => t.selected)`); empty state prompts opening Select Tickets. Toolbar: `Select Tickets` (checkbox modal — first checkboxes in the app, `accent-primary-500`; lists **all** tickets with their current state, draft until Save Selection → `PUT /outreach/selection` — newly checked tickets appear on the page after save, unchecked ones disappear), `Send Message` (confirm dialog → `POST /outreach/send`, disabled with 0 selected; inline ✅/❌ result with per-channel failures), Refresh. Auto-refresh every 30s (`refetchInterval`). Desktop table + mobile cards (Tasks.tsx pattern). Status icons: `Check` green / `X` dark. Subtitle shows today's IST date (resets at 12:00 AM IST).

### Settings
Theme picker (**stub — no effect**; `<html class="dark">` is hardcoded); Payout Rates editor; static Reminder Delays + Retry Configuration cards; Commission Rates editor; **Daily Outreach Message editor** (textarea ≤2000 chars → `PUT /outreach/settings`); Danger Zone PIN modal → OwnerEarnings.

## 6. Components

- `Layout.tsx`: sidebar (9 nav items, no admin gating), mobile off-canvas drawer + hamburger, auto-hiding header on scroll, PWA install button (`beforeinstallprompt`), logout.
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