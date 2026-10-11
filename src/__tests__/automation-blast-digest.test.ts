/**
 * Pre-blast DM digest logic + embed rendering. Pure modules — no env or DB needed.
 */
import { EmbedBuilder } from 'discord.js';
import {
  buildBlastDigest,
  buildDigestButtons,
  buildReleaseInputs,
  isEligibleLogStatus,
  MAX_BLOCK_BUTTONS,
  parseBlastButtonId,
  reasonSymbol,
  BlastDigest,
  DigestTaskLog,
} from '../services/automation/blast-digest';
import { blastDigestEmbed } from '../bot/embeds';
import { COLORS } from '../config/constants';

function log(id: string, sub: string | null, status = 'ELIGIBLE', type = 'post'): DigestTaskLog {
  return { externalTaskId: id, taskType: type, subreddit: sub, status };
}

/** Rendered embed JSON for field-level assertions. */
function embedOf(digest: BlastDigest, banner: string | null = null): any {
  return (blastDigestEmbed(digest, banner) as EmbedBuilder).toJSON() as any;
}

function fieldOf(json: any, name: string): string | null {
  const f = (json.fields || []).find((x: any) => x.name === name);
  return f ? String(f.value) : null;
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

  it('labels blocked and comment groups in the breakdown field', () => {
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
    const breakdown = fieldOf(embedOf(d), 'Breakdown')!;
    expect(breakdown).toContain('🟢');
    expect(breakdown).toContain('r/cats');
    expect(breakdown).toContain('🚫');
    expect(breakdown).toContain('r/junk');
    expect(breakdown).toContain('BLOCKED');
    expect(breakdown).toContain('💬');
    expect(breakdown).toContain('comment');
    expect(breakdown).toContain('❔');
    expect(breakdown).toContain('NO_SUBREDDIT');
    expect(breakdown).not.toContain('(1)');
    expect(breakdown).not.toContain('(2, 3)');
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
    const json = embedOf(d);
    expect(json.title).toBe('🚫 Nothing to do');
    expect(json.color).toBe(COLORS.INFO);
    expect(fieldOf(json, 'Breakdown')).toContain('r/junk');
    expect(fieldOf(json, '🆕 New subreddits')).toBeNull();
    expect(d.newSubs).toEqual([]);
  });

  it('says nothing listed for a fully empty drop', () => {
    const d = buildBlastDigest('c1', [], [], [], { scanned: 0, eligible: 0, blocked: 0 });
    expect(d.subs).toEqual([]);
    expect(d.newSubs).toEqual([]);
    const json = embedOf(d);
    expect(json.title).toBe('🚫 Nothing to do');
    expect(json.description).toContain('0 scanned, 0 blocked');
    expect(json.description).toContain('No posts listed this drop.');
    expect(fieldOf(json, 'Breakdown')).toBeNull();
    expect(json.footer.text).toBe('c1');
    expect(buildDigestButtons(d)).toHaveLength(1);
  });
});

describe('blastDigestEmbed', () => {
  it('titles green with counts when eligible', () => {
    const d = buildBlastDigest('c1', [log('1', 'cats'), log('2', 'newsub')], [], ['cats'], {
      scanned: 2,
      eligible: 2,
      blocked: 0,
    });
    const json = embedOf(d);
    expect(json.title).toBe('🟢 2 eligible — opening blast');
    expect(json.color).toBe(COLORS.SUCCESS);
    expect(json.description).toContain('2 scanned, 0 blocked');
    expect(fieldOf(json, '🆕 New subreddits')).toContain('r/newsub');
    expect(json.footer.text).toBe('c1');
    expect(json.timestamp).toBeTruthy();
  });

  it('titles amber when a held name needs a look (no eligible posts)', () => {
    const d = buildBlastDigest(
      'c1',
      [{ externalTaskId: '1', taskType: 'post', subreddit: 'moderators', status: 'QUARANTINED' }],
      [],
      [],
      { scanned: 1, eligible: 0, blocked: 0 },
    );
    const json = embedOf(d);
    expect(json.title).toBe('⚠️ Needs a look');
    expect(json.color).toBe(COLORS.WARNING);
    expect(fieldOf(json, '🔎 Needs a name check')).toContain('allow r/x');
  });

  it('puts the banner in the author line and the mention in the description', () => {
    const d = buildBlastDigest('c1', [log('1', 'cats')], [], [], { scanned: 1, eligible: 1, blocked: 0 });
    const hourly = embedOf(d, 'Scheduled hourly scan — same rules as the automatic round.');
    expect(hourly.author.name).toBe('Scheduled hourly scan — same rules as the automatic round.');
    expect(hourly.description).not.toContain('<@');
    const manual = embedOf(d, 'Manual scan (requested by <@123>) — same rules as the automatic round.');
    expect(manual.author.name).toBe('Manual scan — same rules as the automatic round.');
    expect(manual.description).toContain('<@123> requested this scan.');
    expect(embedOf(d, null).author).toBeUndefined();
  });

  it('truncates a long breakdown within the field limit', () => {
    const logs = Array.from({ length: 300 }, (_, i) => log(String(i), `sub${i}`));
    const d = buildBlastDigest('c1', logs, [], [], { scanned: 300, eligible: 300, blocked: 0 });
    const breakdown = fieldOf(embedOf(d), 'Breakdown')!;
    expect(breakdown.length).toBeLessThanOrEqual(1024);
    expect(breakdown).toContain('…and ');
    expect(breakdown).toContain('more');
  });

  it('omits empty-category fields', () => {
    const d = buildBlastDigest('c1', [log('1', 'cats')], [], ['cats'], {
      scanned: 1,
      eligible: 1,
      blocked: 0,
    });
    const json = embedOf(d);
    expect(fieldOf(json, 'Breakdown')).toContain('r/cats');
    expect(fieldOf(json, '🆕 New subreddits')).toBeNull();
    expect(fieldOf(json, '🔎 Needs a name check')).toBeNull();
  });
});

