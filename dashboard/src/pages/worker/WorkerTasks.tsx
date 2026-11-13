import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { getAvailableTasks, getWorkerTasks, workerErrorMessage } from '../../api/workerApi';
import { WorkerEmptyState, WorkerErrorState, WorkerSkeleton } from '../../components/worker/WorkerUI';
import { WorkerTaskCard } from '../../components/worker/WorkerTaskCard';
import { WorkerAvailableTasks } from '../../components/worker/WorkerAvailableTasks';

type Tab = 'available' | 'todo' | 'completed' | 'failed';

export default function WorkerTasks() {
  // Home stat cards deep-link here via ?tab=; only whitelisted values are honored.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(
    tabParam === 'todo' || tabParam === 'completed' || tabParam === 'failed' ? tabParam : 'available',
  );
  const [page, setPage] = useState(1);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Update tab state if searchParams change externally
  useEffect(() => {
    if (tabParam === 'todo' || tabParam === 'completed' || tabParam === 'failed' || tabParam === 'available') {
      setTab(tabParam);
    }
  }, [tabParam]);

  // Query live available tasks count for tab badge
  const { data: availableData } = useQuery({
    queryKey: ['worker-available-tasks'],
    queryFn: getAvailableTasks,
    refetchInterval: 3500,
  });
  const availableCount = availableData?.data?.tasks?.length ?? 0;

  // Query paginated tasks for todo / completed / failed
  const params: Record<string, string | number> = { tab: tab === 'available' ? 'todo' : tab, page, limit: 20 };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['worker-tasks', tab, page],
    queryFn: () => getWorkerTasks(params),
    enabled: tab !== 'available',
    refetchInterval: 60000,
  });

  const tasks = data?.data || [];
  const counts = data?.counts || { todo: 0, completed: 0, failed: 0 };
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'available', label: 'Available', count: availableCount },
    { key: 'todo', label: 'To-do', count: counts.todo ?? 0 },
    { key: 'completed', label: 'Completed', count: counts.completed ?? 0 },
    { key: 'failed', label: 'Failed', count: counts.failed ?? 0 },
  ];

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    setPage(1);
    setSearchParams(newTab === 'available' ? {} : { tab: newTab });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="sticky top-16 z-20 -mx-1 bg-worker-bg/95 px-1 py-2 backdrop-blur sm:-mx-2 sm:px-2" role="tablist" aria-label="Task status">
        <div className="relative grid w-full min-w-0 grid-cols-4 gap-1 rounded-xl border border-worker-border bg-worker-surface p-1">
          <span
            aria-hidden="true"
            className={`absolute bottom-1 left-1 top-1 w-[calc((100%_-_0.75rem)/4)] rounded-lg bg-worker-accent transition-transform duration-150 motion-reduce:transition-none ${
              tab === 'available'
                ? 'translate-x-0'
                : tab === 'todo'
                ? 'translate-x-full'
                : tab === 'completed'
                ? 'translate-x-[200%]'
                : 'translate-x-[300%]'
            }`}
          />
          {tabs.map((item) => {
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="worker-task-list"
                onClick={() => handleTabChange(item.key)}
                className={`worker-segment relative z-10 flex min-w-0 items-center justify-center gap-1.5 sm:gap-2 ${active ? 'text-white' : ''}`}
              >
                <span className="truncate">{item.label}</span>
                <span className={`text-xs tabular-nums ${active ? 'text-white/75' : 'text-worker-text-faint'}`}>
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'available' ? (
        <WorkerAvailableTasks />
      ) : (
        <>
          {tab === 'failed' ? (
            <p className="rounded-xl border border-worker-border bg-worker-surface-2 px-4 py-3 text-sm leading-6 text-worker-text-muted">
              These were removed from Reddit within 10 minutes, so they are never paid and do not need an insight.
            </p>
          ) : null}

          {isLoading ? (
            <div className="grid gap-3 md:grid-cols-2 min-[1440px]:grid-cols-3" aria-label="Loading tasks">
              {[0, 1, 2, 3, 4, 5].map((item) => <WorkerSkeleton key={item} className="h-64" />)}
            </div>
          ) : isError || !data?.success ? (
            <WorkerErrorState message={workerErrorMessage(data, 'Could not load tasks.')} onRetry={() => refetch()} />
          ) : tasks.length === 0 ? (
            <WorkerEmptyState
              message={tab === 'todo' ? "No tasks yet. They'll show up here once one is assigned to you." : `No ${tab} tasks.`}
              icon={<Filter className="h-5 w-5" aria-hidden="true" />}
            />
          ) : (
            <ul id="worker-task-list" role="tabpanel" className="grid min-w-0 gap-3 md:grid-cols-2 min-[1440px]:grid-cols-3">
              {tasks.map((task: any) => (
                <li key={task.id} className="min-w-0">
                  <WorkerTaskCard task={task} nowMs={nowMs} />
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3 border-t border-worker-border pt-4">
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="worker-secondary-button">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Previous
              </button>
              <span className="text-xs text-worker-text-muted">Page {page} of {totalPages}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} className="worker-secondary-button">
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}

          <p className="text-center text-xs text-worker-text-faint">Showing up to 20 tasks per page.</p>
        </>
      )}
    </div>
  );
}
