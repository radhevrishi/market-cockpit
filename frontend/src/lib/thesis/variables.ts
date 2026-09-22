// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURAL VARIABLES — WHAT ACTUALLY CHANGED.                     (zzz715)
//
// From the owner's specification. The instruction that shapes every line of
// this file: "Don't store news. Store events + evidence + implication." And
// the harder one underneath it: "Separate facts from interpretation."
//
// So a structural variable is a BEFORE, an AFTER, and a source — never a
// sentiment, never a score, and never a number this module computed from a
// number the filing did not state. Where the filing gives one side only, the
// other side stays null and the variable says `unknown`. An unknown variable
// is a real answer: it is the difference between "utilisation did not improve"
// and "the company did not disclose utilisation", and collapsing those two
// into one is how an exit engine ends up firing on silence.
//
// TWO EVIDENCE LEVELS, NEVER MIXED:
//
//   · GRADER   — the numbers the earnings engine computed from the filed
//                statements: revenue growth, earnings growth, OPM change,
//                cash conversion. Machine-read, no model involved.
//   · FILING   — the figure-verified `structured` object from the AI summary,
//                every number of which was checked against the document text
//                before it was allowed out of the route.
//
// Both are facts about a document. Nothing in this file is an inference about
// the future; that happens one layer up, in status.ts, and is labelled there.
// ═══════════════════════════════════════════════════════════════════════════

import {
  VAR_LABEL, VAR_GROUP, GRADER_AVAILABLE,
  type VarKey, type VarGroup, type EvidenceKind,
} from './taxonomy';

import { bestEventPerVariable, judgeEventQuality, valueFitsVariable, verifiedDirection, type StructuralEvent } from './evidence-extract';
import { scaledNumber, sameUnit } from './evidence-ledger';
import { BASIS_LABEL, type MetricComparison } from './comparison';

export { VAR_LABEL, VAR_GROUP, GRADER_AVAILABLE };
export type { VarKey, VarGroup, EvidenceKind };

// ── FIVE VERDICTS, NOT FOUR.                                       (zzz754)
//
// 'unknown' used to mean two different things: "nobody disclosed this" and
// "this was disclosed as a level with nothing to compare it to". The card
// drew the same hollow circle for both, so EXICOM's "order book INR1,400
// crores" and "utilisation 65%" — read, verified, on file — rendered as
// ○ Order book / ○ Capacity utilisation, and the status text listed them
// under "Missing". A figure the company stated is not missing.
//
//   stated  — disclosed, value shown, no comparison basis → neither
//             confirms nor contradicts; counted as disclosed, never as absent.
//   unknown — nothing on file for this variable.
export type VarVerdict = 'improving' | 'flat' | 'deteriorating' | 'stated' | 'unknown';
export type VarSource = 'grader' | 'filing';

export interface StructuralVar {
  key: VarKey;
  label: string;
  /** fact | claim | derived — the spec's hallucination firewall. A management
   *  target is a CLAIM about the future and must never read like a filed
   *  figure; operating leverage is DERIVED and must never read like something
   *  the company said. (zzz720) */
  kind?: EvidenceKind;
  /** As the source stated it. Strings, not numbers: "68%", "₹500 Cr", "2.1x". */
  before: string | null;
  after: string | null;
  /** The change, where the source stated both sides or stated the delta. */
  delta: string | null;
  verdict: VarVerdict;
  /** One line naming what was read and from where. Never a paraphrase of a
   *  conclusion — the fact itself. */
  evidence: string;
  source: VarSource;
  /** ── THE LONGITUDINAL JOIN.                                     (zzz758)
   *
   *  Non-null when the evidence ledger holds an earlier period carrying this
   *  same variable, so the row can print CURRENT → PREVIOUS → CHANGE with the
   *  comparison basis attached. Null where no earlier figure exists — and the
   *  card then says PREVIOUS: NOT DISCLOSED rather than inventing one. */
  comparison?: MetricComparison | null;
  /** ── TWO SOURCES, TWO NUMBERS.                                  (zzz759)
   *
   *  Non-null when another document read for the same period states a
   *  different value for this same variable. The more authoritative source
   *  supplies the row; the disagreement is never resolved silently, because a
   *  filing and a concall contradicting each other on a capacity is a fact
   *  about the disclosure, not a parsing detail. */
  conflict?: { value: string; source: string }[] | null;
}


const n = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** The AI-summary routes are instructed to write "not stated" rather than
 *  invent, so a placeholder is data — it means the document was silent. */
const PLACEHOLDER =
  /^(not\s+(stated|disclosed|quantified|available|applicable|given|provided)|n\/?a|none|unknown|—|-|nil)$/i;

