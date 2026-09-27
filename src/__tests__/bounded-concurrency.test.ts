/**
 * mapWithConcurrency is the primitive every blast speedup rests on, so its
 * contract is pinned here: bounded in-flight count, input-ordered results, and
 * full coverage of the input even when individual items fail.
 */
import { mapWithConcurrency } from '../utils/bounded-concurrency';

/** Records the high-water mark of concurrently running tasks. */
function makeTracker() {
  let active = 0;
  let peak = 0;
  const order: number[] = [];
  return {
    order,
    get peak() {
      return peak;
    },
    async run<T>(value: T, delayMs: number): Promise<T> {
      active += 1;
      if (active > peak) peak = active;
      await new Promise((r) => setTimeout(r, delayMs));
      active -= 1;
      return value;
    },
  };
}

describe('mapWithConcurrency', () => {
  it('returns an empty array for an empty input', async () => {
    await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
  });

  it('preserves input order even when later items finish first', async () => {
    // Item 0 is slowest, so completion order is the reverse of input order.
    const delays = [40, 5, 25, 1, 15];
    const out = await mapWithConcurrency(delays, 5, async (d, i) => {
      await new Promise((r) => setTimeout(r, d));
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3, 4]);
  });

  it('never exceeds the requested width', async () => {
    const tracker = makeTracker();
    const items = Array.from({ length: 40 }, (_, i) => i);
    await mapWithConcurrency(items, 7, (item) => tracker.run(item, 2));
    expect(tracker.peak).toBeLessThanOrEqual(7);
    expect(tracker.peak).toBeGreaterThan(1); // actually overlapped
  });

  it('runs every item exactly once', async () => {
    const seen: number[] = [];
    const items = Array.from({ length: 25 }, (_, i) => i);
    await mapWithConcurrency(items, 6, async (item) => {
      seen.push(item);
    });
    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  it('visits every item even when some fail, and keeps the others', async () => {
    // fn is required to handle its own errors; this mirrors how the blast
    // send loop reports a failed send without abandoning the rest.
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (n) => {
      if (n % 2 === 0) return `ok:${n}`;
      return `failed:${n}`;
    });
    expect(out).toEqual(['failed:1', 'ok:2', 'failed:3', 'ok:4', 'failed:5', 'ok:6']);
  });

  it('actually overlaps work (the whole point): far faster than serial', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const tick = 10;

    const serialStart = Date.now();
    for (const _item of items) await new Promise((r) => setTimeout(r, tick));
    const serialMs = Date.now() - serialStart;

    const parallelStart = Date.now();
    await mapWithConcurrency(items, 10, async () => {
      await new Promise((r) => setTimeout(r, tick));
    });
    const parallelMs = Date.now() - parallelStart;

    expect(parallelMs).toBeLessThan(serialMs / 2);
  });

  it('tolerates degenerate limits without hanging or dropping items', async () => {
    for (const limit of [0, -5, 1, 1.7, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = await mapWithConcurrency(['a', 'b', 'c'], limit, async (x) => x.toUpperCase());
      expect(out).toEqual(['A', 'B', 'C']);
    }
  });

  it('passes the item index through', async () => {
    const out = await mapWithConcurrency(['x', 'y', 'z'], 2, async (item, index) => `${index}:${item}`);
    expect(out).toEqual(['0:x', '1:y', '2:z']);
  });

  it('rejects when fn throws, and does not silently swallow the error', async () => {
    // Documented behaviour: a throw from fn rejects rather than being hidden.
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });

  it('is stable when the input array is longer than the width', async () => {
    const tracker = makeTracker();
    const items = Array.from({ length: 50 }, (_, i) => i);
    const out = await mapWithConcurrency(items, 12, (item) => tracker.run(item, 1));
    expect(out).toEqual(items);
    expect(tracker.peak).toBeLessThanOrEqual(12);
  });
});
