# Feature Implementation Plan: GoPartTime Task → Discord Ticket Automation

## 0. Feature Objective

Build a reliable workflow that removes the manual copy/paste process
between **GoPartTime**, the **dashboard/backend**, and **Discord
tickets**.

The manager will continue accepting tasks manually on GoPartTime exactly
as they do now.

After accepting a task, the manager opens the accepted task on:

`https://goparttime.net/my-tasks/todo`

The browser extension adds a floating **📤 Send Task** button. When
clicked, the extension reads the currently open GoPartTime task, lets
the manager choose the Discord ticket, and sends the complete task data
to the existing backend.

The backend then:

1.  Validates the request.
2.  Creates the task in PostgreSQL.
3.  Associates it with the selected Discord ticket/worker.
4.  Sends a properly formatted Discord message.
5.  Uploads/attaches task images in the correct order.
6.  Stores the original task data.
7.  Logs the assignment.
8.  Starts the existing task/reminder workflow.

When the worker later replies in the assigned Discord ticket with the
completed Reddit URL, the existing Discord bot should automatically
detect and validate the URL, associate it with the correct task, save
it, and expose it in the dashboard.

The manager then reviews the submitted Reddit link and clicks **Submit**
from the dashboard.

After that, the existing reminder → insight → completion → payout →
commission workflow must continue unchanged.

------------------------------------------------------------------------

# 1. NON-NEGOTIABLE AI CODER RULE

## READ THE ENTIRE CODEBASE BEFORE WRITING CODE

This is a strict requirement.

Before implementing anything, the AI coding agent MUST:

-   Read the complete repository.
-   Read every relevant source file line by line.
-   Do not only inspect filenames.
-   Do not assume how a service works from its name.
-   Do not immediately start coding.
-   Understand the actual runtime architecture.
-   Understand every existing task lifecycle.
-   Understand the existing PostgreSQL schema.
-   Understand the existing Discord bot.
-   Understand all Discord event handlers.
-   Understand the current dashboard.
-   Understand the current API routes/controllers/services.
-   Understand authentication and authorization.
-   Understand the existing extension/Tampermonkey code if present.
-   Understand image/file handling.
-   Understand task IDs and other ID generators.
-   Understand reminder scheduling.
-   Understand insight detection.
-   Understand payout logic.
-   Understand commission/referral logic.
-   Understand archival logic.
-   Understand all existing task statuses.
-   Understand all existing database relationships.
-   Understand error handling.
-   Understand logging.
-   Understand deployment/runtime assumptions.

The agent must trace the complete flow:

``` text
Dashboard
    ↓
Backend/API
    ↓
PostgreSQL
    ↓
Discord Bot
    ↓
Discord Ticket
    ↓
Worker Reply
    ↓
Discord Event Handler
    ↓
Backend
    ↓
PostgreSQL
    ↓
Dashboard
    ↓
Existing Reminder System
    ↓
Existing Insight System
    ↓
Completed
    ↓
Payout
    ↓
Commission
```

## DO NOT blindly follow this specification

This document describes the desired behavior, not permission to ignore
the existing architecture.

After reading the codebase, the AI agent must determine:

-   whether the proposed API endpoint fits the existing API structure;
-   whether a new database table is actually necessary;
-   whether existing tables/columns can safely support the feature;
-   whether existing task statuses should be reused;
-   whether existing Discord message functions should be reused;
-   whether existing image upload logic can be reused;
-   whether the extension can reuse an existing backend authentication
    mechanism;
-   whether any part of this plan conflicts with current production
    behavior.

If the codebase reveals a better or safer implementation, the agent MUST
modify the implementation plan accordingly **before coding**.

The agent must explain:

1.  What the original plan proposed.
2.  What the existing code actually does.
3.  What must change.
4.  Why the change is necessary.
5.  How the final implementation will preserve existing functionality.

**No feature implementation should begin until the codebase has been
fully understood and the final implementation plan has been reconciled
with the existing architecture.**

------------------------------------------------------------------------

# 2. EXISTING WORKFLOW --- MUST NOT BREAK

The application already has a working task workflow.

The new feature must integrate into it rather than replace it.

Current workflow:

``` text
Manager assigns task
        ↓
Worker receives task in Discord ticket
        ↓
Worker completes Reddit task
        ↓
Worker submits completed Reddit URL
        ↓
20-hour reminder
        ↓
70-hour reminder for posts
        ↓
Worker submits insight screenshots by replying to reminder
        ↓
System validates insight submissions
        ↓
Task becomes Completed
        ↓
Weekly payout
        ↓
Referral commission
```

