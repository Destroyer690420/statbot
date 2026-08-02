import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getReferrals, getTickets } from '../api/client';
import { Search, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 15;

function getTicketChannelId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const mention = trimmed.match(/^<#?(\d+)>$/);
  if (mention) return mention[1];
  if (/^\d+$/.test(trimmed)) return trimmed;
  return null;
}

export function Referrals() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['referrals', statusFilter],
    queryFn: getReferrals,
  });

  const ticketsQuery = useQuery({
    queryKey: ['tickets'],
    queryFn: getTickets,
  });

  const ticketNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of (ticketsQuery.data?.data || []) as any[]) {
      if (t?.channelId && t?.channelName) map.set(String(t.channelId), String(t.channelName));
    }
    return map;
  }, [ticketsQuery.data]);

  const resolveTicket = (raw: string | null | undefined): string => {
    const channelId = getTicketChannelId(raw);
    if (channelId) {
      const name = ticketNameMap.get(channelId);
      if (name) return `#${name}`;
      return `#${channelId}`;
    }
    const trimmed = (raw || '').trim().replace(/^#?/, '');
    return trimmed ? `#${trimmed}` : '—';
  };

  const referrals = (data?.data || []) as any[];

  const filteredReferrals = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return referrals.filter((r: any) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!term) return true;
      return (
        (r.inviterName || '').toLowerCase().includes(term) ||
        (r.inviteeName || '').toLowerCase().includes(term) ||
        (r.inviterId || '').toLowerCase().includes(term) ||
        (r.inviteeId || '').toLowerCase().includes(term) ||
        (r.ticketId || '').toLowerCase().includes(term)
      );
    });
  }, [referrals, searchTerm, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredReferrals.length / PAGE_SIZE));
  const paginated = filteredReferrals.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      case 'qualified': return 'bg-green-500/10 text-green-400 border-green-500/20';
      case 'active_per_task': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'closed': return 'bg-red-500/10 text-red-400 border-red-500/20';
      default: return 'bg-dark-500/10 text-dark-400 border-dark-500/20';
    }
  };

  const formatStatus = (status: string) => status.replace(/_/g, ' ');

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-2 w-full">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 transform -translate-y-1/2 text-dark-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search inviter, invitee, or ticket..."
            className="w-full h-10 pl-10 pr-3 bg-dark-800/80 border border-dark-700/80 rounded-xl text-sm text-white placeholder-dark-400 focus:outline-none focus:border-primary-500/50 transition-all"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
          />
        </div>

        <div
          className={`relative flex items-center justify-center w-10 h-10 rounded-xl border shrink-0 transition-all ${
            statusFilter
              ? 'bg-primary-500/20 border-primary-500/40 text-primary-400'
              : 'bg-dark-800/80 border-dark-700/80 text-dark-300 hover:border-dark-600 hover:text-white'
          }`}
          title={statusFilter ? `Filter: ${formatStatus(statusFilter)}` : 'Filter by status'}
        >
          <span className="text-xs font-bold">S</span>
          <select
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="" className="bg-dark-900 text-white">All Statuses</option>
            <option value="pending" className="bg-dark-900 text-white">Pending</option>
            <option value="qualified" className="bg-dark-900 text-white">Qualified</option>
            <option value="active_per_task" className="bg-dark-900 text-white">Active Per Task</option>
            <option value="closed" className="bg-dark-900 text-white">Closed</option>
          </select>
        </div>
      </div>

      <div className="glass-card overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-dark-700/50 bg-dark-800/50">
                <th className="px-6 py-4 font-semibold text-dark-200">Inviter</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Invitee</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Ticket</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Type</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Status</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Invited On</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700/50">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto" />
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-dark-400">
                    No referrals found. Use the <code className="text-primary-400">/referral add</code> bot command to add referrals.
                  </td>
                </tr>
              ) : (
                paginated.map((r: any) => (
                  <tr key={r.id} className="hover:bg-dark-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-primary-700 to-primary-400 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {(r.inviterName || r.inviterId || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate">{r.inviterName}</p>
                          <p className="text-[11px] text-dark-500 font-mono truncate">{r.inviterId}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-purple-700 to-purple-400 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {(r.inviteeName || r.inviteeId || '').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate">{r.inviteeName}</p>
                          <p className="text-[11px] text-dark-500 font-mono truncate">{r.inviteeId}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-sm text-dark-200 bg-dark-800/50 px-2 py-1 rounded-md border border-dark-700/50">
                        {resolveTicket(r.ticketId)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`status-badge border ${
                        r.inviterType === 'special'
                          ? 'bg-purple-900/40 text-purple-400 border-purple-500/20'
                          : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      }`}>
                        {r.inviterType}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`status-badge border ${getStatusColor(r.status)}`}>
                        {formatStatus(r.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-dark-300">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="md:hidden space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
          </div>
        ) : paginated.length === 0 ? (
          <div className="glass-card p-8 text-center text-dark-400">
            No referrals found. Use the <code className="text-primary-400">/referral add</code> bot command to add referrals.
          </div>
        ) : (
          paginated.map((r: any) => (
            <div key={r.id} className="glass-card border border-dark-700/50 overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary-700 to-primary-400 flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {(r.inviterName || r.inviterId || '').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{r.inviterName}</p>
                    <p className="text-[11px] text-dark-400">invited</p>
                  </div>
                </div>
                <span className={`status-badge border ${getStatusColor(r.status)}`}>
                  {formatStatus(r.status)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1 px-4 py-2 border-t border-dark-700/30">
                <div>
                  <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider">Invitee</p>
                  <p className="text-dark-200 text-xs font-medium truncate">{r.inviteeName}</p>
                </div>
                <div>
                  <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider">Ticket</p>
                  <p className="text-dark-200 text-xs font-mono font-medium truncate">
                    {resolveTicket(r.ticketId)}
                  </p>
                </div>
                <div>
                  <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider">Invited</p>
                  <p className="text-dark-200 text-xs font-medium">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 px-4 py-2 border-t border-dark-700/30">
                <span className={`status-badge border ${
                  r.inviterType === 'special'
                    ? 'bg-purple-900/40 text-purple-300 border-purple-900/20'
                    : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                }`}>
                  {r.inviterType}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-dark-400 text-sm">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredReferrals.length)} of {filteredReferrals.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 text-dark-400 hover:text-white hover:bg-dark-800 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm text-dark-300 font-medium">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-2 text-dark-400 hover:text-white hover:bg-dark-800 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}