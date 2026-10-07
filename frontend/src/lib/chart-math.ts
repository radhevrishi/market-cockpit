// zzz937 — pure maths for the /charts page (no window, no fetch): moving averages, the header numbers (ADR%, RVol, average
// traded value), weekly / monthly bars built from daily bars, the measure-tool label, range windows, and the saved
// drawings / settings shapes (stored in the browser and synced to the owner's database through user-vault-keys).

export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }
export type Market = 'IN' | 'US';
export type Timeframe = 'D' | 'W' | 'M';
export type RangeKey = '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y' | 'All';
export const RANGE_KEYS: RangeKey[] = ['1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All'];

export const IN_TICKER_RE = /^[A-Z0-9][A-Z0-9&-]{0,19}$/;
export const US_TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
export function validTicker(market: Market, ticker: string): boolean {
  return (market === 'IN' ? IN_TICKER_RE : US_TICKER_RE).test(ticker);
}
/** Upper-case, drop exchange prefixes / suffixes the owner may paste (NSE:ABC, ABC.NS). */
export function cleanTicker(raw: string): string {
  let t = String(raw || '').trim().toUpperCase();
  t = t.replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX|NYSEARCA|BATS):/, '');
  t = t.replace(/\.(NS|BO)$/, '');
  return t;
}