The new automation only replaces the manual portion:

``` text
GoPartTime
    ↓
Manager manually copies task information
    ↓
Manager opens Discord ticket
    ↓
Manager manually pastes subreddit
    ↓
Manager manually pastes title
    ↓
Manager manually pastes content
    ↓
Manager manually uploads images
```

with:

``` text
GoPartTime
    ↓
📤 Send Task
    ↓
Select Ticket
    ↓
Backend
    ↓
Discord
```

Everything after assignment must remain compatible with the existing
system.

------------------------------------------------------------------------

# 3. HIGH-LEVEL ARCHITECTURE

The feature consists of four components:

``` text
┌───────────────────────────────┐
│ GoPartTime Todo Page          │
│ /my-tasks/todo                │
└───────────────┬───────────────┘
                │
                │ DOM extraction
                ▼
┌───────────────────────────────┐
│ Browser Extension             │
│ 📤 Send Task                  │
│                               │
│ - Detect task type            │
│ - Extract task data           │
│ - Select Discord ticket       │
│ - Send authenticated request  │
└───────────────┬───────────────┘
                │
                │ HTTPS JSON
                ▼
┌───────────────────────────────┐
│ Existing Backend              │
│                               │
│ - Authenticate                │
│ - Validate                    │
│ - Deduplicate                 │
│ - Create task                 │
│ - Store task data             │
│ - Send Discord message        │
│ - Upload images               │
│ - Log assignment              │
└───────────────┬───────────────┘
                │
                ├──────────────► PostgreSQL
                │
                ▼
┌───────────────────────────────┐
│ Discord Bot                   │
│ Ticket-0009                   │
└───────────────┬───────────────┘
                │
                │ Worker completes task
                │ replies with Reddit URL
                ▼
┌───────────────────────────────┐
│ Discord Message Handler       │
│                               │
│ - Detect reply                │
│ - Detect Reddit URL           │
│ - Identify ticket             │
│ - Identify assigned task      │
│ - Validate                   │
│ - Save URL                    │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│ Dashboard                     │
│                               │
│ Completed URL                 │
│ Review                        │
│ Submit                        │
└───────────────────────────────┘
```

------------------------------------------------------------------------

# PHASE 1 --- CODEBASE AUDIT AND ARCHITECTURE MAPPING

## Objective

Understand the complete existing application before changing anything.

## Tasks

Inspect:

### Frontend

-   Dashboard architecture
-   Existing task pages
-   Task creation forms
-   Task details pages
-   Search
-   Screenshot preview
-   Payout page
-   Commission page
-   Settings
-   API client
-   Authentication
-   Existing UI components
-   Existing notification/toast system

### Backend

Identify:

-   server entry point
-   routes
-   controllers
-   services
-   middleware
-   authentication
-   authorization
-   error handling
-   logging
-   database connection
-   transactions
-   task service
-   reminder service
-   Discord service
-   payout service
-   commission service
-   referral service
-   archival service

### PostgreSQL

Document:

-   tables
-   columns
-   indexes
-   foreign keys
-   constraints
-   enum/status definitions
-   migrations
-   task relationships
-   worker relationships
-   ticket relationships
-   payout relationships
-   commission relationships

### Discord

Understand:

-   bot initialization
-   guild configuration
-   ticket naming
-   ticket IDs
-   ticket-to-worker mapping
-   message creation
-   message attachments
-   message replies
-   message event listeners
-   URL detection
-   reminder message structure

### Browser extension

Inspect:

-   Tampermonkey scripts
-   `@match`
-   `@include`
-   SPA navigation handling
-   current API communication
-   storage
-   authentication
-   DOM selectors
-   UI injection
-   error handling

### Existing task workflow

Trace exactly:

``` text
Task creation
→ Assignment
→ Discord message
→ Worker submission
→ Insight reminders
→ Insight validation
→ Completion
→ Payout
→ Commission
→ Archive
```

## Phase 1 checks

Do NOT proceed until the agent can answer:

-   Where are tasks created?
-   What uniquely identifies a task?
-   What is the existing task status model?
-   How are workers represented?
-   How are Discord tickets represented?
-   How does a Discord message identify its ticket?
-   How does the bot detect worker replies?
-   How are Reddit URLs currently stored?
-   How are reminders associated with tasks?
-   How are images currently stored?
-   How does PostgreSQL handle transactions?
-   How does the dashboard obtain task data?
-   What is the existing task ID format?
-   What prevents duplicate tasks?
-   What existing API can safely be reused?

