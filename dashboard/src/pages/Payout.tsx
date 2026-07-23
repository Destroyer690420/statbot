import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Users,
  CheckCircle2,
  IndianRupee,
  Wallet,
  ChevronDown,
  ChevronRight,
  ScrollText,
} from 'lucide-react';
import {
  getPayoutSummary,
  getEligibleTasks,
  getWorkerDetail,
  payWorker,
  payAll,
  getBatchHistory,
  getBatchDetail,
} from '../api/client';

export function Payout() {
  const queryClient = useQueryClient();
  const [expandedWorker, setExpandedWorker] = useState<string | null>(null);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);

  // ─── Queries ──────────────────────────────────────────────

  const summaryQuery = useQuery({
    queryKey: ['payout-summary'],
    queryFn: getPayoutSummary,
  });

  const eligibleQuery = useQuery({
    queryKey: ['payout-eligible'],
    queryFn: getEligibleTasks,
  });

  const historyQuery = useQuery({
    queryKey: ['payout-history'],
    queryFn: () => getBatchHistory(),
  });

  const workerDetailQuery = useQuery({
    queryKey: ['worker-detail', expandedWorker],
    queryFn: () => getWorkerDetail(expandedWorker!),
    enabled: !!expandedWorker,
  });

  // ─── Mutations ─────────────────────────────────────────────

  const payAllMutation = useMutation({
    mutationFn: payAll,
    onSuccess: () => {
      invalidatePayoutQueries();
    },
  });

  const payWorkerMutation = useMutation({
    mutationFn: (workerId: string) => payWorker(workerId),
    onSuccess: () => {
      setExpandedWorker(null);
      invalidatePayoutQueries();
    },
  });

  function invalidatePayoutQueries() {
    queryClient.invalidateQueries({ queryKey: ['payout-summary'] });
    queryClient.invalidateQueries({ queryKey: ['payout-eligible'] });
    queryClient.invalidateQueries({ queryKey: ['payout-history'] });
    queryClient.invalidateQueries({ queryKey: ['worker-detail'] });
  }

  // ─── Loading ───────────────────────────────────────────────

  if (summaryQuery.isLoading || eligibleQuery.isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
      </div>
    );
  }

  const summary = summaryQuery.data?.data;
  const workers = eligibleQuery.data?.data || [];
  const batches = historyQuery.data?.data || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* ─── Dashboard Cards ───────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-dark-400 text-sm font-medium">Workers to Pay</p>
            <Users className="w-5 h-5 text-primary-400" />
          </div>
          <p className="text-3xl font-bold text-white">{summary?.workersToPay ?? 0}</p>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-dark-400 text-sm font-medium">Completed Tasks</p>
            <CheckCircle2 className="w-5 h-5 text-green-400" />
          </div>
          <p className="text-3xl font-bold text-white">{summary?.completedTasks ?? 0}</p>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-dark-400 text-sm font-medium">Pending Amount</p>
            <IndianRupee className="w-5 h-5 text-yellow-400" />
          </div>
          <p className="text-3xl font-bold text-white">₹{summary?.pendingAmount ?? 0}</p>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-dark-400 text-sm font-medium">Already Paid</p>
            <Wallet className="w-5 h-5 text-blue-400" />
          </div>
          <p className="text-3xl font-bold text-white">₹{summary?.alreadyPaid ?? 0}</p>
        </div>
      </div>

      {/* ─── Pay All Section ───────────────────────────────── */}
      {workers.length > 0 && (
        <div className="glass-card p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-white">Weekly Payout</h3>
              <p className="text-dark-400 text-sm mt-1">
                {workers.length} worker{workers.length !== 1 ? 's' : ''} — {summary?.completedTasks ?? 0} task{(summary?.completedTasks ?? 0) !== 1 ? 's' : ''} — ₹{summary?.pendingAmount ?? 0}
              </p>
            </div>
            <button
              onClick={() => payAllMutation.mutate()}
              disabled={payAllMutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              {payAllMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <IndianRupee className="w-4 h-4" />
              )}
              Pay All
            </button>
          </div>
          {payAllMutation.isError && (
            <p className="mt-3 text-red-400 text-sm">{(payAllMutation.error as Error).message}</p>
          )}
          {payAllMutation.isSuccess && (
            <p className="mt-3 text-green-400 text-sm">
              ✅ Paid {payAllMutation.data?.data?.items?.length ?? 0} tasks — Batch #{payAllMutation.data?.data?.batch?.batchNumber}
            </p>
          )}
        </div>
      )}

      {/* ─── Worker Breakdown ──────────────────────────────── */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Worker Breakdown</h3>

        {workers.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-dark-600 mx-auto mb-3" />
            <p className="text-dark-400">No eligible workers for payout this week.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700/50">
                  <th className="text-left text-dark-400 font-medium py-3 px-2">Worker</th>
                  <th className="text-center text-dark-400 font-medium py-3 px-2">Posts</th>
                  <th className="text-center text-dark-400 font-medium py-3 px-2">Comments</th>
                  <th className="text-right text-dark-400 font-medium py-3 px-2">Total (₹)</th>
                  <th className="text-center text-dark-400 font-medium py-3 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((w: any) => (
                  <tr key={w.workerId} className="border-b border-dark-800/50 hover:bg-dark-800/30 transition-colors">
                    <td className="py-3 px-2">
                      <button
                        onClick={() => setExpandedWorker(expandedWorker === w.workerId ? null : w.workerId)}
                        className="flex items-center gap-2 text-white hover:text-primary-400 transition-colors"
                      >
                        {expandedWorker === w.workerId ? (
                          <ChevronDown className="w-4 h-4 text-dark-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-dark-400" />
                        )}
                        <span className="font-mono text-xs bg-dark-700/50 px-2 py-0.5 rounded">{w.workerId.slice(0, 8)}</span>
                      </button>
                    </td>
                    <td className="py-3 px-2 text-center text-white">{w.posts}</td>
                    <td className="py-3 px-2 text-center text-white">{w.comments}</td>
                    <td className="py-3 px-2 text-right text-white font-semibold">₹{w.totalAmount}</td>
                    <td className="py-3 px-2 text-center">
                      <button
                        onClick={() => payWorkerMutation.mutate(w.workerId)}
                        disabled={payWorkerMutation.isPending}
                        className="btn-primary text-xs py-1.5 px-3"
                      >
                        {payWorkerMutation.isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          'Pay Worker'
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Expanded Worker Detail ────────────────────────── */}
      {expandedWorker && (
        <div className="glass-card p-6">
          {workerDetailQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            </div>
          ) : workerDetailQuery.data?.data ? (
            <WorkerDetail data={workerDetailQuery.data.data} />
          ) : (
            <p className="text-dark-400 text-center py-4">Worker detail not available.</p>
          )}
        </div>
      )}

      {/* ─── Payout History ────────────────────────────────── */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Payout History</h3>

        {batches.length === 0 ? (
          <div className="text-center py-8">
            <ScrollText className="w-10 h-10 text-dark-600 mx-auto mb-3" />
            <p className="text-dark-400 text-sm">No payout batches yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {batches.map((batch: any) => (
              <div key={batch.id} className="bg-dark-800/30 rounded-xl border border-dark-700/50 overflow-hidden">
                <button
                  onClick={() => setExpandedBatch(expandedBatch === batch.id ? null : batch.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-dark-800/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {expandedBatch === batch.id ? (
                      <ChevronDown className="w-4 h-4 text-dark-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-dark-400" />
                    )}
                    <span className="text-white font-medium">Batch #{batch.batchNumber}</span>
                    <span className="text-dark-400 text-sm">{batch.weekStart?._seconds ? formatDate(batch.weekStart) : '-'}</span>
                    <span className="text-dark-500">—</span>
                    <span className="text-dark-400 text-sm">{batch.weekEnd?._seconds ? formatDate(batch.weekEnd) : '-'}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-dark-400 text-sm">{batch.totalTasks} tasks</span>
                    <span className="text-white font-semibold">₹{batch.totalAmount}</span>
                  </div>
                </button>

                {expandedBatch === batch.id && (
                  <BatchDetail batchId={batch.id} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Worker Detail Sub-component ───────────────────────────────

function WorkerDetail({ data }: { data: any }) {
  const [showTasks, setShowTasks] = useState(false);

  return (
    <div>
      <h4 className="text-white font-semibold mb-4">Worker Detail</h4>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
          <p className="text-dark-400 text-xs font-medium mb-1">Posts</p>
          <p className="text-white font-bold text-lg">{data.posts}</p>
        </div>
        <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
          <p className="text-dark-400 text-xs font-medium mb-1">Comments</p>
          <p className="text-white font-bold text-lg">{data.comments}</p>
        </div>
        <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
          <p className="text-dark-400 text-xs font-medium mb-1">Completed Tasks</p>
          <p className="text-white font-bold text-lg">{data.tasks?.length ?? 0}</p>
        </div>
        <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
          <p className="text-dark-400 text-xs font-medium mb-1">Total Earnings</p>
          <p className="text-primary-400 font-bold text-lg">₹{data.totalAmount}</p>
        </div>
      </div>

      <div className="space-y-2 mb-4">
        <p className="text-dark-300 text-sm">
          Posts Earnings: <span className="text-white">{data.posts} × ₹60 = ₹{data.postsEarnings}</span>
        </p>
        <p className="text-dark-300 text-sm">
          Comments Earnings: <span className="text-white">{data.comments} × ₹30 = ₹{data.commentsEarnings}</span>
        </p>
      </div>

      <button
        onClick={() => setShowTasks(!showTasks)}
        className="btn-secondary text-xs flex items-center gap-2 mb-3"
      >
        {showTasks ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {showTasks ? 'Hide Tasks' : 'Show Tasks'} ({data.tasks?.length ?? 0})
      </button>

      {showTasks && data.tasks && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-700/50">
                <th className="text-left text-dark-400 font-medium py-2 px-2">Task ID</th>
                <th className="text-center text-dark-400 font-medium py-2 px-2">Type</th>
                <th className="text-right text-dark-400 font-medium py-2 px-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.tasks.map((task: any) => (
                <tr key={task.id} className="border-b border-dark-800/50">
                  <td className="py-2 px-2">
                    <span className="font-mono text-xs text-white">{task.id}</span>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <span className={`status-badge ${task.type === 'POST' ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'}`}>
                      {task.type}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right text-white">₹{task.type === 'POST' ? 60 : 30}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Batch Detail Sub-component ────────────────────────────────

function BatchDetail({ batchId }: { batchId: string }) {
  const detailQuery = useQuery({
    queryKey: ['batch-detail', batchId],
    queryFn: () => getBatchDetail(batchId),
    enabled: true,
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

  const { batch, items } = detail;

  return (
    <div className="px-4 pb-4 border-t border-dark-700/50 pt-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div className="bg-dark-800/50 rounded-lg p-3 border border-dark-700/50">
          <p className="text-dark-400 text-xs">Workers Paid</p>
          <p className="text-white font-semibold">{batch?.totalWorkers ?? 0}</p>
        </div>
        <div className="bg-dark-800/50 rounded-lg p-3 border border-dark-700/50">
          <p className="text-dark-400 text-xs">Tasks Paid</p>
          <p className="text-white font-semibold">{batch?.totalTasks ?? 0}</p>
        </div>
        <div className="bg-dark-800/50 rounded-lg p-3 border border-dark-700/50">
          <p className="text-dark-400 text-xs">Amount Paid</p>
          <p className="text-white font-semibold">₹{batch?.totalAmount ?? 0}</p>
        </div>
        <div className="bg-dark-800/50 rounded-lg p-3 border border-dark-700/50">
          <p className="text-dark-400 text-xs">Paid On</p>
          <p className="text-white font-semibold text-sm">
            {batch?.paidAt?._seconds ? formatDate(batch.paidAt) : 'N/A'}
          </p>
        </div>
      </div>

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
                <td className="py-1.5 px-2 text-white font-mono">{item.taskId}</td>
                <td className="py-1.5 px-2 text-center text-dark-300 font-mono">{item.workerId?.slice(0, 8)}</td>
                <td className="py-1.5 px-2 text-center">
                  <span className={`px-2 py-0.5 rounded-full ${item.taskType === 'POST' ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'}`}>
                    {item.taskType}
                  </span>
                </td>
                <td className="py-1.5 px-2 text-right text-white">₹{item.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────

function formatDate(ts: any): string {
  if (!ts) return '-';
  if (ts._seconds) {
    return new Date(ts._seconds * 1000).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  if (ts instanceof Date) {
    return ts.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return String(ts);
}
