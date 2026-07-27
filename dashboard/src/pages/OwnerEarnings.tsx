import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, RefreshCw, Lock, ChevronDown, ChevronUp } from 'lucide-react';
import { getDailyEarnings, getWeeklyEarnings } from '../api/client';
import { useState } from 'react';

export function OwnerEarnings() {
  const navigate = useNavigate();
  const [showDeductionsDaily, setShowDeductionsDaily] = useState(false);
  const [showReferralsDaily, setShowReferralsDaily] = useState(false);
  const [showDeductionsWeekly, setShowDeductionsWeekly] = useState(false);
  const [showReferralsWeekly, setShowReferralsWeekly] = useState(false);

  const dailyQuery = useQuery({
    queryKey: ['daily-earnings'],
    queryFn: getDailyEarnings,
    refetchOnWindowFocus: true,
  });

  const weeklyQuery = useQuery({
    queryKey: ['weekly-earnings'],
    queryFn: getWeeklyEarnings,
    refetchOnWindowFocus: true,
  });

  const handleRefresh = () => {
    dailyQuery.refetch();
    weeklyQuery.refetch();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-2xl">
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/settings')}
          className="btn bg-dark-800 hover:bg-dark-700 text-dark-300 hover:text-white border border-dark-700 rounded-xl px-4 py-2 flex items-center gap-2 transition-all text-sm"
        >
          <Lock className="w-4 h-4" />
          Lock Panel
        </button>
        <button
          onClick={handleRefresh}
          disabled={dailyQuery.isRefetching || weeklyQuery.isRefetching}
          className="btn bg-dark-800 hover:bg-dark-700 text-dark-300 hover:text-white border border-dark-700 rounded-xl px-4 py-2 flex items-center gap-2 transition-all text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${dailyQuery.isRefetching || weeklyQuery.isRefetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Daily Earnings */}
      <EarningsCard
        title={dailyQuery.data?.data?.date ? `Daily — ${dailyQuery.data.data.date}` : 'Daily'}
        query={dailyQuery}
        showDeductions={showDeductionsDaily}
        setShowDeductions={setShowDeductionsDaily}
        showReferrals={showReferralsDaily}
        setShowReferrals={setShowReferralsDaily}
      />

      {/* Weekly Earnings */}
      <EarningsCard
        title={
          weeklyQuery.data?.data
            ? `Weekly (so far) — ${weeklyQuery.data.data.weekStart} to ${weeklyQuery.data.data.weekEnd}`
            : 'Weekly'
        }
        query={weeklyQuery}
        showDeductions={showDeductionsWeekly}
        setShowDeductions={setShowDeductionsWeekly}
        showReferrals={showReferralsWeekly}
        setShowReferrals={setShowReferralsWeekly}
      />
    </div>
  );
}

function EarningsCard({
  title,
  query,
  showDeductions,
  setShowDeductions,
  showReferrals,
  setShowReferrals,
}: {
  title: string;
  query: ReturnType<typeof useQuery>;
  showDeductions: boolean;
  setShowDeductions: (v: boolean) => void;
  showReferrals: boolean;
  setShowReferrals: (v: boolean) => void;
}) {
  const data = (query.data as any)?.data;
  const s = data?.summary;

  return (
    <div className="glass-card p-6 border-primary-800/30">
      <h3 className="text-lg font-semibold text-primary-400 mb-4">{title}</h3>

      {query.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
        </div>
      ) : query.isError ? (
        <p className="text-red-400 text-sm">Failed to load earnings.</p>
      ) : s ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Tasks" value={s.totalTasks} sub={`${s.posts} posts, ${s.comments} comments`} />
            <StatCard label="Revenue" value={`₹${s.totalRevenue}`} color="text-green-400" />
            <StatCard label="Worker Cost" value={`-₹${s.totalWorkerCost}`} color="text-red-400" />
            <StatCard label="Net Earnings" value={`₹${s.totalEarnings}`} color={s.totalEarnings >= 0 ? 'text-green-400' : 'text-red-400'} />
          </div>

          {/* Deductions toggle */}
          {(s.totalSpecialPerTaskComm > 0 || s.totalNormalBonuses > 0 || s.totalSpecialBonuses > 0) && (
            <div>
              <button
                onClick={() => setShowDeductions(!showDeductions)}
                className="flex items-center gap-1 text-dark-400 text-xs font-semibold uppercase tracking-wider hover:text-white transition-colors"
              >
                {showDeductions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                Deductions {s.totalSpecialPerTaskComm + s.totalNormalBonuses + s.totalSpecialBonuses > 0 && `(₹${s.totalSpecialPerTaskComm + s.totalNormalBonuses + s.totalSpecialBonuses})`}
              </button>
              {showDeductions && (
                <div className="mt-2 bg-dark-800/50 rounded-xl p-4 border border-dark-700/50 space-y-1.5">
                  {s.totalSpecialPerTaskComm > 0 && (
                    <p className="text-sm text-dark-300 flex justify-between">
                      <span>Special inviter per-task commission</span>
                      <span className="text-red-400">-₹{s.totalSpecialPerTaskComm}</span>
                    </p>
                  )}
                  {s.totalNormalBonuses > 0 && (
                    <p className="text-sm text-dark-300 flex justify-between">
                      <span>Normal inviter one-time bonus{data.referralDeductions.filter((r: any) => r.amount > 0 && r.inviterType === 'normal').length > 1 ? 'es' : ''}</span>
                      <span className="text-red-400">-₹{s.totalNormalBonuses}</span>
                    </p>
                  )}
                  {s.totalSpecialBonuses > 0 && (
                    <p className="text-sm text-dark-300 flex justify-between">
                      <span>Special inviter one-time bonus{data.referralDeductions.filter((r: any) => r.amount > 0 && r.inviterType === 'special').length > 1 ? 'es' : ''}</span>
                      <span className="text-red-400">-₹{s.totalSpecialBonuses}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Referral Activity toggle */}
          {data.referralDeductions?.length > 0 && (
            <div>
              <button
                onClick={() => setShowReferrals(!showReferrals)}
                className="flex items-center gap-1 text-dark-400 text-xs font-semibold uppercase tracking-wider hover:text-white transition-colors"
              >
                {showReferrals ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                Referral Activity ({data.referralDeductions.length})
              </button>
              {showReferrals && (
                <div className="mt-2 bg-dark-800/50 rounded-xl p-4 border border-dark-700/50 space-y-1.5 max-h-40 overflow-y-auto">
                  {data.referralDeductions.map((r: any, i: number) => (
                    <p key={i} className="text-xs flex justify-between">
                      <span className="text-dark-400">
                        {r.inviteeName || r.inviteeId.slice(0, 8)}
                        <span className="text-dark-500"> via {r.inviterName || r.inviterId.slice(0, 8)}</span>
                        <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          r.inviterType === 'special' ? 'bg-purple-900/40 text-purple-400' : 'bg-blue-900/40 text-blue-400'
                        }`}>
                          {r.inviterType}
                        </span>
                      </span>
                      <span className={r.alreadyPaid ? 'text-dark-500' : 'text-red-400'}>
                        {r.alreadyPaid ? 'Paid' : r.amount > 0 ? `-₹${r.amount}` : `${r.tasksDone} tasks`}
                      </span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
      <p className="text-dark-400 text-xs font-medium mb-0.5">{label}</p>
      <p className={`text-lg font-semibold font-mono ${color || 'text-white'}`}>{value}</p>
      {sub && <p className="text-dark-500 text-[10px] mt-0.5">{sub}</p>}
    </div>
  );
}
