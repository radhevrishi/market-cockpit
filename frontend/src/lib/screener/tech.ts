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
  /** zzz969 — last bar's close; change over the last 5 trading sessions (not 7 calendar days) */
  close?: number | null; perf5D?: number | null;
  /** zzz996 — the previous bar's close (to tell a quote that is a session behind) */
  prevClose?: number | null;
  /** zzz998 — the close two bars back: with prevClose it gives the PREVIOUS session's change, the evidence that a quote is a
   *  session behind (its change % matches that session's, not today's). 6 significant digits, like prevClose. */
  prev2Close?: number | null;
}

/** zzz969 / zzz998 — the US regular session (Mon–Fri 9:30–16:00 New York time; holidays not checked — a holiday build simply has no
 *  live price). Pure; lives here (not in us-build) so the client-safe pine.ts can use it. */
export function usSessionOpen(now = new Date()): boolean {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return false;
  const m = (Number(p.hour) % 24) * 60 + Number(p.minute);
  return m >= 570 && m < 960;
}

/** zzz1003 (PS-03) — is a daily bar dated `lastDate` today's UNFINISHED session at `now`? True when `lastDate` is the market's
 *  local date of `now`, a weekday, and the regular session has not closed yet: US 16:00 New York time, India (NSE) 15:30 IST.
 *  A bar for today seen before the open (pre-market) is unfinished as well. Holidays need no calendar (no bar exists for them).
 *  Pure; client-safe. */
export function liveSessionBar(lastDate: string | null | undefined, market: 'US' | 'IN', now = new Date()): boolean {
  if (!lastDate) return false;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: market === 'US' ? 'America/New_York' : 'Asia/Kolkata', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).map((x) => [x.type, x.value]));
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return false;
  if (`${p.year}-${p.month}-${p.day}` !== lastDate) return false;
  const m = (Number(p.hour) % 24) * 60 + Number(p.minute);
  return m < (market === 'US' ? 960 : 930);
}

/** zzz1003 (PS-07) — the history every price figure, the daily and the weekly pattern scans read: the last 5 years + 25 days (what
 *  the build used to download). The download is now ~10 years for the monthly scan; these readings are unchanged. */
export const TECH_FIGURE_DAYS = 5 * 365 + 25;
/** zzz1003 — the bars dated within `days` calendar days of the LAST bar (oldest first; the same arrays when nothing is cut). */
export function recentBars(b: DailyBars, days: number): DailyBars {
  const n = b.d.length;
  if (!n) return b;
  const t = new Date(`${b.d[n - 1]}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - days);
  const from = t.toISOString().slice(0, 10);
  let i = 0;
  while (i < n && b.d[i] < from) i++;
  return i === 0 ? b : { d: b.d.slice(i), o: b.o.slice(i), h: b.h.slice(i), l: b.l.slice(i), c: b.c.slice(i), v: b.v.slice(i) };
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
    close: null, perf5D: null,
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
  out.close = r2(last);
  const p6 = (v: number) => (fin(v) ? Number(v.toPrecision(6)) : null);
  out.prevClose = n > 1 ? p6(c[n - 2]) : null;
  out.prev2Close = n > 2 ? p6(c[n - 3]) : null;
  out.perf5D = n > 5 ? pct(last, c[n - 6]) : null;
  return out;
}

/** zzz969 — the price figures as of the last COMPLETED session, for a history whose last bar is today's unfinished session. */
export function closedFigures(b: DailyBars): Record<string, number | null> | null {
  const n = b.c.length;
  if (n < 3) return null;
  const cut: DailyBars = { d: b.d.slice(0, -1), o: b.o.slice(0, -1), h: b.h.slice(0, -1), l: b.l.slice(0, -1), c: b.c.slice(0, -1), v: b.v.slice(0, -1) };
  const f = techFigures(cut);
  const out: Record<string, number | null> = {};
  for (const k of ['sma21', 'sma50', 'sma100', 'sma150', 'sma200', 'ema10', 'ema21', 'ema50', 'rsi', 'atrP', 'adrP', 'chgOpen', 'chg1W', 'perf1W', 'perf1M', 'perf3M', 'perf6M', 'perfYTD', 'perf1Y', 'perf5D', 'avgVol10', 'avgVol30', 'avgVol60', 'hi52'] as const) out[k] = (f as any)[k] ?? null;
  out.px = f.close ?? null;
  out.chg = cut.c.length > 1 ? r2((cut.c[cut.c.length - 1] / cut.c[cut.c.length - 2] - 1) * 100) : null;
  out.vol = cut.v[cut.v.length - 1] ?? null;
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
export function barsFromYahoo(j: any): { bars: DailyBars; firstTrade: number | null; exchange: string | null; partial?: boolean } | null {
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
  // zzz969 — is the last bar today's session, still trading?
  const reg = r.meta?.currentTradingPeriod?.regular;
  const nowS = Date.now() / 1000;
  const partial = !!reg && fin(reg.start) && fin(reg.end) && nowS >= reg.start && nowS < reg.end
    && bars.d[bars.d.length - 1] === new Date((reg.start + off) * 1000).toISOString().slice(0, 10);
  return { bars, firstTrade: fin(ft) ? ft : null, exchange: typeof r.meta?.fullExchangeName === 'string' ? r.meta.fullExchangeName : null, partial };
}
