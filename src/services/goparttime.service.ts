import { Client, TextChannel, GuildMember, AttachmentBuilder } from 'discord.js';
import { taskRepository } from '../database/repositories';
import { reminderService } from './reminder.service';
import { taskService } from './task.service';
import { auditLogService } from './audit.service';
import { scheduleAllReminders } from '../scheduler/jobs';
import { toTask } from '../database/converters';
import { getDb } from '../database/db';
import { isValidRedditUrl } from '../utils/validators';
import { htmlToDiscord } from '../utils/html-to-discord';
import { prepareImage } from '../utils/image-processor';
import { prepareVideo, formatBytes } from '../utils/video-processor';
import { goPartTimePayloadSchema, GoPartTimePayload } from '../utils/goparttime-payload';
import { buildTaskMessagePlan, InstructionMessage, TaskMessageFields } from '../utils/plain-task-message';
import { submissionInstructionEmbed } from '../bot/embeds';
import { GOPARTTIME_SOURCE } from '../config/constants';
import { buildGoPartTimeTaskId } from '../utils/task-display';
import { Task, TaskType, TaskStatus, DeliveryMessage, AuditAction } from '../types';
import { getAllAdminIds } from '../utils/permissions';
import { transition } from './state-machine';
import { logger } from '../utils/logger';

export interface AssignmentResult {
  task: Task;
  created: boolean;
  failed?: boolean;
  error?: string;
}

export interface TicketInfo {
  channelId: string;
  channelName: string | null;
  guildId: string;
  taskStatus: 'idle' | 'active' | 'awaiting-submission';
}

class GoPartTimeService {
  /**
   * Creates a task from a GoPartTime payload and delivers it to the ticket
   * channel (plain task message + paragraph-chunked content + ordered images).
   * Idempotent per external task ID. On any send failure the task is kept
   * with assignmentStatus=FAILED so it can be retried without re-assigning.
   */
  async assignFromGoPartTime(payload: GoPartTimePayload, discordClient: Client): Promise<AssignmentResult> {
    const parsed = goPartTimePayloadSchema.parse(payload);
    const externalTaskId = parsed.taskId;

    const existing = await taskRepository.findBySourceExternal(GOPARTTIME_SOURCE, externalTaskId);
    if (existing) {
      return { task: toTask(existing), created: false };
    }

    const channel = await this.resolveChannel(discordClient, parsed.ticket);
    if (!(channel instanceof TextChannel)) {
      throw new Error('Ticket channel not found. Make sure the ticket exists and the bot can see it.');
    }

    const awaiting = await taskRepository.findAwaitingSubmissionInChannel(channel.id);
    if (awaiting && awaiting.externalTaskId !== externalTaskId) {
      throw new Error('Another task is still awaiting submission in this ticket.');
    }

    const member = await this.detectWorker(channel);
    const now = new Date();
    const rawContentHtml = parsed.contentHtml || '';
    const formattedContent = rawContentHtml.trim() ? htmlToDiscord(rawContentHtml) : '';
    const taskType = parsed.type === 'post' ? TaskType.POST : TaskType.COMMENT;

    const taskRow = await taskRepository.create({
      id: buildGoPartTimeTaskId(taskType, externalTaskId),
      redditUrl: null,
      type: taskType,
      status: TaskStatus.ACCEPTED,
      guildId: channel.guildId,
      channelId: channel.id,
      channelName: channel.name,
      assignedUserId: member.id,
      assignedUserName: member.displayName || member.user.username,
      createdById: 'goparttime-api',
      notes: null,
      cancelledReason: null,
      source: GOPARTTIME_SOURCE,
      externalTaskId,
      sourceUrl: parsed.sourceUrl || null,
      subreddit: parsed.subreddit || null,
      subredditUrl: parsed.subredditUrl || null,
      flair: parsed.flair || null,
      title: parsed.title || null,
      postLink: parsed.postLink || null,
      commentLink: parsed.commentLink || null,
      contentHtml: parsed.contentHtml || null,
      formattedContent: formattedContent || null,
      payment: parsed.payment || null,
      deadline: parsed.deadline || null,
      taskImages: parsed.images.length > 0 ? parsed.images.map((i) => ({ order: i.order, url: i.url, kind: i.kind })) : null,
      deliveryMessages: null,
      assignmentStatus: 'PENDING',
      assignmentError: null,
      submittedRedditUrl: null,
      submittedAt: null,
      submittedBy: null,
      reviewedAt: null,
      reviewedBy: null,
      createdAt: now,
      updatedAt: now,
    });

    const task = toTask(taskRow);
    logger.info('GoPartTime task created', { taskId: task.id, externalTaskId });

    try {
      const delivery = await this.deliverToChannel(channel, parsed, formattedContent, member.id);
      await taskRepository.updateAssignment(task.id, { assignmentStatus: 'SENT' });
      await taskRepository.updateDeliveryMessages(task.id, delivery);

      await auditLogService.log(
        AuditAction.TASK_ASSIGNED,
        task.id,
        null,
        `Assigned from external source (task ${externalTaskId}) to <@${member.id}>`,
      );
      return { task: { ...task, assignmentStatus: 'SENT', deliveryMessages: delivery }, created: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await taskRepository.updateAssignment(task.id, { assignmentStatus: 'FAILED', assignmentError: message });
      await auditLogService.log(
        AuditAction.TASK_ASSIGNED,
        task.id,
        null,
        `Assignment failed (external task ${externalTaskId}): ${message}`,
      );
      logger.error('GoPartTime assignment failed', { taskId: task.id, externalTaskId, error: message });
      return {
        task: { ...task, assignmentStatus: 'FAILED', assignmentError: message },
        created: true,
        failed: true,
        error: message,
      };
    }
  }

  /**
   * Lists all text channels as tickets with their GoPartTime task state.
   *
   * Task state is resolved with 2 bulk queries rather than 2 probes per channel;
   * the derived `taskStatus` values are identical.
   */
  async listTickets(discordClient: Client): Promise<TicketInfo[]> {
    const tickets: TicketInfo[] = [];
    const { awaiting, active } = await taskRepository.findChannelTaskStatusSets();

    for (const guild of discordClient.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) {
        if (!(channel instanceof TextChannel)) continue;

        tickets.push({
          channelId: channel.id,
          channelName: channel.name,
          guildId: channel.guildId,
          taskStatus: awaiting.has(channel.id)
            ? 'awaiting-submission'
            : active.has(channel.id)
              ? 'active'
              : 'idle',
        });
      }
    }

    tickets.sort((a, b) => (a.channelName || '').localeCompare(b.channelName || ''));
    return tickets;
  }

