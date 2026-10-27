import { Message, TextChannel } from 'discord.js';
import { reminderService } from '../../services/reminder.service';
import { taskService } from '../../services/task.service';
import { goparttimeService } from '../../services/goparttime.service';
import { insightStorageService } from '../../services/insight-storage.service';
import { outreachService } from '../../services/outreach.service';
import { handleAutomationReply } from '../../services/automation/worker-manager.service';
import { isSupportedImage, isValidRedditUrl } from '../../utils/validators';
import { formatSubmissionReply, shortPostCounts } from '../../utils/submission-reply';
import { taskRepository, automationRepository } from '../../database/repositories';
import { buildBlocksReport, listScreenEvents } from '../../services/automation/screen-events';
import { CONTENT_SCREEN, OWNER_USER_ID } from '../../config/constants';
import { TaskStatus, AuditAction } from '../../types';
import { shouldComplete, canTransition } from '../../services/state-machine';
import { insightStepLabel, pickInsightReminder, statusForCompletedInsights } from '../../utils/insight-reply';
import { auditLogService } from '../../services/audit.service';
import { logger } from '../../utils/logger';
import { getAllAdminIds, isAdminOrManager } from '../../utils/permissions';
import { handleTicketProfileFlow } from '../../services/ticket-profile-check.service';
import { isScanRetry, requestScanCommand } from '../../services/automation/scan-request.service';

