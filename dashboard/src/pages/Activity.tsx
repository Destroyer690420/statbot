import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getAuditLogs } from '../api/client';
import {
  Loader2,
  PlusCircle,
  Trash2,
  XCircle,
  CheckCircle2,
  Bell,
  BellOff,
  Image,
  AlertTriangle,
  Terminal,
  Archive,
  RefreshCw,
  Clock,
} from 'lucide-react';

const ACTION_CONFIG: Record<string, { icon: typeof PlusCircle; label: string; color: string }> = {
  TASK_CREATED: { icon: PlusCircle, label: 'Task Created', color: 'text-green-400' },
  TASK_DELETED: { icon: Trash2, label: 'Task Deleted', color: 'text-red-400' },
  TASK_UPDATED: { icon: RefreshCw, label: 'Task Updated', color: 'text-blue-400' },
  TASK_COMPLETED: { icon: CheckCircle2, label: 'Task Completed', color: 'text-green-400' },
  TASK_CANCELLED: { icon: XCircle, label: 'Task Cancelled', color: 'text-red-400' },
  TASK_ARCHIVED: { icon: Archive, label: 'Task Archived', color: 'text-dark-400' },
  REMINDER_SENT: { icon: Bell, label: 'Reminder Sent', color: 'text-blue-400' },
  REMINDER_COMPLETED: { icon: BellOff, label: 'Reminder Completed', color: 'text-dark-400' },
  REMINDER_RETRY: { icon: Bell, label: 'Reminder Retry', color: 'text-yellow-400' },
  REMINDER_RESCHEDULED: { icon: RefreshCw, label: 'Reminder Rescheduled', color: 'text-yellow-400' },
  INSIGHT_RECEIVED: { icon: Image, label: 'Insight Received', color: 'text-purple-400' },
  ADMIN_ALERT: { icon: AlertTriangle, label: 'Admin Alert', color: 'text-orange-400' },
  COMMAND_USED: { icon: Terminal, label: 'Command Used', color: 'text-dark-400' },
};

const ACTION_OPTIONS = Object.entries(ACTION_CONFIG).map(([value, config]) => ({
  value,
  label: config.label,
}));

function getTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function Activity() {
  const [actionFilter, setActionFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => getAuditLogs(),
    refetchInterval: 30_000,
  });

  const logs = data?.data || [];

  const filteredLogs = actionFilter
    ? logs.filter((l: any) => l.action === actionFilter)
    : logs;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-4">
        <div className="flex items-center gap-3">
          <select
            className="input-field appearance-none bg-dark-800 pr-8"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <option value="">All Actions</option>
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-dark-700/50 bg-dark-800/50">
                <th className="px-6 py-4 font-semibold text-dark-200 w-32">Time</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Action</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Task</th>
                <th className="px-6 py-4 font-semibold text-dark-200">User</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700/50">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto" />
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <Clock className="w-12 h-12 text-dark-500 mx-auto mb-3" />
                    <p className="text-dark-400">No activity recorded yet.</p>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log: any) => {
                  const config = ACTION_CONFIG[log.action] || { icon: Terminal, label: log.action, color: 'text-dark-400' };
                  const Icon = config.icon;
                  return (
                    <tr key={log.id} className="hover:bg-dark-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm text-dark-400 whitespace-nowrap">
                        {getTimeAgo(log.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 ${config.color}`}>
                          <Icon className="w-4 h-4" />
                          <span className="text-sm font-medium text-dark-100">{config.label}</span>
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {log.taskId ? (
                          <Link
                            to={`/tasks/${encodeURIComponent(log.taskId)}`}
                            className="font-mono text-sm text-primary-400 hover:text-primary-300 transition-colors"
                          >
                            {log.taskId}
                          </Link>
                        ) : (
                          <span className="text-dark-500 text-sm">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-mono text-sm text-dark-300">
                          {log.userId || '—'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-dark-400 max-w-[300px] truncate block">
                          {log.details || '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-dark-500 text-xs text-right">
        Auto-refreshes every 30s · Showing {filteredLogs.length} of {logs.length} events
      </p>
    </div>
  );
}
