/**
 * Pre-blast DM digest logic. Pure module — no env or DB needed.
 */
import {
  buildBlastDigest,
  buildDigestButtons,
  buildReleaseInputs,
  formatDigestMessage,
  isEligibleLogStatus,
  MAX_BLOCK_BUTTONS,
  parseBlastButtonId,
  DigestTaskLog,
} from '../services/automation/blast-digest';

function log(id: string, sub: string | null, status = 'ELIGIBLE', type = 'post'): DigestTaskLog {
  return { externalTaskId: id, taskType: type, subreddit: sub, status };
}

describe('isEligibleLogStatus', () => {
  it('counts only validated-eligible logs', () => {
    expect(isEligibleLogStatus('ELIGIBLE')).toBe(true);
    for (const s of ['BLOCKED', 'DUPLICATE', 'ACCEPTED', 'FAILED', 'NEEDS_PUSH', '']) {
      expect(isEligibleLogStatus(s)).toBe(false);
    }
  });
});

describe('buildBlastDigest', () => {
  it('groups eligible logs per subreddit in first-seen order', () => {
    const d = buildBlastDigest(
      'c1',
      [log('1', 'Cats'), log('2', 'r/cats'), log('3', 'Dogs'), log('4', 'BLOCKEDSUB', 'BLOCKED')],
      [],
      ['cats', 'dogs'],
      { scanned: 4, eligible: 3, blocked: 1 },
    );
    expect(d.subs).toEqual([
      { sub: 'cats', count: 2, ids: ['1', '2'], eligible: 2, reasons: [] },
      { sub: 'dogs', count: 1, ids: ['3'], eligible: 1, reasons: [] },
      { sub: 'blockedsub', count: 1, ids: ['4'], eligible: 0, reasons: ['BLOCKED'] },
    ]);
    expect(d.newSubs).toEqual([]);
    expect(d.scanned).toBe(4);
  });

  it('flags never-seen eligible subs as new (case-insensitive, URL forms)', () => {
    const d = buildBlastDigest(
      'c1',
      [log('1', 'Cats'), log('2', 'https://www.reddit.com/r/BrandNew/'), log('3', null, 'NO_SUBREDDIT')],
      [],
      ['cats'],
      { scanned: 3, eligible: 2, blocked: 0 },
    );
    expect(d.newSubs).toEqual(['brandnew']);
    expect(d.subs).toEqual([
      { sub: 'cats', count: 1, ids: ['1'], eligible: 1, reasons: [] },
      { sub: 'brandnew', count: 1, ids: ['2'], eligible: 1, reasons: [] },
      { sub: 'unknown', count: 1, ids: ['3'], eligible: 0, reasons: ['NO_SUBREDDIT'] },
    ]);
  });

  it('never flags blocked subs as new', () => {
    const d = buildBlastDigest(
      'c1',
      [log('1', 'Weird')], 
      ['weird'],
      [],
      { scanned: 1, eligible: 1, blocked: 0 },
    );
    expect(d.newSubs).toEqual([]);
  });

  it('ignores malformed entries without throwing', () => {
    const d = buildBlastDigest(
      'c1',
      [null, undefined, log('1', '   ', 'NO_SUBREDDIT'), log('2', 'ok')] as never[],
      [],
      [],
      { scanned: 4, eligible: 1, blocked: 0 },
    );
    expect(d.subs).toEqual([
      { sub: 'unknown', count: 1, ids: ['1'], eligible: 0, reasons: ['NO_SUBREDDIT'] },
      { sub: 'ok', count: 1, ids: ['2'], eligible: 1, reasons: [] },
    ]);
    expect(d.newSubs).toEqual(['ok']);
  });

  it('labels blocked and comment groups in the message', () => {
    const d = buildBlastDigest(
      'c1',
      [
        log('1', 'cats'),
        log('2', 'junk', 'BLOCKED'),
        log('3', 'junk', 'BLOCKED'),
        log('4', 'somevid', 'SKIPPED_COMMENT'),
        log('5', null, 'NO_SUBREDDIT'),
      ],
      ['junk'],
      ['cats'],
      { scanned: 5, eligible: 1, blocked: 2 },
    );
    const msg = formatDigestMessage(d);
    expect(msg).toContain('• r/cats x1 (1)');
    expect(msg).toContain('• r/junk x2 [BLOCKED] (2, 3)');
    expect(msg).toContain('• r/somevid x1 [comment] (4)');
    expect(msg).toContain('• unknown subreddit x1 [NO_SUBREDDIT] (5)');
    expect(d.newSubs).toEqual([]);
  });

  it('says nothing eligible when every group is tagged', () => {
    const d = buildBlastDigest(
      'c1',
      [log('1', 'junk', 'BLOCKED'), log('2', 'junk', 'BLOCKED')],
      ['junk'],
      [],
      { scanned: 2, eligible: 0, blocked: 2 },
    );
    const msg = formatDigestMessage(d);
    expect(msg).toContain('0 eligible');
    expect(msg).toContain('• r/junk x2 [BLOCKED] (1, 2)');
    expect(msg).toContain('Nothing eligible');
    expect(d.newSubs).toEqual([]);
  });

  it('says nothing listed for a fully empty drop', () => {
    const d = buildBlastDigest('c1', [], [], [], { scanned: 0, eligible: 0, blocked: 0 });
    expect(d.subs).toEqual([]);
    expect(d.newSubs).toEqual([]);
    const msg = formatDigestMessage(d);
    expect(msg).toContain('0 eligible (0 scanned, 0 blocked)');
    expect(msg).toContain('No posts listed this drop.');
    expect(msg.length).toBeLessThanOrEqual(2000);
    expect(buildDigestButtons(d)).toHaveLength(1);
  });
});

