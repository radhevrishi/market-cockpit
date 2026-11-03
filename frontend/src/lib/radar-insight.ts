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
  /** zzz1219: industry / sector from the screener (lenders are judged differently) */
  industry?: string | null;
  sector?: string | null;
}

export type Lane = 'INFLECTION' | 'EARLY' | 'NONE';
// zzz1216 — a snapshot of the latest quarter against the last 12 months is NOT proof of sustained acceleration: the
// verdict says exactly what was compared ("latest quarter stronger than the year"), and a low base is called out.
export type ResultsVerdict = 'STRONGER_LATEST' | 'GROWING' | 'SLOWING' | 'DECLINING' | 'UNKNOWN';
export type GuidanceVerdict = 'RAISED' | 'MAINTAINED' | 'LOWERED' | 'NEW' | 'NONE' | 'NOT_COMPARABLE';
/** zzz1219: what the proof sentence actually shows */
export type ProofKind = 'MILESTONE' | 'RESULTS_COMMENTARY' | 'NOT_PROVEN';
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
  /** zzz1219: does the displayed quote itself prove the named business event? */
  proof: { kind: ProofKind; reason: string };
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
  evidence_quote?: string | null;               // the sentence that proves the top evidence rung
  filing_datetime?: string | null;
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

/** zzz1219 — a derived growth figure (target ÷ reported base) is only meaningful when both sides cover the same business,
 *  metric and period. A company-wide base against a segment target shows up as a large fall (Himadri: −26.7% CAGR). Such a
 *  pair is reported as "not comparable", never as growth. Pure. */
export function guidanceScopeProblem(display: string, salesCr: number | null | undefined): string | null {
  const d = String(display || '');
  const amt = (s: string) => Number(s.replace(/,/g, ''));
  const pair = d.match(/₹\s?([\d,]+(?:\.\d+)?)(?:\s*[–-]\s*([\d,]+(?:\.\d+)?))?\s*Cr\s+vs\s+₹\s?([\d,]+(?:\.\d+)?)\s*Cr/i);
  if (pair) {
    const hi = amt(pair[2] || pair[1]), base = amt(pair[3]);
    if (base > 0 && hi / base < 0.9) return `the target (₹${pair[2] ? `${pair[1]}–${pair[2]}` : pair[1]} Cr) is below the reported base (₹${pair[3]} Cr) — they likely cover different businesses or measures`;
    if (base > 0 && hi / base > 4) return `the target is more than 4× the reported base — likely a different scope or a multi-year figure`;
  }
  // a negative growth or CAGR stated as a guidance figure without the company saying "decline" is almost always a scope mix-up
  const neg = d.match(/(?:CAGR|growth|vs FY\d\d actual)[^.]{0,40}?(?<![\d.])([−-]\d+(?:\.\d+)?)%|(?<![\d.])([−-]\d+(?:\.\d+)?)%[^.]{0,40}?(?:CAGR|vs FY\d\d actual)/i);
  if (neg && !/declin|lower|reduc|cut/i.test(d)) return `a ${neg[1] || neg[2]}% figure was derived from a target and a base that may not match`;
  const target = d.match(/₹\s?([\d,]+(?:\.\d+)?)(?:\s*[–-]\s*([\d,]+(?:\.\d+)?))?\s*Cr\s+target/i);
  const s = typeof salesCr === 'number' && Number.isFinite(salesCr) && salesCr > 0 ? salesCr : null;
  if (target && s) {
    const hi = amt(target[2] || target[1]);
    if (hi < 0.7 * s) return `the ₹${target[2] || target[1]} Cr target is well below the company's annual sales (₹${Math.round(s).toLocaleString('en-IN')} Cr) — likely one business or a different measure`;
  }
  return null;
}

