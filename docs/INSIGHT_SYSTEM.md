# INSIGHT_SYSTEM.md — Insight (View-Data) Submission System

> Verified against `src/bot/events/messageCreate.ts`, `src/services/insight-storage.service.ts`, `src/services/reminder.service.ts`, `src/api/routes/uploads.ts`, `src/index.ts` on 2026-08-11.

---

## 1. What "Insight" Means

An insight is **view-data proof**: workers must upload a **screenshot** of a Reddit post/comment's view counts after publishing. The system asks for it at 20h (both task types) and, for POST tasks only, again at 70h. Submission happens by **replying to the bot's reminder message with an image attachment**.

## 2. Which Tasks Require What

| Task type | Required insights | Completion condition |
|---|---|---|
| COMMENT | 1 insight @ 20h (`COMMENT_20H`) | `INSIGHT_20_RECEIVED` → COMPLETED |
| POST | insights @ 20h (`POST_20H`) **and** @ 70h (`POST_70H`) | `INSIGHT_70_RECEIVED` → COMPLETED |

State transitions (see `docs/TASK_SYSTEM.md` for the diagram):
- `REMINDER_20_SENT → INSIGHT_20_RECEIVED` (both types)
- `REMINDER_70_SENT → INSIGHT_70_RECEIVED` (posts)
- Completion: `shouldComplete(status, type)` — Comment @ `INSIGHT_20_RECEIVED`, Post @ `INSIGHT_70_RECEIVED`.

## 3. Submission Process (messageCreate → handleInsightUpload)

1. Message must have image attachments; extensions allowed: `png|jpg|jpeg|webp` (`SUPPORTED_IMAGE_EXTENSIONS`, `src/utils/validators.ts`).
2. Reply must reference the reminder message: `reminderService.findByMessageId(repliedToId)` matches `Reminder.reminderMessageId` (the ID persisted by the worker after sending).
3. Guards: sender must equal `task.assignedUserId`; reminder must not already be `completed` (else "⚠️ Insight already received.").
4. `reminderService.markCompleted` (sets `completed`, `completedAt`); audit `REMINDER_COMPLETED`.
5. State advance (second status update sets COMPLETED for the done case); audit `INSIGHT_RECEIVED`.
6. **Image save (non-fatal)**: `insightStorageService.save(taskId, reminderId, attachmentUrl, filename)`; on failure, logged but the insight and completion stand.
7. Bot reacts `✅` and replies "✅ Insight received successfully.".

## 4. Storage (`src/services/insight-storage.service.ts`)

- **Local disk** (not S3): `<processCWD>/uploads/insights/<taskId>/<reminderId><ext>` (`UPLOADS_DIR = path.resolve('uploads','insights')`).
- Download from Discord CDN via global `fetch`; throws if non-OK (caller catches).
- File name = reminderId + original extension (or `.png` fallback).
- Returns the relative public URL `/api/v1/uploads/insights/<taskId>/<filename>` → stored in `Reminder.insightImageUrl` along with `insightImageName`, `insightUploadedAt` (`updateInsightImage`).
- **Serving**: `GET /api/v1/uploads/insights/:taskId/:filename` — no auth; rejects `..`/`/` in params (400); 404 if missing.

## 5. Cleanup (TTL 60h)

- `cleanup()`: deletes files with `mtime < now − 60h` (module constant `INSIGHT_TTL_MS = 60h`, hardcoded), then removes empty task dirs. Tolerates ENOENT.
- Runner: `setInterval` every **60 minutes** in `src/index.ts` (`INSIGHT_CLEANUP_INTERVAL`). Deletion can lag up to ~1h past the TTL.
- `deleteTaskDir(taskId)` exists but is **never called** anywhere (dead code).

## 6. Missing-Insight Behavior

- Reminder resent at +2h and +6h after the initial send (max 3 attempts).
- All attempts ignored → `notifyAdminOverdue` (embed + @admins/@managers in the ticket).
- After the overdue alert the task stays in `REMINDER_20_SENT`/`REMINDER_70_SENT`; no auto-cancellation. Admins can `/reschedule`, `/send-now`, or mark it cancelled/deleted manually.

## 7. Dashboard Consumption

- `TaskDetails` shows screenshots from each reminder's `insightImageUrl` (with download link).
- `Tasks` page "Download Image" fetches the latest screenshot of the task's reminders.
- Audit log keeps `INSIGHT_RECEIVED` entries with details.

## 7b. GoPartTime Consumption (Submit View, userscript v1.4.0 — 2026-08-17)

- Read-only endpoint `GET /api/v1/goparttime/insight/:externalTaskId?step=1|2` (extension key) lets the userscript fetch the stored screenshot for the GoPartTime view-data dialog.
- Resolution (`src/services/goparttime-insight.service.ts`, `resolveInsightReminder`): step 1 → the first reminder in `dueAt` order (`POST_20H`/`COMMENT_20H`); step 2 → the second (`POST_70H`, posts only — throws for comments); no step → first `sent && !completed`, else first with `insightImageUrl`, else earliest.
- **Read-only by design**: no confirm endpoint, no state changes; reminder completion still happens only via the Discord reply flow (messageCreate.ts). Manual verification by the manager is the accepted workflow (documented deviation from the original GoPartTime plan in `sending.md`).

## 8. Edge Cases

- Screenshot from a non-assigned user: silently ignored.
- Reply-with-image whose reply target matches a **delivery message** (GoPartTime) instead: handled by the URL-submission handler; images there are ignored.
- Multiple attachments: only the first attachment is saved.
- Attachment lost from CDN within 60h: `save` throws → logged; reminder still completed.
- 60h TTL means screenshots may vanish before an admin views them if a human is slow to open the dashboard (known limitation).