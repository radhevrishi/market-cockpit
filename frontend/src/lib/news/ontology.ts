// ═══════════════════════════════════════════════════════════════════════════
// MARKET-SYSTEM ONTOLOGY — patch 0050
//
// Replaces the giant regex-centric anchor/denylist approach with:
//   • token dictionaries grouped by domain
//   • weighted scoring (title position adds bonus, multiple categories
//     adds breadth bonus)
//   • normalized entity extraction over a canonical company table
//   • constraint severity modeling: EMERGING / PERSISTENT / EASING / RESOLVED
//   • BOTTLENECK sub-category (COMPUTE / POWER / DEFENSE / MATERIAL /
//     LOGISTICS / ENERGY / FINANCIAL_INFRA)
//
// Why: the previous TITLE_BOTTLENECK_ANCHOR_RE was a 1-kilo regex with
// alternations like `hal\b|bel\b` that collide with non-Indian text and
// silently regress. Token tables + weighted scoring is debuggable,
// extensible, and gives an explicit confidence number per article.
// ═══════════════════════════════════════════════════════════════════════════

export type BottleneckCategory =
  | 'COMPUTE_CONSTRAINT'    // chip / wafer / packaging / memory / accelerator
  | 'POWER_CONSTRAINT'      // grid / transmission / transformer / generation
  | 'DEFENSE_SUPPLY'        // defence platform orders / strategic kit
  | 'MATERIAL_SCARCITY'     // rare earth / lithium / uranium / mineral
  | 'LOGISTICS_CONSTRAINT'  // shipping / port / freight / container / pipeline
  | 'ENERGY_CONSTRAINT'     // crude / refining / gas / nuclear fuel
  | 'FINANCIAL_INFRA'       // banking infrastructure / payment rails
  | 'NONE';

export type ResolutionState =
  | 'EMERGING'    // new signal: "shortage starting", "first signs"
  | 'PERSISTENT'  // confirmed multi-quarter: "remains tight", "still constrained"
  | 'EASING'      // capacity catching up: "easing", "ramp", "expansion announced"
  | 'RESOLVED';   // fully normalized: "resolved", "abundant", "back to normal"

// ─── Token dictionaries by category ────────────────────────────────────────
// Each entry: { token, weight, category }. Higher weight = stronger signal.

interface Token {
  pattern: RegExp;
  weight: number;
  category: BottleneckCategory;
  // optional companion: a token that must co-occur to count
  // (e.g. "memory" alone is too weak; needs "shortage" or "tight")
  companion?: RegExp;
}

const COMPUTE_TOKENS: Token[] = [
  { pattern: /\bhbm\d?e?\b/i,            weight: 8, category: 'COMPUTE_CONSTRAINT' },
  { pattern: /\bcowos\b/i,               weight: 8, category: 'COMPUTE_CONSTRAINT' },
  { pattern: /\beuv\b/i,                 weight: 7, category: 'COMPUTE_CONSTRAINT' },
  { pattern: /\bdram\b/i,                weight: 7, category: 'COMPUTE_CONSTRAINT' },
  { pattern: /\bnand\b/i,                weight: 6, category: 'COMPUTE_CONSTRAINT' },
  { pattern: /\bddr5\b/i,                weight: 6, category: 'COMPUTE_CONSTRAINT' },
  { pattern: /\b(silicon |co.?packaged )?photonics\b/i, weight: 7, category: 'COMPUTE_CONSTRAINT' },
  { pattern: /\boptical interconnect\b/i, weight: 7, category: 'COMPUTE_CONSTRAINT' },
  { pattern: /\bcpo\b/i,                 weight: 6, category: 'COMPUTE_CONSTRAINT' },
  { pattern: /\b(advanced )?packaging\b/i, weight: 5, category: 'COMPUTE_CONSTRAINT', companion: /(capacity|constraint|shortage|tight|allocation|backlog|sold out|lead time)/i },
  { pattern: /\bchiplet\b/i,             weight: 5, category: 'COMPUTE_CONSTRAINT' },
  { pattern: /\binterposer\b/i,          weight: 5, category: 'COMPUTE_CONSTRAINT' },
  { pattern: /\bsemiconductor\b/i,       weight: 4, category: 'COMPUTE_CONSTRAINT', companion: /(capacity|shortage|constraint|tight|allocation|backlog|sold out|lead time|supply (gap|crunch))/i },
  { pattern: /\bwafer\b/i,               weight: 4, category: 'COMPUTE_CONSTRAINT', companion: /(capacity|fab|shortage|tight|allocation)/i },
  { pattern: /\bfoundry\b/i,             weight: 4, category: 'COMPUTE_CONSTRAINT' },
  { pattern: /\bfab\b/i,                 weight: 3, category: 'COMPUTE_CONSTRAINT', companion: /(capacity|construction|expansion|tool order|equipment|sold out|backlog)/i },
  { pattern: /\bai accelerator\b/i,      weight: 6, category: 'COMPUTE_CONSTRAINT' },
  { pattern: /\bai chip\b/i,             weight: 5, category: 'COMPUTE_CONSTRAINT' },
  { pattern: /\bgpu\b/i,                 weight: 3, category: 'COMPUTE_CONSTRAINT', companion: /(supply|allocation|shortage|capacity|sold out|backlog|wait|lead time)/i },
  { pattern: /\b(memory wall|memory bandwidth)\b/i, weight: 6, category: 'COMPUTE_CONSTRAINT' },
];

