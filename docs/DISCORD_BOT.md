# DISCORD_BOT.md — Discord Bot

> Verified against `src/bot/**`, `src/scheduler/**`, `src/services/reminder.service.ts` on 2026-08-11.

---

## 1. Architecture

- Single `discord.js` v14 `Client` created by `createBotClient()` (`src/bot/index.ts`).
  - Intents: `Guilds`, `GuildMessages`, `MessageContent`, `GuildMembers`, `GuildInvites` (invites = invite-use tracking for the referral approval queue; bot role needs **Manage Guild** to list invites)
  - Partials: `Message`, `Channel`, `GuildMember`
- Events: `ready` (logs tag + guild count, snapshots all guild invites), `interactionCreate` → `handleInteractionCreate` (`src/bot/events/interactionCreate.ts`), `messageCreate` → `handleMessageCreate` (`src/bot/events/messageCreate.ts`), `channelCreate` → `handleChannelCreate` (`src/bot/events/channelCreate.ts`) — ticket auto-welcome + invite-ticket linking, `guildMemberAdd` → `handleGuildMemberAdd` (`src/bot/events/guildMemberAdd.ts`) — member join welcome in `#invites` + invite detection, `inviteCreate`/`inviteDelete` → `handleInviteCreate`/`handleInviteDelete` (`src/bot/events/invites.ts`) — invite cache upkeep, `error`/`warn` → logger.
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
| Anyone | — | `/status`, `/find`, `/help`, `/mystats` (own), `/myinvites` (own), `/logincode` (own) |

Permission checks are **per-command** (top of `execute()`), not centralized. `getAllAdminIds()` = admins ∪ managers (used for overdue pings and GoPartTime worker detection).

## 3. Slash Commands (15)

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
| `/mystats` | Anyone (own) + Admin/Manager lookup | Self-service worker stats, **public reply** (for ticket use). Section: This Week only (payout-week Sun–Sat IST: done posts/comments, paid ₹, pending ~₹). Paid = payout item in a paid batch (actual amounts); pending = COMPLETED tasks (all insights received) with no paid item, estimated at current rates; cancelled excluded. Optional `user` param — admins/managers only. `memberStatsService.getWorkerStats` (pure math in `utils/member-stats.ts`). Empty state when no tasks. |
| `/myinvites` | Anyone (own) + Admin/Manager lookup | Self-service inviter progress, **public reply**. Per direct invitee: mention, ticket as clickable `#ticket-name` channel mention (`no ticket yet` when null), tasks X/threshold capped at the threshold (2/2 stays 2/2 for normal, 1/1 for special — ✅ when met), bonus paid/pending; totals (invited, tickets, qualified, bonus + per-task paid/pending). Reuses `computeReferralStatus`/`getPayableItems`; commission item exists = paid (batches always `paidAt`-set). Optional `user` param — admins/managers only. Direct invites only (no indirect rows). Empty state when no referrals. |
| `/logincode` | Anyone (own) | **Ephemeral.** Issues a Worker Panel login code for people who have no ticket (pure inviters) or whose DMs are closed. Prefers a DM (`buildInviterLoginMessage`); if the DM fails it shows the code in the ephemeral reply instead and stores nothing in that case. Shares the ticket OTP guards under the `inviter:<userId>` Redis namespace. Warns when `WORKER_PORTAL_ENABLED` is off. |

All commands audit `COMMAND_USED` (user, `/<command>`) before executing; failures reply `❌ An error occurred while executing this command.` (ephemeral).

## 4. Guild Member Events (`src/bot/events/guildMemberAdd.ts`)

Member join welcome — fires on `GuildMemberAdd` (every join, bots skipped, immediate, no dedup). Resolves `#invites` channel by ID `1520616800063328437`; sends `MEMBER_WELCOME_MESSAGE` (`src/config/constants.ts` — `hey {user} please create your ticket in <#{verification}> then we can get started` with `{user}` → `<@joiner>` and `{verification}` → `1520483343018496104` as `<#1520483343018496104>`) via `channel.send`. Requires **Server Members Intent** (`GuildMembers` already enabled via `src/bot/index.ts:17`) and **Send Messages** in `#invites`. Skips `member.user.bot`.

