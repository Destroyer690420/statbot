import { TICKET_REDDIT_PROFILE_REQUEST_MESSAGE } from '../config/constants';

/**
 * Planning for the one-time "send me your Reddit profile link" ask that goes
 * out to every EXISTING ticket exactly once.
 *
 * This module is deliberately pure: the sweep script does the Discord/DB I/O,
 * and everything that decides *whether* a channel gets messaged (and why it
 * does not) lives here so it is directly testable. Getting that wrong means
 * either a worker is messaged twice or a ticket is silently never asked, so
 * the skip reason is always explicit and always reported back.
 */

/** Every live ticket channel is named `ticket-####`. */
export const TICKET_NAME_PREFIX = 'ticket-';

/** A text channel plus the non-bot, non-admin members that can see it. */
export interface TicketWorkerCandidate {
  channelId: string;
  channelName: string;
  /** Staff (admins/managers/moderators) and bots are excluded by the caller. */
  workerIds: string[];
}

export interface ProfileRequestTarget {
  channelId: string;
  channelName: string;
  workerId: string;
}

export type ProfileRequestSkipReason =
  /** Name does not start with `ticket-` (and the prefix requirement is on). */
  | 'not a ticket channel'
  /** Excluded by an explicit --only filter. */
  | 'outside the requested filter'
  /** `redditProfileRequestedAt` is already set — the one-time guard. */
  | 'already asked'
  /** The worker left the guild, or the member cache could not resolve them. */
  | 'no worker in ticket'
  /** Ambiguous: more than one candidate, so a tag could hit the wrong person. */
  | 'multiple workers in ticket';

export interface ProfileRequestSkipped {
  channelId: string;
  channelName: string;
  reason: ProfileRequestSkipReason;
}

export interface ProfileRequestPlan {
  targets: ProfileRequestTarget[];
  skipped: ProfileRequestSkipped[];
}

export interface ProfileRequestPlanOptions {
  /**
   * Only channels whose name starts with `ticket-` (default true). This is the
   * safety net that keeps the sweep off staff/general channels; disable it with
   * `--all-text-channels` when a ticket is named something else.
   */
  requireTicketName?: boolean;
  /** Re-ask channels already recorded as asked (default false). */
  force?: boolean;
  /** Channel ids or exact names to restrict the run to (default: every ticket). */
  only?: readonly string[];
}

/** The message for one ticket, tagging that ticket's worker. */
export function formatProfileRequestMessage(workerId: string): string {
  return TICKET_REDDIT_PROFILE_REQUEST_MESSAGE.replace('{user}', `<@${workerId}>`);
}

/**
 * Decides which channels get the message, in a stable order (input order), and
 * records an explicit reason for every channel that does not.
 *
 * Check order is deliberate: the operator's own `--only` filter is reported
 * first, then the ticket-name safety net, then the one-time guard, and only
 * then worker resolution — so the skip list answers "why did this ticket not
 * get asked?" in the order a human would ask it.
 */
export function buildProfileRequestPlan(
  candidates: readonly TicketWorkerCandidate[],
  alreadyAsked: readonly string[],
  options: ProfileRequestPlanOptions = {},
): ProfileRequestPlan {
  const { requireTicketName = true, force = false, only } = options;
  const asked = new Set(alreadyAsked);
  const onlyFilter = only && only.length > 0 ? new Set(only) : null;

  const targets: ProfileRequestTarget[] = [];
  const skipped: ProfileRequestSkipped[] = [];

  for (const candidate of candidates) {
    const skip = (reason: ProfileRequestSkipReason): void => {
      skipped.push({ channelId: candidate.channelId, channelName: candidate.channelName, reason });
    };

    if (onlyFilter && !onlyFilter.has(candidate.channelId) && !onlyFilter.has(candidate.channelName)) {
      skip('outside the requested filter');
      continue;
    }
    if (requireTicketName && !candidate.channelName.startsWith(TICKET_NAME_PREFIX)) {
      skip('not a ticket channel');
      continue;
    }
    if (!force && asked.has(candidate.channelId)) {
      skip('already asked');
      continue;
    }
    if (candidate.workerIds.length === 0) {
      skip('no worker in ticket');
      continue;
    }
    if (candidate.workerIds.length > 1) {
      skip('multiple workers in ticket');
      continue;
    }

    targets.push({
      channelId: candidate.channelId,
      channelName: candidate.channelName,
      workerId: candidate.workerIds[0],
    });
  }

  return { targets, skipped };
}

/** Per-channel send result. `error` is set only when `ok` is false. */
export interface ProfileRequestOutcome {
  channelId: string;
  channelName: string;
  workerId: string;
  ok: boolean;
  /**
   * True when Discord accepted the message but the one-time stamp did NOT
   * persist. The worker HAS been asked, so this channel is the one case a
   * plain re-run would message twice — it is counted separately instead of
   * being hidden inside `failed` (which means "safe to retry").
   */
  unstamped?: boolean;
  error?: string;
}

export interface ProfileRequestSummary {
  sent: number;
  failed: number;
  /** Delivered but not recorded — never re-run the whole sweep over these. */
  unstamped: number;
}

/**
 * Totals for the run report. `failed` is "safe to retry" (nothing was
 * delivered); `unstamped` is the opposite and is reported on its own so a
 * partial-failure recovery is never done blindly.
 */
export function summarizeProfileRequest(outcomes: readonly ProfileRequestOutcome[]): ProfileRequestSummary {
  return {
    sent: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
    unstamped: outcomes.filter((o) => o.ok && o.unstamped).length,
  };
}

/** Skip counts keyed by reason, so a partial run is diagnosable at a glance. */
export function countSkippedByReason(skipped: readonly ProfileRequestSkipped[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of skipped) {
    counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
  }
  return counts;
}
