// ==UserScript==
// @name         GoPartTime Auto Watcher
// @namespace    https://goparttime.net/
// @version      1.0.1
// @description  Watches /tasks for new GoPartTime tasks, reports them to the StatBot backend, and performs in-page acceptance when the backend confirms a worker (hybrid automation - server never touches GoPartTime).
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
 * v1.0.1 - Hybrid companion for StatBot automation.
 *
 * Two loops, both best-effort and fully unattended:
 *  1. Monitor (every ~60s on /tasks): parses the page's embedded flight data
 *     for available sub-tasks and POSTs sightings to the backend. The backend
 *     validates (Post/duplicate/blocked), pings workers on Discord, and waits
 *     for confirmation - exactly like the manual flow.
 *  2. Claim (every ~20s, everywhere on goparttime.net): asks the backend for a
 *     pending claim. When the backend has a CONFIRMED worker, it performs the
 *     accept POST in-page (genuine session, genuine TLS, home IP), reports the
 *     verdict, then attempts the full detail push to the ticket via the
 *     existing /assign endpoint (same extraction as the Send Task button).
 *     If the push fails, the accept still stands and the manager can push
 *     manually with Send Task - nothing is lost.
 *
 * Auth/session never leave this browser. No passwords, no pasted cookies.
 * Disable anytime via the Tampermonkey menu ("Auto Watcher: ON/OFF").
 */
