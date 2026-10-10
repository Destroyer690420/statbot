/**
 * Two-tier automatic content screen for new subreddits (language / sex / vape).
 *
 * Pure module — no env, no DB, no DOM. Safe for unit tests (see TESTING.md §1:
 * nothing here imports `src/config/env.ts`).
 *
 * Tier-0 (title-only, flag-only): `tier0Screen` marks unseen-subreddit
 * candidates for extra scrutiny. It NEVER affects eligibility — the caller
 * keeps `eligible` exactly as the blocked-list check decided.
 *
 * Tier-1 (full-content, authoritative): the browser companion runs
 * `screenFullContent` on title + drawer text at accept time and aborts +
 * auto-blocks on a hit (gated by CONTENT_SCREEN.DRY_RUN). The companion
 * carries a manually synced JS mirror of this module (see the
 * `content-screen` block in scripts/goparttime-auto.user.js).
 */
import {
  CONTENT_SCREEN,
  BLOCK_KEYWORDS_SEXUAL_HIGH_CONFIDENCE,
  BLOCK_KEYWORDS_SEXUAL_AMBIGUOUS,
  BLOCK_KEYWORDS_VAPE_HIGH_CONFIDENCE,
  BLOCK_KEYWORDS_VAPE_AMBIGUOUS,
} from '../config/constants';
import { normalizeSubreddit } from '../services/automation/subreddit';

export type ContentScreenSignal = 'sex' | 'vape' | 'non-en';

export interface ContentScreenHit {
  signal: ContentScreenSignal;
  /** The list term that matched (keyword signals only; null for non-en). */
  matched: string | null;
  /** Short explanation for logs / DMs (never the full text). */
  detail: string;
}

export interface ScreenLists {
  sexualHigh: readonly string[];
  sexualAmbiguous: readonly string[];
  vapeHigh: readonly string[];
  vapeAmbiguous: readonly string[];
}

function defaultLists(): ScreenLists {
  return {
    sexualHigh: BLOCK_KEYWORDS_SEXUAL_HIGH_CONFIDENCE,
    sexualAmbiguous: BLOCK_KEYWORDS_SEXUAL_AMBIGUOUS,
    vapeHigh: BLOCK_KEYWORDS_VAPE_HIGH_CONFIDENCE,
    vapeAmbiguous: BLOCK_KEYWORDS_VAPE_AMBIGUOUS,
  };
}

/** True for multi-word entries ("vape pod") — matched as exact phrases. */
function isPhrase(term: string): boolean {
  return /\s/.test((term || '').trim());
}

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-boundary, case-insensitive keyword match. Returns the matched term
 * (in list spelling) or null. Terms are matched literally — no stemming, so
 * "vapes" does not match a listed "vape"; list variants explicitly.
 * Multi-word terms match as the literal phrase ("vape pod" needs both words
 * in order — "pod" alone never matches it). Longest listed term wins, so the
 * result never depends on list order ("vape pen" beats "vape").
 */
export function matchKeyword(text: string, keywords: readonly string[]): string | null {
  if (!text || keywords.length === 0) return null;
  const terms = keywords
    .map((raw) => (raw || '').trim())
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const term of terms) {
    if (new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(text)) return term;
  }
  return null;
}

/**
 * Lightweight non-English signal — cheap and approximate, not language ID.
 * Fires when either sub-check fires (both need minimum text amounts, so
 * short titles only ever trip the non-Latin ratio, never the word check):
 *  - non-Latin ratio: fewer than NON_LATIN_MAX_LATIN_FRACTION of the text's
 *    letters are Latin (needs NON_LATIN_MIN_LETTERS letters).
 *  - common-word fraction: fewer than COMMON_WORD_MIN_FRACTION of the text's
 *    words are in the common-English list (needs COMMON_WORD_MIN_WORDS words).
 */
