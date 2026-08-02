import type { Prisma } from '../generated/prisma/client';
import {
  Task, TaskStatus, TaskType,
  Reminder, ReminderType,
  AuditLog, AuditAction,
  PayoutBatch, PayoutItem,
  Referral, ReferralStatus, InviterType,
  CommissionItem, CommissionKind,
  CommissionBatch,
  PayoutSettings, CommissionRates,
} from '../types';

type PrismaTask = {
  id: string; redditUrl: string | null; type: string; status: string;
  guildId: string; channelId: string; channelName: string | null;
  assignedUserId: string; assignedUserName: string | null; createdById: string;
  notes: string | null; cancelledReason: string | null;
  source: string | null; externalTaskId: string | null; sourceUrl: string | null;
  subreddit: string | null; subredditUrl: string | null; flair: string | null;
  title: string | null; postLink: string | null;
  contentHtml: string | null; formattedContent: string | null;
  payment: string | null; deadline: string | null;
  taskImages: Prisma.JsonValue; deliveryMessages: Prisma.JsonValue;
  assignmentStatus: string | null; assignmentError: string | null;
  submittedRedditUrl: string | null;
  submittedAt: Date | null; submittedBy: string | null;
  reviewedAt: Date | null; reviewedBy: string | null;
  createdAt: Date; updatedAt: Date;
};

