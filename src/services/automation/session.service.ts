import { automationRepository } from '../../database/repositories';
import { encryptSecret, decryptSecret, isVaultConfigured } from './crypto';
import { auditLogService } from '../audit.service';
import { AuditAction } from '../../types';
import { logger } from '../../utils/logger';

export interface SessionInput {
  sessionToken: string;
  csrfToken: string;
  callbackUrl?: string;
  nextAction?: string;
  userAgent?: string;
}

export interface DecryptedSession {
  sessionToken: string;
  csrfToken: string;
  callbackUrl: string | null;
  nextAction: string | null;
  userAgent: string | null;
}

/**
 * Cleans common paste artifacts (a "Cookie:" prefix, surrounding quotes, or a
 * "name=value" pair) down to the raw value. Only strips a name= prefix when
 * the left side looks like one of our cookie names, so legitimate values
 * containing "=" are never mangled.
 */
export function sanitizeCookieValue(raw: string): string {
  let v = raw.trim();
  if (/^cookie:/i.test(v)) v = v.slice(7).trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    v = v.slice(1, -1).trim();
  }
  const eq = v.indexOf('=');
  if (eq > 0 && eq < 60) {
    const left = v.slice(0, eq);
    if (/^[A-Za-z0-9_.-]+$/.test(left) && /session-token|csrf-token|callback-url/i.test(left)) {
      v = v.slice(eq + 1).trim();
    }
  }
  return v;
}

/** Rejects values Chromium would refuse (whitespace, semicolons, controls). */
export function assertCookieValue(v: string, field: string): void {
  if (!v) throw new Error(`${field} is empty after cleanup. Paste only the raw cookie value.`);
  if (/[\s;]/.test(v)) {
    throw new Error(
      `${field} contains a space or semicolon. Paste ONLY the raw value (no "Cookie:" prefix, no attributes).`,
    );
  }
  if (/[\x00-\x1f\x7f]/.test(v)) {
    throw new Error(`${field} contains control characters. Repaste the raw value.`);
  }
}

class SessionService {
  async save(input: SessionInput, updatedBy: string): Promise<void> {
    if (!isVaultConfigured()) {
      throw new Error('GOPARTTIME_SESSION_KEY is not set — vault disabled.');
    }
    const sessionToken = sanitizeCookieValue(input.sessionToken || '');
    const csrfToken = sanitizeCookieValue(input.csrfToken || '');
    assertCookieValue(sessionToken, 'sessionToken');
    assertCookieValue(csrfToken, 'csrfToken');
    const sessionCipher = encryptSecret(sessionToken);
    const csrfCipher = encryptSecret(csrfToken);
    await automationRepository.saveSession({
      sessionCipher,
      csrfCipher,
      callbackUrl: input.callbackUrl || null,
      nextAction: input.nextAction || null,
      userAgent: input.userAgent || null,
      updatedBy,
    });
    await auditLogService.log(AuditAction.AUTOMATION_SESSION_UPDATED, null, updatedBy, 'GoPartTime session cookies updated');
    logger.info('GoPartTime session updated', { updatedBy });
  }

  /**
   * Self-refresh from the live browser context after a successful scan.
   * Only overwrites fields that are present; never audit-logs (would spam
   * one row per scan) and never throws (best-effort). Returns true when
   * anything was stored.
   */
  async refreshFromBrowser(input: {
    sessionToken?: string | null;
    csrfToken?: string | null;
    nextAction?: string | null;
  }): Promise<boolean> {
    if (!isVaultConfigured()) return false;
    const row = await automationRepository.getSession().catch(() => null);
    if (!row) return false; // nothing to refresh until the manager pastes once
    const patch: { sessionCipher?: string | null; csrfCipher?: string | null; nextAction?: string | null } = {};
    if (input.sessionToken) {
      const cipher = encryptSecret(input.sessionToken);
      if (cipher && cipher !== row.sessionCipher) patch.sessionCipher = cipher;
    }
    if (input.csrfToken) {
      const cipher = encryptSecret(input.csrfToken);
      if (cipher && cipher !== row.csrfCipher) patch.csrfCipher = cipher;
    }
    if (input.nextAction && input.nextAction !== row.nextAction) patch.nextAction = input.nextAction;
    if (Object.keys(patch).length === 0) return false;
    await automationRepository.saveSession({
      sessionCipher: patch.sessionCipher ?? row.sessionCipher,
      csrfCipher: patch.csrfCipher ?? row.csrfCipher,
      callbackUrl: row.callbackUrl,
      nextAction: patch.nextAction ?? row.nextAction,
      userAgent: row.userAgent,
      updatedBy: 'poller',
    });
    logger.debug('GoPartTime session self-refreshed from browser');
    return true;
  }

  async load(): Promise<DecryptedSession | null> {
    const row = await automationRepository.getSession();
    if (!row || !row.sessionCipher || !row.csrfCipher) return null;
    return {
      sessionToken: decryptSecret(row.sessionCipher),
      csrfToken: decryptSecret(row.csrfCipher),
      callbackUrl: row.callbackUrl,
      nextAction: row.nextAction,
      userAgent: row.userAgent,
    };
  }

  buildCookieHeader(s: DecryptedSession): string {
    const parts = [
      `__Secure-goparttime.session-token=${s.sessionToken}`,
      `__Host-goparttime.csrf-token=${s.csrfToken}`,
    ];
    if (s.callbackUrl) parts.push(`__Secure-goparttime.callback-url=${s.callbackUrl}`);
    return parts.join('; ');
  }
}

export const sessionService = new SessionService();
