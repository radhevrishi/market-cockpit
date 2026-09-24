// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION — PRICE/VOLUME SERIES METRICS  (zzz795)
//
// Pure functions over daily close and volume series. The route calls them on
// the constituents of every theme; the tests call them on fixtures. Nothing
// here fetches or caches.
//
// Every function returns null (or a zero count) rather than a guessed number
// when the series is too short to answer. A missing answer must stay missing
// all the way to the screen, where it reads "not available".
// ═══════════════════════════════════════════════════════════════════════════

import type { BreadthStats, FlowStats } from './types';

export interface Series { closes: Array<number | null>; volumes?: Array<number | null> | null }

/** Aligned [close, volume] pairs with nulls/NaNs dropped (volume may be null). */
function clean(s: Series): Array<[number, number | null]> {
  const out: Array<[number, number | null]> = [];
  const vols = s.volumes || [];
  for (let i = 0; i < s.closes.length; i++) {
    const c = s.closes[i];
    if (c == null || !Number.isFinite(c) || c <= 0) continue;
    const v = vols[i];
    out.push([c, v != null && Number.isFinite(v) && v >= 0 ? v : null]);
  }
  return out;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Simple moving average of the closes ending `offset` bars before the last. */
export function smaAt(closes: number[], period: number, offset = 0): number | null {
  const end = closes.length - offset;
  if (end < period || end <= 0) return null;
  return mean(closes.slice(end - period, end));
}

export interface MemberStat {
  /** zzz797 — above its own 20-day average. */
  above20?: boolean | null;
  /** zzz797 — above its own 200-day average (null: under 200 sessions). */
  above200?: boolean | null;
  above50: boolean | null;
  above50Prev: boolean | null;
  /** % change over ~3 months (63 sessions). */
  m3: number | null;
  nearHigh: boolean | null;
  nearLow: boolean | null;
}

/** Per-member participation facts from one daily series. */
export function memberStat(s: Series): MemberStat {
  const p = clean(s).map((x) => x[0]);
  const n = p.length;
  const last = p[n - 1];
  const s50 = smaAt(p, 50, 0);
  const s50p = smaAt(p, 50, 20);
  const prev20 = n > 20 ? p[n - 21] : null;
  const m3 = n > 63 && p[n - 64] > 0 ? ((last - p[n - 64]) / p[n - 64]) * 100 : null;
  let nearHigh: boolean | null = null, nearLow: boolean | null = null;
  if (n >= 120) {
    const win = p.slice(Math.max(0, n - 252));
    const hi = Math.max(...win), lo = Math.min(...win);
    nearHigh = last >= hi * 0.98;
    nearLow = last <= lo * 1.02;
  }
  const s20 = smaAt(p, 20, 0);
  const s200 = smaAt(p, 200, 0);
  return {
    above20: s20 != null ? last > s20 : null,
    above200: s200 != null ? last > s200 : null,
    above50: s50 != null ? last > s50 : null,
    above50Prev: s50p != null && prev20 != null ? prev20 > s50p : null,
    m3: m3 != null ? +m3.toFixed(2) : null,
    nearHigh, nearLow,
  };
}

/** Aggregate member facts into the theme's breadth. `bench3m` is the
 *  benchmark's own 3-month return, so "outperforming" is measured honestly. */
export function aggregateBreadth(stats: MemberStat[], bench3m: number | null): BreadthStats | null {
  const priced = stats.filter((s) => s.above50 != null);
  if (!priced.length) return null;
  const withPrev = priced.filter((s) => s.above50Prev != null);
  return {
    n: priced.length,
    above50: priced.filter((s) => s.above50).length,
    // Only claimed when every priced member has a four-week-old reading; a
    // partial comparison would compare different populations.
    above50Prev: withPrev.length === priced.length ? withPrev.filter((s) => s.above50Prev).length : null,
    outperf: bench3m == null ? 0 : priced.filter((s) => s.m3 != null && s.m3 > bench3m).length,
    newHighs: priced.filter((s) => s.nearHigh === true).length,
    newLows: priced.filter((s) => s.nearLow === true).length,
    // zzz797 — short- and long-term participation for the breadth heatmap.
    // The 200-day read has its own sample size: a member with under 200
    // sessions of history is left out of it rather than counted as "below".
    above20: priced.filter((s) => s.above20 === true).length,
    above200: priced.filter((s) => s.above200 === true).length,
    n200: priced.filter((s) => s.above200 != null).length,
  };
}

/** Volume facts for one series: relative volume and the share traded on up days. */
export function volumeFacts(s: Series): { relVol: number | null; upShare: number | null; upSharePrev: number | null; dollarVol20: number | null } {
  const p = clean(s);
  const withVol = p.filter((x) => x[1] != null && (x[1] as number) > 0);
  // Indices on Yahoo often carry zero or no volume. Require a real series.
  if (withVol.length < 60 || withVol.length < p.length * 0.8) return { relVol: null, upShare: null, upSharePrev: null, dollarVol20: null };
  const n = p.length;
  const vol = (i: number) => (p[i][1] ?? 0);
  const upShareOver = (from: number, to: number) => {
    let up = 0, tot = 0;
    for (let i = Math.max(1, from); i < to; i++) {
      const v = vol(i);
      tot += v;
      if (p[i][0] > p[i - 1][0]) up += v;
    }
    return tot > 0 ? up / tot : null;
  };
  const last20 = mean(p.slice(n - 20).map((x) => x[1] ?? 0));
  const prior60 = n >= 80 ? mean(p.slice(n - 80, n - 20).map((x) => x[1] ?? 0)) : null;
  const relVol = last20 != null && prior60 && prior60 > 0 ? +(last20 / prior60).toFixed(2) : null;
  const upShare = upShareOver(n - 20, n);
  const upSharePrev = n >= 41 ? upShareOver(n - 40, n - 20) : null;
  const dollarVol20 = last20 != null ? last20 * p[n - 1][0] : null;
  return {
    relVol,
    upShare: upShare != null ? +upShare.toFixed(3) : null,
    upSharePrev: upSharePrev != null ? +upSharePrev.toFixed(3) : null,
    dollarVol20,
  };
}

/**
 * Theme-level flow proxy. Prefers the theme's own ETF volume (one clean
 * series); otherwise combines members, weighting each by its traded value so
 * a micro-cap does not move the read as much as a leader.
 */
export function aggregateFlow(etf: Series | null, members: Series[]): FlowStats {
  if (etf) {
    const f = volumeFacts(etf);
    if (f.relVol != null && f.upShare != null) return { relVol: f.relVol, upShare: f.upShare, upSharePrev: f.upSharePrev, basis: 'etf' };
  }
  const facts = members.map(volumeFacts).filter((f) => f.relVol != null && f.upShare != null && f.dollarVol20 != null && f.dollarVol20 > 0);
  if (facts.length < 2) return { relVol: null, upShare: null, upSharePrev: null, basis: 'none' };
  const w = facts.reduce((a, f) => a + (f.dollarVol20 as number), 0);
  const wavg = (g: (f: typeof facts[number]) => number | null) => {
    let s = 0, ww = 0;
    for (const f of facts) { const v = g(f); if (v == null) continue; s += v * (f.dollarVol20 as number); ww += f.dollarVol20 as number; }
    return ww > 0 ? s / ww : null;
  };
  const rel = wavg((f) => f.relVol), up = wavg((f) => f.upShare), upPrev = wavg((f) => f.upSharePrev);
  return {
    relVol: rel != null && w > 0 ? +rel.toFixed(2) : null,
    upShare: up != null ? +up.toFixed(3) : null,
    upSharePrev: upPrev != null ? +upPrev.toFixed(3) : null,
    basis: 'members',
  };
}
