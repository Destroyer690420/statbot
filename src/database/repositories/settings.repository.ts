import { getDb } from '../db';

export class SettingsRepository {
  async getPayoutRates() {
    return getDb().payoutSettings.findUnique({ where: { id: 'payout-rates' } });
  }

  async setPayoutRates(data: {
    commentRate: number;
    postRate: number;
    updatedAt: Date;
    updatedBy: string;
  }) {
    return getDb().payoutSettings.upsert({
      where: { id: 'payout-rates' },
      create: { id: 'payout-rates', ...data },
      update: data,
    });
  }

  async getCommissionRates() {
    return getDb().commissionRates.findUnique({ where: { id: 'commission-rates' } });
  }

  async setCommissionRates(data: {
    normalInviteBonus: number;
    normalInviteTaskThreshold: number;
    specialInviteBonus: number;
    specialInviteTaskThreshold: number;
    specialPerComment: number;
    specialPerPost: number;
    updatedAt: Date;
    updatedBy: string;
  }) {
    return getDb().commissionRates.upsert({
      where: { id: 'commission-rates' },
      create: { id: 'commission-rates', ...data },
      update: data,
    });
  }
}

export const settingsRepository = new SettingsRepository();