const POWER_TOKENS: Token[] = [
  { pattern: /\bpower grid\b/i,                 weight: 7, category: 'POWER_CONSTRAINT' },
  { pattern: /\belectricity grid\b/i,           weight: 7, category: 'POWER_CONSTRAINT' },
  { pattern: /\b(transmission|transformer|substation)\b/i, weight: 5, category: 'POWER_CONSTRAINT', companion: /(capacity|order|shortage|backlog|expansion|constraint|stress)/i },
  { pattern: /\b(grid (capacity|stress|congestion|stability))\b/i, weight: 7, category: 'POWER_CONSTRAINT' },
  { pattern: /\bdata center power\b/i,          weight: 6, category: 'POWER_CONSTRAINT' },
  { pattern: /\b(coal (stockpile|stock at|shortage|imports?|allocation))\b/i, weight: 6, category: 'POWER_CONSTRAINT' },
  { pattern: /\b(nuclear (reactor|power|plant|fuel|capacity))\b/i, weight: 7, category: 'POWER_CONSTRAINT' },
  { pattern: /\b(small modular reactor|smr)\b/i, weight: 6, category: 'POWER_CONSTRAINT' },
  { pattern: /\b(load shedding|blackout|brownout|power deficit|electricity shortage)\b/i, weight: 8, category: 'POWER_CONSTRAINT' },
  { pattern: /\b(thermal management|liquid cooling|immersion cooling|cdu)\b/i, weight: 5, category: 'POWER_CONSTRAINT' },
  { pattern: /\b(battery cell|gigafactory|electrolyser|green hydrogen)\b/i, weight: 5, category: 'POWER_CONSTRAINT' },
  { pattern: /\b\d{2,4}\s*(mw|gw|kva)\b/i,      weight: 4, category: 'POWER_CONSTRAINT' },
];

const DEFENSE_TOKENS: Token[] = [
  { pattern: /\b(defence (order|procurement|deal|corridor|export|contract win))\b/i, weight: 8, category: 'DEFENSE_SUPPLY' },
  { pattern: /\b(defense (order|procurement|contract|spending|export))\b/i, weight: 7, category: 'DEFENSE_SUPPLY' },
  { pattern: /\b(brahmos|akash|tejas|rafale|s-400|p-?75|pinaka|agni|drdo|isro)\b/i, weight: 6, category: 'DEFENSE_SUPPLY', companion: /(order|deliver|contract|production|export|deployment|squadron|batch)/i },
  { pattern: /\b(mazagon dock|cochin shipyard|garden reach|grse|bharat dynamics|bharat electronics|hindustan aeronautics|bharat earth movers|beml|midhani)\b/i, weight: 7, category: 'DEFENSE_SUPPLY' },
  { pattern: /\b(submarine|fighter jet|missile|warship|aircraft carrier)\b/i, weight: 4, category: 'DEFENSE_SUPPLY', companion: /(order|build|deliver|acquisition|procurement|contract|fleet)/i },
];

