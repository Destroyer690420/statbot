import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { getRedisConnection } from '../scheduler/queue';
import { logger } from '../utils/logger';

/**
 * Ticket-OTP login for the read-only worker portal.
 *
 * Security notes:
 * - Worker JWTs use WORKER_JWT_SECRET (never JWT_SECRET).
 * - OTP codes are never stored raw — only HMAC-SHA256(code, secret).
 * - Redis is required (fail CLOSED with 503). An in-memory fallback exists
 *   ONLY when NODE_ENV=test so unit tests run without infrastructure.
 * - Never log codes, tokens, or secrets (channel IDs only).
 */

export const WORKER_OTP_TTL_SECONDS = 5 * 60;
export const WORKER_OTP_COOLDOWN_SECONDS = 60;
export const WORKER_OTP_MAX_PER_HOUR = 5;
export const WORKER_OTP_MAX_ATTEMPTS = 5;
export const WORKER_VERIFY_FAIL_LIMIT = 10;
export const WORKER_VERIFY_LOCK_SECONDS = 60 * 60;
export const WORKER_TOKEN_EXPIRES_IN = '7d';
export const WORKER_TOKEN_AUDIENCE = 'statbot-worker';
export const WORKER_TOKEN_ISSUER = 'statbot';

export const OTP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface WorkerTokenPayload {
  typ: 'worker';
  sub: string;
  /** Login ticket channel id. Empty string for an inviter-scope token. */
  tid: string;
  /** `ticket` = normal worker login; `inviter` = ticket-less inviter login. */
  scope: 'ticket' | 'inviter';
  name: string | null;
  jti: string;
  aud: string;
  iss: string;
  iat: number;
  exp: number;
}

interface OtpRecord {
  hmac: string;
  attempts: number;
  messageId: string | null;
  createdAt: number;
}

export class WorkerRedisUnavailableError extends Error {
  constructor() {
    super('Store unavailable.');
    this.name = 'WorkerRedisUnavailableError';
  }
}

export function isWorkerPortalEnabled(): boolean {
  return env.WORKER_PORTAL_ENABLED === 'true';
}

export function getWorkerSecret(): string {
  return env.WORKER_JWT_SECRET || '';
}

export function isWorkerPortalAvailable(): boolean {
  return isWorkerPortalEnabled() && getWorkerSecret().length >= 32;
}

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test';
}

// ─── In-memory fallback (test only) ──────────────────────────────────

const memOtp = new Map<string, { record: OtpRecord; expiresAt: number }>();
const memCooldown = new Map<string, number>();
const memCount = new Map<string, { count: number; expiresAt: number }>();
const memFail = new Map<string, { count: number; expiresAt: number }>();
const memLock = new Map<string, number>();
const memDeny = new Map<string, number>();

export function __clearWorkerAuthMemory(): void {
  memOtp.clear();
  memCooldown.clear();
  memCount.clear();
  memFail.clear();
  memLock.clear();
  memDeny.clear();
}

function getRedisOrNull(): any | null {
  try {
    return getRedisConnection();
  } catch {
    return null;
  }
}

function requireRedisOrThrow(): any {
  const redis = getRedisOrNull();
  if (redis) return redis;
  if (isTestEnv()) return null;
  throw new WorkerRedisUnavailableError();
}

// ─── Code helpers (pure) ─────────────────────────────────────────────

export function generateOtpCode(): string {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += OTP_ALPHABET[crypto.randomInt(0, OTP_ALPHABET.length)];
  }
  return out;
}

export function formatOtpCode(code: string): string {
  const n = normalizeOtpCode(code);
  return `${n.slice(0, 4)}-${n.slice(4)}`;
}

export function normalizeOtpCode(code: string): string {
  return String(code || '')
    .toUpperCase()
    .replace(/[\s-]+/g, '');
}

