// zzz1000 (CW-01 / CW-04) — the standalone /watchlists table: unknown numbers stay unknown (null, never 0), and the Export
// button says which rows it writes (the filtered rows on screen, or the whole list). Pure functions; the page and its tests use
// the same code.

/** A finite number, else null. `positive` also turns 0 / negatives into null (a price, high or low of 0 means "not given"). */
export function numOrNull(v: unknown, opts: { positive?: boolean } = {}): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  if (opts.positive && n <= 0) return null;
  return n;
}

export interface QuoteNumbers { price: number | null; change: number | null; changePercent: number | null; dayHigh: number | null; dayLow: number | null }

/** The five quote numbers of one stock. Without a price the change is unknown too (not "flat"); with a price a reported
 *  0% change stays 0. High / low are taken only when the source gives them — never filled in from the price. */
export function quoteNumbers(q: { price?: unknown; change?: unknown; changePercent?: unknown; dayHigh?: unknown; dayLow?: unknown } | null | undefined): QuoteNumbers {
  const price = numOrNull(q?.price, { positive: true });
  return {
    price,
    change: price == null ? null : numOrNull(q?.change),
    changePercent: price == null ? null : numOrNull(q?.changePercent),
    dayHigh: numOrNull(q?.dayHigh, { positive: true }),
    dayLow: numOrNull(q?.dayLow, { positive: true }),
  };
}

export type ExportScope = 'filtered' | 'all';
/** With a search / filter on, Export writes what the table shows; the whole list stays one explicit click away. */
export function defaultExportScope(filterActive: boolean): ExportScope { return filterActive ? 'filtered' : 'all'; }

export interface ExportItem { ticker: string; company: string; sector: string; price: number | null; changePercent: number | null; dayHigh: number | null; dayLow: number | null }
export interface ExportMeta { search?: string; sortField?: string; sortOrder?: string; quotesAt?: Date | null; exportedAt?: Date }
export interface WatchlistExport { rows: Array<Record<string, string | number | null>>; info: Array<[string, string]>; scope: ExportScope; count: number; total: number }

const round2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

/** Rows for the sheet (null = blank cell) plus an "Export info" sheet: scope, search, sort and the quotes' as-of time.
 *  `all` and `visible` are both in the table's sort order, so the exported order matches the screen. */
export function buildWatchlistExport(all: ExportItem[], visible: ExportItem[], scope: ExportScope, meta: ExportMeta = {}): WatchlistExport {
  const items = scope === 'filtered' ? visible : all;
  const rows = items.map((item, i) => ({
    '#': i + 1,
    'Ticker': item.ticker,
    'Company': item.company,
    'Sector': item.sector,
    'CMP': numOrNull(item.price, { positive: true }),
    'Change %': round2(numOrNull(item.price, { positive: true }) == null ? null : numOrNull(item.changePercent)),
    'Day High': numOrNull(item.dayHigh, { positive: true }),
    'Day Low': numOrNull(item.dayLow, { positive: true }),
  }));
  const search = (meta.search || '').trim();
  const info: Array<[string, string]> = [
    ['Scope', scope === 'filtered' ? `Filtered rows: ${items.length} of ${all.length}` : `All rows: ${all.length}`],
    ['Search / filter', scope === 'filtered' && search ? search : search ? `(not applied — whole list exported; search was “${search}”)` : '(none)'],
    ['Sort', meta.sortField ? `${meta.sortField} ${meta.sortOrder || ''}`.trim() : '(list order)'],
    ['Quotes as of', meta.quotesAt ? meta.quotesAt.toISOString() : 'unknown'],
    ['Exported at', (meta.exportedAt || new Date()).toISOString()],
    ['Blank cell', 'value not available from the quote source (not zero)'],
  ];
  return { rows, info, scope, count: items.length, total: all.length };
}
