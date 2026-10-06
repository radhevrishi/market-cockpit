// Moved verbatim out of page.tsx (pure refactor, no behaviour change).

// zzz171 — NUCLEAR CACHE BUST. Bumping v1 → v2 in USA_STORAGE_KEY and
// USA_SLIM_KEY makes every browser's cached 76 India-heavy USAResult rows
// (persisted before zzz163's exchange filter ever ran) INVISIBLE. On mount,
// useState reads v2 which is null → rows = [] → auto-load fires → fresh CSV
// pull → exchange-filter runs → only NYSE/NASDAQ rows survive.
// Also clean up the stale v1 keys to free up localStorage quota.
export const USA_STORAGE_KEY = 'mb_usa_scored_v2';
export const USA_SLIM_KEY = 'mb_usa_slim_v2';
if (typeof window !== 'undefined') {
  try { localStorage.removeItem('mb_usa_scored_v1'); } catch {}
  try { localStorage.removeItem('mb_usa_slim_v1'); } catch {}
}

// PATCH zzz110 — IN-MEMORY USA ROWS BRIDGE.
// Five prior patches (zzz105/106/107/108/109) all assumed localStorage works.
// On this user's session it apparently doesn't — Analytics keeps reporting
// usaRows.len=0 even after multiple uploads. This module-level cache is the
// bypass: USACompare writes here synchronously, MultibaggerAnalytics reads
// here first. No browser storage involved. Survives sub-tab switches inside
// the Multibagger Research Engine (same React tree, same page session).
// Lost on full page reload — user reuploads in that case, same as today.
let _usaRowsMemCache: any[] = [];
export function _setUsaRowsMemCache(rows: any[]) {
  _usaRowsMemCache = Array.isArray(rows) ? rows : [];
  try {
    window.dispatchEvent(new CustomEvent('mb-upload:updated', {
      detail: { market: 'USA', count: _usaRowsMemCache.length, source: 'mem-cache' },
    }));
  } catch {}
}
export function _getUsaRowsMemCache(): any[] {
  return _usaRowsMemCache;
}
// zzz231 — India parity with USA: in-memory cache of the scored India rows
// so that Copy ALL BEST -> TV (from India Technicals tab) can still surface
// the ###Multibaggers section when the localStorage layer (`mb_excel_scored_v2`)
// gets evicted by the browser under storage pressure. Mirrors USA's zzz108.
let _indiaRowsMemCache: any[] = [];
export function _setIndiaRowsMemCache(rows: any[]) {
  _indiaRowsMemCache = Array.isArray(rows) ? rows : [];
  try {
    window.dispatchEvent(new CustomEvent('mb-upload:updated', {
      detail: { market: 'IND', count: _indiaRowsMemCache.length, source: 'mem-cache' },
    }));
  } catch {}
}
export function _getIndiaRowsMemCache(): any[] {
  return _indiaRowsMemCache;
}
export function toSlimUsaRows(rows: any[]): any[] {
  return (rows || []).map((r: any) => ({
    symbol: r.symbol,
    company: r.company || r.companyName,
    score: r.score,
    grade: r.grade,
    exchange: r.exchange,
    sector: r.sector,
    marketCapB: r.marketCapB,
    fcfOpDivergence: r.fcfOpDivergence,
    postRunStretched: r.postRunStretched,
    earningsProximityDays: r.earningsProximityDays,
    suggestedMaxPositionPct: r.suggestedMaxPositionPct,
    _screeners: r._screeners,
    ruleOf40: r.ruleOf40,
    revenueGrowthAnn: r.revenueGrowthAnn,
    fcfMarginAnn: r.fcfMarginAnn,
    capTier: r.capTier,
    roic: r.roic,
    roe: r.roe,
    grossMarginTtm: r.grossMarginTtm || r.grossMarginAnn,
    piotroskiFScore: r.piotroskiFScore,
    market: 'USA',
  }));
}