export function hashOtpCode(normalizedCode: string): string {
  return crypto
    .createHmac('sha256', getWorkerSecret())
    .update(normalizedCode, 'utf8')
    .digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ─── Redis keys ──────────────────────────────────────────────────────

function otpKey(channelId: string): string {
  return `worker:otp:${channelId}`;
}
function cooldownKey(channelId: string): string {
  return `worker:otp:cooldown:${channelId}`;
}
function countKey(channelId: string): string {
  return `worker:otp:count:${channelId}`;
}
function failKey(channelId: string): string {
  return `worker:otp:fail:${channelId}`;
}
function lockKey(channelId: string): string {
  return `worker:otp:lock:${channelId}`;
}
function denyKey(jti: string): string {
  return `worker:deny:${jti}`;
}

/**
 * OTP namespace for the ticket-less inviter login. Reuses every ticket guard
 * (TTL, cooldown, hourly cap, attempt lockout) under its own key prefix, so an
 * inviter code can never collide with — or be locked by — a ticket code.
 */
export function inviterOtpKey(userId: string): string {
  return `inviter:${userId}`;
}

// ─── OTP store ───────────────────────────────────────────────────────

export async function readOtpRecord(channelId: string): Promise<{ record: OtpRecord; ttlSeconds: number } | null> {
  const redis = requireRedisOrThrow();
  if (!redis) {
    const entry = memOtp.get(channelId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      memOtp.delete(channelId);
      return null;
    }
    return {
      record: entry.record,
      ttlSeconds: Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000)),
    };
  }
  try {
    const raw: string | null = await redis.get(otpKey(channelId));
    if (!raw) return null;
    const record = JSON.parse(raw) as OtpRecord;
    const ttl: number = await redis.ttl(otpKey(channelId));
    return { record, ttlSeconds: ttl > 0 ? ttl : WORKER_OTP_TTL_SECONDS };
  } catch (error) {
    logger.warn('Worker OTP read failed', { channelId });
    throw new WorkerRedisUnavailableError();
  }
}

async function writeOtpRecord(channelId: string, record: OtpRecord, ttlSeconds: number): Promise<void> {
  const redis = requireRedisOrThrow();
  if (!redis) {
    memOtp.set(channelId, { record, expiresAt: Date.now() + ttlSeconds * 1000 });
    return;
  }
  try {
    await redis.set(otpKey(channelId), JSON.stringify(record), 'EX', ttlSeconds);
  } catch (error) {
    logger.warn('Worker OTP write failed', { channelId });
    throw new WorkerRedisUnavailableError();
  }
}

export async function clearOtpRecord(channelId: string): Promise<void> {
  const redis = requireRedisOrThrow();
  if (!redis) {
    memOtp.delete(channelId);
    return;
  }
  try {
    await redis.del(otpKey(channelId));
  } catch (error) {
    logger.warn('Worker OTP clear failed', { channelId });
    throw new WorkerRedisUnavailableError();
  }
}

export async function getCooldownRemaining(channelId: string): Promise<number> {
  const redis = requireRedisOrThrow();
  if (!redis) {
    const exp = memCooldown.get(channelId);
    if (!exp) return 0;
    if (Date.now() > exp) {
      memCooldown.delete(channelId);
      return 0;
    }
    return Math.ceil((exp - Date.now()) / 1000);
  }
  try {
    const ttl: number = await redis.ttl(cooldownKey(channelId));
    return ttl > 0 ? ttl : 0;
  } catch {
    throw new WorkerRedisUnavailableError();
  }
}

async function setCooldown(channelId: string): Promise<void> {
  const redis = requireRedisOrThrow();
  if (!redis) {
    memCooldown.set(channelId, Date.now() + WORKER_OTP_COOLDOWN_SECONDS * 1000);
    return;
  }
  try {
    await redis.set(cooldownKey(channelId), '1', 'EX', WORKER_OTP_COOLDOWN_SECONDS);
  } catch {
    throw new WorkerRedisUnavailableError();
  }
}

export async function getHourlyCount(channelId: string): Promise<number> {
  const redis = requireRedisOrThrow();
  if (!redis) {
    const e = memCount.get(channelId);
    if (!e) return 0;
    if (Date.now() > e.expiresAt) {
      memCount.delete(channelId);
      return 0;
    }
    return e.count;
  }
  try {
    const raw: string | null = await redis.get(countKey(channelId));
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    throw new WorkerRedisUnavailableError();
  }
}

