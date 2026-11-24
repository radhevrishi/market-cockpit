// Options Ideas — historical study (pure). Walks a company's daily bars one session at a time, asks findSetups() only about the
// bars known on that day (no look-ahead), and follows every signal forward to see what the stock and the chosen option did.
//
// Rules for a simulated trade
//   • fill: a setup already triggered fills at that day's close; otherwise the trigger must trade within FILL_WINDOW sessions
//     (fill at the trigger, or at the open when the stock gaps through it). Not filled = no trade (counted apart).
//   • exit: stop or target 1, whichever is touched first, within HOLD_MAX sessions (both on one bar = stop — the cautious
//     reading). A gap beyond the stop exits at the open. Still open after HOLD_MAX = exit at that close ("timeout").
//   • the same setup on the same company is not counted again within REPEAT_GAP sessions of the last one.
//   • option: the strike / expiry planOption() picks at the fill (model prices on historical volatility, delta 0.5, ≥ 30 days),
//     valued at the exit day with the same volatility. Shows what time decay does to the stock edge. No bid / ask cost.
import { findSetups, type Setup, type SetupId } from './setups';
import { bs, modelVol, planOption } from './options';
import type { PBar } from '../chart-patterns';

export const FILL_WINDOW = 5;
export const HOLD_MAX = 40;
export const REPEAT_GAP = 10;

export interface Trade {
  ticker: string; market: 'US' | 'IN'; id: SetupId; side: 'CALL' | 'PUT';
  signalT: number; fillT: number; exitT: number;
  quality: number; rr1: number; riskPct: number; triggered: boolean;
  outcome: 'target' | 'stop' | 'timeout';
  r: number; mfeR: number; maeR: number; sessions: number;
  /** target 2 reached after target 1 (stop moved to entry once target 1 is hit) */
  hitT2: boolean;
  optRetPct: number | null;
  /** for re-pricing option variants in the study */
  entryPx: number; exitPx: number; heldDays: number; iv: number;
  /** alternative exit: stop to entry once +1R is reached, aim for target 2 (HOLD_MAX sessions) */
  rTrail: number; trailSessions: number; trailExitPx: number;
  features: Record<string, number | string | boolean>;
}
export interface StudyResult { trades: Trade[]; noFill: number; signals: number }

/** bar time → ms (the chart API sends ms; older stores seconds) */
export const barMs = (t: number) => (t > 1e11 ? t : t * 1000);

function smaAt(b: PBar[], end: number, len: number): number | null {
  if (end + 1 < len) return null;
  let s = 0; for (let i = end - len + 1; i <= end; i++) s += b[i].c; return s / len;
}

