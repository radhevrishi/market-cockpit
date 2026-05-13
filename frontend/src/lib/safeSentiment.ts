// PATCH 0351 — shared sentiment coercer.
//
// The /api/v1/news endpoint returns each article's `sentiment` field in
// TWO shapes:
//
//   A) Legacy string label  — 'BULLISH' | 'BEARISH' | 'NEUTRAL'
//   B) Institutional engine — { direction: 'positive'|'negative'|'neutral',
//                               magnitude: number }
//
// Rendering shape (B) directly as a JSX child throws React error #31 and
// crashes the dashboard.  Every consumer must run the value through
// `coerceSentiment()` before passing it to JSX or to colour helpers.
//
// History:
//   - Patch 0125 / 0163 handled this for stock-sheet localStorage entries.
//   - Patch 0350 hardened stock-sheet rendering.
//   - Patch 0351 (this file) extracts the helper to a shared module so
//     TickerDrawer, /orders, /news, and any future consumer share one
//     source of truth.

export function coerceSentiment(s: unknown): string {
  if (s == null) return '';
  if (typeof s === 'string') return s;
  if (typeof s === 'object') {
    const dir = String((s as { direction?: unknown }).direction ?? '').toLowerCase();
    if (dir === 'positive') return 'BULLISH';
    if (dir === 'negative') return 'BEARISH';
    if (dir === 'neutral')  return 'NEUTRAL';
    if (dir) return dir.toUpperCase();
    return '';
  }
  return '';
}

/**
 * Convenience guard: returns the string label, or null if there is no
 * usable signal (so callers can skip the badge entirely).
 */
export function sentimentLabel(s: unknown): string | null {
  const v = coerceSentiment(s);
  return v ? v : null;
}
