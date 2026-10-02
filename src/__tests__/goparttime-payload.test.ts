import { goPartTimePayloadSchema } from '../utils/goparttime-payload';

describe('goPartTimePayloadSchema', () => {
  const baseComment = {
    taskId: 580348,
    type: 'comment',
    ticket: 'Ticket-0009',
    deadline: 'Jul 31 3:50 PM',
    payment: '$1.00',
    postLink: 'https://www.reddit.com/r/PressOnNailHub/comments/1vbkzrf/i_like_this_new_color/',
    contentHtml: '<p>could I get this pattern?</p>',
    images: [],
    sourceUrl: 'https://goparttime.net/my-tasks/todo',
  };

  test('valid comment payload parses and taskId becomes a string', () => {
    const parsed = goPartTimePayloadSchema.parse(baseComment);
    expect(parsed.taskId).toBe('580348');
    expect(parsed.type).toBe('comment');
    expect(parsed.images).toEqual([]);
  });

  test('valid post payload parses', () => {
    const payload = {
      taskId: '579470',
      type: 'post',
      ticket: 'Ticket-0009',
      deadline: 'Jul 31 3:54 PM',
      payment: '$2.50',
      subreddit: 'r/ebikes',
      subredditUrl: 'https://www.reddit.com/r/ebikes/',
      flair: null,
      title: "What's the best unexpected perk of your ebike?",
      postLink: null,
      contentHtml: '<p>Some content here.</p><p>More content.</p>',
      images: [{ order: 1, url: 'https://static.goparttime.net/img/a.jpg' }],
      sourceUrl: 'https://goparttime.net/my-tasks/todo',
    };
    const parsed = goPartTimePayloadSchema.parse(payload);
    expect(parsed.subreddit).toBe('r/ebikes');
    expect(parsed.images).toHaveLength(1);
  });

  test('post without title is rejected', () => {
    const payload = {
      taskId: 579470,
      type: 'post',
      ticket: 'Ticket-0009',
      subreddit: 'r/ebikes',
      contentHtml: '<p>x</p>',
    };
    const result = goPartTimePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'title')).toBe(true);
    }
  });

  test('comment without postLink is rejected', () => {
    const payload = { ...baseComment, postLink: undefined };
    const result = goPartTimePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  test('non-sequential image orders are rejected', () => {
    const payload = {
      ...baseComment,
      images: [
        { order: 1, url: 'https://static.goparttime.net/a.jpg' },
        { order: 3, url: 'https://static.goparttime.net/b.jpg' },
      ],
    };
    const result = goPartTimePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  test('sequential image orders are accepted', () => {
    const payload = {
      ...baseComment,
      images: [
        { order: 1, url: 'https://static.goparttime.net/a.jpg' },
        { order: 2, url: 'https://static.goparttime.net/b.jpg' },
      ],
    };
    expect(goPartTimePayloadSchema.safeParse(payload).success).toBe(true);
  });

  test('more than 20 images is rejected', () => {
    const images = Array.from({ length: 21 }, (_, i) => ({
      order: i + 1,
      url: `https://static.goparttime.net/img/${i}.jpg`,
    }));
    const payload = { ...baseComment, images };
    const result = goPartTimePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  test('empty content is rejected', () => {
    const payload = { ...baseComment, contentHtml: '   ' };
    const result = goPartTimePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  test('missing ticket is rejected', () => {
    const payload = { ...baseComment, ticket: undefined };
    const result = goPartTimePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  test('invalid taskId (non-digits) is rejected', () => {
    const payload = { ...baseComment, taskId: 'abc123' };
    const result = goPartTimePayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  test('media without a kind defaults to image (older userscripts)', () => {
    const payload = {
      ...baseComment,
      images: [{ order: 1, url: 'https://static.goparttime.net/a.jpg' }],
    };
    const parsed = goPartTimePayloadSchema.parse(payload);
    expect(parsed.images[0].kind).toBe('image');
  });

  test('a video-only task parses and keeps its kind', () => {
    const payload = {
      ...baseComment,
      contentHtml: '',
      images: [
        {
          order: 1,
          url: 'https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/a.mp4?tag=29',
          kind: 'video',
        },
      ],
    };
    const parsed = goPartTimePayloadSchema.parse(payload);
    expect(parsed.images[0].kind).toBe('video');
  });

  test('images and a video share one sequential order', () => {
    const payload = {
      ...baseComment,
      images: [
        { order: 1, url: 'https://static.goparttime.net/a.jpg', kind: 'image' },
        { order: 2, url: 'https://video.twimg.com/a.mp4', kind: 'video' },
      ],
    };
    expect(goPartTimePayloadSchema.safeParse(payload).success).toBe(true);
  });

  test('an unknown media kind is rejected', () => {
    const payload = {
      ...baseComment,
      images: [{ order: 1, url: 'https://static.goparttime.net/a.gif', kind: 'gif' }],
    };
    expect(goPartTimePayloadSchema.safeParse(payload).success).toBe(false);
  });
});
