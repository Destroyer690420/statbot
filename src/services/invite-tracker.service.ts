import type { Client, Collection, Guild, Invite } from 'discord.js';
import { logger } from '../utils/logger';

/**
 * Invite-use tracker.
 *
 * Discord does not tell us the inviter on guildMemberAdd, so we infer it:
 * snapshot invite uses per guild, then on each join diff the fresh fetch
 * against the snapshot and pick the code whose `uses` increased.
 *
 * Limitations (accepted): vanity-URL / OAuth / Discovery joins have no
 * invite code (→ unknown), burst joins can be ambiguous (first increased
 * code wins), and joins during a restart gap resolve to unknown.
 */

// guildId -> (code -> uses)
const inviteCache = new Map<string, Map<string, number>>();

function snapshotFromCollection(invites: Collection<string, Invite>): Map<string, number> {
  const snap = new Map<string, number>();
  for (const [code, invite] of invites) {
    snap.set(code, invite.uses ?? 0);
  }
  return snap;
}

/**
 * Pure diff used by resolveUsedInvite + unit tests.
 * Returns the code whose uses grew the most (must grow by >= 1).
 */
export function findIncreasedInvite(
  before: Map<string, number>,
  after: Map<string, number>,
): string | null {
  let bestCode: string | null = null;
  let bestDelta = 0;
  for (const [code, uses] of after) {
    const prev = before.get(code) ?? 0;
    const delta = uses - prev;
    if (delta > bestDelta) {
      bestDelta = delta;
      bestCode = code;
    }
  }
  return bestCode;
}

export async function snapshotGuildInvites(guild: Pick<Guild, 'id' | 'invites'>): Promise<void> {
  try {
    const invites = await guild.invites.fetch();
    inviteCache.set(guild.id, snapshotFromCollection(invites));
  } catch (error) {
    // Missing Manage Guild permission or API hiccup — joins resolve to unknown.
    logger.warn('Invite tracker: failed to snapshot invites', {
      guildId: guild.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function snapshotAllGuilds(client: Client): Promise<void> {
  for (const [, guild] of client.guilds.cache) {
    await snapshotGuildInvites(guild);
  }
}

export function trackInviteCreate(invite: Invite): void {
  const guildId = invite.guild?.id;
  if (!guildId) return;
  const snap = inviteCache.get(guildId) ?? new Map<string, number>();
  snap.set(invite.code, invite.uses ?? 0);
  inviteCache.set(guildId, snap);
}

export function trackInviteDelete(invite: Invite): void {
  const guildId = invite.guild?.id;
  if (!guildId) return;
  inviteCache.get(guildId)?.delete(invite.code);
}

export interface ResolvedInvite {
  code: string;
  inviterId: string | null;
  inviterName: string | null;
  uses: number | null;
}

/**
 * Diff the live invite list against the snapshot and return the used invite.
 * Refreshes the snapshot as a side effect so the next join diffs cleanly.
 * Returns null when nothing increased (unknown / vanity / restart gap).
 */
export async function resolveUsedInvite(guild: Guild): Promise<ResolvedInvite | null> {
  try {
    const invites = await guild.invites.fetch();
    const before = inviteCache.get(guild.id) ?? new Map<string, number>();
    const after = snapshotFromCollection(invites);
    const code = findIncreasedInvite(before, after);
    inviteCache.set(guild.id, after);
    if (!code) return null;
    const invite = invites.get(code);
    return {
      code,
      inviterId: invite?.inviter?.id ?? null,
      inviterName: invite?.inviter?.username ?? null,
      uses: invite?.uses ?? null,
    };
  } catch (error) {
    logger.warn('Invite tracker: failed to resolve used invite', {
      guildId: guild.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Test-only: reset the in-memory snapshot cache. */
export function __clearInviteCache(): void {
  inviteCache.clear();
}

/** Test-only: seed the snapshot for a guild. */
export function __setInviteSnapshot(guildId: string, snap: Map<string, number>): void {
  inviteCache.set(guildId, snap);
}
