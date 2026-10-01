// zzz841 — colours and plain-English copy for the Multibagger Radar tab.
// Colour carries meaning only (evidence status / thesis status). No fills that
// assume a dark background: tints are transparent mixes of theme variables.

import { ECONOMIC_EVIDENCE_LABEL, EVENT_EVIDENCE_LABEL } from '@/lib/multibagger-radar-types';
import type {
  EvidenceStatus, PortfolioTag, RadarBucket, ResearchPriority, ThesisStatus, ChainStatus, RadarItem, LinkStatus, CatalystLinkKey, EvidenceRead, DurationRead,
  EventConfirmation, MechanismStatus, EarningsImpactStatus, QuantificationStatus, FalsePositiveReason, CatalystMaturity, EvidenceDelta, IndicatorType, Materiality, CatalystKind,
} from '@/lib/multibagger-radar-types';

export const R = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-bg-4)',
  text: 'var(--mc-text-1)', dim: 'var(--mc-text-2)', faint: 'var(--mc-text-3)',
  green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', cyan: 'var(--mc-cyan)', amber: '#B7791F', violet: '#7C5CD6', grey: 'var(--mc-text-3)',
};
export const tint = (c: string, pct = 12) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

/** Distinct colour AND mark per status: a HYPOTHESIS can never look like a CONFIRMED. */
export const EVIDENCE_META: Record<EvidenceStatus, { color: string; mark: string; dashed: boolean }> = {
  CONFIRMED: { color: R.green, mark: '✓', dashed: false },
  STRONG: { color: R.cyan, mark: '●', dashed: false },
  DEVELOPING: { color: R.amber, mark: '◐', dashed: false },
  HYPOTHESIS: { color: R.violet, mark: '?', dashed: true },
  DISPROVED: { color: R.red, mark: '✕', dashed: false },
};
export const EVIDENCE_ORDER: EvidenceStatus[] = ['CONFIRMED', 'STRONG', 'DEVELOPING', 'HYPOTHESIS', 'DISPROVED'];

export const PRIORITY_COLOR: Record<ResearchPriority, string> = { VERY_HIGH: R.green, HIGH: R.cyan, MEDIUM: R.amber, LOW: R.grey, EXCLUDE: R.grey };
export const PRIORITY_RANK: Record<ResearchPriority, number> = { VERY_HIGH: 4, HIGH: 3, MEDIUM: 2, LOW: 1, EXCLUDE: 0 };

export const THESIS_COLOR: Record<ThesisStatus, string> = {
  INTACT: R.green, STRENGTHENING: R.cyan, EARLY: R.violet, WEAKENING: R.amber, BROKEN: R.red, NO_MATERIAL_CHANGE: R.grey,
};
export const TAG_COLOR: Record<PortfolioTag, string> = {
  CORE: R.text, SATELLITE: R.dim, WATCH: R.dim, THESIS_AT_RISK: R.red, CATALYST_DEVELOPING: R.amber, CATALYST_CONFIRMED: R.green,
};
export const CHAIN_MARK: Record<ChainStatus, { mark: string; word: string; color: string; border: string; opacity: number }> = {
  proven: { mark: '●', word: 'proven', color: R.green, border: 'solid', opacity: 1 },
  assumed: { mark: '○', word: 'assumed', color: R.amber, border: 'dashed', opacity: 1 },
  unknown: { mark: '·', word: 'unknown', color: R.faint, border: 'dotted', opacity: 0.6 },
};

