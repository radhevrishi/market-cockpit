import { NextResponse } from 'next/server';
import { nseApiFetch, fetchStockQuote } from '@/lib/nse';
import { normalizeTicker } from '@/lib/tickers';
import { kvGet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// Constants
const INR_TO_USD = 85;
const ORDER_KEYWORDS = [
  'order', 'contract', 'awarded', 'loi', 'letter of intent',
  'deal value', 'capex', 'work order', 'purchase order', 'mandate',
  'supply agreement', 'signed', 'obtained', 'bagging',
  'joint venture', 'jv', 'partnership', 'mou', 'memorandum',
  'strategic', 'exclusive',
  'acquisition', 'merger', 'amalgamation', 'stake', 'buyout',
  'fund raising', 'qip', 'rights issue', 'capital raising', 'preferential allotment',
  'appointment', 'resignation', 'ceo', 'cfo', 'managing director',
  'dividend', 'buyback',
];

// ==================== TYPES ====================

interface EnrichedOrder {
  symbol: string;
  company: string;
  date: string;
  orderType: 'Order Win' | 'Contract' | 'Partnership/JV' | 'M&A' | 'Fund Raising' | 'Management Change' | 'LOI' | 'Capex' | 'Other';
  orderValueCr: number | null;
  orderValueUsd: string | null;
  mcapCr: number | null;
  pctOfMcap: number | null;
  annualRevenueCr: number | null;
  pctOfRevenue: number | null;
  client: string | null;
  segment: string | null;
  timeline: string | null;
  impactScore: number;
  signal: 'HIGH' | 'MEDIUM' | 'HIDE';
  sentiment: 'Positive' | 'Neutral' | 'Negative';
  eventSummary: string;
  isWatchlist: boolean;
}

interface EnrichedDeal {
  symbol: string;
  company: string;
  dealDate: string;
  dealType: 'Block' | 'Bulk';
  clientName: string;
  buyOrSell: 'Buy' | 'Sell';
  quantity: number;
  tradePrice: number;
  dealValueCr: number;
  cmp: number | null;
  premiumDiscount: number | null;
  pctEquity: number | null;
  volumeVsAvg: number | null;
  dealScore: number;
  signal: 'HIGH' | 'MEDIUM' | 'HIDE';
  isWatchlist: boolean;
}

interface IntelligenceResponse {
  corporateOrders: EnrichedOrder[];
  deals: EnrichedDeal[];
  summary: {
    totalOrders: number;
    totalDeals: number;
    highSignalOrders: number;
    highSignalDeals: number;
    totalOrderValueCr: number;
    totalDealValueCr: number;
  };
  updatedAt: string;
}

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

// ==================== UTILITY FUNCTIONS ====================

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function getTodayDate(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function parseNSEDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
  }
  const monMatch = dateStr.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (monMatch) {
    const d = new Date(`${monMatch[2]} ${monMatch[1]}, ${monMatch[3]}`);
    if (!isNaN(d.getTime())) return d;
  }
  const ddmmyyyy = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (ddmmyyyy) {
    const d = new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]));
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function parseOrderValue(text: string): number | null {
  if (!text) return null;
  const combined = text.toLowerCase();

  // ₹ Crore
  const crMatch = combined.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:crore|cr)/i);
  if (crMatch) return parseFloat(crMatch[1].replace(/,/g, ''));

  // ₹ Lakh → Cr
  const lMatch = combined.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:lakh|lac|l)\b/i);
  if (lMatch) return parseFloat(lMatch[1].replace(/,/g, '')) / 100;

  // USD Million → Cr
  const usdMnMatch = combined.match(/(?:usd|\$)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn|m)\b/i);
  if (usdMnMatch) {
    const val = parseFloat(usdMnMatch[1].replace(/,/g, ''));
    return (val * INR_TO_USD) / 10;
  }

  // ₹ Million → Cr
  const inrMnMatch = combined.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn|m)\b/i);
  if (inrMnMatch) {
    const val = parseFloat(inrMnMatch[1].replace(/,/g, ''));
    return val / 10;
  }

  // USD Billion → Cr
  const usdBnMatch = combined.match(/(?:usd|\$)\s*([\d,]+(?:\.\d+)?)\s*(?:billion|bn|b)\b/i);
  if (usdBnMatch) {
    const val = parseFloat(usdBnMatch[1].replace(/,/g, ''));
    return (val * INR_TO_USD * 100);
  }

  // ₹ Billion → Cr
  const inrBnMatch = combined.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:billion|bn|b)\b/i);
  if (inrBnMatch) {
    const val = parseFloat(inrBnMatch[1].replace(/,/g, ''));
    return val * 100;
  }

  return null;
}

