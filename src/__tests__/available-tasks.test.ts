jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { availableTasksService, cleanTitle } from '../services/automation/available-tasks.service';
import { automationRepository, outreachRepository, taskRepository } from '../database/repositories';

jest.mock('../database/repositories', () => ({
  automationRepository: {
    listBlocked: jest.fn().mockResolvedValue([]),
    createClaim: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'claim-123', ...data })),
  },
  outreachRepository: {
    findByChannelId: jest.fn().mockResolvedValue({ channelId: 'ch-1', selected: true, dailyPostLimit: 2 }),
  },
  taskRepository: {
    findBySourceExternal: jest.fn().mockResolvedValue(null),
    countGoPartTimePostsByWorkerInRange: jest.fn().mockResolvedValue(new Map()),
    findAwaitingSubmissionInChannel: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../services/automation/validator.service', () => ({
  evaluateForBurst: jest.fn().mockImplementation((task) => {
    if (task.type !== 'post') {
      return { eligible: false, reason: 'SKIPPED_COMMENT' };
    }
    if (task.title?.toLowerCase().includes('costway')) {
      return { eligible: false, reason: 'BLOCKED' };
    }
    if (task.subreddit?.toLowerCase() === 'blockedsub') {
      return { eligible: false, reason: 'BLOCKED' };
    }
    return { eligible: true, reason: 'ELIGIBLE' };
  }),
  loadSeenSubs: jest.fn().mockResolvedValue(new Set()),
  loadAllowedSubs: jest.fn().mockResolvedValue(new Set()),
}));

