import { parseTasksHtml, unescapeFlight } from '../services/automation/parser';

const FLIGHT = [
  'self.__next_f.push([1,"99:[\\\\"$\\\\",\\\\"div\\\\",\\\\"950953\\\\",{}]"])',
  '</script><script>self.__next_f.push([1,"',
  '{\\\\"detail\\\\":{\\\\"sub_task\\\\":{\\\\"id\\\\":950953,\\\\"type\\\\":\\\\"post\\\\",',
  '\\\\"status\\\\":0,\\\\"task_id\\\\":949972,\\\\"user_id\\\\":87914,\\\\"grab_user_id\\\\":0,',
  '\\\\"grab_user_c_type\\\\":10,\\\\"grab_at\\\\":0,\\\\"karma_limit\\\\":50,\\\\"earnings\\\\":250,',
  '\\\\"earnings_str\\\\":\\\\"2.50\\\\"},',
  '\\\\"task\\\\":{\\\\"id\\\\":949972,\\\\"user_id\\\\":87914,\\\\"status\\\\":1,\\\\"credits\\\\":18,',
  '\\\\"subreddit_name\\\\":\\\\"ToyotaTacoma\\\\",',
  '\\\\"title\\\\":\\\\"Just picked up my first Tacoma?\\\\"}}',
  '"])',
  '</script><script>self.__next_f.push([1,"',
  '{\\\\"detail\\\\":{\\\\"sub_task\\\\":{\\\\"id\\\\":953006,\\\\"type\\\\":\\\\"comment\\\\",',
  '\\\\"status\\\\":0,\\\\"task_id\\\\":951671,\\\\"user_id\\\\":5814,\\\\"grab_user_id\\\\":0,',
  '\\\\"grab_user_c_type\\\\":10,\\\\"grab_at\\\\":0,\\\\"karma_limit\\\\":50,\\\\"earnings\\\\":100,',
  '\\\\"earnings_str\\\\":\\\\"1.00\\\\"},',
  '\\\\"task\\\\":{\\\\"id\\\\":951671,\\\\"user_id\\\\":5814,\\\\"status\\\\":1,\\\\"credits\\\\":6,',
  '\\\\"subreddit_name\\\\":\\\\"Mommit\\\\",',
  '\\\\"title\\\\":\\\\"Comment task\\\\"}}',
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

  it('dedupes repeated flight chunks', () => {
    expect(parseTasksHtml(FLIGHT + FLIGHT)).toHaveLength(2);
  });

  it('returns empty for unrelated HTML', () => {
    expect(parseTasksHtml('<html><body>hello</body></html>')).toEqual([]);
  });
});

describe('unescapeFlight', () => {
  it('decodes flight escapes', () => {
    expect(unescapeFlight('a\\u003cb\\u003e')).toBe('a<b>');
  });
});
