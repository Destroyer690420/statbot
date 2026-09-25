import { Link } from 'react-router-dom';
import { BellRing, CheckCircle2, Clock3, ExternalLink, Wallet } from 'lucide-react';
import { countdownText, formatIST, formatMoney } from '../../utils/workerFormat';
import { WorkerCard, WorkerMiniStat, WorkerStatusPill } from './WorkerUI';

type TaskLike = {
  [key: string]: any;
};

function nextPendingReminder(task: TaskLike) {
  const reminders = Array.isArray(task.reminders) ? task.reminders : [];
  return reminders
    .filter((reminder: TaskLike) => !reminder.completed)
    .sort((a: TaskLike, b: TaskLike) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0];
}

function nextDueAt(task: TaskLike) {
  return task.workerStatus?.nextDueAt || task.dueAt || nextPendingReminder(task)?.dueAt || null;
}

function taskId(task: TaskLike) {
  return task.id || task.taskId || '';
}

function rewardText(task: TaskLike) {
  if (task.payout?.state === 'paid') return formatMoney(task.payout.amount);
  if (task.payout?.state === 'awaiting') return `~${formatMoney(task.payout.amount)} est.`;
  return '—';
}

export function WorkerInsightChips({ task, nowMs }: { task: TaskLike; nowMs: number }) {
  if (task.tab === 'failed') return null;
  const chips: { label: string; className: string; icon: typeof CheckCircle2 }[] = [];
  const reminders = Array.isArray(task.reminders) ? task.reminders : [];
  const isPost = String(task.type).toUpperCase() === 'POST';
  const r20 = reminders.find((reminder: TaskLike) => String(reminder.type).includes('20H'));
  const r70 = reminders.find((reminder: TaskLike) => String(reminder.type).includes('70H'));

  const addChip = (reminder: TaskLike | undefined, label: string) => {
    if (!reminder) return;
    if (reminder.completed) {
      chips.push({
        label: `${label} done`,
        className: 'border-worker-success/25 bg-worker-success/10 text-worker-success',
        icon: CheckCircle2,
      });
    } else if (reminder.sent && new Date(reminder.dueAt).getTime() < nowMs) {
      chips.push({
        label: `${label} overdue`,
        className: 'border-worker-danger/25 bg-worker-danger/10 text-worker-danger',
        icon: Clock3,
      });
    } else if (reminder.sent) {
      chips.push({
        label: `${label} ${countdownText(nowMs, reminder.dueAt)}`,
        className: 'border-worker-warning/25 bg-worker-warning/10 text-worker-warning',
        icon: Clock3,
      });
    } else {
      chips.push({
        label: `${label} due ${formatIST(reminder.dueAt)}`,
        className: 'border-worker-border bg-worker-surface-2 text-worker-text-muted',
        icon: Clock3,
      });
    }
  };

  addChip(r20, '20h');
  if (isPost) addChip(r70, '70h');
  if (chips.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {chips.map((chip) => {
        const Icon = chip.icon;
        return (
          <span key={chip.label} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium ${chip.className}`}>
            <Icon className="h-3 w-3" aria-hidden="true" />
            {chip.label}
          </span>
        );
      })}
    </div>
  );
}

export function WorkerPayoutChip({ task }: { task: TaskLike }) {
  if (task.tab !== 'completed' || !task.payout || task.payout.state === 'none') return null;
  if (task.payout.state === 'paid') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-worker-success/25 bg-worker-success/10 px-2.5 py-1 text-xs font-medium tabular-nums text-worker-success">
        <Wallet className="h-3 w-3" aria-hidden="true" />
        Paid {formatMoney(task.payout.amount)}
        {task.payout.paidAt ? ` · ${formatIST(task.payout.paidAt)}` : ''}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-worker-warning/25 bg-worker-warning/10 px-2.5 py-1 text-xs font-medium tabular-nums text-worker-warning">
      <Wallet className="h-3 w-3" aria-hidden="true" />
      Awaiting ~{formatMoney(task.payout.amount)} est.
    </span>
  );
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
  const typeLabel = task.type || 'Task';

  return (
    <WorkerCard className="worker-card-interactive h-full p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold tracking-tight text-worker-text sm:text-[17px]">{task.displayId}</p>
          <p className="mt-1 truncate text-xs text-worker-text-muted">
            {typeLabel} · {variant === 'action' ? 'Task assigned to you' : task.subreddit ? `r/${task.subreddit}` : 'Reddit'}
          </p>
        </div>
        {variant !== 'action' ? (
          <WorkerStatusPill label={statusLabel} tone={status?.tone} statusKey={statusKey} overdue={overdue} />
        ) : null}
      </div>

      {task.title ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-worker-text-muted">{task.title}</p> : null}

      {variant !== 'action' ? (
        <div className="mt-4 grid grid-cols-3 gap-3 border-y border-worker-border py-3">
          <WorkerMiniStat label="Subreddit" value={task.subreddit ? `r/${task.subreddit}` : '—'} />
          <WorkerMiniStat label={dueAt ? 'Next due' : 'Created'} value={dueAt ? countdownText(nowMs, dueAt) : task.createdAt ? formatIST(task.createdAt) : '—'} />
          <div className="text-right">
            <WorkerMiniStat label="Reward" value={rewardText(task)} emphasis title={task.payout?.state === 'none' || !task.payout ? 'Paid at completion' : undefined} />
          </div>
        </div>
      ) : null}

      {action && shouldShowAction ? (
        <div className={`mt-4 flex items-start gap-2.5 rounded-lg border-l-2 bg-worker-warning/10 px-3 py-2.5 ${overdue ? 'border-worker-danger' : 'border-worker-warning'}`}>
          <BellRing className={`mt-0.5 h-4 w-4 shrink-0 ${overdue ? 'text-worker-danger' : 'text-worker-warning'}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium leading-5 text-worker-text">{action}</p>
            {dueAt ? <p className={`mt-1 text-xs font-semibold ${overdue ? 'text-worker-danger' : 'text-worker-warning'}`}>{countdownText(nowMs, dueAt)}</p> : null}
          </div>
        </div>
      ) : null}

      {variant !== 'action' ? <WorkerInsightChips task={task} nowMs={nowMs} /> : null}
      {variant !== 'action' ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <WorkerPayoutChip task={task} />
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {id ? (
          <Link to={`/worker/tasks/${encodeURIComponent(id)}`} className="worker-primary-button flex-1">
            View task
          </Link>
        ) : null}
        {task.redditLink ? (
          <a href={task.redditLink} target="_blank" rel="noopener noreferrer" className="worker-secondary-button flex-1 sm:flex-none">
            Reddit link
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </WorkerCard>
  );
}
