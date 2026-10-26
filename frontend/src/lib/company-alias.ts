// zzz903 — alias-based company matcher for news tagging.
//
// The News Feed used to treat almost any capitalised word in a headline as a ticker (`/\b[A-Z]{2,15}\b/`), so "PSU", "PAT",
// "LIVE", "UK", "SK", "DRAM" became company tags and flowed into catalysts, in-play and mover reasons. This module replaces
// that guess with a lookup against an alias table (ticker → official names, short names, old names).
//
// Rules:
//  - Names match whole-word and case-insensitively, after the same normalisation on both sides ("&" = "and", legal
//    suffixes Ltd / Limited / Inc / Corp / Corporation / plc dropped, "." and apostrophes ignored, possessive 's dropped).
//    Guards: a one-word name needs a capital first letter in the text ("Apple" yes, "apple farmers" no); a name written in
//    capitals in the table ("SBI", "HUL", "L&T") must be in capitals in the text; a name made only of everyday words
//    ("Indian Oil", "Bank of India") must be written in Title Case.
//  - A bare ticker counts only when written as an explicit symbol: `NSE:XYZ`, `NASDAQ: XYZ`, `(XYZ)`, `$XYZ`, or an all-caps
//    token (3+ letters) that is a known ticker and not a common English / finance word (stop list below). Exchange-prefixed
//    symbols count even when the ticker is not in the table; the other forms need a known ticker.
//  - Overlapping candidates: the longest match wins ("Reliance Power" beats "Reliance"; "Central Bank of India" beats
//    "Bank of India"); phrases in NOT_COMPANY_PHRASES ("Reserve Bank of India") block every match inside them.
//  - Each match carries a confidence and the matched text. Pure: no I/O. The route extends the table at runtime with the
//    Conviction bench (ticker + company) and the NSE symbol catalogue via `buildAliasIndex(extra)`.

import { NSE_TICKER_NAMES } from './nse-ticker-names';

export type AliasMarket = 'IN' | 'US' | 'GLOBAL';

export interface AliasEntry {
  ticker: string;
  market: AliasMarket;
  /** Official / long names (legal suffix optional). */
  names?: string[];
  /** Short names used in headlines ("Infosys", "L&T", "Nvidia"). */
  shortNames?: string[];
  /** Former names. */
  oldNames?: string[];
}

export type MatchKind = 'symbol-exchange' | 'symbol-explicit' | 'symbol-bare' | 'name' | 'short-name' | 'old-name';

export interface CompanyMatch {
  ticker: string;
  market: AliasMarket;
  /** The text exactly as written in the input. */
  matched: string;
  kind: MatchKind;
  confidence: number;
  /** Character offset of the match in the input. */
  index: number;
}

