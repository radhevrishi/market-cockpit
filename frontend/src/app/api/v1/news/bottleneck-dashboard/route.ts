import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ── NOISE REJECTION: These are NOT bottlenecks ──────────────────────
// CEO/management changes, legal disputes, stock tips, generic macro commentary, long-term themes
const NOISE_REJECT = /\b(ceo exit|ceo resigns|ceo appoint|cfo change|md change|board appoint|legal case|lawsuit|court order|winding up|insolvency|multibagger|penny stock|stocks? to buy|should you buy|top \d+ (stock|pick)|hot stock|free tips|expert (says|recommends)|target price|buy or sell|form def|form 10-k|form 8-k|form 4|proxy statement|annual meeting)\b/i;

// ── BOTTLENECK SIGNAL WORDS: At least one must appear for an article to qualify ──
// These indicate actual supply-side constraints, cost shocks, capacity issues
const BOTTLENECK_SIGNAL = /\b(shortage|squeeze|supply crunch|supply crisis|supply shock|supply constraint|capacity constraint|bottleneck|disruption|disrupted|stockpile|stockout|rationing|panic buy|price surge|price spike|price hike|cost surge|cost spike|record high price|record premium|soaring price|soaring cost|surging price|surging cost|doubled|tripled|crisis|crunch|embargo|blockade|shut down|closure|sanctions? impact|sanctions? hit|curb|restrict|ban|duty hike|tariff impact|tariff hit|margin compression|margin squeeze|input cost|raw material cost|wage pressure|labor shortage|freight spike|shipping crisis|port congestion|refinery outage|power outage|grid stress|grid overload|fuel crisis|fuel shortage|chip shortage|wafer shortage|memory shortage|component shortage|medicine shortage|drug shortage|food shortage|water crisis|inventory depletion|backlog|lead time|delivery delay|allocation|undersupply|oversold|overbooked|export curb|import ban)\b/i;

