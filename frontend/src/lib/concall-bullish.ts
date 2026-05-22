// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0387 — Concall Intelligence: Bullish Scoring Engine
//
// Multi-layer filter per the institutional blueprint:
//   1. RELEVANCE — subject contains transcript / concall / investor
//      presentation / results presentation / analyst meet / audio recording
//      / webcast keywords.
//   2. BULLISH EVIDENCE — KEYWORD COMBINATIONS (not single words).
//      Management confidence phrase + business evidence phrase + zero
//      critical negative blockers.
//   3. SCORING — weighted phrase groups; score >= 6 surfaces in feed.
//
// Used by both:
//   - /api/v1/concall-intel/live-feed (NSE/BSE auto-poll)
//   - /api/v1/concall/analyze (existing manual analyser, future enrichment)
// ═══════════════════════════════════════════════════════════════════════════

// ─── Layer 1: Relevance check ───────────────────────────────────────────────
// Returns the filing TYPE if relevant; null otherwise.

export type ConcallFilingType =
  | 'TRANSCRIPT'
  | 'INVESTOR_PRESENTATION'
  | 'CONCALL_INVITE'
  | 'ANALYST_MEET'
  | 'AUDIO_RECORDING'
  | 'RESULTS_PRESENTATION'
  | 'PRESS_RELEASE'
  | 'WEBCAST'
  // PATCH 0669 — Reg-30 / Reg-15 alpha categories surfaced through
  // dedicated pages (/order-book, /rating-actions). Previously dropped
  // by classifyFiling so /order-book + /rating-actions had no data.
  | 'ORDER_RECEIPT'
  | 'RATING_ACTION';

// PATCH 0406 — broadened patterns so capital-goods / industrial names whose
// subject just says "Submission of Earnings Presentation" or "Q4 FY26
// Earnings Update" don't get dropped. User flagged TDPOWERSYS as missing
// — many such names file under titles that don't include the word
// "presentation" or "concall" verbatim.
const RELEVANCE_PATTERNS: Array<{ type: ConcallFilingType; re: RegExp }> = [
  { type: 'TRANSCRIPT',            re: /transcript|earnings\s+call\s+transcript|conference\s+call\s+transcript|q[1-4]\s+(?:fy)?\s*\d{2,4}\s+transcript/i },
  { type: 'INVESTOR_PRESENTATION', re: /investor\s+presentation|investor\s+meet\s+presentation|earnings?\s+presentation|investor\s+(?:update|deck)|q[1-4]\s+(?:fy)?\s*\d{2,4}\s+(?:investor|earnings)/i },
  { type: 'RESULTS_PRESENTATION',  re: /results\s+presentation|results\s+update|quarterly\s+(?:update|results\s+update)|earnings\s+presentation|earnings\s+update|q[1-4]\s+(?:fy)?\s*\d{2,4}\s+(?:results|update)/i },
  { type: 'CONCALL_INVITE',        re: /\b(?:con\s*call|conference\s+call|earnings\s+call|investor\s+call)\b|conf(?:erence)?\.?\s+call/i },
  { type: 'ANALYST_MEET',          re: /\banalyst\s+meet(?:ing)?\b|\banalyst\s+day\b|institutional\s+investor\s+meet|investor\s+meet(?:ing)?\b|investor\s+(?:day|conference|forum|summit)|broker\s+meet|institutional\s+meet/i },
  { type: 'AUDIO_RECORDING',       re: /audio\s+recording|audio\s+file\s+of|recording\s+of\s+the\s+(?:earnings|investor|analyst|conference)|audio[- ]recording/i },
  { type: 'WEBCAST',               re: /webcast|live\s+stream\s+of|live\s+webcast|web[- ]?cast/i },
  { type: 'PRESS_RELEASE',         re: /press\s+release.*(?:result|earnings|guidance|outlook|q[1-4]|quarter)|q[1-4]\s+(?:fy)?\s*\d{2,4}\s+press\s+release/i },
  // PATCH 0672 — NSE-canonical category subjects (probed live: 176 order +
  // 98 rating filings in May 1-22, 2026 window). NSE uses these exact phrases
  // as the `csubject` field:
  //   "Bagging/Receiving of orders/contracts"
  //   "Receipt of Order/Letter of Award"
  //   "Credit Rating"
  // My P0669 regex missed both because:
  //   (a) it required "Receipt of order" but NSE says "Receiving of orders"
  //   (b) it required "Credit Rating + action/update/revision" suffix
  //       but NSE files under bare "Credit Rating" category.
  // PATCH 0709 — institutional synonym expansion. User audit flagged that
  // parsers were catching <20% of real events. Widened to: L1 bidder,
  // EPC contract, framework agreement, rate contract, supply agreement,
  // turnkey project, letter of acceptance/intent, MOU, strategic partnership,
  // definitive agreement, DPSU/DDC awards. Rating side adds: outlook
  // revision, rating watch with developing/negative/positive, credit
  // profile, surveillance, BWR/SMERA/Acuité/Infomerics agencies.
  { type: 'ORDER_RECEIPT', re: /bagging\s*\/\s*receiving|receipt\s+of\s+order|letter\s+of\s+(?:award|acceptance|intent)|\bLoA\b|\bLoI\b|\bMOU\b|memorandum\s+of\s+understanding|work\s+order|purchase\s+order|quarterly\s+POs?|contract\s+award|order\s+received|receiving\s+of\s+orders|bagging\s+of\s+orders|bagged\s+(?:an?\s+|the\s+|new\s+)?(?:order|contract|project)|wins?\s+(?:an?\s+|the\s+|new\s+)?(?:order|contract|project|deal|mandate|tender|bid)|secured\s+(?:an?\s+|the\s+|new\s+)?(?:order|contract|project|mandate)|order\s+(?:intake|book\s+update|win)|\bnew\s+order\b|\bL1\s+(?:bidder|status|position|in\s+the|for\s+the)|emerged\s+(?:as\s+)?(?:the\s+)?(?:L1|lowest|preferred|successful)\s*bidder|selected\s+(?:as\s+(?:the\s+)?)?(?:lowest|preferred|successful)?\s*bidder|framework\s+(?:agreement|contract)|rate\s+contract|\bEPC\s+(?:contract|order|project|award)|supply\s+(?:agreement|contract)|turnkey\s+(?:project|contract|order)|strategic\s+(?:agreement|partnership|contract)\b.{0,40}(?:signed|entered|inked)|definitive\s+agreement|(?:awarded|won)\s+(?:a\s+|the\s+)?(?:tender|bid|RFP|RFQ|EPC|contract)|binding\s+(?:offer|agreement)|(?:DDC|DPSU)\s+(?:award|contract|order)|Rail(?:way)?s?\s+(?:order|contract|award)|(?:exclusive|sole)\s+(?:supplier|distributor|vendor)\s+(?:agreement|contract)/i },
  { type: 'RATING_ACTION', re: /\bcredit\s+rating\b|\b(?:ICRA|CRISIL|CARE\s+Ratings?|India\s+Ratings?|Ind[-\s]Ra|Fitch|Moody|Standard\s*&?\s*Poor|S&P\s+Global|Brickwork|BWR|SMERA|Acuit[eé]|Infomerics)\b|rating\s+(?:upgrade|downgrade|reaffirm|revised|revision|assigned|withdrawn|placed|removed|action|change|outlook|surveillance|migration)|\b(?:upgraded|downgraded|reaffirmed|revised|placed)\s+(?:from|to|at)\s+(?:[A-Z]{1,3}[+\-]?\d?\s*)?(?:positive|negative|stable|developing|negative\s+outlook|positive\s+outlook)?\b|outlook\s+(?:revised|changed|moved|placed)\s+(?:from|to)|watch\s+with\s+(?:developing|negative|positive)\s+implications|rating\s+watch|credit\s+(?:profile|assessment|opinion|update)|long[-\s]term\s+rating|short[-\s]term\s+rating|bank\s+(?:facilities?|loan)\s+rating|NCD\s+rating|CP\s+rating/i },
];

