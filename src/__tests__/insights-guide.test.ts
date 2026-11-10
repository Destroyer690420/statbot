import fs from 'fs';
import { AttachmentBuilder } from 'discord.js';
import {
  INSIGHTS_SCREENSHOT_GUIDE_MESSAGE,
  INSIGHTS_SCREENSHOT_EXAMPLE_PATH,
  execute,
} from '../bot/commands/insights-guide';
import { isAdminOrManager } from '../utils/permissions';

jest.mock('../utils/permissions', () => ({
  isAdminOrManager: jest.fn(),
  getPermissionDeniedMessage: () => 'You do not have permission to use this command.',
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockIsAdminOrManager = isAdminOrManager as jest.MockedFunction<typeof isAdminOrManager>;

function makeInteraction(overrides: { textBased?: boolean } = {}) {
  const send = jest.fn().mockResolvedValue({ id: 'message-1' });
  const channel = {
    id: 'channel-1',
    isTextBased: () => overrides.textBased ?? true,
    send,
  };
  const interaction = {
    user: { id: 'admin-1' },
    channel,
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
  return { interaction, channel, send };
}

describe('/insights-guide message', () => {
  it('is exactly the requested wording', () => {
    expect(INSIGHTS_SCREENSHOT_GUIDE_MESSAGE).toBe(
      'when submitting insights please remember that in the insights screenshot the subreddit, title and view count of the post must be visible.\n\n' +
        'and if you have an Iphone and the post is too long then the last few paragraphs of the post and the view count must be visible.',
    );
  });

  it('ships a real PNG example at the resolved path', () => {
    expect(fs.existsSync(INSIGHTS_SCREENSHOT_EXAMPLE_PATH)).toBe(true);
    const header = fs.readFileSync(INSIGHTS_SCREENSHOT_EXAMPLE_PATH).subarray(0, 8);
    expect(header).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
});

describe('/insights-guide execute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('posts the message and example image in the current ticket', async () => {
    mockIsAdminOrManager.mockReturnValue(true);
    const { interaction, send } = makeInteraction();

    await execute(interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(send).toHaveBeenCalledTimes(1);

    const payload = send.mock.calls[0][0];
    expect(payload.content).toBe(INSIGHTS_SCREENSHOT_GUIDE_MESSAGE);
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0]).toBeInstanceOf(AttachmentBuilder);
    expect(payload.files[0].name).toBe('insights-example.png');

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
  });

  it('denies non-admin/non-manager users without posting anything', async () => {
    mockIsAdminOrManager.mockReturnValue(false);
    const { interaction, send } = makeInteraction();

    await execute(interaction as never);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.reply.mock.calls[0][0].ephemeral).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses to run outside a text channel', async () => {
    mockIsAdminOrManager.mockReturnValue(true);
    const { interaction, send } = makeInteraction({ textBased: false });

    await execute(interaction as never);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('reports a send failure back to the admin', async () => {
    mockIsAdminOrManager.mockReturnValue(true);
    const { interaction, send } = makeInteraction();
    send.mockRejectedValueOnce(new Error('Missing Permissions'));

    await execute(interaction as never);

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
  });
});
