import { payoutCreditedEmbed, formatIST } from '../bot/embeds';
import { sendPayoutNotification } from '../services/payout-notification.service';
import { PAYMENT_PROOF_CHANNEL_ID } from '../config/constants';

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('payoutCreditedEmbed', () => {
  it('includes IST time, amount, breakdown, batch/week and proof-channel mention', () => {
    const paidAt = new Date('2026-09-20T10:00:00Z');
    const embed = payoutCreditedEmbed({
      totalAmount: 150,
      posts: 2,
      comments: 1,
      batchNumber: 7,
      weekLabel: '14 Sep 2026 — 20 Sep 2026',
      paidAt,
      proofChannelId: PAYMENT_PROOF_CHANNEL_ID,
    });
    const json = embed.toJSON();
    expect(json.title).toMatch(/Payment Credited/);
    const desc = json.description || '';
    expect(desc).toContain(formatIST(paidAt));
    expect(desc).toContain('IST');
    const fields = (json.fields || []).map((f: any) => `${f.name}:${f.value}`).join('\n');
    expect(fields).toContain('₹150');
    expect(fields).toContain('2');
    expect(fields).toContain('1');
    expect(fields).toContain('#7');
    expect(fields).toContain(`<#${PAYMENT_PROOF_CHANNEL_ID}>`);
  });

  it('formats IST with IST suffix', () => {
    expect(formatIST(new Date('2026-09-20T10:00:00Z'))).toMatch(/IST$/);
  });
});

describe('sendPayoutNotification', () => {
  const input = {
    channelId: '111',
    workerId: '222',
    totalAmount: 90,
    posts: 1,
    comments: 1,
    batchNumber: 3,
    weekLabel: 'week',
    paidAt: new Date(),
  };

  it('returns sent:false when channel is unavailable (never throws)', async () => {
    const client: any = { channels: { fetch: async () => null } };
    await expect(sendPayoutNotification(client, input)).resolves.toEqual({
      sent: false,
      channelId: '111',
      reason: 'channel-unavailable',
    });
  });

  it('tags the worker and returns sent:true on success', async () => {
    const send = jest.fn().mockResolvedValue({ id: 'msg1' });
    const channel: any = { isTextBased: () => true, send };
    const client: any = { channels: { fetch: async () => channel } };
    const result = await sendPayoutNotification(client, input);
    expect(result.sent).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].content).toBe('<@222>');
  });

  it('returns sent:false when send throws (payment must not fail)', async () => {
    const channel: any = {
      isTextBased: () => true,
      send: async () => {
        throw new Error('no perms');
      },
    };
    const client: any = { channels: { fetch: async () => channel } };
    const result = await sendPayoutNotification(client, input);
    expect(result.sent).toBe(false);
    expect(result.channelId).toBe('111');
  });
});