/** Follow one setup from bar index t (the signal day) in the full series. */
export function simulate(bars: PBar[], t: number, s: Setup, market: 'US' | 'IN', ticker: string): Trade | 'nofill' | null {
  const call = s.side === 'CALL';
  let fi = -1, entry = s.entry;
  if (s.triggered) fi = t;
  else {
    for (let j = t + 1; j <= Math.min(bars.length - 1, t + FILL_WINDOW); j++) {
      const q = bars[j];
      // the stop traded before the trigger → the idea died without a fill
      if (call ? q.l <= s.stop && q.h < s.trigger : q.h >= s.stop && q.l > s.trigger) return 'nofill';
      if (call ? q.h >= s.trigger : q.l <= s.trigger) { fi = j; entry = call ? Math.max(q.o, s.trigger) : Math.min(q.o, s.trigger); break; }
    }
  }
  if (fi < 0) return t + FILL_WINDOW < bars.length ? 'nofill' : null;
  const risk = call ? entry - s.stop : s.stop - entry;
  if (!(risk > 0)) return null;
  const R = (px: number) => (call ? px - entry : entry - px) / risk;
  let outcome: Trade['outcome'] = 'timeout', exitPx = NaN, ei = -1, mfe = 0, mae = 0;
  const last = Math.min(bars.length - 1, fi + HOLD_MAX);
  if (last <= fi && !s.triggered) return null;
  for (let j = fi + (s.triggered ? 1 : 0); j <= last; j++) {
    const q = bars[j];
    if (j === fi) {
      // fill bar of an untriggered setup: only the part after the fill is known — use the close for MFE / MAE, the stop on the low
      const stopHit = call ? q.l <= s.stop && q.c <= s.stop : q.h >= s.stop && q.c >= s.stop;
      if (stopHit) { outcome = 'stop'; exitPx = s.stop; ei = j; break; }
      mfe = Math.max(mfe, R(q.c)); mae = Math.min(mae, R(q.c));
      continue;
    }
    const stopHit = call ? q.l <= s.stop : q.h >= s.stop;
    const tgtHit = call ? q.h >= s.target1 : q.l <= s.target1;
    mfe = Math.max(mfe, R(call ? q.h : q.l)); mae = Math.min(mae, R(call ? q.l : q.h));
    if (stopHit) { outcome = 'stop'; exitPx = call ? Math.min(q.o, s.stop) : Math.max(q.o, s.stop); ei = j; break; }
    if (tgtHit) { outcome = 'target'; exitPx = call ? Math.max(q.o, s.target1) : Math.min(q.o, s.target1); ei = j; break; }
  }
  if (ei < 0) {
    if (last < fi + HOLD_MAX) return null; // not enough future bars yet
    ei = last; exitPx = bars[last].c;
  }
  let hitT2 = false;
  if (outcome === 'target') {
    for (let j = ei + 1; j <= Math.min(bars.length - 1, ei + HOLD_MAX); j++) {
      const q = bars[j];
      if (call ? q.l <= entry : q.h >= entry) break;
      if (call ? q.h >= s.target2 : q.l <= s.target2) { hitT2 = true; break; }
    }
  }
  // alternative exit: break-even stop after +1R, target 2
  let rTrail = NaN, trailSessions = 0, trailExitPx = NaN;
  {
    let st = s.stop, moved = false;
    const lastT = Math.min(bars.length - 1, fi + HOLD_MAX);
    for (let j = fi + 1; j <= lastT; j++) {
      const q = bars[j];
      const sh = call ? q.l <= st : q.h >= st;
      const th = call ? q.h >= s.target2 : q.l <= s.target2;
      if (sh) { trailExitPx = call ? Math.min(q.o, st) : Math.max(q.o, st); trailSessions = j - fi; break; }
      if (th) { trailExitPx = call ? Math.max(q.o, s.target2) : Math.min(q.o, s.target2); trailSessions = j - fi; break; }
      if (!moved && R(call ? q.h : q.l) >= 1) { st = entry; moved = true; }
      if (j === lastT) { trailExitPx = q.c; trailSessions = j - fi; }
    }
    if (Number.isFinite(trailExitPx)) rTrail = Math.round(R(trailExitPx) * 100) / 100;
  }
  // option leg
  let optRetPct: number | null = null;
  try {
    const closes = bars.slice(Math.max(0, fi - 80), fi + 1).map((q) => q.c);
    const now = new Date(barMs(bars[fi].t));
    const plan = planOption({ market, call, spot: entry, entry, stop: s.stop, target1: s.target1, target2: s.target2, expSessions: 12, closes, now, lotSize: 1 });
    if (plan) {
      const iv = modelVol(closes);
      const held = Math.max(0, (barMs(bars[ei].t) - barMs(bars[fi].t)) / 86_400_000);
      const Tleft = Math.max(0, plan.dte - held) / 365;
      const v = bs(exitPx, plan.strike, Tleft, market === 'US' ? 0.04 : 0.065, iv, call).price;
      const p0 = bs(entry, plan.strike, plan.dte / 365, market === 'US' ? 0.04 : 0.065, iv, call).price;
      if (p0 > 0) optRetPct = Math.round(((v - p0) / p0) * 1000) / 10;
    }
  } catch { /* option leg is optional */ }
  const ivAt = modelVol(bars.slice(Math.max(0, fi - 80), fi + 1).map((q) => q.c));
  const b = bars;
  const s50 = smaAt(b, t, 50), s200 = smaAt(b, t, 200);
  const c = b[t].c;
  const ret20 = t >= 20 ? (c / b[t - 20].c - 1) * 100 : 0;
  const ret60 = t >= 60 ? (c / b[t - 60].c - 1) * 100 : 0;
  return {
    ticker, market, id: s.id, side: s.side, signalT: b[t].t, fillT: b[fi].t, exitT: b[ei].t,
    quality: s.quality, rr1: s.rr1, riskPct: s.riskPct, triggered: s.triggered,
    outcome, r: Math.round(R(exitPx) * 100) / 100, mfeR: Math.round(mfe * 100) / 100, maeR: Math.round(mae * 100) / 100, sessions: ei - fi,
    hitT2, optRetPct,
    entryPx: Math.round(entry * 1e4) / 1e4, exitPx: Math.round(exitPx * 1e4) / 1e4, heldDays: Math.round((barMs(bars[ei].t) - barMs(bars[fi].t)) / 86_400_000), iv: Math.round(ivAt * 1000) / 1000,
    rTrail: Number.isFinite(rTrail) ? rTrail : Math.round(R(exitPx) * 100) / 100, trailSessions, trailExitPx: Number.isFinite(trailExitPx) ? Math.round(trailExitPx * 1e4) / 1e4 : Math.round(exitPx * 1e4) / 1e4,
    features: {
      ...s.evidence,
      vs50: s50 ? Math.round((c / s50 - 1) * 1000) / 10 : 0,
      vs200: s200 ? Math.round((c / s200 - 1) * 1000) / 10 : 0,
      ret20: Math.round(ret20 * 10) / 10, ret60: Math.round(ret60 * 10) / 10,
    },
  };
}