async function incrHourlyCount(channelId: string): Promise<number> {
  const redis = requireRedisOrThrow();
  if (!redis) {
    const now = Date.now();
    const e = memCount.get(channelId);
    if (!e || now > e.expiresAt) {
      memCount.set(channelId, { count: 1, expiresAt: now + 3600 * 1000 });
      return 1;
    }
    e.count += 1;
    return e.count;
  }
  try {
    const count: number = await redis.incr(countKey(channelId));
    if (count === 1) await redis.expire(countKey(channelId), 3600);
    return count;
  } catch {
    throw new WorkerRedisUnavailableError();
  }
}

export async function isTicketLocked(channelId: string): Promise<boolean> {
  const redis = requireRedisOrThrow();
  if (!redis) {
    const exp = memLock.get(channelId);
    if (!exp) return false;
    if (Date.now() > exp) {
      memLock.delete(channelId);
      return false;
    }
    return true;
  }
  try {
    const v: string | null = await redis.get(lockKey(channelId));
    return v !== null;
  } catch {
    throw new WorkerRedisUnavailableError();
  }
}

async function lockTicket(channelId: string): Promise<void> {
  const redis = requireRedisOrThrow();
  if (!redis) {
    memLock.set(channelId, Date.now() + WORKER_VERIFY_LOCK_SECONDS * 1000);
    return;
  }
  try {
    await redis.set(lockKey(channelId), '1', 'EX', WORKER_VERIFY_LOCK_SECONDS);
  } catch {
    throw new WorkerRedisUnavailableError();
  }
}

export async function getFailCount(channelId: string): Promise<number> {
  const redis = requireRedisOrThrow();
  if (!redis) {
    const e = memFail.get(channelId);
    if (!e) return 0;
    if (Date.now() > e.expiresAt) {
      memFail.delete(channelId);
      return 0;
    }
    return e.count;
  }
  try {
    const raw: string | null = await redis.get(failKey(channelId));
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    throw new WorkerRedisUnavailableError();
  }
}

async function incrFailCount(channelId: string): Promise<number> {
  const redis = requireRedisOrThrow();
  if (!redis) {
    const now = Date.now();
    const e = memFail.get(channelId);
    if (!e || now > e.expiresAt) {
      memFail.set(channelId, { count: 1, expiresAt: now + 3600 * 1000 });
      return 1;
    }
    e.count += 1;
    return e.count;
  }
  try {
    const count: number = await redis.incr(failKey(channelId));
    if (count === 1) await redis.expire(failKey(channelId), 3600);
    return count;
  } catch {
    throw new WorkerRedisUnavailableError();
  }
}

async function clearFailCount(channelId: string): Promise<void> {
  const redis = requireRedisOrThrow();
  if (!redis) {
    memFail.delete(channelId);
    return;
  }
  try {
    await redis.del(failKey(channelId));
  } catch {
    throw new WorkerRedisUnavailableError();
  }
}

// ─── Issue / verify ──────────────────────────────────────────────────

export type IssueResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'active'; remainingSeconds: number }
  | { ok: false; reason: 'cooldown'; remainingSeconds: number }
  | { ok: false; reason: 'hourly_cap' }
  | { ok: false; reason: 'locked' };

/**
 * Decide whether a new code may be issued. Does NOT send anything.
 * The caller sends the Discord message, then calls storeIssuedCode().
 */
export async function planIssueCode(channelId: string): Promise<IssueResult> {
  if (await isTicketLocked(channelId)) return { ok: false, reason: 'locked' };
  const existing = await readOtpRecord(channelId);
  if (existing) {
    return { ok: false, reason: 'active', remainingSeconds: existing.ttlSeconds };
  }
  const cooldown = await getCooldownRemaining(channelId);
  if (cooldown > 0) return { ok: false, reason: 'cooldown', remainingSeconds: cooldown };
  const count = await getHourlyCount(channelId);
  if (count >= WORKER_OTP_MAX_PER_HOUR) return { ok: false, reason: 'hourly_cap' };
  return { ok: true, code: generateOtpCode() };
}

