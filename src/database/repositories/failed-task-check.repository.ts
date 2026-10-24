import { getDb } from '../db';
import { FailedTaskVerdict } from '../../utils/failed-task-check';

export interface FailedTaskCheckUpsertRow {
  externalTaskId: string;
  taskId: string | null;
  taskType: string | null;
  failedReason: string | null;
  reward: string | null;
  deadline: string | null;
  verdict: FailedTaskVerdict;
  taskStatus: string | null;
  cancelledReason: string | null;
  seenAt: Date;
}

/**
 * Persistence for the GoPartTime failed-task checker.
 *
 * `firstSeenAt` is written on insert only (the upsert's update branch never
 * touches it), which is what makes "new failure" unambiguous across scans.
 * The ownership guards for the DM live in `notifiedAt`: only rows that have
 * never been notified are eligible, and a successful send stamps them.
 */
export class FailedTaskCheckRepository {
  async findByExternalTaskIds(externalTaskIds: string[]) {
    if (!externalTaskIds.length) return [];
    return getDb().failedTaskCheck.findMany({
      where: { externalTaskId: { in: externalTaskIds } },
    });
  }

  /**
   * Upserts in bounded chunks so a 500-task scan cannot exceed the
   * interactive-transaction timeout or hog the connection pool.
   */
  async upsertMany(rows: FailedTaskCheckUpsertRow[]): Promise<void> {
    if (!rows.length) return;
    const db = getDb();
    const chunkSize = 50;
    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      await db.$transaction(
        chunk.map((row) =>
          db.failedTaskCheck.upsert({
            where: { externalTaskId: row.externalTaskId },
            create: {
              externalTaskId: row.externalTaskId,
              taskId: row.taskId,
              taskType: row.taskType,
              failedReason: row.failedReason,
              reward: row.reward,
              deadline: row.deadline,
              verdict: row.verdict,
              taskStatus: row.taskStatus,
              cancelledReason: row.cancelledReason,
              firstSeenAt: row.seenAt,
              lastSeenAt: row.seenAt,
              verdictAt: row.seenAt,
              createdAt: row.seenAt,
              updatedAt: row.seenAt,
            },
            update: {
              taskId: row.taskId,
              taskType: row.taskType,
              failedReason: row.failedReason,
              reward: row.reward,
              deadline: row.deadline,
              verdict: row.verdict,
              taskStatus: row.taskStatus,
              cancelledReason: row.cancelledReason,
              lastSeenAt: row.seenAt,
              verdictAt: row.seenAt,
              updatedAt: row.seenAt,
            },
          }),
        ),
        { timeout: 30000 },
      );
    }
  }

  /** Stamps the one-shot DM guard after Discord accepted the message. */
  async markNotified(externalTaskIds: string[], at: Date = new Date()) {
    if (!externalTaskIds.length) return;
    return getDb().failedTaskCheck.updateMany({
      where: { externalTaskId: { in: externalTaskIds }, notifiedAt: null },
      data: { notifiedAt: at, notifyError: null, updatedAt: at },
    });
  }

  /**
   * Keeps the row eligible for the next scan's DM retry. Deliberately does
   * not clear `notifiedAt` — only unnotified rows are ever passed here.
   */
  async markNotifyError(
    externalTaskIds: string[],
    error: string,
    at: Date = new Date(),
  ) {
    if (!externalTaskIds.length) return;
    return getDb().failedTaskCheck.updateMany({
      where: { externalTaskId: { in: externalTaskIds }, notifiedAt: null },
      data: { notifyError: error.slice(0, 1000), updatedAt: at },
    });
  }
}

export const failedTaskCheckRepository = new FailedTaskCheckRepository();
