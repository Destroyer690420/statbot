import { useState, useMemo } from 'react';
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
  Download,
  Calendar,
  FileText,
  MessageSquare,
  AlertTriangle,
  X,
  UserPlus,
  RefreshCw,
} from 'lucide-react';
import {
  getPayoutSummary,
  getEligibleTasks,
  getWorkerDetail,
  payWorker,
  payAll,
  getBatchHistory,
  getBatchDetail,
  getPayoutWeek,
  downloadPayoutCsv,
  getCommissionSummary,
  getCommissionBreakdown,
  getInviterDetail,
  payInviter,
  payAllCommissions,
  downloadCommissionCsv,
  getCommissionBatchHistory,
  getCommissionBatchDetail,
  restoreUnpaidArchived,
} from '../api/client';

// ─── Types ─────────────────────────────────────────────────────

type FilterMode = 'all' | 'current' | 'previous' | 'custom';
type PayoutTab = 'tasks' | 'commissions';

// ─── Main Component ────────────────────────────────────────────

export function Payout() {
  const queryClient = useQueryClient();

  // ─── Filter State ─────────────────────────────────────────
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // ─── Expansion State ──────────────────────────────────────
  const [expandedWorker, setExpandedWorker] = useState<string | null>(null);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [expandedCommissionBatch, setExpandedCommissionBatch] = useState<string | null>(null);

  // ─── Confirmation State ───────────────────────────────────
  const [confirmPayAll, setConfirmPayAll] = useState(false);
  const [confirmPayWorker, setConfirmPayWorker] = useState<string | null>(null);

  // ─── Tab State ─────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<PayoutTab>('tasks');

  // ─── Commission State ──────────────────────────────────────
  const [expandedInviter, setExpandedInviter] = useState<string | null>(null);
  const [confirmPayInviter, setConfirmPayInviter] = useState<string | null>(null);
  const [confirmPayAllCommissions, setConfirmPayAllCommissions] = useState(false);

  // ─── Week Info Query ──────────────────────────────────────
  const weekQuery = useQuery({
    queryKey: ['payout-week'],
    queryFn: getPayoutWeek,
  });

  // ─── Date Range Params ────────────────────────────────────
  const dateParams = useMemo((): Record<string, string> | undefined => {
    const weekData = weekQuery.data?.data;

    if (filterMode === 'all') {
      return undefined;
    }
    if (filterMode === 'current' && weekData?.current) {
      return {
        weekStart: weekData.current.weekStart,
        weekEnd: weekData.current.weekEnd,
      };
    }
    if (filterMode === 'previous' && weekData?.previous) {
      return {
        weekStart: weekData.previous.weekStart,
        weekEnd: weekData.previous.weekEnd,
      };
    }
    if (filterMode === 'custom' && customStart && customEnd) {
      return {
        weekStart: new Date(customStart + 'T00:00:00+05:30').toISOString(),
        weekEnd: new Date(customEnd + 'T23:59:59+05:30').toISOString(),
      };
    }
    return undefined;
  }, [filterMode, customStart, customEnd, weekQuery.data]);

  const isCurrentWeek = filterMode === 'all' || filterMode === 'current';

  // ─── Data Queries ─────────────────────────────────────────

  const summaryQuery = useQuery({
    queryKey: ['payout-summary', dateParams],
    queryFn: () => getPayoutSummary(dateParams),
    enabled: filterMode === 'all' || !!dateParams,
  });

  const eligibleQuery = useQuery({
    queryKey: ['payout-eligible', dateParams],
    queryFn: () => getEligibleTasks(dateParams),
    enabled: filterMode === 'all' || !!dateParams,
  });

  const historyQuery = useQuery({
    queryKey: ['payout-history'],
    queryFn: () => getBatchHistory(),
  });

  const workerDetailQuery = useQuery({
    queryKey: ['worker-detail', expandedWorker, dateParams],
    queryFn: () => getWorkerDetail(expandedWorker!, dateParams),
    enabled: !!expandedWorker,
  });

  // ─── Mutations ────────────────────────────────────────────

  const payAllMutation = useMutation({
    mutationFn: payAll,
    onSuccess: () => {
      setConfirmPayAll(false);
      invalidatePayoutQueries();
    },
  });

  const payWorkerMutation = useMutation({
    mutationFn: (workerId: string) => payWorker(workerId),
    onSuccess: () => {
      setConfirmPayWorker(null);
      setExpandedWorker(null);
      invalidatePayoutQueries();
    },
  });

  const restoreMutation = useMutation({
    mutationFn: restoreUnpaidArchived,
    onSuccess: () => {
      invalidatePayoutQueries();
      queryClient.invalidateQueries({ queryKey: ['task-summary'] });
    },
  });

  function invalidatePayoutQueries() {
    queryClient.invalidateQueries({ queryKey: ['payout-summary'] });
    queryClient.invalidateQueries({ queryKey: ['payout-eligible'] });
    queryClient.invalidateQueries({ queryKey: ['payout-history'] });
    queryClient.invalidateQueries({ queryKey: ['worker-detail'] });
  }

  // ─── Commission Queries ───────────────────────────────────

  const commissionSummaryQuery = useQuery({
    queryKey: ['commission-summary', dateParams],
    queryFn: () => getCommissionSummary(dateParams),
    enabled: activeTab === 'commissions' && (filterMode === 'all' || !!dateParams),
  });

  const commissionBreakdownQuery = useQuery({
    queryKey: ['commission-breakdown', dateParams],
    queryFn: () => getCommissionBreakdown(dateParams),
    enabled: activeTab === 'commissions' && (filterMode === 'all' || !!dateParams),
  });

  const commissionHistoryQuery = useQuery({
    queryKey: ['commission-batch-history'],
    queryFn: () => getCommissionBatchHistory(),
    enabled: activeTab === 'commissions',
  });

  const inviterDetailQuery = useQuery({
    queryKey: ['inviter-detail', expandedInviter, dateParams],
    queryFn: () => getInviterDetail(expandedInviter!, dateParams),
    enabled: !!expandedInviter,
  });

  // ─── Commission Mutations ─────────────────────────────────

  const payInviterMutation = useMutation({
    mutationFn: (inviterId: string) => payInviter(inviterId),
    onSuccess: () => {
      setConfirmPayInviter(null);
      setExpandedInviter(null);
      invalidateCommissionQueries();
    },
  });

  const payAllCommissionsMutation = useMutation({
    mutationFn: payAllCommissions,
    onSuccess: () => {
      setConfirmPayAllCommissions(false);
      invalidateCommissionQueries();
    },
  });

  function invalidateCommissionQueries() {
    queryClient.invalidateQueries({ queryKey: ['commission-summary'] });
    queryClient.invalidateQueries({ queryKey: ['commission-breakdown'] });
    queryClient.invalidateQueries({ queryKey: ['commission-batch-history'] });
    queryClient.invalidateQueries({ queryKey: ['commission-batch-detail'] });
    queryClient.invalidateQueries({ queryKey: ['inviter-detail'] });
  }

  // ─── Export Handler ───────────────────────────────────────

  const handleExportCsv = () => {
    downloadPayoutCsv(dateParams).catch(() => {});
  };

  // ─── Computed Data ────────────────────────────────────────

  const summary = summaryQuery.data?.data;
  const workers = eligibleQuery.data?.data || [];
  const batches = historyQuery.data?.data || [];
  const weekData = weekQuery.data?.data;
  const readyWorkers = workers.filter((w: any) => w.status === 'Ready');

  const commissionSummary = commissionSummaryQuery.data?.data;
  const commissionInviters = commissionBreakdownQuery.data?.data || [];
  const readyInviters = commissionInviters.filter((i: any) => i.status === 'Ready');

  const weekLabel = useMemo(() => {
    if (filterMode === 'all') return 'All Unpaid Tasks';
    if (filterMode === 'current' && weekData?.current?.weekLabel) return weekData.current.weekLabel;
    if (filterMode === 'previous' && weekData?.previous?.weekLabel) return weekData.previous.weekLabel;
    if (filterMode === 'custom' && customStart && customEnd) {
      return `${formatSimpleDate(customStart)} — ${formatSimpleDate(customEnd)}`;
    }
    return summary?.weekLabel || '';
  }, [filterMode, weekData, customStart, customEnd, summary]);

  // ─── Loading ──────────────────────────────────────────────

  if (weekQuery.isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* ─── Page Header ─────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Weekly Payout</h2>
          {weekLabel && (
            <p className="text-dark-400 text-sm mt-1 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              {weekLabel}
            </p>
          )}
        </div>
      <div className="flex items-center gap-2">
          <button
            onClick={() => restoreMutation.mutate()}
            disabled={restoreMutation.isPending}
            className={`btn-secondary text-sm flex items-center gap-2 py-2 px-4 ${restoreMutation.isPending ? 'opacity-50' : ''}`}
          >
            <RefreshCw className={`w-4 h-4 ${restoreMutation.isPending ? 'animate-spin' : ''}`} />
            {restoreMutation.isPending ? 'Restoring...' : 'Restore Unpaid'}
          </button>
          <button
            onClick={() => activeTab === 'tasks' ? handleExportCsv() : downloadCommissionCsv(dateParams).catch(() => {})}
            className="btn-secondary text-sm flex items-center gap-2 py-2 px-4"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          {restoreMutation.isSuccess && (
            <span className="text-green-400 text-xs">Restored {restoreMutation.data?.data?.restored} tasks</span>
          )}
          {restoreMutation.isError && (
            <span className="text-red-400 text-xs">{(restoreMutation.error as Error).message}</span>
          )}
        </div>
      </div>

      {/* ─── Tab Navigation ───────────────────────────────────── */}
      <div className="flex gap-2">
        <button
          onClick={() => { setActiveTab('tasks'); setExpandedInviter(null); }}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
            activeTab === 'tasks'
              ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30 shadow-lg shadow-primary-500/10'
              : 'bg-dark-800/50 text-dark-400 border border-dark-700/50 hover:text-white hover:border-dark-500'
          }`}
        >
          <Wallet className="w-4 h-4" />
          Task Payments
        </button>
        <button
          onClick={() => { setActiveTab('commissions'); setExpandedWorker(null); }}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
            activeTab === 'commissions'
              ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30 shadow-lg shadow-primary-500/10'
              : 'bg-dark-800/50 text-dark-400 border border-dark-700/50 hover:text-white hover:border-dark-500'
          }`}
        >
          <UserPlus className="w-4 h-4" />
          Commissions
        </button>
      </div>

      {/* ─── Date Filter ─────────────────────────────────────── */}
      <div className="glass-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => { setFilterMode('all'); setExpandedWorker(null); }}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
              filterMode === 'all'
                ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30'
                : 'bg-dark-800/50 text-dark-400 border border-dark-700/50 hover:text-white hover:border-dark-500'
            }`}
          >
            All
          </button>
          <button
            onClick={() => { setFilterMode('current'); setExpandedWorker(null); }}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
              filterMode === 'current'
                ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30'
                : 'bg-dark-800/50 text-dark-400 border border-dark-700/50 hover:text-white hover:border-dark-500'
            }`}
          >
            Current Week
          </button>
          <button
            onClick={() => { setFilterMode('previous'); setExpandedWorker(null); }}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
              filterMode === 'previous'
                ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30'
                : 'bg-dark-800/50 text-dark-400 border border-dark-700/50 hover:text-white hover:border-dark-500'
            }`}
          >
            Previous Week
          </button>
          <button
            onClick={() => { setFilterMode('custom'); setExpandedWorker(null); }}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
              filterMode === 'custom'
                ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30'
                : 'bg-dark-800/50 text-dark-400 border border-dark-700/50 hover:text-white hover:border-dark-500'
            }`}
          >
            Custom
          </button>

          {filterMode === 'custom' && (
            <div className="flex items-center gap-2 ml-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="input-field text-sm py-1.5 px-3"
              />
              <span className="text-dark-500">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="input-field text-sm py-1.5 px-3"
              />
            </div>
          )}
        </div>
      </div>

      {activeTab === 'tasks' && (
      <>

      {/* ─── Dashboard Cards ─────────────────────────────────── */}
      {summaryQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
        </div>
      ) : (
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
            <div className="flex items-center gap-3 mt-2">
              <span className="text-dark-400 text-xs flex items-center gap-1">
                <FileText className="w-3 h-3" /> {summary?.totalPosts ?? 0} Posts
              </span>
              <span className="text-dark-400 text-xs flex items-center gap-1">
                <MessageSquare className="w-3 h-3" /> {summary?.totalComments ?? 0} Comments
              </span>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-dark-400 text-sm font-medium">Pending Amount</p>
              <IndianRupee className="w-5 h-5 text-yellow-400" />
            </div>
            <p className="text-3xl font-bold text-white">₹{(summary?.pendingAmount ?? 0).toLocaleString('en-IN')}</p>
          </div>

          <div className="stat-card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-dark-400 text-sm font-medium">Already Paid</p>
              <Wallet className="w-5 h-5 text-blue-400" />
            </div>
            <p className="text-3xl font-bold text-white">₹{(summary?.alreadyPaid ?? 0).toLocaleString('en-IN')}</p>
          </div>
        </div>
      )}

      {/* ─── Pay All Section ─────────────────────────────────── */}
      {isCurrentWeek && readyWorkers.length > 0 && (
        <div className="glass-card p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-white">Weekly Payout</h3>
              <p className="text-dark-400 text-sm mt-1">
                {readyWorkers.length} worker{readyWorkers.length !== 1 ? 's' : ''} — {summary?.completedTasks ?? 0} task{(summary?.completedTasks ?? 0) !== 1 ? 's' : ''} — ₹{(summary?.pendingAmount ?? 0).toLocaleString('en-IN')}
              </p>
            </div>

            {!confirmPayAll ? (
              <button
                onClick={() => setConfirmPayAll(true)}
                className="btn-primary flex items-center gap-2"
              >
                <IndianRupee className="w-4 h-4" />
                Pay All
              </button>
            ) : (
              <div className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3">
                <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0" />
                <p className="text-yellow-300 text-sm">Pay all {readyWorkers.length} workers?</p>
                <button
                  onClick={() => payAllMutation.mutate()}
                  disabled={payAllMutation.isPending}
                  className="bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
                >
                  {payAllMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                </button>
                <button
                  onClick={() => setConfirmPayAll(false)}
                  className="text-dark-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
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

      {/* ─── Worker Breakdown ────────────────────────────────── */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Worker Breakdown</h3>

        {eligibleQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
          </div>
        ) : workers.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-dark-600 mx-auto mb-3" />
            <p className="text-dark-400">No workers found for this period.</p>
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
                  <th className="text-center text-dark-400 font-medium py-3 px-2">Status</th>
                  {isCurrentWeek && <th className="text-center text-dark-400 font-medium py-3 px-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {workers.map((w: any) => (
                  <tr
                    key={w.workerId}
                    className={`border-b border-dark-800/50 transition-colors ${
                      expandedWorker === w.workerId ? 'bg-dark-800/40' : 'hover:bg-dark-800/30'
                    }`}
                  >
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
                        <span className="font-medium text-sm">{w.workerName}</span>
                      </button>
                    </td>
                    <td className="py-3 px-2 text-center text-white">{w.posts}</td>
                    <td className="py-3 px-2 text-center text-white">{w.comments}</td>
                    <td className="py-3 px-2 text-right text-white font-semibold">₹{w.totalAmount.toLocaleString('en-IN')}</td>
                    <td className="py-3 px-2 text-center">
                      <span className="status-badge bg-green-500/10 text-green-400">Ready</span>
                    </td>
                    {isCurrentWeek && (
                      <td className="py-3 px-2 text-center">
                        {confirmPayWorker === w.workerId ? (
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => payWorkerMutation.mutate(w.workerId)}
                              disabled={payWorkerMutation.isPending}
                              className="bg-primary-600 hover:bg-primary-500 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors"
                            >
                              {payWorkerMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setConfirmPayWorker(null)}
                              className="text-dark-400 hover:text-white text-xs"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmPayWorker(w.workerId)}
                            className="btn-primary text-xs py-1.5 px-3"
                          >
                            Pay Worker
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {payWorkerMutation.isError && (
          <p className="mt-3 text-red-400 text-sm">{(payWorkerMutation.error as Error).message}</p>
        )}
      </div>

      {/* ─── Expanded Worker Detail ──────────────────────────── */}
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

      {/* ─── Payout History ──────────────────────────────────── */}
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
                    <span className="text-dark-400 text-sm">{formatFirestoreDate(batch.weekStart)}</span>
                    <span className="text-dark-500">—</span>
                    <span className="text-dark-400 text-sm">{formatFirestoreDate(batch.weekEnd)}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-dark-400 text-sm">{batch.totalWorkers} workers</span>
                    <span className="text-dark-400 text-sm">{batch.totalTasks} tasks</span>
                    <span className="text-white font-semibold">₹{(batch.totalAmount ?? 0).toLocaleString('en-IN')}</span>
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
    </>
    )}

    {activeTab === 'commissions' && (
      <CommissionsPanel
        dateParams={dateParams}
        isCurrentWeek={isCurrentWeek}
        commissionSummary={commissionSummary}
        commissionSummaryLoading={commissionSummaryQuery.isLoading}
        commissionInviters={commissionInviters}
        commissionBreakdownLoading={commissionBreakdownQuery.isLoading}
        readyInviters={readyInviters}
        expandedInviter={expandedInviter}
        setExpandedInviter={setExpandedInviter}
        inviterDetailQuery={inviterDetailQuery}
        confirmPayInviter={confirmPayInviter}
        setConfirmPayInviter={setConfirmPayInviter}
        payInviterMutation={payInviterMutation}
        confirmPayAllCommissions={confirmPayAllCommissions}
        setConfirmPayAllCommissions={setConfirmPayAllCommissions}
        payAllCommissionsMutation={payAllCommissionsMutation}
        commissionHistoryQuery={commissionHistoryQuery}
        expandedCommissionBatch={expandedCommissionBatch}
        setExpandedCommissionBatch={setExpandedCommissionBatch}
      />
    )}
    </div>
  );
}

// ─── Worker Detail Sub-component ───────────────────────────────

function WorkerDetail({ data }: { data: any }) {
  const [showTasks, setShowTasks] = useState(true);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-white font-semibold text-lg">{data.workerName}</h4>
        <span className="status-badge bg-green-500/10 text-green-400">Ready</span>
      </div>

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
          <p className="text-primary-400 font-bold text-lg">₹{(data.totalAmount ?? 0).toLocaleString('en-IN')}</p>
        </div>
      </div>

      <div className="space-y-2 mb-4 bg-dark-800/30 rounded-xl p-4 border border-dark-700/30">
        <p className="text-dark-300 text-sm">
          Posts Earnings: <span className="text-white font-medium">{data.posts} × ₹{data.postRate} = ₹{(data.postsEarnings ?? 0).toLocaleString('en-IN')}</span>
        </p>
        <p className="text-dark-300 text-sm">
          Comments Earnings: <span className="text-white font-medium">{data.comments} × ₹{data.commentRate} = ₹{(data.commentsEarnings ?? 0).toLocaleString('en-IN')}</span>
        </p>
        <div className="border-t border-dark-700/50 mt-2 pt-2">
          <p className="text-white text-sm font-semibold">
            Total: ₹{(data.totalAmount ?? 0).toLocaleString('en-IN')}
          </p>
        </div>
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
                <th className="text-center text-dark-400 font-medium py-2 px-2">Completed</th>
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
                  <td className="py-2 px-2 text-center text-dark-300 text-xs">
                    {task.completedAt ? formatISODate(task.completedAt) : '-'}
                  </td>
                  <td className="py-2 px-2 text-right text-white">₹{task.amount}</td>
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
    <div className="px-4 pb-4 border-t border-dark-700/50 pt-3">
      <div className="flex items-center justify-between mb-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
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
            <p className="text-white font-semibold">₹{(batch?.totalAmount ?? 0).toLocaleString('en-IN')}</p>
          </div>
          <div className="bg-dark-800/50 rounded-lg p-3 border border-dark-700/50">
            <p className="text-dark-400 text-xs">Paid On</p>
            <p className="text-white font-semibold text-sm">
              {formatFirestoreDate(batch?.paidAt)}
            </p>
          </div>
        </div>
        <button
          onClick={handleBatchExport}
          className="btn-secondary text-xs flex items-center gap-1.5 py-1.5 px-3 ml-3 shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          CSV
        </button>
      </div>

      {/* Worker-grouped breakdown */}
      <p className="text-dark-400 text-xs font-medium mb-2">Workers ({Object.keys(workerGroups).length})</p>
      <div className="space-y-2 mb-3">
        {Object.entries(workerGroups).map(([wId, group]) => (
          <div key={wId} className="bg-dark-800/30 rounded-lg p-3 border border-dark-700/30">
            <div className="flex items-center justify-between">
              <span className="text-white text-sm font-medium">{(workerNames || {})[wId] || wId.slice(0, 8)}</span>
              <span className="text-white font-semibold text-sm">₹{group.amount.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-dark-400 text-xs">{group.posts} posts</span>
              <span className="text-dark-400 text-xs">{group.comments} comments</span>
              <span className="text-dark-400 text-xs">{group.items.length} tasks</span>
            </div>
          </div>
        ))}
      </div>

      {/* Flat task list */}
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
                <td className="py-1.5 px-2 text-center text-dark-300">{(workerNames || {})[item.workerId] || item.workerId?.slice(0, 8)}</td>
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
// ─── Commissions Panel Sub-component ───────────────────────────

function CommissionsPanel({
  isCurrentWeek,
  commissionSummary,
  commissionSummaryLoading,
  commissionInviters,
  commissionBreakdownLoading,
  readyInviters,
  expandedInviter,
  setExpandedInviter,
  inviterDetailQuery,
  confirmPayInviter,
  setConfirmPayInviter,
  payInviterMutation,
  confirmPayAllCommissions,
  setConfirmPayAllCommissions,
  payAllCommissionsMutation,
  commissionHistoryQuery,
  expandedCommissionBatch,
  setExpandedCommissionBatch,
}: any) {
  return (
    <>
      {/* ─── Commission Summary Cards ──────────────────────────── */}
      {commissionSummaryLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="stat-card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-dark-400 text-sm font-medium">Total Inviters</p>
              <Users className="w-5 h-5 text-primary-400" />
            </div>
            <p className="text-3xl font-bold text-white">{commissionSummary?.totalInviters ?? 0}</p>
          </div>

          <div className="stat-card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-dark-400 text-sm font-medium">Successful Invites</p>
              <UserPlus className="w-5 h-5 text-green-400" />
            </div>
            <p className="text-3xl font-bold text-white">{commissionSummary?.totalSuccessfulInvites ?? 0}</p>
          </div>

          <div className="stat-card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-dark-400 text-sm font-medium">Total Commission</p>
              <IndianRupee className="w-5 h-5 text-yellow-400" />
            </div>
            <p className="text-3xl font-bold text-white">₹{(commissionSummary?.totalCommission ?? 0).toLocaleString('en-IN')}</p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-dark-400 text-xs">
                Bonus: ₹{(commissionSummary?.totalBonusAmount ?? 0).toLocaleString('en-IN')}
              </span>
              <span className="text-dark-400 text-xs">
                Per-task: ₹{(commissionSummary?.totalPerTaskAmount ?? 0).toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-dark-400 text-sm font-medium">Already Paid</p>
              <Wallet className="w-5 h-5 text-blue-400" />
            </div>
            <p className="text-3xl font-bold text-white">₹{(commissionSummary?.alreadyPaidCommission ?? 0).toLocaleString('en-IN')}</p>
          </div>
        </div>
      )}

      {/* ─── Pay All Commissions ───────────────────────────────── */}
      {isCurrentWeek && readyInviters.length > 0 && (
        <div className="glass-card p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-white">Commission Payout</h3>
              <p className="text-dark-400 text-sm mt-1">
                {readyInviters.length} inviter{readyInviters.length !== 1 ? 's' : ''} with unpaid commissions
              </p>
            </div>

            {!confirmPayAllCommissions ? (
              <button
                onClick={() => setConfirmPayAllCommissions(true)}
                className="btn-primary flex items-center gap-2"
              >
                <IndianRupee className="w-4 h-4" />
                Pay All
              </button>
            ) : (
              <div className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3">
                <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0" />
                <p className="text-yellow-300 text-sm">Pay all {readyInviters.length} inviters?</p>
                <button
                  onClick={() => payAllCommissionsMutation.mutate()}
                  disabled={payAllCommissionsMutation.isPending}
                  className="bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
                >
                  {payAllCommissionsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                </button>
                <button
                  onClick={() => setConfirmPayAllCommissions(false)}
                  className="text-dark-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
          {payAllCommissionsMutation.isError && (
            <p className="mt-3 text-red-400 text-sm">{(payAllCommissionsMutation.error as Error).message}</p>
          )}
          {payAllCommissionsMutation.isSuccess && (
            <p className="mt-3 text-green-400 text-sm">
              ✅ Paid {payAllCommissionsMutation.data?.data?.invitersPaid ?? 0} inviters — ₹{(payAllCommissionsMutation.data?.data?.totalAmount ?? 0).toLocaleString('en-IN')}
            </p>
          )}
        </div>
      )}

      {/* ─── Inviter Breakdown Table ───────────────────────────── */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Inviter Breakdown</h3>

        {commissionBreakdownLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
          </div>
        ) : commissionInviters.length === 0 ? (
          <div className="text-center py-12">
            <UserPlus className="w-12 h-12 text-dark-600 mx-auto mb-3" />
            <p className="text-dark-400">No referrals found. Use the <code className="text-primary-400">/referral add</code> bot command to add referrals.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700/50">
                  <th className="text-left text-dark-400 font-medium py-3 px-2">Inviter</th>
                  <th className="text-center text-dark-400 font-medium py-3 px-2">Type</th>
                  <th className="text-center text-dark-400 font-medium py-3 px-2">Referrals</th>
                  <th className="text-center text-dark-400 font-medium py-3 px-2">Active</th>
                  <th className="text-right text-dark-400 font-medium py-3 px-2">Commission (₹)</th>
                  {isCurrentWeek && <th className="text-center text-dark-400 font-medium py-3 px-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {commissionInviters.map((inv: any) => (
                  <tr
                    key={inv.inviterId}
                    className={`border-b border-dark-800/50 transition-colors ${
                      expandedInviter === inv.inviterId ? 'bg-dark-800/40' : 'hover:bg-dark-800/30'
                    }`}
                  >
                    <td className="py-3 px-2">
                      <button
                        onClick={() => setExpandedInviter(expandedInviter === inv.inviterId ? null : inv.inviterId)}
                        className="flex items-center gap-2 text-white hover:text-primary-400 transition-colors"
                      >
                        {expandedInviter === inv.inviterId ? (
                          <ChevronDown className="w-4 h-4 text-dark-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-dark-400" />
                        )}
                        <span className="font-medium text-sm">{inv.inviterName}</span>
                      </button>
                    </td>
                    <td className="py-3 px-2 text-center">
                      <span className={`status-badge ${
                        inv.inviterType === 'special'
                          ? 'bg-yellow-500/10 text-yellow-400'
                          : 'bg-dark-700/50 text-dark-300'
                      }`}>
                        {inv.inviterType === 'special' ? '⭐ Special' : 'Normal'}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-center text-white">{inv.totalReferrals}</td>
                    <td className="py-3 px-2 text-center text-white">{inv.successfulReferrals}</td>
                    <td className="py-3 px-2 text-right text-white font-semibold">₹{inv.totalCommission.toLocaleString('en-IN')}</td>
                    {isCurrentWeek && (
                      <td className="py-3 px-2 text-center">
                        {inv.totalCommission === 0 ? (
                          <span className="text-dark-500 text-xs">—</span>
                        ) : confirmPayInviter === inv.inviterId
                          ? (
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => payInviterMutation.mutate(inv.inviterId)}
                                  disabled={payInviterMutation.isPending}
                                  className="bg-primary-600 hover:bg-primary-500 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors"
                                >
                                  {payInviterMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm'}
                                </button>
                                <button
                                  onClick={() => setConfirmPayInviter(null)}
                                  className="text-dark-400 hover:text-white text-xs"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )
                          : (
                              <button
                                onClick={() => setConfirmPayInviter(inv.inviterId)}
                                className="btn-primary text-xs py-1.5 px-3"
                              >
                                Pay Worker
                              </button>
                            )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {payInviterMutation.isError && (
          <p className="mt-3 text-red-400 text-sm">{(payInviterMutation.error as Error).message}</p>
        )}
      </div>

      {/* ─── Expanded Inviter Detail ───────────────────────────── */}
      {expandedInviter && (
        <div className="glass-card p-6">
          {inviterDetailQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            </div>
          ) : inviterDetailQuery.data?.data ? (
            <InviterDetailView data={inviterDetailQuery.data.data} />
          ) : (
            <p className="text-dark-400 text-center py-4">Inviter detail not available.</p>
          )}
        </div>
      )}

      {/* ─── Commission History ───────────────────────────────── */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Commission History</h3>
        {commissionHistoryQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
          </div>
        ) : (commissionHistoryQuery.data?.data ?? []).length === 0 ? (
          <div className="text-center py-8">
            <ScrollText className="w-10 h-10 text-dark-600 mx-auto mb-3" />
            <p className="text-dark-400 text-sm">No commission batches yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(commissionHistoryQuery.data?.data ?? []).map((batch: any) => (
              <div key={batch.id} className="bg-dark-800/30 rounded-xl border border-dark-700/50 overflow-hidden">
                <button
                  onClick={() => setExpandedCommissionBatch(expandedCommissionBatch === batch.id ? null : batch.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-dark-800/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {expandedCommissionBatch === batch.id ? (
                      <ChevronDown className="w-4 h-4 text-dark-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-dark-400" />
                    )}
                    <span className="text-white font-medium">Batch #{batch.batchNumber}</span>
                    <span className="text-dark-400 text-sm">{formatSimpleDate(batch.weekStart ? batch.weekStart.slice(0,10) : '')}</span>
                    <span className="text-dark-500">—</span>
                    <span className="text-dark-400 text-sm">{formatSimpleDate(batch.weekEnd ? batch.weekEnd.slice(0,10) : '')}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-dark-400 text-sm">{batch.totalInviters} inviters</span>
                    <span className="text-white font-semibold">₹{(batch.totalAmount ?? 0).toLocaleString('en-IN')}</span>
                  </div>
                </button>

                {expandedCommissionBatch === batch.id && (
                  <CommissionBatchDetail batchId={batch.id} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Inviter Detail Sub-component ──────────────────────────────

function InviterDetailView({ data }: { data: any }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h4 className="text-white font-semibold text-lg">{data.inviterName}</h4>
          <span className={`status-badge ${
            data.inviterType === 'special'
              ? 'bg-yellow-500/10 text-yellow-400'
              : 'bg-dark-700/50 text-dark-300'
          }`}>
            {data.inviterType === 'special' ? '⭐ Special' : 'Normal'}
          </span>
        </div>
        <span className={`status-badge ${
          data.status === 'Paid'
            ? 'bg-blue-500/10 text-blue-400'
            : data.status === 'Ready'
            ? 'bg-green-500/10 text-green-400'
            : 'bg-dark-700/50 text-dark-400'
        }`}>
          {data.status}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
          <p className="text-dark-400 text-xs font-medium mb-1">Total Referrals</p>
          <p className="text-white font-bold text-lg">{data.referrals?.length ?? 0}</p>
        </div>
        <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
          <p className="text-dark-400 text-xs font-medium mb-1">Invite Bonus</p>
          <p className="text-white font-bold text-lg">₹{(data.totalBonus ?? 0).toLocaleString('en-IN')}</p>
        </div>
        <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
          <p className="text-dark-400 text-xs font-medium mb-1">Per-Task Commission</p>
          <p className="text-white font-bold text-lg">₹{(data.totalPerTask ?? 0).toLocaleString('en-IN')}</p>
        </div>
        <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
          <p className="text-dark-400 text-xs font-medium mb-1">Total Commission</p>
          <p className="text-primary-400 font-bold text-lg">₹{(data.totalCommission ?? 0).toLocaleString('en-IN')}</p>
        </div>
      </div>

      {/* Referral details */}
      <p className="text-dark-400 text-xs font-medium mb-2">Invited Workers ({data.referrals?.length ?? 0})</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-700/50">
              <th className="text-left text-dark-400 font-medium py-2 px-2">Invitee</th>
              <th className="text-center text-dark-400 font-medium py-2 px-2">Tasks</th>
              <th className="text-center text-dark-400 font-medium py-2 px-2">Posts</th>
              <th className="text-center text-dark-400 font-medium py-2 px-2">Comments</th>
              <th className="text-right text-dark-400 font-medium py-2 px-2">Bonus (₹)</th>
              <th className="text-right text-dark-400 font-medium py-2 px-2">Per-Task (₹)</th>
              <th className="text-center text-dark-400 font-medium py-2 px-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data.referrals ?? []).map((ref: any) => (
              <tr key={ref.referralId} className="border-b border-dark-800/50">
                <td className="py-2 px-2">
                  <span className="text-white text-sm font-medium">{ref.inviteeName}</span>
                </td>
                <td className="py-2 px-2 text-center text-white">{ref.inviteeTasks?.total ?? 0}</td>
                <td className="py-2 px-2 text-center text-dark-300">{ref.inviteeTasks?.posts ?? 0}</td>
                <td className="py-2 px-2 text-center text-dark-300">{ref.inviteeTasks?.comments ?? 0}</td>
                <td className="py-2 px-2 text-right text-white">
                  {ref.bonusAmount > 0 ? `₹${ref.bonusAmount}` : '-'}
                </td>
                <td className="py-2 px-2 text-right text-white">
                  {ref.perTaskAmount > 0 ? `₹${ref.perTaskAmount}` : '-'}
                </td>
                <td className="py-2 px-2 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    ref.isSuccessful
                      ? ref.bonusPaid
                        ? 'bg-blue-500/10 text-blue-400'
                        : 'bg-green-500/10 text-green-400'
                      : 'bg-yellow-500/10 text-yellow-400'
                  }`}>
                    {ref.isSuccessful ? (ref.bonusPaid ? 'Paid' : 'Ready') : 'Pending'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Commission Batch Detail Sub-component ──────────────────────

function CommissionBatchDetail({ batchId }: { batchId: string }) {
  const detailQuery = useQuery({
    queryKey: ['commission-batch-detail', batchId],
    queryFn: () => getCommissionBatchDetail(batchId),
    enabled: true,
  });

  if (detailQuery.isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
      </div>
    );
  }

  const result = detailQuery.data?.data;
  if (!result) {
    return <p className="text-dark-400 text-sm text-center py-4">Batch detail not available.</p>;
  }

  const { batch, items } = result;

  const totalBonus = items.reduce((s: number, i: any) => s + (i.bonusAmount ?? 0), 0);
  const totalPerTask = items.reduce((s: number, i: any) => s + (i.perTaskAmount ?? 0), 0);

  return (
    <div className="p-4 border-t border-dark-700/50">
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-dark-800/50 rounded-lg p-3">
          <p className="text-dark-400 text-xs font-medium mb-1">Inviters</p>
          <p className="text-white font-semibold">{batch?.totalInviters ?? 0}</p>
        </div>
        <div className="bg-dark-800/50 rounded-lg p-3">
          <p className="text-dark-400 text-xs font-medium mb-1">Bonus</p>
          <p className="text-white font-semibold">₹{totalBonus.toLocaleString('en-IN')}</p>
        </div>
        <div className="bg-dark-800/50 rounded-lg p-3">
          <p className="text-dark-400 text-xs font-medium mb-1">Per-Task</p>
          <p className="text-white font-semibold">₹{totalPerTask.toLocaleString('en-IN')}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-700/50">
              <th className="text-left text-dark-400 font-medium py-2 px-2">Inviter</th>
              <th className="text-center text-dark-400 font-medium py-2 px-2">Invitee</th>
              <th className="text-right text-dark-400 font-medium py-2 px-2">Bonus (₹)</th>
              <th className="text-right text-dark-400 font-medium py-2 px-2">Per-Task (₹)</th>
              <th className="text-right text-dark-400 font-medium py-2 px-2">Total (₹)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any) => (
              <tr key={item.id} className="border-b border-dark-800/50">
                <td className="py-2 px-2 text-white">{item.inviterName}</td>
                <td className="py-2 px-2 text-center text-dark-300">{item.inviteeName}</td>
                <td className="py-2 px-2 text-right text-white">{item.bonusAmount > 0 ? `₹${item.bonusAmount}` : '-'}</td>
                <td className="py-2 px-2 text-right text-white">{item.perTaskAmount > 0 ? `₹${item.perTaskAmount}` : '-'}</td>
                <td className="py-2 px-2 text-right text-white font-semibold">₹{item.totalCommission.toLocaleString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────

function formatFirestoreDate(ts: any): string {
  if (!ts) return '-';
  // Handle Firestore serialized timestamps
  if (ts._seconds) {
    return new Date(ts._seconds * 1000).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  // Handle ISO strings
  if (typeof ts === 'string') {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }
  }
  if (ts instanceof Date) {
    return ts.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return String(ts);
}

function formatISODate(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function formatSimpleDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
