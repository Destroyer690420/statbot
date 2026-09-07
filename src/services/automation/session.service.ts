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

class SessionService {
  async save(input: SessionInput, updatedBy: string): Promise<void> {
    if (!isVaultConfigured()) {
      throw new Error('GOPARTTIME_SESSION_KEY is not set — vault disabled.');
    }
    if (!input.sessionToken.trim() || !input.csrfToken.trim()) {
      throw new Error('sessionToken and csrfToken are required.');
    }
    const sessionCipher = encryptSecret(input.sessionToken.trim());
    const csrfCipher = encryptSecret(input.csrfToken.trim());
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
