import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ════════════════════════════════════════════════════════════════════════
// NOISE FILTER — reject articles that are NOT about supply constraints
// These are market rallies, earnings, general commentary, lifestyle, etc.
// Applied BEFORE bucket keyword matching to prevent false positives.
// ════════════════════════════════════════════════════════════════════════
const NOISE_PATTERNS = /\b(stock(s)? (surge|rally|jump|soar|rocket|climb|rise|rebound|recover)|market(s)? (surge|rally|jump|soar|rocket|climb|rise|rebound|recover)|dow (surge|rally|jump|soar|rocket|climb|rise)|s&p (surge|rally|jump|soar|rocket|climb|500 up)|nasdaq (surge|rally|jump|soar|rocket|climb|rise)|sensex (surge|rally|jump|soar|rocket|climb|rise)|nifty (surge|rally|jump|soar|rocket|climb|rise)|ceasefire|cease fire|peace deal|peace agreement|peace talk|truce|armistice|de-escalat|ease worr|eas(e|ing) tension|worries ease|fears ease|concerns ease|beats? expectations?|miss(es|ed)? expectations?|quarterly (result|earning|profit)|q[1-4]\s?(fy|20)|earnings (beat|miss|surpass|top)|revenue (beat|miss|surpass)|profit (beat|miss|surpass)|guidance (raise|lower|maintain)|multibagger|penny stock|should you buy|stock(s)? to buy|hot stock|best (stock|pick|fund)|free tips|moneymaker|money.?maker|joke|light.?hearted|humour|humor|meme stock|wedding|recipe|horoscope|cricket|bollywood|celebrity|entertainment)\b/i;

// Also reject if headline is purely about stock index movements with no supply context
const PURE_MARKET_MOVE = /^.{0,15}(dow|s&p|nasdaq|sensex|nifty|hang seng|dax|ftse|nikkei|kospi).{0,60}(up|down|gain|lose|fall|drop|surge|rally|jump|slip|tank|crash|point|percent|%)/i;

function isNoise(headline: string, desc: string): boolean {
  const text = headline + ' ' + desc;
  if (NOISE_PATTERNS.test(text)) return true;
  if (PURE_MARKET_MOVE.test(headline)) return true;
  return false;
}

// ══════════════════════════════════════════════════════════════════════
// SIGNAL KEYS — High-value structural terms for primary/supporting split
// ══════════════════════════════════════════════════════════════════════
const SIGNAL_KEYS = /(hbm|dram|nand|wafer|tsmc|asml|cowos|power grid|nuclear)/i;
const STRUCTURAL_TERMS_DASH = /(wafer|fab|tsmc|asml|hbm|dram|nand|advanced packaging|cowos|chiplet|power grid|transmission|nuclear|reactor|thorium|rare earth|lithium)/i;
const CONSTRAINT_TERMS_DASH = /(shortage|constraint|bottleneck|capacity (limit|constraint|tight)|supply (gap|crisis|disruption)|production (cut|limit|issue)|yield issue|allocation|undersupply)/i;

