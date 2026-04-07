import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ═══════════════════════════════════════════════════════════════════════
// BOTTLENECK INTELLIGENCE ENGINE v2
// ═══════════════════════════════════════════════════════════════════════
// Core principle: Do NOT classify articles.
// Instead, detect underlying CONSTRAINTS and cluster articles into
// PERSISTENT BOTTLENECK THEMES.
//
// A bottleneck is:
//   ✅ Supply-side constraint, capacity limit, or cost shock
//   ✅ Systemic (affects multiple sectors/companies)
//   ✅ Persistent (multi-day or structural)
//   ✅ Actionable (winners/losers identifiable)
//
// A bottleneck is NOT:
//   ❌ Market commentary ("US stocks mixed")
//   ❌ Earnings reports ("Levi Strauss beats")
//   ❌ Policy opinion ("Fed may cut rates")
//   ❌ CEO/management change
//   ❌ Legal disputes
//   ❌ Stock tips/recommendations
//   ❌ Long-term tech announcements with no current constraint
// ═══════════════════════════════════════════════════════════════════════

// ── HARD REJECT: these are NEVER bottlenecks ─────────────────────────
const NOISE_REJECT = /\b(ceo (exit|resign|appoint|step)|cfo (change|resign|appoint)|md (change|resign)|board appoint|chairman (resign|appoint)|legal case|lawsuit|court order|winding up|insolvency|multibagger|penny stock|stocks? to buy|should you buy|top \d+ (stock|pick)|hot stock|free tips|expert (says|recommends)|buy or sell|form def|form 10-k|form 8-k|form 4|proxy statement|annual meeting|quarterly results|q[1-4] (results|earnings)|beats? expectation|miss(es|ed)? expectation|guidance (raise|lower|maintain|reaffirm)|stock(s)? (close|end|open|rally|gain|slip|dip|edge|rise|fall) (higher|lower|mixed|flat)|market(s)? (close|end|open|rally|edge|mixed|flat|muted)|sensex (gain|rise|fall|end)|nifty (gain|rise|fall|end)|dow (gain|rise|fall|end)|stocks? to watch|trade setup|technical analysis|support.*resistance|moving average|fibonacci|candlestick|chart pattern)\b/i;

// ── CONSTRAINT SIGNAL: article must describe a real constraint ────────
// These words indicate actual supply-side stress, not just mention of a sector
const CONSTRAINT_SIGNAL = /\b(shortag|squeez|crunch|crisis|shock|disrupt|constrain|bottleneck|deficit|depletion|backlog|rationing|panic (buy|demand)|stockout|undersupply|overbook|waitlist|allocation|lead time (extend|increas|stretch)|delivery delay|capacity (limit|cap|full|strain|max)|supply (tight|stress|crunch|shock|disrupt|constrain|deficit)|price.{0,20}(record|surge|spike|soar|jump|doubl|tripl|all.time high)|cost.{0,20}(surge|spike|soar|record|doubl|pressur)|margin.{0,20}(compress|squeez|pressur|erosion)|embargo|blockade|sanction.{0,20}(impact|hit|disrupt|restrict)|tariff.{0,20}(impact|hit|hik|rais|cost)|export (curb|ban|restrict|control)|import (ban|restrict|duty|curb)|war.{0,30}(supply|fuel|oil|energy|price|cost|disrupt|shortage)|depreciat.{0,20}(sharp|record|historic|steep)|currency.{0,20}(crash|plung|crisis)|rupee.{0,20}(fall|crash|plung|record low|100)|inflation.{0,20}(surge|spike|record|persistent|sticky|accelerat|runaway)|rate.{0,10}(hik|rais|tighten)|yield.{0,10}(surge|spike|jump|soar))\b/i;

// ═══════════════════════════════════════════════════════════════════════
// BOTTLENECK THEMES — Structural constraints, not news categories
// ═══════════════════════════════════════════════════════════════════════
// Each theme represents a PERSISTENT STRUCTURAL CONSTRAINT
// with identifiable supply-side stress and cross-sector impact

interface BottleneckTheme {
  id: string;
  label: string;
  description: string;
  keywords: RegExp;
  severity_color: string;
  severity_icon: string;
  region: 'GLOBAL' | 'US' | 'IN';
  impacted_sectors: string[];
}

