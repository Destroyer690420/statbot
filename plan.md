# 00 - Project Vision

## Project

**Name:** Reddit Task Manager

**Type:** Discord Bot

**Goal:** Automate Reddit task tracking and insight reminders.

---

# Problem

Current workflow is manual.

- Track task times
- Remember reminder times
- Find ticket
- Ask for insights
- Verify completion

This doesn't scale.

---

# Solution

A Discord bot that:

- Stores every Reddit task
- Schedules reminders
- Sends reminders automatically
- Tracks insight uploads
- Maintains task history
- Provides search & analytics

---

# Users

## Admin

- Create tasks
- View status
- Manage tasks
- View analytics

## Employee

- Receive reminders
- Upload insights
- Complete tasks

---

# Core Workflow

```text
Create Task
    ↓
Save Task
    ↓
Schedule Reminder(s)
    ↓
Send Reminder
    ↓
Employee Uploads Insight
    ↓
Mark Complete
    ↓
Archive
```

---

# Scope

## Included

- Discord Bot
- PostgreSQL
- Prisma
- Scheduler
- REST API
- Dashboard
- Analytics
- Logging

## Excluded (v1)

- Reddit API
- AI Image Verification
- Payroll
- Mobile App

---

# Core Entity

Everything revolves around **Task**.

```text
Task
├── Reddit URL
├── Type
├── Ticket
├── Assigned User
├── Reminders
├── Status
└── Insights
```

No feature should bypass the Task entity.

---

# Development Rules

- TypeScript only
- Modular architecture
- SOLID principles
- Validate all inputs
- No duplicate code
- No breaking changes
- Production-ready code
- Environment variables only
- Error handling required
- Structured logging

---

# Success Criteria

- No manual reminder tracking
- Automatic reminders
- Automatic completion tracking
- Searchable task history
- Survives restart
- Easily extensible

---

# Future

Architecture must support:

- Multi-server
- Multiple admins
- Custom reminder intervals
- Employee analytics
- Client dashboard
- Export (CSV/Excel)
- AI verification

---

# Deliverable

A scalable Reddit task management platform, not just a reminder bot.

# 02-03 Database & Slash Commands

## Goal

Design the database and implement all core Discord slash commands.

---

# Database

## Task

```ts
Task {
  id              String      @id
  redditUrl       String
  type            POST | COMMENT
  status          TaskStatus

  guildId         String
  channelId       String

  assignedUserId  String
  createdById     String

  notes           String?

  createdAt       DateTime
  updatedAt       DateTime

  reminders       Reminder[]
}
```

---

## Reminder

```ts
Reminder {
  id            String      @id

  taskId        String

  type          ReminderType
  dueAt         DateTime

  sent          Boolean
  completed     Boolean

  sentAt        DateTime?
  completedAt   DateTime?

  task          Task
}
```

---

## Enums

### TaskType

```ts
POST
COMMENT
```

### TaskStatus

```ts
PENDING
IN_PROGRESS
COMPLETED
ARCHIVED
CANCELLED
```

### ReminderType

```ts
POST_20H
POST_70H
COMMENT_20H
```

---

# Relations

```
Task
   │
   ├── 1
   │
   ▼
Reminder
```

One task can have multiple reminders.

---

# Validation

Reddit URL

- Required
- Valid reddit.com URL only

Ticket Channel

- Required
- Must exist

Assigned User

- Required
- Must be server member

Notes

- Optional
- Max 500 chars

---

# Slash Commands

Implement:

```
/task
/status
/find
/delete
/help
```

---

# /task

Creates a new Reddit task.

Options

```
reddit_url      (Required)
type            (Post/Comment)
ticket          (Channel)
assigned_user   (User)
notes           (Optional)
```

Flow

```
Validate Input
        ↓
Create Task
        ↓
Generate Reminder(s)
        ↓
Save to Database
        ↓
Return Success Embed
```

Reminder creation

```
Comment
└── 20 Hours

Post
├── 20 Hours
└── 70 Hours
```

---

# Success Embed

```
✅ Task Created

Task ID

Type

Assigned User

Ticket

Reminder Count

Status
```

---

# /status

Input

```
task_id
```

Return

```
Task

Status

Created

Assigned User

Reminder Status

Next Reminder
```

---

# /find

Filters

```
Task ID

Assigned User

Status

Type

Ticket

Reddit URL
```

Support partial URL search.

Return max 10 results.

---

# /delete

Input

```
task_id
```

Behavior

```
Delete Task

Delete Reminders

Log Action
```

Confirmation required.

---

# /help

Displays

```
Commands

Usage

Examples
```

