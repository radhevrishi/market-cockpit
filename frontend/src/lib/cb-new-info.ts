// zzz887 — "NEW INFORMATION" score for Conviction Beats.
//
// A good result is not the same as NEW information. The bench ranks by how much this filing changed what is known about the
// company: did management raise guidance, did growth beat AND speed up, did margins turn, is the profit backed by cash, and is
// this the second or third strong quarter in a row (persistence)? Price does not add points — it only CONFIRMS (or not) what
// the numbers say, shown beside the score. Profit growth driven by other income or one-off items is discounted.
//
// Every point has a reason, and the "why this rank" line is built from the same reasons. Missing data scores zero for that
// part and says so — never a guess. Pure and unit-tested.

export interface NewInfoInput {
  sales_yoy_pct?: number | null; net_profit_yoy_pct?: number | null; eps_yoy_pct?: number | null;
  opm_pct?: number | null; opm_prev_pct?: number | null;
  quarters_sales?: (number | null)[] | null; quarters_opm?: (number | null)[] | null;   // oldest → newest
  annual_cfo_pat?: (number | null)[] | null;                                          // oldest → newest
  guidance?: string | null; guidance_score?: number | null;
  other_income_pct_sales_curr?: number | null; exceptional_pct_pbt?: number | null;
  d1_pct?: number | null; move_pct?: number | null;
  /** a verified guidance raise from Guidance Upgrades for this company (optional) */
  guidanceRaised?: boolean | null;
}

export interface NewInfoPart { key: 'guidance' | 'beat' | 'acceleration' | 'margin' | 'cash' | 'persistence' | 'quality'; points: number; text: string }
export type PriceCheck = 'CONFIRMS' | 'NOT_YET' | 'FADED' | 'NO_PRICE';
export interface NewInfoScore { score: number; parts: NewInfoPart[]; price: PriceCheck; priceText: string; why: string; missing: string[] }

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const sgn = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;
const lastN = (a: (number | null)[] | null | undefined) => (Array.isArray(a) ? a : []);

/** YoY growth of the newest quarter and the one before it, from an oldest→newest series (needs 6+ quarters). */
export function yoySeries(q: (number | null)[] | null | undefined): number[] {
  const a = lastN(q); const out: number[] = [];
  for (let i = 4; i < a.length; i++) { const c = a[i], p = a[i - 4]; if (num(c) && num(p) && p > 0) out.push(((c - p) / p) * 100); else out.push(NaN); }
  return out;
}