------------------------------------------------------------------------

# PHASE 2 --- DEFINE THE DATA CONTRACT

## Objective

Create a stable contract between the browser extension and backend.

The extension should send one request containing the entire task.

Example:

``` json
{
  "taskId": 575974,
  "ticket": "ticket-0009",
  "type": "post",
  "subreddit": "r/MobileGaming",
  "subredditUrl": "https://www.reddit.com/r/MobileGaming/",
  "flair": "Discussion",
  "title": "Does Mahjong ever stop feeling confusing?",
  "content": "Every time I see Mahjong tiles...",
  "images": [
    {
      "url": "...",
      "order": 1
    },
    {
      "url": "...",
      "order": 2
    }
  ],
  "payment": 2.50
}
```

The exact contract must be adapted to the real GoPartTime DOM and
existing backend schema.

## Required fields

At minimum:

``` text
taskId
ticket
type
subreddit
subredditUrl
flair
title (post only)
content
images
payment
```

## Optional fields

Depending on actual GoPartTime task structure:

``` text
task URL
author
task deadline
additional metadata
image captions
video
attachments
external IDs
```

Do not invent fields that do not exist.

## Validation

Backend must validate:

-   task ID exists
-   task type is allowed
-   ticket exists
-   ticket belongs to the correct Discord server
-   worker/ticket mapping is valid
-   required fields exist
-   post has required post fields
-   comment has required comment fields
-   image URLs are valid
-   image order is valid
-   payment is numeric if stored
-   payload is within size limits

Never trust extension-side validation alone.

------------------------------------------------------------------------

# PHASE 3 --- DATABASE DESIGN

## Objective

Integrate the imported task into PostgreSQL without duplicating existing
task records.

The agent MUST first determine whether the existing `tasks` table
already supports all required fields.

Do not create duplicate task storage if the current schema can safely
support the feature.

## Required concepts

The database must preserve:

``` text
GoPartTime Task ID
Discord Ticket
Worker
Task Type
Task Data
Assignment Time
Reddit URL
Assignment Source
Submission Status
```

Potential fields if not already available:

``` text
source
external_task_id
assigned_at
submitted_at
reddit_url
go_part_time_url
```

## Idempotency

This is critical.

A GoPartTime task must not be assigned twice accidentally.

Use the GoPartTime task ID as the external identifier where possible.

The database must prevent duplicate assignment.

Example:

``` text
external_source = "goparttime"
external_task_id = "575974"
```

Add a unique constraint if compatible with the existing schema:

``` text
UNIQUE(source, external_task_id)
```

If the same task is sent twice:

``` text
DO NOT create another task.
DO NOT send another Discord assignment.
```

Instead return:

``` text
Task already assigned.
```

The backend may return the existing task ID and ticket so the manager
can see where it was assigned.

## Phase 3 checks

Verify:

-   Existing task records are not duplicated.
-   Existing reminders still reference the same task.
-   Existing payout logic still works.
-   Existing commission logic still works.
-   Existing archive logic still works.
-   Existing task IDs remain compatible.
-   Duplicate requests cannot create duplicate assignments.
-   Database constraints protect against duplicate assignment.

------------------------------------------------------------------------

# PHASE 4 --- BACKEND TASK-ASSIGNMENT API

## Objective

Create a backend endpoint specifically for the extension.

Suggested conceptual endpoint:

``` text
POST /api/tasks/assign-from-goparttime
```

The exact route must follow the project's existing API conventions.

## Request

Accept the validated task payload.

## Processing sequence

The backend should:

1.  Authenticate request.
2.  Authorize manager/admin access.
3.  Validate payload.
4.  Check whether task already exists.
5.  Validate ticket.
6.  Resolve worker associated with ticket.
7.  Begin database transaction.
8.  Create/import task.
9.  Store GoPartTime metadata.
10. Store assignment.
11. Commit database transaction.
12. Send Discord message.
13. Upload/attach images.
14. Save Discord message/attachment metadata if required.
15. Log the assignment.
16. Return success.

If Discord sending fails, the system must not silently claim success.

## Important transaction rule

Do not create a partially assigned task without recording the failure.

The final design must guarantee recoverability.

Possible safe pattern:

``` text
Create DB task
    ↓
Create assignment record
    ↓
Send Discord message
    ↓
Update assignment status = SENT
```

If Discord fails:

``` text
assignment status = FAILED
error stored
```

This allows retry without creating a second task.

------------------------------------------------------------------------

# PHASE 5 --- BROWSER EXTENSION

## Objective

