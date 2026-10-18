// zzz992 — daily → weekly / monthly OHLCV aggregation for chart-pattern analysis (pure; no fetch, no React).
//
// Rules
//  • Periods: ISO weeks (Monday–Sunday) and calendar months, both on the UTC DATE of each daily bar's timestamp
//    (the chart API stamps a session with its UTC open time, e.g. 03:45 UTC for NSE, 13:30/14:30 UTC for US, so the UTC
//    date is the trading date). Holidays need no calendar: a period simply has fewer daily bars; a period with no bars
//    does not exist.
//  • open = first daily open, high = max high, low = min low, close = last daily close.
//  • volume = sum of the daily volumes, but MISSING (NaN) as soon as any daily bar of the period lacks a usable volume
//    (non-finite, zero or negative). A partial sum would understate the period's volume and could look like a volume
//    dry-up; missing keeps the pattern engine's CP-04 rule ("deleting volume can never raise a score") true on W / M.
//  • The aggregated bar's time `t` = the time of the FIRST daily bar of the period (TradingView convention: a weekly
//    candle sits at the week's first session).
//  • The current period (one whose close boundary has not passed at `now`) is PROVISIONAL. A period closes at 00:00 UTC
//    of the day after its last weekday (Mon–Fri): the Saturday 00:00 UTC after a week, the day after the month's last
//    weekday for a month — after both the NSE and the US Friday close. With completedOnly (default) it is dropped.
//  • Invalid daily bars (no bar, non-finite / non-positive close, non-finite time, a time not after the previous one, or an
//    open / high / low that is a non-finite NUMBER — the same rule as chart-patterns cleanBars) are REJECTED and counted.
//  • zzz998 — nothing is repaired silently: a missing / non-positive open / high / low (taken from the close) or a high / low
//    that does not contain the open and close (widened to contain them) is REPAIRED and counted (`repaired`), so a caller can
//    tell clean data from mended data (the screener marks a scan 'invalid-data' when too many bars were rejected).
import type { PBar } from './chart-patterns';
import { weekCloseMs } from './completed-weeks';
import { rangeCloseUtc } from './exchange-calendar';

export type AggTf = 'W' | 'M';
export interface AggregateOptions {
  /** drop the current, incomplete period (default true) */
  completedOnly?: boolean;
  /** the clock used to decide whether the latest period is complete (default: new Date()) */
  now?: Date;
  /** zzz1079 (B04) — the exchange: the period is complete at the close of its LAST session (holidays and early closes from
   *  lib/exchange-calendar — the same clock as the weekly stage / setups). Without it: 00:00 UTC after its last weekday. */
  market?: 'IN' | 'US' | null;
}
export interface AggregateResult {
  bars: PBar[];
  /** true when the LAST returned bar is the current, still-incomplete period (only possible with completedOnly = false) */
  provisional: boolean;
  /** time of the last DAILY bar inside the last returned period (its actual end), null when nothing is returned */
  periodEnd: number | null;
  /** time of the latest valid daily bar supplied (the data timestamp), null when none */
  latestT: number | null;
  /** an incomplete current period existed and was dropped (completedOnly) */
  droppedProvisional: boolean;
  /** daily bars skipped as invalid (same number as `rejected`, kept for older callers) */
  skipped: number;
  /** zzz998 — daily bars dropped as invalid */
  rejected: number;
  /** zzz998 — daily bars kept but mended (open / high / low filled from the close, or high / low widened to contain open and close) */
  repaired: number;
  /** zzz998 — daily bars supplied (valid or not) */
  supplied: number;
}

const DAY = 86_400_000;

/** Period key of a timestamp: ISO-week number since the epoch (Monday start) or year·12 + month. */
export function periodKey(t: number, tf: AggTf): number {
  if (tf === 'W') return Math.floor((Math.floor(t / DAY) + 3) / 7);   // 1970-01-01 is a Thursday → +3 makes Monday the first day
  const d = new Date(t);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** The instant a period is complete. With a market: the close of the period's last session on that exchange (a Friday
 *  holiday → the Thursday close; a month ending on a holiday → its last trading day's close). Without: 00:00 UTC of the day
 *  after its last weekday. */
export function periodCloseT(t: number, tf: AggTf, market?: 'IN' | 'US' | null): number {
  if (market === 'IN' || market === 'US') {
    if (tf === 'W') return weekCloseMs(t, market);
    const d = new Date(t);
    const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    return rangeCloseUtc(market, from, to);
  }
  const day = Math.floor(t / DAY);
  if (tf === 'W') {
    const monday = (Math.floor((day + 3) / 7) * 7) - 3;   // day number of that week's Monday
    return (monday + 5) * DAY;                             // Saturday 00:00 UTC
  }
  const d = new Date(t);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  let last = next - DAY;   // last calendar day of the month
  while ([0, 6].includes(new Date(last).getUTCDay())) last -= DAY;
  return last + DAY;
}

export function aggregateBars(daily: PBar[], tf: AggTf, opts?: AggregateOptions): AggregateResult {
  const completedOnly = opts?.completedOnly !== false;
  const now = (opts?.now ?? new Date()).getTime();
  const out: PBar[] = [];
  const ends: number[] = [];
  let skipped = 0, repaired = 0, supplied = 0, lastT = -Infinity, latestT: number | null = null;
  const badNum = (x: unknown) => typeof x === 'number' && !Number.isFinite(x);
  let key: number | null = null;
  let cur: PBar | null = null, curEnd = 0, volOk = true;
  const flush = () => {
    if (!cur) return;
    out.push({ ...cur, v: volOk ? cur.v : NaN });
    ends.push(curEnd);
  };
  for (const b of daily || []) {
    supplied++;
    const t = Number(b?.t), c = Number(b?.c);
    if (!b || !Number.isFinite(t) || !Number.isFinite(c) || !(c > 0) || t <= lastT || badNum(b.o) || badNum(b.h) || badNum(b.l)) { skipped++; continue; }
    lastT = t; latestT = t;
    let o = Number(b.o), h = Number(b.h), l = Number(b.l);
    let fixed = false;
    if (!(o > 0)) { o = c; fixed = true; }
    if (!(h > 0)) { h = Math.max(o, c); fixed = true; }
    if (!(l > 0)) { l = Math.min(o, c); fixed = true; }
    if (h < Math.max(o, c) || l > Math.min(o, c)) fixed = true;
    h = Math.max(h, o, c); l = Math.min(l, o, c);
    if (fixed) repaired++;
    const v = Number(b.v);
    const vGood = Number.isFinite(v) && v > 0;
    const k = periodKey(t, tf);
    if (k !== key) {
      flush();
      key = k; cur = { t, o, h, l, c, v: vGood ? v : 0 }; curEnd = t; volOk = vGood;
    } else if (cur) {
      if (h > cur.h) cur.h = h;
      if (l < cur.l) cur.l = l;
      cur.c = c; curEnd = t;
      if (vGood) cur.v += v; else volOk = false;
    }
  }
  flush();
  let provisional = false, dropped = false;
  if (out.length) {
    const lastOpen = now < periodCloseT(ends[ends.length - 1], tf, opts?.market);
    if (lastOpen) {
      if (completedOnly) { out.pop(); ends.pop(); dropped = true; } else provisional = true;
    }
  }
  return { bars: out, provisional, periodEnd: ends.length ? ends[ends.length - 1] : null, latestT, droppedProvisional: dropped, skipped, rejected: skipped, repaired, supplied };
}
