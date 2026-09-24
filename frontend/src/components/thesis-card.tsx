// ═══════════════════════════════════════════════════════════════════════════
// THE THESIS CARD — EVIDENCE FIRST, VERDICT LAST.                   (zzz715)
//
// One component, two screens: Portfolio Catalysts renders it per holding, and
// Exit Radar renders the same card for the ones that have deteriorated. They
// must never disagree about the same company, which is the whole reason this
// is a component and not two copies of a layout.
//
// THE ORDER OF THE SECTIONS IS THE ARGUMENT, and it is deliberately the
// reverse of a normal dashboard card. A dashboard leads with the verdict and
// buries the evidence. This one leads with WHAT CHANGED — before, after,
// delta, source — and only then says what it means, because the owner's
// standing instruction is that he decides and the machine's job is to have
// the evidence ready. "Machines calculate. AI interprets. You decide."
//
// FACTS AND INTERPRETATION ARE VISUALLY SEPARATE. Everything above the
// THESIS block is a figure read from a document. Everything in and below it
// is inference, and it is labelled as inference on screen. A reader who
// trusts only the top half of this card loses nothing but the conclusion.
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { STATUS_META, type ThesisAssessment } from '@/lib/thesis/status';
import { ORIGIN_META, type BookOrigin } from '@/lib/thesis/universe';
import { capacityClass, isUtilisationReading } from '@/lib/catalyst/persistence';
import { CAPEX_META, CAPEX_STAGES, STAGE_LABEL, LIFECYCLE_LABEL, type CapexChain, type CapexEarning, type CapexEarningState } from '@/lib/thesis/capex-chain';
import type { VarVerdict, VariableReading, ReadingPoint, PeriodClass } from '@/lib/thesis/variables';
import type { ThesisVerdict } from '@/lib/thesis/status';
import { VAR_GROUP, VAR_LABEL, GROUP_ORDER, GROUP_LABEL, ABSENCE_MARK, EVIDENCE_STATE_META, evidenceStateLine, type VarGroup } from '@/lib/thesis/taxonomy';
import { ABFG_META, type AbfgResult } from '@/lib/earnings/pattern-abfg';
import type { CompanyLedger, FreshnessState, ChangeLine } from '@/lib/thesis/evidence-ledger';
import { freshnessLine } from '@/lib/thesis/evidence-ledger';
import { BASIS_LABEL } from '@/lib/thesis/comparison';
import { validateReading } from '@/lib/thesis/fact-model';

// ── THE PALETTE.                                                   (zzz723)
//
// The first version reached for whatever colour was nearest — the portal's
// bullish green for "improving", a hard red for anything down, and the same
// muted grey for four completely different kinds of absence. The result was a
// wall of red and green in which a deteriorating CORE variable and a routine
// flat one carried the same visual weight, and a variable nobody had read
// looked identical to one that had been read and was fine.
//
// Three rules, and they are about legibility rather than taste:
//
//   1. THE VERDICT SCALE IS SEQUENTIAL, NOT BINARY. Improving, flat and
//      deteriorating are three points on one axis, so they get one hue family
//      each at a consistent lightness — emerald, slate, rose — rather than
//      maximum-saturation green and red shouting over everything else.
//   2. ABSENCE IS NEVER COLOURED. Four absence states share one low-contrast
//      grey and are distinguished by their MARK (○ — n/a ?), because an
//      absence is not a finding and must not compete with one for attention.
//   3. SEVERITY GETS THE ONLY SATURATED COLOUR ON THE CARD. A broken thesis
//      is the single thing that should pull the eye across a fifty-row page.
//
// The HUE is fixed rather than themed: these carry meaning, and a theme that
// repainted "deteriorating" would repaint the meaning with it. The LIGHTNESS
// is not fixed — it tracks the background, because a colour nobody can read
// carries no meaning either. (zzz761)
const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-bg-4)',
  // ── READABLE ON BOTH GROUNDS.                                  (zzz765)
  // The owner: "so light, can't read easily". Secondary text sat on the two
  // dimmest greys of the palette (text-3/text-4) at 8–11px. The card now has
  // its own three text levels, each ≥ 7:1 on its ground (globals.css).
  text: 'var(--tc-text, #F1F5F9)', dim: 'var(--tc-dim, #D5DEE9)', faint: 'var(--tc-faint, #AEBBCB)',

  // Verdict scale — one step of lightness apart, readable on dark and light.
  // ── THE HUE IS FIXED; THE LIGHTNESS IS NOT.                  (zzz761)
  //
  // These were literal 400-level hexes, and on the light theme emerald-400
  // sits at roughly 1.8:1 against white — the whole board read washed out.
  // The variables keep one hue per meaning and swap lightness with the
  // ground (globals.css), so "deteriorating" is the same rose on both
  // themes and legible on both. Fallbacks preserve the dark values.
  up: 'var(--mc-verdict-up, #34D399)',
  flat: 'var(--mc-verdict-flat, #94A3B8)',
  down: 'var(--mc-verdict-down, #FB7185)',
  absent: 'var(--mc-verdict-absent, #64748B)',

  // Reserved for severity and for the one call to action.
  alarm: 'var(--mc-verdict-alarm, #F43F5E)',
  warn: 'var(--mc-verdict-warn, #FBBF24)',
  cyan: 'var(--tc-accent, #22D3EE)',
  amber: 'var(--mc-verdict-warn, #FBBF24)',
  green: 'var(--mc-verdict-up, #34D399)',
  red: 'var(--mc-verdict-down, #FB7185)',
};

/** Readable INK from a meaning colour: the hue kept, pulled 35% toward the
 *  card's text colour, so amber and pale violet stay legible on white and
 *  still read as themselves on dark. Backgrounds keep the raw colour. */
const ink = (c: string | null | undefined) => (c ? `color-mix(in srgb, ${c} 65%, var(--tc-text, #F1F5F9))` : C.text);

const VERDICT: Record<VarVerdict, { mark: string; color: string; word: string }> = {
  improving: { mark: '▲', color: C.up, word: 'improving' },
  flat: { mark: '–', color: C.flat, word: 'flat, and checked' },
  deteriorating: { mark: '▼', color: C.down, word: 'deteriorating' },
  // Disclosed, value shown, nothing to compare against. Neither an arrow
  // nor a hollow circle: the company said it, the ledger cannot yet judge
  // it. (zzz754)
  stated: { mark: '◐', color: C.flat, word: 'disclosed — a level only, no comparison basis' },
  unknown: { mark: '○', color: C.absent, word: 'no value' },
};

// ── UNKNOWN ≠ FLAT ≠ CONFIRMED.                                     (zzz771)
//
// The owner's verdict: a variable nobody disclosed, a variable that was read
// twice and did not move, and a variable that confirmed the thesis were
// rendering close enough to be misread for one another ("—", "–", "▲" at the
// same size and weight). Three treatments, each visually its own thing:
//
//   ? NOT DISCLOSED             grey, DASHED outline — an absence, not a finding
//   → UNCHANGED (two readings)  neutral slate — checked, and it did not move
//   ✓ CONFIRMED                 emerald — it moved the thesis's way
//
// A flat row with only ONE reading is not "unchanged" — nothing was compared —
// and says "single reading" instead. UNCLEAR prints the value with a demand
// for validation, never a dash.
export const ROW_TREATMENT = {
  NOT_DISCLOSED: { mark: '?', word: 'NOT DISCLOSED' },
  NOT_SEARCHED: { mark: '○', word: 'NOT SEARCHED' },
  UNCLEAR: { mark: '?', word: 'unclear — validation required' },
  NOT_APPLICABLE: { mark: 'n/a', word: 'N/A' },
  SOURCE_UNAVAILABLE: { mark: '⚠', word: 'SOURCE UNAVAILABLE' },
  RETRIEVAL_FAILED: { mark: '⚠', word: 'RETRIEVAL FAILED' },
  UNCHANGED: { mark: '→', word: 'UNCHANGED (two readings)' },
  // A flat verdict on a real move (+15.1%, +0.5pp) is "not material", not
  // "did not move": the owner read "UNCHANGED" on NRBBEARING's +15.1%
  // earnings and REDINGTON's +0.5pp margin. The word prints the delta. (zzz772)
  WITHIN_MATERIALITY: { mark: '–', word: 'within materiality' },
  // Only a sequential move is on file: a level with a labelled seasonal
  // delta, deliberately not judged — never "unclear". (zzz772)
  QOQ_ONLY: { mark: '◐', word: 'QoQ only — seasonal, not judged' },
  SINGLE: { mark: '–', word: 'single reading' },
  SILENT: { mark: '–', word: 'none disclosed · check passes' },
  CONFIRMED: { mark: '✓', word: 'CONFIRMED' },
  CONTRADICTED: { mark: '✕', word: 'CONTRADICTED' },
  STATED: { mark: '◐', word: 'level only' },
} as const;
export type RowTreatmentKey = keyof typeof ROW_TREATMENT;

type TreatInput = { key?: string; verdict: VarVerdict; state?: string | null; stateReason?: string | null; unjudged?: string | null;
  before?: string | null; after?: string | null; delta?: string | null; comparison?: any; reading?: VariableReading | null; withinMateriality?: boolean };

// ── QoQ-ONLY IS A LEVEL, NOT AN UNCLEAR FIGURE.                    (zzz772)
// CYIENTDLM, JINDRILL, TI, AZAD, WENDT … printed "? Operating margin unclear
// — validation required: 10.5%". The figure is not in doubt: the reason on
// the row is that only a sequential (QoQ) move is on file, which carries
// seasonality, so it is shown and not judged. Detected from that reason.
export function isQoqOnly(c: TreatInput): boolean {
  if (c.state !== 'UNCLEAR' && c.verdict !== 'stated') return false;
  return /\bsequential\b|\bQoQ\b/i.test(`${c.stateReason || ''} ${c.unjudged || ''}`);
}

/** The printed change on a row: its own delta, else the reading's, else the
 *  comparison's. */
export function deltaText(c: TreatInput): string | null {
  const d = c.delta || c.reading?.delta_abs || c.comparison?.change || null;
  return d ? String(d).trim() || null : null;
}

