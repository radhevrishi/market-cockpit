// ═══════════════════════════════════════════════════════════════════════════
// THE LONGITUDINAL LAYER — CURRENT → PREVIOUS → CHANGE → CAUSE.     (zzz758)
//
// WHAT WAS WRONG, precisely. The evidence ledger has stored one PeriodRecord
// per reporting period since zzz740, and `mergePeriod` never overwrites a
// period that is already there — so the history was on disk the whole time.
// `whatChanged()` even compared the latest period against the previous one.
// But it emitted TEXT: a list of sentences under "WHAT CHANGED". Nothing
// joined that history back to the VARIABLE ROWS, because `extractVariables`
// is handed one thing — the CURRENT period's summary — and therefore cannot
// know that utilisation was 72% last quarter. The board could print "80%"
// and was structurally incapable of printing "72% → 80% · +8pp".
//
// This module closes that. It walks every period in the ledger, finds the
// most recent PRIOR actual for each variable, and returns a comparison the
// variable row carries with it. Three rules it will not break:
//
//   1. NEVER INVENT A PREVIOUS VALUE. A previous value exists only when an
//      earlier PeriodRecord actually holds a FACT for that variable. If none
//      does, `previous` is null and `change_type` is NEWLY_DISCLOSED or NEW —
//      never a plausible-looking number.
//   2. NEVER COMPARE ACROSS UNITS. `sameUnit()` (zzz755) decides. MOREPEN's
//      "314 kiloliters" against "200 KLD" is NOT_COMPARABLE and says so; it
//      does not become −36%.
//   3. PERCENTAGE POINTS ARE NOT PERCENT. 72% → 80% is +8pp. Calling it
//      +11.1% is arithmetically true and operationally useless, so pp leads
//      and the relative figure is offered second.
//
// CAUSE is extracted, never inferred. A cause exists only where the document
// sentence carries an explicit causal connective ("due to", "driven by", "on
// account of"). Everything else is NOT DISCLOSED, which is itself a finding:
// a margin that moved with no stated reason is a number without a mechanism.
//
// THIS MODULE IS PURE. Ledger in, comparisons out. No KV, no fetch, no React.
// ═══════════════════════════════════════════════════════════════════════════

import type { VarKey } from './taxonomy';
import { VAR_LABEL } from './taxonomy';
import {
  periodOrdinal, sameUnit, scaledNumber,
  type CompanyLedger, type EvidenceFact, type PeriodRecord,
} from './evidence-ledger';
import { judgeEventQuality, verifiedDirection, betterReading, type StructuralEvent } from './evidence-extract';
import { normalizeEvent, guidanceMove, datesIn, type GuidanceMove } from './fact-normalize';
import {
  comparability, deltaText, lineageOf, samePeriodPair, factTypeOf, normalizeValue,
  PRIOR_NOT_DISCLOSED, type FactType, type Lineage, type NormalizedValue,
} from './fact-model';

// ── the vocabulary ─────────────────────────────────────────────────────────

/**
 * What kind of change this is. Deliberately more than up/down/flat, because
 * "the company disclosed this for the first time" and "the company stopped
 * disclosing it" are both information and neither is a direction.
 */
export type ChangeType =
  /** First observation of this variable anywhere in the ledger. */
  | 'NEW'
  /** A prior figure exists and the current one is higher. */
  | 'INCREASED'
  /** A prior figure exists and the current one is lower. */
  | 'DECREASED'
  /** A prior figure exists and the current one is the same. */
  | 'UNCHANGED'
  /** A forward statement repeated without change — guidance held. */
  | 'REITERATED'
  /** Disclosed this period, with prior periods on file that were silent. */
  | 'NEWLY_DISCLOSED'
  /** Disclosed in an earlier period and absent from this one. */
  | 'NOT_DISCLOSED'
  /** Both sides exist and cannot honestly be subtracted (different units). */
  | 'NOT_COMPARABLE';

/**
 * What the current figure is being measured against. The basis changes what
 * the number MEANS — a sequential move carries seasonality that a year-on-year
 * move cancels — so it travels with every comparison and is printed.
 */
export type ComparisonBasis =
  /** Consecutive reporting periods. */
  | 'QOQ'
  /** Exactly four quarters apart. */
  | 'YOY'
  /** Two disclosures more than one quarter and not four quarters apart. */
  | 'SINCE_LAST_DISCLOSURE'
  /** Both sides are full-year figures. */
  | 'FY_VS_FY'
  /** before→after stated inside ONE document, no cross-period join. */
  | 'WITHIN_DOCUMENT'
  /** Nothing to compare against. */
  | 'NONE';

export const BASIS_LABEL: Record<ComparisonBasis, string> = {
  QOQ: 'vs last quarter',
  YOY: 'vs the same quarter last year',
  SINCE_LAST_DISCLOSURE: 'since it was last disclosed',
  FY_VS_FY: 'full year vs full year',
  WITHIN_DOCUMENT: 'stated in the same document',
  NONE: 'no comparison basis',
};

/** Whether a stated cause repeats. The whole question behind "can it
 *  continue", and the one the first engine could not ask. */
export type Persistence = 'STRUCTURAL' | 'TEMPORARY' | 'UNCLASSIFIED';

export interface Cause {
  /** The clause the document actually wrote, verbatim and trimmed. */
  text: string;
  /** The connective that introduced it — the proof it is a stated cause. */
  connective: string;
  confidence: 'HIGH' | 'MEDIUM';
  persistence: Persistence;
  /** Why it was classified that way, naming the word that decided it. */
  persistence_because: string;
  source: string;
}

