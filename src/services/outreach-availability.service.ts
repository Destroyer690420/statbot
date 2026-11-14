import { ButtonInteraction, Client, TextChannel } from 'discord.js';
import { getAllAdminIds } from '../utils/permissions';
import { parseAvailabilityCustomId, pickTicketWorkerId } from '../utils/outreach-availability';
import { logger } from '../utils/logger';
import { AvailabilityClaimResult, outreachService } from './outreach.service';

/**
 * In-ticket availability decision buttons (`outreach_avail:<blastId>:yes|no`).
 *
 * Only the ticket's worker may answer, and only their explicit Yes can win a
 * post. The message's buttons are removed as soon as the worker answers (or
 * when the round is already over), so the same message can never be answered
 * twice and a stale competition cannot leave tappable buttons behind.
 */

type Decision = 'yes' | 'no';

function reasonForOutcome(result: AvailabilityClaimResult): string {
  switch (result.outcome) {
    case 'claimed':
      return "You're in — your post is on its way to this ticket.";
    case 'claimed_no_post':
      return 'No post is left in this round, so nothing was assigned to you.';
    case 'daily_cap':
      return `You've reached today's post limit (${result.assignedToday ?? 0}/${result.dailyLimit ?? 0}), so no post was assigned.`;
    case 'ticket_busy':
      return 'You still have a post in progress in this ticket — finish that one first.';
    case 'already_claimed':
      return 'You already answered Yes for this round.';
    case 'admin':
      return 'Only the worker in this ticket can answer this.';
    case 'error':
      return 'Something went wrong — please tell the team.';
    default:
      return 'This availability request has already ended, so no post was assigned.';
  }
}

function messageSuffix(decision: Decision, userId: string, result?: AvailabilityClaimResult): string {
  if (decision === 'no') return `❌ <@${userId}> passed on this post.`;
  switch (result?.outcome) {
    case 'claimed':
      return `✅ <@${userId}> is taking this post.`;
    case 'claimed_no_post':
      return `⚠️ <@${userId}> said yes, but no post was left in this round.`;
    case 'daily_cap':
      return `⚠️ <@${userId}> has reached today's post limit.`;
    case 'ticket_busy':
      return `⚠️ <@${userId}> still has a post in progress.`;
    case 'already_claimed':
      return `✅ <@${userId}> already answered for this round.`;
    default:
      return '❌ This availability request is no longer active.';
  }
}

async function replyEphemeral(interaction: ButtonInteraction, content: string): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, ephemeral: interaction.guildId !== null });
    }
  } catch (error) {
    logger.warn('Availability button reply failed', { customId: interaction.customId, error });
  }
}

/** Removes the buttons and records the decision on the message itself. */
async function finalizeMessage(interaction: ButtonInteraction, suffix: string | null): Promise<void> {
  try {
    const current = interaction.message;
    if (!current) return;
    // Keep the edited content inside Discord's 2000-char limit even when the
    // configured outreach copy is at its own maximum.
    const base = (current.content ?? '').trimEnd().slice(0, 1900);
    await current.edit({
      content: suffix ? (base ? `${base}\n\n${suffix}` : suffix) : base || undefined,
      components: [],
      // The decision line tags the worker; don't fire a second notification.
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    // Already deleted by fill cleanup, or missing permissions: the click was
    // still handled; nothing else to do.
    logger.warn('Availability message could not be finalized', { customId: interaction.customId, error });
  }
}

/**
 * Resolves the ticket's worker with the same rule the blast send uses (first
 * non-bot, non-admin member). Returns null when nobody matches.
 */
async function resolveTicketWorkerId(interaction: ButtonInteraction): Promise<string | null> {
  try {
    const fetched = interaction.channel ?? (await interaction.client.channels.fetch(interaction.channelId));
    if (!fetched || !(fetched instanceof TextChannel)) return null;
    await fetched.guild.members.fetch().catch(() => undefined);
    return pickTicketWorkerId(
      [...fetched.members.values()].map((m) => ({ id: m.id, isBot: m.user.bot })),
      getAllAdminIds(),
    );
  } catch (error) {
    logger.warn('Availability button worker resolve failed', { channelId: interaction.channelId, error });
    return null;
  }
}

export async function handleAvailabilityButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseAvailabilityCustomId(interaction.customId);
  const channelId = interaction.channelId;
  if (!channelId) {
    await replyEphemeral(interaction, 'This availability request is no longer active.');
    return;
  }

  // Ack inside Discord's 3s window before any DB work.
  try {
    await interaction.deferReply({ ephemeral: interaction.guildId !== null });
  } catch (error) {
    logger.warn('Availability button defer failed', { customId: interaction.customId, error });
    return;
  }

  if (!parsed) {
    await replyEphemeral(interaction, 'This availability button is no longer valid.');
    await finalizeMessage(interaction, null);
    return;
  }

  const userId = interaction.user.id;
  if (getAllAdminIds().includes(userId)) {
    // Never touch the message: the worker still has to answer it.
    await replyEphemeral(interaction, 'Only the worker in this ticket can answer this.');
    return;
  }

  const workerId = await resolveTicketWorkerId(interaction);
  if (!workerId || workerId !== userId) {
    await replyEphemeral(interaction, 'Only the worker in this ticket can answer this.');
    return;
  }

  if (parsed.action === 'no') {
    const active = await outreachService.onAvailabilityDecline(
      channelId,
      userId,
      parsed.blastId,
      interaction.client as Client,
    );
    await finalizeMessage(
      interaction,
      active ? messageSuffix('no', userId) : '❌ This availability request is no longer active.',
    );
    await replyEphemeral(
      interaction,
      active
        ? 'Okay — you will not get this post. It stays open for other workers.'
        : 'This availability request is already over.',
    );
    return;
  }

  const result = await outreachService.onAvailabilityClaim(
    channelId,
    userId,
    interaction.client as Client,
    parsed.blastId,
  );
  await finalizeMessage(interaction, messageSuffix('yes', userId, result));
  await replyEphemeral(interaction, reasonForOutcome(result));

  logger.info('Availability button answered', {
    blastId: parsed.blastId,
    action: parsed.action,
    channelId,
    userId,
    outcome: result.outcome,
    assigned: result.assigned,
  });
}
