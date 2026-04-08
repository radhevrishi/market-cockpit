import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ── Bottleneck bucket definitions (broad keyword approach) ──────────
// Simple, broad keyword matching — catches everything relevant.
// NO quality gate, NO constraint signal check, NO noise filter.
const BOTTLENECK_BUCKETS: Record<string, {
  label: string;
  description: string;
  keywords: RegExp;
  severity_color: string;
  severity_icon: string;
}> = {
  // ── GLOBAL / SECTOR BUCKETS ──
  SEMICONDUCTOR: {
    label: 'Semiconductor & Chip Supply',
    description: 'Chip supply constraints, fab capacity, memory cycles, photonics, and export controls affecting semiconductor ecosystem',
    keywords: /\b(semiconductor|chip|wafer|foundry|fab|tsmc|samsung foundry|intel fab|asml|hbm|dram|nand|memory|gpu shortage|photonics|silicon|lithograph|osat|packaging|chip export|chip ban|photonic|optical chip|silicon photonics|chip deal|chip revenue|chip boom|memory chip)\b/i,
    severity_color: '#DC2626',
    severity_icon: '🔴',
  },
  AI_INFRASTRUCTURE: {
    label: 'AI Infrastructure & Data Centers',
    description: 'GPU/accelerator demand, data center capacity, AI compute spending, and cloud infrastructure constraints',
    keywords: /\b(data center|gpu|nvidia|ai infrastructure|cloud capacity|hyperscal|power grid|ai chip|compute capacity|ai server|ai spending|ai investment|ai demand|ai boom|accelerator|tpu|tensor processing)\b/i,
    severity_color: '#EA580C',
    severity_icon: '🟠',
  },
  ENERGY: {
    label: 'Energy & Power',
    description: 'Oil, gas, coal, and power supply dynamics including OPEC, refinery output, and energy pricing',
    keywords: /\b(oil|crude|opec|natural gas|coal|power|electricity|energy crisis|fuel|refinery|lng|petrol|diesel|brent|wti|energy price|gasoline|heating oil|oil price|oil supply|oil production|strait of hormuz|hormuz)\b/i,
    severity_color: '#CA8A04',
    severity_icon: '🟡',
  },
  SUPPLY_CHAIN: {
    label: 'Global Supply Chain',
    description: 'Logistics disruptions, shipping delays, port congestion, and trade route issues',
    keywords: /\b(supply chain|logistics|shipping|freight|container|port|suez|panama|red sea|trade route|import|export|cargo|warehouse|inventory|stockpile|backlog|transshipment)\b/i,
    severity_color: '#D97706',
    severity_icon: '🟠',
  },
  TARIFF_TRADE: {
    label: 'Tariff & Trade War',
    description: 'Tariff escalations, trade restrictions, sanctions, and protectionist policies',
    keywords: /\b(tariff|trade war|sanction|embargo|import duty|custom duty|trade restrict|export ban|export curb|trade barrier|anti.dumping|countervailing|protectionism|reshoring|nearshoring|decouple|friendshoring)\b/i,
    severity_color: '#B91C1C',
    severity_icon: '🔴',
  },
  COMMODITY_METALS: {
    label: 'Commodity & Metal Supply',
    description: 'Critical metals, minerals, and commodity supply dynamics including rare earths',
    keywords: /\b(aluminium|aluminum|steel|copper|zinc|nickel|lithium|cobalt|rare earth|iron ore|metal price|commodity|mining|mineral|titanium|tin|lead|gold price|silver price|palladium|platinum)\b/i,
    severity_color: '#92400E',
    severity_icon: '🟤',
  },
  // ── INDIA-SPECIFIC BUCKETS ──
  INDIA_BANKING: {
    label: 'India Banking & Credit',
    description: 'RBI policy, credit growth, NPA stress, NBFC liquidity, and SEBI regulations',
    keywords: /\b(rbi|npa|credit growth|bank|nbfc|lending|loan|deposit|liquidity|repo rate|monetary policy|sebi|mutual fund|sbi|hdfc|icici|axis bank|kotak)\b/i,
    severity_color: '#2563EB',
    severity_icon: '🔵',
  },
  INDIA_AGRI: {
    label: 'India Agriculture & Food',
    description: 'Monsoon impact, crop output, food inflation, and fertilizer supply',
    keywords: /\b(monsoon|crop|agriculture|food|wheat|rice|sugar|fertilizer|msp|kharif|rabi|farm|agri|onion|tomato|vegetable|food inflation|edible oil|soybean)\b/i,
    severity_color: '#16A34A',
    severity_icon: '🟢',
  },
  INDIA_DEFENCE: {
    label: 'India Defence & Aerospace',
    description: 'Defence procurement, military modernization, DRDO/ISRO/HAL developments, and security',
    keywords: /\b(defence|defense|military|missile|fighter|hal|bhel|drdo|isro|satellite|aerospace|ammunition|navy|army|air force|warship|submarine|radar|defense budget|defence budget)\b/i,
    severity_color: '#7C3AED',
    severity_icon: '🟣',
  },
  INDIA_PHARMA: {
    label: 'India Pharma & Healthcare',
    description: 'Drug approvals, USFDA actions, API supply, and healthcare sector developments',
    keywords: /\b(pharma|drug|fda|usfda|anda|api|formulation|hospital|healthcare|vaccine|biotech|generic|clinical trial|medicine|cipla|sun pharma|dr reddy|lupin|divi)\b/i,
    severity_color: '#0891B2',
    severity_icon: '🔵',
  },
  INDIA_INFRA: {
    label: 'India Infrastructure & Real Estate',
    description: 'Highway, railway, metro, port, airport, and real estate sector developments',
    keywords: /\b(infrastructure|highway|road|railway|metro|smart city|real estate|housing|cement|construction|bridge|tunnel|port|airport|rera|affordable housing|dlf|godrej|l&t)\b/i,
    severity_color: '#6D28D9',
    severity_icon: '🟣',
  },
  INDIA_AUTO: {
    label: 'India Auto & EV',
    description: 'Auto sales, EV transition, battery supply, and vehicle manufacturing trends',
    keywords: /\b(auto|automobile|car|vehicle|ev|electric vehicle|tata motors|maruti|mahindra|bajaj|hero|two wheeler|suv|battery|charging|ola electric|ather)\b/i,
    severity_color: '#059669',
    severity_icon: '🟢',
  },
  INDIA_NUCLEAR: {
    label: 'India Nuclear & Atomic Energy',
    description: 'Nuclear reactor milestones, atomic energy program, thorium cycle, and nuclear power capacity',
    keywords: /\b(nuclear reactor|atomic reactor|nuclear power|atomic energy|thorium|breeder reactor|kalpakkam|bhabha|nuclear fuel|criticality|nuclear plant|atomic plant|uranium india|nuclear capacity|fast breeder|nuclear milestone)\b/i,
    severity_color: '#0E7490',
    severity_icon: '⚛️',
  },
  // ── US-SPECIFIC BUCKETS ──
  US_TECH: {
    label: 'US Tech & Innovation',
    description: 'Big tech earnings, AI race, cloud computing, and Silicon Valley developments',
    keywords: /\b(apple|google|microsoft|amazon|meta|tesla|netflix|alphabet|openai|chatgpt|artificial intelligence|machine learning|big tech|tech stock|silicon valley|cloud computing|saas|cybersecurity|quantum|spacex)\b/i,
    severity_color: '#3B82F6',
    severity_icon: '🔵',
  },
  US_FINANCE: {
    label: 'US Finance & Fed',
    description: 'Federal Reserve policy, inflation data, bond yields, and Wall Street developments',
    keywords: /\b(fed|federal reserve|interest rate|rate hike|rate cut|inflation|cpi|pce|treasury|bond yield|wall street|jpmorgan|goldman|bank of america|citigroup|morgan stanley|recession|stagflation|fomc|powell)\b/i,
    severity_color: '#1E40AF',
    severity_icon: '🔵',
  },
  US_TRADE: {
    label: 'US Trade & Geopolitics',
    description: 'US-China tensions, Iran/Middle East, sanctions, and trade policy developments',
    keywords: /\b(china trade|us china|taiwan|geopolit|pentagon|nato|ukraine|russia|iran|middle east|south china sea|trade deal|trade deficit|commerce department|treasury department|state department|biden|trump|executive order)\b/i,
    severity_color: '#991B1B',
    severity_icon: '🔴',
  },
  US_ENERGY: {
    label: 'US Energy & Climate',
    description: 'Shale, LNG, renewables, nuclear power, EV battery supply, and energy transition',
    keywords: /\b(shale|permian|natural gas|lng export|oil rig|pipeline|renewable|solar|wind energy|nuclear|uranium|ev battery|lithium|clean energy|carbon|climate|epa|energy transition|hydrogen)\b/i,
    severity_color: '#D97706',
    severity_icon: '🟠',
  },
  US_DEFENCE: {
    label: 'US Defence & Military',
    description: 'Defense budget, Pentagon spending, military procurement, and defense tech',
    keywords: /\b(defense budget|defence budget|pentagon|military spending|defense spending|defense contract|lockheed|raytheon|northrop|boeing defense|general dynamics|l3harris|defense startup|military tech|arms deal|weapons system|trillion.*defense|defense.*trillion|fighter jet|f-35|f-16|naval|aircraft carrier)\b/i,
    severity_color: '#581C87',
    severity_icon: '🟣',
  },
};

