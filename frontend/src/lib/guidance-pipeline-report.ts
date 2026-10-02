// zzz860 — PIPELINE REPORT: for a list of companies (given by the caller: a test fixture or the owner's list; nothing here names a company), what state did the real pipeline
// leave each one in? Reads only the universe build the pipeline produced plus the document stores. Pure; no I/O, no clock.
import type { GuUniverseBuild } from './guidance-universe';
import type { GuidanceDocIndexRow, GuidanceExtractResult } from './guidance-docs-types';
import { normCompanyName } from './guidance-upgrades-candidates';
import type { GuCalculationType, GuEventType, GuVerificationStatus } from './guidance-semantics';

export type GuCompanyState = 'VERIFIED_ACTIVE' | 'VERIFIED_REPLACED' | 'REITERATION' | 'LOWERED' | 'WITHDRAWN' | 'EXPIRED' | 'PRIMARY_SOURCE_NOT_FOUND' | 'PRIMARY_SOURCE_FOUND_NOT_READ' | 'CLAIM_CONTRADICTED' | 'NO_VALID_GUIDANCE_FOUND'
  /** verified once, but the last check is too old to show as Active (one freshness rule) */ | 'VERIFIED_STALE' | 'NEEDS_REVIEW';
export interface GuSubject { name: string; ticker?: string | null; market?: 'IN' | 'US' | null }
export interface GuPipelineCtx {
  docs?: GuidanceDocIndexRow[]; extracted?: GuidanceExtractResult[];
  /** tickers (upper case) or normalised names the AI verifier contradicted */ contradicted?: string[];
}
/** The terminal states the regression is judged by. */
export type GuTerminal = 'PRIMARY_VERIFIED' | 'SECONDARY_ONLY' | 'PRIMARY_SOURCE_NOT_FOUND' | 'PRIMARY_SOURCE_READ_NO_GUIDANCE' | 'CLAIM_CONTRADICTED' | 'EXPIRED' | 'REPLACED' | 'LOWERED' | 'REITERATION' | 'PRIMARY_FOUND_NOT_READ' | 'NO_CLAIM_FOUND' | 'STALE_NEEDS_RECHECK';
export function terminalOf(state: GuCompanyState, secondaryClaimFound: boolean): GuTerminal {
  switch (state) {
    case 'VERIFIED_ACTIVE': return 'PRIMARY_VERIFIED';
    case 'VERIFIED_STALE': return 'STALE_NEEDS_RECHECK';
    case 'VERIFIED_REPLACED': return 'REPLACED';
    case 'REITERATION': return 'REITERATION';
    case 'LOWERED': return 'LOWERED';
    case 'EXPIRED': case 'WITHDRAWN': return 'EXPIRED';
    case 'CLAIM_CONTRADICTED': return 'CLAIM_CONTRADICTED';
    case 'PRIMARY_SOURCE_FOUND_NOT_READ': return 'PRIMARY_FOUND_NOT_READ';
    case 'PRIMARY_SOURCE_NOT_FOUND': return 'PRIMARY_SOURCE_NOT_FOUND';
    case 'NO_VALID_GUIDANCE_FOUND': return secondaryClaimFound ? 'PRIMARY_SOURCE_READ_NO_GUIDANCE' : 'NO_CLAIM_FOUND';
    default: return secondaryClaimFound ? 'SECONDARY_ONLY' : 'NO_CLAIM_FOUND';
  }
}
export interface GuPipelineRow {
  name: string; ticker: string | null; market: 'IN' | 'US' | null;
  discovered: boolean; company_resolved: boolean; primary_source_found: boolean; primary_source_opened: boolean; guidance_found: boolean;
  metric: string | null; period: string | null; current_guidance: string | null; previous_guidance: string | null;
  event_type: GuEventType | null; calculation_type: GuCalculationType | null; verification_status: GuVerificationStatus | null;
  active_status: 'ACTIVE' | 'NEEDS_REVIEW' | 'CLAIM_AWAITING' | 'INACTIVE' | 'NONE'; source_date: string | null; state: GuCompanyState; reason: string;
  /** zzz861 */ secondary_claim_found: boolean; terminal: GuTerminal;
}
export interface GuPipelineReport { rows: GuPipelineRow[]; total: number; counts: Record<GuCompanyState, number>; verifiedActive: number; withExplicitState: number; summary: string }
const STATES: GuCompanyState[] = ['VERIFIED_ACTIVE', 'VERIFIED_REPLACED', 'REITERATION', 'LOWERED', 'WITHDRAWN', 'EXPIRED', 'PRIMARY_SOURCE_NOT_FOUND', 'PRIMARY_SOURCE_FOUND_NOT_READ', 'CLAIM_CONTRADICTED', 'NO_VALID_GUIDANCE_FOUND', 'VERIFIED_STALE', 'NEEDS_REVIEW'];

