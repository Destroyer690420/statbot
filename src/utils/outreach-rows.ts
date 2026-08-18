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
  post: boolean;
  comment: boolean;
}

/**
 * Pure builder: given per-ticket daily state plus today's tasks, produces the
 * page rows. `available` requires both a sent message and a worker reply in
 * the current cycle; `post`/`comment` derive from tasks created today in the
 * channel (assigned through the existing workflow).
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
      post: today.some((x) => x.type === 'POST'),
      comment: today.some((x) => x.type === 'COMMENT'),
    };
  });

  return rows.sort((a, b) => (a.channelName ?? '').localeCompare(b.channelName ?? ''));
}