export interface Quantity {
  /** As the document wrote it. */
  raw: string;
  /** The leading number, when there is one. */
  value: number | null;
  /** Unit words taken from the string itself, not from the model's field. */
  unit: string | null;
  isPercent: boolean;
}

export interface MetricComparison {
  key: VarKey;
  label: string;
  current: Quantity | null;
  current_period: string | null;
  previous: Quantity | null;
  previous_period: string | null;
  /** The change as it should be READ: "+8pp", "+12.5%", "₹500 Cr → ₹820 Cr". */
  change: string | null;
  /** The relative move, offered only when the primary change is in pp. */
  change_relative: string | null;
  change_type: ChangeType;
  basis: ComparisonBasis;
  direction: 'up' | 'down' | 'flat' | 'unknown';
  /** Null when the document stated no reason. NEVER inferred. */
  cause: Cause | null;
  /** For a forward statement compared with the previous one: RAISED /
   *  LOWERED / MAINTAINED / NARROWED / WIDENED. (zzz765) */
  guidance_move?: GuidanceMove | null;
  /** A forward statement for this same variable in the CURRENT period. */
  forward: { value: string; kind: 'GUIDANCE' | 'TARGET'; by: string | null; source: string } | null;
  /** A forward statement made in an EARLIER period about this variable, so a
   *  promise can be read beside the actual that was meant to fulfil it. */
  promised: { value: string; kind: 'GUIDANCE' | 'TARGET'; period: string; by: string | null } | null;
  /** One sentence, assembled from the fields above. Nothing new is asserted. */
  line: string;
  /** ── THE COMPARABILITY VERDICT BEHIND THE DELTA.                 (zzz770)
   *  `comparable: false` with a reason whenever a prior exists but may not be
   *  subtracted (unit, scope, basis, definition, same period). */
  comparability?: { comparable: boolean; reason: string | null; conversion_method: string | null } | null;
  /** The type of the CURRENT reading (owner's seven types). */
  fact_type?: FactType | null;
  /** Where the current and previous figures came from, never dropped. */
  lineage?: { current: Lineage | null; previous: Lineage | null } | null;
  /** The whole per-period history of this variable (see metricSeries). */
  series?: MetricSeries | null;
  /** "68% → 74% · +6pp" / "74% · prior comparable value not disclosed". */
  display?: string;
  /** The verbatim sentence the current figure came from. */
  evidence: string;
  source: string;
}

// ── quantities ─────────────────────────────────────────────────────────────

const UNIT_STOP = new Set([
  'per', 'of', 'and', 'to', 'the', 'a', 'an', 'approx', 'approximately',
  'about', 'around', 'nearly', 'over', 'odd', 'from', 'at', 'is', 'was',
]);

/** Unit words are read off the value string, because the model's `unit` field
 *  has been wrong often enough to be untrustworthy on its own. */
