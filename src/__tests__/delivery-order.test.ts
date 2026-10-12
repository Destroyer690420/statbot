/**
 * Background delivery — send order, idempotency, stand-down, failure path.
 *
 * The worker must send exactly the old synchronous sequence (metadata →
 * content → images in stored order → instruction → image-order reminder):
 * workers see image 1 first, then 2, and so on. Heavy I/O is mocked; the
 * Discord channel is a recorder.
 */
import { TextChannel } from 'discord.js';

jest.mock('../services/task.service', () => ({
  taskService: { findById: jest.fn() },
}));
jest.mock('../database/repositories', () => ({
  taskRepository: {
    updateAssignment: jest.fn(),
    updateDeliveryMessages: jest.fn(),
    compareAndSetAssignmentSent: jest.fn(),
  },
}));
jest.mock('../database/db', () => ({
  getDb: jest.fn(),
}));
jest.mock('../scheduler/jobs', () => ({
  scheduleAllReminders: jest.fn(),
}));
jest.mock('../services/reminder.service', () => ({
  reminderService: { createForTask: jest.fn() },
}));
jest.mock('../services/audit.service', () => ({
  auditLogService: { log: jest.fn() },
}));
jest.mock('../services/nudge.service', () => ({
  scheduleNudgeForTask: jest.fn(),
}));
jest.mock('../services/feedback.service', () => ({
  scheduleFeedbackForTask: jest.fn(),
  removeFeedbackJob: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../utils/permissions', () => ({
  getAllAdminIds: jest.fn().mockReturnValue([]),
  isAdminOrManager: jest.fn().mockReturnValue(false),
}));
jest.mock('../utils/image-processor', () => ({
  prepareImage: jest.fn(async (url: string) => ({ buffer: Buffer.from('img:' + url), extension: 'png' })),
}));
jest.mock('../utils/video-processor', () => ({
  prepareVideo: jest.fn(),
  formatBytes: jest.fn((n: number) => `${n}B`),
}));

import { taskService } from '../services/task.service';
import { taskRepository } from '../database/repositories';
import { auditLogService } from '../services/audit.service';
import { scheduleNudgeForTask } from '../services/nudge.service';
import { scheduleFeedbackForTask } from '../services/feedback.service';
import { goparttimeService } from '../services/goparttime.service';
import { TaskStatus, TaskType, AuditAction } from '../types';

const taskSvc = taskService as unknown as { findById: jest.Mock };
const taskRepo = taskRepository as unknown as Record<string, jest.Mock>;
const auditSvc = auditLogService as unknown as { log: jest.Mock };

let sendCounter = 0;
let sentArgs: unknown[] = [];

function makeChannel() {
  const channel = Object.create(TextChannel.prototype) as any;
  Object.defineProperty(channel, 'send', {
    value: jest.fn(async (arg: unknown) => {
      sentArgs.push(arg);
      sendCounter += 1;
      return { id: `msg-${sendCounter}` };
    }),
    writable: true,
    configurable: true,
    enumerable: true,
  });
  return channel;
}

function makeClient(channel: unknown) {
  return {
    channels: {
      cache: { get: () => channel },
      fetch: async () => channel,
    },
  } as any;
}

// Images deliberately out of order — delivery must still send 1, 2, 3.
function makeTask(over: Record<string, unknown> = {}) {
  return {
    id: 'Post #1',
    type: TaskType.POST,
    status: TaskStatus.ACCEPTED,
    guildId: 'g1',
    channelId: 'ch1',
    channelName: 'ticket-1',
    assignedUserId: 'worker1',
    assignedUserName: 'w1',
    source: 'goparttime',
    externalTaskId: '100',
    subreddit: 'testsub',
    subredditUrl: 'https://www.reddit.com/r/testsub/',
    flair: null,
    title: 'Hello title',
    postLink: null,
    commentLink: null,
    formattedContent: 'First para.\n\nSecond para.',
    taskImages: [
      { order: 3, url: 'https://img/3.png', kind: 'image' },
      { order: 1, url: 'https://img/1.png', kind: 'image' },
      { order: 2, url: 'https://img/2.png', kind: 'image' },
    ],
    deliveryMessages: null,
    assignmentStatus: 'PENDING',
    assignmentError: null,
    submittedRedditUrl: null,
    createdAt: new Date('2026-10-12T10:00:00Z'),
    ...over,
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  sendCounter = 0;
  sentArgs = [];
  taskRepo.compareAndSetAssignmentSent.mockResolvedValue(1);
  taskRepo.updateDeliveryMessages.mockResolvedValue(undefined);
  taskRepo.updateAssignment.mockResolvedValue(undefined);
  auditSvc.log.mockResolvedValue(undefined);
  (scheduleFeedbackForTask as jest.Mock).mockResolvedValue({ scheduled: true, reason: 'test' });
});

