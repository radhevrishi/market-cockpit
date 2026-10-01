// zzz853 — pure UI helpers for the Guidance Upgrades tab (no React, no I/O). Everything here is a text or grouping rule so it can be tested with plain asserts.
// Rules: never invent a number, Unknown stays "Unknown" (never negative), a missing field renders gracefully (old cached responses), no scores and no trade-call wording.
import type { CoverageCard, GuCacheRow, GuidanceEvent } from '../../lib/guidance-upgrades-types';
import type {
  GuCohort, GuExpirySummary, GuHgGroupRow, GuHgMetricX, GuHighGrowthGroups, GuStateCounts, GuTrust, GuViewCounts,
} from '../../lib/guidance-universe-types';
import type { GuUniverseRecord } from '../../lib/guidance-universe-types';
import type { GuUniverseRecordX } from '../../lib/guidance-universe';
import { hasRealRaise, isReiteration, eventLabelText } from '../../lib/guidance-upgrades-format';

export const UNKNOWN = 'Unknown';

/** A universe record as the page receives it: the older shape plus the additive zzz853 fields, all optional (an older cached answer lacks them). */
export type GuRecX = GuUniverseRecord & Partial<Pick<GuUniverseRecordX,
  'entityKey' | 'verificationState' | 'growthType' | 'basisLabel' | 'growthVsPriorYear' | 'revisionVsPriorGuidance' | 'cohort' | 'periodNormalized' | 'lastVerified' | 'lastVerifiedDaysAgo'
  | 'staleVerification' | 'sourceConflict' | 'reviewReasons' | 'reviewReasonCodes' | 'inReviewQueue' | 'caveats' | 'sources' | 'history' | 'needsReview' | 'claimType' | 'sourceTier' | 'primaryValue' | 'mediaClaim'>>;


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
/** 'X verified · Y partial · Z unverified/derived'. Z = unverified + derived + period-unclear (everything that is not verified or partial). Null when no counts. */
export function stateCountsLine(c: Partial<GuStateCounts> | null | undefined): string | null {
  if (!c || !isNum(c.activeRecords)) return null;
  return `${n0(c.verified)} verified · ${n0(c.partial)} partial · ${n0(c.unverified) + n0(c.derived) + n0(c.periodUnclear)} unverified/derived`;
}
/** Same split from the grouped high-growth counts (claims awaiting = unverified). */
export function groupCountsLine(c: Partial<GuHighGrowthGroups['counts']> | null | undefined): string | null {
  if (!c || !isNum(c.rows)) return null;
  return `${n0(c.verified)} verified · ${n0(c.partial)} partial · ${n0(c.derived) + n0(c.claimsAwaiting)} unverified/derived`;
}
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
};
const REASON_SHORT: Record<string, string> = {
  PERIOD_UNCLEAR: 'Period unclear', PERIOD_UNKNOWN: 'Period not stated', SECONDARY_ONLY: 'Media only', PRIMARY_MISSING: 'Company document not found', SOURCE_CONFLICT: 'Sources disagree',
  EXPIRED: 'Period ended', POTENTIAL_DUPLICATE: 'Possible duplicate', NEEDS_REVIEW: 'Manual check', COMPANY_UNRESOLVED: 'Company not matched', METRIC_LABEL_MISMATCH: 'Metric name mismatch',
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
export type GuView = 'active' | 'review' | 'history';
export const VIEW_ORDER: GuView[] = ['active', 'review', 'history'];
export function viewLabel(v: GuView, vc?: Partial<GuViewCounts> | null): string {
  const base = v === 'active' ? 'Active' : v === 'review' ? 'Needs review' : 'History';
  if (!vc) return base;
  const n = v === 'active' ? vc.default : v === 'review' ? vc.review : isNum(vc.expired) || isNum(vc.superseded) || isNum(vc.withdrawn) ? n0(vc.expired) + n0(vc.superseded) + n0(vc.withdrawn) + n0(vc.excluded) : undefined;
  return isNum(n) ? `${base} (${n})` : base;
}
export const VIEW_HINT: Record<GuView, string> = {
  active: 'Default view. Company matched, period confirmed, nothing flagged.',
  review: 'Active guidance kept out of the default view. The reason is shown on each row.',
  history: 'Guidance that is no longer in force (ended, replaced or withdrawn) and rows left out on purpose.',
};
/** The API value for each view. */
export function viewParam(v: GuView): 'active' | 'review' | 'history' { return v; }
export function viewCountsLine(vc: Partial<GuViewCounts> | null | undefined): string | null {
  if (!vc || !isNum(vc.default)) return null;
  return `${n0(vc.default)} active · ${n0(vc.review)} need review · ${n0(vc.expired)} ended · ${n0(vc.superseded)} replaced · ${n0(vc.withdrawn)} withdrawn · ${n0(vc.excluded)} left out`;
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
interface BasisIn { short?: string | null; display?: string | null; growthType?: string | null; basisLabel?: string | null; revisionVsPriorGuidance?: string | { display?: string | null } | null }
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
    main = `${base || UNKNOWN} stated by company`;
  } else {
    main = `${base || UNKNOWN}${m.basisLabel ? ` · ${m.basisLabel}` : ''}`;
  }
  return { main, detail, revision, line: revision ? `${main} · ${revision}` : main };
}
/** Basis for a whole universe record: growth vs prior-year actual AND the revision vs prior guidance, both when both exist. */
export function recordBasis(r: { growthVsPriorYear?: { display?: string | null; type?: string | null; baseLabel?: string | null } | null; revisionVsPriorGuidance?: { display?: string | null } | null; basisLabel?: string | null; growthType?: string | null; display?: string | null } | null | undefined): BasisText | null {
  if (!r) return null;
  const g = r.growthVsPriorYear;
  const revision = revisionShort(r.revisionVsPriorGuidance?.display);
  if (!g && !revision && !r.growthType) return null;
  if (g?.display) {
    const t = String(g.type || r.growthType || '').toUpperCase();
    const sp = t === 'DERIVED' ? splitDerivedBasis(g.display) : { head: g.display, detail: null };
    const main = sp.head; const detail = sp.detail;
    return { main, detail, revision, line: revision ? `${main} · ${revision}` : main };
  }
  if (r.growthType) return basisText({ short: r.display, growthType: r.growthType, basisLabel: r.basisLabel, revisionVsPriorGuidance: r.revisionVsPriorGuidance });
  return { main: '', detail: null, revision, line: revision || '' };
}

