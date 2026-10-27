jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../database/db', () => ({
  getDb: jest.fn(),
  initializeDatabase: jest.fn(),
}));

jest.mock('../services/worker-payment-qr.service', () => ({
  getWorkerQrInfo: jest.fn().mockResolvedValue({ qrCodeUrl: null, updatedAt: null, upiId: null, payeeName: null }),
}));

jest.mock('../database/repositories', () => ({
  taskRepository: {
    findByWorkerId: jest.fn().mockResolvedValue(null),
  },
  referralRepository: {
    findByInviterId: jest.fn().mockResolvedValue([]),
  },
}));

import { paymentProofEmbed, payoutCreditedEmbed, formatIST } from '../bot/embeds';
import {
  sendPaymentProof,
  sendPaymentProofs,
  sendPayoutNotification,
} from '../services/payout-notification.service';
import { PAYMENT_PROOF_CHANNEL_ID } from '../config/constants';

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

describe('paymentProofEmbed', () => {
  it('shows only the payee and the amount', () => {
    const json = paymentProofEmbed({ payeeId: '222', amount: 180 }).toJSON();

    expect(json.title).toBe('💸 Payment Sent');
    expect(json.description).toContain('<@222>');
    expect(json.description).toContain('₹180');
    // No breakdown, batch, week or screenshot pointer — this is the proof card
    // for the payments channel, not the detailed ticket notice.
    expect(json.fields ?? []).toHaveLength(0);
    expect(json.description).not.toMatch(/Batch|Screenshot|tasks|📝|💬/);
    expect(json.footer?.text).toBe('Reddit Task Manager');
  });

  it('formats non-integer amounts with two decimals', () => {
    const json = paymentProofEmbed({ payeeId: '222', amount: 180.5 }).toJSON();
    expect(json.description).toContain('₹180.50');
  });
});

describe('sendPaymentProof', () => {
  it('posts a generated receipt image attachment to the payments channel', async () => {
    const send = jest.fn().mockResolvedValue({ id: 'm1' });
    const fetch = jest.fn().mockResolvedValue({ isTextBased: () => true, send });
    const client: any = { channels: { fetch }, users: { fetch: jest.fn().mockResolvedValue(null) } };

    const result = await sendPaymentProof(client, { payeeId: '222', amount: 180 });

    expect(result).toEqual({ sent: true, channelId: PAYMENT_PROOF_CHANNEL_ID });
    expect(fetch).toHaveBeenCalledWith(PAYMENT_PROOF_CHANNEL_ID);
    const payload = send.mock.calls[0][0];
    expect(payload.content).toBe('<@222>');
    expect(payload.files).toBeDefined();
    expect(payload.files[0].name).toBe('payment-receipt-222.png');
    expect(Buffer.isBuffer(payload.files[0].attachment)).toBe(true);
  });

  it('never throws and reports the reason when the channel is unavailable', async () => {
    const client: any = { channels: { fetch: async () => null }, users: { fetch: jest.fn() } };

    const result = await sendPaymentProof(client, { payeeId: '222', amount: 180 });

    expect(result).toEqual({
      sent: false,
      channelId: PAYMENT_PROOF_CHANNEL_ID,
      reason: 'channel-unavailable',
    });
  });
});

describe('sendPaymentProofs', () => {
  it('counts sent and failed proofs without aborting the batch', async () => {
    const channel: any = {
      isTextBased: () => true,
      send: jest
        .fn()
        .mockResolvedValueOnce({ id: 'm1' })
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockResolvedValueOnce({ id: 'm3' }),
    };
    const client: any = { channels: { fetch: async () => channel } };

    const result = await sendPaymentProofs(client, [
      { payeeId: '1', amount: 60 },
      { payeeId: '2', amount: 30 },
      { payeeId: '3', amount: 90 },
    ]);

    expect(result).toEqual({ sent: 2, failed: 1 });
    expect(channel.send).toHaveBeenCalledTimes(3);
  });
});
