import { getDb } from '../db';

export class ReferralRepository {
  async findById(id: string) {
    return getDb().referral.findUnique({ where: { id } });
  }

  async findByInviteeAndInviter(inviteeId: string, inviterId: string) {
    return getDb().referral.findFirst({
      where: { inviteeId, inviterId },
    });
  }

  async findByInviterId(inviterId: string) {
    return getDb().referral.findMany({
      where: { inviterId },
    });
  }

  async findByInviteeId(inviteeId: string) {
    return getDb().referral.findMany({
      where: { inviteeId },
    });
  }

  async findByIndirectSpecialInviterId(specialInviterId: string) {
    return getDb().referral.findMany({
      where: { indirectSpecialInviterId: specialInviterId },
    });
  }

  async findAll() {
    return getDb().referral.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    id: string;
    inviterId: string;
    inviterName: string;
    inviteeId: string;
    inviteeName: string;
    inviterType: string;
    status: string;
    oneTimeCommissionPaid: boolean;
    oneTimeCommissionPaidAt: Date | null;
    perTaskCommissionActive: boolean;
    ticketId: string | null;
    indirectSpecialInviterId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return getDb().referral.create({ data: data as any });
  }

  async update(id: string, data: {
    inviterId?: string;
    inviterName?: string;
    inviteeId?: string;
    inviteeName?: string;
    inviterType?: string;
    indirectSpecialInviterId?: string | null;
    ticketId?: string | null;
    status?: string;
    oneTimeCommissionPaid?: boolean;
    oneTimeCommissionPaidAt?: Date | null;
    perTaskCommissionActive?: boolean;
    updatedAt?: Date;
  }) {
    return getDb().referral.update({
      where: { id },
      data: data as any,
    });
  }

  async delete(id: string) {
    return getDb().referral.delete({ where: { id } });
  }
}

export const referralRepository = new ReferralRepository();