export function classifyFiling(subject: string): ConcallFilingType | null {
  const s = subject || '';
  for (const { type, re } of RELEVANCE_PATTERNS) {
    if (re.test(s)) return type;
  }
  return null;
}

// ─── Layer 2: Bullish keyword combinations ─────────────────────────────────
// Per user spec: NOT single keywords. Each combination = anchor + supporting
// term + (optional) numeric/timeline qualifier. A filing scores points for
// each combination it matches.

interface BullishCombo {
  tag: string;                    // user-facing label
  weight: number;                 // points if combo fires
  anchors: RegExp[];              // at least one must match
  supports: RegExp[];             // at least one must match
  qualifiers?: RegExp[];          // optional — adds +1 bonus if matched
  reason: string;                 // narrative for UI
}

export const BULLISH_COMBOS: BullishCombo[] = [
  // Guidance combo
  {
    tag: 'Guidance',
    weight: 3,
    anchors: [/\bguidance\b/i, /\boutlook\b/i, /\bforecast\b/i],
    supports: [/\b(?:raise|raised|raising|upgrade|upgraded|upgrading|maintain(?:ed|ing)?|reiterate)\b/i, /better\s+than\s+expected/i, /confidence\s+in\s+(?:growth|outlook)/i],
    qualifiers: [/\d+(?:\.\d+)?\s*%/, /\bFY2[5-9]\b/i, /next\s+quarter/i],
    reason: 'Guidance / outlook raised or reiterated',
  },
  // Order book combo
  {
    tag: 'Order Book',
    weight: 3,
    anchors: [/order\s+book/i, /order\s+inflow/i, /order\s+pipeline/i, /order\s+backlog/i],
    supports: [/\b(?:strong|robust|healthy|record|all[-\s]?time\s+high|multi[-\s]?(?:quarter|year))\b/i, /grew/i, /increased?/i, /expanded?/i],
    qualifiers: [/\d+(?:\.\d+)?\s*%/, /multi[-\s]?year\s+visibility/i],
    reason: 'Order book / pipeline strength',
  },
  // Capacity combo
  {
    tag: 'Capacity',
    weight: 2.5,
    anchors: [/\bcapacity\b/i, /\butilization\b/i, /\butilisation\b/i, /commissioning/i],
    supports: [/\b(?:ramp(?:[-\s]?up)?|expand(?:ed|ing)?|improve[ds]?|commercial\s+production|commission(?:ed|ing)?)\b/i],
    qualifiers: [/\d+(?:\.\d+)?\s*%/, /new\s+(?:plant|facility|line)/i],
    reason: 'Capacity expansion / utilization improving',
  },
  // Demand combo
  {
    tag: 'Demand',
    weight: 2.5,
    anchors: [/\bdemand\b/i, /\binquir(?:y|ies)\b/i, /\bpipeline\b/i, /sales\s+inquir/i],
    supports: [/\b(?:strong|robust|healthy|accelerat|surge|pickup|acceleration)\b/i],
    qualifiers: [/double[-\s]?digit/i, /\d+(?:\.\d+)?\s*%/],
    reason: 'Demand acceleration',
  },
  // Margin combo
  {
    tag: 'Margin',
    weight: 3,
    anchors: [/EBITDA\s+margin/i, /operating\s+(?:margin|leverage)/i, /gross\s+margin/i],
    supports: [/\b(?:improved?|expand(?:ed|ing)?|expansion|normaliz|step[-\s]?up|recover)/i],
    qualifiers: [/\d+\s*(?:bps|basis\s+points|pp|percentage\s+points|%)/i],
    reason: 'Margin expansion / operating leverage',
  },
  // Export combo
  {
    tag: 'Export',
    weight: 2,
    anchors: [/\bexport\b/i, /\binternational\b/i, /overseas/i],
    supports: [/\b(?:growth|new\s+customer|market\s+share|traction|inroad|win)\b/i],
    reason: 'Export traction',
  },
  // Customer-win combo
  {
    tag: 'New Customer',
    weight: 2.5,
    anchors: [/new\s+customer/i, /approved\s+vendor/i, /repeat\s+order/i, /qualif(?:y|ied)/i, /onboard(?:ed)?/i, /tier[-\s]?1\s+customer/i],
    supports: [/\b(?:ramp(?:[-\s]?up)?|scale[-\s]?up|multi[-\s]?year|long[-\s]?term|won)\b/i, /major\s+(?:OEM|client|customer)/i],
    reason: 'New customer / repeat order',
  },
  // Market share combo
  {
    tag: 'Market Share',
    weight: 2,
    anchors: [/market\s+share/i, /share\s+gain/i, /share\s+of\s+wallet/i],
    supports: [/\b(?:gain(?:ed|ing)?|increased?|expanded?|grew)\b/i],
    reason: 'Market share gain',
  },
  // Cash flow combo
  {
    tag: 'Cash Flow',
    weight: 2,
    anchors: [/free\s+cash\s+flow/i, /operating\s+cash\s+flow/i, /\bFCF\b/, /\bCFO\b/],
    supports: [/\b(?:strong|improved?|turned\s+positive|generated|cash[-\s]?accretive)\b/i],
    reason: 'Cash generation',
  },
  // Deleveraging combo
  {
    tag: 'Deleveraging',
    weight: 2.5,
    anchors: [/deleverag(?:e|ing)/i, /\bdebt\s+reduc/i, /debt[-\s]?free/i, /net\s+cash/i, /balance\s+sheet/i],
    supports: [/\b(?:improved?|strengthen|reduced?|fall|fell|repaid|prepay)\b/i],
    qualifiers: [/₹\s*\d+\s*(?:cr|crore)/i, /\d+(?:\.\d+)?\s*%/],
    reason: 'Balance sheet repair',
  },
  // Premiumization
  {
    tag: 'Premiumization',
    weight: 2,
    anchors: [/premium(?:isation|ization|ize|ise)/i, /better\s+mix/i, /value[-\s]?added/i, /higher[-\s]?margin\s+segment/i],
    supports: [/\b(?:shift|growth|increased?|expand|trend)\b/i],
    reason: 'Premiumization / mix improvement',
  },
  // Capex / growth investment
  {
    tag: 'Capex',
    weight: 1.5,
    anchors: [/\bcapex\b/i, /capital\s+expenditure/i, /\bgreenfield\b/i, /\bbrownfield\b/i],
    supports: [/\b(?:announced?|planned?|approved?|commission|on\s+track)\b/i],
    qualifiers: [/₹\s*\d+\s*(?:cr|crore)/i],
    reason: 'Capacity expansion capex',
  },
  // PATCH 0392 — SOFT-BULLISH indirect phrases. Per user feedback:
  // companies rarely say "we are extremely bullish". They say "demand
  // environment improved", "visibility remains strong", "margin
  // trajectory improving" — these are bullish but indirect.
  {
    tag: 'Demand',
    weight: 1.5,
    anchors: [/demand\s+environment/i, /demand\s+trajectory/i, /\bdemand\b/i],
    supports: [/\b(?:improved?|improving|recovering|strengthen|holding\s+up|broad[-\s]?based|encourag|positive)\b/i],
    reason: 'Demand environment improving (soft signal)',
  },
  {
    tag: 'Order Book',
    weight: 1.5,
    anchors: [/\bpipeline\b/i, /\bvisibility\b/i, /\bbacklog\b/i],
    supports: [/\b(?:healthy|remains?\s+strong|building|growing|expand|encourag|positive)\b/i],
    reason: 'Pipeline / visibility holding up (soft signal)',
  },
  {
    tag: 'Margin',
    weight: 1.5,
    anchors: [/margin\s+(?:trajectory|profile|outlook)/i, /\boperating\s+margin/i, /gross\s+margin/i, /\bEBITDA\s+margin/i, /margin\s+(?:level|recovery)/i],
    supports: [/\b(?:improving|on\s+track|holding|stable\s+to\s+improving|expansion\s+ahead|recover)\b/i],
    reason: 'Margin trajectory improving (soft signal)',
  },
  {
    tag: 'Capacity',
    weight: 1.5,
    anchors: [/\butilization\b/i, /\butilisation\b/i, /capacity\s+ramp/i],
    supports: [/\b(?:improved?|increased?|trending\s+up|steady|moving\s+up|inching\s+up|gradually\s+improving)\b/i],
    reason: 'Utilization improving (soft signal)',
  },
  {
    tag: 'Guidance',
    weight: 1.5,
    anchors: [/\boutlook\b/i, /way\s+forward/i, /near[-\s]?term/i, /medium[-\s]?term/i, /going\s+forward/i],
    supports: [/\b(?:remains?\s+(?:strong|robust|healthy|positive)|confident|encouraging|constructive|positive)\b/i],
    reason: 'Outlook commentary constructive (soft signal)',
  },
  // Broad-based positivity
  {
    tag: 'Margin',
    weight: 1.0,
    anchors: [/operating\s+leverage|cost\s+(?:efficienc|optimiz|control)|cost\s+management/i],
    supports: [/\b(?:visible|playing\s+out|coming\s+through|kicking\s+in|driving|deliver)\b/i],
    reason: 'Operating leverage / cost discipline visible',
  },
  // Order book / revenue acceleration mentioned indirectly
  {
    tag: 'Demand',
    weight: 1.0,
    anchors: [/\b(?:double[-\s]?digit|high\s+single[-\s]?digit)\b/i],
    supports: [/\b(?:growth|expansion|increase|delivery)\b/i],
    reason: 'Double-digit growth referenced',
  },
];

