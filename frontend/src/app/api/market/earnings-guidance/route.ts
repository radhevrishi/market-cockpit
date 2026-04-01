import { NextRequest, NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

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

interface GuidanceSummary {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  operatingLeverage: number;
  capexHeavy: number;
}

interface GuidanceResponse {
  events: GuidanceEvent[];
  summary: GuidanceSummary;
  source: string;
  updatedAt: string;
}

// ==================== ROUTE-LEVEL CACHE ====================
const ROUTE_CACHE_TTL = 300_000; // 5 minutes
let _routeCache: { key: string; data: GuidanceResponse; timestamp: number } | null = null;

// Track when we last triggered a background ingest to avoid hammering it
let _lastIngestTrigger = 0;

// ==================== HELPER FUNCTIONS ====================

/**
 * Parse comma-separated symbols and normalize them
 */
function parseSymbols(input: string | null): string[] {
  if (!input) return [];
  return input
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
}

/**
 * Filter events by symbols and time window
 */
function filterEvents(
  allEvents: GuidanceEvent[],
  symbols: string[],
  days: number
): GuidanceEvent[] {
  const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

  return allEvents.filter((event) => {
    const eventTime = new Date(event.eventDate).getTime();
    return symbols.includes(event.symbol) && eventTime >= cutoffTime;
  });
}

/**
 * Compute summary statistics from events
 */
function computeSummary(events: GuidanceEvent[]): GuidanceSummary {
  const summary: GuidanceSummary = {
    total: events.length,
    positive: 0,
    negative: 0,
    neutral: 0,
    operatingLeverage: 0,
    capexHeavy: 0,
  };

  for (const event of events) {
    // Count by grade
    if (event.grade === 'STRONG' || event.grade === 'POSITIVE') {
      summary.positive++;
    } else if (event.grade === 'NEGATIVE' || event.grade === 'WEAK') {
      summary.negative++;
    } else {
      summary.neutral++;
    }

    // Count advanced signals
    if (event.operatingLeverage) summary.operatingLeverage++;
    if (event.guidanceCapex !== null && event.guidanceCapex > 0) summary.capexHeavy++;
  }

  return summary;
}

/**
 * Build cache key for route caching
 */
function getCacheKey(symbols: string[], days: number): string {
  const sortedSymbols = [...symbols].sort().join(',');
  return `earnings-guidance:${sortedSymbols}:${days}`;
}

// ==================== MAIN ROUTE HANDLER ====================

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');
    const daysParam = searchParams.get('days');

    const symbols = parseSymbols(symbolsParam);
    const days = Math.max(1, Math.min(365, parseInt(daysParam || '45', 10)));

    // Validate input
    if (symbols.length === 0) {
      return NextResponse.json(
        {
          error: 'At least one symbol is required',
          events: [],
          summary: {
            total: 0,
            positive: 0,
            negative: 0,
            neutral: 0,
            operatingLeverage: 0,
            capexHeavy: 0,
          },
          source: 'cache',
          updatedAt: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    // Check route-level cache
    const cacheKey = getCacheKey(symbols, days);
    if (
      _routeCache &&
      _routeCache.key === cacheKey &&
      Date.now() - _routeCache.timestamp < ROUTE_CACHE_TTL
    ) {
      return NextResponse.json(_routeCache.data, {
        headers: {
          'X-Cache': 'HIT',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    // Load guidance events from KV store
    const allEvents = await kvGet<GuidanceEvent[]>('guidance:events');

    // If empty — trigger background ingest (fire-and-forget, max once per 5 min)
    let computing = false;
    if (!allEvents || allEvents.length === 0) {
      const now = Date.now();
      if (now - _lastIngestTrigger > 300_000) {
        _lastIngestTrigger = now;
        try {
          const ingestUrl = new URL('/api/market/earnings-guidance/ingest', request.url);
          fetch(ingestUrl.toString(), {
            method: 'GET',
            signal: AbortSignal.timeout(3000),
          }).catch(() => {});
          console.log('[earnings-guidance] Triggered background ingest (Redis empty)');
        } catch {}
      }
      computing = true;
    }

    const events = filterEvents(allEvents || [], symbols, days);
    const summary = computeSummary(events);
    events.sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime());

    const response: GuidanceResponse = {
      events,
      summary,
      source: computing ? 'computing' : 'cache',
      updatedAt: new Date().toISOString(),
      ...(computing ? { _meta: { computing: true } } : {}),
    } as any;

    // Cache the response
    _routeCache = {
      key: cacheKey,
      data: response,
      timestamp: Date.now(),
    };

    return NextResponse.json(response, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    console.error('[earnings-guidance/GET]', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch guidance events',
        events: [],
        summary: {
          total: 0,
          positive: 0,
          negative: 0,
          neutral: 0,
          operatingLeverage: 0,
          capexHeavy: 0,
        },
        source: 'error',
        updatedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
