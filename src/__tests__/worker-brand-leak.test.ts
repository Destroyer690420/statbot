/**
 * Worker brand-leak guard.
 *
 * Rule: worker-visible surfaces must never name the external task site
 * ("GoPartTime" / "go-part-time" / "go part time", any case). Internal
 * identifiers (source='goparttime', API routes, env names, file names,
 * manager-only Automation tooling, audit/log lines) are NOT worker-visible
 * and are intentionally out of scope — managers operate that integration.
 *
 * Worker-visible scope enforced here:
 * - ticket submission replies (utils/submission-reply.ts)
 * - ticket auto-submit failure notice (services/submission.service.ts)
 * - ticket nudge / task instruction wording (utils/link-nudge.ts,
 *   utils/plain-task-message.ts)
 * - worker portal + shared task-detail UI (dashboard/src/pages/worker/**,
 *   dashboard/src/pages/TaskDetails.tsx)
 */
import * as fs from 'fs';
import * as path from 'path';

import { buildFeedbackFailedMessage, buildSubmissionFailedMessage, formatSubmissionReply } from '../utils/submission-reply';
import { buildNudgeMessage } from '../utils/link-nudge';
import { buildImageOrderReminder, buildTaskMessagePlan } from '../utils/plain-task-message';

const BRAND = /go[\s-_]*part[\s-_]*time/i;

function detail(obj: Record<string, unknown> | null): string | null {
  return obj === null ? null : JSON.stringify(obj);
}

describe('worker-visible surfaces never name the external task site', () => {
  it('submission replies (all verdicts) carry no brand', () => {
    const statuses: Array<{ status: string | null; detailObj: Record<string, unknown> | null }> = [
      { status: null, detailObj: null },
      { status: 'SKIPPED', detailObj: null },
      { status: 'MATCH', detailObj: { expectedParas: 3, actualParas: 3, titleMatch: true } },
      { status: 'PARA_EXTRA', detailObj: { expectedParas: 1, actualParas: 3, titleMatch: true } },
      { status: 'PARA_SHORT', detailObj: { expectedParas: 13, actualParas: 11, titleMatch: true } },
      { status: 'TITLE_MISMATCH', detailObj: { expectedParas: 1, actualParas: 1, titleMatch: false } },
      { status: 'TEXT_MISMATCH', detailObj: { expectedParas: 2, actualParas: 2, titleMatch: true } },
      { status: 'NO_SESSION', detailObj: null },
      { status: 'SESSION_EXPIRED', detailObj: { error: 'expired' } },
      { status: 'FETCH_ERROR', detailObj: { error: 'Reddit returned 500.' } },
      { status: 'DELETED', detailObj: { removalState: 'REMOVED_BY_MODS' } },
    ];
    for (const s of statuses) {
      const msg = formatSubmissionReply({ formatCheckStatus: s.status, formatCheckDetail: detail(s.detailObj) });
      expect(msg).not.toMatch(BRAND);
    }
  });

  it('ticket auto-submit failure notice carries no brand', () => {
    const msg = buildSubmissionFailedMessage(
      { id: 'TSK-1', externalTaskId: '123', submittedRedditUrl: 'https://www.reddit.com/r/x/comments/1/' },
      'timeout',
      '<@111>',
    );
    expect(msg).not.toMatch(BRAND);
    expect(msg).toContain('task site');
  });

  it('ticket feedback failure notice carries no brand', () => {
    const msg = buildFeedbackFailedMessage({ id: 'TSK-1', externalTaskId: '123' }, 'dialog missing', '<@111>');
    expect(msg).not.toMatch(BRAND);
    expect(msg).toContain('task site');
  });

  it('nudge + instruction + image-order wording carries no brand', () => {
    expect(buildNudgeMessage('123')).not.toMatch(BRAND);
    expect(buildImageOrderReminder('123', 3)).not.toMatch(BRAND);
    const plan = buildTaskMessagePlan({ subreddit: 'x', title: 't' }, 'hello world');
    for (const m of plan.metadata) expect(m).not.toMatch(BRAND);
    for (const c of plan.content) expect(c).not.toMatch(BRAND);
    expect(plan.instruction.title).not.toMatch(BRAND);
    expect(plan.instruction.lines.join('\n')).not.toMatch(BRAND);
    expect(plan.instruction.footer).not.toMatch(BRAND);
  });

  it('worker portal + task-detail UI files carry no brand', () => {
    // Dashboard scope: visible brand casing only. The lowercase data constant
    // `source === 'goparttime'` is a DB/API value (never rendered — the UI
    // shows neutral "Post #id" / "External ..."), so it is allowed here.
    // What must never return is the display brand "GoPartTime".
    const DISPLAY_BRAND = /GoPartTime|Go\s*Part/i;
    // Resolve from this test file: src/__tests__ -> repo root -> dashboard/...
    const root = path.resolve(__dirname, '..', '..');
    const files = [
      'dashboard/src/pages/TaskDetails.tsx',
      'dashboard/src/pages/worker/WorkerLogin.tsx',
      'dashboard/src/pages/worker/WorkerTaskDetail.tsx',
      'dashboard/src/pages/worker/WorkerHowTo.tsx',
      'dashboard/src/pages/Tasks.tsx',
      'dashboard/src/pages/AcceptedTasks.tsx',
    ];
    for (const rel of files) {
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) continue;
      const raw = fs.readFileSync(abs, 'utf8');
      // Strip the lowercase data constant: `source === 'goparttime'` is a
      // DB/API value, never rendered text (UI shows "Post #id" / "External …").
      const text = raw.replace(/['"]goparttime['"]/g, "''");
      expect(text).not.toMatch(DISPLAY_BRAND);
    }
  });
});
