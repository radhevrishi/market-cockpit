// zzz853/zzz854 — canonical summary counts and the invariants that keep them honest. Pure and deterministic (enforcement mutates the
// events it is given, on purpose, see enforceEventInvariants).
//
// zzz854 — ONE exclusive bucket per event, so the header equation always holds:
//   detected  = verifiedUpgrades + reiterations + mixed + lowered + firstGuidance + invalidOrStale + awaitingNumbers + unverified
//               (every guidance item lands in exactly one bucket; the bucket is the event engine's `pipeline.bucket` when present,
//                else it is derived from classification / verification / taxonomy with the same names)
//   notGuidance = capitalRaise + nonGuidance   (listed in the audit with their reason, NEVER in `detected` or any other count)
//   verified  = verifiedUpgrades ONLY (a verified formal upgrade). The older "any event with a primary document" number is `verifiedPrimaryRead`.
//   upgrade   = verified (kept for the older UI)
//   material  = verified upgrades with HIGH / MEDIUM materiality;  expectationPositive = verified upgrades above a real consensus number
//   discovered = detected + notGuidance + documents awaiting grading + documents unavailable + documents read with no event
//   processed  = detected + notGuidance + documents read with no event          (verified <= processed <= discovered always)
// Invariants are ENFORCED: an event that breaks a rule is demoted (moved to the audit / review queue with the rule as its reason, or dropped
// when it is not guidance at all) before anything is counted. checkEventInvariants then reports only what enforcement could not repair.
import type { GuCounts, GuidanceEvent } from './guidance-upgrades-types';
import { nonGuidanceRaiseSentence, isResolvedTicker } from './guidance-upgrades-candidates';

export interface CountExtras {
  /** queue documents (or SEC filings) not yet read: QUEUED / READING / retryable FAILED */
  documentsAwaitingGrading?: number;
  /** documents whose source could not be read after the retries */
  documentsUnavailable?: number;
  /** documents read successfully that produced no event (nothing to count as an event, but they were processed) */
  documentsReadNoEvent?: number;
}

/** Bucket names follow the event engine's GuPipelineBucket (stable field names). */
export const GUIDANCE_BUCKETS = ['verifiedUpgrades', 'reiterations', 'mixed', 'lowered', 'firstGuidance', 'invalidOrStale', 'awaitingNumbers', 'unverified'] as const;
export const NOT_GUIDANCE_BUCKETS = ['capitalRaise', 'nonGuidance'] as const;
export type GuidanceBucket = typeof GUIDANCE_BUCKETS[number];
export type NotGuidanceBucket = typeof NOT_GUIDANCE_BUCKETS[number];
export type CountBucket = GuidanceBucket | NotGuidanceBucket;
export const BUCKET_LABEL: Record<CountBucket, string> = {
  verifiedUpgrades: 'verified upgrades', reiterations: 'reiterations', mixed: 'mixed / range changes', lowered: 'lowered', firstGuidance: 'first guidance (not a raise)',
  invalidOrStale: 'invalid or stale comparisons', awaitingNumbers: 'awaiting numbers', unverified: 'unverified claims', capitalRaise: 'capital raises (not guidance)', nonGuidance: 'not guidance',
};

/** The counts plus the exclusive buckets and the equations (all additive to GuCounts). */
export interface GuCountsX extends GuCounts {
  /** sum of the guidance buckets */ detected: number;
  buckets: Record<CountBucket, number>;
  /** capitalRaise + nonGuidance: shown in the audit with their reason, never counted as guidance */ notGuidance: number;
  /** events read from a primary document, whatever their class (the older meaning of `verified`) */ verifiedPrimaryRead: number;
  /** events shown as cards or in the audit list vs held in the review / awaiting queue vs dropped */ shown: number; queued: number; dropped: number;
  /** events demoted by the invariant enforcement this run */ demotedByInvariant: number;
  /** 'Detected 120 = 40 verified upgrades + 9 reiterations + ...' */ equation: string;
  /** 'Not guidance 5 = 3 capital raises + 2 other' */ notGuidanceEquation: string;
}

