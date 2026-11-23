// zzz1291 — Market Leadership "Performance" and "Market cycles" tabs, server side. One market a call, cached by the route.
//   indices: benchmark + broad + sector indices / funds with 1D … 1Y returns (Yahoo daily closes, relay fallback)
//   themes:  every Theme Rotation theme with its member companies joined to the stock-screener snapshot
//   cycles:  weekly benchmark closes since the 1990s, bull runs / 20%+ busts, "led by" from sector histories
import { dailyHistory } from '../theme-cycle/server';
import { HISTORY_SETS } from '../theme-cycle/universe';
import { periodReturns, weeklyCloses, marketCycles, themeBoard, type Cycle, type PerfKey, type ThemePerf, type DaySeries } from './perf';

export const PERF_VERSION = 3;
type M = 'us' | 'india';
const INDICES: Record<M, Array<{ s: string; name: string; kind: 'Broad' | 'Size' | 'Sector' | 'Style' }>> = {
  us: [
    { s: '^GSPC', name: 'S&P 500', kind: 'Broad' }, { s: '^IXIC', name: 'Nasdaq Composite', kind: 'Broad' }, { s: '^NDX', name: 'Nasdaq 100', kind: 'Broad' },
    { s: '^DJI', name: 'Dow Jones', kind: 'Broad' }, { s: '^RUT', name: 'Russell 2000', kind: 'Size' }, { s: 'MDY', name: 'S&P MidCap 400', kind: 'Size' },
    { s: 'RSP', name: 'S&P 500 equal weight', kind: 'Style' }, { s: 'IWF', name: 'Russell 1000 Growth', kind: 'Style' }, { s: 'IWD', name: 'Russell 1000 Value', kind: 'Style' },
    { s: 'XLK', name: 'Technology', kind: 'Sector' }, { s: 'XLF', name: 'Financials', kind: 'Sector' }, { s: 'XLE', name: 'Energy', kind: 'Sector' },
    { s: 'XLV', name: 'Health care', kind: 'Sector' }, { s: 'XLI', name: 'Industrials', kind: 'Sector' }, { s: 'XLY', name: 'Consumer discretionary', kind: 'Sector' },
    { s: 'XLP', name: 'Consumer staples', kind: 'Sector' }, { s: 'XLU', name: 'Utilities', kind: 'Sector' }, { s: 'XLB', name: 'Materials', kind: 'Sector' },
    { s: 'XLRE', name: 'Real estate', kind: 'Sector' }, { s: 'XLC', name: 'Communication', kind: 'Sector' }, { s: 'SMH', name: 'Semiconductors', kind: 'Sector' },
    { s: 'IGV', name: 'Software', kind: 'Sector' }, { s: 'CIBR', name: 'Cybersecurity', kind: 'Sector' }, { s: 'ITA', name: 'Aerospace & defense', kind: 'Sector' },
    { s: 'XBI', name: 'Biotech', kind: 'Sector' }, { s: 'KRE', name: 'Regional banks', kind: 'Sector' }, { s: 'XHB', name: 'Homebuilders', kind: 'Sector' },
  ],
  india: [
    { s: '^NSEI', name: 'Nifty 50', kind: 'Broad' }, { s: '^BSESN', name: 'Sensex', kind: 'Broad' }, { s: '^CRSLDX', name: 'Nifty 500', kind: 'Broad' },
    { s: '^NSMIDCP', name: 'Nifty Next 50', kind: 'Size' }, { s: '^NSEMDCP50', name: 'Nifty Midcap 50', kind: 'Size' }, { s: 'HDFCSML250.NS', name: 'Nifty Smallcap 250 (ETF)', kind: 'Size' },
    { s: '^NSEBANK', name: 'Bank', kind: 'Sector' }, { s: '^CNXIT', name: 'IT', kind: 'Sector' }, { s: '^CNXAUTO', name: 'Auto', kind: 'Sector' },
    { s: '^CNXPHARMA', name: 'Pharma', kind: 'Sector' }, { s: '^CNXFMCG', name: 'FMCG', kind: 'Sector' }, { s: '^CNXMETAL', name: 'Metal', kind: 'Sector' },
    { s: '^CNXREALTY', name: 'Realty', kind: 'Sector' }, { s: '^CNXENERGY', name: 'Energy', kind: 'Sector' }, { s: '^CNXINFRA', name: 'Infrastructure', kind: 'Sector' },
    { s: '^CNXPSE', name: 'PSE', kind: 'Sector' }, { s: '^CNXPSUBANK', name: 'PSU Bank', kind: 'Sector' },
    { s: '^CNXCONSUM', name: 'Consumption', kind: 'Sector' }, { s: '^CNXMNC', name: 'MNC', kind: 'Sector' },
  ],
};
export interface IndexPerf { s: string; name: string; kind: string; last: number | null; at: string | null; r: Record<PerfKey, number | null>; spark: number[] }
export interface PerfPayload {
  market: M; builtAt: string; version: number;
  indices: IndexPerf[]; themes: ThemePerf[];
  cycles: { bench: string; benchName: string; weekly: DaySeries; list: Cycle[]; from: string | null } | null;
  missing: string[];
}
// long histories (cycles) change once a day: kept 12 hours in memory so the hourly rebuild does not refetch ~40 full histories
const longMemo = new Map<string, { at: number; s: DaySeries | null }>();
async function longHistory(sym: string): Promise<DaySeries | null> {
  const hit = longMemo.get(sym);
  if (hit && Date.now() - hit.at < 12 * 3600_000 && hit.s) return hit.s;
  const s = await dailyHistory(sym, 0);
  if (longMemo.size > 120) longMemo.clear();
  longMemo.set(sym, { at: Date.now(), s });
  return s;
}
async function pool<T, R>(xs: T[], k: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(k, xs.length) }, async () => { while (i < xs.length) { const j = i++; out[j] = await f(xs[j]).catch(() => null as any); } }));
  return out;
}

