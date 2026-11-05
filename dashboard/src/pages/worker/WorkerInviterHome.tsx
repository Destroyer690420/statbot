import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, TrendingUp, Users } from 'lucide-react';
import { getWorkerInvites, getWorkerQrCode, getWorkerTeam, workerErrorMessage } from '../../api/workerApi';
import { formatISTDate, formatMoney } from '../../utils/workerFormat';
import { PaymentQrCard } from '../../components/worker/PaymentQrCard';
import { useInviteDm } from '../../components/worker/useInviteDm';
import {
  WorkerCard,
  WorkerEmptyState,
  WorkerErrorState,
  WorkerSkeleton,
} from '../../components/worker/WorkerUI';
import { useWorkerAuth } from '../../hooks/useWorkerAuth';

interface InviteeRow {
  name: string;
  ticket: string | null;
  tasks: number;
  threshold: number;
  qualified: boolean;
  dmRef: string;
}

function StatCard({ label, value, hint, icon }: { label: string; value: string; hint: string; icon: React.ReactNode }) {
  return (
    <WorkerCard className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-worker-text-muted">{label}</p>
          <p className="mt-1 text-xs text-worker-text-faint">{hint}</p>
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-worker-accent/10 text-worker-accent">{icon}</div>
      </div>
      <p className="mt-5 font-display text-2xl font-bold tabular-nums text-worker-text sm:text-3xl">{value}</p>
    </WorkerCard>
  );
}

