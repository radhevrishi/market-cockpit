/**
 * Earnings Guidance Ingest — Background Compute Pipeline
 *
 * Sources guidance data from the earnings-scan API (which uses screener.in Pros/Cons)
 * and stores precomputed guidance events in Redis.
 *
 * Architecture:
 * - Distributed lock prevents concurrent ingestion runs
 * - Atomic write: compute → temp key → swap to production key
 * - NEVER triggered from UI — only via cron or manual POST
 * - Idempotent: safe to call multiple times
 *
 * Triggered by:
 * 1. Vercel cron (daily at 4:15 AM UTC, weekdays)
 * 2. Manual POST for re-ingestion
 */

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, kvSetNX, kvSwap, kvDel } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

const LOCK_KEY = 'lock:guidance:ingest';
const LOCK_TTL = 300; // 5 minutes
const TEMP_KEY = 'guidance:events:temp';
const PROD_KEY = 'guidance:events';
const META_KEY = 'guidance:meta';
const STORE_TTL = 86400; // 24 hours

const CHAT_ID = '5057319640';

// ==================== TYPE DEFINITIONS ====================

interface GuidanceEvent {
  id: string;
  symbol: string;
  companyName: string;
  eventDate: string;
  source: string;
  eventType: 'RESULT' | 'GUIDANCE' | 'COMMENTARY';
  revenueGrowth: number | null;
  profitGrowth: number | null;
  marginChange: number | null;
  guidanceRevenue: string | null;
  guidanceMargin: string | null;
  guidanceCapex: number | null;
  guidanceDemand: string | null;
  operatingLeverage: boolean;
  deleveraging: boolean;
  orderBookGrowth: boolean;
  rawText: string;
  sentimentScore: number;
  confidenceScore: number;
  dedupKey: string;
  createdAt: string;
  grade: 'STRONG' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'WEAK';
  gradeColor: string;
}

interface GuidanceMeta {
  computedAt: string;
  eventCount: number;
  symbolCount: number;
  version: number;
  source: string;
}

// ==================== HELPERS ====================

function gradeFromScore(score: number): { grade: GuidanceEvent['grade']; color: string } {
  if (score >= 75) return { grade: 'STRONG', color: '#7C3AED' };
  if (score >= 55) return { grade: 'POSITIVE', color: '#00C853' };
  if (score >= 35) return { grade: 'NEUTRAL', color: '#FFD600' };
  if (score >= 15) return { grade: 'NEGATIVE', color: '#FF6B35' };
  return { grade: 'WEAK', color: '#C00000' };
}

function detectSignals(text: string): {
  operatingLeverage: boolean;
  deleveraging: boolean;
  orderBookGrowth: boolean;
  capex: number | null;
  demand: string | null;
} {
  const lower = text.toLowerCase();

  const operatingLeverage = ['fixed cost', 'operational efficiency', 'scale benefits',
    'margin expansion', 'higher throughput', 'capacity utilization', 'operating leverage']
    .some(kw => lower.includes(kw));

  const deleveraging = ['debt reduction', 'deleveraging', 'balance sheet strengthening', 'net cash', 'debt free', 'reduced debt']
    .some(kw => lower.includes(kw));

  const orderBookGrowth = ['order book', 'pipeline', 'backlog', 'order inflow', 'order win']
    .some(kw => lower.includes(kw));

  // Capex extraction
  let capex: number | null = null;
  const capexMatch = text.match(/capex.{0,30}(?:₹|rs\.?)\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:cr|crore)?/i);
  if (capexMatch?.[1]) {
    capex = parseFloat(capexMatch[1].replace(/,/g, ''));
    if (isNaN(capex)) capex = null;
  }

  // Demand
  const positiveDemand = ['strong demand', 'robust pipeline', 'accelerating demand', 'growth momentum', 'capacity expansion']
    .filter(kw => lower.includes(kw)).length;
  const negativeDemand = ['weak demand', 'slowdown', 'muted demand', 'margin pressure', 'pricing pressure']
    .filter(kw => lower.includes(kw)).length;
  const demand = positiveDemand > negativeDemand ? 'Strong' : negativeDemand > positiveDemand ? 'Weak' : null;

  return { operatingLeverage, deleveraging, orderBookGrowth, capex, demand };
}

// ==================== CORE INGESTION ====================

