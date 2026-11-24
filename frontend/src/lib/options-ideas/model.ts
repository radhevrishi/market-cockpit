// Options Ideas — grading a setup with what the historical study learned (pure).
//
// Study (scripts/options-ideas-study.ts): 376 liquid companies (160 US, 216 NSE F&O), Dec 2017 – Nov 2026, every setup found on
// the bars known that day and followed forward: ~44,400 trades. What separated winners from losers:
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
  /** zzz1301e — sector stronger than the index over 3 months (null = unknown), recent catalyst, option richness */
  secStrong?: boolean | null; gap60?: boolean; rvol?: number; hvPct?: number;
  /** zzz1301f — the market's fear gauge that day: VIX (USA) / India VIX */
  vix?: number | null;
}
/** zzz1301f — "fear is high": VIX ≥ 25 (USA) / India VIX ≥ 20. 10-year replay (2018–2026): calls taken in fear made +0.49 R a
 *  trade (+0.57 R even with the market below its 200-day; positive in 8 of 9 years), puts in fear lost −0.55 R (US VIX ≥ 30). */
export const FEAR_VIX: Record<'US' | 'IN', number> = { US: 25, IN: 20 };
export const fearHigh = (m: 'US' | 'IN', vix: number | null | undefined) => vix != null && vix >= FEAR_VIX[m];
export type Grade = 'A+' | 'A' | 'B' | 'C';
export const GRADE_ORDER: Record<Grade, number> = { 'A+': 0, A: 1, B: 2, C: 3 };
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
export function rawFromSetup(s: Setup, market: 'US' | 'IN', bars: PBar[], idx: IndexCtx | null, extra: { secStrong?: boolean | null; gap60?: boolean; rvol?: number; hvPct?: number; vix?: number | null } = {}): RawFeatures {
  const sc = stockCtx(bars, bars.length - 1);
  const ev = s.evidence as Record<string, any>;
  return {
    id: s.id, side: s.side, market, ...sc,
    trend: Number(ev.trend ?? 0), touches: Number(ev.touches ?? 0), vr: Number(ev.vr ?? 1), rr1: s.rr1, riskPct: s.riskPct,
    atrPct: Number(ev.atrPct ?? 0), triggered: s.triggered, idx, ...extra,
  };
}

/** A+: every check plus a catalyst · A: stock, market, sector and near target · B: the stock or the market check fails, not
 *  both · C: neither (or any put) */
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
      { label: `Its sector stronger than the ${bench} over 3 months`, ok: f.secStrong ?? null },
      { label: 'Recent catalyst: a results-style gap up on 2× volume in the last 60 sessions, or 1.3× normal volume today', ok: f.gap60 != null || f.rvol != null ? !!(f.gap60 || (f.rvol ?? 0) >= 1.3) : null },
    ];
    const fear = fearHigh(f.market, f.vix);
    if (f.vix != null) checks.push({ label: `Fear is high (${f.market === 'US' ? 'VIX' : 'India VIX'} ${f.vix.toFixed(1)} ≥ ${FEAR_VIX[f.market]}) — calls bought in fear paid well over 10 years`, ok: fear ? true : null });
    const stockPass = checks[0].ok && checks[1].ok;
    const mktPass = !!idxUp;
    const base = stockPass && mktPass && checks[3].ok && f.secStrong !== false;
    // fear path: in high fear the market / stock checks matter less — calls with a near target are grade A (A+ with a catalyst)
    const fearA = fear && checks[3].ok;
    const grade: Grade = (base || fearA) && checks[5].ok ? 'A+' : base || fearA ? 'A' : stockPass || mktPass ? 'B' : 'C';
    return { grade, strength, regime: idxUp ? 'market up' : idxDown ? 'market down' : 'market mixed', checks,
      verdict: fearA && !base && (grade === 'A' || grade === 'A+') ? 'Trade — fear bounce: calls taken when fear was this high paid +0.49 R a trade over 10 years' : grade === 'A+' ? 'Best trade — every condition plus a fresh catalyst (the strongest group in the study)' : grade === 'A' ? 'Trade — matches the conditions that worked in the study' : grade === 'B' ? 'Watch — a condition that mattered is missing' : 'Avoid — weak stock in a weak market (calls like this lost money)' };
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
export const NO_HISTORY_YET = new Set<string>(['vcp_breakout', 'multiyear_breakout']);
export function finalGrade(f: RawFeatures, c: Classified, groups: Record<string, GroupStats> = STUDY.groups): Classified {
  if (c.grade !== 'A' && c.grade !== 'A+') return c;
  // `A0` = this setup type under the grade-A conditions BEFORE this check (so the table does not feed on itself)
  const h = groups[`${f.market}|${f.id}|A0`];
  // zzz1307 — a setup type added after the replay (VCP) has no history yet: at most B until the study is re-run
  if (!h && NO_HISTORY_YET.has(f.id)) return { ...c, grade: 'B', checks: [...c.checks, { label: 'This setup type has no replay history yet (added after the last study)', ok: false }],
    verdict: 'Watch — new setup type, not yet tested in the replay' };
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
