import type { Client } from 'discord.js';
import { logger } from '../../utils/logger';
import { automationRepository } from '../../database/repositories';
import { auditLogService } from '../audit.service';
import { AuditAction } from '../../types';
import {
  TASKS_ANNOUNCEMENT_CHANNEL_ID,
  formatBatchAvailableAnnouncement,
  formatBatchClaimedAnnouncement,
} from '../../config/constants';
import {
  batchAvailableEmbed,
  batchClaimedEmbed,
  batchAvailableClosedEmbed,
} from '../../bot/embeds';

const announcedAvailableCycles = new Set<string>();
const announcedClaimedCycles = new Set<string>();
const batchCountByCycle = new Map<string, number>();
const batchMessageIdByCycle = new Map<string, string>();

/**
 * Announces the availability of a new task batch to the tasks announcement channel
 * by tagging @everyone.
 *
 * Example: "@everyone, 3 posts available reply in your tickets asap to claim the posts."
 */
export async function announceBatchAvailable(
  discordClient: Client | undefined,
  cycleId: string,
  count: number,
): Promise<boolean> {
  if (!discordClient || count <= 0) return false;
  if (announcedAvailableCycles.has(cycleId)) {
    logger.info('Batch available announcement already sent for this cycle', { cycleId });
    return false;
  }

  try {
    const channel = await discordClient.channels.fetch(TASKS_ANNOUNCEMENT_CHANNEL_ID).catch(() => null);
    if (!channel || !('send' in channel) || typeof (channel as any).send !== 'function') {
      logger.warn('Task announcement channel not found or cannot send message', {
        channelId: TASKS_ANNOUNCEMENT_CHANNEL_ID,
      });
      return false;
    }

    const message = formatBatchAvailableAnnouncement(count);
    const embed = batchAvailableEmbed(count);
    const sent = await (channel as any).send({
      content: message,
      embeds: [embed],
      allowedMentions: { parse: ['everyone'] },
    });

    if (sent && sent.id) {
      batchMessageIdByCycle.set(cycleId, sent.id);
    }

    announcedAvailableCycles.add(cycleId);
    batchCountByCycle.set(cycleId, count);
    logger.info('Task batch available announcement sent', {
      channelId: TASKS_ANNOUNCEMENT_CHANNEL_ID,
      cycleId,
      count,
    });

    await auditLogService
      .log(
        AuditAction.OUTREACH_MESSAGE_SENT,
        null,
        'burst',
        `Task batch availability announced in <#${TASKS_ANNOUNCEMENT_CHANNEL_ID}>: ${count} post(s) (cycle ${cycleId})`,
      )
      .catch(() => undefined);

    return true;
  } catch (error) {
    logger.warn('Failed to send task batch available announcement', {
      channelId: TASKS_ANNOUNCEMENT_CHANNEL_ID,
      cycleId,
      count,
      error,
    });
    return false;
  }
}

/**
 * Checks whether all tasks in a batch have been claimed and delivered to workers.
 * Once all tasks are claimed, sends the completion message to the tasks announcement channel.
 *
 * Example: "all 3 posts have been claimed"
 */
export async function checkAndAnnounceBatchClaimed(
  discordClient: Client | undefined,
  cycleId: string,
): Promise<boolean> {
  if (!discordClient || !cycleId) return false;
  if (announcedClaimedCycles.has(cycleId)) return false;
  if (!announcedAvailableCycles.has(cycleId) && !batchCountByCycle.has(cycleId)) return false;

  try {
    const bursts = await automationRepository.listBurstsByCycle(cycleId).catch(() => []);
    const burst = bursts[0];
    const totalTasks = batchCountByCycle.get(cycleId) ?? burst?.taskIds?.length ?? 0;
    if (totalTasks <= 0) return false;

    const claims = await automationRepository.listCycleClaims(cycleId).catch(() => []);
    const claimedCount = claims.filter((c) => c && c.status === 'CLAIMED').length;
    const pendingCount = claims.filter((c) => c && c.status === 'PENDING').length;

    const allClaimed = claimedCount >= totalTasks;
    const closedAndSettled = burst?.status === 'CLOSED' && pendingCount === 0 && claimedCount > 0;

    if (!allClaimed && !closedAndSettled) {
      return false;
    }

    const channel = await discordClient.channels.fetch(TASKS_ANNOUNCEMENT_CHANNEL_ID).catch(() => null);
    if (!channel || !('send' in channel) || typeof (channel as any).send !== 'function') {
      logger.warn('Task announcement channel not found or cannot send message', {
        channelId: TASKS_ANNOUNCEMENT_CHANNEL_ID,
      });
      return false;
    }

    // Optionally update the original batch announcement embed to reflect it is closed
    const origMsgId = batchMessageIdByCycle.get(cycleId);
    if (origMsgId && 'messages' in channel && typeof (channel as any).messages?.fetch === 'function') {
      try {
        const origMsg = await (channel as any).messages.fetch(origMsgId);
        if (origMsg && typeof origMsg.edit === 'function') {
          await origMsg.edit({
            embeds: [batchAvailableClosedEmbed(totalTasks)],
          });
        }
      } catch (err) {
        logger.debug('Could not edit original drop message to closed status', { cycleId, origMsgId, error: err });
      }
    }

    const message = formatBatchClaimedAnnouncement(totalTasks);
    const embed = batchClaimedEmbed(totalTasks);
    await (channel as any).send({
      content: message,
      embeds: [embed],
    });

    announcedClaimedCycles.add(cycleId);
    logger.info('Task batch claimed announcement sent', {
      channelId: TASKS_ANNOUNCEMENT_CHANNEL_ID,
      cycleId,
      count: totalTasks,
    });

    await auditLogService
      .log(
        AuditAction.OUTREACH_MESSAGE_SENT,
        null,
        'burst',
        `Task batch claimed announced in <#${TASKS_ANNOUNCEMENT_CHANNEL_ID}>: all ${totalTasks} post(s) claimed (cycle ${cycleId})`,
      )
      .catch(() => undefined);

    return true;
  } catch (error) {
    logger.warn('Failed to send task batch claimed announcement', {
      channelId: TASKS_ANNOUNCEMENT_CHANNEL_ID,
      cycleId,
      error,
    });
    return false;
  }
}

/**
 * Updates the expected task count for a cycle when new tasks are merged into an active burst.
 */
export function updateBatchCount(cycleId: string, addedCount: number): void {
  if (batchCountByCycle.has(cycleId)) {
    const current = batchCountByCycle.get(cycleId) || 0;
    batchCountByCycle.set(cycleId, current + addedCount);
  }
}

/**
 * Resets state for testing purposes.
 */
export function resetAnnouncementState(): void {
  announcedAvailableCycles.clear();
  announcedClaimedCycles.clear();
  batchCountByCycle.clear();
  batchMessageIdByCycle.clear();
}

export const taskAnnouncementService = {
  announceBatchAvailable,
  checkAndAnnounceBatchClaimed,
  updateBatchCount,
  resetAnnouncementState,
};

