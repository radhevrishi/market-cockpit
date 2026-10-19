// zzz1088 — the multi-chart page's state: 1, 2 or 4 charts side by side, each with its own symbol, market and timeframe (daily /
// weekly / monthly, or intraday 5 / 15 / 60 minutes with an optional session VWAP). "Same timeframe" makes one timeframe apply to
// every chart. Kept in this browser ('mc:multichart:v1'). Pure.
import { IN_TICKER_RE, US_TICKER_RE, type Market } from './chart-math';
import { isIntraday, type IntradayTf } from './intraday';

export type GridTf = 'D' | 'W' | 'M' | IntradayTf;
export const GRID_TFS: readonly GridTf[] = ['5m', '15m', '60m', 'D', 'W', 'M'];
export const GRID_TF_LABEL: Record<GridTf, string> = { '5m': '5m', '15m': '15m', '60m': '1h', D: 'D', W: 'W', M: 'M' };
export type GridCount = 1 | 2 | 4;
/** zzz1097 (retest R4) — `x`: the India listing (NSE / BSE). A BSE chart stays BSE through the grid, its data and links. */
export interface GridCell { t: string; m: Market; tf: GridTf; vwap: boolean; x?: 'NSE' | 'BSE' }
export interface GridState { n: GridCount; sync: boolean; cells: GridCell[] }
export const MULTICHART_KEY = 'mc:multichart:v1';

const DEFAULT_CELLS: GridCell[] = [
  { t: 'NIFTY', m: 'IN', tf: 'D', vwap: true },
  { t: 'SPY', m: 'US', tf: 'D', vwap: true },
  { t: 'QQQ', m: 'US', tf: '15m', vwap: true },
  { t: 'CNXSMALLCAP', m: 'IN', tf: 'D', vwap: true },
];
export const defaultGrid = (): GridState => ({ n: 2, sync: false, cells: DEFAULT_CELLS.map((c) => ({ ...c })) });

const isTf = (x: unknown): x is GridTf => typeof x === 'string' && (GRID_TFS as readonly string[]).includes(x);
export const validFor = (m: Market, t: string) => (m === 'IN' ? IN_TICKER_RE : US_TICKER_RE).test(t);

export function cleanGrid(raw: unknown): GridState {
  const d = defaultGrid();
  const x = (raw && typeof raw === 'object' ? raw : {}) as any;
  const n: GridCount = x.n === 1 || x.n === 4 ? x.n : 2;
  const cells: GridCell[] = [];
  for (let i = 0; i < 4; i++) {
    const c = Array.isArray(x.cells) ? x.cells[i] : null;
    const m: Market = c?.m === 'IN' ? 'IN' : c?.m === 'US' ? 'US' : d.cells[i].m;
    const t = typeof c?.t === 'string' ? c.t.trim().toUpperCase() : '';
    const ok = !!t && validFor(m, t);
    const ex: 'NSE' | 'BSE' | undefined = ok && m === 'IN' && (c?.x === 'BSE' || c?.x === 'NSE') ? c.x : undefined;
    cells.push({ t: ok ? t : d.cells[i].t, m: ok ? m : d.cells[i].m, tf: isTf(c?.tf) ? c.tf : d.cells[i].tf, vwap: typeof c?.vwap === 'boolean' ? c.vwap : true, ...(ex ? { x: ex } : {}) });
  }
  return { n, sync: !!x.sync, cells };
}

/** "?t=NVDA,AAPL&m=US" (or "NSE:HAL,US:NVDA") opens those symbols in the first charts. */
export function gridFromParams(base: GridState, tParam: string | null, mParam: string | null): GridState {
  if (!tParam) return base;
  const list = tParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 4);
  if (!list.length) return base;
  const def: Market = mParam === 'IN' ? 'IN' : 'US';
  const cells = base.cells.map((c) => ({ ...c }));
  list.forEach((raw, i) => {
    let m: Market = def, t = raw;
    let x: 'NSE' | 'BSE' | undefined;
    const p = raw.match(/^(NSE|BSE|US|NYSE|NASDAQ|AMEX):(.+)$/);
    if (p) { m = p[1] === 'NSE' || p[1] === 'BSE' ? 'IN' : 'US'; t = p[2]; if (p[1] === 'NSE' || p[1] === 'BSE') x = p[1]; }
    if (validFor(m, t)) { const { x: _old, ...rest } = cells[i]; void _old; cells[i] = { ...rest, t, m, ...(x ? { x } : {}) }; }
  });
  const n: GridCount = list.length >= 3 ? 4 : list.length === 2 ? Math.max(2, base.n) as GridCount : base.n;
  return { ...base, n, cells };
}

/** The data address for one chart. */
export function cellUrl(c: Pick<GridCell, 't' | 'm' | 'tf' | 'x'>): string {
  const t = encodeURIComponent(c.t);
  const ex = c.m === 'IN' && c.x ? `&exchange=${c.x}` : '';
  if (isIntraday(c.tf)) return `/api/v1/chart-intraday/${t}?market=${c.m}&interval=${c.tf}${ex}`;
  const interval = c.tf === 'D' ? '1d' : c.tf === 'W' ? '1wk' : '1mo';
  return `/api/v1/chart/${t}?market=${c.m}&interval=${interval}${ex}`;
}
/** The instrument as words and the full-chart link, both keeping the listing. */
export const cellLabel = (c: Pick<GridCell, 't' | 'm' | 'x'>) => (c.m === 'US' ? `US:${c.t}` : `${c.x || 'NSE'}:${c.t}`);
export const fullChartHref = (c: Pick<GridCell, 't' | 'm' | 'x' | 'tf'>) =>
  `/charts?t=${encodeURIComponent(c.t)}&m=${c.m}&tf=${isIntraday(c.tf) ? 'D' : c.tf}${c.m === 'IN' && c.x ? `&x=${c.x}` : ''}`;

export const EXCHANGE_TZ: Record<Market, string> = { IN: 'Asia/Kolkata', US: 'America/New_York' };

/** zzz1110 (deep audit N10) — what a poll of the SAME request may do with the chart. `tail`: every earlier candle is unchanged
 *  (timestamp AND open / high / low / close / volume), so only the last old candle and the new ones are pushed and the view keeps its
 *  zoom; `reload`: an earlier candle was corrected (a provider revision, a split / rebase) or the window moved — the whole set is
 *  redrawn (the page restores the zoom and scroll position). */
export type PollPlan = { kind: 'tail'; from: number } | { kind: 'reload' };
type PollBar = { timestamp: number; open: number; high: number; low: number; close: number; volume?: number };
const sameBar = (a: PollBar, b: PollBar | undefined) => !!b && a.timestamp === b.timestamp && a.open === b.open && a.high === b.high
  && a.low === b.low && a.close === b.close && (a.volume ?? 0) === (b.volume ?? 0);
export function pollPlan(prior: readonly PollBar[], next: readonly PollBar[]): PollPlan {
  if (!prior.length || !next.length || next.length < prior.length - 1) return { kind: 'reload' };
  for (let i = 0; i < prior.length - 1; i++) if (!sameBar(prior[i], next[i])) return { kind: 'reload' };
  if (next[prior.length - 1] && next[prior.length - 1].timestamp !== prior[prior.length - 1].timestamp) return { kind: 'reload' };
  return { kind: 'tail', from: prior.length - 1 };
}
