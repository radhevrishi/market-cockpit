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
  | 'WEBCAST';

const RELEVANCE_PATTERNS: Array<{ type: ConcallFilingType; re: RegExp }> = [
  { type: 'TRANSCRIPT',            re: /transcript|earnings\s+call\s+transcript|conference\s+call\s+transcript/i },
  { type: 'INVESTOR_PRESENTATION', re: /investor\s+presentation|investor\s+meet\s+presentation/i },
  { type: 'RESULTS_PRESENTATION',  re: /results\s+presentation|results\s+update|quarterly\s+update|earnings\s+presentation/i },
  { type: 'CONCALL_INVITE',        re: /\b(?:con\s*call|conference\s+call|earnings\s+call)\b/i },
  { type: 'ANALYST_MEET',          re: /\banalyst\s+meet\b|\banalyst\s+day\b|institutional\s+investor\s+meet|investor\s+meet\b/i },
  { type: 'AUDIO_RECORDING',       re: /audio\s+recording|audio\s+file\s+of|recording\s+of\s+the\s+(?:earnings|investor|analyst|conference)/i },
  { type: 'WEBCAST',               re: /webcast|live\s+stream\s+of/i },
  { type: 'PRESS_RELEASE',         re: /press\s+release.*(?:result|earnings|guidance|outlook)/i },
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
const EARNINGS_ANCHOR_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // Revenue / sales growth %
  { re: /(?:revenue|sales|topline)[\s\w]{0,40}(?:grew?|growth|increased?|up)\s+(?:by\s+)?\d{1,3}(?:\.\d+)?\s*%/i,                  label: 'Revenue growth % stated' },
  { re: /\b\d{1,3}(?:\.\d+)?\s*%\s+(?:YoY|year[-\s]?on[-\s]?year|QoQ)\s+(?:revenue|sales|topline)/i,                                 label: 'Revenue YoY% stated' },
  // EBITDA / margin in bps / pp
  { re: /(?:EBITDA|operating|gross|net)\s+margin[\s\w]{0,40}(?:expanded?|improved?|increased?|recovered?)\s+(?:by\s+)?\d+\s*(?:bps|basis\s+points|pp|percentage\s+points)/i, label: 'Margin expansion bps' },
  { re: /\d+\s*(?:bps|basis\s+points|pp)\s+(?:margin|EBITDA|gross)/i,                                                                label: 'Margin bps stated' },
  // PAT / EBITDA / profit growth
  { re: /(?:PAT|profit|EBITDA)[\s\w]{0,40}(?:grew?|growth|increased?|up)\s+(?:by\s+)?\d{1,3}(?:\.\d+)?\s*%/i,                       label: 'PAT/EBITDA growth %' },
  { re: /\d{1,3}(?:\.\d+)?\s*%\s+(?:YoY|year[-\s]?on[-\s]?year|QoQ)\s+(?:PAT|profit|EBITDA)/i,                                       label: 'Profit YoY% stated' },
  // Order book value
  { re: /order\s+book[\s\w]{0,15}(?:of|at|stood\s+at|reached|crossed)\s+(?:Rs\.?|₹|INR)?\s*\d+[\,\.\d]*\s*(?:cr|crore)/i,           label: 'Order book ₹Cr stated' },
  { re: /(?:Rs\.?|₹|INR)\s*\d+[\,\.\d]*\s*(?:cr|crore)\s+order\s+book/i,                                                              label: 'Order book ₹Cr stated' },
  // Capex value
  { re: /capex[\s\w]{0,15}(?:of|at)\s+(?:Rs\.?|₹|INR)?\s*\d+[\,\.\d]*\s*(?:cr|crore)/i,                                              label: 'Capex ₹Cr stated' },
  // Specific double-digit growth with number
  { re: /\b\d{2,3}\s*%\s+(?:growth|increase|expansion|gain)/i,                                                                       label: 'Double-digit % growth' },
];

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
    // Score each sentence independently. Track which combos fire per sentence
    // so we can pull representative evidence quotes.
    for (const sent of sentences) {
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
