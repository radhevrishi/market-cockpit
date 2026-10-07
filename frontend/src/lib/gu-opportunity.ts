// zzz929 — OPPORTUNITY SCORE for the Guidance Upgrades focus list (owner's review, 6 Oct): the Sky Gold score asks "can the business carry the plan?";
// this one asks "how much does the guidance change future profit, and is the setup supportive?". It is kept SEPARATE from the Sky Gold score.
// Pure: no fetch, no storage, NO AI, no paid data. Everything is built from what the focus list already holds:
//   • the focus row (guided growth, period, metric, the old → new figures of a raise),
//   • the company figures (gu-skygold-facts: India screener.in quarters / years / margins / profit / cash, US SEC + Yahoo EPS estimates),
//   • the fair value (gu-fair-value), and the Sky Gold red-flag figures (other income, new shares).
// The forward growth maths is gu-fair-value's (`statedGrowth`: verified / derived, capped at 100% a year) — it is not repeated here.
// A figure that is not known earns no points and says so; a part that cannot exist for the market (street view for India — no source) is left out of
// the maximum, but the coverage rule below still holds a thinly-known score down.
// NOT part of lib/thesis. Wording rule of the page: no trade words, no score out of a hundred.
import type { FocusRow, RaiseDetail } from './gu-focus';
import type { SkyFacts, PeriodSeries } from './gu-skygold-facts';
import { statedGrowth, growthClass, type FvResult } from './gu-fair-value';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const sg = (v: number) => `${v >= 0 ? '+' : ''}${r1(v)}%`;

export type OppRow = Pick<FocusRow, 'market' | 'growthPct' | 'growthTrust' | 'growthType' | 'growthMetric' | 'growthMetrics' | 'growthCohort' | 'growthPeriod' | 'raised' | 'smallRaise' | 'raiseDetail' | 'cutDate'>;

// ── period words ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface FyInfo { endYear: number | null; span: number | null; part: boolean }
/** 'FY27' → ends 2027, span 1 · 'FY27-FY29' / 'FY2026-27' → ends 2029 / 2027, span 2 / 1 · 'Q2 FY27' / 'H1 FY27' → part of a year. */
export function parseFy(period: string | null | undefined): FyInfo {
  const p = String(period || '').toUpperCase();
  const part = /\bQ[1-4]\b|\bH[12]\b|QUARTER|HALF/.test(p);
  const yr = (s: string, ref?: number): number => { const n = Number(s); return s.length === 4 ? n : (ref ? Math.floor(ref / 100) * 100 : 2000) + n; };
  const range = /FY\s*'?(\d{2,4})\s*(?:-|–|—|TO)\s*(?:FY\s*)?'?(\d{2,4})/.exec(p);
  if (range) { const a = yr(range[1]), b = yr(range[2], a); return { endYear: b, span: b > a ? b - a : null, part }; }
  const one = /FY\s*'?(\d{2,4})/.exec(p);
  if (one) return { endYear: yr(one[1]), span: 1, part };
  return { endYear: null, span: null, part };
}

// ── duration (item 4) ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type DurClass = 'short' | 'medium' | 'long';
export interface Duration { known: boolean; cls: DurClass | null; label: string; years: number | null; note: string }
export function durationOf(r: OppRow): Duration {
  const period = r.growthPeriod || r.raiseDetail?.period || '';
  const multi = r.growthCohort === 'MULTI_YEAR_CAGR' || r.raiseDetail?.periodKind === 'MULTI_YEAR_CAGR';
  const fy = parseFy(period);
  if (fy.part && !multi) return { known: true, cls: 'short', label: 'Short · one quarter or half-year', years: 0.5, note: `the guided period (${period}) is a part of a year` };
  if (multi) {
    let years: number | null = fin(r.raiseDetail?.periodYears) ? (r.raiseDetail!.periodYears as number) : fy.span;
    if (years == null) { const m = /(\d+)\s*(?:-|–|TO)?\s*(?:\d+)?\s*(?:YEARS?|YRS?)/i.exec(period); if (m) years = Number(m[1]); }
    if (years == null || years < 1) return { known: true, cls: 'medium', label: 'Multi-year · length not stated', years: null, note: 'a multi-year plan whose length the company did not state — treated as medium' };
    const cls: DurClass = years >= 3 ? 'long' : years === 2 ? 'medium' : 'short';
    return { known: true, cls, label: cls === 'long' ? 'Long · 3+ years' : cls === 'medium' ? 'Medium · 2 years' : 'Short · one year', years, note: `a yearly pace over about ${years} years (a span read from "${period}" is counted conservatively)` };
  }
  if (fy.endYear != null) return { known: true, cls: 'short', label: 'Short · one year', years: 1, note: `guidance for one fiscal year (${period || 'FY'})` };
  return { known: false, cls: null, label: 'Not known', years: null, note: 'the guided period was not read' };
}

