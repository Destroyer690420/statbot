// ==UserScript==
// @name         GoPartTime Auto Watcher
// @namespace    https://goparttime.net/
// @version      1.0.9
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
 * v1.0.9 - Hybrid companion for StatBot automation.
 *
 * Two loops, both best-effort and fully unattended:
 *  1. Monitor (every ~60s on /tasks): parses the page's embedded flight data
 *     for available sub-tasks and POSTs sightings to the backend. The backend
 *     validates (Post/duplicate/blocked), pings workers on Discord, and waits
 *     for confirmation - exactly like the manual flow.
 *  2. Claim (every ~30s, everywhere on goparttime.net): asks the backend for a
 *     pending claim. When the backend has a CONFIRMED worker, it performs the
 *     genuine in-page acceptance on /tasks via the task drawer:
 *       - Opens the task detail drawer by clicking "Accept Task" on the matching card
 *       - Extracts full task details (Task ID, subreddit, title, content, flair, etc.)
 *       - Clicks "Confirm acceptance" inside the drawer (fires native Server Action)
 *       - Observes the response and reports the verdict
 *       - Automatically pushes the extracted details to the worker's Discord ticket
 *
 * Auth/session never leave this browser. No passwords, no pasted cookies.
 * Always on: the watcher starts with every goparttime.net page load.
 * Disable it from the Tampermonkey dashboard toggle if ever needed.
 */
