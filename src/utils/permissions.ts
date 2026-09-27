import { GuildMember } from 'discord.js';
import { env } from '../config/env';

function getAdminIds(): string[] {
  return env.ADMIN_USER_IDS.split(',').map((id) => id.trim()).filter(Boolean);
}

function getManagerIds(): string[] {
  return env.MANAGER_USER_IDS.split(',').map((id) => id.trim()).filter(Boolean);
}

function getModeratorIds(): string[] {
  return env.MODERATOR_USER_IDS.split(',').map((id) => id.trim()).filter(Boolean);
}

export function isAdmin(userId: string): boolean {
  return getAdminIds().includes(userId);
}

export function isManager(userId: string): boolean {
  return getManagerIds().includes(userId);
}

export function isModerator(userId: string): boolean {
  return getModeratorIds().includes(userId);
}

export function isAdminOrManager(userId: string): boolean {
  return isAdmin(userId) || isManager(userId);
}

export function isMemberAdmin(member: GuildMember): boolean {
  return isAdmin(member.id);
}

/**
 * Memoized because it is called per channel member on the blast and worker-
 * detection hot paths: each call used to split/trim/filter three env strings
 * and allocate three arrays. `env` is validated once at boot and is immutable
 * afterwards, so the result cannot go stale in production (tests that change
 * the env do so before a `jest.resetModules()` + fresh import).
 *
 * Frozen and shared: treat the result as read-only. Every caller only
 * iterates, `.includes()`, `.map()`s or wraps it in a Set.
 */
let allAdminIdsCache: readonly string[] | null = null;

export function getAllAdminIds(): readonly string[] {
  if (allAdminIdsCache === null) {
    allAdminIdsCache = Object.freeze([...getAdminIds(), ...getManagerIds(), ...getModeratorIds()]);
  }
  return allAdminIdsCache;
}

let adminOrManagerIdsCache: readonly string[] | null = null;

/** Admins + managers (no moderators) — recipients and approvers of blast DMs. */
export function getAdminOrManagerIds(): readonly string[] {
  if (adminOrManagerIdsCache === null) {
    adminOrManagerIdsCache = Object.freeze([...getAdminIds(), ...getManagerIds()]);
  }
  return adminOrManagerIdsCache;
}

export function getPermissionDeniedMessage(): string {
  return '❌ You do not have permission to use this command.';
}
