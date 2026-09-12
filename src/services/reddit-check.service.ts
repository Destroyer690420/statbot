import { logger } from '../utils/logger';
import { compareRedditFormat, FormatCheckStatus } from '../utils/reddit-format';
import { TaskType } from '../types';

export interface RedditPostSnapshot {
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  deleted: boolean;
}

export interface FormatCheckOutcome {
  status: FormatCheckStatus;
  expectedParas: number;
  actualParas: number;
  titleMatch: boolean;
  error?: string;
}

const FETCH_TIMEOUT_MS = 12_000;
const HOSTS = ['www.reddit.com', 'old.reddit.com'];

function normalizeRedditUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!/^https?:\/\/(www\.|old\.|new\.|sh\.)?reddit\.com\/.+/i.test(trimmed)) return null;
  const normalized = trimmed.replace(/\/\/(www|old|new|sh)\./, '//www.');
  return normalized.split(/[?#]/)[0].replace(/\/+$/, '');
}

function toJsonUrl(normalized: string, host: string): string {
  const viaHost = normalized.replace(/^https?:\/\/[^/]+/, `https://${host}`);
  return `${viaHost}/.json?raw_json=1`;
}

/** Server-side fetch of a Reddit post's raw title/selftext via public .json. */
export async function fetchRedditPost(redditUrl: string): Promise<RedditPostSnapshot> {
  const normalized = normalizeRedditUrl(redditUrl);
  if (!normalized) throw new Error('Not a Reddit URL.');

  let lastError = 'Unknown fetch error.';
  for (const host of HOSTS) {
    try {
      const response = await fetch(toJsonUrl(normalized, host), {
        headers: {
          'User-Agent': 'RedditTaskManager/1.0 (format-check)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.status === 404) {
        lastError = 'Post not found (404 — it may be too new, deleted, or private).';
        continue;
      }
      if (response.status === 429) {
        lastError = 'Reddit rate-limited the check (429). Use Recheck in a minute.';
        continue;
      }
      if (!response.ok) {
        lastError = `Reddit returned ${response.status}.`;
        continue;
      }
      const data = (await response.json()) as unknown[];
      const post = (data as any[])?.[0]?.data?.children?.[0]?.data;
      if (!post) {
        lastError = 'Could not parse the Reddit post (may be removed or private).';
        continue;
      }
      const title = String(post.title ?? '');
      const selftext = String(post.selftext ?? '');
      const author = String(post.author ?? '');
      const subreddit = String(post.subreddit ?? '');
      const deleted =
        title.trim() === '[deleted]' ||
        title.trim() === '[removed]' ||
        selftext.trim() === '[deleted]' ||
        selftext.trim() === '[removed]' ||
        author.trim() === '[deleted]';
      return { title, selftext, author, subreddit, deleted };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logger.warn('Reddit format-check fetch failed', { url: redditUrl, host, error: lastError });
    }
  }
  throw new Error(lastError);
}

export async function checkPostFormat(args: {
  taskType: TaskType | string;
  expectedTitle: string | null;
  expectedContent: string | null;
  redditUrl: string;
}): Promise<FormatCheckOutcome> {
  if (args.taskType !== TaskType.POST) {
    return { status: 'SKIPPED', expectedParas: 0, actualParas: 0, titleMatch: true };
  }
  let snapshot: RedditPostSnapshot;
  try {
    snapshot = await fetchRedditPost(args.redditUrl);
  } catch (error) {
    return {
      status: 'FETCH_ERROR',
      expectedParas: 0,
      actualParas: 0,
      titleMatch: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (snapshot.deleted) {
    return { status: 'DELETED', expectedParas: 0, actualParas: 0, titleMatch: false };
  }
  const compared = compareRedditFormat({
    expectedTitle: args.expectedTitle,
    expectedContent: args.expectedContent,
    actualTitle: snapshot.title,
    actualContent: snapshot.selftext,
  });
  return {
    status: compared.status,
    expectedParas: compared.expectedParas,
    actualParas: compared.actualParas,
    titleMatch: compared.titleMatch,
  };
}
