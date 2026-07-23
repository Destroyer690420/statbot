import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getTasks, deleteTask, updateTask, downloadCsv, getTask } from '../api/client';
import { Search, Filter, Trash2, ExternalLink, Loader2, ChevronLeft, ChevronRight, Eye, Download, ImageDown } from 'lucide-react';

const PAGE_SIZE = 15;

export function Tasks() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data: tasksData, isLoading, refetch } = useQuery({
    queryKey: ['tasks', statusFilter],
    queryFn: () => getTasks(statusFilter ? { status: statusFilter } : undefined),
  });

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this task? This cannot be undone.')) {
      await deleteTask(id);
      refetch();
    }
  };

  const handleDownloadImage = async (taskId: string) => {
    try {
      const res = await getTask(taskId);
      const reminders = res?.data?.reminders || [];
      // Find the latest reminder that has an insightImageUrl
      const withImage = reminders
        .filter((r: any) => r.insightImageUrl)
        .sort((a: any, b: any) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime());
      if (withImage.length === 0) {
        alert('No image available for this task.');
        return;
      }
      const imageUrl = withImage[0].insightImageUrl;
      const imageName = withImage[0].insightImageName || 'insight.png';
      // Fetch through the proxy and trigger download
      const response = await fetch(imageUrl);
      if (!response.ok) {
        alert('Image has expired or been deleted.');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = imageName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to download image.');
    }
  };

  const tasks = tasksData?.data || [];
  
  const filteredTasks = tasks.filter((task: any) => 
    task.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
    task.redditUrl.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (task.channelId && task.channelId.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (task.channelName && task.channelName.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const paginatedTasks = filteredTasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const getRowClass = (cancelledReason?: string | null) => {
    if (cancelledReason === 'deleted') return 'bg-red-900/10 hover:bg-red-900/20 transition-colors';
    if (cancelledReason === 'deleted_later') return 'bg-green-900/10 hover:bg-green-900/20 transition-colors';
    return 'hover:bg-dark-800/30 transition-colors';
  };

  const getStatusColor = (status: string, cancelledReason?: string) => {
    switch (status) {
      case 'COMPLETED': return 'bg-green-500/10 text-green-400 border-green-500/20';
      case 'ARCHIVED': return 'bg-dark-500/10 text-dark-400 border-dark-500/20';
      case 'CANCELLED':
        if (cancelledReason === 'deleted' || cancelledReason === 'deleted_later')
          return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'PENDING': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      default: return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-2 w-full">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 transform -translate-y-1/2 text-dark-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search ID or URL..."
            className="w-full h-10 pl-10 pr-3 bg-dark-800/80 border border-dark-700/80 rounded-xl text-sm text-white placeholder-dark-400 focus:outline-none focus:border-primary-500/50 transition-all"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
          />
        </div>

        {/* Filter Icon Button */}
        <div 
          className={`relative flex items-center justify-center w-10 h-10 rounded-xl border shrink-0 transition-all ${
            statusFilter 
              ? 'bg-primary-500/20 border-primary-500/40 text-primary-400' 
              : 'bg-dark-800/80 border-dark-700/80 text-dark-300 hover:border-dark-600 hover:text-white'
          }`}
          title={statusFilter ? `Filter: ${statusFilter}` : "Filter by status"}
        >
          <Filter className="w-4.5 h-4.5" />
          {statusFilter && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary-500 rounded-full ring-2 ring-dark-950" />
          )}
          <select
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="" className="bg-dark-900 text-white">All Statuses</option>
            <option value="PENDING" className="bg-dark-900 text-white">Pending</option>
            <option value="REMINDER_20_SENT" className="bg-dark-900 text-white">20H Sent</option>
            <option value="COMPLETED" className="bg-dark-900 text-white">Completed</option>
            <option value="CANCELLED" className="bg-dark-900 text-white">Cancelled</option>
          </select>
        </div>

        {/* Download Button */}
        <button
          onClick={() => downloadCsv(statusFilter ? { status: statusFilter } : undefined)}
          className="flex items-center justify-center w-10 h-10 rounded-xl bg-dark-800/80 border border-dark-700/80 hover:border-dark-600 text-dark-300 hover:text-white shrink-0 transition-all"
          title="Export CSV"
        >
          <Download className="w-4.5 h-4.5" />
        </button>
      </div>

      {/* Desktop Table (hidden on mobile) */}
      <div className="glass-card overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-dark-700/50 bg-dark-800/50">
                <th className="px-6 py-4 font-semibold text-dark-200">Task ID</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Type</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Status</th>
                <th className="px-6 py-4 font-semibold text-dark-200">URL</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Created</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Ticket</th>
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
                    No tasks found matching your criteria.
                  </td>
                </tr>
              ) : (
                paginatedTasks.map((task: any) => (
                  <tr key={task.id} className={getRowClass(task.cancelledReason)}>
                    <td className="px-6 py-4 font-mono text-sm font-medium text-dark-100">
                      <Link to={`/tasks/${encodeURIComponent(task.id)}`} className="hover:text-primary-400 transition-colors">
                        {task.id}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <select
                        className="input-field px-2 py-1 text-xs appearance-none bg-dark-800 border border-dark-600 rounded-md text-dark-200 cursor-pointer min-w-[100px]"
                        value={task.cancelledReason ?? ''}
                        onChange={async (e) => {
                          const val = e.target.value;
                          await updateTask(task.id, { cancelledReason: val === '' ? null : val });
                          refetch();
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <option value="">OK</option>
                        <option value="deleted">Deleted</option>
                        <option value="deleted_later">Deleted Later</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`status-badge border ${getStatusColor(task.status, task.cancelledReason)}`}>
                        {task.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <a 
                        href={task.redditUrl} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-primary-400 hover:text-primary-300 flex items-center group max-w-[200px] truncate"
                      >
                        <span className="truncate">{task.redditUrl}</span>
                        <ExternalLink className="w-3.5 h-3.5 ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      </a>
                    </td>
                    <td className="px-6 py-4 text-sm text-dark-300">
                      {new Date(task.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-sm text-dark-200 bg-dark-800/50 px-2 py-1 rounded-md border border-dark-700/50">
                        {task.channelName ? `#${task.channelName}` : task.channelId}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleDownloadImage(task.id)}
                          className="p-2 text-dark-400 hover:text-cyan-400 hover:bg-cyan-400/10 rounded-lg transition-colors"
                          title="Download Image"
                        >
                          <ImageDown className="w-4 h-4" />
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
                          className="p-2 text-dark-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
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

      {/* Mobile Card Layout (hidden on desktop) */}
      <div className="md:hidden space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
          </div>
        ) : paginatedTasks.length === 0 ? (
          <div className="glass-card p-8 text-center text-dark-400">
            No tasks found matching your criteria.
          </div>
        ) : (
          paginatedTasks.map((task: any) => {
            const cardStyle = task.cancelledReason === 'deleted'
              ? 'border-red-500/30 bg-red-900/15'
              : task.cancelledReason === 'deleted_later'
              ? 'border-green-500/30 bg-green-900/15'
              : 'border-dark-700/50';

            return (
              <div
                key={task.id}
                className={`glass-card border ${cardStyle} overflow-hidden`}
              >
                {/* Card Header */}
                <div className="flex items-center justify-between px-4 pt-4 pb-2">
                  <Link
                    to={`/tasks/${encodeURIComponent(task.id)}`}
                    className="min-w-0"
                  >
                    <span className="text-primary-400 font-bold font-mono text-base truncate">{task.id}</span>
                  </Link>
                  <span className={`status-badge border text-[10px] ${getStatusColor(task.status, task.cancelledReason)}`}>
                    {task.status.replace(/_/g, ' ')}
                  </span>
                </div>

                {/* Card Body — detail rows */}
                <div className="grid grid-cols-3 gap-1 px-4 py-2 border-t border-dark-700/30">
                  <div>
                    <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider">Task ID</p>
                    <p className="text-dark-200 text-xs font-mono font-medium truncate">{task.id.replace(/^(POST|COMMENT)\s*#?/i, '')}</p>
                  </div>
                  <div>
                    <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider">Created</p>
                    <p className="text-dark-200 text-xs font-medium">
                      {new Date(task.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <div>
                    <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider">Ticket</p>
                    <p className="text-dark-200 text-xs font-mono font-medium truncate">
                      {task.channelName ? `#${task.channelName}` : task.channelId}
                    </p>
                  </div>
                </div>

                {/* Reddit URL */}
                <div className="px-4 py-2">
                  <a
                    href={task.redditUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-400 text-xs flex items-center gap-1 truncate"
                  >
                    <ExternalLink className="w-3 h-3 shrink-0" />
                    <span className="truncate">{task.redditUrl}</span>
                  </a>
                </div>

                {/* Card Footer — Actions */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-dark-700/30 bg-dark-800/30">
                  <select
                    className="bg-dark-800 border border-dark-600 rounded-lg px-2.5 py-1.5 text-xs text-dark-200 cursor-pointer appearance-none"
                    value={task.cancelledReason ?? ''}
                    onChange={async (e) => {
                      const val = e.target.value;
                      await updateTask(task.id, { cancelledReason: val === '' ? null : val });
                      refetch();
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="">OK</option>
                    <option value="deleted">Deleted</option>
                    <option value="deleted_later">Deleted Later</option>
                  </select>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDownloadImage(task.id)}
                      className="p-1.5 text-dark-400 hover:text-cyan-400 hover:bg-cyan-400/10 rounded-lg transition-colors"
                      title="Download Image"
                    >
                      <ImageDown className="w-4 h-4" />
                    </button>
                    <Link
                      to={`/tasks/${encodeURIComponent(task.id)}`}
                      className="p-1.5 text-dark-400 hover:text-primary-400 hover:bg-primary-400/10 rounded-lg transition-colors"
                      title="View Details"
                    >
                      <Eye className="w-4 h-4" />
                    </Link>
                    <button
                      onClick={() => handleDelete(task.id)}
                      className="p-1.5 text-dark-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      title="Delete Task"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-dark-400 text-sm">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredTasks.length)} of {filteredTasks.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 text-dark-400 hover:text-white hover:bg-dark-800 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm text-dark-300 font-medium">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-2 text-dark-400 hover:text-white hover:bg-dark-800 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
