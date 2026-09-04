import { getIstDayBoundaries, isStaleDailyCycle } from '../utils/ist-time';
import { buildOutreachRows, formatOutreachMessage, OutreachRowInput } from '../utils/outreach-rows';

describe('getIstDayBoundaries', () => {
  it('returns the IST day key for a UTC instant', () => {
    const { dayKey } = getIstDayBoundaries(new Date('2026-08-18T00:00:00.000Z'));
    expect(dayKey).toBe('2026-08-18');
  });

  it('shifts the boundary: 18:29:59Z is still the previous IST day', () => {
    const { dayKey, dayStart } = getIstDayBoundaries(new Date('2026-08-17T18:29:59.999Z'));
    expect(dayKey).toBe('2026-08-17');
    expect(dayStart.toISOString()).toBe('2026-08-16T18:30:00.000Z');
  });

  it('rolls over at 00:00 IST (18:30Z previous day)', () => {
    const { dayKey, dayStart, dayEnd } = getIstDayBoundaries(new Date('2026-08-17T18:30:00.000Z'));
    expect(dayKey).toBe('2026-08-18');
    expect(dayStart.toISOString()).toBe('2026-08-17T18:30:00.000Z');
    expect(dayEnd.toISOString()).toBe('2026-08-18T18:29:59.999Z');
  });

  it('handles midday IST instants', () => {
    const { dayKey, dayStart } = getIstDayBoundaries(new Date('2026-08-18T06:00:00.000Z'));
    expect(dayKey).toBe('2026-08-18');
    expect(dayStart.toISOString()).toBe('2026-08-17T18:30:00.000Z');
  });
});

describe('isStaleDailyCycle', () => {
  const dayStart = new Date('2026-08-17T18:30:00.000Z');

  it('returns false when no message was sent', () => {
    expect(isStaleDailyCycle(null, dayStart)).toBe(false);
  });

  it('returns true when the message was sent before today started', () => {
    expect(isStaleDailyCycle(new Date('2026-08-17T18:29:59.999Z'), dayStart)).toBe(true);
  });

  it('returns false when the message was sent within today', () => {
    expect(isStaleDailyCycle(new Date('2026-08-17T18:30:00.000Z'), dayStart)).toBe(false);
  });
});

describe('buildOutreachRows', () => {
  const base: OutreachRowInput = {
    channelId: 'c1',
    channelName: 'ticket-0001',
    guildId: 'g1',
    taskStatus: 'idle',
    workerName: 'Worker A',
    selected: true,
    messageSentAt: '2026-08-17T19:00:00.000Z',
    availableAt: null,
    tasksToday: [],
  };

  it('marks available only when the worker replied after the message was sent', () => {
    const rows = buildOutreachRows([
      { ...base, availableAt: '2026-08-17T19:30:00.000Z' },
      { ...base, channelId: 'c2', channelName: 'ticket-0002', availableAt: null },
    ]);
    expect(rows[0].available).toBe(true);
    expect(rows[1].available).toBe(false);
  });

  it('derives Post/Comment counts from today\'s tasks in the channel', () => {
    const tasksToday = [
      { channelId: 'c1', type: 'POST' },
      { channelId: 'c1', type: 'COMMENT' },
      { channelId: 'c2', type: 'POST' },
    ];
    const rows = buildOutreachRows([
      { ...base, tasksToday },
      { ...base, channelId: 'c2', channelName: 'ticket-0002', tasksToday },
      { ...base, channelId: 'c3', channelName: 'ticket-0003', tasksToday },
    ]);
    const c1 = rows.find((r) => r.channelId === 'c1')!;
    const c2 = rows.find((r) => r.channelId === 'c2')!;
    const c3 = rows.find((r) => r.channelId === 'c3')!;
    expect(c1.post).toBe(1);
    expect(c1.comment).toBe(1);
    expect(c2.post).toBe(1);
    expect(c2.comment).toBe(0);
    expect(c3.post).toBe(0);
    expect(c3.comment).toBe(0);
  });

  it('counts multiple posts and comments per channel', () => {
    const tasksToday = [
      { channelId: 'c1', type: 'POST' },
      { channelId: 'c1', type: 'POST' },
      { channelId: 'c1', type: 'COMMENT' },
      { channelId: 'c1', type: 'COMMENT' },
      { channelId: 'c1', type: 'COMMENT' },
    ];
    const rows = buildOutreachRows([{ ...base, tasksToday }]);
    expect(rows[0].post).toBe(2);
    expect(rows[0].comment).toBe(3);
  });

  it('does not count tasks from other channels', () => {
    const rows = buildOutreachRows([
      {
        ...base,
        tasksToday: [{ channelId: 'other', type: 'POST' }],
      },
    ]);
    expect(rows[0].post).toBe(0);
    expect(rows[0].comment).toBe(0);
  });

  it('sorts rows by channel name', () => {
    const rows = buildOutreachRows([
      { ...base, channelId: 'c2', channelName: 'ticket-0002' },
      { ...base, channelId: 'c1', channelName: 'ticket-0001' },
      { ...base, channelId: 'c3', channelName: 'ticket-0003' },
    ]);
    expect(rows.map((r) => r.channelName)).toEqual(['ticket-0001', 'ticket-0002', 'ticket-0003']);
  });

  it('preserves selection and worker name', () => {
    const rows = buildOutreachRows([
      { ...base, selected: true, workerName: 'Worker A' },
      { ...base, channelId: 'c2', channelName: 'ticket-0002', selected: false, workerName: null },
    ]);
    expect(rows[0].selected).toBe(true);
    expect(rows[0].workerName).toBe('Worker A');
    expect(rows[1].selected).toBe(false);
    expect(rows[1].workerName).toBeNull();
  });

  it('serializes messageSentAt when present', () => {
    const rows = buildOutreachRows([base]);
    expect(rows[0].messageSentAt).toBe('2026-08-17T19:00:00.000Z');
  });
});

describe('formatOutreachMessage', () => {
  it('replaces the {user} placeholder with the worker mention', () => {
    expect(formatOutreachMessage('Hey {user}, got work for you', '123')).toBe(
      'Hey <@123>, got work for you',
    );
  });

  it('replaces every occurrence of the placeholder', () => {
    expect(formatOutreachMessage('{user} hi {user}', '123')).toBe('<@123> hi <@123>');
  });

  it('prepends the mention when the message has no placeholder', () => {
    expect(formatOutreachMessage('Hey, got work for you', '123')).toBe(
      '<@123> Hey, got work for you',
    );
  });

  it('returns the message unchanged when the worker is unknown', () => {
    expect(formatOutreachMessage('Hey {user}, got work for you', null)).toBe(
      'Hey {user}, got work for you',
    );
  });

  it('returns an empty message unchanged when the worker is unknown', () => {
    expect(formatOutreachMessage('', null)).toBe('');
  });
});