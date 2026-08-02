import { htmlToDiscord } from '../utils/html-to-discord';

describe('htmlToDiscord', () => {
  test('paragraphs are separated by a blank line', () => {
    const html = '<p>This is paragraph one.</p><p>This is paragraph two.</p><p>This is paragraph three.</p>';
    expect(htmlToDiscord(html)).toBe('This is paragraph one.\n\nThis is paragraph two.\n\nThis is paragraph three.');
  });

  test('bold and italic are preserved', () => {
    const html = '<p>Hello <strong>everyone</strong> and <em>thanks</em>.</p>';
    expect(htmlToDiscord(html)).toBe('Hello **everyone** and *thanks*.');
  });

  test('links become [text](href)', () => {
    const html = '<p>See <a href="https://www.reddit.com/r/ebikes/">this sub</a>.</p>';
    expect(htmlToDiscord(html)).toBe('See [this sub](https://www.reddit.com/r/ebikes/).');
  });

  test('link whose text equals the href is emitted as a plain URL', () => {
    const html = '<p><a href="https://www.reddit.com/r/ebikes/">https://www.reddit.com/r/ebikes/</a></p>';
    expect(htmlToDiscord(html)).toBe('https://www.reddit.com/r/ebikes/');
  });

  test('line breaks are preserved', () => {
    const html = '<p>Line one<br>Line two</p>';
    expect(htmlToDiscord(html)).toBe('Line one\nLine two');
  });

  test('unordered lists become bullet items', () => {
    const html = '<ul><li>First</li><li>Second</li><li>Third</li></ul>';
    expect(htmlToDiscord(html)).toBe('• First\n• Second\n• Third');
  });

  test('ordered lists are numbered', () => {
    const html = '<ol><li>First</li><li>Second</li></ol>';
    expect(htmlToDiscord(html)).toBe('1. First\n2. Second');
  });

  test('blockquotes are prefixed with >', () => {
    const html = '<p>Before</p><blockquote>Quoted line</blockquote><p>After</p>';
    expect(htmlToDiscord(html)).toBe('Before\n\n> Quoted line\n\nAfter');
  });

  test('headings become bold paragraphs', () => {
    const html = '<h2>Section</h2><p>Body</p>';
    expect(htmlToDiscord(html)).toBe('**Section**\n\nBody');
  });

  test('inline code is backtick-wrapped', () => {
    const html = '<p>Run <code>npm install</code> now.</p>';
    expect(htmlToDiscord(html)).toBe('Run `npm install` now.');
  });

  test('pre code blocks keep their content intact across paragraphs', () => {
    const html = '<p>Example:</p><pre><code>const a = 1;\n\nconst b = 2;</code></pre><p>Done.</p>';
    const result = htmlToDiscord(html);
    expect(result).toBe('Example:\n\n```\nconst a = 1;\n\nconst b = 2;\n```\n\nDone.');
  });

  test('empty paragraphs collapse to a single blank line between real paragraphs', () => {
    const html = '<p>One</p><p></p><p>Two</p>';
    expect(htmlToDiscord(html)).toBe('One\n\nTwo');
  });

  test('spec DOM example preserves formatting', () => {
    const html =
      '<div class="prose prose-gray max-w-none select-none rounded-lg text-foreground">' +
      '<p>Every campaign starts with plenty of ideas.</p>' +
      '<p>The problem starts after <strong>version one</strong>.</p>' +
      '<p>"Can we make it shorter?"</p>' +
      '</div>';
    expect(htmlToDiscord(html)).toBe(
      'Every campaign starts with plenty of ideas.\n\nThe problem starts after **version one**.\n\n"Can we make it shorter?"',
    );
  });

  test('strikethrough and underline are preserved', () => {
    const html = '<p>Old <s>text</s> and <u>new</u>.</p>';
    expect(htmlToDiscord(html)).toBe('Old ~~text~~ and __new__.');
  });

  test('nbsp entities become regular spaces', () => {
    const html = '<p>Hello&nbsp;world</p>';
    expect(htmlToDiscord(html)).toBe('Hello world');
  });

  test('whitespace-only content returns an empty string', () => {
    expect(htmlToDiscord('<p>   </p><p></p>')).toBe('');
  });

  test('nested formatting renders correctly', () => {
    const html = '<p><strong>Bold with <em>italic</em> inside</strong></p>';
    expect(htmlToDiscord(html)).toBe('**Bold with *italic* inside**');
  });

  test('images inside content are ignored (delivered separately)', () => {
    const html = '<p>Text</p><img src="https://static.goparttime.net/img/x.jpg" alt="https://static.goparttime.net/img/x.jpg">';
    expect(htmlToDiscord(html)).toBe('Text');
  });
});
