import { Message } from 'discord.js';
import { taskService } from '../../services/task.service';
import { reminderService } from '../../services/reminder.service';
import { isSupportedImage } from '../../utils/validators';
import { TaskStatus, AuditAction } from '../../types';
import { getStatusAfterInsightReceived, shouldComplete } from '../../services/state-machine';
import { auditLogService } from '../../services/audit.service';
import { logger } from '../../utils/logger';

/**
 * Handle messageCreate event — detect insight uploads in ticket channels.
 */
export async function handleMessageCreate(message: Message): Promise<void> {
  // Ignore bots
  if (message.author.bot) return;

  // Ignore empty messages without attachments
  if (message.attachments.size === 0) return;

  // Ignore DMs
  if (!message.guild) return;

  try {
    // Check if this channel has any active tasks
    const tasks = await taskService.findByChannel(message.channel.id);
    if (tasks.length === 0) return;

    // Check if any attachments are supported images
    const imageAttachments = message.attachments.filter((att) => {
      const name = att.name || '';
      return isSupportedImage(name);
    });

    if (imageAttachments.size === 0) return;

    // Find a task assigned to this user that is waiting for an insight
    const userTask = tasks.find((t) => t.assignedUserId === message.author.id);
    if (!userTask) return;

    // Find the active reminder waiting for insight
    const waitingReminder = await reminderService.findWaitingForInsight(userTask.id);

    if (!waitingReminder) {
      // Check if there's already a completed reminder (duplicate upload)
      const allReminders = await reminderService.findByTaskId(userTask.id);
      const lastCompleted = allReminders
        .filter((r) => r.completed)
        .sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0))[0];

      if (lastCompleted) {
        // All reminders completed — duplicate upload
        await message.reply('⚠️ Insight already received.');
        return;
      }

      // No pending reminder exists — ignore
      return;
    }

    // Mark the reminder as completed
    await reminderService.markCompleted(waitingReminder.id, message.author.id);

    // Update task status
    const newStatus = getStatusAfterInsightReceived(userTask.status, userTask.type);
    if (newStatus !== userTask.status) {
      await taskService.updateStatus(userTask.id, newStatus, message.author.id);
    }

    // Check if task should be fully completed
    const updatedTask = await taskService.findById(userTask.id);
    if (updatedTask && shouldComplete(updatedTask.status, updatedTask.type)) {
      await taskService.updateStatus(updatedTask.id, TaskStatus.COMPLETED, message.author.id);
    }

    // React with checkmark
    await message.react('✅');

    // Reply with confirmation
    await message.reply('✅ Insight received successfully.');

    await auditLogService.log(
      AuditAction.INSIGHT_RECEIVED,
      userTask.id,
      message.author.id,
      `Insight uploaded for ${waitingReminder.type}`,
    );

    logger.info('Insight received', {
      taskId: userTask.id,
      reminderId: waitingReminder.id,
      userId: message.author.id,
      channelId: message.channel.id,
    });

  } catch (error) {
    logger.error('Error handling message for insight detection', {
      error,
      channelId: message.channel.id,
      userId: message.author.id,
    });
  }
}
