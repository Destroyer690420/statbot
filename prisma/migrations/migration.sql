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
