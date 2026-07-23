import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Sun, Moon, Monitor, Loader2, IndianRupee } from 'lucide-react';
import { getPayoutRates, updatePayoutRates } from '../api/client';

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
      </div>
    </div>
  );
}
