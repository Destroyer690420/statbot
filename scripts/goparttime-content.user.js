// ==UserScript==
// @name         GoPartTime Task Content Peeker
// @namespace    https://statbot.duckdns.org/
// @version      1.0.0
// @updateURL    https://statbot.duckdns.org/goparttime-content.user.js
// @downloadURL  https://statbot.duckdns.org/goparttime-content.user.js
// @description  Dedicated Tab 3 executor on /tasks?peeker=1 to extract full post body content into StatBot without claiming or accepting. Never clicks Confirm.
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
 * GoPartTime Task Content Peeker (Tab 3 Dedicated Script)
 *
 * Runs exclusively in a dedicated browser tab opened at:
 *   https://goparttime.net/tasks?peeker=1
 *
 * PURPOSE:
 * GoPartTime's Next.js Flight listing only transmits subreddit, title, and metadata.
 * Full post body content (div.prose) is only loaded into the DOM when a card's
 * preview drawer is opened by clicking "Accept task".
 *
 * SAFETY GUARANTEE:
 * Opening the drawer DOES NOT claim or accept the task. Claiming strictly requires
 * clicking "Confirm acceptance" inside the drawer.
 * This peeker script NEVER clicks "Confirm acceptance". It strictly:
 *   1. Clicks card's "Accept task" button to open the preview drawer.
 *   2. Extracts title and div.prose text + HTML.
 *   3. Immediately closes the drawer (Cancel button / Escape key).
 *   4. Streams the content to StatBot backend (POST /api/v1/automation/task-content).
 *
 * ZERO INTERFERENCE WITH TAB 1:
 * - Tab 1 (goparttime-auto.user.js) exits immediately if ?peeker=1 is in the URL.
 * - Tab 3 (this script) only extracts content if ?peeker=1 is in the URL.
 *   In normal tabs without ?peeker=1, it stays completely dormant and displays
 *   a small "Open Peeker Tab" button.
 */

