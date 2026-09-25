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
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <WorkerSkeleton className="h-8 w-48" />
        <WorkerSkeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <WorkerSkeleton key={item} className="h-32" />)}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((item) => <WorkerSkeleton key={item} className="h-20" />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
        <WorkerSkeleton className="h-80" />
        <WorkerSkeleton className="h-48" />
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
    { label: 'Total tasks', value: stats.total, icon: ListTodo },
    { label: 'Completed', value: stats.completed, icon: CheckCircle2 },
    { label: 'Paid', value: stats.paid, icon: Wallet },
    { label: 'Insights to submit', value: stats.insightsDue, icon: Eye, attention: stats.insightsDue > 0 },
  ];
  const secondary = [
    { label: 'Awaiting payment', value: stats.awaitingPayment, icon: Wallet },
    { label: 'In progress', value: stats.inProgress, icon: ListTodo },
    { label: 'Failed', value: stats.failed, icon: XCircle },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-sm font-medium text-worker-text-muted">Your work at a glance</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-worker-text sm:text-3xl">Hey, {firstName}</h1>
      </div>

      <section aria-labelledby="home-primary-stats">
        <div className="flex snap-x gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <WorkerCard key={card.label} className={`worker-card-interactive min-w-[148px] snap-start p-4 sm:p-5 md:min-w-0 ${card.attention ? 'border-worker-warning/40' : ''}`}>
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.attention ? 'bg-worker-warning/10 text-worker-warning' : 'bg-worker-accent/10 text-worker-accent'}`}>
                  <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                </div>
                <p className={`mt-4 font-display text-3xl font-bold tabular-nums sm:text-4xl ${card.attention ? 'text-worker-warning' : 'text-worker-text'}`}>
                  {card.value}
                </p>
                <p className="mt-1 text-xs leading-5 text-worker-text-muted sm:text-[13px]">{card.label}</p>
              </WorkerCard>
            );
          })}
        </div>
        <span id="home-primary-stats" className="sr-only">Primary task totals</span>
      </section>

      <section className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Secondary task totals">
        {secondary.map((stat) => {
          const Icon = stat.icon;
          return (
            <WorkerCard key={stat.label} className="p-3 sm:p-4">
              <Icon className="h-4 w-4 text-worker-text-faint" aria-hidden="true" />
              <p className="mt-2 font-display text-xl font-bold tabular-nums text-worker-text sm:text-2xl">{stat.value}</p>
              <p className="mt-1 text-[11px] leading-4 text-worker-text-muted sm:text-xs">{stat.label}</p>
            </WorkerCard>
          );
        })}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)] lg:items-start">
        <section aria-labelledby="action-needed-heading">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-worker-text-muted">Needs a response</p>
              <h2 id="action-needed-heading" className="mt-1 font-display text-lg font-semibold text-worker-text">Action needed</h2>
            </div>
            <Link to="/worker/tasks" className="worker-ghost-button px-2 text-xs">
              View all
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
          {actionNeeded.length === 0 ? (
            <WorkerCard className="p-6">
              <p className="text-sm text-worker-text-muted">Nothing needs your attention right now.</p>
            </WorkerCard>
          ) : (
            <ul className="space-y-3">
              {actionNeeded.map((item: any) => (
                <li key={item.taskId}>
                  <WorkerTaskCard task={item} nowMs={nowMs} variant="action" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-4">
          <WorkerCard className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-worker-text-muted">Wallet snapshot</p>
                <h2 className="mt-1 font-display text-lg font-semibold text-worker-text">This week so far</h2>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-worker-accent/10 text-worker-accent">
                <Wallet className="h-[18px] w-[18px]" aria-hidden="true" />
              </div>
            </div>
            <div className="mt-6 space-y-4">
              <div>
                <p className="text-xs text-worker-text-muted">Earned</p>
                <p className="mt-1 font-display text-3xl font-bold tabular-nums text-worker-text">{formatMoney(snap.thisWeekTotal)}</p>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-worker-border pt-4">
                <span className="text-sm text-worker-text-muted">Awaiting payment</span>
                <span className="font-display text-base font-semibold tabular-nums text-worker-warning">{formatMoney(snap.awaitingEstimated)}</span>
              </div>
            </div>
            <Link to="/worker/wallet" className="worker-ghost-button mt-4 w-full justify-between border-t border-worker-border px-0 pt-4">
              Open Wallet
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </WorkerCard>
        </div>
      </div>

      {/* TODO: proposed follow-up — 7-day activity sparkline, needs new endpoint, confirm with owner */}
    </div>
  );
}
