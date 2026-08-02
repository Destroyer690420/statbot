// ==UserScript==
// @name         Discord Task Sender
// @namespace    https://goparttime.net/
// @version      1.0.3
// @description  Sends the open task to your Discord ticket via the Reddit Task Manager backend.
// @author       Manager
// @match        *://goparttime.net/*
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

(function () {
  'use strict';

  const DEFAULTS = {
    apiUrl: 'https://statbot.duckdns.org/api/v1/goparttime',
    apiKey: '',
  };

  // ─── Settings ───────────────────────────────────────────────

  function getSettings() {
    return {
      apiUrl: (GM_getValue('gpt_api_url', '') || '').trim() || DEFAULTS.apiUrl,
      apiKey: (GM_getValue('gpt_api_key', '') || '').trim() || DEFAULTS.apiKey,
    };
  }

  GM_registerMenuCommand('⚙️ Configure Sender...', () => {
    const s = getSettings();
    const apiUrl = prompt('Backend API URL (base, without /api/v1):', s.apiUrl.replace(/\/api\/v1\/goparttime\/?$/, ''));
    if (apiUrl === null) return;
    const apiKey = prompt('API key (GOPARTTIME_API_KEY):', s.apiKey);
    if (apiKey === null) return;
    GM_setValue('gpt_api_url', (apiUrl.trim() || DEFAULTS.apiUrl) + '/api/v1/goparttime');
    GM_setValue('gpt_api_key', apiKey.trim());
    alert('Settings saved.');
  });

  // ─── UI ─────────────────────────────────────────────────────

  const button = document.createElement('button');
  button.id = 'gpt-send-task-button';
  button.textContent = '📤 Send Task';
  Object.assign(button.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '2147483647',
    padding: '12px 18px',
    border: 'none',
    borderRadius: '10px',
    background: '#5865F2',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  });
  // The site's modal dialogs (Radix/Vaul) set pointer-events:none on <body> while
  // open, which would silently disable this button. Re-enable it explicitly.
  button.style.setProperty('pointer-events', 'auto', 'important');
  // Radix dialogs dismiss on any pointerdown OUTSIDE the dialog content. Our
  // button is outside it, so capture the task on pointerdown (the dialog is
  // still open at that instant) and stop the event from closing the dialog.
  button.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    captureTask();
  });
  button.addEventListener('click', openModal);
  document.body.appendChild(button);

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
    const settings = getSettings();
    if (!settings.apiKey) {
      alert('Discord Task Sender is not configured. Use Tampermonkey menu → "⚙️ Configure Sender..." first.');
      return;
    }

    modal = document.createElement('div');
    modal.id = 'gpt-modal';
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
    // Same body pointer-events lock protection as the button.
    modal.style.setProperty('pointer-events', 'auto', 'important');
    modal.innerHTML = `
      <div id="gpt-modal-card" style="pointer-events:auto!important;position:relative;z-index:2147483647;background:#fff;border-radius:14px;padding:24px;width:360px;max-width:90vw;box-shadow:0 8px 40px rgba(0,0,0,0.4);color:#111">
        <h3 style="margin:0 0 16px;font-size:18px;font-weight:700">Assign Task</h3>
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px">Ticket</label>
        <select id="gpt-ticket-select" style="width:100%;padding:10px 12px;border:1px solid #ccc;border-radius:8px;font-size:14px;background:#fff;color:#111;margin-bottom:16px">
          <option value="">Loading tickets…</option>
        </select>
        <p id="gpt-status" style="font-size:13px;color:#666;margin:0 0 12px;min-height:18px"></p>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button id="gpt-cancel" style="padding:9px 16px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#333;font-size:14px;cursor:pointer">Cancel</button>
          <button id="gpt-send" style="padding:9px 16px;border:none;border-radius:8px;background:#5865F2;color:#fff;font-size:14px;font-weight:600;cursor:pointer" disabled>Send</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
    // Keep the site's dialog open while interacting with our modal.
    modal.addEventListener('pointerdown', (e) => e.stopPropagation());
    const modalCard = modal.querySelector('#gpt-modal-card');
    if (modalCard) modalCard.addEventListener('pointerdown', (e) => e.stopPropagation());
    modal.querySelector('#gpt-cancel').addEventListener('click', closeModal);

    const select = modal.querySelector('#gpt-ticket-select');
    const status = modal.querySelector('#gpt-status');
    const sendBtn = modal.querySelector('#gpt-send');

    if (pendingTask) {
      const label = pendingTask.type === 'post' ? 'Post' : 'Comment';
      status.textContent = `Detected: Task #${pendingTask.taskId} — ${label}`;
    } else {
      status.textContent = `⚠️ ${pendingTaskError || 'No task detected. Open a task first, then click Send Task.'}`;
    }

    fetchTickets(settings)
      .then((tickets) => {
        select.innerHTML = '';
        if (!tickets.length) {
          select.innerHTML = '<option value="">No tickets available</option>';
          return;
        }
        tickets.forEach((t) => {
          const opt = document.createElement('option');
          opt.value = t.channelId;
          opt.textContent = `#${t.channelName || t.channelId} — ${t.taskStatus}`;
          select.appendChild(opt);
        });
        // Enable Send only when a task was captured on pointerdown.
        if (pendingTask) sendBtn.disabled = false;
      })
      .catch((err) => {
        status.textContent = `⚠️ ${err.message}`;
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

      sendToBackend(settings, extracted)
        .then((result) => {
          if (result.failed) {
            status.textContent = `⚠️ Task created but delivery failed: ${result.error || 'unknown error'}. Retry in the dashboard.`;
            sendBtn.disabled = false;
            return;
          }
          pendingTask = null;
          status.textContent = '✅ Task assigned successfully.';
          setTimeout(closeModal, 1200);
        })
        .catch((err) => {
          status.textContent = `⚠️ ${err.message}`;
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

  // ─── API ────────────────────────────────────────────────────

  function request(settings, method, path, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: settings.apiUrl + path,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + settings.apiKey,
        },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 30000,
        onload: (res) => {
          let json = null;
          try {
            json = JSON.parse(res.responseText);
          } catch {
            // non-JSON response
          }
          if (res.status >= 200 && res.status < 300) {
            resolve(json || { success: true });
          } else if (res.status === 409) {
            reject(new Error(json && json.message ? json.message : 'Task has already been assigned.'));
          } else if (res.status === 401) {
            reject(new Error('Authentication failed. Check your API key.'));
          } else if (res.status === 503) {
            reject(new Error('Extension endpoint is not configured on the server.'));
          } else {
            reject(new Error(json && json.message ? json.message : `Server error (${res.status}).`));
          }
        },
        onerror: () => reject(new Error('Server is unavailable.')),
        ontimeout: () => reject(new Error('Server is unavailable (timeout).')),
      });
    });
  }

  function fetchTickets(settings) {
    return request(settings, 'GET', '/tickets').then((res) => res.data || []);
  }

  function sendToBackend(settings, payload) {
    return request(settings, 'POST', '/assign', payload).then((res) => ({
      failed: !!res.failed,
      error: res.error,
    }));
  }

  // ─── DOM Extraction ─────────────────────────────────────────

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
    // The task detail is a dialog (role="dialog"). Scope all extraction to it
    // so we never match the Task ID labels on the list page behind it.
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) {
      throw new Error('Open a task to see its detail view, then click Send Task.');
    }
    const root = dialog;

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

    const contentEl = root.querySelector('div.prose');
    if (!contentEl) {
      throw new Error('Could not extract task content.');
    }
    const contentHtml = contentEl.innerHTML;

    let subreddit = null;
    let subredditUrl = null;
    let flair = null;
    let title = null;
    let postLink = null;

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
    }

    const images = extractImages(root);

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
      contentHtml,
      images,
      sourceUrl: window.location.href,
    };
  }

  function extractImages(root) {
    const imgs = Array.from((root || document).querySelectorAll('img')).filter((img) => {
      if (img.closest('button')) return false;
      const alt = (img.alt || '').trim();
      const src = (img.src || '').trim();
      if (!/^https?:\/\//.test(alt) && !/^https?:\/\//.test(src)) return false;
      // Skip small UI icons; task images are sized thumbnails or larger.
      if (img.naturalWidth && img.naturalWidth < 60) return false;
      return true;
    });

    return imgs
      .slice(0, 20)
      .map((img, index) => ({
        order: index + 1,
        // Prefer the original URL in the alt attribute (not Next.js-optimized).
        url: (img.alt || '').trim() || img.src,
      }));
  }
})();
