import { NextResponse } from 'next/server';
import { nseApiFetch, fetchStockQuote } from '@/lib/nse';
import { normalizeTicker } from '@/lib/tickers';
import { kvGet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

const INR_TO_USD = 85;

// ==================== TYPES ====================

type ActionFlag = 'BUY WATCH' | 'HOLD CONTEXT' | 'IGNORE';
type ImpactType = 'Revenue Impact' | 'Margin Impact' | 'Sentiment Only' | 'Noise';

interface IntelSignal {
  symbol: string;
  company: string;
  date: string;
  source: 'order' | 'deal';

  // Event
  eventType: string;       // Order Win, Contract, Block Buy, Bulk Sell, M&A, etc.
  headline: string;        // 1-line: "LT ₹4,200Cr Infra order from NHAI | 3.2% Rev"

  // Quantified
  valueCr: number | null;
  valueUsd: string | null;
  mcapCr: number | null;
  revenueCr: number | null;
  pctRevenue: number | null;   // THE key metric
  pctMcap: number | null;

  // Context
  client: string | null;
  segment: string | null;
  timeline: string | null;
  buyerSeller: string | null;  // For deals
  premiumDiscount: number | null; // For deals

  // Classification
  impactType: ImpactType;
  action: ActionFlag;
  score: number;           // 0-100, for sorting
  sentiment: 'Bullish' | 'Neutral' | 'Bearish';

  isWatchlist: boolean;
}

interface DailyBias {
  netBias: 'Bullish' | 'Neutral' | 'Bearish';
  highImpactCount: number;
  activeSectors: string[];
  buyWatchCount: number;
  totalSignals: number;
  totalOrderValueCr: number;
  totalDealValueCr: number;
  summary: string; // "3 High Impact signals in Infra, Capital Goods. Net: Bullish"
}

interface IntelligenceResponse {
  top3: IntelSignal[];          // THE hero section
  signals: IntelSignal[];       // Full filtered table
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

// ==================== IMPACT & ACTION CLASSIFICATION ====================

function classifyImpact(pctRevenue: number | null, pctMcap: number | null, valueCr: number | null, eventType: string): ImpactType {
  // If we have % revenue, use it — this is the gold standard
  if (pctRevenue !== null) {
    if (pctRevenue >= 3) return 'Revenue Impact';
    if (pctRevenue >= 1) return 'Revenue Impact';
    if (pctRevenue >= 0.5) return 'Margin Impact';
    return 'Sentiment Only';
  }

  // % of MCap — for capex/M&A where revenue impact isn't relevant
  if (pctMcap !== null) {
    if (pctMcap >= 5) return 'Revenue Impact';
    if (pctMcap >= 1) return 'Margin Impact';
    return 'Sentiment Only';
  }

  // No percentage data — use absolute value + event type
  if (valueCr !== null) {
    if (valueCr >= 500) return 'Revenue Impact';
    if (valueCr >= 100) return 'Margin Impact';
    return 'Sentiment Only';
  }

  // No value at all — use event type heuristic
  if (['M&A', 'Capex/Expansion', 'Fund Raising', 'Demerger'].includes(eventType)) return 'Margin Impact';
  if (['Buyback', 'JV/Partnership', 'Guidance'].includes(eventType)) return 'Margin Impact';
  if (['Mgmt Change', 'Dividend'].includes(eventType)) return 'Sentiment Only';

  return 'Sentiment Only';
}

function classifyAction(impactType: ImpactType, pctRevenue: number | null, pctMcap: number | null, eventType: string, isWatchlist: boolean): ActionFlag {
  if (impactType === 'Revenue Impact') {
    if (pctRevenue !== null && pctRevenue >= 3) return 'BUY WATCH';
    if (pctMcap !== null && pctMcap >= 5) return 'BUY WATCH';
    return 'HOLD CONTEXT';
  }
  if (impactType === 'Margin Impact') {
    if (['Capex/Expansion', 'M&A', 'Demerger'].includes(eventType)) return 'HOLD CONTEXT';
    if (['Guidance'].includes(eventType)) return 'HOLD CONTEXT';
    return 'HOLD CONTEXT';
  }
  // Sentiment Only — still worth watching if on watchlist
  if (isWatchlist) return 'HOLD CONTEXT';
  return 'IGNORE';
}

function computeScore(opts: {
  pctRevenue: number | null;
  valueCr: number | null;
  impactType: ImpactType;
  eventType: string;
  client: string | null;
  segment: string | null;
  isWatchlist: boolean;
  isDeal: boolean;
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
    // Absolute value without revenue context
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

  // Watchlist bonus (0-10)
  if (opts.isWatchlist) score += 10;

  // Deal-specific
  if (opts.isDeal) {
    if (opts.buyerQuality && opts.buyerQuality >= 80) score += 10;
    if (opts.dealPremiumDiscount !== undefined && opts.dealPremiumDiscount !== null) {
      if (opts.dealPremiumDiscount > 3) score += 8; // Big premium = conviction
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
    const days = parseInt(searchParams.get('days') || '30');

    const watchlist = watchlistParam
      ? watchlistParam.split(',').map(s => normalizeTicker(s.trim())).filter(Boolean)
      : [];
    const watchlistSet = new Set(watchlist);

    console.log(`[Intelligence] Starting: ${watchlist.length} watchlist, ${days} days`);

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

    // Filter announcements for material events
    const filteredAnn = announcements.filter(item => {
      if (!item.symbol || (!item.desc && !item.subject)) return false;
      const combined = `${item.subject || ''} ${item.desc || ''}`.toLowerCase();
      // Skip noise
      if (NOISE_PATTERNS.some(p => combined.includes(p))) return false;
      return ORDER_KEYWORDS.some(k => combined.includes(k));
    });

    console.log(`[Intelligence] ${announcements.length} announcements → ${filteredAnn.length} material | ${blockDeals.length} block, ${bulkDeals.length} bulk deals`);

    // ── 2. Collect symbols for enrichment (capped at 25) ──
    const symbolsToEnrich = new Set<string>();
    watchlist.forEach(s => symbolsToEnrich.add(s));
    [...blockDeals, ...bulkDeals].forEach(d => symbolsToEnrich.add(normalizeTicker(d.symbol)));
    filteredAnn.forEach(a => { if (symbolsToEnrich.size < 25) symbolsToEnrich.add(normalizeTicker(a.symbol)); });
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
    const seenKeys = new Set<string>();

    for (const item of filteredAnn) {
      const subject = item.subject || '';
      const desc = item.desc || '';
      const symbol = normalizeTicker(item.symbol || '');
      if (!symbol) continue;

      const key = `${symbol}:${(subject + desc).slice(0, 60)}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const enrichment = enrichMap.get(symbol);
      const combinedText = `${subject} ${desc}`;
      const valueCr = parseOrderValue(combinedText);
      const eventType = classifyOrderType(subject, desc);
      const client = extractClient(combinedText);
      const segment = extractSegment(combinedText) || (enrichment?.industry ? enrichment.industry.split(' ')[0] : null);
      const timeline = extractTimeline(combinedText);
      const isWatchlist = watchlistSet.has(symbol);

      const pctRevenue = (enrichment?.annualRevenueCr && valueCr)
        ? Math.round((valueCr / enrichment.annualRevenueCr) * 10000) / 100
        : null;
      const pctMcap = (enrichment?.mcapCr && valueCr)
        ? Math.round((valueCr / enrichment.mcapCr) * 10000) / 100
        : null;

      const impactType = classifyImpact(pctRevenue, pctMcap, valueCr, eventType);
      const action = classifyAction(impactType, pctRevenue, pctMcap, eventType, isWatchlist);
      const score = computeScore({
        pctRevenue, valueCr, impactType, eventType,
        client, segment, isWatchlist, isDeal: false,
      });

      // Build institutional-grade headline: WHY this matters
      let headline = '';
      // Lead with event + value
      if (valueCr && valueCr > 0) {
        headline = `${fmtCr(valueCr)} ${eventType}`;
      } else {
        headline = eventType;
      }
      if (client) headline += ` from ${client}`;
      // Materiality context — the key institutional metric
      const matParts: string[] = [];
      if (pctRevenue !== null && pctRevenue > 0) matParts.push(`${pctRevenue.toFixed(1)}% of annual revenue`);
      if (pctMcap !== null && pctMcap > 0) matParts.push(`${pctMcap.toFixed(1)}% of MCap`);
      if (segment) matParts.push(segment);
      if (timeline) matParts.push(timeline);
      if (matParts.length > 0) headline += ` — ${matParts.join(' · ')}`;
      // Add source context from desc
      const descSnippet = (desc || '').slice(0, 120).replace(/\s+/g, ' ').trim();
      if (descSnippet && descSnippet.length > 20 && !headline.includes(descSnippet.slice(0, 30))) {
        headline += `. ${descSnippet}`;
      }

      const sentiment = action === 'BUY WATCH' ? 'Bullish' as const :
                        action === 'IGNORE' ? 'Neutral' as const : 'Neutral' as const;

      allSignals.push({
        symbol, company: item.companyName || enrichment?.companyName || symbol,
        date: item.date || getTodayDate(), source: 'order',
        eventType, headline,
        valueCr, valueUsd: valueCr ? `$${((valueCr * 10000000) / INR_TO_USD / 1000000).toFixed(1)}M` : null,
        mcapCr: enrichment?.mcapCr || null, revenueCr: enrichment?.annualRevenueCr || null,
        pctRevenue, pctMcap,
        client, segment, timeline,
        buyerSeller: null, premiumDiscount: null,
        impactType, action, score, sentiment, isWatchlist,
      });
    }

    // ── 4. Build signals from deals ──
    for (const deal of [...blockDeals, ...bulkDeals]) {
      const symbol = normalizeTicker(deal.symbol);
      if (!symbol) continue;

      const dealKey = `${symbol}:${deal.type}:${deal.clientName}:${deal.buySell}`;
      if (seenKeys.has(dealKey)) continue;
      seenKeys.add(dealKey);

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

      // For deals, impact is about institutional conviction, not revenue
      const impactType: ImpactType = buyerQual >= 80 ? 'Revenue Impact' :
                                     buyerQual >= 60 ? 'Margin Impact' : 'Sentiment Only';
      const action: ActionFlag = (buyerQual >= 80 && isBuy && dealValueCr >= 1) ? 'BUY WATCH' :
                                 (buyerQual >= 60 || isWatchlist) ? 'HOLD CONTEXT' : 'IGNORE';

      const score = computeScore({
        pctRevenue: null, valueCr: dealValueCr, impactType, eventType,
        client: null, segment: null, isWatchlist, isDeal: true,
        dealPremiumDiscount: premiumDiscount, buyerQuality: buyerQual,
      });

      // Headline
      let headline = `${symbol} ${deal.type} ${isBuy ? '▲' : '▼'} ${fmtCr(dealValueCr)}`;
      headline += ` | ${deal.clientName.slice(0, 30)}`;
      if (premiumDiscount !== null) {
        headline += ` | ${premiumDiscount > 0 ? '+' : ''}${premiumDiscount.toFixed(1)}%`;
      }
      if (pctEquity !== null && pctEquity > 0.01) {
        headline += ` | ${pctEquity.toFixed(2)}% eq`;
      }

      allSignals.push({
        symbol, company: enrichment?.companyName || symbol,
        date: deal.dealDate || getTodayDate(), source: 'deal',
        eventType, headline,
        valueCr: dealValueCr, valueUsd: null,
        mcapCr: enrichment?.mcapCr || null, revenueCr: enrichment?.annualRevenueCr || null,
        pctRevenue: null, pctMcap: null,
        client: null, segment: enrichment?.industry || null, timeline: null,
        buyerSeller: deal.clientName, premiumDiscount,
        impactType, action, score,
        sentiment: isBuy ? 'Bullish' as const : 'Bearish' as const,
        isWatchlist,
      });
    }

    // ── 5. Filter, sort, classify ──
    // Remove IGNORE unless it's watchlist
    const filtered = allSignals
      .filter(s => s.action !== 'IGNORE' || s.isWatchlist)
      .sort((a, b) => {
        // BUY WATCH first, then HOLD, then IGNORE
        const actionRank = { 'BUY WATCH': 0, 'HOLD CONTEXT': 1, 'IGNORE': 2 };
        const ar = actionRank[a.action] - actionRank[b.action];
        if (ar !== 0) return ar;
        // Then by score
        return b.score - a.score;
      });

    // Top 3 = highest scoring non-IGNORE signals
    const top3 = filtered.filter(s => s.action !== 'IGNORE').slice(0, 3);

    // ── 6. Build daily bias ──
    const sectorSet = new Set<string>();
    let totalOrderValueCr = 0;
    let totalDealValueCr = 0;
    let buyWatchCount = 0;
    let highImpactCount = 0;
    let bullishCount = 0;
    let bearishCount = 0;

    for (const s of filtered) {
      if (s.segment) sectorSet.add(s.segment);
      if (s.source === 'order' && s.valueCr) totalOrderValueCr += s.valueCr;
      if (s.source === 'deal' && s.valueCr) totalDealValueCr += s.valueCr;
      if (s.action === 'BUY WATCH') buyWatchCount++;
      if (s.impactType === 'Revenue Impact') highImpactCount++;
      if (s.sentiment === 'Bullish') bullishCount++;
      if (s.sentiment === 'Bearish') bearishCount++;
    }

    const netBias: DailyBias['netBias'] = bullishCount > bearishCount + 2 ? 'Bullish' :
                                           bearishCount > bullishCount + 2 ? 'Bearish' : 'Neutral';
    const activeSectors = Array.from(sectorSet).slice(0, 5);

    const biasStr = highImpactCount > 0
      ? `${highImpactCount} High Impact signal${highImpactCount > 1 ? 's' : ''} in ${activeSectors.slice(0, 3).join(', ')}. Net: ${netBias}`
      : `${filtered.length} signals. Sectors: ${activeSectors.slice(0, 3).join(', ') || 'Mixed'}. Net: ${netBias}`;

    const bias: DailyBias = {
      netBias, highImpactCount, activeSectors, buyWatchCount,
      totalSignals: filtered.length,
      totalOrderValueCr: Math.round(totalOrderValueCr),
      totalDealValueCr: Math.round(totalDealValueCr),
      summary: biasStr,
    };

    const response: IntelligenceResponse = {
      top3,
      signals: filtered.slice(0, 15), // Max 15
      bias,
      updatedAt: new Date().toISOString(),
    };

    const duration = Date.now() - startTime;
    console.log(`[Intelligence] Done: ${filtered.length} signals, ${top3.length} top3, bias=${netBias} in ${duration}ms`);

    return NextResponse.json(response);
  } catch (error) {
    console.error(`[Intelligence] Fatal error:`, error);
    return NextResponse.json({
      top3: [],
      signals: [],
      bias: {
        netBias: 'Neutral' as const,
        highImpactCount: 0, activeSectors: [], buyWatchCount: 0,
        totalSignals: 0, totalOrderValueCr: 0, totalDealValueCr: 0,
        summary: 'Error fetching intelligence',
      },
      updatedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}
