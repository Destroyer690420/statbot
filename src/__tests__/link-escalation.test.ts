/**
 * Link escalation: overdue posts pool into one re-blast and pair winners.
 *
 * Mock note: escalation defers Discord/DB work to mocked services; only the
 * real pooling/pairing/close logic runs. goparttime + nudge are imported
 * dynamically inside the handlers, so they are mocked like everything else.
 */
import type { TextChannel } from 'discord.js';

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../services/audit.service', () => ({
  auditLogService: { log: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../database/repositories', () => ({
  outreachRepository: {
    getOpenBlast: jest.fn(),
    bumpBlastSlots: jest.fn(),
  },
  taskRepository: {
    findUnsubmittedSentPosts: jest.fn(),
  },
}));
jest.mock('../services/outreach.service', () => ({
  outreachService: {
    beginBlast: jest.fn(),
    sendBlastMessages: jest.fn(),
    setBlastHooksFor: jest.fn(),
    clearBlastHooksFor: jest.fn(),
  },
}));
jest.mock('../services/task.service', () => ({
  taskService: { findById: jest.fn() },
}));
jest.mock('../services/goparttime.service', () => ({
  goparttimeService: { reassignTask: jest.fn() },
}));
jest.mock('../services/nudge.service', () => ({
  scheduleNudgeForTask: jest.fn().mockResolvedValue(undefined),
}));

import { TextChannel as RealTextChannel } from 'discord.js';
import { outreachRepository, taskRepository } from '../database/repositories';
import { outreachService } from '../services/outreach.service';
import { taskService } from '../services/task.service';
import { goparttimeService } from '../services/goparttime.service';
import {
  clearEscalationRound,
  closeEscalationForBlast,
  collectOverduePool,
  escalateDueTasks,
  handleEscalationReply,
  ESCALATION_SENDER,
} from '../services/escalation.service';

const outreachRepo = outreachRepository as unknown as Record<string, jest.Mock>;
const taskRepo = taskRepository as unknown as Record<string, jest.Mock>;
const outreachSvc = outreachService as unknown as Record<string, jest.Mock>;
const taskSvc = taskService as unknown as Record<string, jest.Mock>;
const gptSvc = goparttimeService as unknown as Record<string, jest.Mock>;

const T0 = new Date('2026-10-11T04:00:00.000Z').getTime();

// delivered 20 min ago, still link-less
function row(id: string, workerId: string, channelId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    redditUrl: null,
    type: 'POST',
    status: 'ACCEPTED',
    guildId: 'g',
    channelId,
    channelName: channelId,
    assignedUserId: workerId,
    assignedUserName: workerId,
    createdById: 'goparttime-api',
    notes: null,
    cancelledReason: null,
    source: 'goparttime',
    externalTaskId: id,
    sourceUrl: null,
    subreddit: 'x',
    subredditUrl: null,
    flair: null,
    title: 't',
    postLink: null,
    contentHtml: null,
    formattedContent: 'para',
    payment: null,
    deadline: null,
    taskImages: null,
    deliveryMessages: [{ kind: 'instruction', order: 1, messageId: 'm', createdAt: new Date(T0).toISOString() }],
    assignmentStatus: 'SENT',
    assignmentError: null,
    submittedRedditUrl: null,
    submittedAt: null,
    submittedBy: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: new Date(T0),
    updatedAt: new Date(T0),
    ...extra,
  };
}

function fakeChannel(id: string): TextChannel {
  const channel = Object.create(RealTextChannel.prototype) as any;
  Object.defineProperty(channel, 'id', { value: id, configurable: true });
  channel.send = jest.fn(async () => ({ id: `sent-${id}` }));
  return channel as TextChannel;
}

const taskById = new Map<string, any>();

beforeEach(() => {
  jest.clearAllMocks();
  clearEscalationRound();
  taskById.clear();
  outreachRepo.getOpenBlast.mockResolvedValue(null);
  outreachRepo.bumpBlastSlots.mockResolvedValue({});
  taskRepo.findUnsubmittedSentPosts.mockImplementation(async () => [...taskById.values()]);
  taskSvc.findById.mockImplementation(async (id: string) => taskById.get(id) ?? null);
  outreachSvc.beginBlast.mockImplementation(async (_c: unknown, slots: number) => ({ id: 'blast-e1', slotsTotal: slots }));
  outreachSvc.sendBlastMessages.mockResolvedValue({ sent: [], skipped: [] });
  gptSvc.reassignTask.mockImplementation(async (taskId: string) => ({ id: taskId }));
});

function seedTwo() {
  taskById.set('Post #1', row('Post #1', 'w1', 'c1'));
  taskById.set('Post #2', row('Post #2', 'w2', 'c2'));
}

describe('collectOverduePool', () => {
  it('returns link-less posts past +15min, most overdue first', async () => {
    seedTwo();
    // fresh task: delivered 5 min ago — not overdue
    taskById.set('Post #3', row('Post #3', 'w3', 'c3', {
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
      deliveryMessages: [{ kind: 'instruction', order: 1, messageId: 'm', createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() }],
    }));
    // submitted task: not pooled
    taskById.set('Post #4', row('Post #4', 'w4', 'c4', { submittedRedditUrl: 'https://www.reddit.com/r/x/1' }));
    const pool = await collectOverduePool();
    expect(pool.map((p) => p.id).sort()).toEqual(['Post #1', 'Post #2']);
  });
});

