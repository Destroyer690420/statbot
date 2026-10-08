import { formatSubmissionReply } from '../utils/submission-reply';

// NOTE: utils-only import — submission-reply.ts is env-free, so this suite
// needs no logger/env mocks (see docs/TESTING.md §1).

function detail(obj: Record<string, unknown> | null): string | null {
  return obj === null ? null : JSON.stringify(obj);
}

describe('formatSubmissionReply — unchanged paths', () => {
  it('waiting message when unchecked', () => {
    expect(formatSubmissionReply({ formatCheckStatus: null, formatCheckDetail: null })).toBe(
      '✅ Submission recorded. Waiting for manager review.',
    );
    expect(formatSubmissionReply({ formatCheckStatus: 'SKIPPED', formatCheckDetail: null })).toBe(
      '✅ Submission recorded. Waiting for manager review.',
    );
  });

  it('match message with counts', () => {
    expect(
      formatSubmissionReply({
        formatCheckStatus: 'MATCH',
        formatCheckDetail: detail({ expectedParas: 3, actualParas: 3, titleMatch: true, removalState: 'LIVE' }),
      }),
    ).toContain('✅ Post matches (3/3 ¶, title OK)');
  });

  it('setup/expired messages byte-identical', () => {
    expect(formatSubmissionReply({ formatCheckStatus: 'NO_SESSION', formatCheckDetail: null })).toContain(
      'Format check is not set up yet',
    );
    expect(
      formatSubmissionReply({
        formatCheckStatus: 'SESSION_EXPIRED',
        formatCheckDetail: detail({ error: 'expired' }),
      }),
    ).toContain('Reddit session expired (expired)');
  });

  it('mismatch hints unchanged', () => {
    expect(
      formatSubmissionReply({
        formatCheckStatus: 'PARA_MISMATCH',
        formatCheckDetail: detail({ expectedParas: 3, actualParas: 1, titleMatch: true }),
      }),
    ).toContain('blank line between each paragraph');
    expect(
      formatSubmissionReply({
        formatCheckStatus: 'TITLE_MISMATCH',
        formatCheckDetail: detail({ expectedParas: 1, actualParas: 1, titleMatch: false }),
      }),
    ).toContain('title does not match');
  });
});

describe('formatSubmissionReply — Phase 4 real reasons', () => {
  it('names user deletion + marked state', () => {
    const msg = formatSubmissionReply({
      formatCheckStatus: 'DELETED',
      formatCheckDetail: detail({ expectedParas: 0, actualParas: 0, titleMatch: false, removalState: 'DELETED_BY_USER' }),
      cancelledReason: 'deleted',
    });
    expect(msg).toContain('looks deleted');
    expect(msg).toContain('marked deleted');
    expect(msg).not.toContain('Could not verify');
  });

  it('names mod removal without claiming setup issues', () => {
    const msg = formatSubmissionReply({
      formatCheckStatus: 'DELETED',
      formatCheckDetail: detail({ expectedParas: 0, actualParas: 0, titleMatch: false, removalState: 'REMOVED_BY_MODS' }),
    });
    expect(msg).toContain('removed by the subreddit moderators');
    expect(msg).not.toContain('Could not verify');
  });

  it('names filter removal as awaiting approval (the honest outside label)', () => {
    const msg = formatSubmissionReply({
      formatCheckStatus: 'DELETED',
      formatCheckDetail: detail({ expectedParas: 0, actualParas: 0, titleMatch: false, removalState: 'REMOVED_BY_FILTER' }),
    });
    expect(msg).toContain("Reddit's filters removed the post");
    expect(msg).toContain('modqueue');
    expect(msg).toContain('approve');
  });

  it('falls back to a generic removed message without a state (pre-Phase-4 rows)', () => {
    const msg = formatSubmissionReply({ formatCheckStatus: 'DELETED', formatCheckDetail: null });
    expect(msg).toContain('deleted or removed');
    expect(msg).not.toContain('Could not verify');
  });

  it('unknown states never leak internal tokens', () => {
    const msg = formatSubmissionReply({
      formatCheckStatus: 'DELETED',
      formatCheckDetail: detail({ expectedParas: 0, actualParas: 0, titleMatch: false, removalState: 'REMOVED_OTHER' }),
    });
    expect(msg).toContain('looks removed');
    expect(msg).not.toContain('REMOVED_OTHER');
  });

  it('404 fetch errors ask for the link instead of claiming unverifiable format', () => {
    const msg = formatSubmissionReply({
      formatCheckStatus: 'FETCH_ERROR',
      formatCheckDetail: detail({ expectedParas: 0, actualParas: 0, titleMatch: false, error: 'Post not found (404 — it may be too new, deleted, or private).', removalState: null }),
    });
    expect(msg).toContain('could not find the post');
    expect(msg).toContain('resubmit');
    expect(msg).not.toContain('Could not verify formatting');
  });

  it('other fetch errors keep the neutral retry message', () => {
    const msg = formatSubmissionReply({
      formatCheckStatus: 'FETCH_ERROR',
      formatCheckDetail: detail({ expectedParas: 0, actualParas: 0, titleMatch: false, error: 'Reddit returned 500.', removalState: null }),
    });
    expect(msg).toContain('Could not verify formatting yet');
  });
});
