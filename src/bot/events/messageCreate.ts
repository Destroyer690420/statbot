import { Message, TextChannel } from 'discord.js';
import { reminderService } from '../../services/reminder.service';
import { taskService } from '../../services/task.service';
import { goparttimeService } from '../../services/goparttime.service';
import { insightStorageService } from '../../services/insight-storage.service';
import { outreachService } from '../../services/outreach.service';
import { handleAutomationReply } from '../../services/automation/worker-manager.service';
import { isSupportedImage, isValidRedditUrl } from '../../utils/validators';
import { taskRepository, onboardingRepository } from '../../database/repositories';
import { TaskStatus, AuditAction } from '../../types';
import { getStatusAfterInsightReceived, shouldComplete } from '../../services/state-machine';
import { auditLogService } from '../../services/audit.service';
import { logger } from '../../utils/logger';
import { getAllAdminIds } from '../../utils/permissions';
import { TICKET_GUIDE_MESSAGE } from '../../config/constants';

export async function handleMessageCreate(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guild) return;

  try {
    await outreachService.onWorkerMessage(message.channel.id, message.author.id, message.client);

    // Automation Stage-2: worker reply within the 5-min confirmation window.
    await handleAutomationReply(message.channel.id, message.author.id).catch(() => undefined);

    // Ticket onboarding guide: once per new ticket, on the opener's first message after welcome
    await handleTicketGuide(message).catch((err) =>
      logger.warn('Ticket guide handler failed', {
        channelId: message.channel.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );

    const handled = await handleInstructionReply(message);
    if (handled) return;

    if (message.attachments.size > 0) {
      await handleInsightUpload(message);
    }
  } catch (error) {
    logger.error('Error handling message', {
      error,
      channelId: message.channel.id,
      userId: message.author.id,
    });
  }
}

/**
 * Worker replies to the final instruction message with the submitted Reddit
 * URL. The instruction message is the last delivery record (kind
 * "instruction") of an ACCEPTED GoPartTime task, so the task is resolved from
 * the referenced message ID. Only the assigned worker can submit, the reply
 * must contain exactly one valid Reddit URL, and the task must be ACCEPTED or
 * PENDING with a successful delivery. A later submission replaces the
 * previously submitted URL.
 */
async function handleInstructionReply(message: Message): Promise<boolean> {
  const repliedToId = message.reference?.messageId;
  if (!repliedToId) return false;

  const doc = await taskRepository.findByDeliveryMessageId(message.channel.id, repliedToId);
  if (!doc) return false;

  const task = await taskService.findById(doc.id);
  if (!task) return false;

  if (task.assignedUserId !== message.author.id) return true;
  if ((task.status !== TaskStatus.ACCEPTED && task.status !== TaskStatus.PENDING) || task.assignmentStatus !== 'SENT') {
    return true;
  }

  const urls = extractRedditUrls(message.content);
  if (urls.length !== 1) {
    await message.react('❌');
    await message.reply('⚠️ Reply with the Reddit link of the published post/comment so I can record it.');
    return true;
  }

  try {
    await goparttimeService.recordSubmission(task.id, urls[0], message.author.id);
    await message.react('✅');
    await message.reply('✅ Submission recorded. Waiting for manager review.');
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Submission could not be recorded.';
    await message.react('❌');
    await message.reply(`⚠️ ${messageText}`);
  }
  return true;
}

function extractRedditUrls(content: string): string[] {
  const urlPattern = /https?:\/\/[^\s<>]+/gi;
  const raw = content.match(urlPattern) || [];
  return [...new Set(raw.map(trimTrailingPunctuation).filter(isValidRedditUrl))];
}

function trimTrailingPunctuation(url: string): string {
  let clean = url;
  while (/[.,;!?]+$/.test(clean)) {
    clean = clean.slice(0, -1);
  }
  while (clean.endsWith(')') || clean.endsWith(']') || clean.endsWith('"') || clean.endsWith("'")) {
    const tail = clean.slice(-1);
    if (tail === ')') {
      const opens = (clean.match(/\(/g) || []).length;
      const closes = (clean.match(/\)/g) || []).length;
      if (closes <= opens) break;
    }
    clean = clean.slice(0, -1);
  }
  return clean;
}

/**
 * Existing insight flow: image reply to a reminder message.
 */
async function handleInsightUpload(message: Message): Promise<void> {
  if (message.attachments.size === 0) return;

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

  // Save the insight image to disk (non-fatal — insight already marked completed)
  try {
    const firstAttachment = imageAttachments.first();
    if (firstAttachment) {
      const imageUrl = await insightStorageService.save(task.id, reminder.id, firstAttachment.url, firstAttachment.name || 'image.png');
      await reminderService.updateInsightImage(reminder.id, imageUrl, firstAttachment.name || 'image.png');
    }
  } catch (saveError) {
    logger.warn('Failed to save insight image, insight already recorded', {
      taskId: task.id,
      reminderId: reminder.id,
      error: saveError instanceof Error ? saveError.message : String(saveError),
    });
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
}

/**
 * Ticket onboarding guide: sent once per new ticket channel.
 * Trigger: the first message from the ticket opener (single non-bot
 * non-admin member) after the welcome was sent. Only for new tickets
 * where welcomeSentAt exists and guide has not yet been sent.
 * Scope matches welcome: exactly one non-bot non-admin viewer = ticket,
 * so public/general channels (0 or >1 candidates) are ignored.
 */
async function handleTicketGuide(message: Message): Promise<void> {
  if (!message.guild) return;
  if (message.author.bot) return;
  if (getAllAdminIds().includes(message.author.id)) return;

  const channel = message.channel;
  if (!(channel instanceof TextChannel)) return;

  // Only for new tickets where welcome was delivered and guide not yet sent
  let onboarding;
  try {
    onboarding = await onboardingRepository.findByChannelId(channel.id);
  } catch {
    return;
  }
  if (!onboarding?.welcomeSentAt) return;
  if (onboarding.guideSentAt) return;

  // Verify ticket-like: exactly one non-bot non-admin viewer and author is that viewer
  try {
    await channel.guild.members.fetch().catch(() => undefined);
    const candidates = channel.members.filter((m) => !m.user.bot && !getAllAdminIds().includes(m.id));
    if (candidates.size !== 1) return;
    const soleId = candidates.first()!.id;
    if (soleId !== message.author.id) return;
  } catch {
    return;
  }

  try {
    await channel.send(TICKET_GUIDE_MESSAGE);
    await onboardingRepository.markGuideSent(channel.id);
    logger.info('Ticket guide sent', { channelId: channel.id, channelName: channel.name, userId: message.author.id });
  } catch (error) {
    logger.error('Ticket guide: failed to send', {
      channelId: channel.id,
      channelName: channel.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
