# KNOWN_ISSUES.md — Known Issues, Limitations & Debt

> All items verified from the repository on 2026-08-11. Severity: Critical / High / Medium / Low.

---

## Verified 2026-08-17

### 0. `npm run lint` broken repo-wide (no ESLint config)
- **Description**: ESLint 9.x requires a flat `eslint.config.js`; the repo has never shipped one (no `.eslintrc*`, no `eslint.config.*`). `npm run lint` fails immediately with "ESLint couldn't find an eslint.config.(js|mjs|cjs) file."
- **Severity**: Medium (CI/dev annoyance; typecheck + tests still run).
- **Status**: Open.
- **Cause**: ESLint dependency bumped to ^9 without migrating config format.
- **Next step**: add an `eslint.config.js` (flat config) matching the current lint script (`eslint src/ --ext .ts`).

---

## Confirmed Bugs / Risks

### 1. Owner-earnings endpoints are unauthenticated
- **Description**: `GET /owner/daily-earnings`, `/daily-earnings/history`, `/weekly-earnings` have no JWT and no PIN; only rate-limited.
- **Severity**: High (financial data exposure).
- **Status**: Open.
- **Cause**: route file mounts them without auth middleware.
- **Workaround**: none (anyone with network access can query).
- **Files**: `src/api/routes/owner.ts`, `src/api/server.ts`.
- **Next step**: require JWT (and/or PIN) on these routes; add role claim checks.

### 2. Hardcoded default owner PIN `'7977'`
- **Description**: `OWNER_PIN` defaults to `'7977'` in `env.ts`; `/owner/verify` returns HTTP 200 even for a wrong PIN (client checks `success`).
- **Severity**: High if env var not overridden.
- **Status**: Open.
- **Files**: `src/config/env.ts`, `src/api/routes/owner.ts`, `dashboard/src/pages/Settings.tsx`.
- **Next step**: require explicit env value; change verify semantics.

### 3. Secret-bearing debug scripts at repo root
- **Description**: `query-tasks.ts` / `query-tasks.js` (untracked) contain a hardcoded PostgreSQL password.
- **Severity**: Critical (credential leak risk).
- **Status**: Open.
- **Workaround**: none; **delete these files**.
- **Next step**: remove from disk and from any history; rotate the DB password.

### 4. Private SSH key in repo root
- **Description**: `ssh-key-2026-07-19.key` sits in the working directory (gitignored, untracked).
- **Severity**: Critical (if ever committed or exfiltrated).
- **Status**: Open (not tracked by git, but present on disk).
- **Next step**: move to a secure location and delete from the repo directory.

### 5. Stale generated Prisma client
- **Description**: `src/generated/prisma/enums.ts` lacks `TaskStatus.ACCEPTED` and 5 `AuditAction` values present in `schema.prisma`.
- **Severity**: Medium (type-level drift; regenerated in Docker builds, so production is likely fine).
- **Status**: Open.
- **Cause**: `prisma generate` not re-run after the GoPartTime migration.
- **Solution**: `npx prisma generate`.
- **Files**: `src/generated/prisma/enums.ts` vs `prisma/schema.prisma`.

### 6. Stale root `dist/` build
- **Description**: `dist/` is a partial older compile (missing newer modules, stale tests compiled in).
- **Severity**: Medium (only matters if someone runs `node dist/index.js` manually).
- **Status**: Open (gitignored; Docker builds fresh).
- **Next step**: delete or rebuild; never trust it.

### 7. Payout/commission completion-time derivation
- **Description**: eligibility week windows use the most recent completed reminder's `completedAt` (fallback `updatedAt`); the task stores no completion timestamp.
- **Severity**: Medium (tasks can land in the wrong payout week after reschedules/manual status changes).
- **Files**: `src/services/payout.service.ts`, `src/services/commission.service.ts`.
- **Next step**: store `completedAt` on the task at completion time.

