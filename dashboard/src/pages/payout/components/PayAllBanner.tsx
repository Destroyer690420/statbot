import { ReactNode } from 'react';
import {
  AlertTriangle,
  Loader2,
  IndianRupee,
  X,
} from 'lucide-react';

interface PayAllBannerProps {
  title: string;
  subtitle: string;
  confirmMessage: string;
  isConfirming: boolean;
  setIsConfirming: (v: boolean) => void;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  errorMessage?: string;
  successContent?: ReactNode;
  onConfirm: () => void;
}

export function PayAllBanner({
  title,
  subtitle,
  confirmMessage,
  isConfirming,
  setIsConfirming,
  isPending,
  isError,
  isSuccess,
  errorMessage,
  successContent,
  onConfirm,
}: PayAllBannerProps) {
  return (
    <div className="pay-all-banner">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold text-white">{title}</h3>
          <p className="text-dark-400 text-xs sm:text-sm mt-0.5">{subtitle}</p>
        </div>

        {!isConfirming ? (
          <button
            onClick={() => setIsConfirming(true)}
            className="btn-primary flex items-center gap-2 text-sm shrink-0"
          >
            <IndianRupee className="w-4 h-4" />
            Pay All
          </button>
        ) : (
          <div className="flex items-center gap-2 sm:gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 sm:px-4 py-2.5 shrink-0">
            <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-400 shrink-0" />
            <p className="text-yellow-300 text-xs sm:text-sm whitespace-nowrap">{confirmMessage}</p>
            <button
              onClick={onConfirm}
              disabled={isPending}
              className="bg-primary-600 hover:bg-primary-500 text-white text-xs sm:text-sm font-medium px-3 sm:px-4 py-1.5 rounded-lg transition-colors"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
            </button>
            <button
              onClick={() => setIsConfirming(false)}
              className="text-dark-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {isError && errorMessage && (
        <p className="mt-2 text-red-400 text-sm">{errorMessage}</p>
      )}
      {isSuccess && successContent && (
        <div className="mt-2 text-green-400 text-sm">{successContent}</div>
      )}
    </div>
  );
}
