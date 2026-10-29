/**
 * Link-submit executor page hunt.
 *
 * Regression pin for the v1.2.2 fix: the executor used to walk
 * `/my-tasks/todo?page=N` forward only from whatever page the tab was left on
 * (usually the last page of the previous job) and reported "card not found"
 * at the last page. With 4 todo pages, a card on page 2 was therefore never
 * searched once the tab was on page 4. The hunt now keeps its visited set in
 * the in-flight job and wraps (4 → 1 → 2 → 3) until every page was checked.
 *
 * The helpers are lifted verbatim out of the shipped userscript between the
 * `page-scan` sentinels and run with an injected `MAX_PAGES`/`maxTodoPages`,
 * so this test exercises the real shipped code, not a copy.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'scripts', 'goparttime-submit.user.js');
const MIRROR = path.join(ROOT, 'dashboard', 'public', 'goparttime-submit.user.js');
const MAX_PAGES = 10;

interface Scan {
  visited: number[];
  maxPages: number;
  sawCards: boolean;
}

type TrackScannedPage = (active: { scan?: Scan }, page: number, hasCards: boolean) => Scan;
type NextUnvisitedPage = (scan: Scan, page: number) => number | null;

interface Helpers {
  trackScannedPage: TrackScannedPage;
  nextUnvisitedPage: NextUnvisitedPage;
}

function loadHelpers(file: string, maxTodoPages: () => number): Helpers {
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('// ─── page-scan:start ───');
  const end = source.indexOf('// ─── page-scan:end ───');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('page-scan sentinels not found — did the hunt helpers get renamed?');
  }
  const body = source.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function('MAX_PAGES', 'maxTodoPages', `${body}\nreturn { trackScannedPage, nextUnvisitedPage };`)(
    MAX_PAGES,
    maxTodoPages,
  ) as Helpers;
}

function walk(start: number, maxTodo: number): { sequence: number[]; scan: Scan } {
  const { trackScannedPage, nextUnvisitedPage } = loadHelpers(SOURCE, () => maxTodo);
  const active: { scan?: Scan } = {};
  const sequence: number[] = [];
  let page = start;
  // A correct hunt visits at most MAX_PAGES real pages plus one out-of-range
  // landing page; the guard only exists to fail loudly instead of hanging.
  for (let guard = 0; guard <= MAX_PAGES + 1; guard += 1) {
    const scan = trackScannedPage(active, page, true);
    sequence.push(page);
    const next = nextUnvisitedPage(scan, page);
    if (next === null) return { sequence, scan };
    page = next;
  }
  throw new Error(`page hunt did not terminate from page ${start} with max ${maxTodo}: ${sequence.join(',')}`);
}

describe('link-submit executor page hunt', () => {
  it('is byte-identical to its dashboard/public mirror', () => {
    expect(fs.readFileSync(MIRROR, 'utf8')).toBe(fs.readFileSync(SOURCE, 'utf8'));
  });

  it.each([
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
    [1, 1],
    [2, 3],
  ])('searches every page exactly once (start %i, max %i)', (start, max) => {
    const { sequence } = walk(start, max);
    expect([...sequence].sort((a, b) => a - b)).toEqual(Array.from({ length: max }, (_, i) => i + 1));
    expect(new Set(sequence).size).toBe(sequence.length);
  });

  it('wraps from the last page back to page 1 instead of giving up', () => {
    expect(walk(4, 4).sequence).toEqual([4, 1, 2, 3]);
  });

  it('searches the earlier pages after the tab is left on the last page', () => {
    const { sequence } = walk(3, 3);
    expect(sequence).toEqual([3, 1, 2]);
  });

  it('recovers when the tab sits on an out-of-range page', () => {
    // Tab left on page 3, list now has 2 pages: page 3 is empty, but pages 1
    // and 2 must still be searched before the job is declared missing.
    expect(walk(3, 2).sequence).toEqual([3, 1, 2]);
  });

  it('caps a bogus ?page=999 walk at MAX_PAGES', () => {
    const { sequence } = walk(999, 4);
    expect(sequence.length).toBeLessThanOrEqual(MAX_PAGES + 1);
    for (let page = 1; page <= 4; page += 1) expect(sequence).toContain(page);
  });
});