// ─── Layer 3: Negative blockers ────────────────────────────────────────────
// PATCH 0391 — Three severity tiers per user spec.
// LOW    (-0.5): temporary softness / delays / seasonal — normal market noise
// MEDIUM (-2):   weak demand / margin pressure / pricing pressure / slowdown
// FATAL  (auto-reject): guidance cut / auditor change / governance / debt stress

export type BlockerSeverity = 'LOW' | 'MEDIUM' | 'FATAL';

interface NegBlocker {
  re: RegExp;
  weight: number;       // points subtracted (only for non-FATAL)
  severity: BlockerSeverity;
  critical: boolean;    // legacy alias for FATAL (kept for compat)
  tag: string;
}

export const NEG_BLOCKERS: NegBlocker[] = [
  // FATAL — auto-reject from bullish classification
  { re: /guidance\s+(?:cut|lowered|reduced|withdrawn|miss(?:ed)?)/i, weight: 5, severity: 'FATAL', critical: true,  tag: 'Guidance cut' },
  { re: /auditor\s+(?:resign|change|withdraw)|qualified\s+(?:audit|opinion)|audit\s+qualification/i, weight: 5, severity: 'FATAL', critical: true, tag: 'Auditor issue' },
  { re: /accounting\s+(?:irregularit|restate|fraud)|SEBI\s+investigation|enforcement\s+action/i, weight: 5, severity: 'FATAL', critical: true, tag: 'Governance / regulatory' },
  { re: /covenant\s+breach|debt\s+default|going\s+concern|insolvency|liquidity\s+crisis/i, weight: 5, severity: 'FATAL', critical: true, tag: 'Debt stress' },
  { re: /promoter\s+(?:exit|stake\s+sale)\s+(?:on|of)\s+stress|pledge\s+invoked/i, weight: 5, severity: 'FATAL', critical: true, tag: 'Promoter exit under stress' },
  { re: /shutdown|plant\s+closure|production\s+halt/i,         weight: 4, severity: 'FATAL', critical: true,  tag: 'Shutdown' },
  { re: /\bmajor\s+contract\s+(?:cancel|loss)|key\s+customer\s+loss/i, weight: 4, severity: 'FATAL', critical: true, tag: 'Major contract loss' },
  // MEDIUM — significant headwinds, not deal-killers
  { re: /weak\s+demand|demand\s+softness|muted\s+demand/i,     weight: 2.0, severity: 'MEDIUM', critical: false, tag: 'Weak demand' },
  { re: /margin\s+pressure|margin\s+compression|margin\s+contraction/i, weight: 2.0, severity: 'MEDIUM', critical: false, tag: 'Margin pressure' },
  { re: /pricing\s+pressure|price\s+erosion|pricing\s+decline/i, weight: 1.8, severity: 'MEDIUM', critical: false, tag: 'Pricing pressure' },
  { re: /muted\s+outlook|cautious\s+outlook|uncertain\s+outlook/i, weight: 1.8, severity: 'MEDIUM', critical: false, tag: 'Cautious outlook' },
  { re: /inventory\s+correction|destocking|inventory\s+(?:overhang|build[-\s]?up)/i, weight: 1.5, severity: 'MEDIUM', critical: false, tag: 'Inventory correction' },
  { re: /receivable\s+stress|working\s+capital\s+stretch/i,    weight: 1.5, severity: 'MEDIUM', critical: false, tag: 'Receivable stress' },
  { re: /lower\s+utilization|lower\s+utilisation|under[-\s]?utiliz/i, weight: 1.5, severity: 'MEDIUM', critical: false, tag: 'Lower utilization' },
  { re: /cost\s+inflation|raw[-\s]?material\s+pressure/i,      weight: 1.2, severity: 'MEDIUM', critical: false, tag: 'Cost inflation' },
  { re: /one[-\s]?off|exceptional\s+(?:gain|item)/i,           weight: 1.2, severity: 'MEDIUM', critical: false, tag: 'One-off gain' },
  // LOW — normal market noise, real businesses always have some of these.
  // PATCH 0392: weight dropped from 0.5 → 0.25 per user feedback.
  // 'every cyclical business mentions temporary slowdowns; most large
  // companies discuss delays. These are normal.'
  { re: /\b(?:delay(?:ed|s)?|postpone(?:d|ment)?|deferred?|deferment)\b/i, weight: 0.25, severity: 'LOW', critical: false, tag: 'Delay' },
  { re: /\bslowdown|deceleration|sluggish/i,                   weight: 0.25, severity: 'LOW', critical: false, tag: 'Slowdown' },
  { re: /temporary\s+(?:softness|weakness)|seasonal\s+(?:weakness|softness)/i, weight: 0.25, severity: 'LOW', critical: false, tag: 'Temporary softness' },
  { re: /near[-\s]?term\s+(?:headwind|challenge|pressure)/i,   weight: 0.25, severity: 'LOW', critical: false, tag: 'Near-term headwind' },
  { re: /geopolitical\s+headwind|adverse\s+macro/i,            weight: 0.25, severity: 'LOW', critical: false, tag: 'Macro headwind' },
  { re: /\bcancel(?:l(?:ed|ation))?\b/i,                       weight: 1.5, severity: 'MEDIUM', critical: false, tag: 'Cancellation' },

  // PATCH 0411 — Working-capital / capital-allocation negative detectors.
  // These are Tier-1 quality signals — when a management slips them
  // into the prepared remarks or admits them in Q&A, the underlying
  // story is materially worse than the headline narrative suggests.
  // Heavier weights than generic "delay" because they show up in actual
  // financial behavior, not just commentary.
  { re: /(?:inventory|stock)\s+days?\s+(?:rose|increased|extended|expanded|grew)\s+(?:to\s+|from\s+|by\s+)?\d/i, weight: 2.2, severity: 'MEDIUM', critical: false, tag: 'Inventory days rising' },
  { re: /(?:debtor|receivable)\s+days?\s+(?:rose|increased|extended|expanded|grew)\s+(?:to\s+|from\s+|by\s+)?\d/i, weight: 2.2, severity: 'MEDIUM', critical: false, tag: 'Receivable days expanding' },
  { re: /working\s+capital\s+(?:intensity|cycle)\s+(?:expanded|extended|grew|deteriorated)/i, weight: 2.0, severity: 'MEDIUM', critical: false, tag: 'Working capital stress' },
  { re: /(?:single|one)\s+customer\s+(?:account|contribut)\w*\s+(?:for\s+|to\s+)?\d{2,}\s*%/i, weight: 2.5, severity: 'MEDIUM', critical: false, tag: 'Single customer concentration' },
  { re: /top\s+(?:five|5|three|3)\s+customers?\s+(?:account|contribut)\w*\s+(?:for\s+|to\s+)?[6-9]\d\s*%/i, weight: 1.8, severity: 'MEDIUM', critical: false, tag: 'Top customer concentration' },
  { re: /(?:commissioning|project)\s+(?:has\s+been\s+)?(?:delayed|postponed|deferred|pushed\s+out)\s+(?:to|by|until)/i, weight: 2.0, severity: 'MEDIUM', critical: false, tag: 'Delayed commissioning' },
  { re: /(?:equity\s+|share\s+)?dilution\s+of\s+\d|warrant\s+conversion\s+dilut/i, weight: 2.0, severity: 'MEDIUM', critical: false, tag: 'Dilution' },
  { re: /cfo\/?\s*pat\s+(?:ratio\s+)?(?:fell|declined|deteriorated|at\s+0\.[0-5])/i, weight: 2.5, severity: 'MEDIUM', critical: false, tag: 'Weak CFO/PAT' },
  { re: /capex\s+(?:funded\s+by\s+debt|debt[-\s]?funded)/i, weight: 1.8, severity: 'MEDIUM', critical: false, tag: 'Debt-funded capex' },
  { re: /cost\s+inflation\s+(?:outpac|outstripp|exceed)\w*\s+(?:pricing|realiz|recovery)/i, weight: 2.2, severity: 'MEDIUM', critical: false, tag: 'Cost outpacing pricing' },
];

