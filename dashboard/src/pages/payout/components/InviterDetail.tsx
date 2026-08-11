import { formatCurrency } from '../utils';

export function InviterDetail({ data }: { data: any }) {
  return (
    <div className="expand-panel">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-white font-semibold text-sm sm:text-base">{data.inviterName}</h4>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            data.inviterType === 'special'
              ? 'bg-yellow-500/10 text-yellow-400'
              : 'bg-dark-700/50 text-dark-300'
          }`}>
            {data.inviterType === 'special' ? '⭐ Special' : 'Normal'}
          </span>
        </div>
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
          data.status === 'Paid'
            ? 'bg-blue-500/10 text-blue-400'
            : data.status === 'Ready'
            ? 'bg-green-500/10 text-green-400'
            : 'bg-dark-700/50 text-dark-400'
        }`}>
          {data.status}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-4">
        <div className="bg-dark-800/60 rounded-xl p-3 border border-dark-700/40">
          <p className="text-dark-400 text-xs font-medium mb-0.5">Referrals</p>
          <p className="text-white font-bold text-base sm:text-lg">{data.referrals?.length ?? 0}</p>
        </div>
        <div className="bg-dark-800/60 rounded-xl p-3 border border-dark-700/40">
          <p className="text-dark-400 text-xs font-medium mb-0.5">Invite Bonus</p>
          <p className="text-white font-bold text-base sm:text-lg">{formatCurrency(data.totalBonus ?? 0)}</p>
        </div>
        <div className="bg-dark-800/60 rounded-xl p-3 border border-dark-700/40">
          <p className="text-dark-400 text-xs font-medium mb-0.5">Per-Task</p>
          <p className="text-white font-bold text-base sm:text-lg">{formatCurrency(data.totalPerTask ?? 0)}</p>
        </div>
        <div className="bg-dark-800/60 rounded-xl p-3 border border-dark-700/40">
          <p className="text-dark-400 text-xs font-medium mb-0.5">Total</p>
          <p className="text-primary-400 font-bold text-base sm:text-lg">{formatCurrency(data.totalCommission ?? 0)}</p>
        </div>
      </div>

      {/* Referral details */}
      <p className="text-dark-400 text-xs font-medium mb-2">Invited Workers ({data.referrals?.length ?? 0})</p>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-700/50">
              <th className="text-left text-dark-400 font-medium py-2 px-2">Invitee</th>
              <th className="text-center text-dark-400 font-medium py-2 px-2">Tasks</th>
              <th className="text-center text-dark-400 font-medium py-2 px-2">Posts</th>
              <th className="text-center text-dark-400 font-medium py-2 px-2">Comments</th>
              <th className="text-right text-dark-400 font-medium py-2 px-2">Bonus</th>
              <th className="text-right text-dark-400 font-medium py-2 px-2">Per-Task</th>
              <th className="text-center text-dark-400 font-medium py-2 px-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data.referrals ?? []).map((ref: any) => (
              <tr key={ref.referralId} className="border-b border-dark-800/50">
                <td className="py-2 px-2 text-white text-sm font-medium">{ref.inviteeName}</td>
                <td className="py-2 px-2 text-center text-white">{ref.inviteeTasks?.total ?? 0}</td>
                <td className="py-2 px-2 text-center text-dark-300">{ref.inviteeTasks?.posts ?? 0}</td>
                <td className="py-2 px-2 text-center text-dark-300">{ref.inviteeTasks?.comments ?? 0}</td>
                <td className="py-2 px-2 text-right text-white">{ref.bonusAmount > 0 ? formatCurrency(ref.bonusAmount) : '-'}</td>
                <td className="py-2 px-2 text-right text-white">{ref.perTaskAmount > 0 ? formatCurrency(ref.perTaskAmount) : '-'}</td>
                <td className="py-2 px-2 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    ref.isSuccessful
                      ? ref.bonusPaid ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'
                      : 'bg-yellow-500/10 text-yellow-400'
                  }`}>
                    {ref.isSuccessful ? (ref.bonusPaid ? 'Paid' : 'Ready') : 'Pending'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-2">
        {(data.referrals ?? []).map((ref: any) => (
          <div key={ref.referralId} className="bg-dark-800/40 rounded-lg p-3 border border-dark-700/30">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-white text-sm font-medium">{ref.inviteeName}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                ref.isSuccessful
                  ? ref.bonusPaid ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'
                  : 'bg-yellow-500/10 text-yellow-400'
              }`}>
                {ref.isSuccessful ? (ref.bonusPaid ? 'Paid' : 'Ready') : 'Pending'}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-dark-400">
              <span>Tasks: {ref.inviteeTasks?.total ?? 0}</span>
              {ref.bonusAmount > 0 && <span>Bonus: {formatCurrency(ref.bonusAmount)}</span>}
              {ref.perTaskAmount > 0 && <span>Per-Task: {formatCurrency(ref.perTaskAmount)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
