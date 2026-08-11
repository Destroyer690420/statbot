# REFERRAL_SYSTEM.md — Referrals & Commission System

> Verified against `src/services/commission.service.ts`, `src/bot/commands/referral.ts`, `src/api/routes/commissions.ts`, `src/database/repositories/{referral,commission}.repository.ts` on 2026-08-11.

---

## 1. Core Concepts

| Term | Meaning |
|---|---|
| **Inviter** | A Discord user who referred a worker (`/referral add inviter:`). |
| **Invitee** | The referred worker (`invitee:`), identified by Discord user ID. |
| **Referral** | One `Referral` row linking inviter ↔ invitee (unique on `(inviteeId, inviterId)`). |
| **Normal inviter** | Default type. One-time bonus ₹100 after the invitee completes **2** tasks (threshold configurable). |
| **Special inviter** | One of the **hardcoded** Discord IDs in `src/bot/commands/referral.ts`: `582595416294555649`, `1202294567706316911`, `1506900129792135211`. One-time bonus ₹50 after **1** task + **per-task commissions** ₹20/post, ₹10/comment. |

## 2. Rates (`CommissionRates` row, defaults)

| Field | Default | Bounds (API) |
|---|---|---|
| `normalInviteBonus` | ₹100 | 0–10000 |
| `normalInviteTaskThreshold` | 2 | 1–100 |
| `specialInviteBonus` | ₹50 | 0–10000 |
| `specialInviteTaskThreshold` | 1 | 1–100 |
| `specialPerComment` | ₹10 | 0–1000 |
| `specialPerPost` | ₹20 | 0–10000 |

Rates read via `settingsRepository` (same table pattern as payout rates). The API `GET/PUT /commissions/rates` manages them.

## 3. Referral CRUD

- **Create**: `/referral add` (bot, admin; ticket string like `ticket-0036` or `<#id>` resolved to a channel name; inviter type decided by the hardcoded list) or `POST /commissions/referrals` (dashboard, admin; `ticketId` accepted by the service but **not** in the zod schema). New referral: `status='pending'`, `oneTimeCommissionPaid=false`, `perTaskCommissionActive=false`.
- **Duplicate guard**: `findByInviteeAndInviter` → `"A referral already exists for invitee <@…>."`; inviter==invitee rejected in the bot command.
- **Update/Delete**: `PATCH /commissions/referrals/:id` (names, ticketId), `DELETE /commissions/referrals/:id`. Audits `REFERRAL_UPDATED` / `REFERRAL_REMOVED`.
- **No per-worker deletion filter** exists anywhere (invitee tasks still count after "leaving").

## 4. Payable Commission Computation (`getPayableItems(ref, rates)`)

Per non-`closed` referral:

1. **Threshold met** = all-time completed task count (`COMPLETED|ARCHIVED`, `cancelledReason` null, invitee tasks) `>= threshold` (normal 2, special 1).
2. **One-time item** payable iff: `!oneTimeCommissionPaid` AND threshold met AND bonus > 0 AND no existing `commissionItem` with `kind='one_time'` for `(referralId, inviterId)`.
3. **Per-task items** (special only) payable iff: `perTaskCommissionActive` OR (`special` AND threshold met). For each invitee completed task (all-time): amount `POST→specialPerPost, COMMENT→specialPerComment`; skip amount ≤ 0; skip tasks already carrying a `per_task` item for `(inviterId, sourceTaskId)`.
4. "Pending" is **derived**, not stored: unpaid items remain in the payable set; paid items are deduped via `commissionItem` rows and the referral flags.

## 5. Payment Flow

```
POST /commissions/pay-inviter/:inviterId | /pay-all   [admin]
→ per non-closed referral: getPayableItems
→ create CommissionBatch (ALWAYS new; batchNumber = latest+1; week = current IST payout week; paidAt = now)
→ db.$transaction: CommissionItem rows (kind one_time|per_task, sourceTaskId for per-task)
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

## 6. Dashboard Reads

| Endpoint | Returns |
|---|---|
| `GET /commissions/summary` | `totalInviters`, `totalSuccessfulInvites`, `totalCommission`, `totalBonusAmount`, `totalPerTaskAmount`, `alreadyPaidCommission` (all-time) |
| `GET /commissions/breakdown` | per inviter `{inviterId, inviterName, inviterType, totalReferrals, successfulReferrals, totalCommission, status:'Ready'}`, sorted ₹ desc, includes zero-commission inviters |
| `GET /commissions/inviters/:inviterId` | referrals with `bonusAmount`, `perTaskAmount`, `inviteeTasks`, `isSuccessful:true`/`bonusPaid:false` **hardcoded** in detail view, totals |
| `GET /commissions/batches` / `:batchId` | history / detail (names resolved, fallback id slice) |
| `GET /commissions/export/csv` | `Inviter Name, Inviter Type, Invitee Name, Bonus (₹), Per-Task (₹), Total Commission (₹), Status` |

## 7. Owner-Earnings Integration

`owner-earnings.service` treats active special referrals as a **cost**: per-task commissions (₹20/₹10) subtracted from revenue for referred special-inviter workers; below-threshold referrals subtract the one-time bonus later; already-paid bonuses are skipped (`alreadyPaid`). See `docs/FRONTEND.md` §OwnerEarnings.

## 8. Edge Cases & Known Behaviors

1. **Hardcoded special inviter list** in the bot command only — the API accepts any `inviterType` in the body. List changes require a code edit + `npm run deploy-commands` is NOT needed (list is runtime), but a restart is.
2. `getTasksForReferral` falls back to **channel-name tasks** (`ticketId`) when the invitee-user lookup returns none — historical referrals whose invitee left.
3. Deleting a **paid** referral is blocked at DB level (CommissionItem FK RESTRICT → error surfaces as 400/500); unpaid referral deletion works.
4. Threshold uses **all-time** counts regardless of the week params (weekStart/weekEnd are ignored by most commission read methods — only `getInviterDetail` filters).
5. `inviteeTasks` counted by completion time (`completedAt` of latest completed reminder, else `updatedAt`), same helper as payouts.
6. There is no commission auto-payout — always manual via dashboard.

## 9. Historical Notes

- **Two-level referral** ("recruiter links": special inviter gets ₹20/post ₹10/comment on the recruiter's workers): implemented 2026-08-09 (`9348d2d`) with `ReferralRole` enum + `Referral.role` + `Referral.indirectSpecialInviterId` + new unique index, then **fully reverted the same day** (`ac441e2`). Current schema/code contains **no trace** of it.
- Commit `be9aa03` (07-26): "include per-task commissions in initial payout for special inviters" — the rule that threshold meeting enables per-task commissions is intentional.
- Commit `072aca9`: "filter paid commissions from breakdown, commission batch history".

## 10. Relevant Files

- `src/services/commission.service.ts` (logic), `src/services/owner-earnings.service.ts`
- `src/bot/commands/referral.ts` (hardcoded special IDs)
- `src/api/routes/commissions.ts`
- `src/database/repositories/{referral,commission,settings}.repository.ts`
- `dashboard/src/pages/Referrals.tsx`, `dashboard/src/pages/Payout.tsx` (CommissionsPanel)