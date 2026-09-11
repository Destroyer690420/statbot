-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('POST', 'COMMENT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'REMINDER_20_SENT', 'INSIGHT_20_RECEIVED', 'REMINDER_70_SENT', 'INSIGHT_70_RECEIVED', 'COMPLETED', 'ARCHIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('POST_20H', 'POST_70H', 'COMMENT_20H');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('TASK_CREATED', 'TASK_DELETED', 'TASK_UPDATED', 'TASK_COMPLETED', 'TASK_CANCELLED', 'TASK_ARCHIVED', 'REMINDER_SENT', 'REMINDER_COMPLETED', 'REMINDER_RETRY', 'REMINDER_RESCHEDULED', 'INSIGHT_RECEIVED', 'ADMIN_ALERT', 'COMMAND_USED', 'PAYOUT_BATCH_CREATED', 'PAYOUT_ITEM_CREATED', 'REFERRAL_ADDED', 'REFERRAL_REMOVED', 'COMMISSION_PAID', 'COMMISSION_BATCH_CREATED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'qualified', 'active_per_task', 'closed');

-- CreateEnum
CREATE TYPE "InviterType" AS ENUM ('normal', 'special');

-- CreateEnum
CREATE TYPE "CommissionKind" AS ENUM ('one_time', 'per_task');

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "redditUrl" TEXT NOT NULL,
    "type" "TaskType" NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT,
    "assignedUserId" TEXT NOT NULL,
    "assignedUserName" TEXT,
    "createdById" TEXT NOT NULL,
    "notes" TEXT,
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" "ReminderType" NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "jobId" TEXT,
    "reminderMessageId" TEXT,
    "insightImageUrl" TEXT,
    "insightImageName" TEXT,
    "insightUploadedAt" TIMESTAMP(3),

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "taskId" TEXT,
    "userId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutBatch" (
    "id" TEXT NOT NULL,
    "batchNumber" INTEGER NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "totalWorkers" INTEGER NOT NULL,
    "totalTasks" INTEGER NOT NULL,
    "totalPosts" INTEGER NOT NULL,
    "totalComments" INTEGER NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "taskType" "TaskType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviterName" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "inviteeName" TEXT NOT NULL,
    "inviterType" "InviterType" NOT NULL,
    "status" "ReferralStatus" NOT NULL,
    "oneTimeCommissionPaid" BOOLEAN NOT NULL DEFAULT false,
    "oneTimeCommissionPaidAt" TIMESTAMP(3),
    "perTaskCommissionActive" BOOLEAN NOT NULL DEFAULT false,
    "ticketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionBatch" (
    "id" TEXT NOT NULL,
    "batchNumber" INTEGER NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL DEFAULT '2026-01-01 00:00:00',
    "weekEnd" TIMESTAMP(3) NOT NULL DEFAULT '2026-01-07 23:59:59',
    "totalInviters" INTEGER NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "invitedWorkerId" TEXT NOT NULL,
    "sourceTaskId" TEXT,
    "commissionKind" "CommissionKind" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutSettings" (
    "id" TEXT NOT NULL DEFAULT 'payout-rates',
    "commentRate" DOUBLE PRECISION NOT NULL,
    "postRate" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "PayoutSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRates" (
    "id" TEXT NOT NULL DEFAULT 'commission-rates',
    "normalInviteBonus" DOUBLE PRECISION NOT NULL,
    "normalInviteTaskThreshold" INTEGER NOT NULL,
    "specialInviteBonus" DOUBLE PRECISION NOT NULL,
    "specialInviteTaskThreshold" INTEGER NOT NULL,
    "specialPerComment" DOUBLE PRECISION NOT NULL,
    "specialPerPost" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "CommissionRates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_status_guildId_idx" ON "Task"("status", "guildId");

-- CreateIndex
CREATE INDEX "Task_channelId_idx" ON "Task"("channelId");

-- CreateIndex
CREATE INDEX "Task_assignedUserId_idx" ON "Task"("assignedUserId");

-- CreateIndex
CREATE INDEX "Task_redditUrl_guildId_idx" ON "Task"("redditUrl", "guildId");

-- CreateIndex
CREATE INDEX "Task_channelName_status_idx" ON "Task"("channelName", "status");

-- CreateIndex
CREATE INDEX "Task_assignedUserId_status_idx" ON "Task"("assignedUserId", "status");

-- CreateIndex
CREATE INDEX "Task_createdAt_idx" ON "Task"("createdAt");

-- CreateIndex
CREATE INDEX "Reminder_taskId_idx" ON "Reminder"("taskId");

-- CreateIndex
CREATE INDEX "Reminder_sent_completed_idx" ON "Reminder"("sent", "completed");

-- CreateIndex
CREATE INDEX "Reminder_reminderMessageId_idx" ON "Reminder"("reminderMessageId");

-- CreateIndex
CREATE INDEX "AuditLog_taskId_createdAt_idx" ON "AuditLog"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "PayoutBatch_batchNumber_idx" ON "PayoutBatch"("batchNumber");

-- CreateIndex
CREATE INDEX "PayoutBatch_weekStart_weekEnd_idx" ON "PayoutBatch"("weekStart", "weekEnd");

-- CreateIndex
CREATE INDEX "PayoutBatch_weekEnd_idx" ON "PayoutBatch"("weekEnd");

-- CreateIndex
CREATE INDEX "PayoutItem_batchId_idx" ON "PayoutItem"("batchId");

-- CreateIndex
CREATE INDEX "PayoutItem_taskId_idx" ON "PayoutItem"("taskId");

-- CreateIndex
CREATE INDEX "Referral_inviterId_idx" ON "Referral"("inviterId");

-- CreateIndex
CREATE INDEX "Referral_inviteeId_inviterId_idx" ON "Referral"("inviteeId", "inviterId");

-- CreateIndex
CREATE INDEX "Referral_createdAt_idx" ON "Referral"("createdAt");

-- CreateIndex
CREATE INDEX "CommissionBatch_batchNumber_idx" ON "CommissionBatch"("batchNumber");

-- CreateIndex
CREATE INDEX "CommissionItem_batchId_idx" ON "CommissionItem"("batchId");

-- CreateIndex
CREATE INDEX "CommissionItem_referralId_inviterId_commissionKind_idx" ON "CommissionItem"("referralId", "inviterId", "commissionKind");

-- CreateIndex
CREATE INDEX "CommissionItem_inviterId_sourceTaskId_commissionKind_idx" ON "CommissionItem"("inviterId", "sourceTaskId", "commissionKind");

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PayoutBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionItem" ADD CONSTRAINT "CommissionItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CommissionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionItem" ADD CONSTRAINT "CommissionItem_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionItem" ADD CONSTRAINT "CommissionItem_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migration: add weekStart/weekEnd to CommissionBatch for existing DBs
ALTER TABLE "CommissionBatch" ADD COLUMN IF NOT EXISTS "weekStart" TIMESTAMP(3) NOT NULL DEFAULT '2026-01-01 00:00:00';
ALTER TABLE "CommissionBatch" ADD COLUMN IF NOT EXISTS "weekEnd" TIMESTAMP(3) NOT NULL DEFAULT '2026-01-07 23:59:59';

-- ──────────────────────────────────────────────────────────────
-- Migration: GoPartTime → Discord task delivery
-- ──────────────────────────────────────────────────────────────
-- Task.redditUrl becomes nullable: GoPartTime tasks are assigned
-- before any Reddit URL exists (URL is submitted by the worker
-- and bound at review time).
ALTER TABLE "Task" ALTER COLUMN "redditUrl" DROP NOT NULL;

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "externalTaskId" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "subreddit" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "subredditUrl" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "flair" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "postLink" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "commentLink" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "contentHtml" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "formattedContent" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "payment" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "deadline" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "taskImages" JSONB;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "deliveryMessages" JSONB;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "assignmentStatus" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "assignmentError" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "submittedRedditUrl" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "submittedBy" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT;

-- GoPartTime Task ID is the primary external identifier (duplicate prevention)
CREATE UNIQUE INDEX IF NOT EXISTS "Task_source_externalTaskId_key" ON "Task"("source", "externalTaskId");

-- Audit log actions for the GoPartTime flow
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TASK_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'URL_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TASK_REVIEWED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ASSIGNMENT_RETRIED';

-- ──────────────────────────────────────────────────────────────
-- Migration: Accepted Tasks queue (pre-activation gate)
-- ──────────────────────────────────────────────────────────────
-- New lifecycle status: tasks arrive ACCEPTED (delivered to the ticket)
-- and only move to PENDING when the manager marks them Done.
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';

-- Audit action for the "Done" (accept into workflow) step
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TASK_ACCEPTED';

-- ⚠️ DANGER: a one-time data backfill used to live here (UPDATE Task SET
-- status='ACCEPTED' WHERE source='goparttime' AND status='PENDING', plus a
-- DELETE FROM "Reminder" for those tasks). It was applied once during the
-- 2026-08-04 cutover and MUST NEVER be re-run: re-running it reverts every
-- activated (PENDING) GoPartTime task back to ACCEPTED and wipes its
-- reminders. It was removed on 2026-08-12 after a re-run during a deploy
-- corrupted 48 tasks (restored via scripts/restore-accepted.ts). If the
-- Accepted-Tasks gate ever needs re-derivation, do it with an explicit,
-- versioned one-off script — never inside this idempotent migration file.

-- ──────────────────────────────────────────────────────────────
-- Migration: Two-level referral (indirect special inviter commissions)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE "Referral" ADD COLUMN IF NOT EXISTS "indirectSpecialInviterId" TEXT;
CREATE INDEX IF NOT EXISTS "Referral_indirectSpecialInviterId_idx" ON "Referral"("indirectSpecialInviterId");
ALTER TYPE "CommissionKind" ADD VALUE IF NOT EXISTS 'per_task_indirect';

-- ──────────────────────────────────────────────────────────────
-- Migration: Daily Worker Outreach (ticket selection + daily state)
-- ──────────────────────────────────────────────────────────────
-- One row per Discord ticket channel. `selected` persists across days;
-- `messageSentAt`/`availableAt` are the current daily cycle (cleared lazily
-- when the next IST day starts).
CREATE TABLE IF NOT EXISTS "TicketOutreach" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "selected" BOOLEAN NOT NULL DEFAULT false,
  "messageSentAt" TIMESTAMP(3),
  "availableAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TicketOutreach_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TicketOutreach_channelId_key" ON "TicketOutreach"("channelId");

-- Singleton row holding the configurable daily outreach message
CREATE TABLE IF NOT EXISTS "OutreachSettings" (
  "id" TEXT NOT NULL DEFAULT 'outreach-message',
  "message" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT NOT NULL,
  CONSTRAINT "OutreachSettings_pkey" PRIMARY KEY ("id")
);

-- Audit action for the daily outreach message broadcast
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'OUTREACH_MESSAGE_SENT';

-- ──────────────────────────────────────────────────────────────
-- Migration: Ticket onboarding (auto-welcome + guide, once per ticket)
-- ──────────────────────────────────────────────────────────────
-- One row per new ticket channel. welcomeSentAt set when channelCreate
-- welcome is sent; guideSentAt set when the opener's first message triggers
-- the onboarding guide. Both guard exactly-once delivery after restarts.
CREATE TABLE IF NOT EXISTS "TicketOnboarding" (
  "channelId" TEXT NOT NULL,
  "welcomeSentAt" TIMESTAMP(3),
  "guideSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TicketOnboarding_pkey" PRIMARY KEY ("channelId")
);

-- ──────────────────────────────────────────────────────────────
-- Migration: Invite auto-detection approval queue
-- ──────────────────────────────────────────────────────────────
-- Staging rows for Discord-invite joins. A row is created on
-- guildMemberAdd (inviter resolved via invite-use diff, ticket empty),
-- the invitee's first ticket is linked on channelCreate, and an admin
-- approves the row from the dashboard — approval creates the real
-- Referral via commissionService.createReferral. Unapproved rows never
-- enter payout/commission math.
CREATE TABLE IF NOT EXISTS "InviteDetection" (
  "id" TEXT NOT NULL,
  "inviterId" TEXT,
  "inviterName" TEXT,
  "inviteeId" TEXT NOT NULL,
  "inviteeName" TEXT,
  "inviteCode" TEXT,
  "ticketChannelId" TEXT,
  "ticketName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InviteDetection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InviteDetection_inviteeId_idx" ON "InviteDetection"("inviteeId");
CREATE INDEX IF NOT EXISTS "InviteDetection_status_idx" ON "InviteDetection"("status");
CREATE INDEX IF NOT EXISTS "InviteDetection_createdAt_idx" ON "InviteDetection"("createdAt");

-- Audit actions for the invite approval flow
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVITE_DETECTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVITE_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVITE_REJECTED';

-- ──────────────────────────────────────────────────────────────
-- Migration: Automated GoPartTime Post Acceptance (Phase 1 foundation)
-- ──────────────────────────────────────────────────────────────
-- All tables IF NOT EXISTS; all enum values ADD VALUE IF NOT EXISTS.
-- Schema-only (no data statements). Poller runs in persistent Chromium
-- (Vercel bot wall blocks plain fetch); cookies live encrypted in
-- GoPartTimeSession (AES-256-GCM, key GOPARTTIME_SESSION_KEY), never logged.
CREATE TABLE IF NOT EXISTS "BlockedSubreddit" (
  "subreddit" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  CONSTRAINT "BlockedSubreddit_pkey" PRIMARY KEY ("subreddit")
);

CREATE TABLE IF NOT EXISTS "AutomationSettings" (
  "id" TEXT NOT NULL DEFAULT 'automation',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "dryRun" BOOLEAN NOT NULL DEFAULT true,
  "pollEnabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT NOT NULL,
  CONSTRAINT "AutomationSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GoPartTimeSession" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "sessionCipher" TEXT,
  "csrfCipher" TEXT,
  "callbackUrl" TEXT,
  "nextAction" TEXT,
  "userAgent" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT NOT NULL,
  CONSTRAINT "GoPartTimeSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutomationCycle" (
  "id" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "tasksDetected" INTEGER NOT NULL DEFAULT 0,
  "eligiblePosts" INTEGER NOT NULL DEFAULT 0,
  "blocked" INTEGER NOT NULL DEFAULT 0,
  "duplicates" INTEGER NOT NULL DEFAULT 0,
  "commentsSkipped" INTEGER NOT NULL DEFAULT 0,
  "workersContacted" INTEGER NOT NULL DEFAULT 0,
  "workersConfirmed" INTEGER NOT NULL DEFAULT 0,
  "postsAccepted" INTEGER NOT NULL DEFAULT 0,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "dryRun" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "AutomationCycle_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AutomationCycle_startedAt_idx" ON "AutomationCycle"("startedAt");
CREATE INDEX IF NOT EXISTS "AutomationCycle_status_idx" ON "AutomationCycle"("status");

CREATE TABLE IF NOT EXISTS "AutomationContact" (
  "id" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "workerId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'CONTACTED',
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "messageId" TEXT,
  CONSTRAINT "AutomationContact_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AutomationContact_cycleId_idx" ON "AutomationContact"("cycleId");
CREATE INDEX IF NOT EXISTS "AutomationContact_channelId_status_idx" ON "AutomationContact"("channelId", "status");

CREATE TABLE IF NOT EXISTS "AutomationTaskLog" (
  "id" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "externalTaskId" TEXT NOT NULL,
  "taskType" TEXT NOT NULL,
  "subreddit" TEXT,
  "status" TEXT NOT NULL,
  "workerId" TEXT,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationTaskLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AutomationTaskLog_cycleId_idx" ON "AutomationTaskLog"("cycleId");
CREATE INDEX IF NOT EXISTS "AutomationTaskLog_externalTaskId_idx" ON "AutomationTaskLog"("externalTaskId");

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AUTOMATION_CYCLE_STARTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AUTOMATION_CONTACT_SENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AUTOMATION_CONTACT_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AUTOMATION_TASK_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AUTOMATION_TASK_FAILED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AUTOMATION_BLOCKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AUTOMATION_SESSION_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AUTOMATION_STOPPED';

-- ──────────────────────────────────────────────────────────────
-- Migration: Hybrid companion flow (browser watcher + claim queue)
-- ──────────────────────────────────────────────────────────────
-- The manager's trusted browser reports task sightings and performs the
-- in-page accept; the server never fetches GoPartTime in this mode.
CREATE TABLE IF NOT EXISTS "AutomationSighting" (
  "id" TEXT NOT NULL,
  "externalTaskId" TEXT NOT NULL,
  "taskType" TEXT NOT NULL,
  "subreddit" TEXT,
  "title" TEXT,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "companionId" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationSighting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationSighting_externalTaskId_key" ON "AutomationSighting"("externalTaskId");
CREATE INDEX IF NOT EXISTS "AutomationSighting_status_lastSeenAt_idx" ON "AutomationSighting"("status", "lastSeenAt");

CREATE TABLE IF NOT EXISTS "AutomationClaim" (
  "id" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "externalTaskId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "workerId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  CONSTRAINT "AutomationClaim_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AutomationClaim_status_expiresAt_idx" ON "AutomationClaim"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "AutomationClaim_externalTaskId_idx" ON "AutomationClaim"("externalTaskId");

CREATE TABLE IF NOT EXISTS "CompanionStatus" (
  "id" TEXT NOT NULL DEFAULT 'companion',
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanionStatus_pkey" PRIMARY KEY ("id")
);

-- ──────────────────────────────────────────────────────────────
-- Migration: Outreach Blast (n-slot campaigns)
-- ──────────────────────────────────────────────────────────────
-- Each Send creates a blast with n slots. First-n repliers win; on fill,
-- the bot message is deleted from all other contacted tickets (winners keep
-- theirs). Workers at the 2-post daily cap are never contacted. Reload-safe:
-- all state in Postgres. Schema-only, no data statements.
CREATE TABLE IF NOT EXISTS "OutreachBlast" (
  "id" TEXT NOT NULL,
  "slotsTotal" INTEGER NOT NULL,
  "slotsFilled" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  CONSTRAINT "OutreachBlast_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OutreachBlast_status_createdAt_idx" ON "OutreachBlast"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "OutreachBlastMessage" (
  "id" TEXT NOT NULL,
  "blastId" TEXT NOT NULL REFERENCES "OutreachBlast"("id") ON DELETE CASCADE,
  "channelId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutreachBlastMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OutreachBlastMessage_blastId_channelId_key" ON "OutreachBlastMessage"("blastId", "channelId");
CREATE INDEX IF NOT EXISTS "OutreachBlastMessage_blastId_idx" ON "OutreachBlastMessage"("blastId");

CREATE TABLE IF NOT EXISTS "OutreachReply" (
  "id" TEXT NOT NULL,
  "blastId" TEXT NOT NULL REFERENCES "OutreachBlast"("id") ON DELETE CASCADE,
  "channelId" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "repliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutreachReply_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OutreachReply_blastId_channelId_key" ON "OutreachReply"("blastId", "channelId");
CREATE INDEX IF NOT EXISTS "OutreachReply_blastId_idx" ON "OutreachReply"("blastId");

-- ──────────────────────────────────────────────────────────────
-- Migration: Burst auto-accept (eligible scan -> auto-blast -> reply-to-claim)
-- ──────────────────────────────────────────────────────────────
-- The watcher reports browser-filtered eligible posts; the server opens an
-- OutreachBlast with slots = eligible count and converts each blast reply
-- into one AutomationClaim (lazy accept — nothing is ever accepted without
-- a named winner holding it). The burst row links blast <-> cycle and holds
-- the ordered eligible externalTaskIds. Schema-only, no data statements.
CREATE TABLE IF NOT EXISTS "AutomationBurst" (
  "id" TEXT NOT NULL,
  "blastId" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "taskIds" TEXT[] NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationBurst_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationBurst_blastId_key" ON "AutomationBurst"("blastId");
CREATE INDEX IF NOT EXISTS "AutomationBurst_status_idx" ON "AutomationBurst"("status");

-- ──────────────────────────────────────────────────────────────
-- Migration: Burst pooled task details (per-task subreddit)
-- ──────────────────────────────────────────────────────────────
-- Leftover re-validation needs each pooled task's subreddit, otherwise
-- tasks validated with a null subreddit slip past the blocked list.
-- Nullable JSON array [{id, subreddit, title}]; old rows fall back to
-- bare taskIds (unknown subreddit, rejected for safety by the validator).
ALTER TABLE "AutomationBurst" ADD COLUMN IF NOT EXISTS "taskDetails" TEXT;
