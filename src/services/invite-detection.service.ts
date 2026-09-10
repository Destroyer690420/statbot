import { AuditAction, InviteDetection, InviteDetectionStatus } from '../types';
import { inviteDetectionRepository, referralRepository } from '../database/repositories';
import { toInviteDetection } from '../database/converters';
import { generateInviteDetectionId } from '../utils/id-generator';
import { auditLogService } from './audit.service';
import { logger } from '../utils/logger';

const SPECIAL_INVITER_IDS = [
  '582595416294555649',
  '1202294567706316911',
  '1506900129792135211',
];

function resolveInviterType(inviterId: string | null): 'normal' | 'special' {
  return inviterId && SPECIAL_INVITER_IDS.includes(inviterId) ? 'special' : 'normal';
}

/** Audit actor for automatic approvals (no human involved). */
const AUTO_APPROVE_BY = 'system';

/**
 * Best-effort Discord display-name lookup (REST, no gateway client needed).
 * Returns the global display name (falling back to the username), or null
 * when the token is missing, the user is unknown, or the request fails.
 * Never throws — callers treat null as "keep whatever we have".
 */
async function fetchDiscordDisplayName(userId: string): Promise<string | null> {
  try {
    const token = process.env.DISCORD_TOKEN;
    if (!token) return null;
    const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { username?: string; global_name?: string | null };
    return data.global_name || data.username || null;
  } catch {
    return null;
  }
}

class InviteDetectionService {
  async listPending(limit = 100): Promise<InviteDetection[]> {
    const rows = await inviteDetectionRepository.findPending(limit);
    return rows.map((r: any) => toInviteDetection(r as any));
  }

  async listAll(limit = 100): Promise<InviteDetection[]> {
    const rows = await inviteDetectionRepository.findAll(limit);
    return rows.map((r: any) => toInviteDetection(r as any));
  }

