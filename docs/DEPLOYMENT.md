# DEPLOYMENT.md — Deployment & Infrastructure

> Verified against `Dockerfile`, `docker-compose.yml`, `dashboard/Dockerfile`, `dashboard/nginx.conf`, `ecosystem.config.js`, `prisma.config.ts` on 2026-08-11. No secrets/values documented. **Deployment status last verified: 2026-09-03 — live deploy at git HEAD `e60ed28`** (invite auto-detection approval queue — app + dashboard rebuild; `InviteDetection` migration excerpt; backfill 49 staged since 2026-08-29 + 49 audits repaired; health + All systems online verified; task counts unchanged). Previous deploys: `ca4471e` (same feature, first cut — superseded same day by the `INVITE_*` schema fix), `a1c4fe6` (GoPartTime image-only posts v1.4.3), `c206c5d` (member join welcome — app-only rebuild), `454fafa` (ticket onboarding guide — app-only rebuild + `TicketOnboarding` table), `50f4378` (ticket auto-welcome — app-only rebuild), `346fec7` (outreach post/comment counts — app + dashboard rebuild), `72e264c` (multi-level indirect referral fix — app-only rebuild + host-run backfill script), `fd69a2d` (Outreach mobile button polish), `8252e35` (outreach top toolbar polish), `d52ee94` (redundant page headers removed), `27738d4` (outreach selected-only display), `4f1b84c` (Daily Worker Outreach — app + dashboard, schema migration applied), `44df94b` (Activity page removed — dashboard-only), `0fa702c` (reassign ticket-picker modal fix), `b98bf68` (userscript v1.4.0 mobile-disable), `138c317` (userscript v1.3.0 preview), `cba8a35` (TTL 30h→60h), `60a62b8` (Submit View manual-task fallback), `e0112f2` (Submit View automation).

---

## 1. Overview

Docker Compose on a Linux host at IP `161.118.164.85`, public domain **statbot.duckdns.org** (DuckDNS) with LetsEncrypt TLS. **Hosting provider: Oracle Cloud** (ARM `aarch64`, hostname `rtm-bot`, Ubuntu 24.04 with Oracle kernel, verified via SSH 2026-08-12). SSH: user `ubuntu`, key-based (key pasted by the owner during deploys; also present in repo root as gitignored `ssh-key-2026-07-19.key`).

```mermaid
flowchart LR
    Internet -->|443| NGINX["dashboard nginx<br/>statbot.duckdns.org"]
    Internet -->|80| NGINX
    NGINX -->|"/api/ → app:3000"| APP["app backend<br/>:3000 (not exposed)"]
    APP --> DB[("PostgreSQL<br/>host.docker.internal:5432")]
    APP --> REDIS["redis:7-alpine"]
    NGINX -->|"SPA files"| SPA["/usr/share/nginx/html"]
```

## 2. Services (`docker-compose.yml`)

| Service | Image/Build | Ports | Volumes | Notes |
|---|---|---|---|---|
| `app` | root `Dockerfile` (node:20-alpine, 2-stage) | none exposed | `insight-uploads:/app/uploads` | `env_file: .env`; `extra_hosts: host.docker.internal:host-gateway`; `depends_on: redis` |
| `redis` | `redis:7-alpine` | none | `redis-data:/data` | `redis-server --save "" --maxmemory 128mb --maxmemory-policy allkeys-lru` (no persistence; BullMQ only) |
| `dashboard` | `./dashboard/Dockerfile` (nginx:stable-alpine) | `80:80`, `443:443` | `/etc/letsencrypt:ro`, `/var/www/letsencrypt:ro` | `depends_on: app` |

Network: single bridge `app-network`. **No healthchecks** anywhere (the app exposes `GET /api/v1/health` but nothing polls it).

## 3. Reverse Proxy (nginx, `dashboard/nginx.conf`)

