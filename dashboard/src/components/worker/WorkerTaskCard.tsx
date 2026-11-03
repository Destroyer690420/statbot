import { Link } from 'react-router-dom';
import { ArrowRight, BellRing, ExternalLink } from 'lucide-react';
import { countdownText, formatISTDate, formatMoney } from '../../utils/workerFormat';
import { WorkerCard, WorkerStatusPill } from './WorkerUI';

type TaskLike = {
  [key: string]: any;
};

function taskId(task: TaskLike) {
  return task.id || task.taskId || '';
}

function shortTaskId(task: TaskLike) {
  const display = String(task.displayId || '');
  const stripped = display.replace(/^(POST|COMMENT)\s*#?/i, '');
  return stripped || taskId(task);
}

function nextDueAt(task: TaskLike) {
  return task.workerStatus?.nextDueAt || task.dueAt || null;
}

function rateText(task: TaskLike) {
  const rate = typeof task.rate === 'number' ? task.rate : task.payout?.amount;
  return typeof rate === 'number' && rate > 0 ? formatMoney(rate) : '—';
}

export function WorkerTaskCard({
  task,
  nowMs,
  variant = 'list',
}: {
  task: TaskLike;
  nowMs: number;
  variant?: 'list' | 'action';
}) {
  const status = task.workerStatus;
  const action = task.action || status?.action;
  const shouldShowAction = variant === 'action' || status?.actionRequired === true;
  const dueAt = nextDueAt(task);
  const overdue = task.overdue ?? status?.overdue ?? false;
  const id = taskId(task);
  const statusLabel = status?.label || task.status;
  const statusKey = status?.key || task.statusKey;
  const detailTo = `/worker/tasks/${encodeURIComponent(id)}`;

  return (
    <WorkerCard className="min-w-0 overflow-hidden rounded-lg border-worker-border/60 p-0">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
        <Link to={detailTo} className="min-w-0">
          <span className="block truncate font-mono text-base font-bold tracking-tight text-worker-accent-hover">
            {task.displayId || taskId(task)}
          </span>
        </Link>
        <WorkerStatusPill label={statusLabel} tone={status?.tone} statusKey={statusKey} overdue={overdue} />
      </div>

      <div className="grid grid-cols-3 gap-1 border-t border-worker-border/60 px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-worker-text-faint">Task ID</p>
          <p className="truncate font-mono text-xs font-medium text-worker-text-muted">{shortTaskId(task)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-worker-text-faint">Created</p>
          <p className="truncate text-xs font-medium text-worker-text-muted">{formatISTDate(task.createdAt)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-worker-text-faint">Rate</p>
          <p className="truncate font-mono text-xs font-medium text-worker-text-muted">{rateText(task)}</p>
        </div>
      </div>

      {task.redditLink ? (
        <div className="px-4 py-2">
          <a
            href={task.redditLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-worker-accent-hover transition-colors hover:text-worker-accent"
          >
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="underline decoration-worker-accent-hover/40 underline-offset-2">link</span>
          </a>
        </div>
      ) : (
        <div className="px-4 py-2">
          <span className="text-xs italic text-worker-text-faint">No link yet</span>
        </div>
      )}

      {action && shouldShowAction ? (
        <div className={`mx-4 mb-3 flex items-start gap-2.5 rounded-lg border-l-2 bg-worker-warning/10 px-3 py-2.5 ${overdue ? 'border-worker-danger' : 'border-worker-warning'}`}>
          <BellRing className={`mt-0.5 h-4 w-4 shrink-0 ${overdue ? 'text-worker-danger' : 'text-worker-warning'}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="break-words text-xs font-medium leading-5 text-worker-text">{action}</p>
            {dueAt ? <p className={`mt-1 text-xs font-semibold ${overdue ? 'text-worker-danger' : 'text-worker-warning'}`}>{countdownText(nowMs, dueAt)}</p> : null}
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t border-worker-border/60 bg-worker-surface-2/40 px-4 py-3">
        {id ? (
          <Link
            to={detailTo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-worker-border bg-worker-surface-2 px-3 py-1.5 text-xs font-semibold text-worker-text transition-colors duration-150 hover:border-worker-accent/40 hover:text-worker-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent"
          >
            View task
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </WorkerCard>
  );
}
