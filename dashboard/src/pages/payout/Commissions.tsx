import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Users,
  UserPlus,
  IndianRupee,
  Wallet,
} from 'lucide-react';
import { getCommissionSummary, getCommissionBreakdown, payAllCommissions } from '../../api/client';
import { formatCurrency } from './utils';
import { SummaryCards } from './components/SummaryCards';
import { PayAllBanner } from './components/PayAllBanner';
import { InviterBreakdown } from './components/InviterBreakdown';
import { CommissionBatchHistory } from './components/CommissionBatchHistory';
import type { PayoutContext } from './PayoutLayout';

export function Commissions() {
  const { dateParams, filterMode, isCurrentWeek } = useOutletContext<PayoutContext>();
  const queryClient = useQueryClient();
  const [confirmPayAll, setConfirmPayAll] = useState(false);

  // ─── Data Queries ─────────────────────────────────────────
  const summaryQuery = useQuery({
    queryKey: ['commission-summary', dateParams],
    queryFn: () => getCommissionSummary(dateParams),
    enabled: filterMode === 'all' || !!dateParams,
  });

  const breakdownQuery = useQuery({
    queryKey: ['commission-breakdown', dateParams],
    queryFn: () => getCommissionBreakdown(dateParams),
    enabled: filterMode === 'all' || !!dateParams,
  });

  // ─── Mutations ────────────────────────────────────────────
  const payAllMutation = useMutation({
    mutationFn: payAllCommissions,
    onSuccess: () => {
      setConfirmPayAll(false);
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

  const summary = summaryQuery.data?.data;
  const inviters = breakdownQuery.data?.data || [];
  const readyInviters = inviters.filter((i: any) => i.status === 'Ready');

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
                <div className="flex items-center gap-3">
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

      {/* Pay All Commissions Banner */}
      {isCurrentWeek && readyInviters.length > 0 && (
        <PayAllBanner
          title="Commission Payout"
          subtitle={`${readyInviters.length} inviter${readyInviters.length !== 1 ? 's' : ''} with unpaid commissions`}
          confirmMessage={`Pay all ${readyInviters.length} inviters?`}
          isConfirming={confirmPayAll}
          setIsConfirming={setConfirmPayAll}
          isPending={payAllMutation.isPending}
          isError={payAllMutation.isError}
          isSuccess={payAllMutation.isSuccess}
          errorMessage={(payAllMutation.error as Error)?.message}
          successContent={
            <span>
              Paid {payAllMutation.data?.data?.invitersPaid ?? 0} inviters — {formatCurrency(payAllMutation.data?.data?.totalAmount ?? 0)}
            </span>
          }
          onConfirm={() => payAllMutation.mutate()}
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