// ── Bottleneck bucket definitions ────────────────────────────────────
// Each bucket must: represent a systemic supply-side constraint → multi-sector impact
const BOTTLENECK_BUCKETS: Record<string, { label: string; keywords: RegExp; severity_color: string; severity_icon: string; priority: number }> = {
  // ── Global (both regions) ──
  SEMICONDUCTOR: {
    label: 'Semiconductor & Chip Supply',
    keywords: /\b(semiconductor|chip shortage|wafer|foundry|fab capacity|tsmc|asml|hbm|dram shortage|nand|memory shortage|gpu shortage|chip supply|chip curb|chip restrict|chip ban|export curb.*chip)\b/i,
    severity_color: '#DC2626',
    severity_icon: '🔴',
    priority: 1,
  },
  ENERGY_CRISIS: {
    label: 'Energy & Fuel Crisis',
    keywords: /\b(oil.*(surge|spike|record|crisis|shock|shortage)|crude.*(surge|spike|record|150|shortage)|opec.*(cut|restrict|quota)|fuel.*(crisis|shortage|surge|spike|panic|ration)|diesel.*(surge|spike|shortage)|petrol.*(surge|spike|shortage)|jet fuel.*(surge|spike)|refinery.*(outage|shutdown|closure)|hormuz|strait.*(block|close|shut)|lng.*(shortage|crisis|surge)|power.*(crisis|outage|grid|shortage|blackout)|electricity.*(crisis|shortage|surge)|energy.*(crisis|shock|shortage|surge))\b/i,
    severity_color: '#CA8A04',
    severity_icon: '🟡',
    priority: 2,
  },
  SUPPLY_CHAIN: {
    label: 'Global Supply Chain Disruption',
    keywords: /\b(supply chain.*(disrupt|crisis|stress|constraint|bottleneck)|logistics.*(crisis|disrupt|jam)|shipping.*(crisis|surge|disrupt|delay)|freight.*(surge|spike|crisis)|container.*(shortage|surge)|port.*(congestion|closure|blockade)|suez|panama.*(canal|block)|red sea.*(disrupt|attack|crisis)|trade route.*(disrupt|block)|shipping.*(cost|rate).*(surge|spike|record))\b/i,
    severity_color: '#D97706',
    severity_icon: '🟠',
    priority: 3,
  },
  AI_INFRA_CAPACITY: {
    label: 'AI Infrastructure Bottleneck',
    keywords: /\b(data center.*(capacity|shortage|constraint|bottleneck|power)|gpu.*(shortage|allocation|waitlist|backlog)|ai chip.*(shortage|constraint|supply)|compute.*(capacity|shortage|constraint|bottleneck)|cloud.*(capacity|constraint|shortage)|hyperscal.*(capacity|power|constraint)|power grid.*(stress|overload|constraint).*data center)\b/i,
    severity_color: '#EA580C',
    severity_icon: '🟠',
    priority: 4,
  },
  // ── India-specific ──
  INDIA_BANKING: {
    label: 'India Banking & Liquidity',
    keywords: /\b(rbi.*(rate|policy|liquidity|tighten|restrict|crunch|npa)|credit.*(crunch|squeeze|tighten)|npa.*(surge|spike|rise)|nbfc.*(crisis|stress|crunch|liquidity)|liquidity.*(crunch|crisis|squeeze|tighten|deficit)|repo rate.*(hike|raise)|rupee.*(fall|crash|plunge|depreciat|record low|100)|bond.*(yield|surge|spike).*india|deposit.*(war|crunch|shortage))\b/i,
    severity_color: '#2563EB',
    severity_icon: '🔵',
    priority: 5,
  },
  INDIA_AGRI: {
    label: 'India Agriculture & Food Supply',
    keywords: /\b(monsoon.*(deficit|delay|fail|weak|below)|crop.*(damage|loss|fail|shortage)|food.*(inflation|shortage|crisis|price.*surge)|wheat.*(shortage|price.*surge|export.*ban)|rice.*(shortage|price.*surge|export.*ban)|sugar.*(shortage|crisis)|onion.*(price|shortage|surge|crisis)|tomato.*(price|shortage|surge|crisis)|vegetable.*(price.*surge|shortage|inflation)|fertilizer.*(shortage|price.*surge|subsidy)|msp.*(hike|crisis)|kharif.*(delay|weak|fail)|rabi.*(delay|weak|damage))\b/i,
    severity_color: '#16A34A',
    severity_icon: '🟢',
    priority: 6,
  },
  INDIA_DEFENCE: {
    label: 'India Defence Supply Chain',
    keywords: /\b(defence.*(delay|bottleneck|shortage|constraint|supply|import)|defense.*(delay|bottleneck|shortage|procurement)|ammunition.*(shortage|supply|crisis)|missile.*(delay|supply|component)|hal.*(delay|delivery|backlog)|drdo.*(delay|trial)|military.*(procurement|supply.*chain|moderniz))\b/i,
    severity_color: '#7C3AED',
    severity_icon: '🟣',
    priority: 7,
  },
  INDIA_PHARMA: {
    label: 'India Pharma & API Supply',
    keywords: /\b(api.*(shortage|import|china.*depend|supply.*disrupt)|drug.*(shortage|price.*surge|supply.*crisis)|usfda.*(ban|warning|import.*alert|restrict)|pharma.*(supply.*chain|raw material|input cost|margin.*squeeze|api.*depend)|medicine.*(shortage|supply)|vaccine.*(shortage|supply)|bulk drug.*(shortage|import|china)|formulation.*(cost.*surge|shortage)|generic.*(shortage|supply|price))\b/i,
    severity_color: '#0891B2',
    severity_icon: '🔵',
    priority: 8,
  },
  INDIA_CHEMICAL: {
    label: 'India Chemical & Raw Material',
    keywords: /\b(chemical.*(shortage|duty|import|price.*surge|supply|constraint)|aluminium.*(squeeze|shortage|supply|surge|price.*record)|steel.*(price.*surge|shortage|duty)|metal.*(price.*surge|shortage|supply.*crisis)|raw material.*(cost.*surge|shortage|inflation)|input cost.*(surge|spike|pressure|squeeze)|commodity.*(price.*surge|squeeze|shortage))\b/i,
    severity_color: '#92400E',
    severity_icon: '🟤',
    priority: 9,
  },
  // ── US-specific ──
  US_TRADE: {
    label: 'US Trade & Tariff Impact',
    keywords: /\b(tariff.*(impact|hit|hike|raise|surge|cost|price)|trade war|trade.*(restrict|ban|sanction|embargo)|sanction.*(impact|hit|supply)|china.*(tariff|trade.*war|ban|restrict)|export.*(ban|curb|restrict|control)|import.*(duty|ban|restrict|tariff)|reshoring|nearshoring|supply.*chain.*decouple)\b/i,
    severity_color: '#B91C1C',
    severity_icon: '🔴',
    priority: 10,
  },
  US_RATE_INFLATION: {
    label: 'US Rate & Inflation Pressure',
    keywords: /\b(fed.*(rate.*hike|tighten|hawkish|restrict)|inflation.*(surge|spike|persistent|sticky|record|accelerat)|cpi.*(surge|spike|above|beat|hot)|ppi.*(surge|spike|above)|interest rate.*(surge|spike|pressure)|treasury.*(yield.*surge|yield.*spike|sell.*off)|bond.*(yield.*surge|sell.*off|crash)|stagflation|recession.*(risk|fear|warning|signal))\b/i,
    severity_color: '#0369A1',
    severity_icon: '🔵',
    priority: 11,
  },
  US_TECH_SUPPLY: {
    label: 'US Tech Supply Disruption',
    keywords: /\b(apple.*(shortage|delay|supply|constraint|component)|google.*(outage|capacity|constraint)|amazon.*(outage|aws.*disrupt|supply)|microsoft.*(outage|azure.*disrupt)|nvidia.*(shortage|allocation|supply|constraint|waitlist)|broadcom.*(supply|constraint|shortage)|amd.*(shortage|supply)|intel.*(fab|shortage|delay|supply)|tech.*(supply.*chain|component.*shortage|shortage))\b/i,
    severity_color: '#6366F1',
    severity_icon: '🟣',
    priority: 12,
  },
  US_ENERGY: {
    label: 'US Energy & Commodity Shock',
    keywords: /\b(wti.*(surge|spike|record)|brent.*(surge|spike|record)|crude oil.*(surge|spike|record|crisis|shock)|shale.*(decline|constraint)|natural gas.*(surge|spike|crisis|shortage)|lng.*(export|shortage|surge)|lithium.*(shortage|price.*surge|supply)|battery.*(shortage|supply|constraint|cost)|uranium.*(shortage|price.*surge)|ev.*(battery.*shortage|supply.*constraint|component))\b/i,
    severity_color: '#D97706',
    severity_icon: '🟠',
    priority: 13,
  },
};