- Port 80: ACME webroot (`/.well-known/acme-challenge/` from `/var/www/letsencrypt`), everything else → 301 https.
- Port 443 (`statbot.duckdns.org`): TLS 1.2/1.3, certs `/etc/letsencrypt/live/statbot.duckdns.org/`, gzip.
- `/api/` → `proxy_pass http://app:3000` with `resolver 127.0.0.11` (Docker DNS) + Host/X-Real-IP/X-Forwarded headers + HTTP/1.1 upgrade headers (WS-ready boilerplate).
- SPA: `try_files $uri $uri/ /index.html`; index.html `no-store`; `/assets/` immutable 1y.
- Headers: X-Frame-Options SAMEORIGIN, nosniff, XSS-protection.

## 4. Database Deployment

- **PostgreSQL runs outside Compose** on the host (not provisioned by any compose service); backend reaches it via `host.docker.internal` (`extra_hosts` host-gateway). Version: **PostgreSQL 16.14** (verified via psql on the host). Host client `psql` 16.14 is installed; `DATABASE_URL` in `.env` points at `host.docker.internal` — when running psql directly on the host, substitute `localhost`.
- Schema applied **manually** from `prisma/migrations/migration.sql` (idempotent; safe to re-run). No auto-migrate in any pipeline. Verify drift with: `psql "$(sed -n 's/^DATABASE_URL=//p' .env | tr -d '"' | sed 's/host.docker.internal/localhost/')" -tAc "SELECT ..."` (do not print the URL).
- **⚠️ Migration re-run safety (2026-08-12 incident):** `migration.sql` must contain **only additive schema statements** (`ADD COLUMN IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`, indexes). It previously contained a one-time data backfill (`UPDATE Task SET status='ACCEPTED' WHERE source='goparttime' AND status='PENDING'` + `DELETE FROM "Reminder"`); re-running it during a deploy on 2026-08-12 reverted 48 activated tasks to ACCEPTED and wiped their reminders (recovered via `scripts/restore-accepted.ts`). The block was removed and replaced with a DANGER comment. **Before re-running the file, grep it for `UPDATE`/`DELETE` — any data statement must never be re-run; move one-time data changes to versioned one-off scripts instead.**
- Backup/restore: **no mechanism in repo** (pre-deploy safety backups are taken manually as tarballs, e.g. `/home/ubuntu/rtm-backup-YYYYMMDD-HHMMSS.tar.gz`, excluding `node_modules/`, `dist/`, `.git`).

## 5. Build & Deploy Commands

### Shipping code to the server (git bundle — no GitHub credentials on host)

The host repo is `/home/ubuntu/rtm` (user `ubuntu`). It **cannot `git pull`**: the GitHub repo (`Destroyer690420/statbot`) is private and no credentials are installed on the host. Code ships from a dev machine as a git bundle:

```
git bundle create statbot-main.bundle origin/main
scp statbot-main.bundle ubuntu@161.118.164.85:/home/ubuntu/
ssh ubuntu@161.118.164.85 "cd /home/ubuntu/rtm && git fetch /home/ubuntu/statbot-main.bundle refs/remotes/origin/main:refs/remotes/origin/main && git reset --hard refs/remotes/origin/main"
```

Then build/restart as below. **Always back up the working tree first** (`tar -czf /home/ubuntu/rtm-backup-$(date +%Y%m%d-%H%M%S).tar.gz --exclude=rtm/node_modules --exclude=rtm/dist --exclude=rtm/.git -C /home/ubuntu rtm`). Verify `HEAD` after the reset. `.env`, `node_modules/`, `dist/` and server scratch files are untouched by this flow. After a verified deploy, delete the bundle from the host.

### Backend image
```
docker compose build app
docker compose up -d app redis
```
`Dockerfile` steps: `npm ci` → copy tsconfig/src/prisma/prisma.config.ts → `npx prisma generate` → `npm run build` → production stage `npm ci --production` + copy `dist/`, `src/generated/prisma`, `prisma/` → `CMD ["node","dist/index.js"]`, `EXPOSE 3000`, creates `logs/`.

### Dashboard image
```
docker compose build dashboard
docker compose up -d dashboard
```
`dashboard/Dockerfile`: node:20-alpine builder `npm ci` → `npm run build` (`tsc && vite build`) → nginx:stable-alpine copies `dist/` + `nginx.conf`.

