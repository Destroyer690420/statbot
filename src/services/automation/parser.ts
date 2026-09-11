import type { DetectedGoPartTimeTask } from '../../types';

/**
 * Parses /tasks page HTML (Next.js flight data) into detected tasks.
 * Live page bytes escape quotes with a SINGLE backslash (\"sub_task\");
 * captures copied from DevTools consoles often show doubled backslashes —
 * the patterns below tolerate one or two.
 * Shape: detail.sub_task {id, type post|comment, status 0=available,
 *   task_id, grab_user_id 0=unclaimed, karma_limit, earnings} wrapped in a
 *   parent `detail` object that ALSO carries subreddit_name/title nearby
 *   (parent key names vary — never searched by name).
 *
 * Only fields needed for the acceptance decision are extracted here
 * (subTaskId/type/subreddit). Full content/images are fetched from the
 * task detail after acceptance for Discord delivery.
 *
 * Output is newest-first (page bottom = newest drop): pools built from it
 * accept the newest eligible posts first. Card-index callers must use DOM
 * order themselves — do NOT rely on this order for index matching.
 */
export function parseTasksHtml(html: string): DetectedGoPartTimeTask[] {
  const out: DetectedGoPartTimeTask[] = [];
  // Tolerate 1-2 backslashes before each quote.
  const subRe =
    /\\{1,2}"sub_task\\{1,2}":\{\\{1,2}"id\\{1,2}":(\d+),\\{1,2}"type\\{1,2}":\\{1,2}"(post|comment)\\{1,2}",\\{1,2}"status\\{1,2}":(\d+),\\{1,2}"task_id\\{1,2}":(\d+)[\s\S]{0,2000}?\\{1,2}"grab_user_id\\{1,2}":(\d+)[\s\S]{0,2000}?\\{1,2}"karma_limit\\{1,2}":(\d+)[\s\S]{0,2000}?\\{1,2}"earnings\\{1,2}":(\d+)/g;

  // Pass 1: collect every sub_task match with its page index.
  const hits: { m: RegExpExecArray; index: number }[] = [];
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = subRe.exec(html)) !== null) {
    const subId = m[1];
    if (seen.has(subId)) continue;
    seen.add(subId);
    hits.push({ m, index: m.index });
  }

  // Boundary marker for the NEXT task: the following window must never
  // reach past it (prevents stealing a neighbor's subreddit in dense lists).
  const markerRe = /\\{1,2}"sub_task\\{1,2}":\{/g;
  const starts: number[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = markerRe.exec(html)) !== null) starts.push(sm.index);

  for (let i = 0; i < hits.length; i++) {
    const { m: hm, index } = hits[i];
    const [, subId, type, statusStr, taskId, grabStr, karmaStr, earnStr] = hm;
    const nextStart = starts.find((s) => s > index) ?? index + 12000;
    // Parent fields live inside the same `detail` object, which OPENS with
    // the sub_task block — look forward first (bounded by the next task),
    // then a short way back as fallback.
    const after = html.slice(index, Math.min(nextStart, index + 12000));
    const before = html.slice(Math.max(0, index - 4000), index);
    const subreddit = extractSubreddit(after) ?? extractSubreddit(before);
    const title = extractTitle(after) ?? extractTitle(before);

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
  // Newest-first: page bottom carries the newest drop.
  return out.reverse();
}

/** Subreddit from a bounded window: subreddit_name/subreddit, else post_link/reddit_url. */
export function extractSubreddit(window: string): string | null {
  const nameRe = /\\{1,2}"subreddit(?:_name)?\\{1,2}":\s*\\{1,2}"([A-Za-z0-9_ ]+?)\\{1,2}"/;
  const nm = nameRe.exec(window);
  if (nm) return unescapeFlight(nm[1].trim()) || null;
  const linkRe = /\\{1,2}"(?:post_link|reddit_url)\\{1,2}":\s*\\{1,2}"(.*?)\\{1,2}"/;
  const lb = linkRe.exec(window);
  if (lb) {
    const link = unescapeFlight(lb[1]);
    const sm = link?.match(/reddit\.com\/r\/([A-Za-z0-9_]+)/i);
    if (sm) return sm[1];
  }
  return null;
}

/** Title from a bounded window (flight-escaped). */
export function extractTitle(window: string): string | null {
  const titleRe = /\\{1,2}"title\\{1,2}":\s*\\{1,2}"((?:[^\\]|\\.)*?)\\{1,2}"/;
  const tm = titleRe.exec(window);
  if (!tm) return null;
  return unescapeFlight(tm[1]).slice(0, 300) || null;
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