export default function WorkerInviterHome() {
  const { capabilities, workerName } = useWorkerAuth();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['worker-invites'],
    queryFn: getWorkerInvites,
  });
  const qr = useQuery({
    queryKey: ['worker-wallet-qr'],
    queryFn: getWorkerQrCode,
  });
  const team = useQuery({
    queryKey: ['worker-team', 1, 1],
    queryFn: () => getWorkerTeam({ page: 1, limit: 1 }),
    enabled: Boolean(capabilities?.hasTeam),
  });
  const { dmFor, dmError, openDm } = useInviteDm();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <WorkerSkeleton className="h-20 w-full" />
        <WorkerSkeleton className="h-44 w-full" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <WorkerSkeleton key={i} className="h-36" />
          ))}
        </div>
        <WorkerSkeleton className="h-72 w-full" />
      </div>
    );
  }

  if (isError || !data?.success) {
    return <WorkerErrorState message={workerErrorMessage(data, 'Could not load your invites.')} onRetry={() => refetch()} />;
  }

  const summary = data.data?.summary;
  const invitees: InviteeRow[] = Array.isArray(data.data?.invitees) ? data.data.invitees : [];
  const invited = Number(summary?.invited ?? 0);
  const qualified = Number(summary?.qualified ?? 0);
  const paid = Number(summary?.paid ?? 0);
  const pending = Number(summary?.directPending ?? 0) + Number(summary?.chainPending ?? 0);
  const lastBatch = summary?.lastBatch ?? null;
  const lastBatchAmount = Number(lastBatch?.amount ?? 0);
  const lastBatchNumber = lastBatch?.batchNumber ?? null;
  const lastBatchPaidAt = lastBatch?.paidAt ?? null;
  const qrUploaded = Boolean(qr.data?.data?.qrCodeUrl);

  const unqualified = invitees
    .filter((i) => !i.qualified)
    .sort((a, b) => {
      const aNoTicket = a.ticket === null ? 1 : 0;
      const bNoTicket = b.ticket === null ? 1 : 0;
      if (aNoTicket !== bNoTicket) return aNoTicket - bNoTicket;
      const aNeed = a.threshold - a.tasks;
      const bNeed = b.threshold - b.tasks;
      if (aNeed !== bNeed) return aNeed - bNeed;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 5);

  const teamData = team.data?.data;
  const teamTotal = Number(teamData?.total ?? 0);
  const teamQualified = Number(teamData?.qualified ?? 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight text-worker-text sm:text-2xl">
          {workerName ? `Hi, ${workerName}` : 'Hi'}
        </h1>
        <p className="mt-1 text-sm text-worker-text-muted">Your invites at a glance.</p>
      </div>

      <WorkerCard className="relative overflow-hidden border-0 bg-wallet-gradient text-white">
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/10 blur-2xl" />
        <div className="relative px-6 py-8 sm:px-8 sm:py-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/75">Awaiting payment</p>
          <p className="mt-3 font-display text-4xl font-bold tabular-nums leading-none sm:text-5xl">{formatMoney(pending)}</p>
          <p className="mt-3 text-sm text-white/80">
            {lastBatchNumber === null
              ? 'No payment yet'
              : `Last payout: ${formatMoney(lastBatchAmount)} · Batch #${lastBatchNumber}${lastBatchPaidAt ? ` · ${formatISTDate(lastBatchPaidAt)}` : ''}`}
          </p>
          <p className="mt-1 text-xs text-white/70">
            {qr.isLoading ? 'Checking payment QR…' : qrUploaded ? 'Payment QR added' : 'Add your payment QR below so you can be paid.'}
          </p>
        </div>
      </WorkerCard>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="People invited" value={String(invited)} hint={invited === 0 ? 'No invites yet' : 'People you brought in'} icon={<Users className="h-4 w-4" aria-hidden="true" />} />
        <StatCard label="Bonus unlocked" value={`${qualified} of ${invited}`} hint="Invites past their threshold" icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />} />
        <StatCard label="Total paid" value={formatMoney(paid)} hint="All time, from invites" icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />} />
      </div>

      {dmError ? (
        <p role="alert" className="rounded-xl border border-worker-danger/30 bg-worker-danger/10 px-4 py-3 text-sm text-worker-danger">
          {dmError}
        </p>
      ) : null}

      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-worker-text">Next to nudge</h2>
          {invited > 0 ? (
            <Link to="/worker/invites" className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-worker-accent transition-colors duration-150 hover:text-worker-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent">
              View all
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        {unqualified.length === 0 ? (
          <WorkerEmptyState
            icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
            message={invited === 0 ? 'You have not invited anyone yet.' : 'Everybody you invited has qualified. Nice work!'}
          />
        ) : (
          <ul className="divide-y divide-worker-border overflow-hidden rounded-xl border border-worker-border bg-worker-surface">
            {unqualified.map((invitee) => {
              const opening = dmFor === invitee.dmRef;
              return (
                <li key={`${invitee.name}-${invitee.ticket ?? 'no-ticket'}`} className="flex min-h-[64px] items-center justify-between gap-4 px-4 py-3 sm:px-5">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-worker-surface-2 text-xs font-semibold text-worker-text-muted">
                      {invitee.name.trim().charAt(0).toUpperCase() || '?'}
                    </span>
                    <span className="min-w-0">
                      {invitee.dmRef ? (
                        <button
                          type="button"
                          onClick={() => openDm(invitee)}
                          disabled={opening}
                          title={`Message ${invitee.name} on Discord`}
                          className="block max-w-full truncate text-left text-sm font-semibold text-worker-text underline decoration-worker-border decoration-1 underline-offset-2 transition-colors duration-150 hover:decoration-worker-accent hover:text-worker-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent disabled:opacity-60"
                        >
                          {invitee.name}
                        </button>
                      ) : (
                        <span className="block truncate text-sm font-semibold text-worker-text">{invitee.name}</span>
                      )}
                      <span className="mt-0.5 block text-xs text-worker-text-faint">{invitee.ticket ? invitee.ticket : 'No ticket yet'}</span>
                    </span>
                  </span>
                  {invitee.ticket === null ? (
                    <span className="shrink-0 rounded-full border border-worker-border bg-worker-surface-2 px-2.5 py-1 text-xs font-medium text-worker-text-muted">
                      No ticket yet
                    </span>
                  ) : (
                    <span className="shrink-0 text-right">
                      <span className="block font-display text-base font-semibold tabular-nums text-worker-text">
                        {invitee.tasks}
                        <span className="text-worker-text-faint">/{invitee.threshold}</span>
                      </span>
                      <span className="mt-0.5 block text-[11px] text-worker-text-faint">tasks</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!qr.isLoading && !qrUploaded ? <PaymentQrCard hideWhenUploaded /> : null}

      {capabilities?.hasTeam ? (
        <Link to="/worker/invites" className="worker-card worker-card-interactive flex items-center justify-between gap-4 p-4 sm:p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-worker-text">Your team</span>
            <span className="mt-0.5 block text-xs text-worker-text-muted">
              {team.isLoading ? 'Loading…' : `${teamTotal} ${teamTotal === 1 ? 'person' : 'people'}, ${teamQualified} qualified`}
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-worker-accent" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}
