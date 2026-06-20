// PATCH 1101zzz2 / AUDIT H2 — centralized cron-secret verification.
//
// Before: 22+ routes did `provided === expected` (string ===) on URL query
// secrets, which leaks timing info on a mismatch (each char compared
// position-by-position with early exit). Combined with no rate limit, this
// was theoretically brute-forceable.
//
// After: `verifyCronSecret(req)` uses `crypto.timingSafeEqual` on
// length-normalized buffers, plus a uniform Vercel-cron header allow-list.
// Routes that adopt this helper get hardening without per-route changes.
//
// Usage:
//   import { verifyCronSecret } from '@/lib/verifyAuth';
//   const auth = verifyCronSecret(req);
//   if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });

import { timingSafeEqual } from 'node:crypto';

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Constant-time string comparison.
 * Works on strings of unequal length without leaking which differed.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  // Normalize to equal length by padding the shorter with zero bytes. The
  // padded buffer never matches, but the compare itself is constant-time.
  const maxLen = Math.max(a.length, b.length);
  const aBuf = Buffer.alloc(maxLen);
  const bBuf = Buffer.alloc(maxLen);
  aBuf.write(a);
  bBuf.write(b);
  try {
    return timingSafeEqual(aBuf, bBuf) && a.length === b.length;
  } catch {
    return false;
  }
}

/**
 * Verify a Next.js Request carries a valid CRON_SECRET via:
 *   1. ?secret=... query param, OR
 *   2. x-vercel-cron header (when Vercel itself calls the route)
 *
 * Returns { ok: true } or { ok: false, reason }.
 *
 * Behavior when CRON_SECRET is unset on the server:
 *   - If `requireSecret: true` (default for state-changing routes), fail closed
 *   - If `requireSecret: false`, allow (matches the open-mode pattern many
 *     warming/cron routes already use)
 */
export function verifyCronSecret(
  req: Request,
  opts: { requireSecret?: boolean } = {},
): VerifyResult {
  const { requireSecret = true } = opts;
  const expected = (process.env.CRON_SECRET || '').trim();

  // Vercel's cron service stamps requests with this header.
  const vercelCron = req.headers.get('x-vercel-cron') || req.headers.get('x-vercel-signature');
  if (vercelCron) return { ok: true };

  if (!expected) {
    if (requireSecret) {
      return { ok: false, reason: 'CRON_SECRET not configured on server' };
    }
    return { ok: true }; // open mode for non-critical warming routes
  }

  const url = new URL(req.url);
  const provided = (url.searchParams.get('secret') || '').trim();
  if (!provided) return { ok: false, reason: 'secret required' };
  if (!timingSafeEqualString(provided, expected)) {
    return { ok: false, reason: 'unauthorized' };
  }
  return { ok: true };
}
