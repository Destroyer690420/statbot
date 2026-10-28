# PAYOUT_SYSTEM.md — Weekly Worker Payouts

> Verified against `src/services/payout.service.ts`, `src/api/routes/payouts.ts`, `src/database/repositories/payout.repository.ts` on 2026-08-11.

---

## 1. What Qualifies for Payment

A task is eligible iff **all** of:
- status ∈ `COMPLETED | ARCHIVED` (CANCELLED never eligible);
- **not already paid** (no `PayoutItem.taskId` exists — `getPaidTaskIds()` set);
- `cancelledReason` is null/undefined (deleted tasks excluded);
- (when a week window is given) its **completion time** falls inside `[weekStart, weekEnd]` inclusive.

### Completion time — the crux
`getTaskCompletionTime(taskId)` = the **most recent completed reminder's `completedAt`** (`reminder.completed && completedAt`, sorted desc, take first). Fallback: `task.updatedAt`. **The task row itself does not store a completion timestamp.** This derived value drives every week-window filter.

## 2. Rates (`PayoutSettings` row, `src/services/settings.service.ts`)

| Rate | Default | Where set |
|---|---|---|
| `commentRate` | ₹30 | dashboard Settings → PUT `/settings/payout-rates` (bounds 1–1000) |
| `postRate` | ₹60 | same (bounds 1–10000) |

Amount per task = `type === POST ? postRate : commentRate`. No karma-based or type-variant rates exist.

## 3. Week Boundary (IST, fixed logic)

- `getCurrentPayoutWeek()`: shift UTC now by `+5.5h` (IST), take Y/M/D + weekday; `sundayIST = UTC(y,m,d−weekday,0,0,0,0)`; `saturdayIST = UTC(y,m,d−weekday+6,23:59:59.999)`; convert both back to UTC by subtracting the offset.
- Result: **Sunday 00:00 IST → Saturday 23:59:59.999 IST**, expressed as UTC instants.
- `getPreviousPayoutWeek()` = current minus 7 days. Labels like `"9 Aug — 15 Aug"` (`en-IN`).
- Endpoint `GET /payouts/week` exposes current + previous; the dashboard defaults to **previous week** for "To Pay This Week".

## 4. Payout Flow (dashboard-triggered only — no scheduler)

```
Task completion → (any time) 
→ dashboard Payout page: week picker (current/previous/custom)
→ Pay Worker button → QR popup (worker name + amount + dynamic generated UPI QR with pre-filled amount when upiId is decoded,
   or fallback to uploaded payment QR, or a "No QR code uploaded yet" placeholder — paying is never blocked)
→ Confirm → POST /payouts/pay-worker/:workerId  OR  POST /payouts/pay-all   [admin]
→ eligible set (filters above)
→ PayoutBatch:
     payWorker   → reuse existing batch for the week (getOrCreateCurrentBatch) or create (batchNumber = latest+1, paidAt null)
     payAll      → ALWAYS a new batch; paidAt = now (paid immediately)
→ db.$transaction:
     per task: skip if payoutItem for taskId exists (duplicate guard)
               create PayoutItem (PI- id, amount by type, completedAt = derived completion time)
               if task.status === COMPLETED → ARCHIVED (paid tasks archive immediately)
→ batch totals incremented (workers/tasks/posts/comments/amount)
→ audits: PAYOUT_BATCH_CREATED + PAYOUT_ITEM_CREATED per item
```

- **Saturday/Sunday cutoff behavior**: there is no explicit cutoff check. A task completed in week N but paid in week N+1 lands in the batch of whichever window the payer selected — the week window only filters *eligible* tasks by their completion time.
- `payWorker` throws `"No eligible tasks found for this worker."` / `"All tasks for this worker have already been paid."`; `payAll` throws `"No eligible tasks for payout."` / `"All eligible tasks have already been paid."`; in payAll, if some tasks were already paid, actual totals are recomputed from created items.

## 4a. Payment Discord Messages

### Ticket notice (Pay Worker only)

`POST /payouts/pay-worker/:workerId` **only** (Pay All sends nothing to tickets) posts a best-effort aesthetic embed in the worker's ticket after the payment commits:

