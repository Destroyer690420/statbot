// ==UserScript==
// @name         GoPartTime Auto Watcher
// @namespace    https://goparttime.net/
// @version      1.6.0
// @description  Watches /tasks for new GoPartTime tasks, reports them to the StatBot backend, and performs in-page acceptance via the native drawer flow when the backend confirms a worker (hybrid automation - server never touches GoPartTime).
// @author       Manager
// @match        *://goparttime.net/*
// @match        *://www.goparttime.net/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      statbot.duckdns.org
// @connect      161.118.164.85
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

/**
   * v1.6.0 - Video tasks are no longer dropped by the auto-accept drawer path.
 * A video task renders as <video poster="...jpg"><source src="...mp4"></video>
 * with no <img> in it, so the img-only extractor sent zero media and the
 * accepted task reached the worker with no video at all. Extraction now walks
 * <img> and <video> in document order and tags each item with
 * `kind: 'image' | 'video'`, so the backend compresses an oversized video for
 * Discord's 25 MB upload limit. Image handling and the 20-item cap unchanged.
 *
 * v1.5.0 - Never-miss the report, and stop waiting a fixed 20s for it.
   *
   * CORRECTNESS (the reason for the major bump - this changes WHAT gets sent):
   *  - The 20-task cap is GONE, on both the client and the server. A drop with
   *    more than 20 posts used to have the overflow silently discarded: those
   *    tasks never reached a cycle, so they could never enter a blast pool, be
   *    claimed, or be assigned. Reports now carry the whole set, chunked at 200
   *    (= the server limit); chunks 2..n fold into the same hour pool.
   *  - Settle detection replaces the fixed 20s countdown. The old constant
   *    waited 20s because the drop was assumed to land within :10 +/-20s; it is
   *    a known instant. We now report once the observed set has been quiet for
   *    1.5s (8s hard cap, so churn cannot stall it).
   *  - Because settling early could otherwise LOSE a late arrival (the exact
   *    thing the 20s wait protected), a confirmed report no longer ends the
   *    hour: the watcher keeps watching and re-reports when genuinely new task
   *    ids appear. The server merges those into the same pool without
   *    re-messaging anyone.
   *  - The parser no longer truncates a task block at 12000 chars. A captured
   *    live page contains a 77,771-char block (6.5x that), and a truncated
   *    window can drop subreddit_name, making a task permanently ineligible.
   *  - A scan that CANNOT be read is no longer reported as "nothing listed".
   *    Markers present but nothing available is a real empty drop; a large
   *    document with zero sub_task markers is a fault, and it now says so on
   *    the status pill, in the console, and as a server-side WARN.
   *  - Minutes 10-11 (the drop itself) poll ~40% tighter, because the gap
   *    between polls is the only thing that can lose a task outright.
   *
   * SPEED:
   *  - No more downloading the ~380 KB listing twice: after the hourly reload
   *    the first scan reuses the document already loaded (verified to contain
   *    the payload; falls back to the fetch if hydration stripped it).
   *  - An unchanged document is parsed once, not re-regexed every tick.
   *
   * Unchanged: claim/accept logic, the drawer flow, fast-accept, blast rules,
   * the hourly :10 refresh, the tail-sweep empty report, and the 30s routine
   * claim cadence.
   *
   * v1.4.11 - Claim pickup latency only (accept logic untouched): a finished
   * claim now returns straight to the poll instead of idling 2-3.5s first, and
   * the live-work poll cadence drops from 2-3.5s to 0.6-0.8s. Winner pickup
   * goes from up to ~3.5s to under ~0.8s. claimTick now returns whether it
   * processed a claim; every other exit path is unchanged. Safe to poll faster
   * because the companion endpoints are exempt from the server rate limiter.
   * Otherwise identical to v1.4.10 below.
   *
   * v1.4.10 - Manual-scan watchdog cover: the on-demand branch now holds
   * the monitor guard (busy flag + watchdog timestamp) exactly like the
   * automatic path, so a stalled manual tick trips the same 90s recovery
   * instead of sitting invisible. No flow change. Otherwise identical to
   * v1.4.9 below.
   *
   * v1.4.9 - Faster auto report: drops land at xx:10 +-20s, so the
   * early-window countdown drops from 45s to 20s (tail stays 10s) -
   * digest DM lands ~xx:10:40-xx:11 instead of ~xx:15. Countdown
   * length only sets WHEN (content is always the latest scan), so a
   * 20s wait still carries the full drop. Otherwise identical to
   * v1.4.8 below.
   *
   * v1.4.8 - On-demand `/scan`: the claim poll carries a `scanNow`
   * request id when the manager taps /scan in Discord; the tab then runs
   * one immediate full scan + settled /burst report tagged with that id
   * (no countdown, no hourly gates), and the server answers with a
   * per-request digest DM. First tab's report wins, second merges
   * silently. Auto flow untouched. Otherwise identical to v1.4.7 below.
   *
   * v1.4.7 - Auditable report POST: every attempt is console-logged,
  * raced against a hard 35s timeout (a hung transport degrades to a loud
  * retry instead of a silent wedge), and its outcome rides poll telemetry.
  * Diagnostics only - success path identical. Otherwise identical to
  * v1.4.6 below.
  *
  * v1.4.6 - Scan telemetry: every claim poll carries the last scan's
  * page + parsed/eligible counts, so the server log distinguishes "empty
  * listing" from "stalled scan" with no browser peek. Diagnostics only -
  * zero behavior change. Otherwise identical to v1.4.5 below.
  *
  * v1.4.5 - Report every drop: the countdown latches on ANY scanned
  * post (banned/unreadable included - server tags them), and a tail sweep
  * from :15 reports even a fully empty drop once ("nothing listed" DM).
  * Report body is eligible-first plus the rest, capped at 20. Comments
  * never count. Otherwise identical to v1.4.4 below.
  *
  * v1.4.4 - Visible hourly :10 refresh: the tab hard-reloads once per
  * hour at minute :10 (skipped when freshly loaded or mid-accept, once
  * only via a reload-surviving flag) so DOM, caches, and page state start
  * the drop window on the current listing before scanning. Otherwise
  * identical to v1.4.3 below.
  *
  * v1.4.3 - Flap-proof countdown: an empty scan tick (throttled fetch,
  * streaming gap) no longer restarts the 45s clock - the countdown runs on
  * the best-seen set once tasks appear, and the report carries the latest
  * non-empty set. Fixes rounds stuck flickering "sending in Ns" /
  * "scanning" that never reported. Otherwise identical to v1.4.2 below.
  *
  * v1.4.2 - Cache-bypass page fetch: background fetch() could be served
  * the cached pre-drop /tasks document (manual reload revalidates, which
  * is why refresh "found" tasks the scan could not see). The listing fetch
  * now uses cache:'no-store' so the :10 scan always sees the current drop.
  * Otherwise identical to v1.4.1 below.
  *
  * v1.4.1 - Fresh-list guarantee (no behavior change otherwise): the
  * :10 scan is fetch-first (the live DOM only refreshes on navigation, so
  * a tab open since before :10 scanned the stale pre-drop list); and a
  * claim whose card is missing reloads EXACTLY once per claim for a fresh
  * list instead of failing as taken (second miss still fails fast into
  * move-on retry; storage-unavailable never loops). Otherwise identical
  * to v1.4.0 below.
  *
  * v1.4.0 - Parallel tabs (Phase 2): each tab carries a stable per-tab id
  * on the claim poll and the server leases every claim to exactly one tab,
  * so 2-3 open tabs accept different tasks concurrently. Serial flow per
  * tab, claim rules, and verdicts are unchanged; a tab without storage
  * falls back to legacy pickup. Otherwise identical to v1.3.1 below.
  *
  * v1.3.1 - Accept-speed Phase 1 (waits only, logic unchanged): 2s claim
  * poll while a burst is open on the server (new `burstOpen` poll flag -
  * covers manual rounds outside the local window); client-side back
  * navigation instead of full reload after each accept (one-shot reload
  * fallback); boot settle skipped when a claim is already waiting;
  * fast-accept capped at 2 tries x 3s; card scan capped at 5s total;
  * claim API calls time out at 10s; never fails a claim for a
  * still-loading card list (leaves it PENDING for the next fast poll).
  * Otherwise identical to v1.3.0 below.
  *
  * v1.3.0 - Claim step timings: processClaim stamps poll-received,
  * drawer-opened, accepted, and pushed markers and reports them with the
  * verdict so the server log shows exactly which step consumes time.
  * Zero behavior change - same waits, same flow. Otherwise identical to
  * v1.2.2 below.
  *
  * v1.2.2 - Blast Now layout fix: the button sat at bottom:54px, overlapping
 * the Send script's Send Task + Submit View buttons. It now parks above
 * both (bottom:124px desktop, 144px on narrow screens). Otherwise identical
 * to v1.2.1 below.
 *
 * v1.2.1 - Force-return to /tasks: GoPartTime auto-navigates the tab to
 * /my-tasks/todo on every accept, which stalled the watcher (monitor +
 * drawer matching only run on /tasks). After each claim verdict (success
 * or failure) the script now navigates the same tab back to /tasks, so
 * the next claim proceeds with no manual reload. Otherwise identical to
 * v1.2.0 below.
 *
 * v1.2.0 - Blast Now button (bottom-right, above the gear): manual immediate
 * round on /tasks - scans, blasts for the eligible count (server force
 * bypasses only the window gate), winners served exactly like hourly rounds.
 * Otherwise identical to v1.1.10 below.
 *
 * v1.1.10 - Anti-wedge: hard timeouts on all page fetches (a stalled load
 * froze the monitor with the pill stuck) + claim-loop watchdog that force
 * recovers a tick unfinished after 90s. Otherwise identical to v1.1.9 below.
 *
 * v1.1.9 - Window :10-:16 + adaptive countdown (45s early, 10s near the
 * tail). Otherwise identical to v1.1.8 below.
 *
 * v1.1.8 - Deadlock-proof reporting: first eligible sighting starts a fixed
 * 45s countdown, then the CURRENT set reports once (churn can never stall
 * it); server grows the pool within its merge grace. Otherwise identical to
 * v1.1.7 below.
 *
 * v1.1.7 - No history filter: every readable non-blocked post is reported
 * (listed + available means takeable; the server skips duplicates the same
 * way). Otherwise identical to v1.1.6 below.
 *
 * v1.1.6 - Settle-deadlock fix: report after two identical scans OR 20s of
 * continuous eligible presence (a churning drop no longer waits forever).
 * Otherwise identical to v1.1.5 below.
 *
 * v1.1.5 - Settle-once-per-hour reporting + :10 sharp window: waits for two
 * consecutive identical scans, POSTs once per hour, retries the same set
 * until the server confirms the blast (retries are server no-ops). Window
 * is minutes :10-:15 local. Otherwise identical to v1.1.4 below.
 *
 * v1.1.4 - Subreddit reader fix + newest-first: windowed parent association
 * (bounded by the next task, no parent-key guessing), newest eligible first
 * in burst reports, drawer ground-truth check aborts on subreddit mismatch.
 * Otherwise identical to v1.1.3 below.
 *
 * v1.1.3 - Blocked-list enforcement: posts with no readable subreddit are
 * never reported as eligible (server rejects them too); wider subreddit
 * extraction window + post_link fallback for all types; bundle refreshes
 * every 15 min so new blocks take effect fast. Otherwise identical to v1.1.1
 * below (v1.1.2 was status-pill wording only).
 *
 * v1.1.2 - Status pill reports hour-blast merges ("+N, no re-message").
 * Otherwise identical to v1.1.1 below.
 *
 * v1.1.1 - Hybrid companion for StatBot automation.
 * Adds an on-page gear button (bottom-right of every goparttime.net page)
 * that opens the API URL/key settings directly - configuration no longer
 * depends on the Tampermonkey popup menu (which hides script commands on
 * tabs the script does not run on). Otherwise identical to v1.0.0 below.
 *
 * v1.1.0 - Hybrid companion for StatBot automation.
 *
 * Two loops, both best-effort and fully unattended:
 *  1. Monitor: routine 60s sightings on /tasks. During the burst window
 *     (:09:50-:15 local, covering the :10/:11 drops + :14/:15 leaks) it
 *     switches to a 2-3s tight loop over the live DOM, filters eligible
 *     posts in-page (Post-only, not recently accepted, subreddit not
 *     blocked - bundle cached from /eligibility-bundle), and POSTs only
 *     changed eligible sets to /burst, which auto-opens an outreach blast
 *     (slots = eligible count). Sightings are NOT posted in the window.
 *  2. Claim (30s routine, 5s in-window, everywhere on goparttime.net):
 *     asks the backend for a pending claim. When the backend has a CONFIRMED
 *     worker (rehearsal, burst reply, or cycle), it accepts in-page:
 *       - Opens the task detail drawer, extracts full task details
 *       - Fast path: direct Server Action POST (~300ms); fallback: click
 *         "Confirm acceptance" in the drawer (native Server Action)
 *       - Observes the response and reports the verdict
 *       - Automatically pushes the extracted details to the worker's ticket
 *
 * Auth/session never leave this browser. No passwords, no pasted cookies.
 * Always on: the watcher starts with every goparttime.net page load.
 * Disable it from the Tampermonkey dashboard toggle if ever needed.
 */
