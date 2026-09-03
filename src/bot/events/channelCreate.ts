import { AuditLogEvent, Channel, TextChannel } from 'discord.js';
import { getAllAdminIds } from '../../utils/permissions';
import { logger } from '../../utils/logger';
import { TICKET_WELCOME_MESSAGE } from '../../config/constants';
import { onboardingRepository } from '../../database/repositories';
import { inviteDetectionService } from '../../services/invite-detection.service';

const WELCOME_DELAY_MS = 2500;
const RETRY_DELAY_MS = 3000;

/**
 * Auto-welcome for new ticket channels.
 * Sends "Hey, @user Can you please share your reddit profile link?" tagging
 * the ticket opener when a new TextChannel is created.
 *
 * Creator resolution:
 * 1) Audit log (ChannelCreate) if executor is a non-bot non-admin human.
 * 2) Fallback: the single non-bot non-admin member who can view the channel
 *    (ticket channels have exactly one such member — the opener). Public
 *    channels with 0 or >1 candidates are ignored to avoid spam.
 */
export async function handleChannelCreate(channel: Channel): Promise<void> {
  if (!(channel instanceof TextChannel)) return;
  if (!channel.guild) return;

  try {
    await new Promise((r) => setTimeout(r, WELCOME_DELAY_MS));

    let creatorId: string | null = null;

    // 1) Try audit log — works for manually created channels; ticket-bot
    //    created channels will have the bot as executor and fall through.
    try {
      const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 5 });
      const entry = logs.entries.find((e) => e.target?.id === channel.id && Date.now() - e.createdTimestamp < 15_000);
      const executor = entry?.executor;
      if (executor && !executor.bot && !getAllAdminIds().includes(executor.id)) {
        creatorId = executor.id;
        logger.info('Ticket welcome: resolved creator via audit log', { channelId: channel.id, creatorId });
      } else if (executor?.bot) {
        logger.info('Ticket welcome: audit log executor is bot, falling back to member detection', {
          channelId: channel.id,
          botId: executor.id,
        });
      }
    } catch (auditError) {
      logger.warn('Ticket welcome: failed to fetch audit logs, falling back to member detection', {
        channelId: channel.id,
        error: auditError instanceof Error ? auditError.message : String(auditError),
      });
    }

    // 2) Fallback: detect the single non-bot non-admin member in the channel
    if (!creatorId) {
      creatorId = await resolveTicketCreatorViaMembers(channel);

      if (!creatorId) {
        logger.info('Ticket welcome: creator not found on first try, retrying after delay', { channelId: channel.id });
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        creatorId = await resolveTicketCreatorViaMembers(channel);
      }
    }

    if (!creatorId) {
      logger.warn('Ticket welcome: could not resolve ticket creator, skipping welcome', {
        channelId: channel.id,
        channelName: channel.name,
      });
      return;
    }

    if (getAllAdminIds().includes(creatorId)) {
      logger.info('Ticket welcome: creator is admin/manager, skipping', { channelId: channel.id, creatorId });
      return;
    }

    // Best-effort: link this first ticket to a pending invite detection.
    try {
      await inviteDetectionService.linkTicket(creatorId, channel.id, channel.name);
    } catch (linkErr) {
      logger.warn('Invite detection: linkTicket failed', {
        channelId: channel.id,
        creatorId,
        error: linkErr instanceof Error ? linkErr.message : String(linkErr),
      });
    }

    const content = TICKET_WELCOME_MESSAGE.replace('{user}', `<@${creatorId}>`);
    await channel.send(content);
    try {
      await onboardingRepository.markWelcomeSent(channel.id);
    } catch (dbErr) {
      logger.warn('Ticket welcome: sent but failed to mark onboarding', {
        channelId: channel.id,
        error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      });
    }
    logger.info('Ticket welcome sent', { channelId: channel.id, channelName: channel.name, creatorId });
  } catch (error) {
    logger.error('Ticket welcome: failed to send', {
      channelId: (channel as TextChannel).id,
      channelName: (channel as TextChannel).name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function resolveTicketCreatorViaMembers(channel: TextChannel): Promise<string | null> {
  try {
    await channel.guild.members.fetch().catch(() => undefined);

    const candidates = channel.members.filter((m) => !m.user.bot && !getAllAdminIds().includes(m.id));

    if (candidates.size === 1) {
      return candidates.first()!.id;
    }
    if (candidates.size === 0) {
      logger.info('Ticket welcome: no non-bot non-admin members in channel', {
        channelId: channel.id,
        channelName: channel.name,
      });
      return null;
    }
    logger.info('Ticket welcome: multiple workers found, skipping (not a ticket)', {
      channelId: channel.id,
      channelName: channel.name,
      count: candidates.size,
    });
    return null;
  } catch (err) {
    logger.warn('Ticket welcome: member detection failed', {
      channelId: channel.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
