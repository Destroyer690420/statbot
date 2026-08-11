# AGENTS.md — Instructions for OpenCode Sessions

This file governs how AI coding sessions work on this repository. Read it before doing anything else.

## Repository Identity

**Reddit Task Manager** — a production system that:
- Runs a Discord bot that creates and tracks Reddit posting tasks (posts/comments) assigned to workers in Discord ticket channels.
- Automates insight (view-data) reminders at 20h/70h with BullMQ/Redis, screenshot-based completion, retries, and admin overdue alerts.
- Exposes a REST API (`/api/v1`) and a React admin dashboard.
- Ingests tasks from **GoPartTime** via a Tampermonkey userscript + backend integration.
- Computes weekly worker payouts and referral commissions.
- Stores data in **PostgreSQL** (Prisma 7), was previously on Firestore (fully migrated out).

## The Source of Truth

1. **The repository is the source of truth.** Never trust memory, assumptions, or this documentation over actual code.
2. `docs/PROJECT_CONTEXT.md` is the high-level persistent memory — the app's state, architecture, and known problems at a glance.
3. **Future sessions MUST read `docs/PROJECT_CONTEXT.md` before working.**
4. Read only the relevant detailed docs for the task at hand (see the docs index in PROJECT_CONTEXT.md).
5. Inspect the actual source code before trusting any documentation. Code wins on every conflict.
6. Never claim functionality in documentation that is not verified in the repository.
7. After implementing a feature, bug fix, migration, or architectural change, update the relevant documentation (see the "Future Documentation Rule" below).
8. After a successful deployment, update deployment status documentation.
9. Correct outdated documentation instead of blindly appending to it.
10. Do not ask the user to re-explain information that can be discovered from the repository.
11. If documentation conflicts with actual code, the code wins and documentation must be corrected.
12. Never modify application behavior merely to make documentation accurate.
13. Never expose secrets in documentation: no API keys, passwords, tokens, private keys, or sensitive environment values. Document variable NAMES, never VALUES.

## Standard Workflow for a Session

```
START SESSION
→ Read docs/PROJECT_CONTEXT.md
→ Identify relevant documentation files
→ Inspect relevant source code (verify before trusting docs)
→ Understand current implementation
→ Make changes
→ Test (see docs/TESTING.md for commands; lint/typecheck after code changes)
→ Verify
→ Update documentation
→ Deploy only if requested (see docs/DEPLOYMENT.md)
→ Verify deployment
→ Update deployment documentation
```

## Key Facts Every Session Should Know

- **Stack**: Node 18+, TypeScript, Express 4, discord.js 14, PostgreSQL + Prisma 7 (`@prisma/adapter-pg`), Redis 7 + BullMQ, React 18 + Vite + Tailwind (dashboard), Docker Compose + nginx.
- **Startup**: `src/index.ts` boots in 6 steps — DB → Redis/BullMQ queue → Discord bot → BullMQ worker → reminder re-hydration → REST API.
- **Reminders**: no cron. All reminder timing is BullMQ delayed jobs whose absolute deadlines derive from task `createdAt` + hardcoded delays (20h/70h; retries +2h/+6h, max 3 sends). Re-hydration every 30 min and at boot re-creates jobs from PostgreSQL.
- **Migrations**: single hand-maintained, idempotent `prisma/migrations/migration.sql`, applied manually (NOT via `prisma migrate deploy`). Keep new schema and SQL in sync and `IF NOT EXISTS`-safe.
- **Build/test commands**:
  - Backend: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run dev`
  - Commands deploy: `npm run deploy-commands`
  - Dashboard: `cd dashboard && npm run build` (dev: `npm run dev`, port 5173)
  - Prisma client is generated into `src/generated/prisma` (gitignored, built in Docker).
- **Environment**: validate `src/config/env.ts` (zod) before trusting `.env.example` — the example file is stale in places (e.g. still lists removed `FIREBASE_*` vars and lacks `DATABASE_URL`).

## Secrets in This Repo (HANDLE CAREFULLY)

- `.env` (gitignored) — never read into documentation; only variable names may be documented.
- `query-tasks.ts` / `query-tasks.js` (untracked debug scripts) contain a hardcoded DB password — treat as sensitive; consider deleting.
- `ssh-key-2026-07-19.key` sits in the repo root (gitignored) — a private SSH key; do not read or reuse.

---

## FUTURE DOCUMENTATION RULE

Whenever a future session successfully implements a feature, fixes a bug, changes architecture, changes the database, changes an API, changes deployment, or changes an important workflow:

1. **Test and verify the change** (tests + typecheck + lint).
2. **Update `docs/PROJECT_CONTEXT.md`** (features, system state, flows, "Last Verified" date, Recent Changes).
3. **Update every relevant detailed documentation file** (architecture, subsystem, API, database, etc.).
4. **Add an entry to `docs/CHANGELOG.md`** when appropriate.
5. **Update `docs/KNOWN_ISSUES.md`** if an issue was fixed.
6. **Update `docs/ROADMAP.md`** if planned work was completed.
7. **Update `docs/DECISIONS.md`** if an architectural decision was made.
8. **Update `docs/DEPLOYMENT.md`** if deployment infrastructure changed.
9. **Never mark something as deployed unless deployment was actually verified.**

The documentation must remain a living representation of the actual project.