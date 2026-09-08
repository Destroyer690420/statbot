import type { DetectedGoPartTimeTask } from '../../types';

/**
 * Parses /tasks page HTML (Next.js flight data) into detected tasks.
 * Live page bytes escape quotes with a SINGLE backslash (\"sub_task\");
 * captures copied from DevTools consoles often show doubled backslashes —
 * the patterns below tolerate one or two.
 * Shape: detail.sub_task {id, type post|comment, status 0=available,
 *   task_id, grab_user_id 0=unclaimed, karma_limit, earnings}
 *   + parent task {subreddit_name, title}.
 *
 * Only fields needed for the acceptance decision are extracted here
 * (subTaskId/type/subreddit). Full content/images are fetched from the
 * task detail after acceptance for Discord delivery.
 */
export function parseTasksHtml(html: string): DetectedGoPartTimeTask[] {
  const out: DetectedGoPartTimeTask[] = [];
  // Tolerate 1-2 backslashes before each quote.
  const subRe =
    /\\{1,2}"sub_task\\{1,2}":\{\\{1,2}"id\\{1,2}":(\d+),\\{1,2}"type\\{1,2}":\\{1,2}"(post|comment)\\{1,2}",\\{1,2}"status\\{1,2}":(\d+),\\{1,2}"task_id\\{1,2}":(\d+)[\s\S]{0,2000}?\\{1,2}"grab_user_id\\{1,2}":(\d+)[\s\S]{0,2000}?\\{1,2}"karma_limit\\{1,2}":(\d+)[\s\S]{0,2000}?\\{1,2}"earnings\\{1,2}":(\d+)/g;

  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = subRe.exec(html)) !== null) {
    const [, subId, type, statusStr, taskId, grabStr, karmaStr, earnStr] = m;
    if (seen.has(subId)) continue;
    seen.add(subId);

    // Parent task block follows the sub_task in the same detail object.
    const qb = '\\\\{1,2}"';
    const taskBlockRe = new RegExp(
      `${qb}task${qb}:\\{${qb}id${qb}:${taskId},[\\s\\S]{0,4000}?${qb}subreddit_name${qb}:${qb}(.*?)${qb},${qb}title${qb}:${qb}(.*?)${qb}`,
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
        `${qb}task${qb}:\\{${qb}id${qb}:${taskId},[\\s\\S]{0,4000}?${qb}post_link${qb}:${qb}(.*?)${qb}`,
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

/** Flight-escaped string -> plain text. Doubles collapse before singles. */
export function unescapeFlight(s: string): string {
  return s
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\\/g, '\\')
    .replace(/\\"/g, '"');
}

/** Available + unclaimed filter used before validation. */
export function filterAvailableRaw(html: string): { subTaskId: string; status: number; grabUserId: number }[] {
  const re = /\\{1,2}"sub_task\\{1,2}":\{\\{1,2}"id\\{1,2}":(\d+)[\s\S]{0,500}?\\{1,2}"status\\{1,2}":(\d+)[\s\S]{0,500}?\\{1,2}"grab_user_id\\{1,2}":(\d+)/g;
  const out: { subTaskId: string; status: number; grabUserId: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({ subTaskId: m[1], status: Number(m[2]), grabUserId: Number(m[3]) });
  }
  return out;
}