const isVerified = (e: GuidanceEvent): boolean => e.verification === 'VERIFIED';
const cls = (e: GuidanceEvent): string => e.classification ?? (e.v2?.eventClass === 'UPGRADE' ? 'RAISE' : e.v2?.eventClass === 'REITERATION' ? 'REITERATION' : e.v2?.eventClass === 'DOWNGRADE' ? 'DOWNGRADE' : e.v2?.eventClass === 'NO_RAISE' ? 'MIXED' : 'DETECTED');
const gapPositive = (e: GuidanceEvent): boolean => e.expectationGap === 'POSITIVE' || e.expectationGap === 'LARGE_POSITIVE';
const idOf = (e: GuidanceEvent): string => `${e.ticker || e.company} ${e.announcement_date}`;
const ALL_BUCKETS: readonly string[] = [...GUIDANCE_BUCKETS, ...NOT_GUIDANCE_BUCKETS];
const NON_GUIDANCE_TAXONOMY = /^(qualitative_commentary|analyst_revision|earnings_beat|management_target|operational_disclosure)$/;

/** The one bucket an event counts in. The engine's own pipeline bucket wins; otherwise it is derived with the same names. */
export function eventBucketOf(e: GuidanceEvent): CountBucket {
  const pb = (e as any).pipeline?.bucket;
  if (typeof pb === 'string' && ALL_BUCKETS.includes(pb)) return pb as CountBucket;
  const tax = String((e as any).taxonomy ?? '');
  if (tax === 'capital_raise_or_financing' || nonGuidanceRaiseSentence(e.whyNow || '')) return 'capitalRaise';
  if (NON_GUIDANCE_TAXONOMY.test(tax)) return 'nonGuidance';
  if (tax === 'first_guidance') return 'firstGuidance';
  const c = cls(e);
  if (c === 'REITERATION') return 'reiterations';
  if (c === 'DOWNGRADE') return 'lowered';
  if (c === 'MIXED') return 'mixed';
  if (c === 'RAISE') return !isVerified(e) ? 'unverified' : e.auditOnly ? 'mixed' : 'verifiedUpgrades';
  return isVerified(e) ? 'awaitingNumbers' : 'unverified';
}
const pipelineStatusOf = (e: GuidanceEvent, b: CountBucket): 'CARD' | 'AUDIT' | 'QUEUE' | 'DROPPED' => {
  const s = (e as any).pipeline?.status;
  if (s === 'CARD' || s === 'AUDIT' || s === 'QUEUE' || s === 'DROPPED') return s;
  if (b === 'capitalRaise' || b === 'nonGuidance' || (e as any).excludedFromEvents) return 'DROPPED';
  if (b === 'verifiedUpgrades') return 'CARD';
  if (b === 'reiterations' || b === 'mixed' || b === 'lowered') return 'AUDIT';
  return 'QUEUE';
};

// ── per-event rules ─────────────────────────────────────────────────────────────────────────────────────────────────
export type EventRule = 'NOT_GUIDANCE_CAPITAL_RAISE' | 'GAP_WITHOUT_CONSENSUS' | 'REITERATION_LABELLED_RAISE' | 'LABEL_NOT_NUMBERS' | 'UPGRADE_WITHOUT_PRIMARY'
  | 'AUDIT_COUNTED_AS_UPGRADE' | 'NARRATIVE_CONTRADICTS_NUMBERS' | 'RAISE_WITHOUT_MEASURE_UP' | 'VERIFIED_UNRESOLVED_COMPANY' | 'VERIFIED_WITHOUT_PRIMARY' | 'UNVERIFIED_WITH_DECISION';
