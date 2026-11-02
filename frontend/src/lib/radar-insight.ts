// ═══════════════════════════════════════════════════════════════════════════
// zzz1214 — Transformation Radar: lanes, cross-period checks, valuation gap, "best transformations".
//
// The document says what management claims. This module checks the claim against what the market data already shows:
//   results   — latest quarter's growth against the trailing twelve months (is growth speeding up or fading?)
//   guidance  — the guidance universe's revision for the company (raised / maintained / lowered across filings)
//   valuation — P/E, P/E ÷ growth and the 6-month / 1-year price move (is the change already in the price?)
// and puts every company in one lane:
//   INFLECTION — the change is already in reported numbers (realised proof in the document + growth in the results)
//   EARLY      — the change is under way (capacity, customers, orders, approvals) but not yet in the numbers
//   NONE       — keywords only, or the document is cautious
// "Best" is a strict, explainable filter on top. Rules only, no AI; every verdict carries its reason. Pure.
// ═══════════════════════════════════════════════════════════════════════════

export interface RadarFacts {
  mcCr?: number | null;      // market cap, ₹ crore (India) / $ million (US)
  pe?: number | null;
  revQ?: number | null;      // revenue growth, latest quarter YoY %
  revTTM?: number | null;    // revenue growth, trailing 12 months YoY %
  epsQ?: number | null;      // EPS growth, latest quarter YoY %
  epsTTM?: number | null;
  ebitdaQ?: number | null;   // EBITDA growth, latest quarter YoY %
  perf6M?: number | null;
  perf1Y?: number | null;
  stage?: number | null;     // weekly Stage Analysis 1–4
  stageHealth?: number | null;
  resultsDate?: string | null;
  guidance?: { revision: string; display: string; period: string | null; atRisk: boolean } | null;
  /** annual sales, ₹ crore (market cap ÷ P/S), for order materiality */
  salesCr?: number | null;
  /** when the screener snapshot was built (shown with the figures) */
  asOf?: string | null;
}

export type Lane = 'INFLECTION' | 'EARLY' | 'NONE';
// zzz1216 — a snapshot of the latest quarter against the last 12 months is NOT proof of sustained acceleration: the
// verdict says exactly what was compared ("latest quarter stronger than the year"), and a low base is called out.
export type ResultsVerdict = 'STRONGER_LATEST' | 'GROWING' | 'SLOWING' | 'DECLINING' | 'UNKNOWN';
export type GuidanceVerdict = 'RAISED' | 'MAINTAINED' | 'LOWERED' | 'NEW' | 'NONE';
// zzz1216 — the radar has no forward earnings model, so it never says "not priced in". Trailing P/E and the price move
// are shown as context; only an obviously stretched trailing valuation is flagged.
export type ValuationGap = 'NOT_UNDERWRITTEN' | 'STRETCHED' | 'UNKNOWN';

export interface RadarInsight {
  lane: Lane;
  laneReason: string;
  results: { verdict: ResultsVerdict; text: string; lowBase: boolean };
  guidance: { verdict: GuidanceVerdict; text: string };
  valuation: { gap: ValuationGap; text: string; pe: number | null; peg: number | null };
  /** order value against annual sales, or "unverified" */
  materiality: { pctOfSales: number | null; text: string };
  /** three separate facts — never inferred from each other */
  checks: { transformation: boolean; growth: boolean; causalLink: false };
  best: boolean;
  /** everything for "best" passes except an open contradiction in the document (needs reading first) */
  promising: boolean;
  bestScore: number;      // 0–100
  bestWhy: string[];      // what is good
  blockers: string[];     // what keeps it out of "best"
  headline: string;       // one plain sentence for the card
}

export interface InsightEntry {
  patterns?: Array<{ key: string }>;
  evidence_score?: number;
  evidence_breadth?: number;
  evidence_label?: string;
  caution_level?: number;
  caution_flags?: string[];
  tone?: string | null;                         // POSITIVE / MIXED / NEGATIVE / NEUTRAL (document)
  bullish_tier?: string;
  quote_role?: string | null;                   // MANAGEMENT / ANALYST / COMPANY / UNKNOWN
  quote_quality?: string | null;                // USABLE / QUESTION / BOILERPLATE / BROKEN / MISSING
  review_queue?: string | null;                 // radarDecision queue: RECONCILE / RISK mean an open contradiction
  order_value_cr?: number | null;               // largest order / order-book value management states, ₹ crore
}

