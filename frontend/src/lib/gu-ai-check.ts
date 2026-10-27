// zzz1193 — GUIDANCE AI CHECK (owner, 27 Oct: "give an AI option that checks new guidance and adds it to the main focus; anything
// missing, the AI should be able to add").
//
// The automatic pipeline (collector → extractor → universe) leaves three kinds of gap on the focus page:
//   • NEW guidance it could not size — "₹2,500 Cr target (growth not established)" — so it never reaches table A / B;
//   • a company that is MISSING altogether (no document read, or read before the current rules);
//   • the framework questions numbers cannot answer — capacity, orders, customers, whether management delivered before.
// The AI check reads the company's own newest document (stored text, the exchange PDF, or the screener.in concall link) with the
// company's reported figures, and answers in a fixed shape. Nothing it says is trusted on its word:
//   • the guidance sentence must appear in the document text (checked here, word for word after spacing is normalised);
//   • a growth worked out from a target and a base is recomputed here; the base must agree with the revenue the company reports;
//   • only then can a row join the focus list, labelled "🤖 AI check" with the quote and the document.
// Pure: no fetch, no storage, no model call (lib/gu-ai-check-server.ts does those). Unit-tested.
import type { FocusRow } from './gu-focus';

export type AiCheckMode = 'new' | 'evidence' | 'names';
export type AiCheckDecision = 'ADD' | 'NOT_FOCUS' | 'NOT_GUIDANCE' | 'NO_DOCUMENT' | 'CHECK';
export type TrackStatus = 'DELIVERED' | 'PARTLY' | 'MISSED' | 'UNKNOWN';
export type CoverStatus = 'COVERED' | 'PARTLY' | 'NOT_COVERED' | 'UNKNOWN';
export type Language = 'COMMITTED' | 'EXPECTED' | 'ASPIRATIONAL' | 'UNKNOWN';

/** One company the page asks about. `growthText` = what the page already shows (for "evidence" mode). */
export interface AiCheckTarget { market: 'IN' | 'US'; ticker: string | null; company: string; growthText?: string | null }

/** The framework answers numbers cannot give (owner's "Identify Next SKY GOLD": capacity, orders, customers, credibility, promotion). */
export interface AiEvidence {
  cover: CoverStatus; coverText: string | null;          // do capacity / orders / customers already cover the plan?
  capacity: string | null; orders: string | null; customers: string | null;
  track: TrackStatus; trackText: string | null;           // did management deliver its earlier guidance?
  language: Language;                                      // "committed / contracted" vs "aspire / potential"
  deferral: string | null;                                 // a target pushed out, "next year", macro excuses
}

export interface AiCheckResult {
  key: string; market: 'IN' | 'US'; ticker: string | null; company: string;
  checkedAt: string; mode: AiCheckMode;
  doc: { kind: string; filedAt: string | null; url: string | null; title: string | null; via: 'stored' | 'exchange-pdf' | 'screener-concall' } | null;
  decision: AiCheckDecision;
  metric: 'REVENUE' | 'PAT' | 'EBITDA' | 'EPS' | null;
  period: string | null; years: number | null;
  /** growth % a year (a multi-year plan is a yearly rate) */ growthLow: number | null; growthHigh: number | null;
  /** 'STATED' = the company said the %; 'WORKED_OUT' = target ÷ base, recomputed here */ growthHow: 'STATED' | 'WORKED_OUT' | null;
  targetText: string | null; baseText: string | null;
  raise: { from: string; to: string } | null;
  quote: string | null; quoteFound: boolean;
  reason: string;
  evidence: AiEvidence | null;
  issues: string[];
  model: string | null; costUsd: number;
}

export interface AiCheckStore { v: 1; updatedAt: string; results: Record<string, AiCheckResult> }
export const AI_CHECK_KEY = 'gu-ai-check:v1:results';
export const AI_CHECK_JOB = 'gu-ai-check';
export const AI_CHECK_MAX_PER_RUN = 12;
export const AI_CHECK_STORE_CAP = 400;
export const FOCUS_GROWTH_MIN = 30;

