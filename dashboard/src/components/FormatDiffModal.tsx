import { useEffect, useState } from 'react';
import { Loader2, ExternalLink, X, RefreshCw } from 'lucide-react';
import { fetchRedditPostLive } from '../utils/redditFetch';
import { normalizeInline, splitParagraphs } from '../utils/redditFormat';
import { recheckFormat, getLiveReddit } from '../api/client';

interface Props {
  task: any;
  onClose: () => void;
  onRechecked?: () => void;
}

export function FormatDiffModal({ task, onClose, onRechecked }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<{ title: string; selftext: string } | null>(null);
  const [source, setSource] = useState<'server' | 'browser' | null>(null);
  const [rechecking, setRechecking] = useState(false);

  const expectedTitle: string = task.title || '';
  const expectedParas = splitParagraphs(task.formattedContent || '');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSource(null);
    // Server snapshot first: the browser-direct fetch is anonymous and
    // Reddit 403s it, so it only serves as a fallback for true server
    // outages. Session problems (NO_SESSION / SESSION_EXPIRED / NO_URL)
    // are final — retrying anonymously cannot fix them.
    getLiveReddit(task.id)
      .then((res) => {
        if (cancelled) return;
        if (res?.success && res?.data) {
          setLive({ title: res.data.title || '', selftext: res.data.selftext || '' });
          setSource('server');
          setLoading(false);
        } else {
          throw { response: { data: res } };
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const serverStatus = err?.response?.data?.status as string | undefined;
        const serverMessage = err?.response?.data?.message as string | undefined;
        if (serverStatus === 'NO_SESSION' || serverStatus === 'SESSION_EXPIRED' || serverStatus === 'NO_URL') {
          setError(serverMessage || 'Server snapshot unavailable.');
          setLoading(false);
          return;
        }
        fetchRedditPostLive(task.submittedRedditUrl)
          .then((p) => {
            if (!cancelled) {
              setLive({ title: p.title, selftext: p.selftext });
              setSource('browser');
              setLoading(false);
            }
          })
          .catch((e: Error) => {
            if (!cancelled) {
              setError(serverMessage || e.message);
              setLoading(false);
            }
          });
      });
    return () => {
      cancelled = true;
    };
  }, [task.id, task.submittedRedditUrl]);

  const actualParas = live ? splitParagraphs(live.selftext) : [];
  const titleOk = live ? normalizeInline(expectedTitle) === normalizeInline(live.title) : false;

  const handleRecheck = async () => {
    setRechecking(true);
    try {
      await recheckFormat(task.id);
      onRechecked?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recheck failed.');
    } finally {
      setRechecking(false);
    }
  };

  const maxRows = Math.max(expectedParas.length, actualParas.length);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-dark-800 rounded-lg w-full max-w-4xl max-h-[85vh] flex flex-col border border-dark-700 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-700/50">
          <div>
            <h3 className="text-base font-semibold text-text-primary">Format check — {task.externalTaskId ? `Post #${task.externalTaskId}` : task.id}</h3>
            <a href={task.submittedRedditUrl} target="_blank" rel="noreferrer" className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 mt-0.5">
              Open on Reddit <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRecheck}
              disabled={rechecking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-500/10 text-primary-400 border border-primary-500/30 hover:bg-primary-500/20 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {rechecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Recheck
            </button>
            <button onClick={onClose} className="text-dark-500 hover:text-text-primary transition-colors" title="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            </div>
          ) : error ? (
            <p className="text-sm text-warning bg-warning-muted border border-warning/30 rounded-lg p-3">{error}</p>
          ) : (
            <>
              <div className="text-[11px] text-dark-500">
                Live copy via {source === 'server' ? 'server session (spare Reddit account)' : 'your browser (fallback — may be rate-limited)'}.
              </div>
              <div className={`rounded-lg border p-3 text-sm ${titleOk ? 'border-success/30 bg-success-muted text-success' : 'border-warning/30 bg-warning-muted text-warning'}`}>
                <p className="text-[11px] font-semibold uppercase tracking-wider opacity-70 mb-1">{titleOk ? '✓ Title matches' : '✗ Title differs'}</p>
                <p><span className="opacity-60">Expected:</span> {expectedTitle || '(none)'}</p>
                <p><span className="opacity-60">Reddit:</span> {live?.title || '(none)'}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-dark-300 uppercase tracking-wider mb-2">Sent to worker ({expectedParas.length} ¶)</p>
                  <div className="space-y-2">
                    {expectedParas.map((p, i) => {
                      const match = live ? normalizeInline(p) === normalizeInline(actualParas[i] ?? '') : false;
                      return (
                        <div key={i} className={`rounded-lg border p-2.5 text-xs whitespace-pre-wrap break-words ${match ? 'border-success/30 bg-success-muted' : 'border-danger/30 bg-danger-muted'}`}>
                          <span className="font-mono opacity-50">¶{i + 1} </span>{p}
                        </div>
                      );
                    })}
                    {expectedParas.length === 0 && <p className="text-xs text-dark-500 italic">(image-only post, no text sent)</p>}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-dark-300 uppercase tracking-wider mb-2">Live on Reddit ({actualParas.length} ¶)</p>
                  <div className="space-y-2">
                    {Array.from({ length: maxRows }).map((_, i) => {
                      const a = actualParas[i];
                      if (a === undefined) {
                        return <div key={i} className="rounded-lg border border-danger/30 bg-danger-muted p-2.5 text-xs text-danger">¶{i + 1} missing on Reddit</div>;
                      }
                      const match = normalizeInline(expectedParas[i] ?? '') === normalizeInline(a);
                      return (
                        <div key={i} className={`rounded-lg border p-2.5 text-xs whitespace-pre-wrap break-words ${match ? 'border-success/30 bg-success-muted' : 'border-warning/30 bg-warning-muted'}`}>
                          <span className="font-mono opacity-50">¶{i + 1} </span>{a}
                        </div>
                      );
                    })}
                    {actualParas.length === 0 && <p className="text-xs text-dark-500 italic">(empty selftext on Reddit)</p>}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
