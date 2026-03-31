import { NextResponse } from 'next/server';
import { nseApiFetch, fetchStockQuote } from '@/lib/nse';
import { normalizeTicker } from '@/lib/tickers';
import { kvGet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

const INR_TO_USD = 85;

// ==================== TYPES ====================

type ActionFlag = 'BUY WATCH' | 'TRACK' | 'IGNORE';
type ImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';
type SignalSentiment = 'Bullish' | 'Neutral' | 'Bearish';

interface IntelSignal {
  symbol: string;
  company: string;
  date: string;
  source: 'order' | 'deal';

  // Event
  eventType: string;
  headline: string;

  // Quantified
  valueCr: number | null;
  valueUsd: string | null;
  mcapCr: number | null;
  revenueCr: number | null;
  pctRevenue: number | null;
  pctMcap: number | null;

  // Context
  client: string | null;
  segment: string | null;
  timeline: string | null;
  buyerSeller: string | null;
  premiumDiscount: number | null;

  // Classification — UPGRADED
  impactLevel: ImpactLevel;       // HIGH / MEDIUM / LOW
  action: ActionFlag;             // BUY WATCH / TRACK / IGNORE
  score: number;                  // 0-100
  timeWeight: number;             // 0-1 (time decay)
  weightedScore: number;          // score * timeWeight
  sentiment: SignalSentiment;
  whyItMatters: string;           // 1-line: "Improves backward integration → margin expansion likely"
  isNegative: boolean;            // Negative signal flag

  isWatchlist: boolean;
  isPortfolio: boolean;

  // Trend stacking (set at aggregation)
  signalStackCount?: number;
  signalStackLevel?: 'STRONG' | 'BUILDING' | 'WEAK';
}

interface CompanyTrend {
  symbol: string;
  company: string;
  signalCount: number;
  stackLevel: 'STRONG' | 'BUILDING' | 'WEAK';
  topAction: ActionFlag;
  topImpact: ImpactLevel;
  netSentiment: SignalSentiment;
  avgScore: number;
}

interface DailyBias {
  netBias: 'Bullish' | 'Neutral' | 'Bearish';
  highImpactCount: number;
  activeSectors: string[];
  buyWatchCount: number;
  trackCount: number;
  totalSignals: number;
  totalOrderValueCr: number;
  totalDealValueCr: number;
  portfolioAlerts: number;
  negativeSignals: number;
  summary: string;
}

interface IntelligenceResponse {
  top3: IntelSignal[];
  signals: IntelSignal[];
  trends: CompanyTrend[];       // Signal stacking per company
  bias: DailyBias;
  updatedAt: string;
}

// ==================== ENRICHMENT DATA ====================

interface StockEnrichment {
  symbol: string;
  mcapCr: number | null;
  annualRevenueCr: number | null;
  companyName: string | null;
  industry: string | null;
  lastPrice: number | null;
  issuedSize: number | null;
}

interface EarningsData {
  quarters?: Array<{ revenue?: number }>;
  mcap?: number;
  pe?: number;
  currentPrice?: number;
}

// ==================== UTILITY ====================

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function getTodayDate(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function fmtCr(v: number): string {
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K Cr`;
  if (v >= 1) return `₹${Math.round(v)} Cr`;
  return `₹${Math.round(v * 100)}L`;
}

// ==================== PARSING ====================

const ORDER_KEYWORDS = [
  // Order/Contract wins (HIGH VALUE — institutional favorite)
  'order', 'contract', 'awarded', 'loi', 'letter of intent',
  'work order', 'purchase order', 'mandate', 'supply agreement',
  'signed', 'obtained', 'bagging', 'receiving of orders',
  // Capex / Expansion (institutional catalyst)
  'capex', 'capital expenditure', 'expansion', 'new plant', 'new facility',
  'greenfield', 'brownfield', 'capacity addition', 'capacity expansion',
  // Strategic moves
  'joint venture', 'jv', 'partnership', 'mou', 'collaboration',
  'acquisition', 'merger', 'amalgamation', 'buyout', 'demerger',
  // Capital raises
  'fund raising', 'qip', 'rights issue', 'capital raising', 'preferential allotment',
  // Key leadership
  'appointment', 'resignation', 'ceo', 'cfo', 'managing director',
  // Shareholder returns
  'dividend', 'buyback',
  // Guidance / Outlook
  'guidance', 'outlook', 'forecast', 'target', 'revenue guidance',
];

// Noise patterns — these make an event ignorable
const NOISE_PATTERNS = [
  'rumour verification', 'clarification on', 'regulation 30',
  'action(s) taken', 'action(s) initiated', 'newspaper publication',
  'loss of share certificate', 'duplicate share', 'certificate',
  'investor meet', 'investor call', 'analyst meet',
  'board meeting intimation', 'record date',
  'compliance certificate', 'annual report', 'annual return',
  'disclosure under', 'credit rating', 'rating rationale',
  'closure of trading window', 'trading window', 'code of conduct',
  'secretarial audit', 'related party', 'composition of',
  'book closure', 'register of members', 'agm', 'general meeting',
  'interest payment', 'coupon payment', 'debenture',
  'listing of shares', 'allotment of shares', 'esop', 'esos',
  'change in address', 'change in directorate', 'cessation',
  'outcome of board', 'schedule of analyst', 'press release',
  'change in management', 'independent director',
  'postal ballot', 'notice of', 'proceedings of',
];

// Negative signal keywords — bearish events the market cares about
const NEGATIVE_KEYWORDS = [
  'order cancellation', 'cancelled', 'revoked', 'terminated',
  'margin warning', 'margin pressure', 'margin decline',
  'promoter selling', 'promoter pledge', 'pledge of shares', 'invocation of pledge',
  'debt increase', 'debt raise', 'downgrade', 'credit downgrade',
  'forensic audit', 'fraud', 'investigation', 'sebi order', 'penalty',
  'loss', 'net loss', 'operating loss', 'winding up', 'insolvency',
  'default', 'npa', 'non-performing', 'write-off', 'write off',
  'resignation of', 'key managerial', 'auditor resignation',
  'qualified opinion', 'disclaimer of opinion', 'adverse opinion',
  'demand notice', 'tax demand', 'show cause',
  'strike', 'lockout', 'force majeure', 'fire', 'accident',
  'delisting', 'suspension',
];

function parseOrderValue(text: string): number | null {
  if (!text) return null;
  const s = text.toLowerCase();

  // ₹ Crore patterns
  const crMatch = s.match(/(?:rs\.?|₹|inr|value of)\s*([\d,]+(?:\.\d+)?)\s*(?:crore|cr)\b/i);
  if (crMatch) return parseFloat(crMatch[1].replace(/,/g, ''));

  // Standalone number + crore without prefix (e.g. "1,200 Crores")
  const standaloneCr = s.match(/([\d,]+(?:\.\d+)?)\s*(?:crore|cr)\b/i);
  if (standaloneCr) {
    const val = parseFloat(standaloneCr[1].replace(/,/g, ''));
    if (val > 0.5) return val; // Ignore tiny numbers
  }

  // ₹ Lakh → Cr
  const lMatch = s.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:lakh|lac|l)\b/i);
  if (lMatch) return parseFloat(lMatch[1].replace(/,/g, '')) / 100;

  // USD Million → Cr
  const usdMnMatch = s.match(/(?:usd|\$)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn|m)\b/i);
  if (usdMnMatch) return (parseFloat(usdMnMatch[1].replace(/,/g, '')) * INR_TO_USD) / 10;

  // USD Billion → Cr
  const usdBnMatch = s.match(/(?:usd|\$)\s*([\d,]+(?:\.\d+)?)\s*(?:billion|bn|b)\b/i);
  if (usdBnMatch) return parseFloat(usdBnMatch[1].replace(/,/g, '')) * INR_TO_USD * 100;

  // ₹ Million → Cr
  const inrMnMatch = s.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn)\b/i);
  if (inrMnMatch) return parseFloat(inrMnMatch[1].replace(/,/g, '')) / 10;

  return null;
}

function classifyOrderType(subject: string, desc: string): string {
  const c = `${subject} ${desc}`.toLowerCase();
  // Most valuable first: Orders/Contracts with quantified value
  if (c.includes('order win') || c.includes('order received') || c.includes('awarded') || c.includes('bagging')) return 'Order Win';
  if (c.includes('work order') || c.includes('purchase order')) return 'Order Win';
  if (c.includes('contract') && !c.includes('employment contract') && !c.includes('service contract for director')) return 'Contract';
  if (c.includes('letter of intent') || c.includes('loi')) return 'LOI';
  // Capex / Expansion
  if (c.includes('capex') || c.includes('capital expenditure') || c.includes('expansion') || c.includes('new plant') || c.includes('new facility') || c.includes('capacity addition') || c.includes('greenfield') || c.includes('brownfield')) return 'Capex/Expansion';
  // Strategic — only real M&A, not just "acquisition of shares"
  if ((c.includes('acquisition') || c.includes('merger') || c.includes('amalgamation') || c.includes('buyout')) &&
      !c.includes('acquisition of shares by') && !c.includes('esop')) return 'M&A';
  if (c.includes('demerger')) return 'Demerger';
  if (c.includes('joint venture') || c.includes('jv') || c.includes('partnership') || c.includes('collaboration') || c.includes('mou')) return 'JV/Partnership';
  // Capital
  if (c.includes('fund raising') || c.includes('qip') || c.includes('rights issue') || c.includes('preferential allotment')) return 'Fund Raising';
  if (c.includes('buyback')) return 'Buyback';
  if (c.includes('dividend')) return 'Dividend';
  // Guidance
  if (c.includes('guidance') || c.includes('outlook') || c.includes('forecast')) return 'Guidance';
  // People
  if (c.includes('appointment') || c.includes('resignation') || c.includes('ceo') || c.includes('cfo') || c.includes('managing director')) return 'Mgmt Change';
  return 'Corporate';
}

function extractClient(text: string): string | null {
  const entities: [string, string][] = [
    ['NHAI', 'NHAI'], ['Indian Railways', 'Indian Railways'],
    ['Ministry of Defence', 'Min. of Defence'], ['NTPC', 'NTPC'],
    ['ONGC', 'ONGC'], ['IOCL', 'IOCL'], ['GAIL', 'GAIL'],
    ['HAL', 'HAL'], ['BEL', 'BEL'], ['BHEL', 'BHEL'],
    ['Coal India', 'Coal India'], ['Power Grid', 'Power Grid'],
    ['NHPC', 'NHPC'], ['SAIL', 'SAIL'], ['BPCL', 'BPCL'],
    ['Government', 'Govt'], ['Govt', 'Govt'],
  ];
  const lower = text.toLowerCase();
  for (const [keyword, label] of entities) {
    if (lower.includes(keyword.toLowerCase())) return label;
  }

  // Pattern match
  const m = text.match(/(?:from|by|with|awarded by|received from)\s+(?:M\/s\.?\s+)?([A-Z][A-Za-z &.()]+(?:Ltd|Limited|Corp|Inc))/);
  if (m) {
    const c = m[1].trim().replace(/[.,;:]+$/, '');
    if (c.length > 3 && c.length < 60) return c;
  }
  return null;
}

function extractSegment(text: string): string | null {
  const lower = text.toLowerCase();
  const map: [string[], string][] = [
    [['defence', 'defense', 'military', 'naval'], 'Defence'],
    [['railway', 'rail', 'metro'], 'Railways'],
    [['infrastructure', 'road', 'highway', 'bridge'], 'Infra'],
    [['power', 'energy', 'solar', 'wind', 'renewable', 'transmission'], 'Power'],
    [['water', 'sewage', 'irrigation'], 'Water'],
    [['oil', 'gas', 'petroleum', 'refinery'], 'Oil & Gas'],
    [['mining', 'coal', 'steel'], 'Metals'],
    [['telecom', '5g', 'fiber'], 'Telecom'],
    [['it ', 'software', 'digital', 'cloud'], 'IT'],
    [['pharma', 'drug', 'healthcare'], 'Pharma'],
    [['auto', 'vehicle', 'ev '], 'Auto'],
    [['chemical', 'specialty'], 'Chemicals'],
    [['cement', 'construction'], 'Construction'],
    [['textile', 'garment'], 'Textiles'],
    [['real estate', 'housing'], 'Realty'],
  ];
  for (const [keywords, segment] of map) {
    if (keywords.some(k => lower.includes(k))) return segment;
  }
  return null;
}

function extractTimeline(text: string): string | null {
  const m1 = text.match(/(\d+)\s*(?:months?|yrs?|years?)/i);
  if (m1) {
    const n = parseInt(m1[1]);
    if (/year/i.test(m1[0])) return `${n}Y`;
    return `${n}M`;
  }
  if (/multi.?year/i.test(text)) return 'Multi-yr';
  return null;
}

// ==================== ECONOMIC IMPACT ENGINE ====================
// Impact % = Event Value / Annual Revenue → HIGH / MEDIUM / LOW

function classifyImpactLevel(pctRevenue: number | null, pctMcap: number | null, valueCr: number | null, eventType: string): ImpactLevel {
  // Gold standard: % of annual revenue
  if (pctRevenue !== null) {
    if (pctRevenue >= 5) return 'HIGH';
    if (pctRevenue >= 1) return 'MEDIUM';
    return 'LOW';
  }
  // Secondary: % of market cap (for capex, M&A)
  if (pctMcap !== null) {
    if (pctMcap >= 5) return 'HIGH';
    if (pctMcap >= 1) return 'MEDIUM';
    return 'LOW';
  }
  // Absolute value fallback
  if (valueCr !== null) {
    if (valueCr >= 500) return 'HIGH';
    if (valueCr >= 100) return 'MEDIUM';
    return 'LOW';
  }
  // Event type heuristic when no value available
  if (['M&A', 'Capex/Expansion', 'Demerger'].includes(eventType)) return 'MEDIUM';
  if (['Order Win', 'Contract', 'Fund Raising'].includes(eventType)) return 'MEDIUM';
  return 'LOW';
}

// ==================== FORCE ACTION ENGINE ====================
// Replaces HOLD CONTEXT — every signal gets a DECISION

function classifyAction(impactLevel: ImpactLevel, sentiment: SignalSentiment, isWatchlist: boolean, isPortfolio: boolean, eventType: string): ActionFlag {
  // HIGH impact + Bullish/Neutral → BUY WATCH
  if (impactLevel === 'HIGH' && sentiment !== 'Bearish') return 'BUY WATCH';
  // HIGH impact + Bearish → still TRACK (you need to know)
  if (impactLevel === 'HIGH' && sentiment === 'Bearish') return 'TRACK';
  // MEDIUM impact + portfolio/watchlist → TRACK
  if (impactLevel === 'MEDIUM' && (isWatchlist || isPortfolio)) return 'TRACK';
  // MEDIUM impact + Bullish → TRACK (potential opportunity)
  if (impactLevel === 'MEDIUM' && sentiment === 'Bullish') return 'TRACK';
  // MEDIUM impact + strategic events → TRACK
  if (impactLevel === 'MEDIUM' && ['M&A', 'Capex/Expansion', 'Demerger', 'Fund Raising'].includes(eventType)) return 'TRACK';
  // Everything else MEDIUM → IGNORE
  if (impactLevel === 'MEDIUM') return 'IGNORE';
  // LOW impact — only track if portfolio stock
  if (impactLevel === 'LOW' && isPortfolio) return 'TRACK';
  return 'IGNORE';
}

// ==================== TIME DECAY ====================

function computeTimeWeight(dateStr: string): number {
  try {
    // Parse date — handle both "DD-MM-YYYY" and ISO formats
    let d: Date;
    if (dateStr.includes('-') && dateStr.length === 10 && dateStr[2] === '-') {
      const [dd, mm, yyyy] = dateStr.split('-');
      d = new Date(`${yyyy}-${mm}-${dd}`);
    } else {
      d = new Date(dateStr);
    }
    if (isNaN(d.getTime())) return 0.5;
    const daysOld = Math.max(0, (Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
    if (daysOld <= 1) return 1.0;
    if (daysOld <= 3) return 0.85;
    if (daysOld <= 5) return 0.7;
    if (daysOld <= 7) return 0.5;
    if (daysOld <= 14) return 0.3;
    return 0.1;
  } catch {
    return 0.5;
  }
}

// ==================== WHY IT MATTERS ====================

function generateWhyItMatters(opts: {
  eventType: string;
  impactLevel: ImpactLevel;
  pctRevenue: number | null;
  pctMcap: number | null;
  valueCr: number | null;
  client: string | null;
  segment: string | null;
  isNegative: boolean;
  sentiment: SignalSentiment;
  buyerSeller: string | null;
  premiumDiscount: number | null;
}): string {
  const { eventType, impactLevel, pctRevenue, pctMcap, valueCr, client, segment, isNegative, buyerSeller, premiumDiscount } = opts;

  if (isNegative) {
    if (eventType.includes('cancellation') || eventType.includes('terminated')) return 'Revenue loss risk — check order book concentration';
    if (eventType.includes('pledge') || eventType.includes('Promoter')) return 'Promoter stress signal — watch for forced selling pressure';
    if (eventType.includes('downgrade')) return 'Credit deterioration — higher cost of capital, margin pressure';
    if (eventType.includes('loss')) return 'Profitability under stress — assess if temporary or structural';
    if (eventType.includes('audit') || eventType.includes('fraud')) return 'Governance red flag — potential restatement risk';
    if (eventType.includes('resignation')) return 'Key person risk — continuity and strategy execution at risk';
    return 'Negative development — monitor for further deterioration';
  }

  // Positive / neutral events
  if (eventType === 'Order Win' || eventType === 'Contract' || eventType === 'LOI') {
    if (pctRevenue !== null && pctRevenue >= 5) return `${pctRevenue.toFixed(0)}% of revenue — material order, direct top-line accretion`;
    if (pctRevenue !== null && pctRevenue >= 1) return `Meaningful order at ${pctRevenue.toFixed(1)}% of revenue — revenue visibility improves`;
    if (client) return `New order from ${client} — client diversification + execution track record`;
    if (segment === 'Defence' || segment === 'Railways') return `Govt order in ${segment} — long cycle, stable margin profile`;
    return 'New order win — improves revenue pipeline visibility';
  }

  if (eventType === 'Capex/Expansion') {
    if (pctMcap !== null && pctMcap >= 5) return `Large capex at ${pctMcap.toFixed(1)}% of MCap — operating leverage play, watch execution`;
    return 'Capacity expansion — forward revenue visibility, watch ROI timeline';
  }

  if (eventType === 'M&A') {
    if (pctRevenue !== null && pctRevenue >= 10) return 'Transformative acquisition — changes revenue mix significantly';
    if (pctMcap !== null && pctMcap >= 5) return `Material M&A at ${pctMcap.toFixed(1)}% MCap — integration risk but growth potential`;
    return 'Strategic acquisition — improves market position or backward integration';
  }

  if (eventType === 'Demerger') return 'Value unlock — sum-of-parts may exceed current market cap';
  if (eventType === 'Fund Raising') return 'Capital raise — fuels growth but watch dilution impact';
  if (eventType === 'Buyback') return 'Management conviction in undervaluation — capital return signal';
  if (eventType === 'Dividend') return 'Cash return to shareholders — signals healthy cash flow';
  if (eventType === 'JV/Partnership') return 'Strategic partnership — technology or market access play';
  if (eventType === 'Guidance') return 'Management outlook update — forward visibility signal';
  if (eventType === 'Mgmt Change') return 'Leadership transition — watch for strategy continuity';

  if (eventType.includes('Block Buy') || eventType.includes('Bulk Buy')) {
    if (buyerSeller && /mutual fund|fii|institutional/i.test(buyerSeller)) return 'Institutional buying — smart money accumulation signal';
    if (premiumDiscount !== null && premiumDiscount > 2) return `Premium deal at +${premiumDiscount.toFixed(1)}% — buyer conviction strong`;
    return 'Block/bulk buying — institutional interest building';
  }

  if (eventType.includes('Block Sell') || eventType.includes('Bulk Sell')) {
    if (premiumDiscount !== null && premiumDiscount < -2) return `Discount exit at ${premiumDiscount.toFixed(1)}% — urgency to sell, watch supply pressure`;
    return 'Institutional selling — check if rebalancing or conviction change';
  }

  return impactLevel === 'HIGH' ? 'High impact corporate event — direct business impact' :
         impactLevel === 'MEDIUM' ? 'Moderate impact — worth tracking for pattern changes' :
         'Low impact — informational only';
}

// ==================== NEGATIVE SIGNAL DETECTION ====================

function isNegativeSignal(subject: string, desc: string): boolean {
  const combined = `${subject} ${desc}`.toLowerCase();
  return NEGATIVE_KEYWORDS.some(kw => combined.includes(kw));
}

function classifySentiment(eventType: string, isNegative: boolean, isBuyDeal: boolean): SignalSentiment {
  if (isNegative) return 'Bearish';
  if (['Order Win', 'Contract', 'LOI', 'Capex/Expansion', 'Buyback', 'Guidance'].includes(eventType)) return 'Bullish';
  if (['M&A', 'Demerger', 'Fund Raising', 'JV/Partnership'].includes(eventType)) return 'Bullish';
  if (eventType.includes('Buy')) return isBuyDeal ? 'Bullish' : 'Neutral';
  if (eventType.includes('Sell')) return 'Bearish';
  return 'Neutral';
}

function computeScore(opts: {
  pctRevenue: number | null;
  valueCr: number | null;
  impactLevel: ImpactLevel;
  eventType: string;
  client: string | null;
  segment: string | null;
  isWatchlist: boolean;
  isPortfolio: boolean;
  isDeal: boolean;
  isNegative: boolean;
  dealPremiumDiscount?: number | null;
  buyerQuality?: number;
}): number {
  let score = 0;

  // Revenue impact (0-40)
  if (opts.pctRevenue !== null) {
    if (opts.pctRevenue >= 10) score += 40;
    else if (opts.pctRevenue >= 5) score += 35;
    else if (opts.pctRevenue >= 2) score += 28;
    else if (opts.pctRevenue >= 1) score += 20;
    else if (opts.pctRevenue >= 0.5) score += 12;
    else score += 5;
  } else if (opts.valueCr !== null) {
    if (opts.valueCr >= 1000) score += 30;
    else if (opts.valueCr >= 500) score += 25;
    else if (opts.valueCr >= 100) score += 18;
    else if (opts.valueCr >= 50) score += 12;
    else score += 5;
  }

  // Event type weight (0-25)
  const typeScores: Record<string, number> = {
    'Order Win': 22, 'Contract': 22, 'Capex/Expansion': 25, 'M&A': 25,
    'Demerger': 20, 'Fund Raising': 15, 'JV/Partnership': 18, 'LOI': 12,
    'Buyback': 10, 'Dividend': 5, 'Guidance': 20, 'Mgmt Change': 8, 'Corporate': 3,
    'Block Buy': 22, 'Block Sell': 18, 'Bulk Buy': 15, 'Bulk Sell': 12,
  };
  score += typeScores[opts.eventType] || 5;

  // Strategic context (0-15)
  if (opts.client) score += 8;
  if (opts.segment && ['Defence', 'Railways', 'Infra', 'Power'].includes(opts.segment)) score += 7;
  else if (opts.segment) score += 4;

  // Portfolio bonus (0-15) — higher than watchlist
  if (opts.isPortfolio) score += 15;
  else if (opts.isWatchlist) score += 10;

  // Negative signals get boosted — bad news moves faster
  if (opts.isNegative) score += 10;

  // Deal-specific
  if (opts.isDeal) {
    if (opts.buyerQuality && opts.buyerQuality >= 80) score += 10;
    if (opts.dealPremiumDiscount !== undefined && opts.dealPremiumDiscount !== null) {
      if (opts.dealPremiumDiscount > 3) score += 8;
      else if (opts.dealPremiumDiscount > 0) score += 4;
    }
  }

  return Math.min(score, 100);
}

// ==================== ENRICHMENT ====================

async function enrichSymbol(symbol: string): Promise<StockEnrichment> {
  const result: StockEnrichment = {
    symbol, mcapCr: null, annualRevenueCr: null,
    companyName: null, industry: null, lastPrice: null, issuedSize: null,
  };

  try {
    const quote = await fetchStockQuote(symbol);
    if (quote) {
      result.lastPrice = quote.priceInfo?.lastPrice || null;
      result.issuedSize = quote.securityInfo?.issuedSize || null;
      result.companyName = quote.info?.companyName || null;
      result.industry = quote.info?.industry || null;

      if (quote.priceInfo?.totalMarketCap) {
        result.mcapCr = quote.priceInfo.totalMarketCap / 10000000;
      } else if (result.lastPrice && result.issuedSize) {
        result.mcapCr = (result.lastPrice * result.issuedSize) / 10000000;
      }
    }

    // Earnings from KV (revenue already in Crores)
    const earnings = await kvGet<EarningsData>(`earnings:${symbol}`);
    if (earnings?.quarters && Array.isArray(earnings.quarters)) {
      const rev = earnings.quarters.slice(0, 4).reduce((s, q) => s + (q.revenue || 0), 0);
      if (rev > 0) result.annualRevenueCr = rev;
    }
    if (!result.mcapCr && earnings?.mcap) result.mcapCr = earnings.mcap;
  } catch (e) {
    console.error(`[Intelligence] Enrich error ${symbol}:`, e);
  }

  return result;
}

// ==================== BUYER QUALITY ====================

function scoreBuyerQuality(name: string): number {
  const l = name.toLowerCase();
  if (/\b(mutual fund|mf|amc|sbi mf|hdfc mf|icici pru|axis mf|kotak mf|nippon|dsp|uti)\b/.test(l)) return 90;
  if (/\b(fii|foreign|dii|institutional|blackrock|vanguard|goldman|morgan|jp morgan|citadel|capital group)\b/.test(l)) return 90;
  if (/\b(promoter|founder|director|chairman|managing)\b/.test(l)) return 85;
  if (/\b(insurance|lic|life insurance)\b/.test(l)) return 75;
  if (/\b(pvt|private|ltd|limited|capital|invest|fund|trust|advisors|wealth|asset)\b/.test(l)) return 60;
  return 40;
}

// ==================== MAIN HANDLER ====================

export async function GET(request: Request): Promise<NextResponse<IntelligenceResponse>> {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const watchlistParam = searchParams.get('watchlist');
    const portfolioParam = searchParams.get('portfolio');
    const days = parseInt(searchParams.get('days') || '30');

    const watchlist = watchlistParam
      ? watchlistParam.split(',').map(s => normalizeTicker(s.trim())).filter(Boolean)
      : [];
    const portfolio = portfolioParam
      ? portfolioParam.split(',').map(s => normalizeTicker(s.trim())).filter(Boolean)
      : [];
    const watchlistSet = new Set(watchlist);
    const portfolioSet = new Set(portfolio);

    console.log(`[Intelligence] Starting: ${watchlist.length} watchlist, ${portfolio.length} portfolio, ${days} days`);

    // ── 1. Fetch data in parallel ──
    const fromDate = getDateDaysAgo(days);
    const toDate = getTodayDate();

    const [announcementsRaw, blockRaw, bulkRaw] = await Promise.all([
      nseApiFetch(`/api/corporate-announcements?index=equities&from_date=${fromDate}&to_date=${toDate}`, 300000)
        .catch(() => null),
      nseApiFetch('/api/block-deal', 300000).catch(() => null),
      nseApiFetch('/api/bulk-deal', 300000).catch(() => null),
    ]);

    // Parse announcements
    let announcements: any[] = [];
    if (announcementsRaw) {
      announcements = Array.isArray(announcementsRaw) ? announcementsRaw : (announcementsRaw?.data || []);
    }

    // Normalize deals
    const blockDeals = (Array.isArray(blockRaw) ? blockRaw : (blockRaw?.data || []))
      .map((d: any) => ({
        symbol: d.symbol || d.BD_SYMBOL || '',
        clientName: d.clientName || d.BD_CLIENT_NAME || '',
        quantity: parseInt(d.quantity || d.BD_QTY_TRD || '0'),
        tradePrice: parseFloat(d.tradePrice || d.BD_TP_WATP || '0'),
        buySell: (d.buySell || d.BD_BUY_SELL || '').trim(),
        dealDate: d.dealDate || d.BD_DT_DATE || '',
        type: 'Block' as const,
      }))
      .filter((d: any) => d.quantity > 0 && d.tradePrice > 0 && d.symbol);

    const bulkDeals = (Array.isArray(bulkRaw) ? bulkRaw : (bulkRaw?.data || []))
      .map((d: any) => ({
        symbol: d.symbol || d.BD_SYMBOL || '',
        clientName: d.clientName || d.BD_CLIENT_NAME || '',
        quantity: parseInt(d.quantity || d.BD_QTY_TRD || '0'),
        tradePrice: parseFloat(d.tradePrice || d.BD_TP_WATP || '0'),
        buySell: (d.buySell || d.BD_BUY_SELL || '').trim(),
        dealDate: d.dealDate || d.BD_DT_DATE || '',
        type: 'Bulk' as const,
      }))
      .filter((d: any) => d.quantity > 0 && d.tradePrice > 0 && d.symbol);

    // Filter announcements for material events (positive + negative)
    const filteredAnn = announcements.filter(item => {
      if (!item.symbol || (!item.desc && !item.subject)) return false;
      const combined = `${item.subject || ''} ${item.desc || ''}`.toLowerCase();
      // Skip noise
      if (NOISE_PATTERNS.some(p => combined.includes(p))) return false;
      // Include positive/neutral keywords OR negative keywords
      return ORDER_KEYWORDS.some(k => combined.includes(k)) ||
             NEGATIVE_KEYWORDS.some(k => combined.includes(k));
    });

    console.log(`[Intelligence] ${announcements.length} announcements → ${filteredAnn.length} material | ${blockDeals.length} block, ${bulkDeals.length} bulk deals`);

    // ── 2. Collect symbols for enrichment (capped at 30) ──
    const symbolsToEnrich = new Set<string>();
    portfolio.forEach(s => symbolsToEnrich.add(s));
    watchlist.forEach(s => symbolsToEnrich.add(s));
    [...blockDeals, ...bulkDeals].forEach(d => symbolsToEnrich.add(normalizeTicker(d.symbol)));
    filteredAnn.forEach(a => { if (symbolsToEnrich.size < 30) symbolsToEnrich.add(normalizeTicker(a.symbol)); });
    symbolsToEnrich.delete('');

    // Batch enrich
    const enrichMap = new Map<string, StockEnrichment>();
    const symArr = Array.from(symbolsToEnrich);
    for (let i = 0; i < symArr.length; i += 3) {
      const batch = symArr.slice(i, i + 3);
      const results = await Promise.all(batch.map(s => enrichSymbol(s)));
      results.forEach(r => enrichMap.set(r.symbol, r));
      if (i + 3 < symArr.length) await new Promise(r => setTimeout(r, 200));
    }

    console.log(`[Intelligence] Enriched ${enrichMap.size} symbols`);

    // ── 3. Build signals from corporate orders ──
    const allSignals: IntelSignal[] = [];
    // DEDUP: key = symbol:eventType:date → merge same company + same event type + same day
    const dedupMap = new Map<string, IntelSignal>();

    for (const item of filteredAnn) {
      const subject = item.subject || '';
      const desc = item.desc || '';
      const symbol = normalizeTicker(item.symbol || '');
      if (!symbol) continue;

      const enrichment = enrichMap.get(symbol);
      const combinedText = `${subject} ${desc}`;
      const valueCr = parseOrderValue(combinedText);
      const eventType = classifyOrderType(subject, desc);
      const client = extractClient(combinedText);
      const segment = extractSegment(combinedText) || (enrichment?.industry ? enrichment.industry.split(' ')[0] : null);
      const timeline = extractTimeline(combinedText);
      const isWatchlist = watchlistSet.has(symbol);
      const isPortfolio = portfolioSet.has(symbol);
      const negative = isNegativeSignal(subject, desc);

      const pctRevenue = (enrichment?.annualRevenueCr && valueCr)
        ? Math.round((valueCr / enrichment.annualRevenueCr) * 10000) / 100
        : null;
      const pctMcap = (enrichment?.mcapCr && valueCr)
        ? Math.round((valueCr / enrichment.mcapCr) * 10000) / 100
        : null;

      const impactLevel = classifyImpactLevel(pctRevenue, pctMcap, valueCr, eventType);
      const sentiment = classifySentiment(eventType, negative, false);
      const action = classifyAction(impactLevel, sentiment, isWatchlist, isPortfolio, eventType);
      const timeWeight = computeTimeWeight(item.date || getTodayDate());
      const score = computeScore({
        pctRevenue, valueCr, impactLevel, eventType,
        client, segment, isWatchlist, isPortfolio, isDeal: false, isNegative: negative,
      });
      const weightedScore = Math.round(score * timeWeight);

      const whyItMatters = generateWhyItMatters({
        eventType, impactLevel, pctRevenue, pctMcap, valueCr,
        client, segment, isNegative: negative, sentiment, buyerSeller: null, premiumDiscount: null,
      });

      // Build headline
      let headline = '';
      if (valueCr && valueCr > 0) {
        headline = `${fmtCr(valueCr)} ${eventType}`;
      } else {
        headline = negative ? `⚠ ${eventType}` : eventType;
      }
      if (client) headline += ` from ${client}`;
      const matParts: string[] = [];
      if (pctRevenue !== null && pctRevenue > 0) matParts.push(`${pctRevenue.toFixed(1)}% of annual revenue`);
      if (pctMcap !== null && pctMcap > 0) matParts.push(`${pctMcap.toFixed(1)}% of MCap`);
      if (segment) matParts.push(segment);
      if (timeline) matParts.push(timeline);
      if (matParts.length > 0) headline += ` — ${matParts.join(' · ')}`;
      const descSnippet = (desc || '').slice(0, 120).replace(/\s+/g, ' ').trim();
      if (descSnippet && descSnippet.length > 20 && !headline.includes(descSnippet.slice(0, 30))) {
        headline += `. ${descSnippet}`;
      }

      // DEDUP: same symbol + same event type + same day → keep highest scoring
      const dateStr = (item.date || getTodayDate()).slice(0, 10);
      const dedupKey = `${symbol}:${eventType}:${dateStr}`;
      const existing = dedupMap.get(dedupKey);

      const signal: IntelSignal = {
        symbol, company: item.companyName || enrichment?.companyName || symbol,
        date: item.date || getTodayDate(), source: 'order',
        eventType, headline,
        valueCr, valueUsd: valueCr ? `$${((valueCr * 10000000) / INR_TO_USD / 1000000).toFixed(1)}M` : null,
        mcapCr: enrichment?.mcapCr || null, revenueCr: enrichment?.annualRevenueCr || null,
        pctRevenue, pctMcap,
        client, segment, timeline,
        buyerSeller: null, premiumDiscount: null,
        impactLevel, action, score, timeWeight, weightedScore, sentiment, whyItMatters,
        isNegative: negative, isWatchlist, isPortfolio,
      };

      if (!existing || weightedScore > existing.weightedScore) {
        // If merging, keep higher value
        if (existing && existing.valueCr && signal.valueCr && existing.valueCr > signal.valueCr) {
          signal.valueCr = existing.valueCr;
        }
        dedupMap.set(dedupKey, signal);
      }
    }

    // Collect deduped order signals
    allSignals.push(...dedupMap.values());

    // ── 4. Build signals from deals ──
    const dealDedupMap = new Map<string, IntelSignal>();

    for (const deal of [...blockDeals, ...bulkDeals]) {
      const symbol = normalizeTicker(deal.symbol);
      if (!symbol) continue;

      const enrichment = enrichMap.get(symbol);
      const isBuy = deal.buySell.toLowerCase().includes('buy');
      const dealValueCr = Math.round((deal.quantity * deal.tradePrice) / 10000000 * 100) / 100;
      const cmp = enrichment?.lastPrice || null;
      const premiumDiscount = cmp && deal.tradePrice
        ? Math.round(((deal.tradePrice - cmp) / cmp) * 10000) / 100
        : null;
      const pctEquity = enrichment?.issuedSize
        ? Math.round((deal.quantity / enrichment.issuedSize) * 10000) / 100
        : null;

      const eventType = `${deal.type} ${isBuy ? 'Buy' : 'Sell'}`;
      const buyerQual = scoreBuyerQuality(deal.clientName);
      const isWatchlist = watchlistSet.has(symbol);
      const isPortfolio = portfolioSet.has(symbol);
      const isSell = !isBuy;
      const sentiment = classifySentiment(eventType, isSell && buyerQual >= 80, isBuy);

      // For deals, use buyer quality to determine impact level
      const impactLevel: ImpactLevel = buyerQual >= 80 && dealValueCr >= 5 ? 'HIGH' :
                                       buyerQual >= 60 || dealValueCr >= 1 ? 'MEDIUM' : 'LOW';
      const action = classifyAction(impactLevel, sentiment, isWatchlist, isPortfolio, eventType);
      const timeWeight = computeTimeWeight(deal.dealDate || getTodayDate());

      const score = computeScore({
        pctRevenue: null, valueCr: dealValueCr, impactLevel, eventType,
        client: null, segment: null, isWatchlist, isPortfolio, isDeal: true, isNegative: isSell && buyerQual >= 80,
        dealPremiumDiscount: premiumDiscount, buyerQuality: buyerQual,
      });
      const weightedScore = Math.round(score * timeWeight);

      const whyItMatters = generateWhyItMatters({
        eventType, impactLevel, pctRevenue: null, pctMcap: null, valueCr: dealValueCr,
        client: null, segment: null, isNegative: isSell, sentiment, buyerSeller: deal.clientName, premiumDiscount,
      });

      // Headline
      let headline = `${deal.type} ${isBuy ? '▲' : '▼'} ${fmtCr(dealValueCr)}`;
      headline += ` | ${deal.clientName.slice(0, 30)}`;
      if (premiumDiscount !== null) {
        headline += ` | ${premiumDiscount > 0 ? '+' : ''}${premiumDiscount.toFixed(1)}%`;
      }
      if (pctEquity !== null && pctEquity > 0.01) {
        headline += ` | ${pctEquity.toFixed(2)}% eq`;
      }

      // DEDUP: same symbol + same deal type + same direction + same day
      const dateStr = (deal.dealDate || getTodayDate()).slice(0, 10);
      const dedupKey = `${symbol}:${eventType}:${dateStr}`;
      const existing = dealDedupMap.get(dedupKey);

      const signal: IntelSignal = {
        symbol, company: enrichment?.companyName || symbol,
        date: deal.dealDate || getTodayDate(), source: 'deal',
        eventType, headline,
        valueCr: dealValueCr, valueUsd: null,
        mcapCr: enrichment?.mcapCr || null, revenueCr: enrichment?.annualRevenueCr || null,
        pctRevenue: null, pctMcap: null,
        client: null, segment: enrichment?.industry || null, timeline: null,
        buyerSeller: deal.clientName, premiumDiscount,
        impactLevel, action, score, timeWeight, weightedScore, sentiment, whyItMatters,
        isNegative: isSell && buyerQual >= 80,
        isWatchlist, isPortfolio,
      };

      if (!existing || weightedScore > existing.weightedScore) {
        if (existing && existing.valueCr && signal.valueCr && existing.valueCr > signal.valueCr) {
          signal.valueCr = existing.valueCr;
        }
        dealDedupMap.set(dedupKey, signal);
      }
    }

    allSignals.push(...dealDedupMap.values());

    // ── 5. Filter, sort by weighted score ──
    const filtered = allSignals
      .filter(s => s.action !== 'IGNORE' || s.isWatchlist || s.isPortfolio)
      .sort((a, b) => {
        // BUY WATCH first, then TRACK, then IGNORE
        const actionRank: Record<ActionFlag, number> = { 'BUY WATCH': 0, 'TRACK': 1, 'IGNORE': 2 };
        const ar = actionRank[a.action] - actionRank[b.action];
        if (ar !== 0) return ar;
        // Then by weighted score (time-decayed)
        return b.weightedScore - a.weightedScore;
      });

    // ── 5.5 Build trend layer (signal stacking per company) ──
    const companySignalMap = new Map<string, IntelSignal[]>();
    for (const s of filtered) {
      const arr = companySignalMap.get(s.symbol) || [];
      arr.push(s);
      companySignalMap.set(s.symbol, arr);
    }

    const trends: CompanyTrend[] = [];
    for (const [sym, sigs] of companySignalMap) {
      const count = sigs.length;
      const stackLevel: CompanyTrend['stackLevel'] = count >= 4 ? 'STRONG' : count >= 2 ? 'BUILDING' : 'WEAK';

      // Set stack info on each signal
      for (const s of sigs) {
        s.signalStackCount = count;
        s.signalStackLevel = stackLevel;
      }

      const bullish = sigs.filter(s => s.sentiment === 'Bullish').length;
      const bearish = sigs.filter(s => s.sentiment === 'Bearish').length;

      if (count >= 2) {
        trends.push({
          symbol: sym,
          company: sigs[0].company,
          signalCount: count,
          stackLevel,
          topAction: sigs[0].action,
          topImpact: sigs[0].impactLevel,
          netSentiment: bullish > bearish ? 'Bullish' : bearish > bullish ? 'Bearish' : 'Neutral',
          avgScore: Math.round(sigs.reduce((s, x) => s + x.weightedScore, 0) / count),
        });
      }
    }
    trends.sort((a, b) => b.avgScore - a.avgScore);

    // Top 3 = highest weighted-scoring non-IGNORE signals
    const top3 = filtered.filter(s => s.action !== 'IGNORE').slice(0, 3);

    // ── 6. Build daily bias ──
    const sectorSet = new Set<string>();
    let totalOrderValueCr = 0;
    let totalDealValueCr = 0;
    let buyWatchCount = 0;
    let trackCount = 0;
    let highImpactCount = 0;
    let bullishCount = 0;
    let bearishCount = 0;
    let portfolioAlerts = 0;
    let negativeSignals = 0;

    for (const s of filtered) {
      if (s.segment) sectorSet.add(s.segment);
      if (s.source === 'order' && s.valueCr) totalOrderValueCr += s.valueCr;
      if (s.source === 'deal' && s.valueCr) totalDealValueCr += s.valueCr;
      if (s.action === 'BUY WATCH') buyWatchCount++;
      if (s.action === 'TRACK') trackCount++;
      if (s.impactLevel === 'HIGH') highImpactCount++;
      if (s.sentiment === 'Bullish') bullishCount++;
      if (s.sentiment === 'Bearish') bearishCount++;
      if (s.isPortfolio && s.action !== 'IGNORE') portfolioAlerts++;
      if (s.isNegative) negativeSignals++;
    }

    const netBias: DailyBias['netBias'] = bullishCount > bearishCount + 2 ? 'Bullish' :
                                           bearishCount > bullishCount + 2 ? 'Bearish' : 'Neutral';
    const activeSectors = Array.from(sectorSet).slice(0, 5);

    const biasParts: string[] = [];
    if (highImpactCount > 0) biasParts.push(`${highImpactCount} High Impact`);
    if (buyWatchCount > 0) biasParts.push(`${buyWatchCount} BUY WATCH`);
    if (negativeSignals > 0) biasParts.push(`${negativeSignals} ⚠ Negative`);
    if (portfolioAlerts > 0) biasParts.push(`${portfolioAlerts} Portfolio Alert${portfolioAlerts > 1 ? 's' : ''}`);
    biasParts.push(`Net: ${netBias}`);
    const biasStr = biasParts.join(' · ');

    const bias: DailyBias = {
      netBias, highImpactCount, activeSectors, buyWatchCount, trackCount,
      totalSignals: filtered.length,
      totalOrderValueCr: Math.round(totalOrderValueCr),
      totalDealValueCr: Math.round(totalDealValueCr),
      portfolioAlerts, negativeSignals,
      summary: biasStr,
    };

    const response: IntelligenceResponse = {
      top3,
      signals: filtered.slice(0, 25), // Increased from 15 to 25
      trends: trends.slice(0, 10),
      bias,
      updatedAt: new Date().toISOString(),
    };

    const duration = Date.now() - startTime;
    console.log(`[Intelligence] Done: ${filtered.length} signals (deduped from ${announcements.length}), ${top3.length} top3, ${trends.length} trends, bias=${netBias} in ${duration}ms`);

    return NextResponse.json(response);
  } catch (error) {
    console.error(`[Intelligence] Fatal error:`, error);
    return NextResponse.json({
      top3: [],
      signals: [],
      trends: [],
      bias: {
        netBias: 'Neutral' as const,
        highImpactCount: 0, activeSectors: [], buyWatchCount: 0, trackCount: 0,
        totalSignals: 0, totalOrderValueCr: 0, totalDealValueCr: 0,
        portfolioAlerts: 0, negativeSignals: 0,
        summary: 'Error fetching intelligence',
      },
      updatedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}
