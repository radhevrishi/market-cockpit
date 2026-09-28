// ═══════════════════════════════════════════════════════════════════════════
// QUICK READ (NO AI) — FILL THE EVIDENCE LEDGER WITHOUT A MODEL.     (zzz816)
//
// THE GAP. 21 of 70 Conviction Beats bench names on India Portfolio Catalysts
// showed "EVIDENCE: no persisted evidence · NOT SEARCHED" with every mechanism
// row "○ NOT SEARCHED". The only way to fill a ledger was the AI read, which
// runs on a click (it costs money), so a name nobody clicked stayed empty for
// ever — although its concall transcript and investor presentation sat on
// screener.in / BSE the whole time, and this repo already had deterministic
// readers for most of what the card asks: utilisation current vs target
// (utilisationTense), product-tagged capacity (productOfCapacity), a derived
// installed capacity (deriveCurrentCapacity), planned vs spent capex
// (capexAmountKind, incurredShare), the capex figure guard (capexFigureOk)
// and management's words on price / margin / volume / guidance
// (transcriptCommentary).
//
// THIS MODULE IS THE PURE HALF of the quick read:
//   · quickExtract   documents' text in → typed StructuralEvents out, each
//                    carrying the verbatim sentence it came from and passing
//                    the SAME validator the AI path uses (validateEvents);
//   · quickSummary   the period summary the card renders, marked
//                    read_kind 'deterministic' so the card can say "read
//                    without AI" and a later AI read can supersede it;
//   · quickReadQueue which names to read on page load, book first, then the
//                    bench passing his Conviction Beats criteria, then the
//                    rest;
//   · supersedeQuickRead  an AI read of the same period replaces the
//                    deterministic facts (archived, never deleted).
//
// RULES. No figure is invented: every number in a value appears in its
// evidence sentence (a derived installed capacity says it is derived and
// names the two figures it came from). A sentence the reader cannot type
// (current or target? planned or spent?) is left out rather than guessed —
// unknown stays unknown. No price is read. No ticker is named.
// ═══════════════════════════════════════════════════════════════════════════

import type { VarKey } from './taxonomy';
import { validateEvents, judgeEventQuality, type StructuralEvent, type Passage } from './evidence-extract';
import {
  transcriptCommentary, utilisationTense, productOfCapacity, deriveCurrentCapacity,
  capexAmountKind, incurredShare,
} from './transcript-evidence';
import { capexFigureOk } from './figure-guards';
import { periodOrdinal, latestExpectedPeriod, type CompanyLedger, type PeriodRecord, type EvidenceFact, type EvidenceEvent } from './evidence-ledger';

export const QUICK_READ_VERSION = 'quick-read-v1';
export const QUICK_READ_MODEL = 'deterministic (no AI)';
export const QUICK_READ_LABEL = 'read without AI (deterministic)';
export const QUICK_READ_MODE = 'quick';
/** A failed or empty quick read is not retried from a page load for this long. */
export const QUICK_RETRY_AFTER_MS = 6 * 3600_000;

// ── 1. IS THIS A QUICK READ? ───────────────────────────────────────────────

export function isQuickReadSummary(s: any): boolean {
  return !!s && typeof s === 'object' && s.read_kind === 'deterministic';
}
export function isQuickReadPeriod(p: Pick<PeriodRecord, 'summary' | 'prompt_version'> | null | undefined): boolean {
  return !!p && (isQuickReadSummary(p.summary) || p.prompt_version === QUICK_READ_VERSION);
}
/** The latest period on file was read without AI (so an AI read may supersede it). */
export function latestIsQuickRead(ledger: CompanyLedger | null | undefined): boolean {
  const p = ledger?.latest_period ? ledger.periods[ledger.latest_period] : null;
  return isQuickReadPeriod(p);
}

// ── 2. TEXT → PIECES ───────────────────────────────────────────────────────

export interface QuickDoc { label: string; kind: string; text: string }

/** Sentences from the flattened text; for slides and results pages also the
 *  individual lines ("Capacity utilisation 78%" is a line, not a sentence). */
