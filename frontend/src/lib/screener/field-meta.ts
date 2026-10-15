// zzz1045b — for each Stock Screener figure: which period it describes (latest session / latest quarter / TTM / latest full year …)
// and where it comes from (NSE / screener.in / SEC / Yahoo / Nasdaq), per market, plus the ≈ reason from FIELDS. Pure — used by the
// company details panel and the tests. Words only: nothing here changes a figure or a filter.
import type { ScreenMarket, ScreenRow } from './types';
import { fieldOf, fcfmSourceText, type NumKey } from './filters';

export type PeriodKind = 'session' | 'quarter' | 'ttm' | 'year' | 'mixed' | 'latest' | 'date';
export interface FieldMeta {
  /** short period words, e.g. 'latest quarter (Q2 2026)', 'TTM', 'latest full year' */
  period: string;
  kind: PeriodKind;
  /** where the figure comes from, e.g. 'SEC filings', 'NSE price file' */
  source: string;
  /** why the figure is worked out in a rougher way (FIELDS approxNote for this market), when there is a reason */
  approx?: string;
}

const QUARTER: ReadonlySet<string> = new Set(['revQYoY', 'gpQYoY', 'epsQYoY', 'ebitdaQoQ', 'ebitdaQYoY', 'de', 'netDebt', 'liabQ', 'debtAssetsQ', 'debtCapQ', 'debtEbitdaQ']);
const TTM: ReadonlySet<string> = new Set(['revTTMYoY', 'epsTTMYoY', 'ebitdaTTMYoY', 'opmTTM', 'ptmTTM', 'nmTTM', 'roeTTM', 'roceTTM', 'pe', 'ps', 'evRev']);
const YEAR: ReadonlySet<string> = new Set(['revAYoY', 'gpAYoY', 'ebitdaAYoY', 'gmFY', 'opmFY', 'roeFY', 'roceFY', 'deFY', 'liabA', 'debtAssetsA', 'debtCapA', 'debtEbitdaA', 'niFY', 'fcfEmp', 'bb', 'fs', 'fcfmTTM']);
/** the latest quote (not worked out from the daily bars) */
const QUOTE: ReadonlySet<string> = new Set(['px', 'chg', 'vol']);
const PROFILE: ReadonlySet<string> = new Set(['emp', 'flt']);

/** India: ROCE TTM is screener.in's ROCE of the latest year (see its approx note). */
function periodOf(k: string, market: ScreenMarket, row?: Partial<ScreenRow>): { kind: PeriodKind; period: string } {
  const q = row?.q ? ` (${row.q})` : '';
  const sess = row?.scanAt || row?.pxAt;
  if (k === 'r40') return { kind: 'mixed', period: `latest quarter's revenue growth${q} + latest full year's FCF margin` };
  if (k === 'fcfmTTM') return { kind: 'year', period: row?.fcfmAt ? `latest full year (to ${row.fcfmAt})` : 'latest full year' };
  if (k === 'roceTTM' && market === 'IN') return { kind: 'year', period: 'latest full year' };
  if (QUARTER.has(k)) return { kind: 'quarter', period: `latest quarter${q}` };
  if (TTM.has(k)) return { kind: 'ttm', period: k === 'pe' || k === 'ps' || k === 'evRev' ? `today's price ÷ last 4 quarters (TTM)${q}` : `last 4 quarters (TTM)${q}` };
  if (YEAR.has(k)) return { kind: 'year', period: 'latest full year' };
  if (k === 'pcf') return { kind: 'mixed', period: "today's price ÷ latest cash figure" };
  if (k === 'cash') return { kind: 'latest', period: 'latest balance sheet' };
  if (k === 'mc') return { kind: 'session', period: "today's price × shares" };
  if (PROFILE.has(k)) return { kind: 'latest', period: 'latest company profile' };
  if (k === 'ipoD' || k === 'earnD') return { kind: 'date', period: 'a date' };
  if (k === 'hi52') return { kind: 'session', period: `last 52 weeks${sess ? ` to ${sess}` : ''}` };
  if (k === 'chg') return { kind: 'session', period: `today vs the session before${row?.pxAt ? ` (${row.pxAt})` : ''}` };
  if (QUOTE.has(k)) return { kind: 'session', period: `latest session${row?.pxAt ? ` (${row.pxAt})` : ''}` };
  return { kind: 'session', period: `daily bars to the latest session${sess ? ` (${sess})` : ''}` };
}

function sourceOf(k: string, market: ScreenMarket, row?: Partial<ScreenRow>): string {
  const bars = market === 'US' ? 'Yahoo daily prices' : row?.scanSrc === 'yahoo' ? 'Yahoo daily prices' : 'Yahoo daily prices, with NSE official prices for the last 3 months';
  const quoteSrc = (): string => {
    if (row?.pxLive) return 'Yahoo (today\'s unfinished daily bar)';
    if (typeof row?.pxAlt === 'number') return 'Yahoo daily prices (last completed session)';
    if (market === 'US') return 'Nasdaq stock list';
    return 'NSE daily price file';
  };
  if (QUOTE.has(k)) return k === 'vol' ? (market === 'US' ? 'Nasdaq stock list' : 'NSE daily price file') : quoteSrc();
  if (k === 'mc') return market === 'US' ? 'Nasdaq stock list' : 'latest close (NSE price file, or the completed Yahoo close before NSE publishes) × share count from screener.in';
  if (PROFILE.has(k)) return 'Yahoo company profile';
  if (k === 'earnD') return 'screener.in';
  if (k === 'ipoD') return 'Yahoo price history';
  if (k === 'rsR') return `${bars}, ranked against this snapshot`;
  if (k === 'mrs') return `${bars} vs ${market === 'US' ? 'S&P 500' : 'Nifty 50'}`;
  if (k === 'pe' || k === 'ps' || k === 'evRev' || k === 'pcf') return market === 'US' ? 'Nasdaq market cap + SEC filings' : 'NSE price + screener.in';
  const d = fieldOf(k);
  const company = d && ['Growth', 'Margins & returns', 'Valuation', 'Balance sheet', 'Company'].includes(d.group);
  if (company) return market === 'US' ? 'SEC filings' : 'screener.in';
  return bars;
}

/** Period + source + ≈ reason for one field in one market (row adds the quarter / dates it knows). */
export function fieldMeta(key: NumKey | string, market: ScreenMarket, row?: Partial<ScreenRow>): FieldMeta {
  const { kind, period } = periodOf(key, market, row);
  const source = key === 'fcfmTTM' ? (market === 'US' ? fcfmSourceText(row || {}, market) : `screener.in, ${fcfmSourceText(row || {}, market)}`)
    : key === 'r40' ? `${sourceOf(key, market, row)} — FCF margin: ${fcfmSourceText(row || {}, market)}` : sourceOf(key, market, row);
  const approx = fieldOf(key)?.approxNote?.[market];
  return approx ? { period, kind, source, approx } : { period, kind, source };
}

/** One line for a tooltip: 'Latest quarter (Q2 2026) · SEC filings · ≈ reason' (≈ only when this company's figure is marked approximate). */
export function fieldMetaLine(key: NumKey | string, market: ScreenMarket, row?: Partial<ScreenRow>): string {
  const m = fieldMeta(key, market, row);
  const isApprox = !!row?.approx?.includes(key as string);
  const p = m.period.charAt(0).toUpperCase() + m.period.slice(1);
  return [p, m.source, isApprox && m.approx ? `≈ ${m.approx}` : isApprox ? '≈ worked out in a rougher way for this company' : ''].filter(Boolean).join(' · ');
}
