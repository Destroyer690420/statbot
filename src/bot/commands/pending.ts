import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { TaskStatus } from '../../types';
import { taskService } from '../../services/task.service';
import { isAdmin, getPermissionDeniedMessage } from '../../utils/permissions';
import { taskListEmbed, errorEmbed } from '../embeds';
import { logger } from '../../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('pending')
  .setDescription('Show all pending and overdue tasks');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdmin(interaction.user.id)) {
    await interaction.reply({ embeds: [errorEmbed(getPermissionDeniedMessage())], ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    const guildId = interaction.guildId || undefined;

    // Gather tasks in non-terminal, non-completed states
    const pendingStatuses = [
      TaskStatus.PENDING,
      TaskStatus.REMINDER_20_SENT,
      TaskStatus.INSIGHT_20_RECEIVED,
      TaskStatus.REMINDER_70_SENT,
      TaskStatus.INSIGHT_70_RECEIVED,
    ];

    const allPending: Awaited<ReturnType<typeof taskService.findByStatus>>[] = [];
    for (const status of pendingStatuses) {
      const tasks = await taskService.findByStatus(status, guildId);
      allPending.push(tasks);
    }

    const tasks = allPending.flat().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const embed = taskListEmbed(
      `⏳ Pending Tasks (${tasks.length})`,
      tasks.slice(0, 20),
      1,
      Math.max(1, Math.ceil(tasks.length / 20)),
    );

    await interaction.editReply({ embeds: [embed] });

    logger.info('Pending command executed', { userId: interaction.user.id, count: tasks.length });

  } catch (error) {
    await interaction.editReply({ embeds: [errorEmbed('Internal server error.')] });
    logger.error('Pending command failed', { error });
  }
}