export function newInfoScore(e: NewInfoInput): NewInfoScore {
  const parts: NewInfoPart[] = []; const missing: string[] = [];
  // 1. guidance change — the clearest new information (0–25)
  if (e.guidanceRaised) parts.push({ key: 'guidance', points: 25, text: 'guidance raised (verified)' });
  else if (num(e.guidance_score) || e.guidance) {
    const g = num(e.guidance_score) ? e.guidance_score : e.guidance === 'Positive' ? 0.5 : e.guidance === 'Negative' ? -0.5 : 0;
    const p = Math.round(Math.max(-15, Math.min(18, g * 18)));
    if (p !== 0) parts.push({ key: 'guidance', points: p, text: p > 0 ? 'positive outlook from management' : 'cautious outlook from management' });
  } else missing.push('guidance');

  // 2. the beat itself (0–20): growth, capped so a tiny base cannot dominate
  const s = e.sales_yoy_pct, pr = e.net_profit_yoy_pct;
  if (num(s) || num(pr)) {
    const sp = num(s) ? Math.max(0, Math.min(10, s / 4)) : 0;
    const pp = num(pr) ? Math.max(0, Math.min(10, pr / 6)) : 0;
    const p = Math.round(sp + pp);
    if (p > 0) parts.push({ key: 'beat', points: p, text: [num(s) ? `sales ${sgn(s, 0)}%` : null, num(pr) ? `profit ${sgn(pr, 0)}%` : null].filter(Boolean).join(', ') });
  } else missing.push('growth');

  // 3. acceleration (−8 … +15): newest quarter's YoY sales growth vs the quarter before
  const ys = yoySeries(e.quarters_sales).filter(num);
  if (ys.length >= 2) {
    const d = ys[ys.length - 1] - ys[ys.length - 2];
    const p = Math.round(Math.max(-8, Math.min(15, d / 2)));
    if (Math.abs(d) >= 3) parts.push({ key: 'acceleration', points: p, text: d > 0 ? `growth sped up (${ys[ys.length - 2].toFixed(0)}% → ${ys[ys.length - 1].toFixed(0)}%)` : `growth slowed (${ys[ys.length - 2].toFixed(0)}% → ${ys[ys.length - 1].toFixed(0)}%)` });
  } else missing.push('quarterly history');

  // 4. margin inflection (−10 … +15)
  if (num(e.opm_pct) && num(e.opm_prev_pct)) {
    const d = e.opm_pct - e.opm_prev_pct;
    const p = Math.round(Math.max(-10, Math.min(15, d * 2.5)));
    if (Math.abs(d) >= 0.5) parts.push({ key: 'margin', points: p, text: `${d > 0 ? 'margin up' : 'margin down'} ${sgn(d)} pts (${e.opm_prev_pct.toFixed(1)}% → ${e.opm_pct.toFixed(1)}%)` });
  } else missing.push('margin');

  // 5. cash backs profit (−10 … +10): latest annual CFO / PAT
  const cp = lastN(e.annual_cfo_pat).filter(num);
  if (cp.length) {
    const r = cp[cp.length - 1];
    const p = r >= 1 ? 10 : r >= 0.8 ? 6 : r >= 0.5 ? 0 : r >= 0 ? -6 : -10;
    parts.push({ key: 'cash', points: p, text: r >= 0.8 ? `cash backs profit (CFO/PAT ${r.toFixed(2)})` : `profit not backed by cash (CFO/PAT ${r.toFixed(2)})` });
  } else missing.push('cash flow');

  // 6. persistence (0–15): how many of the last 4 quarters grew sales 15%+ YoY, and margins not falling
  if (ys.length >= 2) {
    const last4 = ys.slice(-4); const strong = last4.filter((v) => v >= 15).length;
    const p = Math.round((strong / Math.max(1, last4.length)) * 12);
    const om = lastN(e.quarters_opm).filter(num); const opmUp = om.length >= 3 && om[om.length - 1] >= om[om.length - 2] && om[om.length - 2] >= om[om.length - 3];
    const tot = Math.min(15, p + (opmUp ? 3 : 0));
    if (tot > 0) parts.push({ key: 'persistence', points: tot, text: `${strong} of the last ${last4.length} quarters grew 15%+${opmUp ? ', margins rising 3 quarters' : ''}` });
  }

  // 7. quality of the profit (0 … −15): other income / one-off items
  let q = 0; const qt: string[] = [];
  if (num(e.other_income_pct_sales_curr) && e.other_income_pct_sales_curr > 10) { q -= Math.min(8, Math.round((e.other_income_pct_sales_curr - 10) / 2) + 3); qt.push(`other income ${e.other_income_pct_sales_curr.toFixed(0)}% of sales`); }
  if (num(e.exceptional_pct_pbt) && Math.abs(e.exceptional_pct_pbt) > 15 && e.exceptional_pct_pbt > 0) { q -= Math.min(7, Math.round(e.exceptional_pct_pbt / 10) + 2); qt.push(`one-off items ${e.exceptional_pct_pbt.toFixed(0)}% of pre-tax profit`); }
  if (q < 0) parts.push({ key: 'quality', points: q, text: `profit flattered: ${qt.join(', ')}` });

  const raw = parts.reduce((a, p) => a + p.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  // price is confirmation only — it never adds points
  const mv = num(e.move_pct) ? e.move_pct : num(e.d1_pct) ? e.d1_pct : null;
  const price: PriceCheck = mv == null ? 'NO_PRICE' : mv >= 3 ? 'CONFIRMS' : mv <= -5 ? 'FADED' : 'NOT_YET';
  const priceText = mv == null ? 'no price yet' : price === 'CONFIRMS' ? `price confirms (${sgn(mv)}% since result)` : price === 'FADED' ? `price disagrees (${sgn(mv)}% since result)` : `price not yet moved (${sgn(mv)}%)`;

  const top = [...parts].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 4).map((p) => p.text);
  const why = `${top.length ? top.join('; ') : 'little new information in this filing'}. ${priceText[0].toUpperCase()}${priceText.slice(1)}.${missing.length ? ` Not scored (no data): ${missing.join(', ')}.` : ''}`;
  return { score, parts, price, priceText, why, missing };
}

/** "NEW INFO" word for the score (no bare number on its own). */
export function newInfoWord(score: number): string {
  return score >= 60 ? 'Major' : score >= 40 ? 'Strong' : score >= 25 ? 'Some' : score >= 10 ? 'Little' : 'None';
}
