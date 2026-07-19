import { GuildMember } from 'discord.js';
import { env } from '../config/env';

function getAdminIds(): string[] {
  return env.ADMIN_USER_IDS.split(',').map((id) => id.trim()).filter(Boolean);
}

function getManagerIds(): string[] {
  return env.MANAGER_USER_IDS.split(',').map((id) => id.trim()).filter(Boolean);
}

export function isAdmin(userId: string): boolean {
  return getAdminIds().includes(userId);
}

export function isManager(userId: string): boolean {
  return getManagerIds().includes(userId);
}

export function isAdminOrManager(userId: string): boolean {
  return isAdmin(userId) || isManager(userId);
}

export function isMemberAdmin(member: GuildMember): boolean {
  return isAdmin(member.id);
}

export function getAllAdminIds(): string[] {
  return [...getAdminIds(), ...getManagerIds()];
}

export function getPermissionDeniedMessage(): string {
  return '❌ You do not have permission to use this command.';
}