  /**
   * Records the submitted Reddit URL for an assigned task. The latest
   * submission always wins: if the task already has a submitted URL, it is
   * replaced (exchanged) with the new one. Only allowed for tasks that were
   * successfully delivered.
   */
  async recordSubmission(taskId: string, submittedRedditUrl: string, submittedBy: string): Promise<Task> {
    const task = await this.requireGoPartTimeTask(taskId);

    if (task.assignmentStatus !== 'SENT') {
      throw new Error(
        task.assignmentStatus === 'FAILED'
          ? 'This task was not delivered successfully; use retry before submitting.'
          : 'This task is not assigned yet.',
      );
    }
    if (task.status !== TaskStatus.PENDING && task.status !== TaskStatus.ACCEPTED) {
      throw new Error(`Submission is only allowed while the task is ACCEPTED or PENDING (current: ${task.status}).`);
    }

    const url = submittedRedditUrl.trim();
    if (!isValidRedditUrl(url)) {
      throw new Error('Invalid Reddit URL.');
    }

    const duplicate = await taskRepository.findBySubmittedRedditUrl(url);
    if (duplicate && duplicate.id !== task.id) {
      throw new Error('This Reddit URL was already submitted for another task.');
    }

    const previousUrl = task.submittedRedditUrl;
    await taskRepository.markSubmitted(task.id, url, submittedBy);

    // Auto format-check: fetch the live Reddit post and compare its
    // title/paragraph structure against the delivered content (POST only).
    // Never fails the submission — failures persist as FETCH_ERROR.
    let checkSuffix = '';
    try {
      const { checkPostFormat } = await import('./reddit-check.service');
      const outcome = await checkPostFormat({
        taskType: task.type,
        expectedTitle: task.title,
        expectedContent: task.formattedContent,
        redditUrl: url,
      });
      const detail =
        outcome.status === 'SKIPPED'
          ? null
          : JSON.stringify({
              expectedParas: outcome.expectedParas,
              actualParas: outcome.actualParas,
              titleMatch: outcome.titleMatch,
              ...(outcome.error ? { error: outcome.error } : {}),
            });
      await taskRepository.saveFormatCheck(task.id, { status: outcome.status, detail });
      checkSuffix =
        outcome.status === 'SKIPPED'
          ? ''
          : outcome.status === 'MATCH'
            ? ` Format check: MATCH (${outcome.actualParas}/${outcome.expectedParas} paras).`
            : ` Format check: ${outcome.status} (${outcome.actualParas}/${outcome.expectedParas} paras${outcome.error ? ` — ${outcome.error}` : ''}).`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await taskRepository.saveFormatCheck(task.id, {
        status: 'FETCH_ERROR',
        detail: JSON.stringify({ expectedParas: 0, actualParas: 0, titleMatch: false, error: message }),
      });
      checkSuffix = ` Format check failed: ${message}`;
      logger.warn('Format auto-check failed (non-fatal)', { taskId: task.id, error: message });
    }

    await auditLogService.log(
      AuditAction.URL_SUBMITTED,
      task.id,
      submittedBy,
      (previousUrl && previousUrl !== url ? `URL replaced: ${previousUrl} -> ${url}` : `URL submitted: ${url}`) +
        checkSuffix,
    );

    const updated = await taskService.findById(task.id);
    if (!updated) throw new Error('Task not found.');
    return updated;
  }

