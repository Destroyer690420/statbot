// ─── Task Types ──────────────────────────────────────────────

export enum TaskType {
  POST = 'POST',
  COMMENT = 'COMMENT',
}

// ─── Task Status (State Machine) ─────────────────────────────

export enum TaskStatus {
  ACCEPTED = 'ACCEPTED',
  PENDING = 'PENDING',
  REMINDER_20_SENT = 'REMINDER_20_SENT',
  INSIGHT_20_RECEIVED = 'INSIGHT_20_RECEIVED',
  REMINDER_70_SENT = 'REMINDER_70_SENT',
  INSIGHT_70_RECEIVED = 'INSIGHT_70_RECEIVED',
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED',
  CANCELLED = 'CANCELLED',
}

// ─── Reminder Types ──────────────────────────────────────────

export enum ReminderType {
  POST_20H = 'POST_20H',
  POST_70H = 'POST_70H',
  COMMENT_20H = 'COMMENT_20H',
}

// ─── Task Interface ──────────────────────────────────────────

export interface Task {
  id: string;
  redditUrl: string | null;
  type: TaskType;
  status: TaskStatus;

  guildId: string;
  channelId: string;
  channelName: string | null;

  assignedUserId: string;
  assignedUserName: string | null;
  createdById: string;

  notes: string | null;
  cancelledReason: string | null;

  // ─── GoPartTime → Discord delivery fields ──────────────────
  source: string | null;
  externalTaskId: string | null;
  sourceUrl: string | null;
  subreddit: string | null;
  subredditUrl: string | null;
  flair: string | null;
  title: string | null;
  postLink: string | null;
  contentHtml: string | null;
  formattedContent: string | null;
  payment: string | null;
  deadline: string | null;
  taskImages: TaskImage[] | null;
  deliveryMessages: DeliveryMessage[] | null;
  assignmentStatus: AssignmentStatus | null;
  assignmentError: string | null;
  submittedRedditUrl: string | null;
  submittedAt: Date | null;
  submittedBy: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;

  createdAt: Date;
  updatedAt: Date;
}

// ─── GoPartTime / Delivery Types ─────────────────────────────

export type AssignmentStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface TaskImage {
  order: number;
  url: string;
}

export type DeliveryMessageKind = 'metadata' | 'content' | 'images' | 'instruction';

export interface DeliveryMessage {
  kind: DeliveryMessageKind;
  order: number;
  messageId: string;
  createdAt: string;
}

// ─── Reminder Interface ──────────────────────────────────────

export interface Reminder {
  id: string;
  taskId: string;

  type: ReminderType;
  dueAt: Date;

  sent: boolean;
  completed: boolean;

  sentAt: Date | null;
  completedAt: Date | null;

  retryCount: number;
  jobId: string | null;
  reminderMessageId: string | null;

  insightImageUrl: string | null;
  insightImageName: string | null;
  insightUploadedAt: Date | null;
}

// ─── Audit Log ───────────────────────────────────────────────

export enum AuditAction {
  TASK_CREATED = 'TASK_CREATED',
  TASK_DELETED = 'TASK_DELETED',
  TASK_UPDATED = 'TASK_UPDATED',
  TASK_COMPLETED = 'TASK_COMPLETED',
  TASK_CANCELLED = 'TASK_CANCELLED',
  TASK_ARCHIVED = 'TASK_ARCHIVED',
  REMINDER_SENT = 'REMINDER_SENT',
  REMINDER_COMPLETED = 'REMINDER_COMPLETED',
  REMINDER_RETRY = 'REMINDER_RETRY',
  REMINDER_RESCHEDULED = 'REMINDER_RESCHEDULED',
  INSIGHT_RECEIVED = 'INSIGHT_RECEIVED',
  ADMIN_ALERT = 'ADMIN_ALERT',
  COMMAND_USED = 'COMMAND_USED',
  PAYOUT_BATCH_CREATED = 'PAYOUT_BATCH_CREATED',
  PAYOUT_ITEM_CREATED = 'PAYOUT_ITEM_CREATED',
  REFERRAL_ADDED = 'REFERRAL_ADDED',
  REFERRAL_UPDATED = 'REFERRAL_UPDATED',
  REFERRAL_REMOVED = 'REFERRAL_REMOVED',
  COMMISSION_PAID = 'COMMISSION_PAID',
  COMMISSION_BATCH_CREATED = 'COMMISSION_BATCH_CREATED',
  TASK_ASSIGNED = 'TASK_ASSIGNED',
  URL_SUBMITTED = 'URL_SUBMITTED',
  TASK_REVIEWED = 'TASK_REVIEWED',
  TASK_ACCEPTED = 'TASK_ACCEPTED',
  ASSIGNMENT_RETRIED = 'ASSIGNMENT_RETRIED',
}

