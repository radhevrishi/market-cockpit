// PATCH 0721 — Canonical ticker normalization helper.
//
// Before this module, ticker normalization was duplicated inline across ~30+
// call sites (multibagger/page.tsx alone had 25+ copies of
// `.toUpperCase().replace(/\.(NS|BO)$/i, '')`). Each duplicate is a hidden
// risk: drift over time meant some pages stripped exchange prefixes while
// others didn't, causing dedup/lookup mismatches (e.g. `NSE:RELIANCE` vs
// `RELIANCE` not matching the same Conviction Beats entry).
//
// This module provides ONE function — `canonicalTicker()` — that handles
// every transformation needed to compare two ticker strings:
//   • prefix strip:   NSE:/BSE:/NYSE:/NASDAQ:/BOM:
//   • suffix strip:   .NS / .BO / .NSE / .BSE / -EQ
//   • whitespace trim
//   • uppercase
//
// IMPORTANT: this is intentionally a separate function from
// `normalizeTicker()` in @/lib/tickers.ts. That function additionally
// consults an alias map (HDFC → HDFCBANK, RIL → RELIANCE, LARSEN → LT) —
// which is the right call when the user TYPES a ticker and we have to
// resolve to the canonical NSE symbol. For comparing two already-typed
// strings (dedup, set membership, equality), aliasing is wrong: it would
// collapse `HDFC` (the bank) into `HDFCBANK` (also the bank) but also
// `LARSEN` into `LT` — losing the distinction the caller wanted.
//
// Rule of thumb:
//   • Use `canonicalTicker(s)` to compare strings or dedup a list.
//   • Use `normalizeTicker(s)` when resolving a user-input string to its
//     canonical NSE symbol for API lookups.
//
// Both functions are idempotent: f(f(x)) === f(x).

const PREFIX_RE = /^(NSE|BSE|NYSE|NASDAQ|BOM):/i;
const SUFFIX_RE = /\.(NS|BO|NSE|BSE)$/i;
const EQ_SUFFIX_RE = /-EQ$/i;

/**
 * Canonicalize a ticker for comparison / dedup.
 *
 * Strips exchange prefixes (NSE:/BSE:/NYSE:/NASDAQ:/BOM:), exchange suffixes
 * (.NS/.BO/.NSE/.BSE), the `-EQ` series suffix, whitespace, and uppercases.
 *
 * Does NOT consult the alias map — use `normalizeTicker()` from
 * `@/lib/tickers` for that.
 *
 * Returns `''` for null/undefined/empty input.
 */
export function canonicalTicker(input: string | null | undefined): string {
  if (!input) return '';
  let t = String(input).trim().toUpperCase();
  t = t.replace(PREFIX_RE, '');
  t = t.replace(SUFFIX_RE, '');
  t = t.replace(EQ_SUFFIX_RE, '');
  // Strip any internal whitespace just in case ("L T" → "LT").
  t = t.replace(/\s+/g, '');
  return t;
}

/**
 * Canonicalize a list of tickers, deduplicating after normalization.
 */
export function canonicalTickerList(items: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const c = canonicalTicker(raw);
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/**
 * Equality check that's resistant to exchange-prefix/suffix differences.
 */
export function tickerEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalTicker(a);
  if (!ca) return false;
  return ca === canonicalTicker(b);
}