const BOTTLENECK_THEMES: BottleneckTheme[] = [
  // ── GLOBAL STRUCTURAL CONSTRAINTS ──
  {
    id: 'ENERGY_SUPPLY_SHOCK',
    label: 'Energy Supply Shock',
    description: 'Oil/fuel supply disruption from geopolitical conflict, refinery constraints, or trade route closures',
    keywords: /\b(oil.{0,30}(record|surge|spike|soar|crisis|shock|shortage|premium|150|supply)|crude.{0,30}(record|surge|spike|soar|150|premium|shortage|supply)|hormuz|strait.{0,15}(block|close|shut|disrupt)|fuel.{0,20}(crisis|shortage|surge|spike|panic|ration|doubl|soar)|diesel.{0,20}(shortage|surge|spike|loss|panic)|petrol.{0,20}(shortage|surge|spike)|jet fuel.{0,20}(surge|spike|price|cost|doubl)|refinery.{0,15}(outage|shutdown|closure)|energy.{0,20}(crisis|shock|shortage|supply)|opec.{0,15}(cut|restrict|quota)|oil supply|energy price.{0,10}(soar|surge|spike|record))\b/i,
    severity_color: '#DC2626',
    severity_icon: '🔴',
    region: 'GLOBAL',
    impacted_sectors: ['Oil & Gas', 'Airlines', 'Logistics', 'Chemicals', 'FMCG', 'Paints'],
  },
  {
    id: 'SEMICONDUCTOR_CAPACITY',
    label: 'Semiconductor Capacity Constraint',
    description: 'Chip supply/demand imbalance from fab capacity limits, export controls, or demand surge',
    keywords: /\b(semiconductor.{0,20}(shortage|supply|capacity|constraint|bottleneck|demand|boom)|chip.{0,20}(shortage|supply|capacity|constraint|demand|curb|restrict|ban|boom)|wafer.{0,15}(shortage|capacity|supply)|foundry.{0,15}(capacity|constraint|backlog)|fab.{0,15}(capacity|delay|constraint|build)|tsmc|asml.{0,15}(curb|restrict|export|supply)|gpu.{0,15}(shortage|supply|allocation|demand|waitlist)|memory.{0,15}(chip|shortage|supply|pricing|cycle|boom)|dram.{0,10}(shortage|pricing|supply|demand|boom)|nand.{0,10}(shortage|supply|pricing)|hbm.{0,10}(shortage|demand|supply|capacity)|chip packaging|osat|advanced packaging|export curb.{0,30}(chip|semiconductor|lithograph))\b/i,
    severity_color: '#EF4444',
    severity_icon: '🔴',
    region: 'GLOBAL',
    impacted_sectors: ['Semiconductors', 'Tech Hardware', 'Auto', 'Consumer Electronics', 'AI/Cloud'],
  },
  {
    id: 'AI_COMPUTE_BOTTLENECK',
    label: 'AI Compute Bottleneck',
    description: 'GPU/accelerator shortage and data center power/capacity constraints limiting AI scale',
    keywords: /\b(gpu.{0,20}(shortage|allocation|waitlist|backlog|constraint|demand|supply|bottleneck)|ai.{0,10}(chip|infrastructure|compute|capacity).{0,20}(shortage|constraint|bottleneck|demand|supply|stress|limit)|data center.{0,20}(capacity|power|constraint|bottleneck|shortage|stress|demand|boom)|compute.{0,15}(capacity|shortage|constraint|bottleneck|demand)|cloud.{0,15}(capacity|constraint|shortage|demand|waitlist)|power grid.{0,20}(stress|overload|constraint|data center)|nvidia.{0,15}(shortage|allocation|supply|demand|waitlist|backlog))\b/i,
    severity_color: '#EA580C',
    severity_icon: '🟠',
    region: 'GLOBAL',
    impacted_sectors: ['Cloud/AI', 'Semiconductors', 'Data Centers', 'Power/Utilities'],
  },
  {
    id: 'SUPPLY_CHAIN_DISRUPTION',
    label: 'Supply Chain Disruption',
    description: 'Logistics/shipping/trade route disruption causing cross-border supply stress',
    keywords: /\b(supply chain.{0,20}(disrupt|crisis|stress|constraint|bottleneck|restructur)|logistics.{0,15}(crisis|disrupt|jam|cost)|shipping.{0,20}(crisis|surge|disrupt|delay|cost|rate)|freight.{0,15}(surge|spike|crisis|cost|rate)|container.{0,15}(shortage|surge|cost)|port.{0,15}(congestion|closure|blockade|delay)|suez|panama.{0,10}(canal|block)|red sea.{0,15}(disrupt|attack|crisis|divert)|trade route.{0,15}(disrupt|block|divert)|transshipment|rerouting|shipping.{0,15}(bottleneck|constraint))\b/i,
    severity_color: '#D97706',
    severity_icon: '🟠',
    region: 'GLOBAL',
    impacted_sectors: ['Ports', 'Logistics', 'Auto', 'Retail', 'Manufacturing'],
  },
  // ── INDIA-SPECIFIC STRUCTURAL CONSTRAINTS ──
  {
    id: 'INDIA_CURRENCY_STRESS',
    label: 'Rupee Depreciation Stress',
    description: 'Sharp rupee weakness driving imported inflation, margin pressure across import-dependent sectors',
    keywords: /\b(rupee.{0,20}(fall|crash|plung|depreciat|record low|weak|100|95|pressure|crisis)|inr.{0,15}(depreciat|fall|weak|pressure)|currency.{0,20}(crisis|pressure|depreciat|stress).{0,30}india|dollar.{0,20}(surge|spike|strong).{0,30}(rupee|india|import)|import.{0,20}(cost|bill|expensive).{0,30}(rupee|depreciat|currency)|current account.{0,15}(deficit|widen|pressure|stress))\b/i,
    severity_color: '#2563EB',
    severity_icon: '🔵',
    region: 'IN',
    impacted_sectors: ['Oil Marketing', 'Airlines', 'Electronics', 'Chemicals', 'Auto (imports)'],
  },
  {
    id: 'INDIA_LIQUIDITY_CRUNCH',
    label: 'India Liquidity & Credit Stress',
    description: 'RBI tightening, NPA stress, or credit crunch affecting banking/NBFC sector',
    keywords: /\b(rbi.{0,20}(rate hik|tighten|restrict|liquidity|npa|crunch|hawkish)|credit.{0,15}(crunch|squeez|tighten|stress)|npa.{0,15}(surge|spike|rise|stress|crisis)|nbfc.{0,15}(crisis|stress|crunch|liquidity)|liquidity.{0,15}(crunch|crisis|squeeze|tighten|deficit|stress)|deposit.{0,10}(war|crunch|shortage|stress)|bond yield.{0,15}(surge|spike|soar).{0,20}india|repo rate.{0,10}(hik|rais))\b/i,
    severity_color: '#1E40AF',
    severity_icon: '🔵',
    region: 'IN',
    impacted_sectors: ['Banks', 'NBFCs', 'Real Estate', 'Infra', 'SMEs'],
  },
  {
    id: 'INDIA_AGRI_FOOD_STRESS',
    label: 'India Food & Agriculture Stress',
    description: 'Monsoon failure, crop damage, food inflation, or fertilizer supply disruption',
    keywords: /\b(monsoon.{0,15}(deficit|delay|fail|weak|below)|crop.{0,15}(damage|loss|fail|shortage)|food.{0,15}(inflation|shortage|crisis|price.{0,10}(surge|spike|soar))|wheat.{0,15}(shortage|price.{0,10}surge|export.{0,5}ban)|rice.{0,15}(shortage|price.{0,10}surge|export.{0,5}ban)|onion.{0,10}(price|shortage|surge|crisis)|tomato.{0,10}(price|shortage|surge|crisis)|vegetable.{0,15}(price.{0,10}(surge|spike)|shortage|inflation)|fertilizer.{0,15}(shortage|price.{0,10}surge|subsidy|supply)|food inflation|agri.{0,10}(crisis|stress|shortage))\b/i,
    severity_color: '#16A34A',
    severity_icon: '🟢',
    region: 'IN',
    impacted_sectors: ['FMCG', 'Fertilizers', 'Agriculture', 'Food Processing'],
  },
  {
    id: 'INDIA_CHEMICAL_INPUT',
    label: 'India Chemical & Input Cost Squeeze',
    description: 'Raw material cost surge, chemical import dependency, or commodity price shock hitting margins',
    keywords: /\b(chemical.{0,20}(shortage|duty|import|price.{0,10}surge|supply|constraint|cost)|aluminium.{0,15}(squeez|shortage|supply|surge|price.{0,10}record|cost)|steel.{0,15}(price.{0,10}surge|shortage|duty|cost)|metal.{0,15}(price.{0,10}surge|shortage|supply.{0,10}crisis|cost)|raw material.{0,15}(cost.{0,10}surge|shortage|inflation|pressure)|input cost.{0,15}(surge|spike|pressure|squeez|soar)|commodity.{0,15}(price.{0,10}surge|squeez|shortage|super.cycle)|msme.{0,15}(survival|crisis|stress|cost|margin)|duty relief.{0,15}(chemical|import)|import.{0,15}(depend|expensive|cost.{0,10}surge))\b/i,
    severity_color: '#92400E',
    severity_icon: '🟤',
    region: 'IN',
    impacted_sectors: ['Chemicals', 'Metals', 'Auto', 'Packaging', 'MSMEs', 'Construction'],
  },
  {
    id: 'INDIA_PHARMA_API',
    label: 'India Pharma API Supply Risk',
    description: 'API import dependency on China, USFDA restrictions, or drug supply disruption',
    keywords: /\b(api.{0,20}(shortage|import|china.{0,10}depend|supply.{0,10}disrupt|cost)|drug.{0,15}(shortage|price.{0,10}surge|supply.{0,10}crisis)|usfda.{0,10}(ban|warning|import.{0,5}alert|restrict)|pharma.{0,20}(supply.{0,10}chain|raw material|input cost|margin.{0,10}squeez|api.{0,10}depend)|medicine.{0,10}(shortage|supply)|bulk drug.{0,15}(shortage|import|china)|formulation.{0,15}(cost.{0,10}surge|shortage))\b/i,
    severity_color: '#0891B2',
    severity_icon: '🔵',
    region: 'IN',
    impacted_sectors: ['Pharma', 'Healthcare', 'Hospitals'],
  },
  // ── US-SPECIFIC STRUCTURAL CONSTRAINTS ──
  {
    id: 'US_TARIFF_TRADE_DISRUPTION',
    label: 'US Tariff & Trade Disruption',
    description: 'Tariff hikes, trade restrictions, or sanctions disrupting supply chains and raising costs',
    keywords: /\b(tariff.{0,20}(impact|hit|hik|rais|surge|cost|price|disrupt|war)|trade war|trade.{0,15}(restrict|ban|sanction|embargo|disrupt)|sanction.{0,15}(impact|hit|supply|disrupt|cost)|china.{0,15}(tariff|trade.{0,5}war|ban|restrict|decouple)|export.{0,10}(ban|curb|restrict|control).{0,30}(chip|tech|semiconductor)|import.{0,10}(duty|ban|restrict|tariff|cost)|reshoring|nearshoring|supply.{0,10}chain.{0,10}decouple|friendshoring)\b/i,
    severity_color: '#B91C1C',
    severity_icon: '🔴',
    region: 'US',
    impacted_sectors: ['Tech Hardware', 'Semiconductors', 'Manufacturing', 'Retail', 'Auto'],
  },
  {
    id: 'US_INFLATION_RATE_SHOCK',
    label: 'US Inflation & Rate Pressure',
    description: 'Persistent inflation, Fed tightening, or yield surge creating financial stress',
    keywords: /\b(inflation.{0,20}(surge|spike|persistent|sticky|accelerat|record|runaway|hot|above)|cpi.{0,10}(surge|spike|above|beat|hot|accelerat)|fed.{0,15}(rate.{0,5}hik|tighten|hawkish|restrict|no.{0,5}cut)|interest rate.{0,15}(surge|spike|pressure|hik|higher.{0,10}longer)|treasury.{0,10}(yield.{0,10}(surge|spike|soar|jump)|sell.{0,5}off)|stagflation|recession.{0,10}(risk|fear|warning|signal|odds|probability))\b/i,
    severity_color: '#0369A1',
    severity_icon: '🔵',
    region: 'US',
    impacted_sectors: ['Banks', 'Real Estate', 'Growth Tech', 'Consumer Discretionary'],
  },
  {
    id: 'US_ENERGY_COMMODITY_SHOCK',
    label: 'US Energy & Commodity Shock',
    description: 'WTI/Brent spike, LNG/gas supply stress, or critical mineral shortage',
    keywords: /\b(wti.{0,15}(surge|spike|record|soar)|brent.{0,15}(surge|spike|record|soar)|crude oil.{0,20}(surge|spike|record|crisis|shock|soar)|natural gas.{0,15}(surge|spike|crisis|shortage|soar)|lng.{0,15}(shortage|surge|export|crisis)|lithium.{0,15}(shortage|price.{0,10}surge|supply|crisis)|battery.{0,15}(shortage|supply|constraint|cost.{0,10}surge)|uranium.{0,15}(shortage|price.{0,10}surge|supply)|rare earth.{0,15}(shortage|supply|restrict|china)|cobalt.{0,15}(shortage|supply|price)|critical mineral.{0,15}(shortage|supply|restrict))\b/i,
    severity_color: '#D97706',
    severity_icon: '🟠',
    region: 'US',
    impacted_sectors: ['Energy', 'EV/Battery', 'Utilities', 'Mining', 'Airlines'],
  },
];