/** Common English / finance / macro words and acronyms that are never taken as a bare ticker. */
export const TICKER_STOP_WORDS: ReadonlySet<string> = new Set([
  // everyday English
  'A', 'AN', 'THE', 'AND', 'OR', 'OF', 'ON', 'IN', 'AT', 'TO', 'BY', 'FOR', 'IS', 'IT', 'ITS', 'BE', 'AS', 'SO', 'GO', 'DO',
  'HE', 'WE', 'ME', 'MY', 'NO', 'UP', 'ALL', 'ARE', 'NEW', 'NOW', 'BIG', 'TOP', 'WIN', 'KEY', 'HOT', 'LOW', 'HIGH', 'BUY',
  'SELL', 'HOLD', 'LIVE', 'NEWS', 'WHY', 'HOW', 'WHAT', 'WHO', 'NOT', 'OUT', 'OFF', 'ONE', 'TWO', 'TEN', 'BEST', 'FREE',
  'CAN', 'CAR', 'CAT', 'DAY', 'OLD', 'OPEN', 'REAL', 'SAFE', 'TRUE', 'FAST', 'PLAY', 'LOVE', 'LIFE', 'WELL', 'GOOD', 'MAN',
  'WAR', 'OIL', 'GAS', 'GOLD', 'SUN', 'AIR', 'SEA', 'ICE', 'NET', 'PAY', 'RUN', 'SEE', 'SAY', 'SET', 'TAX', 'USE', 'WAY',
  'ALERT', 'BREAKING', 'EXCLUSIVE', 'UPDATE', 'WATCH', 'VIDEO', 'NOTE', 'STRUCTURAL',
  // roles / corporate
  'CEO', 'CFO', 'CTO', 'COO', 'CMD', 'MD', 'CXO', 'VP', 'AGM', 'EGM', 'ESG', 'CSR', 'HR', 'PR', 'IR', 'JV', 'MOU', 'LOI',
  'LOA', 'IPO', 'FPO', 'OFS', 'QIP', 'SME', 'MSME', 'PSU', 'PSUS', 'PSE', 'NBFC', 'HFC', 'AMC', 'MF', 'ETF', 'ETFS', 'REIT',
  'INVIT', 'SPAC', 'ADR', 'ADRS', 'GDR', 'ESOP', 'PLC', 'LTD', 'INC', 'CORP', 'LLC', 'LLP', 'PVT',
  // financial metrics
  'EPS', 'PAT', 'PBT', 'PE', 'PB', 'EBIT', 'EBITDA', 'ROE', 'ROCE', 'ROI', 'IRR', 'NPA', 'NPAS', 'GNPA', 'NNPA', 'NIM',
  'CASA', 'AUM', 'NAV', 'CAGR', 'YOY', 'QOQ', 'MOM', 'YTD', 'ATH', 'FY', 'TTM', 'H1', 'H2', 'Q1', 'Q2', 'Q3', 'Q4', 'FCF',
  'OPM', 'CAPEX', 'OPEX', 'TAM', 'ARR', 'SAAS', 'B2B', 'B2C', 'M&A',
  // macro / regulators / exchanges / places
  'GDP', 'CPI', 'WPI', 'PMI', 'IIP', 'GST', 'FDI', 'FII', 'FIIS', 'DII', 'DIIS', 'FPI', 'FPIS', 'RBI', 'SEBI', 'MPC',
  'FED', 'FOMC', 'ECB', 'BOJ', 'BOE', 'PBOC', 'IMF', 'WTO', 'OPEC', 'NATO', 'UN', 'UNSC', 'SEC', 'FTC', 'DOJ', 'FDA',
  'USFDA', 'EMA', 'CDSCO', 'DGCA', 'DRDO', 'ISRO', 'BARC', 'NCLT', 'NCLAT', 'CCI', 'IRDAI', 'PFRDA', 'TRAI', 'CBI', 'ED',
  'NSE', 'BSE', 'NYSE', 'NASDAQ', 'AMEX', 'LSE', 'TSX', 'MCX', 'NCDEX', 'SGX', 'GIFT', 'NIFTY', 'SENSEX', 'DOW', 'MSCI',
  'FTSE', 'VIX', 'USA', 'US', 'UK', 'EU', 'UAE', 'USSR', 'APAC', 'EMEA', 'GCC', 'ASEAN', 'BRICS', 'G7', 'G20', 'NCR',
  'INR', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'KRW', 'RMB', 'BJP', 'INC', 'AAP', 'TMC', 'DMK', 'NDA', 'UPA', 'PM', 'CM',
  'IPL', 'BCCI', 'ICC', 'PTI', 'ANI', 'IANS', 'NDTV', 'CNBC', 'CNN', 'BBC', 'WSJ', 'FT', 'ET', 'BS', 'AP', 'AFP',
  // technology / industry jargon
  'AI', 'AGI', 'ML', 'LLM', 'LLMS', 'GPU', 'GPUS', 'CPU', 'CPUS', 'TPU', 'NPU', 'HBM', 'HBM3', 'HBM4', 'DRAM', 'NAND',
  'RAM', 'SSD', 'LED', 'OLED', 'LCD', 'MLCC', 'PCB', 'PCBS', 'EMS', 'ODM', 'OEM', 'OEMS', 'IT', 'ITES', 'BPO', 'KPO',
  'API', 'APIS', 'SDK', 'SAP', 'ERP', 'CRM', 'IOT', 'EV', 'EVS', 'ICE', 'BEV', 'PHEV', 'SUV', 'SUVS', 'LNG', 'CNG', 'PNG',
  'LPG', 'CGD', 'SMR', 'SMRS', 'DPR', 'EPC', 'PPP', 'HAM', 'BOT', 'PLI', 'R&D', 'PV', 'BESS', 'MW', 'GW', 'MWH', 'GWH',
  'KW', 'KWH', 'TWH', 'CO', 'CO2', 'NOX', 'UAV', 'UAVS', 'USB', 'WIFI', 'NVME', 'PCIE', 'CXL', 'ASIC', 'FPGA', 'SOC',
  'RF', 'EUV', 'DUV', 'FAB', 'FABS', 'OSAT', 'ATMP', 'CHIPS', 'DC', 'AC', 'HVDC', 'UPS', 'HVAC', 'TV', 'OTT', 'DTH',
  '5G', '4G', '6G', 'SIM', 'SMS', 'VPN', 'URL', 'PDF', 'FAQ', 'SK', 'LG',
]);

/** Phrases that look like company names but are not listed companies; any match inside them is dropped. */
export const NOT_COMPANY_PHRASES: ReadonlyArray<string> = [
  'Reserve Bank of India', 'Securities and Exchange Board of India', 'Federal Reserve', 'Bank of England', 'Bank of Japan',
  'European Central Bank', 'World Bank', 'Asian Development Bank', 'State Bank of Pakistan', 'Government of India',
  'National Stock Exchange', 'Bombay Stock Exchange', 'Tata Group', 'Adani Group', 'Reliance Group', 'Birla Group',
];

const LEGAL_SUFFIX = /\b(?:ltd|limited|inc|incorporated|corp|corporation|plc|co|company|llc|nv|sa|ag|se)\.?$/i;
const NAME_PARTICLES = new Set(['of', 'and', 'the', 'for', 'de', 'la', 'a']);

/** Everyday words: a name built only from these is "generic" and must be written in Title Case to match. */
const GENERIC_WORDS = new Set([
  'india', 'indian', 'bank', 'oil', 'gas', 'power', 'energy', 'steel', 'metals', 'metal', 'finance', 'financial', 'capital',
  'industries', 'industry', 'national', 'state', 'central', 'union', 'general', 'insurance', 'life', 'housing', 'home',
  'first', 'global', 'international', 'united', 'new', 'great', 'eastern', 'western', 'southern', 'northern', 'city',
  'urban', 'rural', 'trade', 'trust', 'investment', 'investments', 'holdings', 'ventures', 'projects', 'infra',
  'infrastructure', 'engineering', 'electric', 'electricals', 'cement', 'cements', 'chemicals', 'paper', 'sugar',
  'textiles', 'motors', 'auto', 'tyres', 'foods', 'gold', 'silver', 'deep', 'natural', 'premier', 'standard', 'royal',
  'diamond', 'star', 'sun', 'one', 'max', 'apex', 'prime', 'south', 'north', 'east', 'west', 'american', 'america',
  'semiconductor', 'technologies', 'technology', 'systems', 'solutions', 'services', 'software', 'data', 'network',
  'communications', 'media', 'health', 'healthcare', 'care', 'pharma', 'laboratories', 'products', 'resources',
  'mining', 'minerals', 'coal', 'railway', 'railways', 'paints', 'petroleum', 'electronics', 'agro', 'exports', 'enterprises', 'commercial', 'mutual', 'credit', 'equity', 'growth',
]);

