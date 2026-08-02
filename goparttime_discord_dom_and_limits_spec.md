# GoPartTime → Discord Task Delivery
## DOM Extraction + Discord Formatting, Message Splitting & Image Compression Specification

## 1. Mandatory AI-Agent Rule

Before changing any code:

1. Read the **entire existing codebase**.
2. Read every relevant file completely, line by line.
3. Understand the existing backend, PostgreSQL schema, Discord bot, browser extension, task lifecycle, reminders, payouts, commissions, and dashboard.
4. Identify reusable services before creating new ones.
5. Do not duplicate existing functionality.
6. Compare this specification against the actual codebase before implementation.
7. If the codebase requires a change to this plan, explain what, why, and how the intended behavior remains unchanged.
8. Do not change unrelated working functionality.
9. Implement phase by phase.
10. After every phase: **implement → test → verify → report → continue**.

Do not claim completion until the final acceptance test passes.

---

# 2. User Workflow

1. Accept tasks normally on GoPartTime.
2. Open `https://goparttime.net/my-tasks/todo`.
3. Open the task that should be assigned.
4. The extension provides:

```text
┌─────────────────┐
│  📤 Send Task   │
└─────────────────┘
```

5. Clicking it opens:

```text
Assign Task

Ticket
[ Ticket-0009 ▼ ]

Send
```

The extension determines Post vs Comment automatically from the DOM.

6. The extension extracts the task.
7. It sends one JSON payload to the backend.
8. Backend stores the task in PostgreSQL and sends it to the selected Discord ticket.
9. Existing reminder, insight, completion, payout, and commission workflows continue unchanged.

---

# 3. DOM Data Available

The supplied GoPartTime task-dialog DOM shows these fields.

## Common fields

- Task ID
- Task Type
- Deadline
- Payment
- Content

Do **not** rely on dynamically generated Radix IDs such as:

```text
radix-_r_53_
radix-_r_54_
radix-_r_55_
```

Prefer semantic labels and stable attributes.

## Task ID

Example DOM:

```html
<div class="text-muted-foreground text-sm">Task ID</div>
<div class="font-medium text-foreground text-sm">580348</div>
```

Extract:

```text
580348
```

Locate the `Task ID` label and its associated value.

## Task Type

The DOM provides:

```text
Task Type
Comment
```

or:

```text
Task Type
Post
```

Determine this automatically.

## Deadline

Example:

```text
Deadline
Jul 31 3:50 PM
```

## Payment

Example:

```text
Payment
$1.00
```

---

# 4. Post DOM

A Post exposes:

```text
Task ID
Task Type
Deadline
Payment
Subreddit
Flair
Title
Content
Content Images
```

## Subreddit

The supplied DOM contains:

```html
<input
  type="text"
  value="r/content_marketing"
  name="subreddit"
  readonly=""
>
```

Preferred selector:

```css
input[name="subreddit"]
```

## Subreddit URL

The supplied DOM does not show a separate subreddit URL.

If necessary, construct:

```text
r/content_marketing
```

→

```text
https://www.reddit.com/r/content_marketing/
```

Store both when possible.

## Flair

Example:

```html
<input
  type="text"
  value="Discussion"
  name="flair"
  readonly=""
>
```

Preferred selector:

```css
input[name="flair"]
```

Flair is optional. Missing flair must not fail extraction.

## Title

Example:

```html
<input
  type="text"
  value="..."
  name="title"
  readonly=""
>
```

Preferred selector:

```css
input[name="title"]
```

---

# 5. Content Extraction — Critical

Content is rendered as HTML.

Example:

```html
<div class="prose prose-gray max-w-none select-none rounded-lg text-foreground">
    <p>Every campaign starts with plenty of ideas.</p>
    <p>The problem starts after version one.</p>
    <p>"Can we make it shorter?"</p>
</div>
```

Extract:

```javascript
element.innerHTML
```