// ── last verified ─────────────────────────────────────────────────────────────────────────────────────────────────
export const STALE_AFTER_DAYS = 60;
/** 'Last verified 12 days ago' / 'Last verified 75 days ago (stale)' / 'Last verified: Unknown'. */
export function lastVerifiedText(r: { lastVerified?: string | null; lastVerifiedDaysAgo?: number | null; staleVerification?: boolean | null } | null | undefined): { text: string; stale: boolean } {
  const d = r?.lastVerifiedDaysAgo;
  if (!isNum(d) || d < 0) return { text: r?.lastVerified ? `Last verified ${String(r.lastVerified).slice(0, 10)}` : `Last verified: ${UNKNOWN}`, stale: !!r?.staleVerification };
  const stale = r?.staleVerification != null ? !!r.staleVerification : d > STALE_AFTER_DAYS;
  const when = d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`;
  return { text: `Last verified ${when}${stale ? ' (stale)' : ''}`, stale };
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
  summary?: { counts?: Partial<GuStateCounts>; reviewReasonCounts?: Record<string, number>; staleVerificationCount?: number; sourceConflictCount?: number; reviewQueueCount?: number } | null;
  invariantViolations?: unknown; liveError?: string | null; servedFrom?: string | null;
} | null | undefined): QualityStrip {
  const s = d?.summary || {};
  return {
    stateLine: stateCountsLine(s.counts), reasonLine: reasonCountsLine(s.reviewReasonCounts),
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
