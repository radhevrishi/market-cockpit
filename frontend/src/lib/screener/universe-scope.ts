// zzz1083 — Stock Screener "Companies" control (retest improvement 1): run the screen's rules on ALL companies or only on one of
// the owner's own lists — My portfolio, Conviction Beats, the Watchlists page list, flagged chart-list companies, or one chart
// watchlist. The list and the rules are combined with AND: a company must be in the list AND pass every rule.
//
// Identity follows B01 (lib/instrument-id): a chart-list item carries its market; a Watchlists-page symbol carries one only when
// written with a prefix (NSE:/BSE:/US:…). A bare symbol is matched in the market being screened and reported as "market not
// written" — never quietly treated as India or USA. Pure: the page passes the lists in.
import { parseListSymbol } from '../instrument-id';
import { normTicker } from './pine-handoff';
import type { ScreenMarket, ScreenRow } from './types';

export const UNIVERSE_KEY = 'mc:stock-screener:universe:v1';   // per market: { IN: 'pf', US: 'all' } — this browser only

export interface UniverseSources {
  /** chart watchlists (the Charts page lists) */
  chartLists: { id: string; name: string; sections: { items: { m: 'IN' | 'US'; t: string; flag?: string }[] }[] }[] | null;
  /** the Watchlists page list (plain text symbols) */
  standalone: readonly string[];
  /** holdings of this market; null = still being read */
  portfolio: readonly string[] | null;
  portfolioError?: string | null;
  /** Conviction Beats bench (India) */
  cb: readonly string[];
}

export interface UniverseOption { id: string; label: string; count: number | null }

/** The choices for this market, with how many companies each list holds (null = still being read). */
export function universeOptions(market: ScreenMarket, src: UniverseSources): UniverseOption[] {
  const out: UniverseOption[] = [{ id: 'all', label: 'All companies', count: null }];
  out.push({ id: 'pf', label: 'My portfolio', count: src.portfolio ? new Set(src.portfolio.map(normTicker)).size : null });
  if (market === 'IN') out.push({ id: 'cb', label: 'Conviction Beats', count: new Set(src.cb.map(normTicker)).size });
  out.push({ id: 'watch', label: 'Watchlists page list', count: standaloneFor(market, src.standalone).tickers.size });
  out.push({ id: 'flagged', label: 'Flagged in my chart lists', count: flaggedFor(market, src.chartLists).size });
  for (const l of src.chartLists || []) out.push({ id: `wl:${l.id}`, label: `Chart list: ${l.name}`, count: chartListFor(market, l).size });
  return out;
}

function standaloneFor(market: ScreenMarket, list: readonly string[]): { tickers: Set<string>; bare: string[] } {
  const tickers = new Set<string>(); const bare: string[] = [];
  for (const raw of list) {
    const i = parseListSymbol(String(raw));
    if (!i.t) continue;
    if (i.m === market) tickers.add(normTicker(i.t));
    else if (i.m == null) { tickers.add(normTicker(i.t)); bare.push(normTicker(i.t)); }
  }
  return { tickers, bare };
}
function chartListFor(market: ScreenMarket, l: NonNullable<UniverseSources['chartLists']>[number]): Set<string> {
  const s = new Set<string>();
  for (const sec of l.sections) for (const it of sec.items) if (it.m === market) s.add(normTicker(it.t));
  return s;
}
function flaggedFor(market: ScreenMarket, lists: UniverseSources['chartLists']): Set<string> {
  const s = new Set<string>();
  for (const l of lists || []) for (const sec of l.sections) for (const it of sec.items) if (it.m === market && it.flag) s.add(normTicker(it.t));
  return s;
}

export interface UniverseSet {
  /** null = every company */
  set: Set<string> | null;
  label: string;
  /** the list is still being read */
  waiting: boolean;
  /** Watchlists-page symbols written without a market (matched in this market only if this market has them) */
  bare: string[];
  error: string | null;
}