// ── RSS Feeds for live constraint scanning ───────────────────────────
const BOTTLENECK_RSS = [
  // India
  { name: 'ET Markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', region: 'IN' },
  { name: 'ET Industry', url: 'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms', region: 'IN' },
  { name: 'Livemint Markets', url: 'https://www.livemint.com/rss/markets', region: 'IN' },
  { name: 'Business Standard', url: 'https://www.business-standard.com/rss/markets-106.rss', region: 'IN' },
  { name: 'BS Companies', url: 'https://www.business-standard.com/rss/companies-101.rss', region: 'IN' },
  // US / Global
  { name: 'CNBC Top News', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', region: 'US' },
  { name: 'CNBC Technology', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19854910', region: 'US' },
  { name: 'CNBC World', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362', region: 'US' },
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

// ── Quality gate: is this a REAL constraint? ─────────────────────────
function isRealConstraint(text: string): boolean {
  if (NOISE_REJECT.test(text)) return false;
  return CONSTRAINT_SIGNAL.test(text);
}

// ── Region matching ──────────────────────────────────────────────────
function matchesRegion(text: string, signalRegion: string, themeRegion: string, regionFilter: string): boolean {
  if (regionFilter === 'ALL') return true;

  if (regionFilter === 'IN') {
    if (themeRegion === 'IN') return true;
    if (themeRegion === 'US') return false;
    // GLOBAL themes: must have India context
    if (signalRegion === 'IN') return true;
    if (signalRegion === 'US') return false;
    return /\b(india|nse|bse|nifty|sensex|rbi|rupee|inr|sebi|crore|lakh)\b/i.test(text);
  }

  if (regionFilter === 'US') {
    if (themeRegion === 'US') return true;
    if (themeRegion === 'IN') return false;
    // GLOBAL themes: must have US context
    if (signalRegion === 'US') return true;
    if (signalRegion === 'IN') return false;
    return /\b(us|usa|nasdaq|nyse|fed|dollar|usd|wall street|s&p|american|united states)\b/i.test(text);
  }

  return true;
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

    // Always fetch live RSS for broad constraint scanning
    const rssSignals = await fetchLiveRSSSignals();
    allSignals = [...allSignals, ...rssSignals];

    // ── Build bottleneck themes ──────────────────────────────────────
    const buckets: any[] = [];

    for (const theme of BOTTLENECK_THEMES) {
      const matchingSignals = allSignals.filter((s: any) => {
        const text = (s.headline || '') + ' ' + (s.narrative || '') + ' ' + (s.summary || '') + ' ' + (s.eventType || '');

        // Step 1: Must match theme's constraint keywords
        if (!theme.keywords.test(text)) return false;

        // Step 2: Must be a REAL constraint, not noise
        if (!isRealConstraint(text)) return false;

        // Step 3: Region filter
        return matchesRegion(text, s.region || '', theme.region, regionFilter);
      });

      if (matchingSignals.length > 0) {
        const tickers = new Set<string>();
        for (const s of matchingSignals) {
          if (s.symbol) tickers.add(s.symbol);
        }

        // Dedup by headline similarity
        const seen = new Set<string>();
        const dedupedSignals = matchingSignals.filter(s => {
          const key = (s.headline || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        buckets.push({
          bucket_name: theme.id,
          label: theme.label,
          description: theme.description,
          severity_color: theme.severity_color,
          severity_icon: theme.severity_icon,
          signal_count: dedupedSignals.length,
          article_count: dedupedSignals.length,
          impacted_sectors: theme.impacted_sectors,
          key_tickers: [...tickers].slice(0, 8),
          signals: dedupedSignals.slice(0, 10).map((s: any) => ({
            id: s.symbol || theme.id,
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

    // Sort: region-specific themes first, then by signal count
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
