/**
 * Bounded-concurrency mapper.
 *
 * The blast pipeline used to walk its work one item at a time with `await`
 * inside the loop body, so N independent network calls cost N x round-trip
 * instead of one round-trip's worth of latency. This runs a fixed number of
 * workers over a shared cursor instead: the queueing is bounded (so we never
 * open N sockets or hold N database connections) but the latency overlaps.
 *
 * Two properties callers depend on:
 *  - Results come back in INPUT order regardless of completion order, so an
 *    audit string built from the result array stays deterministic.
 *  - `fn` must handle its own errors. A throw from `fn` rejects the returned
 *    promise and abandons the remaining items, which is deliberate: silently
 *    swallowing failures would hide a broken send.
 */

/**
 * Maps `items` through `fn` with at most `limit` invocations in flight.
 * Never rejects because of ordering; see the note above about `fn` throwing.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  const requested = Math.floor(limit);
  const width = Math.max(1, Math.min(Number.isFinite(requested) ? requested : 1, items.length));

  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}
