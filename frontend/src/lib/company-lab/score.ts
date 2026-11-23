// ═══════════════════════════════════════════════════════════════════════════
// COMPANY LAB — one overall score (zzz1293). Pure; India and USA alike.
//
// Weights come from a check of what last year's winners looked like (stock-screener snapshot, 23 Nov 2026, small and
// mid caps only: India ₹500–50,000 Cr, 1,592 companies; USA $0.3–20B, 2,561 companies; winners = the top 10% by
// one-year return). Share of winners vs share of all companies meeting each test:
//   India: EPS growth 25%+ 79% vs 44% · revenue growth (quarter) 20%+ 82% vs 52% · EBITDA growth 25%+ 81% vs 48% ·
//          Rule of 40 ≥ 30 57% vs 37% · operating margin 12%+ 50% vs 43% · FCF margin 5%+ 22% vs 31% (LOWER) ·
//          debt ÷ equity ≤ 0.5 66% vs 67% (no difference)
//   USA:   EPS growth 1.3×, revenue growth 1.5×, EBITDA growth 1.6× more common among winners; operating margin, FCF
//          margin and F-score LESS common (fast growers invest and many are still loss-making).
//   Both:  in Stage 2 98% / 86% of winners vs 43% / 40% of all (this one is partly the winners' own price move).
// So growth carries the most weight, the chart is second, margins third, and cash / balance-sheet strength is a SAFETY
// pillar: it does not lift a score much (winners are often cash-hungry) but serious problems pull it down.
// This is what winners looked like at the end of their run, not a forward test — our data keeps no point-in-time history.
//
//   Growth 35 · Price strength 25 · Margin momentum 15 · Safety (cash, debt, squeeze, dilution) 25
// Balance rules (one strong pillar cannot hide a broken one):
//   • growth pillar under 30 → total at most 60     • safety pillar under 30 → total at most 65
//   • Stage 4 (downtrend) → total at most 55        • fewer than half the inputs known → pulled halfway to 50, said so
// ═══════════════════════════════════════════════════════════════════════════

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
/** piecewise-linear map through (x, y) points, x ascending */
function ramp(x: number, pts: Array<[number, number]>): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); }
  return pts[pts.length - 1][1];
}

export interface ScoreInput {
  revQ: number | null; revQLowBase?: boolean; accel: string | null;
  epsG: number | null; epsSwing?: 'loss-to-profit' | 'profit-to-loss' | null; revY: number | null;
  r40: number | null;
  om: number | null; omChg: number | null; gmChg: number | null;
  fcfPassed: number; fcfKnown: number; fcfM: number | null; cfoPat: number | null; de: number | null;
  squeeze: 'Low' | 'Watch' | 'High' | 'Unknown' | null; squeezeCombo?: boolean; dilution: number | null;
  stage: number | null; tt: number | null; rs: number | null;
}
export interface Pillar { id: 'growth' | 'price' | 'margin' | 'safety'; label: string; weight: number; score: number | null; known: number; total: number; why: string[] }
export interface LabScore { score: number | null; grade: 'A' | 'B' | 'C' | 'D' | '—'; pillars: Pillar[]; caps: string[]; coverage: number; summary: string }

function pillar(id: Pillar['id'], label: string, weight: number, parts: Array<{ v: number | null; w: number; why: string }>): Pillar {
  const k = parts.filter((p) => p.v != null);
  const tw = k.reduce((a, p) => a + p.w, 0);
  const score = tw ? Math.round(k.reduce((a, p) => a + (p.v as number) * p.w, 0) / tw) : null;
  return { id, label, weight, score, known: k.length, total: parts.length, why: k.map((p) => `${p.why} → ${Math.round(p.v as number)}`) };
}

