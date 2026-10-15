// ═══════════════════════════════════════════════════════════════════════════
// GUIDANCE EXTRACTION MODEL ROUTER — cheap first, stronger only when hard. (zzz1050)
//
// Every document is read by the cheap model (OPENAI_MODEL, gpt-5-mini). The
// stronger model reads it again ONLY when the cheap answer shows the document
// was hard:
//
//   schema_fail          the answer had no usable shape (no tool call, cut off,
//                        or refused by our shape validation);
//   quote_rejects        ≥ 3 rows filed and at least half of them failed the
//                        quote-in-document / number-in-quote checks;
//   no_rows_but_guidance zero rows kept on a document whose text names guidance
//                        plainly at least 3 times ("guidance", "outlook", "we
//                        expect", "target", "for FY27" …);
//   long_document        the document is far longer than what the model reads
//                        (≥ 2.5× the excerpt) and at most one row was kept
//                        while it names guidance at least twice;
//   low_confidence       rows were kept but their mean self-reported confidence
//                        is below 0.5.
//
// Never on a transport error, a provider refusal, the cap, a free-screened or
// unreadable document. The better of the two answers is kept (see pickBetter);
// the quote / number checks apply to both exactly the same way.
//
// COST GUARDRAILS (all must hold, or the cheap answer stands):
//   • escalations spend from the SAME daily ceiling (GUIDANCE_EXTRACT_DAILY_USD)
//     and the same per-run cap as every other read;
//   • a SUB-CAP: escalations may use at most GUIDANCE_EXTRACT_ESCALATE_SHARE of
//     the day's ceiling (default 0.30, can only be lowered); tracked in KV per
//     UTC day by the route;
//   • at most GUIDANCE_EXTRACT_ESCALATE_MAX_PER_RUN escalations a run (default 3);
//   • the strong call's cost is ESTIMATED and RESERVED before it is sent, so
//     concurrent workers cannot together overshoot the sub-cap;
//   • the strong model must be priced in lib/anthropic-meter PRICING, or routing
//     is off (an unpriced call could not be counted against the caps).
//
// Switch: GUIDANCE_EXTRACT_STRONG_MODEL = gpt-5 (default for OpenAI) /
// claude-sonnet-4-5 (default for Anthropic) / any priced model of the active
// provider / "off".
// ═══════════════════════════════════════════════════════════════════════════

import { pricingFor } from './anthropic-meter';

export type EscalationReason = 'schema_fail' | 'quote_rejects' | 'no_rows_but_guidance' | 'long_document' | 'low_confidence';
export const ESCALATION_REASONS: readonly EscalationReason[] = ['schema_fail', 'quote_rejects', 'no_rows_but_guidance', 'long_document', 'low_confidence'];

export const MAX_ESCALATE_SHARE = 0.3;
const OFF = /^(?:off|none|no|false|0|disabled?)$/i;

const isOpenAiModel = (m: string) => /^(?:gpt-|o\d)/i.test(m);
const isAnthropicModel = (m: string) => /^claude-/i.test(m);

/** The stronger model for the active provider, or null when routing is off / the model is unpriced / belongs to the other provider. */
export function strongModel(provider: 'openai' | 'anthropic', cheapModel: string | null, env: Record<string, string | undefined> = process.env): string | null {
  const raw = String(env.GUIDANCE_EXTRACT_STRONG_MODEL ?? '').trim();
  if (raw && OFF.test(raw)) return null;
  const m = raw || (provider === 'openai' ? 'gpt-5' : 'claude-sonnet-4-5');
  if (provider === 'openai' ? !isOpenAiModel(m) : !isAnthropicModel(m)) return null;
  if (!pricingFor(m)) return null;
  // the "stronger" model must not be the one that already read the document
  if (cheapModel && String(cheapModel).toLowerCase() === m.toLowerCase()) return null;
  return m;
}

