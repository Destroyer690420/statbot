import { failedTaskCheckService } from '../services/failed-task-check.service';
import { failedTaskCheckRepository } from '../database/repositories';
import { findTasksByExternalIds } from '../services/goparttime-task-resolver.service';
import { OWNER_USER_ID } from '../config/constants';

jest.mock('../database/repositories', () => ({
  failedTaskCheckRepository: {
    findByExternalTaskIds: jest.fn(),
    upsertMany: jest.fn(),
    markNotified: jest.fn(),
    markNotifyError: jest.fn(),
  },
}));

jest.mock('../services/goparttime-task-resolver.service', () => ({
  findTasksByExternalIds: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedFindExisting = failedTaskCheckRepository.findByExternalTaskIds as jest.Mock;
const mockedUpsert = failedTaskCheckRepository.upsertMany as jest.Mock;
const mockedMarkNotified = failedTaskCheckRepository.markNotified as jest.Mock;
const mockedMarkNotifyError = failedTaskCheckRepository.markNotifyError as jest.Mock;
const mockedResolve = findTasksByExternalIds as jest.Mock;

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'Post #1336842',
    type: 'POST',
    status: 'PENDING',
    cancelledReason: null,
    submittedRedditUrl: 'https://www.reddit.com/r/test/comments/abc123/post/',
    redditUrl: null,
    source: 'goparttime',
    ...overrides,
  };
}

function existingRow(overrides: Record<string, unknown> = {}) {
  return {
    externalTaskId: '1336842',
    notifiedAt: null,
    ...overrides,
  };
}

function makeClient(sendImpl: jest.Mock = jest.fn().mockResolvedValue(undefined)) {
  const fetch = jest.fn().mockResolvedValue({ send: sendImpl });
  return { client: { users: { fetch } } as any, fetch, send: sendImpl };
}

const scanItem = { externalTaskId: '1336842', type: 'post' as const, reward: '$2.50' };

beforeEach(() => {
  jest.clearAllMocks();
  mockedFindExisting.mockResolvedValue([]);
  mockedUpsert.mockResolvedValue(undefined);
  mockedMarkNotified.mockResolvedValue(undefined);
  mockedMarkNotifyError.mockResolvedValue(undefined);
  mockedResolve.mockResolvedValue(new Map());
});

describe('failedTaskCheckService.scan', () => {
  it('classifies a new OK task, upserts it, and DMs the owner once', async () => {
    mockedResolve.mockResolvedValue(new Map([['1336842', task()]]));
    const { client, fetch, send } = makeClient();

    const result = await failedTaskCheckService.scan(
      { tasks: [scanItem], pagesScanned: 2 },
      client,
    );

    expect(result.scanned).toBe(1);
    expect(result.newTasks).toBe(1);
    expect(result.counts.MISMATCH).toBe(1);
    expect(result.newMismatchIds).toEqual(['1336842']);
    expect(result.dm).toEqual({ sent: true, error: null });
    expect(result.mismatches[0]).toMatchObject({
      externalTaskId: '1336842',
      taskId: 'Post #1336842',
      taskStatus: 'PENDING',
      isNew: true,
    });
    expect(result.mismatches[0].notifiedAt).not.toBeNull();

    const rows = mockedUpsert.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalTaskId: '1336842',
      verdict: 'MISMATCH',
      taskStatus: 'PENDING',
      cancelledReason: null,
      reward: '$2.50',
    });

    expect(fetch).toHaveBeenCalledWith(OWNER_USER_ID);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].content).toContain('1336842');
    expect(mockedMarkNotified).toHaveBeenCalledWith(['1336842'], expect.any(Date));
  });

  it('prefers the stored task type over a wrong browser hint', async () => {
    mockedResolve.mockResolvedValue(new Map([['1336842', task()]]));
    const { client } = makeClient();

    const result = await failedTaskCheckService.scan(
      { tasks: [{ externalTaskId: '1336842', type: 'comment' as const }] },
      client,
    );

    // The Statbot row says POST, so the card heading hint must not win.
    expect(result.mismatches[0].taskType).toBe('post');
    expect(mockedUpsert.mock.calls[0][0][0].taskType).toBe('post');
  });

  it('falls back to the browser hint for an ID Statbot does not know', async () => {
    const { client } = makeClient();

    const result = await failedTaskCheckService.scan(
      { tasks: [{ externalTaskId: '999999', type: 'comment' as const }] },
      client,
    );

    expect(result.counts.NOT_FOUND).toBe(1);
    expect(mockedUpsert.mock.calls[0][0][0].taskType).toBe('comment');
  });

  it('never DMs a task already marked deleted in Statbot', async () => {
    mockedResolve.mockResolvedValue(
      new Map([['1336842', task({ cancelledReason: 'deleted_later' })]]),
    );
    const { client, send } = makeClient();

    const result = await failedTaskCheckService.scan({ tasks: [scanItem] }, client);

    expect(result.counts.DELETED).toBe(1);
    expect(result.mismatches).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(result.dm.sent).toBe(false);
  });

  it('never DMs a task that has no submitted link', async () => {
    mockedResolve.mockResolvedValue(
      new Map([
        [
          '1336842',
          task({ submittedRedditUrl: null, redditUrl: null }),
        ],
      ]),
    );
    const { client, send } = makeClient();

    const result = await failedTaskCheckService.scan({ tasks: [scanItem] }, client);

    expect(result.counts.NOT_COMPARABLE).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('reports an unknown task as NOT_FOUND and stays silent', async () => {
    const { client, send } = makeClient();

    const result = await failedTaskCheckService.scan({ tasks: [scanItem] }, client);

    expect(result.counts.NOT_FOUND).toBe(1);
    expect(result.notFound).toEqual(['1336842']);
    expect(result.mismatches).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not re-DM a mismatch that was already notified', async () => {
    mockedResolve.mockResolvedValue(new Map([['1336842', task()]]));
    mockedFindExisting.mockResolvedValue([
      existingRow({ notifiedAt: new Date('2026-10-01T10:00:00Z') }),
    ]);
    const { client, send } = makeClient();

    const result = await failedTaskCheckService.scan({ tasks: [scanItem] }, client);

    expect(result.mismatches[0].notifiedAt).toBe('2026-10-01T10:00:00.000Z');
    expect(result.newMismatchIds).toEqual([]);
    expect(result.dm.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('retries the DM for a previously seen but never-notified mismatch', async () => {
    mockedResolve.mockResolvedValue(new Map([['1336842', task()]]));
    mockedFindExisting.mockResolvedValue([existingRow()]);
    const { client, send } = makeClient();

    const result = await failedTaskCheckService.scan({ tasks: [scanItem] }, client);

    expect(result.mismatches[0].isNew).toBe(false);
    expect(result.newMismatchIds).toEqual(['1336842']);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps the row eligible for retry when the DM fails', async () => {
    mockedResolve.mockResolvedValue(new Map([['1336842', task()]]));
    const send = jest.fn().mockRejectedValue(new Error('Cannot send messages to this user'));
    const { client } = makeClient(send);

    const result = await failedTaskCheckService.scan({ tasks: [scanItem] }, client);

    expect(result.dm.sent).toBe(false);
    expect(result.dm.error).toContain('Cannot send messages');
    expect(result.mismatches[0].notifiedAt).toBeNull();
    expect(mockedMarkNotified).not.toHaveBeenCalled();
    expect(mockedMarkNotifyError).toHaveBeenCalledWith(
      ['1336842'],
      expect.stringContaining('Cannot send messages'),
      expect.any(Date),
    );
  });

  it('dedupes duplicate cards for the same task id', async () => {
    mockedResolve.mockResolvedValue(new Map([['1336842', task()]]));
    const { client } = makeClient();

    const result = await failedTaskCheckService.scan(
      {
        tasks: [scanItem, { ...scanItem, failedReason: 'duplicate card' }],
      },
      client,
    );

    expect(result.scanned).toBe(1);
    expect(mockedUpsert.mock.calls[0][0]).toHaveLength(1);
    expect(mockedMarkNotified).toHaveBeenCalledWith(['1336842'], expect.any(Date));
  });

  it('counts a missing Discord client as a notify failure without throwing', async () => {
    mockedResolve.mockResolvedValue(new Map([['1336842', task()]]));

    const result = await failedTaskCheckService.scan({ tasks: [scanItem] }, null);

    expect(result.dm.sent).toBe(false);
    expect(result.dm.error).toBe('Discord client unavailable.');
    expect(mockedMarkNotifyError).not.toHaveBeenCalled();
  });

  it('handles an empty failed page without touching the DM path', async () => {
    const { client, send } = makeClient();

    const result = await failedTaskCheckService.scan({ tasks: [], pagesScanned: 1 }, client);

    expect(result.scanned).toBe(0);
    expect(result.newTasks).toBe(0);
    expect(result.counts).toEqual({
      MISMATCH: 0,
      DELETED: 0,
      NOT_COMPARABLE: 0,
      NOT_FOUND: 0,
    });
    expect(mockedUpsert).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
