import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Users,
  UserPlus,
  IndianRupee,
  Wallet,
} from 'lucide-react';
import { getCommissionSummary } from '../../api/client';
import { formatCurrency } from './utils';
import { SummaryCards } from './components/SummaryCards';
import { InviterBreakdown } from './components/InviterBreakdown';
import { CommissionBatchHistory } from './components/CommissionBatchHistory';
import type { PayoutContext } from './PayoutLayout';

export function Commissions() {
  const { dateParams, filterMode, isCurrentWeek } = useOutletContext<PayoutContext>();
  const queryClient = useQueryClient();

  // ─── Data Queries ─────────────────────────────────────────
  const summaryQuery = useQuery({
    queryKey: ['commission-summary', dateParams],
    queryFn: () => getCommissionSummary(dateParams),
    enabled: filterMode === 'all' || !!dateParams,
  });

  function invalidateCommissionQueries() {
    queryClient.invalidateQueries({ queryKey: ['commission-summary'] });
    queryClient.invalidateQueries({ queryKey: ['commission-breakdown'] });
    queryClient.invalidateQueries({ queryKey: ['commission-batch-history'] });
    queryClient.invalidateQueries({ queryKey: ['commission-batch-detail'] });
    queryClient.invalidateQueries({ queryKey: ['inviter-detail'] });
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
              label: 'Total Inviters',
              value: summary?.totalInviters ?? 0,
              icon: <Users className="w-5 h-5 text-primary-400" />,
              accent: 'indigo',
            },
            {
              label: 'Successful Invites',
              value: summary?.totalSuccessfulInvites ?? 0,
              icon: <UserPlus className="w-5 h-5 text-success" />,
              accent: 'green',
            },
            {
              label: 'Total Commission',
              value: formatCurrency(summary?.totalCommission ?? 0),
              icon: <IndianRupee className="w-5 h-5 text-warning" />,
              accent: 'amber',
              subtitle: (
                <div className="flex flex-col gap-1">
                  <span className="text-dark-400 text-xs">
                    Bonus: {formatCurrency(summary?.totalBonusAmount ?? 0)}
                  </span>
                  <span className="text-dark-400 text-xs">
                    Per-task: {formatCurrency(summary?.totalPerTaskAmount ?? 0)}
                  </span>
                </div>
              ),
            },
            {
              label: 'Already Paid',
              value: formatCurrency(summary?.alreadyPaidCommission ?? 0),
              icon: <Wallet className="w-5 h-5 text-info" />,
              accent: 'blue',
            },
          ]}
        />
      )}

      {/* Inviter Breakdown */}
      <InviterBreakdown
        dateParams={dateParams}
        filterMode={filterMode}
        isCurrentWeek={isCurrentWeek}
        onInvalidate={invalidateCommissionQueries}
      />

      {/* Commission History (collapsed by default) */}
      <CommissionBatchHistory />
    </div>
  );
}
