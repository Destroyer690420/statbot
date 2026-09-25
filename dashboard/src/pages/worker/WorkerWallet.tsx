import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, ChevronDown, Clock3, Info, Wallet } from 'lucide-react';
import { getWorkerWallet, workerErrorMessage } from '../../api/workerApi';
import { formatISTDate, formatMoney } from '../../utils/workerFormat';
import { WorkerCard, WorkerErrorState, WorkerSkeleton } from '../../components/worker/WorkerUI';

function WeekCard({ title, week, current = false }: { title: string; week: any; current?: boolean }) {
  return (
    <WorkerCard className={`p-4 sm:p-5 ${current ? 'border-worker-accent/35' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-worker-text-muted">{title}</p>
          <p className="mt-1 text-xs text-worker-text-faint">{week.weekLabel}</p>
        </div>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${current ? 'bg-worker-accent/10 text-worker-accent' : 'bg-worker-surface-2 text-worker-text-faint'}`}>
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-5 font-display text-2xl font-bold tabular-nums text-worker-text sm:text-3xl">{formatMoney(week.total)}</p>
      <p className="mt-1 text-xs leading-5 text-worker-text-muted">{week.tasks} tasks · {week.posts} posts · {week.comments} comments</p>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-worker-border pt-3 text-xs">
        <span className="text-worker-success">Paid {formatMoney(week.paid)}</span>
        <span className="text-worker-warning">Awaiting ~{formatMoney(week.awaiting)} est.</span>
      </div>
    </WorkerCard>
  );
}

export default function WorkerWallet() {
  const [openBatch, setOpenBatch] = useState<number | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['worker-wallet'],
    queryFn: getWorkerWallet,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <WorkerSkeleton className="h-64 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((item) => <WorkerSkeleton key={item} className="h-48" />)}
        </div>
        <WorkerSkeleton className="h-72 w-full" />
      </div>
    );
  }

  if (isError || !data?.success) {
    return <WorkerErrorState message={workerErrorMessage(data, 'Could not load your wallet.')} onRetry={() => refetch()} />;
  }

  const wallet = data.data;
  const payments = Array.isArray(wallet.payments) ? wallet.payments : [];

  const scrollToHistory = () => {
    const target = document.getElementById('payment-history');
    if (!target) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight text-worker-text sm:text-2xl lg:hidden">Wallet</h1>
        <p className="mt-1 hidden text-sm text-worker-text-muted lg:block">A clear view of completed work, estimated payouts and payment history.</p>
      </div>

      <WorkerCard className="overflow-hidden border-0 bg-wallet-gradient p-6 text-white sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-white/75">Awaiting payment</p>
            <p className="mt-3 font-display text-4xl font-bold tabular-nums sm:text-5xl">~{formatMoney(wallet.awaitingAll.estimated)}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
            <Wallet className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
        <p className="mt-3 text-sm text-white/75">{wallet.awaitingAll.count} tasks · estimated at today&apos;s rates</p>
        <p className="mt-5 max-w-md text-sm leading-6 text-white/80">Paid manually by your manager, usually weekly.</p>
        <button type="button" onClick={scrollToHistory} className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/25 px-3 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
          View payment history
        </button>
      </WorkerCard>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <WeekCard title="This week" week={wallet.thisWeek} current />
        <WeekCard title="Last week" week={wallet.lastWeek} />
        <WorkerCard className="p-4 sm:col-span-2 sm:p-5 lg:col-span-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-worker-text-muted">Lifetime paid</p>
              <p className="mt-1 text-xs text-worker-text-faint">All recorded payments</p>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-worker-success/10 text-worker-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
          <p className="mt-5 font-display text-2xl font-bold tabular-nums text-worker-success sm:text-3xl">{formatMoney(wallet.lifetimePaid)}</p>
          <p className="mt-3 text-xs leading-5 text-worker-text-muted">Actual amounts credited by your manager.</p>
        </WorkerCard>
      </div>

      <div className="rounded-xl border border-worker-border bg-worker-surface-2 px-4 py-3 text-sm leading-6 text-worker-text-muted">
        <p>Rates: <span className="font-semibold tabular-nums text-worker-text">₹{wallet.rates.post} per post</span> · <span className="font-semibold tabular-nums text-worker-text">₹{wallet.rates.comment} per comment</span></p>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-worker-border bg-worker-surface px-4 py-3 text-sm leading-6 text-worker-text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-worker-accent" aria-hidden="true" />
        <p>Payments are made by your manager, usually weekly. You&apos;ll get a message in your ticket when a payment is credited.</p>
      </div>

      <section id="payment-history" className="scroll-mt-24">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-worker-text-muted">Statement list</p>
            <h2 className="mt-1 font-display text-lg font-semibold text-worker-text">Payment history</h2>
          </div>
          <Clock3 className="h-4 w-4 text-worker-text-faint" aria-hidden="true" />
        </div>
        {payments.length === 0 ? (
          <WorkerCard className="p-6">
            <p className="text-sm text-worker-text-muted">No payments yet.</p>
          </WorkerCard>
        ) : (
          <ul className="divide-y divide-worker-border overflow-hidden rounded-xl border border-worker-border bg-worker-surface">
            {payments.map((payment: any) => {
              const expanded = openBatch === payment.batchNumber;
              const detailsId = `payment-batch-${payment.batchNumber}`;
              return (
                <li key={payment.batchNumber}>
                  <button
                    type="button"
                    onClick={() => setOpenBatch(expanded ? null : payment.batchNumber)}
                    className="flex min-h-[76px] w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors duration-150 hover:bg-worker-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-worker-accent sm:px-5"
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-worker-text">Batch #{payment.batchNumber}</span>
                      <span className="mt-1 block truncate text-xs text-worker-text-muted">{payment.weekLabel} · {payment.taskCount} tasks · {payment.paidAt ? formatISTDate(payment.paidAt) : ''}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="font-display text-base font-semibold tabular-nums text-worker-text">{formatMoney(payment.total)}</span>
                      <ChevronDown className={`h-4 w-4 text-worker-text-faint transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </span>
                  </button>
                  {expanded ? (
                    <ul id={detailsId} className="space-y-2 border-t border-worker-border bg-worker-surface-2 px-4 py-3 sm:px-5">
                      {(payment.tasks || []).map((task: any) => (
                        <li key={task.taskId} className="flex items-center justify-between gap-3 text-xs">
                          <span className="min-w-0 truncate text-worker-text-muted">{task.displayId} · {task.type}</span>
                          <span className="shrink-0 font-semibold tabular-nums text-worker-text">{formatMoney(task.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
