// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { type FeedLayer, type DrilldownEntry } from './types';

// Additive priority bump applied when an article's tickers intersect the
// user's "book" (held ∪ conviction bench ∪ watchlist). Bounded so it lifts a
// book name above equal-importance strangers without swamping the importance
// signal (a materially higher-importance non-book story can still outrank it).
export const BOOK_PRIORITY_BOOST = 6;
// ── Constants ─────────────────────────────────────────────────────────────────

export const REGIONS = ['ALL', 'IN', 'US'] as const;
export const TYPES   = ['ALL', 'BOTTLENECK', 'EARNINGS', 'RATING_CHANGE', 'MACRO', 'GEOPOLITICAL', 'TARIFF', 'CORPORATE', 'GENERAL'] as const;
export const SOURCES = [
  'ALL',
  // India
  'ET Markets', 'ET Industry', 'ET Economy', 'MoneyControl', 'LiveMint', 'Business Standard', 'BS Economy',
  'Yahoo Finance IN', 'PIB India', 'ElectronicsB2B', 'IBEF',
  // US / Global Macro
  'Yahoo Finance US', 'Yahoo Finance US Financials', 'CNBC', 'CNBC Tech', 'MarketWatch', 'Bloomberg', 'Reuters Finance',
  // Semiconductor & Supply Chain
  'SemiAnalysis', 'DigiTimes', 'EE Times', 'Semiconductor Engineering', 'IEEE Spectrum', 'Evertiq', 'SEMI',
  'Yahoo Tech Semis', 'Yahoo Data Center',
  // Hyperscaler / AI Infra
  'The Register', 'ServeTheHome', 'The Information', 'Techmeme',
  // Policy & Geopolitics
  'CSIS', 'Brookings',
] as const;
// Signal filter: maps to investment_tier (1=HIGH, 2=MEDIUM, 3=NOISE)
export const SIGNAL_FILTERS = [
  { value: 'ALL', label: 'All Signals', icon: '' },
  { value: 'HIGH', label: '🔴 High', icon: '🔴' },
  { value: 'MEDIUM', label: '🟡 Medium', icon: '🟡' },
  { value: 'LOW', label: '⚪ Low/Noise', icon: '⚪' },
] as const;
export const LAYER_CONFIG: Record<FeedLayer, { label: string; color: string; description: string }> = {
  MACRO_REGIME: { label: 'MACRO REGIME', color: '#DC2626', description: 'Liquidity, rates, commodities, geopolitical' },
  STRUCTURAL: { label: 'STRUCTURAL THEMES', color: '#8B5CF6', description: 'AI infrastructure, defense, energy, semiconductors' },
  COMPANY_ALPHA: { label: 'COMPANY ALPHA', color: '#0F7ABF', description: 'Earnings, contracts, guidance, M&A' },
  GENERAL: { label: 'MARKET INTEL', color: '#4A5B6C', description: 'Industry news & analysis' },
};
// ── Junk Filter ─────────────────────────────────────────────────────────────
// Filter out personal finance advice, political fluff, lifestyle, and clickbait
// that adds no value to an institutional-grade market dashboard.

