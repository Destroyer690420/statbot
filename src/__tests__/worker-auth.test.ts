/**
 * Worker portal OTP: generation, hashing, issue/verify, lockout.
 * Dynamic import after dummy env (same pattern as permissions.test.ts)
 * because src/config/env.ts validates on import.
 */
describe('worker OTP helpers', () => {
  let svc: typeof import('../services/worker-auth.service');

  beforeEach(async () => {
    jest.resetModules();
    process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'x'.repeat(10);
    process.env.CLIENT_ID = process.env.CLIENT_ID || 'x';
    process.env.GUILD_ID = process.env.GUILD_ID || 'x';
    process.env.ADMIN_USER_IDS = process.env.ADMIN_USER_IDS || '111';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://u:p@localhost:5432/db';
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(16);
    process.env.DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'x';
    svc = await import('../services/worker-auth.service');
    svc.__clearWorkerAuthMemory();
  });

  it('generates 6-digit numeric codes', () => {
    for (let i = 0; i < 20; i++) {
      expect(svc.generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it('hashes deterministically and compares timing-safe', () => {
    const h1 = svc.hashOtp('123456');
    expect(svc.hashOtp('123456')).toBe(h1);
    expect(svc.hashOtp('654321')).not.toBe(h1);
    expect(svc.safeEqual(h1, svc.hashOtp('123456'))).toBe(true);
    expect(svc.safeEqual(h1, svc.hashOtp('000000'))).toBe(false);
  });

  it('verifies an issued code once, then expires', async () => {
    const code = await svc.issueOtp('chan-1');
    expect(await svc.verifyOtp('chan-1', code)).toEqual({ ok: true });
    expect(await svc.verifyOtp('chan-1', code)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects wrong codes and locks after 5 attempts', async () => {
    await svc.issueOtp('chan-2');
    for (let i = 0; i < 4; i++) {
      expect(await svc.verifyOtp('chan-2', '000000')).toEqual({ ok: false, reason: 'mismatch' });
    }
    expect(await svc.verifyOtp('chan-2', '000000')).toEqual({ ok: false, reason: 'locked' });
  });
});
