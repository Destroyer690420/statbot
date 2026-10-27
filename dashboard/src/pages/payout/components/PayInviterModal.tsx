import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, QrCode, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { getInviterQrCode, payInviter } from '../../../api/client';
import { CopyButton } from '../../../components/CopyButton';
import { formatCurrency } from '../utils';
import { buildUpiPayLink } from '../utils/upiLink';

interface PayInviterModalProps {
  inviterId: string;
  inviterName: string;
  totalCommission: number;
  onClose: () => void;
  onPaid: () => void;
}

/**
 * Pay Inviter popup: shows the inviter's uploaded payment QR next to the
 * commission amount, then Confirms through payInviter request and closes on success.
 * A missing QR never blocks paying — the placeholder stays and Confirm
 * stays enabled.
 */
export function PayInviterModal({
  inviterId,
  inviterName,
  totalCommission,
  onClose,
  onPaid,
}: PayInviterModalProps) {
  const qrQuery = useQuery({
    queryKey: ['inviter-qr', inviterId],
    queryFn: () => getInviterQrCode(inviterId),
    enabled: !!inviterId,
  });

  const payMutation = useMutation({
    mutationFn: () => payInviter(inviterId),
    onSuccess: () => {
      onPaid();
      onClose();
    },
  });

  const qrCodeUrl: string | null = qrQuery.data?.data?.qrCodeUrl ?? null;
  const upiId: string | null = qrQuery.data?.data?.upiId ?? null;
  const upiLink = upiId ? buildUpiPayLink(upiId, totalCommission, inviterName) : null;
  const hasQr = !!upiLink || !!qrCodeUrl;
  const [lightbox, setLightbox] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" onClick={onClose}>
      <div
        className="bg-dark-800 rounded-lg w-full max-w-lg border border-dark-700 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-700/50">
          <h3 className="text-base font-semibold text-text-primary">Pay Inviter</h3>
          <button onClick={onClose} className="text-dark-500 hover:text-text-primary transition-colors" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">
          <div className="flex flex-col sm:flex-row gap-5">
            <div className="flex shrink-0 items-center justify-center">
              {qrQuery.isLoading ? (
                <div className="skeleton h-64 w-64 rounded-lg" />
              ) : upiLink ? (
                <button
                  type="button"
                  onClick={() => setLightbox(true)}
                  className="rounded-lg transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  title="View full size"
                >
                  <div className="flex h-64 w-64 items-center justify-center rounded-lg bg-white p-2">
                    <QRCodeSVG value={upiLink} size={240} />
                  </div>
                </button>
              ) : qrCodeUrl ? (
                <button
                  type="button"
                  onClick={() => setLightbox(true)}
                  className="rounded-lg transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  title="View full size"
                >
                  <img
                    src={qrCodeUrl}
                    alt={`${inviterName} payment QR code — click to view full size`}
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
              <p className="text-sm font-medium text-text-primary truncate">{inviterName}</p>
              <p className="mt-1 text-2xl font-semibold text-text-primary">{formatCurrency(totalCommission)}</p>
              <p className="mt-2 text-xs leading-5 text-dark-400">
                {upiLink
                  ? 'Scan to pay — the amount is already filled in.'
                  : 'Scan the QR to pay, then Confirm to record the commission payment.'}
                {hasQr ? ' Click the code for a larger view.' : ''}
              </p>
              {upiId ? (
                <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-dark-700 bg-dark-900/40 px-2.5 py-1.5">
                  <p className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary" title={upiId}>
                    {upiId}
                  </p>
                  <CopyButton value={upiId} title="Copy UPI ID" className="p-1.5" />
                </div>
              ) : null}
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
      {lightbox && hasQr ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 sm:p-6"
          onClick={() => setLightbox(false)}
        >
          <div className="relative max-h-full" onClick={(e) => e.stopPropagation()}>
            {upiLink ? (
              <div className="flex items-center justify-center rounded-lg bg-white p-6 shadow-pop">
                <QRCodeSVG value={upiLink} size={340} />
              </div>
            ) : qrCodeUrl ? (
              <img
                src={qrCodeUrl}
                alt={`${inviterName} payment QR code, full size`}
                className="max-h-[85vh] w-auto max-w-[90vw] rounded-lg bg-white object-contain p-2"
              />
            ) : null}
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
