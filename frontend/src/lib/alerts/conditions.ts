// zzz1054 — price-alert condition checks (pure).
//
// Inputs per ticker: the LIVE quote (price, previous close, day high / low, volume so far) and the DAILY figures worked out
// from completed daily bars (closes, 52-week high / low, 50-day average volume, weekly closes, today's open). Moving averages
// and RSI include the live price as the current bar, the way TradingView shows them during the session.
//
// Crossing semantics: a crossing needs the previous value. The checker remembers, per alert + ticker + condition, the last
// signed distance (value − level). Crossing up = previous ≤ 0 and now > 0; crossing down = previous ≥ 0 and now < 0. The
// first sighting only records the value — a crossing that happened before the alert was watching never fires.
// Missing data never fires: the condition is "unknown" and the alert waits.
import { smaOf, emaOf, rsiOf } from '@/lib/screener/tech';
import { isSignalCond, type AlertCondition, type AlertInterval } from './types';

export interface LiveQuote {
  price: number;
  prevClose: number | null;
  dayHigh?: number | null;
  dayLow?: number | null;
  volume?: number | null;
  marketTime?: number | null;   // ms epoch of the quote (the exchange's time of the regular-session price)
  name?: string | null;
  /** zzz1063 — quote contract: who supplied it ('yahoo-spark'), when we fetched it (ms epoch), and the US pre-market /
   *  after-hours price when the provider says that session is live (else null). See evaluate.ts priceForAlert(). */
  provider?: string;
  fetchedAt?: number;
  ext?: ExtQuote | null;
}
/** zzz1063 — an extended-hours (US pre-market / after-hours) price. `observedAt` is the provider's time for it; Yahoo's spark
 *  call gives none, so the source sets the moment we fetched it with basis 'fetched' (only when Yahoo's own trading-period
 *  says pre / post is live right now, and the price differs from the regular close — i.e. an extended trade exists). */
export interface ExtQuote { price: number; session: 'pre' | 'post'; observedAt: number | null; basis: 'provider' | 'fetched' }

/** Figures from completed daily bars (today's unfinished bar left out), plus today's open when today's bar exists. */
export interface DailyFigs {
  asOf: string;                 // date of the last completed bar
  day: string | null;           // today's market date when today's bar was in the data (then `open` is today's open)
  open: number | null;
  c: number[];                  // completed closes, oldest first (last ~260)
  hi52: number | null;          // highest high of the last 252 completed bars (or since listing — see hiBars)
  lo52: number | null;          // lowest low of the last 252 completed bars (or since listing)
  avgVol50: number | null;      // average volume of the last 50 completed sessions (or fewer — see volBars)
  wc: number[];                 // completed weekly closes, oldest first (last ~60)
  /** zzz1063 (A06) — figures version (FIGS_VERSION); older stored figures are fetched again */
  v?: number;
  /** sessions behind hi52 / lo52: 252 = a full year; fewer = the whole history since listing (partial) */
  hiBars?: number;
  /** sessions behind avgVol50: 50 = full; fewer = since listing or sessions with no volume data (partial) */
  volBars?: number;
}
/** zzz1063 — bump when DailyFigs gains or changes a field; stored figures of an older version are fetched again. */
export const FIGS_VERSION = 2;
export const HI52_BARS = 252;
export const AVGVOL_BARS = 50;
/** Fewer sessions than this and the 52-week / 50-day figures are not given at all. */
export const MIN_PARTIAL_BARS = 20;