Add a reliable floating button to the GoPartTime todo page.

Target:

``` text
https://goparttime.net/my-tasks/todo
https://goparttime.net/my-tasks/todo?page=2
```

The extension must work on task pages reached through pagination and SPA
navigation if applicable.

## UI

Add:

``` text
┌──────────────────┐
│ 📤 Send Task     │
└──────────────────┘
```

The button should:

-   be visible only on supported GoPartTime task pages;
-   not cover important page content;
-   remain usable while scrolling;
-   have a clear hover state;
-   indicate loading;
-   indicate success;
-   indicate error;
-   prevent duplicate clicks while submitting.

## Popup

When clicked:

``` text
Assign Task

Ticket
[ Ticket-0009 ▼ ]

Send
```

Task type does NOT need to be selected manually.

The extension must determine whether the task is a:

``` text
Post
```

or

``` text
Comment
```

from the actual page structure.

If the extension cannot determine the type confidently:

``` text
Do not send.
Show:
"Could not determine task type. Please verify this task."
```

Never guess.

## Ticket list

The ticket dropdown should preferably come from the backend.

Example:

``` text
GET /api/discord/tickets
```

or an existing equivalent endpoint.

Do not hardcode ticket names.

The dropdown should show only valid assignable tickets.

If the existing dashboard already has a worker/ticket endpoint, reuse
it.

------------------------------------------------------------------------

# PHASE 6 --- GO PART TIME DOM EXTRACTION

## Objective

Extract the task exactly as displayed by GoPartTime.

The extension must inspect the real DOM and identify stable selectors.

Do NOT rely only on visual position.

Do NOT assume class names are permanent.

The agent must inspect actual page HTML and find the most stable
selectors available.

## Post extraction

Extract:

``` text
Task ID
Subreddit
Subreddit URL
Flair
Title
Content
Images
Payment
Deadline if useful
Original task URL
```

## Comment extraction

Extract:

``` text
Task ID
Subreddit
Subreddit URL
Comment content
Images if present
Payment
Deadline if useful
Original task URL
```

## Content formatting

This is one of the most important requirements.

The extension must preserve the content's semantic formatting.

If GoPartTime content contains:

``` text
**bold**
```

the Discord message must preserve the equivalent formatting.

If content contains:

-   bold
-   italics
-   links
-   line breaks
-   paragraphs
-   lists
-   blank lines
-   headings
-   inline code
-   block quotes

the extraction must preserve them as accurately as possible.

## Do not use naive `.innerText` alone

If the original content is represented using HTML elements, parse the
DOM structure.

For example:

``` html
<strong>Important</strong>
```

must become the correct Discord-compatible formatting.

The exact conversion should be based on what the actual GoPartTime DOM
uses.

## Line breaks

Preserve:

``` text
line 1


line 3
```

as:

``` text
line 1


line 3
```

Do not collapse whitespace unnecessarily.

## Phase 6 checks

Test at minimum:

-   plain text
-   bold
-   italic
-   bold + italic
-   multiple paragraphs
-   blank lines
-   links
-   lists
-   special characters
-   emojis
-   long content
-   Unicode
-   content containing Markdown-like characters
-   content with HTML formatting
-   content with no formatting

The final Discord result must visually match the source content as
closely as Discord permits.

------------------------------------------------------------------------

# PHASE 7 --- IMAGE EXTRACTION AND ORDER

## Objective

Handle one or multiple task images without losing order.

If GoPartTime displays:

``` text
Image 1
Image 2
Image 3
```

Discord must receive:

``` text
Image 1
Image 2
Image 3
```

in exactly that order.

## Data model

Each image should have:

``` json
{
  "url": "...",
  "order": 1
}
```

## Important

Do not depend on asynchronous download completion order.

If downloading concurrently:

``` text
Image 3
Image 1
Image 2
```

must never happen due to network timing.

Sort by explicit `order`.

## Image handling

The backend should:

1.  Receive image URLs.
2.  Validate them.
3.  Download them server-side if required.
4.  Verify content type.
5.  Verify reasonable file size.
6.  Upload them to Discord.
7.  Preserve ordering.
8.  Handle failures gracefully.

Do not rely on the browser extension's local file system.

## If an image fails

The task assignment should not silently appear successful.

Return a clear state such as:

``` text
Task assigned but image upload failed.
```

The dashboard should allow retrying the Discord delivery without
creating a second task.

------------------------------------------------------------------------

# PHASE 8 --- DISCORD MESSAGE GENERATION

## Objective

Generate the same task message the manager currently creates manually.

