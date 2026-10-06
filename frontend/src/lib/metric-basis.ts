// zzz904 — BASIS TAGS. Every figure on the Fundamentals analyzer says which period it comes from.
//
// A verdict that quietly mixes a last-full-year growth rate, a trailing-12-month margin and an analyst's forward P/E reads
// like one consistent picture when it is not. This module infers the basis of a figure from the CSV column it came from
// (TradingView / Screener.in export headers) and, when the header is silent, from the field name. Pure, no I/O.
//
//   REPORTED  latest reported quarter / latest filing (balance sheet, shareholding)
//   TTM       trailing twelve months
//   FY        a completed financial year (labelled FY<yy> when the year can be worked out)
//   ESTIMATE  analyst estimate / forward / target
//   GUIDED    the company's own guidance
//   DERIVED   computed here from figures with different bases
//   PRICE     market data (price, returns, moving averages, beta, market cap) — not an accounting period
//   UNKNOWN   the header and field name say nothing about the period

export type BasisKind = 'REPORTED' | 'TTM' | 'FY' | 'ESTIMATE' | 'GUIDED' | 'DERIVED' | 'PRICE' | 'UNKNOWN';
export type BasisMarket = 'INDIA' | 'USA';

export interface MetricBasis {
  kind: BasisKind;
  /** Short tag text, e.g. "TTM", "FY26", "3Y FY26", "EST". */
  label: string;
  /** Plain-English explanation for a tooltip. */
  title: string;
  /** Multi-year span, e.g. "3Y" for a 3-year CAGR. */
  span?: string;
  /** For DERIVED: the bases of the inputs. */
  parts?: BasisKind[];
}

export interface BasisOptions {
  market?: BasisMarket;
  /** Date the data refers to (defaults to "no year shown"). Used to name the latest completed FY. */
  asOf?: Date;
  /** Field name the value was stored under (fallback when the column header is silent). */
  fieldName?: string;
}

/**
 * Latest completed financial year as "FY<yy>", or "" when it cannot be worked out honestly.
 * India: the FY ends 31 March and annual results are out by end-May, so from June the just-ended year is the latest.
 * USA: company year-ends vary (Jan, Jun, Sep, Dec …), so no year is claimed.
 */
export function latestFyLabel(market: BasisMarket | undefined, asOf?: Date): string {
  if (!asOf || market !== 'INDIA' || isNaN(asOf.getTime())) return '';
  const y = asOf.getFullYear(), m = asOf.getMonth(); // 0 = Jan
  const fyEndYear = m >= 5 ? y : y - 1;
  return `FY${String(fyEndYear % 100).padStart(2, '0')}`;
}

const SHORT: Record<BasisKind, string> = {
  REPORTED: 'REPORTED', TTM: 'TTM', FY: 'FY', ESTIMATE: 'EST', GUIDED: 'GUIDED', DERIVED: 'DERIVED', PRICE: 'PRICE', UNKNOWN: '?',
};
const TITLE: Record<BasisKind, string> = {
  REPORTED: 'Reported — latest quarter / latest filing',
  TTM: 'TTM — trailing twelve months (last four quarters added up)',
  FY: 'FY — last completed financial year',
  ESTIMATE: 'Estimate — analysts’ forward figure, not reported',
  GUIDED: 'Guided — the company’s own outlook, not reported',
  DERIVED: 'Derived — calculated here from figures with different bases',
  PRICE: 'Price — market data, not an accounting period',
  UNKNOWN: 'Basis not stated in the source column',
};

export function makeBasis(kind: BasisKind, opts: BasisOptions & { span?: string; parts?: BasisKind[] } = {}): MetricBasis {
  let label = SHORT[kind];
  let title = TITLE[kind];
  if (kind === 'FY') {
    const fy = latestFyLabel(opts.market, opts.asOf);
    if (fy) { label = fy; title = `${fy} — last completed financial year (Apr–Mar)`; }
    else if (opts.market === 'USA') title = 'FY — company’s last completed fiscal year (year-end varies by company)';
  }
  if (opts.span) { label = `${opts.span} ${label}`; title = `${opts.span} span · ${title}`; }
  if (kind === 'DERIVED' && opts.parts?.length) title = `${title}: ${Array.from(new Set(opts.parts)).join(' + ')}`;
  return { kind, label, title, ...(opts.span ? { span: opts.span } : {}), ...(opts.parts ? { parts: Array.from(new Set(opts.parts)) } : {}) };
}

/**
 * Screener.in export headers carry no period words for several ratios. Basis per Screener's own definitions:
 * growth "Sales growth"/"Profit growth" compare the last two financial years; ROCE/ROE/ROIC/CFO-to-PAT use the last annual
 * accounts; "OPM" and "Price to Earning" are trailing twelve months; leverage and shareholding come from the latest filing.
 */
