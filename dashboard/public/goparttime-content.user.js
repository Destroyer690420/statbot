// ==UserScript==
// @name         GoPartTime Task Content Peeker
// @namespace    https://statbot.duckdns.org/
// @version      1.3.0
// @updateURL    https://statbot.duckdns.org/goparttime-content.user.js
// @downloadURL  https://statbot.duckdns.org/goparttime-content.user.js
// @description  Dedicated Tab 3 ultra-fast executor on /tasks?peeker=1 to extract full post body content into StatBot at god speed without accepting. Never clicks Confirm.
// @author       StatBot Team
// @match        *://goparttime.net/tasks*
// @match        *://www.goparttime.net/tasks*
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
 * GoPartTime Task Content Peeker (Tab 3 Dedicated Script - GOD SPEED EDITION v1.3.0)
 *
 * Runs exclusively in a dedicated browser tab opened at:
 *   https://goparttime.net/tasks?peeker=1
 *
 * PURPOSE:
 * GoPartTime's Next.js Flight listing omits post body content (div.prose) from the main list.
 * The body is only loaded into the DOM when a card's drawer opens.
 *
 * FEATURES in v1.3.0:
 * - Waits for the drawer's prose body to actually hydrate before reading it
 *   (v1.2.0 read an empty div.prose and permanently marked cards "peeked",
 *   which is why workers saw "(No content)").
 * - Cards are only recorded as peeked AFTER the server accepts the content;
 *   failed/401 uploads retry with a cooldown instead of being lost.
 * - Direct in-page API key configuration (gear button + prominent warning banner if missing).
 * - Multi-storage synchronization: inherits API key seamlessly from Tab 1 (Auto Watcher) via localStorage.
 * - Handles 401 Unauthorized explicitly with visual diagnostics and instant click-to-fix prompt.
 * - Fast sequential pipeline sweeps through cards (~100ms per card).
 * - Extracts prose content + title and immediately closes drawer without ever clicking "Confirm acceptance".
 */

