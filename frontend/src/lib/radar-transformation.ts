// ═══════════════════════════════════════════════════════════════════════════
// zzz1224 — Transformation Radar: is this a real business transformation, or ordinary business?
//
// The owner's rule: a transformation changes WHAT the business earns money from, or HOW MUCH it can earn. A new
// colour grade, a normal capacity addition, a single order of a few % of sales, or a better quarter's margin are
// ordinary business — even when the sentence proving them is clean.
//
// For each document this module answers five questions from management's own sentences (the proof quote plus up to
// eight "change lines" picked from the management text when the document is read):
//   1. what structurally changes (the mechanism)        — or ROUTINE / PLAN / CAPABILITY / UNCLEAR
//   2. how big it is (materiality)                      — LARGE / MEDIUM / SMALL / UNKNOWN; unknown earns nothing
//   3. how far it has got (proof stage)                 — Research → Qualification → Approval → Order → Production →
//                                                         Delivery → Revenue → EBITDA → FCF
//   4. what would prove it wrong (key risk)
//   5. what to check next (next milestone)
// and puts the document in one research state:
//   ROUTINE (0) · INSUFFICIENT · EMERGING (1) · COMMERCIAL (2) · EARNINGS_POWER (3)
// Investable (state 4) is never decided here: there is no forward earnings model, so valuation stays a separate check.
// Six eligibility gates come first; a failed gate keeps a document off the shortlist, an unknown gate is shown as such.
// Business change and earnings growth are kept apart: a growing company is not "transforming" because of a keyword.
// Rules only, no AI, no price input. Pure.
// ═══════════════════════════════════════════════════════════════════════════

export type Mechanism =
  | 'MIX_SHIFT'              // share of a higher-value product / segment moved by ≥ 10 points
  | 'NEW_PRODUCT_LINE'       // commercial production of a new product line has started
  | 'NEW_CUSTOMER'           // first order / onboarding / qualification with a new customer type
  | 'NEW_BUSINESS'           // a new segment, business or market entered and producing
  | 'ORDER_STEP'             // an order won that is ≥ 10% of annual sales
  | 'CAPACITY_STEP'          // capacity up ≥ 50% (or doubled) — capacity is not profit
  | 'FACILITY_TURNAROUND'    // one plant / subsidiary turned around (utilisation, margin)
  | 'ROUTINE'                // ordinary business: product variants, normal capacity, small order, margin commentary
  | 'PLAN'                   // talk about the future only
  | 'CAPABILITY'             // a capability or pilot, not commercial use
  | 'UNCLEAR';               // no mechanism can be read from the sentences

export type ResearchState = 'ROUTINE' | 'INSUFFICIENT' | 'EMERGING' | 'COMMERCIAL' | 'EARNINGS_POWER';
export type MaterialityLevel = 'LARGE' | 'MEDIUM' | 'SMALL' | 'UNKNOWN';
export type Scope = 'CONSOLIDATED' | 'SEGMENT' | 'ONE_SITE' | 'SUBSIDIARY' | 'UNKNOWN';
export type GateResult = 'PASS' | 'FAIL' | 'UNKNOWN';
export type ProofStage = 'Research' | 'Qualification' | 'Approval' | 'Order' | 'Production' | 'Delivery' | 'Revenue' | 'EBITDA' | 'FCF';

export interface Gate { key: 'mechanism' | 'primary_source' | 'dated' | 'not_routine' | 'materiality' | 'contradictions'; label: string; result: GateResult; note: string }

export interface Transformation {
  state: ResearchState;
  stateWord: string;            // plain words for the state
  stateReason: string;
  mechanism: Mechanism;
  mechanismWord: string;
  /** the sentence the verdict rests on (the proof quote or one of the change lines) */
  evidence: { quote: string; actual: 'ACTUAL' | 'PLAN'; scope: Scope; entity: { ok: boolean | null; note: string } };
  materiality: { level: MaterialityLevel; text: string; scenario: boolean };
  proofStage: ProofStage | null;
  thesis: { oldBusiness: string; whatChanges: string; earningsImpact: string; keyRisk: string; nextMilestone: string; sectorCheck: string | null };
  gates: Gate[];
  contradiction: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** zzz1224c — CONFIRMED: every gate passes on one evidence sentence and the mechanism changes the business;
   *  WATCH: a plausible structural change with something still unknown (size, attribution, event date) — research, not proof;
   *  EXCLUDED: ordinary business or not enough evidence */
  tier: 'CONFIRMED' | 'WATCH' | 'EXCLUDED';
  /** on the confirmed shortlist (tier CONFIRMED) */
  shortlist: boolean;
  /** ordinal sort key, higher first — never shown as a score */
  rankKey: number;
}

export interface TransformationInput {
  symbol?: string | null;
  company_name?: string | null;
  evidence_label?: string | null;
  evidence_quote?: string | null;
  change_lines?: string[] | null;
  quote_role?: string | null;          // MANAGEMENT / COMPANY / ANALYST / UNKNOWN
  filing_datetime?: string | null;
  review_queue?: string | null;
}

export interface TransformationFacts {
  salesCr?: number | null;
  industry?: string | null;
  sector?: string | null;
  /** results check from radar-insight (latest quarter vs last year) */
  resultsVerdict?: string | null;
  lowBase?: boolean;
}

const STATE_ORDER: Record<ResearchState, number> = { ROUTINE: 0, INSUFFICIENT: 0, EMERGING: 1, COMMERCIAL: 2, EARNINGS_POWER: 3 };
const MAT_ORDER: Record<MaterialityLevel, number> = { LARGE: 3, MEDIUM: 2, UNKNOWN: 1, SMALL: 0 };

export const STATE_WORD: Record<ResearchState, string> = {
  ROUTINE: 'Ordinary business',
  INSUFFICIENT: 'Insufficient evidence',
  EMERGING: 'Potential transformation (research watch)',
  COMMERCIAL: 'Commercial change confirmed',
  EARNINGS_POWER: 'Earnings-power change confirmed',
};

export const MECHANISM_WORD: Record<Mechanism, string> = {
  MIX_SHIFT: 'Shift to higher-value products',
  NEW_PRODUCT_LINE: 'New product line in production',
  NEW_CUSTOMER: 'New customer type',
  NEW_BUSINESS: 'New business or market',
  ORDER_STEP: 'Large order versus sales',
  CAPACITY_STEP: 'Large capacity step',
  FACILITY_TURNAROUND: 'One plant / unit turned around',
  ROUTINE: 'Ordinary business',
  PLAN: 'Plans only',
  CAPABILITY: 'Capability, not commercial',
  UNCLEAR: 'No mechanism stated',
};