/** Walk the series; returns every simulated trade. `from` = first signal index (needs ≥ 260 bars behind it). */
export function study(bars: PBar[], market: 'US' | 'IN', ticker: string, opts: { step?: number; from?: number; window?: number } = {}): StudyResult {
  const step = opts.step ?? 1, win = opts.window ?? 520;
  const from = Math.max(opts.from ?? 260, 260);
  const lastSeen = new Map<SetupId, number>();
  const trades: Trade[] = [];
  let noFill = 0, signals = 0;
  for (let t = from; t < bars.length - 1; t += step) {
    const slice = bars.slice(Math.max(0, t - win + 1), t + 1);
    let found: Setup[] = [];
    try { found = findSetups(slice); } catch { found = []; }
    for (const s of found) {
      const prev = lastSeen.get(s.id);
      if (prev != null && t - prev < REPEAT_GAP) continue;
      lastSeen.set(s.id, t);
      signals++;
      const tr = simulate(bars, t, s, market, ticker);
      if (tr === 'nofill') noFill++;
      else if (tr) trades.push(tr);
    }
  }
  return { trades, noFill, signals };
}

export interface Agg { n: number; wins: number; winRate: number; avgR: number; medSessions: number; t2Rate: number; optAvgRet: number | null; optWinRate: number | null; expectancyR: number }
export function aggregate(ts: Trade[]): Agg {
  const n = ts.length;
  if (!n) return { n: 0, wins: 0, winRate: 0, avgR: 0, medSessions: 0, t2Rate: 0, optAvgRet: null, optWinRate: null, expectancyR: 0 };
  const wins = ts.filter((t) => t.r > 0).length;
  const avgR = ts.reduce((a, t) => a + t.r, 0) / n;
  const hit = ts.filter((t) => t.outcome === 'target').map((t) => t.sessions).sort((a, b) => a - b);
  const op = ts.map((t) => t.optRetPct).filter((x): x is number => x != null);
  return {
    n, wins, winRate: Math.round((wins / n) * 1000) / 10, avgR: Math.round(avgR * 100) / 100,
    medSessions: hit.length ? hit[Math.floor(hit.length / 2)] : 0,
    t2Rate: Math.round((ts.filter((t) => t.hitT2).length / n) * 1000) / 10,
    optAvgRet: op.length ? Math.round((op.reduce((a, b) => a + b, 0) / op.length) * 10) / 10 : null,
    optWinRate: op.length ? Math.round((op.filter((x) => x > 0).length / op.length) * 1000) / 10 : null,
    expectancyR: Math.round(avgR * 100) / 100,
  };
}

/** re-price a past trade with a given option rule (study only): strike nearest |delta|, days to expiry, exit = base or trail */
export function optionReturn(t: Trade, targetDelta: number, dte: number, exit: 'base' | 'trail'): number {
  const call = t.side === 'CALL', r = t.market === 'US' ? 0.04 : 0.065, S = t.entryPx, iv = Math.max(0.18, t.iv || 0.3);
  let K = S, bd = 9;
  for (let k = 0.6; k <= 1.4; k += 0.01) { const d = Math.abs(bs(S, S * k, dte / 365, r, iv, call).delta); if (Math.abs(d - targetDelta) < bd) { bd = Math.abs(d - targetDelta); K = S * k; } }
  const p0 = bs(S, K, dte / 365, r, iv, call).price;
  const px = exit === 'base' ? t.exitPx : t.trailExitPx;
  const days = exit === 'base' ? t.heldDays : Math.round(t.trailSessions * 1.45);
  const p1 = bs(px, K, Math.max(0, dte - days) / 365, r, iv, call).price;
  return p0 > 0 ? (p1 - p0) / p0 : 0;
}
