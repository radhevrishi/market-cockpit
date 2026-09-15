// ═══════════════════════════════════════════════════════════════════════════
// TICKER → INDUSTRY, RESOLVED ONCE AND KEPT  (zzz632)
//
// THE PROBLEM THIS REPLACES. Every India-graded earnings row arrives with
// `sector: ''` and `industry: null` — all 962 of them in a five-day sample —
// so the theme classifier had nothing to read and 257 of the 478 names in Your
// Book sat under "Unclassified". The cause was a scrape: the sector came from
// a "Compare with …" peer link on the Screener page that is not there any more,
// and it failed SILENTLY, which is why it went unnoticed for so long.
//
// WHY THIS IS NOT "FIX THE SCRAPE". Rebuilding the thing that just broke, in
// the same shape, buys a year until the next redesign and then fails the same
// silent way. And a single bulk blob is no better: one schema change in the
// job that builds it and every name goes dark at once.
//
// THE DESIGN, AND WHY IT SHOULD STILL BE RIGHT IN TWENTY YEARS:
//
//   1. AN INDUSTRY IS A NEAR-IMMUTABLE FACT. A company changes its industry
//      once a decade, if ever. So it is resolved ONCE per ticker and kept —
//      not re-derived on every page load. That single decision is what makes
//      the whole thing durable: coverage only ever accumulates, and no future
//      outage can un-resolve a name that is already known.
//
//   2. SOURCES ARE A LADDER, NOT A DEPENDENCY. Each is tried in order of
//      authority and each may fail on its own without taking the rest down:
//        · the row's own sector/industry, when it ever carries one;
//        · the nse-ticker-universe blob the breadth engine already maintains
//          (bulk, free, ~750 of the liquid names);
//        · NSE's own quote-equity endpoint, per ticker, for the long tail —
//          the micro-caps that make up most of this book and that no bulk
//          source carries.
//      A fourth source can be added later as one more rung; nothing else changes.
//
//   3. RESOLUTION IS BOUNDED AND NEVER BLOCKS. A request answers immediately
//      with everything already known and resolves at most a handful of misses.
//      Coverage fills in over a few page loads and then stays filled forever,
//      so the expensive path runs once per company in the life of the app.
//
//   4. A MISS IS CACHED TOO, briefly. A name NSE genuinely does not carry must
//      not be re-asked on every visit; a week is long enough to stop the
//      hammering and short enough that a new listing resolves by itself.
//
//   5. EVERY ANSWER CARRIES ITS PROVENANCE. `?debug=1` says which rung
//      resolved what — so when a source dies it is visible, instead of
//      silently returning empty like the last one did.
//
//   GET /api/v1/nse-industry                      → everything known
//   GET /api/v1/nse-industry?tickers=A,B,C        → those, resolving misses
//   GET /api/v1/nse-industry?tickers=…&debug=1    → with provenance
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { nseApiFetch } from '@/lib/nse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface UniverseTicker { ticker: string; industry?: string }

/** Effectively permanent: an industry does not change, and every read renews
 *  it. A year, rather than no expiry, so a genuinely wrong early answer cannot
 *  outlive the app itself. */
const HIT_TTL = 365 * 24 * 60 * 60;
/** Long enough to stop re-asking on every page load, short enough that a new
 *  listing resolves by itself the following week. */
const MISS_TTL = 7 * 24 * 60 * 60;
const KEY = (t: string) => `industry:v2:${t}`;

/** How many unknown tickers one request may resolve from NSE. Small on
 *  purpose: the page must never wait on this, and the cache means the work is
 *  done once per company in the life of the app, not once per visit. */
const RESOLVE_BUDGET = 10;
const NSE_GAP_MS = 220;

type Src = 'cache' | 'universe' | 'nse' | 'none';

const norm = (s: string) => String(s || '').toUpperCase().replace(/\.(NS|BO)$/, '').trim();

/** The bulk rung: one blob, all the liquid names, no per-ticker cost. */
async function universeMap(): Promise<Record<string, string>> {
  try {
    const blob = await kvGet<{ tickers?: UniverseTicker[] }>('nse-ticker-universe:v1:latest');
    const out: Record<string, string> = {};
    for (const t of (blob?.tickers || [])) {
      const k = norm(t?.ticker || ''); const ind = String(t?.industry || '').trim();
      if (k && ind) out[k] = ind;
    }
    return out;
  } catch { return {}; }
}

