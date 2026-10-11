/**
 * The burst report used to be capped at 20 tasks, so a drop with more than 20
 * eligible posts silently lost the overflow: those tasks never reached a cycle,
 * so they could never enter a blast pool, be claimed, or be assigned. The cap
 * is now 200, which required three things to be correct and none of them to be
 * wrong in a new way.
 *
 *  1. The request schema must actually accept a large report (it rejects with
 *     400 above the limit, and the watcher retries that forever).
 *  2. The batched validator must reach the same verdict as the single-task one
 *     for every input, since it exists only to save round-trips.
 *  3. The downstream consumers must already be bounded, or lifting the cap
 *     would break a Discord limit somewhere.
 */
import { burstSchema } from '../api/routes/automation.schemas';
import { evaluateForBurst, validateDetectedTask } from '../services/automation/validator.service';
import { normalizeSubreddit } from '../services/automation/subreddit';
import { buildBlastDigest, buildDigestButtons, buildReleaseInputs, MAX_BLOCK_BUTTONS } from '../services/automation/blast-digest';
import { blastDigestEmbed } from '../bot/embeds';
import { automationRepository, taskRepository } from '../database/repositories';
import type { DetectedGoPartTimeTask } from '../types';

jest.mock('../database/repositories', () => ({
  automationRepository: { isBlocked: jest.fn(), listBlocked: jest.fn() },
  taskRepository: { findBySourceExternal: jest.fn() },
}));

function detected(over: Partial<DetectedGoPartTimeTask> = {}): DetectedGoPartTimeTask {
  return {
    subTaskId: '100',
    taskId: '1',
    type: 'post',
    subreddit: 'TestSub',
    title: null,
    postLink: null,
    contentHtml: '',
    images: [],
    payment: null,
    deadline: null,
    karmaLimit: null,
    earnings: null,
    ...over,
  } as DetectedGoPartTimeTask;
}

function burstTask(i: number, over: Record<string, unknown> = {}) {
  return { subTaskId: String(1000 + i), type: 'post' as const, subreddit: 'Sub' + i, ...over };
}

describe('POST /automation/burst task limit', () => {
  it('accepts a report larger than the old 20-task cap', () => {
    const result = burstSchema.safeParse({ tasks: Array.from({ length: 21 }, (_, i) => burstTask(i)) });
    expect(result.success).toBe(true);
  });

  it('accepts a full 200-task report', () => {
    const result = burstSchema.safeParse({ tasks: Array.from({ length: 200 }, (_, i) => burstTask(i)) });
    expect(result.success).toBe(true);
  });

  it('still refuses an absurd payload rather than accepting anything', () => {
    const result = burstSchema.safeParse({ tasks: Array.from({ length: 201 }, (_, i) => burstTask(i)) });
    expect(result.success).toBe(false);
  });

  it('still validates each task shape', () => {
    expect(burstSchema.safeParse({ tasks: [{ subTaskId: 'abc', type: 'post' }] }).success).toBe(false);
    expect(burstSchema.safeParse({ tasks: [{ subTaskId: '1', type: 'video' }] }).success).toBe(false);
    expect(burstSchema.safeParse({ tasks: [{ subTaskId: '1', type: 'post', subreddit: 'x'.repeat(65) }] }).success).toBe(false);
  });

  it('still accepts an empty report (the "nothing listed" tail sweep)', () => {
    expect(burstSchema.safeParse({ tasks: [] }).success).toBe(true);
  });

  it('coerces numeric sub_task ids, as the watcher may send them', () => {
    const result = burstSchema.safeParse({ tasks: [{ subTaskId: 4242, type: 'post' }] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tasks[0].subTaskId).toBe('4242');
  });
});

describe('evaluateForBurst == validateDetectedTask(skipDuplicate)', () => {
  const CASES: { label: string; task: DetectedGoPartTimeTask; blocked: boolean }[] = [
    { label: 'plain post', task: detected(), blocked: false },
    { label: 'blocked post', task: detected(), blocked: true },
    { label: 'comment', task: detected({ type: 'comment' }), blocked: false },
    { label: 'blocked comment (comment rule wins)', task: detected({ type: 'comment' }), blocked: true },
    { label: 'null subreddit', task: detected({ subreddit: null }), blocked: false },
    { label: 'empty subreddit', task: detected({ subreddit: '' }), blocked: false },
    { label: 'r/ prefixed subreddit', task: detected({ subreddit: 'r/TestSub' }), blocked: true },
    { label: 'mixed case subreddit, blocked', task: detected({ subreddit: 'TeStSuB' }), blocked: true },
    { label: 'mixed case subreddit, not blocked', task: detected({ subreddit: 'TeStSuB' }), blocked: false },
    { label: 'reddit url form', task: detected({ subreddit: 'https://www.reddit.com/r/TestSub/' }), blocked: true },
    { label: 'unreadable subreddit (too long)', task: detected({ subreddit: 'x'.repeat(40) }), blocked: false },
    { label: 'subreddit with a space is rejected by the charset gate', task: detected({ subreddit: 'two words' }), blocked: false },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (taskRepository.findBySourceExternal as jest.Mock).mockResolvedValue(null);
  });

  it.each(CASES)('$label: identical reason and eligibility', async ({ task, blocked }) => {
    (automationRepository.isBlocked as jest.Mock).mockResolvedValue(blocked);
    const single = await validateDetectedTask(task, { skipDuplicate: true });
    const batched = evaluateForBurst(task, blocked ? new Set(['testsub']) : new Set());
    expect(batched.reason).toBe(single.reason);
    expect(batched.eligible).toBe(single.eligible);
  });

  it('agrees across a matrix of subreddit shapes and blocked sets', async () => {
    const subs = [null, '', 'TestSub', 'r/TestSub', 'TeStSuB', 'Other', 'https://reddit.com/r/TestSub', 'x'.repeat(40), 'two words'];
    const types = ['post', 'comment'] as const;
    const blockedSets = [new Set<string>(), new Set(['testsub']), new Set(['other']), new Set(['testsub', 'other'])];

    for (const subreddit of subs) {
      for (const type of types) {
        for (const blockedSubs of blockedSets) {
          const task = detected({ subreddit, type });
          // The mocked point lookup must answer the way the real one would, so
          // normalize exactly the way the validator does.
          const normalized = normalizeSubreddit(subreddit);
          (automationRepository.isBlocked as jest.Mock).mockResolvedValue(
            normalized !== null && blockedSubs.has(normalized),
          );
          const single = await validateDetectedTask(task, { skipDuplicate: true });
          const batched = evaluateForBurst(task, blockedSubs);
          expect({ subreddit, type, r: batched.reason }).toEqual({ subreddit, type, r: single.reason });
        }
      }
    }
  });
});