export interface EventViolation { rule: EventRule; message: string }
/** Every per-event rule, as plain sentences (the same sentences the route has always shown). */
export function eventViolations(e: GuidanceEvent): EventViolation[] {
  const v: EventViolation[] = []; const id = idOf(e); const c = cls(e);
  const add = (rule: EventRule, msg: string) => v.push({ rule, message: `${id}: ${msg}` });
  if (gapPositive(e) && e.consensus?.value == null) add('GAP_WITHOUT_CONSENSUS', 'expectation gap is positive but no consensus number is present');
  if (c === 'REITERATION' && (e.isUpgrade || e.displayLabel === 'GUIDANCE UPGRADE' || e.v2?.eventClass === 'UPGRADE')) add('REITERATION_LABELLED_RAISE', 'a reiteration is labelled as a raise');
  if (c !== 'RAISE' && (e.isUpgrade || e.displayLabel === 'GUIDANCE UPGRADE')) add('LABEL_NOT_NUMBERS', `labelled as an upgrade but the numbers show ${c.toLowerCase()}`);
  if (e.displayLabel === 'GUIDANCE UPGRADE' && !isVerified(e)) add('UPGRADE_WITHOUT_PRIMARY', 'labelled GUIDANCE UPGRADE without a primary source');
  if (e.isUpgrade && e.auditOnly) add('AUDIT_COUNTED_AS_UPGRADE', 'an audit-only event is counted as an upgrade');
  if ((c === 'REITERATION' || c === 'DOWNGRADE') && /\b(?:raised|raises|upgraded|lifted|hiked)\b/i.test(`${e.whyNow} ${e.chain?.event ?? ''}`)) add('NARRATIVE_CONTRADICTS_NUMBERS', `narrative says raised but the numbers show ${c.toLowerCase()}`);
  if (c === 'RAISE' && !(e.changes || []).some((x) => x.direction === 'UP' && !!x.before)) add('RAISE_WITHOUT_MEASURE_UP', 'classified as a raise with no measure that moved up');
  // a capital raise (bonds, loans, funds) is never guidance
  if (nonGuidanceRaiseSentence(e.whyNow || '')) add('NOT_GUIDANCE_CAPITAL_RAISE', 'the narrative describes a capital raise, not guidance');
  // an unresolved company is never a verified event
  if (e.market !== 'US' && isVerified(e) && !isResolvedTicker(e.ticker)) add('VERIFIED_UNRESOLVED_COMPANY', 'a verified event has no resolved company symbol');
  if (isVerified(e) && !e.primaryAvailable) add('VERIFIED_WITHOUT_PRIMARY', 'verified without a primary source');
  if (e.verification !== 'VERIFIED' && (e.decision && e.decision !== 'UNVERIFIED')) add('UNVERIFIED_WITH_DECISION', 'an unverified event carries a final decision');
  return v;
}

export interface Demotion { id: string; company: string; ticker: string; rules: EventRule[]; reasons: string[]; excluded: boolean; bucket: CountBucket }
const LABEL_BY_BUCKET: Partial<Record<CountBucket, string>> = { reiterations: 'REITERATION', lowered: 'GUIDANCE LOWERED', mixed: 'MIXED / RANGE CHANGE', unverified: 'UNVERIFIED CLAIM', awaitingNumbers: 'AWAITING NUMBERS' };
const setPipeline = (e: GuidanceEvent, p: { status: 'CARD' | 'AUDIT' | 'QUEUE' | 'DROPPED'; bucket: CountBucket; reviewStatus: string | null; reason: string }) => { (e as any).pipeline = { ...((e as any).pipeline || {}), ...p }; };

/**
 * zzz854: ENFORCE the per-event rules (idempotent; mutates the events in place so the response the route builds carries the fix).
 *  - narrative describes a capital raise -> EXCLUDED: pipeline DROPPED / bucket capitalRaise, auditOnly, `excludedFromEvents: true`, never counted as guidance.
 *  - verified without a primary document, or an India event with no resolved company -> verification UNVERIFIED, review queue (unverified).
 *  - a label or upgrade flag the numbers do not support -> the flag is removed and the event goes to the audit list under its real class.
 *  - a 'raise' with no measure that moved up -> awaiting numbers (review queue), never an upgrade.
 *  - an unverified event with a final decision -> decision UNVERIFIED; a positive gap with no consensus number -> gap UNKNOWN.
 *  - narrative contradicting the numbers -> stays in the audit list, its note names the contradiction.
 * Each demoted event carries `invariantDemoted: { rules, reasons, excluded }` and an audit note with the specific reason.
 */