/** Share of the daily ceiling escalations may use: env GUIDANCE_EXTRACT_ESCALATE_SHARE, clamped to [0, 0.30]. */
export function escalateShare(env: Record<string, string | undefined> = process.env): number {
  const raw = env.GUIDANCE_EXTRACT_ESCALATE_SHARE;
  const v = Number(raw);
  if (raw == null || raw === '' || !Number.isFinite(v)) return MAX_ESCALATE_SHARE;
  return Math.max(0, Math.min(MAX_ESCALATE_SHARE, v));
}

/** Escalations a run may make: env GUIDANCE_EXTRACT_ESCALATE_MAX_PER_RUN, default 3, clamped to [0, 10]. */
export function escalateMaxPerRun(env: Record<string, string | undefined> = process.env): number {
  const raw = env.GUIDANCE_EXTRACT_ESCALATE_MAX_PER_RUN;
  const v = Number(raw);
  if (raw == null || raw === '' || !Number.isFinite(v)) return 3;
  return Math.max(0, Math.min(10, Math.round(v)));
}

/** Reasoning effort for the stronger pass (OpenAI only): env GUIDANCE_EXTRACT_STRONG_EFFORT, default low. */
export function strongEffort(env: Record<string, string | undefined> = process.env): string {
  const v = String(env.GUIDANCE_EXTRACT_STRONG_EFFORT || '').toLowerCase();
  return ['minimal', 'low', 'medium'].includes(v) ? v : 'low';
}

/** zzz915 daily ceiling for scheduled guidance reading (moved here from the route so /ai-runs shows the same figure). Default $0.25, at most $20. */
export function guidanceDailyCapUsd(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.GUIDANCE_EXTRACT_DAILY_USD);
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 20) : 0.25;
}
/** KV: what scheduled reading spent this UTC day (the route charges it after each run). */
export const guidanceDayKey = (d = new Date()) => `guidance-extract:day-usd:v1:${d.toISOString().slice(0, 10)}`;
/** KV: what the stronger-model pass spent this UTC day (part of the day's spend; the sub-cap reads it). */
export const escalationDayKey = (d = new Date()) => `guidance-extract:day-escalate-usd:v1:${d.toISOString().slice(0, 10)}`;

/** The day's escalation budget left: share × daily ceiling − already escalated today (never below 0). */
export function escalationDayLeft(dailyCapUsd: number, escalatedTodayUsd: number, share = escalateShare()): number {
  const cap = Math.max(0, Number(dailyCapUsd) || 0) * Math.max(0, Math.min(MAX_ESCALATE_SHARE, share));
  return Math.max(0, Math.round((cap - Math.max(0, Number(escalatedTodayUsd) || 0)) * 1e6) / 1e6);
}

// ── when to escalate (pure) ─────────────────────────────────────────────────

