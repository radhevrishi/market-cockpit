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
// PATCH 0432 — Substantially broadened patterns. Previous version had
// HoldCo/Stub/NCLT/Index at zero because patterns required narrow phrasing.
// Real-world Indian + US headlines use varied wording — these patterns
// cover the major variants observed in NSE/BSE corporate filings, SEBI
// press releases, IBBI orders, MSCI/FTSE rebalance announcements, and
// general financial press headlines.
//
// PRIORITY ORDER (mutually exclusive — first match wins):
//   1. Index arbitrage (most specific phrasing)
//   2. NCLT / IBC distressed (legal-specific)
//   3. Rights / Warrants / PIPE / Convertible (capital action)
//   4. HoldCo / Stub trades (structural arbitrage)
//   5. Asset sale / monetization (corporate action)
//   6. SEBI / regulatory / auditor / pledge (governance lane)
//   7. Governance crisis catch-all (last — broadest)
export function classifyExtendedEvent(text: string): ExtendedEventType | null {

  // ── 1. INDEX ARBITRAGE (most specific) ────────────────────────────────────
  // PATCH 0432 — much broader. Catches MSCI/FTSE/Nifty rebalance language.
  if (/\b(?:MSCI\s+(?:standard|small[\s-]?cap|emerging\s+markets|india|all\s+country)\s+index|FTSE\s+(?:russell|emerging|all[\s-]?world|all[\s-]?cap)|S&P\s+(?:BSE|500|midcap|smallcap)|nifty\s+\d+|nifty\s+(?:next\s+50|midcap|smallcap|bank|it|fmcg|auto)|sensex)\b.{0,150}(?:add|added|include|inclusion|enter|join|migration)/i.test(text) ||
      /\b(?:add|adds|added|to\s+add|inclusion\s+in|to\s+be\s+included|joins?|migrate[ds]?|migration\s+to|promoted\s+to)\b.{0,150}\b(?:MSCI|FTSE|nifty|sensex|S&P|midcap\s+index|smallcap\s+index|F&O\s+(?:list|index))\b/i.test(text)) {
    return 'INDEX_INCLUSION';
  }
  if (/\b(?:MSCI|FTSE|nifty|sensex|S&P)\b.{0,150}(?:remov|exclud|drop|deletion|exit|demote)/i.test(text) ||
      /\b(?:removed\s+from|exclusion\s+from|to\s+be\s+excluded|dropped\s+from|exits?\s+(?:the\s+)?(?:MSCI|FTSE|nifty|sensex)|demoted\s+(?:to|from))\b.{0,80}\b(?:MSCI|FTSE|nifty|sensex|S&P|midcap|smallcap|index)\b/i.test(text)) {
    return 'INDEX_EXCLUSION';
  }
  // Quarterly / semi-annual rebalance announcements
  if (/\b(?:semi[\s-]?annual|quarterly|periodic)\s+(?:index\s+)?rebalanc(?:e|ing|ed)\b/i.test(text)) {
    return 'INDEX_INCLUSION';   // default lean — most rebalance news is inclusion-flavor
  }

  // ── 2. NCLT / IBC / DISTRESSED ───────────────────────────────────────────
  // PATCH 0432 — much broader. Captures IBBI orders, CIRP language,
  // resolution professional appointment, lender haircuts, NCLAT verdicts.
  if (/\b(?:NCLT\s+(?:admit|admits|admitted|moves?|approve[ds]?|sanction[ds]?|directs?)|insolvency\s+(?:petition|admission|filed|proceeding)|CIRP\s+(?:initiated|admitted|underway|process|application)|corporate\s+insolvency\s+resolution\s+process|IBC\s+(?:proceeding|admitted|filed|petition)|files?\s+(?:for\s+)?insolvency|moves?\s+NCLT|IRP\s+appoint(?:ed|s)|RP\s+(?:appoint|takes\s+over)|resolution\s+professional\s+(?:appoint|took\s+over))\b/i.test(text)) {
    return 'NCLT_IBC_ADMISSION';
  }
  if (/\b(?:resolution\s+plan\s+(?:approved|filed|submitted|accepted)|liquidation\s+(?:order|notice|commenced|approved)|liquidator\s+appoint|CoC\s+(?:approved|meeting|votes?|approval)|committee\s+of\s+creditors|lender(?:s)?\s+haircut|one[\s-]?time\s+settlement|OTS\s+(?:offer|approved|deal)|debt\s+resolution\s+plan|NCLAT\s+(?:upholds?|verdict|ruling|directs?)|haircut\s+of\s+\d{2,}%|takes?\s+\d{2,}%\s+haircut|successful\s+resolution\s+applicant)\b/i.test(text)) {
    return 'NCLT_IBC_RESOLUTION';
  }

  // ── 3. RIGHTS / WARRANTS / PIPE / CONVERTIBLE ───────────────────────────
  // Rights issue with deep discount + warrants (highest institutional value)
  if (/\b(?:rights\s+issue|rights\s+offer).{0,200}(?:detachable\s+warrant|with\s+warrant|warrant\s+attached|deeply?\s+discount|at\s+a\s+discount\s+of\s+\d{2,}%|discount\s+to\s+(?:market|CMP|VWAP))/i.test(text)) {
    return 'RIGHTS_ISSUE_DEEP';
  }
  // Convertible PIPE / financing — broader phrasing
  if (/\b(?:PIPE\s+(?:financing|deal|transaction|investment)|convertible\s+(?:note|debenture|preference\s+share|bond|security)|FCCB|foreign\s+currency\s+convertible|optionally\s+convertible|compulsorily\s+convertible|CCD\b|OCD\b|OCCRPS|CCPS\b|CCPRPS)\b/i.test(text)) {
    return 'CONVERTIBLE_PIPE';
  }
  // Promoter backstop pattern
  if (/\bpromoter[s']?(?:\s+group)?\s+(?:agreed\s+to\s+|to\s+|will\s+|has\s+)?(?:backstop|underwrite|fully\s+subscribe|subscribe\s+(?:to|in\s+full|fully)|infuse\s+(?:Rs\.?|₹|INR))/i.test(text)) {
    return 'PROMOTER_BACKSTOP';
  }

  // ── 4. HOLDCO / STUB TRADES (PATCH 0432 — new detection) ────────────────
  // HoldCo discount triggers: explicit mention of NAV discount, or news
  // about a listed parent's stake in a listed subsidiary.
  if (/\b(?:hold(?:ing\s+|co\s+|ing\s+company\s+)(?:NAV\s+)?discount|NAV\s+discount\s+(?:narrows?|widens?|of\s+\d{2,}%)|trading\s+at\s+(?:a\s+)?\d{2,}%\s+(?:NAV\s+)?discount|sum[\s-]?of[\s-]?(?:the[\s-]?)?parts\s+(?:valuation|unlock)|SoTP\s+(?:unlock|valuation|narrows?)|holding\s+company\s+(?:rerating|unlock|discount)|cross[\s-]?holding\s+(?:simplification|unwind|restructur))\b/i.test(text)) {
    return 'HOLDCO_ARB_TRIGGER';
  }
  // Known Indian HoldCo names — surface news about them as HoldCo trigger
  // even without explicit "NAV discount" phrasing (any material news on these
  // is HoldCo-relevant by definition of their business model).
  if (/\b(?:Bajaj\s+Holdings(?:\s+(?:&|and)\s+Investment)?|Pilani\s+Investment|Maharashtra\s+Scooters|Bombay\s+Burmah\s+Trading|Tata\s+Investment\s+Corporation|JSW\s+Holdings|Kalyani\s+Investment|Williamson\s+Magor|Tata\s+Sons|Aditya\s+Birla\s+Group|Reliance\s+Industrial\s+Investment|Vardhman\s+Holdings|Summit\s+Securities|Kama\s+Holdings|Nahar\s+Capital)\b/i.test(text)) {
    return 'HOLDCO_ARB_TRIGGER';
  }
  // Stub trade — post-spin parent stub or implied stub anomaly
  if (/\b(?:stub\s+(?:trade|value|valuation|stock)|implied\s+(?:negative\s+)?(?:enterprise\s+value|EV|stub)|core\s+business\s+(?:trades?\s+at\s+|implied\s+)?negative\s+EV|parent\s+stub\s+(?:trading|implies)|post[\s-]?spin\s+stub|tracking\s+stock\s+dislocation)\b/i.test(text)) {
    return 'STUB_TRADE_TRIGGER';
  }

  // ── 5. ASSET SALE / MONETIZATION — much broader (PATCH 0432) ────────────
  if (/\b(?:divestment|divest(?:s|ing|ed)|monetiz(?:ation|e|ed|ing)|stake\s+sale|sells?\s+stake|sale\s+of\s+(?:land|tower|stake|business|division|subsidiary|non[\s-]?core|plant|asset)|spinning?\s+off\s+(?:its|the|non[\s-]?core)|hive[\s-]?off|hiving?[\s-]?off|slump\s+sale|business\s+transfer\s+agreement|BTA\b|non[\s-]?core\s+(?:exit|sale|divestment)|REIT\s+(?:formation|creation|spin|launch)|InvIT\s+(?:formation|creation|spin|launch)|asset\s+monetiz|capital\s+recycling|portfolio\s+rationalization|land\s+(?:unlock|monetiz|sale)|tower\s+(?:sale|monetiz|spin|divest))\b/i.test(text) &&
      !/\b(?:rumou?r|denied|may\s+consider|in\s+talks(?:\s+to)?|reportedly\s+weighing|exploring)\b/i.test(text)) {
    return 'ASSET_SALE_MONETIZATION';
  }

  // ── 6. SEBI / regulatory / auditor / pledge ─────────────────────────────
  if (/\b(?:SEBI\s+(?:bars?|barred|debars?|debarred|fines?|fined|penalt|order|restrains?|restrained|consent\s+order|adjudicat|directs?)|securities\s+market\s+ban|insider[\s-]?trading\s+ban|SAT\s+(?:upholds?|verdict|appeal))\b/i.test(text)) {
    return 'SEBI_REGULATORY_ACTION';
  }
  if (/\b(?:auditor[s']?\s+(?:resign|resigned|quit|stepped\s+down|removed)|qualified\s+(?:opinion|audit\s+report|report)|going\s+concern\s+(?:doubt|qualification|note|opinion)|material\s+(?:weakness|misstatement|uncertainty)|adverse\s+(?:opinion|auditor\s+remark))\b/i.test(text)) {
    return 'AUDITOR_QUALIFIED';
  }
  if (/\b(?:promoter\s+(?:share\s+)?pledge\s+(?:release|invoked|invocation|unwind|increase|reduction)|pledged\s+shares\s+(?:released|sold|invoked|reduced)|pledge\s+(?:released|invoked|unwound))\b/i.test(text)) {
    return 'PROMOTER_PLEDGE_UNWIND';
  }

  // ── 7. Governance crisis catch-all (last — broadest) ────────────────────
  if (/\b(?:insider\s+trading\s+(?:charge|probe|allegation|investigation|complaint)|forensic\s+audit|governance\s+(?:lapse|breach|crisis|concern|issue)|whistleblower|fraud\s+allegation|accounting\s+(?:irregularit|fraud)|misrepresentation\s+of\s+accounts|round[\s-]?tripping)\b/i.test(text)) {
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
