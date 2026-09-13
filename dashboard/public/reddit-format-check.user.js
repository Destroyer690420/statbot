// ==UserScript==
// @name         Reddit Format Check (Session)
// @namespace    https://statbot.duckdns.org/
// @version      1.0.0
// @description  Compares the open Reddit post (fetched with your logged-in session) against the exact text Statbot sent to Discord. Display-only pre-check; the server verdict stays the source of truth.
// @author       Manager
// @match        *://reddit.com/*
// @match        *://www.reddit.com/*
// @match        *://old.reddit.com/*
// @match        *://new.reddit.com/*
// @match        *://sh.reddit.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      statbot.duckdns.org
// @connect      161.118.164.85
// @connect      localhost
// @connect      127.0.0.1
// @connect      reddit.com
// @connect      www.reddit.com
// @connect      old.reddit.com
// @connect      new.reddit.com
// @connect      sh.reddit.com
// @run-at       document-idle
// ==/UserScript==

/**
 * v1.0.0 - Session-based format pre-check (display-only).
 *
 * Problem it solves: the server format check fetches Reddit JSON from the
 * VPS IP, which Reddit rate-limits (429) and which 404s on fresh posts for
 * ~30s. This script fetches the SAME `.json?raw_json=1` from YOUR browser
 * tab instead (your cookies + your IP), so login-gated / fresh / throttled
 * posts verify fine.
 *
 * Flow:
 *   1. Open the worker's Reddit post link in your browser (logged in).
 *   2. Click the floating "Check Format" button -> enter the GoPartTime
 *      task number (e.g. 960827).
 *   3. The script GETs the exact expected text from Statbot
 *      (`/api/v1/goparttime/expected/:taskId` — title + formattedContent,
 *      i.e. precisely what was delivered to Discord), fetches the live
 *      post JSON same-origin (your session), compares locally, and shows
 *      MATCH / TITLE_MISMATCH / PARA_MISMATCH / TEXT_MISMATCH with a
 *      per-paragraph diff.
 *
 * Deliberate non-features: the script NEVER writes back to Statbot (no
 * POST, no audit, no verdict persistence). The bot reply + dashboard badge
 * from `recordSubmission` remain the only official verdict. This is an
 * instant advisory pre-check for the manager.
 *
 * Comparison logic is a verbatim port of `src/utils/reddit-format.ts`
 * (splitParagraphs / normalizeInline / compareRedditFormat): normalized
 * (case / whitespace / markdown insensitive) but paragraph STRUCTURE is
 * strict — a collapsed post (4 paras -> 1 block) is always a mismatch.
 */