(function () {
  'use strict';

  const VERSION = '1.0.9';
  const DEFAULTS = {
    apiUrl: 'https://statbot.duckdns.org/api/v1/automation',
    apiKey: '',
  };
  const MONITOR_MS = 60 * 1000;
  const CLAIM_MS = 30 * 1000;
  const JITTER_MS = 10 * 1000;
  const RATE_LIMIT_PAUSE_MS = 60 * 1000;

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

  function request(settings, method, path, body, query) {
    let url = settings.apiUrl + path;
    if (query) url += (url.includes('?') ? '&' : '?') + query;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + settings.apiKey,
    };
    const payload = body ? JSON.stringify(body) : undefined;

    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method,
          url,
          headers,
          data: payload,
          timeout: 30000,
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

    return fetch(url, { method, headers, body: payload, credentials: 'omit' })
      .then(async (res) => parseStatus(res.status, await res.text()))
      .catch(() => { throw new Error('Server is unavailable.'); });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  function withJitter(ms) {
    return ms + Math.floor(Math.random() * JITTER_MS);
  }

  // --- Task-list parsing (page flight data, same shape the backend parses) --
  // Live bytes escape quotes with one backslash; tolerate two (copies vary).

  function fetchPageHtml() {
    try {
      return fetch(window.location.pathname, { credentials: 'include' })
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

  function parseAvailableTasks(html) {
    const out = [];
    const seen = {};
    // sub_task blocks use backslash-escaped quotes inside script payloads.
    const re = /\\{1,2}"sub_task\\{1,2}":\{\\{1,2}"id\\{1,2}":(\d+),\\{1,2}"type\\{1,2}":\\{1,2}"(post|comment)\\{1,2}",\\{1,2}"status\\{1,2}":(\d+),\\{1,2}"task_id\\{1,2}":(\d+)[\s\S]{0,2000}?\\{1,2}"grab_user_id\\{1,2}":(\d+)/g;
    let m = null;
    while ((m = re.exec(html)) !== null) {
      const subId = m[1];
      const type = m[2];
      const status = Number(m[3]);
      const taskId = m[4];
      const grab = Number(m[5]);
      if (seen[subId]) continue;
      seen[subId] = true;
      if (status !== 0 || grab !== 0) continue; // only unclaimed, available tasks

      let subreddit = null;
      let title = null;
      try {
        const qb = '\\\\{1,2}"';
        const taskRe = new RegExp(qb + 'task' + qb + ':\\{' + qb + 'id' + qb + ':' + taskId + ',[\\s\\S]{0,4000}?' + qb + 'subreddit_name' + qb + ':' + qb + '([A-Za-z0-9_ ]*?)' + qb);
        const tb = taskRe.exec(html);
        if (tb) {
          subreddit = tb[1] || null;
          const titleRe = new RegExp(qb + 'task' + qb + ':\\{' + qb + 'id' + qb + ':' + taskId + ',[\\s\\S]{0,6000}?' + qb + 'title' + qb + ':' + qb + '((?:[^\\\\]|\\\\.)*?)' + qb);
          const tt = titleRe.exec(html);
          if (tt) title = tt[1].replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>').slice(0, 300) || null;
        } else {
          const linkRe = new RegExp(qb + 'task' + qb + ':\\{' + qb + 'id' + qb + ':' + taskId + ',[\\s\\S]{0,4000}?' + qb + 'post_link' + qb + ':' + qb + '(.*?)' + qb);
          const lb = linkRe.exec(html);
          if (lb) {
            const sm = /reddit\.com\/r\/([A-Za-z0-9_]+)/i.exec(lb[1]);
            if (sm) subreddit = sm[1];
          }
        }
      } catch (e) { /* keep nulls */ }

      out.push({ subTaskId: Number(subId), type, subreddit, title });
    }
    return out;
  }

  // --- Monitor loop: report sightings --

  let monitorBusy = false;

  async function monitorTick() {
    if (monitorBusy || !watcherEnabled() || isRateLimited()) return;
    const settings = getSettings();
    if (!settings.apiKey) {
      setStatus(false, 'no API key - use Configure Sender');
      return;
    }
    // Only the /tasks page carries the listing.
    if (!/^\/tasks\/?$/.test(window.location.pathname)) return;
    monitorBusy = true;
    try {
      // Fresh SSR HTML always embeds the flight scripts; the live DOM may
      // have them stripped after hydration, so fetch first, DOM as fallback.
      let html = await fetchPageHtml();
      let source = 'fetch';
      if (!html) {
        html = domHtml();
        source = 'dom';
      }
      const tasks = parseAvailableTasks(html || '');
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
      monitorBusy = false;
    }
  }

  // --- Claim loop: accept in-page via native drawer flow when worker is confirmed ---

  let claimBusy = false;

  async function claimTick() {
    if (claimBusy || !watcherEnabled() || isRateLimited()) return;
    const settings = getSettings();
    if (!settings.apiKey) {
      setStatus(false, 'no API key - use Configure Sender');
      return;
    }
    claimBusy = true;
    try {
      const res = await request(settings, 'GET', '/claims/pending', null,
        'companionId=' + encodeURIComponent(getCompanionId()) + '&version=' + encodeURIComponent(VERSION));
      setStatus(true, 'poll ok');
      const claim = res && res.data && res.data.claim;
      if (!claim) return;
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

  async function reportClaim(settings, claim, ok, failureReason, pushed) {
    try {
      await request(settings, 'POST', '/claims/' + encodeURIComponent(claim.id) + '/result', {
        ok: !!ok,
        failureReason: failureReason || null,
        pushed: pushed === true,
      });
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
    for (const card of cards) {
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
      await reportClaim(settings, claim, false, 'Task #' + subTaskId + ' not found on /tasks (may already be taken or expired).');
      return;
    }

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

    // 3. Find the "Confirm acceptance" button
    const confirmBtn = Array.from(drawer.querySelectorAll('button')).find((b) =>
      (b.textContent || '').trim().toLowerCase().includes('confirm acceptance')
    );

    if (!confirmBtn) {
      closeOpenDrawer();
      await reportClaim(settings, claim, false, 'Confirm acceptance button not found in drawer.');
      return;
    }

    // 4. Click "Confirm acceptance"
    const acceptStartTime = Date.now();
    confirmBtn.click();

    // 5. Wait for GoPartTime confirmation (either via intercepted response or drawer closing)
    let accepted = false;
    let acceptError = null;

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

    if (!accepted) {
      closeOpenDrawer();
      const failReason = acceptError || 'GoPartTime acceptance timed out or drawer did not close.';
      await reportClaim(settings, claim, false, failReason);
      setStatus(false, 'accept #' + subTaskId + ' failed: ' + failReason);
      return;
    }

    // 6. Push full task details to the Discord ticket
    let pushed = false;
    try {
      const assignSettings = {
        apiUrl: settings.apiUrl.replace(/\/automation\/?$/, '/goparttime'),
        apiKey: settings.apiKey,
      };
      await request(assignSettings, 'POST', '/assign', detail, null);
      pushed = true;
      console.log('[Auto Watcher] task #' + subTaskId + ' assigned to ticket ' + claim.channelId);
    } catch (e) {
      console.log('[Auto Watcher] assign to ticket failed (task accepted, push manually):', e && e.message);
    }

    // 7. Report successful claim verdict (with push outcome for NEEDS_PUSH tracking)
    await reportClaim(settings, claim, true, null, pushed);
    if (pushed) {
      setStatus(true, 'accepted #' + subTaskId + ' & pushed');
    } else {
      setStatus(false, 'accepted #' + subTaskId + ' - PUSH MANUALLY via Send Task');
    }
  }

  // --- Loops --

  async function monitorLoop() {
    for (;;) {
      try {
        await monitorTick();
      } catch (e) { /* never break the loop */ }
      await sleep(withJitter(MONITOR_MS));
    }
  }

  async function claimLoop() {
    await sleep(5000); // let the page settle first
    for (;;) {
      try {
        await claimTick();
      } catch (e) { /* never break the loop */ }
      await sleep(withJitter(CLAIM_MS));
    }
  }

  if (watcherEnabled()) {
    monitorLoop();
    claimLoop();
  }
})();