not merely:

```javascript
element.innerText
```

This is required to preserve:

- Bold
- Italic
- Links
- Paragraphs
- Line breaks
- Lists
- Other supported formatting

Example:

```html
<p>Hello <strong>everyone</strong></p>
<p>This is another line.</p>
```

must retain its formatting information.

---

# 6. Comment DOM

The supplied Comment DOM exposes:

```text
Task ID
Task Type
Deadline
Payment
Post Link
Content
```

Example:

```html
<input
    readonly=""
    type="text"
    value="https://www.reddit.com/r/PressOnNailHub/comments/1vbkzrf/i_like_this_new_color/"
    name="post_link"
>
```

Preferred selector:

```css
input[name="post_link"]
```

The Comment content is also HTML, for example:

```html
<div class="prose ...">
    <p>could I get this pattern?</p>
</div>
```

Extract its HTML structure.

---

# 7. Images

The supplied image-enabled Post DOM contains a `Content Images` section with `<img>` elements.

An example image contains an original GoPartTime URL in its `alt` attribute:

```html
<img
    alt="https://static.goparttime.net/img/44/f3/021eeafceb48808d559ec15adcc1f3.jpg"
    src="..."
>
```

Prefer the original image URL represented in the task metadata instead of relying on Next.js optimized URLs.

---

# 8. Image Order

Image order is mandatory.

If GoPartTime displays:

```text
Image 1
Image 2
Image 3
```

send:

```json
{
  "images": [
    {"order": 1, "url": "..."},
    {"order": 2, "url": "..."},
    {"order": 3, "url": "..."}
  ]
}
```

Preserve DOM order.

Never reorder by filename, URL, size, hash, or any other property.

---

# 9. Unified Payload

Recommended Post payload:

```json
{
  "taskId": 579470,
  "type": "post",
  "ticket": "Ticket-0009",
  "deadline": "Jul 31 3:54 PM",
  "payment": "$2.50",
  "subreddit": "r/ebikes",
  "subredditUrl": "https://www.reddit.com/r/ebikes/",
  "flair": null,
  "title": "What’s the best unexpected perk of your ebike?",
  "postLink": null,
  "contentHtml": "<p>...</p><p>...</p>",
  "images": [
    {
      "order": 1,
      "url": "https://static.goparttime.net/..."
    }
  ],
  "sourceUrl": "CURRENT_GOPARTTIME_TASK_URL"
}
```

Recommended Comment payload:

```json
{
  "taskId": 580348,
  "type": "comment",
  "ticket": "Ticket-0009",
  "deadline": "Jul 31 3:50 PM",
  "payment": "$1.00",
  "subreddit": null,
  "subredditUrl": null,
  "flair": null,
  "title": null,
  "postLink": "https://www.reddit.com/r/PressOnNailHub/comments/1vbkzrf/i_like_this_new_color/",
  "contentHtml": "<p>could I get this pattern?</p>",
  "images": [],
  "sourceUrl": "CURRENT_GOPARTTIME_TASK_URL"
}
```

---

# 10. Copy-Friendly Field Formatting

Do **not** format metadata like:

```text
Title: My example title
```

The worker should be able to select/copy the actual value without unnecessarily copying the label.

Use:

```text
Title:

My example title
```

The same principle applies to other copyable fields.

Recommended structure:

```text
Subreddit:

r/example

Flair:

Discussion

Title:

Actual title goes here

Content:

Actual content begins here...
```

The label and actual value must be visually separated by an empty line.

---

# 11. Discord 2,000-Character Constraint

Discord has a message-content character limit.

Never send a message exceeding the actual platform limit.

**Do not blindly split the final string at 1,900 or 2,000 characters.**

This is forbidden:

```text
this is th
e paragraph
```

Words must not be unnecessarily broken.

Use an internal target of approximately:

```text
1900 characters
```

