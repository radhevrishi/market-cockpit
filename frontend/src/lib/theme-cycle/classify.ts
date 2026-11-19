// ═══════════════════════════════════════════════════════════════════════════
// THEME CYCLE — classification + next-cycle watchlist + leadership transitions (zzz1289)
//
// Pure. Reads what Theme Rotation already computes (ThemeRow + its seven evidence layers + flags) and the
// same-window cycle figures, and sorts every theme into one research state:
//
//   CONFIRMED_LEADER · EMERGING_LEADER · EARLY_ROTATION · STABILISING · DEFENSIVE (falling less)
//   · FAILED_TRANSITION · BROKEN (deteriorating) · NOT_READY (beaten down, nothing improving) · NEUTRAL
//
// Evidence is counted in INDEPENDENT dimensions so correlated price signals cannot outvote fundamentals:
//   market (relative strength + price structure — ONE vote), breadth, earnings, catalysts.
//   The volume proxy and valuation are shown as support / context, never counted as a pillar.
// Nothing here is a buy signal, and "falling less" is never treated as future leadership: in the 12 completed
// 15%+ falls researched (India + USA) the sector that fell least beat the market the next year in only ~3.
// ═══════════════════════════════════════════════════════════════════════════

import type { Flag, LayerSet, Ret, ThemeRow } from '../theme-rotation/types';
import type { CycleRef } from './core';

export type CycleState = 'CONFIRMED_LEADER' | 'EMERGING_LEADER' | 'EARLY_ROTATION' | 'STABILISING' | 'DEFENSIVE' | 'FAILED_TRANSITION' | 'BROKEN' | 'NOT_READY' | 'NEUTRAL';

export const STATE_LABEL: Record<CycleState, string> = {
  CONFIRMED_LEADER: 'Confirmed leader',
  EMERGING_LEADER: 'Emerging leader',
  EARLY_ROTATION: 'Early rotation',
  STABILISING: 'Stabilising',
  DEFENSIVE: 'Falling less (defence)',
  FAILED_TRANSITION: 'Failed transition',
  BROKEN: 'Broken / deteriorating',
  NOT_READY: 'Beaten down — not ready',
  NEUTRAL: 'No cycle signal',
};

export const STATE_HELP: Record<CycleState, string> = {
  CONFIRMED_LEADER: 'Ahead of the market over 3 and 6 months, above its 50- and 200-day lines, broad participation. Established — not early.',
  EMERGING_LEADER: 'Relative strength turning up with price structure, AND improving breadth, AND improving earnings or catalysts.',
  EARLY_ROTATION: 'At least two independent pieces of evidence improving, one of them breadth, earnings or catalysts — before price confirms.',
  STABILISING: 'Damaged, but the fall is slowing: relative weakness easing, higher lows or calmer swings. Not enough for an early call.',
  DEFENSIVE: 'Falling less than the market during the fall. Defence, not leadership — history says this rarely leads the next year.',
  FAILED_TRANSITION: 'Was an early / emerging candidate in an earlier week; the evidence has since broken down.',
  BROKEN: 'Weak relative strength, below its 50-day line, and nothing outside price improving.',
  NOT_READY: 'Fell hard but nothing has turned yet. A large fall alone is not a reason to research.',
  NEUTRAL: 'No clear cycle reading either way.',
};

export const STATE_ORDER: Record<CycleState, number> = {
  EMERGING_LEADER: 0, EARLY_ROTATION: 1, STABILISING: 2, CONFIRMED_LEADER: 3, DEFENSIVE: 4, FAILED_TRANSITION: 5, NOT_READY: 6, BROKEN: 7, NEUTRAL: 8,
};

type Dim = 'up' | 'partial' | 'down' | 'flat' | 'unknown';
export interface Dims { market: Dim; breadth: Dim; earnings: Dim; catalysts: Dim; flow: Dim }

