import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { commissionService } from '../../services/commission.service';
import { isAdmin } from '../../utils/permissions';
import { successEmbed, errorEmbed } from '../embeds';

const SPECIAL_INVITER_IDS = [
  '582595416294555649',
  '1202294567706316911',
  '1506900129792135211',
];

export const data = new SlashCommandBuilder()
  .setName('referral')
  .setDescription('Manage referral links')
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Add a referral link (admin only)')
      .addUserOption((opt) =>
        opt.setName('inviter').setDescription('The inviter').setRequired(true),
      )
      .addUserOption((opt) =>
        opt.setName('invitee').setDescription('The invited user').setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName('ticket').setDescription('Ticket channel name (e.g. ticket-0036)').setRequired(true),
      ),
  )

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdmin(interaction.user.id)) {
    await interaction.reply({ embeds: [errorEmbed('You do not have permission to use this command.')], ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'add') {
    const inviter = interaction.options.getUser('inviter', true);
    const invitee = interaction.options.getUser('invitee', true);
    const ticket = interaction.options.getString('ticket', true);
    const type = SPECIAL_INVITER_IDS.includes(inviter.id) ? 'special' : 'normal';

    if (inviter.id === invitee.id) {
      await interaction.reply({ embeds: [errorEmbed('Inviter and invitee cannot be the same.')], ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const referral = await commissionService.createReferral(
        {
          inviterId: inviter.id,
          inviterName: inviter.username,
          inviteeId: invitee.id,
          inviteeName: invitee.username,
          inviterType: type,
          ticketId: ticket,
        },
        interaction.user.id,
      );

      const description = [
        `**Referral ID:** \`${referral.id}\``,
        `**Inviter:** <@${inviter.id}> (${type})`,
        `**Invitee:** <@${invitee.id}>`,
        `**Ticket:** \`${ticket}\``,
      ].join('\n');

      await interaction.editReply({ embeds: [successEmbed(`Referral added.\n${description}`)] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error.';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  }
}