export function said(v: unknown): boolean {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 && !PLACEHOLDER.test(s);
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10}%`;

/** Percent out of a stated string like "68%", "68.5 per cent", "82". */
function pctIn(s: unknown): number | null {
  if (!said(s)) return null;
  const m = String(s).match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Read every structural variable the two sources can support.
 *
 * `graded` is a row from the India or US earnings grader; `summary` is the
 * verified `structured` object from the AI summary route. Either may be null,
 * and the result is simply shorter — a holding with no filing read yet has a
 * thesis evaluated on grader numbers alone, and the UI says so rather than
 * pretending the evidence is complete.
 */
// ═══════════════════════════════════════════════════════════════════════════
// FROM TYPED EVENTS.                                                (zzz738)
//
// The events stage (lib/thesis/evidence-extract) returns facts that were
// validated against the document sentence they came from. They take
// precedence over the summary's loose fields for the same variable, for a
// reason that matters: an event carries its semantic type. A utilisation
// ACTUAL of 84% and a utilisation TARGET of 90% are both shown, and the
// verdict is computed from the actual alone — a card that let a target read
// as a filed figure would be wrong in the way that costs money.
// ═══════════════════════════════════════════════════════════════════════════

/** Variables where MORE is WORSE. A model reports "execution delay: up"
 *  meaning the delay grew; that is a deterioration, and TI's card printed it
 *  as "▲ Execution delay" in green. (zzz754) */
const NEGATIVE_VARS = new Set<VarKey>(['execution_delay', 'customer_loss', 'shutdown', 'capacity_bottleneck', 'supply_bottleneck', 'customer_concentration']);

/** "No explicit customer losses stated", "none", "no delays" — the summary
 *  put the company's denial into the field, and `said()` read a denial as a
 *  disclosure. A denial is a CHECKED, FLAT variable, not a deterioration. */
const DENIAL = /^(no|none|nil|not any|no explicit|no material|no significant|there (were|was|are|is) no|did not|does not|didn't|doesn't|without any)\b/i;
export const isDenial = (v: unknown): boolean => said(v) && DENIAL.test(String(v).trim());

const numIn = (s: string | null): number | null => {
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/** A stated change between two like-for-like figures, or null. Never
 *  derived across units, and never derived when either side is missing. */
function deltaOf(before: string | null, after: string | null): string | null {
  const b = numIn(before), a = numIn(after);
  if (b == null || a == null) return null;
  const pctBoth = /%/.test(before || '') && /%/.test(after || '');
  if (pctBoth) return `${a - b >= 0 ? '+' : ''}${(a - b).toFixed(0)}pp`;
  if (b === 0) return null;
  const g = ((a - b) / Math.abs(b)) * 100;
  return `${g >= 0 ? '+' : ''}${g.toFixed(0)}%`;
}

export function varsFromEvents(events: StructuralEvent[] | null | undefined): StructuralVar[] {
  if (!Array.isArray(events) || !events.length) return [];
  const out: StructuralVar[] = [];
  for (const [key, slot] of bestEventPerVariable(events)) {
    const a = slot.actual, f = slot.forward;
    const label = VAR_LABEL[key] || key;
    // Only disagreements between values that would BOTH have been shown count.
    // A wrong-unit reading losing to a good one is the filter working, not two
    // sources contradicting each other.
    const conflicts = (slot.conflicts || [])
      .filter((c) => judgeEventQuality(c) !== 'unit_mismatch')
      .map((c) => ({ value: String(c.after ?? c.before ?? ''), source: c.source }))
      .filter((c) => c.value.trim().length > 0)
      .slice(0, 3);
    // ── ABOVE NAMEPLATE IS POSSIBLE, AND WORTH A SECOND LOOK.       (zzz760)
    //
    // VAML carried "Capacity utilisation 120%". The 0–130% band stays as it is
    // — plants genuinely run above nameplate on extra shifts, and narrowing the
    // band would throw away GIPCL's real 19.89% CUF along with the bad ones. But
    // a figure over 100% is either a debottlenecked plant or a mis-read number,
    // and those are worth telling apart, so the row says which question to ask
    // instead of printing 120% as though it were ordinary.
    const utPct = key === 'utilisation' && a
      ? Number((`${a.after || a.before || ''}`.match(/-?\d+(?:\.\d+)?\s*%/) || [''])[0].replace('%', ''))
      : NaN;
    const overNameplate = Number.isFinite(utPct) && utPct > 100
      ? ` ⓘ Above 100% of nameplate. That is real when a plant runs extra shifts or has been de-bottlenecked, `
        + 'and it is also what a mis-read number looks like — check which before treating it as headroom exhausted.'
      : '';
    const conflictNote = conflicts.length
      ? ` ⚠ SOURCES DISAGREE — ${conflicts.map((c) => `${c.value} (${c.source})`).join('; ')}. `
        + 'The written document is shown; the other reading is kept here rather than discarded.'
      : '';
    // ── A VALUE THAT IS NOT ABOUT THIS VARIABLE IS NOT THIS VARIABLE'S
    //    VALUE.                                                     (zzz755)
    //
    // zzz754 stopped a wrong-unit fact from CONFIRMING, but still printed
    // it: the board showed "◐ Installed capacity ₹10,161 crores" on
    // REDINGTON and "◐ Capacity utilisation 4 to 6 months" on JINDRILL.
    // Marking a wrong number as unjudged does not make it less wrong. The
    // mis-filed actual is dropped here; the variable falls through to its
    // forward statement if it has one, and otherwise renders as an absence.
    // The event itself stays in the ledger for audit.
    const aOk = a && judgeEventQuality(a) !== 'unit_mismatch' ? a : null;
    if (aOk) {
      const a = aOk;
      const delta = deltaOf(a.before, a.after);
      // Re-judged on load, so ledgers written before a rule existed obey it.
      const quality = judgeEventQuality(a);
      const dir = verifiedDirection(a);
      const chart = quality === 'chart' || quality === 'unit_mismatch';
      // Only a FILED figure from a real sentence with a verifiable move may
      // confirm or contradict. A management claim ("3x capacity", "at
      // maximum level") is shown as what it is; a chart axis and a
      // wrong-unit value are shown as claims; a bare level is 'stated'.
      const mayJudge = a.value_type === 'ACTUAL' && !chart;
      const inverted = NEGATIVE_VARS.has(key);
      const verdict: VarVerdict = !mayJudge ? 'stated'
        : dir === 'up' ? (inverted ? 'deteriorating' : 'improving')
          : dir === 'down' ? (inverted ? 'improving' : 'deteriorating')
            : dir === 'flat' ? 'flat' : 'stated';
      out.push({
        key, label,
        kind: mayJudge ? 'fact' : 'claim',
        before: a.before, after: a.after, delta, verdict,
        evidence: (quality === 'unit_mismatch' ? 'Value does not fit this variable (wrong unit or no such statement) — shown as a claim only: '
          : chart ? 'Read from a chart, figures unlabelled — verify on the slide: '
            : a.value_type !== 'ACTUAL' ? `Management ${a.value_type === 'MANAGEMENT_CLAIM' ? 'claim' : a.value_type.toLowerCase()}, not a reported figure: `
              : verdict === 'stated' ? 'Level only — no earlier figure in the text to compare against: ' : '')
          + `${a.evidence_text.slice(0, 220)}${a.evidence_text.length > 220 ? '…' : ''}`
          + ` — ${a.source}${a.period ? `, ${a.period}` : ''}`
          + (f ? ` · ${f.value_type === 'GUIDANCE' ? 'Guidance' : 'Target'} ${f.after}${f.period ? ` (${f.period})` : ''}` : '')
          + overNameplate + conflictNote,
        conflict: conflicts.length ? conflicts : null,
        source: 'filing',
      });
    } else if (f && judgeEventQuality(f) !== 'unit_mismatch') {
      // ── A TARGET IS STILL SUBJECT TO THE UNIT RULES.             (zzz761)
      //
      // zzz755 dropped mis-filed ACTUALS and left this branch unguarded, so
      // the same junk walked back in through the forward door: JINDRILL
      // printed "◐ Capacity utilisation 4 to 6 months (guidance)" — a
      // refurbishment period — and VIJAYA "◐ Capacity utilisation breakeven
      // within 1 year (target)". Neither is a fill rate. A management target
      // for a variable has to be a plausible value OF that variable before it
      // is allowed to stand in for one.
      // A forward statement with no actual behind it is a claim, shown as
      // such — and the BOARD has to say so, not just the tooltip. AARTIPHARM
      // printed "◐ Capacity utilisation 80% plus" from a TARGET, which reads
      // as this quarter's fill rate. The type travels with the value. (zzz755)
      const tag = f.value_type === 'GUIDANCE' ? 'guidance' : 'target';
      out.push({
        key, label, kind: 'claim',
        before: null, after: `${f.after} (${tag})`, delta: null, verdict: 'stated',
        evidence: `${f.value_type === 'GUIDANCE' ? 'Guidance' : 'Management target'}: ${f.after}${f.period ? ` by ${f.period}` : ''}. `
          + `"${f.evidence_text.slice(0, 200)}${f.evidence_text.length > 200 ? '…' : ''}" — ${f.source}`,
        source: 'filing',
      });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE LONGITUDINAL UPGRADE.                                         (zzz758)
//
// A variable extracted from ONE document can only ever be a level: the filing
// says utilisation is 80% and the row says 80%, verdict `stated`, "no
// comparison basis". That was honest and it was also the ceiling — the board
// could never say 72% → 80% because nothing handed it last quarter's figure.
//
// `buildComparisons(ledger)` walks every period that has ever been read and
// finds the most recent EARLIER figure for the same variable. Where it finds
// one, the basis exists, and a level becomes a direction. Where it does not,
// the row is left exactly as it was — a level, marked as a level. That
// asymmetry is the whole guard against §75: a previous value appears on a
// card only when an earlier period record actually holds it.
// ═══════════════════════════════════════════════════════════════════════════

// ── AN INSTALLED CAPACITY IS NOT A CAPACITY ADDITION.              (zzz759)
//
// MOREPEN showed "Installed capacity 200 KLD" and "Capacity added 200 KLD" on
// the same card, from the same sentence. One sentence, filed twice under two
// names — and the second one is scored `improving` by default, so a level the
// company merely restated was counted as growth. Where the two carry the same
// value, the ADDITION is the one that goes: "capacity is 200 KLD" is the far
// more likely reading of a sentence that produced both, and a wrongly-claimed
// expansion is the more expensive of the two errors.
function dropRestatedCapacityAddition(vars: StructuralVar[]): StructuralVar[] {
  const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const installed = vars.find((v) => v.key === 'capacity');
  if (!installed) return vars;
  const inst = norm(installed.after || installed.before);
  if (!inst) return vars;
  return vars.filter((v) => !(v.key === 'capacity_addition' && norm(v.after || v.before) === inst));
}

/** Magnitude below which a move is noise rather than a direction. */
function movedEnough(c: MetricComparison): boolean {
  const s = c.change || '';
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return false;
  const v = Math.abs(Number(m[0]));
  return /pp$/i.test(s) ? v >= 1 : v >= 2;
}

export function applyComparisons(
  vars: StructuralVar[],
  comparisons: Partial<Record<VarKey, MetricComparison>> | null | undefined,
): StructuralVar[] {
  if (!comparisons) return vars;
  return vars.map((v) => {
    const c = comparisons[v.key];
    if (!c) return v;
    // A claim is never turned into a measured direction by a comparison: a
    // target restated is management repeating itself, not a business moving.
    const isFact = v.kind !== 'claim' && v.source === 'filing';
    const hasBasis = c.basis !== 'NONE'
      && (c.change_type === 'INCREASED' || c.change_type === 'DECREASED' || c.change_type === 'UNCHANGED');
    if (!isFact || !hasBasis || !c.previous) {
      return { ...v, comparison: c };
    }
    const inverted = NEGATIVE_VARS.has(v.key);
    const moved = movedEnough(c);
    const verdict: VarVerdict = !moved || c.direction === 'flat'
      ? 'flat'
      : c.direction === 'up' ? (inverted ? 'deteriorating' : 'improving')
        : c.direction === 'down' ? (inverted ? 'improving' : 'deteriorating')
          : v.verdict;
    return {
      ...v,
      comparison: c,
      // The BEFORE now comes from a period record, so it is printed — and the
      // period it came from is printed with it, because "previous" without a
      // date is the kind of number that quietly becomes a guess.
      before: v.before ?? c.previous.raw,
      delta: c.change ?? v.delta,
      verdict,
      kind: 'fact',
      evidence: `${c.previous.raw} (${c.previous_period}) → ${c.current?.raw ?? v.after ?? ''} (${c.current_period})`
        + `${c.change ? ` · ${c.change}` : ''}${c.change_relative ? ` (${c.change_relative})` : ''}`
        + ` · ${BASIS_LABEL[c.basis]}. `
        + (c.cause
          ? `Stated cause: ${c.cause.text} — ${c.cause.persistence === 'STRUCTURAL' ? 'STRUCTURAL' : c.cause.persistence === 'TEMPORARY' ? 'TEMPORARY' : 'PERSISTENCE UNCLASSIFIED'}. ${c.cause.persistence_because} `
          : 'CAUSE: not disclosed — the document states the change and gives no reason for it. ')
        + v.evidence,
    };
  });
}

export function extractVariables(
  graded: any | null,
  summary: any | null,
  comparisons?: Partial<Record<VarKey, MetricComparison>> | null,
): StructuralVar[] {
  const out: StructuralVar[] = [];
  // Typed events first. Any key they cover is not re-pushed from the
  // summary's loose fields below — one variable, one row, and the row with
  // the verbatim evidence wins.
  const fromEvents = varsFromEvents(summary?.events);
  const covered = new Set<VarKey>(fromEvents.map((v) => v.key));
  out.push(...fromEvents);

  // ── THE PRIOR THE SUMMARY ALREADY HELD.                          (zzz761)
  //
  // The events stage wins every key it covers, and that is right — the event
  // carries the verbatim sentence. But the summary's `utilisation` block has
  // its own `prior` field, and when the event captured only a level the prior
  // was being discarded along with the rest of the summary row. So a filing
  // that plainly said "utilisation rose from 72% to 80%" could still render as
  // a bare 80%. This recovers ONLY the before — the current value, verdict and
  // evidence stay the event's — and only when the event has no before of its
  // own. Nothing is invented: the figure comes from the same read document.
  const utBlock = summary?.utilisation || {};
  if (said(utBlock.prior)) {
    const row = out.find((v) => v.key === 'utilisation');
    if (row && !row.before && row.after && row.kind !== 'claim') {
      const b = String(utBlock.prior).trim();
      const d = deltaOf(b, row.after);
      const bn = numIn(b), an = numIn(row.after);
      const moved = bn != null && an != null ? an - bn : null;
      row.before = b;
      row.delta = row.delta || d;
      if (moved != null) {
        row.verdict = moved >= 2 ? 'improving' : moved > -2 ? 'flat' : 'deteriorating';
        row.evidence = `${b} → ${row.after}${d ? ` · ${d}` : ''} (both stated in the documents read). ${row.evidence}`;
      }
    }
  }
  const push = (v: StructuralVar) => {
    if (covered.has(v.key)) {
      // ── A LEVEL FROM THE FILING MUST NOT BEAT A BRIDGE FROM THE
      //    GRADER.                                                  (zzz758)
      //
      // AZAD's concall says "operating margin came in at 18.4%" — a level,
      // no prior, verdict `stated`. The graded row holds 15.9% AND 18.4%,
      // which is the same figure WITH the comparison the document omitted.
      // The event row won simply because events are read first, so the card
      // printed CONFIRMATION REQUIRED — "no comparison basis" — with the
      // basis sitting one field away. Where the filing stated only a level
      // and the grader has both sides, the grader's row replaces it and the
      // ledger comparison, if any, is carried across.
      const i = out.findIndex((x) => x.key === v.key);
      const cur = i >= 0 ? out[i] : null;
      const levelOnly = !!cur && GRADER_AVAILABLE.has(v.key)
        && cur.verdict === 'stated' && !cur.before && !cur.comparison?.previous;
      const hasBridge = v.verdict !== 'unknown' && !!(v.before || v.delta);
      if (levelOnly && hasBridge) out[i] = { ...v, comparison: cur!.comparison ?? null };
      return;
    }
    // ── THE SAME UNIT RULES THE EVENTS PATH ANSWERS TO.            (zzz762)
    //
    // A summary row is a model's reading of the same document, and it can be
    // mis-filed in exactly the same ways: a growth rate under utilisation
    // (REDINGTON "−14%", DEEPAKNTR ">175%"), a stock day-count under it (SFL
    // "30 days inventory"), a bare percentage as an answer to "is the capex
    // earning yet" (RATEGAIN "78.8%"). The row's own evidence line names the
    // variable, so the sentence tests pass; only a value that cannot BE that
    // variable is dropped, and the card then shows the hollow circle, which is
    // the truth: nothing usable was read for it.
    if (v.source === 'filing' && !valueFitsVariable({
      variable: v.key, before: v.before, after: v.after, unit: null, evidence_text: v.evidence,
    })) return;
    // A value with no comparison basis is DISCLOSED. It is not absent.
    const hasValue = !!(String(v.after || '').trim() || String(v.before || '').trim() || String(v.delta || '').trim());
    if (v.verdict === 'unknown' && hasValue) v = { ...v, verdict: 'stated' };
    // A STATED chip with nothing in it is worse than a hollow circle: it
    // claims a disclosure and shows none. TI printed exactly that. (zzz757)
    if (v.verdict === 'stated' && !hasValue) v = { ...v, verdict: 'unknown' };
    out.push(v);
  };

  // ── GRADER FACTS ────────────────────────────────────────────────────────
  const salesY = n(graded?.sales_yoy_pct);
  const epsY = n(graded?.eps_yoy_pct) ?? n(graded?.net_profit_yoy_pct);
  const opmChange = n(graded?.opm_change_pp) ?? n(graded?.opm_delta_pp);
  // The screener exports carry no YoY margin bridge — only this quarter's OPM
  // and last quarter's. That is a SEQUENTIAL change, and it answers a
  // different question from a year-on-year one (it carries seasonality that
  // YoY cancels). It is used where nothing better exists, and the evidence
  // line says "sequential" so the reader can discount it accordingly. (zzz716)
  const opmChangeQoq = n(graded?.opm_change_pp_qoq);
  const opm = n(graded?.opm_pct);
  // ── THE MARGIN BRIDGE THAT WAS SITTING THERE UNREAD.            (zzz719)
  //
  // The India bench carries `opm_pct` AND `opm_prev_pct` — a genuine
  // year-on-year margin change, two fields apart. This extractor only looked
  // for `opm_change_pp`, which the bench does not have, so EVERY graded
  // holding reported "○ Operating margin — not disclosed" while the number
  // needed to compute it was in the same row. Twelve holdings sat at EVIDENCE
  // INCOMPLETE waiting on a filing for a figure already in hand.
  const opmPrev = n(graded?.opm_prev_pct);
  const opmChangeYoy = opmChange ?? (opm != null && opmPrev != null
    ? Math.round((opm - opmPrev) * 10) / 10 : null);
  const sequentialOnly = opmChangeYoy == null && opmChangeQoq != null;
  const cfoToPat = n(graded?.cfo_to_pat_ratio) ?? n(graded?.ocf_to_pat_ratio);

  if (salesY != null) {
    push({
      key: 'revenue_growth', label: VAR_LABEL.revenue_growth,
      before: null, after: pct(salesY), delta: pct(salesY),
      // A threshold is a judgement about the NUMBER, not about the future, so
      // it belongs here. The cut-offs are the ones the A test already uses, so
      // the page and the classifier can never disagree about the same quarter.
      verdict: salesY >= 15 ? 'improving' : salesY >= 0 ? 'flat' : 'deteriorating',
      evidence: `Revenue ${pct(salesY)} YoY, from the filed statements.`,
      source: 'grader',
    });
  }
  if (epsY != null) {
    push({
      key: 'earnings_growth', label: VAR_LABEL.earnings_growth,
      before: null, after: pct(epsY), delta: pct(epsY),
      verdict: epsY >= 20 ? 'improving' : epsY >= 0 ? 'flat' : 'deteriorating',
      evidence: `Earnings ${pct(epsY)} YoY, from the filed statements.`,
      source: 'grader',
    });
  }

  // OPERATING LEVERAGE is the one computed variable here, and it is computed
  // from two filed numbers with no assumption in between: profit growing
  // faster than revenue IS operating leverage, arithmetically. The guard is
  // the same one the classifier uses — a ratio off a trivial revenue base is
  // noise, so below 1% growth the variable stays unknown rather than large.
  if (salesY != null && epsY != null) {
    if (salesY >= 1) {
      const r = epsY / salesY;
      push({
        key: 'operating_leverage', label: VAR_LABEL.operating_leverage,
        before: `revenue ${pct(salesY)}`, after: `earnings ${pct(epsY)}`,
        delta: `${(Math.round(r * 10) / 10).toFixed(1)}×`,
        verdict: r >= 1.5 ? 'improving' : r >= 1 ? 'flat' : 'deteriorating',
        evidence: r >= 1.5
          ? `Earnings grew ${r.toFixed(1)}× revenue — fixed costs are being absorbed.`
          : r >= 1
            ? `Earnings grew ${r.toFixed(1)}× revenue — profit is keeping pace, not pulling ahead.`
            : `Earnings grew slower than revenue (${r.toFixed(1)}×) — leverage is working against the P&L.`,
        source: 'grader',
      });
    } else {
      push({
        key: 'operating_leverage', label: VAR_LABEL.operating_leverage,
        before: null, after: null, delta: null, verdict: 'unknown',
        evidence: `Revenue moved ${pct(salesY)} — too small a base for a leverage ratio to mean anything.`,
        source: 'grader',
      });
    }
  }

  // ── MARGIN. The AI summary's bridge is preferred because it carries the
  //    REASON, which is the part that decides whether the change is structural.
  const mb = summary?.margin_bridge;
  // ── THE DELTA AND THE VERDICT MUST COME FROM THE SAME NUMBER.   (zzz755)
  //
  // AETHER printed "▼ Operating margin +1pp" — a red arrow beside a
  // positive number — because the DELTA was taken from the filing's
  // margin bridge while the VERDICT was computed from the grader's
  // year-on-year figure. TBZ printed the whole sentence "FY26: +4.46pp to
  // 11.18% (presentation); Q4: +6.51pp to 13.45%" in the delta slot, and
  // CUPID printed "+?pp" — a literal question mark the model wrote. A
  // bridge value is used only when it is a single clean pp figure.
  const mbRaw = said(mb?.opm_change_pp) ? String(mb.opm_change_pp).trim() : null;
  const mbDelta = mbRaw && /^[+-]?\d+(?:\.\d+)?\s*(pp|bps|bp|%)?$/i.test(mbRaw) ? mbRaw : null;
  const drivers: any[] = Array.isArray(mb?.drivers) ? mb.drivers : [];
  if (mbDelta || opmChangeYoy != null || opmChangeQoq != null || opm != null) {
    // One source decides BOTH. The grader's own year-on-year bridge wins
    // because it is arithmetic on filed statements; the model's bridge is
    // second; the sequential figure is last and is labelled as such.
    const dv = opmChangeYoy != null ? opmChangeYoy : (pctIn(mbDelta) ?? opmChangeQoq);
    const dvFromBridge = opmChangeYoy == null && pctIn(mbDelta) != null;
    const structural = drivers.filter((d) => d?.nature === 'structural').length;
    const cyclical = drivers.filter((d) => d?.nature === 'cyclical').length;
    const why = drivers.length
      ? ` Reason: ${drivers.map((d) => `${d?.detail} (${String(d?.nature || '').replace(/_/g, ' ')})`).join('; ')}.`
      : ' No reason disclosed — the change is a number without a mechanism.';
    push({
      key: 'margin', label: VAR_LABEL.margin,
      // The BEFORE is the prior margin where the source states it, never a
      // level minus a delta from a different comparison basis. The DELTA is
      // always populated when one exists: the card shows `delta || after`, so
      // a null delta made the chip print the LEVEL next to a verdict computed
      // from the CHANGE — "✕ Operating margin 10.5%", which reads as though
      // 10.5% itself were the bad news. (zzz719)
      before: opmPrev != null ? `${opmPrev.toFixed(1)}%` : null,
      after: opm != null ? `${opm.toFixed(1)}%` : null,
      delta: dvFromBridge
        ? mbDelta
        : (dv != null ? `${dv >= 0 ? '+' : ''}${dv.toFixed(1)}pp${sequentialOnly ? ' QoQ' : ''}` : null),
      verdict: dv == null ? 'unknown' : dv >= 1 ? 'improving' : dv > -1 ? 'flat' : 'deteriorating',
      evidence: `Operating margin ${opm != null ? `${opm.toFixed(1)}%` : ''}`
        + `${opmPrev != null ? ` (was ${opmPrev.toFixed(1)}%)` : ''}`
        + `${dv == null ? ' — change not quantified'
          : ` — ${dv >= 0 ? '+' : ''}${dv.toFixed(1)}pp${sequentialOnly
            ? ' vs last quarter (sequential — no year-on-year bridge available, so seasonality is not cancelled)'
            : ' year on year'}`}.${why}`
        + (structural || cyclical ? ` (${structural} structural, ${cyclical} cyclical.)` : ''),
      source: drivers.length ? 'filing' : 'grader',
    });
  }

  if (cfoToPat != null) {
    // ── A NEGATIVE RATIO DOES NOT MEAN BAD CASH.                  (zzz719)
    //
    // CFO/PAT goes negative when EITHER side is negative, and the two mean
    // opposite things: negative cash against positive profit is the warning,
    // while positive cash against a LOSS is the company funding itself
    // through a bad quarter — often the best news in the filing. The live
    // page showed "✕ Cash conversion −21.30×" on TI and "−7.84×" on E2E and
    // counted both against the thesis without knowing which case it was.
    //
    // This is the same sign-inversion that made the profit-leak flag fire on
    // Raymond at PAT −99%. Where the numerator's sign cannot be established
    // the variable is UNKNOWN, which costs nothing, rather than a guess that
    // could push a holding onto the exit radar for the wrong reason.
    const patSign = n(graded?.pat_curr_cr) ?? n(graded?.net_income_curr_musd)
      ?? n(graded?.profit_after_tax_latest_quarter);
    const negative = cfoToPat < 0;
    const lossMaking = patSign != null && patSign < 0;
    // The screener's "CFO to PAT" is LAST FULL YEAR's cash flow over last
    // full year's profit — an annual figure sitting on a card about this
    // quarter, and its sign is being checked against the latest QUARTER's
    // profit. Both are said on the row so a −21× is read for what it is.
    const annual = String(graded?.source || '') === 'screener';
    const basis = annual ? ' (last full year, screener figure — not this quarter\'s)' : '';
    push({
      key: 'cash_conversion', label: VAR_LABEL.cash_conversion,
      before: null, after: `${cfoToPat.toFixed(2)}×${annual ? ' (last FY)' : ''}`, delta: null,
      verdict: !negative
        ? (cfoToPat >= 1 ? 'improving' : cfoToPat >= 0.6 ? 'flat' : 'deteriorating')
        : lossMaking ? 'flat'
          : patSign != null ? 'deteriorating' : 'unknown',
      evidence: !negative
        ? `Operating cash flow is ${cfoToPat.toFixed(2)}× reported profit${basis}.`
        : lossMaking
          ? `Cash-to-profit reads ${cfoToPat.toFixed(2)}× because the ${annual ? 'latest quarter' : 'quarter'} was loss-making. A ratio against a negative base says nothing about cash quality, so it is not counted either way.`
          : patSign != null
            ? `Operating cash flow is negative against a positive profit (${cfoToPat.toFixed(2)}×${basis}) — profit is not becoming cash.${annual ? ' Sign inferred from the latest quarter\'s profit; the ratio itself is annual.' : ''}`
            : `Cash-to-profit reads ${cfoToPat.toFixed(2)}×, and which side is negative is not stated in this row. A negative ratio means the opposite thing depending on that, so it is left unread rather than guessed.`,
      source: 'grader',
    });
  }

  // ── THE HEADLINE THE FILING PRINTS ON PAGE ONE.                  (zzz762)
  //
  // Revenue growth, earnings growth and cash conversion came from the grader
  // row and nowhere else. A holding with no grader row — eighteen of the
  // owner's fifty-three — could have three documents read and thirteen facts
  // extracted and still show "revenue growth ⊘ · cash conversion ⊘ ·
  // EVIDENCE INCOMPLETE", because nothing ever asked the filing for the
  // figures on its first page. The summary schema now carries a `headline`
  // block, copied verbatim from the statement of results, and it fills each
  // of these ONLY where the grader had nothing.
  //
  // What is computed and what is not: a growth rate the document prints is
  // copied. Where it prints both periods' figures and no rate, the rate is
  // arithmetic on two stated numbers of the same unit — the same licence
  // `operating_leverage` already has — and the evidence line says so. No
  // figure is ever carried in from another period or another company.
  const hl = summary?.headline || {};
  const hlBasis = said(hl.comparison) && hl.comparison !== 'not_stated' ? String(hl.comparison).toUpperCase() : null;
  const hlPeriod = said(hl.period) ? ` (${String(hl.period).trim()})` : '';
  const hlGrowth = (cur: unknown, prior: unknown, printed: unknown): { rate: number; how: 'printed' | 'computed'; text: string } | null => {
    const p = pctIn(printed);
    if (p != null && /%|per ?cent/i.test(String(printed))) return { rate: p, how: 'printed', text: String(printed).trim() };
    const c = said(cur) ? String(cur).trim() : null;
    const b = said(prior) ? String(prior).trim() : null;
    if (!c || !b) return null;
    // Money against money, in the same magnitude words — or in none.
    if (!sameUnit(c, b, null, null)) return null;
    const cn = scaledNumber(c), bn = scaledNumber(b);
    if (cn == null || bn == null || bn === 0) return null;
    // A growth off a loss is not a growth; that case stays unread.
    if (bn < 0) return null;
    const r = ((cn - bn) / Math.abs(bn)) * 100;
    if (!Number.isFinite(r)) return null;
    return { rate: r, how: 'computed', text: `${b} → ${c}` };
  };
  if (salesY == null) {
    const rg = hlGrowth(hl.revenue, hl.revenue_prior, hl.revenue_growth);
    if (rg) {
      push({
        key: 'revenue_growth', label: VAR_LABEL.revenue_growth,
        before: said(hl.revenue_prior) ? String(hl.revenue_prior).trim() : null,
        after: said(hl.revenue) ? String(hl.revenue).trim() : pct(rg.rate),
        delta: pct(rg.rate),
        verdict: rg.rate >= 15 ? 'improving' : rg.rate >= 0 ? 'flat' : 'deteriorating',
        evidence: rg.how === 'printed'
          ? `Revenue ${rg.text}${hlBasis ? ` ${hlBasis}` : ''}${hlPeriod}, as printed in the results filing.`
          : `Revenue ${rg.text}${hlBasis ? ` ${hlBasis}` : ''}${hlPeriod} — both figures printed in the results filing; the ${pct(rg.rate)} is arithmetic on the two.`,
        source: 'filing',
      });
    }
  }
  if (epsY == null) {
    const eg = hlGrowth(hl.profit, hl.profit_prior, hl.profit_growth);
    if (eg) {
      push({
        key: 'earnings_growth', label: VAR_LABEL.earnings_growth,
        before: said(hl.profit_prior) ? String(hl.profit_prior).trim() : null,
        after: said(hl.profit) ? String(hl.profit).trim() : pct(eg.rate),
        delta: pct(eg.rate),
        verdict: eg.rate >= 20 ? 'improving' : eg.rate >= 0 ? 'flat' : 'deteriorating',
        evidence: eg.how === 'printed'
          ? `Profit after tax ${eg.text}${hlBasis ? ` ${hlBasis}` : ''}${hlPeriod}, as printed in the results filing.`
          : `Profit after tax ${eg.text}${hlBasis ? ` ${hlBasis}` : ''}${hlPeriod} — both figures printed in the results filing; the ${pct(eg.rate)} is arithmetic on the two.`,
        source: 'filing',
      });
    }
  }
  if (cfoToPat == null && said(hl.cash_from_operations)) {
    // Cash conversion needs the cash figure AND a profit for the SAME period.
    // Indian quarterly filings print operating cash flow for the half-year or
    // the full year; against a quarter's PAT that ratio would be meaningless,
    // so where the periods differ the cash figure is shown as a level and the
    // ratio is not computed.
    const cfoText = String(hl.cash_from_operations).trim();
    const cfoPeriod = said(hl.cash_flow_period) ? String(hl.cash_flow_period).trim() : null;
    const samePeriod = !cfoPeriod || (said(hl.period) && cfoPeriod.toLowerCase() === String(hl.period).trim().toLowerCase());
    const cfo = scaledNumber(cfoText);
    const pat = said(hl.profit) && sameUnit(cfoText, String(hl.profit), null, null) ? scaledNumber(String(hl.profit)) : null;
    if (samePeriod && cfo != null && pat != null && pat > 0) {
      const ratio = cfo / pat;
      push({
        key: 'cash_conversion', label: VAR_LABEL.cash_conversion,
        before: null, after: `${ratio.toFixed(2)}×`, delta: null,
        verdict: cfo < 0 ? 'deteriorating' : ratio >= 1 ? 'improving' : ratio >= 0.6 ? 'flat' : 'deteriorating',
        evidence: `Operating cash flow ${cfoText} against profit ${String(hl.profit).trim()}${hlPeriod} — ${ratio.toFixed(2)}× (both printed in the results filing; the ratio is arithmetic on the two).`,
        source: 'filing',
      });
    } else {
      push({
        key: 'cash_conversion', label: VAR_LABEL.cash_conversion,
        before: null, after: `${cfoText}${cfoPeriod ? ` (${cfoPeriod})` : ''}`, delta: null,
        verdict: 'unknown',
        evidence: `Operating cash flow ${cfoText}${cfoPeriod ? ` for ${cfoPeriod}` : ''}, as printed. `
          + (pat == null || pat <= 0
            ? 'No same-unit positive profit figure to set it against, so no ratio.'
            : 'The cash-flow period differs from the results period, so no ratio is drawn against a quarter\'s profit.'),
        source: 'filing',
      });
    }
  }

  // ── FILING FACTS ────────────────────────────────────────────────────────
  const ut = summary?.utilisation || {};
  const utPrior = pctIn(ut.prior), utNow = pctIn(ut.current), utExp = pctIn(ut.expected);
  if (said(ut.current) || said(ut.prior) || said(ut.expected)) {
    const d = utPrior != null && utNow != null ? utNow - utPrior : null;
    push({
      key: 'utilisation', label: VAR_LABEL.utilisation,
      before: said(ut.prior) ? String(ut.prior) : null,
      after: said(ut.current) ? String(ut.current) : null,
      delta: d != null ? `${d >= 0 ? '+' : ''}${d.toFixed(0)}pp` : null,
      verdict: d == null ? 'unknown' : d >= 2 ? 'improving' : d > -2 ? 'flat' : 'deteriorating',
      evidence: [
        said(ut.prior) && said(ut.current) ? `Utilisation ${ut.prior} → ${ut.current}.`
          : said(ut.current) ? `Utilisation ${ut.current}, no prior figure disclosed.` : '',
        said(ut.expected) ? `Management expects utilisation of ${ut.expected}${said(ut.expected_by) ? ` by ${ut.expected_by}` : ''}.` : '',
      ].filter(Boolean).join(' '),
      source: 'filing',
    });
    void utExp;
  }

  const capex: any[] = Array.isArray(summary?.capex_projects) ? summary.capex_projects : [];
  if (capex.length) {
    const cap = capex.filter((c) => said(c?.capacity_added));
    push({
      key: 'capex', label: VAR_LABEL.capex,
      before: null,
      after: capex.map((c) => [c?.name, said(c?.amount) ? c.amount : null].filter(Boolean).join(' — ')).join(' · '),
      delta: null,
      // A capex ANNOUNCEMENT is not an improvement. It is money leaving the
      // business against a promise, and whether it improved anything is what
      // capex-chain.ts decides from utilisation and margin afterwards. Calling
      // it "improving" here is exactly the excitement the owner asked the
      // system to resist.
      verdict: 'unknown',
      evidence: capex.map((c) => [
        c?.name,
        said(c?.amount) ? c.amount : null,
        said(c?.capacity_added) ? `adds ${c.capacity_added}` : null,
        said(c?.completion_period) ? `completes ${c.completion_period}` : null,
        said(c?.revenue_from) ? `earns from ${c.revenue_from}` : null,
      ].filter(Boolean).join(', ')).join(' | '),
      source: 'filing',
    });
    if (cap.length) {
      push({
        key: 'capacity', label: VAR_LABEL.capacity,
        before: null, after: cap.map((c) => String(c.capacity_added)).join(' · '), delta: null,
        verdict: 'improving',
        evidence: `Capacity added: ${cap.map((c) => `${c.capacity_added}${said(c?.completion_period) ? ` (${c.completion_period})` : ''}`).join('; ')}.`,
        source: 'filing',
      });
    }
  }

  const ob = summary?.order_book || {};
  if (said(ob.closing_value) || said(ob.growth)) {
    // ── A LEVEL IN THE GROWTH SLOT IS A LEVEL.                      (zzz762)
    //
    // EXICOM's summary put "+1400 Cr" under `growth`, and the row printed
    // "◐ Order book +1400 Cr" as though a fourteen-hundred-crore CHANGE had
    // been stated. A growth is a rate: it carries % or pp. Anything else in
    // that slot is a stated level, and it becomes the level only when no
    // closing value was given — never a delta, and never a verdict.
    const growthRaw = said(ob.growth) ? String(ob.growth).trim() : null;
    const growthIsRate = !!growthRaw && /%|\bpp\b|per ?cent|\bbps\b/i.test(growthRaw);
    const level = said(ob.closing_value) ? String(ob.closing_value)
      : (growthRaw && !growthIsRate ? growthRaw.replace(/^\+/, '') : null);
    const g = growthIsRate ? pctIn(growthRaw) : null;
    push({
      key: 'order_book', label: VAR_LABEL.order_book,
      before: null,
      after: level,
      delta: growthIsRate ? growthRaw : null,
      verdict: g == null ? 'unknown' : g >= 15 ? 'improving' : g >= 0 ? 'flat' : 'deteriorating',
      evidence: [
        level ? `Order book ${level}.` : '',
        growthIsRate ? `Growth ${growthRaw}.` : '',
      ].filter(Boolean).join(' '),
      source: 'filing',
    });
  }
  if (said(ob.book_to_bill)) {
    const b = Number(String(ob.book_to_bill).match(/-?\d+(?:\.\d+)?/)?.[0]);
    push({
      key: 'book_to_bill', label: VAR_LABEL.book_to_bill,
      before: null, after: String(ob.book_to_bill), delta: null,
      verdict: !Number.isFinite(b) ? 'unknown' : b >= 1.1 ? 'improving' : b >= 1 ? 'flat' : 'deteriorating',
      evidence: `Book-to-bill ${ob.book_to_bill} — ${Number.isFinite(b) && b >= 1
        ? 'orders are being taken faster than they are being billed.'
        : 'the book is being drawn down faster than it is being replaced.'}`,
      source: 'filing',
    });
  }

  const g = summary?.guidance;
  if (g?.action && g.action !== 'none') {
    const a = String(g.action);
    push({
      key: 'guidance', label: VAR_LABEL.guidance,
      before: null, after: a, delta: null,
      verdict: a === 'raised' ? 'improving' : a === 'lowered' ? 'deteriorating' : 'flat',
      evidence: `Guidance ${a}${said(g.detail) ? `: ${g.detail}` : ''}${said(g.period) ? ` (${g.period})` : ''}.`,
      source: 'filing',
    });
  }

  const oneOffs: any[] = Array.isArray(summary?.one_offs) ? summary.one_offs : [];
  if (oneOffs.length) {
    const gains = oneOffs.filter((o) => o?.direction === 'gain');
    push({
      key: 'one_offs', label: VAR_LABEL.one_offs,
      before: null, after: `${oneOffs.length} item${oneOffs.length > 1 ? 's' : ''}`, delta: null,
      // A one-off GAIN flatters this quarter and will not repeat, so it counts
      // against the durability of the result even while it lifts the number.
      verdict: gains.length ? 'deteriorating' : 'flat',
      evidence: oneOffs.map((o) =>
        `${o?.direction === 'gain' ? '+' : '−'} ${o?.item}${said(o?.amount) ? ` (${o.amount})` : ''}`).join('; ')
        + (gains.length ? ' — these will not repeat, so the base for next year is lower than it looks.' : ''),
      source: 'filing',
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // THE STRUCTURAL BLOCK.                                        (zzz720)
  //
  // Everything above answers "what happened". Everything below answers "why,
  // and can it continue" — which is the distinction the owner drew, and the
  // reason the first engine could say "operating leverage 2.9×" without
  // knowing whether that was a plant filling up or a one-quarter cost freeze.
  //
  // Every field here comes from the figure-verified `structured` object. A
  // field the summary does not carry produces NO variable at all, which the
  // card renders as a hollow ○ — never as "flat". A variable nobody looked at
  // and a variable checked that did not move are different facts.
  // ═════════════════════════════════════════════════════════════════════
  const str = (v: unknown): string | null => (said(v) ? String(v).trim() : null);

  /** Push a variable only when the source actually said something. */
  const push_ = (
    key: VarKey, after: string | null, verdict: VarVerdict, evidence: string,
    opts: { before?: string | null; delta?: string | null; kind?: EvidenceKind } = {},
  ) => {
    if (!after && !opts.before && !opts.delta) return;
    // "No customer losses" is not a customer loss. The company was asked
    // and said none: checked, flat, and worth showing as such.
    if (verdict === 'deteriorating' && isDenial(after)) {
      push({ key, label: VAR_LABEL[key], before: null, after, delta: null, verdict: 'flat',
        evidence: `Company states none — ${after}`, source: 'filing', kind: opts.kind ?? 'fact' });
      return;
    }
    push({
      key, label: VAR_LABEL[key],
      before: opts.before ?? null, after, delta: opts.delta ?? null,
      verdict, evidence, source: 'filing', kind: opts.kind ?? 'fact',
    });
  };

  const cap = summary?.capacity || {};
  push_('capacity', str(cap.installed), 'unknown',
    `Installed capacity ${str(cap.installed)}${str(cap.prior_installed) ? ` (was ${cap.prior_installed})` : ''}.`,
    { before: str(cap.prior_installed) });
  push_('capacity_addition', str(cap.added), 'improving',
    `Capacity added: ${str(cap.added)}${str(cap.added_by) ? `, by ${cap.added_by}` : ''}.`);
  push_('new_plant', str(cap.new_plant), 'unknown',
    `New plant: ${str(cap.new_plant)}${str(cap.new_plant_location) ? ` (${cap.new_plant_location})` : ''}.`,
    { kind: 'fact' });
  push_('commissioning', str(cap.commissioning), 'unknown',
    `Commissioning: ${str(cap.commissioning)}.`, { kind: 'claim' });
  if (str(cap.bottleneck)) {
    const removed = /remov|eas|resolv|de-?bottleneck/i.test(String(cap.bottleneck));
    push_('capacity_bottleneck', str(cap.bottleneck), removed ? 'improving' : 'deteriorating',
      `Capacity bottleneck: ${cap.bottleneck}.`);
  }

  const dem = summary?.demand || {};
  if (str(dem.order_intake) || str(dem.order_intake_growth)) {
    const gg = pctIn(dem.order_intake_growth);
    push_('order_intake', str(dem.order_intake), gg == null ? 'unknown' : gg >= 0 ? 'improving' : 'deteriorating',
      `Order intake ${str(dem.order_intake) || ''}${str(dem.order_intake_growth) ? `, ${dem.order_intake_growth}` : ''}.`,
      { delta: str(dem.order_intake_growth) });
  }
  push_('revenue_visibility', str(ob.coverage) || str(dem.revenue_visibility), 'unknown',
    `Revenue visibility: ${str(ob.coverage) || str(dem.revenue_visibility)}.`);
  if (str(dem.cancellations)) {
    push_('execution_delay', str(dem.cancellations), 'deteriorating',
      `Order cancellations or deferrals: ${dem.cancellations}.`);
  }

  // ── CAPEX AS A CHAIN, not an announcement. The status and the
  //    "is it earning" link are the two the owner asked for by name.
  const capexList: any[] = Array.isArray(summary?.capex_projects) ? summary.capex_projects : [];
  if (capexList.length) {
    const statuses = capexList.map((c) => str(c?.status)).filter(Boolean) as string[];
    if (statuses.length) {
      const delayed = statuses.some((x) => /delay/i.test(x));
      const running = statuses.some((x) => /commission|commercial|ramp|full/i.test(x));
      push_('capex_status', statuses.join('; '),
        delayed ? 'deteriorating' : running ? 'improving' : 'unknown',
        `Capex status: ${statuses.join('; ')}.`);
    }
    const growth = capexList.filter((c) => !/maintenance/i.test(String(c?.name || '') + String(c?.purpose || '')));
    if (growth.length !== capexList.length || growth.length) {
      push_('maintenance_vs_growth', `${growth.length} growth of ${capexList.length} disclosed`, 'unknown',
        `${growth.length} of ${capexList.length} disclosed programmes are growth rather than maintenance capex. `
        + 'Maintenance capex buys no new earnings; only growth capex can.');
    }
  }
  if (str(summary?.capex_earning)) {
    const s_ = String(summary.capex_earning);
    push_('capex_earning', s_,
      /not yet|below|under|disappoint|behind/i.test(s_) ? 'deteriorating'
        : /ramp|earning|contribut|full/i.test(s_) ? 'improving' : 'unknown',
      `Capex earning: ${s_}.`);
  }

  const cst = summary?.customers || {};
  push_('new_customer', str(cst.new_customer), 'improving', `New customer: ${str(cst.new_customer)}.`);
  push_('customer_loss', str(cst.loss), 'deteriorating', `Customer or programme lost: ${str(cst.loss)}.`);
  push_('customer_concentration', str(cst.concentration), 'unknown',
    `Customer concentration: ${str(cst.concentration)}.`);
  push_('qualification', str(cst.qualification), 'improving', `Qualification: ${str(cst.qualification)}.`);
  push_('approval', str(cst.approval), 'improving', `Approval: ${str(cst.approval)}.`);
  push_('new_product', str(cst.new_product), 'improving', `New product: ${str(cst.new_product)}.`);

  const vpm = summary?.volume_price_mix || {};
  if (str(vpm.volume)) {
    const vg = pctIn(vpm.volume);
    push_('volume', str(vpm.volume), vg == null ? 'unknown' : vg > 0 ? 'improving' : vg < 0 ? 'deteriorating' : 'flat',
      `Volume ${vpm.volume}. Volume growth is the part of revenue that is not price, so it is the part that needs capacity.`);
  }
  push_('price', str(vpm.price), 'unknown', `Price: ${str(vpm.price)}.`);
  push_('mix', str(vpm.mix), 'unknown', `Mix: ${str(vpm.mix)}.`);
  push_('exports', str(vpm.exports), 'unknown', `Exports / geography: ${str(vpm.exports)}.`);

  const fin = summary?.balance || {};
  push_('working_capital', str(fin.working_capital), 'unknown',
    `Working capital: ${str(fin.working_capital)}.`);
  push_('fcf', str(fin.fcf), 'unknown', `Free cash flow: ${str(fin.fcf)}.`);
  push_('debt', str(fin.debt), 'unknown', `Debt: ${str(fin.debt)}.`);
  const roce = n(graded?.roce) ?? n(graded?.roce_pct);
  if (roce != null) {
    push({
      key: 'roce', label: VAR_LABEL.roce, before: null, after: `${roce.toFixed(1)}%`, delta: null,
      verdict: roce >= 18 ? 'improving' : roce >= 12 ? 'flat' : 'deteriorating',
      evidence: `Return on capital employed ${roce.toFixed(1)}%.`, source: 'grader', kind: 'fact',
    });
  }

  const risk = summary?.risks || {};
  if (str(risk.supply_bottleneck)) {
    const removed = /remov|eas|resolv/i.test(String(risk.supply_bottleneck));
    push_('supply_bottleneck', str(risk.supply_bottleneck), removed ? 'improving' : 'deteriorating',
      `Supply bottleneck: ${risk.supply_bottleneck}.`);
  }
  push_('execution_delay', str(risk.delay), 'deteriorating', `Delay: ${str(risk.delay)}.`);
  push_('shutdown', str(risk.shutdown), 'deteriorating', `Shutdown: ${str(risk.shutdown)}.`);
  push_('market_share', str(risk.market_share), 'unknown', `Market share: ${str(risk.market_share)}.`);
  push_('pricing_power', str(risk.pricing_power), 'unknown', `Pricing power: ${str(risk.pricing_power)}.`);
  push_('technology', str(risk.technology), 'unknown', `Technology / automation: ${str(risk.technology)}.`);
  push_('raw_materials', str(risk.raw_materials), 'unknown', `Raw materials: ${str(risk.raw_materials)}.`);

  // ── MANAGEMENT TARGETS ARE CLAIMS, NOT FACTS, and are tagged so. They are
  //    what the promise ledger will grade a LATER quarter against.
  for (const t of (Array.isArray(summary?.management_targets) ? summary.management_targets : [])) {
    if (!said(t?.metric) || !said(t?.target)) continue;
    push({
      key: 'management_target', label: VAR_LABEL.management_target,
      before: null, after: `${t.metric}: ${t.target}`, delta: null,
      verdict: 'unknown',
      evidence: `Management target — ${t.metric} ${t.target}${said(t?.by) ? ` by ${t.by}` : ''}. `
        + 'This is a claim about the future, not a reported figure. The ledger will check it next quarter.',
      source: 'filing', kind: 'claim',
    });
    break;
  }

  // ── THE MARGIN DRIVER. The owner's point: the reason matters more than the
  //    number. A margin built on mix, pricing, leverage or automation repeats;
  //    one built on a raw-material tailwind or forex does not, and the two
  //    read identically on the face of the P&L.
  if (drivers.length) {
    const structuralN = drivers.filter((d) => d?.nature === 'structural').length;
    push({
      key: 'margin_driver', label: VAR_LABEL.margin_driver,
      before: null,
      after: drivers.map((d) => String(d?.detail || '')).filter(Boolean).slice(0, 2).join('; '),
      delta: null,
      verdict: structuralN > 0 ? 'improving' : 'flat',
      evidence: structuralN > 0
        ? `${structuralN} of ${drivers.length} disclosed margin drivers are structural — that part repeats.`
        : 'Every disclosed margin driver is cyclical or one-off. This margin does not repeat on its own.',
      source: 'filing', kind: 'fact',
    });
  }

  return applyComparisons(dropRestatedCapacityAddition(out), comparisons);
}

/** Index by key, last write wins — the filing beats the grader where both
 *  spoke, because the filing carries the reason. */
export function byKey(vars: StructuralVar[]): Partial<Record<VarKey, StructuralVar>> {
  const m: Partial<Record<VarKey, StructuralVar>> = {};
  for (const v of vars) {
    const prev = m[v.key];
    if (!prev || (prev.source === 'grader' && v.source === 'filing')) m[v.key] = v;
  }
  return m;
}
