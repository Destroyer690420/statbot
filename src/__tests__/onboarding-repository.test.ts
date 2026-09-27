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
