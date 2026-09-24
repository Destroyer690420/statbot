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
      return 'bg-green-500/10 text-green-400 border-green-500/20';
    case 'warning':
      return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
    case 'danger':
      return 'bg-red-500/10 text-red-400 border-red-500/20';
    case 'info':
      return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    default:
      return 'bg-dark-500/10 text-dark-300 border-dark-600/40';
  }
}