The Discord message must be easy for the worker to follow.

For a post, the structure should preserve the existing expected
workflow:

``` text
subreddit
<subreddit URL>

flair
Discussion

title
Does Mahjong ever stop feeling confusing?

content
<exact formatted content>

[images in correct order]
```

The exact format must be based on the current production Discord
workflow.

## Critical rule

Do NOT create a second independent Discord formatting system if the
codebase already has one.

Reuse existing:

-   Discord message builder
-   embed builder
-   attachment uploader
-   formatting helper
-   ticket messaging service

where possible.

The new feature should call the existing functions instead of
duplicating them.

------------------------------------------------------------------------

# PHASE 9 --- TASK ↔ DISCORD TICKET MAPPING

## Objective

Make the relationship deterministic:

``` text
GoPartTime Task
        ↓
Internal Task ID
        ↓
Discord Ticket
        ↓
Worker
```

The system must store enough information to determine which task a
worker's reply belongs to.

Example:

``` text
Task #575974
Ticket: ticket-0009
Worker: worker123
```

## Important

Do not identify a task only from the worker.

One worker can have multiple tasks simultaneously.

Do not identify a task only from the ticket either.

A ticket can contain multiple tasks.

The system should use the strongest available combination, such as:

``` text
ticket + active assigned task
```

and preferably a task-specific Discord message reference.

------------------------------------------------------------------------

# PHASE 10 --- AUTOMATIC REDDIT URL DETECTION

## Objective

Remove the manager's manual copying of completed Reddit links.

The worker's expected behavior:

``` text
Done

https://www.reddit.com/r/MobileGaming/...
```

The Discord bot should detect this automatically.

## Event handling

When a new message is created in a ticket:

1.  Check whether it is from a worker.
2.  Ignore bot messages.
3.  Check whether it is in a known task ticket.
4.  Detect Reddit URL(s).
5.  Determine the relevant active task.
6.  Validate the URL.
7.  Save the URL.
8.  Record submission timestamp.
9.  Update task status appropriately.
10. Notify/update dashboard.

## Reddit URL validation

Accept legitimate Reddit URLs.

Support common forms where appropriate:

``` text
https://www.reddit.com/r/...
https://reddit.com/r/...
https://www.reddit.com/user/...
```

The exact validation should match the type of task.

For example, a post task should preferably receive a Reddit post URL
rather than only a subreddit URL.

## Do not accept arbitrary URLs as completed submissions.

------------------------------------------------------------------------

# PHASE 11 --- TASK STATUS TRANSITION

The agent must first inspect the existing task status system.

Do not blindly create new statuses if equivalent existing statuses
already exist.

Conceptually the workflow should become:

``` text
ASSIGNED
    ↓
Worker submits Reddit URL
    ↓
WAITING_FOR_SUBMISSION_REVIEW
    ↓
Manager reviews
    ↓
SUBMITTED / APPROVED
    ↓
Existing reminder workflow
```

However, the exact status names must match the existing codebase.

## Important

The user's requested dashboard behavior is:

Before worker submission:

``` text
Assigned
```

After worker submits the URL:

``` text
Waiting for Submission
```

The naming is potentially counterintuitive because the URL has already
been submitted.

Therefore, before implementation, the AI agent MUST inspect existing
status semantics and recommend a clear name such as:

``` text
Awaiting Review
```

if the current system allows it.

Do not introduce confusing status semantics just to copy this
specification literally.

------------------------------------------------------------------------

# PHASE 12 --- DASHBOARD INTEGRATION

## Objective

Show the automatically submitted Reddit URL to the manager.

Example:

``` text
Task #575974

Worker:
Ticket-0009

Completed URL:
https://www.reddit.com/r/MobileGaming/...

Status:
Awaiting Review
```

Buttons:

``` text
Open Reddit
```

and:

``` text
Submit
```

## Open Reddit

Open the saved Reddit URL.

## Submit

When the manager confirms the task:

-   validate task state;
-   ensure URL exists;
-   ensure it belongs to the task;
-   update the task using the existing submission workflow;
-   trigger any existing downstream logic;
-   do not duplicate reminders;
-   do not duplicate payout eligibility;
-   do not duplicate commission records.

## If URL is missing

The Submit button must be disabled or return:

``` text
Completed Reddit URL has not been submitted by worker.
```

------------------------------------------------------------------------

# PHASE 13 --- DUPLICATE AND RACE-CONDITION PROTECTION

This feature must be idempotent.

## Duplicate extension click

If manager clicks:

``` text
Send
Send
Send
```

