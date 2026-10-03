import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { workerPaymentInfoRepository } from '../database/repositories/worker-payment-info.repository';
import {
  buildQrCodeUrl,
  decodeQrDataUrl,
  finalizeQrBuffer,
  paymentQrDir,
  processQrImage,
  sniffQrImage,
} from '../utils/payment-qr';
import { logger } from '../utils/logger';

export interface WorkerQrInfo {
  qrCodeUrl: string | null;
  updatedAt: string | null;
  upiId: string | null;
}

/**
 * The worker's current QR, or nulls when they never uploaded one (or the
 * file is gone from disk). Never an error — paying without a QR must stay
 * possible, so callers show a placeholder instead of failing.
 */
export async function getWorkerQrInfo(workerId: string): Promise<WorkerQrInfo> {
  const row = await workerPaymentInfoRepository.get(workerId);
  if (!row) return { qrCodeUrl: null, updatedAt: null, upiId: null };
  if (!fsSync.existsSync(path.join(paymentQrDir(), row.filename))) {
    return { qrCodeUrl: null, updatedAt: null, upiId: null };
  }
  return {
    qrCodeUrl: buildQrCodeUrl(workerId, row.filename, row.updatedAt),
    updatedAt: row.updatedAt.toISOString(),
    upiId: row.upiId ?? null,
  };
}

/**
 * Validate → process (auto-crop when the QR decodes) → save one worker's QR
 * (single current file per worker: `<workerId>.<ext>`; a re-upload
 * overwrites, and the old file is removed first when the extension
 * changes, e.g. png → jpg).
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
    upiId: processed.upiId,
  });
  return {
    qrCodeUrl: buildQrCodeUrl(workerId, row.filename, row.updatedAt),
    updatedAt: row.updatedAt.toISOString(),
    upiId: row.upiId ?? null,
  };
}

export interface QrBackfillResult {
  checked: number;
  recropped: number;
  upiSet: number;
  skipped: number;
  missing: number;
}

/**
 * One-off recrop of QR files already on disk (e.g. full payment posters
 * uploaded before auto-crop existed). Re-runs the exact upload pipeline
 * over each stored file: files whose QR decodes to a smaller region are
 * overwritten with the crop (same `<workerId>.<ext>` name, so existing
 * `qrCodeUrl`s keep working and `?v=` — driven by `updatedAt` — busts
 * caches), and newly decodable UPI IDs are recorded. `dryRun` computes the
 * outcome without writing anything. Never throws per-file errors — they are
 * logged and counted as skipped.
 */
export async function backfillQrCrops(opts?: { dryRun?: boolean }): Promise<QrBackfillResult> {
  const dryRun = opts?.dryRun ?? false;
  const result: QrBackfillResult = { checked: 0, recropped: 0, upiSet: 0, skipped: 0, missing: 0 };
  const dir = paymentQrDir();
  const rows = await workerPaymentInfoRepository.list();

  for (const row of rows) {
    result.checked += 1;
    const filePath = path.join(dir, row.filename);
    let raw: Buffer;
    try {
      raw = await fs.readFile(filePath);
    } catch {
      result.missing += 1;
      continue;
    }

    let final: { buffer: Buffer; resized: boolean; cropped: boolean; upiId: string | null };
    try {
      const sniffed = await sniffQrImage(raw);
      final = await finalizeQrBuffer(raw, sniffed.width, sniffed.height);
    } catch (error) {
      logger.warn('QR backfill skipped file', {
        workerId: row.workerId,
        error: error instanceof Error ? error.message : String(error),
      });
      result.skipped += 1;
      continue;
    }

    const bytesChanged = final.cropped && !final.buffer.equals(raw);
    const upiChanged = (final.upiId ?? null) !== (row.upiId ?? null);
    if (!bytesChanged && !upiChanged) {
      result.skipped += 1;
      continue;
    }
    if (dryRun) {
      if (bytesChanged) result.recropped += 1;
      if (upiChanged && final.upiId) result.upiSet += 1;
      continue;
    }

    try {
      if (bytesChanged) {
        await fs.writeFile(filePath, final.buffer);
        result.recropped += 1;
      }
      if (upiChanged) {
        await workerPaymentInfoRepository.upsert(row.workerId, {
          filename: row.filename,
          mimeType: row.mimeType,
          upiId: final.upiId,
        });
        if (final.upiId) result.upiSet += 1;
      }
      logger.info('QR backfill updated file', {
        workerId: row.workerId,
        recropped: bytesChanged,
        upiSet: upiChanged && !!final.upiId,
      });
    } catch (error) {
      logger.warn('QR backfill write failed', {
        workerId: row.workerId,
        error: error instanceof Error ? error.message : String(error),
      });
      result.skipped += 1;
    }
  }

  return result;
}