describe('formatDigestMessage', () => {
  it('fits in a DM and highlights new subs', () => {
    const d = buildBlastDigest('c1', [log('1', 'cats'), log('2', 'newsub')], [], ['cats'], {
      scanned: 2,
      eligible: 2,
      blocked: 0,
    });
    const msg = formatDigestMessage(d);
    expect(msg.length).toBeLessThanOrEqual(2000);
    expect(msg).toContain('r/newsub');
    expect(msg).toContain('NEW');
  });

  it('truncates very long digests', () => {
    const logs = Array.from({ length: 300 }, (_, i) => log(String(i), `sub${i}`));
    const d = buildBlastDigest('c1', logs, [], [], { scanned: 300, eligible: 300, blocked: 0 });
    expect(formatDigestMessage(d).length).toBeLessThanOrEqual(2000);
  });
});

describe('buildDigestButtons', () => {
  it('always renders Blast + Hold first, then block buttons', () => {
    const d = buildBlastDigest('burst-2026-09-17-02-49-ab12cd', [log('1', 'newsub')], [], [], {
      scanned: 1,
      eligible: 1,
      blocked: 0,
    });
    const rows = buildDigestButtons(d);
    expect(rows[0].map((b) => b.action)).toEqual(['go', 'hold']);
    expect(rows[0][0].customId).toBe('blast:go:burst-2026-09-17-02-49-ab12cd');
    expect(rows[1][0]).toMatchObject({ action: 'block', style: 'danger' });
    expect(rows[1][0].customId).toContain('newsub');
  });

  it('caps block buttons and rows at Discord limits', () => {
    const logs = Array.from({ length: MAX_BLOCK_BUTTONS + 10 }, (_, i) => log(String(i), `s${i}`));
    const d = buildBlastDigest('c1', logs, [], [], {
      scanned: logs.length,
      eligible: logs.length,
      blocked: 0,
    });
    const rows = buildDigestButtons(d);
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(rows.flat().filter((b) => b.action === 'block').length).toBeLessThanOrEqual(MAX_BLOCK_BUTTONS);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(5);
  });

  it('renders no block row when nothing is new', () => {
    const d = buildBlastDigest('c1', [log('1', 'cats')], [], ['cats'], {
      scanned: 1,
      eligible: 1,
      blocked: 0,
    });
    expect(buildDigestButtons(d)).toHaveLength(1);
  });
});

describe('parseBlastButtonId', () => {
  it('parses go/hold/block ids', () => {
    expect(parseBlastButtonId('blast:go:burst-2026-09-17-02-49-ab12cd')).toEqual({
      action: 'go',
      cycleId: 'burst-2026-09-17-02-49-ab12cd',
      sub: null,
    });
    expect(parseBlastButtonId('blast:hold:c1')).toEqual({ action: 'hold', cycleId: 'c1', sub: null });
    expect(parseBlastButtonId('blast:block:c1:weirdsub')).toEqual({
      action: 'block',
      cycleId: 'c1',
      sub: 'weirdsub',
    });
  });

  it('rejects malformed or mismatched ids', () => {
    for (const bad of [
      '',
      'blast:go:',
      'blast:block:c1',
      'blast:go:c1:extra',
      'blast:nuke:c1',
      'delete-confirm-x',
      'blast:block:c1:UPPER',
      'blast:go:c1 has spaces',
      'blast-go-c1',
      'blast:block:c1:s1:s2',
      null,
      undefined,
    ]) {
      expect(parseBlastButtonId(bad as never)).toBeNull();
    }
  });
});

describe('buildReleaseInputs', () => {
  it('returns eligible logs newest-first with normalized subs', () => {
    const inputs = buildReleaseInputs([
      log('1', 'r/Cats'),
      log('2', 'Dogs', 'BLOCKED'),
      log('3', 'https://old.reddit.com/r/Birds/', 'ELIGIBLE', 'comment'),
    ]);
    expect(inputs).toEqual([
      { subTaskId: '3', type: 'comment', subreddit: 'birds', title: null },
      { subTaskId: '1', type: 'post', subreddit: 'cats', title: null },
    ]);
  });

  it('returns empty when nothing is eligible', () => {
    expect(buildReleaseInputs([log('1', 'x', 'FAILED')])).toEqual([]);
    expect(buildReleaseInputs([])).toEqual([]);
  });
});
