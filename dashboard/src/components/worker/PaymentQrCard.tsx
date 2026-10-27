import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, QrCode, Upload, X } from 'lucide-react';
import { getWorkerQrCode, uploadWorkerQrCode, workerErrorMessage } from '../../api/workerApi';
import { formatISTDate } from '../../utils/workerFormat';
import { WorkerCard, WorkerErrorState, WorkerSkeleton } from './WorkerUI';

const QR_ACCEPT = 'image/png,image/jpeg,image/webp';
const QR_MAX_BYTES = 3 * 1024 * 1024;

export function PaymentQrCard() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const qrQuery = useQuery({ queryKey: ['worker-wallet-qr'], queryFn: getWorkerQrCode });

  const openPicker = () => {
    setError(null);
    fileRef.current?.click();
  };

  const handleFile = (file: File | undefined) => {
    if (!file || uploading) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Please choose a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > QR_MAX_BYTES) {
      setError('That image is larger than 3 MB. Please choose a smaller file.');
      return;
    }
    setError(null);
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await uploadWorkerQrCode(String(reader.result));
        await qrQuery.refetch();
      } catch (err) {
        setError(workerErrorMessage(err, 'Could not upload your QR code. Please try again.'));
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    };
    reader.onerror = () => {
      setError('Could not read that file. Please try another image.');
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  if (qrQuery.isLoading) {
    return <WorkerSkeleton className="h-44 w-full" />;
  }

  if (qrQuery.isError || !qrQuery.data?.success) {
    return (
      <WorkerErrorState
        message={workerErrorMessage(qrQuery.error, 'Could not load your payment QR code.')}
        onRetry={() => qrQuery.refetch()}
      />
    );
  }

  const qrCodeUrl: string | null = qrQuery.data?.data?.qrCodeUrl ?? null;
  const updatedAt: string | null = qrQuery.data?.data?.updatedAt ?? null;

  return (
    <>
      <WorkerCard className="p-4 sm:p-5">
        {qrCodeUrl ? (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setLightbox(true)}
              className="shrink-0 rounded-xl border border-worker-border bg-white p-1 transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent"
              title="View full size"
            >
              <img src={qrCodeUrl} alt="Your payment QR code" className="h-24 w-24 rounded-lg object-contain" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-worker-text">Payment QR code</p>
              <p className="mt-1 text-xs text-worker-text-muted">
                {updatedAt ? `Updated ${formatISTDate(updatedAt)}` : 'Uploaded'} · tap the code to view full size
              </p>
              <button type="button" onClick={openPicker} disabled={uploading} className="worker-secondary-button mt-3 !min-h-[40px] px-3 py-1.5 text-[13px]">
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    Change QR code
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-worker-border px-4 py-6 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-worker-surface-2 text-worker-text-faint">
              <QrCode className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-worker-text-muted">
              Add your payment QR code so you get paid faster
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-worker-text-faint">
              Tip: crop to just the QR code — a full poster screenshot is too small to scan.
            </p>
            <button type="button" onClick={openPicker} disabled={uploading} className="worker-primary-button mt-4">
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Upload QR code
                </>
              )}
            </button>
          </div>
        )}
        {error ? <p className="mt-3 text-[13px] leading-5 text-worker-danger">{error}</p> : null}
        <input
          ref={fileRef}
          type="file"
          accept={QR_ACCEPT}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </WorkerCard>
      {lightbox && qrCodeUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setLightbox(false)}
        >
          <div className="relative rounded-2xl bg-white p-3" onClick={(e) => e.stopPropagation()}>
            <img src={qrCodeUrl} alt="Your payment QR code, full size" className="h-auto w-full max-w-sm rounded-lg object-contain" />
            <button
              type="button"
              onClick={() => setLightbox(false)}
              className="absolute -right-3 -top-3 flex h-9 w-9 items-center justify-center rounded-full bg-worker-surface text-worker-text shadow-lg"
              title="Close"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