// ── implied profit / EPS (item 1) ──────────────────────────────────────────────────────────────────────────────────────────
const METRIC_WORD: Record<string, string> = { REVENUE: 'sales', REVENUE_GROWTH: 'sales', ORGANIC_GROWTH: 'sales', EBITDA: 'EBITDA', EBIT: 'operating profit', EPS: 'EPS', ADJ_EPS: 'adjusted EPS', PAT: 'net profit', NET_PROFIT: 'net profit', FCF: 'free cash flow' };
export interface Incremental { text: string; oldPct: number | null; newPct: number | null; changePct: number | null }
export interface ImpliedEps {
  /** implied profit (EPS) growth, % — one year, or a yearly pace for a multi-year plan; null when it cannot be worked out */ pct: number | null;
  /** true = a rougher estimate (sales growth at today's margin, or EBITDA growth carried to profit) */ approx: boolean;
  basis: string; perYear: boolean; reason: string | null;
  incremental: Incremental | null;
}
/** Pure. EPS growth is the net-profit growth with the share count unchanged (new shares / buybacks are not predicted). */
export function impliedEps(r: OppRow, f: SkyFacts | null): ImpliedEps {
  const perYear = r.growthCohort === 'MULTI_YEAR_CAGR' || r.raiseDetail?.periodKind === 'MULTI_YEAR_CAGR';
  const out: ImpliedEps = { pct: null, approx: false, basis: '', perYear, reason: null, incremental: incrementalOf(r) };
  const g = statedGrowth(r as any);
  const loss = !!f && fin(f.patFy) && f.patFy <= 0;
  if (g && g.cls === 'profit') {
    const metric = String(r.growthMetric || '');
    out.pct = r1(g.base); out.basis = `the company guides ${METRIC_WORD[metric] || 'profit'} growth of ${r1(g.raw)}%${g.capped ? ' (capped at 100% a year)' : ''}`;
    if (/EBITDA|EBIT/.test(metric)) { out.approx = true; out.basis += '; carried to net profit as is (interest and tax assumed steady)'; }
    return out;
  }
  if (g && g.cls === 'revenue') {
    if (!f) { out.reason = "company figures not read — today's margin is not known"; return out; }
    if (!fin(f.patFy) || !fin(f.salesBase) || f.salesBase <= 0) { out.reason = "net profit or sales not read — today's margin is not known"; return out; }
    if (loss) { out.reason = 'the company is loss-making today — a profit growth percent is not meaningful'; return out; }
    out.pct = r1(g.base); out.approx = true;
    out.basis = `guided sales growth of ${r1(g.raw)}%${g.capped ? ' (capped at 100% a year)' : ''} at today's net margin of ${r1((f.patFy / f.salesBase) * 100)}% (margin held steady — no margin guidance is read)`;
    return out;
  }
  // no usable growth on the row: a growth-rate raise still says what the new rate is
  const d = r.raiseDetail;
  if (d && d.isGrowthRate && fin(d.afterMid) && growthClass(d.metric) !== 'other' && !/MARGIN/i.test(d.metric)) {
    const cls = growthClass(d.metric);
    if (cls === 'revenue' && (!f || !fin(f.patFy) || loss)) { out.reason = "sales growth is guided but today's margin is not known"; return out; }
    out.pct = r1(Math.min(100, d.afterMid)); out.approx = cls === 'revenue';
    out.basis = `the raised ${METRIC_WORD[d.metric] || 'growth'} rate of ${r1(d.afterMid)}%${cls === 'revenue' ? ' at a steady margin' : ''}`;
    return out;
  }
  out.reason = g ? `the guided measure (${String(r.growthMetric || 'unknown')}) is not a sales or profit growth rate` : 'no usable growth rate is guided';
  return out;
}
/** The change from the OLD guidance to the NEW one, for a raise row. A percent change of a small-base EPS is never used. */
export function incrementalOf(r: OppRow): Incremental | null {
  const d: RaiseDetail | null | undefined = r.raiseDetail;
  if (!d || !r.raised) return null;
  const cls = growthClass(d.metric);
  const word = METRIC_WORD[d.metric] || d.metric.toLowerCase();
  if (/MARGIN/i.test(d.metric) && fin(d.beforeMid) && fin(d.afterMid)) return { text: `margin guided ${r1(d.beforeMid)}% → ${r1(d.afterMid)}% (${d.afterMid - d.beforeMid >= 0 ? '+' : ''}${r1(d.afterMid - d.beforeMid)} points) — adds to profit beyond sales; not turned into an EPS figure`, oldPct: null, newPct: null, changePct: null };
  if (!fin(d.beforeMid) || !fin(d.afterMid) || d.beforeMid <= 0) return null;
  if (d.isGrowthRate && cls !== 'other') {
    const steady = cls === 'revenue' ? ' — at a steady margin the implied EPS growth moves the same way' : ' — the implied EPS growth moves the same way';
    return { text: `${word} growth guided ${r1(d.beforeMid)}% → ${r1(d.afterMid)}% (${d.afterMid - d.beforeMid >= 0 ? '+' : ''}${r1(d.afterMid - d.beforeMid)} points)${steady}`, oldPct: r1(d.beforeMid), newPct: r1(d.afterMid), changePct: r1(d.afterMid - d.beforeMid) };
  }
  if (d.isGrowthRate) return null;
  if (r.smallRaise) return { text: `${word} ${r1(d.beforeMid)} → ${r1(d.afterMid)} — from a small base, so the percent change is not used`, oldPct: null, newPct: null, changePct: null };
  const ch = r1(((d.afterMid - d.beforeMid) / d.beforeMid) * 100);
  if (cls === 'profit') return { text: `${word} guidance ${r1(d.beforeMid)} → ${r1(d.afterMid)} (${sg(ch)}) — the implied profit / EPS for the year rose by that much against the old guidance`, oldPct: null, newPct: null, changePct: ch };
  if (cls === 'revenue') return { text: `sales guidance ${r1(d.beforeMid)} → ${r1(d.afterMid)} (${sg(ch)}) — at a steady margin, profit rises by about the same`, oldPct: null, newPct: null, changePct: ch };
  return { text: `${word} guidance ${r1(d.beforeMid)} → ${r1(d.afterMid)} (${sg(ch)})`, oldPct: null, newPct: null, changePct: ch };
}