// ─── Scoring engine ────────────────────────────────────────────────────────
// PATCH 0389 — Sentence-level scoring with negation/contradiction detection
// and evidence quotes. Per user feedback: "strong demand last quarter but
// current slowdown expected" must NOT score bullish.

export interface EvidenceSentence {
  text: string;               // truncated to 250 chars
  tag: string;                // which combo it matched
  polarity: 'BULL' | 'BEAR';
  negated: boolean;           // was this overridden by a contradiction connector?
}

// PATCH 0391 — multi-tier classification per user spec
// PATCH 0396 — Added DATA_PENDING for filings without PDF extraction yet,
// so they don't pollute NEUTRAL (which should mean "we DID look at content
// and it was genuinely neutral").
export type BullishTier = 'ULTRA_BULLISH' | 'BULLISH' | 'MIXED_POSITIVE' | 'NEUTRAL' | 'BEARISH' | 'INSUFFICIENT' | 'DATA_PENDING';

export interface BullishScore {
  score: number;                         // 0-10 normalized
  raw_score: number;                     // raw points (post-cap, post-negation)
  sentiment: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'INSUFFICIENT';
  tier: BullishTier;                     // PATCH 0391 — multi-tier classifier
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  tags: string[];                        // matched combo tags
  bullish_phrases: string[];
  red_flags: string[];
  critical_blocker: boolean;             // any FATAL blocker
  fatal_blockers: string[];              // PATCH 0391
  components: {
    management_confidence: number;
    business_evidence: number;
    positive_score: number;              // PATCH 0391 — total positive (before negs)
    blockers: number;
    blocker_severity_low: number;        // PATCH 0391 — pts subtracted at LOW
    blocker_severity_medium: number;
    blocker_severity_fatal: number;
    // PATCH 0396 — 3-layer score decomposition (Quality / Cycle / Sentiment)
    quality_score: number;               // 0-10 — margin stability, cashflow, deleveraging, no FATAL
    cycle_score: number;                 // 0-10 — order book, capex, capacity, utilization, demand
    sentiment_score: number;             // 0-10 — guidance, management tone, outlook
    composite_score: number;             // 0-10 — 0.5*Q + 0.3*C + 0.2*S
    earnings_anchored: boolean;          // does the filing have explicit financial numbers?
    anchor_evidence: string[];           // ['Revenue +12% YoY', 'Margin +280bps', 'Order book ₹3000Cr']
  };
  // PATCH 0389 — evidence sentences extracted from the source text
  evidence: EvidenceSentence[];
}

// PATCH 0396 — Earnings anchoring patterns. A filing can score >6 ONLY if
// it explicitly mentions one of these (revenue/margin/order book numbers).
// Prevents buzzword-only inflation per institutional spec.
// PATCH 0398 — Broadened to catch real-world phrasings: 'highest-ever
// revenue/EBITDA/PAT', 'record FY/Q', 'best-ever quarter', plus more
// varied YoY% patterns.
const EARNINGS_ANCHOR_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // Revenue / sales growth %
  { re: /(?:revenue|sales|topline)[\s\w]{0,40}(?:grew?|growth|increased?|up|rose|jumped)\s+(?:by\s+)?\d{1,3}(?:\.\d+)?\s*%/i,         label: 'Revenue growth % stated' },
  { re: /\b\d{1,3}(?:\.\d+)?\s*%\s+(?:YoY|year[-\s]?on[-\s]?year|QoQ|growth)\s+(?:revenue|sales|topline)/i,                          label: 'Revenue YoY% stated' },
  // PATCH 0398 — superlatives that imply concrete financial achievement
  { re: /\bhighest[-\s]?ever\s+(?:annual\s+|quarterly\s+|FY\s*\d+\s+)?(?:revenue|sales|EBITDA|PAT|profit|earnings|topline)/i,         label: 'Highest-ever financial stated' },
  { re: /\brecord[-\s]+(?:FY|Q[1-4]|quarterly|annual)?\s*(?:revenue|sales|EBITDA|PAT|profit|earnings|topline|quarter|year|performance)/i, label: 'Record FY/Q performance' },
  { re: /\bbest[-\s]?ever\s+(?:quarter|year|annual|FY|Q[1-4])/i,                                                                       label: 'Best-ever period stated' },
  { re: /\ball[-\s]?time\s+high\b/i,                                                                                                    label: 'All-time high stated' },
  // PATCH 0398 — Q4/Q3/Q2/Q1 +X% YoY pattern (common in industry stats / company refs)
  { re: /\bQ[1-4]\s+[+]?\d{1,3}(?:\.\d+)?\s*%\s*(?:Q4|YoY|QoQ|year)/i,                                                                  label: 'Quarterly +X% YoY' },
  { re: /\bFY\s*\d+\s+(?:closed|delivered|reported|posted|registered)\s+(?:at|with)?\s*(?:highest|record|best|strong)/i,                label: 'FY closed with milestone' },
  // PATCH 0398 — explicit value: "revenue of ₹X cr", "EBITDA at ₹X cr"
  { re: /(?:revenue|sales|EBITDA|PAT|profit)[\s\w]{0,15}(?:of|at|stood\s+at|reached|reported)\s+(?:Rs\.?|₹|INR)?\s*\d+[\,\.\d]*\s*(?:cr|crore|bn|billion|mn|million)/i, label: '₹Cr value stated' },
  // EBITDA / margin in bps / pp
  { re: /(?:EBITDA|operating|gross|net)\s+margin[\s\w]{0,40}(?:expanded?|improved?|increased?|recovered?)\s+(?:by\s+)?\d+\s*(?:bps|basis\s+points|pp|percentage\s+points)/i, label: 'Margin expansion bps' },
  { re: /\d+\s*(?:bps|basis\s+points|pp)\s+(?:margin|EBITDA|gross)/i,                                                                label: 'Margin bps stated' },
  // PATCH 0398 — "margin recovered to X.X%" pattern (CMSINFO style)
  { re: /margin[\s\w]{0,30}(?:recovered|improved|expanded)\s+(?:by\s+)?\d+\s*(?:bps|basis\s+points)\s+to\s+\d+(?:\.\d+)?\s*%/i,         label: 'Margin recovered bps to %' },
  // PAT / EBITDA / profit growth
  { re: /(?:PAT|profit|EBITDA)[\s\w]{0,40}(?:grew?|growth|increased?|up|rose|jumped)\s+(?:by\s+)?\d{1,3}(?:\.\d+)?\s*%/i,             label: 'PAT/EBITDA growth %' },
  { re: /\d{1,3}(?:\.\d+)?\s*%\s+(?:YoY|year[-\s]?on[-\s]?year|QoQ|growth)\s+(?:PAT|profit|EBITDA)/i,                                  label: 'Profit YoY% stated' },
  // Order book value
  { re: /order\s+book[\s\w]{0,15}(?:of|at|stood\s+at|reached|crossed|above)\s+(?:Rs\.?|₹|INR)?\s*\d+[\,\.\d]*\s*(?:cr|crore)/i,       label: 'Order book ₹Cr stated' },
  { re: /(?:Rs\.?|₹|INR)\s*\d+[\,\.\d]*\s*(?:cr|crore)\s+order\s+book/i,                                                              label: 'Order book ₹Cr stated' },
  // Capex value
  { re: /capex[\s\w]{0,15}(?:of|at|plan|planned)\s+(?:Rs\.?|₹|INR)?\s*\d+[\,\.\d]*\s*(?:cr|crore)/i,                                  label: 'Capex ₹Cr stated' },
  // Specific double-digit growth with number
  { re: /\b\d{2,3}\s*%\s+(?:growth|increase|expansion|gain)/i,                                                                        label: 'Double-digit % growth' },
  { re: /\bdouble[-\s]?digit\s+(?:revenue|sales|profit|EBITDA|growth|expansion)/i,                                                     label: 'Double-digit growth' },
];