const DONE = /\b(received|won|secured|bagged|awarded|commenc\w*|commission\w*|started|began|begun|achieved|completed|qualified|approved|cleared|onboarded|launched|operational|delivered|signed|executed|transitioned|increased|rose|grew|improved|expanded|reached|entered)\b/i;
const FUTURE = /\b(will|shall|would|could|may|might|expect\w*|anticipat\w*|plan(?:s|ned|ning)?|intend\w*|aim\w*|target\w*|going forward|potential(?:ly)?|pipeline|opportunit\w+|roadmap|long[- ]term value drivers?|framework|guidance|envisag\w*|proposed|upcoming|over the next|trying to|aspir\w*|journey|till FY\s?\d{2}|by FY\s?\d{2})\b/i;
const MONEY = /(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|mn\b|million|bn\b|billion)|([\d,]+(?:\.\d+)?)\s*(crores?|cr\b)/i;

// "NREwon" (a PDF run-together) → "NRE won"
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').replace(/\b([A-Z]{2,})(won|secured|bagged|received|has)\b/g, '$1 $2').trim();
const toCr = (v: number, unit: string) => (/lakh/i.test(unit) ? v / 100 : /^(mn|million)/i.test(unit) ? v / 10 : /^(bn|billion)/i.test(unit) ? v * 100 : v);

/** The largest money amount in a sentence, ₹ crore. */
export function amountCr(s: string): number | null {
  let best: number | null = null;
  const re = new RegExp(MONEY.source, 'gi');
  for (const m of s.matchAll(re)) {
    const v = Number(String(m[1] ?? m[3]).replace(/,/g, ''));
    if (!Number.isFinite(v) || v <= 0) continue;
    const cr = toCr(v, String(m[2] ?? m[4]));
    if (best == null || cr > best) best = cr;
  }
  return best;
}

/** Share moved from a% to b% (a share / mix / contribution sentence). Returns the two shares or null. */
export function shareShift(s: string): { from: number; to: number } | null {
  // zzz1224d — a share of the COMPANY'S OWN revenue / sales / volumes / business, and a stated movement. Not a margin (SPECIALITY
  // "gross margins by 1.2% to 71.1%"), not an industry statistic (INDUSTOWER "5G … 44% of total data consumption"), not a range
  // (LEAPIND "30% to 40% of the business of automobile is in the South")
  if (!/\b(share|contribut\w*|mix|portion|proportion)\b/i.test(s)) return null;
  if (!/\b(revenue|sales|turnover|top ?line|business|volumes?|portfolio|income|trade sales)\b/i.test(s)) return null;
  if (/\bmargins?\b/i.test(s) && !/\bshare\b/i.test(s)) return null;
  // "increased by 6% to 74%": the first figure is the change, not the starting share
  const by = s.match(/\b(?:increased|improved|rose|grew|up|expanded|moved up|gone up|went up)\s+by\s+(\d{1,2}(?:\.\d+)?)\s?(?:%|percentage points?|pp|points?)\s*(?:to|→)\s*(\d{1,3}(?:\.\d+)?)\s?%/i);
  if (by) { const to = Number(by[2]), from = Math.round((to - Number(by[1])) * 10) / 10; return from >= 0 && to <= 100 ? { from, to } : null; }
  const VERB = /\b(increased|improved|rose|risen|grew|grown|moved|gone up|went up|expanded|jumped|climbed|up)\b/i;
  const m = (VERB.test(s) ? s.match(/\bfrom\s+(?:about\s+|around\s+|nearly\s+|~)?(\d{1,2}(?:\.\d+)?)\s?%\s*(?:to|→|->)\s*(?:about\s+|around\s+|nearly\s+|~)?(\d{1,3}(?:\.\d+)?)\s?%/i) : null)
    || s.match(/(\d{1,2}(?:\.\d+)?)\s?%\s*(?:→|->)\s*(\d{1,3}(?:\.\d+)?)\s?%/);
  const up = !m && s.match(/(\d{1,3}(?:\.\d+)?)\s?%[^.%]{0,70}?\b(?:up|increased|rising|rose|grew|higher) from (?:about |around |~)?(\d{1,2}(?:\.\d+)?)\s?%/i);
  if (up) { const to = Number(up[1]), from = Number(up[2]); return from >= 0 && to <= 100 && from !== to ? { from, to } : null; }
  if (!m) return null;
  const from = Number(m[1]), to = Number(m[2]);
  if (!(from >= 0 && to <= 100 && from !== to)) return null;
  return { from, to };
}

/** Capacity from X to Y (same unit) — the ratio, or 2 for "doubled", 3 for "tripled". */
export function capacityStep(s: string): number | null {
  if (!/\bcapacit\w*|\bTPA\b|\bTPM\b|\bMTPA\b|\bKLPA\b|\bunits?\b|\bMW\b|\bGW\b/i.test(s)) return null;
  if (/\btripl\w*|three[- ]?fold|3x\b/i.test(s)) return 3;
  if (/\bdoubl\w*|two[- ]?fold|2x\b/i.test(s)) return 2;
  const m = s.match(/from\s+([\d,]+(?:\.\d+)?)\s*([A-Za-z]{0,6})\s*(?:to|→)\s*([\d,]+(?:\.\d+)?)\s*([A-Za-z]{0,6})/i);
  if (!m) return null;
  const a = Number(m[1].replace(/,/g, '')), b = Number(m[3].replace(/,/g, ''));
  if (!(a > 0 && b > a)) return null;
  if (m[2] && m[4] && m[2].toLowerCase() !== m[4].toLowerCase()) return null;
  return b / a;
}

/** Order / share / step size → materiality level. */
function levelFromPct(p: number | null): MaterialityLevel { return p == null ? 'UNKNOWN' : p >= 25 ? 'LARGE' : p >= 10 ? 'MEDIUM' : 'SMALL'; }

/** Is the event attributed to the listed company? "NRE won …" names a subsidiary / affiliate whose share is not stated. */
export function entityOf(s: string, symbol?: string | null, company?: string | null): { ok: boolean | null; note: string } {
  const q = clean(s);
  if (/\b(subsidiar\w*|joint venture|\bJV\b|associate compan\w*|step-down)\b/i.test(q)) return { ok: null, note: 'Event sits in a subsidiary / joint venture — the listed company’s share is not stated.' };
  const m = q.match(/(?:^|[:;]\s*)([A-Z][A-Za-z&]{1,12})(?=(?:won|secured|bagged|received)\b|\s+(?:has\s+)?(?:won|secured|bagged|received)\b)/);
  if (m) {
    const who = m[1].toLowerCase();
    const sym = String(symbol || '').toLowerCase(), name = String(company || '').toLowerCase();
    const initials = name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('');
    const isUs = ['we', 'our', 'the', 'company', 'it'].includes(who) || (sym && (sym.startsWith(who) || who.startsWith(sym.slice(0, 4))))
      || (name && name.includes(who)) || (initials && initials.startsWith(who));
    if (!isUs) return { ok: false, note: `The sentence credits “${m[1]}”, not the listed company — a subsidiary or affiliate; the listed company’s share is not stated.` };
  }
  return { ok: true, note: 'Attributed to the company.' };
}

