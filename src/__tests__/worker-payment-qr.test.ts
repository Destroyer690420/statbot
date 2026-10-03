import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line prefer-const
let mockDb: any = null;
jest.mock('../database/db', () => ({
  getDb: () => {
    if (!mockDb) throw new Error('mock db not set');
    return mockDb;
  },
  initializeDatabase: jest.fn(),
}));

import { workerPaymentInfoRepository } from '../database/repositories/worker-payment-info.repository';
import { backfillQrCrops, getWorkerQrInfo, saveWorkerQrCode } from '../services/worker-payment-qr.service';
import { QrValidationError } from '../utils/payment-qr';

const WORKER = '100000000000000001';

function makeStore(): { rows: Record<string, any> } {
  const store: { rows: Record<string, any> } = { rows: {} };
  mockDb = {
    workerPaymentInfo: {
      findUnique: async (args: any) => store.rows[args?.where?.workerId] ?? null,
      findMany: async () => Object.values(store.rows),
      upsert: async (args: any) => {
        const existing = store.rows[args.where.workerId];
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const created = { workerId: args.where.workerId, ...args.create };
        store.rows[args.where.workerId] = created;
        return created;
      },
    },
  };
  return store;
}

async function pngDataUrl(): Promise<string> {
  const buf = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function jpegDataUrl(): Promise<string> {
  const buf = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 10, b: 10 } },
  })
    .jpeg()
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

const FIXTURE_UPI = path.join(__dirname, 'fixtures', 'qr-upi.png');

/** Poster-like upload: a small QR pasted onto a large dark canvas. */
async function posterBuffer(): Promise<Buffer> {
  const qr = await sharp(fs.readFileSync(FIXTURE_UPI)).resize(300, 300).toBuffer();
  return sharp({ create: { width: 540, height: 1200, channels: 3, background: { r: 10, g: 10, b: 10 } } })
    .composite([{ input: qr, left: 120, top: 150 }])
    .png()
    .toBuffer();
}

