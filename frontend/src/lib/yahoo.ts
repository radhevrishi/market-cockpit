// Yahoo Finance API utility for server-side data fetching
// Uses the v8 chart API and v7 quote API

const YF_BASE = 'https://query1.finance.yahoo.com';
const YF_BASE2 = 'https://query2.finance.yahoo.com';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

// In-memory cache
const cache = new Map<string, { data: any; ts: number }>();

function getCached(key: string, ttlMs: number): any | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data;
  return null;
}

function setCache(key: string, data: any) {
  cache.set(key, { data, ts: Date.now() });
  // Prevent unbounded growth
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < 100; i++) cache.delete(oldest[i][0]);
  }
}

// Fetch a single quote using v8 chart API
export async function fetchChart(symbol: string, range = '1d', interval = '1d') {
  const cacheKey = `chart:${symbol}:${range}:${interval}`;
  const cached = getCached(cacheKey, 5 * 60 * 1000); // 5 min cache
  if (cached) return cached;

  try {
    const url = `${YF_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
    const res = await fetch(url, { headers: HEADERS, next: { revalidate: 300 }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    // PATCH 0771: previousClose fallback chain now also drives the
    // changePercent calc (was: only meta.previousClose was checked, so
    // a quote with only chartPreviousClose returned changePercent=0
    // even when price + chartPreviousClose were both valid).
    const _price = meta.regularMarketPrice || 0;
    const _prevClose = meta.previousClose || meta.chartPreviousClose || 0;
    const _change = (_price > 0 && _prevClose > 0) ? (_price - _prevClose) : 0;
    const _changePercent = (_price > 0 && _prevClose > 0) ? ((_price - _prevClose) / _prevClose) * 100 : 0;
    const data = {
      symbol: meta.symbol,
      shortName: meta.shortName || meta.symbol,
      currency: meta.currency,
      regularMarketPrice: _price,
      previousClose: _prevClose,
      change: _change,
      changePercent: _changePercent,
      volume: meta.regularMarketVolume || 0,
      marketCap: 0, // not available in chart API
      timestamps: result.timestamp || [],
      closes: result.indicators?.quote?.[0]?.close || [],
    };

    setCache(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}

// Batch fetch quotes using v7 quote API (more efficient for multiple symbols)
export async function fetchQuotes(symbols: string[]): Promise<any[]> {
  if (symbols.length === 0) return [];

  const cacheKey = `quotes:${symbols.sort().join(',')}`;
  const cached = getCached(cacheKey, 5 * 60 * 1000);
  if (cached) return cached;

  try {
    // PATCH 0788 — concurrent batching with rate-limit-friendly settings.
    // P0787 used CONC=8 + 8s timeout — Yahoo rate-limited after 4-5
    // batches and resolved only 239/755 tickers. Backing off to CONC=4
    // (gentler) + 12s timeout (Yahoo cold quotes can be slow), with a
    // 100ms gap between slabs. For 755 symbols (38 batches) that's
    // ~10 slabs × ~1.5s = ~15s total — well within Vercel maxDuration
    // and reliable.
    const BATCH = 20;
    const CONC  = 4;
    const SLAB_GAP_MS = 100;
    const chunks: string[][] = [];
    for (let i = 0; i < symbols.length; i += BATCH) {
      chunks.push(symbols.slice(i, i + BATCH));
    }

    const allResults: any[] = [];
    const fetchOne = async (chunk: string[]) => {
      const url = `${YF_BASE2}/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}`;
      try {
        const res = await fetch(url, { headers: HEADERS, next: { revalidate: 300 }, signal: AbortSignal.timeout(12_000) });
        if (!res.ok) return [];
        const json = await res.json();
        return json?.quoteResponse?.result || [];
      } catch { return []; }
    };
    for (let i = 0; i < chunks.length; i += CONC) {
      const slab = chunks.slice(i, i + CONC);
      const results = await Promise.all(slab.map(fetchOne));
      for (const arr of results) allResults.push(...arr);
      if (i + CONC < chunks.length) await new Promise(r => setTimeout(r, SLAB_GAP_MS));
    }

    setCache(cacheKey, allResults);
    return allResults;
  } catch {
    return [];
  }
}

// zzz59: Yahoo /v7/finance/spark — works from Railway egress when /v7/finance/quote
// returns 401 (crumb-gated). Returns price + chartPreviousClose + longName per symbol.
// Use this as the price-fallback when the v7/quote batch comes back empty.
// Shape: Map<base-symbol-without-.NS-suffix, { lastPrice, prevClose, pChange, companyName }>
export async function fetchYahooSparkBatch(symbolsWithSuffix: string[]): Promise<Map<string, { lastPrice: number | null; prevClose: number | null; pChange: number | null; companyName: string | null }>> {
  const out = new Map<string, { lastPrice: number | null; prevClose: number | null; pChange: number | null; companyName: string | null }>();
  if (symbolsWithSuffix.length === 0) return out;
  const BATCH = 20;
  const CONC = 4;
  const GAP_MS = 120;
  const chunks: string[][] = [];
  for (let i = 0; i < symbolsWithSuffix.length; i += BATCH) {
    chunks.push(symbolsWithSuffix.slice(i, i + BATCH));
  }
  const fetchOne = async (chunk: string[]) => {
    const url = `${YF_BASE}/v7/finance/spark?symbols=${encodeURIComponent(chunk.join(','))}&range=1d&interval=1d`;
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return [];
      const json: any = await res.json();
      return json?.spark?.result || [];
    } catch { return []; }
  };
  for (let i = 0; i < chunks.length; i += CONC) {
    const slab = chunks.slice(i, i + CONC);
    const results = await Promise.all(slab.map(fetchOne));
    for (const arr of results) {
      for (const r of arr) {
        const sym = String(r?.symbol || '');
        const resp = (r?.response && r.response[0]) || {};
        const meta = resp?.meta || {};
        const price = (typeof meta.regularMarketPrice === 'number' && meta.regularMarketPrice > 0) ? meta.regularMarketPrice : null;
        const prevClose = (typeof meta.previousClose === 'number' && meta.previousClose > 0) ? meta.previousClose : (typeof meta.chartPreviousClose === 'number' && meta.chartPreviousClose > 0 ? meta.chartPreviousClose : null);
        const pChange = (price !== null && prevClose !== null) ? ((price - prevClose) / prevClose) * 100 : null;
        const companyName = meta.longName || meta.shortName || null;
        if (!sym) continue;
        // Index by base (no .NS / .BO suffix) for easy multibagger lookup
        const baseSym = sym.replace(/\.(NS|BO)$/i, '');
        out.set(baseSym, { lastPrice: price, prevClose, pChange, companyName });
      }
    }
    if (i + CONC < chunks.length) await new Promise(r => setTimeout(r, GAP_MS));
  }
  return out;
}

// Fetch quotes with fallback to chart API
export async function fetchQuotesWithFallback(symbols: string[]): Promise<any[]> {
  // Try batch v7 first
  let results = await fetchQuotes(symbols);

  if (results.length > 0) return results;

  // Fallback: fetch individually via chart API (v8 chart — no crumb needed).
  // PATCH 0964: Yahoo v7 /finance/quote now returns 401 Unauthorized for
  // every symbol (crumb-gated), so ALL traffic lands here. The old code ran an
  // unbounded Promise.all over every symbol at once, which Yahoo rate-limited —
  // only ~20% resolved (the "22 of 100 largecaps" thin-movers bug). Bounded
  // concurrency (CONC=6 + 120ms slab gap) resolves ~95%+ in a few seconds.
  const CONC = 6;
  const GAP_MS = 120;
  const out: any[] = [];
  for (let i = 0; i < symbols.length; i += CONC) {
    const slab = symbols.slice(i, i + CONC);
    const charts = await Promise.all(slab.map((sym) => fetchChart(sym)));
    for (const chart of charts) {
      if (!chart) continue;
      out.push({
        symbol: chart.symbol,
        shortName: chart.shortName,
        regularMarketPrice: chart.regularMarketPrice,
        regularMarketChange: chart.change,
        regularMarketChangePercent: chart.changePercent,
        regularMarketVolume: chart.volume,
        regularMarketPreviousClose: chart.previousClose,
        marketCap: 0,
      });
    }
    if (i + CONC < symbols.length) await new Promise((r) => setTimeout(r, GAP_MS));
  }
  return out;
}

// NIFTY 50 constituents with sectors
export const NIFTY50: { ticker: string; company: string; sector: string }[] = [
  { ticker: 'RELIANCE.NS', company: 'Reliance Industries', sector: 'Energy' },
  { ticker: 'TCS.NS', company: 'Tata Consultancy Services', sector: 'IT' },
  { ticker: 'HDFCBANK.NS', company: 'HDFC Bank', sector: 'Banking' },
  { ticker: 'INFY.NS', company: 'Infosys', sector: 'IT' },
  { ticker: 'ICICIBANK.NS', company: 'ICICI Bank', sector: 'Banking' },
  { ticker: 'HINDUNILVR.NS', company: 'Hindustan Unilever', sector: 'FMCG' },
  { ticker: 'ITC.NS', company: 'ITC', sector: 'FMCG' },
  { ticker: 'SBIN.NS', company: 'State Bank of India', sector: 'Banking' },
  { ticker: 'BHARTIARTL.NS', company: 'Bharti Airtel', sector: 'Telecom' },
  { ticker: 'KOTAKBANK.NS', company: 'Kotak Mahindra Bank', sector: 'Banking' },
  { ticker: 'LT.NS', company: 'Larsen & Toubro', sector: 'Capital Goods' },
  { ticker: 'HCLTECH.NS', company: 'HCL Technologies', sector: 'IT' },
  { ticker: 'AXISBANK.NS', company: 'Axis Bank', sector: 'Banking' },
  { ticker: 'ASIANPAINT.NS', company: 'Asian Paints', sector: 'Consumer Durables' },
  { ticker: 'MARUTI.NS', company: 'Maruti Suzuki', sector: 'Auto' },
  { ticker: 'SUNPHARMA.NS', company: 'Sun Pharma', sector: 'Pharma' },
  { ticker: 'TITAN.NS', company: 'Titan Company', sector: 'Consumer Durables' },
  { ticker: 'BAJFINANCE.NS', company: 'Bajaj Finance', sector: 'Financial Services' },
  { ticker: 'DMART.NS', company: 'Avenue Supermarts', sector: 'Retail' },
  { ticker: 'ULTRACEMCO.NS', company: 'UltraTech Cement', sector: 'Cement' },
  { ticker: 'NTPC.NS', company: 'NTPC', sector: 'Power' },
  { ticker: 'ONGC.NS', company: 'ONGC', sector: 'Energy' },
  { ticker: 'NESTLEIND.NS', company: 'Nestle India', sector: 'FMCG' },
  { ticker: 'WIPRO.NS', company: 'Wipro', sector: 'IT' },
  { ticker: 'M&M.NS', company: 'Mahindra & Mahindra', sector: 'Auto' },
  { ticker: 'JSWSTEEL.NS', company: 'JSW Steel', sector: 'Metals' },
  { ticker: 'POWERGRID.NS', company: 'Power Grid Corp', sector: 'Power' },
  { ticker: 'TATASTEEL.NS', company: 'Tata Steel', sector: 'Metals' },
  { ticker: 'TATAMOTORS.NS', company: 'Tata Motors', sector: 'Auto' },
  { ticker: 'ADANIENT.NS', company: 'Adani Enterprises', sector: 'Diversified' },
  { ticker: 'ADANIPORTS.NS', company: 'Adani Ports', sector: 'Infrastructure' },
  { ticker: 'DIVISLAB.NS', company: 'Divis Laboratories', sector: 'Pharma' },
  { ticker: 'COALINDIA.NS', company: 'Coal India', sector: 'Mining' },
  { ticker: 'BAJAJFINSV.NS', company: 'Bajaj Finserv', sector: 'Financial Services' },
  { ticker: 'TECHM.NS', company: 'Tech Mahindra', sector: 'IT' },
  { ticker: 'DRREDDY.NS', company: "Dr Reddy's Labs", sector: 'Pharma' },
  { ticker: 'CIPLA.NS', company: 'Cipla', sector: 'Pharma' },
  { ticker: 'BRITANNIA.NS', company: 'Britannia Industries', sector: 'FMCG' },
  { ticker: 'APOLLOHOSP.NS', company: 'Apollo Hospitals', sector: 'Healthcare' },
  { ticker: 'EICHERMOT.NS', company: 'Eicher Motors', sector: 'Auto' },
  { ticker: 'TATACONSUM.NS', company: 'Tata Consumer Products', sector: 'FMCG' },
  { ticker: 'GRASIM.NS', company: 'Grasim Industries', sector: 'Cement' },
  { ticker: 'INDUSINDBK.NS', company: 'IndusInd Bank', sector: 'Banking' },
  { ticker: 'BPCL.NS', company: 'BPCL', sector: 'Energy' },
  { ticker: 'HEROMOTOCO.NS', company: 'Hero MotoCorp', sector: 'Auto' },
  { ticker: 'SBILIFE.NS', company: 'SBI Life Insurance', sector: 'Insurance' },
  { ticker: 'HDFCLIFE.NS', company: 'HDFC Life Insurance', sector: 'Insurance' },
  { ticker: 'BAJAJ-AUTO.NS', company: 'Bajaj Auto', sector: 'Auto' },
  { ticker: 'HINDALCO.NS', company: 'Hindalco Industries', sector: 'Metals' },
  { ticker: 'SHRIRAMFIN.NS', company: 'Shriram Finance', sector: 'Financial Services' },
];

// PATCH 0772 (reverted P0773) — User feedback: stop relying on Yahoo
// for Indian data; use Screener / Trendlyne / NSE / BSE scrapers we
// already have. Keeping the constant in case a future Indian-source
// failure makes a curated fallback list useful, but it's no longer
// wired into the quotes endpoint.
export const _NIFTY_MIDSMALL_REPS_LEGACY: { ticker: string; company: string; sector: string; cap: 'Mid' | 'Small' }[] = [
  // ── Midcap reps ─────────────────────────────────────────────
  { ticker: 'POLYCAB.NS',    company: 'Polycab India',           sector: 'Capital Goods',       cap: 'Mid' },
  { ticker: 'PIIND.NS',      company: 'PI Industries',           sector: 'Chemicals',           cap: 'Mid' },
  { ticker: 'PERSISTENT.NS', company: 'Persistent Systems',      sector: 'IT',                  cap: 'Mid' },
  { ticker: 'COFORGE.NS',    company: 'Coforge',                 sector: 'IT',                  cap: 'Mid' },
  { ticker: 'LICHSGFIN.NS',  company: 'LIC Housing Finance',     sector: 'Financial Services',  cap: 'Mid' },
  { ticker: 'MPHASIS.NS',    company: 'Mphasis',                 sector: 'IT',                  cap: 'Mid' },
  { ticker: 'OBEROIRLTY.NS', company: 'Oberoi Realty',           sector: 'Realty',              cap: 'Mid' },
  { ticker: 'BHEL.NS',       company: 'BHEL',                    sector: 'Capital Goods',       cap: 'Mid' },
  { ticker: 'CONCOR.NS',     company: 'Container Corp',          sector: 'Logistics',           cap: 'Mid' },
  { ticker: 'BIOCON.NS',     company: 'Biocon',                  sector: 'Pharma',              cap: 'Mid' },
  { ticker: 'AUBANK.NS',     company: 'AU Small Finance Bank',   sector: 'Banking',             cap: 'Mid' },
  { ticker: 'MARICO.NS',     company: 'Marico',                  sector: 'FMCG',                cap: 'Mid' },
  { ticker: 'JUBLFOOD.NS',   company: 'Jubilant FoodWorks',      sector: 'Consumer',            cap: 'Mid' },
  { ticker: 'PAGEIND.NS',    company: 'Page Industries',         sector: 'Apparel',             cap: 'Mid' },
  { ticker: 'COLPAL.NS',     company: 'Colgate-Palmolive',       sector: 'FMCG',                cap: 'Mid' },
  { ticker: 'PETRONET.NS',   company: 'Petronet LNG',            sector: 'Energy',              cap: 'Mid' },
  { ticker: 'IRCTC.NS',      company: 'IRCTC',                   sector: 'Travel',              cap: 'Mid' },
  { ticker: 'TVSMOTOR.NS',   company: 'TVS Motor Company',       sector: 'Auto',                cap: 'Mid' },
  { ticker: 'TORNTPHARM.NS', company: 'Torrent Pharmaceuticals', sector: 'Pharma',              cap: 'Mid' },
  { ticker: 'CUMMINSIND.NS', company: 'Cummins India',           sector: 'Capital Goods',       cap: 'Mid' },
  { ticker: 'ZYDUSLIFE.NS',  company: 'Zydus Lifesciences',      sector: 'Pharma',              cap: 'Mid' },
  { ticker: 'AUROPHARMA.NS', company: 'Aurobindo Pharma',        sector: 'Pharma',              cap: 'Mid' },
  { ticker: 'IDFCFIRSTB.NS', company: 'IDFC First Bank',         sector: 'Banking',             cap: 'Mid' },
  { ticker: 'PFC.NS',        company: 'Power Finance Corp',      sector: 'Financial Services',  cap: 'Mid' },
  { ticker: 'RECLTD.NS',     company: 'REC Limited',             sector: 'Financial Services',  cap: 'Mid' },
  { ticker: 'SAIL.NS',       company: 'SAIL',                    sector: 'Metals',              cap: 'Mid' },
  { ticker: 'INDIANB.NS',    company: 'Indian Bank',             sector: 'Banking',             cap: 'Mid' },
  { ticker: 'BHARATFORG.NS', company: 'Bharat Forge',            sector: 'Auto Ancillary',      cap: 'Mid' },
  { ticker: 'GMRINFRA.NS',   company: 'GMR Airports',            sector: 'Infrastructure',      cap: 'Mid' },
  { ticker: 'HAL.NS',        company: 'Hindustan Aeronautics',   sector: 'Defence',             cap: 'Mid' },
  // ── Smallcap reps ───────────────────────────────────────────
  { ticker: 'IIFL.NS',       company: 'IIFL Finance',            sector: 'Financial Services',  cap: 'Small' },
  { ticker: 'KEI.NS',        company: 'KEI Industries',          sector: 'Capital Goods',       cap: 'Small' },
  { ticker: 'CYIENT.NS',     company: 'Cyient',                  sector: 'IT',                  cap: 'Small' },
  { ticker: 'CHOLAFIN.NS',   company: 'Cholamandalam Fin',       sector: 'Financial Services',  cap: 'Small' },
  { ticker: 'JBCHEPHARM.NS', company: 'JB Chemicals',            sector: 'Pharma',              cap: 'Small' },
  { ticker: 'CRISIL.NS',     company: 'CRISIL',                  sector: 'Financial Services',  cap: 'Small' },
  { ticker: 'TRENT.NS',      company: 'Trent',                   sector: 'Retail',              cap: 'Small' },
  { ticker: 'KPITTECH.NS',   company: 'KPIT Technologies',       sector: 'IT',                  cap: 'Small' },
  { ticker: 'TATAELXSI.NS',  company: 'Tata Elxsi',              sector: 'IT',                  cap: 'Small' },
  { ticker: 'LAURUSLABS.NS', company: 'Laurus Labs',             sector: 'Pharma',              cap: 'Small' },
  { ticker: 'CDSL.NS',       company: 'CDSL',                    sector: 'Financial Services',  cap: 'Small' },
  { ticker: 'INDIGO.NS',     company: 'InterGlobe Aviation',     sector: 'Aviation',            cap: 'Small' },
  { ticker: 'NAM-INDIA.NS',  company: 'Nippon Life Asset Mgmt',  sector: 'Financial Services',  cap: 'Small' },
  { ticker: 'IDEA.NS',       company: 'Vodafone Idea',           sector: 'Telecom',             cap: 'Small' },
  { ticker: 'IRFC.NS',       company: 'Indian Railway Finance',  sector: 'Financial Services',  cap: 'Small' },
  { ticker: 'GRINDWELL.NS',  company: 'Grindwell Norton',        sector: 'Capital Goods',       cap: 'Small' },
  { ticker: 'MAZDOCK.NS',    company: 'Mazagon Dock',            sector: 'Defence',             cap: 'Small' },
  { ticker: 'BSE.NS',        company: 'BSE Limited',             sector: 'Financial Services',  cap: 'Small' },
  { ticker: 'POLICYBZR.NS',  company: 'PB Fintech',              sector: 'Financial Services',  cap: 'Small' },
  { ticker: 'TANLA.NS',      company: 'Tanla Platforms',         sector: 'IT',                  cap: 'Small' },
  { ticker: 'NHPC.NS',       company: 'NHPC',                    sector: 'Power',               cap: 'Small' },
  { ticker: 'SCHAEFFLER.NS', company: 'Schaeffler India',        sector: 'Auto Ancillary',      cap: 'Small' },
  { ticker: 'BLUESTARCO.NS', company: 'Blue Star',               sector: 'Consumer Durables',   cap: 'Small' },
  { ticker: 'KRBL.NS',       company: 'KRBL',                    sector: 'FMCG',                cap: 'Small' },
  { ticker: 'BALRAMCHIN.NS', company: 'Balrampur Chini',         sector: 'Sugar',               cap: 'Small' },
  { ticker: 'EXIDEIND.NS',   company: 'Exide Industries',        sector: 'Auto Ancillary',      cap: 'Small' },
  { ticker: 'ABCAPITAL.NS',  company: 'Aditya Birla Capital',    sector: 'Financial Services',  cap: 'Small' },
  { ticker: 'GUJGASLTD.NS',  company: 'Gujarat Gas',              sector: 'Energy',              cap: 'Small' },
  { ticker: 'IEX.NS',        company: 'Indian Energy Exchange',  sector: 'Power',               cap: 'Small' },
  { ticker: 'GLENMARK.NS',   company: 'Glenmark Pharma',         sector: 'Pharma',              cap: 'Small' },
];

// US S&P 500 top stocks
export const US_TOP: { ticker: string; company: string; sector: string }[] = [
  // Mega Cap Tech
  { ticker: 'AAPL', company: 'Apple', sector: 'Technology' },
  { ticker: 'MSFT', company: 'Microsoft', sector: 'Technology' },
  { ticker: 'NVDA', company: 'NVIDIA', sector: 'Technology' },
  { ticker: 'GOOGL', company: 'Alphabet', sector: 'Technology' },
  { ticker: 'AMZN', company: 'Amazon', sector: 'Consumer Cyclical' },
  { ticker: 'META', company: 'Meta Platforms', sector: 'Technology' },
  { ticker: 'TSLA', company: 'Tesla', sector: 'Auto' },
  { ticker: 'AVGO', company: 'Broadcom', sector: 'Technology' },
  { ticker: 'ORCL', company: 'Oracle', sector: 'Technology' },
  { ticker: 'CRM', company: 'Salesforce', sector: 'Technology' },
  { ticker: 'AMD', company: 'AMD', sector: 'Technology' },
  { ticker: 'ADBE', company: 'Adobe', sector: 'Technology' },
  { ticker: 'INTC', company: 'Intel', sector: 'Technology' },
  { ticker: 'CSCO', company: 'Cisco', sector: 'Technology' },
  { ticker: 'QCOM', company: 'Qualcomm', sector: 'Technology' },
  { ticker: 'TXN', company: 'Texas Instruments', sector: 'Technology' },
  { ticker: 'NOW', company: 'ServiceNow', sector: 'Technology' },
  { ticker: 'IBM', company: 'IBM', sector: 'Technology' },
  { ticker: 'INTU', company: 'Intuit', sector: 'Technology' },
  { ticker: 'AMAT', company: 'Applied Materials', sector: 'Technology' },
  { ticker: 'MU', company: 'Micron Technology', sector: 'Technology' },
  { ticker: 'LRCX', company: 'Lam Research', sector: 'Technology' },
  { ticker: 'KLAC', company: 'KLA Corporation', sector: 'Technology' },
  { ticker: 'SNPS', company: 'Synopsys', sector: 'Technology' },
  { ticker: 'CDNS', company: 'Cadence Design', sector: 'Technology' },
  { ticker: 'MRVL', company: 'Marvell Technology', sector: 'Technology' },
  { ticker: 'PANW', company: 'Palo Alto Networks', sector: 'Technology' },
  { ticker: 'CRWD', company: 'CrowdStrike', sector: 'Technology' },
  // Finance & Banking
  { ticker: 'BRK-B', company: 'Berkshire Hathaway', sector: 'Financial Services' },
  { ticker: 'JPM', company: 'JPMorgan Chase', sector: 'Banking' },
  { ticker: 'V', company: 'Visa', sector: 'Financial Services' },
  { ticker: 'MA', company: 'Mastercard', sector: 'Financial Services' },
  { ticker: 'BAC', company: 'Bank of America', sector: 'Banking' },
  { ticker: 'WFC', company: 'Wells Fargo', sector: 'Banking' },
  { ticker: 'GS', company: 'Goldman Sachs', sector: 'Banking' },
  { ticker: 'MS', company: 'Morgan Stanley', sector: 'Banking' },
  { ticker: 'C', company: 'Citigroup', sector: 'Banking' },
  { ticker: 'AXP', company: 'American Express', sector: 'Financial Services' },
  { ticker: 'SCHW', company: 'Charles Schwab', sector: 'Financial Services' },
  { ticker: 'BLK', company: 'BlackRock', sector: 'Financial Services' },
  { ticker: 'SPGI', company: 'S&P Global', sector: 'Financial Services' },
  { ticker: 'CME', company: 'CME Group', sector: 'Financial Services' },
  { ticker: 'ICE', company: 'Intercontinental Exchange', sector: 'Financial Services' },
  // Healthcare & Pharma
  { ticker: 'JNJ', company: 'Johnson & Johnson', sector: 'Healthcare' },
  { ticker: 'UNH', company: 'UnitedHealth Group', sector: 'Healthcare' },
  { ticker: 'LLY', company: 'Eli Lilly', sector: 'Healthcare' },
  { ticker: 'NVO', company: 'Novo Nordisk', sector: 'Healthcare' },
  { ticker: 'ABBV', company: 'AbbVie', sector: 'Healthcare' },
  { ticker: 'MRK', company: 'Merck', sector: 'Healthcare' },
  { ticker: 'PFE', company: 'Pfizer', sector: 'Healthcare' },
  { ticker: 'TMO', company: 'Thermo Fisher', sector: 'Healthcare' },
  { ticker: 'ABT', company: 'Abbott Laboratories', sector: 'Healthcare' },
  { ticker: 'DHR', company: 'Danaher', sector: 'Healthcare' },
  { ticker: 'BMY', company: 'Bristol-Myers Squibb', sector: 'Healthcare' },
  { ticker: 'AMGN', company: 'Amgen', sector: 'Healthcare' },
  { ticker: 'GILD', company: 'Gilead Sciences', sector: 'Healthcare' },
  { ticker: 'ISRG', company: 'Intuitive Surgical', sector: 'Healthcare' },
  // Consumer
  { ticker: 'WMT', company: 'Walmart', sector: 'Retail' },
  { ticker: 'PG', company: 'Procter & Gamble', sector: 'Consumer Defensive' },
  { ticker: 'HD', company: 'Home Depot', sector: 'Consumer Cyclical' },
  { ticker: 'COST', company: 'Costco', sector: 'Retail' },
  { ticker: 'KO', company: 'Coca-Cola', sector: 'Consumer Defensive' },
  { ticker: 'PEP', company: 'PepsiCo', sector: 'Consumer Defensive' },
  { ticker: 'MCD', company: 'McDonalds', sector: 'Consumer Cyclical' },
  { ticker: 'NKE', company: 'Nike', sector: 'Consumer Cyclical' },
  { ticker: 'SBUX', company: 'Starbucks', sector: 'Consumer Cyclical' },
  { ticker: 'LOW', company: 'Lowes', sector: 'Consumer Cyclical' },
  { ticker: 'TGT', company: 'Target', sector: 'Retail' },
  { ticker: 'CL', company: 'Colgate-Palmolive', sector: 'Consumer Defensive' },
  // Communication
  { ticker: 'NFLX', company: 'Netflix', sector: 'Communication' },
  { ticker: 'DIS', company: 'Walt Disney', sector: 'Communication' },
  { ticker: 'CMCSA', company: 'Comcast', sector: 'Communication' },
  { ticker: 'T', company: 'AT&T', sector: 'Communication' },
  { ticker: 'VZ', company: 'Verizon', sector: 'Communication' },
  { ticker: 'TMUS', company: 'T-Mobile', sector: 'Communication' },
  // Energy
  { ticker: 'XOM', company: 'Exxon Mobil', sector: 'Energy' },
  { ticker: 'CVX', company: 'Chevron', sector: 'Energy' },
  { ticker: 'COP', company: 'ConocoPhillips', sector: 'Energy' },
  { ticker: 'SLB', company: 'Schlumberger', sector: 'Energy' },
  { ticker: 'EOG', company: 'EOG Resources', sector: 'Energy' },
  // Industrials
  { ticker: 'CAT', company: 'Caterpillar', sector: 'Industrials' },
  { ticker: 'GE', company: 'GE Aerospace', sector: 'Industrials' },
  { ticker: 'RTX', company: 'RTX Corporation', sector: 'Industrials' },
  { ticker: 'HON', company: 'Honeywell', sector: 'Industrials' },
  { ticker: 'UPS', company: 'United Parcel Service', sector: 'Industrials' },
  { ticker: 'BA', company: 'Boeing', sector: 'Industrials' },
  { ticker: 'LMT', company: 'Lockheed Martin', sector: 'Industrials' },
  { ticker: 'DE', company: 'John Deere', sector: 'Industrials' },
  { ticker: 'UNP', company: 'Union Pacific', sector: 'Industrials' },
  // Materials & Utilities
  { ticker: 'LIN', company: 'Linde', sector: 'Materials' },
  { ticker: 'APD', company: 'Air Products', sector: 'Materials' },
  { ticker: 'FCX', company: 'Freeport-McMoRan', sector: 'Materials' },
  { ticker: 'NEE', company: 'NextEra Energy', sector: 'Utilities' },
  { ticker: 'DUK', company: 'Duke Energy', sector: 'Utilities' },
  { ticker: 'SO', company: 'Southern Company', sector: 'Utilities' },
  // Real Estate
  { ticker: 'PLD', company: 'Prologis', sector: 'Real Estate' },
  { ticker: 'AMT', company: 'American Tower', sector: 'Real Estate' },
  { ticker: 'CCI', company: 'Crown Castle', sector: 'Real Estate' },
  // Other notable
  { ticker: 'UBER', company: 'Uber Technologies', sector: 'Technology' },
  { ticker: 'ABNB', company: 'Airbnb', sector: 'Consumer Cyclical' },
  { ticker: 'SQ', company: 'Block Inc', sector: 'Financial Services' },
  { ticker: 'SHOP', company: 'Shopify', sector: 'Technology' },
  { ticker: 'COIN', company: 'Coinbase', sector: 'Financial Services' },
  { ticker: 'PLTR', company: 'Palantir', sector: 'Technology' },
  { ticker: 'SNOW', company: 'Snowflake', sector: 'Technology' },
  { ticker: 'DDOG', company: 'Datadog', sector: 'Technology' },
  { ticker: 'NET', company: 'Cloudflare', sector: 'Technology' },
  { ticker: 'ZS', company: 'Zscaler', sector: 'Technology' },
];

// Global macro symbols
export const MACRO_INDICES = [
  { symbol: '^NSEI', name: 'NIFTY 50', region: 'India', flag: '🇮🇳' },
  { symbol: '^BSESN', name: 'SENSEX', region: 'India', flag: '🇮🇳' },
  { symbol: '^GSPC', name: 'S&P 500', region: 'US', flag: '🇺🇸' },
  { symbol: '^IXIC', name: 'NASDAQ', region: 'US', flag: '🇺🇸' },
  { symbol: '^DJI', name: 'Dow Jones', region: 'US', flag: '🇺🇸' },
  { symbol: '^FTSE', name: 'FTSE 100', region: 'Europe', flag: '🇬🇧' },
  { symbol: '^GDAXI', name: 'DAX', region: 'Europe', flag: '🇩🇪' },
  { symbol: '^FCHI', name: 'CAC 40', region: 'Europe', flag: '🇫🇷' },
  { symbol: '^N225', name: 'Nikkei 225', region: 'Asia', flag: '🇯🇵' },
  { symbol: '^HSI', name: 'Hang Seng', region: 'Asia', flag: '🇭🇰' },
  { symbol: '000001.SS', name: 'Shanghai Comp', region: 'Asia', flag: '🇨🇳' },
  { symbol: '^AXJO', name: 'ASX 200', region: 'Asia', flag: '🇦🇺' },
];

export const MACRO_CURRENCIES = [
  { symbol: 'USDINR=X', name: 'USD/INR', region: 'India', flag: '🇮🇳' },
  { symbol: 'EURINR=X', name: 'EUR/INR', region: 'India', flag: '🇪🇺' },
  { symbol: 'GBPINR=X', name: 'GBP/INR', region: 'India', flag: '🇬🇧' },
  { symbol: 'EURUSD=X', name: 'EUR/USD', region: 'Global', flag: '🇪🇺' },
  { symbol: 'GBPUSD=X', name: 'GBP/USD', region: 'Global', flag: '🇬🇧' },
  { symbol: 'USDJPY=X', name: 'USD/JPY', region: 'Global', flag: '🇯🇵' },
  { symbol: 'USDCNY=X', name: 'USD/CNY', region: 'Global', flag: '🇨🇳' },
  { symbol: 'DX-Y.NYB', name: 'US Dollar Index', region: 'Global', flag: '🇺🇸' },
];

export const MACRO_COMMODITIES = [
  { symbol: 'GC=F', name: 'Gold', region: 'Metals', flag: '🥇' },
  { symbol: 'SI=F', name: 'Silver', region: 'Metals', flag: '🥈' },
  { symbol: 'CL=F', name: 'Crude Oil WTI', region: 'Energy', flag: '🛢️' },
  { symbol: 'BZ=F', name: 'Brent Crude', region: 'Energy', flag: '🛢️' },
  { symbol: 'NG=F', name: 'Natural Gas', region: 'Energy', flag: '🔥' },
  { symbol: 'HG=F', name: 'Copper', region: 'Metals', flag: '🔶' },
  { symbol: 'PL=F', name: 'Platinum', region: 'Metals', flag: '⬜' },
  { symbol: 'ZC=F', name: 'Corn', region: 'Agriculture', flag: '🌽' },
  { symbol: 'ZW=F', name: 'Wheat', region: 'Agriculture', flag: '🌾' },
  { symbol: 'ZS=F', name: 'Soybeans', region: 'Agriculture', flag: '🫘' },
];

export const MACRO_BONDS = [
  { symbol: '^TNX', name: 'US 10Y Treasury', region: 'US', flag: '🇺🇸' },
  { symbol: '^TYX', name: 'US 30Y Treasury', region: 'US', flag: '🇺🇸' },
  { symbol: '^FVX', name: 'US 5Y Treasury', region: 'US', flag: '🇺🇸' },
  { symbol: '^IRX', name: 'US 13W T-Bill', region: 'US', flag: '🇺🇸' },
];

// Sector ETFs for RRG
export const SECTOR_ETFS_INDIA = [
  { symbol: 'NIFTYPHARMA.NS', name: 'Pharma', color: '#10B981' },
  { symbol: 'NIFTYIT.NS', name: 'IT', color: '#3B82F6' },
  { symbol: 'BANKNIFTY.NS', name: 'Bank Nifty', color: '#F59E0B' },
  { symbol: 'NIFTYMETAL.NS', name: 'Metal', color: '#EF4444' },
  { symbol: 'NIFTYAUTO.NS', name: 'Auto', color: '#8B5CF6' },
  { symbol: 'NIFTYREALTY.NS', name: 'Realty', color: '#EC4899' },
  { symbol: 'NIFTYFMCG.NS', name: 'FMCG', color: '#14B8A6' },
  { symbol: 'NIFTYMEDIA.NS', name: 'Media', color: '#F97316' },
  { symbol: 'NIFTYENERGY.NS', name: 'Energy', color: '#06B6D4' },
  { symbol: 'NIFTYPSE.NS', name: 'PSE', color: '#84CC16' },
];
