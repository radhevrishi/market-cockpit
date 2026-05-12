// ═══════════════════════════════════════════════════════════════════════════
// LIVE INPUT COST → EQUITY TRANSMISSION ENGINE (PATCH 0096 / 0170)
//
// Tracks major commodity / currency moves and maps them to first-order
// equity impact via a static exposure matrix.
//
// GET /api/v1/transmission
//
// Pipeline:
//   1. Fetch spot/forward prices for: crude (CL=F), copper (HG=F), aluminum
//      (ALI=F), gold (GC=F), silver (SI=F), nat gas (NG=F), zinc (ZN=F),
//      iron ore proxy (X), USD/INR (INR=X), 10y Indian yield (proxy).
//   2. Compute 1d / 1w / 1m / 3m % changes.
//   3. Map each commodity → sector exposures (cost-driver -ve OR revenue-
//      driver +ve) → projected EBIT margin sensitivity.
//   4. Surface top movers + concrete ticker watchlists.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const YH = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface Commodity {
  symbol: string;          // Yahoo ticker; empty string = no Yahoo feed
  // PATCH 0248 — Multi-source fallback. When Yahoo fails (or symbol is empty)
  // the fetcher tries FMP next, then Alpha Vantage. If a commodity has NO
  // free public price source we leave both empty and the card surfaces as
  // 'manual feed' with drivers still visible.
  fmp_symbol?: string;     // FMP ticker (e.g. 'PAUSD' for palladium, 'BOUSD' soyoil)
  av_function?: string;    // Alpha Vantage commodity function (e.g. 'COPPER', 'BRENT')
  name: string;
  unit: string;
  category?: 'energy' | 'metals' | 'agri' | 'chemicals' | 'fx_rates' | 'ai_robotics' | 'nuclear' | 'rare_earths';
  bias_2026?: 'rising' | 'falling' | 'volatile' | 'stable';
  source_note?: string;
  drivers: {
    sector: string;
    sign: 1 | -1;
    sensitivity: 'high' | 'med' | 'low';
    sample_tickers: string[];
    pass_through_lag?: 'immediate' | '1Q' | '2Q' | '3Q+';
    pricing_power?: 'strong' | 'moderate' | 'weak';
    note?: string;
  }[];
}

