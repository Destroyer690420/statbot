// ==UserScript==
// @name         GoPartTime Mobile (Send + Submit Link)
// @namespace    https://goparttime.net/
// @version      1.0.0
// @description  Lightweight mobile companion: Send Task to Discord via the Statbot backend, plus automatic Submit Link autofill when you tap a card's Submit Task button (no extra button needed).
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
 * v1.0.0 — Mobile-only companion with exactly two jobs:
 *
 *  1. SEND TASK: one floating 📤 button. Open a task's detail view, tap 📤,
 *     pick the ticket, Send. Same backend call as the desktop script
 *     (POST /api/v1/goparttime/assign).
 *
 *  2. SUBMIT LINK (automatic, no button): tapping the site's own
 *     "Submit Task" button on a /my-tasks card fills the dialog's
 *     post/comment URL with the link the worker already sent in their
 *     Discord ticket (GET /api/v1/goparttime/submission/:taskId).
 *     Silent on success — a popup appears ONLY when no link is stored yet
 *     or on a real error. Never clicks the dialog's own Submit button.
 *
 * Mobile hardening vs the desktop script:
 *  - Button match is tolerant (`includes('Submit Task')`): mobile layouts
 *    may add icons/whitespace around the label.
 *  - Card lookup falls back to walking up ancestors for the "Task ID" label
 *    when the card wrapper differs on mobile.
 *  - The submit dialog is waited up to ~4s (mobile renders slower).
 *  - Feedback is a small auto-hiding toast; `alert()` is reserved for the
 *    no-link / error cases that need the manager's attention.
 *  - Shares storage keys (`gpt_api_url`, `gpt_api_key`) with the desktop
 *    "Discord Task Sender" script, so a key already saved by that script on
 *    this device is reused — configure once.
 */
