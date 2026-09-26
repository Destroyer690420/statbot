import { getDb } from '../database/db';
import { toReferral } from '../database/converters';
import { commissionRepository, referralRepository } from '../database/repositories';
import { commissionService } from './commission.service';
import { buildInvitesSummary, WorkerInviteInput, WorkerInvitesDto } from '../utils/worker-view';
import { logger } from '../utils/logger';

/**
 * Worker-scoped referral view. Identity comes only from the token `sub`; there
 * is no parameter a caller could use to read somebody else's invites.
 *
 * Privacy rules enforced here:
 * - only referrals this worker personally created are listed;
 * - multi-level (`per_task_indirect`) earnings are reported as one anonymous
 *   total, never attributed to the downstream workers who generated them;
 * - no Discord ids, referral ids, commission kinds, or rates cross the boundary
 *   — the DTO carries display names, ticket numbers, and money only.
 */

const SNOWFLAKE = /^\d{17,20}$/;
// Anything wrapped as a Discord channel mention is a reference, never a label.
const CHANNEL_MENTION = /^<#(.+)>$/;

/** `<#123…>` or a bare snowflake -> channel id; a plain name -> null. */
function parseTicketChannelId(ticketId: string | null | undefined): string | null {
  const trimmed = (ticketId ?? '').trim();
  if (!trimmed) return null;
  const mention = trimmed.match(CHANNEL_MENTION);
  if (mention) return mention[1].trim() || null;
  return SNOWFLAKE.test(trimmed) ? trimmed : null;
}

/** A stored plain channel name (`ticket-0036`) -> display name; ids -> null. */
function parseTicketName(ticketId: string | null | undefined): string | null {
  const trimmed = (ticketId ?? '').trim().replace(/^#/, '');
  if (!trimmed) return null;
  if (SNOWFLAKE.test(trimmed) || trimmed.includes('<') || trimmed.includes('>')) return null;
  return trimmed;
}

/**
 * Resolve the invitee's stored ticket reference to a ticket number. Ids and
 * mentions are looked up against the channel names already recorded on tasks
 * (one batched query); a missing lookup yields null rather than leaking the id.
 */
async function resolveTicketNames(ticketIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const channelIds = Array.from(
    new Set(ticketIds.map((t) => parseTicketChannelId(t)).filter((id): id is string => id !== null)),
  );
  const names = new Map<string, string>();
  if (channelIds.length === 0) return names;

  try {
    const rows = await getDb().task.findMany({
      where: { channelId: { in: channelIds } },
      select: { channelId: true, channelName: true },
    });
    for (const row of rows) {
      const name = row.channelName;
      if (name && !names.has(row.channelId)) names.set(row.channelId, name);
    }
  } catch (error) {
    logger.warn('Worker invites: ticket name lookup failed', { error });
  }
  return names;
}

export async function getInvitesForWorker(workerId: string): Promise<WorkerInvitesDto> {
  const referrals = (await referralRepository.findByInviterId(workerId))
    .map(toReferral)
    .filter((r) => r.status !== 'closed');

  const ownReferralIds = new Set(referrals.map((r) => r.id));
  const paidByReferral = new Map<string, number>();
  let directPaid = 0;
  let teamPaid = 0;

  // CommissionItem rows already written == money actually disbursed: commission
  // batches stamp paidAt at creation, so an item's existence is the paid record
  // and no extra batch lookup is needed. Items whose referral this worker does
  // not own are multi-level earnings.
  for (const item of await commissionRepository.findItemsByInviterId(workerId)) {
    if (ownReferralIds.has(item.referralId)) {
      paidByReferral.set(item.referralId, (paidByReferral.get(item.referralId) ?? 0) + item.amount);
      directPaid += item.amount;
    } else {
      teamPaid += item.amount;
    }
  }

  let directPending = 0;
  if (referrals.length > 0) {
    const rates = await commissionService.getCommissionRates();
    for (const referral of referrals) {
      const payable = await commissionService.getPayableItems(referral, rates);
      for (const item of payable) directPending += item.amount;
    }
  }

  const namesByChannel = await resolveTicketNames(referrals.map((r) => r.ticketId));

  const invitees: WorkerInviteInput[] = referrals.map((referral) => {
    const channelId = parseTicketChannelId(referral.ticketId);
    return {
      inviteeName: referral.inviteeName?.trim() || 'Invited worker',
      ticketName: parseTicketName(referral.ticketId) ?? (channelId ? namesByChannel.get(channelId) ?? null : null),
      paid: paidByReferral.get(referral.id) ?? 0,
    };
  });

  return buildInvitesSummary({ directPaid, directPending, teamPaid, invitees });
}