export const keyOfTarget = (t: Pick<AiCheckTarget, 'market' | 'ticker' | 'company'>) =>
  `${t.market === 'US' ? 'US' : 'IN'}|${(t.ticker || '').toUpperCase() || t.company.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;

/** Names typed by the owner: "Acutaas, KROSS; Pitti Engineering" → targets (≤ 12, deduplicated). A bare symbol is taken as a ticker. */
export function parseNames(raw: string, market: 'IN' | 'US' = 'IN'): AiCheckTarget[] {
  const seen = new Set<string>();
  const out: AiCheckTarget[] = [];
  for (const part of String(raw || '').split(/[,;\n]+/)) {
    const s = part.trim().replace(/^(NSE|BSE|NASDAQ|NYSE):/i, '').slice(0, 80);
    if (!s || s.length < 2) continue;
    const sym = /^[A-Z0-9&-]{2,20}$/.test(s) ? s : /^[a-z0-9&-]{2,20}$/i.test(s) && !/\s/.test(s) ? s.toUpperCase() : null;
    const t: AiCheckTarget = { market, ticker: sym, company: sym ? sym : s };
    const k = keyOfTarget(t);
    if (seen.has(k)) continue;
    seen.add(k); out.push(t);
    if (out.length >= AI_CHECK_MAX_PER_RUN) break;
  }
  return out;
}

/** Validates a target list from the page (identity only; the server reads every figure itself). */
export function cleanTargets(raw: unknown, max = AI_CHECK_MAX_PER_RUN): AiCheckTarget[] {
  const out: AiCheckTarget[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(raw) ? raw : []) {
    const market = x?.market === 'US' ? 'US' : 'IN';
    const ticker = typeof x?.ticker === 'string' && /^[A-Z0-9&.:-]{1,24}$/i.test(x.ticker.trim()) ? x.ticker.trim().toUpperCase().replace(/^(NSE|BSE):/, '') : null;
    const company = typeof x?.company === 'string' ? x.company.replace(/[<>]/g, '').trim().slice(0, 100) : '';
    if (!ticker && company.length < 2) continue;
    const t: AiCheckTarget = { market, ticker, company: company || ticker!, growthText: typeof x?.growthText === 'string' ? x.growthText.slice(0, 160) : null };
    const k = keyOfTarget(t);
    if (seen.has(k)) continue;
    seen.add(k); out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

// ── the model's answer ─────────────────────────────────────────────────────────────────────────────────────────────
export const AI_CHECK_TOOL = {
  name: 'record_guidance_check',
  description: "Record what the company's own document says about its forward guidance, and the evidence behind the plan.",
  input_schema: {
    type: 'object', additionalProperties: false,
    required: ['decision', 'metric', 'period', 'years', 'growth_low', 'growth_high', 'stated_pct', 'target_low', 'target_high', 'target_unit', 'base_value', 'base_period', 'raised_from', 'quote', 'reason',
      'cover', 'cover_text', 'capacity', 'orders', 'customers', 'track', 'track_text', 'language', 'deferral'],
    properties: {
      decision: { type: 'string', enum: ['GUIDANCE', 'NOT_GUIDANCE', 'NO_GUIDANCE'], description: 'GUIDANCE = the company states a forward target for the WHOLE company (revenue, profit, EBITDA or EPS). NOT_GUIDANCE = the figure is a capacity potential, a segment, an industry size, an order book or an aspiration without a period. NO_GUIDANCE = no forward figure.' },
      metric: { type: ['string', 'null'], enum: ['REVENUE', 'PAT', 'EBITDA', 'EPS', null] },
      period: { type: ['string', 'null'], maxLength: 20, description: "The target year in the company's fiscal terms, e.g. FY27, FY26-29." },
      years: { type: ['integer', 'null'], minimum: 1, maximum: 10, description: 'Number of growth years the target covers (1 for one year).' },
      growth_low: { type: ['number', 'null'], description: 'Growth % a year the company states (low end). Null when it only gives an amount.' },
      growth_high: { type: ['number', 'null'] },
      stated_pct: { type: 'boolean', description: 'True only when the company itself states the growth %.' },
      target_low: { type: ['number', 'null'], description: 'The target amount (low end) when the company gives an amount.' },
      target_high: { type: ['number', 'null'] },
      target_unit: { type: ['string', 'null'], enum: ['crore', 'million', 'billion', null] },
      base_value: { type: ['number', 'null'], description: 'The base year amount in the same unit: from the document, else from the reported figures given to you. Null when unknown.' },
      base_period: { type: ['string', 'null'], maxLength: 12 },
      raised_from: { type: ['string', 'null'], maxLength: 120, description: 'When the document says the target was raised: the earlier target in words (e.g. "15–25% growth"). Else null.' },
      quote: { type: ['string', 'null'], maxLength: 400, description: 'The guidance sentence copied EXACTLY from the document text (no paraphrase).' },
      reason: { type: 'string', maxLength: 240, description: 'One plain sentence: what the guidance is and why it does or does not count.' },
      cover: { type: 'string', enum: ['COVERED', 'PARTLY', 'NOT_COVERED', 'UNKNOWN'], description: 'Do existing capacity, order book or signed customers already cover the target?' },
      cover_text: { type: ['string', 'null'], maxLength: 200 },
      capacity: { type: ['string', 'null'], maxLength: 160, description: 'Capacity now, utilisation, new capacity and when — as stated. Null when not stated.' },
      orders: { type: ['string', 'null'], maxLength: 160, description: 'Order book / backlog / order inflow as stated. Null when not stated.' },
      customers: { type: ['string', 'null'], maxLength: 160, description: 'Customer wins, approvals, qualification as stated. Null when not stated.' },
      track: { type: 'string', enum: ['DELIVERED', 'PARTLY', 'MISSED', 'UNKNOWN'], description: "Did the company deliver its EARLIER guidance (only if the document or the figures show it)?" },
      track_text: { type: ['string', 'null'], maxLength: 200 },
      language: { type: 'string', enum: ['COMMITTED', 'EXPECTED', 'ASPIRATIONAL', 'UNKNOWN'], description: 'COMMITTED = contracted / orders in hand; EXPECTED = "we expect / guide"; ASPIRATIONAL = "aspire / potential / could".' },
      deferral: { type: ['string', 'null'], maxLength: 200, description: 'A target pushed to a later year, or growth made conditional on macro / demand returning. Null when none.' },
    },
  },
} as const;

export const AI_CHECK_SYSTEM = `You read ONE listed company's own document (earnings call, investor presentation or results release) and record its forward guidance for the WHOLE company, plus the evidence behind the plan. You are careful and literal.