/** Curated India aliases. Tickers are NSE symbols. Extends `NSE_TICKER_NAMES` (which supplies one long name per ticker). */
const IN_ALIASES: AliasEntry[] = [
  { ticker: 'RELIANCE', market: 'IN', names: ['Reliance Industries'], shortNames: ['Reliance', 'RIL'] },
  { ticker: 'RPOWER', market: 'IN', names: ['Reliance Power'] },
  { ticker: 'RELINFRA', market: 'IN', names: ['Reliance Infrastructure'], shortNames: ['Reliance Infra'] },
  { ticker: 'JIOFIN', market: 'IN', names: ['Jio Financial Services'], shortNames: ['Jio Financial'] },
  { ticker: 'TCS', market: 'IN', names: ['Tata Consultancy Services'], shortNames: ['TCS'] },
  { ticker: 'INFY', market: 'IN', names: ['Infosys'] },
  { ticker: 'WIPRO', market: 'IN', names: ['Wipro'] },
  { ticker: 'HCLTECH', market: 'IN', names: ['HCL Technologies'], shortNames: ['HCLTech', 'HCL Tech'] },
  { ticker: 'TECHM', market: 'IN', names: ['Tech Mahindra'] },
  { ticker: 'LTIM', market: 'IN', names: ['LTIMindtree'], oldNames: ['Larsen & Toubro Infotech', 'Mindtree'] },
  { ticker: 'HDFCBANK', market: 'IN', names: ['HDFC Bank'] },
  { ticker: 'ICICIBANK', market: 'IN', names: ['ICICI Bank'] },
  { ticker: 'SBIN', market: 'IN', names: ['State Bank of India'], shortNames: ['SBI'] },
  { ticker: 'AXISBANK', market: 'IN', names: ['Axis Bank'] },
  { ticker: 'KOTAKBANK', market: 'IN', names: ['Kotak Mahindra Bank'], shortNames: ['Kotak Bank'] },
  { ticker: 'INDUSINDBK', market: 'IN', names: ['IndusInd Bank'] },
  { ticker: 'PNB', market: 'IN', names: ['Punjab National Bank'], shortNames: ['PNB'] },
  { ticker: 'BANKBARODA', market: 'IN', names: ['Bank of Baroda'] },
  { ticker: 'CANBK', market: 'IN', names: ['Canara Bank'] },
  { ticker: 'UNIONBANK', market: 'IN', names: ['Union Bank of India'] },
  { ticker: 'BANKINDIA', market: 'IN', names: ['Bank of India'] },
  { ticker: 'CENTRALBK', market: 'IN', names: ['Central Bank of India'] },
  { ticker: 'INDIANB', market: 'IN', names: ['Indian Bank'] },
  { ticker: 'YESBANK', market: 'IN', names: ['Yes Bank'] },
  { ticker: 'IDFCFIRSTB', market: 'IN', names: ['IDFC First Bank'] },
  { ticker: 'BAJFINANCE', market: 'IN', names: ['Bajaj Finance'] },
  { ticker: 'BAJAJFINSV', market: 'IN', names: ['Bajaj Finserv'] },
  { ticker: 'BAJAJ-AUTO', market: 'IN', names: ['Bajaj Auto'] },
  { ticker: 'LICI', market: 'IN', names: ['Life Insurance Corporation of India'], shortNames: ['LIC'] },
  { ticker: 'LT', market: 'IN', names: ['Larsen & Toubro'], shortNames: ['L&T', 'Larsen'] },
  { ticker: 'M&M', market: 'IN', names: ['Mahindra & Mahindra'], shortNames: ['M&M'] },
  { ticker: 'MARUTI', market: 'IN', names: ['Maruti Suzuki India'], shortNames: ['Maruti Suzuki', 'Maruti'] },
  { ticker: 'TATASTEEL', market: 'IN', names: ['Tata Steel'] },
  { ticker: 'TATAPOWER', market: 'IN', names: ['Tata Power'] },
  { ticker: 'TATAELXSI', market: 'IN', names: ['Tata Elxsi'] },
  { ticker: 'TATACOMM', market: 'IN', names: ['Tata Communications'] },
  { ticker: 'TITAN', market: 'IN', names: ['Titan Company'], shortNames: ['Titan'] },
  { ticker: 'HINDUNILVR', market: 'IN', names: ['Hindustan Unilever'], shortNames: ['HUL'] },
  { ticker: 'ITC', market: 'IN', names: ['ITC'] },
  { ticker: 'NESTLEIND', market: 'IN', names: ['Nestle India'] },
  { ticker: 'ASIANPAINT', market: 'IN', names: ['Asian Paints'] },
  { ticker: 'BHARTIARTL', market: 'IN', names: ['Bharti Airtel'], shortNames: ['Airtel'] },
  { ticker: 'IDEA', market: 'IN', names: ['Vodafone Idea'] },
  { ticker: 'ADANIENT', market: 'IN', names: ['Adani Enterprises'] },
  { ticker: 'ADANIPORTS', market: 'IN', names: ['Adani Ports and Special Economic Zone', 'Adani Ports'] },
  { ticker: 'ADANIGREEN', market: 'IN', names: ['Adani Green Energy'], shortNames: ['Adani Green'] },
  { ticker: 'ADANIPOWER', market: 'IN', names: ['Adani Power'] },
  { ticker: 'ADANIENSOL', market: 'IN', names: ['Adani Energy Solutions'], oldNames: ['Adani Transmission'] },
  { ticker: 'ONGC', market: 'IN', names: ['Oil and Natural Gas Corporation'], shortNames: ['ONGC'] },
  { ticker: 'IOC', market: 'IN', names: ['Indian Oil Corporation', 'Indian Oil'], shortNames: ['IOC', 'IOCL'] },
  { ticker: 'BPCL', market: 'IN', names: ['Bharat Petroleum'], shortNames: ['BPCL'] },
  { ticker: 'HINDPETRO', market: 'IN', names: ['Hindustan Petroleum'], shortNames: ['HPCL'] },
  { ticker: 'GAIL', market: 'IN', names: ['GAIL India'], shortNames: ['GAIL'] },
  { ticker: 'NTPC', market: 'IN', names: ['NTPC'] },
  { ticker: 'POWERGRID', market: 'IN', names: ['Power Grid Corporation of India', 'Power Grid Corporation'], shortNames: ['Power Grid', 'PowerGrid'] },
  { ticker: 'COALINDIA', market: 'IN', names: ['Coal India'] },
  { ticker: 'HAL', market: 'IN', names: ['Hindustan Aeronautics'], shortNames: ['HAL'] },
  { ticker: 'BEL', market: 'IN', names: ['Bharat Electronics'], shortNames: ['BEL'] },
  { ticker: 'BHEL', market: 'IN', names: ['Bharat Heavy Electricals'], shortNames: ['BHEL'] },
  { ticker: 'BDL', market: 'IN', names: ['Bharat Dynamics'] },
  { ticker: 'MAZDOCK', market: 'IN', names: ['Mazagon Dock Shipbuilders', 'Mazagon Dock'] },
  { ticker: 'IRFC', market: 'IN', names: ['Indian Railway Finance Corporation'], shortNames: ['IRFC'] },
  { ticker: 'IRCTC', market: 'IN', names: ['Indian Railway Catering and Tourism Corporation'], shortNames: ['IRCTC'] },
  { ticker: 'RVNL', market: 'IN', names: ['Rail Vikas Nigam'], shortNames: ['RVNL'] },
  { ticker: 'SUNPHARMA', market: 'IN', names: ['Sun Pharmaceutical Industries', 'Sun Pharma'] },
  { ticker: 'DRREDDY', market: 'IN', names: ["Dr Reddy's Laboratories", 'Dr Reddys Laboratories'], shortNames: ["Dr Reddy's", 'Dr Reddys'] },
  { ticker: 'DIVISLAB', market: 'IN', names: ["Divi's Laboratories"], shortNames: ["Divi's Labs", "Divi's"] },
  { ticker: 'APOLLOHOSP', market: 'IN', names: ['Apollo Hospitals Enterprise', 'Apollo Hospitals'] },
  { ticker: 'ULTRACEMCO', market: 'IN', names: ['UltraTech Cement'], shortNames: ['UltraTech'] },
  { ticker: 'GRASIM', market: 'IN', names: ['Grasim Industries'], shortNames: ['Grasim'] },
  { ticker: 'HINDALCO', market: 'IN', names: ['Hindalco Industries'], shortNames: ['Hindalco'] },
  { ticker: 'JSWSTEEL', market: 'IN', names: ['JSW Steel'] },
  { ticker: 'JSWENERGY', market: 'IN', names: ['JSW Energy'] },
  { ticker: 'VEDL', market: 'IN', names: ['Vedanta'] },
  { ticker: 'INDIGO', market: 'IN', names: ['InterGlobe Aviation'], shortNames: ['IndiGo'] },
  { ticker: 'ETERNAL', market: 'IN', names: ['Eternal'], oldNames: ['Zomato'] },
  { ticker: 'SWIGGY', market: 'IN', names: ['Swiggy'] },
  { ticker: 'PAYTM', market: 'IN', names: ['One 97 Communications'], shortNames: ['Paytm'] },
  { ticker: 'NYKAA', market: 'IN', names: ['FSN E-Commerce Ventures'], shortNames: ['Nykaa'] },
  { ticker: 'DMART', market: 'IN', names: ['Avenue Supermarts'], shortNames: ['DMart', 'D-Mart'] },
  { ticker: 'TRENT', market: 'IN', names: ['Trent'] },
  { ticker: 'DIXON', market: 'IN', names: ['Dixon Technologies'], shortNames: ['Dixon'] },
  { ticker: 'KAYNES', market: 'IN', names: ['Kaynes Technology India', 'Kaynes Technology'], shortNames: ['Kaynes'] },
  { ticker: 'SYRMA', market: 'IN', names: ['Syrma SGS Technology'], shortNames: ['Syrma SGS', 'Syrma'] },
  { ticker: 'POLYCAB', market: 'IN', names: ['Polycab India'], shortNames: ['Polycab'] },
  { ticker: 'SUZLON', market: 'IN', names: ['Suzlon Energy'], shortNames: ['Suzlon'] },
  { ticker: 'WAAREEENER', market: 'IN', names: ['Waaree Energies'], shortNames: ['Waaree'] },
  { ticker: 'PREMIERENE', market: 'IN', names: ['Premier Energies'] },
  { ticker: 'CGPOWER', market: 'IN', names: ['CG Power and Industrial Solutions'], shortNames: ['CG Power'] },
  { ticker: 'EICHERMOT', market: 'IN', names: ['Eicher Motors'], shortNames: ['Royal Enfield'] },
  { ticker: 'HEROMOTOCO', market: 'IN', names: ['Hero MotoCorp'] },
  { ticker: 'TVSMOTOR', market: 'IN', names: ['TVS Motor Company', 'TVS Motor'] },
  { ticker: 'ASHOKLEY', market: 'IN', names: ['Ashok Leyland'] },
  { ticker: 'SHRIRAMFIN', market: 'IN', names: ['Shriram Finance'] },
  { ticker: 'CHOLAFIN', market: 'IN', names: ['Cholamandalam Investment and Finance'], shortNames: ['Chola Finance'] },
  { ticker: 'PIDILITIND', market: 'IN', names: ['Pidilite Industries'], shortNames: ['Pidilite'] },
];

