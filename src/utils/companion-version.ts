/**
 * Companion version tracking — pure helper.
 *
 * The manager browser must run the current watcher or auto-reports silently
 * stop working (stale countdown/scan logic). The server logs every version
 * transition so staleness is visible in the logs instead of hiding behind a
 * quiet system. Pure module — no env or DB needed.
 */

/** True when this poll should log the version (first sighting or change). */
export function shouldLogVersionChange(
  previous: string | null | undefined,
  current: string | null | undefined,
): boolean {
  if (!current) return false;
  if (!previous) return true;
  return previous !== current;
}
