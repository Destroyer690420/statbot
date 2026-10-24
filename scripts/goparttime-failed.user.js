// ==UserScript==
// @name         GoPartTime Failed Task Checker
// @namespace    https://goparttime.net/
// @version      1.0.0
// @description  One-click check of /my-tasks/failed against Statbot: scans every failed page, finds tasks that are still OK in Statbot (not marked deleted), and asks the server to DM the owner. Never clicks, reports, accepts, or writes anything on GoPartTime.
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
 * v1.0.0 - Initial failed-task checker.
 *
 * The manager opens /my-tasks/failed and clicks "Check failed tasks". The
 * script collects every card across the pagination (same-origin fetch + HTML
 * parse; a full page navigation is the fallback if the page is not server
 * rendered), POSTs the whole set to /goparttime/failed-tasks/scan once, and
 * renders the verdicts. The server classifies each task from Statbot's
 * cancelledReason and DMs the owner for new OK-but-Failed tasks.
 *
 * Safety: this script only reads the DOM and fetches the failed page. It never
 * clicks a card button, never opens the Feedback dialog, and never submits
 * anything on GoPartTime. All reports stay manual.
 */
(function () {
  'use strict';

  if (!/^\/my-tasks\/failed\/?$/.test(window.location.pathname)) return;

  var DEFAULTS = {
    apiUrl: 'https://statbot.duckdns.org/api/v1/goparttime',
    apiKey: '',
  };
  var API_TIMEOUT_MS = 25000;
  var PAGE_FETCH_TIMEOUT_MS = 15000;
  var PAGE_RENDER_TIMEOUT_MS = 8000;
  var PAGE_POLL_MS = 250;
  var PAGE_DELAY_MS = 250;
  var MAX_PAGES = 50;
  var MAX_TASKS = 500;
  var STATE_KEY = 'gpt_failed_scan_state';
  var RESULT_KEY = 'gpt_failed_scan_result';
  var BUTTON_ID = 'gpt-failed-check-btn';
  var PANEL_ID = 'gpt-failed-check-panel';

  var scanInProgress = false;
  var cancelRequested = false;

  // --- Settings / storage -------------------------------------------------

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
    GM_registerMenuCommand('Reset failed-task scan state', function () {
      clearState();
      clearResult();
      var panel = document.getElementById(PANEL_ID);
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      updateButton('Check failed tasks');
      window.alert('Scan state cleared.');
    });
  }

  // --- HTTP --------------------------------------------------------------

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
        failedReason: findField(card, 'Failed Reason') || undefined,
        reward: findField(card, 'Reward') || undefined,
        deadline: findField(card, 'Deadline') || undefined,
      });
    }
    return tasks;
  }

  function readPagination(root) {
    var result = { maxPage: 1, nextPage: null, hasPagination: false };
    try {
      var nav = root.querySelector('nav[aria-label="pagination"]');
      if (!nav) return result;
      var links = Array.from(nav.querySelectorAll('a[data-slot="pagination-link"][href]'));
      result.hasPagination = links.length > 0;
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || '';
        var match = /[?&]page=(\d+)/.exec(href);
        if (!match) continue;
        var page = parseInt(match[1], 10);
        if (page > result.maxPage) result.maxPage = page;
        var label =
          (links[i].getAttribute('aria-label') || '') +
          ' ' +
          (links[i].getAttribute('rel') || '') +
          ' ' +
          textOf(links[i]);
        if (/\bnext\b/i.test(label)) {
          if (!result.nextPage || page < result.nextPage) result.nextPage = page;
        }
      }
    } catch (e) {
      /* ignore */
    }
    return result;
  }

  /**
   * Merges a page's pager into the scan bound. The next-link is the reliable
   * signal: windowed pagers (``1 ... 5 6 7 ... 20``) show a small max page, so
   * following next keeps walking until the page that has no next link. A page
   * that shows page links but no next link is the last page, which lets the
   * scan stop even when the pager hides the final number.
   */
  function applyPagination(state, pager, page) {
    if (pager.maxPage > (state.maxPages || 1)) state.maxPages = pager.maxPage;
    if (pager.nextPage && pager.nextPage > (state.maxPages || 1)) {
      state.maxPages = pager.nextPage;
    }
    if (pager.hasPagination && !pager.nextPage && pager.maxPage <= page) {
      state.maxPages = page;
    }
  }

  function pageHref(page) {
    try {
      var links = Array.from(
        document.querySelectorAll('nav[aria-label="pagination"] a[data-slot="pagination-link"][href]'),
      );
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || '';
        var match = /[?&]page=(\d+)/.exec(href);
        if (match && parseInt(match[1], 10) === page) {
          return new URL(href, window.location.origin).href;
        }
      }
    } catch (e) {
      /* fall through to the canonical URL */
    }
    return new URL('/my-tasks/failed?page=' + page, window.location.origin).href;
  }

  function fetchHtml(url) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller
      ? window.setTimeout(function () {
          try {
            controller.abort();
          } catch (e) {
            /* ignore */
          }
        }, PAGE_FETCH_TIMEOUT_MS)
      : null;
    return window
      .fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'text/html' },
        signal: controller ? controller.signal : undefined,
      })
      .then(function (res) {
        if (timer) window.clearTimeout(timer);
        if (!res.ok) return null;
        return res.text().then(function (html) {
          return new DOMParser().parseFromString(html, 'text/html');
        });
      })
      .catch(function () {
        if (timer) window.clearTimeout(timer);
        return null;
      });
  }

  // --- Scan state --------------------------------------------------------

  function loadState() {
    try {
      var raw = window.sessionStorage.getItem(STATE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.active) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function saveState(state) {
    try {
      window.sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (e) {
      /* ignore */
    }
  }

  function clearState() {
    try {
      window.sessionStorage.removeItem(STATE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function loadResult() {
    try {
      var raw = window.sessionStorage.getItem(RESULT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveResult(result) {
    try {
      window.sessionStorage.setItem(RESULT_KEY, JSON.stringify(result));
    } catch (e) {
      /* ignore */
    }
  }

  function clearResult() {
    try {
      window.sessionStorage.removeItem(RESULT_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function markPageDone(state, page) {
    var done = state.pagesDone || [];
    if (done.indexOf(page) === -1) done.push(page);
    state.pagesDone = done;
  }

  function taskCount(state) {
    return Object.keys(state.tasks || {}).length;
  }

  function addTasks(state, tasks) {
    state.tasks = state.tasks || {};
    for (var i = 0; i < tasks.length; i++) {
      var task = tasks[i];
      if (!state.tasks[task.externalTaskId]) state.tasks[task.externalTaskId] = task;
    }
  }

  // --- Scan flow ---------------------------------------------------------

  function newState() {
    return {
      active: true,
      uploadFailed: false,
      tasks: {},
      pagesDone: [],
      maxPages: 1,
      navPage: null,
      navAttempted: {},
      navFailed: {},
      truncated: null,
      startedAt: Date.now(),
    };
  }

  function endScan(message) {
    scanInProgress = false;
    cancelRequested = false;
    clearState();
    renderError(message, 0);
    updateButton('Check failed tasks');
  }

  function startScan() {
    if (scanInProgress) {
      cancelRequested = true;
      updateButton('Cancelling...');
      return;
    }
    var settings = getSettings();
    if (!settings.apiKey) {
      openSettings();
      return;
    }

    // An upload that failed keeps its already-scanned cards: clicking again
    // retries just the POST instead of walking every page again.
    var cached = loadState();
    if (cached && cached.uploadFailed && taskCount(cached) > 0) {
      cancelRequested = false;
      scanInProgress = true;
      cached.active = true;
      cached.uploadFailed = false;
      saveState(cached);
      updateButton('Retrying upload...');
      postScan(cached, settings);
      return;
    }

    cancelRequested = false;
    scanInProgress = true;
    clearResult();
    removePanel();
    clearState();

    var state = newState();
    saveState(state);
    updateButton('Scanning...');
    continueScan(state, settings).catch(function (error) {
      endScan((error && error.message) || 'Scan failed.');
    });
  }

  async function waitForPageReady(timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var cardsSeenAt = 0;
    while (Date.now() < deadline) {
      if (cancelRequested) return false;
      var hasCards = collectCards(document).length > 0;
      if (hasCards) {
        if (!cardsSeenAt) cardsSeenAt = Date.now();
        // A pager can render a beat after the cards. Wait briefly for it so
        // page 1 does not lock the scan to a single page; a genuinely
        // single-page list never renders one, so the grace period is bounded.
        if (readPagination(document).hasPagination || Date.now() - cardsSeenAt >= 1500) {
          return true;
        }
      }
      await sleep(PAGE_POLL_MS);
    }
    return collectCards(document).length > 0;
  }

  function collectPage(state, root, page) {
    var cards = collectCards(root);
    addTasks(state, cards);
    markPageDone(state, page);
    applyPagination(state, readPagination(root), page);
    return cards.length;
  }

  async function continueScan(state, settings) {
    var page = currentPageNumber();
    var resumedFromNavigation = state.navPage === page;

    if (resumedFromNavigation) {
      state.navPage = null;
      saveState(state);
    }

    // The site is a client-rendered app: after a fallback reload (or a slow
    // first paint) neither the cards nor the pager may exist at document-idle.
    await waitForPageReady(PAGE_RENDER_TIMEOUT_MS);

    if (cancelRequested) {
      clearState();
      scanInProgress = false;
      cancelRequested = false;
      renderError('Scan cancelled.', 0);
      updateButton('Check failed tasks');
      return;
    }

    var cardsOnPage = collectPage(state, document, page);
    if (resumedFromNavigation && cardsOnPage === 0) {
      // The reload rendered the page but it still had no task cards (for
      // example the page number no longer exists). Do not loop on it.
      state.navFailed = state.navFailed || {};
      state.navFailed[page] = true;
    }
    saveState(state);

    var nextPage = page + 1;
    while (nextPage <= (state.maxPages || 1)) {
      if (cancelRequested) {
        clearState();
        scanInProgress = false;
        cancelRequested = false;
        renderError('Scan cancelled.', 0);
        updateButton('Check failed tasks');
        return;
      }
      if (state.pagesDone.length >= MAX_PAGES) {
        state.truncated = 'page-cap';
        break;
      }
      if (taskCount(state) >= MAX_TASKS) {
        state.truncated = 'task-cap';
        break;
      }

      updateButton('Scanning page ' + nextPage + ' of ' + state.maxPages + '...');
      var href = pageHref(nextPage);
      var doc = await fetchHtml(href);
      var fetchedCards = doc ? collectCards(doc).length : 0;

      if (fetchedCards === 0) {
        // The fetch did not return task cards: either the page is client
        // rendered (HTML is only an app shell) or it blocked. Reload it once
        // and let the resumed run read the real DOM.
        state.navAttempted = state.navAttempted || {};
        if (!state.navAttempted[nextPage]) {
          state.navAttempted[nextPage] = true;
          state.navPage = nextPage;
          saveState(state);
          window.location.href = href;
          return;
        }

        // The reload rendered no cards either, so this page is done. Mark it
        // so a resumed/retried scan never loops over it again.
        state.navFailed = state.navFailed || {};
        state.navFailed[nextPage] = true;
        markPageDone(state, nextPage);
        saveState(state);
        nextPage += 1;
        continue;
      }

      collectPage(state, doc, nextPage);
      state.navPage = null;
      saveState(state);

      nextPage += 1;
      await sleep(PAGE_DELAY_MS);
    }

    await postScan(state, settings);
  }

  async function postScan(state, settings) {
    var tasks = Object.keys(state.tasks || {}).map(function (id) {
      return state.tasks[id];
    });
    // The last collected page can push the total past the server's 500-card
    // limit; trim deterministically instead of letting validation reject the
    // whole scan.
    if (tasks.length > MAX_TASKS) {
      state.truncated = 'task-cap';
      tasks = tasks.slice(0, MAX_TASKS);
    }
    updateButton('Checking ' + tasks.length + ' tasks...');

    try {
      var response = await request(settings, 'POST', '/failed-tasks/scan', {
        tasks: tasks,
        pagesScanned: state.pagesDone.length,
      });
      var result = response && response.data ? response.data : {};
      result.client = {
        truncated: state.truncated || null,
        scannedPages: state.pagesDone.length,
        emptyPages: state.navFailed ? Object.keys(state.navFailed).length : 0,
      };
      clearState();
      saveResult(result);
      scanInProgress = false;
      renderResult(result);
      var newCount = (result.newMismatchIds || []).length;
      updateButton(newCount > 0 ? 'Check failed tasks - ' + newCount + ' new' : 'Check failed tasks');
    } catch (error) {
      // Keep the collected cards so clicking again retries the upload without
      // walking every page again.
      state.active = true;
      state.uploadFailed = true;
      state.navPage = null;
      saveState(state);
      scanInProgress = false;
      renderError(
        (error && error.message) || 'Statbot upload failed.',
        tasks.length,
      );
      updateButton('Retry upload');
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

  function updateButton(text) {
    var button = ensureButton();
    button.textContent = text;
    button.disabled = false;
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

  function appendMismatchRow(panel, row, isNew) {
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

  function renderResult(result) {
    var panel = ensurePanel();
    panelHeader(panel, 'Failed-task check', function () {
      removePanel();
    });

    var body = makeElement('div', { padding: '10px 12px 12px' });
    panel.appendChild(body);

    var client = result.client || {};
    var counts = result.counts || {};
    var mismatches = result.mismatches || [];
    var newIds = result.newMismatchIds || [];
    var scanned = result.scanned || 0;
    var pages = client.scannedPages || result.pagesScanned || 0;

    appendLine(body, 'Scanned ' + scanned + ' failed task(s) across ' + pages + ' page(s).', {
      fontWeight: '600',
    });

    if (result.dm && result.dm.sent) {
      appendLine(body, 'Owner DM sent for ' + newIds.length + ' new mismatch(es).', {
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

    if (client.truncated === 'page-cap') {
      appendLine(
        body,
        'Stopped at the ' + MAX_PAGES + '-page safety cap; later pages were not checked.',
        { color: '#b45309', marginTop: '4px' },
      );
    } else if (client.truncated === 'task-cap') {
      appendLine(
        body,
        'Stopped at the ' + MAX_TASKS + '-task safety cap; remaining cards were not checked.',
        { color: '#b45309', marginTop: '4px' },
      );
    }

    if (client.emptyPages) {
      appendLine(
        body,
        client.emptyPages +
          ' page(s) rendered no cards even after a reload; those pages were skipped.',
        { color: '#b45309', marginTop: '4px' },
      );
    }

    if (mismatches.length) {
      appendLine(body, 'Open mismatches (OK in Statbot, Failed on GoPartTime):', {
        marginTop: '10px',
        fontWeight: '700',
      });
      var newSet = {};
      for (var i = 0; i < newIds.length; i++) newSet[newIds[i]] = true;
      for (var j = 0; j < mismatches.length; j++) {
        appendMismatchRow(body, mismatches[j], !!newSet[mismatches[j].externalTaskId]);
      }
      var actions = makeElement('div', {
        display: 'flex',
        gap: '8px',
        marginTop: '10px',
        flexWrap: 'wrap',
      });
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
      actions.appendChild(
        smallButton('Settings', function () {
          openSettings();
        }),
      );
      body.appendChild(actions);
    } else {
      appendLine(body, 'Nothing to report.', { marginTop: '8px', color: '#374151' });
    }
  }

  function renderError(message, collected) {
    var panel = ensurePanel();
    panelHeader(panel, 'Failed-task check', function () {
      removePanel();
    });
    var body = makeElement('div', { padding: '10px 12px 12px' });
    panel.appendChild(body);
    appendLine(body, message, { color: '#b91c1c', fontWeight: '700' });
    if (collected) {
      appendLine(body, collected + ' card(s) are cached; click the button to retry.', {
        color: '#4b5563',
        marginTop: '6px',
      });
    }
    var actions = makeElement('div', { display: 'flex', gap: '8px', marginTop: '10px' });
    actions.appendChild(
      smallButton('Settings', function () {
        openSettings();
      }),
    );
    actions.appendChild(
      smallButton('Start over', function () {
        clearState();
        removePanel();
        updateButton('Check failed tasks');
      }),
    );
    body.appendChild(actions);
  }

  // --- Boot --------------------------------------------------------------

  function boot() {
    ensureButton();

    var state = loadState();
    if (state && state.navPage === currentPageNumber()) {
      var settings = getSettings();
      if (!settings.apiKey) {
        renderError('Set the API key in Settings before resuming the scan.', taskCount(state));
        updateButton('Check failed tasks');
        return;
      }
      scanInProgress = true;
      updateButton('Resuming scan...');
      continueScan(state, settings).catch(function (error) {
        endScan((error && error.message) || 'Scan failed.');
      });
      return;
    }

    if (state && state.navPage) {
      // The reload landed on a different page than the one requested; drop the
      // navigation marker so a later click starts cleanly.
      state.navPage = null;
      saveState(state);
    }

    if (state && state.uploadFailed) {
      renderError(
        'The last upload failed. Click "Retry upload" to send the cached cards again.',
        taskCount(state),
      );
      updateButton('Retry upload');
      return;
    }

    var lastResult = loadResult();
    if (lastResult) renderResult(lastResult);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
