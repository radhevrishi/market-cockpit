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

const CACHE_KEY = 'news:articles:v8'; // v8: deep tech sub-taxonomy
const CACHE_TTL = 300; // 5 min
const BOTTLENECK_PERSISTENT_KEY = 'bottleneck:articles:persistent:v7'; // v7: deep tech sub-taxonomy
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
// IMPORTANT: Keep this tight — overly generic words like "network", "infrastructure",
// "production", "manufacturing" cause false positives (e.g. "Network18 Q4 results").
// Each term must describe a PHYSICAL system that CAN have supply constraints.
const HARDWARE_SYSTEM = /(chip|semiconductor|wafer|fab|foundry|memory|dram|nand|hbm|packaging|chiplet|interconnect|data center|server rack|compute cluster|gpu|tpu|ai accelerator|power grid|electricity grid|reactor|nuclear|transmission line|cooling system|thermal management|shipping container|port capacity|oil pipeline|refinery capacity|supply chain disruption)/i;

// ── Dimension B: Physical Constraint Types ──
// These are INVARIANT — they describe physical limits, not narratives.
const PHYSICAL_CONSTRAINT = /(constraint|shortage|bottleneck|tight|undersupply|capacity limit|scaling limit|yield issue|allocation|backlog|delay|lead time|overbooked|bandwidth limit|power limit|thermal limit|production (cut|halt|issue|limit)|supply (gap|crisis|disruption|crunch|squeeze)|demand (outstrip|outpace|exceed|overwhelm|spike|surge))/i;

// ── Breakthrough: structural milestone (not hype) ──
const BREAKTHROUGH = /(commissioned|achieves criticality|operational|goes live|first-of-its-kind|indigenous development|scaled up|record output|record capacity)/i;

// ── Implicit constraint: demand-side signals (no explicit "shortage" word) ──
const IMPLICIT_CONSTRAINT = /(surge in demand|demand spike|tight market|capacity lag|outstripping supply|demand outstrip|demand outpace|demand exceed|demand overwhelm|supply unable|running hot|sold out|waitlist|oversubscribed|fully allocated)/i;

// ── Hype / Noise suppression — these WITHOUT constraint = reject ──
const HYPE_ONLY = /(launch|announce|startup|funding|raises|partnership|unveil|demo|prototype|proof of concept|pitch|accelerator|incubator|research breakthrough)/i;

// ── India structural domains — HARD: always BOTTLENECK (physical system constraints) ──
const INDIA_STRUCTURAL_HARD = /(nuclear (reactor|power|plant|energy|fuel|capacity|project|milestone)|atomic (reactor|energy)|thorium|breeder reactor|kalpakkam|kudankulam|npcil|bhavini|criticality|atomic energy commission|defence (order|procurement|deal|budget|corridor|export)|defense (order|procurement|contract|budget|spending)|drdo|isro|hal (order|deliver))/i;

// ── India structural domains — SOFT: only BOTTLENECK when ALSO has constraint signal ──
// These domains are real but articles about them are often earnings/macro/general news.
// E.g., "ICICI Bank Q4 earnings with strong credit growth" should NOT be BOTTLENECK.
const INDIA_STRUCTURAL_SOFT = /(drug (shortage|approval)|usfda|fda (approval|warning)|api (supply|shortage)|pharma.*supply|bulk drug|monsoon|crop (failure|output|damage)|food inflation|fertilizer (shortage|subsidy)|agriculture crisis|infrastructure (order|bottleneck|spend)|highway (project|order|delay)|railway (order|electrif|expansion)|npa|credit (crunch|squeeze)|nbfc (crisis|liquidity))/i;