### 8. Deleting a paid referral fails (DB RESTRICT)
- **Description**: `DELETE /commissions/referrals/:referralId` on a referral with commission items → FK RESTRICT error (surfaces as 400/500).
- **Severity**: Low–Medium (dashboard delete button errors without explanation).
- **Status**: Open.
- **Files**: schema FK `CommissionItem.referralId`, `src/api/routes/commissions.ts`.
- **Next step**: soft-delete referrals or friendly error handling.

### 9. Theme picker is a stub
- **Description**: Settings theme buttons do nothing; `<html class="dark">` is hardcoded.
- **Severity**: Low.
- **Files**: `dashboard/src/pages/Settings.tsx`, `index.html`.
- **Next step**: implement or remove.

## Known Limitations (by design / accepted)

| # | Limitation | Notes |
|---|---|---|
| 11 | Insight images unauthenticated + 60h TTL | Public URL for 60h then auto-deleted; viewers must act fast (`docs/INSIGHT_SYSTEM.md`) |
| 12 | `alreadyPaid` summary is all-time, not weekly | `payoutRepository.getTotalPaid()` global sum |
| 13 | payWorker batches keep `paidAt = null` | Never filled later; payAll batches set it at creation |
| 14 | No auto-payout for commissions or workers | Both are dashboard-manual |
| 15 | `deadline`/`payment` from GoPartTime are display-only | No enforcement |
| 16 | One awaiting-submission task per ticket | Guard in `assignFromGoPartTime` |
| 17 | Worker detection = exactly one non-admin member in channel | Multi-worker tickets rejected |
| 18 | Special inviter list hardcoded in `referral.ts` | Requires code edit to change |
| 19 | No per-worker identity on the extension channel | Shared `GOPARTTIME_API_KEY` |
| 20 | Redis without persistence | Jobs recovered from Postgres via re-hydration |
| 21 | No container healthchecks | `/health` exists but unused |
| 22 | No DB backup/restore mechanism in repo | UNKNOWN how production handles it |

## Technical Debt

| # | Item | Where |
|---|---|---|
| 23 | `.env.example` stale (FIREBASE_*, no `DATABASE_URL`) | repo root |
| 24 | Legacy Firestore artifacts: `firebase.json`, `firestore.indexes.json`, stale comment in `src/index.ts:156`, `formatFirestoreDate` in `dashboard/src/pages/Payout.tsx` | repo root, src, dashboard |
| 25 | Dead code: `check-reddit.ts` (`isPostDeleted`), `DELETED_DETECTION_THRESHOLD_MS`, `generateCommissionBatchId`, `insightStorageService.deleteTaskDir`, `reviewedAt`/`reviewedBy`/`markReviewed` (unused), `referralRepository.findById` (unused?) | `src/utils`, `src/services`, `src/database` |
| 26 | Duplicate userscript copies (`scripts/` + `dashboard/public/`) must stay in sync | — |
| 27 | In-memory filtering/sorting in `findCompleted`, `findCompletedOrArchived`, `search` (redditUrl substring), `findByDeliveryMessageId` JSONB scan | `task.repository.ts` |
| 28 | Dashboard unused API fns (`getUpcomingReminders`, `getHealth`, `getExportCsvUrl`, `createReferral`); inert `w-4.5`/`animate-in` classes | `dashboard/src/api/client.ts`, pages |
| 29 | Inconsistent admin checks (Discord-ID `isAdmin` vs username `requireDashboardAdmin`) | routes |
| 30 | JWT carries no roles | `auth.ts` middleware |

## Unknown / Unverified (do not assume)

| # | Item |
|---|---|
| 31 | Hosting provider (no reference; "Ubuntu VPS" only in plan.md; **no Oracle Cloud references exist**) |
| 32 | PostgreSQL version / production DB config |
| 33 | Backups, monitoring, alerting in production |
| 34 | Whether production uses Docker (compose present) or PM2 (`ecosystem.config.js` present) — both declared |
| 35 | `sending.md` acceptance checkboxes all unchecked — feature is implemented in code (08-03..08-05); spec was never marked complete |
| 36 | Why `ReferralStatus` has 4 values but only 3 are ever written (`pending`, `qualified`, `active_per_task`; `closed` read in compute logic) |