(function () {
  'use strict';

  const VERSION = '1.0.0';
  const DEFAULTS = {
    apiUrl: 'https://statbot.duckdns.org/api/v1/automation',
    apiKey: '',
  };
  const MONITOR_MS = 60 * 1000;
  const CLAIM_MS = 20 * 1000;
  const JITTER_MS = 10 * 1000;

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
    const stored = storageGet('gpt_auto_enabled');
    if (stored === '0' || stored === 'false') return false;
    return true;
  }

  function toggleWatcher() {
    const next = !watcherEnabled();
    storageSet('gpt_auto_enabled', next ? '1' : '0');
    alert('Auto Watcher is now ' + (next ? 'ON' : 'OFF') + '. Reloading...');
    location.reload();
  }

  function openSettings() {
    const s = getSettings();
    const base = s.apiUrl.replace(/\/api\/v1\/automation\/?$/, '');
    const apiUrl = prompt('Backend API URL (base, without /api/v1):', base || 'https://statbot.duckdns.org');
    if (apiUrl === null) return;
    const apiKey = prompt('API key (GOPARTTIME_API_KEY):', s.apiKey);
    if (apiKey === null) return;
    storageSet('gpt_api_url', (apiUrl.trim() || 'https://statbot.duckdns.org') + '/api/v1/goparttime');
    storageSet('gpt_api_key', apiKey.trim());
    alert('Settings saved.');
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Configure Sender...', openSettings);
    GM_registerMenuCommand('Auto Watcher: ON/OFF', toggleWatcher);
  }

  // --- HTTP (GM transport preferred, fetch fallback) --

  function parseStatus(status, responseText) {
    let json = null;
    try {
      json = JSON.parse(responseText);
    } catch (e) { /* non-JSON */ }
    if (status >= 200 && status < 300) return json || { success: true };
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

  function withJitter(ms) {
    return ms + Math.floor(Math.random() * JITTER_MS);
  }

  // --- Task-list parsing (page flight data, same shape the backend parses) --

  function parseAvailableTasks() {
    const html = document.documentElement ? document.documentElement.innerHTML : '';
    const out = [];
    const seen = {};
    // sub_task blocks use backslash-escaped quotes inside script payloads.
    const re = /\\"sub_task\\":\{"id":(\d+),"type":"(post|comment)","status":(\d+),"task_id":(\d+)[\s\S]{0,2000}?"grab_user_id":(\d+)/g;
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
        const taskRe = new RegExp('\\\\"task\\\\":\\{"id\\\\":' + taskId + ',[\\s\\S]{0,4000}?\\\\"subreddit_name\\\\":\\\\"([A-Za-z0-9_ ]*?)\\\\"');
        const tb = taskRe.exec(html);
        if (tb) {
          subreddit = tb[1] || null;
          const titleRe = new RegExp('\\\\"task\\\\":\\{"id\\\\":' + taskId + ',[\\s\\S]{0,6000}?\\\\"title\\\\":\\\\"((?:[^\\\\]|\\\\.)*?)\\\\"');
          const tt = titleRe.exec(html);
          if (tt) title = tt[1].replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>').slice(0, 300) || null;
        } else {
          const linkRe = new RegExp('\\\\"task\\\\":\\{"id\\\\":' + taskId + ',[\\s\\S]{0,4000}?\\\\"post_link\\\\":\\\\"(.*?)\\\\"');
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

  function findNextAction() {
    try {
      const html = document.documentElement ? document.documentElement.innerHTML : '';
      const m = /\b[0-9a-f]{64}\b/.exec(html);
      return m ? m[0] : null;
    } catch (e) {
      return null;
    }
  }

  // --- Monitor loop: report sightings --

  let monitorBusy = false;

  async function monitorTick() {
    if (monitorBusy || !watcherEnabled()) return;
    const settings = getSettings();
    if (!settings.apiKey) return;
    // Only the /tasks page carries the listing.
    if (!/^\/tasks\/?$/.test(window.location.pathname)) return;
    monitorBusy = true;
    try {
      const tasks = parseAvailableTasks();
      if (tasks.length === 0) return;
      await request(settings, 'POST', '/sightings', {
        companionId: getCompanionId(),
        version: VERSION,
        tasks,
      });
    } catch (e) {
      console.log('[Auto Watcher] sightings failed:', e && e.message);
    } finally {
      monitorBusy = false;
    }
  }

  // --- Claim loop: accept in-page when the backend has a confirmed worker --

  let claimBusy = false;

  async function claimTick() {
    if (claimBusy || !watcherEnabled()) return;
    const settings = getSettings();
    if (!settings.apiKey) return;
    claimBusy = true;
    try {
      const res = await request(settings, 'GET', '/claims/pending', null,
        'companionId=' + encodeURIComponent(getCompanionId()) + '&version=' + encodeURIComponent(VERSION));
      const claim = res && res.data && res.data.claim;
      if (!claim) return;
      await processClaim(settings, claim);
    } catch (e) {
      console.log('[Auto Watcher] claim poll failed:', e && e.message);
    } finally {
      claimBusy = false;
    }
  }

  async function reportClaim(settings, claim, ok, failureReason) {
    try {
      await request(settings, 'POST', '/claims/' + encodeURIComponent(claim.id) + '/result', {
        ok: !!ok,
        failureReason: failureReason || null,
      });
    } catch (e) {
      console.log('[Auto Watcher] claim report failed:', e && e.message);
    }
  }

  async function processClaim(settings, claim) {
    const subTaskId = Number(claim.externalTaskId);
    if (!subTaskId) {
      await reportClaim(settings, claim, false, 'Invalid task id in claim.');
      return;
    }

    const nextAction = findNextAction();
    if (!nextAction) {
      await reportClaim(settings, claim, false, 'Next-Action id not found on page; reload /tasks.');
      return;
    }

    // In-page accept: same request the manual Accept button makes.
    let acceptText = '';
    try {
      const res = await fetch('/tasks', {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'text/x-component',
          'Content-Type': 'text/plain;charset=UTF-8',
          'Next-Action': nextAction,
        },
        body: JSON.stringify([{ sub_task_id: subTaskId }]),
      });
      acceptText = await res.text();
    } catch (e) {
      await reportClaim(settings, claim, false, 'Accept request failed: ' + (e && e.message));
      return;
    }

    if (!/"success":\s*true/.test(acceptText)) {
      await reportClaim(settings, claim, false, 'GoPartTime did not confirm (task may be taken).');
      return;
    }

    // Accept recorded - now attempt the full detail push to the ticket.
    try {
      const pushed = await pushTaskToTicket(settings, claim, subTaskId);
      console.log('[Auto Watcher] claim ' + claim.id + ' accepted, detail push: ' + (pushed ? 'sent' : 'manual needed'));
    } catch (e) {
      console.log('[Auto Watcher] detail push failed (accept stands, push manually):', e && e.message);
    }
    await reportClaim(settings, claim, true, null);
  }

  // --- Detail push: open the task dialog, extract, send via /assign --

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

  function extractTaskDetail() {
    const root = findTaskRoot();
    if (!root) throw new Error('No task detail open.');
    const taskIdText = findField('Task ID', root);
    if (!taskIdText || !/^\d+$/.test(taskIdText)) throw new Error('Could not detect task ID.');
    const typeText = (findField('Task Type', root) || '').toLowerCase();
    const type = typeText === 'post' ? 'post' : 'comment';
    const deadline = findField('Deadline', root) || null;
    const payment = findField('Payment', root) || null;
    const images = extractImages(root);
    const contentEl = root.querySelector('div.prose');
    const contentHtml = contentEl ? contentEl.innerHTML : '';
    if (!contentHtml.trim() && images.length === 0) throw new Error('Could not extract task content.');

    let subreddit = null;
    let subredditUrl = null;
    let flair = null;
    let title = null;
    let postLink = null;
    let commentLink = null;
    if (type === 'post') {
      const subInput = root.querySelector('input[name="subreddit"]');
      subreddit = subInput ? (subInput.value || '').trim() || null : null;
      if (subreddit) subredditUrl = 'https://www.reddit.com/r/' + subreddit.replace(/^r\//, '') + '/';
      const flairInput = root.querySelector('input[name="flair"]');
      flair = flairInput ? (flairInput.value || '').trim() || null : null;
      const titleInput = root.querySelector('input[name="title"]');
      title = titleInput ? (titleInput.value || '').trim() || null : null;
    } else {
      const postLinkInput = root.querySelector('input[name="post_link"]');
      postLink = postLinkInput ? (postLinkInput.value || '').trim() || null : null;
      const commentLinkInput = root.querySelector('input[name="comment_link"]');
      commentLink = commentLinkInput ? (commentLinkInput.value || '').trim() || null : null;
    }

    return {
      taskId: Number(taskIdText), type, deadline, payment,
      subreddit, subredditUrl, flair, title, postLink, commentLink,
      contentHtml, images, sourceUrl: window.location.href,
    };
  }

  function findCardForTask(subTaskId) {
    const cards = Array.from(document.querySelectorAll('div[data-slot="card"]'));
    const needle = String(subTaskId);
    for (const card of cards) {
      const text = card.textContent || '';
      if (text.includes('#' + needle) || text.includes('Task ID') && text.includes(needle)) return card;
    }
    return null;
  }

  function closeDialog() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  async function pushTaskToTicket(settings, claim, subTaskId) {
    // Must be on the list page to find the card.
    if (!/^\/tasks\/?$/.test(window.location.pathname)) return false;
    const card = findCardForTask(subTaskId);
    if (!card) return false;
    card.scrollIntoView({ block: 'center' });
    await sleep(500);
    card.click();
    // Wait for the detail dialog.
    let root = null;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      root = findTaskRoot();
      if (root && root !== document) break;
      root = null;
    }
    if (!root) return false;
    try {
      const detail = extractTaskDetail();
      if (Number(detail.taskId) !== Number(subTaskId)) return false;
      detail.ticket = claim.channelId;
      // The assign endpoint lives under /goparttime (existing pipeline).
      const assignSettings = {
        apiUrl: settings.apiUrl.replace(/\/automation\/?$/, '/goparttime'),
        apiKey: settings.apiKey,
      };
      await request(assignSettings, 'POST', '/assign', detail, null);
      return true;
    } finally {
      try {
        closeDialog();
      } catch (e) { /* ignore */ }
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
