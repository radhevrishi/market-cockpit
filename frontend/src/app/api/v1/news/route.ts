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
];

const CACHE_KEY = 'news:articles:v5'; // v5: memory/photonics feeds + implicit constraint + expanded mapping
const CACHE_TTL = 300; // 5 min
const BOTTLENECK_PERSISTENT_KEY = 'bottleneck:articles:persistent:v4'; // v4: memory/photonics enhanced
const BOTTLENECK_TTL = 7776000; // 90 days in seconds

// ══════════════════════════════════════════════════════════════════════
// CORE SIGNAL DEFINITIONS — Institutional-grade constraint detection
// ══════════════════════════════════════════════════════════════════════
const CONSTRAINT_TERMS = /(shortage|constraint|bottleneck|capacity (limit|constraint|tight)|supply (gap|crisis|disruption)|production (cut|limit|issue)|yield issue|allocation|undersupply|backlog|overbooked|sold out|wait(list|ing list))/i;
const IMPLICIT_CONSTRAINT = /(surge in demand|demand spike|tight market|capacity lag|outstripping supply|demand outstrip|demand exceed|supply trail|lead time|pricing pressure|supply.{0,10}trail|ramp.{0,10}(slow|delay|behind)|demand.{0,10}(surge|soar|spike|outpace|overwhelm)|supply.{0,10}(crunch|squeeze|pinch))/i;
const BREAKTHROUGH_TERMS = /(commissioned|achieves criticality|operational|goes live|milestone|first-of-its-kind|indigenous development|deployment|scaled up|record output|record capacity|breakthrough|world.?first)/i;
const STRUCTURAL_TERMS = /(wafer|fab|tsmc|asml|hbm|dram|nand|advanced packaging|cowos|chiplet|power grid|transmission|nuclear|reactor|thorium|rare earth|lithium|silicon photonics|optical interconnect|co-packaged optics|euv|high.?na|gaafet|gate.?all.?around|backside power|3d.?ic|interposer|substrate|abf film|hybrid bonding|tsv|redistribution layer|rdl)/i;
const ACTIVITY_TERMS = /(launch|announce|partnership|investment|funding|approval|award|expansion plan)/i;

// ── Company & CEO Signal Terms (catch structural news via key figures) ──
// When these CEOs/leaders speak about supply/capacity/bottleneck topics, it's always signal
const CEO_SIGNAL_TERMS = /(jensen huang|lisa su|pat gelsinger|cc wei|mark liu|peter wennink|cristiano amon|sundar pichai|satya nadella|andy jassy|mark zuckerberg|sam altman|elon musk|morris chang|sanjay mehrotra|kwak noh-jung|tim cook).{0,40}(supply|capacity|shortage|bottleneck|constraint|demand|infrastructure|chip|semiconductor|ai|compute|fab|data center|nuclear|energy|power)/i;

// ── Broad Company Names for structural supply chain capture ──
const SUPPLY_CHAIN_COMPANIES = /(tsmc|asml|applied materials|lam research|tokyo electron|screen holdings|kla corp|synopsys|cadence|sk hynix|micron|samsung semiconductor|samsung foundry|intel foundry|globalfoundries|umc|smic|amkor|ase group|jcet|powerchip|nanya|winbond|infineon|stmicro|nxp|texas instruments|onsemi|wolfspeed|cree|ii-vi|coherent|lumentum|broadcom|marvell|nvidia|amd|qualcomm|mediatek|arm holdings|arteris|rambus|kaynes|syrma|dixon|vedanta semiconductor|tata electronics|bhel|npcil|bhavini|l&t|siemens energy|ge vernova|cameco|nexgen energy)/i;

const MEMORY_COMPANY_TERMS = /(sk hynix|micron|samsung|nanya|winbond).{0,20}(hbm|dram|ddr5|capacity|supply|shortage|allocation|lead time|pricing|output|expansion|fab)/i;
const PHOTONICS_CONSTRAINT = /(silicon photonics|co-packaged optics|optical interconnect|cpo|optical transceiver|pluggable optics|800g|1\.6t).{0,20}(scaling|bandwidth|limit|bottleneck|power constraint|demand|ramp|adoption|capacity|shortage|lead time)/i;

