import { NextResponse } from 'next/server';
import { nseApiFetch } from '@/lib/nse';
import { normalizeTicker } from '@/lib/tickers';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// Keywords to detect material corporate events (orders, deals, M&A, fund raising, mgmt changes)
const ORDER_KEYWORDS = [
  // Orders & Contracts
  'order', 'contract', 'awarded', 'loi', 'letter of intent',
  'deal value', 'capex', 'work order', 'purchase order', 'mandate',
  'supply agreement', 'signed', 'obtained', 'bagging',
  // Strategic
  'joint venture', 'jv', 'partnership', 'mou', 'memorandum',
  'strategic', 'exclusive',
  // M&A
  'acquisition', 'merger', 'amalgamation', 'stake', 'buyout',
  // Fund Raising
  'fund raising', 'qip', 'rights issue', 'capital raising', 'preferential allotment',
  // Management
  'appointment', 'resignation', 'ceo', 'cfo', 'managing director',
  // Financial
  'dividend', 'buyback',
];

interface CorporateOrder {
  symbol: string;
  company: string;
  subject: string;
  description: string;
  date: string;
  orderType: 'Order Win' | 'Contract' | 'Partnership/JV' | 'Capex' | 'LOI' | 'M&A' | 'Fund Raising' | 'Management Change' | 'Other';
  importance: 'HIGH' | 'MEDIUM' | 'LOW';
  importanceScore: number; // Raw points score for ranking
  orderValue: number | null; // in Crores, if parseable
  isWatchlist: boolean;
  nseUrl: string;

  // ── Enriched Analysis Fields ──
  analysis: {
    eventSummary: string;       // 1-line human-readable summary (<80 chars)
    client: string | null;      // Extracted client/counterparty name
    segment: string | null;     // Business segment (Infrastructure, IT, Defence, etc.)
    timeline: string | null;    // Execution period if mentioned
    revenueImpact: 'High' | 'Medium' | 'Low' | null;
    marginImpact: 'Accretive' | 'Dilutive' | 'Neutral' | null;
    strategicNote: string | null; // Why it matters (1 line)
    sentiment: 'Positive' | 'Neutral' | 'Negative';
    confidence: 'High' | 'Medium' | 'Low';
  };
}

interface CorporateOrdersResponse {
  orders: CorporateOrder[];
  summary: {
    total: number;
    high: number;
    medium: number;
    orderWins: number;
    contracts: number;
    partnerships: number;
    watchlistHits: number;
    totalOrderValue: number; // Sum of all parsed order values (Cr)
  };
  updatedAt: string;
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function getTodayDate(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

/** Robust date parser for NSE dates (DD-Mon-YYYY, DD-MM-YYYY, YYYY-MM-DD, etc.) */
function parseNSEDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
  }
  // DD-Mon-YYYY (e.g. "31-Mar-2026 09:15")
  const monMatch = dateStr.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (monMatch) {
    const d = new Date(`${monMatch[2]} ${monMatch[1]}, ${monMatch[3]}`);
    if (!isNaN(d.getTime())) return d;
  }
  // DD-MM-YYYY
  const ddmmyyyy = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (ddmmyyyy) {
    const d = new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]));
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Classify announcement based on keywords
 */
function classifyOrderType(subject: string, description: string): 'Order Win' | 'Contract' | 'Partnership/JV' | 'Capex' | 'LOI' | 'Other' {
  const combined = `${subject} ${description}`.toLowerCase();

  if (combined.includes('letter of intent') || combined.includes('loi')) return 'LOI';
  if (combined.includes('joint venture') || combined.includes('jv') || combined.includes('partnership')) return 'Partnership/JV';
  if (combined.includes('capex') || combined.includes('capital expenditure')) return 'Capex';
  if (combined.includes('contract')) return 'Contract';
  if (combined.includes('order') || combined.includes('awarded')) return 'Order Win';

  return 'Other';
}

/**
 * Parse order value from description (in Crores)
 * Looks for patterns like "Rs. 500 crore", "₹1,200 Cr", "INR 50 Mn" etc.
 */
