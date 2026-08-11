# SECURITY.md — Security Model

> Verified against `src/api/server.ts`, middleware, `src/utils/permissions.ts`, env schema on 2026-08-11. No secrets documented.

---

## 1. Authentication

| Surface | Scheme | Detail |
|---|---|---|
| Dashboard API | JWT (HS256, `JWT_SECRET`, 24h expiry) | issued by `POST /auth/login` from `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`; payload `{username, iat}`; `Authorization: Bearer` |
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
3. **JWT holder is trusted for "admin" only when username == DASHBOARD_USERNAME** — the token itself carries no roles; any future multi-user JWT would need role claims.
4. **Rate limit** also throttles `/health` and `/auth/login` (operational nuance, not a vuln).
5. Insight images are unauthenticated and TTL'd 30h (accepted design tradeoff).
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

- Insight screenshots: downloaded from Discord CDN by the server (no client upload endpoint); written to `uploads/insights/<taskId>/`; served read-only with traversal checks; 30h TTL cleanup.
- No arbitrary file upload endpoints exist.

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