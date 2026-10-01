// zzz852 E - machine-readable QA for the radar feed. Counts and exclusion flags only: nothing is deleted, raw lists stay as they are.
// A held-back record keeps all its data and is tagged {excluded_from_equity_radar:true, exclusion_reason, entity_type}.

import type { RadarFeedEvent, RadarFeedHints } from './multibagger-radar-feed-types';

export type ExclusionReason = 'FUND_REPURCHASE' | 'UNLISTED' | 'REGULATOR' | 'COURT' | 'NON_EQUITY_SECURITY' | 'DUPLICATE' | 'INSUFFICIENT_ENTITY_RESOLUTION' | 'NO_COMPANY_MECHANISM';

export interface QaInput { id?: string; company?: string; title?: string; eventType?: string; primarySource?: boolean; independentSources?: number; evidenceStatus?: string }
export type QaRadarInput = QaInput & RadarFeedHints;

export interface QaExclusion { id: string; name: string; title: string; excluded_from_equity_radar: true; exclusion_reason: ExclusionReason; entity_type: string }

export interface RadarQa {
  totals: { raw: number; normalised: number; radar: number; held_back: number; excluded: number };
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
export function exclusionReasonFor(i: QaRadarInput): ExclusionReason | null {
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
  return {
    totals: { raw: args.rawEvents.length, normalised: args.normalizedEvents.length, radar: args.radarInputs.length, held_back: held.length, excluded: exclusions.length },
    entity_resolution, evidence, classification, exclusions, exclusion_counts,
  };
}
