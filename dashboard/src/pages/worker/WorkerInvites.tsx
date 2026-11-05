import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Search, UserPlus, Users } from 'lucide-react';
import { getWorkerInvites, getWorkerTeam, workerErrorMessage } from '../../api/workerApi';
import { formatMoney } from '../../utils/workerFormat';
import { useInviteDm } from '../../components/worker/useInviteDm';
import { useWorkerAuth } from '../../hooks/useWorkerAuth';
import {
  WorkerEmptyState,
  WorkerErrorState,
  WorkerSectionHeading,
  WorkerSkeleton,
} from '../../components/worker/WorkerUI';

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

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-worker-surface-2 text-xs font-semibold text-worker-text-muted">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

function Progress({ tasks, threshold, qualified }: { tasks: number; threshold: number; qualified: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-2.5">
      <span className="text-right">
        <span className="block font-display text-base font-semibold tabular-nums text-worker-text">
          {tasks}
          <span className="text-worker-text-faint">/{threshold}</span>
        </span>
        <span className="mt-0.5 block text-[11px] text-worker-text-faint">tasks</span>
      </span>
      {qualified ? (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-worker-success/10 text-worker-success" title="Bonus unlocked">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      ) : null}
    </span>
  );
}

function PersonName({
  name,
  dmRef,
  opening,
  onOpen,
}: {
  name: string;
  dmRef: string;
  opening: boolean;
  onOpen: () => void;
}) {
  if (!dmRef) {
    return <span className="block truncate text-sm font-semibold text-worker-text">{name}</span>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={opening}
      title={`Message ${name} on Discord`}
      className="block max-w-full truncate text-left text-sm font-semibold text-worker-text underline decoration-worker-border decoration-1 underline-offset-2 transition-colors duration-150 hover:decoration-worker-accent hover:text-worker-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent disabled:opacity-60"
    >
      {name}
    </button>
  );
}

function Row({ avatar, name, progress }: { avatar: ReactNode; name: ReactNode; progress: ReactNode }) {
  return (
    <li className="flex min-h-[66px] items-center justify-between gap-4 px-4 py-3 sm:px-5">
      <span className="flex min-w-0 items-center gap-3">
        {avatar}
        <span className="min-w-0">{name}</span>
      </span>
      {progress}
    </li>
  );
}

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
        <WorkerSkeleton className="h-12 w-full" />
        <WorkerSkeleton className="h-5 w-40" />
        {[0, 1, 2, 3, 4].map((item) => (
          <WorkerSkeleton key={item} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError || !data?.success) {
    return <WorkerErrorState message={workerErrorMessage(data, 'Could not load your invites.')} onRetry={() => refetch()} />;
  }

  const summary = data.data?.summary;
  const invitees: DirectRow[] = Array.isArray(data.data?.invitees) ? data.data.invitees : [];
  const invited = Number(summary?.invited ?? 0);
  const teamRows: TeamRow[] = teamQuery.data?.rows ?? [];
  const teamTotal = Number(teamQuery.data?.total ?? 0);

  const switchView = (next: 'direct' | 'team') => {
    setView(next);
    setTeamPage(1);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
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
                {teamRows.map((person) => (
                  <Row
                    key={`${person.name}-${person.invitedBy}-${person.dmRef}`}
                    avatar={<Avatar name={person.name} />}
                    progress={<Progress tasks={person.tasks} threshold={person.threshold} qualified={person.qualified} />}
                    name={
                      <>
                        <PersonName
                          name={person.name}
                          dmRef={person.dmRef}
                          opening={dmFor === person.dmRef}
                          onOpen={() => openDm(person)}
                        />
                        {person.invitedBy ? (
                          <span className="mt-0.5 block truncate text-xs text-worker-text-muted">via {person.invitedBy}</span>
                        ) : null}
                      </>
                    }
                  />
                ))}
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
              {invitees.map((invitee) => (
                <Row
                  key={`${invitee.name}-${invitee.ticket ?? 'no-ticket'}`}
                  avatar={<Avatar name={invitee.name} />}
                  progress={<Progress tasks={invitee.tasks} threshold={invitee.threshold} qualified={invitee.qualified} />}
                  name={
                    <>
                      <PersonName
                        name={invitee.name}
                        dmRef={invitee.dmRef}
                        opening={dmFor === invitee.dmRef}
                        onOpen={() => openDm(invitee)}
                      />
                      {invitee.ticket ? (
                        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
                          <span className="truncate font-mono text-worker-success"># {invitee.ticket}</span>
                          {invitee.earned > 0 ? (
                            <span className="text-worker-text-muted">{formatMoney(invitee.earned)} earned</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-xs text-worker-text-faint">No ticket yet</span>
                      )}
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