/** Scope of the figures in the sentence. */
export function scopeOf(s: string): Scope {
  const q = clean(s);
  if (/\bconsolidated\b/i.test(q)) return 'CONSOLIDATED';
  if (/\b(subsidiar\w*|joint venture|\bJV\b)\b/i.test(q)) return 'SUBSIDIARY';
  if (/\b(?:our|the|its)\s+(?:\w+\s+){0,3}(plant|facility|unit|factory|site|mill)\b/i.test(q) && /\b(utili[sz]ation|margins?|ran at|running at)\b/i.test(q)) return 'ONE_SITE';
  if (/\bsegment\b|\bdivision\b|\bvertical\b|\bbusiness unit\b/i.test(q)) return 'SEGMENT';
  return 'UNKNOWN';
}

/** A consolidated figure that contradicts a segment / one-site improvement ("segment margins up, consolidated margin moderated"). */
export function contradictionOf(lines: string[]): string | null {
  for (const raw of lines) {
    const s = clean(raw);
    if (/\bconsolidated\b[^.]{0,80}\b(moderat\w*|declin\w*|lower|contract\w*|compress\w*|fell|down|dip\w*|reduc\w*)\b|\b(moderat\w*|declin\w*|compress\w*|dip\w*)\b[^.]{0,60}\bconsolidated\b/i.test(s)) {
      return `The company says the consolidated figure weakened: “${s.slice(0, 180)}${s.length > 180 ? '…' : ''}”`;
    }
  }
  return null;
}

interface Read {
  mech: Mechanism;
  why: string;
  stage: ProofStage | null;
  pct: number | null;             // size as % of annual sales / share points / capacity step %
  level: MaterialityLevel;
  matText: string;
  scenario: boolean;
  quote: string;
  actual: 'ACTUAL' | 'PLAN';
}

const ROUTINE_VARIANTS = /\b(colou?r grades?|shades?|variants?|SKUs?|flavou?rs?|new\/improved products?|improved products\b|product (?:extensions?|refresh\w*)|line extensions?|new designs?)\b/i;
const CAPABILITY_RE = /\b(capabilit\w*|enabl\w*|pilot(?: plant| scale| facilit\w*)?|lab[- ]scale|from lab|facilities for|equipped to|ability to|can (?:support|handle|serve)|ready to serve)\b/i;
const OPS_MARGIN = /\b(margins?|ebitda|profitab\w*|operating leverage|realisations?|realizations?)\b/i;
const OPS_DRIVERS = /\b(mix|efficienc\w*|operating leverage|cost (?:reduction|control|optimi\w*)|volume growth|pricing|price increases?|freight|discount\w*|raw material|input cost|lower costs?)\b/i;
// zzz1224b — "new customers added" / "new clients onboarded" is routine growth, never a first-of-a-kind event
// zzz1224d — "our / its / a / the first … order / customer / contract / export order" next to a completed verb. "First point", "the
// first step", "a soft first quarter", "until we start the first supply", "first customer migration" are not first-of-a-kind events.
const FIRST_RE = /\b(?:our|its|their|a|the)\s+(?:very\s+)?(?:first|maiden|debut)(?:[- ]ever)?\s+(?:purchase\s+|commercial\s+|export\s+|international\s+|overseas\s+|bess\s+|large\s+)?(?:order|customer|contract|export order|supply order)s?\b(?!\s+(?:migration|meet|base|service|experience|journey|engagement))/i;
const FIRST_DONE = /\b(received|secured|won|bagged|got|getting|marks|delivered|executed|completed|signed|awarded|securing|bagging|winning|shipped)\b/i;
const FIN_RE = /\b(bank|nbfc|non banking|financ|lending|credit|insurance|housing fin|microfin|asset manag|broking|stockbroking|depositor|clearing|capital market|wealth|intermediar)/i;
const MOU_RE = /\b(mou|memorandum of understanding|letter of intent|\bloi\b|tie[d-]? up|tied up|framework agreement)\b/i;
// zzz1224d — a NAMED new segment / business / vertical / product category entered; not a year ("when we entered FY27"), not a
// negation, not "this segment", not a micro-market or a city (ordinary expansion), not an agreement / MoU
const NEW_BIZ = /\b(?:entered|forayed|foray into|ventured into|diversified into)\s+(?:into\s+)?(?:the\s+|a\s+|new\s+)*(?!this\b|that\b|fy\b|fy\d|the fy|financial year|20\d\d|into an?\b)[A-Za-z][\w&,/-]*(?:\s+[\w&,/-]+){0,4}?\s+(?:segments?|business(?:es)?|verticals?|categor(?:y|ies)|industr(?:y|ies)|space|sectors?)\b|\bnew (?:segment|business|vertical) (?:of|in|for)\b/i;
const EXPAND_RE = /\b(expan\w*|expanded|additional|added|adding|increas\w* (?:the )?(?:installed )?capacity|debottleneck\w*|brownfield|enhanc\w* capacity|augment\w*)\b/i;
const NEW_LINE = /\bcommercial production of (?:our |the |a )?(?:new )?([a-z][\w -]{3,60}?)\s+(?:has\s+)?(?:commenced|started|begun)|\b(?:commenced|started|began) commercial production of (?:our |the |a )?(?:new )?([a-z][\w -]{3,60})/i;
const WON = /\b(received|won|secured|bagged|awarded|order inflows?|letter of (?:award|intent)|LoA|purchase order)\b/i;

const amt0 = (q: string) => amountCr(q);
const isSlideFragment = (q: string) => (q.match(/(?:^|\s)[-+]?\d[\d.,]*%?(?=\s|$)/g) || []).length >= 7 || (String(q).match(/[a-z0-9%)]\s[A-Z][a-z]{2,}/g) || []).length >= 3;

