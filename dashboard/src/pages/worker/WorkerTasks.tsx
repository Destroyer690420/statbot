import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Filter, Search, SlidersHorizontal, X } from 'lucide-react';
import { getWorkerTasks, workerErrorMessage } from '../../api/workerApi';
import { WorkerEmptyState, WorkerErrorState, WorkerSkeleton } from '../../components/worker/WorkerUI';
import { WorkerTaskCard } from '../../components/worker/WorkerTaskCard';

type Tab = 'todo' | 'completed' | 'failed';

function SearchControl({ value, onChange, id }: { value: string; onChange: (value: string) => void; id: string }) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-worker-text-faint" aria-hidden="true" />
      <input
        id={id}
        type="text"
        placeholder="Search tasks"
        className="worker-input pl-10"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function TypeControl({ value, onChange, id }: { value: string; onChange: (value: string) => void; id: string }) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="worker-input min-w-[132px] appearance-none px-3"
      aria-label="Filter by type"
    >
      <option value="">All types</option>
      <option value="POST">Post</option>
      <option value="COMMENT">Comment</option>
    </select>
  );
}

export default function WorkerTasks() {
  const [tab, setTab] = useState<Tab>('todo');
  const [sub, setSub] = useState('all');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [nowMs, setNowMs] = useState(Date.now());
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const params: Record<string, string | number> = { tab, page, limit: 20 };
  if (tab === 'completed') params.sub = sub;
  if (type) params.type = type;
  if (debounced.trim()) params.q = debounced.trim();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['worker-tasks', tab, sub, type, debounced, page],
    queryFn: () => getWorkerTasks(params),
    refetchInterval: 60000,
  });

  const tasks = data?.data || [];
  const counts = data?.counts || { todo: 0, completed: 0, failed: 0 };
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));
  const activeFilterCount = (type ? 1 : 0) + (search.trim() ? 1 : 0);
  const tabs: { key: Tab; label: string }[] = [
    { key: 'todo', label: 'To-do' },
    { key: 'completed', label: 'Completed' },
    { key: 'failed', label: 'Failed' },
  ];

  const handleTypeChange = (value: string) => {
    setType(value);
    setPage(1);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight text-worker-text sm:text-2xl lg:hidden">Tasks</h1>
        <p className="mt-1 hidden text-sm text-worker-text-muted lg:block">Keep track of what needs your attention and what has been paid.</p>
      </div>

      <div className="sticky top-16 z-20 -mx-1 bg-worker-bg/95 px-1 py-2 backdrop-blur sm:-mx-2 sm:px-2" role="tablist" aria-label="Task status">
        <div className="flex min-w-max gap-1 rounded-xl border border-worker-border bg-worker-surface p-1 sm:min-w-0">
          {tabs.map((item) => {
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="worker-task-list"
                onClick={() => {
                  setTab(item.key);
                  setPage(1);
                }}
                className={`worker-segment flex min-w-[104px] flex-1 items-center justify-center gap-2 sm:min-w-0 ${active ? 'worker-segment-active' : ''}`}
              >
                <span>{item.label}</span>
                <span className={`text-xs tabular-nums ${active ? 'text-white/75' : 'text-worker-text-faint'}`}>{counts[item.key] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'completed' ? (
        <div className="flex w-full gap-1 rounded-xl border border-worker-border bg-worker-surface p-1 sm:w-auto" role="group" aria-label="Payment filter">
          {[
            { key: 'all', label: 'All' },
            { key: 'awaiting', label: 'Awaiting payment' },
            { key: 'paid', label: 'Paid' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={sub === item.key}
              onClick={() => {
                setSub(item.key);
                setPage(1);
              }}
              className={`worker-segment ${sub === item.key ? 'worker-segment-active' : ''}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="hidden items-center gap-2 lg:flex">
        <SearchControl id="worker-task-search-desktop" value={search} onChange={setSearch} />
        <TypeControl id="worker-task-type-desktop" value={type} onChange={handleTypeChange} />
      </div>

      <div className="flex items-center justify-between gap-3 lg:hidden">
        <button type="button" onClick={() => setFiltersOpen(true)} className="worker-secondary-button flex-1 justify-center">
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Filters
          {activeFilterCount > 0 ? <span className="rounded-full bg-worker-accent px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">{activeFilterCount}</span> : null}
        </button>
        {search || type ? (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setType('');
              setPage(1);
            }}
            className="worker-ghost-button px-2"
          >
            Clear
          </button>
        ) : null}
      </div>

      {filtersOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-worker-bg/80 p-0 backdrop-blur-sm lg:hidden" role="dialog" aria-modal="true" aria-label="Task filters" onClick={() => setFiltersOpen(false)}>
          <div className="w-full rounded-t-xl border-t border-worker-border bg-worker-surface p-5 pb-8" onClick={(event) => event.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="font-display text-base font-semibold text-worker-text">Filter tasks</p>
                <p className="mt-1 text-xs text-worker-text-muted">Search and narrow the current list.</p>
              </div>
              <button type="button" onClick={() => setFiltersOpen(false)} className="worker-icon-button" aria-label="Close filters">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-3">
              <SearchControl id="worker-task-search-mobile" value={search} onChange={setSearch} />
              <TypeControl id="worker-task-type-mobile" value={type} onChange={handleTypeChange} />
            </div>
            <button type="button" onClick={() => setFiltersOpen(false)} className="worker-primary-button mt-5 w-full">
              Show tasks
            </button>
          </div>
        </div>
      ) : null}

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
        <ul id="worker-task-list" role="tabpanel" className="grid gap-3 md:grid-cols-2 min-[1440px]:grid-cols-3">
          {tasks.map((task: any) => (
            <li key={task.id}>
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
    </div>
  );
}
