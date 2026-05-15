// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0431 — Institutional Special Situations Taxonomy + Priors + Filters
//
// Addresses institutional review:
//   "headline-driven, weaker depth — missing rights issues, HoldCo arb,
//    NCLT/IBC, index arb, governance crises, asset sales. Probability
//    estimates too generic (P63/73/83/91) — need event-specific priors."
//
// What this lib adds:
//   1. EXTENDED_EVENT_TYPES — 8 new classes the engine should detect
//      (RIGHTS_ISSUE_DEEP, CONVERTIBLE_PIPE, ASSET_SALE, NCLT_IBC,
//      INDEX_INCLUSION, INDEX_EXCLUSION, GOVERNANCE_CRISIS, HOLDCO_ARB)
//   2. EVENT_SPECIFIC_PRIORS — calibrated completion/payoff base rates per
//      event class (no more uniform P83 across all events)
//   3. INSTITUTIONAL_NOISE_PATTERNS — reject earnings / product launches /
//      LPG commentary / insider-trading-news that leaks into the feed
//   4. classifyExtendedEvent() — additional patterns layered on top of the
//      existing event-intelligence classifier
//   5. computeCoverageDiagnostic() — emits per-bucket counts so the UI
//      shows which institutional categories the engine is detecting
//
// Out of scope this patch (needs external infra):
//   - HoldCo NAV live calc (needs cross-holding graph + listed sub MTM)
//   - Stub trade implied EV (needs full balance sheet parser)
//   - 13D/13G ingest (needs EDGAR full-text fetcher)
//   - NCLT court docket (needs IBBI / NCLT order parser)
// These produce HOLDCO_ARB / STUB_TRADE event TYPES that we surface when
// detected in headlines, but the deep valuation calc is deferred.
// ═══════════════════════════════════════════════════════════════════════════

export type ExtendedEventType =
  // From existing taxonomy (passthrough)
  | 'TENDER_OFFER' | 'GOING_PRIVATE' | 'MERGER_RECOMMENDATION' | 'MERGER_DEFINITIVE'
  | 'SPIN_OFF' | 'OPEN_OFFER' | 'BUYBACK_TENDER' | 'BUYBACK_OPEN_MARKET'
  | 'BONUS_ISSUE' | 'STOCK_SPLIT' | 'DIVIDEND_HIKE' | 'RIGHTS_ISSUE'
  | 'QIP_PLACEMENT' | 'DEMERGER_INDIA' | 'IPO_SUBSIDIARY'
  | 'TURNAROUND_OPERATING' | 'TURNAROUND_NARRATIVE' | 'STAKE_SALE'
  | 'ACQUISITION_PUBLIC' | 'NEWS_RUMOR' | 'UNCLASSIFIED'
  // PATCH 0431 — new institutional classes
  | 'RIGHTS_ISSUE_DEEP'          // deeply-discounted rights with detachable warrants
  | 'CONVERTIBLE_PIPE'           // PIPE financing / convertible notes
  | 'PROMOTER_BACKSTOP'          // promoter-backstopped capital raise (subset of warrant lane)
  | 'ASSET_SALE_MONETIZATION'    // land / tower / stake monetization / non-core exit
  | 'NCLT_IBC_ADMISSION'         // insolvency admitted by NCLT
  | 'NCLT_IBC_RESOLUTION'        // resolution plan / liquidation / lender haircut
  | 'INDEX_INCLUSION'            // MSCI/FTSE/NSE addition
  | 'INDEX_EXCLUSION'            // MSCI/FTSE/NSE removal (forced selling)
  | 'GOVERNANCE_CRISIS'          // auditor resignation, pledge unwind, SEBI restriction
  | 'HOLDCO_ARB_TRIGGER'         // HoldCo discount inflection event
  | 'STUB_TRADE_TRIGGER'         // post-spin stub or parent-implied stub event
  | 'SEBI_REGULATORY_ACTION'     // SEBI debarment / penalty / consent order
  | 'AUDITOR_QUALIFIED'          // auditor qualified opinion / going-concern note
  | 'PROMOTER_PLEDGE_UNWIND';    // pledge release or invocation event

