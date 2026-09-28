// ═══════════════════════════════════════════════════════════════════════════
// BSE SCRIP CODE → NSE SYMBOL, from sources the app already has.     (zzz825)
//
// A holding saved as "543573" never matched Conviction Beats (NSE symbols), so
// the same company showed twice or not at all. No hard-coded ticker map: the
// server route /api/v1/book/bse-map answers from (1) the earnings search index
// the graded engine builds (it carries the BSE code of a BSE-sourced row) and
// (2) the screener.in company page for the code, which links the NSE quote.
// A code neither source names stays a code and the Book check flags it.
//
// Pure helpers first (tested); the browser loader at the bottom caches
// answers in localStorage (a convenience: found 30 days, not found 1 day).
// ═══════════════════════════════════════════════════════════════════════════

import type { BseMatch } from './book-membership';

/** Pure: the NSE symbol a screener.in company page links, or null (a BSE-only scrip). */
export function nseSymbolFromScreenerPage(html: string | null | undefined): string | null {
  const h = String(html || '');
  const m = /nseindia\.com\/get-quotes\/equity\?symbol=([A-Z0-9&\-]{1,20})/i.exec(h)
    || /\bNSE\s*:\s*(?:<[^>]+>\s*)*([A-Z0-9&\-]{1,20})\s*</.exec(h)
    || /<link[^>]+rel="canonical"[^>]+href="https?:\/\/(?:www\.)?screener\.in\/company\/([A-Z0-9&\-]{1,20})\//i.exec(h);
  if (!m) return null;
  const s = decodeURIComponent(m[1]).toUpperCase().replace(/&AMP;/g, '&');
  return /^\d+$/.test(s) ? null : s;
}

/** Pure: a match from the earnings search index rows ({ t, c, bse }). */
export function matchFromIndex(code: string, index: Array<{ t?: string; c?: string; bse?: string | null }> | null | undefined): BseMatch | null {
  for (const e of index || []) {
    if (e && e.bse && String(e.bse).trim() === code && e.t && !/^\d{6}$/.test(String(e.t))) {
      return { symbol: String(e.t).toUpperCase(), company: e.c || null, via: 'earnings index' };
    }
  }
  return null;
}

// ── browser loader ─────────────────────────────────────────────────────────

const LS_KEY = 'mc:bse-nse:v1';
const FOUND_MS = 30 * 86_400_000;
const MISS_MS = 86_400_000;

type Cached = Record<string, { at: number; m: BseMatch }>;
function readLs(): Cached {
  try { const j = JSON.parse(window.localStorage.getItem(LS_KEY) || '{}'); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
function writeLs(c: Cached) { try { window.localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch { /* storage full or blocked */ } }

/** The cached answers for these codes (instant; no network). */
export function cachedBseMatches(codes: string[]): Record<string, BseMatch> {
  if (typeof window === 'undefined') return {};
  const c = readLs();
  const out: Record<string, BseMatch> = {};
  for (const k of codes) {
    const x = c[k];
    if (x && Date.now() - x.at < (x.m.symbol ? FOUND_MS : MISS_MS)) out[k] = x.m;
  }
  return out;
}

/** Look codes up (cache first, then /api/v1/book/bse-map). A failed call leaves the code out — "not looked up". */
export async function lookupBseCodes(codes: string[]): Promise<Record<string, BseMatch>> {
  const want = Array.from(new Set(codes.filter((c) => /^\d{6}$/.test(c))));
  const out = cachedBseMatches(want);
  const miss = want.filter((c) => !out[c]);
  if (!miss.length) return out;
  try {
    const r = await fetch(`/api/v1/book/bse-map?codes=${encodeURIComponent(miss.slice(0, 40).join(','))}`, { cache: 'no-store' });
    if (!r.ok) return out;
    const j = await r.json();
    const got: Record<string, BseMatch> = j?.matches && typeof j.matches === 'object' ? j.matches : {};
    const c = readLs();
    for (const [k, m] of Object.entries(got)) {
      if (!m || !/^\d{6}$/.test(k)) continue;
      if (m.via === 'lookup failed') continue;          // a source outage is not "no NSE listing"
      out[k] = m;
      c[k] = { at: Date.now(), m };
    }
    writeLs(c);
  } catch { /* offline — codes stay unmatched, flagged */ }
  return out;
}
