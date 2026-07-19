// ─── Task Types ──────────────────────────────────────────────

export enum TaskType {
  POST = 'POST',
  COMMENT = 'COMMENT',
}

// ─── Task Status (State Machine) ─────────────────────────────

export enum TaskStatus {
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
  redditUrl: string;
  type: TaskType;
  status: TaskStatus;

  guildId: string;
  channelId: string;

  assignedUserId: string;
  createdById: string;

  notes: string | null;

  createdAt: Date;
  updatedAt: Date;
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
}

export interface AuditLog {
  id: string;
  action: AuditAction;
  taskId: string | null;
  userId: string | null;
  details: string | null;
  createdAt: Date;
}

// ─── Create Task Input ───────────────────────────────────────

export interface CreateTaskInput {
  taskId?: string;
  redditUrl: string;
  type: TaskType;
  channelId: string;
  assignedUserId: string;
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