function classifyOrderType(subject: string, description: string): EnrichedOrder['orderType'] {
  const combined = `${subject} ${description}`.toLowerCase();

  if (combined.includes('acquisition') || combined.includes('merger') || combined.includes('amalgamation')) return 'M&A';
  if (combined.includes('fund raising') || combined.includes('qip') || combined.includes('rights issue')) return 'Fund Raising';
  if (combined.includes('appointment') || combined.includes('resignation') || combined.includes('ceo') || combined.includes('cfo')) return 'Management Change';
  if (combined.includes('letter of intent') || combined.includes('loi')) return 'LOI';
  if (combined.includes('joint venture') || combined.includes('jv') || combined.includes('partnership')) return 'Partnership/JV';
  if (combined.includes('capex') || combined.includes('capital expenditure')) return 'Capex';
  if (combined.includes('contract')) return 'Contract';
  if (combined.includes('order') || combined.includes('awarded')) return 'Order Win';

  return 'Other';
}

function extractClient(text: string): string | null {
  const lower = text.toLowerCase();
  const patterns = [
    /(?:from|by|with|client[:\s]+|awarded by|received from)\s+(?:m\/s\.?\s+)?([A-Z][A-Za-z &.,()]+(?:Ltd|Limited|Corp|Inc|Government|Ministry|Authority|Council|Board|Department|Railway|Defence|NHPC|NTPC|ONGC|BPCL|IOCL|GAIL|SAIL|HAL|BEL|BHEL|NHAI|AAI)[A-Za-z .,()]*)/i,
    /(?:govt\.?\s+of|government of|ministry of)\s+([A-Za-z ]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let client = match[1].trim();
      client = client.replace(/[.,;:]+$/, '').trim();
      if (client.length > 3 && client.length < 100) return client;
    }
  }

  const knownEntities = [
    ['NHAI', 'NHAI'],
    ['Indian Railways', 'Indian Railways'],
    ['Ministry of Defence', 'Ministry of Defence'],
    ['NTPC', 'NTPC'],
    ['ONGC', 'ONGC'],
    ['IOCL', 'IOCL'],
    ['GAIL', 'GAIL'],
    ['HAL', 'HAL'],
    ['BEL', 'BEL'],
    ['BHEL', 'BHEL'],
    ['Coal India', 'Coal India'],
    ['Power Grid', 'Power Grid'],
    ['NHPC', 'NHPC'],
    ['SAIL', 'SAIL'],
  ];

  for (const [keyword, label] of knownEntities) {
    if (lower.includes(keyword.toLowerCase())) return label;
  }

  return null;
}