  /**
   * Re-runs the format check for a task that already has a submitted URL
   * (dashboard Recheck button — fresh posts can 404 for ~30s after publish).
   */
  async recheckFormat(taskId: string): Promise<Task> {
    const task = await this.requireGoPartTimeTask(taskId);
    if (!task.submittedRedditUrl) throw new Error('No submitted URL to check yet.');
    const { checkPostFormat } = await import('./reddit-check.service');
    const outcome = await checkPostFormat({
      taskType: task.type,
      expectedTitle: task.title,
      expectedContent: task.formattedContent,
      redditUrl: task.submittedRedditUrl,
    });
    const detail =
      outcome.status === 'SKIPPED'
        ? null
        : JSON.stringify({
            expectedParas: outcome.expectedParas,
            actualParas: outcome.actualParas,
            titleMatch: outcome.titleMatch,
            ...(outcome.error ? { error: outcome.error } : {}),
          });
    await taskRepository.saveFormatCheck(task.id, { status: outcome.status, detail });
    const updated = await taskService.findById(task.id);
    if (!updated) throw new Error('Task not found.');
    return updated;
  }

  /**
   * Accepts a task into the normal workflow ("Done"). The task must currently
   * be ACCEPTED and successfully delivered. Accepting flips it to PENDING
   * (binding the worker's submitted Reddit URL if present) and schedules the
   * 20h/70h insight reminders, so the task shows up on the active tasks page.
   */
  async activateTask(taskId: string, activatedBy: string): Promise<Task> {
    const task = await this.requireGoPartTimeTask(taskId);

    if (task.assignmentStatus !== 'SENT') {
      throw new Error(
        task.assignmentStatus === 'FAILED'
          ? 'This task was not delivered successfully; use retry before accepting.'
          : 'This task is not assigned yet.',
      );
    }
    if (task.status !== TaskStatus.ACCEPTED) {
      throw new Error(`Only accepted tasks can be moved into the workflow (current: ${task.status}).`);
    }

    const nextStatus = transition(task.status, TaskStatus.PENDING);

    const db = getDb();
    await db.task.update({
      where: { id: task.id },
      data: {
        status: nextStatus as any,
        redditUrl: task.submittedRedditUrl || null,
        updatedAt: new Date(),
      },
    });

    const reminders = await reminderService.createForTask(task.id, task.type, task.createdAt);
    await scheduleAllReminders(reminders);

    await auditLogService.log(
      AuditAction.TASK_ACCEPTED,
      task.id,
      activatedBy,
      task.submittedRedditUrl
        ? `Task accepted into the workflow (submitted URL: ${task.submittedRedditUrl})`
        : 'Task accepted into the workflow (no URL submitted)',
    );

    const updated = await taskService.findById(task.id);
    if (!updated) throw new Error('Task not found.');
    return updated;
  }

