/**
 * The click handler behind the in-ticket "add to daily outreach" button.
 *
 * The stakes are one-directional: a wrong write here puts a real worker's
 * ticket into the daily outreach blast, where they get messaged for work they
 * may not have signed up for. Two guarantees are therefore pinned hard:
 *
 *  - ONLY the approver or an admin can write. The button is visible to the
 *    worker in the ticket, so a worker clicking their own button must be
 *    refused and must change nothing.
 *  - The write is `selected: true` on `TicketOutreach`, the same field the
 *    dashboard writes, so this path cannot drift from the dashboard's view.
 */

const mockUpsertSelection = jest.fn();
const mockFindOutreachRow = jest.fn();
const mockAuditLog = jest.fn();

jest.mock('../database/repositories', () => ({
  outreachRepository: {
    upsertSelection: (...args: unknown[]) => mockUpsertSelection(...args),
    findByChannelId: (...args: unknown[]) => mockFindOutreachRow(...args),
  },
}));

jest.mock('../services/audit.service', () => ({
  auditLogService: { log: (...args: unknown[]) => mockAuditLog(...args) },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../utils/permissions', () => ({
  isAdmin: (id: string) => id === '999',
  isAdminOrManager: (id: string) => id === '999',
  getAllAdminIds: () => ['999'],
}));

import { handleOutreachAddButton } from '../services/outreach-selection.service';
import { OUTREACH_ADD_BUTTON_PREFIX } from '../utils/outreach-add-button';
import { REDDIT_PROFILE_APPROVAL_ADMIN_ID } from '../config/constants';

const APPROVER = REDDIT_PROFILE_APPROVAL_ADMIN_ID;
const CHANNEL = '1234567890123456789';

interface InteractionStub {
  customId: string;
  userId: string;
  guildId: string | null;
  /** The channel the button was physically clicked in. */
  channelId: string;
  replies: { content: string; ephemeral?: boolean }[];
  edits: { content: string; components?: unknown }[];
  deferred: number;
  replied: number;
}

type InteractionMock = {
  customId: string;
  guildId: string | null;
  user: { id: string };
  channelId: string;
  replied: boolean;
  deferred: boolean;
  deferUpdate: jest.Mock;
  reply: jest.Mock;
  editReply: jest.Mock;
  followUp: jest.Mock;
};

function makeInteraction(overrides: Partial<InteractionStub> = {}): InteractionMock {
  const stub: InteractionStub = {
    customId: `${OUTREACH_ADD_BUTTON_PREFIX}${CHANNEL}`,
    userId: APPROVER,
    guildId: 'guild-1',
    channelId: CHANNEL,
    replies: [],
    edits: [],
    deferred: 0,
    replied: 0,
    ...overrides,
  };

  const interaction = {
    get customId() {
      return stub.customId;
    },
    get guildId() {
      return stub.guildId;
    },
    user: { id: stub.userId },
    replied: false,
    deferred: false,
    channelId: CHANNEL,
    deferUpdate: jest.fn(async () => {
      stub.deferred++;
      interaction.deferred = true;
    }),
    reply: jest.fn(async (payload: { content: string; ephemeral?: boolean }) => {
      stub.replies.push(payload);
      interaction.replied = true;
    }),
    editReply: jest.fn(async (payload: { content: string; components?: unknown }) => {
      stub.edits.push(payload);
    }),
    followUp: jest.fn(async (payload: { content: string; ephemeral?: boolean }) => {
      stub.replies.push(payload);
    }),
  };
  return interaction;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpsertSelection.mockResolvedValue([]);
  mockFindOutreachRow.mockResolvedValue(null);
  mockAuditLog.mockResolvedValue(undefined);
});

describe('who may add a ticket', () => {
  it('refuses a worker and writes nothing', async () => {
    // The worker is standing right next to the button in their own ticket.
    const interaction = makeInteraction({ userId: '111' });

    const handled = await handleOutreachAddButton(interaction as never);

    expect(handled).toBe(true);
    expect(mockUpsertSelection).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('only admins') }),
    );
  });

  it('tells a refused worker ephemerally so the ticket does not show a rejection', async () => {
    const interaction = makeInteraction({ userId: '111' });

    await handleOutreachAddButton(interaction as never);

    // Ephemeral is guild-only. A public "only admins can do this" in the
    // worker's own ticket is noise that advertises the button to them.
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
  });

  it('allows the configured approver', async () => {
    const interaction = makeInteraction({ userId: APPROVER });

    await handleOutreachAddButton(interaction as never);

    expect(mockUpsertSelection).toHaveBeenCalledWith([{ channelId: CHANNEL, selected: true }]);
  });

  it('allows an admin', async () => {
    const interaction = makeInteraction({ userId: '999' });

    await handleOutreachAddButton(interaction as never);

    expect(mockUpsertSelection).toHaveBeenCalledWith([{ channelId: CHANNEL, selected: true }]);
  });
});

