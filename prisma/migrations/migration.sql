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
