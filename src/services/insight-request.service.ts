import { Client, TextChannel } from 'discord.js';
import { taskService } from './task.service';
import { formatInsightRequestMessage, pickInsightRequestLink } from '../utils/insight-request';
import { displayTaskId } from '../utils/task-display';
import { OWNER_USER_ID } from '../config/constants';
import { logger } from '../utils/logger';

/**
 * Manual "Request insight" action from the dashboard Tasks page.
 *
 * This is intentionally read-only: it sends one message into the task's
 * ticket channel and never touches task status, reminders, jobs, audit rows
 * or any other persisted state. Owner-requested behavior for personal use.
 */
export class InsightRequestService {
  async requestInsight(
    taskId: string,
    discordClient: Client,
  ): Promise<{ channelId: string; messageId: string }> {
    const task = await taskService.findById(taskId);
    if (!task) throw new Error('Task not found.');

    const channel = await discordClient.channels.fetch(task.channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) {
      throw new Error('Ticket channel not found or is not a text channel.');
    }

    const content = formatInsightRequestMessage({
      workerId: task.assignedUserId,
      adminId: OWNER_USER_ID,
      taskId: displayTaskId(task.id, task.type, task.externalTaskId),
      type: task.type,
      link: pickInsightRequestLink(task),
    });

    const message = await channel.send({
      content,
      // Only ping the task's worker and the admin — never anyone else.
      allowedMentions: { users: [task.assignedUserId, OWNER_USER_ID], roles: [], parse: [] },
    });

    logger.info('Insight request sent from dashboard', {
      taskId: task.id,
      channelId: task.channelId,
      workerId: task.assignedUserId,
      messageId: message.id,
    });

    return { channelId: task.channelId, messageId: message.id };
  }
}

export const insightRequestService = new InsightRequestService();
