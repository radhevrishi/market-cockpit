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
  // Emerging / next-decade themes (zzz483) — baskets so they self-heal as leaders change.
  { id: 'us-space',        name: 'Space & Satellites',  emoji: '🛰️', group: 'Frontier Tech', basket: ['RKLB','LUNR','ASTS','PL'], note: 'Launch / satellites / space infra' },
  { id: 'us-drones',       name: 'Drones & Autonomy',   emoji: '🚁', group: 'Frontier Tech', basket: ['AVAV','KTOS','RCAT','ONDS'], note: 'Unmanned systems & autonomy' },
  { id: 'us-obesity',      name: 'Obesity / GLP-1',     emoji: '💉', group: 'Healthcare', basket: ['LLY','NVO','VKTX','AMGN'], note: 'GLP-1 / metabolic drugs' },
  { id: 'us-genomics',     name: 'Genomics',            emoji: '🧬', group: 'Healthcare', proxy: 'ARKG', note: 'Genomic revolution (ARK)' },
  { id: 'us-crypto',       name: 'Crypto & Blockchain', emoji: '₿', group: 'Frontier Tech', proxy: 'BLOK', note: 'Blockchain equities (Amplify)' },
  { id: 'us-hydrogen',     name: 'Hydrogen / Fuel Cell',emoji: '🔋', group: 'Energy & Resources', basket: ['PLUG','BE','BLDP'], note: 'Hydrogen & fuel-cell' },
  { id: 'us-ev',           name: 'EV & Electrification',emoji: '🔌', group: 'Frontier Tech', proxy: 'DRIV', note: 'Autonomous & EV (Global X)' },
  { id: 'us-water',        name: 'Water',               emoji: '💧', group: 'Energy & Resources', proxy: 'PHO', note: 'Water resources (Invesco)' },
  // Futuristic thematic ETFs (zzz483b) — tracked continuously so the rotation
  // engine auto-flips each from AVOID to BUY the moment it inflects, even if that
  // is years away. One ETF fetch each; leaders in THEME_LEADERS give self-heal.
  { id: 'us-ai',           name: 'Artificial Intelligence', emoji: '🤖', group: 'Frontier Tech', proxy: 'AIQ', note: 'AI & big-data (Global X)' },
  { id: 'us-innovation',   name: 'Disruptive Innovation', emoji: '🚀', group: 'Frontier Tech', proxy: 'ARKK', note: 'Disruptive innovation (ARK)' },
  { id: 'us-battery',      name: 'Battery & Lithium',   emoji: '🔋', group: 'Frontier Tech', proxy: 'LIT', note: 'Lithium & battery tech (Global X)' },
  { id: 'us-5g',           name: '5G / Connectivity',   emoji: '📡', group: 'Frontier Tech', proxy: 'FIVG', note: 'Next-gen connectivity (Defiance 5G)' },
  { id: 'us-metaverse',    name: 'Metaverse / AR-VR',   emoji: '🕶️', group: 'Frontier Tech', proxy: 'METV', note: 'Metaverse (Roundhill)' },
  { id: 'us-gaming',       name: 'Gaming & Esports',    emoji: '🎮', group: 'Frontier Tech', proxy: 'ESPO', note: 'Video games & esports (VanEck)' },
  { id: 'us-infra',        name: 'Infrastructure / Reshoring', emoji: '🏗️', group: 'Industrials & Cyclicals', proxy: 'PAVE', note: 'US infrastructure build (Global X)' },
  { id: 'us-copper',       name: 'Copper / Electrification', emoji: '🟠', group: 'Energy & Resources', proxy: 'COPX', note: 'Copper miners (Global X)' },
  { id: 'us-cleanenergy',  name: 'Clean Energy',        emoji: '🌱', group: 'Energy & Resources', proxy: 'ICLN', note: 'Clean energy (iShares Global)' },
  { id: 'us-agtech',       name: 'AgTech & Food',       emoji: '🌾', group: 'Frontier Tech', proxy: 'KROP', note: 'AgTech & food innovation (Global X)' },
  // Broad sectors (zzz487) — so every holding lands in a theme with a real call.
  { id: 'us-industrials',  name: 'Industrials',         emoji: '🏭', group: 'Broad Sectors', proxy: 'XLI', note: 'Industrials (SPDR)' },
  { id: 'us-transport',    name: 'Transport & Shipping',emoji: '🚚', group: 'Broad Sectors', proxy: 'IYT', note: 'Transportation — rail/air/truck/shipping (iShares)' },
  { id: 'us-retail',       name: 'Retail',              emoji: '🛒', group: 'Broad Sectors', proxy: 'XRT', note: 'Retail (SPDR)' },
  { id: 'us-condisc',      name: 'Consumer Discretionary', emoji: '🛍️', group: 'Broad Sectors', proxy: 'XLY', note: 'Consumer discretionary (SPDR)' },
  { id: 'us-staples',      name: 'Consumer Staples',    emoji: '🧺', group: 'Broad Sectors', proxy: 'XLP', note: 'Consumer staples (SPDR)' },
  { id: 'us-healthcare',   name: 'Healthcare (broad)',  emoji: '🏥', group: 'Broad Sectors', proxy: 'XLV', note: 'Healthcare (SPDR)' },
  { id: 'us-materials',    name: 'Materials',           emoji: '⚗️', group: 'Broad Sectors', proxy: 'XLB', note: 'Materials (SPDR)' },
  { id: 'us-utilities',    name: 'Utilities',           emoji: '💡', group: 'Broad Sectors', proxy: 'XLU', note: 'Utilities (SPDR)' },
  { id: 'us-reit',         name: 'Real Estate / REITs', emoji: '🏢', group: 'Broad Sectors', proxy: 'VNQ', note: 'Real estate (Vanguard)' },
  { id: 'us-comm',         name: 'Communication / Media', emoji: '📺', group: 'Broad Sectors', proxy: 'XLC', note: 'Communication services (SPDR)' },
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
  // Emerging / next-decade themes (zzz483) — baskets so they self-heal as leaders change.
  { id: 'in-renewables',   name: 'Renewables / Green',  emoji: '🔆', group: 'Capex & Strategic', basket: ['SUZLON.NS','INOXWIND.NS','WAAREEENER.NS','JSWENERGY.NS','TATAPOWER.NS'], note: 'Wind / solar / green power' },
  { id: 'in-newage',       name: 'New-age Internet',    emoji: '📱', group: 'Tech & New-Age', basket: ['PAYTM.NS','NYKAA.NS','POLICYBZR.NS','IRCTC.NS'], note: 'Consumer-internet platforms' },
  { id: 'in-hospitals',    name: 'Hospitals',           emoji: '🏥', group: 'Healthcare & Consumer', basket: ['APOLLOHOSP.NS','MAXHEALTH.NS','FORTIS.NS','NH.NS'], note: 'Hospital chains' },
  { id: 'in-cement',       name: 'Cement',              emoji: '🧱', group: 'Energy & Materials', basket: ['ULTRACEMCO.NS','SHREECEM.NS','AMBUJACEM.NS','ACC.NS'], note: 'Cement (housing + infra cycle)' },
  { id: 'in-retail',       name: 'Retail / Discretionary', emoji: '🛍️', group: 'Healthcare & Consumer', basket: ['TRENT.NS','DMART.NS','TITAN.NS','JUBLFOOD.NS'], note: 'Consumption & retail' },
  { id: 'in-ports',        name: 'Ports & Shipping',    emoji: '🚢', group: 'Capex & Strategic', basket: ['ADANIPORTS.NS','GESHIP.NS','MAZDOCK.NS','COCHINSHIP.NS'], note: 'Ports, shipping, shipbuilding' },
  // Broad sectors (zzz487) — coverage catch-alls with a real call.
  { id: 'in-media',        name: 'Media',               emoji: '📺', group: 'Broad Sectors', proxy: '^CNXMEDIA', note: 'NIFTY Media' },
  { id: 'in-consumption',  name: 'Consumption',         emoji: '🛍️', group: 'Broad Sectors', proxy: '^CNXCONSUM', note: 'NIFTY Consumption' },
  { id: 'in-commodities',  name: 'Commodities',         emoji: '⚗️', group: 'Broad Sectors', proxy: '^CNXCMDT', note: 'NIFTY Commodities' },
  { id: 'in-psubank2',     name: 'PSU (broad)',         emoji: '🏛️', group: 'Broad Sectors', basket: ['SBIN.NS','NTPC.NS','ONGC.NS','COALINDIA.NS','BEL.NS','POWERGRID.NS'], note: 'PSU heavyweights' },
];

