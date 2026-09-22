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
import { judgeEventQuality, verifiedDirection } from './evidence-extract';

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
  /** A forward statement for this same variable in the CURRENT period. */
  forward: { value: string; kind: 'GUIDANCE' | 'TARGET'; by: string | null; source: string } | null;
  /** A forward statement made in an EARLIER period about this variable, so a
   *  promise can be read beside the actual that was meant to fulfil it. */
  promised: { value: string; kind: 'GUIDANCE' | 'TARGET'; period: string; by: string | null } | null;
  /** One sentence, assembled from the fields above. Nothing new is asserted. */
  line: string;
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

const CONF_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** A fact is usable as a COMPARABLE figure only when it is a reported fact
 *  from a real sentence that fits its variable. Charts and wrong-unit values
 *  stay in the ledger for audit and are refused here. */
function usableActual(f: EvidenceFact): boolean {
  if (f.fact_or_management_statement !== 'FACT') return false;
  if (!String(f.value || '').trim()) return false;
  return judgeEventQuality({
    variable: f.metric_name, before: f.before_value, after: f.after_value,
    unit: f.unit, evidence_text: f.source_quote,
  }) === 'sentence';
}

/** The best reported fact per variable within one period. */
function actualsIn(p: PeriodRecord): Map<VarKey, EvidenceFact> {
  const m = new Map<VarKey, EvidenceFact>();
  for (const f of p.facts || []) {
    if (!usableActual(f)) continue;
    const o = m.get(f.metric_name);
    if (!o || CONF_RANK[f.confidence] < CONF_RANK[o.confidence]) m.set(f.metric_name, f);
  }
  return m;
}

/** The best forward statement per variable within one period. */
function forwardsIn(p: PeriodRecord): Map<VarKey, EvidenceFact> {
  const m = new Map<VarKey, EvidenceFact>();
  for (const f of p.facts || []) {
    if (f.fact_or_management_statement !== 'GUIDANCE' && f.fact_or_management_statement !== 'TARGET') continue;
    if (!String(f.value || '').trim()) continue;
    if (!m.has(f.metric_name)) m.set(f.metric_name, f);
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
      return `${L} ${cur} (${c.current_period}). ${c.previous_period} stated ${c.previous?.raw}, in a different unit — the two are not subtracted.`;
    case 'NEW':
      return `${L} ${cur}. First figure on file — previous: NOT DISCLOSED.`;
    case 'NEWLY_DISCLOSED':
      return `${L} ${cur}. Disclosed for the first time; earlier periods on file are silent — previous: NOT DISCLOSED.`;
    case 'REITERATED':
      return `${L} ${cur} — repeated unchanged from ${c.previous_period}.`;
    case 'UNCHANGED':
      return `${L} ${c.previous?.raw} → ${cur} · unchanged ${BASIS_LABEL[c.basis]}.`;
    default:
      return `${L} ${c.previous?.raw} → ${cur}`
        + `${c.change ? ` · ${c.change}` : ''}`
        + `${c.change_relative ? ` (${c.change_relative})` : ''}`
        + ` · ${BASIS_LABEL[c.basis]}.`;
  }
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

  const put = (c: MetricComparison) => { out[c.key] = { ...c, line: describe(c) }; };

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
    };

    if (prior) {
      const prevQ = quantity(prior.fact.value, prior.fact.unit);
      if (prevQ) {
        // Rule 2: the units decide whether a delta may exist at all.
        if (!sameUnit(prevQ.raw, curQ.raw, prior.fact.unit, f.unit)) {
          put({ ...base, previous: prevQ, previous_period: prior.period, change_type: 'NOT_COMPARABLE', basis: basisFor(prior.period, to), direction: 'unknown' });
          continue;
        }
        const ch = changeBetween(prevQ, curQ);
        const same = prevQ.raw.trim().toLowerCase() === curQ.raw.trim().toLowerCase();
        put({
          ...base,
          previous: prevQ, previous_period: prior.period,
          change: ch.change, change_relative: ch.relative,
          change_type: same || ch.direction === 'flat' ? 'UNCHANGED' : ch.direction === 'up' ? 'INCREASED' : 'DECREASED',
          basis: basisFor(prior.period, to),
          direction: ch.direction === 'unknown' ? base.direction : ch.direction,
        });
        continue;
      }
    }

    // No prior figure anywhere. Rule 1: say NOT DISCLOSED, invent nothing.
    // Distinguish "nothing before this" from "earlier periods exist and were
    // silent" — the second is a disclosure event in its own right.
    if (earlier.length) {
      // The document may still state its own before→after inside one sentence.
      const innerPrev = quantity(f.before_value, f.unit);
      if (innerPrev && f.after_value && sameUnit(innerPrev.raw, curQ.raw, f.unit, f.unit)) {
        const ch = changeBetween(innerPrev, curQ);
        put({
          ...base, previous: innerPrev, previous_period: null,
          change: ch.change, change_relative: ch.relative,
          basis: 'WITHIN_DOCUMENT',
          change_type: ch.direction === 'flat' ? 'UNCHANGED' : ch.direction === 'up' ? 'INCREASED' : 'DECREASED',
          direction: ch.direction === 'unknown' ? base.direction : ch.direction,
        });
        continue;
      }
      put({ ...base, change_type: 'NEWLY_DISCLOSED' });
      continue;
    }
    const innerPrev = quantity(f.before_value, f.unit);
    if (innerPrev && f.after_value && sameUnit(innerPrev.raw, curQ.raw, f.unit, f.unit)) {
      const ch = changeBetween(innerPrev, curQ);
      put({
        ...base, previous: innerPrev, previous_period: null,
        change: ch.change, change_relative: ch.relative, basis: 'WITHIN_DOCUMENT',
        change_type: ch.direction === 'flat' ? 'UNCHANGED' : ch.direction === 'up' ? 'INCREASED' : 'DECREASED',
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
    });
    // A non-repeated forward statement is not an "increase" unless the numbers
    // say so. Correct it with the arithmetic where both sides parse.
    const c = out[k]!;
    if (prevQ && !repeated) {
      const ch = changeBetween(prevQ, curQ);
      out[k] = {
        ...c,
        change: ch.change, change_relative: ch.relative,
        change_type: ch.direction === 'flat' ? 'REITERATED' : ch.direction === 'up' ? 'INCREASED' : ch.direction === 'down' ? 'DECREASED' : 'NEW',
        direction: ch.direction,
      };
      out[k]!.line = describe(out[k]!);
    }
  }

  return out;
}

/** How many periods of history this ledger actually holds. The card needs it
 *  to say "first read — comparisons begin next quarter" honestly. */
export function historyDepth(ledger: CompanyLedger | null | undefined): { periods: string[]; depth: number } {
  const periods = ledger?.periods
    ? Object.keys(ledger.periods).sort((a, b) => periodOrdinal(a) - periodOrdinal(b))
    : [];
  return { periods, depth: periods.length };
}
