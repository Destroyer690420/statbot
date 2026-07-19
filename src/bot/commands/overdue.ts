import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { taskService } from '../../services/task.service';
import { reminderService } from '../../services/reminder.service';
import { isAdmin, getPermissionDeniedMessage } from '../../utils/permissions';
import { errorEmbed } from '../embeds';
import { COLORS } from '../../config/constants';
import { logger } from '../../utils/logger';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export const data = new SlashCommandBuilder()
  .setName('overdue')
  .setDescription('Show overdue tasks sorted by longest overdue');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdmin(interaction.user.id)) {
    await interaction.reply({ embeds: [errorEmbed(getPermissionDeniedMessage())], ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    const tasks = await taskService.findOverdue();

    if (tasks.length === 0) {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('⏰ Overdue Tasks')
          .setDescription('No overdue tasks! 🎉')
          .setColor(COLORS.SUCCESS)
          .setTimestamp()],
      });
      return;
    }

    // Enrich tasks with overdue info and sort by actual duration
    const enriched: { task: typeof tasks[0]; overdueMs: number; reminderType: string; overdueLabel: string }[] = [];

    for (const task of tasks) {
      const reminders = await reminderService.findByTaskId(task.id);
      const waitingReminder = reminders.find((r) => r.sent && !r.completed);
      if (!waitingReminder) continue;

      const refTime = waitingReminder.sentAt || waitingReminder.dueAt;
      const overdueMs = Date.now() - refTime.getTime();
      const overdueLabel = dayjs(refTime).fromNow(true);
      const reminderType = waitingReminder.type.replace('_', ' ');

      enriched.push({ task, overdueMs, reminderType, overdueLabel });
    }

    // Sort by longest overdue first
    enriched.sort((a, b) => b.overdueMs - a.overdueMs);

    const lines = enriched.slice(0, 20).map((e) =>
      `🔴 \`${e.task.id}\` • <@${e.task.assignedUserId}> • <#${e.task.channelId}>\n` +
      `   Overdue: **${e.overdueLabel}** • Reminder: **${e.reminderType}**`
    );

    const embed = new EmbedBuilder()
      .setTitle(`⏰ Overdue Tasks (${tasks.length})`)
      .setDescription(lines.join('\n\n'))
      .setColor(COLORS.OVERDUE)
      .setTimestamp()
      .setFooter({ text: 'Sorted by longest overdue • Reddit Task Manager' });

    await interaction.editReply({ embeds: [embed] });
    logger.info('Overdue command executed', { userId: interaction.user.id, count: tasks.length });

  } catch (error) {
    await interaction.editReply({ embeds: [errorEmbed('Internal server error.')] });
    logger.error('Overdue command failed', { error });
  }
}
