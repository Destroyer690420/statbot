import { Client } from 'discord.js';
import { OWNER_USER_ID } from '../config/constants';
import { failedTaskCheckRepository } from '../database/repositories';
import { logger } from '../utils/logger';
import {
  buildFailedTaskMismatchDm,
  classifyFailedTask,
  FailedTaskScanInput,
  FailedTaskVerdict,
} from '../utils/failed-task-check';
import { findTasksByExternalIds } from './goparttime-task-resolver.service';

export class FailedTaskScanInProgressError extends Error {
  constructor() {
    super('A failed-task scan is already running. Wait for it to finish.');
    this.name = 'FailedTaskScanInProgressError';
  }
}

export interface FailedTaskCheckMismatch {
  externalTaskId: string;
  taskId: string | null;
  taskType: string | null;
  failedReason: string | null;
  reward: string | null;
  deadline: string | null;
  taskStatus: string | null;
  isNew: boolean;
  notifiedAt: string | null;
}

export interface FailedTaskScanResult {
  scanned: number;
  newTasks: number;
  counts: Record<FailedTaskVerdict, number>;
  mismatches: FailedTaskCheckMismatch[];
  notFound: string[];
  newMismatchIds: string[];
  dm: { sent: boolean; error: string | null };
  pagesScanned: number | null;
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim();
  return trimmed || null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Orchestrates one failed-page scan:
 *
 *   1. dedupe the cards the userscript collected,
 *   2. resolve every GoPartTime number to its Statbot row in two batch queries,
 *   3. classify and upsert (firstSeenAt makes "new" unambiguous),
 *   4. DM the owner once for every currently-unnotified MISMATCH,
 *   5. stamp notifiedAt only after Discord accepted the message.
 *
 * The DM is deliberately a review list, not an automatic report: the script
 * never clicks GoPartTime's Feedback button. DB-only verdicts are the chosen
 * rule, so the wording asks the owner to verify before reporting.
 */
export class FailedTaskCheckService {
  private scanInFlight = false;

  async scan(
    input: FailedTaskScanInput,
    discordClient: Client | null,
  ): Promise<FailedTaskScanResult> {
    if (this.scanInFlight) throw new FailedTaskScanInProgressError();
    this.scanInFlight = true;
    try {
      const now = new Date();
      const unique = new Map<string, (typeof input.tasks)[number]>();
      for (const item of input.tasks) {
        if (!unique.has(item.externalTaskId)) unique.set(item.externalTaskId, item);
      }

      const ids = Array.from(unique.keys());
      const existingRows = await failedTaskCheckRepository.findByExternalTaskIds(ids);
      const existingById = new Map(existingRows.map((row) => [row.externalTaskId, row]));
      const resolved = await findTasksByExternalIds(ids);

      const counts: Record<FailedTaskVerdict, number> = {
        MISMATCH: 0,
        DELETED: 0,
        NOT_COMPARABLE: 0,
        NOT_FOUND: 0,
      };
      const rows: Parameters<typeof failedTaskCheckRepository.upsertMany>[0] = [];
      const mismatches: FailedTaskCheckMismatch[] = [];
      const notFound: string[] = [];
      let newTasks = 0;

      for (const [externalTaskId, item] of unique) {
        const task = resolved.get(externalTaskId) ?? null;
        const cancelledReason = normalizeOptional(task?.cancelledReason);
        const verdict = classifyFailedTask(
          task
            ? {
                status: String(task.status),
                cancelledReason,
                submittedRedditUrl: task.submittedRedditUrl,
                redditUrl: task.redditUrl,
              }
            : null,
        );
        counts[verdict] += 1;

        const existing = existingById.get(externalTaskId);
        if (!existing) newTasks += 1;

        // The resolved Task row is authoritative. The browser's card heading
        // is only a hint for NOT_FOUND rows, where nothing else can supply a
        // type, so a changed card layout can never mislabel a real task.
        const taskType = task?.type
          ? String(task.type).toLowerCase()
          : item.type || null;
        const failedReason = normalizeOptional(item.failedReason);
        const reward = normalizeOptional(item.reward);
        const deadline = normalizeOptional(item.deadline);
        const taskStatus = task ? String(task.status) : null;

        rows.push({
          externalTaskId,
          taskId: task?.id ?? null,
          taskType,
          failedReason,
          reward,
          deadline,
          verdict,
          taskStatus,
          cancelledReason,
          seenAt: now,
        });

        if (verdict === 'MISMATCH') {
          mismatches.push({
            externalTaskId,
            taskId: task?.id ?? null,
            taskType,
            failedReason,
            reward,
            deadline,
            taskStatus,
            isNew: !existing,
            notifiedAt: existing?.notifiedAt ? existing.notifiedAt.toISOString() : null,
          });
        } else if (verdict === 'NOT_FOUND') {
          notFound.push(externalTaskId);
        }
      }

      if (rows.length) await failedTaskCheckRepository.upsertMany(rows);

      const unnotified = mismatches.filter((row) => !row.notifiedAt);
      let dm: { sent: boolean; error: string | null } = { sent: false, error: null };

      if (unnotified.length > 0) {
        const message = buildFailedTaskMismatchDm(
          unnotified.map((row) => ({
            externalTaskId: row.externalTaskId,
            taskType: row.taskType,
            taskStatus: row.taskStatus,
            reward: row.reward,
          })),
        );

        if (!message) {
          dm.error = 'Nothing to send.';
        } else if (!discordClient) {
          dm.error = 'Discord client unavailable.';
        } else {
          try {
            const owner = await discordClient.users.fetch(OWNER_USER_ID);
            await owner.send({ content: message });
            await failedTaskCheckRepository.markNotified(
              unnotified.map((row) => row.externalTaskId),
              now,
            );
            dm.sent = true;
            for (const row of unnotified) row.notifiedAt = now.toISOString();
            logger.info('Failed-task mismatch DM sent', {
              count: unnotified.length,
              taskIds: unnotified.map((row) => row.externalTaskId),
            });
          } catch (error) {
            dm.error = errorMessage(error);
            logger.warn('Failed-task mismatch DM failed (will retry next scan)', {
              count: unnotified.length,
              error: dm.error,
            });
            await failedTaskCheckRepository
              .markNotifyError(
                unnotified.map((row) => row.externalTaskId),
                dm.error,
                now,
              )
              .catch(() => undefined);
          }
        }
      }

      return {
        scanned: unique.size,
        newTasks,
        counts,
        mismatches,
        notFound,
        newMismatchIds: unnotified.map((row) => row.externalTaskId),
        dm,
        pagesScanned: input.pagesScanned ?? null,
      };
    } finally {
      this.scanInFlight = false;
    }
  }
}

export const failedTaskCheckService = new FailedTaskCheckService();