- Target channel = `channelId` of the paid tasks (each worker owns a single ticket, so all paid tasks share it) — returned as `channelId` from `payWorker()`.
- Message content tags the worker (`<@workerId>`) + `payoutCreditedEmbed` (`src/bot/embeds/index.ts`): "payment for this week credited at **<IST time>**", `💰 ₹amount for N tasks (📝 posts · 💬 comments)`, `📦 Batch #n · week label`, and "share the payment screenshot in <#1520613959315488930>".
- Time is IST (`formatIST`, `Asia/Kolkata`, e.g. `20 Sept, 4:32 pm IST`).
- Best-effort: `sendPayoutNotification()` (`src/services/payout-notification.service.ts`) never throws — missing channel / send failure is logged (`warn`) and returned as `notification: { sent, channelId, reason? }` in the API response. **The payment is never rolled back because of a Discord failure.**
- Wiring: `src/api/routes/payouts.ts` is a factory `createPayoutRoutes(discordClient)` (same shape as `tasks.ts`); mounted with the client in `src/api/server.ts`.

### Payments-channel proof (every payment — live 2026-10-27 at `e063e05`)

`PAYMENT_PROOF_CHANNEL_ID` (`1520613959315488930`) is the permanent payment log. Every successful payment generates a **Google Pay / UPI mobile payout receipt PNG image** (`src/services/payout-receipt.service.ts`) and sends it as a file attachment (`payment-receipt-<id>.png`) with **no text content at all — the payee is never mentioned/tagged** (owner request 2026-10-28). Styled identically to dark-mode UPI mobile receipts: `#111214` canvas, `#1A73E8` circular checkmark badge, large comma-formatted rupee amount (`₹{amount}`), muted "Paid to", bold payee name/label (resolved in priority order: decoded QR `payeeName` > caller `payeeLabel` > referral inviter name > task `assignedUserName` > Discord displayName/username > ticket channel name > fallback ID slice), IST date & time, and NPCI vector footer ("POWERED BY" + white UPI wordmark + chevrons + "UNIFIED PAYMENTS INTERFACE"). **No UPI ID is shown on the receipt** (owner request 2026-10-28 — removed along with its resolution; the QR lookup stays only because it supplies the payee name). Deliberately no task/commission breakdown, no batch/week, no screenshot pointer; the detailed breakdown stays in the worker's ticket message.

| Action | Proof messages | Delivery |
|---|---|---|
| Pay Worker | one (worker receipt PNG) | awaited; `proofNotification: { sent, channelId, reason? }` in the response |
| Pay All | one receipt PNG per worker | background, sequential (rate-limit friendly); response carries `proofNotification: { queued: N }` |
| Pay Inviter | one (inviter receipt PNG) | awaited; `proofNotification` in the response |
| Pay All Commissions | one receipt PNG per inviter | background, sequential; response carries `proofNotification: { queued: N }` |

Grouping/summing is pure: `src/utils/payment-proof.ts` (`summarizePayoutItemsByWorker`, `summarizeCommissionItemsByInviter`) turns the items just created into one total per payee, first-seen order. `sendPaymentProof` / `sendPaymentProofs` (`src/services/payout-notification.service.ts`) never throw — a failed send is logged (`warn`) and counted, and never rolls back a payment. Commission routes became a factory (`createCommissionRoutes(discordClient)`) so they can reach the Discord client.

## 4b. Pay-Worker and Pay-Inviter QR popups (dashboard `PayWorkerModal` & `PayInviterModal`, no pay-logic change)

Workers upload their own UPI payment QR once from the Worker Panel Wallet page (`WorkerPaymentInfo` row keyed by `workerId` = `Task.assignedUserId`, file at `uploads/payment-qr/<workerId>.<ext>`). Pure inviters who do not have tickets upload their QR code directly from the **Invites** panel (`/worker/invites`) via the shared `PaymentQrCard` component. Uploads are auto-cropped to the decoded QR region when one is found (workers post full payment posters, not tight crops — without this the popup renders a tiny code; undecodable images are kept as-is, never rejected for it), and a decodable `upi://pay` payload records the payee `upiId`.

The Worker Breakdown's "Pay Worker" button opens `PayWorkerModal` (fetched via `GET /payouts/workers/:workerId/qr-code`), and the Inviter Breakdown's "Pay Inviter" button opens `PayInviterModal` (fetched via `GET /commissions/inviters/:inviterId/qr-code`). Both modals display the payee's QR code beside their name and payout amount, with click-to-zoom full-screen lightbox and copyable UPI ID. Confirm runs the existing `payWorker` or `payInviter` action. If no QR was uploaded, a placeholder is rendered and the Confirm button stays enabled so payment is never blocked.

