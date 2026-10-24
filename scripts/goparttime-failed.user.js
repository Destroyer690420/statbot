// ==UserScript==
// @name         GoPartTime Failed Task Checker
// @namespace    https://goparttime.net/
// @version      1.1.0
// @description  One-click check of the failed page you are on: sends that page's Failed task IDs to Statbot, checks only ones it has never seen, and lets the server DM the owner. Never clicks, reports, accepts, or writes anything on GoPartTime.
// @author       Manager
// @match        *://goparttime.net/my-tasks/failed*
// @match        *://www.goparttime.net/my-tasks/failed*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      statbot.duckdns.org
// @connect      161.118.164.85
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// @noframes
// ==/UserScript==

/**
 * v1.1.0 - Single-page, unseen-only check.
 *
 *   - Reads only the failed page currently open in the tab. No pagination, no
 *     background fetches, no reloads, no cross-page scan state.
 *   - Sends that page's Failed card IDs once. The server skips IDs it has
 *     already recorded (except a mismatch whose DM failed), so repeated clicks
 *     on the same page do nothing new.
 *   - Long card text is clamped to the API limits before sending, so a very
 *     long "Failed Reason" can never reject the whole batch.
 *
 * v1.0.0 persisted multi-page progress in sessionStorage. This version deletes
 * that leftover cache on load instead of resuming it.
 *
 * Safety: this script only reads the DOM. It never clicks a card button, never
 * opens the Feedback dialog, and never submits anything on GoPartTime.
 */
