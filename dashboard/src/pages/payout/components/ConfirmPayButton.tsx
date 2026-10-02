import { Loader2, X } from 'lucide-react';

interface ConfirmPayButtonProps {
  label: string;
  isConfirming: boolean;
  isPending: boolean;
  onStartConfirm: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmPayButton({
  label,
  isConfirming,
  isPending,
  onStartConfirm,
  onConfirm,
  onCancel,
}: ConfirmPayButtonProps) {
  if (isConfirming) {
    return (
      <div className="flex items-center justify-center gap-2">
        <button
          onClick={onConfirm}
          disabled={isPending}
          className="bg-primary-600 hover:bg-primary-500 text-text-primary text-xs font-medium py-1.5 px-3 rounded-lg transition-colors"
        >
          {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm'}
        </button>
        <button
          onClick={onCancel}
          className="text-dark-400 hover:text-text-primary text-xs transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onStartConfirm}
      className="btn-primary text-xs py-1.5 px-3"
    >
      {label}
    </button>
  );
}