describe('escalateDueTasks', () => {
  it('does nothing when nothing is overdue', async () => {
    const out = await escalateDueTasks({} as any);
    expect(out).toMatchObject({ blasted: false, blastId: null, pooled: 0, deferred: false });
    expect(outreachSvc.beginBlast).not.toHaveBeenCalled();
  });

  it('defers when a foreign round is open (never supersedes a live hour burst)', async () => {
    seedTwo();
    outreachRepo.getOpenBlast.mockResolvedValue({ id: 'blast-hour', status: 'OPEN', createdBy: 'burst' });
    const out = await escalateDueTasks({} as any);
    expect(out.deferred).toBe(true);
    expect(out.pooled).toBe(2);
    expect(outreachSvc.beginBlast).not.toHaveBeenCalled();
  });

  it('opens one combined blast excluding the slackers', async () => {
    seedTwo();
    const out = await escalateDueTasks({} as any);
    expect(out).toMatchObject({ blasted: true, blastId: 'blast-e1', pooled: 2 });
    expect(outreachSvc.beginBlast).toHaveBeenCalledWith(expect.anything(), 2, ESCALATION_SENDER);
    const sendArgs = outreachSvc.sendBlastMessages.mock.calls[0];
    expect(sendArgs[2]).toBe(ESCALATION_SENDER);
    expect(sendArgs[3].excludeWorkerIds).toEqual(new Set(['w1', 'w2']));
    expect(outreachSvc.setBlastHooksFor).toHaveBeenCalledWith('blast-e1', expect.objectContaining({
      onReply: expect.any(Function),
      onClosed: expect.any(Function),
    }));
  });
});

describe('handleEscalationReply', () => {
  function trackedClient(ids: string[]) {
    const channels = new Map<string, TextChannel>();
    const fetch = jest.fn(async (id: string) => {
      if (!ids.includes(id)) return null;
      if (!channels.has(id)) channels.set(id, fakeChannel(id));
      return channels.get(id) ?? null;
    });
    return { client: { channels: { fetch } } as any, channels };
  }

  function sentTexts(channels: Map<string, TextChannel>, id: string): string[] {
    const ch = channels.get(id) as any;
    if (!ch) return [];
    return (ch.send as jest.Mock).mock.calls.map((c) => String(c[0]));
  }

  it('pairs most-overdue first, reassigns, restarts the nudge clock, tells the old ticket', async () => {
    seedTwo();
    const { client, channels } = trackedClient(['c1', 'c2', 'c3', 'c4']);
    await escalateDueTasks(client);
    const first = await handleEscalationReply('blast-e1', 'c3', 'w9', client);
    expect(first).toBe('Post #1');
    expect(gptSvc.reassignTask).toHaveBeenCalledWith('Post #1', 'c3', expect.anything());
    const second = await handleEscalationReply('blast-e1', 'c4', 'w8', client);
    expect(second).toBe('Post #2');
    // old ticket told about the reassignment
    expect(sentTexts(channels, 'c1').join(' ')).toContain('reassigned');
  });

  it('ignores slacker replies (cannot win the replacement round)', async () => {
    seedTwo();
    await escalateDueTasks({} as any);
    const out = await handleEscalationReply('blast-e1', 'c1', 'w1', {} as any);
    expect(out).toBeNull();
    expect(gptSvc.reassignTask).not.toHaveBeenCalled();
  });

  it('skips when the link won the race (submitted before reassign)', async () => {
    seedTwo();
    await escalateDueTasks({} as any);
    taskById.get('Post #1').submittedRedditUrl = 'https://www.reddit.com/r/x/1';
    taskSvc.findById.mockImplementation(async (id: string) => taskById.get(id) ?? null);
    const out = await handleEscalationReply('blast-e1', 'c3', 'w9', {} as any);
    expect(out).toBeNull();
    expect(gptSvc.reassignTask).not.toHaveBeenCalled();
  });

  it('leaves the post pooled when reassign throws (next winner pairs it)', async () => {
    seedTwo();
    const { client } = trackedClient(['c3', 'c4']);
    await escalateDueTasks(client);
    gptSvc.reassignTask.mockRejectedValueOnce(new Error('Multiple workers found'));
    expect(await handleEscalationReply('blast-e1', 'c3', 'w9', client)).toBeNull();
    gptSvc.reassignTask.mockResolvedValueOnce({ id: 'Post #1' });
    expect(await handleEscalationReply('blast-e1', 'c4', 'w8', client)).toBe('Post #1');
  });
});

describe('closeEscalationForBlast', () => {
  it('tags the owner in unassigned tickets and forgets the round', async () => {
    seedTwo();
    const created: TextChannel[] = [];
    const client = {
      channels: {
        fetch: jest.fn(async (id: string) => {
          const ch = fakeChannel(id);
          created.push(ch);
          return ch;
        }),
      },
    } as any;
    await escalateDueTasks(client);
    await handleEscalationReply('blast-e1', 'c3', 'w9', client);
    await closeEscalationForBlast('blast-e1', client);
    expect(outreachSvc.clearBlastHooksFor).toHaveBeenCalledWith('blast-e1');
    // Post #2 unassigned -> owner tagged in c2 with the no-winner line
    const c2sends = (created.find((c) => (c as any).id === 'c2') as any).send.mock.calls.map((c: unknown[]) =>
      String(c[0]),
    );
    expect(c2sends.join(' ')).toContain('No winner');
    expect(c2sends.join(' ')).toContain('<@');
    // round forgotten: further replies pair nothing
    expect(await handleEscalationReply('blast-e1', 'c5', 'w7', client)).toBeNull();
  });
});
