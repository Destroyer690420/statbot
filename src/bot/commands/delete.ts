import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { taskService } from '../../services/task.service';
import { cancelTaskJobs } from '../../scheduler/jobs';
import { isAdmin, getPermissionDeniedMessage } from '../../utils/permissions';
import { errorEmbed, successEmbed } from '../embeds';
import { logger } from '../../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('delete')
  .setDescription('Delete a task and its reminders')
  .addStringOption((opt) =>
    opt.setName('task_id')
      .setDescription('The Task ID to delete')
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // Permission check
  if (!isAdmin(interaction.user.id)) {
    await interaction.reply({ embeds: [errorEmbed(getPermissionDeniedMessage())], ephemeral: true });
    return;
  }

  const taskId = interaction.options.getString('task_id', true);

  // Check if task exists
  const task = await taskService.findById(taskId);
  if (!task) {
    await interaction.reply({ embeds: [errorEmbed('Task not found.')], ephemeral: true });
    return;
  }

  // Confirmation button
  const confirmBtn = new ButtonBuilder()
    .setCustomId(`delete-confirm-${taskId}`)
    .setLabel('Confirm Delete')
    .setStyle(ButtonStyle.Danger);

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`delete-cancel-${taskId}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);

  const response = await interaction.reply({
    content: `⚠️ Are you sure you want to delete task **${taskId}**?\nType: ${task.type} | Assigned: <@${task.assignedUserId}> | Status: ${task.status}`,
    components: [row],
  });

  try {
    const confirmation = await response.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 30_000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    if (confirmation.customId === `delete-confirm-${taskId}`) {
      await confirmation.deferUpdate();

      // Cancel scheduled jobs
      await cancelTaskJobs(taskId);

      // Delete task and reminders from database
      await taskService.delete(taskId, interaction.user.id);

      await interaction.editReply({
        content: '',
        embeds: [successEmbed(`Task **${taskId}** has been deleted.`)],
        components: [],
      });

      logger.info('Task deleted via command', { taskId, userId: interaction.user.id });
    } else {
      await confirmation.deferUpdate();
      await interaction.editReply({
        content: 'Deletion cancelled.',
        components: [],
      });
    }
  } catch {
    await interaction.editReply({
      content: 'Confirmation timed out. Deletion cancelled.',
      components: [],
    });
  }
}
