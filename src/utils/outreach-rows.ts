export type TicketTaskStatus = 'idle' | 'active' | 'awaiting-submission';

export interface OutreachRowInput {
  channelId: string;
  channelName: string | null;
  guildId: string;
  taskStatus: TicketTaskStatus;
  workerName: string | null;
  selected: boolean;
  messageSentAt: string | null;
  availableAt: string | null;
  tasksToday: { channelId: string; type: string }[];
}

export interface OutreachRow {
  channelId: string;
  channelName: string | null;
  guildId: string;
  taskStatus: TicketTaskStatus;
  workerName: string | null;
  selected: boolean;
  messageSentAt: string | null;
  available: boolean;
  post: number;
  comment: number;
}

/**
 * Pure builder: given per-ticket daily state plus today's tasks, produces the
 * page rows. `available` requires both a sent message and a worker reply in
 * the current cycle; `post`/`comment` are counts of tasks created today in the
 * channel (any status — assigned through the existing workflow, filtered by IST day).
 */
export function buildOutreachRows(inputs: OutreachRowInput[]): OutreachRow[] {
  const rows = inputs.map((t) => {
    const today = t.tasksToday.filter((x) => x.channelId === t.channelId);
    return {
      channelId: t.channelId,
      channelName: t.channelName,
      guildId: t.guildId,
      taskStatus: t.taskStatus,
      workerName: t.workerName,
      selected: t.selected,
      messageSentAt: t.messageSentAt,
      available: t.availableAt !== null && t.messageSentAt !== null,
      post: today.filter((x) => x.type === 'POST').length,
      comment: today.filter((x) => x.type === 'COMMENT').length,
    };
  });

  return rows.sort((a, b) => (a.channelName ?? '').localeCompare(b.channelName ?? ''));
}

/**
 * Placeholder tag workers are mentioned with in the daily outreach message.
 * Same `{user}` convention as the ticket welcome and #invites welcome.
 */
export const OUTREACH_USER_PLACEHOLDER = '{user}';

/**
 * Pure formatter: tags the ticket's worker in the daily outreach message.
 * - `{user}` placeholders are replaced with the worker mention.
 * - Messages without the placeholder get the mention prepended, so previously
 *   saved custom messages start tagging with no dashboard edit needed.
 * - Unknown worker (null) returns the message unchanged — never throws.
 */
export function formatOutreachMessage(message: string, workerId: string | null): string {
  if (!workerId) return message;
  const mention = `<@${workerId}>`;
  if (message.includes(OUTREACH_USER_PLACEHOLDER)) {
    return message.split(OUTREACH_USER_PLACEHOLDER).join(mention);
  }
  return `${mention} ${message}`;
}