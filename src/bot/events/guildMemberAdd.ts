import { GuildMember, TextChannel } from 'discord.js';
import { INVITES_CHANNEL_ID, MEMBER_WELCOME_MESSAGE, VERIFICATION_CHANNEL_ID } from '../../config/constants';
import { logger } from '../../utils/logger';
import { resolveUsedInvite } from '../../services/invite-tracker.service';
import { inviteDetectionService } from '../../services/invite-detection.service';

/**
 * Guild member join welcome.
 * Sent immediately when a non-bot user joins the guild (every join, no dedup).
 * Posts in #invites (INVITES_CHANNEL_ID) tagging the new member and pointing
 * to #verification (VERIFICATION_CHANNEL_ID) as a clickable channel mention.
 */
export async function handleGuildMemberAdd(member: GuildMember): Promise<void> {
  if (member.user.bot) return;

  try {
    const channel = await member.guild.channels.fetch(INVITES_CHANNEL_ID);
    if (!(channel instanceof TextChannel)) {
      logger.warn('Member welcome: invites channel not found or not text', {
        invitesChannelId: INVITES_CHANNEL_ID,
        userId: member.id,
      });
      return;
    }

    const content = MEMBER_WELCOME_MESSAGE.replace('{user}', `<@${member.id}>`).replace(
      '{verification}',
      VERIFICATION_CHANNEL_ID,
    );

    await channel.send(content);
    logger.info('Member welcome sent', {
      userId: member.id,
      guildId: member.guild.id,
      invitesChannelId: INVITES_CHANNEL_ID,
    });
  } catch (error) {
    logger.error('Member welcome: failed to send', {
      userId: member.id,
      guildId: member.guild?.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Best-effort invite detection → auto-approved referral (never blocks/throws).
  try {
    const used = await resolveUsedInvite(member.guild);
    await inviteDetectionService.recordJoin({
      inviteeId: member.id,
      inviteeName: member.user.username,
      inviterId: used?.inviterId ?? null,
      inviterName: used?.inviterName ?? null,
      inviteCode: used?.code ?? null,
    });
  } catch (error) {
    logger.warn('Invite detection: recordJoin failed', {
      userId: member.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
