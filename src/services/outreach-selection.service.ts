import { ButtonInteraction } from 'discord.js';
import { outreachRepository } from '../database/repositories';
import { REDDIT_PROFILE_APPROVAL_ADMIN_ID } from '../config/constants';
import { auditLogService } from './audit.service';
import { AuditAction } from '../types';
import { logger } from '../utils/logger';
import { isAdmin } from '../utils/permissions';
import {
  buildOutreachAddButton,
  OUTREACH_ADDED_LABEL,
  OUTREACH_ADD_LABEL,
  parseOutreachAddId,
} from '../utils/outreach-add-button';

/**
 * Handles the "add to daily outreach" button that rides on the in-ticket
 * profile-passed notice.
 *
 * The write is `TicketOutreach.selected = true` — byte-for-byte the same
 * upsert the dashboard's checkbox issues. That field is already the source of
 * truth for daily outreach (it survives the IST day rollover and is what
 * `POST /outreach/send` broadcasts to), so this path has no state of its own to
 * drift out of sync with the page the approver can also open.
 *
 * Permission is deliberately narrow: the approver who is told about a passing
 * profile, or an admin. The button is rendered in the ticket, which means the
 * worker whose profile passed is looking straight at it — so a click from
 * anyone else is refused and writes nothing.
 */

/** Refusal shown to a non-approver who clicked the button. */
const DENIED_MESSAGE = 'only admins can add a ticket to the daily outreach.';

const ALREADY_ADDED_MESSAGE =
  `already on the daily outreach list ✅ this ticket is selected — it will be messaged on the next outreach run.`;

const ADDED_MESSAGE =
  `added to the daily outreach list ✅ this ticket is selected — it will be messaged on the next outreach run.`;

/**
 * Only the configured approver or an admin may write.
 *
 * `isAdmin` reads the same ADMIN_USER_IDS the rest of the bot uses, so the
 * approver set can be widened in env without a code change. Managers and
 * moderators are excluded on purpose: the owner chose the narrow gate.
 */
function mayAddToOutreach(userId: string): boolean {
  return userId === REDDIT_PROFILE_APPROVAL_ADMIN_ID || isAdmin(userId);
}

async function editReplySafe(
  interaction: ButtonInteraction,
  content: string,
  added: boolean,
  channelId: string,
): Promise<void> {
  try {
    await interaction.editReply({
      content,
      components: buildOutreachAddButton(channelId, { added }),
    });
  } catch (error) {
    // The selection is already committed at this point, so a failed edit is
    // cosmetic: the button stays live and a second click is an idempotent
    // no-op. Never let it surface as an unhandled rejection.
    logger.warn('Outreach add-button reply edit failed', {
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handles `outreach_add:*` buttons.
 *
 * Returns true whenever the id belonged to this flow — including on refusal,
 * unreadable ids and internal errors — so the caller never routes the same
 * click into another handler. Never throws.
 */
export async function handleOutreachAddButton(interaction: ButtonInteraction): Promise<boolean> {
  const channelId = parseOutreachAddId(interaction.customId);

  if (!channelId) {
    // An unreadable id used to be silently ignored elsewhere, which Discord
    // surfaces to the user as "this interaction failed". Say something, and
    // claim the interaction so nothing else picks it up.
    logger.warn('Outreach add-button id unreadable', { customId: interaction.customId });
    try {
      await interaction.reply({
        content: 'That button could not be read — please ask an admin to add the ticket from the dashboard.',
        ephemeral: interaction.guildId !== null,
      });
    } catch {
      // ignore — a failed fallback reply must not break the handler
    }
    return true;
  }

  if (!mayAddToOutreach(interaction.user.id)) {
    try {
      // Ephemeral is guild-only; in a DM fall back to a normal reply.
      await interaction.reply({ content: DENIED_MESSAGE, ephemeral: interaction.guildId !== null });
    } catch {
      // ignore
    }
    logger.info('Outreach add-button refused: not an approver', {
      channelId,
      userId: interaction.user.id,
    });
    return true;
  }

  try {
    await interaction.deferUpdate();
  } catch (error) {
    logger.warn('Outreach add-button defer failed', {
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }

  try {
    // Idempotency check. A failed read is treated as "not selected" rather
    // than blocking the write: the upsert is idempotent, so attempting it is
    // safe, and stranding a legitimate approver on a dead button is worse than
    // re-writing a value that is already true.
    const existing = await outreachRepository.findByChannelId(channelId).catch(() => null);
    if (existing?.selected) {
      await editReplySafe(interaction, ALREADY_ADDED_MESSAGE, true, channelId);
      return true;
    }

    await outreachRepository.upsertSelection([{ channelId, selected: true }]);

    await auditLogService
      .log(
        AuditAction.OUTREACH_TICKET_ADDED,
        null,
        interaction.user.id,
        `Ticket ${channelId} added to the daily outreach from its in-ticket button`,
      )
      .catch((error) => {
        // The write already happened; losing the audit row must not undo or
        // hide it from the approver.
        logger.warn('Outreach add-button audit failed', {
          channelId,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    await editReplySafe(interaction, ADDED_MESSAGE, true, channelId);
    logger.info('Ticket added to the daily outreach from its ticket button', {
      channelId,
      userId: interaction.user.id,
    });
    return true;
  } catch (error) {
    logger.error('Outreach add-button handling failed', {
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
    // The button is re-enabled (added: false) so the approver can retry.
    await editReplySafe(
      interaction,
      'could not add this ticket to the daily outreach — please try again.',
      false,
      channelId,
    );
    return true;
  }
}

export { OUTREACH_ADD_LABEL, OUTREACH_ADDED_LABEL };