quickly:

Only one task assignment should be created.

Only one Discord assignment should be sent.

## Duplicate API request

If the same request arrives twice:

``` text
POST /assign-from-goparttime
```

the backend must detect the existing external task ID.

## Duplicate Discord submission

If the worker sends the same Reddit URL multiple times:

``` text
Done
https://reddit.com/...

Done
https://reddit.com/...
```

do not create multiple submissions.

## Duplicate review

If manager clicks Submit multiple times:

Do not create duplicate completion events.

## Concurrent requests

Protect with:

-   database unique constraints;
-   transactions;
-   idempotency checks;
-   state validation.

Do not rely only on frontend button disabling.

------------------------------------------------------------------------

# PHASE 14 --- AUTHENTICATION AND SECURITY

The browser extension is an external client.

Do not create an unauthenticated endpoint.

The endpoint must require the same or equivalent secure authentication
used by the manager dashboard.

Possible implementation:

``` text
Bearer token
```

or an existing authenticated session mechanism.

The AI agent must inspect the current authentication architecture and
reuse it.

## Security rules

The endpoint must:

-   authenticate caller;
-   verify manager/admin permission;
-   validate ticket;
-   validate task payload;
-   limit request size;
-   avoid logging sensitive credentials;
-   sanitize content where appropriate;
-   prevent arbitrary Discord message sending;
-   prevent arbitrary ticket selection;
-   prevent users from assigning tasks if they lack permission.

------------------------------------------------------------------------

# PHASE 15 --- ERROR HANDLING

Every stage must provide useful errors.

## Extension errors

Examples:

``` text
Could not detect task ID.
```

``` text
Could not determine task type.
```

``` text
Could not extract task content.
```

``` text
Please select a ticket.
```

``` text
Task has already been assigned.
```

``` text
Server is unavailable.
```

## Backend errors

Examples:

``` text
Invalid task payload.
```

``` text
Ticket not found.
```

``` text
You do not have permission to assign tasks.
```

``` text
Task already exists.
```

``` text
Discord delivery failed.
```

## Discord errors

Examples:

``` text
Unable to send message to ticket.
```

``` text
Unable to upload image 2 of 3.
```

The error should be logged server-side with enough context to debug the
problem.

------------------------------------------------------------------------

# PHASE 16 --- LOGGING AND AUDIT TRAIL

Every automated assignment should be traceable.

Record:

``` text
GoPartTime Task ID
Internal Task ID
Ticket
Worker
Manager
Assignment timestamp
Task type
Discord message ID
Image upload results
Submission timestamp
Reddit URL
Review timestamp
```

If the application already has an audit/log table, reuse it.

Do not create a second logging architecture unnecessarily.

------------------------------------------------------------------------

# PHASE 17 --- RETRY MECHANISM

The system must handle partial failures.

Example:

``` text
Database task created
        ↓
Discord message failed
```

The task should not be lost.

Dashboard should show something like:

``` text
Discord Delivery: Failed
```

and provide:

``` text
Retry Send
```

Retry must:

-   reuse the existing task;
-   not create a duplicate database task;
-   not create a second external task record;
-   send the missing Discord message;
-   update delivery status.

If the original Discord message was successfully sent, retry must not
send another one unless explicitly confirmed.

------------------------------------------------------------------------

# PHASE 18 --- REMINDER INTEGRATION

The new feature must not replace the existing reminder system.

Once the task is successfully assigned, the existing reminder mechanism
should continue working.

For example:

``` text
Post
↓
20-hour insight reminder
↓
70-hour insight reminder
```

Comment:

``` text
20-hour insight reminder
```

The new GoPartTime assignment mechanism must not accidentally:

-   create duplicate reminders;
-   reset existing reminder timers;
-   create reminders before the task is actually assigned;
-   create reminders for failed assignments.

------------------------------------------------------------------------

# PHASE 19 --- PAYOUT AND COMMISSION COMPATIBILITY

The feature must not modify payout or commission calculation unless
necessary.

The existing workflow remains:

``` text
Task Completed
      ↓
Weekly payout eligibility
      ↓
Worker payout
```

and:

``` text
Task Completed
      ↓
Referral commission eligibility
```

The new task source must be compatible with the existing payout and
commission system.

The agent must explicitly verify:

-   task amount/rate is stored correctly;
-   post/comment type is correct;
-   completed status is recognized;
-   archived tasks continue to work;
-   payout does not double-count imported tasks;
-   commission does not double-count imported tasks.

------------------------------------------------------------------------

# PHASE 20 --- TESTING

