/**
 * FIFO serial queue: every fn passed to the returned enqueue runs strictly in
 * enqueue order, one at a time. The chain link happens synchronously inside
 * the enqueue call, so callers that enqueue with no preceding awaits preserve
 * real-world arrival order (e.g. Discord messageCreate handlers). A rejected
 * fn never breaks the chain — the error still reaches that fn's caller.
 */
export function createSerialQueue(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
