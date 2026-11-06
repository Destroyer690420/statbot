import type { Client } from 'discord.js';

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../database/repositories', () => ({
  automationRepository: {
    listBurstsByCycle: jest.fn(),
    listCycleClaims: jest.fn(),
  },
}));

jest.mock('../services/audit.service', () => ({
  auditLogService: {
    log: jest.fn().mockResolvedValue(undefined),
  },
}));

import {
  announceBatchAvailable,
  checkAndAnnounceBatchClaimed,
  updateBatchCount,
  resetAnnouncementState,
} from '../services/automation/task-announcement.service';
import {
  TASKS_ANNOUNCEMENT_CHANNEL_ID,
  formatBatchAvailableAnnouncement,
  formatBatchClaimedAnnouncement,
} from '../config/constants';
import { automationRepository } from '../database/repositories';
import { auditLogService } from '../services/audit.service';

describe('Task Announcement Service', () => {
  let mockSend: jest.Mock;
  let mockEdit: jest.Mock;
  let mockFetchedMsg: { id: string; edit: jest.Mock };
  let mockChannel: { id: string; send: jest.Mock; messages: { fetch: jest.Mock } };
  let mockClient: Partial<Client>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetAnnouncementState();

    mockSend = jest.fn().mockResolvedValue({ id: 'msg-1' });
    mockEdit = jest.fn().mockResolvedValue({});
    mockFetchedMsg = { id: 'msg-1', edit: mockEdit };
    mockChannel = {
      id: TASKS_ANNOUNCEMENT_CHANNEL_ID,
      send: mockSend,
      messages: {
        fetch: jest.fn().mockResolvedValue(mockFetchedMsg),
      },
    };
    mockClient = {
      channels: {
        fetch: jest.fn().mockResolvedValue(mockChannel),
      } as any,
    };
  });

  describe('Announcement text formatting', () => {
    it('formats batch available message for multiple posts', () => {
      expect(formatBatchAvailableAnnouncement(3)).toBe(
        '@everyone 🚀 **3 posts available!** Reply in your tickets ASAP to claim.',
      );
    });

    it('formats batch available message for a single post', () => {
      expect(formatBatchAvailableAnnouncement(1)).toBe(
        '@everyone 🚀 **1 post available!** Reply in your tickets ASAP to claim.',
      );
    });

    it('formats batch claimed message for multiple posts', () => {
      expect(formatBatchClaimedAnnouncement(3)).toBe('🏁 All 3 posts have been claimed!');
    });

    it('formats batch claimed message for a single post', () => {
      expect(formatBatchClaimedAnnouncement(1)).toBe('🏁 All 1 post has been claimed!');
    });
  });

  describe('announceBatchAvailable', () => {
    it('returns false if count <= 0 or client is undefined', async () => {
      expect(await announceBatchAvailable(undefined, 'cycle-1', 3)).toBe(false);
      expect(await announceBatchAvailable(mockClient as Client, 'cycle-1', 0)).toBe(false);
      expect(await announceBatchAvailable(mockClient as Client, 'cycle-1', -1)).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('sends available announcement to announcement channel with @everyone mention and embed', async () => {
      const ok = await announceBatchAvailable(mockClient as Client, 'cycle-1', 3);
      expect(ok).toBe(true);
      expect(mockClient.channels?.fetch).toHaveBeenCalledWith(TASKS_ANNOUNCEMENT_CHANNEL_ID);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '@everyone 🚀 **3 posts available!** Reply in your tickets ASAP to claim.',
          embeds: expect.any(Array),
          allowedMentions: { parse: ['everyone'] },
        }),
      );
      expect(auditLogService.log).toHaveBeenCalled();
    });

    it('is idempotent per cycleId', async () => {
      const first = await announceBatchAvailable(mockClient as Client, 'cycle-1', 3);
      const second = await announceBatchAvailable(mockClient as Client, 'cycle-1', 3);

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('handles fetch or send failure gracefully without throwing', async () => {
      (mockClient.channels?.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      const ok = await announceBatchAvailable(mockClient as Client, 'cycle-1', 3);
      expect(ok).toBe(false);
    });
  });

  describe('checkAndAnnounceBatchClaimed', () => {
    it('returns false if available announcement was never sent for this cycle', async () => {
      const ok = await checkAndAnnounceBatchClaimed(mockClient as Client, 'cycle-unannounced');
      expect(ok).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns false if not all tasks have been claimed yet', async () => {
      await announceBatchAvailable(mockClient as Client, 'cycle-1', 3);
      mockSend.mockClear();

      (automationRepository.listBurstsByCycle as jest.Mock).mockResolvedValue([
        { id: 'burst-1', cycleId: 'cycle-1', taskIds: ['t1', 't2', 't3'], status: 'OPEN' },
      ]);
      (automationRepository.listCycleClaims as jest.Mock).mockResolvedValue([
        { id: 'c1', status: 'CLAIMED' },
        { id: 'c2', status: 'CLAIMED' },
        { id: 'c3', status: 'PENDING' },
      ]);

      const ok = await checkAndAnnounceBatchClaimed(mockClient as Client, 'cycle-1');
      expect(ok).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('sends claimed announcement when all tasks reach CLAIMED status', async () => {
      await announceBatchAvailable(mockClient as Client, 'cycle-1', 3);
      mockSend.mockClear();

      (automationRepository.listBurstsByCycle as jest.Mock).mockResolvedValue([
        { id: 'burst-1', cycleId: 'cycle-1', taskIds: ['t1', 't2', 't3'], status: 'OPEN' },
      ]);
      (automationRepository.listCycleClaims as jest.Mock).mockResolvedValue([
        { id: 'c1', status: 'CLAIMED' },
        { id: 'c2', status: 'CLAIMED' },
        { id: 'c3', status: 'CLAIMED' },
      ]);

      const ok = await checkAndAnnounceBatchClaimed(mockClient as Client, 'cycle-1');
      expect(ok).toBe(true);
      expect(mockSend).toHaveBeenCalledWith({
        content: '🏁 All 3 posts have been claimed!',
      });
      expect(auditLogService.log).toHaveBeenCalled();
    });

    it('is idempotent per cycleId for claimed announcement', async () => {
      await announceBatchAvailable(mockClient as Client, 'cycle-1', 3);
      mockSend.mockClear();

      (automationRepository.listBurstsByCycle as jest.Mock).mockResolvedValue([
        { id: 'burst-1', cycleId: 'cycle-1', taskIds: ['t1', 't2', 't3'], status: 'OPEN' },
      ]);
      (automationRepository.listCycleClaims as jest.Mock).mockResolvedValue([
        { id: 'c1', status: 'CLAIMED' },
        { id: 'c2', status: 'CLAIMED' },
        { id: 'c3', status: 'CLAIMED' },
      ]);

      const first = await checkAndAnnounceBatchClaimed(mockClient as Client, 'cycle-1');
      const second = await checkAndAnnounceBatchClaimed(mockClient as Client, 'cycle-1');

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('sends completion when burst is CLOSED and all claims are settled', async () => {
      await announceBatchAvailable(mockClient as Client, 'cycle-1', 3);
      mockSend.mockClear();

      (automationRepository.listBurstsByCycle as jest.Mock).mockResolvedValue([
        { id: 'burst-1', cycleId: 'cycle-1', taskIds: ['t1', 't2', 't3'], status: 'CLOSED' },
      ]);
      (automationRepository.listCycleClaims as jest.Mock).mockResolvedValue([
        { id: 'c1', status: 'CLAIMED' },
        { id: 'c2', status: 'CLAIMED' },
        { id: 'c3', status: 'FAILED' },
      ]);

      const ok = await checkAndAnnounceBatchClaimed(mockClient as Client, 'cycle-1');
      expect(ok).toBe(true);
      expect(mockSend).toHaveBeenCalledWith({
        content: '🏁 All 3 posts have been claimed!',
      });
    });

    it('respects updated batch count after tasks are merged into burst', async () => {
      await announceBatchAvailable(mockClient as Client, 'cycle-1', 2);
      updateBatchCount('cycle-1', 1); // Now 3 posts expected
      mockSend.mockClear();

      (automationRepository.listBurstsByCycle as jest.Mock).mockResolvedValue([
        { id: 'burst-1', cycleId: 'cycle-1', taskIds: ['t1', 't2', 't3'], status: 'OPEN' },
      ]);
      (automationRepository.listCycleClaims as jest.Mock).mockResolvedValue([
        { id: 'c1', status: 'CLAIMED' },
        { id: 'c2', status: 'CLAIMED' },
      ]);

      // Only 2 claimed, but 3 expected after merge
      const notYet = await checkAndAnnounceBatchClaimed(mockClient as Client, 'cycle-1');
      expect(notYet).toBe(false);

      // Now 3rd claimed
      (automationRepository.listCycleClaims as jest.Mock).mockResolvedValue([
        { id: 'c1', status: 'CLAIMED' },
        { id: 'c2', status: 'CLAIMED' },
        { id: 'c3', status: 'CLAIMED' },
      ]);

      const ok = await checkAndAnnounceBatchClaimed(mockClient as Client, 'cycle-1');
      expect(ok).toBe(true);
      expect(mockSend).toHaveBeenCalledWith({
        content: '🏁 All 3 posts have been claimed!',
      });
    });
  });
});