/** Curated US (and US-listed ADR) aliases. */
const US_ALIASES: AliasEntry[] = [
  { ticker: 'NVDA', market: 'US', names: ['Nvidia', 'NVIDIA'] },
  { ticker: 'AMD', market: 'US', names: ['Advanced Micro Devices'], shortNames: ['AMD'] },
  { ticker: 'INTC', market: 'US', names: ['Intel'] },
  { ticker: 'AVGO', market: 'US', names: ['Broadcom'] },
  { ticker: 'QCOM', market: 'US', names: ['Qualcomm'] },
  { ticker: 'MU', market: 'US', names: ['Micron Technology'], shortNames: ['Micron'] },
  { ticker: 'TSM', market: 'US', names: ['Taiwan Semiconductor Manufacturing'], shortNames: ['TSMC'] },
  { ticker: 'ASML', market: 'US', names: ['ASML Holding'], shortNames: ['ASML'] },
  { ticker: 'AMAT', market: 'US', names: ['Applied Materials'] },
  { ticker: 'LRCX', market: 'US', names: ['Lam Research'] },
  { ticker: 'KLAC', market: 'US', names: ['KLA'] },
  { ticker: 'TXN', market: 'US', names: ['Texas Instruments'] },
  { ticker: 'ADI', market: 'US', names: ['Analog Devices'] },
  { ticker: 'MRVL', market: 'US', names: ['Marvell Technology'], shortNames: ['Marvell'] },
  { ticker: 'ARM', market: 'US', names: ['Arm Holdings'] },
  { ticker: 'SMCI', market: 'US', names: ['Super Micro Computer'], shortNames: ['Supermicro'] },
  { ticker: 'DELL', market: 'US', names: ['Dell Technologies'], shortNames: ['Dell'] },
  { ticker: 'HPE', market: 'US', names: ['Hewlett Packard Enterprise'], shortNames: ['HPE'] },
  { ticker: 'ANET', market: 'US', names: ['Arista Networks'], shortNames: ['Arista'] },
  { ticker: 'CSCO', market: 'US', names: ['Cisco Systems'], shortNames: ['Cisco'] },
  { ticker: 'LITE', market: 'US', names: ['Lumentum'] },
  { ticker: 'CRDO', market: 'US', names: ['Credo Technology'] },
  { ticker: 'ALAB', market: 'US', names: ['Astera Labs'] },
  { ticker: 'AMKR', market: 'US', names: ['Amkor Technology'], shortNames: ['Amkor'] },
  { ticker: 'WDC', market: 'US', names: ['Western Digital'] },
  { ticker: 'STX', market: 'US', names: ['Seagate Technology'], shortNames: ['Seagate'] },
  { ticker: 'SNDK', market: 'US', names: ['SanDisk', 'Sandisk'] },
  { ticker: 'AAPL', market: 'US', names: ['Apple'] },
  { ticker: 'MSFT', market: 'US', names: ['Microsoft'] },
  { ticker: 'GOOGL', market: 'US', names: ['Alphabet'], shortNames: ['Google'] },
  { ticker: 'AMZN', market: 'US', names: ['Amazon'], shortNames: ['AWS', 'Amazon Web Services'] },
  { ticker: 'META', market: 'US', names: ['Meta Platforms'], shortNames: ['Meta'], oldNames: ['Facebook'] },
  { ticker: 'TSLA', market: 'US', names: ['Tesla'] },
  { ticker: 'ORCL', market: 'US', names: ['Oracle'] },
  { ticker: 'IBM', market: 'US', names: ['International Business Machines'], shortNames: ['IBM'] },
  { ticker: 'CRM', market: 'US', names: ['Salesforce'] },
  { ticker: 'NFLX', market: 'US', names: ['Netflix'] },
  { ticker: 'PLTR', market: 'US', names: ['Palantir Technologies', 'Palantir'] },
  { ticker: 'CRWV', market: 'US', names: ['CoreWeave'] },
  { ticker: 'NBIS', market: 'US', names: ['Nebius Group', 'Nebius'] },
  { ticker: 'VRT', market: 'US', names: ['Vertiv Holdings', 'Vertiv'] },
  { ticker: 'ETN', market: 'US', names: ['Eaton'] },
  { ticker: 'GEV', market: 'US', names: ['GE Vernova'] },
  { ticker: 'GE', market: 'US', names: ['GE Aerospace'], oldNames: ['General Electric'] },
  { ticker: 'CEG', market: 'US', names: ['Constellation Energy'] },
  { ticker: 'VST', market: 'US', names: ['Vistra'] },
  { ticker: 'TLN', market: 'US', names: ['Talen Energy'] },
  { ticker: 'OKLO', market: 'US', names: ['Oklo'] },
  { ticker: 'SMR', market: 'US', names: ['NuScale Power', 'NuScale'] },
  { ticker: 'CCJ', market: 'US', names: ['Cameco'] },
  { ticker: 'LEU', market: 'US', names: ['Centrus Energy'], shortNames: ['Centrus'] },
  { ticker: 'BWXT', market: 'US', names: ['BWX Technologies'] },
  { ticker: 'MP', market: 'US', names: ['MP Materials'] },
  { ticker: 'ALB', market: 'US', names: ['Albemarle'] },
  { ticker: 'FCX', market: 'US', names: ['Freeport-McMoRan', 'Freeport McMoRan'] },
  { ticker: 'XOM', market: 'US', names: ['Exxon Mobil', 'ExxonMobil'], shortNames: ['Exxon'] },
  { ticker: 'CVX', market: 'US', names: ['Chevron'] },
  { ticker: 'LMT', market: 'US', names: ['Lockheed Martin'] },
  { ticker: 'RTX', market: 'US', names: ['RTX'], oldNames: ['Raytheon Technologies', 'Raytheon'] },
  { ticker: 'NOC', market: 'US', names: ['Northrop Grumman'] },
  { ticker: 'GD', market: 'US', names: ['General Dynamics'] },
  { ticker: 'BA', market: 'US', names: ['Boeing'] },
  { ticker: 'LHX', market: 'US', names: ['L3Harris Technologies', 'L3Harris'] },
  { ticker: 'KTOS', market: 'US', names: ['Kratos Defense & Security Solutions'], shortNames: ['Kratos'] },
  { ticker: 'RKLB', market: 'US', names: ['Rocket Lab'] },
  { ticker: 'JPM', market: 'US', names: ['JPMorgan Chase', 'JPMorgan', 'JP Morgan'] },
  { ticker: 'GS', market: 'US', names: ['Goldman Sachs'] },
  { ticker: 'MS', market: 'US', names: ['Morgan Stanley'] },
  { ticker: 'BAC', market: 'US', names: ['Bank of America'] },
  { ticker: 'C', market: 'US', names: ['Citigroup'], shortNames: ['Citi'] },
  { ticker: 'WFC', market: 'US', names: ['Wells Fargo'] },
  { ticker: 'BRK.B', market: 'US', names: ['Berkshire Hathaway'] },
  { ticker: 'WMT', market: 'US', names: ['Walmart'] },
  { ticker: 'COST', market: 'US', names: ['Costco Wholesale', 'Costco'] },
  { ticker: 'LLY', market: 'US', names: ['Eli Lilly'] },
  { ticker: 'NVO', market: 'US', names: ['Novo Nordisk'] },
  { ticker: 'PFE', market: 'US', names: ['Pfizer'] },
  { ticker: 'UNH', market: 'US', names: ['UnitedHealth Group', 'UnitedHealth'] },
  { ticker: 'SKHYNIX', market: 'GLOBAL', names: ['SK hynix', 'SK Hynix'] },
];

