import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Users,
  CheckCircle2,
  IndianRupee,
  Wallet,
  FileText,
  MessageSquare,
} from 'lucide-react';
import { getPayoutSummary, getEligibleTasks, payAll } from '../../api/client';
import { formatCurrency } from './utils';
import { SummaryCards } from './components/SummaryCards';
import { PayAllBanner } from './components/PayAllBanner';
import { WorkerBreakdown } from './components/WorkerBreakdown';
import { BatchHistory } from './components/BatchHistory';
import type { PayoutContext } from './PayoutLayout';

export function TaskPayments() {
  const { dateParams, filterMode, isCurrentWeek } = useOutletContext<PayoutContext>();
  const queryClient = useQueryClient();
  const [confirmPayAll, setConfirmPayAll] = useState(false);

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

  // ─── Mutations ────────────────────────────────────────────
  const payAllMutation = useMutation({
    mutationFn: () => payAll(dateParams),
    onSuccess: () => {
      setConfirmPayAll(false);
      invalidatePayoutQueries();
    },
  });

  function invalidatePayoutQueries() {
    queryClient.invalidateQueries({ queryKey: ['payout-summary'] });
    queryClient.invalidateQueries({ queryKey: ['payout-eligible'] });
    queryClient.invalidateQueries({ queryKey: ['payout-history'] });
    queryClient.invalidateQueries({ queryKey: ['worker-detail'] });
  }

  const summary = summaryQuery.data?.data;
  const workers = eligibleQuery.data?.data || [];
  const readyWorkers = workers.filter((w: any) => w.status === 'Ready');

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Summary Cards */}
      {summaryQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
        </div>
      ) : (
        <SummaryCards
          cards={[
            {
              label: 'Workers to Pay',
              value: summary?.workersToPay ?? 0,
              icon: <Users className="w-5 h-5 text-primary-400" />,
              accent: 'indigo',
            },
            {
              label: 'Completed Tasks',
              value: summary?.completedTasks ?? 0,
              icon: <CheckCircle2 className="w-5 h-5 text-green-400" />,
              accent: 'green',
              subtitle: (
                <div className="flex items-center gap-3">
                  <span className="text-dark-400 text-xs flex items-center gap-1">
                    <FileText className="w-3 h-3" /> {summary?.totalPosts ?? 0} Posts
                  </span>
                  <span className="text-dark-400 text-xs flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> {summary?.totalComments ?? 0} Comments
                  </span>
                </div>
              ),
            },
            {
              label: 'Pending Amount',
              value: formatCurrency(summary?.pendingAmount ?? 0),
              icon: <IndianRupee className="w-5 h-5 text-yellow-400" />,
              accent: 'amber',
            },
            {
              label: 'Already Paid',
              value: formatCurrency(summary?.alreadyPaid ?? 0),
              icon: <Wallet className="w-5 h-5 text-blue-400" />,
              accent: 'blue',
            },
          ]}
        />
      )}

      {/* Pay All Banner */}
      {isCurrentWeek && readyWorkers.length > 0 && (
        <PayAllBanner
          title="Weekly Payout"
          subtitle={`${readyWorkers.length} worker${readyWorkers.length !== 1 ? 's' : ''} — ${summary?.completedTasks ?? 0} task${(summary?.completedTasks ?? 0) !== 1 ? 's' : ''} — ${formatCurrency(summary?.pendingAmount ?? 0)}`}
          confirmMessage={`Pay all ${readyWorkers.length} workers?`}
          isConfirming={confirmPayAll}
          setIsConfirming={setConfirmPayAll}
          isPending={payAllMutation.isPending}
          isError={payAllMutation.isError}
          isSuccess={payAllMutation.isSuccess}
          errorMessage={(payAllMutation.error as Error)?.message}
          successContent={
            <span>
              ✅ Paid {payAllMutation.data?.data?.items?.length ?? 0} tasks — Batch #{payAllMutation.data?.data?.batch?.batchNumber}
            </span>
          }
          onConfirm={() => payAllMutation.mutate()}
        />
      )}

      {/* Worker Breakdown */}
      <WorkerBreakdown
        dateParams={dateParams}
        filterMode={filterMode}
        isCurrentWeek={isCurrentWeek}
        onInvalidate={invalidatePayoutQueries}
      />

      {/* Payout History (collapsed by default) */}
      <BatchHistory />
    </div>
  );
}
