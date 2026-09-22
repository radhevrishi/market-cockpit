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

const FORWARD = /\b(expect(?:s|ed|ing)?|anticipat\w*|will|shall|going to|plan(?:s|ned|ning)?|to be (?:commissioned|completed|added|operational)|upcoming|soon|next (?:couple|few|two|three|year|quarter)|in the coming|by (?:the )?(?:end|FY|Q[1-4]|20\d\d)|target(?:s|ed|ing)?|aim(?:s|ing)?|would|at peak|optimum|potential|pipeline|roadmap|on track to|(?:are|is|we're) (?:expanding|adding|setting up|building|doubling|tripling))\b/i;
const NOT_FORWARD = /\b(than expected|as expected|was expected|were expected|had planned|as planned)\b/gi;
const CURRENT_MARK = /\b(this (?:particular )?quarter|during the quarter|in the quarter|current(?:ly)?|today|as of now|as on date|as of date|at present|in hand|in Q[1-4]|stood at|achieved|recorded|reported|are live|is live)\b/i;

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
  const i = numberAt(c, value);
  if (i < 0) return FORWARD.test(c) && !CURRENT_MARK.test(c);
  const near = c.slice(Math.max(0, i - 25), i + 25 + String(value || '').length);
  const mid = c.slice(Math.max(0, i - 50), i + 50 + String(value || '').length);
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
export function historicalAsOf(e: Pick<StructuralEvent, 'after' | 'before' | 'evidence_text'> & { variable?: string; value_type?: string }, reportingPeriod: string | null | undefined): string | null {
  const start = periodStart(reportingPeriod);
  if (!start || !e.after) return null;
  if (e.variable && EVENT_VARS.has(e.variable)) return null;
  if (e.value_type && e.value_type !== 'ACTUAL') return null;
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
    const tail = clause.slice(i, i + 45 + String(e.after).length).split(/[.;]/)[0];
    if (CURRENT_MARK.test(tail)) return null;
    const td = datesIn(tail);
    if (td.length) return pick(td);
    // 3. Just before it — only for a bare level; with a before value the
    //    preceding date belongs to the before ("94 at end of FY26 to 103").
    if (!e.before) {
      const head = clause.slice(Math.max(0, i - 40), i);
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
}

/**
 * Correct the TYPE of a reading from its own sentence. The value strings are
 * never edited; only `value_type`, and `before` for a stated flat.
 */
export function normalizeEvent(e: StructuralEvent, reportingPeriod?: string | null): NormalizedEvent {
  const out: NormalizedEvent = { ...e };
  const clause = valueClause(e.evidence_text, e.after ?? e.before);
  if (e.value_type === 'ACTUAL' && forwardAround(e.evidence_text, e.after ?? e.before)) {
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
  const hist = historicalAsOf({ ...e, value_type: out.value_type }, reportingPeriod);
  if (hist) out.historical_as_of = hist;
  if (out.value_type === 'ACTUAL' && e.after && !e.before && FLAT_WORDS.test(clause) && !/\b(improv|increas|rose|declin|decreas|fell)/i.test(clause)) {
    out.flat_stated = true;
  }
  return out;
}

// ── guidance moves ──────────────────────────────────────────────────────────

/** "20–25%" → {lo:20, hi:25}; "25%" → {lo:25, hi:25}. Null when no number. */
export function rangeOf(s: string | null | undefined): { lo: number; hi: number; pct: boolean } | null {
  const t = String(s || '').replace(/,/g, '');
  // A hyphen after a digit is a range dash, not a minus: "20-25%".
  const nums = Array.from(t.matchAll(/(?<![\d.])-?\d+(?:\.\d+)?/g)).map((m) => Number(m[0])).filter(Number.isFinite);
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
