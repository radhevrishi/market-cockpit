// ═══════════════════════════════════════════════════════════════════════════
// US CATALYST TAXONOMY — ~60 FUNDAMENTAL EVENT TYPES, KEYWORD RULES.  (zzz801)
//
// The owner's complaint on the US board: "fundamental catalyst is missing —
// new product, new segment, product mix, capex, acquisition, all such
// events". Two thirds of the names said "no identified catalyst" because the
// card only knew a handful of event kinds (earnings / deal / order / FDA /
// offering / buyback / guidance / index) and an 8-K Item 7.01 / 8.01 press
// release that announced a launch, a new plant or a partnership fell through
// to "Reg FD disclosure — no amount stated".
//
// This module reads plain text (an EX-99.1 press release body, an 8-K item,
// a press headline) sentence by sentence and returns every catalyst it can
// name, each with:
//   · a plain-English label and one of eight categories,
//   · a direction HINT (positive / negative / mixed / neutral) — a hint for
//     the reader, never a trade instruction,
//   · the evidence sentence exactly as written,
//   · the figures ($ amounts, %, units, vote tallies) LITERALLY present in
//     that sentence. A figure is never computed, rounded or borrowed from
//     another sentence — if the sentence does not state it, it is not shown.
//
// Boilerplate never triggers: forward-looking-statement / safe-harbor text,
// risk-factor language ("could adversely affect", "no assurance", "if we
// fail to"), legal furnishing language, and the "About <Company>" paragraph
// are cut before any rule runs.
//
// Pure: no fetch, no clock, no model.
// ═══════════════════════════════════════════════════════════════════════════

import { extractMetrics, directionOf, directionNote, subtypeOf, type EconDirection, type EventSubtype, type TypedMetric } from './structured-facts';
import { repairSplitText, hasNegatedTrigger, NO_REPURCHASE, isBackgroundApproval } from './us-text-guards';

export type UsEventCategory =
  | 'Earnings' | 'Product & segment' | 'Capital & capacity' | 'Corporate action'
  | 'Deals & customers' | 'Regulatory & clinical' | 'Capital structure' | 'Market & ownership';

export const US_EVENT_CATEGORIES: UsEventCategory[] = [
  'Earnings', 'Product & segment', 'Capital & capacity', 'Corporate action',
  'Deals & customers', 'Regulatory & clinical', 'Capital structure', 'Market & ownership',
];

export type UsEventDirection = 'positive' | 'negative' | 'mixed' | 'neutral';

export interface UsEventHit {
  /** Stable rule id ("product_launch"). */
  id: string;
  /** Plain-English label ("New product launch"). */
  label: string;
  category: UsEventCategory;
  /** A hint for the reader — never a trade instruction. */
  direction: UsEventDirection;
  /** The evidence sentence, as written in the source (trimmed, clipped). */
  sentence: string;
  /** Figures literally present in that sentence ("$120 million", "99%", "10-2"). */
  figures: string[];
  /** zzz835: the sentence's percentages typed by NAME (net_income_growth vs revenue_growth vs a margin level), each with its original text. */
  metrics?: TypedMetric[];
  /** The sentence speaks of a plan / expectation ("plans to", "expects to"). */
  planned: boolean;
  // ── zzz836 (optional) ──
  /** Economic direction of the event itself (never the price move): POSITIVE | NEGATIVE | MIXED | NEUTRAL | UNKNOWN. `direction` keeps the older lower-case hint. */
  economicDirection?: EconDirection;
  directionNote?: string | null;
  subtype?: EventSubtype;
  /** zzz840: stage the event type implies (filed-not-approved = PROPOSED), when the rule sets one. */
  stage?: 'PROPOSED' | 'SIGNED';
}

interface Rule {
  id: string;
  label: string;
  category: UsEventCategory;
  direction: UsEventDirection;
  /** Any of these matching the sentence fires the rule. */
  any: RegExp[];
  /** Nothing of this may appear in the sentence. */
  not?: RegExp;
  /** Direction override by sentence content. */
  dir?: (s: string) => UsEventDirection;
  /** Same-sentence hits of these rule ids are dropped (a more specific rule wins). */
  hides?: string[];
  /** Rank inside the card: lower = the lead catalyst. */
  rank: number;
  /** zzz840: the stage the event itself implies (a submission is PROPOSED - filed, not approved). */
  stage?: 'PROPOSED' | 'SIGNED';
}

// ── the rules ─────────────────────────────────────────────────────────────

const AI_INFRA = String.raw`(?:data cent(?:er|re)s?|HPC|high[- ]performance computing|GPUs?|AI (?:factory|factories|cloud|infrastructure|compute|data ?cent(?:er|re)s?|campus)|compute (?:capacity|cluster|infrastructure)|colocation|hyperscal\w+|AI[- ]ready (?:power|capacity|data))`;
const MONEYISH = String.raw`(?:US)?\$\s?\d`;
const GOV = String.raw`(?:U\.?S\.?(?![$\d])|United States|federal|government|Department of (?:Defense|Energy|Homeland Security|Health|Veterans Affairs|Transportation|the (?:Army|Navy|Air Force))|DoD|DOE|DHS|NASA|DARPA|BARDA|NIH|Army|Navy|Air Force|Space Force|Marine Corps|Missile Defense Agency|Space Development Agency|CHIPS)`;

