/**
 * Request schemas for the companion-facing automation endpoints.
 *
 * Extracted from the router so the burst payload limit can be asserted directly
 * in tests. The limit is a correctness concern, not a cosmetic one: the watcher
 * caps a settled report, and a payload above the limit is rejected with 400,
 * which the watcher retries forever — so a limit that is too low silently
 * strands tasks.
 */
import { z } from 'zod';

/** Shared shape for a task as reported by the browser companion. */
const reportedTaskShape = {
  subTaskId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).transform(String),
  type: z.enum(['post', 'comment']),
  subreddit: z.string().max(64).optional().nullable(),
  title: z.string().max(300).optional().nullable(),
};

export const sightingTaskSchema = z.object(reportedTaskShape);

export const burstTaskSchema = z.object(reportedTaskShape);

/**
 * Max tasks in one settled report.
 *
 * Was 20, which meant a drop with more than 20 eligible posts lost the
 * overflow permanently: those tasks never reached a cycle, so they could never
 * enter a blast pool, be claimed, or be assigned. 200 covers any realistic drop
 * in a single request (~80 KB worst case, well inside the 1 mb body limit), and
 * a larger drop arrives as further reports that the hour-burst merge path folds
 * into the same pool without re-messaging anyone.
 */
export const MAX_BURST_REPORT_TASKS = 200;

export const burstSchema = z.object({
  companionId: z.string().max(64).optional().nullable(),
  version: z.string().max(16).optional().nullable(),
  tasks: z.array(burstTaskSchema).max(MAX_BURST_REPORT_TASKS),
  /** Manual Blast Now: explicit human intent — bypasses the window gate only. */
  force: z.boolean().optional().default(false),
  /** On-demand `/scan` report: the request id from the poll's `scanNow`.
   *  The first report carrying an id consumes it and gets a per-request
   *  digest DM; later same-id reports merge as normal duplicates. */
  scanRequestId: z.string().max(64).optional().nullable(),
});