function extractSegment(text: string): string | null {
  const lower = text.toLowerCase();
  const segmentMap: [string[], string][] = [
    [['defence', 'defense', 'military', 'naval', 'army', 'air force'], 'Defence'],
    [['railway', 'rail', 'metro', 'train'], 'Railways'],
    [['infrastructure', 'road', 'highway', 'bridge', 'tunnel'], 'Infrastructure'],
    [['power', 'energy', 'solar', 'wind', 'renewable'], 'Power & Energy'],
    [['water', 'sewage', 'irrigation'], 'Water'],
    [['oil', 'gas', 'petroleum', 'refinery'], 'Oil & Gas'],
    [['mining', 'coal', 'mineral', 'steel'], 'Mining & Metals'],
    [['telecom', 'network', '5g', 'fiber'], 'Telecom'],
    [['it ', 'software', 'digital', 'cloud', 'ai '], 'IT'],
    [['pharma', 'drug', 'api ', 'healthcare'], 'Pharma'],
  ];

  for (const [keywords, segment] of segmentMap) {
    if (keywords.some(k => lower.includes(k))) return segment;
  }
  return null;
}

function extractTimeline(text: string): string | null {
  const patterns = [
    /(\d+)\s*(?:months?|yrs?|years?)\s*(?:period|timeline|execution|completion)/i,
    /(?:period|timeline|execution|completion)\s*(?:of\s+)?(\d+)\s*(?:months?|yrs?|years?)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1]);
      if (text.toLowerCase().includes('year')) return `${num} year${num > 1 ? 's' : ''}`;
      return `${num} month${num > 1 ? 's' : ''}`;
    }
  }

  if (/multi.?year/i.test(text)) return 'Multi-year';
  if (/long.?term/i.test(text)) return 'Long-term';

  return null;
}

function generateEventSummary(order: EnrichedOrder): string {
  const valuePart = order.orderValueCr ? `₹${order.orderValueCr >= 1000 ? `${(order.orderValueCr / 1000).toFixed(1)}K` : order.orderValueCr.toFixed(0)} Cr` : '';
  const clientPart = order.client ? ` from ${order.client}` : '';
  const segPart = order.segment ? ` (${order.segment})` : '';

  switch (order.orderType) {
    case 'Order Win':
      return `${order.symbol} wins ${valuePart} order${clientPart}${segPart}`.trim().slice(0, 80);
    case 'Contract':
      return `${order.symbol} bags ${valuePart} contract${clientPart}${segPart}`.trim().slice(0, 80);
    case 'Partnership/JV':
      return `${order.symbol} partnership${clientPart}${segPart}`.trim().slice(0, 80);
    case 'M&A':
      return `${order.symbol} announces ${valuePart} acquisition${clientPart}`.trim().slice(0, 80);
    case 'Fund Raising':
      return `${order.symbol} raises ${valuePart} capital`.trim().slice(0, 80);
    default:
      return `${order.symbol} ${order.orderType}`.slice(0, 80);
  }
}

function assessSentiment(orderType: string): 'Positive' | 'Neutral' | 'Negative' {
  if (['Order Win', 'Contract', 'Partnership/JV', 'Fund Raising'].includes(orderType)) return 'Positive';
  return 'Neutral';
}

