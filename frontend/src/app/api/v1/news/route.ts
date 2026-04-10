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
  // ── Memory / Storage Cycle Feeds ──
  { name: 'DigiTimes Memory', url: 'https://www.digitimes.com/rss/memory.xml', region: 'GLOBAL' },
  { name: 'Blocks & Files', url: 'https://blocksandfiles.com/feed/', region: 'GLOBAL' },
  // ── Photonics / Optical Interconnect Feeds ──
  { name: 'Lightwave', url: 'https://www.lightwaveonline.com/rss', region: 'GLOBAL' },
  { name: 'Photonics.com', url: 'https://www.photonics.com/RSS/feeds/industry.xml', region: 'GLOBAL' },
  // ── Power / Industry Feeds ──
  { name: 'Power Technology', url: 'https://www.power-technology.com/feed/', region: 'GLOBAL' },
];

const CACHE_KEY = 'news:articles:v7'; // v7: universal constraint abstraction
const CACHE_TTL = 300; // 5 min
const BOTTLENECK_PERSISTENT_KEY = 'bottleneck:articles:persistent:v6'; // v6: universal abstraction
const BOTTLENECK_TTL = 7776000; // 90 days in seconds

// ══════════════════════════════════════════════════════════════════════
// UNIVERSAL CONSTRAINT ABSTRACTION — 2 stable dimensions, no future edits
//
// Dimension A: HARDWARE SYSTEM (what is the physical system?)
// Dimension B: PHYSICAL CONSTRAINT (what is the constraint type?)
//
// Rule: BOTTLENECK = System × Constraint. Nothing else enters.
// ══════════════════════════════════════════════════════════════════════

// ── Dimension A: Hardware / Infrastructure System Types ──
// These are STABLE categories — they describe physical systems, not tech names.
// New technologies (quantum, photonics, etc.) only enter when articles
// describe them using these system-level terms WITH a constraint.
const HARDWARE_SYSTEM = /(chip|semiconductor|wafer|fab|foundry|memory|dram|nand|hbm|packaging|chiplet|interconnect|data center|server|compute|gpu|network|infrastructure|grid|power|energy|reactor|nuclear|transmission|cooling|thermal|logistics|shipping|port|pipeline|refinery|manufacturing|production|assembly|supply chain)/i;

// ── Dimension B: Physical Constraint Types ──
// These are INVARIANT — they describe physical limits, not narratives.
const PHYSICAL_CONSTRAINT = /(constraint|shortage|bottleneck|tight|undersupply|capacity limit|scaling limit|yield issue|allocation|backlog|delay|lead time|overbooked|bandwidth limit|power limit|thermal limit|production (cut|halt|issue|limit)|supply (gap|crisis|disruption|crunch|squeeze)|demand (outstrip|outpace|exceed|overwhelm|spike|surge))/i;

// ── Breakthrough: structural milestone (not hype) ──
const BREAKTHROUGH = /(commissioned|achieves criticality|operational|goes live|first-of-its-kind|indigenous development|scaled up|record output|record capacity)/i;

// ── Implicit constraint: demand-side signals (no explicit "shortage" word) ──
const IMPLICIT_CONSTRAINT = /(surge in demand|demand spike|tight market|capacity lag|outstripping supply|demand outstrip|demand outpace|demand exceed|demand overwhelm|supply unable|running hot|sold out|waitlist|oversubscribed|fully allocated)/i;

// ── Hype / Noise suppression — these WITHOUT constraint = reject ──
const HYPE_ONLY = /(launch|announce|startup|funding|raises|partnership|unveil|demo|prototype|proof of concept|pitch|accelerator|incubator|research breakthrough)/i;

// ── India structural domains (current real bottlenecks, kept as-is) ──
const INDIA_STRUCTURAL = /(nuclear (reactor|power|plant|energy|fuel|capacity|project|milestone)|atomic (reactor|energy)|thorium|breeder reactor|kalpakkam|kudankulam|npcil|bhavini|criticality|atomic energy commission|defence (order|procurement|deal|budget|corridor|export)|defense (order|procurement|contract|budget|spending)|drdo|isro|hal (order|deliver)|drug (shortage|approval)|usfda|fda (approval|warning)|api (supply|shortage)|pharma.*supply|bulk drug|monsoon|crop (failure|output|damage)|food inflation|fertilizer (shortage|subsidy)|agriculture crisis|infrastructure (order|bottleneck|spend)|highway (project|order|delay)|railway (order|electrif|expansion)|npa|credit (growth|crunch|squeeze)|nbfc (crisis|liquidity)|banking reform)/i;