export interface CycleRead {
  id: string;
  state: CycleState;
  dims: Dims;
  /** Independent dimensions improving (market counts once). */
  improving: number;
  nonPriceImproving: number;
  confidence: 'High' | 'Medium' | 'Low';
  forEvidence: string[];
  againstEvidence: string[];
  milestone: string;
  invalidation: string;
  /** Excess return vs the benchmark, percentage points. */
  rel4w: number | null; rel12w: number | null; rel26w: number | null;
  /** Previously recorded state (for failed transitions), if any. */
  was?: CycleState | null;
}

const pp = (v: number | null | undefined, dp = 1) => (typeof v === 'number' && isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(dp)}` : 'n/a');
const pctOf = (f: number | null | undefined, dp = 0) => (typeof f === 'number' && isFinite(f) ? `${f > 0 ? '+' : ''}${(f * 100).toFixed(dp)}%` : 'n/a');

/** A layer that improved against an earlier period, on enough names (mirrors detectors.realImprovement). */
function realUp(L: LayerSet, k: keyof LayerSet): boolean {
  const r = L[k];
  return r.state === 'improving' && r.basis !== 'level' && !r.lowConfidence;
}
function layerDim(L: LayerSet, k: keyof LayerSet): Dim {
  const r = L[k];
  if (r.state === 'unknown') return 'unknown';
  if (realUp(L, k)) return 'up';
  if (r.state === 'improving') return 'partial';   // improving, but a level reading or too few names
  if (r.state === 'weakening') return 'down';
  return 'flat';
}

export interface ClassifyInput {
  row: ThemeRow;
  L: LayerSet;
  flags: Flag[];
  bench: Ret | null | undefined;
  ref: CycleRef | null | undefined;
  /** The state recorded for this theme in an earlier week (within ~8 weeks), if any. */
  previous?: CycleState | null;
}

export function classifyCycle(inp: ClassifyInput): CycleRead {
  const { row: t, L, flags, bench, ref } = inp;
  const r = t.ret, c = t.cycle || null;
  const rel = (a?: number, b?: number) => (typeof a === 'number' && typeof b === 'number' ? +(a - b).toFixed(1) : null);
  const rel4w = rel(r?.m1, bench?.m1), rel12w = rel(r?.m3, bench?.m3), rel26w = rel(r?.m6, bench?.m6);
  const mom = t.rsMomentum ?? 100, slope = t.rsSlope ?? 0, d1 = t.rsDelta1w ?? 0;
  const rsImproving = mom >= 100 && (slope > 0 || d1 > 0);
  const rsWeakening = mom < 100 && slope < 0;
  // Relative weakness easing: the last 4 weeks are better than the 12-week average pace (per 4 weeks).
  const weaknessSlowing = rel12w != null && rel4w != null && rel12w < 0 && rel4w > rel12w / 3;
  const structure = !!t.aboveSMA50 || c?.higherLows === true;
  const breakdown = flags.some((f) => f.kind === 'breakdown');
  const shortBreak = flags.some((f) => f.kind === 'short-term-break') || !!t.shortTermBreak;
  const crowded = flags.some((f) => f.kind === 'crowded');

  const market: Dim = rsImproving && structure ? 'up' : (rsImproving || weaknessSlowing || c?.higherLows === true) ? 'partial' : rsWeakening ? 'down' : 'flat';
  const dims: Dims = { market, breadth: layerDim(L, 'breadth'), earnings: layerDim(L, 'earnings'), catalysts: layerDim(L, 'catalysts'), flow: layerDim(L, 'flow') };
  const nonPriceImproving = (['breadth', 'earnings', 'catalysts'] as const).filter((k) => dims[k] === 'up').length;
  const fundUp = dims.earnings === 'up' || dims.catalysts === 'up';
  const improving = (market === 'up' ? 1 : 0) + nonPriceImproving;

  const b = t.breadthStats;
  const share50 = b && b.n ? b.above50 / b.n : null;
  const broad = share50 != null && b!.n >= 5 && share50 >= 0.6;
  const damaged = (c?.ownDD != null && c.ownDD >= 0.10) || (c?.relSincePeak != null && c.relSincePeak <= -5) || (rel12w != null && rel12w <= -5);
  const inCorrection = !!ref && ref.ddMax >= 0.05;
  const fellLess = inCorrection && c?.relFall != null && c.relFall >= 5;

  let state: CycleState;
  const leading = t.quadrant === 'Leading';
  if (leading && (rel12w ?? -1) > 0 && (rel26w ?? -1) > 0 && t.aboveSMA50 && (c?.dist200 == null || c.dist200 > 0) && broad && !breakdown && !shortBreak) state = 'CONFIRMED_LEADER';
  else if (market === 'up' && nonPriceImproving >= 2 && fundUp && dims.breadth !== 'down' && !breakdown) state = 'EMERGING_LEADER';
  else if ((market === 'up' || market === 'partial') && nonPriceImproving >= 1 && improving + (market === 'partial' ? 1 : 0) >= 2 && !breakdown && c?.nearLow !== true) state = 'EARLY_ROTATION';
  else if (inp.previous && (inp.previous === 'EARLY_ROTATION' || inp.previous === 'EMERGING_LEADER') && (market === 'down' || breakdown)) state = 'FAILED_TRANSITION';
  else if (fellLess && !breakdown) state = 'DEFENSIVE';
  else if (damaged && (weaknessSlowing || c?.higherLows === true || (c?.volRatio != null && c.volRatio < 0.85)) && c?.nearLow !== true && !breakdown) state = 'STABILISING';
  else if ((breakdown || (rsWeakening && !t.aboveSMA50 && (rel12w ?? 0) < 0)) && nonPriceImproving === 0) state = 'BROKEN';
  else if (damaged && nonPriceImproving === 0) state = 'NOT_READY';
  else state = 'NEUTRAL';

  // ── evidence, in words ──
  const forE: string[] = [], against: string[] = [];
  if (rsImproving) forE.push(`Relative strength turning up (RS-momentum ${mom.toFixed(1)}, slope ${pp(slope, 2)})`);
  else if (weaknessSlowing) forE.push(`Relative weakness easing (4 weeks ${pp(rel4w)} pts vs 12 weeks ${pp(rel12w)} pts)`);
  if (rsWeakening) against.push(`Relative strength still falling (RS-momentum ${mom.toFixed(1)})`);
  if (t.aboveSMA50) forE.push(`Above its 50-day line${t.dist50 != null ? ` (${pp(t.dist50)}%)` : ''}`); else against.push(`Below its 50-day line${t.dist50 != null ? ` (${pp(t.dist50)}%)` : ''}`);
  if (c?.higherLows === true) forE.push('Higher lows over the last two 4-week blocks');
  if (c?.higherLows === false) against.push('Still making lower lows');
  if (c?.volRatio != null && c.volRatio < 0.85) forE.push(`Swings calming (20-day volatility ${Math.round(c.volRatio * 100)}% of 60-day)`);
  if (c?.nearLow) against.push('Within 3% of its one-year low');
  for (const k of ['breadth', 'earnings', 'catalysts'] as const) {
    const d = dims[k], h = L[k].headline;
    if (d === 'up') forE.push(`${k[0].toUpperCase()}${k.slice(1)}: ${h}`);
    else if (d === 'down') against.push(`${k[0].toUpperCase()}${k.slice(1)}: ${h}`);
    else if (d === 'unknown') against.push(`${k[0].toUpperCase()}${k.slice(1)}: no data`);
  }
  if (dims.flow === 'up') forE.push('Volume leaning to up days (a proxy, not fund-flow data)');
  if (breakdown) against.push('Breakdown flag (below the 50-day line with participation collapsing)');
  if (shortBreak) against.push(`Short-term break${t.shortTermBreakWhy ? ` — ${t.shortTermBreakWhy}` : ''}`);
  if (crowded) against.push('Crowded / stretched move');
  if (b && b.n < 5) against.push(`Breadth rests on only ${b.n} stocks`);

  // ── next milestone + invalidation ──
  const low = c?.ownLow ? ` (${c.ownLow})` : '';
  const milestones: Record<CycleState, string> = {
    EMERGING_LEADER: `Three months ahead of the market (now ${pp(rel12w)} pts) with at least 60% of members above their 50-day line${share50 != null ? ` (now ${Math.round(share50 * 100)}%)` : ''}.`,
    EARLY_ROTATION: `${t.aboveSMA50 ? 'Hold the 50-day line' : 'Reclaim and hold the 50-day line'} and add a second outside-price improvement (${(['breadth', 'earnings', 'catalysts'] as const).filter((k) => dims[k] !== 'up').join(' / ') || 'keep them improving'}).`,
    STABILISING: 'Relative strength turns up (RS-momentum above 100) AND one of breadth / earnings / catalysts improves.',
    DEFENSIVE: 'For leadership it needs a rising price of its own plus improving breadth or earnings — falling less is not enough.',
    CONFIRMED_LEADER: 'Watch for crowding: breadth narrowing while price rises, or a close below the 50-day line.',
    FAILED_TRANSITION: 'Start again: relative strength back above 100 with an outside-price improvement.',
    BROKEN: 'Stop falling relative to the market first (higher lows, weakness easing).',
    NOT_READY: 'Any genuine improvement: higher lows, relative weakness easing, or breadth / earnings turning.',
    NEUTRAL: '—',
  };
  const invalid: Record<CycleState, string> = {
    EMERGING_LEADER: `Close below the 50-day line with RS-momentum back under 100, or breadth turning down.`,
    EARLY_ROTATION: `A new low below its correction low${low}, or RS-momentum falling while breadth / earnings weaken.`,
    STABILISING: `A new low below its correction low${low}.`,
    DEFENSIVE: 'The market recovers and this theme lags it (defence unwinding).',
    CONFIRMED_LEADER: 'Close below the 50-day line with breadth below 50%.',
    FAILED_TRANSITION: '—', BROKEN: '—', NOT_READY: '—', NEUTRAL: '—',
  };

  const unknowns = (['breadth', 'earnings', 'catalysts'] as const).filter((k) => dims[k] === 'unknown').length;
  const lowSample = !!b && b.n < 5;
  const confidence: CycleRead['confidence'] = lowSample || unknowns >= 2 ? 'Low' : (improving >= 3 && fundUp && !!b && b.n >= 5) ? 'High' : 'Medium';

  return { id: t.id, state, dims, improving, nonPriceImproving, confidence, forEvidence: forE, againstEvidence: against, milestone: milestones[state], invalidation: invalid[state], rel4w, rel12w, rel26w, was: inp.previous ?? null };
}

/** Watchlist order: state, then independent improvements, then fundamentals present, then 4-week relative strength. */
export function watchlistOrder(a: CycleRead, b: CycleRead): number {
  return STATE_ORDER[a.state] - STATE_ORDER[b.state]
    || b.improving - a.improving
    || Number(b.dims.earnings === 'up' || b.dims.catalysts === 'up') - Number(a.dims.earnings === 'up' || a.dims.catalysts === 'up')
    || (b.rel4w ?? -99) - (a.rel4w ?? -99);
}

export const WATCH_STATES: CycleState[] = ['EMERGING_LEADER', 'EARLY_ROTATION', 'STABILISING'];

// ── POTENTIAL LEADERSHIP TRANSITIONS ───────────────────────────────────────

export interface Transition {
  from: string; to: string;
  basis: 'moves together' | 'same group' | 'same group, moves together';
  rsGap4w: number;
  fromRel4w: number; toRel4w: number;
  breadthFrom: number | null; breadthTo: number | null;
  earningsFrom: Dim; earningsTo: Dim;
  confidence: 'Medium' | 'Low';
  against: string[];
  invalidation: string;
}

/**
 * Pairs only between RELATED themes (same correlation cluster or same group): a former leader losing relative
 * strength and a neighbour gaining it. Never a claim that money moved — only relative-strength divergence.
 */
export function leadershipTransitions(rows: ThemeRow[], reads: Map<string, CycleRead>, max = 5): Transition[] {
  const out: Transition[] = [];
  const share = (t: ThemeRow) => (t.breadthStats && t.breadthStats.n ? Math.round((t.breadthStats.above50 / t.breadthStats.n) * 100) : null);
  const losing = rows.filter((t) => {
    const r = reads.get(t.id);
    const wasLeading = t.quadrant4w === 'Leading' || t.quadrant === 'Weakening';
    return r && wasLeading && (t.rsSlope ?? 0) < 0 && (r.rel4w ?? 0) < 0;
  });
  const gaining = rows.filter((t) => {
    const r = reads.get(t.id);
    return r && (r.state === 'EARLY_ROTATION' || r.state === 'EMERGING_LEADER' || (t.quadrant === 'Improving' && (t.rsSlope ?? 0) > 0)) && (r.rel4w ?? 0) > 0;
  });
  for (const a of losing) for (const b of gaining) {
    if (a.id === b.id) continue;
    const sameCluster = a.cluster != null && a.cluster === b.cluster;
    const sameGroup = !!a.group && a.group === b.group;
    if (!sameCluster && !sameGroup) continue;
    const ra = reads.get(a.id)!, rb = reads.get(b.id)!;
    const gap = +((rb.rel4w ?? 0) - (ra.rel4w ?? 0)).toFixed(1);
    if (gap < 4) continue;
    const against: string[] = [];
    if (rb.dims.earnings !== 'up' && rb.dims.catalysts !== 'up') against.push(`${b.name}: no earnings or catalyst improvement yet`);
    if (rb.dims.breadth === 'down' || rb.dims.breadth === 'unknown') against.push(`${b.name}: breadth ${rb.dims.breadth === 'down' ? 'weakening' : 'not measured'}`);
    if (!b.aboveSMA50) against.push(`${b.name}: still below its 50-day line`);
    out.push({
      from: a.id, to: b.id,
      basis: sameCluster && sameGroup ? 'same group, moves together' : sameCluster ? 'moves together' : 'same group',
      rsGap4w: gap, fromRel4w: ra.rel4w ?? 0, toRel4w: rb.rel4w ?? 0,
      breadthFrom: share(a), breadthTo: share(b), earningsFrom: ra.dims.earnings, earningsTo: rb.dims.earnings,
      confidence: against.length === 0 && sameCluster ? 'Medium' : 'Low',
      against,
      invalidation: `${b.name} loses relative strength again (4-week return back below the market) or ${a.name} regains it.`,
    });
  }
  out.sort((x, y) => y.rsGap4w - x.rsGap4w);
  const seen = new Set<string>();
  return out.filter((t) => { if (seen.has(t.to)) return false; seen.add(t.to); return true; }).slice(0, max);
}

// ── SUMMARY ────────────────────────────────────────────────────────────────

export interface CycleSummary {
  mostDamaged: string[];   // worst relative return since the benchmark high
  fallingLess: string[];   // best relative return over the fall
  stabilising: string[];
  early: string[];
  candidates: string[];    // emerging + early, in watchlist order
  confirmed: string[];
  recoveryLeaders: string[]; // best return from the benchmark's low to now
  failed: string[];
}

export function cycleSummary(rows: ThemeRow[], reads: Map<string, CycleRead>): CycleSummary {
  const byRel = rows.filter((t) => t.cycle?.relSincePeak != null);
  const ids = (st: CycleState[]) => [...reads.values()].filter((r) => st.includes(r.state)).sort(watchlistOrder).map((r) => r.id);
  return {
    mostDamaged: [...byRel].sort((a, b) => a.cycle!.relSincePeak! - b.cycle!.relSincePeak!).slice(0, 5).map((t) => t.id),
    fallingLess: rows.filter((t) => t.cycle?.relFall != null).sort((a, b) => b.cycle!.relFall! - a.cycle!.relFall!).slice(0, 5).map((t) => t.id),
    stabilising: ids(['STABILISING']),
    early: ids(['EARLY_ROTATION']),
    candidates: ids(['EMERGING_LEADER', 'EARLY_ROTATION']),
    confirmed: ids(['CONFIRMED_LEADER']),
    recoveryLeaders: rows.filter((t) => t.cycle?.fromTrough != null).sort((a, b) => b.cycle!.fromTrough! - a.cycle!.fromTrough!).slice(0, 5).map((t) => t.id),
    failed: ids(['FAILED_TRANSITION']),
  };
}

export { pctOf };
