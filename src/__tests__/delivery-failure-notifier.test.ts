jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { OWNER_USER_ID } from '../config/constants';
import { notifyDeliveryFailure } from '../services/delivery-failure-notifier.service';
import { DeliveryFailureInfo, formatDeliveryFailureDm } from '../utils/delivery-failure';
import { logger } from '../utils/logger';

const info: DeliveryFailureInfo = {
  taskId: 'Post #1509513',
  externalTaskId: '1509513',
  channelId: '1562313184121987152',
  workerId: '1208650567002361876',
  stage: 'delivery',
  error: 'Image download failed (HTTP 400).',
};

function makeClient(send = jest.fn().mockResolvedValue({ id: 'dm-1' })) {
  const fetch = jest.fn().mockResolvedValue({ send });
  return { client: { users: { fetch } } as any, fetch, send };
}

describe('formatDeliveryFailureDm', () => {
  it('names the bot, the task, the ticket, the stage and the error', () => {
    const text = formatDeliveryFailureDm(info);
    expect(text).toContain('Reddit Task Manager');
    expect(text).toContain('Post #1509513 (GoPartTime #1509513)');
    expect(text).toContain('sending to ticket');
    expect(text).toContain('1562313184121987152');
    expect(text).toContain('1208650567002361876');
    expect(text).toContain('Image download failed (HTTP 400).');
    expect(text).toContain('Retry');
  });

  it('flattens multi-line errors and omits unknown optional fields', () => {
    const text = formatDeliveryFailureDm({
      taskId: 'Post #1',
      stage: 'reassign',
      error: 'first line\nsecond line   <@999>',
    });
    expect(text).not.toContain('\nsecond line');
    expect(text).toContain('first line second line <@999>');
    expect(text).not.toContain('GoPartTime #');
    expect(text).toContain('Ticket channel: unknown error');
  });
});

describe('notifyDeliveryFailure', () => {
  beforeEach(() => jest.clearAllMocks());

  it('DMs the configured admin with the formatted message', async () => {
    const { client, fetch, send } = makeClient();
    await expect(notifyDeliveryFailure(client, info)).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(OWNER_USER_ID);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].content).toBe(formatDeliveryFailureDm(info));
    expect(send.mock.calls[0][0].allowedMentions).toEqual({ parse: [] });
    expect(logger.info).toHaveBeenCalledWith('Delivery failure admin DM sent', expect.objectContaining({
      taskId: info.taskId,
      stage: 'delivery',
      adminId: OWNER_USER_ID,
    }));
  });

  it('does nothing when no Discord client is available', async () => {
    await expect(notifyDeliveryFailure(null, info)).resolves.toBe(false);
    await expect(notifyDeliveryFailure(undefined, info)).resolves.toBe(false);
  });

  it('never throws when the admin cannot be fetched or DM fails', async () => {
    const { client, send } = makeClient();
    (client.users.fetch as jest.Mock).mockRejectedValueOnce(new Error('Unknown User'));
    await expect(notifyDeliveryFailure(client, info)).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Delivery failure admin DM failed', expect.objectContaining({
      error: 'Unknown User',
    }));

    const second = makeClient();
    second.send.mockRejectedValueOnce(new Error('Cannot send messages to this user'));
    await expect(notifyDeliveryFailure(second.client, info)).resolves.toBe(false);
  });
});
