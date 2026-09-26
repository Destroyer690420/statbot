/**
 * Shared fixtures + in-memory Prisma mock for worker-portal tests.
 * Plain data only — no service imports (test files set env first, then
 * dynamic-import the modules under test).
 */

export interface FixtureTask {
  id: string;
  type: string;
  status: string;
  channelId: string;
  channelName: string | null;
  assignedUserId: string;
  assignedUserName: string | null;
  createdAt: Date;
  updatedAt: Date;
  submittedRedditUrl?: string | null;
  submittedAt?: Date | null;
  cancelledReason?: string | null;
  assignmentStatus?: string | null;
  subreddit?: string | null;
  title?: string | null;
  redditUrl?: string | null;
  postLink?: string | null;
  commentLink?: string | null;
  externalTaskId?: string | null;
  formatCheckStatus?: string | null;
}

export interface FixtureReminder {
  id: string;
  taskId: string;
  type: string;
  dueAt: Date;
  sent: boolean;
  sentAt?: Date | null;
  completed: boolean;
  completedAt?: Date | null;
  retryCount?: number;
}

export interface FixtureItem {
  id: string;
  batchId: string;
  taskId: string;
  workerId: string;
  taskType: string;
  amount: number;
  completedAt: Date;
  createdAt: Date;
}

export interface FixtureBatch {
  id: string;
  batchNumber: number;
  weekStart: Date;
  weekEnd: Date;
  totalWorkers: number;
  totalTasks: number;
  totalPosts: number;
  totalComments: number;
  totalAmount: number;
}

export interface FixturePortalAccess {
  channelId: string;
  workerId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  updatedAt: Date;
}