export async function handleMessageCreate(message: Message): Promise<void> {
  if (message.author.bot) return;
  // DM trigger: the manager types "scan" in the bot DM and the on-demand
  // round starts (same flow as the automatic one). Non-matching DMs stay
  // silent; non-managers stay silent too (no existence leak).
  if (!message.guild) {
    await handleDirectMessage(message).catch((err) =>
      logger.warn('DM handler failed', {
        userId: message.author.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return;
  }

  try {
    await outreachService.onWorkerMessage(message.channel.id, message.author.id, message.client);

    // Automation Stage-2: worker reply within the 5-min confirmation window.
    await handleAutomationReply(message.channel.id, message.author.id).catch(() => undefined);

    // Ticket Reddit profile check: the worker's first reply is interpreted
    // rather than blindly triggering the onboarding guide. Only tickets
    // enrolled by channelCreate are considered, so pre-existing tickets are
    // untouched. Consumes ONLY a profile link it checked - a re-ask returns
    // false so a screenshot or submission in the same message still reaches
    // the handlers below.
    const onboardingHandled = await handleTicketProfileCheck(message).catch((err) => {
      logger.warn('Ticket profile check handler failed', {
        channelId: message.channel.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    });
    if (onboardingHandled) return;

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
 * Bot-DM handler. Three commands, all exact-word (any case), managers only:
 * - `scan`: queues one on-demand watcher scan (same flow as automatic).
 * - `blocks`: replies with the auto-block report (actual auto-blocks from the
 *   DB + cleared subs + dry-run WOULD_BLOCK candidates from the event feed).
 * - `allow r/sub`: clears a quarantined subreddit name for future scans
 *   (content screening still applies; manual blocks always win).
 * Everything else — and everyone unauthorized — gets silence.
 */
async function handleDirectMessage(message: Message): Promise<void> {
  try {
    if (message.partial) await message.fetch();
  } catch {
    return;
  }
  const text = (message.content || '').trim().toLowerCase();
  if (text === 'blocks') {
    if (!isAdminOrManager(message.author.id)) return;
    try {
      const rows = await automationRepository.listAutoBlocked(20).catch(() => []);
      const allowedRows = await automationRepository.listAllowed().catch(() => []);
      const report = buildBlocksReport({
        autoBlocked: rows.map((r) => ({ subreddit: r.subreddit, reason: r.reason, createdAt: r.createdAt })),
        events: listScreenEvents(),
        dryRun: CONTENT_SCREEN.DRY_RUN,
        allowed: allowedRows.map((r: { subreddit: string }) => r.subreddit),
      });
      await message.reply(report);
      logger.info('Blocks report sent via DM', { userId: message.author.id });
    } catch {
      await message.reply('Could not build the blocks report — try again in a minute.').catch(() => undefined);
    }
    return;
  }
  const allowMatch = /^allow\s+(\S+)\s*$/.exec(message.content.trim());
  if (allowMatch) {
    if (!isAdminOrManager(message.author.id)) return;
    try {
      const { normalizeSubreddit } = await import('../../services/automation/subreddit');
      const normalized = normalizeSubreddit(allowMatch[1]);
      if (!normalized) {
        await message.reply('Usage: `allow r/subreddit` — that name was unreadable.');
        return;
      }
      if (await automationRepository.isBlocked(normalized).catch(() => false)) {
        await message.reply(
          `r/${normalized} is BLOCKED — blocks win over cleared names. Remove the block first if you meant to clear it.`,
        );
        return;
      }
      if (await automationRepository.isAllowed(normalized).catch(() => false)) {
        await message.reply(`r/${normalized} is already cleared.`);
        return;
      }
      await automationRepository.addAllowed(normalized, 'DM allow review', message.author.id);
      await auditLogService.log(
        AuditAction.AUTOMATION_ALLOWED,
        null,
        message.author.id,
        `r/${normalized} cleared for future scans (name review)`,
      );
      logger.info('Subreddit cleared via DM', { subreddit: normalized, userId: message.author.id });
      await message.reply(
        `r/${normalized} cleared — future scans treat its name as reviewed. Content screening still applies.`,
      );
    } catch {
      await message.reply('Could not clear that subreddit — try again in a minute.').catch(() => undefined);
    }
    return;
  }
  if (text !== 'scan') return;
  if (!isAdminOrManager(message.author.id)) return;
  const result = requestScanCommand(message.author.id);
  if (isScanRetry(result)) {
    await message.reply(`A scan was just requested — wait ${result.retryAfterSec}s before requesting another.`);
    return;
  }
  const queued = result.reused ? 'already queued' : 'requested';
  await message.reply(
    `Scan ${queued} (\`${result.request.requestId}\`). The watcher tabs pick it up on their next poll — digest DM lands in ~1–2 min. If nothing arrives in 3 min, the tabs may be closed: reopen /tasks and type \`scan\` again.`,
  );
  logger.info('On-demand scan requested via DM', {
    requestId: result.request.requestId,
    userId: message.author.id,
    reused: result.reused,
  });
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
    const updated = await goparttimeService.recordSubmission(task.id, urls[0], message.author.id);
    await message.react('✅');
    await message.reply(formatSubmissionReply(updated));
    // Short post (dropped paragraphs): the link is NOT queued, the worker is
    // told to repost correctly, and the owner is tagged for review.
    if (updated.formatCheckStatus === 'PARA_SHORT' && message.channel instanceof TextChannel) {
      const counts = shortPostCounts(updated.formatCheckDetail);
      const countStr = counts ? ` (${counts.actual}/${counts.expected} ¶)` : '';
      await message.channel
        .send(
          `<@${OWNER_USER_ID}> ⚠️ Short post${countStr} in this ticket — ` +
            `paragraphs are missing, so the link was not queued. The worker was asked to repost with all paragraphs.`,
        )
        .catch(() => undefined);
    }
    // Deleted post: link is NOT queued, feedback is scheduled, and owner is tagged.
    if (updated.formatCheckStatus === 'DELETED' && message.channel instanceof TextChannel) {
      await message.channel
        .send(
          `<@${OWNER_USER_ID}> ⚠️ The post was deleted so it was not submitted.`,
        )
        .catch(() => undefined);
    }
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
 * Insight flow: image reply to a reminder message.
 *
 * The reply may target ANY message that asked for that insight — the initial
 * send or any retry (all of them are stored in `Reminder.reminderMessageIds`).
 * If the target step is already completed, the image is attributed to the one
 * later step still waiting for a screenshot (e.g. replying to the old 20h
 * reminder with the 70h view data), which used to be dropped silently.
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
  const resolved = await reminderService.findByMessageId(repliedToId);
  if (!resolved) return;

  const task = await taskService.findById(resolved.taskId);
  if (!task) return;

  if (task.assignedUserId !== message.author.id) return;

  if (
    task.status === TaskStatus.CANCELLED ||
    task.status === TaskStatus.ARCHIVED ||
    task.cancelledReason !== null
  ) {
    await message.reply('⚠️ This task is no longer active — the insight was not recorded.');
    return;
  }

  const reminders = await reminderService.findByTaskId(task.id);
  const reminder = pickInsightReminder(resolved, reminders);

  if (!reminder) {
    await message.reply('⚠️ Insight already received.');
    return;
  }

  await reminderService.markCompleted(reminder.id, message.author.id);

  // Status is derived from what is actually completed, not from the step the
  // worker happened to reply to: a late 20h reply cannot drag a task back from
  // the 70h stage, and a 70h reply completes the task even if 20h was skipped.
  const afterCompletion = await reminderService.findByTaskId(task.id);
  const newStatus = statusForCompletedInsights(afterCompletion);
  if (newStatus && newStatus !== task.status && canTransition(task.status, newStatus)) {
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
  await message.reply(`✅ ${insightStepLabel(reminder.type)} insight received successfully.`);

  await auditLogService.log(
    AuditAction.INSIGHT_RECEIVED,
    task.id,
    message.author.id,
    `Insight uploaded for ${reminder.type}`,
  );

  logger.info('Insight received via reply', {
    taskId: task.id,
    reminderId: reminder.id,
    reminderType: reminder.type,
    repliedToReminderId: resolved.id,
    reassignedFromCompletedStep: resolved.id !== reminder.id,
    userId: message.author.id,
    channelId: message.channel.id,
  });
}

/**
 * Ticket Reddit profile check (formerly the unconditional onboarding guide).
 *
 * The guide used to fire on the opener's first message no matter what it
 * contained, which is exactly the gap this replaces: a worker who said "hi"
 * got the guide and the ask was never answered. Now the message is inspected
 * first, and the guide is the reward for passing the check rather than the
 * response to typing anything at all.
 *
 * All of the decisions live in `ticket-profile-check.service.ts`; this is the
 * Discord-shaped adapter that filters out everything that is not a plain
 * worker message in a ticket.
 */
async function handleTicketProfileCheck(message: Message): Promise<boolean> {
  if (!message.guild) return false;
  if (message.author.bot) return false;
  if (getAllAdminIds().includes(message.author.id)) return false;

  const channel = message.channel;
  if (!(channel instanceof TextChannel)) return false;

  return handleTicketProfileFlow({
    client: message.client,
    channel,
    authorId: message.author.id,
    content: message.content || '',
  });
}
