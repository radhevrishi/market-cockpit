// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENT CATALYST LAYER                                          (zzz780)
//
// A separate dimension from the thesis status and from Research Priority.
// It answers one question per company:
//
//   Is there a business MECHANISM whose economic effect can continue across
//   several future periods, and is there evidence it is still active?
//
// Inputs are evidence the app already holds — never price, never a new model
// call:
//   · the evidence ledger (every period's extracted facts, with source, date
//     and quote) — this IS the multi-quarter memory;
//   · the thesis assessment's quality-filtered mechanism drivers (customers,
//     approvals, mix) for the current period;
//   · an AI Daily Gainers finding (the filing behind a move: category, stated
//     value and the reader's facts — execution period, capacity, customer).
//
// Rules (they are the feature):
//   · OUTPUT IS NOT MECHANISM — revenue / earnings / margin growth never
//     creates a persistent catalyst on its own.
//   · THEME IS CONTEXT — nothing here reads a sector or a theme.
//   · A TARGET IS NOT EVIDENCE — guidance and targets only supply the next
//     milestone and a stated horizon; they never raise confidence.
//   · UNKNOWN STAYS UNKNOWN — no duration is invented ("Duration: Unknown").
//   · ONE FIGURE, ONE ITEM — the same number in a concall, a presentation and
//     a filing is one piece of evidence with three sources.
//   · COMMISSIONED ≠ EARNING — the capex lifecycle is tracked stage by stage.
//   · A MANAGEMENT REMARK NEVER OUTWEIGHS A FILED FIGURE.
//   · NO PRICE, NO RECOMMENDATION — Special Focus allocates research time.
// ═══════════════════════════════════════════════════════════════════════════

import { scaledNumber, periodOrdinal } from '@/lib/thesis/evidence-ledger';
import { VAR_LABEL } from '@/lib/thesis/taxonomy';
import { forwardSentence, volumeContext } from '@/lib/thesis/fact-normalize';
import { factsForFinding } from '@/lib/ai-gainers/catalyst-timeline';
import { catalystIdOf } from '@/lib/ai-gainers/structured-facts';
export { volumeContext };

export type PersistKind = 'CAPACITY_RAMP' | 'ORDER_VISIBILITY' | 'CUSTOMER_RAMP' | 'GEOGRAPHY' | 'MIX_PRICING' | 'PROJECT_PIPELINE';
export type PersistState = 'IDENTIFIED' | 'VALIDATED' | 'RAMPING' | 'SCALING' | 'MATURE' | 'STALLING' | 'WEAKENING' | 'COMPLETED' | 'DISPROVED';
export type PersistConfidence = 'HIGH' | 'MEDIUM' | 'EARLY' | 'TEMPORARY_UNCERTAIN';
export type EvidenceClass = 'HARD' | 'REMARK' | 'FORWARD';

export const KIND_LABEL: Record<PersistKind, string> = {
  CAPACITY_RAMP: 'Capacity ramp',
  ORDER_VISIBILITY: 'Order book / multi-period demand',
  CUSTOMER_RAMP: 'Customer qualification → ramp',
  GEOGRAPHY: 'New geography / exports',
  MIX_PRICING: 'Pricing / mix',
  PROJECT_PIPELINE: 'Tracked potential — enabling step (MoU / JDA / LoI)',
};
export const CONFIDENCE_LABEL: Record<PersistConfidence, string> = {
  HIGH: 'High persistence evidence', MEDIUM: 'Medium persistence evidence',
  EARLY: 'Early / unproven', TEMPORARY_UNCERTAIN: 'Persistence uncertain',
};

export interface PersistItem {
  metric: string;                 // ledger metric / driver key / gainer category
  kind: PersistKind;
  cls: EvidenceClass;
  text: string;                   // what it says, human form
  before: string | null;
  after: string | null;
  numeric: number | null;         // scaled after-value
  numericBefore: number | null;
  period: string | null;
  date: string | null;            // source date (YYYY-MM-DD)
  sources: Array<{ name: string; url: string | null; date: string | null; quote: string | null }>;
  origin: 'ledger' | 'assessment' | 'gainer';
  /** zzz784: for capacity rows — production rate, store network, floor space. */
  capClass?: CapacityClass;
  /** zzz787: the Daily Gainers event this item came from (catalystIdOf) — the cross-view link. */
  eventId?: string;
}

export interface BeforeAfterRow { variable: string; before: string; current: string; direction: '↑' | '↓' | '→' | '?'; source: string; date: string | null }