### Full stack
```
docker compose up -d --build
```

### Post-deploy verification
- `docker compose ps` (all 3 services Up).
- `curl -fsS https://statbot.duckdns.org/api/v1/health` → `"status":"healthy"` with database+redis connected.
- Boot log walkthrough: `docker compose logs app` should show all 6 init steps ending with "All systems online!".
- Dashboard root + `/goparttime-send.user.js` return 200.
- Bot commands: `npm run deploy-commands` (idempotent; run after any `src/bot/commands/*` change).
- DB drift check: compare `prisma/schema.prisma`/`migration.sql` against the live DB (migration is idempotent; re-run only if drift found).

### Local (non-Docker) development
- Backend: `npm install && npx prisma generate && npm run build && npm start` (or `npm run dev`).
- Commands: `npm run deploy-commands`.
- Dashboard: `cd dashboard && npm install && npm run dev` (port 5173, proxy → `https://161.118.164.85`).

## 6. PM2 Alternative (non-Docker)

`ecosystem.config.js`: app `reddit-task-manager`, `dist/index.js`, 1 instance, `autorestart`, `max_memory_restart 500M`, `NODE_ENV: production`, logs `logs/pm2-error.log` / `logs/pm2-out.log`. Start: `pm2 start ecosystem.config.js`.

## 7. Discord Bot Deployment Notes

- Commands must be (re)deployed after edits: `npm run deploy-commands` (guild-scoped; requires `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`).
- Bot must be in the guild and have permissions to send messages in ticket channels; Message Content intent must be enabled (used by reply parsing). For ticket auto-welcome on `channelCreate`, bot needs **View Audit Log** permission to fetch the creator via audit logs (falls back to member detection if denied) and **Send Messages** in ticket channels. For member join welcome on `guildMemberAdd`, bot needs **Server Members Intent** (already `GuildMembers`) and **Send Messages** in `#invites` (`1520616800063328437`).

## 8. GoPartTime Extension Deployment

- Userscript served at `https://statbot.duckdns.org/goparttime-send.user.js` (from `dashboard/public/` — must stay identical to `scripts/goparttime-send.user.js`).
- Workers install via Tampermonkey (desktop) or Edge Canary (Android, see `ANDROID_SETUP.md`); enter the API URL + shared `GOPARTTIME_API_KEY` once.

## 9. Insight Image Storage

Volume `insight-uploads` mounted at `/app/uploads` — screenshots live there with a 60h TTL cleanup (files deleted by the app; see `docs/INSIGHT_SYSTEM.md`).

## 10. Logs

- Container logs: `docker compose logs -f app` / `dashboard` / `redis`.
- winston file transports **only in non-production** (`logs/error.log`, `logs/combined.log`, 5MB rotate ×5) — production logs go to stdout → Docker.
- PM2 path: `logs/pm2-*.log`.

## 11. Restart & Rollback

- Restart: `docker compose restart app` (reminder jobs survive via re-hydration within 30 min; queue re-created at boot).
- Rollback: re-bundle an older commit with the same bundle flow (§5) + rebuild images, or restore the pre-deploy working-tree tarball (`/home/ubuntu/rtm-backup-*.tar.gz`). **No blue/green or versioned image tags in repo.**

## 12. Known Deployment Gaps

1. No healthcheck wiring (container health never verified by orchestration).
2. Redis runs without persistence — a Redis loss only costs pending delayed jobs (re-hydrated from Postgres).
3. `.env` must contain `DATABASE_URL` (missing from `.env.example`).
4. `dist/` at repo root is stale; never use it for manual deploys (`npm run build` regenerates).
5. DuckDNS domain + LetsEncrypt renewal relies on the ACME webroot mount (`/var/www/letsencrypt`) — renewal client config not in repo (UNKNOWN).
6. **Server has no GitHub credentials** (private repo) — no `git pull`; every deploy ships via git bundle from a dev machine (see §5). A read-only deploy key or PAT on the host would remove this gap.