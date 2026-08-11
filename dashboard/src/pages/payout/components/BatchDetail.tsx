import { useQuery } from '@tanstack/react-query';
import { Loader2, Download } from 'lucide-react';
import { getBatchDetail, downloadPayoutCsv } from '../../../api/client';
import { formatDate, formatCurrency } from '../utils';
import { displayTaskId } from '../../../utils/taskDisplay';

// ─── BatchDetail (expanded view inside accordion) ──────────────

export function BatchDetail({ batchId }: { batchId: string }) {
  const detailQuery = useQuery({
    queryKey: ['batch-detail', batchId],
    queryFn: () => getBatchDetail(batchId),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
      </div>
    );
  }

  const detail = detailQuery.data?.data;
  if (!detail) return null;

  const { batch, items, workerNames } = detail;

  // Group items by worker
  const workerGroups: Record<string, { posts: number; comments: number; amount: number; items: any[] }> = {};
  for (const item of (items ?? [])) {
    if (!workerGroups[item.workerId]) {
      workerGroups[item.workerId] = { posts: 0, comments: 0, amount: 0, items: [] };
    }
    const group = workerGroups[item.workerId];
    if (item.taskType === 'POST') group.posts++;
    else group.comments++;
    group.amount += item.amount;
    group.items.push(item);
  }

  const handleBatchExport = () => {
    downloadPayoutCsv({ batchId }).catch(() => {});
  };

  return (
    <div className="expand-panel border-t border-dark-700/30">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
          <div className="bg-dark-800/60 rounded-lg p-2.5 border border-dark-700/40">
            <p className="text-dark-400 text-xs">Workers</p>
            <p className="text-white font-semibold text-sm">{batch?.totalWorkers ?? 0}</p>
          </div>
          <div className="bg-dark-800/60 rounded-lg p-2.5 border border-dark-700/40">
            <p className="text-dark-400 text-xs">Tasks</p>
            <p className="text-white font-semibold text-sm">{batch?.totalTasks ?? 0}</p>
          </div>
          <div className="bg-dark-800/60 rounded-lg p-2.5 border border-dark-700/40">
            <p className="text-dark-400 text-xs">Amount</p>
            <p className="text-white font-semibold text-sm">{formatCurrency(batch?.totalAmount ?? 0)}</p>
          </div>
          <div className="bg-dark-800/60 rounded-lg p-2.5 border border-dark-700/40">
            <p className="text-dark-400 text-xs">Paid On</p>
            <p className="text-white font-semibold text-xs">{formatDate(batch?.paidAt)}</p>
          </div>
        </div>
        <button
          onClick={handleBatchExport}
          className="btn-secondary text-xs flex items-center gap-1.5 py-1.5 px-3 shrink-0 self-start sm:self-center"
        >
          <Download className="w-3.5 h-3.5" />
          CSV
        </button>
      </div>

      {/* Worker summary cards */}
      <p className="text-dark-400 text-xs font-medium mb-2">Workers ({Object.keys(workerGroups).length})</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        {Object.entries(workerGroups).map(([wId, group]) => (
          <div key={wId} className="bg-dark-800/30 rounded-lg p-2.5 border border-dark-700/30">
            <div className="flex items-center justify-between">
              <span className="text-white text-sm font-medium">{(workerNames || {})[wId] || wId.slice(0, 8)}</span>
              <span className="text-white font-semibold text-sm">{formatCurrency(group.amount)}</span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-dark-400 text-xs">
              <span>{group.posts} posts</span>
              <span>{group.comments} comments</span>
              <span>{group.items.length} tasks</span>
            </div>
          </div>
        ))}
      </div>

      {/* Task list */}
      <p className="text-dark-400 text-xs font-medium mb-2">Tasks ({items?.length ?? 0})</p>
      <div className="overflow-x-auto max-h-48 overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-dark-700/50">
              <th className="text-left text-dark-400 font-medium py-1.5 px-2">Task ID</th>
              <th className="text-center text-dark-400 font-medium py-1.5 px-2">Worker</th>
              <th className="text-center text-dark-400 font-medium py-1.5 px-2">Type</th>
              <th className="text-right text-dark-400 font-medium py-1.5 px-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((item: any) => (
              <tr key={item.id} className="border-b border-dark-800/30">
                <td className="py-1.5 px-2 text-white font-mono">{displayTaskId(item.taskId, item.taskType, item.externalTaskId)}</td>
                <td className="py-1.5 px-2 text-center text-dark-300">{(workerNames || {})[item.workerId] || item.workerId?.slice(0, 8)}</td>
                <td className="py-1.5 px-2 text-center">
                  <span className={`px-2 py-0.5 rounded-full ${item.taskType === 'POST' ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'}`}>
                    {item.taskType}
                  </span>
                </td>
                <td className="py-1.5 px-2 text-right text-white">{formatCurrency(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
