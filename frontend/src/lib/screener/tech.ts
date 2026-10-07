// zzz948 — price-based figures for the screener, from daily bars (open / high / low / close / volume, oldest first). Pure, no
// network: the builds (us-build.ts / in-build.ts) download the bars and keep only the numbers worked out here.
//
// The formulas follow TradingView's, checked against its screener on NVDA / RELIANCE (7 Oct 2026):
//   • RSI 14 = Wilder's RSI (averages started with a plain mean of the first 14 moves, then smoothed 13/14 + 1/14);
//     weekly / monthly RSI use one close per week / month (the current, unfinished week / month counts with today's close);
//   • ATR % 14 = Wilder-smoothed true range ÷ today's close × 100;
//   • average day range % = mean over 20 days of (high ÷ low − 1) × 100;
//   • EMA = exponential average started from a plain mean of the first n closes;
//   • performance = today's close against the OPEN of the last session on or before 7 / 30 / 90 / 180 / 365 / 1825 days ago;
//     YTD against the open of this year's first session; All against the first open in the data (5 years at most here);
//   • change 1W = against the close of the last day of the previous calendar week (Mon–Sun week);
//   • average volume n days = mean of the last n daily volumes (today included); volume 1W = this calendar week's volume so far.

export interface DailyBars { d: string[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }

export interface TechFigures {
  d: string | null;                 // date of the last bar
  sma21: number | null; sma50: number | null; sma100: number | null; sma150: number | null; sma200: number | null;
  ema10: number | null; ema21: number | null; ema50: number | null;
  rsi: number | null; rsiW: number | null; rsiM: number | null;
  atrP: number | null; adrP: number | null; chgOpen: number | null;
  chg1W: number | null; perf1W: number | null; perf1M: number | null; perf3M: number | null; perf6M: number | null;
  perfYTD: number | null; perf1Y: number | null; perf5Y: number | null; perfAll: number | null;
  avgVol10: number | null; avgVol30: number | null; avgVol60: number | null; vol1W: number | null;
  hi52: number | null;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function smaOf(c: readonly number[], n: number): number | null {
  if (c.length < n || n <= 0) return null;
  let s = 0;
  for (let i = c.length - n; i < c.length; i++) s += c[i];
  return s / n;
}
export function emaOf(c: readonly number[], n: number): number | null {
  if (c.length < n || n <= 0) return null;
  let e = 0;
  for (let i = 0; i < n; i++) e += c[i];
  e /= n;
  const k = 2 / (n + 1);
  for (let i = n; i < c.length; i++) e = c[i] * k + e * (1 - k);
  return e;
}
/** Wilder's RSI over closes (needs n + 1 closes). */
export function rsiOf(c: readonly number[], n = 14): number | null {
  if (c.length < n + 1) return null;
  let up = 0, dn = 0;
  for (let i = 1; i <= n; i++) { const ch = c[i] - c[i - 1]; if (ch > 0) up += ch; else dn -= ch; }
  up /= n; dn /= n;
  for (let i = n + 1; i < c.length; i++) {
    const ch = c[i] - c[i - 1];
    up = (up * (n - 1) + (ch > 0 ? ch : 0)) / n;
    dn = (dn * (n - 1) + (ch < 0 ? -ch : 0)) / n;
  }
  if (dn === 0) return up === 0 ? 50 : 100;
  return 100 - 100 / (1 + up / dn);
}
/** Wilder-smoothed true range as % of the last close. */
export function atrPctOf(h: readonly number[], l: readonly number[], c: readonly number[], n = 14): number | null {
  const len = c.length;
  if (len < n + 1) return null;
  const tr = (i: number) => Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  let atr = 0;
  for (let i = 1; i <= n; i++) atr += tr(i);
  atr /= n;
  for (let i = n + 1; i < len; i++) atr = (atr * (n - 1) + tr(i)) / n;
  const last = c[len - 1];
  return last > 0 ? (atr / last) * 100 : null;
}
export function adrPctOf(h: readonly number[], l: readonly number[], n = 20): number | null {
  if (h.length < n) return null;
  let s = 0;
  for (let i = h.length - n; i < h.length; i++) { if (!(l[i] > 0)) return null; s += h[i] / l[i] - 1; }
  return (s / n) * 100;
}

/** Index of the last bar dated on or before `iso` (bars are oldest first), or -1. */
function lastOnOrBefore(d: readonly string[], iso: string): number {
  let lo = 0, hi = d.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (d[m] <= iso) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
const isoShift = (iso: string, days: number, months = 0, years = 0): string => {
  const t = new Date(`${iso}T00:00:00Z`);
  if (years) t.setUTCFullYear(t.getUTCFullYear() - years);
  if (months) t.setUTCMonth(t.getUTCMonth() - months);
  if (days) t.setUTCDate(t.getUTCDate() - days);
  return t.toISOString().slice(0, 10);
};
/** Monday of the ISO week holding `iso`. */
export function weekStart(iso: string): string {
  const t = new Date(`${iso}T00:00:00Z`);
  const wd = (t.getUTCDay() + 6) % 7;   // Mon = 0
  t.setUTCDate(t.getUTCDate() - wd);
  return t.toISOString().slice(0, 10);
}
/** One close per period (the last close in each week / month). */
export function periodCloses(d: readonly string[], c: readonly number[], by: 'W' | 'M'): number[] {
  const out: number[] = [];
  let key = '';
  for (let i = 0; i < d.length; i++) {
    const k = by === 'W' ? weekStart(d[i]) : d[i].slice(0, 7);
    if (k !== key) { out.push(c[i]); key = k; } else out[out.length - 1] = c[i];
  }
  return out;
}

const pct = (a: number, b: number | null | undefined) => (fin(b) && b > 0 ? r2((a / b - 1) * 100) : null);

export function techFigures(b: DailyBars): TechFigures {
  const n = b.c.length;
  const out: TechFigures = {
    d: n ? b.d[n - 1] : null, sma21: null, sma50: null, sma100: null, sma150: null, sma200: null, ema10: null, ema21: null, ema50: null,
    rsi: null, rsiW: null, rsiM: null, atrP: null, adrP: null, chgOpen: null, chg1W: null, perf1W: null, perf1M: null, perf3M: null, perf6M: null,
    perfYTD: null, perf1Y: null, perf5Y: null, perfAll: null, avgVol10: null, avgVol30: null, avgVol60: null, vol1W: null, hi52: null,
  };
  if (!n) return out;
  const c = b.c, last = c[n - 1], today = b.d[n - 1];
  const rr = (v: number | null) => (v == null ? null : r2(v));
  out.sma21 = rr(smaOf(c, 21)); out.sma50 = rr(smaOf(c, 50)); out.sma100 = rr(smaOf(c, 100)); out.sma150 = rr(smaOf(c, 150)); out.sma200 = rr(smaOf(c, 200));
  out.ema10 = rr(emaOf(c, 10)); out.ema21 = rr(emaOf(c, 21)); out.ema50 = rr(emaOf(c, 50));
  out.rsi = rr(rsiOf(c)); out.rsiW = rr(rsiOf(periodCloses(b.d, c, 'W'))); out.rsiM = rr(rsiOf(periodCloses(b.d, c, 'M')));
  out.atrP = rr(atrPctOf(b.h, b.l, c)); out.adrP = rr(adrPctOf(b.h, b.l));
  out.chgOpen = b.o[n - 1] > 0 ? r2((last / b.o[n - 1] - 1) * 100) : null;
  const ws = weekStart(today);
  const prevWeekEnd = lastOnOrBefore(b.d, isoShift(ws, 1));
  out.chg1W = prevWeekEnd >= 0 ? pct(last, c[prevWeekEnd]) : null;
  // TradingView: today's close against the OPEN of the last session on or before today − 7 / 30 / 90 / 180 / 365 / 1825 days
  // (a company listed after that date: since its first session, as TradingView does)
  const perfDays = (days: number) => {
    const target = isoShift(today, days);
    const i = Math.max(0, lastOnOrBefore(b.d, target));
    return i >= 0 && i < n - 1 ? pct(last, b.o[i]) : null;
  };
  out.perf1W = perfDays(7); out.perf1M = perfDays(30); out.perf3M = perfDays(90); out.perf6M = perfDays(180);
  out.perf1Y = perfDays(365); out.perf5Y = perfDays(1825);
  const ys = lastOnOrBefore(b.d, `${Number(today.slice(0, 4)) - 1}-12-31`) + 1;   // first session of this year
  out.perfYTD = ys >= 0 && ys < n ? pct(last, b.o[ys]) : null;   // a listing this year: since its first available session
  out.perfAll = n > 1 ? pct(last, b.o[0]) : null;
  const avg = (k: number) => (n >= k ? Math.round(b.v.slice(n - k).reduce((a, x) => a + x, 0) / k) : null);
  out.avgVol10 = avg(10); out.avgVol30 = avg(30); out.avgVol60 = avg(60);
  let wv = 0;
  for (let i = n - 1; i >= 0 && b.d[i] >= ws; i--) wv += b.v[i];
  out.vol1W = wv;
  const from = isoShift(today, 0, 0, 1);
  let hi = -Infinity;
  for (let i = n - 1; i >= 0 && b.d[i] > from; i--) hi = Math.max(hi, b.h[i]);
  out.hi52 = Number.isFinite(hi) ? r2(hi) : null;
  return out;
}

/** One NSE daily price file for one company: [close, previous close, volume, open, high, low] (open/high/low may be missing in
 *  files saved before zzz948). */
export type NseDay = [number, number, number, number?, number?, number?];
/** India: Yahoo's history with NSE's own figures laid over it for the days we hold NSE's daily price files. NSE's close is the
 *  official closing price (an average of the last half hour) — what TradingView uses — while Yahoo keeps the last trade; volumes
 *  differ too. A day whose NSE close is more than 3% from Yahoo's is left alone (Yahoo has adjusted it for a later split or bonus). */
export function overlayNse(b: DailyBars, days: ReadonlyArray<{ date: string; day: NseDay | undefined }>): DailyBars {
  const idx = new Map<string, number>();
  b.d.forEach((d, i) => idx.set(d, i));
  const out: DailyBars = { d: b.d.slice(), o: b.o.slice(), h: b.h.slice(), l: b.l.slice(), c: b.c.slice(), v: b.v.slice() };
  const extra: Array<{ d: string; o: number; h: number; l: number; c: number; v: number }> = [];
  const lastD = b.d[b.d.length - 1] || '';
  for (const { date, day } of days) {
    if (!day || !fin(day[0]) || day[0] <= 0) continue;
    const [c, , v, o, h, l] = day;
    const ohl = fin(o) && o > 0 && fin(h) && h > 0 && fin(l) && l > 0;
    const bar = { o: ohl ? (o as number) : c, h: ohl ? Math.max(h as number, c) : c, l: ohl ? Math.min(l as number, c) : c, c, v: fin(v) ? v : 0 };
    const i = idx.get(date);
    if (i != null) {
      if (Math.abs(c / out.c[i] - 1) > 0.03) continue;
      if (ohl) { out.o[i] = bar.o; out.h[i] = bar.h; out.l[i] = bar.l; } else { out.h[i] = Math.max(out.h[i], c); out.l[i] = Math.min(out.l[i], c); }
      out.c[i] = bar.c; out.v[i] = bar.v;
    } else if (ohl && date > lastD && (!b.c.length || Math.abs(c / b.c[b.c.length - 1] - 1) < 0.25)) {
      extra.push({ d: date, ...bar });   // a day Yahoo has not published yet
    }
  }
  extra.sort((x, y) => (x.d < y.d ? -1 : 1));
  for (const e of extra) { out.d.push(e.d); out.o.push(e.o); out.h.push(e.h); out.l.push(e.l); out.c.push(e.c); out.v.push(e.v); }
  return out;
}

/** Yahoo v8 chart JSON → daily bars (sessions with no close dropped; a missing open / high / low falls back to the close). */
export function barsFromYahoo(j: any): { bars: DailyBars; firstTrade: number | null; exchange: string | null } | null {
  const r = j?.chart?.result?.[0];
  if (!r) return null;
  const ts: number[] = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const off: number = r.meta?.gmtoffset || 0;
  const bars: DailyBars = { d: [], o: [], h: [], l: [], c: [], v: [] };
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    if (!fin(c) || c <= 0) continue;
    const d = new Date((ts[i] + off) * 1000).toISOString().slice(0, 10);
    if (bars.d.length && bars.d[bars.d.length - 1] === d) { bars.d.pop(); bars.o.pop(); bars.h.pop(); bars.l.pop(); bars.c.pop(); bars.v.pop(); }
    bars.d.push(d);
    bars.o.push(fin(q.open?.[i]) && q.open[i] > 0 ? q.open[i] : c);
    bars.h.push(fin(q.high?.[i]) && q.high[i] > 0 ? Math.max(q.high[i], c) : c);
    bars.l.push(fin(q.low?.[i]) && q.low[i] > 0 ? Math.min(q.low[i], c) : c);
    bars.c.push(c);
    bars.v.push(fin(q.volume?.[i]) ? q.volume[i] : 0);
  }
  if (!bars.c.length) return null;
  const ft = r.meta?.firstTradeDate;
  return { bars, firstTrade: fin(ft) ? ft : null, exchange: typeof r.meta?.fullExchangeName === 'string' ? r.meta.fullExchangeName : null };
}
