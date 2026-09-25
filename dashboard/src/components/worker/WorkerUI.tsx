import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Check, Copy, Inbox, RefreshCw } from 'lucide-react';

export function WorkerCard({ children, className = '', id, as: Tag = 'div' }: { children: ReactNode; className?: string; id?: string; as?: 'div' | 'section' }) {
  return <Tag id={id} className={`worker-card ${className}`}>{children}</Tag>;
}

export function WorkerPageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6 lg:hidden">
      <h1 className="font-display text-xl font-bold tracking-tight text-worker-text sm:text-2xl">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-worker-text-muted">{subtitle}</p> : null}
    </div>
  );
}

export function WorkerSectionHeading({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <h2 className="font-display text-base font-semibold text-worker-text">{title}</h2>
      {detail ? <span className="text-xs text-worker-text-muted">{detail}</span> : null}
    </div>
  );
}

function statusTone(statusKey: string | undefined, tone: string | undefined): string {
  if (statusKey === 'payable') return 'warning';
  if (statusKey === 'paid' || tone === 'success') return 'success';
  if (tone === 'warning') return 'warning';
  if (statusKey === 'failed' || statusKey === 'deleted' || statusKey === 'cancelled' || tone === 'danger') {
    return 'danger';
  }
  if (statusKey === 'action-needed' || tone === 'info') return 'info';
  return 'neutral';
}

const statusClasses: Record<string, string> = {
  success: 'border-worker-success/25 bg-worker-success/10 text-worker-success',
  warning: 'border-worker-warning/25 bg-worker-warning/10 text-worker-warning',
  danger: 'border-worker-danger/25 bg-worker-danger/10 text-worker-danger',
  info: 'border-worker-info/25 bg-worker-info/10 text-worker-info',
  neutral: 'border-worker-border bg-worker-surface-2 text-worker-text-muted',
};

export function WorkerStatusPill({
  label,
  tone,
  statusKey,
  overdue = false,
}: {
  label: string | null | undefined;
  tone?: string | null;
  statusKey?: string | null;
  overdue?: boolean;
}) {
  if (!label) return null;
  const resolvedTone = statusTone(statusKey || undefined, tone || undefined);
  const urgent = overdue && (statusKey === 'insight_20_due' || statusKey === 'insight_70_due' || statusKey === 'action-needed');
  return (
    <span
      title={label}
      className={`inline-flex max-w-[52%] shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-none ${statusClasses[resolvedTone]}`}
    >
      {urgent ? <span className="h-1.5 w-1.5 rounded-full bg-worker-danger motion-safe:animate-pulse" aria-hidden="true" /> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

export function WorkerMiniStat({ label, value, emphasis = false, title }: { label: string; value: string; emphasis?: boolean; title?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-worker-text-faint sm:text-xs">{label}</p>
      <p title={title} className={`mt-1 truncate text-sm font-semibold tabular-nums ${emphasis ? 'text-worker-text' : 'text-worker-text-muted'}`}>
        {value}
      </p>
    </div>
  );
}

export function WorkerSkeleton({ className = '' }: { className?: string }) {
  return <div className={`worker-skeleton ${className}`} aria-hidden="true" />;
}

export function WorkerErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <WorkerCard className="p-6 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-worker-danger/10 text-worker-danger">
        <AlertCircle className="h-5 w-5" aria-hidden="true" />
      </div>
      <p className="mt-3 text-sm text-worker-text-muted">{message}</p>
      <button type="button" onClick={onRetry} className="worker-secondary-button mt-4">
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Retry
      </button>
    </WorkerCard>
  );
}

export function WorkerEmptyState({ message, icon }: { message: string; icon?: ReactNode }) {
  return (
    <WorkerCard className="p-8 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-worker-surface-2 text-worker-text-faint">
        {icon || <Inbox className="h-5 w-5" aria-hidden="true" />}
      </div>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-worker-text-muted">{message}</p>
    </WorkerCard>
  );
}

function fallbackCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  document.body.removeChild(textarea);
  return copied;
}

export function WorkerCopyButton({ value, label = 'Copy link' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = async () => {
    let didCopy = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        didCopy = true;
      }
    } catch {
      didCopy = false;
    }
    if (!didCopy) didCopy = fallbackCopy(value);
    if (!didCopy) return;
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : label}
      aria-label={copied ? 'Copied!' : label}
      className={`worker-icon-button ${copied ? 'text-worker-success' : ''}`}
    >
      {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}