## 5. Reads (dashboard endpoints)

| Endpoint | Returns |
|---|---|
| `GET /payouts/summary` | `workersToPay`, `completedTasks`, `pendingAmount` (posts×postRate + comments×commentRate), `alreadyPaid` (**global all-time** sum), totals split, `weekLabel` |
| `GET /payouts/eligible` | per-worker rows `{workerId, workerName (channelName || id.slice(0,8)), posts, comments, totalAmount, status:'Ready', tasks[]}`, sorted ₹ desc |
| `GET /payouts/workers/:workerId` | detail incl. per-task `{id,type,externalTaskId,createdAt,completedAt,amount,paid}`, `status` (effectively always 'Ready' — tasks exclude paid) |
| `GET /payouts/workers/:workerId/qr-code` | `{ qrCodeUrl, updatedAt, upiId }` (URL/date null when never uploaded — paying stays possible; `upiId` from a decodable `upi://pay` payload, else null) |
| `GET /commissions/inviters/:inviterId/qr-code` | `{ qrCodeUrl, updatedAt, upiId }` (admin-only inviter payment QR code, nulls when never uploaded) |
| `GET /payouts/batches` / `:batchId` | history (weekEnd desc) / detail with worker names + externalTaskId enrichment |
| `GET /payouts/export/csv` | `Worker Name, Posts, Comments, Total Amount (₹), Payment Date, Batch Number` (payment date = batch weekStart; empty for week mode) |

## 6. Archive Interactions

- Paying marks paid `COMPLETED` → `ARCHIVED` inside the transaction.
- Daily auto-archive: only **paid** tasks older than 30 days (COMPLETED or CANCELLED) → ARCHIVED.
- Sunday archive: all paid COMPLETED → ARCHIVED.
- `POST /tasks/restore-unpaid-archived` reverts ARCHIVED-but-unpaid → COMPLETED (recovery for over-aggressive archiving).

## 7. Edge Cases & Known Issues

1. **Completion-time derivation**: if a task was completed without any reminder completing (e.g. status set manually via API), fallback is `updatedAt` — can shift a task across week boundaries.
2. `alreadyPaid` on the summary is **all-time**, not week-scoped (label may confuse).
3. Comment tasks complete at 20h; Post tasks at 70h — payouts don't distinguish.
4. If a reminder is rescheduled, `completedAt` of the (later) completing reminder governs the week, not the original 20h/70h deadline.
5. `payAll` marks `paidAt=now` at batch creation; `payWorker` batches stay `paidAt=null` until a later call (no code later fills it — effectively remains null for per-worker batches).
6. Duplicate-payment race is prevented only per `payWorker` transaction (findFirst + create in the same `$transaction`) — concurrent pay-all + pay-worker could still double-create items for the same task in theory (both guard within their own tx).
7. `PayoutItem.taskId` FK is RESTRICT — paid tasks can never be deleted.
8. Money stored as `Float` (double precision) — rounding on large sums is possible (₹ amounts are small; not observed as an issue).

## 8. Relevant Files

- `src/services/payout.service.ts` (all logic; `payWorker` also returns the ticket `channelId`)
- `src/services/payout-notification.service.ts` (best-effort ticket notice + payments-channel proof senders)
- `src/utils/payment-proof.ts` (pure per-payee grouping for proof messages)
- `src/bot/embeds/index.ts` (`payoutCreditedEmbed`, `paymentProofEmbed`, `formatIST`)
- `src/config/constants.ts` (`PAYMENT_PROOF_CHANNEL_ID`)
- `src/database/repositories/payout.repository.ts`, `settings.repository.ts`
- `src/api/routes/payouts.ts` (factory `createPayoutRoutes(discordClient)`), `src/api/routes/commissions.ts` (factory `createCommissionRoutes(discordClient)`), `src/api/server.ts` (mount)
- `src/__tests__/payout-notification.test.ts`, `src/__tests__/payment-proof.test.ts`
- `dashboard/src/pages/Payout.tsx`
- `dashboard/src/pages/payout/components/PayWorkerModal.tsx`, `PayInviterModal.tsx`
- `dashboard/src/pages/payout/utils/upiLink.ts`
- `dashboard/src/pages/payout/__tests__/upi-qr.test.tsx`