// Signals that the soft domain is actually a constraint (not just reporting)
const INDIA_SOFT_CONSTRAINT = /(shortage|crisis|crunch|squeeze|bottleneck|constraint|delay|halt|suspend|capacity limit|underspend|overdue|stalled|backlog|supply gap)/i;

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
// ══════════════════════════════════════════════════════════════════════
// SUB-TAXONOMY: Maps bottleneck articles to specific constraint domains
// This is STABLE — physical systems don't change. Only add, never remove.
// ══════════════════════════════════════════════════════════════════════
function getBottleneckSubTag(text: string): string {
  if (/(hbm|dram|ddr5|nand|memory|sk hynix|micron.*memory|samsung.*memory|memory wall|memory bandwidth)/i.test(text)) return 'MEMORY_STORAGE';
  if (/(photonics|optical interconnect|co-packaged optics|cpo|silicon photonics|optical I\/O|bandwidth.{0,15}(limit|bottleneck|scaling)|data movement.{0,15}(bottleneck|constraint))/i.test(text)) return 'INTERCONNECT_PHOTONICS';
  if (/(cowos|advanced packaging|chiplet|interposer|hybrid bonding|2\.5d|3d stacking|osat|emib)/i.test(text)) return 'FABRICATION_PACKAGING';
  if (/(gpu|compute|accelerator|ai chip|ai server|inference|training.*compute|data center.{0,15}(capacity|constraint))/i.test(text)) return 'COMPUTE_SCALING';
  if (/(power grid|electricity|transmission|transformer|substation|grid infrastructure)/i.test(text)) return 'POWER_GRID';
  if (/(nuclear|reactor|atomic|thorium|breeder|npcil|kalpakkam|bhavini)/i.test(text)) return 'NUCLEAR_ENERGY';
  if (/(wafer|fab|foundry|tsmc|asml|lithograph|semiconductor.*capacity|chip.{0,15}(shortage|supply|production))/i.test(text)) return 'FABRICATION_PACKAGING';
  if (/(cooling|thermal|liquid cooling|immersion)/i.test(text)) return 'THERMAL_COOLING';
  if (/(rare earth|lithium|cobalt|mineral|mining)/i.test(text)) return 'MATERIALS_SUPPLY';
  if (/(quantum|qubit|cryogenic)/i.test(text)) return 'QUANTUM_CRYOGENICS';
  return 'GENERAL_CONSTRAINT';
}

// ══════════════════════════════════════════════════════════════════════
// BOTTLENECK LEVEL — Multi-level severity classification
//
// CRITICAL_BOTTLENECK: Active shortage/constraint with immediate supply impact
//   - Explicit shortage/crisis language + structural system
//   - CEO signals about supply constraints
//   - Quantified timelines ("3 weeks", "lead time 52 weeks")
//
// BOTTLENECK: Confirmed constraint, may not be immediate crisis
//   - System + constraint detected but less urgent language
//   - Capacity limits, allocation, backlog
//   - Structural milestones (breakthrough, commissioned)
//
// WATCH: Early signal, emerging constraint, or indirect indicator
//   - Demand signals without explicit shortage
//   - Company announcements implying tightness
//   - Hype-adjacent but with real system terms
//
// RESOLVED_EASING: Constraint easing, capacity expanding, supply recovering
//   - Expansion, ramp-up, new fab, capacity addition
//   - Price drops in constrained areas
//   - Supply recovery signals
// ══════════════════════════════════════════════════════════════════════
function getBottleneckLevel(text: string): string {
  // RESOLVED / EASING: supply improving, capacity expanding
  if (/(capacity (expansion|addition|increase|ramp)|supply (recover|improv|ease|normal)|shortage (eas|end|resolv)|price (drop|decline|fall|ease|normal|soften).*(?:dram|nand|hbm|chip|memory|wafer)|new fab|production ramp|yield improv|backlog (clear|reduc)|lead time (shrink|improv|shorten))/i.test(text)) {
    return 'RESOLVED_EASING';
  }

  // CRITICAL BOTTLENECK: active crisis with immediate impact
  if (/(shortage|crisis|crunch|halt|suspend|disrupt|shut.?down|stock.?out|sold out|zero inventory|fuel crunch|blackout)/i.test(text) &&
      HARDWARE_SYSTEM.test(text)) {
    return 'CRITICAL_BOTTLENECK';
  }
  // CEO/exec urgency signals
  if (CEO_SIGNAL.test(text) && /(shortage|constraint|crisis|critical|urgent|severe)/i.test(text)) {
    return 'CRITICAL_BOTTLENECK';
  }
  // Quantified timeline urgency
  if (/\d+\s*(week|day|month)s?\s*(of supply|shortage|backlog|lead time|delay)/i.test(text)) {
    return 'CRITICAL_BOTTLENECK';
  }
  // Synthetic structural alerts marked CRITICAL
  if (/\[STRUCTURAL.*ALERT\]/i.test(text) && /(critical|intensif|constrain|bottleneck)/i.test(text)) {
    return 'CRITICAL_BOTTLENECK';
  }

  // BOTTLENECK: confirmed constraint, not immediate crisis
  if (PHYSICAL_CONSTRAINT.test(text) && HARDWARE_SYSTEM.test(text)) {
    return 'BOTTLENECK';
  }
  if (BREAKTHROUGH.test(text) && HARDWARE_SYSTEM.test(text)) {
    return 'BOTTLENECK';
  }
  if (SUPPLY_CHAIN_COMPANIES.test(text) && PHYSICAL_CONSTRAINT.test(text)) {
    return 'BOTTLENECK';
  }

  // WATCH: early/emerging signal
  if (IMPLICIT_CONSTRAINT.test(text)) {
    return 'WATCH';
  }
  if (HARDWARE_SYSTEM.test(text) && /(demand|growth|invest|spend|order|announce|plan|expand)/i.test(text)) {
    return 'WATCH';
  }

  // Default for anything classified BOTTLENECK by the main classifier
  return 'BOTTLENECK';
}

