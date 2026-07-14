/**
 * In-memory sliding-window rate limiter.
 *
 * Intentionally simple — single-process counter, resets on server restart.
 * Sized for internal-token endpoints where the goal is leak defense, not
 * user-facing throttling. For user-facing limits, use a persistent store.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
  remaining: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const w = windows.get(key);

  if (!w || now >= w.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0, remaining: limit - 1 };
  }

  if (w.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)),
      remaining: 0,
    };
  }

  w.count += 1;
  return { allowed: true, retryAfterSec: 0, remaining: limit - w.count };
}

export function clientIpFromHeaders(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const xri = headers.get('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}
