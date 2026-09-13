import { automationRepository } from '../database/repositories';
import { encryptSecret, decryptSecret, isVaultConfigured } from './automation/crypto';
import { sanitizeRedditCookie, assertRedditCookie } from '../utils/reddit-session-cookie';
import { auditLogService } from './audit.service';
import { AuditAction } from '../types';
import { logger } from '../utils/logger';

export interface RedditSessionStatus {
  /** Vault key present AND a cookie stored. */
  configured: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

class RedditSessionService {
  /**
   * Stores (or replaces) the spare account's login cookie, encrypted.
   * Never logs or returns the value.
   */
  async save(input: { cookie: string; userAgent?: string }, updatedBy: string): Promise<void> {
    if (!isVaultConfigured()) {
      throw new Error('GOPARTTIME_SESSION_KEY is not set — vault disabled. Add it to the server .env and restart.');
    }
    const cookie = sanitizeRedditCookie(input.cookie || '');
    assertRedditCookie(cookie);
    const cookieCipher = encryptSecret(cookie);
    await automationRepository.saveRedditSession({
      cookieCipher,
      userAgent: (input.userAgent || '').trim() || null,
      updatedBy,
    });
    await auditLogService.log(AuditAction.REDDIT_SESSION_UPDATED, null, updatedBy, 'Reddit session cookie updated');
    logger.info('Reddit session cookie updated', { updatedBy });
  }

  /** Decrypted cookie for outbound Reddit fetches. Null when not configured. */
  async loadCookie(): Promise<string | null> {
    if (!isVaultConfigured()) return null;
    const row = await automationRepository.getRedditSession().catch(() => null);
    if (!row || !row.cookieCipher) return null;
    return decryptSecret(row.cookieCipher);
  }

  /** Safe status for UIs — never exposes the secret. */
  async status(): Promise<RedditSessionStatus> {
    if (!isVaultConfigured()) return { configured: false, updatedAt: null, updatedBy: null };
    const row = await automationRepository.getRedditSession().catch(() => null);
    if (!row || !row.cookieCipher) return { configured: false, updatedAt: null, updatedBy: null };
    return { configured: true, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  }
}

export const redditSessionService = new RedditSessionService();
