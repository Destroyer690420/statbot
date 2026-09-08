import { getDb } from '../db';

export class AutomationRepository {
  // ─── Blocked subreddits ───
  async listBlocked() {
    return getDb().blockedSubreddit.findMany({ orderBy: { subreddit: 'asc' } });
  }

  async addBlocked(subreddit: string, reason: string | null, createdBy: string) {
    return getDb().blockedSubreddit.upsert({
      where: { subreddit },
      create: { subreddit, reason, createdBy },
      update: { reason },
    });
  }

  async removeBlocked(subreddit: string) {
    return getDb().blockedSubreddit.delete({ where: { subreddit } }).catch(() => null);
  }

  async isBlocked(subreddit: string): Promise<boolean> {
    const row = await getDb().blockedSubreddit.findUnique({ where: { subreddit } });
    return !!row;
  }

  // ─── Settings (singleton id='automation') ───
  async getSettings() {
    return getDb().automationSettings.findUnique({ where: { id: 'automation' } });
  }

  async saveSettings(data: { enabled: boolean; dryRun: boolean; pollEnabled: boolean; updatedBy: string }) {
    return getDb().automationSettings.upsert({
      where: { id: 'automation' },
      create: { id: 'automation', ...data, updatedAt: new Date() },
      update: { ...data, updatedAt: new Date() },
    });
  }

  // ─── Session (singleton id='default', ciphers at rest) ───
  async getSession() {
    return getDb().goPartTimeSession.findUnique({ where: { id: 'default' } });
  }

  async saveSession(data: {
    sessionCipher: string | null;
    csrfCipher: string | null;
    callbackUrl: string | null;
    nextAction: string | null;
    userAgent: string | null;
    updatedBy: string;
  }) {
    return getDb().goPartTimeSession.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...data, updatedAt: new Date() },
      update: { ...data, updatedAt: new Date() },
    });
  }

  // ─── Cycles ───
  async createCycle(data: { id: string; dryRun: boolean }) {
    return getDb().automationCycle.create({
      data: { id: data.id, dryRun: data.dryRun, status: 'RUNNING', startedAt: new Date() },
    });
  }

  async updateCycle(id: string, data: Partial<{
    status: string; endedAt: Date;
    tasksDetected: number; eligiblePosts: number; blocked: number;
    duplicates: number; commentsSkipped: number;
    workersContacted: number; workersConfirmed: number;
    postsAccepted: number; failures: number;
  }>) {
    return getDb().automationCycle.update({ where: { id }, data });
  }

  async getCycle(id: string) {
    return getDb().automationCycle.findUnique({ where: { id } });
  }

  async listCycles(limit = 20) {
    return getDb().automationCycle.findMany({ orderBy: { startedAt: 'desc' }, take: limit });
  }

  async getRunningCycle() {
    return getDb().automationCycle.findFirst({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'desc' } });
  }

  // ─── Contacts ───
  async createContact(data: {
    cycleId: string; channelId: string; workerId: string | null;
    expiresAt: Date; messageId: string | null;
  }) {
    return getDb().automationContact.create({
      data: { ...data, status: 'CONTACTED', sentAt: new Date() },
    });
  }

  async updateContactStatus(id: string, status: string, respondedAt?: Date) {
    return getDb().automationContact.update({
      where: { id },
      data: { status, ...(respondedAt ? { respondedAt } : {}) },
    });
  }

  async findActiveContact(channelId: string) {
    return getDb().automationContact.findFirst({
      where: { channelId, status: 'CONTACTED', expiresAt: { gt: new Date() } },
      orderBy: { sentAt: 'desc' },
    });
  }

  /** A reply that arrived inside the window: CONFIRMED and not yet expired. */
  async findConfirmedContact(channelId: string) {
    return getDb().automationContact.findFirst({
      where: { channelId, status: 'CONFIRMED', expiresAt: { gt: new Date() } },
      orderBy: { respondedAt: 'desc' },
    });
  }

  /** Latest contact regardless of status — used for precise error messages. */
  async findLatestContactByChannel(channelId: string) {
    return getDb().automationContact.findFirst({
      where: { channelId },
      orderBy: { sentAt: 'desc' },
    });
  }

  async listCycleContacts(cycleId: string) {
    return getDb().automationContact.findMany({ where: { cycleId }, orderBy: { sentAt: 'asc' } });
  }

  async expireDueContacts(now: Date = new Date()) {
    return getDb().automationContact.updateMany({
      where: { status: 'CONTACTED', expiresAt: { lte: now } },
      data: { status: 'TIMED_OUT' },
    });
  }

  // ─── Task logs ───
  async logTask(data: {
    cycleId: string; externalTaskId: string; taskType: string;
    subreddit: string | null; status: string; workerId?: string | null; failureReason?: string | null;
  }) {
    return getDb().automationTaskLog.create({ data: { ...data } });
  }

  async listCycleLogs(cycleId: string) {
    return getDb().automationTaskLog.findMany({ where: { cycleId }, orderBy: { createdAt: 'asc' } });
  }
}

export const automationRepository = new AutomationRepository();
