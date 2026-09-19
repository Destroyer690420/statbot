import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
} from 'discord.js';
import { automationRepository } from '../../database/repositories';
import { auditLogService } from '../audit.service';
import { AuditAction } from '../../types';
import { logger } from '../../utils/logger';
import { getAdminOrManagerIds, isAdminOrManager } from '../../utils/permissions';
import { getIstHourStart } from '../../utils/ist-time';
import { createBurstFlow } from './burst.service';
import {
  buildBlastDigest,
  buildDigestButtons,
  buildReleaseInputs,
  formatDigestMessage,
  parseBlastButtonId,
  ButtonSpec,
} from './blast-digest';

/**
 * Phone-approval flow for burst rounds (manager DMs).
 *
 * The watcher settles each hour's scan into POST /burst; with auto-bursts
 * paused the server validates + logs but never blasts. This service DMs the
 * manager that settled set with Blast / Hold / per-subreddit Block buttons,
 * so the xx:10 routine needs no Remote Desktop session. Claim creation
 * rules (order, one-win, caps, busy, subreddit ground-truth) are untouched —
 * approval only releases the already-validated set through the normal
 * createBurstFlow path with forceWindow.
 */

const APPROVAL_EXPIRY_MS = 90 * 60 * 1000;

// One digest DM per IST hour: retries of the same settled report stay
// silent unless the scanned set grew (the drop is still streaming in).
let lastDigest: { hourKey: number; cycleId: string; scanned: number } | null = null;
// In-flight guard: two tabs' reports can land in the same seconds. The flag
// is set synchronously (no await before it), so the second call sees it and
// stays silent instead of sending a duplicate DM.
let digestInFlightHour: number | null = null;

export interface DigestDelivery {
  sentTo: string[];
  failed: { id: string; error: string }[];
}

function deliveryError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 200);
  try {
    return JSON.stringify(error)?.slice(0, 200) || 'unknown error';
  } catch {
    return 'unknown error';
  }
}

function styleFor(style: ButtonSpec['style']): ButtonStyle {
  if (style === 'primary') return ButtonStyle.Primary;
  if (style === 'danger') return ButtonStyle.Danger;
  return ButtonStyle.Secondary;
}

export function digestComponents(specs: ButtonSpec[][]): ActionRowBuilder<ButtonBuilder>[] {
  return specs.map((row) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...row.map((b) => new ButtonBuilder().setCustomId(b.customId).setLabel(b.label).setStyle(styleFor(b.style))),
    ),
  );
}

export interface BuiltDigest {
  message: string;
  components: ActionRowBuilder<ButtonBuilder>[];
  eligible: number;
  /** Total scanned posts (eligible + tagged) — zero means nothing to show. */
  total: number;
}

/** Rebuilds the digest for a cycle from current DB state (logs + blocked). */
export async function buildDigestForCycle(cycleId: string): Promise<BuiltDigest | null> {
  const cycle = await automationRepository.getCycle(cycleId).catch(() => null);
  if (!cycle) return null;
  const logs = await automationRepository.listCycleLogs(cycleId).catch(() => []);
  const blockedRows = await automationRepository.listBlocked().catch(() => []);
  const seen = await automationRepository.listSeenSubreddits().catch(() => []);
  const digest = buildBlastDigest(
    cycleId,
    logs,
    blockedRows.map((b) => b.subreddit),
    seen,
    { scanned: cycle.tasksDetected, eligible: cycle.eligiblePosts, blocked: cycle.blocked },
  );
  return {
    message: formatDigestMessage(digest),
    components: digestComponents(buildDigestButtons(digest)),
    eligible: digest.eligible,
    total: logs.length,
  };
}

/**
 * Sends the pre-blast digest DM after a settled auto-report. Best-effort:
 * any failure only logs (the dashboard + Blast Now button stay available).
 * Fires on ANY scanned content (eligible or all-blocked) — the digest lists
 * every available post with reason tags, so banned-only drops are visible
 * too. Sends to every admin/manager (deduped) and reports per-recipient
 * results. Never throws.
 */
export async function maybeSendDigest(
  discordClient: Client,
  cycleId: string,
  scanned: number,
): Promise<DigestDelivery> {
  const delivery: DigestDelivery = { sentTo: [], failed: [] };
  const hourKey = getIstHourStart().getTime();
  if (lastDigest && lastDigest.hourKey === hourKey && scanned <= lastDigest.scanned) return delivery;
  if (digestInFlightHour === hourKey) return delivery;
  digestInFlightHour = hourKey;
  try {
    const built = await buildDigestForCycle(cycleId);
    if (!built || built.total === 0) return delivery;
    const approvers = [...new Set(getAdminOrManagerIds())];
    if (approvers.length === 0) {
      logger.warn('Blast digest skipped: no admin/manager ids configured', { cycleId });
      return delivery;
    }
    for (const approverId of approvers) {
      try {
        const user = await discordClient.users.fetch(approverId);
        await user.send({ content: built.message, components: built.components });
        delivery.sentTo.push(approverId);
        logger.info('Blast digest DM sent', { cycleId, to: approverId, eligible: built.eligible });
      } catch (error) {
        delivery.failed.push({ id: approverId, error: deliveryError(error) });
        logger.warn('Blast digest DM failed for recipient', { cycleId, to: approverId, error });
      }
    }
    // Only suppress later retries once at least one DM actually went out.
    if (delivery.sentTo.length > 0) lastDigest = { hourKey, cycleId, scanned: built.total };
    return delivery;
  } catch (error) {
    logger.warn('Blast digest DM failed (dashboard fallback still available)', { cycleId, error });
    return delivery;
  } finally {
    if (digestInFlightHour === hourKey) digestInFlightHour = null;
  }
}

