/**
 * Rate-limiter exemptions for the companion poll endpoints. Pure module —
 * no env or DB needed.
 *
 * Regression context: the limiter is mounted via `app.use('/api/', ...)`
 * and Express strips the mount prefix from `req.path` inside mounted
 * middleware, so the old `req.path === '/api/v1/...'` skip never matched
 * and companion fast-polling burned the shared IP budget mid-blast (the
 * dashboard's own fetches then 429'd). The skip must use `originalUrl`.
 */
import express from 'express';
import { isRateLimitExempt } from '../utils/rate-limit-exempt';

describe('isRateLimitExempt', () => {
  it('exempts the companion poll endpoints', () => {
    expect(isRateLimitExempt('/api/v1/automation/claims/pending')).toBe(true);
    expect(isRateLimitExempt('/api/v1/automation/sightings')).toBe(true);
    expect(isRateLimitExempt('/api/v1/automation/burst')).toBe(true);
    expect(isRateLimitExempt('/api/v1/automation/eligibility-bundle')).toBe(true);
    expect(isRateLimitExempt('/api/v1/goparttime/assign')).toBe(true);
  });

  it('ignores query strings (the poll always carries scan/elig params)', () => {
    expect(
      isRateLimitExempt(
        '/api/v1/automation/claims/pending?companionId=pc-x&version=1.5.0&tabId=t&scan=35&elig=5',
      ),
    ).toBe(true);
  });

  it('does not exempt dashboard or verdict endpoints', () => {
    expect(isRateLimitExempt('/api/v1/tasks')).toBe(false);
    expect(isRateLimitExempt('/api/v1/tasks?status=ACCEPTED')).toBe(false);
    expect(isRateLimitExempt('/api/v1/automation/status')).toBe(false);
    expect(isRateLimitExempt('/api/v1/automation/cycles')).toBe(false);
    expect(isRateLimitExempt('/api/v1/automation/claims')).toBe(false);
    // Claim verdicts are rare (one per accept) and stay limited.
    expect(isRateLimitExempt('/api/v1/automation/claims/abc123/result')).toBe(false);
    expect(isRateLimitExempt('/api/v1/stats')).toBe(false);
  });

  it('uses originalUrl because req.path loses the mount prefix under app.use', async () => {
    // Pins the Express behavior that made the old skip dead code: inside
    // middleware mounted at '/api/', req.path is stripped to '/v1/...'.
    const app = express();
    let seen: { path: string; originalUrl: string } | null = null;
    app.use('/api/', (req, _res, next) => {
      seen = { path: req.path, originalUrl: req.originalUrl };
      next();
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((_req, res) => {
      res.json({ ok: true });
    });
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/automation/claims/pending?scan=35&elig=5`,
      );
      await res.text();
      expect(seen).not.toBeNull();
      const { path, originalUrl } = seen as unknown as {
        path: string;
        originalUrl: string;
      };
      // The old check could never fire here...
      expect(path === '/api/v1/automation/claims/pending').toBe(false);
      // ...while the originalUrl check correctly exempts.
      expect(isRateLimitExempt(originalUrl)).toBe(true);
    } finally {
      server.close();
    }
  });
});
