import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

export const dynamic = 'force-dynamic';

// ══════════════════════════════════════════════════════════════════════
// STRUCTURAL ALERTS — Synthetic headlines for multi-year constraints
// These convert continuous signals into event-like output so they
// rank alongside discrete news in the "IN PLAY TODAY" feed.
// ══════════════════════════════════════════════════════════════════════
interface StructuralAlert {
  id: string;
  headline: string;
  summary: string;
  status: 'CRITICAL' | 'ELEVATED' | 'EMERGING';
  sub_tag: string;
  tickers: string[];
  investment_tickers: string[];
}

const STRUCTURAL_ALERTS: StructuralAlert[] = [
  {
    id: 'structural-memory',
    headline: '[STRUCTURAL] AI memory bottleneck intensifying — HBM supply constrained, demand accelerating',
    summary: 'HBM supply concentrated in 3-4 players. Memory bandwidth is gating factor for AI scaling. 625x demand increase projected by 2028. Multi-year investment theme.',
    status: 'CRITICAL',
    sub_tag: 'MEMORY_STORAGE',
    tickers: ['MU', 'SKHYNIX', 'SAMSUNG'],
    investment_tickers: ['Micron', 'SK Hynix', 'Samsung'],
  },
  {
    id: 'structural-photonics',
    headline: '[STRUCTURAL] Interconnect bandwidth wall — silicon photonics transition underway',
    summary: 'Copper interconnect saturating at scale. AI clusters bandwidth-bound, not compute-bound. Optical I/O becoming mandatory. NVIDIA $4B optics investment signals urgency.',
    status: 'ELEVATED',
    sub_tag: 'INTERCONNECT_PHOTONICS',
    tickers: ['COHR', 'LITE', 'AVGO'],
    investment_tickers: ['Coherent Corp', 'Lumentum', 'Broadcom'],
  },
  {
    id: 'structural-packaging',
    headline: '[STRUCTURAL] Advanced packaging capacity constraint — CoWoS remains bottleneck',
    summary: 'Multi-die architectures require CoWoS/EMIB. TSMC packaging capacity is binding constraint for AI chip production. Lead times extended.',
    status: 'CRITICAL',
    sub_tag: 'FABRICATION_PACKAGING',
    tickers: ['TSM', 'AMKR', 'ASX'],
    investment_tickers: ['TSMC', 'Amkor', 'ASE Group'],
  },
  {
    id: 'structural-power',
    headline: '[STRUCTURAL] Data center power demand outpacing grid infrastructure',
    summary: 'Grid capacity lagging data center buildout. Transformer shortages, substation backlogs. Power is next binding constraint after compute.',
    status: 'ELEVATED',
    sub_tag: 'POWER_GRID',
    tickers: ['GEV', 'SIEGY'],
    investment_tickers: ['GE Vernova', 'Siemens Energy'],
  },
];

// ── Momentum detection: check if bottleneck dashboard has CRITICAL/HIGH for a sub_tag ──
async function getStructuralMomentum(): Promise<Record<string, number>> {
  try {
    const dashData = await kvGet<any>('bottleneck:dashboard:persistent:v7');
    if (!dashData || !Array.isArray(dashData)) return {};

    // Count signals per sub_tag as rough momentum proxy
    const momentum: Record<string, number> = {};
    for (const signal of dashData) {
      const tag = signal.bucket_id || '';
      momentum[tag] = (momentum[tag] || 0) + 1;
    }
    return momentum;
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    // Read from intelligence signals (already computed and cached)
    const stored = await kvGet<any>('intelligence:signals');
    const momentum = await getStructuralMomentum();

    const eventSignals: any[] = [];
    if (stored) {
      const allSignals = [
        ...(stored.top3 || []),
        ...(stored.signals || []),
        ...(stored.notable || []),
      ];

      // Take top 8 event signals (leave room for structural alerts)
      const topEvents = allSignals
        .filter((s: any) => s.headline || s.narrative || s.summary)
        .slice(0, 8)
        .map((s: any, idx: number) => ({
          id: `intel-${idx}-${s.symbol || 'mkt'}`,
          title: s.headline || s.narrative || s.summary || `${s.symbol}: ${s.eventType || 'Signal'}`,
          headline: s.headline || s.narrative || `${s.symbol}: ${s.eventType}`,
          summary: s.narrative || s.summary || s.headline || '',
          source_name: s.source || 'Intelligence',
          source: s.source || 'Intelligence',
          published_at: s.date || s.timestamp || new Date().toISOString(),
          region: 'GLOBAL',
          article_type: s.eventType === 'BOTTLENECK' ? 'BOTTLENECK'
            : s.eventType === 'EARNINGS' ? 'EARNINGS'
            : s.eventType === 'MACRO' ? 'MACRO'
            : 'CORPORATE',
          investment_tier: s.signalTierV7 === 'ACTIONABLE' ? 1 : 2,
          tickers: s.symbol ? [s.symbol] : [],
          primary_ticker: s.symbol || null,
          importance_score: (s.weightedScore || 50) / 100,
          sentiment: s.sentiment || null,
          feed_type: 'EVENT',
        }));
      eventSignals.push(...topEvents);
    }

    // ── CRITICAL OVERRIDE: Inject structural alerts into top feed ──
    // Only inject alerts that have:
    // 1. CRITICAL or ELEVATED status, AND
    // 2. Momentum (signals exist in persistent store), OR
    // 3. Always inject CRITICAL regardless of momentum
    const structuralInPlay = STRUCTURAL_ALERTS
      .filter(alert => {
        if (alert.status === 'CRITICAL') return true; // Always show CRITICAL
        const m = momentum[alert.sub_tag] || 0;
        return m >= 2; // ELEVATED needs at least 2 supporting signals
      })
      .map(alert => ({
        id: alert.id,
        title: alert.headline,
        headline: alert.headline,
        summary: alert.summary,
        source_name: 'Structural Analysis',
        source: 'Structural Analysis',
        published_at: new Date().toISOString(),
        region: 'GLOBAL',
        article_type: 'BOTTLENECK',
        bottleneck_sub_tag: alert.sub_tag,
        investment_tier: 1,
        tickers: alert.tickers,
        primary_ticker: alert.tickers[0] || null,
        importance_score: alert.status === 'CRITICAL' ? 0.95 : 0.85,
        sentiment: null,
        investment_tickers: alert.investment_tickers,
        feed_type: 'STRUCTURAL',
        structural_status: alert.status,
      }));

    // ── DUAL RANKING: Merge event + structural, sort by importance ──
    // Structural CRITICAL alerts interleave with top events
    const merged = [...structuralInPlay, ...eventSignals];

    // Sort: CRITICAL structural first, then by importance_score
    merged.sort((a, b) => {
      // Structural CRITICAL always at top
      const aCrit = a.feed_type === 'STRUCTURAL' && a.structural_status === 'CRITICAL' ? 1 : 0;
      const bCrit = b.feed_type === 'STRUCTURAL' && b.structural_status === 'CRITICAL' ? 1 : 0;
      if (aCrit !== bCrit) return bCrit - aCrit;

      // Then by importance score
      return (b.importance_score || 0) - (a.importance_score || 0);
    });

    // Return top 12 (mix of structural + event)
    return NextResponse.json(merged.slice(0, 12));
  } catch (error) {
    console.error('[In-Play API] Error:', error);
    return NextResponse.json([]);
  }
}
