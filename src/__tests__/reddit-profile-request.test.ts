import {
  buildProfileRequestPlan,
  countSkippedByReason,
  formatProfileRequestMessage,
  ProfileRequestOutcome,
  summarizeProfileRequest,
  TICKET_NAME_PREFIX,
  TicketWorkerCandidate,
} from '../utils/reddit-profile-request';

function candidate(channelName: string, workerIds: string[]): TicketWorkerCandidate {
  return { channelId: `chan-${channelName}`, channelName, workerIds };
}

describe('reddit profile request sweep', () => {
  describe('buildProfileRequestPlan', () => {
    it('targets one ticket per single-worker ticket channel', () => {
      const plan = buildProfileRequestPlan(
        [
          candidate('ticket-0001', ['worker-a']),
          candidate('ticket-0002', ['worker-b']),
          candidate('ticket-0003', ['worker-c']),
        ],
        [],
      );

      expect(plan.targets).toEqual([
        { channelId: 'chan-ticket-0001', channelName: 'ticket-0001', workerId: 'worker-a' },
        { channelId: 'chan-ticket-0002', channelName: 'ticket-0002', workerId: 'worker-b' },
        { channelId: 'chan-ticket-0003', channelName: 'ticket-0003', workerId: 'worker-c' },
      ]);
      expect(plan.skipped).toEqual([]);
    });

    it('never re-asks a ticket that was already asked (the one-time guarantee)', () => {
      const plan = buildProfileRequestPlan(
        [candidate('ticket-0001', ['worker-a']), candidate('ticket-0002', ['worker-b'])],
        ['chan-ticket-0001'],
      );

      expect(plan.targets.map((t) => t.channelId)).toEqual(['chan-ticket-0002']);
      expect(plan.skipped).toEqual([
        { channelId: 'chan-ticket-0001', channelName: 'ticket-0001', reason: 'already asked' },
      ]);
    });

    it('re-asks already-asked tickets only when forced', () => {
      const plan = buildProfileRequestPlan([candidate('ticket-0001', ['worker-a'])], ['chan-ticket-0001'], {
        force: true,
      });

      expect(plan.targets).toHaveLength(1);
      expect(plan.skipped).toEqual([]);
    });

    it('skips channels that are not tickets, by name', () => {
      const plan = buildProfileRequestPlan(
        [candidate('general', ['worker-a']), candidate('invites', ['worker-b']), candidate('ticket-0001', ['worker-c'])],
        [],
      );

      expect(plan.targets.map((t) => t.channelName)).toEqual(['ticket-0001']);
      expect(plan.skipped.map((s) => s.reason)).toEqual(['not a ticket channel', 'not a ticket channel']);
    });

    it('includes non-ticket-named channels when the name requirement is dropped', () => {
      const plan = buildProfileRequestPlan([candidate('general', ['worker-a'])], [], { requireTicketName: false });

      expect(plan.targets).toHaveLength(1);
      expect(plan.skipped).toEqual([]);
    });

    it('skips a ticket with no resolvable worker instead of sending an untagged ask', () => {
      const plan = buildProfileRequestPlan([candidate('ticket-0001', [])], []);

      expect(plan.targets).toEqual([]);
      expect(plan.skipped).toEqual([
        { channelId: 'chan-ticket-0001', channelName: 'ticket-0001', reason: 'no worker in ticket' },
      ]);
    });

    it('skips an ambiguous ticket rather than tagging the wrong person', () => {
      const plan = buildProfileRequestPlan([candidate('ticket-0001', ['worker-a', 'worker-b'])], []);

      expect(plan.targets).toEqual([]);
      expect(plan.skipped).toEqual([
        { channelId: 'chan-ticket-0001', channelName: 'ticket-0001', reason: 'multiple workers in ticket' },
      ]);
    });

    it('restricts the run to an explicit --only list, by id or exact name', () => {
      const candidates = [
        candidate('ticket-0001', ['worker-a']),
        candidate('ticket-0002', ['worker-b']),
        candidate('ticket-0003', ['worker-c']),
      ];

      const plan = buildProfileRequestPlan(candidates, [], { only: ['chan-ticket-0002', 'ticket-0003'] });

      expect(plan.targets.map((t) => t.channelName)).toEqual(['ticket-0002', 'ticket-0003']);
      expect(plan.skipped).toEqual([
        { channelId: 'chan-ticket-0001', channelName: 'ticket-0001', reason: 'outside the requested filter' },
      ]);
    });

    it('an empty --only list means every ticket, not nothing', () => {
      const plan = buildProfileRequestPlan([candidate('ticket-0001', ['worker-a'])], [], { only: [] });

      expect(plan.targets).toHaveLength(1);
    });

    it('checks the ticket name before the one-time guard', () => {
      // Order is fixed in buildProfileRequestPlan: an already-asked
      // non-ticket channel reports the name mismatch, because that is the
      // reason nothing would be sent to it even on a forced re-run.
      const plan = buildProfileRequestPlan([candidate('general', ['worker-a'])], ['chan-general']);

      expect(plan.skipped).toEqual([
        { channelId: 'chan-general', channelName: 'general', reason: 'not a ticket channel' },
      ]);
    });

    it('preserves input order so the run report is deterministic', () => {
      const plan = buildProfileRequestPlan(
        [
          candidate('ticket-0009', ['worker-i']),
          candidate('ticket-0001', ['worker-a']),
          candidate('ticket-0005', ['worker-e']),
        ],
        [],
      );

      expect(plan.targets.map((t) => t.channelName)).toEqual(['ticket-0009', 'ticket-0001', 'ticket-0005']);
    });

    it('plans nothing for an empty guild view', () => {
      const plan = buildProfileRequestPlan([], []);

      expect(plan).toEqual({ targets: [], skipped: [] });
    });
  });

  describe('formatProfileRequestMessage', () => {
    it('tags the worker and asks for the profile link, not a username', () => {
      const message = formatProfileRequestMessage('123456789');

      expect(message).toContain('<@123456789>');
      expect(message).toContain('reddit profile link');
      expect(message).not.toContain('{user}');
    });

    it('states that the profile link is mandatory for anyone posting', () => {
      expect(formatProfileRequestMessage('123456789')).toMatch(/mandatory/i);
    });
  });

  describe('summarizeProfileRequest', () => {
    it('counts successes and failures without losing the error text', () => {
      const outcomes: ProfileRequestOutcome[] = [
        { channelId: 'chan-1', channelName: 'ticket-0001', workerId: 'w1', ok: true },
        { channelId: 'chan-2', channelName: 'ticket-0002', workerId: 'w2', ok: false, error: 'Missing Access' },
        { channelId: 'chan-3', channelName: 'ticket-0003', workerId: 'w3', ok: true },
      ];

      expect(summarizeProfileRequest(outcomes)).toEqual({ sent: 2, failed: 1, unstamped: 0 });
    });

    it('separates delivered-but-unrecorded from safe-to-retry failures', () => {
      // The only state in which a plain re-run messages a worker twice, so it
      // must never be hidden inside `failed` (which means "nothing delivered").
      const outcomes: ProfileRequestOutcome[] = [
        { channelId: 'chan-1', channelName: 'ticket-0001', workerId: 'w1', ok: true, unstamped: true, error: 'db down' },
        { channelId: 'chan-2', channelName: 'ticket-0002', workerId: 'w2', ok: false, error: 'Missing Access' },
      ];

      expect(summarizeProfileRequest(outcomes)).toEqual({ sent: 1, failed: 1, unstamped: 1 });
    });
  });

  describe('countSkippedByReason', () => {
    it('groups skip reasons so a partial run is diagnosable', () => {
      const plan = buildProfileRequestPlan(
        [
          candidate('ticket-0001', ['worker-a']),
          candidate('ticket-0002', []),
          candidate('ticket-0003', []),
          candidate('general', ['worker-d']),
        ],
        ['chan-ticket-0001'],
      );

      expect(countSkippedByReason(plan.skipped)).toEqual({
        'already asked': 1,
        'no worker in ticket': 2,
        'not a ticket channel': 1,
      });
    });
  });

  it('keeps the ticket prefix in sync with the live channel names', () => {
    // Every live ticket is `ticket-####`; if the naming ever changes this test
    // is the reminder that the sweep default needs revisiting.
    expect('ticket-0053'.startsWith(TICKET_NAME_PREFIX)).toBe(true);
  });
});
