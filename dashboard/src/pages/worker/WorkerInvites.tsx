import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { CheckCircle2, Check, Clock3, Hash, Info, UserPlus, Users } from 'lucide-react';
import { getWorkerInvites, workerErrorMessage } from '../../api/workerApi';
import { formatMoney } from '../../utils/workerFormat';
import {
  WorkerCard,
  WorkerEmptyState,
  WorkerErrorState,
  WorkerPageTitle,
  WorkerSectionHeading,
  WorkerSkeleton,
} from '../../components/worker/WorkerUI';

function SummaryCard({
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
  icon: ReactNode;
  tone?: 'neutral' | 'success' | 'warning';
  foot?: ReactNode;
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

export default function WorkerInvites() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['worker-invites'],
    queryFn: getWorkerInvites,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <WorkerSkeleton className="h-20 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <WorkerSkeleton key={item} className="h-48" />
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
  const invitees = Array.isArray(data.data?.invitees) ? data.data.invitees : [];
  const invited = Number(summary?.invited ?? 0);
  const paid = Number(summary?.paid ?? 0);
  const directPaid = Number(summary?.directPaid ?? 0);
  const teamPaid = Number(summary?.teamPaid ?? 0);
  const pending = Number(summary?.directPending ?? 0);
  const qualified = Number(summary?.qualified ?? 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <WorkerPageTitle title="Invites" subtitle="People you invited and what you have earned from them." />
        <p className="hidden text-sm text-worker-text-muted lg:block">
          People you invited and what you have earned from them.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard
          label="People invited"
          hint={invited === 0 ? 'No invites yet' : `${qualified} of ${invited} bonus unlocked`}
          value={String(invited)}
          icon={<Users className="h-4 w-4" aria-hidden="true" />}
        />
        <SummaryCard
          label="Total earned"
          hint="Paid to you for invites"
          value={formatMoney(paid)}
          tone="success"
          icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
          foot={
            teamPaid > 0 ? (
              <span>
                {formatMoney(directPaid)} from your invites
                {teamPaid > 0 ? ` · ${formatMoney(teamPaid)} from your whole invite chain` : ''}
              </span>
            ) : (
              <span>Actual amounts credited by your manager.</span>
            )
          }
        />
        <SummaryCard
          label="Awaiting payment"
          hint="Earned, not paid yet"
          value={formatMoney(pending)}
          tone={pending > 0 ? 'warning' : 'neutral'}
          icon={<Clock3 className="h-4 w-4" aria-hidden="true" />}
          foot={<span>Added to your next referral payment.</span>}
        />
      </div>

      {teamPaid > 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-worker-border bg-worker-surface px-4 py-3 text-sm leading-6 text-worker-text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-worker-accent" aria-hidden="true" />
          <p>
            Your total includes {formatMoney(teamPaid)} earned from the people invited by everyone you invited. That
            money is shown as one amount — it is not tied to a single ticket below.
          </p>
        </div>
      ) : null}

      <section>
        <WorkerSectionHeading title="People you invited" detail={invited > 0 ? `${invited}` : undefined} />
        {invitees.length === 0 ? (
          <WorkerEmptyState
            icon={<UserPlus className="h-5 w-5" aria-hidden="true" />}
            message="You have not invited anyone yet. When someone joins with your invite link, they will appear here with their ticket and your earnings from them."
          />
        ) : (
          <ul className="divide-y divide-worker-border overflow-hidden rounded-xl border border-worker-border bg-worker-surface">
            {invitees.map((invitee: { name: string; ticket: string | null; tasks: number; threshold: number; qualified: boolean }) => (
              <li
                key={`${invitee.name}-${invitee.ticket ?? 'no-ticket'}`}
                className="flex min-h-[72px] items-center justify-between gap-4 px-4 py-3 sm:px-5"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-worker-surface-2 text-xs font-semibold text-worker-text-muted">
                    {invitee.name.trim().charAt(0).toUpperCase() || '?'}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-worker-text">{invitee.name}</span>
                    {invitee.ticket ? (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-worker-text-muted">
                        <Hash className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="truncate font-mono">{invitee.ticket}</span>
                      </span>
                    ) : (
                      <span className="mt-0.5 block text-xs text-worker-text-faint">No ticket yet</span>
                    )}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2.5">
                  {invitee.qualified ? (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-worker-success/10 text-worker-success" title="Bonus unlocked">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  ) : null}
                  <span className="text-right">
                    <span className="block font-display text-base font-semibold tabular-nums text-worker-text">
                      {invitee.tasks}
                      <span className="text-worker-text-faint">/{invitee.threshold}</span>
                    </span>
                    <span className="mt-0.5 block text-[11px] text-worker-text-faint">tasks</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex items-start gap-3 rounded-xl border border-worker-border bg-worker-surface-2 px-4 py-3 text-sm leading-6 text-worker-text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-worker-accent" aria-hidden="true" />
        <p>Referral bonuses unlock when the person you invited completes their required tasks, so the count stops once it is reached. Payments are made by your manager.</p>
      </div>
    </div>
  );
}
