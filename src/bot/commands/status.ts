import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { taskService } from '../../services/task.service';
import { reminderService } from '../../services/reminder.service';
import { taskStatusEmbed, errorEmbed } from '../embeds';
import { logger } from '../../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('View the status of a task')
  .addStringOption((opt) =>
    opt.setName('task_id')
      .setDescription('The Task ID (e.g. TSK-XXXXXXXX)')
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const taskId = interaction.options.getString('task_id', true);

    const task = await taskService.findById(taskId);
    if (!task) {
      await interaction.editReply({ embeds: [errorEmbed('Task not found.')] });
      return;
    }

    const reminders = await reminderService.findByTaskId(taskId);

    await interaction.editReply({
      embeds: [taskStatusEmbed(task, reminders)],
    });

    logger.info('Status command executed', { taskId, userId: interaction.user.id });

  } catch (error) {
    await interaction.editReply({ embeds: [errorEmbed('Internal server error.')] });
    logger.error('Status command failed', { error });
  }
}
