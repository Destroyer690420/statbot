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
  MAX_TASKS_PER_SUB,
  mediaBadge,
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
      { sub: 'cats', count: 2, ids: ['1', '2'], tasks: [{ id: '1', media: null }, { id: '2', media: null }], eligible: 2, reasons: [] },
      { sub: 'dogs', count: 1, ids: ['3'], tasks: [{ id: '3', media: null }], eligible: 1, reasons: [] },
      { sub: 'blockedsub', count: 1, ids: ['4'], tasks: [{ id: '4', media: null }], eligible: 0, reasons: ['BLOCKED'] },
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
      { sub: 'cats', count: 1, ids: ['1'], tasks: [{ id: '1', media: null }], eligible: 1, reasons: [] },
      { sub: 'brandnew', count: 1, ids: ['2'], tasks: [{ id: '2', media: null }], eligible: 1, reasons: [] },
      { sub: 'unknown', count: 1, ids: ['3'], tasks: [{ id: '3', media: null }], eligible: 0, reasons: ['NO_SUBREDDIT'] },
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
      { sub: 'unknown', count: 1, ids: ['1'], tasks: [{ id: '1', media: null }], eligible: 0, reasons: ['NO_SUBREDDIT'] },
      { sub: 'ok', count: 1, ids: ['2'], tasks: [{ id: '2', media: null }], eligible: 1, reasons: [] },
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
    expect(msg).toContain('✅ r/cats x1 — tap Blast to release');
    expect(msg).toContain('📝 `1`');
    expect(msg).toContain('⛔ r/junk x2 [BLOCKED]');
    expect(msg).toContain('⛔ r/somevid x1 [comment]');
    expect(msg).toContain('⛔ unknown subreddit x1 [NO_SUBREDDIT]');
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
    expect(msg).toContain('⛔ r/junk x2 [BLOCKED]');
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

  it('renders block buttons for seen-before subs too (only newness line stays gated)', () => {
    const d = buildBlastDigest('c1', [log('1', 'cats')], [], ['cats'], {
      scanned: 1,
      eligible: 1,
      blocked: 0,
    });
    const rows = buildDigestButtons(d);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toMatchObject({ action: 'block' });
    expect(rows[1][0].customId).toContain('cats');
  });

  it('never renders block buttons for unknown or already-blocked subs', () => {
    const d = buildBlastDigest(
      'c1',
      [log('1', 'junk', 'BLOCKED'), log('2', null, 'NO_SUBREDDIT')],
      ['junk'],
      [],
      { scanned: 2, eligible: 0, blocked: 1 },
    );
    expect(d.blockableSubs).toEqual([]);
    expect(buildDigestButtons(d)).toHaveLength(1);
  });
});