describe('Tier-0 flagging agrees and never blocks', () => {
  // Injected lists: production lists live in constants — the flagging path is
  // exercised here with explicit sample terms instead.
  const LISTS = { sexualHigh: ['escort'], sexualAmbiguous: [], vapeHigh: ['vape'], vapeAmbiguous: [] };
  const SEEN = new Set<string>(['oldsub']);

  function flagged(over: Partial<DetectedGoPartTimeTask> = {}): DetectedGoPartTimeTask {
    return detected({ subreddit: 'FreshSub', title: 'my vape pen review', ...over });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (taskRepository.findBySourceExternal as jest.Mock).mockResolvedValue(null);
    (automationRepository.isBlocked as jest.Mock).mockResolvedValue(false);
  });

  it('both validators flag an unseen sub with a title hit — identically', async () => {
    const task = flagged();
    const single = await validateDetectedTask(task, { skipDuplicate: true, seenSubs: SEEN, screenLists: LISTS });
    const batched = evaluateForBurst(task, new Set(), SEEN, LISTS);
    for (const v of [single, batched]) {
      expect(v.eligible).toBe(true);
      expect(v.reason).toBe('ELIGIBLE');
      expect(v.needsContentReview).toBe(true);
      expect(v.screenSignal).toBe('vape');
    }
  });

  it('Tier-0 alone never blocks: flagged tasks stay ELIGIBLE', async () => {
    const task = flagged();
    const single = await validateDetectedTask(task, { skipDuplicate: true, seenSubs: SEEN, screenLists: LISTS });
    expect(single.eligible).toBe(true);
    const batched = evaluateForBurst(task, new Set(), SEEN, LISTS);
    expect(batched.eligible).toBe(true);
  });

  it('no flag for seen subs, clean titles, or non-posts — identically', async () => {
    const cases: DetectedGoPartTimeTask[] = [
      flagged({ subreddit: 'r/OldSub' }),
      flagged({ title: 'cute cat pictures' }),
      flagged({ type: 'comment' }),
      flagged({ subreddit: null }),
    ];
    for (const task of cases) {
      const single = await validateDetectedTask(task, { skipDuplicate: true, seenSubs: SEEN, screenLists: LISTS });
      const batched = evaluateForBurst(task, new Set(), SEEN, LISTS);
      expect(batched.needsContentReview).toBe(single.needsContentReview);
      expect(batched.screenSignal).toBe(single.screenSignal);
      if (task.type === 'post' && task.subreddit) {
        expect(single.needsContentReview).toBeFalsy();
      }
    }
  });

  it('inactive without a seen set — identically (old behavior preserved)', async () => {
    const task = flagged();
    const single = await validateDetectedTask(task, { skipDuplicate: true, screenLists: LISTS });
    const batched = evaluateForBurst(task, new Set(), undefined, LISTS);
    expect(single.needsContentReview).toBeFalsy();
    expect(batched.needsContentReview).toBeFalsy();
    expect(single.eligible).toBe(true);
    expect(batched.eligible).toBe(true);
  });
});