(function () {
  'use strict';

  const VERSION = '1.3.0';
  const DEFAULTS = {
    apiUrl: 'https://statbot.duckdns.org/api/v1/automation',
    apiKey: '',
  };

  const SWEEP_INTERVAL_MS = 400;
  const RELOAD_IDLE_MS = 35 * 1000;
  const DRAWER_TIMEOUT_MS = 1200;
  // The drawer mounts before its body finishes hydrating; reading div.prose the
  // instant the drawer appears is what produced empty "(No content)" posts.
  const CONTENT_TIMEOUT_MS = 2000;
  const CONTENT_POLL_MS = 40;
  const MAX_PEEK_ATTEMPTS = 3;
  const SEND_RETRY_COOLDOWN_MS = 5000;
  // Version-scoped: v1.2.0 cached every id as "peeked" even when the drawer
  // body was still empty, so an upgrade must re-peek those cards once.
  const PEEKED_STORAGE_KEY = 'rtm_peeker_extracted_ids_v130';

  let authErrorDetected = false;
  let statusBox = null;
  let latestUiState = {
    countPeeked: 0,
    countAvailable: 0,
    statusText: 'Initializing...',
    isPeeking: false,
  };

  function isPeekerTab() {
    return window.location.search.includes('peeker=1') || window.location.hash.includes('peeker');
  }

  function storageSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, value);
    } catch (e) { /* ignore */ }
    try {
      localStorage.setItem('gpt_' + key, value);
      localStorage.setItem(key, value);
      if (key === 'gpt_api_key' || key === 'apiKey' || key === 'api_key') {
        localStorage.setItem('gpt_api_key', value);
        localStorage.setItem('rtm_companion_api_key', value);
      }
    } catch (e) { /* ignore */ }
  }

  function storageGet(key) {
    try {
      if (typeof GM_getValue === 'function') {
        const val = GM_getValue(key, '');
        if (val) return val;
      }
    } catch (e) { /* fall through */ }
    try {
      return (
        localStorage.getItem('gpt_' + key) ||
        localStorage.getItem(key) ||
        localStorage.getItem('gpt_gpt_' + key) ||
        sessionStorage.getItem('gpt_' + key) ||
        sessionStorage.getItem(key) ||
        ''
      );
    } catch (e) {
      return '';
    }
  }

  function getSettings() {
    let apiUrl =
      storageGet('gpt_api_url') ||
      storageGet('api_url') ||
      storageGet('rtm_peeker_api_url') ||
      DEFAULTS.apiUrl;
    let apiKey =
      storageGet('gpt_api_key') ||
      storageGet('api_key') ||
      storageGet('rtm_companion_api_key') ||
      storageGet('rtm_peeker_api_key') ||
      DEFAULTS.apiKey;
    return {
      apiUrl: (apiUrl.trim() || DEFAULTS.apiUrl).replace(/\/api\/v1\/goparttime\/?$/, '/api/v1/automation').replace(/\/+$/, ''),
      apiKey: apiKey.trim(),
    };
  }

  function promptConfigureApiKey() {
    const cur = getSettings();
    const input = prompt(
      'StatBot Content Peeker: Enter your GOPARTTIME_API_KEY (64-character secret key):',
      cur.apiKey || ''
    );
    if (input === null) return;
    const clean = input.trim();
    storageSet('gpt_api_key', clean);
    storageSet('api_key', clean);
    storageSet('rtm_companion_api_key', clean);
    authErrorDetected = false;
    if (clean.length === 64) {
      alert('✅ API Key saved successfully! The Content Peeker is now active.');
    } else if (clean.length > 0) {
      alert(`⚠️ API Key saved, but length is ${clean.length} characters (expected 64).`);
    } else {
      alert('⚠️ API Key cleared.');
    }
    renderUI(latestUiState);
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('⚙️ Configure StatBot API Key', promptConfigureApiKey);
  }

  // --- Asynchronous Non-blocking Network Request ---
  function request(method, path, body) {
    const settings = getSettings();
    const url = settings.apiUrl + path;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + settings.apiKey,
    };
    const payload = body ? JSON.stringify(body) : undefined;

    const handleResult = (status, text) => {
      if (status === 401) {
        authErrorDetected = true;
        console.error('[RTM Content Peeker] ❌ 401 Unauthorized! API key is missing or invalid. Click the banner gear or button to set key.');
        renderUI({
          ...latestUiState,
          statusText: '401 Unauthorized (Invalid Key)',
          isPeeking: false,
        });
        return { ok: false, error: 'unauthorized' };
      }
      authErrorDetected = false;
      try {
        return JSON.parse(text);
      } catch (err) {
        return { ok: status >= 200 && status < 300 };
      }
    };

    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method,
          url,
          headers,
          data: payload,
          timeout: 10000,
          onload: (res) => resolve(handleResult(res.status, res.responseText)),
          onerror: () => reject(new Error('Network error connecting to StatBot.')),
          ontimeout: () => reject(new Error('Network timeout connecting to StatBot.')),
        });
      });
    }

    return fetch(url, {
      method,
      headers,
      body: payload,
      credentials: 'omit',
    }).then(async (res) => {
      const text = await res.text();
      return handleResult(res.status, text);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- Session Storage for Extracted Task IDs ---
  function loadPeekedIds() {
    const set = new Set();
    try {
      const raw = sessionStorage.getItem(PEEKED_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          for (const id of arr) set.add(String(id));
        }
      }
    } catch (e) { /* ignore */ }
    return set;
  }

  function savePeekedId(set, id) {
    set.add(String(id));
    try {
      sessionStorage.setItem(PEEKED_STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch (e) { /* ignore */ }
  }

  // --- Fast DOM Helpers ---
  function findField(labelText, root) {
    const nodes = (root || document).querySelectorAll('div, span');
    for (const el of nodes) {
      if (el.children.length === 0 && (el.textContent || '').trim() === labelText) {
        const sibling = el.nextElementSibling;
        if (sibling) {
          return (sibling.textContent || '').trim();
        }
      }
    }
    return null;
  }

  function findOpenDrawer() {
    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
    return dialogs.find((d) => d.getAttribute('data-state') === 'open' || d.querySelector('div.prose')) || null;
  }

  function isDrawerOpen() {
    const d = findOpenDrawer();
    return !!d && d.getAttribute('data-state') !== 'closed';
  }

  function closeOpenDrawerFast() {
    try {
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
    } catch (e) { /* ignore */ }
  }

  function waitForDrawer(timeoutMs) {
    const limit = timeoutMs || DRAWER_TIMEOUT_MS;
    return new Promise((resolve) => {
      const initial = findOpenDrawer();
      if (initial && (initial.querySelector('div.prose') || initial.querySelector('input[name="title"]'))) {
        return resolve(initial);
      }
      const start = Date.now();
      const timer = setInterval(() => {
        const d = findOpenDrawer();
        if (d && (d.querySelector('div.prose') || d.querySelector('input[name="title"]'))) {
          clearInterval(timer);
          return resolve(d);
        }
        if (Date.now() - start > limit) {
          clearInterval(timer);
          return resolve(null);
        }
      }, 25);
    });
  }

  function waitForDrawerClosed(timeoutMs) {
    const limit = timeoutMs || 400;
    return new Promise((resolve) => {
      if (!isDrawerOpen()) return resolve();
      const start = Date.now();
      const timer = setInterval(() => {
        if (!isDrawerOpen() || Date.now() - start > limit) {
          clearInterval(timer);
          return resolve();
        }
      }, 25);
    });
  }

  /**
   * Reads the post body from an open drawer. Returns empty strings until the
   * drawer has hydrated its prose body — callers must wait for non-empty.
   */
  function readDrawerContent(drawer) {
    if (!drawer) return { text: '', html: '', hasImages: false };
    const proseEl = drawer.querySelector('div.prose');
    const text = proseEl ? (proseEl.innerText || proseEl.textContent || '').trim() : '';
    const html = proseEl && proseEl.innerHTML.trim() ? proseEl.innerHTML : '';
    let hasImages = false;
    if (!text && !html) {
      // Image-only tasks legitimately have no prose body. Treat visible task
      // media as content so those cards are not retried forever.
      hasImages = Array.from(drawer.querySelectorAll('img')).some((img) => {
        const src = (img.getAttribute('src') || '').trim();
        const alt = (img.getAttribute('alt') || '').trim();
        return (/^https?:\/\//.test(src) || /^https?:\/\//.test(alt)) &&
          !img.closest('button') &&
          !(img.naturalWidth && img.naturalWidth < 60);
      });
    }
    return { text, html, hasImages };
  }

  /**
   * Polls the currently open drawer until its body is readable (or timeout).
   * Keeps the drawer reference fresh in case React remounts it.
   */
  async function waitForDrawerContent(drawer) {
    const start = Date.now();
    let current = drawer;
    let content = readDrawerContent(current);
    while (!content.text && !content.html && !content.hasImages) {
      if (Date.now() - start > CONTENT_TIMEOUT_MS) break;
      await sleep(CONTENT_POLL_MS);
      const fresh = findOpenDrawer();
      if (fresh) current = fresh;
      content = readDrawerContent(current);
    }
    return { drawer: current, content };
  }

  function findCardAcceptButton(card) {
    if (!card) return null;
    const btns = Array.from(card.querySelectorAll('button'));
    return btns.find((b) => (b.textContent || '').trim().toLowerCase() === 'accept task') || null;
  }

  function getCardFiberId(card) {
    if (!card) return null;
    for (const k of Object.keys(card)) {
      if (k.startsWith('__reactFiber$')) {
        const fiber = card[k];
        if (fiber && fiber.key) {
          const km = String(fiber.key).match(/\d+/);
          if (km) return km[0];
        }
      }
    }
    return null;
  }

  function unescapeUnicode(str) {
    if (!str) return '';
    try {
      return str
        .replace(/\\u([0-9a-fA-F]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    } catch (e) {
      return str;
    }
  }

  // --- UI Pill & Status Banner ---
  function renderUI(state) {
    latestUiState = { ...latestUiState, ...state };

    if (!isPeekerTab()) {
      if (!statusBox) {
        statusBox = document.createElement('div');
        statusBox.id = 'rtm-peeker-standby';
        statusBox.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2147483647;cursor:pointer;';
        statusBox.innerHTML = `
          <button style="display:flex;align-items:center;gap:8px;background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:600;font-family:sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);cursor:pointer;">
            <span>⚡</span>
            <span>Open Content Peeker (Tab 3)</span>
          </button>
        `;
        statusBox.onclick = () => {
          window.open(window.location.origin + '/tasks?peeker=1', '_blank');
        };
        document.body.appendChild(statusBox);
      }
      return;
    }

    if (!statusBox) {
      statusBox = document.createElement('div');
      statusBox.id = 'rtm-peeker-active';
      statusBox.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
      document.body.appendChild(statusBox);
    }

    const { countPeeked, countAvailable, statusText, isPeeking } = latestUiState;
    const settings = getSettings();
    const hasKey = !!settings.apiKey;

    let alertHtml = '';
    if (authErrorDetected) {
      alertHtml = `
        <button id="rtm-peeker-cfg-btn" style="margin-top:8px;width:100%;background:#dc2626;color:#ffffff;border:1px solid #ef4444;border-radius:6px;padding:6px 8px;font-size:11px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 0 10px rgba(239,68,68,0.5);">
          <span>❌</span>
          <span>401 Unauthorized — Click to Fix Key</span>
        </button>
      `;
    } else if (!hasKey) {
      alertHtml = `
        <button id="rtm-peeker-cfg-btn" style="margin-top:8px;width:100%;background:#d97706;color:#ffffff;border:1px solid #f59e0b;border-radius:6px;padding:6px 8px;font-size:11px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 0 10px rgba(245,158,11,0.5);">
          <span>⚠️</span>
          <span>No API Key — Click to Set</span>
        </button>
      `;
    }

    statusBox.innerHTML = `
      <div style="background:#090d16;color:#f8fafc;border:1px solid ${authErrorDetected ? '#ef4444' : hasKey ? '#3b82f6' : '#f59e0b'};border-radius:10px;padding:12px 16px;box-shadow:0 8px 24px rgba(0,0,0,0.5);font-size:12px;min-width:250px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;border-bottom:1px solid #1e293b;padding-bottom:6px;">
          <div style="display:flex;align-items:center;gap:6px;font-weight:700;color:#38bdf8;">
            <span>⚡</span>
            <span>Content Peeker</span>
          </div>
          <div style="display:flex;align-items:center;gap:5px;">
            <button id="rtm-peeker-gear-btn" title="Configure API Key" style="background:#1e293b;color:#94a3b8;border:1px solid #334155;border-radius:4px;padding:2px 6px;font-size:11px;cursor:pointer;line-height:1;">⚙️</button>
            <span style="font-size:10px;background:#1e3a8a;color:#93c5fd;padding:2px 6px;border-radius:4px;font-weight:700;">v${VERSION}</span>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;font-size:11px;">
          <div style="background:#131d31;padding:4px 8px;border-radius:6px;">
            <div style="color:#94a3b8;font-size:10px;">Enriched</div>
            <div style="font-weight:700;color:#34d399;font-size:13px;">${countPeeked ?? 0}</div>
          </div>
          <div style="background:#131d31;padding:4px 8px;border-radius:6px;">
            <div style="color:#94a3b8;font-size:10px;">Cards Found</div>
            <div style="font-weight:700;color:#38bdf8;font-size:13px;">${countAvailable ?? 0}</div>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:6px;color:#cbd5e1;font-size:11px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${authErrorDetected ? '#ef4444' : isPeeking ? '#eab308' : hasKey ? '#22c55e' : '#f59e0b'};box-shadow:0 0 6px ${authErrorDetected ? '#ef4444' : isPeeking ? '#eab308' : hasKey ? '#22c55e' : '#f59e0b'};"></span>
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;">${statusText || 'Idle'}</span>
        </div>

        ${alertHtml}

        <div style="margin-top:8px;border-top:1px solid #1e293b;padding-top:6px;font-size:10px;color:#64748b;text-align:center;">
          🔒 Never accepts tasks (Read-only peeker)
        </div>
      </div>
    `;

    const cfgBtn = statusBox.querySelector('#rtm-peeker-cfg-btn');
    if (cfgBtn) cfgBtn.onclick = promptConfigureApiKey;
    const gearBtn = statusBox.querySelector('#rtm-peeker-gear-btn');
    if (gearBtn) gearBtn.onclick = promptConfigureApiKey;
  }

  // --- Main Peeker Loop (God Speed Engine) ---
  async function runPeeker() {
    if (!isPeekerTab()) {
      renderUI({});
      return;
    }

    const peekedIds = loadPeekedIds();
    const peekAttempts = new Map();
    let isSweeping = false;
    let lastActionAt = Date.now();

    console.log(`[RTM Content Peeker] Initialized in Tab 3 (?peeker=1) — v${VERSION}.`);
    closeOpenDrawerFast();

    async function sweepCards() {
      if (isSweeping) return;
      isSweeping = true;

      try {
        const settings = getSettings();
        const cards = Array.from(document.querySelectorAll('div[data-slot="card"]'));

        if (!settings.apiKey) {
          renderUI({
            countPeeked: peekedIds.size,
            countAvailable: cards.length,
            statusText: 'Waiting for API key...',
            isPeeking: false,
          });
          return;
        }

        if (cards.length === 0) {
          renderUI({
            countPeeked: peekedIds.size,
            countAvailable: 0,
            statusText: 'No cards on page. Waiting...',
            isPeeking: false,
          });

          if (Date.now() - lastActionAt > RELOAD_IDLE_MS) {
            console.log('[RTM Content Peeker] Idle timeout on empty page. Refreshing...');
            lastActionAt = Date.now();
            window.location.reload();
          }
          return;
        }

        let peekedInThisSweep = 0;

        for (const card of cards) {
          // Fast check: card already tagged or peeked
          if (card.getAttribute('data-rtm-peeked')) continue;

          // In-flight upload or post-failure cooldown for this card
          if (card.getAttribute('data-rtm-sending')) continue;
          const retryAt = Number(card.getAttribute('data-rtm-retry-at') || 0);
          if (retryAt && Date.now() < retryAt) continue;

          const fiberId = getCardFiberId(card);
          if (fiberId && peekedIds.has(String(fiberId))) {
            card.setAttribute('data-rtm-peeked', fiberId);
            continue;
          }

          const btn = findCardAcceptButton(card);
          if (!btn || btn.disabled) continue;

          peekedInThisSweep++;
          renderUI({
            countPeeked: peekedIds.size,
            countAvailable: cards.length,
            statusText: `⚡ Peeking ${fiberId ? '#' + fiberId : 'card ' + peekedInThisSweep}...`,
            isPeeking: true,
          });

          // Trigger click
          card.scrollIntoView({ block: 'nearest' });
          btn.click();

          // Wait for drawer to appear (checks every 25ms)
          let drawer = await waitForDrawer(DRAWER_TIMEOUT_MS);
          if (!drawer) {
            closeOpenDrawerFast();
            await sleep(40);
            continue;
          }

          // The drawer mounts before its body hydrates: wait for readable
          // content instead of reading an empty div.prose immediately.
          const result = await waitForDrawerContent(drawer);
          drawer = result.drawer;
          const content = result.content;

          const detectedId = findField('Task ID', drawer) || fiberId;
          const titleInput = drawer.querySelector('input[name="title"]');
          const title = titleInput ? unescapeUnicode((titleInput.value || '').trim()) : null;

          // IMMEDIATELY CLOSE THE DRAWER — ZERO WAIT
          closeOpenDrawerFast();

          const attemptKey = String(detectedId || fiberId || '');
          const hasContent = !!(content.text || content.html || content.hasImages);

          if (!detectedId || !hasContent) {
            // Never mark an empty read as "done" — that is exactly how cards
            // were stuck on "(No content)" forever. Retry a few sweeps, then
            // give up (image-only/undetectable cards must not loop forever).
            if (attemptKey) {
              const attempts = (peekAttempts.get(attemptKey) || 0) + 1;
              peekAttempts.set(attemptKey, attempts);
              if (attempts >= MAX_PEEK_ATTEMPTS) {
                card.setAttribute('data-rtm-peeked', detectedId || attemptKey);
                savePeekedId(peekedIds, detectedId || attemptKey);
                console.warn(`[RTM Content Peeker] ⚠️ #${detectedId || attemptKey} produced no readable content after ${attempts} attempts — giving up.`);
              } else {
                card.setAttribute('data-rtm-retry-at', String(Date.now() + 400));
              }
            }
            await waitForDrawerClosed(350);
            await sleep(25);
            continue;
          }

          // Upload, and only record the card as peeked once the server has it.
          // A failed/401 send is retried (with a cooldown) instead of being
          // lost until the tab is reopened.
          card.setAttribute('data-rtm-sending', '1');
          lastActionAt = Date.now();
          console.log(`[RTM Content Peeker] ⚡ Extracted #${detectedId} (${content.text.length} chars). Streaming to StatBot...`);
          request('POST', '/task-content', {
            subTaskId: detectedId,
            title,
            content: content.text,
            contentHtml: content.html,
          }).then((res) => {
            card.removeAttribute('data-rtm-sending');
            if (res && res.success) {
              card.setAttribute('data-rtm-peeked', detectedId);
              card.removeAttribute('data-rtm-retry-at');
              savePeekedId(peekedIds, detectedId);
            } else {
              card.removeAttribute('data-rtm-peeked');
              card.setAttribute('data-rtm-retry-at', String(Date.now() + SEND_RETRY_COOLDOWN_MS));
              console.warn('[RTM Content Peeker] Stream rejected — will retry #' + detectedId);
            }
          }).catch((err) => {
            card.removeAttribute('data-rtm-sending');
            card.removeAttribute('data-rtm-peeked');
            card.setAttribute('data-rtm-retry-at', String(Date.now() + SEND_RETRY_COOLDOWN_MS));
            console.warn('[RTM Content Peeker] Stream failed:', err);
          });

          // Ultra-short wait for drawer unmount before next card
          await waitForDrawerClosed(350);
          await sleep(25); // tiny 25ms tick to yield to browser paint
        }

        renderUI({
          countPeeked: peekedIds.size,
          countAvailable: cards.length,
          statusText: peekedInThisSweep > 0 ? `⚡ Peeked ${peekedInThisSweep} tasks!` : 'All cards enriched. Waiting...',
          isPeeking: false,
        });

        // Periodic drop refresh
        const d = new Date();
        const isTenMinute = d.getMinutes() === 10 && d.getSeconds() < 25;
        if (isTenMinute || Date.now() - lastActionAt > RELOAD_IDLE_MS) {
          console.log('[RTM Content Peeker] Drop refresh triggered.');
          lastActionAt = Date.now();
          window.location.reload();
        }
      } catch (err) {
        console.error('[RTM Content Peeker] Sweep error:', err);
        closeOpenDrawerFast();
      } finally {
        isSweeping = false;
      }
    }

    // Run sweep every 400ms
    setInterval(sweepCards, SWEEP_INTERVAL_MS);

    // Initial immediate sweep
    sweepCards();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runPeeker);
  } else {
    runPeeker();
  }
})();
