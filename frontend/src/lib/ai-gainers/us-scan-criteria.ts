// zzz797 — the US gainers scan criteria, owner-editable.
//
// Why: the owner edited his TradingView screener and the app kept showing a
// different, smaller list ("86 names in my screener, it's showing only 57").
// The app never read his screener: the live US scan POSTs its OWN filters to
// TradingView's public scanner, and those were hard-coded. The biggest single
// difference, measured live on 24 Sep 2026: our $10B market-cap CEILING. His
// saved screen's cap range is $300M–$10T (no real ceiling); lifting ours took
// the count from ~62 to ~88.
//
// A TradingView screener link (tradingview.com/screener/<id>/) carries only
// the screen's ID — the filters live in his TradingView account and are not
// readable without his login. So the criteria are stored in the app (KV),
// edited on the AI Gainers page, and the defaults stay the small/mid focus.
//
// Pure module: no I/O. The route reads/writes KV; tests import this directly.

export const US_SCAN_EXCHANGES = ['NASDAQ', 'NYSE', 'AMEX', 'CBOE', 'OTC'] as const;
export type UsScanExchange = typeof US_SCAN_EXCHANGES[number];

export interface UsScanCriteria {
  /** Today's % change floor (the scanner's "change" = regular-session % change). */
  minChangePct: number;
  /** USD. null = no floor. */
  minMcapUsd: number | null;
  /** USD. null = no ceiling. */
  maxMcapUsd: number | null;
  /** 30-day average shares traded. null = no floor. */
  minAvgVol30d: number | null;
  /** USD. null = no floor. */
  minPrice: number | null;
  /** Exchanges to include. Never empty after parsing. */
  exchanges: UsScanExchange[];
  /** Instrument kinds, as TradingView's screener "Symbol type" filter names them. */
  includeCommon: boolean;
  includePreferred: boolean;
  /** Depositary receipts (ADRs). */
  includeDr: boolean;
  /** TradingView's "Primary listing" switch. */
  primaryOnly: boolean;
  /** Max rows read from TradingView. */
  limit: number;
  /** The owner's screener link, kept as a reference only (see parseScreenerLink). */
  screenerUrl: string | null;
  updatedAt: string | null;
}

export const US_SCAN_LIMIT_MAX = 1000;

/** Defaults = the small/mid-cap focus the scan always had, with a larger row limit. */
export const DEFAULT_US_SCAN_CRITERIA: Readonly<UsScanCriteria> = Object.freeze({
  minChangePct: 4,
  minMcapUsd: 300e6,
  maxMcapUsd: 10e9,
  minAvgVol30d: 300_000,
  minPrice: null,
  exchanges: ['NASDAQ', 'NYSE', 'AMEX'] as UsScanExchange[],
  includeCommon: true,
  includePreferred: false,
  includeDr: false,
  primaryOnly: false,
  limit: 500,
  screenerUrl: null,
  updatedAt: null,
});

export const US_SCAN_CRITERIA_KV_KEY = 'ai-gainers:us-scan-criteria:v1';

// ── parsing / sanitising ───────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const x = Number(v.replace(/[,_\s$]/g, ''));
    return Number.isFinite(x) ? x : null;
  }
  return null;
};
/** Optional non-negative number: '' / null / 0 / negative → null (no bound). */
const optPos = (v: unknown): number | null => { const x = num(v); return x != null && x > 0 ? x : null; };
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : d);

/**
 * Anything (KV value, request body) → valid criteria. Unknown fields are
 * ignored; a missing or bad field takes the default; `problems` says which.
 */
