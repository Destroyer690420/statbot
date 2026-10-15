/**
 * Tier-1 server half: the verdict-flag path is what actually calls addBlocked.
 * Tier-0 alone only ever flags (covered in automation-burst-cap.test.ts).
 */
import { handleAutoBlockReport } from '../services/automation/content-block.service';
import { automationRepository } from '../database/repositories';
import { auditLogService } from '../services/audit.service';

jest.mock('../database/repositories', () => ({
  automationRepository: { isBlocked: jest.fn(), addBlocked: jest.fn() },
}));
jest.mock('../services/audit.service', () => ({
  auditLogService: { log: jest.fn() },
}));

const blockedMock = automationRepository.isBlocked as jest.Mock;
const addMock = automationRepository.addBlocked as jest.Mock;
const auditMock = auditLogService.log as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  blockedMock.mockResolvedValue(false);
});

describe('handleAutoBlockReport (enforce mode)', () => {
  it('blocks an unseen sub with an automatic reason + audit, no manual mixing', async () => {
    const out = await handleAutoBlockReport(
      { subreddit: 'r/NewSub', signal: 'vape', matched: 'vape' },
      { dryRun: false, seenSubs: new Set() },
    );
    expect(out.blocked).toBe(true);
    expect(out.disposition).toBe('blocked');
    expect(out.subreddit).toBe('newsub');
    expect(addMock).toHaveBeenCalledTimes(1);
    expect(addMock).toHaveBeenCalledWith('newsub', 'auto-content:vape', 'companion:auto-screen');
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(out.notice).toContain('r/newsub');
    expect(out.notice).toContain('dashboard');
  });

  it('blocks a dojo hit with the dojo reason', async () => {
    const out = await handleAutoBlockReport(
      { subreddit: 'r/DojoFans', signal: 'dojo', matched: 'dojo' },
      { dryRun: false, seenSubs: new Set() },
    );
    expect(out.blocked).toBe(true);
    expect(out.disposition).toBe('blocked');
    expect(out.subreddit).toBe('dojofans');
    expect(addMock).toHaveBeenCalledWith('dojofans', 'auto-content:dojo', 'companion:auto-screen');
    expect(out.notice).toContain('r/dojofans');
  });

  it('blocks a place hit with the place reason (pre-blast name screen)', async () => {
    const out = await handleAutoBlockReport(
      { subreddit: 'r/Dallas', signal: 'place', matched: 'dallas' },
      { dryRun: false, seenSubs: new Set() },
    );
    expect(out.blocked).toBe(true);
    expect(out.disposition).toBe('blocked');
    expect(addMock).toHaveBeenCalledWith('dallas', 'auto-content:place', 'companion:auto-screen');
  });

  it('blocks a crypto hit with the crypto reason', async () => {
    const out = await handleAutoBlockReport(
      { subreddit: 'r/Bitcoin', signal: 'crypto', matched: 'bitcoin' },
      { dryRun: false, seenSubs: new Set() },
    );
    expect(out.blocked).toBe(true);
    expect(out.disposition).toBe('blocked');
    expect(addMock).toHaveBeenCalledWith('bitcoin', 'auto-content:crypto', 'companion:auto-screen');
  });

  it('skips when already blocked (two-tab race: loser stays quiet)', async () => {
    blockedMock.mockResolvedValue(true);
    const out = await handleAutoBlockReport(
      { subreddit: 'newsub', signal: 'sex' },
      { dryRun: false, seenSubs: new Set() },
    );
    expect(out.blocked).toBe(false);
    expect(out.disposition).toBe('already-blocked');
    expect(out.notice).toBeNull();
    expect(addMock).not.toHaveBeenCalled();
    expect(out.outcome).toContain('already blocked');
  });

  it('skips subs seen in a prior scan (never overrides the digest review)', async () => {
    const out = await handleAutoBlockReport(
      { subreddit: 'oldsub', signal: 'non-en' },
      { dryRun: false, seenSubs: new Set(['oldsub']) },
    );
    expect(out.blocked).toBe(false);
    expect(out.disposition).toBe('seen-skipped');
    expect(addMock).not.toHaveBeenCalled();
    expect(out.outcome).toContain('prior scan');
  });

  it('ignores unreadable subreddits and unknown signals', async () => {
    expect(
      (await handleAutoBlockReport({ subreddit: '   ', signal: 'vape' }, { dryRun: false })).blocked,
    ).toBe(false);
    expect(
      (
        await handleAutoBlockReport(
          { subreddit: 'x', signal: 'other' as never },
          { dryRun: false },
        )
      ).blocked,
    ).toBe(false);
    expect(addMock).not.toHaveBeenCalled();
  });
});

describe('handleAutoBlockReport (dry-run / shadow mode)', () => {
  it('logs WOULD_BLOCK without calling addBlocked or auditing', async () => {
    const out = await handleAutoBlockReport(
      { subreddit: 'newsub', signal: 'sex', matched: 'escort' },
      { dryRun: true, seenSubs: new Set() },
    );
    expect(out.blocked).toBe(false);
    expect(out.disposition).toBe('dry-run');
    expect(out.outcome).toContain('WOULD_BLOCK');
    expect(out.outcome).toContain('auto-content:sex');
    expect(addMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
    expect(out.notice).toBeNull();
  });

  it('dry-run still skips already-blocked subs loudly', async () => {
    blockedMock.mockResolvedValue(true);
    const out = await handleAutoBlockReport(
      { subreddit: 'newsub', signal: 'vape' },
      { dryRun: true, seenSubs: new Set() },
    );
    expect(out.outcome).toContain('already blocked');
    expect(addMock).not.toHaveBeenCalled();
  });
});
