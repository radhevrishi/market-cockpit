// ═══════════════════════════════════════════════════════════════════════════
// AI DAILY GAINERS — THE DOMAIN MODEL.                    (zzz706, Phase 1)
//
// From the owner's specification. Phase 1 only, and deliberately: no model
// call happens anywhere in this file. The spec is explicit that the event
// model, the source hierarchy, the deduplication and the scoring have to be
// RIGHT before any AI is layered on top, because an event model that is wrong
// is expensive to unwind once a language model has been trained to fill it.
//
// THE PRODUCT PRINCIPLE THIS ENCODES, in the spec's own words: optimise
// "INFORMATION DENSITY PER MINUTE OF USER ATTENTION". Five hundred gainers
// are not five hundred summaries. The job is to say: I scanned 500, these 37
// had credible catalysts, these 11 could matter economically, these 5 deserve
// your attention, here is the evidence, and here is what would prove it wrong.
//
// THREE RULES THAT ARE STRUCTURAL, NOT STYLISTIC:
//
//   1. WHAT HAPPENED IS SEPARATE FROM WHAT IT MIGHT MEAN. `claims` are things
//      a document states. `assessment` is inference. They never merge, and a
//      claim can never be promoted to a fact by being repeated.
//   2. A TIER-3 SOURCE CANNOT PRODUCE A HIGH SCORE. Social media and forums
//      can raise an alert. They cannot, alone, make something a research
//      candidate — `evidencePoints` returns zero for them.
//   3. PRICE MOMENTUM IS NOT RANKED. A +20% move does not outrank a +5% move.
//      The spec says this twice and it is the easiest principle to lose, so
//      the price change is not a scoring input at all; only the MISMATCH
//      between fundamental surprise and price reaction is.
// ═══════════════════════════════════════════════════════════════════════════

import { classifyCanonicalEventType, validateCanonicalEvent, type CanonicalEventType } from './us-event-taxonomy';
import { stageFromText, reconcileValues, type EventValue, type ValueStatus } from './structured-facts';

export type Market = 'IN' | 'US';

// ── The fixed taxonomy. A model may not invent a category. ────────────────
export const OPERATING_CATALYSTS = [
  'revenue_guidance_increase', 'margin_expansion', 'new_customer',
  'product_qualification', 'capacity_expansion', 'utilization_increase',
  'order_win', 'backlog_increase', 'export_approval', 'new_geography',
  'pricing_increase', 'cost_reduction', 'regulatory_approval', 'new_product',
  'production_ramp', 'customer_ramp',
  // zzz721 — a quarterly result is its OWN catalyst type. Every event this
  // pipeline produced was labelled `revenue_guidance_increase`, which was
  // simply the first value in the list: the page told the owner that Molbio,
  // Milky Mist, Innova, Kingfa, Solar, Rubicon, Manorama and Bhartiya had all
  // raised revenue guidance. None of them had. That is a fabricated fact with
  // a tier-1 filing link under it, which is the worst shape a wrong answer
  // can take on this portal.
  'quarterly_result',
] as const;

export const CORPORATE_CATALYSTS = [
  'acquisition', 'divestiture', 'joint_venture', 'promoter_purchase',
  'buyback', 'fundraising', 'debt_reduction', 'management_change',
  'strategic_investor', 'demerger', 'restructuring',
] as const;

export const NEGATIVE_CATALYSTS = [
  'guidance_reduction', 'order_cancellation', 'customer_loss',
  'margin_compression', 'inventory_buildup', 'receivables_deterioration',
  'auditor_resignation', 'promoter_pledge_increase', 'regulatory_investigation',
  'project_delay', 'capacity_underutilization', 'dilution', 'debt_stress',
  // zzz775: a tax demand, show-cause notice or appellate order. A "GST order
  // received" was read as an order win (SEDEMAC, KSCL).
  'tax_litigation',
] as const;

export type CatalystType =
  | typeof OPERATING_CATALYSTS[number]
  | typeof CORPORATE_CATALYSTS[number]
  | typeof NEGATIVE_CATALYSTS[number]
  | 'none_identified';

export const ALL_CATALYSTS: readonly CatalystType[] = [
  ...OPERATING_CATALYSTS, ...CORPORATE_CATALYSTS, ...NEGATIVE_CATALYSTS, 'none_identified',
];
export function isKnownCatalyst(v: unknown): v is CatalystType {
  return typeof v === 'string' && (ALL_CATALYSTS as readonly string[]).includes(v);
}

