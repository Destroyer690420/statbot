/**
 * Quarantine orchestration: the burst scan path executes name verdicts
 * (pre-blast auto-blocks for confident hits, holds for doubtful ones).
 * Validators stay side-effect-free — every DB write below is asserted.
 *
 * Mock note: burst.service pulls logger (→ env.ts, which exits without a
 * full environment) and discord.js transitively, so the env-touching modules
 * are mocked and only the real orchestration runs.
 */
import { validateInputs } from '../services/automation/burst.service';
import { automationRepository } from '../database/repositories';
import type { BurstTaskInput } from '../services/automation/burst.service';

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../utils/permissions', () => ({
  getAdminOrManagerIds: jest.fn(() => []),
  getAllAdminIds: jest.fn(() => []),
  isAdminOrManager: jest.fn(() => false),
}));
jest.mock('../database/repositories', () => ({
  automationRepository: {
    listBlocked: jest.fn(),
    listSeenSubreddits: jest.fn(),
    listCycleLogs: jest.fn(),
    listAllowed: jest.fn(),
    logTask: jest.fn(),
    addBlocked: jest.fn(),
    isBlocked: jest.fn(),
  },
  outreachRepository: {},
  taskRepository: {},
}));
jest.mock('../services/audit.service', () => ({
  auditLogService: { log: jest.fn() },
}));

const repo = automationRepository as unknown as Record<string, jest.Mock>;

function input(subTaskId: string, subreddit: string | null, title: string | null = 'a normal title here'): BurstTaskInput {
  return { subTaskId, type: 'post', subreddit, title };
}

function loggedStatuses(): string[] {
  return repo.logTask.mock.calls.map((c) => (c[0] as { status: string }).status);
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.listBlocked.mockResolvedValue([]);
  repo.listSeenSubreddits.mockResolvedValue([]);
  repo.listCycleLogs.mockResolvedValue([]);
  repo.listAllowed.mockResolvedValue([]);
  repo.logTask.mockResolvedValue({});
  repo.addBlocked.mockResolvedValue({});
  repo.isBlocked.mockResolvedValue(false);
});

describe('validateInputs name-verdict execution', () => {
  it('pre-blast auto-blocks a confident name hit (no worker ever messaged)', async () => {
    const out = await validateInputs([input('1', 'masturbation')], 'c1');
    expect(repo.addBlocked).toHaveBeenCalledTimes(1);
    expect(repo.addBlocked).toHaveBeenCalledWith('masturbation', 'auto-content:sex', 'auto-screen:scan');
    expect(loggedStatuses()).toEqual(['BLOCKED']);
    expect(out.eligible).toHaveLength(0);
    expect(out.blocked).toBe(1);
    expect(out.quarantined).toBe(0);
  });

  it('quarantines a doubtful name hit (held, logged, never blocked)', async () => {
    const out = await validateInputs([input('2', 'moderators')], 'c1');
    expect(repo.addBlocked).not.toHaveBeenCalled();
    expect(loggedStatuses()).toEqual(['QUARANTINED']);
    const call = repo.logTask.mock.calls[0][0] as { failureReason: string };
    expect(call.failureReason).toContain('mod');
    expect(out.eligible).toHaveLength(0);
    expect(out.quarantined).toBe(1);
    expect(out.blocked).toBe(0);
  });

  it('an allowed sub skips name screening entirely', async () => {
    repo.listAllowed.mockResolvedValue([{ subreddit: 'moderators' }]);
    const out = await validateInputs([input('2', 'moderators')], 'c1');
    expect(repo.addBlocked).not.toHaveBeenCalled();
    expect(loggedStatuses()).toEqual(['ELIGIBLE']);
    expect(out.eligible.map((t) => t.subTaskId)).toEqual(['2']);
    expect(out.quarantined).toBe(0);
  });

  it('a seen-before sub skips name screening (digest reviewed it)', async () => {
    repo.listSeenSubreddits.mockResolvedValue(['masturbation']);
    const out = await validateInputs([input('1', 'masturbation')], 'c1');
    expect(repo.addBlocked).not.toHaveBeenCalled();
    expect(loggedStatuses()).toEqual(['ELIGIBLE']);
    expect(out.eligible).toHaveLength(1);
  });

  it('dry-run writes nothing but keeps the task listed', async () => {
    const out = await validateInputs([input('1', 'masturbation')], 'c1', { dryRun: true });
    expect(repo.addBlocked).not.toHaveBeenCalled();
    expect(loggedStatuses()).toEqual(['ELIGIBLE']);
    expect(out.eligible.map((t) => t.subTaskId)).toEqual(['1']);
    expect(out.blocked).toBe(0);
  });

  it('empty reports cost no reads and return zeros', async () => {
    const out = await validateInputs([], 'c1');
    expect(repo.listBlocked).not.toHaveBeenCalled();
    expect(repo.logTask).not.toHaveBeenCalled();
    expect(out).toMatchObject({ blocked: 0, quarantined: 0, duplicates: 0, commentsSkipped: 0 });
    expect(out.eligible).toEqual([]);
  });

  it('mixes correctly: block + quarantine + eligible in one report', async () => {
    const out = await validateInputs(
      [input('1', 'masturbation'), input('2', 'cartoons'), input('3', 'cats')],
      'c1',
    );
    expect(loggedStatuses()).toEqual(['BLOCKED', 'QUARANTINED', 'ELIGIBLE']);
    expect(out.eligible.map((t) => t.subTaskId)).toEqual(['3']);
    expect(out.blocked).toBe(1);
    expect(out.quarantined).toBe(1);
  });
});
