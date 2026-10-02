// zzz853 — pure UI helpers for the Guidance Upgrades tab (no React, no I/O). Everything here is a text or grouping rule so it can be tested with plain asserts.
// Rules: never invent a number, Unknown stays "Unknown" (never negative), a missing field renders gracefully (old cached responses), no scores and no trade-call wording.
import type { CoverageCard, GuCacheRow, GuidanceEvent } from '../../lib/guidance-upgrades-types';
import type {
  GuCohort, GuExpirySummary, GuHgGroupRow, GuHgMetricX, GuHighGrowthGroups, GuStateCounts, GuTrust, GuViewCounts, GuCountEquations, GuEventOverride, GuEventStatus,
} from '../../lib/guidance-universe-types';
import type { GuPipelineCounts, GuReviewItem, GuReviewStatus, GuValidationIssue } from '../../lib/guidance-upgrades-types';
import type { GuUniverseRecord } from '../../lib/guidance-universe-types';
import type { GuUniverseRecordX } from '../../lib/guidance-universe';
import { hasRealRaise, isReiteration, eventLabelText, fmtBeforeAfter, METRIC_LABEL, PRIMARY_SOURCE_STATE_LABEL, REVIEW_STATUS_LABEL, TAXONOMY_LABEL, pipelineCountsLine, primaryStateLine, reviewItemLine, stageOf, STAGE_ORDER } from '../../lib/guidance-upgrades-format';
import type { GuStage } from '../../lib/guidance-upgrades-types';
import { AGING_MAX_DAYS } from '../../lib/guidance-config';
import { freshnessOf, guidanceWording, type GuVerificationStatus } from '../../lib/guidance-semantics';

export const UNKNOWN = 'Unknown';

/** A universe record as the page receives it: the older shape plus the additive zzz853 fields, all optional (an older cached answer lacks them). */
export type GuRecX = GuUniverseRecord & Partial<Pick<GuUniverseRecordX,
  'entityKey' | 'verificationState' | 'growthType' | 'basisLabel' | 'growthVsPriorYear' | 'revisionVsPriorGuidance' | 'cohort' | 'periodNormalized' | 'lastVerified' | 'lastVerifiedDaysAgo'
  | 'staleVerification' | 'sourceConflict' | 'reviewReasons' | 'reviewReasonCodes' | 'inReviewQueue' | 'caveats' | 'sources' | 'history' | 'needsReview' | 'claimType' | 'sourceTier' | 'primaryValue' | 'mediaClaim'
  | 'listBucket' | 'eventOverride' | 'latestEvent'>> & { points?: Array<{ awaitingVerificationReason?: string | null }> };


// ── section titles ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface GuSectionDef { key: 'active' | 'verified' | 'derived' | 'claimsAwaiting'; title: string; hint: string }
export const SECTION_ACTIVE = 'HIGHEST ACTIVE GUIDANCE';
export const SECTION_VERIFIED = 'HIGHEST VERIFIED';
export const SECTION_DERIVED = 'HIGHEST DERIVED';
export const SECTION_CLAIMS = 'CLAIMS AWAITING VERIFICATION';
export const SECTIONS: GuSectionDef[] = [
  { key: 'active', title: SECTION_ACTIVE, hint: 'Every active guidance that passes the checks, whatever its trust level. A ranking by guided growth only.' },
  { key: 'verified', title: SECTION_VERIFIED, hint: 'Strict. The company\'s own document was read, the company stated the % itself, and the period is confirmed.' },
  { key: 'derived', title: SECTION_DERIVED, hint: 'The company gave amounts, not a %. We worked the growth out. The basis is shown on each row.' },
  { key: 'claimsAwaiting', title: SECTION_CLAIMS, hint: 'Found in media or another secondary source. The company document has not been read yet. Not proof.' },
];

// ── cohorts ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const COHORT_ORDER: GuCohort[] = ['ANNUAL', 'MULTI_YEAR_CAGR', 'QUARTERLY'];
export const COHORT_LABEL: Record<GuCohort, string> = { ANNUAL: 'Annual (one year)', MULTI_YEAR_CAGR: 'Multi-year CAGR', QUARTERLY: 'Quarterly' };
export const COHORT_HINT: Record<GuCohort, string> = {
  ANNUAL: 'Growth for one full year.',
  MULTI_YEAR_CAGR: 'Growth per year over several years. Not comparable with a one-year figure.',
  QUARTERLY: 'Growth for one quarter or half-year. Not comparable with a full-year figure.',
};
export function cohortLabel(c: string | null | undefined): string { return (c && COHORT_LABEL[c as GuCohort]) || UNKNOWN; }

// ── verification badges ───────────────────────────────────────────────────────────────────────────────────────────
export type BadgeTone = 'green' | 'amber' | 'violet' | 'grey' | 'red';
export interface GuBadge { glyph: string; label: string; tip: string; tone: BadgeTone }
export const BADGES = {
  VERIFIED: { glyph: '✓', label: 'verified', tone: 'green', tip: 'Verified. The company\'s own document was read and states this figure.' },
  PARTIAL: { glyph: '◐', label: 'partly verified', tone: 'amber', tip: 'Partly verified. One source or a media report backs this. The company document is not fully read.' },
  DERIVED: { glyph: '◑', label: 'derived', tone: 'violet', tip: 'Derived. The company gave amounts, not a %. We worked out the growth from those amounts. See the basis shown.' },
  UNVERIFIED: { glyph: '○', label: 'unverified', tone: 'grey', tip: 'Unverified. A claim was found but the company document has not been read.' },
  REVIEW: { glyph: '⚠', label: 'needs review', tone: 'red', tip: 'Needs review. Something does not add up yet, for example an unclear period. Check the reason shown.' },
  CONFLICT: { glyph: '⚠', label: 'sources disagree', tone: 'red', tip: 'Two sources give different figures for the same guidance. Both are shown. Nothing is averaged.' },
} as const satisfies Record<string, GuBadge>;
export const BADGE_LEGEND = '✓ verified · ◐ partly verified · ◑ derived (worked out from amounts) · ○ unverified · ⚠ sources disagree or needs review';

