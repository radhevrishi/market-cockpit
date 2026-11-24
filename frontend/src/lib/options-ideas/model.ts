// Options Ideas — grading a setup with what the historical study learned (pure).
//
// Study (scripts/options-ideas-study.ts): 376 liquid companies (160 US, 216 NSE F&O), Dec 2022 – Nov 2026, every setup found on
// the bars known that day and followed forward: ~21,700 trades. What separated winners from losers:
//   • CALLS worked when the STOCK was healthy (above its 200-day average and stronger than the index over 3 months) AND the
//     MARKET was healthy (index above its 200-day and up over the last 20 sessions). Those trades were positive both before and
//     after July 2025 (the hold-out period). Calls in weak stocks or a falling market were not.
//   • Nearer targets (reward : risk up to ~3) held up better than far ones.
//   • PUTS on single stocks lost money in every condition tried — including falling markets (sharp bear-market rallies stop them
//     out). They are shown as watch / hedge ideas, never as trades.
// The grade is a rule a person can check; the numbers shown with it come from the study (model-coeffs.ts, generated).
import type { PBar } from '../chart-patterns';
import type { Setup, SetupId } from './setups';
import { STUDY } from './model-coeffs';

export interface IndexCtx { vs200: number; ret20: number; ret60: number }
export interface RawFeatures {
  id: SetupId; side: 'CALL' | 'PUT'; market: 'US' | 'IN';
  ret20: number; ret60: number; vs50: number; vs200: number;
  trend: number; touches: number; vr: number; rr1: number; riskPct: number; atrPct: number; triggered: boolean;
  idx: IndexCtx | null;
}
export type Grade = 'A' | 'B' | 'C';
export interface Check { label: string; ok: boolean | null }
export interface Classified { grade: Grade; strength: string; regime: string; checks: Check[]; verdict: string }

const sma = (b: PBar[], end: number, n: number) => { if (end + 1 < n) return null; let s = 0; for (let i = end - n + 1; i <= end; i++) s += b[i].c; return s / n; };
/** stock context at bar index t (same formulas as the study) */
export function stockCtx(b: PBar[], t: number): { ret20: number; ret60: number; vs50: number; vs200: number } {
  const c = b[t].c, s50 = sma(b, t, 50), s200 = sma(b, t, 200);
  return {
    ret20: t >= 20 ? (c / b[t - 20].c - 1) * 100 : 0, ret60: t >= 60 ? (c / b[t - 60].c - 1) * 100 : 0,
    vs50: s50 ? (c / s50 - 1) * 100 : 0, vs200: s200 ? (c / s200 - 1) * 100 : 0,
  };
}
const ms = (t: number) => (t > 1e11 ? t : t * 1000);
/** benchmark (SPY / NIFTYBEES) context on the last bar at or before time tMs */
export function indexCtx(idx: PBar[], tMs: number): IndexCtx | null {
  let lo = 0, hi = idx.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ms(idx[m].t) <= tMs + 6 * 3600_000) { k = m; lo = m + 1; } else hi = m - 1; }
  if (k < 200) return null;
  const s = stockCtx(idx, k);
  return { vs200: s.vs200, ret20: s.ret20, ret60: s.ret60 };
}
export function rawFromSetup(s: Setup, market: 'US' | 'IN', bars: PBar[], idx: IndexCtx | null): RawFeatures {
  const sc = stockCtx(bars, bars.length - 1);
  const ev = s.evidence as Record<string, any>;
  return {
    id: s.id, side: s.side, market, ...sc,
    trend: Number(ev.trend ?? 0), touches: Number(ev.touches ?? 0), vr: Number(ev.vr ?? 1), rr1: s.rr1, riskPct: s.riskPct,
    atrPct: Number(ev.atrPct ?? 0), triggered: s.triggered, idx,
  };
}