/** One plain line per bucket: what being in it means. */
export const BUCKET_MEANING: Record<RadarBucket, string> = {
  MULTIBAGGER: 'Could change what the business earns for years. Needs the most homework.',
  EARNINGS_INFLECTION: 'Could lift earnings over the next 12 to 24 months.',
  RESULT_NO_INFLECTION: 'A reported result that is flat, mixed, down or not clearly better. Shown so you can see it was read; it is not a turn in earnings.',
  BOTTLENECK: 'Demand is real and supply is tight. Check why rivals cannot just copy it.',
  SPECIAL_SITUATION: 'A corporate action: spin-off, merger, buyback, open offer and similar.',
  EVENT_DRIVEN: 'A shorter event. It helps for a while, then it fades.',
  TECHNICAL: 'Chart or trading-pattern information. It says when, never why.',
  NOISE: 'Nothing here changes what the company earns. Shown so you can see it was read.',
  CORPORATE_ACTION: 'Dividend, split, bonus or record date. Logged, but it does not change what the company earns.',
};

export const MONITOR_LABEL: Array<[string, string]> = [
  ['originalCatalystProgressed', 'Did the original catalyst progress?'],
  ['evidenceStrengthened', 'Did the evidence get stronger?'],
  ['earningsConversionBegun', 'Has it started to show up in earnings?'],
  ['opportunityIncreased', 'Did the opportunity get bigger?'],
  ['bottleneckStrengthened', 'Did the bottleneck get tighter?'],
  ['managementExecuted', 'Did management deliver?'],
  ['customerAdoptionIncreased', 'Are more customers adopting it?'],
  ['thesisWeakened', 'Did the thesis get weaker?'],
  ['valuationAheadOfFundamentals', 'Is the valuation ahead of the facts?'],
  ['nextProofPoint', 'What is the next proof point?'],
];

export const box = (extra: Record<string, unknown> = {}) => ({
  border: `1px solid ${R.border}`, borderRadius: 8, background: R.bg, color: R.text, ...extra,
});

// ── zzz845: helpers for the new engine fields. Pure functions so they can be tested without rendering. ──

/** Shown when a section the reader expects has no data. A blank numbered field is never shown. */
export const NOT_YET = 'Not yet established';
export const PRICE_BLOCK_LABEL = 'Price response (not evidence)';

/** Text present and not just whitespace. */
export const has = (s: string | null | undefined): s is string => typeof s === 'string' && s.trim().length > 0;
export const orNotYet = (s: string | null | undefined): string => (has(s) ? s.trim() : NOT_YET);

export const LINK_STATUS_META: Record<LinkStatus, { label: string; color: string; mark: string; dashed: boolean }> = {
  PROVEN: { label: 'PROVEN', color: R.green, mark: '✓', dashed: false },
  PARTIALLY_PROVEN: { label: 'PARTIALLY PROVEN', color: R.cyan, mark: '◐', dashed: false },
  ASSUMED: { label: 'ASSUMED', color: R.violet, mark: '?', dashed: true },
  CONTRADICTED: { label: 'CONTRADICTED', color: R.red, mark: '✕', dashed: false },
  NOT_APPLICABLE: { label: 'N/A', color: R.grey, mark: '-', dashed: true },
};
export const LINK_KEY_LABEL: Record<CatalystLinkKey, string> = {
  EVENT: 'Event', DRIVER: 'Driver', BOTTLENECK: 'Bottleneck', COMPANY_ADVANTAGE: 'Company edge', CAPACITY: 'Capacity', VOLUME: 'Volume', REVENUE: 'Revenue',
  MARGIN: 'Margin', EBITDA: 'EBITDA', FCF: 'Free cash flow', EARNINGS: 'Earnings', EXPECTATIONS: 'Expectations', VALUATION: 'Valuation',
};

