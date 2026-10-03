import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import jsQR from 'jsqr';
import {
  PAYMENT_QR_MAX_BYTES,
  QrValidationError,
  buildQrCodeUrl,
  decodeQrDataUrl,
  detectQrRegion,
  parseUpiId,
  processQrImage,
} from '../utils/payment-qr';

const TINY_GIF_B64 =
  'R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

async function pngBuffer(width = 16, height = 16): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
}

function dataUrl(mime: string, buf: Buffer): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

describe('payment-qr image handling', () => {
  test('valid PNG is accepted byte-for-byte (not resized, not converted)', async () => {
    const raw = await pngBuffer();
    const decoded = decodeQrDataUrl(dataUrl('image/png', raw));
    expect(decoded.equals(raw)).toBe(true);
    const out = await processQrImage(decoded);
    expect(out.buffer.equals(raw)).toBe(true);
    expect(out.resized).toBe(false);
    expect(out.mimeType).toBe('image/png');
    expect(out.extension).toBe('png');
  });

  test('valid JPEG and WebP are accepted with their own format kept', async () => {
    const raw = await pngBuffer();
    const jpeg = await sharp(raw).jpeg().toBuffer();
    const webp = await sharp(raw).webp().toBuffer();

    const j = await processQrImage(decodeQrDataUrl(dataUrl('image/jpeg', jpeg)));
    expect(j.mimeType).toBe('image/jpeg');
    expect(j.extension).toBe('jpg');
    expect(j.resized).toBe(false);

    const w = await processQrImage(decodeQrDataUrl(dataUrl('image/webp', webp)));
    expect(w.mimeType).toBe('image/webp');
    expect(w.extension).toBe('webp');
    expect(w.resized).toBe(false);
  });

  test('oversized input is rejected outright, never compressed down', () => {
    const raw = Buffer.alloc(PAYMENT_QR_MAX_BYTES + 1024, 7);
    expect(() => decodeQrDataUrl(dataUrl('image/png', raw))).toThrow(QrValidationError);
    expect(() => decodeQrDataUrl(dataUrl('image/png', raw))).toThrow(/larger than 3 MB/);
  });

  test('non-image bytes with a spoofed image/png prefix are rejected', async () => {
    const fake = Buffer.from('this is definitely not image data');
    const decoded = decodeQrDataUrl(dataUrl('image/png', fake));
    await expect(processQrImage(decoded)).rejects.toThrow(QrValidationError);
  });

  test('GIF is rejected by sniffed format even with an honest prefix', async () => {
    const gif = Buffer.from(TINY_GIF_B64, 'base64');
    const decoded = decodeQrDataUrl(dataUrl('image/gif', gif));
    await expect(processQrImage(decoded)).rejects.toThrow(/Only PNG, JPEG and WebP/);
  });

  test('corrupt image data (truncated PNG) is rejected cleanly', async () => {
    const raw = await pngBuffer();
    const truncated = raw.slice(0, Math.floor(raw.length / 2));
    const decoded = decodeQrDataUrl(dataUrl('image/png', truncated));
    await expect(processQrImage(decoded)).rejects.toThrow(QrValidationError);
  });

  test('an image over 1200px is resized inside 1200px with format unchanged', async () => {
    const big = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .png()
      .toBuffer();
    // Sanity: the fixture itself must fit the upload cap.
    expect(big.length).toBeLessThanOrEqual(PAYMENT_QR_MAX_BYTES);
    const out = await processQrImage(decodeQrDataUrl(dataUrl('image/png', big)));
    expect(out.resized).toBe(true);
    expect(out.mimeType).toBe('image/png');
    expect(out.extension).toBe('png');
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('png');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1200);
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeGreaterThan(0);
  });

  test('missing, non-string, malformed and non-image bodies are rejected', () => {
    expect(() => decodeQrDataUrl(undefined)).toThrow(QrValidationError);
    expect(() => decodeQrDataUrl('')).toThrow(QrValidationError);
    expect(() => decodeQrDataUrl(42 as unknown as string)).toThrow(QrValidationError);
    expect(() => decodeQrDataUrl('{"not":"a data url"}')).toThrow(QrValidationError);
    expect(() => decodeQrDataUrl('data:image/png;base64,!!!not-base64!!!')).toThrow(QrValidationError);
    // Declared MIME is never trusted: a text payload with an image prefix
    // decodes fine here and is rejected later by the sharp sniff.
    const text = Buffer.from('plain text, not pixels');
    expect(() => decodeQrDataUrl(dataUrl('image/jpeg', text))).not.toThrow();
  });

  test('qrCodeUrl carries worker, filename and updatedAt cache-buster', () => {
    const at = new Date('2026-09-01T00:00:00.000Z');
    expect(buildQrCodeUrl('123', '123.png', at)).toBe(
      `/api/v1/uploads/payment-qr/123/123.png?v=${at.getTime()}`,
    );
  });
});

