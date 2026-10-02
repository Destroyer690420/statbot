import { parseFormatDetail, type FormatCheckStatus } from '../utils/redditFormat';

interface Props {
  status?: string | null;
  detail?: string | null;
  taskType?: string;
  hasUrl?: boolean;
  onOpenDiff?: () => void;
}

const STYLES: Record<string, string> = {
  MATCH: 'bg-success-muted text-success border-success/30',
  PARA_MISMATCH: 'bg-danger-muted text-danger border-danger/30',
  TITLE_MISMATCH: 'bg-warning-muted text-warning border-warning/30',
  TEXT_MISMATCH: 'bg-warning-muted text-warning border-warning/30',
  FETCH_ERROR: 'bg-warning-muted text-warning border-warning/30',
  DELETED: 'bg-danger-muted text-danger border-danger/30',
  NO_SESSION: 'bg-dark-700/40 text-dark-300 border-dark-600/50',
  SESSION_EXPIRED: 'bg-warning-muted text-warning border-warning/30',
  NONE: 'bg-dark-700/40 text-dark-400 border-dark-600/50',
};

export function FormatBadge({ status, detail, taskType, hasUrl, onOpenDiff }: Props) {
  if (taskType === 'COMMENT') {
    return <span className={`status-badge border ${STYLES.NONE} px-2 py-0.5 text-[11px]`}>—</span>;
  }
  if (!hasUrl) {
    return <span className={`status-badge border ${STYLES.NONE} px-2 py-0.5 text-[11px]`}>No URL</span>;
  }
  if (!status) {
    return <span className={`status-badge border ${STYLES.NONE} px-2 py-0.5 text-[11px]`}>Unchecked</span>;
  }
  const d = parseFormatDetail(detail);
  const counts = d ? `${d.actualParas}/${d.expectedParas} ¶` : '';
  const s = status as FormatCheckStatus;

  if (s === 'MATCH') {
    return <span className={`status-badge border ${STYLES.MATCH} px-2 py-0.5 text-[11px]`}>{counts} Match</span>;
  }
  if (s === 'PARA_MISMATCH') {
    return (
      <button onClick={onOpenDiff} title="Open side-by-side diff" className={`status-badge border ${STYLES.PARA_MISMATCH} px-2 py-0.5 text-[11px] hover:brightness-125 transition`}>
        {counts} Mismatch
      </button>
    );
  }
  if (s === 'TITLE_MISMATCH' || s === 'TEXT_MISMATCH') {
    return (
      <button onClick={onOpenDiff} title="Open side-by-side diff" className={`status-badge border ${STYLES.TITLE_MISMATCH} px-2 py-0.5 text-[11px] hover:brightness-125 transition`}>
        {s === 'TITLE_MISMATCH' ? 'Title' : 'Text'} Mismatch
      </button>
    );
  }
  if (s === 'DELETED') {
    return <span className={`status-badge border ${STYLES.DELETED} px-2 py-0.5 text-[11px]`}>Deleted</span>;
  }
  if (s === 'NO_SESSION') {
    return (
      <button onClick={onOpenDiff} title="Reddit session not configured — open for setup hint" className={`status-badge border ${STYLES.NO_SESSION} px-2 py-0.5 text-[11px] hover:brightness-125 transition`}>
        No session
      </button>
    );
  }
  if (s === 'SESSION_EXPIRED') {
    return (
      <button onClick={onOpenDiff} title="Reddit session expired — re-paste the cookie in Settings, then Recheck" className={`status-badge border ${STYLES.SESSION_EXPIRED} px-2 py-0.5 text-[11px] hover:brightness-125 transition`}>
        Session expired
      </button>
    );
  }
  return (
    <button onClick={onOpenDiff} title={d?.error || 'Check failed — click to retry via diff view'} className={`status-badge border ${STYLES.FETCH_ERROR} px-2 py-0.5 text-[11px] hover:brightness-125 transition`}>
      Verify failed
    </button>
  );
}
