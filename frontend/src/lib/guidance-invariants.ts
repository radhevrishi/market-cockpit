// zzz853 — GUIDANCE UNIVERSE INVARIANTS. A pure checker run on every universe bundle (the route returns `invariantViolations`; the seed run must have none).
// "Active" = a record in the DEFAULT VIEW (active + company resolved + period CONFIRMED + not flagged). The review queue may hold UNCLEAR / UNKNOWN periods and flagged
// records by design, but it must obey the same truth rules (nothing there may be VERIFIED by mistake, no analyst row may be guidance ...).
import type { GuExcluded, GuInactiveRecord, GuPoint, GuUniverseRecordX } from './guidance-universe';
import type { GuCountEquations, GuInvariantViolation } from './guidance-universe-types';
import { isCapitalRaise, isReiteration, textSaysGuidanceRaised } from './guidance-universe-integrity';
import { STALE_DEMOTE_DAYS } from './guidance-config';

/**
 * zzz854: the rules an ACTIVE (default-view) point must satisfy. Used twice: buildUniverse ENFORCES them (a point that breaks one is demoted to
 * "Needs review" with the rule as its reason) and checkUniverseInvariants REPORTS them (must be empty after enforcement).
 */
export function activePointViolations(r: { companyId: string | null; ticker: string | null; market: string | null | undefined }, p: GuPoint): Array<{ code: string; message: string }> {
  const out: Array<{ code: string; message: string }> = [];
  const v = (code: string, message: string) => out.push({ code, message });
  if (!r.companyId) v('ACTIVE_NO_COMPANY_ID', 'An active record has no companyId (the company is not resolved).');
  if (!r.market) v('ACTIVE_NO_MARKET', 'An active record has no market.');
  if (!r.ticker) v('ACTIVE_NO_TICKER', 'An active record has no ticker.');
  if (p.periodStatus === 'UNKNOWN') v('ACTIVE_PERIOD_UNKNOWN', `An active point has periodStatus UNKNOWN (${p.periodLabelSource}).`);
  else if (p.periodStatus !== 'CONFIRMED') v('DEFAULT_PERIOD_NOT_CONFIRMED', `A default-view point has periodStatus ${p.periodStatus} (${p.periodLabelSource}); UNCLEAR is allowed only outside the default view.`);
  if (p.needsReview) v('DEFAULT_NEEDS_REVIEW', 'A default-view point is flagged needs review.');
  if (p.status !== 'ACTIVE' || !p.current) v('ACTIVE_NOT_CURRENT', `A default-view point has status ${p.status}.`);
  if (p.periodRunState === 'EXPIRED') v('ACTIVE_PERIOD_EXPIRED', 'A default-view point is for a period that has ended.');
  // zzz854: Active = verified, derived, or partial with the company document read. Never a media / social claim, never 'last verified: unknown'.
  if (p.sourceTier > 2) v('ACTIVE_SECONDARY_SOURCE', `An active point rests on a TIER${p.sourceTier} (secondary) source.`);
  if (!p.primarySourceFound || !p.primarySourceRead) v('ACTIVE_PRIMARY_NOT_READ', 'An active point has no company document found and read.');
  if (!p.lastVerified) v('ACTIVE_LAST_VERIFIED_UNKNOWN', 'An active point has no last-verified date.');
  if (p.verificationState !== 'VERIFIED' && p.verificationState !== 'DERIVED' && p.verificationState !== 'PARTIAL') v('ACTIVE_NOT_VERIFIED', `An active point has verification state ${p.verificationState}.`);
  if (p.lastVerifiedDaysAgo != null && p.lastVerifiedDaysAgo > STALE_DEMOTE_DAYS) v('ACTIVE_STALE', `An active point was last verified ${p.lastVerifiedDaysAgo} days ago (limit ${STALE_DEMOTE_DAYS}).`);
  if (p.eventOverride) v('ACTIVE_EVENT_CONFLICT', `A newer filing disagrees: ${p.eventOverride.text}`);
  if (p.revision === 'RAISED' && p.latestEvent && p.latestEvent.verified && p.latestEvent.status !== 'RAISED' && p.latestEvent.status !== 'NO_NUMBERS' && (!p.sourceDate || p.latestEvent.date >= p.sourceDate)) v('ACTIVE_RAISED_BUT_EVENT_SAYS_OTHERWISE', `The record says RAISED but the latest filing (${p.latestEvent.date}) says ${p.latestEvent.status}.`);
  return out;
}

