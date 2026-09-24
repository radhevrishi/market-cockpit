// ═══════════════════════════════════════════════════════════════════════════
// THE FACT MODEL — TYPE, UNIT, SCOPE, VALIDITY, LINEAGE.            (zzz770)
//
// Every figure the board prints passes five questions before it may carry an
// arrow, and this module answers them. Pure: strings in, records out.
//
//   1. WHAT KIND OF STATEMENT IS IT?  `factTypeOf` maps the engine's older
//      labels (ACTUAL / GUIDANCE / TARGET / MANAGEMENT_STATEMENT / HISTORICAL)
//      onto the owner's seven types, adding ESTIMATE, SECONDARY_REPORT and
//      MANAGEMENT_COMMENTARY. A target is never an actual; "order book should
//      go up in line with supplies" (EMCURE) is commentary, never a value.
//   2. IN WHAT UNIT?  `normalizeValue` converts only where the conversion is
//      exact (lakh↔crore, KTPA↔TPA↔MTPA, kW↔MW, litres↔kL) and records how.
//      KL against KLD, bopd against boepd, MWh against MW, INR against USD
//      are different measures and stay NOT COMPARABLE.
//   3. OF WHAT, EXACTLY?  `scopeOf` reads the plant / unit / block / phase /
//      segment / product / basis / period basis / stated definition off the
//      value's own clause. GPPL's 1.6m MT of liquids, 5.2m MT of liquid cargo
//      capacity and 260–270k RoRo cars are three things; "Plant A capacity"
//      and "Plant B target" are two.
//   4. CAN TWO READINGS BE SUBTRACTED?  `comparability` answers before any
//      delta exists: same metric, same period → a duplicate (never a change);
//      a target against an actual, a different unit, scope, basis or
//      definition → NOT COMPARABLE, no delta.
//   5. IS THE VALUE PLAUSIBLE?  `validateReading` flags what needs a human:
//      utilisation above 100% with no stated definition (DEEPAKNTR "170-odd
//      percent"), impossible capacities, a negative cash-conversion ratio whose
//      sign or denominator cannot be read (LLOYDSENGG −3.72×). UNCLEAR rows are
//      counted neither confirmed nor contradicted.
//
// And one record that travels with every row: `Lineage` — source id, name,
// url, type, publication date, period, page/section when known, and the quote.
// ═══════════════════════════════════════════════════════════════════════════

import type { VarKey } from './taxonomy';
import { scaledNumber } from './evidence-ledger';
import { valueClause, datesIn, hasQuantity, isCommentaryOnly, RECURRING_METRICS, stripPeriodTokens } from './fact-normalize';
export { hasQuantity, isCommentaryOnly, RECURRING_METRICS, stripPeriodTokens };

// ── 1. FACT TYPES ──────────────────────────────────────────────────────────

export type FactType =
  | 'ACTUAL'
  | 'MANAGEMENT_GUIDANCE'
  | 'MANAGEMENT_TARGET'
  | 'MANAGEMENT_COMMENTARY'
  | 'HISTORICAL'
  | 'ESTIMATE'
  | 'SECONDARY_REPORT';

export const FACT_TYPE_LABEL: Record<FactType, string> = {
  ACTUAL: 'Actual',
  MANAGEMENT_GUIDANCE: 'Guidance',
  MANAGEMENT_TARGET: 'Target',
  MANAGEMENT_COMMENTARY: 'Management commentary',
  HISTORICAL: 'Historical context',
  ESTIMATE: 'Estimate',
  SECONDARY_REPORT: 'Secondary report',
};

/** A document written ABOUT the company rather than BY it. */
const SECONDARY_SOURCE = /\b(news|article|media|press coverage|broker|brokerage|research report|analyst (?:note|report)|initiating coverage|moneycontrol|economic times|business standard|livemint|mint|reuters|bloomberg|financial express|hindu businessline|trendlyne|credit rating|rating rationale|icra|crisil|care ratings|india ratings)\b/i;
/** Words that make a figure an estimate even when the model filed it as fact. */
const ESTIMATE_WORDS = /\b(estimated|estimate[sd]?|approximat(?:e|ely) we think|ballpark|indicative|tentative(?:ly)?|provisional|rough(?:ly)? (?:estimated|calculated))\b/i;
/** Variables whose values are events with a date, not levels. */
export const EVENT_METRICS: ReadonlySet<VarKey> = new Set<VarKey>([
  'new_plant', 'commissioning', 'capacity_addition', 'new_customer', 'customer_loss',
  'qualification', 'approval', 'new_product', 'shutdown', 'execution_delay',
  'capex_status', 'capacity_bottleneck', 'supply_bottleneck',
]);

/**
 * The owner's seven types from the engine's older labels. `statement` is a
 * StructuralVar.statement; `valueType` an event's value_type. Everything is
 * read from explicit words — a type is never promoted to ACTUAL here.
 */
export function factTypeOf(x: {
  statement?: string | null; valueType?: string | null; key?: VarKey | null;
  value?: string | null; text?: string | null; source?: string | null; retyped?: string | null;
}): FactType {
  const st = String(x.statement || x.valueType || 'ACTUAL').toUpperCase();
  if (st === 'HISTORICAL') return 'HISTORICAL';
  if (st === 'GUIDANCE') return 'MANAGEMENT_GUIDANCE';
  if (st === 'TARGET') return 'MANAGEMENT_TARGET';
  const hedged = /hedged/i.test(String(x.retyped || ''));
  if (hedged || ESTIMATE_WORDS.test(String(x.value || ''))) return 'ESTIMATE';
  if (st === 'MANAGEMENT_STATEMENT' || st === 'MANAGEMENT_CLAIM' || st === 'MANAGEMENT_COMMENTARY') return 'MANAGEMENT_COMMENTARY';
  if (x.key && isCommentaryOnly(x.key, x.value, x.text)) return 'MANAGEMENT_COMMENTARY';
  if (SECONDARY_SOURCE.test(String(x.source || ''))) return 'SECONDARY_REPORT';
  return 'ACTUAL';
}

// ── output vs mechanism ────────────────────────────────────────────────────

