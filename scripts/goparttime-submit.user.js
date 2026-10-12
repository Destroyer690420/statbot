// ==UserScript==
// @name         GoPartTime Link Submitter
// @namespace    https://goparttime.net/
// @version      1.2.0
// @description  Dedicated executor tab for GoPartTime link auto-submit + deadline feedback: polls Statbot for verified worker links and stalling notices, finds each task card across /my-tasks/todo pages, fills the Submit Task dialog (or the Feedback dialog with "submitting in a bit"), and clicks Submit. Never accepts tasks, never consumes accept-claim leases.
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
 * v1.2.0 - Deadline feedback ("submitting in a bit"). The pending poll now
 * also returns feedbackJobs (link-less tasks near their task-site deadline);
 * feedback is processed before submit jobs. Flow per feedback job: lease,
 * reload the list, find the card, click its exact-text "Feedback" button,
 * fill textarea[name="reason"] via the React-textarea technique (a
 * manager-typed notice wins — it is submitted as-is), short human-like
 * pause, click the dialog's own Submit. Verify: intercepted success:true or
 * dialog auto-closed (observed: Submit closes it). Report to
 * /feedback-jobs/:id/result (one server retry, then the manager is tagged).
 * Submit flow untouched.
 *
 * v1.1.2 - Fresh list per job: a newly leased job reloads /my-tasks/todo
 * before hunting (newly accepted posts never render without a reload, so a
 * stale DOM could never find them). One reload per job; the saved active job
 * resumes on the next tick. No flow changes otherwise.
 *
 * v1.1.1 - Fix: the fill step's `var input` declaration was merged into a
 * comment line (ReferenceError "input is not defined" on every job — the
 * dialog opened but nothing was ever filled). No flow changes.
 *
 * v1.1.0 - Authoritative submit path (discovery closed with a real capture).
 * Submit is a Next.js Server Action: POST <this page URL> with
 * Accept: text/x-component, Content-Type: text/plain;charset=UTF-8,
 * Next-Action: <64-hex>, body [{"sub_task_id":<id>,"reddit_url":"<url>"}];
 * success is flight text containing "success":true (failure "success":false).
 * The executor now tries that fast path first (definitive verdicts only,
 * 2 tries x 3s — same shape as the accept flow) with the dialog-Submit click
 * as fallback. Verification is dialog-closed + card's Submit Task button gone
 * (both corroborated manually) backed by the intercepted action response.
 *
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
 * closes? card badge flips to something else)? RESOLVED v1.1.0 with a real
 * capture: Submit is a Server Action (POST this page URL, text/x-component,
 * Next-Action 64-hex, [{"sub_task_id":id,"reddit_url":url}]) and success is
 * flight text with "success":true; the dialog auto-closes and the card's
 * Submit Task button disappears. tryFastSubmit + observeSubmitOutcome below
 * implement exactly that.
 */