describe('blockableSubs', () => {
  it('covers every listed sub, eligible first, unknown and blocked excluded', () => {
    const d = buildBlastDigest(
      'c1',
      [
        log('1', 'seencomment', 'SKIPPED_COMMENT'),
        log('2', 'seenyet', 'ELIGIBLE'),
        log('3', 'junk', 'BLOCKED'),
        log('4', null, 'NO_SUBREDDIT'),
        log('5', 'fresh', 'ELIGIBLE'),
      ],
      ['junk'],
      ['seenyet', 'seencomment'],
      { scanned: 5, eligible: 2, blocked: 1 },
    );
    // seen-before eligible + brand-new eligible first, then tagged.
    expect(d.blockableSubs).toEqual(['seenyet', 'fresh', 'seencomment']);
  });

  it('caps at MAX_BLOCK_BUTTONS with Blast + Hold intact', () => {
    const logs = Array.from({ length: MAX_BLOCK_BUTTONS + 10 }, (_, i) => log(String(i), `s${i}`));
    const d = buildBlastDigest('c1', logs, [], [], {
      scanned: logs.length,
      eligible: logs.length,
      blocked: 0,
    });
    expect(d.blockableSubs).toHaveLength(MAX_BLOCK_BUTTONS);
    const rows = buildDigestButtons(d);
    expect(rows[0].map((b) => b.action)).toEqual(['go', 'hold']);
    expect(rows.flat().filter((b) => b.action === 'block')).toHaveLength(MAX_BLOCK_BUTTONS);
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

  it('parses real cycle ids (HH:MM colon inside the id)', () => {
    expect(parseBlastButtonId('blast:go:burst-2026-09-20-09:17-mu9lra8m')).toEqual({
      action: 'go',
      cycleId: 'burst-2026-09-20-09:17-mu9lra8m',
      sub: null,
    });
    expect(parseBlastButtonId('blast:hold:burst-2026-09-20-09:17-mu9lra8m')).toEqual({
      action: 'hold',
      cycleId: 'burst-2026-09-20-09:17-mu9lra8m',
      sub: null,
    });
    expect(parseBlastButtonId('blast:block:burst-2026-09-20-09:17-mu9lra8m:aidiscussion')).toEqual({
      action: 'block',
      cycleId: 'burst-2026-09-20-09:17-mu9lra8m',
      sub: 'aidiscussion',
    });
    // Round-trip: every id buildDigestButtons emits must parse back.
    const d = {
      cycleId: 'burst-2026-09-20-09:17-mu9lra8m',
      scanned: 2,
      eligible: 1,
      blocked: 1,
      subs: [],
      newSubs: ['aidiscussion'],
      blockableSubs: ['aidiscussion'],
    };
    for (const row of buildDigestButtons(d)) {
      for (const b of row) {
        expect(parseBlastButtonId(b.customId)).not.toBeNull();
      }
    }
  });

  it('rejects malformed or mismatched ids', () => {
    for (const bad of [
      '',
      'blast:go:',
      'blast:block:c1',
      'blast:go:c1:ex:tra',
      'blast:block:c1:s1:s2:s3',
      'blast:nuke:c1',
      'delete-confirm-x',
      'blast:block:c1:UPPER',
      'blast:go:c1 has spaces',
      'blast-go-c1',
      'blast:block::weirdsub',
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
      { subTaskId: '3', type: 'comment', subreddit: 'birds', title: null, media: null },
      { subTaskId: '1', type: 'post', subreddit: 'cats', title: null, media: null },
    ]);
  });

  it('returns empty when nothing is eligible', () => {
    expect(buildReleaseInputs([log('1', 'x', 'FAILED')])).toEqual([]);
    expect(buildReleaseInputs([])).toEqual([]);
  });
});

describe('mediaBadge', () => {
  it('maps image/video to badges, everything else to text', () => {
    expect(mediaBadge('image')).toBe('🖼️');
    expect(mediaBadge('video')).toBe('🎬');
    expect(mediaBadge(null)).toBe('📝');
    expect(mediaBadge(undefined)).toBe('📝');
    expect(mediaBadge('bogus')).toBe('📝');
  });
});

describe('per-task media lines', () => {
  function mediaLog(id: string, sub: string, media: string | null): DigestTaskLog {
    return { externalTaskId: id, taskType: 'post', subreddit: sub, status: 'ELIGIBLE', media };
  }

  it('renders one badge line per task under its sub header', () => {
    const d = buildBlastDigest(
      'c1',
      [mediaLog('1', 'cats', 'image'), mediaLog('2', 'cats', 'video'), mediaLog('3', 'cats', null)],
      [],
      [],
      { scanned: 3, eligible: 3, blocked: 0 },
    );
    const msg = formatDigestMessage(d);
    expect(msg).toContain('✅ r/cats x3');
    expect(msg).toContain('🖼️ `1`');
    expect(msg).toContain('🎬 `2`');
    expect(msg).toContain('📝 `3`');
  });

  it('collapses past MAX_TASKS_PER_SUB with a +N more line', () => {
    const logs = Array.from({ length: MAX_TASKS_PER_SUB + 4 }, (_, i) => mediaLog(String(i), 'cats', null));
    const d = buildBlastDigest('c1', logs, [], [], {
      scanned: logs.length,
      eligible: logs.length,
      blocked: 0,
    });
    const msg = formatDigestMessage(d);
    expect(msg).toContain('+4 more');
    expect(msg).toContain('✅ r/cats x12');
  });

  it('keeps headers and closer when truncating huge digests', () => {
    const logs = Array.from({ length: 300 }, (_, i) => mediaLog(String(i), 'sub' + i, i % 2 ? 'image' : 'video'));
    const d = buildBlastDigest('c1', logs, [], [], { scanned: 300, eligible: 300, blocked: 0 });
    const msg = formatDigestMessage(d);
    expect(msg.length).toBeLessThanOrEqual(2000);
    expect(msg).toContain('Drop c1: 300 eligible');
    expect(msg).toContain('Tapping Blast releases');
  });

  it('carries media through blockable subs and release inputs', () => {
    const d = buildBlastDigest('c1', [mediaLog('1', 'cats', 'video')], [], [], {
      scanned: 1,
      eligible: 1,
      blocked: 0,
    });
    expect(d.blockableSubs).toEqual(['cats']);
    const asLogs: DigestTaskLog[] = d.subs.flatMap((s) =>
      s.tasks.map((t) => ({ externalTaskId: t.id, taskType: 'post', subreddit: 'cats', status: 'ELIGIBLE', media: t.media })),
    );
    expect(buildReleaseInputs(asLogs)).toEqual([
      { subTaskId: '1', type: 'post', subreddit: 'cats', title: null, media: 'video' },
    ]);
  });
});
