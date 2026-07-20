import { Message } from 'discord.js';
import { reminderService } from '../../services/reminder.service';
import { taskService } from '../../services/task.service';
import { isSupportedImage } from '../../utils/validators';
import { TaskStatus, AuditAction } from '../../types';
import { getStatusAfterInsightReceived, shouldComplete } from '../../services/state-machine';
import { auditLogService } from '../../services/audit.service';
import { logger } from '../../utils/logger';

export async function handleMessageCreate(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (message.attachments.size === 0) return;
  if (!message.guild) return;

  try {
    const imageAttachments = message.attachments.filter((att) => {
      const name = att.name || '';
      return isSupportedImage(name);
    });

    if (imageAttachments.size === 0) return;

    if (!message.reference?.messageId) return;

    const repliedToId = message.reference.messageId;
    const reminder = await reminderService.findByMessageId(repliedToId);
    if (!reminder) return;

    const task = await taskService.findById(reminder.taskId);
    if (!task) return;

    if (task.assignedUserId !== message.author.id) return;

    if (reminder.completed) {
      await message.reply('⚠️ Insight already received.');
      return;
    }

    await reminderService.markCompleted(reminder.id, message.author.id);

    const newStatus = getStatusAfterInsightReceived(task.status, task.type);
    if (newStatus !== task.status) {
      await taskService.updateStatus(task.id, newStatus, message.author.id);
    }

    const updatedTask = await taskService.findById(task.id);
    if (updatedTask && shouldComplete(updatedTask.status, updatedTask.type)) {
      await taskService.updateStatus(updatedTask.id, TaskStatus.COMPLETED, message.author.id);
    }

    await message.react('✅');
    await message.reply('✅ Insight received successfully.');

    await auditLogService.log(
      AuditAction.INSIGHT_RECEIVED,
      task.id,
      message.author.id,
      `Insight uploaded for ${reminder.type}`,
    );

    logger.info('Insight received via reply', {
      taskId: task.id,
      reminderId: reminder.id,
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
