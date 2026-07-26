import { useState } from 'react';
import { X, ChevronDown, ChevronRight, IndianRupee, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface PeriodBounds {
  start: string | null;
  end: string | null;
}

interface VerificationComponent {
  label: string;
  method1: number;
  method2: number;
  match: boolean;
}

interface BreakdownCategory {
  posts: number;
  comments: number;
  netEarnings: number;
  oneTimeCosts?: number;
}

interface PeriodBreakdown {
  period: PeriodBounds;
  tasks: { totalPosts: number; totalComments: number };
  breakdown: {
    directInvite: BreakdownCategory;
    normalInvite: BreakdownCategory & { oneTimeCosts: number };
    specialInvite: BreakdownCategory & { oneTimeCosts: number };
  };
  verification: {
    method1: number;
    method2: number;
    match: boolean;
    components: VerificationComponent[];
  };
}

interface EarningsData {
  daily: PeriodBreakdown;
  weekly: PeriodBreakdown;
  allTime: PeriodBreakdown;
}

interface Props {
  data: EarningsData;
  onClose: () => void;
}

function formatINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

function PeriodCard({ label, period }: { label: string; period: PeriodBreakdown }) {
  const [expanded, setExpanded] = useState(false);
  const { verification, tasks, breakdown } = period;

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-white font-semibold text-lg">{label}</h4>
        <span className={`text-2xl font-bold ${verification.match ? 'text-green-400' : 'text-red-400'}`}>
          {formatINR(verification.method1)}
        </span>
      </div>
      <p className="text-dark-400 text-sm mb-3">
        {tasks.totalPosts} posts / {tasks.totalComments} comments
      </p>

      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-primary-400 hover:text-primary-300 text-xs font-medium transition-colors"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {expanded ? 'Hide Details' : 'Show Details'}
      </button>

      {expanded && (
        <div className="mt-4 space-y-3 text-sm border-t border-dark-700/50 pt-3">
          <div className="space-y-1">
            <p className="text-dark-400">
              Direct Invite:{' '}
              <span className="text-white font-medium">{formatINR(breakdown.directInvite.netEarnings)}</span>
              <span className="text-dark-500 text-xs ml-1">
                ({breakdown.directInvite.posts}p / {breakdown.directInvite.comments}c)
              </span>
            </p>
            <p className="text-dark-400">
              Normal Invite:{' '}
              <span className="text-white font-medium">{formatINR(breakdown.normalInvite.netEarnings)}</span>
              <span className="text-dark-500 text-xs ml-1">
                ({breakdown.normalInvite.posts}p / {breakdown.normalInvite.comments}c)
              </span>
            </p>
            {breakdown.normalInvite.oneTimeCosts > 0 && (
              <p className="text-red-400 text-xs pl-4">
                -{formatINR(breakdown.normalInvite.oneTimeCosts)} one-time bonuses
              </p>
            )}
            <p className="text-dark-400">
              Special Invite:{' '}
              <span className="text-white font-medium">{formatINR(breakdown.specialInvite.netEarnings)}</span>
              <span className="text-dark-500 text-xs ml-1">
                ({breakdown.specialInvite.posts}p / {breakdown.specialInvite.comments}c)
              </span>
            </p>
            {breakdown.specialInvite.oneTimeCosts > 0 && (
              <p className="text-red-400 text-xs pl-4">
                -{formatINR(breakdown.specialInvite.oneTimeCosts)} one-time bonuses
              </p>
            )}
          </div>

          <div className="border-t border-dark-700/50 pt-3">
            <p className="text-dark-300 text-xs font-semibold uppercase tracking-wider mb-2">Verification</p>
            <div className="space-y-1">
              {verification.components.map((comp) => (
                <div key={comp.label} className="flex items-center justify-between">
                  <span className="text-dark-400 text-xs">{comp.label}</span>
                  <span className="flex items-center gap-2">
                    <span className={`font-mono text-xs ${comp.match ? 'text-dark-300' : 'text-red-400'}`}>
                      {formatINR(comp.method1)} / {formatINR(comp.method2)}
                    </span>
                    {comp.match ? (
                      <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-500" />
                    )}
                  </span>
                </div>
              ))}
            </div>
            {!verification.match && (
              <p className="text-red-400 text-xs mt-2">
                Mismatch detected! Method 1: {formatINR(verification.method1)}, Method 2: {formatINR(verification.method2)}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function OwnerEarningsPanel({ data, onClose }: Props) {
  if (!data) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="glass-card p-8">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <IndianRupee className="w-5 h-5 text-primary-400" />
            <h2 className="text-xl font-bold text-white">Owner Earnings</h2>
          </div>
          <button
            onClick={onClose}
            className="text-dark-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <PeriodCard label="Daily" period={data.daily} />
          <PeriodCard label="Weekly" period={data.weekly} />
          <PeriodCard label="All Time" period={data.allTime} />
        </div>

        <p className="text-dark-500 text-xs text-center mt-4">
          All amounts in Indian Rupees (₹). Earnings = Revenue − Worker Payments − Commissions.
        </p>
      </div>
    </div>
  );
}
