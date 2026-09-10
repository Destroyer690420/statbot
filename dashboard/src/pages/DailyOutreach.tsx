import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOutreach, saveOutreachSelection, sendOutreachMessage } from '../api/client';
import { Loader2, RefreshCw, Check, X, Users, Send, Save } from 'lucide-react';

interface OutreachTicket {
  channelId: string;
  channelName: string | null;
  taskStatus: 'idle' | 'active' | 'awaiting-submission';
  workerName: string | null;
  selected: boolean;
  available: boolean;
  post: number;
  comment: number;
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <Check className="w-5 h-5 text-green-400" />
  ) : (
    <X className="w-5 h-5 text-dark-600" />
  );
}

function CountCell({ count }: { count: number }) {
  return count === 0 ? (
    <X className="w-5 h-5 text-dark-600" />
  ) : (
    <span className="text-sm font-semibold text-green-400">{count}</span>
  );
}

export function DailyOutreach() {
  const queryClient = useQueryClient();
  const [selectOpen, setSelectOpen] = useState(false);
  const [draft, setDraft] = useState<Map<string, boolean>>(new Map());
  const [sendNote, setSendNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [slotsInput, setSlotsInput] = useState('5');

  const statusQuery = useQuery({
    queryKey: ['outreach'],
    queryFn: getOutreach,
    refetchInterval: 30_000,
  });

  const tickets: OutreachTicket[] = statusQuery.data?.data?.tickets || [];
  const blast: { id: string; slotsTotal: number; slotsFilled: number; status: string } | null =
    statusQuery.data?.data?.blast || null;
  // Channels that replied in the current burst (resets on the next burst).
  const replied = new Set<string>(statusQuery.data?.data?.blastReplied || []);
  const selectedCount = tickets.filter((t) => t.selected).length;
  // Winners float to the top (stable within groups) so only green rows need opening.
  const visibleTickets = tickets
    .filter((t) => t.selected)
    .sort((a, b) => Number(replied.has(b.channelId)) - Number(replied.has(a.channelId)));

  const openSelect = () => {
    setDraft(new Map(tickets.map((t) => [t.channelId, t.selected])));
    setSelectOpen(true);
  };

  const toggleTicket = (channelId: string) => {
    setDraft((prev) => new Map(prev).set(channelId, !(prev.get(channelId) ?? false)));
  };

  const saveMutation = useMutation({
    mutationFn: saveOutreachSelection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outreach'] });
      setSelectOpen(false);
    },
  });

  const sendMutation = useMutation({
    mutationFn: (slots: number) => sendOutreachMessage(slots),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['outreach'] });
      setSlotsOpen(false);
      const sent = res?.data?.sent || [];
      const skipped = res?.data?.skipped || [];
      const blast = res?.data?.blast;
      const okCount = sent.filter((s: any) => s.ok).length;
      const failed = sent.filter((s: any) => !s.ok);
      let text = `Blast for ${blast?.slotsTotal ?? '?'} post(s) sent to ${okCount} ticket(s).`;
      if (skipped.length > 0) text += ` Skipped ${skipped.length} (daily cap / no worker).`;
      if (failed.length > 0) {
        setSendNote({
          ok: false,
          text: `${text} Failed for ${failed.length}: ${failed
            .map((f: any) => `#${f.channelName || f.channelId}`)
            .join(', ')}`,
        });
      } else {
        setSendNote({ ok: true, text });
      }
    },
    onError: (error: Error) => {
      setSendNote({ ok: false, text: `Failed to send message: ${error.message}` });
    },
  });

  const handleSend = () => {
    if (selectedCount === 0) return;
    setSendNote(null);
    setSlotsOpen(true);
  };

  const handleConfirmSend = () => {
    const slots = Math.floor(Number(slotsInput));
    if (!Number.isFinite(slots) || slots < 1 || slots > 500) {
      setSendNote({ ok: false, text: 'Enter posts available as a number from 1 to 500.' });
      return;
    }
    setSendNote(null);
    sendMutation.mutate(slots);
  };

  const handleSaveSelection = () => {
    const selections = Array.from(draft.entries()).map(([channelId, selected]) => ({ channelId, selected }));
    saveMutation.mutate({ selections });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          {selectedCount > 0 ? (
            <>
              <span className="status-badge border bg-primary-500/10 text-primary-400 border-primary-500/20 px-3 py-1">
                {selectedCount} selected
              </span>
              <p className="text-sm text-dark-400">
                They will receive the daily message.
              </p>
            </>
          ) : (
            <p className="text-sm text-dark-400">
              No tickets selected yet — open Select Tickets to add.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openSelect}
            className="btn-secondary flex items-center justify-center gap-1.5 flex-1 md:flex-none text-[13px] md:text-sm py-2 md:py-2.5 px-3 md:px-6"
          >
            <Users className="w-3.5 h-3.5 md:w-4 md:h-4" />
            Select Tickets
          </button>
          <button
            onClick={handleSend}
            disabled={selectedCount === 0 || sendMutation.isPending}
            className="btn-primary flex items-center justify-center gap-1.5 flex-1 md:flex-none text-[13px] md:text-sm py-2 md:py-2.5 px-3 md:px-6"
          >
            {sendMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5 md:w-4 md:h-4" />
            )}
            Send Message
          </button>
          <button
            onClick={() => statusQuery.refetch()}
            disabled={statusQuery.isFetching}
            className="p-2 md:p-2.5 text-dark-400 hover:text-white hover:bg-dark-800 rounded-xl transition-colors disabled:opacity-50 shrink-0"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 md:w-5 md:h-5 ${statusQuery.isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {sendNote && (
        <p className={`text-sm ${sendNote.ok ? 'text-green-400' : 'text-red-400'}`}>
          {sendNote.ok ? '✅ ' : '❌ '}{sendNote.text}
        </p>
      )}

      {blast && blast.status === 'OPEN' && (
        <div className="glass-card px-4 sm:px-6 py-4 flex items-center justify-between gap-3 border-primary-700/20 bg-gradient-to-r from-primary-950/40 to-dark-900/60">
          <p className="text-sm text-dark-100">
            Blast open: <span className="font-semibold text-primary-400">{blast.slotsFilled}/{blast.slotsTotal}</span> replied
          </p>
          <p className="text-xs text-dark-400">Closes automatically at {blast.slotsTotal}; message removed from the rest.</p>
        </div>
      )}

      {/* Slots prompt modal */}
      {slotsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-dark-800 rounded-2xl p-6 w-full max-w-sm mx-4 border border-dark-700 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-white">How many posts available?</h3>
            <p className="text-dark-400 text-sm mt-1 mb-4">
              The message goes to all {selectedCount} selected ticket(s). The first{' '}
              <span className="text-dark-100 font-semibold">{slotsInput || '?'}</span> workers to reply win;
              the message is then deleted for everyone else.
            </p>
            <input
              type="number"
              min={1}
              max={500}
              value={slotsInput}
              onChange={(e) => setSlotsInput(e.target.value)}
              className="input-field w-full text-center text-lg"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setSlotsOpen(false)}
                disabled={sendMutation.isPending}
                className="px-4 py-2 text-sm text-dark-400 hover:text-white transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSend}
                disabled={sendMutation.isPending}
                className="btn-primary flex items-center gap-2 text-sm px-4 py-2"
              >
                {sendMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Send to all
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop Table */}
      <div className="glass-card overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-dark-700/50 bg-dark-800/50">
                <th className="px-6 py-4 font-semibold text-dark-200">Ticket</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Worker</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Available</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Post</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Comment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700/50">
              {statusQuery.isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center">
                    <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto" />
                  </td>
                </tr>
              ) : visibleTickets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-dark-400">
                    No tickets selected yet — open Select Tickets to add.
                  </td>
                </tr>
              ) : (
                visibleTickets.map((t) => (
                  <tr
                    key={t.channelId}
                    className={
                      replied.has(t.channelId)
                        ? 'bg-green-900/10 hover:bg-green-900/20 transition-colors'
                        : 'hover:bg-dark-800/30 transition-colors'
                    }
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-dark-100">
                          #{t.channelName || t.channelId}
                        </span>
                        {t.taskStatus === 'awaiting-submission' && (
                          <span className="text-[10px] font-semibold text-amber-400/80 uppercase tracking-wider">busy</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-dark-200">{t.workerName || '—'}</td>
                    <td className="px-6 py-4"><StatusIcon ok={t.available} /></td>
                    <td className="px-6 py-4"><CountCell count={t.post} /></td>
                    <td className="px-6 py-4"><CountCell count={t.comment} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-4">
        {statusQuery.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
          </div>
        ) : visibleTickets.length === 0 ? (
          <p className="text-center text-dark-400 py-10">No tickets selected yet — open Select Tickets to add.</p>
        ) : (
          visibleTickets.map((t) => (
            <div
              key={t.channelId}
              className={
                replied.has(t.channelId)
                  ? 'glass-card border-green-500/30 bg-green-900/15 overflow-hidden'
                  : 'glass-card border border-dark-700/50 overflow-hidden'
              }
            >
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-mono text-sm text-dark-100 truncate">#{t.channelName || t.channelId}</p>
                  <p className="text-xs text-dark-400 mt-0.5">{t.workerName || '—'}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1 px-4 py-2 border-t border-dark-700/30">
                <div className="flex items-center gap-2">
                  <StatusIcon ok={t.available} />
                  <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider">Available</p>
                </div>
                <div className="flex items-center gap-2">
                  <CountCell count={t.post} />
                  <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider">Post</p>
                </div>
                <div className="flex items-center gap-2">
                  <CountCell count={t.comment} />
                  <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider">Comment</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Select Tickets modal */}
      {selectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-dark-800 rounded-2xl p-6 w-full max-w-md mx-4 border border-dark-700 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Select Tickets</h3>
              <button
                onClick={() => setSelectOpen(false)}
                className="text-dark-500 hover:text-white transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-dark-400 text-sm mb-4">
              Only checked tickets appear on the page and receive the daily message. Selection is remembered.
            </p>
            <div className="overflow-y-auto -mx-2 px-2 space-y-2 flex-1">
              {statusQuery.isLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
                </div>
              ) : tickets.length === 0 ? (
                <p className="text-center text-dark-400 text-sm py-10">No tickets available.</p>
              ) : (
                tickets.map((t) => (
                  <label
                    key={t.channelId}
                    className="flex items-center justify-between px-4 py-3 rounded-xl bg-dark-900/60 border border-dark-700/60 hover:border-primary-500/30 transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={!!draft.get(t.channelId)}
                        onChange={() => toggleTicket(t.channelId)}
                        className="accent-primary-500 w-4 h-4 shrink-0"
                      />
                      <span className="font-mono text-sm text-dark-100 truncate">#{t.channelName || t.channelId}</span>
                      {t.taskStatus === 'awaiting-submission' && (
                        <span className="text-[10px] font-semibold text-amber-400/80 uppercase tracking-wider">busy</span>
                      )}
                    </span>
                    <span className="text-xs text-dark-500 ml-3 shrink-0">{t.workerName || '—'}</span>
                  </label>
                ))
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setSelectOpen(false)}
                disabled={saveMutation.isPending}
                className="px-4 py-2 text-sm text-dark-400 hover:text-white transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSelection}
                disabled={saveMutation.isPending}
                className="btn-primary flex items-center gap-2 text-sm px-4 py-2"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save Selection
              </button>
            </div>
            {saveMutation.isError && (
              <p className="mt-3 text-red-400 text-sm">❌ Failed to save selection: {(saveMutation.error as Error).message}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}