// ════════════════════════════════════════════════════════════════════════
// BOTTLENECK BUCKET DEFINITIONS
// Each bucket targets a specific supply-chain / constraint theme.
// Keywords are tightened to require constraint-relevant context.
// ════════════════════════════════════════════════════════════════════════
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
    description: 'Chip supply constraints, fab capacity, memory cycles, photonics, and export controls',
    keywords: /\b(semiconductor|chip shortage|chip supply|chip demand|wafer|foundry|fab capacity|tsmc|samsung foundry|intel fab|asml|hbm|dram|nand|memory chip|gpu shortage|photonics|photonic|silicon photonics|optical chip|lithograph|osat|advanced packaging|chip export|chip ban|chip deal|chip revenue|chip boom|memory cycle|chip production|chip capacity|eda tool|chip equipment)\b/i,
    severity_color: '#DC2626',
    severity_icon: '🔴',
  },
  AI_INFRASTRUCTURE: {
    label: 'AI Infrastructure & Data Centers',
    description: 'GPU/accelerator demand, data center capacity, AI compute spending, cloud constraints',
    keywords: /\b(data center|gpu|nvidia|ai infrastructure|cloud capacity|hyperscal|power grid|ai chip|compute capacity|ai server|ai spending|ai investment|ai demand|ai boom|accelerator|tpu|tensor processing|inference|training.*compute)\b/i,
    severity_color: '#EA580C',
    severity_icon: '🟠',
  },
  ENERGY: {
    label: 'Energy & Power Supply',
    description: 'Oil supply disruptions, OPEC cuts, refinery constraints, energy crisis, fuel shortages',
    // Tightened: removed bare "oil" and "power" — too broad. Require supply/price/cut/crisis context.
    keywords: /\b(oil price|oil supply|oil production|oil shortage|crude oil|crude price|opec cut|opec\+|natural gas price|natural gas supply|coal shortage|coal price|power crisis|power shortage|electricity crisis|energy crisis|fuel shortage|fuel price|refinery shutdown|refinery capacity|lng supply|lng price|petrol price|diesel price|diesel shortage|brent crude|wti crude|oil embargo|oil sanction|strait of hormuz.*block|hormuz.*disrupt|hormuz.*threat|energy security)\b/i,
    severity_color: '#CA8A04',
    severity_icon: '🟡',
  },
  SUPPLY_CHAIN: {
    label: 'Global Supply Chain',
    description: 'Logistics disruptions, shipping delays, port congestion, trade route blockages',
    // Tightened: removed bare "import", "export", "port" — too broad
    keywords: /\b(supply chain disruption|supply chain crisis|supply chain bottleneck|supply shortage|logistics disruption|logistics delay|shipping delay|shipping crisis|freight rate|container shortage|port congestion|port strike|suez.*block|panama.*drought|red sea.*attack|red sea.*disrupt|trade route disruption|cargo delay|warehouse shortage|backlog|transshipment delay)\b/i,
    severity_color: '#D97706',
    severity_icon: '🟠',
  },
  TARIFF_TRADE: {
    label: 'Tariff & Trade War',
    description: 'Tariff escalations, trade restrictions, sanctions, export bans, protectionism',
    keywords: /\b(tariff|trade war|sanction|embargo|import duty|custom duty|trade restrict|export ban|export curb|trade barrier|anti.dumping|countervailing|protectionism|reshoring|nearshoring|decouple|friendshoring|trade retaliat)\b/i,
    severity_color: '#B91C1C',
    severity_icon: '🔴',
  },
  COMMODITY_METALS: {
    label: 'Commodity & Metal Supply',
    description: 'Critical metals supply constraints, mining disruptions, rare earth shortages',
    // Tightened: removed bare "commodity" and "mining" — require price/supply/shortage context
    keywords: /\b(aluminium price|aluminum price|steel price|steel shortage|copper price|copper shortage|zinc price|nickel price|nickel supply|lithium supply|lithium price|cobalt supply|cobalt price|rare earth|iron ore price|iron ore supply|metal shortage|metal price|mineral supply|titanium supply|palladium|platinum supply|commodity crisis|commodity supply|mining disruption|mining strike)\b/i,
    severity_color: '#92400E',
    severity_icon: '🟤',
  },

  // ── INDIA-SPECIFIC BUCKETS ──
  INDIA_BANKING: {
    label: 'India Banking & Credit',
    description: 'RBI policy, credit growth, NPA stress, NBFC liquidity, regulatory changes',
    // Tightened: removed bare "bank", "loan", "deposit" — too broad
    keywords: /\b(rbi policy|rbi rate|repo rate|reverse repo|npa|credit growth|credit squeeze|nbfc crisis|nbfc liquidity|lending rate|loan growth|deposit growth|liquidity crisis|liquidity squeeze|monetary policy|sebi regulation|sebi circular|banking reform|credit crunch|bank fraud|bank merger)\b/i,
    severity_color: '#2563EB',
    severity_icon: '🔵',
  },
  INDIA_AGRI: {
    label: 'India Agriculture & Food',
    description: 'Monsoon impact, crop output, food inflation, fertilizer supply',
    keywords: /\b(monsoon|crop failure|crop output|crop damage|agriculture crisis|food inflation|wheat price|rice price|rice export ban|sugar price|sugar export|fertilizer shortage|fertilizer subsidy|msp hike|kharif sowing|rabi sowing|farm distress|agri crisis|onion price|tomato price|vegetable price|food crisis|edible oil price|soybean price|pulses price)\b/i,
    severity_color: '#16A34A',
    severity_icon: '🟢',
  },
  INDIA_DEFENCE: {
    label: 'India Defence & Aerospace',
    description: 'Defence procurement, military modernization, DRDO/ISRO/HAL, strategic capability',
    keywords: /\b(india.*defence|india.*defense|indian (military|navy|army|air force)|defence procurement|defence order|defence deal|missile (test|launch|order)|fighter (jet|aircraft|order)|hal order|hal deliver|bhel order|drdo (test|develop|missile)|isro (launch|satellite|mission)|satellite launch|aerospace order|ammunition|warship|submarine.*india|radar system|defence budget india|defence budget.*crore|defence budget.*lakh|make in india.*defence|atmanirbhar.*defence|defence corridor|defence export)\b/i,
    severity_color: '#7C3AED',
    severity_icon: '🟣',
  },
  INDIA_PHARMA: {
    label: 'India Pharma & Healthcare',
    description: 'Drug approvals, USFDA actions, API supply, healthcare capacity',
    keywords: /\b(pharma.*india|india.*pharma|drug approval|drug shortage|fda approval|fda warning|usfda|anda approval|api supply|api shortage|formulation export|hospital capacity|healthcare infrastructure|vaccine (supply|shortage|drive|approval)|biotech.*india|generic drug|clinical trial.*india|pharma export|bulk drug|pharma policy)\b/i,
    severity_color: '#0891B2',
    severity_icon: '🔵',
  },
  INDIA_INFRA: {
    label: 'India Infrastructure',
    description: 'Highway, railway, metro, port, airport developments and bottlenecks',
    keywords: /\b(highway (project|order|contract|delay)|railway (order|electrif|expansion|freight)|metro (project|expansion|line)|smart city|infrastructure (order|spend|investment|bottleneck)|cement (demand|price|supply)|construction (order|boom|delay)|bridge (project|inaugurat)|tunnel (project|breakthrough)|port (expansion|capacity|congestion)|airport (expansion|terminal|traffic)|rera|affordable housing.*india|dlf|godrej propert|l&t.*order|l&t.*infra)\b/i,
    severity_color: '#6D28D9',
    severity_icon: '🟣',
  },
  INDIA_AUTO: {
    label: 'India Auto & EV',
    description: 'Auto sales trends, EV transition, battery supply, manufacturing shifts',
    // Tightened: removed bare "car", "vehicle", "battery", "suv" — too broad
    keywords: /\b(auto sale|auto (production|output)|automobile.*india|india.*automobile|ev (sales|production|policy|subsidy|adoption)|electric vehicle.*india|tata motors|maruti (sales|production)|mahindra (sales|ev|suv)|bajaj (sales|auto)|hero (sales|motocorp)|two wheeler (sales|production)|battery (plant|gigafactory|supply|shortage).*india|ola electric|ather energy|ev charging|auto export|auto component)\b/i,
    severity_color: '#059669',
    severity_icon: '🟢',
  },
  INDIA_NUCLEAR: {
    label: 'India Nuclear & Atomic Energy',
    description: 'Nuclear reactor milestones, atomic energy program, thorium cycle, nuclear power capacity',
    // Broadened: catch success news too — commissioning, achievement, approval, record
    keywords: /\b(nuclear reactor|atomic reactor|nuclear power.*india|india.*nuclear power|atomic energy|thorium|breeder reactor|kalpakkam|bhabha atomic|nuclear fuel|criticality|nuclear plant|atomic plant|uranium.*india|nuclear capacity|fast breeder|nuclear milestone|nuclear commission|nuclear approv|nuclear achiev|nuclear (record|capacity addition)|kudankulam|kakrapar|rawatbhata|tarapur|jaitapur|gorakhpur.*nuclear|npcil|nuclear energy.*india|india.*nuclear energy|bhavini|atomic energy commission|dae.*nuclear)\b/i,
    severity_color: '#0E7490',
    severity_icon: '⚛️',
  },

  // ── US-SPECIFIC BUCKETS ──
  US_TECH: {
    label: 'US Big Tech & AI',
    description: 'Big tech developments, AI race, cloud capacity, tech regulation',
    keywords: /\b(openai|chatgpt|artificial intelligence|machine learning|big tech|silicon valley|cloud computing|cybersecurity|quantum computing|spacex|apple.{0,15}(chip|supply|ai|vision)|google.{0,15}(ai|cloud|gemini|search)|microsoft.{0,15}(ai|azure|copilot)|amazon.{0,15}(aws|cloud|alexa)|meta.{0,15}(ai|llama|data center|metaverse)|tesla.{0,15}(production|battery|delivery|robot|fsd)|nvidia.{0,15}(earning|revenue|supply|demand|gpu)|broadcom|amd|intel.{0,15}(fab|foundry|chip)|saas|tech (layoff|antitrust|regulation))\b/i,
    severity_color: '#3B82F6',
    severity_icon: '🔵',
  },
  US_FINANCE: {
    label: 'US Fed & Monetary Policy',
    description: 'Federal Reserve decisions, inflation data, bond yield moves, credit conditions',
    keywords: /\b(federal reserve|fed rate|fed (decision|meeting|pause|cut|hike|minutes)|interest rate (decision|cut|hike|hold)|rate hike|rate cut|inflation (data|report|reading|number)|cpi|pce|treasury yield|bond yield|fomc|powell|recession|stagflation|credit (crunch|tighten|condition)|jpmorgan|goldman sachs|bank of america|citigroup|morgan stanley|wall street.{0,20}(warn|fear|risk|crisis|rout|plunge))\b/i,
    severity_color: '#1E40AF',
    severity_icon: '🔵',
  },
  US_TRADE: {
    label: 'US Trade & Geopolitics',
    description: 'US-China tensions, sanctions, trade policy, geopolitical supply risks',
    keywords: /\b(china trade|us.china|china.us|china tariff|taiwan.{0,15}(chip|semiconductor|strait|tension)|geopolit|pentagon|nato|ukraine.{0,15}(energy|grain|war|conflict)|russia.{0,15}(oil|gas|sanction|ukraine)|iran.{0,15}(oil|sanction|nuclear|deal)|middle east.{0,15}(oil|tension|conflict)|south china sea|trade (deal|deficit|surplus|agreement|negotiat|restrict)|commerce department|treasury.{0,15}sanction|executive order|tariff.*china|china.*tariff|trump.{0,15}(tariff|trade|china|sanction)|biden.{0,15}(chip|trade|china|sanction))\b/i,
    severity_color: '#991B1B',
    severity_icon: '🔴',
  },
  US_ENERGY: {
    label: 'US Energy & Climate',
    description: 'Shale production, LNG, renewables, nuclear power, EV battery supply, energy transition',
    keywords: /\b(shale (production|output|rig)|permian (basin|output)|natural gas (price|supply|export)|lng (export|terminal|capacity)|oil rig count|pipeline (project|approval|block)|renewable (energy|capacity|investment)|solar (capacity|install|tariff)|wind (energy|farm|capacity|offshore)|nuclear (power|plant|reactor|energy)|uranium (price|supply|mining)|ev battery (supply|demand|shortage|plant)|lithium (supply|price|mining)|clean energy (investment|policy)|carbon (tax|capture|emission)|climate (policy|regulation)|epa (regulation|rule)|energy transition|hydrogen (economy|production|fuel))\b/i,
    severity_color: '#D97706',
    severity_icon: '🟠',
  },
  US_DEFENCE: {
    label: 'US Defence Budget & Military',
    description: 'Defense budget, Pentagon spending, military procurement, defense tech',
    keywords: /\b(defense budget|defence budget|pentagon (budget|spend|contract|order)|military spending|defense spending|defense contract|defense order|lockheed (martin|order|contract)|raytheon|northrop (grumman|order|contract)|boeing (defense|military)|general dynamics|l3harris|defense (startup|tech|innovation)|military tech|arms (deal|sale|export)|weapons (system|order|contract)|fighter jet (order|contract|deal)|f-35|f-16|naval (contract|order|ship)|aircraft carrier)\b/i,
    severity_color: '#581C87',
    severity_icon: '🟣',
  },
};