describe('what a click writes', () => {
  it('selects the ticket in TicketOutreach, the same field the dashboard writes', async () => {
    const interaction = makeInteraction({ userId: APPROVER });

    await handleOutreachAddButton(interaction as never);

    expect(mockUpsertSelection).toHaveBeenCalledWith([{ channelId: CHANNEL, selected: true }]);
  });

  it('selects the ticket named in the button, not the channel it was clicked in', async () => {
    // Defense against a mismatched or reused message: the id is the source of
    // truth for WHICH ticket is selected.
    const interaction = makeInteraction({
      userId: APPROVER,
      customId: `${OUTREACH_ADD_BUTTON_PREFIX}999999999999999999`,
      channelId: CHANNEL,
    });

    await handleOutreachAddButton(interaction as never);

    expect(mockUpsertSelection).toHaveBeenCalledWith([{ channelId: '999999999999999999', selected: true }]);
  });

  it('confirms in the message and disables the button so it cannot be added twice', async () => {
    const interaction = makeInteraction({ userId: APPROVER });

    await handleOutreachAddButton(interaction as never);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('daily outreach') }),
    );
    const edit = (interaction.editReply as jest.Mock).mock.calls[0][0];
    // Components must be rebuilt as disabled, not left as the live button.
    expect(JSON.stringify(edit.components)).toContain('"disabled":true');
  });

  it('audits the selection', async () => {
    const interaction = makeInteraction({ userId: APPROVER });

    await handleOutreachAddButton(interaction as never);

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      null,
      APPROVER,
      expect.stringContaining(CHANNEL),
    );
  });
});

describe('re-clicking an already-selected ticket', () => {
  it('says so and writes nothing new', async () => {
    mockFindOutreachRow.mockResolvedValue({ channelId: CHANNEL, selected: true });

    const interaction = makeInteraction({ userId: APPROVER });

    await handleOutreachAddButton(interaction as never);

    // Idempotent no-op: re-writing the same value is harmless but the log and
    // the audit trail should not claim a change that did not happen.
    expect(mockUpsertSelection).not.toHaveBeenCalled();
    expect((interaction.editReply as jest.Mock).mock.calls[0][0].content).toContain('already');
  });

  it('still disables the button when it was already selected', async () => {
    mockFindOutreachRow.mockResolvedValue({ channelId: CHANNEL, selected: true });

    const interaction = makeInteraction({ userId: APPROVER });

    await handleOutreachAddButton(interaction as never);

    const edit = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(JSON.stringify(edit.components)).toContain('"disabled":true');
  });

  it('proceeds normally when the row exists but is not selected', async () => {
    mockFindOutreachRow.mockResolvedValue({ channelId: CHANNEL, selected: false });

    const interaction = makeInteraction({ userId: APPROVER });

    await handleOutreachAddButton(interaction as never);

    expect(mockUpsertSelection).toHaveBeenCalledWith([{ channelId: CHANNEL, selected: true }]);
  });

  it('still writes when the row lookup itself fails', async () => {
    // A transient read error must not strand a legitimate approver on a button
    // that refuses to work. The write is idempotent, so attempting it is safe.
    mockFindOutreachRow.mockRejectedValue(new Error('db read failed'));

    const interaction = makeInteraction({ userId: APPROVER });

    await handleOutreachAddButton(interaction as never);

    expect(mockUpsertSelection).toHaveBeenCalledWith([{ channelId: CHANNEL, selected: true }]);
  });
});

describe('malformed ids and failures', () => {
  it('claims the id but writes nothing when it cannot be parsed', async () => {
    const interaction = makeInteraction({ userId: APPROVER, customId: `${OUTREACH_ADD_BUTTON_PREFIX}` });

    const handled = await handleOutreachAddButton(interaction as never);

    // Returning true stops interactionCreate routing it anywhere else; an
    // unreadable id must not fall through to the blast handler.
    expect(handled).toBe(true);
    expect(mockUpsertSelection).not.toHaveBeenCalled();
  });

  it('does not select a ticket the approver could not confirm', async () => {
    mockUpsertSelection.mockRejectedValue(new Error('db down'));

    const interaction = makeInteraction({ userId: APPROVER });

    await expect(handleOutreachAddButton(interaction as never)).resolves.toBe(true);

    // The click is acked (deferred) and must not throw into interactionCreate.
    expect(interaction.deferUpdate).toHaveBeenCalled();
    const edit = (interaction.editReply as jest.Mock).mock.calls[0][0];
    expect(edit.content).toMatch(/could not|try again/i);
  });

  it('does not throw when the audit log fails after a successful write', async () => {
    mockAuditLog.mockRejectedValue(new Error('audit down'));

    const interaction = makeInteraction({ userId: APPROVER });

    await expect(handleOutreachAddButton(interaction as never)).resolves.toBe(true);

    expect(mockUpsertSelection).toHaveBeenCalled();
  });
});