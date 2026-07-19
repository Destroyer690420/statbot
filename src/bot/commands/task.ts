import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
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
      .setDescription('The ticket channel for this task')
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildText),
  )
  .addUserOption((opt) =>
    opt.setName('assigned_user')
      .setDescription('The user to assign this task to')
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt.setName('notes')
      .setDescription('Optional notes for this task (max 500 chars)')
      .setRequired(false),
  )
  .addStringOption((opt) =>
    opt.setName('task_id')
      .setDescription('Custom ID (uppercase letters, numbers, hyphens, underscores; 1-32 chars)')
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
    const ticket = interaction.options.getChannel('ticket', true);
    const assignedUser = interaction.options.getUser('assigned_user', true);
    const notes = interaction.options.getString('notes');
    const customTaskId = interaction.options.getString('task_id');

    const input: CreateTaskInput = {
      taskId: customTaskId?.toUpperCase(),
      redditUrl,
      type,
      channelId: ticket.id,
      assignedUserId: assignedUser.id,
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
