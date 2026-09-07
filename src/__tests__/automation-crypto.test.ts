/**
 * Vault crypto round-trip. Uses a throwaway 32-byte key via env override.
 * Never touches the real GOPARTTIME_SESSION_KEY value.
 */
describe('automation vault crypto', () => {
  const OLD = process.env.GOPARTTIME_SESSION_KEY;

  beforeEach(() => {
    jest.resetModules();
    process.env.GOPARTTIME_SESSION_KEY = Buffer.alloc(32, 7).toString('hex');
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

  it('encrypts and decrypts', async () => {
    const { encryptSecret, decryptSecret } = await import('../services/automation/crypto');
    const cipher = encryptSecret('cookie-value-123');
    expect(cipher).toBeTruthy();
    expect(cipher).not.toContain('cookie-value-123');
    expect(decryptSecret(cipher!)).toBe('cookie-value-123');
  });

  it('returns null when vault unconfigured', async () => {
    delete process.env.GOPARTTIME_SESSION_KEY;
    jest.resetModules();
    const mod = await import('../services/automation/crypto');
    expect(mod.encryptSecret('x')).toBeNull();
    expect(mod.isVaultConfigured()).toBe(false);
  });
});
