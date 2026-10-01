// zzz853 — canonical summary counts and the invariants that keep them honest. Pure, deterministic, client-safe.
// One definition per number, so the page can never show 'verified 12' next to 'processed 4':
//   discovered  = events found + documents still awaiting grading + documents whose source is unavailable (+ documents read that produced no event)
//   processed   = events whose before / after numbers were read, or whose primary document was read (+ documents read that produced no event)
//   verified    = events confirmed by a primary document
//   material    = verified clean raises with HIGH / MEDIUM materiality
//   upgrade     = verified clean raises (an audit-only event is never an upgrade)
// documentsAwaitingGrading is reported separately and is never mixed into verified.
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

const isVerified = (e: GuidanceEvent): boolean => e.verification === 'VERIFIED';
const cls = (e: GuidanceEvent): string => e.classification ?? (e.v2?.eventClass === 'UPGRADE' ? 'RAISE' : e.v2?.eventClass === 'REITERATION' ? 'REITERATION' : e.v2?.eventClass === 'DOWNGRADE' ? 'DOWNGRADE' : e.v2?.eventClass === 'NO_RAISE' ? 'MIXED' : 'DETECTED');
const isCleanRaise = (e: GuidanceEvent): boolean => cls(e) === 'RAISE' && !e.auditOnly;
const gapPositive = (e: GuidanceEvent): boolean => e.expectationGap === 'POSITIVE' || e.expectationGap === 'LARGE_POSITIVE';

export function computeCounts(events: readonly GuidanceEvent[], extra: CountExtras = {}): GuCounts {
  const awaiting = Math.max(0, extra.documentsAwaitingGrading ?? 0);
  const unavailable = Math.max(0, extra.documentsUnavailable ?? 0);
  const readNoEvent = Math.max(0, extra.documentsReadNoEvent ?? 0);
  const processedEvents = events.filter((e) => cls(e) !== 'DETECTED' || isVerified(e));
  const verified = events.filter(isVerified);
  return {
    discovered: events.length + awaiting + unavailable + readNoEvent,
    processed: processedEvents.length + readNoEvent,
    verified: verified.length,
    material: verified.filter((e) => isCleanRaise(e) && (e.materiality === 'HIGH' || e.materiality === 'MEDIUM')).length,
    upgrade: verified.filter(isCleanRaise).length,
    reiteration: events.filter((e) => cls(e) === 'REITERATION').length,
    mixed: events.filter((e) => cls(e) === 'MIXED').length,
    lowered: events.filter((e) => cls(e) === 'DOWNGRADE').length,
    // an expectation gap needs a consensus number: no consensus is unknown, never positive
    expectationPositive: verified.filter((e) => isCleanRaise(e) && gapPositive(e) && e.consensus.value != null).length,
    unverifiedClaims: events.filter((e) => !isVerified(e) && !e.auditOnly).length,
    documentsAwaitingGrading: awaiting,
    documentsUnavailable: unavailable,
  };
}

/**
 * The rules that must hold in every response. Returns one plain sentence per broken rule (empty = all hold).
 * The route returns the list as `invariantViolations`; tests assert it is empty for clean data and non-empty for broken data.
 */
export function checkEventInvariants(events: readonly GuidanceEvent[], counts: GuCounts): string[] {
  const v: string[] = [];
  if (counts.verified > counts.processed) v.push(`verified (${counts.verified}) is greater than processed (${counts.processed})`);
  if (counts.processed > counts.discovered) v.push(`processed (${counts.processed}) is greater than discovered (${counts.discovered})`);
  if (counts.material > counts.verified) v.push(`material (${counts.material}) is greater than verified (${counts.verified})`);
  if (counts.expectationPositive > counts.verified) v.push(`expectationPositive (${counts.expectationPositive}) is greater than verified (${counts.verified})`);
  if (counts.upgrade > counts.verified) v.push(`upgrade (${counts.upgrade}) is greater than verified (${counts.verified})`);
  if (counts.documentsAwaitingGrading < 0 || counts.documentsUnavailable < 0) v.push('a document count is negative');
  for (const e of events) {
    const id = `${e.ticker || e.company} ${e.announcement_date}`;
    const c = cls(e);
    // expectation positive only with a consensus number present
    if ((e.expectationGap === 'POSITIVE' || e.expectationGap === 'LARGE_POSITIVE') && e.consensus.value == null) v.push(`${id}: expectation gap is positive but no consensus number is present`);
    // reiteration is never a raise; a headline word never overrides the numbers
    if (c === 'REITERATION' && (e.isUpgrade || e.displayLabel === 'GUIDANCE UPGRADE' || e.v2?.eventClass === 'UPGRADE')) v.push(`${id}: a reiteration is labelled as a raise`);
    if (c !== 'RAISE' && (e.isUpgrade || e.displayLabel === 'GUIDANCE UPGRADE')) v.push(`${id}: labelled as an upgrade but the numbers show ${c.toLowerCase()}`);
    if (e.displayLabel === 'GUIDANCE UPGRADE' && !isVerified(e)) v.push(`${id}: labelled GUIDANCE UPGRADE without a primary source`);
    if (e.isUpgrade && e.auditOnly) v.push(`${id}: an audit-only event is counted as an upgrade`);
    if ((c === 'REITERATION' || c === 'DOWNGRADE') && /\b(?:raised|raises|upgraded|lifted|hiked)\b/i.test(`${e.whyNow} ${e.chain?.event ?? ''}`)) v.push(`${id}: narrative says raised but the numbers show ${c.toLowerCase()}`);
    if (c === 'RAISE' && !e.changes.some((x) => x.direction === 'UP' && !!x.before)) v.push(`${id}: classified as a raise with no measure that moved up`);
    // a capital raise (bonds, loans, funds) is never guidance
    if (nonGuidanceRaiseSentence(e.whyNow || '')) v.push(`${id}: the narrative describes a capital raise, not guidance`);
    // an unresolved company is never a verified event
    if (e.market !== 'US' && isVerified(e) && !isResolvedTicker(e.ticker)) v.push(`${id}: a verified event has no resolved company symbol`);
    if (isVerified(e) && !e.primaryAvailable) v.push(`${id}: verified without a primary source`);
    if (e.verification !== 'VERIFIED' && (e.decision && e.decision !== 'UNVERIFIED')) v.push(`${id}: an unverified event carries a final decision`);
  }
  return v;
}