function calculateOrderImpactScore(order: {
  orderValueCr: number | null;
  annualRevenueCr: number | null;
  orderType: string;
  client: string | null;
  segment: string | null;
}): number {
  let orderSizePctRevenue = 40; // Default higher — most orders are material if they pass keyword filter
  let strategicValue = 50;
  let marginImpact = 50;
  let executionCertainty = 60;

  // Order size % of revenue
  if (order.annualRevenueCr && order.orderValueCr) {
    const pct = (order.orderValueCr / order.annualRevenueCr) * 100;
    if (pct > 10) orderSizePctRevenue = 100;
    else if (pct >= 5) orderSizePctRevenue = 80;
    else if (pct >= 2) orderSizePctRevenue = 60;
    else if (pct >= 1) orderSizePctRevenue = 45;
    else orderSizePctRevenue = 30;
  } else if (order.orderValueCr) {
    // No revenue data — use absolute order value
    if (order.orderValueCr >= 500) orderSizePctRevenue = 90;
    else if (order.orderValueCr >= 100) orderSizePctRevenue = 70;
    else if (order.orderValueCr >= 50) orderSizePctRevenue = 55;
    else if (order.orderValueCr >= 10) orderSizePctRevenue = 45;
    else orderSizePctRevenue = 35;
  }

  // Strategic value
  if (order.client && (order.client.toLowerCase().includes('govt') || order.client.toLowerCase().includes('defence'))) {
    strategicValue = 90;
  } else if (order.segment === 'Defence' || order.segment === 'Railways') {
    strategicValue = 85;
  } else if (order.segment === 'Infrastructure' || order.segment === 'Power & Energy') {
    strategicValue = 70;
  } else if (order.client) {
    strategicValue = 60; // Known client = better
  } else {
    strategicValue = 50;
  }

  // Execution certainty based on order type
  if (order.orderType === 'Order Win' || order.orderType === 'Contract') {
    executionCertainty = 85;
  } else if (order.orderType === 'M&A') {
    executionCertainty = 75;
  } else if (order.orderType === 'Partnership/JV') {
    executionCertainty = 70;
  } else if (order.orderType === 'LOI') {
    executionCertainty = 55;
  } else if (order.orderType === 'Fund Raising') {
    executionCertainty = 65;
  }

  // Formula: (0.35 × orderSizePctRevenue) + (0.25 × strategicValue) + (0.20 × marginImpact) + (0.20 × executionCertainty)
  const score = (0.35 * orderSizePctRevenue) + (0.25 * strategicValue) + (0.20 * marginImpact) + (0.20 * executionCertainty);
  return Math.round(score);
}

function calculateDealScore(deal: {
  clientName: string;
  pctEquity: number | null;
  premiumDiscount: number | null;
}): number {
  let buyerQuality = 30;
  let dealSizePctEquity = 20;
  let pricePremium = 50;

  // Buyer quality — detect institutional patterns
  const buyerLower = deal.clientName.toLowerCase();
  if (/\b(mutual fund|mf|amc|sbi mf|hdfc mf|icici pru|axis mf|kotak mf|nippon|dsp|uti)\b/.test(buyerLower)) {
    buyerQuality = 90;
  } else if (/\b(fii|foreign|dii|institutional|capital group|blackrock|vanguard|goldman|morgan|jp morgan|citadel)\b/.test(buyerLower)) {
    buyerQuality = 90;
  } else if (/\b(promoter|founder|director|chairman|managing)\b/.test(buyerLower)) {
    buyerQuality = 85;
  } else if (/\b(insurance|lic|life insurance|general insurance)\b/.test(buyerLower)) {
    buyerQuality = 75;
  } else if (/\b(pvt|private|ltd|limited|capital|invest|fund|trust|advisors|wealth|asset)\b/.test(buyerLower)) {
    buyerQuality = 60; // Likely institutional/HNI
  } else {
    buyerQuality = 50;
  }

  // Deal size % equity
  if (deal.pctEquity) {
    if (deal.pctEquity > 1) dealSizePctEquity = 100;
    else if (deal.pctEquity >= 0.5) dealSizePctEquity = 70;
    else if (deal.pctEquity >= 0.1) dealSizePctEquity = 40;
    else dealSizePctEquity = 20;
  }

  // Price premium/discount
  if (deal.premiumDiscount) {
    if (deal.premiumDiscount > 2) pricePremium = 80;
    else if (deal.premiumDiscount >= 0) pricePremium = 60;
    else if (deal.premiumDiscount >= -2) pricePremium = 40;
    else pricePremium = 20;
  }

  // Formula: (0.40 × buyerQuality) + (0.30 × dealSizePctEquity) + (0.30 × pricePremium)
  const score = (0.40 * buyerQuality) + (0.30 * dealSizePctEquity) + (0.30 * pricePremium);
  return Math.round(score);
}

// ==================== ENRICHMENT ====================