export interface FixtureReferral {
  id: string;
  inviterId: string;
  inviterName: string;
  inviteeId: string;
  inviteeName: string;
  inviterType: string;
  status: string;
  oneTimeCommissionPaid: boolean;
  oneTimeCommissionPaidAt: Date | null;
  perTaskCommissionActive: boolean;
  ticketId: string | null;
  indirectSpecialInviterId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FixtureCommissionItem {
  id: string;
  batchId: string;
  referralId: string;
  inviterId: string;
  invitedWorkerId: string;
  sourceTaskId: string | null;
  commissionKind: string;
  amount: number;
  createdAt: Date;
  /** Payout week of the batch this item was paid in (drives `paidThisWeek`). */
  batchWeekStart?: Date | null;
}

export interface FixtureState {
  tasks: FixtureTask[];
  reminders: FixtureReminder[];
  items: FixtureItem[];
  batches: FixtureBatch[];
  portalAccess: FixturePortalAccess[];
  referrals: FixtureReferral[];
  commissionItems: FixtureCommissionItem[];
  postRate: number;
  commentRate: number;
}

export function fullTaskRow(t: FixtureTask): Record<string, unknown> {
  return {
    id: t.id,
    redditUrl: t.redditUrl ?? null,
    type: t.type,
    status: t.status,
    guildId: 'guild-1',
    channelId: t.channelId,
    channelName: t.channelName,
    assignedUserId: t.assignedUserId,
    assignedUserName: t.assignedUserName,
    createdById: 'admin-1',
    notes: null,
    cancelledReason: t.cancelledReason ?? null,
    source: 'goparttime',
    externalTaskId: t.externalTaskId ?? null,
    sourceUrl: 'https://goparttime.net/task',
    subreddit: t.subreddit ?? null,
    subredditUrl: null,
    flair: null,
    title: t.title ?? null,
    postLink: t.postLink ?? null,
    commentLink: t.commentLink ?? null,
    contentHtml: '<p>secret-html</p>',
    formattedContent: 'secret-formatted',
    payment: '$5.00-owner-secret',
    deadline: 'tomorrow-owner-secret',
    taskImages: [{ order: 0, url: 'https://x/y.png' }],
    deliveryMessages: [{ kind: 'instruction', order: 0, messageId: 'mid-1', createdAt: '' }],
    assignmentStatus: t.assignmentStatus ?? null,
    assignmentError: null,
    submittedRedditUrl: t.submittedRedditUrl ?? null,
    submittedAt: t.submittedAt ?? null,
    submittedBy: null,
    reviewedAt: null,
    reviewedBy: 'reviewer-secret',
    formatCheckStatus: t.formatCheckStatus ?? null,
    formatCheckDetail: null,
    formatCheckedAt: null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function matchesWhere(row: Record<string, any>, where: Record<string, any> | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    const val = row[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      if ('in' in cond) {
        if (!(cond as { in: unknown[] }).in.includes(val)) return false;
        continue;
      }
      if ('contains' in cond) {
        const needle = String((cond as { contains: string }).contains);
        const mode = (cond as { mode?: string }).mode;
        const hay = val === null || val === undefined ? '' : String(val);
        if (mode === 'insensitive') {
          if (!hay.toLowerCase().includes(needle.toLowerCase())) return false;
        } else if (!hay.includes(needle)) return false;
        continue;
      }
      if ('not' in cond) {
        if (val === (cond as { not: unknown }).not) return false;
        continue;
      }
      if ('gte' in cond || 'lte' in cond || 'gt' in cond || 'lt' in cond) {
        const c = cond as { gte?: Date; lte?: Date; gt?: Date; lt?: Date };
        if (c.gte && !(val >= c.gte)) return false;
        if (c.lte && !(val <= c.lte)) return false;
        if (c.gt && !(val > c.gt)) return false;
        if (c.lt && !(val < c.lt)) return false;
        continue;
      }
      return false;
    }
    if (cond instanceof Date) {
      if (!(val instanceof Date) || val.getTime() !== cond.getTime()) return false;
      continue;
    }
    if (val !== cond) return false;
  }
  return true;
}

function applySelect(row: Record<string, any>, select: Record<string, boolean> | undefined): Record<string, any> {
  if (!select) return row;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(select)) {
    if (v) out[k] = row[k];
  }
  return out;
}

function applyOrderBy(rows: Record<string, any>[], orderBy: Record<string, 'asc' | 'desc'> | undefined): Record<string, any>[] {
  if (!orderBy) return rows;
  const [[key, dir]] = Object.entries(orderBy);
  return [...rows].sort((a, b) => {
    const av = a[key] instanceof Date ? a[key].getTime() : a[key];
    const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    return dir === 'desc' ? (bv > av ? 1 : -1) : av > bv ? 1 : -1;
  });
}

/** Minimal in-memory Prisma mock covering exactly the queries worker code issues. */
export function createMockDb(state: FixtureState): Record<string, any> {
  const taskRows = () => state.tasks.map(fullTaskRow);
  const reminderRows = (): Record<string, any>[] =>
    state.reminders.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      type: r.type,
      dueAt: r.dueAt,
      sent: r.sent,
      sentAt: r.sentAt ?? null,
      completed: r.completed,
      completedAt: r.completedAt ?? null,
      retryCount: r.retryCount ?? 0,
      jobId: 'job-secret',
      reminderMessageId: 'rm-secret',
      insightImageUrl: 'https://secret/insight.png',
      insightImageName: 'insight.png',
      insightUploadedAt: null,
    }));
  return {
    task: {
      findMany: async (args: any = {}) => {
        let rows = taskRows().filter((r) => matchesWhere(r, args.where));
        rows = applyOrderBy(rows, args.orderBy);
        if (typeof args.take === 'number') rows = rows.slice(0, args.take);
        if (typeof args.skip === 'number') rows = rows.slice(args.skip);
        return rows.map((r) => applySelect(r, args.select));
      },
      findFirst: async (args: any = {}) => {
        let rows = taskRows().filter((r) => matchesWhere(r, args.where));
        rows = applyOrderBy(rows, args.orderBy);
        const first = rows[0] ?? null;
        return first ? applySelect(first, args.select) : null;
      },
      findUnique: async (args: any = {}) => {
        const row = taskRows().find((r) => matchesWhere(r, args.where)) ?? null;
        return row ? applySelect(row, args.select) : null;
      },
      count: async (args: any = {}) => taskRows().filter((r) => matchesWhere(r, args.where)).length,
    },
    reminder: {
      findMany: async (args: any = {}) => {
        let rows = reminderRows().filter((r) => matchesWhere(r, args.where));
        rows = applyOrderBy(rows, args.orderBy);
        if (typeof args.take === 'number') rows = rows.slice(0, args.take);
        return rows;
      },
    },
    payoutItem: {
      findMany: async (args: any = {}) => state.items.filter((i) => matchesWhere(i as any, args.where)),
      findFirst: async (args: any = {}) =>
        state.items.find((i) => matchesWhere(i as any, args.where)) ?? null,
    },
    payoutBatch: {
      findMany: async (args: any = {}) => state.batches.filter((b) => matchesWhere(b as any, args.where)),
    },
    payoutSettings: {
      findUnique: async () => ({ commentRate: state.commentRate, postRate: state.postRate }),
    },
    workerPortalAccess: {
      findMany: async (args: any = {}) =>
        state.portalAccess.filter((row) => matchesWhere(row as any, args.where)).map((row) => applySelect(row as any, args.select)),
      upsert: async (args: any) => {
        const existing = state.portalAccess.find((row) => row.channelId === args.where.channelId);
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const created = { ...args.create };
        state.portalAccess.push(created);
        return created;
      },
    },
    referral: {
      findMany: async (args: any = {}) => {
        const rows = state.referrals.filter((r) => matchesWhere(r as any, args.where));
        return applyOrderBy(rows as unknown as Record<string, any>[], args.orderBy).map((r) =>
          applySelect(r as any, args.select),
        );
      },
      findFirst: async (args: any = {}) => {
        const row = state.referrals.find((r) => matchesWhere(r as any, args.where));
        return row ? applySelect(row as any, args.select) : null;
      },
      count: async (args: any = {}) => state.referrals.filter((r) => matchesWhere(r as any, args.where)).length,
    },
    commissionItem: {
      findMany: async (args: any = {}) => {
        const rows = state.commissionItems.filter((i) => matchesWhere(i as any, args.where));
        return applyOrderBy(rows as unknown as Record<string, any>[], args.orderBy).map((i) => {
          const base = applySelect(i as any, args.select);
          if (args?.select?.batch) base.batch = { weekStart: i.batchWeekStart ?? null };
          return base;
        });
      },
      findFirst: async (args: any = {}) => {
        const row = state.commissionItems.find((i) => matchesWhere(i as any, args.where));
        return row ? applySelect(row as any, args.select) : null;
      },
    },
    commissionBatch: {
      findMany: async (args: any = {}) => state.batches.filter((b) => matchesWhere(b as any, args.where)),
      findUnique: async () => null,
      findFirst: async () => null,
    },
    commissionRates: {
      findUnique: async () => ({
        id: 'commission-rates',
        normalInviteBonus: 100,
        normalInviteTaskThreshold: 2,
        specialInviteBonus: 50,
        specialInviteTaskThreshold: 1,
        specialPerComment: 10,
        specialPerPost: 20,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        updatedBy: 'fixture',
      }),
    },
  };
}

