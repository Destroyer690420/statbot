/**
 * Exact-match subreddit normalization. Prevents loose substring blocks
 * (aiagents must not block aiagents2).
 */
export function normalizeSubreddit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  // Strip full URLs: https://(www.|old.)reddit.com/r/name/... -> name
  const urlMatch = s.match(/reddit\.com\/r\/([a-z0-9_]+)/);
  if (urlMatch) return urlMatch[1];
  // Strip r/ prefix
  s = s.replace(/^r\//, '');
  // Strip leading @ or / leftovers, trailing slashes
  s = s.replace(/^[@/]+/, '').replace(/\/+$/, '');
  if (!/^[a-z0-9_]{1,32}$/.test(s)) return null;
  return s;
}