const GUIDANCE_WORDS_RE = /\bguidance\b|\bguided?\b|\boutlook\b|\bwe (?:expect|anticipate|see|are targeting|aim)\b|\btarget(?:s|ing)?\b|\bfull[- ]year\b|\bfor (?:the )?(?:fiscal|FY\s?'?\d{2}|financial year)\b|\breaffirm|\breiterat|\braise[sd]? (?:our|the|its) (?:guidance|outlook)/gi;

/** How plainly the document talks about guidance: count of guidance phrases (capped at 50). */
export function guidanceWordHits(text: string): number {
  const m = String(text || '').match(GUIDANCE_WORDS_RE);
  return Math.min(50, m ? m.length : 0);
}

export interface EscalationSignals {
  /** the cheap answer had no usable shape */
  schemaFail: boolean;
  /** rows the model filed (before our checks) */
  rawRows: number;
  /** rows our checks kept */
  kept: number;
  /** our drop reasons (checkRows) */
  dropReasons: Record<string, number>;
  /** mean confidence of the kept rows, null when none */
  meanConfidence: number | null;
  /** characters of document text / of the excerpt the model read */
  textChars: number;
  excerptChars: number;
  guidanceHits: number;
}

const QUOTE_REASONS = ['quote_not_in_document', 'number_not_in_quote'];

/** Pure: should this document go to the stronger model, and why. Rules in order; the first that holds is the reason. */
export function decideEscalation(s: EscalationSignals): { escalate: boolean; reason: EscalationReason | null } {
  if (s.schemaFail) return { escalate: true, reason: 'schema_fail' };
  const quoteRejected = QUOTE_REASONS.reduce((a, k) => a + (Number(s.dropReasons?.[k]) || 0), 0);
  if (s.rawRows >= 3 && quoteRejected / s.rawRows >= 0.5) return { escalate: true, reason: 'quote_rejects' };
  if (s.kept === 0 && s.guidanceHits >= 3) return { escalate: true, reason: 'no_rows_but_guidance' };
  if (s.excerptChars > 0 && s.textChars >= 2.5 * s.excerptChars && s.kept <= 1 && s.guidanceHits >= 2) return { escalate: true, reason: 'long_document' };
  if (s.kept >= 1 && s.meanConfidence != null && s.meanConfidence < 0.5) return { escalate: true, reason: 'low_confidence' };
  return { escalate: false, reason: null };
}

/** Expected output tokens of a strong pass (rows + some reasoning) — used for the reservation, not a hard limit. */
export const STRONG_EXPECTED_OUTPUT_TOKENS = 3_000;

/** Pure: the cost to reserve for a strong pass — input tokens (chars / 3.5) at the strong input price + the expected output. */
export function estimateStrongUsd(model: string, promptChars: number): number {
  const p = pricingFor(model);
  if (!p) return Infinity;   // unpriced: can never be reserved
  const inTok = Math.ceil(Math.max(0, promptChars) / 3.5);
  return Math.round(((inTok * p.input + STRONG_EXPECTED_OUTPUT_TOKENS * p.output) / 1_000_000) * 1e6) / 1e6;
}

/**
 * The escalation budget of ONE run, shared by its workers. tryReserve is synchronous (no await between the check and the
 * reservation), so two workers cannot both take the last of the budget.
 */
export class EscalationGate {
  private reserved = 0;
  spentUsd = 0;
  count = 0;
  refused: Record<string, number> = {};
  constructor(
    readonly model: string | null,
    /** escalation budget of this run (the day's sub-cap left, already capped by the run's own budget) */
    readonly budgetUsd: number,
    readonly maxPerRun: number,
    /** the run's total spend so far and its cap — escalations also stay inside the run cap */
    private readonly runSpent: () => number,
    private readonly runCapUsd: number,
  ) {}
  private refuse(why: string) { this.refused[why] = (this.refused[why] || 0) + 1; return false; }
  /** Reserve `est` for one strong pass. `pending` = the cheap call's cost of this document, not yet added to the run's spend. */
  tryReserve(est: number, pending = 0): boolean {
    if (!this.model) return this.refuse('off');
    if (!Number.isFinite(est) || est <= 0) return this.refuse('unpriced');
    if (this.count >= this.maxPerRun) return this.refuse('run_limit');
    if (this.spentUsd + this.reserved + est > this.budgetUsd + 1e-9) return this.refuse('sub_cap');
    if (this.runSpent() + pending + this.reserved + est > this.runCapUsd + 1e-9) return this.refuse('run_cap');
    this.reserved += est; this.count++;
    return true;
  }
  /** Release the reservation and book what the strong pass actually cost. */
  settle(est: number, actualUsd: number): void {
    this.reserved = Math.max(0, this.reserved - est);
    this.spentUsd += Math.max(0, Number(actualUsd) || 0);
  }
}

/** Pure: which answer to keep. The strong answer wins when it has a usable shape and keeps at least as many rows (or the cheap one had none / no shape). */
export function pickBetter(cheap: { schemaFail: boolean; kept: number }, strong: { schemaFail: boolean; kept: number } | null): 'cheap' | 'strong' {
  if (!strong || strong.schemaFail) return 'cheap';
  if (cheap.schemaFail) return 'strong';
  return strong.kept >= cheap.kept ? 'strong' : 'cheap';
}
