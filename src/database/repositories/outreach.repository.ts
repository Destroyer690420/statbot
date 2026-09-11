import { getDb } from '../db';

export class OutreachRepository {
  async findAll() {
    return getDb().ticketOutreach.findMany();
  }

  async findByChannelId(channelId: string) {
    return getDb().ticketOutreach.findUnique({ where: { channelId } });
  }

  async upsertSelection(selections: { channelId: string; selected: boolean }[]) {
    if (selections.length === 0) return [];
    return getDb().$transaction(
      selections.map((s) =>
        getDb().ticketOutreach.upsert({
          where: { channelId: s.channelId },
          create: { channelId: s.channelId, selected: s.selected },
          update: { selected: s.selected, updatedAt: new Date() },
        }),
      ),
    );
  }

  async setMessageSent(channelId: string, at: Date) {
    return getDb().ticketOutreach.update({
      where: { channelId },
      data: { messageSentAt: at, updatedAt: new Date() },
    });
  }

  async markAvailable(channelId: string, at: Date) {
    return getDb().ticketOutreach.update({
      where: { channelId },
      data: { availableAt: at, updatedAt: new Date() },
    });
  }

  async resetCycle(channelId: string) {
    return getDb().ticketOutreach.update({
      where: { channelId },
      data: { messageSentAt: null, availableAt: null, updatedAt: new Date() },
    });
  }

  async getMessage() {
    return getDb().outreachSettings.findUnique({ where: { id: 'outreach-message' } });
  }

  async setMessage(data: { message: string; updatedAt: Date; updatedBy: string }) {
    return getDb().outreachSettings.upsert({
      where: { id: 'outreach-message' },
      create: { id: 'outreach-message', ...data },
      update: data,
    });
  }

  // ─── Blast campaigns (n-slot outreach) ───

  async createBlast(slotsTotal: number, createdBy: string | null) {
    return getDb().outreachBlast.create({
      data: { slotsTotal, slotsFilled: 0, status: 'OPEN', createdBy },
    });
  }

  async getBlast(id: string) {
    return getDb().outreachBlast.findUnique({ where: { id } });
  }

  async getOpenBlast() {
    return getDb().outreachBlast.findFirst({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Most recent blast regardless of status (green persists after close). */
  async latestBlast() {
    return getDb().outreachBlast.findFirst({
      orderBy: { createdAt: 'desc' },
    });
  }

  async closeBlast(id: string, slotsFilled: number) {
    return getDb().outreachBlast.update({
      where: { id },
      data: { status: 'CLOSED', slotsFilled },
    });
  }

  async recordBlastMessage(blastId: string, channelId: string, messageId: string) {
    return getDb().outreachBlastMessage.upsert({
      where: { blastId_channelId: { blastId, channelId } },
      create: { blastId, channelId, messageId },
      update: { messageId },
    });
  }

  async listBlastMessages(blastId: string) {
    return getDb().outreachBlastMessage.findMany({ where: { blastId } });
  }

  async recordReply(blastId: string, channelId: string, workerId: string) {
    try {
      const row = await getDb().outreachReply.create({
        data: { blastId, channelId, workerId },
      });
      return { row, duplicate: false as const };
    } catch {
      // Unique (blastId, channelId) — channel already replied in this blast.
      const row = await getDb().outreachReply.findUnique({
        where: { blastId_channelId: { blastId, channelId } },
      });
      return { row, duplicate: true as const };
    }
  }

  async countReplies(blastId: string) {
    return getDb().outreachReply.count({ where: { blastId } });
  }

  async listReplyChannelIds(blastId: string) {
    const rows = await getDb().outreachReply.findMany({
      where: { blastId },
      select: { channelId: true },
    });
    return rows.map((r) => r.channelId);
  }
}

export const outreachRepository = new OutreachRepository();