/** Simple moving average; null until `period` values exist. */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (!(period >= 1)) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the simple average of the first `period` values (the TradingView way). */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (!(period >= 1) || values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

/** ADR% — average daily range over the last `n` days: 100 × (average of high ÷ low − 1). */
export function adrPct(bars: Bar[], n = 20): number | null {
  const last = bars.slice(-n).filter((b) => b.l > 0 && b.h >= b.l);
  if (last.length < Math.min(n, 5)) return null;
  return 100 * (mean(last.map((b) => b.h / b.l)) - 1);
}

/** RVol — the last day's volume ÷ the average volume of the `n` days BEFORE it. */
export function relVolume(bars: Bar[], n = 20): number | null {
  if (bars.length < 2) return null;
  const prev = bars.slice(-(n + 1), -1).map((b) => b.v).filter((v) => v > 0);
  const avg = mean(prev);
  if (!prev.length || !(avg > 0)) return null;
  return bars[bars.length - 1].v / avg;
}

/** Average traded value over the last `n` days (close × volume), in the quote currency. */
export function avgDollarVolume(bars: Bar[], n = 20): number | null {
  const last = bars.slice(-n);
  if (!last.length) return null;
  const v = mean(last.map((b) => b.c * b.v));
  return Number.isFinite(v) ? v : null;
}

export interface HeaderStats { last: number | null; prevClose: number | null; change: number | null; changePct: number | null; adrPct: number | null; rvol: number | null; avgValue: number | null }
/** Numbers for the header line — always from DAILY bars, whatever timeframe is on screen. */
export function headerStats(daily: Bar[]): HeaderStats {
  const last = daily.length ? daily[daily.length - 1].c : null;
  const prevClose = daily.length > 1 ? daily[daily.length - 2].c : null;
  const change = last != null && prevClose != null ? last - prevClose : null;
  const changePct = change != null && prevClose ? (100 * change) / prevClose : null;
  return { last, prevClose, change, changePct, adrPct: adrPct(daily), rvol: relVolume(daily), avgValue: avgDollarVolume(daily) };
}

/** UTC midnight of the Monday of the week holding `t`. */
export function weekStart(t: number): number {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;          // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
export function monthStart(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Weekly or monthly bars from daily bars (input sorted oldest first). Each bar is stamped with the week's Monday / month's 1st. */
export function aggregateBars(daily: Bar[], tf: Timeframe): Bar[] {
  if (tf === 'D') return daily.slice();
  const keyOf = tf === 'W' ? weekStart : monthStart;
  const out: Bar[] = [];
  for (const b of daily) {
    const k = keyOf(b.t);
    const cur = out[out.length - 1];
    if (cur && cur.t === k) {
      cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v;
    } else {
      out.push({ t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    }
  }
  return out;
}

/** Index of the bar at or just before `t` (bars sorted oldest first); -1 if `t` is before the first bar. */
export function barIndexAt(times: number[], t: number): number {
  let lo = 0, hi = times.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Number of bars between two times on the chart (always ≥ 0). */
export function barsBetween(times: number[], t1: number, t2: number): number {
  if (!times.length) return 0;
  const a = Math.max(0, barIndexAt(times, Math.min(t1, t2)));
  const b = Math.max(0, barIndexAt(times, Math.max(t1, t2)));
  return b - a;
}

export function fmtPrice(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Measure-tool label: "+112.63 (+17.76%) · 34 bars". */
export function measureLabel(fromPrice: number, toPrice: number, bars: number, decimals = 2): string {
  const d = toPrice - fromPrice;
  const pct = fromPrice !== 0 ? (100 * d) / fromPrice : 0;
  const sign = (x: number) => (x > 0 ? '+' : x < 0 ? '-' : '');
  return `${sign(d)}${fmtPrice(Math.abs(d), decimals)} (${sign(pct)}${Math.abs(pct).toFixed(2)}%) · ${bars} bar${bars === 1 ? '' : 's'}`;
}

/** Start time of a visible range ending at `lastT`. 'All' → null (show everything). */
export function rangeStart(range: RangeKey, lastT: number): number | null {
  const d = new Date(lastT);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  switch (range) {
    case '1M': return Date.UTC(y, m - 1, day);
    case '3M': return Date.UTC(y, m - 3, day);
    case '6M': return Date.UTC(y, m - 6, day);
    case 'YTD': return Date.UTC(y, 0, 1);
    case '1Y': return Date.UTC(y - 1, m, day);
    case '5Y': return Date.UTC(y - 5, m, day);
    default: return null;
  }
}

/** How much daily history to ask the server for, so the visible window AND the moving-average warm-up are covered. */
export function dataRangeFor(tf: Timeframe, range: RangeKey): '2y' | '5y' | '10y' | 'max' {
  if (range === 'All' || tf === 'M') return 'max';
  if (tf === 'W' || range === '5Y') return '10y';
  if (range === '1Y') return '5y';
  return '2y';
}

/** Compact money: 1.23B / 456.7M / 12.3K; India in crore / lakh. */
export function fmtMoney(n: number | null, market: Market): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (market === 'IN') {
    if (n >= 1e7) return `₹${(n / 1e7).toFixed(n >= 1e9 ? 0 : 1)} Cr`;
    if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
    return `₹${Math.round(n).toLocaleString('en-IN')}`;
  }
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

// ── saved settings (moving averages) ─────────────────────────────────────────
export interface EmaLine { period: number; color: string; on: boolean }
export interface ChartSettings { emas: EmaLine[]; showVolume: boolean; volAvg: number }
export const DEFAULT_SETTINGS: ChartSettings = {
  emas: [
    { period: 21, color: '#E53935', on: true },
    { period: 50, color: '#1E66F5', on: true },
    { period: 89, color: '#111111', on: true },
    { period: 55, color: '#8E24AA', on: false },
    { period: 100, color: '#F57C00', on: false },
    { period: 150, color: '#2E7D32', on: false },
  ],
  showVolume: true,
  volAvg: 20,
};
const HEX = /^#[0-9a-fA-F]{6}$/;
export function sanitizeSettings(raw: unknown): ChartSettings {
  const r: any = raw && typeof raw === 'object' ? raw : {};
  const emas: EmaLine[] = Array.isArray(r.emas)
    ? r.emas.slice(0, 10).map((e: any) => ({
        period: Math.min(500, Math.max(1, Math.round(Number(e?.period) || 0))) || 21,
        color: HEX.test(String(e?.color)) ? String(e.color) : '#1E66F5',
        on: e?.on !== false,
      }))
    : DEFAULT_SETTINGS.emas.map((e) => ({ ...e }));
  const volAvg = Math.min(200, Math.max(1, Math.round(Number(r.volAvg) || 20)));
  return { emas, showVolume: r.showVolume !== false, volAvg };
}

// ── saved drawings: time + price anchors, never pixels, so they survive a timeframe change ──────────────────────
export const DRAWING_NAMES = ['mcHLine', 'segment', 'rayLine', 'mcRect', 'mcText', 'parallelStraightLine', 'fibonacciLine'] as const;
export type DrawingName = (typeof DRAWING_NAMES)[number];
export interface SavedDrawing { name: DrawingName; points: { t: number; p: number }[]; text?: string; color?: string }
export type DrawingStore = Record<string, SavedDrawing[]>;
export const drawingKey = (market: Market, ticker: string) => `${market}:${ticker}`;
export function sanitizeDrawings(raw: unknown): SavedDrawing[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedDrawing[] = [];
  for (const d of raw.slice(0, 300)) {
    if (!d || !(DRAWING_NAMES as readonly string[]).includes(d.name)) continue;
    const pts = Array.isArray(d.points) ? d.points.slice(0, 4).map((p: any) => ({ t: Number(p?.t), p: Number(p?.p) })).filter((p: any) => Number.isFinite(p.t) && Number.isFinite(p.p)) : [];
    if (!pts.length) continue;
    const s: SavedDrawing = { name: d.name, points: pts };
    if (typeof d.text === 'string') s.text = d.text.slice(0, 200);
    if (HEX.test(String(d.color))) s.color = d.color;
    out.push(s);
  }
  return out;
}