const RULES: Rule[] = [
  // ── EARNINGS ──
  { id: 'earnings_beat', label: 'Results beat expectations', category: 'Earnings', direction: 'positive', rank: 10,
    any: [/\b(?:beat|beats|beating|exceed(?:s|ed|ing)?|surpass(?:es|ed)?|topp(?:ed|ing)|tops)\b[^.]{0,60}\b(?:consensus|expectations|estimates|analysts?'? (?:estimates|expectations)|guidance|the high end of)/i, /\bEPS\b(?:[^.]|\.\d){0,40}\bbeats?\b/i, /\babove (?:the )?(?:consensus|analyst (?:estimates|expectations)|high end of (?:its |our )?guidance)\b/i],
    not: /\bmiss(?:es|ed)?\b|\bbelow (?:consensus|expectations)\b|\b(?:said|says|stated|commented|noted)\b|[“"][^”"]{0,200}\bexpectations\b|\b(?:trial|study|patients?|clinical|endpoint)\b/i, hides: ['eps_reported'] },
  { id: 'earnings_miss', label: 'Results below expectations', category: 'Earnings', direction: 'negative', rank: 10,
    any: [/\b(?:miss(?:es|ed)?|fell short of|came in below|below)\b[^.]{0,40}\b(?:consensus|expectations|estimates)\b/i] },
  { id: 'record_results', label: 'Record revenue / results', category: 'Earnings', direction: 'positive', rank: 11,
    any: [/\brecord (?:quarterly |annual |full[- ]year |(?:first|second|third|fourth)[- ]quarter |(?:first|second|third|fourth) quarter (?:and full[- ]year )?(?:fiscal )?(?:\d{4} )?)?(?:total |net )?(?:revenues?|sales|net sales|bookings|earnings|net income|gross profit|adjusted ebitda|deliveries|shipments|production|results|financial results)\b/i, /\b(?:revenues?|sales|earnings)\b[^.]{0,30}\b(?:all-time high|highest in (?:the )?company'?s? history)\b/i] },
  { id: 'revenue_growth', label: 'Revenue growth', category: 'Earnings', direction: 'positive', rank: 12,
    any: [/\b(?:total |net |product |quarterly |consolidated )?(?:revenues?|sales|net sales)\b[^.;]{0,80}?\b(?:increas(?:ed|es|ing)|grew|grows|rose|rising|up|jump(?:ed|s)?|soar(?:ed|s)?|surg(?:ed|es)|climb(?:ed|s)?|gain(?:ed|s)?)\b[^.;]{0,40}?\d+(?:\.\d+)?\s?(?:%|percent)/i,
      /\d+(?:\.\d+)?\s?(?:%|percent)\s+(?:year[- ]over[- ]year |yoy |sequential )?(?:increase|growth|rise|jump|gain)\s+in\s+(?:total |net |product )?(?:revenues?|sales)\b/i,
      /\b(?:revenues?|sales)\b[^.;]{0,20}\+\s?\d+(?:\.\d+)?\s?%/i,
      /\b(?:revenues?|sales)\b[^.;]{0,40}\b(?:doubled|tripled|more than doubled)\b/i],
    not: /\b(?:decreas|declin|fell|down \d)/i },
  { id: 'revenue_decline', label: 'Revenue decline', category: 'Earnings', direction: 'negative', rank: 13,
    any: [/\b(?:total |net )?(?:revenues?|sales)\b[^.;]{0,60}?\b(?:decreas(?:ed|es)|declin(?:ed|es)|fell|dropped|down)\b[^.;]{0,30}?\d+(?:\.\d+)?\s?(?:%|percent)/i] },
  // zzz835: net income / profit growth is its OWN metric - never confused with revenue growth or a margin
  { id: 'profit_growth', label: 'Net income growth', category: 'Earnings', direction: 'positive', rank: 12,
    any: [/\b(?:net income|net earnings|net profit|profit after tax|GAAP net income)\b[^.;]{0,80}?\b(?:increas(?:ed|es|ing)|grew|grows|rose|rising|up|jump(?:ed|s)?|soar(?:ed|s)?|surg(?:ed|es)|climb(?:ed|s)?|gain(?:ed|s)?|improv(?:ed|es))\b[^.;]{0,40}?\d+(?:\.\d+)?\s?(?:%|percent)/i,
      /\d+(?:\.\d+)?\s?(?:%|percent)\s+(?:year[- ]over[- ]year |yoy )?(?:increase|growth|rise|jump|gain)\s+in\s+(?:GAAP )?(?:net income|net earnings|net profit)\b/i],
    not: /\b(?:net income|net earnings|net profit)\b[^.;]{0,40}\b(?:decreas|declin|fell|down|lower)\w*/i },
  { id: 'profit_decline', label: 'Net income decline', category: 'Earnings', direction: 'negative', rank: 13,
    any: [/\b(?:net income|net earnings|net profit|profit after tax)\b[^.;]{0,60}?\b(?:decreas(?:ed|es)|declin(?:ed|es)|fell|dropped|down|lower)\b[^.;]{0,40}?\d+(?:\.\d+)?\s?(?:%|percent)/i] },
  { id: 'growth_acceleration', label: 'Growth acceleration', category: 'Earnings', direction: 'positive', rank: 12,
    any: [/\baccelerat(?:ed|ing|ion (?:in|of))\b[^.]{0,40}\b(?:revenue|sales|growth|demand|bookings)\b/i, /\b(?:revenue|sales) growth accelerated\b/i, /\bsequential (?:revenue |sales )?growth of\b/i] },
  { id: 'margin_expansion', label: 'Margin expansion', category: 'Earnings', direction: 'positive', rank: 13,
    any: [/\b(?:gross|operating|ebitda|adjusted ebitda|net|contribution|segment) margins?\b[^.;]{0,60}?\b(?:expand(?:ed|s)?|improv(?:ed|es)|increas(?:ed|es)|widen(?:ed|s)?|rose|up)\b/i, /\bmargin expansion\b/i, /\b(?:expand(?:ed|s)?|improv(?:ed|es)|increas(?:ed|es))\b[^.;]{0,30}\b(?:gross|operating|ebitda) margins?\b/i, /\b\d+\s?basis[- ]points?\b[^.;]{0,30}\b(?:improvement|expansion|increase)\b/i],
    not: /\b(?:compress|contract(?:ed|ion)|declin|decreas|lower)\w*\b[^.;]{0,20}\bmargin/i },
  { id: 'margin_compression', label: 'Margin compression', category: 'Earnings', direction: 'negative', rank: 14,
    any: [/\b(?:gross|operating|ebitda|net) margins?\b[^.;]{0,50}?\b(?:compress(?:ed|ion)|contract(?:ed|ion)|declin(?:ed|es)|decreas(?:ed|es)|narrow(?:ed|s)?)\b/i, /\bmargin (?:compression|pressure|contraction)\b/i] },
  { id: 'turned_profitable', label: 'Turned profitable / cash-flow positive', category: 'Earnings', direction: 'positive', rank: 11,
    any: [/\b(?:first|inaugural)\b[^.]{0,30}\b(?:profitable quarter|quarter of (?:gaap |net )?profitability|positive (?:adjusted )?ebitda|positive (?:free |operating )?cash flow|(?:gaap )?net income)\b/i, /\b(?:achiev(?:ed|es)|reach(?:ed|es)|turn(?:ed|s)) (?:gaap |adjusted ebitda |net )?(?:profitability|profitable|cash[- ]flow positive|breakeven|break-even)\b/i, /\bswung to (?:a )?(?:net )?(?:profit|income)\b/i] },
  { id: 'eps_reported', label: 'Earnings per share reported', category: 'Earnings', direction: 'neutral', rank: 16,
    any: [/\b(?:GAAP |adjusted |non-GAAP |diluted )*(?:EPS|earnings per (?:diluted )?share|(?:net )?(?:income|loss) per (?:diluted )?share)\b[^.;]{0,40}?(?:of|was|were|at|:)?\s*\(?-?\$\s?\d/i, /\bQ[1-4]\b[^.;]{0,40}\bEPS\b/i],
    dir: (s) => (/\bbeat|exceed|above/i.test(s) ? 'positive' : /\bmiss|below/i.test(s) ? 'negative' : 'neutral') },
  { id: 'guidance_raise', label: 'Guidance raised', category: 'Earnings', direction: 'positive', rank: 10,
    any: [/\b(?:rais(?:es|ed|ing)|increas(?:es|ed|ing)|lift(?:s|ed|ing)|boost(?:s|ed|ing)|upgrad(?:es|ed|ing)|hik(?:es|ed))\b[^.;]{0,70}\b(?:guidance|outlook|forecast|full[- ]year (?:revenue |sales |eps |earnings )?(?:target|expectations))\b/i, /\b(?:guidance|outlook|forecast)\b[^.;]{0,30}\b(?:raised|increased|lifted)\b/i],
    not: /\b(?:not|no longer|does not|did not)\s+(?:rais|increas)/i },
  { id: 'guidance_cut', label: 'Guidance cut', category: 'Earnings', direction: 'negative', rank: 10,
    any: [/\b(?:lower(?:s|ed|ing)|reduc(?:es|ed|ing)|cut(?:s|ting)?|withdr(?:aws|ew|awn)|trim(?:s|med)?|slash(?:es|ed)?)\b[^.;]{0,60}\b(?:guidance|outlook|forecast)\b/i, /\b(?:guidance|outlook|forecast)\b[^.;]{0,20}\b(?:lowered|reduced|cut|withdrawn)\b/i] },
  { id: 'guidance_issued', label: 'Outlook issued / reaffirmed', category: 'Earnings', direction: 'neutral', rank: 17,
    any: [/\b(?:initiat(?:es|ed|ing)|introduc(?:es|ed)|issu(?:es|ed)|provid(?:es|ed)|reaffirm(?:s|ed)|reiterat(?:es|ed)|maintain(?:s|ed))\b[^.;]{0,50}\b(?:guidance|outlook)\b/i],
    hides: [] },

  // ── PRODUCT & SEGMENT ──
  { id: 'product_launch', label: 'New product launch', category: 'Product & segment', direction: 'positive', rank: 20,
    any: [/\b(?:launch(?:es|ed|ing)|unveil(?:s|ed|ing)?|introduc(?:es|ed|ing)|debut(?:s|ed)?|roll(?:s|ed)? out|rolling out)\b[^.;]{0,60}\b(?:new|next[- ]generation|its|the|a|an|first)\b/i, /\b(?:the |its |a |commercial )launch of\b/i, /\b(?:to|will) launch\b[^.;]{0,40}\b(?:new|its|the|a|an)\b/i, /^[A-Z][^.;]{0,80}\bLaunch(?:es)?\b/,
      /\b(?:commercial|full|national|global|nationwide|U\.?S\.?) (?:launch|rollout|availability)\b/i, /\bgeneral(?:ly)? availab(?:le|ility)\b/i, /\bnow (?:commercially )?available\b/i, /\b(?:began|begins|started|starts|commenced) (?:commercial )?(?:shipping|shipments|selling|sales of)\b/i],
    not: /\blaunch\w* (?:of )?(?:a |an |its |the )?(?:[\w-]+ ){0,3}(?:offering|placement|tender)\b|\binvestigation\b|\blawsuit\b|\blaunch(?:ed|es)? a (?:review|process|search)\b|\bstrategic alternatives\b|\bwebsite\b|\bwebcast\b/i },
  { id: 'first_commercial', label: 'First commercial sale / shipment', category: 'Product & segment', direction: 'positive', rank: 20,
    any: [/\bfirst (?:commercial |customer |production )?(?:sale|sales|shipment|shipments|order|orders|deliver(?:y|ies)|revenue|units?)\b/i, /\b(?:initial|first) (?:product )?revenue\b/i] ,
    not: /\bfirst (?:quarter|half)\b[^.]{0,5}$/i },
  { id: 'new_segment', label: 'New segment / market entry', category: 'Product & segment', direction: 'positive', rank: 20,
    any: [/\bnew (?:business |reporting |operating )?(?:segment|business line|line of business|vertical|division|business unit)\b/i, /\b(?:enter(?:s|ed|ing)?|entry into|expan(?:ds?|ded|ding|sion) into)\b[^.;]{0,50}\b(?:market|markets|sector|industry|segment|vertical|space|business)\b/i, /\bdiversif(?:y|ies|ied|ying|ication) into\b/i],
    not: /\bentered into\b(?![^.;]{0,50}\bmarket)/i },
  { id: 'product_mix', label: 'Product mix shift', category: 'Product & segment', direction: 'neutral', rank: 22,
    any: [/\b(?:product|sales|revenue|business|customer|favorable|richer|improved|higher[- ]margin) mix\b/i, /\bmix shift\b/i, /\bshift (?:toward|towards|to) (?:higher[- ]margin|premium|recurring|subscription)\b/i],
    dir: (s) => (/\bfavorable|richer|improved|higher[- ]margin|premium|recurring/i.test(s) ? 'positive' : /\bunfavorable|lower[- ]margin|weaker/i.test(s) ? 'negative' : 'neutral') },
  { id: 'pricing_action', label: 'Pricing action', category: 'Product & segment', direction: 'positive', rank: 22,
    any: [/\bprice (?:increase|increases|hike|hikes|realization)\b/i, /\b(?:rais(?:ed|es|ing)|increas(?:ed|es|ing)) (?:its |our )?(?:list |average |selling )?prices\b/i, /\bpricing (?:action|actions|power|increase)\b/i, /\baverage selling prices? (?:increas|rose|grew|improv)/i],
    dir: (s) => (/\bprice (?:cut|reduction|decrease)s?\b|\blower(?:ed)? prices\b/i.test(s) ? 'negative' : 'positive') },
  { id: 'tech_milestone', label: 'Product / technical milestone', category: 'Product & segment', direction: 'positive', rank: 23,
    any: [/\b(?:achiev(?:es|ed|ing)|reach(?:es|ed)|complet(?:es|ed))\b[^.;]{0,30}\b(?:key |major |significant |critical |technical |development |commercial |regulatory )?milestones?\b/i, /\bsuccessfully (?:completed|demonstrated|tested|launched|validated|deployed)\b/i, /\b(?:product|system|platform|device|chip|design|technology|module)s?\b[^.;]{0,40}\b(?:qualified|certified) by\b/i, /\bdesign[- ]ins?\b/i] },
  // zzz840: infrastructure / compute / data-centre / GPU / power context only. "AI" next to a collaboration, drug-discovery or software word is not this rule.
  { id: 'ai_datacenter', label: 'AI / data-centre move', category: 'Product & segment', direction: 'positive', rank: 21,
    any: [new RegExp(String.raw`\b${AI_INFRA}\b[^.;]{0,80}\b(?:launch|enter|expan|agreement|contract|partner|deploy|build|pivot|transition|acqui|lease|capacity|MW|megawatts?|campus|colocation|customer|order)`, 'i'),
      new RegExp(String.raw`\b(?:launch|enter|expan|agreement|contract|partner|deploy|build|pivot|transition|acqui|lease|campus|colocation)\w*\b[^.;]{0,80}\b${AI_INFRA}\b`)],
    not: /\b(?:may|could|might) (?:be )?(?:affect|impact|disrupt)|\b(?:collaboration|drug discovery|therapeutics?|biotech\w*|RNA|clinical|oncology|genomics?)\b/i },
  { id: 'crypto_strategy', label: 'Crypto / digital-asset strategy', category: 'Product & segment', direction: 'mixed', rank: 21,
    any: [/\b(?:bitcoin|ethereum|ether|BTC|ETH|solana|SOL|XRP|crypto(?:currency|currencies)?|digital assets?|tokens?|stablecoin)\b[^.;]{0,60}\b(?:treasury|reserve|purchase|purchased|acquire|acquired|strategy|holdings|mining|miners|hashrate|staking)\b/i,
      /\b(?:treasury|reserve) (?:strategy|asset)\b[^.;]{0,40}\b(?:bitcoin|ethereum|crypto|digital asset|token)/i] },

  // ── CAPITAL & CAPACITY ──
  { id: 'capacity_expansion', label: 'Capex / capacity expansion', category: 'Capital & capacity', direction: 'positive', rank: 30,
    any: [/\b(?:expand(?:s|ed|ing)?|increas(?:es|ed|ing)|doubl(?:es|ed|ing)|tripl(?:es|ed|ing)|add(?:s|ed|ing)?|scal(?:es|ed|ing) up)\b[^.;]{0,40}\b(?:manufacturing|production|processing|fabrication|generation|mining|compute|installed) capacity\b/i,
      /\bcapacity expansion\b/i, /\bcapital (?:expenditures?|investment|spending|program)\b[^.;]{0,40}(?:of|totaling|approximately)\s+(?:approximately\s+)?\$/i,
      /\binvest(?:s|ed|ing|ment of)?\b[^.;]{0,30}\$\s?\d[^.;]{0,60}\b(?:expand|build|construct|upgrade|capacity|facility|plant|factory|line)/i],
    not: /\b(?:may|could|might) not\b/i },
  { id: 'new_facility', label: 'New facility / plant', category: 'Capital & capacity', direction: 'positive', rank: 30,
    any: [/\b(?:open(?:s|ed|ing)?|break(?:s)? ground|broke ground|groundbreaking|construct(?:s|ed|ing|ion of)?|build(?:s|ing)?|built|complet(?:es|ed|ion of))\b[^.;]{0,50}\b(?:new |second |third |additional |expanded |state-of-the-art )?(?:manufacturing |production |processing |assembly |research |R&D |distribution |fulfillment )?(?:facility|facilities|plant|factory|fab|campus|warehouse|distribution cent(?:er|re)|headquarters|data cent(?:er|re)|site|mine|refinery|line)\b/i],
    not: /\bclos(?:e|es|ed|ing|ure)\b|\bstock opens\b|\bmarket open/i },
  { id: 'production_start', label: 'Production start / ramp', category: 'Capital & capacity', direction: 'positive', rank: 31,
    any: [/\b(?:commenc(?:es|ed|ing)|beg(?:an|ins|un)|start(?:s|ed|ing)|initiat(?:es|ed))\b[^.;]{0,20}\b(?:commercial |full[- ]scale |volume |serial )?(?:production|operations|manufacturing|mining|output)\b/i, /\bramp(?:ed|s|ing)?(?: up)?\b[^.;]{0,20}\bproduction\b/i, /\bproduction ramp\b/i, /\benergi[sz](?:ed|ation)\b/i, /\bfirst (?:gold|oil|gas|power|pour|production)\b/i],
    not: /\bclinical\b|\bphase [123]\b|\b(?:not|never|yet to)\s+(?:\w+\s+)?(?:commenced|begun|started)\b/i },
  { id: 'facility_closure', label: 'Facility closure / capacity cut', category: 'Capital & capacity', direction: 'negative', rank: 32,
    any: [/\b(?:clos(?:e|es|ed|ing)|shut(?:s|ting)? down|idl(?:e|es|ed|ing)|consolidat(?:e|es|ed|ing))\b[^.;]{0,40}\b(?:facility|facilities|plant|plants|factory|site|mine|stores?|locations?)\b/i] },

  // ── CORPORATE ACTION ──
  { id: 'takeover_bid', label: 'Takeover bid / going-private', category: 'Corporate action', direction: 'positive', rank: 5,
    any: [/\b(?:to be acquired by|will be acquired by|agreed to be acquired|acquired by [A-Z])\b/, /\b(?:take[- ]private|go(?:ing)?[- ]private)\b/i, /\bunsolicited (?:proposal|offer|bid)\b/i, /\bnon-binding (?:proposal|offer|indication of interest) to acquire\b/i, /\btender offer\b/i, /\$\s?\d+(?:\.\d+)?\s+per share in cash\b/i],
    hides: ['acquisition', 'merger_agreement'] },
  { id: 'merger_agreement', label: 'Merger agreement', category: 'Corporate action', direction: 'positive', rank: 6,
    any: [/\b(?:agreement and plan of merger|merger agreement|definitive merger|to merge with|merg(?:e|er|ing) with|business combination agreement|all-stock merger|scheme of arrangement)\b/i],
    not: /\bwould\b[^.]{0,30}\bif\b/i, hides: ['acquisition'] },
  { id: 'acquisition', label: 'Acquisition', category: 'Corporate action', direction: 'positive', rank: 7,
    any: [/\b(?:definitive agreement to acquire|agreed to acquire|completed (?:the |its )?(?:previously announced )?acquisition|completes (?:the |its )?acquisition|closed (?:the |its )?acquisition)\b/i,
      /\b(?:to acquire|will acquire|has acquired|have acquired|acquires|acquired)\s+(?:all (?:of )?(?:the )?(?:outstanding |issued )?|substantially all |a majority |a controlling |[A-Z])/,
      /\bacquisition of\s+(?:all (?:of )?|substantially all |a majority |a controlling |[A-Z]|the (?:business|assets|operations|company))/i],
    not: /\bcustomer acquisition\b|\bacqui(?:re|red|sition of) (?:additional |the )?(?:shares|stock|common stock|units|bitcoin|ethereum|tokens?|digital assets?|data)\b|\bacquisition (?:cost|costs|strategy)\b|\bacquired by\b|\bto be acquired\b|\bacquired in-process\b|\bacqui\w+ (?:of )?(?:land|equipment|miners)\b|\bordinary course\b|\bacquire, explore\b/i },
  { id: 'divestiture', label: 'Divestiture / spin-off', category: 'Corporate action', direction: 'mixed', rank: 8,
    any: [/\bdivest(?:s|ed|iture|ment|ing)?\b/i, /\bspin[- ]?off\b|\bspinoff\b|\bspin(?:s|ning)? off\b/i, /\b(?:sale|sell|sold|sells)\b[^.;]{0,40}\b(?:its|the|our)\b[^.;]{0,40}\b(?:business|division|segment|unit|subsidiary|portfolio|assets)\b/i, /\bseparation of\b[^.;]{0,40}\b(?:business|segment|into two)\b/i],
    not: /\bsale of (?:\d|common|shares|stock|units|notes|securities)\b|\bsold (?:\d|shares|stock)\b/i },
  // zzz840: an IRS private letter ruling on a spin-off / merger is a closing-condition fact, never a litigation win.
  { id: 'tax_ruling', label: 'Tax ruling (closing condition satisfied)', category: 'Corporate action', direction: 'neutral', rank: 8,
    any: [/\bprivate letter ruling\b/i, /\b(?:Internal Revenue Service|IRS)\b[^.;]{0,80}\b(?:ruling|tax[- ]free|opinion)\b/i, /\b(?:ruling|opinion)\b[^.;]{0,60}\b(?:Internal Revenue Service|IRS)\b/i, /\btax[- ]free (?:spin[- ]?off|distribution|reorganization)\b/i],
    not: /\b(?:unfavorable|adverse|no assurance|may (?:challenge|disagree|not))\b/i, hides: ['patent_litigation_win', 'settlement', 'regulatory_probe', 'activist_stake'] },
  // zzz840: who will own what after a spin-off / merger is a fact of the deal, not an activist stake.
  { id: 'ownership_split', label: 'Post-deal ownership split', category: 'Corporate action', direction: 'neutral', rank: 8,
    any: [/\b(?:shareholders|stockholders|holders)\b[^.;]{0,60}\b(?:expected to|will|would|are expected to)\s+(?:collectively )?(?:own|hold)\s+(?:approximately |about |roughly )?\d+(?:\.\d+)?\s?%/i, /\bformer (?:holders|shareholders|stockholders)\b[^.;]{0,60}\b(?:own|hold)\b[^.;]{0,20}\d+(?:\.\d+)?\s?%/i, /\b(?:expected to|will|would)\s+own\s+(?:approximately |about |roughly )?\d+(?:\.\d+)?\s?%\s+of\s+the\s+(?:combined|new|pro forma|outstanding)/i],
    hides: ['activist_stake', 'insider_buying'] },
  { id: 'strategic_review', label: 'Strategic review', category: 'Corporate action', direction: 'mixed', rank: 9,
    any: [/\bstrategic alternatives\b/i, /\bstrategic review\b/i, /\bexplor(?:e|es|ed|ing) (?:a )?(?:potential )?(?:sale|strategic options|merger)\b/i] },
  { id: 'restructuring', label: 'Restructuring / cost cuts', category: 'Corporate action', direction: 'mixed', rank: 24,
    any: [/\brestructuring (?:plan|program|initiative|actions?)\b/i, /\b(?:reduction in force|workforce reduction|headcount reduction|reduc(?:e|es|ed|ing) (?:its )?(?:workforce|headcount))\b/i, /\bcost[- ](?:reduction|savings|optimization|cutting) (?:plan|program|initiatives?|actions?)\b/i, /\bannuali[sz]ed (?:cost )?savings\b/i] },
  { id: 'management_change', label: 'Management change (CEO / CFO)', category: 'Corporate action', direction: 'neutral', rank: 40,
    any: [/\b(?:appoint(?:s|ed|ment of)?|nam(?:es|ed)|hir(?:es|ed)|promot(?:es|ed))\b[^.;]{0,80}\b(?:Chief Executive Officer|CEO|Chief Financial Officer|CFO|President|Chief Operating Officer|COO|Chairman)\b/i, /\b(?:Chief Executive Officer|CEO|Chief Financial Officer|CFO)\b[^.;]{0,60}\b(?:resign(?:s|ed|ation)|step(?:s|ped)? down|retire(?:s|d|ment)|depart(?:s|ed|ure)|terminat(?:ed|ion))\b/i] ,
    dir: (s) => (/\bresign|step(?:s|ped)? down|depart|terminat/i.test(s) ? 'mixed' : 'neutral') },

  // ── DEALS & CUSTOMERS ──
  { id: 'gov_contract', label: 'Government contract / award', category: 'Deals & customers', direction: 'positive', rank: 14,
    any: [new RegExp(String.raw`\b${GOV}\b[^.;]{0,80}\b(?:contract|award|awarded|task order|grant|funding|selected|delivery order|OTA|other transaction)\b`, 'i'),
      new RegExp(String.raw`\b(?:contract|award|awarded|task order|grant|delivery order)\b[^.;]{0,80}\b(?:from|by|with) (?:the )?${GOV}`, 'i')],
    not: /\bFDA\b|\bFood and Drug\b|\bfunding (?:mix|structure|package|plan|gap|sources?|costs?)\b/i, hides: ['major_contract', 'customer_win'] },
  { id: 'major_contract', label: 'Major contract / order', category: 'Deals & customers', direction: 'positive', rank: 15,
    any: [/\b(?:award(?:ed|s)?|won|wins|win|secur(?:es|ed)|receiv(?:es|ed)|land(?:s|ed)|sign(?:s|ed)|book(?:s|ed))\b[^.;]{0,60}\b(?:contract|order|purchase order|task order|master services agreement|framework agreement|multi-year agreement)\b/i,
      /\b(?:contract|order|agreement)\b[^.;]{0,40}\b(?:valued at|worth|with a (?:total |aggregate )?value of|totaling)\b/i, new RegExp(String.raw`\b(?:a|an)\s+${MONEYISH}[\d.,]*\s*(?:million|billion|M|B)?\s+(?:multi-year |follow-on |firm )?(?:contract|order|award)\b`, 'i')],
    not: /\bpurchase agreement\b[^.;]{0,30}\b(?:shares|stock|securities)\b|\bunderwriting agreement\b|\bmerger agreement\b/i, hides: ['customer_win'] },
  { id: 'backlog', label: 'Backlog / bookings growth', category: 'Deals & customers', direction: 'positive', rank: 16,
    any: [/\b(?:record )?(?:backlog|order book|bookings|remaining performance obligations|RPO)\b[^.;]{0,60}\b(?:increas|grew|rose|record|up|reached|of \$|totaled|expanded)/i, /\bbook[- ]to[- ]bill\b/i],
    dir: (s) => (/\b(?:decreas|declin|fell|down)\w*/i.test(s) ? 'negative' : 'positive') },
  { id: 'customer_win', label: 'Customer win', category: 'Deals & customers', direction: 'positive', rank: 17,
    any: [/\bnew (?:enterprise |strategic |major |key |OEM |hyperscale )?customers?\b[^.;]{0,40}\b(?:signed|added|won|including|wins?)\b/i, /\b(?:signed|added|won|onboarded|secured)\b[^.;]{0,30}\b(?:new )?(?:customers?|clients?|accounts?|logos?)\b/i, /\b(?:selected|chosen) (?:by|as)\b[^.;]{0,60}\b(?:supplier|provider|partner|vendor|platform)\b/i, /\bdesign win\b/i] },
  { id: 'partnership', label: 'Partnership / collaboration', category: 'Deals & customers', direction: 'positive', rank: 18,
    any: [/\b(?:strategic |commercial |technology |exclusive |multi-year )?(?:partnership|collaboration|alliance)\b[^.;]{0,20}\b(?:with|between|agreement)\b/i, /\bpartner(?:s|ed|ing)? with\b/i, /\bteam(?:s|ed) (?:up )?with\b/i, /\b(?:memorandum of understanding|MOU|co-development agreement|co-marketing agreement|reseller agreement|distribution agreement)\b/i],
    not: /\bpublic[- ]private partnership\b[^.;]{0,20}\bmay\b|\bthe Partnership\b|\bPartnership['’]s\b|\bLimited Partnership\b|\bpartnership (?:units|interests)\b/ },
  { id: 'joint_venture', label: 'Joint venture', category: 'Deals & customers', direction: 'positive', rank: 18,
    any: [/\bjoint venture\b|\bJV\b/], hides: ['partnership'] },
  { id: 'collaboration_expanded', label: 'Collaboration expanded', category: 'Deals & customers', direction: 'positive', rank: 17,
    any: [/\b(?:expand(?:s|ed|ing)?|extend(?:s|ed|ing)?|broaden(?:s|ed|ing)?|deepen(?:s|ed|ing)?)\b[^.;]{0,50}\b(?:collaborations?|partnerships?|alliance)\b/i, /\b(?:collaborations?|partnerships?)\b[^.;]{0,25}\b(?:expan(?:sion|ded)|extended|extension)\b/i],
    hides: ['partnership', 'ai_datacenter'] },
  { id: 'licensing', label: 'Licensing deal', category: 'Deals & customers', direction: 'positive', rank: 18,
    any: [/\b(?:exclusive |global |worldwide |non-exclusive )?licen[cs](?:e|ing) (?:agreement|deal)\b/i, /\b(?:in-?licens|out-?licens)\w*/i, /\bupfront payment\b/i, /\bmilestone payments?\b[^.;]{0,40}\broyalt/i, /\broyalt(?:y|ies)\b[^.;]{0,40}\b(?:agreement|on net sales)\b/i],
    hides: ['partnership'] },
  { id: 'supply_agreement', label: 'Supply / offtake agreement', category: 'Deals & customers', direction: 'positive', rank: 18,
    any: [/\b(?:supply|offtake|off-take|purchase and supply|long-term supply|master supply|capacity reservation|take-or-pay|power purchase) (?:agreement|contract|deal)\b/i, /\bPPA\b/],
    hides: ['major_contract', 'partnership'] },
  { id: 'strategic_investment', label: 'Strategic investment by a larger company', category: 'Deals & customers', direction: 'positive', rank: 12,
    any: [/\bstrategic (?:equity )?investment\b/i, /\b(?:equity )?investment (?:from|by) [A-Z]/, /\b(?:led by|anchored by) [A-Z][\w&.-]+(?: [A-Z][\w&.-]+){0,3}\b[^.;]{0,30}\b(?:investment|financing|round)\b/, /\b(?:acquire|acquired|take|took|purchase|purchased) (?:a )?(?:\d+(?:\.\d+)?% )?(?:minority )?(?:equity )?stake in (?:the Company|us|[A-Z])/] },

  // ── REGULATORY & CLINICAL ──
  { id: 'fda_crl', label: 'FDA setback (CRL / clinical hold)', category: 'Regulatory & clinical', direction: 'negative', rank: 3,
    any: [/\bcomplete response letter\b/i, /\bCRL\b/, /\brefus(?:e|al) to file\b/i, /\bclinical hold\b/i],
    not: /\blift(?:ed|s)? (?:the |a )?(?:partial )?clinical hold\b|\bremov(?:ed|es) (?:the )?clinical hold\b/i, hides: ['fda_approval', 'fda_submission'] },
  { id: 'fda_inspection', label: 'Regulatory inspection / observations', category: 'Regulatory & clinical', direction: 'neutral', rank: 3,
    any: [/\b(?:FDA|MHRA|EMA|EU[- ]GMP|Health Canada)\b[^.;]{0,80}\binspect(?:ion|ed|ions)\b/i, /\binspect(?:ion|ed|ions)\b[^.;]{0,80}\b(?:FDA|MHRA|EMA|Form 483|483|observations?|EIR|NAI|VAI)\b/i, /\bForm 483\b/i],
    not: /\bwarning letter\b|\bimport alert\b|\bofficial action indicated\b|\bOAI\b|\bcomplete response letter\b|\bCRL\b/i,
    dir: (s) => { const d = directionOf('regulatory_inspection', s); return d === 'POSITIVE' ? 'positive' : d === 'NEGATIVE' ? 'negative' : d === 'MIXED' ? 'mixed' : 'neutral'; },
    hides: ['fda_approval', 'fda_submission', 'new_facility'] },
  { id: 'fda_warning_letter', label: 'FDA warning letter / import alert', category: 'Regulatory & clinical', direction: 'negative', rank: 3,
    any: [/\bwarning letter\b/i, /\bimport alert\b/i, /\bofficial action indicated\b/i],
    not: /\b(?:resolved|closed out|close-out letter|lifted|removed from)\b/i, hides: ['fda_approval', 'fda_submission', 'fda_inspection', 'regulatory_probe'] },
  { id: 'fda_adcom', label: 'FDA advisory committee', category: 'Regulatory & clinical', direction: 'neutral', rank: 3,
    any: [/\badvisory committee\b|\bAdCom\b|\b(?:FDA|advisory) panel\b|\bpanel (?:voted|backs?|backed|recommend)/i],
    dir: (s) => (/\bvoted\b[^.;]{0,40}\b(?:in favou?r|to (?:recommend|support)|that the benefits)\b|\bback(?:s|ed)?\b|\bsupport(?:s|ed)?\b|\bfavorabl|\bpositive vote\b|\brecommend(?:s|ed)? approval\b/i.test(s) ? 'positive' : /\bvoted against\b|\bunfavorabl|\bagainst approval\b|\bnegative vote\b/i.test(s) ? 'negative' : 'neutral'),
    hides: ['fda_approval'] },
  { id: 'fda_approval', label: 'FDA approval / clearance', category: 'Regulatory & clinical', direction: 'positive', rank: 2,
    any: [/\b(?:FDA|Food and Drug Administration)\b[^.;]{0,80}\b(?:approv(?:ed|al|es)|clear(?:ed|ance)|authori[sz](?:ed|ation)|grant(?:ed|s) (?:marketing|approval|clearance))\b/i, /\b(?:approv(?:ed|al)|clearance|cleared)\b[^.;]{0,40}\b(?:by|from) the (?:U\.?S\.? )?(?:FDA|Food and Drug Administration)\b/i, /\b510\(k\) clearance\b|\bDe Novo (?:clearance|authorization|classification)\b|\bPMA approval\b/i, /\bFDA (?:approves|clears)\b/i],
    not: /\bnot (?:yet )?(?:been )?approved\b|\bprior to (?:FDA )?approval\b|\bseek(?:s|ing)? (?:FDA )?approval\b|\bpending (?:FDA )?approval\b|\bsubject to (?:FDA )?approval\b|\bapproved (?:drugs?|products?|therapies) (?:for|in)\b/i },
  { id: 'fda_submission', label: 'Regulatory submission (filed, not approved)', category: 'Regulatory & clinical', direction: 'positive', rank: 4, stage: 'PROPOSED',
    any: [/\b(?:submit(?:s|ted)|fil(?:es|ed)|complet(?:es|ed) (?:the )?submission of)\b[^.;]{0,40}\b(?:NDA|BLA|sNDA|sBLA|PMA|510\(k\)|MAA|IND|New Drug Application|Biologics License Application|Premarket Approval)(?![A-Za-z0-9])/i, /\baccept(?:s|ed|ance)?\b[^.;]{0,40}\b(?:for (?:filing|review)|NDA|BLA|MAA)\b/i, /\bpriority review\b(?! voucher)/i, /\bIND (?:clearance|cleared|is now in effect)\b|\bcleared (?:the |its )?IND\b/i,
      /\b(?:FDA|EMA|regulatory) (?:submission|filing)\b/i, /\bsubmi(?:ts|tted|ssion)\b[^.;]{0,30}\b(?:to|with) (?:the )?(?:FDA|EMA|regulators?)\b/i],
    not: /\b(?:approv(?:ed|es|al) (?:of|for)|granted)\b[^.;]{0,20}\b(?:NDA|BLA)\b/i },
  { id: 'pdufa', label: 'PDUFA date set', category: 'Regulatory & clinical', direction: 'neutral', rank: 4,
    any: [/\bPDUFA\b/, /\b(?:target action date|goal date)\b/i] },
  { id: 'designation', label: 'Breakthrough / fast-track designation', category: 'Regulatory & clinical', direction: 'positive', rank: 5,
    any: [/\bbreakthrough (?:therapy |device )?designation\b/i, /\bfast[- ]track (?:designation|status)\b/i, /\borphan (?:drug )?designation\b/i, /\bRMAT designation\b|\bregenerative medicine advanced therapy\b/i, /\brare pediatric disease designation\b/i, /\bPRIME (?:designation|eligibility)\b/] },
  // zzz840: a voucher is a saleable asset, not a designation.
  { id: 'priority_review_voucher', label: 'Priority review voucher received (a saleable asset; value not stated)', category: 'Regulatory & clinical', direction: 'positive', rank: 5,
    any: [/\bpriority review vouchers?\b/i, /\bPRV\b/],
    not: /\b(?:may|could|might|if) (?:receive|be granted|be eligible)|\beligible (?:for|to receive)\b|\bno (?:priority review )?voucher\b/i },
  { id: 'trial_results', label: 'Clinical trial results / topline data', category: 'Regulatory & clinical', direction: 'positive', rank: 3,
    any: [/\btopline (?:results|data)\b/i, /\b(?:met|achieved|meets|achieves|did not meet|failed to meet|missed)\b[^.;]{0,40}\b(?:primary|secondary|co-primary) (?:efficacy )?endpoints?\b/i, /\bstatistically significant\b/i, /\b(?:positive|encouraging|compelling|interim|final|pivotal) (?:clinical |interim |final |topline |Phase [123][ab]? )?(?:results|data)\b[^.;]{0,60}\b(?:trial|study|Phase|cohort)\b/i, /\bp\s?[<=]\s?0?\.\d+/i],
    dir: (s) => (/\bdid not (?:meet|achieve)|failed to (?:meet|achieve)|missed (?:its |the )?(?:co-)?primary|not statistically significant|discontinu/i.test(s) ? 'negative' : 'positive'),
    not: /\bwill (?:present|report)\b[^.;]{0,40}\b(?:at|during) (?:the )?[A-Z]/ },
  { id: 'trial_milestone', label: 'Trial start / enrolment milestone', category: 'Regulatory & clinical', direction: 'positive', rank: 6,
    any: [/\bfirst (?:patient|participant|subject)s? (?:has been |was |were )?(?:dosed|enrolled|randomi[sz]ed|treated)\b/i, /\bdosed (?:the )?first (?:patient|participant|subject)\b/i, /\b(?:initiat(?:es|ed|ing)|launch(?:es|ed)|start(?:s|ed)|commenc(?:es|ed))\b[^.;]{0,30}\b(?:Phase [123][ab]?|pivotal|registrational|clinical) (?:trial|study|program)\b/i, /\b(?:complet(?:es|ed|ion of)) (?:patient )?enrol(?:l)?ment\b|\benrol(?:l)?ment (?:is |was |has been )?complete\b/i] ,
    hides: ['product_launch'] },
  { id: 'intl_approval', label: 'CE mark / international approval', category: 'Regulatory & clinical', direction: 'positive', rank: 5,
    any: [/\bCE[- ]?[Mm]ark(?:ed|ing)?\b/, /\bEuropean Commission\b[^.;]{0,40}\b(?:approv|authori[sz]|grant)/i, /\bCHMP\b[^.;]{0,30}\b(?:positive opinion|recommend)/i, /\b(?:EMA|Health Canada|PMDA|NMPA|MHRA|TGA|ANVISA|Swissmedic|Japan(?:ese)? Ministry of Health)\b[^.;]{0,60}\b(?:approv(?:ed|al)|authori[sz](?:ed|ation)|clear(?:ed|ance)|grant(?:ed|s))\b/i],
    not: /\bseek(?:s|ing)?\b|\bplans? to (?:seek|file)\b/i },
  // zzz835: a jury verdict / damages award / court judgment is LITIGATION - never an order, contract or licence.
  { id: 'litigation_verdict', label: 'Litigation - jury verdict / damages / judgment', category: 'Regulatory & clinical', direction: 'neutral', rank: 1,
    any: [/\bjury\b[^.;]{0,80}\b(?:award(?:ed|s)?|found|finds|return(?:ed|s)|verdict|damages)\b/i, /\bverdict\b/i, /\b(?:award(?:ed|s)?|granted|ordered to pay|to pay)\b[^.;]{0,60}\bin damages\b|\bdamages (?:award|of)\b|\bdamages\b[^.;]{0,30}\b(?:plus|and) interest\b/i, /\b(?:court|judge)\b[^.;]{0,40}\b(?:entered|enter(?:s|ed)?|issued|rul(?:ed|es)|grant(?:ed|s))\b[^.;]{0,30}\bjudg(?:e)?ment\b/i, /\bfinal judg(?:e)?ment\b/i],
    not: /\bno (?:jury|verdict)\b|\bwaiv(?:ed|es|er of) (?:its |their )?(?:right to )?(?:a )?jury\b|\b(?:prevailed|won|wins|favorable)\b/i,
    dir: (s) => (/\b(?:against|liable|ordered (?:the Company|us) to pay|found (?:the Company|us|that the Company))\b[^.;]{0,30}\b(?:the Company|us|Company)\b|\bagainst the Company\b|\bordered (?:the Company|us) to pay\b/i.test(s) ? 'negative' : /\bawarded (?:the Company|us)\b|\bin favou?r of (?:the Company|us)\b|\b(?:financial (?:entitlement|interest)|entitle(?:d|ment))\b/i.test(s) ? 'positive' : 'neutral'),
    hides: ['patent_litigation_win', 'licensing', 'major_contract', 'customer_win', 'partnership', 'gov_contract'] },
  { id: 'patent_litigation_win', label: 'Patent / litigation win', category: 'Regulatory & clinical', direction: 'positive', rank: 25,
    any: [/\b(?:patent|patents)\b[^.;]{0,30}\b(?:granted|issued|allowed|upheld)\b/i, /\b(?:issued|granted) (?:a |an |two |three )?(?:new )?(?:U\.?S\.? |European |Japanese |Chinese )?patents?\b/i, /\bnotice of allowance\b/i, /\b(?:won|wins|prevail(?:s|ed)?|favorable)\b[^.;]{0,40}\b(?:ruling|verdict|judgment|decision|appeal|arbitration|lawsuit|litigation|case|PTAB|inter partes review)\b/i, /\bjury (?:verdict|awarded)\b/i, /\b(?:dismiss(?:ed|al) of|court dismissed)\b[^.;]{0,40}\b(?:lawsuit|complaint|case|claims)\b/i],
    dir: (s) => (/\badverse|unfavorabl|against the Company|lost\b/i.test(s) ? 'negative' : 'positive') },
  { id: 'settlement', label: 'Legal / regulatory settlement', category: 'Regulatory & clinical', direction: 'neutral', rank: 26,
    any: [/\bsettlement agreement\b/i, /\b(?:settled|settles|resolv(?:ed|es))\b[^.;]{0,40}\b(?:litigation|lawsuit|dispute|claims|investigation|case|arbitration)\b/i],
    hides: ['patent_litigation_win'] },
  { id: 'regulatory_probe', label: 'Regulatory investigation / action', category: 'Regulatory & clinical', direction: 'negative', rank: 26,
    any: [/\b(?:SEC|DOJ|Department of Justice|FTC|CFPB|attorney general)\b[^.;]{0,60}\b(?:subpoena|investigation|charges|complaint|enforcement)\b/i, /\b(?:subpoena|civil investigative demand|Wells notice|formal investigation)\b[^.;]{0,40}\b(?:SEC|DOJ|Department of Justice|FTC|Securities and Exchange Commission)\b/i, /\bWells notice\b/i, /\bwarning letter\b/i, /\b(?:recall|recalls|recalled)\b[^.;]{0,30}\b(?:product|products|devices?|units|lots?)\b/i],
    not: /\bclos(?:ed|es|ing) (?:its|the) investigation\b|\bno (?:further )?action\b/i },

  // ── CAPITAL STRUCTURE ──
  { id: 'buyback', label: 'Share buyback', category: 'Capital structure', direction: 'positive', rank: 27,
    any: [/\b(?:share |stock )?(?:repurchase|buyback|buy-back) (?:program|programme|plan|authori[sz]ation)\b/i, /\bauthori[sz](?:ed|es)\b[^.;]{0,40}\b(?:repurchase|buyback|buy back)\b/i, /\brepurchas(?:ed|es|ing)\b[^.;]{0,30}\b(?:shares|of (?:its|our) (?:common )?stock)\b/i, /\baccelerated share repurchase\b/i],
    not: NO_REPURCHASE },
  // zzz840: in a spin-off / merger the OTHER company often declares the special dividend - it is not this company's.
  { id: 'dividend_counterparty', label: 'Special dividend declared by the counterparty', category: 'Capital structure', direction: 'neutral', rank: 28,
    any: [/(?<!\bThe )(?<!\bthe )\b(?!The\b|We\b|Our\b|Its\b|It\b|This\b|Such\b|Board\b|Company\b|Directors\b|Management\b|Committee\b|Special\b)[A-Z][\w&.-]*(?: [A-Z][\w&.-]*){0,2} (?:will|is expected to|expects to|intends to|has|had|shall|to)?\s*(?:pay|paid|declare|declared|distribute|distributed)s?\b[^.;]{0,50}\bspecial (?:cash )?dividend\b/, /\bspecial (?:cash )?dividend\b[^.;]{0,60}\b(?:declared|paid|payable|to be paid) by\s+(?!the Company\b|us\b|we\b)[A-Z]/],
    hides: ['dividend'] },
  { id: 'dividend', label: 'Special dividend / dividend raise', category: 'Capital structure', direction: 'positive', rank: 27,
    any: [/\bspecial (?:cash )?dividend\b/i, /\b(?:increas(?:es|ed|ing)|rais(?:es|ed|ing)|boost(?:s|ed))\b[^.;]{0,30}\b(?:quarterly |annual |regular )?(?:cash )?dividend\b/i, /\bdividend increase\b/i, /\b(?:initiat(?:es|ed|ing)|reinstat(?:es|ed)|declar(?:es|ed) (?:its |the )?first)\b[^.;]{0,30}\b(?:quarterly |regular )?(?:cash )?dividend\b/i],
    dir: (s) => (/\b(?:suspend|cut|reduc|eliminat)\w*\b[^.;]{0,20}\bdividend/i.test(s) ? 'negative' : 'positive') },
  { id: 'debt_refinancing', label: 'Debt financing / new credit facility', category: 'Capital structure', direction: 'neutral', rank: 35,
    any: [/\b(?:new |amended (?:and restated )?|senior secured |revolving )?(?:credit (?:agreement|facility)|revolving credit|term loan(?: facility)?|loan agreement|financing facility)\b/i, /\brefinanc(?:e|es|ed|ing)\b/i, /\b(?:repaid|repay(?:s|ment of)?|retire(?:d|s)?|extinguish(?:ed|es)?|redeem(?:ed|s)?|redemption of)\b[^.;]{0,40}\b(?:debt|notes|loan|borrowings|term loan)\b/i, /\b(?:became|is now|now) debt[- ]free\b/i, /\bsenior (?:secured |unsecured )?notes\b/i,
      /\b(?:project |mine |construction |senior |term |bank )?debt (?:financing|package|facility|funding|raise)\b/i, /\b(?:US)?\$\s?\d[\d.,]*\s?(?:M|B|MM|million|billion)\s+(?:[A-Z][\w-]*\s+){0,2}(?:project )?debt\b/],
    not: /\bconvertible\b|\bdebt[- ]free basis\b/i,
    dir: (s) => (/\bdebt[- ]free\b|\brepaid|extinguish|retire[ds]?\b|lower(?:s|ed)? (?:its )?(?:interest|cost of)|extend(?:s|ed) (?:the )?maturit/i.test(s) ? 'positive' : 'neutral') },
  { id: 'convertible_private_placement', label: 'Convertible notes offering (private placement)', category: 'Capital structure', direction: 'mixed', rank: 33,
    any: [/\bconvertible\b[^.;]{0,160}\bprivate placement\b/i, /\bprivate placement\b[^.;]{0,160}\bconvertible\b/i],
    hides: ['convertible', 'equity_offering'] },
  { id: 'convertible', label: 'Convertible financing', category: 'Capital structure', direction: 'mixed', rank: 34,
    any: [/\bconvertible (?:senior |secured |unsecured )?(?:notes|debentures|preferred|bonds|note)\b/i] },
  { id: 'equity_offering', label: 'Equity offering / ATM (dilution)', category: 'Capital structure', direction: 'negative', rank: 33,
    any: [/\b(?:underwritten |registered direct |public |follow-on |secondary |confidentially marketed )(?:offering|placement)\b/i, /\bprivate placement\b|\bPIPE\b/, /\bat[- ]the[- ]market (?:offering|program|facility|equity|sales)\b|\bATM (?:program|facility|offering)\b/i, /\bequity (?:line|purchase agreement|distribution agreement)\b/i, /\bpric(?:es|ed|ing) (?:of )?(?:its |an |a |the )?(?:upsized )?(?:\$[\d.,]+\s*(?:million|billion) )?(?:offering|public offering)\b/i],
    not: /\binitial public offering\b[^.;]{0,20}\b(?:in|of) (?:19|20)\d\d\b|\bconvertible\b|\b(?:Registrable )?Notes\b|\bnotes due\b|\baggregate principal amount\b/i },
  { id: 'reverse_split', label: 'Reverse stock split', category: 'Capital structure', direction: 'negative', rank: 36,
    any: [/\breverse (?:stock |share )?split\b/i] },
  { id: 'warrant_exercise', label: 'Warrant exercise / inducement', category: 'Capital structure', direction: 'mixed', rank: 36,
    any: [/\bwarrant (?:inducement|exercise)\b|\bexercise of (?:outstanding )?warrants\b|\binducement (?:letter|agreement)\b/i] },

  // ── MARKET & OWNERSHIP ──
  { id: 'index_inclusion', label: 'Index inclusion (S&P/Russell/Nasdaq-100 add)', category: 'Market & ownership', direction: 'positive', rank: 38,
    any: [/\b(?:added to|join(?:s|ing)?|inclusion in|included in|will replace|to replace)\b[^.;]{0,60}\b(?:S&P (?:SmallCap|MidCap|500|Total Market)|S&P \d{3}|Russell (?:1000|2000|3000|Microcap)|Nasdaq-100|Nasdaq Biotechnology Index|MSCI)\b/i,
      /\b(?:S&P (?:SmallCap|MidCap|500|Total Market)(?: \d{3})?|S&P \d{3}|Russell (?:1000|2000|3000|Microcap)|Nasdaq-100|Nasdaq Biotechnology Index)\b[^.;]{0,30}\b(?:inclusion|addition|index add|index change|rebalanc\w+)\b/i,
      /\b(?:inclusion|addition|added|joins?|set to join)\b[^.;]{0,20}\b(?:in|to|the)?\s*(?:the )?(?:S&P|Russell|Nasdaq-100)\b/i],
    not: /\b(?:may|could|might) be (?:added|included)\b/i },
  // zzz840: sector / theme press ("Meta's AI glasses push lifts an eyewear name") is sympathy, not a company event.
  { id: 'sector_sympathy', label: 'Sector/theme sympathy (no company event)', category: 'Market & ownership', direction: 'neutral', rank: 70,
    any: [/\b(?:sympathy|sector[- ](?:wide )?(?:rally|move|rotation|momentum)|theme(?:atic)? (?:rally|play|momentum)|lifts? (?:the )?(?:sector|group|peers)|peers? (?:rally|jump|surge)|(?:AI|chip|semiconductor|quantum|nuclear|crypto|EV|defense|drone|space|rare earth) (?:stocks|names|plays|trade)\b[^.;]{0,30}\b(?:rall|jump|surg|soar|climb|gain|lift))/i,
      /\b(?:push|boom|craze|frenzy|hype|wave|buzz)\b[^.;]{0,30}\b(?:lifts?|boosts?|sends?|drives?|powers?|fuels?)\b[^.;]{0,40}\b(?:stocks?|shares|names?|makers?|suppliers?|plays?)\b/i] },
  { id: 'uplisting', label: 'Uplisting / new exchange listing', category: 'Market & ownership', direction: 'positive', rank: 38,
    any: [/\buplist(?:ing|ed|s)?\b/i, /\bapproved (?:for|to) list(?:ing)? on (?:the )?(?:Nasdaq|NYSE|New York Stock Exchange)\b/i, /\b(?:begin|began|commence[sd]?|will begin) trading on (?:the )?(?:Nasdaq|NYSE|New York Stock Exchange)\b/i, /\btransfer(?:s|red)? (?:its )?(?:stock )?listing to (?:the )?(?:Nasdaq|NYSE)\b/i] },
  { id: 'listing_deficiency', label: 'Listing deficiency notice', category: 'Market & ownership', direction: 'negative', rank: 39,
    any: [/\b(?:deficiency|delisting|non-?compliance) (?:notice|letter|determination)\b/i, /\bminimum bid price (?:requirement|rule)\b/i],
    dir: (s) => (/\bregain(?:s|ed)? compliance\b/i.test(s) ? 'positive' : 'negative') },
  { id: 'activist_stake', label: 'Activist / large stake (13D)', category: 'Market & ownership', direction: 'positive', rank: 19,
    any: [/\bSchedule 13D\b|\b13D\b/, /\bactivist\b/i, /\b(?:beneficial(?:ly)? own(?:s|ership)? of|stake of|owns?)\s+(?:approximately\s+)?\d+(?:\.\d+)?%\s+of\b/i, /\b(?:nominat(?:e|es|ed|ing)|board seats?)\b[^.;]{0,40}\b(?:directors?|board)\b/i, /\bcooperation agreement\b/i],
    not: /\bSchedule 13G\b|\b(?:expected to|will|would)\s+(?:collectively )?own\b[^.;]{0,40}%[^.;]{0,80}\b(?:combined|pro forma|SpinCo|spin[- ]?off|merger|transaction)\b|\bformer (?:holders|shareholders|stockholders) of\b/i },
  { id: 'insider_buying', label: 'Insider buying', category: 'Market & ownership', direction: 'positive', rank: 37,
    any: [/\binsider (?:buying|purchases?|bought)\b/i, /\b(?:CEO|Chief Executive|CFO|Chairman|director|directors|officer|officers|founder|insiders?)\b[^.;]{0,40}\b(?:bought|purchased|acquired|buys|purchases)\b[^.;]{0,30}\bshares\b/i, /\b(?:CEO|Chief Executive|CFO|Chairman|directors?|officers?|founder|insiders?|10%\s+(?:holder|owner|shareholder|stockholder))\b[^.;]{0,60}\bopen[- ]market purchases?\b/i, /\bopen[- ]market purchases?\b[^.;]{0,40}\bby (?:the |our |its )?(?:CEO|Chief Executive|CFO|Chairman|directors?|officers?|founder|insiders?)\b/i, /\bForm 4\b[^.;]{0,40}\bpurchas/i],
    not: /\bsold\b|\bsales? of\b|\b(?:repurchase|buy-?back|from time to time|under the program|privately negotiated|block trades?|Rule 10b5-1|Rule 10b-18)\b/i },
  { id: 'analyst_action', label: 'Analyst upgrade / initiation (opinion)', category: 'Market & ownership', direction: 'positive', rank: 50,
    any: [/\bupgrad(?:e|es|ed|ing)\b[^.;]{0,40}\b(?:to|rating|shares|stock)\b/i, /\binitiat(?:es|ed|ing) coverage\b/i, /\b(?:raises?|raised|lifts?|lifted|boosts?) (?:its |the )?price target\b/i, /\bprice target\b[^.;]{0,30}\b(?:raised|increased|to \$)/i, /\bdowngrad(?:e|es|ed|ing)\b/i],
    dir: (s) => (/\bdowngrad|\bcuts? (?:its |the )?price target|\blower(?:s|ed) (?:its |the )?price target/i.test(s) ? 'negative' : 'positive') },
  // zzz840: a law-firm notice inviting investors to join a suit / investigation is not a company filing and not a catalyst.
  { id: 'law_firm_solicitation', label: 'Investor-litigation solicitation (law-firm notice; not a company filing)', category: 'Market & ownership', direction: 'neutral', rank: 60,
    any: [/\b(?:Robbins Geller|Rosen Law|Pomerantz|Levi\s?&\s?Korsinsky|Bragar Eagel|Faruqi|Glancy Prongay|Bernstein Liebhard|Kessler Topaz|Hagens Berman|Block\s?&\s?Leviton|Schall Law|Gross Law|Johnson Fistel|Bronstein,? Gewirtz|Kirby McInerney|Saxena White|Portnoy Law|Howard G\. Smith|Frank R\. Cruz|Rigrodsky|Halper Sadeh|Ademi|Monteverde|Brodsky\s?&\s?Smith|Kahn Swick|Wolf Haldenstein|Lowey Dannenberg|Berger Montague|Scott\+Scott|Holzer|Pawar Law|Bleichmar|Labaton|Grant\s?&\s?Eisenhofer|Rudman)\b/i,
      /\b(?:class action (?:lawsuit|suit|filed|alert|deadline)|lead plaintiff deadline|securities (?:fraud|class action)\b)/i,
      /\b(?:encourage|urge|remind|invite)s?\b[^.;]{0,40}\b(?:investors|shareholders|stockholders|witnesses)\b[^.;]{0,80}\b(?:contact|to contact|to join|to learn)\b/i,
      /\binvestigation\b[^.;]{0,80}\bon behalf of\b[^.;]{0,40}\b(?:investors|shareholders|stockholders|purchasers)\b/i,
      /\b(?:SHAREHOLDER|INVESTOR|STOCKHOLDER)S? ALERT\b/i, /\b[A-Z]{2,6} ALERT:\s*(?:Investigation|Class Action|Securities)/,
      /\bLLP\b[^.;]{0,120}\b(?:investors|shareholders|potential witnesses)\b/],
    hides: ['regulatory_probe', 'litigation_verdict', 'settlement', 'patent_litigation_win', 'short_report', 'analyst_action', 'insider_buying', 'activist_stake', 'listing_deficiency'] },
  { id: 'short_report', label: 'Short report / company rebuttal', category: 'Market & ownership', direction: 'negative', rank: 19,
    any: [/\bshort[- ]sell(?:er|ers|ing) (?:report|firm|attack|allegations?)\b/i, /\bshort report\b/i, /\b(?:Hindenburg|Muddy Waters|Spruce Point|Culper|Fuzzy Panda|Grizzly Research|Kerrisdale|Wolfpack|Iceberg Research|Blue Orca|Bleecker Street|J Capital)\b/],
    dir: (s) => (/\b(?:respond(?:s|ed)? to|refut(?:es|ed)|rebut(?:s|ted)?|rejects?|denies|denied|false and misleading|baseless)\b/i.test(s) ? 'positive' : 'negative') },
];

export const US_EVENT_RULE_IDS: string[] = RULES.map((r) => r.id);
const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r] as const));
/** Label + category of a rule id (for renderers). */
export function usEventMeta(id: string): { label: string; category: UsEventCategory; rank: number } | null {
  const r = RULE_BY_ID.get(id);
  return r ? { label: r.label, category: r.category, rank: r.rank } : null;
}

// ── boilerplate / sentences ────────────────────────────────────────────────

/** Sentences that are legal / risk / furnishing language — never an event. */
export const BOILERPLATE = /\b(?:forward[- ]looking (?:statements?|information)|safe harbou?r|private securities litigation reform act|risks? and uncertainties|could cause (?:our |the Company'?s? )?actual|actual results (?:may|could|to) differ|there (?:can|may) be no assurance|no assurance (?:can be given|that)|undertakes? no (?:obligation|duty)|does not undertake|risk factors|could (?:materially )?(?:and )?adversely|adverse(?:ly)? (?:affect|impact)|if we (?:are unable|fail|do not|cannot)|we may not be able|may not (?:be able to|achieve|realize|obtain|succeed)|might not|not be deemed ["“]?filed|incorporated by reference|furnished (?:pursuant|herewith|as Exhibit)|shall not be deemed|Securities Exchange Act of 1934|non-GAAP financial measures? (?:should|are|is) not|reconciliation of (?:GAAP|non-GAAP)|this press release (?:contains|includes|may contain)|words such as|such as ["“]?(?:may|will|expect|anticipate)|shall (?:mean|be deemed|have the meaning)|hereunder|hereby|herein|hereto|thereof|thereunder|as defined (?:in|below|herein)|pursuant to (?:Section|this Agreement|the terms of this)|the undersigned|in witness whereof|representations(?:,| and) warranties|voting results?|results of (?:the )?voting|does not constitute (?:an? )?(?:offer|solicitation|prospectus|public offering)|solicitation of an? off\s?er|no offer (?:to sell|or solicitation)|to consider and (?:approve|vote)|broker non-votes?|initial Business Combination|Sponsor has agreed|trust account)\b|\((?:i|ii|iii|iv|a|b|c)\)[^.]{0,240}\((?:ii|iii|iv|v|b|c|d)\)/i;

/** Hedged plan / expectation — kept, but marked "planned". */
const PLANNED = /\b(?:plans? to|planning to|intends? to|expects? to|expected to|anticipates?|aims? to|seeks? to|targets? (?:to|a)|is evaluating|proposed|will seek|potential(?:ly)?)\b/i;

/** Cut the text at the forward-looking / safe-harbor section and at the
 *  "About <Company>" boilerplate paragraph (when they come after the lead). */
export function eventBodyOf(text: string): string {
  let t = repairSplitText(String(text || '').replace(/\s+/g, ' '))
    // the exhibit's own header ("EX-99.1 2 d168737dex991.htm EX-99.1 Exhibit 99.1 Document")
    .replace(/^\s*(?:EX-\d+(?:\.\d+)?\s+\d+\s+\S+\.html?\s+)?(?:(?:EX-\d+(?:\.\d+)?|Exhibit\s+\d+(?:\.\d+)?|Document)\s+)*/i, '');
  const cutAt = (re: RegExp, min: number) => { const m = re.exec(t); if (m && m.index >= min) t = t.slice(0, m.index); };
  cutAt(/\b(?:Forward[- ]Looking Statements|Cautionary (?:Note|Statement)s?(?: Regarding| Concerning)?|Safe Harbou?r Statement|Special Note Regarding Forward)\b/i, 80);
  cutAt(/\b(?:About|ABOUT) [A-Z][\w.&'’-]*(?: [A-Z][\w.&'’-]*){0,4}\s*(?::|\s(?=[A-Z][\w.&'’-]*(?: [A-Z][\w.&'’-]*){0,4},? (?:Inc\.|Corp\.|Ltd\.|plc|N\.V\.|is (?:a|an|the)|\(|headquartered|founded)))/, 150);
  cutAt(/\b(?:Investor (?:Relations )?Contacts?|Media Contacts?|Contacts?):/i, 300);
  return t;
}

/** Sentences (bullets split). */
export function eventSentences(text: string): string[] {
  return eventBodyOf(text)
    .replace(/&middot;|·|•|●|▪|■/g, ' • ')
    .split(/(?<=[.!?])(?<!\b(?:U\.S|U\.K|Inc|Corp|Co|Ltd|No|Nos|Mr|Ms|Mrs|Dr|St|Jr|Sr|vs|etc|approx|N\.A|S\.A|N\.V|L\.P|p\.m|a\.m|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.)\s+(?=[A-Z"“(•$0-9])|\s•\s|\s+[-–—]{1,2}\s+(?=[A-Z])|(?<=\b(?:19|20)\d\d)\s*[-–—]{1,2}\s*(?=\(?[A-Z])|(?<=(?:BUSINESS WIRE|GLOBE NEWSWIRE|PRNewswire|ACCESSWIRE|ACCESS Newswire|Newsfile)\)?)\s*[-–—]{1,2}\s*/)
    .map((s) => s.replace(/^[•.\s]+/, '').trim())
    .filter((s) => s.length >= 12);
}

// ── figures (literal only) ─────────────────────────────────────────────────

const FIG_RES: RegExp[] = [
  /[-−]?(?:US)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:billion|million|thousand|bn|mn|[MBK])\b)?/gi,
  /[-+]?\d[\d,]*(?:\.\d+)?\s?(?:%|percent\b)/gi,
  /\b\d[\d,]*(?:\.\d+)?\s?(?:basis points|bps)\b/gi,
  /\b\d[\d,]*(?:\.\d+)?\s?(?:MW|GW|MWh|GWh|megawatts?|gigawatts?|square feet|sq\.? ?ft\.?|acres|tons|tonnes|barrels|boe\/d|bpd|units|vehicles|aircraft|systems|patients|participants|subjects|customers|employees|stores|locations|beds|wafers|EH\/s|exahash)\b/gi,
  /\bvoted\s+(\d{1,2}\s?(?:-|–|to)\s?\d{1,2})\b/gi,
  /\b\d{1,2}\s?(?:-|–)\s?\d{1,2}\s+(?:vote|in favou?r)\b/gi,
];

/** Figures literally present in one sentence, in order, de-duplicated. */
export function figuresIn(sentence: string): string[] {
  const s = String(sentence || '');
  const hits: Array<{ at: number; v: string }> = [];
  for (const re of FIG_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const v = (m[1] && /voted/i.test(m[0]) ? m[1] : m[0]).trim().replace(/[,.]$/, '');
      const at = m[1] && /voted/i.test(m[0]) ? m.index + m[0].indexOf(m[1]) : m.index;
      if (!v || !/\d/.test(v)) continue;
      // a bare year / a percent inside a $ span already taken is skipped
      if (hits.some((h) => at >= h.at && at < h.at + h.v.length)) continue;
      hits.push({ at, v });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const out: string[] = [];
  for (const h of hits) if (!out.includes(h.v) && s.includes(h.v)) out.push(h.v);
  return out.slice(0, 6);
}

// ── litigation guard + canonical event type (zzz835) ───────────────────────

/** Words that make a sentence litigation. */
export const LITIGATION_SENTENCE = /\bjury\b|\bverdict\b|\bdamages\b|\blawsuit\b|\bfiled (?:a |an )?(?:complaint|suit)\b|\balleging\b[^.;]{0,80}\bbreach\b|\bbreach of (?:the )?(?:implied covenant|contract)\b/i;
/** Court words that are litigation unless the court is approving a corporate scheme. */
const COURT_WORD = /\b(?:district|federal|supreme|appeals?|circuit|high|superior) court\b|\bcourt of appeals?\b|\bjudg(?:e)?ment (?:was )?entered\b/i;
const SCHEME_COURT = /\bscheme of (?:arrangement|amalgamation)\b|\bNCLT\b|\bamalgamation\b|\bdemerger\b|\bmerger\b|\bcourt[- ]convened\b|\bsanction(?:ed|s)?\b/i;
/** Deterministic: does this text describe a litigation outcome (jury, verdict, damages, judgment, lawsuit, court)? */
export function isLitigationText(text: string | null | undefined): boolean {
  const t = String(text || '');
  if (/\bjury\b|\bverdict\b|\bdamages\b|\blawsuit\b|\bfinal judg(?:e)?ment\b/i.test(t)) return !/\bwaiv\w* (?:its |their )?(?:right to )?(?:a )?jury\b/i.test(t);
  return COURT_WORD.test(t) && !SCHEME_COURT.test(t);
}

export type CanonicalEventType =
  | 'earnings' | 'order' | 'loi' | 'contract' | 'acquisition' | 'trial_result' | 'regulatory'
  | 'litigation' | 'financing' | 'capacity' | 'partnership' | 'ownership' | 'other'
  // zzz836
  | 'regulatory_inspection' | 'credit_rating';

/** The first rule that fires wins: litigation, then LOI / proposed, then a
 *  results release, then order / contract, trial result, acquisition,
 *  earnings, financing … (spec order). Runs BEFORE any model label is
 *  accepted. `proposed` is true for LOI / tentative / subject-to wording. */
export function classifyCanonicalEventType(text: string | null | undefined): { type: CanonicalEventType; rule: string; proposed: boolean } {
  const t = String(text || '');
  const proposed = /\bletters? of intent\b|\bLOIs?\b|\btentative(?:ly)?\b|\bnon-?binding\b|\bproposed\b|\bsubject to (?:the )?(?:approval|receipt|regulatory|shareholder|board|stockholder|definitive)/i.test(t);
  if (isLitigationText(t)) return { type: 'litigation', rule: 'jury / verdict / damages / judgment / court / lawsuit', proposed: false };
  if (/\bletters? of intent\b|\bLOIs?\b/i.test(t)) return { type: 'loi', rule: 'letter of intent', proposed: true };
  // zzz836: a credit rating is its own type (its "outlook" and "Rs 700 crore facilities" are not guidance); an inspection is not an approval
  if (/\b(?:crisil|icra|care ratings?|\bCARE\b|india ratings|ind-?ra|acuit[eé]|infomerics|brickwork|S&P Global Ratings|Moody['’]?s|Fitch)\b[^;]{0,120}\b(?:rating|reaffirm\w*|upgrad\w*|downgrad\w*|outlook)\b|\bcredit rating\b/i.test(t)) return { type: 'credit_rating', rule: 'rating agency / credit rating', proposed: false };
  if (!/\bwarning letter\b|\bcomplete response letter\b/i.test(t) && (/\b(?:usfda|us fda|fda|mhra|eu[- ]?gmp|who[- ]?gmp|health canada)\b[^;]{0,80}\binspect(?:ion|ed|ions)\b|\binspect(?:ion|ed|ions)\b[^;]{0,80}\b(?:usfda|us fda|fda|mhra|form 483|observations?|EIR)\b|\bform 483\b/i.test(t))) return { type: 'regulatory_inspection', rule: 'regulator inspection / Form 483 / observations', proposed: false };
  if (/\bwarning letter\b|\bimport alert\b/i.test(t)) return { type: 'regulatory_inspection', rule: 'warning letter / import alert', proposed: false };
  const earnScore = [/\brevenues?\b/i, /\bnet (?:income|loss)\b/i, /\bEPS\b|earnings per share/i, /\bEBITDA\b/i, /\boutlook\b|\bguidance\b/i, /\bquarter\b|\bfiscal\b/i].filter((r) => r.test(t)).length;
  if (earnScore >= 3 && /\b(?:reports?|reported|announces?)\b[^.]{0,60}\b(?:results|earnings)\b|\bfinancial results\b/i.test(t)) return { type: 'earnings', rule: 'results release', proposed: false };
  if (/\b(?:Phase\s?(?:1|2|3|I{1,3})[ab]?|primary endpoint|co-primary|p\s?[<=]\s?0?\.\d+|p-value|topline)\b/i.test(t)) return { type: 'trial_result', rule: 'phase / endpoint / p-value / topline', proposed };
  if (/\bpurchase order\b|\b(?:awarded|received|secured|won|bags)\b[^;]{0,60}\b(?:order|contract)\b|\bcontract awarded\b|\bwork order\b|\bletter of award\b/i.test(t)) return { type: /\bcontract\b/i.test(t) && !/\border\b/i.test(t) ? 'contract' : 'order', rule: 'purchase order / awarded / received order', proposed };
  if (/\b(?:acquisitions?|acquir(?:e|es|ed|ing))\b|\bstake in\b|\bmerger\b|\bscheme of (?:arrangement|amalgamation)\b|\bshare purchase\b|\bbusiness transfer\b/i.test(t)) return { type: 'acquisition', rule: 'acquire / stake / merger / scheme / share purchase', proposed };
  if (earnScore >= 2 || /\b(?:revenue|net income|EPS|EBITDA|outlook)\b/i.test(t)) return { type: 'earnings', rule: 'revenue / net income / EPS / EBITDA / outlook', proposed: false };
  if (/\b(?:offering|placement|convertible notes|credit facility|term loan|notes due|buyback|repurchase)\b/i.test(t)) return { type: 'financing', rule: 'offering / notes / credit facility', proposed };
  if (/\b(?:FDA|EMA|approval|clearance|designation|regulator)\b/i.test(t)) return { type: 'regulatory', rule: 'regulator', proposed };
  if (/\b(?:capacity|capex|new (?:plant|facility)|commission(?:ed|ing))\b/i.test(t)) return { type: 'capacity', rule: 'capacity', proposed };
  if (/\b(?:partnership|collaboration|joint venture|alliance|memorandum of understanding)\b/i.test(t)) return { type: 'partnership', rule: 'partnership', proposed };
  if (/\b(?:13D|13G|beneficial(?:ly)? own|promoter|shareholding)\b/i.test(t)) return { type: 'ownership', rule: 'ownership', proposed };
  return { type: 'other', rule: 'no deterministic rule fired', proposed };
}

/** Validation errors for a canonical event: a source quote with jury / damages can never be an order or contract; a proposed event can never carry a firm stage. */
export function validateCanonicalEvent(ev: { event_type: string; source_quote: string; stage?: string | null }): string[] {
  const errs: string[] = [];
  const q = String(ev.source_quote || '');
  if (/^(order|contract|loi)$/i.test(ev.event_type) && /\b(?:jury|damages|verdict)\b/i.test(q)) errs.push(`event_type "${ev.event_type}" contradicts a source quote that contains jury / damages / verdict - it must be litigation`);
  if (/^(order|contract)$/i.test(ev.event_type) && isLitigationText(q)) errs.push(`event_type "${ev.event_type}" contradicts a litigation source quote`);
  if (ev.event_type === 'loi' && /^(awarded|executed|completed)$/i.test(String(ev.stage || ''))) errs.push('a letter of intent cannot be awarded / executed / completed');
  return errs;
}

// ── litigation materiality: a gross award is not cash (zzz835) ─────────────

export const LITIGATION_CASH_NOTE = 'Gross award is not expected cash proceeds.';
export interface LitigationRead {
  /** Gross award / damages as written, in $ millions - null when not stated. */
  grossAwardM: number | null;
  grossAwardText: string | null;
  /** Appeal / collectability / entitlement / fees / timing: "stated: <quote>" or "unknown - not stated in the cited filing". */
  appeal: string;
  collectability: string;
  entitlement: string;
  legalCosts: string;
  timing: string;
  interestNote: string | null;
  quote: string;
}
const NOT_STATED = 'unknown - not stated in the cited filing';
/** What the text says about a litigation outcome. Appeal / collectability stay unknown unless the text states them. Never an order/market-cap ratio. */
export function readLitigation(text: string): LitigationRead | null {
  const sents = eventSentences(text);
  // the sentence that STATES the outcome (a title "Statement Regarding Jury Verdict" only names it); the one with an amount first
  const cand = sents.filter((s) => /\bjury\b[^.;]{0,120}\b(?:award\w*|found|finds|return\w*|damages)\b|\bverdict\b[^.;]{0,80}\b(?:award\w*|damages|for|in favou?r)\b|\bawarded?\b[^.;]{0,80}\bdamages\b|\bdamages\b[^.;]{0,40}\bawarded\b|\b(?:court|judge)\b[^.;]{0,60}\bjudg(?:e)?ment\b|\bfinal judg(?:e)?ment\b/i.test(s) && !BOILERPLATE.test(s));
  const lead = cand.find((s) => /\$\s?\d/.test(s)) || cand[0];
  if (!lead) return null;
  const all = sents.join(' ');
  const amt = /(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|bn|mn|[BM])\b/i.exec(lead);
  let grossM: number | null = null;
  if (amt) { const v = parseFloat(amt[1].replace(/,/g, '')); grossM = /^(billion|bn|b)$/i.test(amt[2]) ? v * 1000 : v; }
  const pick = (re: RegExp): string => { const x = sents.find((s) => re.test(s) && !BOILERPLATE.test(s)); return x ? `stated: "${x.length > 200 ? `${x.slice(0, 199)}...` : x}"` : NOT_STATED; };
  return {
    grossAwardM: grossM, grossAwardText: amt ? amt[0].trim() : null,
    appeal: pick(/\bappeal(?:s|ed|ing)?\b|\bpost-trial motions?\b|\bJMOL\b|\bnew trial\b/i),
    collectability: pick(/\bcollect(?:ab|ib)\w*\b|\bpaid\b[^.;]{0,30}\bjudg(?:e)?ment\b|\bpayment of the (?:judg(?:e)?ment|award)\b|\bbond\b/i),
    entitlement: pick(/\bentitle(?:d|ment)\b|\bfinancial (?:interest|entitlement)\b|\bshare of (?:the )?(?:proceeds|award)\b|\bproceeds\b/i),
    legalCosts: pick(/\blegal (?:fees|costs|expenses)\b|\battorneys?'? fees\b|\bcontingen(?:t|cy) fee\b/i),
    timing: pick(/\bexpected (?:to|in)\b[^.;]{0,40}\b(?:judg(?:e)?ment|payment|hearing|ruling)\b|\bhearing (?:is )?scheduled\b|\bto be determined by the (?:District )?Court\b/i),
    interestNote: /\binterest\b/i.test(all) ? 'Interest is mentioned - the amount is not stated in the cited filing.' : null,
    quote: lead.length > 320 ? `${lead.slice(0, 319)}...` : lead,
  };
}

// ── clinical read-out facts, only from the text (zzz835) ───────────────────

export const CLIN_NOT_DISCLOSED = 'not disclosed in the cited filing';
export interface ClinicalFacts {
  result: 'positive' | 'mixed' | 'negative' | 'unclear';
  endpointMet: 'met' | 'not_met' | 'mixed' | 'not_stated';
  indication: string | null;
  phase: string | null;
  primaryEndpoint: string | null;
  effectSize: string | null;
  pValue: string | null;
  confidenceInterval: string | null;
  sampleSize: string | null;
  comparator: string | null;
  dosingInterval: string | null;
  safety: string | null;
  nextStep: string | null;
  /** Names of the fields the text does not state. */
  notDisclosed: string[];
  /** Plain lines: "Effect size: 54% of patients on 6-month dosing", or "... not disclosed in the cited filing". */
  lines: string[];
}
const clipC = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s\S*$/, '')}...` : s);
/** Indication, phase, endpoint result, effect size, p-value / CI, sample size, comparator, dosing interval, safety and next step - each only when the text states it. */
export function extractClinicalFacts(text: string): ClinicalFacts | null {
  const body = eventBodyOf(text);
  const sents = eventSentences(text);
  if (!sents.some((s) => /\b(?:trial|study|topline|interim|data|endpoint|p\s?[<=])\b/i.test(s))) return null;
  const T = sents.join(' ');
  const first = (re: RegExp, group = 0): string | null => { const m = re.exec(T); return m ? (m[group] || m[0]).replace(/\s+/g, ' ').trim() : null; };
  const ph = /\bPhase\s?(1\/2|2\/3|1b|2a|2b|3b?|1|2|III|II|I)\b/i.exec(T);
  const phase = ph ? `Phase ${String(ph[1]).replace(/^III$/i, '3').replace(/^II$/i, '2').replace(/^I$/i, '1')}` : (/\bpivotal\b/i.test(T) ? 'pivotal (phase not stated)' : null);
  const indication = first(/\b(?:in|for|of) (?:adult |adult and pediatric |pediatric |[a-z]+ )?(?:patients|adults|participants|people|subjects|children|individuals)\s+with\s+([A-Za-z][\w\s\-,'/]{3,70}?)(?=[,.;()]|\s(?:who|that|the|compared|versus|vs|as|was|were|met|showed|demonstrated|achieved|receiving|treated)\b|$)/i, 1)
    || first(/\b(?:treatment of|treating)\s+([A-Za-z][\w\s\-,'/]{3,60}?)(?=[,.;()]|\s(?:who|that|in|with)\b|$)/i, 1)
    || first(/\bin\s+((?:generalized anxiety disorder|wet AMD|wAMD|IgA nephropathy|[A-Z][A-Za-z]+(?: [A-Za-z]+){0,3} (?:disease|disorder|syndrome|cancer|carcinoma|leukemia|lymphoma|nephropathy|degeneration|edema|retinopathy|sarcoma)))/i, 1);
  const metRx = /\b(met|achieved|meets|achieves|did not meet|failed to meet|missed|not met)\b[^.;]{0,50}\b(?:the )?(?:primary|co-primary)(?: efficacy)?(?: endpoints?| and all key secondary)/i;
  const mm = metRx.exec(T);
  const negEnd = /\bdid not meet|failed to meet|missed|not met\b/i.test(mm ? mm[0] : '');
  const posEnd = !!mm && !negEnd;
  const secFail = /\bdid not (?:meet|achieve)[^.;]{0,40}\bsecondary\b|\bfailed[^.;]{0,30}\bsecondary\b/i.test(T);
  const endpointMet: ClinicalFacts['endpointMet'] = mm ? (negEnd ? 'not_met' : secFail ? 'mixed' : 'met') : (/\bstatistically significant\b/i.test(T) && !/\bnot statistically significant\b/i.test(T) ? 'met' : 'not_stated');
  const pe = /\bprimary (?:efficacy )?endpoint(?:s)?\s+(?:of|was|were|is|being|measured (?:by|as)|:)\s+([^.;]{6,140})/i.exec(T);
  const primaryEndpoint = pe && !/^(?:\(p|p\s?[<=])/i.test(pe[1]) ? clipC(pe[1].replace(/\s+/g, ' ').trim(), 140) : null;
  const pv = /\bp(?:-value)?\s?(?:of|[<=]|was|=)\s?(?:<|=)?\s?(0?\.\d+(?:e-?\d+)?)/i.exec(T);
  const pValue = pv ? `p ${/[<]/.test(pv[0]) ? '<' : '='} ${pv[1]}` : null;
  const ci = /\b(\d{2}(?:\.\d)?%\s?(?:CI|confidence interval)[^.;]{0,50}|\(?95%\s?CI[:,]?\s?[-\d.,\s to]+\)?)/i.exec(T);
  const eff = /\b(?:hazard ratio|HR|odds ratio|OR|relative risk|LS mean (?:difference|change)|mean (?:change|difference|improvement))\b[^.;]{0,50}?-?\d+(?:\.\d+)?/i.exec(T)
    || /\b(?:majority of patients|patients|participants)\s*\((\d+(?:\.\d+)?%)\)[^.;,]{0,50}/i.exec(T)
    || /\b\d+(?:\.\d+)?%\s+(?:reduction|improvement|increase|decrease|of patients|of participants|response|remission)\b[^.;]{0,50}/i.exec(T)
    || /\b(?:reduc\w+|improv\w+|increase\w*|decreas\w+)\b[^.;]{0,30}\bby\s+\d+(?:\.\d+)?%[^.;]{0,40}/i.exec(T);
  const effectSize = eff ? clipC(eff[0].replace(/\s+/g, ' ').trim(), 140) : null;
  const n = /\b(?:n\s?=\s?|enrolled |randomi[sz]ed |of )(\d[\d,]{1,6})\s*(?:patients|participants|subjects|adults|people)?/i.exec(T) || /\b(\d[\d,]{2,6})\s+(?:patients|participants|subjects|adults)\b/i.exec(T);
  const sampleSize = n ? `${n[1]} ${/patients|participants|subjects|adults|people/i.exec(n[0])?.[0] || 'participants'}`.replace(/\s+/g, ' ') : null;
  const cmp = /\b(?:compared (?:with|to)|versus|vs\.?|placebo-controlled|active[- ]controlled|non-inferior(?:ity)? to|comparable to)\s+((?:placebo|[A-Za-z][\w-]+(?: [A-Za-z][\w-]+){0,2}))/i.exec(T) || /\bcompared\s+[A-Za-z][\w-]*(?: [A-Za-z][\w-]*){0,2}\s+(?:with|to|against)\s+((?:placebo|[A-Za-z][\w-]+))/i.exec(T);
  const comparator = cmp ? cmp[1].replace(/\s+/g, ' ').trim() : (/\bplacebo\b/i.test(T) ? 'placebo' : null);
  const dose = /\b(\d+|one|two|three|four|six|twelve)[- ](?:month|week)(?:ly)? (?:dosing|interval|regimen|treatment interval)\b|\b(?:every|q)\s?(\d+)\s?(?:months?|weeks?|W|M)\b|\b(?:once|twice)[- ](?:daily|weekly|monthly)\b/i.exec(T);
  const dosingInterval = dose ? dose[0].replace(/\s+/g, ' ') : null;
  const saf = sents.find((s) => /\b(?:safety|adverse events?|tolerab\w+|discontinu\w+|serious adverse|well[- ]tolerated|no (?:new )?safety signals?)\b/i.test(s));
  const safety = saf ? clipC(saf, 200) : null;
  const nxt = sents.find((s) => /\b(?:BLA|NDA|sNDA|MAA|submission|submit|regulatory (?:filing|path|pathway)|PDUFA|meet(?:ing)? with the FDA|end[- ]of[- ]phase|approval)\b/i.test(s) && /\b(?:plan|expect|intend|will|anticipate|on track|planned|submitted)\w*\b/i.test(s));
  const nextStep = nxt ? clipC(nxt, 200) : null;
  const neg = endpointMet === 'not_met' || /\bdid not (?:meet|achieve)|failed to meet|not statistically significant\b/i.test(T);
  const pos = endpointMet === 'met' || /\bpositive\b[^.;]{0,40}\b(?:results|data|topline)\b/i.test(T);
  const result: ClinicalFacts['result'] = neg && pos ? 'mixed' : neg ? 'negative' : pos ? 'positive' : 'unclear';
  const f: ClinicalFacts = { result, endpointMet, indication: indication ? clipC(indication, 80) : null, phase, primaryEndpoint, effectSize, pValue, confidenceInterval: ci ? ci[1].trim() : null, sampleSize, comparator, dosingInterval, safety, nextStep, notDisclosed: [], lines: [] };
  const fields: Array<[keyof ClinicalFacts, string]> = [['indication', 'Indication'], ['phase', 'Phase'], ['primaryEndpoint', 'Primary endpoint'], ['effectSize', 'Effect size'], ['pValue', 'Statistical evidence (p-value)'], ['confidenceInterval', 'Confidence interval'], ['sampleSize', 'Sample size'], ['comparator', 'Comparator'], ['dosingInterval', 'Dosing interval'], ['safety', 'Safety'], ['nextStep', 'Next regulatory step']];
  f.lines.push(`Clinical result: ${result}${endpointMet === 'not_stated' ? '' : ` (primary endpoint ${endpointMet.replace('_', ' ')})`}`);
  for (const [k, lab] of fields) { const v = f[k] as string | null; if (v) f.lines.push(`${lab}: ${v}`); else { f.notDisclosed.push(String(k)); f.lines.push(`${lab}: ${CLIN_NOT_DISCLOSED}`); } }
  void body;
  return f;
}

// ── the classifier ────────────────────────────────────────────────────────

/** The form rules match on: abbreviation dots removed ("Inc." "U.S." "Sept.")
 *  so a "[^.;]" window is not cut by them. The evidence and the figures are
 *  always taken from the ORIGINAL sentence. */
function matchForm(s: string): string {
  return s
    .replace(/\bU\.S\.(?=\W|$)/g, 'US').replace(/\bU\.K\.(?=\W|$)/g, 'UK')
    .replace(/\b(Inc|Corp|Co|Ltd|LLC|Mr|Ms|Mrs|Dr|St|Jr|Sr|vs|etc|approx|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Tenn|Calif|Mass|Ave|Blvd)\.(?=\s|,)/g, '$1')
    .replace(/\b([A-Z])\.([A-Z])\.(?=\s|,)/g, '$1$2');
}
/** A "[^.;]" / "[^.]" window also crosses a decimal point ("$31.2 million"). */
const decimalTolerant = (re: RegExp) => new RegExp(re.source.replace(/\[\^\.;\]/g, '(?:[^.;]|\\.(?=\\d))').replace(/\[\^\.\]/g, '(?:[^.]|\\.(?=\\d))'), re.flags);
for (const r of RULES) { r.any = r.any.map(decimalTolerant); if (r.not) r.not = decimalTolerant(r.not); }

/** zzz840: rules whose trigger words are negated by the words just before them do not fire. */
const NEG_GUARDED = new Set(['buyback', 'dividend', 'guidance_raise', 'guidance_cut', 'acquisition', 'merger_agreement', 'takeover_bid', 'divestiture', 'equity_offering', 'convertible', 'restructuring', 'gov_contract', 'major_contract', 'customer_win', 'licensing', 'partnership', 'joint_venture', 'fda_approval', 'fda_submission', 'intl_approval', 'strategic_investment', 'settlement', 'debt_refinancing', 'capacity_expansion', 'new_facility', 'product_launch']);

/** A long sentence is shown around the words that fired the rule. */
function clipAround(s: string, at: number, n = 320): string {
  if (s.length <= n) return s;
  const start = Math.max(0, Math.min(at - 110, s.length - n));
  const a = start > 0 ? s.slice(start).replace(/^\S*\s/, '') : s;
  const out = a.length > n - 1 ? `${a.slice(0, n - 2).replace(/\s\S*$/, '')}…` : a;
  return `${start > 0 ? '…' : ''}${out}`;
}

export interface ClassifyOptions {
  /** Max hits returned (default 12). */
  max?: number;
  /** Only the first N sentences are read (default 400). */
  maxSentences?: number;
  /** Max characters of text read (default 120 000). */
  maxChars?: number;
  /** Text is a single headline — no sentence split, no boilerplate cut. */
  headline?: boolean;
  /** zzz840: the issuer's own name — a special dividend "declared by X" is the counterparty's unless X is the issuer. */
  issuer?: string | null;
}

const SHARE_SALE_WORDS = /\b(?:shares?|common stock|ordinary shares|per share|ADSs?|units|warrants?|at[- ]the[- ]market|ATM)\b/i;
/** zzz840: a convertible-notes private placement is debt with potential dilution - the same release must not also list a share sale. Pure. */
export function reconcileConvertibleHits<T extends { id: string; label: string; sentence: string; figures: string[] }>(hits: T[]): T[] {
  const cv = hits.find((h) => h.id === 'convertible' || h.id === 'convertible_private_placement');
  if (!cv) return hits;
  const eq = hits.find((h) => h.id === 'equity_offering');
  if (!eq) return hits;
  // a real share sale states shares / stock / ATM in ITS sentence; "private placement of the Notes" does not
  if (SHARE_SALE_WORDS.test(eq.sentence) && !/\bconvertible\b|\bnotes\b/i.test(eq.sentence)) return hits;
  const pp = /\bprivate placement\b|\bPIPE\b/i.test(eq.sentence) || /\bprivate placement\b/i.test(cv.sentence);
  return hits.filter((h) => h.id !== 'equity_offering').map((h) => (h === cv && pp && cv.id === 'convertible' ? { ...h, id: 'convertible_private_placement', label: 'Convertible notes offering (private placement)' } : h));
}

/** Every catalyst named in the text: one hit per event type (the first
 *  sentence that states it), lead catalyst first. Figures are only those
 *  literally present in the evidence sentence. */
export function classifyUsEvents(text: string, opts: ClassifyOptions = {}): UsEventHit[] {
  const raw = String(text || '').slice(0, opts.maxChars ?? 120_000);
  if (!raw.trim()) return [];
  const sents = opts.headline ? [repairSplitText(raw.replace(/\s+/g, ' ').trim())] : eventSentences(raw).slice(0, opts.maxSentences ?? 400);
  const byId = new Map<string, UsEventHit & { order: number }>();
  const dirs = new Map<string, Set<UsEventDirection>>();
  sents.forEach((s, order) => {
    if (BOILERPLATE.test(s)) return;
    const m = matchForm(s);
    const here: Array<{ r: Rule; hit: UsEventHit }> = [];
    for (const r of RULES) {
      const had = byId.get(r.id);
      if (had && !r.dir && (had.figures.length || order - had.order > 10)) continue;
      if (!r.any.some((re) => re.test(m))) continue;
      if (r.not && r.not.test(m)) continue;
      // zzz840: a negated trigger ("did not repurchase", "no material contract") is not the event; a background approval is not a new one
      if (NEG_GUARDED.has(r.id) && hasNegatedTrigger(m, r.any)) continue;
      if ((r.id === 'fda_approval' || r.id === 'intl_approval') && isBackgroundApproval(m)) continue;
      // zzz835: a sentence describing a lawsuit / jury / damages claim is litigation, never a licence, partnership or order
      if (r.category === 'Deals & customers' && LITIGATION_SENTENCE.test(m)) continue;
      // a rule whose direction reads from the sentence remembers every
      // direction it saw — a title "topline results" and a bullet "missed
      // the primary endpoint" make the hint MIXED, never just positive
      if (r.dir) { const d = dirs.get(r.id) || new Set<UsEventDirection>(); d.add(r.dir(m)); dirs.set(r.id, d); }
      // a later sentence replaces a figure-less first one (a release title)
      // only when it states a figure and sits close to it
      if (had && (had.figures.length || order - had.order > 10)) continue;
      const at = Math.min(...r.any.map((re) => { const x = re.exec(m); return x ? x.index : Infinity; }));
      const shown = clipAround(s, Number.isFinite(at) ? at : 0);
      const figures = figuresIn(shown);
      if (had && !figures.length) continue;
      here.push({ r, hit: { id: r.id, label: r.label, category: r.category, direction: r.dir ? r.dir(m) : r.direction, sentence: shown, figures, planned: PLANNED.test(shown), ...(r.stage ? { stage: r.stage } : {}), ...(figures.length ? { metrics: extractMetrics(shown) } : {}) } });
    }
    // a more specific rule hides a generic one fired by the same sentence
    const hidden = new Set(here.flatMap((x) => x.r.hides || []));
    for (const x of here) {
      if (hidden.has(x.r.id)) continue;
      const had = byId.get(x.r.id);
      byId.set(x.r.id, { ...x.hit, order: had ? had.order : order });
    }
  });
  for (const [id, h] of Array.from(byId.entries())) {
    const d = dirs.get(id);
    if (d && d.has('positive') && d.has('negative')) byId.set(id, { ...h, direction: 'mixed' });
  }
  // zzz840: the counterparty's special dividend is attributed to it, unless the issuer itself is the payer
  if (opts.issuer) {
    const key = String(opts.issuer).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).find((w) => w.length > 2 && !/^(?:inc|corp|corporation|company|holdings?|group|ltd|plc|the|technologies|therapeutics)$/.test(w));
    const dc = byId.get('dividend_counterparty');
    if (key && dc && dc.sentence.toLowerCase().includes(key)) {
      const d = RULE_BY_ID.get('dividend')!;
      byId.delete('dividend_counterparty');
      if (!byId.has('dividend')) byId.set('dividend', { ...dc, id: d.id, label: d.label, direction: 'positive' });
    }
  }
  const rank = (id: string) => RULE_BY_ID.get(id)?.rank ?? 99;
  // the lead catalyst: an event stated early (the release's lead) and of a
  // strong kind first; a planned event after a done one of the same rank.
  return reconcileConvertibleHits(Array.from(byId.values()))
    .sort((a, b) => (Math.min(a.order, 6) - Math.min(b.order, 6)) * 4 + (rank(a.id) - rank(b.id)) || (Number(a.planned) - Number(b.planned)) || a.order - b.order)
    .slice(0, opts.max ?? 12)
    .map(({ order: _o, ...h }) => ({ ...h, economicDirection: directionOf(h.id, h.sentence, h.direction), directionNote: directionNote(h.id, h.sentence), subtype: subtypeOf(h.id, h.sentence, 'US') }));
}

/** Counts of hits by category (every category present, zero when none). */
export function countByCategory(hits: Array<Pick<UsEventHit, 'category'>>): Record<UsEventCategory, number> {
  const out = Object.fromEntries(US_EVENT_CATEGORIES.map((c) => [c, 0])) as Record<UsEventCategory, number>;
  for (const h of hits) out[h.category] = (out[h.category] || 0) + 1;
  return out;
}
