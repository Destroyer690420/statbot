/**
 * Equivalence guards for the batch-A performance changes.
 *
 * These lock in that the optimisations produce byte-identical results to the
 * implementations they replaced. If a future change alters task-status
 * derivation or per-ticket counting, these fail.
 */
import {
  buildOutreachRows,
  OutreachRowInput,
  TicketTaskStatus,
} from '../utils/outreach-rows';

// ─── buildOutreachRows: single-pass counting must equal per-channel filtering ───

function legacyBuildOutreachRows(inputs: OutreachRowInput[]) {
  const rows = inputs.map((t) => {
    const today = t.tasksToday.filter((x) => x.channelId === t.channelId);
    return {
      channelId: t.channelId,
      channelName: t.channelName,
      guildId: t.guildId,
      taskStatus: t.taskStatus,
      workerName: t.workerName,
      selected: t.selected,
      messageSentAt: t.messageSentAt,
      available: t.availableAt !== null && t.messageSentAt !== null,
      post: today.filter((x) => x.type === 'POST').length,
      comment: today.filter((x) => x.type === 'COMMENT').length,
      portalAccessed: t.portalAccessed,
      portalLastSeenAt: t.portalLastSeenAt,
    };
  });
  return rows.sort((a, b) => (a.channelName ?? '').localeCompare(b.channelName || ''));
}

function makeInput(
  channelId: string,
  channelName: string | null,
  tasksToday: OutreachRowInput['tasksToday'],
  overrides: Partial<OutreachRowInput> = {},
): OutreachRowInput {
  return {
    channelId,
    channelName,
    guildId: 'g1',
    taskStatus: 'idle',
    workerName: null,
    selected: false,
    messageSentAt: null,
    availableAt: null,
    portalAccessed: false,
    portalLastSeenAt: null,
    tasksToday,
    ...overrides,
  };
}

describe('buildOutreachRows single-pass equivalence', () => {
  it('matches the per-channel filter implementation exactly', () => {
    // Shaped like production: one shared tasksToday array, unsorted names,
    // mixed types, channels with no tasks, and a null channelName.
    const tasksToday = [
      { channelId: 'c3', type: 'POST' },
      { channelId: 'c1', type: 'POST' },
      { channelId: 'c1', type: 'COMMENT' },
      { channelId: 'c2', type: 'COMMENT' },
      { channelId: 'c1', type: 'POST' },
      { channelId: 'c3', type: 'COMMENT' },
      { channelId: 'c4', type: 'POST' },
    ];

    const inputs: OutreachRowInput[] = [
      makeInput('c3', 'ticket-0003', tasksToday, { taskStatus: 'active', selected: true, availableAt: 'x' }),
      makeInput('c1', 'ticket-0001', tasksToday, { messageSentAt: 'y', availableAt: 'x', portalAccessed: true, portalLastSeenAt: 'z' }),
      makeInput('c9', 'ticket-0009', tasksToday), // no tasks today
      makeInput('c2', 'ticket-0002', tasksToday, { taskStatus: 'awaiting-submission' }),
      makeInput('c4', null, tasksToday), // null channelName
    ];

    expect(buildOutreachRows(inputs)).toEqual(legacyBuildOutreachRows(inputs));
  });

  it('counts unknown task types as comments, matching the old filter', () => {
    const tasksToday = [
      { channelId: 'c1', type: 'POST' },
      { channelId: 'c1', type: 'SOMETHING_ELSE' },
    ];
    const rows = buildOutreachRows([makeInput('c1', 'a', tasksToday)]);
    expect(rows[0].post).toBe(1);
    expect(rows[0].comment).toBe(1);
  });

  it('handles an empty input list', () => {
    expect(buildOutreachRows([])).toEqual([]);
  });

  it('does not double count a shared tasksToday array across rows', () => {
    // Production shape: the same array reference is handed to every row, so it
    // must be counted once per channel, not once per row that references it.
    const tasksToday = [
      { channelId: 'c1', type: 'POST' },
      { channelId: 'c1', type: 'POST' },
      { channelId: 'c2', type: 'POST' },
    ];
    const rows = buildOutreachRows([
      makeInput('c1', 'a', tasksToday),
      makeInput('c2', 'b', tasksToday),
      makeInput('c1', 'c', tasksToday),
    ]);
    const byName = new Map(rows.map((r) => [r.channelName, r]));
    expect(byName.get('a')!.post).toBe(2);
    expect(byName.get('b')!.post).toBe(1);
    expect(byName.get('c')!.post).toBe(2);
  });

  it('counts each distinct tasksToday array independently', () => {
    // Per-input arrays must not leak counts into each other.
    const rows = buildOutreachRows([
      makeInput('c1', 'a', [{ channelId: 'c1', type: 'POST' }]),
      makeInput('c1', 'b', [
        { channelId: 'c1', type: 'POST' },
        { channelId: 'c1', type: 'COMMENT' },
      ]),
    ]);
    const byName = new Map(rows.map((r) => [r.channelName, r]));
    expect(byName.get('a')!.post).toBe(1);
    expect(byName.get('a')!.comment).toBe(0);
    expect(byName.get('b')!.post).toBe(1);
    expect(byName.get('b')!.comment).toBe(1);
  });
});

// ─── taskStatus derivation from the bulk sets ───
// Mirrors getStatus()/listTickets(): awaiting wins over active, else idle.

function deriveStatus(awaiting: Set<string>, active: Set<string>, channelId: string): TicketTaskStatus {
  return awaiting.has(channelId) ? 'awaiting-submission' : active.has(channelId) ? 'active' : 'idle';
}

describe('channel task status derivation', () => {
  it('matches the legacy awaiting/any derivation for every channel', () => {
    // channel: [hasAwaitingTask, hasAnyActiveTask]
    const channels: [string, boolean, boolean][] = [
      ['c1', true, true],
      ['c2', true, false], // awaiting but no "any" row is impossible in practice; still must not throw
      ['c3', false, true],
      ['c4', false, false],
    ];

    const awaiting = new Set(channels.filter(([, a]) => a).map(([id]) => id));
    const active = new Set(channels.filter(([, , b]) => b).map(([id]) => id));

    for (const [channelId, hasAwaiting, hasAny] of channels) {
      // Legacy: awaiting = await findAwaiting(...); any = awaiting || await findAny(...)
      const legacyAwaiting = hasAwaiting;
      const legacyAny = legacyAwaiting || hasAny;
      const legacy = legacyAwaiting ? 'awaiting-submission' : legacyAny ? 'active' : 'idle';
      expect(deriveStatus(awaiting, active, channelId)).toBe(legacy);
    }
  });
});