function classifyArticle(title: string, desc: string): { article_type: string; investment_tier: number; bottleneck_sub_tag?: string; bottleneck_level?: string } {
  const text = (title + ' ' + desc).toLowerCase();

  // ── 1. NOISE: clickbait, lifestyle, junk ──
  if (/multibagger|penny stock|should you buy|stock(s)? to buy|hot stock|best (stock|pick)|free tips|moneymaker|money.?maker|horoscope|recipe|cricket|bollywood|celebrity|entertainment|march madness|bracket|winnings|entry fee/i.test(text))
    return { article_type: 'GENERAL', investment_tier: 3 };

  // ══════════════════════════════════════════════════════════════════
  // EARNINGS GATE — run BEFORE bottleneck rules to prevent earnings
  // articles from being misclassified as BOTTLENECK just because they
  // mention credit growth, supply chain companies, etc.
  // "ICICI Bank beats Q4 earnings" should be EARNINGS, not BOTTLENECK.
  // ══════════════════════════════════════════════════════════════════
  const isEarningsArticle = /\b(earnings|quarterly results?|q[1-4]\s?(fy|20)|profit (up|down|rise|fall|beat|miss|jump|surge|decline)|revenue (up|down|rise|beat|miss|jump|surge|decline|growth)|results\s+(beat|miss|exceed|top)|beats? expectations?|miss(es|ed)? expectations?|guidance (raise|lower|maintain|reaffirm)|eps |net income|operating income|ebitda|bottom.?line|top.?line)\b/i.test(text);

  // If it's clearly an earnings article AND not about a core constraint domain, classify as EARNINGS
  if (isEarningsArticle) {
    // Exception: memory/semi companies reporting supply constraints in earnings
    const isCoreConstraintEarnings =
      /(hbm|dram|nand|cowos|packaging capacity|chip shortage|wafer capacity|supply constraint|allocation|lead time)/i.test(text) &&
      /(sk hynix|micron|samsung|tsmc|asml|intel foundry|nvidia)/i.test(text);
    if (!isCoreConstraintEarnings) {
      return { article_type: 'EARNINGS', investment_tier: 1 };
    }
  }

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
      return { article_type: 'BOTTLENECK', investment_tier: 1, bottleneck_sub_tag: getBottleneckSubTag(text), bottleneck_level: getBottleneckLevel(text) };
    }
  }

  // Rule 2: System + Breakthrough → BOTTLENECK (structural milestone)
  if (isSystem && isBreakthrough) {
    return { article_type: 'BOTTLENECK', investment_tier: 1, bottleneck_sub_tag: getBottleneckSubTag(text), bottleneck_level: getBottleneckLevel(text) };
  }

  // Rule 2b: Implicit constraint detection (demand-side signals without explicit "shortage")
  // Captures: "HBM demand outstrips supply", "DRAM running hot", etc.
  if (
    /(hbm|dram|nand|ddr5|photonics|optical interconnect|co-packaged optics|cowos|advanced packaging)/i.test(text) &&
    IMPLICIT_CONSTRAINT.test(text)
  ) {
    return { article_type: 'BOTTLENECK', investment_tier: 1, bottleneck_sub_tag: getBottleneckSubTag(text), bottleneck_level: getBottleneckLevel(text) };
  }

  // Rule 2c: Photonics-specific override (next bottleneck after power + packaging)
  if (
    /(silicon photonics|co-packaged optics|optical interconnect|cpo)/i.test(text) &&
    /(scaling|bandwidth|limit|bottleneck|power constraint|capacity|adoption|traction|deployment)/i.test(text)
  ) {
    return { article_type: 'BOTTLENECK', investment_tier: 1, bottleneck_sub_tag: getBottleneckSubTag(text), bottleneck_level: getBottleneckLevel(text) };
  }

  // Rule 2d: Memory company + memory term (company-led signals)
  if (
    /(sk hynix|micron|samsung)/i.test(text) &&
    /(hbm|dram|capacity|supply|allocation|lead time|pricing|margin|shortage)/i.test(text)
  ) {
    return { article_type: 'BOTTLENECK', investment_tier: 1, bottleneck_sub_tag: getBottleneckSubTag(text), bottleneck_level: getBottleneckLevel(text) };
  }

  // Rule 2e: Enhanced memory detection (underweight area)
  if (
    /(hbm3e?|dram|ddr5|nand)/i.test(text) &&
    /(tight|shortage|undersupply|pricing pressure|allocation|lead time|constraint)/i.test(text)
  ) {
    return { article_type: 'BOTTLENECK', investment_tier: 1, bottleneck_sub_tag: getBottleneckSubTag(text), bottleneck_level: getBottleneckLevel(text) };
  }

  // Rule 3a: India structural domains — HARD (always BOTTLENECK)
  // Nuclear, defence, DRDO/ISRO — these are genuine structural bottlenecks
  if (INDIA_STRUCTURAL_HARD.test(text)) {
    return { article_type: 'BOTTLENECK', investment_tier: 1, bottleneck_sub_tag: getBottleneckSubTag(text), bottleneck_level: getBottleneckLevel(text) };
  }

  // Rule 3b: India structural domains — SOFT (only BOTTLENECK with constraint signal)
  // Pharma, agri, banking, infra — only when there's real constraint language
  if (INDIA_STRUCTURAL_SOFT.test(text) && INDIA_SOFT_CONSTRAINT.test(text)) {
    return { article_type: 'BOTTLENECK', investment_tier: 1, bottleneck_sub_tag: getBottleneckSubTag(text), bottleneck_level: getBottleneckLevel(text) };
  }

  // Rule 4: Known supply chain company + constraint → BOTTLENECK
  if (SUPPLY_CHAIN_COMPANIES.test(text) && isConstraint) {
    return { article_type: 'BOTTLENECK', investment_tier: 1, bottleneck_sub_tag: getBottleneckSubTag(text), bottleneck_level: getBottleneckLevel(text) };
  }

  // Rule 5: CEO signal with supply/capacity context
  if (CEO_SIGNAL.test(text)) {
    return { article_type: 'BOTTLENECK', investment_tier: 1, bottleneck_sub_tag: getBottleneckSubTag(text), bottleneck_level: getBottleneckLevel(text) };
  }

  // ── 2. MARKET MOVES — index rallies, selloffs ──
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
  // Tightened: "buy" and "sell" alone are too broad (match almost everything).
  // Require analyst-context: "rating", "target price", "upgrade to buy", etc.
  if (/\b(upgrade[ds]?|downgrade[ds]?|target price|price target|outperform|underperform|overweight|underweight)\b/i.test(text))
    return { article_type: 'RATING_CHANGE', investment_tier: 1 };
  if (/\b(analyst|broker|brokerage|rating)\b.{0,20}\b(buy|sell|hold|neutral|accumulate|reduce)\b/i.test(text))
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

          const { article_type, investment_tier, bottleneck_sub_tag, bottleneck_level } = classifyArticle(title, desc);
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
            bottleneck_sub_tag: bottleneck_sub_tag || null,
            bottleneck_level: bottleneck_level || null,
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
        const { article_type, investment_tier, bottleneck_sub_tag, bottleneck_level } = classifyArticle(inner, '');
        const tickers = extractTickers(inner);
        articles.push({
          id: `ibef-${Buffer.from(href).toString('base64').slice(0, 20)}`,
          title: inner, headline: inner, summary: '',
          source_name: 'IBEF', source: 'IBEF', source_url: fullUrl,
          published_at: new Date().toISOString(), region: 'IN',
          article_type, investment_tier, bottleneck_sub_tag: bottleneck_sub_tag || null, bottleneck_level: bottleneck_level || null, tickers,
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
        const { article_type, investment_tier, bottleneck_sub_tag, bottleneck_level } = classifyArticle(inner, '');
        const tickers = extractTickers(inner);
        articles.push({
          id: `ibef-${Buffer.from(href).toString('base64').slice(0, 20)}`,
          title: inner, headline: inner, summary: '',
          source_name: 'IBEF', source: 'IBEF', source_url: fullUrl,
          published_at: new Date().toISOString(), region: 'IN',
          article_type, investment_tier, bottleneck_sub_tag: bottleneck_sub_tag || null, bottleneck_level: bottleneck_level || null, tickers,
          primary_ticker: tickers[0] || null, sentiment: null,
          importance_score: investment_tier === 1 ? 0.8 : 0.5,
        });
      }
    }
  } catch { /* IBEF scrape failed — non-critical */ }

  // ══════════════════════════════════════════════════════════════════════
  // INSTITUTIONAL RANKING: Score = Recency×0.4 + Severity×0.3 + Structural×0.3
  //
  // This replaces pure recency sort. The formula ensures:
  // - A CRITICAL structural alert (memory/photonics) with no fresh headline
  //   scores HIGHER than a 1-hour-old tier-2 general article
  // - Event shocks (fuel shortage, war disruption) still rank high via severity
  // - Structural alpha (multi-year themes) doesn't get buried by noise
  // ══════════════════════════════════════════════════════════════════════
  const now = Date.now();
  const HOUR = 3600000;

  // Severity map: article_type → severity score (0-1)
  const SEVERITY_MAP: Record<string, number> = {
    BOTTLENECK: 1.0,    // Supply constraints = highest severity
    GEOPOLITICAL: 0.85, // War, sanctions = high severity
    TARIFF: 0.8,        // Trade restrictions = high severity
    MACRO: 0.7,         // Fed, RBI, inflation = moderate-high
    EARNINGS: 0.6,      // Company results = moderate
    RATING_CHANGE: 0.5, // Analyst actions = moderate
    CORPORATE: 0.4,     // M&A, IPO = lower
    GENERAL: 0.1,       // Noise floor
  };

  // Structural importance: sub_tag driven (0-1)
  const STRUCTURAL_MAP: Record<string, number> = {
    MEMORY_STORAGE: 1.0,           // Current + multi-year bottleneck
    INTERCONNECT_PHOTONICS: 0.95,  // Emerging, highest asymmetry
    FABRICATION_PACKAGING: 0.9,    // Active CoWoS constraint
    COMPUTE_SCALING: 0.85,         // GPU demand > supply
    POWER_GRID: 0.8,               // Next binding constraint
    NUCLEAR_ENERGY: 0.75,          // Long-cycle, India strategic
    THERMAL_COOLING: 0.6,
    MATERIALS_SUPPLY: 0.55,
    QUANTUM_CRYOGENICS: 0.4,
    GENERAL_CONSTRAINT: 0.3,
  };

  articles.sort((a, b) => {
    const da = new Date(a.published_at).getTime() || 0;
    const db = new Date(b.published_at).getTime() || 0;

    // Recency: 1.0 → just published, decays to 0 over 48h (longer window)
    const recencyA = Math.max(0, 1 - (now - da) / (48 * HOUR));
    const recencyB = Math.max(0, 1 - (now - db) / (48 * HOUR));

    // Severity: from article_type
    const severityA = SEVERITY_MAP[a.article_type] || 0.1;
    const severityB = SEVERITY_MAP[b.article_type] || 0.1;

    // Structural importance: from bottleneck_sub_tag (non-BOTTLENECK = 0)
    const structA = a.article_type === 'BOTTLENECK' ? (STRUCTURAL_MAP[a.bottleneck_sub_tag] || 0.3) : 0;
    const structB = b.article_type === 'BOTTLENECK' ? (STRUCTURAL_MAP[b.bottleneck_sub_tag] || 0.3) : 0;

    // FINAL SCORE = Recency×0.4 + Severity×0.3 + Structural×0.3
    const scoreA = (recencyA * 0.4) + (severityA * 0.3) + (structA * 0.3);
    const scoreB = (recencyB * 0.4) + (severityB * 0.3) + (structB * 0.3);

    return scoreB - scoreA;
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

  // ── SYNTHETIC STRUCTURAL ARTICLES ──
  // Convert multi-year structural constraints into event-like articles
  // so they surface in the main feed alongside regular news.
  // Only inject if no real article covers this domain in current batch.
  const SYNTHETIC_STRUCTURAL: Array<{
    sub_tag: string;
    title: string;
    summary: string;
    status: string;
    tickers: string[];
    detect: RegExp;
  }> = [
    {
      sub_tag: 'MEMORY_STORAGE',
      title: '[STRUCTURAL ALERT] AI memory bottleneck intensifying — HBM supply constrained, demand accelerating',
      summary: 'HBM supply concentrated in 3-4 players. Memory bandwidth is the gating factor for AI scaling. Multi-year investment theme with 625x demand increase projected.',
      status: 'CRITICAL',
      tickers: ['MU', 'SKHYNIX'],
      detect: /hbm|dram|memory.{0,15}(shortage|constraint|tight|bandwidth|wall|supply)/i,
    },
    {
      sub_tag: 'INTERCONNECT_PHOTONICS',
      title: '[STRUCTURAL ALERT] Interconnect bandwidth wall — silicon photonics transition underway',
      summary: 'Copper interconnect saturating. AI clusters are bandwidth-bound, not compute-bound. Optical I/O becoming mandatory for next-gen AI infrastructure.',
      status: 'ELEVATED',
      tickers: ['COHR', 'LITE'],
      detect: /photonics|optical interconnect|co-packaged optics|cpo|bandwidth.{0,15}(bottleneck|limit|scaling)/i,
    },
    {
      sub_tag: 'FABRICATION_PACKAGING',
      title: '[STRUCTURAL ALERT] Advanced packaging capacity constraint — CoWoS remains binding bottleneck',
      summary: 'Multi-die architectures require CoWoS/EMIB. TSMC packaging capacity is the binding constraint for AI chip production. Lead times extended.',
      status: 'CRITICAL',
      tickers: ['TSM', 'AMKR'],
      detect: /cowos|advanced packaging|chiplet.{0,15}(capacity|constraint|shortage)/i,
    },
    {
      sub_tag: 'POWER_GRID',
      title: '[STRUCTURAL ALERT] Data center power demand outpacing grid infrastructure',
      summary: 'Grid capacity lagging data center buildout. Transformer shortages and substation backlogs. Power is the next binding constraint after compute and packaging.',
      status: 'ELEVATED',
      tickers: ['GEV', 'SIEGY'],
      detect: /power grid|transformer.{0,15}(shortage|backlog)|data center.{0,15}power/i,
    },
  ];

  // Check which structural domains are already covered by real articles
  const allText = diversified.map(a => (a.title + ' ' + (a.summary || '')).toLowerCase()).join(' ');
  const syntheticArticles: any[] = [];

  for (const synth of SYNTHETIC_STRUCTURAL) {
    if (!synth.detect.test(allText)) {
      // No real article covers this domain — inject synthetic
      syntheticArticles.push({
        id: `synthetic-${synth.sub_tag}`,
        title: synth.title,
        headline: synth.title,
        summary: synth.summary,
        source_name: 'Structural Analysis',
        source: 'Structural Analysis',
        source_url: '',
        published_at: new Date().toISOString(),
        region: 'GLOBAL',
        article_type: 'BOTTLENECK',
        investment_tier: 1,
        bottleneck_sub_tag: synth.sub_tag,
        tickers: synth.tickers,
        primary_ticker: synth.tickers[0] || null,
        sentiment: null,
        importance_score: synth.status === 'CRITICAL' ? 0.95 : 0.85,
        is_synthetic: true,
        structural_status: synth.status,
        bottleneck_level: synth.status === 'CRITICAL' ? 'CRITICAL_BOTTLENECK' : 'BOTTLENECK',
      });
    }
  }

  const withSynthetics = [...diversified, ...syntheticArticles];

  // Add impact statements + investment tickers
  const articlesWithImpact = withSynthetics.map(a => ({
    ...a,
    impact_statement: generateImpact(a.title, a.summary || '', a.article_type),
    investment_tickers: a.article_type === 'BOTTLENECK' ? getInvestmentTickers(a.title + ' ' + (a.summary || '')) : [],
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

    // ══════════════════════════════════════════════════════════════════
    // STRUCTURAL PINNING: When viewing BOTTLENECK articles,
    // pin [STRUCTURAL ALERT] items in top 5, then event bottlenecks.
    // This creates 2 visual layers:
    //   Layer 1: "Structural Constraints (Alpha Layer)" — pinned top
    //   Layer 2: "Immediate Bottlenecks" — event-driven, below
    // ══════════════════════════════════════════════════════════════════
    if (type === 'BOTTLENECK' || type === '') {
      const structural = filtered.filter(a => a.is_synthetic || a.structural_status);
      const events = filtered.filter(a => !a.is_synthetic && !a.structural_status);

      // Sort structural by status: CRITICAL first, then ELEVATED
      structural.sort((a, b) => {
        const statusOrder: Record<string, number> = { CRITICAL: 0, ELEVATED: 1, EMERGING: 2 };
        const aOrder = statusOrder[a.structural_status] ?? 3;
        const bOrder = statusOrder[b.structural_status] ?? 3;
        return aOrder - bOrder;
      });

      // Tag each article with its feed_layer for frontend rendering
      const taggedStructural = structural.map(a => ({
        ...a,
        feed_layer: 'STRUCTURAL_ALPHA' as const,
      }));
      const taggedEvents = events.map(a => ({
        ...a,
        feed_layer: 'IMMEDIATE_BOTTLENECK' as const,
      }));

      filtered = [...taggedStructural, ...taggedEvents];
    }

    return NextResponse.json(filtered);
  } catch (error) {
    console.error('[News API] Error:', error);
    return NextResponse.json([], { status: 200 });
  }
}