export interface AuditLog {
  id: string;
  action: AuditAction;
  taskId: string | null;
  userId: string | null;
  details: string | null;
  createdAt: Date;
  /** Enriched from the referenced task for user-facing display (null when task is gone). */
  externalTaskId?: string | null;
  taskType?: TaskType | null;
}

// ─── Payout Batch ────────────────────────────────────────────

export interface PayoutBatch {
  id: string;
  batchNumber: number;
  weekStart: Date;
  weekEnd: Date;
  totalWorkers: number;
  totalTasks: number;
  totalPosts: number;
  totalComments: number;
  totalAmount: number;
  paidAt: Date | null;
  createdBy: string;
  createdAt: Date;
}

// ─── Payout Item ─────────────────────────────────────────────

export interface PayoutItem {
  id: string;
  batchId: string;
  taskId: string;
  workerId: string;
  taskType: TaskType;
  amount: number;
  completedAt: Date;
  createdAt: Date;
}

// ─── Payout Settings ─────────────────────────────────────────

export interface PayoutSettings {
  commentRate: number;
  postRate: number;
  updatedAt: Date;
  updatedBy: string;
}

// ─── Referral / Commission Types ─────────────────────────────

export type ReferralStatus = 'pending' | 'qualified' | 'active_per_task' | 'closed';
export type InviterType = 'normal' | 'special';
export type CommissionKind = 'one_time' | 'per_task';

export interface Referral {
  id: string;
  inviterId: string;
  inviterName: string;
  inviteeId: string;
  inviteeName: string;
  inviterType: InviterType;
  status: ReferralStatus;
  oneTimeCommissionPaid: boolean;
  oneTimeCommissionPaidAt: Date | null;
  perTaskCommissionActive: boolean;
  ticketId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommissionItem {
  id: string;
  batchId: string;
  referralId: string;
  inviterId: string;
  invitedWorkerId: string;
  sourceTaskId: string | null;
  commissionKind: CommissionKind;
  amount: number;
  createdAt: Date;
}

export interface CommissionBatch {
  id: string;
  batchNumber: number;
  weekStart: Date;
  weekEnd: Date;
  totalInviters: number;
  totalAmount: number;
  paidAt: Date | null;
  createdAt: Date;
}

export interface CommissionRates {
  normalInviteBonus: number;
  normalInviteTaskThreshold: number;
  specialInviteBonus: number;
  specialInviteTaskThreshold: number;
  specialPerComment: number;
  specialPerPost: number;
  updatedAt: Date;
  updatedBy: string;
}

// ─── Create Task Input ───────────────────────────────────────

export interface CreateTaskInput {
  taskId?: string;
  redditUrl: string;
  type: TaskType;
  channelId: string;
  channelName?: string;
  assignedUserId: string;
  assignedUserName?: string;
  createdById: string;
  guildId: string;
  notes?: string;
}

// ─── API Types ───────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  limit: number;
}

// ─── Stats Types ─────────────────────────────────────────────

export interface TaskStats {
  total: number;
  pending: number;
  completed: number;
  cancelled: number;
  overdue: number;
  completionRate: number;
  avgCompletionTimeHours: number;
  tasksToday: number;
  tasksThisWeek: number;
  todayPosts: number;
  todayComments: number;
  todayDeleted: number;
  totalDeleted: number;
}

// ─── Search Filters ──────────────────────────────────────────

export interface TaskFilters {
  taskId?: string;
  status?: TaskStatus;
  type?: TaskType;
  assignedUserId?: string;
  channelId?: string;
  redditUrl?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

// ─── Reminder Job Data ───────────────────────────────────────

export interface ReminderJobData {
  taskId: string;
  reminderId: string;
  type: ReminderType;
  isRetry: boolean;
  retryCount: number;
}
