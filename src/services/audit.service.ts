import { AuditAction, AuditLog } from '../types';
import { auditRepository } from '../database/repositories';
import { generateLogId } from '../utils/id-generator';
import { logger } from '../utils/logger';
import { toAuditLog } from '../database/converters';

class AuditLogService {
  async log(
    action: AuditAction,
    taskId: string | null,
    userId: string | null,
    details: string | null = null,
  ): Promise<void> {
    try {
      const entry: AuditLog = {
        id: generateLogId(),
        action,
        taskId,
        userId,
        details,
        createdAt: new Date(),
      };

      await auditRepository.create({
        id: entry.id,
        action: entry.action,
        taskId: entry.taskId,
        userId: entry.userId,
        details: entry.details,
        createdAt: entry.createdAt,
      });

      logger.debug('Audit log created', { action, taskId });
    } catch (error) {
      logger.error('Failed to create audit log', { error, action, taskId });
    }
  }

  async getByTaskId(taskId: string, limit = 20): Promise<AuditLog[]> {
    const logs = await auditRepository.findByTaskId(taskId, limit);
    return logs.map(toAuditLog);
  }

  async getRecent(limit = 50): Promise<AuditLog[]> {
    const logs = await auditRepository.findRecent(limit);
    return logs.map(toAuditLog);
  }
}

export const auditLogService = new AuditLogService();
