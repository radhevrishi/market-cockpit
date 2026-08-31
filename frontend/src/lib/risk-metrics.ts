// Risk & Concentration Desk — pure metric helpers.
// No React, no DOM, no I/O: everything here is deterministic and unit-friendly
// so the page component stays a thin rendering layer over these functions.

export type Region = 'india' | 'us';

/** Normalized live quote as consumed by the Risk desk. Every field is
 *  optional/nullable because the upstream /api/market/quotes response shape
 *  varies by code path (live NSE vs KV blob vs Yahoo fallback). */
export interface QuoteLite {
  symbol: string;          // normalized (uppercase, no .NS/.BO)
  price: number | null;
  changePercent: number | null;
  sector: string | null;
  region: Region;
  /** Distance below 52-week high as a POSITIVE percentage (e.g. 25 = 25% off high). null if unknown. */
  distFromHigh: number | null;
  week52High: number | null;
  /** A liquidity proxy — average daily traded value/volume-like number. null if unknown. */
  liquidity: number | null;
  marketCap: number | null;
}

/** A holding joined to its live quote and derived risk numbers. */
export interface RiskPosition {
  symbol: string;
  quantity: number;
  entryPrice: number;
  storedWeight: number;    // weight persisted on the holding (fallback)
  notes?: string;
  quote: QuoteLite | null;
  region: Region | null;   // inferred from which feed matched
  sector: string;
  livePrice: number | null;
  marketValue: number;     // in native currency (₹ for india, $ for us)
  weight: number;          // fraction 0..1 of TOTAL book market value (region-agnostic)
  pnlPct: number | null;   // vs entry, using live price
  distFromHigh: number | null;
  liquidity: number | null;
}

// ── symbol helpers ──────────────────────────────────────────────────────────

export function normalizeSymbol(s: string): string {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO)$/i, '');
}

// ── defensive field probing ─────────────────────────────────────────────────

/** Read the first key present on obj that parses to a finite number. */
export function pickNumber(obj: any, keys: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    const n = typeof v === 'string' ? Number(v.replace(/[, ]/g, '')) : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Read the first key present on obj that is a non-empty string. */
export function pickString(obj: any, keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Build a normalized QuoteLite from a raw quote row of unknown shape. */
export function toQuoteLite(raw: any, region: Region): QuoteLite | null {
  const symRaw = pickString(raw, ['symbol', 'ticker', 'Symbol', 'sym', 'code']);
  if (!symRaw) return null;
  const price = pickNumber(raw, ['price', 'ltp', 'lastPrice', 'last_price', 'regularMarketPrice', 'close', 'lastTradedPrice']);
  const changePercent = pickNumber(raw, ['changePercent', 'change_pct', 'pChange', 'changesPercentage', 'pctChange', 'percentChange', 'regularMarketChangePercent']);
  const sector = pickString(raw, ['sector', 'industry', 'Sector', 'Industry']);
  const week52High = pickNumber(raw, ['week52High', 'yearHigh', 'fiftyTwoWeekHigh', 'high52w', 'week_52_high', '52wHigh']);

  // Distance from 52w high: prefer an explicit field, else derive from price & high.
  let distFromHigh: number | null = null;
  const explicitPct = pickNumber(raw, ['pct_from_52w_high', 'pctOf52wHigh', 'pctFrom52wHigh', 'distFrom52wHigh', 'from52wHigh']);
  if (explicitPct != null) {
    // Field may be expressed as "% of high" (e.g. 82 => 18% off) or as a
    // signed distance (e.g. -18). Normalize to a positive "% off high".
    if (explicitPct > 0 && explicitPct <= 100 &&
        pickNumber(raw, ['pctOf52wHigh']) === explicitPct) {
      distFromHigh = Math.max(0, 100 - explicitPct); // pctOf52wHigh is "% of high"
    } else {
      distFromHigh = Math.abs(explicitPct);
    }
  } else if (price != null && week52High != null && week52High > 0 && price > 0) {
    distFromHigh = Math.max(0, ((week52High - price) / week52High) * 100);
  }

  const liquidity = pickNumber(raw, ['adtv', 'avgVolume', 'vol20DAvg', 'averageDailyVolume3Month', 'turnoverLacs', 'volume', 'totalTradedVolume', 'regularMarketVolume']);
  const marketCap = pickNumber(raw, ['marketCap', 'market_cap', 'mcap', 'freeFloatMktCap', 'ffmc']);

  return {
    symbol: normalizeSymbol(symRaw),
    price,
    changePercent,
    sector: sector || null,
    region,
    distFromHigh,
    week52High,
    liquidity,
    marketCap,
  };
}

/** Pull the array of quote rows out of the (variable) quotes-endpoint payload. */
export function extractQuoteRows(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  for (const k of ['stocks', 'quotes', 'data', 'results', 'rows']) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  return [];
}

// ── concentration math ──────────────────────────────────────────────────────

/** Herfindahl-Hirschman Index on a set of weight fractions (0..1). Returns 0..10000. */
export function computeHHI(fractions: number[]): number {
  return fractions.reduce((acc, w) => acc + (w > 0 ? w * w : 0), 0) * 10000;
}

export interface HHIGrade { label: string; tone: 'good' | 'warn' | 'bad'; }

export function gradeHHI(hhi: number): HHIGrade {
  if (hhi < 1500) return { label: 'Diversified', tone: 'good' };
  if (hhi <= 2500) return { label: 'Moderate', tone: 'warn' };
  return { label: 'Concentrated', tone: 'bad' };
}

/** Sum of the N largest weights (fractions) as a percentage. */
export function topNConcentration(fractions: number[], n: number): number {
  return [...fractions].sort((a, b) => b - a).slice(0, n).reduce((a, b) => a + b, 0) * 100;
}
