import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * The "add this ticket to the daily outreach" button shown on the in-ticket
 * profile-passed notice.
 *
 * Selection for the daily outreach is just `TicketOutreach.selected`, the same
 * field the dashboard checkbox writes, and it deliberately survives the IST day
 * rollover — so this button needs no new state of its own and cannot disagree
 * with what the dashboard shows.
 *
 * The ticket travels inside the custom id. Discord button ids are the only
 * durable per-message payload available (a button carries no state beyond its
 * id), and re-reading the onboarding row at click time cannot identify the
 * ticket, because one ticket holds exactly one such notice but a click gives no
 * other handle to it.
 */

/** Namespace for routing in `interactionCreate`. Must not collide with `blast:`. */
export const OUTREACH_ADD_BUTTON_PREFIX = 'outreach_add:';

export const OUTREACH_ADD_LABEL = 'add to daily outreach';

/** Shown after a successful add, so a live button never implies "not yet done". */
export const OUTREACH_ADDED_LABEL = 'on the daily outreach list';

/**
 * Reads the ticket channel id out of a button custom id.
 *
 * Returns null for anything else — including a `blast:` id. Callers must treat
 * null as "not mine" rather than defaulting to a channel, because a lost parse
 * that resolved to some other ticket would select a real worker's ticket into
 * the daily blast.
 */
export function parseOutreachAddId(customId: string): string | null {
  if (!customId || !customId.startsWith(OUTREACH_ADD_BUTTON_PREFIX)) return null;
  const channelId = customId.slice(OUTREACH_ADD_BUTTON_PREFIX.length);
  // Must be a bare snowflake. Slicing alone would accept `outreach_add:abc:def`
  // and hand back "abc:def" as a channel id — a nonsense id that fails deep in
  // Prisma instead of being rejected at the boundary where it is obviously
  // malformed. Digits-only is exactly Discord's channel id format.
  return /^\d{15,25}$/.test(channelId) ? channelId : null;
}

export function buildOutreachAddButton(
  channelId: string,
  opts: { added?: boolean } = {},
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${OUTREACH_ADD_BUTTON_PREFIX}${channelId}`)
        .setLabel(opts.added ? OUTREACH_ADDED_LABEL : OUTREACH_ADD_LABEL)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(opts.added === true),
    ),
  ];
}