// zzz841 — colours and plain-English copy for the Multibagger Radar tab.
// Colour carries meaning only (evidence status / thesis status). No fills that
// assume a dark background: tints are transparent mixes of theme variables.

import type { EvidenceStatus, PortfolioTag, RadarBucket, ResearchPriority, ThesisStatus, ChainStatus } from '@/lib/multibagger-radar-types';

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

export const PRIORITY_COLOR: Record<ResearchPriority, string> = { VERY_HIGH: R.green, HIGH: R.cyan, MEDIUM: R.amber, LOW: R.grey };
export const PRIORITY_RANK: Record<ResearchPriority, number> = { VERY_HIGH: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

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
  BOTTLENECK: 'Demand is real and supply is tight. Check why rivals cannot just copy it.',
  SPECIAL_SITUATION: 'A corporate action: spin-off, merger, buyback, open offer and similar.',
  EVENT_DRIVEN: 'A shorter event. It helps for a while, then it fades.',
  TECHNICAL: 'Chart or trading-pattern information. It says when, never why.',
  NOISE: 'Nothing here changes what the company earns. Shown so you can see it was read.',
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
