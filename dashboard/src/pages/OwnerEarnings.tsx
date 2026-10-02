import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, RefreshCw, Lock, ChevronDown, ChevronUp } from 'lucide-react';
import { getDailyEarnings, getWeeklyEarnings, getDailyEarningsHistory } from '../api/client';
import { useState } from 'react';

export function OwnerEarnings() {
  const navigate = useNavigate();
  const [showDeductionsDaily, setShowDeductionsDaily] = useState(false);
  const [showReferralsDaily, setShowReferralsDaily] = useState(false);
  const [showDeductionsWeekly, setShowDeductionsWeekly] = useState(false);
  const [showReferralsWeekly, setShowReferralsWeekly] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

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

  const historyQuery = useQuery({
    queryKey: ['daily-earnings-history', 30],
    queryFn: () => getDailyEarningsHistory(30),
    refetchOnWindowFocus: true,
  });

  const handleRefresh = () => {
    dailyQuery.refetch();
    weeklyQuery.refetch();
    historyQuery.refetch();
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/settings')}
          className="btn bg-dark-800 hover:bg-dark-700 text-dark-300 hover:text-text-primary border border-dark-700 rounded-xl px-4 py-2 flex items-center gap-2 transition-all text-sm"
        >
          <Lock className="w-4 h-4" />
          Lock Panel
        </button>
        <button
          onClick={handleRefresh}
          disabled={dailyQuery.isRefetching || weeklyQuery.isRefetching || historyQuery.isRefetching}
          className="btn bg-dark-800 hover:bg-dark-700 text-dark-300 hover:text-text-primary border border-dark-700 rounded-xl px-4 py-2 flex items-center gap-2 transition-all text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${dailyQuery.isRefetching || weeklyQuery.isRefetching || historyQuery.isRefetching ? 'animate-spin' : ''}`} />
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

      {/* Last 30 Days toggle */}
      <div className="glass-card p-6">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-1 text-primary-400 text-sm font-semibold hover:text-text-primary transition-colors"
        >
          {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          Last 30 Days
        </button>

        {showHistory && (
          <div className="mt-4">
            {historyQuery.isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
              </div>
            ) : historyQuery.isError ? (
              <p className="text-danger text-sm">Failed to load earnings history.</p>
            ) : (
              <HistoryTable rows={(historyQuery.data as any)?.data?.rows} />
            )}
          </div>
        )}
      </div>

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
    <div className="glass-card p-6">
      <h3 className="text-lg font-semibold text-primary-400 mb-4">{title}</h3>

      {query.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
        </div>
      ) : query.isError ? (
        <p className="text-danger text-sm">Failed to load earnings.</p>
      ) : s ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Tasks" value={s.totalTasks} sub={`${s.posts} posts, ${s.comments} comments`} />
            <StatCard label="Revenue" value={`₹${s.totalRevenue}`} color="text-success" />
            <StatCard label="Worker Cost" value={`-₹${s.totalWorkerCost}`} color="text-danger" />
            <StatCard label="Net Earnings" value={`₹${s.totalEarnings}`} color={s.totalEarnings >= 0 ? 'text-success' : 'text-danger'} />
          </div>

          {/* Deductions toggle */}
          {(s.totalSpecialPerTaskComm > 0 || s.totalNormalBonuses > 0 || s.totalSpecialBonuses > 0) && (
            <div>
              <button
                onClick={() => setShowDeductions(!showDeductions)}
                className="flex items-center gap-1 text-dark-400 text-xs font-semibold uppercase tracking-wider hover:text-text-primary transition-colors"
              >
                {showDeductions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                Deductions {s.totalSpecialPerTaskComm + s.totalNormalBonuses + s.totalSpecialBonuses > 0 && `(₹${s.totalSpecialPerTaskComm + s.totalNormalBonuses + s.totalSpecialBonuses})`}
              </button>
              {showDeductions && (
                <div className="mt-2 bg-dark-800/50 rounded-xl p-4 border border-dark-700/50 space-y-1.5">
                  {s.totalSpecialPerTaskComm > 0 && (
                    <p className="text-sm text-dark-300 flex justify-between">
                      <span>Special inviter per-task commission</span>
                      <span className="text-danger">-₹{s.totalSpecialPerTaskComm}</span>
                    </p>
                  )}
                  {s.totalNormalBonuses > 0 && (
                    <p className="text-sm text-dark-300 flex justify-between">
                      <span>Normal inviter one-time bonus{data.referralDeductions.filter((r: any) => r.amount > 0 && r.inviterType === 'normal').length > 1 ? 'es' : ''}</span>
                      <span className="text-danger">-₹{s.totalNormalBonuses}</span>
                    </p>
                  )}
                  {s.totalSpecialBonuses > 0 && (
                    <p className="text-sm text-dark-300 flex justify-between">
                      <span>Special inviter one-time bonus{data.referralDeductions.filter((r: any) => r.amount > 0 && r.inviterType === 'special').length > 1 ? 'es' : ''}</span>
                      <span className="text-danger">-₹{s.totalSpecialBonuses}</span>
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
                className="flex items-center gap-1 text-dark-400 text-xs font-semibold uppercase tracking-wider hover:text-text-primary transition-colors"
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
                          r.inviterType === 'special' ? 'bg-info-muted text-info' : 'bg-info-muted text-info'
                        }`}>
                          {r.inviterType}
                        </span>
                      </span>
                      <span className={r.alreadyPaid ? 'text-dark-500' : 'text-danger'}>
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
      <p className={`text-lg font-semibold font-mono ${color || 'text-text-primary'}`}>{value}</p>
      {sub && <p className="text-dark-500 text-[10px] mt-0.5">{sub}</p>}
    </div>
  );
}

function HistoryTable({ rows }: { rows: any[] }) {
  if (!rows || rows.length === 0) {
    return <p className="text-dark-400 text-sm">No earnings data for the last 30 days.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-dark-400 text-xs font-semibold uppercase tracking-wider border-b border-dark-700/50">
            <th className="text-left py-2 px-2">Date</th>
            <th className="text-right py-2 px-2">Revenue</th>
            <th className="text-right py-2 px-2">Worker Cost</th>
            <th className="text-right py-2 px-2">Commission</th>
            <th className="text-right py-2 px-2">Earning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any) => {
            const s = row?.summary;
            const commission = (s?.totalSpecialPerTaskComm || 0) + (s?.totalNormalBonuses || 0) + (s?.totalSpecialBonuses || 0);
            return (
              <tr key={row.date} className="border-b border-dark-700/30 hover:bg-dark-800/40 transition-colors">
                <td className="py-2 px-2 text-dark-300 font-mono">{row.date}</td>
                <td className="py-2 px-2 text-right text-success font-mono">₹{s?.totalRevenue ?? 0}</td>
                <td className="py-2 px-2 text-right text-danger font-mono">-₹{s?.totalWorkerCost ?? 0}</td>
                <td className="py-2 px-2 text-right text-danger font-mono">-₹{commission}</td>
                <td className="py-2 px-2 text-right font-mono font-semibold text-text-primary">
                  ₹{s?.totalEarnings ?? 0}
                </td>
              </tr>
            );
          }).reverse()}
        </tbody>
      </table>
    </div>
  );
}