(function () {
  'use strict';

  var VERSION = '1.2.0';
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
  // Stalling notice written into the Feedback dialog (server-pinned wording).
  var FEEDBACK_TEXT = 'submitting in a bit';
  // Feedback needs no link-correction pause, but must not look instant.
  var FEEDBACK_DELAY_MIN_MS = 1200;
  var FEEDBACK_DELAY_MAX_MS = 2500;
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

  // Same React-controlled technique for <textarea> (own prototype setter —
  // the input one does not apply), with direct-assignment fallback.
  function setReactTextValue(el, value) {
    try {
      var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, value);
    } catch (e) {
      try { el.value = value; } catch (e2) { /* ignore */ }
    }
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
  }

  // The card's own "Feedback" action button — exact text only, scoped to the
  // card, so the dialog's inner "Submit" never matches.
  function findCardFeedbackButton(card) {
    try {
      var btns = Array.from(card.querySelectorAll('button[data-slot="button"]'));
      for (var i = 0; i < btns.length; i++) {
        if ((btns[i].textContent || '').trim() === 'Feedback' && !btns[i].disabled) return btns[i];
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // Open Feedback dialog = the one carrying textarea[name="reason"].
  function findFeedbackDialog() {
    try {
      var dialogs = Array.from(document.querySelectorAll('div[role="dialog"][data-slot="dialog-content"]'));
      for (var i = 0; i < dialogs.length; i++) {
        if (dialogs[i].querySelector('textarea[name="reason"]')) return dialogs[i];
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  async function waitForFeedbackDialog() {
    var waited = 0;
    while (waited < DIALOG_WAIT_MS) {
      var dialog = findFeedbackDialog();
      if (dialog) return dialog;
      await sleep(100);
      waited += 100;
    }
    return null;
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

  // --- Fast submit: direct Server Action POST (verified shape, v1.1.0) ---
  //
  // POST <this page URL> with Accept: text/x-component,
  // Content-Type: text/plain;charset=UTF-8, Next-Action: <64-hex id>,
  // body [{"sub_task_id":<id>,"reddit_url":"<url>"}]. Only a definitive
  // verdict ends the flow ({ok:true} on "success":true, {ok:false} on
  // "success":false); anything else is inconclusive ({ok:null}) and the
  // caller falls back to the dialog-Submit click. Never throws.

  var FAST_SUBMIT_TRIES = 2;
  var FAST_SUBMIT_TIMEOUT_MS = 3000;

  function findNextActionCandidates() {
    var out = [];
    var seen = {};
    try {
      var chunks = Array.from(document.querySelectorAll('script')).map(function (s) { return s.textContent || ''; });
      if (document.documentElement) chunks.push(document.documentElement.innerHTML.slice(-200000));
      var re = /\b[0-9a-f]{64}\b/g;
      for (var c = 0; c < chunks.length; c++) {
        var m = null;
        while ((m = re.exec(chunks[c])) !== null) {
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

  async function tryFastSubmit(subTaskId, redditUrl) {
    var candidates = findNextActionCandidates();
    if (candidates.length === 0) return { ok: null };
    var target = window.location.pathname + window.location.search;
    for (var i = 0; i < Math.min(candidates.length, FAST_SUBMIT_TRIES); i++) {
      try {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, FAST_SUBMIT_TIMEOUT_MS);
        var text = '';
        try {
          var res = await fetch(target, {
            method: 'POST',
            credentials: 'include',
            headers: {
              Accept: 'text/x-component',
              'Content-Type': 'text/plain;charset=UTF-8',
              'Next-Action': candidates[i],
            },
            body: JSON.stringify([{ sub_task_id: Number(subTaskId), reddit_url: redditUrl }]),
            signal: ctrl.signal,
          });
          text = await res.text().catch(function () { return ''; });
        } finally {
          clearTimeout(timer);
        }
        if (/"success":\s*true/.test(text)) return { ok: true };
        if (/"success":\s*false/.test(text)) {
          var m = /"message":\s*"([^"]+)"/.exec(text) || /"review_reason":\s*"([^"]+)"/.exec(text);
          return { ok: false, error: m ? m[1] : 'GoPartTime rejected the submission.' };
        }
        // Inconclusive (wrong action id / error page) - try next candidate.
      } catch (e) { /* try next candidate */ }
    }
    return { ok: null };
  }

  /**
   * Authoritative verify (v1.1.0): the intercepted Server-Action response
   * decides when present ("success":true/false). Otherwise the corroborated
   * DOM terminal state decides: dialog gone AND the card's Submit Task button
   * gone means submitted (the dialog auto-closes and the button disappears on
   * success — observed manually). Anything else is a transient failure.
   */
  async function observeSubmitOutcome(clickAt, card) {
    var waited = 0;
    while (waited < VERIFY_BUDGET_MS) {
      await sleep(250);
      waited += 250;
      try {
        if (lastSubmitResponse && lastSubmitResponse.at >= clickAt) {
          var text = lastSubmitResponse.text || '';
          if (/"success":\s*true/.test(text)) return { ok: true, evidence: 'success:true' };
          var m = /"message":\s*"([^"]+)"/.exec(text);
          if (/"success":\s*false/.test(text) || lastSubmitResponse.status >= 400) {
            return { ok: false, evidence: m ? m[1] : ('GoPartTime rejected submit (HTTP ' + lastSubmitResponse.status + ')') };
          }
        }
      } catch (e) { /* keep watching */ }
      try {
        if (!findSubmitDialog()) return checkSubmittedCard(card);
      } catch (e) { /* keep watching */ }
    }
    try {
      if (!findSubmitDialog()) return checkSubmittedCard(card);
    } catch (e) { /* fall through */ }
    return { ok: false, evidence: 'no confirmation observed' };
  }

  function checkSubmittedCard(card) {
    try {
      var gone = !card || !document.contains(card) || !findCardSubmitButton(card);
      if (gone) return { ok: true, evidence: 'dialog closed, Submit button gone' };
    } catch (e) { /* ignore */ }
    return { ok: true, evidence: 'dialog closed' };
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

    // 2. Fast path: direct Server Action POST (no dialog needed). Definitive
    // verdicts end the job here; inconclusive falls through to the dialog.
    var fast = null;
    try {
      fast = await tryFastSubmit(active.externalTaskId, active.url);
    } catch (e) { fast = null; }
    if (fast && fast.ok === true) {
      await reportResult(settings, active.jobId, true, null);
      setStatus(true, 'task #' + active.externalTaskId + ' submitted (fast path)');
      saveActive(null);
      return;
    }
    if (fast && fast.ok === false) {
      await reportResult(settings, active.jobId, false, fast.error);
      setStatus(false, 'task #' + active.externalTaskId + ' rejected: ' + fast.error);
      saveActive(null);
      return;
    }

    // 3. Fallback: open its Submit dialog via its own button (exact text,
    // never Accept).
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

    // 4. Fill (never clobber a manager-typed value — their correction wins,
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

    // 5. Human-like pause, then the dialog's own Submit (exact text, scoped).
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
    var outcome = await observeSubmitOutcome(clickAt, card);
    await reportResult(settings, active.jobId, outcome.ok, outcome.ok ? null : outcome.evidence);
    setStatus(outcome.ok, 'task #' + active.externalTaskId + (outcome.ok ? ' submitted' : ' submit failed: ' + outcome.evidence));
    saveActive(null);
  }

  /**
   * Feedback verify: the intercepted Server-Action response decides when
   * present ("success":true/false). Otherwise the corroborated terminal
   * state decides: the Feedback dialog auto-closes on Submit (observed with
   * a real capture), so dialog-gone means sent. Anything else is transient.
   */
  async function observeFeedbackOutcome(clickAt) {
    var waited = 0;
    while (waited < VERIFY_BUDGET_MS) {
      await sleep(250);
      waited += 250;
      try {
        if (lastSubmitResponse && lastSubmitResponse.at >= clickAt) {
          var text = lastSubmitResponse.text || '';
          if (/"success":\s*true/.test(text)) return { ok: true, evidence: 'success:true' };
          var m = /"message":\s*"([^"]+)"/.exec(text);
          if (/"success":\s*false/.test(text) || lastSubmitResponse.status >= 400) {
            return { ok: false, evidence: m ? m[1] : ('site rejected feedback (HTTP ' + lastSubmitResponse.status + ')') };
          }
        }
      } catch (e) { /* keep watching */ }
      try {
        if (!findFeedbackDialog()) return { ok: true, evidence: 'dialog closed' };
      } catch (e) { /* keep watching */ }
    }
    try {
      if (!findFeedbackDialog()) return { ok: true, evidence: 'dialog closed' };
    } catch (e) { /* fall through */ }
    return { ok: false, evidence: 'no confirmation observed' };
  }

  function feedbackDelayMs() {
    return FEEDBACK_DELAY_MIN_MS + Math.floor(Math.random() * (FEEDBACK_DELAY_MAX_MS - FEEDBACK_DELAY_MIN_MS));
  }

  async function reportFeedbackResult(settings, jobId, ok, failureReason) {
    try {
      await request(settings, 'POST', '/feedback-jobs/' + encodeURIComponent(jobId) + '/result', {
        ok: !!ok,
        failureReason: failureReason || null,
      });
    } catch (e) {
      console.log('[Submitter] feedback result report failed:', e && e.message);
    }
  }

  async function processFeedbackJob(settings, tabId, active) {
    // Stay on the submissions list; any other page navigates back to it.
    if (!/^\/my-tasks\/todo\/?$/.test(window.location.pathname)) {
      console.log('[Submitter] feedback ' + active.jobId + ' waiting for /my-tasks/todo (on ' + window.location.pathname + ')');
      window.location.href = '/my-tasks/todo';
      return;
    }

    var cardsReady = document.querySelectorAll('div[data-slot="card"]').length > 0;
    for (var i = 0; i < 30 && !cardsReady; i++) {
      await sleep(150);
      cardsReady = document.querySelectorAll('div[data-slot="card"]').length > 0;
    }
    if (!cardsReady) {
      await reportFeedbackResult(settings, active.jobId, false, 'Submissions list did not render.');
      saveActive(null);
      return;
    }

    // 1. Find the card, walking ?page=N (bounded).
    var card = findCardByTaskId(active.externalTaskId);
    if (!card) {
      var page = currentTodoPage();
      var max = maxTodoPages();
      if (page < max) {
        console.log('[Submitter] feedback task #' + active.externalTaskId + ' not on page ' + page + ', trying page ' + (page + 1));
        window.location.href = '/my-tasks/todo?page=' + (page + 1);
        return;
      }
      await reportFeedbackResult(settings, active.jobId, false, 'Task #' + active.externalTaskId + ' card not found on /my-tasks/todo.');
      setStatus(false, 'feedback task #' + active.externalTaskId + ' card missing');
      saveActive(null);
      return;
    }

    // 2. Open its Feedback dialog via its own button (exact text).
    var openBtn = findCardFeedbackButton(card);
    if (!openBtn) {
      await reportFeedbackResult(settings, active.jobId, false, 'Task #' + active.externalTaskId + ' has no clickable Feedback button.');
      setStatus(false, 'feedback task #' + active.externalTaskId + ' not actionable');
      saveActive(null);
      return;
    }
    try { card.scrollIntoView({ block: 'center' }); } catch (e) {}
    await sleep(150);
    openBtn.click();
    var dialog = await waitForFeedbackDialog();
    if (!dialog) {
      await reportFeedbackResult(settings, active.jobId, false, 'Feedback dialog did not open.');
      saveActive(null);
      return;
    }

    // 3. Fill (never clobber a manager-typed notice — theirs wins and is
    // submitted as-is).
    var area = dialog.querySelector('textarea[name="reason"]');
    if (!area) {
      await reportFeedbackResult(settings, active.jobId, false, 'Feedback dialog has no text field.');
      saveActive(null);
      return;
    }
    var current = (area.value || '').trim();
    if (!current) {
      setReactTextValue(area, FEEDBACK_TEXT);
      console.log('[Submitter] feedback filled for task #' + active.externalTaskId);
    } else if (current !== FEEDBACK_TEXT) {
      console.log('[Submitter] feedback dialog already filled — submitting that (manager notice wins).');
    }

    // 4. Short human-like pause, then the dialog's own Submit (exact text).
    await sleep(feedbackDelayMs());
    dialog = findFeedbackDialog();
    if (!dialog) {
      await reportFeedbackResult(settings, active.jobId, false, 'Feedback dialog vanished before Submit.');
      saveActive(null);
      return;
    }
    var submitBtn = findDialogSubmitButton(dialog);
    if (!submitBtn) {
      await reportFeedbackResult(settings, active.jobId, false, 'Submit button not found in feedback dialog.');
      saveActive(null);
      return;
    }
    lastSubmitResponse = null;
    var clickAt = Date.now();
    submitBtn.click();
    var outcome = await observeFeedbackOutcome(clickAt);
    await reportFeedbackResult(settings, active.jobId, outcome.ok, outcome.ok ? null : outcome.evidence);
    setStatus(outcome.ok, 'feedback task #' + active.externalTaskId + (outcome.ok ? ' held' : ' failed: ' + outcome.evidence));
    saveActive(null);
  }

  function leasePath(kind, jobId) {
    var base = kind === 'feedback' ? '/feedback-jobs/' : '/submit-jobs/';
    return base + encodeURIComponent(jobId) + '/lease';
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
        var data = (res && res.data) || {};
        var fbJobs = data.feedbackJobs || [];
        var jobs = data.jobs || [];
        // Feedback first: it shields the deadline and is quick; submit jobs
        // follow. Older servers omit feedbackJobs (treated as none).
        var next = fbJobs.length > 0 ? { kind: 'feedback', job: fbJobs[0] } : (jobs.length > 0 ? { kind: 'submit', job: jobs[0] } : null);
        if (!next) {
          setStatus(true, 'idle, no pending jobs');
          return;
        }
        try {
          await request(settings, 'POST', leasePath(next.kind, next.job.jobId), { tabId: tabId });
        } catch (e) {
          // 404 (gone/replaced/stale) or 409 (held by another tab): next poll.
          console.log('[Submitter] lease refused for ' + next.job.jobId + ': ' + (e && e.message));
          return;
        }
        active = { kind: next.kind, jobId: next.job.jobId, externalTaskId: next.job.externalTaskId, url: next.job.submittedRedditUrl || null, attempt: next.job.attempt || 1 };
        saveActive(active);
        setStatus(true, 'leased ' + next.kind + ' task #' + active.externalTaskId);
        // Fresh list first: newly accepted posts never render without a
        // reload, so a job must never hunt on a stale DOM. After the reload
        // the same active job resumes on the next tick (re-takes its own
        // lease) on the current list. One reload per job — jobs are
        // infrequent, polls are not. If the reload itself fails, the next
        // tick resumes on whatever DOM is current (page-walk still applies).
        try {
          if (/^\/my-tasks\/todo\/?$/.test(window.location.pathname)) window.location.reload();
          else window.location.href = '/my-tasks/todo';
        } catch (e) { /* next tick resumes regardless */ }
        return;
      } else {
        if (!active.kind) active.kind = 'submit';
        // Re-take our own lease so a slow multi-page hunt never looks stuck.
        try {
          await request(settings, 'POST', leasePath(active.kind, active.jobId), { tabId: tabId });
        } catch (e) {
          // Job gone (replaced by a resubmission, or stale feedback): drop it.
          console.log('[Submitter] active job gone, dropping: ' + active.jobId);
          saveActive(null);
          return;
        }
      }
      if (active.kind === 'feedback') await processFeedbackJob(settings, tabId, active);
      else await processActiveJob(settings, tabId, active);
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
