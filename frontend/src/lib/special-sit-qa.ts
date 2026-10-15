// zzz852 E - machine-readable QA for the radar feed. Counts and exclusion flags only: nothing is deleted, raw lists stay as they are.
// A held-back record keeps all its data and is tagged {excluded_from_equity_radar:true, exclusion_reason, entity_type}.

import type { FeedHoldBackReason, RadarFeedEvent, RadarFeedHints } from './multibagger-radar-feed-types';

export type ExclusionReason = 'FUND_REPURCHASE' | 'UNLISTED' | 'REGULATOR' | 'COURT' | 'NON_EQUITY_SECURITY' | 'DUPLICATE' | 'INSUFFICIENT_ENTITY_RESOLUTION' | 'NO_COMPANY_MECHANISM'
  // zzz854: issuer-tender hold-backs
  | 'PARTNERSHIP_UNITS' | 'DEBT_SECURITY' | 'ROUTINE_TENDER' | 'TERMS_NOT_READ' | 'AWAITING_VERIFICATION' | 'AI_CONTRADICTED'
  // zzz1057
  | 'VERIFICATION_EXPIRED';

export interface QaInput { id?: string; company?: string; title?: string; eventType?: string; primarySource?: boolean; independentSources?: number; evidenceStatus?: string }
export type QaRadarInput = QaInput & RadarFeedHints;

export interface QaExclusion { id: string; name: string; title: string; excluded_from_equity_radar: true; exclusion_reason: ExclusionReason; entity_type: string }

export interface RadarQa {
  totals: { raw: number; normalised: number; radar: number; held_back: number; excluded: number };
  /** zzz854: held back per reason (sums to totals.held_back) */
  held_back_by_reason?: Partial<Record<FeedHoldBackReason, number>>;
  /** zzz854: invariant violations among the shown items (empty = clean) */
  invariants?: QaInvariantReport;
  entity_resolution: { resolved: number; resolved_multiple: number; unresolved: number; unlisted: number; funds: number; regulators_legal: number; not_applicable_other: number };
  evidence: { primary: number; secondary: number; hypothesis: number; disproved: number };
  classification: Record<string, number>;
  exclusions: QaExclusion[];
  exclusion_counts: Partial<Record<ExclusionReason, number>>;
  /** left to the radar engine / route to fill (economic linkage counts) */
  economic?: Record<string, unknown>;
}

const entType = (i: QaRadarInput): string => i.entity?.entityType || 'UNKNOWN';

/** First matching exclusion reason for one radar record, or null when it stays in the equity radar. */
const HOLDBACK_TO_EXCLUSION: Record<FeedHoldBackReason, ExclusionReason> = {
  FUND_REPURCHASE_OFFER: 'FUND_REPURCHASE', PARTNERSHIP_UNIT_REPURCHASE: 'PARTNERSHIP_UNITS', DEBT_TENDER: 'DEBT_SECURITY',
  ROUTINE_ISSUER_TENDER: 'ROUTINE_TENDER', ISSUER_TENDER_TERMS_NOT_READ: 'TERMS_NOT_READ',
  EXCLUDED_FROM_EQUITY_RADAR: 'NO_COMPANY_MECHANISM', AWAITING_VERIFICATION: 'AWAITING_VERIFICATION', AI_CONTRADICTED: 'AI_CONTRADICTED',
  COURT_CASE_REPORT: 'COURT', VERIFICATION_EXPIRED: 'VERIFICATION_EXPIRED',
};
export function exclusionReasonFor(i: QaRadarInput): ExclusionReason | null {
  if (i.feedQuarantineReason && i.feedQuarantineReason !== 'FUND_REPURCHASE_OFFER' && HOLDBACK_TO_EXCLUSION[i.feedQuarantineReason]) return HOLDBACK_TO_EXCLUSION[i.feedQuarantineReason];
  if (i.isFundRepurchaseOffer || i.feedQuarantineReason === 'FUND_REPURCHASE_OFFER' || i.entity?.entityType === 'FUND') return 'FUND_REPURCHASE';
  const t = i.entity?.entityType;
  if (t === 'REGULATOR') return 'REGULATOR';
  if (t === 'COURT') return 'COURT';
  if (i.entity?.state === 'UNLISTED') return 'UNLISTED';
  if (t === 'VEHICLE') return 'NON_EQUITY_SECURITY';
  if (i.isRegistration) return 'NON_EQUITY_SECURITY';
  if (i.isPriceArticle || i.isPreview || i.isAnalystTarget || i.isOpinion || i.isNonCorporate) return 'NO_COMPANY_MECHANISM';
  if (i.entity && i.entity.state === 'UNRESOLVED' && (!i.company || /^(?:not identified|unnamed company)$/i.test(i.company))) return 'INSUFFICIENT_ENTITY_RESOLUTION';
  return null;
}