function unitOf(raw: string): string | null {
  const words = raw
    .toLowerCase()
    .replace(/[\d,.\s₹$`\-–]+/g, ' ')
    .replace(/%+/g, ' % ')
    // A magnitude word belongs to the VALUE — `scaledNumber` folds it in — so
    // it must not read as a unit here either, or "1.6 million tonnes" and
    // "1,000,000 tonnes" look like two different measures. (zzz758)
    .replace(/\b(trillions?|billions?|bn|crores?|cr|millions?|mn|lakhs?|thousands?)\b/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !UNIT_STOP.has(w))
    .map((w) => w.replace(/s$/, ''));
  return words.length ? Array.from(new Set(words)).join(' ') : null;
}

export function quantity(raw: string | null | undefined, unitField?: string | null): Quantity | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // Magnitude-aware: "1.6 million" is 1,600,000, not 1.6. GPPL's throughput
  // printed as −100% because the two sides were read on different scales.
  const v = scaledNumber(s);
  return {
    raw: s,
    value: v != null && Number.isFinite(v) ? v : null,
    unit: unitOf(s) || (unitField ? String(unitField).trim().toLowerCase() || null : null),
    isPercent: /%|\bper\s?cent\b/i.test(s),
  };
}

// ── cause ──────────────────────────────────────────────────────────────────

/** Only these introduce a stated cause. A sentence without one states no
 *  reason, and this module then says so rather than guessing at one. */
const CONNECTIVES = [
  'due to', 'driven by', 'on account of', 'because of', 'owing to',
  'attributable to', 'as a result of', 'on the back of', 'led by',
  'supported by', 'aided by', 'helped by', 'on account of the',
  'primarily due to', 'mainly due to', 'largely due to', 'reflecting',
  'thanks to', 'resulting from', 'stemming from',
];

const STRUCTURAL_WORDS: Array<[RegExp, string]> = [
  [/\bnew (plant|line|facility|unit|capacity|customer|product|contract)\b/i, 'a new plant, line or customer'],
  [/\bcommission(ed|ing)\b/i, 'commissioning'],
  [/\bde-?bottleneck/i, 'de-bottlenecking'],
  [/\bcapacity (expansion|addition|ramp)/i, 'capacity expansion'],
  [/\b(product|revenue|business) mix\b/i, 'a mix shift'],
  [/\bvalue[- ]added\b/i, 'a shift to value-added products'],
  [/\bautomation|backward integration|forward integration\b/i, 'integration or automation'],
  [/\blong[- ]term (contract|agreement|order)/i, 'a long-term contract'],
  [/\border book|order intake|new orders?\b/i, 'the order book'],
  [/\boperating leverage|fixed[- ]cost absorption\b/i, 'operating leverage'],
  [/\bapproval|qualification|registration|USFDA|CEP\b/i, 'an approval or qualification'],
  [/\bprice (increase|hike|revision)|pricing power\b/i, 'a price increase the company took'],
];

const TEMPORARY_WORDS: Array<[RegExp, string]> = [
  [/\bone[- ]off|one[- ]time|exceptional item|non[- ]recurring\b/i, 'a one-off item'],
  [/\bforex|foreign exchange|currency (gain|loss|movement)\b/i, 'a currency movement'],
  [/\b(raw material|input|commodity) (price|cost)s?\b/i, 'an input-cost move'],
  [/\binventory (gain|loss|revaluation|destocking|restocking)\b/i, 'an inventory effect'],
  [/\bseasonal|festive|monsoon|off[- ]season\b/i, 'seasonality'],
  [/\b(planned |scheduled )?(maintenance )?shutdown|plant closure\b/i, 'a shutdown'],
  [/\binsurance claim|land sale|sale of (asset|investment)|write[- ]back\b/i, 'a non-operating item'],
  [/\b(subsidy|incentive|PLI) (receipt|accrual|recognition)\b/i, 'an incentive recognition'],
  [/\bdeferred|postponed|slipped (in)?to|pushed (in)?to\b/i, 'timing slippage between periods'],
  [/\bcovid|lockdown|election|weather|flood|cyclone\b/i, 'an external disruption'],
];

function classifyPersistence(text: string): { persistence: Persistence; because: string } {
  for (const [re, why] of TEMPORARY_WORDS) {
    if (re.test(text)) return { persistence: 'TEMPORARY', because: `The stated reason is ${why}, which does not repeat on its own.` };
  }
  for (const [re, why] of STRUCTURAL_WORDS) {
    if (re.test(text)) return { persistence: 'STRUCTURAL', because: `The stated reason is ${why}, which carries into later periods.` };
  }
  return {
    persistence: 'UNCLASSIFIED',
    because: 'A reason was stated but it names neither a repeating mechanism nor a one-off, so whether it continues is an open question.',
  };
}

/**
 * Pull the cause out of the sentence the figure came from — and ONLY out of
 * that sentence. No cross-sentence joining, no "the obvious reason is". If
 * the document did not write a causal connective, there is no cause on file.
 */
export function extractCause(evidenceText: string, source: string): Cause | null {
  const t = String(evidenceText || '').trim();
  if (!t) return null;
  const low = t.toLowerCase();
  let best: { idx: number; conn: string } | null = null;
  for (const c of CONNECTIVES) {
    const i = low.indexOf(c);
    if (i < 0) continue;
    // Longest connective wins at the same position ("primarily due to" over "due to").
    if (!best || i < best.idx || (i === best.idx && c.length > best.conn.length)) {
      if (!best || i < best.idx) best = { idx: i, conn: c };
      else best = { idx: i, conn: c };
    }
  }
  if (!best) return null;
  let tail = t.slice(best.idx + best.conn.length).trim();
  // Stop at the sentence boundary. A cause is one clause, not a paragraph.
  const stop = tail.search(/[.;]\s|\.$/);
  if (stop > 0) tail = tail.slice(0, stop);
  tail = tail.replace(/^[,:\-–\s]+/, '').trim();
  if (tail.length < 4) return null;
  if (tail.length > 220) tail = `${tail.slice(0, 217)}…`;
  const p = classifyPersistence(tail);
  return {
    text: tail,
    connective: best.conn,
    // HIGH when the reason sits in the same clause as the figure; MEDIUM when
    // the figure is far enough away that the pairing is a reading, not a read.
    confidence: best.idx < 200 ? 'HIGH' : 'MEDIUM',
    persistence: p.persistence,
    persistence_because: p.because,
    source,
  };
}

// ── basis ──────────────────────────────────────────────────────────────────

function basisFor(from: string, to: string): ComparisonBasis {
  const a = periodOrdinal(from), b = periodOrdinal(to);
  if (a < 0 || b < 0) return 'SINCE_LAST_DISCLOSURE';
  const gap = b - a;
  if (gap === 1) return 'QOQ';
  if (gap === 4) return 'YOY';
  return 'SINCE_LAST_DISCLOSURE';
}

// ── change arithmetic ──────────────────────────────────────────────────────

/**
 * The change between two quantities, expressed the way an operator reads it.
 *
 * PERCENTAGES MOVE IN POINTS. 72% → 80% is +8pp. The relative move (+11.1%)
 * is returned separately and is never the headline, because "utilisation rose
 * 11%" is the sentence that makes a reader think eight points is eleven.
 */
export function changeBetween(prev: Quantity, cur: Quantity): { change: string | null; relative: string | null; direction: 'up' | 'down' | 'flat' | 'unknown' } {
  const b = prev.value, a = cur.value;
  if (b == null || a == null) return { change: null, relative: null, direction: 'unknown' };
  const d = a - b;
  const dir: 'up' | 'down' | 'flat' = Math.abs(d) < 1e-9 ? 'flat' : d > 0 ? 'up' : 'down';
  // An unchanged figure has no delta to print: "59 → 59 · +0%" (ENTERO) read
  // as a measured move. The change TYPE says unchanged. (zzz770)
  if (dir === 'flat') return { change: null, relative: null, direction: 'flat' };
  const sign = d >= 0 ? '+' : '';
  if (prev.isPercent && cur.isPercent) {
    const pp = `${sign}${Math.round(d * 10) / 10}pp`;
    const rel = b === 0 ? null : `${d >= 0 ? '+' : ''}${Math.round((d / Math.abs(b)) * 1000) / 10}% relative`;
    return { change: pp, relative: rel, direction: dir };
  }
  if (b === 0) return { change: null, relative: null, direction: dir };
  const p = (d / Math.abs(b)) * 100;
  return { change: `${p >= 0 ? '+' : ''}${Math.round(p * 10) / 10}%`, relative: null, direction: dir };
}

// ── the walk ───────────────────────────────────────────────────────────────

/** The change between two readings the comparability engine passed: pp for
 *  percentages (with the relative move second), relative percent otherwise,
 *  computed on the NORMALISED values so lakh↔crore and KTPA↔MT are exact. */
function changeOf(prevQ: Quantity, curQ: Quantity, pn: NormalizedValue | null, cn: NormalizedValue | null): { change: string | null; relative: string | null; direction: 'up' | 'down' | 'flat' | 'unknown' } {
  if ((prevQ.isPercent && curQ.isPercent) || !pn || !cn || pn.normalized_value == null || cn.normalized_value == null) return changeBetween(prevQ, curQ);
  const d = deltaText(pn, cn);
  return { change: d.text === 'unchanged' ? null : d.text, relative: null, direction: d.direction };
}

/** A reading as the comparability engine sees it. The period is the one the
 *  figure DESCRIBES: a date written into the value ("82.88 crore deployed in
 *  April 2026", CUPID — filed under two ledger periods) wins over the ledger
 *  period it happened to be read in. (zzz770) */
function comparableOf(f: EvidenceFact, period: string, factType: FactType) {
  // The first figure's own clause: "82.88 crore is deployed in April 2026 and
  // 36.93 crore in May 2026" describes April for its first figure.
  const own = datesIn(String(f.value ?? '').split(/\band\b|;|,(?!\d)/)[0]);
  const pinned = own.length ? own.reduce((x, y) => (y.end > x.end ? y : x)).label : null;
  return { key: f.metric_name, value: String(f.value ?? ''), unit: f.unit, quote: f.source_quote, period: pinned || period, fact_type: factType };
}

/** The type of a stored fact, read from its own sentence. */
function typeOfFact(f: EvidenceFact, period: string): FactType {
  const e = asEvent(f, period);
  return factTypeOf({ valueType: e.historical_as_of && e.value_type === 'ACTUAL' ? 'HISTORICAL' : e.value_type, key: f.metric_name,
    value: f.value, text: f.source_quote, source: f.source_name, retyped: (e as any).retyped_because });
}

const CONF_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** A ledger fact read back as the event it came from, with its TYPE
 *  corrected from its own sentence (fact-normalize.ts) — so the join and the
 *  board classify every reading the same way. (zzz765) */
function asEvent(f: EvidenceFact, period: string): StructuralEvent & { historical_as_of?: string | null } {
  const vt = f.fact_or_management_statement === 'FACT' ? 'ACTUAL' : f.fact_or_management_statement;
  return normalizeEvent({
    variable: f.metric_name, value_type: vt as any,
    before: f.before_value, after: f.after_value ?? f.value, unit: f.unit, period: null,
    direction: f.direction, evidence_text: f.source_quote, source: f.source_name,
    confidence: f.confidence,
  }, period);
}

/** A fact is usable as a COMPARABLE figure only when it is a reported fact
 *  from a real sentence that fits its variable, and describes THIS period.
 *  Charts, wrong-unit values, forward statements the model filed as facts
 *  and figures dated before the period stay in the ledger for audit. */
function usableActual(f: EvidenceFact, period: string): boolean {
  if (f.fact_or_management_statement !== 'FACT') return false;
  if (!String(f.value || '').trim()) return false;
  const e = asEvent(f, period);
  if (e.value_type !== 'ACTUAL' || e.historical_as_of) return false;
  return judgeEventQuality({
    variable: f.metric_name, before: f.before_value, after: f.after_value,
    unit: f.unit, evidence_text: f.source_quote,
  }) === 'sentence';
}

const rankOf = (f: EvidenceFact) => ({
  value_type: 'ACTUAL' as const, before: f.before_value, after: f.after_value ?? f.value,
  source: f.source_name, confidence: f.confidence, quality: f.evidence_quality,
});

/** The best reported fact per variable within one period — picked with the
 *  SAME comparator the board uses, so the row and its comparison can never
 *  show two different figures for one quarter. */
function actualsIn(p: PeriodRecord): Map<VarKey, EvidenceFact> {
  const m = new Map<VarKey, EvidenceFact>();
  for (const f of p.facts || []) {
    if (!usableActual(f, p.reporting_period)) continue;
    const o = m.get(f.metric_name);
    if (!o || betterReading(rankOf(f), rankOf(o)) < 0) m.set(f.metric_name, f);
  }
  return m;
}

/** The best forward statement per variable within one period — including a
 *  "fact" whose own sentence speaks of the future. */
function forwardsIn(p: PeriodRecord): Map<VarKey, EvidenceFact> {
  const m = new Map<VarKey, EvidenceFact>();
  for (const f of p.facts || []) {
    if (!String(f.value || '').trim()) continue;
    const vt = f.fact_or_management_statement === 'GUIDANCE' || f.fact_or_management_statement === 'TARGET'
      ? f.fact_or_management_statement
      : f.fact_or_management_statement === 'FACT' && asEvent(f, p.reporting_period).value_type === 'GUIDANCE' ? 'GUIDANCE' : null;
    if (!vt) continue;
    if (!m.has(f.metric_name)) m.set(f.metric_name, vt === f.fact_or_management_statement ? f : { ...f, fact_or_management_statement: vt });
  }
  return m;
}

function describe(c: MetricComparison): string {
  const L = c.label;
  const cur = c.current?.raw ?? null;
  switch (c.change_type) {
    case 'NOT_DISCLOSED':
      return `${L} was ${c.previous?.raw} in ${c.previous_period} and is not disclosed in ${c.current_period ?? 'this period'}. `
        + 'A company that stops disclosing a figure has told you something.';
    case 'NOT_COMPARABLE':
      return `${L} ${cur}${c.current_period ? ` (${c.current_period})` : ''}. ${c.previous_period || 'An earlier statement'} stated ${c.previous?.raw}, in a different unit — the two are not subtracted.`;
    case 'NEW':
      return `${L} ${cur}. First figure on file — previous: NOT DISCLOSED.`;
    case 'NEWLY_DISCLOSED':
      return `${L} ${cur}. Disclosed for the first time; earlier periods on file are silent — previous: NOT DISCLOSED.`;
    case 'REITERATED':
      return `${L} ${cur} — MAINTAINED, repeated unchanged from ${c.previous_period}.`;
    case 'UNCHANGED':
      return `${L} ${c.previous?.raw} → ${cur} · unchanged ${BASIS_LABEL[c.basis]}.`;
    default:
      if (c.guidance_move && c.guidance_move !== 'NOT_COMPARABLE') {
        return `${L} ${c.guidance_move.toLowerCase()}: ${c.previous?.raw}${c.previous_period ? ` (${c.previous_period})` : ''} → ${cur}${c.current_period ? ` (${c.current_period})` : ''}.`;
      }
      return `${L} ${c.previous?.raw} → ${cur}`
        + `${c.change ? ` · ${c.change}` : ''}`
        + `${c.change_relative ? ` (${c.change_relative})` : ''}`
        + ` · ${BASIS_LABEL[c.basis]}.`;
  }
}

/** A before→after the document states inside one sentence, when it is a real
 *  comparison: same measure, a figure on both sides, and NOT two statements
 *  of one period. "Q4 FY26: 59 days → 59 days by Q4 FY26" (ENTERO) is the
 *  same period twice — a duplicate, never "+0%". (zzz770) */
function innerPrior(f: EvidenceFact, curQ: Quantity): Quantity | null {
  const innerPrev = quantity(f.before_value, f.unit);
  if (!innerPrev || !f.after_value) return null;
  if (samePeriodPair(f.before_value, f.after_value)) return null;
  if (innerPrev.value != null && curQ.value != null && innerPrev.value === curQ.value) return null;
  const c = comparability(
    { key: f.metric_name, value: innerPrev.raw, unit: f.unit, quote: f.source_quote, period: null },
    { key: f.metric_name, value: curQ.raw, unit: f.unit, quote: f.source_quote, period: null },
  );
  // The unit rule is the engine's; the scope rule does not apply to two sides
  // of one sentence, which share their scope by construction.
  if (!c.comparable && !/scope|plant|segment|basis|definition/.test(String(c.reason))) return null;
  if (!c.comparable && !sameUnit(innerPrev.raw, curQ.raw, f.unit, f.unit)) return null;
  return innerPrev;
}

/**
 * Walk the whole ledger and produce one comparison per variable.
 *
 * The join is: for the latest period's figure, find the most recent EARLIER
 * period that holds a usable figure for the same variable. Not "the previous
 * period" — a company that disclosed utilisation in Q1 and Q3 and not Q2 has
 * a real Q1→Q3 comparison, and the basis says SINCE_LAST_DISCLOSURE so the
 * reader knows the gap.
 */
export function buildComparisons(ledger: CompanyLedger | null | undefined): Partial<Record<VarKey, MetricComparison>> {
  const out: Partial<Record<VarKey, MetricComparison>> = {};
  if (!ledger || !ledger.periods) return out;
  const ordered = Object.keys(ledger.periods).sort((a, b) => periodOrdinal(a) - periodOrdinal(b));
  if (!ordered.length) return out;
  const to = ordered[ordered.length - 1];
  const cur = ledger.periods[to];
  if (!cur) return out;

  const curActuals = actualsIn(cur);
  const curForward = forwardsIn(cur);
  const earlier = ordered.slice(0, -1);

  /** The most recent earlier period holding a usable figure for `k`. */
  const priorActual = (k: VarKey): { fact: EvidenceFact; period: string } | null => {
    for (let i = earlier.length - 1; i >= 0; i--) {
      const p = ledger.periods[earlier[i]];
      if (!p) continue;
      const f = actualsIn(p).get(k);
      if (f) return { fact: f, period: earlier[i] };
    }
    return null;
  };
  const priorForward = (k: VarKey): { fact: EvidenceFact; period: string } | null => {
    for (let i = earlier.length - 1; i >= 0; i--) {
      const p = ledger.periods[earlier[i]];
      if (!p) continue;
      const f = forwardsIn(p).get(k);
      if (f) return { fact: f, period: earlier[i] };
    }
    return null;
  };

  const put = (c: MetricComparison) => { out[c.key] = { ...c, line: describe(c), display: displayOf(c) }; };

  // ── 1. Variables with a figure in the CURRENT period. ────────────────────
  for (const [k, f] of curActuals) {
    const curQ = quantity(f.value, f.unit);
    if (!curQ) continue;
    const prior = priorActual(k);
    const fwdNow = curForward.get(k);
    const promised = priorForward(k);
    const base: MetricComparison = {
      key: k,
      label: VAR_LABEL[k] || k,
      current: curQ,
      current_period: to,
      previous: null,
      previous_period: null,
      change: null,
      change_relative: null,
      change_type: 'NEW',
      basis: 'NONE',
      direction: verifiedDirection({
        before: f.before_value, after: f.after_value,
        direction: f.direction, evidence_text: f.source_quote, unit: f.unit,
      }),
      cause: extractCause(f.source_quote, f.source_name),
      forward: fwdNow
        ? {
          value: String(fwdNow.value),
          kind: fwdNow.fact_or_management_statement === 'GUIDANCE' ? 'GUIDANCE' : 'TARGET',
          by: fwdNow.source_date || null,
          source: fwdNow.source_name,
        }
        : null,
      promised: promised
        ? {
          value: String(promised.fact.value),
          kind: promised.fact.fact_or_management_statement === 'GUIDANCE' ? 'GUIDANCE' : 'TARGET',
          period: promised.period,
          by: promised.fact.source_date || null,
        }
        : null,
      line: '',
      evidence: f.source_quote,
      source: f.source_name,
      fact_type: typeOfFact(f, to),
      comparability: null,
      lineage: { current: lineageOf({ ...f, period: to }, cur.documents), previous: null },
    };

    if (prior) {
      const prevQ = quantity(prior.fact.value, prior.fact.unit);
      if (prevQ) {
        // Rule 2 (zzz770): the comparability engine decides whether a delta
        // may exist at all — same metric, unit (normalised only where exact),
        // scope (plant / project / phase / segment), basis, definition, and a
        // different period. Anything else is NOT COMPARABLE, with the reason.
        const comp = comparability(comparableOf(prior.fact, prior.period, 'ACTUAL'), comparableOf(f, to, 'ACTUAL'));
        const prevLineage = lineageOf({ ...prior.fact, period: prior.period }, ledger.periods[prior.period]?.documents);
        if (comp.same_period) {
          // One period stated in two ledger periods: a duplicate, kept as
          // corroboration of the same figure, never a change.
          put({ ...base, change_type: earlier.length ? 'NEWLY_DISCLOSED' : 'NEW',
            comparability: { comparable: false, reason: comp.reason, conversion_method: null },
            lineage: { current: base.lineage?.current ?? null, previous: prevLineage } });
          continue;
        }
        if (!comp.comparable) {
          put({ ...base, previous: prevQ, previous_period: prior.period, change_type: 'NOT_COMPARABLE', basis: basisFor(prior.period, to), direction: 'unknown',
            comparability: { comparable: false, reason: comp.reason, conversion_method: null },
            lineage: { current: base.lineage?.current ?? null, previous: prevLineage } });
          continue;
        }
        const ch = changeOf(prevQ, curQ, comp.prev_norm, comp.cur_norm);
        const same = prevQ.raw.trim().toLowerCase() === curQ.raw.trim().toLowerCase();
        put({
          ...base,
          previous: prevQ, previous_period: prior.period,
          change: ch.change, change_relative: ch.relative,
          change_type: same || ch.direction === 'flat' ? 'UNCHANGED' : ch.direction === 'up' ? 'INCREASED' : ch.direction === 'down' ? 'DECREASED' : 'NOT_COMPARABLE',
          basis: basisFor(prior.period, to),
          direction: ch.direction === 'unknown' ? base.direction : ch.direction,
          comparability: { comparable: true, reason: null, conversion_method: comp.conversion_method },
          lineage: { current: base.lineage?.current ?? null, previous: prevLineage },
        });
        continue;
      }
    }

    // No prior figure anywhere. Rule 1: say NOT DISCLOSED, invent nothing.
    // Distinguish "nothing before this" from "earlier periods exist and were
    // silent" — the second is a disclosure event in its own right.
    if (earlier.length) {
      // The document may still state its own before→after inside one sentence.
      const innerPrev = innerPrior(f, curQ);
      if (innerPrev) {
        const ch = changeOf(innerPrev, curQ, normalizeValue(innerPrev.raw, f.unit), normalizeValue(curQ.raw, f.unit));
        put({
          ...base, previous: innerPrev, previous_period: null,
          change: ch.change, change_relative: ch.relative,
          basis: 'WITHIN_DOCUMENT',
          change_type: ch.direction === 'flat' ? 'UNCHANGED' : ch.direction === 'up' ? 'INCREASED' : ch.direction === 'down' ? 'DECREASED' : 'NOT_COMPARABLE',
          direction: ch.direction === 'unknown' ? base.direction : ch.direction,
        });
        continue;
      }
      put({ ...base, change_type: 'NEWLY_DISCLOSED' });
      continue;
    }
    const innerPrev = innerPrior(f, curQ);
    if (innerPrev) {
      const ch = changeOf(innerPrev, curQ, normalizeValue(innerPrev.raw, f.unit), normalizeValue(curQ.raw, f.unit));
      put({
        ...base, previous: innerPrev, previous_period: null,
        change: ch.change, change_relative: ch.relative, basis: 'WITHIN_DOCUMENT',
        change_type: ch.direction === 'flat' ? 'UNCHANGED' : ch.direction === 'up' ? 'INCREASED' : ch.direction === 'down' ? 'DECREASED' : 'NOT_COMPARABLE',
        direction: ch.direction === 'unknown' ? base.direction : ch.direction,
      });
      continue;
    }
    put(base);
  }

  // ── 2. Variables disclosed BEFORE and silent now. ────────────────────────
  //
  // This is the half that no amount of reading the current filing can find,
  // and it is the half that matters most: a company that disclosed utilisation
  // for four quarters and stops has made a decision.
  const seen = new Set(curActuals.keys());
  for (let i = earlier.length - 1; i >= 0; i--) {
    const p = ledger.periods[earlier[i]];
    if (!p) continue;
    for (const [k, f] of actualsIn(p)) {
      if (seen.has(k) || out[k]) continue;
      seen.add(k);
      const prevQ = quantity(f.value, f.unit);
      if (!prevQ) continue;
      put({
        key: k, label: VAR_LABEL[k] || k,
        current: null, current_period: to,
        previous: prevQ, previous_period: earlier[i],
        change: null, change_relative: null,
        change_type: 'NOT_DISCLOSED',
        basis: basisFor(earlier[i], to),
        direction: 'unknown',
        cause: null,
        forward: curForward.get(k)
          ? {
            value: String(curForward.get(k)!.value),
            kind: curForward.get(k)!.fact_or_management_statement === 'GUIDANCE' ? 'GUIDANCE' : 'TARGET',
            by: curForward.get(k)!.source_date || null,
            source: curForward.get(k)!.source_name,
          }
          : null,
        promised: null,
        line: '', evidence: f.source_quote, source: f.source_name,
        fact_type: null,
        comparability: null,
        lineage: { current: null, previous: lineageOf({ ...f, period: earlier[i] }, p.documents) },
      });
    }
  }

  // ── 3. Guidance that was repeated. ──────────────────────────────────────
  //
  // A target restated unchanged is not nothing — it is management declining to
  // move, which is exactly what the promise ledger grades next year.
  for (const [k, f] of curForward) {
    if (out[k]) continue;
    const prior = priorForward(k);
    const curQ = quantity(f.value, f.unit);
    if (!curQ) continue;
    const prevQ = prior ? quantity(prior.fact.value, prior.fact.unit) : null;
    const repeated = !!prevQ && prevQ.raw.trim().toLowerCase() === curQ.raw.trim().toLowerCase();
    // Two forward statements are one guidance moving only when they measure
    // the same thing: GPPL's "2 → 5 million MT liquid cargo" and "260–270k
    // RoRo cars" are two plans, never a revision of one. (zzz770)
    const fwdType = (x: EvidenceFact): FactType => x.fact_or_management_statement === 'TARGET' ? 'MANAGEMENT_TARGET' : 'MANAGEMENT_GUIDANCE';
    const fwdCmp = prior && prevQ && !repeated
      ? comparability({ ...comparableOf(prior.fact, prior.period, fwdType(prior.fact)), fact_type: 'MANAGEMENT_GUIDANCE' }, { ...comparableOf(f, to, fwdType(f)), fact_type: 'MANAGEMENT_GUIDANCE' })
      : null;
    put({
      key: k, label: VAR_LABEL[k] || k,
      current: curQ, current_period: to,
      previous: prevQ, previous_period: prior?.period || null,
      change: null, change_relative: null,
      change_type: repeated ? 'REITERATED' : prevQ ? 'INCREASED' : 'NEW',
      basis: prior ? basisFor(prior.period, to) : 'NONE',
      direction: 'unknown',
      cause: extractCause(f.source_quote, f.source_name),
      forward: {
        value: String(f.value),
        kind: f.fact_or_management_statement === 'GUIDANCE' ? 'GUIDANCE' : 'TARGET',
        by: f.source_date || null, source: f.source_name,
      },
      promised: prior
        ? {
          value: String(prior.fact.value),
          kind: prior.fact.fact_or_management_statement === 'GUIDANCE' ? 'GUIDANCE' : 'TARGET',
          period: prior.period, by: prior.fact.source_date || null,
        }
        : null,
      line: '', evidence: f.source_quote, source: f.source_name,
      fact_type: fwdType(f),
      comparability: fwdCmp ? { comparable: fwdCmp.comparable, reason: fwdCmp.reason, conversion_method: fwdCmp.conversion_method } : null,
      lineage: {
        current: lineageOf({ ...f, period: to }, cur.documents),
        previous: prior ? lineageOf({ ...prior.fact, period: prior.period }, ledger.periods[prior.period]?.documents) : null,
      },
    });
    // A non-repeated forward statement is not an "increase" unless the numbers
    // say so. Correct it with the arithmetic where both sides parse.
    const c = out[k]!;
    if (fwdCmp && !fwdCmp.comparable) {
      out[k] = { ...c, guidance_move: 'NOT_COMPARABLE', change_type: 'NOT_COMPARABLE', direction: 'unknown' };
      out[k]!.line = describe(out[k]!);
      out[k]!.display = displayOf(out[k]!);
    } else if (prevQ && !repeated) {
      // A guidance RANGE is compared as a range: "20–25% → 25–30%" is RAISED
      // by its midpoint, not "+25%" off the first number. (zzz765)
      const gm = guidanceMove(prevQ.raw, curQ.raw);
      if (gm !== 'NOT_COMPARABLE') {
        out[k] = {
          ...c, guidance_move: gm,
          change_type: gm === 'MAINTAINED' ? 'REITERATED' : gm === 'RAISED' ? 'INCREASED' : gm === 'LOWERED' ? 'DECREASED' : 'NOT_COMPARABLE',
          direction: gm === 'RAISED' ? 'up' : gm === 'LOWERED' ? 'down' : gm === 'MAINTAINED' ? 'flat' : 'unknown',
        };
      } else {
        const ch = changeBetween(prevQ, curQ);
        out[k] = {
          ...c,
          change: ch.change, change_relative: ch.relative,
          change_type: ch.direction === 'flat' ? 'REITERATED' : ch.direction === 'up' ? 'INCREASED' : ch.direction === 'down' ? 'DECREASED' : 'NEW',
          direction: ch.direction,
        };
      }
      out[k]!.line = describe(out[k]!);
      out[k]!.display = displayOf(out[k]!);
    } else if (repeated) {
      out[k] = { ...c, guidance_move: 'MAINTAINED' };
    }
  }

  // ── 4. The full history rides with every comparison. ───────────────────
  for (const k of Object.keys(out) as VarKey[]) {
    const c = out[k]!;
    c.series = metricSeries(ledger, k);
  }
  return out;
}

/** The printed form the owner asked for: "68% → 74% · +6pp", "59 days → 59
 *  days · unchanged", "74% · prior comparable value not disclosed". */
export function displayOf(c: MetricComparison): string {
  const cur = c.current?.raw ?? null;
  const p = c.previous_period ? ` (${c.previous_period})` : '';
  switch (c.change_type) {
    case 'NOT_DISCLOSED': return `${c.previous?.raw}${p} → not disclosed${c.current_period ? ` (${c.current_period})` : ''}`;
    case 'NOT_COMPARABLE': return `${cur ?? ''} · NOT COMPARABLE${c.previous ? ` with ${c.previous.raw}${p}` : ''}${c.comparability?.reason ? ` — ${c.comparability.reason}` : ''}`;
    case 'NEW': case 'NEWLY_DISCLOSED': return `${cur ?? ''} · ${PRIOR_NOT_DISCLOSED}`;
    case 'REITERATED': return `${cur ?? ''} · maintained${c.previous_period ? ` since ${c.previous_period}` : ''}`;
    case 'UNCHANGED': return `${c.previous?.raw ?? ''}${p} → ${cur ?? ''} · unchanged`;
    default:
      if (c.guidance_move && c.guidance_move !== 'NOT_COMPARABLE') return `${c.previous?.raw ?? ''}${p} → ${cur ?? ''} · ${c.guidance_move.toLowerCase()}`;
      return `${c.previous?.raw ?? ''}${p} → ${cur ?? ''}${c.change ? ` · ${c.change}` : ''}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE TIME SERIES — EVERY PERIOD, INCLUDING THE SILENT ONES.         (zzz770)
//
// "65% → 70% → 70% → not disclosed". A period on file with no figure for the
// metric is NOT DISCLOSED — never zero, never a decline. Consecutive disclosed
// points get a delta only when the comparability engine passes them.
// ═══════════════════════════════════════════════════════════════════════════

export interface SeriesPoint {
  period: string;
  status: 'DISCLOSED' | 'NOT_DISCLOSED';
  value: string | null;
  normalized: NormalizedValue | null;
  fact_type: FactType | null;
  lineage: Lineage | null;
  /** Change from the previous DISCLOSED point, when comparable. */
  change_from_prior: string | null;
  comparable_with_prior: boolean | null;
  reason: string | null;
}

export interface MetricSeries {
  key: VarKey;
  label: string;
  points: SeriesPoint[];
  /** "65% (Q1 FY26) → 70% (Q2 FY26) → 70% (Q3 FY26) → not disclosed (Q4 FY26)". */
  display: string;
  /** Over the disclosed, comparable points. The latest period silent is its
   *  own state, never a direction. */
  trend: 'UP' | 'DOWN' | 'FLAT' | 'MIXED' | 'SINGLE' | 'NOT_DISCLOSED' | 'NONE';
}

export function metricSeries(ledger: CompanyLedger | null | undefined, key: VarKey): MetricSeries {
  const label = VAR_LABEL[key] || key;
  const empty: MetricSeries = { key, label, points: [], display: '', trend: 'NONE' };
  if (!ledger?.periods) return empty;
  const ordered = Object.keys(ledger.periods).sort((a, b) => periodOrdinal(a) - periodOrdinal(b));
  const points: SeriesPoint[] = [];
  let lastDisclosed: { f: EvidenceFact; period: string } | null = null;
  const dirs: Array<'up' | 'down' | 'flat'> = [];
  for (const period of ordered) {
    const p = ledger.periods[period];
    const f = p ? actualsIn(p).get(key) : undefined;
    if (!f) {
      points.push({ period, status: 'NOT_DISCLOSED', value: null, normalized: null, fact_type: null, lineage: null, change_from_prior: null, comparable_with_prior: null, reason: null });
      continue;
    }
    let change: string | null = null, comparable: boolean | null = null, reason: string | null = null;
    if (lastDisclosed) {
      const c = comparability(comparableOf(lastDisclosed.f, lastDisclosed.period, 'ACTUAL'), comparableOf(f, period, 'ACTUAL'));
      comparable = c.comparable; reason = c.reason;
      if (c.comparable) {
        const d = deltaText(c.prev_norm!, c.cur_norm!);
        change = d.text;
        if (d.direction !== 'unknown') dirs.push(d.direction);
      }
    }
    points.push({ period, status: 'DISCLOSED', value: String(f.value), normalized: normalizeValue(f.value, f.unit), fact_type: typeOfFact(f, period),
      lineage: lineageOf({ ...f, period }, p!.documents), change_from_prior: change, comparable_with_prior: comparable, reason });
    lastDisclosed = { f, period };
  }
  if (!points.some((x) => x.status === 'DISCLOSED')) return { ...empty, points, display: points.map((x) => `not disclosed (${x.period})`).join(' → ') };
  const display = points.map((x) => (x.status === 'DISCLOSED' ? `${x.value} (${x.period})` : `not disclosed (${x.period})`)).join(' → ');
  const latest = points[points.length - 1];
  const trend: MetricSeries['trend'] = latest.status === 'NOT_DISCLOSED' ? 'NOT_DISCLOSED'
    : !dirs.length ? 'SINGLE'
      : dirs.every((d) => d === 'flat') ? 'FLAT'
        : dirs.every((d) => d !== 'down') ? 'UP'
          : dirs.every((d) => d !== 'up') ? 'DOWN' : 'MIXED';
  return { key, label, points, display, trend };
}

/** How many periods of history this ledger actually holds. The card needs it
 *  to say "first read — comparisons begin next quarter" honestly. */
export function historyDepth(ledger: CompanyLedger | null | undefined): { periods: string[]; depth: number } {
  const periods = ledger?.periods
    ? Object.keys(ledger.periods).sort((a, b) => periodOrdinal(a) - periodOrdinal(b))
    : [];
  return { periods, depth: periods.length };
}
