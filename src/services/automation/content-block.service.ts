/**
 * Tier-1 server half of the automatic content screen (verdict-flag path).
 *
 * The browser companion aborts an accept on a full-content hit and reports
 * `{ ok: false, autoBlock }` on the claim verdict. The SERVER owns the block,
 * the audit row, and the admin DM — the companion only holds the extension
 * key and must never call the dashboard-authed block endpoints directly.
 *
 * Deliberately logger-free (like validator.service): unit tests must never
 * pull in env.ts via the logger. The route logs the returned outcome.
 */
import { automationRepository } from '../../database/repositories';
import { auditLogService } from '../audit.service';
import { AuditAction, ContentScreenSignal } from '../../types';
import { CONTENT_SCREEN } from '../../config/constants';
import { normalizeSubreddit } from './subreddit';
import { autoBlockReason } from '../../utils/content-screen';

export interface AutoBlockReport {
  subreddit: string;
  signal: ContentScreenSignal;
  matched?: string | null;
  snippet?: string | null;
}

export interface AutoBlockOutcome {
  blocked: boolean;
  subreddit: string | null;
  /** Machine-readable fate (orchestrators must not parse `outcome` text). */
  disposition: 'blocked' | 'dry-run' | 'already-blocked' | 'seen-skipped' | 'invalid';
  /** One log line describing what happened (or would have, in dry-run). */
  outcome: string;
  /** Admin DM text, or null when nothing is worth sending. */
  notice: string | null;
}

const VALID_SIGNALS: readonly string[] = ['sex', 'vape', 'dojo', 'crypto', 'place', 'uni', 'non-en', 'nsfw'];

export async function handleAutoBlockReport(
  report: AutoBlockReport,
  opts: { dryRun?: boolean; seenSubs?: ReadonlySet<string>; actorId?: string; source?: string } = {},
): Promise<AutoBlockOutcome> {
  const dryRun = opts.dryRun ?? CONTENT_SCREEN.DRY_RUN;
  const actorId = opts.actorId || 'companion:auto-screen';
  const normalized = normalizeSubreddit(report.subreddit);
  if (!normalized) {
    return {
      blocked: false,
      subreddit: null,
      disposition: 'invalid',
      outcome: `auto-block ignored: unreadable subreddit ${JSON.stringify(report.subreddit)}`,
      notice: null,
    };
  }
  if (!VALID_SIGNALS.includes(report.signal)) {
    return {
      blocked: false,
      subreddit: normalized,
      disposition: 'invalid',
      outcome: `auto-block ignored: unknown signal ${JSON.stringify(report.signal)}`,
      notice: null,
    };
  }
  // Narrow race cover: two tabs can hit a brand-new subreddit at nearly the
  // same instant — the loser finds it already blocked and stays quiet.
  if (await automationRepository.isBlocked(normalized)) {
    return {
      blocked: false,
      subreddit: normalized,
      disposition: 'already-blocked',
      outcome: `r/${normalized} already blocked — auto-block skipped`,
      notice: null,
    };
  }
  // A sub seen in a PRIOR scan was already shown in a digest the manager did
  // not act on — never override that human judgment automatically.
  if (opts.seenSubs && opts.seenSubs.has(normalized)) {
    return {
      blocked: false,
      subreddit: normalized,
      disposition: 'seen-skipped',
      outcome: `r/${normalized} seen in a prior scan — auto-block skipped`,
      notice: null,
    };
  }
  const reason = autoBlockReason(report.signal);
  const where = report.matched ? `, keyword "${report.matched}"` : '';
  if (dryRun) {
    return {
      blocked: false,
      subreddit: normalized,
      disposition: 'dry-run',
      outcome: `WOULD_BLOCK r/${normalized} (${reason}${where})`,
      notice: null,
    };
  }
  await automationRepository.addBlocked(normalized, reason, actorId);  try {
    await auditLogService.log(AuditAction.AUTOMATION_BLOCKED, null, actorId, `r/${normalized} auto-blocked (${reason}${where})`);
  } catch {
    // best-effort audit; the block itself is recorded
  }
  return {
    blocked: true,
    subreddit: normalized,
    disposition: 'blocked',
    outcome: `auto-blocked r/${normalized} (${reason}${where})`,
    notice:
      `Auto-blocked r/${normalized} (${reason}${where}). ` +
      `Source: ${opts.source || 'Tier-1 full-content screen during an accept attempt'}. ` +
      `If this was a false positive, remove it in the dashboard Automation page → blocked-subreddit editor.`,
  };
}
