import { redditSessionService } from './reddit-session.service';
import { fetchRedditPost, RedditSessionExpiredError } from './reddit-check.service';
import {
  normalizeSurvivalUrl,
  parseCookieHeader,
} from '../utils/survival-proof';
import { logger } from '../utils/logger';

export { normalizeSurvivalUrl, parseCookieHeader };

export class SurvivalNoSessionError extends Error {
  constructor() {
    super('No Reddit session configured. Paste the spare-account cookie in dashboard Settings.');
    this.name = 'SurvivalNoSessionError';
  }
}

export class SurvivalSessionExpiredError extends Error {
  constructor() {
    super('Reddit rejected the stored session (expired or flagged). Repaste the spare-account cookie in dashboard Settings.');
    this.name = 'SurvivalSessionExpiredError';
  }
}

export class SurvivalBlockedError extends Error {
  constructor(detail = 'Reddit blocked the request (network security).') {
    super(detail);
    this.name = 'SurvivalBlockedError';
  }
}

export class SurvivalRateLimitedError extends Error {
  constructor() {
    super('Reddit rate-limited the capture (429).');
    this.name = 'SurvivalRateLimitedError';
  }
}

const SESSION_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const HOSTS = ['www.reddit.com', 'old.reddit.com'];
const NAV_TIMEOUT_MS = 45000;

const STEALTH_INIT_SCRIPT = `() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en'] });
  } catch (e) { /* best-effort */ }
}`;

function looksBlocked(title: string, url: string, htmlHead: string): boolean {
  const hay = `${title}\n${htmlHead}`.toLowerCase();
  return (
    hay.includes('blocked by network security') ||
    hay.includes('security checkpoint') ||
    hay.includes('just a moment') ||
    hay.includes('attention required') ||
    /reddit\.com\/login/.test(url)
  );
}

async function launchContext(cookie: string) {
  const { chromium } = await import('playwright-core');
  const candidates: { channel?: 'chrome'; executablePath?: string }[] = [];
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) candidates.push({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  candidates.push({ executablePath: '/usr/bin/chromium-browser' });
  candidates.push({ executablePath: '/usr/bin/chromium' });
  candidates.push({ channel: 'chrome' });
  candidates.push({});

  const errors: string[] = [];
  for (const c of candidates) {
    try {
      const browser = await chromium.launch({
        ...c,
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
      } as any);
      const context = await browser.newContext({
        viewport: { width: 1366, height: 900 },
        locale: 'en-GB',
        timezoneId: 'Asia/Kolkata',
        userAgent: SESSION_USER_AGENT,
      });
      await context.addInitScript({ content: STEALTH_INIT_SCRIPT } as any);
      const cookies = parseCookieHeader(cookie);
      if (cookies.length > 0) {
        await context.addCookies(cookies as any).catch(() => undefined);
      }
      return { browser, context };
    } catch (e) {
      errors.push(e instanceof Error ? e.message.split('\n')[0] : String(e));
    }
  }
  throw new SurvivalBlockedError(`No Chromium/Chrome usable for survival capture. ${errors.join(' | ')}`);
}

export interface SurvivalCapture {
  buffer: Buffer;
  verdict: 'ALIVE' | 'REMOVED' | 'DELETED';
}

/**
 * Captures a full-page Reddit screenshot with the vaulted spare-account
 * session. The screenshot is proof regardless of state; the ALIVE /
 * REMOVED / DELETED verdict comes from the same authed .json path the
 * format check uses, so the two never disagree.
 */
export async function captureSurvivalScreenshot(redditUrl: string): Promise<SurvivalCapture> {
  const normalized = normalizeSurvivalUrl(redditUrl);
  if (!normalized) throw new Error('Not a Reddit URL.');

  const cookie = await redditSessionService.loadCookie();
  if (!cookie) throw new SurvivalNoSessionError();

  let lastError = 'Unknown capture error.';
  let sawSessionRejection = false;

  for (const host of HOSTS) {
    const target = normalized.replace(/^https?:\/\/[^/]+/, `https://${host}`);
    let browser: any = null;
    try {
      const launched = await launchContext(cookie);
      browser = launched.browser;
      const page = await launched.context.newPage();
      const resp = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => null);
      await page.waitForTimeout(2500 + Math.random() * 1500);

      const status = resp?.status() ?? 0;
      const title = await page.title().catch(() => '');
      const finalUrl = page.url();
      const head = (await page.content().catch(() => '')).slice(0, 8000);

      if (status === 429) {
        lastError = 'Reddit rate-limited the capture (429).';
        throw new SurvivalRateLimitedError();
      }
      if (status === 401 || status === 403 || looksBlocked(title, finalUrl, head)) {
        // Distinguish a dead session from a datacenter IP wall: both are
        // unactionable by retry, but the DM must say which paste to fix.
        sawSessionRejection = true;
        lastError = 'Reddit blocked the capture (network security / session rejected).';
        throw new SurvivalBlockedError(lastError);
      }
      if (/\/login/.test(finalUrl)) {
        sawSessionRejection = true;
        lastError = 'Reddit redirected to login (session expired).';
        throw new SurvivalSessionExpiredError();
      }

      const buffer = await page.screenshot({ fullPage: true, type: 'png' });
      await browser.close().catch(() => undefined);
      browser = null;

      // Verdict via the authed .json path (same session, same hosts).
      const verdict = await resolveVerdict(redditUrl);
      return { buffer: Buffer.from(buffer), verdict };
    } catch (error) {
      try {
        await browser?.close()?.catch(() => undefined);
      } catch {
        // best-effort
      }
      if (
        error instanceof SurvivalNoSessionError ||
        error instanceof SurvivalSessionExpiredError ||
        error instanceof SurvivalBlockedError ||
        error instanceof SurvivalRateLimitedError
      ) {
        if (error instanceof SurvivalRateLimitedError) throw error;
        lastError = error.message;
        // Session/block verdicts are host-independent (same cookie) — but www
        // vs old render different walls, so try the other host once before
        // giving up. Only throw after both hosts agree.
        continue;
      }
      lastError = error instanceof Error ? error.message : String(error);
      logger.warn('Survival capture attempt failed', { host, error: lastError });
    }
  }

  if (sawSessionRejection) {
    // Both hosts rejected the cookie — the paste is dead, not the IP.
    throw new SurvivalSessionExpiredError();
  }
  if (/rate-limited|429/i.test(lastError)) throw new SurvivalRateLimitedError();
  if (/blocked|network security|checkpoint/i.test(lastError)) throw new SurvivalBlockedError(lastError);
  throw new Error(lastError);
}

async function resolveVerdict(redditUrl: string): Promise<'ALIVE' | 'REMOVED' | 'DELETED'> {
  try {
    const snap = await fetchRedditPost(redditUrl);
    if (!snap.deleted) return 'ALIVE';
    const blob = `${snap.title}\n${snap.selftext}\n${snap.author}`.toLowerCase();
    if (blob.includes('[removed]')) return 'REMOVED';
    return 'DELETED';
  } catch (error) {
    if (error instanceof RedditSessionExpiredError) throw new SurvivalSessionExpiredError();
    const msg = error instanceof Error ? error.message : String(error);
    // A fresh-post 404 at +11min is near-impossible; treat unresolvable
    // posts as deleted so the proof still records a state, not a mystery.
    if (/404|not found|deleted|removed|private|parse/i.test(msg)) return 'DELETED';
    throw new Error(msg);
  }
}
