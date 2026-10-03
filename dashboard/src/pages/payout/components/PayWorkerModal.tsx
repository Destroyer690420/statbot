import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, QrCode, X } from 'lucide-react';
import { getWorkerQrCode, payWorker } from '../../../api/client';
import { formatCurrency } from '../utils';

interface PayWorkerModalProps {
  workerId: string;
  workerName: string;
  totalAmount: number;
  dateParams: Record<string, string> | undefined;
  onClose: () => void;
  onPaid: () => void;
}

/**
 * Pay Worker popup: shows the worker's uploaded payment QR next to the
 * amount, then Confirms through the exact same payWorker request the table
 * used before (same params, same invalidation) and closes on success.
 * A missing QR never blocks paying — the placeholder stays and Confirm
 * stays enabled.
 */
export function PayWorkerModal({
  workerId,
  workerName,
  totalAmount,
  dateParams,
  onClose,
  onPaid,
}: PayWorkerModalProps) {
  const qrQuery = useQuery({
    queryKey: ['worker-qr', workerId],
    queryFn: () => getWorkerQrCode(workerId),
    enabled: !!workerId,
  });

  const payMutation = useMutation({
    mutationFn: () => payWorker(workerId, dateParams),
    onSuccess: () => {
      onPaid();
      onClose();
    },
  });

  const qrCodeUrl: string | null = qrQuery.data?.data?.qrCodeUrl ?? null;
  // Workers often upload a full payment poster instead of a tight QR crop,
  // so the code renders small in the fixed box — the lightbox shows the
  // image at near-natural size (up to the viewport) for reliable scanning.
  const [lightbox, setLightbox] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" onClick={onClose}>
      <div
        className="bg-dark-800 rounded-lg w-full max-w-lg border border-dark-700 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-700/50">
          <h3 className="text-base font-semibold text-text-primary">Pay Worker</h3>
          <button onClick={onClose} className="text-dark-500 hover:text-text-primary transition-colors" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">
          <div className="flex flex-col sm:flex-row gap-5">
            <div className="flex shrink-0 items-center justify-center">
              {qrQuery.isLoading ? (
                <div className="skeleton h-64 w-64 rounded-lg" />
              ) : qrCodeUrl ? (
                <button
                  type="button"
                  onClick={() => setLightbox(true)}
                  className="rounded-lg transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  title="View full size"
                >
                  <img
                    src={qrCodeUrl}
                    alt={`${workerName} payment QR code — click to view full size`}
                    className="h-64 w-64 rounded-lg bg-white object-contain p-1.5"
                  />
                </button>
              ) : (
                <div className="flex h-64 w-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-dark-700 bg-dark-900/40 px-3 text-center">
                  <QrCode className="w-7 h-7 text-dark-500" />
                  <p className="text-xs text-dark-400">No QR code uploaded yet</p>
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary truncate">{workerName}</p>
              <p className="mt-1 text-2xl font-semibold text-text-primary">{formatCurrency(totalAmount)}</p>
              <p className="mt-2 text-xs leading-5 text-dark-400">
                Scan the QR to pay, then Confirm to record the payment.
                {qrCodeUrl ? ' Click the code for a larger view.' : ''}
              </p>
            </div>
          </div>

          {payMutation.isError && (
            <p className="mt-4 text-danger text-sm">{(payMutation.error as Error).message}</p>
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button onClick={onClose} className="btn-secondary text-xs py-1.5 px-3">
              Cancel
            </button>
            <button
              onClick={() => payMutation.mutate()}
              disabled={payMutation.isPending}
              className="btn-primary text-xs py-1.5 px-3 inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {payMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Confirm
            </button>
          </div>
        </div>
      </div>
      {lightbox && qrCodeUrl ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 sm:p-6"
          onClick={() => setLightbox(false)}
        >
          <div className="relative max-h-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={qrCodeUrl}
              alt={`${workerName} payment QR code, full size`}
              className="max-h-[85vh] w-auto max-w-[90vw] rounded-lg bg-white object-contain p-2"
            />
            <button
              type="button"
              onClick={() => setLightbox(false)}
              className="absolute -right-3 -top-3 flex h-9 w-9 items-center justify-center rounded-full bg-dark-800 text-text-primary shadow-pop transition-colors hover:text-white"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
