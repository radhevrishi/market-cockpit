// zzz1178 — real company data for the AI research panels (Choke-Point Themes, Future 100-baggers), from the stock-screener
// snapshot the site already holds. The AI picks from these and states figures from these, so every name is a real listed
// company and every number is the screener's. This file is pure (safe for the browser); loadCands lives in ai-candidates-load.ts.
export type CandMarket = 'US' | 'IN';
export interface Cand {
  t: string; n: string; ind: string | null; mc: number;           // $ M (US) / ₹ Cr (India)
  revQ: number | null; revA: number | null; epsQ: number | null; opm: number | null; opmFY?: number | null; gm: number | null; roce: number | null; roe: number | null;
  de: number | null; pe: number | null; ps: number | null; fcfm: number | null; p1y: number | null; p5y: number | null; bb: number | null; fs: number | null;
}
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function toCand(r: any): Cand | null {
  if (!r?.t || typeof r.mc !== 'number' || r.mc <= 0) return null;
  return {
    t: String(r.t).toUpperCase(), n: String(r.n || r.t).slice(0, 48), ind: r.ind ?? r.sec ?? null, mc: r.mc,
    revQ: n(r.revQYoY), revA: n(r.revAYoY), epsQ: n(r.epsQYoY), opm: n(r.opmTTM ?? r.opmFY), opmFY: n(r.opmFY), gm: n(r.gmFY), roce: n(r.roceTTM ?? r.roceFY), roe: n(r.roeTTM ?? r.roeFY),
    de: n(r.de ?? r.deFY), pe: n(r.pe), ps: n(r.ps), fcfm: n(r.fcfmTTM), p1y: n(r.perf1Y), p5y: n(r.perf5Y), bb: n(r.bb), fs: n(r.fs),
  };
}

const r0 = (v: number | null, suf = '%') => (v == null ? '—' : `${Math.round(v)}${suf}`);
export const capText = (mc: number, m: CandMarket) => (m === 'US' ? (mc >= 1000 ? `$${(mc / 1000).toFixed(1)}B` : `$${Math.round(mc)}M`) : `₹${Math.round(mc).toLocaleString('en-IN')} Cr`);
/** One compact line per company for the prompt. */
export const candLine = (c: Cand, m: CandMarket) =>
  `${c.t} | ${c.n} | ${c.ind || '—'} | cap ${capText(c.mc, m)} | sales q ${r0(c.revQ)} yr ${r0(c.revA)} | EPS q ${r0(c.epsQ)} | op margin TTM ${r0(c.opm)}${c.opmFY != null && c.opm != null && Math.abs(c.opm - c.opmFY) >= 15 ? ` (last FY ${r0(c.opmFY)} — TTM likely includes one-offs)` : ''} | ROCE ${r0(c.roce)} | D/E ${c.de == null ? '—' : c.de.toFixed(1)} | P/E ${c.pe == null ? '—' : Math.round(c.pe)} | P/S ${c.ps == null ? '—' : c.ps.toFixed(1)} | FCF margin ${r0(c.fcfm)} | 1y ${r0(c.p1y)} 5y ${r0(c.p5y)} | share count ${c.bb == null ? '—' : `${c.bb > 0 ? 'down' : 'up'} ${Math.abs(c.bb).toFixed(1)}%`}`;

/** $500M–$5B (USA) / ₹4,250–42,500 Cr (India, at ~₹85/$). */
export const HB_CAP: Record<CandMarket, [number, number]> = { US: [500, 5000], IN: [4250, 42500] };

/** zzz1186 — the owner's conditions as hard gates (the AI is not trusted to apply them): in the size band, growing,
 *  profitable at the operating level, self-funding, modest debt, no chronic dilution, returns on capital, not priced for
 *  perfection, not already a multi-bagger. Returns the reasons a company fails (empty = passes). Pure. */
export const HB_FINANCIAL_RE = /insur|bank|savings|finance|lending|reit|real estate investment|capital market|broker|asset manag|mortgage|credit|investment|holding compan|nbfc|stockbrok/i;
export function hbGateFails(c: Cand, m: CandMarket): string[] {
  // zzz1187 — gates on what disqualifies (not on what the AI must judge): too strict a set left 52 US names, mostly insurers.
  // Lenders / insurers are left out (their margins and cash flows are float, not operating cash). Returns on capital and
  // margins are judged in the score caps, not used to throw out early-stage growers.
  const [lo, hi] = HB_CAP[m], f: string[] = [];
  if (c.mc < lo || c.mc > hi) f.push('outside the size band');
  if (c.ind && HB_FINANCIAL_RE.test(c.ind)) f.push('lender / insurer (float, not operating cash)');
  const grow = (c.revA != null && c.revA >= 15) || (c.revQ != null && c.revQ >= 25 && (c.revA == null || c.revA >= 5));
  if (!grow) f.push('sales growth under 15% (or a quarter under 25%)');
  if (c.opm != null && c.opm <= 0) f.push('loss-making at the operating level');
  if (c.fcfm != null && c.fcfm < -10) f.push(`burns cash (FCF margin ${Math.round(c.fcfm)}%)`);
  if (c.de != null && c.de > 1.0) f.push(`debt/equity ${c.de.toFixed(1)}`);
  if (c.bb != null && c.bb < -5) f.push(`share count up ${Math.abs(c.bb).toFixed(1)}% a year`);
  if (c.ps != null && c.ps > 20) f.push(`P/S ${c.ps.toFixed(1)}`);
  if (c.pe != null && c.pe > 100) f.push(`P/E ${Math.round(c.pe)}`);
  if (c.p1y != null && c.p1y > 250) f.push('up more than 3.5x in a year');
  if (c.p5y != null && c.p5y > 400) f.push(`already up ${Math.round(c.p5y / 100 + 1)}x in 5 years`);
  return f;
}

/** The 100-bagger shortlist the AI chooses from: in the size band, growing, returns on capital, not over-indebted,
 *  not heavily diluting, not already priced for perfection — ranked by a simple growth × quality × runway score. Pure. */
export function hundredBaggerShortlist(all: Cand[], m: CandMarket, max = 140): Cand[] {
  const [lo, hi] = HB_CAP[m];
  // zzz1186 — the owner's conditions as hard gates (the AI is not trusted to apply them): growing, profitable at the operating
  // level, self-funding (no real cash burn), modest debt, no chronic dilution, returns on capital, not priced for perfection,
  // not already a multi-bagger.
  const ok = all.filter((c) => !hbGateFails(c, m).length);
  const sc = (c: Cand) => {
    const g = Math.min(60, Math.max(c.revA ?? 0, (c.revQ ?? 0) * 0.8));
    const q = Math.min(40, Math.max(0, c.roce ?? c.roe ?? 0)) + Math.min(25, Math.max(0, c.opm ?? 0)) * 0.6 + Math.min(20, Math.max(0, c.fcfm ?? 0)) * 0.5;
    const accel = c.revQ != null && c.revA != null && c.revQ > c.revA + 5 ? 8 : 0;
    const val = c.ps != null && c.ps > 12 ? -10 : 0;
    const hidden = c.mc <= lo + (hi - lo) * 0.4 ? 6 : c.mc >= lo + (hi - lo) * 0.75 ? -8 : 0;   // "hidden": the smaller half of the band first
    return g + q + accel + val + hidden + (c.fs != null ? c.fs : 4);
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