export function quickPieces(doc: QuickDoc): string[] {
  const raw = String(doc.text || '').replace(/\r/g, '');
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (x: string) => {
    const s = x.replace(/\s+/g, ' ').trim();
    if (s.length < 25 || s.length > 700 || seen.has(s)) return;
    seen.add(s); out.push(s);
  };
  const flat = raw.replace(/\s+/g, ' ').trim();
  // "Rs. 23.4 crores", "No. 3", "Mr. Shah" do not end a sentence.
  for (const s of flat.split(/(?<!\b(?:Rs|RS|No|Nos|Mr|Mrs|Ms|Dr|vs|approx|Co|Ltd|Inc|Sr|Jr|St)\.)(?<=[.!?])\s+(?=[A-Z"“0-9₹(])/)) push(s);
  if (!/transcript|concall|con-?call|conference call|earnings call/i.test(`${doc.kind} ${doc.label}`)) {
    for (const line of raw.split(/\n+/)) push(line);
  }
  return out;
}

// ── 3. PATTERNS ────────────────────────────────────────────────────────────

const CUR = String.raw`(?:₹|\bINR|\bRs\.?|\bUSD|\bUS\$|\$)`;
const N = String.raw`\d[\d,]*(?:\.\d+)?`;
const MAG = String.raw`(?:crores?|crs?\b|cr\b|lakhs?|lacs?|mn\b|million|bn\b|billion)`;
const MONEY_RE = new RegExp(`(?:${CUR}\\s?${N}(?:\\s*(?:-|–|to)\\s*${CUR}?\\s?${N})?\\s*${MAG})|(?:\\b${N}(?:\\s*(?:-|–|to)\\s*${N})?\\s*(?:crores?|cr\\b|lakhs?))`, 'gi');
const PCT_RE = /\d{1,3}(?:\.\d+)?\s*%?\s*(?:-|–|to)\s*\d{1,3}(?:\.\d+)?\s*%|\d{1,3}(?:\.\d+)?\s*%/g;
const CAP_UNIT = String.raw`(?:MTPA|KTPA|TPA|MTPD|TPD|MMSCMD|KLPD|KLD|KL|MWp|MWh|MW|GWh|GW|lakh\s+(?:units|tonnes|MT|pieces)|million\s+(?:units|tablets|pieces|litres|tonnes|sq\.?\s*ft)|mn\s+(?:units|tablets|pieces)|metric\s+tonnes?|tonnes?|tons?|MT|spindles|looms|beds|units\s+per\s+(?:annum|month|day))`;
const CAP_FIG_RE = new RegExp(`(?<![₹$\\d.,])(${N})\\s*(${CAP_UNIT})\\b`, 'gi');
const FORWARD = /\b(will|would|shall|plan(?:s|ned|ning)?|propos\w*|expect\w*|to be (?:commissioned|completed|added|set up|built|incurred|spent|invested)|upcoming|under construction|being (?:set up|added|built|installed)|expanding|target\w*|aim\w*|envisag\w*|going forward|by (?:FY|Q[1-4]|20\d\d|the end)|next (?:year|fiscal|quarter)|over the (?:next|coming))\b/i;
const DONE = /\b(commissioned|completed|has been (?:added|commissioned|completed|expanded|increased)|have been (?:added|commissioned|completed)|was (?:added|commissioned|completed)|successfully|now stands?|stood at|became operational|operationali[sz]ed)\b/i;

interface Hit { text: string; index: number }
const all = (re: RegExp, s: string): Hit[] => {
  const out: Hit[] = [];
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of s.matchAll(r)) out.push({ text: m[0].replace(/\s+/g, ' ').trim(), index: m.index ?? 0 });
  return out;
};
/** The figure nearest to the keyword: after it within `after` chars first,
 *  else before it within `before` chars. */
function nearest(figs: Hit[], kwAt: number, kwLen: number, after = 110, before = 50): Hit | null {
  const ahead = figs.filter((f) => f.index >= kwAt + kwLen && f.index - (kwAt + kwLen) <= after).sort((a, b) => a.index - b.index);
  if (ahead.length) return ahead[0];
  const behind = figs.filter((f) => f.index + f.text.length <= kwAt && kwAt - (f.index + f.text.length) <= before).sort((a, b) => b.index - a.index);
  return behind[0] || null;
}
/** Words between the keyword and the figure (what the figure is OF). */
const between = (s: string, a: number, b: number) => s.slice(Math.min(a, b), Math.max(a, b));

const raw = (variable: VarKey, value_type: StructuralEvent['value_type'], after: string, s: string, source: string, extra: Partial<StructuralEvent> = {}): StructuralEvent => ({
  variable, value_type, before: null, after, unit: null, period: null, direction: 'unknown',
  evidence_text: s.slice(0, 600), source, confidence: 'MEDIUM', evidence_quality: 'sentence', ...extra,
});

// ── 4. THE EXTRACTORS ─────────────────────────────────────────────────────

const UT_WORD = /utili[sz]ation|utili[sz]ed|capacity use|capacity is (?:fully )?exhausted|exhausted up to|occupancy|\bCUF\b|\bPLF\b|operating at|running at/i;
const NOT_UT_BETWEEN = /\b(margin|growth|grew|revenue|sales|ebitda|profit|share|contribution|yoy|y-o-y|increase in|decline|market|return|roce|roe|interest|tax|dividend|stake)\b/i;
const IS_TRANSCRIPT = (d: QuickDoc) => /transcript|concall|con-?call|conference call|earnings call|business update/i.test(`${d.kind} ${d.label}`);

function utilisationEvents(s: string, doc: QuickDoc): StructuralEvent[] {
  const kw = UT_WORD.exec(s);
  if (!kw) return [];
  const pcts = all(PCT_RE, s);
  const fromTo = /from\s+(\d{1,3}(?:\.\d+)?\s*%)\s+to\s+(\d{1,3}(?:\.\d+)?\s*%)/i.exec(s);
  const f = nearest(pcts, kw.index, kw[0].length, 80, 60);
  if (!f) return [];
  // "asset turn of 1.2x at 90% utilization" — a premise, not a reading.
  if (/\b(?:at|assuming|on)\s+(?:a\s+|an\s+)?(?:about\s+|around\s+)?\d{1,3}(?:\.\d+)?\s*%\s*(?:capacity\s+)?utili[sz]ation/i.test(s)) return [];
  if (NOT_UT_BETWEEN.test(between(s, kw.index + kw[0].length, f.index)) && !/utili|capacity/i.test(between(s, kw.index + kw[0].length, f.index))) return [];
  let tense = utilisationTense(s);
  if (!tense && /\b(?:we are|we're|are|is|was|were)\s+(?:at|running|operating)\b|\bin Q[1-4]\b|\bQ[1-4]\s?FY\s?'?\d{2}\b|\bduring the (?:quarter|year)\b/i.test(s)) tense = 'CURRENT';
  // A slide or a results page prints the current level without tense words.
  if (!tense && !IS_TRANSCRIPT(doc) && !FORWARD.test(s)) tense = 'CURRENT';
  if (!tense) return [];                       // cannot tell current from target → left out
  const ev = raw('utilisation', tense === 'CURRENT' ? 'ACTUAL' : 'TARGET', f.text, s, doc.label);
  if (fromTo && tense === 'CURRENT') { ev.before = fromTo[1]; ev.after = fromTo[2]; }
  return [ev];
}

const CAP_WORD = /capacit(?:y|ies)/i;
const ADD_WORD = /\b(add(?:ed|ing|ition(?:al)?)?|expan\w*|increas\w*|enhanc\w*|incremental|new|augment\w*|debottleneck\w*)\b/i;
function capacityEvents(s: string, doc: QuickDoc): StructuralEvent[] {
  if (!CAP_WORD.test(s)) return [];
  const out: StructuralEvent[] = [];
  const forward = FORWARD.test(s);
  const done = DONE.test(s);
  const d = deriveCurrentCapacity(s);
  if (d) {
    const product = d.product;
    out.push(raw('capacity', 'ACTUAL', d.current, s, doc.label, { product, derived: d.basis, unit: d.unit }));
    out.push(raw('capacity_addition', done && !forward ? 'ACTUAL' : 'GUIDANCE', d.addition, s, doc.label, { product, unit: d.unit, direction: 'up' }));
    out.push(raw('capacity', 'TARGET', d.total, s, doc.label, { product, unit: d.unit }));
    return out;
  }
  const kws = all(/capacit(?:y|ies)/i, s);
  const figs = all(CAP_FIG_RE, s);
  const used = new Set<number>();
  for (const k of kws) {
    const f = nearest(figs, k.index, k.text.length, 70, 40);
    if (!f || used.has(f.index)) continue;
    used.add(f.index);
    // Money is never capacity; a production volume is not capacity either.
    if (/crore|lakh\s+crore|₹|rs\.?|inr/i.test(s.slice(Math.max(0, f.index - 6), f.index))) continue;
    if (/\b(produc(?:ed|tion of)|sold|despatch\w*|dispatch\w*|sales volume)\b/i.test(between(s, k.index, f.index))) continue;
    const near = s.slice(Math.max(0, Math.min(k.index, f.index) - 45), Math.max(k.index, f.index) + 10);
    const isAdd = ADD_WORD.test(near) && !/\btotal\b|\binstalled\b|\bexisting\b/i.test(between(s, k.index, f.index));
    const product = productOfCapacity(s, f.text);
    if (isAdd) out.push(raw('capacity_addition', done && !forward ? 'ACTUAL' : forward ? 'GUIDANCE' : 'ACTUAL', f.text, s, doc.label, { product, direction: 'up' }));
    else out.push(raw('capacity', forward && !done ? 'TARGET' : 'ACTUAL', f.text, s, doc.label, { product }));
    if (out.length >= 3) break;
  }
  return out;
}

const CAPEX_WORD = /\bcapex\b|capital expenditure|capital outlay|\boutlay\b|\binvestments?\b|\binvest(?:ing|ed)?\b/i;
const NOT_CAPEX = /\b(subsidiar\w*|mutual funds?|treasury|equity stake|stake in|acquisition|acquir\w*|joint venture|investee|investors?|investment income|fair value)\b/i;
function capexEvents(s: string, doc: QuickDoc): StructuralEvent[] {
  const kw = CAPEX_WORD.exec(s);
  if (!kw || NOT_CAPEX.test(s)) return [];
  const out: StructuralEvent[] = [];
  const f = nearest(all(MONEY_RE, s), kw.index, kw[0].length, 100, 60);
  if (f && capexFigureOk(f.text, s) && !/\b(revenue|sales|turnover|profit|ebitda|order|dividend|market cap|valuation|borrowing|debt)\b/i.test(between(s, kw.index + kw[0].length, f.index))) {
    const kind = capexAmountKind(s);
    const vt: StructuralEvent['value_type'] | null = kind === 'SPENT' ? 'ACTUAL' : kind === 'PLANNED' ? 'GUIDANCE'
      : /\b(was|were|during the (?:quarter|year|period)|(?:in|for) (?:Q[1-4]|the quarter|FY\s?'?\d{2}))\b/i.test(s) && !FORWARD.test(s) ? 'ACTUAL' : null;
    if (vt) out.push(raw('capex', vt, f.text, s, doc.label));
  }
  const share = incurredShare(s);
  if (share) out.push(raw('capex_status', 'ACTUAL', share.quote, s, doc.label));
  return out;
}

const OB_WORD = /order\s*book|order\s*backlog|unexecuted orders?|orders?\s+in\s+hand|outstanding orders?/i;
const OI_WORD = /order\s*(?:inflows?|intake)|orders?\s+(?:received|won|bagged|secured)|order wins?/i;
function orderEvents(s: string, doc: QuickDoc): StructuralEvent[] {
  const out: StructuralEvent[] = [];
  const money = all(MONEY_RE, s);
  for (const [re, variable] of [[OB_WORD, 'order_book'], [OI_WORD, 'order_intake']] as Array<[RegExp, VarKey]>) {
    const kw = re.exec(s);
    if (!kw) continue;
    const f = nearest(money, kw.index, kw[0].length, 90, 40);
    if (!f) continue;
    if (/\b(revenue|sales|turnover|profit|ebitda|capex|investment)\b/i.test(between(s, kw.index + kw[0].length, f.index))) continue;
    const vt: StructuralEvent['value_type'] = /\btarget\w*|\baim\w*|\bexpect\w*|\bwill\b|\bguid\w*/i.test(s) ? 'TARGET' : 'ACTUAL';
    out.push(raw(variable, vt, f.text, s, doc.label));
  }
  return out;
}

const COMM_DONE = /\b(?:has been|have been|was|were|successfully|got)\s+commissioned\b|\bcommenced commercial (?:production|operations)\b|\bcommercial (?:production|operations) (?:has |have )?(?:commenced|started|began)\b/i;
const COMM_FWD = /\b(?:expected to be|will be|to be|scheduled to be|likely to be)\s+commissioned\b|\bcommissioning (?:is )?(?:expected|scheduled|planned)\b|\bcommercial production (?:is )?expected\b/i;
const WHEN_RE = /\b((?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*,?\s+20\d{2}|Q[1-4]\s?FY\s?'?\d{2}|H[12]\s?FY\s?'?\d{2}|FY\s?'?\d{2,4})\b/i;
function commissioningEvents(s: string, doc: QuickDoc): StructuralEvent[] {
  const done = COMM_DONE.test(s), fwd = COMM_FWD.test(s);
  if (!done && !fwd) return [];
  const w = WHEN_RE.exec(s);
  if (!w) return [];
  return [raw('commissioning', fwd ? 'GUIDANCE' : 'ACTUAL', w[1].replace(/\s+/g, ' '), s, doc.label)];
}

// ── 5. FINANCIAL COMPANIES: THE BOOK, THE SPREAD, ASSET QUALITY ───────────
//
// A lender has no plant: capacity and utilisation do not apply, and the AI
// structural stage (whose variable list is plant-and-orders) returned 0 facts
// for one. What a lender's documents DO say — the loan book / AUM and its
// growth, disbursements, the net interest margin, asset quality — is read
// here. The book is filed as VOLUME (it is the business's volume) and the NIM
// as the MARGIN DRIVER; asset quality has no variable of its own and is kept
// as a verbatim line on the summary for the card.

const BOOK_WORD = /\b(AUM|assets under management|loan book|loan portfolio|gross advances|net advances|advances|disbursements?|average daily (?:premium )?turnover|ADTV|ADTO|transaction volumes?|transaction charges|number of (?:transactions|contracts)|premium turnover|demat accounts|active clients)\b/i;
const NIM_WORD = /\b(NIM|net interest margins?)\b/i;
const AQ_WORD = /\b(GNPA|NNPA|gross NPA|net NPA|gross non[- ]performing|net non[- ]performing|gross stage[- ]?(?:3|III)|net stage[- ]?(?:3|III)|credit costs?|collection efficiency|return on (?:assets|equity)|RoA|RoE)\b/i;
const LENDER_VOCAB = /\b(loan book|loan portfolio|aum|assets under management|disbursements?|net interest margin|\bnim\b|gnpa|nnpa|gross npa|net npa|stage[- ]?3|credit cost|collection efficiency|borrowers?|lending|nbfc|housing finance|microfinance|advances|deposits|casa)\b/gi;
const MARKET_VOCAB = /\b(average daily turnover|adtv|transaction charges|clearing|equity derivatives|options premium|listing fees?|exchange|depository|demat accounts|brokerage|mutual fund distribution|star mf)\b/gi;

/** The verbatim clause from the keyword to the end of the last figure after
 *  it (≤ 150 chars). Every figure in it is in the sentence by construction. */
function clauseFrom(s: string, at: number, figs: Hit[], max = 150): string | null {
  const after = figs.filter((f) => f.index >= at && f.index - at <= max);
  if (!after.length) return null;
  const last = after[after.length - 1];
  const c = s.slice(at, last.index + last.text.length).replace(/\s+/g, ' ').trim();
  return c.length >= 6 ? c : null;
}

function financialEvents(s: string, doc: QuickDoc, lines: string[]): StructuralEvent[] {
  const out: StructuralEvent[] = [];
  const figs = [...all(MONEY_RE, s), ...all(PCT_RE, s)].sort((a, b) => a.index - b.index);
  const b = BOOK_WORD.exec(s);
  if (b) {
    // The book's GROWTH is the volume line ("AUM grew 28% YoY"); a level in
    // rupees is money, never a volume, and is kept as a verbatim line.
    const growth = /\b(grew|growth|up|increase\w*|rose|higher|declin\w*|down|fell|lower|decrease\w*|yoy|y-o-y)\b/i;
    // Only the FIRST percentage after the keyword: a table row of five
    // percentages is not one growth figure.
    const firstPct = all(PCT_RE, s).find((f) => f.index >= b.index && f.index - b.index <= 170);
    let pc: string | null = null;
    if (firstPct) {
      const end = firstPct.index + firstPct.text.length;
      const whole = s.slice(b.index, end).replace(/\s+/g, ' ').trim();
      if (whole.length <= 90) pc = whole;
      else {
        // Keyword … the words right before the figure — both verbatim.
        const tail = s.slice(Math.max(b.index + b[0].length, firstPct.index - 40), end).replace(/^\S*\s/, '').replace(/\s+/g, ' ').trim();
        pc = `${b[0]} … ${tail}`;
      }
    }
    if (pc && growth.test(pc)) {
      out.push(raw('volume', FORWARD.test(s) ? 'GUIDANCE' : 'ACTUAL', pc, s, doc.label, { direction: /\b(declin\w*|down|fell|lower|decrease\w*)\b/i.test(pc) ? 'down' : 'up' }));
    }
    const c = clauseFrom(s, b.index, figs, 120);
    const tableLike = (x: string) => (x.match(/\d[\d,.]*%?/g) || []).length > (x.match(/[A-Za-z]{3,}/g) || []).length / 2;
    if (c && !tableLike(c) && lines.length < 8 && !lines.some((x) => x.slice(0, 30) === c.slice(0, 30))) lines.push(`${c} (${doc.label})`);
  }
  const n = NIM_WORD.exec(s);
  if (n) {
    const c = clauseFrom(s, n.index, all(PCT_RE, s), 70);
    if (c) out.push(raw('margin_driver', FORWARD.test(s) ? 'GUIDANCE' : 'ACTUAL', c, s, doc.label));
  }
  const a = AQ_WORD.exec(s);
  if (a) {
    const c = clauseFrom(s, a.index, all(PCT_RE, s), 70);
    if (c && (c.match(/\d[\d,.]*%?/g) || []).length <= 3 && lines.length < 8 && !lines.some((x) => x.slice(0, 30) === c.slice(0, 30))) lines.push(`${c} (${doc.label})`);
  }
  return out;
}

/** Distinct lender / market-infrastructure words across the documents read. */
export function financialVocabulary(texts: string[]): { lender: string[]; market: string[] } {
  const lender = new Set<string>(), market = new Set<string>();
  for (const t of texts) {
    for (const m of String(t || '').matchAll(LENDER_VOCAB)) lender.add(m[0].toLowerCase().replace(/s$/, ''));
    for (const m of String(t || '').matchAll(MARKET_VOCAB)) market.add(m[0].toLowerCase().replace(/s$/, ''));
  }
  return { lender: Array.from(lender).sort(), market: Array.from(market).sort() };
}

// ── 6. ALL OF IT, VALIDATED ───────────────────────────────────────────────

export interface QuickPipeline {
  documents: number;
  pieces: number;
  events_raw: number;
  events_kept: number;
  dropped: Array<{ variable: string; reason: string; evidence_text: string }>;
  by_variable: Record<string, number>;
}

export interface QuickExtraction {
  events: StructuralEvent[];
  financialLines: string[];
  vocabulary: { lender: string[]; market: string[] };
  pipeline: QuickPipeline;
}

const PER_VAR_CAP = 6;

/**
 * Pure: every deterministic event the documents support. Each candidate is
 * checked by the AI path's own validator (its sentence is in the text, every
 * figure in its value is in the sentence, the value fits the variable); a
 * wrong-unit reading is dropped here rather than kept as a weak fact. A
 * derived installed capacity is checked against its two source figures.
 */
export function quickExtract(docs: QuickDoc[]): QuickExtraction {
  const cands: StructuralEvent[] = [];
  const spoken: StructuralEvent[] = [];
  const financialLines: string[] = [];
  const passages: Passage[] = [];
  for (const d of docs) {
    const ps = quickPieces(d);
    for (const s of ps) {
      passages.push({ family: 'capacity', text: s, doc: d.label });
      // A question is not a disclosure: "is it INR2,000 crores?" is the
      // analyst's figure. (transcriptCommentary keeps a question only when
      // management's next turn confirms it.)
      if (IS_TRANSCRIPT(d) && /\?/.test(s)) continue;
      cands.push(...utilisationEvents(s, d), ...capacityEvents(s, d), ...capexEvents(s, d),
        ...orderEvents(s, d), ...commissioningEvents(s, d), ...financialEvents(s, d, financialLines));
    }
    if (IS_TRANSCRIPT(d)) {
      try { spoken.push(...transcriptCommentary(d.text, d.label)); } catch { /* additive; never fails the read */ }
    }
  }
  const kept: StructuralEvent[] = [];
  const dropped: QuickPipeline['dropped'] = [];
  const seen = new Set<string>();
  const perVar: Record<string, number> = {};
  const accept = (e: StructuralEvent) => {
    const k = `${e.variable}|${e.value_type}|${String(e.after ?? '').toLowerCase()}|${(e as any).product || ''}`;
    if (seen.has(k)) return;
    if ((perVar[e.variable] || 0) >= PER_VAR_CAP) return;
    seen.add(k);
    perVar[e.variable] = (perVar[e.variable] || 0) + 1;
    kept.push(e);
  };
  for (const e of cands) {
    if (e.derived) {
      // Derived: both source figures must be in the one sentence (they are,
      // by deriveCurrentCapacity's construction); the event is labelled.
      if (judgeEventQuality(e) === 'unit_mismatch') { dropped.push({ variable: e.variable, reason: 'value does not fit the variable', evidence_text: e.evidence_text.slice(0, 160) }); continue; }
      accept(e);
      continue;
    }
    const v = validateEvents([e], passages);
    const k = v.kept[0];
    if (!k) { dropped.push(...v.dropped); continue; }
    // A run of figures from a slide table is not a sentence anyone can check
    // by eye; the quick read keeps sentence-quality facts only.
    if (k.evidence_quality === 'chart') { dropped.push({ variable: k.variable, reason: 'chart / table figures, not a sentence', evidence_text: k.evidence_text.slice(0, 160) }); continue; }
    if (k.evidence_quality === 'unit_mismatch') { dropped.push({ variable: k.variable, reason: 'value does not fit the variable', evidence_text: k.evidence_text.slice(0, 160) }); continue; }
    accept({ ...k, confidence: k.confidence === 'HIGH' ? 'MEDIUM' : k.confidence, ...(e.product ? { product: e.product } : {}) });
  }
  for (const e of spoken) accept(e);
  const by: Record<string, number> = {};
  for (const e of kept) by[e.variable] = (by[e.variable] || 0) + 1;
  return {
    events: kept, financialLines,
    vocabulary: financialVocabulary(docs.map((d) => d.text)),
    pipeline: { documents: docs.length, pieces: passages.length, events_raw: cands.length + spoken.length, events_kept: kept.length, dropped: dropped.slice(0, 40), by_variable: by },
  };
}

// ── 7. THE SUMMARY THE CARD RENDERS ───────────────────────────────────────

export function quickSummary(x: QuickExtraction, docs: Array<{ label: string; kind: string }>): any {
  const words = [...x.vocabulary.lender, ...x.vocabulary.market];
  return {
    read_kind: 'deterministic',
    read_label: QUICK_READ_LABEL,
    read_version: QUICK_READ_VERSION,
    events: x.events,
    // Nothing is summarised in words: no verdict, no positives — those are a
    // reader's judgement and this read makes none.
    verdict_line: '',
    positives: [], negatives: [], segments: [], watch_next: [], not_disclosed: [],
    financial_lines: x.financialLines,
    business_words: words.join(' · '),
    documents_note: `Read ${docs.length} document${docs.length === 1 ? '' : 's'} without AI: ${docs.map((d) => d.label).join('; ')}.`,
  };
}

// ── 8. AN AI READ SUPERSEDES A QUICK READ ─────────────────────────────────

/**
 * Pure: before an AI read of `period` is merged, the deterministic facts and
 * events of that period move to its superseded lists (history, never
 * deleted) and the period's summary is cleared for the AI's. A period the AI
 * already read is returned unchanged.
 */
export function supersedeQuickRead(ledger: CompanyLedger, period: string, now: string, byRun: string): CompanyLedger {
  const p = ledger.periods[period];
  if (!p || !isQuickReadPeriod(p)) return ledger;
  const sf: EvidenceFact[] = (p.facts || []).map((f) => ({ ...f, record_status: 'SUPERSEDED', superseded_by: byRun, superseded_at: now } as EvidenceFact));
  const se: EvidenceEvent[] = (p.events || []).map((e) => ({ ...e, record_status: 'SUPERSEDED', superseded_by: byRun, superseded_at: now } as EvidenceEvent));
  const next: PeriodRecord = {
    ...p, facts: [], events: [],
    superseded_facts: [...(p.superseded_facts || []), ...sf].slice(-200),
    superseded_events: [...(p.superseded_events || []), ...se].slice(-200),
    summary: null,
  };
  return { ...ledger, periods: { ...ledger.periods, [period]: next } };
}

// ── 9. WHO GETS A QUICK READ ON PAGE LOAD, AND IN WHAT ORDER ─────────────

export interface QuickRowLike {
  symbol: string;
  origin?: string | null;
  market?: string | null;
  preset?: { state?: string | null } | null;
  ledger?: CompanyLedger | null;
}

/** The last quick attempt on this ledger, if any. */
export function lastQuickRun(ledger: CompanyLedger | null | undefined): { at: string; outcome: string } | null {
  const runs = (ledger?.runs || []).filter((r) => r.mode === QUICK_READ_MODE);
  const r = runs[runs.length - 1];
  return r ? { at: r.finished_at, outcome: r.outcome } : null;
}

/**
 * Pure: does this name need a quick read? India only; no persisted evidence
 * for the latest expected period (none at all, or only an older quarter);
 * and not quick-read in the last few hours (a failure is retried later, not
 * on every page load).
 */
export function needsQuickRead(r: QuickRowLike, now: Date | string = new Date(), expected = latestExpectedPeriod(now).period): boolean {
  if (r.market === 'US') return false;
  const l = r.ledger || null;
  const nowMs = typeof now === 'string' ? Date.parse(now) : now.getTime();
  const q = lastQuickRun(l);
  if (q && nowMs - Date.parse(q.at) < QUICK_RETRY_AFTER_MS) return false;
  if (!l?.latest_period) return true;
  return periodOrdinal(l.latest_period) < periodOrdinal(expected);
}

/** Which tier a name reads in: 0 your book, 1 bench passing your Conviction
 *  Beats criteria, 2 the rest of the bench. */
export function quickTier(r: QuickRowLike): 0 | 1 | 2 {
  if (r.origin === 'book' || r.origin === 'both') return 0;
  return r.preset?.state === 'pass' ? 1 : 2;
}

/** Pure: the page-load queue — book first, then the bench passing the
 *  criteria, then the rest; names with no evidence at all before names with
 *  only an older quarter; alphabetical within that. */
export function quickReadQueue<R extends QuickRowLike>(rows: R[], now: Date | string = new Date()): R[] {
  const expected = latestExpectedPeriod(now).period;
  return rows.filter((r) => needsQuickRead(r, now, expected))
    .sort((a, b) => quickTier(a) - quickTier(b)
      || Number(!!a.ledger?.latest_period) - Number(!!b.ledger?.latest_period)
      || a.symbol.localeCompare(b.symbol));
}

/** The progress line the page prints. */
export function quickProgressLine(p: { running: boolean; done: number; total: number; filled: number; failed: number; nothing: number }): string {
  if (!p.total) return '';
  if (p.running) return `Quick-reading ${Math.min(p.done + 1, p.total)} of ${p.total} (no AI)…`;
  const bits = [`${p.filled} filled`, p.nothing ? `${p.nothing} with no readable document` : '', p.failed ? `${p.failed} could not be read` : ''].filter(Boolean);
  return `Quick read (no AI) finished: ${p.done} of ${p.total} — ${bits.join(' · ')}.`;
}
