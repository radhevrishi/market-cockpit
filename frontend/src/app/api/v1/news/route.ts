import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { recordXRef } from '@/lib/news/cross-reference';
import {
  buildInstitutionalEnvelope, shouldKeepEarnings, generateInstitutionalImpactLabel,
  generateWhyThisMatters, buildConsensusVariant, applySignalDecay, buildCausalChain,
  classifyAnomaly, classifyTickerAnomaly,
} from '@/lib/news/institutional-engine';
import { scoreAnchor, BOTTLENECK_ANCHOR_THRESHOLD, getSourceCredibility, detectResolutionState, inferBottleneckCategory } from '@/lib/news/ontology';
// PATCH 0051: 10-year semantic graph architecture
import { scoreGraph, GRAPH_ANCHOR_THRESHOLD, NODE_DISPLAY } from '@/lib/news/semantic-graph';
import { classifySourceTier, getTierContribution } from '@/lib/news/source-tiers';
import { recordEvidence, readEvidence } from '@/lib/news/evidence-accumulator';
// PATCH 0052: Causal-honesty layer + 0061 evidence-bound impact + 0062 relevance
import {
  classifyAssertion, frameImpact, hasDirectComputeLinkage, isGenericPowerStory,
  classifyDefenseNarrative, computeFreshnessLayer, buildSignalConfidence,
  buildEvidenceBoundImpact, computeStructuralRelevance,
} from '@/lib/news/assertion-classifier';
// PATCH 0059: Structural state classifier (BOTTLENECK / CAPACITY_EXPANSION / etc)
import { classifyStructuralState } from '@/lib/news/structural-state';
// PATCH 0064: Strategic Visibility / Mega Frameworks engine
import {
  classifyStrategicVisibility,
  strategicRankScore,
  classifySignalQuality,
  extractCapacityReserved,
  computeDependencyScore,
  buildWhyThisMatters as buildSvWhyThisMatters,
  buildSecondOrder as buildSvSecondOrder,
  formatStrategicLine,
  FLAG_DISPLAY,
} from '@/lib/news/strategic-visibility';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ── RSS Feed Sources ──────────────────────────────────────────────────
// Each feed gets a `tier` so the BOTTLENECK classifier can require
// primary/secondary sources before assigning HIGH-tier institutional
// labels. Newegg deal pages and retro-gaming sites can mention
// "chip shortage" but should never become a $30k-terminal alert.
//
// tier='primary'  — central banks, regulators, IR transcripts (highest weight)
// tier='secondary'— newswires (Reuters / Bloomberg / CNBC) and quality dailies
// tier='tertiary' — broad business/tech press (TechCrunch / Yahoo / Investing.com)
// tier='editorial'— curated commentary feeds (Stratechery / Doomberg / Substacks)
// tier='retail'   — consumer-tech / hobby sites (Tom's Hardware / Anandtech / retro)
//                   articles from these can only reach BOTTLENECK if they ALSO
//                   pass a strict signal gate (CEO quote, named institution).
const RSS_FEEDS: Array<{ name: string; url: string; region: string; tier: 'primary' | 'secondary' | 'tertiary' | 'editorial' | 'retail' }> = [
  // ── India Feeds ──
  { name: 'ET Markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', region: 'IN', tier: 'secondary' },
  { name: 'ET Industry', url: 'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms', region: 'IN', tier: 'secondary' },
  { name: 'Livemint Markets', url: 'https://www.livemint.com/rss/markets', region: 'IN', tier: 'secondary' },
  { name: 'Livemint Companies', url: 'https://www.livemint.com/rss/companies', region: 'IN', tier: 'secondary' },
  { name: 'Business Standard', url: 'https://www.business-standard.com/rss/markets-106.rss', region: 'IN', tier: 'secondary' },
  { name: 'BS Companies', url: 'https://www.business-standard.com/rss/companies-101.rss', region: 'IN', tier: 'secondary' },
  { name: 'NDTV Profit', url: 'https://feeds.feedburner.com/ndtvprofit-latest', region: 'IN', tier: 'secondary' },
  { name: 'Mint Economy', url: 'https://www.livemint.com/rss/economy', region: 'IN', tier: 'secondary' },
  // ── US / Global Feeds ──
  { name: 'CNBC Top News', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', region: 'US', tier: 'secondary' },
  { name: 'CNBC World', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362', region: 'US', tier: 'secondary' },
  { name: 'CNBC Finance', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', region: 'US', tier: 'secondary' },
  { name: 'CNBC Technology', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19854910', region: 'US', tier: 'secondary' },
  { name: 'MarketWatch Top Stories', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', region: 'US', tier: 'secondary' },
  { name: 'MarketWatch Markets', url: 'https://feeds.marketwatch.com/marketwatch/marketpulse/', region: 'US', tier: 'secondary' },
  { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', region: 'US', tier: 'tertiary' },
  { name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews', region: 'US', tier: 'primary' },
  { name: 'Reuters Technology', url: 'https://feeds.reuters.com/reuters/technologyNews', region: 'US', tier: 'primary' },
  { name: 'Reuters India', url: 'https://feeds.reuters.com/reuters/INbusinessNews', region: 'GLOBAL', tier: 'primary' },
  { name: 'Investing.com News', url: 'https://www.investing.com/rss/news.rss', region: 'US', tier: 'tertiary' },
  { name: 'Seeking Alpha Market News', url: 'https://seekingalpha.com/market_currents.xml', region: 'US', tier: 'tertiary' },
  // ── Semiconductor / Tech Supply Chain Feeds ──
  { name: 'Tom\'s Hardware', url: 'https://www.tomshardware.com/feeds/all', region: 'US', tier: 'retail' },
  { name: 'AnandTech', url: 'https://www.anandtech.com/rss/', region: 'US', tier: 'retail' },
  { name: 'The Register', url: 'https://www.theregister.com/headlines.atom', region: 'US', tier: 'tertiary' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', region: 'US', tier: 'tertiary' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', region: 'US', tier: 'tertiary' },
  { name: 'SemiWiki', url: 'https://semiwiki.com/feed/', region: 'US', tier: 'tertiary' },
  // ── Memory / Storage Cycle Feeds ──
  { name: 'DigiTimes Memory', url: 'https://www.digitimes.com/rss/memory.xml', region: 'GLOBAL', tier: 'tertiary' },
  { name: 'Blocks & Files', url: 'https://blocksandfiles.com/feed/', region: 'GLOBAL', tier: 'tertiary' },
  // ── Photonics / Optical Interconnect Feeds ──
  { name: 'Lightwave', url: 'https://www.lightwaveonline.com/rss', region: 'GLOBAL', tier: 'tertiary' },
  { name: 'Photonics.com', url: 'https://www.photonics.com/RSS/feeds/industry.xml', region: 'GLOBAL', tier: 'tertiary' },
  // ── Power / Industry Feeds ──
  { name: 'Power Technology', url: 'https://www.power-technology.com/feed/', region: 'GLOBAL', tier: 'tertiary' },
  // ── EDITORIAL / COMMENTARY (Phase 3 #13) ──
  // Top buy-side reads — kept separate so they don't pollute the news
  // feed but are accessible via the Commentary tab. Stratechery is
  // paywalled but its public Daily Update RSS is free; Doomberg is
  // partially open; Matt Levine's Bloomberg column has a public summary.
  { name: 'Stratechery', url: 'https://stratechery.com/feed/', region: 'GLOBAL', tier: 'editorial' },
  { name: 'Doomberg', url: 'https://newsletter.doomberg.com/feed', region: 'GLOBAL', tier: 'editorial' },
  { name: 'Matt Levine (Money Stuff)', url: 'https://www.bloomberg.com/feeds/columns/4cb35e0d-fe22-4b29-bd64-5108f0b1cefa.rss', region: 'US', tier: 'editorial' },
  { name: 'The Information Tech', url: 'https://www.theinformation.com/feed', region: 'US', tier: 'editorial' },
  // RBI speeches feed — primary source for India monetary policy
  { name: 'RBI Speeches', url: 'https://www.rbi.org.in/Scripts/RSS_Speeches.aspx', region: 'IN', tier: 'primary' },
  // ── Additional high-quality India sources ──
  // Moneycontrol — main feed has all market news
  { name: 'Moneycontrol Markets', url: 'https://www.moneycontrol.com/rss/marketreports.xml', region: 'IN', tier: 'secondary' },
  { name: 'Moneycontrol Business', url: 'https://www.moneycontrol.com/rss/business.xml', region: 'IN', tier: 'secondary' },
  { name: 'Moneycontrol Results', url: 'https://www.moneycontrol.com/rss/results.xml', region: 'IN', tier: 'secondary' },
  // Trendlyne — earnings + brokerage note aggregation
  { name: 'Trendlyne News', url: 'https://trendlyne.com/feed/', region: 'IN', tier: 'secondary' },
  // SEBI press releases — primary regulator filings
  { name: 'SEBI Press Releases', url: 'https://www.sebi.gov.in/sebirss.xml', region: 'IN', tier: 'primary' },
  // BSE corporate announcements — primary source for ALL listed-co disclosures
  { name: 'BSE Corp Announcements', url: 'https://www.bseindia.com/data/xml/notices.xml', region: 'IN', tier: 'primary' },
  // ── Additional India business news ──
  { name: 'Financial Express Markets', url: 'https://www.financialexpress.com/market/feed/', region: 'IN', tier: 'secondary' },
  { name: 'Business Today Markets', url: 'https://www.businesstoday.in/rss/markets', region: 'IN', tier: 'secondary' },
  { name: 'CNBC TV18 Markets', url: 'https://www.cnbctv18.com/rss/market.xml', region: 'IN', tier: 'secondary' },
  { name: 'CNBC TV18 Companies', url: 'https://www.cnbctv18.com/rss/business.xml', region: 'IN', tier: 'secondary' },
  // Sector-specific Indian feeds
  { name: 'ET Tech', url: 'https://economictimes.indiatimes.com/tech/technology/rssfeeds/13352306.cms', region: 'IN', tier: 'secondary' },
  { name: 'ET Auto', url: 'https://economictimes.indiatimes.com/industry/auto/rssfeeds/64829342.cms', region: 'IN', tier: 'secondary' },
  { name: 'ET Banking', url: 'https://economictimes.indiatimes.com/industry/banking/finance/rssfeeds/13358341.cms', region: 'IN', tier: 'secondary' },
  { name: 'ET Pharma', url: 'https://economictimes.indiatimes.com/industry/healthcare/biotech/pharmaceuticals/rssfeeds/13358365.cms', region: 'IN', tier: 'secondary' },
  // Analytical / commentary
  { name: 'Equitymaster', url: 'https://www.equitymaster.com/detail.asp?date=&story=&id=&fmt=rss', region: 'IN', tier: 'editorial' },
  { name: 'INDmoney', url: 'https://www.indmoney.com/blog/feed', region: 'IN', tier: 'tertiary' },
  // ── US institutional sources we were missing ──
  { name: 'WSJ Markets', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', region: 'US', tier: 'primary' },
  { name: 'Bloomberg Markets', url: 'https://feeds.bloomberg.com/markets/news.rss', region: 'US', tier: 'primary' },
  { name: 'Bloomberg Politics', url: 'https://feeds.bloomberg.com/politics/news.rss', region: 'US', tier: 'primary' },
  { name: 'FT Markets', url: 'https://www.ft.com/markets?format=rss', region: 'GLOBAL', tier: 'primary' },

  // ─── PATCH 0051: Specialist feeds — durable domain depth ─────────────
  // Semis / AI Infra
  { name: 'TrendForce',           url: 'https://www.trendforce.com/news/feed', region: 'GLOBAL', tier: 'secondary' },
  { name: 'EE Times',              url: 'https://www.eetimes.com/feed/',        region: 'US',     tier: 'secondary' },
  { name: 'Data Center Dynamics',  url: 'https://www.datacenterdynamics.com/en/rss/', region: 'GLOBAL', tier: 'secondary' },
  { name: 'Light Reading',         url: 'https://www.lightreading.com/rss_simple.asp', region: 'US', tier: 'secondary' },
  { name: 'ServeTheHome',          url: 'https://www.servethehome.com/feed/',   region: 'US',     tier: 'secondary' },
  { name: 'NextPlatform',          url: 'https://www.nextplatform.com/feed/',   region: 'US',     tier: 'secondary' },
  // Energy / Grid / Commodity
  { name: 'Utility Dive',          url: 'https://www.utilitydive.com/feeds/news/', region: 'US', tier: 'secondary' },
  { name: 'Power Engineering',     url: 'https://www.power-eng.com/feed/',      region: 'US',     tier: 'secondary' },
  { name: 'World Nuclear News',    url: 'https://world-nuclear-news.org/RSS',   region: 'GLOBAL', tier: 'secondary' },
  { name: 'OilPrice',              url: 'https://oilprice.com/rss/main',        region: 'GLOBAL', tier: 'secondary' },
  { name: 'FreightWaves',          url: 'https://www.freightwaves.com/news/feed', region: 'US',   tier: 'secondary' },
  // Defense / Aerospace
  { name: 'Defense News',          url: 'https://www.defensenews.com/arc/outboundfeeds/rss/', region: 'US', tier: 'secondary' },
  { name: 'Breaking Defense',      url: 'https://breakingdefense.com/feed/',    region: 'US',     tier: 'secondary' },
  { name: 'SpaceNews',             url: 'https://spacenews.com/feed/',          region: 'US',     tier: 'secondary' },
  { name: 'Aviation Week',         url: 'https://aviationweek.com/rss.xml',     region: 'US',     tier: 'secondary' },
  // India infra / industrial
  { name: 'ET Infra',              url: 'https://infra.economictimes.indiatimes.com/rss/topstories', region: 'IN', tier: 'secondary' },
  { name: 'ET EnergyWorld',        url: 'https://energy.economictimes.indiatimes.com/rss/topstories', region: 'IN', tier: 'secondary' },
  { name: 'ET Telecom',            url: 'https://telecom.economictimes.indiatimes.com/rss/topstories', region: 'IN', tier: 'secondary' },
  { name: 'Power Line',            url: 'https://powerline.net.in/feed/',       region: 'IN',     tier: 'secondary' },
  { name: 'Renewable Watch',       url: 'https://renewablewatch.in/feed/',      region: 'IN',     tier: 'secondary' },
  { name: 'Construction World',    url: 'https://www.constructionworld.in/rss', region: 'IN',     tier: 'secondary' },
  // India defense
  { name: 'Livefist',              url: 'https://www.livefistdefence.com/feed', region: 'IN',     tier: 'secondary' },
  { name: 'IDRW',                  url: 'https://www.idrw.org/feed/',           region: 'IN',     tier: 'secondary' },
  // India electronics / EMS
  { name: 'ElectronicsB2B',        url: 'https://www.electronicsb2b.com/feed/', region: 'IN',     tier: 'secondary' },
];

// Domain denylist for BOTTLENECK tier escalation. These sources can
// surface in the GENERAL feed but cannot trigger a HIGH-signal
// structural-bottleneck alert even if they mention "chip shortage" in
// passing — the article is almost certainly a deal page, retro toy, or
// gaming PC build.
const BOTTLENECK_DOMAIN_DENYLIST = /\b(newegg|bestbuy|amazon\.com\/dp|microcenter|tigerdirect|reddit\.com|youtube\.com\/watch|retro.?gaming|amiga|commodore|nintendo|playstation|xbox|gaming pc|deal|combo|bundle (?:includes|deal)|coupon|discount|black friday|cyber monday|prime day|save \$\d|usd\d{3}\.?\d*|\d+%\s*off)\b/i;

const CACHE_KEY = 'news:articles:v20'; // v20: strategic visibility v2 — signal quality tier, capacity reserved, dependency score, why-this-matters, second-order (0067)
const CACHE_TTL = 300; // 5 min
// v13 → v14 bump: schema now includes impact_assertion, defense_narrative,
// freshness_layer, signal_confidence (multi-dim), bottleneck_parent /
// bottleneck_child hierarchy. Older entries lack them.
const BOTTLENECK_PERSISTENT_KEY = 'bottleneck:articles:persistent:v14';
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
// Expanded to capture more genuine India structural news the user flagged:
// power deficit, coal supply, water scarcity, port/freight congestion,
// railway freight congestion, MIRV / Agni / Tejas defence platforms,
// space sector PSLV / GSLV launches, semiconductor mission (ISM), PLI
// corridors (Dholera / Sanand fab parks).
// EXPANDED INDIA structural HARD list — match US-side breadth.
// Adds: PLI scheme disbursements, defence corridor allocations,
// EMS/PCB capacity expansions, EV battery cell mfg, green hydrogen,
// Vande Bharat railway tenders, refinery commissioning, ISM
// approvals, NPCIL reactor commissioning, lithium reserves, rare
// earth processing, Dholera/Sanand fab construction milestones,
// gas pipeline (KG-D6/KG-Krishna), city gas distribution, defence
// export licences, BEL/HAL contract wins, BEML defence orders,
// strategic petroleum reserve, captive coal blocks, power
// transmission Gati Shakti, semiconductor design wins.
//
// IMPORTANT: missile-test announcements WITHOUT named exposed
// company are EXCLUDED from this list (moved to MISSILE_TEST_NOISE_RE
// below) — pure platform tests aren't actionable structural news.
const INDIA_STRUCTURAL_HARD = new RegExp(
  '(' +
    // Nuclear
    'nuclear (reactor|power|plant|energy|fuel|capacity|project|milestone|commissioned)|atomic (reactor|energy)|thorium|breeder reactor|kalpakkam|kudankulam|npcil|bhavini|criticality|atomic energy commission|' +
    // Defence orders / contracts (NOT just tests)
    'defence (order|procurement|deal|budget|corridor|export|contract win)|defense (order|procurement|contract|budget|spending|export)|drdo (order|approval|technology transfer)|isro (mission|order|contract)|hal (order|deliver|contract win|production)|bel (order|contract)|bdl (order)|gtre|garden reach order|cochin shipyard order|mazagon dock order|' +
    // Defence platform commissioning (only when structural)
    'tejas (delivery|production line|batch)|brahmos (export|order)|akash (export|deployment|order)|s-400|rafale (delivery|squadron)|p-?75 (submarine|alpha)|pinaka order|' +
    // Space sector commercial wins
    'pslv (launch|commercial|mission|order)|gslv (mission|launch|order)|chandrayaan (mission|launch)|gaganyaan (test|mission|module)|space sector (private|reform|policy)|isro (commercial|spacex|partnership)|' +
    // Semiconductor mission
    'india semiconductor mission|ism (mou|approval|incentive|disburs)|dholera (fab|semiconductor|construction)|sanand fab|micron.{0,20}gujarat|tata.{0,20}semiconductor|vedanta.{0,20}fab|tower semiconductor india|polymatech|kaynes (semiconductor|fab)|asm india|asm semiconductor india|' +
    // PLI scheme disbursements / approvals (real money flow)
    'pli (scheme )?(disburs|approved|allocated|released)|production[- ]linked incentive (disburs|approved|allocated|released)|fame[- ]ii\\s+(disburs|extended|allocated)|' +
    // Power & grid
    'power deficit|electricity shortage|load shedding|grid stress|grid frequency|grid (congestion|capacity)|coal (shortage|stockpile|allocation|crisis|stock at)|hydropower (commissioned|tender)|pumped storage|' +
    // EV battery cell manufacturing
    'battery cell (manufacturing|capacity|gigafactory)|gigafactory india|li[- ]?ion cell india|exide cell|amara raja cell|' +
    // Green hydrogen / renewables
    'green hydrogen (mission|order|capacity|tender)|electrolyser (capacity|order)|' +
    // Critical minerals
    'lithium (reserve|exploration|mine) india|rare earth (processing|reserve|mine) india|kabil|amrita|critical mineral (allocation|policy)|' +
    // Refinery / petroleum
    'refinery (commissioning|capacity expansion|throughput|shutdown)|spr|strategic petroleum reserve india|' +
    // Pipeline / gas distribution
    'gas pipeline (capacity|commissioning|throughput|tender)|city gas (distribution|tender|round)|kg[- ]?d6|kg[- ]?krishna|' +
    // Railway / Vande Bharat
    'vande bharat (order|production|tender)|rail vikas (order|tender)|metro (rail tender|coach order)|loco (manufacturing|order)|wag-?\\d+ (order|tender)|' +
    // Highway / EPC (when actual order, not preview)
    'nhai (award|contract awarded|tender awarded)|highway (project awarded|contract awarded)|hybrid annuity model award|hsm award|' +
    // Water / industrial
    'water scarcity industrial|industrial water shortage|jal jeevan (allocation|disburs)|' +
    // Ports / freight
    'jnpt (congestion|backlog|expansion)|port (congestion|backlog|expansion) india|major port (capacity|expansion)|sagarmala (allocation|approval)|railway freight (congestion|capacity)|cargo (backlog|delay) india|' +
    // Banking / NBFC structural events
    'rbi.{0,20}(licence|license|repealed|revoke|granted)|sebi (final order|enforcement order|surveillance)|insolvency (resolution|admission)|ibc (admission|liquidation)|' +
    // Auto BS-VII / EV mandate
    'bs[- ]?vii|bs[- ]?7|fame[- ]?iii|ev mandate|electric vehicle policy india|' +
  ')',
  'i'
);

// MISSILE_TEST_NOISE_RE — defence platform tests without named
// exposed company. These show up as "Agni MIRV test", "BrahMos test
// fire" but unless the article also names HAL/BEL/BDL/L&T they have
// no actionable institutional read. Demote to GENERAL.
const MISSILE_TEST_NOISE_RE = /\b(successfully tests?|test fire[ds]?|test launch|capability test|inducted into service|range tested|missile capability|test demonstration|nuclear[- ]capable test|first test)\b/i;

// ── India structural domains — SOFT: only BOTTLENECK when ALSO has constraint signal ──
// These domains are real but articles about them are often earnings/macro/general news.
// E.g., "ICICI Bank Q4 earnings with strong credit growth" should NOT be BOTTLENECK.
// Expanded with: forex / rupee depreciation crunch, container shortages,
// urea / DAP / MOP fertilizer crunch, gas pipeline capacity, refinery
// throughput, steel / aluminum / copper India supply.
const INDIA_STRUCTURAL_SOFT = /(drug (shortage|approval)|usfda|fda (approval|warning)|api (supply|shortage)|pharma.*supply|bulk drug|monsoon|crop (failure|output|damage)|food inflation|fertilizer (shortage|subsidy)|agriculture crisis|infrastructure (order|bottleneck|spend)|highway (project|order|delay)|railway (order|electrif|expansion)|npa|credit (crunch|squeeze)|nbfc (crisis|liquidity)|rupee (depreciat|fall|crash|weaken)|forex (reserve|crunch|deplet)|container (shortage|cost|rate)|urea (shortage|import)|dap (shortage|import)|mop (shortage|import)|gas pipeline (capacity|throughput)|refinery (throughput|maintenance|shutdown)|steel (price|inventory|prod) india|aluminium (price|capacity) india|copper (price|capacity) india)/i;

// Signals that the soft domain is actually a constraint (not just reporting)
const INDIA_SOFT_CONSTRAINT = /(shortage|crisis|crunch|squeeze|bottleneck|constraint|delay|halt|suspend|capacity limit|underspend|overdue|stalled|backlog|supply gap|stretched|stress|deplet|deficit)/i;

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

// PATCH 0047: TITLE_ANCHOR_RE — for an article to reach BOTTLENECK,
// its TITLE itself (not just summary blurb) must contain at least
// one structural anchor: a hardware system token, a named
// structural company, or a named supply-chain company. Without a
// title anchor, articles fall through to GENERAL.
//
// Why this matters: classifyArticle was reading (title + desc).
// Many unrelated articles ("Putin Ukraine conflict", "GM privacy
// settlement", "Trump Media reports $2.2B") have summary text that
// drops words like "supply chain disruption" or "data center" in
// passing — enough to trigger HARDWARE_SYSTEM × PHYSICAL_CONSTRAINT.
// Anchoring on title alone keeps the BOTTLENECK feed honest.
const TITLE_BOTTLENECK_ANCHOR_RE = /\b(chip|chips|chipmaker|semiconductor|wafer|fab|foundry|memory chip|dram|nand|hbm|cowos|chiplet|packaging|interposer|photonics|optical interconnect|cpo|gpu|tpu|ai accelerator|ai chip|data center|server rack|compute cluster|grid|power grid|electricity grid|reactor|nuclear|transmission line|substation|transformer|cooling|thermal|shipping container|port|pipeline|refinery|refining|tsmc|asml|sk hynix|micron|samsung|nvidia|amd|broadcom|qualcomm|infineon|wolfspeed|coherent|lumentum|amkor|ase group|globalfoundries|intel foundry|applied materials|lam research|hal\b|bel\b|bdl\b|bhel|npcil|bhavini|brahmos|drdo|isro|mazagon|cochin shipyard|grse|garden reach|bharat dynamics|bharat electronics|bharat earth movers|beml|tata advanced|tata electronics|tata semiconductor|adani defence|paras defence|astra microwave|data patterns|midhani|mishra dhatu|coal india|power grid corp|ntpc|nhpc|kaynes|syrma sgs|dixon|polymatech|amkor india|micron gujarat|drdo|isro|kalpakkam|kudankulam|dholera|sanand|critical mineral|rare earth|lithium|cobalt|euv|lithography|battery cell|gigafactory|electrolyser|green hydrogen|solar capacity|wind capacity|hydropower|coal shortage|coal stockpile|fuel crunch|gas pipeline|kg-?d6|vande bharat|agni|tejas|akash missile|s-400|rafale|p-?75 submarine|pinaka|pslv|gslv|chandrayaan|gaganyaan|space sector|semiconductor mission|ism\s|pli scheme|fame[- ]?ii|fame[- ]?iii|nhai award|highway awarded)\b/i;

function classifyArticle(title: string, desc: string): { article_type: string; investment_tier: number; bottleneck_sub_tag?: string; bottleneck_level?: string } {
  const text = (title + ' ' + desc).toLowerCase();
  const titleLower = title.toLowerCase();
  const titleHasAnchor = TITLE_BOTTLENECK_ANCHOR_RE.test(title);

  // ── 1. NOISE FILTER — institutional terminal: aggressive subtraction ──
  //
  // Premise: a $30k institutional feed survives on omission quality.
  // Out of ~190 daily stories only ~8 should reach the surface. We drop
  // EVERYTHING that doesn't carry earnings / supply-chain / regime /
  // capital-flow / cross-sector consequence.
  //
  // Tier 4 = filter-eligible (UI drops). Categories that hit tier 4:
  //   - Retail clickbait + multibagger pumps
  //   - Personal finance / retirement / advice columns
  //   - Sports + celebrity + entertainment
  //   - Indian regional politics without policy/regulatory angle
  //   - Generic market wraps ("Sensex falls 500 points", "top gainers")
  //   - Generic premarket / after-hours stock movers
  //   - Tech trivia / lifestyle / product reviews
  //   - Generic geopolitical filler (war daily updates without specific
  //     supply-chain / earnings consequence)
  //   - SEO listicles ("most overvalued tech stocks", "top picks")

  // Retail / clickbait
  const NOISE_RE = /\b(multibagger|penny stock|should you buy|stock(s)? to buy|hot stock|best (stock|pick)|free tips|moneymaker|money.?maker|horoscope|recipe|bollywood|celebrity|entertainment|march madness|bracket|winnings|entry fee|top gainers? & losers?|top gainers? and losers?|q4 results today live|quarterly results live)\b/i;

  // Personal finance / retirement / advice columns — institutional readers
  // don't need "I'm 66, should I invest $100k" or "recession-proof retirement"
  // PATCH 0046: extended to catch Indian personal-finance columns
  // (SIP picks, ELSS guide, PPF vs NPS, tax-saving fund) and US
  // retirement / advice fluff (suze orman, dave ramsey, fidelity advice).
  const PERSONAL_FINANCE_RE = /\b(i'?m \d{2}|should i invest|recession.?proof (your |my )?(retirement|income)|social security disability|my (mother|father|niece|nephew|aunt|uncle).{0,40}(invest|inherit|disability|insurance)|will i lose|should i buy|should i sell|am i wrong|am i right|americans are not great|paying social security|does this make sense|how to save|how to invest|how to retire|ways to (save|grow|invest|retire)|tips to (save|invest|retire|grow your (wealth|money))|top \d+ (sip|elss|mutual fund|tax saving|nps|ppf)|best (sip|elss|mutual fund|tax.?saving|nps|ppf|life insurance|health insurance|term insurance|ulip|fd|fixed deposit) (?:for|of|to|picks?|funds?|plans?)|sip picks?|elss picks?|tax.?saving (fund|tip|investment|plan|guide)|retirement (planning|guide|tip|calculator)|ppf (vs|guide|interest rate|account)|nps (vs|guide|tier ?\d|return)|sukanya samriddhi|atal pension|kvp guide|mutual fund picks? for|mutual fund recommendation|monthly sip|sip vs lumpsum|lumpsum vs sip|ulip vs|term insurance vs|life insurance vs|health insurance (guide|picks?|comparison)|fixed deposit (vs|guide|rate|picks?)|gold (etf|sgb|bond) (guide|picks?|invest)|sovereign gold bond (guide|picks?|invest)|home loan (guide|tip|emi|tenure|prepay)|emi (calculator|guide|tip)|credit card (guide|tip|reward|points|review|comparison)|debt mutual fund|liquid fund picks?|hybrid fund picks?|focused fund picks?|smallcap fund picks?|midcap fund picks?|largecap fund picks?|index fund picks?|fund of fund|suze orman|dave ramsey|robert kiyosaki|how much (do you|should you) (need|save)|million dollar retirement|millionaire next door|frugal living|early retirement|fire movement|fatfire|coastfire|leanfire|side hustle|passive income (guide|stream|tip)|emergency fund|budget (template|tip|guide))\b/i;

  // Sports — require sports CONTEXT, not just "cricket" anywhere
  const SPORTS_RE = /\b(test (cricket|match|series)|odi (match|series)|t20 (match|series|world cup)|ipl (match|score|auction|playoff)|fifa|world cup (final|qualifier)|olympic|asian games|asia cup|kabaddi|wfi|vinesh phogat|rohit sharma|virat kohli|mahendra dhoni|wrestling federation|doping (rule|violation)|cricket (board|league|fixture|controversy|live updates|broadcast))\b/i;

  // Indian regional politics without direct investing angle (TVK / VCK /
  // local elections / party-leadership churn). Investing-relevant
  // policy / Budget / GST / regulatory still pass through other paths.
  const REGIONAL_POLITICS_RE = /\b(vck|tvk|iuml|admk|mdmk|pmk|ntk|dmdk|amma makkal|vijay (push|leader|tvk|party)|tamilnadu (election|politics|party|leader|chief minister)|stalin (election|cabinet|reshuffle)|president'?s? rule|local elections? defeat|show.?cause notice (to|against)|ww2 victory parade|russia (holds|scaled|parade))\b/i;

  // Pure tech trivia / lifestyle / product reviews / consumer fluff
  // PATCH 0046 EXPANSION: catches Bloomberg lifestyle videos, movie / film
  // reviews, music / album / concert blurbs, celebrity auctions
  // (Marilyn Monroe), royal-family fashion columns, food / restaurant
  // columns, dating-app trend pieces. These were leaking into the
  // BOTTLENECK feed via INDIA_STRUCTURAL_HARD's loose 'order'/'approval'
  // matches in titles like "Court order on Marilyn Monroe auction" or
  // "BSE approves new movie premiere advertising package".
  const FLUFF_RE = /\b(rooftop swimming pool|tux the penguin|linux mascot|amiga emulating|retro gaming|reddit blocked|tricked.?out terminals?|share your shell|instant photography|instax|ars asks|build on|clips feed|tiktok.?like|whoop on.?demand|rooftop pool|bt tower|frontier plane|frog dies|teflon market|prestigious job|housing market lost|punching above|movie review|film review|box[- ]?office|premiere|trailer|box office collection|mortal kombat|marvel cinematic|dc universe|netflix series|amazon prime video|amazon prime original|disney\+ original|coachella|grammy|oscar|cannes|met gala|red carpet|fashion week|royal family|kate middleton|prince william|prince harry|meghan markle|marilyn monroe|elvis presley|beatles album|taylor swift|rihanna|beyonce|kim kardashian|celebrity auction|estate auction|memorabilia auction|christie'?s? auction|sotheby'?s? auction|wedding (gown|dress|ring|venue)|engagement ring|honeymoon (destination|resort)|recipe of the day|food review|restaurant review|michelin (star|guide)|tasting menu|wine (review|tasting|pairing)|cocktail (recipe|trend)|dating app|tinder|bumble|hinge|relationship advice|valentine'?s? day|raksha bandhan|holi|diwali (gift|sweet|rangoli|bonus)|pongal recipe|onam recipe|eid (recipe|fashion))\b/i;

  // PATCH 0046: Exchange / regulator FILING NOISE — BSE corp announcements
  // and SEBI press releases pump out hundreds of attachment-only PDFs
  // (PAN updates, settlement programmes, intermediary registrations,
  // KYC compliance circulars, complaint redressal stats, advisory
  // bulletins). These have no investment signal. Drop entirely.
  const FILING_NOISE_RE = /\b(settlement (programme|scheme|order document|notice attached)|intermediary registration|fee payment certificate|kyc (registration|extension|renewal|update circular)|inactive (account|client)|grievance redress(?:al)? (statistic|report)|complaint statistic|investor (charter|grievance|service)|standardised (procedure|format|norms)|disclosure (under|format|circular)|compliance (status|format|circular)|attachment (?:to|under|notice)|attached (?:document|herewith|circular|notice)|appendix [a-z]|annexure [a-z\d]|appendix \d|annexure \d|circular ref:?|circular no\.?|press release no\.?|reg\.?\s+\d+\/\d+\/\d+|\bisin\b.{0,15}(allot|change|merger)|corrigendum|errata|withdrawal of (notice|circular)|notice for (mutual fund|portfolio manager|stock broker|investment adviser|merchant banker|reit|invit) intermediar|adjudication order|interim order|consent order|appeal (filed|disposed|withdrawn)|sat order|securities appellate|board meeting outcome attached|outcome of board meeting|notice of (annual|extra ordinary|extra-ordinary) general meeting|agm notice|egm notice|postal ballot|e-?voting|book closure|record date for (dividend|bonus|split)|disclosure under (regulation|reg\.?) \d+|sebi (?:lodr|pit|sast|takeover) regulation|reg\. ?(?:30|29|31|7|13|24)|insider trading window|trading window (open|clos|notice)|press release (no|reference|number|dt\.?|dated))\b/i;

  // PATCH 0046: Sports auctions / IPL bid noise. SPORTS_RE missed
  // "BCCI auction list", "IPL franchise valuation", "team strategy
  // meeting" because they don't say "match" or "score".
  const SPORTS_BUSINESS_RE = /\b(ipl(?:\s+\d{4})?\s+(auction|franchise|valuation|sponsor|broadcast deal|media rights|sale|owner)|bcci(?:\s+\d{4})?\s+(auction|tender|broadcast|media rights|notice)|cricket\s+(broadcast|tournament|board meeting|franchise|league fee|auction)|wpl(?:\s+\d{4})?\s+(auction|franchise)|isl(?:\s+\d{4})?\s+(franchise|auction)|football\s+(auction|transfer|league fee)|hockey\s+(league|franchise)|tennis\s+(open|grand slam|wimbledon|french open|us open|australian open)|esports\s+(league|tournament|prize pool))\b/i;

  // Generic market wraps + premarket movers + day-of stock chatter
  // ("Sensex falls 500 points", "Stocks making biggest moves", "premarket")
  const MARKET_WRAP_RE = /\b(sensex (falls?|gains?|ends?|tanks?|drops?) \d|nifty \d{2}\s*ends?|nifty 50 ends? (below|above)|nifty bulls indecisive|stocks? making the biggest moves? (premarket|after.?hours)|premarket movers?|after.?hours? movers?|stocks? to (watch|buy|sell)|jim cramer (says|believes|thinks)|cramer says|cramer believes|cramer's (take|view)|tech stocks could offer|smaller (tech )?stocks are punching|insider trades?:?|notable names?|sa asks|ignore market noise|market wrap|day's losers?|day's gainers?|wall (st(reet)?) week ahead|pulse of the street|us stock market today|s&p 500.{0,20}futures? (advance|retreat)|nasdaq futures?|geopolitical tensions drag|nifty ends week|markets log modest|stock market today|opportunity to buy or wait|tanks 7% after q\d results today|share price tanks)\b/i;

  // Generic geopolitical filler — daily war / parade / ceasefire updates
  // WITHOUT specific company / sector / supply-chain consequence
  const GEOPOLITICAL_FILLER_RE = /\b(no closer to ending war|tehran'?s response|expects.{0,20}response|peace deal'? today'?|response on peace deal|holds scaled.?back|war over (ukraine|israel) deepen|consumer sentiment falls|jobs report tops|jobless claims|witnesses scaled|trump.{0,15}peace|rubio says)\b/i;

  // SEO content listicles
  const SEO_LISTICLE_RE = /\b(most overvalued (tech )?stocks?|nvidia has already committed|gpt.?\d.?\d may burn|here'?s what traders|here'?s what'?s ahead|no description|prestigious job|teflon market|just-ahead|jim cramer|next major deadline|how much further|how long can|how to recession.?proof)\b/i;

  // SECTOR-WIDE EARNINGS AGGREGATIONS — "8 out of 9 X stocks beat",
  // "Real estate stocks eke out gains", "Most healthcare companies".
  // These are auto-generated weekly summaries, no actionable per-ticker
  // signal. Drop entirely from feed.
  const SECTOR_AGGREGATION_RE = /\b(\d{1,2} out of \d{1,2}|\d{1,2} of \d{1,2})\s+\w*\s*(stocks?|companies)\s+(beat|miss|reported|deliver|outperform|underperform|wins?)|most (\w+ )?companies report|seven \w+ stocks beat|all \w+ stocks beat|eke out gains on earnings|stocks (rise|fall|gain|drop|edge|tank|rally|surge|sink) on earnings releases|earnings scorecard|earnings recap|sector\s*(round|wrap|recap)|\w+ Q[1-4] earnings call highlights\b/i;

  // ANALYST OPINION / "X says Y" pieces unless ticker-specific event
  // ("Bank of America says stocks like Apple have plenty of upside" —
  // generic talking head). Specific rating actions ("Citi downgrades
  // India to Underweight", "JPM cuts target") still pass via
  // RATING_CHANGE classifier path.
  const ANALYST_OPINION_RE = /\b(bank of america says|goldman says|morgan stanley says|jp ?morgan says|credit suisse says|barclays says|wells fargo says|deutsche bank says|expert says|experts? bet high|d-?street bull(?:s)?|long-term story intact|brokerage view|brokers? (suggest|believe|recommend)|jefferies says|nomura says|hsbc says|moneycontrol says|cnbc-tv18 says|et now says|here'?s why|sees plenty of upside|advances? to|wait for valuation reset|markets log)\b/i;

  // EVENT PREVIEWS — "Wall St Week Ahead", "What's coming next week",
  // "Q4 results today live updates"-style aggregators
  const PREVIEW_AGGREGATOR_RE = /\b(week ahead|coming this week|coming days?|outlook for the week|what to watch (this week|next week)|q[1-4] results today live|q[1-4] result today live|results today live updates|live updates|live blog|live coverage|recap and outlook)\b/i;

  // SPECULATIVE / OPINION pieces with low actionability
  const SPECULATIVE_RE = /\b(goodbye quarterly earnings|will the .{0,15}war|here'?s when|here'?s why|may be|might be|could be|may end up|might end up|here'?s how|reasons to (buy|sell|hold))\b/i;

  if (NOISE_RE.test(text) || PERSONAL_FINANCE_RE.test(text) || SPORTS_RE.test(text) || SPORTS_BUSINESS_RE.test(text) || REGIONAL_POLITICS_RE.test(text) || FLUFF_RE.test(text) || FILING_NOISE_RE.test(text) || MARKET_WRAP_RE.test(text) || GEOPOLITICAL_FILLER_RE.test(text) || SEO_LISTICLE_RE.test(text) || SECTOR_AGGREGATION_RE.test(text) || ANALYST_OPINION_RE.test(text) || PREVIEW_AGGREGATOR_RE.test(text) || SPECULATIVE_RE.test(text)) {
    // Return tier 4 — filter layer downstream drops these from main feed.
    return { article_type: 'GENERAL', investment_tier: 4 };
  }

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
  //
  // PATCH 0047: ALL bottleneck paths now require a TITLE anchor. If
  // the title itself doesn't carry a hardware/system/named-co token,
  // skip ALL bottleneck classification. This keeps "Putin Ukraine
  // conflict" out of BOTTLENECK even when the description mentions
  // "supply chain disruption" in passing.
  // ══════════════════════════════════════════════════════════════════
  if (!titleHasAnchor) {
    // Title has no structural anchor — never reach BOTTLENECK.
    // Fall through to MACRO / GEOPOLITICAL / RATING / CORPORATE / GENERAL.
  } else {
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

  // Rule 3a: India structural domains — HARD
  // ─────────────────────────────────────────────────────────────────
  // PATCH 0046: Tightened from "always BOTTLENECK on regex match" to
  // "BOTTLENECK only when paired with a real signal". The previous
  // version was matching on tokens like "order", "approval",
  // "settlement" — which appear in BSE corporate filings, SEBI press
  // attachments, NSE delisting circulars, Bloomberg lifestyle blurbs,
  // movie premiere advertising approvals, etc.
  //
  // New requirement: HARD-pattern article must ALSO carry one of:
  //   (a) a real physical-constraint signal (PHYSICAL_CONSTRAINT /
  //       IMPLICIT_CONSTRAINT)
  //   (b) a structural breakthrough signal (BREAKTHROUGH)
  //   (c) a named structural-Indian-company anchor (HAL / BEL / BDL /
  //       BHEL / NPCIL / L&T / Bharat Dynamics / Mazagon / Cochin
  //       Shipyard / GRSE / Tata Advanced / Adani Defence / Paras /
  //       BHEL / Coal India / Power Grid / NTPC / Reliance Refinery /
  //       Vedanta Lithium / Tata Semiconductor / Kaynes / Syrma / Dixon)
  //   (d) a quantified financial commitment (₹X cr / $X bn / N MW /
  //       N GW / X tonnes / lakh tonnes — proves it's a real capital
  //       allocation, not a routine filing)
  //
  // Articles that match HARD but carry NONE of (a)-(d) drop to tier 3
  // GENERAL — they may still surface elsewhere if scoring rescues them,
  // but they cannot reach the BOTTLENECK feed.
  if (INDIA_STRUCTURAL_HARD.test(text)) {
    const NAMED_STRUCTURAL_CO = /\b(hal|bel|bdl|bhel|npcil|bhavini|brahmos aerospace|l&t|larsen ?\&? ?toubro|mazagon dock|cochin shipyard|grse|garden reach|bharat dynamics|bharat electronics|bharat earth movers|beml|tata advanced|adani defence|paras defence|astra microwave|data patterns|midhani|mishra dhatu|coal india|power grid corp|ntpc|nhpc|sjvn|reliance refinery|reliance industries refinery|ioc refinery|bpcl refinery|hpcl refinery|vedanta lithium|tata electronics|tata semiconductor|kaynes technology|syrma sgs|dixon technologies|isgec|polymatech|amkor india|micron gujarat|drdo|isro|antrix|new space india)\b/i;
    const QUANTIFIED_COMMITMENT =
      /(?:rs\.?|inr|₹)\s*\d[\d,]*\s*(?:cr|crore|lakh\s*crore)/i.test(text) ||
      /\$\s*\d[\d.]*\s*(?:billion|bn|million|mn)\b/i.test(text) ||
      /\b\d[\d,]*\s*(?:mw|gw|kva|kv|tonne|tonnes|lakh tonnes|million tonnes|mtpa|kwh|gwh)\b/i.test(text);
    const hasRealSignal =
      PHYSICAL_CONSTRAINT.test(text) ||
      IMPLICIT_CONSTRAINT.test(text) ||
      BREAKTHROUGH.test(text) ||
      NAMED_STRUCTURAL_CO.test(text) ||
      QUANTIFIED_COMMITMENT; // already a boolean from the .test() chain above
    if (!hasRealSignal) {
      // HARD pattern matched but no real signal — drop to GENERAL tier 3.
      return { article_type: 'GENERAL', investment_tier: 3 };
    }
    // Even with a real signal, demote pure missile tests if no named co.
    const isMissileTestNoise =
      MISSILE_TEST_NOISE_RE.test(text) && !NAMED_STRUCTURAL_CO.test(text);
    if (isMissileTestNoise) {
      return { article_type: 'GENERAL', investment_tier: 3 };
    }
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
  } // end of titleHasAnchor block (PATCH 0047)

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

// ── Market Consequence Engine ────────────────────────────────────────
//
// A real institutional terminal scores each surviving article on its
// consequence weight, not just its surface keywords. Five dimensions
// (per the user spec):
//   - Earnings impact     25%
//   - Supply-chain        20%
//   - Cross-sector        20%
//   - Regime shift        15%
//   - Persistence         10%
//   - Surprise / novelty  10%
//
// Score 0-100. Articles below 30 get demoted to tier 3 even if they
// passed the type classifier — keeps generic chatter out of the
// HIGH-SIGNAL surface.
function computeConsequenceScore(title: string, desc: string, article_type: string): number {
  const text = (title + ' ' + desc).toLowerCase();
  let score = 0;

  // (a) Earnings impact (25): explicit miss / beat / guidance / margin
  // delta language with a specific number nearby. Generic "results were
  // released" doesn't score.
  const epsImpact = /\b(eps|profit|revenue|ebitda|margin)\s+(beat|miss|tops?|exceeds?|fell short|came in (above|below))/i.test(text)
    || /\b(\d{1,3}(?:\.\d+)?\s*%)\s+(beat|miss|surprise|growth|decline|drop|jump)/i.test(text)
    || /\bguidance\s+(raised?|lowered?|maintained?|reaffirmed?|withdrawn?)/i.test(text);
  if (epsImpact) score += 25;
  else if (/\b(profit|revenue|earnings|q[1-4])\s+(rises?|falls?|jumps?|declines?|grew|grows?|down|up)\b/i.test(text)) score += 12;

  // (b) Supply-chain consequence (20): explicit shortage / capacity / lead time
  const supplyImpact = /\b(shortage|sold out|capacity (hit|reached|sold)|lead time|allocation|backlog of \d|out of stock|production halt)\b/i.test(text);
  if (supplyImpact) score += 20;
  else if (/\b(capacity|supply|allocation|tight|constrained?)\b/i.test(text)) score += 8;

  // (c) Cross-sector propagation (20): article names ≥2 sectors OR
  // explicitly states ripple effect ("affects A and B", "impacts X
  // ecosystem", "puts pressure on")
  const sectorWords = (text.match(/\b(semiconductor|memory|hbm|data center|grid|power|nuclear|pharma|banking|nbfc|auto|cement|fmcg|it services|defence|infrastructure|fertilizer|metals|crude|oil|chemicals)\b/g) || []);
  const uniqueSectors = new Set(sectorWords);
  if (uniqueSectors.size >= 3) score += 20;
  else if (uniqueSectors.size >= 2) score += 12;
  else if (/\b(ripple|cascading|spillover|cross.?sector|chain reaction|knock.?on)\b/i.test(text)) score += 12;

  // (d) Regime implication (15): macro regime / liquidity / rate / FX
  const regimeShift = /\b(rate (cut|hike) (expected|approaching|signal|decision)|fed.{0,15}(pivot|cycle|regime|signal)|monetary (policy|stance|tightening|easing|pause)|liquidity (regime|drain|injection|surplus|deficit)|risk.?off|risk.?on|equity (multiple|rerat|derat)|duration (compression|repricing)|yield curve)\b/i.test(text);
  if (regimeShift) score += 15;

  // (e) Persistence duration (10): structural language ("multi-year",
  // "long-cycle", "structural", "secular trend", "decade-long")
  const persistent = /\b(multi.?year|long.?cycle|structural|secular|decade.?long|five.?year|10.?year|long.?term|multi.?decade|generational)\b/i.test(text);
  if (persistent) score += 10;

  // (f) Surprise / novelty (10): explicit unexpected / first-time /
  // record-breaking / unprecedented language
  const novel = /\b(unprecedented|never before|first time|record (high|low|breaking)|exceeds expectations|surprises|caught off guard|catches.{0,15}flat.?footed|wakes.{0,15}up|emerges)\b/i.test(text);
  if (novel) score += 10;

  // Article type bonus — BOTTLENECK and EARNINGS get a small floor since
  // the classifier already vetted them as institutionally relevant.
  if (article_type === 'BOTTLENECK') score = Math.max(score, 35);
  if (article_type === 'EARNINGS') score = Math.max(score, 25);

  return Math.min(100, score);
}

// ── PHASE 1.5: Specific Impact Extraction ─────────────────────────────
// Replaces generic "Earnings — vs consensus" with extracted figure.
// E.g. "Toyota fourth-quarter profit misses by wide margin as U.S.
// tariffs drive 49% slump" → "Toyota: profit miss · −49% on tariffs".
//
// Returns { ticker?, direction?, magnitude?, label? } when extractable.
function extractSpecificImpact(title: string, desc: string): {
  ticker?: string;
  direction?: 'beat' | 'miss' | 'rise' | 'fall' | 'flat';
  magnitudePct?: number;
  label?: string;
} {
  const text = title + ' ' + desc;

  // Pattern 1: "<NAME> beat/miss/exceeds by X%"
  const beatMissMatch = text.match(/\b([A-Z][A-Za-z0-9& .]{1,30}?)\s+(?:Q[1-4]|first|second|third|fourth|quarterly|q[1-4])\s+(?:results?|profit|revenue|earnings|eps)?\s*(?:rises?|jumps?|grew|grows|gains?|surges?|falls?|drops?|declines?|misses?|beats?|tops?|exceeds?)\s+(?:expectations?\s+)?(?:by\s+)?(\d{1,3}(?:\.\d+)?)\s*%/i);
  if (beatMissMatch) {
    const verb = beatMissMatch[0].match(/(rises?|jumps?|grew|grows|gains?|surges?|falls?|drops?|declines?|misses?|beats?|tops?|exceeds?)/i)?.[0].toLowerCase() || '';
    const direction: 'beat' | 'miss' | 'rise' | 'fall' = /miss/.test(verb) ? 'miss' : /beat|tops|exceed/.test(verb) ? 'beat' : /falls?|drops?|declines?/.test(verb) ? 'fall' : 'rise';
    const mag = parseFloat(beatMissMatch[2]);
    return { ticker: beatMissMatch[1].trim(), direction, magnitudePct: mag, label: `${beatMissMatch[1].trim()}: ${direction} ${mag.toFixed(1)}%` };
  }

  // Pattern 2: "stock soars/sinks/jumps X%" — price-action articles
  const priceMatch = text.match(/\bstock\s+(soars?|sinks?|tanks?|jumps?|surges?|plunges?|tumbles?|crashes?|drops?|falls?|gains?|rises?)\s+(\d{1,3}(?:\.\d+)?)\s*%/i);
  if (priceMatch) {
    const verb = priceMatch[1].toLowerCase();
    const dir: 'rise' | 'fall' = /soars?|jumps?|surges?|gains?|rises?/.test(verb) ? 'rise' : 'fall';
    const mag = parseFloat(priceMatch[2]);
    return { direction: dir, magnitudePct: mag, label: `Price action: ${dir === 'rise' ? '+' : '−'}${mag.toFixed(1)}%` };
  }

  // Pattern 3: "profit up/down X% YoY" or "revenue rises X%"
  const profitMatch = text.match(/\b(profit|revenue|net (?:profit|income)|eps|ebitda|sales)\s+(?:up|down|rises?|falls?|grew|grows|jumps?|drops?)\s+(\d{1,3}(?:\.\d+)?)\s*%/i);
  if (profitMatch) {
    const isDown = /down|falls?|drops?/i.test(profitMatch[0]);
    const mag = parseFloat(profitMatch[2]);
    return {
      direction: isDown ? 'fall' : 'rise',
      magnitudePct: mag,
      label: `${profitMatch[1].toUpperCase()} ${isDown ? '−' : '+'}${mag.toFixed(1)}% YoY`,
    };
  }

  // Pattern 4: "guidance raised/cut/maintained"
  const guidanceMatch = text.match(/\bguidance\s+(raised?|cut|lowered?|maintained?|reaffirmed?|withdrawn?)/i);
  if (guidanceMatch) {
    const action = guidanceMatch[1].toLowerCase();
    const dir: 'rise' | 'fall' | 'flat' = /raise/i.test(action) ? 'rise' : /cut|lower|withdraw/i.test(action) ? 'fall' : 'flat';
    return { direction: dir, label: `Guidance ${action}` };
  }

  return {};
}

// ── PHASE 2.7: Beneficiary / At-Risk Exposure Mapping ────────────────
// When an article hits a structural theme, map to who benefits and who
// is at risk. Bloomberg-style: "CoWoS shortage" → [+ TSMC ASE AMKR]
// [- NVDA AVGO build risk]. Returns up to 3 of each.
const EXPOSURE_MAP: Array<{
  theme: RegExp;
  beneficiaries: string[];
  atRisk: string[];
}> = [
  // CoWoS / advanced packaging
  {
    theme: /\b(cowos|advanced packaging|chiplet|interposer|hybrid bonding|amkor|ase group)\b.{0,30}\b(shortage|tight|capacity|allocation|sold out|backlog)\b/i,
    beneficiaries: ['TSM', 'ASE', 'AMKR', 'AMAT'],
    atRisk: ['NVDA', 'AVGO', 'AMD'],
  },
  // HBM / DRAM tightness
  {
    theme: /\b(hbm|dram|sk hynix|micron|samsung memory)\b.{0,30}\b(tight|shortage|allocation|sold out|capacity hit zero|undersupply)\b/i,
    beneficiaries: ['MU', '000660.KS', 'NVDA'],
    atRisk: ['DELL', 'HPE', 'GOOGL'],
  },
  // Power grid / data-center power
  {
    theme: /\b(power grid|grid (capacity|stress|upgrade)|data center power|electricity (constraint|shortage))\b/i,
    beneficiaries: ['GEV', 'ETN', 'PWR', 'BHEL', 'TRENT'],
    atRisk: ['MSFT', 'GOOGL', 'AMZN'],
  },
  // EUV / lithography
  {
    theme: /\b(euv|asml|lithograph|wafer fab capacity)\b.{0,30}\b(tight|shortage|capacity|order)\b/i,
    beneficiaries: ['ASML', 'TSM'],
    atRisk: ['INTC'],
  },
  // Optical / photonics
  {
    theme: /\b(silicon photonics|co-packaged optics|optical interconnect|cpo)\b.{0,30}\b(adoption|deployment|breakthrough|traction|bandwidth limit)\b/i,
    beneficiaries: ['COHR', 'LITE', 'AAOI', 'MRVL'],
    atRisk: [],
  },
  // Tariffs / trade war
  {
    theme: /\b(tariff|trade war).{0,40}(steel|aluminium|aluminum|auto|electronics|pharma|chemicals)/i,
    beneficiaries: [],
    atRisk: ['TM', 'F', 'GM', 'BABA'],
  },
  // RBI rate cycle / banking
  {
    theme: /\brbi.{0,30}(repo (rate cut|cut)|monetary easing|liquidity injection)/i,
    beneficiaries: ['HDFCBANK', 'AXISBANK', 'BAJFINANCE', 'BAJAJFINSV'],
    atRisk: [],
  },
  // India infra capex
  {
    theme: /\b(india|domestic).{0,30}(highway|railway|infrastructure capex|nhai|rail vikas)/i,
    beneficiaries: ['LT', 'KEC', 'IRB', 'GMRINFRA'],
    atRisk: [],
  },
  // Crude oil spike
  {
    theme: /\b(crude oil|brent|wti).{0,30}(spike|surge|jump|rally|hike|above \$\d{2,3})/i,
    beneficiaries: ['XOM', 'CVX', 'ONGC', 'OIL', 'GAIL'],
    atRisk: ['IHCL', 'INDIGO', 'ASIANPAINT', 'MARUTI', 'BPCL', 'IOC', 'HPCL'],
  },
];

function mapExposure(title: string, desc: string, _region: string): {
  beneficiaries: string[];
  atRisk: string[];
} {
  const text = title + ' ' + desc;
  for (const { theme, beneficiaries, atRisk } of EXPOSURE_MAP) {
    if (theme.test(text)) {
      return { beneficiaries: beneficiaries.slice(0, 4), atRisk: atRisk.slice(0, 4) };
    }
  }
  return { beneficiaries: [], atRisk: [] };
}

// ── PHASE 2.8: Sentiment Magnitude (1-10) ────────────────────────────
// Replaces HIGH/MED/LOW with a continuous magnitude × direction tuple.
// Lets the UI render +6 / -3 instead of identical "MEDIUM" tags.
function computeSentimentMagnitude(title: string, desc: string): {
  direction: 'positive' | 'negative' | 'neutral';
  magnitude: number; // 1-10
} {
  const text = (title + ' ' + desc).toLowerCase();

  // Strong-positive phrases (intensity 8-10)
  const strongPos = /\b(record (high|profit|revenue|earnings|breakthrough)|all.?time high|blockbuster|stellar|outstanding|exceeds expectations significantly|crushed|smashed|surge[ds]?\s+(\d{2,3})|jumped\s+(\d{2,3})|soared|skyrocket)\b/i;
  // Mild-positive (intensity 4-6)
  const mildPos = /\b(beat|exceed|outperform|raised guidance|raises target|upgrade|positive|strong|growth|rise|gain|up\s+\d|increase)\b/i;
  // Strong-negative (intensity 8-10)
  const strongNeg = /\b(disaster|crash|tank(ed|s)|plunge|collapse|crisis|bankrupt|severe miss|massive miss|wide margin|cut\s+(\d{2,3})\s*%|loss(es)? widen(ed)?|all.?time low)\b/i;
  // Mild-negative (intensity 4-6)
  const mildNeg = /\b(miss(es|ed)?|fell|fall(s)?|drop(s|ped)?|decline|cut|lowered|reduce[ds]?|underperform|downgrade|negative|weak|loss|underweight)\b/i;

  if (strongPos.test(text)) {
    const m = text.match(/(\d{2,3})\s*%/);
    const mag = m ? Math.min(10, Math.floor(parseInt(m[1], 10) / 10) + 6) : 8;
    return { direction: 'positive', magnitude: mag };
  }
  if (strongNeg.test(text)) {
    const m = text.match(/(\d{2,3})\s*%/);
    const mag = m ? Math.min(10, Math.floor(parseInt(m[1], 10) / 10) + 6) : 8;
    return { direction: 'negative', magnitude: mag };
  }
  if (mildPos.test(text)) {
    const m = text.match(/(\d{1,2})\s*%/);
    const mag = m ? Math.min(7, Math.floor(parseInt(m[1], 10) / 5) + 3) : 5;
    return { direction: 'positive', magnitude: mag };
  }
  if (mildNeg.test(text)) {
    const m = text.match(/(\d{1,2})\s*%/);
    const mag = m ? Math.min(7, Math.floor(parseInt(m[1], 10) / 5) + 3) : 5;
    return { direction: 'negative', magnitude: mag };
  }
  return { direction: 'neutral', magnitude: 0 };
}

// ── Region detection ─────────────────────────────────────────────────
function detectRegion(title: string, desc: string, feedRegion: string): string {
  if (feedRegion === 'US') return 'US';
  const text = (title + ' ' + desc).toLowerCase();
  if (/\b(nifty|sensex|bse|nse|rbi|india|rupee|inr|sebi)\b/.test(text)) return 'IN';
  if (/\b(nasdaq|s&p|dow|fed|wall street|nyse|usd|us market)\b/.test(text)) return 'US';
  return feedRegion || 'IN';
}

// ── Impact Statement Generation — region-aware ──────────────────────
//
// PROBLEM the user flagged: India domestic news (SBI Q4 profit, ESOP rules,
// Britannia plant relocation, Citi India downgrade) was getting global
// supply-chain bottleneck labels because broad regexes match common
// English words ("auto" matches "automated", "packaging" matches food
// packaging, "defence" matches India defence-sector commentary, etc.).
//
// FIX: India-region articles get India-specific patterns FIRST. Only when
// no India-specific bucket fits do we fall through to the global supply-
// chain labels. The global list is also tightened so generic words don't
// overmatch.
// PATCH 0046: sub-tag-aware fallback so structural articles never land
// on the generic "Physical system constraint" message. Each sub-tag
// gets a domain-specific impact line instead.
const SUBTAG_IMPACT_LABELS: Record<string, string> = {
  MEMORY_STORAGE: 'Memory supply cycle — HBM / DRAM / NAND tightness',
  INTERCONNECT_PHOTONICS: 'Optical interconnect — bandwidth bottleneck',
  FABRICATION_PACKAGING: 'Advanced packaging / wafer capacity constraint',
  COMPUTE_SCALING: 'Compute scaling — accelerator / data-center capacity',
  POWER_GRID: 'Power / grid capacity constraint',
  NUCLEAR_ENERGY: 'Nuclear / atomic energy structural milestone',
  THERMAL_COOLING: 'Thermal / cooling design constraint',
  MATERIALS_SUPPLY: 'Critical mineral supply constraint',
  QUANTUM_CRYOGENICS: 'Quantum / cryogenic infrastructure milestone',
  GENERAL_CONSTRAINT: 'Structural supply-chain signal',
};

function generateImpact(
  title: string,
  desc: string,
  article_type: string,
  region: string = 'IN',
  bottleneckSubTag?: string | null,
): string {
  const text = (title + ' ' + desc).toLowerCase();

  // ── India-specific labels (run FIRST when region === 'IN') ────────
  // Captures the news categories Indian institutional investors actually
  // care about: RBI policy, earnings season, FII/DII flow, sectoral
  // cycle markers, regulatory actions, capital-market activity, etc.
  const indiaPatterns: [RegExp, string][] = [
    // EARNINGS first — most India news this season is Q4 results.
    [/\b(q[1-4]|fy\s?2[0-9])\s+(result|profit|revenue|earnings|net (profit|income))/i, 'Q4 earnings season — quarterly delta'],
    [/\bnet profit (rises?|falls?|jumps?|declines?|down|up|grew|grows?)\b/i, 'Quarterly earnings delta'],

    // RBI / monetary policy — distinct from "rate" overmatches.
    [/\brbi\s+(policy|repo|rate (cut|hike|decision)|mpc|monetary|deputy governor|reshuffle)/i, 'RBI policy / monetary stance'],
    [/\b(mpc|monetary policy committee|repo rate|reverse repo|crr|slr|liquidity adjustment)\b/i, 'RBI monetary policy signal'],
    [/\becl framework|expected credit loss\b/i, 'RBI ECL framework — banking provisioning impact'],

    // FII / DII flows — daily/weekly flow signal Indian analysts watch.
    [/\b(fii|fpi|dii|foreign portfolio investor|domestic institutional|outflow|inflow)\s+(buy|sell|outflow|inflow|net (buy|sell|sold|bought)|stake|holding)/i, 'FII / DII flow signal'],

    // Sector cycle markers — broad enough to catch Indian sectoral news
    // but specific enough not to match generic supply-chain global news.
    [/\b(auto sales|monthly (auto|two[- ]wheeler|passenger vehicle))\b/i, 'Auto monthly sales — volume cycle'],
    [/\b(gst collection|gst revenue|gst mop[- ]?up|gst kitty)/i, 'GST collection — consumption proxy'],
    [/\b(manufacturing pmi|services pmi|composite pmi|core sector)\b/i, 'PMI / core sector — industrial activity'],
    [/\b(monsoon (forecast|deficit|progress|rainfall)|imd|rainfall (deficit|surplus))/i, 'Monsoon — rural / agri demand driver'],

    // Capital-market events — IPO, FPO, OFS, block, bulk deals
    [/\b(ipo|fpo|qip|ofs|rights issue|bonus issue|stock split)\s+(launch|open|close|subscri|alloca|listing|price band|approval)/i, 'Primary market activity / capital raise'],
    [/\b(block deal|bulk deal|stake (sale|purchase|acquisition)|promoter (sale|exit|stake change))/i, 'Block / bulk deal — institutional flow'],
    [/\b(promoter pledge|pledge increase|pledge release|insider (trade|trading|buy|sell))\b/i, 'Promoter / insider activity'],

    // Regulatory / SEBI / corporate action
    [/\b(sebi (order|penalty|action|approval|circular|consultation))\b/i, 'SEBI regulatory action'],
    [/\b(esop|stock option|grant of (option|shares)|share buyback|buy[- ]?back)\b/i, 'Corporate action — capital allocation'],
    [/\b(dividend (declaration|payout|record date)|interim dividend|final dividend)\b/i, 'Dividend announcement'],
    [/\b(merger|demerger|hive[- ]?off|amalgamation|scheme of arrangement|delisting)\b/i, 'Corporate restructuring'],

    // Brokerage / rating actions
    [/\b(brokerage (upgrade|downgrade|target|rating)|target price (raised?|cut|maintained|reduced)|moody|fitch|s&p|crisil|icra)\s+(downgrade|upgrade|outlook|review|rating)/i, 'Rating / target action'],
    [/\b(citi|jp morgan|morgan stanley|goldman|nomura|jefferies|kotak|elara|jm financial|emkay)\s+(downgrade|upgrade|target|cuts?|raises?|maintains?|sees?|recommends?)/i, 'Sell-side rating / target action'],

    // India structural bottleneck domains (genuine constraints)
    [/\b(power deficit|electricity shortage|load shedding|grid (frequency|stability))/i, 'Power / grid capacity constraint'],
    [/\b(coal (shortage|stockpile|stock|imports?|allocation)|coal india)/i, 'Coal supply — power feedstock'],
    [/\b(highway contract|nhai (award|tender|contract)|road construction)/i, 'India infrastructure — roads / highways'],
    [/\b(railway (freight|capex|tender|order)|vande bharat|rail vikas)/i, 'India infrastructure — railways'],
    [/\b(rare earth|lithium|cobalt|critical mineral|kabil|amrita)\b/i, 'Critical mineral — strategic supply'],
    [/\b(crude (price|cost)|brent|wti).{0,20}(india|domestic|fuel)/i, 'Crude price → India fuel inflation'],
    [/\b(rupee|inr|dollar.{0,10}(rate|level)|usd[- ]?inr|forex)\s+(weaken|deprec|fall|rise|strength|crore)/i, 'Rupee / forex pressure'],
    [/\b(banking|credit growth|loan book|gnpa|nnpa|slippage|provision coverage)/i, 'Banking / credit cycle'],
    [/\b(npa|stressed asset|asset quality|sma[- ]?[12]|provision)/i, 'Banking asset quality'],
    [/\b(nbfc|housing finance|microfinance|small finance bank|cost of funds)/i, 'NBFC / shadow banking'],

    // Pharma / IT / Auto / FMCG — sector-specific (only when sector-tag matches)
    [/\b(usfda (warning|observation|inspection|483)|ema warning|fda 483)/i, 'Pharma — FDA observation / warning'],
    [/\b(it services|attrition|deal tcv|constant currency|cc growth|wage hike)/i, 'IT services — deal flow / margin'],
    [/\b(rural (demand|consumption|sales|recovery))/i, 'Rural demand cycle'],

    // Geopolitical with India angle
    [/\b(india.{0,30}(china|pakistan|sri lanka|bangladesh)|loc|line of (control|actual control)|standoff|border tension)/i, 'India geopolitical / border'],
  ];

  if (region === 'IN') {
    for (const [pattern, statement] of indiaPatterns) {
      if (pattern.test(text)) return statement;
    }
  }

  // ── Global supply-chain labels (US / global news, or India fallback) ─
  // Tightened: "auto" must be preceded by space/start to avoid matching
  // "automated"; "memory" requires a memory-context cohort word.
  const globalPatterns: [RegExp, string][] = [
    [/\b(packaging|chiplet|interposer|cowos|hybrid bonding)\b.{0,40}\b(capacity|constraint|shortage|tight|allocation|bottleneck)\b/, 'Advanced packaging capacity constraint — direct compute bottleneck'],
    [/\b(semiconductor|wafer|fab|tsmc|asml|foundry)\b.{0,40}\b(capacity|constraint|shortage|tight|allocation|delay)\b/, 'Chip production capacity constraint'],
    [/\bhbm3e?\b.{0,30}\b(constraint|tight|shortage|allocation)\b/, 'HBM supply constraint — highest margin memory segment'],
    [/\b(sk hynix|micron|samsung)\b.{0,30}\b(hbm|dram|capacity|supply)\b/, 'Memory company supply signal — watch capacity/allocation'],
    [/\b(hbm|dram)\b.{0,30}\b(shortage|tight|constraint|allocation)\b/, 'Memory supply cycle — capacity/allocation constraint'],
    [/\b(ddr5|nand)\b.{0,30}\b(tight|shortage|allocation)\b/, 'Memory supply cycle — DDR5/NAND capacity constraint'],
    [/\b(silicon photonics|co-packaged optics|cpo)\b/, 'Silicon photonics — next-gen interconnect bottleneck'],
    [/\b(power grid|electricity grid|transmission|transformer)\b.{0,40}\b(capacity|constraint|shortage|stress)\b/, 'Power/grid capacity constraint'],
    [/\bdata center.{0,30}(power|capacity|constraint|build)/, 'Compute infrastructure demand-supply gap'],
    [/\b(thermal|cooling)\b.{0,30}\b(capacity|constraint|design)\b/, 'Thermal/cooling capacity constraint'],
    [/\b(shipping|port|freight|supply chain)\b.{0,30}\b(disruption|constraint|delay|congestion)\b/, 'Logistics/supply chain disruption'],
    [/\b(rare earth|lithium|cobalt)\b.{0,30}\b(supply|constraint|export|allocation)\b/, 'Critical mineral supply constraint'],
    [/\b(tariff|trade war|sanction|embargo)\b/, 'Trade policy impacting supply flows'],
    [/\b(opec|crude oil|brent|wti)\b.{0,30}\b(price|supply|cut|production)\b/, 'Energy supply dynamics'],
    [/\b(geopolit|taiwan strait|russia.{0,15}ukraine|iran.{0,15}war|missile strike)\b/, 'Geopolitical supply chain risk'],
  ];

  for (const [pattern, statement] of globalPatterns) {
    if (pattern.test(text)) return statement;
  }

  // Fallback by article_type when no specific pattern matches.
  if (article_type === 'BOTTLENECK') {
    // PATCH 0046: prefer sub-tag-specific label over the generic line.
    if (bottleneckSubTag && SUBTAG_IMPACT_LABELS[bottleneckSubTag]) {
      return SUBTAG_IMPACT_LABELS[bottleneckSubTag];
    }
    return 'Structural supply-chain signal';
  }
  if (article_type === 'EARNINGS') return region === 'IN' ? 'Quarterly earnings — track delta vs estimate' : 'Earnings — vs consensus';
  if (article_type === 'MACRO') return region === 'IN' ? 'India macro signal' : 'US macro signal';
  if (article_type === 'GEOPOLITICAL') return 'Geopolitical risk';
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

          let { article_type, investment_tier, bottleneck_sub_tag, bottleneck_level } = classifyArticle(title, desc);
          const tickers = extractTickers(title);
          const region = detectRegion(title, desc, feed.region);

          // ── PHASE 1.1: Source-tier denylist for BOTTLENECK escalation ──
          // Retail / hobby / consumer-deal sources cannot trigger HIGH
          // tier bottleneck even if they mention the right keywords.
          // Demote to GENERAL/tier-3 unless a primary signal (named
          // company + named institution) is present.
          const isRetailFeed = feed.tier === 'retail';
          const hasInstitutionalAnchor = /\b(tsmc|asml|sk hynix|micron|samsung|nvidia|amd|intel|broadcom|qualcomm|applied materials|lam research|earnings call|capacity (announced|expansion)|capex (announced|raised)|guidance (raised?|cut|maintained))\b/i.test(title + ' ' + desc);
          if (article_type === 'BOTTLENECK' && isRetailFeed && !hasInstitutionalAnchor) {
            article_type = 'GENERAL';
            investment_tier = 3;
            bottleneck_sub_tag = undefined;
            bottleneck_level = undefined;
          }

          // ── PHASE 1.2: Domain content denylist ──
          // Articles whose title/desc match deal-page / consumer-tech
          // patterns cannot reach BOTTLENECK regardless of feed tier.
          if (BOTTLENECK_DOMAIN_DENYLIST.test(title + ' ' + desc) && article_type === 'BOTTLENECK') {
            article_type = 'GENERAL';
            investment_tier = 3;
            bottleneck_sub_tag = undefined;
            bottleneck_level = undefined;
          }

          // ── PATCH 0050: Weighted token scoring (replaces regex anchor) ──
          // Score the title+desc against domain token dictionaries. Tokens
          // in the title count 2x; tokens in summary count 1x. Articles
          // need score ≥ BOTTLENECK_ANCHOR_THRESHOLD to be eligible for
          // BOTTLENECK. Companion-required tokens (e.g. "memory" alone)
          // only fire if a constraint companion appears.
          const anchor = scoreAnchor(title, desc);
          const hasAnchor = anchor.total >= BOTTLENECK_ANCHOR_THRESHOLD;

          // ── PATCH 0051: Semantic graph score (10-year architecture) ──
          // The graph maps tokens to permanent SystemNode primitives.
          // Adding new themes is a data update, not a code change.
          const graph = scoreGraph(title, desc);

          // ── PATCH 0050+0051: Source tier (replaces denylist) ──
          // PATCH 0051 introduces tier-based classification of every source.
          // The legacy credibility map is still consulted as a fallback.
          const tierMeta = getTierContribution(feed.name);
          const cred = getSourceCredibility(feed.name);

          // BOTTLENECK demotion: only if no anchor OR (anchor required and
          // missing). Replaces the regex-based safety net + denylist.
          if (article_type === 'BOTTLENECK' && !hasAnchor) {
            article_type = 'GENERAL';
            investment_tier = 3;
            bottleneck_sub_tag = undefined;
            bottleneck_level = undefined;
          }
          if (article_type === 'BOTTLENECK' && cred.bottleneck_anchor_required && anchor.title_score < 12) {
            // Needs at least one strong title token
            article_type = 'GENERAL';
            investment_tier = 3;
            bottleneck_sub_tag = undefined;
            bottleneck_level = undefined;
          }

          // ── PHASE 1.3: Editorial commentary segregation ──
          // Articles from the editorial tier go to a separate
          // 'COMMENTARY' bucket so they don't pollute the news feed.
          if (feed.tier === 'editorial') {
            article_type = 'COMMENTARY';
            // Commentary always gets at least tier 2 — it's curated.
            investment_tier = Math.min(investment_tier, 2);
          }

          // Generate a unique ID from the full link+title — NOT just 20 chars
          // of base64 (which only encodes the domain prefix and collides).
          const idSource = link || title;
          let hash = 0;
          for (let ci = 0; ci < idSource.length; ci++) {
            hash = ((hash << 5) - hash + idSource.charCodeAt(ci)) | 0;
          }
          const uniqueId = `rss-${Math.abs(hash).toString(36)}-${Buffer.from(idSource).toString('base64').slice(-12)}`;

          // Drop noise/sports/regional-politics/fluff at ingestion time.
          if (investment_tier >= 4) continue;

          // ── PHASE 1.4: Stale-article filter (>90 days) ──
          // Only STRUCTURAL or BOTTLENECK articles can persist beyond
          // 90 days; everything else decays. Stops the "Barclays 1
          // year ago" persistence problem.
          const pubMs = pubDate ? new Date(pubDate).getTime() : Date.now();
          const ageDays = (Date.now() - pubMs) / 86400000;
          const isPersistent = article_type === 'BOTTLENECK' || article_type === 'COMMENTARY';
          if (ageDays > 90 && !isPersistent) continue;
          if (ageDays > 365) continue; // hard cap, even structural

          // Consequence score — institutional weight on five dimensions.
          const rawConsequence = computeConsequenceScore(title, desc, article_type);
          // PATCH 0050: apply source credibility factor (legacy).
          // PATCH 0051: combine with tier multiplier for richer weighting.
          //   PRIMARY ×1.15, SPECIALIST ×1.10, GENERALIST ×0.95,
          //   EDITORIAL ×0.55, PRESS_RELEASE ×0.40, SOCIAL ×0.30.
          const tierMultiplier = tierMeta.multiplier;
          const credMultiplier = cred.factor;
          const combinedMultiplier = Math.min(1.20, (tierMultiplier + credMultiplier) / 2);
          const consequence = Math.max(0, Math.round(rawConsequence * combinedMultiplier - tierMeta.noise_penalty));
          let effectiveTier = investment_tier;
          if (consequence < 30 && investment_tier <= 2) {
            effectiveTier = Math.min(3, investment_tier + 1);
          }
          if (consequence < 15) continue;

          // ── PHASE 1.5: Specific impact extraction ──
          // Replace generic "Earnings — vs consensus" with extracted
          // figure. Looks for "<TICKER> beat by 5%", "rises 35%", etc.
          const specificImpact = extractSpecificImpact(title, desc);

          // ── PHASE 2.7: Beneficiary / loser auto-mapping ──
          const exposure = mapExposure(title, desc, region);

          // ── PHASE 2.8: Sentiment magnitude (1-10 scale) ──
          const sentiment = computeSentimentMagnitude(title, desc);

          // ── PATCH 0049: Institutional envelope ──
          // Adds: signal importance rank, half-life, taxonomy, transmission
          // chain (with second-order effects + causal path), expectation
          // state (priced-in / surprise / saturation), structural confidence
          // (for BOTTLENECK), macro regime decomposition (for MACRO).
          const envelope = buildInstitutionalEnvelope({
            article_type,
            bottleneck_sub_tag: bottleneck_sub_tag || null,
            bottleneck_level: bottleneck_level || null,
            consequence_score: consequence,
            specific_impact: specificImpact,
            exposure_beneficiaries: exposure.beneficiaries,
            exposure_at_risk: exposure.atRisk,
            tickers,
            source_tier: feed.tier,
            feed_name: feed.name,
            title,
            desc,
          });

          // ── PATCH 0050: Bottleneck category + resolution state ──
          const bottleneck_category = article_type === 'BOTTLENECK'
            ? inferBottleneckCategory({ bottleneck_sub_tag: bottleneck_sub_tag || null, anchor })
            : 'NONE';
          const resolution = article_type === 'BOTTLENECK'
            ? detectResolutionState(title + ' ' + desc)
            : { state: null, confidence: 0 };

          // ── PATCH 0049: Suppress TIER_4_NOISE upstream ──
          if (envelope.importance_rank === 'TIER_4_NOISE') continue;

          // ── PATCH 0050: Earnings inclusion gate ──
          // Earnings articles only enter the feed if they (a) carry a
          // material surprise on a major ticker, (b) carry guidance /
          // estimate-revision language, (c) carry thesis-shifting AI /
          // monetization / margin-durability tokens, (d) anchor on
          // structural bottleneck themes, or (e) announce capex moves.
          // Plain "Essent beats by $0.13" never enters.
          if (article_type === 'EARNINGS') {
            const keep = shouldKeepEarnings({ title, desc, specific_impact: specificImpact, tickers, consequence_score: consequence });
            if (!keep) continue;
          }

          // ── PATCH 0050: Institutional impact label override ──
          // Replace the generic "Structural supply-chain signal" with
          // sub-tag-aware institutional phrasing.
          const institutionalImpact = generateInstitutionalImpactLabel({
            bottleneck_sub_tag: bottleneck_sub_tag || null,
            bottleneck_category: article_type === 'BOTTLENECK'
              ? inferBottleneckCategory({ bottleneck_sub_tag: bottleneck_sub_tag || null, anchor })
              : 'NONE',
            bottleneck_resolution: article_type === 'BOTTLENECK'
              ? detectResolutionState(title + ' ' + desc).state
              : null,
            article_type,
          });

          // ── PATCH 0050: Why-This-Matters PM line ──
          const whyThisMatters = generateWhyThisMatters({
            article_type,
            bottleneck_sub_tag: bottleneck_sub_tag || null,
            bottleneck_category: article_type === 'BOTTLENECK'
              ? inferBottleneckCategory({ bottleneck_sub_tag: bottleneck_sub_tag || null, anchor })
              : undefined,
            bottleneck_resolution: article_type === 'BOTTLENECK'
              ? detectResolutionState(title + ' ' + desc).state
              : null,
            half_life: envelope.half_life,
            importance_rank: envelope.importance_rank,
            expectation: envelope.expectation,
          });

          // ── PATCH 0050: Consensus / Variant block (HIGH-signal only) ──
          const consensusVariant = buildConsensusVariant({
            bottleneck_sub_tag: bottleneck_sub_tag || null,
            bottleneck_category: article_type === 'BOTTLENECK'
              ? inferBottleneckCategory({ bottleneck_sub_tag: bottleneck_sub_tag || null, anchor })
              : undefined,
            importance_rank: envelope.importance_rank,
            article_type,
          });

          // ── PATCH 0050: Multi-hop causal chain ──
          const causalChain = buildCausalChain({
            bottleneck_sub_tag: bottleneck_sub_tag || null,
            bottleneck_category: article_type === 'BOTTLENECK'
              ? inferBottleneckCategory({ bottleneck_sub_tag: bottleneck_sub_tag || null, anchor })
              : undefined,
            article_type,
            importance_rank: envelope.importance_rank,
            title,
            desc,
          });

          // ── PATCH 0050: Apply signal decay ──
          // Replaces the simple linear age-divide with half-life × age decay.
          const baseImportance = consequence / 100;
          const decayedImportance = applySignalDecay({
            half_life: envelope.half_life,
            age_days: ageDays,
            base_importance: baseImportance,
          });

          // ── PATCH 0052: Power-story compute-linkage gate ──
          // Generic power articles (solar EPC, hydro commissioning, BESS
          // contracts) only inherit COMPUTE_INFRA relevance if the text
          // explicitly links to data center / hyperscaler / AI compute.
          // Otherwise they stay in ENERGY_INFRA without compute crossover.
          const fullText = title + ' ' + (desc || '');
          const isGenericPower = isGenericPowerStory(fullText);
          const hasComputeLinkage = hasDirectComputeLinkage(fullText);
          // If category is COMPUTE/POWER but the article is generic power
          // without compute linkage, demote the institutional impact to
          // generic energy phrasing to avoid hallucinated AI bottleneck label.
          let safeInstitutionalImpact = institutionalImpact;
          if (isGenericPower && !hasComputeLinkage) {
            safeInstitutionalImpact = 'Energy capacity addition — not directly tied to compute infrastructure';
          }

          // ── PATCH 0052: Defense narrative sub-ontology ──
          // Defense articles are no longer all framed as bullish capex
          // acceleration. Detect specific narrative (export momentum,
          // execution risk, private competition, etc.) and emit
          // narrative-aware impact.
          let defenseNarrative: string | null = null;
          let defenseImpact: string | null = null;
          if (article_type === 'BOTTLENECK' && (bottleneck_sub_tag === 'DEFENSE_INFRA' || /defense|defence|hal|bel|bdl|drdo|isro/i.test(title))) {
            const dn = classifyDefenseNarrative(title, desc);
            defenseNarrative = dn.narrative;
            defenseImpact = dn.impact;
            // Override impact label with narrative-aware version unless GENERIC
            if (dn.narrative !== 'GENERIC') safeInstitutionalImpact = dn.impact;
          }

          // ── PATCH 0052: Frame impact with assertion class ──
          // Tag the impact line with FACT / INFERENCE / SPECULATION so
          // users distinguish what the article said vs what the system
          // inferred. Templated labels are inferences by default.
          const framed = frameImpact({
            raw_label: safeInstitutionalImpact || '',
            title,
            desc,
            is_templated: !!safeInstitutionalImpact,
          });

          // ── PATCH 0061: Evidence-bound impact ──
          // Restructures the impact into { direct_effect, second_order_effect,
          // confidence, evidence_quote } so users can see at a glance what the
          // article said vs what the system inferred.
          const evidenceBoundImpact = buildEvidenceBoundImpact({
            article_type,
            framed_label: framed.label,
            framed_assertion: framed.assertion,
            transmission_causal_path: envelope.transmission?.causal_path,
            transmission_second_order: envelope.transmission?.second_order,
            why_this_matters: whyThisMatters,
            title,
            desc,
          });

          // ── PATCH 0062: Structural Relevance Score declared LATER ──
          // (after structuralStateResult / provisionalConfidence / freshnessLayer
          // are computed below — see the next block following structuralStateResult)

          // ── PATCH 0052: Freshness layer ──
          // Splits the structural feed into LIVE_STRUCTURE / PERSISTENT_THEME
          // / ARCHIVAL_CONTEXT so 24-day-old TrendForce articles don't
          // pollute the live feed.
          const freshnessLayer = computeFreshnessLayer({
            age_days: ageDays,
            is_synthetic: false,
            half_life: envelope.half_life,
          });

          // ── PATCH 0052: Multi-dimensional confidence (lookup later via evidence accumulator) ──
          // We attach a placeholder built only from base + assertion class
          // here. Evidence-count and persistence are computed from the KV
          // ledger after the article batch is built (see post-loop step).
          const baseConfidence = envelope.structural_confidence?.confidence_pct ?? 50;
          const provisionalConfidence = buildSignalConfidence({
            base_confidence_pct: baseConfidence,
            evidence_count: 0,            // to be filled in post-loop
            evidence_persistence_days: 0, // to be filled in post-loop
            evidence_cross_source: false, // to be filled in post-loop
            importance_rank: envelope.importance_rank,
            assertion_class: framed.assertion,
          });

          // ── PATCH 0052: Bottleneck hierarchy parent ──
          // BOTTLENECK is now a meta-layer over child sub-tags. Frontend
          // can render parent (e.g. COMPUTE_INFRA) + child (HBM/CoWoS).
          const hierarchyParent = (graph.primary_node && graph.primary_node !== 'NONE')
            ? graph.primary_node
            : (article_type === 'BOTTLENECK' ? 'NONE' : 'NONE');

          // PATCH 0059: structural state — compute once, reuse twice
          const structuralStateResult = classifyStructuralState({ title, desc });

          // ── PATCH 0064: Strategic Visibility classification ──
          // Run inline (cheap) so the same article batch can power both
          // the BOTTLENECK feed and the new STRATEGIC VISIBILITY feed.
          const strategicVisibility = classifyStrategicVisibility({ title, desc });

          // ── PATCH 0067: Strategic Visibility v2 enhancements ──
          // Compute these only when the article qualifies — keeps loop cheap.
          let svSignalQuality: ReturnType<typeof classifySignalQuality> | undefined;
          let svCapacityReserved: ReturnType<typeof extractCapacityReserved> | undefined;
          let svDependency: ReturnType<typeof computeDependencyScore> | undefined;
          let svWhyMatters: string | undefined;
          let svSecondOrder: ReturnType<typeof buildSvSecondOrder> | undefined;
          let svFormattedLine: string | undefined;
          if (strategicVisibility.qualifies) {
            svSignalQuality = classifySignalQuality({
              source_name: feed.name,
              title,
              desc,
            });
            svCapacityReserved = extractCapacityReserved(`${title} ${desc}`);
            svDependency = computeDependencyScore({
              is_chokepoint_override: strategicVisibility.is_chokepoint_override,
              theme: strategicVisibility.theme,
              counterparty_tier: strategicVisibility.counterparty_tier,
              title,
              desc,
            });
            svWhyMatters = buildSvWhyThisMatters({
              signal: strategicVisibility,
              dependency_score: svDependency.score,
            });
            svSecondOrder = buildSvSecondOrder({
              theme: strategicVisibility.theme,
              counterparty_name: strategicVisibility.counterparty_name,
              contract_value_usd_m: strategicVisibility.contract_value_usd_m,
            });
            const flagsStr = strategicVisibility.flags
              .map((f) => FLAG_DISPLAY[f])
              .filter(Boolean)
              .join(' ');
            svFormattedLine = formatStrategicLine({
              ticker: tickers[0] || '—',
              signal: strategicVisibility,
              capacity: svCapacityReserved,
              dependency_score: svDependency.score,
              date_iso: pubDate || new Date().toISOString(),
              flags_str: flagsStr,
            });
          }

          // ── PATCH 0062: Structural Relevance Score (unified 0-100) ──
          // Now that all dependencies are in scope, compute the unified score.
          // Combines structural state + signal confidence + structural confidence
          // + assertion class + importance rank + graph weight + transmission
          // anchor + cross-source + freshness into ONE visible score per article.
          // Tier mapping: 95+ CONFIRMED, 80+ RECURRING, 60+ THEMATIC,
          // 40+ SPECULATIVE, else NOISE.
          const structuralRelevance = computeStructuralRelevance({
            structural_state: structuralStateResult.state,
            structural_state_confidence: structuralStateResult.confidence,
            signal_confidence_pct: provisionalConfidence.confidence_pct,
            structural_confidence_pct: envelope.structural_confidence?.confidence_pct,
            assertion_class: framed.assertion,
            importance_rank: envelope.importance_rank,
            graph_total_weight: graph.total_weight,
            has_named_transmission: (exposure.beneficiaries.length + exposure.atRisk.length) > 0,
            cross_source_confirmation: false,  // refined post-loop from KV
            freshness_layer: freshnessLayer,
          });

          items.push({
            id: uniqueId,
            title,
            headline: title,
            summary: desc.slice(0, 300),
            source_name: feed.name,
            source: feed.name,
            source_tier: feed.tier,
            source_url: link,
            // Validate pubDate before storing — some new RSS feeds emit
            // malformed dates that crash the UI's formatDistanceToNow.
            published_at: (() => {
              if (!pubDate) return new Date().toISOString();
              const d = new Date(pubDate);
              return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
            })(),
            region,
            article_type,
            investment_tier: effectiveTier,
            consequence_score: consequence,
            consequence_score_raw: rawConsequence,
            credibility_factor: cred.factor,
            anchor_score: anchor.total,
            anchor_categories: anchor.categories_hit,
            // PATCH 0051: 10-year architecture
            source_tier_v2: classifySourceTier(feed.name),
            source_multiplier: combinedMultiplier,
            graph_primary_node: graph.primary_node,
            graph_primary_label: NODE_DISPLAY[graph.primary_node],
            graph_event_class: graph.event_class,
            graph_nodes_hit: graph.nodes_hit,
            graph_dependent_nodes: graph.dependent_nodes,
            graph_total_weight: graph.total_weight,
            specific_impact: specificImpact,
            exposure_beneficiaries: exposure.beneficiaries,
            exposure_at_risk: exposure.atRisk,
            sentiment,
            bottleneck_sub_tag: bottleneck_sub_tag || null,
            bottleneck_level: bottleneck_level || null,
            bottleneck_category,
            bottleneck_resolution: resolution.state,
            bottleneck_resolution_confidence: resolution.confidence,
            // PATCH 0049: institutional envelope
            importance_rank: envelope.importance_rank,
            half_life: envelope.half_life,
            signal_taxonomy: envelope.taxonomy,
            transmission: envelope.transmission,
            expectation: envelope.expectation,
            structural_confidence: envelope.structural_confidence ?? null,
            macro_regime: envelope.macro_regime ?? null,
            // PATCH 0050: intelligence layer
            institutional_impact_label: safeInstitutionalImpact,
            why_this_matters: whyThisMatters,
            consensus_variant: consensusVariant,
            causal_chain: causalChain,
            // PATCH 0052: causal-honesty layer
            impact_assertion: framed.assertion,           // FACT / INFERENCE / SPECULATION
            impact_prefix: framed.prefix,                  // 'Reported:' / 'May imply:' / 'Speculative thematic:'
            impact_label_safe: framed.label,
            // PATCH 0061: evidence-bound impact (structured)
            evidence_bound_impact: evidenceBoundImpact,    // { direct_effect, second_order_effect, confidence, evidence_quote }
            // PATCH 0062: unified structural relevance score (0-100)
            structural_relevance: structuralRelevance,     // { score, tier, tier_label, contributing }
            // PATCH 0064: strategic visibility classification (parallel to bottleneck)
            strategic_visibility: strategicVisibility,     // { qualifies, theme, counterparty_tier, contract_value_usd_m, ... }
            // PATCH 0067: Strategic Visibility v2 enhancements
            sv_signal_quality_tier: svSignalQuality ?? null,        // A_FILING / B_TIER1_MEDIA / C_INDUSTRY / D_SPECULATIVE
            sv_capacity_reserved: svCapacityReserved ?? null,        // { unit, amount, raw_phrase }
            sv_dependency_score: svDependency?.score ?? null,        // 1-5
            sv_dependency_rationale: svDependency?.rationale ?? null,
            sv_why_this_matters: svWhyMatters ?? null,
            sv_second_order: svSecondOrder ?? null,                  // { beneficiaries[], risk[] }
            sv_formatted_line: svFormattedLine ?? null,
            defense_narrative: defenseNarrative,
            defense_impact_inline: defenseImpact,
            freshness_layer: freshnessLayer,               // LIVE / PERSISTENT / ARCHIVAL
            signal_confidence: provisionalConfidence,      // multi-dim confidence (will be enriched post-loop)
            bottleneck_parent: hierarchyParent,            // parent in hierarchy (SystemNode)
            bottleneck_child: bottleneck_sub_tag || null,  // child sub-tag
            // PATCH 0053b: emit BOTH `tickers` (legacy) and `ticker_symbols`
            // (canonical type field). Many consumers (Concall Intel,
            // Multibagger, Bottleneck-Intel, NewsCard, news/page) read
            // `ticker_symbols`. The API previously only emitted `tickers`,
            // causing those consumers to silently see empty arrays
            // and tag every stock with "0 articles". Aliasing both keeps
            // every consumer working without rewriting them.
            tickers: tickers,
            ticker_symbols: tickers,
            primary_ticker: tickers[0] || null,
            // PATCH 0059: structural state — BOTTLENECK is no longer the
            // meta-bucket. Articles split into BOTTLENECK / CAPACITY_EXPANSION
            // / CAPEX_BUILDOUT / SUPPLY_RESPONSE / DEMAND_SURGE /
            // POLICY_SUPPORT so the feed UX can color and filter by intent.
            structural_state: structuralStateResult.state,
            structural_state_confidence: structuralStateResult.confidence,
            // PATCH 0050: importance now uses half-life decay instead of
            // linear age divide. TRANSIENT articles fade in days; SECULAR
            // ones persist for ~18 months.
            importance_score: decayedImportance,
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
          id: `ibef-${Buffer.from(href).toString('base64').slice(-20)}`,
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
          id: `ibef-${Buffer.from(href).toString('base64').slice(-20)}`,
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
      // PATCH 0049/0050: synthetic articles also get the institutional
      // envelope + ontology fields so frontend renders consistently.
      const synthAnchor = scoreAnchor(synth.title, synth.summary);
      const synthCategory = inferBottleneckCategory({ bottleneck_sub_tag: synth.sub_tag, anchor: synthAnchor });
      const synthRes = detectResolutionState(synth.title + ' ' + synth.summary);
      const synthEnvelope = buildInstitutionalEnvelope({
        article_type: 'BOTTLENECK',
        bottleneck_sub_tag: synth.sub_tag,
        bottleneck_level: synth.status === 'CRITICAL' ? 'CRITICAL_BOTTLENECK' : 'BOTTLENECK',
        consequence_score: synth.status === 'CRITICAL' ? 95 : 85,
        is_synthetic: true,
        structural_status: synth.status,
        specific_impact: undefined,
        exposure_beneficiaries: synth.tickers,
        exposure_at_risk: [],
        tickers: synth.tickers,
        source_tier: 'primary',
        feed_name: 'Structural Analysis',
        title: synth.title,
        desc: synth.summary,
      });
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
        bottleneck_category: synthCategory,
        bottleneck_resolution: synthRes.state,
        bottleneck_resolution_confidence: synthRes.confidence,
        importance_rank: synthEnvelope.importance_rank,
        half_life: synthEnvelope.half_life,
        signal_taxonomy: synthEnvelope.taxonomy,
        transmission: synthEnvelope.transmission,
        expectation: synthEnvelope.expectation,
        structural_confidence: synthEnvelope.structural_confidence ?? null,
        macro_regime: synthEnvelope.macro_regime ?? null,
        anchor_score: synthAnchor.total,
        anchor_categories: synthAnchor.categories_hit,
        // PATCH 0053b: alias tickers / ticker_symbols (see above)
        tickers: synth.tickers,
        ticker_symbols: synth.tickers,
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

  // ── PATCH 0052: Enrich signal_confidence with evidence-ledger lookups ──
  // Pre-fetch evidence for unique nodes hit so we can populate evidence_count,
  // persistence_days, and cross_source_confirmation per article.
  const uniqueNodes = Array.from(new Set(
    withSynthetics
      .map((a: any) => a.graph_primary_node)
      .filter((n: string) => n && n !== 'NONE')
  ));
  const evidenceByNode: Record<string, { evidence_count: number; persistence_days: number; cross_source: boolean }> = {};
  await Promise.all(
    uniqueNodes.map(async (n) => {
      try {
        const e = await readEvidence(n as any);
        if (e) {
          const earliest = e.top_samples.length > 0
            ? new Date(e.top_samples[e.top_samples.length - 1].recorded_at).getTime()
            : new Date(e.last_seen).getTime();
          const persistence = Math.max(0, Math.round((Date.now() - earliest) / 86400000));
          const tiers = new Set(e.top_samples.map(s => s.tier));
          const crossSource = (tiers.has('PRIMARY') || tiers.has('SPECIALIST')) && tiers.size >= 2;
          evidenceByNode[n] = { evidence_count: e.sample_count, persistence_days: persistence, cross_source: crossSource };
        }
      } catch { /* non-fatal */ }
    })
  );

  // Add impact statements + investment tickers + enriched confidence
  const articlesWithImpact = withSynthetics.map(a => {
    const ev = a.graph_primary_node ? evidenceByNode[a.graph_primary_node] : null;
    let enrichedConfidence = a.signal_confidence;
    if (ev && a.signal_confidence) {
      enrichedConfidence = buildSignalConfidence({
        base_confidence_pct: a.structural_confidence?.confidence_pct ?? 50,
        evidence_count: ev.evidence_count,
        evidence_persistence_days: ev.persistence_days,
        evidence_cross_source: ev.cross_source,
        importance_rank: a.importance_rank,
        assertion_class: a.impact_assertion ?? 'INFERENCE',
      });
    }
    return {
      ...a,
      // PATCH 0050: prefer institutional impact label when set
      impact_statement: a.institutional_impact_label || generateImpact(a.title, a.summary || '', a.article_type, a.region, a.bottleneck_sub_tag),
      investment_tickers: a.article_type === 'BOTTLENECK' ? getInvestmentTickers(a.title + ' ' + (a.summary || '')) : [],
      signal_confidence: enrichedConfidence,
    };
  });

  // ── PHASE 3.12: Cross-Reference network ──
  // For each BOTTLENECK article with a sub-tag, append to the rolling
  // 90-day theme bucket so the UI can render "see also: 4 prior CoWoS
  // articles" under each structural alert. Fire-and-forget — don't
  // block response if KV is slow.
  Promise.all(
    articlesWithImpact
      .filter((a) => a.article_type === 'BOTTLENECK' && a.bottleneck_sub_tag)
      .slice(0, 30)
      .map((a) =>
        recordXRef(a.bottleneck_sub_tag!, {
          id: a.id,
          title: a.title,
          source: a.source_name,
          source_url: a.source_url,
          published_at: a.published_at,
          consequence_score: a.consequence_score || 0,
          exposure_beneficiaries: a.exposure_beneficiaries,
          exposure_at_risk: a.exposure_at_risk,
        }),
      ),
  ).catch(() => { /* non-fatal */ });

  // ── PATCH 0051: Evidence accumulator ──
  // For each article that hits a SystemNode, record a source-weighted
  // sample. Over time, themes emerge organically: HBM shortage articles
  // accumulate confidence in MEMORY_INFRA, photonics articles in
  // INTERCONNECT_INFRA, etc. Fire-and-forget.
  Promise.all(
    articlesWithImpact
      .filter((a: any) => a.graph_primary_node && a.graph_primary_node !== 'NONE')
      .slice(0, 40)
      .map((a: any) =>
        recordEvidence(a.graph_primary_node, {
          article_id: a.id,
          title: a.title,
          source: a.source_name,
          tier: a.source_tier_v2 || 'UNKNOWN',
          raw_weight: Math.min(10, Math.round((a.graph_total_weight || 0) / 4)),
        }),
      ),
  ).catch(() => { /* non-fatal */ });

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
    // Phase 2.6: watchlist-weighted ranking. Frontend passes a comma-
    // separated ticker list; matching articles get +20 importance boost.
    const watchlist = (searchParams.get('watchlist') || '').toUpperCase().split(',').filter(Boolean);
    // Phase 1.3: must-read mode. Returns top 5 curated articles.
    const mustRead = searchParams.get('must_read') === '1';
    // Phase 2.5: anomaly detector. Returns tickers/themes with unusual
    // article concentration in the last 24h.
    const anomalies = searchParams.get('anomalies') === '1';
    // PATCH 0064: ?strategic=1 — returns just the strategic-visibility-qualifying
    // articles, sorted by strategicRankScore desc.
    const strategicFlag = searchParams.get('strategic') === '1';

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

    // ── Phase 2.6: Watchlist-weighted ranking ──
    // Boost articles that mention any ticker in the user's watchlist by
    // +0.20 importance (out of 1.0). Most articles end up in the 0.0–0.6
    // range so a +0.2 bump materially repositions a watchlist match.
    if (watchlist.length > 0) {
      filtered = filtered.map(a => {
        const text = (a.title + ' ' + (a.summary || '') + ' ' + (a.tickers || []).join(' ')).toUpperCase();
        const matches = watchlist.filter(w => text.includes(w));
        if (matches.length > 0) {
          return {
            ...a,
            importance_score: Math.min(1.0, (a.importance_score || 0) + 0.20),
            watchlist_match: matches,
          };
        }
        return a;
      });
      // Re-sort by importance after boost
      filtered.sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0));
    }

    // ── Phase 1.3: Must-Read curation (improved) ──
    // Composite score weighted heavily toward:
    //   - Specific impact extraction (article has structured pill)
    //   - Recency (last 6h gets full weight, decays linearly to 24h)
    //   - Watchlist match
    //   - Primary/editorial source tier
    // Penalised:
    //   - Generic article_type='GENERAL' (fallback bucket)
    //   - Stale articles (>24h)
    //   - Articles with low consequence even when type passes
    if (mustRead) {
      const tierWeight: Record<string, number> = {
        primary: 1.3, secondary: 1.0, tertiary: 0.7, editorial: 1.2, retail: 0.4,
      };
      const now = Date.now();

      // MUST_READ_DENY_RE — patterns that must NEVER appear in MUST READ
      // even if they passed the BOTTLENECK gate. Lawsuits, missile-test
      // announcements without named company, parliamentary review
      // previews, top-gainers listicles, generic "ordered to pay" legal.
      const MUST_READ_DENY_RE = /\b(ordered to pay|sued over|lawsuit|court order|guilty|convicted|criminal charge|missile (test|capability|launch)|agni missile|brahmos test|tejas test|test fire|successfully test|parliamentary panel|petroleum panel|energy panel review|panel to review|top gainers? (?:&|and) losers?|gainers?\s*(?:&|and)\s*losers?|highway contracts|highway approvals|highway tenders?|construction[- ]ready)\b/i;

      // STRICT ACTIONABILITY GATE — for MUST READ specifically.
      // An article qualifies only if it has at least ONE of:
      //   - specific_impact extracted (Bloomberg-style "X: ±N%")
      //   - matches user watchlist
      //   - is from primary tier with consequence ≥ 60
      //   - mentions a major institutional ticker in title
      const MAJOR_TICKER_RE = /\b(NVDA|AAPL|GOOGL|GOOG|MSFT|AMZN|META|TSLA|TSM|ASML|AVGO|AMD|MU|HDFC|HDFCBANK|ICICIBANK|SBIN|RELIANCE|TCS|INFY|WIPRO|HCLTECH|LT|BAJFINANCE|BAJAJFINSV|KOTAKBANK|AXISBANK|MARUTI|TATAMOTORS|TATASTEEL|JSWSTEEL|HINDUNILVR|ITC|NESTLEIND|BRITANNIA|ASIANPAINT|TITAN|ULTRACEMCO|BHARTIARTL|JIOFIN|ADANIENT|ADANIPORTS|POWERGRID|NTPC|ONGC|COALINDIA|BPCL|IOC|HPCL|HAL|BEL|BHEL|GRSE|BEML|MAZAGON|CONCOR|IRCTC|RAILTEL|RVNL|CONCOR|IDEA|VBL|TRENT|DMART|DLF|GODREJCP|DABUR|MARICO|COLPAL|UBL|BIOCON|CIPLA|DIVISLAB|SUNPHARMA|DRREDDY|APOLLOHOSP|MAXHEALTH|BAJAJ-AUTO|EICHERMOT|HEROMOTOCO|TVSMOTOR|MOTHERSON|BOSCHLTD|SIEMENS|ABB|HAVELLS|VOLTAS|BLUEDART|GLAND|SYNGENE|LAURUSLABS|NAUKRI|PERSISTENT|MPHASIS|COFORGE|LTIM|MINDTREE|TECHM|MFSL)\b/i;

      // Take top 5 IN + top 5 US for a balanced 10-article surface.
      const scoreArticle = (a: any) => {
        const ageH = a.published_at ? (now - new Date(a.published_at).getTime()) / 3600000 : 100;
        const recencyMult = ageH <= 6 ? 1.0 : ageH <= 24 ? 0.7 : ageH <= 72 ? 0.4 : 0.15;
        const specificImpactBonus = (a.specific_impact?.label) ? 1.4 : 1.0;
        const watchlistBonus = (a.watchlist_match && a.watchlist_match.length > 0) ? 1.5 : 1.0;
        const tierMult = tierWeight[a.source_tier] || 1.0;
        const retailPenalty = a.source_tier === 'retail' ? 0.5 : 1.0;
        const tickerBonus = MAJOR_TICKER_RE.test(a.title || '') ? 1.3 : 1.0;
        return (a.consequence_score / 100) * tierMult * recencyMult * specificImpactBonus * watchlistBonus * retailPenalty * tickerBonus;
      };

      const eligible = filtered
        .filter((a) => a.article_type !== 'COMMENTARY' && a.article_type !== 'GENERAL')
        .filter((a) => (a.consequence_score || 0) >= 50)         // raised from 35
        .filter((a) => !MUST_READ_DENY_RE.test(a.title || ''))   // hard exclusion
        .filter((a) => {
          // Must satisfy at least one actionability anchor
          const hasSpecificImpact = !!a.specific_impact?.label;
          const isWatchlist = (a.watchlist_match && a.watchlist_match.length > 0);
          const isPrimaryHigh = a.source_tier === 'primary' && (a.consequence_score || 0) >= 60;
          const hasMajorTicker = MAJOR_TICKER_RE.test(a.title || '');
          return hasSpecificImpact || isWatchlist || isPrimaryHigh || hasMajorTicker;
        })
        .map((a) => ({ ...a, must_read_score: scoreArticle(a) }));

      // Split by region: top 5 IN + top 5 US (or up to 10 mixed if one region thin)
      const indiaTop = eligible.filter((a) => a.region === 'IN').sort((a, b) => b.must_read_score - a.must_read_score).slice(0, 5);
      const usTop = eligible.filter((a) => a.region === 'US' || a.region === 'GLOBAL').sort((a, b) => b.must_read_score - a.must_read_score).slice(0, 5);

      // Interleave for visual mix
      const merged: any[] = [];
      const maxLen = Math.max(indiaTop.length, usTop.length);
      for (let i = 0; i < maxLen; i++) {
        if (indiaTop[i]) merged.push(indiaTop[i]);
        if (usTop[i]) merged.push(usTop[i]);
      }
      // Top up if one side has fewer than 5
      const ranked = merged.slice(0, 10);
      return NextResponse.json(ranked);
    }

    // ── Phase 2.5 / 3.14: Anomaly detector ──
    // Counts articles per ticker and per theme. Tickers/themes with
    // ≥3 articles in the last 24h are flagged as "anomalous" — usually
    // means something is developing.
    // ── PATCH 0051: Evidence ledger endpoint ──
    // Returns rolling 30-day theme confidence per SystemNode. Lets the
    // frontend build a "themes emerging" widget that surfaces what the
    // accumulated evidence says — independent of any single article.
    // PATCH 0064: Strategic Visibility endpoint
    if (strategicFlag) {
      const qualifying = (articles ?? [])
        .filter((a: any) => a.strategic_visibility?.qualifies === true)
        .map((a: any) => ({
          ...a,
          _rank: strategicRankScore(a.strategic_visibility),
        }))
        .sort((a: any, b: any) => b._rank - a._rank)
        .slice(0, 100);
      return NextResponse.json({
        section_title: 'Strategic Visibility',
        section_subtitle: 'Multi-year frameworks, hyperscaler commitments, sovereign programs, transformational revenue locks',
        count: qualifying.length,
        articles: qualifying,
      });
    }

    const evidenceFlag = searchParams.get('evidence') === '1';
    if (evidenceFlag) {
      const { readAllEvidence } = await import('@/lib/news/evidence-accumulator');
      const allNodes: Array<import('@/lib/news/semantic-graph').SystemNode> = [
        'COMPUTE_INFRA','MEMORY_INFRA','PACKAGING_INFRA','FABRICATION_INFRA',
        'INTERCONNECT_INFRA','COOLING_INFRA','NETWORK_BANDWIDTH',
        'ENERGY_INFRA','NUCLEAR_INFRA','OIL_GAS_INFRA','RENEWABLE_INFRA',
        'LOGISTICS_INFRA','TRANSPORT_INFRA','DEFENSE_INFRA','AEROSPACE_INFRA',
        'RESOURCE_SCARCITY','AGRI_INFRA','MANUFACTURING_CAPACITY',
        'LABOR_CONSTRAINT','CAPITAL_CONSTRAINT',
      ];
      const all = await readAllEvidence(allNodes);
      return NextResponse.json({
        nodes: all,
        section_title: 'Theme Confidence Ledger',
        section_subtitle: 'Source-weighted evidence accumulation, 30-day rolling decay',
      });
    }

    if (anomalies) {
      const tickerCount: Record<string, number> = {};
      const themeCount: Record<string, number> = {};
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const a of filtered) {
        const ts = new Date(a.published_at || 0).getTime();
        if (ts < cutoff) continue;
        for (const t of (a.tickers || [])) tickerCount[t] = (tickerCount[t] || 0) + 1;
        if (a.bottleneck_sub_tag) themeCount[a.bottleneck_sub_tag] = (themeCount[a.bottleneck_sub_tag] || 0) + 1;
      }
      const tickerHot = Object.entries(tickerCount).filter(([_, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
      const themeHot = Object.entries(themeCount).filter(([_, n]) => n >= 3).sort((a, b) => b[1] - a[1]);

      // PATCH 0050: enrich anomalies with display names + why-it-matters
      const themesEnriched = themeHot.map(([theme, n]) => classifyAnomaly({ theme, count: n }));
      const tickersEnriched = tickerHot.map(([ticker, n]) => classifyTickerAnomaly({ ticker, count: n }));

      return NextResponse.json({
        // Legacy raw shape kept for backward-compat with old UI
        tickers: tickerHot,
        themes: themeHot,
        // PATCH 0050: enriched institutional shape
        section_title: 'Emerging Stress Signals',
        section_subtitle: 'Themes & names with article concentration above baseline',
        themes_v2: themesEnriched,
        tickers_v2: tickersEnriched,
      });
    }

    return NextResponse.json(filtered);
  } catch (error) {
    console.error('[News API] Error:', error);
    return NextResponse.json([], { status: 200 });
  }
}
