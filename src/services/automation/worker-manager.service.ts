import { Client, TextChannel } from 'discord.js';
import { automationRepository, outreachRepository, taskRepository } from '../../database/repositories';
import { getIstDayBoundaries } from '../../utils/ist-time';
import { getAllAdminIds } from '../../utils/permissions';
import { AUTOMATION, GOPARTTIME_SOURCE } from '../../config/constants';
import { logger } from '../../utils/logger';

export interface Candidate {
  channelId: string;
  channelName: string | null;
  workerId: string;
}

/**
 * Stage-1 pool = outreach-selected tickets. Stage-2 pings only workers with
 * <2 accepted posts today (IST) and no awaiting-submission task (1 active post).
 */
export async function selectCandidates(
  discordClient: Client,
  limit: number,
  excludeChannelIds: Set<string> = new Set(),
): Promise<Candidate[]> {
  const rows = await outreachRepository.findAll();
  const selected = rows.filter((r) => r.selected && !excludeChannelIds.has(r.channelId));
  const { dayStart, dayEnd } = getIstDayBoundaries();
  const out: Candidate[] = [];

  for (const row of selected) {
    if (out.length >= limit) break;
    try {
      const channel = await discordClient.channels.fetch(row.channelId).catch(() => null);
      if (!channel || !(channel instanceof TextChannel)) continue;
      await channel.guild.members.fetch().catch(() => undefined);
      const member = channel.members.filter((m) => !m.user.bot && !getAllAdminIds().includes(m.id)).first();
      if (!member) continue;

      const awaiting = await taskRepository.findAwaitingSubmissionInChannel(channel.id);
      if (awaiting) continue; // 1 active post per worker

      const acceptedToday = await countAcceptedToday(member.id, dayStart, dayEnd);
      if (acceptedToday >= AUTOMATION.DAILY_POST_CAP) continue;

      out.push({ channelId: channel.id, channelName: channel.name, workerId: member.id });
    } catch (error) {
      logger.warn('Candidate check failed', { channelId: row.channelId, error });
    }
  }
  return out;
}

export async function countAcceptedToday(workerId: string, dayStart: Date, dayEnd: Date): Promise<number> {
  const tasks = await taskRepository.findByCreatedAt(dayStart, dayEnd);
  return tasks.filter(
    (t: { source: string | null; assignedUserId: string; status: string }) =>
      t.source === GOPARTTIME_SOURCE && t.assignedUserId === workerId && t.status !== 'CANCELLED' && t.status !== 'ARCHIVED',
  ).length;
}

export async function sendConfirmations(
  discordClient: Client,
  cycleId: string,
  candidates: Candidate[],
): Promise<number> {
  let sent = 0;
  for (const c of candidates) {
    try {
      const channel = await discordClient.channels.fetch(c.channelId).catch(() => null);
      if (!channel || !(channel instanceof TextChannel)) continue;
      const text = AUTOMATION.CONFIRM_MESSAGE.replace('{user}', `<@${c.workerId}>`);
      const msg = await channel.send(text);
      await automationRepository.createContact({
        cycleId,
        channelId: c.channelId,
        workerId: c.workerId,
        expiresAt: new Date(Date.now() + AUTOMATION.CONTACT_WINDOW_MS),
        messageId: msg.id,
      });
      sent++;
    } catch (error) {
      logger.warn('Confirmation send failed', { channelId: c.channelId, error });
    }
  }
  if (sent > 0) {
    await automationRepository.updateCycle(cycleId, {}).catch(() => undefined);
  }
  return sent;
}

/**
 * Bot hook (called from messageCreate): correlates a worker reply with an
 * active CONTACTED row (same channel, within 5-min window). Stale replies ignored.
 */
export async function handleAutomationReply(channelId: string, userId: string): Promise<boolean> {
  try {
    if (getAllAdminIds().includes(userId)) return false;
    const contact = await automationRepository.findActiveContact(channelId);
    if (!contact) return false;
    if (contact.workerId && contact.workerId !== userId) return false;
    await automationRepository.updateContactStatus(contact.id, 'CONFIRMED', new Date());
    logger.info('Automation contact confirmed', { contactId: contact.id, channelId, userId });
    return true;
  } catch (error) {
    logger.warn('handleAutomationReply failed', { channelId, userId, error });
    return false;
  }
}

export async function collectConfirmed(cycleId: string) {
  const contacts = await automationRepository.listCycleContacts(cycleId);
  return contacts
    .filter((c: { status: string }) => c.status === 'CONFIRMED')
    .sort((a: { respondedAt: Date | null }, b: { respondedAt: Date | null }) => (a.respondedAt?.getTime() || 0) - (b.respondedAt?.getTime() || 0));
}

export async function expireContacts(): Promise<void> {
  await automationRepository.expireDueContacts(new Date()).catch(() => undefined);
}