// ── normalisation ──────────────────────────────────────────────────────

interface Tok { norm: string; raw: string; start: number; end: number }

const TOKEN_RE = /&|[A-Za-z0-9][A-Za-z0-9.'’]*/g;

function normWord(w: string): string {
  if (w === '&') return 'and';
  let s = w.replace(/’/g, "'");
  s = s.replace(/'s$/i, '').replace(/['.]/g, '');
  return s.toLowerCase();
}

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    let raw = m[0];
    // a trailing sentence period / apostrophe is not part of the word
    raw = raw.replace(/[.'’]+$/, '');
    if (!raw) continue;
    const n = normWord(raw);
    if (!n) continue;
    out.push({ norm: n, raw, start: m.index, end: m.index + raw.length });
  }
  return out;
}

/** Normalise an alias phrase to the token form used for lookup ("Larsen & Toubro Ltd." → "larsen and toubro"). */
export function normalizeCompanyName(name: string): string {
  let s = String(name || '').trim();
  for (let i = 0; i < 2; i++) s = s.replace(/[,\s]+$/, '').replace(LEGAL_SUFFIX, '').trim();
  return tokenize(s).map((t) => t.norm).join(' ');
}

// ── index ──────────────────────────────────────────────────────────────

interface PhraseOwner {
  ticker: string;
  market: AliasMarket;
  kind: MatchKind;
  confidence: number;
  words: number;
  /** Name written in capitals in the table ("SBI", "L&T"): text must be in capitals too. */
  acronym: boolean;
  /** Name built only from everyday words: text must be Title Case. */
  generic: boolean;
}