interface BadgeIn { verificationState?: string | null; sourceConflict?: boolean | null; needsReview?: unknown; inReviewQueue?: boolean | null }
/** One badge from the backend trust state. Conflict and needs-review win over the trust glyph. Unknown state is shown as unverified, never as an error. */
export function verificationBadge(state: string | null | undefined, o: { sourceConflict?: boolean | null; needsReview?: boolean | null } = {}): GuBadge {
  if (o.sourceConflict) return BADGES.CONFLICT;
  const s = String(state || '').toUpperCase();
  if (s === 'PERIOD_UNCLEAR' || o.needsReview) return BADGES.REVIEW;
  if (s === 'VERIFIED') return BADGES.VERIFIED;
  if (s === 'PARTIAL' || s === 'PARTIALLY_VERIFIED') return BADGES.PARTIAL;
  if (s === 'DERIVED' || s === 'IMPLIED') return BADGES.DERIVED;
  return BADGES.UNVERIFIED;
}
/** Badge for a whole universe record. Old cached responses carry no verificationState, so fall back to the older verification field. */
export function recordBadge(r: BadgeIn & { mediaOnly?: boolean; record?: { verification?: string } }): GuBadge {
  const needs = !!(r.inReviewQueue || (typeof r.needsReview === 'string' && r.needsReview.trim()) || r.needsReview === true);
  if (r.verificationState) return verificationBadge(r.verificationState, { sourceConflict: !!r.sourceConflict, needsReview: needs });
  const v = r.record?.verification;
  const st = r.mediaOnly || v === 'SECONDARY_ONLY' || v === 'UNVERIFIED' ? 'UNVERIFIED' : v === 'PARTIALLY_VERIFIED' ? 'PARTIAL' : v === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED';
  return verificationBadge(st, { sourceConflict: !!r.sourceConflict, needsReview: needs });
}

// ── counts ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const n0 = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
/** 'X verified · Y partial · Z unverified/derived'. Z = unverified + derived + period-unclear (everything that is not verified or partial). Null when no counts.
 *  zzz854: when the backend sends the Active equation it is used as is ('Active 45 = 30 verified + 10 derived + 5 partial ...'), so the header adds up. */
export function stateCountsLine(c: Partial<GuStateCounts> | null | undefined, eq?: Partial<GuCountEquations> | null): string | null {
  const a = eq?.active;
  if (a && typeof a.text === 'string' && a.text.trim()) return a.holds === false ? `${a.text.trim()} (data check failed)` : a.text.trim();
  if (!c || !isNum(c.activeRecords)) return null;
  return `${n0(c.verified)} verified · ${n0(c.partial)} partial · ${n0(c.unverified) + n0(c.derived) + n0(c.periodUnclear)} unverified/derived`;
}
/** Same split from the grouped high-growth counts (claims awaiting = unverified). */
export function groupCountsLine(c: Partial<GuHighGrowthGroups['counts']> | null | undefined): string | null {
  if (!c || !isNum(c.rows)) return null;
  return `${n0(c.verified)} verified · ${n0(c.partial)} partial · ${n0(c.derived) + n0(c.claimsAwaiting)} unverified/derived`;
}
/** zzz862: the trust split of the rows ACTUALLY LISTED (one row = one company per cohort), never the page-wide counts (which also hold claims and other lists). */
export function rowTrustLine(c: CohortRows): string {
  const all = COHORT_ORDER.flatMap((k) => c[k]);
  const n = (t: GuTrust) => all.filter((r) => r.trust === t).length;
  const stale = all.filter((r) => r.trust === 'verified' && (r.headline as any)?.freshness === 'STALE').length;
  return `${n('verified')} verified · ${n('derived')} derived · ${n('partial')} partial · ${n('claimsAwaiting')} unverified (${all.length} companies listed${stale ? `; ${stale} of the verified need a fresh check` : ''})`;
}
export function rowCohortLine(c: CohortRows): string { return `${c.ANNUAL.length} annual · ${c.MULTI_YEAR_CAGR.length} multi-year CAGR · ${c.QUARTERLY.length} quarterly`; }
export function cohortCountsLine(c: Partial<GuHighGrowthGroups['counts']> | null | undefined): string | null {
  if (!c || !isNum(c.rows)) return null;
  return `${n0(c.ANNUAL)} annual · ${n0(c.MULTI_YEAR_CAGR)} multi-year CAGR · ${n0(c.QUARTERLY)} quarterly`;
}

// ── review reasons (plain English) ────────────────────────────────────────────────────────────────────────────────
export const REVIEW_REASON_TEXT: Record<string, string> = {
  PERIOD_UNCLEAR: 'The year is not stated in the source, so the period is unclear.',
  PERIOD_UNKNOWN: 'The period is not stated.',
  SECONDARY_ONLY: 'Only media reported this. No company document yet.',
  PRIMARY_MISSING: 'The company\'s own document was not found.',
  SOURCE_CONFLICT: 'Two sources give different figures. Both are shown.',
  EXPIRED: 'The guided period has ended.',
  POTENTIAL_DUPLICATE: 'This may repeat another record.',
  NEEDS_REVIEW: 'Flagged for a manual check.',
  COMPANY_UNRESOLVED: 'The company could not be matched to a listed name.',
  METRIC_LABEL_MISMATCH: 'The metric name in the source does not match the metric shown.',
  // zzz854
  AWAITING_VERIFICATION: 'Not yet confirmed by the company\'s own document. Kept out of Active until it is.',
  EVENT_CONFLICT: 'A newer company filing says something different. The filing wins, so this record left Active.',
  NEWER_PERIOD_GUIDANCE: 'The company has already guided a later period. This older period is kept for review.',
  STALE_VERIFICATION: 'Not checked against the company document for a long time.',
  INVARIANT_FAILED: 'A data check failed, so this is kept out of Active.',
};
export const REASON_SHORT: Record<string, string> = {
  PERIOD_UNCLEAR: 'Period unclear', PERIOD_UNKNOWN: 'Period not stated', SECONDARY_ONLY: 'Media only', PRIMARY_MISSING: 'Company document not found', SOURCE_CONFLICT: 'Sources disagree',
  EXPIRED: 'Period ended', POTENTIAL_DUPLICATE: 'Possible duplicate', NEEDS_REVIEW: 'Manual check', COMPANY_UNRESOLVED: 'Company not matched', METRIC_LABEL_MISMATCH: 'Metric name mismatch',
  AWAITING_VERIFICATION: 'Awaiting verification', EVENT_CONFLICT: 'Newer filing disagrees', NEWER_PERIOD_GUIDANCE: 'Later period already guided', STALE_VERIFICATION: 'Verification stale', INVARIANT_FAILED: 'Data check failed',
};
const prettyCode = (c: string) => { const t = c.toLowerCase().replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
export function reasonText(code: string): string { return REVIEW_REASON_TEXT[code] || prettyCode(code); }
/** Plain-English reasons for a record. Uses the codes when known, else the backend sentence at the same position. Never empty strings. */
export function reasonsPlain(r: { reviewReasons?: string[] | null; reviewReasonCodes?: string[] | null } | null | undefined): string[] {
  if (!r) return [];
  const codes = Array.isArray(r.reviewReasonCodes) ? r.reviewReasonCodes : [];
  const texts = Array.isArray(r.reviewReasons) ? r.reviewReasons : [];
  const n = Math.max(codes.length, texts.length);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = (codes[i] && REVIEW_REASON_TEXT[codes[i]]) || (texts[i] && String(texts[i]).trim()) || (codes[i] ? prettyCode(codes[i]) : '');
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}
/** 'Period unclear 5 · Media only 3' sorted by size. Empty when none. */
export function reasonCountsParts(c: Record<string, number> | null | undefined): Array<{ code: string; label: string; n: number }> {
  if (!c || typeof c !== 'object') return [];
  return Object.entries(c).filter(([, n]) => isNum(n) && n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code, n]) => ({ code, label: REASON_SHORT[code] || prettyCode(code), n }));
}
export function reasonCountsLine(c: Record<string, number> | null | undefined): string | null {
  const p = reasonCountsParts(c);
  return p.length ? p.map((x) => `${x.label} ${x.n}`).join(' · ') : null;
}

