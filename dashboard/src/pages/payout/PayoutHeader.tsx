import { RefreshCw, Download, Calendar } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { restoreUnpaidArchived, downloadPayoutCsv, downloadCommissionCsv } from '../../api/client';

interface PayoutHeaderProps {
  weekLabel: string;
  dateParams: Record<string, string> | undefined;
  activeRoute: 'tasks' | 'commissions';
}

export function PayoutHeader({ weekLabel, dateParams, activeRoute }: PayoutHeaderProps) {
  const queryClient = useQueryClient();

  const restoreMutation = useMutation({
    mutationFn: restoreUnpaidArchived,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payout-summary'] });
      queryClient.invalidateQueries({ queryKey: ['payout-eligible'] });
      queryClient.invalidateQueries({ queryKey: ['payout-history'] });
      queryClient.invalidateQueries({ queryKey: ['task-summary'] });
    },
  });

  const handleExportCsv = () => {
    if (activeRoute === 'tasks') {
      downloadPayoutCsv(dateParams).catch(() => {});
    } else {
      downloadCommissionCsv(dateParams).catch(() => {});
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-text-primary">Payments</h2>
        {weekLabel && (
          <p className="text-dark-400 text-xs sm:text-sm mt-0.5 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            {weekLabel}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {activeRoute === 'tasks' && (
          <button
            onClick={() => restoreMutation.mutate()}
            disabled={restoreMutation.isPending}
            className={`btn-secondary text-xs flex items-center gap-1.5 py-2 px-3 ${restoreMutation.isPending ? 'opacity-50' : ''}`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${restoreMutation.isPending ? 'animate-spin' : ''}`} />
            {restoreMutation.isPending ? 'Restoring...' : 'Restore Unpaid'}
          </button>
        )}
        <button
          onClick={handleExportCsv}
          className="btn-secondary text-xs flex items-center gap-1.5 py-2 px-3"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
        {restoreMutation.isSuccess && (
          <span className="text-success text-xs">Restored {restoreMutation.data?.data?.restored} tasks</span>
        )}
        {restoreMutation.isError && (
          <span className="text-danger text-xs">{(restoreMutation.error as Error).message}</span>
        )}
      </div>
    </div>
  );
}