/** OUTPUT is what the mechanism produced; MECHANISM is why. (Owner's list.) */
export type MetricGroup = 'OUTPUT' | 'MECHANISM';
export const METRIC_GROUP: Record<VarKey, MetricGroup> = {
  revenue_growth: 'OUTPUT', earnings_growth: 'OUTPUT', margin: 'OUTPUT',
  operating_leverage: 'OUTPUT', cash_conversion: 'OUTPUT', roce: 'OUTPUT', fcf: 'OUTPUT',
  working_capital: 'OUTPUT', debt: 'OUTPUT', one_offs: 'OUTPUT',
  margin_driver: 'MECHANISM', raw_materials: 'MECHANISM',
  capacity: 'MECHANISM', capacity_addition: 'MECHANISM', utilisation: 'MECHANISM',
  new_plant: 'MECHANISM', commissioning: 'MECHANISM', capacity_bottleneck: 'MECHANISM',
  order_intake: 'MECHANISM', order_book: 'MECHANISM', book_to_bill: 'MECHANISM', revenue_visibility: 'MECHANISM',
  capex: 'MECHANISM', capex_status: 'MECHANISM', capex_earning: 'MECHANISM', maintenance_vs_growth: 'MECHANISM',
  new_customer: 'MECHANISM', customer_loss: 'MECHANISM', customer_concentration: 'MECHANISM',
  new_product: 'MECHANISM', qualification: 'MECHANISM', approval: 'MECHANISM',
  volume: 'MECHANISM', price: 'MECHANISM', mix: 'MECHANISM', exports: 'MECHANISM',
  guidance: 'MECHANISM', management_target: 'MECHANISM', promise_vs_actual: 'MECHANISM',
  supply_bottleneck: 'MECHANISM', execution_delay: 'MECHANISM', shutdown: 'MECHANISM',
  market_share: 'MECHANISM', pricing_power: 'MECHANISM', technology: 'MECHANISM',
};
/** Operating leverage the COMPANY states as a cause (fixed-cost absorption)
 *  is mechanism; the grader's revenue-vs-earnings ratio is output. */
export function metricGroupOf(key: VarKey, source?: string | null): MetricGroup {
  if (key === 'operating_leverage' && source === 'filing') return 'MECHANISM';
  return METRIC_GROUP[key] ?? 'MECHANISM';
}

// ── 2. UNITS ───────────────────────────────────────────────────────────────

export interface NormalizedValue {
  raw_value: string;
  raw_unit: string | null;
  /** The leading number with its magnitude word applied. */
  value: number | null;
  normalized_value: number | null;
  normalized_unit: string | null;
  /** What is being measured: money:INR, mass, volume, power, energy, … */
  dimension: string | null;
  /** 'per_year' | 'per_day' | null — a stock and a flow are not one measure. */
  rate: 'per_year' | 'per_day' | null;
  conversion_method: string | null;
  /** False when the unit could not be read or a conversion would need an
   *  assumption. Unsafe values are never compared across units. */
  safe: boolean;
}

const firstNumber = (s: string): number | null => {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(s.replace(/(?<=\d),(?=\d)/g, ''));
  return m ? Number(m[0]) : null;
};

/** Read the unit off the value string (and the unit field as a fallback) and
 *  convert only where exact. */