// ── view toggle (Active / Needs review / History) ────────────────────────────────────────────────────────────────
export type GuView = 'active' | 'review' | 'claims' | 'history';
export const VIEW_ORDER: GuView[] = ['active', 'review', 'claims', 'history'];
export function viewLabel(v: GuView, vc?: Partial<GuViewCounts> | null): string {
  const base = v === 'active' ? 'Active' : v === 'review' ? 'Needs review' : v === 'claims' ? 'Claims awaiting verification' : 'History';
  if (!vc) return base;
  const n = v === 'active' ? vc.default : v === 'review' ? vc.review : v === 'claims' ? vc.claimsAwaiting : isNum(vc.expired) || isNum(vc.superseded) || isNum(vc.withdrawn) ? n0(vc.expired) + n0(vc.superseded) + n0(vc.withdrawn) + n0(vc.excluded) : undefined;
  return isNum(n) ? `${base} (${n})` : base;
}
export const VIEW_HINT: Record<GuView, string> = {
  active: 'Default view. Company matched, period confirmed, nothing flagged.',
  review: 'Active guidance kept out of the default view. The reason is shown on each row.',
  claims: 'Found in media or not yet confirmed by the company\'s own document. Never ranked or counted in Active. The reason is shown on each row.',
  history: 'Guidance that is no longer in force (ended, replaced or withdrawn) and rows left out on purpose.',
};
/** The API value for each view. */
export function viewParam(v: GuView): GuView { return v; }
export function viewCountsLine(vc: Partial<GuViewCounts> | null | undefined): string | null {
  if (!vc || !isNum(vc.default)) return null;
  return `${n0(vc.default)} active · ${n0(vc.review)} need review${isNum(vc.claimsAwaiting) ? ` · ${vc.claimsAwaiting} awaiting verification` : ''} · ${n0(vc.expired)} ended · ${n0(vc.superseded)} replaced · ${n0(vc.withdrawn)} withdrawn · ${n0(vc.excluded)} left out`;
}
export function expiryLine(x: Partial<GuExpirySummary> | null | undefined): string | null {
  if (!x || !isNum(x.total)) return null;
  return `${x.total} no longer active: ${n0(x.expired)} period ended · ${n0(x.superseded)} replaced · ${n0(x.withdrawn)} withdrawn`;
}
export function excludedWhy(x: { reason?: string | null }): string { return `${x.reason || 'left out'}`; }

