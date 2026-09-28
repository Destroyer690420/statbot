import { getDb } from '../db';
import { PROFILE_CHECK_PENDING } from '../../config/constants';

export class OnboardingRepository {
  async findByChannelId(channelId: string) {
    return getDb().ticketOnboarding.findUnique({ where: { channelId } });
  }

  /**
   * Records the welcome AND enrolls the ticket in the Reddit profile check.
   *
   * Deliberately one method, not two. They are always true together (a ticket
   * is enrolled exactly when its welcome was delivered), and splitting them
   * would allow a "welcome sent" record with no enrollment — which the
   * message handler reads as "not enrolled" and then never asks that worker
   * for a profile link at all.
   */
  async enrollProfileCheck(channelId: string, at: Date = new Date()) {
    return getDb().ticketOnboarding.upsert({
      where: { channelId },
      create: {
        channelId,
        welcomeSentAt: at,
        profileCheckStatus: PROFILE_CHECK_PENDING,
        updatedAt: at,
      },
      update: { welcomeSentAt: at, profileCheckStatus: PROFILE_CHECK_PENDING, updatedAt: at },
    });
  }

  async markGuideSent(channelId: string, at: Date = new Date()) {
    return getDb().ticketOnboarding.upsert({
      where: { channelId },
      create: { channelId, guideSentAt: at, updatedAt: at },
      update: { guideSentAt: at, updatedAt: at },
    });
  }

  async hasGuideBeenSent(channelId: string): Promise<boolean> {
    const row = await getDb().ticketOnboarding.findUnique({ where: { channelId }, select: { guideSentAt: true } });
    return row?.guideSentAt != null;
  }

  /**
   * Records that this ticket's worker was asked for their Reddit profile link.
   *
   * Part of the one-off sweep (`scripts/ask-reddit-profile-links.ts`), not a
   * live hook. The timestamp IS the one-time guard: the sweep re-reads every
   * recorded channel before sending, so re-running it after a partial failure
   * resumes instead of re-asking workers who already got the message.
   */
  async markRedditProfileRequested(channelId: string, at: Date = new Date()) {
    return getDb().ticketOnboarding.upsert({
      where: { channelId },
      create: { channelId, redditProfileRequestedAt: at, updatedAt: at },
      update: { redditProfileRequestedAt: at, updatedAt: at },
    });
  }

  /**
   * Every channel that already got the Reddit profile request. One projected
   * read of a channel-id-only list, so the sweep can filter hundreds of
   * channels client-side instead of one round-trip per channel.
   */
  async findRedditProfileRequestedChannelIds(): Promise<string[]> {
    const rows = await getDb().ticketOnboarding.findMany({
      where: { redditProfileRequestedAt: { not: null } },
      select: { channelId: true },
    });
    return rows.map((row) => row.channelId);
  }

  /**
   * Persists a check verdict. Only the profile columns are touched: the
   * welcome/guide/sweep columns are independent facts about the same ticket
   * and must not be reset by a re-check (a reset `guideSentAt` would make the
   * bot re-send the onboarding guide).
   */
  async markProfileChecked(
    channelId: string,
    result: {
      status: string;
      username: string | null;
      linkKarma: number | null;
      commentKarma: number | null;
    },
    at: Date = new Date(),
  ) {
    return getDb().ticketOnboarding.upsert({
      where: { channelId },
      create: {
        channelId,
        profileCheckStatus: result.status,
        profileUsername: result.username,
        profileLinkKarma: result.linkKarma,
        profileCommentKarma: result.commentKarma,
        profileCheckedAt: at,
        updatedAt: at,
      },
      update: {
        profileCheckStatus: result.status,
        profileUsername: result.username,
        profileLinkKarma: result.linkKarma,
        profileCommentKarma: result.commentKarma,
        profileCheckedAt: at,
        updatedAt: at,
      },
    });
  }

  /**
   * Records one "that was not a profile link" nudge. The count is what caps
   * the re-ask loop, so it is incremented only when a re-ask is actually sent
   * — a worker who re-sends a valid link is never charged for it.
   */
  async incrementProfileReask(channelId: string, at: Date = new Date()) {
    const row = await getDb().ticketOnboarding.findUnique({
      where: { channelId },
      select: { profileReaskCount: true },
    });
    const next = (row?.profileReaskCount ?? 0) + 1;
    return getDb().ticketOnboarding.upsert({
      where: { channelId },
      create: { channelId, profileReaskCount: next, updatedAt: at },
      update: { profileReaskCount: next, updatedAt: at },
    });
  }
}

export const onboardingRepository = new OnboardingRepository();