Testing must be done against the real workflow.

## Test 1 --- Post without images

``` text
GoPartTime post
→ Send Task
→ Select ticket
→ Send
→ Discord
```

Verify:

-   correct task ID
-   correct subreddit
-   correct URL
-   correct flair
-   correct title
-   correct content
-   correct payment
-   correct ticket
-   correct worker
-   correct database record

## Test 2 --- Post with one image

Verify:

-   image appears
-   image is correct
-   no corruption

## Test 3 --- Post with multiple images

Test:

``` text
Image 1
Image 2
Image 3
Image 4
```

Verify exact ordering.

## Test 4 --- Comment

Verify:

-   no post-only fields are incorrectly required;
-   comment content is preserved;
-   Discord output is correct.

## Test 5 --- Formatting

Test:

``` text
Bold
Italic
Bold + italic

Multiple paragraphs


Blank lines

Links
Lists
Special characters
Emoji
```

Verify output.

## Test 6 --- Pagination

Test:

``` text
/my-tasks/todo
/my-tasks/todo?page=2
/my-tasks/todo?page=3
```

Verify the extension works consistently.

## Test 7 --- Duplicate click

Click Send repeatedly.

Expected:

``` text
1 database task
1 assignment
1 Discord message
```

## Test 8 --- Duplicate API request

Send the same payload twice.

Expected:

``` text
1 task
1 assignment
```

## Test 9 --- Worker submission

Worker replies:

``` text
Done
https://reddit.com/...
```

Verify:

-   URL detected
-   task identified
-   URL saved
-   dashboard updated

## Test 10 --- Invalid URL

Worker sends:

``` text
Done
https://google.com
```

Expected:

``` text
Not accepted as a Reddit submission.
```

## Test 11 --- Multiple active tasks

Same worker has:

``` text
Task A
Task B
Task C
```

Verify a Reddit URL is associated with the correct task using the
ticket/task context.

## Test 12 --- Discord failure

Simulate Discord API failure.

Expected:

-   task is not silently marked fully delivered;
-   error is recorded;
-   task remains recoverable;
-   retry works.

## Test 13 --- Image failure

Simulate failure for image 2 of 3.

Expected:

-   failure recorded;
-   task remains recoverable;
-   retry does not create a duplicate task.

## Test 14 --- Existing workflow regression

After automated assignment:

``` text
Assignment
→ Worker submission
→ Review
→ Insight reminder
→ Insight submission
→ Completed
→ Payout
→ Commission
```

must all work exactly as before.

------------------------------------------------------------------------

# PHASE 21 --- PRODUCTION SAFETY

Before enabling this globally:

1.  Deploy backend changes.
2.  Run database migrations.
3.  Verify migrations are reversible/safe.
4.  Deploy extension update.
5.  Test with one non-critical task.
6.  Verify Discord output.
7.  Verify database record.
8.  Verify worker submission.
9.  Verify dashboard.
10. Verify reminders.
11. Verify completion.
12. Verify payout eligibility.
13. Verify commission behavior.
14. Only then use it for normal production work.

------------------------------------------------------------------------

# PHASE 22 --- ROLLBACK PLAN

The existing manual workflow must remain available.

If automation fails:

``` text
GoPartTime
→ manually copy task
→ manually send to Discord
```

must still work.

The feature must not make manual assignment impossible.

If the extension fails:

-   backend remains operational;
-   existing dashboard task creation remains operational;
-   Discord bot remains operational;
-   existing reminders remain operational;
-   payout remains operational;
-   commission remains operational.

------------------------------------------------------------------------

# PHASE 23 --- FINAL ACCEPTANCE CRITERIA

The feature is complete only when all conditions are true.

## Assignment

-   [ ] Manager accepts tasks normally on GoPartTime.
-   [ ] No automatic task acceptance is implemented.
-   [ ] Manager opens `/my-tasks/todo`.
-   [ ] Floating Send Task button appears.
-   [ ] Button works across pagination.
-   [ ] Task type is automatically detected.
-   [ ] Ticket can be selected.
-   [ ] No manual task field copying is required.
-   [ ] Entire task is extracted automatically.
-   [ ] Formatting is preserved.
-   [ ] Images are extracted.
-   [ ] Image order is preserved.
-   [ ] Payment is captured if required.
-   [ ] Task is sent to backend as one payload.

## Backend

