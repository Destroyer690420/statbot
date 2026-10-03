import sharp, { type Metadata } from 'sharp';
import * as path from 'path';

/**
 * Worker-uploaded payment QR codes (UPI QRs used by admins at payout time).
 *
 * Deliberately NOT the lossy WebP compression ladder in
 * `src/utils/image-processor.ts`: that ladder exists for insight
 * screenshots, where some quality loss is fine. A QR code is different —
 * lossy compression or aggressive downscaling can break individual modules
 * and make the code unscannable. So for QR uploads:
 * - PNG, JPEG and WebP only (by sniffed format, never the declared MIME).
 * - Input capped at 3 MB, rejected outright when larger (never compressed).
 * - Only images whose longer side exceeds 1200px are resized (fit inside
 *   1200px, same format, no quality/format change); everything else is
 *   stored byte-for-byte as uploaded.
 * - The buffer must fully decode via sharp before anything hits the disk.
 */

export const PAYMENT_QR_MAX_BYTES = 3 * 1024 * 1024;
export const PAYMENT_QR_MAX_DIMENSION = 1200;

export class QrValidationError extends Error {}

const QR_FORMATS: Record<string, { mimeType: string; extension: string }> = {
  png: { mimeType: 'image/png', extension: 'png' },
  jpeg: { mimeType: 'image/jpeg', extension: 'jpg' },
  jpg: { mimeType: 'image/jpeg', extension: 'jpg' },
  webp: { mimeType: 'image/webp', extension: 'webp' },
};

export interface ProcessedQrImage {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  resized: boolean;
}

const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]*)$/;

export function paymentQrDir(): string {
  // PAYMENT_QR_DIR is a test hook so route tests never touch the real
  // uploads/ tree. Read at call time, never cached.
  if (process.env.PAYMENT_QR_DIR) return path.resolve(process.env.PAYMENT_QR_DIR);
  return path.resolve('uploads', 'payment-qr');
}

export function buildQrCodeUrl(workerId: string, filename: string, updatedAt: Date): string {
  // Served under /api/v1 (same convention as insightImageUrl) so the
  // dashboard nginx proxy reaches it; ?v= busts caches after a replace.
  return `/api/v1/uploads/payment-qr/${encodeURIComponent(workerId)}/${encodeURIComponent(filename)}?v=${updatedAt.getTime()}`;
}

/**
 * Validate the JSON body shape and decode the data URL to raw bytes.
 * The declared MIME type is ignored beyond the shape check — the real
 * format is sniffed from the bytes in processQrImage. Throws
 * QrValidationError with a worker-safe message on any problem.
 */
export function decodeQrDataUrl(image: unknown): Buffer {
  if (typeof image !== 'string' || image.length === 0) {
    throw new QrValidationError('A QR image is required. Upload a PNG, JPEG or WebP file.');
  }
  const match = image.match(DATA_URL_RE);
  if (!match) {
    throw new QrValidationError('That file is not a supported image. Upload a PNG, JPEG or WebP QR code.');
  }
  const b64 = match[2].replace(/\s+/g, '');
  if (b64.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    throw new QrValidationError('That file is not a supported image. Upload a PNG, JPEG or WebP QR code.');
  }
  const raw = Buffer.from(b64, 'base64');
  if (raw.length === 0) {
    throw new QrValidationError('That file is not a supported image. Upload a PNG, JPEG or WebP QR code.');
  }
  if (raw.length > PAYMENT_QR_MAX_BYTES) {
    throw new QrValidationError('That QR code is larger than 3 MB. Upload a smaller image instead.');
  }
  return raw;
}

/**
 * Sniff the real format via sharp (never the declared MIME type), enforce
 * the PNG/JPEG/WebP allowlist, resize only when the longer side exceeds
 * 1200px (same format, no quality/format change), and verify the buffer
 * fully decodes before it is ever saved. Throws QrValidationError.
 */
export async function processQrImage(raw: Buffer): Promise<ProcessedQrImage> {
  let meta: Metadata;
  try {
    meta = await sharp(raw).metadata();
  } catch {
    throw new QrValidationError('That file could not be read as an image. Upload a valid PNG, JPEG or WebP QR code.');
  }
  const format = (meta.format || '').toLowerCase();
  const info = QR_FORMATS[format];
  if (!info) {
    throw new QrValidationError('Only PNG, JPEG and WebP QR codes are supported.');
  }
  const longestSide = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (longestSide > PAYMENT_QR_MAX_DIMENSION) {
    try {
      const resized = await sharp(raw)
        .rotate()
        .resize(PAYMENT_QR_MAX_DIMENSION, PAYMENT_QR_MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer();
      return { buffer: resized, mimeType: info.mimeType, extension: info.extension, resized: true };
    } catch {
      throw new QrValidationError('That file could not be read as an image. Upload a valid PNG, JPEG or WebP QR code.');
    }
  }
  // Byte-for-byte path — still force a full decode so a valid header with
  // a corrupt body is rejected before anything is saved.
  try {
    await sharp(raw).stats();
  } catch {
    throw new QrValidationError('That file could not be read as an image. Upload a valid PNG, JPEG or WebP QR code.');
  }
  return { buffer: raw, mimeType: info.mimeType, extension: info.extension, resized: false };
}
