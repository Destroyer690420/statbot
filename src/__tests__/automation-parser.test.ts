import { parseTasksHtml, unescapeFlight } from '../services/automation/parser';

// Live page bytes escape quotes with a SINGLE backslash.
const FLIGHT = [
  'self.__next_f.push([1,"99:[\\"$\\",\\"div\\",\\"950953\\",{}]"])',
  '</script><script>self.__next_f.push([1,"',
  '{\\"detail\\":{\\"sub_task\\":{\\"id\\":950953,\\"type\\":\\"post\\",',
  '\\"status\\":0,\\"task_id\\":949972,\\"user_id\\":87914,\\"grab_user_id\\":0,',
  '\\"grab_user_c_type\\":10,\\"grab_at\\":0,\\"karma_limit\\":50,\\"earnings\\":250,',
  '\\"earnings_str\\":\\"2.50\\"},',
  '\\"task\\":{\\"id\\":949972,\\"user_id\\":87914,\\"status\\":1,\\"credits\\":18,',
  '\\"subreddit_name\\":\\"ToyotaTacoma\\",',
  '\\"title\\":\\"Just picked up my first Tacoma?\\"}}',
  '"])',
  '</script><script>self.__next_f.push([1,"',
  '{\\"detail\\":{\\"sub_task\\":{\\"id\\":953006,\\"type\\":\\"comment\\",',
  '\\"status\\":0,\\"task_id\\":951671,\\"user_id\\":5814,\\"grab_user_id\\":0,',
  '\\"grab_user_c_type\\":10,\\"grab_at\\":0,\\"karma_limit\\":50,\\"earnings\\":100,',
  '\\"earnings_str\\":\\"1.00\\"},',
  '\\"task\\":{\\"id\\":951671,\\"user_id\\":5814,\\"status\\":1,\\"credits\\":6,',
  '\\"subreddit_name\\":\\"Mommit\\",',
  '\\"title\\":\\"Comment task\\"}}',
  '"])',
].join('');

describe('parseTasksHtml', () => {
  it('extracts post and comment tasks with subreddit/title', () => {
    const tasks = parseTasksHtml(FLIGHT);
    expect(tasks).toHaveLength(2);
    const post = tasks.find((t) => t.subTaskId === '950953')!;
    expect(post.type).toBe('post');
    expect(post.taskId).toBe('949972');
    expect(post.subreddit).toBe('ToyotaTacoma');
    expect(post.title).toContain('Tacoma');
    expect(post.earnings).toBe(250);
    const comment = tasks.find((t) => t.subTaskId === '953006')!;
    expect(comment.type).toBe('comment');
  });

  it('tolerates doubled backslashes (console-copy artifact)', () => {
    const doubled = FLIGHT.replace(/\\/g, '\\\\');
    const tasks = parseTasksHtml(doubled);
    expect(tasks).toHaveLength(2);
    expect(tasks.find((t) => t.subTaskId === '950953')?.subreddit).toBe('ToyotaTacoma');
  });

  it('dedupes repeated flight chunks', () => {
    expect(parseTasksHtml(FLIGHT + FLIGHT)).toHaveLength(2);
  });

  it('returns empty for unrelated HTML', () => {
    expect(parseTasksHtml('<html><body>hello</body></html>')).toEqual([]);
  });

  it('associates subreddit/title by window when the parent key is not "task"', () => {
    // Probe-3 live shape: detail OPENS with sub_task; subreddit_name comes
    // later at an unpredictable distance, no "task" wrapper at all.
    const html = [
      '{\\"detail\\":{\\"sub_task\\":{\\"id\\":111,\\"type\\":\\"post\\",\\"status\\":0,',
      '\\"task_id\\":101,\\"user_id\\":5,\\"grab_user_id\\":0,\\"karma_limit\\":50,\\"earnings\\":250},',
      '\\"filler\\":\\"',
      'x'.repeat(3000),
      '\\",\\"subreddit_name\\":\\"festivals\\",\\"title\\":\\"Join us\\"}}',
    ].join('');
    const tasks = parseTasksHtml(html);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].subreddit).toBe('festivals');
    expect(tasks[0].title).toBe('Join us');
  });

  it('never steals a neighbor task subreddit (boundary-safe)', () => {
    const detail = (id: number, sub: string | null) =>
      '{\\"detail\\":{\\"sub_task\\":{\\"id\\":' +
      id +
      ',\\"type\\":\\"post\\",\\"status\\":0,\\"task_id\\":' +
      (id - 1) +
      ',\\"user_id\\":5,\\"grab_user_id\\":0,\\"karma_limit\\":50,\\"earnings\\":250},' +
      (sub ? '\\"subreddit_name\\":\\"' + sub + '\\",\\"title\\":\\"T\\"}}' : '\\"title\\":\\"T\\"}}');
    // First task has NO subreddit of its own; the second one does.
    const html = detail(201, null) + detail(202, 'georgetown');
    const tasks = parseTasksHtml(html);
    expect(tasks).toHaveLength(2);
    const first = tasks.find((t) => t.subTaskId === '201')!;
    const second = tasks.find((t) => t.subTaskId === '202')!;
    expect(second.subreddit).toBe('georgetown');
    // The first must NOT inherit the neighbor's subreddit.
    expect(first.subreddit).toBeNull();
  });

  it('falls back to post_link/reddit_url for the subreddit', () => {
    const html =
      '{\\"detail\\":{\\"sub_task\\":{\\"id\\":301,\\"type\\":\\"post\\",\\"status\\":0,' +
      '\\"task_id\\":300,\\"user_id\\":5,\\"grab_user_id\\":0,\\"karma_limit\\":50,\\"earnings\\":250},' +
      '\\"post_link\\":\\"https://www.reddit.com/r/simracing/comments/abc/\\",\\"title\\":\\"T\\"}}';
    const tasks = parseTasksHtml(html);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].subreddit).toBe('simracing');
  });

  it('returns newest-first (page bottom = newest drop)', () => {
    const tasks = parseTasksHtml(FLIGHT);
    expect(tasks.map((t) => t.subTaskId)).toEqual(['953006', '950953']);
  });
});

describe('unescapeFlight', () => {
  it('decodes flight escapes', () => {
    expect(unescapeFlight('a\\u003cb\\u003e')).toBe('a<b>');
  });

  it('collapses doubled escapes', () => {
    expect(unescapeFlight('a\\\\"b')).toBe('a"b');
  });
});