(function () {
  'use strict';

  const VERSION = '1.0.0';
  const DEFAULTS = {
    apiUrl: 'https://statbot.duckdns.org/api/v1/automation',
    apiKey: '',
  };

  const LOOP_MS = 2500;
  const RELOAD_IDLE_MS = 45 * 1000;
  const PEEK_TIMEOUT_MS = 3000;

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

  // --- Network Request Wrapper ---
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
          timeout: 15000,
          onload: (res) => {
            try {
              const data = JSON.parse(res.responseText);
              resolve(data);
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

  // --- DOM Helpers ---
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

  /**
   * Closes any open preview drawer immediately.
   * NEVER confirms or accepts.
   */
  function closeOpenDrawer() {
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

  function findCardAcceptButton(card) {
    if (!card) return null;
    const btns = Array.from(card.querySelectorAll('button'));
    return btns.find((b) => (b.textContent || '').trim().toLowerCase() === 'accept task') || null;
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
      // Standby button on normal tabs
      if (!statusBox) {
        statusBox = document.createElement('div');
        statusBox.id = 'rtm-peeker-standby';
        statusBox.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2147483647;cursor:pointer;';
        statusBox.innerHTML = `
          <button style="display:flex;align-items:center;gap:8px;background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:600;font-family:sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);cursor:pointer;">
            <span>👁️</span>
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

    // Active status box in dedicated Peeker Tab
    if (!statusBox) {
      statusBox = document.createElement('div');
      statusBox.id = 'rtm-peeker-active';
      statusBox.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
      document.body.appendChild(statusBox);
    }

    const { countPeeked, countAvailable, statusText, isPeeking } = state;
    statusBox.innerHTML = `
      <div style="background:#0f172a;color:#f8fafc;border:1px solid #3b82f6;border-radius:10px;padding:12px 16px;box-shadow:0 8px 24px rgba(0,0,0,0.4);font-size:12px;min-width:240px;">
        <div style="display:flex;align-items:center;justify-content:between;gap:8px;margin-bottom:8px;border-bottom:1px solid #1e293b;padding-bottom:6px;">
          <div style="display:flex;align-items:center;gap:6px;font-weight:700;color:#60a5fa;">
            <span>👁️</span>
            <span>Content Peeker v${VERSION}</span>
          </div>
          <span style="font-size:10px;background:#1e3a8a;color:#93c5fd;padding:2px 6px;border-radius:4px;font-weight:600;">TAB 3</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;font-size:11px;">
          <div style="background:#1e293b;padding:4px 8px;border-radius:6px;">
            <div style="color:#94a3b8;font-size:10px;">Enriched</div>
            <div style="font-weight:700;color:#34d399;font-size:13px;">${countPeeked}</div>
          </div>
          <div style="background:#1e293b;padding:4px 8px;border-radius:6px;">
            <div style="color:#94a3b8;font-size:10px;">Cards Found</div>
            <div style="font-weight:700;color:#38bdf8;font-size:13px;">${countAvailable}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;color:#cbd5e1;font-size:11px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${isPeeking ? '#eab308' : '#22c55e'};"></span>
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;">${statusText || 'Idle'}</span>
        </div>
        <div style="margin-top:8px;border-top:1px solid #1e293b;padding-top:6px;font-size:10px;color:#64748b;text-align:center;">
          🔒 Never accepts tasks (Read-only peeker)
        </div>
      </div>
    `;
  }

  // --- Main Peeker Loop ---
  async function runPeeker() {
    if (!isPeekerTab()) {
      renderUI({});
      return;
    }

    const settings = getSettings();
    const peekedIds = loadPeekedIds();
    let isBusy = false;
    let lastActionAt = Date.now();

    console.log('[RTM Content Peeker] Initialized in dedicated Tab 3 (?peeker=1).');

    // Make sure any stale drawer from page restore is closed
    closeOpenDrawer();

    setInterval(async () => {
      if (isBusy) return;

      const cards = Array.from(document.querySelectorAll('div[data-slot="card"]'));
      renderUI({
        countPeeked: peekedIds.size,
        countAvailable: cards.length,
        statusText: cards.length === 0 ? 'No cards on page' : 'Scanning cards...',
        isPeeking: false,
      });

      if (cards.length === 0) {
        // If idle on empty page for too long, soft reload
        if (Date.now() - lastActionAt > RELOAD_IDLE_MS) {
          console.log('[RTM Content Peeker] Idle timeout with 0 cards. Refreshing page...');
          lastActionAt = Date.now();
          window.location.reload();
        }
        return;
      }

      // Find first card that hasn't been peeked yet
      let targetCard = null;
      let targetSubTaskId = null;

      for (const card of cards) {
        const btn = findCardAcceptButton(card);
        if (!btn || btn.disabled) continue;

        // Try extracting subTaskId from React fiber
        let cardId = null;
        for (const k of Object.keys(card)) {
          if (k.startsWith('__reactFiber$')) {
            const fiber = card[k];
            if (fiber && fiber.key) {
              const km = String(fiber.key).match(/\d+/);
              if (km) cardId = km[0];
            }
          }
        }

        if (cardId && peekedIds.has(String(cardId))) {
          continue; // already peeked
        }

        targetCard = card;
        targetSubTaskId = cardId;
        break;
      }

      // If all visible cards are already peeked
      if (!targetCard) {
        renderUI({
          countPeeked: peekedIds.size,
          countAvailable: cards.length,
          statusText: 'All cards enriched. Waiting...',
          isPeeking: false,
        });

        // Periodic refresh to discover newly dropped tasks (if idle for > 45s or :10 minute)
        const d = new Date();
        const isTenMinute = d.getMinutes() === 10 && d.getSeconds() < 25;
        if (isTenMinute || Date.now() - lastActionAt > RELOAD_IDLE_MS) {
          console.log('[RTM Content Peeker] All cards enriched. Refreshing page for new drops...');
          lastActionAt = Date.now();
          window.location.reload();
        }
        return;
      }

      // Open drawer, extract, and close IMMEDIATELY
      isBusy = true;
      try {
        const acceptBtn = findCardAcceptButton(targetCard);
        if (!acceptBtn) {
          isBusy = false;
          return;
        }

        renderUI({
          countPeeked: peekedIds.size,
          countAvailable: cards.length,
          statusText: targetSubTaskId ? `Peeking #${targetSubTaskId}...` : 'Peeking card...',
          isPeeking: true,
        });

        targetCard.scrollIntoView({ block: 'center' });
        await sleep(100);
        acceptBtn.click();

        // Wait for drawer dialog to open
        let drawer = null;
        const startWait = Date.now();
        while (Date.now() - startWait < PEEK_TIMEOUT_MS) {
          await sleep(100);
          drawer = findOpenDrawer();
          if (drawer && isDrawerOpen()) {
            // Also ensure div.prose or title is present
            if (drawer.querySelector('div.prose') || drawer.querySelector('input[name="title"]')) {
              break;
            }
          }
        }

        if (!drawer) {
          console.warn('[RTM Content Peeker] Drawer did not open in time.');
          closeOpenDrawer();
          isBusy = false;
          return;
        }

        // Extract details
        const detectedId = findField('Task ID', drawer) || targetSubTaskId;
        const titleInput = drawer.querySelector('input[name="title"]');
        const title = titleInput ? unescapeUnicode((titleInput.value || '').trim()) : null;

        const proseEl = drawer.querySelector('div.prose');
        const contentText = proseEl ? (proseEl.innerText || proseEl.textContent || '').trim() : '';
        const contentHtml = proseEl ? proseEl.innerHTML : '';

        // IMMEDIATELY CLOSE THE DRAWER — NEVER ACCEPT
        closeOpenDrawer();
        await sleep(200);

        if (detectedId && (contentText || contentHtml)) {
          console.log(`[RTM Content Peeker] Extracted content for #${detectedId} (${contentText.length} chars). Sending to StatBot...`);

          // Send to backend
          await request(settings, 'POST', '/task-content', {
            subTaskId: detectedId,
            title,
            content: contentText,
            contentHtml,
          }).catch((err) => console.warn('[RTM Content Peeker] Failed to POST /task-content:', err));

          savePeekedId(peekedIds, detectedId);
          lastActionAt = Date.now();
        } else if (detectedId) {
          // If no prose content (e.g. empty post), record as peeked so we don't loop endlessly
          savePeekedId(peekedIds, detectedId);
        }
      } catch (err) {
        console.error('[RTM Content Peeker] Error during peek:', err);
        closeOpenDrawer();
      } finally {
        isBusy = false;
        closeOpenDrawer();
      }
    }, LOOP_MS);
  }

  // Run on document load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runPeeker);
  } else {
    runPeeker();
  }
})();
