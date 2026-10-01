import {
  buildManualTaskIdCandidates,
  resolveSubmittedRedditUrl,
} from '../services/goparttime-task-lookup.service';

describe('buildManualTaskIdCandidates', () => {
  it('builds all four case variants for a numeric id', () => {
    expect(buildManualTaskIdCandidates('688318')).toEqual([
      'POST #688318',
      'Comment #688318',
      'Post #688318',
      'COMMENT #688318',
    ]);
  });

  it('still returns candidates for non-numeric input', () => {
    const candidates = buildManualTaskIdCandidates('abc');
    expect(candidates).toHaveLength(4);
    expect(candidates[0]).toBe('POST #abc');
  });
});

describe('resolveSubmittedRedditUrl', () => {
  it('returns the submitted url when present', () => {
    expect(
      resolveSubmittedRedditUrl({
        submittedRedditUrl: 'https://www.reddit.com/r/a/comments/1/x/',
        redditUrl: null,
      }),
    ).toBe('https://www.reddit.com/r/a/comments/1/x/');
  });

  it('prefers submittedRedditUrl over redditUrl when both are set', () => {
    // recordSubmission writes both fields; they can only differ if the worker
    // exchanged the link, in which case the newest (submitted) one is correct.
    expect(
      resolveSubmittedRedditUrl({
        submittedRedditUrl: 'https://www.reddit.com/r/a/comments/2/new/',
        redditUrl: 'https://www.reddit.com/r/a/comments/1/old/',
      }),
    ).toBe('https://www.reddit.com/r/a/comments/2/new/');
  });

  it('falls back to redditUrl for manually-created tasks', () => {
    // Slash-command / dashboard tasks validate and store redditUrl at creation
    // while leaving submittedRedditUrl null.
    expect(
      resolveSubmittedRedditUrl({
        submittedRedditUrl: null,
        redditUrl: 'https://www.reddit.com/r/a/comments/1/manual/',
      }),
    ).toBe('https://www.reddit.com/r/a/comments/1/manual/');
  });

  it('trims surrounding whitespace off the stored link', () => {
    expect(
      resolveSubmittedRedditUrl({
        submittedRedditUrl: '  https://www.reddit.com/r/a/comments/1/x/  ',
        redditUrl: null,
      }),
    ).toBe('https://www.reddit.com/r/a/comments/1/x/');
  });

  it('returns null when the worker has not submitted anything yet', () => {
    expect(resolveSubmittedRedditUrl({ submittedRedditUrl: null, redditUrl: null })).toBeNull();
  });

  it('returns null when both fields are empty strings', () => {
    expect(resolveSubmittedRedditUrl({ submittedRedditUrl: '', redditUrl: '   ' })).toBeNull();
  });

  it('does not fall back to a blank submittedRedditUrl over a real redditUrl', () => {
    // Guards the `||` chain: an empty-but-present submitted url must still let
    // the manual-task redditUrl through rather than resolving to null.
    expect(
      resolveSubmittedRedditUrl({
        submittedRedditUrl: '',
        redditUrl: 'https://www.reddit.com/r/a/comments/1/x/',
      }),
    ).toBe('https://www.reddit.com/r/a/comments/1/x/');
  });
});
