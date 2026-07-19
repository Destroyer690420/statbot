import { Interaction, ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../../utils/logger';
import { auditLogService } from '../../services/audit.service';
import { AuditAction } from '../../types';

// Import all commands
import * as taskCmd from '../commands/task';
import * as statusCmd from '../commands/status';
import * as findCmd from '../commands/find';
import * as deleteCmd from '../commands/delete';
import * as pendingCmd from '../commands/pending';
import * as completedCmd from '../commands/completed';
import * as overdueCmd from '../commands/overdue';
import * as statsCmd from '../commands/stats';
import * as rescheduleCmd from '../commands/reschedule';
import * as helpCmd from '../commands/help';

const commands = new Map<string, { execute: (interaction: ChatInputCommandInteraction) => Promise<void> }>();
commands.set('task', taskCmd);
commands.set('status', statusCmd);
commands.set('find', findCmd);
commands.set('delete', deleteCmd);
commands.set('pending', pendingCmd);
commands.set('completed', completedCmd);
commands.set('overdue', overdueCmd);
commands.set('stats', statsCmd);
commands.set('reschedule', rescheduleCmd);
commands.set('help', helpCmd);

/**
 * Handle interactionCreate event — route slash commands.
 */
export async function handleInteractionCreate(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) {
    logger.warn('Unknown command received', { command: interaction.commandName });
    return;
  }

  try {
    logger.info('Command executed', {
      command: interaction.commandName,
      userId: interaction.user.id,
      guildId: interaction.guildId,
    });

    await auditLogService.log(
      AuditAction.COMMAND_USED,
      null,
      interaction.user.id,
      `/${interaction.commandName}`,
    );

    await command.execute(interaction);

  } catch (error) {
    logger.error('Command execution failed', {
      command: interaction.commandName,
      error,
    });

    const reply = {
      content: '❌ An error occurred while executing this command.',
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
}
