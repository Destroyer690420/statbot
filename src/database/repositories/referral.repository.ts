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

  async findByIndirectSpecialInviter(inviterId: string) {
    return getDb().referral.findMany({
      where: { indirectSpecialInviterId: inviterId },
    });
  }

  async findRecruiterLinkByInviteeId(inviteeId: string) {
    return getDb().referral.findFirst({
      where: { inviteeId, inviterType: 'special', role: 'recruiter' },
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
    role: string;
    indirectSpecialInviterId: string | null;
    status: string;
    oneTimeCommissionPaid: boolean;
    oneTimeCommissionPaidAt: Date | null;
    perTaskCommissionActive: boolean;
    ticketId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return getDb().referral.create({ data: data as any });
  }

  async update(id: string, data: {
    inviterName?: string;
    inviteeName?: string;
    ticketId?: string | null;
    role?: string;
    indirectSpecialInviterId?: string | null;
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
