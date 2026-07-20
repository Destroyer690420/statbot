import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getTasks, deleteTask, downloadCsv } from '../api/client';
import { Search, Filter, Trash2, ExternalLink, Loader2, ChevronLeft, ChevronRight, Eye, Download } from 'lucide-react';

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

  const tasks = tasksData?.data || [];
  
  const filteredTasks = tasks.filter((task: any) => 
    task.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
    task.redditUrl.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (task.channelId && task.channelId.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (task.channelName && task.channelName.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const paginatedTasks = filteredTasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Tasks</h1>
          <p className="text-dark-400 mt-1">Manage and track all Reddit tasks.</p>
        </div>
        
        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-dark-400" />
            <input
              type="text"
              placeholder="Search ID or URL..."
              className="input-field pl-10 w-full sm:w-64"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
            />
          </div>
          
          <div className="relative">
            <Filter className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-dark-400" />
            <select
              className="input-field pl-10 appearance-none bg-dark-800 pr-8"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="REMINDER_20_SENT">20H Sent</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          <button
            onClick={() => downloadCsv(statusFilter ? { status: statusFilter } : undefined)}
            className="p-2 text-dark-400 hover:text-primary-400 hover:bg-primary-400/10 rounded-lg transition-colors"
            title="Export CSV"
          >
            <Download className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
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
                  <tr key={task.id} className="hover:bg-dark-800/30 transition-colors">
                    <td className="px-6 py-4 font-mono text-sm font-medium text-dark-100">
                      <Link to={`/tasks/${encodeURIComponent(task.id)}`} className="hover:text-primary-400 transition-colors">
                        {task.id}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-dark-700 text-dark-200 border border-dark-600">
                        {task.type}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`status-badge border ${getStatusColor(task.status, task.cancelledReason)}`}>
                        {task.cancelledReason === 'deleted' ? '🗑️ Deleted' :
                         task.cancelledReason === 'deleted_later' ? '🗑️ Deleted Later' :
                         task.status.replace(/_/g, ' ')}
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
