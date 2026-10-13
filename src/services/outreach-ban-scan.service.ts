import { Client, TextChannel } from 'discord.js';
import { onboardingRepository, outreachRepository } from '../database/repositories';
import { auditLogService } from './audit.service';
import { lookupRedditProfile } from './reddit-profile-check.service';
import {
  OWNER_USER_ID,
  PROFILE_CHECK_BANNED,
  REDDIT_PROFILE_APPROVAL_ADMIN_ID,
} from '../config/constants';
import {
  formatBanRemovalDmMessage,
  formatBanRemovalTicketMessage,
  formatBanScanSummary,
  formatMissingProfileAskMessage,
} from '../utils/reddit-profile-link';
import { getIstDayBoundaries } from '../utils/ist-time';
import { getAllAdminIds } from '../utils/permissions';
import { logger } from '../utils/logger';
import { AuditAction } from '../types';
import { planNextBanScan } from './outreach-ban-scan-plan';

/**
 * Daily 7am IST outreach ban scan.
 *
 * Every ticket with `TicketOutreach.selected = true` gets its stored Reddit
 * profile (`TicketOnboarding.profileUsername`) re-checked once a day:
 *
 *   stored username + Reddit says suspended -> remove from outreach
 *     (`selected = false`), stamp BANNED (non-terminal, so a re-shared link
 *     re-checks), DM the worker (fallback: ticket), tag the owner in the
 *     ticket, audit. Admin gets one summary DM.
 *   stored username + live                      -> nothing (checked++).
 *   stored username + anything else             -> skip, never remove.
 *     `not_found` is deliberately NOT a removal: shadowbans look identical
 *     to typos, and a false removal would drop a healthy worker.
 *   no stored username                          -> ask in the ticket, tagging
 *     the worker, so the next scan has something to check.
 *
 * Suspension-only by owner directive. Karma/age are enforced on (re-)share
 * by the ticket profile check, never by this scan.
 *
 * Everything is best-effort per ticket: one bad channel/lookup never aborts
 * the sweep. The function itself never throws — the scheduler chain depends
 * on it.
 */

export interface BanScanBanned {
  channelId: string;
  username: string;
  workerId: string | null;
}

export interface BanScanMissing {
  channelId: string;
  workerId: string;
}

export interface BanScanSkipped {
  channelId: string;
  reason: string;
}

export interface BanScanResult {
  dayKey: string;
  selectedTotal: number;
  checked: number;
  banned: BanScanBanned[];
  missingAsked: BanScanMissing[];
  skipped: BanScanSkipped[];
  sessionIssue: boolean;
}

/** The ticket's worker: exactly one non-bot, non-staff viewer. Null otherwise. */
function resolveTicketWorkerId(channel: TextChannel): string | null {
  try {
    const staffIds = getAllAdminIds();
    const worker = channel.members.filter((m) => !m.user.bot && !staffIds.includes(m.id)).first();
    return worker ? worker.id : null;
  } catch {
    return null;
  }
}

async function dmWorkerBestEffort(
  client: Client,
  workerId: string,
  text: string,
  channel: TextChannel,
): Promise<void> {
  try {
    const user = await client.users.fetch(workerId);
    await user.send({ content: text });
    logger.info('Ban scan: worker DM sent', { workerId, channelId: channel.id });
  } catch (error) {
    logger.warn('Ban scan: worker DM failed, falling back to the ticket', {
      workerId,
      channelId: channel.id,
      error: error instanceof Error ? error.message : String(error),
    });
    await channel.send({ content: `<@${workerId}> ${text}` }).catch(() => undefined);
  }
}

