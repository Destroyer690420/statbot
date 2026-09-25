import { getDb } from '../db';

export class WorkerPortalAccessRepository {
  async findAll() {
    return getDb().workerPortalAccess.findMany({
      select: {
        channelId: true,
        workerId: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    });
  }

  async recordSuccessfulLogin(channelId: string, workerId: string, at: Date = new Date()) {
    return getDb().workerPortalAccess.upsert({
      where: { channelId },
      create: {
        channelId,
        workerId,
        firstSeenAt: at,
        lastSeenAt: at,
        updatedAt: at,
      },
      update: {
        workerId,
        lastSeenAt: at,
        updatedAt: at,
      },
    });
  }
}

export const workerPortalAccessRepository = new WorkerPortalAccessRepository();