export function guidanceVerdict(f: RadarFacts): { verdict: GuidanceVerdict; text: string } {
  const g = f.guidance;
  if (!g) return { verdict: 'NONE', text: 'No company guidance on file.' };
  const when = g.period ? ` for ${g.period}` : '';
  const scope = guidanceScopeProblem(g.display, f.salesCr);
  if (scope) return { verdict: 'NOT_COMPARABLE', text: `Guidance${when} on file, but not comparable: ${scope}. No growth figure is calculated until the scope is reconciled.` };
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
  // zzz1219: only an order amount in the proof sentence itself is sized against sales. The largest figure elsewhere in the
  // document may be another segment, a pipeline or a cumulative total — it is shown, but never scored.
  const inQuote = orderValueCr(String(e.evidence_quote || ''));
  const docMax = num(e.order_value_cr), s = num(f.salesCr);
  if (inQuote == null && docMax != null) return { pctOfSales: null, text: `The document mentions orders of up to ₹${Math.round(docMax).toLocaleString('en-IN')} Cr, but not in the proof sentence — segment and timing not confirmed. Materiality unverified.` };
  const o = inQuote;
  if (o == null) return { pctOfSales: null, text: 'Materiality unverified — no order value or plan size stated in the document.' };
  if (s == null || s <= 0) return { pctOfSales: null, text: `Orders of about ₹${Math.round(o).toLocaleString('en-IN')} Cr stated; annual sales not available to size them. Materiality unverified.` };
  const p = Math.round((100 * o) / s);
  return { pctOfSales: p, text: `Orders of about ₹${Math.round(o).toLocaleString('en-IN')} Cr ≈ ${p}% of annual sales (₹${Math.round(s).toLocaleString('en-IN')} Cr). Orders, not yet revenue — delivery timing and margin unknown.` };
}

const FIN_RE = /\b(bank|nbfc|financ|lending|credit|insurance|housing fin|microfin|asset manag|broking|capital market|wealth)/i;
const DONE_RE = /\b(received|won|secured|bagged|bagging|awarded|commenc\w*|commission\w*|started|began|begun|achieved|completed|qualified|approved|cleared|validated|launched|inaugurat\w*|operational|delivered|signed|executed|transitioned)\b/i;
const HYPO_RE = /\b(priorit\w+|focus(?:ed|ing)? on|goals?|strateg\w+|roadmap|potential(?:ly)?|could|would|may|might|expect\w*|anticipat\w*|plan(?:s|ned|ning)?|will|shall|intend\w*|aim\w*|target\w*|hope|watch(?:ing)? for|likely|upcoming|going forward|pipeline|opportunit\w+|enquir\w+|explor\w+|evaluat\w+|in discussion|if)\b/i;
const DRIVER_RE = /\b(mix|utili[sz]ation|new (?:plant|facility|capacity|product|line|segment|business|market|geograph\w*)|value[- ]added|premiumi[sz]\w*|backward integration|export\w*|commission\w*|capacity|ramp[- ]?up|new customers?|price increases?|realisation|realization|debottleneck\w*)\b|\b(?:made up|share|contribut\w+)\b[^.]{0,40}\bof (?:revenue|sales)\b/i;

