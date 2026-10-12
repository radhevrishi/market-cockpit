// ═══════════════════════════════════════════════════════════════════════════
// zzz975 — INDIA: ONE LINE — DID MANAGEMENT RAISE, KEEP OR LOWER ITS GUIDANCE?
//
// Owner: "these guidance and such important functionalities missing in India
// earnings opportunities, can you implement to India earnings opportunities
// nicely". The US cards got this in zzz971 (lib/us-guide-line). This is the
// India side, built only from what is ALREADY stored — no new AI call:
//
//   1. the quote-checked guidance figures the guidance extractor filed for this
//      company's documents of this results season (guidance-extract:v1:<docId>,
//      status RAISED / LOWERED / REITERATED / NEW per figure, each with the
//      company's own sentence). A profit or revenue line guided BELOW last year
//      counts as cautious.
//   2. the stored AI forward-guidance read of the concall (haiku-fg:v3:…),
//      used for a cut ONLY when it is Negative with HIGH / MEDIUM confidence
//      and carries a quote.
//   3. the card's own text (guidance / narrative / announcement text), read
//      with the US sentence detectors (lib/us-guide-text) plus the Indian
//      wordings they miss ("revised downwards", "moderated our guidance",
//      "lower than earlier guided", "reiterate", "retain", "year-on-year").
//
// A cut (or a profit line guided below last year) found ANYWHERE wins and moves
// a BLOCKBUSTER or STRONG quarter to MIXED. A raise or a kept outlook is shown
// but never moves a tier. Pure: no fetch, no React — used by the server overlay
// (lib/in-guide-check) and by the browser for cards it grades itself.
// ═══════════════════════════════════════════════════════════════════════════

import { guideLoweredInText, guideRaisedInText, guideKeptInText, guideCautionInText, splitSentences, focusQuote } from './us-guide-text';
import type { GuideDirection } from './us-guide-line';

/** Bumped whenever the line or the tier rule changes: a browser copy of a day without it is fetched again. */
export const IN_OVERLAY_VERSION = 'in-guide-v1';
export const IN_GUIDE_TAGS = { lowered: 'guidance lowered', mixed: 'guidance mixed', cautious: 'guidance cautious' } as const;

export type InGuideDirection = GuideDirection | 'positive';

export interface InGuideLine {
  direction: InGuideDirection;
  /** the line itself, ≤ ~170 characters */
  text: string;
  /** a longer explanation (the quote) for the tooltip */
  title: string;
  /** where the verdict came from, in plain words */
  source: string;
  url: string | null;
  /** true = a BLOCKBUSTER / STRONG row must be MIXED */
  lowered: boolean;
}

/** One stored extracted figure (shape of ExtractedGuidance in guidance-docs-types, only what is read here). */
export interface InExtractRowLike {
  metric: string; metricLabel?: string; period?: string; status?: string;
  low?: number | null; high?: number | null; unit?: string | null; currency?: string | null;
  growthPctLow?: number | null; growthPctHigh?: number | null;
  prior?: { low: number | null; high: number | null; statedIn?: string | null } | null;
  priorActual?: { period: string; value: number; quote?: string } | null;
  quote?: string;
}
export interface InExtractDocLike { docId?: string; docKind?: string; docUrl?: string; filedAt?: string; status?: string; rows?: InExtractRowLike[] }
export interface InAiGuidanceLike {
  label?: string; confidence?: string; rationale?: string; quotes?: string[];
  numbers?: Array<{ metric: string; value: string; period?: string }>; source?: string; source_url?: string; period?: string;
}
export interface InGuideStored {
  /** this company's extracted documents of this results season, any order */
  extracts?: InExtractDocLike[] | null;
  /** the stored AI forward-guidance read for this quarter */
  ai?: InAiGuidanceLike | null;
}