// ── Supply chain company names (only fires WITH constraint) ──
const SUPPLY_CHAIN_COMPANIES = /(tsmc|asml|applied materials|lam research|sk hynix|micron|samsung semiconductor|samsung foundry|intel foundry|globalfoundries|amkor|ase group|nvidia|amd|broadcom|qualcomm|infineon|nxp|onsemi|wolfspeed|coherent|lumentum|bhel|npcil|bhavini|l&t|siemens energy|ge vernova|cameco)/i;

// ── CEO signal (only fires WITH supply/capacity context) ──
const CEO_SIGNAL = /(jensen huang|lisa su|pat gelsinger|cc wei|peter wennink|sundar pichai|satya nadella|sam altman|sanjay mehrotra|morris chang).{0,40}(supply|capacity|shortage|bottleneck|constraint|infrastructure|chip|semiconductor|compute|fab|data center|power)/i;

// ══════════════════════════════════════════════════════════════════════
// INVESTMENT MAPPING — maps system keywords to beneficiary companies
// ══════════════════════════════════════════════════════════════════════
const INVESTMENT_MAP: Record<string, string[]> = {
  semiconductor: ['TSMC', 'ASML', 'AMAT'],
  memory: ['Micron', 'SK Hynix', 'Samsung'],
  packaging: ['TSMC', 'ASE', 'Amkor'],
  photonics: ['Lumentum', 'Coherent Corp'],
  ai_infra: ['Nvidia', 'Amazon', 'Microsoft'],
  power: ['Siemens Energy', 'GE Vernova'],
  nuclear: ['BHEL', 'L&T', 'Cameco'],
  india_ems: ['Kaynes Technology', 'Syrma SGS', 'Dixon Technologies'],
};

function getInvestmentTickers(text: string): string[] {
  const tickers: string[] = [];
  if (/semiconductor|wafer|fab|tsmc|asml|foundry|lithograph/i.test(text)) tickers.push(...INVESTMENT_MAP.semiconductor);
  if (/hbm|dram|nand|memory|sk hynix|micron/i.test(text)) tickers.push(...INVESTMENT_MAP.memory);
  if (/packaging|chiplet|interposer|cowos/i.test(text)) tickers.push(...INVESTMENT_MAP.packaging);
  if (/photonics|optical|interconnect|co-packaged/i.test(text)) tickers.push(...INVESTMENT_MAP.photonics);
  if (/ai|gpu|data center|compute/i.test(text)) tickers.push(...INVESTMENT_MAP.ai_infra);
  if (/power grid|electricity|transmission|transformer/i.test(text)) tickers.push(...INVESTMENT_MAP.power);
  if (/nuclear|thorium|reactor|npcil|bhavini/i.test(text)) tickers.push(...INVESTMENT_MAP.nuclear);
  if (/kaynes|syrma|dixon|india.{0,10}(ems|pcb)/i.test(text)) tickers.push(...INVESTMENT_MAP.india_ems);
  return [...new Set(tickers)];
}

