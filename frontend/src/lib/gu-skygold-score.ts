// zzz923 — "NEXT SKY GOLD" SCORE for the Guidance Upgrades focus list (owner's framework "Identify Next SKY GOLD").
//
// The framework's question: is management's big growth plan UNDERWRITTEN (the business already shows the growth, margins, returns,
// cash and balance sheet to carry it) or only a POWERPOINT plan? Its screen, in order: small/mid cap → revenue already growing 20%+ →
// a big target → the target reachable from the current pace → margins steady or rising → ROCE 15–20%+ → cash follows profit → debt
// controlled → no governance red flags → guidance raised, not delayed → estimates rising → valuation not pricing the whole plan.
//
// So the score has three parts:
//   MUST-HAVES (7) — the main requirements. Each missing must-have CAPS the score; 80+ needs 6 of 7 passed with real data and
//                    65+ (GOOD) needs 5 of 7 (zzz925: the owner's rule — a high score only when most and the main requirements are met).
//   SUPPORTING (8) — add points, but can never lift a name past the cap its must-haves set.
//   RED FLAGS      — the framework's "promotional risk" penalty: points off, and any 10+ points of red flags caps the score at 79.
// A figure that is not known is shown as "not known" and earns nothing — never counted as a pass. Fewer than 4 must-haves with
// data → no number ("not enough data").
// Pure, unit-tested. Price is read only as the P/E printed by screener.in for the valuation check. NOT part of lib/thesis.
import type { SkyFacts } from './gu-skygold-facts';
import type { AiEvidence } from './gu-ai-check';

export type SkyStatus = 'pass' | 'partial' | 'fail' | 'unknown';
export type SkyBand = 'STRONG' | 'GOOD' | 'MIXED' | 'WEAK';
export interface SkyCheck { id: string; label: string; kind: 'must' | 'support'; weight: number; status: SkyStatus; detail: string }
export interface SkyFlag { id: string; label: string; points: number; detail: string }
export interface SkyScore {
  /** null = not enough data */ score: number | null; band: SkyBand | null;
  mustMet: number; mustKnown: number; mustTotal: number;
  checks: SkyCheck[]; flags: SkyFlag[];
  /** the cap the must-haves (or red flags) set, and why, in words */ capNote: string | null;
  /** one plain line: '5 of 7 main checks met · 2 red flags' */ summary: string;
}

/** What the focus row knows about the company's guidance (no fetch needed). */
export interface SkyGuidance {
  growthPct: number | null;            // headline guided growth, % a year
  growthTrust: string | null;          // 'verified' | 'derived' | …
  /** zzz925: how the headline growth was obtained — 'EXPLICIT' = a percent the company itself stated; 'DERIVED' / 'IMPLIED' = worked out */
  growthType?: string | null;
  growthMetric: string | null;         // REVENUE / PAT / EBITDA / EPS / FCF
  growthMetrics: string[];             // every metric the company guided
  multiYear: boolean;                  // a multi-year plan (CAGR) rather than one year
  raised: boolean; smallRaise: boolean;
  cutInWindow: boolean;                // a verified guidance cut in the same window
  /** zzz1193: days since the guidance document (framework: re-check the plan every quarter); absent = not scored */
  ageDays?: number | null;
}

// zzz925: tightened (was 5→79, 4→69, 3→59 …): FLAIR and GPT Infra reached GOOD (68, 69) with only 4 of 7 main checks met
export const MUST_CAPS: Record<number, number> = { 7: 100, 6: 89, 5: 74, 4: 62, 3: 52, 2: 42, 1: 32, 0: 32 };
export const MIN_MUST_KNOWN = 4;
export const RED_FLAG_CAP = 79;
export const bandOf = (s: number): SkyBand => (s >= 80 ? 'STRONG' : s >= 65 ? 'GOOD' : s >= 50 ? 'MIXED' : 'WEAK');
export const BAND_WORDS: Record<SkyBand, string> = {
  STRONG: 'most main checks met — the plan looks backed by the numbers',
  GOOD: 'many checks met — some gaps to check',
  MIXED: 'half the picture — the plan is ahead of the evidence',
  WEAK: 'few checks met — guidance not backed by the numbers yet',
};