export interface CondResult {
  met: boolean;
  /** false = data missing; the alert does not fire */
  known: boolean;
  /** value to remember for the next crossing check */
  state?: number;
  /** the number the condition looked at (for the message) */
  observed?: number;
  /** zzz1063 (A06) — plain-English note added to the condition text, e.g. "since listing, 140 sessions" */
  note?: string;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const UNKNOWN: CondResult = { met: false, known: false };

/** Previous close: the quote's own, else the last completed daily close. */
export function prevCloseOf(q: LiveQuote, f: DailyFigs | null): number | null {
  if (fin(q.prevClose) && q.prevClose > 0) return q.prevClose;
  const c = f?.c;
  return c && c.length ? c[c.length - 1] : null;
}

/** Live moving average: completed closes + the live price as the current bar. */
export function liveMa(kind: 'SMA' | 'EMA', len: number, c: readonly number[], price: number): number | null {
  if (kind === 'SMA') {
    if (c.length < len - 1) return null;
    return smaOf([...c.slice(-(len - 1)), price], len);
  }
  const e = emaOf(c, len);
  if (e == null) return null;
  const k = 2 / (len + 1);
  return price * k + e * (1 - k);
}
/** Live RSI(14): completed closes + the live price. */
export function liveRsi(c: readonly number[], price: number): number | null {
  return c.length >= 15 ? rsiOf([...c.slice(-300), price], 14) : null;
}

/** zzz1063 — the remembered state is the SIGN of (value − level): −1, 0 or +1. A crossing only needs the side, so storing the
 *  sign loses nothing, and the stored state changes only when the side changes (so it is written to Postgres only then). */
function crossing(dir: 'any' | 'up' | 'down', prev: number | undefined, cur: number): CondResult {
  const side = Math.sign(cur);
  if (prev === undefined || !fin(prev)) return { met: false, known: true, state: side };
  const up = prev <= 0 && cur > 0, down = prev >= 0 && cur < 0;
  const met = dir === 'up' ? up : dir === 'down' ? down : up || down;
  return { met, known: true, state: side };
}
const sinceListing = (n: number | undefined, full: number): string | undefined =>
  n != null && n < full ? `since listing, ${n} session${n === 1 ? '' : 's'}` : undefined;
const volNote = (n: number | undefined): string | undefined =>
  n != null && n < AVGVOL_BARS ? `average of ${n} session${n === 1 ? '' : 's'} with volume data` : undefined;

/** Base close for "moving X% in N bars": the close N completed bars (or weeks) back. N = 1 on D = previous close. */
export function moveBase(q: LiveQuote, f: DailyFigs | null, bars: number, interval: AlertInterval): number | null {
  if (interval === 'D') {
    if (bars === 1) return prevCloseOf(q, f);
    const c = f?.c; if (!c || c.length < bars) return null;
    return c[c.length - bars];
  }
  const w = f?.wc; if (!w || w.length < bars) return null;
  return w[w.length - bars];
}

/**
 * One condition for one ticker. `prev` is the remembered state for crossing conditions (undefined = first sighting).
 * `today` is the market's date, so a stale `open` from another day is never used for a gap.
 */
export function evalCondition(cond: AlertCondition, q: LiveQuote, f: DailyFigs | null, prev: number | undefined, interval: AlertInterval, today: string): CondResult {
  const price = q.price;
  if (!fin(price) || price <= 0) return UNKNOWN;
  const v = cond.value ?? NaN;
  switch (cond.type) {
    case 'price_cross': return { ...crossing('any', prev, price - v), observed: price };
    case 'price_cross_up': return { ...crossing('up', prev, price - v), observed: price };
    case 'price_cross_down': return { ...crossing('down', prev, price - v), observed: price };
    case 'price_above': return { met: price > v, known: true, observed: price };
    case 'price_below': return { met: price < v, known: true, observed: price };
    case 'move_up_pct': case 'move_down_pct': {
      const base = moveBase(q, f, cond.bars ?? 1, interval);
      if (!fin(base) || base <= 0) return UNKNOWN;
      const pct = (price / base - 1) * 100;
      return { met: cond.type === 'move_up_pct' ? pct >= v : pct <= -v, known: true, observed: pct };
    }
    case 'ma_cross': case 'ma_cross_up': case 'ma_cross_down': {
      if (!f) return UNKNOWN;
      const ma = liveMa(cond.ma ?? 'SMA', cond.len ?? 50, f.c, price);
      if (ma == null) return UNKNOWN;
      const dir = cond.type === 'ma_cross_up' ? 'up' : cond.type === 'ma_cross_down' ? 'down' : 'any';
      return { ...crossing(dir, prev, price - ma), observed: ma };
    }
    case 'high_52w': {
      if (!f || !fin(f.hi52)) return UNKNOWN;
      const hi = Math.max(price, fin(q.dayHigh) ? q.dayHigh : 0);
      return { met: hi > f.hi52, known: true, observed: hi, note: sinceListing(f.hiBars, HI52_BARS) };
    }
    case 'low_52w': {
      if (!f || !fin(f.lo52)) return UNKNOWN;
      const lo = fin(q.dayLow) && q.dayLow > 0 ? Math.min(price, q.dayLow) : price;
      return { met: lo < f.lo52, known: true, observed: lo, note: sinceListing(f.hiBars, HI52_BARS) };
    }
    case 'gap_up': case 'gap_down': {
      if (!f || f.day !== today || !fin(f.open) || !f.c.length) return UNKNOWN;
      const base = f.c[f.c.length - 1];
      const gap = (f.open / base - 1) * 100;
      return { met: cond.type === 'gap_up' ? gap >= v : gap <= -v, known: true, observed: gap };
    }
    case 'rel_volume': {
      if (!f || !fin(f.avgVol50) || f.avgVol50 <= 0 || !fin(q.volume)) return UNKNOWN;
      const x = q.volume / f.avgVol50;
      return { met: x >= v, known: true, observed: x, note: volNote(f.volBars) };
    }
    case 'rsi_cross_up': case 'rsi_cross_down': {
      if (!f) return UNKNOWN;
      const r = liveRsi(f.c, price);
      if (r == null) return UNKNOWN;
      return { ...crossing(cond.type === 'rsi_cross_up' ? 'up' : 'down', prev, r - v), observed: r };
    }
    case 'near_52w_high': {
      if (!f || !fin(f.hi52) || f.hi52 <= 0) return UNKNOWN;
      const hi = Math.max(f.hi52, fin(q.dayHigh) ? q.dayHigh : 0, price);
      const pct = (hi - price) / hi * 100;
      return { met: pct <= v, known: true, observed: pct, note: sinceListing(f.hiBars, HI52_BARS) };
    }
  }
  return UNKNOWN;
}

/** Does a condition need the daily figures? (price-level and 1-bar moves work from the live quote alone) */
export function needsDaily(c: AlertCondition, interval: AlertInterval): boolean {
  if (isSignalCond(c)) return false;   // zzz1061 — signals come from the screener snapshot / results / guidance (signals.ts)
  if (c.type === 'price_cross' || c.type === 'price_cross_up' || c.type === 'price_cross_down' || c.type === 'price_above' || c.type === 'price_below') return false;
  if ((c.type === 'move_up_pct' || c.type === 'move_down_pct') && interval === 'D' && (c.bars ?? 1) === 1) return false;
  return true;
}
export const needsOpen = (c: AlertCondition) => c.type === 'gap_up' || c.type === 'gap_down';

export interface AlertEval { met: boolean; known: boolean; states: Array<number | undefined>; observed: Array<number | undefined>; notes?: Array<string | undefined> }
/** All conditions (AND). States are returned for every condition so the next check can see crossings.
 *  zzz1061 — signal (state-change) conditions are NOT checked here: they count as met in this AND, and evaluate.ts adds their own
 *  verdict from lib/alerts/signals.ts (their state lives there, not in this array). */
export function evalAll(conds: readonly AlertCondition[], q: LiveQuote, f: DailyFigs | null, prev: ReadonlyArray<number | undefined>, interval: AlertInterval, today: string): AlertEval {
  let met = true, known = true;
  const states: Array<number | undefined> = [], observed: Array<number | undefined> = [], notes: Array<string | undefined> = [];
  conds.forEach((c, i) => {
    if (isSignalCond(c)) { states.push(undefined); observed.push(undefined); notes.push(undefined); return; }
    const r = evalCondition(c, q, f, prev[i], interval, today);
    states.push(r.state); observed.push(r.observed); notes.push(r.note);
    if (!r.known) known = false;
    if (!r.met) met = false;
  });
  return { met: met && known, known, states, observed, notes };
}

// ── daily figures from bars ─────────────────────────────────────────────────

export interface BarsIn { d: string[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }
const weekOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return new Date(Date.UTC(y, m - 1, d - ((w + 6) % 7))).toISOString().slice(0, 10);
};
/**
 * Completed-bar figures. A bar dated `today` (the market's date) is today's session — left out of the completed set, and its
 * open kept as today's open. Weekly closes leave out the current week.
 */
export function figuresFromBars(b: BarsIn, today: string): DailyFigs | null {
  const n = b.c.length;
  if (!n) return null;
  let end = n;
  let open: number | null = null, day: string | null = null;
  if (b.d[n - 1] === today) { end = n - 1; open = fin(b.o[n - 1]) && b.o[n - 1] > 0 ? b.o[n - 1] : null; day = today; }
  else if (b.d[n - 1] > today) return null;   // bars from the future: clock or data is wrong
  if (end < 1) return null;
  const c = b.c.slice(0, end);
  // zzz1063 (A06) — the 52-week window is 252 sessions. A younger stock gets its whole history, flagged (hiBars < 252) so the
  // condition text says "since listing, N sessions"; under 20 sessions nothing is given. Only sessions with a real high / low count.
  const hIn = b.h.slice(Math.max(0, end - HI52_BARS), end).filter((x) => fin(x) && x > 0);
  const lIn = b.l.slice(Math.max(0, end - HI52_BARS), end).filter((x) => fin(x) && x > 0);
  const hiBars = Math.min(hIn.length, lIn.length);
  // 50-session volume: a session that traded nothing counts as ZERO (it is a real session); a missing value (null / NaN) is
  // left out and the average says how many sessions it used.
  const vol = b.v.slice(Math.max(0, end - AVGVOL_BARS), end).filter((x) => fin(x) && x >= 0);
  const curWeek = weekOf(today);
  const wc: number[] = [];
  let lastWeek = '';
  for (let i = 0; i < end; i++) {
    const wk = weekOf(b.d[i]);
    if (wk >= curWeek) break;
    if (wk === lastWeek) wc[wc.length - 1] = b.c[i]; else { wc.push(b.c[i]); lastWeek = wk; }
  }
  return {
    asOf: b.d[end - 1], day, open,
    c: c.slice(-260),
    hi52: hiBars >= MIN_PARTIAL_BARS ? Math.max(...hIn) : null,
    lo52: hiBars >= MIN_PARTIAL_BARS ? Math.min(...lIn) : null,
    avgVol50: vol.length >= MIN_PARTIAL_BARS ? vol.reduce((s, x) => s + x, 0) / vol.length : null,
    wc: wc.slice(-60),
    v: FIGS_VERSION, hiBars, volBars: vol.length,
  };
}
