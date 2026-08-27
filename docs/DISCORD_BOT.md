# DISCORD_BOT.md — Discord Bot

> Verified against `src/bot/**`, `src/scheduler/**`, `src/services/reminder.service.ts` on 2026-08-11.

---

## 1. Architecture

- Single `discord.js` v14 `Client` created by `createBotClient()` (`src/bot/index.ts`).
  - Intents: `Guilds`, `GuildMessages`, `MessageContent`, `GuildMembers`
  - Partials: `Message`, `Channel`
- Events: `ready` (logs tag + guild count), `interactionCreate` → `handleInteractionCreate` (`src/bot/events/interactionCreate.ts`), `messageCreate` → `handleMessageCreate` (`src/bot/events/messageCreate.ts`), `channelCreate` → `handleChannelCreate` (`src/bot/events/channelCreate.ts`) — ticket auto-welcome, `error`/`warn` → logger.
- `startBot()` = `client.login(env.DISCORD_TOKEN)`.
- The **same client instance** is handed to `initializeWorker(discordClient)` so the BullMQ worker sends reminder messages on the bot's gateway connection.
- **Guild-scoped commands only**: deployed via `Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)` in `src/bot/deploy-commands.ts` (run `npm run deploy-commands` after command edits).
- One Discord server (`GUILD_ID`); tickets are text channels; a task lives in the ticket channel where it was created.

## 2. Permissions Model

`src/utils/permissions.ts` reads comma-separated env IDs; `getPermissionDeniedMessage()` returns `'❌ You do not have permission to use this command.'`.

| Role | Env | Bot usage |
|---|---|---|
| Admin | `ADMIN_USER_IDS` | full command access |
| Manager | `MANAGER_USER_IDS` | `isAdminOrManager` commands |
| Anyone | — | `/status`, `/find`, `/help` |

Permission checks are **per-command** (top of `execute()`), not centralized. `getAllAdminIds()` = admins ∪ managers (used for overdue pings and GoPartTime worker detection).

## 3. Slash Commands (12)