export interface AliasIndex {
  phrases: Map<string, PhraseOwner>;
  tickers: Map<string, AliasMarket>;
  maxWords: number;
  blocked: string[][];
}

export interface ExtraAlias {
  ticker: string;
  market: AliasMarket;
  name: string;
  /** Lower-trust sources (symbol catalogue): one-word names are skipped. */
  lowTrust?: boolean;
}

function isAcronym(name: string): boolean {
  const letters = name.replace(/[^A-Za-z]/g, '');
  return letters.length >= 2 && letters === letters.toUpperCase() && !/\s/.test(name.trim());
}

function addPhrase(idx: AliasIndex, ticker: string, market: AliasMarket, name: string, kind: MatchKind, confidence: number, lowTrust = false) {
  const norm = normalizeCompanyName(name);
  if (!norm) return;
  const words = norm.split(' ');
  if (lowTrust && words.length < 2) return;
  const acronym = isAcronym(name.replace(LEGAL_SUFFIX, '').trim());
  const significant = words.filter((w) => !NAME_PARTICLES.has(w));
  if (!significant.length) return;
  const generic = !acronym && significant.every((w) => GENERIC_WORDS.has(w));
  // a one-word everyday name ("Power", "Star") is never a usable alias
  if (generic && significant.length < 2) return;
  if (!acronym && words.length === 1 && norm.length < 3) return;
  if (acronym && TICKER_STOP_WORDS.has(name.toUpperCase()) && !/&/.test(name)) return;
  if (idx.phrases.has(norm)) return; // first registration wins (curated before catalogue)
  idx.phrases.set(norm, { ticker, market, kind, confidence, words: words.length, acronym, generic });
  if (words.length > idx.maxWords) idx.maxWords = words.length;
}

