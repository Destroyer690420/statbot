/**
 * createSerialQueue: strict FIFO execution in enqueue order, chain survival.
 * Pure module — no env or DB needed.
 */
import { createSerialQueue } from '../utils/serial-queue';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

describe('createSerialQueue', () => {
  it('runs fns strictly in enqueue order even when earlier fns are slower', async () => {
    const enqueue = createSerialQueue();
    const order: string[] = [];
    await Promise.all([
      enqueue(async () => {
        await tick();
        await tick();
        order.push('first');
      }),
      enqueue(async () => {
        order.push('second');
      }),
      enqueue(async () => {
        await tick();
        order.push('third');
      }),
    ]);
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('a rejection reaches its caller but never breaks the chain', async () => {
    const enqueue = createSerialQueue();
    const order: string[] = [];
    const failing = enqueue(async () => {
      order.push('boom');
      throw new Error('nope');
    });
    const after = enqueue(async () => {
      order.push('after');
    });
    await expect(failing).rejects.toThrow('nope');
    await after;
    expect(order).toEqual(['boom', 'after']);
  });
});
