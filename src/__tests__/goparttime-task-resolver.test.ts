import { findTaskByExternalId, findTasksByExternalIds } from '../services/goparttime-task-resolver.service';
import { taskRepository } from '../database/repositories';

jest.mock('../database/repositories', () => ({
  taskRepository: {
    findBySourceExternalIds: jest.fn(),
    findByIds: jest.fn(),
  },
}));

jest.mock('../database/converters', () => ({
  toTask: jest.fn((row) => row),
}));

const mockedFindLinked = taskRepository.findBySourceExternalIds as jest.Mock;
const mockedFindByIds = taskRepository.findByIds as jest.Mock;

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    source: null,
    externalTaskId: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedFindLinked.mockResolvedValue([]);
  mockedFindByIds.mockResolvedValue([]);
});

describe('findTasksByExternalIds', () => {
  it('resolves the exact (source, externalTaskId) link first', async () => {
    mockedFindLinked.mockResolvedValue([row('Post #1336842', { source: 'goparttime', externalTaskId: '1336842' })]);

    const resolved = await findTasksByExternalIds(['1336842']);

    expect(resolved.get('1336842')?.id).toBe('Post #1336842');
    expect(mockedFindByIds).not.toHaveBeenCalled();
  });

  it('falls back to a manual task id that embeds the number', async () => {
    mockedFindByIds.mockResolvedValue([row('POST #1336842')]);

    const resolved = await findTaskByExternalId('1336842');

    expect(resolved?.id).toBe('POST #1336842');
    expect(mockedFindByIds).toHaveBeenCalledWith([
      'POST #1336842',
      'Comment #1336842',
      'Post #1336842',
      'COMMENT #1336842',
    ]);
  });

  it('never lets a sourced task shadow the manual fallback', async () => {
    mockedFindByIds.mockResolvedValue([
      row('POST #1336842', { source: 'goparttime' }),
      row('Comment #1336842', { source: null }),
    ]);

    const resolved = await findTaskByExternalId('1336842');

    expect(resolved?.id).toBe('Comment #1336842');
  });

  it('returns null when nothing matches', async () => {
    expect(await findTaskByExternalId('999')).toBeNull();
  });

  it('dedupes ids and only queries manual candidates for unresolved ids', async () => {
    mockedFindLinked.mockResolvedValue([
      row('Post #1', { source: 'goparttime', externalTaskId: '1' }),
    ]);
    mockedFindByIds.mockResolvedValue([row('POST #2')]);

    const resolved = await findTasksByExternalIds(['1', '1', '2']);

    expect(Array.from(resolved.keys()).sort()).toEqual(['1', '2']);
    expect(mockedFindByIds).toHaveBeenCalledWith([
      'POST #2',
      'Comment #2',
      'Post #2',
      'COMMENT #2',
    ]);
  });
});
