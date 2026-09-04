import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { memberStatsService } from '../../services/member-stats.service';
import { isAdminOrManager, getPermissionDeniedMessage } from '../../utils/permissions';
import { inviterStatsEmbed, warningEmbed, errorEmbed } from '../embeds';
import { logger } from '../../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('myinvites')
  .setDescription('Check your invites: tickets, task progress and bonus (or anyone as admin)')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Look up another member (admins only)').setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const lookup = interaction.options.getUser('user');
  if (lookup && !isAdminOrManager(interaction.user.id)) {
    await interaction.reply({ embeds: [errorEmbed(getPermissionDeniedMessage())] });
    return;
  }

  const target = lookup ?? interaction.user;
  await interaction.deferReply();

  try {
    const stats = await memberStatsService.getInviterStats(target.id);
    if (!stats) {
      await interaction.editReply({ embeds: [warningEmbed(`No invites found for <@${target.id}> yet.`)] });
      return;
    }

    await interaction.editReply({ embeds: [inviterStatsEmbed(stats)] });
    logger.info('Myinvites command executed', { userId: interaction.user.id, targetId: target.id });
  } catch (error) {
    await interaction.editReply({ embeds: [errorEmbed('Internal server error.')] });
    logger.error('Myinvites command failed', { error });
  }
}
