// zzz956 — the chart opens like the owner's TradingView layout: daily candles, about the last 3 months on screen
// (TradingView's daily zoom shows ~85 bars), and it remembers his last timeframe and the range he picked for each timeframe.
import { RANGE_KEYS, type RangeKey, type Timeframe } from './chart-math';

export const VIEW_KEY = 'mc:chart-view:v1';
export interface ChartView { tf: Timeframe; ranges: Record<Timeframe, RangeKey> }
export const DEFAULT_VIEW: ChartView = { tf: 'D', ranges: { D: '3M', W: '1Y', M: 'All' } };
const TFS: Timeframe[] = ['D', 'W', 'M'];

export function readView(raw: unknown): ChartView {
  const r: any = raw && typeof raw === 'object' ? raw : {};
  const tf = TFS.includes(r.tf) ? r.tf : DEFAULT_VIEW.tf;
  const ranges = { ...DEFAULT_VIEW.ranges };
  if (r.ranges && typeof r.ranges === 'object') for (const t of TFS) if (RANGE_KEYS.includes(r.ranges[t])) ranges[t] = r.ranges[t];
  return { tf, ranges };
}
export function loadView(): ChartView {
  try { return readView(JSON.parse(localStorage.getItem(VIEW_KEY) || 'null')); } catch { return DEFAULT_VIEW; }
}
export function saveView(v: ChartView): void {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* display preference only */ }
}
/** Empty space kept right of the last candle, in bars (TradingView keeps about 12 on its daily zoom). */
export const rightPadBars = (barsOnScreen: number) => Math.max(4, Math.min(12, Math.round(barsOnScreen * 0.14)));

// zzz960 — TradingView keeps a fixed gap between candles (the owner's daily chart uses 15 px per bar) and simply shows MORE history
// on a wider screen. Fitting exactly 3 months to a wide screen stretched each bar to 20–25 px, so the candles looked far apart.
// Ranges of 3 months and longer now never go wider than 15 px a bar; the extra room shows older candles. 1M still fits exactly.
export const MAX_FIT_BAR_SPACE = 15;
export function fitBarSpace(width: number, barsInRange: number, range: RangeKey): { space: number; pad: number } {
  const n = Math.max(8, barsInRange);
  let pad = rightPadBars(n);
  let space = width / (n + pad);
  if (range !== '1M' && space > MAX_FIT_BAR_SPACE) {
    space = MAX_FIT_BAR_SPACE;
    pad = rightPadBars(Math.round((width / space) * 0.88));
  }
  return { space: Math.min(40, Math.max(0.3, space)), pad };
}