// ── RSS Feeds for live bottleneck scanning ───────────────────────────
const BOTTLENECK_RSS = [
  // India
  { name: 'ET Markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', region: 'IN' },
  { name: 'ET Industry', url: 'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms', region: 'IN' },
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
  const signals: any[] = [];
  for (const r of feedResults) {
    if (r.status === 'fulfilled') signals.push(...r.value);
  }
  return signals;
}

// ── Quality gate: is this article a REAL bottleneck? ─────────────────
function isRealBottleneck(text: string): boolean {
  // Reject noise first
  if (NOISE_REJECT.test(text)) return false;
  // Must contain at least one bottleneck signal word
  return BOTTLENECK_SIGNAL.test(text);
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

    // Always fetch live RSS for broad sector/macro content
    const rssSignals = await fetchLiveRSSSignals();
    allSignals = [...allSignals, ...rssSignals];

    // Build buckets with quality gate
    const buckets: any[] = [];

    for (const [key, config] of Object.entries(BOTTLENECK_BUCKETS)) {
      const matchingSignals = allSignals.filter((s: any) => {
        const text = (s.headline || '') + ' ' + (s.narrative || '') + ' ' + (s.summary || '') + ' ' + (s.eventType || '');

        // Step 1: Must match bucket keywords
        if (!config.keywords.test(text)) return false;

        // Step 2: Quality gate — must be a real bottleneck, not noise
        if (!isRealBottleneck(text)) return false;

        const signalRegion = s.region || '';

        // Step 3: Region filter
        if (regionFilter === 'IN') {
          if (key.startsWith('INDIA_')) return true;
          if (key.startsWith('US_')) return false;
          if (signalRegion === 'IN') return true;
          if (signalRegion === 'US') return false;
          return /\b(india|nse|bse|nifty|sensex|rbi|rupee|inr|sebi)\b/i.test(text);
        }
        if (regionFilter === 'US') {
          if (key.startsWith('US_')) return true;
          if (key.startsWith('INDIA_')) return false;
          if (signalRegion === 'US') return true;
          if (signalRegion === 'IN') return false;
          return /\b(us|usa|nasdaq|nyse|fed|dollar|usd|wall street|s&p|american|united states)\b/i.test(text);
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
          priority: config.priority,
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

    // Sort: region-relevant buckets first, then by signal count
    buckets.sort((a, b) => {
      // For region-filtered views, put matching region buckets first
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
