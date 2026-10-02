// zzz857 — read-only access to the AI-extracted, quote-checked guidance rows (written by the extractor, see guidance-docs-types.ts).
//   guidance-extract:v1:index        -> string[] docIds with a result (newest first)
//   guidance-extract:v1:<docId>      -> GuidanceExtractResult
//   guidance-docs:v1:index           -> GuidanceDocIndex (for coverage counts only)
// Plus the PRIOR fiscal year's ACTUAL a derived growth % is divided by: the document's own stated actual (row.priorActual), else a
// date-matched sum of four reported quarters from the results cache (enrich:v18:<SYM> quarters_sales / quarters_pat + quarters_dates).
// Nothing is guessed: a missing quarter, an undated series or a period that cannot be placed returns no actual ('Not established').
// Never throws: every reader returns empty on failure and says so.
import type { ExtractedGuidance, GuidanceExtractResult } from './guidance-docs-types';

export const EXTRACT_INDEX_KEY = 'guidance-extract:v1:index';
export const extractKey = (docId: string) => `guidance-extract:v1:${docId}`;
export const DOCS_INDEX_KEY = 'guidance-docs:v1:index';
export const EXTRACT_READ_CAP = 600;

export interface ExtractIo { get: <T = any>(key: string) => Promise<T | null>; mget: <T = any>(keys: string[]) => Promise<Array<T | null>> }
async function defaultIo(): Promise<ExtractIo> {
  const kv = await import('./kv');
  return { get: (k) => kv.kvGet(k), mget: (ks) => kv.kvMGet(ks) };
}

/** The index may be a bare string[] or { docIds } / { rows: [{docId}] }; anything else is empty. */
export function docIdsOf(raw: unknown): string[] {
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.docIds) ? (raw as any).docIds : Array.isArray((raw as any)?.rows) ? (raw as any).rows : [];
  const out: string[] = []; const seen = new Set<string>();
  for (const x of list) { const id = typeof x === 'string' ? x : typeof (x as any)?.docId === 'string' ? (x as any).docId : ''; if (id && !seen.has(id)) { seen.add(id); out.push(id); } }
  return out;
}
const isoDay = (s: unknown): string => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '');
/** Shape check: only results with a docId, a market, a filedAt date and an array of rows are used. */
export function isExtractResult(x: any): x is GuidanceExtractResult {
  return !!x && typeof x === 'object' && typeof x.docId === 'string' && (x.market === 'IN' || x.market === 'US') && !!isoDay(x.filedAt) && Array.isArray(x.rows);
}
/** Newest first (filedAt, then extractedAt). */
export function sortResults(rs: GuidanceExtractResult[]): GuidanceExtractResult[] {
  return rs.slice().sort((a, b) => isoDay(b.filedAt).localeCompare(isoDay(a.filedAt)) || String(b.extractedAt || '').localeCompare(String(a.extractedAt || '')));
}

export interface ExtractList { results: GuidanceExtractResult[]; indexed: number; read: number; error?: string }
/** Every extract result (status ok with rows, unless `includeEmpty`), newest first, optionally one market. Bounded by `limit`. */
export async function listExtractResults(opts: { market?: 'IN' | 'US' | 'ALL'; limit?: number; includeEmpty?: boolean; io?: ExtractIo } = {}): Promise<ExtractList> {
  try {
    const io = opts.io ?? await defaultIo();
    const ids = docIdsOf(await io.get(EXTRACT_INDEX_KEY)).slice(0, Math.max(1, opts.limit ?? EXTRACT_READ_CAP));
    if (!ids.length) return { results: [], indexed: 0, read: 0 };
    const out: GuidanceExtractResult[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const got = await io.mget<GuidanceExtractResult>(ids.slice(i, i + 100).map(extractKey));
      for (const r of got || []) if (isExtractResult(r)) out.push(r);
    }
    const mk = opts.market && opts.market !== 'ALL' ? opts.market : null;
    const results = sortResults(out.filter((r) => (!mk || r.market === mk) && (opts.includeEmpty || (r.status === 'ok' && r.rows.length > 0))));
    return { results, indexed: ids.length, read: out.length };
  } catch (e: any) { return { results: [], indexed: 0, read: 0, error: String(e?.message || e).slice(0, 160) }; }
}
export async function getExtractResult(docId: string, io?: ExtractIo): Promise<GuidanceExtractResult | null> {
  try { const r = await (io ?? await defaultIo()).get(extractKey(docId)); return isExtractResult(r) ? r : null; } catch { return null; }
}

