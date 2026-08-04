import { buildTaskMessagePlan, buildInstructionMessage, MAX_MESSAGE_LENGTH } from '../utils/plain-task-message';
import type { TaskMessageFields } from '../utils/plain-task-message';

const POST_FIELDS = {
  subreddit: 'MobileGaming',
  subredditUrl: 'https://www.reddit.com/r/MobileGaming',
  flair: 'Discussion',
  title: 'Does Mahjong ever stop feeling confusing?',
};

const CONTENT = 'Every time I see Mahjong tiles, I have the same reaction.';

describe('buildTaskMessagePlan — metadata labels', () => {
  it('sends each label and each value as its own message, in order', () => {
    const plan = buildTaskMessagePlan(POST_FIELDS, CONTENT);
    expect(plan.metadata).toEqual([
      'subreddit',
      'https://www.reddit.com/r/MobileGaming',
      'title',
      'Does Mahjong ever stop feeling confusing?',
      'flair',
      'Discussion',
      'content',
    ]);
  });

  it('orders post metadata as subreddit, title, flair, content', () => {
    const plan = buildTaskMessagePlan(POST_FIELDS, CONTENT);
    const labels = plan.metadata.filter((_, i) => i % 2 === 0);
    expect(labels).toEqual(['subreddit', 'title', 'flair', 'content']);
  });

  it('omits labels whose fields are absent', () => {
    const plan = buildTaskMessagePlan({ title: 'Only a title' }, CONTENT);
    expect(plan.metadata).toEqual(['title', 'Only a title', 'content']);
    expect(plan.metadata.join(' ')).not.toContain('subreddit');
    expect(plan.metadata.join(' ')).not.toContain('flair');
  });

  it('falls back to the subreddit name when no URL is present', () => {
    const plan = buildTaskMessagePlan({ subreddit: 'MobileGaming' }, CONTENT);
    expect(plan.metadata.slice(0, 2)).toEqual(['subreddit', 'MobileGaming']);
  });

  it('uses post and comment labels for comment tasks', () => {
    const plan = buildTaskMessagePlan(
      { postLink: 'https://www.reddit.com/r/testsub/comments/abc/' },
      CONTENT,
    );
    expect(plan.metadata).toEqual([
      'post',
      'https://www.reddit.com/r/testsub/comments/abc/',
      'comment',
    ]);
    expect(plan.metadata).not.toContain('subreddit');
    expect(plan.metadata).not.toContain('title');
    expect(plan.metadata).not.toContain('content');
  });

  it('keeps the URL as raw text so Discord can render its native preview', () => {
    const plan = buildTaskMessagePlan(POST_FIELDS, CONTENT);
    expect(plan.metadata[1]).toBe('https://www.reddit.com/r/MobileGaming');
    expect(plan.metadata[1]).not.toMatch(/\[MobileGaming\]/);
  });

  it('never sends deadline labels or values', () => {
    const plan = buildTaskMessagePlan(
      { ...POST_FIELDS, deadline: '2026-08-05' } as TaskMessageFields & { deadline: string },
      CONTENT,
    );
    expect(plan.metadata).not.toContain('deadline');
    expect(plan.metadata.join(' ')).not.toContain('2026-08-05');
  });
});

describe('buildTaskMessagePlan — content chunking', () => {
  it('sends short content as a single chunk after the content label', () => {
    const plan = buildTaskMessagePlan(POST_FIELDS, CONTENT);
    expect(plan.content).toEqual([CONTENT]);
    expect(plan.metadata[plan.metadata.length - 1]).toBe('content');
  });

  it('splits content longer than 2000 chars using paragraph-aware chunking', () => {
    const para = 'A solid paragraph with enough words to fill space and stay readable when split. ';
    const content = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}. ${para}`).join('\n\n');
    const plan = buildTaskMessagePlan(POST_FIELDS, content);

    for (const message of plan.content) {
      expect(message.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
    expect(plan.content.length).toBeGreaterThan(0);

    // Every paragraph must survive somewhere in the output, still separated
    // by blank lines inside each chunk.
    const joined = plan.content.join('\n\n');
    for (let i = 0; i < 80; i++) {
      expect(joined).toContain(`Paragraph ${i + 1}. ${para.trimEnd()}`);
    }
    expect(plan.content[0]).toMatch(/^Paragraph 1\./);
  });

  it('omits the content label when there is no content', () => {
    const plan = buildTaskMessagePlan({ title: 'Just a title' }, '');
    expect(plan.metadata).toEqual(['title', 'Just a title']);
    expect(plan.content).toEqual([]);
  });

  it('returns empty arrays when both labels and content are empty', () => {
    const plan = buildTaskMessagePlan({}, '');
    expect(plan.metadata).toEqual([]);
    expect(plan.content).toEqual([]);
  });

  it('never breaks words mid-way across chunk boundaries', () => {
    const words = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
    const plan = buildTaskMessagePlan({}, words.repeat(5));

    for (const message of plan.content) {
      expect(message.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
    // wordNNN tokens should never be split across two messages: each message
    // must start at a word boundary (or be the very first one).
    for (const message of plan.content.slice(1)) {
      expect(message).toMatch(/^\s*$|^word\d+|^\s*word\d+/);
    }
  });

  it('comment content chunks follow the comment label', () => {
    const plan = buildTaskMessagePlan(
      { postLink: 'https://www.reddit.com/r/testsub/comments/abc/' },
      CONTENT,
    );
    expect(plan.metadata[plan.metadata.length - 1]).toBe('comment');
    expect(plan.content).toEqual([CONTENT]);
  });
});

describe('buildInstructionMessage', () => {
  it('uses the post instruction for post tasks', () => {
    const plan = buildTaskMessagePlan(POST_FIELDS, CONTENT);
    const expected = {
      title: '📌 IMPORTANT — Reply with your post link',
      lines: [
        'Post everything exactly as it is.',
        'Then reply to THIS message with the link of your post within 10 minutes.',
      ],
      footer: 'Reply to this message with your link',
    };
    expect(plan.instruction).toEqual(expected);
    expect(buildInstructionMessage(POST_FIELDS)).toEqual(plan.instruction);
  });

  it('uses the comment instruction for comment tasks', () => {
    const fields = { postLink: 'https://www.reddit.com/r/testsub/comments/abc/' };
    const plan = buildTaskMessagePlan(fields, CONTENT);
    const expected = {
      title: '📌 IMPORTANT — Reply with your comment link',
      lines: [
        '1️⃣ Post any random comment related to the post.',
        '2️⃣ After 10 minutes, edit that random comment and paste the given comment.',
        '3️⃣ Reply to THIS message with the link of your comment.',
      ],
      footer: 'Reply to this message with your link',
    };
    expect(plan.instruction).toEqual(expected);
    expect(buildInstructionMessage(fields)).toEqual(plan.instruction);
  });

  it('includes the instruction even when there is no content', () => {
    const plan = buildTaskMessagePlan({ title: 'Just a title' }, '');
    expect(plan.instruction.title.length).toBeGreaterThan(0);
    expect(plan.instruction.lines.length).toBeGreaterThan(0);
  });
});