function readSentence(raw: string, salesCr: number | null, lender = false): Read {
  const q = clean(raw);
  const base = { quote: q, scenario: false } as const;
  const plan = FUTURE.test(q) && !/\b(has|have|had)\s+(?:been\s+)?(commenc|start|won|secur|receiv|complet|achiev)\w*/i.test(q) && !/\b(commenced|secured|won|bagged|received|onboarded|qualified|approved)\b/i.test(q);
  const actual: 'ACTUAL' | 'PLAN' = plan ? 'PLAN' : 'ACTUAL';
  if (!q) return { ...base, mech: 'UNCLEAR', why: 'No sentence to read.', stage: null, pct: null, level: 'UNKNOWN', matText: '', actual };

  // ── ordinary business first: these never become a transformation however clean the sentence ──
  if (isSlideFragment(q)) return { ...base, mech: 'UNCLEAR', why: 'Slide chart or table text — no sentence states what changes.', stage: null, pct: null, level: 'UNKNOWN', matText: '', actual };
  if (/\b(exceptional (?:gain|income|item)|one[- ]?(?:off|time) (?:gain|income)|profit on sale of|gain on (?:sale|disposal)|fair value gain|write[- ]back|deferred tax (?:credit|asset)|tax refund)\b/i.test(q)) {
    return { ...base, mech: 'ROUTINE', why: 'An accounting or one-off gain — not a change in the business.', stage: null, pct: null, level: 'SMALL', matText: 'One-off item.', actual };
  }
  if (/\b(renam\w*|re-?brand\w*|re-?classif\w*|re-?organi[sz]\w* (?:our|the) segments?|now report\w*|re-?segment\w*)\b/i.test(q)) {
    return { ...base, mech: 'ROUTINE', why: 'A new name or reporting label — the business itself is unchanged.', stage: null, pct: null, level: 'SMALL', matText: 'Label change only.', actual };
  }
  if (/\b(acqui\w*|merger|amalgamat\w*|consolidated from|inorganic)\b/i.test(q) && /\b(growth|grew|revenue|sales|driven|contribut\w*)\b/i.test(q)) {
    return { ...base, mech: 'ROUTINE', why: 'Growth from an acquisition — bought revenue, not a change in the existing business.', stage: 'Revenue', pct: null, level: 'UNKNOWN', matText: 'Acquired revenue; organic change not shown.', actual };
  }
  if (/\blow base\b|\b(?:on|from) a (?:weak|depressed|low) base\b/i.test(q)) {
    return { ...base, mech: 'ROUTINE', why: 'Growth on a low base — a recovery, not a change in the business.', stage: 'Revenue', pct: null, level: 'UNKNOWN', matText: 'Low base.', actual };
  }
  if (ROUTINE_VARIANTS.test(q) && !NEW_BIZ.test(q)) {
    return { ...base, mech: 'ROUTINE', why: 'New products / grades / variants of what the company already sells — product development, not a change in the business.', stage: 'Production', pct: null, level: 'SMALL', matText: 'Product variants: no change in what the business earns from.', actual };
  }
  if (CAPABILITY_RE.test(q) && !/\b(commenced|started|won|secured|revenue|orders? (?:received|won))\b/i.test(q)) {
    return { ...base, mech: 'CAPABILITY', why: 'Describes a capability or pilot facility — not commercial use by customers.', stage: 'Research', pct: null, level: 'UNKNOWN', matText: 'Capability only: no revenue, order or customer stated.', actual };
  }

  if (MOU_RE.test(q) && !/\b(commenc\w*|started|began|begun|commission\w*|received (?:an? )?(?:order|purchase order)|won|bagged)\b/i.test(q)) {
    return { ...base, mech: 'PLAN', why: 'An MoU / tie-up / letter of intent — an intention, not a completed order or start.', stage: null, pct: null, level: 'UNKNOWN', matText: 'MoU only: no committed volume or value.', actual: 'PLAN' };
  }
  if (lender && /\b(new (?:branch\w*|geograph\w*|state|market|segment|product|customers?|clients?)|maiden|foray|entered|expan\w*|footprint|onboard\w*|disburs\w*|aum|book)\b/i.test(q) && !shareShift(q)) {
    return { ...base, mech: 'ROUTINE', why: 'For a lender, broker or asset manager, new branches, states, products and customers are routine growth, not a change in the business.', stage: 'Revenue', pct: null, level: 'UNKNOWN', matText: 'Routine financial-services growth.', actual };
  }

  // ── share / mix shift with numbers ──
  const sh = shareShift(q);
  if (sh && !plan) {
    const pp = Math.round(sh.to - sh.from);
    if (pp >= 10) {
      const lvl: MaterialityLevel = pp >= 20 ? 'LARGE' : 'MEDIUM';
      return { ...base, mech: 'MIX_SHIFT', why: `Share moved from ${sh.from}% to ${sh.to}% (+${pp} points).`, stage: 'Revenue', pct: pp, level: lvl, matText: `Mix share +${pp} points (${sh.from}% → ${sh.to}%). Effect on profit depends on the margin gap between the products — not stated.`, actual };
    }
    if (pp > 0) return { ...base, mech: 'ROUTINE', why: `Share moved only ${pp} points (${sh.from}% → ${sh.to}%) — normal mix movement.`, stage: 'Revenue', pct: pp, level: 'SMALL', matText: `Mix share +${pp} points only.`, actual };
  }

  // ── orders ──
  const amt = amountCr(q);
  if (/\border ?book\s+(?:stands|stood|is|was|of|at|remains|aggregat\w*|comprising|as on)\b|\border ?book (?:stands|is|was) at\b/i.test(q) && !/\b(?:won|bagged|awarded|secured)\b[^.]{0,40}\border/i.test(q)) {
    return { ...base, mech: 'ROUTINE', why: 'A total order book is the stock of past orders — revenue visibility, not a change in the business.', stage: 'Order', pct: null, level: 'UNKNOWN', matText: amt0(q) != null ? `Order book ₹${Math.round(amt0(q)!).toLocaleString('en-IN')} Cr (total, not new).` : 'Order book (total, not new).', actual };
  }
  if ((WON.test(q) || /\border inflows?\b/i.test(q)) && /\border|contract|LoA|letter of award/i.test(q) && !plan) {
    // the order book named in the same sentence is a stock, not the new order: size only the new order / inflow
    const newOnly = amountCr(q.replace(/\b(?:taking |takes |took |with )?(?:the |our |total |consolidated |closing |outstanding )*order ?book\b[^;]{0,80}?(?:crores?|cr\b|lakhs?|mn\b|million|bn\b|billion)/gi, ' '));
    const amt = newOnly ?? (/\b(?:secured|won|bagged)\s+(?:an?\s+)?[\w-]*\s*order ?book\s+of\b/i.test(q) ? amountCr(q) : null);   // "secured an HTLS order book of ₹200 Cr" — that book IS the new order
    const pct = amt != null && salesCr && salesCr > 0 ? Math.round((100 * amt) / salesCr) : null;
    const lvl = levelFromPct(pct);
    const first = FIRST_RE.test(q);
    if (/\bbefore (?:the )?ipo|pre-ipo|since inception|till date|to date|cumulative\b/i.test(q)) {
      return { ...base, mech: 'ROUTINE', why: 'Orders counted over a long past period (before the IPO / to date) — not a new event.', stage: 'Order', pct, level: lvl, matText: amt != null ? `₹${Math.round(amt).toLocaleString('en-IN')} Cr over a past period.` : 'Past cumulative orders.', actual };
    }
    const matText = amt == null ? 'Order value not stated in the sentence.' : pct == null
      ? `Order of about ₹${Math.round(amt).toLocaleString('en-IN')} Cr; annual sales not available to size it.`
      : `Order of about ₹${Math.round(amt).toLocaleString('en-IN')} Cr ≈ ${pct}% of annual sales. Orders are not revenue until delivered; margin unknown.`;
    if (first) return { ...base, mech: 'NEW_CUSTOMER', why: 'First order from a new customer type.', stage: 'Order', pct, level: lvl === 'SMALL' ? 'SMALL' : lvl, matText, scenario: lvl === 'UNKNOWN' || lvl === 'SMALL', actual };
    // zzz1224d — order inflow over a period is many orders: normal business for an order-driven company. One order counts for the
    // research watch only when it is at least a quarter of a year's sales (and even then it is visibility, not a new business)
    if (pct != null && /\border inflows?\b|\borders? (?:totall?ing|aggregating|worth a total)\b|\bnew orders\b/i.test(q)) return { ...base, mech: 'ROUTINE', why: `Order inflow of ≈ ${pct}% of annual sales over the period — normal order flow for an order-driven business, not a change in the business.`, stage: 'Order', pct, level: 'SMALL', matText, actual };
    if (pct != null && pct >= 25) return { ...base, mech: 'ORDER_STEP', why: `One order ≈ ${pct}% of annual sales — earnings visibility; not by itself a change in the business.`, stage: 'Order', pct, level: lvl, matText, actual };
    if (pct != null) return { ...base, mech: 'ROUTINE', why: `A single order of ≈ ${pct}% of annual sales — normal order flow.`, stage: 'Order', pct, level: 'SMALL', matText, actual };
    return { ...base, mech: 'UNCLEAR', why: 'Order won, but its size against sales is not known.', stage: 'Order', pct: null, level: 'UNKNOWN', matText, actual };
  }
  if (/\border ?book\b/i.test(q) && !WON.test(q)) {
    return { ...base, mech: 'ROUTINE', why: 'A total order book is the stock of past orders — revenue visibility, not a change in the business.', stage: 'Order', pct: null, level: 'UNKNOWN', matText: amt != null ? `Order book ₹${Math.round(amt).toLocaleString('en-IN')} Cr (total, not new).` : 'Order book (total, not new).', actual };
  }

  // ── production / capacity ──
  const step = capacityStep(q);
  const produced = /\b(commenc\w*|started|began|begun|commission\w*|operational|trial production)\b/i.test(q) && /\b(production|plant|facility|capacity|line|manufactur\w*|operations?)\b/i.test(q);
  if (produced && !plan) {
    const trial = /\btrial production|trial runs?\b/i.test(q);
    const nl = q.match(NEW_LINE);
    const expanded = EXPAND_RE.test(q);
    if (step != null && step >= 1.5) {
      const p = Math.round((step - 1) * 100);
      return { ...base, mech: 'CAPACITY_STEP', why: `Capacity up about ${p}% (${step.toFixed(1)}×).`, stage: trial ? 'Production' : 'Production', pct: p, level: step >= 2 ? 'LARGE' : 'MEDIUM', matText: `Capacity +${p}%. Capacity is not profit: utilisation and pricing decide the earnings.`, scenario: true, actual };
    }
    if (nl && !expanded && !trial) {
      const what = clean(nl[1] || nl[2]).replace(/\s+(?:and|with|at|in)\b.*$/i, '');
      return { ...base, mech: 'NEW_PRODUCT_LINE', why: `Commercial production of ${what} has started.`, stage: 'Production', pct: null, level: 'UNKNOWN', matText: `Scale unknown: the share of ${what} in sales is not stated.`, actual };
    }
    if (expanded || step != null || /\b(capacity|units?|TPA|TPM|KLPA|MW)\b/i.test(q)) {
      return { ...base, mech: 'ROUTINE', why: step != null ? `Capacity up ${Math.round((step - 1) * 100)}% — ordinary expansion.` : 'Capacity added or expanded, size against existing capacity not stated — capacity is not profit.', stage: 'Production', pct: step != null ? Math.round((step - 1) * 100) : null, level: step != null ? 'SMALL' : 'UNKNOWN', matText: 'Ordinary capacity addition; utilisation not stated.', actual };
    }
    if (trial) return { ...base, mech: 'CAPABILITY', why: 'Trial production only — not commercial supply.', stage: 'Production', pct: null, level: 'UNKNOWN', matText: 'Trial production: scale unknown.', actual };
  }

  if (!plan && /\b(added|adding|expanded|increased|augment\w*)\b[^.]{0,40}\b(capacit\w*|TPA|TPM|MTPA|KLPA|MW|units)\b|\b(capacit\w*)\b[^.]{0,30}\b(added|expanded|increased)\b/i.test(q)) {
    if (step != null && step >= 1.5) {
      const p = Math.round((step - 1) * 100);
      return { ...base, mech: 'CAPACITY_STEP', why: `Capacity up about ${p}% (${step.toFixed(1)}×).`, stage: 'Production', pct: p, level: step >= 2 ? 'LARGE' : 'MEDIUM', matText: `Capacity +${p}%. Capacity is not profit: utilisation and pricing decide the earnings.`, scenario: true, actual };
    }
    return { ...base, mech: 'ROUTINE', why: 'Capacity added, size against existing capacity not stated — capacity is not profit.', stage: 'Production', pct: null, level: 'UNKNOWN', matText: 'Ordinary capacity addition; utilisation not stated.', actual };
  }

  // ── one plant / unit turned around ──
  if (scopeOf(q) === 'ONE_SITE' || (/\b(plant|facility|unit|subsidiary)\b/i.test(q) && /\butili[sz]ation\b/i.test(q) && /\bmargins?\b/i.test(q))) {
    if (!plan && /\b(improved|rose|increased|expanded|turned|ran at|running at)\b/i.test(q)) {
      return { ...base, mech: 'FACILITY_TURNAROUND', why: 'One plant / unit improved (utilisation or margin).', stage: 'EBITDA', pct: null, level: 'UNKNOWN', matText: 'One facility only: its share of consolidated sales and profit is not stated.', actual };
    }
  }

  // ── new customers / business ──
  if (/\b(cdmo|contract (?:development|manufactur\w*))\b/i.test(q) && /\b(customers?|clients?)\b/i.test(q) && /\b(onboard\w*|signed|won|added)\b/i.test(q) && !plan) {
    return { ...base, mech: 'NEW_BUSINESS', why: 'Customers onboarded in a contract manufacturing business.', stage: 'Qualification', pct: null, level: 'UNKNOWN', matText: 'Size unknown: customers onboarded, revenue not stated.', scenario: true, actual };
  }
  if (!plan && !/\b(board|director|independent|regulat\w*|statutory|personnel|staff|team|engineers|people)\b/i.test(q)
    && (/\b(qualified|approved|validated|cleared)\b[^.]{0,50}\b(customers?|clients?|oems?|innovators?|automakers?|utilit(?:y|ies))\b|\b(customers?|clients?|oems?|innovators?)\b[^.]{0,50}\b(qualified|approved|validated|cleared)\b/i.test(q))) {
    return { ...base, mech: 'NEW_CUSTOMER', why: 'Qualified / approved by new customers.', stage: 'Qualification', pct: null, level: 'UNKNOWN', matText: 'Size unknown: qualification comes before orders; volumes not stated.', scenario: true, actual };
  }
  // zzz1224d — "first quarter of commercial revenue from the Battery Chemicals business": revenue from a new business has begun
  const firstRev = q.match(/\bfirst (?:full )?(?:quarter|year|half) of (?:commercial )?revenues? from (?:the |our |its )?([A-Za-z][\w &-]{2,40}?) (?:business|segment|vertical|division)\b/i);
  if (firstRev && !plan) return { ...base, mech: 'NEW_BUSINESS', why: `Revenue from a new business (${firstRev[1].trim()}) has begun.`, stage: 'Revenue', pct: null, level: 'UNKNOWN', matText: `Size unknown: the ${firstRev[1].trim()} business's share of sales is not stated.`, scenario: true, actual };
  if (FIRST_RE.test(q) && FIRST_DONE.test(q) && !plan && !/\b(until|unless|before|once|when we)\b/i.test(q)) return { ...base, mech: 'NEW_CUSTOMER', why: 'First order / customer of a new kind.', stage: /qualif|approv/i.test(q) ? 'Qualification' : 'Order', pct: null, level: 'UNKNOWN', matText: 'Size unknown: one first customer or order.', scenario: true, actual };
  if (NEW_BIZ.test(q) && !plan && !/\b(not|never|yet to|before we|when we|since|from (?:19|20)\d\d|in (?:19|20)\d\d)\b/i.test(q)) return { ...base, mech: 'NEW_BUSINESS', why: 'Entered a new segment / market.', stage: 'Revenue', pct: null, level: 'UNKNOWN', matText: 'Size unknown: revenue from the new business not stated.', scenario: true, actual };
  if (!plan && !/\b(board|shareholders?|director|PLI|incentive|subsid\w*|strateg\w*|funds?|scheme|claim|insurance|loan|sanction\w*|limit|resolution|merger|amalgamation|dividend|listing)\b/i.test(q)
    && /\b(?:received|got|obtained|secured|granted)\b[^.]{0,40}\b(approval|clearance|EIR|nod)\b|\b(approval|clearance|EIR)\b[^.]{0,20}\b(?:received|granted)\b|\b(?:has|have) been (?:approved|qualified|cleared)\b/i.test(q)) {
    return { ...base, mech: 'NEW_CUSTOMER', why: 'Regulatory or customer approval received.', stage: 'Approval', pct: null, level: 'UNKNOWN', matText: 'Size unknown: an approval opens a market; sales from it are not stated.', scenario: true, actual };
  }

  // ── margin / results commentary ──
  if (OPS_MARGIN.test(q)) {
    if (plan) return { ...base, mech: 'PLAN', why: 'Margin framework or target — not an achieved change.', stage: null, pct: null, level: 'UNKNOWN', matText: '', actual };
    return { ...base, mech: 'ROUTINE', why: OPS_DRIVERS.test(q) ? 'Margin improved through mix, efficiency, volume or pricing — an operational improvement, not a structural change.' : 'Margin / profit commentary with no structural cause named — operational results.', stage: 'EBITDA', pct: null, level: 'UNKNOWN', matText: 'Results commentary: no change in the business named.', actual };
  }
  if (plan) return { ...base, mech: 'PLAN', why: 'Plans, priorities or targets — nothing achieved yet.', stage: null, pct: null, level: 'UNKNOWN', matText: '', actual };
  return { ...base, mech: 'UNCLEAR', why: 'The sentence names no mechanism that changes the business.', stage: null, pct: null, level: 'UNKNOWN', matText: '', actual };
}