to provide safety margin, while verifying the actual Discord limit during implementation.

---

# 12. Paragraph-Aware Splitting — Mandatory

Content must be split using the **original paragraph structure**.

Example source:

```html
<p>This is paragraph one.</p>
<p>This is paragraph two.</p>
<p>This is paragraph three.</p>
```

Output:

```text
This is paragraph one.

This is paragraph two.

This is paragraph three.
```

There must be an empty line between paragraphs.

If the next complete paragraph would cause the message to exceed the safe target, move the **entire paragraph** to the next Discord message.

Correct:

```text
Message 1:

Paragraph one.

Paragraph two.
```

```text
Message 2:

Paragraph three.

Paragraph four.
```

Incorrect:

```text
Message 1:

Paragraph one.

Paragraph two is cut in th
```

```text
Message 2:

e middle.
```

---

# 13. Empty Line Requirement

The empty line between paragraphs is meaningful.

Every paragraph should be separated by one visible blank line:

```text
Paragraph 1.

Paragraph 2.

Paragraph 3.
```

When content is split between messages, preserve this paragraph formatting within each message.

---

# 14. If One Paragraph Is Too Long

Only a paragraph that itself exceeds the safe message size may be split.

Use this priority:

```text
Paragraph boundary
↓
Sentence boundary
↓
Word/whitespace boundary
↓
Character boundary ONLY as an absolute last resort
```

Never unnecessarily produce:

```text
this is th
e paragraph
```

Instead, prefer:

```text
This is the first complete sentence...

This is the second complete sentence...
```

If a sentence is too large, split at a word boundary.

Do not split inside a word when a safe word boundary exists.

---

# 15. Formatting Must Survive Splitting

Do not split inside formatting syntax when a safe alternative exists.

Examples:

```text
**bold**
*italic*
[link](url)
```

The resulting Discord messages must preserve formatting as closely as Discord supports.

---

# 16. Image Size Requirement — Exact Requested Behavior

For every image:

1. Download the original.
2. Check actual file size.
3. If it is **10 MB or smaller**, send it normally.
4. If it is **larger than 10 MB**, compress it to approximately **9 MB**.
5. Preserve image order.
6. Do not unnecessarily compress images already ≤10 MB.

Example:

```text
5 MB  → unchanged
9 MB  → unchanged
10 MB → unchanged
12 MB → compress to ~9 MB
```

The implementation does not need to make every oversized image exactly 9 MB. It only needs to safely reduce it to approximately 9 MB while preserving reasonable quality.

Do not silently discard an image if compression fails.

---

# 17. Image Delivery

Treat images separately from content text.

A task may result in:

```text
Message 1 — task metadata + content
Message 2 — content continuation
Message 3 — content continuation
Image 1 attachment
Image 2 attachment
Image 3 attachment
```

Exact grouping may be optimized by the implementation, but image order must never change.

---

# 18. Discord Message IDs

One task may create multiple Discord messages.

Store all relevant Discord message IDs against the task/delivery record for:

- Retry
- Debugging
- Duplicate prevention
- Auditing
- Future message tracking

---

# 19. Duplicate Prevention

The GoPartTime Task ID must be treated as the primary external task identifier.

Before creating a task:

```text
Does this GoPartTime Task ID already exist?
```

If yes:

```text
Do not create another task.
Do not send another Discord assignment.
```

unless an explicit manager-controlled resend/retry action exists.

Do not use Ticket ID as the unique task identifier.

---

# 20. Backend Workflow

```text
Manager accepts task on GoPartTime
        ↓
Manager opens accepted task
        ↓
Task dialog opens
        ↓
Manager clicks 📤 Send Task
        ↓
Extension reads authenticated DOM
        ↓
Extract fields + original HTML + ordered images
        ↓
Manager selects Ticket
        ↓
Extension sends JSON
        ↓
Backend validates payload
        ↓
Check duplicate Task ID
        ↓
Create task in PostgreSQL
        ↓
HTML → Discord-compatible formatting
        ↓
Copy-friendly metadata formatting
        ↓
Paragraph-aware content splitting
        ↓
Preserve blank lines
        ↓
Check image sizes
        ↓
If >10 MB → compress to ~9 MB
        ↓
Send Discord messages/attachments
        ↓
Store Discord message IDs
        ↓
Log successful delivery
```