async function enrichStockData(symbol: string): Promise<StockEnrichment> {
  const result: StockEnrichment = {
    symbol,
    mcapCr: null,
    annualRevenueCr: null,
    companyName: null,
    industry: null,
    lastPrice: null,
    issuedSize: null,
  };

  try {
    // Fetch stock quote for MCap and basic info
    const quote = await fetchStockQuote(symbol);
    if (quote) {
      // Extract lastPrice
      if (quote.priceInfo?.lastPrice) {
        result.lastPrice = quote.priceInfo.lastPrice;
      }

      // Extract issued size
      if (quote.securityInfo?.issuedSize) {
        result.issuedSize = quote.securityInfo.issuedSize;
      }

      // Calculate or extract MCap
      if (quote.priceInfo?.totalMarketCap) {
        result.mcapCr = quote.priceInfo.totalMarketCap / 10000000; // Convert to Crores
      } else if (result.lastPrice && result.issuedSize) {
        result.mcapCr = (result.lastPrice * result.issuedSize) / 10000000;
      }

      // Extract company info
      result.companyName = quote.info?.companyName || null;
      result.industry = quote.info?.industry || null;
    }

    // Fetch earnings data for annual revenue (revenue is already in Crores from screener.in)
    const earningsKey = `earnings:${symbol}`;
    const earnings = await kvGet<EarningsData>(earningsKey);
    if (earnings?.quarters && Array.isArray(earnings.quarters)) {
      const annualRevenue = earnings.quarters
        .slice(0, 4)
        .reduce((sum, q) => sum + (q.revenue || 0), 0);
      if (annualRevenue > 0) {
        result.annualRevenueCr = annualRevenue; // Already in Crores
      }
    }
    // Fallback: use earnings cache mcap if NSE quote didn't provide it
    if (!result.mcapCr && earnings?.mcap) {
      result.mcapCr = earnings.mcap; // Already in Crores from screener
    }
  } catch (e) {
    console.error(`[Intelligence] Error enriching ${symbol}:`, e);
  }

  return result;
}

// ==================== FILTERING & PROCESSING ====================

function filterForOrders(announcements: any[]): any[] {
  if (!announcements?.length) return [];

  return announcements.filter(item => {
    if (!item.symbol || (!item.desc && !item.subject)) return false;
    const combined = `${item.subject || ''} ${item.desc || ''}`.toLowerCase();
    return ORDER_KEYWORDS.some(keyword => combined.includes(keyword));
  });
}

async function enrichCorporateOrders(filteredAnnouncements: any[], enrichmentMap: Map<string, StockEnrichment>, watchlistSet: Set<string>): Promise<EnrichedOrder[]> {
  return filteredAnnouncements
    .map(item => {
      const subject = item.subject || '';
      const description = item.desc || '';
      const symbol = normalizeTicker(item.symbol || '');
      const enrichment = enrichmentMap.get(symbol);

      const orderValueCr = parseOrderValue(`${subject} ${description}`);
      const orderType = classifyOrderType(subject, description);
      const client = extractClient(`${subject} ${description}`);
      const segment = extractSegment(`${subject} ${description}`);
      const timeline = extractTimeline(`${subject} ${description}`);

      const pctOfMcap = enrichment?.mcapCr && orderValueCr ? (orderValueCr / enrichment.mcapCr) * 100 : null;
      const pctOfRevenue = enrichment?.annualRevenueCr && orderValueCr ? (orderValueCr / enrichment.annualRevenueCr) * 100 : null;

      const impactScore = calculateOrderImpactScore({
        orderValueCr,
        annualRevenueCr: enrichment?.annualRevenueCr || null,
        orderType,
        client,
        segment,
      });

      const signal: 'HIGH' | 'MEDIUM' | 'HIDE' = impactScore >= 70 ? 'HIGH' : impactScore >= 40 ? 'MEDIUM' : 'HIDE';

      const order: EnrichedOrder = {
        symbol,
        company: item.companyName || enrichment?.companyName || symbol,
        date: item.date || getTodayDate(),
        orderType,
        orderValueCr,
        orderValueUsd: orderValueCr ? `$${(orderValueCr * 10000000 / INR_TO_USD / 1000000).toFixed(1)}M` : null,
        mcapCr: enrichment?.mcapCr || null,
        pctOfMcap: pctOfMcap ? Math.round(pctOfMcap * 100) / 100 : null,
        annualRevenueCr: enrichment?.annualRevenueCr || null,
        pctOfRevenue: pctOfRevenue ? Math.round(pctOfRevenue * 100) / 100 : null,
        client,
        segment,
        timeline,
        impactScore,
        signal,
        sentiment: assessSentiment(orderType),
        eventSummary: generateEventSummary({} as EnrichedOrder) || `${symbol} ${orderType}`,
        isWatchlist: watchlistSet.has(symbol),
      };

      order.eventSummary = generateEventSummary(order);

      return order;
    })
    .filter(order => order.signal !== 'HIDE');
}