export function parseUsScanCriteria(raw: unknown): { criteria: UsScanCriteria; problems: string[] } {
  const d = DEFAULT_US_SCAN_CRITERIA;
  const problems: string[] = [];
  const o: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(o, k);

  let minChangePct = d.minChangePct;
  if (has('minChangePct')) {
    const x = num(o.minChangePct);
    if (x == null || x < -100 || x > 1000) problems.push('minimum change % was not a number between -100 and 1000 — default kept');
    else minChangePct = x;
  }
  const bound = (k: 'minMcapUsd' | 'maxMcapUsd' | 'minAvgVol30d' | 'minPrice') => {
    if (!has(k)) return d[k];
    const v = o[k];
    if (v === null || v === '' || v === 0) return null;
    const x = num(v);
    if (x == null || x < 0) { problems.push(`${k} was not a positive number — default kept`); return d[k]; }
    return optPos(x);
  };
  let minMcapUsd = bound('minMcapUsd');
  let maxMcapUsd = bound('maxMcapUsd');
  if (minMcapUsd != null && maxMcapUsd != null && maxMcapUsd < minMcapUsd) {
    problems.push('the market-cap maximum was below the minimum — the two were swapped');
    [minMcapUsd, maxMcapUsd] = [maxMcapUsd, minMcapUsd];
  }
  const minAvgVol30d = bound('minAvgVol30d');
  const minPrice = bound('minPrice');

  let exchanges = [...d.exchanges];
  if (has('exchanges')) {
    const list = Array.isArray(o.exchanges) ? o.exchanges : typeof o.exchanges === 'string' ? o.exchanges.split(/[,\s]+/) : [];
    const ok = Array.from(new Set(list.map((x) => String(x).trim().toUpperCase())
      .map((x) => (x === 'NYSE ARCA' || x === 'ARCA' || x === 'NYSEARCA' || x === 'NYSE AMERICAN' ? 'AMEX' : x === 'BATS' || x === 'CBOE BZX' ? 'CBOE' : x))
      .filter((x): x is UsScanExchange => (US_SCAN_EXCHANGES as readonly string[]).includes(x))));
    if (ok.length) exchanges = ok;
    else problems.push('no known exchange was chosen — default exchanges kept');
  }

  let includeCommon = bool(o.includeCommon, d.includeCommon);
  const includePreferred = bool(o.includePreferred, d.includePreferred);
  const includeDr = bool(o.includeDr, d.includeDr);
  if (!includeCommon && !includePreferred && !includeDr) {
    problems.push('no stock type was chosen — common stock kept');
    includeCommon = true;
  }

  let limit = d.limit;
  if (has('limit')) {
    const x = num(o.limit);
    if (x == null || x < 1) problems.push('row limit was not a positive number — default kept');
    else limit = Math.min(US_SCAN_LIMIT_MAX, Math.floor(x));
  }

  const screenerUrl = typeof o.screenerUrl === 'string' && o.screenerUrl.trim() ? o.screenerUrl.trim().slice(0, 500) : null;
  const updatedAt = typeof o.updatedAt === 'string' ? o.updatedAt : null;

  return {
    criteria: {
      minChangePct, minMcapUsd, maxMcapUsd, minAvgVol30d, minPrice, exchanges,
      includeCommon, includePreferred, includeDr, primaryOnly: bool(o.primaryOnly, d.primaryOnly),
      limit, screenerUrl, updatedAt,
    },
    problems,
  };
}

// ── identity: a criteria change must never be served a stale cached list ──

/** The fields that change which rows come back — the link and timestamp do not. */
function scanIdentity(c: UsScanCriteria) {
  return [c.minChangePct, c.minMcapUsd, c.maxMcapUsd, c.minAvgVol30d, c.minPrice,
    [...c.exchanges].sort().join('+'), c.includeCommon, c.includePreferred, c.includeDr, c.primaryOnly, c.limit];
}

