/**
 * Cookie-prefix rules + paste sanitizer. Modules are imported dynamically
 * AFTER dummy env is set (importing session/poller pulls env + DB layers,
 * same pattern as automation-crypto.test.ts).
 */
describe('buildCookieParams (Chromium prefix rules)', () => {
  const OLD = process.env.GOPARTTIME_SESSION_KEY;

  beforeEach(() => {
    jest.resetModules();
    process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'x'.repeat(10);
    process.env.CLIENT_ID = process.env.CLIENT_ID || 'x';
    process.env.GUILD_ID = process.env.GUILD_ID || 'x';
    process.env.ADMIN_USER_IDS = process.env.ADMIN_USER_IDS || '1';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://u:p@localhost:5432/db';
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(16);
    process.env.DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'x';
  });

  afterEach(() => {
    if (OLD === undefined) delete process.env.GOPARTTIME_SESSION_KEY;
    else process.env.GOPARTTIME_SESSION_KEY = OLD;
  });

  async function load() {
    return import('../services/automation/poller.service');
  }

  it('marks __Secure- cookie with domain + secure + httpOnly', async () => {
    const { buildCookieParams } = await load();
    const params = buildCookieParams({ sessionToken: 'sess', csrfToken: 'csrf', callbackUrl: 'https%3A%2F%2Fgoparttime.net' });
    const c = params.find((p) => p.name === '__Secure-goparttime.session-token')!;
    expect(c.domain).toBe('.goparttime.net');
    expect(c.path).toBe('/');
    expect(c.secure).toBe(true);
    expect(c.httpOnly).toBe(true);
  });

  it('gives __Host- cookie NO domain (Chromium rejects it otherwise)', async () => {
    const { buildCookieParams } = await load();
    const params = buildCookieParams({ sessionToken: 'sess', csrfToken: 'csrf', callbackUrl: null });
    const c = params.find((p) => p.name === '__Host-goparttime.csrf-token')!;
    expect(c.domain).toBeUndefined();
    expect(c.url).toBe('https://goparttime.net/');
    expect(c.secure).toBe(true);
  });

  it('omits the callback cookie when absent', async () => {
    const { buildCookieParams } = await load();
    const names = buildCookieParams({ sessionToken: 's', csrfToken: 'c', callbackUrl: null }).map((p) => p.name);
    expect(names).not.toContain('__Secure-goparttime.callback-url');
  });
});

describe('sanitizeCookieValue', () => {
  async function load() {
    return import('../services/automation/session.service');
  }

  it('passes raw values through', async () => {
    const { sanitizeCookieValue } = await load();
    expect(sanitizeCookieValue('  eyJhbGciOiJkaXIi  ')).toBe('eyJhbGciOiJkaXIi');
  });

  it('strips Cookie: prefix, quotes, and name= pairs', async () => {
    const { sanitizeCookieValue } = await load();
    expect(sanitizeCookieValue('Cookie: eyJabc')).toBe('eyJabc');
    expect(sanitizeCookieValue('"eyJabc"')).toBe('eyJabc');
    expect(sanitizeCookieValue('__Secure-goparttime.session-token=eyJabc')).toBe('eyJabc');
    expect(sanitizeCookieValue('__Host-goparttime.csrf-token=103ad%7Cf2d')).toBe('103ad%7Cf2d');
  });

  it('never strips = from values without a cookie-name prefix', async () => {
    const { sanitizeCookieValue } = await load();
    expect(sanitizeCookieValue('ab==cd')).toBe('ab==cd');
  });
});

describe('assertCookieValue', () => {
  async function load() {
    return import('../services/automation/session.service');
  }

  it('rejects empty, whitespace, semicolons', async () => {
    const { assertCookieValue } = await load();
    expect(() => assertCookieValue('', 'sessionToken')).toThrow(/empty/);
    expect(() => assertCookieValue('has space', 'sessionToken')).toThrow(/space or semicolon/);
    expect(() => assertCookieValue('a;b', 'sessionToken')).toThrow(/space or semicolon/);
  });

  it('accepts token-shaped values', async () => {
    const { assertCookieValue } = await load();
    expect(() => assertCookieValue('eyJhbGciOiJkaXIi.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', 'sessionToken')).not.toThrow();
    expect(() => assertCookieValue('103ad1565a24d1dc%7Cf2d3678', 'csrfToken')).not.toThrow();
  });
});
