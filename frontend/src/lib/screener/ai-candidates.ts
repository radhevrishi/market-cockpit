// zzz1178 — real company data for the AI research panels (Choke-Point Themes, Future 100-baggers), from the stock-screener
// snapshot the site already holds. The AI picks from these and states figures from these, so every name is a real listed
// company and every number is the screener's. This file is pure (safe for the browser); loadCands lives in ai-candidates-load.ts.
export type CandMarket = 'US' | 'IN';
export interface Cand {
  t: string; n: string; ind: string | null; mc: number;           // $ M (US) / ₹ Cr (India)
  revQ: number | null; revA: number | null; epsQ: number | null; opm: number | null; gm: number | null; roce: number | null; roe: number | null;
  de: number | null; pe: number | null; ps: number | null; fcfm: number | null; p1y: number | null; p5y: number | null; bb: number | null; fs: number | null;
}
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function toCand(r: any): Cand | null {
  if (!r?.t || typeof r.mc !== 'number' || r.mc <= 0) return null;
  return {
    t: String(r.t).toUpperCase(), n: String(r.n || r.t).slice(0, 48), ind: r.ind ?? r.sec ?? null, mc: r.mc,
    revQ: n(r.revQYoY), revA: n(r.revAYoY), epsQ: n(r.epsQYoY), opm: n(r.opmTTM ?? r.opmFY), gm: n(r.gmFY), roce: n(r.roceTTM ?? r.roceFY), roe: n(r.roeTTM ?? r.roeFY),
    de: n(r.de ?? r.deFY), pe: n(r.pe), ps: n(r.ps), fcfm: n(r.fcfmTTM), p1y: n(r.perf1Y), p5y: n(r.perf5Y), bb: n(r.bb), fs: n(r.fs),
  };
}

const r0 = (v: number | null, suf = '%') => (v == null ? '—' : `${Math.round(v)}${suf}`);
export const capText = (mc: number, m: CandMarket) => (m === 'US' ? (mc >= 1000 ? `$${(mc / 1000).toFixed(1)}B` : `$${Math.round(mc)}M`) : `₹${Math.round(mc).toLocaleString('en-IN')} Cr`);
/** One compact line per company for the prompt. */
export const candLine = (c: Cand, m: CandMarket) =>
  `${c.t} | ${c.n} | ${c.ind || '—'} | cap ${capText(c.mc, m)} | sales q ${r0(c.revQ)} yr ${r0(c.revA)} | EPS q ${r0(c.epsQ)} | op margin ${r0(c.opm)} | ROCE ${r0(c.roce)} | D/E ${c.de == null ? '—' : c.de.toFixed(1)} | P/E ${c.pe == null ? '—' : Math.round(c.pe)} | P/S ${c.ps == null ? '—' : c.ps.toFixed(1)} | FCF margin ${r0(c.fcfm)} | 1y ${r0(c.p1y)} 5y ${r0(c.p5y)} | share count ${c.bb == null ? '—' : `${c.bb > 0 ? 'down' : 'up'} ${Math.abs(c.bb).toFixed(1)}%`}`;

/** $500M–$5B (USA) / ₹4,250–42,500 Cr (India, at ~₹85/$). */
export const HB_CAP: Record<CandMarket, [number, number]> = { US: [500, 5000], IN: [4250, 42500] };

/** The 100-bagger shortlist the AI chooses from: in the size band, growing, returns on capital, not over-indebted,
 *  not heavily diluting, not already priced for perfection — ranked by a simple growth × quality × runway score. Pure. */
export function hundredBaggerShortlist(all: Cand[], m: CandMarket, max = 140): Cand[] {
  const [lo, hi] = HB_CAP[m];
  const ok = all.filter((c) => c.mc >= lo && c.mc <= hi
    && (c.revA ?? c.revQ ?? -1) >= 12
    && (c.de == null || c.de <= 1.2)
    && (c.bb == null || c.bb >= -8)                       // share count up no more than 8% a year
    && (c.ps == null || c.ps <= 25)                       // not priced for perfection
    && (c.p1y == null || c.p1y <= 400));
  const sc = (c: Cand) => {
    const g = Math.min(60, Math.max(c.revA ?? 0, (c.revQ ?? 0) * 0.8));
    const q = Math.min(40, Math.max(0, c.roce ?? c.roe ?? 0)) + Math.min(25, Math.max(0, c.opm ?? 0)) * 0.6 + Math.min(20, Math.max(0, c.fcfm ?? 0)) * 0.5;
    const accel = c.revQ != null && c.revA != null && c.revQ > c.revA + 5 ? 8 : 0;
    const val = c.ps != null && c.ps > 12 ? -10 : 0;
    return g + q + accel + val + (c.fs != null ? c.fs : 4);
  };
  return ok.sort((a, b) => sc(b) - sc(a)).slice(0, max);
}

/** Industry-level inflection read for the theme panel: where revenue is ACCELERATING and margins rising, and how far
 *  shares already ran (5-year) — early (accelerating, not yet run) vs crowded (run a lot). The MU / SNDK pattern before
 *  their big runs: pricing turned, quarterly revenue jumped above the yearly trend, margins swung up, shares still cheap. Pure. */
export function industryInflections(all: Cand[], m: CandMarket, max = 30): string[] {
  const by = new Map<string, Cand[]>();
  for (const c of all) if (c.ind && c.mc >= (m === 'US' ? 300 : 1000)) by.set(c.ind, [...(by.get(c.ind) || []), c]);
  const med = (a: Array<number | null>) => { const v = a.filter((x): x is number => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const rows = [...by.entries()].filter(([, cs]) => cs.length >= 4).map(([ind, cs]) => {
    const revQ = med(cs.map((c) => c.revQ)), revA = med(cs.map((c) => c.revA)), opm = med(cs.map((c) => c.opm)), p1y = med(cs.map((c) => c.p1y)), p5y = med(cs.map((c) => c.p5y));
    const accel = cs.filter((c) => c.revQ != null && c.revA != null && c.revQ >= c.revA + 10).length / cs.length;
    const top = [...cs].sort((a, b) => (b.revQ ?? -999) - (a.revQ ?? -999)).slice(0, 4).map((c) => c.t);
    return { ind, n: cs.length, revQ, revA, opm, p1y, p5y, accel, top };
  }).filter((r) => r.revQ != null).sort((a, b) => b.accel - a.accel || (b.revQ ?? 0) - (a.revQ ?? 0)).slice(0, max);
  return rows.map((r) => `${r.ind} (${r.n} cos) | sales growth: quarter ${r0(r.revQ)} vs year ${r0(r.revA)} | ${Math.round(r.accel * 100)}% of companies accelerating | op margin ${r0(r.opm)} | shares 1y ${r0(r.p1y)} 5y ${r0(r.p5y)} | fastest: ${r.top.join(', ')}`);
}
