/**
 * Availability Yes/No buttons.
 *
 * The whole point of the feature: an explicit decision replaces "any message
 * claims a post". Custom ids carry the blast id and must parse strictly, so a
 * lookalike id can never be routed into this flow.
 */
import {
  AVAILABILITY_BUTTON_PREFIX,
  availabilityComponents,
  availabilityTextNudge,
  buildAvailabilityCustomId,
  parseAvailabilityCustomId,
  pickTicketWorkerId,
} from '../utils/outreach-availability';

describe('custom id round-trip', () => {
  it('builds a yes id and parses it back', () => {
    const id = buildAvailabilityCustomId('blast-123', 'yes');
    expect(id).toBe('outreach_avail:blast-123:yes');
    expect(parseAvailabilityCustomId(id)).toEqual({ blastId: 'blast-123', action: 'yes' });
  });

  it('builds a no id and parses it back', () => {
    const id = buildAvailabilityCustomId('clx0abc', 'no');
    expect(parseAvailabilityCustomId(id)).toEqual({ blastId: 'clx0abc', action: 'no' });
  });

  it('keeps a blast id that itself contains a prefix-like segment', () => {
    const id = buildAvailabilityCustomId('burst-2026-11-14T10-10-ab12', 'yes');
    expect(parseAvailabilityCustomId(id)).toEqual({
      blastId: 'burst-2026-11-14T10-10-ab12',
      action: 'yes',
    });
  });
});

describe('parse rejects everything else', () => {
  it.each([
    ['empty', ''],
    ['foreign prefix', 'outreach_add:123'],
    ['blast DM button', 'blast:go:cycle-1'],
    ['prefixed lookalike', 'outreach_availability:blast:yes'],
    ['missing action', 'outreach_avail:blast-1'],
    ['unknown action', 'outreach_avail:blast-1:maybe'],
    ['empty blast id', 'outreach_avail::yes'],
  ])('%s', (_label, customId) => {
    expect(parseAvailabilityCustomId(customId)).toBeNull();
  });
});

describe('components', () => {
  it('renders one row with a green Yes and a secondary No for this blast', () => {
    const rows = availabilityComponents('blast-9');
    expect(rows).toHaveLength(1);
    const json = rows[0].toJSON();
    expect(json.components).toHaveLength(2);
    expect(json.components[0]).toMatchObject({
      type: 2,
      style: 3,
      label: 'Yes',
      custom_id: `${AVAILABILITY_BUTTON_PREFIX}:blast-9:yes`,
    });
    expect(json.components[1]).toMatchObject({
      type: 2,
      style: 2,
      label: 'No',
      custom_id: `${AVAILABILITY_BUTTON_PREFIX}:blast-9:no`,
    });
  });
});

describe('text nudge', () => {
  it('tags the worker and names the button instead of promising a reply claim', () => {
    const text = availabilityTextNudge('w1');
    expect(text).toContain('<@w1>');
    expect(text).toContain('Yes');
    expect(text).toMatch(/does not reserve/i);
  });
});

describe('pickTicketWorkerId', () => {
  it('picks the first member who is neither a bot nor staff', () => {
    expect(
      pickTicketWorkerId(
        [
          { id: 'bot1', isBot: true },
          { id: 'admin1', isBot: false },
          { id: 'worker1', isBot: false },
          { id: 'worker2', isBot: false },
        ],
        ['admin1'],
      ),
    ).toBe('worker1');
  });

  it('returns null when the ticket has no worker', () => {
    expect(pickTicketWorkerId([{ id: 'bot1', isBot: true }], [])).toBeNull();
    expect(pickTicketWorkerId([], [])).toBeNull();
  });
});