export function normalizeValue(raw: string | null | undefined, unitField?: string | null): NormalizedValue {
  const raw0 = String(raw ?? '').trim();
  // A period label is not a number: "Q1 FY26: 54.80 mmscm" parsed to 1 and
  // printed IRMENERGY's volume as +5794%. Parse the value with its period
  // tokens stripped; `raw_value` keeps the text as written. (zzz772)
  const s = stripPeriodTokens(raw0) || raw0;
  const t = `${s} ${unitField || ''}`;
  const base = (over: Partial<NormalizedValue>): NormalizedValue => ({
    raw_value: raw0, raw_unit: null, value: scaledNumber(s), normalized_value: null, normalized_unit: null,
    dimension: null, rate: null, conversion_method: null, safe: false, ...over,
  });
  const n0 = firstNumber(s);
  if (n0 == null) return base({});
  if (/%|\bper\s?cent\b|\bpercent\b/i.test(s)) {
    return base({ raw_unit: '%', value: n0, normalized_value: n0, normalized_unit: '%', dimension: 'percent', conversion_method: null, safe: true });
  }
  if (/\bbps?\b|basis points?/i.test(s)) {
    return base({ raw_unit: 'bps', value: n0, normalized_value: n0 / 100, normalized_unit: 'pp', dimension: 'percent_points', conversion_method: 'bps ÷ 100 = pp', safe: true });
  }
  if (/\d\s*(?:x|×)(?![a-z])|\btimes\b/i.test(s)) {
    return base({ raw_unit: 'x', value: n0, normalized_value: n0, normalized_unit: 'x', dimension: 'ratio', safe: true });
  }
  // "380,000 liters per day" is a volume RATE, not a count of days: the day
  // word is a denominator. VADILALIND's capacity printed "+110,000 days". (zzz771)
  if (/\bdays?\b/i.test(t) && !/\b(?:per|a|each)\s+day\b|\/\s*day\b/i.test(t)) {
    return base({ raw_unit: 'days', value: n0, normalized_value: n0, normalized_unit: 'days', dimension: 'days', safe: true });
  }
  // ── money ──
  const inr = /₹|\bINR\b|\bINR(?=\s?\d)|\bRs\.?|\brupees?\b|`\s*\d/i.test(s) || /INR(?=\d)/.test(s);
  const usd = /\bUSD\b|US\$|\$/.test(s) || /USD(?=\d)/.test(s);
  const eur = /\bEUR\b|€/.test(s);
  const crore = /(?:\b|(?<=\d))(crores?|cr)\b/i.test(s);
  const lakh = /\b(lakhs?|lacs?)\b/i.test(s);
  const mn = /(?:\b|(?<=\d))(millions?|mn)\b/i.test(s);
  const bn = /(?:\b|(?<=\d))(billions?|bn)\b/i.test(s);
  const thousand = /\bthousands?\b/i.test(s);
  const otherUnit = /\b(tonnes?|tons?|MT|TPA|KTPA|MTPA|KL|KLD|KLPD|litres?|liters?|MW|kW|GW|MWh|GWh|units?|cars?|pieces|boutiques?|stores?|plants?|sq\.?\s*(ft|m)|bopd|boepd|MMSCMD?|customers?|GPUs?)\b/i.test(s);
  if (usd || eur || inr || ((crore || lakh) && !otherUnit)) {
    const cur = usd ? 'USD' : eur ? 'EUR' : 'INR';
    const mag = crore ? 1e7 : lakh ? 1e5 : bn ? 1e9 : mn ? 1e6 : thousand ? 1e3 : 1;
    const word = crore ? 'crore' : lakh ? 'lakh' : bn ? 'billion' : mn ? 'million' : thousand ? 'thousand' : null;
    const amount = n0 * mag;
    if (cur === 'INR') {
      if (!word) {
        return base({ raw_unit: 'INR', value: amount, normalized_value: amount, normalized_unit: 'INR', dimension: 'money:INR',
          conversion_method: 'no magnitude word — kept in rupees as written', safe: false });
      }
      return base({ raw_unit: `INR ${word}`, value: amount, normalized_value: amount / 1e7, normalized_unit: '₹ crore', dimension: 'money:INR',
        conversion_method: word === 'crore' ? null : `${word} → crore (exact)`, safe: true });
    }
    return base({ raw_unit: `${cur}${word ? ` ${word}` : ''}`, value: amount, normalized_value: amount / 1e6, normalized_unit: `${cur} million`, dimension: `money:${cur}`,
      conversion_method: word && word !== 'million' ? `${word} → million (exact)` : null, safe: !!word });
  }
  const magOnly = bn ? 1e9 : mn ? 1e6 : thousand ? 1e3 : crore ? 1e7 : lakh ? 1e5 : 1;
  const qty = n0 * magOnly;
  // ── mass ──
  // "MTPA" is million tonnes a year in steel and cement and METRIC tonnes a
  // year in chemicals (AARTIPHARM "5000MTPA → 9,600+MTPA"). The unit alone
  // cannot say which, so it is never converted: MTPA meets only MTPA.
  if (/(?:\b|(?<=\d))MTPA\b/i.test(t)) return base({ raw_unit: 'MTPA', value: qty, normalized_value: qty, normalized_unit: 'MTPA', dimension: 'mass', rate: 'per_year', conversion_method: 'MTPA kept as written — million or metric tonnes is ambiguous', safe: true });
  if (/(?:\b|(?<=\d))KTPA\b/i.test(t)) return base({ raw_unit: 'KTPA', value: qty, normalized_value: qty * 1e3, normalized_unit: 'tonnes/yr', dimension: 'mass', rate: 'per_year', conversion_method: 'KTPA × 1,000 = tonnes/yr', safe: true });
  if (/\bTPA\b|(?<=\d)TPA\b|(?:tonnes?|tons?|MT)\s*(?:per annum|p\.?a\.?(?![a-z])|\/\s*(?:annum|year|yr|PA))/i.test(t)) {
    return base({ raw_unit: 'TPA', value: qty, normalized_value: qty, normalized_unit: 'tonnes/yr', dimension: 'mass', rate: 'per_year', safe: true });
  }
  if (/\bMTPD\b|\bTPD\b|(?:tonnes?|tons?|MT)\s*(?:per day|\/\s*day)/i.test(t)) {
    return base({ raw_unit: 'TPD', value: qty, normalized_value: qty, normalized_unit: 'tonnes/day', dimension: 'mass', rate: 'per_day', safe: true });
  }
  if (/\bMMT\b/i.test(t)) return base({ raw_unit: 'MMT', value: qty, normalized_value: qty * 1e6, normalized_unit: 'tonnes', dimension: 'mass', conversion_method: 'MMT × 1,000,000 = tonnes', safe: true });
  if (/\b(metric\s+)?(tonnes?|tons?)\b|\bMT\b|(?<=\d)MT\b/i.test(t)) {
    return base({ raw_unit: 'MT', value: qty, normalized_value: qty, normalized_unit: 'tonnes', dimension: 'mass',
      conversion_method: magOnly !== 1 ? 'magnitude word applied' : null, safe: true });
  }
  // ── volume ──
  if (/(?:\b|(?<=\d))(?:KLD|KLPD)\b|(?:KL|kilolit\w*)\s*(?:per day|\/\s*day)/i.test(t)) return base({ raw_unit: 'KLD', value: qty, normalized_value: qty, normalized_unit: 'kL/day', dimension: 'volume', rate: 'per_day', safe: true });
  if (/\bKL\b|(?<=\d)\s*kl\b|kilolit/i.test(t)) return base({ raw_unit: 'KL', value: qty, normalized_value: qty, normalized_unit: 'kL', dimension: 'volume', safe: true });
  if (/\blit(?:re|er)s?\b/i.test(t)) {
    // "380,000 liters per day" is a daily rate (kL/day), not a tank. (zzz771)
    const perDay = /\b(?:per|a|each)\s+day\b|\/\s*day\b/i.test(t);
    return base({ raw_unit: perDay ? 'litres/day' : 'litres', value: qty, normalized_value: qty / 1000, normalized_unit: perDay ? 'kL/day' : 'kL', dimension: 'volume', rate: perDay ? 'per_day' : null, conversion_method: 'litres ÷ 1,000 = kL', safe: true });
  }
  // ── power / energy ──
  if (/\b(MWh|GWh|kWh)\b/i.test(t)) {
    const f = /GWh/i.test(t) ? 1000 : /kWh/i.test(t) ? 0.001 : 1;
    return base({ raw_unit: (t.match(/MWh|GWh|kWh/i) || ['MWh'])[0], value: qty, normalized_value: qty * f, normalized_unit: 'MWh', dimension: 'energy', conversion_method: f !== 1 ? 'converted to MWh (exact)' : null, safe: true });
  }
  if (/\bMWp\b|\bGWp\b/i.test(t)) {
    const f = /GWp/i.test(t) ? 1000 : 1;
    return base({ raw_unit: /GWp/i.test(t) ? 'GWp' : 'MWp', value: qty, normalized_value: qty * f, normalized_unit: 'MWp', dimension: 'power_peak', safe: true });
  }
  if (/\b(MW|GW|kW)\b|(?<=\d)(MW|GW|kW)\b/i.test(t)) {
    const u = (t.match(/GW|MW|kW/i) || ['MW'])[0];
    const f = /^GW$/i.test(u) ? 1000 : /^kW$/i.test(u) && u !== 'MW' ? 0.001 : 1;
    return base({ raw_unit: u, value: qty, normalized_value: qty * f, normalized_unit: 'MW', dimension: 'power', conversion_method: f !== 1 ? `${u} → MW (exact)` : null, safe: true });
  }
  // ── gas / oil ──
  if (/\bMMSCMD\b|MMSCM\s*(?:per day|\/\s*d)/i.test(t)) return base({ raw_unit: 'MMSCMD', value: qty, normalized_value: qty, normalized_unit: 'MMSCM/day', dimension: 'gas', rate: 'per_day', safe: true });
  if (/\bMMSCM\b/i.test(t)) return base({ raw_unit: 'MMSCM', value: qty, normalized_value: qty, normalized_unit: 'MMSCM', dimension: 'gas', safe: true });
  if (/\bboepd\b|\bboe\/d\b/i.test(t)) return base({ raw_unit: 'boepd', value: qty, normalized_value: qty, normalized_unit: 'boepd', dimension: 'oil_equivalent', rate: 'per_day', safe: true });
  if (/\bbopd\b|\bbpd\b|barrels? (?:of oil )?per day/i.test(t)) return base({ raw_unit: 'bopd', value: qty, normalized_value: qty, normalized_unit: 'bopd', dimension: 'oil', rate: 'per_day', safe: true });
  // ── anything else: a count of whatever the words name ──
  const words = s.toLowerCase()
    .replace(/[\d,.\s₹$`\-–~+()]+/g, ' ')
    .replace(/\b(trillions?|billions?|bn|crores?|cr|millions?|mn|lakhs?|thousands?|approx\w*|about|around|nearly|over|odd|more than|less than|a little|of|and|the|a|an|to|at|over)\b/g, ' ')
    .split(/\s+/).filter(Boolean).map((w) => w.replace(/s$/, ''));
  const unit = words.length ? Array.from(new Set(words)).join(' ') : null;
  return base({ raw_unit: unit, value: qty, normalized_value: qty, normalized_unit: unit, dimension: unit ? `count:${unit}` : 'count',
    conversion_method: magOnly !== 1 ? 'magnitude word applied' : null, safe: !!unit });
}