---

# 21. Existing Workflow Must Not Break

After assignment, the existing workflow must remain intact:

```text
Task Assignment
↓
Worker completes Reddit task
↓
Worker sends completed Reddit URL
↓
Dashboard receives URL
↓
Manager reviews
↓
20-hour insight reminder
↓
70-hour reminder where applicable
↓
Insight completion
↓
Completed
↓
Weekly payout
↓
Invitation commission
```

Do not rewrite these systems unless codebase inspection proves integration changes are necessary.

---

# 22. Required Database Information

First inspect the existing PostgreSQL schema.

Reuse existing fields where possible.

The system needs to retain, directly or through existing structures:

```text
GoPartTime Task ID
Ticket
Task Type
Source URL
Subreddit
Subreddit URL
Flair
Title
Post Link
Original Content HTML
Formatted Discord Content
Images metadata
Image order
Discord message IDs
Assignment timestamp
Delivery status
Delivery errors/retry information
```

Do not create duplicate columns when an equivalent field already exists.

---

# 23. Error Handling

Handle at minimum:

```text
GoPartTime DOM not ready
Task dialog not open
Task ID missing
Task type missing
Content missing
Ticket missing
Backend unavailable
Duplicate task
Image download failed
Image compression failed
Discord permission failure
Discord message too long
Discord attachment failure
```

The extension must provide a clear user-facing error.

The backend must log technical details.

Never silently fail.

---

# 24. Implementation Phases

## Phase 1 — Full Codebase Audit

### Tasks

- Read entire codebase.
- Understand backend.
- Understand PostgreSQL.
- Understand Discord bot.
- Understand extension.
- Understand task lifecycle.
- Understand reminders.
- Understand payouts.
- Understand commissions.
- Identify reusable services.

### Check

Produce:

```text
Codebase Audit
- Existing task model:
- Existing task API:
- Existing Discord service:
- Existing PostgreSQL tables:
- Existing task statuses:
- Existing reminder service:
- Existing dashboard integration:
- Existing extension structure:
- Files that must change:
- Files that should NOT change:
```

Do not proceed until complete.

---

## Phase 2 — DOM Extraction

Implement and test:

- Task ID
- Task Type
- Deadline
- Payment
- Subreddit
- Flair
- Title
- Content HTML
- Post Link
- Images
- Image order
- Current source URL

Test:

- Normal Post
- Post with no flair
- Post with one image
- Post with multiple images
- Comment

---

## Phase 3 — HTML → Discord Formatter

Preserve:

- Bold
- Italic
- Links
- Paragraphs
- Empty lines
- Supported lists

Test formatting against the supplied DOM examples.

---

## Phase 4 — Copy-Friendly Metadata

Implement:

```text
Title:

Actual title
```

not:

```text
Title: Actual title
```

Verify the actual value can be selected/copied without unnecessarily copying its label.

---

## Phase 5 — Paragraph-Aware Discord Chunker

Implement:

- ~1900-character safe target
- Paragraph-based splitting
- Empty line between paragraphs
- Sentence splitting only when one paragraph is too long
- Word splitting if a sentence is too long
- Character split only as absolute last resort
- Formatting preservation

Test:

1. Under-limit content.
2. Slightly over-limit content.
3. Many short paragraphs.
4. One paragraph over the limit.
5. Bold.
6. Italic.
7. Links.
8. Blank lines.
9. Mixed formatting.

Explicitly verify that no normal word is broken across messages.

---

