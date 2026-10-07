// zzz937 — pure maths for the /charts page (no window, no fetch): moving averages, the header numbers (ADR%, RVol, average
// traded value), weekly / monthly bars built from daily bars, the measure-tool label, range windows, and the saved
// drawings / settings shapes (stored in the browser and synced to the owner's database through user-vault-keys).

export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }
export type Market = 'IN' | 'US';

/** zzz944 — US extended-hours change % (TradingView's "Ext" column) from a Yahoo chart/spark `meta`: only while the pre-market
 *  or after-hours session is open, the extended price (meta.fulldayPrice) vs the regular-session price; otherwise null. */
export function extendedHoursPct(meta: any, nowMs: number): number | null {
  const reg = Number(meta?.regularMarketPrice), ext = Number(meta?.fulldayPrice);
  if (!(reg > 0) || !(ext > 0)) return null;
  const p = meta?.currentTradingPeriod;
  const inWin = (w: any) => !!w && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)) && nowMs >= Number(w.start) * 1000 && nowMs < Number(w.end) * 1000;
  if (!inWin(p?.pre) && !inWin(p?.post)) return null;
  return (100 * (ext - reg)) / reg;
}
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

/** PVol — the last day's volume as a % of the highest daily volume of the `n` days BEFORE it (100 = matched the high). */
export function peakVolumePct(bars: Bar[], n = 50): number | null {
  if (bars.length < 2) return null;
  const prev = bars.slice(-(n + 1), -1).map((b) => b.v).filter((v) => v > 0);
  if (!prev.length) return null;
  const hi = Math.max(...prev);
  return hi > 0 ? (100 * bars[bars.length - 1].v) / hi : null;
}

/** Float % — freely traded shares as a % of all shares. `floatShares`/`sharesOut` when both are known, else a ready % (e.g.
 *  the screener's US figure), else 100 − promoter % (India). Out-of-range answers become null. */
export function floatPct(o: { floatShares?: number | null; sharesOut?: number | null; pct?: number | null; promoterPct?: number | null }): number | null {
  const ok = (v: number | null | undefined) => (v != null && Number.isFinite(v) && v > 0 && v <= 100 ? v : null);
  if (o.floatShares && o.sharesOut && o.floatShares > 0 && o.sharesOut > 0) return ok((100 * o.floatShares) / o.sharesOut);
  if (o.pct != null) return ok(o.pct);
  if (o.promoterPct != null && Number.isFinite(o.promoterPct) && o.promoterPct >= 0 && o.promoterPct < 100) return ok(100 - o.promoterPct);
  return null;
}

export interface HeaderStats {
  last: number | null; prevClose: number | null; change: number | null; changePct: number | null;
  adrPct: number | null; rvol: number | null; pvol: number | null; avgValue: number | null; floatPct?: number | null;
}
/** Numbers for the header line — always from DAILY bars, whatever timeframe is on screen. */
export function headerStats(daily: Bar[]): HeaderStats {
  const last = daily.length ? daily[daily.length - 1].c : null;
  const prevClose = daily.length > 1 ? daily[daily.length - 2].c : null;
  const change = last != null && prevClose != null ? last - prevClose : null;
  const changePct = change != null && prevClose ? (100 * change) / prevClose : null;
  return { last, prevClose, change, changePct, adrPct: adrPct(daily), rvol: relVolume(daily), pvol: peakVolumePct(daily), avgValue: avgDollarVolume(daily) };
}

// ── indicators (pure; null until there is enough history) ───────────────────

/** RSI with Wilder's smoothing (the TradingView way). */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (!(period >= 1) || closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) gain += d; else loss -= d; }
  gain /= period; loss /= period;
  const val = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = val();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = val();
  }
  return out;
}

/** Bollinger Bands: middle = SMA(n); upper / lower = middle ± k × standard deviation (population, as TradingView). */
export function bollinger(closes: number[], period = 20, k = 2): { mid: (number | null)[]; up: (number | null)[]; lo: (number | null)[] } {
  const mid = sma(closes, period);
  const up: (number | null)[] = new Array(closes.length).fill(null);
  const lo: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const m = mid[i];
    if (m == null) continue;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (closes[j] - m) ** 2;
    const sd = Math.sqrt(v / period);
    up[i] = m + k * sd; lo[i] = m - k * sd;
  }
  return { mid, up, lo };
}

/** MACD: fast EMA − slow EMA; signal = EMA of MACD; histogram = MACD − signal. */
export function macd(closes: number[], fast = 12, slow = 26, signal = 9): { macd: (number | null)[]; signal: (number | null)[]; hist: (number | null)[] } {
  const f = ema(closes, fast), s = ema(closes, slow);
  const m = closes.map((_, i) => (f[i] != null && s[i] != null ? (f[i] as number) - (s[i] as number) : null));
  const start = m.findIndex((v) => v != null);
  const sig: (number | null)[] = new Array(closes.length).fill(null);
  if (start >= 0) {
    const e = ema(m.slice(start) as number[], signal);
    e.forEach((v, i) => { sig[start + i] = v; });
  }
  const hist = m.map((v, i) => (v != null && sig[i] != null ? v - (sig[i] as number) : null));
  return { macd: m, signal: sig, hist };
}

/** True range of each bar (the first bar uses high − low). */
export function trueRange(bars: Bar[]): number[] {
  return bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))));
}
/** ATR with Wilder's smoothing (RMA), seeded with the simple average of the first `period` true ranges. */
export function atr(bars: Bar[], period = 14): (number | null)[] {
  const tr = trueRange(bars);
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (!(period >= 1) || bars.length < period) return out;
  let prev = 0;
  for (let i = 0; i < period; i++) prev += tr[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < bars.length; i++) { prev = (prev * (period - 1) + tr[i]) / period; out[i] = prev; }
  return out;
}

/** Supertrend, following TradingView's ta.supertrend: bands at (high + low) / 2 ± mult × ATR that only tighten while the
 *  previous close stays on their side; it starts in a down trend (line = upper band) and flips when the close crosses the
 *  current band. Returns the line and the direction (1 = up, line below price; −1 = down, line above price). */
export function supertrend(bars: Bar[], period = 10, mult = 3): { line: (number | null)[]; dir: (1 | -1 | null)[] } {
  const a = atr(bars, period);
  const line: (number | null)[] = new Array(bars.length).fill(null);
  const dir: (1 | -1 | null)[] = new Array(bars.length).fill(null);
  let loPrev = 0, upPrev = 0, d: 1 | -1 = -1, started = false;
  for (let i = 0; i < bars.length; i++) {
    const av = a[i];
    if (av == null) continue;
    const hl2 = (bars[i].h + bars[i].l) / 2;
    let lo = hl2 - mult * av, up = hl2 + mult * av;
    if (started) {
      const pc = bars[i - 1].c;
      if (!(lo > loPrev || pc < loPrev)) lo = loPrev;
      if (!(up < upPrev || pc > upPrev)) up = upPrev;
      d = d === -1 ? (bars[i].c > up ? 1 : -1) : (bars[i].c < lo ? -1 : 1);
    } else {
      d = -1; started = true;
    }
    loPrev = lo; upPrev = up;
    line[i] = d === 1 ? lo : up; dir[i] = d;
  }
  return { line, dir };
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
