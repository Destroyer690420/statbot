import { formatInsightRequestMessage, pickInsightRequestLink } from '../utils/insight-request';
import { TaskType } from '../types';

describe('manual insight request message', () => {
  const workerId = '123456789';
  const adminId = '987654321';
  const taskId = 'Post #1423160';

  const ask = (type: TaskType, link?: string | null) =>
    formatInsightRequestMessage({ workerId, adminId, taskId, type, link });

  it('asks for post insights, mentions the worker, shows the task id and tags the admin', () => {
    expect(ask(TaskType.POST)).toBe(
      `Hey <@${workerId}>, can you please send the insights screenshot of this post, its quite urgent.\n` +
        `Task: ${taskId}\n` +
        `please tag <@${adminId}> once you have sent the insight`,
    );
  });

  it('says "comment" for comment tasks', () => {
    expect(ask(TaskType.COMMENT)).toBe(
      `Hey <@${workerId}>, can you please send the insights screenshot of this comment, its quite urgent.\n` +
        `Task: ${taskId}\n` +
        `please tag <@${adminId}> once you have sent the insight`,
    );
  });

  it('puts the task id before the submitted link', () => {
    const link = 'https://www.reddit.com/r/test/comments/abc123/example/';
    expect(ask(TaskType.POST, link)).toBe(
      `Hey <@${workerId}>, can you please send the insights screenshot of this post, its quite urgent.\n` +
        `Task: ${taskId}\n` +
        `${link}\n` +
        `please tag <@${adminId}> once you have sent the insight`,
    );
  });

  it('ignores blank links instead of leaving an empty line', () => {
    expect(ask(TaskType.POST, '   ')).toBe(
      `Hey <@${workerId}>, can you please send the insights screenshot of this post, its quite urgent.\n` +
        `Task: ${taskId}\n` +
        `please tag <@${adminId}> once you have sent the insight`,
    );
  });
});

describe('pickInsightRequestLink', () => {
  it('prefers the worker-submitted URL over the original task URL', () => {
    expect(
      pickInsightRequestLink({
        submittedRedditUrl: 'https://reddit.com/submitted',
        redditUrl: 'https://reddit.com/original',
      }),
    ).toBe('https://reddit.com/submitted');
  });

  it('falls back through redditUrl, postLink and commentLink', () => {
    expect(pickInsightRequestLink({ redditUrl: 'https://reddit.com/a', postLink: 'https://reddit.com/b' })).toBe(
      'https://reddit.com/a',
    );
    expect(pickInsightRequestLink({ postLink: 'https://reddit.com/b', commentLink: 'https://reddit.com/c' })).toBe(
      'https://reddit.com/b',
    );
    expect(pickInsightRequestLink({ commentLink: 'https://reddit.com/c' })).toBe('https://reddit.com/c');
  });

  it('returns null when no link is known', () => {
    expect(pickInsightRequestLink({})).toBeNull();
    expect(pickInsightRequestLink({ redditUrl: '  ', submittedRedditUrl: null })).toBeNull();
  });
});
