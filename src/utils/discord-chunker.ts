/**
 * Paragraph-aware Discord message chunker.
 *
 * Guarantees:
 *  - Every returned chunk is <= `hardMax` characters (2000 by default).
 *  - Content is split at paragraph boundaries first; only a paragraph that
 *    alone exceeds the safe target is split (sentence → word → char, in that
 *    order).
 *  - A blank line (\n\n) separates paragraphs inside every chunk.
 *  - Normal words are never unnecessarily broken across chunks.
 *  - Formatting syntax (**bold**, *italic*, ~~strike~~, `code`, [link](url))
 *    is not split when a safe alternative exists. When a pathological
 *    paragraph forces a character-level split inside formatting, the open
 *    formatting tokens are closed at the cut and re-opened on the next chunk
 *    so the rendered result stays correct.
 *  - Fenced code blocks (```) are never broken internally except at line
 *    boundaries, and only when the block itself exceeds the safe target.
 */

const PLACEHOLDER_PREFIX = '\u0000GPC';
const PLACEHOLDER_SUFFIX = '\u0000';

export interface ChunkOptions {
  target?: number;
  hardMax?: number;
}

interface FormatRange {
  start: number;
  end: number;
  token: string;
}

type Item = { type: 'para'; text: string } | { type: 'code'; raw: string };

const CODE_FENCE_RE = /```[\s\S]*?```/g;

// ─── Public API ──────────────────────────────────────────────

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const target = options.target ?? 1900;
  const hardMax = options.hardMax ?? 2000;

  if (target < 1 || hardMax < target) {
    throw new Error('Invalid chunker options: hardMax must be >= target >= 1');
  }

  const items = splitItems(text);
  const chunks: string[] = [];
  let current = '';

  for (const item of items) {
    const piece = item.type === 'code' ? item.raw : item.text;

    if (current.length === 0) {
      if (piece.length <= target) {
        current = piece;
      } else {
        chunks.push(...splitItem(item, target));
      }
      continue;
    }

    const candidate = current + '\n\n' + piece;
    if (candidate.length <= target) {
      current = candidate;
    } else {
      chunks.push(current);
      if (piece.length <= target) {
        current = piece;
      } else {
        chunks.push(...splitItem(item, target));
        current = '';
      }
    }
  }

  if (current.length > 0) chunks.push(current);

  return chunks;
}

// ─── Itemization ─────────────────────────────────────────────

/**
 * Splits the full text into paragraph/code items. Fenced code blocks are
 * protected (placeholder) so paragraph splitting never cuts through them.
 */
function splitItems(text: string): Item[] {
  const codeBlocks: string[] = [];
  const protectedText = text.replace(CODE_FENCE_RE, (match) => {
    codeBlocks.push(match);
    return `${PLACEHOLDER_PREFIX}${codeBlocks.length - 1}${PLACEHOLDER_SUFFIX}`;
  });

  const items: Item[] = [];

  for (const rawPara of protectedText.split(/\n{2,}/)) {
    const para = rawPara.trim();
    if (para.length === 0) continue;

    const placeholderMatch = para.match(new RegExp(`^${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}$`));
    if (placeholderMatch) {
      items.push({ type: 'code', raw: codeBlocks[Number(placeholderMatch[1])] ?? '' });
    } else {
      items.push({ type: 'para', text: para });
    }
  }

  return items;
}

function splitItem(item: Item, target: number): string[] {
  if (item.type === 'code') {
    return splitCodeBlock(item.raw, target);
  }
  return splitParagraph(item.text, target);
}

/**
 * Splits an oversized fenced code block at line boundaries, keeping the
 * opening fence with the first part and the closing fence with the last.
 */
