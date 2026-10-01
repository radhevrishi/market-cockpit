// zzz853 — GUIDANCE UNIVERSE INVARIANTS. A pure checker run on every universe bundle (the route returns `invariantViolations`; the seed run must have none).
// "Active" = a record in the DEFAULT VIEW (active + company resolved + period CONFIRMED + not flagged). The review queue may hold UNCLEAR / UNKNOWN periods and flagged
// records by design, but it must obey the same truth rules (nothing there may be VERIFIED by mistake, no analyst row may be guidance ...).
import type { GuExcluded, GuInactiveRecord, GuPoint, GuUniverseRecordX } from './guidance-universe';
import type { GuInvariantViolation } from './guidance-universe-types';
import { isCapitalRaise, isReiteration, textSaysGuidanceRaised } from './guidance-universe-integrity';

export interface GuInvariantBundle {
  /** the default view (preferred). When absent, `records` is checked as the active set. */ defaultRecords?: GuUniverseRecordX[];
  records?: GuUniverseRecordX[]; reviewQueue?: GuUniverseRecordX[]; inactive?: GuInactiveRecord[]; excluded?: GuExcluded[];
}

export function checkUniverseInvariants(bundle: GuInvariantBundle): GuInvariantViolation[] {
  const out: GuInvariantViolation[] = [];
  const v = (code: string, r: GuUniverseRecordX | null, p: GuPoint | null, message: string) => out.push({ code, entityKey: r?.entityKey ?? null, company: r?.record?.company ?? null, metric: p?.metric ?? null, message });
  const active = bundle.defaultRecords ?? bundle.records ?? [];
  const queue = bundle.reviewQueue ?? [];

  // 1-2. every ACTIVE (default view) record is fully identified and has an established period
  for (const r of active) {
    if (!r.companyId) v('ACTIVE_NO_COMPANY_ID', r, null, 'An active record has no companyId (the company is not resolved).');
    if (!r.record?.market) v('ACTIVE_NO_MARKET', r, null, 'An active record has no market.');
    if (!(r.tickers?.[0] || r.record?.ticker)) v('ACTIVE_NO_TICKER', r, null, 'An active record has no ticker.');
    for (const p of r.points) {
      if (p.periodStatus === 'UNKNOWN') v('ACTIVE_PERIOD_UNKNOWN', r, p, `An active point has periodStatus UNKNOWN (${p.periodLabelSource}).`);
      else if (p.periodStatus !== 'CONFIRMED') v('DEFAULT_PERIOD_NOT_CONFIRMED', r, p, `A default-view point has periodStatus ${p.periodStatus} (${p.periodLabelSource}); UNCLEAR is allowed only outside the default view.`);
      if (p.needsReview) v('DEFAULT_NEEDS_REVIEW', r, p, 'A default-view point is flagged needs review.');
      if (p.status !== 'ACTIVE' || !p.current) v('ACTIVE_NOT_CURRENT', r, p, `A default-view point has status ${p.status}.`);
      if (p.periodRunState === 'EXPIRED') v('ACTIVE_PERIOD_EXPIRED', r, p, 'A default-view point is for a period that has ended.');
    }
  }
  for (const r of [...active, ...queue]) {
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
      if (p.verificationState === 'DERIVED' && (p.sourceTier > 2 || !p.growthDerivation)) v('DERIVED_WITHOUT_PRIMARY_NUMBERS', r, p, 'A DERIVED point has no primary source or no derivation numbers.');
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