export function labScore(x: ScoreInput): LabScore {
  // GROWTH — revenue (latest quarter), EPS (latest year), trend, Rule of 40
  const revQ = fin(x.revQ) ? clamp(ramp(x.revQ, [[-20, 0], [0, 15], [10, 40], [20, 60], [30, 75], [50, 90], [80, 100]]) - (x.revQLowBase ? 15 : 0)) : null;
  const eps = x.epsSwing === 'loss-to-profit' ? 75 : x.epsSwing === 'profit-to-loss' ? 5
    : fin(x.epsG) ? ramp(clamp(x.epsG, -100, 300), [[-50, 0], [0, 20], [15, 45], [25, 65], [50, 85], [100, 100]]) : null;
  const tr = x.accel === 'accelerating' ? 90 : x.accel === 'steady' ? 60 : x.accel === 'uneven' ? 45 : x.accel === 'decelerating' ? 30 : null;
  const r40 = fin(x.r40) ? ramp(x.r40, [[-20, 0], [0, 20], [20, 50], [40, 80], [60, 100]]) : null;
  const revY = revQ == null && fin(x.revY) ? ramp(x.revY, [[-20, 0], [0, 15], [10, 40], [20, 60], [30, 75], [50, 90]]) : null;
  const growth = pillar('growth', 'Growth', 35, [
    { v: revQ, w: 3, why: `revenue ${fin(x.revQ) ? `${x.revQ > 0 ? '+' : ''}${x.revQ.toFixed(0)}%` : '—'} (quarter)${x.revQLowBase ? ', low base' : ''}` },
    { v: revY, w: 3, why: `revenue ${fin(x.revY) ? `${x.revY > 0 ? '+' : ''}${x.revY.toFixed(0)}%` : '—'} (year)` },
    { v: eps, w: 3, why: x.epsSwing ? `EPS ${x.epsSwing.replace(/-/g, ' ')}` : `EPS ${fin(x.epsG) ? `${x.epsG > 0 ? '+' : ''}${x.epsG.toFixed(0)}%` : '—'} (year)` },
    { v: tr, w: 2, why: `trend ${x.accel ?? '—'}` },
    { v: r40, w: 2, why: `Rule of 40 ${fin(x.r40) ? x.r40.toFixed(0) : '—'}` },
  ]);
  // PRICE STRENGTH — stage, trend template, RS rating
  const st = x.stage === 2 ? 100 : x.stage === 1 ? 45 : x.stage === 3 ? 30 : x.stage === 4 ? 0 : null;
  const price = pillar('price', 'Price strength', 25, [
    { v: st, w: 4, why: `Stage ${x.stage ?? '—'}` },
    { v: fin(x.tt) ? (x.tt / 6) * 100 : null, w: 3, why: `trend template ${x.tt ?? '—'}/6` },
    { v: fin(x.rs) ? x.rs : null, w: 3, why: `RS ${fin(x.rs) ? Math.round(x.rs) : '—'}` },
  ]);
  // MARGIN MOMENTUM — level and direction (operating leverage)
  const omLvl = fin(x.om) ? ramp(x.om, [[-10, 0], [0, 25], [10, 55], [20, 80], [30, 95]]) : null;
  const omMove = fin(x.omChg) ? ramp(x.omChg, [[-5, 0], [-1, 35], [1, 60], [3, 85], [6, 100]]) : null;
  const gmMove = fin(x.gmChg) ? ramp(x.gmChg, [[-5, 10], [-1, 40], [1, 60], [4, 90]]) : null;
  const margin = pillar('margin', 'Margin momentum', 15, [
    { v: omLvl, w: 2, why: `operating margin ${fin(x.om) ? `${x.om.toFixed(0)}%` : '—'}` },
    { v: omMove, w: 3, why: `operating margin move ${fin(x.omChg) ? `${x.omChg > 0 ? '+' : ''}${x.omChg.toFixed(1)} pts` : '—'}` },
    { v: gmMove, w: 1, why: `gross margin move ${fin(x.gmChg) ? `${x.gmChg > 0 ? '+' : ''}${x.gmChg.toFixed(1)} pts` : '—'}` },
  ]);
  // SAFETY — clean = about 70; only serious problems pull it far down (winners are often cash-hungry)
  const fcfC = x.fcfKnown >= 3 ? 30 + (x.fcfPassed / x.fcfKnown) * 60 : null;
  const cp = fin(x.cfoPat) ? ramp(x.cfoPat, [[-0.5, 0], [0, 20], [0.5, 50], [0.8, 75], [1.1, 90]]) : null;
  const de = fin(x.de) ? ramp(x.de, [[0, 90], [0.5, 80], [1, 55], [1.5, 30], [2.5, 5]]) : null;
  const sq = x.squeeze === 'Low' ? 85 : x.squeeze === 'Watch' ? 55 : x.squeeze === 'High' ? (x.squeezeCombo ? 5 : 20) : null;
  const dil = fin(x.dilution) ? ramp(x.dilution, [[-5, 95], [2, 85], [8, 55], [15, 25], [30, 0]]) : null;
  const safety = pillar('safety', 'Safety', 25, [
    { v: fcfC, w: 2, why: `FCF checks ${x.fcfPassed}/${x.fcfKnown}` },
    { v: cp, w: 2, why: `CFO/PAT ${fin(x.cfoPat) ? x.cfoPat.toFixed(2) : '—'}` },
    { v: de, w: 2, why: `debt ÷ equity ${fin(x.de) ? x.de.toFixed(2) : '—'}` },
    { v: sq, w: 3, why: `cash squeeze ${x.squeeze ?? '—'}${x.squeezeCombo ? ' ⚡' : ''}` },
    { v: dil, w: 2, why: `dilution ${fin(x.dilution) ? `${x.dilution > 0 ? '+' : ''}${x.dilution.toFixed(0)}%` : '—'}` },
  ]);
  const pillars = [growth, price, margin, safety];
  const known = pillars.filter((p) => p.score != null);
  if (!known.length) return { score: null, grade: '—', pillars, caps: [], coverage: 0, summary: 'not enough figures for a score' };
  const tw = known.reduce((a, p) => a + p.weight, 0);
  let s = known.reduce((a, p) => a + (p.score as number) * p.weight, 0) / tw;
  const caps: string[] = [];
  const cap = (lim: number, why: string) => { if (s > lim) { s = lim; caps.push(why); } };
  if (growth.score != null && growth.score < 30) cap(60, 'growth weak — capped at 60');
  if (safety.score != null && safety.score < 30) cap(65, 'cash / balance sheet weak — capped at 65');
  if (x.stage === 4) cap(55, 'Stage 4 downtrend — capped at 55');
  const inputs = pillars.reduce((a, p) => a + p.total, 0), have = pillars.reduce((a, p) => a + p.known, 0);
  const coverage = Math.round((have / inputs) * 100) / 100;
  if (coverage < 0.5) { s = 50 + (s - 50) * 0.5; caps.push(`only ${have} of ${inputs} inputs known — pulled toward 50`); }
  const score = Math.round(s);
  const grade = score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D';
  const best = known.slice().sort((a, b) => (b.score as number) - (a.score as number))[0], worst = known.slice().sort((a, b) => (a.score as number) - (b.score as number))[0];
  const summary = `${grade} · strongest: ${best.label.toLowerCase()} ${best.score}, weakest: ${worst.label.toLowerCase()} ${worst.score}${caps.length ? ` · ${caps.join('; ')}` : ''}`;
  return { score, grade, pillars, caps, coverage, summary };
}