describe('Tier-0 name verdicts agree and never write', () => {
  // Sample lists with the four-tier shape (production lists live in constants).
  const LISTS = {
    sexualHigh: ['porn'],
    sexualAmbiguous: [],
    vapeHigh: ['vape'],
    vapeAmbiguous: ['mod'],
  };
  const SEEN = new Set<string>(['oldsub']);
  const ALLOWED = new Set<string>(['cleared']);

  function named(over: Partial<DetectedGoPartTimeTask> = {}): DetectedGoPartTimeTask {
    return detected({ subreddit: 'vapeporn', title: 'cute cats', ...over });
  }

  function opts() {
    return { skipDuplicate: true as const, seenSubs: SEEN, screenLists: LISTS, allowedSubs: ALLOWED };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (taskRepository.findBySourceExternal as jest.Mock).mockResolvedValue(null);
    (automationRepository.isBlocked as jest.Mock).mockResolvedValue(false);
  });

  it('both flag a confident name identically (advisory — validators never write)', async () => {
    const task = named();
    const single = await validateDetectedTask(task, opts());
    const batched = evaluateForBurst(task, new Set(), SEEN, LISTS, ALLOWED);
    for (const v of [single, batched]) {
      expect(v.eligible).toBe(true);
      expect(v.needsContentReview).toBe(true);
      expect(v.nameVerdict).toBe('block');
      expect(v.nameMatched).toBe('porn');
      expect(v.nameSignal).toBe('sex');
    }
    expect(batched.nameVerdict).toBe(single.nameVerdict);
    expect(batched.nameMatched).toBe(single.nameMatched);
  });

  it('both quarantine a doubtful name identically, still eligible', async () => {
    const task = named({ subreddit: 'moderators' });
    const single = await validateDetectedTask(task, opts());
    const batched = evaluateForBurst(task, new Set(), SEEN, LISTS, ALLOWED);
    for (const v of [single, batched]) {
      expect(v.eligible).toBe(true);
      expect(v.nameVerdict).toBe('quarantine');
      expect(v.nameMatched).toBe('mod');
    }
  });

  it('an allowed sub skips name screening identically', async () => {
    const task = named({ subreddit: 'r/Cleared' });
    const single = await validateDetectedTask(task, opts());
    const batched = evaluateForBurst(task, new Set(), SEEN, LISTS, ALLOWED);
    expect(single.nameVerdict).toBeFalsy();
    expect(batched.nameVerdict).toBeFalsy();
    expect(single.eligible).toBe(true);
    expect(batched.eligible).toBe(true);
  });

  it('a seen sub skips name screening identically', async () => {
    const task = named({ subreddit: 'OldSub' });
    const single = await validateDetectedTask(task, opts());
    const batched = evaluateForBurst(task, new Set(), SEEN, LISTS, ALLOWED);
    expect(single.nameVerdict).toBeFalsy();
    expect(batched.nameVerdict).toBeFalsy();
  });
});

describe('downstream consumers tolerate more than 20 tasks', () => {
  const logs = Array.from({ length: 40 }, (_, i) => ({
    externalTaskId: String(1000 + i),
    taskType: 'post',
    subreddit: 'Sub' + (i % 12), // 12 distinct subs, more than the button cap
    status: i % 7 === 0 ? 'BLOCKED' : 'ELIGIBLE',
  }));

  it('the embed breakdown field fits Discord, not the task count', () => {
    const digest = buildBlastDigest('c1', logs, [], [], { scanned: 40, eligible: 34, blocked: 6 });
    const json = blastDigestEmbed(digest).toJSON() as any;
    const breakdown = (json.fields || []).find((f: any) => f.name === 'Breakdown');
    expect(breakdown.value.length).toBeLessThanOrEqual(1024);
    expect(digest.scanned).toBe(40);
    expect(digest.eligible).toBe(34);
  });

  it('block buttons stay within Discord 5x5 and the declared cap', () => {
    const digest = buildBlastDigest('c1', logs, [], [], { scanned: 40, eligible: 34, blocked: 6 });
    expect(digest.blockableSubs.length).toBeLessThanOrEqual(MAX_BLOCK_BUTTONS);
    const rows = buildDigestButtons(digest);
    // Row 0 is Blast + Hold, so at most 4 more rows of block buttons.
    expect(rows.length).toBeLessThanOrEqual(5);
    const total = rows.reduce((n, r) => n + r.length, 0);
    expect(total).toBeLessThanOrEqual(25);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(5);
  });

  it('the release path (the DM Blast now button) is uncapped', () => {
    const inputs = buildReleaseInputs(logs);
    // Every ELIGIBLE log is released; nothing is silently dropped.
    expect(inputs).toHaveLength(logs.filter((l) => l.status === 'ELIGIBLE').length);
    expect(inputs.length).toBeGreaterThan(20);
  });

  it('a 200-task drop still yields a releasable set of 200', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      externalTaskId: String(i),
      taskType: 'post',
      subreddit: 'Sub' + (i % 50),
      status: 'ELIGIBLE',
    }));
    expect(buildReleaseInputs(many)).toHaveLength(200);
  });
});
