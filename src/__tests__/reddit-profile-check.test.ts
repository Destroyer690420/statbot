import {
  asProfileCheckStatus,
  evaluateKarma,
  extractProfileUsername,
  formatApprovalDm,
  formatBannedDmMessage,
  formatLowKarmaMessage,
  formatReaskMessage,
  formatUnverifiableMessage,
  formatVerifiedMessage,
  isTerminalProfileStatus,
  totalKarma,
} from '../utils/reddit-profile-link';
import { REDDIT_PROFILE_APPROVAL_ADMIN_ID, REDDIT_PROFILE_INFO_CHANNEL_ID, REDDIT_PROFILE_MIN_KARMA } from '../config/constants';

describe('extractProfileUsername', () => {
  it('reads a canonical profile URL', () => {
    expect(extractProfileUsername('https://www.reddit.com/user/some_worker')).toBe('some_worker');
  });

  it('accepts every host variant, the /u/ short form, and a missing scheme', () => {
    expect(extractProfileUsername('https://old.reddit.com/user/some_worker/')).toBe('some_worker');
    expect(extractProfileUsername('reddit.com/u/some_worker')).toBe('some_worker');
    expect(extractProfileUsername('https://new.reddit.com/user/some_worker')).toBe('some_worker');
  });

  it('strips query strings, fragments and trailing punctuation', () => {
    expect(extractProfileUsername('https://www.reddit.com/user/some_worker/?utm=x#top')).toBe('some_worker');
    expect(extractProfileUsername('my profile: https://www.reddit.com/user/some_worker.')).toBe('some_worker');
    expect(extractProfileUsername('(https://www.reddit.com/user/some_worker)')).toBe('some_worker');
  });

  it('lowercases so the same account cannot be stored two ways', () => {
    expect(extractProfileUsername('https://www.reddit.com/user/Some_Worker')).toBe('some_worker');
  });

  it('accepts a bare u/name pasted without a domain', () => {
    expect(extractProfileUsername('u/some_worker')).toBe('some_worker');
    expect(extractProfileUsername('here it is u/some_worker thanks')).toBe('some_worker');
  });

  it('rejects a POST link so a submission is never mistaken for a profile', () => {
    expect(extractProfileUsername('https://www.reddit.com/r/SomeSub/comments/abc123/title/')).toBeNull();
  });

  it('rejects a subreddit link', () => {
    expect(extractProfileUsername('https://www.reddit.com/r/SomeSub/')).toBeNull();
  });

  it('rejects plain chat, which is the whole point of the re-ask', () => {
    expect(extractProfileUsername('hi')).toBeNull();
    expect(extractProfileUsername('ok thanks')).toBeNull();
    expect(extractProfileUsername('done')).toBeNull();
    expect(extractProfileUsername('')).toBeNull();
  });

  it('rejects a bare word so "ok" cannot be checked as an account', () => {
    expect(extractProfileUsername('my username is bob')).toBeNull();
  });

  it('rejects a non-Reddit link', () => {
    expect(extractProfileUsername('https://instagram.com/some_worker')).toBeNull();
    expect(extractProfileUsername('https://reddit.com.evil.example/user/some_worker')).toBeNull();
  });

  it('rejects an ambiguous message naming two profiles rather than guessing', () => {
    expect(
      extractProfileUsername('mine is https://www.reddit.com/user/alpha and his is https://www.reddit.com/user/beta'),
    ).toBeNull();
  });

  it('accepts the same profile mentioned twice', () => {
    expect(
      extractProfileUsername('https://www.reddit.com/user/some_worker and again www.reddit.com/u/some_worker'),
    ).toBe('some_worker');
  });

  it('rejects a username that is too short to be real', () => {
    expect(extractProfileUsername('https://www.reddit.com/user/ab')).toBeNull();
  });
});

