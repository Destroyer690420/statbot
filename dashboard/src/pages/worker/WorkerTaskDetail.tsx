import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { getWorkerTask, workerErrorMessage } from '../../api/workerApi';
import { formatMoney, formatIST, tonePill } from '../../utils/workerFormat';

export default function WorkerTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['worker-task', id],
    queryFn: () => getWorkerTask(id || ''),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-32 glass-card animate-pulse" />
        <div className="h-48 glass-card animate-pulse" />
      </div>
    );
  }

  if (isError || !data?.success) {
    return (
      <div className="space-y-4">
        <Link to="/worker/tasks" className="text-xs text-primary-400 min-h-[44px] flex items-center">
          ← Back to tasks
        </Link>
        <div className="glass-card p-6 text-center space-y-3">
          <p className="text-sm text-red-400">{workerErrorMessage(data, 'Task not found.')}</p>
          <button onClick={() => refetch()} className="btn-secondary min-h-[44px]">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const task = data.data.task;
  const timeline = data.data.timeline || [];

  return (
    <div className="space-y-4">
      <Link to="/worker/tasks" className="text-xs text-primary-400 min-h-[44px] flex items-center">
        ← Back to tasks
      </Link>

      <div className="glass-card p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-white">{task.displayId}</h1>
            <p className="text-xs text-dark-400 mt-0.5">
              {task.type} · {task.subreddit ? `r/${task.subreddit}` : 'Reddit'} · {formatIST(task.createdAt)}
            </p>
          </div>
          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] border ${tonePill(task.workerStatus?.tone)}`}>
            {task.workerStatus?.label}
          </span>
        </div>
        {task.title && <p className="text-sm text-dark-200 mt-2">{task.title}</p>}
        {task.workerStatus?.action && (
          <p className="text-sm text-yellow-300 mt-2 font-medium">What to do next: {task.workerStatus.action}</p>
        )}
        {task.workerStatus?.hint && <p className="text-xs text-dark-300 mt-1">{task.workerStatus.hint}</p>}
        {task.redditLink && (
          <a
            href={task.redditLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary-400 flex items-center gap-1 mt-2 min-h-[44px]"
          >
            <ExternalLink className="w-4 h-4" />
            Open Reddit link
          </a>
        )}
      </div>

      <div className="glass-card p-4">
        <h2 className="font-semibold text-white mb-2">Insights</h2>
        {task.reminders.length === 0 ? (
          <p className="text-sm text-dark-400">No insights needed for this task.</p>
        ) : (
          <ul className="space-y-2">
            {task.reminders.map((r: any) => (
              <li key={r.type} className="rounded-xl border border-dark-700 bg-dark-800/60 px-3 py-2.5 text-xs">
                <p className="font-medium text-white">
                  {r.type.includes('70H') ? '70h insight' : '20h insight'} — {r.completed ? 'submitted ✓' : r.sent ? 'awaiting your screenshot' : `due ${formatIST(r.dueAt)}`}
                </p>
                <p className="text-dark-400 mt-0.5">
                  Due {formatIST(r.dueAt)}
                  {r.sent && r.sentAt ? ` · reminder sent ${formatIST(r.sentAt)}` : ''}
                  {r.retryCount > 0 ? ` · retries ${r.retryCount}` : ''}
                  {r.completed && r.completedAt ? ` · submitted ${formatIST(r.completedAt)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="glass-card p-4">
        <h2 className="font-semibold text-white mb-2">Payout</h2>
        {task.payout.state === 'paid' ? (
          <p className="text-sm text-green-400">
            Paid {formatMoney(task.payout.amount)}
            {task.payout.paidAt ? ` · ${formatIST(task.payout.paidAt)}` : ''}
            {task.payout.batchNumber ? ` · Batch #${task.payout.batchNumber}` : ''}
            {task.payout.weekLabel ? ` · ${task.payout.weekLabel}` : ''}
          </p>
        ) : task.payout.state === 'awaiting' ? (
          <p className="text-sm text-blue-400">Awaiting ~{formatMoney(task.payout.amount)} (estimated)</p>
        ) : (
          <p className="text-sm text-dark-400">Not payable.</p>
        )}
      </div>

      <div className="glass-card p-4">
        <h2 className="font-semibold text-white mb-2">Timeline</h2>
        <ol className="space-y-2">
          {timeline.map((t: any) => (
            <li key={t.key} className="flex gap-2 text-xs">
              <span className={t.done ? 'text-green-400' : 'text-dark-500'}>{t.done ? '●' : '○'}</span>
              <div>
                <p className="text-dark-200">{t.label}</p>
                {t.at && <p className="text-dark-500">{formatIST(t.at)}</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