/** Three separate badges, never one "Confirmed" badge. Colour AND wording differ so none can pass for another. */
export const EVENT_CONF_META: Record<EventConfirmation, { label: string; color: string; dashed: boolean }> = {
  CONFIRMED: { label: 'Confirmed by a filing or the company', color: R.green, dashed: false },
  REPORTED: { label: 'Reported, not yet confirmed', color: R.amber, dashed: true },
  REPORTED_RESULT: { label: 'Already reported earnings result (secondary-reported, filing not read)', color: R.cyan, dashed: true },
  PLANNED: { label: 'Planned, not yet done', color: R.violet, dashed: true },
  DISPROVED: { label: 'Disproved', color: R.red, dashed: false },
  NOT_APPLICABLE: { label: 'Not applicable', color: R.grey, dashed: true },
};
export const MECHANISM_META: Record<MechanismStatus, { label: string; color: string; dashed: boolean }> = {
  STATED: { label: 'Stated by a source', color: R.green, dashed: false },
  PARTIALLY_STATED: { label: 'Partly stated', color: R.cyan, dashed: false },
  ASSUMED: { label: 'Assumed (our reasoning)', color: R.violet, dashed: true },
  NOT_ESTABLISHED: { label: 'Not established', color: R.grey, dashed: true },
  CONTRADICTED: { label: 'Contradicted', color: R.red, dashed: false },
};
export const EARNINGS_IMPACT_META: Record<EarningsImpactStatus, { label: string; color: string; dashed: boolean }> = {
  CONFIRMED: { label: 'Shown in reported numbers', color: R.green, dashed: false },
  PARTIALLY_PROVEN: { label: 'Partly shown in numbers', color: R.cyan, dashed: false },
  UNPROVEN: { label: 'Not yet in the numbers', color: R.amber, dashed: true },
  REPORTED_RESULT: { label: 'Reported - this is the earnings result', color: R.cyan, dashed: false },
  NOT_ESTABLISHED: { label: 'Not established', color: R.grey, dashed: true },
  CONTRADICTED: { label: 'Contradicted', color: R.red, dashed: false },
};
export interface StatusBadge { key: 'event' | 'mechanism' | 'earnings'; heading: string; label: string; color: string; dashed: boolean }
/** The three badges, in a fixed order. A missing status is shown as unknown, never as confirmed. */
export function statusBadges(i: Pick<RadarItem, 'eventConfirmation' | 'mechanismStatus' | 'earningsImpactStatus'>): StatusBadge[] {
  const unknown = { label: NOT_YET, color: R.grey, dashed: true };
  const e = i.eventConfirmation ? EVENT_CONF_META[i.eventConfirmation] : unknown;
  const m = i.mechanismStatus ? MECHANISM_META[i.mechanismStatus] : unknown;
  const x = i.earningsImpactStatus ? EARNINGS_IMPACT_META[i.earningsImpactStatus] : unknown;
  return [
    { key: 'event', heading: 'Event', ...e },
    { key: 'mechanism', heading: 'Mechanism', ...m },
    { key: 'earnings', heading: 'Earnings impact', ...x },
  ];
}

export const TRANSMISSION_LABEL: Record<string, string> = {
  DIRECT: 'Direct', NEAR_DIRECT: 'Near-direct', INDIRECT: 'Indirect', NARRATIVE_ONLY: 'Narrative only', NOT_ESTABLISHED: 'Not established', NONE: 'None', NOT_APPLICABLE: 'Not applicable',
};
export const QUANT_LABEL: Record<QuantificationStatus, string> = {
  QUANTIFIED: 'Quantified', PARTIALLY_QUANTIFIED: 'Partly quantified', NOT_QUANTIFIED: 'Not quantified', NO_FINANCIAL_LINK: 'No financial link to quantify',
};

/** 'N sources · M independent · syndicated copies removed'. Never claims that sources "agree". */
export function sourcesLine(e: Pick<EvidenceRead, 'independentSources' | 'sourceCount' | 'duplicatesRemoved' | 'sourceQuality' | 'sourceDiversity'>): string {
  const indep = Math.max(0, e.independentSources || 0);
  const total = Math.max(indep, e.sourceCount ?? indep);
  const n = `${total} ${total === 1 ? 'source' : 'sources'}`;
  const dup = (e.duplicatesRemoved ?? 0) > 0 ? `${e.duplicatesRemoved} syndicated ${e.duplicatesRemoved === 1 ? 'copy' : 'copies'} removed` : 'no syndicated copies found';
  const parts = [n, `${indep} independent`, dup];
  if (e.sourceQuality && e.sourceQuality !== 'UNKNOWN') parts.push(`best source quality ${e.sourceQuality.toLowerCase()}`);
  if (e.sourceDiversity && e.sourceDiversity.length) parts.push(`types: ${e.sourceDiversity.map((d) => d.toLowerCase().replace(/_/g, ' ')).join(', ')}`);
  return parts.join(' · ');
}