// PATCH 0398 — Boilerplate / accounting-footnote patterns that pollute RISK
// evidence. Sentences matching these are common disclosure boilerplate, not
// management bearish commentary. Per user: PGIL's risks showed three
// 'EBITDA excludes ESOP expenses' lines — these are footnotes, not signals.
const RISK_BOILERPLATE_PATTERNS: RegExp[] = [
  /\bEBITDA\s+excludes\b/i,
  /\b(?:Adj|Adjusted)\s+(?:PBT|PAT|EBITDA)\s+excludes\b/i,
  /\bexcludes?\s+(?:exceptional|ESOP|one[-\s]?off|exceptional\s+items?)/i,
  /^\s*\*\s+(?:Excludes?|Ratio|Figures|Key\s+ratios)/i,
  /\bratio\s+calculated\s+(?:excluding|after)/i,
  /\bfigures?\s+(?:are\s+on\s+)?consolidated\s+basis/i,
  /\brounded\s+off\s+to\s+nearest/i,
  /\bkey\s+ratios?\s+FY\s*\d+/i,
  /\bcash\s+flow\s+from\s+operating\s+activities/i,  // cash flow statement headers
  /\b(?:operating|profit\s+before)\s+working\s+capital\s+changes/i,
  /\bnet\s+cash\s+flows?\s+generated/i,
  /\bdepreciation\s+\d+/i,
  /\bfinance\s+cost\s+\d+/i,
];

function isRiskBoilerplate(sentence: string): boolean {
  return RISK_BOILERPLATE_PATTERNS.some(re => re.test(sentence));
}

function detectEarningsAnchors(text: string): { anchored: boolean; evidence: string[] } {
  const evidence: string[] = [];
  for (const p of EARNINGS_ANCHOR_PATTERNS) {
    if (p.re.test(text) && !evidence.includes(p.label)) {
      evidence.push(p.label);
    }
  }
  return { anchored: evidence.length >= 1, evidence };
}

// Buzzword tags that need financial anchoring (per user spec: AI/EV/solar/
// renewable boost score without economics linkage = false positive)
const BUZZWORD_TAGS = new Set(['Demand']);  // soft Demand variants flagged

// Tags grouped into 3 layers for the institutional score
const QUALITY_TAGS = new Set(['Margin', 'Cash Flow', 'Deleveraging', 'Premiumization']);
const CYCLE_TAGS   = new Set(['Order Book', 'Capacity', 'Demand', 'New Customer', 'Market Share', 'Export', 'Capex']);
const SENTIMENT_TAGS = new Set(['Guidance']);


const MGMT_CONFIDENCE_TAGS = new Set(['Guidance', 'Demand', 'Margin', 'Premiumization']);
const BUSINESS_EVIDENCE_TAGS = new Set(['Order Book', 'Capacity', 'New Customer', 'Market Share', 'Export', 'Cash Flow', 'Deleveraging', 'Capex']);

// Contradiction connectors — when a sentence contains these, the polarity of
// content AFTER the connector is what counts (often a "but X is bad" reversal)
const CONTRADICTION_CONNECTORS = /\b(but|however|yet|though|although|while|despite|notwithstanding|whereas)\b/i;

// Forward-looking softeners that weaken bullish phrases when present
const SOFTENERS = /\b(temporary|transitory|short[- ]term|near[- ]term|cautious|uncertain|may\s+improve|hope\s+to|expect\s+to\s+recover)\b/i;

// PATCH 0393 — Junk filter for evidence sentences. Catches what the
// sanitizer missed: slide-template fragments like '03Where Platform
// Meets Possibilitiescms.com' that bled through pdf-parse.
const EVIDENCE_JUNK_PATTERNS: RegExp[] = [
  /\b\w+\.com\b/i,                                // URLs
  /^[\d\s]{0,5}(?:where|why|how|what)\s+(?:platform|company|business)\s+meets/i,  // template tagline pattern
  /^[\d\s]{0,5}[A-Z][a-z]+(?:[A-Z][a-z]+){2,}/,  // CamelCaseSlideTitle pattern
  /^\s*\d+\s+(?:where|page|section|slide|chapter)/i,  // "12 Where Platform..." / "12 Page..."
  /(?:©|copyright)\s*\d{4}/i,                     // copyright lines
  /\b(?:safe\s+harbor|disclaimer|cautionary\s+statement)\b/i,  // legal blocks
];

function isJunkEvidence(s: string): boolean {
  return EVIDENCE_JUNK_PATTERNS.some(re => re.test(s));
}

function splitSentences(text: string): string[] {
  // Split on sentence terminators, keep reasonable length
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 25 && s.length <= 1000)
    .filter(s => !isJunkEvidence(s));
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

// PATCH 0391 — Negative penalty multiplier per user spec (weighted net scoring)
const NEG_WEIGHT_MULTIPLIER = 0.65;