/** Persist a code AFTER it was delivered to Discord. Stores only the HMAC. */
export async function storeIssuedCode(
  channelId: string,
  code: string,
  messageId: string | null,
): Promise<void> {
  const normalized = normalizeOtpCode(code);
  await writeOtpRecord(
    channelId,
    { hmac: hashOtpCode(normalized), attempts: 0, messageId, createdAt: Date.now() },
    WORKER_OTP_TTL_SECONDS,
  );
  await setCooldown(channelId);
  await incrHourlyCount(channelId);
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'mismatch'; attemptsLeft: number }
  | { ok: false; reason: 'invalidated' }
  | { ok: false; reason: 'locked' };

export async function verifyOtpCode(channelId: string, code: string): Promise<VerifyResult> {
  if (await isTicketLocked(channelId)) return { ok: false, reason: 'locked' };
  const found = await readOtpRecord(channelId);
  if (!found) {
    const fails = await incrFailCount(channelId);
    if (fails > WORKER_VERIFY_FAIL_LIMIT) {
      await lockTicket(channelId);
      return { ok: false, reason: 'locked' };
    }
    return { ok: false, reason: 'missing' };
  }
  const normalized = normalizeOtpCode(code);
  const candidate = hashOtpCode(normalized);
  if (!safeEqualHex(found.record.hmac, candidate)) {
    const attempts = found.record.attempts + 1;
    const fails = await incrFailCount(channelId);
    if (fails > WORKER_VERIFY_FAIL_LIMIT) {
      await clearOtpRecord(channelId);
      await lockTicket(channelId);
      return { ok: false, reason: 'locked' };
    }
    if (attempts >= WORKER_OTP_MAX_ATTEMPTS) {
      await clearOtpRecord(channelId);
      return { ok: false, reason: 'invalidated' };
    }
    await writeOtpRecord(channelId, { ...found.record, attempts }, found.ttlSeconds);
    return { ok: false, reason: 'mismatch', attemptsLeft: WORKER_OTP_MAX_ATTEMPTS - attempts };
  }
  await clearOtpRecord(channelId);
  await clearFailCount(channelId);
  return { ok: true };
}

// ─── Worker JWT ──────────────────────────────────────────────────────

export function signWorkerToken(args: {
  workerId: string;
  channelId: string;
  name: string | null;
  scope?: 'ticket' | 'inviter';
}): string {
  const secret = getWorkerSecret();
  if (!secret || secret.length < 32) throw new Error('Worker portal is not configured.');
  return jwt.sign(
    {
      typ: 'worker',
      sub: args.workerId,
      tid: args.channelId,
      scope: args.scope ?? 'ticket',
      name: args.name,
      jti: crypto.randomUUID(),
    },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: WORKER_TOKEN_EXPIRES_IN,
      audience: WORKER_TOKEN_AUDIENCE,
      issuer: WORKER_TOKEN_ISSUER,
    },
  );
}

export function verifyWorkerToken(token: string): WorkerTokenPayload {
  const secret = getWorkerSecret();
  if (!secret || secret.length < 32) throw new Error('Worker portal is not configured.');
  const decoded = jwt.verify(token, secret, {
    algorithms: ['HS256'],
    audience: WORKER_TOKEN_AUDIENCE,
    issuer: WORKER_TOKEN_ISSUER,
  }) as Record<string, unknown>;
  if (decoded.typ !== 'worker' || typeof decoded.sub !== 'string' || !decoded.sub) {
    throw new Error('Invalid worker token.');
  }
  // Tokens issued before the inviter login carry no `scope` claim: treat them
  // as ticket tokens so already-issued 7-day tokens keep working.
  const scope: 'ticket' | 'inviter' = decoded.scope === 'inviter' ? 'inviter' : 'ticket';
  // Only ticket tokens must carry a channel; an inviter has no ticket at all.
  if (scope === 'ticket' && (typeof decoded.tid !== 'string' || !decoded.tid)) {
    throw new Error('Invalid worker token.');
  }
  if (decoded.tid !== undefined && typeof decoded.tid !== 'string') {
    throw new Error('Invalid worker token.');
  }
  if (typeof decoded.jti !== 'string' || !decoded.jti) throw new Error('Invalid worker token.');
  return { ...(decoded as unknown as WorkerTokenPayload), scope };
}