export async function buildPerf(m: M): Promise<PerfPayload> {
  const missing: string[] = [];
  const twoY = Math.floor(Date.now() / 1000) - 800 * 86_400;
  const idx = await pool(INDICES[m], 4, async (x) => {
    const s = await dailyHistory(x.s, twoY);
    if (!s?.c?.length) missing.push(x.name);
    const r = periodReturns(s);
    const spark = s ? s.c.slice(-130).filter((_, i, a) => (a.length - 1 - i) % 5 === 0) : [];
    return { s: x.s, name: x.name, kind: x.kind, last: r.last, at: r.at, r: { d1: r.d1, w1: r.w1, m1: r.m1, m3: r.m3, m6: r.m6, ytd: r.ytd, y1: r.y1 }, spark } as IndexPerf;
  });
  // themes: Theme Rotation's themes and members, joined to the stock-screener snapshot
  const [{ themesForRegion, drillSymbolsFor }, { getSnapshot }, { rsRanks }] = await Promise.all([import('../theme-universe'), import('../screener/snapshot-cache'), import('../screener/rs-rank')]);
  const snap = await getSnapshot(m === 'us' ? 'US' : 'IN');
  const rows: any[] = snap?.rows || [];
  const defs = themesForRegion(m).map((t) => ({ id: t.id, name: t.name, emoji: t.emoji, group: t.group, members: drillSymbolsFor(t) }));
  const themes = themeBoard(defs, rows, rsRanks(rows as any));
  // cycles: the longest benchmark history (Sensex from 1997 for India; S&P 500 for the USA), drawn weekly
  const set = HISTORY_SETS[m];
  const benchSym = m === 'india' ? '^BSESN' : '^GSPC', benchName = m === 'india' ? 'Sensex' : 'S&P 500';
  let cycles: PerfPayload['cycles'] = null;
  const long = await longHistory(benchSym);
  if (long?.c?.length) {
    const w = weeklyCloses(long);
    const sectors = await pool(set.sectors.filter((x) => x.index || x.basket), 3, async (x) => ({
      name: x.name, s: x.index ? await longHistory(x.index) : null,
      // zzz1291 — India before the NSE sector indices (2010–11): equal-weight basket of that time's large companies (marked *)
      ...(m === 'india' && x.basket?.length ? { members: await pool(x.basket, 3, (b) => longHistory(b)), until: set.basketUntil } : {}),
    }));
    const { cycles: list } = marketCycles(w, sectors, m, 0.2);
    cycles = { bench: benchSym, benchName, weekly: { d: w.d, c: w.c.map((v) => Math.round(v * 100) / 100) }, list, from: w.d[0] ?? null };
  } else missing.push(`${benchName} history`);
  return { market: m, builtAt: new Date().toISOString(), version: PERF_VERSION, indices: idx.filter(Boolean), themes, cycles, missing };
}
