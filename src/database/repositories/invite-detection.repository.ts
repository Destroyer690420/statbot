import { getDb } from '../db';

export class InviteDetectionRepository {
  async findById(id: string) {
    return getDb().inviteDetection.findUnique({ where: { id } });
  }

  async findPendingByInviteeId(inviteeId: string) {
    return getDb().inviteDetection.findMany({
      where: { inviteeId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findPendingUnticketedByInviteeId(inviteeId: string) {
    return getDb().inviteDetection.findMany({
      where: { inviteeId, status: 'pending', ticketChannelId: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findPending(limit = 100) {
    return getDb().inviteDetection.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  async findAll(limit = 100) {
    return getDb().inviteDetection.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  async create(data: {
    id: string;
    inviterId: string | null;
    inviterName: string | null;
    inviteeId: string;
    inviteeName: string | null;
    inviteCode: string | null;
    ticketChannelId: string | null;
    ticketName: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return getDb().inviteDetection.create({ data: data as any });
  }

  async update(id: string, data: {
    inviterId?: string | null;
    inviterName?: string | null;
    inviteeName?: string | null;
    inviteCode?: string | null;
    ticketChannelId?: string | null;
    ticketName?: string | null;
    status?: string;
    updatedAt?: Date;
  }) {
    return getDb().inviteDetection.update({
      where: { id },
      data: data as any,
    });
  }
}

export const inviteDetectionRepository = new InviteDetectionRepository();