Rules:
- Guidance = a forward target the company states for the whole company: revenue, profit (PAT), EBITDA or EPS, for a stated year or years.
- NOT guidance: revenue POTENTIAL from capacity, a segment or one business, an industry or market size, an order book, a hope without a year, an analyst's number.
- Copy the guidance sentence EXACTLY as it appears in the text into "quote". Never paraphrase.
- If the company gives only an amount (₹2,500 crore by FY27), give the amount; give the base year amount only if the document states it or it is in the reported figures provided. Never invent figures.
- A multi-year target: give the number of years and the growth % a year if stated.
- Prefer revenue guidance; use profit, EBITDA or EPS when revenue is not guided.
- Evidence: say plainly what the document states about capacity and utilisation, order book, customers and approvals, whether earlier guidance was delivered, and any target pushed out. Missing = null / UNKNOWN, not bad.
- Plain simple English.`;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
/** The quote is in the text: word for word after spacing / quotes / dashes are normalised; a long quote may match on its first 120 characters. */
export function quoteInText(quote: string | null | undefined, text: string): boolean {
  if (!quote || quote.trim().length < 15 || !text) return false;
  const q = norm(quote).replace(/^["'.…\s]+|["'.…\s]+$/g, '');
  const t = norm(text);
  if (t.includes(q)) return true;
  return q.length > 140 && t.includes(q.slice(0, 120));
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const fmtAmt = (v: number, unit: string | null, market: 'IN' | 'US') =>
  market === 'IN' ? `₹${Math.round(v).toLocaleString('en-IN')} Cr` : unit === 'billion' ? `$${v}B` : `$${Math.round(v).toLocaleString('en-US')}M`;
/** Amount in the facts unit (India ₹ Cr, USA $M). */
export function toFactsAmount(v: number | null, unit: string | null, market: 'IN' | 'US'): number | null {
  if (v == null) return null;
  if (market === 'IN') return unit === 'crore' || unit == null ? v : unit === 'million' ? v / 10 : unit === 'billion' ? v * 100 : null;
  return unit === 'billion' ? v * 1000 : unit === 'million' || unit == null ? v : null;
}

/** Reported figures the server hands over: last full year sales / profit (facts unit) and the year. */
export interface ReportedBase { year: string | null; sales: number | null; pat: number | null; source: string }

/** Pure: turns the model's answer into a checked result (quote in the text, growth recomputed, base against reported revenue). */
export function checkAnswer(a: any, ctx: { target: AiCheckTarget; text: string; reported: ReportedBase | null; mode: AiCheckMode; now: Date; doc: AiCheckResult['doc']; model: string | null; costUsd: number }): AiCheckResult {
  const { target, reported } = ctx;
  const market = target.market;
  const issues: string[] = [];
  const quote = typeof a?.quote === 'string' ? a.quote.trim().slice(0, 400) : null;
  const quoteFound = quoteInText(quote, ctx.text);
  const metric = ['REVENUE', 'PAT', 'EBITDA', 'EPS'].includes(a?.metric) ? a.metric : null;
  const years = num(a?.years) && a.years >= 1 && a.years <= 10 ? Math.round(a.years) : null;
  let lo = num(a?.growth_low), hi = num(a?.growth_high) ?? lo;
  if (lo == null && hi != null) lo = hi;
  let how: AiCheckResult['growthHow'] = lo != null && a?.stated_pct === true ? 'STATED' : null;
  const unit = ['crore', 'million', 'billion'].includes(a?.target_unit) ? a.target_unit : null;
  const tLo = toFactsAmount(num(a?.target_low) ?? num(a?.target_high), unit, market), tHi = toFactsAmount(num(a?.target_high) ?? num(a?.target_low), unit, market);
  let base = toFactsAmount(num(a?.base_value), unit, market);
  let baseText: string | null = null;
  const repBase = metric === 'REVENUE' ? reported?.sales ?? null : metric === 'PAT' ? reported?.pat ?? null : null;
  // a stated % is used as stated; an amount is set against a base (the document's, else the reported last full year)
  if (how !== 'STATED' && tLo != null && tHi != null && (metric === 'REVENUE' || metric === 'PAT')) {
    if (base == null && repBase != null && repBase > 0) { base = repBase; baseText = `${reported!.year || 'last full year'} reported ${fmtAmt(repBase, null, market)} (${reported!.source})`; }
    else if (base != null) baseText = `${a?.base_period || 'base year'} ${fmtAmt(base, null, market)} (from the document)`;
    if (base != null && base > 0) {
      const n = years && years > 1 ? years : 1;
      const g = (v: number) => r1((Math.pow(v / base!, 1 / n) - 1) * 100);
      lo = g(tLo); hi = g(tHi); how = 'WORKED_OUT';
    }
  }
  // the base must agree with the revenue the company reports (a part-year base makes a huge "growth")
  if (how === 'WORKED_OUT' && base != null && repBase != null && repBase > 0 && (base < 0.6 * repBase || base > 1.6 * repBase)) {
    issues.push(`the base used (${fmtAmt(base, null, market)}) does not match the reported ${metric === 'PAT' ? 'profit' : 'revenue'} (${fmtAmt(repBase, null, market)})`);
  }
  if (lo != null && hi != null && (lo > 300 || hi > 300 || lo < -60)) issues.push(`growth of ${r1(lo)}–${r1(hi)}% is not believable as a company target`);
  if (lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo];
  const targetText = tLo != null ? `${tLo === tHi ? fmtAmt(tLo, null, market) : `${fmtAmt(tLo, null, market)}–${fmtAmt(tHi!, null, market)}`}${a?.period ? ` by ${String(a.period).slice(0, 20)}` : ''}` : null;
  const ev: AiEvidence = {
    cover: ['COVERED', 'PARTLY', 'NOT_COVERED', 'UNKNOWN'].includes(a?.cover) ? a.cover : 'UNKNOWN',
    coverText: str(a?.cover_text, 200), capacity: str(a?.capacity, 160), orders: str(a?.orders, 160), customers: str(a?.customers, 160),
    track: ['DELIVERED', 'PARTLY', 'MISSED', 'UNKNOWN'].includes(a?.track) ? a.track : 'UNKNOWN', trackText: str(a?.track_text, 200),
    language: ['COMMITTED', 'EXPECTED', 'ASPIRATIONAL', 'UNKNOWN'].includes(a?.language) ? a.language : 'UNKNOWN',
    deferral: str(a?.deferral, 200),
  };
  let decision: AiCheckDecision;
  const reason = str(a?.reason, 240) || '';
  if (!ctx.doc) decision = 'NO_DOCUMENT';
  else if (a?.decision === 'NOT_GUIDANCE') decision = 'NOT_GUIDANCE';
  else if (a?.decision !== 'GUIDANCE' || !metric) decision = 'NOT_FOCUS';
  else if (!quoteFound) { decision = 'CHECK'; issues.push('the guidance sentence was not found word for word in the document'); }
  else if (issues.length) decision = 'CHECK';
  else if (lo == null) { decision = 'CHECK'; issues.push('no growth could be worked out (no base year figure)'); }
  else decision = (lo + (hi ?? lo)) / 2 >= FOCUS_GROWTH_MIN || (!!a?.raised_from && lo >= 15) ? 'ADD' : 'NOT_FOCUS';
  return {
    key: keyOfTarget(target), market, ticker: target.ticker, company: target.company, checkedAt: ctx.now.toISOString(), mode: ctx.mode, doc: ctx.doc,
    decision, metric, period: str(a?.period, 20), years, growthLow: lo != null ? r1(lo) : null, growthHigh: hi != null ? r1(hi) : null, growthHow: lo != null ? how ?? 'STATED' : null,
    targetText, baseText, raise: a?.raised_from && decision !== 'NOT_GUIDANCE' ? { from: String(a.raised_from).slice(0, 120), to: lo != null ? growthWords(lo, hi) : targetText || '' } : null,
    quote, quoteFound, reason, evidence: decision === 'NO_DOCUMENT' ? null : ev, issues, model: ctx.model, costUsd: ctx.costUsd,
  };
}
const str = (v: unknown, n: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
export const growthWords = (lo: number, hi: number | null) => (hi == null || hi === lo ? `+${r1(lo)}%` : `+${r1(lo)}–${r1(hi)}%`);

/** A result with no document found (nothing was sent to the model). */
export function noDocResult(target: AiCheckTarget, mode: AiCheckMode, now: Date, why: string): AiCheckResult {
  return { key: keyOfTarget(target), market: target.market, ticker: target.ticker, company: target.company, checkedAt: now.toISOString(), mode, doc: null, decision: 'NO_DOCUMENT',
    metric: null, period: null, years: null, growthLow: null, growthHigh: null, growthHow: null, targetText: null, baseText: null, raise: null, quote: null, quoteFound: false,
    reason: why, evidence: null, issues: [], model: null, costUsd: 0 };
}

/** Merge new results into the store (newest wins, capped). Pure. */
export function mergeStore(prev: AiCheckStore | null, add: AiCheckResult[], now: Date): AiCheckStore {
  const results: Record<string, AiCheckResult> = { ...(prev?.results || {}) };
  for (const r of add) {
    const old = results[r.key];
    // an evidence-only re-read never throws away an earlier ADD's guidance
    if (old && old.decision === 'ADD' && r.mode === 'evidence' && r.decision !== 'ADD') { results[r.key] = { ...old, evidence: r.evidence ?? old.evidence, checkedAt: r.checkedAt }; continue; }
    results[r.key] = r;
  }
  const keys = Object.keys(results).sort((a, b) => (results[b].checkedAt || '').localeCompare(results[a].checkedAt || ''));
  for (const k of keys.slice(AI_CHECK_STORE_CAP)) delete results[k];
  return { v: 1, updatedAt: now.toISOString(), results };
}

/** Focus rows for AI-checked guidance that qualifies (ADD), for companies the page does not already list with a growth. Pure. */
export function aiFocusRows(results: AiCheckResult[], have: ReadonlySet<string>, sizeOf: (market: 'IN' | 'US', ticker: string | null) => Pick<FocusRow, 'size' | 'capText'>, now: Date): FocusRow[] {
  const out: FocusRow[] = [];
  for (const r of results) {
    if (r.decision !== 'ADD' || r.growthLow == null || have.has(r.key)) continue;
    const mid = Math.round((((r.growthLow + (r.growthHigh ?? r.growthLow)) / 2) * 10)) / 10;
    const mWord = r.metric === 'PAT' ? 'PAT' : r.metric === 'EBITDA' ? 'EBITDA' : r.metric === 'EPS' ? 'EPS' : 'Revenue';
    const multi = (r.years ?? 1) > 1;
    const age = r.doc?.filedAt ? Math.max(0, Math.round((now.getTime() - Date.parse(r.doc.filedAt)) / 86_400_000)) : null;
    out.push({
      key: r.key, company: r.company, ticker: r.ticker, market: r.market,
      raised: null, raisePct: null, raiseDate: null, eventId: null,
      growth: `${mWord} ${growthWords(r.growthLow, r.growthHigh)}${multi ? ' a year (multi-year)' : ''}${r.growthHow === 'WORKED_OUT' ? ' (worked out)' : ''}`,
      growthPct: mid, growthPeriod: r.period, growthTrust: r.growthHow === 'STATED' ? 'verified' : 'derived',
      growthType: r.growthHow === 'STATED' ? 'EXPLICIT' : 'DERIVED', growthMetric: r.metric, growthMetrics: r.metric ? [r.metric] : [], growthCohort: multi ? 'MULTI_YEAR_CAGR' : 'ANNUAL',
      growthDate: r.doc?.filedAt ? r.doc.filedAt.slice(0, 10) : null, growthSource: `${r.doc?.title || r.doc?.kind || 'Company document'} · read by the AI check`, growthSourceUrl: r.doc?.url ?? null,
      growthFreshness: null, growthVerifiedDaysAgo: age,
      verdict: mid >= 50 ? 'HIGH GROWTH' : 'WATCH',
      why: `🤖 AI check: ${r.growthHow === 'STATED' ? `guides ${mid}% growth` : `${r.targetText || 'target'} against ${r.baseText || 'the base year'} ≈ ${mid}% a year`} — sentence checked in the document`,
      score: Math.min(100, mid) + (age != null && age <= 14 ? 20 : age != null && age <= 45 ? 10 : 0) + (r.growthHow === 'STATED' ? 10 : 0),
      aiAdded: true, aiQuote: r.quote,
      ...sizeOf(r.market, r.ticker),
    } as FocusRow);
  }
  return out;
}

export const DECISION_WORD: Record<AiCheckDecision, string> = {
  ADD: 'added to the focus list', NOT_FOCUS: 'guidance read — below 30% growth, not added', NOT_GUIDANCE: 'not company guidance (capacity potential, segment, industry or aspiration)',
  NO_DOCUMENT: 'no company document found to read', CHECK: 'held for a check — the answer did not pass the checks',
};