// ── raise quality tier (item 2) ────────────────────────────────────────────────────────────────────────────────────────────
export type TierNo = 1 | 2 | 3 | 4;
export interface Quality { tier: TierNo | null; label: string; detail: string }
export const TIER_LABEL: Record<TierNo, string> = { 1: 'Broad improvement', 2: 'Operating leverage', 3: 'Revenue only', 4: 'Low quality' };
/** Pure. Tier 4 first (the Sky Gold red-flag figures: other income, new shares, a cut, profit not from operations), then Tier 1, 2, 3. null = figures not read. */
export function qualityOf(r: OppRow, f: SkyFacts | null): Quality {
  if (!f) return { tier: null, label: 'Not rated', detail: 'company figures not read' };
  const rev = [f.salesYoyQ, f.salesGrowthFy].filter(fin);
  const revG = rev.length ? Math.max(...rev) : null;
  const profG = fin(f.patYoyQ) ? f.patYoyQ : fin(f.opGrowthFy) ? f.opGrowthFy : null;
  const dM = fin(f.opmNow) && fin(f.opmYearAgo) ? f.opmNow - f.opmYearAgo : null;
  const cash = fin(f.cfoToPat) ? f.cfoToPat >= 0.7 : fin(f.fcf) ? f.fcf >= 0 : null;
  const bad: string[] = [];
  if (fin(f.otherIncomePctOfPbt) && f.otherIncomePctOfPbt > 30) bad.push(`other income is ${f.otherIncomePctOfPbt}% of profit before tax`);
  if (fin(f.shareCountChange2y) && f.shareCountChange2y > 15) bad.push(`share count up ${Math.round(f.shareCountChange2y)}% in two years (new shares, or a bonus / split)`);
  if (r.cutDate) bad.push('the company also cut guidance in this window');
  if (fin(f.patYoyQ) && f.patYoyQ >= 20 && dM != null && dM <= -3) bad.push(`profit ${sg(f.patYoyQ)} while operating margin fell ${r1(Math.abs(dM))} points — not coming from operations`);
  if (bad.length) return { tier: 4, label: TIER_LABEL[4], detail: bad.join('; ') };
  const revUp = revG != null ? revG >= 10 : null, marginOk = dM != null ? dM >= -1 : null, profitUp = profG != null ? profG >= 0 : null;
  const facts = `sales ${revG != null ? sg(revG) : 'not known'} · operating margin ${dM != null ? `${dM >= 0 ? '+' : ''}${r1(dM)} pts` : 'not known'} · profit ${profG != null ? sg(profG) : 'not known'} · cash ${cash == null ? 'not known' : cash ? 'follows profit' : 'weak'}`;
  if (revUp && marginOk && profitUp && cash) return { tier: 1, label: TIER_LABEL[1], detail: `sales up, margin steady or up, profit up, cash following — ${facts}` };
  if (revG != null && revG > 0 && profG != null && profG > revG && marginOk !== false) return { tier: 2, label: TIER_LABEL[2], detail: `profit growing faster than sales — ${facts}` };
  if (revG == null && profG == null && dM == null) return { tier: null, label: 'Not rated', detail: 'sales, margin and profit figures not read' };
  return { tier: 3, label: TIER_LABEL[3], detail: `revenue-led; profit, margin or cash does not confirm yet — ${facts}` };
}