After the welcome (best-effort, never throws): resolves the used invite via `resolveUsedInvite()` (invite-use diff vs the `ready`-time snapshot) and records an `InviteDetection` staging row (`recordJoin()` — keep-first per invitee) which **auto-approves immediately when the inviter is known** (real referral created, no manual step; unknown-inviter joins are skipped with a log + audit). See `docs/REFERRAL_SYSTEM.md` §3b.

## 4b. Invite Cache Events (`src/bot/events/invites.ts`)

`inviteCreate`/`inviteDelete` keep the per-guild invite-use snapshot fresh; `ready` re-snapshots all guilds (restart recovery). Joins during a restart gap or via vanity/OAuth resolve to unknown inviter.

## 5. Channel Events (`src/bot/events/channelCreate.ts`)

Ticket auto-welcome — fires on every `TextChannel` creation. After 2.5 s delay (3 s retry if needed) it resolves the ticket opener:

1. **Audit log path**: `guild.fetchAuditLogs({ type: ChannelCreate, limit: 5 })` — finds entry with `target.id === channel.id` created within 15 s; if executor is a non-bot non-admin/manager human, that user is tagged.
2. **Fallback — member detection**: the single `channel.members` entry that is `!bot && !isAdminOrManager`. Public channels with `0` or `>1` such members are skipped (prevents spam on admin-created / general channels). Members are fetched via `guild.members.fetch()` first; a second attempt runs 3 s later if the first is empty.

If a valid opener is found and not an admin/manager, the bot sends `TICKET_WELCOME_MESSAGE` (`src/config/constants.ts` — `Hey, {user} Can you please share your reddit profile link?` with `{user}` → `<@opener>`) via `channel.send`. Requires **View Audit Log** (for audit path; falls back gracefully) and **Send Messages** in the ticket channel.

### 5.1 Reddit profile check (new tickets)

On ticket creation the bot asks for the worker's Reddit profile and **enrolls the ticket** (`onboardingRepository.enrollProfileCheck` writes `welcomeSentAt` + `profileCheckStatus = 'PENDING'` in one upsert). The worker's first reply is then **interpreted** instead of blindly triggering the onboarding guide — that was the old behaviour and the reason a worker who typed "hi" got the guide and was never actually asked.

```
ticket created  -> welcome ("share your reddit profile link") + enroll PENDING
reply, no link  -> re-ask (capped at REDDIT_PROFILE_MAX_REASKS = 3)
reply, a link   -> Reddit lookup (src/services/reddit-profile-check.service.ts)
                     suspended        -> DM the worker "make a new account", BANNED
                     karma >= 50      -> verified line + guide, DM the approver, PASSED
                     karma <  50      -> "raise your karma" line, LOW_KARMA
                     could not check  -> retryable nudge, UNVERIFIABLE
```

**Verdicts** live in `TicketOnboarding.profileCheckStatus` (plain TEXT, no DB enum — same convention as `Task.formatCheckStatus`). `PASSED` and `BANNED` are **terminal**; `PENDING`, `LOW_KARMA` and `UNVERIFIABLE` stay actionable so a worker who fixes their karma and re-sends the link is re-checked instead of being stuck.

**NULL means "not enrolled" and the flow does not touch the ticket.** This is the safety mechanism for the ~250 tickets that predate the feature: they have no `profileCheckStatus`, so they are never re-asked. An unrecognised status string is also treated as not enrolled (fails safe). A ticket whose welcome never landed never enrolls, so it is not silently asked for a link later.

**Scope guards** (unchanged from the welcome/guide handlers): the message must come from the ticket's own worker — the single `!bot && !isAdminOrManager` `channel.members` viewer — otherwise the message falls through untouched. Staff messages, public/general channels and multi-person channels are skipped.

