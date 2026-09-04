import { EmbedBuilder } from 'discord.js';
import { Task, Reminder, TaskStats, ReminderType } from '../../types';
import { InstructionMessage } from '../../utils/plain-task-message';
import { displayTaskId } from '../../utils/task-display';
import { WorkerStats, TaskMoneySplit } from '../../utils/member-stats';
import { InviterStats } from '../../services/member-stats.service';
import { COLORS } from '../../config/constants';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

/**
 * Build a task creation success embed.
 */
export function taskCreatedEmbed(task: Task, reminderCount: number): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('✅ Task Created')
    .setColor(COLORS.SUCCESS)
    .addFields(
      { name: 'Task ID', value: `\`${displayTaskId(task.id, task.type, task.externalTaskId)}\``, inline: true },
      { name: 'Type', value: task.type, inline: true },
      { name: 'Status', value: task.status, inline: true },
      { name: 'Assigned', value: `<@${task.assignedUserId}>`, inline: true },
      { name: 'Ticket', value: `<#${task.channelId}>`, inline: true },
      { name: 'Reminders', value: `${reminderCount}`, inline: true },
      { name: 'Reddit URL', value: task.redditUrl || 'Awaiting submission' },
    )
    .setTimestamp()
    .setFooter({ text: 'Reddit Task Manager' });
}

/**
 * Build a task status embed.
 */
export function taskStatusEmbed(task: Task, reminders: Reminder[]): EmbedBuilder {
  let statusDisplay: string = task.status;
  if (task.status === 'CANCELLED' && task.cancelledReason) {
    const label = task.cancelledReason === 'deleted' ? 'Deleted' : 'Deleted Later';
    statusDisplay += ` — ${label}`;
  }

  const embed = new EmbedBuilder()
    .setTitle(`📋 Task Status — ${displayTaskId(task.id, task.type, task.externalTaskId)}`)
    .setColor(getStatusColor(task.status))
    .addFields(
      { name: 'Status', value: statusDisplay, inline: true },
      { name: 'Type', value: task.type, inline: true },
      { name: 'Assigned', value: `<@${task.assignedUserId}>`, inline: true },
      { name: 'Ticket', value: `<#${task.channelId}>`, inline: true },
      { name: 'Created', value: dayjs(task.createdAt).format('MMM D, YYYY h:mm A'), inline: true },
      { name: 'Reddit', value: task.redditUrl || 'Awaiting submission' },
    );

  if (task.notes) {
    embed.addFields({ name: 'Notes', value: task.notes });
  }

  // Reminder status
  if (reminders.length > 0) {
    const reminderLines = reminders.map((r) => {
      const status = r.completed ? '✅' : r.sent ? '⏳' : '⏰';
      const dueStr = dayjs(r.dueAt).format('MMM D, h:mm A');
      const retryStr = r.retryCount > 0 ? ` (retry ${r.retryCount})` : '';
      return `${status} **${formatReminderType(r.type)}** — ${dueStr}${retryStr}`;
    });
    embed.addFields({ name: 'Reminders', value: reminderLines.join('\n') });
  }

  // Next reminder
  const nextReminder = reminders.find((r) => !r.completed && !r.sent);
  if (nextReminder) {
    embed.addFields({
      name: 'Next Reminder',
      value: `${formatReminderType(nextReminder.type)} — ${dayjs(nextReminder.dueAt).fromNow()}`,
    });
  }

  return embed.setTimestamp().setFooter({ text: 'Reddit Task Manager' });
}

/**
 * Build a task list embed (for search results, pending, completed, etc.).
 */
export function taskListEmbed(
  title: string,
  tasks: Task[],
  page: number,
  totalPages: number,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(COLORS.INFO)
    .setTimestamp()
    .setFooter({ text: `Page ${page}/${totalPages} • Reddit Task Manager` });

  if (tasks.length === 0) {
    embed.setDescription('No tasks found.');
    return embed;
  }

  const lines = tasks.map((task) => {
    const statusIcon = getStatusIcon(task.status, task);
    const ago = dayjs(task.createdAt).fromNow();
    let extra = '';
    if (task.status === 'CANCELLED' && task.cancelledReason) {
      extra = task.cancelledReason === 'deleted' ? ' • 🗑️ Deleted' : ' • 🗑️ Deleted Later';
    }
    return `${statusIcon} \`${displayTaskId(task.id, task.type, task.externalTaskId)}\` • **${task.type}** • <@${task.assignedUserId}> • ${ago}${extra}`;
  });

  embed.setDescription(lines.join('\n'));
  return embed;
}

