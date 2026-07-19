import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { helpEmbed } from '../embeds';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show all available commands and usage');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ embeds: [helpEmbed()], ephemeral: true });
}