function parseOrderValue(text: string): number | null {
  if (!text) return null;
  const combined = text.toLowerCase();

  // Pattern: Rs/₹/INR followed by number and unit
  const crMatch = combined.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:crore|cr)/i);
  if (crMatch) return parseFloat(crMatch[1].replace(/,/g, ''));

  const lMatch = combined.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:lakh|lac|l)\b/i);
  if (lMatch) return parseFloat(lMatch[1].replace(/,/g, '')) / 100; // Convert lakh to Cr

  // USD million — e.g. "USD 100M deal", "$50 million"
  const usdMnMatch = combined.match(/(?:usd|\$)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn|m)\b/i);
  if (usdMnMatch) {
    const val = parseFloat(usdMnMatch[1].replace(/,/g, ''));
    return val * 8.5; // ~85 INR/USD, then /10 for Cr
  }

  // INR million — e.g. "Rs. 500 million"
  const inrMnMatch = combined.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn|m)\b/i);
  if (inrMnMatch) {
    const val = parseFloat(inrMnMatch[1].replace(/,/g, ''));
    return val / 10; // INR million to Cr
  }

  // USD billion — e.g. "USD 2 Bn"
  const usdBnMatch = combined.match(/(?:usd|\$)\s*([\d,]+(?:\.\d+)?)\s*(?:billion|bn|b)\b/i);
  if (usdBnMatch) {
    const val = parseFloat(usdBnMatch[1].replace(/,/g, ''));
    return val * 8500; // ~85 INR/USD * 100 for Cr
  }

  // INR billion — e.g. "Rs. 10 Bn"
  const inrBnMatch = combined.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:billion|bn|b)\b/i);
  if (inrBnMatch) {
    const val = parseFloat(inrBnMatch[1].replace(/,/g, ''));
    return val * 100; // INR billion to Cr
  }

  // Plain USD with no unit — e.g. "USD 500" (assume millions if > 1)
  const plainUsdMatch = combined.match(/(?:usd|\$)\s*([\d,]+(?:\.\d+)?)\b/i);
  if (plainUsdMatch) {
    const val = parseFloat(plainUsdMatch[1].replace(/,/g, ''));
    if (val >= 1000) return val * 0.085; // Likely in millions already (USD to Cr)
  }

  return null;
}

/**
 * HYBRID IMPORTANCE SCORING
 * Score = f(value, keywords, deal characteristics)
 * Uses a points-based system for nuanced classification:
 *   - Order value (if parseable): 0-50 points
 *   - Strategic keywords: 0-30 points
 *   - Business keywords: 0-20 points
 *   - Noise keywords: negative points
 *
 * Final: HIGH ≥ 40pts, MEDIUM ≥ 20pts, LOW < 20pts
 */