// ── Source hierarchy. The tier is a property of WHERE it came from. ───────
export type SourceTier = 1 | 2 | 3;

const TIER1_HOST = /(nseindia|bseindia|sec\.gov|sebi\.gov|rbi\.org)/i;
const TIER1_PATH = /(corporate-filings|announcements|Archives\/edgar|investor-relations|\/ir\/)/i;
const TIER3_HOST = /(x\.com|twitter|reddit|t\.me|telegram|stocktwits|quora|blogspot|wordpress|moneycontrol\.com\/messageboard)/i;
const TIER2_HOST = /(reuters|bloomberg|business-standard|economictimes|livemint|moneycontrol|cnbc|barrons|wsj|ft\.com|seekingalpha|screener\.in)/i;

/**
 * Classify a source by its URL. Unknown hosts are TIER 3, never TIER 2 —
 * an unrecognised domain is a discovery lead, and defaulting it upward is how
 * an anonymous "order win" claim ends up carrying the weight of a filing.
 */
export function sourceTierOf(url: unknown): SourceTier {
  const u = String(url ?? '');
  if (!u) return 3;
  if (TIER3_HOST.test(u)) return 3;
  if (TIER1_HOST.test(u) || TIER1_PATH.test(u)) return 1;
  if (TIER2_HOST.test(u)) return 2;
  return 3;
}

export type InformationStatus =
  | 'new_information' | 'confirmation' | 'acceleration'
  | 'reversal' | 'promotional' | 'administrative';

export type Materiality = 'low' | 'medium' | 'high' | 'unknown';
export type StructuralDuration = 'short' | 'medium' | 'long' | 'unknown';
export type Attribution = 'company_specific' | 'sector' | 'market' | 'macro' | 'technical' | 'unknown';

/** Two documents of one filing (an 8-K body and its EX-99.1) are ONE source: the key is the SEC accession, else the URL without query / fragment. */
export function independentSourceKey(url: string | null | undefined): string {
  const u = String(url || '').trim();
  const acc = /\/data\/\d+\/(\d{18})\//.exec(u) || /(\d{10}-\d{2}-\d{6})/.exec(u);
  if (acc) return `sec:${acc[1].replace(/-/g, '')}`;
  return u.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
}
export function countIndependentSources(sources: Array<{ url: string }>): number {
  return new Set((sources || []).map((s) => independentSourceKey(s.url)).filter(Boolean)).size;
}

export interface EventSource {
  url: string;
  tier: SourceTier;
  published?: string | null;
  /** The sentence that evidences the claim. Never paraphrased. */
  excerpt?: string | null;
}

/** A thing a document STATES. Not a conclusion. */
export interface EventClaim {
  text: string;
  sourceUrl: string;
  /** Whether the document asserts this, or the pipeline inferred it. The
   *  spec's hallucination firewall rests on this one field. */
  kind: 'fact' | 'inference' | 'unknown';
}

export interface GainerEvent {
  eventId: string;
  clusterId: string;
  market: Market;
  ticker: string;
  company?: string | null;
  eventTime: string;
  detectedAt: string;

  catalyst: CatalystType;
  informationStatus: InformationStatus;
  attribution: Attribution;

  priceChangePct: number | null;
  volumeRatio: number | null;
  sectorRelativePct: number | null;

  sources: EventSource[];
  claims: EventClaim[];

  materiality: Materiality;
  structuralDuration: StructuralDuration;

  /** Set only where the owner or a later phase decides it. Never inferred. */
  ownedInPortfolio?: boolean;
  onConvictionBench?: boolean;
}

// ── Deduplication. One announcement is one event, not five. ───────────────
//
// The spec's worked example: an order hits the NSE filing, the BSE filing, the
// company release, a newspaper and a tweet, and the stock moves once. Counting
// five sources as five catalysts is the failure this prevents. Clustering is
// by company + catalyst + a time window, which is deliberately coarse: two
// genuinely different order wins for the same company inside 72 hours will
// merge, and that is the safer error — an under-counted catalyst is a smaller
// mistake than a fabricated pattern of five.
export const CLUSTER_WINDOW_HOURS = 72;