// Severity calculation based on signal count
function getSeverity(signalCount: number): { severity: number; severity_label: string } {
  if (signalCount >= 10) return { severity: 5, severity_label: 'CRITICAL' };
  if (signalCount >= 5)  return { severity: 4, severity_label: 'HIGH' };
  if (signalCount >= 3)  return { severity: 3, severity_label: 'ELEVATED' };
  if (signalCount >= 1)  return { severity: 2, severity_label: 'WATCH' };
  return { severity: 1, severity_label: 'LOW' };
}

// ── RSS Feeds for live scanning ─────────────────────────────────────
const BOTTLENECK_RSS = [
  // India
  { name: 'ET Markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', region: 'IN' },
  { name: 'ET Industry', url: 'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms', region: 'IN' },
  { name: 'Livemint Markets', url: 'https://www.livemint.com/rss/markets', region: 'IN' },
  { name: 'Livemint Companies', url: 'https://www.livemint.com/rss/companies', region: 'IN' },
  { name: 'Business Standard', url: 'https://www.business-standard.com/rss/markets-106.rss', region: 'IN' },
  { name: 'BS Companies', url: 'https://www.business-standard.com/rss/companies-101.rss', region: 'IN' },
  { name: 'Mint Economy', url: 'https://www.livemint.com/rss/economy', region: 'IN' },
  // US / Global
  { name: 'CNBC Top News', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', region: 'US' },
  { name: 'CNBC Technology', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19854910', region: 'US' },
  { name: 'CNBC World', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362', region: 'US' },
  { name: 'CNBC Finance', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', region: 'US' },
  { name: 'MarketWatch Top', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', region: 'US' },
  { name: 'MarketWatch Markets', url: 'https://feeds.marketwatch.com/marketwatch/marketpulse/', region: 'US' },
  { name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews', region: 'US' },
  { name: 'Reuters Tech', url: 'https://feeds.reuters.com/reuters/technologyNews', region: 'US' },
  { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', region: 'US' },
  { name: 'Investing.com', url: 'https://www.investing.com/rss/news.rss', region: 'US' },
  { name: 'Seeking Alpha', url: 'https://seekingalpha.com/market_currents.xml', region: 'US' },
];

// ── Fetch live RSS feeds ────────────────────────────────────────────
async function fetchLiveRSSSignals(): Promise<any[]> {
  const feedResults = await Promise.allSettled(
    BOTTLENECK_RSS.map(async (feed) => {
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
        while ((match = itemRegex.exec(xml)) !== null && count < 30) {
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
            narrative: desc.slice(0, 400),
            summary: desc.slice(0, 400),
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
  const signals: any[] = [];
  for (const r of feedResults) {
    if (r.status === 'fulfilled') signals.push(...r.value);
  }
  return signals;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const regionFilter = searchParams.get('region') || 'ALL';

    // Read from intelligence signals KV
    const stored = await kvGet<any>('intelligence:signals');
    let allSignals: any[] = [];
    if (stored) {
      allSignals = [
        ...(stored.signals || []),
        ...(stored.notable || []),
        ...(stored.observations || []),
      ];
    }

    // Always fetch live RSS — this is critical for broad coverage
    const rssSignals = await fetchLiveRSSSignals();
    allSignals = [...allSignals, ...rssSignals];

    // Build buckets — simple broad keyword matching, NO quality gate
    const buckets: any[] = [];

    for (const [key, config] of Object.entries(BOTTLENECK_BUCKETS)) {
      const matchingSignals = allSignals.filter((s: any) => {
        const text = (s.headline || '') + ' ' + (s.narrative || '') + ' ' + (s.summary || '') + ' ' + (s.eventType || '');
        if (!config.keywords.test(text)) return false;

        // Region filter
        if (regionFilter === 'IN') {
          if (key.startsWith('INDIA_')) return true;
          if (key.startsWith('US_')) return false;
          // Global buckets: check for India context or accept if from IN feed
          if (s.region === 'IN') return true;
          const indiaTest = /\b(india|nse|bse|nifty|sensex|rbi|rupee|inr|sebi|crore|lakh)\b/i;
          return indiaTest.test(text);
        }
        if (regionFilter === 'US') {
          if (key.startsWith('US_')) return true;
          if (key.startsWith('INDIA_')) return false;
          // Global buckets: check for US context or accept if from US feed
          if (s.region === 'US') return true;
          const usTest = /\b(us|usa|nasdaq|nyse|fed|dollar|usd|wall street|s&p|american|united states)\b/i;
          return usTest.test(text);
        }
        return true; // ALL region
      });

      if (matchingSignals.length > 0) {
        const tickers = new Set<string>();
        for (const s of matchingSignals) {
          if (s.symbol) tickers.add(s.symbol);
        }

        // Dedup by headline similarity
        const seen = new Set<string>();
        const dedupedSignals = matchingSignals.filter(s => {
          const k = (s.headline || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

        const { severity, severity_label } = getSeverity(dedupedSignals.length);

        buckets.push({
          bucket_id: key,
          bucket_name: key,
          label: config.label,
          description: config.description,
          severity,
          severity_label,
          severity_color: config.severity_color,
          severity_icon: config.severity_icon,
          signal_count: dedupedSignals.length,
          article_count: dedupedSignals.length,
          key_tickers: [...tickers].slice(0, 8),
          signals: dedupedSignals.slice(0, 10).map((s: any) => ({
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

    // Sort: region-specific buckets first, then by signal count
    buckets.sort((a, b) => {
      if (regionFilter === 'US') {
        const aUS = a.bucket_name.startsWith('US_') ? 0 : 1;
        const bUS = b.bucket_name.startsWith('US_') ? 0 : 1;
        if (aUS !== bUS) return aUS - bUS;
      }
      if (regionFilter === 'IN') {
        const aIN = a.bucket_name.startsWith('INDIA_') ? 0 : 1;
        const bIN = b.bucket_name.startsWith('INDIA_') ? 0 : 1;
        if (aIN !== bIN) return aIN - bIN;
      }
      return b.signal_count - a.signal_count;
    });

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