  /**
   * Reassigns an ACCEPTED task to a different ticket. The old delivered
   * messages are deleted (best-effort), the task is moved to the new channel
   * and worker, and the task content is re-delivered to the new ticket.
   */
  async reassignTask(taskId: string, ticket: string, discordClient: Client): Promise<Task> {
    const task = await this.requireGoPartTimeTask(taskId);

    if (task.status !== TaskStatus.ACCEPTED) {
      throw new Error(`Only accepted tasks can be reassigned (current: ${task.status}).`);
    }

    const channel = await this.resolveChannel(discordClient, ticket);
    if (!(channel instanceof TextChannel)) {
      throw new Error('Ticket channel not found. Make sure the ticket exists and the bot can see it.');
    }
    if (channel.id === task.channelId) {
      throw new Error('Task is already assigned to this ticket.');
    }

    const member = await this.detectWorker(channel);

    await this.deleteDeliveredMessages(task, discordClient);

    const now = new Date();
    await getDb().task.update({
      where: { id: task.id },
      data: {
        channelId: channel.id,
        channelName: channel.name,
        assignedUserId: member.id,
        assignedUserName: member.displayName || member.user.username,
deliveryMessages: null as any,
        assignmentStatus: 'PENDING',
        assignmentError: null,
        updatedAt: now,
      },
    });

    try {
      const updated = await taskService.findById(task.id);
      if (!updated) throw new Error('Task not found.');

      const delivery = await this.deliverTaskToChannel(channel, updated);
      await taskRepository.updateAssignment(task.id, { assignmentStatus: 'SENT' });
      await taskRepository.updateDeliveryMessages(task.id, delivery);

      await auditLogService.log(
        AuditAction.TASK_ASSIGNED,
        task.id,
        null,
        `Reassigned (task ${task.externalTaskId || task.id}) to <@${member.id}> in <#${channel.id}>`,
      );

      const fresh = await taskService.findById(task.id);
      if (!fresh) throw new Error('Task not found.');
      return fresh;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await taskRepository.updateAssignment(task.id, { assignmentStatus: 'FAILED', assignmentError: message });
      await auditLogService.log(
        AuditAction.TASK_ASSIGNED,
        task.id,
        null,
        `Reassignment failed (task ${task.externalTaskId || task.id}): ${message}`,
      );
      throw new Error(`Reassign failed: ${message}`);
    }
  }

  /**
   * Re-attempts delivery of a FAILED assignment. Resends the missing steps
   * (label/value messages, content chunks, images) based on what was
   * recorded, then flips the assignment to SENT.
   */
  async retryAssignment(taskId: string, discordClient: Client): Promise<Task> {
    const task = await this.requireGoPartTimeTask(taskId);

    if (task.assignmentStatus !== 'FAILED') {
      throw new Error('Only failed assignments can be retried.');
    }
    if (task.submittedRedditUrl) {
      throw new Error('This task already has a submitted URL; retry is not needed.');
    }

    const channel = await this.resolveChannel(discordClient, task.channelId);
    if (!(channel instanceof TextChannel)) {
      throw new Error('Ticket channel not found. Make sure the bot can see it.');
    }

    const plan = buildTaskMessagePlan(this.messageFields(task), task.formattedContent || '');
    const existing = task.deliveryMessages || [];
    const images = (task.taskImages || [])
      .slice()
      .sort((a, b) => a.order - b.order);

    try {
      const metadataSent = existing.filter((m) => m.kind === 'metadata').length;
      const contentSent = existing.filter((m) => m.kind === 'content').length;
      const imagesSent = existing.filter((m) => m.kind === 'images').length;

      const delivery: DeliveryMessage[] = [...existing];
      let nextOrder = delivery.length + 1;
      const createdAt = new Date().toISOString();

      for (let i = metadataSent; i < plan.metadata.length; i++) {
        const message = await channel.send(plan.metadata[i]);
        delivery.push({ kind: 'metadata', order: nextOrder++, messageId: message.id, createdAt });
      }
      for (let i = contentSent; i < plan.content.length; i++) {
        const message = await channel.send(plan.content[i]);
        delivery.push({ kind: 'content', order: nextOrder++, messageId: message.id, createdAt });
      }
      for (let i = imagesSent; i < images.length; i++) {
        const message = await this.sendMedia(channel, images[i]);
        delivery.push({ kind: 'images', order: nextOrder++, messageId: message.id, createdAt });
      }
      const instructionSent = existing.filter((m) => m.kind === 'instruction').length;
      if (instructionSent === 0 && plan.instruction) {
        const message = await channel.send(this.buildInstructionPayload(plan.instruction, task.assignedUserId));
        delivery.push({ kind: 'instruction', order: nextOrder++, messageId: message.id, createdAt });
      }

      await taskRepository.updateAssignment(task.id, { assignmentStatus: 'SENT', assignmentError: null });
      await taskRepository.updateDeliveryMessages(task.id, delivery);
      await auditLogService.log(
        AuditAction.ASSIGNMENT_RETRIED,
        task.id,
        null,
        `Assignment retried for external task ${task.externalTaskId || task.id}`,
      );

      const updated = await taskService.findById(task.id);
      if (!updated) throw new Error('Task not found.');
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await taskRepository.updateAssignment(task.id, { assignmentStatus: 'FAILED', assignmentError: message });
      throw new Error(`Retry failed: ${message}`);
    }
  }

