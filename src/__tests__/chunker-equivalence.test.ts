/**
 * Equivalence guard for the discord-chunker code-block splitter.
 *
 * The fit test was changed from re-joining the accumulated buffer on every
 * line (O(n^2)) to tracking a running length. These tests assert the emitted
 * chunk list is unchanged and lossless.
 */
import { chunkText } from '../utils/discord-chunker';

const TARGET = 1900;
const HARD_MAX = 2000;

const stripFences = (parts: string[]) =>
  parts.map((p) => p.replace(/^```\n/, '').replace(/\n```$/, '')).join('\n');

describe('discord-chunker code block splitting (running-length fit test)', () => {
  it('emits a single chunk when the block fits', () => {
    const body = 'const a = 1;\nconst b = 2;';
    const out = chunkText('```\n' + body + '\n```', { target: TARGET, hardMax: HARD_MAX });
    expect(out).toEqual(['```\n' + body + '\n```']);
  });

  it('splits many short lines across multiple fenced chunks and is lossless', () => {
    const lines: string[] = [];
    for (let i = 0; i < 400; i++) lines.push(`line ${i} ${'x'.repeat(20)}`);
    const raw = '```\n' + lines.join('\n') + '\n```';

    const out = chunkText(raw, { target: TARGET, hardMax: HARD_MAX });
    expect(out.length).toBeGreaterThan(1);

    for (const part of out) {
      expect(part.length).toBeLessThanOrEqual(HARD_MAX);
    }
    expect(stripFences(out)).toBe(lines.join('\n'));
  });

  it('handles an empty block', () => {
    expect(chunkText('```\n```', { target: TARGET, hardMax: HARD_MAX })).toEqual(['```\n```']);
  });

  it('handles blank lines without inflating the running length', () => {
    // Blank lines in the middle (a leading blank is consumed by the fence
    // strip, which is pre-existing behaviour unrelated to the fit test).
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) lines.push(`content ${i}`, '');
    const raw = '```\n' + lines.join('\n') + '\n```';
    const out = chunkText(raw, { target: TARGET, hardMax: HARD_MAX });
    expect(out.length).toBeGreaterThan(1);
    for (const part of out) expect(part.length).toBeLessThanOrEqual(HARD_MAX);
    expect(stripFences(out)).toBe(lines.join('\n'));
  });

  it('keeps a single oversized line intact via the character-range path', () => {
    const long = 'y'.repeat(TARGET * 2 + 50);
    const out = chunkText('```\n' + long + '\n```', { target: TARGET, hardMax: HARD_MAX });
    expect(out.length).toBeGreaterThan(1);
    for (const part of out) expect(part.length).toBeLessThanOrEqual(HARD_MAX);
    expect(stripFences(out).replace(/\n/g, '')).toBe(long);
  });

  it('is deterministic across repeated calls', () => {
    const lines: string[] = [];
    for (let i = 0; i < 300; i++) lines.push(`row ${i} ${'z'.repeat(30)}`);
    const raw = '```\n' + lines.join('\n') + '\n```';
    const a = chunkText(raw, { target: TARGET, hardMax: HARD_MAX });
    const b = chunkText(raw, { target: TARGET, hardMax: HARD_MAX });
    expect(a).toEqual(b);
  });
});