**The two rejection messages are deliberately different remedies.** LOW_KARMA tells the worker to raise the karma of the account they already have and that they can start hiring from it — it must never suggest creating a new account, because that is the BANNED remedy and it reads to an under-karma worker as if their working account were broken. BANNED is the only case that tells someone to make a new account.

**Karma rule**: `link_karma + comment_karma >= REDDIT_PROFILE_MIN_KARMA` (50). Award karma is excluded deliberately — it is not what subreddit AutoModerator karma filters count, so including it would let an account pass a gate its posts would still fail. Applied in exactly one place, `evaluateKarma`.

**What counts as a profile link** (`extractProfileUsername`, pure + unit-tested): a Reddit profile URL on any host, with or without a scheme, `/user/` or `/u/`, with query/fragment/trailing punctuation — or a bare `u/name`. A **post permalink, a subreddit URL, plain chat, and a bare word are all rejected** so they trigger a re-ask. A message naming **two different** profiles is treated as ambiguous and re-asked rather than guessed at, because checking the wrong account hands a real verdict to the wrong person.

**Approver**: `REDDIT_PROFILE_APPROVAL_ADMIN_ID` — a single admin, DM'd only on a pass (or on `no_session`/`session_expired`, which are our problem rather than the worker's). A single id rather than the whole staff list, because this is a personal approval request. The DM carries the ticket name, worker mention, `u/name` and karma, and asks for the ticket to be added to the daily outreach.

**Fallbacks**: the guide is sent *before* `markGuideSent` so a failed send is retried on the next message rather than lost; a worker with DMs closed gets the banned/low-karma text repeated in the ticket; a failed approver DM never rolls back a persisted verdict.

**Message consumption is deliberately asymmetric.** A **profile link is consumed** (the flow returns `true` and the handlers below are skipped) — otherwise `handleInstructionReply` would accept the profile URL as the worker's submitted post. A **re-ask is not consumed** (returns `false`): a message with no profile link may still be a 20h insight screenshot or a task submission, and a ticket can hold a live task before the worker ever shares a profile, so claiming that message would silently drop an insight upload. The re-ask is a side effect, not a claim on the message.

**Reddit access is authenticated and reused, not new.** See §5.2.

### 5.2 Why the lookup needs the vaulted session

Anonymous Reddit access does not work. Verified 2026-09-28: an unauthenticated `https://www.reddit.com/user/<name>/about.json` returns **403 with "You've been blocked by network security."**, and `old.reddit.com` is a login gate — datacenter IPs are hard-blocked. This is the same wall documented at `reddit-check.service.ts:104-110`, and it is why the dead `src/utils/check-reddit.ts` cannot work.

So the check reuses the **existing** encrypted spare-account session (`RedditSession` → `redditSessionService.loadCookie()`) rather than adding a credential. **Consequence: if the vault is unset or the session expires, the check cannot run** and every new ticket reports `UNVERIFIABLE` with a retryable nudge (plus an approver alert for `no_session`/`session_expired`).

**Only suspensions are detectable.** Reddit exposes a suspended flag through the API; a **shadowban is invisible to every authenticated view** and can only be seen in a real logged-out browser, where it is indistinguishable from a typo'd username. Detecting shadowbans would need a Playwright tab and was explicitly ruled out as too fragile. A logged-out 404 is therefore reported as `not_found`, never as `banned` — a false "your account is banned" would send a healthy worker off to make a new account.

**Verdict safety** (`hasBanMarker`, the highest-risk logic in the feature): a suspended account, a dead session cookie and Reddit's network-security block can **all** return 403. A `BANNED` verdict is therefore only ever returned when Reddit's own response says so — its `USER_BANNED` reason token, an explicit `is_suspended: true`, or the "this account has been suspended" sentence. Anything else on a non-2xx is `session_expired` / `not_found` / `rate_limited` / `error`. This is pinned by tests that feed the block page, a 403 ban, a 404 ban, a 200-with-flag, and unrelated prose mentioning bans.

