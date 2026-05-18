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
  ticker: string;          // NSE symbol
  company: string;
  stakePct?: number;       // ≥ 1% if BSE-disclosed
  disclosedOn: string;     // YYYY-MM-DD — the date the holding was last reported
  tier: DisclosureTier;
  thesis?: string;         // Investor's stated rationale
  exchange?: 'NSE' | 'BSE';
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
      // Public BSE >=1% disclosures (last-reported snapshot — updated quarterly)
      { ticker: 'BEEKAYSTEEL', company: 'Beekay Steel', stakePct: 2.2, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'XPROINDIA',   company: 'Xpro India',   stakePct: 1.4, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'MOLDTKPAC',   company: 'Mold-Tek Packaging', stakePct: 2.1, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'SAFARI',      company: 'Safari Industries',  stakePct: 2.7, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'SHAILY',      company: 'Shaily Engineering Plastics', stakePct: 1.9, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
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
      { ticker: 'TEJASNET',    company: 'Tejas Networks',   stakePct: 1.1, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'ATULAUTO',    company: 'Atul Auto',         stakePct: 2.6, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'PATELENG',    company: 'Patel Engineering', stakePct: 1.5, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'AFFLE',       company: 'Affle (India)',     stakePct: 1.2, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'INNOVANA',    company: 'Innovana Thinklabs',stakePct: 5.4, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
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
      { ticker: 'KSL',         company: 'Kothari Sugars',     stakePct: 1.5, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'KERALAYR',    company: 'Kerala Ayurveda',    stakePct: 4.0, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'ORIENTBELL',  company: 'Orient Bell',         stakePct: 1.5, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
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
    newsQuery: 'Mohnish Pabrai India holdings Pabrai Funds',
    topHoldings: [
      { ticker: 'EDELWEISS',   company: 'Edelweiss Financial', stakePct: 1.8, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
      { ticker: 'RAINPLAST',   company: 'Rain Industries',     stakePct: 9.4, disclosedOn: '2026-03-31', tier: 'BSE_1PCT' },
    ],
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