function emptyScore(tier: BullishTier = 'INSUFFICIENT'): BullishScore {
  return {
    score: 0, raw_score: 0,
    sentiment: 'INSUFFICIENT', tier, confidence: 'LOW',
    tags: [], bullish_phrases: [], red_flags: [],
    critical_blocker: false, fatal_blockers: [],
    components: {
      management_confidence: 0, business_evidence: 0, positive_score: 0,
      blockers: 0, blocker_severity_low: 0, blocker_severity_medium: 0, blocker_severity_fatal: 0,
      quality_score: 0, cycle_score: 0, sentiment_score: 0, composite_score: 0,
      earnings_anchored: false, anchor_evidence: [],
    },
    evidence: [],
  };
}

// PATCH 0396 — Compute 3-layer scores from tag distribution
function compute3LayerScores(
  qualityPts: number,
  cyclePts: number,
  sentimentPts: number,
  totalPositive: number,
  weightedNeg: number,
  fatal: boolean,
): { quality: number; cycle: number; sentiment: number; composite: number } {
  if (fatal) return { quality: 0, cycle: 0, sentiment: 0, composite: 1 };
  // Normalize each layer to 0-10 with reasonable scale
  const quality = Math.max(0, Math.min(10, qualityPts * 1.8 - weightedNeg * 0.3));
  const cycle = Math.max(0, Math.min(10, cyclePts * 1.5 - weightedNeg * 0.2));
  const sentiment = Math.max(0, Math.min(10, sentimentPts * 2 - weightedNeg * 0.25));
  // Institutional composite: 0.5 Q + 0.3 C + 0.2 S
  const composite = Math.max(0, Math.min(10, 0.5 * quality + 0.3 * cycle + 0.2 * sentiment));
  return {
    quality: Math.round(quality * 10) / 10,
    cycle: Math.round(cycle * 10) / 10,
    sentiment: Math.round(sentiment * 10) / 10,
    composite: Math.round(composite * 10) / 10,
  };
}

function classifyTier(positive: number, weightedNeg: number, fatal: boolean, mgmt: number, biz: number, tagDiversity: number, redFlagCount: number = 0): BullishTier {
  if (fatal) return 'BEARISH';
  const net = positive - weightedNeg;
  // PATCH 0393 — Calibrate per user feedback: CMSINFO with 2 red flags
  // (Slowdown + Delay) was hitting ULTRA_BULLISH 10.0 but should be
  // MIXED_POSITIVE ~6.5 per institutional spec. Red flag count gates the
  // upper tiers.
  // ULTRA_BULLISH — requires ZERO red flags (truly clean upside)
  if (positive >= 12 && net >= 10 && mgmt >= 3 && biz >= 3 && tagDiversity >= 4 && redFlagCount === 0) return 'ULTRA_BULLISH';
  // BULLISH — allowed 1 red flag (mild friction)
  if (net >= 4 && mgmt >= 1.5 && biz >= 1.5 && redFlagCount <= 1) return 'BULLISH';
  // MIXED_POSITIVE — softer signal, friction tolerated (real-world bulk)
  if (positive >= 2.5 && net >= 0.5) return 'MIXED_POSITIVE';
  // BEARISH — clearly negative or fatal blocker
  if (net <= -2) return 'BEARISH';
  return 'NEUTRAL';
}