describe('AvailableTasksService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (availableTasksService as any).tasks.clear();
    (availableTasksService as any).inFlightClaims.clear();
  });

  describe('setLiveTasks and filtering', () => {
    it('ingests valid posts and filters out invalid ones', async () => {
      const inputs = [
        { subTaskId: '101', type: 'post', subreddit: 'technology', title: 'Great Tech News' },
        { subTaskId: '102', type: 'comment', subreddit: 'technology', title: 'Comment task' }, // should be skipped
        { subTaskId: '103', type: 'post', subreddit: 'blockedsub', title: 'Post in blocked sub' }, // should be skipped
        { subTaskId: '104', type: 'post', subreddit: 'deals', title: 'Huge Costway discount' }, // should be skipped
      ];

      const res = await availableTasksService.setLiveTasks(inputs);
      expect(res.added).toBe(1);
      expect(res.count).toBe(1);

      const available = availableTasksService.getAvailableTasks();
      expect(available.length).toBe(1);
      expect(available[0].subTaskId).toBe('101');
      expect(available[0].subreddit).toBe('technology');
      expect(available[0].title).toBe('Great Tech News');
      expect((available[0] as any).earnings).toBeUndefined();
      expect((available[0] as any).deadline).toBeUndefined();
    });

    it('auto-removes tasks that disappeared from the latest scan', async () => {
      // First scan: tasks 101 and 105
      await availableTasksService.setLiveTasks([
        { subTaskId: '101', type: 'post', subreddit: 'technology', title: 'Post 1' },
        { subTaskId: '105', type: 'post', subreddit: 'gaming', title: 'Post 2' },
      ]);
      expect(availableTasksService.getAvailableTasks().length).toBe(2);

      // Second scan: task 101 disappeared, only 105 remains
      const res = await availableTasksService.setLiveTasks([
        { subTaskId: '105', type: 'post', subreddit: 'gaming', title: 'Post 2' },
      ]);
      expect(res.removed).toBe(1);
      const available = availableTasksService.getAvailableTasks();
      expect(available.length).toBe(1);
      expect(available[0].subTaskId).toBe('105');
    });

    it('removes tasks when a subreddit is dynamically blocked', async () => {
      await availableTasksService.setLiveTasks([
        { subTaskId: '201', type: 'post', subreddit: 'news', title: 'News 1' },
        { subTaskId: '202', type: 'post', subreddit: 'crypto', title: 'Crypto 1' },
      ]);
      expect(availableTasksService.getAvailableTasks().length).toBe(2);

      const removed = availableTasksService.removeSubreddit('crypto');
      expect(removed).toBe(1);
      const available = availableTasksService.getAvailableTasks();
      expect(available.length).toBe(1);
      expect(available[0].subTaskId).toBe('201');
    });
  });

  describe('checkWorkerEligibility', () => {
    it('blocks claim if ticket is not selected in daily outreach', async () => {
      (outreachRepository.findByChannelId as jest.Mock).mockResolvedValueOnce({
        channelId: 'ch-unselected',
        selected: false,
      });

      const status = await availableTasksService.checkWorkerEligibility('w-1', 'ch-unselected');
      expect(status.canClaim).toBe(false);
      expect(status.reason).toContain('not enrolled');
    });

    it('blocks claim if worker reached daily limit', async () => {
      (outreachRepository.findByChannelId as jest.Mock).mockResolvedValueOnce({
        channelId: 'ch-1',
        selected: true,
        dailyPostLimit: 2,
      });
      (taskRepository.countGoPartTimePostsByWorkerInRange as jest.Mock).mockResolvedValueOnce(
        new Map([['w-1', 2]]),
      );

      const status = await availableTasksService.checkWorkerEligibility('w-1', 'ch-1');
      expect(status.canClaim).toBe(false);
      expect(status.reason).toContain('Daily limit reached');
    });

    it('blocks claim if ticket has active post awaiting submission', async () => {
      (outreachRepository.findByChannelId as jest.Mock).mockResolvedValueOnce({
        channelId: 'ch-1',
        selected: true,
        dailyPostLimit: 2,
      });
      (taskRepository.countGoPartTimePostsByWorkerInRange as jest.Mock).mockResolvedValueOnce(new Map());
      (taskRepository.findAwaitingSubmissionInChannel as jest.Mock).mockResolvedValueOnce({ id: 'tsk-active' });

      const status = await availableTasksService.checkWorkerEligibility('w-1', 'ch-1');
      expect(status.canClaim).toBe(false);
      expect(status.hasActiveTask).toBe(true);
      expect(status.reason).toContain('active post awaiting submission');
    });

    it('allows claim when worker meets all conditions', async () => {
      (outreachRepository.findByChannelId as jest.Mock).mockResolvedValueOnce({
        channelId: 'ch-1',
        selected: true,
        dailyPostLimit: 2,
      });
      (taskRepository.countGoPartTimePostsByWorkerInRange as jest.Mock).mockResolvedValueOnce(new Map());
      (taskRepository.findAwaitingSubmissionInChannel as jest.Mock).mockResolvedValueOnce(null);

      const status = await availableTasksService.checkWorkerEligibility('w-1', 'ch-1');
      expect(status.canClaim).toBe(true);
      expect(status.reason).toBeNull();
    });
  });

  describe('claimTask', () => {
    it('creates an AutomationClaim and removes post from live pool', async () => {
      await availableTasksService.setLiveTasks([
        { subTaskId: '301', type: 'post', subreddit: 'science', title: 'Discovery' },
      ]);

      (outreachRepository.findByChannelId as jest.Mock).mockResolvedValueOnce({
        channelId: 'ch-1',
        selected: true,
        dailyPostLimit: 2,
      });

      const res = await availableTasksService.claimTask('301', 'w-1', 'ch-1');
      expect(res.ok).toBe(true);
      expect(res.claimId).toBe('claim-123');

      // Task is removed from available pool
      expect(availableTasksService.getAvailableTasks().length).toBe(0);
      expect(automationRepository.createClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          cycleId: 'web-claim',
          externalTaskId: '301',
          channelId: 'ch-1',
          workerId: 'w-1',
        }),
      );
    });

    it('rejects double-claim with specific user error string', async () => {
      await availableTasksService.setLiveTasks([
        { subTaskId: '302', type: 'post', subreddit: 'science', title: 'Discovery' },
      ]);

      (outreachRepository.findByChannelId as jest.Mock).mockResolvedValue({
        channelId: 'ch-1',
        selected: true,
        dailyPostLimit: 2,
      });

      // Worker 1 claims
      const res1 = await availableTasksService.claimTask('302', 'w-1', 'ch-1');
      expect(res1.ok).toBe(true);

      // Worker 2 attempts same task
      const res2 = await availableTasksService.claimTask('302', 'w-2', 'ch-2');
      expect(res2.ok).toBe(false);
      expect(res2.error).toBe('Someone else just claimed this post! Please select another one.');
    });

    it('returns "Post not available" when task is not in available set', async () => {
      (outreachRepository.findByChannelId as jest.Mock).mockResolvedValue({
        channelId: 'ch-1',
        selected: true,
        dailyPostLimit: 2,
      });

      const res = await availableTasksService.claimTask('999999', 'w-1', 'ch-1');
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Post not available');
    });
  });

  describe('cleanTitle and content enrichment', () => {
    it('unescapes unicode characters and entities in title', () => {
      expect(cleanTitle('C\\u0026I Battery Storage')).toBe('C&I Battery Storage');
      expect(cleanTitle('Who\\u003cSupplies\\u003e Systems?')).toBe('Who<Supplies> Systems?');
      expect(cleanTitle('Tom &amp; Jerry')).toBe('Tom & Jerry');
      expect(cleanTitle(null)).toBeNull();
      expect(cleanTitle('')).toBeNull();
    });

    it('cleans titles automatically during setLiveTasks', async () => {
      await availableTasksService.setLiveTasks([
        {
          subTaskId: '401',
          type: 'post',
          subreddit: 'energystorage',
          title: 'C\\u0026I Battery Storage: Who Supplies Large-Scale Systems?',
        },
      ]);
      const tasks = availableTasksService.getAvailableTasks();
      expect(tasks[0].title).toBe('C&I Battery Storage: Who Supplies Large-Scale Systems?');
    });

    it('enriches task content and unescapes title via updateTaskContent', async () => {
      await availableTasksService.setLiveTasks([
        {
          subTaskId: '402',
          type: 'post',
          subreddit: 'energystorage',
          title: 'Initial Title',
        },
      ]);
      expect(availableTasksService.getAvailableTasks()[0].content).toBeNull();

      const updated = availableTasksService.updateTaskContent(
        '402',
        'Here is the extracted prose content from the drawer.',
        'Updated \\u0026 Cleaned Title',
      );
      expect(updated).toBe(true);

      const tasks = availableTasksService.getAvailableTasks();
      expect(tasks[0].content).toBe('Here is the extracted prose content from the drawer.');
      expect(tasks[0].title).toBe('Updated & Cleaned Title');
    });

    it('returns false when trying to update a non-existent task', () => {
      const updated = availableTasksService.updateTaskContent('non-existent', 'Content');
      expect(updated).toBe(false);
    });
  });
});