// ══════════════════════════════════════════════════════════════════════
// CLASSIFIER — Priority chain with universal constraint abstraction
// ══════════════════════════════════════════════════════════════════════
function classifyArticle(title: string, desc: string): { article_type: string; investment_tier: number } {
  const text = (title + ' ' + desc).toLowerCase();

  // ── 1. NOISE: clickbait, lifestyle, junk ──
  if (/multibagger|penny stock|should you buy|stock(s)? to buy|hot stock|best (stock|pick)|free tips|moneymaker|money.?maker|horoscope|recipe|cricket|bollywood|celebrity|entertainment|march madness|bracket|winnings|entry fee/i.test(text))
    return { article_type: 'GENERAL', investment_tier: 3 };

  // ══════════════════════════════════════════════════════════════════
  // UNIVERSAL BOTTLENECK RULE (no future edits needed)
  // HARDWARE_SYSTEM × PHYSICAL_CONSTRAINT → BOTTLENECK
  // ══════════════════════════════════════════════════════════════════
  const isSystem = HARDWARE_SYSTEM.test(text);
  const isConstraint = PHYSICAL_CONSTRAINT.test(text);
  const isBreakthrough = BREAKTHROUGH.test(text);
  const isHype = HYPE_ONLY.test(text);

  // Rule 1: System + Constraint → BOTTLENECK (core rule)
  if (isSystem && isConstraint) {
    // Hype suppression: if ONLY hype terms + no real constraint words, reject
    if (isHype && !/(shortage|bottleneck|constraint|tight|undersupply|limit|backlog|delay|crisis|disruption)/i.test(text)) {
      // fall through — this is hype, not constraint
    } else {
      return { article_type: 'BOTTLENECK', investment_tier: 1 };
    }
  }

  // Rule 2: System + Breakthrough → BOTTLENECK (structural milestone)
  if (isSystem && isBreakthrough) {
    return { article_type: 'BOTTLENECK', investment_tier: 1 };
  }

  // Rule 2b: Implicit constraint detection (demand-side signals without explicit "shortage")
  // Captures: "HBM demand outstrips supply", "DRAM running hot", etc.
  if (
    /(hbm|dram|nand|ddr5|memory|photonics|optical interconnect|co-packaged optics|cowos|advanced packaging)/i.test(text) &&
    IMPLICIT_CONSTRAINT.test(text)
  ) {
    return { article_type: 'BOTTLENECK', investment_tier: 1 };
  }

  // Rule 2c: Photonics-specific override (next bottleneck after power + packaging)
  if (
    /(silicon photonics|co-packaged optics|optical interconnect|cpo)/i.test(text) &&
    /(scaling|bandwidth|limit|bottleneck|power constraint|capacity|adoption|traction|deployment)/i.test(text)
  ) {
    return { article_type: 'BOTTLENECK', investment_tier: 1 };
  }

  // Rule 2d: Memory company + memory term (company-led signals)
  // Memory bottlenecks are often announced via company earnings/guidance, not generic headlines
  if (
    /(sk hynix|micron|samsung)/i.test(text) &&
    /(hbm|dram|capacity|supply|allocation|lead time|pricing|margin|shortage)/i.test(text)
  ) {
    return { article_type: 'BOTTLENECK', investment_tier: 1 };
  }

  // Rule 2e: Enhanced memory detection (underweight area)
  if (
    /(hbm3e?|dram|ddr5|nand|memory)/i.test(text) &&
    /(tight|shortage|undersupply|pricing pressure|allocation|lead time|constraint)/i.test(text)
  ) {
    return { article_type: 'BOTTLENECK', investment_tier: 1 };
  }

  // Rule 3: India structural domains (nuclear, defence, pharma, agri, infra, banking)
  // These are CURRENT real bottlenecks in Indian production supply chains
  if (INDIA_STRUCTURAL.test(text)) {
    return { article_type: 'BOTTLENECK', investment_tier: 1 };
  }

  // Rule 4: Known supply chain company + constraint → BOTTLENECK
  if (SUPPLY_CHAIN_COMPANIES.test(text) && isConstraint) {
    return { article_type: 'BOTTLENECK', investment_tier: 1 };
  }

  // Rule 5: CEO signal with supply/capacity context
  if (CEO_SIGNAL.test(text)) {
    return { article_type: 'BOTTLENECK', investment_tier: 1 };
  }

  // ── 2. EARNINGS ──
  if (/earnings|quarterly|q[1-4]\s?(fy|20)|profit|revenue|results|beats? expectations?|miss(es|ed)? expectations?|guidance (raise|lower|maintain|reaffirm)|eps /i.test(text))
    return { article_type: 'EARNINGS', investment_tier: 1 };

  // ── 3. MARKET MOVES — index rallies, selloffs ──
  if (/\b(dow|s&p|nasdaq|sensex|nifty|hang seng|nikkei)\b.{0,30}\b(surge|rally|jump|soar|rocket|climb|rise|fall|drop|crash|tank|slip|gain|lose)/i.test(text))
    return { article_type: 'MACRO', investment_tier: 2 };

  // ── 4. CEASEFIRE / PEACE → GEOPOLITICAL ──
  if (/ceasefire|cease.?fire|peace (deal|agreement|talk)|truce|armistice|de-escalat/i.test(text))
    return { article_type: 'GEOPOLITICAL', investment_tier: 2 };

  // ── 5. GEOPOLITICAL ──
  if (/geopolit|war.{0,20}(conflict|impact|risk|cost|threat)|military.{0,15}(attack|strike|operation)|china.*taiwan.*tension|iran.{0,20}(war|attack|strike|bomb|missile)|russia.{0,15}(ukraine|war|invasion)|missile.*strike|south china sea/i.test(text))
    return { article_type: 'GEOPOLITICAL', investment_tier: 2 };

  // ── 6. MACRO ──
  if (/\b(rbi|federal reserve|fed rate|fed.{0,10}(signal|patience|rate|cut|hike|meeting|minutes|decision)|inflation (data|report|reading|risk)|gdp|rate cut|rate hike|monetary policy|fiscal (policy|deficit)|trade deficit|treasury yield|bond yield|cpi|pce|fomc|recession|stagflation|interest rate)\b/i.test(text))
    return { article_type: 'MACRO', investment_tier: 1 };

  // ── 7. TARIFF / TRADE ──
  if (/tariff|sanction.*trade|export ban|import duty|custom duty|trade restrict|trade war|embargo|protectionism/i.test(text))
    return { article_type: 'TARIFF', investment_tier: 1 };

  // ── 8. OIL / COMMODITY PRICE (price, not supply constraint) ──
  if (/\b(oil|crude|brent|copper|lithium|gas)\b.{0,15}\b(price|rise|gain|drop|fall|surge|tank|hover)\b/i.test(text)) {
    // Supply fear without real constraint → MACRO, not BOTTLENECK
    if (/supply (fear|concern|worry)/i.test(text) && !PHYSICAL_CONSTRAINT.test(text)) {
      return { article_type: 'MACRO', investment_tier: 1 };
    }
    return { article_type: 'MACRO', investment_tier: 1 };
  }
  if (/\b(oil price|crude oil|crude price|brent crude|wti crude|opec|fuel price|petrol price|diesel price|natural gas price|energy security)\b/i.test(text))
    return { article_type: 'MACRO', investment_tier: 1 };

  // ── 9. RATING CHANGES ──
  if (/upgrade|downgrade|rating|target price|buy|sell|hold|outperform|underperform/i.test(text))
    return { article_type: 'RATING_CHANGE', investment_tier: 1 };

  // ── 10. CORPORATE ──
  if (/merger|acquisition|takeover|buyback|demerger|stake|fundraise|ipo|ofs|qip/i.test(text))
    return { article_type: 'CORPORATE', investment_tier: 2 };

  return { article_type: 'GENERAL', investment_tier: 2 };
}

