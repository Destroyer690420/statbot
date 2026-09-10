/**
 * Moderators are excluded from worker detection (via getAllAdminIds) but get
 * no slash-command privileges (isAdminOrManager stays false).
 * Dynamic import after dummy env (same pattern as automation-crypto.test.ts).
 */
describe('moderator permissions', () => {
  const OLD_MOD = process.env.MODERATOR_USER_IDS;

  beforeEach(() => {
    jest.resetModules();
    process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'x'.repeat(10);
    process.env.CLIENT_ID = process.env.CLIENT_ID || 'x';
    process.env.GUILD_ID = process.env.GUILD_ID || 'x';
    process.env.ADMIN_USER_IDS = '111';
    process.env.MANAGER_USER_IDS = '222';
    process.env.MODERATOR_USER_IDS = '582595416294555649, 1506900129792135211,1202294567706316911';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://u:p@localhost:5432/db';
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(16);
    process.env.DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'x';
  });

  afterEach(() => {
    if (OLD_MOD === undefined) delete process.env.MODERATOR_USER_IDS;
    else process.env.MODERATOR_USER_IDS = OLD_MOD;
  });

  it('excludes moderators from worker detection pool', async () => {
    const { getAllAdminIds, isModerator } = await import('../utils/permissions');
    const all = getAllAdminIds();
    expect(all).toEqual(expect.arrayContaining(['111', '222']));
    expect(all).toEqual(
      expect.arrayContaining(['582595416294555649', '1506900129792135211', '1202294567706316911']),
    );
    expect(isModerator('582595416294555649')).toBe(true);
    expect(isModerator('999')).toBe(false);
  });

  it('grants moderators no command privileges', async () => {
    const { isAdminOrManager, isAdmin } = await import('../utils/permissions');
    expect(isAdminOrManager('582595416294555649')).toBe(false);
    expect(isAdmin('582595416294555649')).toBe(false);
    expect(isAdminOrManager('111')).toBe(true);
  });

  it('tolerates empty moderator list', async () => {
    process.env.MODERATOR_USER_IDS = '';
    jest.resetModules();
    const { getAllAdminIds, isModerator } = await import('../utils/permissions');
    expect(getAllAdminIds()).toEqual(['111', '222']);
    expect(isModerator('582595416294555649')).toBe(false);
  });
});
