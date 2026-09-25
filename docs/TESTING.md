# TESTING.md — Tests, Build, Lint & Regression Checklist

> Verified against `package.json`, `jest.config.ts`, `src/__tests__/` on 2026-08-11.

---

## 1. Commands

| Command | What it does |
|---|---|
| `npm test` | Jest (ts-jest) — runs `src/__tests__/**/*.test.ts` |
| `npm run test:watch` | Jest watch |
| `npm run build` | `tsc` → `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint on `src/ --ext .ts` |
| `npm run dev` | tsx watch |
| `npm run deploy-commands` | register guild slash commands |
| `cd dashboard && npm run build` | dashboard typecheck + Vite build |

Jest config: preset ts-jest, `testEnvironment: node`, roots `src`, `@/` → `<rootDir>/src`.

## 2. Existing Tests (8 files)

| File | Covers |
|---|---|
| `state-machine.test.ts` | legal/illegal transitions; `getStatusAfterReminderSent`, `getStatusAfterInsightReceived`, `shouldComplete` (Comment @ 20h, Post @ 70h), terminal/cancellable |
| `validators.test.ts` | Reddit URL pattern, notes length, image extensions, `sanitize`, snowflake |
| `goparttime-payload.test.ts` | zod schema: post/comment payloads, coercion, rejections (missing title/postLink, non-sequential image orders, >20 images, whitespace content, missing ticket, non-digit taskId) |
| `goparttime-insight.test.ts` | `resolveInsightReminder`: step 1 → 20h reminder, step 2 → 70h (post), step-2-on-comment throws, invalid step throws, no-reminder → null, no-step fallbacks (pending → has-image → earliest), empty list |
| `image-processor.test.ts` | `prepareImage`: ≤10MB passthrough, >10MB WebP compression ≤~9.5MB, 404 throw, alpha preserved |
| `discord-chunker.test.ts` | `chunkText`: paragraph→sentence→word→char splitting, formatting preservation, code fences, custom limits |
| `plain-task-message.test.ts` | `buildTaskMessagePlan` metadata/content chunking; `buildInstructionMessage` post/comment variants |
| `html-to-discord.test.ts` | HTML→markdown mapping (bold, links, lists, blockquotes, code, headings, img ignored) |

**No test coverage** for: most services (task/payout/commission/reminder/goparttime/owner-earnings/analytics), most repositories, bot commands/events, scheduler/worker, or the dashboard (no frontend tests exist). Worker Portal access repository behavior is covered by `worker-portal-access.test.ts`.

### Worker portal suites (2026-09-25)
| File | Covers |
|---|---|
| `worker-view.test.ts` (28) | payout states (ARCHIVED=paid incl. no-item anomaly, COMPLETED=awaiting, failed precedence), every derived status/tab, format-check mapping (infra states hidden), todo/completed sorting, completion-time rule, home counts, action-needed cap, wallet math + IST boundary bucketing, DTO whitelist vs `WORKER_FORBIDDEN_FIELDS`, money format |
| `worker-auth.test.ts` (21) | admin middleware (valid passes; missing/wrong username, worker-shaped, worker-secret tokens → 401), workerAuth (valid passes; admin/expired/wrong-aud-iss-alg/typeless/denylisted → 401), OTP alphabet/length/grouping, case-insensitive verify, HMAC-only storage, single-use, TTL expiry, 5-attempt invalidation, single-active + cooldown, 5/hour cap, 10-fail lock, constant-time compare, fail-closed outside test env, Discord message shape + expiry cleanup, JWT claims (7d, aud/iss, no admin-secret fallback) |
| `worker-isolation.test.ts` (26) | HTTP end-to-end over a mocked DB/Discord client: status, type-ahead (short-q empty, ≤5 results, exact `{channelId,name}` keys, case-insensitive, task-less excluded), request-code (mention-only message, no code/identity in response, single-active 429, generic 404s, 502 with no stored code), newest-task identity + multi-assignee warning, verify (wrong/code reuse, success deletes message, invalidation deletes message, per-ticket access upsert, tracking-write failure tolerance), logout denylist, per-endpoint isolation loop (no B markers, no forbidden or admin-only access fields), identical 404s, scoped search/pagination, worker-scoped `/me`+`/wallet`, wallet parity vs `payoutService.findEligibleTasks`, kill-switch 404s |
| `worker-portal-access.test.ts` (2) | repository upsert preserves firstSeenAt while refreshing lastSeenAt/workerId; admin read selects only channel/worker/timestamps |

## 3. Manual Testing Procedures

### After backend changes
1. `npm run typecheck` && `npm run lint` && `npm test`
2. `npm run build` (verify no TS errors)
3. Local run: `npm run dev` with valid `.env`
4. If commands changed: `npm run deploy-commands`

### After dashboard changes
1. `cd dashboard && npm run build`
2. `npm run dev` → verify pages against the live API target.
3. Worker visual pass: check `/worker/login`, `/worker`, `/worker/tasks`, `/worker/tasks/:id`, `/worker/wallet`, and `/worker/how-to` at 360px, 768px, 1024px, and 1440px widths. Confirm mobile bottom navigation, desktop sidebar, Home KPI 2×2 mobile grid with no horizontal carousel, task filters, status pills, skeletons, How-to jump navigation, reduced-motion behavior, and no horizontal page overflow.
4. Confirm worker API calls, query keys, route paths, and auth boundaries are unchanged with `git diff`/browser network inspection; the visual pass must not add a data endpoint.
5. Production verification after dashboard deploy: root and all worker SPA routes return 200, new hashed assets return 200, `/api/v1/health` is healthy, `/api/v1/worker/auth/status` is enabled, and unauthenticated `/api/v1/worker/me` returns 401.
6. Worker Portal access indicator (live since `675c618`; the table is empty, so the first tick appears only after a real ticket-OTP login — still unverified on the owner's side): open `/outreach`; selected and unselected tickets show Portal state; a successful ticket-OTP login creates/refreshes that ticket's row and turns its tick green on the next refresh; failed logins do not change it; the tooltip shows the last successful login time; logout/expiry does not clear the tick.

## 4. Regression Checklist (important flows)

### Reminder flow (Comment task)
- [ ] `/task` creates PENDING task + 1 reminder (`COMMENT_20H` at createdAt+20h)
- [ ] Reminder embed arrives in the ticket at due time, mentions the worker
- [ ] Worker replies with png/jpg/jpeg/webp screenshot → bot reacts ✅, reminder completed, status `INSIGHT_20_RECEIVED` → COMPLETED
- [ ] Unanswered: retry #1 after +2h (WARNING color, "Retry 1 of 3"), retry #2 after +6h, then overdue ping to admins+managers
- [ ] Restart bot mid-cycle → pending jobs re-hydrated within 30 min (or at boot)
- [ ] `/reschedule` and `/send-now` behave (cancel old job, new due date)

### Post task flow
- [ ] `/task type=Post` → 2 reminders (POST_20H, POST_70H)
- [ ] 20h insight → `INSIGHT_20_RECEIVED` (NOT completed)
- [ ] 70h insight → `INSIGHT_70_RECEIVED` → COMPLETED

### GoPartTime flow
- [ ] Userscript detects task, sends to `/goparttime/assign` → ticket receives metadata/content/images/instruction
- [ ] Duplicate send → 409 (idempotent)
- [ ] Worker replies with exactly one Reddit URL → ✅ recorded (`submittedRedditUrl`) + auto format-check verdict reply (MATCH / mismatch / verify-failed) and `formatCheckStatus` persisted
- [ ] Accepted Tasks shows the Format badge; mismatch badge opens the side-by-side diff; Recheck re-runs the server check
- [ ] Mark Done → status PENDING, reminders scheduled, `redditUrl` bound
- [ ] Delivery failure → task FAILED → `retry-assignment` sends only missing tail
- [ ] Reassign moves task to another ticket and re-delivers
- [ ] One awaiting task per ticket enforced

### Submit View flow (v1.4.0)
- [ ] Narrow viewport (≤767px, e.g. phone): "📊 Submit View" button is NOT created; Send Task still works; no tracking/preview code runs; menu toggle "📊 Submit View: ON/OFF" → ON forces it back (override stored, page reloads)
- [ ] Desktop: button present (unchanged behavior)
- [ ] Click card "Submit View" → "📊 Submit View" button attaches the 20h screenshot to the View dialog; count/Submit/verify stay manual
- [ ] Screenshot preview panel appears on the left with the same screenshot (single Blob: preview + upload identical)
- [ ] Preview: scrollable if large; `− Zoom`/`Zoom +` steps 0.25× between 0.5×–5×; `Open ↗` opens the blob URL full-size; ✕ closes and revokes the URL
- [ ] Preview does not close the GoPartTime dialog (pointer-events/pointerdown protection) and auto-closes when the dialog is closed
- [ ] Disabled countdown button tracked → alert shows the countdown text; nothing fetched
- [ ] No screenshot uploaded → "No screenshot uploaded yet for ..." alert
- [ ] Screenshot expired (60h TTL) → download fails with a clear error

### Payout flow
- [ ] Complete ≥1 task → `GET /payouts/summary` counts it, `pendingAmount` = posts×60 + comments×30 (or custom rates)
- [ ] `pay-worker` creates/uses week batch, item rows created, COMPLETED→ARCHIVED
- [ ] Paid tasks disappear from `/eligible`; `pay-all` re-run says nothing eligible
- [ ] CSV export matches dashboard numbers
- [ ] Week window: task completed Sunday 00:00 IST belongs to the new week

### Commission flow
- [ ] `/referral add` normal + special (hardcoded IDs) recorded
- [ ] Invitee completes tasks → threshold met → bonus payable; special gets per-task amounts
- [ ] `pay-inviter` flips `oneTimeCommissionPaid`, sets status qualified/active_per_task
- [ ] Paid items excluded on second pay attempt; commission CSV correct

### Archive/restore
- [ ] Sunday archive moves paid COMPLETED → ARCHIVED
- [ ] `restore-unpaid-archived` brings back unpaid ARCHIVED as COMPLETED

### Auth/security
- [ ] No token → 401; wrong token → 401; non-admin → 403 on pay/rates endpoints
- [ ] Owner endpoints reachable without auth (known issue — verify before assuming it's fixed)
- [ ] Extension assign without/with wrong key → 401; unset key → 503

## 5. Known Missing Coverage (suggested next tests)

- State machine integration with reminder service
- Payout week-window boundary (IST Sunday edge)
- Commission threshold/per-task math
- messageCreate reply handling (URL + screenshot)
- API route validation (zod 400s) and admin gates