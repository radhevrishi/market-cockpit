import { NextRequest, NextResponse } from 'next/server';
import { nseApiFetch } from '@/lib/nse';
import { kvGet, kvSet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// ==================== TYPE DEFINITIONS ====================

interface GuidanceEvent {
  id: string;
  symbol: string;
  companyName: string;
  eventDate: string;
  source: 'NSE' | 'BSE' | 'Screener' | 'Moneycontrol';
  eventType: 'RESULT' | 'GUIDANCE' | 'COMMENTARY';

  // Extracted signals
  revenueGrowth: number | null;
  profitGrowth: number | null;
  marginChange: number | null;

  // Guidance-specific
  guidanceRevenue: string | null;
  guidanceMargin: string | null;
  guidanceCapex: number | null;
  guidanceDemand: string | null;

  // Advanced signals
  operatingLeverage: boolean;
  deleveraging: boolean;
  orderBookGrowth: boolean;

  rawText: string;
  sentimentScore: number;
  confidenceScore: number;
  dedupKey: string;
  createdAt: string;

  // Computed
  grade: 'STRONG' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'WEAK';
  gradeColor: string;
}

interface IngestRequest {
  symbols?: string[];
  chatId?: string;
}

interface IngestResponse {
  ingested: number;
  total: number;
  events: GuidanceEvent[];
  message: string;
}

// ==================== EXTRACTION HELPERS ====================

/**
 * Extract revenue growth percentage from text
 */
function extractRevenueGrowth(text: string): number | null {
  const match = text.match(/revenue.{0,50}(?:grew|growth|increase|rose).{0,50}(\d+)\s*%/i);
  if (match && match[1]) {
    return Math.min(100, parseInt(match[1], 10));
  }
  return null;
}

/**
 * Extract margin change percentage from text
 */
function extractMarginChange(text: string): number | null {
  const match = text.match(/margin.{0,50}(?:expand|improve|contract|compress|narrow).{0,50}(\d+)\s*(?:bps|basis point)/i);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Extract profit/PAT growth from text
 */
function extractProfitGrowth(text: string): number | null {
  const match = text.match(/(?:profit|pat|net profit).{0,50}(?:grew|growth|increase|rose).{0,50}(\d+)\s*%/i);
  if (match && match[1]) {
    return Math.min(100, parseInt(match[1], 10));
  }
  return null;
}

/**
 * Extract capex guidance from text
 */
function extractCapex(text: string): number | null {
  const match = text.match(/capex.{0,30}(?:₹|rs\.?)\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:cr|crore)?/i);
  if (match && match[1]) {
    const num = parseFloat(match[1].replace(/,/g, ''));
    return isNaN(num) ? null : num;
  }
  return null;
}

/**
 * Score demand sentiment from text keywords
 */
function scoreDemandSentiment(text: string): { sentiment: string | null; score: number } {
  const lowerText = text.toLowerCase();

  // Positive signals
  const positiveKeywords = [
    'strong demand',
    'robust pipeline',
    'order backlog',
    'capacity expansion',
    'growth momentum',
    'accelerating demand',
    'market leadership',
  ];
  const positiveMatches = positiveKeywords.filter((kw) => lowerText.includes(kw)).length;

  // Negative signals
  const negativeKeywords = [
    'weak demand',
    'slowdown',
    'muted demand',
    'margin pressure',
    'competition',
    'pricing pressure',
    'demand concerns',
  ];
  const negativeMatches = negativeKeywords.filter((kw) => lowerText.includes(kw)).length;

  const netScore = positiveMatches - negativeMatches;
  if (netScore > 0) return { sentiment: 'strong', score: 15 };
  if (netScore < 0) return { sentiment: 'weak', score: 0 };
  return { sentiment: null, score: 7 };
}

/**
 * Detect operating leverage signal
 */
function detectOperatingLeverage(text: string): boolean {
  const keywords = [
    'fixed cost',
    'operational efficiency',
    'scale benefits',
    'leverage',
    'margin expansion',
    'higher throughput',
    'capacity utilization',
  ];
  return keywords.some((kw) => text.toLowerCase().includes(kw));
}

/**
 * Detect deleveraging signal
 */
function detectDeleveraging(text: string): boolean {
  const keywords = ['debt reduction', 'deleveraging', 'balance sheet strengthening', 'net cash'];
  return keywords.some((kw) => text.toLowerCase().includes(kw));
}

/**
 * Detect order book growth signal
 */
function detectOrderBookGrowth(text: string): boolean {
  const keywords = ['order book', 'pipeline', 'backlog', 'order inflow'];
  return keywords.some((kw) => text.toLowerCase().includes(kw));
}

/**
 * Compute sentiment score (0-100 scale)
 */
function computeSentimentScore(
  revenueGrowth: number | null,
  marginChange: number | null,
  profitGrowth: number | null,
  demandScore: number,
  capex: number | null,
  operatingLeverage: boolean
): number {
  let score = 0;

  // Revenue signal (0-20)
  if (revenueGrowth !== null) {
    score += Math.min(20, revenueGrowth / 5);
  }

  // Margin signal (0-20)
  if (marginChange !== null) {
    score += Math.min(20, Math.max(0, marginChange / 5));
  }

  // Profit signal (0-25)
  if (profitGrowth !== null) {
    score += Math.min(25, profitGrowth / 4);
  }

  // Demand signal (0-15)
  score += demandScore;

  // Capex signal (0-10)
  if (capex !== null && capex > 0) {
    score += Math.min(10, 5);
  }

  // Operating leverage bonus (0-10)
  if (operatingLeverage) {
    score += 10;
  }

  return Math.min(100, Math.round(score));
}

/**
 * Grade events based on sentiment score
 */
function gradeEvent(sentimentScore: number): { grade: 'STRONG' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'WEAK'; color: string } {
  if (sentimentScore >= 80) return { grade: 'STRONG', color: '#00B050' };
  if (sentimentScore >= 60) return { grade: 'POSITIVE', color: '#70AD47' };
  if (sentimentScore >= 40) return { grade: 'NEUTRAL', color: '#FFC000' };
  if (sentimentScore >= 20) return { grade: 'NEGATIVE', color: '#FF6B35' };
  return { grade: 'WEAK', color: '#C00000' };
}

/**
 * Parse announcement and extract GuidanceEvent
 */
async function parseAnnouncement(
  announcement: any,
  storedEvents: Map<string, GuidanceEvent>
): Promise<GuidanceEvent | null> {
  try {
    const symbol = announcement.symbol?.toUpperCase() || '';
    const companyName = announcement.company || announcement.companyName || '';
    const subject = announcement.subject || announcement.title || '';
    const description = announcement.desc || announcement.description || '';
    const dateStr = announcement.announcement_date || announcement.date || new Date().toISOString();

    // Filter by keywords
    const contentToSearch = `${subject} ${description}`.toLowerCase();
    const hasRelevantKeywords = [
      'financial results',
      'quarterly results',
      'revenue',
      'guidance',
      'outlook',
      'capex',
      'order book',
      'margin',
      'profit',
    ].some((kw) => contentToSearch.includes(kw));

    if (!hasRelevantKeywords) {
      return null;
    }

    // Determine event type
    let eventType: 'RESULT' | 'GUIDANCE' | 'COMMENTARY' = 'COMMENTARY';
    if (contentToSearch.includes('result') || contentToSearch.includes('earnings')) {
      eventType = 'RESULT';
    } else if (contentToSearch.includes('guidance') || contentToSearch.includes('outlook')) {
      eventType = 'GUIDANCE';
    }

    // Extract signals
    const revenueGrowth = extractRevenueGrowth(description);
    const profitGrowth = extractProfitGrowth(description);
    const marginChange = extractMarginChange(description);
    const capex = extractCapex(description);
    const { sentiment: guidanceDemand, score: demandScore } = scoreDemandSentiment(description);
    const operatingLeverage = detectOperatingLeverage(description);
    const deleveraging = detectDeleveraging(description);
    const orderBookGrowth = detectOrderBookGrowth(description);

    // Compute sentiment and grade
    const sentimentScore = computeSentimentScore(
      revenueGrowth,
      marginChange,
      profitGrowth,
      demandScore,
      capex,
      operatingLeverage
    );
    const { grade, color: gradeColor } = gradeEvent(sentimentScore);

    // Create dedup key
    const dateObj = new Date(dateStr);
    const dateStr2 = dateObj.toISOString().split('T')[0];
    const dedupKey = `${symbol}_${eventType}_${dateStr2}`;

    // Check if already stored
    if (storedEvents.has(dedupKey)) {
      return null;
    }

    // Create event ID
    const id = `${symbol}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const event: GuidanceEvent = {
      id,
      symbol,
      companyName,
      eventDate: dateStr,
      source: 'NSE',
      eventType,
      revenueGrowth,
      profitGrowth,
      marginChange,
      guidanceRevenue: null, // Could be extracted if format available
      guidanceMargin: null,
      guidanceCapex: capex,
      guidanceDemand,
      operatingLeverage,
      deleveraging,
      orderBookGrowth,
      rawText: `${subject}. ${description}`.substring(0, 1000),
      sentimentScore,
      confidenceScore: Math.min(100, 70 + (operatingLeverage ? 20 : 0)),
      dedupKey,
      createdAt: new Date().toISOString(),
      grade,
      gradeColor,
    };

    return event;
  } catch (error) {
    console.error('[earnings-guidance/ingest] Error parsing announcement:', error);
    return null;
  }
}

// ==================== INGESTION LOGIC ====================

async function ingestGuidanceEvents(symbols: string[]): Promise<IngestResponse> {
  try {
    // Load existing events
    const existingEvents = await kvGet<GuidanceEvent[]>('guidance:events');
    const storedEventsMap = new Map<string, GuidanceEvent>();

    if (existingEvents && Array.isArray(existingEvents)) {
      for (const event of existingEvents) {
        storedEventsMap.set(event.dedupKey, event);
      }
    }

    // Fetch NSE corporate announcements for last 45 days
    const now = new Date();
    const from45DaysAgo = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);

    const formatDate = (d: Date): string => {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    };

    const fromDate = formatDate(from45DaysAgo);
    const toDate = formatDate(now);

    console.log(`[earnings-guidance/ingest] Fetching announcements from ${fromDate} to ${toDate}`);

    // ── Source 1: NSE Corporate Announcements ──
    let announcementsArray: any[] = [];
    try {
      const announcements = await nseApiFetch(`/api/corporate-announcements?index=equities`, 600000);
      if (announcements) {
        announcementsArray = Array.isArray(announcements) ? announcements : announcements.data || [];
      }
    } catch (e) {
      console.warn('[earnings-guidance/ingest] NSE fetch failed:', (e as Error).message);
    }

    console.log(`[earnings-guidance/ingest] NSE returned ${announcementsArray.length} announcements`);

    const newEvents: GuidanceEvent[] = [];

    for (const announcement of announcementsArray) {
      // Filter by symbols if provided
      if (symbols.length > 0 && announcement.symbol) {
        if (!symbols.includes(announcement.symbol.toUpperCase())) {
          continue;
        }
      }

      const event = await parseAnnouncement(announcement, storedEventsMap);
      if (event) {
        storedEventsMap.set(event.dedupKey, event);
        newEvents.push(event);
      }
    }

    // ── Source 2: Earnings Cache (screener.in guidance data) ──
    // If NSE returned nothing or few events, enrich from earnings cache
    if (symbols.length > 0) {
      for (const sym of symbols.slice(0, 50)) {
        try {
          const cached = await kvGet<any>(`earnings:${sym}`);
          if (cached?.guidance && cached.guidance.guidance !== 'Neutral') {
            const dedupKey = `${sym}_GUIDANCE_earnings`;
            if (storedEventsMap.has(dedupKey)) continue;

            const g = cached.guidance;
            const event: GuidanceEvent = {
              id: `${sym}-earnings-${Date.now()}`,
              symbol: sym,
              companyName: cached.companyName || sym,
              eventDate: cached.fetchedAt ? new Date(cached.fetchedAt).toISOString() : new Date().toISOString(),
              source: 'Screener',
              eventType: 'GUIDANCE',
              revenueGrowth: null,
              profitGrowth: null,
              marginChange: null,
              guidanceRevenue: g.revenueOutlook !== 'Unknown' ? g.revenueOutlook : null,
              guidanceMargin: g.marginOutlook !== 'Unknown' ? g.marginOutlook : null,
              guidanceCapex: null,
              guidanceDemand: g.demandSignal !== 'Unknown' ? g.demandSignal : null,
              operatingLeverage: false,
              deleveraging: false,
              orderBookGrowth: false,
              rawText: `${g.prosText || ''} ${g.consText || ''}`.trim().slice(0, 1000),
              sentimentScore: Math.round((g.sentimentScore + 1) * 50), // -1..1 → 0..100
              confidenceScore: 65,
              dedupKey,
              createdAt: new Date().toISOString(),
              grade: g.guidance === 'Positive' ? 'POSITIVE' : 'NEGATIVE',
              gradeColor: g.guidance === 'Positive' ? '#70AD47' : '#FF6B35',
            };
            storedEventsMap.set(dedupKey, event);
            newEvents.push(event);
          }
        } catch {}
      }
    }

    // Combine and limit to max 500 events
    const allEvents = Array.from(storedEventsMap.values())
      .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime())
      .slice(0, 500);

    // Store in KV
    await kvSet('guidance:events', allEvents, 86400); // 24 hour TTL

    console.log(
      `[earnings-guidance/ingest] Ingested ${newEvents.length} new events, total: ${allEvents.length}`
    );

    return {
      ingested: newEvents.length,
      total: allEvents.length,
      events: newEvents,
      message: `Successfully ingested ${newEvents.length} new guidance events`,
    };
  } catch (error) {
    console.error('[earnings-guidance/ingest]', error);
    const existingEvents = await kvGet<GuidanceEvent[]>('guidance:events');
    return {
      ingested: 0,
      total: existingEvents?.length || 0,
      events: [],
      message: `Error during ingestion: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ==================== ROUTE HANDLERS ====================

/**
 * GET: Trigger ingestion for given symbols (can be called by cron)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');

    const symbols = symbolsParam
      ? symbolsParam
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter((s) => s.length > 0)
      : [];

    const result = await ingestGuidanceEvents(symbols);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[earnings-guidance/ingest/GET]', error);
    return NextResponse.json(
      {
        ingested: 0,
        total: 0,
        events: [],
        message: `Failed to ingest: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    );
  }
}

/**
 * POST: Same as GET but with body { symbols, chatId }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let body: IngestRequest = {};
    try {
      body = await request.json();
    } catch {
      // Body might be empty
    }

    const symbols = body.symbols ? body.symbols.map((s) => s.toUpperCase()) : [];
    const chatId = body.chatId || 'manual';

    console.log(`[earnings-guidance/ingest/POST] chatId=${chatId}, symbols=${symbols.join(',')}`);

    const result = await ingestGuidanceEvents(symbols);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[earnings-guidance/ingest/POST]', error);
    return NextResponse.json(
      {
        ingested: 0,
        total: 0,
        events: [],
        message: `Failed to ingest: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    );
  }
}
