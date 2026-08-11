import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2,
  ScrollText,
  ChevronDown,
  ChevronRight,
  History,
} from 'lucide-react';
import { getCommissionBatchHistory } from '../../../api/client';
import { formatSimpleDate, formatCurrency } from '../utils';
import { CommissionBatchDetail } from './CommissionBatchDetail';

export function CommissionBatchHistory() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);

  const historyQuery = useQuery({
    queryKey: ['commission-batch-history'],
    queryFn: () => getCommissionBatchHistory(),
  });

  const batches = historyQuery.data?.data ?? [];

  return (
    <div className="glass-card overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-dark-800/20 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <History className="w-4 h-4 text-dark-400" />
          <h3 className="text-base sm:text-lg font-semibold text-white">Commission History</h3>
          {batches.length > 0 && (
            <span className="text-dark-400 text-xs bg-dark-800/60 px-2 py-0.5 rounded-full">
              {batches.length}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-dark-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-dark-400" />
        )}
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5 border-t border-dark-700/30">
          {historyQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            </div>
          ) : batches.length === 0 ? (
            <div className="text-center py-8">
              <ScrollText className="w-8 h-8 text-dark-600 mx-auto mb-2" />
              <p className="text-dark-400 text-sm">No commission batches yet.</p>
            </div>
          ) : (
            <div className="space-y-2 mt-3">
              {batches.map((batch: any) => (
                <div key={batch.id} className="bg-dark-800/30 rounded-xl border border-dark-700/40 overflow-hidden">
                  <button
                    onClick={() => setExpandedBatch(expandedBatch === batch.id ? null : batch.id)}
                    className="w-full flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-3.5 hover:bg-dark-800/40 transition-colors gap-1 sm:gap-3"
                  >
                    <div className="flex items-center gap-2">
                      {expandedBatch === batch.id ? (
                        <ChevronDown className="w-3.5 h-3.5 text-dark-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-dark-400 shrink-0" />
                      )}
                      <span className="text-white font-medium text-sm">Batch #{batch.batchNumber}</span>
                      <span className="text-dark-500 text-xs">
                        {formatSimpleDate(batch.weekStart ? batch.weekStart.slice(0, 10) : '')} — {formatSimpleDate(batch.weekEnd ? batch.weekEnd.slice(0, 10) : '')}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 sm:gap-4 pl-6 sm:pl-0">
                      <span className="text-dark-400 text-xs">{batch.totalInviters} inviters</span>
                      <span className="text-white font-semibold text-sm">{formatCurrency(batch.totalAmount ?? 0)}</span>
                    </div>
                  </button>

                  {expandedBatch === batch.id && (
                    <CommissionBatchDetail batchId={batch.id} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