/** zzz854: every header equation must hold (Active = verified + derived + partial; highest active is a subset of Active). */
export function checkUniverseCountEquations(eq: GuCountEquations | null | undefined): GuInvariantViolation[] {
  if (!eq) return [];
  const out: GuInvariantViolation[] = [];
  const v = (code: string, message: string) => out.push({ code, entityKey: null, company: null, metric: null, message });
  const p = eq.active.parts || {};
  if ((p.verified ?? 0) + (p.derived ?? 0) + (p.partial ?? 0) !== eq.active.value) v('COUNT_ACTIVE_NOT_SUM', `Active ${eq.active.value} is not verified + derived + partial (${p.verified ?? 0} + ${p.derived ?? 0} + ${p.partial ?? 0}).`);
  if (!eq.highestActive.holds || eq.highestActive.companies > eq.active.value) v('COUNT_HIGHEST_NOT_SUBSET', `Highest active guidance (${eq.highestActive.companies} companies) is not a subset of Active (${eq.active.value}).`);
  const rp = eq.rows.parts || {};
  if ((rp.active ?? 0) + (rp.review ?? 0) + (rp.claimsAwaiting ?? 0) !== eq.rows.value) v('COUNT_ROWS_NOT_SUM', 'Active + needs review + claims awaiting does not equal the rows total.');
  return out;
}

export interface GuInvariantBundle {
  /** the default view (preferred). When absent, `records` is checked as the active set. */ defaultRecords?: GuUniverseRecordX[];
  records?: GuUniverseRecordX[]; reviewQueue?: GuUniverseRecordX[]; inactive?: GuInactiveRecord[]; excluded?: GuExcluded[];
  /** zzz854 */ claimsAwaiting?: GuUniverseRecordX[];
}

