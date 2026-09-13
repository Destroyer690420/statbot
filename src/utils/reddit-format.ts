/**
 * Pure Reddit formatting comparison (no I/O — safe for unit tests).
 *
 * Expected text is the bot-delivered `formattedContent` (paragraphs joined
 * with exactly `\n\n` by `htmlToDiscord`). Actual text is the live Reddit
 * `selftext` (raw_json). Comparison is normalized (case / whitespace /
 * markdown insensitive) but paragraph STRUCTURE is strict: a collapsed
 * post (4 paras → 1 block) is always a mismatch.
 */

export type FormatCheckStatus =
  | 'MATCH'
  | 'PARA_MISMATCH'
  | 'TITLE_MISMATCH'
  | 'TEXT_MISMATCH'
  | 'FETCH_ERROR'
  | 'DELETED'
  | 'SKIPPED'
  | 'NO_SESSION'
  | 'SESSION_EXPIRED';

export interface FormatCompareInput {
  expectedTitle: string | null;
  expectedContent: string | null;
  actualTitle: string | null;
  actualContent: string | null;
}

export interface FormatCompareResult {
  status: FormatCheckStatus;
  expectedParas: number;
  actualParas: number;
  titleMatch: boolean;
  /** Per expected-para match flags (order-sensitive). */
  paraMatches: boolean[];
  error?: string;
}

export function splitParagraphs(s: string): string[] {
  return s
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Normalizes a single paragraph for fuzzy equality: unicode NFC, smart
 * quotes/dashes folded to ASCII, markdown tokens stripped, links reduced to
 * their text, list markers dropped, all whitespace collapsed, lowercased.
 */
export function normalizeInline(s: string): string {
  let t = s.normalize('NFC');
  t = t
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/\u00a0/g, ' ');
  // [text](url) -> text
  t = t.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1');
  // strip markdown tokens
  t = t.replace(/(\*\*|__|~~|`)/g, '');
  t = t.replace(/(^|\s)[*_](?=\S)/g, '$1').replace(/(?<=\S)[*_](?=\s|$)/g, '');
  // blockquote markers + bullets/numbered prefixes per line
  t = t
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(>\s*)+/, '')
        .replace(/^\s*(•|[-*+]|\d+[.)])\s+/, '')
        .trim(),
    )
    .join('\n');
  return t.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function compareRedditFormat(input: FormatCompareInput): FormatCompareResult {
  const expectedParas = splitParagraphs(input.expectedContent ?? '');
  const actualParas = splitParagraphs(input.actualContent ?? '');

  // Image-only posts: both sides empty => match.
  if (expectedParas.length === 0 && actualParas.length === 0) {
    return { status: 'MATCH', expectedParas: 0, actualParas: 0, titleMatch: true, paraMatches: [] };
  }

  const titleMatch =
    !input.expectedTitle || input.expectedTitle.trim().length === 0
      ? true
      : normalizeInline(input.expectedTitle) === normalizeInline(input.actualTitle ?? '');

  if (!titleMatch) {
    return {
      status: 'TITLE_MISMATCH',
      expectedParas: expectedParas.length,
      actualParas: actualParas.length,
      titleMatch,
      paraMatches: expectedParas.map(() => false),
    };
  }

  if (expectedParas.length !== actualParas.length) {
    return {
      status: 'PARA_MISMATCH',
      expectedParas: expectedParas.length,
      actualParas: actualParas.length,
      titleMatch,
      paraMatches: expectedParas.map(() => false),
    };
  }

  const paraMatches = expectedParas.map(
    (p, i) => normalizeInline(p) === normalizeInline(actualParas[i] ?? ''),
  );
  if (paraMatches.every(Boolean)) {
    return {
      status: 'MATCH',
      expectedParas: expectedParas.length,
      actualParas: actualParas.length,
      titleMatch,
      paraMatches,
    };
  }
  return {
    status: 'TEXT_MISMATCH',
    expectedParas: expectedParas.length,
    actualParas: actualParas.length,
    titleMatch,
    paraMatches,
  };
}
