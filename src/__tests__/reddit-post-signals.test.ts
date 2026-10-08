import { summarizeRawPost, describeSignals, classifyRemoval } from '../utils/reddit-post-signals';

// NOTE: utils-only imports — reddit-post-signals.ts is env-free, so this
// suite needs no logger/env mocks (see docs/TESTING.md §1).

function post(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 't3_abc123',
    id: 'abc123',
    title: 'A normal title',
    selftext: 'First para.\n\nSecond para.',
    author: 'someworker',
    subreddit: 'TestSub',
    removed_by_category: null,
    banned_by: null,
    approved: false,
    approved_by: null,
    approved_at_utc: null,
    banned_at_utc: null,
    removal_reason: null,
    mod_reason_title: null,
    distinguished: null,
    locked: false,
    archived: false,
    spam: false,
    num_reports: 0,
    over_18: false,
    created_utc: 1760000000,
    ...overrides,
  };
}

describe('summarizeRawPost', () => {
  it('extracts the full removal field set from a live post', () => {
    const s = summarizeRawPost(post());
    expect(s).not.toBeNull();
    expect(s).toMatchObject({
      title: 'A normal title',
      author: 'someworker',
      subreddit: 'TestSub',
      removedByCategory: null,
      bannedBy: null,
      approved: false,
      spam: false,
      numReports: 0,
    });
    expect(s!.rawKeys).toContain('removed_by_category');
  });

  it('reads a user-deleted shell ([deleted] markers, deleted category)', () => {
    const s = summarizeRawPost(
      post({ title: '[deleted]', selftext: '[deleted]', author: '[deleted]', removed_by_category: 'deleted' }),
    );
    expect(s).toMatchObject({ title: '[deleted]', author: '[deleted]', removedByCategory: 'deleted' });
    expect(describeSignals(s!)).toContain('has[deleted]');
  });

  it('reads a mod-removed shell ([removed] + moderator category + banner)', () => {
    const s = summarizeRawPost(
      post({
        selftext: '[removed]',
        author: 'realuser',
        removed_by_category: 'moderator',
        banned_by: 'AutoModerator',
        banned_at_utc: 1760000100,
      }),
    );
    expect(s).toMatchObject({ removedByCategory: 'moderator', bannedBy: 'AutoModerator' });
    expect(describeSignals(s!)).toContain('removed_by_category=moderator');
  });

  it('reads an automod-filtered post (filter category, not yet approved)', () => {
    const s = summarizeRawPost(post({ selftext: '[removed]', removed_by_category: 'automod_filtered' }));
    expect(s!.removedByCategory).toBe('automod_filtered');
    expect(s!.approved).toBe(false);
  });

  it('reads an approved-after-review post', () => {
    const s = summarizeRawPost(
      post({ removed_by_category: null, approved: true, approved_by: 'somemod', approved_at_utc: 1760000200 }),
    );
    expect(s).toMatchObject({ approved: true, approvedBy: 'somemod' });
    expect(describeSignals(s!)).toContain('approved(by=somemod)');
  });

  it('returns null for non-post shapes (empty listing child, HTML, garbage)', () => {
    expect(summarizeRawPost(null)).toBeNull();
    expect(summarizeRawPost(undefined)).toBeNull();
    expect(summarizeRawPost('html')).toBeNull();
    expect(summarizeRawPost({ kind: 't1', data: {} })).toBeNull();
    expect(summarizeRawPost({})).toBeNull();
  });

  it('treats banned_by=false as absent and banned_by=true as the literal flag', () => {
    expect(summarizeRawPost(post({ banned_by: false }))!.bannedBy).toBeNull();
    expect(summarizeRawPost(post({ banned_by: true }))!.bannedBy).toBe('true');
  });
});

describe('describeSignals', () => {
  it('says a standing post stands', () => {
    expect(describeSignals(summarizeRawPost(post())!)).toBe('stands (no markers, no removal tokens)');
  });
});

describe('classifyRemoval (probed matrix, docs/REMOVAL_SIGNALS.md)', () => {
  it('LIVE for a standing post', () => {
    expect(classifyRemoval(summarizeRawPost(post())!)).toBe('LIVE');
  });

  it('REMOVED_BY_FILTER for filter removal (title intact, [removed] text)', () => {
    const s = summarizeRawPost(post({ selftext: '[removed]', removed_by_category: 'reddit' }))!;
    expect(classifyRemoval(s)).toBe('REMOVED_BY_FILTER');
  });

  it('REMOVED_BY_FILTER for automod_filtered (same bucket, unobserved live)', () => {
    const s = summarizeRawPost(post({ selftext: '[removed]', removed_by_category: 'automod_filtered' }))!;
    expect(classifyRemoval(s)).toBe('REMOVED_BY_FILTER');
  });

  it('REMOVED_BY_MODS for the probed mod title, even with empty selftext and no category', () => {
    const s = summarizeRawPost(
      post({ title: '[ Removed by moderator ]', selftext: '', removed_by_category: null }),
    )!;
    expect(classifyRemoval(s)).toBe('REMOVED_BY_MODS');
  });

  it('REMOVED_BY_MODS for the moderator category', () => {
    const s = summarizeRawPost(post({ selftext: '[removed]', removed_by_category: 'moderator' }))!;
    expect(classifyRemoval(s)).toBe('REMOVED_BY_MODS');
  });

  it('DELETED_BY_USER for [deleted] shells', () => {
    const s = summarizeRawPost(
      post({ title: '[deleted]', selftext: '[deleted]', author: '[deleted]', removed_by_category: 'deleted' }),
    )!;
    expect(classifyRemoval(s)).toBe('DELETED_BY_USER');
  });

  it('DELETED_BY_USER for bare [deleted] markers with no token (legacy production shape)', () => {
    const s = summarizeRawPost(post({ selftext: '[deleted]', removed_by_category: null }))!;
    expect(classifyRemoval(s)).toBe('DELETED_BY_USER');
  });

  it('REMOVED_BY_FILTER when filter evidence accompanies a gone author (post-state outranks account-state)', () => {
    const s = summarizeRawPost(
      post({ author: '[deleted]', selftext: '[removed]', removed_by_category: 'reddit' }),
    )!;
    expect(classifyRemoval(s)).toBe('REMOVED_BY_FILTER');
  });

  it('DELETED_BY_USER for a gone author plus redaction with no category token', () => {
    const s = summarizeRawPost(
      post({ author: '[deleted]', selftext: '[deleted]', removed_by_category: null }),
    )!;
    expect(classifyRemoval(s)).toBe('DELETED_BY_USER');
  });

  it('LIVE for a gone author with fully standing content (account gone, post visible)', () => {
    const s = summarizeRawPost(post({ author: '[deleted]', removed_by_category: null }))!;
    expect(classifyRemoval(s)).toBe('LIVE');
  });

  it('LIVE for a mod-approved post even with stale removal tokens', () => {
    const s = summarizeRawPost(
      post({ selftext: '[removed]', removed_by_category: 'reddit', approved: true, approved_by: 'somemod' }),
    )!;
    expect(classifyRemoval(s)).toBe('LIVE');
  });

  it('REMOVED_OTHER for an unobserved category with markers (never a named bucket)', () => {
    const s = summarizeRawPost(post({ selftext: '[removed]', removed_by_category: 'community_ops' }))!;
    expect(classifyRemoval(s)).toBe('REMOVED_OTHER');
  });

  it('LIVE when nothing is redacted, even with a stray token and no approval', () => {
    const s = summarizeRawPost(post({ removed_by_category: 'reddit' }))!;
    expect(classifyRemoval(s)).toBe('LIVE');
  });
});
