import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock3, ExternalLink, Wallet } from 'lucide-react';
import { getWorkerTask, workerErrorMessage } from '../../api/workerApi';
import { formatIST, formatMoney } from '../../utils/workerFormat';
import { WorkerCard, WorkerCopyButton, WorkerErrorState, WorkerSkeleton, WorkerStatusPill } from '../../components/worker/WorkerUI';

export default function WorkerTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['worker-task', id],
    queryFn: () => getWorkerTask(id || ''),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <WorkerSkeleton className="h-11 w-32" />
        <WorkerSkeleton className="h-56 w-full" />
        <WorkerSkeleton className="h-44 w-full" />
        <WorkerSkeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data?.success) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link to="/worker/tasks" className="worker-ghost-button -ml-2 px-2">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to tasks
        </Link>
        <WorkerErrorState message={workerErrorMessage(data, 'Task not found.')} onRetry={() => refetch()} />
      </div>
    );
  }

  const task = data.data.task;
  const timeline = data.data.timeline || [];
  const reminders = Array.isArray(task.reminders) ? task.reminders : [];
  const payout = task.payout || { state: 'none', amount: 0 };
  const status = task.workerStatus;
  const overdue = Boolean(status?.overdue);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/worker/tasks" className="worker-ghost-button -ml-2 px-2">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to tasks
      </Link>

      <WorkerCard className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-worker-text-muted">Task details</p>
            <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-worker-text sm:text-3xl">{task.displayId}</h1>
            <p className="mt-2 text-sm text-worker-text-muted">
              {task.type} · {task.subreddit ? `r/${task.subreddit}` : 'Reddit'} · {formatIST(task.createdAt)}
            </p>
          </div>
          <WorkerStatusPill label={status?.label} tone={status?.tone} statusKey={status?.key} overdue={overdue} />
        </div>
        {task.title ? <p className="mt-5 text-sm leading-6 text-worker-text-muted">{task.title}</p> : null}
      </WorkerCard>

      {status?.actionRequired && status.action ? (
        <div className={`rounded-xl border border-l-2 px-4 py-4 ${overdue ? 'border-worker-border border-l-worker-danger bg-worker-danger/10' : 'border-worker-border border-l-worker-warning bg-worker-warning/10'}`}>
          <p className="text-xs font-semibold text-worker-text-muted">What to do next</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-worker-text">{status.action}</p>
          {status.hint ? <p className="mt-1 text-xs leading-5 text-worker-text-muted">{status.hint}</p> : null}
        </div>
      ) : null}

      {task.redditLink ? (
        <WorkerCard className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-worker-text-muted">Reddit link</p>
              <a href={task.redditLink} target="_blank" rel="noopener noreferrer" className="mt-1 flex min-w-0 items-center gap-1.5 text-sm font-medium text-worker-accent hover:text-worker-accent-hover">
                <span className="truncate">{task.redditLink}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </a>
            </div>
            <WorkerCopyButton value={task.redditLink} label="Copy Reddit link" />
          </div>
          {task.subreddit ? <p className="mt-4 border-t border-worker-border pt-3 text-xs text-worker-text-muted">Subreddit: <span className="font-medium text-worker-text">r/{task.subreddit}</span></p> : null}
        </WorkerCard>
      ) : null}

      <WorkerCard className="p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-worker-accent" aria-hidden="true" />
          <h2 className="font-display text-base font-semibold text-worker-text">Insights</h2>
        </div>
        {reminders.length === 0 ? (
          <p className="text-sm text-worker-text-muted">No insights needed for this task.</p>
        ) : (
          <ul className="space-y-2">
            {reminders.map((reminder: any) => {
              const isCompleted = Boolean(reminder.completed);
              const state = isCompleted ? 'Submitted' : reminder.sent ? 'Awaiting your screenshot' : 'Not sent yet';
              return (
                <li key={reminder.type} className="rounded-lg border border-worker-border bg-worker-surface-2 p-3">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${isCompleted ? 'bg-worker-success/10 text-worker-success' : 'bg-worker-surface text-worker-text-faint'}`}>
                      {isCompleted ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Clock3 className="h-4 w-4" aria-hidden="true" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-worker-text">{String(reminder.type).includes('70H') ? '70h insight' : '20h insight'}</p>
                        <span className={`text-xs font-medium ${isCompleted ? 'text-worker-success' : 'text-worker-text-muted'}`}>{state}</span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-worker-text-muted">
                        Due {formatIST(reminder.dueAt)}
                        {reminder.sent && reminder.sentAt ? ` · reminder sent ${formatIST(reminder.sentAt)}` : ''}
                        {reminder.retryCount > 0 ? ` · retries ${reminder.retryCount}` : ''}
                        {reminder.completed && reminder.completedAt ? ` · submitted ${formatIST(reminder.completedAt)}` : ''}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </WorkerCard>

      <WorkerCard className="p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-worker-accent" aria-hidden="true" />
          <h2 className="font-display text-base font-semibold text-worker-text">Payout</h2>
        </div>
        {payout.state === 'paid' ? (
          <div>
            <p className="font-display text-2xl font-bold tabular-nums text-worker-success">{formatMoney(payout.amount)}</p>
            <p className="mt-1 text-sm text-worker-text-muted">
              Paid{payout.paidAt ? ` ${formatIST(payout.paidAt)}` : ''}
              {payout.batchNumber ? ` · Batch #${payout.batchNumber}` : ''}
              {payout.weekLabel ? ` · ${payout.weekLabel}` : ''}
            </p>
          </div>
        ) : payout.state === 'awaiting' ? (
          <div>
            <p className="font-display text-2xl font-bold tabular-nums text-worker-warning">~{formatMoney(payout.amount)}</p>
            <p className="mt-1 text-sm text-worker-text-muted">Awaiting payment · estimated at today&apos;s rates</p>
          </div>
        ) : (
          <p className="text-sm text-worker-text-muted">Not payable.</p>
        )}
      </WorkerCard>

      <WorkerCard className="p-4 sm:p-5">
        <div className="mb-5 flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-worker-accent" aria-hidden="true" />
          <h2 className="font-display text-base font-semibold text-worker-text">Timeline</h2>
        </div>
        {timeline.length === 0 ? (
          <p className="text-sm text-worker-text-muted">No timeline entries yet.</p>
        ) : (
          <ol className="relative ml-2 border-l border-worker-border">
            {timeline.map((entry: any) => (
              <li key={entry.key} className="relative pb-6 pl-6 last:pb-0">
                <span className={`absolute -left-[5px] top-0.5 h-2.5 w-2.5 rounded-full border-2 border-worker-surface ${entry.done ? 'bg-worker-success' : 'bg-worker-text-faint'}`} aria-hidden="true" />
                <p className={`text-sm font-medium ${entry.done ? 'text-worker-text' : 'text-worker-text-muted'}`}>{entry.label}</p>
                {entry.at ? <p className="mt-1 text-xs text-worker-text-faint">{formatIST(entry.at)}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </WorkerCard>
    </div>
  );
}