function calculateImportance(subject: string, description: string): 'HIGH' | 'MEDIUM' | 'LOW' {
  const combined = `${subject} ${description}`.toLowerCase();
  let score = 0;

  // ── Layer 1: Order Value (0-50 points) ──
  const orderValue = parseOrderValue(combined);
  if (orderValue !== null) {
    if (orderValue >= 500) score += 50;       // ₹500 Cr+ = massive
    else if (orderValue >= 100) score += 40;  // ₹100 Cr+ = large
    else if (orderValue >= 50) score += 30;   // ₹50 Cr+
    else if (orderValue >= 10) score += 20;   // ₹10 Cr+
    else score += 5;                           // Small but quantified
  }

  // ── Layer 2: Strategic Keywords (0-30 points) ──
  const strategicHigh: [string, number][] = [
    ['strategic', 15],
    ['multi-year', 15],
    ['multi year', 15],
    ['defence', 15],
    ['defense', 15],
    ['exclusive', 12],
    ['large order', 12],
    ['bagging/receiving of orders', 12],
    ['awarded', 10],
    ['secured', 10],
    ['won', 8],
    ['government', 10],
    ['railway', 10],
    ['export order', 10],
    ['international', 8],
    ['acquisition', 10],
    ['repeat order', 8],
    ['follow-on', 8],
    ['rate contract', 8],
  ];

  let strategicScore = 0;
  for (const [keyword, points] of strategicHigh) {
    if (combined.includes(keyword)) {
      strategicScore += points;
    }
  }
  score += Math.min(strategicScore, 30); // Cap at 30

  // ── Layer 3: Business Keywords (0-20 points) ──
  const businessKeywords: [string, number][] = [
    ['order', 8],
    ['contract', 8],
    ['loi', 6],
    ['letter of intent', 6],
    ['partnership', 6],
    ['jv', 5],
    ['joint venture', 6],
    ['supply', 5],
    ['mandate', 5],
    ['work order', 8],
    ['purchase order', 8],
    ['deal', 6],
  ];

  let businessScore = 0;
  for (const [keyword, points] of businessKeywords) {
    if (combined.includes(keyword)) {
      businessScore += points;
    }
  }
  score += Math.min(businessScore, 20); // Cap at 20

  // ── Layer 4: Noise / Negative Signals ──
  const noiseKeywords: [string, number][] = [
    ['rumour verification', -15],
    ['regulation 30', -10],
    ['action(s) taken', -8],
    ['action(s) initiated', -8],
    ['clarification', -5],
    ['disclosure', -3],
    ['update', -2],
    ['amendment', -3],
    ['addendum', -3],
  ];

  for (const [keyword, penalty] of noiseKeywords) {
    if (combined.includes(keyword)) {
      score += penalty; // negative
    }
  }

  // ── Layer 5: Undisclosed value signals ──
  // If no numeric value found but strong contextual clues
  if (orderValue === null) {
    if (combined.includes('undisclosed') || combined.includes('significant')) score += 8;
    if (combined.includes('crore') || combined.includes('million') || combined.includes('billion')) score += 5;
  }

  // ── Final Classification ──
  if (score >= 40) return 'HIGH';
  if (score >= 20) return 'MEDIUM';
  return 'LOW';
}

/** Same as calculateImportance but also returns the raw score for ranking */
function calculateImportanceWithScore(subject: string, description: string): { importance: 'HIGH' | 'MEDIUM' | 'LOW'; score: number } {
  const combined = `${subject} ${description}`.toLowerCase();
  let score = 0;

  const orderValue = parseOrderValue(combined);
  if (orderValue !== null) {
    if (orderValue >= 500) score += 50;
    else if (orderValue >= 100) score += 40;
    else if (orderValue >= 50) score += 30;
    else if (orderValue >= 10) score += 20;
    else score += 5;
  }

  const strategicHigh: [string, number][] = [
    ['strategic', 15], ['multi-year', 15], ['multi year', 15],
    ['defence', 15], ['defense', 15], ['exclusive', 12],
    ['large order', 12], ['bagging/receiving of orders', 12],
    ['awarded', 10], ['secured', 10], ['won', 8],
    ['government', 10], ['railway', 10], ['export order', 10],
    ['international', 8], ['acquisition', 10], ['repeat order', 8],
    ['follow-on', 8], ['rate contract', 8],
  ];
  let strategicScore = 0;
  for (const [keyword, points] of strategicHigh) {
    if (combined.includes(keyword)) strategicScore += points;
  }
  score += Math.min(strategicScore, 30);

  const businessKeywords: [string, number][] = [
    ['order', 8], ['contract', 8], ['loi', 6], ['letter of intent', 6],
    ['partnership', 6], ['jv', 5], ['joint venture', 6], ['supply', 5],
    ['mandate', 5], ['work order', 8], ['purchase order', 8], ['deal', 6],
  ];
  let businessScore = 0;
  for (const [keyword, points] of businessKeywords) {
    if (combined.includes(keyword)) businessScore += points;
  }
  score += Math.min(businessScore, 20);

  const noiseKeywords: [string, number][] = [
    ['rumour verification', -15], ['regulation 30', -10],
    ['action(s) taken', -8], ['action(s) initiated', -8],
    ['clarification', -5], ['disclosure', -3], ['update', -2],
    ['amendment', -3], ['addendum', -3],
  ];
  for (const [keyword, penalty] of noiseKeywords) {
    if (combined.includes(keyword)) score += penalty;
  }

  if (orderValue === null) {
    if (combined.includes('undisclosed') || combined.includes('significant')) score += 8;
    if (combined.includes('crore') || combined.includes('million') || combined.includes('billion')) score += 5;
  }

  const importance: 'HIGH' | 'MEDIUM' | 'LOW' = score >= 40 ? 'HIGH' : score >= 20 ? 'MEDIUM' : 'LOW';
  return { importance, score };
}