const MATERIAL_TOKENS: Token[] = [
  { pattern: /\brare earth\b/i,                 weight: 7, category: 'MATERIAL_SCARCITY' },
  { pattern: /\b(lithium|cobalt|nickel|graphite|tungsten|gallium|germanium)\b/i, weight: 5, category: 'MATERIAL_SCARCITY', companion: /(supply|export|allocation|reserve|mine|processing)/i },
  { pattern: /\b(critical mineral|strategic mineral|kabil|amrita)\b/i, weight: 7, category: 'MATERIAL_SCARCITY' },
  { pattern: /\b(uranium|enrichment|fuel rod)\b/i, weight: 6, category: 'MATERIAL_SCARCITY' },
  { pattern: /\b(copper|aluminium|aluminum|steel)\b/i, weight: 3, category: 'MATERIAL_SCARCITY', companion: /(supply|shortage|inventory|capacity|stockpile|export ban)/i },
];

const LOGISTICS_TOKENS: Token[] = [
  { pattern: /\b(shipping container|container shortage|container rate)\b/i, weight: 6, category: 'LOGISTICS_CONSTRAINT' },
  { pattern: /\b(port (congestion|backlog|capacity|expansion))\b/i, weight: 6, category: 'LOGISTICS_CONSTRAINT' },
  { pattern: /\b(freight (rate|congestion|capacity))\b/i, weight: 5, category: 'LOGISTICS_CONSTRAINT' },
  { pattern: /\b(supply chain (disruption|gap|crisis|crunch))\b/i, weight: 6, category: 'LOGISTICS_CONSTRAINT' },
  { pattern: /\b(strait of hormuz|red sea|panama canal|suez)\b/i, weight: 6, category: 'LOGISTICS_CONSTRAINT', companion: /(disruption|blockade|attack|closure|congestion|delay)/i },
  { pattern: /\b(jnpt|sagarmala|major port)\b/i, weight: 5, category: 'LOGISTICS_CONSTRAINT' },
];

const ENERGY_TOKENS: Token[] = [
  { pattern: /\b(refinery (commissioning|capacity expansion|throughput|shutdown|maintenance))\b/i, weight: 6, category: 'ENERGY_CONSTRAINT' },
  { pattern: /\b(oil pipeline|gas pipeline|kg-?d6|kg-?krishna)\b/i, weight: 6, category: 'ENERGY_CONSTRAINT' },
  { pattern: /\b(opec.{0,15}(quota|cut|production))\b/i, weight: 5, category: 'ENERGY_CONSTRAINT' },
  { pattern: /\b(strategic petroleum reserve|spr)\b/i, weight: 5, category: 'ENERGY_CONSTRAINT' },
  { pattern: /\b(fuel crunch|petrol shortage|diesel shortage|lpg shortage)\b/i, weight: 7, category: 'ENERGY_CONSTRAINT' },
  { pattern: /\b(lng (carrier|terminal|capacity|export))\b/i, weight: 5, category: 'ENERGY_CONSTRAINT' },
];

const FINANCIAL_INFRA_TOKENS: Token[] = [
  { pattern: /\b(rbi.{0,15}(licence|license|repealed|revoke|granted))\b/i, weight: 6, category: 'FINANCIAL_INFRA' },
  { pattern: /\b(sebi (final order|enforcement order|surveillance|approval))\b/i, weight: 5, category: 'FINANCIAL_INFRA' },
  { pattern: /\b(insolvency (resolution|admission)|ibc (admission|liquidation))\b/i, weight: 5, category: 'FINANCIAL_INFRA' },
];

// All tokens flattened, indexed by category.
const ALL_TOKENS: Token[] = [
  ...COMPUTE_TOKENS, ...POWER_TOKENS, ...DEFENSE_TOKENS,
  ...MATERIAL_TOKENS, ...LOGISTICS_TOKENS, ...ENERGY_TOKENS,
  ...FINANCIAL_INFRA_TOKENS,
];

// ─── Canonical entity table (replaces bare regex word boundaries) ──────────
// Each entity is a tuple: [pattern-to-match-in-title, ticker]. Patterns are
// careful: "BHEL" only matches as standalone token, never as a substring of
// another word; we use word boundary + explicit case-insensitive flag.

interface Entity {
  match: RegExp;       // pattern that anchors on word boundaries
  ticker: string;
  region: 'IN' | 'US' | 'GLOBAL';
  category: BottleneckCategory;
}