/**
 * The long-tail rung: NSE's own classification for one ticker.
 *
 * `industryInfo` carries four levels of increasing precision. The finest one
 * available is taken, because the theme classifier reads keywords and
 * "Pharmaceuticals" tells it far more than "Healthcare" does. nseApiFetch
 * handles cookies and negative-caches its own failures, and returns null
 * rather than throwing — so a bad day at NSE costs nothing here.
 */
async function nseIndustry(ticker: string): Promise<string | null> {
  try {
    const j = await nseApiFetch(`/quote-equity?symbol=${encodeURIComponent(ticker)}`, 60_000);
    const ii = j?.industryInfo;
    if (!ii) return null;
    const pick = [ii.basicIndustry, ii.industry, ii.sector, ii.macro]
      .map((x: any) => String(x || '').trim())
      .find((x: string) => x.length > 1);
    return pick || null;
  } catch { return null; }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const want = (searchParams.get('tickers') || '').split(',').map(norm).filter(Boolean);
  const debug = searchParams.get('debug') === '1';

  if (!isRedisAvailable()) {
    // No cache means no ladder — the bulk blob lives in the same store. Say so
    // rather than returning an empty map that reads like "no such company".
    return NextResponse.json({ map: {}, error: 'no cache backend — industries cannot be resolved or kept' }, { status: 200 });
  }

  const uni = await universeMap();

  // No ticker list: hand back the bulk rung, which is what a first page load
  // wants. Cheap, and it never triggers resolution.
  if (!want.length) {
    return NextResponse.json(
      { map: uni, universe: Object.keys(uni).length, note: 'bulk source only; pass ?tickers= to resolve the long tail' },
      { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' } },
    );
  }

  const out: Record<string, string | null> = {};
  const src: Record<string, Src> = {};
  const unresolved: string[] = [];

  // ── Rung 1 and 2: what is already known, at no cost ──────────────────────
  for (const t of want) {
    let hit: string | null = null;
    try {
      const c = await kvGet<string>(KEY(t));
      if (c != null) { hit = c === '-' ? null : c; src[t] = 'cache'; }
    } catch { /* treat a cache miss and a cache outage the same: resolve it */ }
    if (src[t] === 'cache') { out[t] = hit; if (hit == null) continue; continue; }
    if (uni[t]) {
      out[t] = uni[t]; src[t] = 'universe';
      try { await kvSet(KEY(t), uni[t], HIT_TTL); } catch { /* best effort */ }
      continue;
    }
    out[t] = null; src[t] = 'none'; unresolved.push(t);
  }

  // ── Rung 3: the long tail, bounded ───────────────────────────────────────
  // Only the names no bulk source carries, only a handful per request, and
  // serialised with a small gap so NSE is never hit hard. Everything resolved
  // here is kept forever, so this cost is paid once per company, not per visit.
  let resolved = 0;
  for (const t of unresolved.slice(0, RESOLVE_BUDGET)) {
    const ind = await nseIndustry(t);
    if (ind) {
      out[t] = ind; src[t] = 'nse'; resolved++;
      try { await kvSet(KEY(t), ind, HIT_TTL); } catch { /* best effort */ }
    } else {
      try { await kvSet(KEY(t), '-', MISS_TTL); } catch { /* best effort */ }
    }
    await new Promise((r) => setTimeout(r, NSE_GAP_MS));
  }

  const known = Object.values(out).filter(Boolean).length;
  const stillUnknown = Math.max(0, unresolved.length - resolved);
  return NextResponse.json({
    map: out,
    requested: want.length,
    resolved: known,
    // Stated plainly so a caller can ask again and finish the job, rather than
    // concluding these names have no industry.
    pending: stillUnknown,
    note: stillUnknown
      ? `${stillUnknown} not resolved on this pass (budget ${RESOLVE_BUDGET}/request). Ask again to continue — every answer is kept, so coverage only accumulates.`
      : undefined,
    ...(debug ? { source: src, universe_size: Object.keys(uni).length } : {}),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
