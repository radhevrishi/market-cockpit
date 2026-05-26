// ═══════════════════════════════════════════════════════════════════════════
// INSTITUTIONAL MOVERS ATTRIBUTION ENGINE (PATCH 0708)
//
// Replaces the shallow "find any filing match" home-page enrichment with a
// proper event-attribution engine that:
//
//   1. Classifies catalyst type (EARNINGS / OFS / BLOCK_DEAL / REGULATORY /
//      ORDER_WIN / RATING / M&A / SECTOR_ROTATION / NONE)
//   2. Classifies move type (INFORMATION-driven / FLOW-driven /
//      POSITIONING-driven / LIQUIDITY-driven / MACRO-driven)
//   3. Detects sector-wide moves by cross-correlating peers in the same
//      sector (5+ peers >3% same direction = SECTOR_WIDE, not STOCK_SPECIFIC)
//   4. Assigns confidence (HIGH = filing in last 48h with matching subject;
//      MEDIUM = news + sector confirmation; LOW = sector inference only)
//   5. Is HONEST when nothing concrete exists ("No confirmed trigger —
//      likely sector rotation / smallcap liquidity") instead of inventing
//      causation from correlation
//
// Source: user's institutional-event-driven feedback. The promise this
// engine makes is: every row gets a description that is either
// evidence-backed or honestly labeled as inferred.
// ═══════════════════════════════════════════════════════════════════════════

export type CatalystType =
  | 'EARNINGS'         // Q4 / FY results, transcripts, investor presentations
  | 'OFS'              // Offer for sale, stake sale, government divestment
  | 'BLOCK_DEAL'       // Bulk / block transaction, promoter selling
  | 'REGULATORY'       // SEBI / RBI / FDA / regulator action
  | 'ORDER_WIN'        // Receipt of order, letter of award, contract
  | 'RATING'           // ICRA / CRISIL / CARE / S&P rating action
  | 'MNA'              // Merger, acquisition, demerger, scheme of arrangement
  | 'SECTOR_ROTATION'  // Sector-wide move, no stock-specific trigger
  | 'NONE';            // No identifiable catalyst — likely flow / liquidity

export type MoveType =
  | 'INFORMATION'      // Real new info hit the wire (filing / news / event)
  | 'FLOW'             // OFS / block deal / passive index rebalance
  | 'POSITIONING'      // Short squeeze / unwind (hard to detect without OI data)
  | 'LIQUIDITY'        // Smallcap, low float, momentum chasing
  | 'MACRO';           // Sector-wide rotation, policy, rate moves

export type Scope = 'STOCK_SPECIFIC' | 'SECTOR_WIDE' | 'INDEX_WIDE';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface MoverInput {
  ticker: string;
  sector?: string;
  industry?: string;
  changePercent: number;
  indexGroup?: string;    // 'Small' / 'Mid' / 'Large'
  marketCap?: number;     // ₹ Cr
  // PATCH 0860 — microstructure fields enable institutional-grade Tier 4
  // attribution. All optional; engine falls back gracefully when missing.
  deliveryPct?: number;   // 0-100 — institutional positioning signal
  volMultiple?: number;   // volume vs 20-day average (1.0 = normal)
  volume?: number;        // today's volume in shares
  previousClose?: number; // for gap detection
  open?: number;          // for gap-up/gap-down inference
  dayHigh?: number;
  dayLow?: number;
  price?: number;         // closing/current price
  // PATCH 0861 — fields for multi-layer causal inference engine
  pctOf52wHigh?: number;  // 0-100 — proximity to 52-week high
  mom1M?: number;         // 1-month price momentum %
  turnoverLacs?: number;  // today's traded value in lakhs
}

export interface FilingInput {
  symbol: string;
  subject?: string;
  filing_type?: string;
  filing_datetime?: string;
  source_url?: string;
  attachment_urls?: string[];
}

export interface NewsInput {
  ticker?: string;
  title?: string;
  headline?: string;
  article_type?: string;
  published_at?: string;
  source_url?: string;
  url?: string;
  is_synthetic?: boolean;
  importance_score?: number;
}

// PATCH 0711 — Earnings + special-situations as first-class catalysts.
// /api/v1/earnings/graded returns by_tier[BLOCKBUSTER|STRONG|MODERATE|...]
// Each item has {ticker, company, sector, filing_date, quarter,
// sales_yoy_pct, net_profit_yoy_pct, eps_yoy_pct, ...}.
export interface EarningsHit {
  ticker: string;
  tier: 'BLOCKBUSTER' | 'STRONG' | 'MODERATE' | 'WEAK' | 'POOR' | string;
  quarter?: string;
  filing_date?: string;
  sales_yoy_pct?: number;
  net_profit_yoy_pct?: number;
  eps_yoy_pct?: number;
}
// /api/v1/special-situations returns events with {target, event_type, ...}
export interface SpecialSituationHit {
  ticker: string;
  event_type: string;        // 'OPEN_OFFER' | 'OFS' | 'PREFERENTIAL' | 'MERGER' | 'DEMERGER' | 'BUYBACK' | etc
  sub_category?: string;
  announced_at?: string;
  headline?: string;
  source_url?: string;
}

export interface MoverAttribution {
  ticker: string;
  changePercent: number;
  catalyst: string;                  // SHORT label (1 line, the chip)
  detail?: string;                   // PATCH 0794 — 1-2 line analyst note
  catalystType: CatalystType;
  moveType: MoveType;
  scope: Scope;
  confidence: Confidence;
  evidenceSource: 'filing' | 'news' | 'sector_peer' | 'inferred';
  evidenceUrl?: string;
  // Peer context — how many same-sector peers moved >3% in same direction
  sectorPeerCount?: number;
  sectorDirection?: 'up' | 'down' | 'mixed';
  // PATCH 0794 — structured evidence for explainability
  evidence?: {
    sectorMovePct?: number;       // current sector aggregate move %
    indexMovePct?: number;        // index aggregate (avg of all stocks)
    peerCountUp?: number;
    peerCountDown?: number;
    peerCountTotal?: number;
    filingChecked: boolean;       // did we look at filings?
    newsChecked: boolean;
    feedGap?: boolean;            // true = feeds failed (so 'no trigger' isn't trustworthy)
    volumeNote?: string;          // e.g. "vol 4.2× peer median"
  };
}

// ─── helpers ────────────────────────────────────────────────────────────

function normSym(s: string): string {
  return (s || '').toUpperCase().replace(/\.(NS|BO)$/i, '').trim();
}

function isFresh(iso: string | undefined, windowMs: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && (Date.now() - t) < windowMs;
}

// Catalyst classification from a filing subject + filing_type.
function classifyFilingCatalyst(filing: FilingInput): { type: CatalystType; label: string } {
  const subj = (filing.subject || '').trim();
  const ft = (filing.filing_type || '').toUpperCase();

  if (ft === 'ORDER_RECEIPT' || /receipt of order|letter of award|\bLoA\b|order received|bagged order|wins order|secured order|contract award/i.test(subj)) {
    return { type: 'ORDER_WIN', label: subj.slice(0, 100) || 'Order win disclosed' };
  }
  if (ft === 'RATING_ACTION' || /\b(ICRA|CRISIL|CARE|India Ratings|Moody|Fitch|S&P)\b|rating (?:upgrade|downgrade|reaffirm|outlook)/i.test(subj)) {
    return { type: 'RATING', label: subj.slice(0, 100) || 'Rating action disclosed' };
  }
  if (/preferential|SAST|stake sale|merger|acquisition|de[- ]listing|open offer|scheme of arrangement|demerger/i.test(subj)) {
    return { type: 'MNA', label: subj.slice(0, 100) || 'Corporate action' };
  }
  if (/\bOFS\b|offer for sale|government divestment|stake sale at|floor price/i.test(subj)) {
    return { type: 'OFS', label: subj.slice(0, 100) || 'OFS announced' };
  }
  if (/SEBI|RBI|MCA|tribunal|NCLT|CIRP|insolvency|regulatory/i.test(subj)) {
    return { type: 'REGULATORY', label: subj.slice(0, 100) || 'Regulatory disclosure' };
  }
  if (ft === 'TRANSCRIPT' || ft === 'RESULTS_PRESENTATION' || ft === 'INVESTOR_PRESENTATION' ||
      ft === 'CONCALL_INVITE' || /Q[1-4]\s*FY|quarterly|results|earnings|transcript|concall|investor (?:meet|presentation)|audited financial/i.test(subj)) {
    return { type: 'EARNINGS', label: subj.slice(0, 100) || 'Results disclosed' };
  }
  return { type: 'NONE', label: subj.slice(0, 100) || 'Disclosure' };
}