export interface PersistentCatalyst {
  id: string;                     // `${TICKER}:${KIND}` — stable across quarters and systems
  ticker: string;
  kind: PersistKind;
  label: string;
  mechanism: string;              // the causal chain, in words, from evidence only
  state: PersistState;
  confidence: PersistConfidence;
  runway: { ok: boolean; text: string };
  evidence: PersistItem[];        // hard first, then remarks
  forward: PersistItem[];         // targets / guidance — milestones only
  beforeAfter: BeforeAfterRow[];
  happened: string[];             // what has already happened
  notYet: string[];               // what has NOT happened yet
  nextMilestone: string | null;
  confirmWith: string;
  invalidateIf: string;
  duration: string;               // "Duration: Unknown" unless the company stated one
  firstEvidenceDate: string | null;
  latestEvidenceDate: string | null;
  freshness: 'CURRENT' | 'HISTORICAL';
  periods: string[];
  hardCount: number;
  distinctMetrics: number;
  temporarySignals: string[];
  origins: Array<'portfolio' | 'gainers'>;
  specialFocus: boolean;
  /** zzz784: the highest stage the filed evidence reaches (capacity ladder for
   *  a capacity ramp; the lifecycle state word otherwise). */
  stage: string;
  /** zzz784: the next piece of EVIDENCE, derived from `stage` — never an earlier stage. */
  nextEvidence: string | null;
  /** zzz784: a management target for a LATER stage, labelled as a milestone. */
  managementTarget: string | null;
  /** zzz784: label variant — a store network or floor space is not production capacity. */
  variant?: 'PRODUCTION' | 'NETWORK' | 'FLOOR_SPACE';
  /** zzz784: filed figures vs management remarks behind the catalyst. */
  sourceQuality: string;
  /** zzz784: the card's capex projects that are NOT this capacity (still being
   *  built while this one runs) — named, so the two never read as a contradiction. */
  capexNote?: string | null;
  why: string[];                  // why it is (or is not) Special Focus — every line evidence-backed
  /** What evidence would qualify it — the research to do next. (zzz781) */
  toQualify: string[];
  /** Not Special Focus yet, but one or two pieces of evidence away. */
  nearMiss: boolean;
  /** zzz787: independent evidence PERIODS behind the mechanism figures (distinct
   *  reporting periods, or filings ≥60 days apart). */
  evidencePeriods?: number;
  /** zzz787: what the Special Focus gate reads beyond confidence — demand
   *  (orders / offtake), usage (utilisation / volume / revenue), capacity in
   *  place, commissioned. Commissioning ALONE never makes Special Focus. */
  gate?: { inService: boolean; demand: boolean; usage: boolean; capacityInPlace: boolean; orderCoverage?: boolean };
  /** zzz787: why it qualifies for Special Focus (null = candidate only). */
  sfBasis?: string | null;
  /** zzz787: the underlying Daily Gainers event ids (catalystIdOf) behind this
   *  mechanism — the cross-link, so the same event is never listed twice. */
  eventIds?: string[];
  /** zzz788: unused installed capacity, said as headroom — NEVER runway on its
   *  own. "Capacity headroom: Utilisation 65% — 35 percentage points available
   *  on the current installed-capacity basis." */
  headroom?: string | null;
  /** zzz788: the continuation evidence behind a capacity ramp's runway
   *  (continuing order book, customer ramp, recurring volume growth, contracted
   *  demand, utilisation rising) — null when none is on file. */
  continuation?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ONE MONEY FORMAT, THE CARD'S.                                      (zzz788)
// "INR2,598 crores" in Special Focus beside "₹2,600 Cr" on the card read as
// two different order books. A crore amount is printed "₹2,598 Cr" wherever
// the persistence layer writes it. Only the FORMAT changes: the digits are the
// document's, nothing is rounded, and anything that is not a plain crore
// amount (USD, million, a range) is left exactly as written.
// ═══════════════════════════════════════════════════════════════════════════
export function rupeeCr(s: string | null | undefined): string {
  const t0 = String(s ?? '').trim();
  // A trailing period tag ("in Q1 FY27", "(Q1 FY27)") is not part of the amount.
  const t = t0.replace(/\s*(?:\(\s*)?(?:in|as (?:of|on|at))?\s*Q[1-4]\s*FY\s?'?\d{2,4}\s*\)?\s*$/i, '').trim();
  const m = /^(~|approx\.?|approximately|about|around|over|nearly)?\s*(₹|inr|rs\.?|`|!)?\s*(\d[\d,]*(?:\.\d+)?)\s*(crores?|crs?\.?|cr\.?|billions?|bn|millions?|mn)$/i.exec(t);
  if (!m) return t0;
  const pre = m[1] ? `${m[1]} ` : '';
  const unit = m[4].toLowerCase();
  if (/^c/.test(unit)) return `${pre}₹${m[3]} Cr`;
  // A billion / million converts to crore only when the currency is rupees —
  // an exact unit change (1 bn = 100 Cr, 1 mn = 0.1 Cr), never a guessed rate.
  if (!m[2]) return t0;
  const n = Number(m[3].replace(/,/g, ''));
  if (!Number.isFinite(n)) return t0;
  const cr = /^b/.test(unit) ? n * 100 : n / 10;
  const r = Math.round(cr * 100) / 100;
  return `${pre}₹${r.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
}

/** zzz788: which of two readings of one figure is the LATER disclosure —
 *  latest reporting period first, then the latest source date. */
function laterThan(a: { period: string | null; date: string | null }, b: { period: string | null; date: string | null }): boolean {
  const pa = a.period ? periodOrdinal(a.period) : -1, pb = b.period ? periodOrdinal(b.period) : -1;
  if (pa !== pb) return pa > pb;
  return String(a.date || '') > String(b.date || '');
}

// ── Metric → mechanism kind ────────────────────────────────────────────────
const KIND_OF: Record<string, PersistKind> = {
  capacity: 'CAPACITY_RAMP', capacity_addition: 'CAPACITY_RAMP', new_plant: 'CAPACITY_RAMP', commissioning: 'CAPACITY_RAMP',
  capex_status: 'CAPACITY_RAMP', capex_earning: 'CAPACITY_RAMP', utilisation: 'CAPACITY_RAMP', volume: 'CAPACITY_RAMP', capex: 'CAPACITY_RAMP',
  order_book: 'ORDER_VISIBILITY', order_intake: 'ORDER_VISIBILITY', book_to_bill: 'ORDER_VISIBILITY', revenue_visibility: 'ORDER_VISIBILITY',
  new_customer: 'CUSTOMER_RAMP', qualification: 'CUSTOMER_RAMP', approval: 'CUSTOMER_RAMP', customer_ramp: 'CUSTOMER_RAMP',
  exports: 'GEOGRAPHY', new_geography: 'GEOGRAPHY',
  product_mix: 'MIX_PRICING', margin_driver: 'MIX_PRICING', price: 'MIX_PRICING',
};
const TEMPORARY = /inventory (gain|benefit|valuation)|one[- ]off|one[- ]time|exceptional|base effect|raw material (price )?(fall|decline|softening|moderation)|commodity (price )?(fall|decline|softening)|moderation in [a-z]+ prices|forex gain|write[- ]?back|reversal/i;
const CAPACITY_UNIT = /(?<![a-z])(mtpa|ktpa|tpa|tpd|tpm|mtpd|tons?|tonnes?|mt\b|kl\b|kilo ?lit|klpd|kl\/?d|mw|gw|kw|units?|lines?|sq\.? ?ft|square feet|beds|boutiques|stores|looms|spindles|vessels|vlgcs?|reactors?|furnaces?|kg|litres?|pieces|pcs|sets|mva|gpus?|servers?|racks?)\b/i;
const MONEY = /₹|\binr\b|\brs\.?\s?\d|\bcrores?\b|\bcr\b|\bmn\b|million|billion|\busd\b|\$/i;
const PCT = /(\d+(?:\.\d+)?)\s*%/;
/** A currency marker — "37 million sq ft" is not money. */
const CUR = /₹|\binr(?![a-z])|\brs\.?|\bcrores?\b|\bcr\b|\busd\b|\$/i;
const LIFECYCLE_METRIC = /^(capex_status|commissioning|new_plant)$/;
const LIFECYCLE_DONE = /commissioned|commercial production|commenced (commercial )?(production|operations)|started (commercial )?production|operational|production (started|commenced)|now running|went live/i;

// ═══════════════════════════════════════════════════════════════════════════
// WHAT KIND OF "CAPACITY" A FIGURE IS.                               (zzz784)
//
// A boutique count, a lab's floor area and a rupee figure all arrived as
// "capacity" and were chained into "production running → utilisation 13.2%"
// (ETHOSLTD: the 13.2% was same-store sales growth). Only a PRODUCTION rate
// (tonnes, MW, KL, units per period…) can be commissioned, run and utilised.
//   PRODUCTION  a physical output rate — the capacity-ramp ladder applies
//   NETWORK     stores / boutiques / clinics / branches / beds — a network
//               expansion: opened, not commissioned; no "production"
//   FLOOR_SPACE a floor area with no output rate (lab, office, warehouse)
//   MONEY       a rupee figure ("installed capacity ₹1,400 Cr" is a peak-
//               revenue potential) — never capacity
// ═══════════════════════════════════════════════════════════════════════════
export type CapacityClass = 'PRODUCTION' | 'NETWORK' | 'FLOOR_SPACE' | 'MONEY' | 'UNKNOWN';
export const NETWORK_UNIT = /\b(boutiques?|stores?|showrooms?|outlets?|clinics?|centres?|centers?|hospitals?|beds|branch(?:es)?|hubs?|(?:amusement |theme )?parks?|ferr(?:y|ies)|touch ?points?|restaurants?|cinemas?|screens|schools?|kiosks?|dealerships?|pharmacies|franchisees?|doors)\b/i;
const AREA_UNIT = /\b(sq\.? ?ft|square (?:feet|foot|metres?|meters?)|sq\.? ?m(?:tr)?s?\b|sqm|acres?|hectares?)\b/i;
const RATE = /per\s*(annum|year|day|month|hour|shift)|\bp\.?\s?a\b|\/\s*(?:yr|year|annum|day|month|hr|hour)|\bannual\b|\bmtpa\b|\bktpa\b|\btpa\b|\btpd\b|\btpm\b|\bklpd\b|\bmtpd\b/i;
const FLOOR_WORDS = /\b(lab|laborator\w*|office|floor|space|warehouse|campus|hangar|built[- ]up|carpet|leasable|shop floor|facility area)\b/i;
export function capacityClass(after: string | null | undefined, quote?: string | null): CapacityClass {
  const a = String(after ?? '');
  const q = String(quote ?? '');
  if (NETWORK_UNIT.test(a)) return 'NETWORK';
  if (AREA_UNIT.test(a)) {
    // "1,200 lakh square feet of ANNUAL capacity" (window film) is an output rate.
    if (RATE.test(a) || RATE.test(q.slice(0, 260)) && !FLOOR_WORDS.test(q.slice(0, 260))) return 'PRODUCTION';
    return 'FLOOR_SPACE';
  }
  if (CAPACITY_UNIT.test(a)) return 'PRODUCTION';
  if (MONEY.test(a)) return 'MONEY';
  // "3x", "~5100 GPUs live": a production capability stated without a rate.
  if (/\d/.test(a)) return 'UNKNOWN';
  return 'UNKNOWN';
}
/** A percentage that is NOT a capacity-utilisation reading: same-store sales
 *  growth (ETHOSLTD 13.2%), a renewable-energy share (CYIENTDLM 63.61%), a
 *  market share, a fixed-asset turn. A utilisation reading names what it is. */
const UTIL_NOT = /same[- ]store|\bsssg\b|like[- ]for[- ]like|\blfl\b|renewable|electricity consumption|\bRE\b|market share|share of (?:revenue|sales|total)|attrition|asset turn|fixed asset turnover|accounted for/i;
const UTIL_CONTEXT = /utili[sz]|capacity|\bcuf\b|\bplf\b|occupanc|operating rate|running at|loading|load factor/i;
export function isUtilisationReading(after: string | null | undefined, quote?: string | null): boolean {
  const t = `${after ?? ''} ${String(quote ?? '').slice(0, 300)}`;
  if (UTIL_NOT.test(t)) return false;
  return UTIL_CONTEXT.test(t) || !quote;
}
/** A plant-load / capacity-utilisation FACTOR (solar, wind, thermal) is bounded
 *  by the resource, not by 100% — no headroom to 100 is ever computed from it. */
const FACTOR_UTIL = /\bcuf\b|\bplf\b|capacity utili[sz]ation factor|plant load factor/i;
/** Float noise ("23.099999999999994 points") never reaches a sentence. */
const pp1 = (n: number): string => String(Math.round(n * 10) / 10);

// ═══════════════════════════════════════════════════════════════════════════
// THE CAPACITY STAGE LADDER.                                          (zzz784)
//
// The next evidence is derived MECHANICALLY from the highest stage the filed
// evidence reaches, and it is never an earlier stage: a plant already running
// at 19.89% CUF (GIPCL) cannot be waiting for "commissioning". A management
// target is offered only when it belongs to a LATER stage, and is labelled a
// milestone, not evidence.
// ═══════════════════════════════════════════════════════════════════════════
export type CapacityStage = 'ANNOUNCED' | 'UNDER_CONSTRUCTION' | 'COMMISSIONED' | 'RUNNING' | 'UTILISATION_RAMP' | 'VOLUME_RAMP'
  | 'REVENUE_CONTRIBUTION' | 'MARGIN_CONTRIBUTION' | 'STEADY_STATE';
export const CAPACITY_STAGES: CapacityStage[] = ['ANNOUNCED', 'UNDER_CONSTRUCTION', 'COMMISSIONED', 'RUNNING', 'UTILISATION_RAMP', 'VOLUME_RAMP',
  'REVENUE_CONTRIBUTION', 'MARGIN_CONTRIBUTION', 'STEADY_STATE'];
export const CAPACITY_STAGE_LABEL: Record<CapacityStage, string> = {
  ANNOUNCED: 'Announced', UNDER_CONSTRUCTION: 'Under construction', COMMISSIONED: 'Commissioned', RUNNING: 'Production / running',
  UTILISATION_RAMP: 'Utilisation ramp', VOLUME_RAMP: 'Volume ramp', REVENUE_CONTRIBUTION: 'Revenue contribution',
  MARGIN_CONTRIBUTION: 'Margin contribution', STEADY_STATE: 'Steady state',
};
export const stageRank = (s: CapacityStage | null | undefined): number => (s ? CAPACITY_STAGES.indexOf(s) : -1);

const iso = (s: string | null | undefined): string | null => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const pctOf = (s: string | null | undefined): number | null => { const m = PCT.exec(String(s || '')); return m ? Number(m[1]) : null; };
/** The capacity unit family of a value — two capacities compare only within one family. */
const unitKey = (s: string | null | undefined): string | null => {
  const m = CAPACITY_UNIT.exec(String(s || ''));
  if (!m) return MONEY.test(String(s || '')) ? 'money' : null;
  const u = m[0].toLowerCase().replace(/\s|\./g, '');
  if (/^(mtpa|ktpa|tpa|tpd|tpm|mtpd|tons?|tonnes?|mt|kg)$/.test(u)) return 'mass';
  if (/^(kl|kilolit|klpd|kl\/?d|litres?)/.test(u)) return 'volume';
  if (/^(mw|gw|kw|mva)$/.test(u)) return 'power';
  if (/sqft|squarefeet/.test(u)) return 'area';
  return u.replace(/s$/, '');
};

// ── 1. EVIDENCE ITEMS FROM THE LEDGER (all periods = the memory) ──────────
export function itemsFromLedger(ledger: any): PersistItem[] {
  const out: PersistItem[] = [];
  const periods: Record<string, any> = ledger?.periods || {};
  for (const [period, rec] of Object.entries(periods)) {
    for (const f of (rec?.facts || []) as any[]) {
      if (f?.record_status && f.record_status !== 'ACTIVE') continue;
      if (f?.evidence_quality === 'unit_mismatch') continue;
      let metric = String(f?.metric_name || '');
      const after = String(f?.after_value ?? f?.value ?? '').trim();
      const before = f?.before_value ? String(f.before_value).trim() : null;
      if (!after) continue;
      // "capacity 63.61%" is a utilisation reading, not a capacity — when the
      // sentence is about utilisation at all (CYIENTDLM's 63.61% is a
      // renewable-energy share). (zzz784)
      if ((metric === 'capacity' || metric === 'capacity_addition') && PCT.test(after) && !CAPACITY_UNIT.test(after)) {
        if (!isUtilisationReading(after, f?.source_quote)) continue;
        metric = 'utilisation';
      }
      // Same-store sales growth, a market share, an RE share: not utilisation. (zzz784)
      if (metric === 'utilisation' && !isUtilisationReading(after, f?.source_quote)) continue;
      // A tonnage the sentence describes as volume grown / handled (GPPL
      // "liquids have grown … to 1.6 million MT", GOODLUCK "volume has
      // increased … to 1,22,718 MT") is output volume, not capacity. (zzz784)
      if (metric === 'capacity' && volumeContext(after, f?.source_quote)) metric = 'volume';
      // "Installed capacity ₹1,400 Cr" is a peak-revenue potential: money is
      // never capacity. (zzz784)
      if (metric === 'capacity' && MONEY.test(after) && !CAPACITY_UNIT.test(after)) continue;
      const kind = KIND_OF[metric];
      if (!kind) continue;
      const stmt = String(f?.fact_or_management_statement || 'FACT');
      const hasFig = /\d/.test(after);
      // Plausibility per metric — a figure in the wrong unit is not evidence.
      if (metric === 'utilisation' && stmt === 'FACT' && !PCT.test(after)) continue;
      if ((metric === 'order_book' || metric === 'order_intake' || metric === 'revenue_visibility') && hasFig && !MONEY.test(after) && !/\d\s*x\b/i.test(after)) continue;
      if ((metric === 'capacity' || metric === 'capacity_addition') && hasFig && !CAPACITY_UNIT.test(`${after} ${f?.unit || ''}`) && !MONEY.test(after)) continue;
      if ((metric === 'capacity' || metric === 'capacity_addition') && /budget|allocation|industry|market size|country|india'?s/i.test(`${after} ${f?.source_quote || ''}`.slice(0, 300)) && !/\bour\b|\bwe\b|company/i.test(String(f?.source_quote || '').slice(0, 200))) continue;
      // A rupee figure filed as "capacity added" is a capex amount, not capacity.
      if ((metric === 'capacity_addition' || metric === 'capex_status') && MONEY.test(after) && !CAPACITY_UNIT.test(after)) metric = 'capex';
      // Ore reserves / resources are not capacity (HINDCOPPER "198.61 Million Tonne").
      if ((metric === 'capacity' || metric === 'capacity_addition') && /reserve|resource|\bore\b|mineable|deposit/i.test(`${after} ${String(f?.source_quote || '').slice(0, 300)}`)) continue;
      const planned = (metric === 'capacity' || metric === 'capacity_addition') && forwardSentence(after, f?.source_quote);
      const cls: EvidenceClass = stmt === 'TARGET' || stmt === 'GUIDANCE' || f?.evidence_type === 'forward' || planned ? 'FORWARD'
        // Capex SPENDING is the announced / spent stage — never a mechanism figure.
        : metric === 'capex' ? 'REMARK'
        // A filed, dated lifecycle fact ("plant commissioned", "commercial
        // production started") is hard evidence even without a number.
        : stmt === 'FACT' && LIFECYCLE_METRIC.test(metric) && LIFECYCLE_DONE.test(`${after} ${f?.source_quote || ''}`.slice(0, 400)) && !/under construction|expected|will be|to be commissioned|planned/i.test(after) ? 'HARD'
        // zzz790: a figure read off a chart at LOW confidence is a remark,
        // never hard evidence (SPECTRUM "Solar Rooftop: 3.3 MW (Completed 1.3…)").
        : stmt === 'FACT' && hasFig && !(f?.evidence_quality === 'chart' || f?.confidence === 'LOW') ? 'HARD' : 'REMARK';
      out.push({
        metric, kind, cls,
        // zzz790: a target / plan says so in its own text — never "Capacity added" as if achieved.
        text: `${String(f?.metric_label || metric)}${cls === 'FORWARD' ? ' (planned / target — not achieved)' : ''}: ${before ? `${before} → ` : ''}${after}`,
        before, after, numeric: scaledNumber(after), numericBefore: before ? scaledNumber(before) : null,
        period, date: iso(f?.source_date) || iso(f?.effective_date),
        sources: [{ name: String(f?.source_name || 'filing'), url: f?.source_url || null, date: iso(f?.source_date), quote: f?.source_quote ? clip(String(f.source_quote), 260) : null }],
        origin: 'ledger',
        capClass: metric === 'capacity' || metric === 'capacity_addition' ? capacityClass(after, f?.source_quote) : undefined,
      });
      // one-off facts are not items; they are read by temporarySignals()
    }
  }
  return out;
}

/** Temporary / non-structural signals in the ledger (inventory gain, one-offs). */
export function temporarySignalsFromLedger(ledger: any): string[] {
  const out: string[] = [];
  for (const rec of Object.values<any>(ledger?.periods || {})) {
    for (const f of (rec?.facts || []) as any[]) {
      const t = `${f?.after_value || f?.value || ''} ${f?.source_quote || ''}`;
      if ((f?.metric_name === 'one_offs' || f?.metric_name === 'margin_driver') && TEMPORARY.test(t)) out.push(clip(String(f?.after_value || f?.value || f?.source_quote), 120));
    }
    const summ = JSON.stringify(rec?.summary || '');
    const m = TEMPORARY.exec(summ);
    if (m) out.push(`summary mentions "${m[0]}"`);
  }
  return [...new Set(out)].slice(0, 4);
}

// ── 2. ITEMS FROM THE THESIS ASSESSMENT (current period, quality-filtered) ──
export function itemsFromAssessment(a: any, period: string | null, date: string | null): PersistItem[] {
  const out: PersistItem[] = [];
  for (const d of (a?.mechanismEvidence || []) as Array<{ key: string; text: string }>) {
    const kind = KIND_OF[d.key];
    // The ledger already carries capacity / order / volume figures with their
    // sources; the assessment adds what the ledger holds as prose.
    if (!kind) continue;
    // The assessment's drivers are quality-filtered ACTUAL readings from the
    // documents read (the ledger's events as well as its facts); a figure in
    // them — "capacity 5,000 → 9,600 MTPA", "order book ₹140 → ₹225 Cr" — is
    // filed evidence. The dedup below merges it with the same ledger fact.
    // "capacity added capacity added 3x": the driver text carries its own
    // label; the value is what follows it. (zzz784)
    const body = d.text.replace(/^[a-z /]+:\s*/i, '')
      .replace(/^(?:(?:installed )?capacity(?: added)?|capacity utili[sz]ation|utili[sz]ation|volume|capex status|capex earning|order book|order intake)\s+(?=\S)/i, '')
      .replace(/^(?:capacity added|installed capacity)\s+/i, '');
    const ba = /^(.+?)\s*→\s*(.+?)(?:\s*\([+-]?[\d.]+%\))?$/.exec(body);
    const before = ba ? ba[1].replace(/^[a-z ]+\s(?=\d)/i, '').trim() : null;
    const after = ba ? ba[2].trim() : body;
    const hasFig = /\d/.test(d.text) && (MONEY.test(d.text) || PCT.test(d.text) || CAPACITY_UNIT.test(d.text) || /\d(\.\d+)?\s*x\b/i.test(d.text));
    if ((d.key === 'capacity' || d.key === 'capacity_addition') && !CAPACITY_UNIT.test(d.text) && !/\d(\.\d+)?\s*x\b|doubl/i.test(d.text)) continue;
    if ((d.key === 'capacity' || d.key === 'capacity_addition') && MONEY.test(after) && !CAPACITY_UNIT.test(after)) continue;
    if (d.key === 'utilisation' && !isUtilisationReading(after, null)) continue;
    const label = d.key === 'capacity' ? 'Installed capacity' : d.key === 'capacity_addition' ? 'Capacity added' : d.key === 'utilisation' ? 'Capacity utilisation' : null;
    out.push({ metric: d.key, kind, cls: hasFig ? 'HARD' : 'REMARK', text: label ? `${label}: ${body}` : d.text, before, after, numeric: scaledNumber(after), numericBefore: before ? scaledNumber(before) : null,
      period, date, sources: [{ name: 'documents read this period', url: null, date, quote: null }], origin: 'assessment',
      capClass: d.key === 'capacity' || d.key === 'capacity_addition' ? capacityClass(after, null) : undefined });
  }
  return out;
}

// ── 3. ITEMS FROM AN AI DAILY GAINERS FINDING (the move is only the trigger) ──
export function itemsFromFinding(f: any): PersistItem[] {
  if (!f || f.status !== 'catalyst') return [];
  const cat = String(f.category || '');
  const facts: Record<string, string> = f.facts || {};
  const said = (k: string) => (facts[k] && !/not stated/i.test(facts[k]) ? facts[k] : null);
  const date = iso(f.sourceDate);
  const src = [{ name: f.modelRead ? 'exchange filing (read)' : 'exchange filing (summary)', url: f.sourceUrl || null, date, quote: f.evidenceQuote ? clip(String(f.evidenceQuote), 260) : null }];
  const early = f.stage === 'enabling' || f.stage === 'scheduled';
  const out: PersistItem[] = [];
  // zzz787: the SAME underlying catalyst id the Daily Gainers card uses.
  let eventId: string | undefined;
  try { const x = factsForFinding(f)[0]; if (x && f.ticker) eventId = catalystIdOf(String(f.ticker), x.event.kind, x.event.counterparty, x.event.product); } catch { eventId = undefined; }
  const push = (metric: string, kind: PersistKind, text: string, hard: boolean, after: string | null = null) =>
    out.push({ metric, kind, cls: hard && !early ? 'HARD' : early ? 'FORWARD' : 'REMARK', text, before: null, after, numeric: scaledNumber(after), numericBefore: null, period: null, date, sources: src, origin: 'gainer', ...(eventId ? { eventId } : {}) });
  const val = f.valueStated != null ? `₹${f.valueStated} Cr` : said('value');
  if (cat === 'order_win' || cat === 'backlog_increase') {
    push('order_intake', 'ORDER_VISIBILITY', `Order${said('counterparty') ? ` from ${said('counterparty')}` : ''}${val ? `: ${val}` : ''}${said('execution_period') ? ` · execution ${said('execution_period')}` : ''}`, !!val, val);
  } else if (cat === 'capacity_expansion' || cat === 'production_ramp' || cat === 'utilization_increase') {
    const cap = said('capacity');
    push(cap ? 'capacity_addition' : 'capex_status', 'CAPACITY_RAMP', `${f.stage === 'executed' ? 'Commissioned / operational' : 'Capacity plan'}: ${clip(String(f.headline || ''), 150)}`, !!(cap && /\d/.test(cap)) || f.valueStated != null, cap || val);
  } else if (cat === 'new_customer' || cat === 'customer_ramp' || cat === 'product_qualification' || cat === 'regulatory_approval' || cat === 'export_approval') {
    push(cat === 'product_qualification' || cat.endsWith('approval') ? 'qualification' : 'new_customer', 'CUSTOMER_RAMP', clip(String(f.headline || ''), 170), !!said('counterparty') && (!!val || /order|contract|supply/i.test(String(f.headline || ''))), val);
  } else if (cat === 'new_geography') {
    push('exports', 'GEOGRAPHY', clip(String(f.headline || ''), 170), !!val, val);
  }
  return out;
}

// ── 4. DEDUP — one figure, one item, many sources ──────────────────────────
function dedupe(items: PersistItem[]): PersistItem[] {
  const byKey = new Map<string, PersistItem>();
  // Three significant figures (zzz788): "₹2,598 Cr" and "≈₹2,600 Cr" are one
  // figure; ₹2,550 Cr and ₹2,640 Cr in two quarters are two readings.
  // zzz790: three significant figures at EVERY scale — SPECTRUM's filed
  // 3.3 MW and planned 3.0 MW rounded to one key and merged into "capacity
  // added 3.0 MW · HARD" (a target read as achieved).
  const norm = (n: number | null) => (n == null ? null : n === 0 ? 0 : Math.round(n / Math.pow(10, Math.floor(Math.log10(Math.abs(n))) - 2)));
  for (const it of items) {
    const n = norm(it.numeric);
    const key = n != null ? `${it.metric}|${n}|${it.numericBefore != null ? norm(it.numericBefore) : ''}` : `${it.metric}|${it.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60)}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, { ...it, sources: [...it.sources] }); continue; }
    // Keep the strongest class, the earliest date, and every source.
    const rank = (c: EvidenceClass) => (c === 'HARD' ? 2 : c === 'REMARK' ? 1 : 0);
    // zzz788: the LATEST disclosure of the figure is the one printed (the card
    // reads the latest period); a target never replaces a filed value.
    const newer = it.cls !== 'FORWARD' && laterThan(it, prev);
    // zzz790: a stronger class brings its OWN figure — never a HARD label on
    // a forward row's value.
    if (rank(it.cls) > rank(prev.cls)) { prev.cls = it.cls; prev.text = it.text; prev.after = it.after; prev.numeric = it.numeric; prev.before = it.before; prev.numericBefore = it.numericBefore; prev.period = it.period ?? prev.period; }
    if (newer) { prev.text = it.text; prev.after = it.after; prev.numeric = it.numeric; prev.period = it.period ?? prev.period; if (it.before) { prev.before = it.before; prev.numericBefore = it.numericBefore; } }
    if (it.before && !prev.before) { prev.before = it.before; prev.numericBefore = it.numericBefore; prev.text = it.text; }
    for (const s of it.sources) if (!prev.sources.some((x) => x.name === s.name && x.date === s.date)) prev.sources.push(s);
    if (!prev.eventId && it.eventId) prev.eventId = it.eventId;
    if (it.date && (!prev.date || it.date > prev.date)) prev.date = it.date;
  }
  return [...byKey.values()];
}

// ── 5. EVALUATE ONE MECHANISM ──────────────────────────────────────────────
interface Ctx { ticker: string; thesisStatus?: string | null; temporary: string[]; origins: Array<'portfolio' | 'gainers'>; today: string; quarterRevenueCr?: number | null;
  /** zzz784: the card's normalized capex state — false when no capital project
   *  on the card is built (all announced / under construction). Lifecycle WORDS
   *  alone then cannot put the capacity past construction, so Special Focus and
   *  the card never disagree. Null / undefined = unknown. */
  capexOperating?: boolean | null;
  capexBuild?: { projects: Array<{ name: string; build: string }> } | null }

function series(items: PersistItem[], metric: string): PersistItem[] {
  // zzz788: ordered by reporting period, then source date — the last is the
  // latest disclosure, the same one the card reads.
  return items.filter((i) => i.metric === metric && i.cls === 'HARD' && i.numeric != null)
    .sort((a, b) => ((a.period ? periodOrdinal(a.period) : -1) - (b.period ? periodOrdinal(b.period) : -1)) || String(a.date).localeCompare(String(b.date)));
}

// ═══════════════════════════════════════════════════════════════════════════
// HEADROOM IS NOT RUNWAY.                                            (zzz788)
// FCL (80,000 → 148,000 MTPA, commissioned, 63%) and EXICOM (3x, commissioned,
// 65%) read "High persistence evidence" on unused capacity. Commissioned
// capacity and today's utilisation say nothing about FUTURE demand. A capacity
// ramp's runway needs CONTINUATION evidence: a continuing / growing order book,
// a customer ramp (repeat orders), recurring volume growth, utilisation rising
// on the same basis, or contracted demand. Unused capacity is printed as
// "Capacity headroom", never as runway, and never lifts a persistence grade.
// ═══════════════════════════════════════════════════════════════════════════
const MULTI_YEAR = /\b(\d+|two|three|four|five)[- ](year|yr)s?\b|multi[- ]year|over \d{2,} months|till (fy|20)\d{2}/i;
const CONTRACTED = /offtake|off-take|sold out|fully booked|contracted (?:demand|volumes?|capacity|sales)|long[- ]term (?:supply |offtake )?(?:contract|agreement)s?|\bPPAs?\b|power purchase agreement|take[- ]or[- ]pay/i;
export function demandContinuation(all: PersistItem[], quarterRevenueCr?: number | null): string | null {
  const hard = all.filter((i) => i.cls === 'HARD');
  const money = (i: PersistItem) => CUR.test(i.before || '') && CUR.test(i.after || '');
  const obUp = hard.find((i) => i.metric === 'order_book' && money(i) && i.numericBefore != null && i.numeric != null && i.numeric > i.numericBefore * 1.03);
  if (obUp) return `order book growing ${rupeeCr(obUp.before)} → ${rupeeCr(obUp.after)}`;
  const ob = series(all, 'order_book').filter((i) => CUR.test(i.after || ''));
  if (ob.length >= 2 && ob[ob.length - 1].numeric! > ob[0].numeric! * 1.03) return `order book growing ${rupeeCr(ob[0].after)} → ${rupeeCr(ob[ob.length - 1].after)}`;
  const btb = hard.find((i) => i.metric === 'book_to_bill');
  const btbX = btb ? Number((/(\d+(?:\.\d+)?)\s*x/i.exec(btb.after || '') || [])[1]) : NaN;
  if (Number.isFinite(btbX) && btbX >= 1.2) return `book-to-bill ${btbX}x — orders arriving faster than revenue is billed`;
  const last = ob.length ? ob[ob.length - 1] : null;
  const obCr = last && last.numeric != null ? last.numeric / 1e7 : null;
  const cov = obCr && quarterRevenueCr && quarterRevenueCr > 0 ? Math.round((obCr / (quarterRevenueCr * 4)) * 10) / 10 : null;
  if (cov != null && cov >= 1.5) return `order book ${rupeeCr(last!.after)} ≈ ${cov}× annual revenue`;
  const multi = hard.find((i) => i.kind === 'ORDER_VISIBILITY' && MULTI_YEAR.test(i.text));
  if (multi) return `multi-year contracted execution (${clip(multi.text, 80)})`;
  const cust = hard.find((i) => i.kind === 'CUSTOMER_RAMP' && /repeat|follow[- ]on|additional (order|product)|second (order|product)|expanded/i.test(i.text));
  if (cust) return `customer ramp — ${clip(cust.text, 80)}`;
  const contracted = all.find((i) => i.cls !== 'FORWARD' && CONTRACTED.test(`${i.text} ${i.sources.map((x) => x.quote || '').join(' ')}`));
  if (contracted) return `contracted demand on file (${clip(contracted.text, 80)})`;
  return null;
}

function evaluate(kind: PersistKind, all: PersistItem[], ctx: Ctx): PersistentCatalyst | null {
  let items = all.filter((i) => i.kind === kind);
  // ── PRODUCTION ≠ STORE NETWORK ≠ FLOOR SPACE.                      (zzz784)
  // Keep the kind (no new scoring kind); choose the label variant from what
  // the capacity figures ARE. A production rate or a utilisation reading makes
  // it a production ramp and the store / floor rows are dropped from it; with
  // neither, stores make a network expansion and floor area a facility
  // expansion — never "production running" or "capacity utilisation".
  let variant: 'PRODUCTION' | 'NETWORK' | 'FLOOR_SPACE' | undefined;
  if (kind === 'CAPACITY_RAMP') {
    const capRow = (i: PersistItem) => i.metric === 'capacity' || i.metric === 'capacity_addition';
    const nonProd = (i: PersistItem) => capRow(i) && (i.capClass === 'NETWORK' || i.capClass === 'FLOOR_SPACE' || i.capClass === 'MONEY');
    const prod = items.some((i) => i.cls !== 'FORWARD' && ((capRow(i) && !nonProd(i)) || i.metric === 'utilisation'));
    const net = items.filter((i) => capRow(i) && i.capClass === 'NETWORK');
    const floor = items.filter((i) => capRow(i) && i.capClass === 'FLOOR_SPACE');
    if (prod || (!net.length && !floor.length)) { variant = 'PRODUCTION'; items = items.filter((i) => !nonProd(i)); }
    else if (net.length) { variant = 'NETWORK'; items = items.filter((i) => (capRow(i) && i.capClass === 'NETWORK') || i.metric === 'volume'); }
    else { variant = 'FLOOR_SPACE'; items = floor; }
  }
  const hard = items.filter((i) => i.cls === 'HARD');
  // A MECHANISM figure: a filed number that shows the mechanism moving —
  // installed capacity that did not change, flat volume or a capex budget
  // are context, not evidence that anything is ramping.
  const volGrowth = (i: PersistItem) => /(grew|growth|\bup\b|increase|rose|higher|\+)/i.test(i.text) && !/flat|down|declin|lower|fell/i.test(i.text) && (pctOf(i.text) ?? 0) >= 5;
  const isMech = (i: PersistItem): boolean => {
    if (i.cls !== 'HARD') return false;
    if (i.metric === 'capacity') return i.numericBefore != null && i.numeric != null && i.numeric > i.numericBefore;
    if (i.metric === 'volume') return volGrowth(i) || (i.numericBefore != null && i.numeric != null && i.numeric > i.numericBefore * 1.05);
    if (i.metric === 'book_to_bill') return /\d\s*x\b/i.test(i.after || '');
    if (LIFECYCLE_METRIC.test(i.metric)) return LIFECYCLE_DONE.test(i.text) && !/under construction|expected|will be|to be commissioned|planned/i.test(i.text);
    return true;
  };
  const mech = items.filter(isMech);
  const volFlat = items.some((i) => i.metric === 'volume' && i.cls === 'HARD' && /flat|down|declin|fell|lower/i.test(i.text));
  const remarks = items.filter((i) => i.cls === 'REMARK');
  const forward = items.filter((i) => i.cls === 'FORWARD');
  if (!hard.length && !remarks.length) return null;                 // targets alone are narrative
  const metrics = new Set(mech.map((i) => i.metric));
  const periods = [...new Set(items.map((i) => i.period).filter(Boolean) as string[])];
  const dates = [...new Set(mech.map((i) => i.date).filter(Boolean) as string[])].sort();
  const spanDays = dates.length > 1 ? (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000 : 0;
  const multiPeriod = periods.length >= 2 || spanDays >= 60;
  const happened: string[] = [], notYet: string[] = [];
  const beforeAfter: BeforeAfterRow[] = [];
  const baRow = (variable: string, b: string, c: string, dir: BeforeAfterRow['direction'], it: PersistItem) =>
    beforeAfter.push({ variable, before: b, current: c, direction: dir, source: it.sources[0]?.name || 'filing', date: it.date });
  const dirOf = (a: number | null, b: number | null): BeforeAfterRow['direction'] => (a == null || b == null ? '?' : b > a * 1.01 ? '↑' : b < a * 0.99 ? '↓' : '→');
  // Rows from an item's own before → after, else from the same metric across dates.
  const rowFor = (metric: string, name: string) => {
    const withBA = items.find((i) => i.metric === metric && i.cls === 'HARD' && i.before && i.numeric != null);
    if (withBA) { baRow(name, withBA.before!, withBA.after!, dirOf(withBA.numericBefore, withBA.numeric), withBA); return; }
    const s = series(items, metric);
    if (s.length >= 2 && Math.abs((s[s.length - 1].numeric! - s[0].numeric!) / (s[0].numeric! || 1)) > 0.02) baRow(name, `${s[0].after} (${s[0].date || s[0].period})`, `${s[s.length - 1].after} (${s[s.length - 1].date || s[s.length - 1].period})`, dirOf(s[0].numeric, s[s.length - 1].numeric), s[s.length - 1]);
    else if (s.length) baRow(name, '— (first reading)', s[s.length - 1].after!, '?', s[s.length - 1]);
  };

  let state: PersistState = 'IDENTIFIED';
  let runway = { ok: false, text: 'No evidence-supported runway.' };
  let mechanism = '';
  let nextMilestone: string | null = null;
  let confirmWith = '', invalidateIf = '';
  const fwdText = (re: RegExp) => forward.find((i) => re.test(i.metric) || re.test(i.text));

  let stage: string = '';
  let nextEvidence: string | null = null;
  let managementTarget: string | null = null;
  let capexNote: string | null = null;
  let headroom: string | null = null;
  let continuation: string | null = null;
  const targetText = (i: PersistItem) => `Management target (milestone, not evidence): ${clip(i.text, 150)} (${i.date || i.period || 'undated'})`;

  if (kind === 'CAPACITY_RAMP' && variant === 'NETWORK') {
    // ── A STORE NETWORK OPENS; IT IS NOT COMMISSIONED.               (zzz784)
    const net = items.filter((i) => i.metric === 'capacity' || i.metric === 'capacity_addition');
    const unitWord = ((NETWORK_UNIT.exec(net.map((i) => i.after).join(' ')) || [])[0] || 'stores').toLowerCase();
    const grew = net.find((i) => i.cls === 'HARD' && i.numericBefore != null && i.numeric != null && i.numeric > i.numericBefore);
    const levels = net.filter((i) => i.metric === 'capacity' && i.cls === 'HARD' && i.numeric != null);
    const saysGrowth = levels.some((i) => /\b(grew|increased|expanded|from)\b/i.test(i.sources[0]?.quote || ''));
    const lo = levels.length >= 2 && saysGrowth ? levels.reduce((a, b) => (b.numeric! < a.numeric! ? b : a)) : null;
    const hi = levels.length >= 2 && saysGrowth ? levels.reduce((a, b) => (b.numeric! > a.numeric! ? b : a)) : null;
    const opened = net.find((i) => i.metric === 'capacity_addition' && i.cls === 'HARD');
    const from = grew ? grew.numericBefore! : lo && hi && hi.numeric! > lo.numeric! ? lo.numeric! : null;
    const to = grew ? grew.numeric! : hi ? hi.numeric! : null;
    const growthPct = from && to ? Math.round(((to - from) / from) * 1000) / 10 : null;
    const vol = items.find((i) => i.metric === 'volume' && i.cls === 'HARD');
    mechanism = [from != null && to != null ? `network ${from} → ${to} ${unitWord}` : levels.length ? `network ${levels[levels.length - 1].after}` : null,
      opened ? `opened: ${opened.after}` : null, vol ? `volume ${vol.after}` : null].filter(Boolean).join(' · ') || 'store-network evidence on file';
    stage = from != null || opened ? 'Network expanded (stores opened)' : 'Network disclosed';
    state = from != null || opened ? 'VALIDATED' : 'IDENTIFIED';
    runway = growthPct != null && growthPct >= 5
      ? { ok: true, text: `Network grew ${from} → ${to} ${unitWord} (+${growthPct}%) — newly opened ${unitWord} take several quarters to mature; store maturity, not unused production capacity, is the runway.` }
      : { ok: false, text: 'Store count on file, but no network growth over two readings — a store network is not production capacity and has no utilisation headroom.' };
    if (from != null) baRow(`Network (${unitWord})`, String(from), String(to), '↑', grew || hi!);
    (from != null || opened) ? happened.push(`Network expanded${from != null ? `: ${from} → ${to} ${unitWord}` : ''}${opened ? ` (${opened.after})` : ''}`) : notYet.push('Network growth shown over two readings');
    notYet.push('Same-store sales / revenue per store on the enlarged network disclosed');
    nextEvidence = 'Revenue per store or same-store sales growth on the enlarged network, and the next disclosed store count';
    confirmWith = 'same-store sales holding while the network grows, and revenue per new store rising as stores mature';
    invalidateIf = 'store closures, falling same-store sales, or new stores not reaching the network average';
  } else if (kind === 'CAPACITY_RAMP' && variant === 'FLOOR_SPACE') {
    // ── FLOOR AREA IS NOT OUTPUT CAPACITY.                              (zzz784)
    const grew = items.find((i) => i.cls === 'HARD' && i.numericBefore != null && i.numeric != null && i.numeric > i.numericBefore);
    const last = items.filter((i) => i.cls === 'HARD').pop();
    mechanism = grew ? `facility floor space ${grew.before} → ${grew.after}` : last ? `facility floor space ${last.after}` : 'floor-space evidence on file';
    stage = grew ? 'Facility expanded (floor space)' : 'Floor space disclosed';
    state = grew ? 'VALIDATED' : 'IDENTIFIED';
    runway = { ok: false, text: 'Floor space is not production capacity — its use is not measured by a utilisation figure, so no runway is evidenced from it.' };
    if (grew) baRow('Floor space', grew.before!, grew.after!, '↑', grew);
    grew ? happened.push(`Floor space expanded: ${grew.before} → ${grew.after}`) : notYet.push('Floor-space expansion quantified');
    notYet.push('Revenue or output attributed to the expanded facility');
    nextEvidence = 'Revenue or output attributed to the expanded facility';
    confirmWith = 'revenue or output attributed to the expanded facility';
    invalidateIf = 'the expanded facility stays under-used or no attributable revenue follows';
  } else if (kind === 'CAPACITY_RAMP') {
    const util = series(items, 'utilisation');
    // "between 60% and 85%" — the upper bound, so runway is never overstated.
    const pctMax = (t: string | null | undefined) => { const all = Array.from(String(t || '').matchAll(/(\d+(?:\.\d+)?)\s*%/g)).map((m) => Number(m[1])); return all.length ? Math.max(...all) : null; };
    const utilNow = util.length ? pctMax(util[util.length - 1].after) : null;
    const utilThen = util.length >= 2 ? pctOf(util[0].after) : null;
    const utilItem = util.length ? util[util.length - 1] : null;
    const factor = !!utilItem && FACTOR_UTIL.test(`${utilItem.text} ${utilItem.sources.map((x) => x.quote || '').join(' ')}`);
    const add = items.find((i) => (i.metric === 'capacity' || i.metric === 'capacity_addition') && i.cls === 'HARD' && i.before && i.numeric != null && i.numericBefore != null && i.numeric > i.numericBefore);
    const addPct = add ? Math.round(((add.numeric! - add.numericBefore!) / add.numericBefore!) * 100) : null;
    const addOnly = items.find((i) => i.metric === 'capacity_addition' && i.cls === 'HARD');
    const capNow = series(items, 'capacity').pop();
    const addVsBase = !add && addOnly && capNow && addOnly.numeric != null && capNow.numeric && unitKey(addOnly.after) && unitKey(addOnly.after) === unitKey(capNow.after)
      ? Math.round((addOnly.numeric / capNow.numeric) * 100) : null;
    // Lifecycle words come only from NON-forward rows: "Commissioning: December
    // 2026 (guidance)" is a plan, not a commissioned plant (GPPL). (zzz784)
    const lifeRows = items.filter((i) => i.cls !== 'FORWARD' && /capex_status|commissioning|new_plant|capex_earning|capex/.test(i.metric));
    const lifeTxt = lifeRows.map((i) => i.text).join(' ; ');
    const wordsTrusted = ctx.capexOperating !== false;   // the card says nothing is built → words cannot lift the stage
    const vol = series(items, 'volume');
    const volUp = items.some((i) => i.metric === 'volume' && isMech(i));
    const volHard = items.some((i) => i.metric === 'volume' && i.cls === 'HARD');
    const ceHard = items.filter((i) => i.metric === 'capex_earning' && i.cls === 'HARD');
    const earning = ceHard.some((i) => /revenue|contribut|sales|turnover|generat/i.test(i.text) && !/not yet|yet to|will|expected/i.test(i.text));
    const marginIn = ceHard.some((i) => /ebitda|margin|profit/i.test(i.text) && !/not yet|yet to|will|expected|pending/i.test(i.text));
    // A capacity row whose own sentence says the plant is in use ("commissioned
    // & put to use in Q1 FY27", "~5100 GPUs live") evidences running. (zzz784)
    const capQuotes = items.filter((i) => (i.metric === 'capacity' || i.metric === 'capacity_addition') && i.cls === 'HARD')
      .map((i) => i.sources.map((x) => x.quote || '').join(' ')).join(' ; ');
    const quoteRunning = /put to use|into operation|\blive\b|\boperational\b|commenced (?:commercial )?(?:production|operations)|started production/i.test(capQuotes)
      && !/to be (?:put|commissioned)|will be|expected/i.test(capQuotes.slice(0, 400));
    const textRunning = wordsTrusted && quoteRunning || wordsTrusted && /commercial production|commenced (commercial )?(production|operations)|started (commercial )?production|production (started|commenced)|\boperational\b|now running|put to use|went live|generat\w* (revenue|power)/i.test(lifeTxt);
    const textCommissioned = wordsTrusted && /\bcommissioned\b|\bcommissioning of\b.*\b(done|complete)|capacity (?:expanded|added)/i.test(lifeTxt) && !/under construction|to be commissioned|will be|expected/i.test(lifeTxt);
    const underConstruction = /under[_ ]construction|construction|installation|civil work|erection|capital work|\bcwip\b|\bwip\b|\bspent\b|incurred|deployed/i.test(lifeTxt);

    // ── THE HIGHEST STAGE THE FILED EVIDENCE REACHES.
    const ev: Partial<Record<CapacityStage, string>> = {};
    const ann = items.find((i) => /^(capex|new_plant|capex_status)$/.test(i.metric) || ((i.metric === 'capacity' || i.metric === 'capacity_addition') && i.cls === 'FORWARD'));
    if (ann) ev.ANNOUNCED = clip(ann.text, 90);
    if (underConstruction) ev.UNDER_CONSTRUCTION = clip(lifeRows.find((i) => /construction|install|wip|spent|incurred|deployed/i.test(i.text))?.text || lifeTxt, 90);
    if (textCommissioned || add || addOnly) ev.COMMISSIONED = add ? `capacity ${add.before} → ${add.after}` : addOnly ? `capacity added ${addOnly.after}` : 'commissioned (stated in the documents)';
    // Company-wide volume is a rung of THIS ladder only when a capacity is on
    // file for it to come from (GPPL: liquids volume grew while the new berth
    // is still under construction). (zzz784)
    const capInPlace = !!(add || addOnly || capNow || textCommissioned || textRunning || utilNow != null);
    if (textRunning || utilNow != null || (volHard && capInPlace)) ev.RUNNING = utilNow != null ? `utilisation ${utilNow}%${factor ? ' (load factor)' : ''}` : volHard ? `output volume ${vol[vol.length - 1]?.after ?? 'disclosed'}` : quoteRunning && !/commercial production|commenced (commercial )?(production|operations)/i.test(lifeTxt) ? 'in use (stated in the documents)' : 'commercial production (stated in the documents)';
    if (utilNow != null && utilThen != null && utilNow > utilThen + 1) ev.UTILISATION_RAMP = `utilisation ${utilThen}% → ${utilNow}%`;
    if (volUp && capInPlace) ev.VOLUME_RAMP = 'volume rising';
    if (earning) ev.REVENUE_CONTRIBUTION = 'revenue contribution from the capacity disclosed';
    if (marginIn) ev.MARGIN_CONTRIBUTION = 'margin / EBITDA contribution disclosed';
    if (utilNow != null && utilNow >= 90 && !factor && !add && (addVsBase == null || addVsBase < 15)) ev.STEADY_STATE = `utilisation ${utilNow}% — existing capacity nearly full`;
    // The card's normalized capex build state is the same evidence here: a
    // project it calls under construction or built is on this ladder too, so
    // Special Focus and the card never disagree. (zzz784)
    const cb = ctx.capexBuild;
    if (cb) {
      const uc = cb.projects.filter((x) => x.build === 'under construction');
      const op = cb.projects.filter((x) => /commissioned|commercial production|operating/.test(x.build));
      if (uc.length && !ev.UNDER_CONSTRUCTION) ev.UNDER_CONSTRUCTION = `capex: ${uc.map((x) => x.name).join('; ')} — under construction`;
      if (op.length && !ev.COMMISSIONED) ev.COMMISSIONED = `capex: ${op.map((x) => `${x.name} — ${x.build}`).join('; ')}`;
      if (op.some((x) => x.build !== 'commissioned') && !ev.RUNNING) ev.RUNNING = `capex: ${op.filter((x) => x.build !== 'commissioned').map((x) => `${x.name} — ${x.build}`).join('; ')}`;
    }
    const reached = CAPACITY_STAGES.filter((st) => ev[st]);
    const highest: CapacityStage | null = reached.length ? reached[reached.length - 1] : null;
    const hr = stageRank(highest);
    if (cb && hr >= stageRank('COMMISSIONED')) {
      const pending = cb.projects.filter((x) => x.build === 'under construction' || x.build === 'announced');
      if (pending.length) capexNote = `Also on the card — separate capex, not this capacity: ${pending.map((x) => `${x.name} (${x.build})`).join('; ')}; its next rung is ${pending.some((x) => x.build === 'under construction') ? 'commissioning' : 'construction'}.`;
    }
    stage = highest ? CAPACITY_STAGE_LABEL[highest] : 'No stage evidenced';

    const utilWord = utilNow != null ? `utilisation ${utilThen != null ? `${utilThen}% → ` : ''}${utilNow}%${factor ? ' (load factor)' : ''}` : null;
    mechanism = [add ? `capacity ${add.before} → ${add.after}` : addOnly ? `capacity added ${addOnly.after}` : capNow ? `installed capacity ${capNow.after}` : null,
      textRunning ? (quoteRunning && !/commercial production|commenced (commercial )?(production|operations)/i.test(lifeTxt) ? 'in use (stated in the documents)' : 'in commercial production') : hr >= stageRank('COMMISSIONED') && textCommissioned ? 'commissioned' : hr === stageRank('UNDER_CONSTRUCTION') ? 'under construction' : null,
      utilWord, ev.VOLUME_RAMP ? 'volume rising' : null, earning ? 'revenue contribution disclosed' : null, marginIn ? 'margin contribution disclosed' : null].filter(Boolean).join(' → ') || 'capacity evidence on file';
    // Lifecycle state, from the same ladder.
    if (utilNow != null && utilThen != null && utilNow < utilThen - 3) state = 'STALLING';
    else if (highest === 'STEADY_STATE') state = 'MATURE';
    else if (hr >= stageRank('REVENUE_CONTRIBUTION') || ev.UTILISATION_RAMP) state = 'SCALING';
    else if (ev.VOLUME_RAMP || textRunning) state = 'RAMPING';
    else if (hr >= stageRank('COMMISSIONED')) state = 'VALIDATED';
    // ── HEADROOM, SAID AS HEADROOM — NEVER AS RUNWAY.               (zzz788)
    // Unused capacity is said in percentage points of utilisation on the
    // current installed-capacity basis, never converted into physical
    // capacity (zzz784), and never counted as runway on its own.
    const head = utilNow != null && !factor && utilNow < 100 ? pp1(100 - utilNow) : null;
    headroom = head != null && utilNow! < 90 ? `Capacity headroom: Utilisation ${utilNow}% — ${head} percentage points available on the current installed-capacity basis.`
      : utilNow == null && add && (addPct ?? 0) >= 20 ? `Capacity headroom: capacity up ${addPct}% (${add.before} → ${add.after}); utilisation on the new base not yet disclosed.`
        : utilNow == null && addVsBase != null && addVsBase >= 15 ? `Capacity headroom: addition of ${addOnly!.after} ≈ ${addVsBase}% of installed capacity.`
          : null;
    // Runway needs CONTINUATION: the capacity's own volume / utilisation rising,
    // or continuing demand anywhere in the company's filed evidence.
    const own = ev.VOLUME_RAMP ? `recurring volume growth on the installed base (${clip(items.find((i) => i.metric === 'volume' && isMech(i))?.text || 'volume rising', 80)})`
      : ev.UTILISATION_RAMP ? `utilisation rising ${utilThen}% → ${utilNow}% on a comparable installed-capacity basis` : null;
    continuation = own || demandContinuation(all, ctx.quarterRevenueCr);
    const nearlyFull = utilNow != null && utilNow >= 90 && !factor;
    if (nearlyFull && !add && !(addVsBase != null && addVsBase >= 15)) runway = { ok: false, text: `Utilisation ${utilNow}% — existing capacity is nearly full; the next leg needs new capacity${addOnly ? ` (addition on file: ${addOnly.after}${addVsBase != null ? `, ≈${addVsBase}% of the base` : ''})` : ''}.` };
    else if (continuation) runway = { ok: true, text: `Continuation evidence: ${continuation}${factor ? `; ${utilNow}% is a load / utilisation FACTOR, bounded by resource availability — no headroom to 100% is computed from it` : ''}.` };
    else if (utilNow != null && factor) runway = { ok: false, text: `Not evidenced — ${utilNow}% is a load / utilisation FACTOR, bounded by resource availability rather than by 100%, so no headroom is computed from it${addOnly ? `; capacity added (${addOnly.after}) is capacity in place, not demand` : ''}. No contracted offtake, order book or volume growth is on file.` };
    else runway = { ok: false, text: `Not evidenced — ${headroom ? 'unused capacity is headroom, not runway' : 'capacity in place is not runway'}: no continuing order book, customer ramp, recurring volume growth or contracted demand is on file${volFlat ? ' (volume is flat)' : ''}.` };
    rowFor('capacity', 'Capacity'); rowFor('capacity_addition', 'Capacity added'); rowFor('utilisation', 'Utilisation'); rowFor('volume', 'Volume');
    // Happened = the evidenced rungs; not yet = LATER rungs only. (zzz784)
    for (const st of reached) happened.push(`${CAPACITY_STAGE_LABEL[st]}: ${ev[st]}`);
    const LATER: Array<[CapacityStage, string]> = [
      ['UNDER_CONSTRUCTION', 'Construction / capex spend on the announced capacity'],
      ['COMMISSIONED', 'Commissioning of the capacity'],
      ['RUNNING', 'Commercial production / first output from the capacity'],
      ['UTILISATION_RAMP', 'Utilisation rising on a comparable installed-capacity basis'],
      ['VOLUME_RAMP', 'Volume growth from the capacity'],
      ['REVENUE_CONTRIBUTION', 'Revenue contribution from the new capacity disclosed'],
      ['MARGIN_CONTRIBUTION', 'Margin / EBITDA contribution from the new capacity disclosed'],
    ];
    for (const [st, t] of LATER) if (stageRank(st) > hr && !(highest === 'STEADY_STATE')) notYet.push(t);
    // ── NEXT EVIDENCE, MECHANICALLY FROM THE HIGHEST RUNG.
    const lastU = utilNow != null ? `${utilNow}%${factor ? ' load factor' : ''}` : null;
    nextEvidence = highest == null ? 'A filed capacity figure (installed or added)'
      : highest === 'ANNOUNCED' ? 'Construction start or capex spend on the announced capacity'
        : highest === 'UNDER_CONSTRUCTION' ? 'Commissioning of the capacity under construction'
          : highest === 'COMMISSIONED' ? 'Commercial production from the commissioned capacity, then its first utilisation figure'
            : highest === 'RUNNING' ? (lastU ? `Next disclosed utilisation on a comparable installed-capacity basis (last ${lastU}), plus volume or revenue contribution from the new capacity where disclosed`
              : 'First disclosed utilisation (or output volume) on the installed base — the capacity is already running')
              : highest === 'UTILISATION_RAMP' ? `Next utilisation above ${lastU} on the same installed-capacity basis, and volume / revenue contribution from the new capacity`
                : highest === 'VOLUME_RAMP' ? `Revenue contribution from the new capacity disclosed${lastU ? `, with the next utilisation above ${lastU} on the same installed-capacity basis` : ''}`
                  : highest === 'REVENUE_CONTRIBUTION' ? `Margin / EBITDA contribution attributed to the new capacity${lastU ? `; next utilisation on a comparable basis (last ${lastU})` : ''}`
                    : highest === 'MARGIN_CONTRIBUTION' ? 'Utilisation reaching steady state with the margin holding'
                      : ev.UNDER_CONSTRUCTION ? `Commissioning of the further capacity under construction (${ev.UNDER_CONSTRUCTION.replace(/^capex: /, '')}) — current capacity nearly full`
                        : 'A further capacity addition (current capacity nearly full)';
    // A management target is offered only for a LATER rung, same unit and
    // bigger for a capacity figure. (zzz784)
    const targetStage = (i: PersistItem): CapacityStage | null => {
      const t = `${i.metric} ${i.text}`;
      if (i.metric === 'utilisation') {
        const v = pctMax(i.after);
        if (v == null || !PCT.test(i.after || '') || (utilNow != null && v <= utilNow)) return null;
        return 'UTILISATION_RAMP';
      }
      if (i.metric === 'capacity' || i.metric === 'capacity_addition') {
        const base = add || capNow;
        if (i.numeric != null && base && base.numeric != null && (unitKey(i.after) !== unitKey(base.after) || i.numeric <= base.numeric)) return null;
        return highest === 'STEADY_STATE' ? 'STEADY_STATE' : 'ANNOUNCED';   // a new tranche is later only once this one is full
      }
      if (i.metric === 'capex_earning') return /margin|ebitda|profit/i.test(t) ? 'MARGIN_CONTRIBUTION' : 'REVENUE_CONTRIBUTION';
      if (/commercial production|commercial operations/i.test(t)) return 'RUNNING';
      if (/commission|complet|come on stream|operational|phase/i.test(t)) return 'COMMISSIONED';
      return null;
    };
    const tgt = forward.map((i) => ({ i, st: targetStage(i) })).filter((x) => x.st && (stageRank(x.st) > hr || (x.st === 'STEADY_STATE' && highest === 'STEADY_STATE')))
      .sort((a, b) => stageRank(a.st) - stageRank(b.st))[0];
    managementTarget = tgt ? targetText(tgt.i) : null;
    confirmWith = 'utilisation rising on the new base, volume growth, and a disclosed revenue / EBITDA contribution';
    invalidateIf = 'utilisation falls, volume declines, or the new capacity stays idle / is delayed';
  } else if (kind === 'ORDER_VISIBILITY') {
    const ob = series(items, 'order_book').filter((i) => CUR.test(i.after || ''));
    const btb = items.find((i) => i.metric === 'book_to_bill' && i.cls === 'HARD');
    const btbX = btb ? Number((/(\d+(?:\.\d+)?)\s*x/i.exec(btb.after || '') || [])[1]) : NaN;
    const sameMoney = (i: PersistItem) => CUR.test(i.before || '') && CUR.test(i.after || '');
    const obUp = items.find((i) => i.metric === 'order_book' && i.cls === 'HARD' && sameMoney(i) && i.numericBefore != null && i.numeric != null && i.numeric > i.numericBefore);
    const obDown = items.find((i) => i.metric === 'order_book' && i.cls === 'HARD' && sameMoney(i) && i.numericBefore != null && i.numeric != null && i.numeric < i.numericBefore * 0.97)
      || (ob.length >= 2 && ob[ob.length - 1].numeric! < ob[0].numeric! * 0.97 ? ob[ob.length - 1] : null);
    const obSeriesUp = ob.length >= 2 && ob[ob.length - 1].numeric! > ob[0].numeric! * 1.03;
    const intake = items.filter((i) => i.metric === 'order_intake' && i.cls === 'HARD');
    const multiYear = items.some((i) => /\b(\d+|two|three|four|five)[- ](year|yr)s?\b|multi[- ]year|over \d{2,} months|till (fy|20)\d{2}/i.test(i.text));
    const repeat = intake.length >= 2 || items.some((i) => /repeat|follow[- ]on|additional order/i.test(i.text));
    // Order book against FILED revenue (the latest quarter × 4) — visibility, not upside.
    const obLatest = ob.length ? ob[ob.length - 1] : null;
    const obCr = obLatest && obLatest.numeric != null && MONEY.test(obLatest.after || '') ? obLatest.numeric / 1e7 : null;
    const annualRev = ctx.quarterRevenueCr && ctx.quarterRevenueCr > 0 ? ctx.quarterRevenueCr * 4 : null;
    const coverage = obCr && annualRev ? Math.round((obCr / annualRev) * 10) / 10 : null;
    // zzz788: the LATEST disclosed order book, in the card's format (₹… Cr).
    const R = rupeeCr;
    mechanism = [ob.length ? `order book ${R(ob[ob.length - 1].after)}` : null, obUp ? `up from ${R(obUp.before)}` : obSeriesUp ? `up from ${R(ob[0].after)}` : null,
      coverage != null ? `≈${coverage}× annual revenue` : null, Number.isFinite(btbX) ? `book-to-bill ${btbX}x` : null, intake.length ? `order intake ${R(intake[intake.length - 1].after)}` : null, multiYear ? 'multi-year execution' : null, repeat ? 'repeat orders' : null].filter(Boolean).join(' → ') || 'order evidence on file';
    if (obDown) state = 'WEAKENING';
    else if ((obUp || obSeriesUp) && (repeat || multiPeriod)) state = 'SCALING';
    else if (obUp || obSeriesUp || (Number.isFinite(btbX) && btbX >= 1.2) || (coverage != null && coverage >= 1.5)) state = 'VALIDATED';
    else if (ob.length && ob.length >= 2) state = 'MATURE';
    if ((Number.isFinite(btbX) && btbX >= 1.2) || obUp || obSeriesUp || multiYear || (coverage != null && coverage >= 1.5)) runway = { ok: true, text: [coverage != null && coverage >= 1.5 ? `order book ${R(obLatest!.after)} ≈ ${coverage}× annual revenue (latest quarter × 4)` : null, Number.isFinite(btbX) ? `Book-to-bill ${btbX}x — orders arriving faster than revenue is billed` : null, obUp ? `order book ${R(obUp.before)} → ${R(obUp.after)}` : obSeriesUp ? `order book ${R(ob[0].after)} → ${R(ob[ob.length - 1].after)}` : null, multiYear ? 'execution spans more than one year' : null].filter(Boolean).join('; ') + '.' };
    else if (ob.length) runway = { ok: false, text: `Order book ${R(ob[ob.length - 1].after)} on file, but no growth, book-to-bill or execution period that shows visibility beyond the current run-rate.` };
    rowFor('order_book', 'Order book'); rowFor('order_intake', 'Order intake'); rowFor('book_to_bill', 'Book-to-bill');
    ob.length ? happened.push(`Order book disclosed: ${R(ob[ob.length - 1].after)}`) : notYet.push('Order book disclosed');
    (obUp || obSeriesUp) ? happened.push('Order book grew') : notYet.push('Order book growth shown over two readings');
    repeat ? happened.push('Repeat / continuing order intake') : notYet.push('Repeat orders');
    notYet.push('Conversion of the order book into revenue shown quarter by quarter');
    // A target is a LATER milestone only when it is above where the order
    // book already is (MTARTECH "INR5,000 cr by year-end" under ₹5,143 cr). (zzz784)
    const f0 = fwdText(/order/i);
    const f = f0 && !(obLatest && obLatest.numeric != null && f0.numeric != null && CUR.test(f0.after || '') && f0.numeric <= obLatest.numeric) ? f0 : null;
    nextEvidence = ob.length ? `Next disclosed order book above ${R(ob[ob.length - 1].after)}, with revenue conversion` : 'First disclosed order book figure';
    managementTarget = f ? targetText(f) : null;
    confirmWith = 'order book growing while revenue grows (conversion), book-to-bill ≥ 1, repeat orders';
    invalidateIf = 'order book declines, orders are cancelled or deferred, or execution slips';
  } else if (kind === 'CUSTOMER_RAMP') {
    const qual = items.some((i) => /qualif|approv|audit|certif|empanel|vendor/i.test(`${i.metric} ${i.text}`));
    const order = items.some((i) => /order|contract|supplies (started|commenced)|lta|long[- ]term agreement|onboarded/i.test(i.text) && i.cls !== 'FORWARD');
    const repeat = items.some((i) => /repeat|follow[- ]on|additional (order|product)|second (order|product)|expanded/i.test(i.text));
    const named = hard.length > 0;
    mechanism = [qual ? 'qualification / approval' : null, order ? 'commercial order or supplies' : null, repeat ? 'repeat / expansion' : null].filter(Boolean).join(' → ') || 'customer evidence on file';
    state = repeat ? 'RAMPING' : order ? 'VALIDATED' : 'IDENTIFIED';
    if (order && (repeat || named)) runway = { ok: true, text: `Customer chain has reached ${repeat ? 'repeat / expanded orders' : 'a commercial order'} — volume can build from here.` };
    qual ? happened.push('Qualification / approval') : notYet.push('Qualification');
    order ? happened.push('First commercial order / supplies') : notYet.push('First commercial order');
    repeat ? happened.push('Repeat or expanded orders') : notYet.push('Repeat order');
    nextEvidence = !order ? 'First commercial order from the qualified customer' : !repeat ? 'Repeat order or a second product / facility qualified' : 'Volume from the customer disclosed';
    confirmWith = 'a commercial order after the qualification, then a repeat order';
    invalidateIf = 'no order follows the qualification, or the customer is lost';
  } else if (kind === 'GEOGRAPHY') {
    const g = hard.find((i) => (pctOf(i.text) ?? 0) >= 20);
    mechanism = g ? g.text : items[0].text;
    state = g ? 'VALIDATED' : 'IDENTIFIED';
    if (g) runway = { ok: true, text: `${clip(g.text, 100)} — a new market still being penetrated.` };
    (g ? happened : notYet).push('Export / new-geography growth quantified');
    nextEvidence = 'Export share of revenue disclosed and rising';
    confirmWith = 'export share rising over two periods';
    invalidateIf = 'export growth reverses';
  } else {
    // MIX / PRICING — structural only when quantified and repeated.
    mechanism = items.map((i) => clip(i.text, 90)).slice(0, 2).join(' ; ');
    state = 'IDENTIFIED';
    runway = { ok: hard.length > 0 && multiPeriod, text: hard.length > 0 && multiPeriod ? 'Mix / pricing improvement quantified in more than one period.' : 'A single period of mix / pricing improvement — persistence not shown.' };
    notYet.push('The same mix / pricing gain shown again next period');
    nextEvidence = 'Value-added / premium share of revenue disclosed again next period';
    confirmWith = 'the mix share rising again, with margins holding when input costs change';
    invalidateIf = 'margin reverts when commodity or inventory effects unwind';
  }

  // ── ONE NEXT-EVIDENCE LINE: evidence first, a later-stage target after it,
  // labelled as a milestone. (zzz784)
  nextMilestone = [nextEvidence, managementTarget].filter(Boolean).join(' · ') || null;
  if (!stage) stage = state.charAt(0) + state.slice(1).toLowerCase();

  // ── Confidence — evidence only; output never counts. ─────────────────────
  const temporary = kind === 'MIX_PRICING' || kind === 'CAPACITY_RAMP' ? ctx.temporary : [];
  let confidence: PersistConfidence;
  const n = mech.length;
  if (kind === 'MIX_PRICING' && (temporary.length || !multiPeriod)) confidence = 'TEMPORARY_UNCERTAIN';
  else if (state === 'WEAKENING' || state === 'STALLING') confidence = n >= 2 ? 'MEDIUM' : 'EARLY';
  else if (n >= 3 && metrics.size >= 2 && runway.ok && (multiPeriod || metrics.size >= 3) && state !== 'IDENTIFIED') confidence = 'HIGH';
  else if (runway.ok && ((n >= 2 && (metrics.size >= 2 || multiPeriod)) || (n >= 1 && kind === 'ORDER_VISIBILITY' && /book-to-bill|→|annual revenue|execution spans/.test(runway.text)))) confidence = 'MEDIUM';
  else confidence = 'EARLY';
  if (temporary.length && confidence === 'HIGH') confidence = 'MEDIUM';                // inventory / one-off noise caps it

  const dated = items.map((i) => i.date).filter(Boolean).sort() as string[];
  const latest = dated[dated.length - 1] || null;
  const ageDays = latest ? (Date.parse(ctx.today) - Date.parse(latest)) / 86_400_000 : 999;
  const duration = (() => {
    const f = forward.find((i) => /\bby (fy|20)\d{2}|\b20[3-4]\d\b|over (the next )?\w+ years?|\d+ years?/i.test(i.text));
    if (!f) return 'Duration: Unknown';
    const m = /\bby (fy\s?\d{2,4}|20\d{2})|\b(20[3-4]\d)\b|over (the next )?\w+ years?|\d+[- ]years?/i.exec(f.text);
    return `Stated horizon: ${m ? m[0] : 'see source'} — management target, not a result (${f.sources[0]?.name || 'source'})`;
  })();

  const evidence = [...hard, ...remarks].sort((a, b) => (a.cls === b.cls ? String(b.date).localeCompare(String(a.date)) : a.cls === 'HARD' ? -1 : 1));
  const id = `${ctx.ticker.toUpperCase()}:${kind}`;
  // ── zzz787: WHAT THE SPECIAL FOCUS GATE READS BEYOND CONFIDENCE ──────────
  // Commissioning alone (MILKYMIST's commissioned plant) is a persistent
  // catalyst CANDIDATE, never Special Focus: it needs demand (orders /
  // offtake), usage (utilisation / volume / revenue), a capacity runway behind
  // orders, or evidence across two or more independent periods.
  const hardAll = all.filter((i) => i.cls === 'HARD');
  const demandEv = hardAll.some((i) => /^(order_book|order_intake|book_to_bill|revenue_visibility)$/.test(i.metric))
    || hardAll.some((i) => i.metric === 'new_customer' && /order|contract|supply|offtake|off-take/i.test(i.text))
    || all.some((i) => i.cls !== 'FORWARD' && /offtake|off-take|sold out|fully booked|orders? in hand|order backlog/i.test(`${i.text} ${i.sources.map((x) => x.quote || '').join(' ')}`));
  const usageEv = hardAll.some((i) => (i.metric === 'utilisation' && isUtilisationReading(i.after, i.sources[0]?.quote)) || i.metric === 'volume'
    || (i.metric === 'capex_earning' && /revenue|contribut|sales|turnover/i.test(i.text) && !/not yet|yet to|will|expected/i.test(i.text)));
  const capInPlace = all.some((i) => i.cls === 'HARD' && ((i.metric === 'capacity' || i.metric === 'capacity_addition') && i.capClass !== 'NETWORK' && i.capClass !== 'FLOOR_SPACE' && i.capClass !== 'MONEY' || i.metric === 'utilisation'));
  const commissionedEv = kind === 'CAPACITY_RAMP' && variant === 'PRODUCTION' && /Commissioned|Production \/ running|Utilisation ramp|Volume ramp|Revenue contribution|Margin contribution|Steady state/.test(stage);
  const mechPeriods = new Set(mech.map((i) => i.period).filter(Boolean) as string[]).size;
  let dateClusters = 0; { let last = -Infinity; for (const d of dates) { const t = Date.parse(d); if (Number.isFinite(t) && t - last >= 60 * 86_400_000) { dateClusters++; last = t; } } }
  const evidencePeriods = Math.max(mechPeriods, dateClusters);
  const pc: PersistentCatalyst = {
    id, ticker: ctx.ticker.toUpperCase(), kind, label: variant === 'NETWORK' ? 'Network expansion (stores)' : variant === 'FLOOR_SPACE' ? 'Facility expansion (floor space)' : KIND_LABEL[kind], mechanism, state, confidence, runway,
    evidence, forward, beforeAfter, happened, notYet, nextMilestone, confirmWith, invalidateIf, duration,
    stage, nextEvidence, managementTarget, variant, capexNote, headroom, continuation,
    sourceQuality: `${hard.length} filed figure${hard.length === 1 ? '' : 's'} · ${remarks.length} management remark${remarks.length === 1 ? '' : 's'}${forward.length ? ` · ${forward.length} target${forward.length === 1 ? '' : 's'} (milestones, not evidence)` : ''}`,
    firstEvidenceDate: dated[0] || null, latestEvidenceDate: latest, freshness: ageDays <= 200 ? 'CURRENT' : 'HISTORICAL',
    periods, hardCount: mech.length, distinctMetrics: metrics.size, temporarySignals: temporary,
    origins: [...new Set([...ctx.origins, ...(items.some((i) => i.origin === 'gainer') ? ['gainers' as const] : [])])],
    specialFocus: false, why: [], toQualify: [], nearMiss: false,
    evidencePeriods, gate: { inService: commissionedEv, demand: demandEv, usage: usageEv, capacityInPlace: capInPlace, orderCoverage: kind === 'ORDER_VISIBILITY' && /annual revenue \(latest quarter × 4\)/.test(runway.text) }, sfBasis: null,
    eventIds: [...new Set(items.map((i) => i.eventId).filter(Boolean) as string[])],
  };
  const sf = specialFocusGate(pc, ctx.thesisStatus);
  pc.specialFocus = sf.ok; pc.why = sf.why; pc.sfBasis = sf.ok ? specialFocusBasis(pc) : null;
  if (!pc.specialFocus) {
    const q: string[] = [];
    const where = pc.periods.length <= 1 ? ' — usually in the prior or next quarter\'s documents' : '';
    if (pc.hardCount < 2) q.push(`a second filed mechanism figure (${kind === 'ORDER_VISIBILITY' ? 'order book, order intake or book-to-bill' : kind === 'CUSTOMER_RAMP' ? 'order value or supply volume' : 'utilisation, volume or commissioning'})${where}`);
    if (kind === 'CAPACITY_RAMP' && pc.state === 'IDENTIFIED') q.push('commissioning / production evidence for the added capacity');
    if (kind === 'CUSTOMER_RAMP' && pc.state === 'IDENTIFIED') q.push('a commercial order after the qualification');
    if (!pc.runway.ok) q.push(kind === 'CAPACITY_RAMP' ? 'continuation evidence — recurring volume growth, utilisation rising on the same basis, a growing order book, repeat customer orders or contracted demand (unused capacity is headroom, not runway)'
      : kind === 'ORDER_VISIBILITY' ? 'order book growth over two readings, book-to-bill, or order book against revenue' : 'evidence of continuing volume');
    if (pc.freshness === 'HISTORICAL') q.push('a current-period read');
    if (pc.temporarySignals.length) q.push('the same gain repeating without the one-off');
    // zzz787: what lifts a CANDIDATE to Special Focus.
    if (!specialFocusBasis(pc)) q.push(kind === 'CAPACITY_RAMP' && variant === 'PRODUCTION' ? 'demand evidence (orders / offtake) or a utilisation / revenue figure for the capacity — a plant in service alone is not enough'
      : kind === 'ORDER_VISIBILITY' || kind === 'CUSTOMER_RAMP' ? 'capacity in place to execute the orders (installed capacity or utilisation on file), or a second evidence period'
        : 'the same evidence in a second, independent period');
    if (!q.length) q.push(String(pc.why[pc.why.length - 1] || '').replace(/^Not Special Focus:\s*/, ''));
    pc.toQualify = [...new Set(q)].filter(Boolean);
    // A near miss is a VALIDATED-or-better mechanism (or a medium-evidence one)
    // missing one or two named pieces — not every early mention.
    pc.nearMiss = ctx.thesisStatus !== 'BROKEN' && kind !== 'MIX_PRICING' && pc.confidence !== 'TEMPORARY_UNCERTAIN'
      && pc.hardCount >= 1 && pc.freshness === 'CURRENT' && !['STALLING', 'WEAKENING', 'MATURE'].includes(pc.state)
      && (pc.confidence === 'MEDIUM' || pc.confidence === 'HIGH' || (kind !== 'GEOGRAPHY' && ['VALIDATED', 'RAMPING', 'SCALING'].includes(pc.state)))
      && pc.toQualify.length <= 2;
  }
  return pc;
}

// ── 6. SPECIAL FOCUS — a research allocation, never a recommendation ──────
export function specialFocusGate(pc: PersistentCatalyst, thesisStatus?: string | null): { ok: boolean; why: string[] } {
  const why: string[] = [];
  const no = (r: string) => ({ ok: false, why: [...why, `Not Special Focus: ${r}`] });
  why.push(`${CONFIDENCE_LABEL[pc.confidence]} — ${pc.hardCount} filed figure${pc.hardCount === 1 ? '' : 's'} across ${pc.distinctMetrics} independent metric${pc.distinctMetrics === 1 ? '' : 's'}${pc.periods.length > 1 ? `, ${pc.periods.length} periods` : ''}.`);
  if (thesisStatus === 'BROKEN') return no('the thesis is broken.');
  if (pc.hardCount < 1) return no('no hard (filed, quantified) evidence — remarks alone do not qualify.');
  // zzz788: validated evidence without continuation is a CANDIDATE — said so.
  if (pc.confidence === 'EARLY' && ['VALIDATED', 'RAMPING', 'SCALING'].includes(pc.state) && !pc.runway.ok) return no(`a persistent catalyst candidate, not Special Focus yet — evidence validated, persistence not shown (${pc.runway.text})`);
  if (pc.confidence === 'EARLY' || pc.confidence === 'TEMPORARY_UNCERTAIN') return no(`${CONFIDENCE_LABEL[pc.confidence].toLowerCase()}.`);
  if (pc.kind === 'MIX_PRICING' && pc.confidence !== 'HIGH') return no('mix / pricing needs repeated, quantified evidence.');
  if (!pc.runway.ok) return no(`no evidence-supported runway (${pc.runway.text})`);
  if (pc.state === 'DISPROVED' || pc.state === 'COMPLETED') return no(`catalyst ${pc.state.toLowerCase()}.`);
  if (pc.state === 'STALLING' || pc.state === 'WEAKENING') return no(`the mechanism is ${pc.state.toLowerCase()} (${pc.mechanism}).`);
  if (pc.state === 'IDENTIFIED') return no('identified but not yet validated — no commissioning, production, order growth or commercial order evidenced yet.');
  if (pc.freshness === 'HISTORICAL') return no('the evidence is historical — nothing current on file.');
  // zzz787 — STRICTER THAN A PERSISTENT CATALYST CANDIDATE.
  const basis = specialFocusBasis(pc);
  if (!basis) return no('a persistent catalyst candidate, not Special Focus yet — Special Focus needs commissioned capacity with demand evidence, commissioned capacity with utilisation / revenue evidence, orders with a capacity runway, or evidence across two or more independent periods.');
  why.push(`Qualifies because: ${basis}.`);
  why.push(`Mechanism: ${pc.mechanism}.`);
  why.push(`Runway: ${pc.runway.text}`);
  if (pc.nextMilestone) why.push(`Next milestone: ${pc.nextMilestone}.`);
  return { ok: true, why };
}

/** zzz787: the evidence that lifts a persistent catalyst CANDIDATE to Special
 *  Focus, or null. Commissioning alone never qualifies. Price never enters. */
export function specialFocusBasis(pc: PersistentCatalyst): string | null {
  const g = pc.gate || { inService: false, demand: false, usage: false, capacityInPlace: false, orderCoverage: false };
  const periods = pc.evidencePeriods ?? pc.periods.length;
  if (periods >= 2) return `evidence across ${periods} independent periods`;
  if (pc.kind === 'CAPACITY_RAMP' && g.inService && g.demand) return 'capacity in service with demand evidence (orders / offtake)';
  if (pc.kind === 'CAPACITY_RAMP' && g.inService && g.usage) return 'capacity in service with utilisation / volume / revenue evidence';
  if ((pc.kind === 'ORDER_VISIBILITY' || pc.kind === 'CUSTOMER_RAMP') && pc.runway.ok && g.capacityInPlace) return 'orders / contracts with capacity on file to execute them';
  if (pc.kind === 'ORDER_VISIBILITY' && pc.runway.ok && g.orderCoverage) return 'an order book covering 1.5× or more of filed annual revenue (a multi-period execution runway)';
  return null;
}

// ── 7. PUBLIC ENTRY POINT ─────────────────────────────────────────────────
export interface DetectInput {
  ticker: string;
  ledger?: any | null;
  assessment?: any | null;       // ThesisAssessment
  finding?: any | null;          // AI Daily Gainers Finding
  /** Latest FILED quarterly revenue (₹ Cr) — scales an order book into
   *  years of revenue. Never price. */
  quarterRevenueCr?: number | null;
  /** Other catalyst filings in the gainers window (pre-classified server-side,
   *  Finding-shaped) — a second order is a repeat order, not a new catalyst. */
  extraFindings?: any[] | null;
  /** zzz784: the card's capex chain (use-book's `capex`). When no capital project
   *  on it is built, lifecycle words cannot lift a capacity past construction. */
  capex?: { earning?: { state?: string } | null; build?: { anyOperating: boolean; projects: Array<{ name: string; build: string }> } | null } | null;
  origin: 'portfolio' | 'gainers';
  today?: string;
}

export function detectPersistentCatalysts(inp: DetectInput): PersistentCatalyst[] {
  const today = inp.today || new Date().toISOString().slice(0, 10);
  const latestPeriod = inp.ledger?.latest_period || null;
  const latestDate = iso(inp.ledger?.latest_document_date) || null;
  const items = dedupe([
    ...(inp.ledger ? itemsFromLedger(inp.ledger) : []),
    ...(inp.assessment ? itemsFromAssessment(inp.assessment, latestPeriod, latestDate) : []),
    ...(inp.finding ? itemsFromFinding(inp.finding) : []),
    ...((inp.extraFindings || []).flatMap((f) => itemsFromFinding(f))),
  ]);
  const temporary = [
    ...(inp.ledger ? temporarySignalsFromLedger(inp.ledger) : []),
    ...((inp.assessment?.mechanismEvidence || []) as Array<{ text: string }>).filter((d) => TEMPORARY.test(d.text)).map((d) => clip(d.text, 100)),
  ];
  const capexOperating = inp.capex?.build ? inp.capex.build.anyOperating : null;
  const ctx: Ctx = { ticker: inp.ticker, quarterRevenueCr: inp.quarterRevenueCr ?? null, capexOperating, capexBuild: inp.capex?.build || null, thesisStatus: inp.assessment?.status ?? null, temporary: [...new Set(temporary)], origins: [inp.origin, ...(inp.finding ? ['gainers' as const] : [])], today };
  const kinds: PersistKind[] = ['CAPACITY_RAMP', 'ORDER_VISIBILITY', 'CUSTOMER_RAMP', 'GEOGRAPHY', 'MIX_PRICING'];
  return kinds.map((k) => evaluate(k, items, ctx)).filter((x): x is PersistentCatalyst => !!x)
    .sort((a, b) => rankOf(b) - rankOf(a));
}

/** Research urgency / evidence richness — never return, never price. */
export function rankOf(pc: PersistentCatalyst): number {
  const c = { HIGH: 40, MEDIUM: 25, EARLY: 8, TEMPORARY_UNCERTAIN: 0 }[pc.confidence];
  const st = { SCALING: 12, RAMPING: 10, VALIDATED: 7, IDENTIFIED: 3, MATURE: 2, STALLING: 1, WEAKENING: 1, COMPLETED: 0, DISPROVED: 0 }[pc.state];
  return c + st + Math.min(pc.hardCount, 6) * 2 + pc.distinctMetrics * 2 + (pc.freshness === 'CURRENT' ? 5 : 0);
}

/** The strongest Special Focus catalyst for a company, if any. */
export function specialFocusOf(list: PersistentCatalyst[]): PersistentCatalyst | null {
  return list.find((p) => p.specialFocus) || null;
}

// ── 8. COMPACT SUMMARY — what a Daily Gainers finding carries ─────────────
export interface PersistSummary {
  id: string; kind: PersistKind; label: string; confidence: PersistConfidence; state: PersistState;
  specialFocus: boolean; mechanism: string; runway: string; nextMilestone: string | null;
  why: string[]; hardCount: number; ledgerBacked: boolean;
  /** zzz784 */ stage?: string; nextEvidence?: string | null; managementTarget?: string | null;
  /** zzz787: independent evidence periods (STRONG evidence needs ≥2) and why it is Special Focus, if it is. */
  periods?: number; sfBasis?: string | null;
}
export function summarizePersistence(pc: PersistentCatalyst, ledgerBacked: boolean): PersistSummary {
  return { id: pc.id, kind: pc.kind, label: pc.label, confidence: pc.confidence, state: pc.state, specialFocus: pc.specialFocus,
    mechanism: pc.mechanism, runway: pc.runway.text, nextMilestone: pc.nextMilestone, why: pc.why.slice(0, 4), hardCount: pc.hardCount, ledgerBacked,
    stage: pc.stage, nextEvidence: pc.nextEvidence, managementTarget: pc.managementTarget,
    periods: pc.evidencePeriods ?? pc.periods.length, sfBasis: pc.sfBasis ?? null };
}
// ── TRACKED POTENTIAL CATALYST — an enabling step, never Special Focus. (zzz782)
// A binding MoU / JDA / LoI (MAXESTATES "binding MoU for Ghaziabad JDA") books
// nothing yet. It is remembered as a POTENTIAL catalyst with its conversion
// chain, so the next filing (definitive agreement, approvals, launch…) can be
// checked against it. Confidence is always EARLY and it never enters the queue
// on its own: a headline project value (GDV) is never company evidence.
const CHAIN_REAL_ESTATE = ['MoU / JDA signed', 'Definitive agreement executed', 'Approvals received', 'Execution / construction start', 'Project launch', 'Bookings (pre-sales)', 'Collections', 'Revenue recognised', 'Profit'];
const CHAIN_GENERIC = ['MoU / LoI signed', 'Definitive agreement executed', 'Approvals received', 'Binding order / contract', 'Supply or production start', 'Revenue', 'Profit'];
export function trackPotentialFromFinding(f: any, today?: string): PersistentCatalyst | null {
  if (!f || f.status !== 'catalyst' || f.stage !== 'enabling') return null;
  const head = String(f.headline || '');
  const hay = `${head} ${f.evidenceQuote || ''}`;
  if (!/\bmou\b|memorandum|\bjda\b|joint development|letter of intent|\bloi\b|term sheet|in-principle|framework agreement|binding|non-binding|partnership|joint venture|\bjv\b/i.test(hay)) return null;
  const realEstate = /\bjda\b|joint development|\bgdv\b|gross development|acres?|sq\.?\s*ft|residential|township|real estate|plotted|housing/i.test(hay);
  const chain = realEstate ? CHAIN_REAL_ESTATE : CHAIN_GENERIC;
  let done = 1;
  if (/definitive agreement (signed|executed)|executed (the )?definitive/i.test(hay)) done = 2;
  if (done >= 2 && /approval(s)? (received|granted|obtained)/i.test(hay)) done = 3;
  const date = iso(f.sourceDate) || today || null;
  const src = [{ name: f.modelRead ? 'exchange filing (read)' : 'exchange filing (summary)', url: f.sourceUrl || null, date, quote: f.evidenceQuote ? clip(String(f.evidenceQuote), 260) : null }];
  const item: PersistItem = { metric: 'enabling_step', kind: 'PROJECT_PIPELINE', cls: 'FORWARD', text: clip(head, 170), before: null, after: null, numeric: null, numericBefore: null, period: null, date, sources: src, origin: 'gainer' };
  const ticker = String(f.ticker || '').toUpperCase();
  const next = chain[done] || null;
  return {
    id: `${ticker}:PROJECT_PIPELINE`, ticker, kind: 'PROJECT_PIPELINE', label: KIND_LABEL.PROJECT_PIPELINE,
    mechanism: chain.map((c, i) => (i < done ? `✓ ${c}` : c)).join(' → '),
    state: 'IDENTIFIED', confidence: 'EARLY',
    runway: { ok: false, text: 'Nothing booked yet — an enabling step. A project / headline value (e.g. GDV) is not the company\'s revenue or share.' },
    evidence: [], forward: [item], beforeAfter: [],
    happened: chain.slice(0, done), notYet: chain.slice(done),
    nextMilestone: next, confirmWith: next ? `${next} filed` : 'Revenue filed',
    invalidateIf: 'The MoU / agreement lapses or is terminated, or no definitive step is filed.',
    duration: 'Duration: Unknown',
    firstEvidenceDate: date, latestEvidenceDate: date, freshness: 'CURRENT', periods: [],
    hardCount: 0, distinctMetrics: 1, temporarySignals: [], origins: ['gainers'],
    specialFocus: false,
    stage: chain[done - 1] || 'Enabling step', nextEvidence: next, managementTarget: null, sourceQuality: '0 filed figures · enabling step only',
    why: ['Tracked potential, not Special Focus: an enabling step with no booked revenue and no filed company economics.'],
    toQualify: chain.slice(done, done + 3),
    nearMiss: false,
  };
}

/** Categories where a Daily Gainers event can open a persistence test. */
export const PERSIST_CATEGORIES = new Set(['order_win', 'backlog_increase', 'capacity_expansion', 'production_ramp', 'utilization_increase',
  'new_customer', 'customer_ramp', 'product_qualification', 'regulatory_approval', 'export_approval', 'new_geography']);

// ═══════════════════════════════════════════════════════════════════════════
// HOW A PERSISTENT CATALYST IS SAID — EVIDENCE AND PERSISTENCE APART. (zzz788)
// "Capacity ramp · High persistence evidence · Validated" read as one verdict.
// The evidence state (what the filings show happened) and the persistence
// grade (whether it can continue) are printed as two separate words.
// ═══════════════════════════════════════════════════════════════════════════
const STATE_LOWER: Record<PersistState, string> = { IDENTIFIED: 'identified', VALIDATED: 'validated', RAMPING: 'ramping', SCALING: 'scaling', MATURE: 'mature', STALLING: 'stalling', WEAKENING: 'weakening', COMPLETED: 'completed', DISPROVED: 'disproved' };
export function persistenceWords(pc: Pick<PersistentCatalyst, 'label' | 'state' | 'confidence'>): { evidence: string; persistence: string; line: string } {
  const evidence = `Evidence ${STATE_LOWER[pc.state] || String(pc.state).toLowerCase()}`;
  const persistence = pc.confidence === 'HIGH' ? 'Persistence: high'
    : pc.confidence === 'MEDIUM' ? 'Persistence: medium'
      : pc.confidence === 'TEMPORARY_UNCERTAIN' ? 'Persistence: uncertain'
        : ['VALIDATED', 'RAMPING', 'SCALING'].includes(pc.state) ? 'Persistence: candidate' : 'Persistence: early / unproven';
  return { evidence, persistence, line: `${pc.label} · ${evidence} · ${persistence}` };
}

/** zzz788: the catalyst state and the thesis status, side by side — never
 *  merged. "Catalyst: validated · Thesis: weakening (working capital)", so a
 *  validated catalyst is not read as an overall positive thesis signal. Reads
 *  the assessment; never changes it. */
export function catalystThesisLine(pc: Pick<PersistentCatalyst, 'state'>, assessment: any | null | undefined): string {
  const cat = `Catalyst: ${STATE_LOWER[pc.state] || String(pc.state).toLowerCase()}`;
  const st = assessment?.status ? String(assessment.status) : null;
  if (!st) return `${cat} · Thesis: not assessed`;
  const word = st === 'THESIS_NOT_SET' ? 'not set' : st.replace(/_/g, ' ').toLowerCase();
  let why = '';
  if (st === 'WEAKENING' || st === 'BROKEN' || st === 'NEGATIVE_EXPECTATION_GAP') {
    const bad = ((assessment.checked || []) as any[]).filter((c) => c?.verdict === 'deteriorating' && !c.watch && !c.historical?.active);
    const names = [...new Set(bad.map((c) => String(VAR_LABEL[c.key as keyof typeof VAR_LABEL] || c.label || c.key).toLowerCase()))];
    if (names.length) why = ` (${names.slice(0, 2).join(', ')})`;
  }
  return `${cat} · Thesis: ${word}${why}`;
}