async function enrichBlockBulkDeals(deals: any[], enrichmentMap: Map<string, StockEnrichment>, watchlistSet: Set<string>, dealType: 'Block' | 'Bulk'): Promise<EnrichedDeal[]> {
  return deals
    .map(item => {
      const symbol = normalizeTicker(item.symbol);
      const enrichment = enrichmentMap.get(symbol);

      // Data is already normalized from the fetch step
      const quantity = item.quantity;
      const tradePrice = item.tradePrice;
      const dealValueCr = (quantity * tradePrice) / 10000000;

      const cmp = enrichment?.lastPrice || null;
      const premiumDiscount = cmp && tradePrice ? ((tradePrice - cmp) / cmp) * 100 : null;
      const pctEquity = enrichment?.issuedSize && quantity ? (quantity / enrichment.issuedSize) * 100 : null;

      const clientName = item.clientName || 'Unknown';
      const buyOrSell = (item.buySell || '').toLowerCase().includes('buy') ? 'Buy' : 'Sell';

      const dealScore = calculateDealScore({
        clientName,
        pctEquity: pctEquity || null,
        premiumDiscount: premiumDiscount || null,
      });

      const signal: 'HIGH' | 'MEDIUM' | 'HIDE' = dealScore >= 70 ? 'HIGH' : dealScore >= 40 ? 'MEDIUM' : 'HIDE';

      return {
        symbol,
        company: enrichment?.companyName || symbol,
        dealDate: item.dealDate || getTodayDate(),
        dealType,
        clientName,
        buyOrSell,
        quantity,
        tradePrice,
        dealValueCr: Math.round(dealValueCr * 100) / 100,
        cmp,
        premiumDiscount: premiumDiscount ? Math.round(premiumDiscount * 100) / 100 : null,
        pctEquity: pctEquity ? Math.round(pctEquity * 10000) / 10000 : null,
        volumeVsAvg: null,
        dealScore,
        signal,
        isWatchlist: watchlistSet.has(symbol),
      } as EnrichedDeal;
    })
    .filter(deal => deal.signal !== 'HIDE');
}

// ==================== MAIN HANDLER ====================