export function looksNonEnglish(text: string): boolean {
  if (!text || !text.trim()) return false;
  const letters = text.match(/\p{L}/gu) || [];
  if (letters.length >= CONTENT_SCREEN.NON_LATIN_MIN_LETTERS) {
    const latin = text.match(/[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/g) || [];
    if (latin.length / letters.length < CONTENT_SCREEN.NON_LATIN_MAX_LATIN_FRACTION) return true;
  }
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  if (words.length >= CONTENT_SCREEN.COMMON_WORD_MIN_WORDS) {
    const common = new Set(CONTENT_SCREEN.COMMON_ENGLISH_WORDS);
    const hits = words.filter((w) => common.has(w)).length;
    if (hits / words.length < CONTENT_SCREEN.COMMON_WORD_MIN_FRACTION) return true;
  }
  return false;
}

/**
 * Core screen over one text blob. Order is fixed and deterministic:
 *  1. HIGH_CONFIDENCE terms (sex, then vape) — standalone triggers.
 *     Co-occurring ambiguous singles are folded into the detail as
 *     tuning signal ("also: pod, mod") but never affect the verdict.
 *  2. AMBIGUOUS multi-word phrases as exact-phrase triggers ("mech mod",
 *     "adult content"). Ambiguous SINGLE words ("mod", "sexy", "coil")
 *     never trigger here.
 *  3. The lightweight non-English signal.
 */
export function screenText(text: string, lists: ScreenLists = defaultLists()): ContentScreenHit | null {
  const clean = (text || '').trim();
  if (!clean) return null;
  // Ambiguous singles from EITHER list only ever enrich the detail of a hit
  // fired by a high-confidence term — never trigger on their own.
  const secondary = () =>
    [...lists.sexualAmbiguous, ...lists.vapeAmbiguous]
      .filter((t) => !isPhrase(t))
      .filter((t) => matchKeyword(clean, [t]) !== null);
  const withAlso = (base: string): string => {
    const also = secondary();
    return base + (also.length > 0 ? ` (also: ${also.join(', ')})` : '');
  };
  const sexHigh = matchKeyword(clean, lists.sexualHigh);
  if (sexHigh) {
    return { signal: 'sex', matched: sexHigh, detail: withAlso(`keyword "${sexHigh}"`) };
  }
  const vapeHigh = matchKeyword(clean, lists.vapeHigh);
  if (vapeHigh) {
    return { signal: 'vape', matched: vapeHigh, detail: withAlso(`keyword "${vapeHigh}"`) };
  }
  const sexPhrase = matchKeyword(clean, lists.sexualAmbiguous.filter(isPhrase));
  if (sexPhrase) return { signal: 'sex', matched: sexPhrase, detail: `ambiguous phrase "${sexPhrase}"` };
  const vapePhrase = matchKeyword(clean, lists.vapeAmbiguous.filter(isPhrase));
  if (vapePhrase) return { signal: 'vape', matched: vapePhrase, detail: `ambiguous phrase "${vapePhrase}"` };
  if (looksNonEnglish(clean)) return { signal: 'non-en', matched: null, detail: 'non-English signal' };
  return null;
}

/** Title-only screen. Null/empty titles never hit. */
export function screenTitle(title: string | null | undefined, lists: ScreenLists = defaultLists()): ContentScreenHit | null {
  const text = (title || '').trim();
  if (!text) return null;
  const hit = screenText(text, lists);
  if (!hit) return null;
  return { ...hit, detail: `${hit.detail} in title` };
}

/** Full-content screen (title + extracted drawer text). Keywords checked first. */
export function screenFullContent(
  title: string | null | undefined,
  contentText: string | null | undefined,
  lists: ScreenLists = defaultLists(),
): ContentScreenHit | null {
  const text = `${(title || '').trim()}\n${(contentText || '').trim()}`.trim();
  if (!text) return null;
  const hit = screenText(text, lists);
  if (!hit) return null;
  return { ...hit, detail: `${hit.detail} in title/content` };
}

/** `auto-content:<signal>` — reads differently from a manual block in the admin list. */
export function autoBlockReason(signal: ContentScreenSignal): string {
  return `${CONTENT_SCREEN.AUTO_BLOCK_REASON_PREFIX}:${signal}`;
}

/**
 * Builds the normalized seen set from raw stored values (mirrors the digest's
 * normalizeSet: exact normalized comparison, so `r/Cats` seen covers `cats`).
 */
export function buildSeenSet(raw: readonly (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const v of raw) {
    const n = normalizeSubreddit(v);
    if (n) out.add(n);
  }
  return out;
}

/**
 * Tier-0 gate shared by both validators: for a subreddit NOT in the blocked
 * set (callers check that first) AND NOT in the seen set, run the fast
 * title-only screen. Returns the hit, or null when Tier-0 has nothing to say.
 * A null/undefined seen set means "Tier-0 inactive" (old behavior preserved).
 */
export function tier0Screen(
  task: { subreddit: string | null | undefined; title: string | null | undefined },
  seenSubs: ReadonlySet<string> | null | undefined,
  lists: ScreenLists = defaultLists(),
): ContentScreenHit | null {
  if (!seenSubs) return null;
  const normalized = normalizeSubreddit(task.subreddit);
  if (!normalized || seenSubs.has(normalized)) return null;
  return screenTitle(task.title, lists);
}