function addTicker(idx: AliasIndex, ticker: string, market: AliasMarket) {
  const t = String(ticker || '').trim().toUpperCase();
  if (t && !idx.tickers.has(t)) idx.tickers.set(t, market);
}

/** Build the alias index: curated tables + NSE_TICKER_NAMES + optional runtime extras (bench, symbol catalogue). */
export function buildAliasIndex(extra: ReadonlyArray<ExtraAlias> = [], base: ReadonlyArray<AliasEntry> = [...IN_ALIASES, ...US_ALIASES]): AliasIndex {
  const idx: AliasIndex = { phrases: new Map(), tickers: new Map(), maxWords: 1, blocked: NOT_COMPANY_PHRASES.map((p) => normalizeCompanyName(p).split(' ')) };
  for (const e of base) {
    if (!e.names?.length && !e.shortNames?.length && !e.oldNames?.length) continue;
    addTicker(idx, e.ticker, e.market);
    for (const n of e.names || []) addPhrase(idx, e.ticker, e.market, n, 'name', 0.9);
    for (const n of e.shortNames || []) addPhrase(idx, e.ticker, e.market, n, 'short-name', 0.8);
    for (const n of e.oldNames || []) addPhrase(idx, e.ticker, e.market, n, 'old-name', 0.75);
  }
  for (const [ticker, name] of Object.entries(NSE_TICKER_NAMES)) {
    addTicker(idx, ticker, 'IN');
    addPhrase(idx, ticker, 'IN', name, 'name', 0.9);
  }
  for (const x of extra) {
    if (!x?.ticker) continue;
    addTicker(idx, x.ticker, x.market);
    if (x.name) addPhrase(idx, x.ticker.toUpperCase(), x.market, x.name, 'name', x.lowTrust ? 0.8 : 0.85, !!x.lowTrust);
  }
  return idx;
}

let _default: AliasIndex | null = null;
/** The static index (curated + NSE_TICKER_NAMES). */
export function defaultAliasIndex(): AliasIndex {
  if (!_default) _default = buildAliasIndex();
  return _default;
}

// ── matching ───────────────────────────────────────────────────────────

const EXCHANGE_RE = /\b(NSE|BSE|NASDAQ|NYSE|NYSEARCA|NYSEAMERICAN|AMEX)\s*:\s*([A-Za-z0-9][A-Za-z0-9&.-]{0,14})/g;
const PAREN_RE = /\(\s*([A-Z][A-Z0-9&.-]{1,9})\s*\)/g;
const DOLLAR_RE = /(^|[^\w$])\$([A-Z]{1,6})\b/g;
const BARE_RE = /\b[A-Z][A-Z0-9&-]{2,14}\b/g;

/** Strip a trailing " - Publisher" segment (Google News style) so the publisher is never tagged. */
export function stripPublisherSuffix(title: string): string {
  return String(title || '').replace(/\s+[-–—|]\s+[^-–—|]{2,40}$/, '').trim();
}

function capitalised(raw: string): boolean {
  const c = raw.charAt(0);
  return c >= 'A' && c <= 'Z' || /\d/.test(c);
}

function isShouting(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 12) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length > 0.7;
}

export interface MatchOptions {
  /** Drop a trailing " - Publisher" segment before matching (default true). */
  stripPublisher?: boolean;
}

