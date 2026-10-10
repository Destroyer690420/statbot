import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Users,
  CheckCircle2,
  IndianRupee,
  Wallet,
  FileText,
  MessageSquare,
} from 'lucide-react';
import { getPayoutSummary } from '../../api/client';
import { formatCurrency } from './utils';
import { SummaryCards } from './components/SummaryCards';
import { WorkerBreakdown } from './components/WorkerBreakdown';
import { BatchHistory } from './components/BatchHistory';
import type { PayoutContext } from './PayoutLayout';

export function TaskPayments() {
  const { dateParams, filterMode, isCurrentWeek } = useOutletContext<PayoutContext>();
  const queryClient = useQueryClient();

  // ─── Data Queries ─────────────────────────────────────────
  const summaryQuery = useQuery({
    queryKey: ['payout-summary', dateParams],
    queryFn: () => getPayoutSummary(dateParams),
    enabled: filterMode === 'all' || !!dateParams,
  });

  function invalidatePayoutQueries() {
    queryClient.invalidateQueries({ queryKey: ['payout-summary'] });
    queryClient.invalidateQueries({ queryKey: ['payout-eligible'] });
    queryClient.invalidateQueries({ queryKey: ['payout-history'] });
    queryClient.invalidateQueries({ queryKey: ['worker-detail'] });
  }

  const summary = summaryQuery.data?.data;

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
              icon: <CheckCircle2 className="w-5 h-5 text-success" />,
              accent: 'green',
              subtitle: (
                <div className="flex flex-col gap-1">
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
              icon: <IndianRupee className="w-5 h-5 text-warning" />,
              accent: 'amber',
            },
            {
              label: 'Already Paid',
              value: formatCurrency(summary?.alreadyPaid ?? 0),
              icon: <Wallet className="w-5 h-5 text-info" />,
              accent: 'blue',
            },
          ]}
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
