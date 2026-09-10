import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getReferrals, getTickets, deleteReferral, updateReferral } from '../api/client';
import { Search, Loader2, ChevronLeft, ChevronRight, Pencil, Trash2, X, Save } from 'lucide-react';

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
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);

  const [editingRef, setEditingRef] = useState<any | null>(null);
  const [formInviter, setFormInviter] = useState('');
  const [formInvitee, setFormInvitee] = useState('');
  const [formInviterId, setFormInviterId] = useState('');
  const [formInviteeId, setFormInviteeId] = useState('');
  const [formTicket, setFormTicket] = useState('');
  const [formError, setFormError] = useState('');

  const SNOWFLAKE_RE = /^\d{17,20}$/;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['referrals'],
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
    const trimmed = (raw || '').trim().replace(/^#/, '');
    return trimmed ? `#${trimmed}` : '—';
  };

  const resolveTicketValue = (raw: string | null | undefined): string => {
    const channelId = getTicketChannelId(raw);
    if (channelId) {
      return ticketNameMap.get(channelId) || channelId;
    }
    return (raw || '').trim().replace(/^#/, '');
  };

  const referrals = (data?.data || []) as any[];

  const filteredReferrals = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return referrals.filter((r: any) => {
      if (!term) return true;
      return (
        (r.inviterName || '').toLowerCase().includes(term) ||
        (r.inviteeName || '').toLowerCase().includes(term) ||
        (r.inviterId || '').toLowerCase().includes(term) ||
        (r.inviteeId || '').toLowerCase().includes(term) ||
        (r.ticketId || '').toLowerCase().includes(term)
      );
    });
  }, [referrals, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredReferrals.length / PAGE_SIZE));
  const paginated = filteredReferrals.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteReferral(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
      refetch();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { inviterId?: string; inviteeId?: string; inviterName: string; inviteeName: string; ticketId: string | null } }) =>
      updateReferral(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
      refetch();
      setEditingRef(null);
    },
    onError: (error: Error) => {
      setFormError(error.message || 'Failed to update referral.');
    },
  });

  const openEdit = (r: any) => {
    setEditingRef(r);
    setFormInviter(r.inviterName || '');
    setFormInvitee(r.inviteeName || '');
    setFormInviterId(r.inviterId || '');
    setFormInviteeId(r.inviteeId || '');
    setFormTicket(resolveTicketValue(r.ticketId));
    setFormError('');
  };

  const handleDelete = (r: any) => {
    if (confirm(`Delete referral for ${r.inviteeName || r.inviteeId}? This cannot be undone.`)) {
      deleteMutation.mutate(r.id);
    }
  };

  const handleSave = () => {
    if (!formInviter.trim() || !formInvitee.trim()) {
      setFormError('Inviter and invitee names are required.');
      return;
    }
    if (!SNOWFLAKE_RE.test(formInviterId.trim()) || !SNOWFLAKE_RE.test(formInviteeId.trim())) {
      setFormError('Inviter and invitee IDs must be valid Discord user IDs (17–20 digits).');
      return;
    }
    setFormError('');
    updateMutation.mutate({
      id: editingRef.id,
      body: {
        inviterId: formInviterId.trim(),
        inviteeId: formInviteeId.trim(),
        inviterName: formInviter.trim(),
        inviteeName: formInvitee.trim(),
        ticketId: formTicket.trim() || null,
      },
    });
  };

  const ticketOptions = useMemo(() => {
    const live = new Set<string>();
    for (const t of (ticketsQuery.data?.data || []) as any[]) {
      if (t?.channelName) live.add(String(t.channelName));
    }
    const current = formTicket.trim();
    return {
      hasCurrent: !current || live.has(current),
      options: Array.from(live).sort(),
    };
  }, [ticketsQuery.data, formTicket]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
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

      <div className="glass-card overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-dark-700/50 bg-dark-800/50">
                <th className="px-6 py-4 font-semibold text-dark-200">Inviter</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Invitee</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Ticket</th>
                <th className="px-6 py-4 font-semibold text-dark-200">Invited On</th>
                <th className="px-6 py-4 font-semibold text-dark-200 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700/50">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto" />
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-dark-400">
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
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium text-white truncate">{r.inviterName}</p>
                            {r.indirectSpecialInviterId && (
                              <span className="px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-md shrink-0" title={`Indirect special inviter: ${r.indirectSpecialInviterId}`}>
                                Indirect
                              </span>
                            )}
                          </div>
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
                    <td className="px-6 py-4 text-sm text-dark-300">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(r)}
                          className="p-2 text-dark-400 hover:text-primary-400 hover:bg-primary-400/10 rounded-lg transition-colors"
                          title="Edit referral"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(r)}
                          disabled={deleteMutation.isPending && deleteMutation.variables === r.id}
                          className="p-2 text-dark-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors disabled:opacity-40"
                          title="Delete referral"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
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
                    <div className="flex items-center gap-1.5">
                      <p className="text-white text-sm font-medium truncate">{r.inviterName}</p>
                      {r.indirectSpecialInviterId && (
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-md shrink-0">
                          Indirect
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-dark-400">invited</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEdit(r)}
                    className="p-1.5 text-dark-400 hover:text-primary-400 hover:bg-primary-400/10 rounded-lg transition-colors"
                    title="Edit referral"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(r)}
                    disabled={deleteMutation.isPending && deleteMutation.variables === r.id}
                    className="p-1.5 text-dark-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors disabled:opacity-40"
                    title="Delete referral"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
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

      {editingRef && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-dark-800 rounded-2xl p-8 w-full max-w-md mx-4 border border-dark-700 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-white">Edit Referral</h3>
              <button
                onClick={() => setEditingRef(null)}
                className="text-dark-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-dark-400 text-xs font-semibold uppercase tracking-wider mb-1.5">Inviter ID</label>
                  <input
                    type="text"
                    value={formInviterId}
                    onChange={(e) => setFormInviterId(e.target.value)}
                    placeholder="17–20 digit user ID"
                    className="input-field w-full font-mono"
                  />
                </div>
                <div>
                  <label className="block text-dark-400 text-xs font-semibold uppercase tracking-wider mb-1.5">Invitee ID</label>
                  <input
                    type="text"
                    value={formInviteeId}
                    onChange={(e) => setFormInviteeId(e.target.value)}
                    placeholder="17–20 digit user ID"
                    className="input-field w-full font-mono"
                  />
                </div>
              </div>
              <p className="-mt-2 text-[11px] text-dark-500">Changing the inviter re-derives special/normal type and the indirect chain automatically.</p>
              <div>
                <label className="block text-dark-400 text-xs font-semibold uppercase tracking-wider mb-1.5">Inviter Name</label>
                <input
                  type="text"
                  value={formInviter}
                  onChange={(e) => setFormInviter(e.target.value)}
                  placeholder="Inviter name"
                  className="input-field w-full"
                />
              </div>

              <div>
                <label className="block text-dark-400 text-xs font-semibold uppercase tracking-wider mb-1.5">Invitee Name</label>
                <input
                  type="text"
                  value={formInvitee}
                  onChange={(e) => setFormInvitee(e.target.value)}
                  placeholder="Invitee name"
                  className="input-field w-full"
                />
              </div>

              <div>
                <label className="block text-dark-400 text-xs font-semibold uppercase tracking-wider mb-1.5">Ticket</label>
                <select
                  value={formTicket}
                  onChange={(e) => setFormTicket(e.target.value)}
                  className="input-field w-full bg-dark-900"
                >
                  {!ticketOptions.hasCurrent && formTicket && (
                    <option value={formTicket} className="bg-dark-900 text-white">
                      {formTicket.startsWith('#') ? formTicket : `#${formTicket}`} (current)
                    </option>
                  )}
                  <option value="" className="bg-dark-900 text-white">No ticket</option>
                  {ticketOptions.options.map((name) => (
                    <option key={name} value={name} className="bg-dark-900 text-white">
                      #{name}
                    </option>
                  ))}
                </select>
              </div>

              {formError && (
                <p className="text-red-400 text-sm">{formError}</p>
              )}

              <button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}