/** Find companies named in `text`. Longest match wins; result is ordered by position, one entry per ticker. */
export function matchCompanies(text: string, index: AliasIndex = defaultAliasIndex(), opts: MatchOptions = {}): CompanyMatch[] {
  const src = opts.stripPublisher === false ? String(text || '') : stripPublisherSuffix(String(text || ''));
  if (!src) return [];
  type Cand = CompanyMatch & { end: number };
  const cands: Cand[] = [];
  const toks = tokenize(src);

  // blocked spans ("Reserve Bank of India")
  const blockedSpans: Array<[number, number]> = [];
  for (const b of index.blocked) {
    for (let i = 0; i + b.length <= toks.length; i++) {
      let ok = true;
      for (let k = 0; k < b.length; k++) if (toks[i + k].norm !== b[k]) { ok = false; break; }
      if (ok) blockedSpans.push([toks[i].start, toks[i + b.length - 1].end]);
    }
  }
  const inBlocked = (s: number, e: number) => blockedSpans.some(([bs, be]) => s < be && e > bs);

  // names
  for (let i = 0; i < toks.length; i++) {
    const maxN = Math.min(index.maxWords, toks.length - i);
    for (let n = maxN; n >= 1; n--) {
      const key = toks.slice(i, i + n).map((t) => t.norm).join(' ');
      const owner = index.phrases.get(key);
      if (!owner) continue;
      const span = toks.slice(i, i + n);
      if (owner.acronym) {
        if (span.some((t) => { const r = t.raw.replace(/['’]s$/i, ''); return r !== r.toUpperCase(); })) continue;
      } else if (owner.generic) {
        if (span.some((t) => !NAME_PARTICLES.has(t.norm) && !capitalised(t.raw))) continue;
      } else if (n === 1) {
        if (!capitalised(span[0].raw)) continue;
      } else if (!capitalised(span[0].raw)) {
        continue;   // zzz1186 — a lower-case phrase ("₹949-crore power grid orders") is a common noun, not the company Power Grid
      }
      const start = span[0].start, end = span[n - 1].end;
      let conf = owner.confidence;
      if (owner.words === 1 && !owner.acronym) conf = Math.min(conf, 0.7);
      cands.push({ ticker: owner.ticker, market: owner.market, matched: src.slice(start, end), kind: owner.kind, confidence: conf, index: start, end });
      break; // longest phrase starting at this token
    }
  }

  // explicit exchange symbols
  EXCHANGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EXCHANGE_RE.exec(src)) !== null) {
    const sym = m[2].replace(/[.-]+$/, '').toUpperCase();
    if (!sym || /^\d+$/.test(sym)) continue;
    const ex = m[1].toUpperCase();
    const market: AliasMarket = ex === 'NSE' || ex === 'BSE' ? 'IN' : 'US';
    const known = index.tickers.has(sym);
    cands.push({ ticker: sym, market: index.tickers.get(sym) || market, matched: m[0], kind: 'symbol-exchange', confidence: known ? 0.95 : 0.85, index: m.index, end: m.index + m[0].length });
  }
  // (XYZ) and $XYZ — known tickers only
  PAREN_RE.lastIndex = 0;
  while ((m = PAREN_RE.exec(src)) !== null) {
    const sym = m[1].toUpperCase();
    if (TICKER_STOP_WORDS.has(sym) || !index.tickers.has(sym)) continue;
    cands.push({ ticker: sym, market: index.tickers.get(sym)!, matched: m[0], kind: 'symbol-explicit', confidence: 0.85, index: m.index, end: m.index + m[0].length });
  }
  DOLLAR_RE.lastIndex = 0;
  while ((m = DOLLAR_RE.exec(src)) !== null) {
    const sym = m[2].toUpperCase();
    if (TICKER_STOP_WORDS.has(sym) || !index.tickers.has(sym)) continue;
    const at = m.index + m[1].length;
    cands.push({ ticker: sym, market: index.tickers.get(sym)!, matched: `$${m[2]}`, kind: 'symbol-explicit', confidence: 0.85, index: at, end: at + m[2].length + 1 });
  }
  // bare all-caps tokens that are known tickers (not in a shouted headline)
  if (!isShouting(src)) {
    BARE_RE.lastIndex = 0;
    while ((m = BARE_RE.exec(src)) !== null) {
      const sym = m[0];
      if (TICKER_STOP_WORDS.has(sym) || !index.tickers.has(sym)) continue;
      // "HAL-built" / "BHEL's" are fine; "e-HAL" style fragments are not
      if (m.index > 0 && /[A-Za-z0-9$:]/.test(src.charAt(m.index - 1))) continue;
      cands.push({ ticker: sym, market: index.tickers.get(sym)!, matched: sym, kind: 'symbol-bare', confidence: 0.6, index: m.index, end: m.index + sym.length });
    }
  }

  // resolve overlaps: longer span first, then higher confidence
  cands.sort((a, b) => (b.end - b.index) - (a.end - a.index) || b.confidence - a.confidence || a.index - b.index);
  const taken: Cand[] = [];
  for (const c of cands) {
    if (inBlocked(c.index, c.end)) continue;
    if (taken.some((t) => c.index < t.end && c.end > t.index)) continue;
    taken.push(c);
  }
  taken.sort((a, b) => a.index - b.index);
  const out: CompanyMatch[] = [];
  const seen = new Map<string, CompanyMatch>();
  for (const c of taken) {
    const prev = seen.get(c.ticker);
    if (prev) { if (c.confidence > prev.confidence) prev.confidence = c.confidence; continue; }
    const { end: _end, ...rest } = c;
    seen.set(c.ticker, rest);
    out.push(rest);
  }
  return out;
}

/** Tickers named in `text`, in order of first appearance (max `limit`). */
export function tagTickers(text: string, index: AliasIndex = defaultAliasIndex(), limit = 3, minConfidence = 0): string[] {
  return matchCompanies(text, index).filter((m) => m.confidence >= minConfidence).map((m) => m.ticker).slice(0, limit);
}