describe('reasonSymbol', () => {
  it('maps every known tag, neutral for the unknown', () => {
    expect(reasonSymbol('QUARANTINED')).toBe('🔎');
    expect(reasonSymbol('SKIPPED_COMMENT')).toBe('💬');
    expect(reasonSymbol('BLOCKED')).toBe('🚫');
    expect(reasonSymbol('NO_SUBREDDIT')).toBe('❔');
    expect(reasonSymbol('ELIGIBLE')).toBe('🟢');
    expect(reasonSymbol('SOME_FUTURE_STATUS')).toBe('⚪');
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

  it('hides Blast/Hold on request while Block buttons stay', () => {
    const d = buildBlastDigest('burst-2026-09-17-02-49-ab12cd', [log('1', 'newsub'), log('2', 'cats')], [], [], {
      scanned: 2,
      eligible: 2,
      blocked: 0,
    });
    const rows = buildDigestButtons(d, { hideGoHold: true });
    expect(rows.flat().map((b) => b.action)).not.toContain('go');
    expect(rows.flat().map((b) => b.action)).not.toContain('hold');
    expect(rows.flat().filter((b) => b.action === 'block').map((b) => b.label)).toEqual([
      'Block r/newsub',
      'Block r/cats',
    ]);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(5);
  });

  it('Block buttons render in every case (released, empty, or hidden row 0)', () => {
    const withBlocks = buildBlastDigest('c1', [log('1', 'cats')], [], [], {
      scanned: 1,
      eligible: 1,
      blocked: 0,
    });
    // default (row 0 shown) and suppressed: Block r/cats present in both
    for (const opts of [undefined, { hideGoHold: true }]) {
      const labels = buildDigestButtons(withBlocks, opts).flat().map((b) => b.label);
      expect(labels).toContain('Block r/cats');
    }
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

describe('quarantined subs (NAME-CHECK)', () => {
  function qlog(id: string, sub: string): DigestTaskLog {
    return { externalTaskId: id, taskType: 'post', subreddit: sub, status: 'QUARANTINED' };
  }

  it('tags quarantined groups, never counts them eligible', () => {
    const d = buildBlastDigest(
      'c1',
      [qlog('1', 'moderators'), qlog('2', 'moderators'), log('3', 'cats')],
      [],
      [],
      { scanned: 3, eligible: 1, blocked: 0 },
    );
    const mod = d.subs.find((s) => s.sub === 'moderators')!;
    expect(mod.eligible).toBe(0);
    expect(mod.reasons).toEqual(['NAME-CHECK']);
    expect(d.newSubs).toEqual(['cats']);
    const json = embedOf(d);
    expect(json.title).toBe('🟢 1 eligible — opening blast');
    const breakdown = fieldOf(json, 'Breakdown')!;
    expect(breakdown).toContain('🔎');
    expect(breakdown).toContain('moderators');
    expect(breakdown).toContain('NAME-CHECK');
    expect(breakdown).not.toContain('(1, 2)');
    expect(fieldOf(json, '🔎 Needs a name check')).toContain('allow r/x');
    expect(fieldOf(json, '🆕 New subreddits')).toContain('r/cats');
  });

  it('offers block buttons for quarantined subs, never release inputs', () => {
    const d = buildBlastDigest('c1', [qlog('1', 'moderators')], [], [], {
      scanned: 1,
      eligible: 0,
      blocked: 0,
    });
    expect(d.blockableSubs).toEqual(['moderators']);
    expect(buildReleaseInputs([qlog('1', 'moderators')])).toEqual([]);
  });

  it('quarantine is not an eligible log status', () => {
    expect(isEligibleLogStatus('QUARANTINED')).toBe(false);
    expect(isEligibleLogStatus('ELIGIBLE')).toBe(true);
  });
});

describe('restart batch (fresh scan while a batch is live)', () => {
  const CYCLE = 'burst-2026-10-01-12:35-mupioeqv';

  it('marks the digest restartable and carries the intent in the button id', () => {
    const logs = [log('1', 'cats'), log('2', 'dogs')];
    const base = { scanned: 2, eligible: 2, blocked: 0 };
    const plain = buildBlastDigest(CYCLE, logs, [], [], base);
    expect(plain.restartAvailable).toBe(false);
    expect(buildDigestButtons(plain)[0][0]).toMatchObject({ action: 'go', label: 'Blast now' });

    const restartable = buildBlastDigest(CYCLE, logs, [], [], base, { restartAvailable: true });
    expect(restartable.restartAvailable).toBe(true);
    const rows = buildDigestButtons(restartable);
    expect(rows[0][0]).toMatchObject({ action: 'go', label: 'Restart batch' });
    expect(rows[0][0].customId).toBe(`blast:go:${CYCLE}:restart`);
    // The colon-bearing cycle id must still round-trip through the parser.
    expect(parseBlastButtonId(rows[0][0].customId)).toEqual({
      action: 'go',
      cycleId: CYCLE,
      sub: null,
      restart: true,
    });
  });

  it('parses restart on plain go/hold/block ids as false', () => {
    expect(parseBlastButtonId(`blast:go:${CYCLE}`)?.restart).toBe(false);
    expect(parseBlastButtonId(`blast:hold:${CYCLE}`)?.restart).toBe(false);
    expect(parseBlastButtonId(`blast:block:${CYCLE}:cats`)).toEqual({
      action: 'block',
      cycleId: CYCLE,
      sub: 'cats',
      restart: false,
    });
  });

  it('rejects malformed restart ids', () => {
    for (const bad of ['blast:go:', 'blast:go::restart', 'blast:hold:c1:restart:restart']) {
      expect(parseBlastButtonId(bad)).toBeNull();
    }
  });

  it('excludes already-handled tasks from a restart release', () => {
    const inputs = buildReleaseInputs(
      [log('1', 'cats'), log('2', 'dogs'), log('3', 'birds')],
      new Set(['2']),
    );
    // Newest-first, minus the task a previous winner already holds.
    expect(inputs.map((i) => i.subTaskId)).toEqual(['3', '1']);
  });
});

describe('parseBlastButtonId', () => {
  it('parses go/hold/block ids', () => {
    expect(parseBlastButtonId('blast:go:burst-2026-09-17-02-49-ab12cd')).toEqual({
      action: 'go',
      cycleId: 'burst-2026-09-17-02-49-ab12cd',
      sub: null,
      restart: false,
    });
    expect(parseBlastButtonId('blast:hold:c1')).toEqual({
      action: 'hold',
      cycleId: 'c1',
      sub: null,
      restart: false,
    });
    expect(parseBlastButtonId('blast:block:c1:weirdsub')).toEqual({
      action: 'block',
      cycleId: 'c1',
      sub: 'weirdsub',
      restart: false,
    });
  });

  it('parses real cycle ids (HH:MM colon inside the id)', () => {
    expect(parseBlastButtonId('blast:go:burst-2026-09-20-09:17-mu9lra8m')).toEqual({
      action: 'go',
      cycleId: 'burst-2026-09-20-09:17-mu9lra8m',
      sub: null,
      restart: false,
    });
    expect(parseBlastButtonId('blast:hold:burst-2026-09-20-09:17-mu9lra8m')).toEqual({
      action: 'hold',
      cycleId: 'burst-2026-09-20-09:17-mu9lra8m',
      sub: null,
      restart: false,
    });
    expect(parseBlastButtonId('blast:block:burst-2026-09-20-09:17-mu9lra8m:aidiscussion')).toEqual({
      action: 'block',
      cycleId: 'burst-2026-09-20-09:17-mu9lra8m',
      sub: 'aidiscussion',
      restart: false,
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
      { subTaskId: '3', type: 'comment', subreddit: 'birds', title: null },
      { subTaskId: '1', type: 'post', subreddit: 'cats', title: null },
    ]);
  });

  it('returns empty when nothing is eligible', () => {
    expect(buildReleaseInputs([log('1', 'x', 'FAILED')])).toEqual([]);
    expect(buildReleaseInputs([])).toEqual([]);
  });
});