const plainNum = (x: unknown): number | null => {
  const t = String(x ?? '');
  const ns = t.match(/-?\d[\d,]*(?:\.\d+)?/g);
  if (!ns || ns.length !== 1) return null;
  const v = Number(ns[0].replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
};

/** Is the move ≈ 0? true: |Δ| < 0.5pp, < 50bps, < 1% relative, or the two
 *  readings say the same thing; false: a real move; null: cannot tell. (zzz772) */
export function isNegligibleDelta(c: TreatInput): boolean | null {
  if (sameText(c.before, c.after)) return true;
  if (c.reading?.current && c.reading?.previous && sameText(c.reading.current.value, c.reading.previous.value)) return true;
  if (c.comparison?.previous && sameText(c.comparison.previous.raw, stripTag(c.after))) return true;
  const d = deltaText(c);
  if (d) {
    const m = /(\d+(?:\.\d+)?)\s*(pp|bps?|%)?/i.exec(d);
    if (m) {
      const v = Math.abs(Number(m[1]));
      const u = (m[2] || '').toLowerCase();
      if (u === 'pp') return v < 0.5;
      if (u.startsWith('bp')) return v < 50;
      if (u === '%') return v < 1;
      if (v === 0) return true;
    }
  }
  const dp = plainNum(c.reading?.delta_pct);
  if (dp != null && /%/.test(String(c.reading?.delta_pct))) return Math.abs(dp) < 1;
  const a = plainNum(c.before), b = plainNum(c.after);
  if (a != null && b != null && a !== 0) return Math.abs(b - a) / Math.abs(a) < 0.01;
  return null;
}

/** A growth rate or a margin is a comparison in itself: "+8.4%" YoY is two
 *  periods, so "single reading" is never its word. (zzz772) */
const RATE_KEYS = new Set(['revenue_growth', 'earnings_growth', 'margin', 'operating_leverage']);
const isRateRow = (c: TreatInput) => !!c.key && RATE_KEYS.has(c.key)
  && (!!deltaText(c) || /^[+\-−]\s*\d/.test(stripTag(c.after)) || /[+\-−]\d+(?:\.\d+)?\s*(?:%|pp)/.test(String(c.after ?? '')));

/** Which of the three treatments a row gets. Reads the evidence state first
 *  (an UNCLEAR or NOT_DISCLOSED row is never judged by its verdict), then the
 *  verdict, then whether two readings actually exist. */
export function rowTreatment(c: TreatInput): RowTreatmentKey {
  const st = c.state || null;
  if (isQoqOnly(c)) return 'QOQ_ONLY';
  if (st === 'UNCLEAR') return 'UNCLEAR';
  if (c.verdict === 'unknown') {
    if (st && st in ROW_TREATMENT && st !== 'FOUND') return st as RowTreatmentKey;
    return 'NOT_SEARCHED';
  }
  if (c.verdict === 'improving') return 'CONFIRMED';
  if (c.verdict === 'deteriorating') return 'CONTRADICTED';
  if (c.verdict === 'stated') return 'STATED';
  // flat: two readings → unchanged; one → single; none → silence passing.
  const twoReadings = !!(c.reading?.current && c.reading?.previous)
    || (!!c.before && !!c.after)
    || !!(c.comparison?.previous && c.comparison?.basis !== 'NONE');
  // UNCHANGED only when the move is ≈ 0; any other flat verdict is a move
  // judged not material, and says so with its delta. X's `withinMateriality`
  // confirms the second case where the status engine supplies it. (zzz772)
  if (twoReadings) return isNegligibleDelta(c) === true && c.withinMateriality !== true ? 'UNCHANGED' : 'WITHIN_MATERIALITY';
  if (isRateRow(c)) return 'WITHIN_MATERIALITY';
  if (c.after || c.before) return 'SINGLE';
  return 'SILENT';
}

/** The treatment word as printed: "within materiality (+15.1%)" carries the
 *  delta unless the value beside it already shows it. (zzz772) */
export function treatmentWord(tr: RowTreatmentKey, c: TreatInput, shown = ''): string {
  if (tr !== 'WITHIN_MATERIALITY') return ROW_TREATMENT[tr].word;
  const d = deltaText(c);
  return d && !shown.includes(d) ? `within materiality (${d})` : 'within materiality';
}

// ── A READING SAYS WHAT PERIOD IT DESCRIBES.                        (zzz771)
//
// A historical figure, last year's, a target or a guidance number must never
// sit in the "current" slot of a row: "◐ Guidance INR1,871 crores (FY26)" on
// CASTROLIND read as this quarter's figure. Each such point gets a small
// class label, and the current slot says "current: not disclosed" when the
// only reading on file is one of those.
const NON_CURRENT: ReadonlySet<PeriodClass> = new Set<PeriodClass>(['HISTORICAL', 'PREVIOUS_FY', 'MANAGEMENT_TARGET', 'GUIDANCE', 'THESIS_BASELINE']);
export const PERIOD_CLASS_LABEL: Record<PeriodClass, string> = {
  CURRENT_QUARTER: 'CURRENT', PREVIOUS_QUARTER: 'PREV QTR', PREVIOUS_FY: 'PREV FY', HISTORICAL: 'HISTORICAL',
  MANAGEMENT_TARGET: 'TARGET', GUIDANCE: 'GUIDANCE', THESIS_BASELINE: 'BASELINE',
};
// ── NO CODE TOKENS ON THE CARD.                                    (zzz772)
// A comparison basis or state enum ("▲ in_text", "→ vs_baseline") is a code
// name, not a word the owner reads. Every printed reading passes through here;
// the variables layer is fixing its display strings too, and this keeps the
// card clean whichever lands first.
const TOKEN_WORD: Array<[RegExp, string]> = [
  [/\bin_text\b/g, 'in the text'], [/\bvs_baseline\b/g, 'vs the thesis baseline'], [/\bvs_prior_read\b/g, 'vs the prior read'],
  [/\bNOT_COMPARABLE\b/g, 'not comparable'], [/\bUNKNOWN_[A-Z_]+\b/g, 'unknown'],
  [/\b(?:undefined|NaN|null)\b/g, 'not stated'],
];
export const humanTokens = (s: string): string => TOKEN_WORD.reduce((t, [re, w]) => t.replace(re, w), String(s ?? ''));
const pointText = (pt: ReadingPoint) => `${rupee(pt.value)}${pt.period ? ` (${pt.period})` : ''}`;
/** The printable text of a reading plus the class tags to show beside it. */
export function readingText(r: VariableReading): { text: string; tags: string[]; displaced: boolean } {
  const tags: string[] = [];
  for (const pt of [r.current, r.previous, r.baseline]) if (pt && NON_CURRENT.has(pt.period_class)) tags.push(PERIOD_CLASS_LABEL[pt.period_class]);
  if (r.current && NON_CURRENT.has(r.current.period_class)) {
    // The "current" point is not current. Say so, and print it under its
    // own class rather than letting it occupy the slot.
    const parts = [`current: not disclosed`, `${PERIOD_CLASS_LABEL[r.current.period_class].toLowerCase()} ${pointText(r.current)}`];
    if (r.previous && !NON_CURRENT.has(r.previous.period_class)) parts.push(`previous ${pointText(r.previous)}`);
    return { text: humanTokens(parts.join(' · ')), tags: Array.from(new Set(tags)), displaced: true };
  }
  return { text: humanTokens(rupee(r.display || '')), tags: Array.from(new Set(tags)), displaced: false };
}

// ── THREE VERDICT DIMENSIONS, THREE COLOURS.                        (zzz771)
//
// "No thesis action triggered" answers "did a break trigger fire?"; it says
// nothing about direction or about whether the mechanism was checked. The
// three are printed as separate chips so one cannot be read as another.
const DIRECTION_WORD: Record<ThesisVerdict['direction'], string> = { STRENGTHENING: 'strengthening', INTACT: 'intact — on track', WEAKENING: 'weakening', UNCHANGED: 'unchanged', UNKNOWN: 'unknown' };
/** The period the evidence describes, or an honest "latest period" when the
 *  ledger names none — never "CURRENT PERIOD — CURRENT-PERIOD EVIDENCE" or
 *  "this period: 1.44× (last FY)". (zzz775) */
export const periodHead = (cur: string | null | undefined): string => (cur ? `${cur.toUpperCase()} — CURRENT-PERIOD EVIDENCE` : 'LATEST PERIOD — EVIDENCE');
/** A satisfied standing test (the F / G cash test on the latest annual
 *  figure — India files no Q1/Q3 cash-flow statement): the value is the FY
 *  figure, labelled as the standing test, never as this quarter's. (zzz775) */
export function standingText(c: { historical?: { standing?: boolean; period: string; value: string } | null }, cur: string | null | undefined): { value: string; word: string } | null {
  const h = c.historical;
  if (!h || !h.standing) return null;
  const q = /^Q[1-4]/i.exec(String(cur || ''))?.[0]?.toUpperCase();
  return { value: `${h.period} ${h.value}`, word: `standing test (no ${q ? `${q} ` : 'quarterly '}cash-flow statement)` };
}
const EVIDENCE_WORD: Record<ThesisVerdict['evidence'], string> = {
  CONFIRMED: 'confirmed', PARTIALLY_CONFIRMED: 'partially confirmed', NOT_CONTRADICTED: 'not contradicted',
  CONTRADICTED: 'contradicted', INCOMPLETE: 'incomplete', UNCHECKED: 'unchecked',
};
const EARNING_COLOR: Record<CapexEarningState, string> = {
  EARNING: 'var(--mc-verdict-up, #34D399)', PARTIAL: 'var(--tc-accent, #22D3EE)', SPENT_NOT_EARNING: 'var(--mc-verdict-warn, #FBBF24)',
  NOT_STARTED: 'var(--mc-verdict-flat, #94A3B8)', UNKNOWN: 'var(--mc-verdict-absent, #64748B)',
};

// ── WHAT A ROW IS, AND WHAT IT IS MEASURED AGAINST.                (zzz765)
//
// Every figure on the board now says three things: what KIND of statement it
// is (actual / management statement / guidance / target / historical), the
// PERIOD it describes, and what it is compared against — the previous period,
// the same sentence, a plan, or nothing (and why nothing). A bare "80%" says
// none of that, and "target 80% plus" printed as "80% plus" said the wrong one.
const STATEMENT_TAG: Record<string, { word: string; color: string }> = {
  ACTUAL: { word: 'ACTUAL', color: C.dim },
  MANAGEMENT_STATEMENT: { word: 'MGMT STATEMENT', color: C.warn },
  GUIDANCE: { word: 'GUIDANCE', color: C.cyan },
  TARGET: { word: 'TARGET', color: C.cyan },
  HISTORICAL: { word: 'HISTORICAL CONTEXT', color: C.faint },
};
// "!833 million" (AETHER) is the same PDF rupee glyph as "`" and "H". (zzz769)
export const rupee = (s: string) => s.replace(/`\s*(?=\d)/g, '₹').replace(/(?<![A-Za-z])H\s?(?=\d[\d,.]*\s*(?:crores?|cr\b|lakhs?|mn\b|million|billion|bn\b))/g, '₹')
  .replace(/!\s?(?=\d[\d,.]*\s*(?:crores?|cr\b|lakhs?|mn\b|million|billion|bn\b))/gi, '₹');
/** Two statements of a value that say the same thing. (zzz769) */
const sameText = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase() && String(a ?? '').trim() !== '';
const stripTag = (s: string | null | undefined) => rupee(String(s ?? '').replace(/\s*\((?:target|guidance)\)\s*$/i, '')).trim();

type RowLike = {
  verdict: VarVerdict; before: string | null; after: string | null; delta: string | null; label?: string | null;
  statement?: string | null; plan?: { value: string; type: string; gap: string | null } | null;
  asOf?: string | null; comparison?: any; unjudged?: string | null;
  reading?: VariableReading | null; state?: string | null;
};

/** The compact value a chip shows — one figure, typed. */
export function chipValue(c: RowLike): string {
  return humanTokens(chipValueRaw(c));
}
function chipValueRaw(c: RowLike): string {
  const after = stripTag(c.after);
  const planTxt = c.plan ? ` · ${c.plan.type === 'TARGET' ? 'target' : 'plan'} ${rupee(c.plan.value)}${c.plan.gap ? ` (gap ${c.plan.gap})` : ''}` : '';
  // UNCLEAR is printed as a demand for validation with the value, never as a
  // figure and never as a dash. (zzz771)
  if (isQoqOnly(c as TreatInput)) {
    const level = after || stripTag(c.reading?.current?.value) || '';
    const d = (deltaText(c as TreatInput) || '').replace(/\s*\(?\bQoQ\b\)?\s*$/i, '').trim();
    return `${level ? `${level} · ` : ''}QoQ only${d ? ` (${d} QoQ)` : ''} — seasonal, not judged${planTxt}`;
  }
  if (c.state === 'UNCLEAR' && after) return `unclear — validation required: ${after}`;
  // The time-series reading, when the variables layer supplied one, is the
  // whole statement: current → previous → Δ → direction → basis. (zzz771)
  // A management statement keeps its tag on the row whichever path prints it. (zzz784)
  if (c.reading && c.reading.display) {
    const rt = readingText(c.reading).text;
    return c.statement === 'MANAGEMENT_STATEMENT' && !/management/i.test(rt) ? `${rt} — management statement, not a filed figure` : rt;
  }
  if (c.statement === 'GUIDANCE' || c.statement === 'TARGET') {
    // "maintained" / "raised" are the finding; print them as such.
    if (/^(maintained|reiterated|unchanged)$/i.test(after)) return `${c.statement.toLowerCase()} MAINTAINED`;
    // The label already names the metric and that it is a target (zzz784).
    if (/ — |target|guidance/i.test(String(c.label || ''))) return `${after} (${c.statement.toLowerCase()} only — not a filed figure)`;
    return `${c.statement.toLowerCase()}: ${after}`;
  }
  // zzz784: the row itself says it is a management statement, not a filed figure.
  if (c.statement === 'MANAGEMENT_STATEMENT') return `“${after}” — management statement, not a filed figure${planTxt}`;
  // A historical row on the board read as this period's figure: CASTROLIND
  // "◐ Guidance INR1,871 crores (FY26)". It says it is history. (zzz769)
  if (c.statement === 'HISTORICAL') return `history: ${[c.before, after].filter(Boolean).join(' → ')} (${c.asOf})`;
  const cmpr = c.comparison;
  // "LGFT (Q3 FY26) → LGFT · FLAT" is one statement repeated: say so. (zzz769)
  if (cmpr && cmpr.previous && cmpr.basis !== 'NONE' && cmpr.basis !== 'WITHIN_DOCUMENT' && sameText(cmpr.previous.raw, after)) {
    return `${after} · unchanged since ${cmpr.previous_period || 'the last disclosure'}${planTxt}`;
  }
  if (cmpr && cmpr.previous && cmpr.basis !== 'NONE' && cmpr.basis !== 'WITHIN_DOCUMENT' && cmpr.change_type !== 'NOT_COMPARABLE') {
    const ch = cmpr.change_type === 'UNCHANGED' ? 'FLAT' : (cmpr.change || c.delta || '');
    return `${cmpr.previous.raw} → ${after}${ch ? ` · ${ch}` : ''}${planTxt}`;
  }
  if (c.before && after) return `${c.before} → ${after}${c.delta ? ` · ${c.delta}` : ''}${planTxt}`;
  return `${after || c.delta || ''}${c.delta && c.delta !== after && after ? ` · ${c.delta}` : ''}${planTxt}`;
}

/** Why a figure has no "before": said precisely, never as a blank. */
function priorNote(c: RowLike, depth: number): string | null {
  if (c.statement !== 'ACTUAL' && c.statement != null) return null;
  if (c.before) return null;
  // The grader's rows compare against the filed prior quarter / year already
  // (+14.5pp QoQ, +1645% YoY); "prior period not read yet" under them was
  // false. Any row carrying its own change has a before. (zzz767)
  if ((c as any).source === 'grader' || (c.delta && /[+\-−]?\d/.test(c.delta))) return null;
  // Only a FIGURE has a previous value; a sentence of commentary does not.
  if (!/(?<![A-Za-z])\d/.test(String(c.after ?? ''))) return null;
  const cmpr = c.comparison;
  if (cmpr?.previous && cmpr.change_type === 'NOT_COMPARABLE') return `prior ${cmpr.previous.raw} (${cmpr.previous_period}) — not directly comparable`;
  if (cmpr?.previous) return null;
  if (cmpr?.change_type === 'NEWLY_DISCLOSED') return 'not disclosed in the earlier periods on file';
  return depth <= 1 ? 'prior period not read yet — no previous value on file' : 'prior value unavailable';
}

export interface ThesisCardProps {
  /** zzz774: the thesis type the owner set by hand (null = automatic), and
   *  the setter. Absent → no picker is shown. */
  thesisType?: 'A' | 'B' | 'F' | 'G' | null;
  onThesisType?: (p: 'A' | 'B' | 'F' | 'G' | null) => void;
  symbol: string;
  market: 'IN' | 'US';
  tier?: string | null;
  pattern?: AbfgResult | null;
  radarScore?: number | null;
  assessment: ThesisAssessment | null;
  capex?: CapexChain | null;
  /** Filing links. Never a price, never a chart. */
  sources?: Array<{ label: string; url: string }>;
  /** Every document actually read for this holding. Several, not one. */
  documentsRead?: Array<{ label: string; kind: string; source: string; period: string | null; url: string }>;
  /** Every retrieval attempt and what it answered — so an empty structural
   *  field can say which sources were searched rather than showing a bare
   *  circle with no reason. (zzz737) */
  discoveryAttempts?: Array<{ source: string; outcome: string; detail: string; found: number }>;
  discoveryState?: string | null;
  /** Per-document result of the read attempt: read / download_failed / scanned / too_short. */
  documentOutcomes?: Array<{ label: string; kind: string; outcome: string; chars: number; pages: number; detail?: string; url?: string }>;
  /** The AI summary has not been read for this holding yet. */
  needsRead?: boolean;
  reading?: boolean;
  onRead?: () => void;
  /** Discovery only — is there a newer document than the one on file? */
  onCheck?: () => void;
  /** Re-read the current period regardless (debug / manual refresh). */
  onReread?: () => void;
  error?: string | null;
  // ── THE PERSISTENT LEDGER.                                     (zzz740)
  ledger?: CompanyLedger | null;
  freshness?: { state: FreshnessState; detail: string } | null;
  reportingPeriod?: string | null;
  changed?: ChangeLine[];
  changedFrom?: string | null;
  persisted?: boolean | null;
  readNote?: string | null;
  /** Said plainly when the ledger has no earlier promise to check against. */
  promiseNote?: string | null;
  /** 'graded' | 'screener' | 'none' — where the grader-level numbers came
   *  from. A screener figure and a filing-read figure are not the same
   *  evidence and the card must never let them look the same. */
  dataSource?: string | null;
  /** Latest quarter the figures cover, e.g. "Jun 2026". (zzz764) */
  dataPeriod?: string | null;
  /** Whether this name is held, a preset-passing bench candidate, or both.
   *  A bench card must never be mistaken for a holding, so this is rendered
   *  next to the ticker rather than buried in a tooltip. (zzz731) */
  origin?: BookOrigin;
  defaultOpen?: boolean;
}

function Section({ label, color, children }: { label: string; color?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{
        fontSize: 12, fontWeight: 800, letterSpacing: 0.5, color: color ? ink(color) : C.dim,
        marginBottom: 4, borderBottom: `1px solid ${C.border}`, paddingBottom: 3,
      }}>{label}</div>
      {children}
    </div>
  );
}

/** Small period-class label beside a figure that is not this period's. */
function ClassTag({ word }: { word: string }) {
  return (
    <span data-testid="period-class" style={{ marginLeft: 5, fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, padding: '0 4px', borderRadius: 2,
      border: `1px solid ${C.faint}`, color: C.faint, verticalAlign: 'middle' }}>{word}</span>
  );
}

/** "Capex earning: PARTIAL" and the chain lines beneath it. `inline` is the
 *  board chip (lines joined with ·); the section prints one line per row. */
function CapexEarningBlock({ e, inline }: { e: CapexEarning; inline: boolean }) {
  const color = EARNING_COLOR[e.state];
  const dashed = e.state === 'UNKNOWN';
  // zzz784: construction / operational status and economic status are two
  // questions, printed as two lines from the one normalized capex state.
  const lines = [...(e.operational ? [`Operational status: ${e.operational}`] : []), ...e.lines, ...(e.economic ? [`Economic status: ${e.economic}`] : [])];
  const title = `Capex earning: ${e.label}\n${lines.join('\n')}${e.source ? `\nSource: ${e.source}` : ''}`;
  if (inline) {
    return (
      <span data-testid="capex-earning" data-state={e.state} title={title} style={{
        fontSize: 12, fontWeight: 600, padding: '1px 6px', borderRadius: 4, color: dashed ? C.absent : C.text, lineHeight: 1.5,
        border: `1px ${dashed ? 'dashed' : 'solid'} ${dashed ? C.absent : `color-mix(in srgb, ${color} 55%, transparent)`}`,
        background: dashed ? 'transparent' : `color-mix(in srgb, ${color} 10%, transparent)`,
      }}>
        Capex earning: <b style={{ color: ink(color) }}>{e.label}</b>
        {[...e.lines, ...(e.operational ? [`Operational status: ${e.operational}`] : []), ...(e.economic ? [`Economic status: ${e.economic}`] : [])].map((l, i) => <span key={i}> · {l}</span>)}
      </span>
    );
  }
  return (
    <div data-testid="capex-earning" data-state={e.state} style={{ fontSize: 13.5, marginBottom: 5, color: C.text }}>
      <b style={{ color: ink(color) }}>CAPEX EARNING: {e.label}</b>
      {e.source && <span style={{ color: C.faint }}> — {e.source}</span>}
      {lines.map((l, i) => (
        <div key={i} style={{ fontSize: 13, color: dashed ? C.dim : C.text, paddingLeft: 10 }}>{l}</div>
      ))}
    </div>
  );
}

/** zzz784: the raw extraction log shows what was STORED; where the engine
 *  reads a stored "capacity" differently (money, stores, floor area, a share
 *  that is not a utilisation), the log says so beside it. */
export function rawEventNote(e: { variable: string; after?: string | null; evidence_text?: string | null }): string | null {
  if (e.variable === 'capacity' || e.variable === 'capacity_addition') {
    if (/%/.test(String(e.after ?? '')) && !isUtilisationReading(e.after, e.evidence_text)) return 'not a capacity or utilisation reading — not used';
    const k = capacityClass(e.after, e.evidence_text);
    if (k === 'MONEY') return 'a money figure — not capacity';
    if (k === 'NETWORK') return 'a store / network count — not production capacity';
    if (k === 'FLOOR_SPACE') return 'floor space — not production capacity';
  }
  if (e.variable === 'utilisation' && !isUtilisationReading(e.after, e.evidence_text)) return 'not a utilisation reading (e.g. same-store sales growth) — not used';
  return null;
}

/** Every earlier-period figure on the assessment, with the engine's decision:
 *  the historical items it separated out, plus historical context a filing
 *  row carries beside its current value. (zzz773) */
export function historyItems(a: ThesisAssessment, reportingPeriod?: string | null): Array<{ label: string; period: string; value: string; active: boolean; standing?: boolean; decision: string; current: string | null }> {
  const cur = a.currentPeriod || reportingPeriod || 'Latest period';
  const out: Array<{ label: string; period: string; value: string; active: boolean; standing?: boolean; decision: string; current: string | null }> = [];
  for (const h of a.historicalContext || []) {
    const row = a.checked.find((c) => c.key === h.key);
    const lc = /^[A-Z]{2,}\b/.test(h.label) ? h.label : h.label.toLowerCase();
    // A standing test's figure IS the FY figure: the current slot says the
    // quarter's figure is not disclosed and names the standing test, never
    // "Q1 FY27: 0.74× (last FY)". (zzz775)
    const current = h.standing ? `${cur} ${lc}: NOT DISCLOSED — ${h.period} ${h.value} is the standing test`
      : row && row.verdict === 'unknown' ? `${cur} ${lc}: NOT DISCLOSED`
      : row && !h.active && row.verdict !== 'unknown' && !/\(last FY\)\s*$/i.test(String(row.after || '')) ? `${cur}: ${row.delta || row.after || 'stated'}`
        : `${cur} ${lc}: NOT DISCLOSED`;
    out.push({ label: h.label, period: h.period, value: h.value, active: h.active, standing: !!h.standing, decision: h.decision, current });
  }
  for (const c of a.checked) {
    for (const x of (Array.isArray(c.context) ? c.context : []) as Array<{ value: string; asOf: string }>) {
      out.push({ label: c.label, period: x.asOf, value: x.value, active: false, current: c.after ? `${cur}: ${c.after}` : null,
        decision: `Context only — dated ${x.asOf}, before ${cur}; shown beside the row and never compared as ${cur}'s figure.` });
    }
  }
  return out;
}

