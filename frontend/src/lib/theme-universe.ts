// ═══════════════════════════════════════════════════════════════════════════
// THEME UNIVERSE (zzz480) — the map that powers the Theme Rotation dashboard.
//
// Each theme resolves to a PRICE SERIES the rotation engine can score:
//   • proxy  — a single liquid ETF (US) or NSE sector index (India). One Yahoo
//              fetch, always available, the preferred form.
//   • basket — a small equal-weight set of leaders, used ONLY where no clean
//              proxy exists (photonics, memory, India defence/railways/EMS…).
//              The engine builds a synthetic equal-weight index from them.
//
// Kept deliberately curated (a handful of leaders per basket) so the engine stays
// fast and rate-limit-safe. US symbols are bare; India symbols carry .NS for Yahoo.
// ═══════════════════════════════════════════════════════════════════════════

export type ThemeRegion = 'us' | 'india';

export interface ThemeDef {
  id: string;
  name: string;
  emoji: string;
  group: string;          // coarse bucket for grouping in the UI
  proxy?: string;         // Yahoo symbol of the ETF / index (preferred)
  basket?: string[];      // equal-weight leaders when no proxy exists
  note?: string;          // one-line what-this-is
}

// ─── UNITED STATES ─────────────────────────────────────────────────────────
export const US_THEMES: ThemeDef[] = [
  // Semis / hardware / AI compute
  { id: 'us-semis',        name: 'Semiconductors',      emoji: '🔩', group: 'AI & Compute', proxy: 'SOXX', note: 'Broad chip complex (iShares Semiconductor)' },
  { id: 'us-ai-hardware',  name: 'AI Hardware / Compute',emoji: '🧠', group: 'AI & Compute', basket: ['NVDA','AVGO','AMD','MRVL','TSM'], note: 'GPU / accelerator / foundry leaders' },
  { id: 'us-memory',       name: 'Memory',              emoji: '💾', group: 'AI & Compute', basket: ['MU','WDC','STX'], note: 'DRAM / NAND / HDD (HBM cycle)' },
  { id: 'us-photonics',    name: 'Photonics / Optical', emoji: '🔦', group: 'AI & Compute', basket: ['COHR','LITE','CIEN','AAOI'], note: 'Optical interconnect / co-packaged optics' },
  { id: 'us-datacenter',   name: 'Data-Center Power',   emoji: '⚡', group: 'AI & Compute', basket: ['VRT','GEV','ETN','PWR'], note: 'Power / cooling / grid build for AI DCs' },
  // Software
  { id: 'us-software',     name: 'Software / SaaS',     emoji: '💻', group: 'Software', proxy: 'IGV', note: 'Application + infra software (iShares Expanded Tech-Software)' },
  { id: 'us-cloud',        name: 'Cloud',               emoji: '☁️', group: 'Software', proxy: 'SKYY', note: 'Cloud computing (First Trust Cloud)' },
  { id: 'us-cyber',        name: 'Cybersecurity',       emoji: '🛡️', group: 'Software', proxy: 'CIBR', note: 'Cyber security (First Trust NASDAQ Cyber)' },
  { id: 'us-internet',     name: 'Internet',            emoji: '🌐', group: 'Software', proxy: 'FDN', note: 'Dow Jones Internet leaders' },
  { id: 'us-fintech',      name: 'Fintech',             emoji: '💳', group: 'Software', proxy: 'FINX', note: 'Global fintech (Global X)' },
  { id: 'us-quantum',      name: 'Quantum / Innovation',emoji: '🧬', group: 'Software', proxy: 'QTUM', note: 'Quantum + machine-learning compute (Defiance)' },
  // Energy / power / resources
  { id: 'us-energy',       name: 'Energy',              emoji: '🛢️', group: 'Energy & Resources', proxy: 'XLE', note: 'Oil & gas majors (Energy Select)' },
  { id: 'us-nuclear',      name: 'Nuclear / Uranium',   emoji: '☢️', group: 'Energy & Resources', proxy: 'URA', note: 'Uranium miners + nuclear fuel (Global X)' },
  { id: 'us-solar',        name: 'Solar / Clean',       emoji: '🔆', group: 'Energy & Resources', proxy: 'TAN', note: 'Solar (Invesco Solar)' },
  { id: 'us-critminerals', name: 'Critical Minerals',   emoji: '⛏️', group: 'Energy & Resources', proxy: 'REMX', note: 'Rare-earth & strategic metals (VanEck)' },
  { id: 'us-gold',         name: 'Gold Miners',         emoji: '🥇', group: 'Energy & Resources', proxy: 'GDX', note: 'Gold miners (VanEck)' },
  // Industrials / other
  { id: 'us-defense',      name: 'Defense / Aerospace', emoji: '✈️', group: 'Industrials & Cyclicals', proxy: 'ITA', note: 'Aerospace & defense (iShares)' },
  { id: 'us-robotics',     name: 'Robotics / Automation',emoji: '🤖', group: 'Industrials & Cyclicals', proxy: 'BOTZ', note: 'Robotics & AI (Global X)' },
  { id: 'us-biotech',      name: 'Biotech',             emoji: '🧪', group: 'Healthcare', proxy: 'XBI', note: 'Equal-weight biotech (SPDR)' },
  { id: 'us-homebuild',    name: 'Homebuilders',        emoji: '🏠', group: 'Industrials & Cyclicals', proxy: 'XHB', note: 'Homebuilders (SPDR)' },
  { id: 'us-regbanks',     name: 'Regional Banks',      emoji: '🏦', group: 'Financials', proxy: 'KRE', note: 'Regional banks (SPDR)' },
];

