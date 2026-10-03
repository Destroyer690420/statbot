import sharp, { type Metadata } from 'sharp';
import jsQR from 'jsqr';
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
 * - The QR region is auto-cropped when it can be decoded (workers upload
 *   full payment posters, not tight QR crops — without this the code
 *   renders tiny inside the popup). When nothing decodes, the image is
 *   kept as-is (graceful fallback, never a rejection).
 * - Only images whose longer side exceeds 1200px are resized (fit inside
 *   1200px, same format, no quality/format change); everything else is
 *   stored byte-for-byte as uploaded.
 * - The buffer must fully decode via sharp before anything hits the disk.
 * - A decodable `upi://pay?pa=` payload yields the UPI ID for the admin
 *   popup's copy button (free side-effect of the decode).
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
  /** True when the stored bytes are a crop of the QR region. */
  cropped: boolean;
  /** UPI ID from a decodable upi:// payload, else null. */
  upiId: string | null;
}

export interface QrCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DetectedQr {
  /**
   * Crop box in ORIGINAL image coordinates, or null when the code already
   * fills the frame (nothing worth cutting — keeps tight uploads
   * byte-for-byte).
   */
  crop: QrCrop | null;
  payload: string;
  upiId: string | null;
}

// Detection runs on a downscaled copy (fast, still plenty for finding
// finder patterns); the box is scaled back to original coordinates.
const DETECT_MAX_SIDE = 800;
// Quiet-zone padding per side, relative to the code size.
const QUIET_ZONE_RATIO = 0.12;

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
 * Extract the UPI ID (`pa`) from a decoded QR payload. Only `upi://`
 * payloads with a plausible `pa` value qualify — anything else yields null
 * (a decodable non-payment QR is still cropped, just without a UPI ID).
 */