describe('deliverPendingTask — send order (images 1, 2, 3)', () => {
  it('sends metadata → content → images in stored order → instruction → reminder', async () => {
    taskSvc.findById.mockResolvedValue(makeTask());
    const channel = makeChannel();

    const outcome = await goparttimeService.deliverPendingTask('Post #1', makeClient(channel));

    expect(outcome).toEqual({ delivered: true, reason: 'sent' });
    // 4 metadata + 2 content + 3 images + instruction + reminder
    expect(sentArgs).toHaveLength(11);
    expect(sentArgs[0]).toBe('subreddit');
    expect(sentArgs[1]).toBe('https://www.reddit.com/r/testsub/');
    expect(sentArgs[2]).toBe('title');
    expect(sentArgs[3]).toBe('Hello title');
    expect(sentArgs[4]).toBe('content');
    expect(String(sentArgs[5])).toContain('First para');
    const files = [sentArgs[6], sentArgs[7], sentArgs[8]] as any[];
    expect(files.map((f) => f.files[0].name)).toEqual(['task-image-1.png', 'task-image-2.png', 'task-image-3.png']);
    expect((sentArgs[9] as any).embeds).toHaveLength(1);
    expect(typeof sentArgs[10]).toBe('string');
    expect(String(sentArgs[10])).toContain('correct order');
  });

  it('records delivery kinds in send order and flips PENDING→SENT via CAS', async () => {
    taskSvc.findById.mockResolvedValue(makeTask());
    const channel = makeChannel();

    await goparttimeService.deliverPendingTask('Post #1', makeClient(channel));

    expect(taskRepo.compareAndSetAssignmentSent).toHaveBeenCalledTimes(1);
    const [taskId, channelId, workerId, records] = taskRepo.compareAndSetAssignmentSent.mock.calls[0];
    expect(taskId).toBe('Post #1');
    expect(channelId).toBe('ch1');
    expect(workerId).toBe('worker1');
    expect(records.map((r: any) => r.kind)).toEqual([
      'metadata', 'metadata', 'metadata', 'metadata', 'metadata',
      'content',
      'images', 'images', 'images',
      'instruction',
      'image-order',
    ]);
    expect(records.map((r: any) => r.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(auditSvc.log).toHaveBeenCalledWith(
      AuditAction.TASK_ASSIGNED,
      'Post #1',
      null,
      expect.stringContaining('Assigned from external source'),
    );
    expect(scheduleNudgeForTask as jest.Mock).toHaveBeenCalledWith('Post #1');
    // scheduleFeedbackClock is fire-and-forget — flush the queue first.
    await new Promise((r) => setTimeout(r, 50));
    expect(scheduleFeedbackForTask as jest.Mock).toHaveBeenCalled();
  });
});

describe('deliverPendingTask — idempotency and stand-down', () => {
  it('sends nothing when the assignment already left PENDING', async () => {
    taskSvc.findById.mockResolvedValue(makeTask({ assignmentStatus: 'SENT' }));
    const channel = makeChannel();

    const outcome = await goparttimeService.deliverPendingTask('Post #1', makeClient(channel));

    expect(outcome.delivered).toBe(false);
    expect(sentArgs).toHaveLength(0);
    expect(taskRepo.compareAndSetAssignmentSent).not.toHaveBeenCalled();
  });

  it('stands down without touching the row when the ticket changed mid-flight', async () => {
    const initial = makeTask();
    const reassigned = makeTask({ channelId: 'ch2', assignedUserId: 'worker2' });
    let calls = 0;
    taskSvc.findById.mockImplementation(async () => (++calls === 1 ? initial : reassigned));
    const channel = makeChannel();

    const outcome = await goparttimeService.deliverPendingTask('Post #1', makeClient(channel));

    expect(outcome.delivered).toBe(false);
    expect(sentArgs).toHaveLength(0);
    expect(taskRepo.compareAndSetAssignmentSent).not.toHaveBeenCalled();
    expect(taskRepo.updateAssignment).not.toHaveBeenCalled();
    expect(auditSvc.log).toHaveBeenCalledWith(
      AuditAction.TASK_ASSIGNED,
      'Post #1',
      null,
      expect.stringContaining('stood down'),
    );
  });

  it('marks FAILED (old-path outcome) when a send throws and the row is still ours', async () => {
    taskSvc.findById.mockResolvedValue(makeTask());
    const channel = makeChannel();
    (channel.send as jest.Mock).mockImplementation(async (arg: unknown) => {
      sentArgs.push(arg);
      sendCounter += 1;
      if (sendCounter === 7) throw new Error('Discord exploded');
      return { id: `msg-${sendCounter}` };
    });

    const outcome = await goparttimeService.deliverPendingTask('Post #1', makeClient(channel));

    expect(outcome.delivered).toBe(false);
    expect(sentArgs).toHaveLength(7);
    expect(taskRepo.updateAssignment).toHaveBeenCalledWith('Post #1', {
      assignmentStatus: 'FAILED',
      assignmentError: 'Discord exploded',
    });
    expect(taskRepo.compareAndSetAssignmentSent).not.toHaveBeenCalled();
  });
});
