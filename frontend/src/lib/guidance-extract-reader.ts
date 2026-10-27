// zzz857 — read-only access to the AI-extracted, quote-checked guidance rows (written by the extractor, see guidance-docs-types.ts).
//   guidance-extract:v1:index        -> string[] docIds with a result (newest first)
//   guidance-extract:v1:<docId>      -> GuidanceExtractResult
//   guidance-docs:v1:index           -> GuidanceDocIndex (for coverage counts only)
// Plus the PRIOR fiscal year's ACTUAL a derived growth % is divided by: the document's own stated actual (row.priorActual), else a
// date-matched sum of four reported quarters from the results cache (enrich:v18:<SYM> quarters_sales / quarters_pat + quarters_dates).
// Nothing is guessed: a missing quarter, an undated series or a period that cannot be placed returns no actual ('Not established').
// Never throws: every reader returns empty on failure and says so.
import type { ExtractedGuidance, GuidanceExtractResult } from './guidance-docs-types';
import { lastCompletedFy } from './guidance-horizon';

export const EXTRACT_INDEX_KEY = 'guidance-extract:v1:index';
export const extractKey = (docId: string) => `guidance-extract:v1:${docId}`;
export const DOCS_INDEX_KEY = 'guidance-docs:v1:index';
export const EXTRACT_READ_CAP = 600;
/** zzz873: docIds whose result is status 'ok' with rows (the ones the universe uses), newest extraction first. Written by the extractor
 *  (runExtraction) and rebuilt from the main index once when missing. Lets the readers see EVERY useful result instead of only the
 *  600 most recently extracted documents of all statuses (a 3,000-document backlog run would otherwise hide most of its own findings). */
