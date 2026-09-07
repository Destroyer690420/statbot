import type { DetectedGoPartTimeTask } from '../../types';

/**
 * Parses /tasks page HTML (Next.js flight data) into detected tasks.
 * Verified against real capture (.goparttime/task.txt, 2026-09-07):
 *  detail.sub_task {id, type post|comment, status 0=available,
 *    task_id, grab_user_id 0=unclaimed, karma_limit, earnings}
 *  detail.task {id, subreddit_name, title, content ($ref), flair, imgs}
 *
 * Only fields needed for the acceptance decision are extracted here
 * (subTaskId/type/subreddit). Full content/images are fetched from the
 * task detail after acceptance for Discord delivery.
 */
export function parseTasksHtml(html: string): DetectedGoPartTimeTask[] {
  const out: DetectedGoPartTimeTask[] = [];
  // Escaped flight JSON uses \\" for quotes.
  const subRe =
    /\\\\"sub_task\\\\":\{\\\\"id\\\\":(\d+),\\\\"type\\\\":\\\\"(post|comment)\\\\",\\\\"status\\\\":(\d+),\\\\"task_id\\\\":(\d+)[\s\S]{0,2000}?\\\\"grab_user_id\\\\":(\d+)[\s\S]{0,2000}?\\\\"karma_limit\\\\":(\d+)[\s\S]{0,2000}?\\\\"earnings\\\\":(\d+)/g;

  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = subRe.exec(html)) !== null) {
    const [, subId, type, statusStr, taskId, grabStr, karmaStr, earnStr] = m;
    if (seen.has(subId)) continue;
    seen.add(subId);

    // Parent task block follows the sub_task in the same detail object.
    const taskBlockRe = new RegExp(
      `\\\\\\\\"task\\\\\\\\":\\{\\\\\\\\"id\\\\\\\\":${taskId},[\\s\\S]{0,4000}?\\\\\\\\"subreddit_name\\\\\\\\":\\\\\\\\"(.*?)\\\\\\\\",\\\\\\\\"title\\\\\\\\":\\\\\\\\"(.*?)\\\\\\\\"`,
    );
    const tb = taskBlockRe.exec(html);
    let subreddit: string | null = null;
    let title: string | null = null;
    if (tb) {
      subreddit = unescapeFlight(tb[1]) || null;
      title = unescapeFlight(tb[2]) || null;
    } else {
      // Comment tasks carry post_link instead of subreddit_name; try that.
      const linkRe = new RegExp(
        `\\\\\\\\"task\\\\\\\\":\\{\\\\\\\\"id\\\\\\\\":${taskId},[\\s\\S]{0,4000}?\\\\\\\\"post_link\\\\\\\\":\\\\\\\\"(.*?)\\\\\\\\"`,
      );
      const lb = linkRe.exec(html);
      if (lb) {
        const link = unescapeFlight(lb[1]);
        const sm = link?.match(/reddit\.com\/r\/([A-Za-z0-9_]+)/i);
        if (sm) subreddit = sm[1];
      }
    }

    out.push({
      subTaskId: subId,
      taskId,
      type: type as 'post' | 'comment',
      subreddit,
      title,
      postLink: null,
      contentHtml: '',
      images: [],
      payment: null,
      deadline: null,
      karmaLimit: karmaStr ? Number(karmaStr) : null,
      earnings: earnStr ? Number(earnStr) : null,
    });
    void statusStr;
    void grabStr;
  }
  return out;
}

/** Flight-escaped string -> plain text (\\u003c -> <, \\" -> "). */
export function unescapeFlight(s: string): string {
  return s
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\u0026/gi, '&')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/** Available + unclaimed filter used before validation. */
export function filterAvailableRaw(html: string): { subTaskId: string; status: number; grabUserId: number }[] {
  const re = /\\\\"sub_task\\\\":\{\\\\"id\\\\":(\d+)[\s\S]{0,500}?\\\\"status\\\\":(\d+)[\s\S]{0,500}?\\\\"grab_user_id\\\\":(\d+)/g;
  const out: { subTaskId: string; status: number; grabUserId: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({ subTaskId: m[1], status: Number(m[2]), grabUserId: Number(m[3]) });
  }
  return out;
}