const STRUCTURAL = new Set(['customer', 'capacity', 'cdmo', 'export', 'recurring', 'acqui', 'mix', 'debt', 'parent', 'tam', 'tech', 'utilisation']);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v)}%`);

export function resultsVerdict(f: RadarFacts): { verdict: ResultsVerdict; text: string; lowBase: boolean } {
  const rq = num(f.revQ), rt = num(f.revTTM);
  const pq = num(f.epsQ) ?? num(f.ebitdaQ);
  if (rq == null && pq == null) return { verdict: 'UNKNOWN', text: 'No quarterly results in the screener data yet.', lowBase: false };
  const profitWord = num(f.epsQ) != null ? 'EPS' : 'EBITDA';
  const lowBase = (rq != null && rq > 150) || (pq != null && pq > 200);
  const base = `Latest quarter vs same quarter last year: sales ${pct(rq)}, ${profitWord} ${pct(pq)}${rt != null ? `; last 12 months sales ${pct(rt)}` : ''}.${lowBase ? ' Possible low-base effect — one quarter is not a trend.' : ''}`;
  if ((rq ?? 0) < 0 && (pq ?? 0) < 0) return { verdict: 'DECLINING', text: `${base} Sales and profit both fell.`, lowBase };
  if (rq != null && rt != null && rq < rt - 10 && rq < 10) return { verdict: 'SLOWING', text: `${base} The latest quarter is weaker than the year.`, lowBase };
  if (pq != null && pq < -10) return { verdict: 'SLOWING', text: `${base} Profit fell.`, lowBase };
  if (rq != null && rq >= 15 && (pq == null || pq >= 20) && (rt == null || rq >= rt + 5)) return { verdict: 'STRONGER_LATEST', text: `${base} The latest quarter grew faster than the last 12 months (a snapshot, not yet a sustained trend).`, lowBase };
  if ((rq ?? 0) >= 10 && (pq == null || pq >= 10)) return { verdict: 'GROWING', text: `${base} Growing.`, lowBase };
  return { verdict: 'SLOWING', text: `${base} Growth is modest.`, lowBase };
}

export function guidanceVerdict(f: RadarFacts): { verdict: GuidanceVerdict; text: string } {
  const g = f.guidance;
  if (!g) return { verdict: 'NONE', text: 'No company guidance on file.' };
  const when = g.period ? ` for ${g.period}` : '';
  const r = String(g.revision || '').toUpperCase();
  if (r === 'RAISED') return { verdict: 'RAISED', text: `Guidance raised${when}: ${g.display}.` };
  if (r === 'LOWERED' || r === 'WITHDRAWN') return { verdict: 'LOWERED', text: `Guidance ${r === 'WITHDRAWN' ? 'withdrawn' : 'lowered'}${when}: ${g.display}.` };
  if (r === 'MAINTAINED') return { verdict: 'MAINTAINED', text: `Guidance kept${when}: ${g.display}${g.atRisk ? ' (at risk against results)' : ''}.` };
  return { verdict: 'NEW', text: `Guidance${when}: ${g.display}${g.atRisk ? ' (at risk against results)' : ''}.` };
}

export function valuationGap(f: RadarFacts): { gap: ValuationGap; text: string; pe: number | null; peg: number | null } {
  const pe = num(f.pe);
  const p6 = num(f.perf6M), p1 = num(f.perf1Y);
  const move = `${p6 != null ? `6 months ${pct(p6)}` : ''}${p6 != null && p1 != null ? ', ' : ''}${p1 != null ? `1 year ${pct(p1)}` : ''}`;
  if (pe == null || pe <= 0) return { gap: 'UNKNOWN', text: `No meaningful trailing P/E (loss or no data)${move ? `; price ${move}` : ''}. Valuation not underwritten.`, pe: null, peg: null };
  const head = `Trailing P/E ${Math.round(pe)}${move ? `; price ${move}` : ''}.`;
  if (pe > 80 || (p1 != null && p1 > 150)) return { gap: 'STRETCHED', text: `${head} Expensive on trailing figures — needs strong future earnings.`, pe, peg: null };
  return { gap: 'NOT_UNDERWRITTEN', text: `${head} Valuation not underwritten: there is no forward earnings estimate here, so a low P/E or a falling price is not proof of value.`, pe, peg: null };
}

/** Largest order / order-book value management states, in ₹ crore ("order book of INR 200 crores", "orders worth ₹1,250 Cr"). */
export function orderValueCr(text: string): number | null {
  const t = String(text || '');
  const re = /\border(?:s| book| inflow| inflows| backlog| pipeline| win| wins)?\b[^.]{0,60}?(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|mn\b|million|bn\b|billion)|(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|mn\b|million|bn\b|billion)[^.]{0,40}?\border(?:s| book| inflow| backlog)?\b/gi;
  let best: number | null = null;
  for (const m of t.matchAll(re)) {
    const v = Number(String(m[1] ?? m[3]).replace(/,/g, ''));
    const u = String(m[2] ?? m[4]).toLowerCase();
    if (!Number.isFinite(v) || v <= 0) continue;
    const cr = /lakh/.test(u) ? v / 100 : /^(mn|million)/.test(u) ? v / 10 : /^(bn|billion)/.test(u) ? v * 100 : v;
    if (/pipeline/i.test(m[0])) continue;   // a pipeline is not an order
    if (best == null || cr > best) best = cr;
  }
  return best;
}

export function materialityOf(e: InsightEntry, f: RadarFacts): { pctOfSales: number | null; text: string } {
  const o = num(e.order_value_cr), s = num(f.salesCr);
  if (o == null) return { pctOfSales: null, text: 'Materiality unverified — no order value or plan size stated in the document.' };
  if (s == null || s <= 0) return { pctOfSales: null, text: `Orders of about ₹${Math.round(o).toLocaleString('en-IN')} Cr stated; annual sales not available to size them. Materiality unverified.` };
  const p = Math.round((100 * o) / s);
  return { pctOfSales: p, text: `Orders of about ₹${Math.round(o).toLocaleString('en-IN')} Cr ≈ ${p}% of annual sales (₹${Math.round(s).toLocaleString('en-IN')} Cr). Orders, not yet revenue — delivery timing and margin unknown.` };
}

export function radarInsight(e: InsightEntry, f: RadarFacts | null | undefined): RadarInsight {
  const facts = f || {};
  const results = resultsVerdict(facts);
  const guidance = guidanceVerdict(facts);
  const valuation = valuationGap(facts);
  const materiality = materialityOf(e, facts);
  const keys = new Set((e.patterns || []).map((p) => p.key));
  const structural = [...keys].filter((k) => STRUCTURAL.has(k)).length;
  const ev = e.evidence_score ?? 0;
  const caution = e.caution_level ?? 0;
  const tone = String(e.tone || '').toUpperCase();
  const negativeTone = tone === 'NEGATIVE' || ['BEARISH', 'MIXED_NEGATIVE'].includes(String(e.bullish_tier || '').toUpperCase());
  const cut = (e.caution_flags || []).some((x) => /guidance (?:reduced|cut)|outlook lowered/i.test(x)) || guidance.verdict === 'LOWERED';
  const numbersUp = results.verdict === 'STRONGER_LATEST' || results.verdict === 'GROWING';
  // the proof must be a clean sentence from management or the company's own document — never an analyst or an unknown speaker
  const quoteOk = e.quote_quality === 'USABLE' && (e.quote_role === 'MANAGEMENT' || e.quote_role === 'COMPANY');
  const transformation = structural >= 2 && ev >= 3;

  let lane: Lane = 'NONE', laneReason: string;
  if (negativeTone || cut || caution >= 2) laneReason = cut ? 'Guidance cut or lowered outlook.' : 'Cautious document tone.';
  else if (ev >= 8 && numbersUp && quoteOk && transformation) {
    lane = 'INFLECTION';
    laneReason = `Business change in the document (${e.evidence_label || 'results'}, quoted from management) and growth in the reported numbers — that the change caused the growth is not proven.`;
  } else if (transformation) {
    lane = 'EARLY';
    laneReason = ev >= 8 && numbersUp && !quoteOk ? 'Growth in the numbers, but the proof is not a clean management statement.'
      : ev >= 8 ? 'Realised proof in the document, but the reported numbers do not show it yet.'
      : numbersUp ? `New business under way (${e.evidence_label || 'milestones'}) on top of results that already grow.`
      : `Change under way (${e.evidence_label || 'milestones'}); not yet in the numbers.`;
  } else laneReason = structural < 2 ? 'Fewer than two business-change drivers — keyword mentions only.' : 'No milestone evidence yet (plans or talk only).';

  const openConflict = e.review_queue === 'RECONCILE' || e.review_queue === 'RISK';
  const bestWhy: string[] = [], blockers: string[] = [];
  let score = 0;
  if (lane === 'INFLECTION') { score += 35; bestWhy.push('change and growth both seen'); } else if (lane === 'EARLY') { score += 25; bestWhy.push('change under way'); } else blockers.push(laneReason);
  if (tone === 'POSITIVE') { score += 15; bestWhy.push('positive management tone'); } else if (tone === 'MIXED') { score += 5; blockers.push('mixed tone'); } else blockers.push(tone ? `${tone.toLowerCase()} tone` : 'tone not read');
  if (quoteOk) { score += 15; bestWhy.push('proof quoted from management'); } else blockers.push(e.quote_role === 'ANALYST' ? 'proof is an analyst question' : 'no clean management quote');
  if (results.verdict === 'STRONGER_LATEST') { score += results.lowBase ? 8 : 15; bestWhy.push('latest quarter stronger'); } else if (results.verdict === 'GROWING') score += 8; else if (results.verdict === 'UNKNOWN') blockers.push('results not checked'); else blockers.push(`results ${results.verdict.toLowerCase()}`);
  if (results.lowBase) blockers.push('possible low-base effect');
  if (guidance.verdict === 'RAISED') { score += 10; bestWhy.push('guidance raised'); } else if (guidance.verdict === 'LOWERED') blockers.push('guidance lowered');
  if (valuation.gap === 'STRETCHED') { score -= 5; blockers.push('expensive on trailing figures'); }
  if (materiality.pctOfSales != null && materiality.pctOfSales >= 25) { score += 10; bestWhy.push(`orders ≈ ${materiality.pctOfSales}% of sales`); }
  if (structural >= 3) score += 5;
  if (caution >= 1) score -= 5;
  if (openConflict) blockers.push('contradiction in the document not reconciled');
  score = Math.max(0, Math.min(100, score));
  const passesAll = lane !== 'NONE' && tone === 'POSITIVE' && quoteOk && !cut
    && results.verdict !== 'DECLINING' && results.verdict !== 'SLOWING'
    && !(lane === 'INFLECTION' && valuation.gap === 'STRETCHED') && score >= 60;
  const best = passesAll && !openConflict;
  const promising = passesAll && openConflict;

  const laneWord = lane === 'INFLECTION' ? 'Earnings inflection' : lane === 'EARLY' ? 'Early transformation' : 'No clear transformation';
  const saysResults = /results|numbers/.test(laneReason) && numbersUp;
  const rWord = results.verdict === 'STRONGER_LATEST' ? 'Latest quarter stronger than the year.' : results.verdict === 'GROWING' ? 'Results growing.' : results.verdict === 'SLOWING' ? 'Results slowing.' : 'Results falling.';
  const headline = `${laneWord}: ${laneReason}${results.verdict !== 'UNKNOWN' && !saysResults ? ` ${rWord}` : ''}`;
  return {
    lane, laneReason, results, guidance, valuation, materiality,
    checks: { transformation, growth: numbersUp, causalLink: false },
    best, promising, bestScore: score, bestWhy,
    blockers: lane === 'NONE' ? blockers : blockers.filter((b) => b !== laneReason), headline,
  };
}