export interface MockChannel {
  id: string;
  name: string;
  guildId: string;
  sentMessages: { content: string; allowedMentions: unknown }[];
  deletedMessages: string[];
  failSend: boolean;
  messageIds: string[];
}

export function makeMockChannel(id: string, name: string, opts?: { failSend?: boolean }): MockChannel {
  return {
    id,
    name,
    guildId: 'guild-1',
    sentMessages: [],
    deletedMessages: [],
    failSend: opts?.failSend ?? false,
    messageIds: [],
  };
}

export function channelToDiscord(channel: MockChannel): any {
  return {
    id: channel.id,
    name: channel.name,
    guildId: channel.guildId,
    isTextBased: () => true,
    send: async (args: { content: string; allowedMentions: unknown }) => {
      if (channel.failSend) throw new Error('send failed');
      channel.sentMessages.push({ content: args.content, allowedMentions: args.allowedMentions });
      const mid = `msg-${channel.id}-${channel.sentMessages.length}`;
      channel.messageIds.push(mid);
      return { id: mid };
    },
    messages: {
      fetch: async (mid: string) => ({
        delete: async () => {
          channel.deletedMessages.push(mid);
        },
      }),
    },
  };
}

export interface MockMember {
  id: string;
  username: string;
  globalName?: string | null;
  dms: string[];
  failDm?: boolean;
}

export function makeMockMember(id: string, username: string, opts?: { globalName?: string | null; failDm?: boolean }): MockMember {
  return { id, username, globalName: opts?.globalName ?? null, dms: [], failDm: opts?.failDm ?? false };
}

export function makeMockDiscordClient(channels: MockChannel[], members: MockMember[] = []): any {
  const live = new Map(channels.map((c) => [c.id, channelToDiscord(c)]));
  const guildChannels = new Map(channels.map((c) => [c.id, live.get(c.id)]));
  const memberObjects = members.map((m) => ({
    user: {
      id: m.id,
      username: m.username,
      globalName: m.globalName ?? undefined,
      bot: false,
      send: async (content: string) => {
        if (m.failDm) throw new Error('cannot send DM');
        m.dms.push(content);
        return { id: `dm-${m.id}-${m.dms.length}` };
      },
    },
    displayName: m.globalName ?? m.username,
  }));
  const membersByName = (query: string) =>
    new Map(
      memberObjects
        .filter(
          (mem) =>
            mem.user.username.toLowerCase().includes(query.toLowerCase()) ||
            String(mem.user.globalName ?? '').toLowerCase().includes(query.toLowerCase()),
        )
        .map((mem) => [mem.user.id, mem]),
    );
  return {
    channels: {
      fetch: async (id: string) => live.get(id) ?? null,
    },
    guilds: {
      cache: {
        get: (id: string) =>
          id === 'guild-1'
            ? {
                id: 'guild-1',
                channels: { cache: guildChannels, fetch: async () => guildChannels },
                members: {
                  cache: { find: (fn: (m: any) => boolean) => memberObjects.find(fn) },
                  fetch: async (opts: { query?: string }) => membersByName(opts?.query ?? ''),
                },
              }
            : undefined,
        first: () => ({
          id: 'guild-1',
          channels: { cache: guildChannels, fetch: async () => guildChannels },
          members: {
            cache: { find: (fn: (m: any) => boolean) => memberObjects.find(fn) },
            fetch: async (opts: { query?: string }) => membersByName(opts?.query ?? ''),
          },
        }),
      },
    },
  };
}

/** Recursively collect all object keys in a JSON value. */
export function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      into.add(k);
      collectKeys(v, into);
    }
  }
  return into;
}
