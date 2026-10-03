# DATABASE.md — Database Architecture

> Verified against `prisma/schema.prisma`, `prisma/migrations/migration.sql`, `src/database/*`, and git history on 2026-09-25. Credentials are NEVER documented; only names.

---

## 1. Technology & Connection Architecture

- **PostgreSQL** (installed outside Docker on the host; version UNKNOWN from the repo — container images reference none).
- **Prisma 7** (`@prisma/client` ^7.9.0) with the **`@prisma/adapter-pg`** driver adapter (`PrismaPg`).
- Client bootstrapped in `src/database/db.ts`: `initializeDatabase()` builds `new PrismaPg({ connectionString: env.DATABASE_URL })` + `PrismaClient({ adapter })`; `getDb()` returns the singleton (throws before init). Called once at startup in `src/index.ts` step 1 of 6.
- `prisma.config.ts`: schema `prisma/schema.prisma`, migrations dir `prisma/migrations`, datasource URL from env `DATABASE_URL`.
- Generator: `prisma-client` → output `../src/generated/prisma` (gitignored; regenerated at Docker build via `npx prisma generate`, or locally).
- **Transactions**: `getDb().$transaction([...])` used in `taskService.delete` (reminders+tasks) and in `payoutService.payWorker`/`payAll` and `commissionService.payInviter`/`payAll` (batch+items). `PrismaTransaction` alias in `src/database/repositories/types.ts`.

---

## 2. Migration System (IMPORTANT)

- **Single hand-maintained, idempotent file**: `prisma/migrations/migration.sql`. No `migration_lock.toml`, no timestamped folders.
- **Applied manually** (psql/SQL client). **NOT** via `prisma migrate deploy` or `migrate dev` — the Dockerfile only runs `prisma generate` + `npm run build`; no pipeline applies DDL.
- Style rules: appended sections use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `ALTER TYPE ... ADD VALUE IF NOT EXISTS` so the file can be re-run safely.
- **Future sessions**: edit BOTH `schema.prisma` AND append an idempotent block to `migration.sql`, matching column-by-column.
- Historical evolution (from git): initial 272-line file (2026-07-26, `1f01cc2`) → CommissionBatch week-columns append (`072aca9`) → GoPartTime columns + Accepted Tasks append (`445e7cf`, 2026-08-03) → two-level-referral append (`9348d2d`) then removed (`ac441e2`, 2026-08-09 — current file has no trace of it) → **outreach tables append (`TicketOutreach`, `OutreachSettings` + `OUTREACH_MESSAGE_SENT` enum value, 2026-08-18)** → **invite approval-queue append (`InviteDetection` table + indexes + `INVITE_DETECTED`/`INVITE_APPROVED`/`INVITE_REJECTED` enum values, 2026-09-03, deployed `e60ed28` via excerpt script)** → automation/blast/format-check/session-vault appends → **Worker Portal access table append (`WorkerPortalAccess`, 2026-09-25, deployed `675c618`)** → **`TicketOnboarding.redditProfileRequestedAt` column append (one-off Reddit profile sweep, 2026-09-27)** → **Reddit profile-check append (6 nullable/defaulted columns on `TicketOnboarding`: `profileCheckStatus`/`profileUsername`/`profileLinkKarma`/`profileCommentKarma`/`profileCheckedAt`/`profileReaskCount`, 2026-09-28, code complete, NOT yet applied to production)**.
- Data import history: Firestore → PostgreSQL via one-time scripts (see §10).

---

## 3. Models & Relations