export interface ExtractCoverage { docs: number; extracted: number; rows: number; lastExtractAt: string | null; error?: string; /** zzz860: per-market data quality (documents discovered / processed / pending, days covered) */ quality?: import('./guidance-pipeline-coverage').GuDataQuality }
/** Coverage for the UI: documents collected, documents with an extract result, extracted rows, newest extraction time. */
export function coverageOf(docsIndex: unknown, results: GuidanceExtractResult[], indexed: number): ExtractCoverage {
  const rows = Array.isArray((docsIndex as any)?.rows) ? (docsIndex as any).rows : [];
  let last: string | null = null; let n = 0;
  for (const r of results) { n += Array.isArray(r.rows) ? r.rows.length : 0; if (r.extractedAt && (!last || r.extractedAt > last)) last = r.extractedAt; }
  return { docs: rows.length, extracted: Math.max(indexed, results.length), rows: n, lastExtractAt: last };
}

// ═══ prior fiscal-year actual (the base of a '(derived)' growth %) ═══════════════════════════════
export interface PriorActual { market: 'IN' | 'US'; ticker: string; metric: 'REVENUE' | 'PAT'; period: string; value: number; unit: string; source: string; quote?: string | null }
export const actualKey = (market: string, ticker: string, metric: string, period: string) => `${market}|${String(ticker).toUpperCase()}|${metric}|${period}`;
/** 'FY27' -> 'FY26', 'CY2026'/'CY26' -> 'CY25'. Anything else -> null. */
export function priorPeriodOf(period: string): string | null {
  const m = /^(FY|CY)\s?(?:20)?(\d{2})$/i.exec(String(period || '').trim());
  if (!m) return null;
  const y = parseInt(m[2], 10) - 1; return y >= 0 ? `${m[1].toUpperCase()}${String(y).padStart(2, '0')}` : null;
}
const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** 'Mar 2026' -> 2026*12+3 */
const monthIdx = (s: string): number | null => { const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(String(s || '').trim()); if (!m || !MON[m[1].toLowerCase()]) return null; return parseInt(m[2], 10) * 12 + MON[m[1].toLowerCase()]; };
/**
 * Sum of the four reported quarters that make up `period`, matched by DATE (never by position). India FY26 = quarters ending Jun 2025, Sep 2025,
 * Dec 2025, Mar 2026; a calendar year CY25 = Mar, Jun, Sep, Dec 2025. A US 'FY' has no known fiscal calendar here -> null. Any quarter missing -> null.
 */
export function fyActualFromDatedSeries(values: unknown, dates: unknown, period: string, market: 'IN' | 'US'): number | null {
  if (!Array.isArray(values) || !Array.isArray(dates) || values.length !== dates.length) return null;
  const m = /^(FY|CY)(\d{2})$/.exec(period); if (!m) return null;
  const y = 2000 + parseInt(m[2], 10);
  let ends: number[];
  if (m[1] === 'FY' && market === 'IN') ends = [(y - 1) * 12 + 6, (y - 1) * 12 + 9, (y - 1) * 12 + 12, y * 12 + 3];
  else if (m[1] === 'CY') ends = [y * 12 + 3, y * 12 + 6, y * 12 + 9, y * 12 + 12];
  else return null;
  let sum = 0;
  for (const e of ends) {
    const i = dates.findIndex((d) => monthIdx(String(d)) === e);
    const v = i >= 0 ? values[i] : null;
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    sum += v;
  }
  return Math.round(sum * 100) / 100;
}
/** The universe unit of an extracted amount ('INR'+'crore' -> '₹ Cr', 'USD'+'million' -> '$M'), or null when it cannot be placed. */
export function universeUnitOf(currency: string | null | undefined, unit: string | null | undefined): string | null {
  const c = String(currency || '').toUpperCase(); const u = String(unit || '').toLowerCase().replace(/s$/, '');
  if (u === 'per_share') return c === 'INR' ? '₹' : c === 'USD' ? '$' : null;
  if (u === 'crore' || u === 'cr') return c === 'USD' ? null : '₹ Cr';
  if (u === 'lakh crore') return null;
  if (u === 'million' || u === 'mn' || u === 'm') return c === 'INR' ? null : '$M';
  if (u === 'billion' || u === 'bn' || u === 'b') return c === 'INR' ? null : '$B';
  return null;
}
/** Actuals the documents THEMSELVES state (row.priorActual). Keyed by actualKey(market, ticker, metric, period). */
export function actualsFromDocs(results: GuidanceExtractResult[]): Map<string, PriorActual> {
  const out = new Map<string, PriorActual>();
  for (const r of sortResults(results)) {
    if (!r.ticker) continue;
    for (const row of r.rows as ExtractedGuidance[]) {
      const pa = row.priorActual; if (!pa || typeof pa.value !== 'number' || !(pa.value > 0)) continue;
      const metric = row.metric === 'REVENUE' ? 'REVENUE' : row.metric === 'PAT' ? 'PAT' : null; if (!metric) continue;
      const unit = universeUnitOf(row.currency, row.unit); const per = priorPeriodOf(pa.period) ? String(pa.period).replace(/^(FY|CY)\s?20(\d{2})$/i, '$1$2').toUpperCase() : null;
      if (!unit || !per) continue;
      const k = actualKey(r.market, r.ticker, metric, per);
      if (!out.has(k)) out.set(k, { market: r.market, ticker: r.ticker.toUpperCase(), metric, period: per, value: pa.value, unit, source: `${r.company} ${String(r.docKind || 'document').toLowerCase().replace(/_/g, ' ')} (${isoDay(r.filedAt)})`, quote: pa.quote || null });
    }
  }
  return out;
}
/**
 * Production loader: document-stated actuals first, then the India results cache (enrich:v18:<SYM>, dated quarterly series). Bounded; never throws.
 */
