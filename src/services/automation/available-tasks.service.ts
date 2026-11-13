import { automationRepository, outreachRepository, taskRepository } from '../../database/repositories';
import { normalizeSubreddit } from './subreddit';
import { evaluateForBurst, loadAllowedSubs, loadSeenSubs } from './validator.service';
import { AUTOMATION, GOPARTTIME_SOURCE } from '../../config/constants';
import { getIstDayBoundaries } from '../../utils/ist-time';
import { logger } from '../../utils/logger';

/**
 * Decodes unicode escapes (\u0026, \u003c, etc.) and basic HTML entities
 * often present in GoPartTime Next.js flight data.
 */
export function cleanTitle(raw?: string | null): string | null {
  if (!raw) return null;
  let str = String(raw).trim();
  str = str.replace(/\\u([0-9a-fA-F]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  str = str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return str.trim() || null;
}

export interface LiveTaskInput {
  subTaskId: string | number;
  type: string;
  subreddit?: string | null;
  title?: string | null;
  content?: string | null;
  contentHtml?: string | null;
}

export interface AvailableTask {
  subTaskId: string;
  type: 'post';
  subreddit: string;
  title: string | null;
  content: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface WorkerClaimStatus {
  canClaim: boolean;
  reason: string | null;
  dailyLimit: number;
  completedToday: number;
  hasActiveTask: boolean;
}

export class AvailableTasksService {
  private tasks = new Map<string, AvailableTask>();
  private inFlightClaims = new Set<string>();

  /**
   * Updates the live pool of available tasks from a GoPartTime scan snapshot.
   * Tasks not present in the snapshot are removed immediately.
   */
  async setLiveTasks(inputs: LiveTaskInput[]): Promise<{ count: number; added: number; removed: number }> {
    const now = new Date();
    const blockedList = await automationRepository.listBlocked().catch(() => []);
    const blockedSubs = new Set(blockedList.map((b) => b.subreddit));
    const seenSubs = await loadSeenSubs().catch(() => new Set<string>());
    const allowedSubs = await loadAllowedSubs().catch(() => new Set<string>());

    const incomingIds = new Set<string>();
    let added = 0;

    for (const input of inputs) {
      if (input.type !== 'post') continue;

      const subTaskId = String(input.subTaskId || '').trim();
      if (!subTaskId) continue;
      incomingIds.add(subTaskId);

      // If already claiming or held by a pending claim, skip
      if (this.inFlightClaims.has(subTaskId)) continue;

      // If already in available list, update lastSeenAt and enrich content/title if present
      const existing = this.tasks.get(subTaskId);
      if (existing) {
        existing.lastSeenAt = now;
        if (!existing.content && (input.content || input.contentHtml)) {
          let clean = (input.content || '').trim();
          if (!clean && input.contentHtml) {
            clean = input.contentHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim();
          }
          if (clean) existing.content = clean;
        }
        if (existing.title && (existing.title.includes('\\u') || existing.title.includes('&amp;'))) {
          existing.title = cleanTitle(existing.title);
        }
        continue;
      }

      // Check duplicate in Task table
      const duplicate = await taskRepository.findBySourceExternal(GOPARTTIME_SOURCE, subTaskId).catch(() => null);
      if (duplicate) continue;

      // Validate eligibility (Post only, readable sub, blocklist, Costway keyword)
      const detected = {
        subTaskId,
        taskId: subTaskId,
        type: input.type as 'post' | 'comment',
        subreddit: input.subreddit || null,
        title: input.title || null,
        postLink: null,
        contentHtml: input.contentHtml || '',
        images: [],
        payment: null,
        deadline: null,
        karmaLimit: null,
        earnings: null,
      };

      const v = evaluateForBurst(detected, blockedSubs, seenSubs, undefined, allowedSubs);
      if (!v.eligible) continue;

      const normSub = normalizeSubreddit(input.subreddit);
      if (!normSub) continue;

      // Clean preview text (strip html if provided)
      let cleanContent = (input.content || '').trim();
      if (!cleanContent && input.contentHtml) {
        cleanContent = input.contentHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim();
      }

      this.tasks.set(subTaskId, {
        subTaskId,
        type: 'post',
        subreddit: normSub,
        title: cleanTitle(input.title),
        content: cleanContent || null,
        firstSeenAt: now,
        lastSeenAt: now,
      });
      added++;
    }

    // Auto-removal: Remove any tasks no longer in the GoPartTime scan snapshot
    let removed = 0;
    for (const [id] of this.tasks) {
      if (!incomingIds.has(id) && !this.inFlightClaims.has(id)) {
        this.tasks.delete(id);
        removed++;
      }
    }

    return { count: this.tasks.size, added, removed };
  }

  /**
   * Enriches an existing available task with full post content (and unescaped title if available)
   * extracted by the companion peeker without claiming.
   */
  updateTaskContent(subTaskId: string, content: string, title?: string | null): boolean {
    const id = String(subTaskId || '').trim();
    if (!id) return false;
    const task = this.tasks.get(id);
    if (!task) return false;

    const cleanedContent = (content || '').trim();
    if (cleanedContent) {
      task.content = cleanedContent;
    }
    if (title) {
      const cleanedT = cleanTitle(title);
      if (cleanedT) task.title = cleanedT;
    } else if (task.title) {
      task.title = cleanTitle(task.title);
    }
    return true;
  }

  /**
   * Instantly purges all available tasks for a subreddit (called when a sub is blocked).
   */
  removeSubreddit(subreddit: string): number {
    const norm = normalizeSubreddit(subreddit);
    if (!norm) return 0;
    let count = 0;
    for (const [id, task] of this.tasks) {
      if (task.subreddit === norm) {
        this.tasks.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Returns all currently available eligible tasks (sanitized, no earnings/deadline).
   */
  getAvailableTasks(): AvailableTask[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime(),
    );
  }

  getSubreddit(subTaskId: string): string | null {
    return this.tasks.get(subTaskId)?.subreddit ?? null;
  }

  /**
   * Checks whether a worker is eligible to claim a post.
   */
  async checkWorkerEligibility(workerId: string, channelId: string): Promise<WorkerClaimStatus> {
    if (!channelId) {
      return {
        canClaim: false,
        reason: 'A ticket channel is required to claim posts.',
        dailyLimit: 0,
        completedToday: 0,
        hasActiveTask: false,
      };
    }

    // 1. Check if ticket is in daily outreach and selected
    const ticketOutreach = await outreachRepository.findByChannelId(channelId).catch(() => null);
    if (!ticketOutreach || !ticketOutreach.selected) {
      return {
        canClaim: false,
        reason: 'Your ticket is not enrolled in the daily outreach list.',
        dailyLimit: 0,
        completedToday: 0,
        hasActiveTask: false,
      };
    }
    const dailyLimit = ticketOutreach.dailyPostLimit ?? 2;

    // 2. Count tasks created today in IST for this worker
    const { dayStart, dayEnd } = getIstDayBoundaries();
    const countsMap = await taskRepository.countGoPartTimePostsByWorkerInRange([workerId], dayStart, dayEnd).catch(() => new Map<string, number>());
    const completedToday = countsMap.get(workerId) ?? 0;

    if (completedToday >= dailyLimit) {
      return {
        canClaim: false,
        reason: `Daily limit reached (${completedToday}/${dailyLimit} posts completed today).`,
        dailyLimit,
        completedToday,
        hasActiveTask: false,
      };
    }

    // 3. Check for active in-flight task awaiting submission in this ticket
    const awaiting = await taskRepository.findAwaitingSubmissionInChannel(channelId).catch(() => null);
    if (awaiting) {
      return {
        canClaim: false,
        reason: 'You already have an active post awaiting submission in your ticket. Please submit the link first.',
        dailyLimit,
        completedToday,
        hasActiveTask: true,
      };
    }

    return {
      canClaim: true,
      reason: null,
      dailyLimit,
      completedToday,
      hasActiveTask: false,
    };
  }

  /**
   * Atomically claims a task for a worker.
   */
  async claimTask(
    subTaskId: string,
    workerId: string,
    channelId: string,
  ): Promise<{ ok: boolean; claimId?: string; error?: string }> {
    const id = String(subTaskId || '').trim();
    if (!id) {
      return { ok: false, error: 'Post not available' };
    }

    // 1. Worker eligibility check
    const status = await this.checkWorkerEligibility(workerId, channelId);
    if (!status.canClaim) {
      return { ok: false, error: status.reason || 'You are not eligible to claim this post.' };
    }

    // 2. Mutex check
    if (this.inFlightClaims.has(id)) {
      return { ok: false, error: 'Someone else just claimed this post! Please select another one.' };
    }

    // 3. Availability check
    const task = this.tasks.get(id);
    if (!task) {
      return { ok: false, error: 'Post not available' };
    }

    // Acquire claim lock and reserve
    this.inFlightClaims.add(id);
    this.tasks.delete(id);

    try {
      // Create pending claim for the manager's companion watcher to accept on GoPartTime
      const claim = await automationRepository.createClaim({
        cycleId: 'web-claim',
        externalTaskId: id,
        channelId,
        workerId,
        expiresAt: new Date(Date.now() + AUTOMATION.BURST_CLAIM_TTL_MS),
      });

      logger.info('Web claim created for companion', {
        claimId: claim.id,
        task: id,
        channelId,
        workerId,
      });

      return { ok: true, claimId: claim.id };
    } catch (error) {
      this.inFlightClaims.delete(id);
      logger.error('Failed to create web claim', { error, task: id });
      return { ok: false, error: 'Failed to reserve task. Please try again.' };
    }
  }

  /**
   * Releases an in-flight claim if GoPartTime accept failed or claim expired.
   */
  releaseClaim(subTaskId: string): void {
    this.inFlightClaims.delete(subTaskId);
  }
}

export const availableTasksService = new AvailableTasksService();
