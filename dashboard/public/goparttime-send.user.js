// ==UserScript==
// @name         Discord Task Sender
// @namespace    https://goparttime.net/
// @version      1.4.3
// @description  Sends the open task to your Discord ticket via the Reddit Task Manager backend (desktop + mobile) and automates GoPartTime view-data submission with the stored Statbot insight screenshot.
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
 * v1.4.3 — Surface Zod validation details (Validation failed: field: message)
 * and keep v1.4.2 image-only fix (contentHtml may be empty when images exist,
 * e.g. task #880072 r/Nocfree). v1.4.0 disabled Submit View on phones — the
 * "📊 Submit View" button, card tracking, and screenshot preview are
 * auto-disabled on narrow (mobile, ≤767px) viewports — insights are only
 * submitted from the PC. Everything else (Send Task, settings, preview on
 * desktop) is unchanged. A Tampermonkey menu toggle ("📊 Submit View: ON/OFF")
 * can force it back on via the gpt_submit_view_enabled storage override; it
 * reloads the page to apply. v1.3.0 added the zoomable screenshot preview (same
 * Blob as the upload — no second download); v1.2.0 added the Submit View
 * automation; v1.1.0 the send flow. Feature-detected: runs under Tampermonkey
 * (GM_* APIs) and as a plain bookmarklet / non-GM context (fetch + localStorage).
 */
(function () {
  'use strict';

  const DEFAULTS = {
    apiUrl: 'https://statbot.duckdns.org/api/v1/goparttime',
    apiKey: '',
  };

  const isNarrow = () => window.matchMedia && window.matchMedia('(max-width: 767px)').matches;

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
    alert('Settings saved.');
  }

  // Submit View is auto-disabled on narrow (mobile) viewports — insights are
  // only submitted from the PC. An optional override (gpt_submit_view_enabled)
  // can force it on or off; the menu toggle reloads the page to apply.
  function submitViewEnabled() {
    const stored = storageGet('gpt_submit_view_enabled');
    if (stored === '1' || stored === 'true') return true;
    if (stored === '0' || stored === 'false') return false;
    return !isNarrow();
  }

  function toggleSubmitView() {
    const next = !submitViewEnabled();
    storageSet('gpt_submit_view_enabled', next ? '1' : '0');
    alert('📊 Submit View is now ' + (next ? 'ON' : 'OFF') + '. Reloading…');
    location.reload();
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('⚙️ Configure Sender...', openSettings);
    GM_registerMenuCommand('🔍 Debug Task Detection', runDebug);
    GM_registerMenuCommand('📊 Submit View: ON/OFF', toggleSubmitView);
  }

  // ─── UI ─────────────────────────────────────────────────────

  const button = document.createElement('button');
  button.id = 'gpt-send-task-button';
  const mobile = isNarrow();
  button.textContent = mobile ? '📤' : '📤 Send Task';
  Object.assign(button.style, {
    position: 'fixed',
    right: mobile ? '16px' : '20px',
    bottom: mobile ? '16px' : '20px',
    zIndex: '2147483647',
    border: 'none',
    background: '#5865F2',
    color: '#fff',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  });
  if (mobile) {
    Object.assign(button.style, {
      width: '56px',
      height: '56px',
      borderRadius: '50%',
      fontSize: '24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0',
    });
  } else {
    Object.assign(button.style, {
      padding: '12px 18px',
      borderRadius: '10px',
      fontSize: '14px',
    });
  }
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

  if (submitViewEnabled()) {
  // ─── Submit View automation ────────────────────────────────

  // The insight screenshot lives in the detail dialog (a Radix dialog) while
  // the card with the "Submit View" button is on the list behind it. Like the
  // Send Task button, pointer-events:none on <body> while a dialog is open
  // would disable this button, so re-enable it explicitly and stop the
  // pointerdown from closing the site's dialog.
  const viewButton = document.createElement('button');
  viewButton.id = 'gpt-submit-view-button';
  const viewMobile = isNarrow();
  viewButton.textContent = viewMobile ? '📊' : '📊 Submit View';
  Object.assign(viewButton.style, {
    position: 'fixed',
    right: viewMobile ? '16px' : '20px',
    bottom: viewMobile ? '80px' : '72px',
    zIndex: '2147483647',
    border: 'none',
    background: '#2FBF71',
    color: '#fff',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  });
  if (viewMobile) {
    Object.assign(viewButton.style, {
      width: '56px',
      height: '56px',
      borderRadius: '50%',
      fontSize: '24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0',
    });
  } else {
    Object.assign(viewButton.style, {
      padding: '12px 18px',
      borderRadius: '10px',
      fontSize: '14px',
    });
  }
  viewButton.style.setProperty('pointer-events', 'auto', 'important');
  viewButton.addEventListener('pointerdown', (e) => e.stopPropagation());
  viewButton.addEventListener('click', submitViewFlow);
  document.body.appendChild(viewButton);

  let trackedViewCard = null;
  let submitViewBusy = false;

  // The list re-renders on navigation; track the card the manager last clicked
  // so the floating button always targets the right task and step.
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button[data-slot="button"]') : null;
    if (!btn) return;
    const text = (btn.textContent || '').trim();
    if (!/^(Submit View|Available to submit view)/.test(text)) return;
    const card = btn.closest('div[data-slot="card"]');
    if (!card) return;
    const taskId = detectCardTaskId(card);
    if (!taskId) return;
    trackedViewCard = { card, taskId, step: detectCardViewStep(card), buttonText: text };
  }, true);

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

  function detectCardViewStep(card) {
    const trigger = card.querySelector('div[data-slot="popover-trigger"]');
    const text = (trigger && trigger.textContent || '').trim();
    return /second/i.test(text) ? 2 : 1;
  }

  function findViewDialog() {
    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"][data-slot="dialog-content"]'));
    return dialogs.find((d) => d.querySelector('input[name="exposure_count"]')) || null;
  }

  function findCardSubmitButton(card) {
    if (!card) return null;
    const btn = Array.from(card.querySelectorAll('button[data-slot="button"]')).find((b) =>
      /^(Submit View|Available to submit view)/.test((b.textContent || '').trim()),
    );
    return btn || null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Opens the view-data dialog by clicking the card's "Submit View" button if
  // it is not already open. Resolves to the dialog or null.
  async function ensureViewDialog(card) {
    let dialog = findViewDialog();
    if (dialog) return dialog;
    const btn = findCardSubmitButton(card);
    if (!btn || btn.disabled) return null;
    btn.click();
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      dialog = findViewDialog();
      if (dialog) return dialog;
    }
    return null;
  }

  // Downloads the screenshot as a Blob. GM_xmlhttpRequest can return a Blob
  // directly (Tampermonkey); older builds expose responseType 'arraybuffer'.
  function fetchImageBlob(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        const done = (res) => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error('Failed to download screenshot (' + res.status + ').'));
            return;
          }
          if (res.response instanceof Blob) {
            resolve(res.response);
            return;
          }
          if (res.response instanceof ArrayBuffer) {
            resolve(new Blob([res.response], { type: 'image/png' }));
            return;
          }
          reject(new Error('Unexpected response type from GM_xmlhttpRequest.'));
        };
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'blob',
          timeout: 30000,
          onload: done,
          onerror: () => reject(new Error('Screenshot download failed.')),
          ontimeout: () => reject(new Error('Screenshot download timed out.')),
        });
        return;
      }
      fetch(url, { credentials: 'omit' })
        .then((res) => {
          if (!res.ok) throw new Error('Failed to download screenshot (' + res.status + ').');
          return res.blob();
        })
        .then(resolve)
        .catch(() => reject(new Error('Failed to download screenshot (fetch fallback).')));
    });
  }

  // Attaches the Blob to the hidden file input the same way the site's
  // dropzone would, so the file name and preview appear in the dialog.
  function attachImageToDialog(dialog, blob, fileName) {
    const input = dialog.querySelector('input[type="file"][accept="image/*"]');
    if (!input) {
      throw new Error('View dialog file input not found.');
    }
    const dt = new DataTransfer();
    dt.items.add(new File([blob], fileName, { type: blob.type || 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ─── Insight screenshot preview ─────────────────────────────

  // Floating, zoomable preview of the screenshot, fed from the exact same Blob
  // that is attached to the file input (URL.createObjectURL — no second
  // download). Lives on the left edge so it never covers the view-data dialog
  // where the count is entered. Stays open until the user closes it (✕) or the
  // view dialog disappears (submission done). Same protections as the floating
  // buttons: pointer-events re-enabled and pointerdown stopped so the site's
  // Radix dialog stays open.
  let previewEl = null;
  let previewObjectUrl = null;
  let previewZoom = 1;
  let previewWatcher = null;

  function openInsightPreview(blob, taskId, step, reminderType) {
    closeInsightPreview();
    previewObjectUrl = URL.createObjectURL(blob);
    previewZoom = 1;

    previewEl = document.createElement('div');
    previewEl.id = 'gpt-insight-preview';
    Object.assign(previewEl.style, {
      position: 'fixed',
      left: '16px',
      bottom: '140px',
      zIndex: '2147483647',
      width: 'min(92vw, 380px)',
      maxHeight: '70vh',
      display: 'flex',
      flexDirection: 'column',
      background: '#fff',
      borderRadius: '12px',
      boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#111',
      overflow: 'hidden',
    });
    previewEl.style.setProperty('pointer-events', 'auto', 'important');
    previewEl.addEventListener('pointerdown', (e) => e.stopPropagation());

    previewEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #eee;background:#fafafa">
        <strong style="font-size:13px">Insight Screenshot · step ${step} (${reminderType})</strong>
        <button id="gpt-preview-close" title="Close preview" style="border:none;background:none;cursor:pointer;font-size:18px;line-height:1;color:#666;padding:2px 6px">✕</button>
      </div>
      <div id="gpt-preview-scroll" style="overflow:auto;flex:1;min-height:0;display:flex;align-items:flex-start;justify-content:center;padding:8px;background:#111">
        <img id="gpt-preview-img" alt="Insight screenshot" style="max-width:100%;height:auto;border-radius:6px;transform-origin:center;transition:transform .15s ease;background:#fff"/>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid #eee;background:#fafafa">
        <button id="gpt-preview-zoom-out" title="Zoom out" style="flex:1;padding:6px 8px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#333;font-size:14px;cursor:pointer">− Zoom</button>
        <span id="gpt-preview-zoom-label" style="font-size:12px;color:#666;min-width:44px;text-align:center">100%</span>
        <button id="gpt-preview-zoom-in" title="Zoom in" style="flex:1;padding:6px 8px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#333;font-size:14px;cursor:pointer">Zoom +</button>
        <a id="gpt-preview-open" href="${previewObjectUrl}" target="_blank" rel="noopener" title="Open full size" style="flex:1;text-align:center;padding:6px 8px;border:1px solid #5865F2;border-radius:6px;background:#5865F2;color:#fff;font-size:14px;text-decoration:none;cursor:pointer">Open ↗</a>
      </div>`;

    document.body.appendChild(previewEl);
    const img = previewEl.querySelector('#gpt-preview-img');
    img.src = previewObjectUrl;
    previewEl.querySelector('#gpt-preview-close').addEventListener('click', closeInsightPreview);
    previewEl.querySelector('#gpt-preview-zoom-in').addEventListener('click', () => setPreviewZoom(previewZoom + 0.25));
    previewEl.querySelector('#gpt-preview-zoom-out').addEventListener('click', () => setPreviewZoom(previewZoom - 0.25));

    // Auto-close once the view-data dialog is gone (submission done).
    previewWatcher = setInterval(() => {
      if (!previewEl) return;
      if (!findViewDialog()) closeInsightPreview();
    }, 1000);
  }

  function setPreviewZoom(zoom) {
    previewZoom = Math.min(5, Math.max(0.5, zoom));
    const img = previewEl && previewEl.querySelector('#gpt-preview-img');
    if (img) img.style.transform = 'scale(' + previewZoom + ')';
    const label = previewEl && previewEl.querySelector('#gpt-preview-zoom-label');
    if (label) label.textContent = Math.round(previewZoom * 100) + '%';
  }

  function closeInsightPreview() {
    if (previewWatcher) {
      clearInterval(previewWatcher);
      previewWatcher = null;
    }
    if (previewEl) {
      previewEl.remove();
      previewEl = null;
    }
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
  }

  async function submitViewFlow() {
    if (submitViewBusy) return;
    const settings = getSettings();
    if (!settings.apiKey) {
      alert('Submit View is not configured. Use the Tampermonkey menu → "⚙️ Configure Sender..." first.');
      return;
    }
    if (!trackedViewCard) {
      alert('Click the "Submit View" (or disabled countdown) button on a task card first, then tap 📊 Submit View.');
      return;
    }

    const { card, taskId, step, buttonText } = trackedViewCard;
    const cardButton = findCardSubmitButton(card);
    if (cardButton && cardButton.disabled) {
      alert('View-data submission is not available yet for this task:\n"' + buttonText + '".');
      return;
    }

    submitViewBusy = true;
    viewButton.disabled = true;
    try {
      const data = await request(settings, 'GET', '/insight/' + taskId + '?step=' + step).then((res) => res.data);
      if (!data.reminderId) {
        alert(data.message || 'No insight data available for this task yet.');
        return;
      }
      if (!data.imageUrl) {
        alert('No screenshot uploaded yet for ' + data.reminderType + '. Upload it in the Discord ticket first.');
        return;
      }

      const base = settings.apiUrl.replace(/\/api\/v1\/goparttime\/?$/, '');
      const imageUrl = new URL(data.imageUrl, base + '/').toString();
      const blob = await fetchImageBlob(imageUrl);
      const fileName = 'view-' + taskId + '-step-' + step + '.png';
      openInsightPreview(blob, taskId, step, data.reminderType);

      const dialog = await ensureViewDialog(card);
      if (!dialog) {
        alert('Could not open the view-data dialog. Open it manually, then run Submit View again.');
        return;
      }
      attachImageToDialog(dialog, blob, fileName);
      alert(
        '✅ Screenshot attached for step ' + step + ' (' + data.reminderType + ').\n' +
        'Read the view count from the preview (left), enter it in the dialog, click Submit, and verify success in GoPartTime.',
      );
    } catch (err) {
      alert('⚠️ ' + (err && err.message ? err.message : 'Submit View failed.'));
    } finally {
      submitViewBusy = false;
      viewButton.disabled = false;
    }
  }

  } // end submitViewEnabled() guard

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
      alert('Discord Task Sender is not configured. Tap "⚙️ Settings" in the dialog, or use the Tampermonkey menu → "⚙️ Configure Sender..." first.');
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
      <div id="gpt-modal-card" style="pointer-events:auto!important;position:relative;z-index:2147483647;background:#fff;border-radius:14px;padding:24px;width:360px;max-width:92vw;max-height:88vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.4);color:#111">
        <h3 style="margin:0 0 16px;font-size:18px;font-weight:700">Assign Task</h3>
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px">Ticket</label>
        <select id="gpt-ticket-select" style="width:100%;padding:12px;border:1px solid #ccc;border-radius:8px;font-size:16px;background:#fff;color:#111;margin-bottom:16px">
          <option value="">Loading tickets…</option>
        </select>
        <p id="gpt-status" style="font-size:13px;color:#666;margin:0 0 12px;min-height:18px"></p>
        <div style="display:flex;justify-content:flex-end;gap:10px;align-items:center">
          <button id="gpt-settings" title="Configure sender" style="padding:10px 12px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#333;font-size:16px;cursor:pointer;margin-right:auto">⚙️</button>
          <button id="gpt-debug" title="Debug task detection" style="padding:10px 12px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#333;font-size:16px;cursor:pointer">🔍</button>
          <button id="gpt-cancel" style="padding:12px 18px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#333;font-size:15px;font-weight:600;cursor:pointer">Cancel</button>
          <button id="gpt-send" style="padding:12px 18px;border:none;border-radius:8px;background:#5865F2;color:#fff;font-size:15px;font-weight:600;cursor:pointer" disabled>Send</button>
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
    modal.querySelector('#gpt-settings').addEventListener('click', () => {
      closeModal();
      openSettings();
    });
    modal.querySelector('#gpt-debug').addEventListener('click', () => {
      closeModal();
      runDebug();
    });

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

  /**
   * Shared status handling for both transports. Throws on failure with the
   * same messages the desktop script used.
   */
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
    // Backend now sends Validation failed: field: message in rawMessage; keep compat
    // with old generic message by appending detail only when not already included.
    let message = rawMessage;
    if (detail) {
      if (!rawMessage || !rawMessage.includes(detail)) {
        message = rawMessage ? rawMessage + ' ' + detail : detail;
      }
    }
    if (status === 409) throw new Error(message || 'Task has already been assigned.');
    if (status === 401) throw new Error('Authentication failed. Check your API key.');
    if (status === 503) throw new Error('Extension endpoint is not configured on the server.');
    throw new Error(message || `Server error (${status}).`);
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

    // Non-GM context (mobile stock browsers, bookmarklet): plain fetch().
    // The backend allows the goparttime.net origin via CORS.
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

  function fetchTickets(settings) {
    return request(settings, 'GET', '/tickets').then((res) => res.data || []);
  }

  function sendToBackend(settings, payload) {
    return request(settings, 'POST', '/assign', payload).then((res) => ({
      failed: !!res.failed,
      error: res.error,
    }));
  }

  // ─── Debug ──────────────────────────────────────────────────

  function runDebug() {
    const info = { dialogFound: !!document.querySelector('[role="dialog"]'), proseFound: !!document.querySelector('div.prose') };
    try {
      const t = extractTask();
      info.status = 'OK';
      info.taskId = t.taskId;
      info.type = t.type;
      info.deadline = t.deadline || null;
      info.payment = t.payment || null;
      info.subreddit = t.subreddit || null;
      info.title = t.title || null;
      info.postLink = t.postLink || null;
      info.commentLink = t.commentLink || null;
      info.contentLength = (t.contentHtml || '').length;
      info.images = (t.images || []).length;
    } catch (e) {
      info.status = 'ERROR';
      info.error = e.message;
      const root = findTaskRoot();
      info.rootFound = !!root;
      const labels = ['Task ID', 'Task Type', 'Deadline', 'Payment'];
      info.labelsFound = {};
      labels.forEach((l) => {
        try {
          info.labelsFound[l] = !!findField(l, root || document);
        } catch (err) {
          info.labelsFound[l] = false;
        }
      });
      info.inputsFound = {
        subreddit: !!document.querySelector('input[name="subreddit"]'),
        flair: !!document.querySelector('input[name="flair"]'),
        title: !!document.querySelector('input[name="title"]'),
        post_link: !!document.querySelector('input[name="post_link"]'),
        comment_link: !!document.querySelector('input[name="comment_link"]'),
      };
    }
    console.log('[Send Task] Debug:', JSON.stringify(info, null, 2));
    alert('Send Task debug:\n' + JSON.stringify(info, null, 2));
  }

  // ─── DOM Extraction ─────────────────────────────────────────

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
      throw new Error('Open a task to see its detail view, then click Send Task.');
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
