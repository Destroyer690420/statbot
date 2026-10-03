# SECURITY.md — Security Model

> Verified against `src/api/server.ts`, middleware, `src/utils/permissions.ts`, env schema on 2026-08-11. No secrets documented.

---

## 1. Authentication

| Surface | Scheme | Detail |
|---|---|---|
| Dashboard API | JWT (HS256 pinned, `JWT_SECRET`, 24h expiry, `username` must equal `DASHBOARD_USERNAME`) | issued by `POST /auth/login`; payload `{username, iat}`; `Authorization: Bearer`; `POST /auth/verify` enforces the same checks (returns `{valid:false}` otherwise) |
| Worker portal API | Worker JWT (HS256 pinned, **separate** `WORKER_JWT_SECRET` ≥32 chars, 7d expiry) | issued by `POST /worker/auth/verify-code`; claims `typ:'worker'`, `sub` (worker Discord ID), `tid` (login ticket), `name`, `jti`, `aud:'statbot-worker'`, `iss:'statbot'`; Redis denylist on logout; identity comes ONLY from `sub` |
| Discord commands | Discord user IDs in env (`ADMIN_USER_IDS`, `MANAGER_USER_IDS`) | per-command checks via `src/utils/permissions.ts` |
| GoPartTime extension | Shared secret `GOPARTTIME_API_KEY` as Bearer | `crypto.timingSafeEqual` compare; 503 when unconfigured; 401 mismatch; sets `req.userId='goparttime-extension'` |

## 2. Authorization (two admin models — beware inconsistency)

| Check | Basis | Used by |
|---|---|---|
| `requireDashboardAdmin` | `req.userId === env.DASHBOARD_USERNAME` | discord tickets, payouts pay-*, commission referrals + pay-* |
| `isAdmin(userId)` (Discord IDs) | `env.ADMIN_USER_IDS` | settings payout-rates PUT, commission rates PUT |

Managers (`MANAGER_USER_IDS`) are used **only** by the bot, never the API.

## 3. API Protection

- helmet defaults; CORS limited to `DASHBOARD_URL` + `goparttime.net` origins (`credentials: true`).
- **Rate limit**: 100 req / 15 min / IP across the whole `/api/` prefix (`express-rate-limit`; `trust proxy 1`).
- Body limit 1 MB JSON.
- Path-traversal guard on insight image serving (rejects `..`/`/`).
- `sanitize()` strips `<>@&` (used for task content in Discord-facing text).

## 4. Known Weaknesses / Risks (verified)

1. **Unauthenticated endpoints**: `GET /owner/daily-earnings`, `/history`, `/weekly-earnings` (no JWT, no PIN); `GET /uploads/insights/:taskId/:filename` (public by design); `GET /health`.
2. **Owner PIN**: default `'7977'` in `env.ts`; `/owner/verify` returns 200 even for wrong PIN (`{success:false}`) — client relies on `success`; the `/owner-earnings` dashboard route is JWT-only (any logged-in admin who knows the URL can open it; PIN is a soft gate).
3. **JWT holder is trusted for "admin" only when username == DASHBOARD_USERNAME** — enforced in `authMiddleware` (HS256 pinned; any other username → 401), so worker tokens (separate secret, no admin username) can never pass admin routes.
4. **Rate limit** also throttles `/health` and `/auth/login` (operational nuance, not a vuln).
5. Insight images are unauthenticated and TTL'd 60h (accepted design tradeoff).
6. Shared `GOPARTTIME_API_KEY` for all workers — no per-user identity on the extension channel.
7. `dist/` and `src/generated/prisma` are regenerated at build — do not trust stale copies.
8. No audit of failed logins beyond a warn log.

## 5. Secrets Management

- `.env` gitignored; compose `env_file`; **never log or document values**.
- Known secret-bearing files present in the working tree: `query-tasks.ts` / `query-tasks.js` (hardcoded DB password — untracked, delete recommended), `ssh-key-2026-07-19.key` (private key — gitignored, delete recommended), `.env` (gitignored).
- Old Firebase service-account key file name in `.gitignore` (legacy).

## 6. Input Validation

- zod schemas: `goPartTimePayloadSchema` (shared), per-route schemas in tasks/settings/commissions routes; `validateBody`/`validateQuery` middleware returns 400 with `errors[]`.
- Manual validation where noted: `/auth/login`, `/reminders/:id` PATCH (`dueAt` parse), `/owner/verify`.
- Task validators: Reddit URL pattern, task-ID pattern, notes ≤500, image extensions, snowflake pattern.

## 7. File Upload / Storage

- Insight screenshots: downloaded from Discord CDN by the server (no client upload endpoint); written to `uploads/insights/<taskId>/`; served read-only with traversal checks; 60h TTL cleanup.
- Worker payment QR codes: the one client upload endpoint (`POST /api/v1/worker/wallet/qr-code`, worker JWT + 10/hour/worker, base64 data URL in JSON). Written to `uploads/payment-qr/<workerId>.<ext>` (one current file per worker, no TTL); served read-only via `GET /api/v1/uploads/payment-qr/:workerId/:filename` (unauthenticated like insight serving, traversal-guarded plus a strict `<workerId>.<ext>` name match). Validation is server-side via sharp-sniffed format (PNG/JPEG/WebP only — declared MIME never trusted), a 3 MB decoded cap, and a full-decode check before saving.
- No other arbitrary file upload endpoints exist.

## 8. Database Security

- Single app DB user via `DATABASE_URL`; RESTRICT FKs protect paid-task/commission rows from accidental deletion; no raw SQL beyond `SELECT 1` health probe; Prisma parameterizes queries.
- No encryption-at-rest or TLS-to-DB info in repo (UNKNOWN).