// ── growth still needed in the rest of the guided year (item 3) ─────────────────────────────────────────────────────────────
export interface Required {
  computed: boolean; reason: string | null;
  needPct: number | null; pacePct: number | null; quartersDone: number | null; far: boolean; text: string;
}
const MON: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
function plabel(l: string): { m: number; y: number } | null { const x = /([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(l || ''); const m = x ? MON[x[1].toUpperCase()] : 0; return x && m ? { m, y: Number(x[2]) } : null; }
const fyOfMonth = (m: number, y: number) => (m >= 4 ? y + 1 : y);
const slotOf = (m: number): number | null => (m === 6 ? 1 : m === 9 ? 2 : m === 12 ? 3 : m === 3 ? 4 : null);
const noReq = (reason: string): Required => ({ computed: false, reason, needPct: null, pacePct: null, quartersDone: null, far: false, text: reason });
/** Pure. India (FY April–March): the quarters of the guided year reported so far against the same quarters a year earlier, and the growth the
 *  remaining quarters must show to reach last year's total grown at the guided rate. The USA shows nothing: only the latest quarter is read there. */
export function requiredRemaining(r: OppRow, f: SkyFacts | null): Required {
  if (!f) return noReq('company figures not read');
  if (f.market !== 'IN') return noReq('USA: only the latest quarter is read, so the year-to-date cannot be worked out');
  if (r.growthCohort === 'MULTI_YEAR_CAGR') return noReq('a multi-year plan — no single year to check');
  const g = statedGrowth(r as any);
  if (!g || g.cls === 'other') return noReq('no sales or profit growth rate guided for a year');
  const fy = parseFy(r.growthPeriod);
  if (fy.endYear == null || fy.part || fy.span !== 1) return noReq('the guided period is not one full fiscal year');
  const metric = String(r.growthMetric || '');
  const key: 'sales' | 'op' | 'pat' | null = g.cls === 'revenue' ? 'sales' : /EBITDA|EBIT/.test(metric) ? 'op' : /PAT|NET_PROFIT|EPS/.test(metric) ? 'pat' : null;
  if (!key) return noReq('the guided measure has no quarterly figure here');
  const q: PeriodSeries | null = f.quarters, y: PeriodSeries | null = f.years;
  if (!q || !y) return noReq('quarterly figures not read');
  const cur = new Map<number, number>(), prev = new Map<number, number>();
  q.labels.forEach((l, i) => {
    const p = plabel(l); const v = q[key][i]; if (!p || !fin(v)) return;
    const slot = slotOf(p.m); if (slot == null) return;
    const fyq = fyOfMonth(p.m, p.y);
    if (fyq === fy.endYear) cur.set(slot, v); else if (fyq === (fy.endYear as number) - 1) prev.set(slot, v);
  });
  const n = cur.size;
  if (n === 0) return noReq(`no quarter of FY${String(fy.endYear).slice(2)} reported yet — the year has not started in the figures`);
  if (n >= 4) return noReq(`all four quarters of FY${String(fy.endYear).slice(2)} are reported`);
  let ytd = 0, pytd = 0;
  for (let s = 1; s <= n; s++) { const a = cur.get(s), b = prev.get(s); if (!fin(a) || !fin(b)) return noReq('a quarter of the guided year or of the year before is missing from the figures'); ytd += a; pytd += b; }
  const yi = y.labels.findIndex((l) => { const p = plabel(l); return !!p && p.m === 3 && p.y === (fy.endYear as number) - 1; });
  const priorFy = yi >= 0 ? y[key][yi] : null;
  if (!fin(priorFy) || priorFy <= 0 || pytd <= 0) return noReq("last year's full-year figure is not read, or is zero or negative");
  if (priorFy - pytd <= 0) return noReq('the quarters left in last year had no figure to compare with');
  // Revenue delivery must be checked against the actual guidance, not the valuation scenario cap.
  const targetGrowth = g.cls === 'revenue' ? g.raw : g.base;
  const target = priorFy * (1 + targetGrowth / 100);
  const need = r1(((target - ytd) / (priorFy - pytd) - 1) * 100), pace = r1((ytd / pytd - 1) * 100);
  const far = need - pace > 15 && (pace <= 0 || need >= 1.4 * pace);
  const left = 4 - n;
  const word = key === 'sales' ? 'sales' : key === 'op' ? 'operating profit' : 'net profit';
  return { computed: true, reason: null, needPct: need, pacePct: pace, quartersDone: n, far,
    text: `Needs ${sg(need)} in the remaining ${left} quarter${left === 1 ? '' : 's'} to reach the guided ${word} (${sg(targetGrowth)} for the year); so far ${sg(pace)} over ${n} quarter${n === 1 ? '' : 's'}${far ? ' — far above the current pace' : ''}` };
}

// ── guidance against the street (item 5, USA only) ────────────────────────────────────────────────────────────────────────
export type StreetVerdict = 'above' | 'in line' | 'below';
export interface Street { available: boolean; reason: string | null; verdict: StreetVerdict | null; guidedPct: number | null; streetPct: number | null; diffPts: number | null; text: string }
export const STREET_BAND_PTS = 5;
export function streetView(r: OppRow, eps: ImpliedEps, f: SkyFacts | null): Street {
  const no = (reason: string): Street => ({ available: false, reason, verdict: null, guidedPct: null, streetPct: null, diffPts: null, text: reason });
  if (r.market !== 'US') return no('India: no analyst-estimate source is read, so nothing is shown');
  if (!f || f.streetEpsGrowthPct == null) return no('no analyst EPS estimate for the next year');
  if (eps.pct == null) return no('no implied EPS growth to compare');
  const fy = parseFy(r.growthPeriod || r.raiseDetail?.period);
  if (fy.endYear == null) return no("the guided year is not known, so it cannot be matched to the street's year");
  if (f.streetEpsEndYear == null || f.streetEpsEndYear !== fy.endYear) return no(`the guided year (FY${String(fy.endYear).slice(2)}) does not match the street's next fiscal year${f.streetEpsEndYear ? ` (ends ${f.streetEpsEndYear})` : ''}`);
  const diff = r1(eps.pct - f.streetEpsGrowthPct);
  const verdict: StreetVerdict = diff >= STREET_BAND_PTS ? 'above' : diff <= -STREET_BAND_PTS ? 'below' : 'in line';
  return { available: true, reason: null, verdict, guidedPct: eps.pct, streetPct: f.streetEpsGrowthPct, diffPts: diff,
    text: `Guided ${sg(eps.pct)} implied EPS growth vs the street's ${sg(f.streetEpsGrowthPct)} for the next fiscal year — ${verdict} street (${diff >= 0 ? '+' : ''}${diff} points)${eps.approx ? '; the guided figure is a rough estimate' : ''}` };
}

// ── the score ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type OppBand = 'HIGH' | 'GOOD' | 'MIXED' | 'LOW';
export const OPP_BAND_WORDS: Record<OppBand, string> = {
  HIGH: 'most parts known and strong — the guidance changes profit a lot and the setup supports it',
  GOOD: 'a solid setup with some parts weaker or not known',
  MIXED: 'half the picture — check the weak parts before leaning on it',
  LOW: 'the guidance does not change profit much, or too little is known',
};
export const oppBandOf = (s: number): OppBand => (s >= 75 ? 'HIGH' : s >= 60 ? 'GOOD' : s >= 40 ? 'MIXED' : 'LOW');
export const OPP_WEIGHTS = { eps: 25, quality: 20, feasibility: 15, valuation: 15, duration: 10, street: 15 } as const;
export const MIN_COVERAGE = 0.5;
export interface OppPart { id: string; label: string; max: number; points: number; status: 'known' | 'unknown' | 'na'; detail: string }
export interface Opportunity {
  score: number | null; band: OppBand | null; coverage: number; parts: OppPart[]; capNote: string | null; summary: string;
  implied: ImpliedEps; quality: Quality; required: Required; duration: Duration; street: Street;
}
const epsFrac = (p: number) => (p >= 50 ? 1 : p >= 30 ? 0.85 : p >= 20 ? 0.65 : p >= 10 ? 0.4 : p >= 0 ? 0.15 : 0);
const valFrac = (u: number) => (u >= 50 ? 1 : u >= 30 ? 0.8 : u >= 15 ? 0.6 : u >= 0 ? 0.3 : 0);
const TIER_FRAC: Record<TierNo, number> = { 1: 1, 2: 0.85, 3: 0.4, 4: 0.1 };
const DUR_FRAC: Record<DurClass, number> = { long: 1, medium: 0.75, short: 0.5 };

/** Pure: the opportunity score of one focus row. `fv` = gu-fair-value's result for the same row (null while not read). */
export function opportunityScore(r: OppRow, f: SkyFacts | null, fv: FvResult | null): Opportunity {
  const implied = impliedEps(r, f);
  const quality = qualityOf(r, f);
  const required = requiredRemaining(r, f);
  const duration = durationOf(r);
  const street = streetView(r, implied, f);
  const parts: OppPart[] = [];
  const W = OPP_WEIGHTS;
  const add = (id: string, label: string, max: number, frac: number | null, detail: string, na = false) =>
    parts.push({ id, label, max, points: frac == null ? 0 : Math.round(max * frac * 10) / 10, status: na ? 'na' : frac == null ? 'unknown' : 'known', detail });

  add('eps', 'Implied EPS growth', W.eps, implied.pct == null ? null : epsFrac(implied.pct) * (implied.approx ? 0.85 : 1),
    implied.pct == null ? `not worked out — ${implied.reason}` : `${sg(implied.pct)}${implied.perYear ? ' a year' : ''} — ${implied.basis}${implied.approx ? ' (rough: counts at 85%)' : ''}`);
  add('quality', 'Raise quality', W.quality, quality.tier == null ? null : TIER_FRAC[quality.tier], quality.tier == null ? `not rated — ${quality.detail}` : `Tier ${quality.tier} · ${quality.label} — ${quality.detail}`);
  // feasibility: growth still needed in the rest of the year; else the guided growth against the current pace
  {
    let frac: number | null = null, detail = '';
    if (required.computed && required.needPct != null && required.pacePct != null) {
      const diff = required.needPct - required.pacePct;
      frac = required.far ? 0.2 : diff <= 5 ? 1 : 0.7;
      detail = required.text;
    } else {
      const gd = statedGrowth(r as any);
      const cls = gd?.cls;
      const cur = !f || !gd ? null : cls === 'profit' ? [f.patYoyQ, f.profitCagr3y, f.opGrowthFy].filter(fin) : [f.salesYoyQ, f.salesCagr3y, f.salesGrowthFy].filter(fin);
      if (gd && cur && cur.length && cls !== 'other') {
        const pace = Math.max(...cur), diff = gd.base - pace;
        frac = diff <= 5 ? 1 : diff <= 15 ? 0.7 : 0.2;
        detail = `year-to-date not usable (${required.reason}); the full-year pace is ${sg(pace)} against ${r1(gd.base)}% guided — ${diff <= 5 ? 'matches' : diff <= 15 ? 'needs a step-up' : 'far ahead of the pace'}`;
      } else detail = `not known — ${required.reason || 'no current pace to compare'}`;
    }
    add('feasibility', 'Requirement feasibility', W.feasibility, frac, detail);
  }
  // valuation: fair value upside, only when the estimate is not flagged "check"
  {
    const ok = !!fv && fv.ok && !!fv.base;
    if (ok && fv!.checks.length === 0) add('valuation', 'Valuation upside', W.valuation, valFrac(fv!.base!.upsidePct), `fair value ${sg(fv!.base!.upsidePct)} against the price (points stop growing at +50%)`);
    else add('valuation', 'Valuation upside', W.valuation, null, ok ? `fair value ${sg(fv!.base!.upsidePct)} is flagged "check" (${fv!.checks[0]}) — not counted` : `no fair value — ${fv?.reason || 'not read'}`);
  }
  add('duration', 'Duration', W.duration, duration.cls ? DUR_FRAC[duration.cls] : null, duration.known ? `${duration.label} — ${duration.note}` : duration.note);
  if (r.market === 'US') add('street', 'Guidance vs street', W.street, street.available ? (street.verdict === 'above' ? 1 : street.verdict === 'in line' ? 0.5 : 0) * (implied.approx ? 0.6 : 1) : null,
    street.available ? `${street.text}${implied.approx ? ' (rough: counts at 60%)' : ''}` : `not compared — ${street.reason}`);
  else add('street', 'Guidance vs street', 0, null, street.text, true);

  const live = parts.filter((p) => p.status !== 'na');
  const maxAll = live.reduce((s, p) => s + p.max, 0);
  const maxKnown = live.filter((p) => p.status === 'known').reduce((s, p) => s + p.max, 0);
  const got = live.reduce((s, p) => s + p.points, 0);
  const coverage = maxAll > 0 ? maxKnown / maxAll : 0;
  const knownN = live.filter((p) => p.status === 'known').length;
  const summary = `${knownN} of ${live.length} parts known${r.market === 'IN' ? ' (no street data for India)' : ''}`;
  const base = { parts, coverage: Math.round(coverage * 100) / 100, summary, implied, quality, required, duration, street };
  if (coverage < MIN_COVERAGE) return { score: null, band: null, capNote: `only ${Math.round(coverage * 100)}% of the parts have data`, ...base };
  let score = Math.round((got / maxAll) * 100);
  let cap = coverage >= 1 ? 100 : coverage >= 0.8 ? 89 : coverage >= 0.65 ? 74 : 59;
  let capNote: string | null = cap < 100 ? `${Math.round(coverage * 100)}% of the parts known — held at ${cap} or below` : null;
  if (quality.tier === 4 && cap > 59) { cap = 59; capNote = 'low-quality raise (profit not from operations, other income or new shares) — held at 59 or below'; }
  const strong = live.filter((p) => p.status === 'known' && p.points >= 0.7 * p.max).length;
  const eps = parts.find((p) => p.id === 'eps')!;
  if (cap > 74 && (strong < 3 || eps.status !== 'known' || eps.points < 0.65 * eps.max)) { cap = 74; capNote = 'a top band needs implied EPS growth of 20%+ and at least 3 strong parts — held at 74 or below'; }
  score = Math.max(0, Math.min(cap, score));
  return { score, band: oppBandOf(score), capNote, ...base };
}

/** Compact words for the "Implied EPS" column. */
export function impliedCell(o: Opportunity): { main: string; sub: string | null } {
  const e = o.implied;
  if (e.pct == null) return { main: '—', sub: null };
  return { main: `${e.approx ? '~' : ''}${sg(e.pct)}${e.perYear ? ' /yr' : ''}`, sub: e.incremental?.changePct != null ? `vs old guide ${sg(e.incremental.changePct)}${e.incremental.oldPct != null ? ' pts' : ''}` : null };
}
