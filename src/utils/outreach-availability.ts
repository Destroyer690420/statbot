import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * Availability buttons on the daily outreach message.
 *
 * The blast message used to rely on "any worker message = available", which
 * turned an unrelated screenshot or a passing reply into a claimed post. The
 * message now carries an explicit Yes / No decision, and only the Yes button
 * can mark a worker available or win a blast slot.
 *
 * The custom id carries the blast id so a click on a stale message can never
 * win a newer round: the handler resolves that exact blast and refuses when it
 * is not the open one (or never contacted the ticket).
 */

export const AVAILABILITY_BUTTON_PREFIX = 'outreach_avail';

export type AvailabilityAction = 'yes' | 'no';

/** `outreach_avail:<blastId>:<yes|no>` — well under Discord's 100-char limit. */
export function buildAvailabilityCustomId(blastId: string, action: AvailabilityAction): string {
  return `${AVAILABILITY_BUTTON_PREFIX}:${blastId}:${action}`;
}

/**
 * Parses a custom id. Returns null for anything that is not an availability
 * button, so the interaction router can fall through to the other flows.
 */
export function parseAvailabilityCustomId(
  customId: string,
): { blastId: string; action: AvailabilityAction } | null {
  const prefix = `${AVAILABILITY_BUTTON_PREFIX}:`;
  if (!customId.startsWith(prefix)) return null;
  const rest = customId.slice(prefix.length);
  const splitAt = rest.lastIndexOf(':');
  if (splitAt <= 0) return null;
  const blastId = rest.slice(0, splitAt);
  const action = rest.slice(splitAt + 1);
  if (!blastId) return null;
  if (action !== 'yes' && action !== 'no') return null;
  return { blastId, action };
}

/**
 * The two in-ticket buttons. Same message across every contacted ticket, so
 * the shared id is enough — the interaction's channel identifies the ticket.
 */
export function availabilityComponents(blastId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildAvailabilityCustomId(blastId, 'yes'))
        .setLabel('Yes')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(buildAvailabilityCustomId(blastId, 'no'))
        .setLabel('No')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

/**
 * One nudge per ticket per round when the worker types instead of tapping.
 * Text replies no longer claim anything, so the reminder points at the button
 * without ever awarding a post.
 */
export function availabilityTextNudge(userId: string): string {
  return (
    `👆 <@${userId}> to get this post, please tap **Yes** on the availability message above. ` +
    `A normal reply or a screenshot does not reserve it.`
  );
}

/**
 * Same worker rule the blast send uses: the first non-bot, non-staff member of
 * the ticket. Pure so the button gate is testable without a live Discord guild.
 */
export function pickTicketWorkerId(
  members: readonly { id: string; isBot: boolean }[],
  staffIds: readonly string[],
): string | null {
  const worker = members.find((member) => !member.isBot && !staffIds.includes(member.id));
  return worker ? worker.id : null;
}