// Curated exposure matrix — derived from sector-cost-of-goods structure and
// pricing power. Each commodity lists the SECTORS most exposed plus a handful
// of marquee Indian tickers in each sector.
const COMMODITIES: Commodity[] = [
  {
    symbol: 'CL=F', fmp_symbol: 'CLUSD', av_function: 'WTI',
    name: 'Crude Oil (WTI)', unit: '$/bbl',
    category: 'energy', bias_2026: 'rising',
    drivers: [
      { sector: 'Aviation',      sign: -1, sensitivity: 'high', sample_tickers: ['INDIGO', 'SPICEJET'] },
      { sector: 'Paints',        sign: -1, sensitivity: 'high', sample_tickers: ['ASIANPAINT', 'BERGEPAINT', 'KANSAINER'] },
      { sector: 'Tyres',         sign: -1, sensitivity: 'high', sample_tickers: ['MRF', 'APOLLOTYRE', 'CEATLTD', 'BALKRISIND'] },
      { sector: 'Refining',      sign: 1,  sensitivity: 'med',  sample_tickers: ['RELIANCE', 'BPCL', 'IOC', 'HINDPETRO', 'MRPL', 'CHENNPETRO'] },
      { sector: 'Petrochem',     sign: -1, sensitivity: 'high', sample_tickers: ['SRF', 'NAVINFLUOR', 'AARTIIND', 'GUJALKALI'] },
      { sector: 'Cement (kiln)', sign: -1, sensitivity: 'med',  sample_tickers: ['ULTRACEMCO', 'SHREECEM', 'AMBUJACEM', 'ACC'] },
      { sector: 'FMCG (logistics)', sign: -1, sensitivity: 'low', sample_tickers: ['HINDUNILVR', 'DABUR', 'GODREJCP'] },
    ],
  },
  {
    symbol: 'HG=F', fmp_symbol: 'HGUSD', av_function: 'COPPER',
    name: 'Copper', unit: '$/lb',
    category: 'metals', bias_2026: 'rising',
    drivers: [
      { sector: 'Copper miners',  sign: 1,  sensitivity: 'high', sample_tickers: ['HINDCOPPER', 'VEDL'] },
      { sector: 'Wires & Cables', sign: -1, sensitivity: 'high', sample_tickers: ['POLYCAB', 'KEI', 'HAVELLS', 'FINCABLES', 'RRKABEL'] },
      { sector: 'Capital Goods',  sign: -1, sensitivity: 'med',  sample_tickers: ['ABB', 'SIEMENS', 'BHEL'] },
      { sector: 'EV (BoM)',       sign: -1, sensitivity: 'med',  sample_tickers: ['TATAPOWER', 'TATAMOTORS'] },
    ],
  },
  {
    // PATCH 0247 — Yahoo ALI=F returns LME Aluminum in $/MT, not $/lb.
    // Per-pound would be ~$1.60; the ~$3,520 figure is per tonne.
    symbol: 'ALI=F', av_function: 'ALUMINUM',
    name: 'Aluminum', unit: '$/MT',
    category: 'metals', bias_2026: 'volatile',
    drivers: [
      { sector: 'Aluminum miners', sign: 1,  sensitivity: 'high', sample_tickers: ['HINDALCO', 'NATIONALUM', 'VEDL'] },
      { sector: 'Auto (lightweighting)', sign: -1, sensitivity: 'med', sample_tickers: ['MARUTI', 'TATAMOTORS', 'M&M'] },
      { sector: 'Packaging',       sign: -1, sensitivity: 'med',  sample_tickers: ['POLYPLEX', 'COSMOFILMS'] },
    ],
  },
  {
    symbol: 'GC=F', fmp_symbol: 'GCUSD',
    name: 'Gold', unit: '$/oz',
    category: 'metals', bias_2026: 'rising',
    drivers: [
      { sector: 'Jewellery',     sign: -1, sensitivity: 'high', sample_tickers: ['TITAN', 'KALYANKJIL', 'SENCO', 'PCJEWELLER'] },
      { sector: 'Bullion / Refining', sign: 1, sensitivity: 'high', sample_tickers: ['MMTC', 'RAJESHEXPO'] },
      { sector: 'Banks (gold loans)', sign: 1, sensitivity: 'med', sample_tickers: ['MANAPPURAM', 'MUTHOOTFIN', 'IIFLWAM'] },
    ],
  },
  {
    symbol: 'SI=F', fmp_symbol: 'SIUSD',
    name: 'Silver', unit: '$/oz',
    category: 'metals', bias_2026: 'rising',
    drivers: [
      { sector: 'Silver miners',  sign: 1,  sensitivity: 'high', sample_tickers: ['HINDZINC', 'VEDL'] },
      { sector: 'Solar panel (silver paste)', sign: -1, sensitivity: 'med', sample_tickers: ['WAAREEENER', 'PREMIERENE', 'TATAPOWER'] },
    ],
  },
  {
    symbol: 'INR=X', name: 'USD/INR', unit: '₹/$',
    category: 'fx_rates', bias_2026: 'volatile',
    drivers: [
      { sector: 'IT Services (USD revenue)', sign: 1,  sensitivity: 'high', sample_tickers: ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'LTIM', 'PERSISTENT', 'COFORGE', 'MPHASIS'] },
      { sector: 'Pharma (US generics)',      sign: 1,  sensitivity: 'high', sample_tickers: ['SUNPHARMA', 'DRREDDY', 'CIPLA', 'LUPIN', 'AUROPHARMA'] },
      { sector: 'Imported feedstock',         sign: -1, sensitivity: 'high', sample_tickers: ['BPCL', 'HINDUNILVR', 'BERGEPAINT', 'ASIANPAINT'] },
      { sector: 'Forex debt heavy',           sign: -1, sensitivity: 'med',  sample_tickers: ['INDIGO', 'TATASTEEL'] },
    ],
  },
  {
    symbol: 'NG=F', fmp_symbol: 'NGUSD', av_function: 'NATURAL_GAS',
    name: 'Natural Gas', unit: '$/MMBtu',
    category: 'energy', bias_2026: 'volatile',
    drivers: [
      { sector: 'City gas',        sign: -1, sensitivity: 'high', sample_tickers: ['IGL', 'MGL', 'GUJGASLTD', 'ADANIGAS', 'IRMENERGY'] },
      { sector: 'Fertilizers',     sign: -1, sensitivity: 'high', sample_tickers: ['CHAMBLFERT', 'COROMANDEL', 'GSFC', 'GNFC'] },
      { sector: 'Power generation', sign: -1, sensitivity: 'med', sample_tickers: ['NTPC', 'TATAPOWER'] },
    ],
  },
  {
    // PATCH 0247 — Yahoo ZN=F returns cents per pound (110¢ = $1.10/lb).
    symbol: 'ZN=F', name: 'Zinc', unit: '¢/lb',
    category: 'metals', bias_2026: 'volatile',
    drivers: [
      { sector: 'Zinc miners',    sign: 1,  sensitivity: 'high', sample_tickers: ['HINDZINC', 'VEDL'] },
      { sector: 'Galvanizing',    sign: -1, sensitivity: 'med',  sample_tickers: ['APLAPOLLO', 'TATASTEEL'] },
    ],
  },
  {
    symbol: '^TNX', name: '10Y US Yield', unit: '%',
    category: 'fx_rates',
    drivers: [
      { sector: 'Banks (NIM)',      sign: 1,  sensitivity: 'med', sample_tickers: ['HDFCBANK', 'ICICIBANK', 'AXISBANK', 'KOTAKBANK', 'SBIN'], pass_through_lag: '1Q', pricing_power: 'strong' },
      { sector: 'Realty (rates)',   sign: -1, sensitivity: 'high', sample_tickers: ['DLF', 'OBEROIRLTY', 'GODREJPROP', 'LODHA'], pass_through_lag: '2Q', pricing_power: 'moderate' },
      { sector: 'NBFC (cost-funds)', sign: -1, sensitivity: 'high', sample_tickers: ['BAJFINANCE', 'CHOLAFIN', 'AAVAS', 'CANFINHOME', 'PNBHOUSING'], pass_through_lag: '1Q', pricing_power: 'moderate' },
    ],
  },

  // ── PATCH 0240: New commodities ─────────────────────────────────────────
  // Indian-relevant raw materials called out by the institutional review:
  // edible oils (palm/soybean/sun), fertilizer inputs (phos acid, ammonia,
  // sulphur), chemical chain (naphtha → BTX → polymers), energy (coking
  // coal, thermal coal, petcoke), natural rubber, paper pulp, caustic / soda.
  // Plus AI/Robotics/Quantum/Nuclear strategic materials.
  // ───────────────────────────────────────────────────────────────────────

  // ── Agri / Edible Oils ─────────────────────────────
  {
    symbol: 'FCPO=F', name: 'Palm Oil (Bursa)', unit: 'MYR/MT',
    category: 'agri', bias_2026: 'volatile',
    source_note: 'India imports ~57% of edible oil demand; palm = largest single input for FMCG/QSR.',
    drivers: [
      { sector: 'FMCG / Soaps',     sign: -1, sensitivity: 'high', sample_tickers: ['HINDUNILVR', 'GODREJCP', 'JYOTHYLAB', 'GILLETTE'], pass_through_lag: '1Q', pricing_power: 'moderate' },
      { sector: 'Food processing',  sign: -1, sensitivity: 'high', sample_tickers: ['BRITANNIA', 'NESTLEIND', 'PATANJALI'], pass_through_lag: '1Q', pricing_power: 'moderate' },
      { sector: 'QSR / Bakeries',   sign: -1, sensitivity: 'high', sample_tickers: ['JUBLFOOD', 'WESTLIFE', 'DEVYANI'], pass_through_lag: '2Q', pricing_power: 'weak' },
      { sector: 'Palm growers',     sign: 1,  sensitivity: 'high', sample_tickers: ['GODREJAGRO', 'RUCHIRA'], pass_through_lag: 'immediate' },
    ],
  },
  {
    // PATCH 0247 — Yahoo ZL=F returns CBOT Soybean Oil in cents per pound
    // (Yahoo currency = 'USX'). 74.7¢/lb = $0.747/lb.
    symbol: 'ZL=F', fmp_symbol: 'BOUSD',
    name: 'Soybean Oil', unit: '¢/lb',
    category: 'agri', bias_2026: 'volatile',
    drivers: [
      { sector: 'FMCG (oil)',       sign: -1, sensitivity: 'high', sample_tickers: ['HINDUNILVR', 'MARICO', 'AWLAGRI'], pass_through_lag: '1Q', pricing_power: 'moderate' },
      { sector: 'Food / Restaurants', sign: -1, sensitivity: 'med', sample_tickers: ['JUBLFOOD', 'BRITANNIA', 'NESTLEIND'], pass_through_lag: '2Q', pricing_power: 'weak' },
    ],
  },
  {
    symbol: '', name: 'Sunflower Oil (India CIF)', unit: '$/MT',
    category: 'agri', bias_2026: 'volatile',
    source_note: 'No Yahoo feed — track via Solvent Extractors\' Assn India monthly reports.',
    drivers: [
      { sector: 'FMCG (oil)',       sign: -1, sensitivity: 'med',  sample_tickers: ['MARICO', 'HINDUNILVR', 'AWLAGRI'], pass_through_lag: '1Q', pricing_power: 'moderate' },
    ],
  },

  // ── Fertilizer Inputs (manual feed) ────────────────
  {
    symbol: '', name: 'Phosphoric Acid (India settlement)', unit: '$/t P2O5',
    category: 'chemicals', bias_2026: 'rising',
    source_note: 'Q2 2026 India settlement ~$1,360/t P2O5. Manual update from Argus / CRU.',
    drivers: [
      { sector: 'Fertilizers (P)',  sign: -1, sensitivity: 'high', sample_tickers: ['COROMANDEL', 'GSFC', 'CHAMBLFERT', 'PARADEEP', 'DEEPAKFERT'], pass_through_lag: '1Q', pricing_power: 'weak', note: 'Subsidy-sensitive margin pool.' },
    ],
  },
  {
    symbol: '', name: 'Ammonia (India port)', unit: '$/t',
    category: 'chemicals', bias_2026: 'rising',
    source_note: 'India port prices +41% from early-2026 levels per industry trackers.',
    drivers: [
      { sector: 'Fertilizers (N)',  sign: -1, sensitivity: 'high', sample_tickers: ['CHAMBLFERT', 'COROMANDEL', 'GSFC', 'GNFC', 'NFL'], pass_through_lag: 'immediate', pricing_power: 'weak' },
      { sector: 'Chemicals',        sign: -1, sensitivity: 'med',  sample_tickers: ['DEEPAKFERT', 'GNFC', 'NAVINFLUOR', 'AARTIIND'], pass_through_lag: '1Q', pricing_power: 'moderate' },
    ],
  },
  {
    symbol: '', name: 'Sulphur (India delivered)', unit: '$/t',
    category: 'chemicals', bias_2026: 'rising',
    source_note: 'Delivered sulphur to India ~+30% in early 2026.',
    drivers: [
      { sector: 'Fertilizers (DAP/SSP)', sign: -1, sensitivity: 'high', sample_tickers: ['COROMANDEL', 'PARADEEP', 'GSFC', 'GNFC', 'CHAMBLFERT'], pass_through_lag: 'immediate', pricing_power: 'weak' },
      { sector: 'Chemicals (sulfuric acid)', sign: -1, sensitivity: 'med',  sample_tickers: ['HINDCOPPER', 'GNFC', 'GHCL'], pass_through_lag: '1Q', pricing_power: 'moderate' },
    ],
  },

  // ── Chemicals: Petrochem chain (manual feed; crude-driven) ────────────
  {
    symbol: '', name: 'Naphtha (Singapore CFR)', unit: '$/t',
    category: 'chemicals', bias_2026: 'rising',
    source_note: 'Crude-linked feedstock — track via Platts Asian Naphtha.',
    drivers: [
      { sector: 'Petrochem feedstock', sign: -1, sensitivity: 'high', sample_tickers: ['RELIANCE', 'GAIL', 'BPCL', 'IOC'], pass_through_lag: '1Q', pricing_power: 'moderate' },
      { sector: 'Plastic processors',  sign: -1, sensitivity: 'high', sample_tickers: ['POLYPLEX', 'COSMOFILMS', 'JINDALPOLY'], pass_through_lag: '1Q', pricing_power: 'weak' },
    ],
  },
  {
    symbol: '', name: 'Benzene / Propylene / Ethylene', unit: '$/t',
    category: 'chemicals', bias_2026: 'rising',
    source_note: 'Petrochem intermediates — manual update from ICIS / Platts.',
    drivers: [
      { sector: 'Specialty Chemicals', sign: -1, sensitivity: 'high', sample_tickers: ['AARTIIND', 'NAVINFLUOR', 'SRF', 'GUJALKALI', 'PIIND', 'ATUL'], pass_through_lag: '1Q', pricing_power: 'strong' },
      { sector: 'Downstream Industrials', sign: -1, sensitivity: 'med',  sample_tickers: ['SUDARSCHEM', 'TATACHEM', 'GNFC'], pass_through_lag: '2Q', pricing_power: 'moderate' },
    ],
  },
  {
    symbol: '', name: 'PVC / PE / PP / PET / ABS', unit: '$/t',
    category: 'chemicals', bias_2026: 'rising',
    source_note: 'Polymer prices — Indian producers raised in 2026 amid feedstock tightness.',
    drivers: [
      { sector: 'PVC pipe makers',  sign: -1, sensitivity: 'high', sample_tickers: ['SUPREMEIND', 'ASTRAL', 'FINOLEXIND', 'PRINCEPIPE', 'APOLLOPIPE'], pass_through_lag: '1Q', pricing_power: 'moderate' },
      { sector: 'Packaging / Films', sign: -1, sensitivity: 'high', sample_tickers: ['POLYPLEX', 'COSMOFILMS', 'JINDALPOLY', 'UFLEX'], pass_through_lag: '1Q', pricing_power: 'weak' },
      { sector: 'Consumer durables',  sign: -1, sensitivity: 'med',  sample_tickers: ['BAJAJELEC', 'CROMPTON', 'WHIRLPOOL', 'TTKPRESTIG'], pass_through_lag: '2Q', pricing_power: 'moderate' },
      { sector: 'Polymer producers',  sign: 1,  sensitivity: 'high', sample_tickers: ['RELIANCE', 'GAIL', 'HALDYN'], pass_through_lag: 'immediate' },
    ],
  },
  {
    symbol: '', name: 'Caustic Soda / Soda Ash', unit: '$/t',
    category: 'chemicals', bias_2026: 'volatile',
    drivers: [
      { sector: 'Chemicals (caustic)', sign: 1,  sensitivity: 'high', sample_tickers: ['GUJALKALI', 'CHEMPLASTS', 'GHCL', 'TATACHEM'], pass_through_lag: 'immediate' },
      { sector: 'Glass / Detergents',  sign: -1, sensitivity: 'med',  sample_tickers: ['HINDUNILVR', 'PIDILITIND', 'BORAINDIA'], pass_through_lag: '1Q', pricing_power: 'moderate' },
      { sector: 'Textiles / Alumina',  sign: -1, sensitivity: 'low',  sample_tickers: ['NATIONALUM', 'HINDALCO'], pass_through_lag: '2Q', pricing_power: 'moderate' },
    ],
  },

  // ── Energy: Coal / Petcoke (manual feed) ────────────
  {
    symbol: '', name: 'Coking Coal (Aus FOB)', unit: '$/t',
    category: 'energy', bias_2026: 'rising',
    source_note: 'India imports ~85% of coking coal. Manual update from Platts / Argus.',
    drivers: [
      { sector: 'Steel (integrated)', sign: -1, sensitivity: 'high', sample_tickers: ['TATASTEEL', 'JSWSTEEL', 'JINDALSTEL', 'SAIL'], pass_through_lag: '1Q', pricing_power: 'moderate' },
      { sector: 'Pipe makers (steel users)', sign: -1, sensitivity: 'med', sample_tickers: ['APLAPOLLO', 'WELSPUNCORP', 'JTLIND', 'RATNAMANI'], pass_through_lag: '2Q', pricing_power: 'moderate' },
      { sector: 'Capital goods (steel-heavy)', sign: -1, sensitivity: 'low', sample_tickers: ['BHEL', 'L&T', 'CUMMINSIND'], pass_through_lag: '2Q', pricing_power: 'strong' },
    ],
  },
  {
    symbol: '', name: 'Thermal Coal (Newcastle)', unit: '$/t',
    category: 'energy', bias_2026: 'volatile',
    source_note: 'Newcastle FOB benchmark; manual update from Reuters / S&P Global.',
    drivers: [
      { sector: 'Power (thermal)',   sign: -1, sensitivity: 'high', sample_tickers: ['NTPC', 'TATAPOWER', 'JSWENERGY', 'ADANIPOWER', 'CESC'], pass_through_lag: '1Q', pricing_power: 'moderate' },
      { sector: 'Cement (coal)',     sign: -1, sensitivity: 'high', sample_tickers: ['ULTRACEMCO', 'SHREECEM', 'AMBUJACEM', 'ACC', 'DALBHARAT', 'JKLAKSHMI'], pass_through_lag: '1Q', pricing_power: 'moderate' },
      { sector: 'Coal miners',       sign: 1,  sensitivity: 'high', sample_tickers: ['COALINDIA', 'NMDC'], pass_through_lag: 'immediate' },
    ],
  },
  {
    symbol: '', name: 'Petcoke', unit: '$/t',
    category: 'energy', bias_2026: 'rising',
    source_note: 'Coke proxy for cement / ceramic industrial heat. Manual update.',
    drivers: [
      { sector: 'Cement',          sign: -1, sensitivity: 'high', sample_tickers: ['ULTRACEMCO', 'SHREECEM', 'AMBUJACEM', 'DALBHARAT', 'JKLAKSHMI', 'STARCEMENT', 'HEIDELBERG'], pass_through_lag: '1Q', pricing_power: 'moderate' },
      { sector: 'Ceramics / Tiles', sign: -1, sensitivity: 'high', sample_tickers: ['KAJARIACER', 'SOMANYCERA', 'CERA', 'HSIL'], pass_through_lag: '1Q', pricing_power: 'moderate' },
    ],
  },

  // ── Natural Rubber ─────────────────────────────────
  {
    // PATCH 0247 — Yahoo RU=F returns 0.01331 USD which is clearly broken
    // (TOCOM rubber spot is ~300 JPY/kg ≈ $2/kg). Switched to manual feed —
    // drivers still surface, no auto-fetched price.
    symbol: '', name: 'Natural Rubber (TOCOM)', unit: 'JPY/kg',
    category: 'agri', bias_2026: 'volatile',
    source_note: 'Manual feed — Yahoo RU=F returns invalid data; track via TOCOM RSS3 spot.',
    drivers: [
      { sector: 'Tyres (rubber)',  sign: -1, sensitivity: 'high', sample_tickers: ['MRF', 'APOLLOTYRE', 'CEATLTD', 'BALKRISIND', 'JKTYRE'], pass_through_lag: '1Q', pricing_power: 'moderate', note: 'Separate from crude — direct margin lever.' },
      { sector: 'Footwear',        sign: -1, sensitivity: 'med',  sample_tickers: ['BATAINDIA', 'RELAXO', 'METROBRAND', 'CAMPUSACTIV'], pass_through_lag: '2Q', pricing_power: 'moderate' },
    ],
  },

  // ── Pulp & Paper ───────────────────────────────────
  {
    symbol: '', name: 'Wood Pulp (NBSK)', unit: '$/t',
    category: 'chemicals', bias_2026: 'volatile',
    source_note: 'Northern Bleached Softwood Kraft benchmark — manual update.',
    drivers: [
      { sector: 'Paper / Notebooks', sign: -1, sensitivity: 'high', sample_tickers: ['WSTCSTPAPR', 'JKPAPER', 'TNPL', 'EMAMIPAP', 'NRAGRINDQ'], pass_through_lag: '1Q', pricing_power: 'moderate' },
      { sector: 'Packaging board',   sign: -1, sensitivity: 'high', sample_tickers: ['ITC', 'AGI', 'JKPAPER'], pass_through_lag: '1Q', pricing_power: 'moderate' },
    ],
  },

  // ── AI / Robotics: Strategic Materials ─────────────
  {
    symbol: 'LIT', name: 'Lithium (Global X ETF proxy)', unit: '$',
    category: 'ai_robotics', bias_2026: 'volatile',
    source_note: 'LIT ETF as proxy for lithium-chain prices. EV + grid storage demand.',
    drivers: [
      { sector: 'EV battery makers',    sign: -1, sensitivity: 'high', sample_tickers: ['TATAPOWER', 'EXIDEIND', 'AMARAJABAT', 'OLAELEC'], pass_through_lag: '1Q', pricing_power: 'moderate' },
      { sector: 'Grid storage / Solar', sign: -1, sensitivity: 'med',  sample_tickers: ['WAAREEENER', 'TATAPOWER', 'KPIGREEN', 'ACMESOLAR', 'PREMIERENE'], pass_through_lag: '2Q', pricing_power: 'moderate' },
      { sector: 'Auto OEMs (EV)',       sign: -1, sensitivity: 'med',  sample_tickers: ['TATAMOTORS', 'M&M', 'BAJAJ-AUTO', 'OLAELEC'], pass_through_lag: '2Q', pricing_power: 'moderate' },
    ],
  },
  {
    symbol: 'REMX', name: 'Rare Earths (VanEck ETF proxy)', unit: '$',
    category: 'rare_earths', bias_2026: 'rising',
    source_note: 'Rare Earth Metals ETF — proxy for neodymium / dysprosium / praseodymium pricing. Critical for EV motors, wind turbines, defence guidance, AI/HBM.',
    drivers: [
      { sector: 'Wind turbines',    sign: -1, sensitivity: 'high', sample_tickers: ['SUZLON', 'INOXWIND', 'WAAREEENER'], pass_through_lag: '2Q', pricing_power: 'moderate' },
      { sector: 'EV motors',        sign: -1, sensitivity: 'high', sample_tickers: ['TATAMOTORS', 'BAJAJ-AUTO', 'OLAELEC', 'M&M'], pass_through_lag: '2Q', pricing_power: 'moderate' },
      { sector: 'Defence (guidance)', sign: -1, sensitivity: 'high', sample_tickers: ['HAL', 'BEL', 'BDL', 'PARAS', 'MAZDOCK', 'DATAPATTNS'], pass_through_lag: '3Q+', pricing_power: 'strong' },
      { sector: 'AI semis (magnets/HBM cooling)', sign: -1, sensitivity: 'med',  sample_tickers: ['TATAELXSI', 'KAYNES', 'SYRMA', 'CYIENT'], pass_through_lag: '2Q', pricing_power: 'moderate' },
    ],
  },
  {
    symbol: '', name: 'Gallium / Germanium', unit: '$/kg',
    category: 'ai_robotics', bias_2026: 'rising',
    source_note: 'China export-controlled. Critical for power semiconductors, optical fibre, infrared optics. Manual update from USGS / Argus.',
    drivers: [
      { sector: 'Power semis',      sign: -1, sensitivity: 'high', sample_tickers: ['KAYNES', 'TATAELXSI', 'SYRMA', 'DIXON', 'AMBER'], pass_through_lag: '2Q', pricing_power: 'moderate' },
      { sector: 'Optical fibre',    sign: -1, sensitivity: 'high', sample_tickers: ['STLTECH', 'HFCL', 'OPTIEMUS'], pass_through_lag: '2Q', pricing_power: 'moderate' },
      { sector: 'Defence optronics', sign: -1, sensitivity: 'med',  sample_tickers: ['BEL', 'DATAPATTNS', 'PARAS'], pass_through_lag: '3Q+', pricing_power: 'strong' },
    ],
  },
  {
    symbol: 'PA=F', fmp_symbol: 'PAUSD',
    name: 'Palladium', unit: '$/oz',
    category: 'ai_robotics', bias_2026: 'volatile',
    source_note: 'Catalytic converters, semiconductor inks, hydrogen fuel cells.',
    drivers: [
      { sector: 'Auto catalysts',   sign: -1, sensitivity: 'high', sample_tickers: ['BOSCHLTD', 'MOTHERSON', 'EXIDEIND'], pass_through_lag: '1Q', pricing_power: 'strong' },
    ],
  },
  {
    symbol: 'PL=F', fmp_symbol: 'PLUSD',
    name: 'Platinum', unit: '$/oz',
    category: 'ai_robotics', bias_2026: 'rising',
    source_note: 'Hydrogen electrolyser PEM catalyst; H2 economy driver.',
    drivers: [
      { sector: 'Hydrogen / Electrolysers', sign: -1, sensitivity: 'high', sample_tickers: ['L&T', 'RELIANCE', 'NTPC', 'ADANIGREEN'], pass_through_lag: '3Q+', pricing_power: 'moderate' },
    ],
  },

  // ── Quantum / Specialty (manual feed) ──────────────
  {
    symbol: '', name: 'Helium-3 / Helium', unit: '$/L',
    category: 'ai_robotics', bias_2026: 'rising',
    source_note: 'Quantum dilution refrigerators + MRI + semiconductor manufacturing. Helium supply structurally tight.',
    drivers: [
      { sector: 'Quantum / cryogenics', sign: -1, sensitivity: 'high', sample_tickers: ['L&T', 'TATAELXSI', 'CYIENT', 'KAYNES'], pass_through_lag: '3Q+', pricing_power: 'strong' },
      { sector: 'Medical MRI',          sign: -1, sensitivity: 'med',  sample_tickers: ['POLYMED', 'BLISSGVS'], pass_through_lag: '2Q', pricing_power: 'strong' },
    ],
  },

  // ── Nuclear ────────────────────────────────────────
  {
    symbol: 'URA', name: 'Uranium (Global X ETF)', unit: '$',
    category: 'nuclear', bias_2026: 'rising',
    source_note: 'Global X URA — uranium miners + nuclear-fuel processors. SMR demand pulling forward.',
    drivers: [
      { sector: 'Nuclear / power equipment', sign: 1,  sensitivity: 'high', sample_tickers: ['BHEL', 'L&T', 'NTPC', 'WALCHAN'], pass_through_lag: 'immediate' },
      { sector: 'Nuclear utilities (host)',  sign: -1, sensitivity: 'med',  sample_tickers: ['NTPC', 'NHPC'], pass_through_lag: '3Q+', pricing_power: 'strong' },
    ],
  },
  {
    symbol: '', name: 'HALEU / Enriched Uranium', unit: '$/kg-U',
    category: 'nuclear', bias_2026: 'rising',
    source_note: 'High-Assay Low-Enriched Uranium — fuel for advanced SMRs. Bottleneck: only Russia/USA enrich at 5–20%.',
    drivers: [
      { sector: 'SMR / Advanced nuclear', sign: -1, sensitivity: 'high', sample_tickers: ['BHEL', 'L&T', 'WALCHAN'], pass_through_lag: '3Q+', pricing_power: 'strong', note: 'Long lead time; capex visibility 3+ years out.' },
    ],
  },
];