export function pipelineReport(build: Pick<GuUniverseBuild, 'records' | 'defaultRecords' | 'reviewQueue' | 'claimsAwaiting' | 'inactive'>, subjects: GuSubject[], ctx: GuPipelineCtx = {}): GuPipelineReport {
  const contra = new Set((ctx.contradicted || []).map((x) => String(x).toUpperCase()));
  const rows: GuPipelineRow[] = subjects.map((s) => {
    const nm = normCompanyName(s.name); const tk = (s.ticker || '').toUpperCase() || null;
    const hit = <T extends { names?: string[]; tickers?: string[]; record: { market: string } }>(r: T) => (!s.market || r.record.market === s.market) && ((tk && (r.tickers || []).includes(tk)) || (r.names || []).some((n) => n === nm || (nm.length >= 5 && (n.startsWith(`${nm} `) || nm.startsWith(`${n} `)))));
    const inAct = (build.defaultRecords || []).filter(hit), inRev = (build.reviewQueue || []).filter(hit), inClm = (build.claimsAwaiting || []).filter(hit);
    const inactive = (build.inactive || []).filter((x) => (!s.market || x.market === s.market) && ((tk && x.ticker === tk) || normCompanyName(x.company) === nm));
    const docs = (ctx.docs || []).filter((d) => (!s.market || d.market === s.market) && ((tk && (d.ticker || '').toUpperCase() === tk) || normCompanyName(d.company) === nm));
    const xr = (ctx.extracted || []).filter((d) => (!s.market || d.market === s.market) && ((tk && (d.ticker || '').toUpperCase() === tk) || normCompanyName(d.company) === nm));
    const all = [...inAct, ...inRev, ...inClm];
    const resolved = all.some((r) => r.tickerResolved) || !!tk;
    const head = inAct[0] ?? inRev[0] ?? inClm[0] ?? null;
    const pt = head?.points[0] ?? null;
    const base = { name: s.name, ticker: tk ?? head?.tickers?.[0] ?? null, market: s.market ?? (head?.record.market as 'IN' | 'US' | undefined) ?? null };
    const common = {
      discovered: all.length > 0 || inactive.length > 0 || docs.length > 0, company_resolved: resolved,
      primary_source_found: docs.length > 0 || all.some((r) => r.primarySourceFound), primary_source_opened: xr.length > 0 || all.some((r) => r.primarySourceRead),
      guidance_found: all.length > 0 || inactive.length > 0 || xr.some((r) => r.rows.length > 0),
      metric: pt?.metric ?? null, period: pt?.period ?? null, current_guidance: pt?.display ?? null,
      previous_guidance: pt?.history?.length && pt.history.length > 1 ? pt.history[pt.history.length - 2].to.display : null,
      event_type: (pt?.eventType ?? null) as GuEventType | null, calculation_type: (pt?.calculationType ?? null) as GuCalculationType | null, verification_status: (pt?.verificationStatus ?? null) as GuVerificationStatus | null,
      source_date: pt?.sourceDate ?? null,
    };
    const secondary = all.length > 0 || inactive.length > 0;
    const done = (state: GuCompanyState, active_status: GuPipelineRow['active_status'], reason: string): GuPipelineRow => ({ ...base, ...common, active_status, state, reason, secondary_claim_found: secondary, terminal: terminalOf(state, secondary) });
    const contradicted = [tk, nm.toUpperCase()].some((k) => !!k && contra.has(k as string));
    if (contradicted) return done('CLAIM_CONTRADICTED', 'NONE', "The AI check found the company's own document does not support the claim.");
    const wd = inactive.find((x) => x.status === 'WITHDRAWN');
    if (wd && !inAct.length) return done('WITHDRAWN', 'INACTIVE', wd.reason);
    if (inAct.length) {
      const p = inAct[0].points[0];
      if (inactive.some((x) => x.status === 'SUPERSEDED' && x.metric === p.metric)) return done('VERIFIED_REPLACED', 'ACTIVE', 'A later verified record replaced an earlier one; the newer one is active.');
      if (p.revision === 'MAINTAINED') return done('REITERATION', 'ACTIVE', 'Management repeated its guidance; still active.');
      if (p.revision === 'LOWERED') return done('LOWERED', 'ACTIVE', 'Guidance was lowered; the lowered figure is active.');
      return done('VERIFIED_ACTIVE', 'ACTIVE', p.wording);
    }
    if (inRev.length) { const r = inRev[0]; if (r.points[0].revision === 'LOWERED') return done('LOWERED', 'NEEDS_REVIEW', 'Lowered; kept out of Active for review.'); const codes = r.reviewReasonCodes || []; if (codes.includes('STALE_VERIFICATION')) return done('VERIFIED_STALE', 'NEEDS_REVIEW', r.reviewReasons?.[codes.indexOf('STALE_VERIFICATION')] || 'Last check is too old.'); return done('NEEDS_REVIEW', 'NEEDS_REVIEW', r.reviewReasons?.[0] || 'Kept out of Active: something does not add up.'); }
    if (inClm.length) {
      const r = inClm[0]; const p = r.points[0];
      return p.primarySourceFound && !p.primarySourceRead ? done('PRIMARY_SOURCE_FOUND_NOT_READ', 'CLAIM_AWAITING', "The company's own document was found but has not been read yet.")
        : done('PRIMARY_SOURCE_NOT_FOUND', 'CLAIM_AWAITING', p.awaitingVerificationReason || 'Only a media or secondary source backs this; the company document was not found.');
    }
    const ex = inactive.find((x) => x.status === 'EXPIRED');
    if (ex) return done('EXPIRED', 'INACTIVE', ex.reason);
    if (inactive.length) return done('VERIFIED_REPLACED', 'INACTIVE', 'Replaced by a later record.');
    if (docs.length && docs.some((d) => d.extracted !== true) && !xr.length) return done('PRIMARY_SOURCE_FOUND_NOT_READ', 'NONE', `${docs.length} company document${docs.length === 1 ? '' : 's'} collected, not read by the extractor yet.`);
    if (docs.length || xr.length) return done('NO_VALID_GUIDANCE_FOUND', 'NONE', 'The collected documents were read; they contain no usable guidance.');
    return done('NO_VALID_GUIDANCE_FOUND', 'NONE', 'No document and no guidance found for this company.');
  });
  const counts = Object.fromEntries(STATES.map((st) => [st, 0])) as Record<GuCompanyState, number>;
  for (const r of rows) counts[r.state]++;
  const verifiedActive = counts.VERIFIED_ACTIVE + counts.VERIFIED_REPLACED + counts.REITERATION + counts.LOWERED;
  const parts = STATES.filter((st) => counts[st] > 0).map((st) => `${counts[st]} ${st.replace(/_/g, ' ').toLowerCase()}`);
  return { rows, total: rows.length, counts, verifiedActive, withExplicitState: rows.length, summary: `${verifiedActive}/${rows.length} have verified guidance on file. ${parts.join(', ')}.` };
}