---

# Error Handling

Invalid URL

```
❌ Invalid Reddit URL.
```

Task not found

```
❌ Task not found.
```

Permission denied

```
❌ You do not have permission.
```

Duplicate task

```
❌ This Reddit URL already exists.
```

Database error

```
❌ Internal server error.
```

---

# Permissions

Only Admin roles can use

```
/task

/delete
```

Everyone can use

```
/status

/find

/help
```

---

# Logging

Log

- Task Created
- Task Deleted
- Command Used
- Validation Failed
- Database Error

Never log secrets.

---

# Acceptance Criteria

- Prisma schema complete.
- Migrations created.
- Database connected.
- CRUD implemented.
- Slash commands registered.
- Validation complete.
- Duplicate tasks prevented.
- Success/error embeds implemented.
- No TypeScript or ESLint errors.

# 04-06 Scheduler, Reminder System & Insight Tracking

## Goal

Automatically schedule reminders, send them, and detect uploaded insights.

---

# Scheduler

Use:

- BullMQ
- Redis

Requirements

- Persistent jobs
- Survive restarts
- No duplicate jobs
- Automatic retry
- Configurable concurrency

---

# Job Creation

When a task is created:

### Comment

```
20 Hours
```

Create:

```
COMMENT_20H
```

---

### Post

Create:

```
POST_20H

POST_70H
```

Jobs are created immediately after the task is saved.

---

# Job Flow

```
Task Created
      ↓
Create Reminder Jobs
      ↓
Store Job IDs
      ↓
Wait
      ↓
Execute Job
      ↓
Send Reminder
      ↓
Update Database
```

---

# Job Validation

Before sending:

- Task exists
- Task not cancelled
- Reminder not completed
- Reminder not already sent

Otherwise cancel the job.

---

# Reminder Message

## Comment (20h)

```
🔔 Insight Reminder

Please upload the 20-hour insight.

Task: Comment

Reddit:
<url>

Reply with the screenshot in this ticket.
```

---

## Post (20h)

```
🔔 Insight Reminder

Please upload the 20-hour insight.

Task: Post

Reddit:
<url>
```

---

## Post (70h)

```
🔔 Final Reminder

Please upload the 70-hour insight.

Task: Post

Reddit:
<url>
```

---

# After Sending

Update

```
sent = true

sentAt = now()
```

---

# Message Tracking

Listen for

```
messageCreate
```

Ignore

- Bots
- Empty messages
- Messages outside tracked tickets

---

# Attachment Detection

Accept if

```
attachments > 0
```

Supported

- png
- jpg
- jpeg
- webp

Ignore all other files.

---

# Completion Logic

Find active reminder.

If waiting for

```
COMMENT_20H
```

↓

Complete comment.

---

If waiting for

```
POST_20H
```

↓

Complete first reminder.

Wait for 70h reminder.

---

If waiting for

```
POST_70H
```

↓

Complete task.

---

# Database Updates

Reminder

```
completed = true

completedAt = now()
```

Task

```
updatedAt = now()
```

If last reminder completed

```
status = COMPLETED
```

---

# Bot Response

React

```
✅
```

Reply

```
Insight received successfully.
```

---

# Duplicate Upload

If reminder already completed

```
⚠️ Insight already received.
```

Do not overwrite timestamps.

---

# Missing Reminder

If no pending reminder exists

Ignore message.

---

# Reminder Retry

If reminder not completed

Retry

```
+2 Hours

+6 Hours
```

Maximum

```
3 reminders
```

After final retry

Notify admins.

---

# Admin Alert

```
⚠️ Overdue Task

Assigned:
<User>

Task:
<ID>

Reminder:
20H / 70H

Ticket:
<#channel>
```

---

# Failure Handling

Retry if

- Discord API fails
- Redis reconnects
- Temporary database error

Cancel if

- Task deleted
- Reminder completed
- Task cancelled

---

# Logging

Log

- Job Created
- Job Executed
- Reminder Sent
- Retry Sent
- Insight Received
- Task Completed
- Admin Alert
- Job Failed

---

# Acceptance Criteria

- BullMQ configured.
- Jobs persist after restart.
- Correct reminders created.
- Duplicate jobs prevented.
- Reminder messages sent.
- Attachments detected.
- Insights marked complete.
- Retry system works.
- Admin alerts work.
- No TypeScript or ESLint errors.

# 07-10 State Machine, Search, Admin Commands & REST API

## Goal

Implement task lifecycle, search, admin tools, and REST API.

---

# Task State Machine