export async function loadPriorActuals(results: GuidanceExtractResult[], io?: ExtractIo): Promise<Map<string, PriorActual>> {
  const out = actualsFromDocs(results);
  try {
    const want = new Map<string, Set<string>>();   // ticker -> prior periods needed (India only: the results cache is India's)
    for (const r of results) {
      if (r.market !== 'IN' || !r.ticker) continue;
      for (const row of r.rows) {
        if (row.periodKind !== 'ANNUAL' || (row.metric !== 'REVENUE' && row.metric !== 'PAT')) continue;
        const pp = priorPeriodOf(row.period); if (!pp) continue;
        if (out.has(actualKey('IN', r.ticker, row.metric, pp))) continue;
        const t = r.ticker.toUpperCase(); (want.get(t) || want.set(t, new Set()).get(t)!).add(pp);
      }
    }
    const tickers = Array.from(want.keys()).slice(0, 150);
    if (!tickers.length) return out;
    const kv = io ?? await defaultIo();
    const rows = await kv.mget<any>(tickers.map((t) => `enrich:v18:${t}`));
    tickers.forEach((t, i) => {
      const e = rows?.[i]; if (!e || typeof e !== 'object') return;
      for (const pp of Array.from(want.get(t) || [])) {
        for (const [metric, field] of [['REVENUE', 'quarters_sales'], ['PAT', 'quarters_pat']] as const) {
          const v = fyActualFromDatedSeries(e[field], e.quarters_dates, pp, 'IN');
          const k = actualKey('IN', t, metric, pp);
          if (v != null && v > 0 && !out.has(k)) out.set(k, { market: 'IN', ticker: t, metric, period: pp, value: v, unit: '₹ Cr', source: 'results cache (sum of the four reported quarters)' });
        }
      }
    });
  } catch { /* best effort: no actual = growth not established */ }
  return out;
}

/** Everything the universe and the events need, in one bounded read. */
export async function loadExtractedForUniverse(io?: ExtractIo): Promise<{ results: GuidanceExtractResult[]; actuals: Map<string, PriorActual>; coverage: ExtractCoverage }> {
  const x = io ?? await defaultIo().catch(() => null as unknown as ExtractIo);
  if (!x) return { results: [], actuals: new Map(), coverage: { docs: 0, extracted: 0, rows: 0, lastExtractAt: null, error: 'KV unavailable' } };
  const [list, docsIdx] = await Promise.all([listExtractResults({ io: x }), x.get(DOCS_INDEX_KEY).catch(() => null)]);
  const actuals = await loadPriorActuals(list.results, x);
  const coverage = coverageOf(docsIdx, list.results, list.indexed);
  try {   // zzz860: data quality per market (never throws; absent when the stores cannot be read)
    const [cIN, cUS] = await Promise.all([x.get(`guidance-docs:v1:coverage:IN`).catch(() => null), x.get(`guidance-docs:v1:coverage:US`).catch(() => null)]);
    const { dataQualityOf } = await import('./guidance-pipeline-coverage');
    const idxRows = Array.isArray((docsIdx as any)?.rows) ? (docsIdx as any).rows : [];
    // a doc counts as processed when its index flag says so OR an extract result exists for it
    const done = new Set(list.results.map((r) => r.docId));
    coverage.quality = dataQualityOf(idxRows.map((r: any) => (done.has(r.docId) ? { ...r, extracted: true } : r)), { IN: cIN as any, US: cUS as any }, new Date());
  } catch { /* quality is optional */ }
  return { results: list.results, actuals, coverage: list.error ? { ...coverage, error: list.error } : coverage };
}
