import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { reminderService } from '../../services/reminder.service';
import { taskService } from '../../services/task.service';
import { cancelJob, scheduleReminderJob } from '../../scheduler/jobs';
import { isAdminOrManager, getPermissionDeniedMessage } from '../../utils/permissions';
import { errorEmbed, successEmbed } from '../embeds';
import { logger } from '../../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('reschedule')
  .setDescription('Reschedule a task reminder')
  .addStringOption((opt) =>
    opt.setName('task_id')
      .setDescription('The Task ID')
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt.setName('reminder')
      .setDescription('Which reminder to reschedule')
      .setRequired(true)
      .addChoices(
        { name: '20 Hour', value: '20h' },
        { name: '70 Hour', value: '70h' },
      ),
  )
  .addIntegerOption((opt) =>
    opt.setName('hours')
      .setDescription('New delay in hours from now')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(168),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdminOrManager(interaction.user.id)) {
    await interaction.reply({ embeds: [errorEmbed(getPermissionDeniedMessage())], ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    const taskId = interaction.options.getString('task_id', true);
    const reminderChoice = interaction.options.getString('reminder', true);
    const hours = interaction.options.getInteger('hours', true);

    // Verify task exists
    const task = await taskService.findById(taskId);
    if (!task) {
      await interaction.editReply({ embeds: [errorEmbed('Task not found.')] });
      return;
    }

    // Get reminders for the task
    const reminders = await reminderService.findByTaskId(taskId);
    const targetReminder = reminders.find((r) => {
      if (reminderChoice === '20h') {
        return r.type.includes('20H');
      }
      return r.type.includes('70H');
    });

    if (!targetReminder) {
      await interaction.editReply({ embeds: [errorEmbed('Reminder not found for this task.')] });
      return;
    }

    if (targetReminder.completed) {
      await interaction.editReply({ embeds: [errorEmbed('This reminder is already completed.')] });
      return;
    }

    // Cancel old job
    if (targetReminder.jobId) {
      await cancelJob(targetReminder.jobId);
    }

    // Reschedule
    const newDueAt = new Date(Date.now() + hours * 60 * 60 * 1000);
    const updatedReminder = await reminderService.reschedule(targetReminder.id, newDueAt);

    // Schedule new job
    await scheduleReminderJob(updatedReminder);

    await interaction.editReply({
      embeds: [successEmbed(
        `Reminder for **${taskId}** rescheduled to **${hours}h** from now.\n` +
        `New time: <t:${Math.floor(newDueAt.getTime() / 1000)}:F>`
      )],
    });

    logger.info('Reschedule command executed', {
      taskId,
      reminderId: targetReminder.id,
      newHours: hours,
      userId: interaction.user.id,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
    logger.error('Reschedule command failed', { error });
  }
}