async function ingestFromEarningsScan(): Promise<{
  events: GuidanceEvent[];
  symbolCount: number;
  error: string | null;
}> {
  const events: GuidanceEvent[] = [];
  const seenDedup = new Set<string>();

  try {
    // 1. Get symbols from portfolio + watchlist
    let symbols: string[] = [];
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

      const [pRes, wRes] = await Promise.all([
        fetch(`${baseUrl}/api/portfolio?chatId=${CHAT_ID}`, { signal: AbortSignal.timeout(10000) }).catch(() => null),
        fetch(`${baseUrl}/api/watchlist?chatId=${CHAT_ID}`, { signal: AbortSignal.timeout(10000) }).catch(() => null),
      ]);

      if (pRes?.ok) {
        const pd = await pRes.json();
        symbols.push(...(pd.holdings || []).map((h: any) => h.symbol));
      }
      if (wRes?.ok) {
        const wd = await wRes.json();
        symbols.push(...(wd.watchlist || []));
      }
    } catch (e) {
      console.warn('[guidance/ingest] Failed to fetch symbols:', (e as Error).message);
    }

    symbols = [...new Set(symbols.map(s => s.trim().toUpperCase()).filter(s => s.length > 0))];

    if (symbols.length === 0) {
      return { events: [], symbolCount: 0, error: 'No symbols in portfolio/watchlist' };
    }

    console.log(`[guidance/ingest] Processing ${symbols.length} symbols`);

    // 2. For each symbol, check earnings cache (which has guidance from screener.in)
    let processedCount = 0;
    for (const sym of symbols) {
      try {
        const cached = await kvGet<any>(`earnings:${sym}`);
        if (!cached) continue;

        processedCount++;
        const companyName = cached.companyName || sym;
        const fetchedDate = cached.fetchedAt ? new Date(cached.fetchedAt).toISOString() : new Date().toISOString();

        // Source A: Guidance data from screener.in Pros/Cons
        if (cached.guidance) {
          const g = cached.guidance;
          const hasSignal = g.guidance !== 'Neutral' || g.prosText || g.consText;

          if (hasSignal) {
            const rawText = `${g.prosText || ''} ${g.consText || ''}`.trim();
            const signals = detectSignals(rawText);

            // Convert screener sentiment (-1 to +1) to 0-100 scale
            const sentimentRaw = typeof g.sentimentScore === 'number' ? g.sentimentScore : 0;
            const sentimentScore = Math.round((sentimentRaw + 1) * 50);
            const { grade, color } = gradeFromScore(sentimentScore);

            const dedupKey = `${sym}_GUIDANCE_screener`;
            if (!seenDedup.has(dedupKey)) {
              seenDedup.add(dedupKey);
              events.push({
                id: `${sym}-guid-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
                symbol: sym,
                companyName,
                eventDate: fetchedDate,
                source: 'Screener',
                eventType: 'GUIDANCE',
                revenueGrowth: null,
                profitGrowth: null,
                marginChange: null,
                guidanceRevenue: g.revenueOutlook !== 'Unknown' ? g.revenueOutlook : null,
                guidanceMargin: g.marginOutlook !== 'Unknown' ? g.marginOutlook : null,
                guidanceCapex: signals.capex,
                guidanceDemand: g.demandSignal !== 'Unknown' ? g.demandSignal : (signals.demand || null),
                operatingLeverage: signals.operatingLeverage,
                deleveraging: signals.deleveraging,
                orderBookGrowth: signals.orderBookGrowth,
                rawText: rawText.slice(0, 1000),
                sentimentScore,
                confidenceScore: Math.min(100, 60 + (signals.operatingLeverage ? 15 : 0) + (signals.orderBookGrowth ? 10 : 0)),
                dedupKey,
                createdAt: new Date().toISOString(),
                grade,
                gradeColor: color,
              });
            }
          }
        }

        // Source B: Quarterly results data — compute earnings event
        if (cached.quarters && Array.isArray(cached.quarters) && cached.quarters.length > 0) {
          const latest = cached.quarters[0];
          const previous = cached.quarters.length > 1 ? cached.quarters[1] : null;
          const yoyQuarter = cached.quarters.length >= 4 ? cached.quarters[3] : (cached.quarters.length >= 3 ? cached.quarters[2] : null);

          // Compute YoY growth
          let revenueGrowth: number | null = null;
          let profitGrowth: number | null = null;

          if (yoyQuarter && yoyQuarter.revenue > 0) {
            revenueGrowth = Math.round(((latest.revenue - yoyQuarter.revenue) / yoyQuarter.revenue) * 100 * 10) / 10;
            if (Math.abs(revenueGrowth) > 200) revenueGrowth = Math.sign(revenueGrowth) * 200;
          }
          if (yoyQuarter && Math.abs(yoyQuarter.pat) > 0.1) {
            profitGrowth = Math.round(((latest.pat - yoyQuarter.pat) / Math.abs(yoyQuarter.pat)) * 100 * 10) / 10;
            if (Math.abs(profitGrowth) > 200) profitGrowth = Math.sign(profitGrowth) * 200;
          }

          // Margin change (QoQ)
          let marginChange: number | null = null;
          if (previous && latest.opm > 0 && previous.opm > 0) {
            marginChange = Math.round((latest.opm - previous.opm) * 100); // basis points
          }

          // Compute result sentiment score
          let resultScore = 50; // baseline
          if (revenueGrowth !== null) resultScore += Math.min(15, Math.max(-15, revenueGrowth / 3));
          if (profitGrowth !== null) resultScore += Math.min(20, Math.max(-20, profitGrowth / 4));
          if (marginChange !== null) resultScore += Math.min(10, Math.max(-10, marginChange / 50));
          resultScore = Math.max(0, Math.min(100, Math.round(resultScore)));

          const { grade, color } = gradeFromScore(resultScore);
          const dedupKey = `${sym}_RESULT_${latest.period.replace(/\s+/g, '_')}`;

          if (!seenDedup.has(dedupKey)) {
            seenDedup.add(dedupKey);
            events.push({
              id: `${sym}-res-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
              symbol: sym,
              companyName,
              eventDate: fetchedDate,
              source: 'Screener',
              eventType: 'RESULT',
              revenueGrowth,
              profitGrowth,
              marginChange,
              guidanceRevenue: null,
              guidanceMargin: null,
              guidanceCapex: null,
              guidanceDemand: null,
              operatingLeverage: false,
              deleveraging: false,
              orderBookGrowth: false,
              rawText: `${latest.period}: Revenue ₹${latest.revenue}Cr, OPM ${latest.opm}%, PAT ₹${latest.pat}Cr, EPS ₹${latest.eps}`,
              sentimentScore: resultScore,
              confidenceScore: 80,
              dedupKey,
              createdAt: new Date().toISOString(),
              grade,
              gradeColor: color,
            });
          }
        }
      } catch (e) {
        console.warn(`[guidance/ingest] Error processing ${sym}:`, (e as Error).message);
      }
    }

    // Sort by sentiment score descending
    events.sort((a, b) => b.sentimentScore - a.sentimentScore);

    console.log(`[guidance/ingest] Generated ${events.length} events from ${processedCount}/${symbols.length} symbols`);
    return { events, symbolCount: symbols.length, error: null };
  } catch (e) {
    console.error('[guidance/ingest] Fatal error:', e);
    return { events: [], symbolCount: 0, error: (e as Error).message };
  }
}