export const EXTRACT_OK_INDEX_KEY = 'guidance-extract:v1:index:ok';
export const EXTRACT_OK_READ_CAP = 2_500;
const MGET_CONCURRENCY = 4;

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
    const { MARKET_INDEX_KEY, MARKET_STATE_KEY, idsToRead } = await import('./guidance-extract-market-index');
    const [mainRaw, okRaw, inRaw, usRaw, stRaw] = await Promise.all([io.get(EXTRACT_INDEX_KEY), io.get(EXTRACT_OK_INDEX_KEY),
      io.get(MARKET_INDEX_KEY('IN')).catch(() => null), io.get(MARKET_INDEX_KEY('US')).catch(() => null), io.get(MARKET_STATE_KEY).catch(() => null)]);
    const main = docIdsOf(mainRaw).slice(0, Math.max(1, opts.limit ?? EXTRACT_READ_CAP));
    // zzz926: the per-market lists hold EVERY kept result of a market (the shared list was cut at its newest 2,500, which hid India's
    // older calls — the earlier guidance a later call is compared with). An explicit `limit` keeps the old shared-list behaviour.
    const okIds = okRaw == null && inRaw == null && usRaw == null ? null
      : opts.limit != null ? docIdsOf(okRaw).slice(0, Math.max(1, opts.limit))
      : idsToRead({ market: opts.market ?? 'ALL', shared: okRaw == null ? null : docIdsOf(okRaw), sharedCap: EXTRACT_OK_READ_CAP,
          IN: Array.isArray(inRaw) ? docIdsOf(inRaw) : null, US: Array.isArray(usRaw) ? docIdsOf(usRaw) : null, state: stRaw });
    // zzz873: results with rows come from the ok index (every useful result); the recent main index adds the empty / error results when asked
    const ids = okIds == null ? main : opts.includeEmpty ? Array.from(new Set([...okIds, ...main])) : okIds;
    if (!ids.length) return { results: [], indexed: 0, read: 0 };
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
    const out: GuidanceExtractResult[] = [];
    for (let i = 0; i < chunks.length; i += MGET_CONCURRENCY) {
      const got = await Promise.all(chunks.slice(i, i + MGET_CONCURRENCY).map((c) => io.mget<GuidanceExtractResult>(c.map(extractKey)).catch(() => [] as Array<GuidanceExtractResult | null>)));
      for (const g of got) for (const r of g || []) if (isExtractResult(r)) out.push(r);
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
/**
 * zzz916: the base year for a target two or more fiscal years after the document: the last COMPLETED Indian fiscal year on the document
 * date ('FY29' guided in Aug 2026 → 'FY26'). Null for a one-year-ahead target (its base is the prior year, priorPeriodOf) or a bad period.
 */
export function baseFyFor(period: string, filedAt: string | null | undefined): string | null {
  const m = /^FY\s?(?:20)?(\d{2})$/i.exec(String(period || '').trim()); if (!m) return null;
  const lc = lastCompletedFy(filedAt); if (lc == null) return null;
  const y = parseInt(m[1], 10);
  return y - lc >= 2 && y - lc <= 8 ? `FY${String(lc).padStart(2, '0')}` : null;
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
/** zzz1189 — the India stock-screener rows, registered by the server at start (instrumentation): this module is also bundled for the
 *  browser, so it cannot import the snapshot reader itself. */
// zzz1193 — kept on globalThis: instrumentation.ts and the API routes are separate server bundles, each with its own copy of this
// module, so a module variable set at start was never seen by the routes (the fallback never ran in production)
const SRC_SLOT = '__mcGuidanceScreenerRows';
export function setScreenerRowsSource(fn: () => Promise<any[]>): void { (globalThis as any)[SRC_SLOT] = fn; }
function screenerRowsFn(): (() => Promise<any[]>) | null { const f = (globalThis as any)[SRC_SLOT]; return typeof f === 'function' ? f : null; }
export async function loadPriorActuals(results: GuidanceExtractResult[], io?: ExtractIo): Promise<Map<string, PriorActual>> {
  const out = actualsFromDocs(results);
  try {
    const want = new Map<string, Set<string>>();   // ticker -> prior periods needed (India only: the results cache is India's)
    for (const r of results) {
      if (r.market !== 'IN' || !r.ticker) continue;
      for (const row of r.rows) {
        if (row.periodKind !== 'ANNUAL' || (row.metric !== 'REVENUE' && row.metric !== 'PAT')) continue;
        const pp = priorPeriodOf(row.period); if (!pp) continue;
        const t = r.ticker.toUpperCase();
        // zzz916: a target two or more years out ("₹2,000 Cr by FY29") is set against the last COMPLETED year at the document date (FY26)
        const lc = baseFyFor(row.period, r.filedAt);
        if (lc && !out.has(actualKey('IN', r.ticker, row.metric, lc))) (want.get(t) || want.set(t, new Set()).get(t)!).add(lc);
        if (out.has(actualKey('IN', r.ticker, row.metric, pp))) continue;
        (want.get(t) || want.set(t, new Set()).get(t)!).add(pp);
      }
    }
    // zzz1189 — every India company that needs a base, not the first 150 (most of a results season's guidance was left as "growth not
    // established"), read in chunks of 150
    const tickers = Array.from(want.keys()).slice(0, 1500);
    if (!tickers.length) return out;
    const kv = io ?? await defaultIo();
    const rows: any[] = [];
    for (let i = 0; i < tickers.length; i += 150) rows.push(...((await kv.mget<any>(tickers.slice(i, i + 150).map((t) => `enrich:v18:${t}`))) || []));
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
    // zzz1189 — a company without a results-cache entry: the stock screener's figures (yearly profit; sales = market cap ÷ P/S, the
    // trailing twelve months) stand in for the last completed year — labelled as such, used only for that one base year
    const screenerRowsSource = screenerRowsFn();
    if (screenerRowsSource) {   // zzz1190 — the universe passes its own KV reader, so the fallback keys on the registered source, not on io
      const missing = tickers.filter((t) => Array.from(want.get(t) || []).some((pp) => !out.has(actualKey('IN', t, 'REVENUE', pp)) || !out.has(actualKey('IN', t, 'PAT', pp))));
      if (missing.length) {
        const snapRows: any[] = screenerRowsSource ? ((await Promise.race([screenerRowsSource().catch(() => []), new Promise((r) => setTimeout(() => r([]), 4000))])) as any[]) : [];
        const by = new Map<string, any>((snapRows || []).map((r) => [String(r.t).toUpperCase(), r]));
        const lastFy = (() => { const d = new Date(); const y = d.getUTCFullYear() % 100; return `FY${String(d.getUTCMonth() >= 3 ? y : y - 1).padStart(2, '0')}`; })();
        for (const t of missing) {
          const r = by.get(t); if (!r) continue;
          for (const pp of Array.from(want.get(t) || [])) {
            if (pp !== lastFy) continue;
            const sales = typeof r.mc === 'number' && typeof r.ps === 'number' && r.ps > 0 ? Math.round(r.mc / r.ps) : null;
            if (sales && !out.has(actualKey('IN', t, 'REVENUE', pp))) out.set(actualKey('IN', t, 'REVENUE', pp), { market: 'IN', ticker: t, metric: 'REVENUE', period: pp, value: sales, unit: '₹ Cr', source: 'stock screener (trailing twelve months sales, standing in for the last completed year)' });
            if (typeof r.niFY === 'number' && r.niFY > 0 && !out.has(actualKey('IN', t, 'PAT', pp))) out.set(actualKey('IN', t, 'PAT', pp), { market: 'IN', ticker: t, metric: 'PAT', period: pp, value: r.niFY, unit: '₹ Cr', source: 'stock screener (last full year net profit)' });
          }
        }
      }
    }
  } catch { /* best effort: no actual = growth not established */ }
  return out;
}

/** Everything the universe and the events need, in one bounded read. */
// ── zzz880 — THE UNIVERSE NEVER LOSES ITS COMPANY DOCUMENTS TO A SLOW READ ──────────────────────
// ~2,500 extract results now take longer than the universe's old 5 s limit; a missed read built the list without them and India
// (all of it from company documents) vanished. The last complete read is kept in memory: served at once while it is fresh, and while a
// refresh runs in the background once it is older; a read that fails falls back to it.
type XLoad = { results: GuidanceExtractResult[]; actuals: Map<string, PriorActual>; coverage: ExtractCoverage };
let _xMemo: { at: number; v: XLoad } | null = null;
let _xInflight: Promise<XLoad> | null = null;
export const X_MEMO_FRESH_MS = 10 * 60_000;
export const X_MEMO_MAX_MS = 12 * 3_600_000;
function refreshExtracted(): Promise<XLoad> {
  if (_xInflight) return _xInflight;
  _xInflight = loadExtractedForUniverseRaw()
    .then((v) => { if (!v.coverage.error && v.results.length) _xMemo = { at: Date.now(), v }; return v; })
    .finally(() => { _xInflight = null; });
  return _xInflight;
}
/** Cached + stale-while-revalidate wrapper (default store only; an injected io always reads directly). */
export async function loadExtractedForUniverse(io?: ExtractIo): Promise<XLoad> {
  if (io) return loadExtractedForUniverseRaw(io);
  const age = _xMemo ? Date.now() - _xMemo.at : Infinity;
  if (_xMemo && age < X_MEMO_FRESH_MS) return _xMemo.v;
  if (_xMemo && age < X_MEMO_MAX_MS) { void refreshExtracted().catch(() => null); return _xMemo.v; }
  const v = await refreshExtracted().catch((e: any) => ({ results: [], actuals: new Map(), coverage: { docs: 0, extracted: 0, rows: 0, lastExtractAt: null, error: String(e?.message || e).slice(0, 160) } } as XLoad));
  return v.coverage.error && _xMemo ? _xMemo.v : v;
}
/** Test helper. */
export function _resetExtractMemo(): void { _xMemo = null; _xInflight = null; }
async function loadExtractedForUniverseRaw(io?: ExtractIo): Promise<XLoad> {
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