## 9. Discord-Specific

- Bot intents kept minimal-ish (MessageContent needed for reply parsing); commands guild-scoped to reduce abuse surface; destructive commands admin-only with interactive confirm (`/delete`); overdue pings go to admins+managers.
- No permission-system hardening in ticket channels assumed — anything in the guild can use `/status`, `/find`, `/help`.

## 10. Recommended Follow-Ups (see ROADMAP/KNOWN_ISSUES)

- Gate owner-earnings endpoints with JWT (+ keep PIN); rotate the default PIN.
- Delete the stray credential-bearing debug scripts and SSH key.
- Consider per-worker extension tokens; role claims in JWTs.
- Fix stale `.env.example`.

## 11. Worker Portal Model (deployed 2026-09-24; visual redesign deployed 2026-09-25; access telemetry deployed 2026-09-25 at `675c618`)

- **Separate secret**: worker JWTs use `WORKER_JWT_SECRET` (portal disabled unless set and ≥32 chars); the admin middleware pins HS256 and requires `username === DASHBOARD_USERNAME`, and `/verify` matches — a worker token fails every admin route.
- **Identity from `sub` only**: the sole client-supplied identifier is `channelId` on the unauthenticated login endpoints. All data queries filter `assignedUserId = sub`; a foreign task returns the same 404 as a missing one. No endpoint accepts a worker id.
- **Whitelist DTOs** (`src/utils/worker-view.ts`): responses never spread DB rows. Forbidden everywhere (responses, errors, logs-to-client): other workers' IDs/names/tickets/tasks/earnings, GoPartTime USD `payment`, owner revenue/margins/commissions, batch totals (`totalWorkers/totalAmount`), notes, `contentHtml`, `taskImages`, screenshot URLs, delivery/assignment internals, reviewer identity, audit logs, `jobId`/`reminderMessageId`.
- **Accepted ticket-OTP risks**: anyone who can read a ticket (worker + staff) can see a posted code, and anyone can trigger a code for a findable ticket — bounded by the single-active-code rule, 60s cooldown, 5 codes/ticket/hour, 5-attempt invalidation, 10-failure hourly lock, message deletion on success/invalidation/expiry, and per-IP rate limits. Codes are HMAC-SHA256'd (never stored raw); Redis failure fails closed (503); codes/tokens/secrets are never logged.
- **Kill switch**: `WORKER_PORTAL_ENABLED` (default off). When off, `/worker/*` (except `/auth/status`) returns 404.
- **Portal access telemetry (admin-only)**: successful ticket-OTP logins are recorded per ticket in `WorkerPortalAccess` (`firstSeenAt`/`lastSeenAt`); the fields are returned only through the admin-protected outreach endpoint and are never included in worker DTOs, tokens, OTPs, or worker logs.
- **Referral visibility (`/worker/invites`)**: a worker sees only the referrals they personally created (closed ones excluded) — display name, ticket *number*, task progress and money earned from that person. Deliberately withheld: the invitee's Discord id, every referral/commission id, `commissionKind`, `inviterType`, commission rates, and the identity, ticket, or task behind multi-level earnings, which are reported as a single anonymous `teamPaid` total. A stored ticket reference is a channel mention or snowflake in most rows, so it is resolved through recorded task channel names and returns `null` when unknown — an id or raw `<#…>` can never reach a worker. `WORKER_FORBIDDEN_FIELDS` enforces all of this and is asserted for every endpoint in `worker-isolation.test.ts`.
- **Ticket-less inviter login (2026-09-26)**: an identity path that does **not** go through `Task.assignedUserId`, so it is deliberately narrow:
  - **Proof of account** is a one-time code delivered by **DM**, not posted in a channel. A DM requires control of the Discord account, which is strictly stronger than the ticket-channel code (any member who can read a ticket can see that one).
  - Codes are namespaced per user (`inviter:<userId>`), HMAC-only, single-use, 5-min TTL, 60s cooldown, 5/hour, 5 wrong attempts, hourly lockout — the same guards as ticket codes, so an inviter code can never collide with or lock out a ticket code.
  - **No enumeration**: an unknown, non-member, or invite-less username receives a byte-identical 200 response and no DM, so the endpoint reveals nothing about who exists or who has invites.
  - A code is only verifiable by the account it was sent to (the username is re-resolved server-side at verify time); a wrong username cannot redeem someone else's code.
  - IP rate limits (10 request / 30 verify per 10 min) bound DM spam.
  - **Scope separation**: inviter tokens carry `scope:'inviter'` and an empty `tid`; only they may omit a ticket. They are still worker tokens (same secret, `typ`, aud/iss) and are denylisted by `logout` like any other.
  - Still no guild-member enumeration at login and no owner/admin fields; a pure inviter's task and wallet surfaces are simply empty because they have no tasks.
- **Invitee DM links (`POST /worker/invites/dm`)**: the browser cannot be trusted with an invitee id, and Discord exposes no client-side way to derive a DM channel id (verified: the sorted-id-concatenation shortcut does **not** match real ids), so the lookup is server-side. Each row ships only `dmRef`, a 16-hex HMAC of `(workerId, inviteeId)` under the worker-portal secret: it is not reversible, is useless to any other worker (the server only recomputes refs across the caller's own non-closed referrals), and reveals nothing — a caller cannot even learn whether a given person is an invitee without already holding their ref. The bot's DM channel is created on demand via `POST /users/@me/channels`, which sends no message; the invitee's id never leaves the server. Rate limited to 30/10 min per IP, and neither the id nor the ref is logged.