// Broad-market reference so the same tape regime is visible next to the themes.
export const US_BENCHMARK = { symbol: 'SPY', name: 'S&P 500' };

// ─── INDIA ─────────────────────────────────────────────────────────────────
// NSE sector indices resolve on Yahoo as ^CNX… / ^NSE…; finer themes with no
// index use small .NS baskets.
export const INDIA_THEMES: ThemeDef[] = [
  { id: 'in-it',           name: 'IT / SaaS',           emoji: '💻', group: 'Tech & New-Age', proxy: '^CNXIT', note: 'NIFTY IT' },
  { id: 'in-ems',          name: 'EMS / Electronics',   emoji: '🔌', group: 'Tech & New-Age', basket: ['DIXON.NS','KAYNES.NS','SYRMA.NS','CYIENTDLM.NS','AMBER.NS'], note: 'Electronics manufacturing services' },
  { id: 'in-defence',      name: 'Defence',             emoji: '🛡️', group: 'Capex & Strategic', basket: ['HAL.NS','BEL.NS','BDL.NS','MAZDOCK.NS','SOLARINDS.NS','COCHINSHIP.NS'], note: 'Defence indigenisation leaders' },
  { id: 'in-railways',     name: 'Railways',            emoji: '🚆', group: 'Capex & Strategic', basket: ['RVNL.NS','IRFC.NS','TITAGARH.NS','JWL.NS','RAILTEL.NS'], note: 'Rail modernisation' },
  { id: 'in-power',        name: 'Power / T&D',         emoji: '⚡', group: 'Capex & Strategic', basket: ['POWERGRID.NS','CGPOWER.NS','SIEMENS.NS','ABB.NS','TRANSFORMER.NS'], note: 'Power gen + transmission & distribution' },
  { id: 'in-capgoods',     name: 'Capital Goods',       emoji: '🏗️', group: 'Capex & Strategic', basket: ['LT.NS','BHEL.NS','THERMAX.NS','KEC.NS','KALPATPOWR.NS'], note: 'Engineering & capex cycle' },
  { id: 'in-energy',       name: 'Energy',              emoji: '🛢️', group: 'Energy & Materials', proxy: '^CNXENERGY', note: 'NIFTY Energy' },
  { id: 'in-metal',        name: 'Metals',              emoji: '⛏️', group: 'Energy & Materials', proxy: '^CNXMETAL', note: 'NIFTY Metal' },
  { id: 'in-chemicals',    name: 'Chemicals',           emoji: '🧪', group: 'Energy & Materials', basket: ['SRF.NS','PIIND.NS','DEEPAKNTR.NS','NAVINFLUOR.NS','AARTIIND.NS'], note: 'Specialty chemicals (China+1)' },
  { id: 'in-pharma',       name: 'Pharma',              emoji: '💊', group: 'Healthcare & Consumer', proxy: '^CNXPHARMA', note: 'NIFTY Pharma' },
  { id: 'in-fmcg',         name: 'FMCG',                emoji: '🛒', group: 'Healthcare & Consumer', proxy: '^CNXFMCG', note: 'NIFTY FMCG' },
  { id: 'in-auto',         name: 'Auto / EV',           emoji: '🚗', group: 'Healthcare & Consumer', proxy: '^CNXAUTO', note: 'NIFTY Auto' },
  { id: 'in-realty',       name: 'Realty',              emoji: '🏢', group: 'Financials & Rate-sensitive', proxy: '^CNXREALTY', note: 'NIFTY Realty' },
  { id: 'in-psubank',      name: 'PSU Banks',           emoji: '🏦', group: 'Financials & Rate-sensitive', proxy: '^CNXPSUBANK', note: 'NIFTY PSU Bank' },
  { id: 'in-bank',         name: 'Banks',               emoji: '🏛️', group: 'Financials & Rate-sensitive', proxy: '^NSEBANK', note: 'Bank NIFTY' },
  { id: 'in-finserv',      name: 'Financial Services',  emoji: '💳', group: 'Financials & Rate-sensitive', proxy: '^CNXFIN', note: 'NIFTY Financial Services' },
  { id: 'in-infra',        name: 'Infra',               emoji: '🛤️', group: 'Capex & Strategic', proxy: '^CNXINFRA', note: 'NIFTY Infra' },
  { id: 'in-pse',          name: 'PSE (PSU)',           emoji: '🏭', group: 'Capex & Strategic', proxy: '^CNXPSE', note: 'NIFTY PSE' },
  { id: 'in-datacenter',   name: 'Data Center',         emoji: '🖥️', group: 'Tech & New-Age', basket: ['ANANTRAJ.NS','NETWEB.NS','TATACOMM.NS','STLTECH.NS'], note: 'India data-center build-out' },
];

export const INDIA_BENCHMARK = { symbol: '^NSEI', name: 'NIFTY 50' };

export function themesForRegion(region: ThemeRegion): ThemeDef[] {
  return region === 'us' ? US_THEMES : INDIA_THEMES;
}
export function benchmarkForRegion(region: ThemeRegion) {
  return region === 'us' ? US_BENCHMARK : INDIA_BENCHMARK;
}