const SCREENER_EXACT: Record<string, BasisKind> = {
  'sales growth': 'FY', 'profit growth': 'FY',
  'return on capital employed': 'FY', 'return on invested capital': 'FY', 'return on equity': 'FY',
  'cfo to pat': 'FY', 'dividend payout': 'FY', 'dividend payout ratio': 'FY',
  'opm': 'TTM', 'price to earning': 'TTM', 'eps': 'TTM', 'sales': 'TTM', 'net profit': 'TTM', 'profit after tax': 'TTM',
  'debt to equity': 'REPORTED', 'debt': 'REPORTED', 'book value': 'REPORTED', 'price to book value': 'REPORTED',
  'peg ratio': 'DERIVED',
  'market capitalization': 'PRICE', 'current price': 'PRICE', 'return over 1year': 'PRICE', 'return over 3months': 'PRICE',
  'return over 6months': 'PRICE', 'dividend yield': 'PRICE',
};

function spanOf(c: string): string | undefined {
  const m = /(\d+)\s*-?\s*(?:years?|yrs?|y\b)/.exec(c);
  if (m && Number(m[1]) > 1) return `${Number(m[1])}Y`;
  return undefined;
}

/** Basis from a field name alone (camelCase / snake_case conventions used in this codebase). */
export function basisFromFieldName(field: string, opts: BasisOptions = {}): MetricBasis {
  const f = String(field || '');
  const lo = f.toLowerCase();
  const span = /(\d+)\s*y(?:r|ear)?s?/i.exec(f) ? `${/(\d+)\s*y/i.exec(f)![1]}Y` : undefined;
  const spanOk = span && span !== '1Y' ? span : undefined;
  if (/guid/.test(lo)) return makeBasis('GUIDED', opts);
  if (/fwd|forward|estimate|target|ntm/.test(lo)) return makeBasis('ESTIMATE', opts);
  if (/ttm|trailing|ltm/.test(lo)) return makeBasis('TTM', opts);
  if (/qtr|quarter|mrq/.test(lo)) return makeBasis('REPORTED', opts);
  if (/ann(ual)?(?![a-z])|ann[A-Z]?$|annual|fy|cagr/.test(lo) || /Ann(?:[A-Z]|$)/.test(f) || spanOk) return makeBasis('FY', { ...opts, span: spanOk });
  if (/^perf|ema|sma|dma|beta|mcap|marketcap|price|rsi/.test(lo)) return makeBasis('PRICE', opts);
  return makeBasis('UNKNOWN', opts);
}

/**
 * Basis of a figure from the CSV column header it was read from (TradingView or Screener.in). Falls back to the field
 * name when the header says nothing.
 */
export function inferBasis(columnName: string | undefined | null, opts: BasisOptions = {}): MetricBasis {
  const raw = String(columnName || '').trim();
  const c = raw.toLowerCase().replace(/\s+/g, ' ');
  if (!c) return opts.fieldName ? basisFromFieldName(opts.fieldName, opts) : makeBasis('UNKNOWN', opts);

  // 1. The company's own outlook.
  if (/\bguid(?:e|ed|ance)\b|management target|company target/.test(c)) return makeBasis('GUIDED', opts);
  // 2. Analyst / forward figures.
  if (/\bforward\b|\bfwd\b|next (?:fiscal )?year|next fy|\bestimates?\b|\bfy[12]\b|\bntm\b|consensus|target price|price target|analyst/.test(c)) {
    return makeBasis('ESTIMATE', opts);
  }
  // 3. Holdings / pledge — latest shareholding filing (a 3-year change is still a reported-filing figure, over a span).
  if (/holding|pledge|promoter|\bfii\b|\bdii\b|public share/.test(c)) return makeBasis('REPORTED', { ...opts, span: spanOf(c) });
  // 4. Explicit period words.
  if (/trailing 12|\bttm\b|last 12 months|\bltm\b/.test(c)) return makeBasis('TTM', opts);
  if (/quarterly|latest quarter|\bquarter\b|\bqtr\b|\bmrq\b/.test(c)) return makeBasis('REPORTED', opts);
  // 5. Market data (after valuation ratios, which also contain "price").
  const isValuationRatio = /price to |\bp\/[ebs]\b|\bpe\b|\bpeg\b|enterprise value to|ev\/|earning to growth/.test(c);
  if (!isValuationRatio && /performance|return over|^price$|current price|^close$|^last$|market cap|moving average|\bdma\b|\bema\b|\bsma\b|\bbeta\b|52.?week|\b52w\b|volatility|relative strength|\brsi\b|volume|change from|dividend yield/.test(c)) {
    return makeBasis('PRICE', opts);
  }
  if (/\bannual\b|\bfy\b|last year|preceding year|\byoy\b.*annual|\d+\s*-?\s*years?|cagr/.test(c)) return makeBasis('FY', { ...opts, span: spanOf(c) });
  // 6. Known Screener.in headers without period words.
  const exact = SCREENER_EXACT[c];
  if (exact) return makeBasis(exact, opts);
  // 7. Unqualified valuation ratios (TradingView "Price to earnings ratio", "Price to sales ratio") use trailing earnings /
  //    sales; price-to-book uses the latest balance sheet.
  if (isValuationRatio) return /book/.test(c) ? makeBasis('REPORTED', opts) : makeBasis('TTM', opts);
  if (opts.fieldName) return basisFromFieldName(opts.fieldName, opts);
  return makeBasis('UNKNOWN', opts);
}