const CAPACITY_KEYS = new Set<string>(['capacity', 'capacity_addition', 'new_plant']);

/** Two normalised values in the same measure, and how they were made so. */
export function unitsComparable(a: NormalizedValue, b: NormalizedValue, key?: VarKey | string | null): { ok: boolean; method: string | null; reason: string | null } {
  if (a.normalized_value == null || b.normalized_value == null) return { ok: false, method: null, reason: 'no number on one side' };
  if (!a.dimension || !b.dimension) return { ok: false, method: null, reason: 'unit not readable' };
  if (a.dimension !== b.dimension) {
    // A bare count beside a labelled count ("6,000 → 15,000 sq ft") shares
    // the sentence's unit; a bare count never pairs with money or percent.
    const bare = (x: NormalizedValue) => x.dimension === 'count';
    if ((bare(a) && b.dimension.startsWith('count:')) || (bare(b) && a.dimension.startsWith('count:'))) {
      return { ok: true, method: 'bare figure read in the unit of the labelled one', reason: null };
    }
    return { ok: false, method: null, reason: `different measures (${a.raw_unit || a.dimension} vs ${b.raw_unit || b.dimension})` };
  }
  if (!a.safe || !b.safe) {
    if (a.normalized_unit === b.normalized_unit && a.raw_unit === b.raw_unit) return { ok: true, method: null, reason: null };
    return { ok: false, method: null, reason: 'conversion would need an assumption' };
  }
  if (a.rate !== b.rate) {
    // Installed capacity in "MT" is an annual capacity by convention; only
    // for the capacity variables may MT meet TPA.
    const oneAnnualOneBare = (a.rate === 'per_year' && b.rate == null) || (b.rate === 'per_year' && a.rate == null);
    const tonnes = (x: NormalizedValue) => x.normalized_unit === 'tonnes' || x.normalized_unit === 'tonnes/yr';
    if (oneAnnualOneBare && key && CAPACITY_KEYS.has(String(key)) && tonnes(a) && tonnes(b)) {
      return { ok: true, method: 'capacity stated in MT read as annual (tonnes/yr)', reason: null };
    }
    return { ok: false, method: null, reason: `a stock and a rate are different measures (${a.raw_unit} vs ${b.raw_unit})` };
  }
  if (a.normalized_unit !== b.normalized_unit) return { ok: false, method: null, reason: `different units (${a.raw_unit} vs ${b.raw_unit})` };
  const methods = [a.conversion_method, b.conversion_method].filter((m) => m && !/magnitude word applied/.test(m));
  return { ok: true, method: a.raw_unit !== b.raw_unit ? (methods.join('; ') || `${a.raw_unit} ↔ ${b.raw_unit}`) : null, reason: null };
}

// ── 3. SCOPE ───────────────────────────────────────────────────────────────

export type PeriodBasis = 'QUARTER' | 'HALF' | 'NINE_MONTHS' | 'FULL_YEAR' | 'TTM';
export interface FactScope {
  /** Named plant / unit / block / phase / line / site / project identifiers. */
  ids: string[];
  /** Segment / product words the value's clause names. */
  segments: string[];
  basis: 'CONSOLIDATED' | 'STANDALONE' | null;
  period_basis: PeriodBasis | null;
  /** A stated definition or denominator ("of installed capacity"). */
  definition: string | null;
}