/** A: every check passes · B: the stock or the market check fails, not both · C: neither (or any put) */
export const MAX_RR_A = 3;
export function classify(f: RawFeatures): Classified {
  const rs = f.idx ? f.ret60 - f.idx.ret60 : null;
  const idxUp = f.idx ? f.idx.vs200 > 0 && f.idx.ret20 > 0 : null;
  const idxDown = f.idx ? f.idx.vs200 < 0 : null;
  const bench = f.market === 'US' ? 'S&P 500 (SPY)' : 'Nifty 50 (NIFTYBEES)';
  if (f.side === 'CALL') {
    const stockOk = f.vs200 > 0 && (rs == null ? null : rs > 0);
    const strength = f.vs50 > 3 && f.vs200 > 0 && rs != null && rs > 10 ? 'leader' : stockOk ? 'healthy' : 'weak';
    const checks: Check[] = [
      { label: 'Stock above its 200-day average', ok: f.vs200 > 0 },
      { label: `Stock stronger than the ${bench} over 3 months`, ok: rs == null ? null : rs > 0 },
      { label: `${bench} above its 200-day average and up over 20 sessions`, ok: idxUp },
      { label: `Target within ${MAX_RR_A}× the risk (far targets were hit less often)`, ok: f.rr1 <= MAX_RR_A },
    ];
    const stockPass = checks[0].ok && checks[1].ok;
    const mktPass = !!idxUp;
    const grade: Grade = stockPass && mktPass && checks[3].ok ? 'A' : stockPass || mktPass ? 'B' : 'C';
    return { grade, strength, regime: idxUp ? 'market up' : idxDown ? 'market down' : 'market mixed', checks,
      verdict: grade === 'A' ? 'Trade — matches the conditions that worked in the study' : grade === 'B' ? 'Watch — one condition that mattered is missing' : 'Avoid — weak stock in a weak market (calls like this lost money)' };
  }
  const weak = f.vs200 < 0 && (rs == null ? false : rs < 0);
  const checks: Check[] = [
    { label: 'Stock below its 200-day average', ok: f.vs200 < 0 },
    { label: `Stock weaker than the ${bench} over 3 months`, ok: rs == null ? null : rs < 0 },
    { label: `${bench} below its 200-day average`, ok: idxDown },
    { label: `Target within ${MAX_RR_A}× the risk`, ok: f.rr1 <= MAX_RR_A },
  ];
  const grade: Grade = weak && idxDown ? 'B' : 'C';
  return { grade, strength: f.vs50 < -3 && weak && rs != null && rs < -10 ? 'laggard' : weak ? 'soft' : 'strong', regime: idxUp ? 'market up' : idxDown ? 'market down' : 'market mixed', checks,
    verdict: grade === 'B' ? 'Hedge / watch only — single-stock puts lost money in the study even in this setup' : 'Avoid — puts against a stock or market that is not weak lost money in the study' };
}

/** Grade A also needs this setup type's own grade-A history (same market) to have paid: ≥ 50 trades and ≥ +0.1 R a trade.
 *  (study: India downtrend breaks / trend bounces in grade A conditions made ~0 R; US breakout retests +0.41 R) */
export const SETUP_MIN_R = 0.1, SETUP_MIN_N = 50;
export function finalGrade(f: RawFeatures, c: Classified, groups: Record<string, GroupStats> = STUDY.groups): Classified {
  if (c.grade !== 'A') return c;
  // `A0` = this setup type under the grade-A conditions BEFORE this check (so the table does not feed on itself)
  const h = groups[`${f.market}|${f.id}|A0`];
  if (!h || h.n < SETUP_MIN_N || h.trailR >= SETUP_MIN_R) return c;
  return { ...c, grade: 'B', checks: [...c.checks, { label: `This setup type has paid in these conditions (${f.market === 'US' ? 'USA' : 'India'}: ${h.trailR > 0 ? '+' : ''}${h.trailR} R a trade over ${h.n} past trades)`, ok: false }],
    verdict: 'Watch — conditions are right, but this setup type has not paid in them before' };
}

export interface GroupStats { n: number; winRate: number; avgR: number; trailR: number; medSessions: number; optAvgRet: number | null; optWinRate: number | null; trainR: number; testR: number; trainOpt: number | null; testOpt: number | null }
/** study numbers for the setup's group: same market, side and grade; then the same setup type within that */
export function historyFor(f: RawFeatures, grade: Grade): { group: GroupStats | null; setup: GroupStats | null; groupKey: string; setupKey: string } {
  const groupKey = `${f.market}|${f.side}|${grade}`, setupKey = `${f.market}|${f.id}|${grade}`;
  return { group: STUDY.groups[groupKey] ?? null, setup: STUDY.groups[setupKey] ?? null, groupKey, setupKey };
}

export interface StudyStats {
  version: string;
  groups: Record<string, GroupStats>;
  /** sample trades for the page ("how winners and losers behaved") */
  examples: Array<{ market: 'US' | 'IN'; ticker: string; id: SetupId; grade: Grade; date: string; r: number; outcome: string; sessions: number; optRet: number | null }>;
  option: { delta: number; minDte: number; note: string };
  trainedOn: { trades: number; companies: number; from: string; to: string; testFrom: string };
  findings: string[];
}
