/**
 * Digest assembly rules (blast-approval.service): row-0 suppression and the
 * embed DM shape.
 *
 * Mock note: blast-approval pulls burst.service (→ outreach.service,
 * discord.js) transitively, so the env-touching modules are mocked and only
 * the real assembly runs — same pattern as automation-name-quarantine.
 */
import { buildDigestForCycle } from '../services/automation/blast-approval.service';
import { automationRepository } from '../database/repositories';

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../utils/permissions', () => ({
  getAdminOrManagerIds: jest.fn(() => ['owner-1']),
  getAllAdminIds: jest.fn(() => []),
  isAdminOrManager: jest.fn(() => true),
}));
jest.mock('../database/repositories', () => ({
  automationRepository: {
    getCycle: jest.fn(),
    listCycleLogs: jest.fn(),
    listBlocked: jest.fn(),
    listSeenSubreddits: jest.fn(),
    listOpenBursts: jest.fn(),
    listBurstsByCycle: jest.fn(),
  },
  outreachRepository: {},
  taskRepository: {},
}));
jest.mock('../services/audit.service', () => ({
  auditLogService: { log: jest.fn() },
}));

const repo = automationRepository as unknown as Record<string, jest.Mock>;

function seed(opts: {
  eligibleLogs?: number;
  bursts?: boolean;
  openBursts?: boolean;
  blocked?: string[];
}): void {
  const logs: any[] = [];
  for (let i = 0; i < (opts.eligibleLogs ?? 0); i++) {
    logs.push({ externalTaskId: `${i + 1}`, taskType: 'post', subreddit: 'cats', status: 'ELIGIBLE' });
  }
  repo.getCycle.mockResolvedValue({ tasksDetected: logs.length, eligiblePosts: logs.length, blocked: 0 });
  repo.listCycleLogs.mockResolvedValue(logs);
  repo.listBlocked.mockResolvedValue((opts.blocked ?? []).map((subreddit) => ({ subreddit })));
  repo.listSeenSubreddits.mockResolvedValue(['cats']);
  repo.listOpenBursts.mockResolvedValue(opts.openBursts ? [{}] : []);
  repo.listBurstsByCycle.mockResolvedValue(opts.bursts ? [{ id: 'b1' }] : []);
}

function customIds(built: { components: { toJSON: () => any }[] }): string[] {
  return built.components.flatMap((row) =>
    (row.toJSON().components || []).map((b: any) => String(b.custom_id)),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildDigestForCycle row-0 suppression', () => {
  it('keeps Blast/Hold when the round is unreleased and eligible', async () => {
    seed({ eligibleLogs: 2 });
    const built = (await buildDigestForCycle('c1'))!;
    const ids = customIds(built);
    expect(ids.some((id) => id.startsWith('blast:go:'))).toBe(true);
    expect(ids.some((id) => id.startsWith('blast:hold:'))).toBe(true);
    expect(ids.some((id) => id.startsWith('blast:block:'))).toBe(true);
  });

  it('hides Blast/Hold once the round released (tap would answer already-released)', async () => {
    seed({ eligibleLogs: 2, bursts: true });
    const built = (await buildDigestForCycle('c1'))!;
    const ids = customIds(built);
    expect(ids.some((id) => id.startsWith('blast:go:'))).toBe(false);
    expect(ids.some((id) => id.startsWith('blast:hold:'))).toBe(false);
    expect(ids.some((id) => id.startsWith('blast:block:'))).toBe(true);
  });

  it('hides Blast/Hold when nothing is eligible', async () => {
    seed({ eligibleLogs: 0 });
    const built = (await buildDigestForCycle('c1'))!;
    expect(customIds(built)).toEqual([]);
  });

  it('hides Blast/Hold for the pre-blast report (auto-open is imminent)', async () => {
    seed({ eligibleLogs: 2 });
    const built = (await buildDigestForCycle('c1', { willAutoOpen: true }))!;
    const ids = customIds(built);
    expect(ids.some((id) => id.startsWith('blast:go:'))).toBe(false);
    expect(ids.some((id) => id.startsWith('blast:hold:'))).toBe(false);
    expect(ids.some((id) => id.startsWith('blast:block:'))).toBe(true);
  });

  it('keeps Restart batch available while a batch is open and unreleased', async () => {
    seed({ eligibleLogs: 2, openBursts: true });
    const built = (await buildDigestForCycle('c1'))!;
    const ids = customIds(built);
    expect(ids.some((id) => id.endsWith(':restart'))).toBe(true);
  });

  it('returns null for a missing cycle', async () => {
    repo.getCycle.mockResolvedValue(null);
    await expect(buildDigestForCycle('gone')).resolves.toBeNull();
  });
});
