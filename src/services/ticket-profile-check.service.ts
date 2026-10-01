import { Client, TextChannel } from 'discord.js';
import { onboardingRepository } from '../database/repositories';
import {
  PROFILE_CHECK_BANNED,
  PROFILE_CHECK_LOW_KARMA,
  PROFILE_CHECK_PASSED,
  PROFILE_CHECK_UNVERIFIABLE,
  REDDIT_PROFILE_APPROVAL_ADMIN_ID,
  REDDIT_PROFILE_MAX_REASKS,
  TICKET_GUIDE_MESSAGE,
} from '../config/constants';
import { describeLookupFailure, lookupRedditProfile } from './reddit-profile-check.service';
import {
  asProfileCheckStatus,
  evaluateKarma,
  extractProfileUsername,
  formatBannedDmMessage,
  formatLowKarmaMessage,
  formatReaskMessage,
  formatTicketApprovalNotice,
  formatUnverifiableDm,
  formatUnverifiableMessage,
  formatVerifiedMessage,
  isTerminalProfileStatus,
  type ProfileCheckStatus,
} from '../utils/reddit-profile-link';
import { buildOutreachAddButton } from '../utils/outreach-add-button';
import { logger } from '../utils/logger';
import { getAllAdminIds } from '../utils/permissions';

/**
 * What the bot does in a ticket between "welcome sent" and "worker is cleared
 * to start", now that the worker's first reply is interpreted instead of
 * blindly triggering the guide.
 *
 *   ticket created  -> welcome (ask for the profile link) + enroll PENDING
 *   reply, no link  -> re-ask (capped, so small talk cannot loop forever)
 *   reply, a link   -> Reddit lookup
 *                        suspended          -> DM the worker, mark BANNED
 *                        karma >= 50        -> guide + verified line, DM admin, PASSED
 *                        karma <  50        -> "raise your karma" line, LOW_KARMA
 *                        could not check    -> retryable nudge, UNVERIFIABLE
 *
 * Non-PASSED states stay actionable on purpose: a worker who raises their
 * karma and re-sends the link gets re-checked instead of being stuck at
 * LOW_KARMA forever. Only PASSED and BANNED are terminal.
 */

/**
 * Tell the approver that a worker passed, IN the ticket, with the button that
 * selects it for the daily outreach. Best effort, never throws.
 *
 * This is deliberately not a DM. The approver's action is about this specific
 * ticket, so the request belongs in the ticket: a DM forces the reader to
 * match a channel id back to a channel by hand, and the add-to-outreach step
 * then has to happen in the dashboard anyway.
 *
 * Sent as its own message, after the worker-facing guide, so the button does
 * not sit inside a message addressed to the worker.
 *
 * The verdict is already persisted before this runs, so a failure here costs
 * only the notification — the ticket stays PASSED.
 */