const SRC_WORD: Record<string, string> = {
  'company-stated': 'company stated', 'contract-stated': 'contract stated', 'filing-stated': 'filing stated', 'project-timeline': 'project timeline',
  'historical-inference': 'historical inference', 'structural-inference': 'structural inference', unknown: 'unknown',
};
/** Duration with its source and confidence. Inferred is always said out loud. 'NOT ESTABLISHED' when there is no evidence. */
export function durationLine(d: DurationRead): string {
  if (d.code === null || d.code === undefined) return 'NOT ESTABLISHED';
  const parts = [has(d.label) ? d.label : 'NOT ESTABLISHED'];
  if (d.inferred) parts.push('inferred');
  if (d.duration_source && d.duration_source !== 'unknown') parts.push(`source: ${SRC_WORD[d.duration_source] || d.duration_source}`);
  if (d.durationConfidence && d.durationConfidence !== 'UNKNOWN') parts.push(`confidence: ${d.durationConfidence.toLowerCase()}`);
  if (d.halfLife) parts.push(`half-life: ${d.halfLife.toLowerCase()}`);
  if (d.basis === 'type' && !d.inferred) parts.push('by event type only');
  let out = parts.join(' · ');
  if (has(d.evidence)) out += `. ${d.evidence.trim()}`;
  return out;
}

export const MATURITY_LABEL: Record<CatalystMaturity, string> = {
  DISCOVERY: 'Reported', VALIDATED: 'Reported, not yet confirmed', DEVELOPING: 'Developing', FINANCIALLY_VISIBLE: 'Financially visible', CONFIRMED: 'Confirmed',
  ACCELERATING: 'Accelerating', MATURE: 'Mature', BROKEN: 'Broken',
};
export const DELTA_LABEL: Record<EvidenceDelta, string> = {
  NEW_EVIDENCE: 'New evidence', STRENGTHENED: 'Strengthened', UNCHANGED: 'Unchanged', WEAKENED: 'Weakened', CONTRADICTED: 'Contradicted', RESOLVED: 'Resolved',
  FIRST_FINANCIAL_CONFIRMATION: 'First financial confirmation', FIRST_COMMERCIAL_CONFIRMATION: 'First commercial confirmation', DEVELOPING: 'Developing',
};
export const INDICATOR_LABEL: Record<IndicatorType, string> = { LEADING: 'Leading indicator', INTERMEDIATE: 'Intermediate indicator', LAGGING: 'Lagging indicator' };
export const MATERIALITY_LABEL: Record<Materiality, string> = { VERY_HIGH: 'Very high', HIGH: 'High', MODERATE: 'Moderate', LOW: 'Low', UNKNOWN: 'Not established' };

/**
 * 'Stage 3 of 7 (Confirmed by company or filing)'. A position on a ladder, not a quality rating. Null when not supplied.
 * The engine's honest stage (stageNumber / stageLabel) wins; older items fall back to the legacy maturity wording, which never says 'Validated'.
 */
export function progressionText(i: Pick<RadarItem, 'catalystMaturity' | 'catalystProgression'> & Partial<Pick<RadarItem, 'stageNumber' | 'stageLabel'>>): string | null {
  if (typeof i.stageNumber === 'number' && Number.isFinite(i.stageNumber)) {
    const n = Math.min(7, Math.max(0, Math.round(i.stageNumber)));
    return has(i.stageLabel) ? `Stage ${n} of 7 (${i.stageLabel})` : `Stage ${n} of 7`;
  }
  const p = i.catalystProgression;
  const stage = typeof p === 'number' && Number.isFinite(p) ? `Stage ${Math.min(7, Math.max(0, Math.round(p)))} of 7` : null;
  const m = i.catalystMaturity ? MATURITY_LABEL[i.catalystMaturity] : null;
  if (stage && m) return `${stage} (${m})`;
  return stage || m;
}

