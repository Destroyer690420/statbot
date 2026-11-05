import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, CheckCircle2, Clock3, Hash, Info, Search, TrendingUp, UserPlus, Users } from 'lucide-react';
import { getWorkerInvites, getWorkerTeam, workerErrorMessage } from '../../api/workerApi';
import { formatISTDate, formatMoney } from '../../utils/workerFormat';
import { PaymentQrCard } from '../../components/worker/PaymentQrCard';
import { useInviteDm } from '../../components/worker/useInviteDm';
import { useWorkerAuth } from '../../hooks/useWorkerAuth';
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

interface DirectRow {
  name: string;
  ticket: string | null;
  tasks: number;
  threshold: number;
  qualified: boolean;
  earned: number;
  dmRef: string;
}

interface TeamRow {
  name: string;
  invitedBy: string;
  ticket: string | null;
  tasks: number;
  threshold: number;
  qualified: boolean;
  dmRef: string;
}

const TEAM_PAGE_SIZE = 20;

export default function WorkerInvites() {
  const { capabilities } = useWorkerAuth();
  const hasTeam = Boolean(capabilities?.hasTeam);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['worker-invites'],
    queryFn: getWorkerInvites,
  });

  const [view, setView] = useState<'direct' | 'team'>('direct');
  const [teamSearch, setTeamSearch] = useState('');
  const [teamPage, setTeamPage] = useState(1);
  const teamQuery = useQuery({
    queryKey: ['worker-team', teamPage, teamSearch],
    // Pages are small (20 rows) and the team is compact, so accumulate pages
    // 1..N in one query: "Load more" adds a page without dropping earlier rows.
    queryFn: async () => {
      const pages = await Promise.all(
        Array.from({ length: teamPage }, (_, i) =>
          getWorkerTeam({ page: i + 1, limit: TEAM_PAGE_SIZE, q: teamSearch.trim() || undefined }),
        ),
      );
      const rows: TeamRow[] = pages.flatMap((res) => (Array.isArray(res?.data?.rows) ? res.data.rows : []));
      return { rows, total: Number(pages[0]?.data?.total ?? 0) };
    },
    enabled: hasTeam,
  });

  const { dmFor, dmError, openDm } = useInviteDm();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <WorkerSkeleton className="h-20 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
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
  const invitees: DirectRow[] = Array.isArray(data.data?.invitees) ? data.data.invitees : [];
  const invited = Number(summary?.invited ?? 0);
  const paid = Number(summary?.paid ?? 0);
  const directPaid = Number(summary?.directPaid ?? 0);
  const teamPaid = Number(summary?.teamPaid ?? 0);
  const directPending = Number(summary?.directPending ?? 0);
  const chainPending = Number(summary?.chainPending ?? 0);
  const pending = directPending + chainPending;
  const qualified = Number(summary?.qualified ?? 0);
  const lastBatch = summary?.lastBatch ?? null;
  const lastBatchAmount = Number(lastBatch?.amount ?? 0);
  const lastBatchNumber = lastBatch?.batchNumber ?? null;
  const lastBatchPaidAt = lastBatch?.paidAt ?? null;
  // Only special inviters ever have chain money, so every chain-related line is
  // gated on these — a normal inviter's panel contains no trace of the mechanism.
  const hasChainMoney = teamPaid > 0 || chainPending > 0;
  const teamRows: TeamRow[] = teamQuery.data?.rows ?? [];
  const teamTotal = Number(teamQuery.data?.total ?? 0);

  const switchView = (next: 'direct' | 'team') => {
    setView(next);
    setTeamPage(1);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <WorkerPageTitle title="Invites" subtitle="People you invited and what you have earned from them." />
      </div>

      <PaymentQrCard />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard
          label="People invited"
          hint={invited === 0 ? 'No invites yet' : `${qualified} of ${invited} bonus unlocked`}
          value={String(invited)}
          icon={<Users className="h-4 w-4" aria-hidden="true" />}
        />
        <SummaryCard
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
        <SummaryCard
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
        <SummaryCard
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
            it is not tied to a single person below.
          </p>
        </div>
      ) : null}

      {dmError ? (
        <p role="alert" className="rounded-xl border border-worker-danger/30 bg-worker-danger/10 px-4 py-3 text-sm text-worker-danger">
          {dmError}
        </p>
      ) : null}

      {hasTeam ? (
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-worker-border bg-worker-surface-2 p-1" role="tablist" aria-label="Invite view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'direct'}
            onClick={() => switchView('direct')}
            className={`min-h-[40px] rounded-md px-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent ${
              view === 'direct' ? 'bg-worker-accent text-white' : 'text-worker-text-muted hover:text-worker-text'
            }`}
          >
            Direct ({invited})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'team'}
            onClick={() => switchView('team')}
            className={`min-h-[40px] rounded-md px-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent ${
              view === 'team' ? 'bg-worker-accent text-white' : 'text-worker-text-muted hover:text-worker-text'
            }`}
          >
            Team ({teamTotal})
          </button>
        </div>
      ) : null}

      {hasTeam && view === 'team' ? (
        <section>
          <WorkerSectionHeading title="Your team" detail={teamTotal > 0 ? `${teamTotal}` : undefined} />
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-worker-text-faint" aria-hidden="true" />
            <input
              type="search"
              className="worker-input pl-10"
              value={teamSearch}
              onChange={(event) => {
                setTeamSearch(event.target.value);
                setTeamPage(1);
              }}
              placeholder="Search your team by name"
              aria-label="Search your team by name"
            />
          </div>

          {teamQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <WorkerSkeleton key={i} className="h-16" />
              ))}
            </div>
          ) : teamQuery.isError ? (
            <WorkerErrorState
              message={workerErrorMessage(teamQuery.error, 'Could not load your team.')}
              onRetry={() => teamQuery.refetch()}
            />
          ) : teamRows.length === 0 ? (
            <WorkerEmptyState
              icon={<Users className="h-5 w-5" aria-hidden="true" />}
              message={
                teamSearch.trim()
                  ? 'Nobody in your team matches that name.'
                  : 'Nobody is in your team yet. People invited below your own invites appear here once they join.'
              }
            />
          ) : (
            <>
              <ul className="divide-y divide-worker-border overflow-hidden rounded-xl border border-worker-border bg-worker-surface">
                {teamRows.map((person) => {
                  const opening = dmFor === person.dmRef;
                  return (
                    <li key={`${person.name}-${person.invitedBy}-${person.dmRef}`} className="flex min-h-[72px] items-center justify-between gap-4 px-4 py-3 sm:px-5">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-worker-surface-2 text-xs font-semibold text-worker-text-muted">
                          {person.name.trim().charAt(0).toUpperCase() || '?'}
                        </span>
                        <span className="min-w-0">
                          {person.dmRef ? (
                            <button
                              type="button"
                              onClick={() => openDm(person)}
                              disabled={opening}
                              title={`Message ${person.name} on Discord`}
                              className="block max-w-full truncate text-left text-sm font-semibold text-worker-text underline decoration-worker-border decoration-1 underline-offset-2 transition-colors duration-150 hover:decoration-worker-accent hover:text-worker-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent disabled:opacity-60"
                            >
                              {person.name}
                            </button>
                          ) : (
                            <span className="block truncate text-sm font-semibold text-worker-text">{person.name}</span>
                          )}
                          {person.invitedBy ? (
                            <span className="mt-0.5 block truncate text-xs text-worker-text-muted">via {person.invitedBy}</span>
                          ) : null}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2.5">
                        {person.qualified ? (
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-worker-success/10 text-worker-success" title="Qualified">
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          </span>
                        ) : null}
                        <span className="text-right">
                          <span className="block font-display text-base font-semibold tabular-nums text-worker-text">
                            {person.tasks}
                            <span className="text-worker-text-faint">/{person.threshold}</span>
                          </span>
                          <span className="mt-0.5 block text-[11px] text-worker-text-faint">tasks</span>
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              {teamRows.length < teamTotal ? (
                <div className="mt-4 flex justify-center">
                  <button type="button" onClick={() => setTeamPage((p) => p + 1)} className="worker-secondary-button" disabled={teamQuery.isFetching}>
                    {teamQuery.isFetching ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : (
        <section>
          <WorkerSectionHeading title="People you invited" detail={invited > 0 ? `${invited}` : undefined} />
          {invitees.length === 0 ? (
            <WorkerEmptyState
              icon={<UserPlus className="h-5 w-5" aria-hidden="true" />}
              message="You have not invited anyone yet. When someone joins with your invite link, they will appear here with their ticket and your earnings from them."
            />
          ) : (
            <ul className="divide-y divide-worker-border overflow-hidden rounded-xl border border-worker-border bg-worker-surface">
              {invitees.map((invitee) => {
                const opening = dmFor === invitee.dmRef;
                return (
                  <li
                    key={`${invitee.name}-${invitee.ticket ?? 'no-ticket'}`}
                    className="flex min-h-[72px] items-center justify-between gap-4 px-4 py-3 sm:px-5"
                  >
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
                        {invitee.ticket ? (
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-worker-text-muted">
                            <span className="flex min-w-0 items-center gap-1">
                              <Hash className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="truncate font-mono">{invitee.ticket}</span>
                            </span>
                            {invitee.earned > 0 ? (
                              <span className="text-worker-success">{formatMoney(invitee.earned)} earned</span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="mt-0.5 block text-xs text-worker-text-faint">
                            No ticket yet{invitee.earned > 0 ? ` · ${formatMoney(invitee.earned)} earned` : ''}
                          </span>
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
                );
              })}
            </ul>
          )}
        </section>
      )}

      <div className="flex items-start gap-3 rounded-xl border border-worker-border bg-worker-surface-2 px-4 py-3 text-sm leading-6 text-worker-text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-worker-accent" aria-hidden="true" />
        <p>Referral bonuses unlock when the person you invited completes their required tasks, so the count stops once it is reached. Payments are made by your manager.</p>
      </div>
    </div>
  );
}
