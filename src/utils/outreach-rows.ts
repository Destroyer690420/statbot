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
  portalAccessed: boolean;
  portalLastSeenAt: string | null;
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
  portalAccessed: boolean;
  portalLastSeenAt: string | null;
}

/**
 * Pure builder: given per-ticket daily state plus today's tasks, produces the
 * page rows. `available` requires both a sent message and a worker reply in
 * the current cycle; `post`/`comment` are counts of tasks created today in the
 * channel (any status — assigned through the existing workflow, filtered by IST day).
 *
 * Counting runs in a single pass over the supplied tasks instead of one filter
 * per ticket: O(inputs + tasks) rather than O(inputs x tasks). Per-channel
 * post/comment counts are identical.
 */export function buildOutreachRows(inputs: OutreachRowInput[]): OutreachRow[] {
  // Counting is memoized per `tasksToday` array reference rather than
  // recomputed per ticket. Callers pass the same array to every row, so this
  // collapses N x M scanning into a single pass while keeping per-input
  // semantics identical (a row only ever counts tasks from its own array).
  const countsByArray = new Map<
    OutreachRowInput['tasksToday'],
    Map<string, { post: number; comment: number }>
  >();

  const countsFor = (tasksToday: OutreachRowInput['tasksToday']) => {
    let counts = countsByArray.get(tasksToday);
    if (!counts) {
      counts = new Map<string, { post: number; comment: number }>();
      for (const task of tasksToday) {
        const bucket = counts.get(task.channelId) ?? { post: 0, comment: 0 };
        if (task.type === 'POST') bucket.post++;
        else bucket.comment++;
        counts.set(task.channelId, bucket);
      }
      countsByArray.set(tasksToday, counts);
    }
    return counts;
  };

  const rows = inputs.map((t) => {
    const counts = countsFor(t.tasksToday).get(t.channelId) ?? { post: 0, comment: 0 };
    return {
      channelId: t.channelId,
      channelName: t.channelName,
      guildId: t.guildId,
      taskStatus: t.taskStatus,
      workerName: t.workerName,
      selected: t.selected,
      messageSentAt: t.messageSentAt,
      available: t.availableAt !== null && t.messageSentAt !== null,
      post: counts.post,
      comment: counts.comment,
      portalAccessed: t.portalAccessed,
      portalLastSeenAt: t.portalLastSeenAt,
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