function splitCodeBlock(raw: string, target: number): string[] {
  const inner = raw.replace(/^```\s*\n?/, '').replace(/\n?```$/, '');
  const lines = inner.split('\n');
  const parts: string[] = [];
  let current: string[] = [];
  // Running length of `current.join('\n')`, so the fit test is O(1) per line
  // instead of re-joining the whole buffer (which was O(n^2) per block).
  let currentLen = 0;

  const flush = () => {
    if (current.length === 0) return;
    parts.push(current.join('\n'));
    current = [];
    currentLen = 0;
  };

  for (const line of lines) {
    const candidate = currentLen + (current.length > 0 ? 1 : 0) + line.length;
    if (candidate > target) {
      flush();
      current.push(line);
      currentLen = line.length;
    } else {
      current.push(line);
      currentLen = candidate;
    }
  }
  flush();

  if (parts.length <= 1) {
    // A single line longer than the target: split that line at character level
    return splitCharacterRanges(inner, target).map((part, index, all) => {
      if (index === 0) return '```\n' + part;
      if (index === all.length - 1) return part + '\n```';
      return part;
    });
  }

  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i === 0) result.push('```\n' + parts[i]);
    else result.push(parts[i] + '\n```');
  }
  return result;
}

function splitCharacterRanges(text: string, target: number): string[] {
  const ranges = findFormatRanges(text);
  const out: string[] = [];
  let rest = text;
  while (rest.length > target) {
    const { left, right } = splitAtCharacter(rest, Math.min(target, rest.length), ranges);
    out.push(left);
    if (right.length === 0) break;
    rest = right;
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

// ─── Paragraph splitting ─────────────────────────────────────

function splitParagraph(para: string, target: number): string[] {
  if (para.length <= target) return [para];

  const ranges = findFormatRanges(para);
  const isSafe = makeSafetyCheck(ranges);

  // 1. Sentence level: split the paragraph into sentence fragments at safe
  //    sentence boundaries, then greedily pack fragments into groups <= target.
  const sentenceCuts = findSentenceBoundaries(para).filter(
    (pos) => pos < para.length && isSafe(pos),
  );

  const fragments: Array<[number, number]> = [];
  let fragStart = 0;
  for (const cut of sentenceCuts) {
    fragments.push([fragStart, cut]);
    fragStart = cut;
  }
  fragments.push([fragStart, para.length]);

  const groups: Array<[number, number]> = [];
  let groupStart = 0;
  let groupLen = 0;
  for (const [fStart, fEnd] of fragments) {
    const fragLen = fEnd - fStart;
    if (groupLen === 0) {
      groupStart = fStart;
      groupLen = fragLen;
      continue;
    }
    if (groupLen + 1 + fragLen <= target) {
      groupLen += 1 + fragLen;
      continue;
    }
    groups.push([groupStart, fStart]);
    groupStart = fStart;
    groupLen = fragLen;
  }
  if (groupLen > 0) groups.push([groupStart, para.length]);

  const result: string[] = [];
  for (const [gStart, gEnd] of groups) {
    if (gEnd - gStart <= target) {
      const piece = para.slice(gStart, gEnd).trim();
      if (piece.length > 0) result.push(piece);
      continue;
    }
    // 2. A single sentence (fragment) still exceeds the target: word level.
    result.push(...splitLongSentence(para, gStart, gEnd, target, isSafe));
  }

  return result;
}

function findSentenceBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  const re = /[.!?]+(?=[ \n])/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    boundaries.push(match.index + match[0].length);
  }
  return boundaries;
}

/**
 * Splits a single oversized sentence at word boundaries. Words are packed
 * greedily; only cuts at safe whitespace (outside formatting ranges) are used.
 * A single word that still exceeds the target falls back to character splits.
 */
function splitLongSentence(
  para: string,
  s: number,
  e: number,
  target: number,
  isSafe: (pos: number) => boolean,
): string[] {
  const parts: string[] = [];
  let current = '';
  let i = s;

  while (i < e) {
    while (i < e && (para[i] === ' ' || para[i] === '\n' || para[i] === '\t')) i++;
    if (i >= e) break;

    let j = i;
    while (j < e) {
      const ch = para[j];
      if ((ch === ' ' || ch === '\n' || ch === '\t') && isSafe(j)) break;
      j++;
    }

    const word = para.slice(i, j);

    if (word.length > target) {
      if (current.length > 0) parts.push(current);
      parts.push(...splitWordWindow(word, target));
      current = '';
    } else if (current.length === 0) {
      current = word;
    } else {
      const candidate = current + ' ' + word;
      if (candidate.length <= target) {
        current = candidate;
      } else {
        parts.push(current);
        current = word;
      }
    }

    if (j >= e) break;
    i = j;
  }

  if (current.length > 0) parts.push(current);
  return parts;
}