export async function denylistWorkerToken(jti: string, expiresAtMs: number): Promise<void> {
  const ttl = Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000));
  const redis = requireRedisOrThrow();
  if (!redis) {
    memDeny.set(jti, Date.now() + ttl * 1000);
    return;
  }
  try {
    await redis.set(denyKey(jti), '1', 'EX', ttl);
  } catch {
    throw new WorkerRedisUnavailableError();
  }
}

/** Best-effort: false when Redis is down (Redis is a hard app dep; logout still clears client-side). */
export async function isTokenDenylisted(jti: string): Promise<boolean> {
  const redis = getRedisOrNull();
  if (!redis) {
    if (isTestEnv()) {
      const exp = memDeny.get(jti);
      if (!exp) return false;
      if (Date.now() > exp) {
        memDeny.delete(jti);
        return false;
      }
      return true;
    }
    return false;
  }
  try {
    const v: string | null = await redis.get(denyKey(jti));
    return v !== null;
  } catch {
    return false;
  }
}

// ─── Discord delivery ────────────────────────────────────────────────

export function buildOtpMessage(workerId: string, code: string): string {
  const grouped = formatOtpCode(code);
  return (
    `<@${workerId}> \u{1F510} Your Worker Panel login code is **${grouped}**. ` +
    `It expires in 5 minutes. Never share it \u2014 staff will never ask for it. ` +
    `If you didn't request this, ignore it.`
  );
}

/**
 * Inviter-login DM. Sent privately (never in a channel) because an inviter has
 * no ticket to post in, and a DM is also stronger proof of account ownership
 * than a channel anyone can read.
 */
export function buildInviterLoginMessage(code: string): string {
  return (
    `\u{1F510} Your Worker Panel login code is **${formatOtpCode(code)}**. ` +
    `It expires in 5 minutes. Never share it \u2014 staff will never ask for it. ` +
    `Open the Worker Panel, choose "I only invite", and enter this code. ` +
    `If you didn't request this, ignore it.`
  );
}

interface SendableChannel {
  id?: string;
  send(args: { content: string; allowedMentions: { users: string[] } }): Promise<{ id: string }>;
}

export async function sendOtpToChannel(
  channel: SendableChannel,
  workerId: string,
  code: string,
): Promise<string> {
  const sent = await channel.send({
    content: buildOtpMessage(workerId, code),
    allowedMentions: { users: [workerId] },
  });
  return sent.id;
}

export async function deleteChannelMessageBestEffort(
  discordClient: { channels?: { fetch?: (id: string) => Promise<any> } },
  channelId: string,
  messageId: string | null,
): Promise<void> {
  if (!messageId) return;
  try {
    const fetch = discordClient?.channels?.fetch;
    if (typeof fetch !== 'function') return;
    const channel: any = await fetch.call(discordClient.channels, channelId).catch(() => null);
    if (!channel) return;
    const msg: any = await channel.messages?.fetch?.(messageId).catch(() => null);
    if (msg && typeof msg.delete === 'function') {
      await msg.delete().catch(() => undefined);
    }
  } catch {
    // best-effort only
  }
}

/** Best-effort expiry cleanup: delete the bot's code message after the TTL. */
export function scheduleOtpExpiryCleanup(
  discordClient: { channels?: { fetch?: (id: string) => Promise<any> } },
  channelId: string,
  messageId: string | null,
  ttlMs: number = WORKER_OTP_TTL_SECONDS * 1000,
): void {
  if (!messageId) return;
  try {
    const t = setTimeout(() => {
      void deleteChannelMessageBestEffort(discordClient, channelId, messageId).catch(() => undefined);
    }, ttlMs);
    (t as unknown as { unref?: () => void }).unref?.();
  } catch {
    // ignore
  }
}