(function () {
  'use strict';

  if (!/^\/my-tasks\/failed\/?$/.test(window.location.pathname)) return;

  var DEFAULTS = {
    apiUrl: 'https://statbot.duckdns.org/api/v1/goparttime',
    apiKey: '',
  };
  var API_TIMEOUT_MS = 25000;
  var RENDER_TIMEOUT_MS = 6000;
  var POLL_MS = 200;
  var MAX_TASKS = 500;
  var LEGACY_KEYS = ['gpt_failed_scan_state', 'gpt_failed_scan_result'];
  // Mirrors the server schema caps. Keep the card text short enough that one
  // unusually long failure reason cannot reject the whole scan.
  var LIMITS = { failedReason: 500, reward: 32, deadline: 64 };
  var BUTTON_ID = 'gpt-failed-check-btn';
  var PANEL_ID = 'gpt-failed-check-panel';

  var scanInProgress = false;

  // v1.0.0 left a multi-page scan cache here. A stale cache is exactly what
  // made the old retry loop confusing, so drop it unconditionally.
  function clearLegacyCache() {
    for (var i = 0; i < LEGACY_KEYS.length; i++) {
      try {
        window.sessionStorage.removeItem(LEGACY_KEYS[i]);
      } catch (e) {
        /* ignore */
      }
    }
  }
  clearLegacyCache();

  // --- Settings -----------------------------------------------------------

  function storageGet(key) {
    try {
      if (typeof GM_getValue === 'function') {
        var value = GM_getValue(key, '');
        return value === null || value === undefined ? '' : String(value);
      }
      return window.localStorage.getItem(key) || '';
    } catch (e) {
      return '';
    }
  }

  function storageSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, value);
      else window.localStorage.setItem(key, value);
    } catch (e) {
      /* storage is best-effort */
    }
  }

  function getSettings() {
    return {
      apiUrl: (storageGet('gpt_failed_api_url').trim() || DEFAULTS.apiUrl).replace(/\/$/, ''),
      apiKey: storageGet('gpt_failed_api_key').trim() || DEFAULTS.apiKey,
    };
  }

  function openSettings() {
    var settings = getSettings();
    var base = settings.apiUrl.replace(/\/api\/v1\/goparttime\/?$/, '');
    var apiBase = window.prompt(
      'Statbot backend URL (without /api/v1):',
      base || 'https://statbot.duckdns.org',
    );
    if (apiBase === null) return;
    var apiKey = window.prompt('API key (GOPARTTIME_API_KEY):', settings.apiKey);
    if (apiKey === null) return;
    var cleanBase = (apiBase.trim() || 'https://statbot.duckdns.org').replace(/\/$/, '');
    storageSet('gpt_failed_api_url', cleanBase + '/api/v1/goparttime');
    storageSet('gpt_failed_api_key', apiKey.trim());
    window.alert('Settings saved.');
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Configure failed-task checker...', openSettings);
    GM_registerMenuCommand('Clear cached scan data', function () {
      clearLegacyCache();
      removePanel();
      setButton('Check failed tasks', false);
      window.alert('Cached scan data cleared.');
    });
  }

  // --- HTTP ---------------------------------------------------------------

  function parseResponse(status, responseText) {
    var json = null;
    try {
      json = JSON.parse(responseText);
    } catch (e) {
      /* non-JSON error page */
    }
    if (status >= 200 && status < 300) return json || { success: true };
    var message = (json && json.message) || 'Server error (' + status + ').';
    var error = new Error(message);
    error.status = status;
    error.body = json;
    throw error;
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
            try {
              resolve(parseResponse(res.status, res.responseText));
            } catch (error) {
              reject(error);
            }
          },
          onerror: function () {
            reject(new Error('Statbot is unavailable.'));
          },
          ontimeout: function () {
            reject(new Error('Statbot is unavailable (timeout).'));
          },
        });
      });
    }

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller
      ? window.setTimeout(function () {
          try {
            controller.abort();
          } catch (e) {
            /* ignore */
          }
        }, API_TIMEOUT_MS)
      : null;
    return window
      .fetch(url, {
        method: method,
        headers: headers,
        body: payload,
        credentials: 'omit',
        signal: controller ? controller.signal : undefined,
      })
      .then(function (res) {
        return res.text().then(function (text) {
          if (timer) window.clearTimeout(timer);
          return parseResponse(res.status, text);
        });
      })
      .catch(function (error) {
        if (timer) window.clearTimeout(timer);
        if (error && error.status) throw error;
        throw new Error('Statbot is unavailable.');
      });
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  // --- Page parsing ------------------------------------------------------

  function textOf(element) {
    return ((element && element.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  /** Collapses whitespace and clamps to the API limit (undefined when empty). */
  function cleanText(value, max) {
    var text = (value || '').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, max) : undefined;
  }

  function currentPageNumber() {
    try {
      var raw = new URLSearchParams(window.location.search).get('page');
      var page = parseInt(raw || '1', 10);
      return isNaN(page) || page < 1 ? 1 : page;
    } catch (e) {
      return 1;
    }
  }

  /**
   * Finds a labelled value on a task card (label leaf -> next sibling). This
   * is the same DOM shape the submit executor already uses for /my-tasks/todo;
   * scoping to the card keeps duplicate labels on other cards out.
   */
  function findField(root, labelText) {
    try {
      var nodes = root.querySelectorAll('div, span');
      for (var i = 0; i < nodes.length; i++) {
        var element = nodes[i];
        if (element.children.length !== 0) continue;
        if (textOf(element) !== labelText) continue;
        var sibling = element.nextElementSibling;
        if (!sibling) continue;
        var value = textOf(sibling);
        if (value) return value;
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function detectCardTaskId(card) {
    var field = findField(card, 'Task ID');
    if (field && /^\d+$/.test(field)) return field;
    var heading = textOf(card.querySelector('h3'));
    var match = /#\s*(\d+)/.exec(heading);
    return match ? match[1] : null;
  }

  /**
   * Card type is a display hint only - the backend prefers the type stored on
   * the resolved Statbot task and uses this only for IDs it does not know.
   * Read the labelled "Task Type" field first (same proven shape as the sender
   * on the detail page), then fall back to the card heading.
   */
  function detectCardType(card) {
    var field = (findField(card, 'Task Type') || '').toLowerCase();
    if (field === 'post' || field === 'comment') return field;
    var heading = textOf(card.querySelector('h3'));
    var match = /^(post|comment)\b/i.exec(heading);
    return match ? match[1].toLowerCase() : null;
  }

  function isFailedCard(card) {
    var badge = card.querySelector('[data-slot="badge"]');
    return !!badge && /\bfailed\b/i.test(textOf(badge));
  }

  function cardCount(root) {
    try {
      return root.querySelectorAll('div[data-slot="card"]').length;
    } catch (e) {
      return 0;
    }
  }

  function collectCards(root) {
    var tasks = [];
    var seen = {};
    var cards;
    try {
      cards = root.querySelectorAll('div[data-slot="card"]');
    } catch (e) {
      return tasks;
    }
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (!isFailedCard(card)) continue;
      var externalTaskId = detectCardTaskId(card);
      if (!externalTaskId || seen[externalTaskId]) continue;
      seen[externalTaskId] = true;
      tasks.push({
        externalTaskId: externalTaskId,
        type: detectCardType(card) || undefined,
        failedReason: cleanText(findField(card, 'Failed Reason'), LIMITS.failedReason),
        reward: cleanText(findField(card, 'Reward'), LIMITS.reward),
        deadline: cleanText(findField(card, 'Deadline'), LIMITS.deadline),
      });
    }
    return tasks;
  }

  /** The app is client-rendered: wait for cards before deciding a page is empty. */
  async function waitForCards(timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (cardCount(document) > 0) return true;
      await sleep(POLL_MS);
    }
    return cardCount(document) > 0;
  }

  // --- Scan flow ---------------------------------------------------------

  async function startScan() {
    if (scanInProgress) return;

    var settings = getSettings();
    if (!settings.apiKey) {
      openSettings();
      return;
    }

    scanInProgress = true;
    removePanel();
    setButton('Scanning this page...', true);

    try {
      await waitForCards(RENDER_TIMEOUT_MS);

      var tasks = collectCards(document);
      if (tasks.length > MAX_TASKS) {
        tasks = tasks.slice(0, MAX_TASKS);
      }
      if (!tasks.length) {
        renderEmpty();
        return;
      }

      setButton('Checking ' + tasks.length + ' task(s)...', true);
      var response = await request(settings, 'POST', '/failed-tasks/scan', { tasks: tasks });
      var result = response && response.data ? response.data : {};
      result.page = currentPageNumber();
      result.submitted = tasks.length;
      renderResult(result);

      var newCount = (result.newMismatchIds || []).length;
      setButton(
        newCount > 0 ? 'Check failed tasks - ' + newCount + ' new' : 'Check failed tasks',
        false,
      );
    } catch (error) {
      renderError((error && error.message) || 'Scan failed.');
      setButton('Check failed tasks', false);
    } finally {
      scanInProgress = false;
    }
  }

  // --- UI ----------------------------------------------------------------

  function setStyle(element, styles) {
    for (var key in styles) {
      if (Object.prototype.hasOwnProperty.call(styles, key)) {
        element.style[key] = styles[key];
      }
    }
  }

  function makeElement(tag, styles, text) {
    var element = document.createElement(tag);
    if (styles) setStyle(element, styles);
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function ensureButton() {
    var button = document.getElementById(BUTTON_ID);
    if (button) return button;
    button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = 'Check failed tasks';
    setStyle(button, {
      position: 'fixed',
      left: '16px',
      bottom: '56px',
      zIndex: '2147483646',
      padding: '10px 14px',
      borderRadius: '10px',
      border: '1px solid rgba(0,0,0,0.15)',
      background: '#0f766e',
      color: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    });
    button.addEventListener('click', startScan);
    document.body.appendChild(button);
    return button;
  }

  function setButton(text, disabled) {
    var button = ensureButton();
    button.textContent = text;
    button.disabled = !!disabled;
    button.style.opacity = disabled ? '0.7' : '1';
    button.style.cursor = disabled ? 'default' : 'pointer';
  }

  function removePanel() {
    var panel = document.getElementById(PANEL_ID);
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
  }

  function ensurePanel() {
    removePanel();
    var panel = makeElement('div', {
      position: 'fixed',
      left: '16px',
      bottom: '104px',
      zIndex: '2147483647',
      width: '390px',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: '65vh',
      overflowY: 'auto',
      background: '#ffffff',
      color: '#111827',
      border: '1px solid #d1d5db',
      borderRadius: '12px',
      boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: '12px',
      lineHeight: '1.45',
    });
    panel.id = PANEL_ID;
    document.body.appendChild(panel);
    return panel;
  }

  function panelHeader(panel, title, onClose) {
    var header = makeElement('div', {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      padding: '10px 12px',
      borderBottom: '1px solid #e5e7eb',
      position: 'sticky',
      top: '0',
      background: '#ffffff',
    });
    header.appendChild(
      makeElement('div', { fontWeight: '700', fontSize: '13px' }, title),
    );
    var close = makeElement(
      'button',
      {
        border: 'none',
        background: 'transparent',
        color: '#6b7280',
        fontSize: '18px',
        lineHeight: '1',
        cursor: 'pointer',
        padding: '0 4px',
      },
      'x',
    );
    close.type = 'button';
    close.addEventListener('click', onClose);
    header.appendChild(close);
    panel.appendChild(header);
    return header;
  }

  function appendLine(panel, text, styles) {
    var line = makeElement('div', styles || { marginTop: '6px' }, text);
    panel.appendChild(line);
    return line;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return fallbackCopy(text);
      });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    } catch (e) {
      /* ignore */
    }
  }

  function smallButton(label, onClick) {
    var button = makeElement(
      'button',
      {
        border: '1px solid #d1d5db',
        background: '#ffffff',
        color: '#111827',
        borderRadius: '6px',
        padding: '2px 6px',
        fontSize: '11px',
        cursor: 'pointer',
      },
      label,
    );
    button.type = 'button';
    button.addEventListener('click', onClick);
    return button;
  }

  function appendMismatchRow(panel, row) {
    var isNew = !!row.isNew;
    var container = makeElement('div', {
      border: '1px solid ' + (isNew ? '#fca5a5' : '#e5e7eb'),
      background: isNew ? '#fef2f2' : '#f9fafb',
      borderRadius: '8px',
      padding: '8px',
      marginTop: '8px',
    });

    var top = makeElement('div', {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
    });
    var title = makeElement('div', { fontWeight: '700' }, '#' + row.externalTaskId);
    var right = makeElement('div', { display: 'flex', gap: '6px', alignItems: 'center' });
    if (isNew) {
      right.appendChild(
        makeElement(
          'span',
          {
            background: '#dc2626',
            color: '#ffffff',
            borderRadius: '999px',
            padding: '1px 6px',
            fontSize: '10px',
            fontWeight: '700',
          },
          'NEW',
        ),
      );
    }
    right.appendChild(
      smallButton('Copy', function () {
        copyText(row.externalTaskId);
      }),
    );
    top.appendChild(title);
    top.appendChild(right);
    container.appendChild(top);

    var bits = [];
    if (row.taskType) bits.push(row.taskType === 'comment' ? 'Comment' : 'Post');
    if (row.taskStatus) bits.push('Statbot: ' + row.taskStatus);
    if (row.reward) bits.push(row.reward);
    if (row.notifiedAt) bits.push('already DM-ed');
    if (bits.length) {
      container.appendChild(
        makeElement('div', { marginTop: '3px', color: '#374151' }, bits.join(' - ')),
      );
    }
    if (row.failedReason) {
      container.appendChild(
        makeElement(
          'div',
          { marginTop: '3px', color: '#6b7280', fontStyle: 'italic' },
          row.failedReason,
        ),
      );
    }
    panel.appendChild(container);
  }

  function panelActions(body, result) {
    var actions = makeElement('div', { display: 'flex', gap: '8px', marginTop: '10px' });
    var mismatches = (result && result.mismatches) || [];
    if (mismatches.length) {
      actions.appendChild(
        smallButton('Copy all IDs', function () {
          copyText(
            mismatches
              .map(function (row) {
                return row.externalTaskId;
              })
              .join('\n'),
          );
        }),
      );
    }
    actions.appendChild(
      smallButton('Settings', function () {
        openSettings();
      }),
    );
    body.appendChild(actions);
  }

  function renderEmpty() {
    var panel = ensurePanel();
    panelHeader(panel, 'Failed-task check', function () {
      removePanel();
    });
    var body = makeElement('div', { padding: '10px 12px 12px' });
    panel.appendChild(body);
    appendLine(body, 'No Failed tasks on this page.', { fontWeight: '600' });
    appendLine(
      body,
      'Move to another page and click the button there; only the page you are on is checked.',
      { color: '#4b5563', marginTop: '4px' },
    );
    panelActions(body, null);
    setButton('Check failed tasks', false);
  }

  function renderResult(result) {
    var panel = ensurePanel();
    panelHeader(panel, 'Failed-task check', function () {
      removePanel();
    });

    var body = makeElement('div', { padding: '10px 12px 12px' });
    panel.appendChild(body);

    var counts = result.counts || {};
    var mismatches = result.mismatches || [];
    var newIds = result.newMismatchIds || [];
    var skipped = result.skippedKnown || 0;
    var scanned = result.scanned || 0;
    var submitted = result.submitted || scanned;
    var page = result.page || 1;

    appendLine(body, 'Scanned ' + submitted + ' failed task(s) on page ' + page + '.', {
      fontWeight: '600',
    });

    if (skipped > 0) {
      appendLine(
        body,
        skipped + ' already checked before - skipped (only never-seen tasks are reported).',
        { color: '#4b5563', marginTop: '4px' },
      );
    }

    if (newIds.length > 0 && result.dm && result.dm.sent) {
      appendLine(body, 'DM sent to owner for ' + newIds.length + ' new mismatch(es).', {
        color: '#047857',
        fontWeight: '700',
      });
    } else if (newIds.length > 0) {
      appendLine(body, 'DM not sent: ' + ((result.dm && result.dm.error) || 'unknown error'), {
        color: '#b91c1c',
        fontWeight: '700',
      });
    } else {
      appendLine(body, 'No new mismatches - no DM sent.', { color: '#374151' });
    }

    var summary = [
      'Mismatched: ' + (counts.MISMATCH || 0),
      'Deleted (expected): ' + (counts.DELETED || 0),
      'Not comparable: ' + (counts.NOT_COMPARABLE || 0),
      'Not in Statbot: ' + (counts.NOT_FOUND || 0),
    ];
    appendLine(body, summary.join('  |  '), { color: '#4b5563', marginTop: '4px' });

    var notFound = result.notFound || [];
    if (notFound.length) {
      appendLine(body, 'Not in Statbot (excluded from reports): ' + notFound.join(', '), {
        color: '#6b7280',
        marginTop: '4px',
        wordBreak: 'break-word',
      });
    }

    if (mismatches.length) {
      appendLine(body, 'Open mismatches (OK in Statbot, Failed on GoPartTime):', {
        marginTop: '10px',
        fontWeight: '700',
      });
      for (var i = 0; i < mismatches.length; i++) {
        appendMismatchRow(body, mismatches[i]);
      }
    } else if (skipped === 0) {
      appendLine(body, 'Nothing to report.', { marginTop: '8px', color: '#374151' });
    }

    panelActions(body, result);
    setButton('Check failed tasks', false);
  }

  function renderError(message) {
    var panel = ensurePanel();
    panelHeader(panel, 'Failed-task check', function () {
      removePanel();
    });
    var body = makeElement('div', { padding: '10px 12px 12px' });
    panel.appendChild(body);
    appendLine(body, message, { color: '#b91c1c', fontWeight: '700' });
    appendLine(body, 'Nothing was reported. Fix the issue and click the button again.', {
      color: '#4b5563',
      marginTop: '6px',
    });
    panelActions(body, null);
    setButton('Check failed tasks', false);
  }

  // --- Boot --------------------------------------------------------------

  function boot() {
    ensureButton();
  }

  if (document.body) boot();
  else window.addEventListener('DOMContentLoaded', boot);
})();