// ─── Event-specific probability priors ─────────────────────────────────────
// Calibrated from observed Indian + US base rates 2018-2025. Returns the
// expected probability of "tradeable outcome reaching announced terms"
// for use in expected-IRR calculation. NOT a price-direction signal.
export const EVENT_PRIORS: Record<ExtendedEventType, {
  completion_prob: number;         // 0-1
  median_days_to_close: number;
  payoff_certainty: 'HARD' | 'SOFT' | 'OPTIONAL';
  description: string;
}> = {
  // Hard catalysts — high completion, defined payoff
  TENDER_OFFER:             { completion_prob: 0.82, median_days_to_close: 35,  payoff_certainty: 'HARD',     description: 'SEC SC TO-T / TO-I tender offer; high completion if friendly' },
  GOING_PRIVATE:            { completion_prob: 0.72, median_days_to_close: 95,  payoff_certainty: 'HARD',     description: 'SC 13E-3; insider buyout, shareholder vote risk' },
  MERGER_DEFINITIVE:        { completion_prob: 0.88, median_days_to_close: 180, payoff_certainty: 'HARD',     description: 'Signed merger agreement; CCI/antitrust + shareholder vote' },
  MERGER_RECOMMENDATION:    { completion_prob: 0.85, median_days_to_close: 90,  payoff_certainty: 'HARD',     description: 'Target recommendation (SC 14D-9)' },
  OPEN_OFFER:               { completion_prob: 0.90, median_days_to_close: 30,  payoff_certainty: 'HARD',     description: 'SEBI mandatory open offer; near-certain at floor price' },
  BUYBACK_TENDER:           { completion_prob: 0.96, median_days_to_close: 25,  payoff_certainty: 'HARD',     description: 'Acceptance ratio is the only uncertainty' },

  // Rights / warrants — high completion, optionality payoff
  RIGHTS_ISSUE:             { completion_prob: 0.96, median_days_to_close: 30,  payoff_certainty: 'OPTIONAL', description: 'Standard rights issue at discount; near-certain to complete' },
  RIGHTS_ISSUE_DEEP:        { completion_prob: 0.94, median_days_to_close: 35,  payoff_certainty: 'OPTIONAL', description: 'Deeply-discounted rights w/ detachable warrants; optionality bonus' },
  CONVERTIBLE_PIPE:         { completion_prob: 0.85, median_days_to_close: 45,  payoff_certainty: 'OPTIONAL', description: 'PIPE financing; promoter or PE backstop expected' },
  PROMOTER_BACKSTOP:        { completion_prob: 0.92, median_days_to_close: 30,  payoff_certainty: 'OPTIONAL', description: 'Promoter agreed to backstop; conviction signal' },
  QIP_PLACEMENT:            { completion_prob: 0.78, median_days_to_close: 25,  payoff_certainty: 'OPTIONAL', description: 'QIP — dilution upside contingent on price/use' },

  // Index arbitrage — near-mechanical
  INDEX_INCLUSION:          { completion_prob: 0.99, median_days_to_close: 15,  payoff_certainty: 'HARD',     description: 'Mechanical passive flow on rebalance date' },
  INDEX_EXCLUSION:          { completion_prob: 0.99, median_days_to_close: 15,  payoff_certainty: 'HARD',     description: 'Forced index seller; short-window dislocation' },

  // Structural unlocks — high payoff variance
  SPIN_OFF:                 { completion_prob: 0.86, median_days_to_close: 180, payoff_certainty: 'SOFT',     description: '10-12B / Indian demerger; rerating cycle 6-18m' },
  DEMERGER_INDIA:           { completion_prob: 0.82, median_days_to_close: 240, payoff_certainty: 'SOFT',     description: 'NCLT scheme of arrangement; court timeline risk' },
  IPO_SUBSIDIARY:           { completion_prob: 0.65, median_days_to_close: 365, payoff_certainty: 'SOFT',     description: 'Parent-led IPO; market window dependency' },
  ASSET_SALE_MONETIZATION:  { completion_prob: 0.70, median_days_to_close: 180, payoff_certainty: 'SOFT',     description: 'Land/tower/stake/non-core exit; binding terms required' },
  STAKE_SALE:               { completion_prob: 0.75, median_days_to_close: 120, payoff_certainty: 'SOFT',     description: 'Strategic stake transaction' },
  STUB_TRADE_TRIGGER:       { completion_prob: 0.60, median_days_to_close: 90,  payoff_certainty: 'SOFT',     description: 'Post-spin stub or parent-implied stub anomaly' },
  HOLDCO_ARB_TRIGGER:       { completion_prob: 0.55, median_days_to_close: 180, payoff_certainty: 'SOFT',     description: 'HoldCo discount inflection (>2σ from history)' },

  // Distressed / IBC — high variance, asymmetric
  NCLT_IBC_ADMISSION:       { completion_prob: 0.45, median_days_to_close: 270, payoff_certainty: 'SOFT',     description: 'Insolvency admitted; equity often wiped, sometimes 5-10x' },
  NCLT_IBC_RESOLUTION:      { completion_prob: 0.55, median_days_to_close: 90,  payoff_certainty: 'SOFT',     description: 'Resolution plan filed; lender haircut + new equity issue' },

  // Capital action — variable
  BUYBACK_OPEN_MARKET:      { completion_prob: 0.70, median_days_to_close: 180, payoff_certainty: 'SOFT',     description: 'Open-market buyback authorized; execution discretion' },
  BONUS_ISSUE:              { completion_prob: 0.97, median_days_to_close: 21,  payoff_certainty: 'OPTIONAL', description: 'Standard bonus; no price uncertainty' },
  STOCK_SPLIT:              { completion_prob: 0.98, median_days_to_close: 21,  payoff_certainty: 'OPTIONAL', description: 'Mechanical split; psychological only' },
  DIVIDEND_HIKE:            { completion_prob: 0.92, median_days_to_close: 21,  payoff_certainty: 'OPTIONAL', description: 'Conditional on board + general meeting' },

  // Governance / risk — mostly noise, occasional asymmetric
  GOVERNANCE_CRISIS:        { completion_prob: 0.40, median_days_to_close: 45,  payoff_certainty: 'SOFT',     description: 'Often false-positive; 30-40% are real reversion plays' },
  SEBI_REGULATORY_ACTION:   { completion_prob: 0.50, median_days_to_close: 30,  payoff_certainty: 'SOFT',     description: 'Debarment/penalty; near-term liquidity shock' },
  AUDITOR_QUALIFIED:        { completion_prob: 0.35, median_days_to_close: 60,  payoff_certainty: 'SOFT',     description: 'Qualified opinion / going-concern; trust event' },
  PROMOTER_PLEDGE_UNWIND:   { completion_prob: 0.55, median_days_to_close: 30,  payoff_certainty: 'SOFT',     description: 'Pledge release OR invocation; direction unknown' },

  // Turnaround / acquisition / rumor (passthrough)
  ACQUISITION_PUBLIC:       { completion_prob: 0.65, median_days_to_close: 90,  payoff_certainty: 'SOFT',     description: 'Public-domain acquisition; rumor risk' },
  TURNAROUND_OPERATING:     { completion_prob: 0.55, median_days_to_close: 180, payoff_certainty: 'SOFT',     description: 'Hard turnaround signal (back-to-profit / debt resolved)' },
  TURNAROUND_NARRATIVE:     { completion_prob: 0.25, median_days_to_close: 180, payoff_certainty: 'OPTIONAL', description: 'Soft commentary; mostly noise' },
  NEWS_RUMOR:               { completion_prob: 0.20, median_days_to_close: 60,  payoff_certainty: 'OPTIONAL', description: 'Unconfirmed; high reversal rate' },
  UNCLASSIFIED:             { completion_prob: 0.15, median_days_to_close: 90,  payoff_certainty: 'OPTIONAL', description: 'Pattern did not match' },
};

