// zzz1088 — intraday bars + session VWAP (retest gap: "Intraday charts … Session VWAP … Missing").
// Yahoo's chart API gives regular-session intraday bars within its own limits (5-minute: last 60 days, 60-minute: about 2 years);
// we ask for a short window so the request stays small. Each bar carries its SESSION date in the exchange's own time zone
// (Asia/Kolkata for NSE / BSE, America/New_York for US) — that is what VWAP resets on, never the viewer's time zone.
// Pure: no fetch here (the route does that).
import { phaseAt, sessionCloseUtc, type Market } from './exchange-calendar';

export type IntradayTf = '5m' | '15m' | '60m';
export const INTRADAY_TFS: readonly IntradayTf[] = ['5m', '15m', '60m'];
export const INTRADAY_META: Record<IntradayTf, { range: string; minutes: number; label: string; days: string }> = {
  '5m': { range: '5d', minutes: 5, label: '5 min', days: 'last 5 trading days' },
  '15m': { range: '1mo', minutes: 15, label: '15 min', days: 'last month' },
  '60m': { range: '6mo', minutes: 60, label: '1 hour', days: 'last 6 months' },
};
export const isIntraday = (tf: string): tf is IntradayTf => (INTRADAY_TFS as readonly string[]).includes(tf);

export interface IBar { t: number; o: number; h: number; l: number; c: number; v: number; s: string }
export interface IntradaySeries {
  bars: IBar[]; symbol: string; name: string | null; currency: string | null; exchange: string | null; tz: string;
  /** the newest bar is still forming (its interval has not ended) */
  lastLive: boolean;
  granularity: string | null;
}

/** YYYY-MM-DD of an instant in a time zone. */
export function sessionDate(ms: number, tz: string): string {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  } catch { /* unknown zone */ }
  return new Date(ms).toISOString().slice(0, 10);
}

export function parseYahooIntraday(j: any, tf: IntradayTf, now = Date.now(), market?: Market): IntradaySeries | null {
  const r = j?.chart?.result?.[0];
  if (!r) return null;
  const m = r.meta || {};
  const tz = typeof m.exchangeTimezoneName === 'string' && m.exchangeTimezoneName ? m.exchangeTimezoneName : 'UTC';
  const ts: number[] = Array.isArray(r.timestamp) ? r.timestamp : [];
  const q = r.indicators?.quote?.[0] || {};
  const bars: IBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    if (c == null || !Number.isFinite(c) || !(c > 0)) continue;
    const t = ts[i] * 1000;
    const o = Number.isFinite(q.open?.[i]) ? q.open[i] : c;
    const h = Math.max(Number.isFinite(q.high?.[i]) ? q.high[i] : c, o, c);
    const l = Math.min(Number.isFinite(q.low?.[i]) ? q.low[i] : c, o, c);
    const v = Number.isFinite(q.volume?.[i]) ? q.volume[i] : 0;
    const prev = bars[bars.length - 1];
    if (prev && t <= prev.t) continue;   // out of order / duplicate
    bars.push({ t, o, h, l, c, v, s: sessionDate(t, tz) });
  }
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  return {
    bars, tz, symbol: String(m.symbol || ''), name: m.longName || m.shortName || null, currency: m.currency || null,
    exchange: m.fullExchangeName || m.exchangeName || null, granularity: typeof m.dataGranularity === 'string' ? m.dataGranularity : null,
    lastLive: now < barEnd(last, tf, market),
  };
}

/** Session VWAP: Σ(typical price × volume) ÷ Σ volume from the session's first bar, reset at every new session (exchange date).
 *  Typical price = (high + low + close) ÷ 3, as TradingView's VWAP with source hlc3. null until the session has volume. */
export function sessionVwap(bars: readonly Pick<IBar, 'h' | 'l' | 'c' | 'v' | 's'>[]): (number | null)[] {
  const out: (number | null)[] = [];
  let sess = '', pv = 0, vol = 0;
  for (const b of bars) {
    if (b.s !== sess) { sess = b.s; pv = 0; vol = 0; }
    const v = Number.isFinite(b.v) && b.v > 0 ? b.v : 0;
    pv += ((b.h + b.l + b.c) / 3) * v; vol += v;
    out.push(vol > 0 ? pv / vol : null);
  }
  return out;
}

/** Bars of the last N sessions (the range Yahoo sends can start mid-session at its edge). */
export function lastSessions<T extends { s: string }>(bars: readonly T[], n: number): T[] {
  const days: string[] = [];
  for (let i = bars.length - 1; i >= 0 && days.length <= n; i--) if (days[days.length - 1] !== bars[i].s) days.push(bars[i].s);
  const keep = new Set(days.slice(0, n));
  return bars.filter((b) => keep.has(b.s));
}

/** zzz1096 (retest R6) — when an intraday bar ends: its interval, CLIPPED to the session close (a final 60-minute bar that starts
 *  15:30 ET ends at the 16:00 close, not 16:30; 13:00 ET on early-close days; holidays and DST from the exchange calendar). */
export function barEnd(bar: Pick<IBar, 't' | 's'>, tf: IntradayTf, market?: Market): number {
  const end = bar.t + INTRADAY_META[tf].minutes * 60_000;
  if (!market) return end;
  const close = sessionCloseUtc(market, bar.s);
  return close != null && close < end ? close : end;
}

/** Plain words for the grid's status line, keeping three facts apart: is the exchange in its regular session now, is the last
 *  bar still forming, and how old the last bar is (a completed bar during an open session is NOT "session closed"). */
export function intradayStatus(market: Market, now: number, last: Pick<IBar, 't' | 's'> | null, tf: IntradayTf): { text: string; tone: 'live' | 'ok' | 'warn' | 'closed' } {
  if (!last) return { text: 'no bars', tone: 'warn' };
  const tz = market === 'IN' ? 'Asia/Kolkata' : 'America/New_York';
  const hm = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const open = phaseAt(market, new Date(now)) === 'regular';
  const end = barEnd(last, tf, market);
  if (!open) {
    const d = new Date(Date.parse(`${last.s}T12:00:00Z`)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return { text: `market closed · last session ${d}`, tone: 'closed' };
  }
  if (now < end) return { text: `market open · bar forming (from ${hm(last.t)})`, tone: 'live' };
  const lagMin = (now - end) / 60_000;
  if (lagMin > 2 * INTRADAY_META[tf].minutes + 5) return { text: `market open · data delayed — last bar ${hm(last.t)}`, tone: 'warn' };
  return { text: `market open · last completed bar ${hm(last.t)}`, tone: 'ok' };
}