// ══════════════════════════════════════════════════════════════════════
// INVESTMENT MAPPING — Actionable intelligence layer
// ══════════════════════════════════════════════════════════════════════
const INVESTMENT_MAP: Record<string, string[]> = {
  semiconductor: ['TSMC', 'ASML', 'AMAT'],
  memory: ['Micron', 'SK Hynix', 'Samsung'],
  packaging: ['TSMC', 'ASE', 'Amkor', 'JCET'],
  interconnect: ['Rambus', 'Arteris'],
  photonics: ['Lumentum', 'Coherent Corp', 'II-VI'],
  ai_infra: ['Nvidia', 'Amazon', 'Microsoft'],
  power: ['Siemens Energy', 'GE Vernova'],
  nuclear: ['BHEL', 'L&T', 'Cameco'],
  india_ems: ['Kaynes Technology', 'Syrma SGS', 'Dixon Technologies'],
};

function getInvestmentTickers(text: string): string[] {
  const tickers: string[] = [];
  if (/semiconductor|wafer|fab|tsmc|asml|foundry|lithograph/i.test(text)) tickers.push(...INVESTMENT_MAP.semiconductor);
  if (/hbm|dram|nand|memory|sk hynix|micron/i.test(text)) tickers.push(...INVESTMENT_MAP.memory);
  if (/cowos|advanced packaging|chiplet|2\.5d|3d stacking|osat/i.test(text)) tickers.push(...INVESTMENT_MAP.packaging);
  if (/interconnect|noc|network.on.chip|data movement/i.test(text)) tickers.push(...INVESTMENT_MAP.interconnect);
  if (/photonics|silicon photonics|optical interconnect|co-packaged optics|cpo/i.test(text)) tickers.push(...INVESTMENT_MAP.photonics);
  if (/ai|gpu|data center|hyperscal|compute/i.test(text)) tickers.push(...INVESTMENT_MAP.ai_infra);
  if (/power grid|electricity|transmission/i.test(text)) tickers.push(...INVESTMENT_MAP.power);
  if (/nuclear|thorium|reactor|npcil|bhavini/i.test(text)) tickers.push(...INVESTMENT_MAP.nuclear);
  if (/india.{0,15}(ems|pcb|system integration|electronics manufacturing)|kaynes|syrma|dixon/i.test(text)) tickers.push(...INVESTMENT_MAP.india_ems);
  if (/euv|high.?na|lithograph|extreme ultraviolet/i.test(text)) tickers.push('ASML');
  if (/abf|substrate|interposer/i.test(text)) tickers.push('Ibiden', 'Shinko Electric');
  if (/lam research|etch|deposition/i.test(text)) tickers.push('Lam Research');
  if (/kla|inspection|metrology/i.test(text)) tickers.push('KLA Corp');
  return [...new Set(tickers)];
}