export const FALSE_POSITIVE_LABEL: Record<FalsePositiveReason, string> = {
  PRICE_ONLY: 'price only', CORPORATE_ACTION_ONLY: 'corporate action only', NARRATIVE_ONLY: 'narrative only', INSUFFICIENT_EVIDENCE: 'not enough evidence',
  WRONG_CLASSIFICATION: 'wrong classification', NO_EARNINGS_TRANSMISSION: 'no earnings link', DURATION_UNSUPPORTED: 'duration not supported', IMMATERIAL: 'too small to matter',
  DUPLICATED_SOURCE: 'duplicate source', THESIS_CONTRADICTED: 'thesis contradicted',
};

/** Buckets shown first and in full. */
export const PRIMARY_BUCKETS: RadarBucket[] = ['MULTIBAGGER', 'EARNINGS_INFLECTION', 'BOTTLENECK'];
/** Buckets that are collapsed by default. */
export const QUARANTINE_BUCKETS: RadarBucket[] = ['EVENT_DRIVEN', 'CORPORATE_ACTION', 'TECHNICAL', 'NOISE'];
export const QUARANTINE_HEADER = 'The engine read these and correctly found no earnings link';
export const isQuarantined = (b: RadarBucket): boolean => QUARANTINE_BUCKETS.includes(b);
/** Items shown as one line with no detail panel. */
export const isOneLine = (i: Pick<RadarItem, 'bucket' | 'priority'>): boolean => i.bucket === 'CORPORATE_ACTION' || i.bucket === 'NOISE' || i.priority === 'EXCLUDE';

export function oneLineRow(i: Pick<RadarItem, 'ticker' | 'company' | 'event' | 'falsePositiveReason' | 'kind'>): { who: string; what: string; tag: string | null; text: string } {
  const who = [i.ticker || 'No ticker', i.company].filter(has).join(' - ');
  const ev = has(i.event) ? i.event.trim().replace(/\s+/g, ' ') : NOT_YET;
  const what = ev.length > 110 ? `${ev.slice(0, 107)}...` : ev;
  const tag = i.falsePositiveReason ? FALSE_POSITIVE_LABEL[i.falsePositiveReason] : null;
  return { who, what, tag, text: `${who} - ${what}${tag ? ` [${tag}]` : ''}` };
}

export type SectionKey =
  | 'catalyst' | 'whyNow' | 'mechanism' | 'chain' | 'evidence' | 'scope' | 'proven' | 'earnings' | 'duration' | 'maturity' | 'materiality'
  | 'nextProof' | 'breaks' | 'expectations' | 'valuation' | 'price' | 'priority' | 'sources' | 'portfolio';
/** Core sections always show (with 'Not yet established'). The rest show only when they hold something. */
export const CORE_SECTIONS: SectionKey[] = ['catalyst', 'whyNow', 'evidence', 'earnings', 'duration', 'nextProof', 'priority', 'portfolio'];

