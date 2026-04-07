import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Read from intelligence signals (already computed and cached)
    const stored = await kvGet<any>('intelligence:signals');

    if (!stored) {
      return NextResponse.json([]);
    }

    // Combine all signal types and convert to article format
    const allSignals = [
      ...(stored.top3 || []),
      ...(stored.signals || []),
      ...(stored.notable || []),
    ];

    // Take top 12 most important signals, convert to article format
    const inPlay = allSignals
      .filter((s: any) => s.headline || s.narrative || s.summary)
      .slice(0, 12)
      .map((s: any, idx: number) => ({
        id: `intel-${idx}-${s.symbol || 'mkt'}`,
        title: s.headline || s.narrative || s.summary || `${s.symbol}: ${s.eventType || 'Signal'}`,
        headline: s.headline || s.narrative || `${s.symbol}: ${s.eventType}`,
        summary: s.narrative || s.summary || s.headline || '',
        source_name: s.source || 'Intelligence',
        source: s.source || 'Intelligence',
        published_at: s.date || s.timestamp || new Date().toISOString(),
        region: 'IN',
        article_type: s.eventType === 'BOTTLENECK' ? 'BOTTLENECK'
          : s.eventType === 'EARNINGS' ? 'EARNINGS'
          : s.eventType === 'MACRO' ? 'MACRO'
          : 'CORPORATE',
        investment_tier: s.signalTierV7 === 'ACTIONABLE' ? 1 : 2,
        tickers: s.symbol ? [s.symbol] : [],
        primary_ticker: s.symbol || null,
        importance_score: (s.weightedScore || 50) / 100,
        sentiment: s.sentiment || null,
      }));

    return NextResponse.json(inPlay);
  } catch (error) {
    console.error('[In-Play API] Error:', error);
    return NextResponse.json([]);
  }
}
