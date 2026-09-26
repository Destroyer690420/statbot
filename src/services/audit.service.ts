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
    // One batched task read for the whole page instead of one per log row.
    // Same taskId -> {externalTaskId, type} mapping as before.
    const taskIds = [...new Set(logs.map((l) => l.taskId).filter((id): id is string => Boolean(id)))];
    const tasksById = new Map<string, { externalTaskId: string | null; type: TaskType }>();
    if (taskIds.length > 0) {
      const tasks = await taskRepository.findManyByIds(taskIds);
      for (const task of tasks) {
        tasksById.set(task.id, { externalTaskId: task.externalTaskId, type: task.type as TaskType });
      }
    }

    return logs.map((log) => {
      let externalTaskId: string | null = null;
      let taskType: TaskType | null = null;
      if (log.taskId) {
        const task = tasksById.get(log.taskId);
        if (task) {
          externalTaskId = task.externalTaskId;
          taskType = task.type;
        }
      }
      return { ...log, externalTaskId, taskType };
    });
  }
}

export const auditLogService = new AuditLogService();
