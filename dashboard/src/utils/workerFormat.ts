export function formatMoney(amount: number): string {
  const rounded = Math.round((amount || 0) * 100) / 100;
  const str = Number.isInteger(rounded)
    ? rounded.toLocaleString('en-IN', { maximumFractionDigits: 0 })
    : rounded.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  return `\u20B9${str}`;
}

export function formatIST(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export function formatISTDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function countdownText(nowMs: number, dueAt: string | null): string {
  if (!dueAt) return '';
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return '';
  const diff = due - nowMs;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const core = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return diff < 0 ? `${core} overdue` : `in ${core}`;
}

export function tonePill(tone: string): string {
  switch (tone) {
    case 'success':
      return 'border-worker-success/25 bg-worker-success/10 text-worker-success';
    case 'warning':
      return 'border-worker-warning/25 bg-worker-warning/10 text-worker-warning';
    case 'danger':
      return 'border-worker-danger/25 bg-worker-danger/10 text-worker-danger';
    case 'info':
      return 'border-worker-info/25 bg-worker-info/10 text-worker-info';
    case 'muted':
      return 'border-worker-border bg-worker-surface-2 text-worker-text-muted';
    default:
      return 'border-worker-border bg-worker-surface-2 text-worker-text-muted';
  }
}
