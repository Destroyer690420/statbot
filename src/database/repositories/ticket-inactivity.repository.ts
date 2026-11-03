import { getDb } from '../db';
import { TicketInactivity } from '../../types';
import { toTicketInactivity } from '../converters';

export interface UpsertInactivityInput {
  channelName?: string | null;
  workerId?: string | null;
  workerUsername?: string | null;
  lastActivityAt: Date;
  hasWorkerMessages?: boolean;
  status?: string;
  protectionReason?: string | null;
}

export class TicketInactivityRepository {
  async findByChannelId(channelId: string): Promise<TicketInactivity | null> {
    const row = await getDb().ticketInactivity.findUnique({
      where: { channelId },
    });
    return row ? toTicketInactivity(row) : null;
  }

  async findAll(): Promise<TicketInactivity[]> {
    const rows = await getDb().ticketInactivity.findMany({
      orderBy: { lastActivityAt: 'asc' },
    });
    return rows.map(toTicketInactivity);
  }

  async findByStatus(status: string): Promise<TicketInactivity[]> {
    const rows = await getDb().ticketInactivity.findMany({
      where: { status },
      orderBy: { lastActivityAt: 'asc' },
    });
    return rows.map(toTicketInactivity);
  }

  async upsertActivity(
    channelId: string,
    data: UpsertInactivityInput,
  ): Promise<TicketInactivity> {
    const db = getDb();
    const row = await db.ticketInactivity.upsert({
      where: { channelId },
      create: {
        channelId,
        channelName: data.channelName,
        workerId: data.workerId,
        workerUsername: data.workerUsername,
        lastActivityAt: data.lastActivityAt,
        hasWorkerMessages: data.hasWorkerMessages ?? false,
        status: data.status ?? 'ACTIVE',
        protectionReason: data.protectionReason ?? null,
      },
      update: {
        channelName: data.channelName !== undefined ? data.channelName : undefined,
        workerId: data.workerId !== undefined ? data.workerId : undefined,
        workerUsername: data.workerUsername !== undefined ? data.workerUsername : undefined,
        lastActivityAt: data.lastActivityAt,
        hasWorkerMessages: data.hasWorkerMessages !== undefined ? data.hasWorkerMessages : undefined,
        status: data.status !== undefined ? data.status : undefined,
        protectionReason: data.protectionReason !== undefined ? data.protectionReason : undefined,
      },
    });
    return toTicketInactivity(row);
  }

  /**
   * Called whenever the worker sends a message in the ticket:
   * resets the inactivity counter and warning states to zero so the full
   * 15/25/30-day lifecycle can begin again cleanly.
   */
  async recordWorkerMessage(
    channelId: string,
    workerId: string,
    workerUsername: string | null,
    messageCreatedAt: Date,
  ): Promise<TicketInactivity> {
    const db = getDb();
    const row = await db.ticketInactivity.upsert({
      where: { channelId },
      create: {
        channelId,
        workerId,
        workerUsername,
        lastActivityAt: messageCreatedAt,
        hasWorkerMessages: true,
        status: 'ACTIVE',
        firstWarningSentAt: null,
        finalWarningSentAt: null,
        protectionReason: null,
      },
      update: {
        workerId,
        workerUsername: workerUsername ?? undefined,
        lastActivityAt: messageCreatedAt,
        hasWorkerMessages: true,
        status: 'ACTIVE',
        firstWarningSentAt: null,
        finalWarningSentAt: null,
        protectionReason: null,
      },
    });
    return toTicketInactivity(row);
  }

  async recordFirstWarning(channelId: string, sentAt: Date): Promise<TicketInactivity> {
    const row = await getDb().ticketInactivity.update({
      where: { channelId },
      data: {
        firstWarningSentAt: sentAt,
        status: 'WARNED_15',
      },
    });
    return toTicketInactivity(row);
  }

  async recordFinalWarning(channelId: string, sentAt: Date): Promise<TicketInactivity> {
    const row = await getDb().ticketInactivity.update({
      where: { channelId },
      data: {
        finalWarningSentAt: sentAt,
        status: 'WARNED_25',
      },
    });
    return toTicketInactivity(row);
  }

  async recordProtected(channelId: string, reason: string): Promise<TicketInactivity> {
    const row = await getDb().ticketInactivity.update({
      where: { channelId },
      data: {
        status: 'PROTECTED',
        protectionReason: reason,
      },
    });
    return toTicketInactivity(row);
  }

  async recordDeleted(
    channelId: string,
    backupPath: string,
    deletedAt: Date,
  ): Promise<TicketInactivity> {
    const row = await getDb().ticketInactivity.update({
      where: { channelId },
      data: {
        status: 'DELETED',
        backupPath,
        deletedAt,
      },
    });
    return toTicketInactivity(row);
  }
}

export const ticketInactivityRepository = new TicketInactivityRepository();

