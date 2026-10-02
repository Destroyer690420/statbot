import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getTasks, downloadCsv } from '../api/client';
import { displayTaskId } from '../utils/taskDisplay';
import { Search, ExternalLink, Loader2, ChevronLeft, ChevronRight, Eye, Download, Archive as ArchiveIcon } from 'lucide-react';

const PAGE_SIZE = 15;

export function Archives() {
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);

  const { data: tasksData, isLoading } = useQuery({
    queryKey: ['archives'],
    queryFn: () => getTasks({ status: 'ARCHIVED' }),
  });

  const tasks = tasksData?.data || [];

  const needle = searchTerm.trim().toLowerCase();
  const filteredTasks = useMemo(
    () =>
      needle
        ? tasks.filter((task: any) =>
            displayTaskId(task.id, task.type, task.externalTaskId).toLowerCase().includes(needle) ||
            task.id.toLowerCase().includes(needle) ||
            // Archived rows can have a null redditUrl; unguarded this threw on
            // the first keystroke and white-screened the page.
            (task.redditUrl || '').toLowerCase().includes(needle) ||
            (task.channelId && task.channelId.toLowerCase().includes(needle)) ||
            (task.channelName && task.channelName.toLowerCase().includes(needle))
          )
        : tasks,
    [tasks, needle],
  );

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const paginatedTasks = useMemo(
    () => filteredTasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredTasks, page],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Archives</h1>
        <p className="text-[13px] text-text-secondary mt-1">
          Paid and swept tasks, kept for record.
        </p>
      </div>

      <div className="flex items-center gap-2 w-full">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search ID or URL..."
            className="input-field w-full h-10 pl-9"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
          />
        </div>

        {/* Download Button */}
        <button
          onClick={() => downloadCsv({ status: 'ARCHIVED' })}
          className="btn-secondary w-10 h-10 !px-0 shrink-0"
          title="Export CSV"
        >
          <Download className="w-4 h-4" />
        </button>
      </div>

      {/* Desktop table */}
      <div className="glass-card overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="app-table text-left border-collapse">
            <thead>
              <tr>
                <th className="px-4">Task ID</th>
                <th className="px-4">Type</th>
                <th className="px-4">Status</th>
                <th className="px-4">URL</th>
                <th className="px-4">Created</th>
                <th className="px-4">Ticket</th>
                <th className="px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <Loader2 className="w-6 h-6 text-primary-500 animate-spin mx-auto" />
                  </td>
                </tr>
              ) : paginatedTasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="empty-state">
                      <ArchiveIcon className="w-5 h-5 text-text-muted mb-3" />
                      <p className="empty-state-title">No archived tasks found</p>
                      <p className="empty-state-desc">There are currently no archived tasks matching your filters.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedTasks.map((task: any) => (
                  <tr key={task.id}>
                    <td className="font-mono text-[13px] font-medium !text-text-primary">
                      <Link to={`/tasks/${encodeURIComponent(task.id)}`} className="hover:text-primary-400 transition-colors">
                        {displayTaskId(task.id, task.type, task.externalTaskId)}
                      </Link>
                    </td>
                    <td>
                      <span className="status-badge border bg-surface-active text-text-secondary border-appborder">
                        {task.type}
                      </span>
                    </td>
                    <td>
                      <span className="status-badge border badge-neutral">
                        Archived
                      </span>
                    </td>
                    <td>
                      <a
                        href={task.redditUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary-400 hover:text-primary-300 flex items-center group max-w-[200px] truncate text-[13px]"
                      >
                        <span className="truncate">{task.redditUrl}</span>
                        <ExternalLink className="w-3.5 h-3.5 ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      </a>
                    </td>
                    <td className="text-[13px]">
                      {new Date(task.createdAt).toLocaleDateString()}
                    </td>
                    <td>
                      <span className="font-mono text-xs text-text-secondary bg-background-secondary px-2 py-1 rounded-md border border-appborder-subtle">
                        {task.channelName ? `#${task.channelName}` : task.channelId}
                      </span>
                    </td>
                    <td className="text-right">
                      <Link
                        to={`/tasks/${encodeURIComponent(task.id)}`}
                        className="p-2 text-text-secondary hover:text-text-primary hover:bg-surface-hover rounded-md transition-colors inline-block"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-[132px]" />
            ))}
          </div>
        ) : paginatedTasks.length === 0 ? (
          <div className="glass-card">
            <div className="empty-state">
              <ArchiveIcon className="w-5 h-5 text-text-muted mb-3" />
              <p className="empty-state-title">No archived tasks found</p>
              <p className="empty-state-desc">There are currently no archived tasks matching your filters.</p>
            </div>
          </div>
        ) : (
          paginatedTasks.map((task: any) => (
            <div key={task.id} className="glass-card p-4">
              <div className="flex items-center justify-between gap-2">
                <Link
                  to={`/tasks/${encodeURIComponent(task.id)}`}
                  className="font-mono text-[13px] font-medium text-text-primary truncate"
                >
                  {displayTaskId(task.id, task.type, task.externalTaskId)}
                </Link>
                <span className="status-badge border badge-neutral shrink-0">Archived</span>
              </div>
              <div className="flex items-center gap-2 mt-2 text-xs text-text-secondary">
                <span className="status-badge border bg-surface-active text-text-secondary border-appborder">{task.type}</span>
                <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                <span className="font-mono truncate">
                  {task.channelName ? `#${task.channelName}` : task.channelId}
                </span>
              </div>
              <div className="flex items-center justify-between mt-3">
                <a
                  href={task.redditUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary-400 text-[13px] truncate max-w-[70%]"
                >
                  {task.redditUrl || '—'}
                </a>
                <Link
                  to={`/tasks/${encodeURIComponent(task.id)}`}
                  className="p-2 text-text-secondary hover:text-text-primary hover:bg-surface-hover rounded-md transition-colors"
                  title="View Details"
                >
                  <Eye className="w-4 h-4" />
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-text-secondary text-[13px]">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredTasks.length)} of {filteredTasks.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 text-text-secondary hover:text-text-primary hover:bg-surface rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[13px] text-text-secondary font-medium">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-2 text-text-secondary hover:text-text-primary hover:bg-surface rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
