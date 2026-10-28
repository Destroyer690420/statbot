import { Router, Request, Response } from 'express';
import { Client } from 'discord.js';
import { z } from 'zod';
import { goparttimeService } from '../../services/goparttime.service';
import { goPartTimePayloadSchema } from '../../utils/goparttime-payload';
import { extensionAuth } from '../middleware/extensionAuth';
import { validateBody } from '../middleware/validate';
import { redditSessionService } from '../../services/reddit-session.service';
import { logger } from '../../utils/logger';
import { reminderService } from '../../services/reminder.service';
import { resolveInsightReminder } from '../../services/goparttime-insight.service';
import { resolveSubmittedRedditUrl } from '../../services/goparttime-task-lookup.service';
import { findTaskByExternalId } from '../../services/goparttime-task-resolver.service';
import {
  FailedTaskScanInProgressError,
  failedTaskCheckService,
} from '../../services/failed-task-check.service';
import { failedTaskScanSchema } from '../../utils/failed-task-check';
import {
  leaseSubmissionJob,
  pendingSubmissionJobs,
  reportSubmissionResult,
} from '../../services/submission.service';
import {
  leaseFeedbackJob,
  pendingFeedbackJobs,
  reportFeedbackResult,
} from '../../services/feedback.service';

/**
 * Endpoints used by the GoPartTime browser extension. Authenticated with the
 * shared extension token (GOPARTTIME_API_KEY) — the equivalent of the
 * dashboard JWT for this external client.
 */