interface YahooPoint { ts: number; close: number; }
interface FetchResult { points: YahooPoint[]; source: 'yahoo' | 'fmp' | 'alphavantage'; }

async function fetchFromYahoo(symbol: string): Promise<YahooPoint[] | null> {
  try {
    const res = await fetch(`${YH}/${encodeURIComponent(symbol)}?range=3mo&interval=1d`, { headers: { 'User-Agent': UA }, cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    if (!r) return null;
    const ts: number[] = r.timestamp || [];
    const cl: (number | null)[] = r.indicators?.quote?.[0]?.close || [];
    const out: YahooPoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      if (cl[i] != null && Number.isFinite(cl[i])) out.push({ ts: ts[i], close: cl[i] as number });
    }
    return out.length > 0 ? out : null;
  } catch { return null; }
}

// PATCH 0248 — Financial Modeling Prep fallback.
// Endpoint: /api/v3/historical-price-full/<symbol>?apikey=<key>
// Returns: { historical: [{ date: 'YYYY-MM-DD', close: number, ... }] }
async function fetchFromFMP(symbol: string): Promise<YahooPoint[] | null> {
  const key = process.env.FMP_KEY;
  if (!key || !symbol) return null;
  try {
    const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${encodeURIComponent(symbol)}?serietype=line&timeseries=90&apikey=${key}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    const arr: any[] = j?.historical || [];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    // FMP returns most-recent-first; reverse for chronological order.
    const reversed = [...arr].reverse();
    const out: YahooPoint[] = [];
    for (const row of reversed) {
      const ts = Date.parse(row.date) / 1000;
      const cl = Number(row.close);
      if (Number.isFinite(ts) && Number.isFinite(cl)) out.push({ ts, close: cl });
    }
    return out.length > 0 ? out : null;
  } catch { return null; }
}

// PATCH 0248 — Alpha Vantage fallback for the few commodities AV covers.
// Endpoint: /query?function=<FN>&interval=daily&apikey=<key>
// AV functions: WTI, BRENT, NATURAL_GAS, COPPER, ALUMINUM, WHEAT, CORN,
//               COTTON, SUGAR, COFFEE, ALL_COMMODITIES.
async function fetchFromAlphaVantage(fn: string): Promise<YahooPoint[] | null> {
  const key = process.env.AV_KEY || process.env.ALPHA_VANTAGE_KEY;
  if (!key || !fn) return null;
  try {
    const url = `https://www.alphavantage.co/query?function=${encodeURIComponent(fn)}&interval=daily&apikey=${key}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    const arr: any[] = j?.data || [];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    // AV returns most-recent-first; reverse + take last 90 days
    const reversed = [...arr].reverse().slice(-90);
    const out: YahooPoint[] = [];
    for (const row of reversed) {
      const ts = Date.parse(row.date) / 1000;
      const cl = Number(row.value);
      if (Number.isFinite(ts) && Number.isFinite(cl)) out.push({ ts, close: cl });
    }
    return out.length > 0 ? out : null;
  } catch { return null; }
}

// PATCH 0248 — Multi-source dispatch with fallback chain.
// Order: Yahoo (cheapest, most coverage) → FMP (good for tracked commodities)
//        → Alpha Vantage (limited universe, last resort).
async function fetchSeries(commodity: Commodity): Promise<FetchResult | null> {
  if (commodity.symbol) {
    const y = await fetchFromYahoo(commodity.symbol);
    if (y) return { points: y, source: 'yahoo' };
  }
  if (commodity.fmp_symbol) {
    const f = await fetchFromFMP(commodity.fmp_symbol);
    if (f) return { points: f, source: 'fmp' };
  }
  if (commodity.av_function) {
    const a = await fetchFromAlphaVantage(commodity.av_function);
    if (a) return { points: a, source: 'alphavantage' };
  }
  return null;
}

function pctChange(pts: YahooPoint[], daysBack: number): number | null {
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1].close;
  const targetIdx = Math.max(0, pts.length - 1 - daysBack);
  const ref = pts[targetIdx].close;
  if (ref <= 0) return null;
  return ((last - ref) / ref) * 100;
}

export async function GET() {
  const t0 = Date.now();

  // PATCH 0248 — Multi-source fetcher (Yahoo → FMP → AV with fallback).
  const seriesArr = await Promise.all(COMMODITIES.map((c) => fetchSeries(c)));
  const out = COMMODITIES.map((c, i) => {
    const fetched = seriesArr[i];
    const pts = fetched?.points || null;
    const priceSource = fetched?.source || null;
    if (!pts) {
      // Keep drivers visible even without a price feed so the transmission
      // matrix doesn't disappear for items the upstream doesn't expose.
      const impactsNoPrice = c.drivers.map((d) => ({
        sector: d.sector,
        sign: d.sign,
        sensitivity: d.sensitivity,
        margin_pressure_pp_1m: null,
        margin_pressure_pp_3m: null,
        sample_tickers: d.sample_tickers,
        pass_through_lag: d.pass_through_lag || null,
        pricing_power: d.pricing_power || null,
        note: d.note || null,
      }));
      return {
        symbol: c.symbol, name: c.name, unit: c.unit,
        category: c.category || null, bias_2026: c.bias_2026 || null, source_note: c.source_note || null,
        fetched: false, price_source: null,
        last: null, change_1d: null, change_1w: null, change_1m: null, change_3m: null,
        impacts: impactsNoPrice,
      };
    }
    const last = pts[pts.length - 1].close;
    const c1d = pctChange(pts, 1);
    const c1w = pctChange(pts, 5);
    const c1m = pctChange(pts, 21);
    const c3m = pctChange(pts, 63);
    // Build impact list — for each sector mapped, compute projected EBIT pressure
    // For sensitivity {high: 0.6, med: 0.3, low: 0.15} this maps commodity-move
    // to first-order margin-pressure-pp on the dependent sector.
    const sensFactor: Record<string, number> = { high: 0.6, med: 0.3, low: 0.15 };
    const impacts = c.drivers.map((d) => {
      const f = sensFactor[d.sensitivity];
      const mPressure1m = c1m != null ? c1m * d.sign * f : null;
      const mPressure3m = c3m != null ? c3m * d.sign * f : null;
      return {
        sector: d.sector,
        sign: d.sign,
        sensitivity: d.sensitivity,
        margin_pressure_pp_1m: mPressure1m != null ? Math.round(mPressure1m * 10) / 10 : null,
        margin_pressure_pp_3m: mPressure3m != null ? Math.round(mPressure3m * 10) / 10 : null,
        sample_tickers: d.sample_tickers,
        // PATCH 0240 — pass-through metadata for institutional users
        pass_through_lag: d.pass_through_lag || null,
        pricing_power: d.pricing_power || null,
        note: d.note || null,
      };
    });
    // PATCH 0240 — surface the last 60 closes as a series so the frontend can
    // render a sparkline without re-fetching.
    const sparkline = pts.slice(-60).map(p => Math.round(p.close * 100) / 100);
    return {
      symbol: c.symbol, name: c.name, unit: c.unit,
      category: c.category || null, bias_2026: c.bias_2026 || null, source_note: c.source_note || null,
      fetched: true,
      price_source: priceSource,
      last: Math.round(last * 100) / 100,
      change_1d: c1d != null ? Math.round(c1d * 100) / 100 : null,
      change_1w: c1w != null ? Math.round(c1w * 100) / 100 : null,
      change_1m: c1m != null ? Math.round(c1m * 100) / 100 : null,
      change_3m: c3m != null ? Math.round(c3m * 100) / 100 : null,
      sparkline,
      impacts,
    };
  });

  // Top transmission shocks: largest |1m change × sensitivity| pairs across all
  // commodities, grouped by sector.
  const shocks: Array<{ commodity: string; sector: string; pressure_pp: number; sign: 1 | -1; sensitivity: 'high'|'med'|'low'; tickers: string[] }> = [];
  for (const c of out) {
    if (!c.fetched || c.change_1m == null) continue;
    for (const imp of c.impacts) {
      if (imp.margin_pressure_pp_1m == null) continue;
      if (Math.abs(imp.margin_pressure_pp_1m) < 1) continue;
      shocks.push({
        commodity: c.name,
        sector: imp.sector,
        pressure_pp: imp.margin_pressure_pp_1m,
        sign: imp.sign as 1 | -1,
        sensitivity: imp.sensitivity as 'high'|'med'|'low',
        tickers: imp.sample_tickers,
      });
    }
  }
  shocks.sort((a, b) => Math.abs(b.pressure_pp) - Math.abs(a.pressure_pp));

  return NextResponse.json({
    commodities: out,
    top_shocks: shocks.slice(0, 25),
    fetched_at: new Date().toISOString(),
    ms: Date.now() - t0,
  }, { headers: { 'Cache-Control': 's-maxage=600, stale-while-revalidate=1800' } });
}