export function clusterKey(market: Market, ticker: string, catalyst: CatalystType, eventTime: string): string {
  const t = Date.parse(eventTime);
  const bucket = Number.isFinite(t)
    ? Math.floor(t / (CLUSTER_WINDOW_HOURS * 3600_000))
    : 0;
  return `${market}:${String(ticker).toUpperCase()}:${catalyst}:${bucket}`;
}

/** Merge events of one company + catalyst that sit within CLUSTER_WINDOW_HOURS of the previous one (a chain), unioning their sources and claims.
 *  zzz835: fixed 72h buckets split two sightings 1 hour apart when a bucket edge fell between them; proximity does not. */
export function clusterEvents(events: GainerEvent[]): GainerEvent[] {
  const groups = new Map<string, GainerEvent[]>();
  for (const e of events) {
    const g = `${e.market}:${String(e.ticker).toUpperCase()}:${e.catalyst}`;
    groups.set(g, [...(groups.get(g) || []), e]);
  }
  const out: GainerEvent[] = [];
  for (const list of Array.from(groups.values())) {
    const sorted = [...list].sort((a, b) => (Date.parse(a.eventTime) || 0) - (Date.parse(b.eventTime) || 0));
    let cur: GainerEvent | null = null; let lastT = NaN;
    for (const e of sorted) {
      const t = Date.parse(e.eventTime);
      if (cur && Number.isFinite(t) && Number.isFinite(lastT) && t - lastT <= CLUSTER_WINDOW_HOURS * 3600_000) {
        const seen = new Set(cur.sources.map((s) => s.url));
        for (const s of e.sources) if (!seen.has(s.url)) { cur.sources.push(s); seen.add(s.url); }
        const seenClaims = new Set(cur.claims.map((c) => `${c.sourceUrl}|${c.text}`));
        for (const c of e.claims) { const id = `${c.sourceUrl}|${c.text}`; if (!seenClaims.has(id)) { cur.claims.push(c); seenClaims.add(id); } }
        lastT = t;
        continue;
      }
      cur = { ...e, clusterId: clusterKey(e.market, e.ticker, e.catalyst, e.eventTime), sources: [...e.sources], claims: [...e.claims] };
      lastT = t;
      out.push(cur);
    }
  }
  return out;
}

// ── zzz835: THE CANONICAL EVENT (what the document says, never what the headline says) ──

export type CanonicalStage = 'reported' | 'proposed' | 'signed' | 'awarded' | 'executed' | 'completed' | 'unknown';
export type CanonicalSourceTier = 'official_filing' | 'official_company_release' | 'press' | 'secondary';
export interface CanonicalEvent {
  event_id: string;
  ticker: string;
  event_type: CanonicalEventType;
  stage: CanonicalStage;
  /** Every value seen - a headline value never overrides the filed one. */
  values: EventValue[];
  value: number | null;
  currency: string | null;
  value_status: ValueStatus;
  source_tier: CanonicalSourceTier;
  filing_date: string | null;
  source_url: string | null;
  source_quote: string;
  confidence: number;
  conflicts: string[];
  validation_errors: string[];
}
/** Build the canonical event. The type comes from deterministic rules FIRST (litigation, then LOI / proposed, then order / trial / acquisition / earnings ...). */
export function buildCanonicalEvent(i: {
  ticker: string; quote: string; tier: CanonicalSourceTier; url?: string | null; filingDate?: string | null; currency?: string | null; values?: EventValue[]; declaredType?: CanonicalEventType | null;
}): CanonicalEvent {
  const det = classifyCanonicalEventType(i.quote);
  const st = stageFromText(i.quote);
  const stage: CanonicalStage = st === 'PROPOSED' ? 'proposed' : st === 'COMPLETED' ? 'completed' : st === 'AWARDED' ? 'awarded' : st === 'SIGNED' ? 'signed' : i.quote ? 'reported' : 'unknown';
  const rec = reconcileValues(i.values || []);
  const errs = i.declaredType && i.declaredType !== det.type ? validateCanonicalEvent({ event_type: i.declaredType, source_quote: i.quote, stage }) : [];
  return {
    event_id: `${String(i.ticker).toUpperCase()}:${det.type}:${(i.filingDate || 'undated')}`, ticker: String(i.ticker).toUpperCase(), event_type: det.type, stage,
    values: rec.values, value: rec.usable ? rec.usable.value : null, currency: i.currency ?? null, value_status: rec.valueStatus, source_tier: i.tier,
    filing_date: i.filingDate ?? null, source_url: i.url ?? null, source_quote: i.quote, confidence: i.tier === 'official_filing' ? 0.9 : i.tier === 'official_company_release' ? 0.75 : i.tier === 'press' ? 0.4 : 0.3,
    conflicts: rec.conflicts, validation_errors: errs,
  };
}