/** zzz1219 — the quote shows a past timeline, a cumulative multi-year total or an old fiscal year, not a new event. */
export function isHistorical(quote: string, now: Date = new Date()): boolean {
  const q = String(quote || '');
  if (/\b(over the (?:last|past) \d+ years|since (?:19|20)\d\d|track record|milestones?|history|historically|in the past)\b/i.test(q)) return true;
  const years = new Set([...q.matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map((m) => Number(m[1])));
  if (years.size >= 3) return true;
  const fyNow = now.getUTCMonth() >= 3 ? (now.getUTCFullYear() + 1) % 100 : now.getUTCFullYear() % 100;
  const fys = [...q.matchAll(/\b(?:FY|F\.Y\.\s?)['’]?(\d{2})\b/gi)].map((m) => Number(m[1]));
  const calYears = [...years];
  const allOld = (fys.length > 0 || calYears.length > 0) && fys.every((y) => y <= fyNow - 2) && calYears.every((y) => y <= 2000 + fyNow - 3);
  return allOld;
}

/** zzz1219 — does the displayed quote itself prove the named business event? A keyword elsewhere in the document is not proof:
 *  each event needs its own completed, current, on-topic sentence. Results commentary (margins, revenue, cash flow) is a
 *  business change only when the sentence names a structural driver (mix, utilisation, a new plant or product …). */
/** zzz1219c — presentation bullet text run together ("…up 19% YoY Freight Forwarding Overall revenue…"): words that start a new
 *  line on the slide follow a lower-case word with no punctuation. Two such joins in a company document = slide text, not a sentence. */
export function isSlideRunOn(quote: string): boolean {
  const joins = String(quote || '').match(/[a-z0-9%)]\s[A-Z][a-z]{2,}/g) || [];
  return joins.length >= 2;
}

export function eventProof(label: string | null | undefined, quote: string | null | undefined, f: RadarFacts = {}, now: Date = new Date(), role?: string | null): { kind: ProofKind; reason: string } {
  const l = String(label || ''), q = String(quote || '').replace(/\s+/g, ' ');
  if (!q) return { kind: 'NOT_PROVEN', reason: 'No proof sentence.' };
  // zzz1219: chart axis / table text from a slide ("- 10 20 30 40 50 …") states no event in a sentence
  const nums = q.match(/(?:^|\s)[-+]?\d[\d.,]*%?(?=\s|$)/g) || [];
  if (nums.length >= 7 || /(?:\d[\d.,]*%?\s+){4,}\d/.test(q)) return { kind: 'NOT_PROVEN', reason: 'Slide chart or table text — the event and its cause are not stated in one sentence.' };
  if (role === 'COMPANY' && isSlideRunOn(q)) return { kind: 'NOT_PROVEN', reason: 'Slide bullet text joined from several lines — the event and its cause are not one sentence.' };
  if (/\b(delay\w*|deferr\w*|postpon\w*|pushed out|slipp\w*)\b/i.test(q)) return { kind: 'NOT_PROVEN', reason: 'The sentence reports a delay — not a completed milestone.' };
  const lender = FIN_RE.test(`${f.industry || ''} ${f.sector || ''}`);
  const hypothetical = HYPO_RE.test(q) && !DONE_RE.test(q);
  if (/^Order received/.test(l)) {
    const amt = orderValueCr(q);
    const won = /\b(received|secured|bagged|bagging|awarded|order inflows?|order wins?|letter of (?:award|intent)|LoA|purchase order)\b|won\b/i.test(q);
    if (hypothetical || /\bpotential|watch(?:ing)? for|could|expect\w*/i.test(q) && !won) return { kind: 'NOT_PROVEN', reason: 'The sentence talks about possible orders, not a confirmed order.' };
    if (!won && (amt == null || amt < 5)) return { kind: 'NOT_PROVEN', reason: 'The sentence mentions an order book in general terms — no confirmed order or order value.' };
    if (isHistorical(q, now)) return { kind: 'NOT_PROVEN', reason: 'The order mentioned is historical, not new.' };
    // zzz1220: a total order book is a stock of past orders — context for revenue visibility, not proof of a new change
    if (!won) return { kind: 'RESULTS_COMMENTARY', reason: `Order book of about ₹${Math.round(amt || 0).toLocaleString('en-IN')} Cr stated (total book, not a new order) — visibility context, not proof of a change.` };
    return { kind: 'MILESTONE', reason: 'Confirmed order in the sentence.' };
  }
  if (/^Commercial production/.test(l)) {
    if (/\b(advert\w*|tvc|television|campaign|brand (?:refresh|film|campaign)|commercials?\b(?! (?:production|supply|dispatch|operation)))/i.test(q) && !/\bcommercial (?:production|supply|dispatch|operations?)\b/i.test(q)) return { kind: 'NOT_PROVEN', reason: '"Commercial" here means an advertisement or brand campaign, not production.' };
    if (!/\b(commercial (?:production|supply|dispatch|operations?)|commenc\w* (?:commercial )?(?:production|operations|supply|manufacturing)|production (?:has )?(?:commenc|start)\w*|commission\w*|started (?:commercial )?production|ramp\w*[- ]up|to commercial production)\b/i.test(q)) return { kind: 'NOT_PROVEN', reason: 'The sentence does not say production or commissioning has started.' };
    if (isHistorical(q, now)) return { kind: 'NOT_PROVEN', reason: 'The sentence describes past milestones or a multi-year total, not a recent start.' };
    if (hypothetical) return { kind: 'NOT_PROVEN', reason: 'Production is planned, not started.' };
    if (/\b(agreement|mou|memorandum|letter of intent|loi)\b/i.test(q) && !/\b(commenc\w*|started|began|begun|commission\w*|operational)\b/i.test(q)) return { kind: 'NOT_PROVEN', reason: 'An agreement for future supply — production has not started.' };
    return { kind: 'MILESTONE', reason: 'Production / commissioning started (in the sentence).' };
  }
  if (/^Customer qualification/.test(l)) {
    if (/\b(board|director|independent|regulat\w*|statutory|professional|personnel|staff|team|educat\w*|qualified (?:people|engineers|members))\b/i.test(q)) return { kind: 'NOT_PROVEN', reason: '"Qualified" here refers to people, the board or regulation, not a customer.' };
    if (!/\b(customer|client|oem|buyer|innovator|pharma (?:major|company)|automaker|utility|vendor (?:registration|approval)|approved vendor|supplier (?:approval|qualification))\b/i.test(q)) return { kind: 'NOT_PROVEN', reason: 'No customer named in the qualification sentence.' };
    if (!/\b(qualified|approved|cleared|validated|received approval|got approval|completed (?:the )?qualification)\b/i.test(q) || hypothetical) return { kind: 'NOT_PROVEN', reason: 'Qualification is in progress or a capability, not achieved.' };
    if (isHistorical(q, now)) return { kind: 'NOT_PROVEN', reason: 'The qualification described is historical.' };
    return { kind: 'MILESTONE', reason: 'Customer qualification achieved (in the sentence).' };
  }
  if (/^Second \/ third customer/.test(l)) {
    if (lender) return { kind: 'RESULTS_COMMENTARY', reason: 'For a lender, new customers and branches are routine growth, not a business change.' };
    return isHistorical(q, now) ? { kind: 'NOT_PROVEN', reason: 'Historical customer additions.' } : { kind: 'MILESTONE', reason: 'New customer or product (in the sentence).' };
  }
  if (/^Facility \/ equipment ready/.test(l)) {
    if (hypothetical) return { kind: 'NOT_PROVEN', reason: 'The facility is planned, not ready.' };
    return isHistorical(q, now) ? { kind: 'NOT_PROVEN', reason: 'Historical facility milestone.' } : { kind: 'MILESTONE', reason: 'Facility ready / commissioned (in the sentence).' };
  }
  if (/^(Margin improvement|Revenue visible|FCF)/.test(l)) {
    if (lender) return { kind: 'RESULTS_COMMENTARY', reason: 'For a lender, margin / income lines are routine results, not a business change.' };
    if (hypothetical) return { kind: 'NOT_PROVEN', reason: 'Priorities or plans, not a result already achieved.' };
    if (DRIVER_RE.test(q) && !isHistorical(q, now)) return { kind: 'MILESTONE', reason: 'Results change tied to a named structural driver (mix, utilisation, new capacity or product).' };
    return { kind: 'RESULTS_COMMENTARY', reason: 'Quarterly results commentary (margin / revenue / cash flow) with no distinct business change named.' };
  }
  return { kind: 'NOT_PROVEN', reason: 'Plans, partnerships or talk only — no completed milestone.' };
}

export function radarInsight(e: InsightEntry, f: RadarFacts | null | undefined, now: Date = new Date()): RadarInsight {
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
  const proof = eventProof(e.evidence_label, e.evidence_quote, facts, now, e.quote_role);
  // zzz1219: a business change needs drivers in the document AND a sentence that itself proves a completed, current event
  const transformation = structural >= 2 && ev >= 3 && proof.kind === 'MILESTONE';

  let lane: Lane = 'NONE', laneReason: string;
  if (negativeTone || cut || caution >= 2) laneReason = cut ? 'Guidance cut or lowered outlook.' : 'Cautious document tone.';
  else if (proof.kind !== 'MILESTONE' && structural >= 2 && ev >= 3) laneReason = proof.kind === 'RESULTS_COMMENTARY' ? `Results commentary only — ${proof.reason}` : `Not proven: ${proof.reason}`;
  else if (ev >= 7 && numbersUp && quoteOk && transformation) {
    lane = 'INFLECTION';
    laneReason = `Business change in the document (${e.evidence_label || 'results'}, quoted from management) and growth in the reported numbers — that the change caused the growth is not proven.`;
  } else if (transformation) {
    lane = 'EARLY';
    laneReason = ev >= 7 && numbersUp && !quoteOk ? 'Growth in the numbers, but the proof is not a clean management statement.'
      : ev >= 7 ? 'Realised proof in the document, but the reported numbers do not show it yet.'
      : numbersUp ? `New business under way (${e.evidence_label || 'milestones'}) on top of results that already grow.`
      : `Change under way (${e.evidence_label || 'milestones'}); not yet in the numbers.`;
  } else laneReason = structural < 2 ? 'Fewer than two business-change drivers — keyword mentions only.' : 'No milestone evidence yet (plans or talk only).';

  const openConflict = e.review_queue === 'RECONCILE' || e.review_queue === 'RISK';
  const bestWhy: string[] = [], blockers: string[] = [];
  let score = 0;
  if (lane === 'INFLECTION') { score += 35; bestWhy.push('change and growth both seen'); } else if (lane === 'EARLY') { score += 25; bestWhy.push('change under way'); } else blockers.push(laneReason);
  // zzz1219: tone is a gate for "best", not points — the score rewards recency, proof and economic size instead
  if (tone === 'POSITIVE') bestWhy.push('positive management tone'); else if (tone === 'MIXED') blockers.push('mixed tone'); else blockers.push(tone ? `${tone.toLowerCase()} tone` : 'tone not read');
  const ageD = e.filing_datetime ? (now.getTime() - new Date(e.filing_datetime).getTime()) / 86_400_000 : NaN;
  if (Number.isFinite(ageD) && ageD <= 14) { score += 10; bestWhy.push('filed in the last 2 weeks'); } else if (Number.isFinite(ageD) && ageD <= 35) score += 5;
  if (quoteOk) { score += 15; bestWhy.push('proof quoted from management'); } else blockers.push(e.quote_role === 'ANALYST' ? 'proof is an analyst question' : 'no clean management quote');
  if (results.verdict === 'STRONGER_LATEST') { score += results.lowBase ? 8 : 15; bestWhy.push('latest quarter stronger'); } else if (results.verdict === 'GROWING') score += 8; else if (results.verdict === 'UNKNOWN') blockers.push('results not checked'); else blockers.push(`results ${results.verdict.toLowerCase()}`);
  if (results.lowBase) blockers.push('possible low-base effect');
  if (guidance.verdict === 'RAISED') { score += 10; bestWhy.push('guidance raised'); } else if (guidance.verdict === 'LOWERED') blockers.push('guidance lowered');
  if (valuation.gap === 'STRETCHED') { score -= 5; blockers.push('expensive on trailing figures'); }
  if (materiality.pctOfSales != null && materiality.pctOfSales >= 25) { score += 10; bestWhy.push(`orders ≈ ${materiality.pctOfSales}% of sales`); }
  else if (materiality.pctOfSales != null && materiality.pctOfSales >= 10) score += 5;
  if (guidance.verdict === 'NOT_COMPARABLE') blockers.push('guidance not comparable with reported figures');
  if (structural >= 3) score += 5;
  if (caution >= 1) score -= 5;
  if (openConflict) blockers.push('contradiction in the document not reconciled');
  score = Math.max(0, Math.min(100, score));
  const passesAll = lane !== 'NONE' && proof.kind === 'MILESTONE' && tone === 'POSITIVE' && quoteOk && !cut
    && results.verdict !== 'DECLINING' && results.verdict !== 'SLOWING'
    && valuation.gap !== 'STRETCHED' && score >= 60;
  const best = passesAll && !openConflict;
  const promising = passesAll && openConflict;

  const laneWord = lane === 'INFLECTION' ? 'Earnings inflection' : lane === 'EARLY' ? 'Early transformation' : 'No clear transformation';
  const saysResults = /results|numbers/.test(laneReason) && numbersUp;
  const rWord = results.verdict === 'STRONGER_LATEST' ? 'Latest quarter stronger than the year.' : results.verdict === 'GROWING' ? 'Results growing.' : results.verdict === 'SLOWING' ? 'Results slowing.' : 'Results falling.';
  const headline = `${laneWord}: ${laneReason}${results.verdict !== 'UNKNOWN' && !saysResults ? ` ${rWord}` : ''}`;
  return {
    lane, laneReason, results, guidance, valuation, materiality, proof,
    checks: { transformation, growth: numbersUp, causalLink: false },
    best, promising, bestScore: score, bestWhy,
    blockers: lane === 'NONE' ? blockers : blockers.filter((b) => b !== laneReason), headline,
  };
}