// ── growth basis (derived growth shows its base; both bases when both exist) ─────────────────────────────────────
export interface BasisText { main: string; detail: string | null; revision: string | null; line: string }
/** 'vs FY26 actual (derived: ₹210–225 Cr vs ₹108.23 Cr)' -> head 'vs FY26 actual (derived)' + detail '₹210–225 Cr vs ₹108.23 Cr'. */
export function splitDerivedBasis(label: string | null | undefined): { head: string; detail: string | null } {
  const t = (label || '').trim();
  const m = /^(.*?)\s*\(derived:\s*(.*)\)\s*$/i.exec(t);
  if (m) return { head: `${m[1].trim()} (derived)`.trim(), detail: m[2].trim() || null };
  return { head: t, detail: null };
}
/** 'raised +20.8% vs prior guidance (...)' -> '+20.8% vs prior guidance'. Keeps pp. Falls back to the full backend text. Null when absent. */
export function revisionShort(display: string | null | undefined): string | null {
  const t = (display || '').trim();
  if (!t) return null;
  const m = /^(raised|lowered|unchanged)\s*([+\-−]?\s*[\d.,]+)\s*(%|pp)?\s*vs prior guidance/i.exec(t);
  if (!m) return t;
  if (/^unchanged/i.test(m[1])) return 'unchanged vs prior guidance';
  const num = m[2].replace(/\s+/g, '').replace('−', '-');
  const signed = /^[+-]/.test(num) ? num : `${/^lowered/i.test(m[1]) ? '-' : '+'}${num}`;
  return `${signed}${m[3] === 'pp' ? ' pp' : '%'} vs prior guidance`;
}
interface BasisIn { /** zzz860: verification status of the figure; decides whether 'Company stated' may be used */ verificationStatus?: string | null; calculationType?: string | null; short?: string | null; display?: string | null; growthType?: string | null; basisLabel?: string | null; revisionVsPriorGuidance?: string | { display?: string | null } | null }
/** Basis text for one metric. Derived growth: '+94% vs FY26 actual (derived)'; when a prior-guidance revision also exists it is added: '... · +20.8% vs prior guidance'. */
export function basisText(m: BasisIn): BasisText {
  const gt = String(m.growthType || '').toUpperCase();
  const base = (m.short || m.display || '').trim();
  const revRaw = typeof m.revisionVsPriorGuidance === 'string' ? m.revisionVsPriorGuidance : m.revisionVsPriorGuidance?.display;
  const revision = revisionShort(revRaw);
  let main: string; let detail: string | null = null;
  if (gt === 'DERIVED') {
    const g = base.replace(/\s*\(derived\)\s*$/i, '') || UNKNOWN;
    const sp = splitDerivedBasis(m.basisLabel);
    main = sp.head ? `${g} ${sp.head}` : `${g} (derived)`; detail = sp.detail;
  } else if (gt === 'IMPLIED') {
    main = `${base || UNKNOWN} ${m.basisLabel ? `(${m.basisLabel})` : '(implied, base not sourced)'}`.trim();
  } else if (gt === 'EXPLICIT') {
    // zzz860: 'Company stated' only when the company's own document was read; a media figure says who reports it
    main = `${base || UNKNOWN} · ${guidanceWording(m.verificationStatus as GuVerificationStatus | null, 'explicit')}`;
  } else {
    main = `${base || UNKNOWN}${m.basisLabel ? ` · ${m.basisLabel}` : ''}`;
  }
  if (gt !== 'EXPLICIT' && m.verificationStatus && gt) { const w = guidanceWording(m.verificationStatus as GuVerificationStatus, gt === 'DERIVED' ? 'derived' : gt === 'IMPLIED' ? 'implied' : 'amount_only'); detail = detail ? `${detail}. ${w}` : w; }
  return { main, detail, revision, line: revision ? `${main} · ${revision}` : main };
}
/** Basis for a whole universe record: growth vs prior-year actual AND the revision vs prior guidance, both when both exist. */
export function recordBasis(r: { verificationStatus?: string | null; growthVsPriorYear?: { display?: string | null; type?: string | null; baseLabel?: string | null } | null; revisionVsPriorGuidance?: { display?: string | null } | null; basisLabel?: string | null; growthType?: string | null; display?: string | null } | null | undefined): BasisText | null {
  if (!r) return null;
  const g = r.growthVsPriorYear;
  const revision = revisionShort(r.revisionVsPriorGuidance?.display);
  if (!g && !revision && !r.growthType) return null;
  if (g?.display) {
    const t = String(g.type || r.growthType || '').toUpperCase();
    const sp = t === 'DERIVED' ? splitDerivedBasis(g.display) : { head: g.display, detail: null };
    let main = sp.head; let detail = sp.detail;
    const vs = r.verificationStatus as GuVerificationStatus | null | undefined;
    if (vs) { const w = guidanceWording(vs, t === 'DERIVED' ? 'derived' : t === 'IMPLIED' ? 'implied' : 'explicit'); if (t === 'DERIVED' || t === 'IMPLIED') detail = detail ? `${detail}. ${w}` : w; else main = `${main} · ${w}`; }
    return { main, detail, revision, line: revision ? `${main} · ${revision}` : main };
  }
  if (r.growthType) return basisText({ short: r.display, growthType: r.growthType, basisLabel: r.basisLabel, revisionVsPriorGuidance: r.revisionVsPriorGuidance, verificationStatus: (r as { verificationStatus?: string | null }).verificationStatus });
  return { main: '', detail: null, revision, line: revision || '' };
}

// ── last verified ─────────────────────────────────────────────────────────────────────────────────────────────────
export const STALE_AFTER_DAYS = AGING_MAX_DAYS;   // zzz860: one rule (guidance-config); kept as an alias
/** 'Last verified 12 days ago' / 'Last verified 75 days ago (stale)' / 'Last verified: Unknown'. */
export function lastVerifiedText(r: { lastVerified?: string | null; lastVerifiedDaysAgo?: number | null; staleVerification?: boolean | null } | null | undefined): { text: string; stale: boolean } {
  const d = r?.lastVerifiedDaysAgo;
  if (!isNum(d) || d < 0) return { text: r?.lastVerified ? `Last verified ${String(r.lastVerified).slice(0, 10)}` : `Last verified: ${UNKNOWN}`, stale: !!r?.staleVerification };
  const f = freshnessOf(d); const stale = f.stale;
  const when = d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`;
  return { text: `Last verified ${when}${f.tier === 'STALE' ? ' (stale)' : f.tier === 'AGING' ? ' (aging)' : ''}`, stale };
}

// ── freshness (three lines) ───────────────────────────────────────────────────────────────────────────────────────
const utc = (iso: string | null | undefined): string | null => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC` : null; };
export const SERVED_FROM_TEXT: Record<string, string> = { live: 'built live', last_good: 'saved copy from the last good build', seed: 'built-in research file only' };
export interface FreshnessIn {
  builtAt?: string | null; servedFrom?: string | null;
  scanRuns?: Array<string | null | undefined>;       // lastScanAt of each market
  newestItems?: Array<string | null | undefined>;    // newestItemAt of each market
  generatedAt?: string | null; now?: Date;
}
export interface FreshnessLine { label: string; text: string; known: boolean }
export function freshnessLines(f: FreshnessIn): FreshnessLine[] {
  const now = f.now ?? new Date();
  const built = utc(f.builtAt);
  const via = f.servedFrom ? SERVED_FROM_TEXT[f.servedFrom] || f.servedFrom : null;
  const scans = (f.scanRuns || []).map((x) => (x ? Date.parse(x) : NaN)).filter(Number.isFinite) as number[];
  const scanAt = scans.length ? utc(new Date(Math.max(...scans)).toISOString()) : utc(f.generatedAt);
  const news = (f.newestItems || []).map((x) => (x ? Date.parse(x) : NaN)).filter(Number.isFinite) as number[];
  let src = UNKNOWN;
  if (news.length) { const d = Math.max(0, Math.floor((now.getTime() - Math.max(...news)) / 86_400_000)); src = d === 0 ? 'newest source item is from today' : `newest source item is ${d} day${d === 1 ? '' : 's'} old`; }
  return [
    { label: 'Guidance data last updated', text: built ? `${built}${via ? ` (${via})` : ''}` : UNKNOWN, known: !!built },
    { label: 'Event scan last run', text: scanAt ?? UNKNOWN, known: !!scanAt },
    { label: 'Source freshness', text: src, known: src !== UNKNOWN },
  ];
}

