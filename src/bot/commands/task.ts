import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
} from 'discord.js';
import { TaskType, CreateTaskInput } from '../../types';
import { taskService } from '../../services/task.service';
import { reminderService } from '../../services/reminder.service';
import { scheduleAllReminders } from '../../scheduler/jobs';
import { isAdminOrManager, getPermissionDeniedMessage } from '../../utils/permissions';
import { taskCreatedEmbed, errorEmbed } from '../embeds';
import { logger } from '../../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('task')
  .setDescription('Create a new Reddit task')
  .addStringOption((opt) =>
    opt.setName('task_id')
      .setDescription('Custom ID (uppercase letters, numbers, hyphens, underscores; 1-32 chars)')
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt.setName('reddit_url')
      .setDescription('The Reddit post or comment URL')
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt.setName('type')
      .setDescription('Type of Reddit content')
      .setRequired(true)
      .addChoices(
        { name: 'Post', value: TaskType.POST },
        { name: 'Comment', value: TaskType.COMMENT },
      ),
  )
  .addChannelOption((opt) =>
    opt.setName('ticket')
      .setDescription('Leave empty to auto-detect the current channel')
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildText),
  )
  .addUserOption((opt) =>
    opt.setName('assigned_user')
      .setDescription('Leave empty to auto-detect the non-bot user in this channel')
      .setRequired(false),
  )
  .addStringOption((opt) =>
    opt.setName('notes')
      .setDescription('Optional notes for this task (max 500 chars)')
      .setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdminOrManager(interaction.user.id)) {
    await interaction.reply({ embeds: [errorEmbed(getPermissionDeniedMessage())], ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    const redditUrl = interaction.options.getString('reddit_url', true);
    const type = interaction.options.getString('type', true) as TaskType;
    const customTaskId = interaction.options.getString('task_id', true);
    const notes = interaction.options.getString('notes');

    // ─── Auto-detect ticket channel ────────────────────────────
    let givenChannel = interaction.options.getChannel('ticket');
    if (!givenChannel) {
      if (interaction.channel?.type === ChannelType.GuildText) {
        givenChannel = interaction.channel;
      } else {
        await interaction.editReply({
          embeds: [errorEmbed('Run this command in a ticket channel, or provide the ticket option manually.')],
        });
        return;
      }
    }

    // ─── Auto-detect assigned user ─────────────────────────────
    let givenUser = interaction.options.getUser('assigned_user');
    if (!givenUser) {
      const channel = givenChannel as TextChannel;
      await channel.guild.members.fetch();
      const nonBotMembers = channel.members.filter((m) => !m.user.bot && m.id !== interaction.user.id);

      if (nonBotMembers.size === 0) {
        await interaction.editReply({
          embeds: [errorEmbed('Could not find a non-bot user in this channel. Use the assigned_user option manually.')],
        });
        return;
      }

      if (nonBotMembers.size > 1) {
        await interaction.editReply({
          embeds: [errorEmbed('Multiple non-bot users found. Use the assigned_user option to specify which one.')],
        });
        return;
      }

      givenUser = nonBotMembers.first()!.user;
    }

    const input: CreateTaskInput = {
      taskId: customTaskId.toUpperCase(),
      redditUrl,
      type,
      channelId: givenChannel.id,
      channelName: givenChannel.name || undefined,
      assignedUserId: givenUser.id,
      assignedUserName: givenUser.displayName,
      createdById: interaction.user.id,
      guildId: interaction.guildId || '',
      notes: notes || undefined,
    };

    // Create the task
    const task = await taskService.create(input);

    // Create reminders
    const reminders = await reminderService.createForTask(task.id, task.type, task.createdAt);

    // Schedule BullMQ jobs
    await scheduleAllReminders(reminders);

    // Reply with success embed
    await interaction.editReply({
      embeds: [taskCreatedEmbed(task, reminders.length)],
    });

    logger.info('Task command executed', {
      taskId: task.id,
      userId: interaction.user.id,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
    logger.error('Task command failed', { error, userId: interaction.user.id });
  }
}