**Pacing**: lookups run through a serial queue with a `REDDIT_PROFILE_MIN_INTERVAL_MS` (1.5 s) gap, because several tickets opening at once would otherwise hit the same spare account simultaneously and earn a 429. `www` then `old` host fallback, as in the format check. The username is `encodeURIComponent`-escaped. The cookie is only ever sent as a header, never in a URL, and is never logged.

### 5.3 One-off Reddit profile sweep — `scripts/ask-reddit-profile-links.ts` (NOT a live hook)

The welcome only fires when a ticket is **created**, so tickets that already existed were never asked for the profile they post from in the manager's wording. A one-off script therefore broadcasts, to every existing ticket exactly once:

`TICKET_REDDIT_PROFILE_REQUEST_MESSAGE` — `Hey {user}, please share the reddit profile link you will be posting from. if you are posting or wanna start posting, sharing your reddit profile link is mandatory.` with `{user}` → `<@worker>`.

- **No bot event is involved, and the sweep is unaffected by §5.1.** It writes only `redditProfileRequestedAt` and never `profileCheckStatus`, so swept tickets stay unenrolled and the §5.1 flow ignores them — the two features cannot collide. A **new** ticket now gets the §5.1 flow (welcome → check → verdict), not this message.
- Candidate rule is the same one used everywhere else for "who is this ticket's worker": exactly one non-bot, non-staff `channel.members` entry. `0` or `>1` candidates are **skipped with a reason** rather than tagged (an ambiguous ticket must never ping the wrong person). Only `ticket-*` channels are considered unless `--all-text-channels` is passed.
- Exactly-once is enforced in Postgres, not in memory: each successful send stamps `TicketOnboarding.redditProfileRequestedAt` and every run starts by reading the stamped channels, so a re-run after a partial failure resumes instead of re-asking. `--force` bypasses the guard.
- Decision logic is pure and unit-tested in `src/utils/reddit-profile-request.ts` (`buildProfileRequestPlan`, `formatProfileRequestMessage`, `summarizeProfileRequest`, `countSkippedByReason`); the script is only login + send + stamp. Defaults to `--concurrency 8` — under the live blast width of 12, because this script shares the app's bot token and therefore its 50 req/s budget.

## 6. Message Events (`src/bot/events/messageCreate.ts`)

Bot messages and DMs ignored. `outreachService.onWorkerMessage` runs first on every message, then the ticket guide, then two handlers in order (first that handles a message returns):

0. **`handleTicketProfileCheck`** — Reddit profile check + onboarding guide (best-effort, never blocks other handlers). Replaced the old `handleTicketGuide`; see §5.1 for the full flow. Returns `true` only when it consumed a **profile link** (so `handleInstructionReply` cannot record a profile URL as a submission); a re-ask returns `false` so a screenshot or submission in the same message still reaches the handlers below.

1. **`handleInstructionReply`** — GoPartTime URL submission:
   - Trigger: reply to a message whose ID is in a task's `deliveryMessages` (`taskRepository.findByDeliveryMessageId`).
   - Guards: author == `assignedUserId`; task `ACCEPTED|PENDING` AND `assignmentStatus === 'SENT'`.
   - Extracts Reddit URLs (regex + punctuation trim + `isValidRedditUrl`); **exactly one** required, else `❌` + prompt.
   - On success: `goparttimeService.recordSubmission` (runs the auto format check) → react `✅`, reply varies by verdict (`formatSubmissionReply`): MATCH → "✅ Submission recorded. ✅ Post matches (X/Y ¶, title OK) — ready for review."; PARA/TITLE/TEXT mismatch → "✅ Submission recorded. 🔴 Formatting mismatch (X/Y ¶). …"; FETCH_ERROR/DELETED → recorded + "⚠️ Could not verify formatting yet …"; COMMENT/no-check → "✅ Submission recorded. Waiting for manager review."
   - Errors → `❌` + warning.