export function enforceEventInvariants(events: readonly GuidanceEvent[]): { kept: GuidanceEvent[]; excluded: GuidanceEvent[]; demoted: Demotion[] } {
  const kept: GuidanceEvent[] = []; const excluded: GuidanceEvent[] = []; const demoted: Demotion[] = [];
  for (const e of events) {
    const prev: any = (e as any).invariantDemoted;
    if (prev?.excluded) { excluded.push(e); continue; }
    const vs = eventViolations(e);
    if (!vs.length) { kept.push(e); continue; }
    const rules = vs.map((x) => x.rule); const reasons = vs.map((x) => x.message.replace(/^[^:]*:\s*/, ''));
    const has = (r: EventRule) => rules.includes(r);
    const any = e as any;
    let isExcluded = false;
    if (has('NOT_GUIDANCE_CAPITAL_RAISE')) {
      isExcluded = true;
      e.isUpgrade = false; e.auditOnly = true; e.decision = 'UNVERIFIED';
      e.displayLabel = 'CAPITAL RAISE (NOT GUIDANCE)';
      setPipeline(e, { status: 'DROPPED', bucket: 'capitalRaise', reviewStatus: 'capital_raise', reason: 'Data check: the narrative describes a capital raise, not guidance. Moved to the audit list and not counted.' });
    } else {
      if (has('GAP_WITHOUT_CONSENSUS')) e.expectationGap = 'UNKNOWN';
      if (has('VERIFIED_WITHOUT_PRIMARY') || has('VERIFIED_UNRESOLVED_COMPANY')) {
        e.verification = 'UNVERIFIED'; e.isUpgrade = false;
        setPipeline(e, { status: 'QUEUE', bucket: 'unverified', reviewStatus: has('VERIFIED_WITHOUT_PRIMARY') ? 'awaiting_primary' : 'needs_review', reason: `Data check: ${reasons.join('; ')}.` });
      }
      if (e.verification !== 'VERIFIED' && e.decision && e.decision !== 'UNVERIFIED') e.decision = 'UNVERIFIED';
      if (has('RAISE_WITHOUT_MEASURE_UP')) {
        e.isUpgrade = false; e.classification = 'DETECTED';
        setPipeline(e, { status: 'QUEUE', bucket: isVerified(e) ? 'awaitingNumbers' : 'unverified', reviewStatus: 'awaiting_numbers', reason: 'Data check: classified as a raise but no measure moved up; waiting for the old and new numbers.' });
      }
      if (has('REITERATION_LABELLED_RAISE') || has('LABEL_NOT_NUMBERS') || has('UPGRADE_WITHOUT_PRIMARY') || has('AUDIT_COUNTED_AS_UPGRADE')) {
        e.isUpgrade = false;
        const b = eventBucketOf({ ...e, pipeline: undefined } as any);
        const st = pipelineStatusOf({ ...e, pipeline: undefined } as any, b);
        if (!any.pipeline || any.pipeline.status === 'CARD') setPipeline(e, { status: st === 'CARD' ? 'AUDIT' : st, bucket: b === 'verifiedUpgrades' ? 'mixed' : b, reviewStatus: st === 'QUEUE' ? 'needs_review' : null, reason: `Data check: ${reasons.join('; ')}.` });
        if (st !== 'QUEUE') e.auditOnly = true;
      }
      if (e.displayLabel === 'GUIDANCE UPGRADE' && (!isVerified(e) || cls(e) !== 'RAISE' || !e.isUpgrade)) e.displayLabel = LABEL_BY_BUCKET[eventBucketOf(e)] ?? 'NEEDS REVIEW';
    }
    any.invariantDemoted = { rules, reasons, excluded: isExcluded };
    if (isExcluded) any.excludedFromEvents = true;
    e.auditNote = `Data check: ${reasons.join('; ')}.${isExcluded ? ' Moved to the audit list; not counted as guidance.' : ''}`;
    (isExcluded ? excluded : kept).push(e);
    demoted.push({ id: e.guidance_event_id || idOf(e), company: e.company, ticker: e.ticker, rules, reasons, excluded: isExcluded, bucket: eventBucketOf(e) });
  }
  return { kept, excluded, demoted };
}

const emptyBuckets = (): Record<CountBucket, number> => Object.fromEntries(ALL_BUCKETS.map((b) => [b, 0])) as Record<CountBucket, number>;
export function bucketCounts(events: readonly GuidanceEvent[]): Record<CountBucket, number> {
  const out = emptyBuckets(); for (const e of events) out[eventBucketOf(e)]++; return out;
}
export function detectedEquation(b: Record<CountBucket, number>): string {
  const d = GUIDANCE_BUCKETS.reduce((a, k) => a + b[k], 0);
  return `Detected ${d} = ${GUIDANCE_BUCKETS.map((k) => `${b[k]} ${BUCKET_LABEL[k]}`).join(' + ')}`;
}

/** The extra fields of a counts object built by computeCounts (null for an older counts object). */
export function countsDetail(c: GuCounts | null | undefined): GuCountsX | null { return c && typeof (c as any).detected === 'number' && (c as any).buckets ? (c as GuCountsX) : null; }

