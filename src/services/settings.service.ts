import { settingsRepository } from '../database/repositories';
import { logger } from '../utils/logger';

const DEFAULT_COMMENT_RATE = 30;
const DEFAULT_POST_RATE = 60;

class SettingsService {
  async getPayoutRates(): Promise<{ commentRate: number; postRate: number }> {
    try {
      const doc = await settingsRepository.getPayoutRates();
      if (!doc) {
        return { commentRate: DEFAULT_COMMENT_RATE, postRate: DEFAULT_POST_RATE };
      }
      return {
        commentRate: doc.commentRate ?? DEFAULT_COMMENT_RATE,
        postRate: doc.postRate ?? DEFAULT_POST_RATE,
      };
    } catch (error) {
      logger.error('Failed to read payout rates, using defaults', { error });
      return { commentRate: DEFAULT_COMMENT_RATE, postRate: DEFAULT_POST_RATE };
    }
  }

  async updatePayoutRates(commentRate: number, postRate: number, userId: string): Promise<void> {
    await settingsRepository.setPayoutRates({
      commentRate,
      postRate,
      updatedAt: new Date(),
      updatedBy: userId,
    });

    logger.info('Payout rates updated', { commentRate, postRate, userId });
  }
}

export const settingsService = new SettingsService();