-   [ ] Authentication is required.
-   [ ] Authorization is enforced.
-   [ ] Payload is validated.
-   [ ] Duplicate task assignment is prevented.
-   [ ] PostgreSQL stores the task.
-   [ ] Ticket relationship is stored.
-   [ ] Worker relationship is stored.
-   [ ] Assignment is logged.
-   [ ] Discord delivery is tracked.
-   [ ] Failures are recoverable.
-   [ ] Retry does not create duplicate tasks.

## Discord

-   [ ] Correct ticket receives the task.
-   [ ] Correct formatting is preserved.
-   [ ] Correct images are sent.
-   [ ] Image order is correct.
-   [ ] Worker receives all required task information.
-   [ ] Existing Discord permissions continue working.

## Worker submission

-   [ ] Worker can reply naturally with a Reddit URL.
-   [ ] Bot detects the Reddit URL.
-   [ ] Bot associates it with the correct task.
-   [ ] URL is saved.
-   [ ] Dashboard updates automatically.
-   [ ] Duplicate submissions do not duplicate data.

## Manager review

-   [ ] Dashboard displays completed Reddit URL.
-   [ ] Open Reddit button works.
-   [ ] Manager can review the task.
-   [ ] Manager can submit/approve.
-   [ ] Existing downstream workflow starts correctly.

## Existing systems

-   [ ] Existing reminders continue working.
-   [ ] Existing insight detection continues working.
-   [ ] Existing completion logic continues working.
-   [ ] Existing worker payouts continue working.
-   [ ] Existing referral commissions continue working.
-   [ ] Existing archive logic continues working.
-   [ ] No duplicate payout records are created.
-   [ ] No duplicate commission records are created.

------------------------------------------------------------------------

# PHASE 24 --- REQUIRED IMPLEMENTATION REPORT

After implementation, the AI coding agent must provide a final report
containing:

## 1. Files inspected

List the important files that were read and explain their relevance.

## 2. Files changed

List every changed file.

For each file:

``` text
File:
Reason:
Changes:
```

## 3. Database changes

Document:

-   migrations
-   new fields
-   indexes
-   constraints
-   relationships

## 4. API changes

Document:

-   endpoint
-   request schema
-   response schema
-   authentication
-   authorization
-   error responses

## 5. Extension changes

Document:

-   page detection
-   DOM extraction
-   formatting conversion
-   image extraction
-   ticket selector
-   API request
-   error handling

## 6. Discord changes

Document:

-   message generation
-   image handling
-   reply detection
-   Reddit URL extraction
-   task matching

## 7. Tests performed

List every test and result.

## 8. Existing functionality verification

Explicitly confirm that:

``` text
Task management
Reminders
Insights
Completion
Payouts
Commissions
Archiving
```

continue to work.

## 9. Known limitations

List anything that could not be fully automated and explain why.

------------------------------------------------------------------------

# FINAL STRICT RULE

**DO NOT START BY CODING.**

First:

``` text
READ THE WHOLE CODEBASE
        ↓
READ EVERY RELEVANT FILE LINE BY LINE
        ↓
UNDERSTAND EVERY EXISTING FLOW
        ↓
TRACE DATA FROM FRONTEND → BACKEND → DATABASE → DISCORD
        ↓
UNDERSTAND TASK / REMINDER / INSIGHT / PAYOUT / COMMISSION LIFECYCLES
        ↓
COMPARE THE EXISTING ARCHITECTURE WITH THIS SPECIFICATION
        ↓
IDENTIFY CONFLICTS OR MISSING INFORMATION
        ↓
MODIFY THIS PLAN WHERE NECESSARY
        ↓
PRESENT THE FINAL IMPLEMENTATION PLAN
        ↓
ONLY THEN WRITE CODE
```

The goal is **not** to make the code match this document blindly.

The goal is to implement the requested behavior correctly within the
existing production architecture.

If the agent discovers that a proposed implementation would:

-   break existing tasks;
-   break reminders;
-   break Discord;
-   duplicate tasks;
-   duplicate submissions;
-   duplicate payouts;
-   duplicate commissions;
-   lose formatting;
-   lose images;
-   create inconsistent database state;
-   bypass authentication;
-   create race conditions;
-   or otherwise introduce a regression,

the agent MUST stop, explain the problem, and revise the implementation
approach before continuing.

**Existing working functionality has priority over blindly following
this document.**

The final implementation must be:

-   reliable;
-   idempotent;
-   transaction-safe;
-   auditable;
-   recoverable after failures;
-   compatible with PostgreSQL;
-   compatible with the existing Discord bot;
-   compatible with the existing dashboard;
-   compatible with the existing reminder/insight system;
-   compatible with payout and commission systems;
-   and safe to use in production.
