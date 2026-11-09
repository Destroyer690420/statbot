import { formatInsightRequestMessage, pickInsightRequestLink } from '../utils/insight-request';
import { TaskType } from '../types';

describe('manual insight request message', () => {
  const workerId = '123456789';

  it('asks for post insights and mentions the worker', () => {
    expect(formatInsightRequestMessage({ workerId, type: TaskType.POST })).toBe(
      `Hey <@${workerId}>, can you please send the insights screenshot of this post, its quite urgent.`,
    );
  });

  it('says "comment" for comment tasks', () => {
    expect(formatInsightRequestMessage({ workerId, type: TaskType.COMMENT })).toBe(
      `Hey <@${workerId}>, can you please send the insights screenshot of this comment, its quite urgent.`,
    );
  });

  it('appends the submitted link on its own line', () => {
    const link = 'https://www.reddit.com/r/test/comments/abc123/example/';
    expect(formatInsightRequestMessage({ workerId, type: TaskType.POST, link })).toBe(
      `Hey <@${workerId}>, can you please send the insights screenshot of this post, its quite urgent.\n${link}`,
    );
  });

  it('ignores blank links instead of leaving an empty line', () => {
    expect(formatInsightRequestMessage({ workerId, type: TaskType.POST, link: '   ' })).toBe(
      `Hey <@${workerId}>, can you please send the insights screenshot of this post, its quite urgent.`,
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