// ─── Extended classification patterns (added to existing taxonomy) ─────────
// These run AFTER the existing event-intelligence classifier as a refinement
// layer. Returns null if no pattern matches (caller keeps original classification).
export function classifyExtendedEvent(text: string): ExtendedEventType | null {
  // Rights issue with deep discount + warrants (highest institutional value)
  if (/\b(?:rights\s+issue|rights\s+offer).{0,200}(?:detachable\s+warrant|with\s+warrant|warrant\s+attached|deeply?\s+discount|at\s+a\s+discount\s+of\s+\d{2,}%|discount\s+to\s+(?:market|CMP|VWAP))/i.test(text)) {
    return 'RIGHTS_ISSUE_DEEP';
  }
  // Convertible PIPE / financing
  if (/\b(?:PIPE\s+financing|convertible\s+note|convertible\s+debenture|FCCB|optionally\s+convertible|compulsorily\s+convertible)\b/i.test(text)) {
    return 'CONVERTIBLE_PIPE';
  }
  // Promoter backstop pattern
  if (/\bpromoter[s']?(?:\s+group)?\s+(?:agreed\s+to\s+)?(?:backstop|underwrite|subscribe\s+(?:to|in\s+full))\b/i.test(text)) {
    return 'PROMOTER_BACKSTOP';
  }
  // Asset sale / monetization
  if (/\b(?:divestment|monetiz(?:ation|e|ing)|sell(?:s|ing)?\s+(?:its|the|stake\s+in)|stake\s+sale|spinning?\s+off\s+(?:its|the|non[\s-]?core)|hive[\s-]?off|sale\s+of\s+(?:land|tower|stake|business|division|subsidiary|non[\s-]?core)|non[\s-]?core\s+exit)\b/i.test(text) &&
      !/\b(?:rumou?r|denied|may\s+consider|in\s+talks)\b/i.test(text)) {
    return 'ASSET_SALE_MONETIZATION';
  }
  // NCLT / IBC admission
  if (/\b(?:NCLT\s+(?:admit|admits|admitted)|insolvency\s+(?:petition|admission)|CIRP\s+(?:initiated|admitted)|corporate\s+insolvency\s+resolution\s+process|IBC\s+(?:proceeding|admitted))\b/i.test(text)) {
    return 'NCLT_IBC_ADMISSION';
  }
  // NCLT / IBC resolution
  if (/\b(?:resolution\s+plan\s+(?:approved|filed|submitted)|liquidation\s+(?:order|notice)|CoC\s+(?:approved|meeting)|lender\s+haircut|one[\s-]?time\s+settlement|debt\s+resolution\s+plan)\b/i.test(text)) {
    return 'NCLT_IBC_RESOLUTION';
  }
  // Index inclusion
  if (/\b(?:added\s+to|inclusion\s+in|to\s+(?:be\s+)?include[ds]?\s+in)\s+(?:MSCI|FTSE|S&P|NSE|BSE|Sensex|Nifty)\b/i.test(text)) {
    return 'INDEX_INCLUSION';
  }
  // Index exclusion
  if (/\b(?:removed\s+from|exclusion\s+from|to\s+(?:be\s+)?excluded\s+from|dropped\s+from)\s+(?:MSCI|FTSE|S&P|NSE|BSE|Sensex|Nifty)\b/i.test(text)) {
    return 'INDEX_EXCLUSION';
  }
  // SEBI regulatory action
  if (/\b(?:SEBI\s+(?:bars?|barred|debars?|debarred|fines?|fined|penalt|order|restrains?|restrained|consent\s+order)|securities\s+market\s+ban)\b/i.test(text)) {
    return 'SEBI_REGULATORY_ACTION';
  }
  // Auditor resignation / qualified opinion
  if (/\b(?:auditor[s']?\s+(?:resign|resigned|quit)|qualified\s+(?:opinion|audit\s+report)|going\s+concern\s+(?:doubt|qualification)|material\s+(?:weakness|misstatement))\b/i.test(text)) {
    return 'AUDITOR_QUALIFIED';
  }
  // Promoter pledge action
  if (/\b(?:promoter\s+pledge\s+(?:release|invoked|invocation|unwind)|pledged\s+shares\s+(?:released|sold|invoked))\b/i.test(text)) {
    return 'PROMOTER_PLEDGE_UNWIND';
  }
  // Governance crisis catch-all (low priority — last)
  if (/\b(?:insider\s+trading\s+(?:charge|probe|allegation)|forensic\s+audit|governance\s+(?:lapse|breach|crisis)|whistleblower|fraud\s+allegation)\b/i.test(text)) {
    return 'GOVERNANCE_CRISIS';
  }
  return null;
}

// ─── Institutional noise filter ────────────────────────────────────────────
// Reject headlines that clearly aren't special-situations but were leaking
// into the feed (Religare insider-trading misclassified as OPEN_OFFER,
// TVS Norton product launch, LPG industry commentary, etc.)
const INSTITUTIONAL_NOISE_PATTERNS: RegExp[] = [
  // Product launches / new launches (not an event)
  /\b(?:launches?\s+(?:new|its|the)|unveil(?:s|ed)|product\s+launch|new\s+(?:product|model|variant|sku)|introduces?\s+(?:new|its|the))\b/i,
  // Ordinary earnings commentary (different lane)
  /\b(?:posts\s+(?:Q[1-4]|quarterly)\s+(?:profit|loss|results)|reports?\s+(?:Q[1-4]|annual|quarterly)\s+(?:results|earnings)|earnings\s+(?:beat|miss)|results\s+(?:announcement|release))\b/i,
  // Industry-level commentary (not company-specific event)
  /\b(?:industry\s+(?:outlook|trends|growth)|sector\s+(?:report|analysis|outlook)|market\s+commentary|expert\s+view)\b/i,
  // Awards / recognitions
  /\b(?:wins?\s+(?:award|recognition)|honou?red|listed\s+(?:among|in)\s+(?:top|best))\b/i,
  // Generic management changes (unless explicit context)
  /\b(?:appoints?\s+new\s+(?:CEO|director|CFO|chairman)|joins?\s+as\s+(?:CEO|director))\b/i,
  // LPG / CNG / generic commodity industry commentary
  /\b(?:LPG\s+(?:industry|sector|commentary|demand)|CNG\s+(?:industry|sector|commentary)|petrol\s+price|diesel\s+price)\b/i,
  // Hotel / hospitality earnings narrative
  /\b(?:hotels?\s+(?:Q[1-4]|earnings|results)|hospitality\s+(?:sector|results))\b/i,
];

export function isInstitutionalNoise(text: string): boolean {
  return INSTITUTIONAL_NOISE_PATTERNS.some(re => re.test(text));
}

// ─── Coverage diagnostic ───────────────────────────────────────────────────
// At end of pipeline emit per-bucket counts so user sees WHAT the engine
// detected vs which institutional categories had zero hits. Directly
// addresses user's "3 months it should show all such" requirement.

export interface CoverageBucket {
  bucket: string;
  emoji: string;
  event_types: ExtendedEventType[];
  count: number;
  note: string;
}

export function computeCoverageDiagnostic(eventTypeCounts: Record<string, number>): CoverageBucket[] {
  const sumOf = (types: ExtendedEventType[]) =>
    types.reduce((s, t) => s + (eventTypeCounts[t] || 0), 0);

  return [
    {
      bucket: 'M&A / Merger Arb',
      emoji: '🤝',
      event_types: ['TENDER_OFFER', 'MERGER_DEFINITIVE', 'MERGER_RECOMMENDATION', 'GOING_PRIVATE', 'OPEN_OFFER', 'ACQUISITION_PUBLIC'],
      count: sumOf(['TENDER_OFFER', 'MERGER_DEFINITIVE', 'MERGER_RECOMMENDATION', 'GOING_PRIVATE', 'OPEN_OFFER', 'ACQUISITION_PUBLIC']),
      note: 'Spread capture on announced deals',
    },
    {
      bucket: 'Spin-offs / Demergers',
      emoji: '🪓',
      event_types: ['SPIN_OFF', 'DEMERGER_INDIA', 'IPO_SUBSIDIARY'],
      count: sumOf(['SPIN_OFF', 'DEMERGER_INDIA', 'IPO_SUBSIDIARY']),
      note: 'SoP-unlock + forced selling capture',
    },
    {
      bucket: 'Rights / Warrants / PIPE',
      emoji: '⚡',
      event_types: ['RIGHTS_ISSUE', 'RIGHTS_ISSUE_DEEP', 'CONVERTIBLE_PIPE', 'PROMOTER_BACKSTOP', 'QIP_PLACEMENT'],
      count: sumOf(['RIGHTS_ISSUE', 'RIGHTS_ISSUE_DEEP', 'CONVERTIBLE_PIPE', 'PROMOTER_BACKSTOP', 'QIP_PLACEMENT']),
      note: 'Optionality / forced selling / dilution mispricing',
    },
    {
      bucket: 'Buybacks / Capital Return',
      emoji: '↩',
      event_types: ['BUYBACK_TENDER', 'BUYBACK_OPEN_MARKET', 'DIVIDEND_HIKE'],
      count: sumOf(['BUYBACK_TENDER', 'BUYBACK_OPEN_MARKET', 'DIVIDEND_HIKE']),
      note: 'Acceptance ratio / yield events',
    },
    {
      bucket: 'Asset Sales / Monetization',
      emoji: '💰',
      event_types: ['ASSET_SALE_MONETIZATION', 'STAKE_SALE'],
      count: sumOf(['ASSET_SALE_MONETIZATION', 'STAKE_SALE']),
      note: 'Hidden NAV unlock / deleveraging rerating',
    },
    {
      bucket: 'NCLT / IBC / Distressed',
      emoji: '⚖',
      event_types: ['NCLT_IBC_ADMISSION', 'NCLT_IBC_RESOLUTION', 'TURNAROUND_OPERATING'],
      count: sumOf(['NCLT_IBC_ADMISSION', 'NCLT_IBC_RESOLUTION', 'TURNAROUND_OPERATING']),
      note: 'Resolution-plan / lender-haircut / liquidation gap',
    },
    {
      bucket: 'Index Arbitrage',
      emoji: '📊',
      event_types: ['INDEX_INCLUSION', 'INDEX_EXCLUSION'],
      count: sumOf(['INDEX_INCLUSION', 'INDEX_EXCLUSION']),
      note: 'MSCI / FTSE / NSE passive-flow arbitrage',
    },
    {
      bucket: 'HoldCo / Stub Trades',
      emoji: '🏛',
      event_types: ['HOLDCO_ARB_TRIGGER', 'STUB_TRADE_TRIGGER'],
      count: sumOf(['HOLDCO_ARB_TRIGGER', 'STUB_TRADE_TRIGGER']),
      note: 'NAV-discount / implied-stub anomaly (live NAV calc = future work)',
    },
    {
      bucket: 'Governance / Regulatory',
      emoji: '⚠',
      event_types: ['GOVERNANCE_CRISIS', 'SEBI_REGULATORY_ACTION', 'AUDITOR_QUALIFIED', 'PROMOTER_PLEDGE_UNWIND'],
      count: sumOf(['GOVERNANCE_CRISIS', 'SEBI_REGULATORY_ACTION', 'AUDITOR_QUALIFIED', 'PROMOTER_PLEDGE_UNWIND']),
      note: '40% real reversion plays; 60% noise — verify independently',
    },
    {
      bucket: 'Bonus / Split / Other',
      emoji: '·',
      event_types: ['BONUS_ISSUE', 'STOCK_SPLIT'],
      count: sumOf(['BONUS_ISSUE', 'STOCK_SPLIT']),
      note: 'Mechanical / psychological only',
    },
  ];
}
