import { sanitizeRedditCookie, assertRedditCookie } from '../utils/reddit-session-cookie';

const REALISTIC_COOKIE =
  'edgebucket=abc123; reddit_session=eyJhbGciOiJIUzI1NiJ9abcdefghij1234567890ABCDEFGHIJ1234567890abcdefghij; ' +
  'token=dummy-token-value-0123456789abcdef; loid=0000000000abcdef.2.1757740000.Z0FBQUFBQm1; session_tracker=xyz789';

describe('sanitizeRedditCookie', () => {
  it('keeps a clean header untouched (semicolons and spaces preserved)', () => {
    expect(sanitizeRedditCookie(REALISTIC_COOKIE)).toBe(REALISTIC_COOKIE);
  });
  it('strips a Cookie: prefix (any case)', () => {
    expect(sanitizeRedditCookie('Cookie: ' + REALISTIC_COOKIE)).toBe(REALISTIC_COOKIE);
    expect(sanitizeRedditCookie('cookie:' + REALISTIC_COOKIE)).toBe(REALISTIC_COOKIE);
  });
  it('strips surrounding quotes', () => {
    expect(sanitizeRedditCookie('"' + REALISTIC_COOKIE + '"')).toBe(REALISTIC_COOKIE);
  });
  it('collapses pasted line breaks', () => {
    const multiline = REALISTIC_COOKIE.replace('; ', ';\n');
    const clean = sanitizeRedditCookie(multiline);
    expect(clean).not.toMatch(/[\r\n]/);
    expect(clean).toContain('reddit_session=');
  });
});

describe('assertRedditCookie', () => {
  it('accepts a realistic full header', () => {
    expect(() => assertRedditCookie(REALISTIC_COOKIE)).not.toThrow();
  });
  it('rejects truncated pastes', () => {
    expect(() => assertRedditCookie('reddit_session=abc')).toThrow(/too short/i);
  });
  it('rejects empty input', () => {
    expect(() => assertRedditCookie('')).toThrow();
  });
  it('rejects values with no name=value pairs', () => {
    expect(() => assertRedditCookie('x'.repeat(100))).toThrow(/name=value/i);
  });
  it('rejects non-Reddit cookies', () => {
    expect(() => assertRedditCookie('foo=bar; baz=' + 'q'.repeat(100))).toThrow(/session cookie/i);
  });
  it('rejects absurdly long input', () => {
    expect(() => assertRedditCookie('reddit_session=' + 'q'.repeat(12001))).toThrow(/long/i);
  });
});
