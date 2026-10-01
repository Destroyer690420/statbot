/**
 * Button routing in `interactionCreate`.
 *
 * This handler is a prefix switch shared by two independent button flows. The
 * failure mode that matters is a misroute: a click landing in the wrong handler
 * is either silently dropped (Discord shows the user "this interaction
 * failed") or, worse, executed against the wrong ticket.
 */

const mockHandleBlastButton = jest.fn();
const mockHandleOutreachAddButton = jest.fn();
const mockCommandExecute = jest.fn();

jest.mock('../services/automation/blast-approval.service', () => ({
  handleBlastButton: (...args: unknown[]) => mockHandleBlastButton(...args),
}));

jest.mock('../services/outreach-selection.service', () => ({
  handleOutreachAddButton: (...args: unknown[]) => mockHandleOutreachAddButton(...args),
}));

jest.mock('../bot/commands/task', () => ({ execute: (...a: unknown[]) => mockCommandExecute(...a) }));
jest.mock('../bot/commands/status', () => ({ execute: jest.fn() }));
jest.mock('../bot/commands/find', () => ({ execute: jest.fn() }));
jest.mock('../bot/commands/delete', () => ({ execute: jest.fn() }));
jest.mock('../bot/commands/pending', () => ({ execute: jest.fn() }));
jest.mock('../bot/commands/completed', () => ({ execute: jest.fn() }));
jest.mock('../bot/commands/overdue', () => ({ execute: jest.fn() }));
jest.mock('../bot/commands/stats', () => ({ execute: jest.fn() }));
jest.mock('../bot/commands/reschedule', () => ({ execute: jest.fn() }));
jest.mock('../bot/commands/send-now', () => ({ execute: jest.fn() }));
jest.mock('../bot/commands/help', () => ({ execute: jest.fn() }));
jest.mock('../bot/commands/referral', () => ({ execute: jest.fn() }));
jest.mock('../bot/commands/mystats', () => ({ execute: jest.fn() }));
jest.mock('../bot/commands/myinvites', () => ({ execute: jest.fn() }));
jest.mock('../bot/commands/logincode', () => ({ execute: jest.fn() }));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../services/audit.service', () => ({
  auditLogService: { log: jest.fn().mockResolvedValue(undefined) },
}));

import { handleInteractionCreate } from '../bot/events/interactionCreate';

function makeButton(customId: string) {
  return {
    isButton: () => true,
    isChatInputCommand: () => false,
    customId,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHandleBlastButton.mockResolvedValue(true);
  mockHandleOutreachAddButton.mockResolvedValue(true);
});

describe('routing outreach_add buttons', () => {
  it('sends the add-to-outreach button to its own handler', async () => {
    await handleInteractionCreate(makeButton('outreach_add:1234567890123456789') as never);

    expect(mockHandleOutreachAddButton).toHaveBeenCalledTimes(1);
    // The whole point: it must NOT also reach the blast handler, which would
    // act on a different meaning of the same click.
    expect(mockHandleBlastButton).not.toHaveBeenCalled();
  });

  it('routes by prefix, so it works for any ticket', async () => {
    await handleInteractionCreate(makeButton('outreach_add:9876543210987654321') as never);

    expect(mockHandleOutreachAddButton).toHaveBeenCalledTimes(1);
  });

  it('does not treat a blast button as an outreach button', async () => {
    await handleInteractionCreate(makeButton('blast:go:cycle-1') as never);

    expect(mockHandleOutreachAddButton).not.toHaveBeenCalled();
    expect(mockHandleBlastButton).toHaveBeenCalledTimes(1);
  });

  it('ignores a foreign button so collector-based flows keep working', async () => {
    // /delete confirmations use their own collectors.
    await handleInteractionCreate(makeButton('delete-confirm:task-1') as never);

    expect(mockHandleOutreachAddButton).not.toHaveBeenCalled();
    expect(mockHandleBlastButton).not.toHaveBeenCalled();
  });

  it('does not match a lookalike prefix', async () => {
    // "outreach_added:" must not be routed as "outreach_add".
    await handleInteractionCreate(makeButton('outreach_added:1234567890123456789') as never);

    expect(mockHandleOutreachAddButton).not.toHaveBeenCalled();
  });
});

describe('resilience', () => {
  it('does not re-route to the blast handler when the outreach handler throws', async () => {
    // A crash in one handler must not fall through and run the other flow's
    // logic against the same click.
    mockHandleOutreachAddButton.mockRejectedValueOnce(new Error('boom'));

    await expect(
      handleInteractionCreate(makeButton('outreach_add:1234567890123456789') as never),
    ).resolves.toBeUndefined();

    expect(mockHandleBlastButton).not.toHaveBeenCalled();
  });
});