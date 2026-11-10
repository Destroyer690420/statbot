import { SlashCommandBuilder, ChatInputCommandInteraction, AttachmentBuilder } from 'discord.js';
import path from 'path';
import { isAdminOrManager, getPermissionDeniedMessage } from '../../utils/permissions';
import { errorEmbed, successEmbed } from '../embeds';
import { logger } from '../../utils/logger';

/**
 * The reminder staff post in a ticket before a worker submits insights.
 * Kept as an exported constant so the wording is testable and identical
 * everywhere it is used.
 */
export const INSIGHTS_SCREENSHOT_GUIDE_MESSAGE =
  'when submitting insights please remember that in the insights screenshot the subreddit, title and view count of the post must be visible.\n\n' +
  'and if you have an Iphone and the post is too long then the last few paragraphs of the post and the view count must be visible.';

/**
 * Example screenshot shipped with the repo (Dockerfile already copies
 * `assets/` into the runtime image). Resolved from this file so it works both
 * from `src/` in dev/tests and from `dist/` in production.
 */
export const INSIGHTS_SCREENSHOT_EXAMPLE_PATH = path.resolve(
  __dirname,
  '../../../assets/images/insights-example.png',
);

export const data = new SlashCommandBuilder()
  .setName('insights-guide')
  .setDescription('Post the insights screenshot requirements with an example image');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdminOrManager(interaction.user.id)) {
    await interaction.reply({ embeds: [errorEmbed(getPermissionDeniedMessage())], ephemeral: true });
    return;
  }

  const channel = interaction.channel;
  if (!channel || !channel.isTextBased() || !('send' in channel)) {
    await interaction.reply({
      embeds: [errorEmbed('This command can only be used in a ticket channel.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const attachment = new AttachmentBuilder(INSIGHTS_SCREENSHOT_EXAMPLE_PATH, {
      name: 'insights-example.png',
    });

    await channel.send({
      content: INSIGHTS_SCREENSHOT_GUIDE_MESSAGE,
      files: [attachment],
      // The text mentions nobody; never ping roles/everyone by accident.
      allowedMentions: { parse: [] },
    });

    await interaction.editReply({
      embeds: [successEmbed('Insights screenshot guide sent in this ticket.')],
    });

    logger.info('Insights guide command executed', {
      userId: interaction.user.id,
      channelId: channel.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
    logger.error('Insights guide command failed', { error, channelId: channel.id });
  }
}