// ── Research priority. Explainable, never one opaque number. ──────────────
export interface ScoreComponent {
  key: string;
  label: string;
  points: number;
  max: number;
  because: string;
}
export interface ResearchPriority {
  score: number;
  components: ScoreComponent[];
  penalties: ScoreComponent[];
  /** The mismatch quadrant from the spec's 2x2. Never a buy signal. */
  quadrant: 'high_information' | 'potentially_overlooked' | 'momentum_speculative' | 'early_unclear';
}

const MATERIALITY_POINTS: Record<Materiality, number> = { high: 20, medium: 12, low: 4, unknown: 6 };
const DURATION_POINTS: Record<StructuralDuration, number> = { long: 15, medium: 9, short: 3, unknown: 5 };
const NOVELTY_POINTS: Record<InformationStatus, number> = {
  new_information: 15, acceleration: 12, reversal: 10,
  confirmation: 5, administrative: 1, promotional: 0,
};

/** The best (lowest) tier present, and the points it earns. Tier 3 alone is
 *  worth nothing — it can raise an alert, never a score. */
export function evidencePoints(sources: EventSource[]): { points: number; best: SourceTier; because: string } {
  const tiers = (sources || []).map((s) => s.tier).filter((t) => t === 1 || t === 2 || t === 3);
  if (!tiers.length) return { points: 0, best: 3, because: 'no source recorded' };
  const best = Math.min(...tiers) as SourceTier;
  const independent = countIndependentSources(sources || []);   // zzz835: filings, not files
  if (best === 1) {
    return { points: independent >= 2 ? 15 : 13, best, because: independent >= 2
      ? 'primary filing, corroborated by a second source' : 'primary filing' };
  }
  if (best === 2) {
    return { points: independent >= 2 ? 9 : 7, best, because: independent >= 2
      ? 'reputable secondary reporting, more than one outlet' : 'reputable secondary reporting' };
  }
  return { points: 0, best, because: 'unverified source only — this can raise an alert, never a research score' };
}

export interface PriorityInput {
  event: GainerEvent;
  /** 0-1: how much of the move the pipeline attributes to the company itself. */
  companySpecificShare?: number | null;
  /** Flags that subtract. Each is a documented risk, not an opinion. */
  risks?: {
    promotionalLanguage?: boolean;
    extremeValuation?: boolean;
    customerConcentration?: boolean;
    governanceFlag?: boolean;
    dilution?: boolean;
    extremePriceExtension?: boolean;
    weakCashConversion?: boolean;
    contradictoryFilings?: boolean;
  };
}