export function buildRadarQa(args: {
  rawEvents: ReadonlyArray<RadarFeedEvent>;
  normalizedEvents: ReadonlyArray<RadarFeedEvent>;
  radarInputs: ReadonlyArray<QaRadarInput>;
  heldBack?: ReadonlyArray<QaRadarInput>;
}): RadarQa {
  const held = args.heldBack || [];
  const all = [...args.radarInputs, ...held];
  const exclusions: QaExclusion[] = [];
  const ex = new Set<string>();
  const push = (id: string, name: string, title: string, reason: ExclusionReason, entity_type: string) => {
    const k = `${id}|${reason}`;
    if (ex.has(k)) return;
    ex.add(k);
    exclusions.push({ id, name, title, excluded_from_equity_radar: true, exclusion_reason: reason, entity_type });
  };
  for (const i of all) { const r = exclusionReasonFor(i); if (r) push(i.id || '', i.company || '', i.title || '', r, entType(i)); }
  for (const i of held) if (!exclusions.some((e) => e.id === (i.id || ''))) push(i.id || '', i.company || '', i.title || '', 'NO_COMPANY_MECHANISM', entType(i));
  // Duplicates: raw events that normalisation merged into another event (still in the raw list).
  const kept = new Set(args.normalizedEvents.map((e) => e.event_id));
  const seenRaw = new Set<string>();
  for (const e of args.rawEvents) {
    if (!e || !e.event_id) continue;
    if (kept.has(e.event_id) && !seenRaw.has(e.event_id)) { seenRaw.add(e.event_id); continue; }
    push(e.event_id, e.target_name || '', e.primary_filing?.title || '', 'DUPLICATE', 'UNKNOWN');
  }

  const entity_resolution = { resolved: 0, resolved_multiple: 0, unresolved: 0, unlisted: 0, funds: 0, regulators_legal: 0, not_applicable_other: 0 };
  const evidence = { primary: 0, secondary: 0, hypothesis: 0, disproved: 0 };
  const classification: Record<string, number> = {};
  for (const i of all) {
    const e = i.entity;
    if (e) {
      if (e.state === 'RESOLVED') entity_resolution.resolved += 1;
      else if (e.state === 'RESOLVED_MULTIPLE') entity_resolution.resolved_multiple += 1;
      else if (e.state === 'UNLISTED') entity_resolution.unlisted += 1;
      else if (e.state === 'NOT_APPLICABLE') { if (e.entityType === 'FUND') entity_resolution.funds += 1; else if (e.entityType === 'REGULATOR' || e.entityType === 'COURT') entity_resolution.regulators_legal += 1; else entity_resolution.not_applicable_other += 1; }
      else entity_resolution.unresolved += 1;
    } else entity_resolution.unresolved += 1;
    if (i.evidenceStatus === 'DISPROVED') evidence.disproved += 1;
    else if (i.isPreview || i.isOpinion || i.isAnalystTarget || i.isPriceArticle || i.evidenceStatus === 'HYPOTHESIS') evidence.hypothesis += 1;
    else if (i.primarySource) evidence.primary += 1;
    else evidence.secondary += 1;
    const k = i.eventHeadlineKind || i.eventType || 'UNKNOWN';
    classification[k] = (classification[k] || 0) + 1;
  }
  const exclusion_counts: Partial<Record<ExclusionReason, number>> = {};
  for (const x of exclusions) exclusion_counts[x.exclusion_reason] = (exclusion_counts[x.exclusion_reason] || 0) + 1;
  const held_back_by_reason: Partial<Record<FeedHoldBackReason, number>> = {};
  for (const i of held) if (i.feedQuarantineReason) held_back_by_reason[i.feedQuarantineReason] = (held_back_by_reason[i.feedQuarantineReason] || 0) + 1;
  return {
    totals: { raw: args.rawEvents.length, normalised: args.normalizedEvents.length, radar: args.radarInputs.length, held_back: held.length, excluded: exclusions.length },
    held_back_by_reason,
    invariants: checkShownInvariants(args.radarInputs),
    entity_resolution, evidence, classification, exclusions, exclusion_counts,
  };
}

