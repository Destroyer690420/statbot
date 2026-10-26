import { Client, EmbedBuilder } from 'discord.js';
import { paymentProofEmbed, payoutCreditedEmbed } from '../bot/embeds';
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

export interface PaymentProofInput {
  payeeId: string;
  amount: number;
}

export interface PayoutNotificationResult {
  sent: boolean;
  channelId: string;
  reason?: string;
}

export interface ProofBatchResult {
  sent: number;
  failed: number;
}

type LogContext = Record<string, unknown>;

/**
 * Single send path shared by the ticket notice and the payments-channel proof.
 * Never throws — failures are logged and reported via `{ sent: false }` so the
 * payment itself is never rolled back because of Discord.
 */
async function deliver(
  discordClient: Client,
  channelId: string,
  content: string,
  embed: EmbedBuilder,
  label: string,
  context: LogContext,
): Promise<PayoutNotificationResult> {
  try {
    const channel = await discordClient.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || typeof (channel as any).send !== 'function') {
      logger.warn(`${label} skipped: channel unavailable`, { channelId, ...context });
      return { sent: false, channelId, reason: 'channel-unavailable' };
    }

    await (channel as any).send({ content, embeds: [embed] });
    logger.info(`${label} sent`, { channelId, ...context });
    return { sent: true, channelId };
  } catch (error) {
    logger.warn(`${label} failed`, {
      channelId,
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      sent: false,
      channelId,
      reason: error instanceof Error ? error.message : 'send-failed',
    };
  }
}

/**
 * Best-effort ticket notification for a successful Pay Worker: the detailed
 * payment-credited embed (amount + breakdown, batch/week, screenshot pointer).
 */
export async function sendPayoutNotification(
  discordClient: Client,
  input: PayoutNotificationInput,
): Promise<PayoutNotificationResult> {
  return deliver(
    discordClient,
    input.channelId,
    `<@${input.workerId}>`,
    payoutCreditedEmbed({
      totalAmount: input.totalAmount,
      posts: input.posts,
      comments: input.comments,
      batchNumber: input.batchNumber,
      weekLabel: input.weekLabel,
      paidAt: input.paidAt,
      proofChannelId: PAYMENT_PROOF_CHANNEL_ID,
    }),
    'Payout notification',
    { workerId: input.workerId, batchNumber: input.batchNumber },
  );
}

/**
 * Payments-channel proof card: payee + amount only. Used for both worker
 * payouts and inviter commissions so the channel stays a clean payment log.
 */
export async function sendPaymentProof(
  discordClient: Client,
  input: PaymentProofInput,
): Promise<PayoutNotificationResult> {
  return deliver(
    discordClient,
    PAYMENT_PROOF_CHANNEL_ID,
    '',
    paymentProofEmbed({ payeeId: input.payeeId, amount: input.amount }),
    'Payment proof',
    { payeeId: input.payeeId },
  );
}

/**
 * One proof card per payee, sent sequentially so Discord's per-channel rate
 * limit is respected. Bulk payouts call this fire-and-forget.
 */
export async function sendPaymentProofs(
  discordClient: Client,
  inputs: PaymentProofInput[],
): Promise<ProofBatchResult> {
  let sent = 0;
  let failed = 0;
  for (const input of inputs) {
    const result = await sendPaymentProof(discordClient, input);
    if (result.sent) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}
