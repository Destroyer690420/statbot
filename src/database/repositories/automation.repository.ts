import { getDb } from '../db';
import { AUTOMATION } from '../../config/constants';
import { pickLeaseCandidate } from '../../services/automation/claim-lease';

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

  // ─── Reddit session (singleton id='default', cookie cipher at rest) ───
  async getRedditSession() {
    return getDb().redditSession.findUnique({ where: { id: 'default' } });
  }

  async saveRedditSession(data: {
    cookieCipher: string | null;
    userAgent: string | null;
    updatedBy: string;
  }) {
    return getDb().redditSession.upsert({
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

  // ─── Sightings (companion-reported task list) ───
  async upsertSighting(data: {
    externalTaskId: string; taskType: string; subreddit: string | null;
    title: string | null; companionId: string | null;
  }) {
    const now = new Date();
    return getDb().automationSighting.upsert({
      where: { externalTaskId: data.externalTaskId },
      create: { ...data, status: 'NEW', firstSeenAt: now, lastSeenAt: now },
      update: {
        taskType: data.taskType,
        subreddit: data.subreddit,
        title: data.title,
        companionId: data.companionId,
        lastSeenAt: now,
      },
    });
  }

  async listNewSightings(since: Date) {
    return getDb().automationSighting.findMany({
      where: { status: 'NEW', lastSeenAt: { gte: since } },
      orderBy: { firstSeenAt: 'asc' },
    });
  }

  async markSightings(ids: string[], status: string) {
    if (ids.length === 0) return { count: 0 };
    return getDb().automationSighting.updateMany({ where: { id: { in: ids } }, data: { status } });
  }

  // ─── Claims (server asks companion to accept in-page) ───
  async createClaim(data: {
    cycleId: string; externalTaskId: string; channelId: string;
    workerId: string | null; expiresAt: Date;
  }) {
    return getDb().automationClaim.create({ data: { ...data, status: 'PENDING' } });
  }

  async findClaim(id: string) {
    return getDb().automationClaim.findUnique({ where: { id } });
  }

  /**
   * Oldest actionable claim for legacy watchers (no tab id). Freshly leased
   * rows are invisible here so a legacy tab never double-processes a claim
   * a leased tab already holds. Status stays PENDING until the verdict.
   */
  async pendingClaim(leaseTimeoutMs: number = AUTOMATION.CLAIM_LEASE_TIMEOUT_MS) {
    const now = new Date();
    return getDb().automationClaim.findFirst({
      where: {
        status: 'PENDING',
        expiresAt: { gt: now },
        OR: [{ leasedBy: null }, { leasedAt: { lt: new Date(now.getTime() - leaseTimeoutMs) } }],
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Phase-2 parallel tabs: atomically lease the oldest actionable claim to
   * one tab. Two tabs can never hold the same claim: the UPDATE guard
   * re-checks PENDING + leasable, so exactly one tab wins the race and the
   * loser gets null (it retries on the next fast poll). Returns the leased
   * row, or null when there is nothing to take right now.
   */
  async leaseNextClaim(tabId: string, leaseTimeoutMs: number = AUTOMATION.CLAIM_LEASE_TIMEOUT_MS) {
    const now = new Date();
    const candidates = await getDb().automationClaim.findMany({
      where: { status: 'PENDING', expiresAt: { gt: now } },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    const pick = pickLeaseCandidate(candidates, now.getTime(), leaseTimeoutMs);
    if (!pick) return null;
    const leasedAt = new Date();
    const claimed = await getDb().automationClaim.updateMany({
      where: {
        id: pick.id,
        status: 'PENDING',
        OR: [
          { leasedBy: null },
          { leasedBy: tabId },
          { leasedAt: { lt: new Date(leasedAt.getTime() - leaseTimeoutMs) } },
        ],
      },
      data: { leasedBy: tabId, leasedAt },
    });
    if (claimed.count !== 1) return null;
    return getDb().automationClaim.findUnique({ where: { id: pick.id } });
  }

  async listPendingClaims() {
    return getDb().automationClaim.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** All claims of a cycle — used to compute burst tasks already held. */
  async listCycleClaims(cycleId: string) {
    return getDb().automationClaim.findMany({
      where: { cycleId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async resolveClaim(id: string, status: 'CLAIMED' | 'FAILED' | 'EXPIRED', failureReason?: string | null) {
    return getDb().automationClaim.update({
      where: { id },
      data: { status, respondedAt: new Date(), failureReason: failureReason || null },
    });
  }

  async expireDueClaims(now: Date = new Date()) {
    return getDb().automationClaim.updateMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      data: { status: 'EXPIRED', respondedAt: now },
    });
  }

  // ─── Bursts (eligible scan -> auto-blast -> reply-to-claim) ───
  async createBurst(data: { blastId: string; cycleId: string; taskIds: string[]; taskDetails?: string | null }) {
    return getDb().automationBurst.create({
      data: {
        blastId: data.blastId,
        cycleId: data.cycleId,
        taskIds: data.taskIds,
        taskDetails: data.taskDetails ?? null,
        status: 'OPEN',
      },
    });
  }

  async getBurstByBlast(blastId: string) {
    return getDb().automationBurst.findUnique({ where: { blastId } });
  }

  async closeBurst(id: string) {
    return getDb().automationBurst.update({ where: { id }, data: { status: 'CLOSED' } });
  }

  /** Appends task ids to a burst pool (grace-window streaming completions). */
  async appendBurstTasks(id: string, taskIds: string[]) {
    if (taskIds.length === 0) return null;
    return getDb().automationBurst.update({
      where: { id },
      data: { taskIds: { push: taskIds } },
    });
  }

  /** Replaces the pooled task details JSON (append-merged by the caller). */
  async setBurstDetails(id: string, taskDetails: string) {
    return getDb().automationBurst.update({
      where: { id },
      data: { taskDetails },
    });
  }

  /** Bursts of one cycle, newest first (normally exactly one). */
  async listBurstsByCycle(cycleId: string) {
    return getDb().automationBurst.findMany({
      where: { cycleId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Still-open bursts — a new scan merges their unheld tasks instead of orphaning them. */
  async listOpenBursts() {
    return getDb().automationBurst.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Bursts created since an instant — the one-blast-per-hour guard. */
  async listBurstsSince(since: Date) {
    return getDb().automationBurst.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─── Companion heartbeat ───
  async heartbeat(companionId: string | null, version: string | null) {
    void companionId;
    return getDb().companionStatus.upsert({
      where: { id: 'companion' },
      create: { id: 'companion', lastSeenAt: new Date(), version },
      update: { lastSeenAt: new Date(), version },
    });
  }

  async companionStatus() {
    return getDb().companionStatus.findUnique({ where: { id: 'companion' } });
  }
}

export const automationRepository = new AutomationRepository();
