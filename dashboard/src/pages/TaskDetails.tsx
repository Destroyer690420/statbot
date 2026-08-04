import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getTask, getReminders, getAuditLogs, doneTask, retryAssignment, submitTaskUrl } from '../api/client';
import { displayTaskId } from '../utils/taskDisplay';
import { CopyButton } from '../components/CopyButton';
import { ArrowLeft, ExternalLink, Clock, CheckCircle2, AlertCircle, Loader2, History, PlusCircle, CalendarDays, Bell, RefreshCw, Flag, Download, Image, RotateCcw, Link2, Send, Edit3 } from 'lucide-react';

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

  const queryClient = useQueryClient();
  const [submitUrl, setSubmitUrl] = useState('');
  const [replacing, setReplacing] = useState(false);

  const doneMutation = useMutation({
    mutationFn: () => doneTask(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', id] });
      queryClient.invalidateQueries({ queryKey: ['reminders', id] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs', id] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => retryAssignment(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', id] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs', id] });
    },
  });

  const submitMutation = useMutation({
    mutationFn: (url: string) => submitTaskUrl(id!, url),
    onSuccess: () => {
      setSubmitUrl('');
      setReplacing(false);
      queryClient.invalidateQueries({ queryKey: ['task', id] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs', id] });
    },
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
      case 'ACCEPTED': return 'bg-violet-500/10 text-violet-400 border-violet-500/20';
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
          <h1 className="text-3xl font-bold text-white tracking-tight">{displayTaskId(task.id, task.type, task.externalTaskId)}</h1>
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
            {task.redditUrl ? (
              <a
                href={task.redditUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary-400 hover:text-primary-300 flex items-center gap-1.5 text-sm break-all"
              >
                {task.redditUrl}
                <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
              </a>
            ) : (
              <p className="text-dark-500 text-sm italic">Not created via a Reddit URL — delivered from an external source.</p>
            )}
          </div>

          {task.source === 'goparttime' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pt-2 border-t border-dark-700/50">
                <p className="text-dark-400 text-sm font-medium">External Assignment</p>
                {task.assignmentStatus === 'FAILED' ? (
                  <div className="flex items-center gap-2">
                    <span className="status-badge border bg-red-500/10 text-red-400 border-red-500/20">FAILED</span>
                    <button
                      onClick={() => retryMutation.mutate()}
                      disabled={retryMutation.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-500/10 text-primary-400 border border-primary-500/30 hover:bg-primary-500/20 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {retryMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      Retry Delivery
                    </button>
                  </div>
                ) : (
                  <span className={`status-badge border ${
                    task.assignmentStatus === 'SENT'
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                  }`}>
                    {task.assignmentStatus || 'PENDING'}
                  </span>
                )}
              </div>

              {task.assignmentError && (
                <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 text-xs text-red-300 break-words">
                  {task.assignmentError}
                </div>
              )}
              {retryMutation.isError && (
                <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 text-xs text-red-300 break-words">
                  {(retryMutation.error as Error)?.message || 'Retry failed.'}
                </div>
              )}

              {(task.externalTaskId || task.sourceUrl || task.subreddit || task.flair || task.payment || task.deadline) && (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {task.externalTaskId && (
                    <div>
                      <p className="text-dark-400 text-xs font-medium mb-0.5">External Task ID</p>
                      <p className="text-white font-mono">{task.externalTaskId}</p>
                    </div>
                  )}
                  {task.subreddit && (
                    <div>
                      <p className="text-dark-400 text-xs font-medium mb-0.5">Subreddit</p>
                      {task.subredditUrl ? (
                        <a href={task.subredditUrl} target="_blank" rel="noreferrer" className="text-primary-400 hover:text-primary-300">
                          {task.subreddit}
                        </a>
                      ) : (
                        <p className="text-white">{task.subreddit}</p>
                      )}
                    </div>
                  )}
                  {task.flair && (
                    <div>
                      <p className="text-dark-400 text-xs font-medium mb-0.5">Flair</p>
                      <p className="text-white">{task.flair}</p>
                    </div>
                  )}
                  {task.payment && (
                    <div>
                      <p className="text-dark-400 text-xs font-medium mb-0.5">Payment</p>
                      <p className="text-white">{task.payment}</p>
                    </div>
                  )}
                  {task.deadline && (
                    <div>
                      <p className="text-dark-400 text-xs font-medium mb-0.5">Deadline</p>
                      <p className="text-white">{task.deadline}</p>
                    </div>
                  )}
                  {task.sourceUrl && (
                    <div className="col-span-2">
                      <p className="text-dark-400 text-xs font-medium mb-0.5">Source</p>
                      <a href={task.sourceUrl} target="_blank" rel="noreferrer" className="text-primary-400 hover:text-primary-300 text-sm break-all">
                        {task.sourceUrl}
                      </a>
                    </div>
                  )}
                </div>
              )}

              {task.postLink && (
                <div>
                  <p className="text-dark-400 text-xs font-medium mb-0.5">Post Link</p>
                  <a href={task.postLink} target="_blank" rel="noreferrer" className="text-primary-400 hover:text-primary-300 text-sm break-all">
                    {task.postLink}
                  </a>
                </div>
              )}

              {task.formattedContent && (
                <div>
                  <p className="text-dark-400 text-xs font-medium mb-1">Content</p>
                  <div className="bg-dark-800/60 border border-dark-700/50 rounded-lg p-3 text-sm text-dark-100 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
                    {task.formattedContent}
                  </div>
                </div>
              )}

              {task.taskImages && task.taskImages.length > 0 && (
                <div>
                  <p className="text-dark-400 text-xs font-medium mb-2">Images ({task.taskImages.length})</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {task.taskImages
                      .slice()
                      .sort((a: any, b: any) => a.order - b.order)
                      .map((img: any) => (
                        <a key={img.order} href={img.url} target="_blank" rel="noreferrer" className="block">
                          <img
                            src={img.url}
                            alt={`Task image ${img.order}`}
                            className="w-full h-28 object-cover rounded-lg border border-dark-700/50 cursor-pointer hover:opacity-90 transition-opacity"
                          />
                        </a>
                      ))}
                  </div>
                </div>
              )}

              {/* Submission + Accept */}
              <div className="pt-2 border-t border-dark-700/50 space-y-3">
                <p className="text-dark-400 text-sm font-medium">Submission</p>

                {task.submittedRedditUrl ? (
                  <div className="space-y-2">
                    <div className="flex items-start gap-1.5">
                      <a
                        href={task.submittedRedditUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary-400 hover:text-primary-300 flex items-center gap-1.5 text-sm break-all"
                      >
                        {task.submittedRedditUrl}
                        <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                      </a>
                      <CopyButton value={task.submittedRedditUrl} title="Copy submitted link" className="p-1 -mt-1 shrink-0" />
                    </div>
                    <p className="text-xs text-dark-500">
                      Submitted by {task.submittedBy || 'unknown'} · {task.submittedAt ? new Date(task.submittedAt).toLocaleString() : ''}
                    </p>
                    {replacing ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <Link2 className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-dark-400" />
                            <input
                              type="text"
                              placeholder="https://www.reddit.com/..."
                              className="w-full h-9 pl-9 pr-3 bg-dark-800/80 border border-dark-700/80 rounded-lg text-sm text-white placeholder-dark-400 focus:outline-none focus:border-primary-500/50 transition-all"
                              value={submitUrl}
                              onChange={(e) => setSubmitUrl(e.target.value)}
                            />
                          </div>
                          <button
                            onClick={() => submitUrl.trim() && submitMutation.mutate(submitUrl.trim())}
                            disabled={submitMutation.isPending || !submitUrl.trim()}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-500/10 text-primary-400 border border-primary-500/30 hover:bg-primary-500/20 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {submitMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                            Replace
                          </button>
                          <button
                            onClick={() => {
                              setReplacing(false);
                              setSubmitUrl('');
                            }}
                            disabled={submitMutation.isPending}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-dark-800 text-dark-300 border border-dark-700/80 hover:bg-dark-700/60 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Cancel
                          </button>
                        </div>
                        {submitMutation.isError && (
                          <p className="text-xs text-red-400">
                            {(submitMutation.error as Error)?.message || 'Could not replace the URL.'}
                          </p>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setSubmitUrl(task.submittedRedditUrl || '');
                          setReplacing(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-800 text-dark-300 border border-dark-700/80 hover:bg-dark-700/60 text-xs font-semibold transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Replace
                      </button>
                    )}
                  </div>
                ) : task.assignmentStatus === 'FAILED' ? (
                  <p className="text-xs text-dark-500">Delivery failed — fix the assignment before the worker can submit.</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-dark-500">
                      Waiting for the worker to submit the Reddit URL in <span className="text-dark-300 font-mono">#{task.channelName || task.channelId}</span>.
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Link2 className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-dark-400" />
                        <input
                          type="text"
                          placeholder="https://www.reddit.com/..."
                          className="w-full h-9 pl-9 pr-3 bg-dark-800/80 border border-dark-700/80 rounded-lg text-sm text-white placeholder-dark-400 focus:outline-none focus:border-primary-500/50 transition-all"
                          value={submitUrl}
                          onChange={(e) => setSubmitUrl(e.target.value)}
                        />
                      </div>
                      <button
                        onClick={() => submitUrl.trim() && submitMutation.mutate(submitUrl.trim())}
                        disabled={submitMutation.isPending || !submitUrl.trim()}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-500/10 text-primary-400 border border-primary-500/30 hover:bg-primary-500/20 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {submitMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        Record
                      </button>
                    </div>
                    {submitMutation.isError && (
                      <p className="text-xs text-red-400">
                        {(submitMutation.error as Error)?.message || 'Could not record the URL.'}
                      </p>
                    )}
                  </div>
                )}

                {task.status === 'ACCEPTED' && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => doneMutation.mutate()}
                      disabled={doneMutation.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 border border-green-500/30 hover:bg-green-500/20 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {doneMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      Mark as Done
                    </button>
                    <span className="text-xs text-dark-500">
                      Moves the task into the active queue and schedules the insight reminders.
                    </span>
                  </div>
                )}
                {doneMutation.isError && (
                  <p className="text-xs text-red-400">
                    {(doneMutation.error as Error)?.message || 'Could not accept the task.'}
                  </p>
                )}
              </div>
            </div>
          )}
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

        {/* Submitted Screenshots */}
        {reminders.some((r: any) => r.insightImageUrl) && (
          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Image className="w-5 h-5 text-primary-400" />
              Submitted Screenshots
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {reminders.filter((r: any) => r.insightImageUrl).map((r: any) => (
                <div key={r.id} className="bg-dark-800/50 rounded-xl p-3 border border-dark-700/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-dark-200">
                      {r.type.replace(/_/g, ' ')}
                    </span>
                    {r.insightImageName && (
                      <span className="text-xs text-dark-500 truncate ml-2">{r.insightImageName}</span>
                    )}
                  </div>
                  <a href={r.insightImageUrl} target="_blank" rel="noreferrer" className="block">
                    <img
                      src={r.insightImageUrl}
                      alt={`Insight for ${r.type}`}
                      className="w-full rounded-lg border border-dark-700/50 cursor-pointer hover:opacity-90 transition-opacity"
                      style={{ maxHeight: '300px', objectFit: 'contain' }}
                    />
                  </a>
                  <div className="mt-2 flex items-center justify-between">
                    {r.insightImageName && (
                      <span className="text-xs text-dark-500 truncate">{r.insightImageName}</span>
                    )}
                    <a
                      href={r.insightImageUrl}
                      download={r.insightImageName || 'screenshot.png'}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-400 hover:text-primary-300 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