// ── source display names ──────────────────────────────────────────────────────────────────────────────────────────
export function sourceDisplayName(name: string | null | undefined): string {
  const n = (name || '').trim();
  if (!n) return UNKNOWN;
  if (/sec edgar|edgar|8-?k/i.test(n)) return 'SEC filings (8-K)';
  if (/\bnse\b.*(filing|announce)|nse filings?/i.test(n)) return 'NSE filings';
  if (/\bbse\b.*(filing|announce)|bse filings?/i.test(n)) return 'BSE filings';
  if (/scraped filings/i.test(n)) return 'Scraped filings copy (backup)';
  if (/graded results/i.test(n)) return 'Graded results (saved copy)';
  if (/persisted event store/i.test(n)) return 'Saved events from earlier runs';
  if (/news cache/i.test(n)) return 'News feed (saved copy)';
  if (/company ir|investor relations/i.test(n)) return 'Company investor pages';
  if (/news discovery/i.test(n)) return 'News discovery';
  return n;
}
export const TIER_WORD: Record<string, string> = { PRIMARY: 'Primary (exchange or SEC)', SECONDARY: 'Secondary (media or saved copy)', FALLBACK: 'Backup copy' };
export const TIER1234_WORD: Record<string, string> = { TIER1: 'Company filing, release or presentation', TIER2: 'Company website or IR', TIER3: 'Reputable media', TIER4: 'Other source' };
export function sourceTierWord(t: string | null | undefined): string { return (t && (TIER1234_WORD[t] || TIER_WORD[t])) || UNKNOWN; }

// ── coverage cards ────────────────────────────────────────────────────────────────────────────────────────────────
export const FALLBACK_MESSAGE = 'Primary news cache unavailable; fallback scraped feed active';
/** The fallback line, only when it applies. Uses the backend note when sent, else derives it from the cache rows. */
export function fallbackMessage(card: Pick<CoverageCard, 'fallbackNote' | 'cache'> | null | undefined): string | null {
  if (!card) return null;
  const note = (card.fallbackNote || '').trim();
  if (note) return note;
  const rows: GuCacheRow[] = Array.isArray(card.cache) ? card.cache : [];
  return rows.some((c) => /news/i.test(c.name) && c.state !== 'HIT' && c.servedBy === 'FALLBACK_FEED') ? `${FALLBACK_MESSAGE}.` : null;
}
export const QUERY_TEXT: Record<string, string> = { SUCCESS: 'Query worked', FAILED: 'Query failed', NOT_AVAILABLE: 'Source not available' };
export function dataText(s: { dataStatus?: string; recordsRead?: number }): string {
  if (s.dataStatus === 'DATA_FOUND') return `${n0(s.recordsRead)} record${n0(s.recordsRead) === 1 ? '' : 's'} found`;
  if (s.dataStatus === 'ZERO_RESULTS') return 'Zero results (query worked)';
  return 'Unknown (a failed query is never a zero)';
}
export const STATUS_WORD: Record<string, string> = { COMPLETE: 'COMPLETE', PARTIAL: 'PARTIAL', FAILED: 'FAILED', EMPTY: 'EMPTY' };
/** Documents awaiting grading are reported apart from verified events, never added to them. */
export function documentsLine(c: Pick<CoverageCard, 'documentsAwaitingGrading' | 'documentsUnavailable' | 'verified'>): string[] {
  const out = [`Verified events: ${n0(c.verified)}`, `Documents awaiting grading: ${n0(c.documentsAwaitingGrading)} (not counted as verified)`];
  if (n0(c.documentsUnavailable)) out.push(`Documents whose source was unavailable: ${n0(c.documentsUnavailable)}`);
  return out;
}

// ── data-quality strip ────────────────────────────────────────────────────────────────────────────────────────────
export function violationTexts(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as { message?: unknown }).message === 'string' ? String((x as { message: string }).message) : '')).filter(Boolean);
}
export interface QualityStrip {
  stateLine: string | null; reasonLine: string | null; stale: number | null; conflicts: number | null; reviewQueue: number | null;
  violations: string[]; liveError: string | null; servedNote: string | null;
}
export function qualityStrip(d: {
  summary?: { counts?: Partial<GuStateCounts>; reviewReasonCounts?: Record<string, number>; staleVerificationCount?: number; sourceConflictCount?: number; reviewQueueCount?: number; countEquations?: Partial<GuCountEquations> } | null;
  invariantViolations?: unknown; liveError?: string | null; servedFrom?: string | null; countEquations?: Partial<GuCountEquations> | null;
} | null | undefined): QualityStrip {
  const s = d?.summary || {};
  return {
    stateLine: stateCountsLine(s.counts, d?.countEquations ?? s.countEquations), reasonLine: reasonCountsLine(s.reviewReasonCounts),
    stale: isNum(s.staleVerificationCount) ? s.staleVerificationCount : null, conflicts: isNum(s.sourceConflictCount) ? s.sourceConflictCount : null,
    reviewQueue: isNum(s.reviewQueueCount) ? s.reviewQueueCount : null,
    violations: violationTexts(d?.invariantViolations), liveError: d?.liveError ? String(d.liveError) : null,
    servedNote: d?.servedFrom && d.servedFrom !== 'live' ? `Showing ${SERVED_FROM_TEXT[d.servedFrom] || d.servedFrom}. The live build did not complete.` : null,
  };
}
export const INVARIANT_BANNER = 'Data check failed. Some counts may not add up. Do not rely on the numbers below until this is fixed.';

