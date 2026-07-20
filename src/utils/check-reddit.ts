import { logger } from './logger';

export async function isPostDeleted(redditUrl: string): Promise<boolean> {
  try {
    const normalUrl = redditUrl.replace(/\/\/(www|old|new|sh|reddit)\./, '//www.');
    const jsonUrl = normalUrl.endsWith('/') ? `${normalUrl}.json` : `${normalUrl}/.json`;

    const response = await fetch(jsonUrl, {
      headers: {
        'User-Agent': 'RedditTaskManager/1.0 (by /u/rtm-bot)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.warn('Reddit URL returned non-OK status', { url: redditUrl, status: response.status });
      return true;
    }

    const data = await response.json() as any[];
    const postListing = data[0]?.data;
    if (!postListing?.children?.[0]?.data) return true;

    const post = postListing.children[0].data;

    if (isRedacted(post.title) || isRedacted(post.selftext) || isRedacted(post.author)) {
      return true;
    }

    const commentId = extractCommentId(redditUrl);
    if (commentId) {
      const commentListing = data[1]?.data;
      const comment = findCommentById(commentListing, commentId);
      if (comment && (isRedacted(comment.body) || isRedacted(comment.author))) {
        return true;
      }
    }

    return false;
  } catch (error) {
    logger.warn('Failed to check Reddit URL status, proceeding with reminder', {
      url: redditUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function isRedacted(text: string | undefined | null): boolean {
  if (!text) return false;
  const val = text.trim();
  return val === '[deleted]' || val === '[removed]';
}

function extractCommentId(url: string): string | null {
  const match = url.match(/\/comments\/[^/]+\/[^/]+\/([a-z0-9]+)/i);
  return match ? match[1] : null;
}

function findCommentById(listing: any, targetId: string): any {
  if (!listing?.children) return null;
  for (const child of listing.children) {
    if (child.kind === 't1' && child.data?.id === targetId) return child.data;
    if (child.data?.replies) {
      const found = findCommentById(child.data.replies, targetId);
      if (found) return found;
    }
  }
  return null;
}