```mermaid
erDiagram
    Task ||--o{ Reminder : "1..2 per task"
    Task ||--o{ AuditLog : ""
    Task ||--o{ PayoutItem : "paid"
    Task ||--o{ CommissionItem : "per_task source"
    PayoutBatch ||--o{ PayoutItem : ""
    Referral ||--o{ CommissionItem : ""
    CommissionBatch ||--o{ CommissionItem : ""

    Task {
        string id PK
        string redditUrl "nullable (GoPartTime)"
        TaskType type "POST|COMMENT"
        TaskStatus status
        string guildId
        string channelId
        string channelName "nullable"
        string assignedUserId
        string assignedUserName "nullable"
        string createdById
        string notes "nullable"
        string cancelledReason "nullable: deleted/deleted_later"
        string source "nullable: goparttime"
        string externalTaskId "nullable"
        string sourceUrl "nullable"
        string subreddit "nullable"
        string subredditUrl "nullable"
        string flair "nullable"
        string title "nullable"
        string postLink "nullable"
        string contentHtml "nullable"
        string formattedContent "nullable"
        string payment "nullable"
        string deadline "nullable"
        json taskImages "nullable"
        json deliveryMessages "nullable"
        string assignmentStatus "nullable: PENDING|SENT|FAILED"
        string assignmentError "nullable"
        string submittedRedditUrl "nullable"
        timestamp submittedAt "nullable"
        string submittedBy "nullable"
        timestamp reviewedAt "nullable"
        string reviewedBy "nullable"
        string formatCheckStatus "nullable: MATCH|PARA_MISMATCH|TITLE_MISMATCH|TEXT_MISMATCH|FETCH_ERROR|DELETED|SKIPPED|NO_SESSION|SESSION_EXPIRED"
        string formatCheckDetail "nullable: JSON {expectedParas,actualParas,titleMatch,error?}"
        timestamp formatCheckedAt "nullable"
        timestamp createdAt
        timestamp updatedAt
    }
    Reminder {
        string id PK
        string taskId FK
        ReminderType type "POST_20H|POST_70H|COMMENT_20H"
        timestamp dueAt
        boolean sent
        boolean completed
        timestamp sentAt "nullable"
        timestamp completedAt "nullable"
        int retryCount
        string jobId "nullable"
        string reminderMessageId "nullable"
        string insightImageUrl "nullable"
        string insightImageName "nullable"
        timestamp insightUploadedAt "nullable"
    }
    AuditLog {
        string id PK
        AuditAction action
        string taskId FK "nullable"
        string userId "nullable"
        string details "nullable"
        timestamp createdAt
    }
    PayoutBatch {
        string id PK
        int batchNumber
        timestamp weekStart
        timestamp weekEnd
        int totalWorkers
        int totalTasks
        int totalPosts
        int totalComments
        float totalAmount
        timestamp paidAt "nullable"
        string createdBy
        timestamp createdAt
    }
    PayoutItem {
        string id PK
        string batchId FK
        string taskId FK
        string workerId
        TaskType taskType
        float amount
        timestamp completedAt
        timestamp createdAt
    }
    Referral {
        string id PK
        string inviterId
        string inviterName
        string inviteeId
        string inviteeName
        InviterType inviterType "normal|special"
        ReferralStatus status "pending|qualified|active_per_task|closed"
        boolean oneTimeCommissionPaid
        timestamp oneTimeCommissionPaidAt "nullable"
        boolean perTaskCommissionActive
        string ticketId "nullable"
        timestamp createdAt
        timestamp updatedAt
    }
    CommissionBatch {
        string id PK
        int batchNumber
        timestamp weekStart "default 2026-01-01"
        timestamp weekEnd "default 2026-01-07"
        int totalInviters
        float totalAmount
        timestamp paidAt "nullable"
        timestamp createdAt
    }
    CommissionItem {
        string id PK
        string batchId FK
        string referralId FK
        string inviterId
        string invitedWorkerId
        string sourceTaskId FK "nullable"
        CommissionKind commissionKind "one_time|per_task"
        float amount
        timestamp createdAt
    }
    PayoutSettings {
        string id PK "default 'payout-rates'"
        float commentRate "default 30"
        float postRate "default 60"
        timestamp updatedAt
        string updatedBy
    }
    CommissionRates {
        string id PK "default 'commission-rates'"
        float normalInviteBonus "default 100"
        int normalInviteTaskThreshold "default 2"
        float specialInviteBonus "default 50"
        int specialInviteTaskThreshold "default 1"
        float specialPerComment "default 10"
        float specialPerPost "default 20"
        timestamp updatedAt
        string updatedBy
    }
    TicketOutreach {
        string id PK
        string channelId UNIQUE "Discord channel ID"
        boolean selected "persists across days"
        timestamp messageSentAt "nullable; last daily send"
        timestamp availableAt "nullable; first worker reply of cycle"
        timestamp updatedAt
    }
    TicketOnboarding {
        string channelId PK
        timestamp welcomeSentAt "nullable; set on channelCreate welcome (enrollProfileCheck)"
        timestamp guideSentAt "nullable; set only when the worker PASSES the profile check"
        timestamp redditProfileRequestedAt "nullable; one-off profile sweep, exactly-once"
        string profileCheckStatus "nullable; PENDING|PASSED|BANNED|LOW_KARMA|UNVERIFIABLE; NULL = not enrolled = never touched"
        string profileUsername "nullable; lowercased, last checked"
        int profileLinkKarma "nullable"
        int profileCommentKarma "nullable"
        timestamp profileCheckedAt "nullable"
        int profileReaskCount "default 0; caps the re-ask loop"
        timestamp createdAt
        timestamp updatedAt
    }
    WorkerPortalAccess {
        string channelId PK "per-ticket portal access"
        string workerId "worker who last logged in from ticket"
        timestamp firstSeenAt "first successful portal login"
        timestamp lastSeenAt "most recent successful portal login"
        timestamp updatedAt
    }
    WorkerPaymentInfo {
        string workerId PK "Discord user id = Task.assignedUserId; the QR follows the worker, not the ticket"
        string filename "current file: <workerId>.png|jpg|webp under uploads/payment-qr/"
        string mimeType "sniffed format's MIME, never the declared one"
        string upiId "nullable; payee address from a decodable upi://pay payload (auto-crop side-effect)"
        timestamp updatedAt "bumped on every upload; drives the ?v= cache-buster"
    }
    OutreachSettings {
        string id PK "default 'outreach-message'"
        string message "configurable daily message"
        timestamp updatedAt
        string updatedBy
    }
    InviteDetection {
        string id PK "INV-XXXXXXXX"
        string inviterId "nullable; null = unknown"
        string inviterName "nullable"
        string inviteeId
        string inviteeName "nullable"
        string inviteCode "nullable"
        string ticketChannelId "nullable; first ticket only"
        string ticketName "nullable"
        string status "pending|approved|rejected (plain text)"
        timestamp createdAt
        timestamp updatedAt
    }
    BlockedSubreddit {
        string subreddit PK "normalized lower, no r/ prefix; exact match"
        string reason "nullable"
        timestamp createdAt
        string createdBy
    }
    AutomationSettings {
        string id PK "default 'automation'"
        boolean enabled "master switch"
        boolean dryRun "default true; WOULD_ACCEPT only"
        boolean pollEnabled "browser scans on/off"
        timestamp updatedAt
        string updatedBy
    }
    GoPartTimeSession {
        string id PK "default 'default'"
        string sessionCipher "nullable; AES-256-GCM"
        string csrfCipher "nullable; AES-256-GCM"
        string callbackUrl "nullable"
        string nextAction "nullable; 64-hex server-action id"
        string userAgent "nullable"
        timestamp updatedAt
        string updatedBy
    }
    AutomationCycle {
        string id PK "YYYY-MM-DD-HH:MM + suffix"
        timestamp startedAt
        timestamp endedAt "nullable"
        string status "RUNNING|DONE|STOPPED"
        int tasksDetected / eligiblePosts / blocked / duplicates / commentsSkipped
        int workersContacted / workersConfirmed / postsAccepted / failures
        boolean dryRun
    }
    AutomationContact {
        string id PK "cuid"
        string cycleId
        string channelId
        string workerId "nullable"
        string status "CONTACTED|CONFIRMED|RESERVED|ASSIGNED|TIMED_OUT|DECLINED|BUSY"
        timestamp sentAt
        timestamp expiresAt "+5min"
        timestamp respondedAt "nullable"
        string messageId "nullable"
    }
    AutomationTaskLog {
        string id PK "cuid"
        string cycleId
        string externalTaskId "GoPartTime sub_task id"
        string taskType "post|comment"
        string subreddit "nullable"
        string status "ELIGIBLE|SKIPPED_COMMENT|BLOCKED|DUPLICATE|NO_WORKER|WOULD_ACCEPT|ACCEPTED|FAILED"
        string workerId "nullable"
        string failureReason "nullable"
        timestamp createdAt
    }
    AutomationSighting {
        string id PK "cuid"
        string externalTaskId UNIQUE "sub_task id"
        string taskType "post|comment"
        string subreddit "nullable"
        string title "nullable"
        string status "NEW|CONTACTING|DONE"
        string companionId "nullable"
        timestamp firstSeenAt
        timestamp lastSeenAt
    }
    AutomationClaim {
        string id PK "cuid"
        string cycleId
        string externalTaskId
        string channelId
        string workerId "nullable"
        string status "PENDING|CLAIMED|FAILED|EXPIRED"
        timestamp createdAt
        timestamp expiresAt "+10min"
        timestamp respondedAt "nullable"
        string failureReason "nullable"
        string leasedBy "nullable — Phase-2 per-tab lease holder"
        timestamp leasedAt "nullable — Phase-2 lease time; stale after CLAIM_LEASE_TIMEOUT_MS (3min)"
    }
    CompanionStatus {
        string id PK "default 'companion'"
        timestamp lastSeenAt
        string version "nullable"
        timestamp updatedAt
    }
    AutomationBurst {
        string id PK "cuid"
        string blastId UNIQUE "OutreachBlast id"
        string cycleId "burst cycle"
        string[] taskIds "ordered eligible externalTaskIds"
        string status "OPEN|CLOSED"
        timestamp createdAt
        timestamp updatedAt
    }
```