export const INDIA_BENCHMARK = { symbol: '^NSEI', name: 'NIFTY 50' };

// ─── CONSTITUENT LEADERS (zzz481) — the buyable names inside each theme, shown
// on drill-down so "buy Cybersecurity" resolves to "buy PANW / CRWD / ZS …".
// Basket themes already ARE their leaders (basket is used); this map fills in the
// proxy (ETF/index) themes. Curated top names; non-resolving tickers drop out.
export const THEME_LEADERS: Record<string, string[]> = {
  // US
  'us-semis': ['NVDA', 'AVGO', 'AMD', 'MU', 'TSM', 'LRCX'],
  'us-software': ['MSFT', 'CRM', 'ORCL', 'NOW', 'PANW', 'ADBE'],
  'us-cloud': ['MSFT', 'AMZN', 'GOOGL', 'ORCL', 'SNOW', 'DDOG'],
  'us-cyber': ['PANW', 'CRWD', 'ZS', 'FTNT', 'NET', 'CYBR'],
  'us-internet': ['AMZN', 'META', 'GOOGL', 'NFLX', 'SHOP', 'UBER'],
  'us-fintech': ['V', 'MA', 'PYPL', 'COIN', 'HOOD', 'SOFI'],
  'us-quantum': ['IONQ', 'RGTI', 'QBTS', 'QUBT', 'IBM'],
  'us-energy': ['XOM', 'CVX', 'COP', 'SLB', 'EOG'],
  'us-nuclear': ['CCJ', 'LEU', 'OKLO', 'SMR', 'UEC'],
  'us-solar': ['FSLR', 'ENPH', 'NXT', 'RUN', 'ARRY'],
  'us-critminerals': ['MP', 'ALB', 'FCX', 'LAC'],
  'us-gold': ['NEM', 'GOLD', 'AEM', 'FNV', 'WPM'],
  'us-defense': ['RTX', 'LMT', 'GD', 'NOC', 'LHX', 'HWM'],
  'us-robotics': ['NVDA', 'ISRG', 'ABB', 'ROK', 'TER'],
  'us-biotech': ['VRTX', 'REGN', 'GILD', 'AMGN', 'MRNA'],
  'us-homebuild': ['DHI', 'LEN', 'PHM', 'NVR'],
  'us-regbanks': ['USB', 'PNC', 'TFC', 'KEY', 'RF'],
  // futuristic ETF themes — leaders give the self-heal fallback if the ETF ever delists
  'us-ai': ['NVDA', 'MSFT', 'GOOGL', 'META', 'PLTR'],
  'us-innovation': ['TSLA', 'COIN', 'HOOD', 'ROKU', 'PLTR'],
  'us-battery': ['ALB', 'TSLA', 'QS', 'ENVX', 'PANW'],
  'us-5g': ['QCOM', 'AVGO', 'CSCO', 'AMT', 'TMUS'],
  'us-metaverse': ['META', 'NVDA', 'AAPL', 'RBLX', 'U'],
  'us-gaming': ['NVDA', 'RBLX', 'EA', 'TTWO', 'NTES'],
  'us-infra': ['ETN', 'PWR', 'VMC', 'MLM', 'URI'],
  'us-copper': ['FCX', 'SCCO', 'TECK', 'ERO'],
  'us-cleanenergy': ['FSLR', 'ENPH', 'NEE', 'FLNC'],
  'us-agtech': ['DE', 'CTVA', 'NTR', 'MOS'],
  'us-genomics': ['VRTX', 'REGN', 'CRSP', 'NTLA', 'TWST'],
  'us-crypto': ['COIN', 'MSTR', 'HOOD', 'MARA'],
  'us-ev': ['TSLA', 'RIVN', 'ALB', 'APTV'],
  'us-water': ['ECL', 'AWK', 'XYL', 'WM'],
  // broad sectors
  'us-industrials': ['GE', 'CAT', 'HON', 'DE', 'UBER'],
  'us-transport': ['UBER', 'UPS', 'DAL', 'CSX', 'ODFL'],
  'us-retail': ['AMZN', 'COST', 'WMT', 'HD', 'TJX'],
  'us-condisc': ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE'],
  'us-staples': ['WMT', 'PG', 'KO', 'COST', 'PEP'],
  'us-healthcare': ['LLY', 'UNH', 'JNJ', 'ABBV', 'MRK'],
  'us-materials': ['LIN', 'SHW', 'FCX', 'NEM', 'ECL'],
  'us-utilities': ['NEE', 'SO', 'DUK', 'CEG', 'VST'],
  'us-reit': ['PLD', 'AMT', 'EQIX', 'WELL', 'DLR'],
  'us-comm': ['META', 'GOOGL', 'NFLX', 'DIS', 'TMUS'],
  // India
  'in-it': ['TCS.NS', 'INFY.NS', 'HCLTECH.NS', 'WIPRO.NS', 'LTIM.NS', 'PERSISTENT.NS'],
  'in-energy': ['RELIANCE.NS', 'NTPC.NS', 'POWERGRID.NS', 'ONGC.NS', 'COALINDIA.NS'],
  'in-metal': ['TATASTEEL.NS', 'JSWSTEEL.NS', 'HINDALCO.NS', 'VEDL.NS', 'JINDALSTEL.NS'],
  'in-pharma': ['SUNPHARMA.NS', 'CIPLA.NS', 'DRREDDY.NS', 'DIVISLAB.NS', 'LUPIN.NS'],
  'in-fmcg': ['HINDUNILVR.NS', 'ITC.NS', 'NESTLEIND.NS', 'VBL.NS', 'BRITANNIA.NS'],
  'in-auto': ['M&M.NS', 'MARUTI.NS', 'TATAMOTORS.NS', 'BAJAJ-AUTO.NS', 'EICHERMOT.NS'],
  'in-realty': ['DLF.NS', 'LODHA.NS', 'GODREJPROP.NS', 'PRESTIGE.NS', 'OBEROIRLTY.NS'],
  'in-psubank': ['SBIN.NS', 'BANKBARODA.NS', 'PNB.NS', 'CANBK.NS', 'UNIONBANK.NS'],
  'in-bank': ['HDFCBANK.NS', 'ICICIBANK.NS', 'AXISBANK.NS', 'KOTAKBANK.NS', 'SBIN.NS'],
  'in-finserv': ['BAJFINANCE.NS', 'JIOFIN.NS', 'CHOLAFIN.NS', 'SHRIRAMFIN.NS', 'BAJAJFINSV.NS'],
  'in-infra': ['LT.NS', 'ADANIPORTS.NS', 'ULTRACEMCO.NS', 'GRASIM.NS', 'SIEMENS.NS'],
  'in-pse': ['NTPC.NS', 'POWERGRID.NS', 'BEL.NS', 'COALINDIA.NS', 'HAL.NS'],
  'in-media': ['ZEEL.NS', 'PVRINOX.NS', 'SUNTV.NS', 'NAZARA.NS', 'SAREGAMA.NS', 'TIPSMUSIC.NS'],
  'in-consumption': ['TITAN.NS', 'TRENT.NS', 'DMART.NS', 'JUBLFOOD.NS', 'VBL.NS', 'ZOMATO.NS'],
  'in-commodities': ['RELIANCE.NS', 'TATASTEEL.NS', 'JSWSTEEL.NS', 'GRASIM.NS', 'UPL.NS', 'PIIND.NS'],
};

