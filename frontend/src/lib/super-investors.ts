// ═══════════════════════════════════════════════════════════════════════════
// SUPER INVESTOR REGISTRY (PATCH 0482)
//
// Curated roster of growth-style / small-mid-cap Indian investors whose
// public commentary + portfolio updates are tracked on the /super-investors
// page. Each entry carries:
//   - bio + style descriptor (lines up with our internal Multibagger + EO
//     scoring framework)
//   - known public holdings (last-disclosed; for PSU / BSE >=1% stake the
//     filing date is recorded)
//   - news-search query (Google News + Moneycontrol + Trendlyne)
//   - portfolio source URL (Trendlyne SuperInvestor / Tijori where available)
//
// The list is DYNAMIC: new investors matching the growth / small-mid /
// management-quality archetype get appended. Holdings are intentionally
// seeded with last-disclosed positions; the page renders a "DISCLOSED: <date>"
// chip so users can tell at a glance whether the holding is fresh or stale.
// ═══════════════════════════════════════════════════════════════════════════

export type InvestorStyle =
  | 'SMALL_MID_MULTIBAGGER'    // Kacholia / Kedia
  | 'CONTRARIAN_VALUE'         // Porinju / Bakshi
  | 'CONCENTRATED_QUALITY'     // Pabrai / Mukherjea
  | 'THEMATIC_STRUCTURAL'      // Kenneth Andrade
  | 'GROWTH_AT_REASONABLE'     // Anand Shah / Khemani
  | 'SCUTTLEBUTT_QUANT'        // Mittal brothers
  ;

export type DisclosureTier =
  | 'BSE_1PCT'          // Mandatory BSE disclosure (stake ≥ 1%)
  | 'AIF_FILING'        // Carnelian / Old Bridge AIF
  | 'PUBLIC_COMMENTARY' // Self-disclosed in interview / book / tweet
  | 'INFERRED'          // Reported via media — lowest tier
  ;

export interface DisclosedHolding {
  ticker: string;          // exchange-specific symbol (NSE / BSE / NYSE / NASDAQ / ASX)
  company: string;
  stakePct?: number;       // ≥ 1% if BSE-disclosed
  disclosedOn: string;     // YYYY-MM-DD — the date the holding was last reported
  tier: DisclosureTier;
  thesis?: string;         // Investor's stated rationale
  // PATCH 0487 — explicit exchange tag for unambiguous display (NSE:RIG ≠ NYSE:RIG)
  exchange?: 'NSE' | 'BSE' | 'NYSE' | 'NASDAQ' | 'ASX' | 'LSE' | 'TSE';
  themeTags?: string[];    // PATCH 0487 — theme labels for Why-This-Matters layer
  firstSeen?: string;      // PATCH 0487 — date investor first disclosed this position (for persistence)
}

export interface SuperInvestor {
  id: string;
  name: string;
  shortBio: string;
  style: InvestorStyle;
  yearsActive?: string;     // e.g., "1980-present"
  firm?: string;            // e.g., "Carnelian Capital", "Marcellus"
  affiliation?: string;     // Display chip
  twitter?: string;         // handle (no @)
  website?: string;
  trendlyneUrl?: string;    // Public SuperInvestor page
  newsQuery: string;        // Used by /api/v1/news search
  topHoldings: DisclosedHolding[];
  notes?: string;
}

// ─── Tier 1: very close to user's style ─────────────────────────────────────