const n = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const pc = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10}%`;
const maxKnown = (...v: Array<number | null | undefined>): number | null => { const k = v.filter(n); return k.length ? Math.max(...k) : null; };
const PROFIT = new Set(['PAT', 'EPS', 'EBITDA', 'FCF']);

/** Pure: the score for one company. `facts` may be null (not fetched / not found) — the guidance checks still count. */
/** zzz1193 — `ai` = the guidance AI check's reading of the company's own document (capacity, orders, customers, track record, deferrals).
 *  The framework's capacity / demand / credibility groups cannot be read from figures; without the AI check they are simply not scored. */
export const PRICED_IN_CAP = 64;
export function skyGoldScore(g: SkyGuidance, facts: SkyFacts | null, ai?: AiEvidence | null): SkyScore {
  const f = facts;
  const money = f?.market === 'US' ? '$' : '₹';
  const unit = f?.market === 'US' ? 'M' : ' Cr';
  const checks: SkyCheck[] = [];
  const add = (c: SkyCheck) => checks.push(c);
  const NK = 'not known';

  // ── MUST-HAVES ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  // M1 a big, clear target from the company itself (framework: "management 3–5Y target", specific and testable)
  {
    const big = n(g.growthPct) && g.growthPct >= 30;
    // zzz925: met only for a target the company itself STATED (or its own raise); a growth worked out from company numbers is half at most
    const stated = big && g.growthTrust === 'verified' && (g.growthType == null || g.growthType === 'EXPLICIT');
    const st: SkyStatus = stated || (g.raised && !g.smallRaise) ? 'pass' : big ? 'partial' : g.raised ? 'partial' : 'fail';
    add({ id: 'target', label: 'Big, clear target from the company', kind: 'must', weight: 12, status: st,
      detail: st === 'pass' ? (stated ? `the company itself guides ${g.growthPct}% growth` : 'the company raised its own figures (checked in its filing)')
        : big ? `${g.growthPct}% growth is worked out from the company's numbers, not stated by it` : g.raised ? 'only a small raise' : 'no big target stated' });
  }
  // M2 revenue already growing 20%+ (framework: "Revenue CAGR >20%" — customers first, revenue already showing)
  {
    const v = maxKnown(f?.salesYoyQ, f?.salesCagr3y, f?.salesGrowthFy);
    const st: SkyStatus = v == null ? 'unknown' : v >= 20 ? 'pass' : v >= 10 ? 'partial' : 'fail';
    const parts = [n(f?.salesYoyQ) ? `latest quarter ${pc(f!.salesYoyQ!)}` : null, n(f?.salesCagr3y) ? `3-year average ${pc(f!.salesCagr3y!)} a year` : null, n(f?.salesGrowthFy) ? `last full year ${pc(f!.salesGrowthFy!)}` : null].filter(Boolean);
    add({ id: 'growing', label: 'Sales already growing 20%+', kind: 'must', weight: 12, status: st, detail: v == null ? `sales growth ${NK}` : `sales: ${parts.join(', ')}` });
  }
  // M3 the target is reachable from the current pace (framework: "target CAGR mathematically achievable"; Type A vs Type B)
  {
    const profitGuide = !!g.growthMetric && PROFIT.has(g.growthMetric);
    const d = profitGuide ? maxKnown(f?.patYoyQ, f?.profitCagr3y, f?.opGrowthFy) ?? maxKnown(f?.salesYoyQ, f?.salesCagr3y) : maxKnown(f?.salesYoyQ, f?.salesCagr3y, f?.salesGrowthFy);
    const G = g.growthPct;
    let st: SkyStatus = 'unknown', detail = !n(G) ? 'no growth rate guided to compare' : `current growth ${NK}`;
    if (n(G) && d != null) {
      st = d >= 0.6 * G || G - d <= 15 ? 'pass' : d >= 0.35 * G ? 'partial' : 'fail';
      detail = `guides ${G}% a year; it is doing ${pc(d)} now${st === 'fail' ? ' — the plan is far ahead of what the business shows' : st === 'partial' ? ' — needs a clear step-up' : ' — the plan matches the pace'}`;
    }
    add({ id: 'reachable', label: 'Target reachable from the current pace', kind: 'must', weight: 12, status: st, detail });
  }
  // M4 margins steady or rising (framework: "EBITDA margin stable/rising"; failure pattern: "margins fall")
  {
    const a = f?.opmNow, b = f?.opmYearAgo;
    let st: SkyStatus = 'unknown', detail = `operating margin ${NK}`;
    if (n(a) && n(b)) { const dlt = a - b; st = dlt >= -1 ? 'pass' : dlt >= -3 ? 'partial' : 'fail'; detail = `operating margin ${a}% vs ${b}% a year ago (${dlt >= 0 ? '+' : ''}${Math.round(dlt * 10) / 10} points)`; }
    add({ id: 'margin', label: 'Margins steady or rising', kind: 'must', weight: 10, status: st, detail });
  }
  // M5 good return on capital (framework: "ROCE >15–20%")
  {
    const v = f?.roce;
    const st: SkyStatus = !n(v) ? 'unknown' : v >= 20 ? 'pass' : v >= 15 ? 'partial' : 'fail';
    add({ id: 'returns', label: 'Return on capital (ROCE) 20%+', kind: 'must', weight: 10, status: st, detail: n(v) ? `ROCE ${v}%` : `ROCE ${NK}` });
  }
  // M6 cash follows profit (framework: "CFO follows PAT")
  {
    const v = f?.cfoToPat;
    let st: SkyStatus = 'unknown', detail = `cash from operations vs profit ${NK}`;
    if (f?.lossMaking === true) { st = 'fail'; detail = 'latest quarter is a loss — no profit for cash to follow'; }
    else if (n(v)) { st = v >= 0.8 ? 'pass' : v >= 0.5 ? 'partial' : 'fail'; detail = `cash from operations is ${v}× profit${f?.cfoYear ? ` (${f.cfoYear})` : ''}`; }
    add({ id: 'cash', label: 'Cash follows profit', kind: 'must', weight: 10, status: st, detail });
  }
  // M7 debt under control (framework: "debt controlled"; failure pattern: "capex → debt")
  {
    const de = f?.debtToEquity, gx = f?.debtGrowthX;
    let st: SkyStatus = 'unknown', detail = `debt ${NK}`;
    if (n(de)) {
      st = de <= 0.5 ? 'pass' : de <= 1 ? 'partial' : 'fail';
      detail = `debt is ${de}× equity`;
      if (n(gx) && gx >= 2 && de > 0.3) { st = st === 'pass' ? 'partial' : 'fail'; detail += `, and it more than doubled in a year (${gx}×)`; }
    }
    add({ id: 'debt', label: 'Debt under control', kind: 'must', weight: 10, status: st, detail });
  }

  // ── SUPPORTING ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  add({ id: 'raised', label: 'Guidance raised (not delayed)', kind: 'support', weight: 6, status: g.raised && !g.smallRaise ? 'pass' : g.raised ? 'partial' : 'fail',
    detail: g.raised && !g.smallRaise ? 'raised its own guidance in this window' : g.raised ? 'a small raise only' : 'no raise in this window' });
  {
    const both = g.growthMetrics.includes('REVENUE') && g.growthMetrics.some((m) => PROFIT.has(m));
    const st: SkyStatus = both || g.multiYear ? 'pass' : n(g.growthPct) || g.raised ? 'partial' : 'fail';
    add({ id: 'specific', label: 'Specific plan (sales and profit, or several years)', kind: 'support', weight: 5, status: st,
      detail: both ? `guides ${g.growthMetrics.join(' and ').toLowerCase()}` : g.multiYear ? 'a multi-year growth plan' : st === 'partial' ? 'one figure only' : 'no figures' });
  }
  {
    // the same period on both sides: last full year's operating profit vs sales (India), else the latest quarter's profit vs sales
    const yearly = n(f?.opGrowthFy) && n(f?.salesGrowthFy);
    const s = yearly ? f!.salesGrowthFy : f?.salesYoyQ, p = yearly ? f!.opGrowthFy : f?.patYoyQ;
    let st: SkyStatus = 'unknown', detail = `profit vs sales growth ${NK}`;
    if (n(s) && n(p) && s > 0) { st = p >= s ? 'pass' : p >= 0.7 * s ? 'partial' : 'fail'; detail = `${yearly ? 'last full year: operating profit' : 'latest quarter: profit'} ${pc(p)} vs sales ${pc(s)}`; }
    add({ id: 'leverage', label: 'Profit growing faster than sales', kind: 'support', weight: 5, status: st, detail });
  }
  {
    const fcf = f?.fcf, cfo = f?.cfo;
    let st: SkyStatus = 'unknown', detail = `free cash flow ${NK}`;
    if (n(fcf)) { st = fcf >= 0 ? 'pass' : n(cfo) && cfo > 0 ? 'partial' : 'fail'; detail = `free cash flow ${fcf < 0 ? '−' : ''}${money}${Math.abs(Math.round(fcf)).toLocaleString('en-US')}${unit}${st === 'partial' ? ' (operations make cash; spending on growth is more)' : ''}`; }
    else if (n(cfo) && cfo < 0) { st = 'fail'; detail = 'operations used cash'; }
    add({ id: 'selfFunded', label: 'Growth paid from own cash', kind: 'support', weight: 5, status: st, detail });
  }
  {
    const v = f?.backlogGrowth;
    const st: SkyStatus = !n(v) ? 'unknown' : v >= 15 ? 'pass' : v >= 0 ? 'partial' : 'fail';
    add({ id: 'orders', label: 'Order backlog growing', kind: 'support', weight: 5, status: st,
      detail: n(v) ? `order backlog ${pc(v)} vs a year ago` : f?.market === 'IN' ? 'order book not collected for India yet' : 'no order backlog reported' });
  }
  {
    const v = f?.estimateChange;
    const st: SkyStatus = !n(v) ? 'unknown' : v >= 2 ? 'pass' : v > -2 ? 'partial' : 'fail';
    add({ id: 'estimates', label: 'Analyst estimates rising', kind: 'support', weight: 4, status: st,
      detail: n(v) ? `next-year EPS estimate ${pc(v)} in about 90 days` : f?.market === 'IN' ? 'analyst estimates not collected for India' : `estimate trend ${NK}` });
  }
  {
    const pe = f?.pe, G = g.growthPct;
    let st: SkyStatus = 'unknown', detail = `P/E ${NK}`;
    if (n(pe) && pe > 0 && n(G) && G > 0) { const peg = Math.round((pe / G) * 100) / 100; st = peg <= 1.2 ? 'pass' : peg <= 2 ? 'partial' : 'fail'; detail = `P/E ${pe} for ${G}% guided growth (P/E ÷ growth = ${peg})`; }
    add({ id: 'valuation', label: 'Price not already assuming the whole plan', kind: 'support', weight: 5, status: st, detail });
  }
  {
    const b = f?.salesBase;
    const [lo, hi] = f?.market === 'US' ? [1000, 3000] : [2000, 6000];
    const st: SkyStatus = !n(b) ? 'unknown' : b < lo ? 'pass' : b < hi ? 'partial' : 'fail';
    add({ id: 'base', label: 'Small starting base (room to multiply)', kind: 'support', weight: 4, status: st,
      detail: n(b) ? `yearly sales about ${money}${Math.round(b).toLocaleString('en-US')}${unit}` : `sales base ${NK}` });
  }

  // zzz1193 — framework items the numbers cannot show, from the AI check of the company's own document (only when it was run)
  if (n(g.ageDays)) {
    const d = g.ageDays;
    add({ id: 'fresh', label: 'Guidance re-confirmed recently', kind: 'support', weight: 4, status: d <= 60 ? 'pass' : d <= 120 ? 'partial' : 'fail',
      detail: `guidance from a document ${d} days old${d > 120 ? ' — check it against the latest results' : d > 60 ? ' — re-check at the next results' : ''}` });
  }
  if (ai) {
    const cv: SkyStatus = ai.cover === 'COVERED' ? 'pass' : ai.cover === 'PARTLY' ? 'partial' : ai.cover === 'NOT_COVERED' ? 'fail' : 'unknown';
    add({ id: 'cover', label: 'Capacity / orders / customers cover the plan', kind: 'support', weight: 7, status: cv,
      detail: [ai.coverText, ai.capacity ? `capacity: ${ai.capacity}` : null, ai.orders ? `orders: ${ai.orders}` : null, ai.customers ? `customers: ${ai.customers}` : null].filter(Boolean).join(' · ') || 'the document does not say what covers the plan' });
    const tr: SkyStatus = ai.track === 'DELIVERED' ? 'pass' : ai.track === 'PARTLY' ? 'partial' : ai.track === 'MISSED' ? 'fail' : 'unknown';
    add({ id: 'track', label: 'Delivered its earlier guidance', kind: 'support', weight: 6, status: tr, detail: ai.trackText || (tr === 'unknown' ? 'track record not stated in the document' : ai.track.toLowerCase()) });
  }

  // ── RED FLAGS (framework: promotional-risk penalty) ─────────────────────────────────────────────────────────────────────
  const flags: SkyFlag[] = [];
  if (g.cutInWindow) flags.push({ id: 'cut', label: 'Guidance cut', points: 10, detail: 'the company lowered its guidance in this window' });
  if (n(f?.debtorDaysNow) && n(f?.debtorDaysPrev) && f!.debtorDaysPrev! > 0 && f!.debtorDaysNow! > 60 && f!.debtorDaysNow! >= f!.debtorDaysPrev! * 1.25)
    flags.push({ id: 'receivables', label: 'Customers paying slower', points: 6, detail: `debtor days ${f!.debtorDaysPrev} → ${f!.debtorDaysNow}` });
  if (n(f?.shareCountChange2y) && f!.shareCountChange2y! > 15)
    flags.push({ id: 'dilution', label: 'More shares issued', points: 6, detail: `share count up ${Math.round(f!.shareCountChange2y!)}% in two years (new shares, or a bonus / split — check)` });
  if (n(f?.promoterNow) && n(f?.promoterYearAgo) && f!.promoterYearAgo! - f!.promoterNow! > 5)
    flags.push({ id: 'promoter', label: 'Promoters selling', points: 6, detail: `promoter holding ${f!.promoterYearAgo}% → ${f!.promoterNow}% in a year` });
  if (n(f?.otherIncomePctOfPbt) && f!.otherIncomePctOfPbt! > 30)
    flags.push({ id: 'otherIncome', label: 'Profit leans on other income', points: 5, detail: `other income is ${f!.otherIncomePctOfPbt}% of profit before tax` });

  if (ai?.deferral) flags.push({ id: 'deferral', label: 'Target pushed out / made conditional', points: 6, detail: ai.deferral });
  if (ai && ai.language === 'ASPIRATIONAL' && ai.cover === 'NOT_COVERED') flags.push({ id: 'powerpoint', label: 'Plan not backed by capacity, orders or customers', points: 8, detail: 'aspirational wording and nothing yet covers the plan — the framework\'s "PowerPoint" plan' });
  const must = checks.filter((c) => c.kind === 'must');
  const mustMet = must.filter((c) => c.status === 'pass').length;
  const mustKnown = must.filter((c) => c.status !== 'unknown').length;
  const flagPts = flags.reduce((s, x) => s + x.points, 0);
  const summary = `${mustMet} of ${must.length} main checks met${mustKnown < must.length ? ` (${must.length - mustKnown} not known)` : ''}${flags.length ? ` · ${flags.length} red flag${flags.length === 1 ? '' : 's'}` : ''}`;
  if (mustKnown < MIN_MUST_KNOWN) return { score: null, band: null, mustMet, mustKnown, mustTotal: must.length, checks, flags, capNote: `only ${mustKnown} of ${must.length} main checks have data`, summary };

  const maxPts = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + c.weight * (c.status === 'pass' ? 1 : c.status === 'partial' ? 0.5 : 0), 0);
  let score = Math.round((got / maxPts) * 100) - flagPts;
  const mustCap = MUST_CAPS[Math.max(0, Math.min(7, mustMet))];
  let cap = mustCap, capNote: string | null = mustCap < 100 ? `${mustMet} of ${must.length} main checks met — score held at ${mustCap} or below` : null;
  if (flagPts >= 10 && RED_FLAG_CAP < cap) { cap = RED_FLAG_CAP; capNote = `red flags (${flagPts} points) — score held at ${RED_FLAG_CAP} or below`; }
  // zzz1193 — the framework's last gate: "valuation does NOT already price the full target". A price far ahead of the guided growth
  // (P/E ÷ growth above 2.5, or a P/E over 100) holds the score in MIXED, however good the plan is
  { const pe = f?.pe, G = g.growthPct; const peg = n(pe) && pe > 0 && n(G) && G > 0 ? pe / G : null;
    if ((peg != null && peg > 2.5) || (n(pe) && pe > 100)) { if (PRICED_IN_CAP < cap) { cap = PRICED_IN_CAP; capNote = `price already pays for the plan (P/E ${Math.round(pe!)}${peg != null ? `, P/E ÷ growth ${Math.round(peg * 10) / 10}` : ''}) — score held at ${PRICED_IN_CAP} or below`; } } }
  score = Math.max(0, Math.min(cap, score));
  return { score, band: bandOf(score), mustMet, mustKnown, mustTotal: must.length, checks, flags, capNote, summary };
}

