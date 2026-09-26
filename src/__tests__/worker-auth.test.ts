import crypto from 'crypto';
import jwt from 'jsonwebtoken';

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/**
 * Phase 0 + OTP security tests. Env is set before dynamic imports (repo
 * pattern) because src/config/env.ts validates on import.
 */
describe('worker auth + OTP', () => {
  let authMw: typeof import('../api/middleware/auth');
  let workerMw: typeof import('../api/middleware/workerAuth');
  let svc: typeof import('../services/worker-auth.service');
  let env: typeof import('../config/env')['env'];

  const ADMIN_SECRET = 'admin-secret-' + 'x'.repeat(24);
  const WORKER_SECRET = 'w'.repeat(40);

  beforeAll(async () => {
    jest.resetModules();
    process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'x'.repeat(10);
    process.env.CLIENT_ID = process.env.CLIENT_ID || 'test-client';
    process.env.GUILD_ID = process.env.GUILD_ID || 'guild-1';
    process.env.ADMIN_USER_IDS = process.env.ADMIN_USER_IDS || '111';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://u:p@localhost:5432/db';
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
    process.env.JWT_SECRET = ADMIN_SECRET;
    process.env.DASHBOARD_USERNAME = 'admin';
    process.env.DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'pw';
    process.env.WORKER_JWT_SECRET = WORKER_SECRET;
    process.env.WORKER_PORTAL_ENABLED = 'true';
    authMw = await import('../api/middleware/auth');
    workerMw = await import('../api/middleware/workerAuth');
    svc = await import('../services/worker-auth.service');
    env = (await import('../config/env')).env;
  });

  beforeEach(async () => {
    const fresh = await import('../services/worker-auth.service');
    svc = fresh;
    svc.__clearWorkerAuthMemory();
    jest.restoreAllMocks();
  });

  function mockRes(): { status: jest.Mock; json: jest.Mock } {
    const res: { status: jest.Mock; json: jest.Mock } = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    return res;
  }

  function adminToken(username = 'admin'): string {
    return jwt.sign({ username }, ADMIN_SECRET, { expiresIn: '1h' });
  }

  describe('admin authMiddleware hardening', () => {
    it('passes a valid admin token', () => {
      const req = { headers: { authorization: `Bearer ${adminToken()}` } } as never;
      const res = mockRes();
      const next = jest.fn();
      authMw.authMiddleware(req as never, res as never, next);
      expect(next).toHaveBeenCalled();
      expect((req as { userId?: string }).userId).toBe('admin');
    });

    it('rejects tokens without a username or with the wrong username', () => {
      for (const bad of [
        jwt.sign({}, ADMIN_SECRET, { expiresIn: '1h' }),
        jwt.sign({ username: 'someone-else' }, ADMIN_SECRET, { expiresIn: '1h' }),
        // Worker-shaped claims signed with the admin secret carry no admin username.
        jwt.sign({ typ: 'worker', sub: '123', tid: 'chan-1', jti: 'j' }, ADMIN_SECRET, { expiresIn: '1h' }),
      ]) {
        const req = { headers: { authorization: `Bearer ${bad}` } } as never;
        const res = mockRes();
        authMw.authMiddleware(req as never, res as never, jest.fn());
        expect(res.status).toHaveBeenCalledWith(401);
      }
    });

    it('rejects a worker token signed with the worker secret', () => {
      const worker = svc.signWorkerToken({ workerId: '123', channelId: 'chan-1', name: 'w' });
      const req = { headers: { authorization: `Bearer ${worker}` } } as never;
      const res = mockRes();
      authMw.authMiddleware(req as never, res as never, jest.fn());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('rejects missing headers', () => {
      const res = mockRes();
      authMw.authMiddleware({ headers: {} } as never, res as never, jest.fn());
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('workerAuth middleware', () => {
    it('passes a valid worker token and exposes sub identity', async () => {
      const token = svc.signWorkerToken({ workerId: '999', channelId: 'chan-9', name: 'W' });
      const req = { headers: { authorization: `Bearer ${token}` } } as never;
      const res = mockRes();
      const next = jest.fn();
      workerMw.workerAuthMiddleware(req as never, res as never, next);
      await new Promise((r) => setImmediate(r));
      expect(next).toHaveBeenCalled();
      expect((req as { worker?: { sub: string } }).worker?.sub).toBe('999');
    });

    it('rejects an admin token', async () => {
      const req = { headers: { authorization: `Bearer ${adminToken()}` } } as never;
      const res = mockRes();
      workerMw.workerAuthMiddleware(req as never, res as never, jest.fn());
      await new Promise((r) => setImmediate(r));
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('rejects expired, wrong aud/iss, and wrong-alg tokens', async () => {
      const expired = jwt.sign(
        { typ: 'worker', sub: '1', tid: 'c', name: null, jti: 'j1', exp: Math.floor(Date.now() / 1000) - 10 },
        WORKER_SECRET,
        { audience: 'statbot-worker', issuer: 'statbot' },
      );
      const wrongAud = jwt.sign({ typ: 'worker', sub: '1', tid: 'c', name: null, jti: 'j2' }, WORKER_SECRET, {
        audience: 'someone-else',
        issuer: 'statbot',
        expiresIn: '1h',
      });
      const wrongIss = jwt.sign({ typ: 'worker', sub: '1', tid: 'c', name: null, jti: 'j3' }, WORKER_SECRET, {
        audience: 'statbot-worker',
        issuer: 'someone-else',
        expiresIn: '1h',
      });
      const wrongAlg = jwt.sign({ typ: 'worker', sub: '1', tid: 'c', name: null, jti: 'j4' }, WORKER_SECRET, {
        algorithm: 'HS384',
        audience: 'statbot-worker',
        issuer: 'statbot',
        expiresIn: '1h',
      });
      const noTyp = jwt.sign({ sub: '1', tid: 'c', jti: 'j5' }, WORKER_SECRET, {
        audience: 'statbot-worker',
        issuer: 'statbot',
        expiresIn: '1h',
      });
      for (const bad of [expired, wrongAud, wrongIss, wrongAlg, noTyp]) {
        const req = { headers: { authorization: `Bearer ${bad}` } } as never;
        const res = mockRes();
        workerMw.workerAuthMiddleware(req as never, res as never, jest.fn());
        await new Promise((r) => setImmediate(r));
        expect(res.status).toHaveBeenCalledWith(401);
      }
    });

    it('rejects a denylisted jti (logout)', async () => {
      const token = svc.signWorkerToken({ workerId: '5', channelId: 'c5', name: null });
      const payload = svc.verifyWorkerToken(token);
      await svc.denylistWorkerToken(payload.jti, payload.exp * 1000);
      const req = { headers: { authorization: `Bearer ${token}` } } as never;
      const res = mockRes();
      workerMw.workerAuthMiddleware(req as never, res as never, jest.fn());
      await new Promise((r) => setImmediate(r));
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('OTP codes', () => {
    it('generates 8 chars from the restricted alphabet', () => {
      for (let i = 0; i < 50; i++) {
        const code = svc.generateOtpCode();
        expect(code).toHaveLength(8);
        expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
      }
      expect(svc.formatOtpCode('abcd2345')).toBe('ABCD-2345');
    });

    it('verification is case-insensitive and ignores spaces/hyphens', async () => {
      const plan = await svc.planIssueCode('ch-case');
      if (!plan.ok) throw new Error('plan failed');
      await svc.storeIssuedCode('ch-case', plan.code, null);
      const lower = plan.code.toLowerCase();
      const spaced = `${lower.slice(0, 4)} ${lower.slice(4)}`;
      expect(await svc.verifyOtpCode('ch-case', spaced)).toEqual({ ok: true });
    });

    it('stores only the HMAC, never the raw code', async () => {
      const plan = await svc.planIssueCode('ch-hmac');
      if (!plan.ok) throw new Error('plan failed');
      await svc.storeIssuedCode('ch-hmac', plan.code, 'mid-1');
      const found = await svc.readOtpRecord('ch-hmac');
      expect(found).not.toBeNull();
      const expected = crypto.createHmac('sha256', WORKER_SECRET).update(plan.code, 'utf8').digest('hex');
      expect(found!.record.hmac).toBe(expected);
      expect(JSON.stringify(found!.record)).not.toContain(plan.code.slice(0, 4));
      expect(Object.keys(found!.record).sort()).toEqual(['attempts', 'createdAt', 'hmac', 'messageId']);
    });

    it('is single-use with a 5-minute TTL', async () => {
      jest.useFakeTimers();
      try {
        const plan = await svc.planIssueCode('ch-ttl');
        if (!plan.ok) throw new Error('plan failed');
        await svc.storeIssuedCode('ch-ttl', plan.code, null);
        expect(await svc.verifyOtpCode('ch-ttl', plan.code)).toEqual({ ok: true });
        expect(await svc.verifyOtpCode('ch-ttl', plan.code)).toEqual({ ok: false, reason: 'missing' });

        const plan2 = await svc.planIssueCode('ch-ttl2');
        if (!plan2.ok) throw new Error('plan2 failed');
        await svc.storeIssuedCode('ch-ttl2', plan2.code, null);
        jest.advanceTimersByTime(301_000);
        expect(await svc.verifyOtpCode('ch-ttl2', plan2.code)).toEqual({ ok: false, reason: 'missing' });
      } finally {
        jest.useRealTimers();
      }
    });

    it('invalidates after 5 wrong attempts', async () => {
      const plan = await svc.planIssueCode('ch-attempts');
      if (!plan.ok) throw new Error('plan failed');
      await svc.storeIssuedCode('ch-attempts', plan.code, null);
      for (let i = 0; i < 4; i++) {
        const r = await svc.verifyOtpCode('ch-attempts', 'ZZZZZZZZ');
        expect(r).toMatchObject({ ok: false, reason: 'mismatch' });
      }
      expect(await svc.verifyOtpCode('ch-attempts', 'ZZZZZZZZ')).toEqual({ ok: false, reason: 'invalidated' });
      // The real code no longer works either.
      expect(await svc.verifyOtpCode('ch-attempts', plan.code)).toEqual({ ok: false, reason: 'missing' });
    });

    it('allows only one active code and enforces the 60s cooldown', async () => {
      const plan = await svc.planIssueCode('ch-one');
      if (!plan.ok) throw new Error('plan failed');
      await svc.storeIssuedCode('ch-one', plan.code, null);
      const second = await svc.planIssueCode('ch-one');
      expect(second.ok).toBe(false);
      if (!second.ok && second.reason === 'active') expect(second.remainingSeconds).toBeGreaterThan(0);

      await svc.clearOtpRecord('ch-one');
      const cool = await svc.planIssueCode('ch-one');
      expect(cool.ok).toBe(false);
      if (!cool.ok && cool.reason === 'cooldown') expect(cool.remainingSeconds).toBeGreaterThan(0);
    });

    it('caps at 5 codes per ticket per hour', async () => {
      jest.useFakeTimers();
      try {
        for (let i = 0; i < 5; i++) {
          const plan = await svc.planIssueCode('ch-cap');
          if (!plan.ok) throw new Error(`plan ${i} failed: ${JSON.stringify(plan)}`);
          await svc.storeIssuedCode('ch-cap', plan.code, null);
          await svc.clearOtpRecord('ch-cap');
          jest.advanceTimersByTime(61_000);
        }
        expect(await svc.planIssueCode('ch-cap')).toMatchObject({ ok: false, reason: 'hourly_cap' });
      } finally {
        jest.useRealTimers();
      }
    });

    it('locks the ticket after more than 10 failed verifications in an hour', async () => {
      for (let i = 0; i < 10; i++) {
        expect(await svc.verifyOtpCode('ch-lock', 'NOPE-NOPE')).toMatchObject({ ok: false, reason: 'missing' });
      }
      expect(await svc.verifyOtpCode('ch-lock', 'NOPE-NOPE')).toEqual({ ok: false, reason: 'locked' });
      expect(await svc.isTicketLocked('ch-lock')).toBe(true);
      expect(await svc.planIssueCode('ch-lock')).toMatchObject({ ok: false, reason: 'locked' });
    });

    it('compares HMACs in constant time', async () => {
      const timingSpy = jest.spyOn(crypto, 'timingSafeEqual');
      const plan = await svc.planIssueCode('ch-ct');
      if (!plan.ok) throw new Error('plan failed');
      await svc.storeIssuedCode('ch-ct', plan.code, null);
      await svc.verifyOtpCode('ch-ct', 'ZZZZZZZZ');
      expect(timingSpy).toHaveBeenCalled();
    });

    it('fails closed with 503 semantics when Redis is down outside test env', async () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await expect(svc.planIssueCode('ch-down')).rejects.toMatchObject({
          name: 'WorkerRedisUnavailableError',
        });
      } finally {
        process.env.NODE_ENV = prev;
      }
    });
  });

  describe('Discord delivery helpers', () => {
    it('builds a message that tags only the worker with allowedMentions', async () => {
      const sent: { content: string; allowedMentions: unknown }[] = [];
      const channel = {
        send: async (args: { content: string; allowedMentions: unknown }) => {
          sent.push(args);
          return { id: 'mid-9' };
        },
      };
      const mid = await svc.sendOtpToChannel(channel, 'worker-123', 'ABCD2345');
      expect(mid).toBe('mid-9');
      expect(sent).toHaveLength(1);
      expect(sent[0].content).toContain('<@worker-123>');
      expect(sent[0].content).toContain('**ABCD-2345**');
      expect(sent[0].content).toContain('5 minutes');
      expect(sent[0].allowedMentions).toEqual({ users: ['worker-123'] });
    });

    it('schedules expiry cleanup that deletes the message', async () => {
      jest.useFakeTimers();
      try {
        const deleted: string[] = [];
        const client = {
          channels: {
            fetch: async () => ({ messages: { fetch: async () => ({ delete: async () => { deleted.push('mid-x'); } }) } }),
          },
        };
        svc.scheduleOtpExpiryCleanup(client, 'chan-x', 'mid-x', 60_000);
        expect(deleted).toHaveLength(0);
        jest.advanceTimersByTime(60_000);
        for (let i = 0; i < 10; i++) await Promise.resolve();
        expect(deleted).toEqual(['mid-x']);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('worker JWT shape', () => {
    it('carries typ/sub/tid/name/jti/aud/iss with a 7d expiry and never falls back to JWT_SECRET', () => {
      const token = svc.signWorkerToken({ workerId: 'abc', channelId: 'chan', name: 'Ann' });
      const payload = svc.verifyWorkerToken(token);
      expect(payload.typ).toBe('worker');
      expect(payload.sub).toBe('abc');
      expect(payload.tid).toBe('chan');
      expect(payload.name).toBe('Ann');
      expect(payload.aud).toBe('statbot-worker');
      expect(payload.iss).toBe('statbot');
      expect(payload.exp - payload.iat).toBe(7 * 24 * 3600);
      expect(env.DASHBOARD_USERNAME).toBe('admin');
      // A token with the same claims signed by the admin secret must fail.
      const forged = jwt.sign(
        { typ: 'worker', sub: 'abc', tid: 'chan', name: 'Ann', jti: 'x' },
        ADMIN_SECRET,
        { algorithm: 'HS256', audience: 'statbot-worker', issuer: 'statbot', expiresIn: '1h' },
      );
      expect(() => svc.verifyWorkerToken(forged)).toThrow();
    });

    it('treats a pre-scope token as a ticket token and only lets inviter tokens omit tid', () => {
      // Token issued before the scope claim existed.
      const legacy = jwt.sign(
        { typ: 'worker', sub: 'abc', tid: 'chan', name: 'Ann', jti: 'x' },
        env.WORKER_JWT_SECRET,
        { algorithm: 'HS256', audience: 'statbot-worker', issuer: 'statbot', expiresIn: '1h' },
      );
      expect(svc.verifyWorkerToken(legacy).scope).toBe('ticket');

      const inviter = svc.signWorkerToken({ workerId: 'abc', channelId: '', name: 'Ann', scope: 'inviter' });
      const payload = svc.verifyWorkerToken(inviter);
      expect(payload.scope).toBe('inviter');
      expect(payload.tid).toBe('');

      // A ticket token without a channel is still rejected.
      const broken = jwt.sign(
        { typ: 'worker', sub: 'abc', tid: '', scope: 'ticket', name: null, jti: 'x' },
        env.WORKER_JWT_SECRET,
        { algorithm: 'HS256', audience: 'statbot-worker', issuer: 'statbot', expiresIn: '1h' },
      );
      expect(() => svc.verifyWorkerToken(broken)).toThrow();
    });
  });

  describe('invitee DM refs', () => {
    it('is deterministic, opaque, and bound to both the worker and the invitee', () => {
      const a = svc.signInviteeDmRef('111', '222');
      expect(a).toMatch(/^[0-9a-f]{16}$/);
      expect(svc.signInviteeDmRef('111', '222')).toBe(a);
      // Different invitee, and the same invitee under a different inviter.
      expect(svc.signInviteeDmRef('111', '333')).not.toBe(a);
      expect(svc.signInviteeDmRef('999', '222')).not.toBe(a);
      // The invitee id must not be recoverable from the ref.
      expect(a).not.toContain('222');
    });

    it('compares refs safely and rejects mismatches', () => {
      const a = svc.signInviteeDmRef('111', '222');
      expect(svc.dmRefMatches(a, svc.signInviteeDmRef('111', '222'))).toBe(true);
      expect(svc.dmRefMatches(a, svc.signInviteeDmRef('111', '333'))).toBe(false);
      expect(svc.dmRefMatches(a, '')).toBe(false);
      expect(svc.dmRefMatches(a, `${a}x`)).toBe(false);
      expect(svc.dmRefMatches('', '')).toBe(true);
    });

    it('returns an empty ref when the portal secret is not configured', () => {
      const original = env.WORKER_JWT_SECRET;
      (env as { WORKER_JWT_SECRET: string }).WORKER_JWT_SECRET = 'short';
      expect(svc.signInviteeDmRef('111', '222')).toBe('');
      (env as { WORKER_JWT_SECRET: string }).WORKER_JWT_SECRET = original;
    });
  });
});