| Command | Permission | Summary |
|---|---|---|
| `/task` | Admin/Manager | Create manual task. Options: `task_id` (required, uppercased), `reddit_url` (required), `type` (Post/Comment), `ticket` (channel, optional—defaults to current channel), `assigned_user` (optional—auto-detect single non-bot, non-admin member in channel), `notes` ≤500. Creates task (PENDING) + reminders + schedules BullMQ jobs; ephemeral confirmation embed. |
| `/status` | Anyone | Task status + reminder timeline embed. Non-terminal tasks show CANCELLED with "Deleted"/"Deleted Later" suffix depending on `cancelledReason`. |
| `/find` | Anyone | Search: `task_id` (exact), `status` (7 choices, uses DB value), `type`, `user`, `ticket` (channel), `reddit_url` (partial, case-insensitive), `page` (1–50, default 1). Fetches 21 to detect more; default excludes ACCEPTED. Newest first. |
| `/delete` | Admin | Delete task with interactive confirmation buttons (`delete-confirm-<id>` danger / `delete-cancel-<id>`), 30s timeout, only invoker may click. Cancels BullMQ jobs first, then transaction-deletes reminders + task. |
| `/pending` | Admin | Lists tasks in `PENDING/REMINDER_20_SENT/INSIGHT_20_RECEIVED/REMINDER_70_SENT/INSIGHT_70_RECEIVED` (guild-filtered), oldest first, top 20. |
| `/completed` | Admin | `period` choice (today/7days/30days/all, default 7days) → COMPLETED tasks via `updatedAt` filter, top 20. |
| `/overdue` | Admin | Tasks in `REMINDER_20_SENT`/`REMINDER_70_SENT`; per task finds the waiting reminder (`sent && !completed`), sorts longest-overdue first, top 20, embed in OVERDUE color; empty state "No overdue tasks! 🎉". |
| `/stats` | Admin/Manager | 13 stat fields from `analyticsService.getStats(guildId)` (Total, Pending, Completed, Cancelled, Overdue, Completion Rate, Avg Completion Time, Tasks Today, Today's Posts/Comments/Deleted, Total Deleted, Tasks This Week). |
| `/reschedule` | Admin/Manager | `task_id`, `reminder` (20h/70h choice matched by **substring** `type.includes('20H'|'70H')`), `hours` (1–168). Cancels old job, `dueAt = now + hours`, resets sent flags, reschedules. Note: a `70h` choice on a Comment task (which only has `COMMENT_20H`) → "Reminder not found for this task." |
| `/send-now` | Admin/Manager | `task_id`, `reminder` (20h/70h). Cancels main + retry jobs, sets `dueAt = now`, fires immediately (delay 0). Requires task non-terminal and reminder not completed. |
| `/help` | Anyone | Ephemeral help embed for all commands ("🔒 = Admin only"). |
| `/referral add` | Admin | `inviter` (user, required), `invitee` (user, required), `ticket` (string, required, e.g. `ticket-0036` or `#channelId`). Rejects `inviter.id === invitee.id`. Inviter type from **hardcoded list** `SPECIAL_INVITER_IDS = ['582595416294555649','1202294567706316911','1506900129792135211']` → `special`, else `normal`. Resolves ticket name via `guild.channels.fetch`. Calls `commissionService.createReferral`. |

All commands audit `COMMAND_USED` (user, `/<command>`) before executing; failures reply `❌ An error occurred while executing this command.` (ephemeral).

## 4. Channel Events (`src/bot/events/channelCreate.ts`)

Ticket auto-welcome — fires on every `TextChannel` creation. After 2.5 s delay (3 s retry if needed) it resolves the ticket opener:

1. **Audit log path**: `guild.fetchAuditLogs({ type: ChannelCreate, limit: 5 })` — finds entry with `target.id === channel.id` created within 15 s; if executor is a non-bot non-admin/manager human, that user is tagged.
2. **Fallback — member detection**: the single `channel.members` entry that is `!bot && !isAdminOrManager`. Public channels with `0` or `>1` such members are skipped (prevents spam on admin-created / general channels). Members are fetched via `guild.members.fetch()` first; a second attempt runs 3 s later if the first is empty.

If a valid opener is found and not an admin/manager, the bot sends `TICKET_WELCOME_MESSAGE` (`src/config/constants.ts` — `Hey, {user} Can you please share your reddit profile link?` with `{user}` → `<@opener>`) via `channel.send`. Requires **View Audit Log** (for audit path; falls back gracefully) and **Send Messages** in the ticket channel.

## 5. Message Events (`src/bot/events/messageCreate.ts`)

Bot messages and DMs ignored. Two handlers run in order; the first that handles a message returns:

1. **`handleInstructionReply`** — GoPartTime URL submission:
   - Trigger: reply to a message whose ID is in a task's `deliveryMessages` (`taskRepository.findByDeliveryMessageId`).
   - Guards: author == `assignedUserId`; task `ACCEPTED|PENDING` AND `assignmentStatus === 'SENT'`.
   - Extracts Reddit URLs (regex + punctuation trim + `isValidRedditUrl`); **exactly one** required, else `❌` + prompt.
   - On success: `goparttimeService.recordSubmission` → react `✅`, reply "✅ Submission recorded. Waiting for manager review."
   - Errors → `❌` + warning.

2. **`handleInsightUpload`** — insight screenshots:
   - Trigger: message has an image attachment (png/jpg/jpeg/webp) AND replies to a message whose ID == some reminder's `reminderMessageId`.
   - Guards: only `assignedUserId`; reminder not already completed.
   - `markCompleted` + state advance (`REMINDER_20_SENT→INSIGHT_20_RECEIVED`, `REMINDER_70_SENT→INSIGHT_70_RECEIVED`) + possibly `COMPLETED` (`shouldComplete`: Comment @ 20h, Post @ 70h).
   - Saves image via `insightStorageService.save` (non-fatal on failure), `updateInsightImage`.
   - React `✅`, reply "✅ Insight received successfully.", audit `INSIGHT_RECEIVED`.

## 6. Reminder Messages (sent by worker — see `docs/REMINDER_SYSTEM.md`)

`channel.send({ content: '<@worker>', embeds: [reminderEmbed] })` — a mention + single embed, **no components**. Embed: "🔔 Insight Reminder" (or "🔔 Final Reminder" for POST_70H), description asks for the 20/70-hour insight, fields Task ID / Task type / Reddit (URL or "Awaiting submission"); WARNING color on retries with footer "Retry N of 3 — Reply with your screenshot." The sent message ID is persisted to `reminder.reminderMessageId` — this is what insight replies match on.

## 7. Embeds (`src/bot/embeds/index.ts`)

| Builder | Used by |
|---|---|
| `taskCreatedEmbed(task, reminderCount)` | `/task` |
| `taskStatusEmbed(task, reminders)` | `/status` |
| `taskListEmbed(title, tasks, page, totalPages)` | `/find`, `/pending`, `/completed` |
| `statsEmbed(stats)` | `/stats` |
| `errorEmbed` / `successEmbed` / `warningEmbed` | all |
| `helpEmbed()` | `/help` |
| `submissionInstructionEmbed(instruction)` | GoPartTime delivery (worker instruction message) |

Colors: `COLORS` in `src/config/constants.ts` (SUCCESS 0x00d26a, ERROR 0xff4757, WARNING 0xffa502, INFO 0x3742fa, PENDING 0xffc312, OVERDUE 0xff6348). Status icons: 🟡 PENDING, 🔵 reminder sent, 🟢 insight received, ✅ COMPLETED, 📦 ARCHIVED, 🗑️/❌ CANCELLED.

## 8. End-to-End Workflows

### Manual task (`/task` admin/manager)
```
/task (ticket channel) → validate → Task PENDING + Comment(1)/Post(2) reminders → BullMQ jobs
→ worker posts on Reddit → worker replies "Insight reminder" screenshots at 20h (70h for posts)
→ COMPLETED → payout (dashboard)
```

### GoPartTime task
```
userscript assigns → Task ACCEPTED, assignmentStatus PENDING
→ bot posts metadata/content/images/instruction into the ticket → SENT
→ worker replies to instruction message with the Reddit URL (exactly one)
→ manager clicks Done (dashboard/Mark as Done) → ACCEPTED→PENDING, reminders scheduled
→ same reminder flow as manual tasks
```

### Overdue
```
reminder unanswered after 3 sends (initial @dueAt, +2h, +6h) OR worker failure
→ notifyAdminOverdue: embed "⚠️ Overdue Task" @mention admins + managers in the ticket
```

## 9. Edge Cases & Gotchas

- `/delete` blocks while confirmation is pending (button collector); timeout cancels.
- Insight replies must be **replies to the reminder message**; an attachment reply to anything else is ignored.
- A screenshot reply from a non-assigned user is silently ignored (message consumed, no feedback).
- Insight image save failures do **not** block completion (logged only).
- `DELETED_DETECTION_THRESHOLD_MS` (30 min) is **unused**; auto Reddit-deletion detection was removed (manual `cancelledReason` override instead).
- `/completed` and `/overdue` use `updatedAt`-based logic in places; interplay with the old auto-detection is gone.
- Command permission denial replies are ephemeral; `/task` etc. use ephemeral defer; `/status`/`/find` replies are public.
- No DM support: handlers skip messages without a guild.

## 10. Relevant Files

- Entry: `src/bot/index.ts`, `src/bot/deploy-commands.ts`
- Events: `src/bot/events/interactionCreate.ts`, `src/bot/events/messageCreate.ts`, `src/bot/events/channelCreate.ts`
- Commands: `src/bot/commands/{task,status,find,delete,pending,completed,overdue,stats,reschedule,send-now,help,referral}.ts`
- Embeds: `src/bot/embeds/index.ts`
- Sending: `src/scheduler/worker.ts` (reminder embeds + overdue pings)
- Permissions: `src/utils/permissions.ts`