```
PENDING
    ↓
REMINDER_20_SENT
    ↓
INSIGHT_20_RECEIVED
    ↓
REMINDER_70_SENT (Post Only)
    ↓
INSIGHT_70_RECEIVED
    ↓
COMPLETED
    ↓
ARCHIVED
```

Comment Flow

```
PENDING
    ↓
REMINDER_20_SENT
    ↓
COMPLETED
```

Invalid transitions are not allowed.

---

# Allowed Actions

| State | Allowed |
|--------|---------|
| PENDING | Cancel |
| REMINDER_20_SENT | Upload |
| INSIGHT_20_RECEIVED | Wait / Send 70h |
| REMINDER_70_SENT | Upload |
| COMPLETED | Archive |
| ARCHIVED | Read Only |
| CANCELLED | Read Only |

---

# /find

Filters

```
Task ID
Status
Type
Assigned User
Ticket
Reddit URL
Date Range
```

Requirements

- Partial URL search
- Multiple filters
- Max 20 results
- Paginated embeds

---

# /pending

Show

```
Pending Tasks

Overdue

Waiting 20h

Waiting 70h
```

---

# /completed

Filters

```
Today

7 Days

30 Days

Custom
```

---

# /overdue

Show

```
Task

Assigned User

Ticket

Overdue Time

Reminder Type
```

Sorted by longest overdue.

---

# /stats

Display

```
Total Tasks

Pending

Completed

Cancelled

Overdue

Completion %

Avg Completion Time

Tasks Today

Tasks This Week
```

---

# /reschedule

Inputs

```
Task ID

Reminder

New Time
```

Requirements

- Delete old job
- Create new BullMQ job
- Update database
- Log action

---

# Permissions

Admin Only

```
/pending
/completed
/overdue
/stats
/reschedule
/delete
/task
```

Everyone

```
/status
/find
/help
```

---

# REST API

Base

```
/api/v1
```

---

## Auth

JWT

Protected routes only.

---

## Endpoints

### Tasks

```
GET    /tasks
GET    /tasks/:id
POST   /tasks
PATCH  /tasks/:id
DELETE /tasks/:id
```

---

### Reminders

```
GET /tasks/:id/reminders
PATCH /reminders/:id
```

---

### Stats

```
GET /stats
```

---

### Health

```
GET /health
```

Returns

```
status

uptime

version

database

redis
```

---

# Validation

Every request

- Validate body
- Validate params
- Validate query
- Return proper HTTP status

---

# HTTP Codes

```
200 OK

201 Created

400 Bad Request

401 Unauthorized

403 Forbidden

404 Not Found

409 Conflict

500 Internal Error
```

---

# Response Format

Success

```json
{
  "success": true,
  "data": {}
}
```

Error

```json
{
  "success": false,
  "message": ""
}
```

---

# Logging

Log

- API Request
- API Error
- State Change
- Command Usage
- Permission Denied
- Reschedule
- Search Query

---

# Acceptance Criteria

- State machine enforced.
- Invalid transitions blocked.
- Search supports all filters.
- Admin commands operational.
- JWT authentication working.
- REST API complete.
- Standard responses returned.
- Health endpoint functional.
- No TypeScript or ESLint errors.

# 11-15 Dashboard, Analytics & Quality

## Goal

Build admin dashboard, analytics, reporting, and production improvements.

---

# Dashboard

Stack

- React
- Vite
- TailwindCSS
- React Query
- Axios

---

# Pages

```
Dashboard
Tasks
Task Details
Analytics
Settings
Login
404
```

---

# Dashboard

Cards

```
Total Tasks
Pending
Completed
Overdue
Today's Tasks
Completion Rate
```

Tables

```
Recent Tasks
Upcoming Reminders
Overdue Tasks
```

---

# Tasks Page

Features

- Search
- Filter
- Sort
- Pagination

Filters

```
Status
Type
Assigned User
Date
```

Actions

```
View
Edit
Delete
Reschedule
```

---

# Task Details

Show

```
Task Info
Assigned User
Ticket
Reddit URL
Status
Reminder History
Activity Log
```

---

# Analytics

Cards

```
Tasks Today
Tasks This Week
Tasks This Month

Completion %

Avg Completion Time

Overdue

Cancelled
```

Charts

```
Tasks / Day
Completion Trend
Task Type
Employee Performance
```

---

# Settings

```
Reminder Delays
Retry Delays
Admin Roles
Dashboard Theme
```

---

# Authentication

- JWT
- Protected Routes
- Auto Logout
- Token Refresh

---

# Analytics Engine

Calculate

