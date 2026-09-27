import { getDb } from '../db';

export class OnboardingRepository {
  async findByChannelId(channelId: string) {
    return getDb().ticketOnboarding.findUnique({ where: { channelId } });
  }

  async markWelcomeSent(channelId: string, at: Date = new Date()) {
    return getDb().ticketOnboarding.upsert({
      where: { channelId },
      create: { channelId, welcomeSentAt: at, updatedAt: at },
      update: { welcomeSentAt: at, updatedAt: at },
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
}

export const onboardingRepository = new OnboardingRepository();
