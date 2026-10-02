import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Loader2,
  UserPlus,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { getCommissionBreakdown, getInviterDetail, payInviter } from '../../../api/client';
import { formatCurrency } from '../utils';
import { InviterDetail } from './InviterDetail';
import { ConfirmPayButton } from './ConfirmPayButton';

interface InviterBreakdownProps {
  dateParams: Record<string, string> | undefined;
  filterMode: string;
  isCurrentWeek: boolean;
  onInvalidate: () => void;
}

export function InviterBreakdown({ dateParams, filterMode, isCurrentWeek, onInvalidate }: InviterBreakdownProps) {
  const [expandedInviter, setExpandedInviter] = useState<string | null>(null);
  const [confirmPayInviter, setConfirmPayInviter] = useState<string | null>(null);

  const breakdownQuery = useQuery({
    queryKey: ['commission-breakdown', dateParams],
    queryFn: () => getCommissionBreakdown(dateParams),
    enabled: filterMode === 'all' || !!dateParams,
  });

  const inviterDetailQuery = useQuery({
    queryKey: ['inviter-detail', expandedInviter, dateParams],
    queryFn: () => getInviterDetail(expandedInviter!, dateParams),
    enabled: !!expandedInviter,
  });

  const payInviterMutation = useMutation({
    mutationFn: (inviterId: string) => payInviter(inviterId),
    onSuccess: () => {
      setConfirmPayInviter(null);
      setExpandedInviter(null);
      onInvalidate();
    },
  });

  const inviters = breakdownQuery.data?.data || [];

  return (
    <div className="glass-card overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-dark-700/30">
        <div className="flex items-center justify-between">
          <h3 className="text-base sm:text-lg font-semibold text-text-primary">Inviter Breakdown</h3>
          {inviters.length > 0 && (
            <span className="text-dark-400 text-xs bg-dark-800/60 px-2.5 py-1 rounded-full">
              {inviters.length} inviter{inviters.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {breakdownQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
          </div>
        ) : inviters.length === 0 ? (
          <div className="text-center py-10">
            <UserPlus className="w-10 h-10 text-text-muted mx-auto mb-2" />
            <p className="text-dark-400 text-sm">No referrals found. Use <code className="text-primary-400 text-xs">/referral add</code> to add referrals.</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-700/50">
                    <th className="text-left text-dark-400 font-medium py-2.5 px-2">Inviter</th>
                    <th className="text-center text-dark-400 font-medium py-2.5 px-2">Type</th>
                    <th className="text-center text-dark-400 font-medium py-2.5 px-2">Referrals</th>
                    <th className="text-center text-dark-400 font-medium py-2.5 px-2">Active</th>
                    <th className="text-right text-dark-400 font-medium py-2.5 px-2">Commission</th>
                    {isCurrentWeek && <th className="text-center text-dark-400 font-medium py-2.5 px-2">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {inviters.map((inv: any) => (
                    <>
                      <tr
                        key={inv.inviterId}
                        className={`border-b border-dark-800/50 transition-colors cursor-pointer ${
                          expandedInviter === inv.inviterId ? 'bg-dark-800/40' : 'hover:bg-dark-800/30'
                        }`}
                        onClick={() => setExpandedInviter(expandedInviter === inv.inviterId ? null : inv.inviterId)}
                      >
                        <td className="py-3 px-2">
                          <div className="flex items-center gap-2 text-text-primary">
                            {expandedInviter === inv.inviterId ? (
                              <ChevronDown className="w-4 h-4 text-dark-400 shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-dark-400 shrink-0" />
                            )}
                            <span className="font-medium text-sm">{inv.inviterName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-2 text-center">
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            inv.inviterType === 'special'
                              ? 'bg-warning-muted text-warning'
                              : 'bg-dark-700/50 text-dark-300'
                          }`}>
                            {inv.inviterType === 'special' ? '⭐ Special' : 'Normal'}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-center text-text-primary">{inv.totalReferrals}</td>
                        <td className="py-3 px-2 text-center text-text-primary">{inv.successfulReferrals}</td>
                        <td className="py-3 px-2 text-right text-text-primary font-semibold">{formatCurrency(inv.totalCommission)}</td>
                        {isCurrentWeek && (
                          <td className="py-3 px-2 text-center" onClick={e => e.stopPropagation()}>
                            {inv.totalCommission === 0 ? (
                              <span className="text-dark-500 text-xs">—</span>
                            ) : (
                              <ConfirmPayButton
                                label="Pay Inviter"
                                isConfirming={confirmPayInviter === inv.inviterId}
                                isPending={payInviterMutation.isPending}
                                onStartConfirm={() => setConfirmPayInviter(inv.inviterId)}
                                onConfirm={() => payInviterMutation.mutate(inv.inviterId)}
                                onCancel={() => setConfirmPayInviter(null)}
                              />
                            )}
                          </td>
                        )}
                      </tr>
                      {/* Inline expansion */}
                      {expandedInviter === inv.inviterId && (
                        <tr key={`${inv.inviterId}-detail`}>
                          <td colSpan={isCurrentWeek ? 6 : 5} className="p-0">
                            <div className="border-t border-dark-700/30 bg-dark-900/40 p-4">
                              {inviterDetailQuery.isLoading ? (
                                <div className="flex justify-center py-6">
                                  <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
                                </div>
                              ) : inviterDetailQuery.data?.data ? (
                                <InviterDetail data={inviterDetailQuery.data.data} />
                              ) : (
                                <p className="text-dark-400 text-center py-4 text-sm">Inviter detail not available.</p>
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
              {inviters.map((inv: any) => (
                <div key={inv.inviterId} className="bg-dark-800/30 rounded-xl border border-dark-700/40 overflow-hidden">
                  <button
                    onClick={() => setExpandedInviter(expandedInviter === inv.inviterId ? null : inv.inviterId)}
                    className="w-full p-3.5 text-left"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        {expandedInviter === inv.inviterId ? (
                          <ChevronDown className="w-4 h-4 text-dark-400 shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-dark-400 shrink-0" />
                        )}
                        <span className="text-text-primary font-medium text-sm">{inv.inviterName}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          inv.inviterType === 'special'
                            ? 'bg-warning-muted text-warning'
                            : 'bg-dark-700/50 text-dark-300'
                        }`}>
                          {inv.inviterType === 'special' ? '⭐' : 'Normal'}
                        </span>
                      </div>
                      <span className="text-text-primary font-semibold text-sm">{formatCurrency(inv.totalCommission)}</span>
                    </div>
                    <div className="flex items-center gap-3 pl-6 text-xs text-dark-400">
                      <span>{inv.totalReferrals} referrals</span>
                      <span>{inv.successfulReferrals} active</span>
                    </div>
                  </button>

                  {isCurrentWeek && inv.totalCommission > 0 && expandedInviter !== inv.inviterId && (
                    <div className="px-3.5 pb-3 flex justify-end" onClick={e => e.stopPropagation()}>
                      <ConfirmPayButton
                        label="Pay Inviter"
                        isConfirming={confirmPayInviter === inv.inviterId}
                        isPending={payInviterMutation.isPending}
                        onStartConfirm={() => setConfirmPayInviter(inv.inviterId)}
                        onConfirm={() => payInviterMutation.mutate(inv.inviterId)}
                        onCancel={() => setConfirmPayInviter(null)}
                      />
                    </div>
                  )}

                  {expandedInviter === inv.inviterId && (
                    <div className="border-t border-dark-700/30 bg-dark-900/40 p-3.5">
                      {isCurrentWeek && inv.totalCommission > 0 && (
                        <div className="mb-3 flex justify-end" onClick={e => e.stopPropagation()}>
                          <ConfirmPayButton
                            label="Pay Inviter"
                            isConfirming={confirmPayInviter === inv.inviterId}
                            isPending={payInviterMutation.isPending}
                            onStartConfirm={() => setConfirmPayInviter(inv.inviterId)}
                            onConfirm={() => payInviterMutation.mutate(inv.inviterId)}
                            onCancel={() => setConfirmPayInviter(null)}
                          />
                        </div>
                      )}
                      {inviterDetailQuery.isLoading ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
                        </div>
                      ) : inviterDetailQuery.data?.data ? (
                        <InviterDetail data={inviterDetailQuery.data.data} />
                      ) : (
                        <p className="text-dark-400 text-center py-4 text-sm">Inviter detail not available.</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {payInviterMutation.isError && (
          <p className="mt-3 text-danger text-sm">{(payInviterMutation.error as Error).message}</p>
        )}
      </div>
    </div>
  );
}
