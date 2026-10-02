import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getTasks, doneTask, reassignTask, deleteTask, getTickets } from '../api/client';
import { displayTaskId } from '../utils/taskDisplay';
import { CopyButton } from '../components/CopyButton';
import { FormatBadge } from '../components/FormatBadge';
import { FormatDiffModal } from '../components/FormatDiffModal';
import { Loader2, CheckCircle2, Repeat, Trash2, Eye, ExternalLink, X, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 15;

export function AcceptedTasks() {
  const [ticketFor, setTicketFor] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [diffFor, setDiffFor] = useState<any | null>(null);

  const { data: tasksData, isLoading, refetch } = useQuery({
    queryKey: ['tasks', 'ACCEPTED'],
    queryFn: () => getTasks({ status: 'ACCEPTED' }),
  });

  const ticketsQuery = useQuery({
    queryKey: ['tickets'],
    queryFn: getTickets,
    enabled: ticketFor !== null,
  });

  const doneMutation = useMutation({
    mutationFn: (id: string) => doneTask(id),
    onSuccess: () => refetch(),
  });

  const reassignMutation = useMutation({
    mutationFn: ({ id, ticket }: { id: string; ticket: string }) => reassignTask(id, ticket),
    onSuccess: () => {
      refetch();
      setTicketFor(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: () => refetch(),
  });

  const tasks = tasksData?.data || [];
  const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
  const paginatedTasks = tasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const tickets = ticketsQuery.data?.data || [];

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this task? This cannot be undone.')) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <span className="status-badge border bg-info-muted text-info border-info/30 px-3 py-1">
          {tasks.length} queued
        </span>
      </div>

      <div className="glass-card overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-dark-700/50 bg-dark-800/50">
                <th className="px-6 py-4 font-semibold text-dark-200">Task ID</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Type</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Ticket</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Submission</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Format</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Created</th>
                <th className="px-6 py-4 font-semibold text-dark-200 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700/50">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto" />
                  </td>
                </tr>
              ) : paginatedTasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-dark-400">
                    No tasks awaiting activation.
                  </td>
                </tr>
              ) : (
                paginatedTasks.map((task: any) => (
                  <tr key={task.id} className="hover:bg-dark-800/30 transition-colors">
                    <td className="px-6 py-4 font-mono text-sm font-medium text-dark-100">
                      <Link to={`/tasks/${encodeURIComponent(task.id)}`} className="hover:text-primary-400 transition-colors">
                        {displayTaskId(task.id, task.type, task.externalTaskId)}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-sm text-dark-200">
                      {task.externalTaskId ? `${task.type.replace('_', ' ')} · ${task.externalTaskId}` : task.type.replace('_', ' ')}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-sm text-dark-200 bg-dark-800/50 px-2 py-1 rounded-md border border-dark-700/50">
                        {task.channelName ? `#${task.channelName}` : task.channelId}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {task.submittedRedditUrl ? (
                        <a
                          href={task.submittedRedditUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary-400 hover:text-primary-300 flex items-center max-w-[220px] truncate"
                        >
                          <span className="truncate">{task.submittedRedditUrl}</span>
                          <ExternalLink className="w-3.5 h-3.5 ml-1.5 flex-shrink-0" />
                        </a>
                      ) : (
                        <span className="text-dark-500 text-sm italic">Waiting</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <FormatBadge
                        status={task.formatCheckStatus}
                        detail={task.formatCheckDetail}
                        taskType={task.type}
                        hasUrl={!!task.submittedRedditUrl}
                        onOpenDiff={() => setDiffFor(task)}
                      />
                    </td>
                    <td className="px-6 py-4 text-sm text-dark-300">
                      {new Date(task.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setTicketFor(task.id)}
                          className="p-2 text-dark-400 hover:text-warning hover:bg-warning-muted rounded-lg transition-colors"
                          title="Reassign"
                        >
                          <Repeat className="w-4 h-4" />
                        </button>
                        {task.submittedRedditUrl && (
                          <CopyButton value={task.submittedRedditUrl} title="Copy submitted link" />
                        )}
                        <button
                          onClick={() => doneMutation.mutate(task.id)}
                          disabled={doneMutation.isPending}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-success-muted text-success border border-success/30 hover:bg-success-muted transition-colors disabled:opacity-40 disabled:cursor-wait"
                          title="Mark done and move to active queue"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Done
                        </button>
                        <Link
                          to={`/tasks/${encodeURIComponent(task.id)}`}
                          className="p-2 text-dark-400 hover:text-primary-400 hover:bg-primary-400/10 rounded-lg transition-colors"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => handleDelete(task.id)}
                          className="p-2 text-dark-400 hover:text-danger hover:bg-danger-muted rounded-lg transition-colors"
                          title="Delete Task"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card Layout */}
      <div className="md:hidden space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
          </div>
        ) : paginatedTasks.length === 0 ? (
          <div className="glass-card p-8 text-center text-dark-400">
            No tasks waiting activation.
          </div>
        ) : (
          paginatedTasks.map((task: any) => (
            <div key={task.id} className="glass-card border border-dark-700/50 overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <Link to={`/tasks/${encodeURIComponent(task.id)}`} className="min-w-0">
                  <span className="text-primary-400 font-bold font-mono text-base truncate">{displayTaskId(task.id, task.type, task.externalTaskId)}</span>
                </Link>
                <span className="status-badge border bg-info-muted text-info border-info/30 text-[10px]">
                  ACCEPTED
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 px-4 py-2 border-t border-dark-700/30">
                <div>
                  <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider">Ticket</p>
                  <p className="text-dark-200 text-xs font-mono font-medium truncate">
                    {task.channelName ? `#${task.channelName}` : task.channelId}
                  </p>
                </div>
                <div>
                  <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider">Created</p>
                  <p className="text-dark-200 text-xs font-medium">
                    {new Date(task.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </p>
                </div>
              </div>
              <div className="px-4 py-2 flex items-center justify-between gap-2">
                {task.submittedRedditUrl ? (
                  <a
                    href={task.submittedRedditUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-400 text-xs flex items-center gap-1 truncate min-w-0"
                  >
                    <ExternalLink className="w-3 h-3 shrink-0" />
                    <span className="truncate">{task.submittedRedditUrl}</span>
                  </a>
                ) : (
                  <span className="text-dark-500 text-xs italic">Awaiting submission</span>
                )}
                <FormatBadge
                  status={task.formatCheckStatus}
                  detail={task.formatCheckDetail}
                  taskType={task.type}
                  hasUrl={!!task.submittedRedditUrl}
                  onOpenDiff={() => setDiffFor(task)}
                />
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t border-dark-700/30 bg-dark-800/30">
                <button
                  onClick={() => doneMutation.mutate(task.id)}
                  disabled={doneMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-success-muted text-success border border-success/30 hover:bg-success-muted transition-colors disabled:opacity-40"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Done
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setTicketFor(task.id)}
                    className="p-1.5 text-dark-400 hover:text-warning hover:bg-warning-muted rounded-lg transition-colors"
                    title="Reassign"
                  >
                    <Repeat className="w-4 h-4" />
                  </button>
                  {task.submittedRedditUrl && (
                    <CopyButton value={task.submittedRedditUrl} title="Copy submitted link" className="p-1.5" />
                  )}
                  <Link
                    to={`/tasks/${encodeURIComponent(task.id)}`}
                    className="p-1.5 text-dark-400 hover:text-primary-400 hover:bg-primary-400/10 rounded-lg transition-colors"
                    title="View Details"
                  >
                    <Eye className="w-4 h-4" />
                  </Link>
                  <button
                    onClick={() => handleDelete(task.id)}
                    className="p-1.5 text-dark-400 hover:text-danger hover:bg-danger-muted rounded-lg transition-colors"
                    title="Delete Task"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-dark-400 text-sm">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, tasks.length)} of {tasks.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 text-text-secondary hover:text-text-primary hover:bg-surface rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[13px] text-text-secondary font-medium">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-2 text-text-secondary hover:text-text-primary hover:bg-surface rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {diffFor && (
        <FormatDiffModal task={diffFor} onClose={() => setDiffFor(null)} onRechecked={() => { refetch(); setDiffFor(null); }} />
      )}

      {/* Reassign ticket picker (modal — works on mobile; native <select> + onBlur unmount broke on phones) */}
      {ticketFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm duration-200">
          <div className="bg-dark-800 rounded-lg p-6 w-full max-w-sm mx-4 border border-dark-700 shadow-pop modal-panel max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">Reassign task</h3>
              <button
                onClick={() => setTicketFor(null)}
                className="text-dark-500 hover:text-text-primary transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto -mx-2 px-2 space-y-2 flex-1">
              {ticketsQuery.isLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
                </div>
              ) : tickets.length === 0 ? (
                <p className="text-center text-dark-400 text-sm py-10">No tickets available.</p>
              ) : (
                tickets.map((t: any) => (
                  <button
                    key={t.channelId}
                    onClick={() => reassignMutation.mutate({ id: ticketFor, ticket: t.channelId })}
                    disabled={reassignMutation.isPending}
                    className="w-full text-left px-4 py-3 rounded-xl bg-dark-900/60 border border-dark-700/60 hover:border-warning/30 hover:bg-warning-muted text-dark-200 hover:text-text-primary transition-colors disabled:opacity-50"
                  >
                    <span className="font-mono text-sm">#{t.channelName || t.channelId}</span>
                    {t.taskStatus === 'awaiting-submission' && (
                      <span className="ml-2 status-badge border bg-warning-muted text-warning border-warning/30">busy</span>
                    )}
                  </button>
                ))
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setTicketFor(null)}
                disabled={reassignMutation.isPending}
                className="px-4 py-2 text-sm text-dark-400 hover:text-text-primary transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}