export function parseUpiId(payload: string): string | null {
  let url: URL;
  try {
    url = new URL(String(payload || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'upi:') return null;
  const pa = url.searchParams.get('pa');
  if (!pa || !pa.includes('@')) return null;
  return pa;
}

/**
 * Locate the QR code in an image. Returns the crop box plus the decoded
 * payload, or null when nothing decodes (stylized/damaged codes, non-QR
 * images that still passed the format sniff). Never throws — callers treat
 * null as "keep the image as-is".
 *
 * `attemptBoth` covers inverted (light-on-dark) payment posters; the probe
 * is downscaled for speed and the box is mapped back to original pixels.
 */
export async function detectQrRegion(raw: Buffer, origWidth: number, origHeight: number): Promise<DetectedQr | null> {
  if (!origWidth || !origHeight) return null;
  let probe: { data: Buffer; info: { width: number; height: number } };
  try {
    probe = await sharp(raw)
      .rotate()
      .resize(DETECT_MAX_SIDE, DETECT_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    return null;
  }
  const pw = probe.info.width;
  const ph = probe.info.height;
  if (!pw || !ph) return null;

  let found: { data: string; location: { topLeftCorner: { x: number; y: number }; topRightCorner: { x: number; y: number }; bottomRightCorner: { x: number; y: number }; bottomLeftCorner: { x: number; y: number } } } | null;
  try {
    found = jsQR(new Uint8ClampedArray(probe.data), pw, ph, { inversionAttempts: 'attemptBoth' });
  } catch {
    return null;
  }
  if (!found?.location) return null;

  const sx = origWidth / pw;
  const sy = origHeight / ph;
  const xs = [
    found.location.topLeftCorner.x,
    found.location.topRightCorner.x,
    found.location.bottomRightCorner.x,
    found.location.bottomLeftCorner.x,
  ].map((x) => x * sx);
  const ys = [
    found.location.topLeftCorner.y,
    found.location.topRightCorner.y,
    found.location.bottomRightCorner.y,
    found.location.bottomLeftCorner.y,
  ].map((y) => y * sy);
  const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * QUIET_ZONE_RATIO;
  const left = Math.max(0, Math.floor(Math.min(...xs) - pad));
  const top = Math.max(0, Math.floor(Math.min(...ys) - pad));
  const right = Math.min(origWidth, Math.ceil(Math.max(...xs) + pad));
  const bottom = Math.min(origHeight, Math.ceil(Math.max(...ys) + pad));
  const width = right - left;
  const height = bottom - top;
  if (width < 1 || height < 1) return null;

  const payload = found.data;
  const upiId = parseUpiId(payload);
  // Already a tight QR (the padded box is the whole frame): nothing to cut,
  // but the payload is still worth reporting.
  if (left <= 0 && top <= 0 && right >= origWidth && bottom >= origHeight) {
    return { crop: null, payload, upiId };
  }
  return { crop: { left, top, width, height }, payload, upiId };
}

/**
 * Sniff the real format via sharp (never the declared MIME type) and return
 * the EXIF-oriented dimensions. Throws QrValidationError when the buffer is
 * not a readable image or not PNG/JPEG/WebP. Shared by the upload path and
 * the backfill.
 */
export async function sniffQrImage(raw: Buffer): Promise<{
  mimeType: string;
  extension: string;
  width: number;
  height: number;
}> {
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
  const { width, height } = orientedDims(meta);
  return { mimeType: info.mimeType, extension: info.extension, width, height };
}

/**
 * Sniff the real format via sharp (never the declared MIME type), enforce
 * the PNG/JPEG/WebP allowlist, auto-crop to the decoded QR region (when one
 * is found), resize only when the longer side exceeds 1200px (same format,
 * no quality/format change), and verify the buffer fully decodes before it
 * is ever saved. Throws QrValidationError.
 */
export async function processQrImage(raw: Buffer): Promise<ProcessedQrImage> {
  const sniffed = await sniffQrImage(raw);
  try {
    const final = await finalizeQrBuffer(raw, sniffed.width, sniffed.height);
    return {
      buffer: final.buffer,
      mimeType: sniffed.mimeType,
      extension: sniffed.extension,
      resized: final.resized,
      cropped: final.cropped,
      upiId: final.upiId,
    };
  } catch (error) {
    if (error instanceof QrValidationError) throw error;
    throw new QrValidationError('That file could not be read as an image. Upload a valid PNG, JPEG or WebP QR code.');
  }
}

/** EXIF-aware dimensions: sharp's rotate() swaps these for orientations 5-8. */
function orientedDims(meta: Metadata): { width: number; height: number } {
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const o = meta.orientation ?? 1;
  if (o >= 5 && o <= 8) return { width: h, height: w };
  return { width: w, height: h };
}

/**
 * Crop to the QR region (when detected) and apply the 1200px ceiling, in
 * the original format throughout. Used by both the upload path and the
 * backfill, so the two can never drift apart.
 */
export async function finalizeQrBuffer(raw: Buffer, origWidth: number, origHeight: number): Promise<{
  buffer: Buffer;
  resized: boolean;
  cropped: boolean;
  upiId: string | null;
}> {
  let source = raw;
  let width = origWidth;
  let height = origHeight;
  let cropped = false;
  let upiId: string | null = null;

  const detected = await detectQrRegion(raw, origWidth, origHeight);
  if (detected) {
    upiId = detected.upiId;
    if (detected.crop) {
      try {
        // rotate() first so the extract coordinates (measured on the
        // orientation-corrected probe) apply to the same pixels.
        source = await sharp(raw).rotate().extract(detected.crop).toBuffer();
        width = detected.crop.width;
        height = detected.crop.height;
        cropped = true;
      } catch {
        source = raw;
        width = origWidth;
        height = origHeight;
        cropped = false;
      }
    }
  }

  if (Math.max(width, height) > PAYMENT_QR_MAX_DIMENSION) {
    const resized = await sharp(source)
      .rotate()
      .resize(PAYMENT_QR_MAX_DIMENSION, PAYMENT_QR_MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toBuffer();
    return { buffer: resized, resized: true, cropped, upiId };
  }
  // Byte-for-byte path — still force a full decode so a valid header with
  // a corrupt body is rejected before anything is saved.
  await sharp(source).stats();
  return { buffer: source, resized: false, cropped, upiId };
}
