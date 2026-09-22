import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getWorkerMe, getWorkerTasks, getWorkerTask } from '../api/worker';
import { useWorkerAuth } from '../hooks/useWorkerAuth';

const PAGE_SIZE = 15;

function statusColor(status: string) {
  switch (status) {
    case 'COMPLETED':
    case 'ARCHIVED':
      return 'bg-green-500/10 text-green-400 border-green-500/20';
    case 'CANCELLED':
      return 'bg-red-500/10 text-red-400 border-red-500/20';
    case 'PENDING':
      return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
    default:
      return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function WorkerDashboard() {
  const { identity, logout } = useWorkerAuth();
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: meData, isLoading: meLoading } = useQuery({
    queryKey: ['worker-me'],
    queryFn: getWorkerMe,
  });

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['worker-tasks', statusFilter, typeFilter, page],
    queryFn: () =>
      getWorkerTasks({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(typeFilter ? { type: typeFilter } : {}),
        limit: PAGE_SIZE,
        page,
      }),
  });

  const { data: detailData } = useQuery({
    queryKey: ['worker-task', selectedId],
    queryFn: () => getWorkerTask(selectedId!),
    enabled: !!selectedId,
  });

  const me = meData?.data;
  const tasks: any[] = tasksData?.tasks || [];
  const total: number = tasksData?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const detail = detailData?.data;

  return (
    <div className="min-h-screen bg-dark-950 text-white">
      <header className="border-b border-dark-700/50 px-4 py-4 flex items-center justify-between max-w-5xl mx-auto">
        <div>
          <h1 className="text-xl font-bold">My Tasks</h1>
          <p className="text-sm text-dark-400">
            #{identity?.channelName || me?.channelName || '…'}
            {me?.workerName ? ` · ${me.workerName}` : ''}
          </p>
        </div>
        <Link to="/worker-login" onClick={logout} className="text-sm text-dark-300 underline">
          Log out
        </Link>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {meLoading ? (
          <p className="text-dark-400">Loading your summary…</p>
        ) : me ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              ['Total', me.totals.all],
              ['Posts', me.totals.posts],
              ['Comments', me.totals.comments],
              ['Completed', me.totals.completed],
              ['Active', me.totals.active],
              ['Cancelled', me.totals.cancelled],
            ].map(([label, value]) => (
              <div key={label} className="glass-card rounded-xl p-4 border border-dark-700/50 text-center">
                <div className="text-2xl font-extrabold">{value}</div>
                <div className="text-xs text-dark-400 mt-1">{label}</div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3 items-center">
          <select
            className="input-field"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {['PENDING', 'REMINDER_20_SENT', 'INSIGHT_20_RECEIVED', 'REMINDER_70_SENT', 'INSIGHT_70_RECEIVED', 'COMPLETED', 'ARCHIVED', 'CANCELLED', 'ACCEPTED'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="input-field"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Posts + comments</option>
            <option value="POST">Posts</option>
            <option value="COMMENT">Comments</option>
          </select>
        </div>

        {tasksLoading ? (
          <p className="text-dark-400">Loading tasks…</p>
        ) : tasks.length === 0 ? (
          <p className="text-dark-400">No tasks found for this filter.</p>
        ) : (
          <div className="space-y-3">
            {tasks.map((t: any) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className="w-full text-left glass-card rounded-xl p-4 border border-dark-700/50 hover:border-primary-500/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-mono text-sm text-dark-200">{t.id}</span>
                  <span className={`text-xs px-2 py-1 rounded-full border ${statusColor(t.status)}`}>
                    {t.status}
                  </span>
                </div>
                <div className="mt-1 text-sm">
                  <span className="text-dark-400">{t.type}</span>
                  {t.title ? <span className="ml-2">{t.title}</span> : null}
                  {t.subreddit ? <span className="ml-2 text-dark-400">r/{t.subreddit}</span> : null}
                </div>
                <div className="mt-1 text-xs text-dark-400">
                  Created {formatDate(t.createdAt)}
                  {t.submittedRedditUrl ? ' · URL submitted' : ''}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            className="btn-primary px-4 py-2 disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="text-sm text-dark-400">
            Page {page} of {totalPages} ({total} tasks)
          </span>
          <button
            className="btn-primary px-4 py-2 disabled:opacity-40"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>

        {selectedId && detail && (
          <div className="glass-card rounded-xl p-5 border border-primary-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">Task {detail.task.id}</h2>
              <button onClick={() => setSelectedId(null)} className="text-sm underline text-dark-300">
                Close
              </button>
            </div>
            <div className="text-sm space-y-1">
              <p>Type: {detail.task.type}</p>
              <p>Status: {detail.task.status}</p>
              <p>Created: {formatDate(detail.task.createdAt as string)}</p>
              {detail.task.title ? <p>Title: {detail.task.title}</p> : null}
              {detail.task.subreddit ? <p>Subreddit: r/{detail.task.subreddit}</p> : null}
              {detail.task.submittedRedditUrl ? (
                <p>
                  Submitted:{' '}
                  <a className="underline" href={detail.task.submittedRedditUrl as string} target="_blank" rel="noreferrer">
                    {detail.task.submittedRedditUrl}
                  </a>
                </p>
              ) : null}
              {detail.task.payment ? <p>Payment: {detail.task.payment}</p> : null}
              {detail.task.deadline ? <p>Deadline: {detail.task.deadline}</p> : null}
            </div>
            <div className="mt-2">
              <h3 className="font-semibold text-sm mb-1">Reminders</h3>
              {(detail.reminders as any[]).length === 0 ? (
                <p className="text-sm text-dark-400">No reminders yet.</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {(detail.reminders as any[]).map((r: any) => (
                    <li key={r.id}>
                      {r.type} — {r.completed ? `done ${formatDate(r.completedAt)}` : r.sent ? `sent ${formatDate(r.sentAt)}` : `due ${formatDate(r.dueAt)}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