2. **`handleInsightUpload`** — insight screenshots:
   - Trigger: message has an image attachment (png/jpg/jpeg/webp) AND replies to a message whose ID == some reminder's `reminderMessageId`.
   - Guards: only `assignedUserId`; reminder not already completed.
   - `markCompleted` + state advance (`REMINDER_20_SENT→INSIGHT_20_RECEIVED`, `REMINDER_70_SENT→INSIGHT_70_RECEIVED`) + possibly `COMPLETED` (`shouldComplete`: Comment @ 20h, Post @ 70h).
   - Saves image via `insightStorageService.save` (non-fatal on failure), `updateInsightImage`.
   - React `✅`, reply "✅ Insight received successfully.", audit `INSIGHT_RECEIVED`.

## 7. Reminder Messages (sent by worker — see `docs/REMINDER_SYSTEM.md`)

`channel.send({ content: '<@worker>', embeds: [reminderEmbed] })` — a mention + single embed, **no components**. Embed: "🔔 Insight Reminder" (or "🔔 Final Reminder" for POST_70H), description asks for the 20/70-hour insight, fields Task ID / Task type / Reddit (URL or "Awaiting submission"); WARNING color on retries with footer "Retry N of 3 — Reply with your screenshot." The sent message ID is persisted to `reminder.reminderMessageId` — this is what insight replies match on.

## 8. Embeds (`src/bot/embeds/index.ts`)

| Builder | Used by |
|---|---|
| `taskCreatedEmbed(task, reminderCount)` | `/task` |
| `taskStatusEmbed(task, reminders)` | `/status` |
| `taskListEmbed(title, tasks, page, totalPages)` | `/find`, `/pending`, `/completed` |
| `statsEmbed(stats)` | `/stats` |
| `workerStatsEmbed(displayName, stats)` / `inviterStatsEmbed(stats)` | `/mystats` / `/myinvites` |
| `errorEmbed` / `successEmbed` / `warningEmbed` | all |
| `helpEmbed()` | `/help` |
| `submissionInstructionEmbed(instruction)` | GoPartTime delivery (worker instruction message) |

Colors: `COLORS` in `src/config/constants.ts` (SUCCESS 0x00d26a, ERROR 0xff4757, WARNING 0xffa502, INFO 0x3742fa, PENDING 0xffc312, OVERDUE 0xff6348). Status icons: 🟡 PENDING, 🔵 reminder sent, 🟢 insight received, ✅ COMPLETED, 📦 ARCHIVED, 🗑️/❌ CANCELLED.

## 9. End-to-End Workflows

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

## 10. Edge Cases & Gotchas

- `/delete` blocks while confirmation is pending (button collector); timeout cancels.
- Insight replies must be **replies to the reminder message**; an attachment reply to anything else is ignored.
- A screenshot reply from a non-assigned user is silently ignored (message consumed, no feedback).
- Insight image save failures do **not** block completion (logged only).
- `DELETED_DETECTION_THRESHOLD_MS` (30 min) is **unused**; auto Reddit-deletion detection was removed (manual `cancelledReason` override instead).
- `/completed` and `/overdue` use `updatedAt`-based logic in places; interplay with the old auto-detection is gone.
- Command permission denial replies are ephemeral; `/task` etc. use ephemeral defer; `/status`/`/find` replies are public.
- No DM support: handlers skip messages without a guild.

## 11. Relevant Files

- Entry: `src/bot/index.ts`, `src/bot/deploy-commands.ts`
- Events: `src/bot/events/interactionCreate.ts`, `src/bot/events/messageCreate.ts`, `src/bot/events/channelCreate.ts`, `src/bot/events/guildMemberAdd.ts`
- Commands: `src/bot/commands/{task,status,find,delete,pending,completed,overdue,stats,reschedule,send-now,help,referral,mystats,myinvites,logincode}.ts`
- Embeds: `src/bot/embeds/index.ts`
- Sending: `src/scheduler/worker.ts` (reminder embeds + overdue pings)
- Permissions: `src/utils/permissions.ts`