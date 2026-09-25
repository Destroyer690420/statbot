import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CheckCircle2, Eye, ListTodo, Wallet, XCircle } from 'lucide-react';
import { getWorkerHome, workerErrorMessage } from '../../api/workerApi';
import { useWorkerAuth } from '../../hooks/useWorkerAuth';
import { formatMoney } from '../../utils/workerFormat';
import { WorkerCard, WorkerErrorState, WorkerSkeleton } from '../../components/worker/WorkerUI';
import { WorkerTaskCard } from '../../components/worker/WorkerTaskCard';

function HomeSkeleton() {
  return (
    <div className="mx-auto min-w-0 max-w-5xl space-y-6">
      <div className="space-y-2">
        <WorkerSkeleton className="h-8 w-48" />
        <WorkerSkeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <WorkerSkeleton key={item} className="h-32" />)}
      </div>
      <WorkerSkeleton className="h-24" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <WorkerSkeleton className="h-64" />
        <WorkerSkeleton className="h-56" />
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
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  if (isLoading) return <HomeSkeleton />;
  if (isError || !data?.success) {
    return <WorkerErrorState message={workerErrorMessage(data, 'Could not load your stats.')} onRetry={() => refetch()} />;
  }

  const stats = data.data.stats;
  const actionNeeded = data.data.actionNeeded || [];
  const snap = data.data.walletSnapshot || { thisWeekTotal: 0, awaitingEstimated: 0, lifetimePaid: 0 };
  const firstName = workerName?.trim().split(/\s+/)[0] || 'Worker';
  const cards = [
    { label: 'Total tasks', value: stats.total, icon: ListTodo, tone: 'accent' },
    { label: 'Completed', value: stats.completed, icon: CheckCircle2, tone: 'success' },
    { label: 'Paid', value: stats.paid, icon: Wallet, tone: 'success' },
    { label: 'Insights to submit', value: stats.insightsDue, icon: Eye, tone: stats.insightsDue > 0 ? 'warning' : 'accent' },
  ];
  const secondary = [
    { label: 'Awaiting payment', value: stats.awaitingPayment, icon: Wallet, tone: 'text-worker-warning' },
    { label: 'In progress', value: stats.inProgress, icon: ListTodo, tone: 'text-worker-accent' },
    { label: 'Failed', value: stats.failed, icon: XCircle, tone: 'text-worker-danger' },
  ];

  return (
    <div className="mx-auto min-w-0 max-w-5xl space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-worker-text-muted">Your work at a glance</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-worker-text sm:text-3xl">Hey, {firstName}</h1>
        </div>
        <p className="text-sm text-worker-text-muted sm:pb-1">Tasks, insights and payments</p>
      </header>

      <section aria-labelledby="home-overview-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="home-overview-heading" className="font-display text-base font-semibold text-worker-text">Overview</h2>
          <span className="text-xs text-worker-text-faint">All time</span>
        </div>
        <div className="grid min-w-0 grid-cols-2 overflow-hidden rounded-xl border border-worker-border bg-worker-surface sm:grid-cols-4">
          {cards.map((card, index) => {
            const Icon = card.icon;
            const isWarning = card.tone === 'warning';
            const isSuccess = card.tone === 'success';
            return (
              <div
                key={card.label}
                className={`min-w-0 p-4 sm:p-5 ${index < 2 ? 'border-b sm:border-b-0' : ''} ${index % 2 === 0 ? 'border-r' : ''} ${index < 3 ? 'sm:border-r' : ''} ${isWarning ? 'bg-worker-warning/5' : ''}`}
              >
                <p className="min-w-0 text-xs font-medium leading-5 text-worker-text-muted sm:text-[13px]">{card.label}</p>
                <div className="mt-4 flex items-end justify-between gap-2 sm:mt-5">
                  <p className={`font-display text-3xl font-bold tabular-nums sm:text-4xl ${isWarning ? 'text-worker-warning' : 'text-worker-text'}`}>
                    {card.value}
                  </p>
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isWarning ? 'bg-worker-warning/10 text-worker-warning' : isSuccess ? 'bg-worker-success/10 text-worker-success' : 'bg-worker-accent/10 text-worker-accent'}`}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label="Secondary task totals">
        <div className="grid min-w-0 grid-cols-3 divide-x divide-worker-border overflow-hidden rounded-xl border border-worker-border bg-worker-surface">
          {secondary.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="min-w-0 p-3 sm:p-4">
                <Icon className={`h-4 w-4 ${stat.tone}`} aria-hidden="true" />
                <p className="mt-2 font-display text-xl font-bold tabular-nums text-worker-text sm:text-2xl">{stat.value}</p>
                <p className="mt-1 text-[11px] leading-4 text-worker-text-muted sm:text-xs">{stat.label}</p>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] lg:items-start">
        <section className="min-w-0" aria-labelledby="action-needed-heading">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-worker-text-muted">Needs a response</p>
              <h2 id="action-needed-heading" className="mt-1 font-display text-lg font-semibold text-worker-text">Action needed</h2>
            </div>
            <Link to="/worker/tasks" className="worker-ghost-button shrink-0 px-2 text-xs">
              View all
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
          {actionNeeded.length === 0 ? (
            <WorkerCard className="flex items-center gap-4 p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-worker-success/10 text-worker-success">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="text-sm leading-6 text-worker-text-muted">Nothing needs your attention right now.</p>
            </WorkerCard>
          ) : (
            <ul className="min-w-0 space-y-3">
              {actionNeeded.map((item: any) => (
                <li key={item.taskId} className="min-w-0">
                  <WorkerTaskCard task={item} nowMs={nowMs} variant="action" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <WorkerCard className="min-w-0 overflow-hidden border-t-2 border-t-worker-accent">
          <div className="border-b border-worker-border p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-worker-text-muted">Wallet snapshot</p>
                <h2 className="mt-1 font-display text-lg font-semibold text-worker-text">This week so far</h2>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-worker-accent/10 text-worker-accent">
                <Wallet className="h-[18px] w-[18px]" aria-hidden="true" />
              </div>
            </div>
            <p className="mt-6 font-display text-3xl font-bold tabular-nums text-worker-text sm:text-4xl">{formatMoney(snap.thisWeekTotal)}</p>
            <p className="mt-1 text-xs text-worker-text-muted">Earned this week</p>
          </div>
          <div className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-worker-text-muted">Awaiting payment</span>
              <span className="font-display text-base font-semibold tabular-nums text-worker-warning">{formatMoney(snap.awaitingEstimated)}</span>
            </div>
            <Link to="/worker/wallet" className="worker-ghost-button mt-4 w-full justify-between border-t border-worker-border px-0 pt-4">
              Open Wallet
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </WorkerCard>
      </div>

      {/* TODO: proposed follow-up — 7-day activity sparkline, needs new endpoint, confirm with owner */}
    </div>
  );
}
