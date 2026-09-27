/**
 * Field-window bounds in the /tasks flight parser.
 *
 * A task block used to be sliced at `index + 12000` as well as at the next
 * task's marker. A captured live /tasks page contains a 77,771-character
 * block — 6.5x that ceiling — so the cap was arbitrary and could truncate the
 * `detail` object that carries `subreddit_name`. A post that lost its subreddit
 * is rejected NO_SUBREDDIT and is therefore permanently ineligible, which is a
 * silent task loss.
 *
 * The cap is gone: the next task's marker is the only boundary. These tests pin
 * both halves of that: identical output for normal blocks, and correct
 * resolution for a block whose fields sit past the old ceiling.
 */
import { parseTasksHtml } from '../services/automation/parser';

/** Builds one flight block. `padBefore` inflates it past the old 12k window. */
function block(opts: {
  id: number;
  type?: 'post' | 'comment';
  status?: number;
  taskId: number;
  subreddit?: string;
  title?: string;
  padBefore?: number;
}): string {
  const parts: string[] = [];
  parts.push(`\\"id\\":${opts.id}`);
  parts.push(`\\"type\\":\\"${opts.type ?? 'post'}\\"`);
  parts.push(`\\"status\\":${opts.status ?? 0}`);
  parts.push(`\\"task_id\\":${opts.taskId}`);
  parts.push(`\\"user_id\\":1`);
  parts.push(`\\"grab_user_id\\":0`);
  parts.push(`\\"karma_limit\\":50`);
  parts.push(`\\"earnings\\":250`);
  // Padding sits between the header fields and subreddit_name, exactly where a
  // long task body would sit.
  if (opts.padBefore) parts.push(`\\"body_html\\":\\"${'x'.repeat(opts.padBefore)}\\"`);
  parts.push(`\\"subreddit_name\\":\\"${opts.subreddit ?? 'TestSub'}\\"`);
  parts.push(`\\"title\\":\\"${opts.title ?? 'A title'}\\"`);
  return `\\"sub_task\\":\{${parts.join(',')}\}`;
}

function page(...blocks: string[]): string {
  return `<html><body><script>self.__next_f.push([1,"${blocks.join('')}"])</script></body></html>`;
}

describe('parseTasksHtml field window', () => {
  it('resolves subreddit and title for a normal block', () => {
    const html = page(block({ id: 1, taskId: 10, subreddit: 'ElPaso', title: 'Hello' }));
    const tasks = parseTasksHtml(html);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].subreddit).toBe('ElPaso');
    expect(tasks[0].title).toBe('Hello');
  });

  it('resolves fields that sit PAST the old 12000-char ceiling', () => {
    // A block inflated to ~30 KB, with subreddit_name after the padding. The old
    // capped window would have stopped at 12 KB and lost the subreddit, making
    // this post permanently ineligible.
    const html = page(block({ id: 2, taskId: 20, subreddit: 'LateSub', title: 'Late title', padBefore: 30000 }));
    const tasks = parseTasksHtml(html);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].subreddit).toBe('LateSub');
    expect(tasks[0].title).toBe('Late title');
  });

  it('handles a 77k-character block, matching the real captured page', () => {
    const html = page(block({ id: 3, taskId: 30, subreddit: 'HugeSub', padBefore: 77000 }));
    const tasks = parseTasksHtml(html);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].subreddit).toBe('HugeSub');
  });

  it('still stops at the NEXT task marker: no cross-task leakage', () => {
    // Neighbouring tasks must never borrow each other's subreddit. The first
    // block deliberately has none of its own inside the window.
    const first = `\\"sub_task\\":{\\"id\\":4,\\"type\\":\\"post\\",\\"status\\":0,\\"task_id\\":40,\\"user_id\\":1,\\"grab_user_id\\":0,\\"karma_limit\\":50,\\"earnings\\":250,\\"body_html\\":\\"${'y'.repeat(30000)}\\"}`;
    const second = block({ id: 5, taskId: 50, subreddit: 'SecondSub' });
    const tasks = parseTasksHtml(page(first, second));
    const firstTask = tasks.find((t) => t.subTaskId === '4');
    const secondTask = tasks.find((t) => t.subTaskId === '5');
    expect(secondTask!.subreddit).toBe('SecondSub');
    // The first block has no subreddit of its own anywhere, and must not adopt
    // the neighbour's.
    expect(firstTask!.subreddit).not.toBe('SecondSub');
  });

  it('resolves a post whose subreddit is far into its own block without a neighbour', () => {
    // Proves the large-block success is not an artefact of a following marker.
    const only = block({ id: 6, taskId: 60, subreddit: 'SoloSub', padBefore: 25000 });
    const tasks = parseTasksHtml(page(only));
    expect(tasks[0].subreddit).toBe('SoloSub');
  });

  it('keeps every block in a many-task listing', () => {
    const blocks = Array.from({ length: 30 }, (_, i) =>
      block({ id: 100 + i, taskId: 200 + i, subreddit: 'Sub' + i, type: i % 3 === 0 ? 'comment' : 'post' }),
    );
    const tasks = parseTasksHtml(page(...blocks));
    expect(tasks).toHaveLength(30);
    // Each task carries its OWN subreddit, never a neighbour's.
    for (const t of tasks) {
      const expected = 'Sub' + (Number(t.subTaskId) - 100);
      expect(t.subreddit).toBe(expected);
    }
  });

  it('returns newest-first (page bottom is the newest drop)', () => {
    const tasks = parseTasksHtml(
      page(block({ id: 7, taskId: 70 }), block({ id: 8, taskId: 80 })),
    );
    expect(tasks.map((t) => t.subTaskId)).toEqual(['8', '7']);
  });

  it('is unchanged for a document with no tasks at all', () => {
    expect(parseTasksHtml('<html><body>nothing here</body></html>')).toEqual([]);
  });
});