const ID_RE = /\b(plant|unit|block|phase|line|site|facility|project|terminal|berth|campus)\s*[-#:]?\s*([A-Z]|[IVX]{1,4}|\d{1,3})\b(?![\d.,%]|\s*(?:%|per\b|percent|crores?|cr\b|mn\b|million|tonnes?|MT\b|KL|MW|TPA|KTPA|MTPA|units?\b|days?\b))/gi;
const SITE_AT_RE = /\b([Pp]lant|[Uu]nit|[Ff]acility|[Ss]ite|[Bb]lock|[Tt]erminal)s?\s+(?:at|in)\s+([A-Z][a-z]{3,})/g;
const NAMED_SITE_RE = /\b([A-Z][a-z]{3,})\s+(plant|unit|facility|site|block|terminal)\b/g;
const SEGMENT_RE = /\b(liquids?|liquid cargo|ro-?ro|cars?|containers?|dry bulk|break[- ]bulk|bulk|coal|LNG|LPG|ethanol|steroid\w*|xanthine|intermediates?|formulations?|API|CDMO|domestic|export(?:s)?|international|india business|overseas|retail|B2B|B2C|defen[cs]e|railways?|solar|wind|hydro|thermal)\b/gi;
const DEFINITION_RE = /\b(?:(?:of|on|against|over|versus|vs\.?|relative to|based on)\s+(?:the\s+|our\s+)?(?:(?:original|rated|nameplate|installed|licensed|design(?:ed)?|initial|base|effective|approved|name-plate)\s+)+capacity(?:\s+of\s+[\d,.]+\s*\w+)?|(?:calculated|measured|defined|computed)\s+(?:as|on)\s+[^.;]{3,80})/i;

/** The scope a value's own clause states. Nothing is inferred. */
export function scopeOf(text: string | null | undefined, value?: string | null): FactScope {
  const clause = valueClause(String(text || ''), value ?? null) || String(text || '');
  const scan = `${clause} ${value || ''}`;
  const ids = new Set<string>();
  for (const m of scan.matchAll(ID_RE)) ids.add(`${m[1].toLowerCase()} ${m[2].toLowerCase()}`);
  for (const m of scan.matchAll(SITE_AT_RE)) ids.add(`${m[1].toLowerCase()} ${m[2].toLowerCase()}`);
  for (const m of scan.matchAll(NAMED_SITE_RE)) {
    if (/^(this|that|each|every|which|there|their|these|those|new|existing|current|total|overall|first|second|third|greenfield|brownfield|entire|whole|said|same|other|another|largest|single|both|captive|pilot|manufacturing|production)$/i.test(m[1])) continue;
    ids.add(`${m[2].toLowerCase()} ${m[1].toLowerCase()}`);
  }
  const segs = new Set<string>();
  for (const m of scan.matchAll(SEGMENT_RE)) {
    const w = m[1].toLowerCase().replace(/^liquid cargo$|^liquids?$/, 'liquid').replace(/^ro-?ro$|^cars?$/, 'roro')
      .replace(/^exports?$/, 'export').replace(/^containers?$/, 'container').replace(/^railways?$/, 'railway')
      .replace(/^intermediates?$/, 'intermediate').replace(/^formulations?$/, 'formulation').replace(/^steroid\w*$/, 'steroid');
    segs.add(w);
  }
  const basis = /\bstandalone\b/i.test(scan) ? 'STANDALONE' : /\bconsolidated\b/i.test(scan) ? 'CONSOLIDATED' : null;
  const period_basis: PeriodBasis | null = /\b(9M|nine months|9 months)\b/i.test(scan) ? 'NINE_MONTHS'
    : /\b(H1|H2|half[- ]year|first half|second half|six months)\b/i.test(scan) ? 'HALF'
      : /\b(TTM|trailing twelve|trailing 12|LTM)\b/i.test(scan) ? 'TTM'
        : /\b(for the (?:full |financial |fiscal )?year|full[- ]year|annual(?:ly)?|for FY\s?'?\d{2}|FY\s?'?\d{2}\s+(?:revenue|sales|volume|production))\b/i.test(scan) ? 'FULL_YEAR'
          : /\b(for the quarter|this quarter|in the quarter|during the quarter|quarterly|Q[1-4]\s?FY\s?'?\d{2}\s+(?:revenue|sales|volume|production))\b/i.test(scan) ? 'QUARTER'
            : null;
  const def = DEFINITION_RE.exec(String(text || ''));
  return { ids: Array.from(ids), segments: Array.from(segs), basis, period_basis, definition: def ? def[0].trim() : null };
}

// ── 4. COMPARABILITY ───────────────────────────────────────────────────────

export interface Comparable {
  key: VarKey | string;
  value: string | null;
  unit?: string | null;
  quote?: string | null;
  /** The period the figure DESCRIBES (a historical date where one is pinned). */
  period: string | null;
  fact_type?: FactType | null;
  scope?: FactScope | null;
}

export interface ComparabilityResult {
  comparable: boolean;
  /** Both readings describe one period: a duplicate, never a change. */
  same_period: boolean;
  reason: string | null;
  /** How the units were reconciled, when they needed reconciling. */
  conversion_method: string | null;
  prev_norm: NormalizedValue | null;
  cur_norm: NormalizedValue | null;
}

const FORWARD_TYPES = new Set<FactType>(['MANAGEMENT_GUIDANCE', 'MANAGEMENT_TARGET']);
const normPeriod = (p: string | null | undefined) => String(p || '').toUpperCase().replace(/['\s]+/g, '').replace(/^FY(\d{2})$/, 'FY$1');

/** Before ANY delta: may these two readings be subtracted at all? */
export function comparability(prev: Comparable, cur: Comparable): ComparabilityResult {
  const out = (comparable: boolean, reason: string | null, extra: Partial<ComparabilityResult> = {}): ComparabilityResult =>
    ({ comparable, same_period: false, reason, conversion_method: null, prev_norm: null, cur_norm: null, ...extra });
  if (prev.key !== cur.key) return out(false, 'different metrics');
  if (prev.period && cur.period && normPeriod(prev.period) === normPeriod(cur.period)) {
    return out(false, `same period (${cur.period}) — a duplicate reading, not a change`, { same_period: true });
  }
  const pt = prev.fact_type || 'ACTUAL', ct = cur.fact_type || 'ACTUAL';
  if (FORWARD_TYPES.has(pt) !== FORWARD_TYPES.has(ct)) return out(false, 'a target or guidance is not an actual');
  if (pt === 'MANAGEMENT_COMMENTARY' || ct === 'MANAGEMENT_COMMENTARY') return out(false, 'management commentary carries no comparable figure');
  if (pt === 'HISTORICAL' && ct === 'HISTORICAL') { /* history against history is allowed */ }
  const a = normalizeValue(prev.value, prev.unit), b = normalizeValue(cur.value, cur.unit);
  const u = unitsComparable(a, b, prev.key);
  if (!u.ok) return out(false, u.reason, { prev_norm: a, cur_norm: b });
  const sa = prev.scope || scopeOf(prev.quote, prev.value), sb = cur.scope || scopeOf(cur.quote, cur.value);
  if (sa.ids.length && sb.ids.length && !sa.ids.some((x) => sb.ids.includes(x))) {
    return out(false, `different plant / project / phase (${sa.ids.join(', ')} vs ${sb.ids.join(', ')})`, { prev_norm: a, cur_norm: b });
  }
  if (!!sa.ids.length !== !!sb.ids.length) {
    return out(false, `scope not shown to be the same (${(sa.ids.length ? sa.ids : sb.ids).join(', ')} vs unspecified)`, { prev_norm: a, cur_norm: b });
  }
  if (sa.segments.length && sb.segments.length && !sa.segments.some((x) => sb.segments.includes(x))) {
    return out(false, `different segment / product (${sa.segments.join(', ')} vs ${sb.segments.join(', ')})`, { prev_norm: a, cur_norm: b });
  }
  if (sa.basis && sb.basis && sa.basis !== sb.basis) return out(false, `standalone vs consolidated`, { prev_norm: a, cur_norm: b });
  if (sa.period_basis && sb.period_basis && sa.period_basis !== sb.period_basis) {
    return out(false, `different period basis (${sa.period_basis.toLowerCase().replace('_', ' ')} vs ${sb.period_basis.toLowerCase().replace('_', ' ')})`, { prev_norm: a, cur_norm: b });
  }
  if (sa.definition && sb.definition && sa.definition.toLowerCase() !== sb.definition.toLowerCase()) {
    return out(false, `different definition / denominator ("${sa.definition}" vs "${sb.definition}")`, { prev_norm: a, cur_norm: b });
  }
  return out(true, null, { conversion_method: u.method, prev_norm: a, cur_norm: b });
}

/** The change between two comparable readings: pp for percentages, relative
 *  percent otherwise; "unchanged" when equal. Null when either side has no
 *  number or the relative base is zero. */
export function deltaText(prev: NormalizedValue, cur: NormalizedValue): { text: string | null; direction: 'up' | 'down' | 'flat' | 'unknown'; unit: 'pp' | '%' | null } {
  const b = prev.normalized_value, a = cur.normalized_value;
  if (b == null || a == null) return { text: null, direction: 'unknown', unit: null };
  const d = a - b;
  const dir = Math.abs(d) < 1e-9 ? 'flat' : d > 0 ? 'up' : 'down';
  if (dir === 'flat') return { text: 'unchanged', direction: 'flat', unit: null };
  const r1 = (x: number) => Math.round(x * 10) / 10;
  if (prev.dimension === 'percent' || prev.dimension === 'percent_points') return { text: `${d > 0 ? '+' : ''}${r1(d)}pp`, direction: dir, unit: 'pp' };
  if (b === 0) return { text: null, direction: dir, unit: null };
  const p = (d / Math.abs(b)) * 100;
  return { text: `${p > 0 ? '+' : ''}${r1(p)}%`, direction: dir, unit: '%' };
}

export const PRIOR_NOT_DISCLOSED = 'prior comparable value not disclosed';

/** "68% → 74% · +6pp", "59 days → 59 days · unchanged", or "74% · prior
 *  comparable value not disclosed". Never an invented prior. */
export function beforeAfterText(prev: Comparable | null, cur: Comparable): { text: string; delta: string | null; comparable: boolean; reason: string | null } {
  const curV = String(cur.value ?? '').trim();
  if (!prev || !String(prev.value ?? '').trim()) return { text: `${curV} · ${PRIOR_NOT_DISCLOSED}`, delta: null, comparable: false, reason: null };
  const c = comparability(prev, cur);
  if (!c.comparable) {
    if (c.same_period) return { text: curV, delta: null, comparable: false, reason: c.reason };
    return { text: `${curV} · NOT COMPARABLE with ${prev.value}${prev.period ? ` (${prev.period})` : ''} — ${c.reason}`, delta: null, comparable: false, reason: c.reason };
  }
  const d = deltaText(c.prev_norm!, c.cur_norm!);
  return { text: `${String(prev.value).trim()} → ${curV}${d.text ? ` · ${d.text}` : ''}`, delta: d.text, comparable: true, reason: null };
}

// ── 5. VALIDATION ──────────────────────────────────────────────────────────

export type ValidationFlag =
  | 'UTILISATION_ABOVE_100' | 'NEGATIVE_RATIO_SIGN_UNCLEAR' | 'DENOMINATOR_MISMATCH'
  | 'UNIT_MISMATCH' | 'IMPOSSIBLE_VALUE' | 'AMBIGUOUS_VALUE' | 'UNIT_MISSING' | 'NO_COUNTERPARTY';

// ── AN AMOUNT WITH NO UNIT IS NOT A NUMBER THE CARD CAN USE.        (zzz773)
// MOREPENLAB's "Capex: 57012.81 (Unaudited)" is a statement-table cell: lakh,
// crore or thousand is not in the value, so it is UNCLEAR — the amount was
// extracted and its unit was not. Nothing is guessed.
const AMOUNT_VARS = new Set<string>(['capex', 'capex_status', 'order_book', 'order_intake', 'revenue_visibility', 'fcf', 'debt',
  'capacity', 'capacity_addition', 'exports']);
/** True when a value is a bare figure: digits (and at most a parenthetical
 *  word like "(Unaudited)") with no currency, magnitude or unit. */
const AUDIT_TAG = /\(?\b(?:un)?audited\b\)?|\(?\b(?:provisional|restated|reviewed)\b\)?/gi;
export function unitMissing(value: string | null | undefined, unit?: string | null): boolean {
  // "(Unaudited)" in the unit slot is an audit tag, not a unit (MOREPENLAB).
  if (String(unit ?? '').replace(AUDIT_TAG, '').trim()) return false;
  const v = String(value ?? '').replace(AUDIT_TAG, ' ').trim();
  return /^[~≈]?\s*-?\d[\d,]*(?:\.\d+)?$/.test(v) && /\d{3,}/.test(v.replace(/,/g, ''));
}
// ── A DATE RANGE IS NOT A CUSTOMER.                                  (zzz773)
// MOREPENLAB's "New customer: 20th October 2026 to 19th October 2029 (both
// days inclusive)" was a director's re-appointment term. A new-customer
// reading that names no counterparty — only dates, or a person's office —
// is a contract period with no counterparty: UNCLEAR, never a confirmation.
const DATE_WORDS = /\b(\d{1,2}(?:st|nd|rd|th)?|st|nd|rd|th|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?|(?:19|20)\d{2}|to|from|till|until|and|both|days?|inclusive|w\.?e\.?f\.?|with effect|effective|period|of|the|for|a|term|years?|months?|FY\s?'?\d{2,4})\b|[()\-–,.:/]/gi;
const PERSON_OFFICE = /\b(?:Mr|Ms|Mrs|Dr|Shri|Smt)\.?\s+[A-Z]|\bDIN\b|\b(?:managing director|whole[- ]time director|independent director|chairman|chairperson|chief executive|CEO|CFO|company secretary|auditor|re-?appoint\w*)\b/i;
export function noCounterparty(value: string | null | undefined): 'dates' | 'person' | 'none' | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (PERSON_OFFICE.test(v)) return 'person';
  // HSCL: "Strategic investments/partnerships noted …; no named customer
  // contracts disclosed" counted as a new-customer driver.
  // "up 200% year-on-year", "2,500 crores with EV constituting over 15%" —
  // an amount or a growth rate, filed as a customer, naming none.
  if (/^\s*(?:(?:up|down|grew|rose|increased|declined)\s+(?:by\s+)?)?(?:₹|INR|Rs\.?|USD|\$)?\s*[\d,.]+\s*(?:%|x|×|crores?|cr\b|lakhs?|mn\b|million|bn\b|billion)/i.test(v)) return 'none';
  if (/\bno (?:named |new |specific )?customers?\b|\bno (?:named )?customer contracts?\b|\bcustomers? (?:were |was )?not (?:named|disclosed)\b/i.test(v)) return 'none';
  const rest = v.replace(DATE_WORDS, ' ').replace(/\s+/g, '').trim();
  return rest.length === 0 && /\d/.test(v) ? 'dates' : null;
}

// ── CAPACITY FIGURES ARE COMPARED ONLY LIKE FOR LIKE.                (zzz773)
// LLOYDSENT "Installed capacity 55 MT" beside "Capacity added 150,000 MTPA";
// SOTL "2,061 kWp" (rooftop power) beside "~3,000 MTPA" (ester production);
// HSCL "2,50,000 MTPA" carbon black beside a 2,600 → 5,300 MTPA anthraquinone
// project. A delta or a progression needs company → segment / product →
// plant / project → unit → period to match. This says why two figures do not.
const POWER_UNIT = /\d[\d,.]*\+?\s*(?:k|m|g)?w(?:p|h)?\b|\d[\d,.]*\+?\s*(?:kva|mva)\b/i;
const PRODUCTION_UNIT = /\d[\d,.]*\+?\s*(?:lakh|million|mn|k|thousand)?\s*(?:m?t(?:pa|pd|ph)?|ktpa|mtpa|tpa|tonnes?|tons?|metric tons?|kt|mnt|kl|kld|klpd|litres?|liters?|mmscmd?|units?|pieces|pcs|sets|bales|spindles|looms|sq\.?\s?ft|kg)\b/i;
/** A capacity FIGURE: a number with a production or power unit. "Phase1
 *  Q3FY27" and "April 2026" are not. (zzz773) */
export const isCapacityFigure = (v: string | null | undefined): boolean => POWER_UNIT.test(String(v ?? '')) || PRODUCTION_UNIT.test(String(v ?? ''));
const PRODUCT_WORDS = /\b(carbon black|anthraquinone|carbazole|cnt|carbon nano ?tubes?|anode|cathode|lfp|pellet|dri|sponge iron|ester|lubricants?|rooftop|solar|wind|coal tar|pitch|api|formulations?|steel|cement|clinker|gold|iron ore|pipeline|slurry|packaging|film|recycl\w*)\b/gi;
const measureKind = (v: string, u?: string | null): 'power' | 'production' | null => {
  const t = `${v} ${u || ''}`;
  const pw = POWER_UNIT.test(t), pr = PRODUCTION_UNIT.test(t);
  // "355 MVA (534,000 tpa)" states both: no kind can be told apart.
  if (pw && pr) return null;
  return pw ? 'power' : pr ? 'production' : null;
};
const productsOf = (t: string): string[] => Array.from(new Set(Array.from(String(t || '').matchAll(PRODUCT_WORDS)).map((m) => m[1].toLowerCase().replace(/s$/, ''))));
export interface CapacityPair { value: string; unit?: string | null; quote?: string | null }
/** Null when two capacity figures describe the same measure and scope; the
 *  printable reason otherwise. Never computes a delta. */
export function capacityMismatch(a: CapacityPair, b: CapacityPair): string | null {
  const ka = measureKind(a.value, a.unit), kb = measureKind(b.value, b.unit);
  if (ka && kb && ka !== kb) return `Not comparable — ${ka} capacity vs ${kb} capacity (${a.value} vs ${b.value}); no delta calculated`;
  const c = comparability({ key: 'capacity', value: a.value, unit: a.unit, quote: a.quote, period: null }, { key: 'capacity', value: b.value, unit: b.unit, quote: b.quote, period: null });
  if (!c.comparable && c.reason && !/no number/.test(c.reason)) {
    return /plant|project|phase|segment|product|scope/.test(c.reason)
      ? `Separate scope — ${a.value} and ${b.value} describe ${c.reason}; no delta calculated`
      : `UNCLEAR — unit/scope mismatch: ${a.value} vs ${b.value}, no delta calculated`;
  }
  const pa = productsOf(`${a.value} ${valueClause(String(a.quote || ''), a.value)}`), pb = productsOf(`${b.value} ${valueClause(String(b.quote || ''), b.value)}`);
  if (pa.length && pb.length && !pa.some((x) => pb.includes(x))) {
    return `Separate scope — ${a.value} (${pa.join(', ')}) and ${b.value} (${pb.join(', ')}) are different segments / projects; no delta calculated`;
  }
  return null;
}

// ── TWO FIGURES JOINED BY "OR" ARE NOT ONE READING.                  (zzz771)
//
// INNOVACAP's transcript gave utilisation as "30% or 25%" — the speaker
// corrected himself mid-sentence and the reader kept both. Printed as a level
// it would become a time-series point that is off by five points whichever
// one is true, and a later 28% would then read as a rise OR a fall. A value
// with two alternatives is a validation question, never a number.
const AMBIGUOUS_OR = /\d[\d,.]*\s*(?:%|per\s?cent|percent)?\s+or\s+(?:~|about|around|approx\w*\s+)?\d[\d,.]*\s*(?:%|per\s?cent|percent)?/i;
/** "30% or 25%": two stated figures with no way to choose. A range ("30 to
 *  35%", "30–35%") is one reading and is not flagged. */
export function isAmbiguousValue(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim();
  if (!v) return false;
  if (!AMBIGUOUS_OR.test(v)) return false;
  // "X or more" / "X or higher" / "X or so" is one figure with a hedge.
  if (/\d\s*%?\s*or\s+(?:more|higher|less|lower|so|above|below|better|thereabouts)\b/i.test(v)) return false;
  return true;
}

export interface Validation {
  /** UNCLEAR rows are counted neither confirmed nor contradicted. */
  state: 'OK' | 'UNCLEAR';
  flags: ValidationFlag[];
  /** Printed on the row: "validation required — …". */
  reason: string | null;
  /** The definition / denominator the source states, when it states one. */
  metric_definition: string | null;
}

const OK: Validation = { state: 'OK', flags: [], reason: null, metric_definition: null };

/** Percent figures in a value, including "170-odd percent". */
function percents(s: string): number[] {
  // "65%-70%" is a range, not minus seventy (zzz776 — SBCL).
  return Array.from(String(s).replace(/(?<=\d),(?=\d)/g, '').replace(/(\d\s*(?:%|per\s?cent|percent)?)\s*[-–]\s*(?=\d)/gi, '$1 to ').matchAll(/(-?\d+(?:\.\d+)?)(?:\s*-?\s*odd)?\s*(?:%|per\s?cent|percent)/gi)).map((m) => Number(m[1]));
}

/** Suspicious or ambiguous values become a validation state, not a verdict. */
export function validateReading(key: VarKey | string, value: string | null | undefined, text?: string | null, unit?: string | null): Validation {
  const v = String(value ?? '');
  if (!v.trim()) return OK;
  // Before any range test: "30% or 25%" has two figures and no answer. (zzz771)
  if (isAmbiguousValue(v)) {
    return { state: 'UNCLEAR', flags: ['AMBIGUOUS_VALUE'], metric_definition: null,
      reason: `validation required — ambiguous reading: ${v.trim()}` };
  }
  if (key === 'utilisation') {
    const ps = percents(v);
    if (ps.some((p) => p < 0)) return { state: 'UNCLEAR', flags: ['IMPOSSIBLE_VALUE'], reason: 'validation required — a negative utilisation is impossible', metric_definition: null };
    if (ps.some((p) => p > 100)) {
      const def = scopeOf(text, value).definition || (DEFINITION_RE.exec(`${v} ${text || ''}`)?.[0]?.trim() ?? null);
      if (def) return { state: 'OK', flags: ['UTILISATION_ABOVE_100'], reason: null, metric_definition: def };
      return { state: 'UNCLEAR', flags: ['UTILISATION_ABOVE_100'], metric_definition: null,
        reason: `validation required — utilisation of ${Math.max(...ps)}% exceeds 100% and the source states no definition or denominator` };
    }
  }
  if (AMOUNT_VARS.has(String(key)) && unitMissing(v, unit)) {
    return { state: 'UNCLEAR', flags: ['UNIT_MISSING'], metric_definition: null,
      reason: `UNCLEAR — amount extracted but unit unavailable (${v.trim()})` };
  }
  if (key === 'new_customer') {
    const nc = noCounterparty(v);
    if (nc) return { state: 'UNCLEAR', flags: ['NO_COUNTERPARTY'], metric_definition: null,
      reason: nc === 'person'
        ? 'UNCLEAR — names a person or office, not a customer; not a new-customer confirmation'
        : nc === 'none' ? 'UNCLEAR — no customer is named (an amount, a growth rate or "no named customer"); not a new-customer confirmation'
        : 'UNCLEAR — contract period with no counterparty named; not a new-customer confirmation' };
  }
  if (key === 'capacity' || key === 'capacity_addition') {
    const n = scaledNumber(v);
    if (n != null && n <= 0 && !/%/.test(v)) return { state: 'UNCLEAR', flags: ['IMPOSSIBLE_VALUE'], reason: 'validation required — a capacity of zero or less is impossible', metric_definition: null };
  }
  return OK;
}

/** A cash-conversion ratio: a negative ratio is readable only when BOTH its
 *  sides are known for the SAME period. The screener's ratio is annual; its
 *  sign cannot be checked against a quarter's profit. */
export function validateCashConversion(ratio: number, ctx: { profitSign: number | null; ratioPeriodMatchesProfit: boolean }): Validation {
  if (!Number.isFinite(ratio)) return { state: 'UNCLEAR', flags: ['IMPOSSIBLE_VALUE'], reason: 'validation required — the ratio is not a number', metric_definition: null };
  if (ratio >= 0) return OK;
  if (ctx.profitSign == null) {
    return { state: 'UNCLEAR', flags: ['NEGATIVE_RATIO_SIGN_UNCLEAR'], metric_definition: null,
      reason: `validation required — a ${ratio.toFixed(2)}× cash-conversion ratio with no profit figure: which side is negative is not stated` };
  }
  if (!ctx.ratioPeriodMatchesProfit) {
    return { state: 'UNCLEAR', flags: ['NEGATIVE_RATIO_SIGN_UNCLEAR', 'DENOMINATOR_MISMATCH'], metric_definition: null,
      reason: `validation required — the ${ratio.toFixed(2)}× ratio is for a different period than the profit figure on file, so its sign and denominator cannot be read` };
  }
  return OK;
}

// ── LINEAGE ────────────────────────────────────────────────────────────────

export interface Lineage {
  source_id: string | null;
  source_name: string;
  source_url: string | null;
  source_type: string | null;
  publication_date: string | null;
  /** The reporting period the fact was filed under. */
  period: string | null;
  /** Page or section, when the quote or document says so. */
  page_section: string | null;
  quote: string;
}

const PAGE_RE = /\b(?:page|slide|pg\.?|p\.)\s*(\d{1,3})\b|\b(Q&A|question[- ]and[- ]answer|opening remarks|management discussion(?: and analysis)?|MD&A|notes to (?:the )?(?:financial )?(?:results|accounts)|segment (?:results|information))\b/i;

/** Lineage from whatever the reading carries, joined to its document when the
 *  period's document list is given. Nothing is dropped; a missing field is null. */
export function lineageOf(r: {
  source_document_id?: string | null; source_name?: string | null; source?: string | null;
  source_date?: string | null; source_type?: string | null; source_url?: string | null;
  source_quote?: string | null; evidence_text?: string | null; period?: string | null; page?: string | number | null;
}, docs?: Array<{ id: string; url: string; label: string; kind: string; date_iso: string | null }> | null): Lineage {
  const name = String(r.source_name ?? r.source ?? '').trim();
  const quote = String(r.source_quote ?? r.evidence_text ?? '');
  let doc = null as null | { id: string; url: string; label: string; kind: string; date_iso: string | null };
  if (docs && docs.length) {
    doc = (r.source_document_id && docs.find((d) => d.id === r.source_document_id))
      || docs.find((d) => d.label && name && (d.label.toLowerCase() === name.toLowerCase()))
      || docs.find((d) => d.label && name && (name.toLowerCase().includes(d.label.toLowerCase()) || d.label.toLowerCase().includes(name.toLowerCase())))
      || null;
  }
  const pm = PAGE_RE.exec(`${name} ${quote}`);
  return {
    source_id: r.source_document_id ?? doc?.id ?? null,
    source_name: name || doc?.label || '',
    source_url: r.source_url ?? doc?.url ?? null,
    source_type: r.source_type ?? doc?.kind ?? null,
    publication_date: r.source_date ?? doc?.date_iso ?? null,
    period: r.period ?? null,
    page_section: r.page != null ? `page ${r.page}` : pm ? (pm[1] ? `page ${pm[1]}` : pm[2]) : null,
    quote,
  };
}

/** The period two dated sides of one reading describe, when both are dated
 *  and the dates agree: "Q4 FY26: 59 days → 59 days by Q4 FY26" (ENTERO). */
export function samePeriodPair(before: string | null | undefined, after: string | null | undefined): string | null {
  if (!before || !after) return null;
  const a = datesIn(String(before)), b = datesIn(String(after));
  if (!a.length || !b.length) return null;
  const la = a.reduce((x, y) => (y.end > x.end ? y : x)), lb = b.reduce((x, y) => (y.end > x.end ? y : x));
  return la.end.getTime() === lb.end.getTime() ? lb.label : null;
}
