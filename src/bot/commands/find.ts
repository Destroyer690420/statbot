import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
} from 'discord.js';
import { TaskStatus, TaskType, TaskFilters } from '../../types';
import { taskService } from '../../services/task.service';
import { taskListEmbed, errorEmbed } from '../embeds';
import { logger } from '../../utils/logger';
import { MAX_SEARCH_RESULTS } from '../../config/constants';

export const data = new SlashCommandBuilder()
  .setName('find')
  .setDescription('Search tasks with filters')
  .addStringOption((opt) =>
    opt.setName('task_id')
      .setDescription('Search by Task ID')
      .setRequired(false),
  )
  .addStringOption((opt) =>
    opt.setName('status')
      .setDescription('Filter by status')
      .setRequired(false)
      .addChoices(
        { name: 'Pending', value: TaskStatus.PENDING },
        { name: 'Reminder 20H Sent', value: TaskStatus.REMINDER_20_SENT },
        { name: 'Insight 20H Received', value: TaskStatus.INSIGHT_20_RECEIVED },
        { name: 'Reminder 70H Sent', value: TaskStatus.REMINDER_70_SENT },
        { name: 'Completed', value: TaskStatus.COMPLETED },
        { name: 'Archived', value: TaskStatus.ARCHIVED },
        { name: 'Cancelled', value: TaskStatus.CANCELLED },
      ),
  )
  .addStringOption((opt) =>
    opt.setName('type')
      .setDescription('Filter by type')
      .setRequired(false)
      .addChoices(
        { name: 'Post', value: TaskType.POST },
        { name: 'Comment', value: TaskType.COMMENT },
      ),
  )
  .addUserOption((opt) =>
    opt.setName('user')
      .setDescription('Filter by assigned user')
      .setRequired(false),
  )
  .addChannelOption((opt) =>
    opt.setName('ticket')
      .setDescription('Filter by ticket channel')
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildText),
  )
  .addStringOption((opt) =>
    opt.setName('reddit_url')
      .setDescription('Search by Reddit URL (partial match)')
      .setRequired(false),
  )
  .addIntegerOption((opt) =>
    opt.setName('page')
      .setDescription('Page number (default: 1)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(50),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const filters: TaskFilters = {};

    const taskId = interaction.options.getString('task_id');
    const status = interaction.options.getString('status');
    const type = interaction.options.getString('type');
    const user = interaction.options.getUser('user');
    const ticket = interaction.options.getChannel('ticket');
    const redditUrl = interaction.options.getString('reddit_url');
    const page = interaction.options.getInteger('page') || 1;

    if (taskId) filters.taskId = taskId.toUpperCase();
    if (status) filters.status = status as TaskStatus;
    if (type) filters.type = type as TaskType;
    if (user) filters.assignedUserId = user.id;
    if (ticket) filters.channelId = ticket.id;
    if (redditUrl) filters.redditUrl = redditUrl;

    const tasks = await taskService.search(filters, MAX_SEARCH_RESULTS + 1, page);
    const hasMore = tasks.length > MAX_SEARCH_RESULTS;
    if (hasMore) {
      tasks.pop();
    }
    const totalPages = hasMore ? page + 1 : page;

    const embed = taskListEmbed(
      `🔍 Search Results`,
      tasks,
      page,
      totalPages,
    );

    await interaction.editReply({ embeds: [embed] });

    logger.info('Find command executed', {
      userId: interaction.user.id,
      resultCount: tasks.length,
      page,
    });

  } catch (error) {
    await interaction.editReply({ embeds: [errorEmbed('Internal server error.')] });
    logger.error('Find command failed', { error });
  }
}
