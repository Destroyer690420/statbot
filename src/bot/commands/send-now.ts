import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { reminderService } from '../../services/reminder.service';
import { taskService } from '../../services/task.service';
import { cancelJob, scheduleReminderJob } from '../../scheduler/jobs';
import { isAdminOrManager, getPermissionDeniedMessage } from '../../utils/permissions';
import { errorEmbed, successEmbed } from '../embeds';
import { TaskStatus } from '../../types';
import { logger } from '../../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('send-now')
  .setDescription('Send a reminder immediately instead of waiting for its scheduled time')
  .addStringOption((opt) =>
    opt.setName('task_id')
      .setDescription('The Task ID')
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt.setName('reminder')
      .setDescription('Which reminder to send now')
      .setRequired(true)
      .addChoices(
        { name: '20 Hour', value: '20h' },
        { name: '70 Hour', value: '70h' },
      ),
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

    // Verify task exists
    const task = await taskService.findById(taskId);
    if (!task) {
      await interaction.editReply({ embeds: [errorEmbed('Task not found.')] });
      return;
    }

    // Check task is still active
    const terminalStates: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.ARCHIVED, TaskStatus.CANCELLED];
    if (terminalStates.includes(task.status)) {
      const label = task.status === TaskStatus.COMPLETED ? 'completed' : task.status === TaskStatus.CANCELLED ? 'cancelled' : 'archived';
      await interaction.editReply({ embeds: [errorEmbed(`Task **${taskId}** is already ${label}. Cannot send reminder.`)] });
      return;
    }

    // Find the target reminder
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

    // Cancel old job (if any)
    if (targetReminder.jobId) {
      await cancelJob(targetReminder.jobId);
    }

    // Also cancel any retry jobs for this reminder
    for (let i = 1; i <= 3; i++) {
      await cancelJob(`retry-${targetReminder.id}-${i}`);
    }

    // Reschedule to now
    const now = new Date();
    const updatedReminder = await reminderService.reschedule(targetReminder.id, now);

    // Schedule new job with no delay — fires immediately
    await scheduleReminderJob(updatedReminder);

    await interaction.editReply({
      embeds: [successEmbed(
        `Reminder for **${taskId}** (${reminderChoice === '20h' ? '20 Hour' : '70 Hour'}) is being sent now.`
      )],
    });

    logger.info('Send-now command executed', {
      taskId,
      reminderId: targetReminder.id,
      userId: interaction.user.id,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
    logger.error('Send-now command failed', { error });
  }
}
