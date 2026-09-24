// ═══════════════════════════════════════════════════════════════════════════
// FACT NORMALISATION — what a reading IS before anything is ranked.  (zzz765)
//
// The model labels every reading ACTUAL / GUIDANCE / TARGET / CLAIM, and the
// label is wrong often enough to decide the card. Read against the live
// ledgers on 22 Sep 2026:
//
//   E2E       "another 1,024 B200 we are EXPECTING SOON"          → ACTUAL
//   INNOVACAP "optimum revenue that we ANTICIPATE at a utilisation
//              of 65% to 70%"                                     → ACTUAL
//   ETHOSLTD  "INR593 crores as on 31st March 2025"               → a Q1 FY27 fact
//   GPPL      "to last year, financial year at 1.6 million MT"    → a Q1 FY27 fact
//
// Each of these then outranked the real reading of the quarter. This module
// re-reads the sentence around the value and corrects the TYPE, never the
// value: a forward clause makes it GUIDANCE, a figure dated before the
// reporting period makes it HISTORICAL CONTEXT, an explicit "unchanged at"
// makes it a stated FLAT. Nothing here invents a number.
//
// PURE. Events in, events out; used by the board (variables.ts) and by the
// period-to-period join (comparison.ts) so both pick from the same readings.
// ═══════════════════════════════════════════════════════════════════════════

import type { StructuralEvent, ValueType } from './evidence-extract';
import type { VarKey } from './taxonomy';

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0));
const yy = (s: string) => { const n = Number(s); return n < 100 ? 2000 + n : n; };
const MON_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Q1 FY27" → 30 Jun 2026; "FY26" → 31 Mar 2026. Null when unparseable. */
export function periodEnd(period: string | null | undefined): Date | null {
  const s = String(period || '');
  let m = /Q\s?([1-4])\s*FY\s?'?(\d{2,4})/i.exec(s);
  if (m) {
    const fy = yy(m[2]);                 // FY27 ends Mar 2027
    const q = Number(m[1]);              // Q1 = Apr–Jun of fy-1
    const endMonth = [5, 8, 11, 2][q - 1];
    return monthEnd(q === 4 ? fy : fy - 1, endMonth);
  }
  m = /\bFY\s?'?(\d{2,4})\b/i.exec(s);
  if (m) return monthEnd(yy(m[1]), 2);
  return null;
}

/** First day of the reporting period (quarter start, or FY start). */
export function periodStart(period: string | null | undefined): Date | null {
  const e = periodEnd(period);
  if (!e) return null;
  const quarter = /Q\s?[1-4]/i.test(String(period));
  const d = new Date(e.getTime());
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - (quarter ? 2 : 11));
  return d;
}