// ── Enrichment: Extract structured analysis from raw text ──

function extractClient(text: string): string | null {
  const lower = text.toLowerCase();
  // Look for "from <client>", "by <client>", "with <client>", "client: <x>"
  const patterns = [
    /(?:from|by|with|client[:\s]+|awarded by|received from)\s+(?:m\/s\.?\s+)?([A-Z][A-Za-z &.,()]+(?:Ltd|Limited|Corp|Inc|Government|Ministry|Authority|Council|Board|Department|Railway|Defence|NHPC|NTPC|ONGC|BPCL|IOCL|GAIL|SAIL|HAL|BEL|BHEL|NHAI|AAI)[A-Za-z .,()]*)/i,
    /(?:govt\.?\s+of|government of|ministry of)\s+([A-Za-z ]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let client = match[1].trim();
      // Clean up trailing punctuation
      client = client.replace(/[.,;:]+$/, '').trim();
      if (client.length > 3 && client.length < 100) return client;
    }
  }

  // Check for known entities
  const knownEntities = [
    ['NHAI', 'NHAI (National Highways Authority)'],
    ['Indian Railways', 'Indian Railways'],
    ['Ministry of Defence', 'Ministry of Defence'],
    ['NTPC', 'NTPC Limited'],
    ['ONGC', 'ONGC'],
    ['IOCL', 'Indian Oil Corporation'],
    ['GAIL', 'GAIL India'],
    ['BPCL', 'Bharat Petroleum'],
    ['HAL', 'Hindustan Aeronautics'],
    ['BEL', 'Bharat Electronics'],
    ['BHEL', 'BHEL'],
    ['Coal India', 'Coal India Limited'],
    ['Power Grid', 'Power Grid Corporation'],
    ['NHPC', 'NHPC Limited'],
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
    [['power', 'energy', 'solar', 'wind', 'renewable', 'transmission'], 'Power & Energy'],
    [['water', 'sewage', 'irrigation', 'desalination'], 'Water Infrastructure'],
    [['oil', 'gas', 'petroleum', 'refinery', 'pipeline'], 'Oil & Gas'],
    [['mining', 'coal', 'mineral', 'steel'], 'Mining & Metals'],
    [['telecom', 'network', '5g', 'fiber', 'broadband'], 'Telecom'],
    [['it ', 'software', 'digital', 'cloud', 'ai ', 'data center'], 'IT & Digital'],
    [['pharma', 'drug', 'api ', 'formulation', 'healthcare'], 'Pharma & Healthcare'],
    [['real estate', 'housing', 'residential', 'commercial building'], 'Real Estate'],
    [['auto', 'vehicle', 'ev ', 'electric vehicle', 'battery'], 'Automotive'],
    [['chemical', 'specialty chemical'], 'Chemicals'],
    [['cement', 'construction material'], 'Cement & Building'],
    [['textile', 'garment', 'apparel'], 'Textiles'],
    [['export', 'international', 'overseas', 'global'], 'Exports'],
  ];

  for (const [keywords, segment] of segmentMap) {
    if (keywords.some(k => lower.includes(k))) return segment;
  }
  return null;
}

