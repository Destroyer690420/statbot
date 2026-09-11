import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Play,
  Square,
  FlaskConical,
  KeyRound,
  Ban,
  Send,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  getAutomationStatus,
  getAutomationCycles,
  getAutomationCycle,
  getBlockedSubreddits,
  getAutomationCompanion,
  getAutomationClaims,
  updateAutomationSettings,
  startAutomationCycle,
  stopAutomation,
  addBlockedSubreddit,
  removeBlockedSubreddit,
  saveAutomationSession,
  sendTestContact,
  sendTestAccept,
  sendRehearse,
} from '../api/client';

function errMsg(e: unknown): string {
  return (e as { response?: { data?: { message?: string } } }).response?.data?.message || (e as Error).message || 'error';
}

export function Automation() {
  const queryClient = useQueryClient();
  const [subInput, setSubInput] = useState('');
  const [session, setSession] = useState({ sessionToken: '', csrfToken: '', nextAction: '' });
  const [selectedCycle, setSelectedCycle] = useState<string | null>(null);
  const [testChannel, setTestChannel] = useState('');
  const [testTaskId, setTestTaskId] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [rehearseTask, setRehearseTask] = useState('');
  const [rehearseChannel, setRehearseChannel] = useState('');
  const [rehearseSub, setRehearseSub] = useState('');
  const [rehearseLive, setRehearseLive] = useState(false);
  const [rehearseResult, setRehearseResult] = useState<{ ok: boolean; text: string } | null>(null);

  const statusQuery = useQuery({ queryKey: ['automation-status'], queryFn: getAutomationStatus, refetchInterval: 30000 });
  const cyclesQuery = useQuery({ queryKey: ['automation-cycles'], queryFn: getAutomationCycles, refetchInterval: 60000 });
  const blockedQuery = useQuery({ queryKey: ['automation-blocked'], queryFn: getBlockedSubreddits });
  const companionQuery = useQuery({ queryKey: ['automation-companion'], queryFn: getAutomationCompanion, refetchInterval: 60000 });
  const claimsQuery = useQuery({ queryKey: ['automation-claims'], queryFn: getAutomationClaims, refetchInterval: 60000 });
  const detailQuery = useQuery({
    queryKey: ['automation-cycle', selectedCycle],
    queryFn: () => getAutomationCycle(selectedCycle as string),
    enabled: !!selectedCycle,
  });

  const status = statusQuery.data?.data;
  const cycles: Record<string, unknown>[] = cyclesQuery.data?.data || [];
  const blocked: { subreddit: string; reason: string | null }[] = blockedQuery.data?.data || [];
  const companion = companionQuery.data?.data;
  const claims: Record<string, unknown>[] = claimsQuery.data?.data || [];
  const detail = detailQuery.data?.data;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['automation-status'] });
    queryClient.invalidateQueries({ queryKey: ['automation-cycles'] });
    queryClient.invalidateQueries({ queryKey: ['automation-blocked'] });
    queryClient.invalidateQueries({ queryKey: ['automation-companion'] });
    queryClient.invalidateQueries({ queryKey: ['automation-claims'] });
  };

  const settingsMutation = useMutation({
    mutationFn: updateAutomationSettings,
    onSuccess: invalidate,
  });
  const startMutation = useMutation({ mutationFn: () => startAutomationCycle(true), onSuccess: invalidate });
  const stopMutation = useMutation({ mutationFn: stopAutomation, onSuccess: invalidate });
  const addBlockedMutation = useMutation({
    mutationFn: (s: string) => addBlockedSubreddit(s),
    onSuccess: () => {
      setSubInput('');
      invalidate();
    },
  });
  const removeBlockedMutation = useMutation({
    mutationFn: removeBlockedSubreddit,
    onSuccess: invalidate,
  });
  const sessionMutation = useMutation({
    mutationFn: saveAutomationSession,
    onSuccess: () => {
      setSession({ sessionToken: '', csrfToken: '', nextAction: '' });
      invalidate();
    },
  });
  const testContactMutation = useMutation({
    mutationFn: () => sendTestContact(testChannel.trim(), undefined),
    onSuccess: (r) => {
      setTestResult({ ok: true, text: `Contact sent: ${r.data?.worker?.name || '?'} in #${r.data?.channel?.name || '?'} (5-min window)` });
      invalidate();
    },
    onError: (e: unknown) => setTestResult({ ok: false, text: `Contact failed: ${errMsg(e)}` }),
  });
  const testAcceptMutation = useMutation({
    mutationFn: (accept: boolean) => sendTestAccept(testTaskId.trim(), testChannel.trim(), accept),
    onSuccess: (r) => {
      setTestResult({
        ok: true,
        text: r.data?.wouldAccept
          ? `WOULD ACCEPT #${testTaskId} (${r.data?.reason || ''})`
          : `ACCEPTED #${testTaskId} — push it to the ticket with the Send Task button next.`,
      });
      invalidate();
    },
    onError: (e: unknown) => setTestResult({ ok: false, text: `Accept failed: ${errMsg(e)}` }),
  });
  const rehearseMutation = useMutation({
    mutationFn: () =>
      sendRehearse({
        externalTaskId: rehearseTask.trim(),
        channelId: rehearseChannel.trim(),
        subreddit: rehearseSub.trim() || null,
        live: rehearseLive,
      }),
    onSuccess: (r) => {
      const d = r.data || {};
      setRehearseResult({
        ok: true,
        text: d.claimQueued
          ? `Claim queued for #${rehearseTask.trim()} — the browser picks it up within ~30s, accepts, and pushes to the ticket.`
          : d.wouldAccept
            ? `Checks pass for #${rehearseTask.trim()} (${d.reason || 'ready'}) — tick Live + dry-run OFF to fire for real.`
            : `Not ready: ${d.reason || 'validation failed'}`,
      });
      invalidate();
    },
    onError: (e: unknown) => setRehearseResult({ ok: false, text: `Rehearse failed: ${errMsg(e)}` }),
  });

  const live = !!status?.enabled && !status?.dryRun;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Status */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          <Bot className="w-5 h-5 text-primary-400" />
          <span
            className={`status-badge border ${
              live
                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                : status?.enabled
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-dark-700/40 text-dark-300 border-dark-600/40'
            }`}
          >
            {status?.enabled ? (status?.dryRun ? 'Dry run' : 'Live') : 'Stopped'}
          </span>
          {status?.runningCycle && (
            <p className="text-sm text-dark-400">Cycle running…</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => stopMutation.mutate()}
            disabled={stopMutation.isPending}
            className="btn-danger flex items-center justify-center gap-1.5 flex-1 md:flex-none text-[13px] md:text-sm py-2 md:py-2.5 px-3 md:px-6"
          >
            <Square className="w-3.5 h-3.5 md:w-4 md:h-4" />
            Stop
          </button>
          <button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            className="btn-primary flex items-center justify-center gap-1.5 flex-1 md:flex-none text-[13px] md:text-sm py-2 md:py-2.5 px-3 md:px-6"
          >
            {startMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 md:w-4 md:h-4" />
            )}
            Run Cycle Now
          </button>
          <button
            onClick={() => { statusQuery.refetch(); cyclesQuery.refetch(); }}
            disabled={statusQuery.isFetching}
            className="p-2 md:p-2.5 text-dark-400 hover:text-white hover:bg-dark-800 rounded-xl transition-colors disabled:opacity-50 shrink-0"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 md:w-5 md:h-5 ${statusQuery.isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {[
          ['Eligible Posts', status?.lastCycle?.eligiblePosts ?? '—'],
          ['Workers Confirmed', status?.lastCycle?.workersConfirmed ?? '—'],
          ['Posts Accepted', status?.lastCycle?.postsAccepted ?? '—'],
          ['Blocked Subs', status?.blockedCount ?? blocked.length],
        ].map(([label, value]) => (
          <div key={label} className="stat-card">
            <p className="text-sm text-dark-400">{label}</p>
            <p className="text-2xl font-bold text-white mt-1">{String(value)}</p>
          </div>
        ))}
      </div>

      {/* Companion watcher */}
      <div className="glass-card p-4 sm:p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Browser Watcher</h2>
          <span className={`status-badge border ${companion?.online ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-dark-700/40 text-dark-300 border-dark-600/40'}`}>
            {companion?.online ? 'Online' : 'Offline'}
          </span>
        </div>
        <p className="text-sm text-dark-400">
          {companion?.lastSeenAt
            ? `Last seen ${new Date(companion.lastSeenAt).toLocaleString()}${companion?.version ? ` · v${companion.version}` : ''} · ${companion?.freshSightings ?? 0} fresh sightings · ${companion?.pendingClaims ?? 0} pending claims`
            : 'No watcher activity yet — install goparttime-auto.user.js in the manager browser. If the script runs but this stays Offline, its API key is wrong: re-enter it via the on-page gear button or the script menu → Configure Watcher...'}
        </p>
        {claims.length > 0 && (
          <div className="space-y-2">
            {claims.map((cl) => (
              <div key={String(cl.id)} className="flex items-center justify-between px-4 py-3 rounded-xl bg-dark-900/60 border border-dark-700/60">
                <span className="font-mono text-sm text-dark-100">#{String(cl.externalTaskId)} → {String(cl.channelId).slice(-4)}</span>
                <span className="text-xs text-amber-400">awaiting companion accept</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Switches */}
      <div className="glass-card p-4 sm:p-6 space-y-3">
        <h2 className="text-base font-semibold text-white">Switches</h2>
        {status ? (
          <div className="flex flex-col gap-3 text-sm">
            {([
              ['enabled', 'Enabled', 'Master switch — queue tick and manual runs'],
              ['dryRun', 'Dry-run', 'Validate + log only, never blast or accept'],
              ['pollEnabled', 'Server polling', 'Dormant — the browser watcher does all scanning'],
            ] as const).map(([key, label, hint]) => (
              <label key={key} className="flex items-center justify-between px-4 py-3 rounded-xl bg-dark-900/60 border border-dark-700/60 cursor-pointer">
                <span className="min-w-0">
                  <span className="block text-dark-100">{label}</span>
                  <span className="block text-xs text-dark-500 mt-0.5">{hint}</span>
                </span>
                <input
                  type="checkbox"
                  checked={!!status[key]}
                  onChange={(e) => settingsMutation.mutate({ enabled: status.enabled, dryRun: status.dryRun, pollEnabled: status.pollEnabled, [key]: e.target.checked })}
                  className="accent-primary-500 w-4 h-4 shrink-0 ml-3"
                />
              </label>
            ))}
          </div>
        ) : (
          <div className="flex justify-center py-6">
            <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
          </div>
        )}
        <p className="text-xs text-dark-500">
          Real acceptance additionally requires GOPARTTIME_AUTO_ACCEPT=true on the server.
        </p>
      </div>

      {/* Manual test */}
      <div className="glass-card p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-primary-400" />
          <h2 className="text-base font-semibold text-white">Manual Single-Task Test</h2>
        </div>
        <div className="grid md:grid-cols-2 gap-2">
          <input
            className="input-field font-mono text-sm"
            placeholder="Ticket channel ID"
            value={testChannel}
            onChange={(e) => setTestChannel(e.target.value)}
          />
          <input
            className="input-field font-mono text-sm"
            placeholder="GoPartTime task ID"
            value={testTaskId}
            onChange={(e) => setTestTaskId(e.target.value)}
          />
        </div>
        <div className="flex flex-col md:flex-row gap-2">
          <button
            className="btn-secondary flex items-center justify-center gap-1.5 text-sm py-2 px-4"
            disabled={!testChannel.trim() || testContactMutation.isPending}
            onClick={() => testContactMutation.mutate()}
          >
            {testContactMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            1. Send availability message
          </button>
          <button
            className="btn-secondary flex items-center justify-center gap-1.5 text-sm py-2 px-4"
            disabled={!testChannel.trim() || !testTaskId.trim() || testAcceptMutation.isPending}
            onClick={() => testAcceptMutation.mutate(false)}
          >
            2. Dry-run accept check
          </button>
          <button
            className="btn-danger flex items-center justify-center gap-1.5 text-sm py-2 px-4"
            disabled={!testChannel.trim() || !testTaskId.trim() || testAcceptMutation.isPending}
            onClick={() => {
              if (!window.confirm(`Really ACCEPT task #${testTaskId.trim()} on GoPartTime? This claims it for real.`)) return;
              testAcceptMutation.mutate(true);
            }}
          >
            3. Real accept
          </button>
        </div>
        {testResult && (
          <p className={`text-sm ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
            {testResult.ok ? '✅ ' : '❌ '}{testResult.text}
          </p>
        )}
        <p className="text-xs text-dark-500">
          Step 3 needs a CONFIRMED reply within 5 min, dry-run OFF, and server GOPARTTIME_AUTO_ACCEPT=true.
        </p>
      </div>

      {/* Rehearse (burst claim path) */}
      <div className="glass-card p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-primary-400" />
          <h2 className="text-base font-semibold text-white">Rehearse One Task</h2>
        </div>
        <p className="text-sm text-dark-400 -mt-2">
          Queues a real companion claim (drawer accept + ticket push). Without Live it only runs the pre-flight checks.
        </p>
        <div className="grid md:grid-cols-3 gap-2">
          <input
            className="input-field font-mono text-sm"
            placeholder="GoPartTime task ID"
            value={rehearseTask}
            onChange={(e) => setRehearseTask(e.target.value)}
          />
          <input
            className="input-field font-mono text-sm"
            placeholder="Ticket channel ID"
            value={rehearseChannel}
            onChange={(e) => setRehearseChannel(e.target.value)}
          />
          <input
            className="input-field font-mono text-sm"
            placeholder="Subreddit (optional)"
            value={rehearseSub}
            onChange={(e) => setRehearseSub(e.target.value)}
          />
        </div>
        <div className="flex flex-col md:flex-row gap-2 md:items-center">
          <label className="flex items-center gap-2 px-4 py-2 rounded-xl bg-dark-900/60 border border-dark-700/60 cursor-pointer text-sm text-dark-100">
            <input
              type="checkbox"
              checked={rehearseLive}
              onChange={(e) => setRehearseLive(e.target.checked)}
              className="accent-red-500 w-4 h-4"
            />
            Live — really accept on GoPartTime
          </label>
          <button
            className={rehearseLive ? 'btn-danger flex items-center justify-center gap-1.5 text-sm py-2 px-4' : 'btn-secondary flex items-center justify-center gap-1.5 text-sm py-2 px-4'}
            disabled={!rehearseTask.trim() || !rehearseChannel.trim() || rehearseMutation.isPending}
            onClick={() => {
              if (rehearseLive && !window.confirm(`Really ACCEPT task #${rehearseTask.trim()} on GoPartTime and push it to ticket ${rehearseChannel.trim()}?`)) return;
              rehearseMutation.mutate();
            }}
          >
            {rehearseMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {rehearseLive ? 'Fire live claim' : 'Dry-check only'}
          </button>
        </div>
        {rehearseResult && (
          <p className={`text-sm ${rehearseResult.ok ? 'text-green-400' : 'text-red-400'}`}>
            {rehearseResult.ok ? '✅ ' : '❌ '}{rehearseResult.text}
          </p>
        )}
        <p className="text-xs text-dark-500">
          Live needs dry-run OFF plus server GOPARTTIME_AUTO_ACCEPT=true, and the watcher tab open on /tasks.
        </p>
      </div>

      {/* Blocked subreddits */}
      <div className="glass-card p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Ban className="w-4 h-4 text-primary-400" />
          <h2 className="text-base font-semibold text-white">Blocked Subreddits</h2>
        </div>
        <p className="text-sm text-dark-400 -mt-2">Exact match only — blocking aiagents never blocks aiagents2.</p>
        <div className="flex gap-2">
          <input
            className="input-field flex-1 font-mono text-sm"
            placeholder="r/aiagents"
            value={subInput}
            onChange={(e) => setSubInput(e.target.value)}
          />
          <button
            className="btn-secondary text-sm px-4 py-2 shrink-0"
            disabled={!subInput.trim() || addBlockedMutation.isPending}
            onClick={() => addBlockedMutation.mutate(subInput.trim())}
          >
            Add
          </button>
        </div>
        <div className="space-y-2">
          {blockedQuery.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            </div>
          ) : blocked.length === 0 ? (
            <p className="text-sm text-dark-400">None blocked.</p>
          ) : (
            blocked.map((b) => (
              <div key={b.subreddit} className="flex items-center justify-between px-4 py-3 rounded-xl bg-dark-900/60 border border-dark-700/60">
                <span className="font-mono text-sm text-dark-100">r/{b.subreddit}</span>
                <button
                  className="text-red-400 text-sm hover:underline shrink-0 ml-3"
                  onClick={() => removeBlockedMutation.mutate(b.subreddit)}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Session */}
      <div className="glass-card p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary-400" />
          <h2 className="text-base font-semibold text-white">GoPartTime Session</h2>
        </div>
        <p className="text-sm text-dark-400 -mt-2">Cookies are encrypted on the server and never shown back. Pasting new values replaces the old ones.</p>
        <textarea
          className="input-field w-full font-mono text-xs"
          rows={3}
          placeholder="__Secure-goparttime.session-token value (starts eyJ...)"
          value={session.sessionToken}
          onChange={(e) => setSession({ ...session, sessionToken: e.target.value })}
        />
        <input
          className="input-field w-full font-mono text-xs"
          placeholder="__Host-goparttime.csrf-token value"
          value={session.csrfToken}
          onChange={(e) => setSession({ ...session, csrfToken: e.target.value })}
        />
        <input
          className="input-field w-full font-mono text-xs"
          placeholder="Next-Action id (64 hex, optional)"
          value={session.nextAction}
          onChange={(e) => setSession({ ...session, nextAction: e.target.value })}
        />
        <div>
          <button
            className="btn-primary text-sm px-4 py-2"
            disabled={!session.sessionToken.trim() || !session.csrfToken.trim() || sessionMutation.isPending}
            onClick={() =>
              sessionMutation.mutate({
                sessionToken: session.sessionToken.trim(),
                csrfToken: session.csrfToken.trim(),
                nextAction: session.nextAction.trim() || undefined,
              })
            }
          >
            {sessionMutation.isPending ? 'Saving…' : 'Save Session'}
          </button>
        </div>
      </div>

      {/* Recent cycles — desktop table */}
      <div className="glass-card overflow-hidden hidden md:block">
        <div className="px-6 pt-5 pb-3">
          <h2 className="text-base font-semibold text-white">Recent Cycles</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-y border-dark-700/50 bg-dark-800/50">
                <th className="px-6 py-4 font-semibold text-dark-200">Cycle</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Status</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Detected</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Eligible</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Confirmed</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Accepted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700/50">
              {cyclesQuery.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center">
                    <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto" />
                  </td>
                </tr>
              ) : cycles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-dark-400">
                    No cycles yet.
                  </td>
                </tr>
              ) : (
                cycles.map((c) => (
                  <tr
                    key={String(c.id)}
                    className={`hover:bg-dark-800/30 transition-colors cursor-pointer ${selectedCycle === String(c.id) ? 'bg-dark-800/50' : ''}`}
                    onClick={() => setSelectedCycle(selectedCycle === String(c.id) ? null : String(c.id))}
                  >
                    <td className="px-6 py-4 font-mono text-xs text-primary-400">{String(c.id).slice(0, 24)}</td>
                    <td className="px-6 py-4 text-sm text-dark-200">{String(c.status)}</td>
                    <td className="px-6 py-4 text-sm text-dark-200">{String(c.tasksDetected)}</td>
                    <td className="px-6 py-4 text-sm text-dark-200">{String(c.eligiblePosts)}</td>
                    <td className="px-6 py-4 text-sm text-dark-200">{String(c.workersConfirmed)}</td>
                    <td className="px-6 py-4 text-sm text-dark-200">{String(c.postsAccepted)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {selectedCycle && (
          <div className="px-6 py-4 border-t border-dark-700/50">
            {detailQuery.isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
              </div>
            ) : detail ? (
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider mb-2">Worker contacts</p>
                  {(detail.contacts || []).length === 0 && <p className="text-dark-400">None — burst wins appear as blast replies below, not contacts.</p>}
                  {(detail.contacts || []).map((ct: Record<string, unknown>) => (
                    <p key={String(ct.id)} className="font-mono text-xs text-dark-200 py-1">
                      {String(ct.status)} · {String(ct.channelId).slice(-4)} · {ct.respondedAt ? 'replied' : 'no reply'}
                    </p>
                  ))}
                </div>
                <div>
                  <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider mb-2">Task decisions</p>
                  {(detail.logs || []).length === 0 && <p className="text-dark-400">None.</p>}
                  {(detail.logs || []).map((l: Record<string, unknown>) => (
                    <p key={String(l.id)} className="font-mono text-xs text-dark-200 py-1">
                      #{String(l.externalTaskId)} → {String(l.status)}{l.subreddit ? ` · r/${String(l.subreddit)}` : ''}
                    </p>
                  ))}
                </div>
                <div className="md:col-span-2">
                  <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider mb-2">Blasts</p>
                  {(detail.bursts || []).length === 0 && <p className="text-dark-400">No blast for this cycle.</p>}
                  {(detail.bursts || []).map((b: Record<string, unknown>) => {
                    const blast = (b.blast || {}) as Record<string, unknown>;
                    const taskIds = (b.taskIds || []) as string[];
                    const replies = (b.replies || []) as Record<string, unknown>[];
                    return (
                      <div key={String(b.id)} className="py-1">
                        <p className="font-mono text-xs text-dark-200">
                          {String(blast.slotsFilled ?? 0)}/{String(blast.slotsTotal ?? taskIds.length)} slots · {String(blast.status || b.status)}
                          {taskIds.length > 0 ? ` · #${taskIds.join(' #')}` : ''}
                        </p>
                        {replies.map((r, i) => (
                          <p key={String(r.channelId)} className="font-mono text-xs text-green-400 py-0.5 pl-4">
                            #{i + 1} winner: {String(r.channelId).slice(-4)} · {r.repliedAt ? new Date(String(r.repliedAt)).toLocaleTimeString() : ''}
                          </p>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Recent cycles — mobile cards */}
      <div className="md:hidden space-y-4">
        <div className="glass-card border border-dark-700/50 px-4 pt-4 pb-2">
          <h2 className="text-base font-semibold text-white pb-2">Recent Cycles</h2>
        </div>
        {cyclesQuery.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
          </div>
        ) : cycles.length === 0 ? (
          <p className="text-center text-dark-400 py-10">No cycles yet.</p>
        ) : (
          cycles.map((c) => (
            <div key={String(c.id)} className="glass-card border border-dark-700/50 overflow-hidden">
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <p className="font-mono text-xs text-primary-400 truncate">{String(c.id).slice(0, 24)}</p>
                <span className="status-badge bg-dark-700/40 text-dark-300 border border-dark-600/40 ml-2 shrink-0">{String(c.status)}</span>
              </div>
              <div className="grid grid-cols-4 gap-1 px-4 py-2 border-t border-dark-700/30">
                {([['Detected', c.tasksDetected], ['Eligible', c.eligiblePosts], ['Confirmed', c.workersConfirmed], ['Accepted', c.postsAccepted]] as const).map(([label, v]) => (
                  <div key={label} className="text-center">
                    <p className="text-sm font-semibold text-dark-100">{String(v)}</p>
                    <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