/** Every explicit date the text pins a figure to, as the END of that period. */
export function datesIn(text: string): Array<{ label: string; end: Date }> {
  const out: Array<{ label: string; end: Date }> = [];
  const t = String(text || '');
  for (const m of t.matchAll(/\bQ\s?([1-4])\s*[-' ]?\s*FY\s?'?(\d{2,4})\b/gi)) {
    const e = periodEnd(`Q${m[1]} FY${m[2]}`);
    if (e) out.push({ label: `Q${m[1]} FY${String(m[2]).slice(-2)}`, end: e });
  }
  // "FY 2025-26" / "FY25-26" is the year that ENDS in the second figure. (zzz772)
  for (const m of t.matchAll(/(?<!Q\s?[1-4]\s?)\bFY\s?'?(\d{2}|\d{4})\s*[-–]\s*'?(\d{2}|\d{4})\b/gi)) {
    out.push({ label: `FY${String(m[2]).slice(-2)}`, end: monthEnd(yy(m[2]), 2) });
  }
  for (const m of t.matchAll(/(?<!Q\s?[1-4]\s?)\bFY\s?'?(\d{2}|\d{4})\b(?!\s*-?\s*\d)/gi)) {
    out.push({ label: `FY${String(m[1]).slice(-2)}`, end: monthEnd(yy(m[1]), 2) });
  }
  for (const m of t.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{1,2}(?:st|nd|rd|th)?,)?[\s,'’-]*(20\d{2}|\d{2}(?=\b)(?![\d%]))/gi)) {
    const mo = MONTHS[m[1].toLowerCase()];
    // A two-digit year only in the "Mar-26" / "Mar'26" shape; "May 5" is a day.
    if (m[2].length === 2 && !/[-'’]\s*\d{2}$/.test(m[0])) continue;
    const y = yy(m[2]);
    out.push({ label: `${MON_LABEL[mo]} ${y}`, end: monthEnd(y, mo) });
  }
  return out;
}

/** The sentence of `text` that contains `value`'s first number. */
export function valueSentence(text: string, value: string | null | undefined): string {
  const t = String(text || '');
  const num = (/\d[\d,]*(?:\.\d+)?/.exec(String(value || '')) || [''])[0];
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z"'(])/);
  if (!num) return sentences.find((s) => value && s.toLowerCase().includes(String(value).toLowerCase().slice(0, 12))) || t;
  const bare = num.replace(/,/g, '');
  return sentences.find((s) => s.replace(/,/g, '').includes(bare)) || t;
}

/** The clause (within that sentence) that carries the value. */
export function valueClause(text: string, value: string | null | undefined): string {
  const s = valueSentence(text, value);
  const num = (/\d[\d,]*(?:\.\d+)?/.exec(String(value || '')) || [''])[0].replace(/,/g, '');
  const parts = s.split(/[,;:]|\s—\s|\s-\s|\b(?:which|but|whereas|while)\b/i);
  if (!num) return s;
  const i = parts.findIndex((p) => p.replace(/,/g, '').includes(num));
  return i >= 0 ? parts[i] : s;
}

const FORWARD = /\b(expect(?:s|ed|ing)?|anticipat\w*|will|shall|going to|plan(?:s|ned|ning)?|to be (?:commissioned|completed|added|operational)|upcoming|soon|next (?:couple|few|two|three|year|quarter)|in the coming|by (?:the )?(?:end|FY|Q[1-4]|20\d\d)|target(?:s|ed|ing)?|aim(?:s|ing)?|would|at peak|optimum|potential|pipeline|roadmap|on track to|(?:are|is|we're) (?:expanding|adding|setting up|building|doubling|tripling)|set to (?:commission|start|begin|commence)|(?:is|are) to be|to (?:enhance|expand|augment|increase|raise|double|scale up) (?:the |its |our )?(?:[\w-]+(?:'s|’s)? )?capacit\w*)\b/i;
const NOT_FORWARD = /\b(than expected|as expected|was expected|were expected|had planned|as planned)\b/gi;
const CURRENT_MARK = /\b(this (?:particular )?quarter|during the quarter|in the quarter|current(?:ly)?|today|as of now|as on date|as of date|at present|in hand|in Q[1-4]|stood at|stands? at|now stand|achieved|recorded|reported|are live|is live)\b/i;

/** Where the value's first number sits inside `text`, or -1. */
function numberAt(text: string, value: string | null | undefined): number {
  const num = (/\d[\d,]*(?:\.\d+)?/.exec(String(value || '')) || [''])[0];
  if (!num) return -1;
  const i = text.indexOf(num);
  if (i >= 0) return i;
  return text.replace(/,/g, '').indexOf(num.replace(/,/g, ''));
}

/** True when the words AROUND the value speak of the future. Proximity
 *  matters: EXICOM's "orders in hand … another INR45 crores advanced
 *  pipeline" is two figures in one sentence, and the pipeline word belongs
 *  to the second. Within 25 characters a forward word decides; within 50 it
 *  decides unless a present-tense marker is just as close. */
export function forwardAround(text: string, value: string | null | undefined): boolean {
  const c = valueClause(text, value).replace(NOT_FORWARD, ' ');
  const n = numberAt(c, value);
  if (n < 0) return FORWARD.test(c) && !CURRENT_MARK.test(c);
  // Anchor the window on the VALUE as written ("approximately INR87 crores"),
  // not on its digits — otherwise the verb in front of a long value falls
  // outside the window (UNIMECH "now stand at approximately INR87 crores").
  const vs = c.toLowerCase().indexOf(String(value || '').toLowerCase().slice(0, 16));
  const start = vs >= 0 && vs <= n ? vs : n;
  const end = Math.max(n, start + String(value || '').length);
  const near = c.slice(Math.max(0, start - 25), end + 25);
  const mid = c.slice(Math.max(0, start - 50), end + 50);
  if (FORWARD.test(near) && !CURRENT_MARK.test(near)) return true;
  return FORWARD.test(mid) && !CURRENT_MARK.test(mid);
}

/** Back-compat: whole-clause test. */
export function forwardWording(clause: string): boolean {
  return FORWARD.test(String(clause || '').replace(NOT_FORWARD, ' '));
}

const HIST_WORDS = /\b(?:over|in) the (?:last|past) (?:\w+ )?years?\b|\b(?:last|previous|prior) (?:financial )?year\b/i;
/** Variables that are EVENTS with a date, not levels. A plant commissioned
 *  in February is lifecycle history the card keeps, not stale context. */
const EVENT_VARS = new Set(['commissioning', 'new_plant', 'capex_status', 'new_customer', 'qualification', 'regulatory_approval', 'new_product', 'plant_shutdown', 'execution_delay']);

/**
 * When a figure is dated to a period that ENDED before this reporting period
 * began, it is context, not this quarter's evidence. Returns the label of the
 * date it is pinned to ("Mar 2025", "FY25", "earlier years"), or null.
 */
export function historicalAsOf(e: Pick<StructuralEvent, 'after' | 'before' | 'evidence_text'> & { variable?: string; value_type?: string; period?: string | null }, reportingPeriod: string | null | undefined): string | null {
  const start = periodStart(reportingPeriod);
  if (!start || !e.after) return null;
  // 0. A company-history timeline line: "2006 Expanded annual manufacturing
  //    capacity from 160 million to 400 million units" (CUPID's annual
  //    report) was read as this quarter's capacity, ▲. A sentence that OPENS
  //    with a year, or an event dated to a bare year, before this period
  //    began is history. (zzz768)
  const sent0 = valueSentence(e.evidence_text, e.after);
  const lead = /^\s*((?:19|20)\d{2})\b(?!\s*[-–]\s*\d)/.exec(sent0) || /^\s*((?:19|20)\d{2})\s*$/.exec(String(e.period || ''));
  if (lead) {
    const y = Number(lead[1]);
    if (monthEnd(y, 11) < start) return String(y);
  }
  if (e.variable && EVENT_VARS.has(e.variable)) return null;
  if (e.value_type && e.value_type !== 'ACTUAL') return null;
  // 0b. A sentence that OPENS by naming its period dates every figure in
  //     it: "In FY 2025-26, capital expenditure stood at INR 4,342 Mn"
  //     (EMCURE, read in Q1 FY27) is last year's capex. (zzz772)
  const opener = /^\s*(?:in|during|for)\s+(?:the\s+)?((?:Q\s?[1-4]\s*)?FY\s?'?\d{2,4}(?:\s*[-–]\s*'?\d{2,4})?)\s*,/i.exec(sent0);
  if (opener) {
    const ds = datesIn(opener[1]);
    if (ds.length) {
      const d = ds.reduce((a, b) => (b.end > a.end ? b : a));
      if (d.end < start) return d.label;
    }
  }
  const pick = (ds: Array<{ label: string; end: Date }>) => {
    const latest = ds.reduce((a, b) => (b.end > a.end ? b : a));
    return latest.end < start ? latest.label : null;
  };
  // 1. A date written INTO the value ("INR593 crores as on 31st March 2025").
  const own = datesIn(String(e.after));
  if (own.length) return pick(own);
  const clause = valueClause(e.evidence_text, e.after);
  const i = numberAt(clause, e.after);
  if (i >= 0) {
    // 2. Just after the value, up to the next full stop: "1.6 million MT in FY26".
    // The window ends at a word boundary: cut mid-token, EMCURE's "we expect
    // FY 2026-27 investments" became "FY 20" and dated a current capex to
    // FY20. (zzz772)
    let end = Math.min(clause.length, i + 45 + String(e.after).length);
    while (end < clause.length && /[\w'’-]/.test(clause[end])) end++;
    // …and at the next clause with its own subject: "INR 4,342 Mn … and we
    // expect FY 2026-27 investments" — the FY27 belongs to the expectation.
    const tail = clause.slice(i, end).split(/[.;]|\b(?:and|but|while|whereas)\s+(?:we|the company|it|management)\b/i)[0];
    if (CURRENT_MARK.test(tail)) return null;
    const td = datesIn(tail);
    if (td.length) return pick(td);
    // 3. Just before it — only for a bare level; with a before value the
    //    preceding date belongs to the before ("94 at end of FY26 to 103").
    if (!e.before) {
      // Starts at a word boundary too: "In FY 2025-26, capital expenditure
      // stood at" cut to "Y 2025-26, …" lost its date. (zzz772)
      let start1 = Math.max(0, i - 40);
      while (start1 > 0 && /[\w'’-]/.test(clause[start1 - 1])) start1--;
      const head = clause.slice(start1, i);
      if (CURRENT_MARK.test(head)) return null;
      // "We closed the year with 94 boutiques" — the year-end figure, not the
      // quarter's (ETHOSLTD's current count is 103 "as on date").
      if (/\b(closed|ended|exited|end of) the (?:financial |fiscal )?year\b/i.test(head) && /Q\s?[1-4]/i.test(String(reportingPeriod))) return 'previous year-end';
      const hd = datesIn(head);
      if (hd.length) return pick(hd);
    }
  }
  const sentence = valueSentence(e.evidence_text, e.after);
  if (HIST_WORDS.test(sentence) && !CURRENT_MARK.test(sentence)) return 'earlier years';
  return null;
}

// Only words that SAY the figure did not move. "Remains strong at ₹787 Cr"
// (LUMAXTECH) describes a level; "remained unchanged at" states a flat.
const FLAT_WORDS = /\b(unchanged|no change|flat (?:at|q-?o-?q|y-?o-?y|sequentially)|same level|(?:remained|remains|held|stayed|was) (?:flat|unchanged|stable|steady|constant)(?: at)?|(?:stable|steady|constant) at|maintained at|held at)\b/i;

export interface NormalizedEvent extends StructuralEvent {
  /** The type the model gave, when this module changed it. */
  original_value_type?: ValueType;
  /** Why the type changed, in words the card can print. */
  retyped_because?: string | null;
  /** Set when the figure is dated before the reporting period. */
  historical_as_of?: string | null;
  /** The document says the figure did not move ("unchanged at ₹1,200 Cr"). */
  flat_stated?: boolean;
  /** An expectation with no figure — MANAGEMENT_COMMENTARY. (zzz770) */
  commentary?: boolean;
}

/**
 * Correct the TYPE of a reading from its own sentence. The value strings are
 * never edited; only `value_type`, and `before` for a stated flat.
 */
const HEDGE = /\b(maybe|may be|perhaps|possibly|probably|could be|might be|would be around|we (?:think|believe|feel)|i (?:think|believe|feel)|ballpark|tentatively|anywhere between)\b/i;
/** Hedge word within ~40 characters before the value (same sentence). */
export function hedgedAround(text: string | null | undefined, value: string | null | undefined): boolean {
  const t = String(text || ''), v = String(value || '').trim();
  if (!v) return false;
  // A hedge INSIDE the value is the same hedge: NRBBEARING's order book
  // "INR25 crores → maybe INR30 crores" printed ▲ as a reported move. (zzz769)
  if (HEDGE.test(v)) return true;
  if (!t) return false;
  const digits = v.match(/\d[\d,.]*/)?.[0];
  let at = t.indexOf(v);
  if (at < 0 && digits) at = t.indexOf(digits);
  if (at < 0) return false;
  const before = t.slice(Math.max(0, at - 40), at);
  const cut = Math.max(before.lastIndexOf('. '), before.lastIndexOf('; '));
  return HEDGE.test(cut >= 0 ? before.slice(cut + 1) : before);
}

/** "The Board has approved … to enhance the project's capacity" — a plan. (zzz773) */
export function approvalPlan(text: string | null | undefined, value: string | null | undefined): boolean {
  return /\bapprov(?:ed|al)\b[^;]{0,140}?\bto (?:enhance|expand|augment|increase|raise|add|double|set up|build)\b/i.test(valueSentence(String(text || ''), value));
}

export function normalizeEvent(e: StructuralEvent, reportingPeriod?: string | null): NormalizedEvent {
  const out: NormalizedEvent = { ...e };
  const clause = valueClause(e.evidence_text, e.after ?? e.before);
  // A "by <period>" that ENDED before this reporting period began is not a
  // plan: ENTERO's "59 days by Q4 FY26" read in Q1 FY27 printed as
  // guidance beside the quarter's actual. (zzz770)
  const start0 = periodStart(reportingPeriod);
  const ownDates = datesIn(String(e.after ?? e.before ?? ''));
  const pastDated = !!start0 && ownDates.length > 0 && ownDates.every((d) => d.end < start0);
  // ── AN APPROVAL IS A PLAN.                                         (zzz773)
  // HSCL "the Board has approved an additional capex of Rs. 128 Crores to
  // enhance the project's capacity from 2600 MTPA to 5300 MTPA" printed as
  // "Capacity added 2,600 → 5,300 MTPA +103.8%". Nothing was added: the
  // board approved spending to add it.
  const approvedPlan = approvalPlan(e.evidence_text, e.after ?? e.before);
  if (e.value_type === 'ACTUAL' && !pastDated && approvedPlan) {
    out.value_type = 'GUIDANCE';
    out.original_value_type = e.value_type;
    out.retyped_because = 'an approval to add capacity is a plan, not capacity added';
  } else if (e.value_type === 'ACTUAL' && !pastDated && forwardAround(e.evidence_text, e.after ?? e.before)) {
    out.value_type = 'GUIDANCE';
    out.original_value_type = e.value_type;
    out.retyped_because = 'the sentence states it as expected or planned, not achieved';
  } else if (e.value_type === 'GUIDANCE' && /\b(this (?:particular )?quarter|based on the performance)\b/i.test(valueSentence(e.evidence_text, e.after)) && !forwardWording(valueSentence(e.evidence_text, e.after).replace(/\blooking at\b/i, ''))) {
    // "we are looking at a utilisation of 25–30% … based on the performance
    // of this particular quarter" is the quarter's own figure.
    out.value_type = 'ACTUAL';
    out.original_value_type = e.value_type;
    out.retyped_because = 'the sentence ties it to the current quarter';
  }
  // ── A HEDGED FIGURE IS NOT A REPORTED ONE.                       (zzz767)
  // "Capex maybe INR1,200 crores" printed as an actual. A hedge word right
  // before the value makes it a management estimate.
  if (out.value_type === 'ACTUAL' && hedgedAround(e.evidence_text, e.after ?? e.before)) {
    out.value_type = 'MANAGEMENT_CLAIM';
    out.original_value_type = e.value_type;
    out.retyped_because = 'the figure is hedged ("maybe", "could be", "approximately we think")';
  }
  // ── AN EXPECTATION IS NOT A VALUE.                               (zzz770)
  // EMCURE "Order book should go up in line with supplies" was read as an
  // order-book value and a demand confirmation. A recurring quantitative
  // variable with no figure and expectation wording is management
  // commentary, whatever label the model gave it.
  if (isCommentaryOnly(e.variable, e.after ?? e.before, e.evidence_text)) {
    if (out.value_type !== 'MANAGEMENT_CLAIM') {
      out.original_value_type = out.original_value_type ?? e.value_type;
      out.value_type = 'MANAGEMENT_CLAIM';
      out.retyped_because = 'an expectation with no figure — management commentary, not a value';
    }
    out.commentary = true;
  }
  const hist = historicalAsOf({ ...e, value_type: out.value_type }, reportingPeriod);
  if (hist) out.historical_as_of = hist;
  if (out.value_type === 'ACTUAL' && e.after && !e.before && FLAT_WORDS.test(clause) && !/\b(improv|increas|rose|declin|decreas|fell)/i.test(clause)) {
    out.flat_stated = true;
  }
  return out;
}

// ── A PERIOD LABEL IS NOT A NUMBER.                              (zzz772)
//
// IRMENERGY's prior was stated "Q1 FY26: 54.80 mmscm" and the first-number
// parser read the "1" of "Q1": the card printed "+57.9 MMSCM · +5794%" for a
// volume that grew 7.6%. Every numeric helper strips the period tokens a
// filing writes beside a figure — Q1–Q4, H1/H2, 9M/6M/3M with a year, FY26,
// FY2026, FY2025-26, CY25 and a "Q1 FY26:" prefix — before it looks for the
// first number. The value string itself is never edited; only the copy
// that is parsed.
const PERIOD_WITH_YEAR = /\b(?:Q\s?[1-4]|H\s?[12]|[369]M)\s*[-' ]?\s*(?:FY|CY)\s*'?\d{2,4}(?:\s*[-–/]\s*'?\d{2,4})?\b\s*:?/gi;
const YEAR_LABEL = /(?<![A-Za-z])(?:FY|CY)\s*'?\d{2,4}(?:\s*[-–/]\s*'?\d{2,4}(?![\d.]))?\b\s*:?/gi;
const BARE_PERIOD = /\b(?:Q[1-4]|H[12])\b\s*:?|\b[369]M\b\s*:/gi;
export function stripPeriodTokens(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(PERIOD_WITH_YEAR, ' ')
    .replace(YEAR_LABEL, ' ')
    .replace(BARE_PERIOD, ' ')
    .replace(/\(\s*[:,;]?\s*\)/g, ' ')
    // A leading separator left by a stripped "Q1 FY26:" — never a minus sign.
    .replace(/^\s*(?:[:,;]|[–-](?!\s*\d))\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    // "58.94 mmscm in Q1 FY27" leaves a dangling "in", which would read as a
    // unit word beside "58.94 mmscm".
    .replace(/(?:\s+(?:in|as\s+(?:of|on|at)|at|for|by|during|end\s+of|the|of|vs\.?|versus))+\s*[,;:]?$/i, '')
    .trim();
}

/** "Q1 FY26: 54.80 mmscm" → "54.80 mmscm (Q1 FY26)": a figure first, its
 *  period after it, so the period never sits where a number is read. Only a
 *  leading period label followed by a separator is moved. (zzz772) */
export function movePeriodOut(s: string | null | undefined): string | null {
  if (s == null) return null;
  const m = /^\s*((?:Q\s?[1-4]|H\s?[12]|[369]M)\s*[-' ]?\s*(?:FY|CY)\s*'?\d{2,4}|(?:FY|CY)\s*'?\d{2,4})\s*[:–—-]\s*(.+?)\s*$/i.exec(String(s));
  if (!m || !/\d/.test(m[2])) return String(s);
  return `${m[2]} (${m[1].replace(/\s+/g, ' ').replace(/^(Q[1-4]|H[12]|[369]M)\s*(FY|CY)/i, '$1 $2').trim()})`;
}

// ── commentary: an expectation with no figure ─────────────────  (zzz770)

/** A quantity. Labels such as "Phase 2" or "Q4 FY26" are not quantities. */
export function hasQuantity(s: string | null | undefined): boolean {
  return /\d/.test(String(s ?? '')
    .replace(/\b(phase|unit|line|block|stage|tranche|site|plant|building|module)\s*[-#]?\s*\d+\b/gi, ' ')
    .replace(/\b(FY|CY|H[12]|Q[1-4])\s*'?\d{2,4}\b/gi, ' '));
}
/** Recurring quantitative variables: a figure for these is a level in a time
 *  series, and a figure with no prior is printed "prior comparable value not
 *  disclosed". Event-shaped variables (a plant, a customer) are not levels. */
export const RECURRING_METRICS: ReadonlySet<VarKey> = new Set<VarKey>([
  'utilisation', 'capacity', 'order_book', 'order_intake', 'book_to_bill', 'working_capital',
  'debt', 'fcf', 'volume', 'price', 'exports', 'margin', 'cash_conversion', 'roce',
  'capex', 'customer_concentration', 'market_share', 'revenue_visibility',
]);
/** An expectation about a quantitative variable that states no figure:
 *  "Order book should go up in line with supplies" (EMCURE). Commentary. */
const EXPECTATION = /\b(should|would|could|may|might|expect\w*|anticipat\w*|hope\w*|likely|going to|will|in line with|on track)\b/i;
export function isCommentaryOnly(key: VarKey, value: string | null | undefined, text?: string | null): boolean {
  if (!RECURRING_METRICS.has(key)) return false;
  if (hasQuantity(value)) return false;
  return EXPECTATION.test(`${value || ''} ${text || ''}`);
}


// ── guidance moves ──────────────────────────────────────────────────────────

/** "20–25%" → {lo:20, hi:25}; "25%" → {lo:25, hi:25}. Null when no number. */
export function rangeOf(s: string | null | undefined): { lo: number; hi: number; pct: boolean } | null {
  // "FY27: 20-25%" is 20–25, not 27–20. (zzz772)
  const t = (stripPeriodTokens(String(s || '')) || String(s || '')).replace(/,/g, '');
  // A hyphen after a digit or a % is a range dash, not a minus: "20-25%",
  // KIRIINDUS "70%-75%" (read as −75 → "gap +135pp").
  const nums = Array.from(t.matchAll(/(?<![\d.%]\s*)-?\d+(?:\.\d+)?/g)).map((m) => Number(m[0])).filter(Number.isFinite);
  if (!nums.length) return null;
  const two = /\d\s*(?:%\s*)?(?:-|–|—|to)\s*-?\d/.test(t) && nums.length >= 2;
  const lo = nums[0], hi = two ? nums[1] : nums[0];
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi), pct: /%|per\s?cent/i.test(t) };
}

export type GuidanceMove = 'RAISED' | 'LOWERED' | 'MAINTAINED' | 'NARROWED' | 'WIDENED' | 'NOT_COMPARABLE';

/** Compare two statements of the same guidance. Midpoint decides raised or
 *  lowered; identical bounds are MAINTAINED; the same midpoint with a
 *  different width is NARROWED / WIDENED. Percent against a number is
 *  NOT_COMPARABLE. */
export function guidanceMove(prev: string | null | undefined, cur: string | null | undefined): GuidanceMove {
  const a = rangeOf(prev), b = rangeOf(cur);
  if (!a || !b || a.pct !== b.pct) return 'NOT_COMPARABLE';
  if (a.lo === b.lo && a.hi === b.hi) return 'MAINTAINED';
  const ma = (a.lo + a.hi) / 2, mb = (b.lo + b.hi) / 2;
  if (Math.abs(mb - ma) < 1e-9) return (b.hi - b.lo) < (a.hi - a.lo) ? 'NARROWED' : 'WIDENED';
  return mb > ma ? 'RAISED' : 'LOWERED';
}

/** Actual against a target, in the target's own terms: "−5.0pp" for two
 *  percentages, "−6.3%" otherwise. Null when either side has no number or the
 *  units differ (the caller checks units). */
export function gapToTarget(actual: string | null | undefined, target: string | null | undefined): string | null {
  const a = rangeOf(actual), t = rangeOf(target);
  if (!a || !t || a.pct !== t.pct || a.lo !== a.hi) return null;
  const tv = t.lo;                         // the bottom of a target range is the bar
  if (!tv) return null;
  if (a.pct) { const d = a.lo - tv; return `${d >= 0 ? '+' : ''}${Math.round(d * 10) / 10}pp`; }
  const d = ((a.lo - tv) / Math.abs(tv)) * 100;
  return `${d >= 0 ? '+' : ''}${Math.round(d * 10) / 10}%`;
}
