import { getDb } from '../db';

export class AuditRepository {
  async create(data: {
    id: string;
    action: string;
    taskId: string | null;
    userId: string | null;
    details: string | null;
    createdAt: Date;
  }) {
    return getDb().auditLog.create({ data: data as any });
  }

  async findByTaskId(taskId: string, limit = 20) {
    return getDb().auditLog.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async findRecent(limit = 50) {
    return getDb().auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

export const auditRepository = new AuditRepository();
