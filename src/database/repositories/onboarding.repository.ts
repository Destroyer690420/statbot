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
}

export const onboardingRepository = new OnboardingRepository();