// ─── zzz854: QA invariants on what is SHOWN ───────────────────────────────────
export type QaInvariantCode =
  | 'CONFIRMED_ON_BARE_FORM_TITLE'   // shown with Confirmed evidence while the only text is the SEC form title
  | 'POOLED_VEHICLE_SHOWN'           // a fund / BDC / LP / non-traded REIT is in the shown list
  | 'TERM_EQUALS_TITLE'              // a financing / terms field just repeats the headline or form title
  | 'COUNTS_DO_NOT_RECONCILE'        // the count model's equations do not hold
  | 'SOURCE_COUNT_INCONSISTENT';     // sourceCount != origins + copies, or independence > items
export interface QaInvariantViolation { code: QaInvariantCode; id: string; name: string; detail: string }
export interface QaInvariantReport { ok: boolean; violations: QaInvariantViolation[]; counts: Partial<Record<QaInvariantCode, number>> }

const POOLED_RE = /\b(fund|bdc|interval|feeder|reit|private credit|lending (?:solutions|corp)|strategic lending|income corp|capital (?:corp|co)\b)/i;
const normTxt = (x: unknown): string => (typeof x === 'string' ? x : '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SEC_TITLE_LIKE_RE = /^\s*(?:SC\s*(?:TO-[TI]|13E-?3|14D-?9)|10-12[BG])(?:\/A)?\s+-\s+/i;

/** An evidence status the engine shows as 'Confirmed'. Accepts the engine's enum or a label. */
export const isConfirmedStatus = (s: unknown): boolean => typeof s === 'string' && /^(?:confirmed|strong|primary[_ ]confirmed)$/i.test(s.trim());

/**
 * (a) Confirmed evidence on a bare form title, (b) pooled vehicles shown, (c) a deal-term / financing field equal to the title,
 * plus source-count consistency. Pass shown items only (held-back items are expected to be pooled / unread).
 */
export function checkShownInvariants(shown: ReadonlyArray<Omit<QaRadarInput, 'dealTerms'> & { evidenceStatus?: string; dealTerms?: { fields?: Record<string, string>; statedConditions?: string[] } | null; financing?: string | null }>): QaInvariantReport {
  const violations: QaInvariantViolation[] = [];
  const v = (code: QaInvariantCode, i: { id?: string; company?: string }, detail: string) => violations.push({ code, id: i.id || '', name: i.company || '', detail });
  for (const i of shown) {
    const title = i.title || '';
    const nt = normTxt(title);
    if (isConfirmedStatus(i.evidenceStatus) && (i.formTitleOnly || i.evidenceCeiling === 'FILING_EXISTS_TERMS_NOT_READ')) v('CONFIRMED_ON_BARE_FORM_TITLE', i, `'${title}' carries no terms but is shown as Confirmed`);
    const ent = i.entity?.entityType;
    if (i.isFundRepurchaseOffer || i.feedQuarantineReason || ent === 'FUND' || i.securityState === 'NON_EQUITY_ENTITY' || (SEC_TITLE_LIKE_RE.test(title) && POOLED_RE.test(i.company || ''))) v('POOLED_VEHICLE_SHOWN', i, `pooled / non-equity vehicle in the shown list: ${i.company || title}`);
    const fields: Array<[string, string]> = [];
    if (i.dealTerms?.fields) for (const [k, val] of Object.entries(i.dealTerms.fields)) fields.push([k, val]);
    for (const c of i.dealTerms?.statedConditions || []) fields.push(['condition', c]);
    if (typeof i.financing === 'string') fields.push(['financing', i.financing]);
    for (const [k, val] of fields) {
      const nv = normTxt(val);
      if (nv && (nv === nt || (nt && nv.includes(nt)) || SEC_TITLE_LIKE_RE.test(val))) v('TERM_EQUALS_TITLE', i, `${k} repeats the title: '${val}'`);
    }
    const so = i.sourceOrigins;
    if (so) {
      const sum = so.independentOrigins + so.syndicatedCopies + so.amendmentCopies + so.partyListings;
      if (sum !== so.sourceCount || so.independentOrigins > so.sourceCount || (i.independentSources != null && i.independentSources > Math.max(so.independentOrigins, 1))) v('SOURCE_COUNT_INCONSISTENT', i, `${so.sourceCount} items vs ${so.independentOrigins} origins + ${so.syndicatedCopies} syndicated + ${so.amendmentCopies} amendments + ${so.partyListings} party listings; independentSources=${i.independentSources}`);
    }
  }
  const counts: Partial<Record<QaInvariantCode, number>> = {};
  for (const x of violations) counts[x.code] = (counts[x.code] || 0) + 1;
  return { ok: violations.length === 0, violations, counts };
}

// ─── zzz854: one count model (header tiers, chips, coverage, radar sections, held back) ──
/**
 * Every visible count derives from ONE filtered set: `shown` (after dedupe and hold-back).
 *
 *   canonical_events = shown + held_back.total + merged_duplicates           (E1)
 *   sum(shown_by_tier)     = shown                                           (E2)
 *   sum(shown_by_category) = shown                                           (E3)
 *   sum(shown_by_coverage) = shown                                           (E4)  bucket 'Other' takes unmapped types
 *   sum(radar_sections) + radar_excluded = shown                             (E5)  only when the radar's sections are passed
 *   sum(held_back.by_reason) = held_back.total                               (E6)
 *
 * Coverage buckets computed by the route over raw items / all canonical events are reported separately as
 * coverage_raw (labelled RAW) with shown-vs-raw per bucket; they are never mixed into the shown equations.
 */
export interface FeedCountModel {
  raw_items: number | null;
  canonical_events: number;
  merged_duplicates: number;
  shown: number;
  held_back: { total: number; by_reason: Partial<Record<FeedHoldBackReason, number>> };
  shown_by_tier: Record<string, number>;
  shown_by_category: Record<string, number>;
  shown_by_coverage: Record<string, number>;
  radar_sections: Record<string, number> | null;
  radar_excluded: number | null;
  coverage_raw: { label: 'RAW (pre-filter)'; buckets: Record<string, number> } | null;
  coverage_shown_vs_raw: Array<{ bucket: string; shown: number; raw: number }>;
  equations: Array<{ id: string; text: string; holds: boolean }>;
  reconciles: boolean;
  mismatches: string[];
}

type CountItem = { eventType?: string; category?: string; feedTier?: string; feedQuarantineReason?: FeedHoldBackReason | null };

/** Default coverage bucket from an event type (generic; the route may inject its own mapper). */
export function defaultCoverageBucket(eventType?: string, category?: string): string {
  const t = (eventType || '').toUpperCase();
  if (/SPIN|DEMERG|FORM10/.test(t)) return 'Spin-offs';
  if (/BUYBACK|REPURCHASE/.test(t)) return 'Buybacks';
  if (/NCLT|IBC|INSOLV|RESOLUTION/.test(t)) return 'NCLT / IBC';
  if (/TENDER|MERGER|ACQUI|OPEN_OFFER|GOING_PRIVATE|TAKEOVER|STAKE|ASSET_SALE/.test(t)) return 'M&A';
  if (/RIGHTS|QIP|PREFERENTIAL|WARRANT|NCD|FCCB|OFS|BONUS|SPLIT|DIVIDEND/.test(t)) return 'Capital actions';
  if (/TURNAROUND/.test(t)) return 'Turnaround';
  if (category === 'MA') return 'M&A';
  if (category === 'SPIN') return 'Spin-offs';
  return 'Other';
}

const sumOf = (r: Record<string, number> | null | undefined): number => Object.values(r || {}).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

export function buildFeedCountModel(args: {
  rawItemCount?: number | null; canonicalEvents: number; mergedDuplicates: number;
  shown: ReadonlyArray<CountItem>; heldBack: ReadonlyArray<CountItem>;
  rawCoverage?: Record<string, number> | null;
  coverageBucketOf?: (eventType: string, category?: string) => string | null;
  radarSections?: Record<string, number> | null; radarExcluded?: number | null;
}): FeedCountModel {
  const shown = args.shown.length;
  const by_reason: Partial<Record<FeedHoldBackReason, number>> = {};
  for (const h of args.heldBack) { const r = (h.feedQuarantineReason || 'FUND_REPURCHASE_OFFER') as FeedHoldBackReason; by_reason[r] = (by_reason[r] || 0) + 1; }
  const tier: Record<string, number> = {}, cat: Record<string, number> = {}, cov: Record<string, number> = {};
  for (const i of args.shown) {
    const t = i.feedTier || 'UNTIERED'; tier[t] = (tier[t] || 0) + 1;
    const c = i.category || 'UNCATEGORISED'; cat[c] = (cat[c] || 0) + 1;
    const b = (args.coverageBucketOf ? args.coverageBucketOf(i.eventType || '', i.category) : null) || defaultCoverageBucket(i.eventType, i.category);
    cov[b] = (cov[b] || 0) + 1;
  }
  const radar = args.radarSections || null;
  const radarExcluded = args.radarExcluded ?? null;
  const eq: FeedCountModel['equations'] = [];
  const held = args.heldBack.length;
  eq.push({ id: 'E1', text: `canonical events ${args.canonicalEvents} = shown ${shown} + held back ${held} + merged duplicates ${args.mergedDuplicates}`, holds: args.canonicalEvents === shown + held + args.mergedDuplicates });
  eq.push({ id: 'E2', text: `tiers ${sumOf(tier)} = shown ${shown}`, holds: sumOf(tier) === shown });
  eq.push({ id: 'E3', text: `category chips ${sumOf(cat)} = shown ${shown}`, holds: sumOf(cat) === shown });
  eq.push({ id: 'E4', text: `coverage buckets ${sumOf(cov)} = shown ${shown}`, holds: sumOf(cov) === shown });
  if (radar) eq.push({ id: 'E5', text: `radar sections ${sumOf(radar)} + radar excluded ${radarExcluded ?? 0} = shown ${shown}`, holds: sumOf(radar) + (radarExcluded ?? 0) === shown });
  eq.push({ id: 'E6', text: `held back by reason ${sumOf(by_reason as Record<string, number>)} = held back ${held}`, holds: sumOf(by_reason as Record<string, number>) === held });
  const rawCov = args.rawCoverage || null;
  const buckets = Array.from(new Set([...Object.keys(cov), ...Object.keys(rawCov || {})]));
  const coverage_shown_vs_raw = rawCov ? buckets.map((b) => ({ bucket: b, shown: cov[b] || 0, raw: rawCov[b] || 0 })) : [];
  const mismatches = eq.filter((e) => !e.holds).map((e) => `${e.id}: ${e.text}`);
  return {
    raw_items: args.rawItemCount ?? null, canonical_events: args.canonicalEvents, merged_duplicates: args.mergedDuplicates, shown,
    held_back: { total: held, by_reason }, shown_by_tier: tier, shown_by_category: cat, shown_by_coverage: cov,
    radar_sections: radar, radar_excluded: radarExcluded,
    coverage_raw: rawCov ? { label: 'RAW (pre-filter)', buckets: { ...rawCov } } : null, coverage_shown_vs_raw,
    equations: eq, reconciles: mismatches.length === 0, mismatches,
  };
}

/** (d) Counts not reconciling, as an invariant report entry. */
export function countInvariant(model: FeedCountModel): QaInvariantReport {
  const violations: QaInvariantViolation[] = model.mismatches.map((m) => ({ code: 'COUNTS_DO_NOT_RECONCILE' as const, id: '', name: '', detail: m }));
  return { ok: violations.length === 0, violations, counts: violations.length ? { COUNTS_DO_NOT_RECONCILE: violations.length } : {} };
}