// zzz489 — TICKER OVERRIDES. Coarse sector tags mislabel well-known names (payment
// processors show up as "Industrials", solar/hydrogen/quantum as "Semiconductors").
// These curated ticker→theme mappings are checked BEFORE the sector classifier so
// the famous names always land in the right theme. The sector classifier still
// handles the long tail (and future stocks) automatically. Bare symbols, UPPERCASE.
export const TICKER_OVERRIDE: Record<string, string> = {
  // Payments / fintech
  CPAY: 'us-fintech', RELY: 'us-fintech', FLYW: 'us-fintech', PAYS: 'us-fintech', GLBE: 'us-fintech',
  DLO: 'us-fintech', SEZL: 'us-fintech', AFRM: 'us-fintech', TOST: 'us-fintech', PYPL: 'us-fintech',
  // Solar / clean
  FSLR: 'us-solar', NXT: 'us-solar', RUN: 'us-solar', ENPH: 'us-solar', ARRY: 'us-solar', SHLS: 'us-solar', SEDG: 'us-solar',
  // Hydrogen
  PLUG: 'us-hydrogen', BE: 'us-hydrogen', BLDP: 'us-hydrogen',
  // Quantum
  IONQ: 'us-quantum', RGTI: 'us-quantum', QBTS: 'us-quantum', QUBT: 'us-quantum',
  // Photonics / optical / lidar
  LITE: 'us-photonics', POET: 'us-photonics', COHR: 'us-photonics', CIEN: 'us-photonics', AAOI: 'us-photonics',
  OUST: 'us-photonics', LASR: 'us-photonics', LPTH: 'us-photonics', FN: 'us-photonics', INFN: 'us-photonics',
  // Space & satellites
  RKLB: 'us-space', RDW: 'us-space', LUNR: 'us-space', ASTS: 'us-space', PL: 'us-space', BKSY: 'us-space', MDA: 'us-space',
  // Drones
  AVAV: 'us-drones', KTOS: 'us-drones', RCAT: 'us-drones', ONDS: 'us-drones', UMAC: 'us-drones',
  // Nuclear / uranium
  LEU: 'us-nuclear', OKLO: 'us-nuclear', SMR: 'us-nuclear', CCJ: 'us-nuclear', UEC: 'us-nuclear', UUUU: 'us-nuclear', NNE: 'us-nuclear',
  // Crypto miners / blockchain
  BTDR: 'us-crypto', HIVE: 'us-crypto', WULF: 'us-crypto', MARA: 'us-crypto', RIOT: 'us-crypto', CIFR: 'us-crypto', IREN: 'us-crypto', CORZ: 'us-crypto', BULL: 'us-crypto', COIN: 'us-crypto', MSTR: 'us-crypto',
  // Data-center power / electrification
  VRT: 'us-datacenter', GEV: 'us-datacenter', ETN: 'us-datacenter', PWR: 'us-datacenter', POWL: 'us-datacenter', AMSC: 'us-datacenter',
  // Defense / aerospace
  LOAR: 'us-defense', AIR: 'us-defense', BWXT: 'us-defense', SWBI: 'us-defense', NPK: 'us-defense',
  // Semiconductor equipment / memory
  ACMR: 'us-semis', ICHR: 'us-semis', COHU: 'us-semis', AEHR: 'us-semis', KLIC: 'us-semis', ONTO: 'us-semis', UCTT: 'us-semis',
  NLST: 'us-memory', QMCO: 'us-memory', SNDK: 'us-memory', STX: 'us-memory', WDC: 'us-memory', MU: 'us-memory',
  // Energy services / midstream / royalty trusts
  OII: 'us-energy', GLNG: 'us-energy', SUN: 'us-energy', DNOW: 'us-energy', FTK: 'us-energy', KGS: 'us-energy', NESR: 'us-energy',
  VNOM: 'us-energy', PBT: 'us-energy', WT: 'us-fintech',
  // AI software
  INOD: 'us-ai', BBAI: 'us-ai', SOUN: 'us-ai', AI: 'us-ai',
  // India — jewellery -> retail; servers -> data center; cranes -> capital goods
  SKYGOLD: 'in-retail', PCJEWELLER: 'in-retail', GOLDIAM: 'in-retail', DPABHUSHAN: 'in-retail', THANGAMAYL: 'in-retail', IGIL: 'in-retail', SENCO: 'in-retail', KALYANKJIL: 'in-retail',
  NETWEB: 'in-datacenter', SANGHVIMOV: 'in-capgoods',
};

export function themesForRegion(region: ThemeRegion): ThemeDef[] {
  return region === 'us' ? US_THEMES : INDIA_THEMES;
}
export function benchmarkForRegion(region: ThemeRegion) {
  return region === 'us' ? US_BENCHMARK : INDIA_BENCHMARK;
}
// The buyable names inside a theme: its basket if it has one, else the curated
// leader list for the proxy theme (empty if not mapped).
export function leadersFor(t: ThemeDef): string[] {
  if (t.basket && t.basket.length) return t.basket;
  return THEME_LEADERS[t.id] || [];
}
