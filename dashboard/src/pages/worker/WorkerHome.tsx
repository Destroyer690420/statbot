import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getWorkerHome, workerErrorMessage } from '../../api/workerApi';
import { useWorkerAuth } from '../../hooks/useWorkerAuth';
import { formatMoney, countdownText } from '../../utils/workerFormat';

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="h-20 glass-card animate-pulse" />
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 glass-card animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export default function WorkerHome() {
  const { workerName } = useWorkerAuth();
  const [nowMs, setNowMs] = useState(Date.now());
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['worker-home'],
    queryFn: getWorkerHome,
    refetchInterval: 60000,
  });

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  if (isLoading) return <Skeleton />;
  if (isError || !data?.success) {
    return (
      <div className="glass-card p-6 text-center space-y-3">
        <p className="text-sm text-red-400">{workerErrorMessage(data, 'Could not load your stats.')}</p>
        <button onClick={() => refetch()} className="btn-secondary min-h-[44px]">
          Retry
        </button>
      </div>
    );
  }

  const stats = data.data.stats;
  const actionNeeded = data.data.actionNeeded || [];
  const snap = data.data.walletSnapshot || { thisWeekTotal: 0, awaitingEstimated: 0, lifetimePaid: 0 };

  const cards = [
    { label: 'Total tasks', value: stats.total },
    { label: 'Completed', value: stats.completed },
    { label: 'Paid', value: stats.paid },
    { label: 'Insights to submit', value: stats.insightsDue, alert: stats.insightsDue > 0 },
  ];
  const secondary = [
    { label: 'Awaiting payment', value: stats.awaitingPayment },
    { label: 'In progress', value: stats.inProgress },
    { label: 'Failed', value: stats.failed },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-white">Hi, {workerName || 'Worker'}</h1>

      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="glass-card p-4">
            <p className={`text-2xl font-extrabold ${c.alert ? 'text-yellow-400' : 'text-white'}`}>{c.value}</p>
            <p className="text-xs text-dark-400 mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {secondary.map((c) => (
          <div key={c.label} className="glass-card p-3">
            <p className="text-lg font-bold text-white">{c.value}</p>
            <p className="text-[11px] text-dark-400 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-white">Action needed</h2>
          <Link to="/worker/tasks" className="text-xs text-primary-400">
            View all
          </Link>
        </div>
        {actionNeeded.length === 0 ? (
          <p className="text-sm text-dark-400">Nothing needs you right now. Nice work.</p>
        ) : (
          <ul className="space-y-2">
            {actionNeeded.map((a: { taskId: string; displayId: string; action: string; dueAt: string | null; overdue: boolean }) => (
              <li key={a.taskId}>
                <Link
                  to={`/worker/tasks/${encodeURIComponent(a.taskId)}`}
                  className="block rounded-xl border border-dark-700 bg-dark-800/60 px-3 py-2.5 min-h-[44px]"
                >
                  <p className="text-sm font-medium text-white">{a.displayId}</p>
                  <p className="text-xs text-dark-300 mt-0.5">{a.action}</p>
                  {a.dueAt && (
                    <p className={`text-xs mt-0.5 ${a.overdue ? 'text-red-400 font-semibold' : 'text-dark-400'}`}>
                      {countdownText(nowMs, a.dueAt)}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Link to="/worker/wallet" className="block glass-card p-4">
        <h2 className="font-semibold text-white mb-2">Wallet snapshot</h2>
        <div className="flex justify-between text-sm">
          <span className="text-dark-400">Earned this week</span>
          <span className="font-bold text-white">{formatMoney(snap.thisWeekTotal)}</span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="text-dark-400">Awaiting payment</span>
          <span className="font-bold text-white">{formatMoney(snap.awaitingEstimated)}</span>
        </div>
        <p className="text-xs text-primary-400 mt-2">Open Wallet →</p>
      </Link>
    </div>
  );
}