function extractTimeline(text: string): string | null {
  const patterns = [
    /(\d+)\s*(?:months?|yrs?|years?)\s*(?:period|timeline|execution|completion|duration)/i,
    /(?:period|timeline|execution|completion|duration)\s*(?:of\s+)?(\d+)\s*(?:months?|yrs?|years?)/i,
    /(?:complete|deliver|execute)\s*(?:within|in|over)\s*(\d+)\s*(?:months?|yrs?|years?)/i,
    /(\d+)\s*(?:-|to)\s*(\d+)\s*(?:months?|yrs?|years?)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      if (match[2]) return `${match[1]}-${match[2]} months`;
      const num = parseInt(match[1]);
      if (text.toLowerCase().includes('year')) return `${num} year${num > 1 ? 's' : ''}`;
      return `${num} month${num > 1 ? 's' : ''}`;
    }
  }

  // Look for "multi-year", "long-term"
  if (/multi.?year/i.test(text)) return 'Multi-year';
  if (/long.?term/i.test(text)) return 'Long-term';

  return null;
}

function generateEventSummary(order: { symbol: string; orderType: string; orderValue: number | null; subject: string; client: string | null; segment: string | null }): string {
  const valuePart = order.orderValue ? `₹${order.orderValue >= 1000 ? `${(order.orderValue / 1000).toFixed(1)}K` : order.orderValue.toFixed(0)} Cr` : '';
  const clientPart = order.client ? ` from ${order.client}` : '';
  const segPart = order.segment ? ` (${order.segment})` : '';

  switch (order.orderType) {
    case 'Order Win':
      return `${order.symbol} wins ${valuePart} order${clientPart}${segPart}`.trim();
    case 'Contract':
      return `${order.symbol} bags ${valuePart} contract${clientPart}${segPart}`.trim();
    case 'Partnership/JV':
      return `${order.symbol} enters partnership${clientPart}${segPart}`.trim();
    case 'M&A':
      return `${order.symbol} announces ${valuePart} acquisition${clientPart}`.trim();
    case 'Fund Raising':
      return `${order.symbol} raises ${valuePart} capital`.trim();
    case 'Management Change':
      return `${order.symbol} management change${clientPart}`.trim();
    default:
      return order.subject.length > 80 ? order.subject.slice(0, 77) + '...' : order.subject;
  }
}

function assessRevenueImpact(orderValue: number | null, text: string): 'High' | 'Medium' | 'Low' | null {
  if (orderValue === null) return null;
  // Without knowing company revenue, use absolute thresholds
  if (orderValue >= 500) return 'High';
  if (orderValue >= 100) return 'Medium';
  return 'Low';
}

function assessMarginImpact(text: string): 'Accretive' | 'Dilutive' | 'Neutral' | null {
  const lower = text.toLowerCase();
  if (/margin.?accretive|higher.?margin|premium|profit/i.test(lower)) return 'Accretive';
  if (/margin.?dilutive|loss.?making|low.?margin|competitive.?bid/i.test(lower)) return 'Dilutive';
  if (/margin.?neutral|normal.?margin/i.test(lower)) return 'Neutral';
  return null; // Unknown
}

function assessSentiment(importance: string, orderType: string): 'Positive' | 'Neutral' | 'Negative' {
  if (importance === 'HIGH') return 'Positive';
  if (['Order Win', 'Contract', 'Partnership/JV'].includes(orderType)) return 'Positive';
  return 'Neutral';
}

function assessConfidence(orderValue: number | null, text: string): 'High' | 'Medium' | 'Low' {
  // High confidence: has specific value + known client + clear deal type
  if (orderValue !== null && orderValue > 0) return 'High';
  if (/awarded|secured|signed|executed|confirmed/i.test(text)) return 'High';
  if (/loi|letter of intent|proposed|expected|likely/i.test(text)) return 'Low';
  return 'Medium';
}

function generateStrategicNote(orderType: string, orderValue: number | null, segment: string | null, text: string): string | null {
  const lower = text.toLowerCase();
  const notes: string[] = [];

  if (orderValue && orderValue >= 500) notes.push('Large-cap order boosts revenue visibility');
  if (/repeat|follow.on|additional/i.test(lower)) notes.push('Repeat order signals client satisfaction');
  if (/government|govt|psu|ministry/i.test(lower)) notes.push('Government order — high execution certainty');
  if (/defence|defense|military/i.test(lower)) notes.push('Defence order — long execution, strong margins');
  if (/export|international|global/i.test(lower)) notes.push('Export order — forex revenue diversification');
  if (/multi.year|long.term/i.test(lower)) notes.push('Multi-year visibility — steady revenue pipeline');
  if (/strategic|exclusive|sole/i.test(lower)) notes.push('Strategic deal — competitive moat');

  return notes.length > 0 ? notes[0] : null;
}

