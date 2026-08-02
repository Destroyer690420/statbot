import sharp from 'sharp';

/**
 * Image download + size policy per the GoPartTime spec:
 *  - Images <= 10 MB are returned unchanged (no re-encoding, byte-identical).
 *  - Images > 10 MB are compressed to approximately 9 MB (<= 9.5 MB target)
 *    using a WebP quality ladder that preserves alpha transparency.
 *  - Order is preserved by the caller (images are processed sequentially in
 *    the order provided).
 *  - An image is never silently discarded: any failure throws, so the caller
 *    marks the delivery as failed with the step recorded.
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_COMPRESSED_BYTES = Math.round(9.5 * 1024 * 1024);

const DOWNLOAD_TIMEOUT_MS = 30_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const WEBP_QUALITY_LADDER = [90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10];

const FORMAT_MIME: Record<string, { mime: string; extension: string }> = {
  jpeg: { mime: 'image/jpeg', extension: 'jpg' },
  jpg: { mime: 'image/jpeg', extension: 'jpg' },
  png: { mime: 'image/png', extension: 'png' },
  webp: { mime: 'image/webp', extension: 'webp' },
  gif: { mime: 'image/gif', extension: 'gif' },
  avif: { mime: 'image/avif', extension: 'avif' },
  heif: { mime: 'image/heif', extension: 'heif' },
  tiff: { mime: 'image/tiff', extension: 'tiff' },
  svg: { mime: 'image/svg+xml', extension: 'svg' },
};

export interface PreparedImage {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  originalBytes: number;
  compressed: boolean;
}

/**
 * Downloads an image and applies the size policy. Throws on download or
 * compression failure — the image is never silently dropped.
 */
export async function prepareImage(url: string): Promise<PreparedImage> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'image/*,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Image download failed (HTTP ${response.status}).`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error('Image download failed (empty response).');
  }

  const originalBytes = buffer.length;

  if (buffer.length <= MAX_IMAGE_BYTES) {
    const formatInfo = await sniffFormat(buffer);
    return {
      buffer,
      mimeType: formatInfo.mime,
      extension: formatInfo.extension,
      originalBytes,
      compressed: false,
    };
  }

  const compressed = await compressImage(buffer);
  return {
    buffer: compressed,
    mimeType: 'image/webp',
    extension: 'webp',
    originalBytes,
    compressed: true,
  };
}

async function sniffFormat(buffer: Buffer): Promise<{ mime: string; extension: string }> {
  try {
    const meta = await sharp(buffer).metadata();
    const format = (meta.format || 'jpeg').toLowerCase();
    const info = FORMAT_MIME[format];
    if (info) return info;
  } catch {
    // Fall through to a generic JPEG assumption; the buffer is returned
    // unchanged either way.
  }
  return { mime: 'image/jpeg', extension: 'jpg' };
}

/**
 * Compresses an oversized image to <= MAX_COMPRESSED_BYTES (~9 MB target).
 * Uses a WebP quality ladder (alpha-preserving). If even the lowest quality
 * exceeds the target, the image is scaled down proportionally. Throws if the
 * image still cannot be reduced.
 */
async function compressImage(buffer: Buffer): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const hasAlpha = meta.hasAlpha === true;
  const width = meta.width ?? 2000;
  const height = meta.height ?? 2000;

  // 1. Quality ladder
  for (const quality of WEBP_QUALITY_LADDER) {
    const candidate = await sharp(buffer)
      .rotate()
      .webp({ quality, alphaQuality: hasAlpha ? 100 : undefined })
      .toBuffer();

    if (candidate.length <= MAX_COMPRESSED_BYTES) {
      return candidate;
    }
  }

  // 2. Scale-down ladder (keeps aspect ratio, still alpha-preserving WebP)
  let scale = 0.9;
  let currentWidth = width;
  let currentHeight = height;
  for (let i = 0; i < 10; i++) {
    currentWidth = Math.max(64, Math.round(currentWidth * scale));
    currentHeight = Math.max(64, Math.round(currentHeight * scale));
    const candidate = await sharp(buffer)
      .rotate()
      .resize(currentWidth, currentHeight, { fit: 'inside' })
      .webp({ quality: 80, alphaQuality: hasAlpha ? 100 : undefined })
      .toBuffer();

    if (candidate.length <= MAX_COMPRESSED_BYTES) {
      return candidate;
    }
  }

  throw new Error('Image compression failed: image could not be reduced below the size limit.');
}