/**
 * Character-level split of a single unbroken token (word) that exceeds the
 * target. Operates recursively on the current window string: the close/reopen
 * tokens injected by splitAtCharacter stay part of the window, so every
 * continuation chunk re-opens the formatting it splits across.
 */
function splitWordWindow(text: string, target: number): string[] {
  if (text.length <= target) return [text];

  const ranges = findFormatRanges(text);
  const { left, right } = splitAtCharacter(text, Math.min(target, text.length), ranges);
  if (left.length === 0) return [text];
  if (right.length === 0) return [left];
  return [left, ...splitWordWindow(right, target)];
}

// ─── Formatting safety ───────────────────────────────────────

const FORMAT_TOKENS = ['```', '**', '__', '~~', '*', '`'] as const;

function findFormatRanges(text: string): FormatRange[] {
  const ranges: FormatRange[] = [];
  const stack: Array<{ token: string; start: number }> = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    // Links: [text](url) — treat as one unbreakable token
    if (text[i] === '[' && stack.length === 0) {
      const closeIdx = text.indexOf('](', i + 1);
      if (closeIdx !== -1) {
        const closeParen = text.indexOf(')', closeIdx + 2);
        if (closeParen !== -1) {
          ranges.push({ start: i, end: closeParen + 1, token: '[link]' });
          i = closeParen + 1;
          continue;
        }
      }
    }

    const top = stack[stack.length - 1];
    if (top && text.startsWith(top.token, i)) {
      stack.pop();
      ranges.push({ start: top.start, end: i + top.token.length, token: top.token });
      i += top.token.length;
      continue;
    }

    let opened = false;
    for (const token of FORMAT_TOKENS) {
      if (text.startsWith(token, i)) {
        stack.push({ token, start: i });
        i += token.length;
        opened = true;
        break;
      }
    }
    if (!opened) i++;
  }

  return ranges;
}

function makeSafetyCheck(ranges: FormatRange[]): (pos: number) => boolean {
  return (pos: number) => !ranges.some((r) => pos > r.start && pos < r.end);
}

/**
 * Character-level fallback split. Prefers cutting immediately before a
 * formatting range (never breaking the formatting). Only when the whole
 * window is a single formatting range does it cut inside, closing the open
 * tokens at the cut and re-opening them on the continuation.
 *
 * Returns the parts plus `consumed`: the number of ORIGINAL characters taken
 * by the left part (excluding injected close tokens), used for recursion.
 */
function splitAtCharacter(text: string, cut: number, ranges: FormatRange[]): { left: string; right: string; consumed: number } {
  if (cut <= 0) return { left: '', right: text, consumed: 0 };
  if (cut >= text.length) return { left: text, right: '', consumed: text.length };

  const containing = ranges.filter((r) => cut > r.start && cut < r.end);

  if (containing.length === 0) {
    return { left: text.slice(0, cut), right: text.slice(cut), consumed: cut };
  }

  const starts = containing.filter((r) => r.start > 0 && r.token !== '[link]');
  if (starts.length > 0) {
    const best = Math.max(...starts.map((r) => r.start));
    const left = text.slice(0, best);
    const right = text.slice(best);
    if (left.length > 0 && right.length > 0) {
      return { left, right, consumed: best };
    }
  }

  // Absolute last resort: cut inside the formatting and close/re-open tokens
  const closeTokens = containing
    .slice()
    .reverse()
    .map((r) => (r.token === '[link]' ? ')' : r.token))
    .join('');
  const openTokens = containing.map((r) => (r.token === '[link]' ? '[' : r.token)).join('');

  return {
    left: text.slice(0, cut) + closeTokens,
    right: openTokens + text.slice(cut),
    consumed: cut,
  };
}