const ENTITIES: Entity[] = [
  // US AI / semis
  { match: /\bnvidia\b/i,           ticker: 'NVDA', region: 'US', category: 'COMPUTE_CONSTRAINT' },
  { match: /\b(amd|advanced micro)\b/i, ticker: 'AMD', region: 'US', category: 'COMPUTE_CONSTRAINT' },
  { match: /\bbroadcom\b/i,         ticker: 'AVGO', region: 'US', category: 'COMPUTE_CONSTRAINT' },
  { match: /\bmicron\b/i,           ticker: 'MU',   region: 'US', category: 'COMPUTE_CONSTRAINT' },
  { match: /\bintel\b/i,            ticker: 'INTC', region: 'US', category: 'COMPUTE_CONSTRAINT' },
  { match: /\btsmc\b/i,             ticker: 'TSM',  region: 'US', category: 'COMPUTE_CONSTRAINT' },
  { match: /\basml\b/i,             ticker: 'ASML', region: 'US', category: 'COMPUTE_CONSTRAINT' },
  { match: /\bsk hynix\b/i,         ticker: '000660.KS', region: 'US', category: 'COMPUTE_CONSTRAINT' },
  { match: /\bsamsung\b/i,          ticker: 'SAMSUNG', region: 'US', category: 'COMPUTE_CONSTRAINT' },
  { match: /\b(applied materials|amat)\b/i, ticker: 'AMAT', region: 'US', category: 'COMPUTE_CONSTRAINT' },
  { match: /\b(lam research|lrcx)\b/i,      ticker: 'LRCX', region: 'US', category: 'COMPUTE_CONSTRAINT' },
  { match: /\bcoherent corp\b/i,    ticker: 'COHR', region: 'US', category: 'COMPUTE_CONSTRAINT' },
  { match: /\blumentum\b/i,         ticker: 'LITE', region: 'US', category: 'COMPUTE_CONSTRAINT' },
  // US power
  { match: /\bge vernova\b/i,       ticker: 'GEV', region: 'US', category: 'POWER_CONSTRAINT' },
  { match: /\beaton\b/i,            ticker: 'ETN', region: 'US', category: 'POWER_CONSTRAINT' },
  { match: /\bvistra\b/i,           ticker: 'VST', region: 'US', category: 'POWER_CONSTRAINT' },
  { match: /\bconstellation energy\b/i, ticker: 'CEG', region: 'US', category: 'POWER_CONSTRAINT' },
  // US hyperscalers
  { match: /\b(microsoft|msft)\b/i, ticker: 'MSFT', region: 'US', category: 'COMPUTE_CONSTRAINT' },
  { match: /\b(amazon|aws)\b/i,     ticker: 'AMZN', region: 'US', category: 'COMPUTE_CONSTRAINT' },
  { match: /\b(google|alphabet|googl)\b/i, ticker: 'GOOGL', region: 'US', category: 'COMPUTE_CONSTRAINT' },
  { match: /\b(meta|facebook)\b/i,  ticker: 'META', region: 'US', category: 'COMPUTE_CONSTRAINT' },
  // India defense — careful word boundaries
  { match: /\b(hal|hindustan aeronautics)\b/i, ticker: 'HAL',     region: 'IN', category: 'DEFENSE_SUPPLY' },
  { match: /\b(bel|bharat electronics)\b/i,    ticker: 'BEL',     region: 'IN', category: 'DEFENSE_SUPPLY' },
  { match: /\b(bdl|bharat dynamics)\b/i,       ticker: 'BDL',     region: 'IN', category: 'DEFENSE_SUPPLY' },
  { match: /\bbeml\b/i,                        ticker: 'BEML',    region: 'IN', category: 'DEFENSE_SUPPLY' },
  { match: /\bmazagon dock\b/i,                ticker: 'MAZAGON', region: 'IN', category: 'DEFENSE_SUPPLY' },
  { match: /\bcochin shipyard\b/i,             ticker: 'COCHINSHIP', region: 'IN', category: 'DEFENSE_SUPPLY' },
  { match: /\b(grse|garden reach)\b/i,         ticker: 'GRSE',    region: 'IN', category: 'DEFENSE_SUPPLY' },
  // India power / structural
  { match: /\bbhel\b/i,                        ticker: 'BHEL',    region: 'IN', category: 'POWER_CONSTRAINT' },
  { match: /\bnpcil\b/i,                       ticker: 'NPCIL',   region: 'IN', category: 'POWER_CONSTRAINT' },
  { match: /\bbhavini\b/i,                     ticker: 'BHAVINI', region: 'IN', category: 'POWER_CONSTRAINT' },
  { match: /\bntpc\b/i,                        ticker: 'NTPC',    region: 'IN', category: 'POWER_CONSTRAINT' },
  { match: /\bnhpc\b/i,                        ticker: 'NHPC',    region: 'IN', category: 'POWER_CONSTRAINT' },
  { match: /\bpower grid corp\b/i,             ticker: 'POWERGRID', region: 'IN', category: 'POWER_CONSTRAINT' },
  { match: /\bcoal india\b/i,                  ticker: 'COALINDIA', region: 'IN', category: 'POWER_CONSTRAINT' },
  // India semiconductor / EMS
  { match: /\b(tata electronics|tata semiconductor)\b/i, ticker: 'TATAELXSI', region: 'IN', category: 'COMPUTE_CONSTRAINT' },
  { match: /\bkaynes (technology)?\b/i,        ticker: 'KAYNES',  region: 'IN', category: 'COMPUTE_CONSTRAINT' },
  { match: /\bsyrma sgs\b/i,                   ticker: 'SYRMA',   region: 'IN', category: 'COMPUTE_CONSTRAINT' },
  { match: /\bdixon (technologies)?\b/i,       ticker: 'DIXON',   region: 'IN', category: 'COMPUTE_CONSTRAINT' },
  { match: /\b(micron gujarat|micron.{0,10}gujarat)\b/i, ticker: 'MU', region: 'IN', category: 'COMPUTE_CONSTRAINT' },
  // India industrials
  { match: /\b(l&t|larsen ?\&? ?toubro)\b/i,   ticker: 'LT',      region: 'IN', category: 'POWER_CONSTRAINT' },
  // India energy
  { match: /\breliance industries\b/i,         ticker: 'RELIANCE', region: 'IN', category: 'ENERGY_CONSTRAINT' },
  { match: /\bioc\b/i,                         ticker: 'IOC',     region: 'IN', category: 'ENERGY_CONSTRAINT' },
  { match: /\bbpcl\b/i,                        ticker: 'BPCL',    region: 'IN', category: 'ENERGY_CONSTRAINT' },
  { match: /\bhpcl\b/i,                        ticker: 'HPCL',    region: 'IN', category: 'ENERGY_CONSTRAINT' },
  { match: /\bongc\b/i,                        ticker: 'ONGC',    region: 'IN', category: 'ENERGY_CONSTRAINT' },
];

