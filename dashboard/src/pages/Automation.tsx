import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAutomationStatus,
  getAutomationCycles,
  getBlockedSubreddits,
  updateAutomationSettings,
  startAutomationCycle,
  stopAutomation,
  addBlockedSubreddit,
  removeBlockedSubreddit,
  saveAutomationSession,
} from '../api/client';

export function Automation() {
  const queryClient = useQueryClient();
  const [subInput, setSubInput] = useState('');
  const [session, setSession] = useState({ sessionToken: '', csrfToken: '', nextAction: '' });
  const [selectedCycle, setSelectedCycle] = useState<string | null>(null);

  const statusQuery = useQuery({ queryKey: ['automation-status'], queryFn: getAutomationStatus, refetchInterval: 15000 });
  const cyclesQuery = useQuery({ queryKey: ['automation-cycles'], queryFn: getAutomationCycles, refetchInterval: 30000 });
  const blockedQuery = useQuery({ queryKey: ['automation-blocked'], queryFn: getBlockedSubreddits });

  const status = statusQuery.data?.data;
  const cycles = cyclesQuery.data?.data || [];
  const blocked = blockedQuery.data?.data || [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['automation-status'] });
    queryClient.invalidateQueries({ queryKey: ['automation-cycles'] });
    queryClient.invalidateQueries({ queryKey: ['automation-blocked'] });
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
  const sessionMutation = useMutation({ mutationFn: saveAutomationSession, onSuccess: invalidate });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Automation</h1>
        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${status?.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
          {status?.enabled ? (status?.dryRun ? 'DRY RUN' : 'LIVE') : 'STOPPED'}
        </span>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ['Eligible Posts', status?.lastCycle?.eligiblePosts ?? '—'],
          ['Workers Confirmed', status?.lastCycle?.workersConfirmed ?? '—'],
          ['Posts Accepted', status?.lastCycle?.postsAccepted ?? '—'],
          ['Blocked Subs', status?.blockedCount ?? blocked.length],
        ].map(([label, value]) => (
          <div key={label} className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-500">{label}</div>
            <div className="text-2xl font-bold">{String(value)}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <h2 className="font-semibold">Controls</h2>
        <div className="flex flex-wrap gap-2">
          <button
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            disabled={stopMutation.isPending}
            onClick={() => stopMutation.mutate()}
          >
            STOP AUTOMATION
          </button>
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            disabled={startMutation.isPending}
            onClick={() => startMutation.mutate()}
          >
            Run Cycle Now (forced)
          </button>
        </div>
        {status && (
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={status.enabled}
                onChange={(e) =>
                  settingsMutation.mutate({ enabled: e.target.checked, dryRun: status.dryRun, pollEnabled: status.pollEnabled })
                }
              />
              Enabled
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={status.dryRun}
                onChange={(e) =>
                  settingsMutation.mutate({ enabled: status.enabled, dryRun: e.target.checked, pollEnabled: status.pollEnabled })
                }
              />
              Dry-run (no real accept)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={status.pollEnabled}
                onChange={(e) =>
                  settingsMutation.mutate({ enabled: status.enabled, dryRun: status.dryRun, pollEnabled: e.target.checked })
                }
              />
              Polling (7 scans/hour)
            </label>
          </div>
        )}
        <p className="text-xs text-gray-500">
          Schedule: scans at :00 :10 :11 :20 :30 :40 :50 with jitter. Mandatory scans at :10/:11. Real acceptance additionally requires
          GOPARTTIME_AUTO_ACCEPT=true on the server.
        </p>
      </div>

      {/* Blocked subreddits */}
      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <h2 className="font-semibold">Blocked Subreddits (exact match)</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 border rounded px-3 py-2"
            placeholder="r/aiagents"
            value={subInput}
            onChange={(e) => setSubInput(e.target.value)}
          />
          <button
            className="px-4 py-2 bg-gray-800 text-white rounded disabled:opacity-50"
            disabled={!subInput.trim() || addBlockedMutation.isPending}
            onClick={() => addBlockedMutation.mutate(subInput.trim())}
          >
            Add
          </button>
        </div>
        <ul className="divide-y">
          {blocked.map((b: { subreddit: string; reason: string | null }) => (
            <li key={b.subreddit} className="py-2 flex items-center justify-between">
              <span className="font-mono">r/{b.subreddit}</span>
              <button
                className="text-red-600 text-sm hover:underline"
                onClick={() => removeBlockedMutation.mutate(b.subreddit)}
              >
                Remove
              </button>
            </li>
          ))}
          {blocked.length === 0 && <li className="py-2 text-sm text-gray-500">None blocked.</li>}
        </ul>
      </div>

      {/* Session */}
      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <h2 className="font-semibold">GoPartTime Session (cookies, encrypted at rest)</h2>
        <textarea
          className="w-full border rounded px-3 py-2 font-mono text-xs"
          rows={3}
          placeholder="__Secure-goparttime.session-token value (starts eyJ...)"
          value={session.sessionToken}
          onChange={(e) => setSession({ ...session, sessionToken: e.target.value })}
        />
        <input
          className="w-full border rounded px-3 py-2 font-mono text-xs"
          placeholder="__Host-goparttime.csrf-token value"
          value={session.csrfToken}
          onChange={(e) => setSession({ ...session, csrfToken: e.target.value })}
        />
        <input
          className="w-full border rounded px-3 py-2 font-mono text-xs"
          placeholder="Next-Action id (64 hex, optional)"
          value={session.nextAction}
          onChange={(e) => setSession({ ...session, nextAction: e.target.value })}
        />
        <button
          className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50"
          disabled={!session.sessionToken.trim() || !session.csrfToken.trim() || sessionMutation.isPending}
          onClick={() =>
            sessionMutation.mutate({
              sessionToken: session.sessionToken.trim(),
              csrfToken: session.csrfToken.trim(),
              nextAction: session.nextAction.trim() || undefined,
            })
          }
        >
          Save Session
        </button>
      </div>

      {/* Cycles */}
      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <h2 className="font-semibold">Recent Cycles</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-2 pr-4">Cycle</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Detected</th>
                <th className="py-2 pr-4">Eligible</th>
                <th className="py-2 pr-4">Confirmed</th>
                <th className="py-2 pr-4">Accepted</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c: Record<string, unknown>) => (
                <tr key={String(c.id)} className="border-t">
                  <td className="py-2 pr-4">
                    <button className="text-blue-600 hover:underline font-mono text-xs" onClick={() => setSelectedCycle(String(c.id))}>
                      {String(c.id).slice(0, 24)}
                    </button>
                  </td>
                  <td className="py-2 pr-4">{String(c.status)}</td>
                  <td className="py-2 pr-4">{String(c.tasksDetected)}</td>
                  <td className="py-2 pr-4">{String(c.eligiblePosts)}</td>
                  <td className="py-2 pr-4">{String(c.workersConfirmed)}</td>
                  <td className="py-2 pr-4">{String(c.postsAccepted)}</td>
                </tr>
              ))}
              {cycles.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-gray-500">
                    No cycles yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {selectedCycle && <p className="text-xs text-gray-500">Selected: {selectedCycle} (detail view via API).</p>}
      </div>
    </div>
  );
}