const MECH_STATE: Record<Mechanism, ResearchState> = {
  // zzz1224c — a large order is earnings visibility, not by itself a change in the business: research watch at most
  MIX_SHIFT: 'COMMERCIAL', NEW_PRODUCT_LINE: 'COMMERCIAL', ORDER_STEP: 'EMERGING',
  NEW_CUSTOMER: 'EMERGING', NEW_BUSINESS: 'EMERGING', CAPACITY_STEP: 'EMERGING', FACILITY_TURNAROUND: 'EMERGING',
  ROUTINE: 'ROUTINE', PLAN: 'INSUFFICIENT', CAPABILITY: 'INSUFFICIENT', UNCLEAR: 'INSUFFICIENT',
};

const RISK: Record<Mechanism, string> = {
  MIX_SHIFT: 'The higher-value share falls back next quarter, or the consolidated margin does not move.',
  NEW_PRODUCT_LINE: 'The new line stays a small share of sales, or volumes do not ramp up.',
  NEW_CUSTOMER: 'No repeat or larger order follows; the first order stays a one-off.',
  NEW_BUSINESS: 'Revenue from the new business stays immaterial or loss-making.',
  ORDER_STEP: 'Execution slips, or the order carries a low margin.',
  CAPACITY_STEP: 'Utilisation stays low or prices fall — capacity without demand is a cost.',
  FACILITY_TURNAROUND: 'The unit is too small to move consolidated profit, or the improvement reverses.',
  ROUTINE: 'Not a transformation.', PLAN: 'Plans not delivered.', CAPABILITY: 'Capability never becomes commercial supply.', UNCLEAR: '—',
};
const NEXT: Record<Mechanism, string> = {
  MIX_SHIFT: 'The higher-value share holds next quarter AND shows in consolidated gross / EBITDA margin.',
  NEW_PRODUCT_LINE: 'Revenue share and utilisation of the new line disclosed in the next results or call.',
  NEW_CUSTOMER: 'Repeat or scale-up orders from this customer type, with value.',
  NEW_BUSINESS: 'Revenue from the new business disclosed separately.',
  ORDER_STEP: 'Execution start and revenue booked from this order in the next results.',
  CAPACITY_STEP: 'Utilisation of the new capacity above 60–70% with stable pricing.',
  FACILITY_TURNAROUND: 'The unit’s share of consolidated sales / EBITDA, and the margin holding for two more quarters.',
  ROUTINE: '—', PLAN: 'A completed milestone (order, production start, customer approval) in a filing.', CAPABILITY: 'A first commercial order or customer for this capability.', UNCLEAR: 'A sentence that states what changes and by how much.',
};

