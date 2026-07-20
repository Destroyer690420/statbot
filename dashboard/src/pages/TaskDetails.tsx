import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getTask, getReminders, getAuditLogs } from '../api/client';
import { ArrowLeft, ExternalLink, Clock, CheckCircle2, AlertCircle, Loader2, History, PlusCircle, CalendarDays, Bell, RefreshCw, Flag } from 'lucide-react';

export function TaskDetails() {
  const { id } = useParams<{ id: string }>();

  const { data: taskData, isLoading: taskLoading } = useQuery({
    queryKey: ['task', id],
    queryFn: () => getTask(id!),
    enabled: !!id,
  });

  const { data: remindersData, isLoading: remindersLoading } = useQuery({
    queryKey: ['reminders', id],
    queryFn: () => getReminders(id!),
    enabled: !!id,
  });

  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ['audit-logs', id],
    queryFn: () => getAuditLogs({ taskId: id! }),
    enabled: !!id,
  });

  if (taskLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
      </div>
    );
  }

  const task = taskData?.data;
  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
        <AlertCircle className="w-16 h-16 text-dark-400" />
        <h2 className="text-2xl font-bold text-white">Task Not Found</h2>
        <Link to="/tasks" className="text-primary-400 hover:text-primary-300">
          ← Back to Tasks
        </Link>
      </div>
    );
  }

  const reminders = remindersData?.data || [];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'bg-green-500/10 text-green-400 border-green-500/20';
      case 'ARCHIVED': return 'bg-dark-500/10 text-dark-400 border-dark-500/20';
      case 'CANCELLED': return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'PENDING': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      default: return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    }
  };

  const RETRY_DELAYS = [2 * 3600 * 1000, 6 * 3600 * 1000];

  function getScheduledLabel(type: string): string {
    if (type === 'POST_70H') return 'Second View Data';
    return 'First View Data';
  }

  function getCompletedLabel(type: string): string {
    if (type === 'COMMENT_20H') return 'View Data Received';
    if (type === 'POST_20H') return 'First View Data Received';
    return 'Second View Data Received';
  }

  function buildTimelineEvents(reminders: any[], task: any) {
    const events: {
      id: string;
      date: Date | null;
      label: string;
      description: string;
      type: 'task-created' | 'scheduled' | 'sent' | 'retry' | 'completed' | 'task-completed';
    }[] = [];

    events.push({
      id: 'task-created',
      date: new Date(task.createdAt),
      label: 'Task Created',
      description: `${task.type} · ${new Date(task.createdAt).toLocaleString()}`,
      type: 'task-created',
    });

    for (const r of reminders) {
      events.push({
        id: `${r.id}-scheduled`,
        date: new Date(r.dueAt),
        label: getScheduledLabel(r.type),
        description: new Date(r.dueAt).toLocaleString(),
        type: 'scheduled',
      });

      if (r.sent && r.sentAt) {
        events.push({
          id: `${r.id}-sent`,
          date: new Date(r.sentAt),
          label: 'Reminder Sent',
          description: new Date(r.sentAt).toLocaleString(),
          type: 'sent',
        });
      }

      if (r.retryCount > 0 && r.sentAt) {
        const sentMs = new Date(r.sentAt).getTime();
        for (let i = 1; i <= r.retryCount; i++) {
          const retryDate = new Date(sentMs + RETRY_DELAYS.slice(0, i).reduce((a, b) => a + b, 0));
          events.push({
            id: `${r.id}-retry-${i}`,
            date: retryDate,
            label: `Retry ${i}`,
            description: new Date(retryDate).toLocaleString(),
            type: 'retry',
          });
        }
      }

      if (r.completed && r.completedAt) {
        events.push({
          id: `${r.id}-completed`,
          date: new Date(r.completedAt),
          label: getCompletedLabel(r.type),
          description: new Date(r.completedAt).toLocaleString(),
          type: 'completed',
        });
      }
    }

    if (task.status === 'COMPLETED') {
      events.push({
        id: 'task-completed',
        date: new Date(task.updatedAt),
        label: 'Task Completed',
        description: new Date(task.updatedAt).toLocaleString(),
        type: 'task-completed',
      });
    }

    events.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.getTime() - b.date.getTime();
    });

    return events;
  }

  function TimelineIcon({ type }: { type: string }) {
    const icons: Record<string, typeof PlusCircle> = {
      'task-created': PlusCircle,
      scheduled: CalendarDays,
      sent: Bell,
      retry: RefreshCw,
      completed: CheckCircle2,
      'task-completed': Flag,
    };
    const Icon = icons[type] || Clock;
    return <Icon className="w-5 h-5" />;
  }

  function dotColor(type: string): string {
    switch (type) {
      case 'task-created': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'scheduled': return 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30';
      case 'sent': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'retry': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'completed': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'task-completed': return 'bg-green-500/20 text-green-400 border-green-500/30';
      default: return 'bg-dark-700/50 text-dark-400 border-dark-600';
    }
  }

  const timeline = buildTimelineEvents(reminders, task);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Link to="/tasks" className="p-2 text-dark-400 hover:text-white hover:bg-dark-800 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">{task.id}</h1>
          <p className="text-dark-400 mt-1">Task details and activity</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Task Info */}
        <div className="lg:col-span-2 glass-card p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Task Information</h3>
            <span className={`status-badge border ${getStatusColor(task.status)}`}>
              {task.status.replace(/_/g, ' ')}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-dark-400 text-sm font-medium mb-1">Type</p>
              <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-dark-700 text-dark-200 border border-dark-600">
                {task.type}
              </span>
            </div>
            <div>
              <p className="text-dark-400 text-sm font-medium mb-1">Assigned User</p>
              <p className="text-white font-mono text-sm">{task.assignedUserId}</p>
            </div>
            <div>
              <p className="text-dark-400 text-sm font-medium mb-1">Ticket Channel</p>
              <p className="text-white font-mono text-sm">{task.channelName ? `#${task.channelName}` : task.channelId}</p>
            </div>
            <div>
              <p className="text-dark-400 text-sm font-medium mb-1">Created</p>
              <p className="text-white text-sm">{new Date(task.createdAt).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-dark-400 text-sm font-medium mb-1">Updated</p>
              <p className="text-white text-sm">{new Date(task.updatedAt).toLocaleString()}</p>
            </div>
            {task.notes && (
              <div className="col-span-2">
                <p className="text-dark-400 text-sm font-medium mb-1">Notes</p>
                <p className="text-dark-200 text-sm bg-dark-800 rounded-lg p-3">{task.notes}</p>
              </div>
            )}
            {task.cancelledReason && (
              <div className="col-span-2">
                <p className="text-dark-400 text-sm font-medium mb-1">Cancelled Reason</p>
                <p className="text-white text-sm font-medium">
                  {task.cancelledReason === 'deleted' ? '🗑️ Deleted (Early)' : '🗑️ Deleted Later'}
                </p>
              </div>
            )}
          </div>

          <div>
            <p className="text-dark-400 text-sm font-medium mb-2">Reddit URL</p>
            <a
              href={task.redditUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary-400 hover:text-primary-300 flex items-center gap-1.5 text-sm break-all"
            >
              {task.redditUrl}
              <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
            </a>
          </div>
        </div>

        {/* Audit Log */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <History className="w-5 h-5 text-primary-400" />
            Activity Log
          </h3>

          {auditLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            </div>
          ) : !auditData?.data?.length ? (
            <p className="text-dark-400 text-sm">No activity recorded for this task.</p>
          ) : (
            <div className="space-y-2">
              {auditData.data.slice(0, 5).map((log: any) => (
                <div key={log.id} className="bg-dark-800/50 rounded-xl p-3 border border-dark-700/50 flex items-center justify-between">
                  <div>
                    <span className="text-sm text-dark-100 font-medium">{log.action.replace(/_/g, ' ')}</span>
                    {log.details && (
                      <p className="text-xs text-dark-400 mt-0.5">{log.details}</p>
                    )}
                  </div>
                  <span className="text-xs text-dark-500 whitespace-nowrap ml-4">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
              {auditData.data.length > 5 && (
                <Link
                  to={`/activity?taskId=${encodeURIComponent(id!)}`}
                  className="block text-center text-sm text-primary-400 hover:text-primary-300 mt-3 transition-colors"
                >
                  View all {auditData.data.length} events →
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Reminder Timeline */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary-400" />
            Reminder Timeline
          </h3>

          {remindersLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            </div>
          ) : reminders.length === 0 ? (
            <p className="text-dark-400 text-sm">No reminders for this task.</p>
          ) : (
            <div className="relative">
              <div className="absolute left-[19px] top-2 bottom-2 w-[2px] bg-gradient-to-b from-dark-600 via-dark-700 to-dark-800" />
              <div className="space-y-0">
                {timeline.map((event) => {
                  const isFuture = event.date && event.date.getTime() > Date.now();
                  return (
                    <div key={event.id} className="relative flex gap-4 pb-5 last:pb-0 group">
                      <div className={`relative z-10 flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-200 group-hover:scale-110 ${dotColor(event.type)} ${isFuture ? 'opacity-40' : ''}`}>
                        <TimelineIcon type={event.type} />
                      </div>
                      <div className={`flex-1 min-w-0 pt-2 ${isFuture ? 'opacity-40' : ''}`}>
                        <p className="text-sm font-medium text-dark-100">{event.label}</p>
                        <p className="text-xs text-dark-500 mt-0.5">{event.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
