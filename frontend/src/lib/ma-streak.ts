// ═══════════════════════════════════════════════════════════════════════════
// zzz1231 — HOW LONG BELOW THE 50 / 200 AVERAGE, AND THE 3-CANDLE LOW. Pure.
//
// The owner (7 Nov 2026): "for holdings below the 50 and 200 EMA, show how
// many candles below, and whether one of the last 3 candles' low is breached."
//
//   days below   consecutive daily closes under the moving average, counted
//                back from the latest completed bar (0 = above it today).
//   since        the first close of that run.
//   3-candle low the lowest low of the 3 bars BEFORE the latest one. The
//                latest close under it = "breached" (a fresh lower low: the
//                short-term support of the last three sessions gave way).
//                The latest bar's own low under it, with the close back above,
//                is "tested" (pierced intraday, recovered).
// Both the exponential (EMA) and the simple (DMA) average are worked out, so a
// table can show the one it already uses.
// ═══════════════════════════════════════════════════════════════════════════
import { ema, sma, type Bar } from './chart-math';

export type MaKind = 'ema' | 'sma';
export interface MaRun { ma: number | null; below: boolean | null; daysBelow: number | null; since: string | null; pct: number | null }
export interface MaStreak {
  close: number | null; at: string | null;
  ema50: MaRun; ema200: MaRun; sma50: MaRun; sma200: MaRun;
  low3: number | null;                  // lowest low of the 3 bars before the latest
  low3State: 'breached' | 'tested' | 'held' | null;
  low3Pct: number | null;               // latest close vs that low, %
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;

function runOf(bars: Bar[], line: (number | null)[]): MaRun {
  const n = bars.length;
  const ma = n ? line[n - 1] : null;
  if (!n || ma == null) return { ma: null, below: null, daysBelow: null, since: null, pct: null };
  const close = bars[n - 1].c;
  let k = 0;
  for (let i = n - 1; i >= 0; i--) {
    const m = line[i];
    if (m == null || !(bars[i].c < m)) break;
    k++;
  }
  return { ma: r2(ma), below: close < ma, daysBelow: k, since: k ? day(bars[n - k].t) : null, pct: r2(((close - ma) / ma) * 100) };
}

export function maStreak(barsIn: Bar[]): MaStreak {
  const bars = barsIn.filter((b) => Number.isFinite(b.c) && b.c > 0);
  const closes = bars.map((b) => b.c);
  const n = bars.length;
  const last = n ? bars[n - 1] : null;
  let low3: number | null = null, low3State: MaStreak['low3State'] = null, low3Pct: number | null = null;
  if (n >= 4 && last) {
    const prev = bars.slice(n - 4, n - 1).map((b) => b.l).filter((v) => Number.isFinite(v) && v > 0);
    if (prev.length === 3) {
      low3 = Math.min(...prev);
      low3State = last.c < low3 ? 'breached' : last.l < low3 ? 'tested' : 'held';
      low3Pct = r2(((last.c - low3) / low3) * 100);
    }
  }
  return {
    close: last ? last.c : null, at: last ? day(last.t) : null,
    ema50: runOf(bars, ema(closes, 50)), ema200: runOf(bars, ema(closes, 200)),
    sma50: runOf(bars, sma(closes, 50)), sma200: runOf(bars, sma(closes, 200)),
    low3: low3 != null ? r2(low3) : null, low3State, low3Pct,
  };
}

/** "12 sessions below (since 2026-10-21)" */
export function daysBelowText(r: MaRun | null | undefined): string {
  if (!r || r.daysBelow == null) return '—';
  if (!r.below) return 'above';
  return `${r.daysBelow} ${r.daysBelow === 1 ? 'session' : 'sessions'}`;
}
export function low3Text(s: MaStreak | null | undefined): string {
  if (!s || !s.low3State) return '—';
  return s.low3State === 'breached' ? '⚠ broken' : s.low3State === 'tested' ? 'tested' : 'held';
}
