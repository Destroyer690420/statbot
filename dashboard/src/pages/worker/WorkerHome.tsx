import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Eye, Hourglass, ListTodo, Wallet, XCircle } from 'lucide-react';
import { getWorkerHome, workerErrorMessage } from '../../api/workerApi';
import { useWorkerAuth } from '../../hooks/useWorkerAuth';
import { formatMoney } from '../../utils/workerFormat';
import { WorkerCard, WorkerErrorState, WorkerSkeleton } from '../../components/worker/WorkerUI';
import { WorkerTaskCard } from '../../components/worker/WorkerTaskCard';

type StatTone = 'accent' | 'success' | 'warning';

const toneTile: Record<StatTone, string> = {
  accent: 'bg-worker-accent/10 text-worker-accent',
  success: 'bg-worker-success/10 text-worker-success',
  warning: 'bg-worker-warning/10 text-worker-warning',
};

interface StatCardData {
  label: string;
  value: number;
  icon: typeof ListTodo;
  tone: StatTone;
  to: string;
}

function StatCard({ card }: { card: StatCardData }) {
  const Icon = card.icon;
  return (
    <Link
      to={card.to}
      className="worker-card worker-card-interactive group flex min-w-0 flex-col p-4 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent focus-visible:ring-offset-2 focus-visible:ring-offset-worker-bg sm:p-5"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${toneTile[card.tone]}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-4 min-w-0 truncate text-[13px] font-medium leading-5 text-worker-text-muted sm:text-sm">{card.label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <span className="font-display text-3xl font-bold tabular-nums leading-none text-worker-text sm:text-4xl">{card.value}</span>
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-worker-border text-worker-text-faint transition-colors duration-150 group-hover:border-worker-accent/40 group-hover:text-worker-accent"
        >
          <ArrowRight className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}

function HomeSkeleton() {
  return (
    <div className="mx-auto min-w-0 w-full max-w-6xl space-y-6">
      <div className="space-y-3">
        <WorkerSkeleton className="h-4 w-40" />
        <WorkerSkeleton className="h-9 w-64 max-w-full" />
        <WorkerSkeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <WorkerSkeleton key={item} className="h-40" />)}
      </div>
      <WorkerSkeleton className="h-28" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <WorkerSkeleton className="h-64" />
        <WorkerSkeleton className="h-72" />
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
  const cards: StatCardData[] = [
    { label: 'Total tasks', value: stats.total, icon: ListTodo, tone: 'accent', to: '/worker/tasks' },
    { label: 'Completed', value: stats.completed, icon: CheckCircle2, tone: 'success', to: '/worker/tasks?tab=completed' },
    { label: 'Paid', value: stats.paid, icon: Wallet, tone: 'accent', to: '/worker/tasks?tab=completed&sub=paid' },
    {
      label: 'Insights to submit',
      value: stats.insightsDue,
      icon: Eye,
      tone: stats.insightsDue > 0 ? 'warning' : 'accent',
      to: '/worker/tasks?tab=todo',
    },
  ];
  const secondary = [
    { label: 'Awaiting payment', value: stats.awaitingPayment, icon: Hourglass, tone: 'text-worker-warning' },
    { label: 'In progress', value: stats.inProgress, icon: ListTodo, tone: 'text-worker-accent' },
    { label: 'Failed', value: stats.failed, icon: XCircle, tone: 'text-worker-danger' },
  ];

  return (
    <div className="mx-auto min-w-0 w-full max-w-6xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-worker-text-muted">Your work at a glance</p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-worker-text sm:text-4xl">
            Hey, {firstName} <span aria-hidden="true">👋</span>
          </h1>
          <p className="mt-1.5 text-sm text-worker-text-muted sm:text-[15px]">Here's what's happening with your tasks and earnings.</p>
        </div>
        <div className="shrink-0 sm:pb-2 sm:text-right">
          <p className="text-sm font-medium text-worker-text-muted">Tasks, insights and payments</p>
          <p className="mt-0.5 text-sm text-worker-text-faint">All in one place.</p>
        </div>
      </header>

      <section aria-label="Task overview">
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
          {cards.map((card) => <StatCard key={card.label} card={card} />)}
        </div>
      </section>

      <section aria-label="Task mix">
        <div className="grid min-w-0 grid-cols-3 divide-x divide-worker-border overflow-hidden rounded-xl border border-worker-border bg-worker-surface">
          {secondary.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="min-w-0 p-4 sm:p-5">
                <Icon className={`h-5 w-5 ${stat.tone}`} aria-hidden="true" />
                <p className="mt-3 min-w-0 truncate text-[13px] font-medium leading-5 text-worker-text-muted sm:text-sm">{stat.label}</p>
                <p className="mt-2 font-display text-2xl font-bold tabular-nums leading-none text-worker-text sm:text-3xl">{stat.value}</p>
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
            <Link to="/worker/tasks?tab=todo" className="worker-ghost-button shrink-0 px-2 text-xs">
              View all
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
          {actionNeeded.length === 0 ? (
            <WorkerCard className="flex items-center gap-4 p-6">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-worker-success/10 text-worker-success">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              </span>
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

        <WorkerCard className="min-w-0">
          <div className="flex flex-col p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-worker-accent/10 text-worker-accent">
                  <Wallet className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="min-w-0 truncate text-sm font-medium text-worker-text-muted">Wallet snapshot</p>
              </div>
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-worker-border text-worker-text-faint"
              >
                <Wallet className="h-4 w-4" />
              </span>
            </div>
            <h2 className="mt-5 font-display text-xl font-semibold text-worker-text">This week so far</h2>
            <p className="mt-2 font-display text-3xl font-bold tabular-nums text-worker-text sm:text-4xl">{formatMoney(snap.thisWeekTotal)}</p>
            <p className="mt-1.5 text-xs text-worker-text-muted">Earned this week</p>
            <div className="mt-7 flex items-center justify-between gap-3">
              <span className="text-sm text-worker-text-muted">Awaiting payment</span>
              <span className="font-display text-base font-semibold tabular-nums text-worker-warning">{formatMoney(snap.awaitingEstimated)}</span>
            </div>
            <Link to="/worker/wallet" className="worker-secondary-button mt-4 w-full">
              View wallet
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </WorkerCard>
      </div>

      {/* TODO: proposed follow-up — 7-day activity sparkline, needs new endpoint, confirm with owner */}
    </div>
  );
}