```
Tasks Created

Tasks Completed

Pending

Cancelled

Overdue

Completion %

Average Completion Time

Average Response Time

Most Active Employee

Tasks Per Day

Tasks Per Week

Tasks Per Month
```

---

# Reports

Support

```
CSV

Excel
```

Filters

```
Date

Status

Employee

Task Type
```

---

# Auto Archive

Archive

```
Completed >30 Days

Cancelled >30 Days
```

Keep searchable.

---

# Logging

Store

```
Task Created

Reminder Sent

Retry

Insight Uploaded

Task Completed

Deleted

Login

API Error
```

---

# Error Handling

Handle

- Database
- Redis
- Discord API
- Validation
- Network
- Authentication

Return user-friendly errors.

---

# Performance

- Pagination
- Lazy Loading
- Indexed Queries
- API Caching
- Debounced Search

---

# Security

- Rate Limiting
- Helmet
- CORS
- Input Validation
- JWT Verification
- Permission Checks

---

# Testing

Unit

- Services
- Utils
- Validators

Integration

- API
- Database
- Scheduler

E2E

- Task Flow
- Reminder Flow
- Dashboard

---

# Documentation

Document

- Setup
- Environment
- Commands
- API
- Database
- Deployment

---

# Deployment

Support

```
Docker

Docker Compose

PM2

Ubuntu VPS
```

Services

```
Bot
API
Dashboard
PostgreSQL
Redis
```

---

# Acceptance Criteria

- Dashboard complete.
- Analytics accurate.
- Reports export.
- Auto archive works.
- Authentication secure.
- Tests pass.
- Documentation complete.
- Production ready.

# 16-20 Production, Future Features & Completion

## Goal

Prepare the project for production, future expansion, and long-term maintenance.

---

# Configuration

Use `.env` only.

```
DISCORD_TOKEN
CLIENT_ID
GUILD_ID

DATABASE_URL

REDIS_URL

JWT_SECRET

PORT

NODE_ENV

LOG_LEVEL
```

Never hardcode secrets.

---

# Roles

## Admin

- Full access

## Manager

- Create tasks
- View analytics
- Reschedule

## Employee

- View assigned tasks
- Upload insights

Permissions must be configurable.

---

# Notifications

Supported

```
Task Created

20H Reminder

70H Reminder

Retry

Completed

Cancelled

Overdue
```

All templates stored in one module.

---

# Backup

Support

```
Database Backup

Restore

Export CSV

Export Excel
```

Automatic daily backups.

---

# Monitoring

Track

```
CPU

Memory

API Latency

Discord Latency

Redis

Database

Queue Size

Failed Jobs
```

Health endpoint must expose service status.

---

# Future Features

Architecture must support

- Multi Discord Servers
- Unlimited Reminder Types
- Multiple Admins
- Multiple Managers
- Client Accounts
- Campaigns
- Team Management
- Reddit API Integration
- AI Screenshot Verification
- OCR
- Email Notifications
- Webhooks
- Mobile App
- Public API
- Plugin System

No architectural changes should be required to add these.

---

# Coding Standards

- Strict TypeScript
- SOLID
- DRY
- Small functions
- Modular folders
- Service-based architecture
- Dependency Injection where needed
- Async/Await only
- No `any`
- No unused code
- No duplicate logic

---

# AI Development Rules

Every future AI prompt must:

- Preserve existing architecture.
- Never rewrite unrelated files.
- Never change database schema without migration.
- Never break APIs.
- Never duplicate functionality.
- Keep backward compatibility.
- Update documentation when required.
- Add tests for new features.

---

# Production Checklist

## Bot

- Online
- Slash commands synced
- Logging enabled

## Database

- Migrations applied
- Backups enabled

## Redis

- Connected
- Queue healthy

## API

- Auth working
- Validation complete

## Dashboard

- Responsive
- Protected routes
- Error handling

## Security

- Secrets secured
- Rate limiting enabled
- Permissions verified

---

# Final Acceptance Criteria

The system must:

- Create Reddit tasks
- Schedule reminders automatically
- Send 20H/70H reminders
- Detect uploaded insights
- Update task state
- Handle retries
- Notify admins for overdue tasks
- Search tasks
- Generate analytics
- Export reports
- Survive restarts
- Handle failures gracefully
- Scale to thousands of tasks
- Be production-ready

---

# Project Complete

Deliverables

- Discord Bot
- REST API
- Admin Dashboard
- PostgreSQL Database
- Redis Queue
- Analytics Engine
- Reporting System
- Documentation
- Docker Deployment
- Automated Testing

Result:

A complete Reddit Operations Platform capable of managing the entire Reddit task lifecycle with minimal manual intervention.

