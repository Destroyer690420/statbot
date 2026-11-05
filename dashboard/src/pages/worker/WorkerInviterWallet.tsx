import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock3, Info, TrendingUp } from 'lucide-react';
import { getWorkerInvites, workerErrorMessage } from '../../api/workerApi';
import { formatISTDate, formatMoney } from '../../utils/workerFormat';
import { PaymentQrCard } from '../../components/worker/PaymentQrCard';
import { WorkerWalletSummaryCard } from '../../components/worker/WorkerWalletSummaryCard';
import { WorkerCard, WorkerErrorState, WorkerSkeleton } from '../../components/worker/WorkerUI';

function DetailCard({
  label,
  hint,
  value,
  icon,
  tone = 'neutral',
  foot,
}: {
  label: string;
  hint: string;
  value: string;
  icon: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning';
  foot?: React.ReactNode;
}) {
  const toneClass =
    tone === 'success'
      ? 'bg-worker-success/10 text-worker-success'
      : tone === 'warning'
        ? 'bg-worker-warning/10 text-worker-warning'
        : 'bg-worker-accent/10 text-worker-accent';
  const valueClass =
    tone === 'success' ? 'text-worker-success' : tone === 'warning' ? 'text-worker-warning' : 'text-worker-text';

  return (
    <WorkerCard className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-worker-text-muted">{label}</p>
          <p className="mt-1 text-xs text-worker-text-faint">{hint}</p>
        </div>
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>{icon}</div>
      </div>
      <p className={`mt-5 font-display text-2xl font-bold tabular-nums sm:text-3xl ${valueClass}`}>{value}</p>
      {foot ? <div className="mt-3 border-t border-worker-border pt-3 text-xs leading-5 text-worker-text-muted">{foot}</div> : null}
    </WorkerCard>
  );
}

export default function WorkerInviterWallet() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['worker-invites'],
    queryFn: getWorkerInvites,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <WorkerSkeleton className="h-44 w-full" />
        <WorkerSkeleton className="h-44 w-full" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <WorkerSkeleton key={i} className="h-44" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data?.success) {
    return <WorkerErrorState message={workerErrorMessage(data, 'Could not load your wallet.')} onRetry={() => refetch()} />;
  }

  const summary = data.data?.summary;
  const paid = Number(summary?.paid ?? 0);
  const directPaid = Number(summary?.directPaid ?? 0);
  const teamPaid = Number(summary?.teamPaid ?? 0);
  const directPending = Number(summary?.directPending ?? 0);
  const chainPending = Number(summary?.chainPending ?? 0);
  const pending = directPending + chainPending;
  const lastBatch = summary?.lastBatch ?? null;
  const lastBatchAmount = Number(lastBatch?.amount ?? 0);
  const lastBatchNumber = lastBatch?.batchNumber ?? null;
  const lastBatchPaidAt = lastBatch?.paidAt ?? null;
  // Only special inviters ever have chain money, so every chain-related line is
  // gated on these — a normal inviter's wallet contains no trace of the mechanism.
  const hasChainMoney = teamPaid > 0 || chainPending > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PaymentQrCard />

      <WorkerWalletSummaryCard awaiting={pending} lastPayment={lastBatchAmount} lifetimePayment={paid} />

      <div className="grid gap-4 sm:grid-cols-3">
        <DetailCard
          label="Paid in last batch"
          hint={
            lastBatchNumber === null
              ? 'No payment yet'
              : `Batch #${lastBatchNumber}${lastBatchPaidAt ? ` · ${formatISTDate(lastBatchPaidAt)}` : ''}`
          }
          value={formatMoney(lastBatchAmount)}
          tone="success"
          icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />}
          foot={<span>{lastBatchNumber === null ? 'Your first referral payment will appear here.' : 'What that payout contained.'}</span>}
        />
        <DetailCard
          label="Total paid"
          hint="All time, from invites"
          value={formatMoney(paid)}
          icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
          foot={
            hasChainMoney ? (
              <span>
                {formatMoney(directPaid)} from your invites · {formatMoney(teamPaid)} from your team
              </span>
            ) : (
              <span>Actual amounts credited by your manager.</span>
            )
          }
        />
        <DetailCard
          label="Awaiting payment"
          hint="Unlocked, not paid yet"
          value={formatMoney(pending)}
          tone={pending > 0 ? 'warning' : 'neutral'}
          icon={<Clock3 className="h-4 w-4" aria-hidden="true" />}
          foot={
            hasChainMoney && chainPending > 0 ? (
              <span>
                {formatMoney(directPending)} from your invites · {formatMoney(chainPending)} from your team
              </span>
            ) : (
              <span>Added to your next referral payment.</span>
            )
          }
        />
      </div>

      {hasChainMoney ? (
        <div className="flex items-start gap-3 rounded-xl border border-worker-border bg-worker-surface px-4 py-3 text-sm leading-6 text-worker-text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-worker-accent" aria-hidden="true" />
          <p>
            Your totals include {formatMoney(teamPaid + chainPending)} earned from the people invited by everyone you
            invited, across both what you have been paid and what is still pending. That money is shown as one amount —
            it is not tied to a single person.
          </p>
        </div>
      ) : null}

      <div className="flex items-start gap-3 rounded-xl border border-worker-border bg-worker-surface px-4 py-3 text-sm leading-6 text-worker-text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-worker-accent" aria-hidden="true" />
        <p>Payments are made by your manager. Referral bonuses unlock when the person you invited completes their required tasks.</p>
      </div>
    </div>
  );
}
