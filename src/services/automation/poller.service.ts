import path from 'node:path';
import fs from 'node:fs';
import type { BrowserContext, Page } from 'playwright-core';
import { sessionService } from './session.service';
import { parseTasksHtml } from './parser';
import { AUTOMATION } from '../../config/constants';
import { logger } from '../../utils/logger';
import type { DetectedGoPartTimeTask } from '../../types';

const TASKS_URL = 'https://goparttime.net/tasks';
const PROFILE_DIR = path.join(process.cwd(), '.goparttime', 'browser-profile');

/** Headful (under Xvfb in Docker) looks like a real desktop to bot management. */
const HEADFUL = process.env.POLLER_HEADFUL === '1';

/**
 * Masks the strongest headless signals. We authenticate with the manager's
 * own session — this only stops the browser from volunteering "I'm scripted".
 * UA says Windows/Chrome while the container is Linux/ARM, so platform and
 * languages are aligned with the UA; webdriver flag is hidden.
 */
const STEALTH_INIT_SCRIPT = `() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en'] });
  } catch (e) { /* best-effort */ }
}`;

const SESSION_COOKIE = '__Secure-goparttime.session-token';
const CSRF_COOKIE = '__Host-goparttime.csrf-token';
const CALLBACK_COOKIE = '__Secure-goparttime.callback-url';

/** addCookies params (Playwright's returned Cookie type lacks `url`, so our own). */
export interface CookieParams {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
}

/**
 * Playwright cookie params for the GoPartTime vault session.
 * Prefix rules (RFC 6265bis, enforced by Chromium — violating them throws
 * "Invalid cookie fields"):
 * - `__Host-` cookies: Secure + Path=/ and NO Domain attribute.
 * - `__Secure-` cookies: Secure required (Domain allowed).
 */
export function buildCookieParams(s: {
  sessionToken: string;
  csrfToken: string;
  callbackUrl: string | null;
}): CookieParams[] {
  const out: CookieParams[] = [
    {
      name: SESSION_COOKIE,
      value: s.sessionToken,
      domain: '.goparttime.net',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
    {
      name: CSRF_COOKIE,
      value: s.csrfToken,
      url: 'https://goparttime.net/',
      secure: true,
      sameSite: 'Lax',
    },
  ];
  if (s.callbackUrl) {
    out.push({
      name: CALLBACK_COOKIE,
      value: s.callbackUrl,
      domain: '.goparttime.net',
      path: '/',
      secure: true,
      sameSite: 'Lax',
    });
  }
  return out;
}

let ctx: BrowserContext | null = null;
let page: Page | null = null;
let launching: Promise<void> | null = null;
let scanning = false;
let backoffUntil = 0;
let backoffLevel = 0;

function firstLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split('\n')[0];
}

/** Chromium profile-lock leftovers from a crashed/leaked browser. */
function clearSingletonLock(): void {
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try {
      fs.rmSync(path.join(PROFILE_DIR, f), { force: true });
    } catch {
      // best-effort
    }
  }
}