(function () {
  'use strict';

  var DEFAULTS = {
    apiUrl: 'https://statbot.duckdns.org/api/v1/goparttime',
    apiKey: '',
  };
  var FETCH_TIMEOUT_MS = 12000;

  // ─── Storage (GM_* when available, localStorage otherwise) ──

  function storageGet(key) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, '') || '';
    } catch (e) {
      /* fall through */
    }
    try {
      return localStorage.getItem('rfc_' + key) || '';
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
      localStorage.setItem('rfc_' + key, value);
    } catch (e) {
      /* ignore */
    }
  }

  // ─── Settings ───────────────────────────────────────────────

  function getSettings() {
    return {
      apiUrl: (storageGet('api_url').trim() || DEFAULTS.apiUrl).replace(/\/+$/, ''),
      apiKey: storageGet('api_key').trim() || DEFAULTS.apiKey,
    };
  }

  function openSettings() {
    var s = getSettings();
    var base = s.apiUrl.replace(/\/api\/v1\/goparttime\/?$/, '');
    var apiUrl = prompt('Backend API URL (base, without /api/v1):', base);
    if (apiUrl === null) return;
    var apiKey = prompt('API key (GOPARTTIME_API_KEY):', s.apiKey);
    if (apiKey === null) return;
    storageSet('api_url', (apiUrl.trim() || 'https://statbot.duckdns.org') + '/api/v1/goparttime');
    storageSet('api_key', apiKey.trim());
    alert('Settings saved.');
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Configure Format Check...', openSettings);
  }

  // ─── Pure comparison (verbatim port of src/utils/reddit-format.ts) ──

  function splitParagraphs(s) {
    return String(s || '')
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map(function (p) { return p.trim(); })
      .filter(function (p) { return p.length > 0; });
  }

  function normalizeInline(s) {
    var t = String(s || '').normalize('NFC');
    t = t
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2013\u2014\u2015]/g, '-')
      .replace(/\u00A0/g, ' ');
    // [text](url) -> text
    t = t.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1');
    // strip markdown tokens
    t = t.replace(/(\*\*|__|~~|`)/g, '');
    t = t.replace(/(^|\s)[*_](?=\S)/g, '$1').replace(/(\S)[*_](?=\s|$)/g, '$1');
    // blockquote markers + bullets/numbered prefixes per line
    t = t
      .split('\n')
      .map(function (line) {
        return line
          .replace(/^\s*(>\s*)+/, '')
          .replace(/^\s*(\u2022|[-*+]|\d+[.)])\s+/, '')
          .trim();
      })
      .join('\n');
    return t.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function compareRedditFormat(input) {
    var expectedParas = splitParagraphs(input.expectedContent || '');
    var actualParas = splitParagraphs(input.actualContent || '');

    // Image-only posts: both sides empty => match.
    if (expectedParas.length === 0 && actualParas.length === 0) {
      return { status: 'MATCH', expectedParas: 0, actualParas: 0, titleMatch: true, paraMatches: [] };
    }

    var titleMatch =
      !input.expectedTitle || input.expectedTitle.trim().length === 0
        ? true
        : normalizeInline(input.expectedTitle) === normalizeInline(input.actualTitle || '');

    if (!titleMatch) {
      return {
        status: 'TITLE_MISMATCH',
        expectedParas: expectedParas.length,
        actualParas: actualParas.length,
        titleMatch: titleMatch,
        paraMatches: expectedParas.map(function () { return false; }),
      };
    }

    if (expectedParas.length !== actualParas.length) {
      return {
        status: 'PARA_MISMATCH',
        expectedParas: expectedParas.length,
        actualParas: actualParas.length,
        titleMatch: titleMatch,
        paraMatches: expectedParas.map(function () { return false; }),
      };
    }

    var paraMatches = expectedParas.map(function (p, i) {
      return normalizeInline(p) === normalizeInline(actualParas[i] || '');
    });
    if (paraMatches.every(Boolean)) {
      return {
        status: 'MATCH',
        expectedParas: expectedParas.length,
        actualParas: actualParas.length,
        titleMatch: titleMatch,
        paraMatches: paraMatches,
      };
    }
    return {
      status: 'TEXT_MISMATCH',
      expectedParas: expectedParas.length,
      actualParas: actualParas.length,
      titleMatch: titleMatch,
      paraMatches: paraMatches,
    };
  }

  // ─── Reddit URL helpers (mirror src/services/reddit-check.service.ts) ──

  function isRedditPostPage() {
    return /^https?:\/\/(www\.|old\.|new\.|sh\.)?reddit\.com\//i.test(window.location.href);
  }

  function canonicalPostUrl() {
    var href = window.location.href.split(/[?#]/)[0].replace(/\/+$/, '');
    // Drop trailing.json / .json suffixes the UI sometimes adds.
    href = href.replace(/\/\.json$/, '').replace(/\.json$/, '');
    return href;
  }

  function toJsonUrl(normalized, host) {
    var viaHost = normalized.replace(/^https?:\/\/[^/]+/, 'https://' + host);
    return viaHost + '/.json?raw_json=1';
  }

  function parsePostFromJson(data) {
    var post = data && data[0] && data[0].data && data[0].data.children && data[0].data.children[0] && data[0].data.children[0].data;
    if (!post) return null;
    var title = String(post.title || '');
    var selftext = String(post.selftext || '');
    var author = String(post.author || '');
    var trimmedTitle = title.trim();
    var trimmedSelf = selftext.trim();
    var deleted =
      trimmedTitle === '[deleted]' ||
      trimmedTitle === '[removed]' ||
      trimmedSelf === '[deleted]' ||
      trimmedSelf === '[removed]' ||
      author.trim() === '[deleted]';
    return { title: title, selftext: selftext, author: author, subreddit: String(post.subreddit || ''), deleted: deleted };
  }

  function fetchJsonSameOrigin(url) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) {
          var err = new Error('Reddit returned ' + res.status + '.');
          err.httpStatus = res.status;
          throw err;
        }
        return res.json();
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function fetchJsonViaGm(url) {
    return new Promise(function (resolve, reject) {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest unavailable.'));
        return;
      }
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        headers: { Accept: 'application/json' },
        timeout: FETCH_TIMEOUT_MS,
        onload: function (res) {
          if (res.status >= 200 && res.status < 300) {
            try {
              resolve(JSON.parse(res.responseText));
            } catch (e) {
              reject(new Error('Could not parse the Reddit post.'));
            }
          } else {
            var err = new Error('Reddit returned ' + res.status + '.');
            err.httpStatus = res.status;
            reject(err);
          }
        },
        onerror: function () { reject(new Error('Reddit fetch failed (network).')); },
        ontimeout: function () { reject(new Error('Reddit fetch timed out.')); },
      });
    });
  }

  /**
   * Session fetch of the open post: same-origin first (your login cookies),
   * then old.reddit.com via GM_xhr (still your session where cookies apply).
   */
  function fetchLivePost() {
    var canonical = canonicalPostUrl();
    var hosts = [];
    var currentHost = (window.location.hostname || '').toLowerCase();
    if (currentHost) hosts.push(currentHost);
    if (hosts.indexOf('www.reddit.com') === -1) hosts.push('www.reddit.com');
    if (hosts.indexOf('old.reddit.com') === -1) hosts.push('old.reddit.com');

    var lastError = 'Unknown fetch error.';
    var chain = Promise.resolve(null);
    hosts.forEach(function (host) {
      chain = chain.then(function (found) {
        if (found) return found;
        var url = toJsonUrl(canonical, host);
        var attempt = host === currentHost ? fetchJsonSameOrigin(url) : fetchJsonViaGm(url);
        return attempt
          .then(function (data) {
            var post = parsePostFromJson(data);
            if (!post) {
              lastError = 'Could not parse the Reddit post (removed or private?).';
              return null;
            }
            return post;
          })
          .catch(function (err) {
            if (err && err.httpStatus === 404) lastError = 'Post not found (404 - too new, deleted, or private).';
            else if (err && err.httpStatus === 429) lastError = 'Reddit rate-limited (429). Wait a minute and retry.';
            else lastError = err && err.message ? err.message : String(err);
            return null;
          });
      });
    });
    return chain.then(function (found) {
      if (found) return found;
      throw new Error(lastError);
    });
  }

  // ─── Backend expected fetch (extension key, GM_xhr bypasses CORS) ──

  function fetchExpected(taskId) {
    var settings = getSettings();
    if (!settings.apiKey) {
      openSettings();
      return Promise.reject(new Error('API key missing - configure it first (Tampermonkey menu).'));
    }
    var url = settings.apiUrl + '/expected/' + encodeURIComponent(taskId);
    var headers = { Accept: 'application/json', Authorization: 'Bearer ' + settings.apiKey };

    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise(function (resolve, reject) {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          headers: headers,
          timeout: 30000,
          onload: function (res) {
            var body = null;
            try {
              body = JSON.parse(res.responseText);
            } catch (e) {
              reject(new Error('Bad response from Statbot.'));
              return;
            }
            if (res.status === 404) { reject(new Error('Task ' + taskId + ' not found on Statbot.')); return; }
            if (res.status === 401) { reject(new Error('Authentication failed. Check your API key.')); return; }
            if (res.status !== 200 || !body || !body.success) {
              reject(new Error((body && body.message) || ('Statbot error (' + res.status + ').')));
              return;
            }
            resolve(body.data);
          },
          onerror: function () { reject(new Error('Statbot unreachable.')); },
          ontimeout: function () { reject(new Error('Statbot unreachable (timeout).')); },
        });
      });
    }

    // Non-GM fallback (will usually fail CORS from reddit.com - Tampermonkey required).
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 30000) : null;
    return fetch(url, { headers: headers, signal: controller ? controller.signal : undefined })
      .then(function (res) { return res.json().then(function (body) { return { res: res, body: body }; }); })
      .then(function (pair) {
        if (timer) clearTimeout(timer);
        if (pair.res.status !== 200 || !pair.body || !pair.body.success) {
          throw new Error((pair.body && pair.body.message) || ('Statbot error (' + pair.res.status + ').'));
        }
        return pair.body.data;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  // ─── UI ─────────────────────────────────────────────────────

  var PANEL_ID = 'rfc-format-panel';
  var BTN_ID = 'rfc-format-button';

  function el(tag, style, text) {
    var n = document.createElement(tag);
    if (style) Object.assign(n.style, style);
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function ensureButton() {
    if (document.getElementById(BTN_ID)) return;
    var btn = el('button', {
      position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483647',
      border: 'none', background: '#5865F2', color: '#fff', fontWeight: '600',
      cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: '12px 18px', borderRadius: '10px', fontSize: '14px',
    }, 'Check Format');
    btn.id = BTN_ID;
    btn.addEventListener('click', togglePanel);
    document.body.appendChild(btn);
  }

  function togglePanel() {
    var existing = document.getElementById(PANEL_ID);
    if (existing) { existing.remove(); return; }
    document.body.appendChild(buildPanel());
  }

  function buildPanel() {
    var panel = el('div', {
      position: 'fixed', right: '20px', bottom: '72px', zIndex: '2147483647',
      width: 'min(92vw, 420px)', maxHeight: '70vh', overflowY: 'auto',
      background: '#1e1e2e', color: '#e5e5e5', border: '1px solid #444',
      borderRadius: '12px', padding: '14px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: '13px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    });
    panel.id = PANEL_ID;

    var head = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' });
    head.appendChild(el('strong', {}, 'Reddit Format Check (your session)'));
    var close = el('button', { background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '16px' }, 'X');
    close.addEventListener('click', function () { panel.remove(); });
    head.appendChild(close);
    panel.appendChild(head);

    var urlLine = el('div', { fontSize: '11px', color: '#999', marginBottom: '8px', wordBreak: 'break-all' }, 'Post: ' + canonicalPostUrl());
    panel.appendChild(urlLine);

    var row = el('div', { display: 'flex', gap: '8px', marginBottom: '10px' });
    var input = el('input', {
      flex: '1', padding: '8px', borderRadius: '8px', border: '1px solid #555',
      background: '#111', color: '#fff', fontSize: '13px',
    });
    input.placeholder = 'GoPartTime task ID (e.g. 960827)';
    input.value = storageGet('last_task_id') || '';
    var check = el('button', {
      padding: '8px 14px', borderRadius: '8px', border: 'none',
      background: '#2FBF71', color: '#fff', fontWeight: '600', cursor: 'pointer',
    }, 'Check');
    row.appendChild(input);
    row.appendChild(check);
    panel.appendChild(row);

    var out = el('div', { fontSize: '13px', lineHeight: '1.5' }, 'Enter the task number, then Check.');
    panel.appendChild(out);

    check.addEventListener('click', function () {
      var taskId = input.value.trim();
      if (!/^\d+$/.test(taskId)) {
        out.textContent = 'Enter a numeric GoPartTime task ID.';
        return;
      }
      storageSet('last_task_id', taskId);
      out.textContent = 'Checking (expected from Statbot + live from your tab)...';
      check.disabled = true;
      Promise.all([fetchExpected(taskId), fetchLivePost()])
        .then(function (pair) {
          renderResult(out, pair[0], pair[1]);
        })
        .catch(function (err) {
          out.textContent = '';
          out.appendChild(el('div', { color: '#ff9d5c' }, 'Could not verify: ' + (err.message || err)));
          out.appendChild(el('div', { fontSize: '11px', color: '#999', marginTop: '6px' },
            'Tip: fresh posts 404 for ~30s after publish - wait and Check again.'));
        })
        .then(function () { check.disabled = false; });
    });

    return panel;
  }

  function hintFor(status) {
    if (status === 'PARA_MISMATCH') return ' Paragraphs look collapsed - make sure there is a blank line between each paragraph on Reddit.';
    if (status === 'TITLE_MISMATCH') return ' The title does not match - copy it exactly.';
    if (status === 'TEXT_MISMATCH') return ' The text differs - check for missing or altered paragraphs.';
    return '';
  }

  function renderResult(out, expected, live) {
    out.textContent = '';
    if (expected.type !== 'POST') {
      out.appendChild(el('div', { color: '#9ad' }, 'Task is a COMMENT - format check is POST-only (SKIPPED).'));
      return;
    }
    if (live.deleted) {
      out.appendChild(el('div', { color: '#ff9d5c' }, 'Live post looks DELETED/REMOVED on Reddit.'));
      return;
    }
    var cmp = compareRedditFormat({
      expectedTitle: expected.title,
      expectedContent: expected.formattedContent,
      actualTitle: live.title,
      actualContent: live.selftext,
    });
    var countStr = ' (' + cmp.actualParas + '/' + cmp.expectedParas + ' paras, title ' + (cmp.titleMatch ? 'OK' : 'DIFF') + ')';
    if (cmp.status === 'MATCH') {
      out.appendChild(el('div', { color: '#7ee2a8', fontWeight: '700' }, 'MATCH' + countStr + ' - ready for review.'));
    } else {
      out.appendChild(el('div', { color: '#ff7b7b', fontWeight: '700' }, cmp.status + countStr + '.' + hintFor(cmp.status)));
    }
    if (expected.submittedRedditUrl) {
      var same = expected.submittedRedditUrl.split(/[?#]/)[0].replace(/\/+$/, '') === canonicalPostUrl();
      if (!same) {
        out.appendChild(el('div', { fontSize: '11px', color: '#ff9d5c', marginTop: '6px' },
          'Note: this tab URL differs from the worker-submitted URL on Statbot.'));
      }
    }
    var expParas = splitParagraphs(expected.formattedContent || '');
    var actParas = splitParagraphs(live.selftext || '');
    var max = Math.max(expParas.length, actParas.length);
    for (var i = 0; i < max; i++) {
      var ok = normalizeInline(expParas[i] || '') === normalizeInline(actParas[i] || '');
      var line = el('div', {
        marginTop: '6px', padding: '6px 8px', borderRadius: '8px', fontSize: '12px',
        border: '1px solid ' + (ok ? '#2c5' : '#c55'),
        background: ok ? 'rgba(46,204,113,0.08)' : 'rgba(204,85,85,0.10)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }, 'P' + (i + 1) + ' ' + (ok ? 'OK' : 'DIFF') + '\nExp: ' + (expParas[i] || '(missing)') + '\nLive: ' + (actParas[i] || '(missing)'));
      out.appendChild(line);
    }
    out.appendChild(el('div', { fontSize: '11px', color: '#999', marginTop: '8px' },
      'Advisory only (your session). Official verdict stays the bot reply + dashboard badge.'));
  }

  // ─── Boot ───────────────────────────────────────────────────

  if (isRedditPostPage()) {
    ensureButton();
  }
})();
