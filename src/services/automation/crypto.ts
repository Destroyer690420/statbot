import crypto from 'node:crypto';
import { env } from '../../config/env';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKey(): Buffer | null {
  const hex = (env.GOPARTTIME_SESSION_KEY || '').trim();
  if (!hex) return null;
  try {
    const buf = Buffer.from(hex, 'hex');
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

export function isVaultConfigured(): boolean {
  return getKey() !== null;
}

/** Encrypts a UTF-8 string -> "iv:tag:cipher" hex. Returns null when vault is unconfigured. */
export function encryptSecret(plain: string): string | null {
  const key = getKey();
  if (!key) return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

/** Decrypts "iv:tag:cipher" hex -> UTF-8. Throws on tamper/wrong key. */
export function decryptSecret(payload: string): string {
  const key = getKey();
  if (!key) throw new Error('Session vault is not configured (GOPARTTIME_SESSION_KEY).');
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Malformed vault payload.');
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}