  // ─── Internals ─────────────────────────────────────────────

  private async requireGoPartTimeTask(taskId: string): Promise<Task> {
    const task = await taskService.findById(taskId);
    if (!task) throw new Error('Task not found.');
    if (task.source !== GOPARTTIME_SOURCE) {
      throw new Error('This endpoint only applies to external tasks.');
    }
    return task;
  }

  private async resolveChannel(discordClient: Client, ticket: string): Promise<TextChannel | null> {
    const byId = discordClient.channels.cache.get(ticket) || (await discordClient.channels.fetch(ticket).catch(() => null));
    if (byId instanceof TextChannel) return byId;

    const guild = discordClient.guilds.cache.first();
    if (!guild) return null;
    const byName = guild.channels.cache.find((c) => c instanceof TextChannel && c.name === ticket);
    if (byName instanceof TextChannel) return byName;
    return null;
  }

  private async detectWorker(channel: TextChannel): Promise<GuildMember> {
    await channel.guild.members.fetch().catch(() => undefined);
    const candidates = channel.members.filter(
      (m) => !m.user.bot && !getAllAdminIds().includes(m.id),
    );

    if (candidates.size === 0) {
      throw new Error('No worker found in this ticket. Add a non-admin user to the ticket channel.');
    }
    if (candidates.size > 1) {
      const names = candidates.map((m) => m.displayName || m.user.username).join(', ');
      throw new Error(`Multiple workers found in this ticket: ${names}`);
    }
    return candidates.first()!;
  }

  /**
   * Sends the plain task messages (label/value messages, content chunks) and
   * images; returns the delivery records with real message IDs, in order.
   */
  private async deliverToChannel(
    channel: TextChannel,
    payload: GoPartTimePayload,
    formattedContent: string,
    workerId: string,
  ): Promise<DeliveryMessage[]> {
    const delivery: DeliveryMessage[] = [];
    const createdAt = new Date().toISOString();
    let order = 1;

    const plan = buildTaskMessagePlan(this.messageFields(payload), formattedContent);
    for (const item of plan.metadata) {
      const message = await channel.send(item);
      delivery.push({ kind: 'metadata', order: order++, messageId: message.id, createdAt });
    }

    for (const chunk of plan.content) {
      const message = await channel.send(chunk);
      delivery.push({ kind: 'content', order: order++, messageId: message.id, createdAt });
    }

    for (const image of payload.images) {
      const message = await this.sendMedia(channel, image);
      delivery.push({ kind: 'images', order: order++, messageId: message.id, createdAt });
    }

    if (plan.instruction) {
      const message = await channel.send(this.buildInstructionPayload(plan.instruction, workerId));
      delivery.push({ kind: 'instruction', order: order++, messageId: message.id, createdAt });
    }

    return delivery;
  }

