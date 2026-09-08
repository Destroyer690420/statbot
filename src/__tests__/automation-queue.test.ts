/**
 * Sighting freshness (hybrid companion flow). Dynamic import after dummy env
 * (queue pulls env + DB layers — same pattern as automation-cookies.test.ts).
 */
describe('isSightingFresh', () => {
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
    return import('../services/automation/queue.service');
  }

  it('accepts recent sightings', async () => {
    const { isSightingFresh, SIGHTING_TTL_MS } = await load();
    const now = new Date('2026-09-08T10:00:00Z').getTime();
    expect(isSightingFresh(new Date(now - 60 * 1000), now)).toBe(true);
    expect(isSightingFresh(new Date(now - SIGHTING_TTL_MS + 1000), now)).toBe(true);
  });

  it('rejects stale sightings', async () => {
    const { isSightingFresh, SIGHTING_TTL_MS } = await load();
    const now = new Date('2026-09-08T10:00:00Z').getTime();
    expect(isSightingFresh(new Date(now - SIGHTING_TTL_MS - 1000), now)).toBe(false);
    expect(isSightingFresh(new Date(now - 60 * 60 * 1000), now)).toBe(false);
  });

  it('supports custom ttl', async () => {
    const { isSightingFresh } = await load();
    const now = new Date('2026-09-08T10:00:00Z').getTime();
    expect(isSightingFresh(new Date(now - 5000), now, 10000)).toBe(true);
    expect(isSightingFresh(new Date(now - 15000), now, 10000)).toBe(false);
  });
});