export function researchPriority(input: PriorityInput): ResearchPriority {
  const e = input.event;
  const ev = evidencePoints(e.sources);
  const comps: ScoreComponent[] = [];

  comps.push({ key: 'evidence', label: 'Primary-source evidence', points: ev.points, max: 15, because: ev.because });
  comps.push({
    key: 'novelty', label: 'Genuine new information',
    points: NOVELTY_POINTS[e.informationStatus] ?? 0, max: 15,
    because: e.informationStatus.replace(/_/g, ' '),
  });
  comps.push({
    key: 'materiality', label: 'Earnings materiality',
    points: MATERIALITY_POINTS[e.materiality], max: 20,
    because: e.materiality === 'unknown' ? 'not yet assessed' : `${e.materiality} potential effect on earnings`,
  });
  comps.push({
    key: 'duration', label: 'Structural duration',
    points: DURATION_POINTS[e.structuralDuration], max: 15,
    because: e.structuralDuration === 'unknown' ? 'not yet assessed' : `${e.structuralDuration}-lived`,
  });

  // Catalyst persistence — a cluster seen across more than one document has
  // survived a day of scrutiny; a single sighting has not.
  const nIndep = countIndependentSources(e.sources);
  const persistence = Math.min(10, Math.max(0, (nIndep - 1) * 4));
  comps.push({
    key: 'persistence', label: 'Catalyst persistence', points: persistence, max: 10,
    because: nIndep > 1 ? `${nIndep} independent sources` : 'single sighting',
  });

  // ── PRICE/FUNDAMENTAL MISMATCH. The only place price enters the score,
  //    and it enters as a GAP, never as magnitude. A big move is not better
  //    than a small one; a big move with nothing behind it is worse.
  const surpriseHigh = e.materiality === 'high'
    || e.informationStatus === 'new_information' || e.informationStatus === 'acceleration';
  const move = typeof e.priceChangePct === 'number' ? e.priceChangePct : null;
  const priceHigh = move != null && move >= 10;
  let gap = 5; let gapWhy = 'no clear mismatch';
  let quadrant: ResearchPriority['quadrant'] = 'early_unclear';
  if (surpriseHigh && !priceHigh) {
    gap = 10; gapWhy = 'material news, muted price — the reaction may not yet reflect it';
    quadrant = 'potentially_overlooked';
  } else if (surpriseHigh && priceHigh) {
    gap = 7; gapWhy = 'material news and a large move — high-information event, but less of it is left';
    quadrant = 'high_information';
  } else if (!surpriseHigh && priceHigh) {
    gap = 1; gapWhy = 'large move without a material catalyst — likely technical or speculative';
    quadrant = 'momentum_speculative';
  }
  comps.push({ key: 'gap', label: 'Price / fundamental gap', points: gap, max: 10, because: gapWhy });

  // Attribution: a sector-wide rally is not a company catalyst.
  const share = typeof input.companySpecificShare === 'number' ? input.companySpecificShare : null;
  const attrPts = share == null ? 3 : Math.round(Math.max(0, Math.min(1, share)) * 5);
  comps.push({
    key: 'attribution', label: 'Company-specific', points: attrPts, max: 5,
    because: share == null ? 'attribution not estimated'
      : `${Math.round(share * 100)}% attributed to the company rather than the sector or market`,
  });

  const r = input.risks || {};
  const penalties: ScoreComponent[] = [];
  const pen = (k: string, label: string, pts: number, why: string) => {
    penalties.push({ key: k, label, points: -pts, max: -pts, because: why });
  };
  if (r.promotionalLanguage) pen('promo', 'Promotional language', 5, 'announcement language outruns the disclosed facts');
  if (r.extremeValuation) pen('val', 'Extreme valuation', 3, 'the move may already be priced');
  if (r.customerConcentration) pen('conc', 'Customer concentration', 3, 'one qualification loss ends the thesis');
  if (r.governanceFlag) pen('gov', 'Governance flag', 5, 'a disclosed governance concern');
  if (r.dilution) pen('dil', 'Dilution', 3, 'share count rising');
  if (r.extremePriceExtension) pen('ext', 'Extreme extension', 3, 'far above its own trend');
  if (r.weakCashConversion) pen('cash', 'Weak cash conversion', 4, 'earnings are not converting to cash');
  if (r.contradictoryFilings) pen('contra', 'Contradictory filings', 5, 'two filings disagree');

  const gross = comps.reduce((a, c) => a + c.points, 0);
  const penTotal = penalties.reduce((a, c) => a + c.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(gross + penTotal)));
  return { score, components: comps, penalties, quadrant };
}

/**
 * The funnel the spec describes: hundreds scanned → dozens with events →
 * a handful structural → 5-10 research candidates. Returns the counts so the
 * digest can state them honestly rather than asserting a number.
 */
export interface Funnel { scanned: number; withCatalyst: number; structural: number; queue: number; }

export function buildResearchQueue(
  events: GainerEvent[],
  scoredBy: (e: GainerEvent) => ResearchPriority,
  targetMax = 10,
): { queue: Array<{ event: GainerEvent; priority: ResearchPriority }>; funnel: Funnel } {
  const clustered = clusterEvents(events);
  const withCatalyst = clustered.filter((e) => e.catalyst !== 'none_identified');
  const structural = withCatalyst.filter(
    (e) => e.structuralDuration === 'long' || e.structuralDuration === 'medium',
  );
  const ranked = withCatalyst
    .map((event) => ({ event, priority: scoredBy(event) }))
    // Default sort is RESEARCH PRIORITY, never percentage gain. The spec says
    // so explicitly and it is the single easiest thing to regress.
    .sort((a, b) => b.priority.score - a.priority.score);
  return {
    queue: ranked.slice(0, targetMax),
    funnel: {
      scanned: events.length,
      withCatalyst: withCatalyst.length,
      structural: structural.length,
      queue: Math.min(targetMax, ranked.length),
    },
  };
}
