// ==UserScript==
// @name         GoPartTime Auto Watcher
// @namespace    https://goparttime.net/
// @version      1.4.3
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

  const VERSION = '1.4.3';
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
  const BURST_OPEN_CLAIM_MS = 2000;
  const BOOT_SETTLE_MS = 5000;
  const FAST_ACCEPT_TIMEOUT_MS = 3000;
  const FAST_ACCEPT_TRIES = 2;
  const CARD_SCAN_BUDGET_MS = 5000;
  const CLAIM_API_TIMEOUT_MS = 10000;
  // Once-per-hour reporting: the first scan with eligible posts starts a
  // fixed countdown; when it lapses the CURRENT set is reported once.
  // No signature comparison (churn-proof - a live drop never sits still).
  // Retries re-send until the server confirms the blast.
  let reportedHour = '';
  let burstConfirmed = false;
  let lastBurstPostAt = 0;
  // Flap-proofing: best non-empty eligible set seen this hour. Empty ticks
  // (throttled fetch, streaming gap) count on this instead of restarting
  // the countdown. Reset on hour rollover with the rest of the state.
  let latchedEligible = null;
  const BURST_RETRY_MS = 30000;
  const BURST_REPORT_DELAY_MS = 45000;
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
    return out.slice(0, 20);
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
      let nextStart = idx + 12000;
      for (const s of starts) {
        if (s > idx) {
          nextStart = s;
          break;
        }
      }
      const after = html.slice(idx, Math.min(nextStart, idx + 12000));
      const before = html.slice(Math.max(0, idx - 4000), idx);
      const subreddit = extractSubWindow(after) || extractSubWindow(before);
      const title = extractTitleWindow(after) || extractTitleWindow(before);
      out.push({ subTaskId: Number(subId), type, subreddit, title });
    }
    return out;
  }

  // --- Monitor loop: report sightings --

  let monitorBusy = false;
  // Watchdog timestamp: the claim loop force-clears a monitor tick that
  // hasn't finished in 90s (hung promise defense in depth).
  let lastMonitorDoneAt = Date.now();

  async function monitorTick() {
    if (monitorBusy || !watcherEnabled() || isRateLimited()) return;
    const settings = getSettings();
    if (!settings.apiKey) {
      setStatus(false, 'no API key - click the watcher gear (bottom-right)');
      return;
    }
    // Only the /tasks page carries the listing.
    if (!/^\/tasks\/?$/.test(window.location.pathname)) return;
    monitorBusy = true;
    try {
      const burst = isBurstWindow();
      // Fetch-first in BOTH modes. The live DOM only refreshes on
      // navigation, so a tab open since before :10 would otherwise scan the
      // stale pre-drop list (new tasks appear only after reload) and the
      // :10 report would carry the wrong set. A fresh fetch returns
      // server-rendered data with the current drop - same as the proven
      // routine order. Sightings are NOT posted during the burst: the
      // settled /burst report replaces them (posting both would
      // double-process via the sighting queue).
      let html = null;
      let source = 'fetch';
      if (burst) {
        html = await fetchPageHtml();
        if (html) {
          source = 'fetch';
        } else {
          html = domHtml();
          source = 'dom';
        }
      } else {
        // Fresh SSR HTML always embeds the flight scripts; the live DOM may
        // have them stripped after hydration, so fetch first, DOM as fallback.
        html = await fetchPageHtml();
        if (!html) {
          html = domHtml();
          source = 'dom';
        }
      }
      const tasks = parseAvailableTasks(html || '');
      if (burst) {
        const hourKey = burstHourKey();
        if (reportedHour !== hourKey) {
          // New hour: reset the once-per-hour report state.
          reportedHour = '';
          burstConfirmed = false;
          firstSeenAt = 0;
          latchedEligible = null;
        }
        if (reportedHour === hourKey && burstConfirmed) {
          setStatus(true, 'BURST reported this hour');
          return;
        }
        const bundle = await getBundle(settings);
        const eligible = filterEligible(tasks, bundle);
        const nowMs = Date.now();
        if (eligible.length > 0) {
          // Fresh set wins; the countdown start stays latched.
          latchedEligible = eligible;
          if (!firstSeenAt) firstSeenAt = nowMs;
        }
        // Flap-proof: an empty tick (throttled fetch, streaming gap) must
        // NEVER restart the clock - count on the best-seen set instead.
        // Only a genuinely unseen hour waits; the server re-validates, and
        // taken tasks fail fast into move-on retry downstream.
        if (!firstSeenAt || !latchedEligible) {
          setStatus(true, 'BURST scanning (' + source + ')...');
          return;
        }
        const reportSet = eligible.length > 0 ? eligible : latchedEligible;
        // Adaptive countdown: full delay early in the window (let the drop
        // finish streaming so the single report carries the full number),
        // fast near the tail so delayed reports still land inside it.
        // Fixed countdowns only - churn can never stall this.
        const delayMs = new Date().getMinutes() >= 15 ? 10000 : BURST_REPORT_DELAY_MS;
        const waitMs = delayMs - (nowMs - firstSeenAt);
        if (waitMs > 0) {
          // Count first, blast after: the single report carries the full
          // number - never partial, never repeated.
          setStatus(true, 'BURST ' + reportSet.length + ' found, sending in ' + Math.ceil(waitMs / 1000) + 's...');
          return;
        }
        if (nowMs - lastBurstPostAt < BURST_RETRY_MS) {
          setStatus(true, 'BURST send failed, retrying...');
          return;
        }
        // Report once (newest-first). Retries re-send until the server
        // confirms; the server dedupes by hour (no re-message ever).
        lastBurstPostAt = nowMs;
        // Newest-first: page bottom carries the newest drop, so the first
        // replier wins the newest eligible post.
        const ordered = reportSet.slice().reverse();
        let res = null;
        try {
          res = await request(settings, 'POST', '/burst', {
            companionId: getCompanionId(),
            version: VERSION,
            tasks: ordered,
          });
        } catch (e) {
          setStatus(false, 'BURST send failed - retrying');
          console.log('[Auto Watcher] burst report failed:', e && e.message);
          return;
        }
        const dd = (res && res.data) || {};
        if (res && res.success) {
          reportedHour = hourKey;
          burstConfirmed = true;
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

  function shouldFastPoll() {
    // Fast while the local drop window is live OR the server says a burst
    // is open. Never throws - a check failure only costs speed.
    try {
      return isBurstWindow() || lastBurstOpen;
    } catch (e) { return false; }
  }

  async function claimTick() {
    if (claimBusy || !watcherEnabled() || isRateLimited()) return;
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
      return;
    }
    claimBusy = true;
    try {
      const res = await request(settings, 'GET', '/claims/pending', null,
        'companionId=' + encodeURIComponent(getCompanionId()) + '&version=' + encodeURIComponent(VERSION) + '&tabId=' + encodeURIComponent(getTabId()),
        CLAIM_API_TIMEOUT_MS);
      setStatus(true, 'poll ok');
      const dd = (res && res.data) || {};
      // Phase-1: remember the server burst state for the poll cadence.
      if (typeof dd.burstOpen === 'boolean') lastBurstOpen = dd.burstOpen;
      const claim = dd.claim;
      if (!claim) {
        sessSet(CLAIM_PENDING_FLAG, '');
        return;
      }
      // Phase-1: mark work pending so a navigation reboot skips the settle
      // pause and polls immediately. Cleared on the next empty poll.
      sessSet(CLAIM_PENDING_FLAG, '1');
      // Phase-0 instrumentation: stamp when the claim reached this tab so
      // the verdict can report per-step durations. In-memory only - never
      // sent except inside the timings object below. No behavior change.
      claim._pollReceivedAt = Date.now();
      claim._timings = { pollReceivedAt: claim._pollReceivedAt, drawerOpenedMs: null, acceptedMs: null, pushedMs: null };
      await processClaim(settings, claim);
    } catch (e) {
      if (isRateLimitError(e)) {
        noteRateLimit();
        setStatus(false, 'rate limited - pausing 1 min');
      } else {
        setStatus(false, e && e.message ? String(e.message).slice(0, 80) : 'poll failed');
      }
      console.log('[Auto Watcher] claim poll failed:', e && e.message);
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

  function extractImages(root) {
    const imgs = Array.from((root || document).querySelectorAll('img')).filter((img) => {
      if (img.closest('button')) return false;
      const alt = (img.alt || '').trim();
      const src = (img.src || '').trim();
      if (!/^https?:\/\//.test(alt) && !/^https?:\/\//.test(src)) return false;
      if (img.naturalWidth && img.naturalWidth < 60) return false;
      return true;
    });
    return imgs.slice(0, 20).map((img, index) => ({
      order: index + 1,
      url: (img.alt || '').trim() || img.src,
    }));
  }

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
      await sleep(isBurstWindow() ? withBurstJitter(BURST_MONITOR_MS) : withJitter(MONITOR_MS));
    }
  }

  async function claimLoop() {
    // Phase-1: skip the settle pause when a claim was already waiting (the
    // flag survives a return-to-/tasks navigation in the same tab).
    if (!sessGet(CLAIM_PENDING_FLAG)) await sleep(BOOT_SETTLE_MS);
    for (;;) {
      try {
        await claimTick();
      } catch (e) { /* never break the loop */ }
      // Phase-1: 2-3.5s while a burst is open on the server (or the local
      // window is live); the routine 30-40s cadence otherwise.
      await sleep(shouldFastPoll() ? withBurstJitter(BURST_OPEN_CLAIM_MS) : withJitter(CLAIM_MS));
    }
  }

  if (watcherEnabled()) {
    ensureSettingsGear();
    ensureBlastButton();
    monitorLoop();
    claimLoop();
  }
})();
