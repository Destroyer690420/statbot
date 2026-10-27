import { Client, EmbedBuilder } from 'discord.js';
import { payoutCreditedEmbed } from '../bot/embeds';
import { PAYMENT_PROOF_CHANNEL_ID } from '../config/constants';
import { logger } from '../utils/logger';
import { getWorkerQrInfo } from './worker-payment-qr.service';
import { generatePayoutReceipt } from './payout-receipt.service';
import { taskRepository, referralRepository } from '../database/repositories';

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
  payeeLabel?: string | null;
  upiId?: string | null;
  paidAt?: Date;
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
 * Single send path for ticket notice embeds.
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
 * Resolve payee label and optional UPI ID.
 * Priority order:
 * 1. Explicitly provided input.payeeLabel
 * 2. Decoded QR payeeName (pn)
 * 3. Assigned task channelName (e.g. ticket-0595) or assignedUserName
 * 4. Inviter name from referrals
 * 5. Discord user display name or username
 * 6. Fallback to payeeId slice
 */
async function resolvePayeeLabelAndUpi(
  discordClient: Client,
  input: PaymentProofInput,
): Promise<{ payeeLabel: string; upiId: string | null }> {
  let upiId = input.upiId ?? null;
  const payeeLabel = input.payeeLabel?.trim() || null;

  let qrInfo = null;
  try {
    qrInfo = await getWorkerQrInfo(input.payeeId);
  } catch {
    // best-effort
  }

  if (upiId === null && qrInfo?.upiId) {
    upiId = qrInfo.upiId;
  }

  if (payeeLabel) {
    return { payeeLabel, upiId };
  }

  if (qrInfo?.payeeName) {
    return { payeeLabel: qrInfo.payeeName, upiId };
  }

  try {
    const task = await taskRepository.findByWorkerId(input.payeeId);
    if (task?.channelName) {
      return { payeeLabel: task.channelName, upiId };
    }
    if (task?.assignedUserName) {
      return { payeeLabel: task.assignedUserName, upiId };
    }
  } catch {
    // best-effort
  }

  try {
    const refs = await referralRepository.findByInviterId(input.payeeId);
    if (refs.length > 0 && refs[0].inviterName) {
      return { payeeLabel: refs[0].inviterName, upiId };
    }
  } catch {
    // best-effort
  }

  try {
    const user = await discordClient.users.fetch(input.payeeId).catch(() => null);
    if (user?.displayName || user?.username) {
      return { payeeLabel: user.displayName || user.username, upiId };
    }
  } catch {
    // best-effort
  }

  return { payeeLabel: input.payeeId.slice(0, 8), upiId };
}

/**
 * Payments-channel receipt proof: generates a UPI/Google Pay mobile payment
 * confirmation image and posts it as a file attachment to the payments channel.
 * Never throws — failures are logged and reported via `{ sent: false }` so the
 * payment itself is never rolled back because of Discord.
 */
export async function sendPaymentProof(
  discordClient: Client,
  input: PaymentProofInput,
): Promise<PayoutNotificationResult> {
  const channelId = PAYMENT_PROOF_CHANNEL_ID;
  try {
    const channel = await discordClient.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || typeof (channel as any).send !== 'function') {
      logger.warn('Payment proof skipped: channel unavailable', { channelId, payeeId: input.payeeId });
      return { sent: false, channelId, reason: 'channel-unavailable' };
    }

    const { payeeLabel, upiId } = await resolvePayeeLabelAndUpi(discordClient, input);
    const receiptBuffer = await generatePayoutReceipt({
      amount: input.amount,
      payeeLabel,
      upiId,
      paidAt: input.paidAt,
    });

    await (channel as any).send({
      files: [{ attachment: receiptBuffer, name: `payment-receipt-${input.payeeId}.png` }],
    });
    logger.info('Payment proof sent', { channelId, payeeId: input.payeeId, amount: input.amount });
    return { sent: true, channelId };
  } catch (error) {
    logger.warn('Payment proof failed', {
      channelId,
      payeeId: input.payeeId,
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
