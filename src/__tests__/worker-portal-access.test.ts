let mockDb: any = null;
jest.mock('../database/db', () => ({
  getDb: () => {
    if (!mockDb) throw new Error('mock db not set');
    return mockDb;
  },
}));

import { workerPortalAccessRepository } from '../database/repositories/worker-portal-access.repository';

describe('WorkerPortalAccessRepository', () => {
  const mockFindMany = jest.fn();
  const mockUpsert = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = {
      workerPortalAccess: {
        findMany: mockFindMany,
        upsert: mockUpsert,
      },
    };
  });

  it('records a first login with both access timestamps', async () => {
    const at = new Date('2026-09-25T10:00:00.000Z');
    mockUpsert.mockResolvedValue({ channelId: 'chan-1' });

    await workerPortalAccessRepository.recordSuccessfulLogin('chan-1', 'worker-1', at);

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { channelId: 'chan-1' },
      create: {
        channelId: 'chan-1',
        workerId: 'worker-1',
        firstSeenAt: at,
        lastSeenAt: at,
        updatedAt: at,
      },
      update: {
        workerId: 'worker-1',
        lastSeenAt: at,
        updatedAt: at,
      },
    });
  });

  it('reads only the fields needed by the admin outreach page', async () => {
    mockFindMany.mockResolvedValue([]);
    await workerPortalAccessRepository.findAll();
    expect(mockFindMany).toHaveBeenCalledWith({
      select: {
        channelId: true,
        workerId: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    });
  });
});