(function () {
  'use strict';

  const VERSION = '1.5.0';
  const DEFAULTS = {
    apiUrl: 'https://statbot.duckdns.org/api/v1/automation',
    apiKey: '',
  };
  const MONITOR_MS = 60 * 1000;
  const CLAIM_MS = 30 * 1000;
  const JITTER_MS = 10 * 1000;
  // Burst window (drop minutes): tight loops while tasks rain, idle otherwise.
  const BURST_MONITOR_MS = 2500;
  const BURST_MONITOR_JITTER_MS = 1500;
  // Minutes 10-11 bracket the known drop instant (:10:05), so this is the
  // window where a task that appears and is taken within seconds could be
  // missed outright. Polling here is ~40% tighter than the rest of the window.
  // The blind gap between polls is the only thing that can lose a task
  // completely, so this is where tightening actually buys correctness.
  const DROP_MONITOR_MS = 1500;
  const DROP_MONITOR_JITTER_MS = 500;
  // After a page load, prefer the document we already have over re-fetching it.
  const FIRST_TICK_DOM_WINDOW_MS = 20000;
  const BURST_CLAIM_MS = 5000;
  const BUNDLE_TTL_MS = 15 * 60 * 1000;
  const RATE_LIMIT_PAUSE_MS = 60 * 1000;
  // Phase-1 speed (no logic change - only waits shrink):
  // - BURST_OPEN_CLAIM_MS: poll cadence while a burst is open on the server
  //   (covers manual Blast Now rounds outside the local window).
  // - BOOT_SETTLE_MS: skipped on boot when a claim was already waiting.
  // - FAST_ACCEPT_TIMEOUT_MS/TRIES: fail fast on stale Server Action ids.
  // - CARD_SCAN_BUDGET_MS: total budget for the card-by-card drawer search.
  // - CLAIM_API_TIMEOUT_MS: API timeout for claim poll/verdict/assign calls.
  const BURST_OPEN_CLAIM_MS = 600;
  const BOOT_SETTLE_MS = 5000;
  const FAST_ACCEPT_TIMEOUT_MS = 3000;
  const FAST_ACCEPT_TRIES = 2;
  const CARD_SCAN_BUDGET_MS = 5000;
  const CLAIM_API_TIMEOUT_MS = 10000;
  // Phase-2 claim pickup: a finished claim hands control straight back to the
  // poll, and the live-work cadence drops from 2-3.5s to 0.6-0.8s so a winner
  // is waiting under a second instead of up to 3.5s. Both are free: the
  // companion endpoints are exempt from the server rate limiter, and each poll
  // is a handful of indexed point reads.
  const CLAIM_CONTINUE_MS = 150;
  const CLAIM_FAST_JITTER_MS = 200;
  // Hard timeout racing the burst report POST: the transport timeout alone
  // proved untrustworthy (a hung POST wedged the loop with zero trace, no
  // log, no retry, no DM). Slightly above the transport timeout so normal
  // slow responses still resolve first.
  const POST_TIMEOUT_MS = 35000;
  // Once-per-hour reporting with SETTLE DETECTION (replaces a fixed 20s wait).
  // The old constant waited 20s because the drop was assumed to arrive anywhere
  // within :10 +/-20s. The drop is a known instant, so instead of guessing a
  // duration we watch the listing: once the observed set has been unchanged
  // for BURST_SETTLE_MS the drop has landed and we report. A quick drop reports
  // in ~1.5s instead of 20s; a slow one waits exactly as long as it needs.
  //   - BURST_SETTLE_MAX_MS is the churn-proof hard cap: a listing that keeps
  //     changing still reports once this elapses after the first sighting.
  //   - Reported-but-grown: after a report is confirmed we KEEP watching, and a
  //     later tick carrying genuinely new task ids reports again. The server
  //     folds that into the same hour's pool (diffNewTasks / appendBurstTasks /
  //     bumpBlastSlots) without re-messaging anyone, so reporting early cannot
  //     lose a late arrival - the exact failure the 20s wait guarded against.
  const BURST_SETTLE_MS = 1500;
  const BURST_SETTLE_MAX_MS = 8000;
  // Matches the server-side max on POST /automation/burst (200). A larger drop
  // arrives as further reports, which the hour-burst merge path folds into the
  // same pool, so any realistic drop is a single request.
  const BURST_CHUNK_SIZE = 200;
  let reportedHour = '';
  let burstConfirmed = false;
  let lastBurstPostAt = 0;
  // Flap-proofing: best non-empty eligible set seen this hour. Empty ticks
  // (throttled fetch, streaming gap) count on this instead of restarting the
  // settle clock. Reset on hour rollover with the rest of the state.
  let latchedEligible = null;
  // v1.4.5: scanned posts latch (any status - eligible, blocked, unreadable).
  // The settle clock starts on ANY listed post so banned-only drops still report
  // (the server tags them); empty drops are covered by the tail sweep below.
  // Comments never count.
  let latchedPosts = null;
  // When the latched set last CHANGED. Settle detection measures quiet time
  // from here. lastChangeAt is always >= firstSeenAt, so requiring quiet time
  // also implies a minimum wait since the first sighting.
  let lastChangeAt = 0;
  // Id-list signature of the last observed post set. Compared each tick to
  // decide whether anything actually changed; an identical tick must not
  // restart the settle clock (a throttled fetch or streaming gap looks
  // identical to a settled drop, and the old code got this wrong twice).
  let lastSetSignature = '';
  // Every sub_task id already reported this hour. Presence here is what makes a
  // follow-up report unnecessary; absence is what triggers one.
  let reportedIds = {};
  // Hour key of the last tail-sweep empty report (never the confirmed hour:
  // a real drop later in the window must still report normally).
  let emptyReportedHour = '';
  const BURST_RETRY_MS = 30000;
  let firstSeenAt = 0;

  function burstHourKey(now) {
    const d = now || new Date();
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() + '-' + d.getHours();
  }
  let bundleCache = null;

  // Set when the server rate-limits us: loops idle until this time.
  let rateLimitedUntil = 0;

  function isRateLimited() {
    return Date.now() < rateLimitedUntil;
  }

  function noteRateLimit() {
    rateLimitedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
  }

  function isRateLimitError(e) {
    const m = e && e.message ? String(e.message) : '';
    return m.indexOf('Too many requests') !== -1;
  }

  // --- Server Action / Fetch interceptor to detect GoPartTime responses ---
  let lastServerActionResponse = null;

  try {
    const targetWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (targetWin && targetWin.fetch) {
      const origFetch = targetWin.fetch;
      targetWin.fetch = async function (...args) {
        const res = await origFetch.apply(this, args);
        try {
          const [resource, config] = args;
          const url = typeof resource === 'string' ? resource : (resource && resource.url) || '';
          const headers = (config && config.headers) || {};
          const isNextAction = headers['Next-Action'] || (headers.get && headers.get('Next-Action'));
          if (isNextAction || url.includes('/tasks')) {
            const clone = res.clone();
            const text = await clone.text();
            lastServerActionResponse = {
              status: res.status,
              text,
              timestamp: Date.now(),
            };
          }
        } catch (e) { /* ignore */ }
        return res;
      };
    }
  } catch (e) {
    console.log('[Auto Watcher] fetch intercept setup note:', e && e.message);
  }

  // --- Storage (GM_* when available, localStorage otherwise) --

  function storageGet(key) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, '') || '';
    } catch (e) { /* fall through */ }
    try {
      return localStorage.getItem('gpt_' + key) || '';
    } catch (e) {
      return '';
    }
  }

  function storageSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return;
      }
    } catch (e) { /* fall through */ }
    try {
      localStorage.setItem('gpt_' + key, value);
    } catch (e) { /* ignore */ }
  }

  // Phase-1: per-tab session flags (survive reloads in the same tab, die
  // with it). Never throws - a missing sessionStorage only costs the
  // boot-settle skip, never correctness.
  function sessGet(key) {
    try {
      if (typeof sessionStorage === 'undefined') return '';
      return sessionStorage.getItem('gpt_' + key) || '';
    } catch (e) { return ''; }
  }

  function sessSet(key, value) {
    try {
      if (typeof sessionStorage === 'undefined') return;
      if (value) sessionStorage.setItem('gpt_' + key, value);
      else sessionStorage.removeItem('gpt_' + key);
    } catch (e) { /* ignore */ }
  }

  const CLAIM_PENDING_FLAG = 'claim_pending';

  function getSettings() {
    return {
      apiUrl: (storageGet('gpt_api_url').trim() || DEFAULTS.apiUrl).replace(/\/api\/v1\/goparttime\/?$/, '/api/v1/automation').replace(/\/$/, ''),
      apiKey: storageGet('gpt_api_key').trim() || DEFAULTS.apiKey,
    };
  }

  function getCompanionId() {
    let id = storageGet('gpt_companion_id');
    if (!id) {
      id = 'pc-' + Math.random().toString(36).slice(2, 10);
      storageSet('gpt_companion_id', id);
    }
    return id;
  }

  function getTabId() {
    // Phase-2: stable id for THIS tab only (sessionStorage dies with the
    // tab, so two tabs never share one). The server leases each claim to
    // exactly one id, which is what makes parallel tabs safe. Returns ''
    // when session storage is unavailable - the server then falls back to
    // legacy oldest-first pickup for that poll. Never throws.
    try {
      if (typeof sessionStorage === 'undefined') return '';
      let id = '';
      try {
        id = sessionStorage.getItem('gpt_tab_id') || '';
      } catch (e) { return ''; }
      if (!id) {
        id = 'tab-' + Math.random().toString(36).slice(2, 10);
        try {
          sessionStorage.setItem('gpt_tab_id', id);
        } catch (e) { return ''; }
      }
      return id;
    } catch (e) { return ''; }
  }

  function watcherEnabled() {
    return true; // always on (disable via the Tampermonkey dashboard toggle)
  }

  function openSettings() {
    const s = getSettings();
    const base = s.apiUrl.replace(/\/api\/v1\/automation\/?$/, '');
    const apiUrl = prompt('Backend API URL (base, without /api/v1):', base || 'https://statbot.duckdns.org');
    if (apiUrl === null) return;
    const apiKey = prompt('API key (GOPARTTIME_API_KEY) - paste the full 64-character key:', s.apiKey);
    if (apiKey === null) return;
    const cleanKey = apiKey.trim();
    storageSet('gpt_api_url', (apiUrl.trim() || 'https://statbot.duckdns.org') + '/api/v1/goparttime');
    storageSet('gpt_api_key', cleanKey);
    if (/^[0-9a-f]{64}$/i.test(cleanKey)) {
      alert('Settings saved. Key looks right (64 hex chars).');
    } else {
      alert('Settings saved, BUT the key is ' + cleanKey.length + ' chars (expected 64 hex). Please re-paste it carefully.');
    }
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Configure Watcher...', openSettings);
  }

  // --- HTTP (GM transport preferred, fetch fallback) --

  function parseStatus(status, responseText) {
    let json = null;
    try {
      json = JSON.parse(responseText);
    } catch (e) { /* non-JSON */ }
    if (status >= 200 && status < 300) return json || { success: true };
    if (status === 401) throw new Error('Authentication failed - check the API key in Configure Sender.');
    if (status === 503) throw new Error('Extension endpoint is not configured on the server.');
    const message = (json && json.message) || ('Server error (' + status + ').');
    throw new Error(message);
  }

  function request(settings, method, path, body, query, timeoutMs) {
    let url = settings.apiUrl + path;
    if (query) url += (url.includes('?') ? '&' : '?') + query;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + settings.apiKey,
    };
    const payload = body ? JSON.stringify(body) : undefined;
    // Phase-1: claim-path calls pass a tighter timeout so a stalled
    // connection fails fast instead of wedging the serial claim queue.
    // Default preserves the previous 30s/20s behavior for all other calls.
    const gmTimeout = timeoutMs > 0 ? timeoutMs : 30000;
    const fetchTimeout = timeoutMs > 0 ? timeoutMs : 20000;

    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method,
          url,
          headers,
          data: payload,
          timeout: gmTimeout,
          onload: (res) => {
            try {
              resolve(parseStatus(res.status, res.responseText));
            } catch (err) {
              reject(err);
            }
          },
          onerror: () => reject(new Error('Server is unavailable.')),
          ontimeout: () => reject(new Error('Server is unavailable (timeout).')),
        });
      });
    }

    return fetchWithTimeout(url, { method, headers, body: payload, credentials: 'omit' }, fetchTimeout)
      .then(async (res) => parseStatus(res.status, await res.text()))
      .catch(() => { throw new Error('Server is unavailable.'); });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // fetch with a hard timeout: a stalled connection must NEVER hang a loop
  // forever (that wedged the monitor with monitorBusy stuck + pill frozen).
  function fetchWithTimeout(url, opts, ms) {
    try {
      if (typeof AbortController === 'undefined') return fetch(url, opts);
    } catch (e) {
      return fetch(url, opts);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, ms);
    const o = {};
    try {
      for (const k in opts) o[k] = opts[k];
    } catch (e) { /* use bare opts below */ }
    o.signal = ctrl.signal;
    return fetch(url, o).then(
      (res) => { clearTimeout(timer); return res; },
      (err) => { clearTimeout(timer); throw err; },
    );
  }

  // --- On-page status pill (display-only, never intercepts clicks) ---

  let statusEl = null;
  let lastOkAt = 0;
  function timeNow() {
    try {
      return new Date().toLocaleTimeString();
    } catch (e) {
      return '';
    }
  }

  function setStatus(ok, text) {
    try {
      if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'gpt-watcher-status';
        statusEl.style.position = 'fixed';
        statusEl.style.left = '16px';
        statusEl.style.bottom = '16px';
        statusEl.style.zIndex = '2147483647';
        statusEl.style.padding = '8px 12px';
        statusEl.style.borderRadius = '8px';
        statusEl.style.fontSize = '12px';
        statusEl.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        statusEl.style.pointerEvents = 'none';
        document.body.appendChild(statusEl);
      }
      if (ok) lastOkAt = Date.now();
      statusEl.style.background = ok ? 'rgba(20, 120, 60, 0.92)' : 'rgba(160, 30, 30, 0.92)';
      statusEl.style.color = '#fff';
      statusEl.textContent = (ok ? 'Watcher OK' : 'Watcher ERROR') + ' ' + timeNow() + (text ? ' - ' + text : '');
    } catch (e) { /* never break loops for status UI */ }
  }

  // --- On-page settings gear (menu-independent configuration) ---
  // The Tampermonkey popup only lists a script's menu commands on tabs the
  // script runs on, which hides "Configure Watcher..." for some users. This
  // tiny gear lives on every goparttime.net page and opens the same settings
  // prompts directly - configuration never depends on the popup menu.

  let gearEl = null;

  function ensureSettingsGear() {
    try {
      if (gearEl || !document.body) return;
      gearEl = document.createElement('button');
      gearEl.id = 'gpt-watcher-gear';
      gearEl.type = 'button';
      gearEl.title = 'Watcher settings (API URL + key)';
      gearEl.textContent = '\u2699';
      gearEl.style.position = 'fixed';
      gearEl.style.right = '16px';
      gearEl.style.bottom = '16px';
      gearEl.style.zIndex = '2147483647';
      gearEl.style.width = '30px';
      gearEl.style.height = '30px';
      gearEl.style.borderRadius = '8px';
      gearEl.style.border = 'none';
      gearEl.style.background = 'rgba(30, 30, 30, 0.85)';
      gearEl.style.color = '#fff';
      gearEl.style.fontSize = '16px';
      gearEl.style.lineHeight = '1';
      gearEl.style.cursor = 'pointer';
      const open = (ev) => {
        try {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          if (ev && ev.preventDefault) ev.preventDefault();
        } catch (e) { /* ignore */ }
        openSettings();
      };
      if (gearEl.addEventListener) gearEl.addEventListener('click', open, true);
      else gearEl.onclick = open;
      document.body.appendChild(gearEl);
    } catch (e) { /* never break loops for settings UI */ }
  }

  // --- On-page Blast Now button (manual immediate round) ---
  // Scans the whole listing, blasts for the eligible count, and serves
  // winners exactly like the hourly round (server force-bypasses only the
  // window gate). One click = one decision; double-clicks are ignored while
  // a manual round is in flight, and the hourly dedupe prevents doubles.

  let blastEl = null;
  let manualBusy = false;

  function ensureBlastButton() {
    try {
      if (blastEl || !document.body) return;
      blastEl = document.createElement('button');
      blastEl.id = 'gpt-blast-now';
      blastEl.type = 'button';
      blastEl.title = 'Scan now + blast eligible posts to workers';
      blastEl.textContent = '\u26A1 Blast Now';
      blastEl.style.position = 'fixed';
      blastEl.style.right = '16px';
      // Right-edge column is owned by the Send script: Send Task (~20-64px)
      // + Submit View (~72-116px desktop, taller circles on mobile). Park
      // Blast Now above both so the three buttons never overlap.
      blastEl.style.bottom = '124px';
      try {
        if (window.matchMedia && window.matchMedia('(max-width: 767px)').matches) blastEl.style.bottom = '144px';
      } catch (e) { /* keep desktop offset */ }
      blastEl.style.zIndex = '2147483647';
      blastEl.style.height = '30px';
      blastEl.style.padding = '0 12px';
      blastEl.style.borderRadius = '8px';
      blastEl.style.border = 'none';
      blastEl.style.background = 'rgba(180, 60, 10, 0.92)';
      blastEl.style.color = '#fff';
      blastEl.style.fontSize = '13px';
      blastEl.style.fontWeight = 'bold';
      blastEl.style.lineHeight = '1';
      blastEl.style.cursor = 'pointer';
      const fire = (ev) => {
        try {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          if (ev && ev.preventDefault) ev.preventDefault();
        } catch (e) { /* ignore */ }
        manualBurst();
      };
      if (blastEl.addEventListener) blastEl.addEventListener('click', fire, true);
      else blastEl.onclick = fire;
      document.body.appendChild(blastEl);
    } catch (e) { /* never break loops for settings UI */ }
  }

  async function manualBurst() {
    if (manualBusy) return;
    const settings = getSettings();
    if (!settings.apiKey) {
      try { alert('Set the API key first (gear icon, bottom-right).'); } catch (e) {}
      return;
    }
    if (!/^\/tasks\/?$/.test(window.location.pathname)) {
      try { alert('Open /tasks first, then press Blast Now.'); } catch (e) {}
      return;
    }
    manualBusy = true;
    try {
      setStatus(true, 'manual scan...');
      let html = await fetchPageHtml();
      let source = 'fetch';
      if (!html) {
        html = domHtml();
        source = 'dom';
      }
      const tasks = parseAvailableTasks(html || '');
      if (tasks.length === 0) {
        setStatus(false, 'manual: no tasks parsed (' + source + ')');
        return;
      }
      const bundle = await getBundle(settings);
      const eligible = filterEligible(tasks, bundle);
      if (eligible.length === 0) {
        setStatus(false, 'manual: 0 eligible (blocked / taken / unreadable)');
        return;
      }
      const ordered = eligible.slice().reverse();
      const res = await request(settings, 'POST', '/burst', {
        companionId: getCompanionId(),
        version: VERSION,
        tasks: ordered,
        force: true,
      });
      const dd = (res && res.data) || {};
      if (!res || !res.success) throw new Error((dd && dd.message) || 'burst failed');
      if (dd.blast) {
        setStatus(true, 'manual blast ' + dd.sent + '/' + dd.blast.slotsTotal + ' - winners reply to claim');
      } else {
        setStatus(false, 'manual: ' + (dd.reason || 'no blast opened'));
      }
    } catch (e) {
      setStatus(false, String((e && e.message) || e).slice(0, 80));
      console.log('[Auto Watcher] manual burst failed:', e && e.message);
    } finally {
      manualBusy = false;
    }
  }

  function withJitter(ms) {
    return ms + Math.floor(Math.random() * JITTER_MS);
  }

  function withBurstJitter(ms) {
    return ms + Math.floor(Math.random() * BURST_MONITOR_JITTER_MS);
  }

  /**
   * Jitter for the live-work claim cadence. Separate from withBurstJitter
   * because the monitor's 1.5s spread is sized for a 2.5s base and would
   * swamp a 0.6s one.
   */
  function withClaimJitter(ms) {
    return ms + Math.floor(Math.random() * CLAIM_FAST_JITTER_MS);
  }

  /**
   * Burst scan window in this browser's LOCAL time (the drop schedule is
   * observed here): minutes :10 through :16 inclusive, every hour.
   * The :16 tail absorbs delayed reports; nothing scans outside it.
   * JS mirror of server isBurstActive (which uses IST; identical when this
   * browser runs on IST).
   */
  function isBurstWindow(now) {
    const d = now || new Date();
    const m = d.getMinutes();
    return m >= 10 && m <= 16;
  }

  /**
   * JS mirror of normalizeSubreddit (src/services/automation/subreddit.ts):
   * trim/lowercase, reddit-URL extract, r/-strip, charset gate.
   */
  function normalizeSub(raw) {
    if (!raw) return null;
    let s = String(raw).trim().toLowerCase();
    if (!s) return null;
    const um = s.match(/reddit\.com\/r\/([a-z0-9_]+)/);
    if (um) return um[1];
    s = s.replace(/^r\//, '').replace(/^[@/]+/, '').replace(/\/+$/, '');
    if (!/^[a-z0-9_]{1,32}$/.test(s)) return null;
    return s;
  }

  /**
   * In-page eligibility mirror of filterEligibleIds
   * (src/services/automation/eligibility.ts): Post-only, not recently
   * accepted, subreddit not blocked. The server re-validates on /burst -
   * this only skips the obvious rejects in milliseconds.
   */
  function filterEligible(tasks, bundle) {
    // JS mirror of server filterEligibleIds: Post-only, readable subreddit,
    // not blocked. Deliberately NO history check: listed + available means
    // takeable (an accepted task vanishes from the listing).
    const blocked = {};
    ((bundle && bundle.blocked) || []).forEach((b) => { blocked[b] = true; });
    const out = [];
    const seen = {};
    for (const t of tasks || []) {
      if (!t || t.subTaskId === undefined || t.subTaskId === null || seen[t.subTaskId]) continue;
      seen[t.subTaskId] = true;
      if (t.type !== 'post') continue;
      const n = normalizeSub(t.subreddit);
      if (!n) continue;
      if (blocked[n]) continue;
      out.push({
        subTaskId: Number(t.subTaskId),
        type: t.type,
        subreddit: t.subreddit || null,
        title: t.title || null,
      });
    }
    // No cap. This used to `slice(0, 20)`, which silently discarded the
    // overflow of any drop with more than 20 eligible posts: those tasks never
    // reached a cycle, so they could never enter a blast pool, be claimed, or be
    // assigned. The transport now chunks at BURST_CHUNK_SIZE (== the server's
    // 200 limit) and every server-side consumer is already bounded.
    return out;
  }

  /**
   * Eligibility bundle (blocked subreddits + recent accepted ids), cached
   * for an hour in memory + GM storage. Failures fall back to cache, then
   * to an empty bundle (server still validates - fail-open, never blocks).
   */
  async function getBundle(settings) {
    const now = Date.now();
    if (bundleCache && now - bundleCache.at < BUNDLE_TTL_MS) return bundleCache;
    try {
      const stored = storageGet('gpt_bundle_json');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && now - (parsed.at || 0) < BUNDLE_TTL_MS) {
          bundleCache = parsed;
          return parsed;
        }
      }
    } catch (e) { /* fall through to fetch */ }
    try {
      const res = await request(settings, 'GET', '/eligibility-bundle');
      const data = (res && res.data) || {};
      bundleCache = { blocked: data.blocked || [], at: now };
      storageSet('gpt_bundle_json', JSON.stringify(bundleCache));
      return bundleCache;
    } catch (e) {
      console.log('[Auto Watcher] bundle fetch failed, using cache:', e && e.message);
      if (bundleCache) return bundleCache;
      return { blocked: [], at: 0 };
    }
  }

  // --- Task-list parsing (page flight data, same shape the backend parses) --
  // Live bytes escape quotes with one backslash; tolerate two (copies vary).

  function fetchPageHtml() {
    // cache:'no-store': a background fetch may otherwise be served the
    // cached pre-drop /tasks document (a manual reload revalidates, which
    // is why refresh "found" tasks the scan could not see). Always hit the
    // network so the :10 scan sees the current drop.
    try {
      return fetchWithTimeout(window.location.pathname, { credentials: 'include', cache: 'no-store' }, 15000)
        .then((res) => (res.ok ? res.text() : null))
        .catch(() => null);
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function domHtml() {
    try {
      return document.documentElement ? document.documentElement.innerHTML : '';
    } catch (e) {
      return '';
    }
  }

  function pageDebug(html) {
    try {
      return {
        htmlLen: html.length,
        scriptTags: (html.match(/<script/gi) || []).length,
        flightHits: (html.match(/sub_task/gi) || []).length,
      };
    } catch (e) {
      return { htmlLen: 0, scriptTags: 0, flightHits: 0 };
    }
  }

  // Windowed field readers (mirror of server parser.ts): search only near the
  // matched sub_task, bounded by the next task so dense lists never mix up
  // neighbors. Never search by parent key name (it varies: task/detail/...).

  function extractSubWindow(window) {
    try {
      const nm = /\\{1,2}"subreddit(?:_name)?\\{1,2}":\s*\\{1,2}"([A-Za-z0-9_ ]+?)\\{1,2}"/.exec(window);
      if (nm && nm[1].trim()) return nm[1].trim();
      const lb = /\\{1,2}"(?:post_link|reddit_url)\\{1,2}":\s*\\{1,2}"(.*?)\\{1,2}"/.exec(window);
      if (lb) {
        const sm = /reddit\.com\/r\/([A-Za-z0-9_]+)/i.exec(lb[1]);
        if (sm) return sm[1];
      }
    } catch (e) { /* keep null */ }
    return null;
  }

  function extractTitleWindow(window) {
    try {
      const tm = /\\{1,2}"title\\{1,2}":\s*\\{1,2}"((?:[^\\]|\\.)*?)\\{1,2}"/.exec(window);
      if (tm) return tm[1].replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>').slice(0, 300) || null;
    } catch (e) { /* keep null */ }
    return null;
  }

  function parseAvailableTasks(html) {
    // Returns DOM order (top = oldest). Callers reverse for newest-first
    // priority; index-matching here must stay in DOM order.
    const out = [];
    const seen = {};
    // sub_task blocks use backslash-escaped quotes inside script payloads.
    const re = /\\{1,2}"sub_task\\{1,2}":\{\\{1,2}"id\\{1,2}":(\d+),\\{1,2}"type\\{1,2}":\\{1,2}"(post|comment)\\{1,2}",\\{1,2}"status\\{1,2}":(\d+),\\{1,2}"task_id\\{1,2}":(\d+)[\s\S]{0,2000}?\\{1,2}"grab_user_id\\{1,2}":(\d+)/g;
    const hits = [];
    let m = null;
    while ((m = re.exec(html)) !== null) {
      if (seen[m[1]]) continue;
      seen[m[1]] = true;
      hits.push({ m: m, index: m.index });
    }
    const markerRe = /\\{1,2}"sub_task\\{1,2}":\{/g;
    const starts = [];
    let sm = null;
    while ((sm = markerRe.exec(html)) !== null) starts.push(sm.index);
    for (const hit of hits) {
      const subId = hit.m[1];
      const type = hit.m[2];
      const status = Number(hit.m[3]);
      const grab = Number(hit.m[5]);
      if (status !== 0 || grab !== 0) continue; // only unclaimed, available tasks
      const idx = hit.index;
      // The next task's own marker is the correct boundary, and there is
      // deliberately NO character cap. The previous `Math.min(next, idx + 12000)`
      // silently truncated real blocks: a captured live /tasks page contains a
      // 77,771-character block, 6.5x that ceiling. A truncated window can drop
      // `subreddit_name`, which makes a task permanently ineligible.
      let nextStart = html.length;
      for (const s of starts) {
        if (s > idx) {
          nextStart = s;
          break;
        }
      }
      const after = html.slice(idx, nextStart);
      const before = html.slice(Math.max(0, idx - 4000), idx);
      const subreddit = extractSubWindow(after) || extractSubWindow(before);
      const title = extractTitleWindow(after) || extractTitleWindow(before);
      out.push({ subTaskId: Number(subId), type, subreddit, title });
    }
    return out;
  }

  /**
   * How many `sub_task` block markers the document contains, regardless of
   * whether they parse into AVAILABLE tasks.
   *
   * This is the signal that separates "the drop is empty / everything is taken"
   * from "this document is not the listing we know how to read". Without it a
   * parser regression, a site redesign, or a stripped payload is indistinguishable
   * from "GoPartTime published nothing" — and the watcher would report
   * "nothing listed" and quietly stop claiming.
   */
  function countSubTaskMarkers(html) {
    if (!html) return 0;
    const re = /\\{1,2}"sub_task\\{1,2}":\{/g;
    let n = 0;
    while (re.exec(html) !== null) n += 1;
    return n;
  }

  /**
   * Classifies a scan outcome so a parse failure can never masquerade as an
   * empty drop.
   *
   *  - 'unreachable': no HTML at all (both the fetch and the DOM failed).
   *  - 'unparseable': a substantial document with ZERO sub_task markers. Either
   *    the payload shape changed or the fetch returned something else entirely.
   *    Reported loudly, never as "nothing listed".
   *  - 'ok': markers present. `tasks.length` may legitimately be 0 because every
   *    listed task is already taken — that is a real, reportable empty drop.
   */
  function classifyScan(html, tasks) {
    if (!html) return 'unreachable';
    if (html.length > 2000 && countSubTaskMarkers(html) === 0) return 'unparseable';
    return 'ok';
  }

  /**
   * Parses a document, reusing the previous result when the bytes are identical.
   *
   * The monitor re-reads the same listing every few seconds; re-running a global
   * regex over ~380 KB each time is pure waste when nothing changed. Equality on
   * the exact string means an identical document cannot produce a different
   * result, so the memo is behaviour-preserving by construction.
   */
  let lastParsedHtml = null;
  let lastParsedTasks = null;
  function parseTasksCached(html) {
    if (html && lastParsedHtml !== null && html === lastParsedHtml) {
      return lastParsedTasks || [];
    }
    const parsed = parseAvailableTasks(html || '');
    lastParsedHtml = html;
    lastParsedTasks = parsed;
    return parsed;
  }

  // --- Monitor loop: report sightings --

  let monitorBusy = false;
  // Watchdog timestamp: the claim loop force-clears a monitor tick that
  // hasn't finished in 90s (hung promise defense in depth).
  let lastMonitorDoneAt = Date.now();

  // v1.4.8 on-demand scan: one immediate full scan + settled /burst
  // report for a /scan request id. No countdown, no hourly gates - the
  // server answers with a per-request digest DM. Failures keep the request
  // pending (retry next tick); only a confirmed report consumes it. The
  // server-side consume is the real exactly-once: the second tab's same-id
  // report merges silently. Never throws.
  async function runManualScan(settings) {
    const reqId = pendingManualScan;
    try {
      setStatus(true, 'MANUAL scan running...');
      let html = await fetchPageHtml();
      let source = 'fetch';
      if (!html) {
        html = domHtml();
        source = 'dom';
      }
      const tasks = parseAvailableTasks(html || '');
      const bundle = await getBundle(settings);
      const eligible = filterEligible(tasks, bundle);
      try { noteScan(window.location.pathname, tasks.length, eligible.length); } catch (e) { /* ignore */ }
      const posts = [];
      const postSeen = {};
      for (const t of tasks || []) {
        if (!t || t.type !== 'post' || t.subTaskId === undefined || t.subTaskId === null) continue;
        const key = String(t.subTaskId);
        if (postSeen[key]) continue;
        postSeen[key] = true;
        posts.push({ subTaskId: Number(t.subTaskId), type: t.type, subreddit: t.subreddit || null, title: t.title || null });
      }
      const rest = posts.filter((t) => {
        for (const e of eligible) {
          if (Number(e.subTaskId) === Number(t.subTaskId)) return false;
        }
        return true;
      });
      // Newest-first, uncapped - same set shape as the automatic report, and
      // the same reason the cap was removed: a capped on-demand report silently
      // hid every task past the cut from the manager's digest.
      const ordered = eligible.concat(rest).slice().reverse();
      console.log('[Auto Watcher] manual scan posting ' + ordered.length + ' task(s) (' + source + ') for ' + reqId + '...');
      notePostAttempt();
      let res = null;
      try {
        res = await Promise.race([
          request(settings, 'POST', '/burst', {
            companionId: getCompanionId(),
            version: VERSION,
            tasks: ordered,
            scanRequestId: reqId,
          }),
          sleep(POST_TIMEOUT_MS).then(() => { throw new Error('manual scan report timed out'); }),
        ]);
        notePostResult(true);
      } catch (e) {
        notePostResult(false);
        setStatus(false, 'MANUAL scan failed - retrying');
        console.log('[Auto Watcher] manual scan failed:', e && e.message);
        return;
      }
      if (res && res.success) {
        consumedManualScans[reqId] = 1;
        if (pendingManualScan === reqId) pendingManualScan = '';
        setStatus(true, 'MANUAL scan reported ' + ordered.length);
      } else {
        setStatus(false, 'MANUAL scan rejected - retrying');
      }
    } catch (e) {
      setStatus(false, 'MANUAL scan error - retrying');
      console.log('[Auto Watcher] manual scan tick failed:', e && e.message);
    }
  }

  async function monitorTick() {
    if (monitorBusy || !watcherEnabled() || isRateLimited()) return;
    const settings = getSettings();
    if (!settings.apiKey) {
      setStatus(false, 'no API key - click the watcher gear (bottom-right)');
      return;
    }
    // Only the /tasks page carries the listing.
    if (!/^\/tasks\/?$/.test(window.location.pathname)) return;
    // v1.4.8 on-demand scan first: one immediate full scan + settled
    // report for the /scan request, then the auto flow resumes next tick.
    // Holds the monitor guard like the automatic path (watchdog cover).
    if (pendingManualScan && !consumedManualScans[pendingManualScan]) {
      monitorBusy = true;
      try {
        await runManualScan(settings);
      } catch (e) {
        console.log('[Auto Watcher] manual scan tick failed:', e && e.message);
      } finally {
        lastMonitorDoneAt = Date.now();
        monitorBusy = false;
      }
      return;
    }
    monitorBusy = true;
    try {
      const burst = isBurstWindow();
      if (burst) maybeHourlyReload();
      // Fetch-first in BOTH modes. The live DOM only refreshes on
      // navigation, so a tab open since before :10 would otherwise scan the
      // stale pre-drop list (new tasks appear only after reload) and the
      // :10 report would carry the wrong set. A fresh fetch returns
      // server-rendered data with the current drop - same as the proven
      // routine order. Sightings are NOT posted during the burst: the
      // settled /burst report replaces them (posting both would
      // double-process via the sighting queue).
      // Reuse the document we already have, once per page load.
      //
      // The hourly refresh does location.reload(), which has just downloaded
      // the whole ~380 KB listing -- and the very next tick used to download it
      // AGAIN through the no-store fetch, purely to scan it. On the first tick
      // after a page load the live DOM *is* that freshly downloaded document,
      // so prefer it. It is verified to actually contain the task payload; if
      // hydration already stripped it we fall through to the fetch exactly as
      // before. This can only save a download, never change what is scanned.
      const freshDocument = Date.now() - bootAtMs < FIRST_TICK_DOM_WINDOW_MS;
      let html = null;
      let source = 'fetch';
      if (freshDocument) {
        const dom = domHtml();
        if (dom && countSubTaskMarkers(dom) > 0) {
          html = dom;
          source = 'dom';
        }
      }
      if (!html) {
        // Fresh SSR HTML always embeds the flight scripts; the live DOM may
        // have them stripped after hydration, so fetch first, DOM as fallback.
        html = await fetchPageHtml();
        if (html) {
          source = 'fetch';
        } else {
          html = domHtml();
          source = 'dom';
        }
      }
      const tasks = parseTasksCached(html || '');
      // A parse failure must never look like an empty drop. "Nothing listed"
      // is a real, reportable state; "I could not read the page" is a fault,
      // and conflating the two is how a watcher silently stops claiming.
      const scanClass = classifyScan(html, tasks);
      if (scanClass !== 'ok') {
        try { noteScan(window.location.pathname, -1, -1); } catch (e) { /* ignore */ }
        noteUnreadableScan();
        setStatus(false, 'SCAN FAILED (' + scanClass + ') - not reporting, retrying');
        console.log('[Auto Watcher] scan unreadable (' + scanClass + ') htmlLen=' +
          (html ? html.length : 0) + ' debug=' + JSON.stringify(pageDebug(html || '')) +
          ' - refusing to report an empty drop');
        return;
      }
      try { unreadableScans = 0; noteScan(window.location.pathname, tasks.length, -1); } catch (e) { /* ignore */ }
      if (burst) {
        const hourKey = burstHourKey();
        if (reportedHour !== hourKey) {
          // New hour: reset the per-hour report state.
          reportedHour = '';
          burstConfirmed = false;
          firstSeenAt = 0;
          lastChangeAt = 0;
          latchedEligible = null;
          latchedPosts = null;
          emptyReportedHour = '';
          reportedIds = {};
        }
        const bundle = await getBundle(settings);
        const eligible = filterEligible(tasks, bundle);
        try { noteScan(window.location.pathname, tasks.length, eligible.length); } catch (e) { /* ignore */ }
        const nowMs = Date.now();
        // v1.4.5: latch on ANY scanned post (comments excluded). A banned-
        // only drop starts the clock exactly like an eligible one - the
        // server tags every task, so nothing reportable ever waits silently.
        const posts = [];
        const postSeen = {};
        for (const t of tasks || []) {
          if (!t || t.type !== 'post' || t.subTaskId === undefined || t.subTaskId === null) continue;
          const key = String(t.subTaskId);
          if (postSeen[key]) continue;
          postSeen[key] = true;
          posts.push({ subTaskId: Number(t.subTaskId), type: t.type, subreddit: t.subreddit || null, title: t.title || null });
        }
        // Set-change detection drives the settle clock. A tick whose id list is
        // identical to the last one is "no new information" and must NOT push
        // the report out; a tick that adds or drops an id restarts the quiet
        // period. Cheap: one join over the (small) post list.
        const signature = posts.map((t) => t.subTaskId).join(',');
        if (signature !== lastSetSignature) {
          lastSetSignature = signature;
          lastChangeAt = nowMs;
        }
        if (posts.length > 0) {
          latchedPosts = posts;
          if (!firstSeenAt) firstSeenAt = nowMs;
        }
        if (eligible.length > 0) {
          // Fresh set wins; the settle clock start stays latched.
          latchedEligible = eligible;
          if (!firstSeenAt) firstSeenAt = nowMs;
        }
        // Flap-proof: an empty tick (throttled fetch, streaming gap) must
        // NEVER restart the clock - count on the best-seen set instead.
        // Only a genuinely unseen hour waits; the server re-validates, and
        // taken tasks fail fast into move-on retry downstream.
        if (!firstSeenAt || !latchedPosts) {
          // Tail sweep: from minute :15, report even a fully empty drop
          // once, so every hour ends with a DM ("nothing listed") instead
          // of silence. Never marks the hour confirmed - a real drop later
          // in the window still reports normally.
          if (new Date().getMinutes() >= 15 && emptyReportedHour !== hourKey &&
              nowMs - lastBurstPostAt >= BURST_RETRY_MS) {
            lastBurstPostAt = nowMs;
            try {
              const emptyRes = await request(settings, 'POST', '/burst', {
                companionId: getCompanionId(),
                version: VERSION,
                tasks: [],
              });
              if (emptyRes && emptyRes.success) {
                emptyReportedHour = hourKey;
                setStatus(true, 'BURST empty drop reported');
              } else {
                setStatus(false, 'BURST empty report failed - retrying');
              }
            } catch (e) {
              setStatus(false, 'BURST empty report failed - retrying');
              console.log('[Auto Watcher] burst empty report failed:', e && e.message);
            }
          } else {
            setStatus(true, 'BURST scanning (' + source + ')...');
          }
          return;
        }
        // Report set: eligible first (newest-first at send), then the rest of
        // the latched posts for visibility (server labels them).
        // NO CAP. The old `.slice(0, 20)` silently discarded the overflow of any
        // drop with more than 20 posts: those tasks never reached a cycle, so
        // they could never enter a blast pool, be claimed, or be assigned. The
        // server's own limit is now 200, the digest already truncates its text
        // and caps its block buttons, and the release path has no cap, so a
        // larger set is safe to send whole.
        const latchedRest = (latchedPosts || []).filter((t) => {
          for (const e of (eligible.length > 0 ? eligible : (latchedEligible || []))) {
            if (Number(e.subTaskId) === Number(t.subTaskId)) return false;
          }
          return true;
        });
        const reportSet = (eligible.length > 0 ? eligible : (latchedEligible || []).slice())
          .concat(latchedRest);
        // Anything genuinely new since the last confirmed report? This is what
        // replaces "report once per hour": once a report lands we keep
        // watching, and a late arrival triggers a follow-up that the server
        // merges into the same pool without messaging anyone again. Without
        // this, settling early (1.5s) would trade the 20s wait's protection
        // against late drops for a new way to lose them.
        let hasUnreported = false;
        for (const t of reportSet) {
          if (!reportedIds[t.subTaskId]) { hasUnreported = true; break; }
        }
        if (burstConfirmed && reportedHour === hourKey && !hasUnreported) {
          setStatus(true, 'BURST reported this hour (' + reportSet.length + ' seen)');
          return;
        }
        // Settle detection: report once the observed set has been quiet for
        // BURST_SETTLE_MS, or unconditionally once BURST_SETTLE_MAX_MS has
        // passed since the first sighting (so a listing that keeps changing
        // still reports). lastChangeAt is only advanced when the id list
        // actually changed, so an empty/throttled tick can never postpone it.
        const quietMs = nowMs - (lastChangeAt || nowMs);
        const sinceFirstMs = nowMs - firstSeenAt;
        const settled = quietMs >= BURST_SETTLE_MS || sinceFirstMs >= BURST_SETTLE_MAX_MS;
        if (!burstConfirmed && !settled) {
          setStatus(true, 'BURST ' + reportSet.length + ' found, settling ' +
            Math.ceil(Math.min(BURST_SETTLE_MS - quietMs, BURST_SETTLE_MAX_MS - sinceFirstMs) / 1000) + 's...');
          return;
        }
        if (nowMs - lastBurstPostAt < BURST_RETRY_MS) {
          setStatus(true, 'BURST send pending, retrying...');
          return;
        }
        // Report (newest-first). Retries re-send until the server confirms.
        lastBurstPostAt = nowMs;
        // Newest-first: page bottom carries the newest drop, so the first
        // replier wins the newest eligible post.
        const ordered = reportSet.slice().reverse();
        // Attempt visibility + survival: log every attempt, race a hard
        // timeout so a hung transport degrades to a loud retry instead of
        // a silent wedge, and record the outcome for poll telemetry.
        console.log('[Auto Watcher] burst report posting ' + ordered.length + ' task(s)...');
        notePostAttempt();
        // Chunked so an oversized drop cannot exceed the server's 200-task
        // limit. Chunks 2..n are folded into the same hour pool by the server's
        // merge path, so this is a transport detail, not extra blasts.
        let res = null;
        try {
          const chunks = [];
          for (let i = 0; i < ordered.length; i += BURST_CHUNK_SIZE) {
            chunks.push(ordered.slice(i, i + BURST_CHUNK_SIZE));
          }
          if (chunks.length === 0) chunks.push([]);
          let last = null;
          for (let i = 0; i < chunks.length; i++) {
            last = await Promise.race([
              request(settings, 'POST', '/burst', {
                companionId: getCompanionId(),
                version: VERSION,
                tasks: chunks[i],
              }),
              sleep(POST_TIMEOUT_MS).then(() => { throw new Error('burst report timed out'); }),
            ]);
            if (!last || !last.success) break;
          }
          res = last;
          notePostResult(true);
        } catch (e) {
          notePostResult(false);
          setStatus(false, 'BURST send failed - retrying');
          console.log('[Auto Watcher] burst report failed:', e && e.message);
          return;
        }
        const dd = (res && res.data) || {};
        if (res && res.success) {
          reportedHour = hourKey;
          burstConfirmed = true;
          for (const t of reportSet) reportedIds[t.subTaskId] = 1;
        }
        const confirmed = dd.eligible ? dd.eligible.length : reportSet.length;
        const blast = dd.blast
          ? (dd.merged
            ? ' -> hour blast +' + ((dd.added && dd.added.length) || 0) + ' (no re-message)'
            : ' -> blast ' + dd.sent + '/' + dd.blast.slotsTotal)
          : '';
        const dry = dd.dryRun ? ' (dry-run)' : '';
        setStatus(true, 'BURST ' + confirmed + ' eligible' + blast + dry);
        return;
      }
      if (tasks.length === 0) {
        await request(settings, 'POST', '/sightings', {
          companionId: getCompanionId(),
          version: VERSION,
          tasks: [],
          debug: { source, page: pageDebug(html || '') },
        }).catch(() => null);
        return;
      }
      await request(settings, 'POST', '/sightings', {
        companionId: getCompanionId(),
        version: VERSION,
        tasks,
      });
      setStatus(true, tasks.length + ' tasks seen');
    } catch (e) {
      if (isRateLimitError(e)) {
        noteRateLimit();
        setStatus(false, 'rate limited - pausing 1 min');
      } else {
        setStatus(false, e && e.message ? String(e.message).slice(0, 80) : 'send failed');
      }
      console.log('[Auto Watcher] sightings failed:', e && e.message);
    } finally {
      lastMonitorDoneAt = Date.now();
      monitorBusy = false;
    }
  }

  // --- Claim loop: accept in-page via native drawer flow when worker is confirmed ---

  let claimBusy = false;
  // Phase-1: server-reported burst state (refreshed on every poll). Drives
  // the fast poll cadence for manual rounds outside the local window.
  let lastBurstOpen = false;

  // v1.4.8 on-demand scan: request id from the poll's `scanNow`, set by
  // claimTick. The monitor tick runs one immediate full scan + settled
  // report tagged with it (no countdown, no hourly gates). Consumed ids
  // are remembered so a re-broadcast never reports twice; the server-side
  // consume is the real exactly-once (second tab merges silently).
  let pendingManualScan = '';
  const consumedManualScans = {};

  // Scan telemetry: last monitor outcome, reported on every claim poll so
  // the server can tell "empty listing" from "broken/stalled scan" without
  // anyone peeking at the browser. Write-only diagnostics - never affects
  // flow. -1 = no scan completed yet.
  let lastScan = { page: '', scanned: -1, eligible: -1 };

  function noteScan(page, scanned, eligible) {
    // Never throws - telemetry must not break scanning.
    try {
      lastScan = {
        page: String(page || '').slice(0, 64),
        scanned: typeof scanned === 'number' ? scanned : -1,
        eligible: typeof eligible === 'number' ? eligible : -1,
      };
    } catch (e) { /* ignore */ }
  }

  // Consecutive scans that could not be read at all. Reported on the claim poll
  // so an unreadable page is visible in the server log as a FAULT rather than
  // looking like an hour that published nothing.
  let unreadableScans = 0;

  function noteUnreadableScan() {
    try {
      unreadableScans += 1;
      lastScan = { page: String(window.location.pathname || '').slice(0, 64) + '!unreadable', scanned: -1, eligible: -1 };
    } catch (e) { /* ignore */ }
  }

  // Burst-report outcome telemetry: the POST step used to fail three ways
  // (rejected = visible; hung forever = invisible wedge; never attempted =
  // invisible). Attempt + hard timeout + result are all recorded so the
  // server log always shows what happened. Never throws.
  // ok: -1 = never attempted, 0 = failed/timed out, 1 = responded.
  let lastPost = { at: 0, ok: -1 };

  function notePostAttempt() {
    try {
      lastPost = { at: Date.now(), ok: -1 };
    } catch (e) { /* ignore */ }
  }

  function notePostResult(ok) {
    try {
      lastPost = { at: Date.now(), ok: ok ? 1 : 0 };
    } catch (e) { /* ignore */ }
  }

  function shouldFastPoll() {
    // Fast while the local drop window is live OR the server says a burst
    // is open OR a manual /scan is waiting (pickup + report in seconds).
    // Never throws - a check failure only costs speed.
    try {
      return isBurstWindow() || lastBurstOpen || !!pendingManualScan;
    } catch (e) { return false; }
  }

  /**
   * Monitor cadence for the current moment.
   *
   * Minutes 10-11 are tightened because that is where the drop lands: a task
   * listed and taken between two polls is gone for good, so the gap between
   * polls is the only thing that can lose one outright. Minutes 12-16 keep the
   * existing burst cadence (they only catch late leaks), and outside the window
   * nothing changes.
   */
  function monitorDelayMs() {
    try {
      if (!isBurstWindow()) return withJitter(MONITOR_MS);
      const minute = new Date().getMinutes();
      if (minute >= 10 && minute <= 11) {
        return DROP_MONITOR_MS + Math.floor(Math.random() * DROP_MONITOR_JITTER_MS);
      }
      return withBurstJitter(BURST_MONITOR_MS);
    } catch (e) {
      return withJitter(MONITOR_MS);
    }
  }

  /**
   * One claim poll + accept cycle.
   *
   * Returns true when a claim was received and processed (its verdict has
   * already been POSTed by the time this returns), so the loop knows the next
   * claim, if any, already exists server-side and there is no reason to idle
   * before asking again. Every other exit returns false.
   */
  async function claimTick() {
    if (claimBusy || !watcherEnabled() || isRateLimited()) return false;
    // Watchdog: recover a wedged monitor tick so one stalled page load can
    // never freeze scanning again (claim loop ticks prove timers are alive).
    if (monitorBusy && Date.now() - lastMonitorDoneAt > 90000) {
      monitorBusy = false;
      setStatus(false, 'monitor stuck - recovered, resuming');
      console.log('[Auto Watcher] monitor watchdog recovered stuck tick');
    }
    const settings = getSettings();
    if (!settings.apiKey) {
      setStatus(false, 'no API key - click the watcher gear (bottom-right)');
      return false;
    }
    claimBusy = true;
    let didWork = false;
    try {
      const res = await request(settings, 'GET', '/claims/pending', null,
        'companionId=' + encodeURIComponent(getCompanionId()) + '&version=' + encodeURIComponent(VERSION) + '&tabId=' + encodeURIComponent(getTabId()) +
        '&page=' + encodeURIComponent(lastScan.page) + '&scan=' + lastScan.scanned + '&elig=' + lastScan.eligible +
        '&post=' + lastPost.at + '&postOk=' + lastPost.ok + '&unreadable=' + unreadableScans,
        CLAIM_API_TIMEOUT_MS);
      setStatus(true, 'poll ok');
      const dd = (res && res.data) || {};
      // Phase-1: remember the server burst state for the poll cadence.
      if (typeof dd.burstOpen === 'boolean') lastBurstOpen = dd.burstOpen;
      // v1.4.8 on-demand scan: a /scan request id rides the poll. The
      // monitor tick performs one immediate full scan + settled report
      // tagged with it; the server answers with a per-request digest DM.
      try {
        if (typeof dd.scanNow === 'string' && dd.scanNow && !consumedManualScans[dd.scanNow]) {
          if (pendingManualScan !== dd.scanNow) {
            pendingManualScan = dd.scanNow;
            console.log('[Auto Watcher] manual scan requested: ' + dd.scanNow);
          }
        }
      } catch (e) { /* ignore - scan request must not break polling */ }
      const claim = dd.claim;
      if (!claim) {
        sessSet(CLAIM_PENDING_FLAG, '');
        return false;
      }
      // Phase-1: mark work pending so a navigation reboot skips the settle
      // pause and polls immediately. Cleared on the next empty poll.
      sessSet(CLAIM_PENDING_FLAG, '1');
      // Phase-0 instrumentation: stamp when the claim reached this tab so
      // the verdict can report per-step durations. In-memory only - never
      // sent except inside the timings object below. No behavior change.
      claim._pollReceivedAt = Date.now();
      claim._timings = { pollReceivedAt: claim._pollReceivedAt, drawerOpenedMs: null, acceptedMs: null, pushedMs: null };
      didWork = true;
      await processClaim(settings, claim);
      return true;
    } catch (e) {
      if (isRateLimitError(e)) {
        noteRateLimit();
        setStatus(false, 'rate limited - pausing 1 min');
      } else {
        setStatus(false, e && e.message ? String(e.message).slice(0, 80) : 'poll failed');
      }
      console.log('[Auto Watcher] claim poll failed:', e && e.message);
      return false;
    } finally {
      claimBusy = false;
    }
  }

  function claimTimings(claim) {
    // Returns the in-progress step durations for the verdict body, or null
    // when the claim predates instrumentation. Never throws.
    try {
      if (!claim || !claim._timings) return null;
      return {
        pollReceivedAt: claim._timings.pollReceivedAt || null,
        drawerOpenedMs: claim._timings.drawerOpenedMs,
        acceptedMs: claim._timings.acceptedMs,
        pushedMs: claim._timings.pushedMs,
      };
    } catch (e) { return null; }
  }

  function stampTiming(claim, field) {
    // Records ms since the claim reached this tab. Never throws - timing
    // must not break the claim flow.
    try {
      if (!claim || !claim._timings || !claim._pollReceivedAt) return;
      claim._timings[field] = Date.now() - claim._pollReceivedAt;
    } catch (e) { /* ignore */ }
  }

  async function reportClaim(settings, claim, ok, failureReason, pushed) {
    try {
      await request(settings, 'POST', '/claims/' + encodeURIComponent(claim.id) + '/result', {
        ok: !!ok,
        failureReason: failureReason || null,
        pushed: pushed === true,
        timings: claimTimings(claim),
      }, null, CLAIM_API_TIMEOUT_MS);
    } catch (e) {
      console.log('[Auto Watcher] claim report failed:', e && e.message);
    }
  }

  // --- DOM helpers for Task Detail Drawer ---

  function findTaskRoot() {
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) return dialog;
    const prose = document.querySelector('div.prose');
    if (!prose) return null;
    const nodes = document.querySelectorAll('div, span');
    for (const el of nodes) {
      if (el.children.length === 0 && (el.textContent || '').trim() === 'Task ID') {
        let parent = el.parentElement;
        while (parent && !parent.contains(prose)) parent = parent.parentElement;
        if (parent) return parent;
      }
    }
    return document;
  }

  function findOpenDrawer() {
    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
    return dialogs.find((d) => d.getAttribute('data-state') === 'open' || d.querySelector('div.prose')) || null;
  }

  function isDrawerOpen() {
    const d = findOpenDrawer();
    return !!d && d.getAttribute('data-state') !== 'closed';
  }

  function closeOpenDrawer() {
    const drawer = findOpenDrawer();
    if (drawer) {
      const cancelBtn = drawer.querySelector('button[data-slot="drawer-close"]') ||
        Array.from(drawer.querySelectorAll('button')).find((b) => (b.textContent || '').trim().toLowerCase() === 'cancel');
      if (cancelBtn) {
        cancelBtn.click();
        return;
      }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  // GoPartTime auto-navigates the tab to /my-tasks/todo on every accept.
  // Phase-1: prefer client-side back navigation so this script instance
  // (and its fast poll timers) survives - no full reload, no reboot, no
  // 5s settle. One-shot full-load fallback if the pathname does not
  // restore. Guarded by pathname: a no-op when already on /tasks (never a
  // reload loop). Never throws - navigation must not break the claim flow.
  function returnToTasks() {
    try {
      if (/^\/tasks\/?$/.test(window.location.pathname)) return;
      try {
        history.back();
      } catch (e) { /* fall through to full load */ }
      setTimeout(function () {
        try {
          if (!/^\/tasks\/?$/.test(window.location.pathname)) window.location.href = '/tasks';
        } catch (e) { /* never break claim flow for navigation */ }
      }, 5000);
    } catch (e) { /* never break claim flow for navigation */ }
  }

  // Script boot time: a tab opened fresh just before :10 already shows the
  // current list, so the hourly refresh skips it (avoids a pointless reload
  // seconds after load).
  const bootAtMs = Date.now();

  // Hourly :10 hard refresh: the drop may already be listed while this tab
  // still renders (and caches) the pre-drop page - a visible reload puts
  // DOM, caches, and React state on the current drop before scanning.
  // Runs at most once per hour, only on /tasks (callers guarantee that),
  // never mid-accept (a reload then could strand an accepted-but-unpushed
  // task), and never twice (sessionStorage survives the reload, so the
  // flag cannot loop). Pending-but-unprocessed claims are safe: they stay
  // PENDING server-side and re-poll immediately after the reboot. Never
  // throws - a refresh must not break scanning.
  function maybeHourlyReload() {
    try {
      const d = new Date();
      if (d.getMinutes() !== 10) return;
      const hk = burstHourKey(d);
      if (sessGet('reloaded_hour') === hk) return;
      if (Date.now() - bootAtMs < 90000) {
        sessSet('reloaded_hour', hk);
        return;
      }
      if (typeof claimBusy !== 'undefined' && claimBusy) return; // retry next tick
      sessSet('reloaded_hour', hk);
      if (!sessGet('reloaded_hour')) return; // storage unavailable: fail safe, never loop
      console.log('[Auto Watcher] hourly :10 refresh for the fresh drop');
      window.location.reload();
    } catch (e) { /* never break scans for a refresh */ }
  }

  function findField(labelText, root) {
    const nodes = (root || document).querySelectorAll('div, span');
    for (const el of nodes) {
      if (el.children.length === 0 && (el.textContent || '').trim() === labelText) {
        const sibling = el.nextElementSibling;
        if (sibling) {
          const value = (sibling.textContent || '').trim();
          if (value) return value;
        }
      }
    }
    return null;
  }

  // ─── media-extraction:start ─── (extracted verbatim by
  // src/__tests__/userscript-media.test.ts — keep the sentinels)
  function extractImages(root) {
    // Walks <img> AND <video> in document order: a video task renders as
    // <video poster="…jpg"><source src="…mp4"></video>, which an img-only
    // query misses entirely. `kind` tells the backend to compress for Discord
    // instead of running it through sharp.
    const nodes = Array.from((root || document).querySelectorAll('img, video'));

    const media = [];
    for (const node of nodes) {
      if (media.length >= 20) break;
      if (node.closest('button')) continue;

      if (node.tagName === 'IMG') {
        const alt = (node.alt || '').trim();
        const src = (node.src || '').trim();
        if (!/^https?:\/\//.test(alt) && !/^https?:\/\//.test(src)) continue;
        if (node.naturalWidth && node.naturalWidth < 60) continue;
        media.push({ order: media.length + 1, url: alt || src, kind: 'image' });
        continue;
      }

      const video = extractVideo(node);
      if (video) media.push({ order: media.length + 1, url: video.url, kind: video.kind });
    }

    return media;
  }

  const VIDEO_URL_RE = /\.(mp4|m4v|mov|webm|mkv)(?:$|[?#])/i;

  function extractVideo(node) {
    const candidates = Array.from(node.querySelectorAll('source'))
      .map((s) => (s.getAttribute('src') || '').trim());
    if (node.currentSrc) candidates.push(String(node.currentSrc).trim());
    if (node.getAttribute('src')) candidates.push(String(node.getAttribute('src')).trim());

    for (const url of candidates) {
      if (/^https?:\/\//.test(url) && VIDEO_URL_RE.test(url)) return { url: url, kind: 'video' };
    }

    const poster = (node.getAttribute('poster') || '').trim();
    if (/^https?:\/\//.test(poster)) return { url: poster, kind: 'image' };
    return null;
  }
  // ─── media-extraction:end ───

  function extractTaskDetail(root) {
    const targetRoot = root || findTaskRoot();
    if (!targetRoot) throw new Error('No task detail open.');
    const taskIdText = findField('Task ID', targetRoot);
    if (!taskIdText || !/^\d+$/.test(taskIdText)) throw new Error('Could not detect task ID.');
    const typeText = (findField('Task Type', targetRoot) || '').toLowerCase();
    const type = typeText === 'post' ? 'post' : 'comment';
    const deadline = findField('Deadline', targetRoot) || null;
    const payment = findField('Payment', targetRoot) || null;
    const images = extractImages(targetRoot);
    const contentEl = targetRoot.querySelector('div.prose');
    const contentHtml = contentEl ? contentEl.innerHTML : '';
    if (!contentHtml.trim() && images.length === 0) throw new Error('Could not extract task content.');

    let subreddit = null;
    let subredditUrl = null;
    let flair = null;
    let title = null;
    let postLink = null;
    let commentLink = null;
    if (type === 'post') {
      const subInput = targetRoot.querySelector('input[name="subreddit"]');
      subreddit = subInput ? (subInput.value || '').trim() || null : null;
      if (subreddit) subredditUrl = 'https://www.reddit.com/r/' + subreddit.replace(/^r\//, '') + '/';
      const flairInput = targetRoot.querySelector('input[name="flair"]');
      flair = flairInput ? (flairInput.value || '').trim() || null : null;
      const titleInput = targetRoot.querySelector('input[name="title"]');
      title = titleInput ? (titleInput.value || '').trim() || null : null;
    } else {
      const postLinkInput = targetRoot.querySelector('input[name="post_link"]');
      postLink = postLinkInput ? (postLinkInput.value || '').trim() || null : null;
      const commentLinkInput = targetRoot.querySelector('input[name="comment_link"]');
      commentLink = commentLinkInput ? (commentLinkInput.value || '').trim() || null : null;
    }

    return {
      taskId: Number(taskIdText), type, deadline, payment,
      subreddit, subredditUrl, flair, title, postLink, commentLink,
      contentHtml, images, sourceUrl: window.location.href,
    };
  }

  function findCardAcceptButton(card) {
    if (!card) return null;
    const btns = Array.from(card.querySelectorAll('button'));
    return btns.find((b) => (b.textContent || '').trim().toLowerCase() === 'accept task') || null;
  }

  async function openTaskDrawer(subTaskId) {
    // Check if drawer is already open with this task
    let currentDrawer = findOpenDrawer();
    if (currentDrawer) {
      const openId = findField('Task ID', currentDrawer);
      if (Number(openId) === Number(subTaskId)) return currentDrawer;
      closeOpenDrawer();
      await sleep(250);
    }

    const cards = Array.from(document.querySelectorAll('div[data-slot="card"]'));
    if (cards.length === 0) return null;

    // Strategy 1: Find candidate card index from flight tasks array
    let candidateCard = null;
    try {
      const tasks = parseAvailableTasks(domHtml() || '');
      const idx = tasks.findIndex((t) => Number(t.subTaskId) === Number(subTaskId));
      if (idx !== -1 && cards[idx]) {
        candidateCard = cards[idx];
      }
    } catch (e) { /* ignore */ }

    // Strategy 2: Check React Fiber key/props if Strategy 1 did not find card
    if (!candidateCard) {
      const needle = String(subTaskId);
      for (const card of cards) {
        for (const k of Object.keys(card)) {
          if (k.startsWith('__reactFiber$')) {
            const fiber = card[k];
            if (fiber && (String(fiber.key).includes(needle) || JSON.stringify(fiber.memoizedProps || {}).includes(needle))) {
              candidateCard = card;
              break;
            }
          }
        }
        if (candidateCard) break;
      }
    }

    // Try candidate card first
    if (candidateCard) {
      const btn = findCardAcceptButton(candidateCard);
      if (btn && !btn.disabled) {
        candidateCard.scrollIntoView({ block: 'center' });
        await sleep(150);
        btn.click();
        for (let i = 0; i < 20; i++) {
          await sleep(150);
          const d = findOpenDrawer();
          if (d && isDrawerOpen()) {
            const openId = findField('Task ID', d);
            if (Number(openId) === Number(subTaskId)) return d;
            closeOpenDrawer();
            await sleep(200);
            break;
          }
        }
      }
    }

    // Strategy 3: Iterate through cards on the page
    // Phase-1: bounded by a total time budget - a missing task (taken by a
    // competitor) fails fast into the server move-on retry instead of
    // clicking every card while later claims wait behind it.
    const scanDeadline = Date.now() + CARD_SCAN_BUDGET_MS;
    for (const card of cards) {
      if (Date.now() > scanDeadline) break;
      if (card === candidateCard) continue;
      const btn = findCardAcceptButton(card);
      if (!btn || btn.disabled) continue;
      card.scrollIntoView({ block: 'center' });
      await sleep(100);
      btn.click();

      let opened = null;
      for (let i = 0; i < 15; i++) {
        await sleep(150);
        opened = findOpenDrawer();
        if (opened && isDrawerOpen()) break;
      }

      if (opened) {
        const openId = findField('Task ID', opened);
        if (Number(openId) === Number(subTaskId)) {
          return opened;
        }
        closeOpenDrawer();
        await sleep(200);
      }
    }

    return null;
  }

  // --- Fast accept: direct Server Action POST (burst fast path) ---

  function findNextActionCandidates() {
    const out = [];
    const seen = {};
    try {
      const chunks = Array.from(document.querySelectorAll('script')).map((s) => s.textContent || '');
      if (document.documentElement) chunks.push(document.documentElement.innerHTML.slice(-200000));
      const re = /\b[0-9a-f]{64}\b/g;
      for (const chunk of chunks) {
        let m = null;
        while ((m = re.exec(chunk)) !== null) {
          if (!seen[m[0]]) {
            seen[m[0]] = true;
            out.push(m[0]);
          }
          if (out.length >= 5) return out;
        }
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  /**
   * Tries the native accept Server Action directly (same shape the backend
   * poller used, but from this genuine session - no checkpoint). Only a
   * definitive verdict ends the flow: {ok:true} on "success":true,
   * {ok:false} on "success":false; anything else is inconclusive ({ok:null})
   * and the caller falls back to the drawer Confirm flow. Never throws.
   */
  async function tryFastAccept(subTaskId) {
    const candidates = findNextActionCandidates();
    if (candidates.length === 0) return { ok: null };
    // Phase-1: fewer tries with a tighter timeout - a stale action id fails
    // fast instead of stalling the serial claim queue (normal responses are
    // well under a second; anything slower falls back to the drawer flow).
    for (const action of candidates.slice(0, FAST_ACCEPT_TRIES)) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FAST_ACCEPT_TIMEOUT_MS);
        let text = '';
        try {
          const res = await fetch('/tasks', {
            method: 'POST',
            credentials: 'include',
            headers: {
              Accept: 'text/x-component',
              'Content-Type': 'text/plain;charset=UTF-8',
              'Next-Action': action,
            },
            body: JSON.stringify([{ sub_task_id: subTaskId }]),
            signal: ctrl.signal,
          });
          text = await res.text().catch(() => '');
        } finally {
          clearTimeout(timer);
        }
        if (/"success":\s*true/.test(text)) return { ok: true };
        if (/"success":\s*false/.test(text)) {
          const m = /"message":\s*"([^"]+)"/.exec(text);
          return { ok: false, error: m ? m[1] : 'GoPartTime rejected acceptance.' };
        }
        // Inconclusive (wrong action id / error page) - try next candidate.
      } catch (e) { /* try next candidate */ }
    }
    return { ok: null };
  }

  // --- Process Claim: In-page acceptance flow ---

  async function processClaim(settings, claim) {
    const subTaskId = Number(claim.externalTaskId);
    if (!subTaskId) {
      await reportClaim(settings, claim, false, 'Invalid task id in claim.');
      return;
    }

    // Must be on /tasks to accept.
    if (!/^\/tasks\/?$/.test(window.location.pathname)) {
      console.log('[Auto Watcher] Pending claim ' + claim.id + ' waiting for manager to be on /tasks (current: ' + window.location.pathname + ')');
      window.location.href = '/tasks';
      return;
    }

    // Phase-1 safety: never fail a claim for a still-loading list. After a
    // client-side back-navigation /tasks can exist with zero cards for a
    // moment - leave the claim PENDING and retry on the next fast poll
    // instead of burning the task as FAILED (failed ids never re-queue).
    // Zero wait in the normal case (cards already present).
    let cardsReady = document.querySelectorAll('div[data-slot="card"]').length > 0;
    for (let i = 0; i < 20 && !cardsReady; i++) {
      await sleep(150);
      cardsReady = document.querySelectorAll('div[data-slot="card"]').length > 0;
    }
    if (!cardsReady) {
      console.log('[Auto Watcher] /tasks list not ready, leaving claim ' + claim.id + ' pending');
      return;
    }

    setStatus(true, 'claiming #' + subTaskId + '...');
    lastServerActionResponse = null;

    // 1. Open the drawer for this task
    let drawer = null;
    try {
      drawer = await openTaskDrawer(subTaskId);
    } catch (e) {
      await reportClaim(settings, claim, false, 'Failed to open task drawer: ' + (e && e.message));
      return;
    }

    if (!drawer) {
      // The card list may predate the drop (tab open since before :10 with
      // no navigation since): reload EXACTLY once per claim for a fresh
      // list. The claim stays PENDING server-side, so after the reboot the
      // next fast poll retries it - nothing is lost and nothing double-runs.
      // A second miss means genuinely taken: fail fast into move-on retry.
      // sessionStorage survives the reload, so the flag cannot loop.
      const reloadFlag = 'reloaded_' + claim.id;
      if (!sessGet(reloadFlag)) {
        sessSet(reloadFlag, '1');
        // Storage may be unavailable (then the flag cannot persist and a
        // reload would loop forever): only reload when the flag stuck.
        if (!sessGet(reloadFlag)) {
          await reportClaim(settings, claim, false, 'Task #' + subTaskId + ' not found on /tasks (may already be taken or expired).');
          return;
        }
        sessSet(CLAIM_PENDING_FLAG, '1');
        console.log('[Auto Watcher] Task #' + subTaskId + ' card missing - reloading once for a fresh list');
        window.location.reload();
        return;
      }
      sessSet(reloadFlag, '');
      await reportClaim(settings, claim, false, 'Task #' + subTaskId + ' not found on /tasks (may already be taken or expired).');
      return;
    }
    stampTiming(claim, 'drawerOpenedMs');

    // 2. Extract full task details while the drawer is open
    let detail = null;
    try {
      detail = extractTaskDetail(drawer);
      if (Number(detail.taskId) !== subTaskId) {
        throw new Error('Opened drawer ID ' + detail.taskId + ' does not match expected ' + subTaskId);
      }
      detail.ticket = claim.channelId;
    } catch (e) {
      closeOpenDrawer();
      await reportClaim(settings, claim, false, 'Failed to extract task details: ' + (e && e.message));
      return;
    }

    // 3. Ground-truth check: the open drawer shows the REAL subreddit. If it
    // disagrees with the claim's expected subreddit, abort - never accept a
    // possibly-blocked task on a heuristic mismatch.
    try {
      const expectedSub = normalizeSub(claim.subreddit);
      const gotSub = normalizeSub(detail.subreddit);
      if (expectedSub && gotSub && expectedSub !== gotSub) {
        closeOpenDrawer();
        await reportClaim(settings, claim, false, 'Subreddit mismatch (expected r/' + expectedSub + ', drawer shows r/' + gotSub + ') - aborted for safety.');
        setStatus(false, 'claim #' + subTaskId + ' aborted: subreddit mismatch');
        return;
      }
    } catch (e) { /* fall through to accept on check failure */ }

    // 4. Accept: fast Server Action POST first, drawer Confirm as fallback.
    // The detail is already extracted above, so a fast accept needs no drawer.
    let accepted = false;
    let acceptError = null;
    try {
      const fast = await tryFastAccept(subTaskId);
      if (fast.ok === true) {
        accepted = true;
        closeOpenDrawer();
        console.log('[Auto Watcher] task #' + subTaskId + ' accepted via fast path');
      } else if (fast.ok === false) {
        acceptError = fast.error;
      }
    } catch (e) { /* fall through to drawer flow */ }

    if (!accepted && !acceptError) {
      // Find the "Confirm acceptance" button
      const confirmBtn = Array.from(drawer.querySelectorAll('button')).find((b) =>
        (b.textContent || '').trim().toLowerCase().includes('confirm acceptance')
      );

      if (!confirmBtn) {
        closeOpenDrawer();
        await reportClaim(settings, claim, false, 'Confirm acceptance button not found in drawer.');
        return;
      }

      // Click "Confirm acceptance"
      const acceptStartTime = Date.now();
      confirmBtn.click();

      // Wait for GoPartTime confirmation (either via intercepted response or drawer closing)
      for (let i = 0; i < 40; i++) { // up to 6 seconds
        await sleep(150);

        // Check intercepted response
        if (lastServerActionResponse && lastServerActionResponse.timestamp >= acceptStartTime) {
          const text = lastServerActionResponse.text || '';
          if (/"success":\s*true/.test(text)) {
            accepted = true;
            break;
          }
          if (/"success":\s*false/.test(text) || lastServerActionResponse.status >= 400) {
            const m = /"message":\s*"([^"]+)"/.exec(text);
            acceptError = m ? m[1] : 'GoPartTime rejected acceptance.';
            break;
          }
        }

        // Fallback: drawer closed indicates acceptance completed
        if (!isDrawerOpen()) {
          accepted = true;
          break;
        }
      }
    }
    stampTiming(claim, 'acceptedMs');

    if (!accepted) {
      closeOpenDrawer();
      const failReason = acceptError || 'GoPartTime acceptance timed out or drawer did not close.';
      await reportClaim(settings, claim, false, failReason);
      setStatus(false, 'accept #' + subTaskId + ' failed: ' + failReason);
      returnToTasks();
      return;
    }

    // 6. Push full task details to the Discord ticket
    let pushed = false;
    try {
      const assignSettings = {
        apiUrl: settings.apiUrl.replace(/\/automation\/?$/, '/goparttime'),
        apiKey: settings.apiKey,
      };
      await request(assignSettings, 'POST', '/assign', detail, null, CLAIM_API_TIMEOUT_MS);
      pushed = true;
      console.log('[Auto Watcher] task #' + subTaskId + ' assigned to ticket ' + claim.channelId);
    } catch (e) {
      console.log('[Auto Watcher] assign to ticket failed (task accepted, push manually):', e && e.message);
    }
    stampTiming(claim, 'pushedMs');

    // 7. Report successful claim verdict (with push outcome for NEEDS_PUSH tracking)
    await reportClaim(settings, claim, true, null, pushed);
    if (pushed) {
      setStatus(true, 'accepted #' + subTaskId + ' & pushed');
    } else {
      setStatus(false, 'accepted #' + subTaskId + ' - PUSH MANUALLY via Send Task');
    }
    // 8. GoPartTime moved us to /my-tasks/todo on accept - go back to
    // /tasks on the same tab so the next claim needs no manual reload.
    returnToTasks();
  }

  // --- Loops --

  async function monitorLoop() {
    for (;;) {
      try {
        await monitorTick();
      } catch (e) { /* never break the loop */ }
      await sleep(monitorDelayMs());
    }
  }

  async function claimLoop() {
    // Phase-1: skip the settle pause when a claim was already waiting (the
    // flag survives a return-to-/tasks navigation in the same tab).
    if (!sessGet(CLAIM_PENDING_FLAG)) await sleep(BOOT_SETTLE_MS);
    for (;;) {
      let didWork = false;
      try {
        didWork = await claimTick();
      } catch (e) { /* never break the loop */ }
      if (didWork) {
        // A claim was just accepted and its verdict already delivered. The
        // next claim, if one exists, is on the server right now, so go
        // straight back to the poll instead of sleeping first. Previously this
        // cost a 2-3.5s idle wait between every single task.
        await sleep(CLAIM_CONTINUE_MS);
        continue;
      }
      // Phase-2: 0.6-0.8s while a burst is open on the server (or the local
      // window is live); the routine 30-40s cadence otherwise. The live
      // cadence used to be 2-3.5s, which meant a winner could sit idle for
      // that long after replying before its task was even handed over.
      await sleep(shouldFastPoll() ? withClaimJitter(BURST_OPEN_CLAIM_MS) : withJitter(CLAIM_MS));
    }
  }

  if (watcherEnabled()) {
    ensureSettingsGear();
    ensureBlastButton();
    monitorLoop();
    claimLoop();
  }
})();