export function scoreBullish(text: string): BullishScore {
  const t = text || '';
  if (t.length < 40) return emptyScore();

  let raw = 0;
  const tagSet = new Set<string>();
  const phraseSet = new Set<string>();
  const evidence: EvidenceSentence[] = [];
  let mgmtConfidence = 0;
  let businessEvidence = 0;

  // PATCH 0389 — sentence-level scan
  const sentences = splitSentences(t);
  const useSentences = sentences.length >= 3;

  if (useSentences) {
    // PATCH 0424 — Noise filter (institutional review item 4.2). Drop
    // sentences that are dominated by generic geopolitical / supply-chain
    // / macro boilerplate UNLESS they also contain a directional verb.
    // Without this, ~80% of transcripts inflate the same shared noise into
    // their "Demand" and "Bottleneck" clusters.
    const NOISE_RE = [
      /\bsupply[\s-]chain\s+disruption\b/i,
      /\bgeopolitical\s+(?:uncertainty|tension|environment)/i,
      /\bmiddle[\s-]east\s+(?:crisis|conflict|tension)/i,
      /\bmacro[\s-]?(?:economic\s+)?(?:headwind|uncertainty|environment)/i,
      /\bevolving\s+(?:regulatory|environment|landscape)/i,
      /\bglobal\s+(?:headwind|uncertainty|environment)/i,
      /\bchallenging\s+(?:environment|macro|backdrop)/i,
      /\b(?:russia[\s-]?ukraine|red\s+sea)\s+(?:war|crisis|conflict|disruption)/i,
      /\b(?:strait\s+of\s+hormuz|suez)\s+(?:closure|disruption)/i,
    ];
    const DIRECTIONAL_RE = /\b(?:grew|increased|up\s+\d|down\s+\d|decreased|declined|expanded|compressed|improved\s+to|recovered\s+to|fell\s+by|gained|lost|outpaced|missed|beat|guidance\s+of|target\s+of|expect(?:ed)?\s+to|will\s+grow|order\s+book|capacity\s+of|margin\s+of|EBITDA\s+(?:margin|grew)|revenue\s+(?:grew|increased))\b/i;

    // Score each sentence independently. Track which combos fire per sentence
    // so we can pull representative evidence quotes.
    for (const sent of sentences) {
      const noiseHits = NOISE_RE.filter(re => re.test(sent)).length;
      if (noiseHits > 0 && !DIRECTIONAL_RE.test(sent)) continue;   // pure noise — skip
      const hasContradiction = CONTRADICTION_CONNECTORS.test(sent);
      const hasSoftener = SOFTENERS.test(sent);
      // If the sentence contains a contradiction connector, the polarity is
      // determined by the SECOND half (after the connector) per the user's
      // example: "strong demand last quarter BUT current slowdown expected"
      let effectiveText = sent;
      if (hasContradiction) {
        const parts = sent.split(CONTRADICTION_CONNECTORS);
        if (parts.length >= 3) {
          effectiveText = parts.slice(2).join(' ').trim() || sent;
        }
      }

      // Bullish combos — anchor + support must match in effective text
      for (const combo of BULLISH_COMBOS) {
        const anchorHit = combo.anchors.some(re => re.test(effectiveText));
        const supportHit = combo.supports.some(re => re.test(effectiveText));
        if (!anchorHit || !supportHit) continue;
        // Skip if sentence contains a critical blocker — contradiction
        const sentBlocker = NEG_BLOCKERS.find(b => b.critical && b.re.test(sent));
        if (sentBlocker) {
          // Bullish phrase NEGATED — record as bear-flipped evidence
          evidence.push({
            text: truncate(sent, 250),
            tag: combo.tag,
            polarity: 'BEAR',
            negated: true,
          });
          continue;
        }
        let pts = combo.weight;
        if (combo.qualifiers && combo.qualifiers.some(re => re.test(effectiveText))) pts += 1;
        if (hasSoftener) pts *= 0.5;  // soften vague positivity
        raw += pts;
        tagSet.add(combo.tag);
        phraseSet.add(combo.reason);
        if (MGMT_CONFIDENCE_TAGS.has(combo.tag)) mgmtConfidence += pts;
        if (BUSINESS_EVIDENCE_TAGS.has(combo.tag)) businessEvidence += pts;
        if (evidence.length < 12) {
          evidence.push({
            text: truncate(sent, 250),
            tag: combo.tag,
            polarity: 'BULL',
            negated: false,
          });
        }
      }
    }

    // PATCH 0391 — Negative blockers with SEVERITY TIERS, not single weight
    // PATCH 0397 — Dedupe blocker hits per filing. Per user feedback:
    // Pearl Global got -14.4 weight from triple-counting 'exceptional item'
    // in legal boilerplate. Each blocker tag should count ONCE per filing
    // (i.e., once per blocker pattern), not once per matched sentence.
    const blockerEvidence: EvidenceSentence[] = [];
    let totalBlockerWeight = 0;
    let weightedNegPenalty = 0;
    let blockerLow = 0;
    let blockerMed = 0;
    let blockerFatal = 0;
    let criticalBlocker = false;
    const redFlagSet = new Set<string>();
    const fatalBlockers: string[] = [];
    // Track which blocker patterns have already fired (by tag) to dedupe
    const firedBlockers = new Set<string>();
    for (const sent of sentences) {
      // PATCH 0398 — Skip accounting footnote / boilerplate sentences. They
      // shouldn't surface as RISK evidence (e.g. 'EBITDA excludes ESOP
      // expenses' is a disclosure note, not bearish commentary).
      if (isRiskBoilerplate(sent)) continue;
      for (const b of NEG_BLOCKERS) {
        if (b.re.test(sent)) {
          // Always capture evidence (so user sees multiple supporting quotes)
          if (blockerEvidence.length < 6) {
            blockerEvidence.push({
              text: truncate(sent, 250),
              tag: b.tag,
              polarity: 'BEAR',
              negated: false,
            });
          }
          // But only weight the blocker ONCE per filing per tag
          if (firedBlockers.has(b.tag)) continue;
          firedBlockers.add(b.tag);
          totalBlockerWeight += b.weight;
          redFlagSet.add(b.tag);
          if (b.severity === 'FATAL') {
            blockerFatal += b.weight;
            criticalBlocker = true;
            if (!fatalBlockers.includes(b.tag)) fatalBlockers.push(b.tag);
          } else if (b.severity === 'MEDIUM') {
            blockerMed += b.weight;
            weightedNegPenalty += b.weight;
          } else {
            blockerLow += b.weight;
            weightedNegPenalty += b.weight;
          }
        }
      }
    }
    evidence.push(...blockerEvidence);

    // PATCH 0391 — Weighted net scoring per user spec
    // final_score = positive_score * 1.0 - weighted_negative_score
    // Only FATAL auto-rejects. MEDIUM/LOW are penalties but don't kill the score.
    const positiveScore = raw;  // raw at this point is just sum of bullish combo points
    const weightedNeg = weightedNegPenalty * NEG_WEIGHT_MULTIPLIER;

    if (criticalBlocker) {
      // FATAL — cap raw at a low value so tier classifier produces BEARISH
      raw = Math.max(-5, raw - blockerFatal * 2);
    } else {
      raw = positiveScore - weightedNeg;
    }

    // Diminishing returns — tag diversity cap (only when no FATAL)
    const tagDiversity = tagSet.size;
    if (!criticalBlocker) {
      if (tagDiversity <= 1) raw = Math.min(raw, 4);
      else if (tagDiversity === 2) raw = Math.min(raw, 7);
      else raw = Math.min(raw, 12);
    }
    // PATCH 0393 — Red-flag dampening: 2+ red flags cap raw at 7 so the
    // filing can't enter ULTRA_BULLISH territory. 3+ red flags cap at 6.
    if (redFlagSet.size >= 3) raw = Math.min(raw, 6);
    else if (redFlagSet.size >= 2) raw = Math.min(raw, 7);

    // PATCH 0406 — DEMAND-SUPPLY ASYMMETRY BONUS.
    // The single highest-conviction concall signal is when management
    // explicitly says "demand is exceeding our supply / we cannot meet
    // demand / we are capacity-constrained / production is fully sold out
    // / sold ahead". This is the TD Power / Pricol / capital-goods
    // pattern: pricing power + visibility + investment thesis confirmed.
    // Previously the scorer treated generic "strong demand" the same as
    // "demand > supply" — buzzword inflation. This bonus surfaces the
    // real asymmetry signal at the top of the ranking.
    //
    // Logic: both DEMAND-side phrase AND SUPPLY-CONSTRAINT phrase must
    // appear in the same filing (not necessarily same sentence). Dedupe
    // per filing — at most one bonus fires per filing.
    const demandPatterns = [
      /strong\s+demand/i,
      /robust\s+demand/i,
      /demand\s+(?:remains|continues)\s+(?:strong|robust|firm|elevated)/i,
      /demand\s+(?:is|has been)\s+(?:strong|robust|firm|exceptional|unprecedented)/i,
      /demand\s+(?:outpac|outstripp|exceed|outweigh)/i,
      /high\s+demand\s+(?:visibility|environment)/i,
      /order\s+(?:book|inflow)\s+(?:remains?|continues?|is)\s+(?:strong|robust|elevated|healthy)/i,
      /tight\s+market/i,
      /demand[- ]?supply\s+(?:gap|mismatch|imbalance)/i,
    ];
    const supplyConstraintPatterns = [
      /capacity[- ]?constrain/i,
      /(?:fully|fully\s+)?sold\s+out/i,
      /sold\s+(?:ahead|booked)/i,
      /(?:order\s+book\s+)?cover(?:age)?\s+(?:of|for)\s+\d/i,    // "order book coverage of 18 months"
      /(?:cannot|can[' ]t|unable to)\s+(?:meet|fulfill?|service)\s+(?:the\s+)?demand/i,
      /allocat(?:e|ing|ion)\s+(?:to|amongst|across)\s+customers/i,
      /production\s+(?:line\s+)?running\s+at\s+(?:peak|full|max|100%)/i,
      /(?:expanding|adding|debottlenecking)\s+capacity\s+to\s+(?:meet|address|cater)/i,
      /demand\s+visibility/i,
      /multi[- ]year\s+order/i,
      /tight\s+supply/i,
      /shortage\s+of\s+(?:capacity|supply)/i,
      /working\s+overtime/i,
      /three\s+shifts/i,
      /utilisation\s+(?:at|above|nearing)\s+(?:9[0-9]|100)%/i,
      /utilization\s+(?:at|above|nearing)\s+(?:9[0-9]|100)%/i,
    ];
    const hasDemand = demandPatterns.some(re => re.test(t));
    const hasConstraint = supplyConstraintPatterns.some(re => re.test(t));
    if (hasDemand && hasConstraint && !criticalBlocker) {
      // Tunable bonus — capped so it lifts but never carries a weak filing
      const asymmetryBonus = 2.0;
      raw = Math.min(10, raw + asymmetryBonus);
      tagSet.add('DEMAND_SUPPLY_ASYMMETRY');
      phraseSet.add('Demand outpaces capacity (asymmetry bonus +2)');
      // Tag adds to business evidence so 3-layer Quality score reflects it
      businessEvidence += asymmetryBonus;
    }
    // PATCH 0396 — EARNINGS ANCHORING RULE per institutional spec:
    // 'A company cannot score >6 unless revenue growth OR margin expansion
    // OR order book growth is explicitly mentioned.' Prevents buzzword-only
    // inflation (CMSINFO without numeric anchor at 7.0 was the trigger).
    const anchors = detectEarningsAnchors(t);
    if (!anchors.anchored) {
      raw = Math.min(raw, 6);
    }
    // PATCH 0392 — hard cap raw_score at 10 per user spec: 'Never exceed 10'
    raw = Math.max(-5, Math.min(10, raw));
    const score = Math.max(0, Math.min(10, raw));

    // Legacy 3-state sentiment for backward compat (some callers use this)
    let sentiment: BullishScore['sentiment'];
    if (criticalBlocker) sentiment = 'BEARISH';
    else if (raw <= -2) sentiment = 'BEARISH';
    else if (raw >= 4 && mgmtConfidence >= 1.5 && businessEvidence >= 1.5) sentiment = 'BULLISH';
    else if (raw >= 6) sentiment = 'BULLISH';
    else sentiment = 'NEUTRAL';

    // PATCH 0396 — Compute 3-layer scores from tag distribution
    // Re-aggregate points per tag bucket. Walk evidence and bucket by tag.
    let qPts = 0, cPts = 0, sPts = 0;
    for (const e of evidence) {
      if (e.polarity !== 'BULL' || e.negated) continue;
      const combo = BULLISH_COMBOS.find(b => b.tag === e.tag);
      if (!combo) continue;
      if (QUALITY_TAGS.has(combo.tag)) qPts += combo.weight;
      if (CYCLE_TAGS.has(combo.tag)) cPts += combo.weight;
      if (SENTIMENT_TAGS.has(combo.tag)) sPts += combo.weight;
    }
    const layers = compute3LayerScores(qPts, cPts, sPts, positiveScore, weightedNeg, criticalBlocker);

    // PATCH 0391 — Multi-tier classifier (PATCH 0393: red flag count)
    const tier = classifyTier(positiveScore, weightedNeg, criticalBlocker, mgmtConfidence, businessEvidence, tagDiversity, redFlagSet.size);

    let confidence: BullishScore['confidence'];
    if (mgmtConfidence >= 3 && businessEvidence >= 3 && !criticalBlocker && tagDiversity >= 3) confidence = 'HIGH';
    else if (mgmtConfidence >= 1.5 && businessEvidence >= 1.5) confidence = 'MEDIUM';
    else confidence = 'LOW';

    return {
      score: Math.round(score * 10) / 10,
      raw_score: Math.round(raw * 10) / 10,
      sentiment, tier, confidence,
      tags: Array.from(tagSet),
      bullish_phrases: Array.from(phraseSet),
      red_flags: Array.from(redFlagSet),
      critical_blocker: criticalBlocker,
      fatal_blockers: fatalBlockers,
      components: {
        management_confidence: Math.round(mgmtConfidence * 10) / 10,
        business_evidence: Math.round(businessEvidence * 10) / 10,
        positive_score: Math.round(positiveScore * 10) / 10,
        blockers: Math.round(totalBlockerWeight * 10) / 10,
        blocker_severity_low: Math.round(blockerLow * 10) / 10,
        blocker_severity_medium: Math.round(blockerMed * 10) / 10,
        blocker_severity_fatal: Math.round(blockerFatal * 10) / 10,
        quality_score: layers.quality,
        cycle_score: layers.cycle,
        sentiment_score: layers.sentiment,
        composite_score: layers.composite,
        earnings_anchored: anchors.anchored,
        anchor_evidence: anchors.evidence,
      },
      evidence: evidence.slice(0, 12),
    };
  }

  // ─── Short-text fallback (subject-only): preserve original behavior ─────
  for (const combo of BULLISH_COMBOS) {
    const anchorHit = combo.anchors.some(re => re.test(t));
    const supportHit = combo.supports.some(re => re.test(t));
    if (!anchorHit || !supportHit) continue;
    let pts = combo.weight;
    if (combo.qualifiers && combo.qualifiers.some(re => re.test(t))) pts += 1;
    raw += pts;
    tagSet.add(combo.tag);
    phraseSet.add(combo.reason);
    if (MGMT_CONFIDENCE_TAGS.has(combo.tag)) mgmtConfidence += pts;
    if (BUSINESS_EVIDENCE_TAGS.has(combo.tag)) businessEvidence += pts;
  }
  const redFlagSet = new Set<string>();
  let blockerWeight = 0;
  let criticalBlocker = false;
  let blockerLow = 0, blockerMed = 0, blockerFatal = 0;
  let weightedNeg = 0;
  const fatalBlockers: string[] = [];
  for (const b of NEG_BLOCKERS) {
    if (b.re.test(t)) {
      blockerWeight += b.weight;
      redFlagSet.add(b.tag);
      if (b.severity === 'FATAL') {
        blockerFatal += b.weight;
        criticalBlocker = true;
        if (!fatalBlockers.includes(b.tag)) fatalBlockers.push(b.tag);
      } else if (b.severity === 'MEDIUM') {
        blockerMed += b.weight;
        weightedNeg += b.weight;
      } else {
        blockerLow += b.weight;
        weightedNeg += b.weight;
      }
    }
  }
  const positiveScore = raw;
  if (criticalBlocker) raw = Math.max(-5, raw - blockerFatal * 2);
  else raw = positiveScore - weightedNeg * NEG_WEIGHT_MULTIPLIER;
  raw = Math.min(raw, 8);  // hard cap for short text
  const score = Math.max(0, Math.min(10, raw / 1.6));
  let sentiment: BullishScore['sentiment'];
  if (criticalBlocker) sentiment = 'BEARISH';
  else if (raw <= -2) sentiment = 'BEARISH';
  else if (mgmtConfidence > 0 && businessEvidence > 0 && raw >= 4) sentiment = 'BULLISH';
  else if (raw >= 5) sentiment = 'BULLISH';
  else sentiment = 'NEUTRAL';
  const tier = classifyTier(positiveScore, weightedNeg * NEG_WEIGHT_MULTIPLIER, criticalBlocker, mgmtConfidence, businessEvidence, tagSet.size, redFlagSet.size);
  // PATCH 0396 — Short-text scoring uses DATA_PENDING tier when subject-only
  // (no PDF extracted yet). Distinguishes from genuine NEUTRAL.
  const dataPendingTier: BullishTier = tier === 'NEUTRAL' ? 'DATA_PENDING' : tier;
  return {
    score: Math.round(score * 10) / 10,
    raw_score: Math.round(raw * 10) / 10,
    sentiment, tier: dataPendingTier, confidence: 'LOW',
    tags: Array.from(tagSet),
    bullish_phrases: Array.from(phraseSet),
    red_flags: Array.from(redFlagSet),
    critical_blocker: criticalBlocker,
    fatal_blockers: fatalBlockers,
    components: {
      management_confidence: Math.round(mgmtConfidence * 10) / 10,
      business_evidence: Math.round(businessEvidence * 10) / 10,
      positive_score: Math.round(positiveScore * 10) / 10,
      blockers: Math.round(blockerWeight * 10) / 10,
      blocker_severity_low: Math.round(blockerLow * 10) / 10,
      blocker_severity_medium: Math.round(blockerMed * 10) / 10,
      blocker_severity_fatal: Math.round(blockerFatal * 10) / 10,
      quality_score: 0, cycle_score: 0, sentiment_score: 0,
      composite_score: Math.max(0, Math.min(10, raw / 1.4)),
      earnings_anchored: false, anchor_evidence: [],
    },
    evidence: [],
  };
}

// ─── Helper: "high bullish" gate per blueprint ─────────────────────────────
// Per spec: ≥1 management confidence phrase + ≥1 business evidence phrase +
// no critical negative blocker + score >= threshold.

export function isHighBullish(s: BullishScore, threshold = 6): boolean {
  return (
    s.sentiment === 'BULLISH' &&
    s.components.management_confidence > 0 &&
    s.components.business_evidence > 0 &&
    !s.critical_blocker &&
    s.score >= threshold / 2  // raw 6 → normalized 3 on the 0-10 scale; but we want >= 6 raw normalized... use raw_score for true 6
  );
}

// Stricter version that operates on raw score so users can configure threshold 6 = raw 6 directly
export function isHighBullishRaw(s: BullishScore, rawThreshold = 6): boolean {
  return (
    (s.tier === 'ULTRA_BULLISH' || s.tier === 'BULLISH') &&
    s.components.management_confidence > 0 &&
    s.components.business_evidence > 0 &&
    !s.critical_blocker &&
    s.raw_score >= rawThreshold
  );
}

// PATCH 0391 — tier-based filter helper
export function tierIncluded(s: BullishScore, allowedTiers: BullishTier[]): boolean {
  return allowedTiers.includes(s.tier);
}
