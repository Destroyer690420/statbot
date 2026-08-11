import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Loader2,
  Users,
  ChevronDown,
  ChevronRight,
  FileText,
  MessageSquare,
} from 'lucide-react';
import { getEligibleTasks, getWorkerDetail, payWorker } from '../../../api/client';
import { formatCurrency } from '../utils';
import { WorkerDetail } from './WorkerDetail';
import { ConfirmPayButton } from './ConfirmPayButton';

interface WorkerBreakdownProps {
  dateParams: Record<string, string> | undefined;
  filterMode: string;
  isCurrentWeek: boolean;
  onInvalidate: () => void;
}

export function WorkerBreakdown({ dateParams, filterMode, isCurrentWeek, onInvalidate }: WorkerBreakdownProps) {
  const [expandedWorker, setExpandedWorker] = useState<string | null>(null);
  const [confirmPayWorker, setConfirmPayWorker] = useState<string | null>(null);

  const eligibleQuery = useQuery({
    queryKey: ['payout-eligible', dateParams],
    queryFn: () => getEligibleTasks(dateParams),
    enabled: filterMode === 'all' || !!dateParams,
  });

  const workerDetailQuery = useQuery({
    queryKey: ['worker-detail', expandedWorker, dateParams],
    queryFn: () => getWorkerDetail(expandedWorker!, dateParams),
    enabled: !!expandedWorker,
  });

  const payWorkerMutation = useMutation({
    mutationFn: (workerId: string) => payWorker(workerId, dateParams),
    onSuccess: () => {
      setConfirmPayWorker(null);
      setExpandedWorker(null);
      onInvalidate();
    },
  });

  const workers = eligibleQuery.data?.data || [];

  return (
    <div className="glass-card overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-dark-700/30">
        <div className="flex items-center justify-between">
          <h3 className="text-base sm:text-lg font-semibold text-white">Worker Breakdown</h3>
          {workers.length > 0 && (
            <span className="text-dark-400 text-xs bg-dark-800/60 px-2.5 py-1 rounded-full">
              {workers.length} worker{workers.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {eligibleQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
          </div>
        ) : workers.length === 0 ? (
          <div className="text-center py-10">
            <Users className="w-10 h-10 text-dark-600 mx-auto mb-2" />
            <p className="text-dark-400 text-sm">No workers found for this period.</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-700/50">
                    <th className="text-left text-dark-400 font-medium py-2.5 px-2">Worker</th>
                    <th className="text-center text-dark-400 font-medium py-2.5 px-2">Posts</th>
                    <th className="text-center text-dark-400 font-medium py-2.5 px-2">Comments</th>
                    <th className="text-right text-dark-400 font-medium py-2.5 px-2">Total</th>
                    <th className="text-center text-dark-400 font-medium py-2.5 px-2">Status</th>
                    {isCurrentWeek && <th className="text-center text-dark-400 font-medium py-2.5 px-2">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {workers.map((w: any) => (
                    <>
                      <tr
                        key={w.workerId}
                        className={`border-b border-dark-800/50 transition-colors cursor-pointer ${
                          expandedWorker === w.workerId ? 'bg-dark-800/40' : 'hover:bg-dark-800/30'
                        }`}
                        onClick={() => setExpandedWorker(expandedWorker === w.workerId ? null : w.workerId)}
                      >
                        <td className="py-3 px-2">
                          <div className="flex items-center gap-2 text-white">
                            {expandedWorker === w.workerId ? (
                              <ChevronDown className="w-4 h-4 text-dark-400 shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-dark-400 shrink-0" />
                            )}
                            <span className="font-medium text-sm">{w.workerName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-2 text-center text-white">{w.posts}</td>
                        <td className="py-3 px-2 text-center text-white">{w.comments}</td>
                        <td className="py-3 px-2 text-right text-white font-semibold">{formatCurrency(w.totalAmount)}</td>
                        <td className="py-3 px-2 text-center">
                          <span className="status-badge bg-green-500/10 text-green-400">Ready</span>
                        </td>
                        {isCurrentWeek && (
                          <td className="py-3 px-2 text-center" onClick={e => e.stopPropagation()}>
                            <ConfirmPayButton
                              label="Pay Worker"
                              isConfirming={confirmPayWorker === w.workerId}
                              isPending={payWorkerMutation.isPending}
                              onStartConfirm={() => setConfirmPayWorker(w.workerId)}
                              onConfirm={() => payWorkerMutation.mutate(w.workerId)}
                              onCancel={() => setConfirmPayWorker(null)}
                            />
                          </td>
                        )}
                      </tr>
                      {/* Inline expansion */}
                      {expandedWorker === w.workerId && (
                        <tr key={`${w.workerId}-detail`}>
                          <td colSpan={isCurrentWeek ? 6 : 5} className="p-0">
                            <div className="border-t border-dark-700/30 bg-dark-900/40 p-4">
                              {workerDetailQuery.isLoading ? (
                                <div className="flex justify-center py-6">
                                  <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
                                </div>
                              ) : workerDetailQuery.data?.data ? (
                                <WorkerDetail data={workerDetailQuery.data.data} />
                              ) : (
                                <p className="text-dark-400 text-center py-4 text-sm">Worker detail not available.</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="lg:hidden space-y-3">
              {workers.map((w: any) => (
                <div key={w.workerId} className="bg-dark-800/30 rounded-xl border border-dark-700/40 overflow-hidden">
                  <button
                    onClick={() => setExpandedWorker(expandedWorker === w.workerId ? null : w.workerId)}
                    className="w-full p-3.5 text-left"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {expandedWorker === w.workerId ? (
                          <ChevronDown className="w-4 h-4 text-dark-400 shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-dark-400 shrink-0" />
                        )}
                        <span className="text-white font-medium text-sm">{w.workerName}</span>
                      </div>
                      <span className="status-badge bg-green-500/10 text-green-400 text-[10px]">Ready</span>
                    </div>
                    <div className="flex items-center justify-between pl-6">
                      <div className="flex items-center gap-3 text-xs text-dark-400">
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3" /> {w.posts}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" /> {w.comments}
                        </span>
                      </div>
                      <span className="text-white font-semibold text-sm">{formatCurrency(w.totalAmount)}</span>
                    </div>
                  </button>

                  {isCurrentWeek && !expandedWorker && (
                    <div className="px-3.5 pb-3 flex justify-end" onClick={e => e.stopPropagation()}>
                      <ConfirmPayButton
                        label="Pay Worker"
                        isConfirming={confirmPayWorker === w.workerId}
                        isPending={payWorkerMutation.isPending}
                        onStartConfirm={() => setConfirmPayWorker(w.workerId)}
                        onConfirm={() => payWorkerMutation.mutate(w.workerId)}
                        onCancel={() => setConfirmPayWorker(null)}
                      />
                    </div>
                  )}

                  {/* Inline expansion for mobile */}
                  {expandedWorker === w.workerId && (
                    <div className="border-t border-dark-700/30 bg-dark-900/40 p-3.5">
                      {isCurrentWeek && (
                        <div className="mb-3 flex justify-end" onClick={e => e.stopPropagation()}>
                          <ConfirmPayButton
                            label="Pay Worker"
                            isConfirming={confirmPayWorker === w.workerId}
                            isPending={payWorkerMutation.isPending}
                            onStartConfirm={() => setConfirmPayWorker(w.workerId)}
                            onConfirm={() => payWorkerMutation.mutate(w.workerId)}
                            onCancel={() => setConfirmPayWorker(null)}
                          />
                        </div>
                      )}
                      {workerDetailQuery.isLoading ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
                        </div>
                      ) : workerDetailQuery.data?.data ? (
                        <WorkerDetail data={workerDetailQuery.data.data} />
                      ) : (
                        <p className="text-dark-400 text-center py-4 text-sm">Worker detail not available.</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {payWorkerMutation.isError && (
          <p className="mt-3 text-red-400 text-sm">{(payWorkerMutation.error as Error).message}</p>
        )}
      </div>
    </div>
  );
}