export function universeSet(id: string, market: ScreenMarket, src: UniverseSources): UniverseSet {
  const none = (label: string): UniverseSet => ({ set: new Set(), label, waiting: false, bare: [], error: null });
  if (!id || id === 'all') return { set: null, label: 'All companies', waiting: false, bare: [], error: null };
  if (id === 'pf') {
    if (!src.portfolio) return { set: new Set(), label: 'My portfolio', waiting: true, bare: [], error: null };
    return { set: new Set(src.portfolio.map(normTicker)), label: 'My portfolio', waiting: false, bare: [], error: src.portfolioError || null };
  }
  if (id === 'cb') return market === 'IN' ? { set: new Set(src.cb.map(normTicker)), label: 'Conviction Beats', waiting: false, bare: [], error: null } : none('Conviction Beats (India only)');
  if (id === 'watch') { const s = standaloneFor(market, src.standalone); return { set: s.tickers, label: 'Watchlists page list', waiting: false, bare: s.bare, error: null }; }
  if (id === 'flagged') return { set: flaggedFor(market, src.chartLists), label: 'Flagged in my chart lists', waiting: !src.chartLists, bare: [], error: null };
  if (id.startsWith('wl:')) {
    if (!src.chartLists) return { set: new Set(), label: 'Chart list', waiting: true, bare: [], error: null };
    const l = src.chartLists.find((x) => `wl:${x.id}` === id);
    return l ? { set: chartListFor(market, l), label: `Chart list: ${l.name}`, waiting: false, bare: [], error: null } : none('A chart list that no longer exists');
  }
  return { set: null, label: 'All companies', waiting: false, bare: [], error: null };
}

export interface ScopedRows<R> { rows: R[]; inList: number; found: number; missing: string[]; bareFound: string[] }

/** Keep only the rows of the list (AND with the screen's rules, which run after this). `missing` = list companies the screener
 *  has no data for in this market (never silently dropped). */
export function applyUniverse<R extends Pick<ScreenRow, 't'>>(rows: readonly R[], u: UniverseSet): ScopedRows<R> {
  if (!u.set) return { rows: rows as R[], inList: rows.length, found: rows.length, missing: [], bareFound: [] };
  const have = new Set<string>();
  const out: R[] = [];
  for (const r of rows) { const k = normTicker(r.t); if (u.set.has(k)) { out.push(r); have.add(k); } }
  const bare = new Set(u.bare);
  const missing = Array.from(u.set).filter((t) => !have.has(t) && !bare.has(t)).sort();
  return { rows: out, inList: u.set.size, found: have.size, missing, bareFound: u.bare.filter((t) => have.has(t)) };
}

/** One plain line for the results header. */
export function universeLine(u: UniverseSet, s: ScopedRows<unknown>, market: ScreenMarket): string {
  if (!u.set) return '';
  const where = market === 'IN' ? 'India' : 'USA';
  if (u.waiting) return `${u.label}: still being read…`;
  if (!u.set.size) return `${u.label} has no ${where} companies.`;
  const parts = [`Screening only ${u.label} — ${s.found} of ${u.set.size} companies have ${where} screener data; the rules below must ALSO pass.`];
  if (s.missing.length) parts.push(`No data for: ${s.missing.slice(0, 12).join(', ')}${s.missing.length > 12 ? ` +${s.missing.length - 12} more` : ''}.`);
  if (s.bareFound.length) parts.push(`Market not written on the Watchlists page (matched in ${where}): ${s.bareFound.slice(0, 8).join(', ')}${s.bareFound.length > 8 ? '…' : ''} — write NSE:X or US:X to be sure.`);
  return parts.join(' ');
}

export function readUniverse(market: ScreenMarket): string {
  try { const o = JSON.parse(localStorage.getItem(UNIVERSE_KEY) || '{}'); return typeof o?.[market] === 'string' ? o[market] : 'all'; } catch { return 'all'; }
}
export function writeUniverse(market: ScreenMarket, id: string): void {
  try { const o = JSON.parse(localStorage.getItem(UNIVERSE_KEY) || '{}') || {}; o[market] = id; localStorage.setItem(UNIVERSE_KEY, JSON.stringify(o)); } catch { /* storage full or blocked */ }
}