export async function runOutreachBanScan(client: Client, opts: { dayKey?: string } = {}): Promise<BanScanResult> {
  const dayKey = opts.dayKey ?? getIstDayBoundaries(new Date()).dayKey;
  const empty: BanScanResult = {
    dayKey,
    selectedTotal: 0,
    checked: 0,
    banned: [],
    missingAsked: [],
    skipped: [],
    sessionIssue: false,
  };

  let rows: Awaited<ReturnType<typeof outreachRepository.findAll>>;
  try {
    rows = await outreachRepository.findAll();
  } catch (error) {
    logger.error('Ban scan: could not read outreach rows', {
      error: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }

  const selected = rows.filter((r) => r && r.selected);
  const result: BanScanResult = { ...empty, selectedTotal: selected.length };

  if (selected.length === 0) {
    logger.info('Ban scan: no selected outreach tickets', { dayKey });
    await sendAdminSummary(client, result).catch(() => undefined);
    return result;
  }

  // One member fetch per guild up front: per-ticket worker resolution is then
  // pure cache work instead of N guild fetches.
  for (const guild of client.guilds.cache.values()) {
    await guild.members.fetch().catch(() => undefined);
  }

  let onboardingByChannel = new Map<string, { profileUsername: string | null }>();
  try {
    const onboardings = await onboardingRepository.findManyByChannelIds(selected.map((r) => r.channelId));
    onboardingByChannel = new Map(
      (onboardings ?? []).map((o) => [o.channelId, { profileUsername: o.profileUsername ?? null }]),
    );
  } catch (error) {
    logger.warn('Ban scan: bulk onboarding read failed, falling back to per-ticket reads', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  for (const row of selected) {
    const channelId = row.channelId;
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !(channel instanceof TextChannel)) {
        result.skipped.push({ channelId, reason: 'no_channel' });
        continue;
      }

      const workerId = resolveTicketWorkerId(channel);

      let username: string | null = onboardingByChannel.get(channelId)?.profileUsername ?? null;
      if (username === null || username === undefined) {
        // Bulk read may have failed above; try the single-row read once.
        try {
          const single = await onboardingRepository.findByChannelId(channelId);
          username = single?.profileUsername ?? null;
        } catch {
          username = null;
        }
      }
      username = typeof username === 'string' && username.trim() ? username.trim().toLowerCase() : null;

      if (!username) {
        if (!workerId) {
          result.skipped.push({ channelId, reason: 'no_worker' });
          continue;
        }
        try {
          await channel.send(formatMissingProfileAskMessage(workerId));
          result.missingAsked.push({ channelId, workerId });
          logger.info('Ban scan: asked for missing profile link', { channelId, workerId });
        } catch (error) {
          result.skipped.push({ channelId, reason: 'ask_failed' });
          logger.warn('Ban scan: missing-link ask failed', {
            channelId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }

      let lookup: Awaited<ReturnType<typeof lookupRedditProfile>>;
      try {
        lookup = await lookupRedditProfile(username);
      } catch (error) {
        result.skipped.push({ channelId, reason: 'lookup_threw' });
        logger.warn('Ban scan: lookup threw (treated as no verdict)', {
          channelId,
          username,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (lookup.kind === 'suspended') {
        // Removal first, then the record: even if the stamp fails, the
        // worker is already out of tomorrow's blast.
        try {
          await outreachRepository.upsertSelection([{ channelId, selected: false }]);
        } catch (error) {
          result.skipped.push({ channelId, reason: 'deselect_failed' });
          logger.warn('Ban scan: could not deselect banned ticket', {
            channelId,
            username,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        try {
          await onboardingRepository.markProfileChecked(channelId, {
            status: PROFILE_CHECK_BANNED,
            username,
            linkKarma: null,
            commentKarma: null,
          });
        } catch (error) {
          logger.warn('Ban scan: could not stamp BANNED (ticket already deselected)', {
            channelId,
            username,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        await auditLogService
          .log(
            AuditAction.OUTREACH_MESSAGE_SENT,
            null,
            null,
            `Daily ban scan ${dayKey}: u/${username} suspended — ticket ${channelId} removed from the daily outreach`,
          )
          .catch(() => undefined);

        const dmText = formatBanRemovalDmMessage(username);
        if (workerId) {
          await dmWorkerBestEffort(client, workerId, dmText, channel);
        } else {
          // No resolvable worker: the DM has nowhere to go, so the ticket
          // carries the worker-facing text untagged rather than losing it.
          await channel.send({ content: dmText }).catch(() => undefined);
        }
        // Owner review line in the ticket, always posted.
        await channel
          .send({ content: formatBanRemovalTicketMessage(OWNER_USER_ID, username) })
          .catch(() => undefined);

        result.banned.push({ channelId, username, workerId });
        result.checked++;
        logger.info('Ban scan: banned worker removed from outreach', { channelId, username, workerId });
        continue;
      }

      if (lookup.kind === 'ok') {
        result.checked++;
        continue;
      }

      // Every other verdict is "no removal": not_found (shadowban ambiguity),
      // plus our-side failures that must never cost a worker their slot.
      if (lookup.kind === 'no_session' || lookup.kind === 'session_expired' || lookup.kind === 'rate_limited') {
        result.sessionIssue = true;
      }
      const reason = lookup.kind === 'not_found' ? 'not_found' : lookup.kind;
      result.skipped.push({ channelId, reason });
    } catch (error) {
      result.skipped.push({ channelId, reason: 'unexpected' });
      logger.warn('Ban scan: ticket failed (continuing sweep)', {
        channelId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await sendAdminSummary(client, result).catch(() => undefined);
  logger.info('Ban scan complete', {
    dayKey,
    selected: result.selectedTotal,
    checked: result.checked,
    banned: result.banned.length,
    missingAsked: result.missingAsked.length,
    skipped: result.skipped.length,
  });
  return result;
}

async function sendAdminSummary(client: Client, result: BanScanResult): Promise<void> {
  try {
    const admin = await client.users.fetch(REDDIT_PROFILE_APPROVAL_ADMIN_ID);
    await admin.send({
      content: formatBanScanSummary({
        dayKey: result.dayKey,
        selectedTotal: result.selectedTotal,
        checked: result.checked,
        bannedCount: result.banned.length,
        missingAsked: result.missingAsked.length,
        skipped: result.skipped.length,
        sessionIssue: result.sessionIssue,
      }),
    });
    logger.info('Ban scan: admin summary DM sent', { dayKey: result.dayKey });
  } catch (error) {
    logger.warn('Ban scan: could not DM admin summary', {
      dayKey: result.dayKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ─── Daily 7am IST scheduler (self-rescheduling setTimeout chain, no cron) ───

let timer: NodeJS.Timeout | null = null;
let lastServedKey: string | null = null;

async function fire(key: string, client: Client): Promise<void> {
  if (lastServedKey === key) return;
  lastServedKey = key;
  try {
    logger.info('Outreach ban scan starting (scheduled 7am IST)', { key });
    await runOutreachBanScan(client, { dayKey: key });
  } catch (error) {
    logger.error('Outreach ban scan failed', { key, error });
  }
}

/** Starts the daily chain. Idempotent — second calls are no-ops. */
export function startOutreachBanScanScheduler(client: Client): void {
  if (timer) return;
  const schedule = (): void => {
    try {
      const plan = planNextBanScan(Date.now(), lastServedKey);
      logger.info('Outreach ban scan scheduled', {
        key: plan.key,
        firesInSec: Math.round(plan.delayMs / 1000),
        late: plan.late,
      });
      timer = setTimeout(() => {
        timer = null;
        void fire(plan.key, client).finally(schedule);
      }, plan.delayMs);
    } catch (error) {
      logger.error('Outreach ban scan scheduling failed (retry in 1 min)', { error });
      timer = setTimeout(() => {
        timer = null;
        schedule();
      }, 60 * 1000);
    }
  };
  schedule();
}

/** Test hook: stops the chain. */
export function stopOutreachBanScanScheduler(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  lastServedKey = null;
}
