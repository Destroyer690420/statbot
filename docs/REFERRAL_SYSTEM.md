# REFERRAL_SYSTEM.md — Referrals & Commission System

> Verified against `src/services/commission.service.ts`, `src/bot/commands/referral.ts`, `src/api/routes/commissions.ts`, `src/database/repositories/{referral,commission}.repository.ts`, `scripts/backfill-indirect-referrers.ts` on 2026-08-21.

---

## 1. Core Concepts

| Term | Meaning |
|---|---|
| **Inviter** | A Discord user who referred a worker (`/referral add inviter:`). |
| **Invitee** | The referred worker (`invitee:`), identified by Discord user ID. |
| **Referral** | One `Referral` row linking inviter ↔ invitee (unique on `(inviteeId, inviterId)`). |
| **Normal inviter** | Default type. One-time bonus ₹100 after the invitee completes **2** tasks (threshold configurable). |
| **Special inviter** | One of the **hardcoded** Discord IDs in `src/bot/commands/referral.ts`: `582595416294555649`, `1202294567706316911`, `1506900129792135211`. One-time bonus ₹50 after **1** task + **per-task commissions** ₹20/post, ₹10/comment. |
| **Indirect special inviter** | A special inviter ANYWHERE up the referral ancestor chain of a normal inviter. Stored on the normal referral as `indirectSpecialInviterId`; earns per-task commissions (`per_task_indirect`) on every descendant worker's completed tasks — no one-time bonus. |

### Multi-level chain rule (fixed 2026-08-21)

When a referral is created for a **normal** inviter, `resolveIndirectSpecialInviterId(inviterId)` (exported from `commission.service.ts`) walks the invite chain **upward level by level** (BFS via `referralRepository.findByInviteeId`) until it finds a non-closed **special** inviter at any depth or reaches the root:

```
isee_speed (SPECIAL) → soren_thunder → notshagunatp → bavish.exe → batman_441
                       ↑ indirect      ↑ indirect    ↑ indirect   ↑ indirect
```

Every referral below the special inviter gets `indirectSpecialInviterId = isee_speed` — not just direct children. Guarantees:

- **Cycle-safe**: visited set prevents infinite loops (A→B→A).
- **Depth cap**: hard limit `MAX_INDIRECT_CHAIN_DEPTH = 10`.
- **Branching chains**: BFS explores all parent paths; the shallowest open special wins.
- **Closed links**: a special reachable only through a `closed` referral is skipped, but does NOT block discovery of the same special via an open path elsewhere in the chain.
- Applies only when the new referral's inviter is `normal` (a direct special inviter already earns direct per-task commissions). Both entry points are covered: `/referral add` (bot) and `POST /commissions/referrals` (dashboard).

## 2. Rates (`CommissionRates` row, defaults) 

| Field | Default | Bounds (API) |
|---|---|---|
| `normalInviteBonus` | ₹100 | 0–10000 |
| `normalInviteTaskThreshold` | 2 | 1–100 |
| `specialInviteBonus` | ₹50 | 0–10000 |
| `specialInviteTaskThreshold` | 1 | 1–100 |
| `specialPerComment` | ₹10 | 0–1000 |
| `specialPerPost` | ₹20 | 0–10000 |

Rates read via `settingsRepository` (same table pattern as payout rates). The API `GET/PUT /commissions/rates` manages them. The **same special rates/threshold apply to indirect commissions** (₹20/post, ₹10/comment; threshold = `specialInviteTaskThreshold`).

## 3. Referral CRUD