### Enums (7)

| Enum | Values |
|---|---|
| `TaskType` | `POST`, `COMMENT` |
| `TaskStatus` | `ACCEPTED`, `PENDING`, `REMINDER_20_SENT`, `INSIGHT_20_RECEIVED`, `REMINDER_70_SENT`, `INSIGHT_70_RECEIVED`, `COMPLETED`, `ARCHIVED`, `CANCELLED` |
| `ReminderType` | `POST_20H`, `POST_70H`, `COMMENT_20H` |
| `AuditAction` | `TASK_CREATED`, `TASK_DELETED`, `TASK_UPDATED`, `TASK_COMPLETED`, `TASK_CANCELLED`, `TASK_ARCHIVED`, `REMINDER_SENT`, `REMINDER_COMPLETED`, `REMINDER_RETRY`, `REMINDER_RESCHEDULED`, `INSIGHT_RECEIVED`, `ADMIN_ALERT`, `COMMAND_USED`, `PAYOUT_BATCH_CREATED`, `PAYOUT_ITEM_CREATED`, `REFERRAL_ADDED`, `REFERRAL_REMOVED`, `COMMISSION_PAID`, `COMMISSION_BATCH_CREATED`, `TASK_ASSIGNED`, `URL_SUBMITTED`, `TASK_REVIEWED`, `TASK_ACCEPTED`, `ASSIGNMENT_RETRIED`, `OUTREACH_MESSAGE_SENT`, `INVITE_DETECTED`, `INVITE_APPROVED`, `INVITE_REJECTED` |
| `ReferralStatus` | `pending`, `qualified`, `active_per_task`, `closed` |
| `InviterType` | `normal`, `special` |
| `CommissionKind` | `one_time`, `per_task`, `per_task_indirect` |