/**
 * Expanded classification for institutional-grade events
 */
function classifyOrderTypeV2(subject: string, description: string): CorporateOrder['orderType'] {
  const combined = `${subject} ${description}`.toLowerCase();

  if (combined.includes('acquisition') || combined.includes('merger') || combined.includes('amalgamation')) return 'M&A';
  if (combined.includes('fund raising') || combined.includes('qip') || combined.includes('rights issue') || combined.includes('capital raising')) return 'Fund Raising';
  if (combined.includes('appointment') || combined.includes('resignation') || combined.includes('ceo') || combined.includes('cfo') || combined.includes('managing director')) return 'Management Change';
  if (combined.includes('letter of intent') || combined.includes('loi')) return 'LOI';
  if (combined.includes('joint venture') || combined.includes('jv') || combined.includes('partnership')) return 'Partnership/JV';
  if (combined.includes('capex') || combined.includes('capital expenditure')) return 'Capex';
  if (combined.includes('contract')) return 'Contract';
  if (combined.includes('order') || combined.includes('awarded') || combined.includes('secured') || combined.includes('bagging')) return 'Order Win';

  return 'Other';
}

/**
 * Filter announcements for order-related keywords
 */
function filterForOrders(announcements: any[]): CorporateOrder[] {
  if (!announcements || announcements.length === 0) return [];

  return announcements
    .filter(item => {
      if (!item.symbol || (!item.desc && !item.subject)) return false;

      const combined = `${item.subject || ''} ${item.desc || ''}`.toLowerCase();
      return ORDER_KEYWORDS.some(keyword => combined.includes(keyword));
    })
    .map(item => {
      const subject = item.subject || item.newName || '';
      const description = item.desc || item.attachmentname || '';
      const symbol = normalizeTicker(item.symbol || '');

      const combinedText = `${subject} ${description}`;
      const orderValue = parseOrderValue(combinedText);
      const orderType = classifyOrderTypeV2(subject, description);
      const { importance, score: importanceScore } = calculateImportanceWithScore(subject, description);

      // Extract enrichment fields
      const client = extractClient(combinedText);
      const segment = extractSegment(combinedText);
      const timeline = extractTimeline(combinedText);

      return {
        symbol,
        company: item.companyName || item.company || symbol || '',
        subject,
        description,
        date: item.date || item.exDate || item.expiryDate || new Date().toISOString().split('T')[0],
        orderType,
        importance,
        importanceScore,
        orderValue,
        isWatchlist: false, // Will be set after
        nseUrl: `https://www.nseindia.com/corporate/announcements.jsp?symbol=${encodeURIComponent(symbol)}`,
        analysis: {
          eventSummary: generateEventSummary({ symbol, orderType, orderValue, subject, client, segment }),
          client,
          segment,
          timeline,
          revenueImpact: assessRevenueImpact(orderValue, combinedText),
          marginImpact: assessMarginImpact(combinedText),
          strategicNote: generateStrategicNote(orderType, orderValue, segment, combinedText),
          sentiment: assessSentiment(importance, orderType),
          confidence: assessConfidence(orderValue, combinedText),
        },
      };
    });
}

/**
 * Main GET handler
 */