## Phase 6 — Image Processing

Implement:

- Size check.
- ≤10 MB → unchanged.
- >10 MB → compress to approximately 9 MB.
- Preserve order.
- Preserve acceptable visual quality.
- Preserve transparency when required.

Test:

```text
5 MB → unchanged
9 MB → unchanged
10 MB → unchanged
12 MB → ~9 MB
Multiple images → same order
```

---

## Phase 7 — Backend Integration

Implement/reuse:

- API endpoint
- Payload validation
- Ticket validation
- Duplicate Task ID prevention
- PostgreSQL persistence
- Discord delivery trigger

Test:

```text
Extension → API → PostgreSQL → Discord
```

---

## Phase 8 — Discord Delivery

Implement:

- Metadata messages
- Formatted content chunks
- Image attachments
- Message ID storage
- Individual retry behavior
- Duplicate prevention

Verify long content, formatting, blank lines, copy-friendly titles, oversized images, and image order.

---

## Phase 9 — Regression Test

Verify existing:

- Worker assignment
- Completed Reddit URL
- Dashboard
- Insight reminders
- Insight submission
- Completion
- Weekly payout
- Invitation commissions
- Archive behavior

No regression is acceptable.

---

# 25. Final Acceptance Test

The feature is complete only when all of the following succeed:

```text
1. Log into GoPartTime normally.
2. Open /my-tasks/todo.
3. Open an accepted Post task.
4. Click 📤 Send Task.
5. Select Ticket-0009.
6. Send.
7. Extension extracts all available fields.
8. Backend receives JSON.
9. PostgreSQL stores the task.
10. HTML content is converted without losing formatting.
11. Labels are separated from copyable values.
12. Long content is split by paragraph boundaries.
13. Blank lines between paragraphs are preserved.
14. Normal words are never unnecessarily broken.
15. Oversized individual paragraphs use sentence/word boundaries.
16. Images ≤10 MB remain unchanged.
17. Images >10 MB are compressed to approximately 9 MB.
18. Image order remains exact.
19. Discord receives the complete task.
20. Discord message IDs are stored.
21. Worker sees the task in the correct ticket.
22. Existing reminders/insights/completion/payout/commission workflows still work.
23. Repeating the same GoPartTime Task ID does not create a duplicate.
```

---

# 26. Final Strict AI-Agent Instruction

**DO NOT START CODING IMMEDIATELY.**

First:

```text
READ THE WHOLE CODEBASE.
READ EVERY RELEVANT FILE COMPLETELY.
UNDERSTAND EVERY RELEVANT FUNCTION.
UNDERSTAND THE EXISTING DATABASE.
UNDERSTAND THE EXISTING DISCORD SYSTEM.
UNDERSTAND THE EXISTING EXTENSION.
UNDERSTAND THE EXISTING TASK WORKFLOW.
UNDERSTAND THE EXISTING PAYOUT SYSTEM.
UNDERSTAND THE EXISTING COMMISSION SYSTEM.
```

Then compare the actual codebase with this specification.

If a change is necessary:

1. Identify the conflict.
2. Explain why it exists.
3. Determine the safest architectural solution.
4. Preserve the intended user workflow.
5. Update the implementation plan if needed.
6. Implement only after the plan is understood.

After each phase:

```text
IMPLEMENT
↓
TEST
↓
VERIFY
↓
REPORT
↓
NEXT PHASE
```

The most important requirements are:

```text
1. Preserve original formatting.
2. Put metadata labels and values on separate lines with a blank line.
3. Make values easy to copy without the label.
4. Never unnecessarily break words.
5. Split long content by paragraph boundaries.
6. Preserve an empty line between paragraphs.
7. Only compress images larger than 10 MB.
8. Compress oversized images to approximately 9 MB.
9. Preserve image order.
10. Prevent duplicate task assignment.
11. Do not break existing task, reminder, payout, or commission functionality.
