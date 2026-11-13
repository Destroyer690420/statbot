// ==UserScript==
// @name         GoPartTime Task Content Peeker
// @namespace    https://statbot.duckdns.org/
// @version      1.1.0
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
 * GoPartTime Task Content Peeker (Tab 3 Dedicated Script - GOD SPEED EDITION)
 *
 * Runs exclusively in a dedicated browser tab opened at:
 *   https://goparttime.net/tasks?peeker=1
 *
 * PURPOSE:
 * GoPartTime's Next.js Flight listing omits post body content (div.prose) from the main list.
 * The body is only loaded into the DOM when a card's drawer opens.
 *
 * ULTRA-FAST (GOD SPEED) PIPELINE:
 * - Continuous fast pipeline sweeps through cards sequentially in milliseconds (~100ms per card).
 * - Checks drawer readiness via 25ms tight polling.
 * - Non-blocking asynchronous streaming to StatBot backend.
 * - Extracts prose content + title and immediately closes drawer without ever clicking "Confirm acceptance".
 */

(function () {
  'use strict';

  const VERSION = '1.1.0';
  const DEFAULTS = {
    apiUrl: 'https://statbot.duckdns.org/api/v1/automation',
    apiKey: '',
  };

  const SWEEP_INTERVAL_MS = 400;
  const RELOAD_IDLE_MS = 35 * 1000;
  const DRAWER_TIMEOUT_MS = 1200;

  function isPeekerTab() {
    return window.location.search.includes('peeker=1') || window.location.hash.includes('peeker');
  }

  function storageGet(key) {
    try {
      if (typeof GM_getValue === 'function') {
        const val = GM_getValue(key, '');
        if (val) return val;
      }
    } catch (e) { /* fall through */ }
    try {
      return localStorage.getItem('gpt_' + key) || localStorage.getItem(key) || '';
    } catch (e) {
      return '';
    }
  }

  function getSettings() {
    let apiUrl = storageGet('gpt_api_url') || storageGet('rtm_peeker_api_url') || DEFAULTS.apiUrl;
    let apiKey = storageGet('gpt_api_key') || storageGet('rtm_peeker_api_key') || DEFAULTS.apiKey;
    return {
      apiUrl: (apiUrl.trim() || DEFAULTS.apiUrl).replace(/\/api\/v1\/goparttime\/?$/, '/api/v1/automation').replace(/\/+$/, ''),
      apiKey: apiKey.trim(),
    };
  }

  // --- Asynchronous Non-blocking Network Request ---
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
          timeout: 10000,
          onload: (res) => {
            try {
              resolve(JSON.parse(res.responseText));
            } catch (err) {
              resolve({ ok: res.status >= 200 && res.status < 300 });
            }
          },
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
      try {
        return await res.json();
      } catch (e) {
        return { ok: res.ok };
      }
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- Session Storage for Extracted Task IDs ---
  function loadPeekedIds() {
    const set = new Set();
    try {
      const raw = sessionStorage.getItem('rtm_peeker_extracted_ids');
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
      sessionStorage.setItem('rtm_peeker_extracted_ids', JSON.stringify(Array.from(set)));
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
  let statusBox = null;

  function renderUI(state) {
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

    const { countPeeked, countAvailable, statusText, isPeeking } = state;
    statusBox.innerHTML = `
      <div style="background:#090d16;color:#f8fafc;border:1px solid #3b82f6;border-radius:10px;padding:12px 16px;box-shadow:0 8px 24px rgba(0,0,0,0.5);font-size:12px;min-width:240px;">
        <div style="display:flex;align-items:center;justify-content:between;gap:8px;margin-bottom:8px;border-bottom:1px solid #1e293b;padding-bottom:6px;">
          <div style="display:flex;align-items:center;gap:6px;font-weight:700;color:#38bdf8;">
            <span>⚡</span>
            <span>Content Peeker (GOD SPEED)</span>
          </div>
          <span style="font-size:10px;background:#1e3a8a;color:#93c5fd;padding:2px 6px;border-radius:4px;font-weight:700;">v${VERSION}</span>
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
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${isPeeking ? '#eab308' : '#22c55e'};box-shadow:0 0 6px ${isPeeking ? '#eab308' : '#22c55e'};"></span>
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;">${statusText || 'Idle'}</span>
        </div>
        <div style="margin-top:8px;border-top:1px solid #1e293b;padding-top:6px;font-size:10px;color:#64748b;text-align:center;">
          🔒 Never accepts tasks (Read-only peeker)
        </div>
      </div>
    `;
  }

  // --- Main Peeker Loop (God Speed Engine) ---
  async function runPeeker() {
    if (!isPeekerTab()) {
      renderUI({});
      return;
    }

    const settings = getSettings();
    const peekedIds = loadPeekedIds();
    let isSweeping = false;
    let lastActionAt = Date.now();

    console.log(`[RTM Content Peeker] Initialized in Tab 3 (?peeker=1) — God Speed Edition v${VERSION}.`);
    closeOpenDrawerFast();

    async function sweepCards() {
      if (isSweeping) return;
      isSweeping = true;

      try {
        const cards = Array.from(document.querySelectorAll('div[data-slot="card"]'));

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
          const drawer = await waitForDrawer(DRAWER_TIMEOUT_MS);
          if (!drawer) {
            closeOpenDrawerFast();
            await sleep(40);
            continue;
          }

          // Extract content instantly
          const detectedId = findField('Task ID', drawer) || fiberId;
          const titleInput = drawer.querySelector('input[name="title"]');
          const title = titleInput ? unescapeUnicode((titleInput.value || '').trim()) : null;

          const proseEl = drawer.querySelector('div.prose');
          const contentText = proseEl ? (proseEl.innerText || proseEl.textContent || '').trim() : '';
          const contentHtml = proseEl ? proseEl.innerHTML : '';

          // IMMEDIATELY CLOSE THE DRAWER — ZERO WAIT
          closeOpenDrawerFast();

          if (detectedId) {
            card.setAttribute('data-rtm-peeked', detectedId);
            savePeekedId(peekedIds, detectedId);
            lastActionAt = Date.now();

            if (contentText || contentHtml) {
              console.log(`[RTM Content Peeker] ⚡ Extracted #${detectedId} (${contentText.length} chars). Streaming to StatBot...`);

              // Non-blocking fire-and-forget streaming
              request(settings, 'POST', '/task-content', {
                subTaskId: detectedId,
                title,
                content: contentText,
                contentHtml,
              }).catch((err) => console.warn('[RTM Content Peeker] Stream failed:', err));
            }
          }

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
