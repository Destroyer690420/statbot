import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, ExternalLink } from 'lucide-react';
import { getWorkerTasks, workerErrorMessage } from '../../api/workerApi';
import { formatMoney, formatIST, countdownText, tonePill } from '../../utils/workerFormat';

type Tab = 'todo' | 'completed' | 'failed';

function InsightChips({ task, nowMs }: { task: any; nowMs: number }) {
  if (task.tab === 'failed') return null;
  const chips: { label: string; cls: string }[] = [];
  const rem = task.reminders || [];
  const isPost = String(task.type).toUpperCase() === 'POST';
  const r20 = rem.find((r: any) => String(r.type).includes('20H'));
  const r70 = rem.find((r: any) => String(r.type).includes('70H'));
  const chipFor = (r: any, label: string) => {
    if (!r) return;
    if (r.completed) {
      chips.push({ label: `${label} \u2713`, cls: 'bg-green-500/10 text-green-400 border-green-500/20' });
    } else if (r.sent && new Date(r.dueAt).getTime() < nowMs) {
      chips.push({ label: `${label} \u26A0 overdue`, cls: 'bg-red-500/10 text-red-400 border-red-500/20' });
    } else if (r.sent) {
      chips.push({ label: `${label} \u23F3 ${countdownText(nowMs, r.dueAt)}`, cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' });
    } else {
      chips.push({ label: `${label} \u23F3 due ${formatIST(r.dueAt)}`, cls: 'bg-dark-500/10 text-dark-300 border-dark-600/40' });
    }
  };
  chipFor(r20, '20h');
  if (isPost) chipFor(r70, '70h');
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {chips.map((c, i) => (
        <span key={i} className={`px-2 py-0.5 rounded-full text-[11px] border ${c.cls}`}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

function PayoutChip({ task }: { task: any }) {
  if (task.tab !== 'completed') return null;
  const p = task.payout;
  if (!p || p.state === 'none') return null;
  if (p.state === 'paid') {
    return (
      <span className="px-2 py-0.5 rounded-full text-[11px] border bg-green-500/10 text-green-400 border-green-500/20">
        Paid {formatMoney(p.amount)}
        {p.paidAt ? ` · ${formatIST(p.paidAt)}` : ''}
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/10 text-blue-400 border-blue-500/20">
      Awaiting ~{formatMoney(p.amount)} est.
    </span>
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

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
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

  const tabs: { key: Tab; label: string }[] = [
    { key: 'todo', label: 'To-do' },
    { key: 'completed', label: 'Completed' },
    { key: 'failed', label: 'Failed' },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-white">Tasks</h1>

      <div className="segmented-control" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            onClick={() => {
              setTab(t.key);
              setPage(1);
            }}
            className={`segmented-control-item min-h-[44px] ${tab === t.key ? 'active' : ''}`}
          >
            {t.label} ({counts[t.key] ?? 0})
          </button>
        ))}
      </div>

      {tab === 'completed' && (
        <div className="segmented-control" role="tablist" aria-label="Payment filter">
          {[
            { key: 'all', label: 'All' },
            { key: 'awaiting', label: 'Awaiting payment' },
            { key: 'paid', label: 'Paid' },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => {
                setSub(s.key);
                setPage(1);
              }}
              className={`segmented-control-item min-h-[44px] ${sub === s.key ? 'active' : ''}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 transform -translate-y-1/2 text-dark-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search tasks…"
            className="w-full h-11 pl-10 pr-3 bg-dark-800/80 border border-dark-700/80 rounded-xl text-sm text-white placeholder-dark-400 focus:outline-none focus:border-primary-500/50"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          className="h-11 px-3 bg-dark-800/80 border border-dark-700/80 rounded-xl text-sm text-white"
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          <option value="POST">Post</option>
          <option value="COMMENT">Comment</option>
        </select>
      </div>

      {tab === 'failed' && (
        <p className="text-xs text-dark-400 glass-card p-3">
          These were deleted from Reddit within 10 minutes, so they are never paid and no insights are needed.
        </p>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 glass-card animate-pulse" />
          ))}
        </div>
      ) : isError || !data?.success ? (
        <div className="glass-card p-6 text-center space-y-3">
          <p className="text-sm text-red-400">{workerErrorMessage(data, 'Could not load tasks.')}</p>
          <button onClick={() => refetch()} className="btn-secondary min-h-[44px]">
            Retry
          </button>
        </div>
      ) : tasks.length === 0 ? (
        <div className="glass-card p-6 text-center">
          <p className="text-sm text-dark-300">
            {tab === 'todo'
              ? 'No tasks yet — they appear here once one is assigned to you.'
              : `No ${tab} tasks.`}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {tasks.map((task: any) => (
            <li key={task.id} className="glass-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">{task.displayId}</p>
                  <p className="text-xs text-dark-400 truncate">
                    {task.type} · {task.subreddit ? `r/${task.subreddit}` : 'Reddit'} ·{' '}
                    {formatIST(task.createdAt)}
                  </p>
                </div>
                <span
                  className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] border ${tonePill(task.workerStatus?.tone)}`}
                >
                  {task.workerStatus?.label || task.status}
                </span>
              </div>
              {task.title && <p className="text-xs text-dark-300 mt-1 line-clamp-2">{task.title}</p>}
              {task.workerStatus?.action && (
                <p className="text-xs text-yellow-300 mt-1.5">{task.workerStatus.action}</p>
              )}
              <InsightChips task={task} nowMs={nowMs} />
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <PayoutChip task={task} />
              </div>
              <div className="flex items-center gap-3 mt-3">
                {task.redditLink && (
                  <a
                    href={task.redditLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary-400 flex items-center gap-1 min-h-[44px]"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Reddit link
                  </a>
                )}
                <Link
                  to={`/worker/tasks/${encodeURIComponent(task.id)}`}
                  className="text-xs text-primary-400 min-h-[44px] flex items-center"
                >
                  Details →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="btn-secondary min-h-[44px] disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-xs text-dark-400">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="btn-secondary min-h-[44px] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