/**
 * Build a stats embed.
 */
export function statsEmbed(stats: TaskStats): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('📊 Task Statistics')
    .setColor(COLORS.INFO)
    .addFields(
      { name: 'Total Tasks', value: `${stats.total}`, inline: true },
      { name: 'Pending', value: `${stats.pending}`, inline: true },
      { name: 'Completed', value: `${stats.completed}`, inline: true },
      { name: 'Cancelled', value: `${stats.cancelled}`, inline: true },
      { name: 'Overdue', value: `${stats.overdue}`, inline: true },
      { name: 'Completion Rate', value: `${stats.completionRate}%`, inline: true },
      { name: 'Avg Completion Time', value: `${stats.avgCompletionTimeHours}h`, inline: true },
      { name: 'Tasks Today', value: `${stats.tasksToday}`, inline: true },
      { name: "Today's Posts", value: `${stats.todayPosts ?? 0}`, inline: true },
      { name: "Today's Comments", value: `${stats.todayComments ?? 0}`, inline: true },
      { name: "Today's Deleted", value: `${stats.todayDeleted ?? 0}`, inline: true },
      { name: 'Total Deleted', value: `${stats.totalDeleted ?? 0}`, inline: true },
      { name: 'Tasks This Week', value: `${stats.tasksThisWeek}`, inline: true },
    )
    .setTimestamp()
    .setFooter({ text: 'Reddit Task Manager' });
}

/**
 * Format a rupee amount without trailing noise (₹100, not ₹100.00).
 */
function formatRs(amount: number): string {
  return `₹${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

function formatMoneySplit(split: TaskMoneySplit, pending: boolean): string {
  const prefix = pending ? '~' : '';
  return `${prefix}${formatRs(split.amount)} (${split.tasks} task${split.tasks === 1 ? '' : 's'})`;
}

/**
 * Build a worker's personal stats embed (week + all-time sections).
 */
export function workerStatsEmbed(displayName: string, stats: WorkerStats): EmbedBuilder {
  const w = stats.week;
  const a = stats.allTime;
  return new EmbedBuilder()
    .setTitle(`📊 Stats — ${displayName}`)
    .setColor(COLORS.INFO)
    .addFields(
      {
        name: `📅 This Week (${stats.weekLabel})`,
        value: [
          `✅ ${w.completed} done (📝 ${w.posts} · 💬 ${w.comments})`,
          `💰 Paid: ${formatMoneySplit(w.paid, false)}`,
          `⏳ Pending: ${formatMoneySplit(w.pending, true)}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '📊 All Time',
        value: [
          `🗂️ ${a.total} tasks (📝 ${a.posts} · 💬 ${a.comments})`,
          `✅ ${a.completed} completed · 🔄 ${a.inProgress} in progress`,
          `💰 Paid: ${formatMoneySplit(a.paid, false)}`,
          `⏳ Pending: ${formatMoneySplit(a.pending, true)}`,
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'Pending = all insights received, awaiting payout • Reddit Task Manager' })
    .setTimestamp();
}

/**
 * Build an inviter's referral progress embed (direct invites only).
 */
export function inviterStatsEmbed(stats: InviterStats): EmbedBuilder {
  const t = stats.totals;
  const lines = stats.invitees.slice(0, 15).map((inv) => {
    const ticket = inv.ticketId ? `🎟 \`${inv.ticketId}\`` : '🎟 no ticket yet';
    const progress = inv.thresholdMet ? '✅' : '⏳';
    const bonus = inv.bonusPaid > 0
      ? `${formatRs(inv.bonusPaid)} paid`
      : inv.bonusPending > 0
        ? `~${formatRs(inv.bonusPending)} pending`
        : '—';
    return `<@${inv.inviteeId}> · ${ticket} · tasks **${inv.tasks}/${inv.threshold}** ${progress} · bonus ${bonus}`;
  });
  if (stats.invitees.length > 15) {
    lines.push(`…and ${stats.invitees.length - 15} more`);
  }
  return new EmbedBuilder()
    .setTitle(`🔗 Invites — ${stats.inviterName} (${stats.inviterType})`)
    .setColor(COLORS.INFO)
    .setDescription(lines.join('\n'))
    .addFields({
      name: '📊 Totals',
      value: [
        `👥 ${t.invited} invited · 🎟 ${t.ticketsCreated} tickets · ✅ ${t.qualified} qualified`,
        `💰 Bonus: ${formatRs(t.bonusPaid)} paid · ~${formatRs(t.bonusPending)} pending`,
        `💰 Per-task: ${formatRs(t.perTaskPaid)} paid · ~${formatRs(t.perTaskPending)} pending`,
      ].join('\n'),
      inline: false,
    })
    .setFooter({ text: 'Direct invites only • Reddit Task Manager' })
    .setTimestamp();
}

