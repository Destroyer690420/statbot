import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { getCommissionBatchDetail } from '../../../api/client';
import { formatCurrency } from '../utils';

function CommissionBatchDetailView({ batchId }: { batchId: string }) {
  const detailQuery = useQuery({
    queryKey: ['commission-batch-detail', batchId],
    queryFn: () => getCommissionBatchDetail(batchId),
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
    <div className="expand-panel border-t border-dark-700/30">
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
        <div className="bg-dark-800/60 rounded-lg p-2.5 border border-dark-700/40">
          <p className="text-dark-400 text-xs">Inviters</p>
          <p className="text-white font-semibold text-sm">{batch?.totalInviters ?? 0}</p>
        </div>
        <div className="bg-dark-800/60 rounded-lg p-2.5 border border-dark-700/40">
          <p className="text-dark-400 text-xs">Bonus</p>
          <p className="text-white font-semibold text-sm">{formatCurrency(totalBonus)}</p>
        </div>
        <div className="bg-dark-800/60 rounded-lg p-2.5 border border-dark-700/40">
          <p className="text-dark-400 text-xs">Per-Task</p>
          <p className="text-white font-semibold text-sm">{formatCurrency(totalPerTask)}</p>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-700/50">
              <th className="text-left text-dark-400 font-medium py-2 px-2">Inviter</th>
              <th className="text-center text-dark-400 font-medium py-2 px-2">Invitee</th>
              <th className="text-right text-dark-400 font-medium py-2 px-2">Bonus</th>
              <th className="text-right text-dark-400 font-medium py-2 px-2">Per-Task</th>
              <th className="text-right text-dark-400 font-medium py-2 px-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any) => (
              <tr key={item.id} className="border-b border-dark-800/50">
                <td className="py-2 px-2 text-white">{item.inviterName}</td>
                <td className="py-2 px-2 text-center text-dark-300">{item.inviteeName}</td>
                <td className="py-2 px-2 text-right text-white">{item.bonusAmount > 0 ? formatCurrency(item.bonusAmount) : '-'}</td>
                <td className="py-2 px-2 text-right text-white">{item.perTaskAmount > 0 ? formatCurrency(item.perTaskAmount) : '-'}</td>
                <td className="py-2 px-2 text-right text-white font-semibold">{formatCurrency(item.totalCommission)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-2">
        {items.map((item: any) => (
          <div key={item.id} className="bg-dark-800/40 rounded-lg p-3 border border-dark-700/30">
            <div className="flex items-center justify-between mb-1">
              <span className="text-white text-sm font-medium">{item.inviterName}</span>
              <span className="text-white font-semibold text-sm">{formatCurrency(item.totalCommission)}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-dark-400">
              <span>→ {item.inviteeName}</span>
              {item.bonusAmount > 0 && <span>Bonus: {formatCurrency(item.bonusAmount)}</span>}
              {item.perTaskAmount > 0 && <span>Per-Task: {formatCurrency(item.perTaskAmount)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export { CommissionBatchDetailView as CommissionBatchDetail };
