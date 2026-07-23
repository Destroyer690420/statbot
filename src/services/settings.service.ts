import { settingsCollection, toTimestamp } from '../database/firebase';
import { logger } from '../utils/logger';

const PAYOUT_RATES_DOC_ID = 'payout-rates';

const DEFAULT_COMMENT_RATE = 30;
const DEFAULT_POST_RATE = 60;

class SettingsService {
  async getPayoutRates(): Promise<{ commentRate: number; postRate: number }> {
    try {
      const doc = await settingsCollection().doc(PAYOUT_RATES_DOC_ID).get();
      if (!doc.exists) {
        return { commentRate: DEFAULT_COMMENT_RATE, postRate: DEFAULT_POST_RATE };
      }
      const data = doc.data()!;
      return {
        commentRate: data.commentRate ?? DEFAULT_COMMENT_RATE,
        postRate: data.postRate ?? DEFAULT_POST_RATE,
      };
    } catch (error) {
      logger.error('Failed to read payout rates, using defaults', { error });
      return { commentRate: DEFAULT_COMMENT_RATE, postRate: DEFAULT_POST_RATE };
    }
  }

  async updatePayoutRates(commentRate: number, postRate: number, userId: string): Promise<void> {
    await settingsCollection().doc(PAYOUT_RATES_DOC_ID).set({
      commentRate,
      postRate,
      updatedAt: toTimestamp(new Date()),
      updatedBy: userId,
    });

    logger.info('Payout rates updated', { commentRate, postRate, userId });
  }
}

export const settingsService = new SettingsService();