- **Create**: `/referral add` (bot, admin; ticket string like `ticket-0036` or `<#id>` resolved to a channel name; inviter type decided by the hardcoded list) or `POST /commissions/referrals` (dashboard, admin; `ticketId` accepted by the service but **not** in the zod schema). New referral: `status='pending'`, `oneTimeCommissionPaid=false`, `perTaskCommissionActive=false`, plus multi-level `indirectSpecialInviterId` detection (see §1). The bot reply shows `↳ Indirect link:` when set.
- **Update**: `PATCH /commissions/referrals/:id` (dashboard edit modal — names, ticket, **inviter/invitee IDs**). ID changes are snowflake-validated and keep the `(invitee, inviter)` pair unique (keep-first); an inviter change re-derives special/normal type from the hardcoded list and recomputes `indirectSpecialInviterId` via the full chain walk. Audits `REFERRAL_UPDATED`.
- **Auto-detect (auto-approved)**: Discord joins are staged in `InviteDetection` rows (see §3b) — rows with a known inviter are **approved immediately** by the bot (`recordJoin()` → `approve(..., 'system')`, no manual step), creating the real referral via `commissionService.createReferral` (same guards + indirect walk). Joins with an unknown inviter are skipped entirely (logged + audited, no row) — there is no manual queue anywhere (the dashboard Pending Invites section was removed 2026-09-10).

## 3b. Invite auto-detection (join → ticket → auto-approve)

