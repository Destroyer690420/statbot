import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getTask, getReminders } from '../api/client';
import { ArrowLeft, ExternalLink, Clock, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

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
              <p className="text-white font-mono text-sm">{task.channelId}</p>
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

        {/* Reminder Timeline */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary-400" />
            Reminders
          </h3>

          {remindersLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            </div>
          ) : reminders.length === 0 ? (
            <p className="text-dark-400 text-sm">No reminders for this task.</p>
          ) : (
            <div className="space-y-3">
              {reminders.map((r: any) => (
                <div key={r.id} className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold px-2 py-1 bg-primary-900/50 text-primary-400 rounded-lg">
                      {r.type.replace('_', ' ')}
                    </span>
                    {r.completed ? (
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                    ) : r.sent ? (
                      <Clock className="w-4 h-4 text-yellow-400" />
                    ) : (
                      <Clock className="w-4 h-4 text-dark-400" />
                    )}
                  </div>
                  <p className="text-xs text-dark-400">
                    Due: {new Date(r.dueAt).toLocaleString()}
                  </p>
                  {r.sentAt && (
                    <p className="text-xs text-dark-400">
                      Sent: {new Date(r.sentAt).toLocaleString()}
                    </p>
                  )}
                  {r.completedAt && (
                    <p className="text-xs text-dark-400">
                      Completed: {new Date(r.completedAt).toLocaleString()}
                    </p>
                  )}
                  {r.retryCount > 0 && (
                    <p className="text-xs text-yellow-400 mt-1">
                      Retries: {r.retryCount}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