/** Short stable hash (FNV-1a 32-bit, base36) of the scan-relevant fields. */
export function criteriaHash(c: UsScanCriteria): string {
  const s = JSON.stringify(scanIdentity(c));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export function isDefaultCriteria(c: UsScanCriteria): boolean {
  return criteriaHash(c) === criteriaHash({ ...DEFAULT_US_SCAN_CRITERIA, exchanges: [...DEFAULT_US_SCAN_CRITERIA.exchanges] });
}

// ── criteria → TradingView scanner request ─────────────────────────────────

type Filter = { left: string; operation: string; right: unknown };

export function scanFilters(c: UsScanCriteria): { filter: Filter[]; filter2: Record<string, unknown> } {
  const filter: Filter[] = [{ left: 'change', operation: 'egreater', right: c.minChangePct }];
  if (c.minMcapUsd != null && c.maxMcapUsd != null) filter.push({ left: 'market_cap_basic', operation: 'in_range', right: [c.minMcapUsd, c.maxMcapUsd] });
  else if (c.minMcapUsd != null) filter.push({ left: 'market_cap_basic', operation: 'egreater', right: c.minMcapUsd });
  else if (c.maxMcapUsd != null) filter.push({ left: 'market_cap_basic', operation: 'eless', right: c.maxMcapUsd });
  filter.push({ left: 'exchange', operation: 'in_range', right: [...c.exchanges] });
  if (c.minAvgVol30d != null) filter.push({ left: 'average_volume_30d_calc', operation: 'egreater', right: c.minAvgVol30d });
  if (c.minPrice != null) filter.push({ left: 'close', operation: 'egreater', right: c.minPrice });
  if (c.primaryOnly) filter.push({ left: 'is_primary', operation: 'equal', right: true });
  // Symbol type, exactly the way TradingView's own screener sends it.
  const stockSpec = (spec: string) => ({ operation: { operator: 'and', operands: [
    { expression: { left: 'type', operation: 'equal', right: 'stock' } },
    { expression: { left: 'typespecs', operation: 'has', right: [spec] } }] } });
  const operands: unknown[] = [];
  if (c.includeCommon) operands.push(stockSpec('common'));
  if (c.includePreferred) operands.push(stockSpec('preferred'));
  if (c.includeDr) operands.push({ operation: { operator: 'and', operands: [{ expression: { left: 'type', operation: 'equal', right: 'dr' } }] } });
  return { filter, filter2: { operator: 'or', operands } };
}

// ── plain-words summary for the page ───────────────────────────────────────

export function fmtUsd(v: number): string {
  if (v >= 1e12) return `$${+(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${+(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${+(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString('en-US')}`;
}
function fmtVol(v: number): string {
  return v >= 1e6 ? `${+(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(0)}k` : String(v);
}

/** "change ≥ 4% · cap $300M–$10.0B · avg vol ≥ 300k · NASDAQ/NYSE/AMEX · common stock" */
export function describeCriteria(c: UsScanCriteria): string {
  const cap = c.minMcapUsd != null && c.maxMcapUsd != null ? `cap ${fmtUsd(c.minMcapUsd)}–${fmtUsd(c.maxMcapUsd)}`
    : c.minMcapUsd != null ? `cap ≥ ${fmtUsd(c.minMcapUsd)} (no maximum)`
      : c.maxMcapUsd != null ? `cap ≤ ${fmtUsd(c.maxMcapUsd)}` : 'any market cap';
  const types = [c.includeCommon && 'common', c.includePreferred && 'preferred', c.includeDr && 'ADR/DR'].filter(Boolean).join(' + ');
  return [
    `change ≥ ${c.minChangePct}%`,
    cap,
    c.minAvgVol30d != null ? `avg vol (30d) ≥ ${fmtVol(c.minAvgVol30d)}` : 'any avg volume',
    ...(c.minPrice != null ? [`price ≥ $${c.minPrice}`] : []),
    `exchanges ${c.exchanges.join('/')}`,
    types,
    ...(c.primaryOnly ? ['primary listing only'] : []),
  ].join(' · ');
}

// ── the owner's pasted link / filter JSON ──────────────────────────────────

export interface LinkParse {
  kind: 'screener_link' | 'tv_filter_json' | 'unknown';
  screenerId: string | null;
  /** Fields that could be read from what was pasted, if any. */
  criteria: Partial<UsScanCriteria> | null;
  /** TradingView filters that were pasted but this scan cannot apply. */
  unsupported: string[];
  message: string;
}

const LINK_EXPLAINER = 'A TradingView screener link only carries the screen’s ID — the filters are saved in your TradingView account, '
  + 'and TradingView does not let an app read them without your login. The link is kept for reference; please enter the same '
  + 'numbers in the boxes above so the app’s list matches your screener.';

/**
 * Read what can be read from a pasted TradingView link — or from pasted
 * scanner-request JSON (the `filter` array TradingView sends), which DOES
 * carry the filters.
 */
export function parseScreenerLink(input: string): LinkParse {
  const s = String(input || '').trim();
  if (!s) return { kind: 'unknown', screenerId: null, criteria: null, unsupported: [], message: 'Nothing was pasted.' };
  if (s.startsWith('{') || s.startsWith('[')) {
    try { return criteriaFromTvRequest(JSON.parse(s)); } catch { /* fall through */ }
    return { kind: 'unknown', screenerId: null, criteria: null, unsupported: [], message: 'That looks like JSON but could not be read.' };
  }
  const m = s.match(/tradingview\.com\/screener\/([A-Za-z0-9_-]{4,})/i);
  if (m) {
    return { kind: 'screener_link', screenerId: m[1], criteria: null, unsupported: [],
      message: `Screener ${m[1]} recognised. ${LINK_EXPLAINER}` };
  }
  if (/tradingview\.com/i.test(s)) {
    return { kind: 'screener_link', screenerId: null, criteria: null, unsupported: [], message: LINK_EXPLAINER };
  }
  return { kind: 'unknown', screenerId: null, criteria: null, unsupported: [], message: 'That is not a TradingView screener link.' };
}

/** TradingView scanner request JSON ({filter:[…]} or the bare array) → criteria. */
export function criteriaFromTvRequest(req: unknown): LinkParse {
  const arr: any[] = Array.isArray(req) ? req : Array.isArray((req as any)?.filter) ? (req as any).filter : [];
  const out: Partial<UsScanCriteria> = {};
  const unsupported: string[] = [];
  for (const f of arr) {
    const left = String(f?.left ?? ''); const op = String(f?.operation ?? ''); const r = f?.right;
    const lo = Array.isArray(r) ? num(r[0]) : num(r); const hi = Array.isArray(r) ? num(r[1]) : null;
    if (left === 'change' && (op === 'egreater' || op === 'greater') && lo != null) out.minChangePct = lo;
    else if (left === 'market_cap_basic' && op === 'in_range') { out.minMcapUsd = lo; out.maxMcapUsd = hi != null && hi < 1e13 ? hi : null; }
    else if (left === 'market_cap_basic' && (op === 'egreater' || op === 'greater')) { out.minMcapUsd = lo; out.maxMcapUsd = null; }
    else if (left === 'market_cap_basic' && (op === 'eless' || op === 'less')) out.maxMcapUsd = lo;
    else if (left === 'average_volume_30d_calc' && (op === 'egreater' || op === 'greater') && lo != null) out.minAvgVol30d = lo;
    else if (left === 'close' && (op === 'egreater' || op === 'greater') && lo != null) out.minPrice = lo;
    else if (left === 'exchange' && Array.isArray(r)) out.exchanges = r.map((x: unknown) => String(x).toUpperCase()) as UsScanExchange[];
    else if (left === 'is_primary') out.primaryOnly = r === true;
    else if (left) unsupported.push(`${left} ${op} ${JSON.stringify(r)}`);
  }
  const n = Object.keys(out).length;
  return {
    kind: 'tv_filter_json', screenerId: null, criteria: n ? out : null, unsupported,
    message: n
      ? `Read ${n} setting${n === 1 ? '' : 's'} from the pasted filters.${unsupported.length ? ` Not applied (this scan does not support them): ${unsupported.join('; ')}.` : ''}`
      : 'No filter this scan understands was found in the pasted JSON.',
  };
}

/** The downstream screen follows the owner's bounds (values in $ M), so a
 *  name his criteria asked for is not dropped again after the scan. */
export function screenOptionsFor(c: UsScanCriteria): { maxMcapM: number | null; minMcapM: number | null; minPrice: number | null; allowOtc: boolean; allowPreferred: boolean } {
  return {
    maxMcapM: c.maxMcapUsd != null ? c.maxMcapUsd / 1e6 : null,
    minMcapM: c.minMcapUsd != null ? c.minMcapUsd / 1e6 : null,
    minPrice: c.minPrice,
    allowOtc: c.exchanges.includes('OTC'),
    allowPreferred: c.includePreferred,
  };
}
