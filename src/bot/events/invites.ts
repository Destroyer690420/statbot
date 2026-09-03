import type { Client, Invite } from 'discord.js';
import { snapshotAllGuilds, trackInviteCreate, trackInviteDelete } from '../../services/invite-tracker.service';
import { logger } from '../../utils/logger';

/** Snapshot all guild invites once the client is ready (restart recovery). */
export async function handleReady(client: Client): Promise<void> {
  try {
    await snapshotAllGuilds(client);
    logger.info('Invite tracker: snapshot complete');
  } catch (error) {
    logger.warn('Invite tracker: snapshot failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function handleInviteCreate(invite: Invite): Promise<void> {
  try {
    // Track the single new code; a full re-snapshot happens on ready and
    // after each join (resolveUsedInvite), so this stays cheap and avoids
    // needing a full Guild object (invite.guild may be a partial InviteGuild).
    trackInviteCreate(invite);
  } catch (error) {
    logger.warn('Invite tracker: inviteCreate handler failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function handleInviteDelete(invite: Invite): Promise<void> {
  try {
    trackInviteDelete(invite);
  } catch (error) {
    logger.warn('Invite tracker: inviteDelete handler failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