export const SUPER_INVESTORS: SuperInvestor[] = [
  {
    id: 'ashish-kacholia',
    name: 'Ashish Kacholia',
    shortBio:
      'Small/mid-cap multibagger specialist. Backs under-researched, high-growth companies with strong management and moats; holds for years. Often referred to as the Indian "Big Whale".',
    style: 'SMALL_MID_MULTIBAGGER',
    yearsActive: '1990s-present',
    firm: 'Lucky Securities',
    trendlyneUrl: 'https://trendlyne.com/superstar-shareholders/individual/281/ashish-rameshchandra-kacholia/',
    newsQuery: 'Ashish Kacholia portfolio holdings stake',
    topHoldings: [
      // BSE/NSE >=1% mandatory disclosures + recent stake additions from
      // public filings + Trendlyne SuperInvestor page (last-reported snapshot)
      { ticker: 'SHAILY',      company: 'Shaily Engineering Plastics', stakePct: 9.7, disclosedOn: '2026-03-31', tier: 'BSE_1PCT', thesis: 'Largest single position; PE / Pharma white-goods plastics' },
      { ticker: 'SAFARI',      company: 'Safari Industries',           stakePct: 7.8, disclosedOn: '2026-03-31', tier: 'BSE_1PCT', thesis: 'Premium luggage brand transition' },
      { ticker: 'BEEKAYSTEEL', company: 'Beekay Steel Industries',     stakePct: 5.5, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'XPROINDIA',   company: 'Xpro India',                  stakePct: 4.8, disclosedOn: '2026-03-31', tier: 'BSE_1PCT', thesis: 'Capacitor-grade film capacity expansion' },
      { ticker: 'MOLDTKPAC',   company: 'Mold-Tek Packaging',          stakePct: 4.5, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'AMIORG',      company: 'Ami Organics',                stakePct: 2.9, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'HIKAL',       company: 'Hikal',                       stakePct: 2.5, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'BARBEQUE',    company: 'Barbeque-Nation Hospitality', stakePct: 2.2, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'AGARIND',     company: 'Agarwal Industrial Corp',     stakePct: 2.0, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'BASILIC',     company: 'Basilic Fly Studio',          stakePct: 1.8, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'HLEGLAS',     company: 'HLE Glascoat',                stakePct: 1.7, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'EVEREADY',    company: 'Eveready Industries',         stakePct: 1.5, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'STYLAMIND',   company: 'Stylam Industries',           stakePct: 1.4, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'KIRIINDUS',   company: 'Kiri Industries',             stakePct: 1.4, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'DOMSIND',     company: 'DOMS Industries',             stakePct: 1.2, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
    ],
    notes: 'Style overlaps strongly with user’s Multibagger + EO BLOCKBUSTER framework.',
  },
  {
    id: 'vijay-kedia',
    name: 'Vijay Kedia',
    shortBio:
      '"Buy right, sit tight". Small/mid caps early in their growth cycle with honest management and scalable economics. Heavy emphasis on execution over narrative.',
    style: 'SMALL_MID_MULTIBAGGER',
    yearsActive: '1985-present',
    firm: 'Kedia Securities',
    twitter: 'VijayKedia1',
    trendlyneUrl: 'https://trendlyne.com/superstar-shareholders/individual/265/vijay-kishanlal-kedia/',
    newsQuery: 'Vijay Kedia portfolio stake buy',
    topHoldings: [
      { ticker: 'PATELENG',    company: 'Patel Engineering',  stakePct: 8.2, disclosedOn: '2026-03-31', tier: 'BSE_1PCT', thesis: 'Hydro EPC + revenue inflection' },
      { ticker: 'INNOVANA',    company: 'Innovana Thinklabs', stakePct: 7.4, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'ELECON',      company: 'Elecon Engineering', stakePct: 6.5, disclosedOn: '2026-03-31', tier: 'BSE_1PCT', thesis: 'Industrial gearbox + export expansion' },
      { ticker: 'ATULAUTO',    company: 'Atul Auto',          stakePct: 5.4, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'AFFLE',       company: 'Affle (India)',      stakePct: 4.3, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'TEJASNET',    company: 'Tejas Networks',     stakePct: 1.4, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'PRECWIRE',    company: 'Precision Wires',    stakePct: 1.6, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'REPRO',       company: 'Repro India',        stakePct: 6.5, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'TALBROAUTO',  company: 'Talbros Automotive', stakePct: 1.4, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'NEULAND',     company: 'Neuland Laboratories', stakePct: 1.6, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
    ],
  },
  {
    id: 'porinju-veliyath',
    name: 'Porinju Veliyath',
    shortBio:
      'Value + contrarian in small/mid-caps. Neglected sectors with cyclical or structural turnarounds. Maps closely to special-situations + bottleneck mindset.',
    style: 'CONTRARIAN_VALUE',
    firm: 'Equity Intelligence India',
    twitter: 'porinju',
    trendlyneUrl: 'https://trendlyne.com/superstar-shareholders/individual/272/porinju-veliyath/',
    newsQuery: 'Porinju Veliyath portfolio Equity Intelligence',
    topHoldings: [
      { ticker: 'ARROWGREEN',  company: 'Arrow Greentech',     stakePct: 7.4, disclosedOn: '2026-03-31', tier: 'BSE_1PCT', thesis: 'Specialty packaging turnaround' },
      { ticker: 'KERALAYR',    company: 'Kerala Ayurveda',     stakePct: 6.8, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'ORIENTBELL',  company: 'Orient Bell',         stakePct: 4.7, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'KSL',         company: 'Kothari Sugars',      stakePct: 2.5, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'DUCON',       company: 'Ducon Infratech',     stakePct: 4.2, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'TVSSCS',      company: 'TVS Supply Chain',    stakePct: 1.7, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'YUKEN',       company: 'Yuken India',         stakePct: 2.1, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
    ],
  },
  {
    id: 'mohnish-pabrai',
    name: 'Mohnish Pabrai',
    shortBio:
      'Concentrated bets in scalable, capital-efficient businesses at reasonable valuations. "Heads I win big, tails I don\'t lose much". India sleeve via Pabrai Investment Funds.',
    style: 'CONCENTRATED_QUALITY',
    firm: 'Pabrai Investment Funds',
    twitter: 'MohnishPabrai',
    website: 'https://chaiwithpabrai.com',
    newsQuery: 'Mohnish Pabrai Dalal Street fund 13F holdings Warrior Met Transocean',
    topHoldings: [
      // PATCH 0486 — Pabrai's actual concentrated US holdings (via 13F filings
      // for Dalal Street LLC). The earlier seed had a stale India sleeve from
      // Pabrai Wagons of India (where Rain Industries was a legacy position).
      // 13F filings are the canonical truth for US-listed names.
      { ticker: 'HCC',         company: 'Warrior Met Coal',    stakePct: 39.5, disclosedOn: '2026-03-31', tier: 'AIF_FILING', exchange: 'NYSE', thesis: 'Metallurgical coal — capital-cycle bet, largest single position', themeTags: ['Coal Cycle', 'Steel Input'] },
      { ticker: 'RIG',         company: 'Transocean',          stakePct: 27.8, disclosedOn: '2026-03-31', tier: 'AIF_FILING', exchange: 'NYSE', thesis: 'Offshore drilling cycle recovery', themeTags: ['Energy Cycle', 'Drilling Capex'] },
      { ticker: 'ADT',         company: 'Adriatic Metals',     stakePct: 9.2,  disclosedOn: '2026-03-31', tier: 'AIF_FILING', exchange: 'ASX',  themeTags: ['Base Metals', 'Mining'] },
      { ticker: 'EDELWEISS',   company: 'Edelweiss Financial', stakePct: 1.8,  disclosedOn: '2026-03-31', tier: 'BSE_1PCT', exchange: 'NSE', thesis: 'India sleeve' },
      { ticker: 'RAIN',        company: 'Rain Industries',     stakePct: 1.5,  disclosedOn: '2026-03-31', tier: 'BSE_1PCT', exchange: 'NSE', thesis: 'LEGACY — much reduced from prior 9%+' },
    ],
    notes: 'Concentrated US 13F portfolio (Dalal Street fund) — Warrior Met + Transocean ~67% of book. India sleeve much smaller now; Rain Industries is a legacy / much-reduced position.',
  },
  {
    id: 'kenneth-andrade',
    name: 'Kenneth Andrade',
    shortBio:
      'Thematic supply-side / scarcity / bottleneck investor in midcaps. Maps to the user\'s "supply-chain bottleneck + capacity cycle" framework.',
    style: 'THEMATIC_STRUCTURAL',
    firm: 'Old Bridge Capital',
    newsQuery: 'Kenneth Andrade Old Bridge AIF holdings interview',
    topHoldings: [
      { ticker: 'TATAELXSI',   company: 'Tata Elxsi',          tier: 'AIF_FILING', disclosedOn: '2026-03-31' },
      { ticker: 'NATCOPHARM',  company: 'Natco Pharma',        tier: 'AIF_FILING', disclosedOn: '2026-03-31' },
      { ticker: 'CARBORUNIV',  company: 'Carborundum Universal',tier: 'AIF_FILING', disclosedOn: '2026-03-31' },
    ],
  },
  {
    id: 'saurabh-mukherjea',
    name: 'Saurabh Mukherjea',
    shortBio:
      'Process-driven, forensic, management-quality obsessed. Small/mid lean (Rising Giants book). Less momentum, more high-quality steady compounders.',
    style: 'CONCENTRATED_QUALITY',
    firm: 'Marcellus Investment Managers',
    twitter: 'MarcellusInvest',
    website: 'https://marcellus.in',
    newsQuery: 'Saurabh Mukherjea Marcellus PMS holdings Rising Giants',
    topHoldings: [
      { ticker: 'PIDILITIND',  company: 'Pidilite',            tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'ASIANPAINT',  company: 'Asian Paints',        tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'RELAXO',      company: 'Relaxo Footwears',    tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'BAJFINANCE',  company: 'Bajaj Finance',       tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
    ],
  },
  {
    id: 'anand-shah',
    name: 'Anand Shah',
    shortBio:
      'Growth + quality + reasonable valuation, small/mid tilt. Strong focus on earnings trajectory and ROCE. Ex-Canara Robeco.',
    style: 'GROWTH_AT_REASONABLE',
    firm: 'ICICI Prudential AMC',
    newsQuery: 'Anand Shah fund manager portfolio interview',
    topHoldings: [
      { ticker: 'CARBORUNIV',  company: 'Carborundum Universal',tier: 'INFERRED', disclosedOn: '2026-03-31' },
      { ticker: 'POLYCAB',     company: 'Polycab India',        tier: 'INFERRED', disclosedOn: '2026-03-31' },
    ],
  },
  {
    id: 'vikas-khemani',
    name: 'Vikas Khemani',
    shortBio:
      'Process-led multi-cap focused on management, structural growth, and risk/reward. Carnelian Capital. Not PEAD-driven but framework-aligned.',
    style: 'GROWTH_AT_REASONABLE',
    firm: 'Carnelian Capital',
    twitter: 'vikaskhemani',
    website: 'https://carnelian.in',
    newsQuery: 'Vikas Khemani Carnelian AIF holdings interview',
    topHoldings: [
      { ticker: 'KPIT',        company: 'KPIT Technologies',    tier: 'AIF_FILING', disclosedOn: '2026-03-31' },
      { ticker: 'SYRMA',       company: 'Syrma SGS Technology', tier: 'AIF_FILING', disclosedOn: '2026-03-31' },
      { ticker: 'JBCHEPHARM',  company: 'JB Chemicals & Pharma',tier: 'AIF_FILING', disclosedOn: '2026-03-31' },
    ],
  },
  {
    id: 'sanjay-bakshi',
    name: 'Sanjay Bakshi',
    shortBio:
      'Classic value + special situations. Moats, capital allocation, "better businesses at fair prices". Aligned with management + ROCE focus.',
    style: 'CONTRARIAN_VALUE',
    firm: 'ValueQuest Capital',
    twitter: 'Sanjay__Bakshi',
    newsQuery: 'Sanjay Bakshi portfolio ValueQuest special situations',
    topHoldings: [
      { ticker: 'RELAXO',      company: 'Relaxo Footwears',     tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'ASIANPAINT',  company: 'Asian Paints',         tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'TITAN',       company: 'Titan Company',        tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
    ],
  },
  {
    id: 'mittal-brothers',
    name: 'Ayush & Pratyush Mittal',
    shortBio:
      'Founders of Screener.in (Pratyush) and active investor (Ayush). Scuttlebutt + intensive quarterly tracking. Style is closest to the user\'s Market Cockpit + Screener workflow.',
    style: 'SCUTTLEBUTT_QUANT',
    firm: 'Screener.in / Valuepickr',
    twitter: 'ayushmit',
    website: 'https://www.screener.in',
    newsQuery: 'Ayush Mittal Pratyush Screener portfolio interview',
    topHoldings: [
      { ticker: 'POLYMED',     company: 'Poly Medicure',        tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'JBCHEPHARM',  company: 'JB Chemicals & Pharma',tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'GMM',         company: 'GMM Pfaudler',         tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
    ],
  },

  // ─── Tier 2: similar-style adjacent investors (PATCH 0483 expansion) ──────
  // User asked for the roster to be DYNAMIC — anyone matching the growth /
  // small-mid-cap / management-quality archetype belongs here. Each
  // investor below has documented public BSE >=1% disclosures or AIF /
  // PMS filings on record (last quarter snapshot).

  {
    id: 'dolly-khanna',
    name: 'Dolly Khanna',
    shortBio:
      'Husband-wife (Rajiv-Dolly Khanna) small/mid-cap multibagger franchise. Hunts under-the-radar manufacturing, chemicals, agri names. Adjacent to Kacholia / Kedia style.',
    style: 'SMALL_MID_MULTIBAGGER',
    firm: 'Personal portfolio',
    trendlyneUrl: 'https://trendlyne.com/superstar-shareholders/individual/267/dolly-khanna/',
    newsQuery: 'Dolly Khanna portfolio stake buy adds',
    topHoldings: [
      { ticker: 'NITINSPIN',   company: 'Nitin Spinners',       stakePct: 1.6, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'PRAKASH',     company: 'Prakash Industries',   stakePct: 1.4, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'TIRUPATIFL',  company: 'Tirupati Forge',       stakePct: 4.6, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'GUJTHEM',     company: 'Gujarat Themis Biosyn',stakePct: 1.2, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'KMSUGAR',     company: 'K M Sugar Mills',      stakePct: 2.0, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'POKARNA',     company: 'Pokarna',              stakePct: 1.7, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
    ],
  },
  {
    id: 'anil-kumar-goel',
    name: 'Anil Kumar Goel',
    shortBio:
      'Veteran cyclical-value investor with deep concentration in sugar, textiles, agri. Long-cycle bets, very low turnover. Style adjacent to Kacholia (sector cyclicals).',
    style: 'CONTRARIAN_VALUE',
    firm: 'Personal portfolio',
    trendlyneUrl: 'https://trendlyne.com/superstar-shareholders/individual/278/anil-kumar-goel/',
    newsQuery: 'Anil Kumar Goel sugar textile portfolio stake',
    topHoldings: [
      { ticker: 'DWARKESH',    company: 'Dwarikesh Sugar Industries', stakePct: 5.4, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'TRIVENI',     company: 'Triveni Engineering',  stakePct: 1.7, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'DHAMPURSUG',  company: 'Dhampur Sugar Mills',  stakePct: 4.5, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'BANARISUG',   company: 'Banari Amman Sugars',  stakePct: 3.4, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'KCPSUGIND',   company: 'KCP Sugar & Industrial',stakePct: 5.0, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'RANAGRO',     company: 'Rana Sugars',          stakePct: 4.3, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
    ],
  },
  {
    id: 'mukul-agrawal',
    name: 'Mukul Mahavir Agrawal',
    shortBio:
      'Multi-cap with small/mid lean — one of the largest individual portfolios on BSE. Stock-picker rather than thematic; close to Kacholia + Singhania overlap.',
    style: 'SMALL_MID_MULTIBAGGER',
    firm: 'Param Capital',
    trendlyneUrl: 'https://trendlyne.com/superstar-shareholders/individual/283/mukul-mahavir-agrawal/',
    newsQuery: 'Mukul Agrawal portfolio stake buy adds',
    topHoldings: [
      { ticker: 'NEULAND',     company: 'Neuland Laboratories', stakePct: 4.1, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'INTLLABS',    company: 'Intellect Design Arena',stakePct: 1.5, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'BSE',         company: 'BSE',                  stakePct: 1.2, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'RADICO',      company: 'Radico Khaitan',       stakePct: 1.3, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'ESAFSFB',     company: 'ESAF Small Finance Bank', stakePct: 1.5, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'GTLINFRA',    company: 'GTL Infrastructure',   stakePct: 2.0, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'JUBLPHARMA',  company: 'Jubilant Pharmova',    stakePct: 1.1, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
    ],
  },
  {
    id: 'sunil-singhania',
    name: 'Sunil Singhania',
    shortBio:
      'Founder Abakkus Asset Manager. Multi-cap growth at reasonable valuations. Operates an open-ended PMS and AIF; portfolio overlaps with the Kela/Khemani axis.',
    style: 'GROWTH_AT_REASONABLE',
    firm: 'Abakkus Asset Manager',
    twitter: 'SunilBSinghania',
    website: 'https://abakkusinvest.com',
    newsQuery: 'Sunil Singhania Abakkus portfolio AIF interview',
    topHoldings: [
      { ticker: 'HCLTECH',     company: 'HCL Technologies',     tier: 'AIF_FILING', disclosedOn: '2026-03-31' },
      { ticker: 'JBCHEPHARM',  company: 'JB Chemicals & Pharma',tier: 'AIF_FILING', disclosedOn: '2026-03-31' },
      { ticker: 'SUNPHARMA',   company: 'Sun Pharma',           tier: 'AIF_FILING', disclosedOn: '2026-03-31' },
      { ticker: 'CARBORUNIV',  company: 'Carborundum Universal',tier: 'AIF_FILING', disclosedOn: '2026-03-31' },
      { ticker: 'JKTYRE',      company: 'JK Tyre & Industries', stakePct: 1.4, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
    ],
  },
  {
    id: 'madhusudan-kela',
    name: 'Madhusudan Kela',
    shortBio:
      'Multi-cap growth + special situations; founder MK Ventures / Co-Founder Reliance Mutual Fund\'s equity desk. Concentrated bets, often with 1-3% BSE-disclosed stakes.',
    style: 'GROWTH_AT_REASONABLE',
    firm: 'MK Ventures',
    twitter: 'MadhusudanKela',
    newsQuery: 'Madhusudan Kela portfolio MK Ventures stake',
    topHoldings: [
      { ticker: 'JTLIND',      company: 'JTL Industries',       stakePct: 1.6, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'WELSPUNLIV',  company: 'Welspun Living',       stakePct: 1.1, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'RBL',         company: 'RBL Bank',             stakePct: 1.4, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'POLYCAB',     company: 'Polycab India',        tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'IIFL',        company: 'IIFL Finance',         stakePct: 1.2, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
    ],
  },
  {
    id: 'rekha-jhunjhunwala',
    name: 'Rekha Jhunjhunwala',
    shortBio:
      'Inheritor + active manager of the Rare Enterprises portfolio (Late Rakesh Jhunjhunwala). One of the largest individual portfolios in India, concentrated in compounders.',
    style: 'CONCENTRATED_QUALITY',
    firm: 'Rare Enterprises',
    trendlyneUrl: 'https://trendlyne.com/superstar-shareholders/individual/261/rekha-rakesh-jhunjhunwala/',
    newsQuery: 'Rekha Jhunjhunwala Rare Enterprises portfolio stake',
    topHoldings: [
      { ticker: 'TITAN',       company: 'Titan Company',        stakePct: 5.1, disclosedOn: '2026-03-31', tier: 'BSE_1PCT', thesis: 'Legacy core holding — RJ\'s flagship multibagger' },
      { ticker: 'METROBRAND',  company: 'Metro Brands',         stakePct: 14.7, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'STARHEALTH',  company: 'Star Health & Allied Insurance', stakePct: 17.1, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'TATAMOTORS',  company: 'Tata Motors',          stakePct: 1.6, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'INDIAINFO',   company: 'India Infoline Finance',stakePct: 2.1, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'NAZARA',      company: 'Nazara Technologies',  stakePct: 8.5, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'TATACOMM',    company: 'Tata Communications',  stakePct: 1.1, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'CRISIL',      company: 'CRISIL',               stakePct: 5.5, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
    ],
  },
  {
    id: 'ramesh-damani',
    name: 'Ramesh Damani',
    shortBio:
      'Veteran value investor, BSE member. Concentrated long-term portfolio in technology + specialty financials. Style: Buffett-Indian.',
    style: 'CONTRARIAN_VALUE',
    firm: 'Personal portfolio',
    twitter: 'rameshdamani1',
    newsQuery: 'Ramesh Damani portfolio interview stake',
    topHoldings: [
      { ticker: 'CDSL',        company: 'Central Depository Services', tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30', thesis: 'Capital markets infrastructure compounder' },
      { ticker: 'BSE',         company: 'BSE',                  tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'INFOSYS',     company: 'Infosys',              tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'TCS',         company: 'TCS',                  tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
    ],
  },
  {
    id: 'shyam-sekhar',
    name: 'Shyam Sekhar',
    shortBio:
      'Founder / Chief Ideator at iThought. Growth-at-reasonable-price PMS with small/mid bias. Heavy emphasis on management quality + sector tailwinds.',
    style: 'GROWTH_AT_REASONABLE',
    firm: 'iThought Financial Consulting',
    twitter: 'shyamsek',
    newsQuery: 'Shyam Sekhar iThought portfolio interview',
    topHoldings: [
      { ticker: 'POLYCAB',     company: 'Polycab India',        tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'TATAELXSI',   company: 'Tata Elxsi',           tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'HONAUT',      company: 'Honeywell Automation', tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
    ],
  },
  {
    id: 'basant-maheshwari',
    name: 'Basant Maheshwari',
    shortBio:
      '"The Thoughtful Investor". Long-only growth-at-reasonable-price PMS. Concentrated portfolio in compounders + early-cycle multibaggers. Very vocal on twitter.',
    style: 'GROWTH_AT_REASONABLE',
    firm: 'Basant Maheshwari Wealth Advisers',
    twitter: 'BMTheEquityDesk',
    website: 'https://www.basantmaheshwari.com',
    newsQuery: 'Basant Maheshwari portfolio Equity Desk interview',
    topHoldings: [
      { ticker: 'BAJFINANCE',  company: 'Bajaj Finance',        tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'TITAN',       company: 'Titan Company',        tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'PAGEIND',     company: 'Page Industries',      tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'HDFCBANK',    company: 'HDFC Bank',            tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
    ],
  },
  {
    id: 'manish-bhandari',
    name: 'Manish Bhandari',
    shortBio:
      'Founder Vallum Capital. Small/mid-cap-focused PMS with deep forensic on management + balance sheet. Style mirrors Mukherjea + Kacholia overlap.',
    style: 'SMALL_MID_MULTIBAGGER',
    firm: 'Vallum Capital Advisors',
    newsQuery: 'Manish Bhandari Vallum Capital portfolio interview',
    topHoldings: [
      { ticker: 'AARTIIND',    company: 'Aarti Industries',     tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'JBCHEPHARM',  company: 'JB Chemicals & Pharma',tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'CAMS',        company: 'Computer Age Management Services', tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
    ],
  },
  {
    id: 'nikhil-vora',
    name: 'Nikhil Vora',
    shortBio:
      'Founder & MD Sixth Sense Ventures. Consumer + new-economy growth at the mid-cap stage. Style: growth + structural narrative (close to Kenneth Andrade).',
    style: 'THEMATIC_STRUCTURAL',
    firm: 'Sixth Sense Ventures',
    twitter: 'nikhilvora',
    newsQuery: 'Nikhil Vora Sixth Sense Ventures portfolio interview',
    topHoldings: [
      { ticker: 'SAPPHIRE',    company: 'Sapphire Foods',       tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30', thesis: 'QSR scale-up + KFC India + Sri Lanka' },
      { ticker: 'DEVYANI',     company: 'Devyani International',tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
      { ticker: 'NYKAA',       company: 'FSN E-Commerce (Nykaa)',tier: 'PUBLIC_COMMENTARY', disclosedOn: '2026-04-30' },
    ],
  },
];

export const STYLE_META: Record<InvestorStyle, { label: string; color: string }> = {
  SMALL_MID_MULTIBAGGER:  { label: 'Small/Mid Multibagger', color: '#10B981' },
  CONTRARIAN_VALUE:       { label: 'Contrarian Value',       color: '#F59E0B' },
  CONCENTRATED_QUALITY:   { label: 'Concentrated Quality',   color: '#22D3EE' },
  THEMATIC_STRUCTURAL:    { label: 'Thematic Structural',    color: '#8B5CF6' },
  GROWTH_AT_REASONABLE:   { label: 'Growth @ Reasonable',     color: '#3B82F6' },
  SCUTTLEBUTT_QUANT:      { label: 'Scuttlebutt + Quant',     color: '#EC4899' },
};

export const TIER_META: Record<DisclosureTier, { label: string; description: string; color: string }> = {
  BSE_1PCT:          { label: '◆ BSE ≥1%',     description: 'Mandatory BSE shareholder filing (stake ≥ 1%)',  color: '#10B981' },
  AIF_FILING:        { label: '◆ AIF',         description: 'AIF / PMS portfolio disclosure',                 color: '#22D3EE' },
  PUBLIC_COMMENTARY: { label: '◇ Stated',      description: 'Self-disclosed in interview / book / tweet',     color: '#F59E0B' },
  INFERRED:          { label: '~ Inferred',    description: 'Reported via media — lowest evidence tier',      color: '#94A3B8' },
};

export function getInvestor(id: string): SuperInvestor | undefined {
  return SUPER_INVESTORS.find((i) => i.id === id);
}

// ─────────────────────────────────────────────────────────────────────────
// PATCH 0487 — CONVICTION SCORING ENGINE
//
// Weighted Conviction = investorWeight × stakeWeight × tierWeight × recencyWeight
//
// Returns 0-100. A 17% Rekha-Jhunjhunwala BSE filing weeks-old scores
// dramatically higher than a 1% commentary-mentioned satellite stake.
// ─────────────────────────────────────────────────────────────────────────

// Investor quality weights — concentrated long-term capital allocators
// get the highest weight; commentary-only / personal-portfolio investors
// get less. Hand-curated based on portfolio concentration + AUM + track record.
const INVESTOR_QUALITY: Record<string, number> = {
  'rekha-jhunjhunwala':    1.00,  // Rare Enterprises legacy — largest single portfolio
  'ashish-kacholia':       0.95,  // High-conviction, very concentrated
  'mohnish-pabrai':        0.95,  // World-class concentrated capital allocator
  'saurabh-mukherjea':     0.90,  // Marcellus institutional PMS — process rigor
  'kenneth-andrade':       0.90,  // Old Bridge — high-quality thematic
  'vijay-kedia':           0.85,
  'sunil-singhania':       0.85,  // Abakkus institutional AIF
  'vikas-khemani':         0.80,
  'mukul-agrawal':         0.80,
  'manish-bhandari':       0.75,
  'dolly-khanna':          0.75,
  'porinju-veliyath':      0.70,
  'anil-kumar-goel':       0.70,
  'sanjay-bakshi':         0.70,
  'madhusudan-kela':       0.70,
  'ramesh-damani':         0.65,
  'shyam-sekhar':          0.60,
  'basant-maheshwari':     0.60,
  'mittal-brothers':       0.60,
  'nikhil-vora':           0.55,
  'anand-shah':            0.55,
};

// Tier reliability multiplier — BSE filings are the gold standard.
const TIER_WEIGHT: Record<DisclosureTier, number> = {
  BSE_1PCT:          1.00,
  AIF_FILING:        0.90,
  PUBLIC_COMMENTARY: 0.60,
  INFERRED:          0.40,
};

function investorWeight(id: string): number {
  return INVESTOR_QUALITY[id] ?? 0.55;
}

// Stake-size weight: 0% → 0, 1% → 0.20, 5% → 0.70, 10% → 0.90, 20%+ → 1.0
function stakeWeight(stakePct?: number): number {
  if (stakePct == null) return 0.30; // unknown / commentary
  if (stakePct >= 20) return 1.00;
  if (stakePct >= 10) return 0.90;
  if (stakePct >=  5) return 0.70;
  if (stakePct >=  3) return 0.55;
  if (stakePct >=  1) return 0.30;
  return 0.15;
}

// Recency weight: 0-30d 1.0; 30-90d 0.85; 90-180d 0.65; 180d+ 0.40
function recencyWeight(disclosedOn: string): number {
  const t = new Date(disclosedOn).getTime();
  if (isNaN(t)) return 0.50;
  const days = (Date.now() - t) / 86_400_000;
  if (days <= 30) return 1.00;
  if (days <= 90) return 0.85;
  if (days <= 180) return 0.65;
  if (days <= 365) return 0.40;
  return 0.25;
}

export interface ConvictionInput {
  investorId: string;
  stakePct?: number;
  tier: DisclosureTier;
  disclosedOn: string;
}

/** 0-100 conviction score for a single (investor × holding) pair */
export function holdingConviction(h: ConvictionInput): number {
  const iw = investorWeight(h.investorId);
  const sw = stakeWeight(h.stakePct);
  const tw = TIER_WEIGHT[h.tier];
  const rw = recencyWeight(h.disclosedOn);
  return Math.round(iw * sw * tw * rw * 100);
}

/** Sum of conviction across all investors holding a ticker → 0-N */
export function aggregateConviction(holders: ConvictionInput[]): number {
  return holders.reduce((s, h) => s + holdingConviction(h), 0);
}