  /**
   * Record a guild join as a staging row. Keep-first policy:
   * - a pending row for this invitee already exists → skip (return it)
   * - a Referral already exists for (invitee, inviter) → skip
   * Joins with an unknown inviter (vanity/OAuth/diff miss) are skipped
   * entirely (logged + audited, no row) — a referral cannot exist without
   * an inviter and there is no manual queue anymore.
   *
   * Auto-approve: when the inviter is known, the row is approved
   * immediately (real referral created, no manual verification). Never
   * throws (join flow is best-effort); an auto-approve failure leaves the
   * row pending for manual approval via the API.
   */
  async recordJoin(data: {
    inviteeId: string;
    inviteeName?: string | null;
    inviterId?: string | null;
    inviterName?: string | null;
    inviteCode?: string | null;
  }): Promise<InviteDetection | null> {
    const existing = await inviteDetectionRepository.findPendingByInviteeId(data.inviteeId);
    if (existing.length > 0) {
      logger.info('Invite detection: pending row already exists, skipping', {
        inviteeId: data.inviteeId,
      });
      return toInviteDetection(existing[0] as any);
    }

    if (data.inviterId) {
      const dup = await referralRepository.findByInviteeAndInviter(data.inviteeId, data.inviterId);
      if (dup) {
        logger.info('Invite detection: referral already exists, skipping', {
          inviteeId: data.inviteeId,
          inviterId: data.inviterId,
        });
        return null;
      }
    } else {
      logger.info('Invite detection: unknown inviter, skipping (no manual queue)', {
        inviteeId: data.inviteeId,
        inviteeName: data.inviteeName ?? null,
        inviteCode: data.inviteCode ?? null,
      });
      await auditLogService.log(
        AuditAction.INVITE_DETECTED,
        null,
        'system',
        `Invite detected — unknown → ${data.inviteeName ?? data.inviteeId}` +
          (data.inviteCode ? ` (code ${data.inviteCode})` : '') +
          ' (skipped: inviter unknown)',
      );
      return null;
    }

    const now = new Date();
    const row: InviteDetection = {
      id: generateInviteDetectionId(),
      inviterId: data.inviterId ?? null,
      inviterName: data.inviterName ?? null,
      inviteeId: data.inviteeId,
      inviteeName: data.inviteeName ?? null,
      inviteCode: data.inviteCode ?? null,
      ticketChannelId: null,
      ticketName: null,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    await inviteDetectionRepository.create({ ...row, status: row.status });
    await auditLogService.log(
      AuditAction.INVITE_DETECTED,
      null,
      data.inviterId ?? 'system',
      `Invite detected — ${row.inviterName ?? row.inviterId ?? 'unknown'} → ${row.inviteeName ?? row.inviteeId}` +
        (row.inviteCode ? ` (code ${row.inviteCode})` : ''),
    );
    logger.info('Invite detection recorded', { id: row.id, ...data });

    try {
      const { detection } = await this.approve(row.id, AUTO_APPROVE_BY);
      logger.info('Invite detection: auto-approved', {
        id: row.id,
        inviteeId: row.inviteeId,
        inviterId: row.inviterId,
      });
      return detection;
    } catch (error) {
      logger.warn('Invite detection: auto-approve failed, row stays pending', {
        id: row.id,
        inviteeId: row.inviteeId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return row;
  }

  /**
   * Link an invitee's FIRST ticket. Called from channelCreate after the
   * ticket creator is resolved. Never overwrites an already-linked ticket.
   * If the row was already approved, the live Referral.ticketId is updated
   * too so commission fallback stays accurate.
   */
  async linkTicket(inviteeId: string, channelId: string, channelName: string): Promise<InviteDetection | null> {
    const unticketed = await inviteDetectionRepository.findPendingUnticketedByInviteeId(inviteeId);
    let linked: InviteDetection | null = null;
    if (unticketed.length > 0) {
      const row = unticketed[0] as any;
      const updated = await inviteDetectionRepository.update(row.id, {
        ticketChannelId: channelId,
        ticketName: channelName,
        updatedAt: new Date(),
      });
      linked = toInviteDetection(updated as any);
      logger.info('Invite detection: ticket linked', {
        id: row.id,
        inviteeId,
        channelId,
        channelName,
      });
    }

    // Ticket created after approval: keep the live referral's ticket in sync
    // (first-ticket-only — only fills empty ticketIds).
    try {
      const refs = await referralRepository.findByInviteeId(inviteeId);
      for (const raw of refs as any[]) {
        if (!raw.ticketId) {
          await referralRepository.update(raw.id, {
            ticketId: `<#${channelId}>`,
            updatedAt: new Date(),
          });
          logger.info('Invite detection: backfilled referral ticket', {
            referralId: raw.id,
            channelId,
          });
          break;
        }
      }
    } catch (error) {
      logger.warn('Invite detection: referral ticket backfill failed', {
        inviteeId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return linked;
  }

  async approve(id: string, approvedBy: string): Promise<{ detection: InviteDetection; referralId: string }> {
    const raw = await inviteDetectionRepository.findById(id);
    if (!raw) throw new Error('Invite detection not found.');
    const detection = toInviteDetection(raw as any);
    if (detection.status !== 'pending') throw new Error(`Invite is already ${detection.status}.`);
    if (!detection.inviterId) throw new Error('Unknown inviter — edit the inviter or reject this row.');

    // Keep-first: an identical referral created manually meanwhile wins.
    const dup = await referralRepository.findByInviteeAndInviter(detection.inviteeId, detection.inviterId);
    if (dup) throw new Error(`A referral already exists for invitee <@${detection.inviteeId}>.`);

    // Lazy require avoids a commission↔invite import cycle at module load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { commissionService } = require('./commission.service');
    // Auto-fill a missing inviter name from Discord so ID-only rows still
    // get a readable referral (failure keeps the ID fallback below).
    const inviterName =
      detection.inviterName ?? (await fetchDiscordDisplayName(detection.inviterId)) ?? detection.inviterId;
    const referral = await commissionService.createReferral(
      {
        inviterId: detection.inviterId,
        inviterName,
        inviteeId: detection.inviteeId,
        inviteeName: detection.inviteeName ?? detection.inviteeId,
        inviterType: resolveInviterType(detection.inviterId),
        ticketId: detection.ticketChannelId
          ? `<#${detection.ticketChannelId}>`
          : detection.ticketName ?? undefined,
      },
      approvedBy,
    );

    const updated = await inviteDetectionRepository.update(id, {
      status: 'approved',
      updatedAt: new Date(),
    });
    await auditLogService.log(
      AuditAction.INVITE_APPROVED,
      null,
      approvedBy,
      `Invite approved — ${detection.inviterName ?? detection.inviterId} → ${detection.inviteeName ?? detection.inviteeId} (referral ${referral.id})`,
    );
    return { detection: toInviteDetection(updated as any), referralId: referral.id };
  }

  async reject(id: string, rejectedBy: string): Promise<InviteDetection> {
    const raw = await inviteDetectionRepository.findById(id);
    if (!raw) throw new Error('Invite detection not found.');
    const detection = toInviteDetection(raw as any);
    if (detection.status !== 'pending') throw new Error(`Invite is already ${detection.status}.`);
    const updated = await inviteDetectionRepository.update(id, {
      status: 'rejected',
      updatedAt: new Date(),
    });
    await auditLogService.log(
      AuditAction.INVITE_REJECTED,
      null,
      rejectedBy,
      `Invite rejected — ${detection.inviteeName ?? detection.inviteeId}`,
    );
    return toInviteDetection(updated as any);
  }

  /**
   * Fix up a pending row before approval — e.g. set the inviter on an
   * unknown-inviter row (vanity/OAuth joins, backfilled rows) or correct a
   * misdetected invite. Only pending rows are editable.
   */
  async updateDetection(
    id: string,
    data: { inviterId?: string | null; inviterName?: string | null; inviteeName?: string | null },
    updatedBy: string,
  ): Promise<InviteDetection> {
    const raw = await inviteDetectionRepository.findById(id);
    if (!raw) throw new Error('Invite detection not found.');
    const detection = toInviteDetection(raw as any);
    if (detection.status !== 'pending') throw new Error(`Invite is already ${detection.status}.`);

    if (data.inviterId !== undefined && data.inviterId !== null && !/^\d{17,20}$/.test(data.inviterId)) {
      throw new Error('Invalid inviter ID.');
    }

    // Auto-fill: ID saved without a name → look the display name up from
    // Discord so the queue (and later the referral) shows a real name.
    let inviterName = data.inviterName;
    const effectiveInviterId = data.inviterId !== undefined ? data.inviterId : detection.inviterId;
    if (effectiveInviterId && inviterName !== undefined && !inviterName) {
      inviterName = (await fetchDiscordDisplayName(effectiveInviterId)) ?? null;
    }

    const updated = await inviteDetectionRepository.update(id, {
      ...(data.inviterId !== undefined ? { inviterId: data.inviterId } : {}),
      ...(inviterName !== undefined ? { inviterName } : {}),
      ...(data.inviteeName !== undefined ? { inviteeName: data.inviteeName } : {}),
      updatedAt: new Date(),
    });
    await auditLogService.log(
      AuditAction.INVITE_DETECTED,
      null,
      updatedBy,
      `Invite detection ${id} updated`,
    );
    return toInviteDetection(updated as any);
  }

  statusOf(s: string): InviteDetectionStatus {
    return (s === 'approved' || s === 'rejected' ? s : 'pending') as InviteDetectionStatus;
  }
}

export const inviteDetectionService = new InviteDetectionService();