// PATCH 0882 — Granular news subtype so attribution shows the SPECIFIC
// catalyst instead of generic "Peer-sympathy" / "Speculative spike".
// User audit (NGL Movers): RUBYMILLS was tagged "Peer-sympathy" but the
// news headline literally said "Independent Director Appointment in
// EOGM"; MARKSANS / ASTRAMICRO were "smallcap momentum" while their
// own earnings hit the wire same day. Root cause: only 7 catalyst
// patterns existed and the labeller fell through to generic tiers.
// Expanded to 40+ specific patterns with ordered priority.
export type NewsSubType =
  // Corporate actions (highest priority — these are evidence-backed events)
  | 'EARNINGS_RESULTS'        // Q4/FY results published
  | 'EARNINGS_PREVIEW'        // results expected this week
  | 'GUIDANCE_RAISE'
  | 'GUIDANCE_CUT'
  | 'ACQUISITION'             // company acquires X% stake / 100% of target
  | 'STAKE_SALE'              // company sells stake in subsidiary
  | 'JV_FORMATION'
  | 'DEMERGER'
  | 'MERGER_SCHEME'
  | 'OPEN_OFFER'
  | 'PREFERENTIAL_ALLOTMENT'
  | 'WARRANT_CONVERSION'
  | 'QIP_LAUNCH'
  | 'RIGHTS_ISSUE'
  | 'BUYBACK'
  | 'BONUS_ISSUE'
  | 'STOCK_SPLIT'
  | 'DIVIDEND_DECLARATION'
  | 'INTERIM_DIVIDEND'
  // Promoter / insider / flow
  | 'PROMOTER_BUY'
  | 'PROMOTER_SELL'
  | 'PROMOTER_PLEDGE_RELEASE'
  | 'PROMOTER_PLEDGE_ADD'
  | 'BLOCK_DEAL_BUY'
  | 'BLOCK_DEAL_SELL'
  | 'OFS'
  // Governance / leadership
  | 'BOARD_MEETING_FUNDRAISE' // "board to meet to consider fund raising"
  | 'BOARD_MEETING_GENERIC'
  | 'INDEPENDENT_DIRECTOR_APPT'
  | 'CEO_MD_APPOINTMENT'
  | 'CEO_MD_RESIGNATION'
  | 'CFO_CHANGE'
  | 'AUDITOR_CHANGE'
  // Business events
  | 'ORDER_WIN_LARGE'         // ₹X Cr order / letter of award
  | 'ORDER_WIN_PSU'           // PSU customer (Indian Railways / BHEL / etc)
  | 'NEW_CONTRACT'
  | 'CAPACITY_COMMISSIONING'
  | 'CAPEX_ANNOUNCEMENT'
  | 'NEW_PRODUCT_LAUNCH'
  | 'PATENT_GRANT'
  | 'MOU_SIGNING'
  // Regulatory
  | 'USFDA_APPROVAL'
  | 'USFDA_OBSERVATION'       // 483 / warning letter
  | 'CDSCO_DCGI_APPROVAL'
  | 'WHO_GMP_GRANTED'
  | 'SEBI_ACTION'
  | 'RBI_ACTION'
  // Rating
  | 'RATING_UPGRADE'
  | 'RATING_DOWNGRADE'
  | 'OUTLOOK_REVISION'
  // Index / fund flow
  | 'INDEX_INCLUSION'
  | 'INDEX_REMOVAL'
  | 'FNO_INCLUSION'
  | 'FNO_BAN'
  // Catch-all
  | 'NEWS_GENERIC';

const NEWS_PATTERNS: Array<{ subType: NewsSubType; type: CatalystType; re: RegExp; format?: (m: RegExpMatchArray, title: string) => string }> = [
  // ── CORPORATE ACTIONS / M&A (specific deals first) ─────────────────────
  { subType: 'ACQUISITION',     type: 'MNA',         re: /\b(?:acquir(?:es|ed|ing|isition\s+of))\b.{0,80}?(\d{1,3}(?:\.\d+)?)\s*%\s*(?:stake|equity|share|holding)(?:\s+in\s+([A-Z][\w &-]{2,40}))?/i,
    format: (m) => `acquires ${m[1]}% stake${m[2] ? ` in ${m[2].trim()}` : ''}` },
  { subType: 'ACQUISITION',     type: 'MNA',         re: /\b(?:acquir(?:es|ed|ing)|to acquire)\s+(?:100%\s+of\s+)?([A-Z][\w &-]{2,40})\b/i,
    format: (m) => `acquires ${m[1].trim()}` },
  { subType: 'STAKE_SALE',      type: 'MNA',         re: /\b(?:sells|divest|stake sale|hive[- ]off|to\s+sell)\b.{0,40}?(?:stake|holding|share)/i,
    format: () => 'stake sale / divestiture' },
  { subType: 'JV_FORMATION',    type: 'MNA',         re: /\bjoint\s+venture\s+(?:with|formed|signed)|JV\s+(?:with|formed)/i,
    format: () => 'joint venture announcement' },
  { subType: 'DEMERGER',        type: 'MNA',         re: /\bde-?merger|demerge|spin[- ]?off|hive\s+off/i,
    format: () => 'demerger / spin-off plan' },
  { subType: 'MERGER_SCHEME',   type: 'MNA',         re: /\bscheme\s+of\s+arrangement|amalgamation|merger\s+(?:plan|approval|completion|with|of)/i,
    format: () => 'merger / scheme of arrangement' },
  { subType: 'OPEN_OFFER',      type: 'MNA',         re: /\bopen\s+offer\b/i,
    format: () => 'open offer triggered' },
  { subType: 'PREFERENTIAL_ALLOTMENT', type: 'MNA',  re: /\bpreferential\s+(?:allotment|issue)/i,
    format: () => 'preferential allotment' },
  { subType: 'WARRANT_CONVERSION',     type: 'MNA',  re: /\bwarrant(?:s)?\s+(?:conversion|converted|allotment|exercis)/i,
    format: () => 'warrant conversion / allotment' },
  { subType: 'QIP_LAUNCH',      type: 'MNA',         re: /\bQIP\b|qualified\s+institutional\s+placement/i,
    format: () => 'QIP launched' },
  { subType: 'RIGHTS_ISSUE',    type: 'MNA',         re: /\brights\s+issue/i,
    format: () => 'rights issue' },
  { subType: 'BUYBACK',         type: 'MNA',         re: /\bbuy[- ]?back|share\s+repurchase/i,
    format: () => 'buyback announcement' },
  { subType: 'BONUS_ISSUE',     type: 'MNA',         re: /\bbonus\s+(?:issue|share)/i,
    format: () => 'bonus issue' },
  { subType: 'STOCK_SPLIT',     type: 'MNA',         re: /\bstock\s+split|share\s+split|sub[- ]?divis(?:ion|ed)/i,
    format: () => 'stock split announcement' },
  { subType: 'INTERIM_DIVIDEND', type: 'MNA',        re: /\binterim\s+dividend\b/i,
    format: () => 'interim dividend' },
  { subType: 'DIVIDEND_DECLARATION', type: 'MNA',    re: /\b(?:final|special)\s+dividend\b|dividend\s+(?:declared|of\s+₹|of\s+Rs)/i,
    format: () => 'dividend declared' },

  // ── EARNINGS ────────────────────────────────────────────────────────────
  { subType: 'GUIDANCE_RAISE',  type: 'EARNINGS',    re: /\bguidance\s+(?:raised|upgraded|increased|hiked)/i,
    format: () => 'guidance raised' },
  { subType: 'GUIDANCE_CUT',    type: 'EARNINGS',    re: /\bguidance\s+(?:cut|lowered|reduced|trimmed)/i,
    format: () => 'guidance cut' },
  { subType: 'EARNINGS_RESULTS',type: 'EARNINGS',    re: /\bQ[1-4]\s*(?:FY)?\s*\d{2,4}\b|\bquarterly\s+(?:results|earnings)|\bearnings\s+result(?:s)?\b|\bresults?\s+(?:announcement|declared|published|posted)|\b(?:net\s+profit|revenue|PAT)\s+(?:jumps?|rises?|surges?|grew|growth|up\s+\d|down\s+\d)/i,
    format: () => 'earnings result' },
  { subType: 'EARNINGS_PREVIEW',type: 'EARNINGS',    re: /\bresults?\s+(?:on|expected|due)\s+(?:Mon|Tue|Wed|Thu|Fri|today|tomorrow)|board\s+meeting\s+on\s+.{0,30}?(?:results|financial)/i,
    format: () => 'earnings expected this week' },

  // ── PROMOTER / FLOW ────────────────────────────────────────────────────
  { subType: 'PROMOTER_BUY',    type: 'BLOCK_DEAL',  re: /\bpromoter\s+(?:buys?|acquir|stake\s+(?:hike|increase|raise|purchase))|insider\s+(?:buy|purchase)/i,
    format: () => 'promoter buying' },
  { subType: 'PROMOTER_SELL',   type: 'BLOCK_DEAL',  re: /\bpromoter\s+(?:sells?|offload|trim|stake\s+(?:sale|reduction|cut|trim))|insider\s+sale/i,
    format: () => 'promoter selling' },
  { subType: 'PROMOTER_PLEDGE_RELEASE', type: 'BLOCK_DEAL', re: /\bpledge(?:d)?\s+(?:released|revoked|reduced)/i,
    format: () => 'promoter pledge released' },
  { subType: 'PROMOTER_PLEDGE_ADD',     type: 'BLOCK_DEAL', re: /\bpromoter\s+(?:pledges?|pledged|additional\s+pledge)/i,
    format: () => 'promoter pledge added' },
  { subType: 'BLOCK_DEAL_BUY',  type: 'BLOCK_DEAL',  re: /\bblock\s+deal\s+(?:buy|purchase)|bulk\s+deal\s+(?:buy|purchase)/i,
    format: () => 'block-deal buy' },
  { subType: 'BLOCK_DEAL_SELL', type: 'BLOCK_DEAL',  re: /\bblock\s+deal\s+sell|bulk\s+deal\s+sell|block\s+deal(?!\s+buy)|bulk\s+deal(?!\s+buy)/i,
    format: () => 'block deal' },
  { subType: 'OFS',             type: 'OFS',         re: /\bOFS\b|offer\s+for\s+sale|floor\s+price/i,
    format: () => 'OFS / offer for sale' },

  // ── GOVERNANCE / LEADERSHIP ────────────────────────────────────────────
  { subType: 'BOARD_MEETING_FUNDRAISE', type: 'MNA', re: /\bboard\s+(?:to\s+meet|meeting).{0,40}?(?:fund\s+rais|fundrais|capital\s+rais|borrow)/i,
    format: () => 'board meeting to consider fund-raise' },
  { subType: 'INDEPENDENT_DIRECTOR_APPT',type: 'NONE',re: /\b(?:independent\s+director|ID)\s+(?:appointment|appointed|reappointed)|appointment\s+of\s+(?:an?\s+)?independent\s+director|approves?.{0,30}?director\s+appointment/i,
    format: () => 'independent director appointment' },
  { subType: 'CEO_MD_APPOINTMENT', type: 'NONE',     re: /\bappoint(?:s|ed|ment\s+of)\s+(?:as\s+)?(?:CEO|MD|managing\s+director|chief\s+executive)|new\s+(?:CEO|MD|managing\s+director)/i,
    format: () => 'new CEO/MD appointed' },
  { subType: 'CEO_MD_RESIGNATION', type: 'NONE',     re: /\b(?:CEO|MD|managing\s+director|chief\s+executive)\s+(?:resign|step(?:s|ped)\s+down|exit)|resignation\s+of\s+(?:CEO|MD)/i,
    format: () => 'CEO/MD resignation' },
  { subType: 'CFO_CHANGE',      type: 'NONE',        re: /\bCFO\s+(?:appoint|resign|change|new)|new\s+CFO|chief\s+financial\s+officer/i,
    format: () => 'CFO change' },
  { subType: 'AUDITOR_CHANGE',  type: 'NONE',        re: /\bauditor\s+(?:resign|appoint|change)|new\s+auditor|statutory\s+auditor/i,
    format: () => 'auditor change' },
  { subType: 'BOARD_MEETING_GENERIC', type: 'NONE',  re: /\bboard\s+(?:to\s+meet|meeting\s+on|meeting\s+scheduled)/i,
    format: () => 'board meeting' },

  // ── BUSINESS EVENTS ────────────────────────────────────────────────────
  { subType: 'ORDER_WIN_LARGE', type: 'ORDER_WIN',   re: /\b(?:bag|secur|won|receiv)(?:s|ed|es|ing)?\s+(?:an?\s+)?order(?:s)?.{0,50}?₹?\s?([\d,]+(?:\.\d+)?)\s*(?:cr|crore)/i,
    format: (m) => `bagged ₹${m[1]} Cr order` },
  { subType: 'ORDER_WIN_PSU',   type: 'ORDER_WIN',   re: /\border.{0,40}?(?:Indian\s+Railways|BHEL|NTPC|PGCIL|HAL|BEL|DRDO|ISRO|NABARD|LIC|ONGC|IOCL|GAIL|MoD|Ministry\s+of\s+Defence|Indian\s+Navy|Indian\s+Army)/i,
    format: (m) => `order from ${m[0].match(/(?:Indian\s+Railways|BHEL|NTPC|PGCIL|HAL|BEL|DRDO|ISRO|NABARD|LIC|ONGC|IOCL|GAIL|MoD|Ministry\s+of\s+Defence|Indian\s+Navy|Indian\s+Army)/i)?.[0]}` },
  { subType: 'NEW_CONTRACT',    type: 'ORDER_WIN',   re: /\b(?:letter\s+of\s+award|LoA|new\s+contract|contract\s+(?:won|secured|awarded))/i,
    format: () => 'new contract / LoA' },
  { subType: 'CAPACITY_COMMISSIONING', type: 'NONE', re: /\bcommercial\s+production\s+(?:commenced|started|begun)|commission(?:ing|ed)\s+(?:of\s+)?(?:new\s+)?(?:plant|line|facility|unit)/i,
    format: () => 'capacity commissioning' },
  { subType: 'CAPEX_ANNOUNCEMENT', type: 'NONE',     re: /\bcapex\s+(?:plan|announcement)|capital\s+expenditure\s+(?:plan|of)|greenfield\s+(?:plant|facility|expansion)/i,
    format: () => 'capex / greenfield announcement' },
  { subType: 'NEW_PRODUCT_LAUNCH', type: 'NONE',     re: /\b(?:launch(?:es|ed)?|unveil(?:s|ed)?)\s+(?:new\s+)?(?:product|drug|formulation|API|range)/i,
    format: () => 'new product launch' },
  { subType: 'PATENT_GRANT',    type: 'NONE',        re: /\bpatent\s+(?:granted|approved|awarded)/i,
    format: () => 'patent grant' },
  { subType: 'MOU_SIGNING',     type: 'NONE',        re: /\b(?:MoU|memorandum\s+of\s+understanding)\s+(?:signed|with)/i,
    format: () => 'MoU signed' },

  // ── REGULATORY ─────────────────────────────────────────────────────────
  { subType: 'USFDA_APPROVAL',  type: 'REGULATORY',  re: /\b(?:USFDA|US\s+FDA)\s+(?:approval|approved|clearance|EIR)|ANDA\s+approval/i,
    format: () => 'USFDA approval / EIR' },
  { subType: 'USFDA_OBSERVATION', type: 'REGULATORY',re: /\b(?:USFDA|US\s+FDA)\s+(?:483|observation|warning\s+letter|import\s+alert|OAI)/i,
    format: () => 'USFDA observation / warning' },
  { subType: 'CDSCO_DCGI_APPROVAL',type: 'REGULATORY',re: /\b(?:CDSCO|DCGI)\s+(?:approval|approved|clearance)/i,
    format: () => 'CDSCO/DCGI approval' },
  { subType: 'WHO_GMP_GRANTED', type: 'REGULATORY',  re: /\bWHO[- ]?GMP|EU[- ]?GMP|EDQM|MHRA\s+approval/i,
    format: () => 'WHO-GMP / EU-GMP cleared' },
  { subType: 'SEBI_ACTION',     type: 'REGULATORY',  re: /\bSEBI\s+(?:order|fine|penalty|action|notice|directs?|bars?)/i,
    format: () => 'SEBI action' },
  { subType: 'RBI_ACTION',      type: 'REGULATORY',  re: /\bRBI\s+(?:approval|nod|directive|cap|tightens|rolls?\s+out)/i,
    format: () => 'RBI action' },

  // ── RATING ─────────────────────────────────────────────────────────────
  { subType: 'RATING_UPGRADE',  type: 'RATING',      re: /\b(?:ICRA|CRISIL|CARE|India\s+Ratings|Fitch|Moody|S&P|BWR|Brickwork|Acuit[eé])\s+.{0,30}?upgrad|rating\s+upgrade/i,
    format: () => 'credit rating upgrade' },
  { subType: 'RATING_DOWNGRADE',type: 'RATING',      re: /\b(?:ICRA|CRISIL|CARE|India\s+Ratings|Fitch|Moody|S&P|BWR|Brickwork|Acuit[eé])\s+.{0,30}?downgrad|rating\s+downgrade/i,
    format: () => 'credit rating downgrade' },
  { subType: 'OUTLOOK_REVISION',type: 'RATING',      re: /\boutlook\s+(?:revised|raised|positive|negative|stable|developing)/i,
    format: () => 'outlook revision' },

  // ── INDEX / FUND FLOW ──────────────────────────────────────────────────
  { subType: 'INDEX_INCLUSION', type: 'NONE',        re: /\b(?:Nifty|Sensex|MSCI|FTSE|BSE|NSE)\s+.{0,30}?(?:inclusion|added|added\s+to|inclusion\s+in)/i,
    format: () => 'index inclusion' },
  { subType: 'INDEX_REMOVAL',   type: 'NONE',        re: /\b(?:Nifty|Sensex|MSCI|FTSE|BSE|NSE)\s+.{0,30}?(?:removal|removed|exclusion|exit)/i,
    format: () => 'index removal' },
  { subType: 'FNO_INCLUSION',   type: 'NONE',        re: /\bF&O\s+inclusion|derivatives?\s+segment|added\s+to\s+F&O/i,
    format: () => 'F&O inclusion' },
  { subType: 'FNO_BAN',         type: 'NONE',        re: /\bF&O\s+ban|MWPL|market[- ]?wide\s+position\s+limit/i,
    format: () => 'F&O ban / MWPL hit' },
];

