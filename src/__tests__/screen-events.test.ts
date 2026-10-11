/**
 * Tier-1 screen event feed + bot-DM `blocks` report builder.
 * Pure in-memory module — no env, no DB. Safe for unit tests.
 */
import { buildBlocksReport, clearScreenEvents, listScreenEvents, recordScreenEvent } from '../services/automation/screen-events';

beforeEach(() => {
  clearScreenEvents();
});

describe('recordScreenEvent / listScreenEvents', () => {
  it('records hits newest-first', () => {
    recordScreenEvent({ subreddit: 'a', signal: 'vape', matched: 'vape', externalTaskId: '1', dryRun: true }, 1000);
    recordScreenEvent({ subreddit: 'b', signal: 'sex', matched: null, externalTaskId: '2', dryRun: true }, 2000);
    expect(listScreenEvents(3000).map((e) => e.subreddit)).toEqual(['b', 'a']);
  });

  it('prunes events older than 7 days', () => {
    const now = 10_000_000;
    recordScreenEvent({ subreddit: 'old', signal: 'vape', matched: null, externalTaskId: null, dryRun: true }, now - 8 * 86400000);
    recordScreenEvent({ subreddit: 'new', signal: 'vape', matched: null, externalTaskId: null, dryRun: true }, now);
    expect(listScreenEvents(now).map((e) => e.subreddit)).toEqual(['new']);
  });

  it('caps at 100 events (oldest dropped)', () => {
    for (let i = 0; i < 105; i++) {
      recordScreenEvent({ subreddit: `s${i}`, signal: 'vape', matched: null, externalTaskId: null, dryRun: true }, i);
    }
    const listed = listScreenEvents(1000);
    expect(listed).toHaveLength(100);
    expect(listed[0].subreddit).toBe('s104');
  });
});

describe('buildBlocksReport', () => {
  const rows = [
    { subreddit: 'badsub', reason: 'auto-content:vape', createdAt: new Date('2026-10-10T10:00:00Z') },
  ];

  it('reports actual blocks with reason + date', () => {
    const msg = buildBlocksReport({ autoBlocked: rows, events: [], dryRun: false });
    expect(msg).toContain('r/badsub');
    expect(msg).toContain('auto-content:vape');
    expect(msg).toContain('2026-10-10');
    expect(msg).not.toContain('Would-block');
  });

  it('says none yet when empty (enforce mode)', () => {
    const msg = buildBlocksReport({ autoBlocked: [], events: [], dryRun: false });
    expect(msg).toContain('none yet');
  });

  it('lists dry-run candidates only in dry-run mode', () => {
    const events = listScreenEvents(5000);
    expect(events).toEqual([]);
    recordScreenEvent(
      { subreddit: 'maybe', signal: 'non-en', matched: null, externalTaskId: '42', dryRun: true },
      4000,
    );
    const dry = buildBlocksReport({ autoBlocked: [], events: listScreenEvents(5000), dryRun: true, nowMs: 5000 });
    expect(dry).toContain('Would-block candidates');
    expect(dry).toContain('r/maybe');
    expect(dry).toContain('task #42');
    const live = buildBlocksReport({ autoBlocked: [], events: listScreenEvents(5000), dryRun: false, nowMs: 5000 });
    expect(live).not.toContain('Would-block');
  });

  it('hides non-dry-run events from the candidates section', () => {
    recordScreenEvent(
      { subreddit: 'x', signal: 'vape', matched: 'vape', externalTaskId: null, dryRun: false },
      1000,
    );
    const msg = buildBlocksReport({ autoBlocked: [], events: listScreenEvents(2000), dryRun: true, nowMs: 2000 });
    expect(msg).toContain('none recorded');
  });

  it('lists cleared subs compactly', () => {
    const msg = buildBlocksReport({ autoBlocked: [], events: [], dryRun: false, allowed: ['moderators', 'cartoons'] });
    expect(msg).toContain('Cleared: r/moderators, r/cartoons');
    expect(msg.length).toBeLessThanOrEqual(1900);
  });

  it('omits the cleared line when nobody is cleared', () => {
    const msg = buildBlocksReport({ autoBlocked: [], events: [], dryRun: false });
    expect(msg).not.toContain('Cleared:');
  });

  it('always fits a Discord message', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      subreddit: `verylongsubredditname${i}`,
      reason: 'auto-content:non-en',
      createdAt: new Date('2026-10-10T10:00:00Z'),
    }));
    const msg = buildBlocksReport({ autoBlocked: many, events: [], dryRun: false });
    expect(msg.length).toBeLessThanOrEqual(1900);
    expect(msg).toContain('Unblock:');
  });
});