/** Which sections of the card have data. The card renders exactly these: no blank numbered fields. */
export function populatedSections(i: RadarItem, held = false): SectionKey[] {
  const out: SectionKey[] = [];
  const add = (k: SectionKey, on: boolean) => { if (on || CORE_SECTIONS.includes(k)) out.push(k); };
  const assessed = (s: string | null | undefined) => has(s) && !/^not (assessed|established)/i.test(s.trim());
  add('catalyst', has(i.event));
  add('whyNow', has(i.whyItMatters));
  add('mechanism', has(i.mechanism) || has(i.oneSentenceMechanism));
  add('chain', (i.catalystChain || []).some((c) => c.status !== 'NOT_APPLICABLE') || (i.chain || []).length > 0);
  add('evidence', true);
  add('scope', !!i.evidenceScope && (i.evidenceScope.confirmed.length + i.evidenceScope.notConfirmed.length) > 0);
  add('proven', !!i.weakestUnprovenLink || (i.provenThrough ?? -1) >= 0 || !!i.confirmationLabel);
  add('earnings', true);
  add('duration', true);
  add('maturity', !!progressionText(i) || !!i.evidenceDelta || !!i.indicator?.type);
  add('materiality', !!i.catalystMateriality && i.catalystMateriality !== 'UNKNOWN');
  add('nextProof', has(i.proof?.what));
  add('breaks', (i.breakConditions || []).some(has));
  add('expectations', assessed(i.expectations?.note) && i.expectations.state !== 'NOT_ASSESSED');
  add('valuation', assessed(i.valuationContext));
  add('price', !!i.priceResponse && has(i.priceResponse.text));
  add('priority', true);
  add('sources', (i.evidence?.independentSources ?? 0) > 0 || (i.evidence?.sourceCount ?? 0) > 0);
  add('portfolio', held || (i.drivers || []).length > 0);
  return out;
}

/** Plain-language wording the radar must never show. Returns the offending matches (empty = clean). */
export function forbiddenWording(text: string): string[] {
  const rules: Array<[string, RegExp]> = [
    ['buy/sell', /\b(BUY|SELL)\b/], ['score', /\bscores?\b/i], ['x/100', /\b\d{1,3}\s*\/\s*100\b/],
    ['price target', /target price|price target|fair value/i], ['sources agree', /independent sources? agree/i], ['bad literal', /undefined|NaN|\bnull\b/],
  ];
  return rules.filter(([, re]) => re.test(text)).map(([n]) => n);
}

/** Small legend of catalyst kinds shown in the tab. */
export const KIND_LEGEND: Array<{ group: string; kinds: CatalystKind[] }> = [
  { group: 'Structural', kinds: ['OPERATING_INFLECTION', 'DEMAND_EXPLOSION', 'BOTTLENECK', 'CAPACITY_INFLECTION', 'CUSTOMER_QUALIFICATION', 'NEW_PRODUCT_MARKET'] },
  { group: 'Special situation', kinds: ['SPIN_DEMERGER', 'MERGER', 'ACQUISITION', 'BUYBACK', 'TENDER_OFFER'] },
  { group: 'Event', kinds: ['CONTRACT_ORDER', 'REGULATORY_DECISION', 'FINANCING', 'MANAGEMENT_CHANGE'] },
  { group: 'Low signal', kinds: ['CORPORATE_ACTION', 'PRICE_MOVE', 'ANALYST_CHANGE', 'MEDIA_NARRATIVE'] },
];

/** Event evidence and economic evidence as two separate lines. A confirmed event never implies an established earnings link. */
export function evidenceLines(i: Pick<RadarItem, 'evidence' | 'eventEvidence' | 'economicEvidence' | 'dealFacts'>): { event: string; economic: string } {
  const event = i.eventEvidence ? EVENT_EVIDENCE_LABEL[i.eventEvidence] : NOT_YET;
  const economic = i.economicEvidence ? ECONOMIC_EVIDENCE_LABEL[i.economicEvidence] : NOT_YET;
  return { event, economic };
}

/** Collapses the chain links with nothing to say into one line, so no empty rows are printed. */
export function collapseChain<T extends { status: string }>(links: T[], label: (l: T) => string): { shown: T[]; notApplicable: string | null } {
  const shown = links.filter((l) => l.status !== 'NOT_APPLICABLE');
  const na = links.filter((l) => l.status === 'NOT_APPLICABLE').map(label);
  return { shown, notApplicable: na.length ? `Not applicable: ${na.join(', ')}` : null };
}