const FIXTURE_UPI = path.join(__dirname, 'fixtures', 'qr-upi.png');
const FIXTURE_TEXT = path.join(__dirname, 'fixtures', 'qr-text.png');

function readFixture(p: string): Buffer {
  return fs.readFileSync(p);
}

async function decodePayload(buf: Buffer): Promise<string | null> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const found = jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: 'attemptBoth' });
  return found?.data ?? null;
}

/** Poster-like upload: a small QR pasted onto a large dark canvas. */
async function posterBuffer(qrSize = 300, canvasW = 540, canvasH = 1200, inverted = false): Promise<Buffer> {
  let qr = await sharp(readFixture(FIXTURE_UPI)).resize(qrSize, qrSize).toBuffer();
  if (inverted) qr = await sharp(qr).negate().toBuffer();
  const bg = inverted ? { r: 245, g: 245, b: 245 } : { r: 10, g: 10, b: 10 };
  return sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: bg } })
    .composite([{ input: qr, left: Math.round((canvasW - qrSize) / 2), top: 150 }])
    .png()
    .toBuffer();
}

describe('payment-qr auto-crop + UPI ID', () => {
  test('parseUpiId accepts upi:// payloads and rejects everything else', () => {
    expect(parseUpiId('upi://pay?pa=testworker@okupi&pn=Test Worker')).toBe('testworker@okupi');
    expect(parseUpiId('UPI://pay?pa=a@b')).toBe('a@b');
    expect(parseUpiId('upi://pay?pn=NoAddress')).toBeNull();
    expect(parseUpiId('https://example.com/pay?pa=a@b')).toBeNull();
    expect(parseUpiId('just some text')).toBeNull();
    expect(parseUpiId('')).toBeNull();
  });

  test('tight QR upload stays byte-for-byte but still records the UPI ID', async () => {
    const raw = readFixture(FIXTURE_UPI);
    const out = await processQrImage(raw);
    expect(out.buffer.equals(raw)).toBe(true);
    expect(out.cropped).toBe(false);
    expect(out.resized).toBe(false);
    expect(out.mimeType).toBe('image/png');
    expect(out.upiId).toBe('testworker@okupi');
  });

  test('poster-like upload is cropped to the QR region and stays decodable', async () => {
    const raw = await posterBuffer();
    const out = await processQrImage(raw);
    expect(out.cropped).toBe(true);
    expect(out.resized).toBe(false);
    expect(out.mimeType).toBe('image/png');
    expect(out.extension).toBe('png');
    expect(out.upiId).toBe('testworker@okupi');
    const meta = await sharp(out.buffer).metadata();
    expect((meta.width ?? 0)).toBeLessThan(540);
    expect((meta.height ?? 0)).toBeLessThan(1200);
    await expect(decodePayload(out.buffer)).resolves.toBe('upi://pay?pa=testworker@okupi&pn=Test Worker');
  });

  test('inverted (light-on-dark) poster is detected via the inversion pass', async () => {
    const raw = await posterBuffer(300, 540, 1200, true);
    const detected = await detectQrRegion(raw, 540, 1200);
    expect(detected).not.toBeNull();
    expect(detected?.crop).not.toBeNull();
    expect(detected?.upiId).toBe('testworker@okupi');
    const out = await processQrImage(raw);
    expect(out.cropped).toBe(true);
    expect(out.upiId).toBe('testworker@okupi');
    await expect(decodePayload(out.buffer)).resolves.toBe('upi://pay?pa=testworker@okupi&pn=Test Worker');
  });

  test('non-payment QR crops without a UPI ID', async () => {
    const raw = readFixture(FIXTURE_TEXT);
    const out = await processQrImage(raw);
    expect(out.upiId).toBeNull();
    // The 300px text fixture already fills its frame, so nothing is cut —
    // the point is a decodable non-UPI code never gains a UPI ID.
    await expect(decodePayload(raw)).resolves.toBe('just some text not a payment link');
  });

  test('image with no QR keeps the legacy path (no crop, no UPI ID)', async () => {
    const raw = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
      .png()
      .toBuffer();
    const out = await processQrImage(raw);
    expect(out.buffer.equals(raw)).toBe(true);
    expect(out.cropped).toBe(false);
    expect(out.upiId).toBeNull();
  });

  test('oversized poster is cropped first, then resized under the ceiling', async () => {
    const raw = await posterBuffer(1500, 2000, 2000);
    const out = await processQrImage(raw);
    expect(out.cropped).toBe(true);
    expect(out.resized).toBe(true);
    expect(out.mimeType).toBe('image/png');
    const meta = await sharp(out.buffer).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1200);
    await expect(decodePayload(out.buffer)).resolves.toBe('upi://pay?pa=testworker@okupi&pn=Test Worker');
  });
});