Note: only `pending`, `qualified`, and `active_per_task` are ever written by the code (`commission.service.payInviter/payAll`); `closed` is only read (excluded from payable sets) and must be set manually if ever used (see KNOWN_ISSUES.md #36).

---

## 4. Foreign Keys (from migration.sql)

| FK | FK → PK | On Delete | On Update |
|---|---|---|---|
| `Reminder_taskId_fkey` | Reminder.taskId → Task.id | **CASCADE** | CASCADE |
| `AuditLog_taskId_fkey` | AuditLog.taskId → Task.id | SET NULL | CASCADE |
| `PayoutItem_batchId_fkey` | PayoutItem.batchId → PayoutBatch.id | RESTRICT | CASCADE |
| `PayoutItem_taskId_fkey` | PayoutItem.taskId → Task.id | RESTRICT | CASCADE |
| `CommissionItem_batchId_fkey` | CommissionItem.batchId → CommissionBatch.id | RESTRICT | CASCADE |
| `CommissionItem_referralId_fkey` | CommissionItem.referralId → Referral.id | RESTRICT | CASCADE |
| `CommissionItem_sourceTaskId_fkey` | CommissionItem.sourceTaskId → Task.id | SET NULL | CASCADE |

Consequence: you **cannot delete a Task that has payout/commission items** (RESTRICT) — hence "paid tasks are archived, not deleted".

---

## 5. Indexes & Uniques (48 non-unique + 3 unique index statements)

| Index | Columns |
|---|---|
| Task: `status`, `(status, guildId)`, `channelId`, `assignedUserId`, `(redditUrl, guildId)`, `(channelName, status)`, `(assignedUserId, status)`, `createdAt` | |
| **`Task_source_externalTaskId_key` (UNIQUE)** | `(source, externalTaskId)` — GoPartTime dedupe |
| Reminder: `taskId`, `(sent, completed)`, `reminderMessageId` | |
| AuditLog: `(taskId, createdAt)`, `createdAt` | |
| PayoutBatch: `batchNumber`, `(weekStart, weekEnd)`, `weekEnd` | |
| PayoutItem: `batchId`, `taskId` | no `workerId` index (known performance gap) |
| WorkerPortalAccess: `channelId` | primary key |
| WorkerPaymentInfo: `workerId` | primary key (no secondary indexes — always keyed by worker) |
| Referral: `inviterId`, `(inviteeId, inviterId)`, `createdAt` | |
| CommissionBatch: `batchNumber` | |
| CommissionItem: `batchId`, `(referralId, inviterId, commissionKind)`, `(inviterId, sourceTaskId, commissionKind)` | |

---

## 6. Important Queries (repository layer)

| Query | Where | Note |
|---|---|---|
| Overdue tasks | `task.repository.findOverdue()` | `status IN (REMINDER_20_SENT, REMINDER_70_SENT) ORDER BY updatedAt ASC` |
| Payout eligibility | `findCompletedOrArchived()` | used by payout/commission + archive checks |
| Paid-task set | `payout.repository.getPaidTaskIds()` | `findMany({ select: { taskId: true } })` → `Set` |
| Total paid ₹ | `getTotalPaid()` | `aggregate({_sum:{amount}})` — **global, not week-scoped** |
| Duplicate referral | `findByInviteeAndInviter(inviteeId, inviterId)` | `findFirst` |
| Dedup one-time commission | `commission.findOneTimeCommission(referralId, inviterId)` | `kind='one_time'` |
| Dedup per-task commission | `findPerTaskCommission(inviterId, sourceTaskId)` | `kind='per_task'` |
| Delivery-message lookup | `task.findByDeliveryMessageId(channelId, messageId)` | scans JSONB array in JS |
| Awaiting-submission guard | `findAwaitingSubmissionInChannel(channelId)` | `source='goparttime'`, status PENDING/ACCEPTED, `submittedRedditUrl: null` |
| Re-hydration | `reminder.findPending()` / `findPendingSent()` | unsent / sent-not-completed |
| Week window exact match | `payout.findBatchByWeek(weekStart, weekEnd)` | idempotent batch reuse |

---

## 7. Data Lifecycle

```
create (Task PENDING / ACCEPTED for GoPartTime)
→ reminders created + BullMQ jobs
→ status walk … → COMPLETED
→ paid (PayoutItem) → archive (paid COMPLETED/CANCELLED, auto daily/weekly)
→ ARCHIVED is terminal; unpaid ARCHIVED can be restored to COMPLETED (dashboard button)
```

- **Deletion**: `DELETE /tasks/:id` only works before payment items exist (RESTRICT); reminders cascade.
- **Archiving**: paid tasks with `cancelledReason` OR completed; unpaid stay COMPLETED.
- **Hard delete of Referral**: allowed (`DELETE /commissions/referrals/:id`) — but RESTRICT if CommissionItems reference it (only the task FK is SET NULL). In practice items exist only after payment; deleting an unpaid referral's items is blocked → deletion of a paid referral FAILS at DB level (RESTRICT). (Edge case documented in KNOWN_ISSUES.md.)

---

## 8. Settings Rows (singleton pattern)

| Table | PK | Fields | Defaults used by service |
|---|---|---|---|
| `PayoutSettings` | `'payout-rates'` | commentRate, postRate, updatedAt, updatedBy | ₹30 / ₹60 |
| `CommissionRates` | `'commission-rates'` | normalInviteBonus 100, normalInviteTaskThreshold 2, specialInviteBonus 50, specialInviteTaskThreshold 1, specialPerComment 10, specialPerPost 20 | as listed |

Rows may be absent (fresh DB): services fall back to defaults. Converters return zero-valued fallbacks.

---

## 9. Insight Images (not in DB)

Stored on disk: `<cwd>/uploads/insights/<taskId>/<reminderId>.<ext>`; DB columns `Reminder.insightImageUrl/insightImageName/insightUploadedAt` point at them; 60h TTL cleanup deletes files (see `docs/INSIGHT_SYSTEM.md`).

---

## 10. Firestore History & Legacy

- App was originally **100% Firestore** (`src/database/firebase.ts`, `firebase-admin`, `firestore.indexes.json` 23 composite indexes, `firebase.json`).
- Cutover 2026-07-26: Phase 4 repository rewrite (`1f01cc2`, "1325 documents imported"), Phase 5 (`702520a`) removed Firebase runtime; cleanup removed env vars (`57338de`) and export script (`67f15b5`).
- **Remaining legacy footprint** (inactive):
  - `firebase.json`, `firestore.indexes.json` (config only, unused).
  - `.env.example` stale `FIREBASE_*` block.
  - `src/index.ts:156` comment mention; `dashboard/src/pages/Payout.tsx` `formatFirestoreDate` helper (`_seconds` timestamps).
  - `.gitignore` entry for the old service-account key file name.
- **No code imports Firebase.** `package-lock.json` has no `firebase-admin`.

---

## 11. Utility Scripts (data)

| Script | Purpose | Status |
|---|---|---|
| `scripts/import-postgres.ts` | One-time Firestore JSON → PostgreSQL importer (reads `export/*.json`, per-model `create`, skips conflicts, reports per-collection counts; skips settings) | Manual tool, run via `npx tsx scripts/import-postgres.ts`; not in package.json |
| `scripts/export-firestore.ts` | Former exporter | **Deleted** (`67f15b5`) |
| `query-tasks.ts` / `query-tasks.js` | Ad-hoc debug queries, **hardcoded DB password inside** | Untracked; treat as sensitive; consider deleting |

---

## 12. Backup/Restore

**No backup/restore mechanism exists in the repo** (no pg_dump scripts, no volume snapshot references, no documentation). UNKNOWN how production backups are handled.

---

## 13. Known Database Issues

1. Generated Prisma client is gitignored; run `npx prisma generate` after any schema change or strict TypeScript will use a stale client locally (Docker regenerates during build).
2. `findCompleted`/`findCompletedOrArchived` do date filtering/sorting in JS (performance risk at scale).
3. `alreadyPaid` payout summary is global (all-time) — not week-scoped (matches code; intended?).
4. Payout/completion time is derived from the most recent completed reminder's `completedAt` (fallback `updatedAt`) rather than being stored on the task.
5. `deliveryMessages`/`taskImages` JSONB scanned in JS for message lookups.
6. `redditUrl` is nullable but the unique index on `(source, externalTaskId)` treats NULLs as distinct (Postgres semantics — fine for dedupe since source is always 'goparttime' for external rows).