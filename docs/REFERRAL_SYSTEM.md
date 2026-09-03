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
- **Auto-detect (approval queue)**: Discord joins are staged in `InviteDetection` rows (see §3b) — **Approve** in the dashboard Referrals page creates the real referral via `commissionService.createReferral` (same guards + indirect walk). Unapproved rows never enter payout/commission math.

## 3b. Invite auto-detection (join → ticket → approve)

- **Inviter detection** (`src/services/invite-tracker.service.ts`): Discord never reports the inviter on `guildMemberAdd`, so the bot snapshots invite uses per guild (on `ready`, refreshed after every join) and diffs the fresh fetch against the snapshot (`findIncreasedInvite` — largest `uses` increase wins). Requires the `GuildInvites` gateway intent (`src/bot/index.ts`) + bot role **Manage Guild** (to list invites). Misses resolve to `inviter = null` (vanity-URL / OAuth / Discovery joins, burst-join ambiguity, restart gaps) — those rows are shown for manual Reject.
- **Staging** (`src/services/invite-detection.service.ts`, `InviteDetection` table): `guildMemberAdd` (bots skipped, after the `#invites` welcome) calls `recordJoin()` — keep-first: existing pending row for the invitee wins, and an existing `Referral` for the same `(invitee, inviter)` pair skips creation. Ticket starts empty (= "No ticket yet").
- **Ticket linking** (`src/bot/events/channelCreate.ts` → `linkTicket()`): reuses the ticket-creator resolution (audit log + single-member fallback); the invitee's **first** ticket only is linked (`ticketChannelId` + `ticketName`, never overwritten). If the row was already approved, an unticketed live `Referral` for that invitee is backfilled with `<#channelId>`.
- **Approval** (`POST /commissions/invite-detections/:id/approve|reject`, dashboard-admin only): Approve requires a known inviter (unknown-inviter rows must be Rejected or fixed manually); ticket is optional — approval without a ticket still works because commission counts by `inviteeId` first (`getTasksForReferral`). Inviter type comes from the same hardcoded special list. Audits `INVITE_DETECTED` / `INVITE_APPROVED` / `INVITE_REJECTED`.
- **Editing pending rows** (`PATCH /commissions/invite-detections/:id`, dashboard-admin only): set/correct `inviterId` (snowflake), `inviterName`, `inviteeName` on pending rows — the path for unknown-inviter rows (vanity/OAuth joins, backfilled rows) to become approvable. Saving an ID with an empty name **auto-fills the current Discord display name** server-side (REST `GET /users/:id` as the bot; best-effort — failures keep the ID). Approve does the same fallback when the row still has no name. Dashboard pencil modal in the Pending Invites queue.
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

## 8. Owner-Earnings Integration

`owner-earnings.service` treats active special referrals as a **cost**: per-task commissions (₹20/₹10) subtracted from revenue for referred workers whose referral is direct-special OR carries `indirectSpecialInviterId`; below-threshold referrals subtract the one-time bonus later; already-paid bonuses are skipped (`alreadyPaid`). See `docs/FRONTEND.md` §OwnerEarnings.

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
