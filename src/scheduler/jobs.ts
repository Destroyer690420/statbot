import { getQueue } from './queue';
import { Reminder, ReminderJobData } from '../types';
import { reminderService } from '../services/reminder.service';
import { RETRY_DELAYS } from '../config/constants';
import { logger } from '../utils/logger';

/**
 * Schedule a reminder job in BullMQ.
 * The job will fire at the reminder's dueAt time.
 */
export async function scheduleReminderJob(reminder: Reminder): Promise<string> {
  const queue = getQueue();
  const delay = Math.max(0, reminder.dueAt.getTime() - Date.now());

  const jobData: ReminderJobData = {
    taskId: reminder.taskId,
    reminderId: reminder.id,
    type: reminder.type,
    isRetry: false,
    retryCount: 0,
  };

  const job = await queue.add(
    `reminder-${reminder.id}`,
    jobData,
    {
      delay,
      jobId: `reminder-${reminder.id}`,
      removeOnComplete: true,
    },
  );

  // Update the reminder with the job ID
  await reminderService.updateJobId(reminder.id, job.id || '');

  logger.info('Reminder job scheduled', {
    reminderId: reminder.id,
    taskId: reminder.taskId,
    type: reminder.type,
    dueAt: reminder.dueAt.toISOString(),
    delayMs: delay,
  });

  return job.id || '';
}

/**
 * Schedule all reminders for a task.
 */
export async function scheduleAllReminders(reminders: Reminder[]): Promise<void> {
  for (const reminder of reminders) {
    await scheduleReminderJob(reminder);
  }
}

/**
 * Schedule a retry job for a reminder that wasn't completed.
 */
export async function scheduleRetryJob(
  reminder: Reminder,
  retryCount: number,
): Promise<string | null> {
  if (retryCount >= RETRY_DELAYS.length + 1) {
    logger.warn('Max retries reached for reminder', {
      reminderId: reminder.id,
      retryCount,
    });
    return null;
  }

  const queue = getQueue();
  const delayIndex = Math.min(retryCount - 1, RETRY_DELAYS.length - 1);
  const delay = RETRY_DELAYS[delayIndex];

  const jobData: ReminderJobData = {
    taskId: reminder.taskId,
    reminderId: reminder.id,
    type: reminder.type,
    isRetry: true,
    retryCount,
  };

  const jobId = `retry-${reminder.id}-${retryCount}`;

  const job = await queue.add(
    jobId,
    jobData,
    {
      delay,
      jobId,
      removeOnComplete: true,
    },
  );

  logger.info('Retry job scheduled', {
    reminderId: reminder.id,
    retryCount,
    delayMs: delay,
  });

  return job.id || '';
}

/**
 * Cancel a scheduled job by its ID.
 */
export async function cancelJob(jobId: string): Promise<boolean> {
  try {
    const queue = getQueue();
    const job = await queue.getJob(jobId);

    if (job) {
      await job.remove();
      logger.info('Job cancelled', { jobId });
      return true;
    }

    return false;
  } catch (error) {
    logger.error('Failed to cancel job', { jobId, error });
    return false;
  }
}

/**
 * Cancel all jobs for a task's reminders.
 */
export async function cancelTaskJobs(taskId: string): Promise<void> {
  const reminders = await reminderService.findByTaskId(taskId);

  for (const reminder of reminders) {
    if (reminder.jobId) {
      await cancelJob(reminder.jobId);
    }
    // Also try to cancel any retry jobs
    for (let i = 1; i <= 3; i++) {
      await cancelJob(`retry-${reminder.id}-${i}`);
    }
  }

  logger.info('All jobs cancelled for task', { taskId });
}