// ── text: the Indian wordings the US detectors miss ──────────────────────────
const NOUN = String.raw`(?:guidance|outlook|(?:revenue|sales|growth|margin|ebitda|pat|volume|order\s+inflow)\s+targets?|forecast)`;
// a word between verb and noun: figures allowed, joining words not ("guidance and we cut costs" is not a cut)
const W = String.raw`(?:(?!(?:and|but|while|which|that|as|or|because|so|then|we|it)\b)[\w$₹.%–\-'’]+(?:,\d+)*\s+)`;
const IN_DOWN = [
  new RegExp(String.raw`\b(?:revis(?:ed|es|ing)|scal(?:ed|es|ing)|toned|pared|brought|bring(?:ing)?)\s+(?:down(?:wards?)?|back)\s+(?:our|its|the|their)?\s*${W}{0,4}?${NOUN}\b`, 'i'),
  new RegExp(String.raw`\b(?:revis(?:ed|es|ing)|scal(?:ed|es|ing)|toned|pared|brought|moderat(?:ed|es|ing)|lower(?:ed|ing)?)\s+(?:our|its|the|their)\s+${W}{0,4}?${NOUN}\s+(?:\w+\s+){0,2}?(?:down(?:wards?)?|lower)\b`, 'i'),
  new RegExp(String.raw`\bmoderat(?:ed|es|ing)\s+(?:our|its|the|their)\s+${W}{0,4}?${NOUN}\b`, 'i'),
  new RegExp(String.raw`\b${NOUN}\s+${W}{0,4}?(?:has\s+been|have\s+been|was|were|is|are|now|stands?)?\s*(?:revised\s+downwards?|revised\s+down|scaled\s+down|scaled\s+back|moderated|toned\s+down|pared(?:\s+down)?|brought\s+down|lowered|cut|trimmed)\b`, 'i'),
  new RegExp(String.raw`\b(?:expect|see|will|would\s+now|now|guid(?:e|ing)|estimat(?:e|ing)|likely)\b[^.;]{0,80}?\b(?:lower|less|slower|weaker)\s+than\s+(?:what\s+we\s+had\s+)?(?:earlier|previously|initially|originally)\s+(?:guided|indicated|estimated|expected|communicated)\b`, 'i'),
  new RegExp(String.raw`\b(?:expect|see|will|now|likely)\b[^.;]{0,80}?\bbelow\s+(?:our|the)\s+(?:earlier|previous|initial|original)\s+(?:guidance|target|outlook)\b`, 'i'),
];
const IN_UP = [
  new RegExp(String.raw`\b(?:revis(?:ed|es|ing))\s+(?:upwards?)\s+(?:our|its|the|their)?\s*${W}{0,4}?${NOUN}\b`, 'i'),
  new RegExp(String.raw`\b(?:revis(?:ed|es|ing))\s+(?:our|its|the|their)\s+${W}{0,4}?${NOUN}\s+(?:\w+\s+){0,2}?upwards?\b`, 'i'),
  new RegExp(String.raw`\b${NOUN}\s+${W}{0,4}?(?:has\s+been|have\s+been|was|were|is|are|now)?\s*revised\s+upwards?\b`, 'i'),
];
const IN_KEEP = [
  new RegExp(String.raw`\b(?:reiterate|retain(?:ed|s|ing)?|stick(?:ing)?\s+to|stand\s+by|standing\s+by)\s+(?:our|its|the|their)?\s*${W}{0,4}?${NOUN}\b`, 'i'),
  new RegExp(String.raw`\bon\s+track\s+to\s+(?:achieve|meet|deliver)\s+(?:our|its|the|their)\s+${W}{0,3}?${NOUN}\b`, 'i'),
  new RegExp(String.raw`\bno\s+change\s+(?:in|to)\s+(?:our|its|the|their)\s+${W}{0,3}?${NOUN}\b`, 'i'),
];
// a profit line guided below last year, the Indian way of saying "year over year"
const IN_PROFIT = String.raw`(?:pat|profit|profits|ebitda|margins?|eps|earnings)`;
const IN_FUTURE = String.raw`(?:expect(?:s|ed)?|will\s+be|guid(?:e|ed|ance)|likely\s+to)`;
const IN_DOWNW = String.raw`(?:declin(?:e|es|ed|ing)|lower|down|decreas(?:e|ed|ing)|compress(?:ed|ion)?)`;
const IN_VS = String.raw`(?:year[- ]on[- ]year|yoy|y-o-y|last\s+year|previous\s+year|fy\s?'?\d{2})`;
const IN_CAUTION = new RegExp(String.raw`\b${IN_PROFIT}\b[^.]{0,80}?\b${IN_FUTURE}\b[^.]{0,80}?\b${IN_DOWNW}\b[^.]{0,60}?\b${IN_VS}\b|\b${IN_FUTURE}\b[^.]{0,40}?\b${IN_PROFIT}\b[^.]{0,40}?\b${IN_DOWNW}\b[^.]{0,60}?\b${IN_VS}\b`, 'i');
const NOT_A_CUT_IN = /\b(?:costs?|expenses?|debt|borrowings?|interest|tax(?:es)?|losses|working\s+capital|price\s+target|capex|inventory|receivables?)\b/i;
const NOT_A_RAISE_IN = /\b(?:capital|funds|money|qip|dividend|prices?|price\s+target|stake|debt|costs?)\b/i;
const NEGATED = /\b(?:not|n['’]t|never|no\s+need|without|avoid(?:ing|ed)?|rather\s+than|instead\s+of|if|unless|could|would\s+not|might)\b[^.;]{0,45}$/i;
const BOILER = /\bforward[- ]looking\s+statements?\b|\bsafe\s+harbou?r\b|\brisks?\s+and\s+uncertainties\b/i;

function inMatch(text: string, res: RegExp[], skip: RegExp): string | null {
  for (const sn of splitSentences(text)) {
    if (sn.length < 20 || sn.length > 1200 || BOILER.test(sn)) continue;
    for (const re of res) {
      const m = re.exec(sn);
      if (!m) continue;
      if (skip.test(m[0])) continue;
      if (NEGATED.test(sn.slice(Math.max(0, m.index - 60), m.index))) continue;
      return focusQuote(sn, m.index, m[0].length);
    }
  }
  return null;
}
/** A sentence saying management lowered its outlook — the US detector first, then the Indian wordings. */
export function inLoweredInText(text: string): string | null {
  return guideLoweredInText(text)?.quote ?? inMatch(text, IN_DOWN, NOT_A_CUT_IN);
}
/** A sentence saying management raised its outlook. Call after the lowered check — a cut anywhere wins. */
export function inRaisedInText(text: string): string | null {
  return guideRaisedInText(text)?.quote ?? inMatch(text, IN_UP, NOT_A_RAISE_IN);
}
/** A sentence saying management kept / reiterated its outlook. */
export function inKeptInText(text: string): string | null {
  return guideKeptInText(text)?.quote ?? inMatch(text, IN_KEEP, /\b(?:dividend|rating|listing)\b/i);
}
/** A sentence guiding a profit line below last year. */
export function inCautionInText(text: string): string | null {
  const us = guideCautionInText(text);
  if (us) return us.quote;
  for (const sn of splitSentences(text)) {
    if (sn.length < 25 || sn.length > 400 || BOILER.test(sn) || /\bcould\b|\bmay\b|\bif\b/i.test(sn)) continue;
    const m = IN_CAUTION.exec(sn);
    if (!m || /\b(?:costs?|expenses?|losses|tax\s+rate|interest)\b/i.test(m[0])) continue;
    if (NEGATED.test(sn.slice(Math.max(0, m.index - 60), m.index))) continue;
    return focusQuote(sn, m.index, m[0].length);
  }
  return null;
}

// ── helpers ──────────────────────────────────────────────────────────────────
const clip = (s: string, n: number) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Lines whose cut moves a top-tier quarter even when another line was raised. A margin-only trim does not. */
const MAIN = new Set(['REVENUE', 'REVENUE_GROWTH', 'EBITDA', 'PAT', 'EPS', 'ADJ_EPS', 'FCF', 'ORDER_INFLOW']);
const PROFIT_OR_SALES = new Set(['REVENUE', 'EBITDA', 'PAT', 'EPS', 'ADJ_EPS']);
const METRIC_WORD: Record<string, string> = {
  REVENUE: 'revenue', REVENUE_GROWTH: 'revenue growth', EBITDA: 'EBITDA', EBITDA_MARGIN: 'EBITDA margin', PAT: 'PAT', EPS: 'EPS',
  ADJ_EPS: 'adj. EPS', FCF: 'free cash flow', ORDER_INFLOW: 'order inflow', VOLUME: 'volume', OTHER: 'other',
};
const DOC_WORD: Record<string, string> = { transcript: 'concall transcript', presentation: 'investor presentation', results_release: 'results release', agm_speech: 'AGM speech', other_company_doc: 'company document' };
const docWord = (k?: string) => DOC_WORD[String(k || '').toLowerCase()] || (k ? String(k).replace(/_/g, ' ') : 'company document');

function fmtVal(v: number, unit: string | null | undefined, currency: string | null | undefined): string {
  const u = String(unit || '').toLowerCase();
  if (u === '%') return `${+v.toFixed(1)}%`;
  const cur = currency === 'INR' || !currency ? '₹' : `${currency} `;
  if (u === 'crore') return `${cur}${Math.round(v).toLocaleString('en-IN')} Cr`;
  if (u === 'per_share') return `${cur}${+v.toFixed(2)}`;
  return `${+v.toFixed(2)}${u ? ` ${u}` : ''}`;
}
function figText(r: InExtractRowLike): string {
  const name = `${r.period ? `${r.period} ` : ''}${METRIC_WORD[r.metric] || r.metricLabel || r.metric}`;
  const g = isNum(r.growthPctLow) || isNum(r.growthPctHigh)
    ? (isNum(r.growthPctLow) && isNum(r.growthPctHigh) && r.growthPctLow !== r.growthPctHigh ? `${r.growthPctLow}–${r.growthPctHigh}% growth` : `${(isNum(r.growthPctHigh) ? r.growthPctHigh : r.growthPctLow)}% growth`)
    : '';
  const lv = isNum(r.low) ? r.low : isNum(r.high) ? r.high : null;
  const hv = isNum(r.high) ? r.high : lv;
  const now = !g && lv != null ? (hv != null && hv !== lv ? `${fmtVal(lv, r.unit, r.currency)}–${fmtVal(hv, r.unit, r.currency)}` : fmtVal(lv, r.unit, r.currency)) : g;
  const pl = r.prior && (isNum(r.prior.low) || isNum(r.prior.high)) ? (isNum(r.prior.low) ? r.prior.low : r.prior.high) as number : null;
  const ph = r.prior && isNum(r.prior.high) ? r.prior.high : pl;
  const was = pl != null ? ` (was ${ph != null && ph !== pl ? `${fmtVal(pl, r.unit, r.currency)}–${fmtVal(ph, r.unit, r.currency)}` : fmtVal(pl, r.unit, r.currency)})` : '';
  return `${name}${now ? ` ${now}` : ''}${was}`;
}
/** A profit or revenue line guided below last year: a negative guided growth, or a guided figure under the stated prior-year actual. */
function guidedBelowLastYear(r: InExtractRowLike): boolean {
  if (!PROFIT_OR_SALES.has(r.metric)) return false;
  if (isNum(r.growthPctHigh) ? r.growthPctHigh < 0 : isNum(r.growthPctLow) && r.growthPctLow < 0) return true;
  const top = isNum(r.high) ? r.high : isNum(r.low) ? r.low : null;
  return top != null && !!r.priorActual && isNum(r.priorActual.value) && r.priorActual.value > 0 && top < r.priorActual.value * 0.99
    && String(r.unit || '') !== '%';
}

/** The documents of THIS results season: filed from three days before the results to 60 days after (the call and the deck follow the release). */
export function extractsForFiling<T extends InExtractDocLike>(docs: readonly T[] | null | undefined, filingDate: string | null | undefined): T[] {
  const f = String(filingDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !Array.isArray(docs)) return [];
  const t0 = Date.parse(`${f}T00:00:00Z`);
  return docs.filter((d) => {
    const a = Date.parse(`${String(d?.filedAt || '').slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(a) && a >= t0 - 3 * 86_400_000 && a <= t0 + 60 * 86_400_000 && Array.isArray(d.rows);
  }).sort((a, b) => String(b.filedAt || '').localeCompare(String(a.filedAt || '')));
}

type Fig = { row: InExtractRowLike; doc: InExtractDocLike };
/** One figure per metric + period: the newest document's. */
function latestFigures(docs: InExtractDocLike[]): Fig[] {
  const seen = new Set<string>(); const out: Fig[] = [];
  for (const d of docs) for (const r of (d.rows || [])) {
    if (!r || typeof r.metric !== 'string') continue;
    const k = `${r.metric}|${String(r.period || '').toUpperCase()}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push({ row: r, doc: d });
  }
  return out;
}

/** The card's own text the grader keeps (grade_input) plus any text field on the row itself. */
export function rowText(row: any): string {
  const gi = row?.grade_input && typeof row.grade_input === 'object' ? row.grade_input : {};
  const parts = ['guidance_text', 'narrative_text', 'announcement_text', 'headline', 'title']
    .flatMap((k) => [gi[k], row?.[k]]).filter((x) => typeof x === 'string' && x.trim());
  return Array.from(new Set(parts)).join(' \n ');
}

// ── the verdict ──────────────────────────────────────────────────────────────
/** The one-line guidance verdict for a graded India row. `stored` is what the server found for the row (may be empty). */
export function inGuideLine(row: any, stored?: InGuideStored | null): InGuideLine {
  const docs = extractsForFiling(stored?.extracts || [], row?._window_date || row?.filing_date);
  const figs = latestFigures(docs);
  const downs = figs.filter((f) => f.row.status === 'LOWERED' || f.row.status === 'WITHDRAWN');
  const ups = figs.filter((f) => f.row.status === 'RAISED');
  const keeps = figs.filter((f) => f.row.status === 'REITERATED');
  const below = figs.filter((f) => f.row.status !== 'LOWERED' && f.row.status !== 'WITHDRAWN' && guidedBelowLastYear(f.row));
  const docOf = (f: Fig | undefined) => (f ? { source: docWord(f.doc.docKind), url: f.doc.docUrl || null } : { source: '', url: null });
  const quoteOf = (fs: Fig[]) => fs.map((f) => (f.row.quote ? `“${clip(f.row.quote, 300)}”` : '')).filter(Boolean).join('\n');

  // 1. the extracted, quote-checked figures
  if (downs.length || below.length) {
    const cut = downs.length ? downs : below;
    const what = clip(cut.map((f) => figText(f.row)).join('; '), 130);
    const src = docOf(cut[0]);
    if (ups.length) {
      const mainCut = downs.some((f) => MAIN.has(f.row.metric)) || below.length > 0;
      return {
        direction: 'mixed', text: `Guidance mixed — raised ${clip(ups.map((f) => figText(f.row)).join('; '), 60)}; ${downs.length ? 'cut' : 'below last year:'} ${clip(what, 70)}`,
        title: `${quoteOf([...ups, ...cut])}\n\n${mainCut ? 'A main line (revenue, profit, EPS, order inflow) is cut or guided below last year, so a BLOCKBUSTER or STRONG quarter is shown as MIXED.' : 'Only a margin / volume line was cut — the tier is not changed for that.'}`,
        ...src, lowered: mainCut,
      };
    }
    if (downs.length) {
      const withdrawn = downs.every((f) => f.row.status === 'WITHDRAWN');
      return { direction: withdrawn ? 'withdrawn' : 'lowered', text: `Guidance ${withdrawn ? 'withdrawn' : 'lowered'} — ${what}`, title: quoteOf(downs), ...src, lowered: true };
    }
    return { direction: 'cautious', text: `Guidance cautious — ${what} (below last year)`, title: `${quoteOf(below)}\n\nA profit or revenue line is guided below last year, so a BLOCKBUSTER or STRONG quarter is shown as MIXED.`, ...src, lowered: true };
  }

  // 2. the stored AI read of the concall — a cut only with HIGH / MEDIUM confidence and a quote behind it
  const ai = stored?.ai && typeof stored.ai === 'object' ? stored.ai : null;
  const aiQuotes = Array.isArray(ai?.quotes) ? ai!.quotes.filter((q) => typeof q === 'string' && q.trim()) : [];
  const aiSrc = ai ? `AI read of the ${String(ai.source || 'concall').replace(/-/g, ' ')}` : '';
  const aiUrl = ai?.source_url || null;
  if (ai && ai.label === 'Negative' && (ai.confidence === 'HIGH' || ai.confidence === 'MEDIUM') && aiQuotes.length) {
    const joined = aiQuotes.join(' ');
    const lo = inLoweredInText(joined);
    const q = lo || inCautionInText(joined) || aiQuotes[0];
    const alsoUp = ups.length ? ` · raised ${clip(figText(ups[0].row), 50)}` : '';
    return {
      direction: ups.length ? 'mixed' : lo ? 'lowered' : 'cautious',
      text: `${ups.length ? 'Guidance mixed' : lo ? 'Guidance lowered' : 'Guidance cautious'} — ${clip(q, 130)}${alsoUp}`,
      title: `“${clip(q, 400)}”${ai.rationale ? `\n\n${clip(ai.rationale, 300)}` : ''}\n\nRead as Negative (${ai.confidence} confidence), so a BLOCKBUSTER or STRONG quarter is shown as MIXED.`,
      source: aiSrc, url: aiUrl, lowered: true,
    };
  }

  // 3. the card's own text
  const txt = rowText(row);
  const tLow = txt ? inLoweredInText(txt) : null;
  const tCau = !tLow && txt ? inCautionInText(txt) : null;
  if (tLow || tCau) {
    const q = (tLow || tCau)!;
    const dir: InGuideDirection = ups.length ? 'mixed' : tLow ? 'lowered' : 'cautious';
    return {
      direction: dir, text: `${dir === 'mixed' ? 'Guidance mixed' : tLow ? 'Guidance lowered' : 'Guidance cautious'} — ${clip(q, 140)}`,
      title: `“${clip(q, 400)}”${tCau ? '\n\nA profit line is guided below last year.' : ''}`, source: 'the filing text', url: row?.filing_url || null, lowered: true,
    };
  }

  // no cut anywhere — what was said
  if (ups.length) return { direction: 'raised', text: `Guidance raised — ${clip(ups.map((f) => figText(f.row)).join('; '), 140)}`, title: quoteOf(ups), ...docOf(ups[0]), lowered: false };
  const aiUp = ai && aiQuotes.length ? inRaisedInText(aiQuotes.join(' ')) : null;
  if (aiUp) return { direction: 'raised', text: `Guidance raised — ${clip(aiUp, 140)}`, title: `“${clip(aiUp, 400)}”`, source: aiSrc, url: aiUrl, lowered: false };
  const tUp = txt ? inRaisedInText(txt) : null;
  if (tUp) return { direction: 'raised', text: `Guidance raised — ${clip(tUp, 140)}`, title: `“${clip(tUp, 400)}”`, source: 'the filing text', url: row?.filing_url || null, lowered: false };
  if (keeps.length) return { direction: 'maintained', text: `Guidance kept — ${clip(keeps.map((f) => figText(f.row)).join('; '), 140)}`, title: quoteOf(keeps), ...docOf(keeps[0]), lowered: false };
  const keptQ = (ai && aiQuotes.length ? inKeptInText(aiQuotes.join(' ')) : null) || (txt ? inKeptInText(txt) : null);
  if (keptQ) return { direction: 'maintained', text: `Guidance kept — ${clip(keptQ, 140)}`, title: `“${clip(keptQ, 400)}”`, source: ai && aiQuotes.length && inKeptInText(aiQuotes.join(' ')) ? aiSrc : 'the filing text', url: null, lowered: false };
  if (figs.length) {
    return {
      direction: 'none', text: `Guidance given, no earlier figure to compare — ${clip(figs.slice(0, 2).map((f) => figText(f.row)).join('; '), 130)}`,
      title: `${quoteOf(figs.slice(0, 3))}\n\nThe company states an outlook, but no earlier figure for the same period is stated, so it is neither raised nor lowered.`, ...docOf(figs[0]), lowered: false,
    };
  }
  if (ai && ai.label === 'Positive' && aiQuotes.length) {
    return { direction: 'positive', text: `Outlook positive, no figure raised — ${clip(aiQuotes[0], 130)}`, title: `“${clip(aiQuotes[0], 400)}”${ai.rationale ? `\n\n${clip(ai.rationale, 300)}` : ''}`, source: aiSrc, url: aiUrl, lowered: false };
  }
  if (ai && ai.label === 'NoGuidance') return { direction: 'none', text: 'No forward guidance in the concall / deck', title: ai.rationale || '', source: aiSrc, url: aiUrl, lowered: false };
  const gs = String(row?.guidance_status || '');
  if (gs === 'cut') {
    // the concall feed's word list only (no sentence kept) — said, never a reason to move the tier
    return { direction: 'unknown', text: 'Possible guidance cut flagged by the concall feed — no sentence kept, check the call', title: 'The concall-intelligence word list matched cut / weak-demand language for this company. No quote is stored, so the tier is not changed for it.', source: 'concall feed', url: null, lowered: false };
  }
  if (gs === 'raised' || gs === 'positive outlook') {
    return { direction: 'positive', text: 'Positive outlook words in the filings (order book / capacity) — no guided figure', title: 'The concall-intelligence word list matched order-book / capacity / raise language. No guided figure was found.', source: 'concall feed', url: null, lowered: false };
  }
  if (docs.length) return { direction: 'none', text: 'No forward guidance in the documents read for this quarter', title: docs.map((d) => `${docWord(d.docKind)} · ${String(d.filedAt || '').slice(0, 10)}`).join('\n'), source: docWord(docs[0].docKind), url: docs[0].docUrl || null, lowered: false };
  return { direction: 'unknown', text: 'Guidance not checked yet — no concall or deck read for this quarter', title: 'No guidance document of this results season has been read yet. The call transcript usually follows the results by one to three weeks.', source: '', url: null, lowered: false };
}

const TOP = new Set(['BLOCKBUSTER', 'STRONG']);
/**
 * Put the one-line verdict on the row (`guide_line`). A BLOCKBUSTER or STRONG row whose guidance was lowered, cut on a main line,
 * or guided below last year becomes MIXED (`tier_before_guide_check` keeps the old tier, a caveat tag says why). Idempotent.
 * Returns true when the tier moved.
 */
export function applyInGuideLine(row: any, stored?: InGuideStored | null): boolean {
  if (!row || typeof row !== 'object') return false;
  const line = inGuideLine(row, stored);
  row.guide_line = line;
  if (row.tier_before_guide_check) return false;   // already moved by an earlier pass
  if (!line.lowered || !TOP.has(String(row.tier))) return false;
  const word = line.direction === 'mixed' ? IN_GUIDE_TAGS.mixed : line.direction === 'cautious' ? IN_GUIDE_TAGS.cautious : IN_GUIDE_TAGS.lowered;
  const tag = `${word} — ${clip(line.text.replace(/^Guidance \w+ — /, ''), 120)}`;
  row.caveat_tags = Array.from(new Set([...(Array.isArray(row.caveat_tags) ? row.caveat_tags : []), tag]));
  row.tier_before_guide_check = row.tier;
  row.tier = 'MIXED';
  return true;
}

/** A served day: every row gets its line, moved rows go to MIXED (top of it). `storedFor` returns what was found for a row. Pure. */
export function applyInGuideLines(payload: any, storedFor: (row: any) => InGuideStored | null): any {
  if (!payload?.by_tier || typeof payload.by_tier !== 'object') return payload;
  const tiers = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];
  const by_tier: Record<string, any[]> = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] };
  const moved: any[] = [];
  for (const t of tiers) {
    for (const r0 of (Array.isArray(payload.by_tier[t]) ? payload.by_tier[t] : [])) {
      const r = r0 && typeof r0 === 'object' ? { ...r0 } : r0;
      if (r && typeof r === 'object' && applyInGuideLine(r, storedFor(r))) moved.push(r);
      else by_tier[t].push(r);
    }
  }
  by_tier.MIXED.unshift(...moved);
  for (const t of Object.keys(payload.by_tier)) if (!(t in by_tier)) by_tier[t] = payload.by_tier[t];
  const notes = moved.length ? [...(Array.isArray(payload.notes) ? payload.notes : []), `${moved.length} top-tier row${moved.length > 1 ? 's' : ''} moved to MIXED: guidance lowered, or a profit line guided below last year (company documents, concall or filing text)`] : payload.notes;
  return { ...payload, by_tier, ...(notes ? { notes } : {}), in_overlay_v: IN_OVERLAY_VERSION };
}

export const IN_GUIDE_GLYPH: Record<InGuideDirection, string> = {
  raised: '📈', lowered: '📉', mixed: '↕', cautious: '⚠', maintained: '➖', withdrawn: '⛔', none: '◌', 'not-lowered': '✓', unknown: '…', positive: '↗',
};