function isLockError(e: unknown): boolean {
  const msg = firstLine(e);
  return (
    msg.includes('Target page, context or browser has been closed') ||
    msg.includes('SingletonLock') ||
    msg.includes('ProcessSingleton')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Human pause 3-8s before accept (never instant-snipe). */
export function humanAcceptDelay(): Promise<void> {
  const span = AUTOMATION.ACCEPT_DELAY_MAX_MS - AUTOMATION.ACCEPT_DELAY_MIN_MS;
  return sleep(AUTOMATION.ACCEPT_DELAY_MIN_MS + Math.random() * span);
}

export function isThrottled(now: number = Date.now()): boolean {
  return now < backoffUntil;
}

export function recordBackoff(): void {
  const steps = AUTOMATION.BACKOFF_MS;
  const delay = steps[Math.min(backoffLevel, steps.length - 1)];
  backoffLevel++;
  backoffUntil = Date.now() + delay;
  logger.warn('GoPartTime poller backing off', { delayMs: delay, level: backoffLevel });
}

export function recordSuccess(): void {
  backoffLevel = 0;
  backoffUntil = 0;
}

async function ensureBrowser(): Promise<Page> {
  if (page && ctx) return page;
  if (launching) {
    await launching;
    if (page) return page;
  }
  launching = (async () => {
    const session = await sessionService.load();
    if (!session) throw new Error('GoPartTime session is not configured. Paste cookies via Automation → Session.');

    const { chromium } = await import('playwright-core');
    const baseOpts: {
      headless: boolean;
      viewport: { width: number; height: number };
      locale: string;
      timezoneId: string;
      userAgent: string;
      args: string[];
    } = {
      headless: !HEADFUL,
      viewport: { width: 1366, height: 768 },
      locale: 'en-GB',
      timezoneId: 'Asia/Kolkata',
      userAgent:
        session.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      args: HEADFUL
        ? ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1366,768']
        : ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    };
    // Resolution order: explicit env (Docker: PLAYWRIGHT_CHROMIUM_PATH) →
    // system Chrome (dev machines) → bundled Playwright chromium.
    const candidates: { channel?: 'chrome'; executablePath?: string }[] = [];
    if (process.env.PLAYWRIGHT_CHROMIUM_PATH) candidates.push({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
    candidates.push({ executablePath: '/usr/bin/chromium-browser' });
    candidates.push({ executablePath: '/usr/bin/chromium' });
    candidates.push({ channel: 'chrome' });
    candidates.push({});
    const describe = (c: { channel?: string; executablePath?: string }): string =>
      c.executablePath || (c.channel ? `channel:${c.channel}` : 'bundled');

    /** Launch + set up one candidate. Never leaks a half-open context. */
    const tryCandidate = async (c: { channel?: 'chrome'; executablePath?: string }): Promise<void> => {
      const launched = await chromium.launchPersistentContext(PROFILE_DIR, { ...baseOpts, ...c });
      try {
        await launched.addInitScript({ content: STEALTH_INIT_SCRIPT });
        // Oracle-safe: block heavy assets, keep RSC/HTML/JS.
        await launched.route('**/*.{png,jpg,jpeg,webp,gif,svg,mp4,webm,woff,woff2,ttf}', (route) => route.abort());
        if (session.sessionToken && session.csrfToken) {
          try {
            await launched.addCookies(buildCookieParams(session));
          } catch (error) {
            throw new Error(
              `Stored GoPartTime cookies were rejected by the browser (${firstLine(error)}). Repaste fresh raw values via Automation → Session.`,
            );
          }
        }
        ctx = launched;
        page = ctx.pages()[0] || (await ctx.newPage());
      } catch (error) {
        // Never leak a half-initialized context holding the profile lock.
        await launched.close().catch(() => undefined);
        if (ctx === launched) ctx = null;
        page = null;
        throw error;
      }
    };

    const errors: string[] = [];
    for (const c of candidates) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await tryCandidate(c);
          break;
        } catch (e) {
          // Stale profile lock from a previous crash/leak: clear once and retry.
          if (attempt === 0 && isLockError(e)) {
            clearSingletonLock();
            continue;
          }
          errors.push(`${describe(c)}: ${firstLine(e)}`);
          break;
        }
      }
      if (page && ctx) break;
    }
    if (!page || !ctx) {
      ctx = null;
      page = null;
      throw new Error(`No Chromium/Chrome usable for the poller. ${errors.join(' | ')}`);
    }
  })();
  try {
    await launching;
  } finally {
    launching = null;
  }
  if (!page) throw new Error('Poller browser failed to start.');
  return page;
}

/**
 * One human-like scan of /tasks. Throws on missing session, checkpoint,
 * or concurrent scan. Never parallelizes (single page).
 */
export async function scanTasks(): Promise<{ tasks: DetectedGoPartTimeTask[]; nextAction: string | null }> {
  if (scanning) throw new Error('Scan already in progress.');
  if (isThrottled()) throw new Error('Poller is in backoff after checkpoint/429.');
  scanning = true;
  try {
    const pg = await ensureBrowser();
    const resp = await pg.goto(TASKS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
    // Light human settle: let RSC flight chunks land, no fixed long sleep.
    await sleep(2500 + Math.random() * 2000);

    let title = await pg.title().catch(() => '');
    let html = await pg.content();
    const status = resp?.status() ?? 0;
    // Vercel's JS challenge auto-solves inside real Chromium and reloads —
    // give it up to ~25s to clear before treating it as a block.
    if (status === 429 || /security checkpoint/i.test(title) || /security checkpoint/i.test(html.slice(0, 5000))) {
      logger.warn('GoPartTime challenge/429 seen, waiting for auto-solve', { status, title });
      let cleared = false;
      for (let i = 0; i < 12 && !cleared; i++) {
        await sleep(2000);
        title = await pg.title().catch(() => title);
        if (!/security checkpoint/i.test(title) && pg.url().includes('/tasks')) {
          html = await pg.content();
          if (!/security checkpoint/i.test(html.slice(0, 5000))) cleared = true;
        }
      }
      if (!cleared) {
        const freshStatus = await pg.title().catch(() => title);
        logger.warn('GoPartTime challenge did not clear', { status, title: freshStatus, url: pg.url() });
        recordBackoff();
        throw new Error('Vercel checkpoint/429 — backing off, context kept alive.');
      }
      logger.info('GoPartTime challenge auto-solved');
    }
    const url = pg.url();
    if (/\/login|\/signin/.test(url)) {
      throw new Error('GoPartTime session expired (redirected to login). Repaste cookies via Automation → Session.');
    }

    recordSuccess();
    const tasks = parseTasksHtml(html);
    const nextAction = extractNextAction(html);
    // Self-refreshing vault: persist the browser's live cookies + Next-Action
    // so a single paste keeps working across GoPartTime rotations.
    // Best-effort — never fails the scan.
    try {
      const live = ctx ? await ctx.cookies('https://goparttime.net').catch(() => []) : [];
      const find = (name: string) => live.find((c) => c.name === name)?.value || null;
      await sessionService.refreshFromBrowser({
        sessionToken: find(SESSION_COOKIE),
        csrfToken: find(CSRF_COOKIE),
        nextAction,
      });
    } catch (error) {
      logger.warn('Session self-refresh failed (scan still valid)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    logger.info('GoPartTime scan complete', { tasks: tasks.length, url });
    return { tasks, nextAction };
  } finally {
    scanning = false;
  }
}

/** Accept one sub-task from inside the page context (same TLS/fingerprint as manual click). */
export async function acceptTask(subTaskId: string, nextAction: string): Promise<boolean> {
  await humanAcceptDelay();
  const pg = await ensureBrowser();
  const body = JSON.stringify([{ sub_task_id: Number(subTaskId) }]);
  const text = await pg.evaluate(
    async ({ action, payload }: { action: string; payload: string }) => {
      const res = await fetch('/tasks', {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'text/x-component',
          'Content-Type': 'text/plain;charset=UTF-8',
          'Next-Action': action,
        },
        body: payload,
      });
      return res.text();
    },
    { action: nextAction, payload: body },
  );
  const ok = /"success":\s*true/.test(String(text));
  logger.info('GoPartTime accept attempted', { subTaskId, ok });
  return ok;
}

/** Next-Action server-action id rotates on Vercel redeploys; prefer the live one. */
export function extractNextAction(html: string): string | null {
  const m = html.match(/\b[0-9a-f]{64}\b/);
  return m ? m[0] : null;
}

export async function closePoller(): Promise<void> {
  try {
    await ctx?.close();
  } catch {
    // best-effort
  }
  ctx = null;
  page = null;
}