describe('worker payment QR repository + save flow', () => {
  let dir: string;

  beforeEach(() => {
    makeStore();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-svc-'));
    process.env.PAYMENT_QR_DIR = dir;
  });

  afterEach(() => {
    delete process.env.PAYMENT_QR_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('repository upsert overwrites the previous row for the same workerId', async () => {
    expect(await workerPaymentInfoRepository.get(WORKER)).toBeNull();
    await workerPaymentInfoRepository.upsert(WORKER, { filename: `${WORKER}.png`, mimeType: 'image/png', upiId: 'a@upi' });
    await workerPaymentInfoRepository.upsert(WORKER, { filename: `${WORKER}.jpg`, mimeType: 'image/jpeg' });
    const row = await workerPaymentInfoRepository.get(WORKER);
    expect(row?.filename).toBe(`${WORKER}.jpg`);
    expect(row?.mimeType).toBe('image/jpeg');
    // A re-upload without a decodable UPI payload resets the stored ID.
    expect(row?.upiId).toBeNull();
  });

  test('getWorkerQrInfo returns nulls when nothing was uploaded', async () => {
    await expect(getWorkerQrInfo(WORKER)).resolves.toEqual({ qrCodeUrl: null, updatedAt: null, upiId: null });
  });

  test('save stores the file byte-for-byte and returns a cache-busted URL', async () => {
    const image = await pngDataUrl();
    const info = await saveWorkerQrCode(WORKER, image);
    expect(info.qrCodeUrl).toMatch(new RegExp(`/api/v1/uploads/payment-qr/${WORKER}/${WORKER}\\.png\\?v=\\d+`));
    expect(typeof info.updatedAt).toBe('string');

    const onDisk = fs.readFileSync(path.join(dir, `${WORKER}.png`));
    const raw = Buffer.from(image.split(',')[1], 'base64');
    expect(onDisk.equals(raw)).toBe(true);

    // The read path agrees with the write path.
    await expect(getWorkerQrInfo(WORKER)).resolves.toEqual(info);
  });

  test('replacing png with jpg removes the old file from disk', async () => {
    await saveWorkerQrCode(WORKER, await pngDataUrl());
    expect(fs.existsSync(path.join(dir, `${WORKER}.png`))).toBe(true);
    const info = await saveWorkerQrCode(WORKER, await jpegDataUrl());
    expect(info.qrCodeUrl).toContain(`${WORKER}.jpg`);
    expect(fs.existsSync(path.join(dir, `${WORKER}.png`))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${WORKER}.jpg`))).toBe(true);
  });

  test('a DB row with no file on disk reads as nulls, not an error', async () => {
    await saveWorkerQrCode(WORKER, await pngDataUrl());
    fs.unlinkSync(path.join(dir, `${WORKER}.png`));
    await expect(getWorkerQrInfo(WORKER)).resolves.toEqual({ qrCodeUrl: null, updatedAt: null, upiId: null });
  });

  test('invalid uploads throw QrValidationError and write nothing', async () => {
    await expect(saveWorkerQrCode(WORKER, undefined)).rejects.toThrow(QrValidationError);
    await expect(
      saveWorkerQrCode(WORKER, 'data:image/png;base64,' + Buffer.from('not pixels').toString('base64')),
    ).rejects.toThrow(QrValidationError);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(await workerPaymentInfoRepository.get(WORKER)).toBeNull();
  });

  test('uploading a poster stores the cropped QR and records the UPI ID', async () => {
    const poster = await posterBuffer();
    const info = await saveWorkerQrCode(WORKER, `data:image/png;base64,${poster.toString('base64')}`);
    expect(info.upiId).toBe('testworker@okupi');
    expect(info.qrCodeUrl).toContain(`${WORKER}.png`);
    const onDisk = fs.readFileSync(path.join(dir, `${WORKER}.png`));
    expect(onDisk.length).toBeLessThan(poster.length);
    const meta = await sharp(onDisk).metadata();
    expect(meta.width ?? 0).toBeLessThan(540);
    await expect(getWorkerQrInfo(WORKER)).resolves.toEqual(info);
  });
});

describe('backfillQrCrops', () => {
  let dir: string;
  let store: { rows: Record<string, any> };

  beforeEach(() => {
    store = makeStore();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-back-'));
    process.env.PAYMENT_QR_DIR = dir;
  });

  afterEach(() => {
    delete process.env.PAYMENT_QR_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seedRow(workerId: string, filename: string, file: Buffer | null) {
    if (file) fs.writeFileSync(path.join(dir, filename), file);
    store.rows[workerId] = {
      workerId,
      filename,
      mimeType: 'image/png',
      upiId: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
  }

  test('dry run reports, real run recrops in place, rerun is a no-op', async () => {
    const tight = fs.readFileSync(FIXTURE_UPI);
    const poster = await posterBuffer();
    seedRow('w-poster', 'w-poster.png', poster);
    seedRow('w-tight', 'w-tight.png', tight);
    seedRow('w-missing', 'w-missing.png', null);
    seedRow('w-corrupt', 'w-corrupt.png', Buffer.from('not an image'));

    const dry = await backfillQrCrops({ dryRun: true });
    expect(dry).toEqual({ checked: 4, recropped: 1, upiSet: 2, skipped: 1, missing: 1 });
    // Dry run writes nothing.
    expect(fs.readFileSync(path.join(dir, 'w-poster.png')).equals(poster)).toBe(true);
    expect(store.rows['w-poster'].upiId).toBeNull();

    const real = await backfillQrCrops();
    expect(real).toEqual({ checked: 4, recropped: 1, upiSet: 2, skipped: 1, missing: 1 });
    // Same filename — existing qrCodeUrls keep working; ?v= busts caches.
    const after = fs.readFileSync(path.join(dir, 'w-poster.png'));
    expect(after.length).toBeLessThan(poster.length);
    const meta = await sharp(after).metadata();
    expect(meta.width ?? 0).toBeLessThan(540);
    expect(store.rows['w-poster'].upiId).toBe('testworker@okupi');
    // Already-tight file kept its bytes but still gained the UPI ID.
    expect(fs.readFileSync(path.join(dir, 'w-tight.png')).equals(tight)).toBe(true);
    expect(store.rows['w-tight'].upiId).toBe('testworker@okupi');

    const again = await backfillQrCrops();
    expect(again).toEqual({ checked: 4, recropped: 0, upiSet: 0, skipped: 3, missing: 1 });
  });
});
