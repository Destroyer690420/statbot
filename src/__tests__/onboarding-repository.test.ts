let mockDb: any = null;
jest.mock('../database/db', () => ({
  getDb: () => {
    if (!mockDb) throw new Error('mock db not set');
    return mockDb;
  },
}));

import { onboardingRepository } from '../database/repositories/onboarding.repository';

describe('OnboardingRepository reddit profile request', () => {
  const mockFindMany = jest.fn();
  const mockUpsert = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = {
      ticketOnboarding: {
        findMany: mockFindMany,
        upsert: mockUpsert,
      },
    };
  });

  it('stamps the request without touching the welcome or guide columns', async () => {
    const at = new Date('2026-09-27T10:00:00.000Z');
    mockUpsert.mockResolvedValue({ channelId: 'chan-1' });

    await onboardingRepository.markRedditProfileRequested('chan-1', at);

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { channelId: 'chan-1' },
      create: { channelId: 'chan-1', redditProfileRequestedAt: at, updatedAt: at },
      update: { redditProfileRequestedAt: at, updatedAt: at },
    });
  });

  it('reads the already-asked channels in one projected query', async () => {
    mockFindMany.mockResolvedValue([{ channelId: 'chan-1' }, { channelId: 'chan-2' }]);

    await expect(onboardingRepository.findRedditProfileRequestedChannelIds()).resolves.toEqual([
      'chan-1',
      'chan-2',
    ]);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { redditProfileRequestedAt: { not: null } },
      select: { channelId: true },
    });
  });

  it('returns an empty list when nothing has been asked yet', async () => {
    mockFindMany.mockResolvedValue([]);

    await expect(onboardingRepository.findRedditProfileRequestedChannelIds()).resolves.toEqual([]);
  });
});

describe('OnboardingRepository profile check', () => {
  const mockFindMany = jest.fn();
  const mockFindUnique = jest.fn();
  const mockUpsert = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = {
      ticketOnboarding: { findMany: mockFindMany, findUnique: mockFindUnique, upsert: mockUpsert },
    };
  });

  it('enrolls a new ticket as PENDING alongside the welcome', async () => {
    const at = new Date('2026-09-28T10:00:00.000Z');
    mockUpsert.mockResolvedValue({});

    await onboardingRepository.enrollProfileCheck('chan-1', at);

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { channelId: 'chan-1' },
      create: { channelId: 'chan-1', welcomeSentAt: at, profileCheckStatus: 'PENDING', updatedAt: at },
      update: { welcomeSentAt: at, profileCheckStatus: 'PENDING', updatedAt: at },
    });
  });

  it('stores a verdict without disturbing the welcome, guide or sweep columns', async () => {
    const at = new Date('2026-09-28T10:05:00.000Z');
    mockUpsert.mockResolvedValue({});

    await onboardingRepository.markProfileChecked(
      'chan-1',
      { status: 'PASSED', username: 'some_worker', linkKarma: 30, commentKarma: 40 },
      at,
    );

    const call = mockUpsert.mock.calls[0][0];
    // A re-check must never reset guideSentAt, or the guide would be re-sent.
    expect(call.update).toEqual({
      profileCheckStatus: 'PASSED',
      profileUsername: 'some_worker',
      profileLinkKarma: 30,
      profileCommentKarma: 40,
      profileCheckedAt: at,
      updatedAt: at,
    });
    expect(call.update.guideSentAt).toBeUndefined();
    expect(call.update.welcomeSentAt).toBeUndefined();
    expect(call.update.redditProfileRequestedAt).toBeUndefined();
  });

  it('stores a null karma for a verdict that has no karma (banned)', async () => {
    const at = new Date('2026-09-28T10:05:00.000Z');
    mockUpsert.mockResolvedValue({});

    await onboardingRepository.markProfileChecked(
      'chan-1',
      { status: 'BANNED', username: 'some_worker', linkKarma: null, commentKarma: null },
      at,
    );

    const call = mockUpsert.mock.calls[0][0];
    expect(call.update.profileLinkKarma).toBeNull();
    expect(call.update.profileCommentKarma).toBeNull();
  });

  it('increments the re-ask count from the stored value', async () => {
    mockFindUnique.mockResolvedValue({ profileReaskCount: 2 });
    mockUpsert.mockResolvedValue({});

    await onboardingRepository.incrementProfileReask('chan-1', new Date('2026-09-28T10:00:00.000Z'));

    expect(mockUpsert.mock.calls[0][0].update.profileReaskCount).toBe(3);
  });

  it('treats a missing row as zero re-asks so the first nudge is never skipped', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({});

    await onboardingRepository.incrementProfileReask('chan-1');

    expect(mockUpsert.mock.calls[0][0].update.profileReaskCount).toBe(1);
  });
});
