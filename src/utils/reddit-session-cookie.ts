/**
 * Pure Reddit session-cookie validation (no I/O — safe for unit tests).
 *
 * The manager pastes the spare account's FULL Cookie header value from
 * DevTools. Unlike single-value cookies, semicolons and spaces are part of
 * the value and must be preserved.
 */

/** Known Reddit web session cookie names (either one proves a real paste). */
const SESSION_COOKIE_MARKERS = ['reddit_session', 'token', 'edgebucket', 'loid', 'session_tracker'];

/**
 * Cleans paste artifacts (a "Cookie:"/"cookie:" prefix, surrounding quotes,
 * line breaks from multi-line copies) down to the raw header value.
 */
export function sanitizeRedditCookie(raw: string): string {
  let v = String(raw || '').trim();
  if (/^cookie:/i.test(v)) v = v.slice(7).trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    v = v.slice(1, -1).trim();
  }
  // Collapse line breaks / tabs from multi-line pastes into single spaces,
  // then tidy " ; " separators. Values never legitimately contain newlines.
  v = v
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s*;\s*/g, '; ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return v;
}

/** Rejects empty / truncated / wrong-field pastes before they reach the vault. */
export function assertRedditCookie(v: string): void {
  if (!v || v.length < 50) {
    throw new Error('Cookie looks too short — paste the FULL Cookie header value from DevTools (hundreds of characters).');
  }
  if (v.length > 12000) {
    throw new Error('Cookie is unexpectedly long — paste only the Cookie header value, no attributes.');
  }
  if (/[\x00-\x1f\x7f]/.test(v)) {
    throw new Error('Cookie contains control characters. Repaste the raw value.');
  }
  if (!v.includes('=')) {
    throw new Error('Cookie has no name=value pairs — paste the Cookie header value, not a single token.');
  }
  const lower = v.toLowerCase();
  if (!SESSION_COOKIE_MARKERS.some((m) => lower.includes(m))) {
    throw new Error('No Reddit session cookie found (expected reddit_session, token, edgebucket, loid or session_tracker). Log into Reddit with the SPARE account and copy its cookies.');
  }
}
