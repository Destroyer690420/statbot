/**
 * Paths exempt from the shared `/api/` rate limiter.
 *
 * The manager-browser companion polls `claims/pending` every ~2s per tab
 * (plus `sightings` snapshots) from the same home IP as the dashboard. Those
 * endpoints are gated by the shared extension secret (`extensionAuth`), so
 * rate-limiting them adds no protection — and because the limiter is keyed
 * by IP, companion polling used to burn the whole budget and 429 the
 * dashboard's own fetches mid-blast.
 *
 * NOTE: match against `req.originalUrl`, never `req.path`. The limiter is
 * mounted via `app.use('/api/', ...)` and Express strips the mount prefix
 * from `req.url`/`req.path` inside mounted middleware, so `req.path` here
 * is `/v1/...` and a comparison against `/api/v1/...` never matches (the
 * exemption silently did nothing until this was fixed).
 */
const EXEMPT_PATHNAMES = new Set([
  '/api/v1/automation/claims/pending',
  '/api/v1/automation/sightings',
  '/api/v1/automation/burst',
  '/api/v1/automation/eligibility-bundle',
  '/api/v1/goparttime/assign',
]);

/** True when this request URL (path + optional query) bypasses the limiter. */
export function isRateLimitExempt(originalUrl: string): boolean {
  const pathname = originalUrl.split('?')[0];
  const normalized =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return EXEMPT_PATHNAMES.has(normalized);
}
