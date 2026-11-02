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
}

export type Lane = 'INFLECTION' | 'EARLY' | 'NONE';
export type ResultsVerdict = 'ACCELERATING' | 'GROWING' | 'SLOWING' | 'DECLINING' | 'UNKNOWN';
export type GuidanceVerdict = 'RAISED' | 'MAINTAINED' | 'LOWERED' | 'NEW' | 'NONE';
export type ValuationGap = 'NOT_PRICED_IN' | 'PARTLY' | 'PRICED_IN' | 'UNKNOWN';

export interface RadarInsight {
  lane: Lane;
  laneReason: string;
  results: { verdict: ResultsVerdict; text: string };
  guidance: { verdict: GuidanceVerdict; text: string };
  valuation: { gap: ValuationGap; text: string; pe: number | null; peg: number | null };
  best: boolean;
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
}

const STRUCTURAL = new Set(['customer', 'capacity', 'cdmo', 'export', 'recurring', 'acqui', 'mix', 'debt', 'parent', 'tam', 'tech', 'utilisation']);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v)}%`);

export function resultsVerdict(f: RadarFacts): { verdict: ResultsVerdict; text: string } {
  const rq = num(f.revQ), rt = num(f.revTTM);
  const pq = num(f.epsQ) ?? num(f.ebitdaQ);
  if (rq == null && pq == null) return { verdict: 'UNKNOWN', text: 'No quarterly results in the screener data yet.' };
  const profitWord = num(f.epsQ) != null ? 'EPS' : 'EBITDA';
  const base = `Latest quarter: sales ${pct(rq)}, ${profitWord} ${pct(pq)} YoY${rt != null ? `; last 12 months sales ${pct(rt)}` : ''}.`;
  if ((rq ?? 0) < 0 && (pq ?? 0) < 0) return { verdict: 'DECLINING', text: `${base} Sales and profit both fell.` };
  if (rq != null && rt != null && rq < rt - 10 && rq < 10) return { verdict: 'SLOWING', text: `${base} Growth is slowing against the year.` };
  if (pq != null && pq < -10) return { verdict: 'SLOWING', text: `${base} Profit fell.` };
  if (rq != null && rq >= 15 && (pq == null || pq >= 20) && (rt == null || rq >= rt + 5)) return { verdict: 'ACCELERATING', text: `${base} Growth is speeding up.` };
  if ((rq ?? 0) >= 10 && (pq == null || pq >= 10)) return { verdict: 'GROWING', text: `${base} Growing.` };
  return { verdict: 'SLOWING', text: `${base} Growth is modest.` };
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
  const growth = num(f.epsTTM) ?? num(f.epsQ);
  const p6 = num(f.perf6M), p1 = num(f.perf1Y);
  if (pe == null || pe <= 0) return { gap: 'UNKNOWN', text: 'No meaningful P/E (loss or no data).', pe: null, peg: null };
  const peg = growth != null && growth > 0 ? Math.round((pe / growth) * 100) / 100 : null;
  const move = `${p6 != null ? `6 months ${pct(p6)}` : ''}${p6 != null && p1 != null ? ', ' : ''}${p1 != null ? `1 year ${pct(p1)}` : ''}`;
  const head = `P/E ${Math.round(pe)}${peg != null ? `, P/E ÷ EPS growth ${peg.toFixed(1)}` : ''}${move ? `; price ${move}` : ''}.`;
  if (pe > 80 || (peg != null && peg > 2.5) || (p1 != null && p1 > 150)) return { gap: 'PRICED_IN', text: `${head} Much of the change looks priced in.`, pe, peg };
  if (peg != null && peg <= 1.2 && (p6 == null || p6 < 30)) return { gap: 'NOT_PRICED_IN', text: `${head} The price has not caught up with the growth yet.`, pe, peg };
  return { gap: 'PARTLY', text: `${head} Partly priced in.`, pe, peg };
}

export function radarInsight(e: InsightEntry, f: RadarFacts | null | undefined): RadarInsight {
  const facts = f || {};
  const results = resultsVerdict(facts);
  const guidance = guidanceVerdict(facts);
  const valuation = valuationGap(facts);
  const keys = new Set((e.patterns || []).map((p) => p.key));
  const structural = [...keys].filter((k) => STRUCTURAL.has(k)).length;
  const ev = e.evidence_score ?? 0;
  const caution = e.caution_level ?? 0;
  const tone = String(e.tone || '').toUpperCase();
  const negativeTone = tone === 'NEGATIVE' || ['BEARISH', 'MIXED_NEGATIVE'].includes(String(e.bullish_tier || '').toUpperCase());
  const cut = (e.caution_flags || []).some((x) => /guidance (?:reduced|cut)|outlook lowered/i.test(x)) || guidance.verdict === 'LOWERED';
  const numbersUp = results.verdict === 'ACCELERATING' || results.verdict === 'GROWING';

  let lane: Lane = 'NONE', laneReason: string;
  if (negativeTone || cut || caution >= 2) laneReason = cut ? 'Guidance cut or lowered outlook.' : 'Cautious document tone.';
  else if (ev >= 8 && numbersUp) { lane = 'INFLECTION'; laneReason = `Realised proof in the document (${e.evidence_label || 'results'}) and growth in the reported numbers.`; }
  else if (structural >= 2 && ev >= 3) { lane = 'EARLY'; laneReason = ev >= 8 ? 'Realised proof in the document, but the reported numbers do not show it yet.' : `Change under way (${e.evidence_label || 'milestones'}); not yet in the numbers.`; }
  else laneReason = structural < 2 ? 'Fewer than two business-change drivers — keyword mentions only.' : 'No milestone evidence yet (plans or talk only).';

  const quoteOk = e.quote_quality === 'USABLE' && (e.quote_role === 'MANAGEMENT' || e.quote_role === 'COMPANY');
  const bestWhy: string[] = [], blockers: string[] = [];
  let score = 0;
  if (lane === 'INFLECTION') { score += 35; bestWhy.push('in the numbers already'); } else if (lane === 'EARLY') { score += 25; bestWhy.push('change under way'); } else blockers.push(laneReason);
  if (tone === 'POSITIVE') { score += 15; bestWhy.push('positive management tone'); } else if (tone === 'MIXED') { score += 5; blockers.push('mixed tone'); } else blockers.push(tone ? `${tone.toLowerCase()} tone` : 'tone not read');
  if (quoteOk) { score += 15; bestWhy.push('proof quoted from management'); } else blockers.push(e.quote_role === 'ANALYST' ? 'proof is an analyst question' : 'no clean management quote');
  if (results.verdict === 'ACCELERATING') { score += 15; bestWhy.push('growth speeding up'); } else if (results.verdict === 'GROWING') score += 8; else if (results.verdict === 'UNKNOWN') blockers.push('results not checked'); else blockers.push(`results ${results.verdict.toLowerCase()}`);
  if (guidance.verdict === 'RAISED') { score += 10; bestWhy.push('guidance raised'); } else if (guidance.verdict === 'LOWERED') blockers.push('guidance lowered');
  if (valuation.gap === 'NOT_PRICED_IN') { score += 10; bestWhy.push('not priced in'); } else if (valuation.gap === 'PARTLY') score += 4; else if (valuation.gap === 'PRICED_IN') blockers.push('largely priced in');
  if (structural >= 3) score += 5;
  if (caution >= 1) score -= 5;
  score = Math.max(0, Math.min(100, score));
  const best = lane !== 'NONE' && tone === 'POSITIVE' && quoteOk && !cut
    && results.verdict !== 'DECLINING' && results.verdict !== 'SLOWING'
    && !(lane === 'INFLECTION' && valuation.gap === 'PRICED_IN') && score >= 60;

  const laneWord = lane === 'INFLECTION' ? 'Earnings inflection' : lane === 'EARLY' ? 'Early transformation' : 'No clear transformation';
  const headline = `${laneWord}: ${laneReason}${results.verdict !== 'UNKNOWN' ? ` ${results.verdict === 'ACCELERATING' ? 'Results speeding up.' : results.verdict === 'GROWING' ? 'Results growing.' : results.verdict === 'SLOWING' ? 'Results slowing.' : 'Results falling.'}` : ''}`;
  return { lane, laneReason, results, guidance, valuation, best, bestScore: score, bestWhy, blockers: lane === 'NONE' ? blockers : blockers.filter((b) => b !== laneReason), headline };
}