// ── grouping for the four sections ────────────────────────────────────────────────────────────────────────────────
export type CohortRows = Record<GuCohort, GuHgGroupRow[]>;
const emptyRows = (): CohortRows => ({ ANNUAL: [], MULTI_YEAR_CAGR: [], QUARTERLY: [] });
/** Rows of a section, by cohort, filtered to one market. Missing groups give empty lists (old cached responses). */
export function sectionRows(groups: GuHighGrowthGroups | null | undefined, key: GuSectionDef['key'], mk: 'IN' | 'US' | 'ALL'): CohortRows {
  const out = emptyRows();
  if (!groups) return out;
  const src: Partial<CohortRows> | undefined = key === 'active' ? groups.cohorts : key === 'verified' ? groups.trust?.verified : key === 'derived' ? groups.trust?.derived : groups.trust?.claimsAwaiting;
  for (const c of COHORT_ORDER) out[c] = (Array.isArray(src?.[c]) ? (src![c] as GuHgGroupRow[]) : []).filter((r) => mk === 'ALL' || r.market === mk);
  return out;
}
export const cohortTotal = (c: CohortRows): number => COHORT_ORDER.reduce((a, k) => a + c[k].length, 0);
export function trustKey(t: GuTrust): GuSectionDef['key'] { return t === 'claimsAwaiting' ? 'claimsAwaiting' : t === 'verified' ? 'verified' : t === 'derived' ? 'derived' : 'active'; }
/** Row text 'Revenue +30% · PAT +60%'; falls back to the metrics' short text. Never a number that is not in the row. */
export function groupRowText(r: Pick<GuHgGroupRow, 'text' | 'metrics'>): string {
  if (r.text && r.text.trim()) return r.text.trim();
  const ms = Array.isArray(r.metrics) ? r.metrics : [];
  return ms.length ? ms.map((m) => `${m.metric === 'PAT' ? 'PAT' : m.metric.charAt(0) + m.metric.slice(1).toLowerCase()} ${m.short || m.display || UNKNOWN}`).join(' · ') : UNKNOWN;
}
export function metricBadge(m: Pick<GuHgMetricX, 'verificationState' | 'sourceConflict'>): GuBadge { return verificationBadge(m.verificationState, { sourceConflict: m.sourceConflict }); }
export function rowBadge(r: Pick<GuHgGroupRow, 'headline' | 'trust'>): GuBadge {
  const h = r.headline;
  if (h) return metricBadge(h);
  return verificationBadge(r.trust === 'verified' ? 'VERIFIED' : r.trust === 'derived' ? 'DERIVED' : r.trust === 'partial' ? 'PARTIAL' : 'UNVERIFIED');
}

// ── events: labels, audit, counts ─────────────────────────────────────────────────────────────────────────────────
export type EventTone = 'green' | 'grey' | 'amber' | 'red';
export interface SafeLabel { label: string; note: string | null; tone: EventTone; dashed: boolean; audit: boolean }
/** The label shown on an event. GUIDANCE UPGRADE only when the numbers say RAISE and a primary document verified it. Old cached events (no label) are derived the same way. */
export function safeEventLabel(e: Pick<GuidanceEvent, 'displayLabel' | 'auditOnly' | 'auditNote' | 'classification' | 'verification' | 'v2' | 'changes'>): SafeLabel {
  const verified = e.verification === 'VERIFIED';
  let { label, note } = eventLabelText(e);
  if (!e.displayLabel) {
    const cls = e.classification;
    label = cls === 'MIXED' ? 'MIXED / RANGE CHANGE' : cls === 'DOWNGRADE' ? 'GUIDANCE LOWERED' : cls === 'REITERATION' || (!cls && isReiteration(e)) ? 'REITERATION'
      : (cls === 'RAISE' || (!cls && hasRealRaise(e))) && verified ? 'GUIDANCE UPGRADE' : 'UNVERIFIED CLAIM';
  }
  if (label === 'GUIDANCE UPGRADE' && !(verified && (e.classification === 'RAISE' || (!e.classification && hasRealRaise(e))))) label = 'UNVERIFIED CLAIM';
  const tone: EventTone = label === 'GUIDANCE UPGRADE' ? 'green' : label === 'REITERATION' ? 'grey' : label === 'GUIDANCE LOWERED' ? 'red' : 'amber';
  return { label, note, tone, dashed: label === 'UNVERIFIED CLAIM', audit: !!e.auditOnly };
}
export function splitAudit<T extends Pick<GuidanceEvent, 'auditOnly'>>(list: T[]): { main: T[]; audit: T[] } {
  const main: T[] = []; const audit: T[] = [];
  for (const e of list) (e.auditOnly ? audit : main).push(e);
  return { main, audit };
}
/** 'Upgrades 3 · Reiterations 2 · Mixed 1 · Lowered 0 · Unverified claims 4' from the canonical counts. Null when the backend sent none. */
export function eventCountsStrip(c: { upgrade?: number; reiteration?: number; mixed?: number; lowered?: number; unverifiedClaims?: number } | null | undefined): string | null {
  if (!c || !isNum(c.upgrade)) return null;
  return `Verified upgrades ${n0(c.upgrade)} · Reiterations ${n0(c.reiteration)} · Mixed or range change ${n0(c.mixed)} · Lowered ${n0(c.lowered)} · Unverified claims ${n0(c.unverifiedClaims)}`;
}

// ═══ zzz854 ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// ── universe: Highest active heading, per-record event reconciliation ───────────────────────────────────────────
/** 'HIGHEST ACTIVE GUIDANCE (29)' plus a note so 'Active 45' vs 'Highest active 29' is explained. Uses the backend equation when sent. */
export function highestActiveHeading(eq: Partial<GuCountEquations> | null | undefined, shownTotal: number, threshold: number): { title: string; note: string | null } {
  const h = eq?.highestActive;
  if (h && isNum(h.value)) {
    const a = eq?.active?.value;
    const note = `${isNum(h.threshold) ? h.threshold : threshold}% or more guided growth (Revenue, PAT or EBITDA) · ${isNum(h.companies) ? h.companies : UNKNOWN} companies${isNum(a) ? ` out of ${a} active` : ''}. ${h.text ? String(h.text).trim() : ''}`.trim();
    return { title: `${SECTION_ACTIVE} (${h.value})`, note: h.holds === false ? `${note} (data check failed)` : note };
  }
  return { title: `${SECTION_ACTIVE} (${shownTotal})`, note: `${threshold}% or more guided growth.` };
}
/** The record-level reconciliation lines: newer filing that wins, newest matching event, why it awaits verification. Empty when none. */
export function eventReconcileLines(r: { eventOverride?: GuEventOverride | null; latestEvent?: GuEventStatus | null; awaitingVerificationReason?: string | null; listBucket?: string | null } | null | undefined): Array<{ text: string; tone: 'red' | 'amber' | 'grey' }> {
  if (!r) return [];
  const out: Array<{ text: string; tone: 'red' | 'amber' | 'grey' }> = [];
  const o = r.eventOverride;
  if (o && (o.text || o.eventLabel)) out.push({ text: o.text ? String(o.text).trim() : `Latest filing (${o.eventDate}) says ${o.eventLabel}; this record said ${o.previousRevision}.`, tone: 'red' });
  const l = r.latestEvent;
  if (l && !o) out.push({ text: `Latest event: ${l.label}${l.display ? ` (${l.display})` : ''}, ${l.period}, ${l.date}${l.verified ? '' : ' — not verified, does not change this record'}${l.reason ? `. ${l.reason}` : ''}`, tone: l.verified ? 'grey' : 'amber' });
  if (r.awaitingVerificationReason && String(r.awaitingVerificationReason).trim()) out.push({ text: `Awaiting verification: ${String(r.awaitingVerificationReason).trim()}`, tone: 'amber' });
  return out;
}