async function notifyApproverInTicket(
  channel: TextChannel,
  channelId: string,
  workerId: string,
  username: string,
  karma: number,
): Promise<void> {
  try {
    await channel.send({
      content: formatTicketApprovalNotice({ workerId, username, karma }),
      components: buildOutreachAddButton(channelId),
    });
  } catch (error) {
    logger.warn('Reddit profile check: approver notice failed', {
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * DM the approver, best effort. Never throws: a closed DM inbox must not take
 * down the ticket flow, and the verdict is already persisted, so the worst case
 * is that the approver does not hear about this one ticket.
 *
 * Used only for failures that are OURS (no vaulted session / expired session).
 * A worker passing no longer DMs — that notice is in-ticket.
 */
async function notifyApprover(client: Client, content: string, context: Record<string, unknown>): Promise<void> {
  try {
    const admin = await client.users.fetch(REDDIT_PROFILE_APPROVAL_ADMIN_ID);
    await admin.send({ content });
    logger.info('Reddit profile check: approver notified', context);
  } catch (error) {
    logger.warn('Reddit profile check: could not DM approver', {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** DM the worker, best effort. Falls back to an in-ticket line if DMs are closed. */
async function dmWorker(
  client: Client,
  workerId: string,
  content: string,
  channel: TextChannel,
  fallback: string,
  context: Record<string, unknown>,
): Promise<void> {
  try {
    const user = await client.users.fetch(workerId);
    await user.send({ content });
    logger.info('Reddit profile check: worker DM sent', context);
  } catch (error) {
    logger.warn('Reddit profile check: worker DM failed, falling back to the ticket', {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
    // A worker with DMs closed must still be told, so the verdict is repeated
    // in the ticket rather than silently lost.
    await channel.send({ content: `<@${workerId}> ${fallback}` }).catch(() => undefined);
  }
}

async function persist(
  channelId: string,
  status: ProfileCheckStatus,
  username: string | null,
  linkKarma: number | null,
  commentKarma: number | null,
): Promise<void> {
  try {
    await onboardingRepository.markProfileChecked(channelId, { status, username, linkKarma, commentKarma });
  } catch (error) {
    logger.warn('Reddit profile check: could not persist verdict', {
      channelId,
      status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Nudge for a reply that contained no usable profile link. */
async function handleReask(
  channel: TextChannel,
  channelId: string,
  workerId: string,
  reaskCount: number,
): Promise<void> {
  if (reaskCount >= REDDIT_PROFILE_MAX_REASKS) {
    // Stays silent rather than nagging forever. A worker who is genuinely
    // interested just sends the link again, which is never capped.
    logger.info('Reddit profile check: re-ask cap reached, staying quiet', { channelId, reaskCount });
    return;
  }
  try {
    await channel.send(formatReaskMessage(workerId));
    await onboardingRepository.incrementProfileReask(channelId);
  } catch (error) {
    logger.warn('Reddit profile check: re-ask failed', {
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Runs the Reddit lookup and applies the matching branch. */
async function runCheck(
  client: Client,
  channel: TextChannel,
  channelId: string,
  channelName: string,
  workerId: string,
  username: string,
): Promise<void> {
  const result = await lookupRedditProfile(username);

  if (result.kind === 'suspended') {
    await persist(channelId, PROFILE_CHECK_BANNED, username, null, null);
    await dmWorker(
      client,
      workerId,
      formatBannedDmMessage(),
      channel,
      formatBannedDmMessage(),
      { channelId, username, verdict: 'BANNED' },
    );
    logger.info('Reddit profile check: worker is suspended', { channelId, username, workerId });
    return;
  }

  if (result.kind === 'ok') {
    const { status, karma } = evaluateKarma(result.profile);
    const linkKarma = result.profile.linkKarma;
    const commentKarma = result.profile.commentKarma;

    if (status === PROFILE_CHECK_PASSED) {
      // Guide first, stamp second: if the send fails the stamp is not written
      // and the guide is retried on the next message rather than lost.
      try {
        await channel.send(`${formatVerifiedMessage(karma)}\n\n${TICKET_GUIDE_MESSAGE}`);
        await onboardingRepository.markGuideSent(channelId);
      } catch (error) {
        logger.warn('Reddit profile check: guide send failed', {
          channelId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await persist(channelId, PROFILE_CHECK_PASSED, username, linkKarma, commentKarma);
      await notifyApproverInTicket(channel, channelId, workerId, username, karma);
      logger.info('Reddit profile check: worker passed', { channelId, username, workerId, karma });
      return;
    }

    // Live account, under the bar.
    await persist(channelId, PROFILE_CHECK_LOW_KARMA, username, linkKarma, commentKarma);
    const lowKarmaText = formatLowKarmaMessage(karma);
    await channel.send(lowKarmaText).catch((error) =>
      logger.warn('Reddit profile check: low-karma message failed', {
        channelId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    logger.info('Reddit profile check: worker under karma bar', { channelId, username, workerId, karma });
    return;
  }

  // Everything else is "no verdict". Kept non-terminal on purpose: the worker
  // can re-send the link and get checked again once Reddit (or the vault) is
  // healthy again.
  const reason = describeLookupFailure(result);
  await persist(channelId, PROFILE_CHECK_UNVERIFIABLE, username, null, null);
  await channel.send(formatUnverifiableMessage(reason)).catch(() => undefined);
  if (result.kind === 'no_session' || result.kind === 'session_expired') {
    // These two are our problem, not the worker's, so the approver is told.
    await notifyApprover(
      client,
      formatUnverifiableDm({ channelName, workerId, username, reason }),
      { channelId, username, verdict: result.kind },
    );
  }
  logger.info('Reddit profile check: no verdict', { channelId, username, kind: result.kind });
}

/**
 * Entry point for a worker message in an enrolled ticket.
 *
 * Returns true only when the message was a Reddit profile link this flow
 * actually processed. A re-ask returns false on purpose — see the note at the
 * return — so the caller's other handlers (submission reply, insight upload)
 * still run.
 */
export async function handleTicketProfileFlow(args: {
  client: Client;
  channel: TextChannel;
  authorId: string;
  content: string;
}): Promise<boolean> {
  const { client, channel, authorId, content } = args;
  const channelId = channel.id;

  let onboarding: Awaited<ReturnType<typeof onboardingRepository.findByChannelId>> | null = null;
  try {
    onboarding = await onboardingRepository.findByChannelId(channelId);
  } catch (error) {
    logger.warn('Reddit profile check: onboarding lookup failed', {
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  if (!onboarding) return false;

  // Not enrolled: a ticket created before this feature, or one whose welcome
  // never landed. Never touch it. An unrecognized status also lands here.
  const status = asProfileCheckStatus(onboarding.profileCheckStatus);
  if (!status) return false;
  // Already settled: nothing more to say in this ticket.
  if (isTerminalProfileStatus(status)) return false;
  // The guide is the pass reward; if it already went out there is nothing to do.
  if (onboarding.guideSentAt) return false;

  // Only the ticket's own worker drives the flow, resolved the same way the
  // welcome and the old guide handler resolved them: exactly one non-bot,
  // non-staff member in the channel.
  try {
    await channel.guild.members.fetch().catch(() => undefined);
    const candidates = channel.members.filter((m) => !m.user.bot && !getAllAdminIds().includes(m.id));
    if (candidates.size !== 1) return false;
    if (candidates.first()!.id !== authorId) return false;
  } catch (error) {
    logger.warn('Reddit profile check: member resolution failed', {
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  const username = extractProfileUsername(content);
  if (!username) {
    await handleReask(channel, channelId, authorId, onboarding.profileReaskCount ?? 0);
    // Deliberately NOT consumed. A message with no profile link is still very
    // possibly a reminder-reply screenshot or a submission to the task
    // instruction, and this ticket may already have a live task even though the
    // worker has not shared a profile yet. Swallowing it here would silently
    // drop a 20h insight upload. The re-ask is a side effect, not a claim on
    // the message, so the other handlers still get their turn.
    return false;
  }

  // A profile link IS consumed: the check is the whole point of the message,
  // and letting `handleInstructionReply` see it would let a profile URL be
  // recorded as the worker's submitted post.
  await runCheck(client, channel, channelId, channel.name, authorId, username);
  return true;
}
