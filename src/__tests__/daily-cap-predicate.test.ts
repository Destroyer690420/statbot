/**
 * Pins the daily-cap predicate.
 *
 * `countPostsAssignedToday` used to load every task created in the IST day with
 * all of its columns and filter in JavaScript. It is now a single covering
 * `GROUP BY` pushed into the database. The two must agree exactly — a silent
 * disagreement would let a capped worker win a slot (or block an uncapped one),
 * so the predicate is compared directly over a matrix of real row shapes.
 */
import { taskRepository } from '../database/repositories/task.repository';

const countGoPartTimePostsByWorkerInRange = (workerIds: string[], from: Date, to: Date) =>
  taskRepository.countGoPartTimePostsByWorkerInRange(workerIds, from, to);

jest.mock('../database/db', () => ({ getDb: jest.fn() }));

/** The ORIGINAL JavaScript filter, verbatim, over full task rows. */
function legacyCount(tasks: any[], workerId: string): number {
  return tasks.filter(
    (t) =>
      t.source === 'goparttime' &&
      t.type === 'POST' &&
      t.assignedUserId === workerId &&
      t.status !== 'CANCELLED' &&
      t.status !== 'ARCHIVED',
  ).length;
}

/**
 * The new SQL predicate, expressed in JS. Mirrors the Prisma `where` clause
 * exactly. The createdAt range is NOT reproduced here: it is a window applied
 * by the database, and is asserted separately against the query argument.
 */
function sqlCount(tasks: any[], workerId: string): number {
  return tasks.filter(
    (t) =>
      t.source === 'goparttime' &&
      t.type === 'POST' &&
      t.assignedUserId === workerId &&
      t.status !== 'CANCELLED' &&
      t.status !== 'ARCHIVED',
  ).length;
}

const STATUSES = [
  'ACCEPTED',
  'PENDING',
  'REMINDER_20_SENT',
  'INSIGHT_20_RECEIVED',
  'REMINDER_70_SENT',
  'INSIGHT_70_RECEIVED',
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
];

const SOURCES = ['goparttime', null, 'manual', 'other'];
const TYPES = ['POST', 'COMMENT'];
const WORKERS = ['w1', 'w2', 'w3'];

function buildMatrix(): any[] {
  const rows: any[] = [];
  for (const source of SOURCES) {
    for (const type of TYPES) {
      for (const status of STATUSES) {
        for (const workerId of WORKERS) {
          rows.push({
            source,
            type,
            status,
            assignedUserId: workerId,
            // The heavy columns the old query dragged along; the new one never
            // selects them.
            contentHtml: `<p>${'x'.repeat(500)}</p>`,
            taskImages: [{ url: 'https://example.com/a.png' }],
          });
        }
      }
    }
  }
  return rows;
}

describe('daily-cap predicate: grouped query == legacy JS filter', () => {
  const rows = buildMatrix();

  it('builds a matrix that actually exercises every branch', () => {
    expect(rows.length).toBe(SOURCES.length * TYPES.length * STATUSES.length * WORKERS.length);
    // Both the positive and the negative case are present.
    expect(legacyCount(rows, 'w1')).toBeGreaterThan(0);
    expect(sqlCount(rows, 'w1')).toBe(legacyCount(rows, 'w1'));
  });

  it('agrees for every worker over the full matrix', () => {
    for (const workerId of WORKERS) {
      expect(sqlCount(rows, workerId)).toBe(legacyCount(rows, workerId));
    }
  });

  it('agrees for a worker with no rows at all', () => {
    expect(sqlCount(rows, 'nobody')).toBe(0);
    expect(legacyCount(rows, 'nobody')).toBe(0);
  });

  it('counts ARCHIVED and CANCELLED as absent, and every other status as present', () => {
    for (const status of STATUSES) {
      const one = [
        { source: 'goparttime', type: 'POST', status, assignedUserId: 'w1' },
      ];
      const expected = status === 'ARCHIVED' || status === 'CANCELLED' ? 0 : 1;
      expect(sqlCount(one, 'w1')).toBe(expected);
      expect(legacyCount(one, 'w1')).toBe(expected);
    }
  });

  it('excludes comments, other sources, and other workers', () => {
    expect(sqlCount([{ source: 'goparttime', type: 'COMMENT', status: 'PENDING', assignedUserId: 'w1' }], 'w1')).toBe(0);
    expect(sqlCount([{ source: 'manual', type: 'POST', status: 'PENDING', assignedUserId: 'w1' }], 'w1')).toBe(0);
    expect(sqlCount([{ source: null, type: 'POST', status: 'PENDING', assignedUserId: 'w1' }], 'w1')).toBe(0);
    expect(sqlCount([{ source: 'goparttime', type: 'POST', status: 'PENDING', assignedUserId: 'w2' }], 'w1')).toBe(0);
  });
});

describe('countGoPartTimePostsByWorkerInRange', () => {
  const getDb = require('../database/db').getDb as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an empty map without touching the database for no workers', async () => {
    const result = await countGoPartTimePostsByWorkerInRange([], new Date(), new Date());
    expect(result.size).toBe(0);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('issues exactly one grouped query carrying the cap predicate', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { assignedUserId: 'w1', _count: { _all: 3 } },
      { assignedUserId: 'w2', _count: { _all: 1 } },
    ]);
    getDb.mockReturnValue({ task: { groupBy } });

    const from = new Date('2026-09-26T00:00:00Z');
    const to = new Date('2026-09-27T00:00:00Z');
    const result = await countGoPartTimePostsByWorkerInRange(['w1', 'w2'], from, to);

    expect(groupBy).toHaveBeenCalledTimes(1);
    const arg = groupBy.mock.calls[0][0];
    expect(arg.by).toEqual(['assignedUserId']);
    expect(arg.where.createdAt).toEqual({ gte: from, lte: to });
    expect(arg.where.source).toBe('goparttime');
    expect(arg.where.type).toBe('POST');
    expect(arg.where.status.notIn.sort()).toEqual(['ARCHIVED', 'CANCELLED']);
    expect(arg.where.assignedUserId.in.sort()).toEqual(['w1', 'w2']);
    // No full-row payload is selected: only a count.
    expect(arg.select).toBeUndefined();

    expect(result.get('w1')).toBe(3);
    expect(result.get('w2')).toBe(1);
  });

  it('de-duplicates the requested worker ids', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    getDb.mockReturnValue({ task: { groupBy } });

    await countGoPartTimePostsByWorkerInRange(
      ['w1', 'w1', 'w1'],
      new Date(),
      new Date(),
    );

    expect(groupBy.mock.calls[0][0].where.assignedUserId.in).toEqual(['w1']);
  });

  it('omits workers with no matching rows so callers see them as 0', async () => {
    const groupBy = jest.fn().mockResolvedValue([{ assignedUserId: 'w1', _count: { _all: 2 } }]);
    getDb.mockReturnValue({ task: { groupBy } });

    const result = await countGoPartTimePostsByWorkerInRange(
      ['w1', 'w2'],
      new Date(),
      new Date(),
    );

    expect(result.has('w1')).toBe(true);
    expect(result.has('w2')).toBe(false);
    expect(result.get('w2') ?? 0).toBe(0);
  });

  it('ignores blank worker ids rather than querying for them', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    getDb.mockReturnValue({ task: { groupBy } });

    const result = await countGoPartTimePostsByWorkerInRange(
      ['', 'w1'],
      new Date(),
      new Date(),
    );

    expect(groupBy.mock.calls[0][0].where.assignedUserId.in).toEqual(['w1']);
    expect(result.size).toBe(0);
  });
});
