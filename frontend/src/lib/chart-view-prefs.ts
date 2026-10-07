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