// ── Type Classification ──────────────────────────────────────────────
function classifyArticle(title: string, desc: string): { article_type: string; investment_tier: number } {
  const text = (title + ' ' + desc).toLowerCase();

  // ── 1. NOISE: clickbait, lifestyle, junk ──
  if (/multibagger|penny stock|should you buy|stock(s)? to buy|hot stock|best (stock|pick)|free tips|moneymaker|money.?maker|horoscope|recipe|cricket|bollywood|celebrity|entertainment|march madness|bracket|winnings|entry fee/i.test(text))
    return { article_type: 'GENERAL', investment_tier: 3 };

  // ══ SUPER BOTTLENECK OVERRIDE ══
  // If structural term + (constraint OR breakthrough OR implicit constraint), ALWAYS bottleneck
  // Captures: HBM shortages, CoWoS constraints, nuclear milestones, demand outstripping supply
  // Avoids: "TSMC expansion" alone, "AI investment" alone
  if (
    STRUCTURAL_TERMS.test(text) &&
    (CONSTRAINT_TERMS.test(text) || BREAKTHROUGH_TERMS.test(text) || IMPLICIT_CONSTRAINT.test(text))
  ) {
    return { article_type: 'BOTTLENECK', investment_tier: 1 };
  }

  // ══ MEMORY COMPANY SIGNAL OVERRIDE ══
  // "SK Hynix HBM capacity", "Micron DRAM supply" → always bottleneck
  if (MEMORY_COMPANY_TERMS.test(text)) {
    return { article_type: 'BOTTLENECK', investment_tier: 1 };
  }

  // ══ PHOTONICS CONSTRAINT OVERRIDE ══
  // "Silicon photonics scaling bottleneck", "CPO bandwidth limit" → always bottleneck
  if (PHOTONICS_CONSTRAINT.test(text)) {
    return { article_type: 'BOTTLENECK', investment_tier: 1 };
  }

  // ══ IMPLICIT CONSTRAINT ON KEY TECH ══
  // "HBM demand surges", "photonics gains traction" with demand/supply context
  if (
    /(hbm|dram|nand|photonics|optical interconnect|co-packaged optics|cowos|chiplet|euv|high.?na|interposer|abf film|substrate)/i.test(text) &&
    IMPLICIT_CONSTRAINT.test(text)
  ) {
    return { article_type: 'BOTTLENECK', investment_tier: 1 };
  }

  // ══ CEO SIGNAL OVERRIDE ══
  // When key tech CEOs discuss supply/capacity topics, always bottleneck
  // "Jensen Huang says GPU shortage", "Sundar Pichai AI infrastructure"
  if (CEO_SIGNAL_TERMS.test(text)) {
    return { article_type: 'BOTTLENECK', investment_tier: 1 };
  }

  // ══ SUPPLY CHAIN COMPANY + CONSTRAINT ══
  // When a known supply chain company is mentioned with constraint terms
  if (SUPPLY_CHAIN_COMPANIES.test(text) && (CONSTRAINT_TERMS.test(text) || IMPLICIT_CONSTRAINT.test(text))) {
    return { article_type: 'BOTTLENECK', investment_tier: 1 };
  }

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

  // ── 8. OIL / COMMODITY PRICE (price commentary, not supply constraint) ──
  // Expanded: also catches copper, lithium, gas price movements
  if (/\b(oil|crude|brent|copper|lithium|gas)\b.{0,15}\b(price|rise|gain|drop|fall|surge|tank|hover)\b/i.test(text))
    return { article_type: 'MACRO', investment_tier: 1 };
  if (/\b(oil price|crude oil|crude price|brent crude|wti crude|opec|oil (gain|rise|drop|fall|surge|rally|slip)|oil production|oil (shock|embargo)|fuel price|petrol price|diesel price|natural gas price|energy security)\b/i.test(text))
    return { article_type: 'MACRO', investment_tier: 1 };
  // Supply fear without actual constraint = MACRO noise
  if (/supply fear|concern|worry/i.test(text) && !CONSTRAINT_TERMS.test(text))
    return { article_type: 'MACRO', investment_tier: 1 };

  // ── 9. BOTTLENECK — STRICT: only structural supply constraints ──
  // ── SCORING GATE: reject weak signals before any sub-group check ──
  {
    let score = 0;
    if (CONSTRAINT_TERMS.test(text)) score += 2;
    if (IMPLICIT_CONSTRAINT.test(text)) score += 2;
    if (BREAKTHROUGH_TERMS.test(text)) score += 2;
    if (STRUCTURAL_TERMS.test(text)) score += 2;
    if (SUPPLY_CHAIN_COMPANIES.test(text)) score += 1;
    if (/(wafer|hbm|packaging|power grid|nuclear|photonics|euv|cowos|interposer)/i.test(text)) score += 1;

    // Helper: reject activity-only without constraint evidence
    const rejectActivityOnly = (): { article_type: string; investment_tier: number } | null => {
      if (ACTIVITY_TERMS.test(text) && !CONSTRAINT_TERMS.test(text)) return null;
      if (text.length < 40 && !CONSTRAINT_TERMS.test(text)) return null;
      return { article_type: 'BOTTLENECK', investment_tier: 1 };
    };

    // Only enter bottleneck matching if score >= 3
    if (score >= 3) {
      // Generic supply constraint
      if (/bottleneck|supply chain (disruption|crisis|bottleneck|constraint)|supply shortage|capacity constraint/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // Semiconductor & Chip supply (UPGRADED — proximity matching)
      if (/(wafer|fab|tsmc|asml).{0,25}(capacity|constraint|shortage|tight)/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }
      if (/(cowos|advanced packaging|chiplet|2\.5d|3d stacking).{0,20}(capacity|constraint|shortage)/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }
      if (/\b(semiconductor|foundry|chip (shortage|supply|demand|ban|export|production|capacity)|chip export|osat|eda tool|chip equipment|lithograph)\b/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // Photonics & optical interconnects
      if (/\b(photonics|photonic|silicon photonics|optical (chip|interconnect|transceiver)|co-packaged optics|optical (network|switch))\b/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // Memory & storage cycles (UPGRADED — proximity + company-led + DDR5)
      if (/(hbm3e?|dram|ddr5|nand|memory).{0,25}(tight|shortage|undersupply|pricing pressure|allocation|lead time|constraint|capacity)/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }
      if (/(sk hynix|micron|samsung).{0,20}(hbm|dram|capacity|supply|shortage|allocation)/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }
      if (/\b(hbm|hbm2|hbm3|hbm3e|ddr5|memory chip|memory (cycle|supply|demand|constraint|shortage)|flash memory|3d nand)\b/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // Packaging substrate / ABF film / advanced materials bottleneck
      if (/(abf film|abf substrate|ajinomoto|substrate).{0,20}(shortage|constraint|supply|capacity|tight|lead time)/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }
      if (/(interposer|tsv|hybrid bonding|redistribution layer|rdl|fan-out).{0,20}(capacity|constraint|shortage|bottleneck|scaling)/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // EUV / High-NA lithography bottleneck (next-gen constraint)
      if (/(euv|high.?na|extreme ultraviolet).{0,20}(capacity|constraint|shortage|delivery|delay|backlog|tool)/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // Interconnect / NoC / Data Movement bottleneck (institutional edge)
      if (/\b(interconnect|network.on.chip|noc|data movement|chip-to-chip|die-to-die|ucie|bunch of wires)\b.{0,20}(bottleneck|constraint|bandwidth|limit|scaling)/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // AI infrastructure & compute constraints (UPGRADED — noise-resistant)
      if (/(ai|gpu|compute).{0,30}(shortage|constraint|capacity|allocation)/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }
      if (/data center.{0,30}(power|capacity|constraint|limit)/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }
      if (/cloud.{0,20}(capacity|constraint)/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }
      if (/\b(ai accelerator|tpu|inference.*constraint|training.*compute)\b/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // Power / Grid (NEW — very important for AI infra)
      if (/(power grid|electricity|energy).{0,25}(constraint|shortage|limit)/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }
      if (/transmission.{0,20}(constraint|capacity)/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // Nuclear energy (UPGRADED — breakthrough + constraint)
      if (/(fast breeder|thorium|npcil|bhavini|kalpakkam).{0,25}(criticality|commissioned|operational|milestone)/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }
      if (/nuclear.{0,20}(capacity|constraint|fuel shortage)/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }
      if (/\b(nuclear (reactor|power|plant|energy|fuel|project|deal|pact|milestone)|atomic (reactor|energy)|breeder reactor|kudankulam|nuclear commission|criticality|atomic energy commission)\b/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // Critical minerals & rare earths
      if (/\b(rare earth|lithium (supply|mining|shortage)|cobalt (supply)|copper (shortage|supply)|nickel (supply)|mineral supply|critical mineral|titanium supply)\b/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // Logistics & shipping disruptions
      if (/\b(shipping (delay|crisis|disruption)|freight rate|container shortage|port (congestion|strike)|red sea.{0,15}(attack|disrupt)|suez.{0,10}block|panama.{0,10}drought|trade route disruption|cargo delay|logistics (disruption|delay|crisis))\b/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // Defence procurement (India + US)
      if (/\b(defence (order|procurement|deal|budget|corridor|export)|defense (order|procurement|contract|budget|spending)|drdo|isro|hal (order|deliver)|military (spending|procurement)|pentagon (budget|spend|contract))\b/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // Pharma supply constraints
      if (/\b(drug (shortage|approval)|usfda|fda (approval|warning)|api (supply|shortage)|pharma.*supply|bulk drug|pharma export)\b/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // Agriculture & food supply constraints
      if (/\b(monsoon|crop (failure|output|damage)|food inflation|fertilizer (shortage|subsidy)|agriculture crisis|food crisis)\b/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // Auto & EV transition supply constraints
      if (/\b(ev (sales|production|battery|shift)|electric vehicle.{0,15}(production|supply|battery)|battery (plant|gigafactory|supply|shortage)|auto (production|component|export))\b/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // Energy infrastructure (renewables, hydrogen, power grid — NOT price commentary)
      if (/\b(solar (capacity|install|project)|wind (farm|capacity|offshore)|renewable (capacity|investment|project)|hydrogen (economy|production|fuel|cell)|power (grid|crisis|shortage)|energy transition|uranium (supply|mining)|clean energy)\b/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // India infrastructure bottlenecks
      if (/\b(infrastructure (order|bottleneck|spend)|highway (project|order|delay)|railway (order|electrif|expansion)|cement (demand|supply)|construction (order|delay))\b/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }

      // India banking structural (NOT general RBI news)
      if (/\b(npa|credit (growth|crunch|squeeze)|nbfc (crisis|liquidity)|lending rate.*squeeze|liquidity (crisis|squeeze)|banking reform)\b/i.test(text)) {
        const r = rejectActivityOnly();
        if (r) return r;
      }
    }
  }

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
  const patterns: [RegExp, string][] = [
    [/cowos|advanced packaging|chiplet|interposer|hybrid bonding/, 'Advanced packaging capacity bottleneck — direct AI compute constraint'],
    [/euv|high.?na|extreme ultraviolet|lithograph/, 'Leading-edge lithography capacity constraint limiting chip production'],
    [/abf|substrate|ajinomoto/, 'Substrate supply constraint affecting advanced packaging throughput'],
    [/interconnect|noc|data movement|die-to-die|ucie/, 'Data movement bottleneck — chip-to-chip bandwidth limiting system performance'],
    [/semiconductor|wafer|fab|tsmc|asml|foundry/, 'Supply chain constraint affecting chip production capacity'],
    [/hbm|dram (shortage|tight|constraint)|memory.*shortage/, 'HBM/Memory supply cycle — highest margin expansion zone in semiconductors'],
    [/memory|dram|nand|memory chip|memory cycle/, 'Memory supply cycle affecting tech hardware margins'],
    [/photonic|photonics|silicon photonics|co-packaged optics|cpo|optical interconnect/, 'Next-gen optical interconnect — emerging bottleneck post-packaging/power'],
    [/nuclear|reactor|atomic|thorium|breeder|npcil|kudankulam|kalpakkam/, 'Strategic energy infrastructure — long-cycle structural constraint'],
    [/power grid|electricity|transmission.*constraint/, 'Power/grid constraint — critical for AI data center expansion'],
    [/ai|gpu|data center|hyperscal|nvidia|compute|inference/, 'Compute infrastructure demand-supply gap'],
    [/tariff|trade war|sanction|embargo|export ban|import duty|trade restrict/, 'Trade policy shift impacting cross-border supply flows'],
    [/oil|energy|opec|crude|fuel|refinery|lng/, 'Energy supply dynamics affecting production costs'],
    [/defense|defence|military|pentagon|drdo|hal|procurement/, 'Defence procurement and strategic capability development'],
    [/rare earth|lithium|cobalt|copper|nickel|aluminium|aluminum/, 'Critical mineral supply constraints impacting manufacturing'],
    [/monsoon|crop|fertilizer|agriculture|food/, 'Agricultural output cycles affecting commodity supply'],
    [/rbi|federal reserve|fed rate|inflation|interest rate|repo rate/, 'Monetary policy impacting capital flows and cost of financing'],
    [/shipping|port|freight|red sea|suez|supply chain|logistics/, 'Logistics bottleneck affecting supply chain timelines'],
    [/auto|ev|electric vehicle|battery/, 'Automotive transition driving component demand shifts'],
    [/pharmaceutical|fda|drug|api|medicine/, 'Healthcare supply chain and regulatory impact'],
    [/kaynes|syrma|dixon|india.*ems|electronics manufacturing/, 'India EMS/PCB ecosystem — beneficiary of AI hardware supply chain localization'],
    [/geopolit|china|taiwan|russia|ukraine|iran/, 'Geopolitical risk affecting supply chains and markets'],
    [/jensen huang|lisa su|pat gelsinger|cc wei|sundar pichai|satya nadella|sam altman/, 'CEO-level signal on structural supply/demand dynamics'],
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

  // ── IBEF India Economy News (HTML scrape — no RSS available) ──
  try {
    const ibefRes = await fetch('https://www.ibef.org/indian-economy-news', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(5000),
    });
    if (ibefRes.ok) {
      const html = await ibefRes.text();
      // Extract news items from IBEF's HTML structure
      // IBEF uses <a> tags with news headlines inside card-like divs
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
          title: inner,
          headline: inner,
          summary: '',
          source_name: 'IBEF',
          source: 'IBEF',
          source_url: fullUrl,
          published_at: new Date().toISOString(), // IBEF doesn't show dates in listings
          region: 'IN',
          article_type,
          investment_tier,
          tickers,
          primary_ticker: tickers[0] || null,
          sentiment: null,
          importance_score: investment_tier === 1 ? 0.8 : 0.5,
        });
      }
      // Also try extracting from h3/h4 tags with links (alternative page structure)
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
          title: inner,
          headline: inner,
          summary: '',
          source_name: 'IBEF',
          source: 'IBEF',
          source_url: fullUrl,
          published_at: new Date().toISOString(),
          region: 'IN',
          article_type,
          investment_tier,
          tickers,
          primary_ticker: tickers[0] || null,
          sentiment: null,
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

  // ── FEED-LEVEL FIX: Per-source cap to ensure diversity ──
  const PER_SOURCE_CAP = 8;
  const sourceCount: Record<string, number> = {};
  const diversified = deduped.filter(a => {
    const src = a.source_name || a.source || 'unknown';
    if (!sourceCount[src]) sourceCount[src] = 0;
    if (sourceCount[src] >= PER_SOURCE_CAP) return false;
    sourceCount[src]++;
    return true;
  }).slice(0, 500);

  // Add impact statements + investment tickers to all articles
  const articlesWithImpact = diversified.map(a => ({
    ...a,
    impact_statement: generateImpact(a.title, a.summary, a.article_type),
    investment_tickers: a.article_type === 'BOTTLENECK' ? getInvestmentTickers(a.title + ' ' + a.summary) : [],
  }));

  // ── PERSISTENCE LAYER — structural filter + tiered TTL ──
  const DAY = 86400; // seconds
  const bottleneckArticles = articlesWithImpact.filter(a => a.article_type === 'BOTTLENECK');
  if (bottleneckArticles.length > 0) {
    try {
      let persistentArticles: any[] = [];
      try {
        persistentArticles = await kvGet<any[]>(BOTTLENECK_PERSISTENT_KEY) || [];
      } catch {
        persistentArticles = [];
      }

      // Only persist articles that match STRUCTURAL_TERMS
      const structuralBottlenecks = bottleneckArticles.filter(a => {
        const text = (a.title + ' ' + (a.summary || '')).toLowerCase();
        return STRUCTURAL_TERMS.test(text);
      });

      // Merge new articles with existing ones, dedup by title
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

      // Keep the deduplicated merged list
      const finalMerged = merged.filter(a => {
        const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
        if (titleSet.has(key)) return false;
        titleSet.add(key);
        return true;
      });

      // Tiered TTL: nuclear milestones get 180 days, structural gets 90 days
      const text = finalMerged.map(a => a.title).join(' ').toLowerCase();
      let persistTTL = 90 * DAY;
      if (/(fast breeder|thorium|nuclear milestone|criticality)/i.test(text)) {
        persistTTL = 180 * DAY;
      }

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
