import { AuditAction, AuditLog, TaskType } from '../types';
import { auditRepository, taskRepository } from '../database/repositories';
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
    return this.enrich(logs.map(toAuditLog));
  }

  async getRecent(limit = 50): Promise<AuditLog[]> {
    const logs = await auditRepository.findRecent(limit);
    return this.enrich(logs.map(toAuditLog));
  }

  /**
   * Attaches the referenced task's external ID and type so user-facing
   * consumers can render a display ID instead of the internal one.
   */
  private async enrich(logs: AuditLog[]): Promise<AuditLog[]> {
    const enriched: AuditLog[] = [];
    for (const log of logs) {
      let externalTaskId: string | null = null;
      let taskType: TaskType | null = null;
      if (log.taskId) {
        const task = await taskRepository.findById(log.taskId);
        if (task) {
          externalTaskId = task.externalTaskId;
          taskType = task.type as TaskType;
        }
      }
      enriched.push({ ...log, externalTaskId, taskType });
    }
    return enriched;
  }
}

export const auditLogService = new AuditLogService();
