import express from 'express';
import jwt from 'jsonwebtoken';
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

/**
 * Admin QR endpoint + static QR serving over real HTTP.
 * The admin QR route is admin-only (a worker JWT gets 401) and returns
 * nulls — never an error — for a worker with no upload.
 */

const ADMIN = 'admin';
const WORKER = '900000000000000021';
const SERVE_ID = `qrtap-${Date.now()}`;

describe('admin worker QR endpoint + static serving', () => {
  let base: string;
  let server: { close: (cb?: () => void) => void };
  let qrDir: string;
  let adminToken: string;
  const rows: Record<string, any> = {};

  const api = async (p: string, init?: RequestInit, token?: string) => {
    const headers: Record<string, string> = {};
    if (init?.body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${p}`, { ...init, headers });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body, raw: res };
  };

  beforeAll(async () => {
    jest.resetModules();
    process.env.DISCORD_TOKEN = 'x'.repeat(10);
    process.env.CLIENT_ID = 'test-client';
    process.env.GUILD_ID = 'guild-1';
    process.env.ADMIN_USER_IDS = '111';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_SECRET = 'admin-secret-xyz-1234567890abcdef';
    process.env.DASHBOARD_USERNAME = ADMIN;
    process.env.DASHBOARD_PASSWORD = 'pw';

    qrDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-admin-'));
    process.env.PAYMENT_QR_DIR = qrDir;

    mockDb = {
      workerPaymentInfo: {
        findUnique: async (args: any) => rows[args?.where?.workerId] ?? null,
      },
    };

    const createPayoutRoutes = (await import('../api/routes/payouts')).default;
    const uploadRoutes = (await import('../api/routes/uploads')).default;

    const app = express();
    app.use(express.json());
    app.use('/api/v1', uploadRoutes);
    // The QR paths never touch Discord; the client is unused here.
    app.use('/api/v1/payouts', createPayoutRoutes({} as never));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve()) as unknown as { close: (cb?: () => void) => void };
    });
    const addr = (server as unknown as { address: () => { port: number } }).address();
    base = `http://127.0.0.1:${addr.port}/api/v1`;

    const jwtSecret = process.env.JWT_SECRET as string;
    adminToken = jwt.sign({ username: ADMIN }, jwtSecret);
  }, 30000);

  afterAll((done) => {
    delete process.env.PAYMENT_QR_DIR;
    fs.rmSync(qrDir, { recursive: true, force: true });
    // The uploads serve-route test writes one file under the real uploads/
    // tree (UPLOADS_DIR is fixed at import); remove it and the dirs again.
    try {
      fs.unlinkSync(path.resolve('uploads', 'payment-qr', `${SERVE_ID}.png`));
    } catch {
      // ignore
    }
    try {
      fs.rmdirSync(path.resolve('uploads', 'payment-qr'));
    } catch {
      // ignore
    }
    try {
      fs.rmdirSync(path.resolve('uploads'));
    } catch {
      // ignore
    }
    server?.close(() => done());
  });

  test('admin QR endpoint requires auth', async () => {
    const { status } = await api(`/payouts/workers/${WORKER}/qr-code`);
    expect(status).toBe(401);
  });

  test("a worker JWT gets 401 on the admin QR endpoint (it is admin-only)", async () => {
    const workerJwt = jwt.sign({ typ: 'worker', sub: WORKER }, 'worker-secret-xyz-1234567890abcdef');
    const { status } = await api(`/payouts/workers/${WORKER}/qr-code`, undefined, workerJwt);
    expect(status).toBe(401);

    const wrongUser = jwt.sign({ username: 'someone-else' }, process.env.JWT_SECRET as string);
    const second = await api(`/payouts/workers/${WORKER}/qr-code`, undefined, wrongUser);
    expect(second.status).toBe(401);
  });

  test('a worker with no upload reads as nulls, not an error', async () => {
    const { status, body } = await api(`/payouts/workers/${WORKER}/qr-code`, undefined, adminToken);
    expect(status).toBe(200);
    expect(body.data).toEqual({ qrCodeUrl: null, updatedAt: null, upiId: null });
  });

  test('an uploaded QR is returned with a cache-busted URL', async () => {
    const at = new Date('2026-09-01T12:00:00.000Z');
    rows[WORKER] = { workerId: WORKER, filename: `${WORKER}.png`, mimeType: 'image/png', upiId: 'payee@upi', updatedAt: at };
    const buf = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
      .png()
      .toBuffer();
    fs.writeFileSync(path.join(qrDir, `${WORKER}.png`), buf);

    const { status, body } = await api(`/payouts/workers/${WORKER}/qr-code`, undefined, adminToken);
    expect(status).toBe(200);
    expect(body.data).toEqual({
      qrCodeUrl: `/api/v1/uploads/payment-qr/${WORKER}/${WORKER}.png?v=${at.getTime()}`,
      updatedAt: at.toISOString(),
      upiId: 'payee@upi',
    });
  });

  test('a DB row with no file on disk reads as nulls', async () => {
    rows['ghost-worker'] = {
      workerId: 'ghost-worker',
      filename: 'ghost-worker.png',
      mimeType: 'image/png',
      updatedAt: new Date(),
    };
    const { status, body } = await api('/payouts/workers/ghost-worker/qr-code', undefined, adminToken);
    expect(status).toBe(200);
    expect(body.data).toEqual({ qrCodeUrl: null, updatedAt: null, upiId: null });
  });

  test('static QR serving: file bytes, traversal guard, name guard, 404', async () => {
    const buf = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 10, b: 10 } },
    })
      .png()
      .toBuffer();
    const dir = path.resolve('uploads', 'payment-qr');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${SERVE_ID}.png`), buf);

    const good = await fetch(`${base}/uploads/payment-qr/${SERVE_ID}/${SERVE_ID}.png`);
    expect(good.status).toBe(200);
    expect(Buffer.from(await good.arrayBuffer()).equals(buf)).toBe(true);

    const mismatch = await api(`/uploads/payment-qr/${SERVE_ID}/someone-else.png`);
    expect(mismatch.status).toBe(400);

    const badExt = await api(`/uploads/payment-qr/${SERVE_ID}/${SERVE_ID}.gif`);
    expect(badExt.status).toBe(400);

    const traversal = await api(`/uploads/payment-qr/%2E%2E/${SERVE_ID}.png`);
    expect([400, 404]).toContain(traversal.status);

    fs.unlinkSync(path.join(dir, `${SERVE_ID}.png`));
    const gone = await api(`/uploads/payment-qr/${SERVE_ID}/${SERVE_ID}.png`);
    expect(gone.status).toBe(404);
  });
});
