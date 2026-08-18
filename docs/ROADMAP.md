# ROADMAP.md — Roadmap & Pending Work

> Only items that exist in the repository (TODO comments, specs, docs, unfinished code, reverted features) are listed. Verified on 2026-08-11: **zero TODO/FIXME/HACK comments exist** in `src/` or `dashboard/src/`.

---

## In Progress

- **Nothing is marked in-progress anywhere in the repo.** The working tree has one uncommitted change: `dashboard/vite.config.ts` dev-proxy target `http:` → `https:` (left unfinished locally).

## Planned (from specs/plans in repo)

| Item | Source | Notes |
|---|---|---|
| GoPartTime acceptance checklist | `sending.md` Phase 23 (23 items, all unchecked) | The feature is implemented (08-03–08-05); the checklist was never ticked — someone should run it against the live system |
| GoPartTime DOM/message spec acceptance | `goparttime_discord_dom_and_limits_spec.md` (23-point test) | Same — spec is the acceptance source |
| plan.md future features | `plan.md` sections 16–20: monitoring, notifications, backup strategy, roles, production checklist | Design intent only; not implemented |
| Android usage documentation | `ANDROID_SETUP.md` | Implemented (docs + userscript mobile support) |

## Blocked

| Item | Blocker |
|---|---|
| Two-level referral (recruiter links) | **Reverted** on 2026-08-09 (`9348d2d` → `ac441e2`). No trace remains; any revival starts from scratch. Reason for revert not recorded in git — UNKNOWN. |

## Technical Debt Backlog (see docs/KNOWN_ISSUES.md for details)

1. Regenerate `src/generated/prisma` (stale enums).
2. Delete `query-tasks.ts/.js` (hardcoded DB password) and `ssh-key-2026-07-19.key`.
3. Authenticate owner-earnings endpoints; remove default PIN.
4. Update `.env.example` (add `DATABASE_URL`, drop `FIREBASE_*`).
5. Remove legacy Firestore artifacts (firebase.json, firestore.indexes.json, stale comment, `formatFirestoreDate`).
6. Delete dead code (`check-reddit.ts`, `DELETED_DETECTION_THRESHOLD_MS`, `generateCommissionBatchId`, `deleteTaskDir`, unused `markReviewed`/review fields).
7. Store `completedAt` on the task (payout week correctness).
8. Implement or remove theme picker; drop inert CSS classes.
9. Fix "delete paid referral" error UX (FK RESTRICT).
10. Sync duplicate userscript copies (or serve one canonical file).

## Ideas (only those present in repo docs)

- plan.md: **roles/permissions** refinement (beyond admin/manager lists) — section 17.
- plan.md: **backup & monitoring** — section 18-19.
- plan.md: **notifications** (external alerting) — section 18.
- `sending.md`: idempotency/race protection already implemented; further hardening ideas (queue-based delivery, delivery retry UI) are partially spec'd in `goparttime_discord_dom_and_limits_spec.md` phase 9.

## Explicitly Out of Scope (per repo state)

- Re-adding two-level referral (reverted; no pending issue).
- Re-adding automatic Reddit deletion detection (removed 07-21; `check-reddit.ts` left as dead code).