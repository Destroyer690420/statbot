process.env.DISCORD_TOKEN = 'test-discord-token-12345';
process.env.CLIENT_ID = 'test-client-id';
process.env.GUILD_ID = 'test-guild-id';
process.env.ADMIN_USER_IDS = '1299323714101317715';
process.env.MANAGER_USER_IDS = '222';
process.env.MODERATOR_USER_IDS = '333';
process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-16-chars';
process.env.DASHBOARD_PASSWORD = 'test-password';

import fs from 'fs';
import path from 'path';
import { backupTicketChannel } from '../utils/ticket-backup';

jest.mock('../database/db', () => ({
  getDb: jest.fn(),
  initializeDatabase: jest.fn(),
}));

describe('backupTicketChannel', () => {
  const TEST_BASE_DIR = path.join('uploads', 'test-backups');
  let mockDb: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = {
      task: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'T-1', redditUrl: 'https://reddit.com/r/test', type: 'POST', status: 'COMPLETED' },
        ]),
      },
      reminder: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'R-1', taskId: 'T-1', type: 'POST_20H', completed: true },
        ]),
      },
      payoutItem: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'P-1', taskId: 'T-1', amount: 60 },
        ]),
      },
      ticketOnboarding: {
        findUnique: jest.fn().mockResolvedValue({
          channelId: 'ch-test-backup',
          profileUsername: 'testuser',
          profileLinkKarma: 100,
          profileCommentKarma: 50,
          profileCheckStatus: 'PASSED',
        }),
      },
      workerPortalAccess: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      workerPaymentInfo: {
        findUnique: jest.fn().mockResolvedValue({
          workerId: 'worker-backup-1',
          upiId: 'test@upi',
          payeeName: 'Test Worker',
        }),
      },
      referral: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const { getDb } = require('../database/db');
    (getDb as jest.Mock).mockReturnValue(mockDb);
  });

  afterAll(() => {
    // Clean up test backup directory
    const fullTestDir = path.resolve(process.cwd(), TEST_BASE_DIR);
    if (fs.existsSync(fullTestDir)) {
      fs.rmSync(fullTestDir, { recursive: true, force: true });
    }
  });

  it('generates transcript.json, transcript.txt and metadata.json with all message & DB records', async () => {
    const mockMsg1 = {
      id: 'm-1',
      createdTimestamp: 1000,
      createdAt: new Date('2026-08-01T10:00:00Z'),
      author: { id: 'worker-backup-1', tag: 'worker#0001', username: 'worker', bot: false },
      content: 'Here is my Reddit link https://reddit.com/r/test',
      attachments: new Map(),
      embeds: [],
    };

    const mockMsg2 = {
      id: 'm-2',
      createdTimestamp: 2000,
      createdAt: new Date('2026-08-01T10:05:00Z'),
      author: { id: 'bot-1', tag: 'bot#0000', username: 'bot', bot: true },
      content: 'Submission recorded.',
      attachments: new Map(),
      embeds: [{ title: 'Status', description: 'Verified', fields: [] }],
    };

    const channel: any = {
      id: 'ch-test-backup',
      name: 'ticket-0888',
      guildId: 'guild-test',
      createdAt: new Date('2026-08-01T09:00:00Z'),
      messages: {
        fetch: jest.fn()
          .mockResolvedValueOnce(new Map([['m-1', mockMsg1], ['m-2', mockMsg2]]))
          .mockResolvedValueOnce(new Map()), // End of pagination
      },
    };

    const result = await backupTicketChannel(
      channel,
      'worker-backup-1',
      'worker#0001',
      TEST_BASE_DIR,
    );

    expect(result.success).toBe(true);
    expect(result.messagesCount).toBe(2);
    expect(fs.existsSync(result.backupDir)).toBe(true);

    const jsonPath = path.join(result.backupDir, 'transcript.json');
    const txtPath = path.join(result.backupDir, 'transcript.txt');
    const metaPath = path.join(result.backupDir, 'metadata.json');

    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(txtPath)).toBe(true);
    expect(fs.existsSync(metaPath)).toBe(true);

    const parsedJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(parsedJson.channel.name).toBe('ticket-0888');
    expect(parsedJson.worker.id).toBe('worker-backup-1');
    expect(parsedJson.messages.length).toBe(2);
    expect(parsedJson.database.tasks.length).toBe(1);
    expect(parsedJson.database.onboarding.profileCheckStatus).toBe('PASSED');
    expect(parsedJson.database.paymentInfo.upiId).toBe('test@upi');

    const txtContent = fs.readFileSync(txtPath, 'utf8');
    expect(txtContent).toContain('TICKET TRANSCRIPT: #ticket-0888');
    expect(txtContent).toContain('worker#0001');
    expect(txtContent).toContain('Here is my Reddit link');

    const metaContent = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    expect(metaContent.channelName).toBe('ticket-0888');
    expect(metaContent.tasksCount).toBe(1);
  });

  it('fails gracefully and returns success: false if message fetch throws', async () => {
    const channel: any = {
      id: 'ch-fail-read',
      name: 'ticket-9999',
      guildId: 'guild-test',
      createdAt: new Date(),
      messages: {
        fetch: jest.fn().mockRejectedValue(new Error('Discord API 500 Internal Server Error')),
      },
    };

    const result = await backupTicketChannel(channel, 'worker-1', 'worker', TEST_BASE_DIR);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Discord API 500');
  });
});

