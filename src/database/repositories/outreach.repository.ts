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
}

export const outreachRepository = new OutreachRepository();