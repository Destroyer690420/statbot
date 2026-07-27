import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Sun, Moon, Monitor, Loader2, IndianRupee, UserPlus, Trash2, X } from 'lucide-react';
import { getPayoutRates, updatePayoutRates, getCommissionRates, updateCommissionRates, verifyOwnerPin } from '../api/client';

export function Settings() {
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState('dark');

  // ─── Payout Rates ─────────────────────────────────────────

  const ratesQuery = useQuery({
    queryKey: ['payout-rates'],
    queryFn: getPayoutRates,
  });

  const [commentRate, setCommentRate] = useState<number>(30);
  const [postRate, setPostRate] = useState<number>(60);
  const [ratesDirty, setRatesDirty] = useState(false);

  const ratesMutation = useMutation({
    mutationFn: (body: { commentRate: number; postRate: number }) => updatePayoutRates(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payout-rates'] });
      setRatesDirty(false);
    },
  });

  // Initialize form from query data
  if (ratesQuery.data?.data && !ratesDirty && !ratesMutation.isSuccess) {
    const r = ratesQuery.data.data;
    if (commentRate !== r.commentRate && !ratesDirty) setCommentRate(r.commentRate);
    if (postRate !== r.postRate && !ratesDirty) setPostRate(r.postRate);
  }

  const handleSaveRates = () => {
    ratesMutation.mutate({ commentRate, postRate });
  };

  // ─── Commission Rates ──────────────────────────────────────

  const commRatesQuery = useQuery({
    queryKey: ['commission-rates'],
    queryFn: getCommissionRates,
  });

  const [normalInviteBonus, setNormalInviteBonus] = useState(100);
  const [normalThreshold, setNormalThreshold] = useState(2);
  const [specialInviteBonus, setSpecialInviteBonus] = useState(50);
  const [specialThreshold, setSpecialThreshold] = useState(1);
  const [specialPerComment, setSpecialPerComment] = useState(10);
  const [specialPerPost, setSpecialPerPost] = useState(20);
  const [commRatesDirty, setCommRatesDirty] = useState(false);

  // ─── Owner Panel ────────────────────────────────────────────

  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [ownerAccess, setOwnerAccess] = useState(false);

  const handlePinSubmit = async () => {
    if (pinLoading) return;
    setPinError('');
    setPinLoading(true);
    try {
      const res = await verifyOwnerPin(pinInput);
      if (res.success) {
        setOwnerAccess(true);
        setShowPinModal(false);
        setPinInput('');
      } else {
        setPinError(res.message || 'Invalid PIN.');
      }
    } catch {
      setPinError('Verification failed. Try again.');
    } finally {
      setPinLoading(false);
    }
  };

  const commRatesMutation = useMutation({
    mutationFn: (body: {
      normalInviteBonus: number;
      normalInviteTaskThreshold: number;
      specialInviteBonus: number;
      specialInviteTaskThreshold: number;
      specialPerComment: number;
      specialPerPost: number;
    }) => updateCommissionRates(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-rates'] });
      setCommRatesDirty(false);
    },
  });

  if (commRatesQuery.data?.data && !commRatesDirty && !commRatesMutation.isSuccess) {
    const cr = commRatesQuery.data.data;
    if (normalInviteBonus !== cr.normalInviteBonus && !commRatesDirty) setNormalInviteBonus(cr.normalInviteBonus);
    if (normalThreshold !== cr.normalInviteTaskThreshold && !commRatesDirty) setNormalThreshold(cr.normalInviteTaskThreshold);
    if (specialInviteBonus !== cr.specialInviteBonus && !commRatesDirty) setSpecialInviteBonus(cr.specialInviteBonus);
    if (specialThreshold !== cr.specialInviteTaskThreshold && !commRatesDirty) setSpecialThreshold(cr.specialInviteTaskThreshold);
    if (specialPerComment !== cr.specialPerComment && !commRatesDirty) setSpecialPerComment(cr.specialPerComment);
    if (specialPerPost !== cr.specialPerPost && !commRatesDirty) setSpecialPerPost(cr.specialPerPost);
  }

  const handleSaveCommRates = () => {
    commRatesMutation.mutate({
      normalInviteBonus,
      normalInviteTaskThreshold: normalThreshold,
      specialInviteBonus,
      specialInviteTaskThreshold: specialThreshold,
      specialPerComment,
      specialPerPost,
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="max-w-2xl space-y-6">
        {/* Theme Selection */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Dashboard Theme</h3>
          <div className="grid grid-cols-3 gap-4">
            <button
              onClick={() => setTheme('dark')}
              className={`p-4 rounded-xl border-2 transition-all ${
                theme === 'dark'
                  ? 'border-primary-500 bg-primary-900/20'
                  : 'border-dark-700 bg-dark-800/50 hover:border-dark-500'
              }`}
            >
              <Moon className="w-6 h-6 text-primary-400 mx-auto mb-2" />
              <p className="text-sm text-white font-medium">Dark</p>
            </button>
            <button
              onClick={() => setTheme('light')}
              className={`p-4 rounded-xl border-2 transition-all ${
                theme === 'light'
                  ? 'border-primary-500 bg-primary-900/20'
                  : 'border-dark-700 bg-dark-800/50 hover:border-dark-500'
              }`}
            >
              <Sun className="w-6 h-6 text-yellow-400 mx-auto mb-2" />
              <p className="text-sm text-white font-medium">Light</p>
            </button>
            <button
              onClick={() => setTheme('system')}
              className={`p-4 rounded-xl border-2 transition-all ${
                theme === 'system'
                  ? 'border-primary-500 bg-primary-900/20'
                  : 'border-dark-700 bg-dark-800/50 hover:border-dark-500'
              }`}
            >
              <Monitor className="w-6 h-6 text-dark-300 mx-auto mb-2" />
              <p className="text-sm text-white font-medium">System</p>
            </button>
          </div>
        </div>

        {/* Payout Rates */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Payout Rates</h3>
          <p className="text-dark-400 text-sm mb-4">
            Set the payment amount per task type. Changes apply to future payouts immediately.
          </p>

          {ratesQuery.isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-dark-400 text-sm font-medium mb-1.5">
                  Comment Rate (₹)
                </label>
                <div className="relative">
                  <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={commentRate}
                    onChange={(e) => { setCommentRate(Number(e.target.value)); setRatesDirty(true); }}
                    className="input-field w-full pl-10"
                  />
                </div>
              </div>
              <div>
                <label className="block text-dark-400 text-sm font-medium mb-1.5">
                  Post Rate (₹)
                </label>
                <div className="relative">
                  <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={postRate}
                    onChange={(e) => { setPostRate(Number(e.target.value)); setRatesDirty(true); }}
                    className="input-field w-full pl-10"
                  />
                </div>
              </div>
            </div>
          )}

          <button
            onClick={handleSaveRates}
            disabled={!ratesDirty || ratesMutation.isPending}
            className="btn-primary flex items-center gap-2"
          >
            {ratesMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Rates
          </button>

          {ratesMutation.isSuccess && (
            <p className="mt-2 text-green-400 text-sm">✅ Payout rates updated successfully.</p>
          )}
          {ratesMutation.isError && (
            <p className="mt-2 text-red-400 text-sm">❌ Failed to update rates: {(ratesMutation.error as Error).message}</p>
          )}
        </div>

        {/* Reminder Delays */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Reminder Delays</h3>
          <p className="text-dark-400 text-sm mb-4">
            Configured in environment variables. Restart required for changes.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
              <p className="text-dark-400 text-xs font-medium mb-1">Post 20H</p>
              <p className="text-white font-mono text-lg">20 hours</p>
            </div>
            <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
              <p className="text-dark-400 text-xs font-medium mb-1">Post 70H</p>
              <p className="text-white font-mono text-lg">70 hours</p>
            </div>
            <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
              <p className="text-dark-400 text-xs font-medium mb-1">Comment 20H</p>
              <p className="text-white font-mono text-lg">20 hours</p>
            </div>
          </div>
        </div>

        {/* Retry Configuration */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Retry Configuration</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
              <p className="text-dark-400 text-xs font-medium mb-1">First Retry</p>
              <p className="text-white font-mono text-lg">+2 hours</p>
            </div>
            <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
              <p className="text-dark-400 text-xs font-medium mb-1">Second Retry</p>
              <p className="text-white font-mono text-lg">+6 hours</p>
            </div>
          </div>
        </div>

        {/* Commission Rates */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="w-5 h-5 text-primary-400" />
            <h3 className="text-lg font-semibold text-white">Commission Rates</h3>
          </div>
          <p className="text-dark-400 text-sm mb-4">
            Set commission rates for the invitation program. Normal inviters earn a one-time bonus per successful invite. Special inviters earn a bonus plus per-task commission.
          </p>

          {commRatesQuery.isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
            </div>
          ) : (
            <>
              <p className="text-dark-300 text-xs font-semibold uppercase tracking-wider mb-3">Normal Inviter</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                <div>
                  <label className="block text-dark-400 text-sm font-medium mb-1.5">
                    Invite Bonus (₹)
                  </label>
                  <div className="relative">
                    <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={normalInviteBonus}
                      onChange={(e) => { setNormalInviteBonus(Number(e.target.value)); setCommRatesDirty(true); }}
                      className="input-field w-full pl-10"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-dark-400 text-sm font-medium mb-1.5">
                    Task Threshold
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={normalThreshold}
                    onChange={(e) => { setNormalThreshold(Number(e.target.value)); setCommRatesDirty(true); }}
                    className="input-field w-full"
                  />
                  <p className="text-dark-500 text-xs mt-1">Tasks invitee must complete for bonus</p>
                </div>
              </div>

              <p className="text-dark-300 text-xs font-semibold uppercase tracking-wider mb-3">Special Inviter</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                <div>
                  <label className="block text-dark-400 text-sm font-medium mb-1.5">
                    Invite Bonus (₹)
                  </label>
                  <div className="relative">
                    <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={specialInviteBonus}
                      onChange={(e) => { setSpecialInviteBonus(Number(e.target.value)); setCommRatesDirty(true); }}
                      className="input-field w-full pl-10"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-dark-400 text-sm font-medium mb-1.5">
                    Task Threshold
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={specialThreshold}
                    onChange={(e) => { setSpecialThreshold(Number(e.target.value)); setCommRatesDirty(true); }}
                    className="input-field w-full"
                  />
                  <p className="text-dark-500 text-xs mt-1">Tasks invitee must complete for bonus</p>
                </div>
                <div>
                  <label className="block text-dark-400 text-sm font-medium mb-1.5">
                    Per Comment (₹)
                  </label>
                  <div className="relative">
                    <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={specialPerComment}
                      onChange={(e) => { setSpecialPerComment(Number(e.target.value)); setCommRatesDirty(true); }}
                      className="input-field w-full pl-10"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-dark-400 text-sm font-medium mb-1.5">
                    Per Post (₹)
                  </label>
                  <div className="relative">
                    <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={specialPerPost}
                      onChange={(e) => { setSpecialPerPost(Number(e.target.value)); setCommRatesDirty(true); }}
                      className="input-field w-full pl-10"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          <button
            onClick={handleSaveCommRates}
            disabled={!commRatesDirty || commRatesMutation.isPending}
            className="btn-primary flex items-center gap-2"
          >
            {commRatesMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Commission Rates
          </button>

          {commRatesMutation.isSuccess && (
            <p className="mt-2 text-green-400 text-sm">✅ Commission rates updated successfully.</p>
          )}
          {commRatesMutation.isError && (
            <p className="mt-2 text-red-400 text-sm">❌ Failed to update commission rates: {(commRatesMutation.error as Error).message}</p>
          )}
        </div>

        {/* Danger Zone */}
        <div className="glass-card p-6 border-red-800/30">
          <h3 className="text-lg font-semibold text-red-400 mb-4">Danger Zone</h3>
          <p className="text-dark-400 text-sm mb-4">
            Owner-only panel. Requires a 4-digit PIN to access.
          </p>
          <button
            onClick={() => setShowPinModal(true)}
            className="btn bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-700/50 rounded-xl px-5 py-2.5 flex items-center gap-2 transition-all"
          >
            <Trash2 className="w-4 h-4" />
            Delete All Data
          </button>
        </div>

        {/* Owner Access Placeholder */}
        {ownerAccess && (
          <div className="glass-card p-6 border-primary-800/30">
            <h3 className="text-lg font-semibold text-primary-400 mb-4">Owner Panel</h3>
            <p className="text-green-400 text-sm">Access granted ✓</p>
            <p className="text-dark-400 text-sm mt-1">Panel content coming in the next step.</p>
          </div>
        )}
      </div>

      {/* PIN Modal */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-dark-800 rounded-2xl p-8 w-full max-w-sm mx-4 border border-dark-700 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-white">Enter PIN</h3>
              <button
                onClick={() => { setShowPinModal(false); setPinError(''); setPinInput(''); }}
                className="text-dark-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePinSubmit(); }}
              placeholder="****"
              className="input-field w-full text-center text-2xl tracking-[0.5em] mb-4"
              autoFocus
            />
            {pinError && (
              <p className="text-red-400 text-sm text-center mb-4">{pinError}</p>
            )}
            <button
              onClick={handlePinSubmit}
              disabled={pinInput.length !== 4 || pinLoading}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {pinLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Verify'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