(function () {
  'use strict';

  const DEFAULTS = {
    apiUrl: 'https://statbot.duckdns.org/api/v1/goparttime',
    apiKey: '',
  };

  // ─── Storage (GM_* when available, localStorage otherwise) ──

  function storageGet(key) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, '') || '';
    } catch (e) {
      /* fall through */
    }
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
    } catch (e) {
      /* fall through */
    }
    try {
      localStorage.setItem('gpt_' + key, value);
    } catch (e) {
      /* ignore */
    }
  }

  // ─── Settings ───────────────────────────────────────────────

  function getSettings() {
    return {
      apiUrl: storageGet('gpt_api_url').trim() || DEFAULTS.apiUrl,
      apiKey: storageGet('gpt_api_key').trim() || DEFAULTS.apiKey,
    };
  }

  function openSettings() {
    const s = getSettings();
    const apiUrl = prompt('Backend API URL (base, without /api/v1):', s.apiUrl.replace(/\/api\/v1\/goparttime\/?$/, ''));
    if (apiUrl === null) return;
    const apiKey = prompt('API key (GOPARTTIME_API_KEY):', s.apiKey);
    if (apiKey === null) return;
    storageSet('gpt_api_url', (apiUrl.trim() || DEFAULTS.apiUrl) + '/api/v1/goparttime');
    storageSet('gpt_api_key', apiKey.trim());
    toast('Settings saved.', true);
  }

  function ensureConfigured() {
    const s = getSettings();
    if (s.apiKey) return s;
    const apiKey = prompt('Paste the API key (GOPARTTIME_API_KEY) once — it is saved on this device:');
    if (!apiKey) return null;
    storageSet('gpt_api_key', apiKey.trim());
    return getSettings();
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('⚙️ Configure Mobile...', openSettings);
  }

  // ─── Tiny toast (non-blocking feedback) ─────────────────────

  let toastTimer = null;

  function toast(msg, ok) {
    try {
      let el = document.getElementById('gpt-mobile-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'gpt-mobile-toast';
        Object.assign(el.style, {
          position: 'fixed',
          left: '12px',
          bottom: '80px',
          zIndex: '2147483647',
          maxWidth: '70vw',
          padding: '8px 12px',
          borderRadius: '8px',
          fontSize: '12px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: '#fff',
          pointerEvents: 'none',
        });
        document.body.appendChild(el);
      }
      el.style.background = ok === false ? 'rgba(160, 30, 30, 0.92)' : 'rgba(20, 120, 60, 0.92)';
      el.textContent = msg;
      el.style.display = 'block';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { try { el.style.display = 'none'; } catch (e) {} }, 4000);
    } catch (e) { /* never break flows for UI */ }
  }

  // ─── API ────────────────────────────────────────────────────

  function parseStatus(status, responseText) {
    let json = null;
    try {
      json = JSON.parse(responseText);
    } catch (e) {
      // non-JSON response
    }
    if (status >= 200 && status < 300) {
      return json || { success: true };
    }
    const rawMessage = (json && json.message) || '';
    const errors = json && Array.isArray(json.errors) ? json.errors : [];
    const detail = errors.join('; ');
    let message = rawMessage;
    if (detail) {
      if (!rawMessage || !rawMessage.includes(detail)) {
        message = rawMessage ? rawMessage + ' ' + detail : detail;
      }
    }
    if (status === 409) throw new Error(message || 'Task has already been assigned.');
    if (status === 401) throw new Error('Authentication failed. Check your API key.');
    if (status === 503) throw new Error('Extension endpoint is not configured on the server.');
    throw new Error(message || ('Server error (' + status + ').'));
  }

  function request(settings, method, path, body) {
    const url = settings.apiUrl + path;
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

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 30000) : null;
    return fetch(url, {
      method,
      headers,
      body: payload,
      credentials: 'omit',
      signal: controller ? controller.signal : undefined,
    })
      .then(async (res) => {
        const text = await res.text();
        if (timer) clearTimeout(timer);
        return parseStatus(res.status, text);
      })
      .catch((err) => {
        if (timer) clearTimeout(timer);
        if (err && err.name === 'AbortError') throw new Error('Server is unavailable (timeout).');
        throw new Error('Server is unavailable.');
      });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ─── Shared card helpers ────────────────────────────────────

  // Reads the "Task ID" field off a task card. The card renders the label and
  // its value as sibling elements, so the value is the label's next sibling.
  function detectCardTaskId(card) {
    const nodes = card.querySelectorAll('div, span');
    for (const el of nodes) {
      if (el.children.length === 0 && (el.textContent || '').trim() === 'Task ID') {
        const sibling = el.nextElementSibling;
        if (sibling) {
          const value = (sibling.textContent || '').trim();
          if (/^\d+$/.test(value)) return value;
        }
      }
    }
    return null;
  }

  // Mobile fallback: when the card wrapper is not `div[data-slot="card"]`,
  // walk up from the button looking for an ancestor that contains a Task ID.
  function findTaskIdNearButton(btn) {
    let card = btn.closest ? btn.closest('div[data-slot="card"]') : null;
    if (card) {
      const id = detectCardTaskId(card);
      if (id) return { card, taskId: id };
    }
    let node = btn.parentElement;
    for (let i = 0; i < 8 && node; i++) {
      try {
        const id = detectCardTaskId(node);
        if (id) return { card: node, taskId: id };
      } catch (e) { /* keep climbing */ }
      node = node.parentElement;
    }
    return null;
  }

  // ─── Feature 1: Send Task ───────────────────────────────────

  const sendButton = document.createElement('button');
  sendButton.id = 'gpt-mobile-send-button';
  sendButton.textContent = '📤';
  Object.assign(sendButton.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '2147483647',
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    border: 'none',
    background: '#5865F2',
    color: '#fff',
    fontSize: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  });
  // The site's modal dialogs (Radix/Vaul) set pointer-events:none on <body>
  // while open, which would silently disable this button.
  sendButton.style.setProperty('pointer-events', 'auto', 'important');
  // Capture the task on pointerdown (dialog still open at that instant) and
  // stop the event from closing the site's dialog.
  sendButton.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    captureTask();
  });
  sendButton.addEventListener('click', openModal);
  document.body.appendChild(sendButton);

  let modal = null;
  let pendingTask = null;
  let pendingTaskError = null;

  function captureTask() {
    pendingTask = null;
    pendingTaskError = null;
    try {
      pendingTask = extractTask();
    } catch (err) {
      pendingTaskError = err.message;
    }
  }

  function openModal() {
    if (modal) return;
    const settings = ensureConfigured();
    if (!settings) {
      toast('API key needed — tap again after saving.', false);
      return;
    }

    modal = document.createElement('div');
    modal.id = 'gpt-mobile-modal';
    Object.assign(modal.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      background: 'rgba(0,0,0,0.55)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });
    modal.style.setProperty('pointer-events', 'auto', 'important');
    modal.innerHTML =
      '<div id="gpt-mobile-modal-card" style="pointer-events:auto!important;position:relative;z-index:2147483647;background:#fff;border-radius:14px;padding:20px;width:340px;max-width:92vw;max-height:88vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.4);color:#111">' +
      '<h3 style="margin:0 0 14px;font-size:18px;font-weight:700">Assign Task</h3>' +
      '<label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px">Ticket</label>' +
      '<select id="gpt-ticket-select" style="width:100%;padding:12px;border:1px solid #ccc;border-radius:8px;font-size:16px;background:#fff;color:#111;margin-bottom:12px">' +
      '<option value="">Loading tickets…</option>' +
      '</select>' +
      '<p id="gpt-status" style="font-size:13px;color:#666;margin:0 0 12px;min-height:18px"></p>' +
      '<div style="display:flex;justify-content:flex-end;gap:10px;align-items:center">' +
      '<button id="gpt-cancel" style="padding:12px 18px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#333;font-size:15px;font-weight:600;cursor:pointer">Cancel</button>' +
      '<button id="gpt-send" style="padding:12px 18px;border:none;border-radius:8px;background:#5865F2;color:#fff;font-size:15px;font-weight:600;cursor:pointer" disabled>Send</button>' +
      '</div></div>';

    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
    modal.addEventListener('pointerdown', (e) => e.stopPropagation());
    const modalCard = modal.querySelector('#gpt-mobile-modal-card');
    if (modalCard) modalCard.addEventListener('pointerdown', (e) => e.stopPropagation());
    modal.querySelector('#gpt-cancel').addEventListener('click', closeModal);

    const select = modal.querySelector('#gpt-ticket-select');
    const status = modal.querySelector('#gpt-status');
    const sendBtn = modal.querySelector('#gpt-send');

    if (pendingTask) {
      const label = pendingTask.type === 'post' ? 'Post' : 'Comment';
      status.textContent = 'Detected: Task #' + pendingTask.taskId + ' — ' + label;
    } else {
      status.textContent = '⚠️ ' + (pendingTaskError || 'No task detected. Open a task first, then tap 📤.');
    }

    request(settings, 'GET', '/tickets')
      .then((res) => {
        const tickets = res.data || [];
        select.innerHTML = '';
        if (!tickets.length) {
          select.innerHTML = '<option value="">No tickets available</option>';
          return;
        }
        tickets.forEach((t) => {
          const opt = document.createElement('option');
          opt.value = t.channelId;
          opt.textContent = '#' + (t.channelName || t.channelId) + ' — ' + t.taskStatus;
          select.appendChild(opt);
        });
        if (pendingTask) sendBtn.disabled = false;
      })
      .catch((err) => {
        status.textContent = '⚠️ ' + err.message;
      });

    sendBtn.addEventListener('click', () => {
      const ticketId = select.value;
      if (!ticketId) {
        status.textContent = '⚠️ Please select a ticket.';
        return;
      }
      if (!pendingTask) {
        status.textContent = '⚠️ No task detected. Close this and open the task detail view first.';
        return;
      }
      sendBtn.disabled = true;

      const extracted = Object.assign({}, pendingTask);
      extracted.ticket = ticketId;
      status.textContent = 'Sending to backend…';

      request(settings, 'POST', '/assign', extracted)
        .then((result) => {
          if (result.failed) {
            status.textContent = '⚠️ Task created but delivery failed: ' + (result.error || 'unknown error') + '. Retry in the dashboard.';
            sendBtn.disabled = false;
            return;
          }
          pendingTask = null;
          status.textContent = '✅ Task assigned successfully.';
          toast('Task assigned ✓', true);
          setTimeout(closeModal, 1200);
        })
        .catch((err) => {
          status.textContent = '⚠️ ' + err.message;
          sendBtn.disabled = false;
        });
    });
  }

  function closeModal() {
    if (modal) {
      modal.remove();
      modal = null;
    }
  }

  // ─── Feature 2: Submit Link autofill (automatic, no button) ──
  //
  // Tapping the site's own "Submit Task" button on a /my-tasks card opens a
  // dialog asking for the post/comment URL. That URL is already on Statbot
  // (the worker's Discord reply stored it), so this reads it back via
  // GET /goparttime/submission/:taskId and fills the field. Strictly
  // assistive: it NEVER clicks the dialog's own Submit button. The manager
  // still reviews the link and submits.

  let trackedSubmitCard = null;
  let submitLinkBusy = false;

  // Capture-phase so the card is read before the site re-renders the list.
  // Tolerant match: mobile layouts may wrap the label with icons/whitespace.
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button[data-slot="button"], button') : null;
    if (!btn) return;
    const text = (btn.textContent || '').trim();
    if (text.indexOf('Submit Task') === -1) return; // never the dialog's inner "Submit"
    const found = findTaskIdNearButton(btn);
    if (!found || !found.taskId) return;
    trackedSubmitCard = found;
    // The native click is already opening the dialog, so run immediately; the
    // flow waits for the dialog itself and is busy-guarded against double taps.
    try {
      submitLinkFlow();
    } catch (err) { /* flow reports internally; never break the page */ }
  }, true);

  function findSubmitLinkDialog() {
    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"][data-slot="dialog-content"], div[role="dialog"]'));
    return dialogs.find((d) => d.querySelector('input[name="redditUrl"]')) || null;
  }

  // The dialog is opened by the click we are reacting to, so it may not be in
  // the DOM yet. Poll briefly rather than assuming (longer on mobile).
  async function waitForSubmitLinkDialog() {
    for (let i = 0; i < 50; i++) {
      const dialog = findSubmitLinkDialog();
      if (dialog) return dialog;
      await sleep(80);
    }
    return null;
  }

  /**
   * Writes a value into a React-controlled input so React actually registers
   * it. Assigning `input.value` directly updates the DOM but not React's
   * internal state tracker, so the next render reverts the field to empty.
   */
  function setReactInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function submitLinkFlow() {
    if (submitLinkBusy) return;
    const settings = getSettings();
    if (!settings.apiKey) {
      alert('Submit Link is not configured. Open the Tampermonkey menu → "⚙️ Configure Mobile..." first.');
      return;
    }
    if (!trackedSubmitCard) {
      alert('Tap the "Submit Task" button on a task card first.');
      return;
    }

    const taskId = trackedSubmitCard.taskId;
    submitLinkBusy = true;
    try {
      const dialog = findSubmitLinkDialog() || (await waitForSubmitLinkDialog());
      if (!dialog) {
        alert('Could not find the submit-link dialog. Open it manually and tap "Submit Task" again.');
        return;
      }
      const input = dialog.querySelector('input[name="redditUrl"]');
      if (!input) {
        alert('Could not find the post/comment URL field in the dialog.');
        return;
      }

      // Never clobber a link the manager typed or corrected by hand.
      // Silent either way: a popup is only for "no link available yet".
      if ((input.value || '').trim()) {
        try { console.log('[Mobile] Submit Link: URL field already filled — left untouched.'); } catch (e) {}
        toast('Field already filled — left as-is.', true);
        return;
      }

      toast('Fetching link…', true);
      const data = await request(settings, 'GET', '/submission/' + taskId).then((res) => res.data);
      if (!data || !data.redditUrl) {
        alert(
          (data && data.message ? data.message : 'No submitted URL for this task yet.') +
          '\n\nAsk the worker to reply to the assignment message in their Discord ticket with their post/comment link — that reply is what stores it here.',
        );
        return;
      }

      setReactInputValue(input, data.redditUrl);
      // Silent success: the link is pasted, the manager reviews it and taps
      // Submit. Popups are reserved for the no-link / error cases above.
      try { console.log('[Mobile] Submit Link: link filled for task ' + taskId + '.'); } catch (e) {}
      toast('Link pasted ✓ — review, then Submit.', true);
    } catch (err) {
      alert('⚠️ ' + (err && err.message ? err.message : 'Submit Link failed.'));
    } finally {
      submitLinkBusy = false;
    }
  }

  // ─── DOM Extraction (task detail → backend payload) ──────────

  /**
   * Finds the container that holds the open task. Desktop renders the detail
   * as a dialog (role="dialog"); some mobile layouts may not, so fall back to
   * the nearest ancestor that contains both the "Task ID" label and the
   * content element (div.prose).
   */
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
    // The site renders field labels as <span> (Task ID, Deadline, Payment) or
    // <div> (Task Type). Scan leaf elements for an exact label match and read
    // the value from the next sibling element.
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

  function extractTask() {
    // Scope extraction to the open task container so we never match the Task
    // ID labels on the list page behind it.
    const root = findTaskRoot();
    if (!root) {
      throw new Error('Open a task to see its detail view, then tap 📤.');
    }

    const taskIdText = findField('Task ID', root);
    if (!taskIdText || !/^\d+$/.test(taskIdText)) {
      throw new Error('Could not detect task ID.');
    }
    const taskId = Number(taskIdText);

    const typeText = (findField('Task Type', root) || '').toLowerCase();
    if (typeText !== 'post' && typeText !== 'comment') {
      throw new Error('Could not determine task type.');
    }
    const type = typeText === 'post' ? 'post' : 'comment';

    const deadline = findField('Deadline', root) || null;
    const payment = findField('Payment', root) || null;

    const images = extractImages(root);

    const contentEl = root.querySelector('div.prose');
    const contentHtml = contentEl ? contentEl.innerHTML : '';

    if (!contentHtml.trim() && images.length === 0) {
      throw new Error('Could not extract task content.');
    }

    let subreddit = null;
    let subredditUrl = null;
    let flair = null;
    let title = null;
    let postLink = null;
    let commentLink = null;

    if (type === 'post') {
      const subInput = root.querySelector('input[name="subreddit"]');
      subreddit = subInput ? (subInput.value || '').trim() || null : null;
      if (subreddit) {
        const cleanName = subreddit.replace(/^r\//, '');
        subredditUrl = 'https://www.reddit.com/r/' + cleanName + '/';
      }
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
      taskId,
      type,
      deadline,
      payment,
      subreddit,
      subredditUrl,
      flair,
      title,
      postLink,
      commentLink,
      contentHtml,
      images,
      sourceUrl: window.location.href,
    };
  }

  // ─── media-extraction:start ─── (extracted verbatim by
  // src/__tests__/userscript-media.test.ts — keep the sentinels)
  function extractImages(root) {
    // Walks <img> AND <video> in document order. A task whose media is a video
    // renders as <video poster="…jpg"><source src="…mp4"></video> — no <img>
    // anywhere — so an img-only query dropped the video entirely and the
    // backend never got a chance to send (or compress) it.
    const nodes = Array.from((root || document).querySelectorAll('img, video'));

    const media = [];
    for (const node of nodes) {
      if (media.length >= 20) break;
      if (node.closest('button')) continue;

      if (node.tagName === 'IMG') {
        const alt = (node.alt || '').trim();
        const src = (node.src || '').trim();
        if (!/^https?:\/\//.test(alt) && !/^https?:\/\//.test(src)) continue;
        // Skip small UI icons; task images are sized thumbnails or larger.
        if (node.naturalWidth && node.naturalWidth < 60) continue;
        // Prefer the original URL in the alt attribute (not Next.js-optimized).
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

    // HLS playlist or an extensionless source: Discord cannot play those, so
    // fall back to the poster frame. Still far better than no media at all.
    const poster = (node.getAttribute('poster') || '').trim();
    if (/^https?:\/\//.test(poster)) return { url: poster, kind: 'image' };
    return null;
  }
  // ─── media-extraction:end ───
})();