export async function GET(request: Request): Promise<NextResponse<CorporateOrdersResponse>> {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const watchlistParam = searchParams.get('watchlist');
    const days = parseInt(searchParams.get('days') || '30');

    // 1. Parse watchlist
    const watchlist = watchlistParam
      ? watchlistParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];

    console.log(`[CorporateOrders] Fetching corporate announcements for ${watchlist.length} watchlist stocks, last ${days} days`);

    // 2. Fetch corporate announcements for date range
    const fromDate = getDateDaysAgo(days);
    const toDate = getTodayDate();

    let allAnnouncements: any[] = [];

    // Try fetching general corporate announcements for the date range
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
      console.log('[CorporateOrders] Could not fetch general announcements:', e);
    }

    // 3. Fetch per-symbol announcements for watchlist stocks
    if (watchlist.length > 0) {
      console.log(`[CorporateOrders] Fetching per-symbol announcements for watchlist: ${watchlist.join(',')}`);

      const symbolBatchSize = 3;
      for (let i = 0; i < watchlist.length; i += symbolBatchSize) {
        const batch = watchlist.slice(i, i + symbolBatchSize);

        const results = await Promise.all(
          batch.map(async sym => {
            try {
              const data = await nseApiFetch(
                `/api/corporates-announcements?index=equities&symbol=${encodeURIComponent(sym)}`,
                300000
              );

              if (data) {
                return Array.isArray(data) ? data : (data?.data || []);
              }
              return [];
            } catch (e) {
              console.log(`[CorporateOrders] Error fetching symbol ${sym}:`, e);
              return [];
            }
          })
        );

        for (const batch of results) {
          allAnnouncements.push(...(Array.isArray(batch) ? batch : []));
        }

        // Rate limiting
        if (i + symbolBatchSize < watchlist.length) {
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }

    // 4. Filter for orders and deduplicate
    const orders = filterForOrders(allAnnouncements);
    const seen = new Set<string>();
    const uniqueOrders: CorporateOrder[] = [];
    const watchlistSet = new Set(watchlist.map(s => normalizeTicker(s)));

    for (const order of orders) {
      const key = `${order.symbol}:${(order.subject || order.description).slice(0, 60)}:${order.date}`;
      if (!seen.has(key)) {
        seen.add(key);
        order.isWatchlist = watchlistSet.has(normalizeTicker(order.symbol));
        uniqueOrders.push(order);
      }
    }

    // 5. SUPPRESS LOW importance items (noise) — only show HIGH and MEDIUM
    const filteredOrders = uniqueOrders.filter(o => o.importance !== 'LOW');

    // 6. Sort by: watchlist first → importance score desc → date desc
    filteredOrders.sort((a, b) => {
      // Watchlist priority
      if (a.isWatchlist !== b.isWatchlist) return a.isWatchlist ? -1 : 1;
      // Then by importance score (higher = more important)
      if (a.importanceScore !== b.importanceScore) return b.importanceScore - a.importanceScore;
      // Then by date
      const dateA = parseNSEDate(a.date);
      const dateB = parseNSEDate(b.date);
      return (dateB?.getTime() || 0) - (dateA?.getTime() || 0);
    });

    // 7. Calculate summary
    const totalOrderValue = filteredOrders.reduce((sum, o) => sum + (o.orderValue || 0), 0);
    const summary = {
      total: filteredOrders.length,
      high: filteredOrders.filter(o => o.importance === 'HIGH').length,
      medium: filteredOrders.filter(o => o.importance === 'MEDIUM').length,
      orderWins: filteredOrders.filter(o => o.orderType === 'Order Win').length,
      contracts: filteredOrders.filter(o => o.orderType === 'Contract').length,
      partnerships: filteredOrders.filter(o => o.orderType === 'Partnership/JV').length,
      watchlistHits: filteredOrders.filter(o => o.isWatchlist).length,
      totalOrderValue: Math.round(totalOrderValue),
    };

    const response: CorporateOrdersResponse = {
      orders: filteredOrders.slice(0, 50), // Max 50 high-signal items
      summary,
      updatedAt: new Date().toISOString(),
    };

    const duration = Date.now() - startTime;
    console.log(`[CorporateOrders] Success: ${uniqueOrders.length} orders found in ${duration}ms`);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[CorporateOrders] Fatal error after ${duration}ms:`, error);

    return NextResponse.json({
      orders: [],
      summary: { total: 0, high: 0, medium: 0, orderWins: 0, contracts: 0, partnerships: 0, watchlistHits: 0, totalOrderValue: 0 },
      updatedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}
