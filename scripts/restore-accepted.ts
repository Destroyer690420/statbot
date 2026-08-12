import { initializeDatabase, getDb } from '../src/database/db';
import { initializeQueue } from '../src/scheduler/queue';
import { reminderService } from '../src/services/reminder.service';
import { scheduleAllReminders } from '../src/scheduler/jobs';
import { logger } from '../src/utils/logger';
import { TaskStatus, AuditAction, TaskType } from '../src/types';

/**
 * One-off recovery tool (2026-08-12): restores GoPartTime tasks that were
 * wrongly reverted to ACCEPTED (and stripped of their reminders) when the
 * one-time backfill inside prisma/migrations/migration.sql was re-run during
 * a deploy (the backfill has since been removed from the migration file).
 *
 * A task qualifies if it is goparttime-sourced, currently ACCEPTED, and has a
 * TASK_ACCEPTED audit event (i.e. it had been activated via "Done").
 * Restore = status back to PENDING + reminders recreated and scheduled exactly
 * like the activation flow (goparttimeService.activateTask).
 *
 * Safe to re-run: existing reminders are deleted first and BullMQ job ids are
 * deterministic (queue.add upserts). The reminder worker skips tasks that
 * carry a cancelledReason, so deleted tasks are restored harmlessly.
 *
 * Usage: npx tsx scripts/restore-accepted.ts
 */
async function main(): Promise<void> {
  initializeDatabase();
  initializeQueue();
  const db = getDb();

  const victims = await db.task.findMany({
    where: {
      source: 'goparttime',
      status: TaskStatus.ACCEPTED,
      auditLogs: { some: { action: AuditAction.TASK_ACCEPTED } },
    },
  });

  logger.info(`Found ${victims.length} wrongly-reverted task(s)`);

  let restored = 0;
  for (const task of victims) {
    await db.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.PENDING, updatedAt: new Date() },
    });

    await db.reminder.deleteMany({ where: { taskId: task.id } });

    const reminders = await reminderService.createForTask(
      task.id,
      task.type as TaskType,
      task.createdAt,
    );
    await scheduleAllReminders(reminders);

    restored++;
    logger.info(`Restored ${task.id} (${task.type}) -> PENDING, ${reminders.length} reminder(s) scheduled`);
  }

  logger.info(`Done: ${restored}/${victims.length} task(s) restored`);
  process.exit(0);
}

main().catch((err) => {
  logger.error('Restore failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
