import { splitParagraphs } from './redditFormat';

export interface RedditLivePost {
  title: string;
  selftext: string;
  author: string;
  titleParas: string[];
  bodyParas: string[];
  deleted: boolean;
}

function normalizeRedditUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!/^https?:\/\/(www\.|old\.|new\.|sh\.)?reddit\.com\/.+/i.test(trimmed)) return null;
  return trimmed.split(/[?#]/)[0].replace(/\/+$/, '');
}

function toJsonUrl(normalized: string, host: string): string {
  return `${normalized.replace(/^https?:\/\/[^/]+/, `https://${host}`)}/.json?raw_json=1`;
}

/**
 * Browser-direct fetch of a Reddit post's raw title/selftext (no backend
 * hop, so the VPS IP can never get us rate-limited). Falls back from
 * www → old on 404/429/parse failures.
 */
export async function fetchRedditPostLive(redditUrl: string, timeoutMs = 12000): Promise<RedditLivePost> {
  const normalized = normalizeRedditUrl(redditUrl);
  if (!normalized) throw new Error('Not a Reddit URL.');

  let lastError = 'Unknown fetch error.';
  for (const host of ['www.reddit.com', 'old.reddit.com']) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(toJsonUrl(normalized, host), {
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (res.status === 404) {
        lastError = 'Post not found (too new, deleted, or private).';
        continue;
      }
      if (res.status === 429) {
        lastError = 'Reddit rate-limited (429). Wait a minute and retry.';
        continue;
      }
      if (!res.ok) {
        lastError = `Reddit returned ${res.status}.`;
        continue;
      }
      const data = (await res.json()) as unknown[];
      const post = (data as any[])?.[0]?.data?.children?.[0]?.data;
      if (!post) {
        lastError = 'Could not parse the Reddit post (removed or private?).';
        continue;
      }
      const title = String(post.title ?? '');
      const selftext = String(post.selftext ?? '');
      const author = String(post.author ?? '');
      const deleted =
        title.trim() === '[deleted]' ||
        title.trim() === '[removed]' ||
        selftext.trim() === '[deleted]' ||
        selftext.trim() === '[removed]' ||
        author.trim() === '[deleted]';
      return {
        title,
        selftext,
        author,
        titleParas: splitParagraphs(title),
        bodyParas: splitParagraphs(selftext),
        deleted,
      };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastError);
}
