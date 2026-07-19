import { AuditAction, AuditLog } from '../types';
import { auditLogsCollection, toTimestamp } from '../database/firebase';
import { generateLogId } from '../utils/id-generator';
import { logger } from '../utils/logger';

class AuditLogService {
  /**
   * Create an audit log entry.
   */
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

      await auditLogsCollection().doc(entry.id).set({
        ...entry,
        createdAt: toTimestamp(entry.createdAt),
      });

      logger.debug('Audit log created', { action, taskId });
    } catch (error) {
      // Don't let audit logging failures break the main flow
      logger.error('Failed to create audit log', { error, action, taskId });
    }
  }

  /**
   * Get recent audit logs for a task.
   */
  async getByTaskId(taskId: string, limit = 20): Promise<AuditLog[]> {
    const snapshot = await auditLogsCollection()
      .where('taskId', '==', taskId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => this.docToLog(doc));
  }

  /**
   * Get recent audit logs.
   */
  async getRecent(limit = 50): Promise<AuditLog[]> {
    const snapshot = await auditLogsCollection()
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => this.docToLog(doc));
  }

  private docToLog(doc: FirebaseFirestore.DocumentSnapshot): AuditLog {
    const data = doc.data()!;
    return {
      id: doc.id,
      action: data.action as AuditAction,
      taskId: data.taskId || null,
      userId: data.userId || null,
      details: data.details || null,
      createdAt: data.createdAt?.toDate() || new Date(),
    };
  }
}

export const auditLogService = new AuditLogService();