/**
 * Build an error embed.
 */
export function errorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('❌ Error')
    .setDescription(message)
    .setColor(COLORS.ERROR)
    .setTimestamp();
}

/**
 * Build a success embed.
 */
export function successEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setDescription(`✅ ${message}`)
    .setColor(COLORS.SUCCESS)
    .setTimestamp();
}

/**
 * Build a warning embed.
 */
export function warningEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setDescription(`⚠️ ${message}`)
    .setColor(COLORS.WARNING)
    .setTimestamp();
}

/**
 * Build the help embed.
 */
export function helpEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('📖 Reddit Task Manager — Help')
    .setColor(COLORS.INFO)
    .setDescription('Manage Reddit tasks with automated reminders.')
    .addFields(
      {
        name: '📝 /task',
        value: 'Create a new Reddit task.\n`/task reddit_url type ticket assigned_user [notes]`',
      },
      {
        name: '📋 /status',
        value: 'View task status and reminder info.\n`/status task_id`',
      },
      {
        name: '🔍 /find',
        value: 'Search tasks with filters.\n`/find [task_id] [status] [type] [user] [ticket] [url]`',
      },
      {
        name: '⏳ /pending',
        value: 'Show all pending and overdue tasks.',
      },
      {
        name: '✅ /completed',
        value: 'Show completed tasks.\n`/completed [period]`',
      },
      {
        name: '⏰ /overdue',
        value: 'Show overdue tasks sorted by longest overdue.',
      },
      {
        name: '📊 /stats',
        value: 'Display task analytics and statistics.',
      },
      {
        name: '🔄 /reschedule',
        value: 'Reschedule a reminder.\n`/reschedule task_id reminder new_time`',
      },
      {
        name: '⚡ /send-now',
        value: 'Send a reminder immediately.\n`/send-now task_id reminder`',
      },
      {
        name: '🗑️ /delete',
        value: 'Delete a task and its reminders.\n`/delete task_id`',
      },
      {
        name: '❓ /help',
        value: 'Show this help message.',
      },
      {
        name: '🔗 /referral add',
        value: 'Add a referral link (admin only).\n`/referral add inviter invitee type`\n🔒',
      },
      {
        name: '📊 /mystats',
        value: 'Check your task stats: done, paid and pending (week + all time).\n`/mystats [user]` (user = admins only)',
      },
      {
        name: '🔗 /myinvites',
        value: 'Check your invites: tickets, task progress and bonus.\n`/myinvites [user]` (user = admins only)',
      },
    )
    .setFooter({ text: '🔒 = Admin only • Reddit Task Manager' });
}

// ─── Helper Functions ────────────────────────────────────────

/**
 * Build the submission instruction embed for GoPartTime tasks. Sent as the
 * final delivery message (kind: instruction) so it stands out from the
 * plain-text task content; the worker replies to it with the task link.
 */
export function submissionInstructionEmbed(instruction: InstructionMessage): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(instruction.title)
    .setDescription(instruction.lines.join('\n'))
    .setColor(COLORS.PENDING)
    .setFooter({ text: instruction.footer })
    .setTimestamp();
}

function getStatusColor(status: string): number {
  switch (status) {
    case 'COMPLETED':
    case 'ARCHIVED':
      return COLORS.COMPLETED;
    case 'CANCELLED':
      return COLORS.ERROR;
    case 'PENDING':
      return COLORS.PENDING;
    default:
      return COLORS.INFO;
  }
}

function getStatusIcon(status: string, task?: Task): string {
  switch (status) {
    case 'PENDING': return '🟡';
    case 'REMINDER_20_SENT': return '🔵';
    case 'INSIGHT_20_RECEIVED': return '🟢';
    case 'REMINDER_70_SENT': return '🔵';
    case 'INSIGHT_70_RECEIVED': return '🟢';
    case 'COMPLETED': return '✅';
    case 'ARCHIVED': return '📦';
    case 'CANCELLED':
      if (task?.cancelledReason === 'deleted' || task?.cancelledReason === 'deleted_later') return '🗑️';
      return '❌';
    default: return '⚪';
  }
}

function formatReminderType(type: ReminderType): string {
  switch (type) {
    case ReminderType.POST_20H: return 'Post 20H';
    case ReminderType.POST_70H: return 'Post 70H';
    case ReminderType.COMMENT_20H: return 'Comment 20H';
    default: return type;
  }
}