// In-progress releases by cycle: two rapid Blast taps (or two approvers)
// must not open two blasts. Guard is synchronous around the check; the
// one-blast-per-hour rule inside createBurstFlow stays the backstop.
const releasingCycles = new Set<string>();

function claimRelease(cycleId: string): boolean {
  if (releasingCycles.has(cycleId)) return false;
  releasingCycles.add(cycleId);
  return true;
}

function dropRelease(cycleId: string): void {
  releasingCycles.delete(cycleId);
}

async function editReplySafe(interaction: ButtonInteraction, content: string, clearButtons: boolean): Promise<void> {
  try {
    await interaction.editReply(clearButtons ? { content, components: [] } : { content });
  } catch (error) {
    logger.warn('Blast button reply edit failed', { error });
  }
}

/**
 * Handles `blast:*` DM buttons. Returns true when the id belonged to this
 * flow (even on denial/error — the caller must not route it elsewhere).
 */
export async function handleBlastButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseBlastButtonId(interaction.customId);
  if (!parsed) return false;
  if (!isAdminOrManager(interaction.user.id)) {
    try {
      // Ephemeral is guild-only — in DMs fall back to a normal reply.
      await interaction.reply({
        content: 'Only admins/managers can release blasts.',
        ephemeral: interaction.guildId !== null,
      });
    } catch {
      // ignore — never break on a denial
    }
    return true;
  }
  try {
    await interaction.deferUpdate();
  } catch (error) {
    logger.warn('Blast button defer failed', { error });
    return true;
  }

  try {
    const cycle = await automationRepository.getCycle(parsed.cycleId).catch(() => null);
    if (!cycle) {
      await editReplySafe(interaction, 'That round no longer exists — nothing to do.', true);
      return true;
    }
    const bursts = await automationRepository.listBurstsByCycle(parsed.cycleId).catch(() => []);
    if (bursts.length > 0) {
      await editReplySafe(interaction, 'That round was already released — check the tickets.', true);
      return true;
    }
    if (Date.now() - cycle.startedAt.getTime() > APPROVAL_EXPIRY_MS) {
      await editReplySafe(interaction, 'That round expired (over 90 min old) — wait for the next drop.', true);
      return true;
    }

    if (parsed.action === 'hold') {
      await auditLogService
        .log(AuditAction.AUTOMATION_STOPPED, null, interaction.user.id, `Blast held by manager for ${parsed.cycleId}`)
        .catch(() => undefined);
      await editReplySafe(interaction, `Held — nothing will blast for ${parsed.cycleId}. The next drop supersedes it.`, true);
      return true;
    }

    if (parsed.action === 'block') {
      const sub = parsed.sub as string;
      await automationRepository.addBlocked(sub, 'Pre-blast DM review', interaction.user.id);
      await auditLogService
        .log(AuditAction.AUTOMATION_BLOCKED, null, interaction.user.id, `r/${sub} blocked from pre-blast DM review`)
        .catch(() => undefined);
      const rebuilt = await buildDigestForCycle(parsed.cycleId);
      if (!rebuilt) {
        await editReplySafe(interaction, `r/${sub} blocked. The round is gone — nothing to do.`, true);
        return true;
      }
      try {
        await interaction.editReply({ content: `r/${sub} blocked.\n${rebuilt.message}`, components: rebuilt.components });
      } catch (error) {
        logger.warn('Blast digest refresh edit failed', { error });
      }
      return true;
    }

    // parsed.action === 'go'
    if (!claimRelease(parsed.cycleId)) {
      // Say nothing: the winning tap owns this message (its success edit is
      // coming). The defer above already acked this tap, so nothing hangs.
      logger.info('Blast double-tap ignored', { cycleId: parsed.cycleId, userId: interaction.user.id });
      return true;
    }
    try {
      const settings = await automationRepository.getSettings().catch(() => null);
      if (!settings?.enabled || settings.dryRun) {
        await editReplySafe(
          interaction,
          'Automation is off (disabled or dry-run) — enable it on the dashboard first, then tap Blast again.',
          false,
        );
        return true;
      }
      const logs = await automationRepository.listCycleLogs(parsed.cycleId).catch(() => []);
      const inputs = buildReleaseInputs(logs);
      if (inputs.length === 0) {
        await editReplySafe(interaction, 'Nothing eligible left in that round (all blocked or taken).', true);
        return true;
      }
      const result = await createBurstFlow(interaction.client as Client, inputs, interaction.user.id, {
        forceWindow: true,
      });
      await auditLogService
        .log(
          AuditAction.AUTOMATION_CYCLE_STARTED,
          null,
          interaction.user.id,
          `Blast released from DM for ${parsed.cycleId}: ${result.sent} sent / ${result.blast ? result.blast.slotsTotal : 0} slots`,
        )
        .catch(() => undefined);
      if (result.blast) {
        await editReplySafe(
          interaction,
          `Blast opened: ${result.sent}/${result.blast.slotsTotal} workers messaged. Winners claim by replying — same as always.`,
          true,
        );
      } else {
        await editReplySafe(interaction, `No blast opened: ${result.reason || 'unknown reason'}.`, true);
      }
      return true;
    } finally {
      dropRelease(parsed.cycleId);
    }
  } catch (error) {
    logger.warn('Blast button handling failed', { error });
    await editReplySafe(interaction, 'Something went wrong — use the Blast Now button as fallback.', false);
    return true;
  }
}
