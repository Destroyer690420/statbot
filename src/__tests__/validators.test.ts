import { isValidRedditUrl, isValidNotes, isSupportedImage, sanitize, isValidSnowflake } from '../utils/validators';

describe('isValidRedditUrl', () => {
  it('accepts valid reddit post URL', () => {
    expect(isValidRedditUrl('https://www.reddit.com/r/test/comments/123/')).toBe(true);
  });

  it('accepts valid reddit comment URL', () => {
    expect(isValidRedditUrl('https://www.reddit.com/r/test/comments/123/abc/')).toBe(true);
  });

  it('accepts old.reddit.com', () => {
    expect(isValidRedditUrl('https://old.reddit.com/r/test/')).toBe(true);
  });

  it('rejects non-reddit URL', () => {
    expect(isValidRedditUrl('https://example.com')).toBe(false);
  });

  it('rejects invalid string', () => {
    expect(isValidRedditUrl('not a url')).toBe(false);
  });

  it('trims whitespace', () => {
    expect(isValidRedditUrl('  https://www.reddit.com/r/test/  ')).toBe(true);
  });
});

describe('isValidNotes', () => {
  it('accepts short notes', () => {
    expect(isValidNotes('short note')).toBe(true);
  });

  it('rejects notes over 500 chars', () => {
    expect(isValidNotes('x'.repeat(501))).toBe(false);
  });

  it('accepts exactly 500 chars', () => {
    expect(isValidNotes('x'.repeat(500))).toBe(true);
  });

  it('accepts empty string', () => {
    expect(isValidNotes('')).toBe(true);
  });
});

describe('isSupportedImage', () => {
  it('accepts png', () => expect(isSupportedImage('image.png')).toBe(true));
  it('accepts jpg', () => expect(isSupportedImage('image.jpg')).toBe(true));
  it('accepts jpeg', () => expect(isSupportedImage('image.jpeg')).toBe(true));
  it('accepts webp', () => expect(isSupportedImage('image.webp')).toBe(true));
  it('rejects gif', () => expect(isSupportedImage('image.gif')).toBe(false));
  it('rejects pdf', () => expect(isSupportedImage('file.pdf')).toBe(false));
  it('rejects no extension', () => expect(isSupportedImage('file')).toBe(false));
});

describe('sanitize', () => {
  it('removes angle brackets', () => {
    expect(sanitize('hello <world>')).toBe('hello world');
  });

  it('removes @ symbols', () => {
    expect(sanitize('hello @everyone')).toBe('hello everyone');
  });

  it('removes & symbols', () => {
    expect(sanitize('a & b')).toBe('a  b');
  });

  it('trims whitespace', () => {
    expect(sanitize('  hello  ')).toBe('hello');
  });
});

describe('isValidSnowflake', () => {
  it('accepts 18-digit snowflake', () => {
    expect(isValidSnowflake('123456789012345678')).toBe(true);
  });

  it('rejects too short', () => {
    expect(isValidSnowflake('12345')).toBe(false);
  });

  it('rejects non-numeric', () => {
    expect(isValidSnowflake('abcdefghijklmnopqr')).toBe(false);
  });
});
