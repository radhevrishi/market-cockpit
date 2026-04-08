import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

export const dynamic = 'force-dynamic';

// Bottleneck bucket definitions
const BOTTLENECK_BUCKETS: Record<string, { label: string; keywords: RegExp; severity_color: string; severity_icon: string }> = {
  SEMICONDUCTOR: {
    label: 'Semiconductor & Chip Supply',
    keywords: /\b(semiconductor|chip|wafer|foundry|fab|tsmc|samsung foundry|intel fab|asml|hbm|dram|nand|memory|gpu shortage)\b/i,
    severity_color: '#DC2626',
    severity_icon: '🔴',
  },
  AI_INFRASTRUCTURE: {
    label: 'AI Infrastructure & Data Centers',
    keywords: /\b(data center|gpu|nvidia|ai infrastructure|cloud capacity|hyperscal|power grid|ai chip|compute capacity)\b/i,
    severity_color: '#EA580C',
    severity_icon: '🟠',
  },
  ENERGY: {
    label: 'Energy & Power',
    keywords: /\b(oil|crude|opec|natural gas|coal|power|electricity|energy crisis|fuel|refinery|lng|petrol|diesel)\b/i,
    severity_color: '#CA8A04',
    severity_icon: '🟡',
  },
  SUPPLY_CHAIN: {
    label: 'Global Supply Chain',
    keywords: /\b(supply chain|logistics|shipping|freight|container|port|suez|panama|red sea|trade route|import|export)\b/i,
    severity_color: '#D97706',
    severity_icon: '🟠',
  },
  INDIA_BANKING: {
    label: 'India Banking & Credit',
    keywords: /\b(rbi|npa|credit growth|bank|nbfc|lending|loan|deposit|liquidity|repo rate|monetary policy|sebi)\b/i,
    severity_color: '#2563EB',
    severity_icon: '🔵',
  },
  INDIA_AGRI: {
    label: 'India Agriculture & Food',
    keywords: /\b(monsoon|crop|agriculture|food|wheat|rice|sugar|fertilizer|msp|kharif|rabi|farm|agri)\b/i,
    severity_color: '#16A34A',
    severity_icon: '🟢',
  },
  INDIA_DEFENCE: {
    label: 'India Defence & Aerospace',
    keywords: /\b(defence|defense|military|missile|fighter|hal|bhel|drdo|isro|satellite|aerospace|ammunition)\b/i,
    severity_color: '#7C3AED',
    severity_icon: '🟣',
  },
  INDIA_PHARMA: {
    label: 'India Pharma & Healthcare',
    keywords: /\b(pharma|drug|fda|usfda|anda|api|formulation|hospital|healthcare|vaccine|biotech|generic)\b/i,
    severity_color: '#0891B2',
    severity_icon: '🔵',
  },
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const regionFilter = searchParams.get('region') || 'ALL';

    // Read from intelligence signals
    const stored = await kvGet<any>('intelligence:signals');

    if (!stored) {
      return NextResponse.json({
        success: true,
        total_articles: 0,
        buckets: [],
      });
    }

    // Combine all signals
    const allSignals = [
      ...(stored.signals || []),
      ...(stored.notable || []),
      ...(stored.observations || []),
    ];

    // Build buckets
    const buckets: any[] = [];

    for (const [key, config] of Object.entries(BOTTLENECK_BUCKETS)) {
      const matchingSignals = allSignals.filter((s: any) => {
        const text = (s.headline || '') + ' ' + (s.narrative || '') + ' ' + (s.summary || '') + ' ' + (s.eventType || '');
        if (!config.keywords.test(text)) return false;

        // Region filter
        if (regionFilter === 'IN') {
          // India-specific buckets or signals mentioning India
          if (key.startsWith('INDIA_')) return true;
          const indiaTest = /\b(india|nse|bse|nifty|sensex|rbi|rupee|inr|sebi)\b/i;
          return indiaTest.test(text);
        }
        if (regionFilter === 'US') {
          const usTest = /\b(us|usa|nasdaq|nyse|fed|dollar|usd|wall street|s&p)\b/i;
          return usTest.test(text) && !key.startsWith('INDIA_');
        }
        return true;
      });

      if (matchingSignals.length > 0) {
        const tickers = new Set<string>();
        for (const s of matchingSignals) {
          if (s.symbol) tickers.add(s.symbol);
        }

        buckets.push({
          bucket_name: key,
          label: config.label,
          severity_color: config.severity_color,
          severity_icon: config.severity_icon,
          signal_count: matchingSignals.length,
          article_count: matchingSignals.length,
          key_tickers: [...tickers].slice(0, 8),
          signals: matchingSignals.slice(0, 10).map((s: any) => ({
            id: s.symbol || key,
            headline: s.headline || s.narrative || `${s.symbol}: ${s.eventType || 'Signal'}`,
            summary: s.narrative || s.summary || '',
            source: s.source || 'Intelligence',
            date: s.date || s.timestamp || new Date().toISOString(),
            ticker: s.symbol || '',
            severity: s.signalTierV7 === 'ACTIONABLE' ? 'HIGH' : 'MEDIUM',
          })),
        });
      }
    }

    // Sort by signal count descending
    buckets.sort((a, b) => b.signal_count - a.signal_count);

    return NextResponse.json({
      success: true,
      total_articles: allSignals.length,
      buckets,
    });
  } catch (error) {
    console.error('[Bottleneck API] Error:', error);
    return NextResponse.json({
      success: true,
      total_articles: 0,
      buckets: [],
    });
  }
}
