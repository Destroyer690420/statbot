/**
 * Daily ban-scan eligibility + messages. Pure helpers only — importing the
 * scan service would pull env/DB (see TESTING.md §1), so the timing plan has
 * its own suite and the service sweep is covered by mocks in
 * `outreach-ban-scan.test.ts`.
 */
import {
  evaluateProfileEligibility,
  formatBanRemovalDmMessage,
  formatBanRemovalTicketMessage,
  formatBanScanSummary,
  formatBannedDmMessage,
  formatMissingProfileAskMessage,
  formatTooYoungMessage,
  getAccountAgeDays,
  isAccountOldEnough,
  isTerminalProfileStatus,
} from '../utils/reddit-profile-link';
import {
  OUTREACH_BAN_SCAN_HOUR_IST,
  REDDIT_PROFILE_MIN_AGE_DAYS,
  REDDIT_PROFILE_MIN_KARMA,
} from '../config/constants';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 13, 1, 30, 0); // 07:00 IST Oct 13
const utcDaysAgo = (days: number): number => Math.floor((NOW - days * DAY_MS) / 1000);

describe('ban-scan constants', () => {
  it('fires at 7am IST with the 14-day / 50-karma bars', () => {
    expect(OUTREACH_BAN_SCAN_HOUR_IST).toBe(7);
    expect(REDDIT_PROFILE_MIN_AGE_DAYS).toBe(14);
    expect(REDDIT_PROFILE_MIN_KARMA).toBe(50);
  });
});

describe('getAccountAgeDays / isAccountOldEnough', () => {
  it('counts whole days from created_utc', () => {
    expect(getAccountAgeDays(utcDaysAgo(20), NOW)).toBe(20);
    expect(getAccountAgeDays(utcDaysAgo(14), NOW)).toBe(14);
    expect(getAccountAgeDays(utcDaysAgo(0), NOW)).toBe(0);
  });

  it('floors partial days instead of rounding up', () => {
    // 13.9 days old is still 13 — a 14-day gate must not pass it.
    const created = Math.floor((NOW - 13.9 * DAY_MS) / 1000);
    expect(getAccountAgeDays(created, NOW)).toBe(13);
    expect(isAccountOldEnough(created, NOW)).toBe(false);
  });

  it('passes at exactly 14 days', () => {
    expect(isAccountOldEnough(utcDaysAgo(14), NOW)).toBe(true);
  });

  it('treats a missing created_utc as passing (karma alone decides)', () => {
    expect(getAccountAgeDays(null, NOW)).toBeNull();
    expect(getAccountAgeDays(undefined, NOW)).toBeNull();
    expect(isAccountOldEnough(null, NOW)).toBe(true);
    expect(isAccountOldEnough(undefined, NOW)).toBe(true);
  });

  it('treats garbage/future timestamps as unknown, never as a ban', () => {
    expect(getAccountAgeDays(Number.NaN, NOW)).toBeNull();
    expect(getAccountAgeDays(-5, NOW)).toBeNull();
    expect(isAccountOldEnough(Number.NaN, NOW)).toBe(true);
  });
});