/** First candidate column that exists in the headers, with its basis — mirrors `get(row, a, b, c)` fallbacks. */
export function basisForCandidates(headers: Iterable<string>, candidates: string[], opts: BasisOptions = {}): MetricBasis & { column: string | null } {
  const set = new Set(Array.from(headers));
  for (const k of candidates) if (set.has(k)) return { ...inferBasis(k, opts), column: k };
  return { ...inferBasis(candidates[0], opts), column: null };
}

/** Basis of a figure computed from several inputs: the shared basis when they agree, else DERIVED listing the inputs. */
export function combineBases(bases: MetricBasis[], opts: BasisOptions = {}): MetricBasis {
  const known = bases.filter((b) => b && b.kind !== 'UNKNOWN');
  if (!known.length) return makeBasis('UNKNOWN', opts);
  const kinds = Array.from(new Set(known.map((b) => b.kind)));
  const spans = Array.from(new Set(known.map((b) => b.span || '')));
  if (kinds.length === 1 && spans.length === 1) return { ...known[0] };
  return makeBasis('DERIVED', { ...opts, parts: known.map((b) => b.kind) });
}

const PHRASE: Record<BasisKind, string> = {
  REPORTED: 'latest-quarter', TTM: 'TTM', FY: 'full-year', ESTIMATE: 'forward', GUIDED: 'guided', DERIVED: 'derived',
  PRICE: 'market-price', UNKNOWN: 'unstated-basis',
};

/**
 * One sentence saying which bases a verdict combines, or null when every accounting figure shares one basis. Market data
 * (PRICE) is a different kind of input, not a period, so it never by itself makes a verdict "mixed".
 * e.g. [{name:'revenue growth', basis:TTM}, {name:'P/E', basis:ESTIMATE}] → "uses TTM revenue growth with forward P/E".
 */
export function describeBasisMix(items: Array<{ name: string; basis: MetricBasis }>): string | null {
  const acct = items.filter((i) => i.basis && i.basis.kind !== 'PRICE' && i.basis.kind !== 'UNKNOWN');
  const groups: Array<{ key: string; phrase: string; names: string[] }> = [];
  for (const it of acct) {
    const b = it.basis;
    const key = `${b.kind}|${b.label}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      const base = b.kind === 'FY' ? (/FY\d{2}$/.test(b.label) ? b.label.replace(/^\S+\s+/, '') : PHRASE.FY) : PHRASE[b.kind];
      g = { key, phrase: b.span ? `${b.span} ${base}` : base, names: [] }; groups.push(g);
    }
    if (!g.names.includes(it.name)) g.names.push(it.name);
  }
  if (groups.length <= 1) return null;
  const join = (xs: string[]) => xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
  const parts = groups.map((g) => `${g.phrase} ${join(g.names)}`);
  return `uses ${parts[0]} with ${join(parts.slice(1))}`;
}

/**
 * Does the field a value is stored under claim the same basis as the column it was filled from? Used to catch a field
 * named "...Ttm" filled from an "Annual" column, or "...3yr" filled from a "5 year CAGR" column.
 */
export function checkFieldLabel(fieldName: string, columnName: string, opts: BasisOptions = {}): { ok: boolean; field: MetricBasis; column: MetricBasis; reason?: string } {
  const field = basisFromFieldName(fieldName, opts);
  const column = inferBasis(columnName, opts);
  if (field.kind === 'UNKNOWN' || column.kind === 'UNKNOWN') return { ok: true, field, column };
  if (field.kind !== column.kind) return { ok: false, field, column, reason: `field "${fieldName}" says ${field.kind} but column "${columnName}" is ${column.kind}` };
  if (field.span && column.span && field.span !== column.span) return { ok: false, field, column, reason: `field "${fieldName}" says ${field.span} but column "${columnName}" is ${column.span}` };
  return { ok: true, field, column };
}