// ==================== LOCKED PIPELINE ====================

async function runLockedPipeline(): Promise<{
  success: boolean;
  ingested: number;
  total: number;
  message: string;
  skipped?: boolean;
}> {
  // 1. Acquire distributed lock
  const lockAcquired = await kvSetNX(LOCK_KEY, `pid:${Date.now()}`, LOCK_TTL);
  if (!lockAcquired) {
    console.log('[guidance/ingest] Lock exists — another ingestion is running. Skipping.');
    return { success: true, ingested: 0, total: 0, message: 'Skipped — another ingestion in progress', skipped: true };
  }

  try {
    // 2. Run ingestion
    const { events, symbolCount, error } = await ingestFromEarningsScan();

    if (error && events.length === 0) {
      return { success: false, ingested: 0, total: 0, message: `Ingestion error: ${error}` };
    }

    if (events.length === 0) {
      // Don't overwrite good data with empty — keep existing
      const existing = await kvGet<GuidanceEvent[]>(PROD_KEY);
      return {
        success: true,
        ingested: 0,
        total: existing?.length || 0,
        message: 'No new events found. Existing data preserved.',
      };
    }

    // 3. Atomic write: temp → swap
    // Write to temp key first
    await kvSet(TEMP_KEY, events, STORE_TTL);

    // Swap temp → production
    const swapped = await kvSwap(TEMP_KEY, PROD_KEY, STORE_TTL);
    if (!swapped) {
      // Fallback: direct write if swap fails
      await kvSet(PROD_KEY, events, STORE_TTL);
      console.warn('[guidance/ingest] Swap failed, used direct write fallback');
    }

    // 4. Update metadata
    const meta: GuidanceMeta = {
      computedAt: new Date().toISOString(),
      eventCount: events.length,
      symbolCount,
      version: Date.now(),
      source: 'earnings-cache',
    };
    await kvSet(META_KEY, meta, STORE_TTL);

    console.log(`[guidance/ingest] Pipeline complete: ${events.length} events stored`);
    return {
      success: true,
      ingested: events.length,
      total: events.length,
      message: `Successfully ingested ${events.length} guidance events from ${symbolCount} symbols`,
    };
  } finally {
    // 5. Release lock
    await kvDel(LOCK_KEY);
  }
}

// ==================== ROUTE HANDLERS ====================

/**
 * GET: Cron-triggered ingestion
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Validate cron secret if present
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get('secret');
    if (secret && secret !== 'mc-bot-2026') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await runLockedPipeline();
    return NextResponse.json({
      ...result,
      eventsCount: result.total,
      sampleEvent: null,
    });
  } catch (error) {
    console.error('[guidance/ingest/GET]', error);
    return NextResponse.json(
      { success: false, ingested: 0, total: 0, message: `Failed: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}

/**
 * POST: Manual re-ingestion trigger (NOT from UI — only admin/debug)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const result = await runLockedPipeline();
    return NextResponse.json({
      ...result,
      eventsCount: result.total,
    });
  } catch (error) {
    console.error('[guidance/ingest/POST]', error);
    return NextResponse.json(
      { success: false, ingested: 0, total: 0, message: `Failed: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