describe('totalKarma / evaluateKarma', () => {
  it('adds link and comment karma only', () => {
    expect(totalKarma({ linkKarma: 20, commentKarma: 30 })).toBe(50);
  });

  it('coerces junk and negatives to zero instead of producing NaN', () => {
    expect(totalKarma({ linkKarma: Number.NaN, commentKarma: -5 })).toBe(0);
    expect(totalKarma({ linkKarma: undefined as unknown as number, commentKarma: 10 })).toBe(10);
  });

  it('passes at exactly the threshold', () => {
    expect(evaluateKarma({ username: 'a', linkKarma: 25, commentKarma: 25 }).passes).toBe(true);
    expect(evaluateKarma({ username: 'a', linkKarma: 25, commentKarma: 25 }).status).toBe('PASSED');
  });

  it('fails one karma short of the threshold', () => {
    const verdict = evaluateKarma({ username: 'a', linkKarma: 49, commentKarma: 0 });
    expect(verdict.passes).toBe(false);
    expect(verdict.status).toBe('LOW_KARMA');
  });

  it('honours a custom threshold so the rule stays in one place', () => {
    expect(evaluateKarma({ username: 'a', linkKarma: 10, commentKarma: 0 }, 5).passes).toBe(true);
    expect(evaluateKarma({ username: 'a', linkKarma: 10, commentKarma: 0 }, 50).passes).toBe(false);
  });

  it('uses the configured threshold of 50 by default', () => {
    expect(REDDIT_PROFILE_MIN_KARMA).toBe(50);
  });
});

describe('status narrowing', () => {
  it('treats PASSED and BANNED as terminal', () => {
    expect(isTerminalProfileStatus('PASSED')).toBe(true);
    expect(isTerminalProfileStatus('BANNED')).toBe(true);
  });

  it('leaves the retryable states actionable so a worker can fix their karma', () => {
    expect(isTerminalProfileStatus('LOW_KARMA')).toBe(false);
    expect(isTerminalProfileStatus('UNVERIFIABLE')).toBe(false);
    expect(isTerminalProfileStatus('PENDING')).toBe(false);
  });

  it('narrows known statuses and rejects anything else', () => {
    expect(asProfileCheckStatus('LOW_KARMA')).toBe('LOW_KARMA');
    expect(asProfileCheckStatus('SOMETHING_ELSE')).toBeNull();
    expect(asProfileCheckStatus(null)).toBeNull();
    expect(asProfileCheckStatus(undefined)).toBeNull();
  });
});

describe('messages', () => {
  it('tags the worker in the re-ask', () => {
    expect(formatReaskMessage('123')).toContain('<@123>');
  });

  it('states the karma in the verified line', () => {
    expect(formatVerifiedMessage(120)).toContain('120');
  });

  it('tells a low-karma worker both the number and the bar, and links the info channel', () => {
    const msg = formatLowKarmaMessage(12);
    expect(msg).toContain('12');
    expect(msg).toContain(String(REDDIT_PROFILE_MIN_KARMA));
    expect(msg).toContain(`<#${REDDIT_PROFILE_INFO_CHANNEL_ID}>`);
  });

  it('does not tell an under-karma worker to create a new account', () => {
    // Regression guard: the message used to suggest a new account, which is
    // the banned-account remedy. A worker whose account works fine but has
    // 1 karma was being told to abandon it.
    const msg = formatLowKarmaMessage(1).toLowerCase();
    expect(msg).not.toContain('new account');
    expect(msg).not.toContain('create a new');
    expect(msg).toContain('increase the karma of your account');
    // ...and they can start from the same account.
    expect(msg).toContain('then you can start hiring');
  });

  it('tells a banned worker to make a new account and links the info channel', () => {
    const msg = formatBannedDmMessage();
    expect(msg.toLowerCase()).toContain('banned');
    expect(msg).toContain('new account');
    expect(msg).toContain(`<#${REDDIT_PROFILE_INFO_CHANNEL_ID}>`);
  });

  it('never embeds a user mention in a worker-facing DM body', () => {
    // The banned/low-karma bodies are read by the worker themselves; a
    // self-mention or anyone else's is noise. The channel mention (<#...>)
    // is intentional and stays.
    expect(formatBannedDmMessage()).not.toMatch(/<@\d+>/);
    expect(formatLowKarmaMessage(3)).not.toMatch(/<@\d+>/);
  });

  it('gives the approver the ticket name and a usable mention', () => {
    const dm = formatApprovalDm({ channelName: 'ticket-0424', workerId: '555', username: 'some_worker', karma: 300 });
    expect(dm).toContain('ticket-0424');
    expect(dm).toContain('<@555>');
    expect(dm).toContain('u/some_worker');
    expect(dm).toContain('300');
    expect(dm.toLowerCase()).toContain('daily outreach');
  });

  it('surfaces the reason in the retryable in-ticket nudge', () => {
    expect(formatUnverifiableMessage('reddit is rate limiting me')).toContain('rate limiting');
  });

  it('uses the configured approver id', () => {
    expect(REDDIT_PROFILE_APPROVAL_ADMIN_ID).toMatch(/^\d{17,20}$/);
  });
});
