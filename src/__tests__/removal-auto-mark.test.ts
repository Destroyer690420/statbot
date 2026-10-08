import { maybeAutoMarkDeleted, isAutoMarkableState, describeRemovalState } from '../services/removal-auto-mark.service';
import { taskService } from '../services/task.service';
import { taskRepository } from '../database/repositories';
import { auditLogService } from '../services/audit.service';
import { cancelTaskJobs } from '../scheduler/jobs';
import { TaskStatus, TaskType, AuditAction } from '../types';

// Heavy deps mocked before the unit under test loads: the service itself is
// thin orchestration over taskService/taskRepository/audit/jobs, and none of
// those may touch a real DB/Redis here (see docs/TESTING.md §1).
jest.mock('../services/task.service', () => ({
  taskService: { findById: jest.fn() },
}));
jest.mock('../database/repositories', () => ({
  taskRepository: { updateCancelledReason: jest.fn() },
}));
jest.mock('../services/audit.service', () => ({
  auditLogService: { log: jest.fn() },
}));
jest.mock('../scheduler/jobs', () => ({
  cancelTaskJobs: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockedFindById = taskService.findById as jest.Mock;
const mockedUpdateReason = taskRepository.updateCancelledReason as jest.Mock;
const mockedAudit = auditLogService.log as jest.Mock;
const mockedCancelJobs = cancelTaskJobs as jest.Mock;

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'Post #1',
    type: TaskType.POST,
    status: TaskStatus.PENDING,
    cancelledReason: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedAudit.mockResolvedValue(undefined);
  mockedUpdateReason.mockResolvedValue(undefined);
  mockedCancelJobs.mockResolvedValue(undefined);
});

describe('isAutoMarkableState (the 100%-sure gate)', () => {
  it.each(['REMOVED_BY_MODS', 'REMOVED_BY_FILTER', 'DELETED_BY_USER'])('marks %s', (s) => {
    expect(isAutoMarkableState(s)).toBe(true);
  });

  it.each(['LIVE', 'REMOVED_OTHER', 'NOT_FOUND', 'NO_SESSION', 'SESSION_EXPIRED', 'FETCH_ERROR', 'BLOCKED', null, undefined, ''])(
    'never marks %s',
    (s) => {
      expect(isAutoMarkableState(s as string)).toBe(false);
    },
  );
});

describe('describeRemovalState', () => {
  it('names each certain state plainly', () => {
    expect(describeRemovalState('REMOVED_BY_MODS')).toBe('removed by moderators');
    expect(describeRemovalState('REMOVED_BY_FILTER')).toBe("removed by Reddit's filters");
    expect(describeRemovalState('DELETED_BY_USER')).toBe('deleted');
  });
});

describe('maybeAutoMarkDeleted', () => {
  it('marks a pending post on certain removal, stops reminders, audits once', async () => {
    mockedFindById.mockResolvedValue(task());
    const acted = await maybeAutoMarkDeleted('Post #1', 'REMOVED_BY_MODS', 'survival-capture');
    expect(acted).toBe(true);
    expect(mockedUpdateReason).toHaveBeenCalledWith('Post #1', 'deleted');
    expect(mockedCancelJobs).toHaveBeenCalledWith('Post #1');
    expect(mockedAudit).toHaveBeenCalledTimes(1);
    expect(mockedAudit).toHaveBeenCalledWith(
      AuditAction.AUTO_MARKED_DELETED,
      'Post #1',
      'system',
      expect.stringContaining('removed by moderators'),
    );
  });

  it('does nothing for uncertain states (no write, no audit, no cancel)', async () => {
    mockedFindById.mockResolvedValue(task());
    for (const state of ['LIVE', 'NOT_FOUND', 'REMOVED_OTHER', 'FETCH_ERROR', null]) {
      jest.clearAllMocks();
      expect(await maybeAutoMarkDeleted('Post #1', state, 'survival-capture')).toBe(false);
    }
    expect(mockedUpdateReason).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
    expect(mockedCancelJobs).not.toHaveBeenCalled();
  });

  it('never touches COMPLETED/ARCHIVED/CANCELLED (paid tasks stay manual)', async () => {
    for (const status of [TaskStatus.COMPLETED, TaskStatus.ARCHIVED, TaskStatus.CANCELLED]) {
      mockedFindById.mockResolvedValue(task({ status }));
      expect(await maybeAutoMarkDeleted('Post #1', 'DELETED_BY_USER', 'survival-capture')).toBe(false);
    }
    expect(mockedUpdateReason).not.toHaveBeenCalled();
  });

  it('never overwrites an existing mark (first mark wins, incl. manual)', async () => {
    mockedFindById.mockResolvedValue(task({ cancelledReason: 'deleted' }));
    expect(await maybeAutoMarkDeleted('Post #1', 'DELETED_BY_USER', 'survival-capture')).toBe(false);
    mockedFindById.mockResolvedValue(task({ cancelledReason: 'deleted_later' }));
    expect(await maybeAutoMarkDeleted('Post #1', 'REMOVED_BY_MODS', 'survival-capture')).toBe(false);
    expect(mockedUpdateReason).not.toHaveBeenCalled();
  });

  it('ignores comments and missing tasks', async () => {
    mockedFindById.mockResolvedValue(task({ type: TaskType.COMMENT }));
    expect(await maybeAutoMarkDeleted('Post #1', 'DELETED_BY_USER', 'survival-capture')).toBe(false);
    mockedFindById.mockResolvedValue(null);
    expect(await maybeAutoMarkDeleted('Post #1', 'DELETED_BY_USER', 'survival-capture')).toBe(false);
    expect(mockedUpdateReason).not.toHaveBeenCalled();
  });
});