// ── events: one primary-source state, taxonomy, validation, AI check, other changes ────────────────────────────
type EvX = Pick<GuidanceEvent, 'primaryState' | 'primaryStateText' | 'primarySourceUrl' | 'primarySourceDate'> & Partial<Pick<GuidanceEvent, 'primarySourceState' | 'taxonomy' | 'validationIssues' | 'otherChanges' | 'headlineBasis' | 'basisNote' | 'pipeline'>>;
/** ONE primary-source line, derived from primarySourceState when present (never 'awaiting' next to 'read'). Falls back to the older wording. */
export function primarySourceView(e: EvX): { text: string; tone: 'green' | 'amber' } | null {
  if (e.primarySourceState) {
    const t = PRIMARY_SOURCE_STATE_LABEL[e.primarySourceState] || UNKNOWN;
    return { text: `${t}${e.primarySourceDate ? ` (${String(e.primarySourceDate).slice(0, 10)})` : ''}`, tone: e.primarySourceState === 'read_numbers_found' ? 'green' : 'amber' };
  }
  const old = primaryStateLine(e);
  return old ? { text: old, tone: e.primaryState === 'PRIMARY_SOURCE_READ' ? 'green' : 'amber' } : null;
}
export function taxonomyText(e: EvX): string | null { return e.taxonomy ? TAXONOMY_LABEL[e.taxonomy] || null : null; }
const SEVERITY_WORD: Record<GuValidationIssue['severity'], string> = { INVALID: 'Invalid', REVIEW: 'Check', INFO: 'Note' };
/** 'Invalid: quarterly actual compared with an annual guide'. Empty when every check passed. */
export function validationLines(e: EvX): Array<{ text: string; severity: GuValidationIssue['severity'] }> {
  return (Array.isArray(e.validationIssues) ? e.validationIssues : []).filter((v) => v && v.text).map((v) => ({ text: `${SEVERITY_WORD[v.severity] || 'Note'}: ${String(v.text).trim()}`, severity: v.severity }));
}
const BASIS_WORD: Record<string, string> = { GAAP: 'GAAP', NON_GAAP: 'adjusted', ORGANIC: 'organic', REPORTED: 'reported', UNSTATED: 'basis not stated' };
/** Measures from the same release that did not move up (e.g. the GAAP line next to an adjusted raise). Never counted as a raise. */
export function otherChangeLines(e: EvX): string[] {
  return (Array.isArray(e.otherChanges) ? e.otherChanges : []).filter((c) => c && c.after).map((c) => {
    const b = fmtBeforeAfter(c);
    const basis = c.after.basis && c.after.basis !== 'UNSTATED' ? ` (${BASIS_WORD[c.after.basis] || c.after.basis})` : '';
    const dir = c.direction === 'DOWN' ? 'lowered' : c.direction === 'FLAT' ? 'unchanged' : c.direction === 'UP' ? 'raised' : 'change not established';
    return `${METRIC_LABEL[c.after.metric] || c.after.metric} ${c.after.period}${basis}: ${b.before} → ${b.after}${b.delta ? ` (${b.delta})` : ''}, ${dir}`;
  });
}
export const HEADLINE_BASIS_WORD: Record<string, string> = { ADJUSTED: 'Headline uses adjusted figures', GAAP: 'Headline uses GAAP figures', UNSTATED: 'Headline basis not stated' };

export interface AiCheck { label: string; tone: 'green' | 'amber' | 'red'; quote: string | null; url: string | null; detail: string | null }
/** The AI verifier tag on an event or review row. Confirmed shows '✓ AI-checked against filing' with the quote; awaiting and contradicted say so plainly. */
export function aiCheckOf(x: object | null | undefined): AiCheck | null {
  const a = (x as { aiVerification?: Record<string, unknown> } | null)?.aiVerification;
  if (!a || typeof a !== 'object') return null;
  const st = String(a.status || '');
  const quote = typeof a.quote === 'string' && a.quote.trim() ? a.quote.trim() : null;
  const url = typeof a.documentUrl === 'string' && a.documentUrl ? a.documentUrl : null;
  const vals = (Array.isArray(a.newValues) ? a.newValues : Array.isArray(a.values) ? a.values : []).filter((n) => typeof n === 'number');
  const old = (Array.isArray(a.oldValues) ? a.oldValues : []).filter((n) => typeof n === 'number');
  const bits = [vals.length ? `new ${vals.join(' to ')}` : null, old.length ? `old ${old.join(' to ')}` : null, typeof a.period === 'string' && a.period ? `period ${a.period}` : null, typeof a.basis === 'string' && a.basis ? `basis ${a.basis.toLowerCase()}` : null].filter(Boolean);
  const reason = typeof a.reasonText === 'string' && a.reasonText.trim() ? a.reasonText.trim() : null;
  if (st === 'AI_CONFIRMED') return { label: '✓ AI-checked against filing', tone: 'green', quote, url, detail: bits.length ? `The document states: ${bits.join(', ')}` : null };
  if (st === 'AI_CONFIRMED_NO_NUMBERS') return { label: 'AI found guidance in the filing — old and new figures still needed', tone: 'amber', quote, url, detail: reason };
  if (st === 'AI_CONTRADICTED') return { label: '✕ AI check: the filing does not support this', tone: 'red', quote, url, detail: reason };
  if (st === 'AWAITING') return { label: 'Awaiting AI check', tone: 'amber', quote: null, url, detail: reason };
  return null;
}

