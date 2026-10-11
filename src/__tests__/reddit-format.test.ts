import { compareRedditFormat, normalizeInline, splitParagraphs } from '../utils/reddit-format';

describe('splitParagraphs', () => {
  it('splits on blank lines', () => {
    expect(splitParagraphs('a\n\nb\n\nc')).toEqual(['a', 'b', 'c']);
  });
  it('collapses 3+ newlines and trims', () => {
    expect(splitParagraphs('  a\n\n\nb  ')).toEqual(['a', 'b']);
  });
});

describe('normalizeInline', () => {
  it('is case/whitespace/markdown insensitive', () => {
    expect(normalizeInline('  **Hello**   World  ')).toBe('hello world');
  });
  it('folds smart quotes and reduces links to text', () => {
    expect(normalizeInline('[“quoted”](https://x)')).toBe('"quoted"');
  });
});

describe('compareRedditFormat', () => {
  const title = 'Test Title';
  it('matches identical content', () => {
    const r = compareRedditFormat({
      expectedTitle: title,
      expectedContent: 'para one\n\npara two',
      actualTitle: title,
      actualContent: 'para one\n\npara two',
    });
    expect(r.status).toBe('MATCH');
    expect(r.expectedParas).toBe(2);
  });
  it('fails fewer paragraphs (dropped content)', () => {
    const r = compareRedditFormat({
      expectedTitle: title,
      expectedContent: 'one\n\ntwo\n\nthree\n\nfour',
      actualTitle: title,
      actualContent: 'one two three four',
    });
    expect(r.status).toBe('PARA_SHORT');
    expect(r.expectedParas).toBe(4);
    expect(r.actualParas).toBe(1);
  });
  it('passes more paragraphs (collapsed source re-pasted correctly)', () => {
    const r = compareRedditFormat({
      expectedTitle: title,
      expectedContent: 'one two',
      actualTitle: title,
      actualContent: 'one\n\ntwo\n\nthree',
    });
    expect(r.status).toBe('PARA_EXTRA');
    expect(r.expectedParas).toBe(1);
    expect(r.actualParas).toBe(3);
  });
  it('short count fails even when the title also mismatches', () => {
    const r = compareRedditFormat({
      expectedTitle: title,
      expectedContent: 'one\n\ntwo\n\nthree',
      actualTitle: 'Different title',
      actualContent: 'one two three',
    });
    expect(r.status).toBe('PARA_SHORT');
    expect(r.titleMatch).toBe(false);
  });
  it('title mismatch with equal counts stays a title verdict', () => {
    const r = compareRedditFormat({
      expectedTitle: title,
      expectedContent: 'one\n\ntwo',
      actualTitle: 'Different title',
      actualContent: 'one\n\ntwo\n\nthree',
    });
    expect(r.status).toBe('TITLE_MISMATCH');
  });
  it('flags title mismatch', () => {
    const r = compareRedditFormat({
      expectedTitle: title,
      expectedContent: 'body',
      actualTitle: 'Different title',
      actualContent: 'body',
    });
    expect(r.status).toBe('TITLE_MISMATCH');
  });
  it('flags altered text with same para count', () => {
    const r = compareRedditFormat({
      expectedTitle: title,
      expectedContent: 'alpha\n\nbeta',
      actualTitle: title,
      actualContent: 'alpha\n\nGAMMA',
    });
    expect(r.status).toBe('TEXT_MISMATCH');
  });
  it('matches image-only posts (both empty)', () => {
    const r = compareRedditFormat({
      expectedTitle: title,
      expectedContent: '',
      actualTitle: title,
      actualContent: '',
    });
    expect(r.status).toBe('MATCH');
  });
});
