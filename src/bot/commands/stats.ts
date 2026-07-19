import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { analyticsService } from '../../services/analytics.service';
import { isAdminOrManager, getPermissionDeniedMessage } from '../../utils/permissions';
import { statsEmbed, errorEmbed } from '../embeds';
import { logger } from '../../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Display task analytics and statistics');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdminOrManager(interaction.user.id)) {
    await interaction.reply({ embeds: [errorEmbed(getPermissionDeniedMessage())], ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    const guildId = interaction.guildId || undefined;
    const stats = await analyticsService.getStats(guildId);

    await interaction.editReply({ embeds: [statsEmbed(stats)] });
    logger.info('Stats command executed', { userId: interaction.user.id });

  } catch (error) {
    await interaction.editReply({ embeds: [errorEmbed('Internal server error.')] });
    logger.error('Stats command failed', { error });
  }
}
