/**
 * Member join welcome: the in-channel post (#invites → #verification mention)
 * and the DM that points a brand-new member at the ticket channel.
 *
 * The DM is the part worth locking down: Discord does not render `<#channelId>`
 * mentions in DMs, so the pointer has to be a `discord.com/channels` link
 * behind a label, and the greeting has to be a real mention. A blocked DM
 * (50007) must never stop the in-channel welcome or invite detection.
 */

const mockResolveUsedInvite = jest.fn();
const mockRecordJoin = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock('../utils/logger', () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../services/invite-tracker.service', () => ({
  resolveUsedInvite: (...args: unknown[]) => mockResolveUsedInvite(...args),
}));

jest.mock('../services/invite-detection.service', () => ({
  inviteDetectionService: {
    recordJoin: (...args: unknown[]) => mockRecordJoin(...args),
  },
}));

// The handler's only runtime import from discord.js is the `TextChannel`
// instanceof check, so the fake is enough to let a plain object pass it.
jest.mock('discord.js', () => ({
  TextChannel: class TextChannel {},
}));

import { TextChannel } from 'discord.js';
import { handleGuildMemberAdd } from '../bot/events/guildMemberAdd';
import { buildMemberWelcomeDm } from '../utils/member-welcome';
import { INVITES_CHANNEL_ID, VERIFICATION_CHANNEL_ID } from '../config/constants';

const GUILD_ID = '1518882545901502504';
const USER_ID = '111';

interface FakeGuild {
  id: string;
  name: string;
  channels: { fetch: jest.Mock };
}

function makeMember(bot = false): {
  member: Record<string, unknown>;
  channelSend: jest.Mock;
  memberSend: jest.Mock;
  guild: FakeGuild;
} {
  const channelSend = jest.fn().mockResolvedValue({ id: 'msg-1' });
  const memberSend = jest.fn().mockResolvedValue({ id: 'dm-1' });

  const channel = new (TextChannel as unknown as new () => { send: jest.Mock })();
  channel.send = channelSend;

  const guild: FakeGuild = {
    id: GUILD_ID,
    name: 'Reddit Tasks',
    channels: { fetch: jest.fn().mockResolvedValue(channel) },
  };

  const member = {
    id: USER_ID,
    user: { bot, username: 'newbie' },
    guild,
    send: memberSend,
  };

  return { member, channelSend, memberSend, guild };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveUsedInvite.mockResolvedValue(null);
});

describe('buildMemberWelcomeDm', () => {
  it('mentions the member and links the verification channel as a masked link', () => {
    const { content, link } = buildMemberWelcomeDm({
      userId: USER_ID,
      guildId: GUILD_ID,
      serverName: 'Reddit Tasks',
      channelId: VERIFICATION_CHANNEL_ID,
    });

    expect(link).toBe(`https://discord.com/channels/${GUILD_ID}/${VERIFICATION_CHANNEL_ID}`);
    expect(content).toContain(`Hey <@${USER_ID}>, welcome to Reddit Tasks!`);
    expect(content).toContain(`[**Create my ticket**](${link})`);
    expect(content).toContain('create your ticket here');
    // A raw channel mention would render as plain text in a DM.
    expect(content).not.toContain('<#');
  });
});

describe('handleGuildMemberAdd', () => {
  it('posts the #invites welcome and DMs the ticket link', async () => {
    const { member, channelSend, memberSend, guild } = makeMember();

    await handleGuildMemberAdd(member as never);

    expect(guild.channels.fetch).toHaveBeenCalledWith(INVITES_CHANNEL_ID);
    expect(channelSend).toHaveBeenCalledTimes(1);
    const channelMessage = channelSend.mock.calls[0][0] as string;
    expect(channelMessage).toContain(`<@${USER_ID}>`);
    expect(channelMessage).toContain(`<#${VERIFICATION_CHANNEL_ID}>`);

    expect(memberSend).toHaveBeenCalledTimes(1);
    const dm = memberSend.mock.calls[0][0] as string;
    expect(dm).toContain(`https://discord.com/channels/${GUILD_ID}/${VERIFICATION_CHANNEL_ID}`);
    expect(dm).toContain(`<@${USER_ID}>`);
  });

  it('keeps the channel welcome and invite detection when the DM is blocked (50007)', async () => {
    const { member, channelSend, memberSend } = makeMember();
    memberSend.mockRejectedValueOnce(
      Object.assign(new Error('Cannot send messages to this user'), { code: 50007 })
    );

    await expect(handleGuildMemberAdd(member as never)).resolves.toBeUndefined();

    expect(channelSend).toHaveBeenCalledTimes(1);
    expect(mockRecordJoin).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).not.toHaveBeenCalledWith(
      'Member welcome DM failed',
      expect.anything()
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'Member welcome DM skipped: DMs closed',
      expect.objectContaining({ userId: USER_ID })
    );
  });

  it('logs other DM failures without throwing', async () => {
    const { member, channelSend, memberSend } = makeMember();
    memberSend.mockRejectedValueOnce(
      Object.assign(new Error('Missing Access'), { code: 50001 })
    );

    await expect(handleGuildMemberAdd(member as never)).resolves.toBeUndefined();

    expect(channelSend).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Member welcome DM failed',
      expect.objectContaining({ userId: USER_ID, code: 50001 })
    );
  });

  it('does nothing for bots', async () => {
    const { member, channelSend, memberSend } = makeMember(true);

    await handleGuildMemberAdd(member as never);

    expect(channelSend).not.toHaveBeenCalled();
    expect(memberSend).not.toHaveBeenCalled();
    expect(mockRecordJoin).not.toHaveBeenCalled();
  });
});