/** Typed as GuCounts so existing callers keep compiling; the object also carries every GuCountsX field (read them with countsDetail / computeCountsX). */
export function computeCounts(events: readonly GuidanceEvent[], extra: CountExtras = {}): GuCounts { return computeCountsX(events, extra); }
export function computeCountsX(events: readonly GuidanceEvent[], extra: CountExtras = {}): GuCountsX {
  const enf = enforceEventInvariants(events);
  const all = [...enf.kept, ...enf.excluded];
  const awaiting = Math.max(0, extra.documentsAwaitingGrading ?? 0);
  const unavailable = Math.max(0, extra.documentsUnavailable ?? 0);
  const readNoEvent = Math.max(0, extra.documentsReadNoEvent ?? 0);
  const buckets = bucketCounts(all);
  const detected = GUIDANCE_BUCKETS.reduce((a, k) => a + buckets[k], 0);
  const notGuidance = NOT_GUIDANCE_BUCKETS.reduce((a, k) => a + buckets[k], 0);
  const vu = all.filter((e) => eventBucketOf(e) === 'verifiedUpgrades');
  const st = all.map((e) => pipelineStatusOf(e, eventBucketOf(e)));
  return {
    discovered: detected + notGuidance + awaiting + unavailable + readNoEvent,
    processed: detected + notGuidance + readNoEvent,
    detected,
    verified: vu.length,
    verifiedPrimaryRead: enf.kept.filter(isVerified).length,
    material: vu.filter((e) => e.materiality === 'HIGH' || e.materiality === 'MEDIUM').length,
    upgrade: vu.length,
    reiteration: buckets.reiterations, mixed: buckets.mixed, lowered: buckets.lowered,
    // an expectation gap needs a consensus number: no consensus is unknown, never positive
    expectationPositive: vu.filter((e) => gapPositive(e) && e.consensus?.value != null).length,
    unverifiedClaims: buckets.unverified,
    documentsAwaitingGrading: awaiting,
    documentsUnavailable: unavailable,
    buckets, notGuidance,
    shown: st.filter((s) => s === 'CARD' || s === 'AUDIT').length, queued: st.filter((s) => s === 'QUEUE').length, dropped: st.filter((s) => s === 'DROPPED').length,
    demotedByInvariant: enf.demoted.length,
    equation: detectedEquation(buckets),
    notGuidanceEquation: `Not guidance ${notGuidance} = ${buckets.capitalRaise} ${BUCKET_LABEL.capitalRaise} + ${buckets.nonGuidance} ${BUCKET_LABEL.nonGuidance} (in the audit list, never counted as guidance)`,
  };
}

/**
 * The rules that must hold in every response. Returns one plain sentence per broken rule (empty = all hold).
 * Events already demoted by enforceEventInvariants are handled (moved, with their reason) and are not reported again; what is left is a real failure.
 * The route returns the list as `invariantViolations`; tests assert it is empty for clean data and non-empty for broken data.
 */
export function checkEventInvariants(events: readonly GuidanceEvent[], counts: GuCounts | GuCountsX): string[] {
  const v: string[] = [];
  if (counts.verified > counts.processed) v.push(`verified (${counts.verified}) is greater than processed (${counts.processed})`);
  if (counts.processed > counts.discovered) v.push(`processed (${counts.processed}) is greater than discovered (${counts.discovered})`);
  if (counts.material > counts.verified) v.push(`material (${counts.material}) is greater than verified (${counts.verified})`);
  if (counts.expectationPositive > counts.verified) v.push(`expectationPositive (${counts.expectationPositive}) is greater than verified (${counts.verified})`);
  if (counts.upgrade > counts.verified) v.push(`upgrade (${counts.upgrade}) is greater than verified (${counts.verified})`);
  if (counts.documentsAwaitingGrading < 0 || counts.documentsUnavailable < 0) v.push('a document count is negative');
  const x = counts as Partial<GuCountsX>;
  if (x.buckets) {
    const sum = GUIDANCE_BUCKETS.reduce((a, k) => a + (x.buckets![k] ?? 0), 0);
    if (x.detected != null && sum !== x.detected) v.push(`detected (${x.detected}) is not the sum of its buckets (${sum})`);
    if (counts.verified !== (x.buckets.verifiedUpgrades ?? 0)) v.push(`verified (${counts.verified}) is not the verified-upgrade bucket (${x.buckets.verifiedUpgrades})`);
    if (counts.reiteration !== x.buckets.reiterations || counts.mixed !== x.buckets.mixed || counts.lowered !== x.buckets.lowered || counts.unverifiedClaims !== x.buckets.unverified) v.push('a class count differs from its bucket');
    if (x.shown != null && x.queued != null && x.dropped != null && x.shown + x.queued + x.dropped !== (x.detected ?? 0) + (x.notGuidance ?? 0)) v.push('shown + queued + dropped does not equal detected + not guidance');
  }
  for (const e of events) {
    if ((e as any).invariantDemoted) continue;   // handled: moved with its reason
    for (const r of eventViolations(e)) v.push(r.message);
  }
  return v;
}
