import { parseFormatDetail, type FormatCheckStatus } from '../utils/redditFormat';

interface Props {
  status?: string | null;
  detail?: string | null;
  taskType?: string;
  hasUrl?: boolean;
  onOpenDiff?: () => void;
}

const STYLES: Record<string, string> = {
  MATCH: 'bg-green-500/10 text-green-400 border-green-500/20',
  PARA_MISMATCH: 'bg-red-500/10 text-red-400 border-red-500/20',
  TITLE_MISMATCH: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  TEXT_MISMATCH: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  FETCH_ERROR: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  DELETED: 'bg-red-500/10 text-red-400 border-red-500/20',
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
    return <span className={`status-badge border ${STYLES.MATCH} px-2 py-0.5 text-[11px]`}>🟢 {counts} Match</span>;
  }
  if (s === 'PARA_MISMATCH') {
    return (
      <button onClick={onOpenDiff} title="Open side-by-side diff" className={`status-badge border ${STYLES.PARA_MISMATCH} px-2 py-0.5 text-[11px] hover:brightness-125 transition`}>
        🔴 {counts} Mismatch
      </button>
    );
  }
  if (s === 'TITLE_MISMATCH' || s === 'TEXT_MISMATCH') {
    return (
      <button onClick={onOpenDiff} title="Open side-by-side diff" className={`status-badge border ${STYLES.TITLE_MISMATCH} px-2 py-0.5 text-[11px] hover:brightness-125 transition`}>
        🟡 {s === 'TITLE_MISMATCH' ? 'Title' : 'Text'} Mismatch
      </button>
    );
  }
  if (s === 'DELETED') {
    return <span className={`status-badge border ${STYLES.DELETED} px-2 py-0.5 text-[11px]`}>🗑️ Deleted</span>;
  }
  return (
    <button onClick={onOpenDiff} title={d?.error || 'Check failed — click to retry via diff view'} className={`status-badge border ${STYLES.FETCH_ERROR} px-2 py-0.5 text-[11px] hover:brightness-125 transition`}>
      ⚠️ Verify failed
    </button>
  );
}
