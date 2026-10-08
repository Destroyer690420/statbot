# REMOVAL_SIGNALS.md — Phase 0: what the spare account actually sees

> Live probe (`scripts/probe-removal-signals.ts`) against real production URLs, run 2026-10-08. All requests are read-only authed `.json` GETs (the same path `fetchRedditPost` uses). Vault cookie works from the host IP (3004 chars, never printed). ~25 requests total, serial with 2 s gaps.

## Observed matrix (www.reddit.com, authenticated as non-mod third party)

| # | Real state | HTTP | title | selftext | author | `removed_by_category` | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Live post | 200 JSON | full | full | full | null | No markers, no tokens. Clean ALIVE. |
| 2 | Spam-filter removal | 200 JSON | full | `[removed]` | full | `reddit` | All 5 admin-`deleted` samples looked like this. Post sits in the sub's modqueue — a moderator can still approve it. |
| 3 | Mod removal | 200 JSON | `[ Removed by moderator ]` | `[removed]` | full | `moderator` | Title token has spaces + capital R — the current exact-match `[removed]` check does **not** catch this title form (caught here only via selftext). |
| 4 | Filter removal + user gone | 200 JSON | full | `[removed]` | `[deleted]` | `reddit` | Mixed: account/post deleted by user AND filter-removed. |
| 5 | Never-existed id | 404 JSON `{"message":"Not Found"}` | — | — | — | — | Distinct from every removal: no listing at all. |

## Infrastructure findings

- **Share links (`/s/<id>`) resolve fine** on www via 302-follow (all 9 samples). Probe reuses `resolveShareUrl`.
- **`old.reddit.com` currently 403s the vaulted session** (HTML block page) on every request, including share resolution — the `www → old` host fallback in `reddit-check.service.ts` / `survival-screenshot.service.ts` is effectively www-only right now. Production is unaffected (www succeeds first); the fallback is harmless dead weight, not a bug to fix under pressure.
- A fabricated id on `old` also 403s (indistinguishable from the session wall), so 404-verdicts must come from www only.

## States NOT observed (no sample found)

- Pure user-deleted shell (`[deleted]` title/selftext + category `deleted`/`author`). The marker logic for it already exists in production (`isRedacted`) — Phase 1 keeps it, first live observation confirms.
- A distinct "awaiting approval" signal. Justification for treating it as covered: an unapproved post is filter-held, i.e. signal #2. From outside, "awaiting approval" and "filter-removed" are the same row — the honest label is *"removed by Reddit's filters — a moderator can still approve it"*, never a claimed distinction.

## 100%-sure rules for Phase 3 (derived, not yet implemented)

1. `removed_by_category = moderator` + any redaction marker → mod-removed. Certain.
2. `removed_by_category = reddit` + `[removed]` marker → filter-removed (may still be approved). Certain as *removed*; never claim permanence.
3. Author `[deleted]` + any redaction marker → user-deleted. Certain.
4. Author `[deleted]` with full content → account gone, post may stand. NOT a deletion signal.
5. 404 on www (JSON "Not Found") → post not found. NOT auto-marked: indistinguishable from a mistyped URL with certainty <100%.
6. 403/429/network/`NO_SESSION` → infrastructure, never a verdict. Already the codebase rule; unchanged.
7. Every auto-mark requires the signal on the canonical URL (post share-resolution) and stability across one retry. Admin dropdown override always wins.

## Phase 1 implementation (2026-10-08, NOT deployed)

- `fetchRedditPost` now returns `removalState` (`LIVE | DELETED_BY_USER | REMOVED_BY_MODS | REMOVED_BY_FILTER | REMOVED_OTHER`) + `removedByCategory` via `summarizeRawPost`/`classifyRemoval` (`src/utils/reddit-post-signals.ts`). `deleted` keeps its historical meaning (`state !== 'LIVE'`) so `checkPostFormat` (DELETED outcome), the dashboard badge, and the survival buckets behave exactly as before.
- Three deliberate verdict fixes vs the old exact-match block: `[deleted]` author with fully standing content → LIVE (account gone, post visible — was wrongly DELETED); `[ Removed by moderator ]` title with empty selftext → REMOVED (was missed entirely); `approved:true` with stale markers → LIVE.
- `REMOVED_OTHER` is the honesty bucket: any unobserved non-null category with markers lands there, never in a named bucket. Survival maps it to REMOVED (same dashboard bucket as the other removals).
- Precedence rule (pinned by test): post-state evidence (`removed_by_category`) outranks account-state (`[deleted]` author) when both are present.
- Verified: typecheck clean, full suite 60/834 (new: 12 classifier + 5 service tests). No auto-marking, no message changes — those are Phases 3/4.

## Phase 2 implementation (2026-10-08, NOT deployed)

- Capture persists `survivalRemovalState` (new nullable `Task` column; pre-Phase-2 rows stay NULL and the card falls back to the coarse bucket exactly as before). `NOT_FOUND` is recorded honestly for unresolvable URLs — never auto-marked in Phase 3.
- Proof card names the state: SURVIVED 10+ MIN / DELETED / REMOVED BY MODERATORS / REMOVED BY REDDIT FILTERS (+ modqueue hint) / REMOVED / POST NOT FOUND (+ verify-URL hint). PENDING/error/Retry paths unchanged.
- Verified: typecheck clean, dashboard `tsc && vite build` clean, full suite 60/835 (bucket-mapping helper pinned by test). No auto-marking, no ticket-message changes — those are Phases 3/4. Ships with the batched phase deploy (migration + code go live together).

## Phase 3 implementation (2026-10-08, NOT deployed — ships with the batched phase deploy)

- `maybeAutoMarkDeleted` (`src/services/removal-auto-mark.service.ts`): marks `cancelledReason='deleted'` + stops reminder jobs + single `AUTO_MARKED_DELETED` audit (actor `system`) ONLY for `REMOVED_BY_MODS` / `REMOVED_BY_FILTER` / `DELETED_BY_USER`. Never for `NOT_FOUND`/`REMOVED_OTHER`/infra states; POST-only; active-pipeline statuses only (COMPLETED/ARCHIVED/CANCELLED stay manual — paid tasks are never auto-touched); first mark wins (never overwrites manual or prior marks); never cancels the survival job.
- Triggers: survival capture success (after proof stored), survival screenshot failure (cheap `.json` state check — screenshot and verdict are independent), submission-time format check, manual Recheck. Submission-time marking still force-schedules the 11-min job, so the screenshot proof always follows the mark, never precedes it.
- Failure path records a certain state without an image when known; the error card + failure DM name the confirmed state (DM notes the auto-mark).
- Capture guard relaxed: `cancelledReason` alone no longer blocks a missing proof (proof is wanted for deleted tasks); CANCELLED/ARCHIVED + already-recorded still skip; re-hydration still excludes cancelled tasks (a restart in the mark→capture window is covered by manual Retry Capture instead — conservative by design).
- Verified: typecheck clean, full suite 61/855 (new `removal-auto-mark.test.ts`: gate set, no-mark cases, terminal statuses, first-mark-wins, comments/missing), dashboard build clean. No ticket-message changes — Phase 4.
