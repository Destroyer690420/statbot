import { Client, TextChannel } from 'discord.js';
import { onboardingRepository } from '../database/repositories';
import {
  PROFILE_CHECK_BANNED,
  PROFILE_CHECK_LOW_KARMA,
  PROFILE_CHECK_PASSED,
  PROFILE_CHECK_UNVERIFIABLE,
  REDDIT_PROFILE_APPROVAL_ADMIN_ID,
  REDDIT_PROFILE_MAX_REASKS,
} from '../config/constants';
import { describeLookupFailure, lookupRedditProfile } from './reddit-profile-check.service';
import {
  asProfileCheckStatus,
  evaluateProfileEligibility,
  extractProfileUsername,
  formatBannedDmMessage,
  formatLowKarmaMessage,
  formatReaskMessage,
  formatTicketApprovalNotice,
  formatTooYoungMessage,
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
 *                        karma >= 50 + age >= 14d -> short verified+guide line in the ticket, DM admin, PASSED
 *                        karma <  50        -> "raise your karma" line, LOW_KARMA
 *                        age < 14d          -> "account too new" line, LOW_KARMA
 *                        could not check    -> retryable nudge, UNVERIFIABLE
 *
 * Only PASSED is terminal. BANNED stays actionable on purpose: a banned
 * worker who shares a NEW link is re-checked (the daily 7am outreach scan
 * relies on this — it removes the ticket from outreach and the re-shared
 * link must run the lookup again instead of hitting a quiet terminal state).
 * LOW_KARMA covers both bars (karma and age); the message names which one
 * missed so the worker fixes the right thing.
 */

/**
 * DM the approver that a worker passed, with the button that selects the
 * ticket for the daily outreach. Best effort, never throws.
 *
 * This is deliberately a DM, not a ticket message: the worker must never see
 * the outreach discussion — neither the "passed / add this ticket" notice nor
 * the button's "added to the daily outreach list" confirmation edit, which
 * edits this DM's own message and therefore can never touch the ticket.
 * The notice names the ticket with a `<#channelId>` jump link (see
 * `formatTicketApprovalNotice`) so the approver reaches the right ticket in
 * one click with no manual matching.
 *
 * Delivery mirrors `deliverDigest` in `blast-approval.service.ts`: an admin
 * user fetched by id, then `user.send({ content, components })`. A button
 * works identically in a DM, and the click handler edits the interaction's
 * own message — the approver's DM — never the ticket.
 *
 * A closed DM inbox is logged exactly like the `notifyApprover` path below
 * and never falls back to the ticket: posting there would reintroduce the
 * very leak this DM exists to close.
 *
 * The verdict is already persisted before this runs, so a failure here costs
 * only the notification — the ticket stays PASSED.
 */
async function notifyApproverOfPass(
  client: Client,
  channelId: string,
  workerId: string,
  username: string,
  karma: number,
): Promise<void> {
  try {
    const admin = await client.users.fetch(REDDIT_PROFILE_APPROVAL_ADMIN_ID);
    await admin.send({
      content: formatTicketApprovalNotice({ channelId, workerId, username, karma }),
      components: buildOutreachAddButton(channelId),
    });
    logger.info('Reddit profile check: approver notified', { channelId, username, verdict: 'PASSED' });
  } catch (error) {
    logger.warn('Reddit profile check: could not DM approver', {
      channelId,
      username,
      verdict: 'PASSED',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * DM the approver, best effort. Never throws: a closed DM inbox must not take
 * down the ticket flow, and the verdict is already persisted, so the worst case
 * is that the approver does not hear about this one ticket.
 *
 * Used for failures that are OURS (no vaulted session / expired session) and,
 * via `notifyApproverOfPass`, for passes (outreach selection). Both stay out
 * of the ticket so the worker never sees them.
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
    const eligibility = evaluateProfileEligibility(result.profile);
    const linkKarma = result.profile.linkKarma;
    const commentKarma = result.profile.commentKarma;

    if (eligibility.passes) {
      const karma = eligibility.karma;
      // Short verified+guide line first, stamp second: if the send fails the
      // stamp is not written and the message is retried on the next message
      // rather than lost.
      try {
        await channel.send(formatVerifiedMessage(karma));
        await onboardingRepository.markGuideSent(channelId);
      } catch (error) {
        logger.warn('Reddit profile check: guide send failed', {
          channelId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await persist(channelId, PROFILE_CHECK_PASSED, username, linkKarma, commentKarma);
      await notifyApproverOfPass(client, channelId, workerId, username, karma);
      logger.info('Reddit profile check: worker passed', { channelId, username, workerId, karma });
      return;
    }

    // Live account, under one or both bars. LOW_KARMA is the persisted
    // status for both (non-terminal, so a re-shared link re-checks); the
    // message names which bar missed.
    await persist(channelId, PROFILE_CHECK_LOW_KARMA, username, linkKarma, commentKarma);
    const underText =
      eligibility.reason === 'too_young' || eligibility.reason === 'too_young_and_low_karma'
        ? formatTooYoungMessage(eligibility.karma, eligibility.ageDays)
        : formatLowKarmaMessage(eligibility.karma);
    await channel.send(underText).catch((error) =>
      logger.warn('Reddit profile check: low-karma message failed', {
        channelId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    logger.info('Reddit profile check: worker under bar', {
      channelId,
      username,
      workerId,
      karma: eligibility.karma,
      reason: eligibility.reason,
    });
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