describe('evaluateProfileEligibility', () => {
  it('passes a 20-day 70-karma account', () => {
    const r = evaluateProfileEligibility(
      { username: 'w', linkKarma: 30, commentKarma: 40, createdUtc: utcDaysAgo(20) },
      NOW,
    );
    expect(r.passes).toBe(true);
    expect(r.reason).toBe('ok');
    expect(r.karma).toBe(70);
    expect(r.ageDays).toBe(20);
  });

  it('fails a young account with good karma as too_young', () => {
    const r = evaluateProfileEligibility(
      { username: 'w', linkKarma: 100, commentKarma: 100, createdUtc: utcDaysAgo(3) },
      NOW,
    );
    expect(r.passes).toBe(false);
    expect(r.reason).toBe('too_young');
  });

  it('fails an old low-karma account as low_karma', () => {
    const r = evaluateProfileEligibility(
      { username: 'w', linkKarma: 5, commentKarma: 7, createdUtc: utcDaysAgo(100) },
      NOW,
    );
    expect(r.passes).toBe(false);
    expect(r.reason).toBe('low_karma');
  });

  it('names both bars when both miss', () => {
    const r = evaluateProfileEligibility(
      { username: 'w', linkKarma: 1, commentKarma: 1, createdUtc: utcDaysAgo(2) },
      NOW,
    );
    expect(r.passes).toBe(false);
    expect(r.reason).toBe('too_young_and_low_karma');
  });

  it('passes when created_utc is missing and karma clears (old-row fallback)', () => {
    const r = evaluateProfileEligibility({ username: 'w', linkKarma: 30, commentKarma: 40 }, NOW);
    expect(r.passes).toBe(true);
    expect(r.reason).toBe('ok');
    expect(r.ageDays).toBeNull();
  });
});

describe('BANNED is re-checkable (daily scan re-entry)', () => {
  it('leaves only PASSED terminal so a banned worker sharing a new link is re-checked', () => {
    expect(isTerminalProfileStatus('PASSED')).toBe(true);
    expect(isTerminalProfileStatus('BANNED')).toBe(false);
    expect(isTerminalProfileStatus('LOW_KARMA')).toBe(false);
    expect(isTerminalProfileStatus('PENDING')).toBe(false);
    expect(isTerminalProfileStatus('UNVERIFIABLE')).toBe(false);
  });
});

describe('ban-scan messages', () => {
  it('banned DM states the replacement bars (14d + 50 karma) and the next step', () => {
    const msg = formatBannedDmMessage();
    expect(msg.toLowerCase()).toContain('banned');
    expect(msg).toContain('new account');
    expect(msg).toContain('14');
    expect(msg).toContain('50');
    expect(msg.toLowerCase()).toContain('share the new reddit profile link');
  });

  it('removal DM names the dead profile and the re-entry path', () => {
    const msg = formatBanRemovalDmMessage('some_worker');
    expect(msg).toContain('u/some_worker');
    expect(msg.toLowerCase()).toContain('removed from the daily outreach');
    expect(msg).toContain('14');
    expect(msg).toContain('50');
    expect(msg).not.toMatch(/<@\d+>/);
  });

  it('ticket line tags the owner and names the dead profile', () => {
    const msg = formatBanRemovalTicketMessage('1299323714101317715', 'some_worker');
    expect(msg).toContain('<@1299323714101317715>');
    expect(msg).toContain('u/some_worker');
    expect(msg.toLowerCase()).toContain('removed');
    expect(msg.toLowerCase()).toContain('daily outreach');
  });

  it('too-young line names the age bar, not just karma', () => {
    const msg = formatTooYoungMessage(200, 3);
    expect(msg).toContain('3');
    expect(msg).toContain('14');
    expect(msg).toContain('50');
    expect(msg).not.toMatch(/<@\d+>/);
  });

  it('missing-link ask tags the worker', () => {
    expect(formatMissingProfileAskMessage('111')).toContain('<@111>');
    expect(formatMissingProfileAskMessage('111').toLowerCase()).toContain('reddit profile link');
  });

  it('admin summary carries counts and the day', () => {
    const msg = formatBanScanSummary({
      dayKey: '2026-10-13',
      selectedTotal: 10,
      checked: 8,
      bannedCount: 2,
      missingAsked: 1,
      skipped: 1,
      sessionIssue: false,
    });
    expect(msg).toContain('2026-10-13');
    expect(msg).toContain('10');
    expect(msg).toContain('8');
    expect(msg).toContain('2');
  });

  it('admin summary warns on session issues', () => {
    const msg = formatBanScanSummary({
      dayKey: '2026-10-13',
      selectedTotal: 5,
      checked: 0,
      bannedCount: 0,
      missingAsked: 0,
      skipped: 5,
      sessionIssue: true,
    });
    expect(msg.toLowerCase()).toContain('session');
  });
});
