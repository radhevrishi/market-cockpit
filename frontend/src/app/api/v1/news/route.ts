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
];

const CACHE_KEY = 'news:articles:v1';
const CACHE_TTL = 300; // 5 min

// ── Type Classification ──────────────────────────────────────────────
function classifyArticle(title: string, desc: string): { article_type: string; investment_tier: number } {
  const text = (title + ' ' + desc).toLowerCase();

  // Noise filter FIRST — reject clickbait, listicles, lifestyle
  if (/multibagger|penny stock|should you buy|stock(s)? to buy|hot stock|best (stock|pick)|free tips|moneymaker|money.?maker|horoscope|recipe|cricket|bollywood|celebrity|entertainment/i.test(text))
    return { article_type: 'GENERAL', investment_tier: 3 };

  // Check EARNINGS first — "beats expectations", "raises guidance" etc. are earnings, not bottlenecks
  if (/earnings|quarterly|q[1-4]\s?(fy|20)|profit|revenue|results|beats? expectations?|miss(es|ed)? expectations?|guidance (raise|lower|maintain|reaffirm)|eps /i.test(text))
    return { article_type: 'EARNINGS', investment_tier: 1 };

  // MARKET MOVES — index rallies, selloffs, daily market wraps
  if (/\b(dow|s&p|nasdaq|sensex|nifty|hang seng|nikkei)\b.{0,30}\b(surge|rally|jump|soar|rocket|climb|rise|fall|drop|crash|tank|slip|gain|lose)/i.test(text))
    return { article_type: 'MACRO', investment_tier: 2 };

  // BOTTLENECK — supply constraints, shortages, capacity limits, strategic sector developments
  // Must match all themes covered by the bottleneck dashboard buckets
  if (/bottleneck|supply chain|shortage|capacity constraint|chip (shortage|supply|demand|ban|export)|semiconductor|wafer|foundry|fab|tsmc|asml|photonics|photonic|silicon photonics|hbm|dram|nand|memory chip|memory cycle|gpu (shortage|demand|supply)|nvidia|data center|ai (infrastructure|chip|server|spending|demand|boom)|cloud capacity|hyperscal|oil (price|supply|shortage|production)|crude oil|opec|energy crisis|fuel (shortage|price)|refinery|lng|coal (shortage|price)|power (crisis|shortage|grid)|nuclear (reactor|power|plant|energy|fuel|capacity)|atomic (reactor|energy)|thorium|breeder reactor|kalpakkam|kudankulam|npcil|tariff|trade war|sanction|embargo|export ban|import duty|trade restrict|rare earth|lithium|cobalt|copper (price|shortage)|steel (price|shortage)|aluminium|aluminum|nickel|supply chain disruption|shipping (delay|crisis)|freight rate|port (congestion|strike)|red sea|suez|rbi (policy|rate)|repo rate|npa|credit (growth|crunch)|nbfc|sebi|defense budget|defence budget|pentagon|military spending|defence (order|procurement)|drdo|isro|hal|pharma.*fda|usfda|drug (approval|shortage)|api supply|monsoon|crop (failure|output)|food inflation|fertilizer|auto (sale|production)|ev (sales|production|battery)|electric vehicle|infrastructure (order|bottleneck)|highway|railway|cement (demand|price)|fed rate|federal reserve|fomc|inflation (data|report)|cpi|pce|bond yield|recession|geopolit|us.china|china.*tariff|taiwan.*chip|iran.*(oil|sanction|nuclear)|russia.*(oil|gas|sanction)|ukraine|shale|pipeline|renewable|solar|wind energy|uranium|hydrogen|climate policy/i.test(text))
    return { article_type: 'BOTTLENECK', investment_tier: 1 };

  if (/upgrade|downgrade|rating|target price|buy|sell|hold|outperform|underperform/i.test(text))
    return { article_type: 'RATING_CHANGE', investment_tier: 1 };

  // MACRO — central bank, inflation, GDP
  if (/\b(rbi|federal reserve|fed rate|inflation data|gdp|rate cut|rate hike|monetary policy|fiscal (policy|deficit)|trade deficit|current account)\b/i.test(text))
    return { article_type: 'MACRO', investment_tier: 1 };

  if (/tariff|sanction.*trade|export ban|import duty|custom duty|trade restrict/i.test(text))
    return { article_type: 'TARIFF', investment_tier: 1 };

  // GEOPOLITICAL — tightened: require conflict/tension/attack context, not bare country names
  if (/geopolit|war.*conflict|military.*attack|military.*strike|china.*taiwan.*tension|iran.*attack|iran.*strike|russia.*ukraine|missile.*strike|south china sea.*conflict/i.test(text))
    return { article_type: 'GEOPOLITICAL', investment_tier: 2 };

  // CEASEFIRE / PEACE — separate category, not bottleneck
  if (/ceasefire|cease fire|peace (deal|agreement|talk)|truce|armistice|de-escalat/i.test(text))
    return { article_type: 'GEOPOLITICAL', investment_tier: 2 };

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
  return articles.filter(a => {
    const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 200);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region') || 'ALL';
    const search = searchParams.get('search') || '';

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

    // Apply filters
    let filtered = articles;
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
