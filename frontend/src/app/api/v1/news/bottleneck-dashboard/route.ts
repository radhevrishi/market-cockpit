import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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
  US_TECH: {
    label: 'US Tech & Big Tech',
    keywords: /\b(apple|google|microsoft|amazon|meta|nvidia|tesla|amd|intel|qualcomm|broadcom|alphabet|magnificent seven|mag 7|faang|big tech|tech stock|silicon valley|nasdaq|ai stock)\b/i,
    severity_color: '#6366F1',
    severity_icon: '🟣',
  },
  US_FINANCE: {
    label: 'US Banking & Finance',
    keywords: /\b(jpmorgan|goldman|morgan stanley|bank of america|wells fargo|citigroup|fed|federal reserve|treasury|yield|bond|wall street|s&p 500|dow jones|interest rate|rate cut|rate hike|inflation|cpi|ppi|fomc|powell)\b/i,
    severity_color: '#0369A1',
    severity_icon: '🔵',
  },
  US_TRADE: {
    label: 'US Trade & Tariffs',
    keywords: /\b(tariff|trade war|trade deficit|import duty|export ban|sanction|embargo|china trade|us-china|trade deal|custom duty|wto|nafta|usmca|reshoring|nearshoring)\b/i,
    severity_color: '#B91C1C',
    severity_icon: '🔴',
  },
  US_ENERGY: {
    label: 'US Energy & Commodities',
    keywords: /\b(wti|brent|crude oil|shale|fracking|natural gas|lng export|renewable|solar|wind energy|ev|electric vehicle|lithium|battery|uranium|nuclear)\b/i,
    severity_color: '#D97706',
    severity_icon: '🟠',
  },
};

// ── RSS Fallback when KV is empty ────────────────────────────────────
const FALLBACK_RSS = [
  // India
  { name: 'ET Markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', region: 'IN' },
  { name: 'Livemint Markets', url: 'https://www.livemint.com/rss/markets', region: 'IN' },
  { name: 'Business Standard', url: 'https://www.business-standard.com/rss/markets-106.rss', region: 'IN' },
  // US / Global
  { name: 'CNBC Top News', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', region: 'US' },
  { name: 'CNBC Technology', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19854910', region: 'US' },
  { name: 'MarketWatch Top', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', region: 'US' },
  { name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews', region: 'US' },
  { name: 'Reuters Tech', url: 'https://feeds.reuters.com/reuters/technologyNews', region: 'US' },
  { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', region: 'US' },
  { name: 'Investing.com', url: 'https://www.investing.com/rss/news.rss', region: 'US' },
];

async function fetchRSSFallbackSignals(): Promise<any[]> {
  const signals: any[] = [];
  const feedResults = await Promise.allSettled(
    FALLBACK_RSS.map(async (feed) => {
      const items: any[] = [];
      try {
        const res = await fetch(feed.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) return items;
        const xml = await res.text();
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;
        let count = 0;
        while ((match = itemRegex.exec(xml)) !== null && count < 25) {
          count++;
          const content = match[1];
          const title = content.match(/<title>([\s\S]*?)<\/title>/)?.[1]
            ?.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() || '';
          const desc = content.match(/<description>([\s\S]*?)<\/description>/)?.[1]
            ?.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').trim() || '';
          const pubDate = content.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
          if (!title || title.length < 10) continue;
          items.push({
            headline: title,
            narrative: desc.slice(0, 300),
            summary: desc.slice(0, 300),
            source: feed.name,
            region: feed.region,
            date: pubDate || new Date().toISOString(),
            eventType: 'News',
            symbol: '',
          });
        }
      } catch { /* skip failed feed */ }
      return items;
    })
  );
  for (const r of feedResults) {
    if (r.status === 'fulfilled') signals.push(...r.value);
  }
  return signals;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const regionFilter = searchParams.get('region') || 'ALL';

    // Read from intelligence signals
    const stored = await kvGet<any>('intelligence:signals');

    // Combine all signals from KV
    let allSignals: any[] = [];
    if (stored) {
      allSignals = [
        ...(stored.signals || []),
        ...(stored.notable || []),
        ...(stored.observations || []),
      ];
    }

    // ALWAYS fetch live RSS to ensure bottleneck buckets have broad content to match against
    // KV signals are stock-specific events; RSS provides sector/macro news needed for bottleneck detection
    const rssSignals = await fetchRSSFallbackSignals();
    allSignals = [...allSignals, ...rssSignals];

    // Build buckets
    const buckets: any[] = [];

    for (const [key, config] of Object.entries(BOTTLENECK_BUCKETS)) {
      const matchingSignals = allSignals.filter((s: any) => {
        const text = (s.headline || '') + ' ' + (s.narrative || '') + ' ' + (s.summary || '') + ' ' + (s.eventType || '');
        if (!config.keywords.test(text)) return false;

        const signalRegion = s.region || '';

        // Region filter
        if (regionFilter === 'IN') {
          // India-specific buckets always match for India
          if (key.startsWith('INDIA_')) return true;
          // US-specific buckets never match for India
          if (key.startsWith('US_')) return false;
          // If signal has region tag, use it
          if (signalRegion === 'IN') return true;
          if (signalRegion === 'US') return false;
          // Global buckets: check text for India mentions
          const indiaTest = /\b(india|nse|bse|nifty|sensex|rbi|rupee|inr|sebi)\b/i;
          return indiaTest.test(text);
        }
        if (regionFilter === 'US') {
          // US-specific buckets always match for US
          if (key.startsWith('US_')) return true;
          // India-specific buckets never match for US
          if (key.startsWith('INDIA_')) return false;
          // If signal has region tag, use it
          if (signalRegion === 'US') return true;
          if (signalRegion === 'IN') return false;
          // Global buckets: check text for US mentions
          const usTest = /\b(us|usa|nasdaq|nyse|fed|dollar|usd|wall street|s&p|american|united states)\b/i;
          return usTest.test(text);
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
