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
→ Pay Worker button → QR popup (worker name + amount + uploaded payment QR,
   or a "No QR code uploaded yet" placeholder — paying is never blocked)
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

## 4a. Pay-Worker Ticket Notification (bot message in the worker's ticket)

`POST /payouts/pay-worker/:workerId` **only** (Pay All sends nothing) posts a best-effort aesthetic embed in the worker's ticket after the payment commits:

- Target channel = `channelId` of the paid tasks (each worker owns a single ticket, so all paid tasks share it) — returned as `channelId` from `payWorker()`.
- Message content tags the worker (`<@workerId>`) + `payoutCreditedEmbed` (`src/bot/embeds/index.ts`): "payment for this week credited at **<IST time>**", `💰 ₹amount for N tasks (📝 posts · 💬 comments)`, `📦 Batch #n · week label`, and "share the payment screenshot in <#1520613959315488930>".
- Time is IST (`formatIST`, `Asia/Kolkata`, e.g. `20 Sept, 4:32 pm IST`).
- Best-effort: `sendPayoutNotification()` (`src/services/payout-notification.service.ts`) never throws — missing channel / send failure is logged (`warn`) and returned as `notification: { sent, channelId, reason? }` in the API response. **The payment is never rolled back because of a Discord failure.**
- Wiring: `src/api/routes/payouts.ts` is a factory `createPayoutRoutes(discordClient)` (same shape as `tasks.ts`); mounted with the client in `src/api/server.ts`.

## 4b. Pay-Worker QR popup (dashboard `PayWorkerModal`, no pay-logic change)

Workers upload their own UPI payment QR once from the Worker Panel Wallet page (`WorkerPaymentInfo` row keyed by `workerId` = `Task.assignedUserId`, file at `uploads/payment-qr/<workerId>.<ext>`). Uploads are auto-cropped to the decoded QR region when one is found (workers post full payment posters, not tight crops — without this the popup renders a tiny code; undecodable images are kept as-is, never rejected for it), and a decodable `upi://pay` payload records the payee `upiId`. The Worker Breakdown's "Pay Worker" button opens a popup showing that QR next to the worker name + amount (fetched via `GET /payouts/workers/:workerId/qr-code`; click the code for a near-natural-size lightbox), plus the `upiId` with a copy button when present; Confirm runs the exact same `payWorker` request as before (same params, same invalidation, same Discord "you've been paid" notification) and closes the popup. No QR uploaded → a plain placeholder, Confirm stays enabled: `payWorker` has no QR validation by design, so workers who never uploaded one are still payable exactly as before. QR validation details (PNG/JPEG/WebP by sniffed format, 3 MB cap, ≤1200px same-format resize, no lossy compression — a lossy pass can break QR modules) live in `src/utils/payment-qr.ts`; the design rationale in `docs/DECISIONS.md` Decision 22.

## 5. Reads (dashboard endpoints)

| Endpoint | Returns |
|---|---|
| `GET /payouts/summary` | `workersToPay`, `completedTasks`, `pendingAmount` (posts×postRate + comments×commentRate), `alreadyPaid` (**global all-time** sum), totals split, `weekLabel` |
| `GET /payouts/eligible` | per-worker rows `{workerId, workerName (channelName || id.slice(0,8)), posts, comments, totalAmount, status:'Ready', tasks[]}`, sorted ₹ desc |
| `GET /payouts/workers/:workerId` | detail incl. per-task `{id,type,externalTaskId,createdAt,completedAt,amount,paid}`, `status` (effectively always 'Ready' — tasks exclude paid) |
| `GET /payouts/workers/:workerId/qr-code` | `{ qrCodeUrl, updatedAt, upiId }` (URL/date null when never uploaded — paying stays possible; `upiId` from a decodable `upi://pay` payload, else null) |
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
- `src/services/payout-notification.service.ts` (best-effort ticket notice sender)
- `src/bot/embeds/index.ts` (`payoutCreditedEmbed`, `formatIST`)
- `src/config/constants.ts` (`PAYMENT_PROOF_CHANNEL_ID`)
- `src/database/repositories/payout.repository.ts`, `settings.repository.ts`
- `src/api/routes/payouts.ts` (factory `createPayoutRoutes(discordClient)`), `src/api/server.ts` (mount)
- `src/__tests__/payout-notification.test.ts`
- `dashboard/src/pages/Payout.tsx`