- **Inviter detection** (`src/services/invite-tracker.service.ts`): Discord never reports the inviter on `guildMemberAdd`, so the bot snapshots invite uses per guild (on `ready`, refreshed after every join) and diffs the fresh fetch against the snapshot (`findIncreasedInvite` — largest `uses` increase wins). Requires the `GuildInvites` gateway intent (`src/bot/index.ts`) + bot role **Manage Guild** (to list invites). Misses resolve to `inviter = null` (vanity-URL / OAuth / Discovery joins, burst-join ambiguity, restart gaps) — those joins are skipped (log + `INVITE_DETECTED` audit, no row, no referral).
- **Staging** (`src/services/invite-detection.service.ts`, `InviteDetection` table): `guildMemberAdd` (bots skipped, after the `#invites` welcome) calls `recordJoin()` — keep-first: existing pending row for the invitee wins, and an existing `Referral` for the same `(invitee, inviter)` pair skips creation. Ticket starts empty (= "No ticket yet"). **When the inviter is known, `recordJoin()` auto-approves on the spot** (referral created, row marked `approved`, audited as `INVITE_APPROVED` by `system`); auto-approve failures only warn and leave the row pending. Never throws.
- **Ticket linking** (`src/bot/events/channelCreate.ts` → `linkTicket()`): reuses the ticket-creator resolution (audit log + single-member fallback); the invitee's **first** ticket only is linked (`ticketChannelId` + `ticketName`, never overwritten). If the row was already approved, an unticketed live `Referral` for that invitee is backfilled with `<#channelId>`.
- **Detection API (no dashboard UI)** (`POST /commissions/invite-detections/:id/approve|reject`, `PATCH /commissions/invite-detections/:id`, dashboard-admin only): kept for the one-off sweep script and emergencies; the Referrals page no longer shows a Pending Invites section. Ticket is optional on approve — commission counts by `inviteeId` first (`getTasksForReferral`). Inviter type comes from the same hardcoded special list. Audits `INVITE_DETECTED` / `INVITE_APPROVED` / `INVITE_REJECTED`.
- **Backfill** (`scripts/backfill-invite-detections.ts [--since YYYY-MM-DD] [--dry-run]`, host-run with `DATABASE_URL` localhost-substituted): stages joins since the cutoff with inviter unknown (not reconstructible — audit logs don't record joins) + first-ticket resolution via the solo-worker channel scan. Keep-first (existing pending rows and referrals win); members who already left can't be enumerated. Repair companion: `scripts/repair-invite-detected-audits.ts` inserts missing `INVITE_DETECTED` audits.
- **Duplicate guard**: `findByInviteeAndInviter` → `"A referral already exists for invitee <@…>."`; inviter==invitee rejected in the bot command.
- **Update/Delete**: `PATCH /commissions/referrals/:id` (names, ticketId), `DELETE /commissions/referrals/:id`. Audits `REFERRAL_UPDATED` / `REFERRAL_REMOVED`.
- ⚠️ **Stale-chain caveat**: editing/deleting an upstream referral does **not** retroactively recompute `indirectSpecialInviterId` on downstream referrals. After restructuring existing chains, rerun the backfill script (§6).
- **No per-worker deletion filter** exists anywhere (invitee tasks still count after "leaving").

## 4. Payable Commission Computation (`getPayableItems(ref, rates)`)

Per non-`closed` referral:

1. **Threshold met** = all-time completed task count (`COMPLETED|ARCHIVED`, `cancelledReason` null, invitee tasks) `>= threshold` (normal 2, special 1).
2. **One-time item** payable iff: `!oneTimeCommissionPaid` AND threshold met AND bonus > 0 AND no existing `commissionItem` with `kind='one_time'` for `(referralId, inviterId)`.
3. **Per-task items** (special only) payable iff: `perTaskCommissionActive` OR (`special` AND threshold met). For each invitee completed task (all-time): amount `POST→specialPerPost, COMMENT→specialPerComment`; skip amount ≤ 0; skip tasks already carrying a `per_task` item for `(inviterId, sourceTaskId)`.
4. "Pending" is **derived**, not stored: unpaid items remain in the payable set; paid items are deduped via `commissionItem` rows and the referral flags.

## 5. Indirect Commissions + Payment Flow

`getIndirectPayableItems(specialInviterId, rates)`: for each non-closed referral where `indirectSpecialInviterId === specialInviterId`, per completed task of that referral's invitee (threshold `specialInviteTaskThreshold`): item `{kind:'per_task_indirect', amount, sourceTaskId, referralId, invitedWorkerId}`; dedupe via `findIndirectPerTaskCommission(inviterId, sourceTaskId)`.

Wired into: `getSummary`, `getBreakdown`, `getInviterDetail` (rows labelled `(indirect)`), `payInviter`, `payAll`. Owner earnings subtracts them as cost too (tasks of workers with `inviterType==='special'` OR non-null `indirectSpecialInviterId`).

```
POST /commissions/pay-inviter/:inviterId | /pay-all   [admin]
→ per non-closed referral: getPayableItems
→ (+ special inviters: getIndirectPayableItems)
→ create CommissionBatch (ALWAYS new; batchNumber = latest+1; week = current IST payout week; paidAt = now)
→ db.$transaction: CommissionItem rows (kind one_time|per_task|per_task_indirect, sourceTaskId for per-task kinds)
   + referral side effects:
     one-time present → oneTimeCommissionPaid=true, oneTimeCommissionPaidAt=now
     special          → perTaskCommissionActive=true, status='active_per_task'
     normal           → status='qualified'
→ batch totals updated (totalInviters, totalAmount)
→ audits: COMMISSION_PAID (pay-inviter) / COMMISSION_BATCH_CREATED (pay-all)
→ errors: "No unpaid commissions available for this inviter." / "No unpaid commissions available."
```

- **Commission timing**: computed on-demand at pay time from *current* task states — not snapshotted at task completion. Deleting/archiving a task before pay changes the outcome.
- Batch reuse: **none** (unlike worker payouts) — each pay call creates a new batch.

## 6. Backfill Script (`scripts/backfill-indirect-referrers.ts`)

One-off data fix created with the multi-level fix (2026-08-21); repairs rows created before the fix (chains deeper than one hop were never linked).

```bash
npx tsx scripts/backfill-indirect-referrers.ts
```

- Recomputes `indirectSpecialInviterId` **from scratch** for every `inviterType='normal'` referral using the same walk-up helper: sets the correct special when found AND clears stale values.
- Updates only rows whose stored value changes; logs each change + a summary (`N checked, N updated (linked/cleared)`).
- Idempotent/safe to re-run. Run against the production DB manually after deploying the fix. `migration.sql` stays schema-only (repo rule) — this is pure data repair, like `scripts/restore-accepted.ts`.

## 7. Dashboard Reads

| Endpoint | Returns |
|---|---|
| `GET /commissions/summary` | `totalInviters`, `totalSuccessfulInvites`, `totalCommission`, `totalBonusAmount`, `totalPerTaskAmount`, `alreadyPaidCommission` (all-time, includes indirect) |
| `GET /commissions/breakdown` | per inviter `{inviterId, inviterName, inviterType, totalReferrals, successfulReferrals, totalCommission, status:'Ready'}`, sorted ₹ desc, includes zero-commission inviters; special inviters' totals include pending indirect items |
| `GET /commissions/inviters/:inviterId` | referrals with `bonusAmount`, `perTaskAmount`, `inviteeTasks`, `isSuccessful:true`/`bonusPaid:false` **hardcoded** in detail view; indirect referrals appear as `"<name> (indirect)"` rows; totals |
| `GET /commissions/batches` / `:batchId` | history / detail (names resolved, fallback id slice) |
| `GET /commissions/export/csv` | `Inviter Name, Inviter Type, Invitee Name, Bonus (₹), Per-Task (₹), Total Commission (₹), Status` |

Dashboard Referrals page shows an "Indirect" badge when `indirectSpecialInviterId` is set.

## 7b. Worker-Facing View (`GET /worker/invites`)

A worker sees their own invite list and what they earned from it on the worker panel's **Invites** tab (implemented 2026-09-25, Decision 19). It reuses the same engine as the pay buttons — no parallel math — so it cannot drift from `/myinvites` or the admin pages.

| Field | Meaning |
|---|---|
| `summary.invited` / `withTicket` / `qualified` | derived from the listed rows; `status === 'closed'` referrals are never listed, `qualified` counts rows that reached their threshold |
| `summary.directPaid` | sum of that inviter's `CommissionItem` rows (`one_time` + `per_task`) on referrals they own — an item's existence *is* the paid record, because commission batches stamp `paidAt` at creation |
| `summary.directPending` | sum of what `commissionService.getPayableItems` would create next on their own referrals (threshold met, no item yet) |
| `summary.chainPending` | the same for `commissionService.getIndirectPayableItems` — multi-level share, non-zero **only for the three special inviters** |
| `summary.teamPaid` | their `per_task_indirect` earnings already disbursed, as one anonymous total |
| `summary.paid` | `directPaid + teamPaid` |
| `summary.lastBatch` | `{ amount, batchNumber, paidAt }` of the most recent batch that paid them; every kind in that batch counts, older batches do not. Nulls when never paid |
| `invitees[].name` / `.ticket` / `.tasks` / `.threshold` / `.qualified` / `.earned` | display name, ticket **number**, completed tasks **capped at the threshold**, whether the bonus is unlocked, and money already disbursed for that person |

- **`directPending + chainPending` is the figure that matches the admin panel.** `getBreakdown()` adds indirect items for special inviters, so omitting the chain share made the worker panel under-report a special inviter by a lot (observed 2026-09-26: ₹210 direct vs ₹440 chain = ₹650, exactly the admin's `totalCommission`). Normal inviters have no chain pending, so their number was always complete and is unchanged.
- **Nothing about special inviters is exposed to anyone else.** `chainPending` is structurally zero for normal inviters, and every chain-related line in the UI is gated on `teamPaid > 0 || chainPending > 0`, which only a special inviter can satisfy. A normal inviter's panel contains no chain wording at all.

- **Per-row metric is task progress, not money** (owner change, 2026-09-26): the bonus pays once at the threshold, so a per-invitee rupee figure is always 0 until the manager runs a payout and stops moving afterwards. `tasks` therefore counts COMPLETED + ARCHIVED tasks excluding any `cancelledReason` — the same rule as the engine's `getCompletedTasksForUser` — and is clamped to `threshold` (`specialInviteTaskThreshold` for special inviters, `normalInviteTaskThreshold` = 2 otherwise), read from `CommissionRates` so it follows the real rate instead of a hardcoded 2. All invitees are counted in one batched query.
- **Ticket number resolution**: `Referral.ticketId` is a channel mention (`<#id>`) for auto-detected referrals, a bare snowflake, or a plain channel name for `/referral add`. Ids are resolved against channel names already recorded on `Task` rows (one batched query); a plain name is used as-is; anything unresolvable returns `null` ("No ticket yet") so an id or raw mention can never reach a worker.
- **Withheld by design**: invitee Discord ids, referral/commission ids, `commissionKind`, `inviterType`, commission rates, and the identity/ticket/task behind `teamPaid`. Enforced by `WORKER_FORBIDDEN_FIELDS` + `worker-isolation.test.ts`.
- **Not covered here**: multi-level **pending** is computed for everyone (it is a single `getIndirectPayableItems` call that returns fast when the inviter has no indirect referrals), so a large chain costs the same walk the admin breakdown already performs on demand.

## 8. Owner-Earnings Integration

`owner-earnings.service` treats active referrals as a **cost** on a creation basis: every task created in the window counts revenue (₹250/₹100) + worker cost (live `PayoutSettings`) except `CANCELLED` / any non-null `cancelledReason` (deleted posts = zero everywhere, retroactively). Per-task commission (₹20/₹10, direct-special or `indirectSpecialInviterId`) accrues on the task's creation day only when the invitee's all-time payable-completed count meets the **special** threshold; each one-time bonus (normal ₹100 / special ₹50) is deducted exactly once on the creation day of the threshold-reaching task (ordered by completion time), with Sunday payment only flipping `awaiting → paid`. See `docs/FRONTEND.md` §OwnerEarnings.

## 9. Edge Cases & Known Behaviors

1. **Hardcoded special inviter list** in the bot command only — the API accepts any `inviterType` in the body. List changes require a code edit + restart (runtime list; `npm run deploy-commands` NOT needed).
2. `getTasksForReferral` falls back to **channel-name tasks** (`ticketId`) when the invitee-user lookup returns none — historical referrals whose invitee left.
3. Deleting a **paid** referral is blocked at DB level (CommissionItem FK RESTRICT → error surfaces as 400/500); unpaid referral deletion works.
4. Threshold uses **all-time** counts regardless of the week params (weekStart/weekEnd are ignored by most commission read methods — only `getInviterDetail` filters).
5. `inviteeTasks` counted by completion time (`completedAt` of latest completed reminder, else `updatedAt`), same helper as payouts.
6. There is no commission auto-payout — always manual via dashboard.
7. Chain staleness after upstream edits/deletes (§3 caveat) — rerun the backfill script.
8. An invitee invited by multiple inviters (multiple parent rows) contributes ALL those paths to the walk; the shallowest open special wins.

## 10. Historical Notes

- **Two-level referral v1**: implemented 2026-08-09 (`9348d2d`) then fully reverted same day (`ac441e2`). Re-implemented and deployed 2026-08-13 (`a558f1d`) with the `CommissionKind.per_task_indirect` enum value + `Referral.indirectSpecialInviterId` column/index (schema-only migration).
- **Multi-level fix (2026-08-21)**: original implementation checked only ONE level up, so only direct children of a special inviter were linked; grandchildren and deeper got `indirectSpecialInviterId = null` and the special was never paid for their tasks. Replaced with full chain walk-up (`resolveIndirectSpecialInviterId`) + backfill script + tests (`src/__tests__/commission-indirect.test.ts`).
- Commit `be9aa03` (07-26): "include per-task commissions in initial payout for special inviters" — the rule that threshold meeting enables per-task commissions is intentional.
- Commit `072aca9`: "filter paid commissions from breakdown, commission batch history".

## 11. Relevant Files

- `src/services/commission.service.ts` (logic incl. `resolveIndirectSpecialInviterId`), `src/services/owner-earnings.service.ts`
- `src/bot/commands/referral.ts` (hardcoded special IDs)
- `src/api/routes/commissions.ts`
- `src/database/repositories/{referral,commission,settings}.repository.ts`
- `scripts/backfill-indirect-referrers.ts` (chain data repair)
- `src/__tests__/commission-indirect.test.ts`
- `dashboard/src/pages/Referrals.tsx`, `dashboard/src/pages/Payout.tsx` (CommissionsPanel)