export function checkUniverseInvariants(bundle: GuInvariantBundle): GuInvariantViolation[] {
  const out: GuInvariantViolation[] = [];
  // zzz1131 (retest R4) — each violation names its POINT (metric + period), so one failed period never removes another
  const v = (code: string, r: GuUniverseRecordX | null, p: GuPoint | null, message: string) => out.push({ code, entityKey: r?.entityKey ?? null, company: r?.record?.company ?? null, metric: p?.metric ?? null, period: p ? (p.periodNormalized || p.period || null) : null, message });
  const active = bundle.defaultRecords ?? bundle.records ?? [];
  const queue = bundle.reviewQueue ?? [];

  // 1-2. every ACTIVE (default view) record is fully identified, has an established period and is verified (zzz854: shared with the enforcement in buildUniverse)
  const seen = new Map<string, string>();
  for (const r of active) {
    for (const p of r.points) for (const x of activePointViolations({ companyId: r.companyId, ticker: r.tickers?.[0] || r.record?.ticker || null, market: r.record?.market }, p)) v(x.code, r, p, x.message);
    // zzz854: one canonical active row per company + metric + period
    for (const p of r.points) {
      const k = `${r.record?.market}|${(r.tickers?.[0] || r.record?.ticker || r.entityKey || '').toUpperCase()}|${p.metric}|${p.periodNormalized || p.period}`;
      if (seen.has(k)) v('DUPLICATE_ACTIVE_ROW', r, p, `The same company, metric and period appears twice in Active (${k}).`);
      seen.set(k, r.entityKey);
    }
  }
  for (const r of bundle.claimsAwaiting ?? []) for (const p of r.points) if (p.inDefaultView || p.listBucket === 'ACTIVE') v('CLAIM_IN_ACTIVE', r, p, 'A claim awaiting verification is marked as Active.');
  for (const r of [...active, ...queue, ...(bundle.claimsAwaiting ?? [])]) {
    for (const p of r.points) {
      // 3. VERIFIED needs a source, evidence and every truth rule
      if (p.verificationState === 'VERIFIED') {
        if (!p.sourceName || !(p.statement || '').trim()) v('VERIFIED_NO_SOURCE_OR_EVIDENCE', r, p, 'A VERIFIED point has no source name or no evidence text.');
        if (p.sourceTier > 2) v('VERIFIED_BY_SECONDARY_SOURCE', r, p, `A VERIFIED point rests on a TIER${p.sourceTier} source.`);
        if (!p.primarySourceFound || !p.primarySourceRead) v('VERIFIED_PRIMARY_NOT_READ', r, p, 'A VERIFIED point has no primary source found and read.');
        if (p.growthType !== 'EXPLICIT') v('VERIFIED_GROWTH_NOT_EXPLICIT', r, p, `A VERIFIED point has growthType ${p.growthType}.`);
        if (p.periodStatus !== 'CONFIRMED') v('VERIFIED_PERIOD_NOT_CONFIRMED', r, p, `A VERIFIED point has periodStatus ${p.periodStatus}.`);
        if (p.needsReview) v('VERIFIED_NEEDS_REVIEW', r, p, 'A VERIFIED point is flagged needs review.');
        if (p.claimType !== 'MANAGEMENT_GUIDANCE') v('VERIFIED_NOT_MANAGEMENT', r, p, `A VERIFIED point has claimType ${p.claimType}.`);
      }
      // zzz1131 (R4) — a multi-year rate worked out from a stated target and base (or the company's own total) keeps its numbers in the
      // basis text / implied figure, not in growthDerivation: that is a supported form, not missing evidence
      const cagrNumbers = (p.periodKind === 'MULTI_YEAR_CAGR' || p.cohort === 'MULTI_YEAR_CAGR') && /worked out from (?:company numbers|the company's total)/.test(`${p.basisLabel || ''} ${p.display || ''}`);
      if (p.verificationState === 'DERIVED' && (p.sourceTier > 2 || (!p.growthDerivation && !cagrNumbers))) v('DERIVED_WITHOUT_PRIMARY_NUMBERS', r, p, 'A DERIVED point has no primary source or no derivation numbers.');
      if (p.sourceTier >= 3 && (p.verificationState === 'VERIFIED' || p.verificationState === 'DERIVED')) v('TIER3_VERIFIED', r, p, 'A TIER3/TIER4 source cannot verify.');
      // lifecycle: superseded / expired never current
      p.history.forEach((h, i) => { if (i < p.history.length - 1 && h.status !== 'SUPERSEDED') v('HISTORY_OLD_STEP_NOT_SUPERSEDED', r, p, `History step ${h.step} is ${h.status} but a later revision exists.`); });
      // 5. CAGR is never a single-year figure
      if (p.periodKind === 'MULTI_YEAR_CAGR' || p.durationType === 'CAGR' || p.durationType === 'MULTI_YEAR') {
        if (p.cohort === 'ANNUAL' || p.hg === 'SINGLE_YEAR') v('CAGR_AS_SINGLE_YEAR', r, p, 'A multi-year / CAGR figure is classified as single-year.');
        if (p.low != null && p.guidanceType !== 'CAGR' && p.durationType === 'CAGR') v('CAGR_NOT_CAGR_TYPE', r, p, 'A CAGR point does not carry guidanceType CAGR.');
      }
      if (p.durationType === 'QUARTER' && p.cohort && p.cohort !== 'QUARTERLY') v('QUARTER_WRONG_COHORT', r, p, 'A quarterly point is not in the QUARTERLY cohort.');
      // 6. analyst / consensus / media / system rows are never management guidance
      if (p.claimType !== 'MANAGEMENT_GUIDANCE') v('NON_MANAGEMENT_IN_UNIVERSE', r, p, `A ${p.claimType} row is in the universe.`);
      const k = r.record?.primary?.kind; if (k && /^ANALYST_/.test(k) && r.record.primary.metric === p.metric && r.origin === 'LIVE') v('ANALYST_AS_GUIDANCE', r, p, `The record's primary point is ${k}.`);
      // 7. reiteration and capital raise are never a RAISE
      const stmt = p.statement || ''; const hadRaiseStep = p.history.some((h) => h.revision === 'RAISED');
      if (p.revision === 'RAISED' && !hadRaiseStep && !textSaysGuidanceRaised(stmt) && (isCapitalRaise(stmt) || isReiteration(stmt))) v('RAISE_FROM_REITERATION_OR_CAPITAL_RAISE', r, p, 'A reiteration or a capital raise is marked RAISED.');
      // growth basis wording and consistency
      if (/\(implied\)/.test(p.display)) v('BARE_IMPLIED', r, p, 'The display says (implied) without a basis.');
      if (p.growthType === 'DERIVED' && !/derived: /.test(p.display)) v('DERIVED_NO_BASIS_IN_DISPLAY', r, p, 'A derived growth display does not show its amounts.');
      if (p.sourceConflict && p.sources.length < 2) v('CONFLICT_WITHOUT_TWO_SOURCES', r, p, 'sourceConflict is set but fewer than two sources are stored.');
    }
  }
  // inactive records are never current
  for (const x of bundle.inactive ?? []) {
    if (x.current !== false || x.lifecycle === 'ACTIVE') out.push({ code: 'INACTIVE_IS_CURRENT', entityKey: x.entityKey, company: x.company, metric: x.metric, message: `A ${x.status} record is marked current.` });
    if (!x.expiryReason) out.push({ code: 'INACTIVE_NO_REASON', entityKey: x.entityKey, company: x.company, metric: x.metric, message: 'An inactive record has no expiryReason.' });
  }
  for (const x of bundle.excluded ?? []) if (x.claimType === 'MANAGEMENT_GUIDANCE' && /analyst|consensus/i.test(x.reason)) out.push({ code: 'EXCLUDED_REASON_MISMATCH', entityKey: null, company: x.company, metric: x.metric, message: 'An analyst row is typed as management guidance.' });
  return out;
}