// ── events: header partition, review queue, awaiting / audit lists ─────────────────────────────────────────────
export interface PartitionView { line: string; boxes: Array<{ label: string; n: number; tip: string }>; listsLine: string; listsHold: boolean; byMarket: string | null }
/** Header from the exact pipeline partition (the ten buckets add up to processed). Null for an older payload. */
export function partitionView(p: Partial<GuPipelineCounts> | null | undefined, byMarket?: { IN?: Partial<GuPipelineCounts>; US?: Partial<GuPipelineCounts> } | null): PartitionView | null {
  if (!p || !isNum(p.processed)) return null;
  const full = { processed: 0, verifiedUpgrades: 0, reiterations: 0, mixed: 0, lowered: 0, firstGuidance: 0, invalidOrStale: 0, capitalRaise: 0, awaitingNumbers: 0, unverified: 0, nonGuidance: 0, stale: 0, needsReview: 0, awaitingPrimary: 0, material: 0, expectationPositive: 0, cards: 0, audit: 0, queue: 0, dropped: 0, ...p } as GuPipelineCounts;
  const lists = n0(full.cards) + n0(full.audit) + n0(full.queue) + n0(full.dropped);
  const mk = (m?: Partial<GuPipelineCounts>) => (m && isNum(m.processed) ? `${m.processed} processed, ${n0(m.verifiedUpgrades)} verified upgrades` : null);
  const bm = byMarket ? [mk(byMarket.IN) ? `India ${mk(byMarket.IN)}` : null, mk(byMarket.US) ? `USA ${mk(byMarket.US)}` : null].filter(Boolean).join(' | ') : '';
  return {
    line: pipelineCountsLine(full),
    boxes: [
      { label: 'Processed', n: full.processed, tip: 'Every item whose numbers or company document were read. The buckets below add up to this.' },
      { label: 'Verified upgrades', n: full.verifiedUpgrades, tip: 'Old and new numbers, same measure, same basis, same period, confirmed by the company document.' },
      { label: 'Material', n: n0(full.material), tip: 'Verified upgrades big enough to matter (already inside verified upgrades).' },
      { label: 'Review queue', n: n0(full.queue) + n0(full.dropped), tip: 'Not shown as cards: awaiting numbers, awaiting the company document, needs review, invalid, stale, first guidance, capital raise, or not guidance at all.' },
    ],
    listsLine: `Shown as cards ${n0(full.cards)} + audit list ${n0(full.audit)} + review queue ${n0(full.queue)} + not guidance ${n0(full.dropped)} (also listed in the review queue) = ${lists} of ${full.processed} processed`,
    listsHold: lists === full.processed,
    byMarket: bm || null,
  };
}
export function reviewQueueLine(r: GuReviewItem): string {
  try { return reviewItemLine(r); } catch { return `${r.company || UNKNOWN} ${r.announcement_date || ''} — ${r.reason || UNKNOWN}`; }
}
/** 'Awaiting numbers 40 · Needs review 12 ...' largest first. */
export function reviewStatusCounts(items: ReadonlyArray<Pick<GuReviewItem, 'status'>> | null | undefined): Array<{ status: GuReviewStatus; label: string; n: number }> {
  const c: Partial<Record<GuReviewStatus, number>> = {};
  for (const i of items || []) if (i?.status) c[i.status] = (c[i.status] || 0) + 1;
  return (Object.keys(c) as GuReviewStatus[]).map((k) => ({ status: k, label: REVIEW_STATUS_LABEL[k] || prettyCode(k), n: c[k] || 0 })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}
/** Items waiting for the AI check / removed by it. Uses explicit lists when the route sends them, else the review queue's AI tags. */
export function guVerificationLists<T extends { aiVerification?: unknown }>(d: { reviewQueue?: T[] | null; awaitingVerification?: unknown[] | null; verificationAudit?: unknown[] | null } | null | undefined): { awaiting: Array<T | Record<string, unknown>>; audit: Array<T | Record<string, unknown>> } {
  const q = Array.isArray(d?.reviewQueue) ? d!.reviewQueue! : [];
  const st = (x: T) => String(((x as { aiVerification?: { status?: unknown } }).aiVerification || {}).status || '');
  const awaiting = Array.isArray(d?.awaitingVerification) ? (d!.awaitingVerification as Record<string, unknown>[]) : q.filter((x) => st(x) === 'AWAITING');
  const audit = Array.isArray(d?.verificationAudit) ? (d!.verificationAudit as Record<string, unknown>[]) : q.filter((x) => st(x) === 'AI_CONTRADICTED');
  return { awaiting, audit };
}

// ── coverage: blocked / empty feeds with their retry time ───────────────────────────────────────────────────────
/** 'NSE blocked (HTTP 403) — retrying after 22:40 UTC'. Null when the row did not fail for one of these reasons. */
export function coverageFailureLine(x: { name?: string; reason?: string; failureKind?: string | null; retryAfter?: string | null } | null | undefined): string | null {
  if (!x) return null;
  const name = sourceDisplayName(x.name).replace(/\s*filings?$/i, '') || 'Feed';
  const t = x.retryAfter ? Date.parse(x.retryAfter) : NaN;
  const when = Number.isFinite(t) ? `${new Date(t).toISOString().slice(11, 16)} UTC` : null;
  if (x.failureKind === 'BLOCKED') {
    const code = /\b(403|429)\b/.exec(x.reason || '')?.[1];
    return `${name} blocked${code ? ` (HTTP ${code})` : ''} — ${when ? `retrying after ${when}` : 'retry time not known'}`;
  }
  if (x.failureKind === 'EMPTY_RESPONSE') return `${name} answered with no announcements — treated as a failed read, not as zero events`;
  if (x.failureKind === 'TIMEOUT') return `${name} timed out${when ? ` — retrying after ${when}` : ''}`;
  return null;
}

/** The stage shown on the pipeline strip, capped by the ONE primary-source state: a document that was not read is never past PRIMARY SOURCE. */
export function displayStage(e: Parameters<typeof stageOf>[0] & { primarySourceState?: GuidanceEvent['primarySourceState'] }): GuStage {
  const st = stageOf(e);
  const cap: GuStage | null = e.primarySourceState === 'not_found' ? 'CANDIDATE' : e.primarySourceState === 'found_not_read' || e.primarySourceState === 'read_numbers_not_found' ? 'PRIMARY_SOURCE_FOUND' : null;
  return cap && STAGE_ORDER.indexOf(st) > STAGE_ORDER.indexOf(cap) ? cap : st;
}

/** Record-level reconciliation: the record's own override / latest event, plus the first point's awaiting-verification reason. */
export function recordReconcileLines(x: GuRecX | null | undefined): Array<{ text: string; tone: 'red' | 'amber' | 'grey' }> {
  if (!x) return [];
  const why = Array.isArray(x.points) ? x.points.map((p) => p?.awaitingVerificationReason).find((t) => typeof t === 'string' && t.trim()) : null;
  return eventReconcileLines({ eventOverride: x.eventOverride, latestEvent: x.latestEvent, awaitingVerificationReason: why || null });
}
export const LIST_BUCKET_WORD: Record<string, string> = { ACTIVE: 'Active', REVIEW: 'Needs review', CLAIMS: 'Claim awaiting verification' };