// Stop-words that mean the title is generic listing / link clickbait.
const GENERIC_NEWS = /^(?:is\s+now\s+the\s+time|here(?:'s|\s+is)?\s+why|stock\s+to\s+watch|hot\s+stocks|today's\s+(?:top|hot)|breakout\s+stocks|stock(?:s)?\s+(?:up|down|in\s+focus)|why\s+is)/i;

function classifyNewsCatalyst(article: NewsInput): { type: CatalystType; label: string; subType: NewsSubType } {
  const title = (article.title || article.headline || '').trim();
  const at = (article.article_type || '').toUpperCase();
  if (!title) return { type: 'NONE', label: 'News mention', subType: 'NEWS_GENERIC' };
  // Generic clickbait / listing — skip to NEWS_GENERIC so it doesn't pretend
  // to be a real catalyst.
  if (GENERIC_NEWS.test(title)) return { type: 'NONE', label: title.slice(0, 100), subType: 'NEWS_GENERIC' };
  // Run patterns in declared order — most specific first. First match wins.
  for (const { subType, type, re, format } of NEWS_PATTERNS) {
    const m = title.match(re);
    if (m) {
      const lbl = format ? format(m, title) : title.slice(0, 100);
      return { type, label: lbl, subType };
    }
  }
  // article_type=EARNINGS but title didn't match → still tag as EARNINGS
  if (at === 'EARNINGS') return { type: 'EARNINGS', label: title.slice(0, 100), subType: 'EARNINGS_RESULTS' };
  return { type: 'NONE', label: title.slice(0, 100), subType: 'NEWS_GENERIC' };
}

// Determine move type from catalyst type.
function deriveMoveType(catalystType: CatalystType, indexGroup?: string): MoveType {
  if (catalystType === 'OFS' || catalystType === 'BLOCK_DEAL') return 'FLOW';
  if (catalystType === 'EARNINGS' || catalystType === 'ORDER_WIN' ||
      catalystType === 'MNA' || catalystType === 'REGULATORY' ||
      catalystType === 'RATING') return 'INFORMATION';
  if (catalystType === 'SECTOR_ROTATION') return 'MACRO';
  // NONE catalyst + smallcap → likely liquidity-driven
  if ((indexGroup || '').toLowerCase() === 'small') return 'LIQUIDITY';
  return 'MACRO';
}

// ─── peer-correlation (sector-wide vs stock-specific) ───────────────────

interface PeerContext {
  bySector: Map<string, { up: number; down: number; tickers: string[] }>;
  byIndustry: Map<string, { up: number; down: number; tickers: string[] }>;
}

function buildPeerContext(movers: MoverInput[]): PeerContext {
  const bySector = new Map<string, { up: number; down: number; tickers: string[] }>();
  const byIndustry = new Map<string, { up: number; down: number; tickers: string[] }>();
  const PEER_THRESHOLD_PCT = 3;
  for (const m of movers) {
    if (Math.abs(m.changePercent) < PEER_THRESHOLD_PCT) continue;
    const direction = m.changePercent > 0 ? 'up' : 'down';
    const s = (m.sector || '').trim();
    const i = (m.industry || '').trim();
    if (s) {
      if (!bySector.has(s)) bySector.set(s, { up: 0, down: 0, tickers: [] });
      const e = bySector.get(s)!;
      e[direction]++;
      e.tickers.push(m.ticker);
    }
    if (i && i !== s) {
      if (!byIndustry.has(i)) byIndustry.set(i, { up: 0, down: 0, tickers: [] });
      const e = byIndustry.get(i)!;
      e[direction]++;
      e.tickers.push(m.ticker);
    }
  }
  return { bySector, byIndustry };
}

// ─── main attribution function ──────────────────────────────────────────

interface AttributeOpts {
  movers: MoverInput[];          // all gainers + losers in one array
  filingsBySymbol: Record<string, FilingInput[]>;
  newsByTicker?: Record<string, NewsInput[]>;
  // PATCH 0711 — new HIGH-confidence sources
  earningsByTicker?: Record<string, EarningsHit>;
  specialByTicker?: Record<string, SpecialSituationHit>;
  // PATCH 0794 — sector aggregates for analyst-grade context
  sectorAggregates?: Record<string, { avgChangePct: number; stockCount: number }>;
  indexAvgChangePct?: number;     // broad market avg from same response
  // PATCH 0794 — feed-gap signal so "no trigger" isn't conflated with "feeds failed"
  filingsFeedHealthy?: boolean;   // true = concall-intel feed returned successfully
  newsFeedHealthy?: boolean;
  earningsFeedHealthy?: boolean;
}

// PATCH 0794 — formatting helpers for analyst-grade detail strings.
function fmtPct(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '?';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

// Build "Auto sector +1.8% vs index -0.3%; 7 of 12 peers moving up >3%"
function buildSectorContext(
  sectorName: string | undefined,
  sectorAgg: { avgChangePct: number; stockCount: number } | undefined,
  indexAvg: number | undefined,
  peerStats: { up: number; down: number; tickers: string[] } | undefined,
  direction: 'up' | 'down',
): string {
  if (!sectorName) return '';
  const parts: string[] = [];
  if (sectorAgg) {
    if (typeof indexAvg === 'number') {
      parts.push(`${sectorName} ${fmtPct(sectorAgg.avgChangePct)} vs index ${fmtPct(indexAvg)}`);
    } else {
      parts.push(`${sectorName} sector ${fmtPct(sectorAgg.avgChangePct)}`);
    }
  }
  if (peerStats) {
    const total = peerStats.up + peerStats.down;
    const sameDir = direction === 'up' ? peerStats.up : peerStats.down;
    if (total >= 3) {
      parts.push(`${sameDir} of ${total} peers ${direction === 'up' ? '↑' : '↓'} >3%`);
    }
  }
  return parts.join('; ');
}

// ════════════════════════════════════════════════════════════════════════
// PATCH 0861 — Multi-layer causal inference for non-trigger moves.
// User critique: 'engine only works for structured triggers; for real
// smallcap movers (operator circulation, peer sympathy, commodity
// linkage, technical, delivery anomaly, float distortion, market
// regime) it collapses everything to FLOW/ROTATE/Smallcap-unwind.'
// Now: each Tier-4 mover runs through up to 7 inference layers; top 2-3
// signals are fused into desk-commentary.
// ════════════════════════════════════════════════════════════════════════

// Industry/sector → commodity linkage map. Keyed by lowercase regex.
const COMMODITY_LINK: Array<{ rx: RegExp; commodity: string; direction: 'POSITIVE_ON_UP' | 'NEGATIVE_ON_UP' | 'MIXED' }> = [
  // Paints / specialty chemicals — crude is input
  { rx: /paint|coating|adhesive/i, commodity: 'crude / titanium dioxide', direction: 'NEGATIVE_ON_UP' },
  // Tyres — rubber + crude
  { rx: /tyre|tire/i, commodity: 'natural rubber / crude', direction: 'NEGATIVE_ON_UP' },
  // Airlines — crude jet fuel
  { rx: /airline|aviation/i, commodity: 'crude / ATF', direction: 'NEGATIVE_ON_UP' },
  // OMCs — refining cracks + crude (mixed direction)
  { rx: /refiner|oil marketing|petroleum.*refin/i, commodity: 'crude cracks', direction: 'MIXED' },
  // Cement — coal + pet-coke + diesel
  { rx: /cement/i, commodity: 'coal / pet-coke', direction: 'NEGATIVE_ON_UP' },
  // Sugar
  { rx: /sugar/i, commodity: 'sugar / ethanol', direction: 'POSITIVE_ON_UP' },
  // Aluminum producers
  { rx: /aluminium|aluminum/i, commodity: 'LME aluminum', direction: 'POSITIVE_ON_UP' },
  // Steel
  { rx: /steel/i, commodity: 'iron ore / coking coal', direction: 'POSITIVE_ON_UP' },
  // Copper
  { rx: /copper/i, commodity: 'LME copper', direction: 'POSITIVE_ON_UP' },
  // Power gen
  { rx: /power generat|thermal power|hydroelec|coal-based power/i, commodity: 'coal / spot power', direction: 'POSITIVE_ON_UP' },
  // Gas distribution
  { rx: /city gas|gas distribut|CGD/i, commodity: 'gas spot price', direction: 'NEGATIVE_ON_UP' },
  // Specialty chemicals — solvents/feedstock
  { rx: /specialty chem|fine chem|agrochem/i, commodity: 'crude / xylene / methanol', direction: 'NEGATIVE_ON_UP' },
  // Edible oils
  { rx: /edible oil|FMCG.*oil|vanaspati/i, commodity: 'palm oil / soybean', direction: 'NEGATIVE_ON_UP' },
  // Textiles
  { rx: /textile|spinning|yarn/i, commodity: 'cotton', direction: 'NEGATIVE_ON_UP' },
  // Pharma API
  { rx: /\bAPI\b|active pharmaceutical|bulk drug/i, commodity: 'KSM solvents / China supply', direction: 'NEGATIVE_ON_UP' },
];

interface CausalSignal {
  layer: number;
  phrase: string;
  weight: number;   // 0-100; higher = stronger evidence for the move
}

function inferCausalSignals(
  m: MoverInput,
  ctx: {
    isUp: boolean;
    sectorPct?: number;
    indexPct?: number;
    peerCountSameDir?: number;
    peerTotal?: number;
    friendlySector: string;
    smallcap: boolean;
    microcap: boolean;
  }
): CausalSignal[] {
  const signals: CausalSignal[] = [];
  const absPct = Math.abs(m.changePercent || 0);
  const dlv = typeof m.deliveryPct === 'number' ? m.deliveryPct : null;
  const vm = typeof m.volMultiple === 'number' ? m.volMultiple : null;
  const hi52 = typeof m.pctOf52wHigh === 'number' ? m.pctOf52wHigh : null;
  const mom = typeof m.mom1M === 'number' ? m.mom1M : null;

  // ─── LAYER 2 — Peer sympathy ───
  // PATCH 0883 — Tightened gate per user audit: "Do NOT declare peer-sympathy
  // unless ≥2 correlated stocks move with same direction, same time window,
  // volume co-movement". Previous gate (4 peers, 50% same-dir) was too loose
  // and produced false "Peer-sympathy momentum" labels for stocks like
  // BLISSGVS that had no real peer cluster (the rest of pharma was flat).
  // New gate: ≥2 same-direction peers, sector outperforming index by ≥1pp,
  // and the rail's own count of same-direction peers must dominate the
  // opposite direction (sameDir / total ≥ 0.65 not 0.50).
  const peerTotal = ctx.peerTotal || 0;
  const sameDir = ctx.peerCountSameDir || 0;
  const peerRatio = peerTotal > 0 ? sameDir / peerTotal : 0;
  const sectorOutperf = (ctx.sectorPct !== undefined && ctx.indexPct !== undefined) ? Math.abs(ctx.sectorPct - ctx.indexPct) : 0;
  const peerSympathyConfirmed = peerTotal >= 4 && sameDir >= 2 && peerRatio >= 0.65 && sectorOutperf >= 1.0;
  if (peerSympathyConfirmed) {
    const sec = ctx.friendlySector.toLowerCase();
    if (ctx.isUp) {
      signals.push({
        layer: 2,
        phrase: `move appears linked to continued strength across ${sec} names (${ctx.peerCountSameDir}/${ctx.peerTotal} peers ↑ >3%)`,
        weight: Math.min(80, 40 + (ctx.peerCountSameDir || 0) * 3),
      });
    } else {
      signals.push({
        layer: 2,
        phrase: `decline tracks broader weakness in ${sec} basket (${ctx.peerCountSameDir}/${ctx.peerTotal} peers ↓ >3%)`,
        weight: Math.min(80, 40 + (ctx.peerCountSameDir || 0) * 3),
      });
    }
  }

  // ─── LAYER 3 — Commodity linkage ───
  const sectorIndustry = `${m.industry || ''} ${m.sector || ''}`.toLowerCase();
  for (const link of COMMODITY_LINK) {
    if (link.rx.test(sectorIndustry)) {
      const upWord = ctx.isUp ? 'rally' : 'decline';
      if (link.direction === 'POSITIVE_ON_UP') {
        signals.push({
          layer: 3,
          phrase: ctx.isUp
            ? `${upWord} consistent with ${link.commodity} strength`
            : `${upWord} may reflect ${link.commodity} weakness`,
          weight: 50,
        });
      } else if (link.direction === 'NEGATIVE_ON_UP') {
        signals.push({
          layer: 3,
          phrase: ctx.isUp
            ? `${upWord} may reflect easing ${link.commodity} input pressure`
            : `${upWord} likely tied to ${link.commodity}-linked margin concerns`,
          weight: 50,
        });
      } else {
        signals.push({
          layer: 3,
          phrase: `move may reflect shifting ${link.commodity} spread`,
          weight: 40,
        });
      }
      break; // first matching commodity wins
    }
  }

  // ─── LAYER 4 — Technical triggers ───
  if (hi52 !== null) {
    if (ctx.isUp && hi52 >= 99 && absPct >= 5) {
      signals.push({
        layer: 4,
        phrase: `breakout above 52-week high (price at ${hi52.toFixed(0)}% of range top)`,
        weight: 70,
      });
    } else if (ctx.isUp && hi52 >= 90 && absPct >= 5) {
      signals.push({
        layer: 4,
        phrase: `pressing toward 52-week high (${hi52.toFixed(0)}% of range top) — near-breakout setup`,
        weight: 55,
      });
    } else if (!ctx.isUp && hi52 <= 25 && absPct >= 5) {
      signals.push({
        layer: 4,
        phrase: `extended decline — price at ${hi52.toFixed(0)}% of 52w range`,
        weight: 55,
      });
    } else if (!ctx.isUp && hi52 <= 60 && mom !== null && mom <= -10) {
      signals.push({
        layer: 4,
        phrase: `continued breakdown from recent base (1m momentum ${mom.toFixed(0)}%)`,
        weight: 50,
      });
    }
  }
  // Gap behavior
  if (m.open && m.previousClose && m.price && m.dayHigh) {
    const gapPct = ((m.open - m.previousClose) / m.previousClose) * 100;
    if (gapPct > 2 && (m.dayHigh - m.price) / ((m.dayHigh - m.open) || 1) > 0.6) {
      signals.push({
        layer: 4,
        phrase: `opened gap-up but closed off highs — early demand absorbed by profit-booking`,
        weight: 60,
      });
    } else if (gapPct < -2 && m.dayLow && (m.price - m.dayLow) / ((m.dayHigh - m.dayLow) || 1) > 0.7) {
      signals.push({
        layer: 4,
        phrase: `gap-down reclaimed intraday — buyers stepped in from session lows`,
        weight: 55,
      });
    }
  }

  // ─── LAYER 6 — Delivery interpretation ───
  if (dlv !== null && vm !== null) {
    if (vm >= 5 && dlv <= 25) {
      signals.push({
        layer: 6,
        phrase: `${vm.toFixed(1)}× volume with only ${dlv}% delivery — speculative intraday participation dominates`,
        weight: 75,
      });
    } else if (vm >= 3 && dlv >= 55) {
      signals.push({
        layer: 6,
        phrase: `${vm.toFixed(1)}× volume on ${dlv}% delivery — positional accumulation${ctx.isUp ? '' : '/distribution'} with conviction`,
        weight: 75,
      });
    } else if (vm >= 3 && dlv <= 30) {
      signals.push({
        layer: 6,
        phrase: `elevated volume (${vm.toFixed(1)}×) with weak ${dlv}% delivery — momentum chase`,
        weight: 60,
      });
    } else if (dlv >= 60) {
      signals.push({
        layer: 6,
        phrase: `${dlv}% delivery suggests positional ${ctx.isUp ? 'buying' : 'exits'} rather than intraday churn`,
        weight: 55,
      });
    } else if (dlv <= 20) {
      signals.push({
        layer: 6,
        phrase: `low ${dlv}% delivery flags speculative profile`,
        weight: 45,
      });
    }
  } else if (vm !== null && vm >= 4) {
    signals.push({
      layer: 6,
      phrase: `${vm.toFixed(1)}× normal volume — institutional/HNI participation likely`,
      weight: 50,
    });
  } else if (vm !== null && vm < 0.5 && absPct >= 7) {
    signals.push({
      layer: 6,
      phrase: `sharp move on thin (${vm.toFixed(1)}×) volume — liquidity vacuum`,
      weight: 70,
    });
  }

  // ─── LAYER 7 — Float / liquidity dynamics ───
  if (ctx.microcap && absPct >= 8) {
    signals.push({
      layer: 7,
      phrase: `microcap structure amplifies move — thin float distorts price discovery`,
      weight: 60,
    });
  } else if (ctx.smallcap && absPct >= 12 && (m.turnoverLacs || 0) > 0 && (m.turnoverLacs || 0) < 500) {
    signals.push({
      layer: 7,
      phrase: `move disproportionate to ₹${(m.turnoverLacs! / 100).toFixed(0)} Cr turnover — limited liquidity tail`,
      weight: 60,
    });
  }

  // ─── LAYER 10 — Market regime ───
  if (typeof ctx.indexPct === 'number') {
    const idxAbs = Math.abs(ctx.indexPct);
    if (ctx.isUp && ctx.indexPct >= 0.5 && absPct > idxAbs * 3) {
      signals.push({
        layer: 10,
        phrase: `aided by broader risk-on tape (index ${fmtPct(ctx.indexPct)})`,
        weight: 35,
      });
    } else if (!ctx.isUp && ctx.indexPct <= -0.5 && absPct > idxAbs * 2) {
      signals.push({
        layer: 10,
        phrase: `pressure intensified by weak tape (index ${fmtPct(ctx.indexPct)})`,
        weight: 35,
      });
    } else if (ctx.isUp && ctx.indexPct <= -0.2) {
      signals.push({
        layer: 10,
        phrase: `relative strength stands out — index ${fmtPct(ctx.indexPct)}`,
        weight: 45,
      });
    } else if (!ctx.isUp && ctx.indexPct >= 0.2) {
      signals.push({
        layer: 10,
        phrase: `decline against rising tape (index ${fmtPct(ctx.indexPct)}) suggests stock-specific weakness`,
        weight: 45,
      });
    }
  }

  // Sort by weight desc
  signals.sort((a, b) => b.weight - a.weight);
  return signals;
}

// PATCH 0883 — Mechanism inference layer.
// Per user directive: "Stop using category words as final output. Final output
// must always be causal sentence + mechanism." Each signal-layer combo maps to
// a MECHANISM (how the market transmitted the event), and the OUTPUT is a
// natural-language sentence — not a 2-word label.
//
// Mechanism taxonomy (from the user's audit):
//   INFORMATION_FLOW  · earnings / news / filings / ratings / regulatory
//   POSITIONING       · profit booking, stop loss cascade, crowded trade exit
//   SHORT_COVERING    · OI drop + price spike, breakout squeeze
//   MOMENTUM_EXTENSION· trend continuation, breakout follow-through
//   LIQUIDITY_VACUUM  · low float, thin order book, gap expansion
//   PEER_TRANSMISSION · validated by ≥2 correlated peers with vol co-movement
//   OPERATOR_ROTATION · microcap basket moves, low delivery, sudden vol spike
//   DERIVATIVES       · option walls, gamma squeeze, index hedging
//
// Output: causal sentence ("Event → Mechanism → Market impact"). When no
// catalyst found, the function is honest about uncertainty: "no confirmed
// peer linkage … likely liquidity-driven repricing in low-float [sector]".

type Mechanism =
  | 'INFORMATION_FLOW' | 'POSITIONING' | 'SHORT_COVERING'
  | 'MOMENTUM_EXTENSION' | 'LIQUIDITY_VACUUM' | 'PEER_TRANSMISSION'
  | 'OPERATOR_ROTATION' | 'DERIVATIVES';

function fuseCausalNarrative(signals: CausalSignal[], isUp: boolean, smallcap: boolean, microcap: boolean): { label: string; detail: string; topLayer: number; mechanism?: Mechanism } {
  if (signals.length === 0) {
    // PATCH 0883 — Even the honest fallback is now a real sentence with a
    // mechanism hint, not a bare "No confirmed trigger" label.
    const baseSector = microcap ? 'microcap basket' : smallcap ? 'smallcap basket' : 'name';
    if (isUp) {
      return {
        label: `liquidity expansion in low-float ${baseSector} — no confirmed peer cluster`,
        detail: 'No filing or news catalyst detected; sector participation does not confirm peer-sympathy. Move likely driven by liquidity expansion in a thin-float name, suggesting retail-driven repricing rather than thematic transmission.',
        topLayer: 0,
        mechanism: 'LIQUIDITY_VACUUM',
      };
    }
    return {
      label: `liquidity-driven repricing in ${baseSector} — no confirmed catalyst`,
      detail: 'No filing or news catalyst detected; sector participation does not confirm sector-wide derisking. Move likely driven by liquidity contraction in a thin-float name.',
      topLayer: 0,
      mechanism: 'LIQUIDITY_VACUUM',
    };
  }
  const top = signals[0];
  // Layer → mechanism mapping
  const mech: Mechanism = (() => {
    switch (top.layer) {
      case 2:  return 'PEER_TRANSMISSION';
      case 3:  return 'INFORMATION_FLOW';        // commodity-linked = real info
      case 4:  return 'MOMENTUM_EXTENSION';
      case 6:  return top.phrase.includes('speculative') || top.phrase.includes('momentum chase') ? 'OPERATOR_ROTATION'
                    : top.phrase.includes('liquidity vacuum') ? 'LIQUIDITY_VACUUM'
                    : 'POSITIONING';
      case 7:  return microcap ? 'LIQUIDITY_VACUUM' : 'OPERATOR_ROTATION';
      case 10: return 'POSITIONING';
      default: return 'POSITIONING';
    }
  })();
  // Build a natural causal sentence from the strongest signal.
  // Format: "<mechanism descriptor> — <evidence>"
  const mechDescriptor: Record<Mechanism, { up: string; down: string }> = {
    INFORMATION_FLOW:   { up: 'commodity-linked re-rate',          down: 'commodity-linked de-rate' },
    POSITIONING:        { up: 'positional accumulation',           down: 'long unwind / profit booking' },
    SHORT_COVERING:     { up: 'short-covering squeeze',            down: 'short re-build' },
    MOMENTUM_EXTENSION: { up: 'breakout follow-through',            down: 'breakdown follow-through' },
    LIQUIDITY_VACUUM:   { up: 'thin-float expansion (liquidity-driven)', down: 'thin-float contraction (liquidity-driven)' },
    PEER_TRANSMISSION:  { up: 'sector-cluster transmission',       down: 'sector-cluster derisking' },
    OPERATOR_ROTATION:  { up: 'operator-rotation / speculative chase', down: 'operator distribution / speculative unwind' },
    DERIVATIVES:        { up: 'derivatives-anchored extension',    down: 'derivatives-anchored compression' },
  };
  const descriptor = mechDescriptor[mech][isUp ? 'up' : 'down'];
  // Causal sentence: descriptor + the most evidentiary phrase
  const label = `${descriptor} — ${top.phrase}`;

  // Detail: top 2-3 phrases, deduped by layer
  const seen = new Set<number>();
  const phrases: string[] = [];
  for (const s of signals) {
    if (seen.has(s.layer)) continue;
    seen.add(s.layer);
    phrases.push(s.phrase);
    if (phrases.length >= 3) break;
  }
  return {
    label,
    detail: phrases.join('; '),
    topLayer: top.layer,
    mechanism: mech,
  };
}

export function attributeMovers(opts: AttributeOpts): Record<string, MoverAttribution> {
  const peers = buildPeerContext(opts.movers);
  const FILING_WINDOW = 3 * 24 * 3600 * 1000;   // 3 days for catalyst freshness
  const NEWS_WINDOW = 2 * 24 * 3600 * 1000;     // 2 days
  const EARNINGS_WINDOW = 7 * 24 * 3600 * 1000; // 7 days — earnings reaction often lasts a week
  const SECTOR_WIDE_MIN_PEERS = 4;              // 4+ same-direction peers = sector move
  // PATCH 0794 — track feed-gap so 'no trigger' rows are honest about it
  const filingChecked = opts.filingsFeedHealthy !== false;
  const newsChecked = opts.newsFeedHealthy !== false;
  const feedGap = (opts.filingsFeedHealthy === false) || (opts.newsFeedHealthy === false);

  const out: Record<string, MoverAttribution> = {};

  for (const m of opts.movers) {
    const sym = normSym(m.ticker);
    const direction = m.changePercent > 0 ? 'up' : 'down';
    const sectorStats = m.sector ? peers.bySector.get(m.sector) : undefined;
    const industryStats = m.industry ? peers.byIndustry.get(m.industry) : undefined;
    const peerCountSameDirection = Math.max(
      sectorStats?.[direction] || 0,
      industryStats?.[direction] || 0,
    );
    const sectorScope: Scope = peerCountSameDirection >= SECTOR_WIDE_MIN_PEERS ? 'SECTOR_WIDE' : 'STOCK_SPECIFIC';

    // PATCH 0794 — sector aggregate from opts (if passed); peerStats for detail
    const sectorAgg = m.sector ? opts.sectorAggregates?.[m.sector] : undefined;
    const peerStats = sectorStats || industryStats;
    const sectorContext = buildSectorContext(m.sector, sectorAgg, opts.indexAvgChangePct, peerStats, direction);
    // PATCH 0795 — never show 'Other' / 'Unknown' / 'NA' in user-facing text.
    // Map to readable fallback so labels feel curated, not broken.
    const friendlySector = (() => {
      const s = (m.sector || '').trim();
      if (!s || /^(other|unknown|na|n\/a|misc)$/i.test(s)) {
        const ig = (m.indexGroup || '').toLowerCase();
        return ig === 'small' ? 'smallcap basket' : ig === 'micro' ? 'microcap basket' : 'unclassified basket';
      }
      return s;
    })();
    const sharedEvidence = {
      sectorMovePct: sectorAgg?.avgChangePct,
      indexMovePct: opts.indexAvgChangePct,
      peerCountUp: peerStats?.up,
      peerCountDown: peerStats?.down,
      peerCountTotal: (peerStats?.up || 0) + (peerStats?.down || 0),
      filingChecked,
      newsChecked,
      feedGap,
    };

    // ── TIER 1a: EARNINGS HIT (HIGH confidence) ───────────────────────────
    // Most common reason for a sharp move. If this ticker reported in the
    // last 7 days, the move IS the earnings reaction — surface the tier
    // and growth profile.
    //
    // PATCH 0747 — When EARNINGS hit AND the move direction is OPPOSITE the
    // tier sentiment, this is post-results profit-taking (GPIL pattern:
    // STRONG Q4 results, then -2.5% next day on profit-booking). Phrase it
    // explicitly so the user doesn't think the engine is contradicting itself.
    //
    // PATCH 0747 — Also merge in any same-ticker special-situation event
    // (IRB pattern: Q4 PAT +38% AND 4th interim dividend declared on same
    // day). Both belong on the same row.
    const earnings = opts.earningsByTicker?.[sym];
    if (earnings && isFresh(earnings.filing_date, EARNINGS_WINDOW)) {
      // ════════════════════════════════════════════════════════════════════
      // PATCH 0869 — EARNINGS INTERPRETATION ENGINE
      // User critique: 'You detect the event category (BLOCKBUSTER/MIXED/AVOID
      // earnings reaction) but not the market interpretation layer. That is
      // insufficiently analytical.'
      // Now classify reaction (FUNDAMENTAL_RERATE / POSITIONING_UNWIND /
      // SHORT_COVER / MARGIN_SHOCK / OVERREACTION_SELLOFF /
      // INSTITUTIONAL_DISTRIBUTION / OPERATING_DELEVERAGE /
      // FLOW_DRIVEN_EXTENSION / VALUATION_COMPRESSION / RELIEF_RALLY / IN_LINE)
      // then generate desk-commentary.
      // ════════════════════════════════════════════════════════════════════
      const tier = earnings.tier || 'reported';
      const period = earnings.quarter || 'recent';
      const sales = earnings.sales_yoy_pct;
      const pat = earnings.net_profit_yoy_pct;
      const eps = earnings.eps_yoy_pct;
      const tierUpper = String(tier || '').toUpperCase();
      const isStrong = /^(BLOCKBUSTER|STRONG)$/i.test(tierUpper);
      const isMixed = /^MIXED$/i.test(tierUpper);
      const isWeak = /^(AVOID|POOR|WEAK)$/i.test(tierUpper);
      const movingUp = m.changePercent > 0;
      const movingDown = m.changePercent < 0;
      const absPct = Math.abs(m.changePercent || 0);
      const dlv = typeof m.deliveryPct === 'number' ? m.deliveryPct : null;
      const vm = typeof m.volMultiple === 'number' ? m.volMultiple : null;
      const highDelivery = dlv !== null && dlv >= 55;
      const lowDelivery = dlv !== null && dlv <= 25;
      const highVolume = vm !== null && vm >= 3;

      // Structural signals from metric divergence
      const hasMetrics = typeof sales === 'number' && typeof pat === 'number';
      const operatingLeverage = hasMetrics && pat! >= sales! + 8;
      const marginCompression = hasMetrics && pat! <= sales! - 8;
      const operatingDeleverage = hasMetrics && sales! >= 5 && pat! <= -5;
      const sharesDilution = typeof eps === 'number' && typeof pat === 'number' && pat! >= 0 && eps! < pat! - 8;
      const buybackEffect = typeof eps === 'number' && typeof pat === 'number' && eps! > pat! + 5;
      const lowQualityBeat = isStrong && hasMetrics && Math.abs(pat!) > 100 && (sales || 0) < 10;

      type ReactionState =
        | 'FUNDAMENTAL_RERATE' | 'POSITIONING_UNWIND' | 'SHORT_COVER'
        | 'MARGIN_SHOCK' | 'OVERREACTION_SELLOFF' | 'INSTITUTIONAL_DISTRIBUTION'
        | 'OPERATING_DELEVERAGE' | 'FLOW_DRIVEN_EXTENSION'
        | 'VALUATION_COMPRESSION' | 'RELIEF_RALLY' | 'IN_LINE';
      let reaction: ReactionState = 'IN_LINE';
      let confidenceQuality: 'HIGH_QUALITY' | 'LOW_QUALITY' | 'NEUTRAL' = 'NEUTRAL';

      if (isStrong && movingUp) {
        if (operatingLeverage && highDelivery) { reaction = 'FUNDAMENTAL_RERATE'; confidenceQuality = 'HIGH_QUALITY'; }
        else if (highVolume && lowDelivery)    { reaction = 'FLOW_DRIVEN_EXTENSION'; confidenceQuality = 'LOW_QUALITY'; }
        else if (lowQualityBeat)               { reaction = 'FLOW_DRIVEN_EXTENSION'; confidenceQuality = 'LOW_QUALITY'; }
        else                                    reaction = 'FUNDAMENTAL_RERATE';
      } else if (isStrong && movingDown) {
        if (highDelivery && absPct >= 5)       { reaction = 'POSITIONING_UNWIND'; confidenceQuality = 'HIGH_QUALITY'; }
        else if (lowDelivery)                  { reaction = 'POSITIONING_UNWIND'; confidenceQuality = 'LOW_QUALITY'; }
        else                                    reaction = 'VALUATION_COMPRESSION';
      } else if (isMixed && movingUp) {
        if (operatingLeverage)                  reaction = 'FUNDAMENTAL_RERATE';
        else if (highVolume && lowDelivery)     reaction = 'SHORT_COVER';
        else                                    reaction = 'RELIEF_RALLY';
      } else if (isMixed && movingDown) {
        if (marginCompression)                  reaction = 'MARGIN_SHOCK';
        else if (highDelivery)                  reaction = 'VALUATION_COMPRESSION';
        else                                    reaction = 'IN_LINE';
      } else if (isWeak && movingDown) {
        if (highDelivery && absPct >= 5)       { reaction = 'INSTITUTIONAL_DISTRIBUTION'; confidenceQuality = 'HIGH_QUALITY'; }
        else if (lowDelivery)                  { reaction = 'OVERREACTION_SELLOFF'; confidenceQuality = 'LOW_QUALITY'; }
        else if (operatingDeleverage)          { reaction = 'OPERATING_DELEVERAGE'; confidenceQuality = 'HIGH_QUALITY'; }
        else if (marginCompression)             reaction = 'MARGIN_SHOCK';
        else                                    reaction = 'INSTITUTIONAL_DISTRIBUTION';
      } else if (isWeak && movingUp) {
        if (highVolume)                         reaction = 'SHORT_COVER';
        else                                    reaction = 'RELIEF_RALLY';
      }

      const fmt = (n: number | undefined) => typeof n === 'number' ? `${n >= 0 ? '+' : ''}${n.toFixed(0)}%` : '?';
      const labelByReaction: Record<ReactionState, string> = {
        FUNDAMENTAL_RERATE: 'Fundamental re-rate',
        POSITIONING_UNWIND: 'Post-results positioning unwind',
        SHORT_COVER: 'Post-results short-covering',
        MARGIN_SHOCK: 'Margin shock',
        OVERREACTION_SELLOFF: 'Earnings overreaction',
        INSTITUTIONAL_DISTRIBUTION: 'Institutional distribution',
        OPERATING_DELEVERAGE: 'Operating deleverage',
        FLOW_DRIVEN_EXTENSION: 'Flow-driven extension',
        VALUATION_COMPRESSION: 'Valuation compression',
        RELIEF_RALLY: 'Relief rally',
        IN_LINE: 'In-line earnings reaction',
      };
      const moveLabel = labelByReaction[reaction];
      const parts: string[] = [];
      if (hasMetrics) {
        if (operatingLeverage) parts.push(`Sales ${fmt(sales)}, PAT ${fmt(pat)} — operating leverage drove margin expansion`);
        else if (marginCompression) parts.push(`Sales ${fmt(sales)} but PAT only ${fmt(pat)} — margin compression`);
        else if (operatingDeleverage) parts.push(`Sales ${fmt(sales)} alongside PAT ${fmt(pat)} — operating deleverage on rising costs`);
        else parts.push(`Sales ${fmt(sales)}, PAT ${fmt(pat)}`);
        if (sharesDilution) parts.push('EPS lagged PAT — share dilution concern');
        else if (buybackEffect) parts.push(`EPS ${fmt(eps)} > PAT growth — buyback / share reduction support`);
      }
      if (reaction === 'FUNDAMENTAL_RERATE') {
        parts.push(highDelivery ? `${dlv}% delivery confirms institutional participation in the re-rate` : 'rally consistent with earnings quality');
      } else if (reaction === 'POSITIONING_UNWIND') {
        parts.push(highDelivery ? `${dlv}% delivery on the decline suggests crowded positioning unwinding — expectations exceeded the print` : 'decline despite the tier suggests crowded positioning unwinding');
      } else if (reaction === 'SHORT_COVER') {
        parts.push(vm !== null ? `${vm.toFixed(1)}× volume + ${dlv ?? '?'}% delivery — short-covering rather than fresh accumulation` : 'bounce despite weak tier — likely short-covering');
      } else if (reaction === 'MARGIN_SHOCK') {
        parts.push(`market focused on margin trajectory rather than topline${highDelivery ? ` — ${dlv}% delivery confirms genuine de-rating` : ''}`);
      } else if (reaction === 'OVERREACTION_SELLOFF') {
        parts.push(`${dlv}% delivery is weak — reaction appears speculative rather than broad institutional exit`);
      } else if (reaction === 'INSTITUTIONAL_DISTRIBUTION') {
        parts.push(`${dlv ?? 'elevated'}% delivery profile suggests genuine institutional de-risking after earnings miss`);
      } else if (reaction === 'OPERATING_DELEVERAGE') {
        parts.push('topline growth on declining profitability — cost pressures dominated the print');
      } else if (reaction === 'FLOW_DRIVEN_EXTENSION') {
        parts.push(lowQualityBeat ? `headline PAT inflated by base effect / one-offs; ${vm ? vm.toFixed(1) + '×' : 'elevated'} volume on ${dlv ?? '?'}% delivery flags speculative chase` : 'participation profile suggests momentum continuation beyond fundamental re-rating');
      } else if (reaction === 'VALUATION_COMPRESSION') {
        parts.push('despite headline tier, decline appears to reflect valuation reset — fundamentals stable but multiple compressing');
      } else if (reaction === 'RELIEF_RALLY') {
        parts.push('bad results already priced in — print not as weak as feared');
      }
      if (confidenceQuality === 'LOW_QUALITY') parts.push('quality of move flagged as low-confidence — verify before sizing');

      // Special-situation overlay
      const earningsSpecial = opts.specialByTicker?.[sym];
      let extraTag = '';
      if (earningsSpecial) {
        const evt = (earningsSpecial.event_type || '').toUpperCase();
        if (/DIVIDEND/.test(evt)) extraTag = ' + dividend';
        else if (/BUYBACK/.test(evt)) extraTag = ' + buyback';
        else if (/INVESTOR_MEET|CONFERENCE/.test(evt)) extraTag = ' + investor meet';
        else if (/OFS|STAKE_SALE/.test(evt)) extraTag = ' + OFS';
        else if (/PREFERENTIAL|QIP|RIGHTS|SAST/.test(evt)) extraTag = ' + capital action';
        if (extraTag) parts.push(extraTag.replace(/^ \+ /, '') + ' announced alongside results');
      }
      const catalyst = `${moveLabel} (${tier} · ${period})${extraTag}`;
      const detail = parts.join('; ');

      out[sym] = {
        ticker: sym,
        changePercent: m.changePercent,
        catalyst,
        detail: detail.charAt(0).toUpperCase() + detail.slice(1) + (detail.endsWith('.') ? '' : '.'),
        catalystType: 'EARNINGS',
        moveType: 'INFORMATION',
        scope: sectorScope === 'SECTOR_WIDE' ? 'SECTOR_WIDE' : 'STOCK_SPECIFIC',
        confidence: 'HIGH',
        evidenceSource: 'filing',
        sectorPeerCount: peerCountSameDirection,
        sectorDirection: direction,
        evidence: sharedEvidence,
      };
      continue;
    }

    // ── TIER 1b: SPECIAL SITUATION (HIGH confidence) ─────────────────────
    // OFS, preferential allotment, SAST stake, M&A, buyback, demerger —
    // these ARE the trigger. CENTRALBK -8% with an OFS event qualifies here.
    const ss = opts.specialByTicker?.[sym];
    if (ss) {
      const evtMap: Record<string, CatalystType> = {
        OFS: 'OFS', OPEN_OFFER: 'MNA', MERGER: 'MNA', DEMERGER: 'MNA',
        ACQUISITION: 'MNA', BUYBACK: 'BLOCK_DEAL', PREFERENTIAL: 'BLOCK_DEAL',
        SAST: 'BLOCK_DEAL', RIGHTS: 'BLOCK_DEAL', QIP: 'BLOCK_DEAL',
        STAKE_SALE: 'BLOCK_DEAL',
      };
      const evtType = (ss.event_type || '').toUpperCase();
      const cat: CatalystType = evtMap[evtType] || 'MNA';
      const ssDetail = (() => {
        const parts: string[] = [];
        if (ss.headline) parts.push(ss.headline.slice(0, 140) + '.');
        const evt = (ss.event_type || '').replace(/_/g, ' ').toLowerCase();
        if (cat === 'OFS') parts.push(`OFS supply pressure typical for D-day; absorb-vs-overhang depends on float impact.`);
        else if (cat === 'MNA') parts.push(`Corporate-action announcement — move reflects arb spread / re-rating.`);
        else if (cat === 'BLOCK_DEAL') parts.push(`Capital event (${evt}) — flow-driven, not earnings.`);
        if (sectorContext) parts.push(sectorContext + '.');
        return parts.join(' ');
      })();
      out[sym] = {
        ticker: sym,
        changePercent: m.changePercent,
        catalyst: ss.headline || `${ss.event_type.replace(/_/g, ' ')}${ss.sub_category ? ' · ' + ss.sub_category : ''}`,
        detail: ssDetail,
        catalystType: cat,
        moveType: cat === 'OFS' || cat === 'BLOCK_DEAL' ? 'FLOW' : 'INFORMATION',
        scope: 'STOCK_SPECIFIC',
        confidence: 'HIGH',
        evidenceSource: 'filing',
        evidenceUrl: ss.source_url,
        sectorPeerCount: peerCountSameDirection,
        sectorDirection: direction,
        evidence: sharedEvidence,
      };
      continue;
    }

    // ── TIER 1c: filing match from concall-intel (HIGH confidence) ────────
    const filings = (opts.filingsBySymbol[sym] || [])
      .filter(f => isFresh(f.filing_datetime, FILING_WINDOW))
      .sort((a, b) => new Date(b.filing_datetime || 0).getTime() - new Date(a.filing_datetime || 0).getTime());
    if (filings.length > 0) {
      const top = filings[0];
      const cat = classifyFilingCatalyst(top);
      const filingAgeH = top.filing_datetime
        ? Math.round((Date.now() - new Date(top.filing_datetime).getTime()) / 3600_000)
        : null;
      // PATCH 0795 — terse 1-line filing detail
      const filingDetail = (() => {
        const tag = cat.type === 'ORDER_WIN' ? 'Reg-30 order/contract'
                  : cat.type === 'RATING'    ? 'credit rating action'
                  : cat.type === 'MNA'       ? 'corporate-action filing'
                  : cat.type === 'REGULATORY'? 'regulatory disclosure'
                  : cat.type === 'OFS'       ? 'OFS supply announcement'
                  : cat.type === 'EARNINGS'  ? 'results/transcript filed'
                  : 'material exchange disclosure';
        return filingAgeH !== null ? `${tag}; filed ~${filingAgeH}h ago.` : `${tag}.`;
      })();
      out[sym] = {
        ticker: sym,
        changePercent: m.changePercent,
        catalyst: cat.label,
        detail: filingDetail,
        catalystType: cat.type,
        moveType: deriveMoveType(cat.type, m.indexGroup),
        scope: sectorScope === 'SECTOR_WIDE' ? 'SECTOR_WIDE' : 'STOCK_SPECIFIC',
        confidence: 'HIGH',
        evidenceSource: 'filing',
        evidenceUrl: top.source_url || top.attachment_urls?.[0],
        sectorPeerCount: peerCountSameDirection,
        sectorDirection: direction,
        evidence: sharedEvidence,
      };
      continue;
    }

    // ── TIER 2: news match (MEDIUM confidence) ────────────────────────────
    const news = (opts.newsByTicker?.[sym] || [])
      .filter(a => !a.is_synthetic && isFresh(a.published_at, NEWS_WINDOW))
      .sort((a, b) => {
        const ai = a.importance_score ?? 0;
        const bi = b.importance_score ?? 0;
        if (ai !== bi) return bi - ai;
        return new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime();
      });
    if (news.length > 0) {
      const top = news[0];
      const cat = classifyNewsCatalyst(top);
      const newsConfidence: Confidence = peerCountSameDirection >= SECTOR_WIDE_MIN_PEERS ? 'MEDIUM' : 'MEDIUM';
      // PATCH 0795 — terse 1-line news detail
      const newsDetail = (() => {
        const src = (top as any).source_name || 'News';
        const typeTag = cat.type !== 'NONE' ? cat.type.replace(/_/g, ' ').toLowerCase() : 'news mention';
        const peerNote = peerCountSameDirection >= SECTOR_WIDE_MIN_PEERS
          ? ' — but peers moving same direction, may be reporting not driving'
          : '';
        return `${src} headline (${typeTag})${peerNote}.`;
      })();
      out[sym] = {
        ticker: sym,
        changePercent: m.changePercent,
        catalyst: cat.label,
        detail: newsDetail,
        catalystType: cat.type,
        moveType: deriveMoveType(cat.type, m.indexGroup),
        scope: sectorScope,
        confidence: newsConfidence,
        evidenceSource: 'news',
        evidenceUrl: top.source_url || top.url,
        sectorPeerCount: peerCountSameDirection,
        sectorDirection: direction,
        evidence: sharedEvidence,
      };
      continue;
    }

    // ── TIER 3: sector / breadth inference ────────────────────────────
    // PATCH 0795 — new taxonomy:
    //   sector_led:           sector clearly outperforms index (|delta| >= 1.5%)
    //   broad_participation:  breadth strong but sector return ~ index
    //   sector_wide_derisking: down direction with sector wide spread
    // 1-line subtitle, max ~22 words. No filler.
    if (sectorScope === 'SECTOR_WIDE') {
      // PATCH 0867 — instead of bare 'Broad participation (microcap basket)',
      // run the same multi-layer causal inference used in Tier 4 so the rail
      // surfaces commodity linkage / technical setup / delivery quality /
      // float dynamics alongside the sector observation. The strongest signal
      // drives the label; sector context is appended as evidence.
      const total = (peerStats?.up || 0) + (peerStats?.down || 0);
      const sectorPct = sectorAgg?.avgChangePct;
      const indexPct = opts.indexAvgChangePct;
      const delta = (sectorPct !== undefined && indexPct !== undefined) ? sectorPct - indexPct : undefined;
      const SECTOR_LED_THRESHOLD = 1.5;
      const isSectorLed = typeof delta === 'number' && Math.abs(delta) >= SECTOR_LED_THRESHOLD;
      const isUp = direction === 'up';
      const indGroup3 = (m.indexGroup || '').toLowerCase();
      const smallcap3 = indGroup3 === 'small' || indGroup3 === 'micro';
      const microcap3 = indGroup3 === 'micro';
      const causalSignals3 = inferCausalSignals(m, {
        isUp,
        sectorPct,
        indexPct,
        peerCountSameDir: peerCountSameDirection,
        peerTotal: total,
        friendlySector,
        smallcap: smallcap3,
        microcap: microcap3,
      });
      // Sector-led IS itself a Layer-2 finding — bump it as a high-weight
      // signal at the top of the list.
      const sectorPhrase = isSectorLed
        ? `sector-led ${isUp ? 'rally' : 'sell-off'} — ${friendlySector} ${fmtPct(sectorPct)} vs index ${fmtPct(indexPct)} (${peerCountSameDirection}/${total} peers ${isUp ? '↑' : '↓'} >3%)`
        : `broad participation — ${peerCountSameDirection}/${total} peers ${isUp ? '↑' : '↓'} >3% with sector roughly in line${typeof sectorPct === 'number' ? ` (${fmtPct(sectorPct)})` : ''}`;
      causalSignals3.unshift({ layer: 2, phrase: sectorPhrase, weight: isSectorLed ? 75 : 55 });
      const fused3 = fuseCausalNarrative(causalSignals3, isUp, smallcap3, microcap3);
      const label3 = isSectorLed
        ? `Sector-led ${isUp ? 'rally' : 'sell-off'} (${friendlySector})`
        : fused3.label;
      const tier3Conf3: Confidence = isSectorLed
        ? ((filingChecked && newsChecked) ? 'MEDIUM' : 'LOW')
        : ((filingChecked && newsChecked && peerCountSameDirection >= 6) ? 'MEDIUM' : 'LOW');
      out[sym] = {
        ticker: sym,
        changePercent: m.changePercent,
        catalyst: label3,
        detail: fused3.detail,
        catalystType: 'SECTOR_ROTATION',
        moveType: 'MACRO',
        scope: 'SECTOR_WIDE',
        confidence: tier3Conf3,
        evidenceSource: 'sector_peer',
        sectorPeerCount: peerCountSameDirection,
        sectorDirection: direction,
        evidence: sharedEvidence,
      };
      continue;
    }

    // ── TIER 4: honest "no confirmed trigger" (LOW confidence) ───────────
    // PATCH 0747 — Tighter, user-spec language. The original wording was
    // both verbose and accidentally judgmental ("likely liquidity-driven"
    // sounded pejorative when often it's just an unenriched smallcap with
    // ordinary intraday flow). User feedback:
    //   • Use explicit categories: "momentum only" vs "no confirmed trigger"
    //   • Don't duplicate industry text — home page renders the industry chip
    //     separately, so the catalyst label should focus on cause, not topic
    //   • Be honest about confidence WITHOUT inventing a story
    //
    // Industry chip on the home page already shows "Civil Construction" /
    // "Housing Finance Company" / etc, so we DON'T repeat it here.
    // ── TIER 4: no confirmed trigger — MULTI-LAYER CAUSAL INFERENCE (P0861) ──
    // User critique: 'engine only works for structured triggers; for real
    // smallcap movers, all causes collapse to FLOW/ROTATE/Smallcap-unwind.'
    // Now: 7-layer inference (peer sympathy / commodity / technical /
    // delivery / float / regime) + fused desk-commentary.
    const indGroup = (m.indexGroup || '').toLowerCase();
    const smallcap = indGroup === 'small' || indGroup === 'micro';
    const microcap = indGroup === 'micro';
    const isUp = direction === 'up';
    const dlv = typeof m.deliveryPct === 'number' ? m.deliveryPct : null;
    const vm = typeof m.volMultiple === 'number' ? m.volMultiple : null;

    const causalSignals = inferCausalSignals(m, {
      isUp,
      sectorPct: sectorAgg?.avgChangePct,
      indexPct: opts.indexAvgChangePct,
      peerCountSameDir: peerCountSameDirection,
      peerTotal: (peerStats?.up || 0) + (peerStats?.down || 0),
      friendlySector,
      smallcap,
      microcap,
    });
    const fused = fuseCausalNarrative(causalSignals, isUp, smallcap, microcap);
    let moveLabel = fused.label;
    const subtitleParts: string[] = [fused.detail];
    if (feedGap && causalSignals.length === 0) {
      subtitleParts.push('available scans incomplete');
    }

    out[sym] = {
      ticker: sym,
      changePercent: m.changePercent,
      catalyst: moveLabel,
      detail: subtitleParts.join('; ') + '.',
      catalystType: 'NONE',
      moveType: smallcap ? 'LIQUIDITY' : 'MACRO',
      scope: 'STOCK_SPECIFIC',
      confidence: 'LOW',
      evidenceSource: 'inferred',
      sectorPeerCount: peerCountSameDirection,
      sectorDirection: direction,
      evidence: sharedEvidence,
    };
  }

  return out;
}

// PATCH 0795 — module-level feed-gap detection helper. Home page renders
// a single top-of-card banner instead of repeating the warning in every row.
export function detectFeedGap(attrib: Record<string, MoverAttribution>): { feedGap: boolean; whichFeed?: string } {
  for (const a of Object.values(attrib)) {
    if (a.evidence?.feedGap) {
      const missing: string[] = [];
      if (a.evidence.filingChecked === false) missing.push('filings');
      if (a.evidence.newsChecked === false) missing.push('news');
      return { feedGap: true, whichFeed: missing.join(' + ') || 'some' };
    }
  }
  return { feedGap: false };
}

// ─── PATCH 0796: tier + anomaly classification ──────────────────────────

export type MoverTier = 'EXTREME' | 'STANDARD' | 'MINOR';
export type AnomalyTag = 'CIRCUIT' | 'NEWS_GAP' | 'UNEXPLAINED' | null;

/** Classify a mover into one of three tiers based on absolute % move. */
export function moverTier(changePercent: number): MoverTier {
  const abs = Math.abs(changePercent);
  if (abs >= 10) return 'EXTREME';
  if (abs >= 5) return 'STANDARD';
  return 'MINOR';
}

/**
 * NSE circuit limits: ±5%, ±10%, ±20%. A move within 0.15% of any of these
 * is almost certainly the result of a circuit-locked session, not free price
 * discovery.
 */
export function isCircuitMove(changePercent: number): boolean {
  const abs = Math.abs(changePercent);
  for (const limit of [5, 10, 20]) {
    if (Math.abs(abs - limit) < 0.15) return true;
  }
  return false;
}

/**
 * Compute one short anomaly tag per mover. Priority:
 *   CIRCUIT  > NEWS_GAP > UNEXPLAINED > null
 * Only return a tag when it adds information beyond the row label.
 */
export function anomalyTag(args: {
  changePercent: number;
  attribution?: MoverAttribution;
  tier?: MoverTier;
}): AnomalyTag {
  const tier = args.tier || moverTier(args.changePercent);
  if (isCircuitMove(args.changePercent)) return 'CIRCUIT';
  const src = args.attribution?.evidenceSource;
  if (tier === 'EXTREME' && (src === 'filing' || src === 'news')) return 'NEWS_GAP';
  if (tier === 'EXTREME' && (src === 'inferred' || src === 'sector_peer') && args.attribution?.confidence === 'LOW') {
    return 'UNEXPLAINED';
  }
  return null;
}

export const ANOMALY_COLOR: Record<Exclude<AnomalyTag, null>, string> = {
  CIRCUIT: '#EF4444',       // red
  NEWS_GAP: '#10B981',      // green
  UNEXPLAINED: '#F59E0B',   // amber
};

/**
 * Replace the tier-4 "Momentum burst / Position unwind" label with the
 * cleaner alternatives the user asked for when render context favors
 * a terser surface. The original engine output is kept for backwards
 * compat — this function is used by the UI layer.
 */
export function cleanMoverLabel(attr: MoverAttribution | undefined): string {
  if (!attr) return '';
  // PATCH 0860 — Tier 4 now produces specific labels (Speculative intraday
  // participation / Long unwinding / Low-float momentum / Liquidity vacuum
  // etc) instead of generic 'Momentum burst' / 'Position unwind'. Return
  // them directly. The legacy override below stays for ATTR.catalystType==='NONE'
  // edge cases.
  if (attr.catalyst) return attr.catalyst;
  if (attr.changePercent > 0) {
    return Math.abs(attr.changePercent) >= 10 ? 'UNEXPLAINED MOVE' : 'No confirmed trigger';
  }
  return Math.abs(attr.changePercent) >= 10 ? 'LIQUIDATION MOVE' : 'No confirmed trigger';
}

// ─── render helpers ─────────────────────────────────────────────────────

export const CATALYST_GLYPH: Record<CatalystType, string> = {
  EARNINGS: '📊',
  OFS: '🏛',
  BLOCK_DEAL: '🔁',
  REGULATORY: '⚖️',
  ORDER_WIN: '📑',
  RATING: '🏷',
  MNA: '🎯',
  SECTOR_ROTATION: '🌀',
  NONE: '·',
};

export const CONFIDENCE_COLOR: Record<Confidence, string> = {
  HIGH: '#10B981',
  MEDIUM: '#22D3EE',
  LOW: '#F59E0B',
};

export const MOVE_TYPE_LABEL: Record<MoveType, string> = {
  INFORMATION: 'info-driven',
  FLOW: 'flow-driven',
  POSITIONING: 'positioning',
  LIQUIDITY: 'liquidity',
  MACRO: 'macro/sector',
};