/** P1 — what to check for this kind of company (sector templates). */
export function sectorCheckOf(industry?: string | null, sector?: string | null): string | null {
  const t = `${industry || ''} ${sector || ''}`.toLowerCase();
  if (/cable|wire|conductor/.test(t)) return 'Cables: share of high-value products (EHV / HTLS / special cables) in sales, and export share.';
  if (/pharma|drug|biotech|life science/.test(t)) return 'Pharma: approvals → first supply → share of regulated-market / CDMO revenue; one product’s weight in sales.';
  if (/chemical|fertili/.test(t)) return 'Chemicals: utilisation of new capacity and product spreads — capacity alone is not profit.';
  if (/auto|tyre|tire|vehicle|forg|casting|axle/.test(t)) return 'Auto components: new product content per vehicle, new OEM programmes, and their share of sales.';
  if (/capital goods|engineer|electrical equip|machinery|defen[cs]e|aerospace|construction|epc/.test(t)) return 'Capital goods / EPC: order inflow ÷ sales, execution period and margin of the new orders.';
  if (/software|it services|technology|computer/.test(t)) return 'Technology: share of recurring / platform revenue and large-deal wins against revenue.';
  if (/bank|nbfc|financ|lending|insurance/.test(t)) return 'Lenders: new branches and customers are routine growth; look for a change in product mix, cost of funds or asset quality.';
  if (/textile|apparel|garment|yarn/.test(t)) return 'Textiles: share of value-added / branded products and exports.';
  if (/rubber|plastic|packag|paper/.test(t)) return 'Materials: utilisation and spreads; a single plant’s share of group sales.';
  return null;
}