export const JUNK_HEADLINE_PATTERNS = [
  // Personal finance / advice columns / family money
  /\bmy (friend|wife|husband|partner|adviser|advisor|dad|mom|brother|sister|boss|relative|daughter|son|parent)\b/i,
  /\b(should i buy|can i trust|is it worth|how much should|how to save|retirement plan|nest egg)\b/i,
  /\b(feels slimy|i'm worried|dear moneyist|ask an expert|money etiquette|who'?s right)\b/i,
  /\b(personal finance|side hustle|budgeting tip|credit score|credit card reward|savings account)\b/i,
  /\b(financial adviser|financial advisor|financial planner)\b/i,
  /\b(social security|medicare|medicaid)\s+(benefit|check|payment|tip|stolen)/i,
  /\bhas congress.*(stolen|raided).*social security/i,
  /\b(best (credit card|savings|cd rate|mortgage|insurance))\b/i,
  /\b(an? older relative|give my (daughter|son)|said no\. who)/i,

  // Stock-picking clickbait / promotion
  /\b(top .* analysts? like these dividend)\b/i,
  /\b(like these dividend stocks|solid returns)\b/i,
  /\bgot \$[\d,]+\?.*stocks?\b/i,                          // "Got $5,000? 2 Stocks..."
  /\bwall street is sleeping on\b/i,                        // "Wall Street Is Sleeping on This $13 Stock"
  /\bthe only stock .* (buying|selling)\b/i,                // "The Only Stock Buffett Is Buying"
  /\bcould handily outperform\b/i,
  /\bbuy it now\.?\s*$/i,                                   // headlines ending with "Buy It Now."
  /\b(is|are) built to profit\b/i,                          // "These 3 Energy Stocks Are Built to Profit"
  /\band that'?s your opportunity\b/i,                      // "and That's Your Opportunity"
  /\b(actually worth holding|worth holding\??)\b/i,         // "Is Vanguard's VOT Actually Worth Holding?"
  /\b(it'?s not too late to buy)\b/i,

  // ETF / fund promotion
  /\bthis .* etf is up \d+%/i,                             // "This Vanguard ETF Is up 33% YTD"
  /\b(massive upside|still has massive|has massive upside)\b/i,
  /\b\$[\d.]+ billion in assets and a [\d.]+% fee\b/i,     // "$31.7 Billion in Assets and a 0.05% Fee"
  /\bvanguard'?s (vo[a-z]|vt[a-z]|vf[a-z]|vs[a-z])\b/i,  // Vanguard ETF tickers like VOT, VTI etc.

  // Political fluff not market-related
  /\b(state rep|congressman|senator|governor|mayor)\s+(talk|speak|say|slam|push|defend)/i,
  /\bstaying disciplined on the issues\b/i,
  /\b(campaign trail|election rally|political rally|town hall meeting)\b/i,
  /\b(democrat|republican|gop|liberal|conservative)\s+(slam|attack|defend|push)/i,

  // Non-market news — science, NASA, lifestyle, sports
  /\bnasa\s+(prepares?|launches?|announces?|plans?)\b/i,
  /\b(celebrity|kardashian|oscars|grammy|super bowl|nfl draft|bachelor|bachelorette)\b/i,
  /\b(recipe|cooking tip|travel destination|vacation spot|weight loss|diet plan)\b/i,
  /\b(vibe coding|coding bootcamp|learn to code)\b/i,

  // Clickbait / hindsight / hypothetical returns
  /\b(you won't believe|shocking truth|one weird trick|doctors hate|this changes everything)\b/i,
  /\b(\d+ (things|ways|tips|reasons|secrets|mistakes))\s+(you|to|that|about)/i,
  /\b(ridiculously easy|simple trick|beat the .* experts?)\b/i,
  /\b(if you('d| had| would have)? (bought|invested))\b/i,
  /\b(would have made|could have made|you'd have made|you'd have today)\b/i,
  /\b(return you would|gains you missed|wish you had bought)\b/i,
  /\b(it might make you cry|spoiler:)\b/i,
  /\bhere'?s how much you'?d have\b/i,

  // Parenting / lifestyle / self-help disguised as news
  /\b(i've studied over \d+ kids|skill parents|parenting tip|teach kids)\b/i,
  /\b(no\.?\s*1 skill|number one skill|top skill)\s*(parents|kids|children)/i,
  /\b(can't look away|the case against social media)\b/i,
  /\b(work-life balance|quiet quitting|hustle culture|morning routine)\b/i,

  // Generic "3 big things" / roundups
  /\b\d+ big things we'?re watching\b/i,

  // "Investment opportunities in X" — generic filler
  /\binvestment opportunities in\b/i,
  // Restoration/trust in Congress — political
  /\brestore trust.*congress\b/i,
  /\bdecision making here in congress\b/i,
  // Visa vs Mastercard type comparison articles
  /\bvisa vs\.?\s*mastercard\b/i,
  /\b(which one to own|here'?s which one)\b/i,
  // "Thinking Small" motivational / Jeff Bezos quotes
  /\b(self-fulfilling prophecy|overestimate risk|underestimate opportunity)\b/i,
  // Generic Warren Buffett clickbait
  /\bwarren buffett\b.*\b(buying|selling|loaded up|dumped|poured)\b/i,

  // Retail tips / penny stock noise (India-specific)
  /\b(under ₹|under rs\.?\s*)\d+/i,
  /\bpenny stock/i,
  /\bstocks? to (buy|sell|watch) (on|this) (monday|tuesday|wednesday|thursday|friday)/i,
  /\bjewellery stock to watch/i,
  /\brecommends? (three|two|five|3|2|5) stocks?\b/i,
  // Removed: /\b(buy or sell):?\s/i — killed legitimate analyst rating articles

  // Listicle investing clickbait with specific % claims
  // NOTE: removed "soars/surge/jump X%" — this killed legitimate news like
  // "TSMC revenue surges 35%". Kept only specific clickbait patterns.
  /\b\d+ (supercharged|unstoppable|incredible|explosive) .* stock/i,
  /\bultra-high-yielding dividend/i,
  /\bload up on these \d/i,
  /\bbetter (space|tech|ai) stock:/i,

  // Bank holidays / calendar filler
  /\bbank holiday/i,

  // Lifestyle / trivia
  /\b(pokémon|pokemon|logan paul)\b/i,
  /\bviral food trend/i,

  // PATCH 0289 — Block consumer-deal noise (audit IMP-01). Tom's Hardware
  // bundle deals were leaking into the BOTTLENECK feed and destroying trust.
  /\bsave \$[\d,]+\s+on\b/i,                               // 'Save $210 on...'
  /\b(bundle|combo)\s+(deal|offer|that includes)/i,         // bundle deals
  /\b(coupon code|promo code|discount code|use code)\b/i,
  /\b(prime day|black friday|cyber monday|cyber week)\b/i,
  /\b(best buy|deal of the day|today'?s deal)\b/i,
  /\b\d+%\s+off\b/i,                                        // '25% off'
  /\bgrab .* (for|at) \$[\d,]+/i,                           // 'grab a... for $X'
  /\b(samsung|corsair|logitech|sandisk|wd|western digital)\s+(ssd|nvme|ram|memory|keyboard|mouse|monitor)\s+(bundle|deal|discount)/i,
];
export const JUNK_SOURCE_PATTERNS = [
  /moneyist/i,
  // Removed: yahoo finance us financials, yahoo tech semis — killed entire sources
];
// PATCH 0569 (UX #4) — Inline +Watch button on news cards. Adds the first
// ticker symbol on the article to `mc_watchlist_tickers` so the user can go
// from a news headline to a tracked ticker without leaving the page. We
// only wire the *first* symbol to keep the click cheap; multi-symbol adds
// stay the watchlist page's job.
// PATCH 0571 — Preserve the raw array form on write so untouched tickers
// keep their original case. Earlier Patch-0569 version round-tripped
// everything through a uppercased Set, silently normalising the entire
// watchlist on every click; harmless functionally but surprising for any
// downstream reader that depended on the user's original casing.
export const NEWS_WATCHLIST_KEY = 'mc_watchlist_tickers';
/** Full-screen article detail overlay — shows when user clicks a news card. */
// PATCH 0233 — Thesis Notebooks v0.
// Free-text notes saved per article in localStorage under
// 'mc:notes:v1:<article_id>'. Survives page refresh, syncs cross-tab.
// Real version (per-user notebooks server-side, @-mentions, version history)
// requires Auth + notes table — frontend-only v0 here.
export const NOTE_KEY_PREFIX = 'mc:notes:v1:';
// PATCH 0551 — AUDIT_100 #9 bounded growth.  Sidecar index tracking last-write
// per note id so we can evict oldest when count exceeds the cap.  Without
// this, mc:notes:v1:<id> grew unbounded across every news article the user
// ever opened, eventually blowing past the 5 MB localStorage quota and
// silently breaking subsequent writes across the app.
export const NOTE_META_KEY = 'mc:notes:meta:v1';
export const NOTE_MAX = 200;
export const BOTTLENECK_DRILLDOWN: Record<string, DrilldownEntry> = {
  MEMORY_STORAGE: {
    label: 'Memory & Storage',
    icon: '🧠',
    why: 'HBM and enterprise DRAM/NAND capacity is sold out through 2026. Every hyperscaler GPU needs 6-8 stacks of HBM3E; capacity additions lag GPU demand by 18-24 months.',
    supply: 'Only 3 HBM producers (SK Hynix, Samsung, Micron). Capex cycles are 2-3 years. Yield on HBM3E is structurally below DDR5.',
    demand: 'Every Blackwell GPU consumes 8× HBM3E stacks. Inference clusters need 3-5× the memory footprint of training. Demand growing ~60% YoY.',
    winners: [
      { ticker: '000660.KS', thesis: 'SK Hynix: HBM share leader, 50%+ of supply' },
      { ticker: 'MU', thesis: 'Micron: HBM3E ramp, capex leverage' },
      { ticker: '005930.KS', thesis: 'Samsung: HBM3E qualification gating catch-up' },
    ],
    losers: [
      { ticker: 'NVDA', thesis: 'Margin pressure as HBM costs stay elevated' },
      { ticker: 'META', thesis: 'Capex inflation on memory-heavy training clusters' },
    ],
  },
  INTERCONNECT_PHOTONICS: {
    label: 'Interconnect & Photonics',
    icon: '💡',
    why: 'Copper interconnects hit bandwidth walls at 224 Gbps SerDes. Co-packaged optics and silicon photonics are the only path to 1.6T/3.2T fabrics for future AI factories.',
    supply: 'CPO supply chain immature: lasers, modulators, couplers bottlenecked at a handful of vendors. TSMC/Intel photonics integration still ramping.',
    demand: 'Every rack-scale AI system (NVL72, Trainium3) needs 10-100× more optical transceivers than prior generations. Hyperscaler buys locked through 2027.',
    winners: [
      { ticker: 'COHR', thesis: 'Coherent: datacenter transceivers, VCSEL supply' },
      { ticker: 'LITE', thesis: 'Lumentum: indium phosphide lasers for CPO' },
      { ticker: 'AVGO', thesis: 'Broadcom: Tomahawk 5 switches + CPO reference design' },
      { ticker: 'MRVL', thesis: 'Marvell: 800G/1.6T DSPs, custom silicon' },
    ],
    losers: [],
  },
  FABRICATION_PACKAGING: {
    label: 'Advanced Fabrication & Packaging',
    icon: '🏭',
    why: 'CoWoS advanced packaging at TSMC is the single-point bottleneck for every leading-edge AI accelerator. Capacity doubles every 18 months but demand outpaces it.',
    supply: 'TSMC CoWoS-L/S capacity: ~35K wpm in 2024, ~70K wpm targeted 2026. Intel Foveros and Samsung I-Cube still sub-scale. ASML High-NA EUV gating N2/A16 ramp.',
    demand: 'Nvidia alone consumes 60%+ of CoWoS. AMD MI300/MI350, AWS Trainium, Google TPU all share remaining supply. Demand growing 80%+ YoY.',
    winners: [
      { ticker: 'TSM', thesis: 'TSMC: monopoly on advanced packaging, CoWoS pricing power' },
      { ticker: 'ASML', thesis: 'ASML: sole EUV/High-NA supplier, 2-year backlog' },
      { ticker: 'AMAT', thesis: 'Applied Materials: advanced packaging tools' },
      { ticker: 'LRCX', thesis: 'Lam Research: etch and deposition for N2/A16' },
    ],
    losers: [
      { ticker: 'INTC', thesis: 'Intel Foundry behind on advanced packaging ramp' },
    ],
  },
  COMPUTE_SCALING: {
    label: 'Compute & GPU Allocation',
    icon: '⚡',
    why: 'GPU supply remains rationed by Nvidia. H100/H200 allocation is relationship-driven, Blackwell ramp gated by CoWoS. Tier-2 clouds and enterprises wait 6-12 months.',
    supply: 'Nvidia ships what TSMC packages. MI300X/MI325X are the only meaningful alternative; TPU/Trainium captive to respective hyperscalers.',
    demand: 'Hyperscaler AI capex ~$300B/yr, projected $450B+ in 2026. Sovereign AI funds, neoclouds, enterprise inference all competing for allocation.',
    winners: [
      { ticker: 'NVDA', thesis: 'Nvidia: allocation monopoly, 75%+ gross margin' },
      { ticker: 'AMD', thesis: 'AMD: MI series captures tier-2 demand' },
      { ticker: 'AVGO', thesis: 'Broadcom: custom ASIC (Google TPU, Meta MTIA)' },
    ],
    losers: [
      { ticker: 'CRWV', thesis: 'Neoclouds dependent on NVDA allocation' },
    ],
  },
  POWER_GRID: {
    label: 'Power & Grid Constraints',
    icon: '🔌',
    why: 'Data center power demand outpaces grid interconnect timelines by 3-7 years. Transformer, switchgear, and HV cable lead times are 80-130 weeks.',
    supply: 'Only 3 major transformer OEMs globally. Grain-oriented electrical steel (GOES) constrained. Utility interconnect queues span 5-10 years in PJM/ERCOT.',
    demand: 'AI data center nameplate demand: 50 GW US by 2030 (Goldman, EPRI). Hyperscaler site selection now power-first, real-estate second.',
    winners: [
      { ticker: 'GEV', thesis: 'GE Vernova: grid equipment, transformers' },
      { ticker: 'ETN', thesis: 'Eaton: switchgear, UPS, electrical backbone' },
      { ticker: 'VRT', thesis: 'Vertiv: power/cooling for data centers' },
      { ticker: 'ABB.SW', thesis: 'ABB: transformers, HV switchgear' },
      { ticker: 'SU.PA', thesis: 'Schneider Electric: grid + DC power distribution' },
    ],
    losers: [],
  },
  NUCLEAR_ENERGY: {
    label: 'Nuclear Energy',
    icon: '☢️',
    why: 'Hyperscalers pivoting to nuclear PPAs for 24/7 carbon-free baseload. SMRs and restart of retired plants are the only gigawatt-scale path this decade.',
    supply: 'Enriched uranium supply constrained post-Russia sanctions. Centrus and Urenco ramping HALEU slowly. SMR deployments 2028-2032.',
    demand: 'MSFT/Three Mile Island, AMZN/Talen, GOOG/Kairos, META/SMR RFP — every hyperscaler has inked nuclear deals. India targeting 100 GW by 2047.',
    winners: [
      { ticker: 'CCJ', thesis: 'Cameco: uranium mining leader' },
      { ticker: 'LEU', thesis: 'Centrus: HALEU enrichment monopoly' },
      { ticker: 'VST', thesis: 'Vistra: nuclear fleet + AI hyperscaler PPAs' },
      { ticker: 'CEG', thesis: 'Constellation: Three Mile Island restart, MSFT PPA' },
      { ticker: 'TLN', thesis: 'Talen: Susquehanna nuclear + AWS deal' },
      { ticker: 'NPCIL', thesis: 'NPCIL (India): 100 GW target by 2047' },
    ],
    losers: [],
  },
  THERMAL_COOLING: {
    label: 'Thermal & Cooling',
    icon: '❄️',
    why: 'Blackwell and beyond require direct-to-chip liquid cooling. Retrofit is impractical; new builds are 100% liquid-cooled. CDU and cold-plate supply sold out.',
    supply: 'CoolIT, Motivair, Boyd, Asetek are the main CDU vendors. Cold plate supply concentrated in Taiwan.',
    demand: 'NVL72 racks = 120+ kW/rack. Every new AI data center must deploy liquid cooling. Retrofit-ability is becoming CIO top-3 concern.',
    winners: [
      { ticker: 'VRT', thesis: 'Vertiv: liquid cooling + power thermal management' },
      { ticker: 'SMCI', thesis: 'Supermicro: liquid-cooled rack integration' },
      { ticker: 'ETN', thesis: 'Eaton: thermal electrical infrastructure' },
    ],
    losers: [],
  },
  MATERIALS_SUPPLY: {
    label: 'Critical Materials',
    icon: '⛏️',
    why: 'Gallium, germanium, neon, rare earths, and high-purity quartz gating semi and defense supply chains. China export controls accelerating bifurcation.',
    supply: 'China controls 80%+ of gallium/germanium processing, 90%+ of rare earth refining. Alternative supply 3-7 years out.',
    demand: 'AI, defense, EV, and renewable electrification all drawing from same materials stack. Demand growing 2-3× by 2030.',
    winners: [
      { ticker: 'MP', thesis: 'MP Materials: US rare earth independence' },
      { ticker: 'LYC.AX', thesis: 'Lynas: ex-China rare earth processing' },
    ],
    losers: [],
  },
  QUANTUM_CRYOGENICS: {
    label: 'Quantum & Cryogenics',
    icon: '🧊',
    why: 'Quantum hardware gated by dilution refrigerators, helium-3, and cryo electronics. Scale-up of logical qubits is the decade-long bottleneck.',
    supply: 'Bluefors, Oxford Instruments dominate dilution fridges. Helium-3 supply constrained by tritium decay chain.',
    demand: 'Sovereign quantum programs (US DOE, EU, China, India) + hyperscaler R&D (IBM, Google, MSFT, AMZN). Demand inelastic in near term.',
    winners: [
      { ticker: 'IBM', thesis: 'IBM: largest gate-based quantum fleet' },
      { ticker: 'RGTI', thesis: 'Rigetti: superconducting qubit IP' },
      { ticker: 'IONQ', thesis: 'IonQ: trapped-ion roadmap' },
    ],
    losers: [],
  },
};
// Persistent signal threshold: articles older than this but still ranked
// represent structural (non-news) constraints that won't resolve quickly.
export const PERSISTENT_DAYS = 30;
export const PERSISTENT_MS = PERSISTENT_DAYS * 24 * 60 * 60 * 1000;
export const SAVED_VIEWS_KEY = 'mc:saved-views:v1';
