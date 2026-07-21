import { Worker, Job } from 'bullmq';
import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { QUEUE_NAME, MAX_REMINDER_ATTEMPTS, COLORS } from '../config/constants';
import { ReminderJobData, TaskStatus, ReminderType } from '../types';
import { taskService } from '../services/task.service';
import { reminderService } from '../services/reminder.service';
import { getStatusAfterReminderSent } from '../services/state-machine';
import { scheduleRetryJob } from './jobs';
import { logger } from '../utils/logger';

let worker: Worker;

/**
 * Build the reminder embed message.
 */
function buildReminderEmbed(
  type: ReminderType,
  redditUrl: string,
  taskType: string,
  taskId: string,
  isRetry: boolean,
  retryCount: number,
): EmbedBuilder {
  const is70h = type === ReminderType.POST_70H;
  const title = is70h ? '🔔 Final Reminder' : '🔔 Insight Reminder';
  const hourLabel = is70h ? '70-hour' : '20-hour';

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(`Please upload the **${hourLabel}** insight.`)
    .addFields(
      { name: 'Task ID', value: taskId, inline: true },
      { name: 'Task', value: taskType, inline: true },
      { name: 'Reddit', value: redditUrl },
    )
    .setColor(isRetry ? COLORS.WARNING : COLORS.INFO)
    .setTimestamp();

  if (isRetry) {
    embed.setFooter({ text: `Retry ${retryCount} of ${MAX_REMINDER_ATTEMPTS} — Reply with your screenshot.` });
  } else {
    embed.setFooter({ text: 'Reply to this message with your screenshot.' });
  }

  return embed;
}

/**
 * Initialize the BullMQ worker that processes reminder jobs.
 */
export function initializeWorker(discordClient: Client): Worker {
  if (worker) return worker;

  const connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  worker = new Worker<ReminderJobData>(
    QUEUE_NAME,
    async (job: Job<ReminderJobData>) => {
      const { taskId, reminderId, type, isRetry, retryCount } = job.data;

      logger.info('Processing reminder job', { taskId, reminderId, type, isRetry, retryCount });

      const task = await taskService.findById(taskId);
      if (!task) {
        logger.warn('Task not found, skipping job', { taskId });
        return;
      }

      if (task.status === TaskStatus.CANCELLED || task.status === TaskStatus.ARCHIVED || task.cancelledReason !== null) {
        logger.info('Task cancelled/archived/has cancelledReason, skipping reminder', { taskId, cancelledReason: task.cancelledReason });
        return;
      }

      const reminder = await reminderService.findById(reminderId);
      if (!reminder) {
        logger.warn('Reminder not found, skipping', { reminderId });
        return;
      }

      if (reminder.completed) {
        logger.info('Reminder already completed, skipping', { reminderId });
        return;
      }

      try {
        const channel = await discordClient.channels.fetch(task.channelId);
        if (!channel || !(channel instanceof TextChannel)) {
          logger.error('Channel not found or not a text channel', { channelId: task.channelId });
          return;
        }

        const embed = buildReminderEmbed(type, task.redditUrl, task.type, task.id, isRetry, retryCount);

        const sentMessage = await channel.send({
          content: `<@${task.assignedUserId}>`,
          embeds: [embed],
        });

        await reminderService.updateReminderMessageId(reminderId, sentMessage.id);

        if (!reminder.sent) {
          await reminderService.markSent(reminderId);

          const newStatus = getStatusAfterReminderSent(task.status);
          if (newStatus !== task.status) {
            await taskService.updateStatus(taskId, newStatus);
          }
        }

        logger.info('Reminder sent successfully', { taskId, reminderId, type });

      } catch (error) {
        logger.error('Failed to send reminder', { taskId, reminderId, error });
        throw error;
      }
    },
    {
      connection: connection as any,
      concurrency: 5,
    },
  );

  // ─── Worker Events ──────────────────────────────────────────

  worker.on('completed', async (job) => {
    if (!job) return;
    const { reminderId, taskId } = job.data;

    logger.info('Reminder job completed', { jobId: job.id, reminderId });

    // Skip retry if the task was cancelled/archived (e.g. post deleted)
    const taskDoc = await taskService.findById(taskId);
    if (!taskDoc || taskDoc.status === TaskStatus.CANCELLED || taskDoc.status === TaskStatus.ARCHIVED || taskDoc.cancelledReason !== null) return;

    const reminder = await reminderService.findById(reminderId);
    if (!reminder || !reminder.sent || reminder.completed) return;

    if (reminder.retryCount < MAX_REMINDER_ATTEMPTS) {
      const newRetryCount = await reminderService.incrementRetry(reminderId);
      const scheduledJobId = await scheduleRetryJob(reminder, newRetryCount);
      if (scheduledJobId === null) {
        // Max retries reached — notify admin
        await notifyAdminOverdue(discordClient, taskId, reminder.type);
      }
    } else {
      // retryCount >= MAX_REMINDER_ATTEMPTS — notify admin directly
      await notifyAdminOverdue(discordClient, taskId, reminder.type);
    }
  });

  worker.on('failed', (job, error) => {
    logger.error('Reminder job failed', {
      jobId: job?.id,
      error: error.message,
      attempts: job?.attemptsMade,
    });

    if (job?.data?.taskId) {
      notifyAdminOverdue(discordClient, job.data.taskId, job.data.type);
    }
  });

  worker.on('error', (error) => {
    logger.error('Worker error', { error: error.message });
  });

  logger.info('BullMQ worker initialized');
  return worker;
}

/**
 * Notify admin about an overdue task.
 */
async function notifyAdminOverdue(
  client: Client,
  taskId: string,
  reminderType: ReminderType,
): Promise<void> {
  try {
    const task = await taskService.findById(taskId);
    if (!task) return;

    const channel = await client.channels.fetch(task.channelId);
    if (!channel || !(channel instanceof TextChannel)) return;

    const hourLabel = reminderType === ReminderType.POST_70H ? '70H' : '20H';

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Overdue Task')
      .addFields(
        { name: 'Assigned', value: `<@${task.assignedUserId}>`, inline: true },
        { name: 'Task', value: task.id, inline: true },
        { name: 'Reminder', value: hourLabel, inline: true },
        { name: 'Ticket', value: `<#${task.channelId}>`, inline: true },
      )
      .setColor(COLORS.OVERDUE)
      .setTimestamp();

    const { getAllAdminIds } = await import('../utils/permissions');
    const adminPings = getAllAdminIds().map((id) => `<@${id}>`).join(' ');
    await channel.send({
      content: `${adminPings} — Task overdue after ${MAX_REMINDER_ATTEMPTS} reminder attempts`,
      embeds: [embed],
    });

    logger.warn('Admin notified about overdue task', { taskId, reminderType });
  } catch (error) {
    logger.error('Failed to notify admin', { taskId, error });
  }
}

/**
 * Close the worker gracefully.
 */
export async function closeWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    logger.info('Worker closed');
  }
}
