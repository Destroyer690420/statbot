import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { getRedisConnection } from '../scheduler/queue';
import { logger } from '../utils/logger';

export const WORKER_OTP_TTL_SECONDS = 5 * 60;
export const WORKER_OTP_MAX_ATTEMPTS = 5;
export const WORKER_TOKEN_EXPIRES_IN = '7d';

export interface WorkerTokenPayload {
  scope: 'worker';
  channelId: string;
  channelName: string | null;
  workerId: string | null;
  workerName: string | null;
}

interface OtpRecord {
  hash: string;
  attempts: number;
  createdAt: number;
}

// In-memory fallback when Redis is unavailable (tests, boot ordering).
// Keyed by channelId. Entries expire naturally on read.
const memoryStore = new Map<string, { record: OtpRecord; expiresAt: number }>();
const memoryReqCount = new Map<string, { count: number; expiresAt: number }>();

function otpKey(channelId: string): string {
  return `worker:otp:${channelId}`;
}

function reqCountKey(channelId: string): string {
  return `worker:otp:req:${channelId}`;
}

function getRedisOrNull(): any | null {
  try {
    return getRedisConnection();
  } catch {
    return null;
  }
}

/** Generate a 6-digit numeric code. crypto-backed. */
export function generateOtpCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

/** SHA-256 hash of a code (never store raw codes). */
export function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/** Timing-safe comparison of hashes. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function signWorkerToken(payload: Omit<WorkerTokenPayload, 'scope'>): string {
  return jwt.sign({ ...payload, scope: 'worker' }, env.JWT_SECRET, {
    expiresIn: WORKER_TOKEN_EXPIRES_IN,
  });
}

export function verifyWorkerToken(token: string): WorkerTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as WorkerTokenPayload;
  if (!decoded || decoded.scope !== 'worker' || !decoded.channelId) {
    throw new Error('Invalid worker token.');
  }
  return decoded;
}

async function storeOtp(channelId: string, hash: string): Promise<void> {
  const redis = getRedisOrNull();
  if (redis) {
    try {
      await redis.set(otpKey(channelId), JSON.stringify({ hash, attempts: 0, createdAt: Date.now() }), 'EX', WORKER_OTP_TTL_SECONDS);
      return;
    } catch (error) {
      logger.warn('Worker OTP Redis write failed, using memory fallback', { error });
    }
  }
  memoryStore.set(channelId, {
    record: { hash, attempts: 0, createdAt: Date.now() },
    expiresAt: Date.now() + WORKER_OTP_TTL_SECONDS * 1000,
  });
}

async function readOtp(channelId: string): Promise<OtpRecord | null> {
  const redis = getRedisOrNull();
  if (redis) {
    try {
      const raw = await redis.get(otpKey(channelId));
      if (!raw) return null;
      return JSON.parse(raw) as OtpRecord;
    } catch (error) {
      logger.warn('Worker OTP Redis read failed', { error });
    }
  }
  const entry = memoryStore.get(channelId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(channelId);
    return null;
  }
  return entry.record;
}

async function writeOtp(channelId: string, record: OtpRecord, ttlSeconds: number): Promise<void> {
  const redis = getRedisOrNull();
  if (redis) {
    try {
      const ttl = await redis.ttl(otpKey(channelId));
      const ex = ttl && ttl > 0 ? ttl : ttlSeconds;
      await redis.set(otpKey(channelId), JSON.stringify(record), 'EX', ex);
      return;
    } catch (error) {
      logger.warn('Worker OTP Redis update failed', { error });
    }
  }
  const existing = memoryStore.get(channelId);
  memoryStore.set(channelId, {
    record,
    expiresAt: existing?.expiresAt ?? Date.now() + ttlSeconds * 1000,
  });
}

async function clearOtp(channelId: string): Promise<void> {
  const redis = getRedisOrNull();
  if (redis) {
    try {
      await redis.del(otpKey(channelId));
    } catch {
      // fall through to memory clear
    }
  }
  memoryStore.delete(channelId);
}

/**
 * Per-channel request throttle: max 3 codes per 10 minutes.
 * Returns false when the caller should be rejected.
 */
export async function checkRequestThrottle(channelId: string, max = 3, windowSeconds = 600): Promise<boolean> {
  const redis = getRedisOrNull();
  if (redis) {
    try {
      const key = reqCountKey(channelId);
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds);
      return count <= max;
    } catch (error) {
      logger.warn('Worker OTP throttle Redis failed', { error });
    }
  }
  const now = Date.now();
  const entry = memoryReqCount.get(channelId);
  if (!entry || now > entry.expiresAt) {
    memoryReqCount.set(channelId, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}

export async function issueOtp(channelId: string): Promise<string> {
  const code = generateOtpCode();
  await storeOtp(channelId, hashOtp(code));
  return code;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'expired' | 'mismatch' | 'locked' };

export async function verifyOtp(channelId: string, code: string): Promise<VerifyResult> {
  const record = await readOtp(channelId);
  if (!record) return { ok: false, reason: 'expired' };
  if (record.attempts >= WORKER_OTP_MAX_ATTEMPTS) return { ok: false, reason: 'locked' };

  if (!safeEqual(record.hash, hashOtp(code.trim()))) {
    await writeOtp(channelId, { ...record, attempts: record.attempts + 1 }, WORKER_OTP_TTL_SECONDS);
    const locked = record.attempts + 1 >= WORKER_OTP_MAX_ATTEMPTS;
    return { ok: false, reason: locked ? 'locked' : 'mismatch' };
  }

  await clearOtp(channelId);
  return { ok: true };
}

/** Test helper: reset in-memory fallback stores. */
export function __clearWorkerAuthMemory(): void {
  memoryStore.clear();
  memoryReqCount.clear();
}