  /**
   * Full re-delivery of the task content to a channel from stored task data
   * (used by reassignment). Always sends labels, values, content, images in
   * order.
   */
  private async deliverTaskToChannel(channel: TextChannel, task: Task): Promise<DeliveryMessage[]> {
    const delivery: DeliveryMessage[] = [];
    const createdAt = new Date().toISOString();
    let order = 1;

    const plan = buildTaskMessagePlan(this.messageFields(task), task.formattedContent || '');
    for (const item of plan.metadata) {
      const message = await channel.send(item);
      delivery.push({ kind: 'metadata', order: order++, messageId: message.id, createdAt });
    }

    for (const chunk of plan.content) {
      const message = await channel.send(chunk);
      delivery.push({ kind: 'content', order: order++, messageId: message.id, createdAt });
    }

    const images = (task.taskImages || []).slice().sort((a, b) => a.order - b.order);
    for (const image of images) {
      const message = await this.sendMedia(channel, image);
      delivery.push({ kind: 'images', order: order++, messageId: message.id, createdAt });
    }

    if (plan.instruction) {
      const message = await channel.send(this.buildInstructionPayload(plan.instruction, task.assignedUserId));
      delivery.push({ kind: 'instruction', order: order++, messageId: message.id, createdAt });
    }

    return delivery;
  }

  /**
   * Builds the send payload for the submission instruction: a Discord embed
   * (so it stands out from the plain-text content) with an optional worker
   * mention so the assigned worker gets a notification.
   */
  private buildInstructionPayload(instruction: InstructionMessage, workerId?: string | null) {
    return {
      content: workerId ? `<@${workerId}>` : undefined,
      embeds: [submissionInstructionEmbed(instruction)],
    };
  }

  /**
   * Downloads a task image or video and sends it as a Discord attachment.
   *
   * Images go through sharp (images > 10 MB become WebP). Videos go through
   * ffmpeg when they exceed Discord's 25 MB upload limit — and when that
   * happens the worker is told the quality was reduced, because "the video
   * looks worse than the original" is otherwise unexplainable to them.
   */
  private async sendMedia(channel: TextChannel, media: { order: number; url: string; kind?: string }): Promise<{ id: string }> {
    if (media.kind === 'video') {
      const prepared = await prepareVideo(media.url);
      if (prepared.compressed) {
        logger.info('Compressed an oversized task video for Discord', {
          order: media.order,
          originalBytes: prepared.originalBytes,
          compressedBytes: prepared.buffer.length,
        });
      }
      const attachment = new AttachmentBuilder(prepared.buffer, {
        name: `task-video-${media.order}.${prepared.extension}`,
      });
      const content = prepared.compressed
        ? `Video compressed from ${formatBytes(prepared.originalBytes)} to ${formatBytes(prepared.buffer.length)} to fit Discord's upload limit, so it looks lower quality than the original.`
        : undefined;
      return channel.send({ files: [attachment], content });
    }

    const prepared = await prepareImage(media.url);
    const attachment = new AttachmentBuilder(prepared.buffer, {
      name: `task-image-${media.order}.${prepared.extension}`,
    });
    return channel.send({ files: [attachment] });
  }

  /**
   * Best-effort deletion of the previously delivered Discord messages.
   */
  private async deleteDeliveredMessages(task: Task, discordClient: Client): Promise<void> {
    const items = task.deliveryMessages || [];
    if (items.length === 0) return;

    const channel = await this.resolveChannel(discordClient, task.channelId);
    if (!(channel instanceof TextChannel)) return;

    for (const item of items) {
      try {
        const message = await channel.messages.fetch(item.messageId).catch(() => null);
        if (message) {
          await message.delete();
        }
      } catch {
        // Best-effort cleanup; ignoring delete failures keeps reassign robust.
      }
    }
  }

  private messageFields(data: GoPartTimePayload | Task): TaskMessageFields {
    if ('assignmentStatus' in data) {
      const task = data;
      return {
        subreddit: task.subreddit,
        subredditUrl: task.subredditUrl,
        flair: task.flair,
        title: task.title,
        postLink: task.postLink,
        commentLink: (task as any).commentLink || null,
      };
    }
    const payload = data;
    return {
      subreddit: payload.subreddit || null,
      subredditUrl: payload.subredditUrl || null,
      flair: payload.flair || null,
      title: payload.title || null,
      postLink: payload.postLink || null,
      commentLink: (payload as any).commentLink || null,
    };
  }
}

export const goparttimeService = new GoPartTimeService();