export function toTask(t: PrismaTask): Task {
  return {
    id: t.id, redditUrl: t.redditUrl,
    type: t.type as TaskType, status: t.status as TaskStatus,
    guildId: t.guildId, channelId: t.channelId, channelName: t.channelName,
    assignedUserId: t.assignedUserId, assignedUserName: t.assignedUserName,
    createdById: t.createdById,
    notes: t.notes, cancelledReason: t.cancelledReason,
    source: t.source, externalTaskId: t.externalTaskId, sourceUrl: t.sourceUrl,
    subreddit: t.subreddit, subredditUrl: t.subredditUrl, flair: t.flair,
    title: t.title, postLink: t.postLink,
    contentHtml: t.contentHtml, formattedContent: t.formattedContent,
    payment: t.payment, deadline: t.deadline,
    taskImages: (t.taskImages || null) as Task['taskImages'],
    deliveryMessages: (t.deliveryMessages || null) as Task['deliveryMessages'],
    assignmentStatus: (t.assignmentStatus || null) as Task['assignmentStatus'],
    assignmentError: t.assignmentError,
    submittedRedditUrl: t.submittedRedditUrl,
    submittedAt: t.submittedAt, submittedBy: t.submittedBy,
    reviewedAt: t.reviewedAt, reviewedBy: t.reviewedBy,
    createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

type PrismaReminder = {
  id: string; taskId: string; type: string;
  dueAt: Date; sent: boolean; completed: boolean;
  sentAt: Date | null; completedAt: Date | null;
  retryCount: number; jobId: string | null;
  reminderMessageId: string | null;
  insightImageUrl: string | null; insightImageName: string | null;
  insightUploadedAt: Date | null;
};

export function toReminder(r: PrismaReminder): Reminder {
  return {
    id: r.id, taskId: r.taskId, type: r.type as ReminderType,
    dueAt: r.dueAt, sent: r.sent, completed: r.completed,
    sentAt: r.sentAt, completedAt: r.completedAt,
    retryCount: r.retryCount, jobId: r.jobId,
    reminderMessageId: r.reminderMessageId,
    insightImageUrl: r.insightImageUrl, insightImageName: r.insightImageName,
    insightUploadedAt: r.insightUploadedAt,
  };
}

type PrismaAuditLog = {
  id: string; action: string; taskId: string | null;
  userId: string | null; details: string | null; createdAt: Date;
};

export function toAuditLog(a: PrismaAuditLog): AuditLog {
  return {
    id: a.id, action: a.action as AuditAction, taskId: a.taskId,
    userId: a.userId, details: a.details, createdAt: a.createdAt,
  };
}

type PrismaPayoutBatch = {
  id: string; batchNumber: number; weekStart: Date; weekEnd: Date;
  totalWorkers: number; totalTasks: number; totalPosts: number;
  totalComments: number; totalAmount: number;
  paidAt: Date | null; createdBy: string; createdAt: Date;
};

export function toPayoutBatch(b: PrismaPayoutBatch): PayoutBatch {
  return {
    id: b.id, batchNumber: b.batchNumber,
    weekStart: b.weekStart, weekEnd: b.weekEnd,
    totalWorkers: b.totalWorkers, totalTasks: b.totalTasks,
    totalPosts: b.totalPosts, totalComments: b.totalComments,
    totalAmount: b.totalAmount,
    paidAt: b.paidAt, createdBy: b.createdBy, createdAt: b.createdAt,
  };
}

type PrismaPayoutItem = {
  id: string; batchId: string; taskId: string; workerId: string;
  taskType: string; amount: number;
  completedAt: Date; createdAt: Date;
};

export function toPayoutItem(p: PrismaPayoutItem): PayoutItem {
  return {
    id: p.id, batchId: p.batchId, taskId: p.taskId, workerId: p.workerId,
    taskType: p.taskType as TaskType, amount: p.amount,
    completedAt: p.completedAt, createdAt: p.createdAt,
  };
}

type PrismaReferral = {
  id: string; inviterId: string; inviterName: string;
  inviteeId: string; inviteeName: string; inviterType: string;
  status: string; oneTimeCommissionPaid: boolean;
  oneTimeCommissionPaidAt: Date | null; perTaskCommissionActive: boolean;
  ticketId: string | null; createdAt: Date; updatedAt: Date;
};

export function toReferral(r: PrismaReferral): Referral {
  return {
    id: r.id, inviterId: r.inviterId, inviterName: r.inviterName,
    inviteeId: r.inviteeId, inviteeName: r.inviteeName,
    inviterType: r.inviterType as InviterType,
    status: r.status as ReferralStatus,
    oneTimeCommissionPaid: r.oneTimeCommissionPaid,
    oneTimeCommissionPaidAt: r.oneTimeCommissionPaidAt,
    perTaskCommissionActive: r.perTaskCommissionActive,
    ticketId: r.ticketId, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

type PrismaCommissionItem = {
  id: string; batchId: string; referralId: string; inviterId: string;
  invitedWorkerId: string; sourceTaskId: string | null;
  commissionKind: string; amount: number; createdAt: Date;
};

export function toCommissionItem(c: PrismaCommissionItem): CommissionItem {
  return {
    id: c.id, batchId: c.batchId, referralId: c.referralId,
    inviterId: c.inviterId, invitedWorkerId: c.invitedWorkerId,
    sourceTaskId: c.sourceTaskId,
    commissionKind: c.commissionKind as CommissionKind,
    amount: c.amount, createdAt: c.createdAt,
  };
}

type PrismaCommissionBatch = {
  id: string; batchNumber: number; weekStart: Date; weekEnd: Date;
  totalInviters: number; totalAmount: number; paidAt: Date | null; createdAt: Date;
};

export function toCommissionBatch(c: PrismaCommissionBatch): CommissionBatch {
  return {
    id: c.id, batchNumber: c.batchNumber, weekStart: c.weekStart, weekEnd: c.weekEnd,
    totalInviters: c.totalInviters, totalAmount: c.totalAmount, paidAt: c.paidAt, createdAt: c.createdAt,
  };
}

export function toPayoutSettings(s: { commentRate: number; postRate: number; updatedAt: Date; updatedBy: string } | null): PayoutSettings {
  return s || { commentRate: 0, postRate: 0, updatedAt: new Date(), updatedBy: 'system' };
}

export function toCommissionRates(r: {
  normalInviteBonus: number; normalInviteTaskThreshold: number;
  specialInviteBonus: number; specialInviteTaskThreshold: number;
  specialPerComment: number; specialPerPost: number;
  updatedAt: Date; updatedBy: string;
} | null): CommissionRates {
  return r || {
    normalInviteBonus: 0, normalInviteTaskThreshold: 0,
    specialInviteBonus: 0, specialInviteTaskThreshold: 0,
    specialPerComment: 0, specialPerPost: 0,
    updatedAt: new Date(), updatedBy: 'system',
  };
}