export function ThesisCard(p: ThesisCardProps) {
  const [open, setOpen] = useState(!!p.defaultOpen);
  const a = p.assessment;
  const sm = a ? STATUS_META[a.status] : null;
  const pm = p.pattern ? ABFG_META[p.pattern.pattern] : null;

  // Only variables the evidence actually spoke to appear in WHAT CHANGED.
  // The undisclosed ones are not hidden — they are listed under the thesis as
  // unchecked, which is a different and more useful statement than a row of
  // dashes.
  // Moves first, then checked-flat, then levels, then forward statements,
  // then historical context — the order a reader asks the questions in.
  const orderOf = (c: any) => c.statement === 'HISTORICAL' ? 5
    : c.statement === 'GUIDANCE' || c.statement === 'TARGET' ? 4
      : c.verdict === 'improving' || c.verdict === 'deteriorating' ? 0
        : c.verdict === 'flat' ? 1 : c.statement === 'MANAGEMENT_STATEMENT' ? 3 : 2;
  const changed = (a?.checked || []).filter((c) => c.verdict !== 'unknown')
    .map((c, i) => ({ c, i }))
    .sort((x, y) => orderOf(x.c) - orderOf(y.c) || y.c.weight - x.c.weight || x.i - y.i)
    .map((x) => x.c);
  const unchecked = (a?.checked || []).filter((c) => c.verdict === 'unknown');
  // ── EVERY ABSENCE SAYS WHICH ABSENCE IT IS.                      (zzz770)
  // "NOT DISCLOSED — searched concall + results filing", never a bare dash.
  const stateLine = (c: { state?: string; stateReason?: string | null }) =>
    evidenceStateLine((c.state || 'NOT_SEARCHED') as any, { docs: p.documentsRead || null, reason: c.stateReason || null });
  // The capex lifecycle in one line, where the evidence has one. (zzz770)
  const capexLine = (() => {
    const ps = p.capex?.lifecycleProjects || [];
    const best = ps.find((x) => x.steps.some((st) => st.step === 'REVENUE_CONTRIBUTION' && st.state === 'actual'))
      || ps.find((x) => x.name !== 'Capacity and capex not tied to a named project') || ps[0];
    return best ? best.line : null;
  })();

  return (
    <div style={{
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 14px',
      borderLeft: `3px solid ${sm?.color || C.border}`,
    }}>
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 17, fontWeight: 900, color: C.text }}>{p.symbol}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: C.faint }}>{p.market}</span>
        {!p.origin && (
          <span title="Whether this name is held or only on the conviction bench is not known to this card."
            style={{ fontSize: 11.5, fontWeight: 800, padding: '1px 6px', borderRadius: 3, border: `1px dashed ${C.faint}`, color: C.faint }}>
            BOOK / BENCH not stated</span>
        )}
        {p.origin && (
          <span title={p.origin === 'bench'
            ? 'On the conviction bench and passing the quality preset. NOT a holding — this is a candidate, and nothing here implies you own it.'
            : p.origin === 'both'
              ? 'Held, and also on the conviction bench.'
              : 'In your book.'}
            style={{
              fontSize: 11.5, fontWeight: 800, padding: '1px 6px', borderRadius: 3,
              border: `1px solid ${ORIGIN_META[p.origin].color}`,
              color: ink(ORIGIN_META[p.origin].color),
            }}>{ORIGIN_META[p.origin].icon} {ORIGIN_META[p.origin].short}</span>
        )}
        {p.tier && (
          <span title="Conviction label from the results grading. It describes the quarter's print and never sets the thesis status."
            style={{ fontSize: 12, fontWeight: 800, padding: '1px 7px', borderRadius: 3,
              border: `1px solid ${C.border}`, color: C.dim }}>conviction · {p.tier}</span>
        )}
        {pm && p.pattern && (
          // zzz775: a nearest fit says so — "nearest A", dashed — and is never
          // shown as if the classifier's own test had fired.
          <span data-testid="pattern-badge" data-fit={p.pattern.fit || 'exact'} title={p.pattern.because} style={{
            fontSize: 12, fontWeight: 800, padding: '1px 7px', borderRadius: 3,
            border: `1px ${p.pattern.fit === 'nearest' ? 'dashed' : 'solid'} ${pm.color}`, background: p.pattern.fit === 'nearest' ? 'transparent' : `${pm.color}18`, color: ink(pm.color),
          }}>{pm.icon} {p.pattern.fit === 'nearest' ? `nearest ${p.pattern.pattern}` : p.pattern.pattern} · {pm.name}{p.pattern.fit === 'nearest' ? ' · nearest fit (auto, provisional)' : ''}</span>
        )}
        {p.radarScore != null && (
          <span style={{ fontSize: 12, fontWeight: 800, color: '#A78BFA' }}>🚀 T-{Math.round(p.radarScore)}</span>
        )}
        {p.onThesisType && (
          <select
            aria-label="Thesis type"
            title={p.thesisType ? 'Thesis type set by you — choose "auto" to return to the automatic classification.' : p.pattern?.fit === 'nearest' ? `${p.pattern.because}` : p.pattern ? 'Automatic thesis type from the quarter\'s figures — you can override it.' : 'No thesis type fits automatically, so no variable can move this card. Set why you hold it.'}
            value={p.thesisType || ''}
            onChange={(e) => p.onThesisType!((e.target.value || null) as any)}
            style={{ fontSize: 12, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: 'transparent', color: p.pattern ? C.dim : '#F59E0B', border: `1px solid ${p.pattern ? C.border : '#F59E0B'}`, cursor: 'pointer' }}>
            <option value="">{p.pattern && !p.thesisType ? `thesis: auto (${p.pattern.fit === 'nearest' ? `nearest ${p.pattern.pattern}` : p.pattern.pattern})` : 'thesis: not set — pick'}</option>
            <option value="A">A · Operating inflection</option>
            <option value="B">B · Demand explosion</option>
            <option value="F">F · Profit jump</option>
            <option value="G">G · Silent quality</option>
          </select>
        )}
        {p.dataSource === 'screener' && (
          <span title="These figures are screener.in's, not read from the filing by this portal's own engine. Wider coverage, one step further from the document."
            style={{ fontSize: 11.5, fontWeight: 800, padding: '1px 6px', borderRadius: 3,
              border: `1px solid ${C.faint}`, color: C.faint }}>screener.in data</span>
        )}
        {p.dataSource === 'screener-live' && (
          <span title="Figures parsed from screener.in's company page (quarterly results table, year-on-year; cash conversion is the latest full year). Not read from the filing by this portal's engine."
            style={{ fontSize: 11.5, fontWeight: 800, padding: '1px 6px', borderRadius: 3,
              border: `1px solid ${C.faint}`, color: C.faint }}>screener.in table{p.dataPeriod ? ` · ${p.dataPeriod}` : ''}</span>
        )}
        {p.dataSource === 'none' && (
          <span title="This holding is in neither the graded bench nor the screener exports. Read the filing to populate it — nothing about it is being reported as clean."
            style={{ fontSize: 11.5, fontWeight: 800, padding: '1px 6px', borderRadius: 3,
              border: `1px solid ${C.amber}`, color: C.amber }}>no stored figures</span>
        )}

        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {sm && (
            <span title={sm.meaning} style={{
              fontSize: 12.5, fontWeight: 900, padding: '2px 9px', borderRadius: 3,
              border: `1px solid ${sm.color}`, background: `${sm.color}18`, color: ink(sm.color),
            }}>{sm.dot} {sm.label}{p.pattern?.fit === 'nearest' && !p.thesisType && a?.status !== 'THESIS_NOT_SET' ? ' (provisional thesis)' : ''}</span>
          )}
          {p.needsRead && !p.reading && (
            <button onClick={p.onRead} style={{
              fontSize: 13, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
              border: `1px solid ${C.border}`, background: 'transparent', color: C.cyan, cursor: 'pointer',
            }}>✨ Read evidence</button>
          )}
          {p.reading && <span style={{ fontSize: 13, color: C.dim }}>Reading the latest document…</span>}
          {a && (
            <button onClick={() => setOpen((v) => !v)} style={{
              fontSize: 12.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999,
              border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, cursor: 'pointer',
            }}>{open ? 'Less' : 'Evidence'}</button>
          )}
        </span>
      </div>

      {p.error && <div style={{ marginTop: 7, fontSize: 13.5, color: C.amber }}>{p.error}</div>}

      {/* ── EVIDENCE STATE — from the ledger, so it survives a reload. (zzz740)
          Period, documents read, when, and whether anything newer exists. */}
      {(p.ledger || p.freshness) && (() => {
        const l = p.ledger;
        const period = p.reportingPeriod || l?.latest_period || null;
        const pr = period && l ? l.periods[period] : null;
        const fr = p.freshness;
        // Reporting-period freshness: which quarter is on file against the one
        // that should be by now. (zzz765)
        const fl = freshnessLine(fr);
        const frColor = fl?.tone === 'ok' ? C.up : fl?.tone === 'warn' ? C.amber : fl?.tone === 'alarm' ? C.alarm : C.dim;
        return (
          <div style={{ marginTop: 7, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: C.dim }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.faint }}>EVIDENCE</span>
            {pr ? (
              <span title={`Reporting period ${pr.reporting_period}${pr.period_end_date ? ` (quarter ended ${pr.period_end_date})` : ''} · newest document ${pr.latest_document_date || 'undated'} · read ${pr.extracted_at.slice(0, 10)}${pr.updated_at !== pr.extracted_at ? ` · updated ${pr.updated_at.slice(0, 10)}` : ''}`}>
                <b style={{ color: C.text }}>{pr.reporting_period}</b> · {pr.documents_read} document{pr.documents_read === 1 ? '' : 's'} read
                {pr.documents_failed > 0 && <> · {pr.documents_failed} unavailable</>}
                {' '}· {pr.facts.length} facts · last updated {pr.updated_at.slice(0, 10)}
              </span>
            ) : <span>no persisted evidence</span>}
            {fr && fl && (
              <span title={fr.detail} style={{ width: '100%', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 15, lineHeight: 1.4, color: C.text }}>
                <span style={{ fontSize: 15, fontWeight: 800, padding: '2px 8px', borderRadius: 4, border: `1.5px solid ${frColor}`, color: frColor }}>{fl.label}</span>
                {fl.text && <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{fl.text}</span>}
              </span>
            )}
            {p.persisted === false && (
              <span style={{ fontSize: 11.5, fontWeight: 800, padding: '1px 7px', borderRadius: 3, border: `1px solid ${C.alarm}`, color: C.alarm }} title="The read succeeded but the write to the evidence store failed. This will not survive a reload.">NOT SAVED</span>
            )}
            {!p.reading && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {p.onCheck && pr && (
                  <button onClick={p.onCheck} title="Search the sources for a document newer than the one on file. No model call." style={{
                    fontSize: 12.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, cursor: 'pointer',
                  }}>↻ Check for new evidence</button>
                )}
                {p.onRead && pr && fr?.state === 'NEW_EVIDENCE_AVAILABLE' && (
                  <button onClick={p.onRead} title="Read the newer documents, add the new period to the ledger, keep the old one." style={{
                    fontSize: 12.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999, border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber, cursor: 'pointer',
                  }}>✨ Read latest evidence</button>
                )}
                {p.onReread && pr && (
                  <button onClick={p.onReread} title="Re-run extraction on the current period's documents and update the persisted record. Debug / manual refresh; the normal path is incremental." style={{
                    fontSize: 12.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, border: `1px solid ${C.border}`, background: 'transparent', color: C.faint, cursor: 'pointer',
                  }}>↻ Re-read current period</button>
                )}
              </span>
            )}
            {p.readNote && <span style={{ width: '100%', color: p.persisted === false ? C.alarm : C.faint }}>{p.readNote}</span>}
          </div>
        );
      })()}

      {/* ── WHAT CHANGED vs EVIDENCE FOUND.                         (zzz773)
          "WHAT CHANGED · Q1 FY27 (first read)" printed "Capacity added:
          150,000 MTPA · previous: not disclosed (first reading)" — nothing
          had changed, because nothing comparable existed before. A line is
          a CHANGE only when a comparable previous value exists and differs;
          everything else is EVIDENCE FOUND for the period. Deteriorations
          first. (zzz740) */}
      {p.changed && p.changed.length > 0 && (() => {
        // An unchanged value is never a change, whatever the line's kind. (zzz775)
        const isChange = (c: ChangeLine) => (c.kind ? c.kind === 'change' : !!p.changedFrom && c.sign !== '·') && !/·\s*unchanged\b/i.test(c.text);
        const moves = p.changed.filter(isChange);
        const found = p.changed.filter((c) => !isChange(c));
        const lineOf = (c: ChangeLine, i: number) => {
          // The time-series reading, when the variables layer supplied
          // one, replaces the free-text value: current → previous → Δ →
          // direction, with any non-current point labelled. (zzz771)
          const row = a?.checked.find((x) => x.key === c.metric) as any;
          const rd: VariableReading | null = row?.reading || null;
          // A QoQ-only row prints its level and labelled seasonal delta,
          // not the reading's "unclear" text. (zzz772)
          const rt = row && isQoqOnly(row) ? { text: chipValue(row), tags: [] as string[], displaced: false }
            : rd && rd.display ? readingText(rd) : null;
          const lbl = VAR_LABEL[c.metric] || '';
          const bare = c.text.startsWith(lbl) ? c.text.slice(lbl.length).replace(/^:?\s*(?:actual|management claim|guidance|target)?\s*/i, '') : c.text;
          const val = validateReading(c.metric, bare);
          const sign = isChange(c) ? c.sign : '·';
          return (
            <div key={i} style={{ fontSize: 13.5, lineHeight: 1.55, color: C.dim }} title={`Source: ${c.source}`}>
              <span style={{ fontWeight: 900, color: sign === '+' ? C.up : sign === '-' ? C.down : C.faint }}>{sign}</span>{' '}
              <span style={{ color: sign === '·' ? C.dim : C.text }}>{rt ? `${row.label}: ${rt.text}` : humanTokens(c.text)}</span>
              {rt && rt.tags.map((t) => <ClassTag key={t} word={t} />)}
              {val.state === 'UNCLEAR' && <span style={{ color: C.warn, fontSize: 12 }}> · {val.reason}</span>}
              {rt && row?.unjudged && !/historical/.test(String(row.unjudged)) && <span style={{ color: C.warn, fontSize: 12 }}> · {humanTokens(String(row.unjudged))}</span>}
            </div>
          );
        };
        const head = (t: string) => <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.faint, marginBottom: 3 }}>{t}</div>;
        return (
          <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg }}>
            {moves.length > 0 && (
              <div data-testid="what-changed">
                {head(`WHAT CHANGED${p.changedFrom ? ` · ${p.changedFrom} → ${p.reportingPeriod}` : p.reportingPeriod ? ` · ${p.reportingPeriod} vs the prior figure stated in the document` : ''}`)}
                {moves.map(lineOf)}
              </div>
            )}
            {found.length > 0 && (
              <div data-testid="evidence-found" style={{ marginTop: moves.length ? 6 : 0 }}>
                {head(`EVIDENCE FOUND${p.reportingPeriod ? ` · ${p.reportingPeriod}` : ''} — ${p.changedFrom ? 'no comparable earlier value, or unchanged' : 'no comparable prior value on file; not a change'}`)}
                {found.map(lineOf)}
              </div>
            )}
          </div>
        );
      })()}

      {/* The one-line verdict is always visible; the evidence expands. */}
      {a && (
        <div style={{ marginTop: 7, fontSize: 14, color: C.dim, lineHeight: 1.55 }}>
          <b style={{ color: ink(sm?.color) }}>{a.action}</b> — {a.actionLine.slice(a.action.length + 3)}
        </div>
      )}

      {/* ── THREE VERDICT DIMENSIONS, NEVER ONE LABEL.            (zzz771)
          Break trigger / direction / evidence, each its own chip and its own
          colour. Rendered only when the status engine supplies the split;
          the status line above stands alone otherwise. */}
      {a && a.verdict && (() => {
        const v = a.verdict;
        const bt = v.breakTrigger;
        // A condition on a variable this strategy does not rest on (cash for A)
        // is a financial warning, not a break signal: amber, and said so. (zzz771)
        const warnOnly = bt.fired && /financial warning only/i.test(bt.text) && !/^Fired: /.test(bt.text);
        const btColor = warnOnly ? C.warn : bt.fired ? C.alarm : (bt as any).unresolved?.length ? C.warn : C.up;
        const dirColor = v.direction === 'STRENGTHENING' ? C.up : v.direction === 'INTACT' ? '#3B82F6' : v.direction === 'WEAKENING' ? C.down : v.direction === 'UNCHANGED' ? C.flat : C.absent;
        const evColor = v.evidence === 'CONFIRMED' ? C.up : v.evidence === 'PARTIALLY_CONFIRMED' ? C.cyan : v.evidence === 'CONTRADICTED' ? C.down
          : v.evidence === 'NOT_CONTRADICTED' ? C.flat : C.absent;
        // ── A CONTRADICTED VARIABLE IS NOT A MISSING ONE.            (zzz772)
        // CYIENTDLM's working capital moved the wrong way and was listed under
        // "missing". The status engine now names contradicted variables
        // (`coverage.contradicted`, optional); they print first, in red, and
        // are filtered out of "missing" by name here as well.
        const contradicted: string[] = Array.isArray((v.coverage as any).contradicted) ? (v.coverage as any).contradicted.filter(Boolean) : [];
        const contraSet = new Set(contradicted.map((x) => String(x).trim().toLowerCase()));
        // zzz777: an adverse earlier-period reading still open is historical
        // unresolved — never printed as contradicted.
        const histOpen: string[] = Array.isArray((v.coverage as any).historical) ? (v.coverage as any).historical.filter(Boolean) : [];
        const histSet = new Set(histOpen.map((x) => String(x).trim().toLowerCase()));
        const missing = (v.coverage.missing || []).filter((x) => !contraSet.has(String(x).trim().toLowerCase()) && !histSet.has(String(x).trim().toLowerCase()));
        const chip = (color: string, dashed: boolean, title: string, body: React.ReactNode, testid: string) => (
          <span data-testid={testid} title={title} style={{
            fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 4, lineHeight: 1.5, maxWidth: '100%',
            border: `1px ${dashed ? 'dashed' : 'solid'} ${color}`, background: dashed ? 'transparent' : `color-mix(in srgb, ${color} 12%, transparent)`, color: ink(color),
          }}>{body}</span>
        );
        return (
          <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
            {chip(btColor, false, bt.text, <>BREAK TRIGGER: <b>{!bt.fired ? ((bt as any).unresolved?.length ? `none fired now — unresolved from prior period: ${(bt as any).unresolved.join('; ')}` : 'none fired') : warnOnly ? `none — financial warning only: ${bt.conditions.join('; ') || bt.text}` : `fired: ${bt.conditions.join('; ') || bt.text}`}</b>
              {/* zzz773: a condition on a variable not mapped to this thesis is WATCH — named, not fired. */}
              {/Watch — /.test(bt.text) && <span data-testid="verdict-watch" style={{ fontWeight: 600, color: ink(C.warn) }}> · watch (not mapped to this thesis, status unchanged): {bt.text.split(/Watch — [^:]*: /)[1]?.replace(/\.$/, '')}</span>}</>, 'verdict-break')}
            {chip(dirColor, v.direction === 'UNKNOWN', v.directionWhy, <>DIRECTION: <b>{DIRECTION_WORD[v.direction]}</b>{v.directionWhy ? <span style={{ fontWeight: 500 }}> — {v.directionWhy}</span> : null}</>, 'verdict-direction')}
            {chip(evColor, v.evidence === 'UNCHECKED' || v.evidence === 'INCOMPLETE', v.evidenceWhy,
              <>{v.evidence === 'INCOMPLETE' ? 'EVIDENCE COMPLETENESS' : 'EVIDENCE'}: <b>{EVIDENCE_WORD[v.evidence]}</b> ({v.coverage.confirmed}/{v.coverage.applicable} structural)
                {contradicted.length ? <span data-testid="evidence-contradicted" style={{ fontWeight: 700, color: ink(C.down) }}> · contradicted: {contradicted.join(', ')}</span> : null}
                {histOpen.length ? <span data-testid="evidence-historical" style={{ fontWeight: 700, color: ink(C.warn) }}> · historical unresolved: {histOpen.join(', ')}</span> : null}
                {missing.length ? <span style={{ fontWeight: 500 }}> · missing: {missing.join(', ')}</span> : null}</>, 'verdict-evidence')}
          </div>
        );
      })()}

      {/* ── THE VARIABLE BOARD, GROUPED, ALWAYS VISIBLE.         (zzz720)
          Revenue and margin tell you WHAT happened; capacity, utilisation,
          capex, orders and guidance tell you WHY and whether it continues.
          So the financial group is one row among several rather than the
          whole card, and a hollow ○ is a variable nobody looked at — never a
          variable that was checked and did not move. */}
      {a && (
        <div data-testid="current-period-head" style={{ marginTop: 8, fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.dim }}>
          {periodHead(a.currentPeriod || p.reportingPeriod)}
        </div>
      )}
      {a && (() => {
        const byGroup = new Map<VarGroup, typeof a.checked>();
        for (const c of a.checked) {
          const g = VAR_GROUP[c.key] || 'financial';
          if (!byGroup.has(g)) byGroup.set(g, [] as any);
          (byGroup.get(g) as any).push(c);
        }
        // A thesis whose ledger does not list capex_earning still owns the
        // question when a capital programme is on file: the row is added to
        // the CAPEX group from the chain so the answer is never off the
        // board. Nothing is added where there is no capex at all. (zzz771)
        const ce = p.capex?.earning;
        if (ce && !a.checked.some((c) => c.key === 'capex_earning') && (p.capex!.state !== 'none' || ce.state !== 'UNKNOWN')) {
          const g = VAR_GROUP['capex_earning'] || 'capex';
          if (!byGroup.has(g)) byGroup.set(g, [] as any);
          (byGroup.get(g) as any).push({ key: 'capex_earning', label: 'Capex earning', weight: 2, verdict: ce.state === 'UNKNOWN' ? 'unknown' : 'stated',
            before: null, after: null, delta: null, evidence: ce.lines.join(' · '), invalidation: null, absence: null, state: ce.state === 'UNKNOWN' ? 'NOT_DISCLOSED' : 'FOUND', stateReason: null, why: '' });
        }
        return (
          <div style={{ marginTop: 8 }}>
            {GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => {
              const items = byGroup.get(g)!;
              const read = items.filter((c) => c.verdict !== 'unknown').length;
              return (
                <div key={g} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' }}>
                  <span style={{
                    fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: read ? C.dim : C.faint,
                    minWidth: 128, textAlign: 'right', paddingTop: 2,
                  }}>{GROUP_LABEL[g].split(' — ')[0]}</span>
                  <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
                    {items.map((c) => {
                      const v = VERDICT[c.verdict];
                      // ── "CAPEX EARNING YET?" IS THE STRUCTURED BLOCK. (zzz771)
                      // State label plus spent / revenue / utilisation /
                      // margin, from the chain — never "— Capex earning".
                      if (c.key === 'capex_earning' && p.capex?.earning) {
                        return <CapexEarningBlock key={c.key} e={p.capex.earning} inline />;
                      }
                      const lifecycle = c.key === 'capex_earning' && capexLine;
                      const un = c.verdict === 'unknown' && !lifecycle;
                      const ab = un ? (c.absence ? ABSENCE_MARK[c.absence] : ABSENCE_MARK.not_read) : null;
                      const isCore = c.weight >= 4;
                      const tr = rowTreatment(c as any);
                      const T = ROW_TREATMENT[tr];
                      // A QoQ-only level is read and shown, not unclear. (zzz772)
                      const unclear = (c as any).state === 'UNCLEAR' && tr !== 'QOQ_ONLY';
                      const stand = standingText(c as any, a.currentPeriod || p.reportingPeriod);
                      const shownVal = stand ? stand.value : !un && (c.before || c.after || c.delta) ? chipValue(c as any) : '';
                      const tWord = stand ? stand.word : treatmentWord(tr, c as any, shownVal);
                      const rd: VariableReading | null = (c as any).reading || null;
                      const tags = rd && rd.display ? readingText(rd).tags : [];
                      if (lifecycle) {
                        return (
                          <span key={c.key} title={`Capex lifecycle, from the documents read:\n${(p.capex?.lifecycleProjects || []).map((x) => `${x.name}: ${x.line}`).join('\n')}`}
                            style={{ fontSize: 12, fontWeight: 600, padding: '1px 6px', borderRadius: 4, color: C.text,
                              border: `1px solid ${C.border}`, background: C.bg2 }}>
                            ◐ Capex lifecycle: <b>{lifecycle}</b>
                          </span>
                        );
                      }
                      // Absence is never coloured and never competes with a
                      // finding; it gets a DASHED grey outline and a "?" so it
                      // reads as "missing" rather than as "bad" — and never
                      // as "unchanged". (zzz723, zzz771)
                      const absentLike = un || unclear;
                      return (
                        <span key={c.key} data-testid={`row-${c.key}`} data-treatment={tr}
                          title={un
                            ? `${c.label} — ${stateLine(c as any)}. ${ab!.hint}${isCore ? '\n\nCORE to this thesis.' : ''}`
                            : unclear
                              ? `${c.label} — ${stateLine(c as any)}. Counted neither as confirmed nor as contradicted.\n\n${c.evidence}`
                              : `${c.label} — ${tWord}${tWord !== v.word ? ` · ${v.word}` : ''}.\n\n${c.evidence}${isCore ? '\n\nCORE to this thesis.' : ''}`}
                          style={{
                            fontSize: 12, fontWeight: isCore ? 800 : 600,
                            padding: '1px 6px', borderRadius: 4,
                            border: absentLike
                              ? `1px dashed ${C.absent}`
                              : `1px solid color-mix(in srgb, ${v.color} 45%, transparent)`,
                            color: absentLike ? C.absent : v.color,
                            background: absentLike ? 'transparent' : `color-mix(in srgb, ${v.color} 12%, transparent)`,
                          }}>
                          <span style={{ opacity: 1 }}>{un ? (tr === 'NOT_DISCLOSED' ? '?' : ab!.mark) : T.mark}</span>
                          {' '}{c.label}
                          {un && <span style={{ fontSize: 11 }}> · {T.word}</span>}
                          {/* ── BEFORE → NOW, NOT JUST THE DELTA.        (zzz761)
                              This row printed `delta || after`, so every
                              variable that HAD both sides showed only the
                              change: GOLDIAM's order book read "▲ Order book
                              +60.7%" while WHAT CHANGED, three inches below,
                              read "INR140 crores → INR225 crores (+60.7%)".
                              The before value was extracted, stored and then
                              discarded by the renderer — which is exactly the
                              "before and now not showing" the owner reported.
                              REDINGTON was the same bug wearing a different
                              hat: the chip showed the delta (−14%) and the
                              status sentence showed the level (32), so one
                              card stated two different numbers for one
                              variable. One field order, everywhere. */}
                          {shownVal ? (
                            <> <b>{shownVal}</b></>
                          ) : ''}
                          {/* The treatment word AFTER the value: "0.83× · single
                              reading", "→ UNCHANGED (two readings)". Confirmed
                              and contradicted are said by the mark and colour;
                              unclear is said by the value text itself. (zzz771) */}
                          {!un && (stand || tr === 'UNCHANGED' || tr === 'WITHIN_MATERIALITY' || tr === 'SINGLE' || tr === 'SILENT' || (tr === 'UNCLEAR' && !(c.before || c.after || c.delta)))
                            && <span style={{ fontSize: 11 }}> · {tWord}</span>}
                          {tags.map((t) => <ClassTag key={t} word={t} />)}
                          {(c as any).historical?.active && <ClassTag word={`${(c as any).historical.period} · HISTORICAL / UNRESOLVED`} />}
                          {(c as any).watch && <ClassTag word="WATCH" />}
                        </span>
                      );
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── THE EVIDENCE MATRIX.                                 (zzz727)
          "Core variables checked: 2/3" read as near-complete on a thesis that
          actually depends on nine things. Three counts cannot be misread as
          progress towards a finish line, and the denominator is now this
          ledger's own thesis-critical set rather than a generic model. */}
      {/* ── FINANCIAL WARNING, SEPARATE FROM THE STATUS.         (zzz738)
          EXICOM read "THESIS WEAKENING" on cash conversion 0.32× with no
          document read. The figure is real and belongs on the card in red.
          It does not, on its own, decide the status of a thesis whose
          mechanism nobody has examined. */}
      {a && a.financialWarning.length > 0 && (
        <div style={{ marginTop: 7, fontSize: 13, lineHeight: 1.55, padding: '6px 9px', borderRadius: 6,
          border: `1px solid ${C.down}`, background: `color-mix(in srgb, ${C.down} 10%, transparent)` }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.down }}>FINANCIAL WARNING </span>
          {a.financialWarning.map((w, i) => (
            <span key={i} style={{ color: C.text }}>{i > 0 ? ' · ' : ''}{w.label} <b style={{ color: C.down }}>{w.value}</b>
              {w.note && <span style={{ color: C.faint }}> ({w.note})</span>}</span>
          ))}
          <span style={{ color: C.faint }}> — shown, not counted towards the status{p.needsRead ? '; no document has been read yet' : ''}.</span>
        </div>
      )}

      {/* ── ONE-OFFS: A QUALIFICATION, NEVER HIDDEN.               (zzz784) */}
      {a && (a.qualification || []).length > 0 && (
        <div data-testid="one-off-qualification" style={{ marginTop: 7, fontSize: 13, lineHeight: 1.55, padding: '6px 9px', borderRadius: 6,
          border: `1px solid ${C.warn}`, background: `color-mix(in srgb, ${C.warn} 8%, transparent)` }}>
          {(a.qualification || []).map((q, i) => <div key={i} style={{ color: C.text }}>{rupee(q)}</div>)}
        </div>
      )}

      {/* ── HISTORICAL CONTEXT, APART FROM THE CURRENT PERIOD.    (zzz773)
          "Cash conversion -7.62× (last FY)" sat on the board as if it were
          Q1 FY27's reading and moved Q1 FY27's status. Every earlier-period
          figure is printed here instead, each with the status engine's own
          decision on whether it remains an active thesis condition. */}
      {a && historyItems(a, p.reportingPeriod).length > 0 && (
        <div data-testid="historical-context" style={{ marginTop: 7, fontSize: 13, lineHeight: 1.55, padding: '6px 9px', borderRadius: 6,
          border: `1px dashed ${C.faint}`, background: 'transparent' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.faint }}>
            HISTORICAL CONTEXT — earlier periods, not {a.currentPeriod || p.reportingPeriod || 'current-period'} evidence
          </div>
          {historyItems(a, p.reportingPeriod).map((h, i) => (
            <div key={i} data-testid="historical-item" data-active={h.active ? 'true' : 'false'} style={{ color: C.dim }} title={h.decision}>
              <span style={{ color: C.text }}>{h.label} — {h.period}: <b>{humanTokens(rupee(h.value))}</b> · historical</span>
              {h.current && <span style={{ color: C.faint }}> · {h.current}</span>}
              <span style={{ color: h.active ? ink(C.warn) : h.standing ? ink(C.up) : C.faint, fontWeight: h.active || h.standing ? 700 : 500 }}> · {h.active ? 'active thesis condition — historical / unresolved' : h.standing ? `standing test — satisfied (${h.period} figure)` : 'context only — not an active thesis condition'}</span>
              <div style={{ fontSize: 12, color: C.faint, paddingLeft: 10 }}>{(h.active || h.standing) && <b data-testid="standing-rule" style={{ color: C.dim }}>STANDING-CONDITION RULE — a policy, not current evidence: </b>}{h.decision}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── THE EVIDENCE MATRIX, THREE POPULATIONS.              (zzz738)
          "4 confirmed · 1 pending" counted revenue, margin, earnings and
          cash conversion as confirmations while every mechanism variable
          was unread. Output confirms the quarter was good. Mechanism
          confirms WHY. Forward confirms what comes next. They are never
          added together again. */}
      {a && (
        <div style={{ marginTop: 7, fontSize: 13, color: C.dim, lineHeight: 1.7 }}>
          {([
            // zzz784: the status line's X/Y, as a partition of the same per-variable states.
            ...(a.coverage.structural ? [['STRUCTURAL', a.coverage.structural, 'the X/Y in the status line — the strategy\'s structural variables plus evidenced drivers; every row in exactly one state']] : []),
            ['MECHANISM', a.coverage.mechanism, 'thesis-critical mechanism variables of this ledger (weight 3–4) — the WHY: capacity, utilisation, orders, capex, customers, one-offs'],
            ['OUTPUT', a.coverage.output, 'the result — revenue, margin, earnings, leverage'],
            ['FORWARD', a.coverage.forward, 'what management commits to next'],
          ] as Array<[string, { confirmed: number; pending: number; contradicted: number; stated?: number; flat?: number; unclear?: number; not_applicable?: number; core_variables?: number; total: number;
            watch?: number; historical?: number; silent?: number; statementOnly?: number; duplicate?: number;
            named?: { contradicted: string[]; pending: string[]; unclear: string[]; watch: string[]; historical?: string[]; statementOnly?: string[]; confirmed?: string[] } }, string]>)
            .filter(([, t]) => t.total > 0)
            .map(([name, t, hint]) => (
              <div key={name} title={hint} data-testid={`tally-row-${name.toLowerCase()}`}>
                <span style={{ display: 'inline-block', minWidth: 78, fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
                  color: name === 'MECHANISM' || name === 'STRUCTURAL' ? C.text : C.faint }}>{name}</span>
                <span style={{ color: C.faint }}>{t.core_variables ?? t.total} {name === 'STRUCTURAL' ? 'structural (status-line ratio)' : name === 'MECHANISM' ? 'thesis-critical' : 'core'} · </span>
                <b style={{ color: t.confirmed ? C.up : C.flat }}>{t.confirmed} confirmed</b>
                {' · '}
                <b style={{ color: t.pending ? C.warn : C.flat }}>{t.pending} pending</b>
                {' · '}
                <b style={{ color: t.contradicted ? C.down : C.flat }}>{t.contradicted} contradicted</b>
                {(t.historical || 0) > 0 && <span style={{ color: C.warn }} title="An adverse EARLIER-period reading still open — not a current-period contradiction."> · {t.historical} historical unresolved</span>}
                {(t.unclear || 0) > 0 && <span style={{ color: C.flat }} title="Read, but not judgeable either way — never counted as contradicted."> · {t.unclear} unclear</span>}
                {(t.stated || 0) > 0 && <span style={{ color: C.flat }}> · {t.stated} level only</span>}
                {(t.flat || 0) > 0 && <span style={{ color: C.flat }}> · {t.flat} flat</span>}
                {(t.not_applicable || 0) > 0 && <span style={{ color: C.faint }} title="Cannot apply to this business — never counted as pending."> · {t.not_applicable} n/a</span>}
                {(t.watch || 0) > 0 && <span style={{ color: C.warn }} title="Moved the wrong way, but not mapped to this thesis type — context, never status-changing."> · {t.watch} watch</span>}
                {(t.silent || 0) > 0 && <span style={{ color: C.flat }} title="A risk variable the documents did not mention: the check passes, but silence is not a reading."> · {t.silent} silent (passes, not a reading)</span>}
                {(t.statementOnly || 0) > 0 && <span style={{ color: C.warn }} title="Read only as a management statement or a target — never confirmed."> · {t.statementOnly} statement / target only</span>}
                {(t.duplicate || 0) > 0 && <span style={{ color: C.flat }} title="The same figure as another confirmed variable — counted once."> · {t.duplicate} same figure counted once</span>}
                {/* ── EVERY COUNT NAMES ITS VARIABLES.                    (zzz773)
                    "1 contradicted · of 4" named nothing; each non-confirmed
                    variable is listed with its figure. */}
                {t.named && ([
                  ...(name === 'STRUCTURAL' ? [['Confirmed', t.named.confirmed || [], C.up] as [string, string[], string]] : []),
                  ['Statement / target only', t.named.statementOnly || [], C.warn],
                  ['Historical unresolved', t.named.historical || [], C.warn],
                  ['Contradicted', t.named.contradicted, C.down], ['Pending', t.named.pending, C.warn],
                  ['Unclear', t.named.unclear, C.flat], ['Watch', t.named.watch, C.warn],
                ] as Array<[string, string[], string]>).filter(([, xs]) => xs.length > 0).map(([w, xs, col]) => (
                  <div key={w} data-testid={`tally-${name.toLowerCase()}-${w.toLowerCase().replace(/\s+/g, '-')}`} style={{ paddingLeft: 78, fontSize: 12.5, color: C.dim, lineHeight: 1.5 }}>
                    <b style={{ color: ink(col) }}>{w}:</b> {xs.map(humanTokens).join(' · ')}
                  </div>
                ))}
              </div>
            ))}
          {a.evidenceItems && (a.evidenceItems.structural.length + a.evidenceItems.supporting.length) > 0 && (
            <div data-testid="evidence-items" style={{ color: C.faint, marginTop: 2 }}>
              Evidence items in the documents: <span style={{ color: C.text }}>{a.evidenceItems.structural.length + a.evidenceItems.supporting.length}</span>
              {' '}— {a.evidenceItems.structural.length} count in the structural ratio{a.evidenceItems.supporting.length ? `, ${a.evidenceItems.supporting.length} supporting (not in the ratio): ${a.evidenceItems.supporting.join(' · ')}` : ''}
            </div>
          )}
          {a.coverage.missingCore.length > 0 && (
            <div style={{ color: C.faint, marginTop: 2 }}>
              Core unknown (not bad):{' '}
              <span style={{ color: C.text }}>{a.checked.filter((c) => c.weight >= 4 && c.verdict === 'unknown' && c.state !== 'NOT_APPLICABLE')
                .map((c) => `${c.label} — ${stateLine(c)}`).join(' · ')}</span>
            </div>
          )}
          {a.coverage.levelOnlyCore.length > 0 && (
            <div style={{ color: C.faint, marginTop: 2 }}>
              Level only, no comparison basis: <span style={{ color: C.text }}>{a.coverage.levelOnlyCore.join(', ')}</span>
            </div>
          )}
          {(a.coverage.unjudgedCore || []).length > 0 && (
            <div style={{ color: C.faint, marginTop: 2 }}>
              Shown, not judged: <span style={{ color: C.text }}>{a.coverage.unjudgedCore.join(' · ')}</span>
            </div>
          )}
          {a.coverage.missingNeedsFiling.length > 0 && p.needsRead && (
            <div style={{ color: C.faint, marginTop: 2 }}>
              {a.coverage.missingNeedsFiling.length} of the pending variables exist only in a filing, concall or
              exchange announcement — no amount of screener data will fill them.
            </div>
          )}
        </div>
      )}

      {a && open && (
        <>
          {/* ── WHAT CHANGED — facts only. ─────────────────────────────── */}
          <Section label={`${periodHead(a.currentPeriod || p.reportingPeriod)} · ${changed.length} variable${changed.length === 1 ? '' : 's'} read from the evidence`}>
            {changed.length === 0 && (
              <div style={{ fontSize: 13.5, color: C.dim }}>
                Nothing structural was disclosed. That is silence, not bad news.
              </div>
            )}
            {changed.map((c) => {
              const v = VERDICT[c.verdict];
              const tr = rowTreatment(c as any);
              const T = ROW_TREATMENT[tr];
              const rdTags = (c as any).reading?.display ? readingText((c as any).reading).tags : [];
              // The structured "capex earning yet?" answer replaces the free
              // sentence on this row too. (zzz771)
              if (c.key === 'capex_earning' && p.capex?.earning) {
                return (
                  <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' }}>
                    <span style={{ color: ink(EARNING_COLOR[p.capex.earning.state]), fontSize: 13.5, fontWeight: 900, width: 12 }}>{T.mark}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text, minWidth: 132 }}>{c.label}</span>
                    <span style={{ flex: 1 }}><CapexEarningBlock e={p.capex.earning} inline={false} /></span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: C.faint }}>W{c.weight}</span>
                  </div>
                );
              }
              return (
                <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' }} data-treatment={tr}>
                  <span style={{ color: tr === 'UNCLEAR' ? C.absent : v.color, fontSize: 13.5, fontWeight: 900, width: 12 }}>{T.mark}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text, minWidth: 132 }}>{c.label}</span>
                  <span style={{ fontSize: 13.5, color: C.text, minWidth: 190 }}>
                    {(() => {
                      const cc = c as any;
                      const tag = STATEMENT_TAG[cc.statement || (cc.source === 'grader' ? 'ACTUAL' : '')];
                      const note = priorNote(cc, a.historyDepth);
                      const doc = (p.documentsRead || []).find((d) => d.label === cc.sourceLabel);
                      const stand = standingText(cc, a.currentPeriod || p.reportingPeriod);
                      return (
                        <>
                          <b>{stand ? stand.value : chipValue(cc)}</b>
                          {stand ? <span style={{ color: C.flat, fontSize: 12 }}> · {stand.word}</span>
                            : (tr === 'UNCHANGED' || tr === 'WITHIN_MATERIALITY' || tr === 'SINGLE' || tr === 'SILENT') && <span style={{ color: C.flat, fontSize: 12 }}> · {treatmentWord(tr, cc, chipValue(cc))}</span>}
                          {rdTags.map((t) => <ClassTag key={t} word={t} />)}
                          {cc.historical?.active && <ClassTag word={`${cc.historical.period} · HISTORICAL / UNRESOLVED`} />}
                          {cc.watch && <ClassTag word="WATCH — not mapped to this thesis" />}
                          {cc.comparison?.change_type === 'UNCHANGED' && cc.comparison?.basis === 'WITHIN_DOCUMENT' && tr !== 'UNCHANGED' && <b style={{ color: C.flat }}> · FLAT</b>}
                          <span style={{ display: 'block', fontSize: 12, color: C.dim, marginTop: 1 }}>
                            {tag && <b style={{ color: tag.color, letterSpacing: 0.3 }}>{tag.word}</b>}
                            {cc.asOf && <span>{tag ? ' · ' : ''}{cc.statement === 'HISTORICAL' ? 'dated ' : ''}{cc.asOf}</span>}
                            {cc.comparison?.previous && cc.comparison.basis !== 'NONE' && (
                              <span> · {cc.comparison.previous_period
                                ? `${cc.comparison.previous_period} → ${cc.comparison.current_period}, ${BASIS_LABEL[cc.comparison.basis as keyof typeof BASIS_LABEL]}`
                                : BASIS_LABEL[cc.comparison.basis as keyof typeof BASIS_LABEL]}</span>
                            )}
                            {note && <span> · {note}</span>}
                            {cc.sourceLabel && (
                              <> · {doc?.url
                                ? <a href={doc.url} target="_blank" rel="noopener noreferrer" title={cc.quote || ''} style={{ color: C.cyan, textDecoration: 'underline' }}>{cc.sourceLabel} ↗</a>
                                : <span title={cc.quote || ''}>{cc.sourceLabel}</span>}</>
                            )}
                          </span>
                          {cc.plan && (
                            <span style={{ display: 'block', fontSize: 12.5, color: C.cyan }}>
                              {cc.plan.type === 'TARGET' ? 'Target' : 'Guidance / plan'}: <b>{cc.plan.value}</b>
                              {cc.plan.gap && <span style={{ color: C.text }}> · actual vs target {cc.plan.gap}</span>}
                            </span>
                          )}
                          {cc.retyped && (
                            <span style={{ display: 'block', fontSize: 12, color: C.faint }}>read as {String(cc.statement || '').toLowerCase().replace('_', ' ')}: {cc.retyped}</span>
                          )}
                          {Array.isArray(cc.context) && cc.context.length > 0 && (
                            <span style={{ display: 'block', fontSize: 12, color: C.faint }}>
                              Historical context: {cc.context.map((x: any) => `${x.value} (${x.asOf})`).join(' · ')}
                            </span>
                          )}
                        </>
                      );
                    })()}
                    {/* ── TWO DOCUMENTS, TWO NUMBERS. (zzz759) The written
                        source supplies the value; the disagreement is shown
                        rather than resolved out of sight. */}
                    {c.conflict && c.conflict.length > 0 && (
                      <span style={{ display: 'block', fontSize: 11.5, fontWeight: 800, color: C.warn }}
                        title={c.conflict.map((x) => `${x.value} — ${x.source}`).join('\n')}>
                        ⚠ sources disagree: {c.conflict.map((x) => x.value).join(' / ')}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 13, color: C.dim, flex: 1 }}>
                    {/* CAUSE AND WHETHER IT REPEATS — the two questions a
                        number cannot answer about itself. Extracted from the
                        sentence, never inferred: "not disclosed" is printed
                        wherever the document gave no reason. */}
                    {c.comparison?.cause && (
                      <span style={{
                        display: 'inline-block', marginRight: 6, padding: '0 4px', borderRadius: 3,
                        fontSize: 11, fontWeight: 800, letterSpacing: 0.3,
                        color: c.comparison.cause.persistence === 'STRUCTURAL' ? C.up
                          : c.comparison.cause.persistence === 'TEMPORARY' ? C.warn : C.faint,
                        border: `1px solid ${C.border}`,
                      }} title={c.comparison.cause.persistence_because}>
                        {c.comparison.cause.persistence}
                      </span>
                    )}
                    {c.comparison && (c.comparison.change_type === 'INCREASED' || c.comparison.change_type === 'DECREASED') && !c.comparison.cause && (
                      <span style={{ color: C.warn }}>CAUSE NOT DISCLOSED · </span>
                    )}
                    {c.evidence}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: C.faint }}>W{c.weight}</span>
                </div>
              );
            })}
          </Section>

          {/* ══ CHANGE DETECTION — the longitudinal block. ══════ (zzz758)
              Everything above reads ONE filing. This reads the ledger: what
              each figure was the last time it was disclosed, what it is now,
              on what basis the two are being compared, the reason the company
              gave, and whether that reason repeats. Where the ledger holds
              only one period, it says so rather than implying the company
              withheld a comparison it was never asked for. */}
          <Section label={`CHANGE vs PREVIOUS DISCLOSURE · ${a.historyDepth} reporting period${a.historyDepth === 1 ? '' : 's'} on file`}>
            {a.historyDepth <= 1 && (
              <div style={{ fontSize: 13.5, color: C.dim, lineHeight: 1.55 }}>
                This is the first period read for this holding, so every figure below is a first observation and
                <b style={{ color: C.text }}> no previous value exists to compare against</b>. Nothing is inferred to fill
                that gap. The next read turns these levels into directions.
              </div>
            )}
            {a.historyDepth > 1 && a.changes.length === 0 && (
              <div style={{ fontSize: 13.5, color: C.dim }}>
                Earlier periods are on file and nothing comparable moved between them.
              </div>
            )}
            {a.changes.map((m) => {
              const tone = m.change_type === 'DECREASED' || m.change_type === 'NOT_DISCLOSED' ? C.down
                : m.change_type === 'INCREASED' ? C.up : C.flat;
              return (
                <div key={m.key} style={{ padding: '3px 0', borderTop: `1px solid ${C.border}` }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: tone, letterSpacing: 0.3, minWidth: 96 }}>
                      {m.change_type.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text, minWidth: 132 }}>{m.label}</span>
                    <span style={{ fontSize: 13.5, color: C.dim, flex: 1 }}>
                      <span style={{ color: C.faint }}>{m.previous ? `${m.previous.raw}${m.previous_period ? ` (${m.previous_period})` : ''} → ` : 'previous: NOT DISCLOSED · '}</span>
                      <b style={{ color: C.text }}>{m.current ? m.current.raw : 'not disclosed'}</b>
                      {m.change && <span style={{ color: tone, fontWeight: 800 }}> {m.change}</span>}
                      {m.change_relative && <span style={{ color: C.faint }}> ({m.change_relative})</span>}
                      <span style={{ color: C.faint }}> · {BASIS_LABEL[m.basis]}</span>
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: C.dim, paddingLeft: 104, lineHeight: 1.5 }}>
                    {m.cause
                      ? <>
                        <b style={{ color: m.cause.persistence === 'STRUCTURAL' ? C.up : m.cause.persistence === 'TEMPORARY' ? C.warn : C.faint }}>
                          {m.cause.persistence}
                        </b>
                        {' — stated cause: '}{m.cause.text}
                        <span style={{ color: C.faint }}> ({m.cause.persistence_because} Read from “{m.cause.connective}” in {m.source}.)</span>
                      </>
                      : (m.change_type === 'INCREASED' || m.change_type === 'DECREASED')
                        ? <span style={{ color: C.warn }}>CAUSE NOT DISCLOSED — the document states the change and gives no reason for it, so whether it repeats is unknown.</span>
                        : <span style={{ color: C.faint }}>{m.line}</span>}
                    {m.promised && (
                      <div style={{ color: C.faint }}>
                        Management said in {m.promised.period}: {m.promised.kind.toLowerCase()} {m.promised.value} — this is the actual it will be graded against.
                      </div>
                    )}
                    {m.forward && (
                      <div style={{ color: C.faint }}>
                        Forward: {m.forward.kind.toLowerCase()} {m.forward.value} — a claim about the future, not a reported figure.
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {a.changes.length > 0 && (
              <div style={{ fontSize: 12.5, color: C.faint, marginTop: 5 }}>
                Causes: {a.causeSummary.structural} structural · {a.causeSummary.temporary} temporary ·{' '}
                {a.causeSummary.unclassified} stated but unclassified · {a.causeSummary.none} moves with no reason given.
              </div>
            )}
            {a.statusChangeReason && (
              <div style={{ fontSize: 13, color: C.text, marginTop: 5, fontWeight: 700 }}>
                STATUS CHANGED — {a.statusChangeReason}
              </div>
            )}
          </Section>

          {/* ── STRUCTURAL SIGNAL — the mechanism, as a chain. ─────────── */}
          <Section label="STRUCTURAL SIGNAL — the mechanism this thesis depends on">
            <div style={{ fontSize: 14, color: C.text, display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {a.thesis.mechanism.map((m, i) => (
                <span key={i}>
                  <span style={{ color: C.text }}>{m}</span>
                  {i < a.thesis.mechanism.length - 1 && <span style={{ color: C.faint }}> → </span>}
                </span>
              ))}
            </div>
            {a.mechanismCheck.map((m) => {
              const col = m.state === 'confirmed' ? C.green : m.state === 'contradicted' ? C.red : (m.state as string) === 'historical' ? C.warn : C.faint;
              const mark = m.state === 'confirmed' ? '✓' : m.state === 'contradicted' ? '✕' : m.state === 'unclear' ? '?' : (m.state as string) === 'historical' ? '◷' : '○';
              return (
                <div key={m.link} style={{ fontSize: 13.5, color: C.dim, padding: '1px 0' }}>
                  <span style={{ color: col, fontWeight: 900, marginRight: 6 }}>{mark}</span>{m.link}
                  <span style={{ color: C.faint, fontSize: 12.5 }}> · {(m.state as string) === 'historical' ? 'historical unresolved (earlier period)' : m.state}</span>
                </div>
              );
            })}
            <div style={{ marginTop: 5, fontSize: 13.5, fontWeight: 800,
              color: a.mechanismVerdict.includes('CONTRADICTED') ? C.red
                : a.mechanismVerdict.includes('NOT YET') ? C.amber : C.green }}>
              → {a.mechanismVerdict}
            </div>
          </Section>

          {/* ── CAPEX CHAIN ───────────────────────────────────────────── */}
          {p.capex && (p.capex.state !== 'none' || (p.capex.lifecycleProjects || []).length > 0) && (() => {
            const m = CAPEX_META[p.capex!.state];
            return (
              <Section label="CAPEX LIFECYCLE — announced → spent → capacity → commissioned → commercial production → utilisation → revenue → margin → ROCE / FCF" color={m.color}>
                <div style={{ fontSize: 13, fontWeight: 900, color: ink(m.color), marginBottom: 4 }}>
                  {m.dot} {m.label}
                </div>
                {!(p.capex!.lifecycleProjects || []).length && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 5 }}>
                  {p.capex!.links.map((l, i) => (
                    <span key={i} style={{
                      fontSize: 12, padding: '1px 6px', borderRadius: 3,
                      border: `1px solid ${l.known ? C.border : 'transparent'}`,
                      background: l.known ? C.bg2 : 'transparent',
                      color: l.known ? C.text : C.faint,
                      textDecoration: l.known ? 'none' : 'line-through',
                    }}>{l.name}{l.value ? ` ${l.value}` : ''}</span>
                  ))}
                </div>}
                {/* ── THE LIFECYCLE, ACROSS EVERY QUARTER ON FILE. (zzz765)
                    Announced → spent → built → commissioned → producing →
                    earning. A later quarter adds a layer; none is erased. */}
                {/* ── PROJECT BY PROJECT: actual ✓ · target ◌ · implied ◐ · pending ○. (zzz770)
                    Announced ≠ spent ≠ earning; revenue contribution ≠ margin contribution. */}
                {(p.capex!.lifecycleProjects || []).map((pj) => (
                  <div key={pj.project_id} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{pj.name}</div>
                    <div style={{ fontSize: 13, color: C.text, marginBottom: 3 }}>{pj.line}</div>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
                      {pj.steps.map((st, i) => (
                        <span key={st.step} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <span title={st.state === 'actual' ? `ACTUAL — ${st.quote || st.value || ''}${st.source ? `\nSource: ${st.source}` : ''}`
                              : st.state === 'target' ? `TARGET / EXPECTED — not yet happened. ${st.quote || st.value || ''}${st.source ? `\nSource: ${st.source}` : ''}`
                                : st.state === 'implied' ? 'Implied by a later stage that is disclosed; not itself disclosed.'
                                  : 'Nothing on file for this step.'}
                            style={{
                              padding: '1px 6px', borderRadius: 3, fontWeight: st.state === 'actual' ? 800 : 500,
                              color: st.state === 'actual' ? C.text : st.state === 'target' ? ink(C.cyan) : C.faint,
                              border: `1px ${st.state === 'target' ? 'dashed' : 'solid'} ${st.state === 'actual' ? C.up : st.state === 'target' ? C.cyan : C.border}`,
                              background: st.state === 'actual' ? `color-mix(in srgb, ${C.up} 12%, transparent)` : 'transparent',
                            }}>
                            {st.state === 'actual' ? '✓' : st.state === 'target' ? '◌' : st.state === 'implied' ? '◐' : '○'} {LIFECYCLE_LABEL[st.step]}
                            {st.state === 'target' ? ' (target)' : ''}
                          </span>
                          {i < pj.steps.length - 1 && <span style={{ color: C.faint }}>→</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {!(p.capex!.lifecycleProjects || []).length && p.capex!.stage && (
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center', marginBottom: 5, fontSize: 12.5 }}>
                    {CAPEX_STAGES.map((st, i) => {
                      const reached = CAPEX_STAGES.indexOf(p.capex!.stage!) >= i;
                      return (
                        <span key={st} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <span style={{
                            padding: '1px 6px', borderRadius: 3, fontWeight: reached ? 800 : 500,
                            color: reached ? C.text : C.faint,
                            border: `1px solid ${reached ? C.up : C.border}`,
                            background: reached ? `color-mix(in srgb, ${C.up} 12%, transparent)` : 'transparent',
                          }}>{reached ? '✓ ' : ''}{STAGE_LABEL[st]}</span>
                          {i < CAPEX_STAGES.length - 1 && <span style={{ color: C.faint }}>→</span>}
                        </span>
                      );
                    })}
                  </div>
                )}
                {/* ── "CAPEX EARNING YET?" — the structured answer. (zzz771) */}
                {p.capex!.earning && <CapexEarningBlock e={p.capex!.earning} inline={false} />}
                {(p.capex!.lifecycle || []).length > 0 && !(p.capex!.lifecycleProjects || []).length && (
                  <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 4 }}>
                    {(p.capex!.lifecycle || []).map((e) => (
                      <div key={e.period}>
                        <b style={{ color: C.text }}>{e.period}</b>{' · '}
                        {e.steps.map((x) => `${STAGE_LABEL[x.stage]}: ${x.text.slice(0, 70)}`).join(' · ')}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 13.5, color: C.dim, lineHeight: 1.5 }}>{p.capex!.because}</div>
                {p.capex!.nextCheck && (
                  <div style={{ fontSize: 13, color: C.amber, marginTop: 3 }}>→ {p.capex!.nextCheck}</div>
                )}
              </Section>
            );
          })()}

          {/* ── FROM HERE DOWN IS INFERENCE, AND SAYS SO. ─────────────── */}
          <Section label="THESIS — interpretation, not fact" color={sm?.color}>
            <div style={{ fontSize: 13.5, color: C.dim, lineHeight: 1.55 }}>
              Bought as <b style={{ color: C.text }}>{a.thesis.name}</b>. {sm?.meaning}
            </div>
            <div style={{ fontSize: 12.5, color: C.faint, marginTop: 3 }}>
              {a.coverage.coreDisclosed} of {a.coverage.corePossible} core variables were disclosed
              · {a.coverage.disclosed} of {a.coverage.checked} in total.
              {a.coverage.coreDisclosed < a.coverage.corePossible
                && ' An undisclosed variable is never counted against the thesis.'}
            </div>
            {p.promiseNote && (
              <div style={{ fontSize: 13, color: C.dim, marginTop: 4 }}>📓 {p.promiseNote}</div>
            )}
          </Section>

          {/* ── THESIS LOGIC CHAIN — from the evidence only.        (zzz770) */}
          {a.logicChain && a.logicChain.length > 0 && (
            <Section label="THESIS LOGIC — observation → cause → structural / temporary → thesis impact → forward">
              {a.logicChain.map((l) => (
                <div key={l.step} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '1px 0' }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.3, minWidth: 150, color: l.established ? C.dim : C.faint }}>{l.step}</span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.5, color: l.established ? C.text : C.faint }}>{l.text}</span>
                </div>
              ))}
            </Section>
          )}

          {a.nextConfirmation.length > 0 && (
            <Section label="NEXT THING TO WATCH">
              {a.nextConfirmation.map((t, i) => (
                <div key={i} style={{ fontSize: 13.5, color: C.dim, lineHeight: 1.5 }}>· {t}</div>
              ))}
            </Section>
          )}

          {/* ── THE DYNAMIC INVALIDATION LIST. ────────────────────────── */}
          <Section label="WHAT WOULD END THIS — ranked by how much of the thesis it carries" color={C.amber}>
            {a.invalidationConditions.map((ic, i) => {
              const col = ic.status === 'fired' ? C.red
                : ic.status === 'watch' ? C.amber
                  : ic.status === 'unknown' ? C.faint : C.green;
              const mark = ic.status === 'fired' ? '✕ FIRED'
                : ic.status === 'watch' ? '⚠ watch'
                  : ic.status === 'unknown' ? '· not checked' : '✓ ok';
              return (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: col, minWidth: 74 }}>{mark}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: C.faint, minWidth: 18 }}>W{ic.weight}</span>
                  <span style={{ fontSize: 13.5, color: ic.status === 'fired' ? C.text : C.dim, lineHeight: 1.5 }}>
                    {ic.condition}
                  </span>
                </div>
              );
            })}
            <div style={{ fontSize: 12.5, color: C.faint, marginTop: 5, lineHeight: 1.5 }}>
              No price is on this list, and none ever will be. A drawdown, a weak market and one flat quarter are
              not on it either.
            </div>
          </Section>

          {/* ── EVIDENCE STATE, VARIABLE BY VARIABLE.              (zzz770)
              Never a bare dash: which absence it is, and what was searched. */}
          {(unchecked.length > 0 || a.checked.some((c) => c.state === 'UNCLEAR')) && (
            <Section label="EVIDENCE STATE — what is unknown, and why (never counted against the thesis)">
              {a.checked.filter((c) => c.verdict === 'unknown' || c.state === 'UNCLEAR')
                .sort((x, y) => y.weight - x.weight)
                .map((c) => (
                  <div key={c.key} style={{ fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
                    <b style={{ color: c.weight >= 3 ? C.text : C.dim }}>{c.label}</b>
                    {c.weight >= 4 && <span style={{ fontSize: 11, fontWeight: 800, color: C.faint }}> CORE</span>}
                    {' — '}{c.key === 'capex_earning' && p.capex?.earning
                      ? `capex earning: ${p.capex.earning.label} — ${p.capex.earning.lines.join(' · ')}`
                      : isQoqOnly(c as any) ? chipValue(c as any)
                      : c.state === 'UNCLEAR' && (c.after || c.before)
                        ? `unclear — validation required: ${stripTag(c.after || c.before)}`
                        : stateLine(c)}
                  </div>
                ))}
            </Section>
          )}

          {/* ── WHAT WAS READ, AND WHAT WAS TRIED.                  (zzz737)
              An unexplained circle is the thing this block exists to end:
              "searched and not disclosed" and "could not be reached" look
              identical on a card until the trail is shown. */}
          {p.documentsRead && p.documentsRead.length > 0 && (
            <div style={{ marginTop: 9, fontSize: 12.5, color: C.dim, lineHeight: 1.6 }}>
              <span style={{ fontWeight: 800, color: C.faint, letterSpacing: .4 }}>
                READ {p.documentsRead.length} DOCUMENT{p.documentsRead.length > 1 ? 'S' : ''}
              </span>{' '}
              {p.documentsRead.map((d, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  <a href={d.url} target="_blank" rel="noreferrer" style={{ color: C.cyan, textDecoration: 'none' }}>
                    ↗ {d.label}
                  </a>
                  {d.period ? <span style={{ color: C.faint }}> ({d.period})</span> : null}
                </span>
              ))}
            </div>
          )}

          {p.discoveryAttempts && p.discoveryAttempts.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 12.5, color: C.faint, cursor: 'pointer' }}>
                Evidence search — {p.discoveryAttempts.filter((a) => a.outcome !== 'error').length} of{' '}
                {p.discoveryAttempts.length} source(s) answered
                {p.discoveryState === 'RETRIEVAL_FAILED' ? ' · RETRIEVAL FAILED — a source could not be reached, so nothing here is an absence of disclosure'
                  : p.discoveryState === 'SEARCH_EXHAUSTED' ? ' · SEARCHED, NO EVIDENCE — every source answered'
                    : ''}
              </summary>
              <div style={{ marginTop: 5, fontSize: 12.5, color: C.dim, lineHeight: 1.6 }}>
                {p.discoveryAttempts.map((a, i) => (
                  <div key={i}>
                    <span style={{ color: a.outcome === 'found' ? C.up : a.outcome === 'error' ? C.alarm : C.faint }}>
                      {a.outcome === 'found' ? '✓' : a.outcome === 'error' ? '✕' : '—'}
                    </span>{' '}
                    <b style={{ color: C.text }}>{a.source}</b> — {a.detail}
                  </div>
                ))}
                {p.documentOutcomes && p.documentOutcomes.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    {p.documentOutcomes.map((d, i) => {
                      const ok = d.outcome === 'read';
                      const why = ok ? `read · ${d.chars.toLocaleString()} chars${d.pages ? ` · ${d.pages} pp` : ''}`
                        : d.outcome === 'download_failed' ? `did not download${d.detail ? ` (${d.detail})` : ''}`
                          : d.outcome === 'scanned' ? `scanned image · ${d.pages} pp, no text layer — not OCR'd`
                            : d.outcome === 'too_short' ? `too short to be a filing (${d.chars} chars)`
                              : d.outcome === 'budget_exhausted' ? 'not read — reading budget spent on earlier documents'
                                : d.outcome;
                      // ── AN UNREADABLE DOCUMENT IS NOT A DEAD END.  (zzz760)
                      //
                      // A scanned filing has no text layer and this reader does
                      // not OCR, so the engine can never extract from it. That is
                      // an honest limit — but naming the document and then
                      // withholding it leaves the owner with nothing to do. The
                      // url is already on the record; the label becomes a link,
                      // so "this reader cannot read it" turns into "here it is,
                      // read it yourself" in one click.
                      const name = d.url
                        ? <a href={d.url} target="_blank" rel="noreferrer" style={{ color: ok ? C.text : C.cyan, textDecoration: 'none' }}>↗ {d.label}</a>
                        : <span style={{ color: C.text }}>{d.label}</span>;
                      return (
                        <div key={i}>
                          <span style={{ color: ok ? C.up : d.outcome === 'download_failed' || d.outcome === 'scanned' ? C.alarm : C.faint }}>
                            {ok ? '✓' : '✕'}
                          </span>{' '}
                          {name} <span style={{ color: C.faint }}>({d.kind})</span> — {why}
                          {d.outcome === 'scanned' && d.url && (
                            <span style={{ color: C.faint }}> · nothing here can be extracted from it; open it to read it yourself</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </details>
          )}

          {p.ledger && (Object.keys(p.ledger.periods).length > 0 || p.ledger.status_history.length > 0) && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 12.5, color: C.faint, cursor: 'pointer' }}>
                Evidence history — {Object.keys(p.ledger.periods).length} period{Object.keys(p.ledger.periods).length === 1 ? '' : 's'} on file
                {p.ledger.status_history.length > 0 ? ` · ${p.ledger.status_history.length} status change${p.ledger.status_history.length === 1 ? '' : 's'}` : ''}
              </summary>
              <div style={{ marginTop: 5, fontSize: 12.5, color: C.dim, lineHeight: 1.6 }}>
                {Object.values(p.ledger.periods).sort((x, y) => x.reporting_period.localeCompare(y.reporting_period)).map((pr) => (
                  <div key={pr.reporting_period}>
                    <b style={{ color: C.text }}>{pr.reporting_period}</b> · {pr.documents_read} read · {pr.facts.length} facts · {pr.events.length} events
                    {pr.status ? <> · <span style={{ color: C.text }}>{pr.status.replace(/_/g, ' ')}</span></> : ''}
                    {' '}· read {pr.extracted_at.slice(0, 10)}{pr.updated_at !== pr.extracted_at ? `, updated ${pr.updated_at.slice(0, 10)}` : ''}
                    <div style={{ color: C.faint, paddingLeft: 10 }}>
                      {pr.events.slice(0, 8).map((e, i) => (
                        <div key={i} title={e.evidence_text}>{e.variable.replace(/_/g, ' ')} · {e.value_type.toLowerCase().replace('_', ' ')}{e.before ? ` ${e.before} →` : ''} {e.after || ''}{e.unit && !/%/.test(String(e.after || '')) ? ` ${e.unit}` : ''}{e.period ? ` (${e.period})` : ''} — {e.source}{rawEventNote(e) ? <span style={{ color: C.warn }}> · {rawEventNote(e)}</span> : null}
                          {/* zzz773: a unit-less amount or a counterparty-less "customer" is UNCLEAR, with its source kept. */}
                          {(() => { const v = validateReading(e.variable, e.after, e.evidence_text, e.unit); return v.state === 'UNCLEAR' ? <span style={{ color: C.warn }}> · {v.reason}</span> : null; })()}</div>
                      ))}
                      {pr.events.length > 8 && <div>… {pr.events.length - 8} more events</div>}
                    </div>
                  </div>
                ))}
                {p.ledger.status_history.map((h, i) => (
                  <div key={`h${i}`}>{h.at.slice(0, 10)} · {h.reporting_period} · <span style={{ color: C.text }}>{h.status.replace(/_/g, ' ')}</span>{h.because ? ` — ${h.because.slice(0, 140)}` : ''}</div>
                ))}
                {p.ledger.last_attempt && p.ledger.last_attempt.outcome !== 'COMPLETED' && (
                  <div style={{ color: p.ledger.last_attempt.outcome === 'SOURCE_UNAVAILABLE' ? C.alarm : C.faint }}>
                    last attempt {p.ledger.last_attempt.at.slice(0, 16).replace('T', ' ')} · {p.ledger.last_attempt.outcome.replace(/_/g, ' ')}{p.ledger.last_attempt.error ? ` — ${p.ledger.last_attempt.error.slice(0, 160)}` : ''}
                  </div>
                )}
              </div>
            </details>
          )}

          {p.sources && p.sources.length > 0 && !p.documentsRead?.length && (
            <div style={{ marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {p.sources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 13, color: C.cyan, textDecoration: 'none' }}>↗ {s.label}</a>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
