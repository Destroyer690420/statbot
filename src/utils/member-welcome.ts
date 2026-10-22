import { MEMBER_WELCOME_DM_MESSAGE } from '../config/constants';

export interface MemberWelcomeDmInput {
  /** Joining member's Discord id, rendered as a real mention. */
  userId: string;
  guildId: string;
  /** Guild name used in the greeting. */
  serverName: string;
  /** Channel the link opens (the verification/ticket channel). */
  channelId: string;
}

export interface MemberWelcomeDm {
  content: string;
  /** `https://discord.com/channels/<guild>/<channel>` — opens the app on that channel. */
  link: string;
}

export function buildMemberWelcomeDmLink(guildId: string, channelId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

/**
 * Builds the join DM. Kept pure (and unit-tested) because the two details that
 * are easy to get wrong — a real `<@id>` mention and a masked channel link —
 * are exactly what a DM needs: `<#channelId>` mentions render as raw text in
 * DMs, so the channel has to be a plain URL behind a label.
 */
export function buildMemberWelcomeDm(input: MemberWelcomeDmInput): MemberWelcomeDm {
  const link = buildMemberWelcomeDmLink(input.guildId, input.channelId);
  const content = MEMBER_WELCOME_DM_MESSAGE.replaceAll('{user}', `<@${input.userId}>`)
    .replaceAll('{server}', input.serverName)
    .replaceAll('{link}', link);

  return { content, link };
}
