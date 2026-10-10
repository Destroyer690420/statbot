// ==UserScript==
// @name         GoPartTime Link Submitter
// @namespace    https://goparttime.net/
// @version      1.0.0
// @description  Dedicated executor tab for GoPartTime link auto-submit: polls Statbot for verified worker links, finds each task card across /my-tasks/todo pages, fills the Submit Task dialog, and clicks Submit. Never accepts tasks, never consumes accept-claim leases.
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
 * v1.0.0 - Dedicated submission executor (Part 2 of the auto-submit task).
 *
 * One tab runs ONLY this script (do not run the auto-accept watcher here —
 * this tab must never accept or claim). Loop, every ~5s:
 *   1. GET /submit-jobs/pending → oldest due, unleased job (verified link only:
 *      the server gates MATCH posts / SKIPPED comments; anything else never
 *      becomes a job and stays a manager manual review).
 *   2. POST /submit-jobs/:id/lease with this tab's id (stuck-tab reclaim 5m).
 *   3. On /my-tasks/todo: find the card by Task ID across ?page=N (no manual
 *      page-hunting), click its "Submit Task" button, fill input[name=redditUrl]
 *      via the React-controlled-input technique (never clobbers a filled
 *      field — a manager correction wins), wait 3-8s human-like, click the
 *      dialog's own Submit.
 *   4. Verify + POST /submit-jobs/:id/result. Transient failures retry at
 *      +2/+5min server-side (max 3 attempts), then the server tags the
 *      manager in the ticket — same as a format mismatch.
 *
 * TODO-DISCOVERY (click-and-verify seam): the success check below is
 * heuristic (intercepted success:true response OR dialog closed with no
 * error text) because the real Submit network shape was never captured.
 * Before trusting this end-to-end, open devtools Network on goparttime.net,
 * click a card's Submit Task, submit once by hand, and confirm: is Submit a
 * plain REST call or a Next.js Server Action (Next-Action header)? What does
 * a success response body look like? What does the UI do (toast text? dialog
 * closes? card badge flips to something else)? Then replace
 * observeSubmitOutcome() with that authoritative check.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var DEFAULTS = {
    apiUrl: 'https://statbot.duckdns.org/api/v1/goparttime',
    apiKey: '',
  };
  var POLL_MS = 5000;
  var POLL_JITTER_MS = 2000;
  var API_TIMEOUT_MS = 15000;
  var MAX_PAGES = 10;
  // Human-like pre-submit delay (mirrors the 3-8s accept delay: submissions
  // must not look instant/robotic).
  var SUBMIT_DELAY_MIN_MS = 3000;
  var SUBMIT_DELAY_MAX_MS = 8000;
  var DIALOG_WAIT_MS = 4000;
  var VERIFY_BUDGET_MS = 8000;
  // Per-tab lease id (sessionStorage: stable across reloads, unique per tab).
  var TAB_ID_KEY = 'gpt_submit_tab_id';
  // In-flight job across page navigations (?page=N hops).
  var ACTIVE_KEY = 'gpt_submit_active';

  // --- Submit response interceptor (verify seam) ---
  // Captures same-origin POST outcomes around the Submit click so the
  // verifier can see a definitive success:false without guessing.
  var lastSubmitResponse = null;
  try {
    var targetWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (targetWin && targetWin.fetch && !targetWin.__gptSubmitHooked) {
      targetWin.__gptSubmitHooked = true;
      var origFetch = targetWin.fetch;
      targetWin.fetch = function () {
        var args = arguments;
        var resource = args[0];
        var config = args[1] || {};
        var url = typeof resource === 'string' ? resource : (resource && resource.url) || '';
        var headers = config.headers || {};
        var isNextAction = false;
        try {
          isNextAction = !!(headers['Next-Action'] || (headers.get && headers.get('Next-Action')));
        } catch (e) { /* ignore */ }
        var sameOrigin = typeof url === 'string' && (url.charAt(0) === '/' || url.indexOf(window.location.origin) === 0);
        var watch = sameOrigin && (isNextAction || /\/tasks/.test(url));
        var startedAt = Date.now();
        return origFetch.apply(this, args).then(
          function (res) {
            if (watch) {
              try {
                res.clone().text().then(function (text) {
                  lastSubmitResponse = { status: res.status, text: text || '', at: startedAt };
                }).catch(function () { /* ignore */ });
              } catch (e) { /* ignore */ }
            }
            return res;
          },
          function (err) { throw err; },
        );
      };
    }
  } catch (e) { /* interceptor is best-effort */ }

  // --- Storage (GM_* when available, localStorage otherwise) ---

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

  function sessGet(key) {
    try {
      if (typeof sessionStorage === 'undefined') return '';
      return sessionStorage.getItem(key) || '';
    } catch (e) { return ''; }
  }

  function sessSet(key, value) {
    try {
      if (typeof sessionStorage === 'undefined') return;
      if (value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
    } catch (e) { /* ignore */ }
  }

  function getSettings() {
    return {
      apiUrl: (storageGet('gpt_api_url').trim() || DEFAULTS.apiUrl).replace(/\/$/, ''),
      apiKey: storageGet('gpt_api_key').trim() || DEFAULTS.apiKey,
    };
  }

  function getTabId() {
    try {
      if (typeof sessionStorage === 'undefined') return '';
      var id = '';
      try { id = sessionStorage.getItem(TAB_ID_KEY) || ''; } catch (e) { return ''; }
      if (!id) {
        id = 'submit-' + Math.random().toString(36).slice(2, 10);
        try { sessionStorage.setItem(TAB_ID_KEY, id); } catch (e) { return ''; }
      }
      return id;
    } catch (e) { return ''; }
  }

  function openSettings() {
    var s = getSettings();
    var base = s.apiUrl.replace(/\/api\/v1\/goparttime\/?$/, '');
    var apiUrl = prompt('Backend API URL (base, without /api/v1):', base || 'https://statbot.duckdns.org');
    if (apiUrl === null) return;
    var apiKey = prompt('API key (GOPARTTIME_API_KEY):', s.apiKey);
    if (apiKey === null) return;
    storageSet('gpt_api_url', (apiUrl.trim() || 'https://statbot.duckdns.org') + '/api/v1/goparttime');
    storageSet('gpt_api_key', apiKey.trim());
    alert('Settings saved.');
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Configure Submitter...', openSettings);
  }

  // --- HTTP (GM transport preferred, fetch fallback) ---

  function parseStatus(status, responseText) {
    var json = null;
    try { json = JSON.parse(responseText); } catch (e) { /* non-JSON */ }
    if (status >= 200 && status < 300) return json || { success: true };
    var message = (json && json.message) || ('Server error (' + status + ').');
    var err = new Error(message);
    err.status = status;
    err.body = json;
    throw err;
  }

  function request(settings, method, path, body) {
    var url = settings.apiUrl + path;
    var headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + settings.apiKey,
    };
    var payload = body ? JSON.stringify(body) : undefined;
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise(function (resolve, reject) {
        GM_xmlhttpRequest({
          method: method,
          url: url,
          headers: headers,
          data: payload,
          timeout: API_TIMEOUT_MS,
          onload: function (res) {
            try { resolve(parseStatus(res.status, res.responseText)); }
            catch (err) { reject(err); }
          },
          onerror: function () { reject(new Error('Server is unavailable.')); },
          ontimeout: function () { reject(new Error('Server is unavailable (timeout).')); },
        });
      });
    }
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, API_TIMEOUT_MS) : null;
    return fetch(url, { method: method, headers: headers, body: payload, credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        return res.text().then(function (text) {
          if (timer) clearTimeout(timer);
          return parseStatus(res.status, text);
        });
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        if (err && err.status) throw err;
        throw new Error('Server is unavailable.');
      });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // --- Status pill (bottom-left: the Send script owns bottom-right) ---

  var statusEl = null;
  function setStatus(ok, text) {
    try {
      if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'gpt-submit-status';
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
      statusEl.style.background = ok ? 'rgba(20, 120, 60, 0.92)' : 'rgba(160, 30, 30, 0.92)';
      statusEl.style.color = '#fff';
      var time = '';
      try { time = new Date().toLocaleTimeString(); } catch (e) {}
      statusEl.textContent = (ok ? 'Submitter OK' : 'Submitter') + ' ' + time + (text ? ' - ' + text : '');
    } catch (e) { /* never break the loop for status UI */ }
  }

  // --- Page helpers (selectors verified against the real /my-tasks/todo DOM) ---

  function currentTodoPage() {
    try {
      var p = new URLSearchParams(window.location.search).get('page');
      var n = parseInt(p || '1', 10);
      return isNaN(n) || n < 1 ? 1 : n;
    } catch (e) { return 1; }
  }

  function maxTodoPages() {
    try {
      var links = Array.from(document.querySelectorAll('nav[aria-label="pagination"] a[data-slot="pagination-link"][href]'));
      var max = 1;
      for (var i = 0; i < links.length; i++) {
        var m = /[?&]page=(\d+)/.exec(links[i].getAttribute('href') || '');
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
      return Math.min(max, MAX_PAGES);
    } catch (e) { return 1; }
  }

  function findCardByTaskId(taskId) {
    var cards = Array.from(document.querySelectorAll('div[data-slot="card"]'));
    for (var i = 0; i < cards.length; i++) {
      if (detectCardTaskId(cards[i]) === String(taskId)) return cards[i];
    }
    return null;
  }

  // Reads the "Task ID" field off a task card (label's next sibling).
  function detectCardTaskId(card) {
    try {
      var nodes = card.querySelectorAll('div, span');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.children.length === 0 && (el.textContent || '').trim() === 'Task ID') {
          var sibling = el.nextElementSibling;
          if (sibling) {
            var value = (sibling.textContent || '').trim();
            if (/^\d+$/.test(value)) return value;
          }
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // The card's own "Submit Task" action button — exact text only, so the
  // dialog's inner "Submit" and every other card button never match.
  function findCardSubmitButton(card) {
    try {
      var btns = Array.from(card.querySelectorAll('button[data-slot="button"]'));
      for (var i = 0; i < btns.length; i++) {
        if ((btns[i].textContent || '').trim() === 'Submit Task' && !btns[i].disabled) return btns[i];
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function findSubmitDialog() {
    try {
      var dialogs = Array.from(document.querySelectorAll('div[role="dialog"][data-slot="dialog-content"]'));
      for (var i = 0; i < dialogs.length; i++) {
        if (dialogs[i].querySelector('input[name="redditUrl"]')) return dialogs[i];
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  async function waitForSubmitDialog() {
    var waited = 0;
    while (waited < DIALOG_WAIT_MS) {
      var dialog = findSubmitDialog();
      if (dialog) return dialog;
      await sleep(100);
      waited += 100;
    }
    return null;
  }

  function setReactInputValue(input, value) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function findDialogSubmitButton(dialog) {
    try {
      var btns = Array.from(dialog.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if ((b.textContent || '').trim() === 'Submit' && !b.disabled && b.getAttribute('type') !== 'submit') return b;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /**
   * TODO-DISCOVERY: replace with the authoritative check once a real Submit
   * is captured in devtools (REST vs Server Action? success body? toast?).
   * Current heuristics, best first: an intercepted same-origin success:false
   * (or HTTP error) right after the click is a definitive failure; an
   * intercepted success:true is a definitive success; otherwise a dialog
   * that closed itself with no error text counts as success, and anything
   * else (dialog stuck open, visible error) counts as transient failure.
   */
  async function observeSubmitOutcome(clickAt) {
    var waited = 0;
    while (waited < VERIFY_BUDGET_MS) {
      await sleep(250);
      waited += 250;
      try {
        if (lastSubmitResponse && lastSubmitResponse.at >= clickAt) {
          var text = lastSubmitResponse.text || '';
          if (/"success":\s*true/.test(text)) return { ok: true, evidence: 'intercepted success:true' };
          var m = /"message":\s*"([^"]+)"/.exec(text);
          if (/"success":\s*false/.test(text) || lastSubmitResponse.status >= 400) {
            return { ok: false, evidence: m ? m[1] : ('GoPartTime rejected submit (HTTP ' + lastSubmitResponse.status + ')') };
          }
        }
      } catch (e) { /* keep watching */ }
      try {
        var dialog = findSubmitDialog();
        if (!dialog) return { ok: true, evidence: 'dialog closed' };
        var bodyText = (dialog.textContent || '').toLowerCase();
        if (/error|invalid|failed|try again|went wrong/.test(bodyText)) {
          return { ok: false, evidence: 'dialog shows an error' };
        }
      } catch (e) { /* keep watching */ }
    }
    return { ok: findSubmitDialog() === null, evidence: findSubmitDialog() === null ? 'dialog closed (late)' : 'no confirmation observed' };
  }

  // --- Job state (survives ?page=N hops in the same tab) ---

  function loadActive() {
    try {
      var raw = sessGet(ACTIVE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.jobId) return parsed;
    } catch (e) { /* ignore */ }
    return null;
  }

  function saveActive(active) {
    try {
      if (!active) sessSet(ACTIVE_KEY, '');
      else sessSet(ACTIVE_KEY, JSON.stringify(active));
    } catch (e) { /* ignore */ }
  }

  async function reportResult(settings, jobId, ok, failureReason) {
    try {
      await request(settings, 'POST', '/submit-jobs/' + encodeURIComponent(jobId) + '/result', {
        ok: !!ok,
        failureReason: failureReason || null,
      });
    } catch (e) {
      console.log('[Submitter] result report failed:', e && e.message);
    }
  }

  function humanDelayMs() {
    return SUBMIT_DELAY_MIN_MS + Math.floor(Math.random() * (SUBMIT_DELAY_MAX_MS - SUBMIT_DELAY_MIN_MS));
  }

  var busy = false;

  async function processActiveJob(settings, tabId, active) {
    // Stay on the submissions list; any other page navigates back to it.
    if (!/^\/my-tasks\/todo\/?$/.test(window.location.pathname)) {
      console.log('[Submitter] job ' + active.jobId + ' waiting for /my-tasks/todo (on ' + window.location.pathname + ')');
      window.location.href = '/my-tasks/todo';
      return;
    }

    var cardsReady = document.querySelectorAll('div[data-slot="card"]').length > 0;
    for (var i = 0; i < 30 && !cardsReady; i++) {
      await sleep(150);
      cardsReady = document.querySelectorAll('div[data-slot="card"]').length > 0;
    }
    if (!cardsReady) {
      await reportResult(settings, active.jobId, false, 'Submissions list did not render.');
      saveActive(null);
      return;
    }

    // 1. Find the card, walking ?page=N (bounded).
    var card = findCardByTaskId(active.externalTaskId);
    if (!card) {
      var page = currentTodoPage();
      var max = maxTodoPages();
      if (page < max) {
        console.log('[Submitter] task #' + active.externalTaskId + ' not on page ' + page + ', trying page ' + (page + 1));
        window.location.href = '/my-tasks/todo?page=' + (page + 1);
        return;
      }
      await reportResult(settings, active.jobId, false, 'Task #' + active.externalTaskId + ' card not found on /my-tasks/todo (may already be submitted).');
      setStatus(false, 'task #' + active.externalTaskId + ' card missing');
      saveActive(null);
      return;
    }

    // 2. Open its Submit dialog via its own button (exact text, never Accept).
    var openBtn = findCardSubmitButton(card);
    if (!openBtn) {
      await reportResult(settings, active.jobId, false, 'Task #' + active.externalTaskId + ' has no clickable Submit Task button (already submitted?).');
      setStatus(false, 'task #' + active.externalTaskId + ' not submittable');
      saveActive(null);
      return;
    }
    try { card.scrollIntoView({ block: 'center' }); } catch (e) {}
    await sleep(150);
    openBtn.click();
    var dialog = await waitForSubmitDialog();
    if (!dialog) {
      await reportResult(settings, active.jobId, false, 'Submit dialog did not open.');
      saveActive(null);
      return;
    }

    // 3. Fill (never clobber a manager-typed value — their correction wins,
    // and the submit below then submits exactly what they typed).
    var input = dialog.querySelector('input[name="redditUrl"]');
    if (!input) {
      await reportResult(settings, active.jobId, false, 'Submit dialog has no URL field.');
      saveActive(null);
      return;
    }
    var current = (input.value || '').trim();
    if (!current) {
      setReactInputValue(input, active.url);
      console.log('[Submitter] link filled for task #' + active.externalTaskId);
    } else if (current !== active.url) {
      console.log('[Submitter] dialog already filled with a different link — submitting that (manager correction wins).');
    }

    // 4. Human-like pause, then the dialog's own Submit (exact text, scoped).
    await sleep(humanDelayMs());
    dialog = findSubmitDialog();
    if (!dialog) {
      // Dialog vanished mid-flow (navigation, re-render): transient, retry.
      await reportResult(settings, active.jobId, false, 'Submit dialog vanished before Submit.');
      saveActive(null);
      return;
    }
    var submitBtn = findDialogSubmitButton(dialog);
    if (!submitBtn) {
      await reportResult(settings, active.jobId, false, 'Submit button not found in dialog.');
      saveActive(null);
      return;
    }
    lastSubmitResponse = null;
    var clickAt = Date.now();
    submitBtn.click();
    var outcome = await observeSubmitOutcome(clickAt);
    await reportResult(settings, active.jobId, outcome.ok, outcome.ok ? null : outcome.evidence);
    setStatus(outcome.ok, 'task #' + active.externalTaskId + (outcome.ok ? ' submitted' : ' submit failed: ' + outcome.evidence));
    saveActive(null);
  }

  async function tick() {
    if (busy) return;
    var settings = getSettings();
    if (!settings.apiKey) {
      setStatus(false, 'no API key - Configure Submitter...');
      return;
    }
    var tabId = getTabId();
    if (!tabId) {
      setStatus(false, 'no tab id (session storage unavailable)');
      return;
    }
    busy = true;
    try {
      var active = loadActive();
      if (!active) {
        var res = await request(settings, 'GET', '/submit-jobs/pending');
        var jobs = (res && res.data && res.data.jobs) || [];
        if (jobs.length === 0) {
          setStatus(true, 'idle, no pending jobs');
          return;
        }
        var next = jobs[0];
        try {
          await request(settings, 'POST', '/submit-jobs/' + encodeURIComponent(next.jobId) + '/lease', { tabId: tabId });
        } catch (e) {
          // 404 (gone/replaced) or 409 (held by another tab): drop it, next poll.
          console.log('[Submitter] lease refused for ' + next.jobId + ': ' + (e && e.message));
          return;
        }
        active = { jobId: next.jobId, externalTaskId: next.externalTaskId, url: next.submittedRedditUrl, attempt: next.attempt || 1 };
        saveActive(active);
        setStatus(true, 'leased task #' + active.externalTaskId);
      } else {
        // Re-take our own lease so a slow multi-page hunt never looks stuck.
        try {
          await request(settings, 'POST', '/submit-jobs/' + encodeURIComponent(active.jobId) + '/lease', { tabId: tabId });
        } catch (e) {
          // Job gone (replaced by a resubmission): drop it, next poll.
          console.log('[Submitter] active job gone, dropping: ' + active.jobId);
          saveActive(null);
          return;
        }
      }
      await processActiveJob(settings, tabId, active);
    } catch (e) {
      setStatus(false, String((e && e.message) || e).slice(0, 80));
      console.log('[Submitter] tick failed:', e && e.message);
    } finally {
      busy = false;
    }
  }

  function loop() {
    tick().catch(function () { /* never break the loop */ }).finally(function () {
      setTimeout(loop, POLL_MS + Math.floor(Math.random() * POLL_JITTER_MS));
    });
  }

  setStatus(true, 'executor tab ready (v' + VERSION + ')');
  setTimeout(loop, 3000);
})();
