/**
 * Link-submit executor page hunt.
 *
 * v1.3.0 regression pin: every new job starts at page 1 and walks forward
 * (1 → 2 → 3 …) until the card is found or the list ends. The old v1.2.2
 * wrap-around still inherited the tab's current page and depended on
 * maxTodoPages() reading the pagination markup; when the tab sat on page 3/4
 * a card on page 2 could still be missed. The helpers are lifted verbatim out
 * of the shipped userscript between the `page-hunt` sentinels, so this test
 * exercises the real shipped code, not a copy.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'scripts', 'goparttime-submit.user.js');
const MIRROR = path.join(ROOT, 'dashboard', 'public', 'goparttime-submit.user.js');
const MAX_PAGES = 10;

interface Hunt {
  page: number;
  nextPage?: number | null;
  repeatCount?: number;
  started?: boolean;
  visited: number[];
  lastFingerprint: string | null;
  sawCards: boolean;
}

type NewHuntState = () => Hunt;
type EnsureHuntState = (active: { hunt?: Hunt }) => Hunt;
type NextHuntPage = (
  active: { hunt?: Hunt },
  page: number,
  hasCards: boolean,
  cardIds: string[],
) => number | null;

interface Helpers {
  newHuntState: NewHuntState;
  ensureHuntState: EnsureHuntState;
  nextHuntPage: NextHuntPage;
}

function loadHelpers(file: string): Helpers {
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('// ─── page-hunt:start ───');
  const end = source.indexOf('// ─── page-hunt:end ───');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('page-hunt sentinels not found — did the hunt helpers get renamed?');
  }
  const body = source.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function('MAX_PAGES', `${body}\nreturn { newHuntState, ensureHuntState, nextHuntPage };`)(
    MAX_PAGES,
  ) as Helpers;
}

function walk(
  pages: string[][],
  target?: string,
): { sequence: number[]; hunt: Hunt; foundOn: number | null } {
  const { newHuntState, ensureHuntState, nextHuntPage } = loadHelpers(SOURCE);
  const active: { hunt?: Hunt } = { hunt: newHuntState() };
  const hunt = ensureHuntState(active);
  const sequence: number[] = [];
  // A correct walk visits at most MAX_PAGES real pages plus one empty page;
  // the guard only exists to fail loudly instead of hanging.
  for (let guard = 0; guard <= MAX_PAGES + 2; guard += 1) {
    const page = hunt.page;
    sequence.push(page);
    const cards = pages[page - 1] || [];
    if (target && cards.includes(target)) return { sequence, hunt, foundOn: page };
    const next = nextHuntPage(active, page, cards.length > 0, cards);
    if (next === null) return { sequence, hunt, foundOn: null };
    hunt.page = next;
  }
  throw new Error(`page hunt did not terminate: ${sequence.join(',')}`);
}

describe('link-submit executor page hunt', () => {
  it('is byte-identical to its dashboard/public mirror', () => {
    expect(fs.readFileSync(MIRROR, 'utf8')).toBe(fs.readFileSync(SOURCE, 'utf8'));
  });

  it('always starts a new job at page 1', () => {
    const { newHuntState, ensureHuntState } = loadHelpers(SOURCE);
    expect(newHuntState().page).toBe(1);
    expect(newHuntState().started).toBe(false);
    // A legacy in-flight job from v1.2.2 carried `scan` instead of `hunt`.
    const legacy: { hunt?: Hunt; scan?: unknown } = {
      scan: { visited: [3, 4], maxPages: 4, sawCards: true },
    };
    expect(ensureHuntState(legacy).page).toBe(1);
    expect(ensureHuntState(legacy).started).toBe(false);
  });

  it('walks forward from page 1 and stops at the first empty page', () => {
    const { sequence, hunt } = walk([['11'], ['22'], ['33'], ['44'], []]);
    expect(sequence).toEqual([1, 2, 3, 4, 5]);
    expect(hunt.visited).toEqual([1, 2, 3, 4, 5]);
    expect(hunt.sawCards).toBe(true);
  });

  it('finds a card on page 2 after starting on page 1 (the reported bug)', () => {
    const { sequence, foundOn } = walk([['11'], ['22'], ['33'], ['44']], '22');
    expect(foundOn).toBe(2);
    expect(sequence).toEqual([1, 2]);
  });

  it('finds a card on the last page', () => {
    const { sequence, foundOn } = walk([['11'], ['22'], ['33'], ['44']], '44');
    expect(foundOn).toBe(4);
    expect(sequence).toEqual([1, 2, 3, 4]);
  });

  it('stops when the site ignores ?page= and renders the same cards again', () => {
    const { sequence, hunt } = walk([['11', '22'], ['11', '22'], ['33']]);
    expect(sequence).toEqual([1, 2]);
    expect(hunt.sawCards).toBe(true);
  });

  it('stops immediately on an empty first page', () => {
    const { sequence, hunt } = walk([[], ['22']]);
    expect(sequence).toEqual([1]);
    expect(hunt.sawCards).toBe(false);
  });

  it('retries the chosen next page once when the navigation did not take, then stops', () => {
    const { newHuntState, ensureHuntState, nextHuntPage } = loadHelpers(SOURCE);
    const active: { hunt?: Hunt } = { hunt: newHuntState() };
    const hunt = ensureHuntState(active);
    expect(nextHuntPage(active, 1, true, ['11'])).toBe(2);
    // Same page again (the ?page=2 navigation did not happen): retry it once.
    expect(nextHuntPage(active, 1, true, ['11'])).toBe(2);
    // Still the same page: the site is cycling us back — stop, do not loop.
    expect(nextHuntPage(active, 1, true, ['11'])).toBeNull();
    expect(hunt.sawCards).toBe(true);
  });

  it('caps a broken walk at MAX_PAGES', () => {
    const pages = Array.from({ length: MAX_PAGES + 3 }, (_, i) => [`id-${i}`]);
    const { sequence } = walk(pages);
    expect(sequence).toEqual(Array.from({ length: MAX_PAGES }, (_, i) => i + 1));
  });

  it('wires the fresh-job start to page 1 and the shared hunt state', () => {
    const source = fs.readFileSync(SOURCE, 'utf8');
    expect(source).toMatch(/hunt:\s*newHuntState\(\)/);
    expect(source).toMatch(/goToTodoPage\(1\)/);
    expect(source).toMatch(/!hunt\.started/);
    expect(source).toMatch(/currentPage !== hunt\.page/);
  });
});