// ════════════════════════════════════════════════════════════════════════
// SEVERITY
// ════════════════════════════════════════════════════════════════════════
function getSeverity(signalCount: number): { severity: number; severity_label: string } {
  if (signalCount >= 10) return { severity: 5, severity_label: 'CRITICAL' };
  if (signalCount >= 5)  return { severity: 4, severity_label: 'HIGH' };
  if (signalCount >= 3)  return { severity: 3, severity_label: 'ELEVATED' };
  if (signalCount >= 1)  return { severity: 2, severity_label: 'WATCH' };
  return { severity: 1, severity_label: 'LOW' };
}

// ════════════════════════════════════════════════════════════════════════
// RSS FEEDS
// ════════════════════════════════════════════════════════════════════════
const BOTTLENECK_RSS = [
  // India
  { name: 'ET Markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', region: 'IN' },
  { name: 'ET Industry', url: 'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms', region: 'IN' },
  { name: 'Livemint Markets', url: 'https://www.livemint.com/rss/markets', region: 'IN' },
  { name: 'Livemint Companies', url: 'https://www.livemint.com/rss/companies', region: 'IN' },
  { name: 'Business Standard', url: 'https://www.business-standard.com/rss/markets-106.rss', region: 'IN' },
  { name: 'BS Companies', url: 'https://www.business-standard.com/rss/companies-101.rss', region: 'IN' },
  { name: 'Mint Economy', url: 'https://www.livemint.com/rss/economy', region: 'IN' },
  { name: 'NDTV Profit', url: 'https://feeds.feedburner.com/ndtvprofit-latest', region: 'IN' },
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
  // Semiconductor / Tech Supply Chain
  { name: 'Tom\'s Hardware', url: 'https://www.tomshardware.com/feeds/all', region: 'US' },
  { name: 'The Register', url: 'https://www.theregister.com/headlines.atom', region: 'US' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', region: 'US' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', region: 'US' },
  { name: 'SemiWiki', url: 'https://semiwiki.com/feed/', region: 'US' },
];