export async function GET(request: Request): Promise<NextResponse<IntelligenceResponse>> {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const watchlistParam = searchParams.get('watchlist');
    const days = parseInt(searchParams.get('days') || '30');

    const watchlist = watchlistParam
      ? watchlistParam.split(',').map(s => normalizeTicker(s.trim())).filter(Boolean)
      : [];
    const watchlistSet = new Set(watchlist);

    console.log(`[Intelligence] Fetching corporate announcements for ${watchlist.length} watchlist stocks, last ${days} days`);

    // 1. Fetch corporate announcements
    const fromDate = getDateDaysAgo(days);
    const toDate = getTodayDate();

    let allAnnouncements: any[] = [];

    try {
      const generalData = await nseApiFetch(
        `/api/corporate-announcements?index=equities&from_date=${fromDate}&to_date=${toDate}`,
        300000
      );

      if (generalData) {
        const arr = Array.isArray(generalData) ? generalData : (generalData?.data || []);
        allAnnouncements.push(...arr);
      }
    } catch (e) {
      console.log('[Intelligence] Could not fetch general announcements:', e);
    }

    // 2. Fetch block and bulk deals — normalize to flat objects
    let blockDeals: any[] = [];
    let bulkDeals: any[] = [];

    try {
      const blockData = await nseApiFetch('/api/block-deal', 300000);
      if (blockData) {
        const raw = Array.isArray(blockData) ? blockData : (blockData?.data || []);
        blockDeals = raw.map((d: any) => ({
          symbol: d.symbol || d.BD_SYMBOL || '',
          clientName: d.clientName || d.BD_CLIENT_NAME || '',
          quantity: parseInt(d.quantity || d.BD_QTY_TRD || '0'),
          tradePrice: parseFloat(d.tradePrice || d.BD_TP_WATP || '0'),
          buySell: (d.buySell || d.BD_BUY_SELL || '').trim(),
          dealDate: d.dealDate || d.BD_DT_DATE || '',
        }));
      }
    } catch (e) {
      console.log('[Intelligence] Could not fetch block deals:', e);
    }

    try {
      const bulkData = await nseApiFetch('/api/bulk-deal', 300000);
      if (bulkData) {
        const raw = Array.isArray(bulkData) ? bulkData : (bulkData?.data || []);
        bulkDeals = raw.map((d: any) => ({
          symbol: d.symbol || d.BD_SYMBOL || '',
          clientName: d.clientName || d.BD_CLIENT_NAME || '',
          quantity: parseInt(d.quantity || d.BD_QTY_TRD || '0'),
          tradePrice: parseFloat(d.tradePrice || d.BD_TP_WATP || '0'),
          buySell: (d.buySell || d.BD_BUY_SELL || '').trim(),
          dealDate: d.dealDate || d.BD_DT_DATE || '',
        }));
      }
    } catch (e) {
      console.log('[Intelligence] Could not fetch bulk deals:', e);
    }

    // Filter out deals with zero quantity/price
    blockDeals = blockDeals.filter(d => d.quantity > 0 && d.tradePrice > 0);
    bulkDeals = bulkDeals.filter(d => d.quantity > 0 && d.tradePrice > 0);

    console.log(`[Intelligence] Raw deals: ${blockDeals.length} block, ${bulkDeals.length} bulk`);
    if (blockDeals.length > 0) console.log(`[Intelligence] Sample block deal:`, JSON.stringify(blockDeals[0]));

    // 3. Filter for orders and deals
    const filteredOrders = filterForOrders(allAnnouncements);

    console.log(`[Intelligence] Found ${allAnnouncements.length} total announcements, ${filteredOrders.length} order-related`);
    if (filteredOrders.length > 0) {
      console.log(`[Intelligence] Sample order:`, JSON.stringify({
        symbol: filteredOrders[0].symbol,
        subject: (filteredOrders[0].subject || '').slice(0, 120),
        desc: (filteredOrders[0].desc || '').slice(0, 120),
      }));
    }

    // 4. Collect unique symbols for enrichment — prioritize watchlist + deal symbols, cap at 25
    const prioritySymbols = new Set<string>();
    // Watchlist first
    watchlist.forEach(s => prioritySymbols.add(s));
    // Then deal symbols (fewer, more important)
    blockDeals.forEach(d => prioritySymbols.add(normalizeTicker(d.symbol || d.BD_SYMBOL || '')));
    bulkDeals.forEach(d => prioritySymbols.add(normalizeTicker(d.symbol || d.BD_SYMBOL || '')));
    // Then order symbols (only if still under limit)
    filteredOrders.forEach(o => {
      if (prioritySymbols.size < 25) prioritySymbols.add(normalizeTicker(o.symbol || ''));
    });

    // Remove empty strings
    prioritySymbols.delete('');

    console.log(`[Intelligence] Enriching ${prioritySymbols.size} unique symbols (capped at 25)`);

    // 5. Batch fetch enrichment data with rate limiting
    const enrichmentMap = new Map<string, StockEnrichment>();
    const symbolArray = Array.from(prioritySymbols);
    const batchSize = 3;
    const delayMs = 200;

    for (let i = 0; i < symbolArray.length; i += batchSize) {
      const batch = symbolArray.slice(i, i + batchSize);

      const results = await Promise.all(
        batch.map(sym => enrichStockData(sym))
      );

      for (const result of results) {
        enrichmentMap.set(result.symbol, result);
      }

      if (i + batchSize < symbolArray.length) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    // 6. Enrich orders and deals
    const enrichedOrders = await enrichCorporateOrders(filteredOrders, enrichmentMap, watchlistSet);
    const enrichedBlockDeals = await enrichBlockBulkDeals(blockDeals, enrichmentMap, watchlistSet, 'Block');
    const enrichedBulkDeals = await enrichBlockBulkDeals(bulkDeals, enrichmentMap, watchlistSet, 'Bulk');

    // 7. Deduplicate and sort
    const seenOrders = new Set<string>();
    const uniqueOrders: EnrichedOrder[] = [];

    for (const order of enrichedOrders) {
      const key = `${order.symbol}:${order.date}:${order.orderType}`;
      if (!seenOrders.has(key)) {
        seenOrders.add(key);
        uniqueOrders.push(order);
      }
    }

    uniqueOrders.sort((a, b) => {
      if (a.isWatchlist !== b.isWatchlist) return a.isWatchlist ? -1 : 1;
      return b.impactScore - a.impactScore;
    });

    const seenDeals = new Set<string>();
    const uniqueDeals: EnrichedDeal[] = [];

    for (const deal of [...enrichedBlockDeals, ...enrichedBulkDeals]) {
      const key = `${deal.symbol}:${deal.dealDate}:${deal.dealType}:${deal.clientName}:${deal.buyOrSell}`;
      if (!seenDeals.has(key)) {
        seenDeals.add(key);
        uniqueDeals.push(deal);
      }
    }

    uniqueDeals.sort((a, b) => {
      if (a.isWatchlist !== b.isWatchlist) return a.isWatchlist ? -1 : 1;
      return b.dealScore - a.dealScore;
    });

    // 8. Calculate summary
    const totalOrderValueCr = enrichedOrders.reduce((sum, o) => sum + (o.orderValueCr || 0), 0);
    const totalDealValueCr = uniqueDeals.reduce((sum, d) => sum + d.dealValueCr, 0);

    const response: IntelligenceResponse = {
      corporateOrders: uniqueOrders.slice(0, 10),
      deals: uniqueDeals.slice(0, 10),
      summary: {
        totalOrders: uniqueOrders.length,
        totalDeals: uniqueDeals.length,
        highSignalOrders: uniqueOrders.filter(o => o.signal === 'HIGH').length,
        highSignalDeals: uniqueDeals.filter(d => d.signal === 'HIGH').length,
        totalOrderValueCr: Math.round(totalOrderValueCr),
        totalDealValueCr: Math.round(totalDealValueCr),
      },
      updatedAt: new Date().toISOString(),
    };

    const duration = Date.now() - startTime;
    console.log(`[Intelligence] Success: ${uniqueOrders.length} orders, ${uniqueDeals.length} deals in ${duration}ms`);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Intelligence] Fatal error after ${duration}ms:`, error);

    return NextResponse.json({
      corporateOrders: [],
      deals: [],
      summary: {
        totalOrders: 0,
        totalDeals: 0,
        highSignalOrders: 0,
        highSignalDeals: 0,
        totalOrderValueCr: 0,
        totalDealValueCr: 0,
      },
      updatedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}
