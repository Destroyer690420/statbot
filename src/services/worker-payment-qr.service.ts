import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { workerPaymentInfoRepository } from '../database/repositories/worker-payment-info.repository';
import {
  buildQrCodeUrl,
  decodeQrDataUrl,
  paymentQrDir,
  processQrImage,
} from '../utils/payment-qr';

export interface WorkerQrInfo {
  qrCodeUrl: string | null;
  updatedAt: string | null;
}

/**
 * The worker's current QR, or nulls when they never uploaded one (or the
 * file is gone from disk). Never an error — paying without a QR must stay
 * possible, so callers show a placeholder instead of failing.
 */
export async function getWorkerQrInfo(workerId: string): Promise<WorkerQrInfo> {
  const row = await workerPaymentInfoRepository.get(workerId);
  if (!row) return { qrCodeUrl: null, updatedAt: null };
  if (!fsSync.existsSync(path.join(paymentQrDir(), row.filename))) {
    return { qrCodeUrl: null, updatedAt: null };
  }
  return {
    qrCodeUrl: buildQrCodeUrl(workerId, row.filename, row.updatedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Validate → process → save one worker's QR (single current file per
 * worker: `<workerId>.<ext>`; a re-upload overwrites, and the old file is
 * removed first when the extension changes, e.g. png → jpg).
 */
export async function saveWorkerQrCode(workerId: string, image: unknown): Promise<WorkerQrInfo> {
  const raw = decodeQrDataUrl(image);
  const processed = await processQrImage(raw);
  const dir = paymentQrDir();
  await fs.mkdir(dir, { recursive: true });

  const previous = await workerPaymentInfoRepository.get(workerId);
  const filename = `${workerId}.${processed.extension}`;
  await fs.writeFile(path.join(dir, filename), processed.buffer);
  if (previous && previous.filename !== filename) {
    await fs.unlink(path.join(dir, previous.filename)).catch(() => {
      // Best-effort: the DB row is the source of truth either way.
    });
  }

  const row = await workerPaymentInfoRepository.upsert(workerId, {
    filename,
    mimeType: processed.mimeType,
  });
  return {
    qrCodeUrl: buildQrCodeUrl(workerId, row.filename, row.updatedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}
