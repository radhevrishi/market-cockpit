import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ── RSS Feed Sources ──────────────────────────────────────────────────
const RSS_FEEDS = [
  // ── India Feeds ──
  { name: 'ET Markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', region: 'IN' },
  { name: 'ET Industry', url: 'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms', region: 'IN' },
  { name: 'Livemint Markets', url: 'https://www.livemint.com/rss/markets', region: 'IN' },
  { name: 'Livemint Companies', url: 'https://www.livemint.com/rss/companies', region: 'IN' },
  { name: 'Business Standard', url: 'https://www.business-standard.com/rss/markets-106.rss', region: 'IN' },
  { name: 'BS Companies', url: 'https://www.business-standard.com/rss/companies-101.rss', region: 'IN' },
  { name: 'NDTV Profit', url: 'https://feeds.feedburner.com/ndtvprofit-latest', region: 'IN' },
  { name: 'Mint Economy', url: 'https://www.livemint.com/rss/economy', region: 'IN' },
  // ── US / Global Feeds ──
  { name: 'CNBC Top News', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', region: 'US' },
  { name: 'CNBC World', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362', region: 'US' },
  { name: 'CNBC Finance', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', region: 'US' },
  { name: 'CNBC Technology', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19854910', region: 'US' },
  { name: 'MarketWatch Top Stories', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', region: 'US' },
  { name: 'MarketWatch Markets', url: 'https://feeds.marketwatch.com/marketwatch/marketpulse/', region: 'US' },
  { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', region: 'US' },
  { name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews', region: 'US' },
  { name: 'Reuters Technology', url: 'https://feeds.reuters.com/reuters/technologyNews', region: 'US' },
  { name: 'Reuters India', url: 'https://feeds.reuters.com/reuters/INbusinessNews', region: 'GLOBAL' },
  { name: 'Investing.com News', url: 'https://www.investing.com/rss/news.rss', region: 'US' },
  { name: 'Seeking Alpha Market News', url: 'https://seekingalpha.com/market_currents.xml', region: 'US' },
  // ── Semiconductor / Tech Supply Chain Feeds ──
  { name: 'Tom\'s Hardware', url: 'https://www.tomshardware.com/feeds/all', region: 'US' },
  { name: 'AnandTech', url: 'https://www.anandtech.com/rss/', region: 'US' },
  { name: 'The Register', url: 'https://www.theregister.com/headlines.atom', region: 'US' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', region: 'US' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', region: 'US' },
  { name: 'SemiWiki', url: 'https://semiwiki.com/feed/', region: 'US' },
];

const CACHE_KEY = 'news:articles:v1';
const CACHE_TTL = 300; // 5 min
const BOTTLENECK_PERSISTENT_KEY = 'bottleneck:articles:persistent';
const BOTTLENECK_TTL = 7776000; // 90 days in seconds

// ── Type Classification ──────────────────────────────────────────────
function classifyArticle(title: string, desc: string): { article_type: string; investment_tier: number } {
  const text = (title + ' ' + desc).toLowerCase();

  // ── 1. NOISE: clickbait, lifestyle, junk ──
  if (/multibagger|penny stock|should you buy|stock(s)? to buy|hot stock|best (stock|pick)|free tips|moneymaker|money.?maker|horoscope|recipe|cricket|bollywood|celebrity|entertainment|march madness|bracket|winnings|entry fee/i.test(text))
    return { article_type: 'GENERAL', investment_tier: 3 };

  // ── 2. EARNINGS ──
  if (/earnings|quarterly|q[1-4]\s?(fy|20)|profit|revenue|results|beats? expectations?|miss(es|ed)? expectations?|guidance (raise|lower|maintain|reaffirm)|eps /i.test(text))
    return { article_type: 'EARNINGS', investment_tier: 1 };

  // ── 3. MARKET MOVES — index rallies, selloffs ──
  if (/\b(dow|s&p|nasdaq|sensex|nifty|hang seng|nikkei)\b.{0,30}\b(surge|rally|jump|soar|rocket|climb|rise|fall|drop|crash|tank|slip|gain|lose)/i.test(text))
    return { article_type: 'MACRO', investment_tier: 2 };

  // ── 4. CEASEFIRE / PEACE / GENERAL WAR NEWS → GEOPOLITICAL (NOT bottleneck) ──
  if (/ceasefire|cease.?fire|peace (deal|agreement|talk)|truce|armistice|de-escalat|hostilities|fragile.*truce|fragile.*ceasefire/i.test(text))
    return { article_type: 'GEOPOLITICAL', investment_tier: 2 };

  // ── 5. GEOPOLITICAL — war, conflict, Iran general, Russia general ──
  if (/geopolit|war.{0,20}(conflict|impact|risk|cost|threat|deepen|escala)|military.{0,15}(attack|strike|operation)|china.*taiwan.*tension|iran.{0,20}(war|attack|strike|bomb|missile|ceasefire|truce|hostil)|russia.{0,15}(ukraine|war|invasion)|missile.*strike|south china sea|nato.*rift|conquest|hormuz.{0,20}(open|toll|limitation|disrupt|block|threat)|strait of hormuz/i.test(text))
    return { article_type: 'GEOPOLITICAL', investment_tier: 2 };

  // ── 6. MACRO — central bank, inflation, GDP, yields, Fed, RBI ──
  if (/\b(rbi|federal reserve|fed rate|fed.{0,10}(signal|patience|rate|cut|hike|meeting|minutes|decision)|inflation (data|report|reading|risk|linger|outlook)|gdp|rate cut|rate hike|monetary policy|fiscal (policy|deficit)|trade deficit|current account|treasury yield|bond yield|cpi|pce|fomc|recession|stagflation|interest rate)\b/i.test(text))
    return { article_type: 'MACRO', investment_tier: 1 };

  // ── 7. TARIFF / TRADE (generic trade policy, not supply-chain-specific) ──
  if (/tariff|sanction.*trade|export ban|import duty|custom duty|trade restrict|trade war|embargo|protectionism/i.test(text))
    return { article_type: 'TARIFF', investment_tier: 1 };

  // ── 8. OIL / ENERGY PRICE (price commentary, not supply constraint) ──
  // Oil price movements, OPEC news, crude trends → MACRO, not bottleneck
  if (/\b(oil price|crude oil|crude price|brent crude|wti crude|opec|oil (gain|rise|drop|fall|surge|rally|slip)|oil production|oil (shock|embargo)|fuel price|petrol price|diesel price|natural gas price|energy security)\b/i.test(text))
    return { article_type: 'MACRO', investment_tier: 1 };

  // ── 9. BOTTLENECK — STRICT: only structural supply constraints ──
  // These are REAL bottlenecks: semiconductor supply, memory cycles, photonics,
  // compute infrastructure, nuclear energy, critical minerals, logistics disruptions,
  // defence procurement, pharma supply, agriculture constraints, EV/auto transitions
  if (/bottleneck|supply chain (disruption|crisis|bottleneck|constraint)|supply shortage|capacity constraint/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  // Semiconductor & Chip supply
  if (/\b(semiconductor|wafer|foundry|fab (capacity|expansion|construction)|tsmc|asml|chip (shortage|supply|demand|ban|export|production|capacity)|chip export|advanced packaging|osat|eda tool|chip equipment|lithograph)\b/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  // Photonics & optical interconnects
  if (/\b(photonics|photonic|silicon photonics|optical (chip|interconnect|transceiver)|co-packaged optics|optical (network|switch))\b/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  // Memory & storage cycles
  if (/\b(hbm|hbm2|hbm3|dram (price|supply|demand|cycle|shortage)|nand (price|supply|demand|cycle|shortage)|memory chip|memory (cycle|supply|demand|constraint|shortage)|flash memory|3d nand)\b/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  // AI infrastructure & compute constraints
  if (/\b(gpu (shortage|demand|supply|allocation|constraint)|ai (infrastructure|chip|server|spending|demand)|data center (capacity|power|constraint|build|expansion)|cloud capacity|hyperscal.{0,10}(build|invest|spend|capacity)|compute (capacity|constraint|shortage)|ai accelerator|tpu|inference.*constraint|training.*compute)\b/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  // Nuclear energy (India + global)
  if (/\b(nuclear (reactor|power|plant|energy|fuel|capacity|project|deal|pact|milestone)|atomic (reactor|energy)|thorium|breeder reactor|kalpakkam|kudankulam|npcil|bhavini|nuclear commission|criticality|atomic energy commission)\b/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  // Critical minerals & rare earths
  if (/\b(rare earth|lithium (supply|price|mining|shortage)|cobalt (supply|price)|copper (shortage|price|supply)|nickel (supply|price)|aluminium (price|shortage)|aluminum (price|shortage)|steel (price|shortage)|mineral supply|critical mineral|titanium supply)\b/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  // Logistics & shipping disruptions
  if (/\b(shipping (delay|crisis|disruption)|freight rate|container shortage|port (congestion|strike)|red sea.{0,15}(attack|disrupt)|suez.{0,10}block|panama.{0,10}drought|trade route disruption|cargo delay|logistics (disruption|delay|crisis))\b/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  // Defence procurement (India + US)
  if (/\b(defence (order|procurement|deal|budget|corridor|export)|defense (order|procurement|contract|budget|spending)|drdo|isro|hal (order|deliver)|military (spending|procurement)|pentagon (budget|spend|contract))\b/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  // Pharma supply constraints
  if (/\b(drug (shortage|approval)|usfda|fda (approval|warning)|api (supply|shortage)|pharma.*supply|bulk drug|pharma export)\b/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  // Agriculture & food supply constraints
  if (/\b(monsoon|crop (failure|output|damage)|food inflation|fertilizer (shortage|subsidy)|agriculture crisis|food crisis)\b/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  // Auto & EV transition supply constraints
  if (/\b(ev (sales|production|battery|shift)|electric vehicle.{0,15}(production|supply|battery)|battery (plant|gigafactory|supply|shortage)|auto (production|component|export))\b/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  // Energy infrastructure (renewables, hydrogen, power grid — NOT price commentary)
  if (/\b(solar (capacity|install|project|panel|power project)|wind (farm|capacity|offshore|energy)|renewable (energy|capacity|investment|project)|hydrogen (economy|production|fuel|cell)|power (grid|crisis|shortage)|energy transition|nuclear power|uranium (price|supply|mining)|clean energy)\b/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  // India infrastructure bottlenecks
  if (/\b(infrastructure (order|bottleneck|spend)|highway (project|order|delay)|railway (order|electrif|expansion)|cement (demand|price|supply)|construction (order|delay))\b/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  // India banking structural (NOT general RBI news)
  if (/\b(npa|credit (growth|crunch|squeeze)|nbfc (crisis|liquidity)|lending rate.*squeeze|liquidity (crisis|squeeze)|banking reform)\b/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  // ── 10. RATING CHANGES ──
  if (/upgrade|downgrade|rating|target price|buy|sell|hold|outperform|underperform/i.test(text))
    return { article_type: 'RATING_CHANGE', investment_tier: 1 };

  // ── 11. CORPORATE ──
  if (/merger|acquisition|takeover|buyback|demerger|stake|fundraise|ipo|ofs|qip/i.test(text))
    return { article_type: 'CORPORATE', investment_tier: 2 };

  return { article_type: 'GENERAL', investment_tier: 2 };
}

// ── Ticker extraction ────────────────────────────────────────────────
const JUNK_TICKERS = new Set(['ON', 'A', 'IT', 'ALL', 'AN', 'IS', 'ARE', 'OR', 'SO', 'GO', 'DO', 'HE', 'WE', 'AI', 'IN', 'AT', 'TO', 'BY', 'US']);

function extractTickers(title: string): string[] {
  // Look for NSE-style tickers in title: ALL CAPS words 2-15 chars
  const words = title.match(/\b[A-Z]{2,15}\b/g) || [];
  return words.filter(w => !JUNK_TICKERS.has(w) && w.length >= 2).slice(0, 3);
}

// ── Region detection ─────────────────────────────────────────────────
function detectRegion(title: string, desc: string, feedRegion: string): string {
  if (feedRegion === 'US') return 'US';
  const text = (title + ' ' + desc).toLowerCase();
  if (/\b(nifty|sensex|bse|nse|rbi|india|rupee|inr|sebi)\b/.test(text)) return 'IN';
  if (/\b(nasdaq|s&p|dow|fed|wall street|nyse|usd|us market)\b/.test(text)) return 'US';
  return feedRegion || 'IN';
}

// ── Impact Statement Generation ─────────────────────────────────────
function generateImpact(title: string, desc: string, article_type: string): string {
  const text = (title + ' ' + desc).toLowerCase();

  // Map patterns to impact statements
  const patterns: Array<[RegExp, string]> = [
    (/semiconductor|wafer|fab|tsmc|asml|foundry/, 'Supply chain constraint affecting chip production capacity'),
    (/nuclear|reactor|atomic|thorium|breeder|npcil|kudankulam|kalpakkam/, 'Strategic energy infrastructure development'),
    (/tariff|trade war|sanction|embargo|export ban|import duty|trade restrict/, 'Trade policy shift impacting cross-border supply flows'),
    (/oil|energy|opec|crude|fuel|refinery|lng/, 'Energy supply dynamics affecting production costs'),
    (/ai|gpu|data center|hyperscal|nvidia|compute|inference/, 'Compute infrastructure demand-supply gap'),
    (/memory|dram|nand|hbm|memory chip|memory cycle/, 'Memory supply cycle affecting tech hardware margins'),
    (/photonic|photonics|silicon photonics/, 'Next-gen interconnect technology for AI infrastructure'),
    (/defense|defence|military|pentagon|drdo|hal|procurement/, 'Defence procurement and strategic capability development'),
    (/rare earth|lithium|cobalt|copper|nickel|aluminium|aluminum/, 'Critical mineral supply constraints impacting manufacturing'),
    (/monsoon|crop|fertilizer|agriculture|food/, 'Agricultural output cycles affecting commodity supply'),
    (/rbi|federal reserve|fed rate|inflation|interest rate|repo rate/, 'Monetary policy impacting capital flows and cost of financing'),
    (/shipping|port|freight|red sea|suez|supply chain|logistics/, 'Logistics bottleneck affecting supply chain timelines'),
    (/auto|ev|electric vehicle|battery/, 'Automotive transition driving component demand shifts'),
    (/pharmaceutical|fda|drug|api|medicine/, 'Healthcare supply chain and regulatory impact'),
    (/geopolit|china|taiwan|russia|ukraine|iran/, 'Geopolitical risk affecting supply chains and markets'),
  ];

  for (const [pattern, statement] of patterns) {
    if (pattern.test(text)) {
      return statement;
    }
  }

  // Default statement for bottleneck articles
  if (article_type === 'BOTTLENECK') {
    return 'Supply chain or market constraint with structural implications';
  }

  return '';
}

// ── Fetch all RSS feeds ──────────────────────────────────────────────
async function fetchAllNews(): Promise<any[]> {
  const articles: any[] = [];

  const feedResults = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      const items: any[] = [];
      try {
        const res = await fetch(feed.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(5000),
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
          const pubDate = content.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
          const link = content.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';
          const desc = content.match(/<description>([\s\S]*?)<\/description>/)?.[1]
            ?.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').trim() || '';

          if (!title || title.length < 10) continue;

          const { article_type, investment_tier } = classifyArticle(title, desc);
          const tickers = extractTickers(title);
          const region = detectRegion(title, desc, feed.region);

          items.push({
            id: `rss-${Buffer.from(link || title).toString('base64').slice(0, 20)}`,
            title,
            headline: title,
            summary: desc.slice(0, 300),
            source_name: feed.name,
            source: feed.name,
            source_url: link,
            published_at: pubDate || new Date().toISOString(),
            region,
            article_type,
            investment_tier,
            tickers: tickers,
            primary_ticker: tickers[0] || null,
            sentiment: null,
            importance_score: investment_tier === 1 ? 0.8 : investment_tier === 2 ? 0.5 : 0.2,
          });
        }
      } catch { /* skip failed feeds */ }
      return items;
    })
  );

  for (const result of feedResults) {
    if (result.status === 'fulfilled') {
      articles.push(...result.value);
    }
  }

  // Sort by date descending
  articles.sort((a, b) => {
    const da = new Date(a.published_at).getTime() || 0;
    const db = new Date(b.published_at).getTime() || 0;
    return db - da;
  });

  // Dedup by title similarity
  const seen = new Set<string>();
  const deduped = articles.filter(a => {
    const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 500);

  // Add impact statements to all articles
  const articlesWithImpact = deduped.map(a => ({
    ...a,
    impact_statement: generateImpact(a.title, a.summary, a.article_type),
  }));

  // Save BOTTLENECK articles to persistent KV storage (90-day TTL)
  const bottleneckArticles = articlesWithImpact.filter(a => a.article_type === 'BOTTLENECK');
  if (bottleneckArticles.length > 0) {
    try {
      let persistentArticles: any[] = [];
      try {
        persistentArticles = await kvGet<any[]>(BOTTLENECK_PERSISTENT_KEY) || [];
      } catch {
        persistentArticles = [];
      }

      // Merge new articles with existing ones, dedup by title
      const titleSet = new Set<string>();
      const merged = [
        ...bottleneckArticles,
        ...persistentArticles.filter(a => {
          const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
          if (titleSet.has(key)) return false;
          titleSet.add(key);
          return true;
        }),
      ];

      // Keep the deduplicated merged list
      const finalMerged = merged.filter(a => {
        const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
        if (titleSet.has(key)) return false;
        titleSet.add(key);
        return true;
      });

      await kvSet(BOTTLENECK_PERSISTENT_KEY, finalMerged, BOTTLENECK_TTL);
    } catch (error) {
      console.error('[News API] Failed to save bottleneck articles to persistent storage:', error);
      // Continue without error
    }
  }

  return articlesWithImpact;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region') || 'ALL';
    const search = searchParams.get('search') || '';
    const type = searchParams.get('type') || '';

    // Try cache first
    let articles: any[] | null = null;
    try {
      articles = await kvGet<any[]>(CACHE_KEY);
    } catch {}

    if (!articles || articles.length === 0) {
      articles = await fetchAllNews();
      // Cache the results
      try { await kvSet(CACHE_KEY, articles, CACHE_TTL); } catch {}
    }

    // If filtering for BOTTLENECK type, also load persistent bottleneck articles
    if (type === 'BOTTLENECK') {
      try {
        const persistentBottlenecks = await kvGet<any[]>(BOTTLENECK_PERSISTENT_KEY) || [];
        // Merge persistent articles with fresh ones, avoiding duplicates
        const titleSet = new Set<string>();
        const merged = [
          ...articles.filter(a => a.article_type === 'BOTTLENECK'),
          ...persistentBottlenecks.filter(a => {
            const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
            if (titleSet.has(key)) return false;
            titleSet.add(key);
            return true;
          }),
        ];
        articles = merged;
      } catch (error) {
        console.error('[News API] Failed to load persistent bottleneck articles:', error);
        // Continue with fresh articles only
      }
    }

    // Apply filters
    let filtered = articles;
    if (type && type !== '') {
      filtered = filtered.filter(a => a.article_type === type);
    }
    if (region && region !== 'ALL') {
      filtered = filtered.filter(a => a.region === region || a.region === 'GLOBAL');
    }
    if (search) {
      const terms = search.toLowerCase().split('|');
      filtered = filtered.filter(a => {
        const text = (a.title + ' ' + a.summary + ' ' + (a.tickers || []).join(' ')).toLowerCase();
        return terms.some(t => text.includes(t));
      });
    }

    return NextResponse.json(filtered);
  } catch (error) {
    console.error('[News API] Error:', error);
    return NextResponse.json([], { status: 200 }); // Return empty array, not error
  }
}
