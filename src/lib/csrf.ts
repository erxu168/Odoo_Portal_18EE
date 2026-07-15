/**
 * Cheap CSRF defense for state-changing tablet endpoints (which mint sessions).
 * Require the request to be same-origin. Modern browsers send `Sec-Fetch-Site`;
 * when present it must be `same-origin` — this blocks the sibling-subdomain /
 * cross-site POSTs that `SameSite=Lax` cookies would otherwise still ride along.
 * Falls back to an Origin↔Host comparison for older clients.
 */
export function isSameOrigin(request: Request): boolean {
  const sfs = request.headers.get('sec-fetch-site');
  if (sfs) return sfs === 'same-origin' || sfs === 'none';
  // No Sec-Fetch-Site: fall back to Origin/Referer, and FAIL CLOSED if neither is
  // present — a genuine browser fetch POST always sends an Origin, so a headerless
  // request is not a normal same-origin call.
  const host = request.headers.get('host');
  const origin = request.headers.get('origin') || request.headers.get('referer');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
