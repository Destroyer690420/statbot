import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Eye, Hourglass, ListTodo, Wallet, XCircle } from 'lucide-react';
import { getWorkerHome, workerErrorMessage } from '../../api/workerApi';
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
      className="worker-card worker-card-interactive flex min-w-0 flex-col p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent focus-visible:ring-offset-2 focus-visible:ring-offset-worker-bg"
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneTile[card.tone]}`}>
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <p className="mt-4 min-w-0 truncate text-[13px] font-medium leading-5 text-worker-text-muted">{card.label}</p>
      <span className="mt-2 font-display text-3xl font-bold tabular-nums leading-none text-worker-text">{card.value}</span>
    </Link>
  );
}

function HomeSkeleton() {
  return (
    <div className="mx-auto min-w-0 w-full max-w-3xl space-y-5">
      <WorkerSkeleton className="h-44" />
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((item) => <WorkerSkeleton key={item} className="h-[132px]" />)}
      </div>
      <WorkerSkeleton className="h-28" />
      <div className="space-y-3">
        <WorkerSkeleton className="h-5 w-36" />
        <WorkerSkeleton className="h-24" />
      </div>
    </div>
  );
}

export default function WorkerHome() {
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
  const snap = data.data.walletSnapshot || { awaitingEstimated: 0, lastWeekPaid: 0, lifetimePaid: 0 };
  const cards: StatCardData[] = [
    { label: 'Total tasks', value: stats.total, icon: ListTodo, tone: 'accent', to: '/worker/tasks' },
    { label: 'Completed', value: stats.completed, icon: CheckCircle2, tone: 'success', to: '/worker/tasks?tab=completed' },
    { label: 'Paid', value: stats.paid, icon: Wallet, tone: 'accent', to: '/worker/tasks?tab=completed&sub=paid' },
    { label: 'Insights to submit', value: stats.insightsDue, icon: Eye, tone: 'accent', to: '/worker/tasks?tab=todo' },
  ];
  const secondary = [
    { label: 'Awaiting pay', value: stats.awaitingPayment, icon: Hourglass, tone: 'text-worker-warning' },
    { label: 'In progress', value: stats.inProgress, icon: ListTodo, tone: 'text-worker-accent' },
    { label: 'Failed', value: stats.failed, icon: XCircle, tone: 'text-worker-danger' },
  ];

  return (
    <div className="mx-auto min-w-0 w-full max-w-3xl space-y-5">
      <section aria-label="Payments">
        <WorkerCard className="overflow-hidden border-0 bg-wallet-gradient text-white">
          <div className="flex items-start justify-between gap-4 p-5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white/80">Awaiting payment</p>
              <p className="mt-2 font-display text-3xl font-bold tabular-nums leading-none">~{formatMoney(snap.awaitingEstimated)}</p>
            </div>
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
              <Wallet className="h-5 w-5" />
            </span>
          </div>
          <div className="grid grid-cols-2 border-t border-white/20">
            <div className="min-w-0 border-r border-white/20 px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75">Last week payment</p>
              <p className="mt-1.5 font-display text-base font-bold tabular-nums leading-none">{formatMoney(snap.lastWeekPaid)}</p>
            </div>
            <div className="min-w-0 px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75">Lifetime payment</p>
              <p className="mt-1.5 font-display text-base font-bold tabular-nums leading-none">{formatMoney(snap.lifetimePaid)}</p>
            </div>
          </div>
        </WorkerCard>
      </section>

      <section aria-label="Task overview">
        <div className="grid min-w-0 grid-cols-2 gap-3">
          {cards.map((card) => <StatCard key={card.label} card={card} />)}
        </div>
      </section>

      <section aria-label="Task mix">
        <div className="grid min-w-0 grid-cols-3 divide-x divide-worker-border overflow-hidden rounded-xl border border-worker-border bg-worker-surface">
          {secondary.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="min-w-0 p-4">
                <Icon className={`h-5 w-5 ${stat.tone}`} aria-hidden="true" />
                <p className="mt-3 min-w-0 truncate text-[13px] font-medium leading-5 text-worker-text-muted">{stat.label}</p>
                <p className="mt-1.5 font-display text-2xl font-bold tabular-nums leading-none text-worker-text">{stat.value}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="min-w-0" aria-labelledby="action-needed-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="action-needed-heading" className="font-display text-lg font-semibold text-worker-text">Action needed</h2>
          <Link to="/worker/tasks?tab=todo" className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-worker-accent transition-colors duration-150 hover:text-worker-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent focus-visible:ring-offset-2 focus-visible:ring-offset-worker-bg">
            View all
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        {actionNeeded.length === 0 ? (
          <WorkerCard className="flex min-h-[92px] items-center gap-4 p-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-worker-success/25 bg-worker-success/10 text-worker-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
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

      {/* TODO: proposed follow-up — 7-day activity sparkline, needs new endpoint, confirm with owner */}
    </div>
  );
}
