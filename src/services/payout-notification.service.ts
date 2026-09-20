import { Client } from 'discord.js';
import { payoutCreditedEmbed } from '../bot/embeds';
import { PAYMENT_PROOF_CHANNEL_ID } from '../config/constants';
import { logger } from '../utils/logger';

export interface PayoutNotificationInput {
  channelId: string;
  workerId: string;
  totalAmount: number;
  posts: number;
  comments: number;
  batchNumber: number;
  weekLabel: string;
  paidAt: Date;
}

export interface PayoutNotificationResult {
  sent: boolean;
  channelId: string;
  reason?: string;
}

/**
 * Best-effort ticket notification for a successful Pay Worker.
 * Never throws — failures are logged and reported via `{ sent: false }`
 * so the payment itself is never rolled back because of Discord.
 */
export async function sendPayoutNotification(
  discordClient: Client,
  input: PayoutNotificationInput,
): Promise<PayoutNotificationResult> {
  try {
    const channel = await discordClient.channels.fetch(input.channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || typeof (channel as any).send !== 'function') {
      logger.warn('Payout notification skipped: ticket channel unavailable', {
        channelId: input.channelId,
        workerId: input.workerId,
      });
      return { sent: false, channelId: input.channelId, reason: 'channel-unavailable' };
    }

    const embed = payoutCreditedEmbed({
      totalAmount: input.totalAmount,
      posts: input.posts,
      comments: input.comments,
      batchNumber: input.batchNumber,
      weekLabel: input.weekLabel,
      paidAt: input.paidAt,
      proofChannelId: PAYMENT_PROOF_CHANNEL_ID,
    });

    await (channel as any).send({ content: `<@${input.workerId}>`, embeds: [embed] });
    logger.info('Payout notification sent', {
      channelId: input.channelId,
      workerId: input.workerId,
      batchNumber: input.batchNumber,
    });
    return { sent: true, channelId: input.channelId };
  } catch (error) {
    logger.warn('Payout notification failed', {
      channelId: input.channelId,
      workerId: input.workerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      sent: false,
      channelId: input.channelId,
      reason: error instanceof Error ? error.message : 'send-failed',
    };
  }
}