// ════════════════════════════════════════════════════════════════════════
// RSS FETCHER
// ════════════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════════════
// PERSISTENCE HELPERS
// ════════════════════════════════════════════════════════════════════════
const PERSISTENT_KEY = 'bottleneck:dashboard:persistent:v3'; // v3: structural-only persistence
const PERSISTENT_TTL = 7776000; // 90 days in seconds

function isSignalTooOld(date: string | Date, maxDays: number = 90): boolean {
  try {
    const signalDate = new Date(date);
    const now = new Date();
    const ageMs = now.getTime() - signalDate.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays > maxDays;
  } catch {
    return false; // If date parsing fails, keep the signal
  }
}

function normHeadlineForDedup(headline: string): string {
  return (headline || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
}

async function loadPersistentSignals(): Promise<any[]> {
  try {
    const persistent = await kvGet<any[]>(PERSISTENT_KEY);
    return persistent || [];
  } catch {
    return [];
  }
}

async function savePersistentSignals(signals: any[]): Promise<void> {
  try {
    // Filter out signals older than 90 days
    const fresh = signals.filter(s => !isSignalTooOld(s.date));
    // Store limited fields to save space
    const compact = fresh.map(s => ({
      headline: s.headline,
      summary: s.summary || s.narrative || '',
      source: s.source,
      date: s.date,
      bucket_id: s.bucket_id,
    }));
    await kvSet(PERSISTENT_KEY, compact, PERSISTENT_TTL);
  } catch {
    // Silently fail — don't break the main handler if KV write fails
  }
}

// ════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════════
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

    // Always fetch live RSS for broad coverage
    const rssSignals = await fetchLiveRSSSignals();
    allSignals = [...allSignals, ...rssSignals];

    // Load persistent signals from KV and merge with live signals
    const persistentSignals = await loadPersistentSignals();

    // Merge: combine live RSS + persistent, dedup by headline
    const mergedSignals = [...rssSignals, ...persistentSignals];
    const seen = new Set<string>();
    const dedupedMerged = mergedSignals.filter(s => {
      const key = normHeadlineForDedup(s.headline);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Use deduplicated merged signals for processing
    allSignals = [...allSignals, ...dedupedMerged];

    // ── NOISE FILTER: Remove non-bottleneck articles BEFORE matching ──
    const cleanSignals = allSignals.filter((s: any) => {
      const headline = s.headline || '';
      const desc = s.narrative || s.summary || '';
      return !isNoise(headline, desc);
    });

    // Build buckets from clean signals
    const buckets: any[] = [];

    for (const [key, config] of Object.entries(BOTTLENECK_BUCKETS)) {
      const matchingSignals = cleanSignals.filter((s: any) => {
        const text = (s.headline || '') + ' ' + (s.narrative || '') + ' ' + (s.summary || '') + ' ' + (s.eventType || '');
        if (!config.keywords.test(text)) return false;

        // Region filter
        if (regionFilter === 'IN') {
          if (key.startsWith('INDIA_')) return true;
          if (key.startsWith('US_')) return false;
          if (s.region === 'IN') return true;
          const indiaTest = /\b(india|nse|bse|nifty|sensex|rbi|rupee|inr|sebi|crore|lakh)\b/i;
          return indiaTest.test(text);
        }
        if (regionFilter === 'US') {
          if (key.startsWith('US_')) return true;
          if (key.startsWith('INDIA_')) return false;
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

        // ── SIGNAL INTELLIGENCE: sort primary (high-signal) first, supporting after ──
        const sortedSignals = [...dedupedSignals].sort((a, b) => {
          const aText = (a.headline || '') + ' ' + (a.narrative || a.summary || '');
          const bText = (b.headline || '') + ' ' + (b.narrative || b.summary || '');
          const aKey = SIGNAL_KEYS.test(aText) ? 1 : 0;
          const bKey = SIGNAL_KEYS.test(bText) ? 1 : 0;
          return bKey - aKey; // primary signals first
        });

        const bucketSignals = sortedSignals.slice(0, 10).map((s: any, idx: number) => ({
          id: s.symbol || key,
          headline: s.headline || s.narrative || `${s.symbol}: ${s.eventType || 'Signal'}`,
          summary: s.narrative || s.summary || '',
          signal_role: idx === 0 ? 'primary' : 'supporting',
          // Frontend BnSignal interface expects these exact field names:
          sources: [s.source || 'Intelligence'],
          tickers: s.symbol ? [s.symbol] : [],
          latest_at: s.date || s.timestamp || new Date().toISOString(),
          evidence_count: 1,
          articles: [{
            id: s.symbol || key,
            headline: s.headline || '',
            source_name: s.source || 'Intelligence',
            source_url: s.link || '',
            published_at: s.date || s.timestamp || new Date().toISOString(),
            importance_score: 0.7,
            sentiment: 'neutral',
          }],
          // Keep backward compat fields too
          source: s.source || 'Intelligence',
          date: s.date || s.timestamp || new Date().toISOString(),
          ticker: s.symbol || '',
          severity: s.signalTierV7 === 'ACTIONABLE' ? 'HIGH' : 'MEDIUM',
        }));

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
          signals: bucketSignals,
        });
      }
    }

    // After building buckets, save only STRUCTURAL signals to persistent store
    const allMatchedSignals = buckets.flatMap(b =>
      b.signals.map((sig: any) => ({
        headline: sig.headline,
        summary: sig.summary,
        source: sig.source,
        date: sig.latest_at || sig.date,
        bucket_id: b.bucket_id,
      }))
    );
    // Only persist signals that contain structural terms
    const structuralSignals = allMatchedSignals.filter(s => {
      const text = (s.headline + ' ' + (s.summary || '')).toLowerCase();
      return STRUCTURAL_TERMS_DASH.test(text);
    });
    await savePersistentSignals(structuralSignals);

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
      filtered_articles: cleanSignals.length,
      noise_removed: allSignals.length - cleanSignals.length,
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
