# ENVIRONMENT.md — Environment Variables

> Source of truth: `src/config/env.ts` (zod schema, loaded at boot) + `prisma.config.ts`. Values are NEVER documented. The `.env.example` is **stale** (lists removed `FIREBASE_*`, missing `DATABASE_URL`) — trust `env.ts` first.

## 1. Variables Required by `src/config/env.ts`

| Name | Purpose | Required | Default | Used by |
|---|---|---|---|---|
| `DISCORD_TOKEN` | Discord bot authentication | Yes | — | `src/bot/index.ts`, `deploy-commands.ts` |
| `CLIENT_ID` | Bot application ID for command registration | Yes | — | `src/bot/deploy-commands.ts` |
| `GUILD_ID` | Server where commands are registered & tasks live | Yes | — | deploy-commands, task queries |
| `ADMIN_USER_IDS` | Comma-separated Discord user IDs (full access) | Yes | — | `src/utils/permissions.ts` |
| `MANAGER_USER_IDS` | Comma-separated Discord user IDs (limited admin) | No | `''` | permissions.ts (`isAdminOrManager`, pings, worker detection) |
| `MODERATOR_USER_IDS` | Comma-separated Discord user IDs (ticket helpers; excluded from worker detection, no command access) | No | `''` | permissions.ts (`isModerator`, `getAllAdminIds`) |
| `DATABASE_URL` | PostgreSQL connection string (Prisma adapter) | Yes | — | `src/database/db.ts`, `prisma.config.ts` |
| `REDIS_URL` | Redis connection for BullMQ (e.g. `redis://...`) | Yes | — | `src/scheduler/queue.ts`, `worker.ts` |
| `JWT_SECRET` | HS256 secret for dashboard JWTs | Yes (min 16 chars) | — | `src/api/routes/auth.ts`, `middleware/auth.ts` |
| `DASHBOARD_USERNAME` | Single dashboard login username | No | `admin` | auth routes, admin gates |
| `DASHBOARD_PASSWORD` | Dashboard login password | Yes | — | auth routes |
| `PORT` | Express listen port | No | `3000` | `startApiServer` |
| `NODE_ENV` | `development\|production\|test` | No | `development` | error handler, logger transports |
| `LOG_LEVEL` | `error\|warn\|info\|debug` | No | `info` | winston |
| `DASHBOARD_URL` | Allowed CORS origin (dashboard) | No | `http://localhost:5173` | `src/api/server.ts` |
| `GOPARTTIME_API_KEY` | Shared Bearer secret for the userscript | No | `''` (endpoint disabled → 503) | `src/api/middleware/extensionAuth.ts`, userscript settings |
| `OWNER_PIN` | PIN for the owner panel (4-digit) | No | `'7977'` | `src/api/routes/owner.ts` |

## 2. Dashboard Variables (`dashboard/`)

| Name | Purpose | Default | Used by |
|---|---|---|---|
| `VITE_API_TARGET` | Vite dev proxy target for `/api` | `https://161.118.164.85` | `dashboard/vite.config.ts` |

(Production dashboard has no env vars — nginx proxies `/api/` to the backend container.)

## 3. Removed / Legacy (do NOT reintroduce without reason)

| Name | Status |
|---|---|
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Removed from `env.ts` in `57338de` (2026-07-26) after Firestore cutover; still listed in the stale `.env.example` |
| `DATABASE_URL` hardcoded in docker-compose | Removed in `afb2954` (uses server `.env`) |

## 4. Notes

- Config example file `.env.example` misses `DATABASE_URL` (required) and lists `FIREBASE_*` — update it when touching envs (see KNOWN_ISSUES.md).
- `docker-compose.yml` uses `env_file: .env` for the backend service.
- The userscript prompts for the same `GOPARTTIME_API_KEY` at setup (stored in GM/localStorage — not an env var).