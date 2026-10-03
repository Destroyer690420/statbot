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
import { getWorkerQrInfo, saveWorkerQrCode } from '../services/worker-payment-qr.service';
import { QrValidationError } from '../utils/payment-qr';

const WORKER = '100000000000000001';

function makeStore(): { rows: Record<string, any> } {
  const store: { rows: Record<string, any> } = { rows: {} };
  mockDb = {
    workerPaymentInfo: {
      findUnique: async (args: any) => store.rows[args?.where?.workerId] ?? null,
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
    await workerPaymentInfoRepository.upsert(WORKER, { filename: `${WORKER}.png`, mimeType: 'image/png' });
    await workerPaymentInfoRepository.upsert(WORKER, { filename: `${WORKER}.jpg`, mimeType: 'image/jpeg' });
    const row = await workerPaymentInfoRepository.get(WORKER);
    expect(row?.filename).toBe(`${WORKER}.jpg`);
    expect(row?.mimeType).toBe('image/jpeg');
  });

  test('getWorkerQrInfo returns nulls when nothing was uploaded', async () => {
    await expect(getWorkerQrInfo(WORKER)).resolves.toEqual({ qrCodeUrl: null, updatedAt: null });
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
    await expect(getWorkerQrInfo(WORKER)).resolves.toEqual({ qrCodeUrl: null, updatedAt: null });
  });

  test('invalid uploads throw QrValidationError and write nothing', async () => {
    await expect(saveWorkerQrCode(WORKER, undefined)).rejects.toThrow(QrValidationError);
    await expect(
      saveWorkerQrCode(WORKER, 'data:image/png;base64,' + Buffer.from('not pixels').toString('base64')),
    ).rejects.toThrow(QrValidationError);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(await workerPaymentInfoRepository.get(WORKER)).toBeNull();
  });
});
