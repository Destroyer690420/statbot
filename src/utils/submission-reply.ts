/**
 * Pure submission-reply wording (no I/O — safe for unit tests).
 *
 * Phase 4 of the removal-state work: when the format check finds a removed
 * post, the ticket reply names the real reason (from the persisted
 * `formatCheckDetail.removalState`, written by `recordSubmission` /
 * `recheckFormat`) instead of "could not verify formatting". Genuine fetch
 * failures keep a neutral retry message and never claim a state.
 */

export interface SubmissionReplyTask {
  formatCheckStatus?: string | null;
  formatCheckDetail?: string | null;
  cancelledReason?: string | null;
}

function parseCheckDetail(detail?: string | null): { error?: string; removalState?: string | null } | null {
  if (!detail) return null;
  try {
    return JSON.parse(detail);
  } catch {
    return null;
  }
}

function parseParaCounts(detail?: string | null): { expected: number; actual: number } | null {
  if (!detail) return null;
  try {
    const d = JSON.parse(detail);
    if (typeof d.expectedParas === 'number' && typeof d.actualParas === 'number') {
      return { expected: d.expectedParas, actual: d.actualParas };
    }
    return null;
  } catch {
    return null;
  }
}

function markedSuffix(task: SubmissionReplyTask): string {
  return task.cancelledReason === 'deleted' ? ' It is marked deleted.' : '';
}

export function formatSubmissionReply(task: SubmissionReplyTask): string {
  const status = task.formatCheckStatus;
  if (!status || status === 'SKIPPED') return '✅ Submission recorded. Waiting for manager review.';
  if (status === 'MATCH') {
    const counts = parseParaCounts(task.formatCheckDetail);
    return `✅ Submission recorded. ✅ Post matches${counts ? ` (${counts.actual}/${counts.expected} ¶, title OK)` : ''} — ready for review.`;
  }
  if (status === 'NO_SESSION') {
    return '✅ Submission recorded. ⚠️ Format check is not set up yet — manager must paste the Reddit session cookie in dashboard Settings, then Recheck.';
  }
  if (status === 'SESSION_EXPIRED') {
    const detail = parseCheckDetail(task.formatCheckDetail);
    return `✅ Submission recorded. ⚠️ Reddit session expired${detail?.error ? ` (${detail.error})` : ''} — manager must re-paste the cookie in dashboard Settings, then Recheck.`;
  }
  if (status === 'DELETED') {
    const removalState = parseCheckDetail(task.formatCheckDetail)?.removalState ?? null;
    const marked = markedSuffix(task);
    switch (removalState) {
      case 'DELETED_BY_USER':
        return `✅ Submission recorded. 🔴 The post looks deleted, so it cannot count for pay. If you removed it by mistake, restore it and resubmit the link.${marked}`;
      case 'REMOVED_BY_MODS':
        return `✅ Submission recorded. 🔴 The post was removed by the subreddit moderators, so it cannot count for pay. Check the sub rules or any mod message.${marked}`;
      case 'REMOVED_BY_FILTER':
        return `✅ Submission recorded. 🟡 Reddit's filters removed the post — it is waiting in the modqueue. Ask the subreddit moderators to approve it, then tell me here.${marked}`;
      case 'REMOVED_OTHER':
        return `✅ Submission recorded. 🔴 The post looks removed, so it cannot count for pay. A manager will review.${marked}`;
      default:
        return `✅ Submission recorded. 🔴 The post looks deleted or removed, so it cannot count for pay. A manager will review.${marked}`;
    }
  }
  if (status === 'FETCH_ERROR') {
    const detail = parseCheckDetail(task.formatCheckDetail);
    if (detail?.error && /not found|404/i.test(detail.error)) {
      return '✅ Submission recorded. ⚠️ I could not find the post at that link — check it is the full post URL (not a share preview), then resubmit it here.';
    }
    return `✅ Submission recorded. ⚠️ Could not verify formatting yet${detail?.error ? `: ${detail.error}` : ''} — try Recheck from the dashboard.`;
  }
  const counts = parseParaCounts(task.formatCheckDetail);
  const countStr = counts ? ` (${counts.actual}/${counts.expected} ¶)` : '';
  const hint =
    status === 'PARA_MISMATCH'
      ? ' Paragraphs look collapsed — make sure there is a blank line between each paragraph on Reddit.'
      : status === 'TITLE_MISMATCH'
        ? ' The title does not match — copy it exactly.'
        : ' The text differs — check for missing or altered paragraphs.';
  return `✅ Submission recorded. 🔴 Formatting mismatch${countStr}.${hint}`;
}