// ── Ticker extraction ────────────────────────────────────────────────
const JUNK_TICKERS = new Set(['ON', 'A', 'IT', 'ALL', 'AN', 'IS', 'ARE', 'OR', 'SO', 'GO', 'DO', 'HE', 'WE', 'AI', 'IN', 'AT', 'TO', 'BY', 'US']);

function extractTickers(title: string): string[] {
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

  const patterns: [RegExp, string][] = [
    [/packaging|chiplet|interposer|cowos|hybrid bonding/, 'Advanced packaging capacity constraint — direct compute bottleneck'],
    [/semiconductor|wafer|fab|tsmc|asml|foundry/, 'Chip production capacity constraint'],
    [/hbm3e?.*constraint|hbm.*tight|hbm.*shortage|hbm.*allocation/, 'HBM supply constraint — highest margin memory segment'],
    [/(sk hynix|micron|samsung).{0,20}(hbm|dram|capacity|supply)/, 'Memory company supply signal — watch capacity/allocation'],
    [/hbm|dram.*shortage|memory.*constraint|memory.*tight/, 'Memory supply cycle — capacity/allocation constraint'],
    [/ddr5|nand.*tight|nand.*shortage/, 'Memory supply cycle — DDR5/NAND capacity constraint'],
    [/memory|dram|nand/, 'Memory supply cycle affecting hardware margins'],
    [/silicon photonics|co-packaged optics|cpo/, 'Silicon photonics — next-gen interconnect bottleneck'],
    [/photonic|optical|interconnect|co-packaged/, 'Optical/interconnect bandwidth or scaling constraint'],
    [/nuclear|reactor|atomic|thorium|breeder|npcil|kalpakkam/, 'Strategic energy infrastructure — long-cycle structural constraint'],
    [/power grid|electricity|transmission|transformer/, 'Power/grid capacity constraint'],
    [/data center|server|compute|gpu|ai.*infrastructure/, 'Compute infrastructure demand-supply gap'],
    [/cooling|thermal/, 'Thermal/cooling capacity constraint'],
    [/shipping|port|freight|logistics|supply chain/, 'Logistics/supply chain disruption'],
    [/defence|defense|military|drdo|hal|isro/, 'Defence procurement and strategic capability'],
    [/drug|pharma|fda|usfda|api/, 'Healthcare supply chain constraint'],
    [/monsoon|crop|fertilizer|agriculture|food/, 'Agricultural supply cycle'],
    [/rare earth|lithium|cobalt|copper|nickel|mineral/, 'Critical mineral supply constraint'],
    [/tariff|trade war|sanction|embargo/, 'Trade policy impacting supply flows'],
    [/oil|energy|opec|crude|fuel/, 'Energy supply dynamics'],
    [/auto|ev|electric vehicle|battery/, 'Automotive transition demand shift'],
    [/infrastructure|highway|railway|cement/, 'India infrastructure constraint'],
    [/npa|credit|nbfc|liquidity|banking/, 'Banking/credit structural constraint'],
    [/geopolit|china|taiwan|russia|ukraine|iran/, 'Geopolitical supply chain risk'],
  ];

  for (const [pattern, statement] of patterns) {
    if (pattern.test(text)) return statement;
  }

  if (article_type === 'BOTTLENECK') return 'Physical system constraint with structural implications';
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

  // ── IBEF India Economy News (HTML scrape — no RSS available) ──
  try {
    const ibefRes = await fetch('https://www.ibef.org/indian-economy-news', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(5000),
    });
    if (ibefRes.ok) {
      const html = await ibefRes.text();
      const linkRegex = /<a[^>]+href="(\/indian-economy-news\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let ibefMatch;
      let ibefCount = 0;
      const ibefSeen = new Set<string>();
      while ((ibefMatch = linkRegex.exec(html)) !== null && ibefCount < 25) {
        const href = ibefMatch[1];
        const inner = ibefMatch[2].replace(/<[^>]*>/g, '').trim();
        if (!inner || inner.length < 15 || ibefSeen.has(inner)) continue;
        ibefSeen.add(inner);
        ibefCount++;
        const fullUrl = `https://www.ibef.org${href}`;
        const { article_type, investment_tier } = classifyArticle(inner, '');
        const tickers = extractTickers(inner);
        articles.push({
          id: `ibef-${Buffer.from(href).toString('base64').slice(0, 20)}`,
          title: inner, headline: inner, summary: '',
          source_name: 'IBEF', source: 'IBEF', source_url: fullUrl,
          published_at: new Date().toISOString(), region: 'IN',
          article_type, investment_tier, tickers,
          primary_ticker: tickers[0] || null, sentiment: null,
          importance_score: investment_tier === 1 ? 0.8 : 0.5,
        });
      }
      const h3Regex = /<h[34][^>]*>\s*<a[^>]+href="([^"]*indian-economy-news[^"]*)"[^>]*>\s*([\s\S]*?)\s*<\/a>\s*<\/h[34]>/g;
      let h3Match;
      while ((h3Match = h3Regex.exec(html)) !== null && ibefCount < 40) {
        const href = h3Match[1];
        const inner = h3Match[2].replace(/<[^>]*>/g, '').trim();
        if (!inner || inner.length < 15 || ibefSeen.has(inner)) continue;
        ibefSeen.add(inner);
        ibefCount++;
        const fullUrl = href.startsWith('http') ? href : `https://www.ibef.org${href}`;
        const { article_type, investment_tier } = classifyArticle(inner, '');
        const tickers = extractTickers(inner);
        articles.push({
          id: `ibef-${Buffer.from(href).toString('base64').slice(0, 20)}`,
          title: inner, headline: inner, summary: '',
          source_name: 'IBEF', source: 'IBEF', source_url: fullUrl,
          published_at: new Date().toISOString(), region: 'IN',
          article_type, investment_tier, tickers,
          primary_ticker: tickers[0] || null, sentiment: null,
          importance_score: investment_tier === 1 ? 0.8 : 0.5,
        });
      }
    }
  } catch { /* IBEF scrape failed — non-critical */ }

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
  });

  // Per-source cap for diversity
  const PER_SOURCE_CAP = 8;
  const sourceCount: Record<string, number> = {};
  const diversified = deduped.filter(a => {
    const src = a.source_name || a.source || 'unknown';
    if (!sourceCount[src]) sourceCount[src] = 0;
    if (sourceCount[src] >= PER_SOURCE_CAP) return false;
    sourceCount[src]++;
    return true;
  }).slice(0, 500);

  // Add impact statements + investment tickers
  const articlesWithImpact = diversified.map(a => ({
    ...a,
    impact_statement: generateImpact(a.title, a.summary, a.article_type),
    investment_tickers: a.article_type === 'BOTTLENECK' ? getInvestmentTickers(a.title + ' ' + a.summary) : [],
  }));

  // ── Persistence: save structural bottleneck articles to KV ──
  const DAY = 86400;
  const bottleneckArticles = articlesWithImpact.filter(a => a.article_type === 'BOTTLENECK');
  if (bottleneckArticles.length > 0) {
    try {
      let persistentArticles: any[] = [];
      try {
        persistentArticles = await kvGet<any[]>(BOTTLENECK_PERSISTENT_KEY) || [];
      } catch {
        persistentArticles = [];
      }

      // Only persist articles where system + constraint is real
      const structuralBottlenecks = bottleneckArticles.filter(a => {
        const t = (a.title + ' ' + (a.summary || '')).toLowerCase();
        return HARDWARE_SYSTEM.test(t) && PHYSICAL_CONSTRAINT.test(t);
      });

      const titleSet = new Set<string>();
      const merged = [
        ...structuralBottlenecks,
        ...persistentArticles.filter(a => {
          const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
          if (titleSet.has(key)) return false;
          titleSet.add(key);
          return true;
        }),
      ];
      const finalMerged = merged.filter(a => {
        const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
        if (titleSet.has(key)) return false;
        titleSet.add(key);
        return true;
      });

      // Tiered TTL: nuclear/thorium milestones = 180 days, rest = 90 days
      const hasNuclearSignal = finalMerged.some((a: any) => {
        const t = (a.title + ' ' + (a.summary || '')).toLowerCase();
        return /(fast breeder|thorium|nuclear milestone|criticality|npcil|bhavini|kalpakkam)/i.test(t);
      });
      const persistTTL = hasNuclearSignal ? 180 * DAY : 90 * DAY;
      await kvSet(BOTTLENECK_PERSISTENT_KEY, finalMerged, persistTTL);
    } catch (error) {
      console.error('[News API] Failed to save bottleneck articles to persistent storage:', error);
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

    let articles: any[] | null = null;
    try {
      articles = await kvGet<any[]>(CACHE_KEY);
    } catch {}

    if (!articles || articles.length === 0) {
      articles = await fetchAllNews();
      try { await kvSet(CACHE_KEY, articles, CACHE_TTL); } catch {}
    }

    // Load persistent bottleneck articles when filtering for BOTTLENECK
    if (type === 'BOTTLENECK') {
      try {
        const persistentBottlenecks = await kvGet<any[]>(BOTTLENECK_PERSISTENT_KEY) || [];
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
      } catch {
        // Continue with fresh articles only
      }
    }

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
    return NextResponse.json([], { status: 200 });
  }
}