/** The guidance half from a focus-list row (gu-focus FocusRow). */
export function guidanceOfRow(r: { growthPct: number | null; growthTrust: string | null; growthType?: string | null; growthMetric?: string | null; growthMetrics?: string[]; growthCohort?: string | null; raised: string | null; smallRaise?: boolean; cutDate?: string | null; growthVerifiedDaysAgo?: number | null; raiseDate?: string | null }, now = new Date()): SkyGuidance {
  const raiseAge = r.raiseDate ? Math.max(0, Math.round((now.getTime() - Date.parse(`${r.raiseDate}T00:00:00Z`)) / 86_400_000)) : null;
  const ageDays = raiseAge ?? (typeof r.growthVerifiedDaysAgo === 'number' && Number.isFinite(r.growthVerifiedDaysAgo) ? r.growthVerifiedDaysAgo : null);
  return {
    growthPct: r.growthPct, growthTrust: r.growthTrust, growthType: r.growthType ?? null, growthMetric: r.growthMetric ?? null, growthMetrics: r.growthMetrics ?? (r.growthMetric ? [r.growthMetric] : []),
    multiYear: r.growthCohort === 'MULTI_YEAR_CAGR', raised: !!r.raised, smallRaise: !!r.smallRaise, cutInWindow: !!r.cutDate, ageDays,
  };
}
