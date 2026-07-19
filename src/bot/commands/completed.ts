import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { taskService } from '../../services/task.service';
import { isAdmin, getPermissionDeniedMessage } from '../../utils/permissions';
import { taskListEmbed, errorEmbed } from '../embeds';
import { logger } from '../../utils/logger';
import dayjs from 'dayjs';

export const data = new SlashCommandBuilder()
  .setName('completed')
  .setDescription('Show completed tasks')
  .addStringOption((opt) =>
    opt.setName('period')
      .setDescription('Time period to filter')
      .setRequired(false)
      .addChoices(
        { name: 'Today', value: 'today' },
        { name: 'Last 7 Days', value: '7days' },
        { name: 'Last 30 Days', value: '30days' },
        { name: 'All Time', value: 'all' },
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdmin(interaction.user.id)) {
    await interaction.reply({ embeds: [errorEmbed(getPermissionDeniedMessage())], ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    const period = interaction.options.getString('period') || '7days';

    let dateFrom: Date | undefined;
    const now = dayjs();

    switch (period) {
      case 'today':
        dateFrom = now.startOf('day').toDate();
        break;
      case '7days':
        dateFrom = now.subtract(7, 'day').toDate();
        break;
      case '30days':
        dateFrom = now.subtract(30, 'day').toDate();
        break;
      case 'all':
        dateFrom = undefined;
        break;
    }

    const tasks = await taskService.findCompleted(dateFrom);

    const periodLabel = period === 'today' ? 'Today'
      : period === '7days' ? 'Last 7 Days'
      : period === '30days' ? 'Last 30 Days'
      : 'All Time';

    const embed = taskListEmbed(
      `✅ Completed Tasks — ${periodLabel} (${tasks.length})`,
      tasks.slice(0, 20),
      1,
      Math.max(1, Math.ceil(tasks.length / 20)),
    );

    await interaction.editReply({ embeds: [embed] });
    logger.info('Completed command executed', { userId: interaction.user.id, period, count: tasks.length });

  } catch (error) {
    await interaction.editReply({ embeds: [errorEmbed('Internal server error.')] });
    logger.error('Completed command failed', { error });
  }
}