// ─── Source credibility weights ────────────────────────────────────────────
// Replaces the brittle FEED_BOTTLENECK_DENYLIST with a multiplier. The
// classifier still fires on any feed; the credibility multiplier shapes
// final consequence/importance scores so good reporting from any source
// can surface, but low-credibility takes get downweighted.

interface SourceCredibility {
  pattern: RegExp;        // matched against feed.name
  factor: number;         // multiplier applied to consequence_score
  bottleneck_anchor_required: boolean;  // require strong anchor for BOTTLENECK escalation
}

const SOURCE_CREDIBILITY: SourceCredibility[] = [
  // PRIMARY institutional reporting — full weight
  { pattern: /^(reuters|bloomberg news|wsj|wall street journal|financial times|ft markets|economic times|business standard|mint|moneycontrol)$/i, factor: 1.10, bottleneck_anchor_required: false },
  // STRONG specialist trade press — full weight, but anchor required
  { pattern: /^(semiwiki|tom's hardware|tomshardware|the register|ars technica|blocks & files|power technology)$/i, factor: 1.0, bottleneck_anchor_required: true },
  // CNBC / FT Markets / SeekingAlpha — strong but mixed quality, anchor required
  { pattern: /^(cnbc|cnbc top news|cnbc world|cnbc technology|cnbc finance|seeking alpha market news|barron's|investing\.com news|techcrunch|yahoo finance)$/i, factor: 0.85, bottleneck_anchor_required: true },
  // OPINION / SEO-heavy — discount
  { pattern: /^(marketwatch|marketwatch top stories|fool|zacks)$/i, factor: 0.55, bottleneck_anchor_required: true },
  // Editorial — discount but pass through to commentary tier
  { pattern: /^(barron's|forbes|fortune|bloomberg opinion)$/i, factor: 0.70, bottleneck_anchor_required: true },
  // Bloomberg lifestyle / video bucket — heavy discount
  { pattern: /^(bloomberg politics|bloomberg markets|bloomberg this weekend)$/i, factor: 0.40, bottleneck_anchor_required: true },
  // Filing-only / regulatory
  { pattern: /^(bse corp announcements|sebi press releases|nse announcements)$/i, factor: 0.30, bottleneck_anchor_required: true },
  // NDTV consumer / lifestyle
  { pattern: /^(ndtv profit|livemint companies|livemint markets)$/i, factor: 0.65, bottleneck_anchor_required: true },
];

export function getSourceCredibility(feedName: string): { factor: number; bottleneck_anchor_required: boolean } {
  for (const sc of SOURCE_CREDIBILITY) {
    if (sc.pattern.test(feedName)) {
      return { factor: sc.factor, bottleneck_anchor_required: sc.bottleneck_anchor_required };
    }
  }
  return { factor: 0.85, bottleneck_anchor_required: true };  // unknown source defaults to mid-low
}

// ─── Resolution state detection ────────────────────────────────────────────
// EMERGING: "shortage starting", "first signs of"
// PERSISTENT: "remains tight", "continues", "still constrained"
// EASING: "easing", "ramp up", "expansion announced", "lead times shortening"
// RESOLVED: "resolved", "abundant", "back to normal", "supply restored"

const RESOLUTION_PATTERNS: Array<{ state: ResolutionState; pattern: RegExp; weight: number }> = [
  // RESOLVED
  { state: 'RESOLVED', pattern: /\b(supply (recover|normal|abundant|restored)|shortage (resolv|end)|capacity (caught up|matched)|back to (?:normal|equilibrium))\b/i, weight: 10 },
  // EASING
  { state: 'EASING', pattern: /\b(eas(?:e|ing|ed)|ramp(?:ing)? up|capacity (?:expansion|addition|increase|new fab)|production (ramp|start)|lead time (shorten|improv|shrink)|backlog (clear|reduc))\b/i, weight: 7 },
  { state: 'EASING', pattern: /\b(price (?:drop|decline|fall|ease|soften))\b.{0,40}\b(dram|nand|hbm|chip|memory|wafer)\b/i, weight: 6 },
  // EMERGING
  { state: 'EMERGING', pattern: /\b(first signs?|early (?:warning|indication)|starting to (?:tighten|constrain|run hot)|emerging|nascent|begin(?:s|ning) to)\b/i, weight: 6 },
  // PERSISTENT
  { state: 'PERSISTENT', pattern: /\b(remains? (?:constrained|tight|binding|stretched)|still (?:short|tight|constrained)|continues? to (?:tighten|stretch)|multi.?quarter (?:tight|short)|ongoing)\b/i, weight: 7 },
];

export function detectResolutionState(text: string): { state: ResolutionState; confidence: number } {
  const lower = text.toLowerCase();
  let best: { state: ResolutionState; weight: number } = { state: 'PERSISTENT', weight: 0 };
  for (const rp of RESOLUTION_PATTERNS) {
    if (rp.pattern.test(lower) && rp.weight > best.weight) {
      best = { state: rp.state, weight: rp.weight };
    }
  }
  // Default to PERSISTENT for confirmed bottleneck / EMERGING for new signals
  if (best.weight === 0) return { state: 'PERSISTENT', confidence: 50 };
  return { state: best.state, confidence: Math.min(95, best.weight * 12) };
}

// ─── Weighted anchor scoring ───────────────────────────────────────────────
// For an article to reach BOTTLENECK, the title must accumulate enough
// weighted anchor score. Title-position tokens count 2x; tokens inside
// summary (desc) count 1x. A companion regex is required for tokens that
// are too generic on their own.

export interface AnchorScore {
  total: number;                     // weighted sum
  title_score: number;               // tokens hit in title alone
  desc_score: number;                // tokens hit in desc only
  categories_hit: BottleneckCategory[]; // distinct categories matched
  primary_category: BottleneckCategory;
  entities: Array<{ ticker: string; region: 'IN'|'US'|'GLOBAL'; category: BottleneckCategory }>;
  // PATCH 1068 — open-vocabulary fallback. Set when an article shows the
  // theme-INDEPENDENT grammar of a bottleneck (scarcity language + a
  // structural subject) but matches NONE of the fixed category tokens above.
  // These are routed to a separate "Emerging structural signals" bucket so
  // genuinely novel themes surface without polluting the curated tiers.
  emerging?: boolean;
  emerging_label?: string;           // best-effort label for the constrained thing
  scarcity_score?: number;           // strength of the scarcity-language signal
}

// ─── PATCH 1068: open-vocabulary structural-scarcity detection ─────────────
// A bottleneck has a recognizable GRAMMAR of scarcity that is independent of
// the specific technology or material. Detecting that grammar (rather than a
// fixed token list) lets the engine surface FUTURE themes it has never seen —
// a new mineral, a new component, a new piece of infrastructure — instead of
// silently dropping them because no keyword matched.
const SCARCITY_LANG: RegExp[] = [
  /\b(shortage|scarcit\w+|sold out|out of stock|undersuppl\w+)\b/i,
  /\b(supply (crunch|gap|shortfall|constraint|tightness|deficit|squeeze))\b/i,
  /\b(capacity (constrain\w+|crunch|shortfall|limit\w*|tight|bottleneck))\b/i,
  /\blead[- ]?times?\b.{0,24}(extend|stretch|blow|ris\w+|long\w*|month|week|quarter)/i,
  /\b(back ?log|order book)\b.{0,24}(swell|surg\w+|balloon\w*|extend\w*|record|ris\w+|grow\w*)/i,
  /\b(allocation|rationing|on allocation|quota|export (ban|curb|restrict\w+))\b/i,
  /\bdemand\b.{0,24}(outstrip\w+|outpac\w+|exceed\w+|overwhelm\w+).{0,12}supply/i,
  /\b(can(?:no|')?t keep up|unable to meet demand|struggling to meet|cannot meet)\b/i,
  /\b(binding (constraint|bottleneck)|key bottleneck|critical bottleneck)\b/i,
  /\b(capex|capacity|production)\b.{0,24}(ramp|expansion|addition|build[- ]?out|doubl\w+)/i,
  /\b(constrain\w+|chok\w+|tight\w*|strain\w*)\b.{0,24}(supply|capacity|production|output|grid|network)/i,
  /\b(price\w*)\b.{0,16}(spike|surg\w+|soar\w+|jump\w*|rocket\w*).{0,24}(supply|shortage|demand|tight)/i,
];
// Broad "is this an industrial / hard-asset / tech / commodity / infra
// subject?" gate — intentionally generous so unknown FUTURE themes still pass.
const STRUCTURAL_SUBJECT = /\b(chip|semiconductor|wafer|fab|foundr\w+|memory|component\w*|equipment|machine\w*|tool\w*|material\w*|mineral\w*|metal\w*|alloy|rare ?earth|battery|cell|module|reactor|fuel|grid|power|electricity|transmission|transformer|turbine|cable|pipe\w*|steel|cement|chemical\w*|polymer|resin|gas|crude|oil|refin\w+|port|freight|container|shipping|logistic\w*|plant|factory|manufactur\w+|production|supply ?chain|fertilis\w+|fertiliz\w+|pharma\w*|vaccine|magnet\w*|silicon|glass|copper|alumin\w+|lithium|cobalt|nickel|uranium|graphite|sand|water|spectrum|bandwidth|satellite|launch|rocket|aircraft|engine|bearing|valve|pump|sensor)\b/i;

function scarcityScore(text: string): number {
  let s = 0;
  for (const re of SCARCITY_LANG) { if (re.test(text)) s += 4; }
  return s;
}
// Best-effort short label for the constrained subject (proper-noun phrase in
// the title, else the leading clause).
function emergingLabelFrom(title: string): string {
  const m = title.match(/\b([A-Z][a-zA-Z0-9-]+(?:\s+[A-Z][a-zA-Z0-9-]+){0,2})\b/);
  const raw = m ? m[1] : (title.split(/[—:|]/)[0] || title);
  return raw.trim().slice(0, 48);
}

const TITLE_WEIGHT_MULTIPLIER = 2.0;
const DESC_WEIGHT_MULTIPLIER = 1.0;

export function scoreAnchor(title: string, desc: string): AnchorScore {
  const titleLower = title.toLowerCase();
  const descLower = (desc || '').toLowerCase();
  const fullLower = titleLower + ' ' + descLower;

  let titleScore = 0;
  let descScore = 0;
  const categoryWeights: Partial<Record<BottleneckCategory, number>> = {};
  const entities: AnchorScore['entities'] = [];

  for (const tok of ALL_TOKENS) {
    const hitTitle = tok.pattern.test(title);
    const hitDesc = !hitTitle && tok.pattern.test(descLower);
    if (!hitTitle && !hitDesc) continue;

    // Companion check: if tok requires companion, ensure companion appears
    if (tok.companion && !tok.companion.test(fullLower)) continue;

    if (hitTitle) {
      titleScore += tok.weight * TITLE_WEIGHT_MULTIPLIER;
      categoryWeights[tok.category] = (categoryWeights[tok.category] || 0) + tok.weight * TITLE_WEIGHT_MULTIPLIER;
    } else if (hitDesc) {
      descScore += tok.weight * DESC_WEIGHT_MULTIPLIER;
      categoryWeights[tok.category] = (categoryWeights[tok.category] || 0) + tok.weight * DESC_WEIGHT_MULTIPLIER;
    }
  }

  // Entity extraction — title only (entities in summary aren't enough on their own)
  for (const ent of ENTITIES) {
    if (ent.match.test(title)) {
      entities.push({ ticker: ent.ticker, region: ent.region, category: ent.category });
      // Entity in title gives a hardcoded +6 anchor weight in its category
      titleScore += 12;   // 6 * title-multiplier 2
      categoryWeights[ent.category] = (categoryWeights[ent.category] || 0) + 12;
    }
  }

  const categoriesHit = (Object.keys(categoryWeights) as BottleneckCategory[]).filter(c => (categoryWeights[c] ?? 0) > 0);
  // Multi-category bonus: spanning >=2 categories = thematic depth
  const breadthBonus = categoriesHit.length >= 2 ? 4 : 0;
  const total = titleScore + descScore + breadthBonus;

  // Primary category = highest weight
  let primary: BottleneckCategory = 'NONE';
  let maxWeight = 0;
  for (const c of categoriesHit) {
    const w = categoryWeights[c] ?? 0;
    if (w > maxWeight) { maxWeight = w; primary = c; }
  }

  // PATCH 1068 — open-vocabulary fallback. Only when NO known category fired:
  // if the article speaks the grammar of scarcity AND has a structural subject,
  // flag it as an EMERGING theme (separate bucket downstream). This never
  // overrides a known-category decision, so existing tiers are unaffected.
  let emerging = false;
  let emerging_label: string | undefined;
  const scarcity = scarcityScore(fullLower);
  if (primary === 'NONE' && scarcity >= 8 && STRUCTURAL_SUBJECT.test(fullLower)) {
    emerging = true;
    emerging_label = emergingLabelFrom(title);
  }

  return {
    total,
    title_score: titleScore,
    desc_score: descScore,
    categories_hit: categoriesHit,
    primary_category: primary,
    entities,
    emerging,
    emerging_label,
    scarcity_score: scarcity,
  };
}

// Threshold above which an article is eligible to enter BOTTLENECK.
// Tuned empirically: a single high-weight token (HBM=8, COWOS=8, EUV=7)
// in the title gets 16/14 → above threshold.
// A weak token (memory weight 4) needs a companion + entity to clear.
export const BOTTLENECK_ANCHOR_THRESHOLD = 12;

// ─── Convenience: classify category from title+desc + sub-tag ─────────────

export function inferBottleneckCategory(args: {
  bottleneck_sub_tag?: string | null;
  anchor: AnchorScore;
}): BottleneckCategory {
  if (args.anchor.primary_category !== 'NONE') return args.anchor.primary_category;
  // Map legacy sub-tag → category
  const sub = args.bottleneck_sub_tag || '';
  if (sub === 'MEMORY_STORAGE' || sub === 'FABRICATION_PACKAGING' || sub === 'INTERCONNECT_PHOTONICS' || sub === 'COMPUTE_SCALING') return 'COMPUTE_CONSTRAINT';
  if (sub === 'POWER_GRID' || sub === 'NUCLEAR_ENERGY' || sub === 'THERMAL_COOLING') return 'POWER_CONSTRAINT';
  if (sub === 'MATERIALS_SUPPLY') return 'MATERIAL_SCARCITY';
  return 'NONE';
}
