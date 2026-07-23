import { TaskStats, TaskStatus, TaskType } from '../types';
import { taskService } from './task.service';
import { logger } from '../utils/logger';
import dayjs from 'dayjs';

class AnalyticsService {
  /**
   * Calculate comprehensive task statistics.
   */
  async getStats(guildId?: string): Promise<TaskStats> {
    try {
      const tasks = await taskService.findAll(guildId);
      const now = dayjs();

      const total = tasks.length;
      const pending = tasks.filter((t) =>
        ![TaskStatus.COMPLETED, TaskStatus.ARCHIVED, TaskStatus.CANCELLED].includes(t.status)
      ).length;
      const completed = tasks.filter((t) =>
        [TaskStatus.COMPLETED, TaskStatus.ARCHIVED].includes(t.status)
      ).length;
      const cancelled = tasks.filter((t) => t.status === TaskStatus.CANCELLED).length;
      const overdue = tasks.filter((t) =>
        [TaskStatus.REMINDER_20_SENT, TaskStatus.REMINDER_70_SENT].includes(t.status)
      ).length;

      // Completion rate
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

      // Average completion time (hours)
      const completedTasks = tasks.filter((t) => t.status === TaskStatus.COMPLETED);
      let avgCompletionTimeHours = 0;
      if (completedTasks.length > 0) {
        const totalHours = completedTasks.reduce((sum, task) => {
          const hours = dayjs(task.updatedAt).diff(dayjs(task.createdAt), 'hour', true);
          return sum + hours;
        }, 0);
        avgCompletionTimeHours = Math.round((totalHours / completedTasks.length) * 10) / 10;
      }

      // Tasks today
      const tasksToday = tasks.filter((t) =>
        dayjs(t.createdAt).isSame(now, 'day')
      ).length;

      // Posts today
      const todayPosts = tasks.filter((t) =>
        t.type === TaskType.POST && dayjs(t.createdAt).isSame(now, 'day')
      ).length;

      // Comments today
      const todayComments = tasks.filter((t) =>
        t.type === TaskType.COMMENT && dayjs(t.createdAt).isSame(now, 'day')
      ).length;

      // Helper to determine if task is deleted/cancelled
      const isTaskDeleted = (t: any) =>
        t.status === TaskStatus.CANCELLED ||
        t.cancelledReason === 'deleted' ||
        t.cancelledReason === 'deleted_later';

      // Today's deleted tasks
      const todayDeleted = tasks.filter((t) =>
        isTaskDeleted(t) && (dayjs(t.updatedAt).isSame(now, 'day') || dayjs(t.createdAt).isSame(now, 'day'))
      ).length;

      // Total deleted tasks
      const totalDeleted = tasks.filter((t) => isTaskDeleted(t)).length;

      // Tasks this week
      const tasksThisWeek = tasks.filter((t) =>
        dayjs(t.createdAt).isSame(now, 'week')
      ).length;

      return {
        total,
        pending,
        completed,
        cancelled,
        overdue,
        completionRate,
        avgCompletionTimeHours,
        tasksToday,
        tasksThisWeek,
        todayPosts,
        todayComments,
        todayDeleted,
        totalDeleted,
      };
    } catch (error) {
      logger.error('Failed to calculate stats', { error });
      throw error;
    }
  }

  /**
   * Get tasks per day for the last N days.
   */
  async getTasksPerDay(days = 30, guildId?: string): Promise<{ date: string; count: number }[]> {
    const tasks = await taskService.findAll(guildId);
    const result: { date: string; count: number }[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      const count = tasks.filter((t) =>
        dayjs(t.createdAt).format('YYYY-MM-DD') === date
      ).length;
      result.push({ date, count });
    }

    return result;
  }

  /**
   * Get task type distribution.
   */
  async getTypeDistribution(guildId?: string): Promise<{ type: string; count: number }[]> {
    const tasks = await taskService.findAll(guildId);

    return [
      { type: TaskType.POST, count: tasks.filter((t) => t.type === TaskType.POST).length },
      { type: TaskType.COMMENT, count: tasks.filter((t) => t.type === TaskType.COMMENT).length },
    ];
  }

  /**
   * Get employee performance stats.
   */
  async getEmployeePerformance(guildId?: string): Promise<{
    userId: string;
    total: number;
    completed: number;
    pending: number;
    avgCompletionHours: number;
  }[]> {
    const tasks = await taskService.findAll(guildId);

    const userMap = new Map<string, typeof tasks>();
    for (const task of tasks) {
      const existing = userMap.get(task.assignedUserId) || [];
      existing.push(task);
      userMap.set(task.assignedUserId, existing);
    }

    return Array.from(userMap.entries()).map(([userId, userTasks]) => {
      const completed = userTasks.filter((t) =>
        [TaskStatus.COMPLETED, TaskStatus.ARCHIVED].includes(t.status)
      );
      const pending = userTasks.filter((t) =>
        ![TaskStatus.COMPLETED, TaskStatus.ARCHIVED, TaskStatus.CANCELLED].includes(t.status)
      );

      let avgHours = 0;
      if (completed.length > 0) {
        const totalHours = completed.reduce((sum, t) => {
          return sum + dayjs(t.updatedAt).diff(dayjs(t.createdAt), 'hour', true);
        }, 0);
        avgHours = Math.round((totalHours / completed.length) * 10) / 10;
      }

      return {
        userId,
        total: userTasks.length,
        completed: completed.length,
        pending: pending.length,
        avgCompletionHours: avgHours,
      };
    });
  }
}

export const analyticsService = new AnalyticsService();