export default function createGoPartTimeRoutes(discordClient: Client): Router {
  const router = Router();

  router.use(extensionAuth);

  /**
   * POST /api/v1/goparttime/failed-tasks/scan
   * Receives every card the manager-browser script collected from
   * /my-tasks/failed, resolves each task number against Statbot, and returns
   * per-task verdicts. New MISMATCH rows (Statbot OK, GoPartTime Failed) are
   * DM'd to the owner once. Read-only on GoPartTime: this endpoint never
   * reports, clicks, or writes anything on the task site.
   */
  router.post(
    '/failed-tasks/scan',
    validateBody(failedTaskScanSchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const result = await failedTaskCheckService.scan(req.body, discordClient);
        res.json({ success: true, data: result });
      } catch (error) {
        if (error instanceof FailedTaskScanInProgressError) {
          res.status(429).json({ success: false, message: error.message });
          return;
        }
        logger.error('POST /goparttime/failed-tasks/scan failed', { error });
        res.status(500).json({ success: false, message: 'Internal server error.' });
      }
    },
  );

  /**
   * GET /api/v1/goparttime/tickets
   * Lists text channels the extension can assign tasks to.
   */
  router.get('/tickets', async (_req: Request, res: Response): Promise<void> => {
    try {
      const tickets = await goparttimeService.listTickets(discordClient);
      res.json({ success: true, data: tickets });
    } catch (error) {
      logger.error('GET /goparttime/tickets failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /**
   * POST /api/v1/goparttime/assign
   * Creates + delivers a task from the extension payload. Returns 409 with
   * the existing task when the GoPartTime task ID was already assigned.
   */
  router.post(
    '/assign',
    validateBody(goPartTimePayloadSchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const result = await goparttimeService.assignFromGoPartTime(req.body, discordClient);

        if (!result.created) {
          res.status(409).json({
            success: false,
            message: `Task has already been assigned (task ${req.body.taskId}).`,
            data: result.task,
          });
          return;
        }

        res.status(result.failed ? 200 : 201).json({
          success: true,
          data: result.task,
          failed: result.failed || false,
          error: result.error,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error.';
        logger.warn('POST /goparttime/assign failed', { message });
        res.status(400).json({ success: false, message });
      }
    },
  );

  /**
   * GET /api/v1/goparttime/insight/:externalTaskId?step=1|2
   * Returns the stored Statbot insight screenshot for a GoPartTime task's
   * current view-data step (1 = 20h insight, 2 = 70h insight for posts).
   * Resolves the task via its (source, externalTaskId) link, falling back to
   * manually-created tasks whose id embeds the number ("POST #688318").
   * Read-only: never modifies reminders or tasks.
   */
  router.get('/insight/:externalTaskId', async (req: Request, res: Response): Promise<void> => {
    try {
      const externalTaskId = String(req.params.externalTaskId);
      if (!/^\d+$/.test(externalTaskId)) {
        res.status(400).json({ success: false, message: 'Invalid task ID.' });
        return;
      }

      let step: number | undefined;
      if (req.query.step !== undefined) {
        step = Number(req.query.step);
        if (!Number.isInteger(step)) {
          res.status(400).json({ success: false, message: 'Invalid step. Use 1 or 2.' });
          return;
        }
      }

      const task = await findTaskByExternalId(externalTaskId);

      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found.' });
        return;
      }

      const reminders = await reminderService.findByTaskId(task.id);
      const { reminder, step: resolvedStep } = resolveInsightReminder(reminders, task.type, step);

      if (!reminder) {
        res.json({
          success: true,
          data: {
            taskId: externalTaskId,
            internalTaskId: task.id,
            type: task.type,
            reminderId: null,
            reminderType: null,
            step: resolvedStep,
            completed: false,
            imageUrl: null,
            message: 'No insight data available for this task yet.',
          },
        });
        return;
      }

      res.json({
        success: true,
        data: {
          taskId: externalTaskId,
          internalTaskId: task.id,
          type: task.type,
          reminderId: reminder.id,
          reminderType: reminder.type,
          step: resolvedStep,
          completed: reminder.completed,
          imageUrl: reminder.insightImageUrl,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      res.status(400).json({ success: false, message });
    }
  });

  /**
   * GET /api/v1/goparttime/expected/:externalTaskId
   * Returns the exact expected text Statbot delivered to Discord for a
   * GoPartTime task (title + formattedContent + type + subreddit), so a
   * manager-browser script on reddit.com can compare the live post against
   * the Discord copy using the manager's own Reddit session (VPS-proof:
   * no server-side Reddit fetch, no rate-limit exposure).
   * Resolves the task via its (source, externalTaskId) link, falling back to
   * manually-created tasks whose id embeds the number ("POST #688318").
   * Read-only: never modifies tasks or reminders.
   */
  router.get('/expected/:externalTaskId', async (req: Request, res: Response): Promise<void> => {
    try {
      const externalTaskId = String(req.params.externalTaskId);
      if (!/^\d+$/.test(externalTaskId)) {
        res.status(400).json({ success: false, message: 'Invalid task ID.' });
        return;
      }

      const task = await findTaskByExternalId(externalTaskId);

      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found.' });
        return;
      }

      res.json({
        success: true,
        data: {
          taskId: externalTaskId,
          internalTaskId: task.id,
          type: task.type,
          title: task.title,
          formattedContent: task.formattedContent,
          subreddit: task.subreddit,
          submittedRedditUrl: task.submittedRedditUrl,
          formatCheckStatus: task.formatCheckStatus,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      res.status(400).json({ success: false, message });
    }
  });

  /**
   * GET /api/v1/goparttime/submission/:externalTaskId
   * Returns the Reddit link the worker submitted in their Discord ticket for a
   * GoPartTime task, so a manager-browser script on goparttime.net can prefill
   * GoPartTime's own "Submit Task" dialog instead of copy-pasting the link out
   * of the dashboard's Accepted section by hand.
   *
   * Deliberately does NOT filter on task status. The link is written while the
   * task sits in ACCEPTED, but the manager can submit on GoPartTime at any
   * point afterwards — including after the task already moved on to PENDING —
   * and the answer is the same link either way. A status filter would make the
   * helper fail exactly when it is still useful.
   *
   * Resolves the task via its (source, externalTaskId) link, falling back to
   * manually-created tasks whose id embeds the number ("POST #688318").
   * Read-only: never modifies tasks.
   */
  router.get('/submission/:externalTaskId', async (req: Request, res: Response): Promise<void> => {
    try {
      const externalTaskId = String(req.params.externalTaskId);
      if (!/^\d+$/.test(externalTaskId)) {
        res.status(400).json({ success: false, message: 'Invalid task ID.' });
        return;
      }

      const task = await findTaskByExternalId(externalTaskId);

      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found.' });
        return;
      }

      const redditUrl = resolveSubmittedRedditUrl(task);

      res.json({
        success: true,
        data: {
          taskId: externalTaskId,
          internalTaskId: task.id,
          type: task.type,
          status: task.status,
          redditUrl,
          submittedAt: task.submittedAt,
          formatCheckStatus: task.formatCheckStatus,
          ...(redditUrl ? {} : { message: 'No Reddit link has been submitted for this task yet.' }),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error.';
      res.status(400).json({ success: false, message });
    }
  });

  /**
   * GET /api/v1/goparttime/submit-jobs/pending
   * Due + unleased link-submit jobs for the dedicated executor tab (own tab
   * id, polls every few seconds). Jobs carry the verified worker link; the
   * tab leases one, submits it in-page on goparttime.net, and reports back.
   * This tab never touches /tasks and never consumes an accept-claim lease.
   * The response also carries due feedback jobs ("submitting in a bit" for
   * link-less tasks near their deadline) so the tab keeps a single poll
   * loop — older executor versions ignore the extra field.
   */
  router.get('/submit-jobs/pending', async (_req: Request, res: Response): Promise<void> => {
    try {
      const [jobs, feedbackJobs] = await Promise.all([pendingSubmissionJobs(), pendingFeedbackJobs()]);
      res.json({
        success: true,
        data: {
          jobs: jobs.map((j) => ({
            jobId: j.jobId,
            taskId: j.taskId,
            externalTaskId: j.externalTaskId,
            submittedRedditUrl: j.submittedRedditUrl,
            attempt: j.attempt,
          })),
          feedbackJobs: feedbackJobs.map((j) => ({
            jobId: j.jobId,
            taskId: j.taskId,
            externalTaskId: j.externalTaskId,
            attempt: j.attempt,
          })),
        },
      });
    } catch (error) {
      logger.error('GET /goparttime/submit-jobs/pending failed', { error });
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  });

  /**
   * POST /api/v1/goparttime/submit-jobs/:id/lease
   * Per-tab lease on a job (separate lease from accept-claims). A fresh
   * foreign lease rejects (409) so two executor tabs never double-submit;
   * a stale lease (>5min, stuck tab) is reclaimable.
   */
  router.post(
    '/submit-jobs/:id/lease',
    validateBody(z.object({ tabId: z.string().min(1).max(64) })),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const outcome = await leaseSubmissionJob(String(req.params.id), req.body.tabId);
        if (!outcome.leased) {
          const code = outcome.reason === 'job not found (done, replaced, or expired)' ? 404 : 409;
          res.status(code).json({ success: false, message: outcome.reason });
          return;
        }
        res.json({ success: true, data: { leased: true, jobId: String(req.params.id) } });
      } catch (error) {
        logger.error('POST /goparttime/submit-jobs/:id/lease failed', { error });
        res.status(500).json({ success: false, message: 'Internal server error.' });
      }
    },
  );

  /**
   * POST /api/v1/goparttime/submit-jobs/:id/result
   * Executor verdict. Success removes the job + audits GPT_LINK_SUBMITTED.
   * Transient failure re-queues (+2/+5min, max 3 attempts); give-up removes
   * the job, audits GPT_LINK_SUBMIT_FAILED, and tags the manager in the
   * ticket for manual submission.
   */
  router.post(
    '/submit-jobs/:id/result',
    validateBody(z.object({
      ok: z.boolean(),
      failureReason: z.string().max(500).optional().nullable(),
    })),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const outcome = await reportSubmissionResult(
          String(req.params.id),
          { ok: req.body.ok, failureReason: req.body.failureReason ?? null },
          discordClient,
        );
        if (!outcome.recorded) {
          res.status(404).json({ success: false, message: 'Job not found (done, replaced, or expired).', stale: true });
          return;
        }
        res.json({ success: true, data: outcome });
      } catch (error) {
        logger.error('POST /goparttime/submit-jobs/:id/result failed', { error });
        res.status(500).json({ success: false, message: 'Internal server error.' });
      }
    },
  );

  /**
   * POST /api/v1/goparttime/feedback-jobs/:id/lease
   * Per-tab lease on a feedback job (same 409/404 semantics as submit-job
   * leases). Leasing re-validates: a task that gained a link, went terminal,
   * or already got its notice refuses the lease and the stale job is gone.
   * A stale-lease reclaim counts as an attempt; past the max the job is
   * dropped and the manager tagged once (no repeated re-servicing).
   */
  router.post(
    '/feedback-jobs/:id/lease',
    validateBody(z.object({ tabId: z.string().min(1).max(64) })),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const outcome = await leaseFeedbackJob(String(req.params.id), req.body.tabId, Date.now(), discordClient);
        if (!outcome.leased) {
          const code = outcome.reason.startsWith('stale:') || outcome.reason === 'job not found (done, replaced, or expired)' ? 404 : 409;
          res.status(code).json({ success: false, message: outcome.reason });
          return;
        }
        res.json({ success: true, data: { leased: true, jobId: String(req.params.id) } });
      } catch (error) {
        logger.error('POST /goparttime/feedback-jobs/:id/lease failed', { error });
        res.status(500).json({ success: false, message: 'Internal server error.' });
      }
    },
  );

  /**
   * POST /api/v1/goparttime/feedback-jobs/:id/result
   * Executor verdict. Success removes the job + audits FEEDBACK_SENT (the
   * one-shot guard). One retry after a transient failure; give-up removes
   * the job, audits FEEDBACK_FAILED, and tags the manager in the ticket so
   * the notice goes out by hand before expiry.
   */
  router.post(
    '/feedback-jobs/:id/result',
    validateBody(z.object({
      ok: z.boolean(),
      failureReason: z.string().max(500).optional().nullable(),
    })),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const outcome = await reportFeedbackResult(
          String(req.params.id),
          { ok: req.body.ok, failureReason: req.body.failureReason ?? null },
          discordClient,
        );
        if (!outcome.recorded) {
          res.status(404).json({ success: false, message: 'Job not found (done, replaced, or expired).', stale: true });
          return;
        }
        res.json({ success: true, data: outcome });
      } catch (error) {
        logger.error('POST /goparttime/feedback-jobs/:id/result failed', { error });
        res.status(500).json({ success: false, message: 'Internal server error.' });
      }
    },
  );

  /**
   * POST /api/v1/goparttime/reddit-session
   * Paste/refresh the spare Reddit account's login cookie (self-service,
   * no SSH). Same vault + validation as the dashboard path. The secret is
   * never echoed back.
   */  router.post(
    '/reddit-session',
    validateBody(z.object({
      cookie: z.string().min(50).max(12000),
      userAgent: z.string().max(500).optional().nullable(),
    })),
    async (req: Request, res: Response): Promise<void> => {
      try {
        await redditSessionService.save(req.body, 'goparttime-extension');
        res.json({ success: true, data: { updated: true } });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error.';
        res.status(400).json({ success: false, message });
      }
    },
  );

  return router;
}