/** Pick the sentence lines that state a structural change, from management text (used when a document is read). */
export function changeLinesOf(text: string, max = 8): string[] {
  const body = String(text || '').replace(/\s+/g, ' ');
  if (!body) return [];
  const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z“"(])/).filter((s) => s.length >= 40 && s.length <= 420);
  const out: Array<{ s: string; w: number }> = [];
  for (const s of sentences) {
    let w = 0;
    if (shareShift(s)) w += 5;
    if (FIRST_RE.test(s)) w += 4;
    if (NEW_LINE.test(s)) w += 4;
    if ((capacityStep(s) ?? 0) >= 1.5) w += 3;
    if (WON.test(s) && amountCr(s) != null) w += 3;
    if (NEW_BIZ.test(s) && DONE.test(s)) w += 2;
    if (/\bconsolidated\b/i.test(s) && /\bmargins?\b/i.test(s)) w += 2;
    if (w === 0) continue;
    if (FUTURE.test(s) && !DONE.test(s)) w -= 2;
    if (/\?\s*$/.test(s)) continue;
    if (w > 0) out.push({ s: s.trim(), w });
  }
  const seen = new Set<string>();
  return out.sort((a, b) => b.w - a.w).map((x) => x.s).filter((s) => { const k = s.slice(0, 60).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, max);
}

/** zzz1224c — the sentence itself dates the event (a quarter, half, fiscal year, month, "this quarter" …); a filing date alone does not. */
export const EVENT_DATE_RE = /\b(Q[1-4]|H[12]|[1-4]Q|FY\s?['’]?\d{2}|20[2-3]\d|this (?:quarter|year|month|half)|(?:during|in) (?:the|this) (?:quarter|period|year|half|month)|(?:over|in) the (?:last|past) (?:quarter|year|twelve months|12 months)|over the year|year[- ]on[- ]year|yoy|as on date|recently|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? ?(?:'?\d{2,4})?)\b/i;
const OLD_RE = /\b(?:in|since|from|back in)\s+(?:19\d\d|200\d|201\d|202[0-3])\b|\b(over the (?:last|past) \d+ years|since (?:19|20)\d\d|track record|historically|in the past|before (?:the )?ipo|since inception)\b/i;

export function classifyTransformation(e: TransformationInput, f: TransformationFacts = {}, now: Date = new Date()): Transformation {
  const salesCr = typeof f.salesCr === 'number' && Number.isFinite(f.salesCr) && f.salesCr > 0 ? f.salesCr : null;
  const quote = clean(e.evidence_quote);
  const lines = [quote, ...(e.change_lines || []).map(clean)].filter(Boolean);
  const lender = FIN_RE.test(`${f.industry || ''} ${f.sector || ''}`);
  const reads = lines.map((l) => {
    const r = readSentence(l, salesCr, lender);
    // a first order, an approval or one turned-around unit rarely moves a ₹20,000 Cr+ business — small unless sized
    if (salesCr != null && salesCr >= 20_000 && ['NEW_CUSTOMER', 'NEW_BUSINESS', 'FACILITY_TURNAROUND', 'NEW_PRODUCT_LINE', 'CAPACITY_STEP'].includes(r.mech) && (r.level === 'UNKNOWN' || r.mech === 'CAPACITY_STEP')) {
      return { ...r, level: 'SMALL' as MaterialityLevel, matText: `Size not stated; against annual sales of ₹${Math.round(salesCr).toLocaleString('en-IN')} Cr one such event is unlikely to change the business.` };
    }
    return r;
  });
  // the strongest sentence decides: state, then size, then the proof quote first
  const scoreOf = (r: Read) => STATE_ORDER[MECH_STATE[r.mech]] * 10 + MAT_ORDER[r.level] * 2 + (r.mech === 'ROUTINE' ? 1 : 0);
  let pick = reads[0] ?? readSentence('', salesCr, lender);
  for (const r of reads.slice(1)) if (scoreOf(r) > scoreOf(pick)) pick = r;

  const role = String(e.quote_role || '').toUpperCase();
  const fromQuote = pick.quote === quote;
  const entity = entityOf(pick.quote, e.symbol, e.company_name);
  const scope = scopeOf(pick.quote);
  const contradiction = contradictionOf(lines);
  const ageD = e.filing_datetime ? (now.getTime() - new Date(e.filing_datetime).getTime()) / 86_400_000 : NaN;
  const fragment = isSlideFragment(pick.quote);

  // ── the six gates ──
  const mechState = MECH_STATE[pick.mech];
  const gates: Gate[] = [];
  gates.push({ key: 'mechanism', label: 'A structural mechanism exists', result: mechState === 'ROUTINE' ? 'FAIL' : mechState === 'INSUFFICIENT' ? 'UNKNOWN' : 'PASS', note: pick.why });
  const primary: GateResult = role === 'ANALYST' && fromQuote ? 'FAIL' : fragment ? 'UNKNOWN' : (role === 'MANAGEMENT' || role === 'COMPANY' || !fromQuote) ? 'PASS' : 'UNKNOWN';
  gates.push({ key: 'primary_source', label: 'Primary-source evidence', result: primary, note: primary === 'FAIL' ? 'The sentence is an analyst question.' : fragment ? 'Slide or table fragment — open the filing to confirm.' : fromQuote ? `From the ${role === 'COMPANY' ? 'company’s own document' : 'management answers'} in the filing.` : 'From management’s own text in the filing.' });
  const old = OLD_RE.test(pick.quote);
  const eventDated = EVENT_DATE_RE.test(pick.quote);
  const dated: GateResult = old ? 'FAIL' : eventDated && entity.ok === true ? 'PASS' : 'UNKNOWN';
  gates.push({ key: 'dated', label: 'Dated and attributable to the company', result: dated, note: old ? 'The sentence describes an old or cumulative milestone.'
    : entity.ok !== true ? entity.note
      : eventDated ? `The sentence dates the event; filed ${e.filing_datetime ? String(e.filing_datetime).slice(0, 10) : 'date unknown'}.`
        : `The sentence does not say when it happened — only the filing date (${e.filing_datetime ? String(e.filing_datetime).slice(0, 10) : 'unknown'}) is known; it may repeat an older development.` });
  gates.push({ key: 'not_routine', label: 'Not normal business operations', result: pick.mech === 'ROUTINE' ? 'FAIL' : mechState === 'INSUFFICIENT' ? 'UNKNOWN' : 'PASS', note: pick.mech === 'ROUTINE' ? pick.why : mechState === 'INSUFFICIENT' ? 'Not enough to tell.' : 'Goes beyond the existing business.' });
  const matGate: GateResult = pick.level === 'SMALL' ? 'FAIL' : pick.level === 'UNKNOWN' ? 'UNKNOWN' : 'PASS';
  gates.push({ key: 'materiality', label: 'Credible path to materiality', result: matGate, note: pick.matText || 'Size not stated.' });
  gates.push({ key: 'contradictions', label: 'Contradictions shown, not hidden', result: contradiction ? 'UNKNOWN' : 'PASS', note: contradiction || (e.review_queue === 'RECONCILE' ? 'No contradiction in the evidence lines; the document elsewhere has a positive and a negative statement to reconcile (shown as "reconcile first").' : 'No contradiction found in the lines read.') });

  // ── research state ──
  let state: ResearchState = mechState;
  let stateReason = pick.why;
  const failed = gates.filter((g) => g.result === 'FAIL');
  if (state !== 'ROUTINE' && (primary === 'FAIL' || dated === 'FAIL')) { state = 'INSUFFICIENT'; stateReason = primary === 'FAIL' ? 'Only an analyst said it.' : 'The milestone is old or cumulative, not a new event.'; }
  if (state !== 'ROUTINE' && state !== 'INSUFFICIENT' && matGate === 'FAIL') { state = 'ROUTINE'; stateReason = `${pick.why} Too small against the business to change it.`; }
  if (state === 'COMMERCIAL' && entity.ok !== true) { state = 'EMERGING'; stateReason = `${pick.why} ${entity.note}`; }
  if (state === 'COMMERCIAL' && fragment) { state = 'EMERGING'; stateReason = `${pick.why} The evidence is a slide fragment — confirm in the filing.`; }
  const numbersUp = f.resultsVerdict === 'STRONGER_LATEST' || f.resultsVerdict === 'GROWING';
  if (state === 'COMMERCIAL' && pick.mech === 'MIX_SHIFT' && primary === 'PASS' && numbersUp && !f.lowBase && (pick.level === 'LARGE' || pick.level === 'MEDIUM') && scope !== 'SEGMENT' && scope !== 'ONE_SITE' && !contradiction) {
    state = 'EARNINGS_POWER';
    stateReason = `${pick.why} The consolidated results grow and the change is large enough to show in them — that it caused the growth is not proven.`;
  }

  const confidence: Transformation['confidence'] = state === 'ROUTINE' || state === 'INSUFFICIENT' ? 'LOW'
    : gates.every((g) => g.result === 'PASS') ? 'HIGH'
      : gates.filter((g) => g.result !== 'PASS').length === 1 ? 'MEDIUM' : 'LOW';
  // zzz1224c — an unknown gate never confirms: it puts the name on the research watch instead
  const confirmable = pick.mech === 'MIX_SHIFT' || pick.mech === 'NEW_PRODUCT_LINE' || pick.mech === 'NEW_BUSINESS';
  const tier: Transformation['tier'] = STATE_ORDER[state] >= 2 && confirmable && gates.every((g) => g.result === 'PASS') ? 'CONFIRMED'
    : STATE_ORDER[state] >= 1 && failed.length === 0 ? 'WATCH' : 'EXCLUDED';
  const shortlist = tier === 'CONFIRMED';
  if (tier === 'WATCH') {
    const open = gates.filter((g) => g.result === 'UNKNOWN').map((g) => `${g.label.toLowerCase()} — ${g.note.replace(/\.$/, '')}`);
    if (open.length) stateReason = `${stateReason} Still open: ${open.join('; ')}.`;
  }
  const recency = Number.isFinite(ageD) ? Math.max(0, 90 - Math.min(90, Math.round(ageD))) : 0;
  const rankKey = ({ CONFIRMED: 2, WATCH: 1, EXCLUDED: 0 }[tier]) * 1e7 + STATE_ORDER[state] * 1e6 + MAT_ORDER[pick.level] * 1e5 + ({ HIGH: 3, MEDIUM: 2, LOW: 1 }[confidence]) * 1e4 + recency;

  const industry = clean(f.industry || f.sector);
  const thesis = {
    // zzz1224c — what the company earns from today, as far as the data goes; the segment split is not in the data and is said so
    oldBusiness: `${industry || 'Industry not on file'}${salesCr != null ? `; about ₹${Math.round(salesCr).toLocaleString('en-IN')} Cr of annual sales` : ''} (segment split not in the data)`,
    whatChanges: state === 'ROUTINE' ? `Nothing structural: ${pick.why}` : state === 'INSUFFICIENT' ? `Not shown yet: ${pick.why}` : pick.why,
    earningsImpact: pick.level === 'UNKNOWN' ? `Unknown — ${pick.matText || 'size not stated'}` : pick.matText,
    keyRisk: contradiction ? `${RISK[pick.mech]} Consolidated figure already weakened.` : RISK[pick.mech],
    nextMilestone: NEXT[pick.mech],
    sectorCheck: sectorCheckOf(f.industry, f.sector),
  };
  return {
    state, stateWord: STATE_WORD[state], stateReason, mechanism: pick.mech, mechanismWord: MECHANISM_WORD[pick.mech],
    evidence: { quote: pick.quote, actual: pick.actual, scope, entity },
    materiality: { level: pick.level, text: pick.matText || 'Size not stated.', scenario: pick.scenario || pick.level === 'UNKNOWN' },
    proofStage: pick.stage, thesis, gates, contradiction, confidence, tier, shortlist, rankKey,
  };
}
