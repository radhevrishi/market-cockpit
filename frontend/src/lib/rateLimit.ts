/**
 * Simple in-memory rate limiter for Next.js API routes.
 * Uses a sliding window counter per IP address.
 * Falls back gracefully on edge runtime (no process.env needed).
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL_MS = 60_000; // clean expired entries every minute

// Periodically clean expired entries to prevent unbounded memory growth
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      // Remove entries older than the longest possible window (60s)
      if (now - entry.windowStart > 60_000) store.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Check rate limit for a given identifier (usually IP address).
 * @param id       - Unique identifier (e.g. IP, user ID)
 * @param limit    - Max requests allowed per window
 * @param windowMs - Window duration in milliseconds
 * @returns { allowed: boolean; remaining: number; resetInMs: number }
 */
export function checkRateLimit(
  id: string,
  limit: number = 60,
  windowMs: number = 60_000,
): { allowed: boolean; remaining: number; resetInMs: number } {
  const now = Date.now();
  const entry = store.get(id);

  if (!entry || now - entry.windowStart >= windowMs) {
    // New window
    store.set(id, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, resetInMs: windowMs };
  }

  if (entry.count >= limit) {
    const resetInMs = windowMs - (now - entry.windowStart);
    return { allowed: false, remaining: 0, resetInMs };
  }

  entry.count++;
  const remaining = limit - entry.count;
  const resetInMs = windowMs - (now - entry.windowStart);
  return { allowed: true, remaining, resetInMs };
}

/**
 * Extract IP from Next.js request headers (works on Vercel + edge).
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * Convenience: returns a 429 Response if rate limited, else null.
 * Usage: const limited = rateLimitResponse(req); if (limited) return limited;
 */
export function rateLimitResponse(
  request: Request,
  limit: number = 60,
  windowMs: number = 60_000,
): Response | null {
  const ip = getClientIp(request);
  const { allowed, remaining, resetInMs } = checkRateLimit(ip, limit, windowMs);

  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Too many requests', retryAfterMs: resetInMs }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': '0',
        'Retry-After': String(Math.ceil(resetInMs / 1000)),
      },
    });
  }

  return null;
}
