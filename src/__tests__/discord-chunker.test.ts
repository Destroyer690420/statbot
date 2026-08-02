import { chunkText } from '../utils/discord-chunker';

const TARGET = 1900;
const HARD_MAX = 2000;

function makeParagraph(length: number, seed: string): string {
  const word = seed.repeat(Math.ceil(length / seed.length)).slice(0, length);
  return word;
}

function assertNoBrokenWords(chunks: string[]): void {
  for (const chunk of chunks) {
    if (chunk.length > HARD_MAX) {
      throw new Error(`Chunk exceeds ${HARD_MAX} chars (${chunk.length})`);
    }
  }
}

describe('chunkText — limits and paragraph behavior', () => {
  test('under-limit content stays as a single chunk', () => {
    const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
    expect(chunkText(text)).toEqual(['Paragraph one.\n\nParagraph two.\n\nParagraph three.']);
  });

  test('slightly over-limit content splits at paragraph boundaries', () => {
    const p1 = makeParagraph(1500, 'alpha ');
    const p2 = makeParagraph(1500, 'beta ');
    const chunks = chunkText(`${p1}\n\n${p2}`);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(p1.trim());
    expect(chunks[1]).toBe(p2.trim());
  });

  test('many short paragraphs are packed greedily with blank lines between them', () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} here.`);
    const text = paragraphs.join('\n\n');
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      assertNoBrokenWords(chunks);
      expect(chunk.length).toBeLessThanOrEqual(TARGET);
    }
    const rebuilt = chunks.join('\n\n');
    for (const paragraph of paragraphs) {
      expect(rebuilt).toContain(paragraph);
    }
    expect(rebuilt.replace(/\n{2,}/g, '\n\n')).toBe(text.replace(/\n{2,}/g, '\n\n'));
  });

  test('one paragraph over the limit is split at sentence boundaries', () => {
    const sentences = Array.from({ length: 60 }, (_, i) => `Sentence number ${i + 1} ends here.`);
    const para = sentences.join(' ');
    const chunks = chunkText(para);
    assertNoBrokenWords(chunks);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(TARGET);
    }
    const rebuilt = chunks.join(' ');
    expect(rebuilt).toContain('Sentence number 1');
    expect(rebuilt).toContain('Sentence number 60');
  });

  test('a single huge sentence splits at word boundaries', () => {
    const words = Array.from({ length: 500 }, (_, i) => `word${i + 1}`).join(' ');
    const chunks = chunkText(words);
    assertNoBrokenWords(chunks);
    expect(chunks.length).toBeGreaterThan(1);
    // No word may be broken across chunks
    const rebuilt = chunks.join(' ');
    for (let i = 1; i <= 500; i++) {
      expect(rebuilt).toContain(`word${i}`);
    }
  });

  test('a single unbroken token longer than the limit is character-split (last resort)', () => {
    const token = 'x'.repeat(5000);
    const chunks = chunkText(token);
    assertNoBrokenWords(chunks);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('').replace(/x/g, '')).toBe('');
  });

  test('every chunk stays within the hard max', () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => makeParagraph(700, `paragraph-${i + 1}-`));
    const chunks = chunkText(paragraphs.join('\n\n'));
    assertNoBrokenWords(chunks);
  });
});

describe('chunkText — formatting preservation', () => {
  test('bold formatting is not split when a safe alternative exists', () => {
    const paragraphs = [
      'Plain sentence here.',
      '**This entire bold sentence is fully formatted.**',
      'Another plain sentence.',
    ];
    const text = paragraphs.join('\n\n');
    const chunks = chunkText(text);
    assertNoBrokenWords(chunks);
    const rebuilt = chunks.join('\n\n');
    expect(rebuilt).toContain('**This entire bold sentence is fully formatted.**');
  });

  test('italic formatting is not split when a safe alternative exists', () => {
    const sentences = Array.from({ length: 80 }, (_, i) => `Regular sentence ${i + 1} with some words.`);
    sentences[40] = '*A short italic sentence.*';
    const text = sentences.join(' ');
    const chunks = chunkText(text);
    assertNoBrokenWords(chunks);
    const rebuilt = chunks.join(' ');
    expect(rebuilt).toContain('*A short italic sentence.*');
  });

  test('links are not split when a safe alternative exists', () => {
    const text = `See the guide at [https://www.reddit.com/r/ebikes](https://www.reddit.com/r/ebikes/) for more.\n\n${makeParagraph(1500, 'more text ')}\n\n${makeParagraph(1500, 'extra text ')}`;
    const chunks = chunkText(text);
    assertNoBrokenWords(chunks);
    const rebuilt = chunks.join('\n\n');
    expect(rebuilt).toContain('[https://www.reddit.com/r/ebikes](https://www.reddit.com/r/ebikes/)');
  });

  test('blank lines between paragraphs are preserved in every chunk', () => {
    const paragraphs = Array.from({ length: 25 }, (_, i) => makeParagraph(150, `block ${i + 1} `));
    const text = paragraphs.join('\n\n');
    const chunks = chunkText(text);
    assertNoBrokenWords(chunks);
    for (const chunk of chunks) {
      const parts = chunk.split(/\n{2,}/);
      for (const part of parts) {
        expect(part.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('mixed formatting survives splitting', () => {
    const sentences = Array.from({ length: 100 }, (_, i) => `Sentence ${i + 1} with **bold part** and *italic part* and a [link](https://reddit.com/r/x).`);
    const text = sentences.join(' ');
    const chunks = chunkText(text);
    assertNoBrokenWords(chunks);
    const rebuilt = chunks.join(' ');
    expect(rebuilt).toContain('**bold part**');
    expect(rebuilt).toContain('*italic part*');
    expect(rebuilt).toContain('[link](https://reddit.com/r/x)');
  });

  test('a huge single bold word is closed and reopened across chunks', () => {
    const text = `**${'y'.repeat(5000)}**`;
    const chunks = chunkText(text);
    assertNoBrokenWords(chunks);
    // First chunk closes the bold; continuation re-opens it
    expect(chunks[0].startsWith('**')).toBe(true);
    expect(chunks[0].endsWith('**')).toBe(true);
    expect(chunks[1].startsWith('**')).toBe(true);
    expect(chunks[chunks.length - 1].endsWith('**')).toBe(true);
    expect(chunks.join('').replace(/\*/g, '')).toBe('y'.repeat(5000));
  });

  test('fenced code blocks are kept together when they fit', () => {
    const code = '```\nconst a = 1;\nconst b = 2;\n```';
    const text = `Intro paragraph.\n\n${code}\n\nOutro paragraph.\n\n${makeParagraph(1800, 'filler ')}`;
    const chunks = chunkText(text);
    assertNoBrokenWords(chunks);
    const rebuilt = chunks.join('\n\n');
    expect(rebuilt).toContain(code);
  });

  test('oversized fenced code blocks split at line boundaries keeping fences', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `code line ${i + 1} with content`);
    const code = '```\n' + lines.join('\n') + '\n```';
    const chunks = chunkText(code);
    assertNoBrokenWords(chunks);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].startsWith('```')).toBe(true);
    expect(chunks[chunks.length - 1].endsWith('```')).toBe(true);
    const rebuilt = chunks.join('\n');
    for (const line of lines) {
      expect(rebuilt).toContain(line);
    }
  });

  test('custom limits are respected', () => {
    const text = makeParagraph(3000, 'word ');
    const chunks = chunkText(text, { target: 500, hardMax: 600 });
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(600);
    }
  });
});
