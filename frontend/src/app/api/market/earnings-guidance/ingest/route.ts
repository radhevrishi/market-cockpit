/**
 * Earnings Guidance Ingest — Background Compute Pipeline
 *
 * SELF-BOOTSTRAPPING: When earnings cache is empty (fresh deploy), this pipeline
 * fetches screener.in data INLINE for each portfolio/watchlist symbol.
 * No pre-existing cache required — runs fully standalone.
 *
 * Architecture:
 * - Distributed lock prevents concurrent ingestion runs
 * - Atomic write: compute → temp key → swap to production key
 * - NEVER triggered from UI — only via cron or manual POST/GET
 * - Idempotent: safe to call multiple times
 *
 * Data flow:
 * 1. Get symbols from /api/portfolio + /api/watchlist
 * 2. For each symbol: read earnings:SYMBOL from Redis
 *    - If cache HIT: use stored screener Pros/Cons + quarterly data
 *    - If cache MISS: fetch screener.in INLINE, parse, store in Redis
 * 3. Generate guidance events from fetched data
 * 4. Atomic write to guidance:events Redis key
 *
 * Triggered by:
 * 1. Vercel cron (daily at 4:15 AM UTC, weekdays)
 * 2. GET /api/market/earnings-guidance when empty (fire-and-forget)
 * 3. Manual GET/POST for re-ingestion
 */

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, kvSetNX, kvSwap, kvDel } from '@/lib/kv';
import { resolveScreenerSymbol } from '@/lib/symbolMaster';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

const LOCK_KEY = 'lock:guidance:ingest';
const LOCK_TTL = 300; // 5 minutes
const TEMP_KEY = 'guidance:events:temp';
const PROD_KEY = 'guidance:events';
const META_KEY = 'guidance:meta';
const STORE_TTL = 86400; // 24 hours
const EARNINGS_KV_TTL = 21600; // 6 hours for bootstrapped earnings cache

const CHAT_ID = '5057319640';

// ==================== TYPE DEFINITIONS ====================

interface QuarterFinancials {
  period: string;
  revenue: number;
  operatingProfit: number;
  opm: number;
  pat: number;
  npm: number;
  eps: number;
}

interface GuidanceData {
  guidance: 'Positive' | 'Neutral' | 'Negative';
  sentimentScore: number;
  revenueOutlook: string;
  marginOutlook: string;
  capexSignal: string;
  demandSignal: string;
  keyPhrasesPositive: string[];
  keyPhrasesNegative: string[];
  prosText: string;
  consText: string;
  divergence: string;
}

interface EarningsCacheEntry {
  symbol: string;
  companyName: string;
  quarters: QuarterFinancials[];
  mcap: number | null;
  pe: number | null;
  currentPrice: number | null;
  sector: string;
  isBanking: boolean;
  source: string;
  sourceConfidence: number;
  dataStatus: string;
  fetchedAt: number;
  validatedAt: number;
  guidance?: GuidanceData;
}

interface GuidanceEvent {
  id: string;
  symbol: string;
  companyName: string;
  eventDate: string;
  source: string;
  eventType: 'RESULT' | 'GUIDANCE' | 'COMMENTARY';
  revenueGrowth: number | null;
  profitGrowth: number | null;
  marginChange: number | null;
  guidanceRevenue: string | null;
  guidanceMargin: string | null;
  guidanceCapex: number | null;
  guidanceDemand: string | null;
  operatingLeverage: boolean;
  deleveraging: boolean;
  orderBookGrowth: boolean;
  rawText: string;
  sentimentScore: number;
  confidenceScore: number;
  dedupKey: string;
  createdAt: string;
  grade: 'STRONG' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'WEAK';
  gradeColor: string;
}

interface GuidanceMeta {
  computedAt: string;
  eventCount: number;
  symbolCount: number;
  version: number;
  source: string;
}

// ==================== HELPERS ====================

function gradeFromScore(score: number): { grade: GuidanceEvent['grade']; color: string } {
  if (score >= 75) return { grade: 'STRONG', color: '#7C3AED' };
  if (score >= 55) return { grade: 'POSITIVE', color: '#00C853' };
  if (score >= 35) return { grade: 'NEUTRAL', color: '#FFD600' };
  if (score >= 15) return { grade: 'NEGATIVE', color: '#FF6B35' };
  return { grade: 'WEAK', color: '#C00000' };
}

function detectSignals(text: string): {
  operatingLeverage: boolean;
  deleveraging: boolean;
  orderBookGrowth: boolean;
  capex: number | null;
  demand: string | null;
} {
  const lower = text.toLowerCase();

  const operatingLeverage = ['fixed cost', 'operational efficiency', 'scale benefits',
    'margin expansion', 'higher throughput', 'capacity utilization', 'operating leverage']
    .some(kw => lower.includes(kw));

  const deleveraging = ['debt reduction', 'deleveraging', 'balance sheet strengthening', 'net cash', 'debt free', 'reduced debt']
    .some(kw => lower.includes(kw));

  const orderBookGrowth = ['order book', 'pipeline', 'backlog', 'order inflow', 'order win']
    .some(kw => lower.includes(kw));

  let capex: number | null = null;
  const capexMatch = text.match(/capex.{0,30}(?:₹|rs\.?)\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:cr|crore)?/i);
  if (capexMatch?.[1]) {
    capex = parseFloat(capexMatch[1].replace(/,/g, ''));
    if (isNaN(capex)) capex = null;
  }

  const positiveDemand = ['strong demand', 'robust pipeline', 'accelerating demand', 'growth momentum', 'capacity expansion']
    .filter(kw => lower.includes(kw)).length;
  const negativeDemand = ['weak demand', 'slowdown', 'muted demand', 'margin pressure', 'pricing pressure']
    .filter(kw => lower.includes(kw)).length;
  const demand = positiveDemand > negativeDemand ? 'Strong' : negativeDemand > positiveDemand ? 'Weak' : null;

  return { operatingLeverage, deleveraging, orderBookGrowth, capex, demand };
}

// ==================== SCREENER.IN BOOTSTRAP ====================
// Fetches screener.in data INLINE when earnings cache is missing

const SCREENER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

function parseNum(str: string): number {
  if (!str || str.trim() === '' || str.trim() === '-') return 0;
  const clean = str.replace(/,/g, '').trim();
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

function parseScreenerQuarters(html: string): QuarterFinancials[] {
  const quarters: QuarterFinancials[] = [];

  // Find quarters section
  const section = html.match(/id="quarters"[\s\S]{0,200}<table[\s\S]*?<\/table>/i) ||
                  html.match(/Quarterly Results[\s\S]{0,200}<table[^>]*class="[^"]*data-table[^"]*"[\s\S]*?<\/table>/i);
  const tableHtml = section ? section[0] : html;

  // Extract column labels
  const columnLabels: string[] = [];
  const headerMatch = tableHtml.match(/<thead[\s\S]*?<\/thead>/i);
  if (headerMatch) {
    const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let m;
    while ((m = thRegex.exec(headerMatch[0])) !== null) {
      const label = m[1].replace(/<[^>]+>/g, '').trim();
      if (/^[A-Z][a-z]{2}\s+\d{4}$/.test(label)) columnLabels.push(label);
    }
  }

  // Fallback: scan full text for quarter patterns
  if (columnLabels.length === 0) {
    const qtrPattern = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/g;
    const text = tableHtml.replace(/<[^>]+>/g, ' ');
    const matches = text.match(qtrPattern);
    if (matches) {
      const seen = new Set<string>();
      for (const q of matches) {
        if (!seen.has(q) && seen.size < 8) { seen.add(q); columnLabels.push(q); }
      }
    }
  }

  if (columnLabels.length === 0) return quarters;

  // Extract rows
  const rows: Record<string, number[]> = {};
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const rowHtml = rowMatch[1];
    const cells: string[] = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length < 2) continue;
    const label = cells[0].replace(/[+\u00a0]/g, '').trim();
    const values = cells.slice(1).map(c => parseNum(c));
    if (/^Sales/i.test(label) || /^Revenue/i.test(label)) rows['sales'] = values;
    else if (/^Operating Profit/i.test(label) || /^Financing Profit/i.test(label)) rows['operatingProfit'] = values;
    else if (/^OPM/i.test(label) || /^Financing Margin/i.test(label)) rows['opm'] = values;
    else if (/^(?:Net )?Profit/i.test(label) || /^PAT/i.test(label)) rows['pat'] = values;
    else if (/^EPS/i.test(label)) rows['eps'] = values;
  }

  const numQ = Math.min(columnLabels.length, 6);
  for (let i = 0; i < numQ; i++) {
    const revenue = rows['sales']?.[i] || 0;
    const operatingProfit = rows['operatingProfit']?.[i] || 0;
    const pat = rows['pat']?.[i] || 0;
    const eps = rows['eps']?.[i] || 0;
    const opmRaw = rows['opm']?.[i];
    const opm = opmRaw || (revenue > 0 ? parseFloat(((operatingProfit / revenue) * 100).toFixed(1)) : 0);
    const npm = revenue > 0 ? parseFloat(((pat / revenue) * 100).toFixed(1)) : 0;
    if (revenue === 0 && pat === 0 && eps === 0) continue;
    quarters.push({ period: columnLabels[i], revenue, operatingProfit, opm, pat, npm, eps });
  }

  return quarters;
}

function parseScreenerProsCons(html: string): { prosText: string; consText: string } {
  let prosText = '';
  let consText = '';

  // Pattern 1: class="company-pros" / "company-cons"
  const cpMatch = html.match(/class="[^"]*company-pros[^"]*"[^>]*>([\s\S]*?)(?=class="[^"]*company-cons|<\/section|<\/div>\s*<div[^>]*class="[^"]*company-cons)/i);
  const ccMatch = html.match(/class="[^"]*company-cons[^"]*"[^>]*>([\s\S]*?)(?=<\/section|<\/div>\s*<div[^>]*class="[^"]*(?:pros|analysis)|<section)/i);

  // Pattern 2: id="analysis" section
  const analysisSection = html.match(/id="analysis"[\s\S]*?<\/section>/i)?.[0] || '';
  const sp = analysisSection.match(/<section[^>]*class="[^"]*pros[^"]*"[^>]*>([\s\S]*?)<\/section>/i);
  const sc = analysisSection.match(/<section[^>]*class="[^"]*cons[^"]*"[^>]*>([\s\S]*?)<\/section>/i);

  // Pattern 3: Loose pros/cons headers
  const lp = html.match(/>\s*Pros\s*<\/\w+>([\s\S]*?)(?=>\s*Cons\s*<\/|\Z)/i);
  const lc = html.match(/>\s*Cons\s*<\/\w+>([\s\S]*?)(?=<\/section|<\/div>\s*<div[^>]*class="[^"]*(?:pros|analysis)|\Z)/i);

  prosText = cpMatch?.[1] || sp?.[1] || lp?.[1] || '';
  consText = ccMatch?.[1] || sc?.[1] || lc?.[1] || '';

  // Clean HTML
  prosText = prosText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  consText = consText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return { prosText: prosText.slice(0, 600), consText: consText.slice(0, 600) };
}

function buildGuidanceFromProsCons(prosText: string, consText: string): GuidanceData {
  const fullText = `${prosText} ${consText}`.toLowerCase();

  // Keyword scoring (simplified version of the full sentiment engine)
  const POSITIVE_KEYWORDS: [string, number][] = [
    ['revenue growth', 0.15], ['profit growth', 0.15], ['margin expansion', 0.12],
    ['order book', 0.10], ['strong demand', 0.10], ['market share', 0.08],
    ['debt free', 0.12], ['cash flow', 0.08], ['capacity expansion', 0.10],
    ['consistent growth', 0.10], ['dividend', 0.05], ['return on equity', 0.08],
  ];
  const NEGATIVE_KEYWORDS: [string, number][] = [
    ['revenue decline', -0.15], ['profit decline', -0.15], ['margin pressure', -0.12],
    ['debt', -0.08], ['working capital', -0.06], ['pledge', -0.12],
    ['weak demand', -0.10], ['competition', -0.06], ['regulatory', -0.08],
    ['loss', -0.12], ['audit', -0.14], ['governance concern', -0.12],
  ];

  let score = 0;
  const keyPhrasesPositive: string[] = [];
  const keyPhrasesNegative: string[] = [];

  for (const [kw, weight] of POSITIVE_KEYWORDS) {
    if (prosText.toLowerCase().includes(kw)) {
      score += weight;
      keyPhrasesPositive.push(kw);
    }
  }
  for (const [kw, weight] of NEGATIVE_KEYWORDS) {
    if (consText.toLowerCase().includes(kw)) {
      score += weight; // weight is already negative
      keyPhrasesNegative.push(kw);
    }
  }
  score = Math.max(-1, Math.min(1, score));

  const guidance = score > 0.1 ? 'Positive' : score < -0.1 ? 'Negative' : 'Neutral';

  const revenueOutlook =
    fullText.includes('revenue growth') || fullText.includes('sales growth') ? 'Up' :
    fullText.includes('revenue decline') || fullText.includes('sales decline') ? 'Down' : 'Unknown';

  const marginOutlook =
    fullText.includes('margin expansion') || fullText.includes('operating leverage') ? 'Expanding' :
    fullText.includes('margin pressure') || fullText.includes('margin compression') ? 'Contracting' : 'Unknown';

  const capexSignal =
    fullText.includes('capex') && (fullText.includes('increase') || fullText.includes('expansion')) ? 'Expanding' :
    fullText.includes('capex') && (fullText.includes('reduce') || fullText.includes('lower')) ? 'Reducing' : 'Unknown';

  const demandSignal =
    fullText.includes('strong demand') || fullText.includes('robust demand') ? 'Strong' :
    fullText.includes('weak demand') || fullText.includes('muted demand') ? 'Weak' : 'Unknown';

  return {
    guidance,
    sentimentScore: score,
    revenueOutlook,
    marginOutlook,
    capexSignal,
    demandSignal,
    keyPhrasesPositive: keyPhrasesPositive.slice(0, 5),
    keyPhrasesNegative: keyPhrasesNegative.slice(0, 5),
    prosText,
    consText,
    divergence: 'None',
  };
}

/**
 * Bootstrap: fetch screener.in for a symbol that isn't in the earnings cache.
 * Parses quarterly data + pros/cons + guidance sentiment.
 * Stores result in Redis under earnings:SYMBOL.
 */
async function bootstrapSymbolFromScreener(symbol: string): Promise<EarningsCacheEntry | null> {
  const screenerSym = resolveScreenerSymbol(symbol);

  const urls = [
    `https://www.screener.in/company/${screenerSym}/consolidated/`,
    `https://www.screener.in/company/${screenerSym}/`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: SCREENER_HEADERS,
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;

      const html = await res.text();
      if (!html.includes('Quarterly') && !html.includes('quarters')) continue;

      // Parse company name from <title>
      const titleMatch = html.match(/<title>([^<]+)/);
      const companyName = titleMatch
        ? titleMatch[1].replace(/\s*share price.*$/i, '').replace(/\s*[-|].*$/, '').trim()
        : symbol;

      // Parse current price
      let currentPrice: number | null = null;
      const cpMatch = html.match(/Current Price[^₹]*₹\s*([\d,]+(?:\.\d+)?)/i) ||
                      html.match(/<span[^>]*id="[^"]*price[^"]*"[^>]*>([\d,]+(?:\.\d+)?)/i);
      if (cpMatch) currentPrice = parseNum(cpMatch[1]);

      // Parse market cap
      let mcap: number | null = null;
      const mcMatch = html.match(/Market Cap[^₹]*₹\s*([\d,]+(?:\.\d+)?)\s*Cr/i);
      if (mcMatch) mcap = parseNum(mcMatch[1]);

      // Parse P/E
      let pe: number | null = null;
      const peMatch = html.match(/Stock P\/E[^>]*>\s*([\d.]+)/i);
      if (peMatch) pe = parseFloat(peMatch[1]);

      const isBanking = html.includes('Financing Profit') || html.includes('Net Interest Income') || html.includes('NII');
      const quarters = parseScreenerQuarters(html);

      // Get pros/cons for guidance
      const { prosText, consText } = parseScreenerProsCons(html);
      let guidanceData: GuidanceData | null = null;
      if (prosText || consText) {
        guidanceData = buildGuidanceFromProsCons(prosText, consText);
      }

      const entry: EarningsCacheEntry = {
        symbol,
        companyName,
        quarters,
        mcap,
        pe,
        currentPrice,
        sector: 'Other',
        isBanking,
        source: 'screener.in',
        sourceConfidence: quarters.length > 0 ? 75 : 40,
        dataStatus: quarters.length >= 3 ? 'FULL' : quarters.length > 0 ? 'PARTIAL' : 'MISSING',
        fetchedAt: Date.now(),
        validatedAt: Date.now(),
        guidance: guidanceData || undefined,
      };

      // Store in Redis
      await kvSet(`earnings:${symbol}`, entry, EARNINGS_KV_TTL);
      console.log(`[guidance/bootstrap] ${symbol}: fetched ${quarters.length} quarters, guidance=${guidanceData?.guidance || 'none'}`);
      return entry;

    } catch (e) {
      console.warn(`[guidance/bootstrap] ${symbol} (${url}): ${(e as Error).message}`);
    }
  }

  // Try screener.in search API as fallback
  try {
    const searchRes = await fetch(
      `https://www.screener.in/api/company/search/?q=${encodeURIComponent(symbol)}`,
      { headers: SCREENER_HEADERS, signal: AbortSignal.timeout(5000) }
    );
    if (searchRes.ok) {
      const results = await searchRes.json();
      const match = Array.isArray(results)
        ? results.find((r: any) => r.url && !r.name?.includes('DVR'))
        : null;
      if (match?.url) {
        const discoverUrl = `https://www.screener.in${match.url}`;
        const discRes = await fetch(discoverUrl, { headers: SCREENER_HEADERS, signal: AbortSignal.timeout(10000) });
        if (discRes.ok) {
          const html = await discRes.text();
          if (html.includes('Quarterly') || html.includes('quarters')) {
            const quarters = parseScreenerQuarters(html);
            const { prosText, consText } = parseScreenerProsCons(html);
            const guidanceData = (prosText || consText) ? buildGuidanceFromProsCons(prosText, consText) : null;
            const titleMatch = html.match(/<title>([^<]+)/);
            const companyName = titleMatch
              ? titleMatch[1].replace(/\s*share price.*$/i, '').replace(/\s*[-|].*$/, '').trim()
              : symbol;
            const entry: EarningsCacheEntry = {
              symbol, companyName, quarters,
              mcap: null, pe: null, currentPrice: null, sector: 'Other',
              isBanking: html.includes('Financing Profit'),
              source: 'screener.in', sourceConfidence: 65,
              dataStatus: quarters.length >= 3 ? 'FULL' : quarters.length > 0 ? 'PARTIAL' : 'MISSING',
              fetchedAt: Date.now(), validatedAt: Date.now(),
              guidance: guidanceData || undefined,
            };
            await kvSet(`earnings:${symbol}`, entry, EARNINGS_KV_TTL);
            console.log(`[guidance/bootstrap] ${symbol}: discovered via search, ${quarters.length} quarters`);
            return entry;
          }
        }
      }
    }
  } catch {}

  return null;
}

// ==================== CORE INGESTION ====================

async function ingestFromEarningsScan(): Promise<{
  events: GuidanceEvent[];
  symbolCount: number;
  bootstrapped: number;
  error: string | null;
}> {
  const events: GuidanceEvent[] = [];
  const seenDedup = new Set<string>();

  try {
    // 1. Get symbols from portfolio + watchlist
    let symbols: string[] = [];
    try {
      // CRITICAL: Use production URL, NOT VERCEL_URL (blocked by Deployment Protection)
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://market-cockpit.vercel.app';

      const [pRes, wRes] = await Promise.all([
        fetch(`${baseUrl}/api/portfolio?chatId=${CHAT_ID}`, { signal: AbortSignal.timeout(10000) }).catch(() => null),
        fetch(`${baseUrl}/api/watchlist?chatId=${CHAT_ID}`, { signal: AbortSignal.timeout(10000) }).catch(() => null),
      ]);

      if (pRes?.ok) {
        const pd = await pRes.json();
        symbols.push(...(pd.holdings || []).map((h: any) => h.symbol));
      }
      if (wRes?.ok) {
        const wd = await wRes.json();
        symbols.push(...(wd.watchlist || []));
      }
    } catch (e) {
      console.warn('[guidance/ingest] Failed to fetch symbols:', (e as Error).message);
    }

    symbols = [...new Set(symbols.map(s => s.trim().toUpperCase()).filter(s => s.length > 0))];

    if (symbols.length === 0) {
      return { events: [], symbolCount: 0, bootstrapped: 0, error: 'No symbols in portfolio/watchlist' };
    }

    console.log(`[guidance/ingest] Processing ${symbols.length} symbols`);

    // 2. Check which symbols have cached earnings data
    const symbolsNeedingBootstrap: string[] = [];
    const cachedData: Map<string, EarningsCacheEntry> = new Map();

    await Promise.allSettled(symbols.map(async (sym) => {
      const cached = await kvGet<EarningsCacheEntry>(`earnings:${sym}`);
      if (cached && cached.quarters && cached.quarters.length > 0) {
        cachedData.set(sym, cached);
      } else {
        symbolsNeedingBootstrap.push(sym);
      }
    }));

    console.log(`[guidance/ingest] Cache HIT: ${cachedData.size}, MISS (needs bootstrap): ${symbolsNeedingBootstrap.length}`);

    // 3. Bootstrap missing symbols from screener.in (parallel, max 5 at a time)
    let bootstrapped = 0;
    if (symbolsNeedingBootstrap.length > 0) {
      // Limit bootstrap to first 25 symbols to stay within 55s timeout
      const toBootstrap = symbolsNeedingBootstrap.slice(0, 25);
      const BATCH = 5;

      for (let i = 0; i < toBootstrap.length; i += BATCH) {
        const batch = toBootstrap.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map(sym => bootstrapSymbolFromScreener(sym))
        );
        for (let j = 0; j < results.length; j++) {
          const r = results[j];
          if (r.status === 'fulfilled' && r.value) {
            cachedData.set(batch[j], r.value);
            bootstrapped++;
          }
        }
      }
      console.log(`[guidance/ingest] Bootstrapped ${bootstrapped}/${toBootstrap.length} symbols`);
    }

    // 4. Generate guidance events from all available data
    let processedCount = 0;
    for (const [sym, cached] of cachedData) {
      try {
        processedCount++;
        const companyName = cached.companyName || sym;
        const fetchedDate = cached.fetchedAt
          ? new Date(cached.fetchedAt).toISOString()
          : new Date().toISOString();

        // Source A: Guidance data from screener.in Pros/Cons
        if (cached.guidance) {
          const g = cached.guidance;
          const hasSignal = g.guidance !== 'Neutral' || g.prosText || g.consText;

          if (hasSignal) {
            const rawText = `${g.prosText || ''} ${g.consText || ''}`.trim();
            const signals = detectSignals(rawText);

            const sentimentRaw = typeof g.sentimentScore === 'number' ? g.sentimentScore : 0;
            const sentimentScore = Math.round((sentimentRaw + 1) * 50);
            const { grade, color } = gradeFromScore(sentimentScore);

            const dedupKey = `${sym}_GUIDANCE_screener`;
            if (!seenDedup.has(dedupKey)) {
              seenDedup.add(dedupKey);
              events.push({
                id: `${sym}-guid-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
                symbol: sym,
                companyName,
                eventDate: fetchedDate,
                source: 'Screener',
                eventType: 'GUIDANCE',
                revenueGrowth: null,
                profitGrowth: null,
                marginChange: null,
                guidanceRevenue: g.revenueOutlook && g.revenueOutlook !== 'Unknown' ? g.revenueOutlook : null,
                guidanceMargin: g.marginOutlook && g.marginOutlook !== 'Unknown' ? g.marginOutlook : null,
                guidanceCapex: signals.capex,
                guidanceDemand: g.demandSignal && g.demandSignal !== 'Unknown' ? g.demandSignal : (signals.demand || null),
                operatingLeverage: signals.operatingLeverage,
                deleveraging: signals.deleveraging,
                orderBookGrowth: signals.orderBookGrowth,
                rawText: rawText.slice(0, 1000),
                sentimentScore,
                confidenceScore: Math.min(100, 60 + (signals.operatingLeverage ? 15 : 0) + (signals.orderBookGrowth ? 10 : 0)),
                dedupKey,
                createdAt: new Date().toISOString(),
                grade,
                gradeColor: color,
              });
            }
          }
        }

        // Source B: Quarterly results data
        if (cached.quarters && Array.isArray(cached.quarters) && cached.quarters.length > 0) {
          const latest = cached.quarters[0];
          const yoyQuarter = cached.quarters.length >= 4
            ? cached.quarters[3]
            : cached.quarters.length >= 3 ? cached.quarters[2] : null;
          const previous = cached.quarters.length > 1 ? cached.quarters[1] : null;

          let revenueGrowth: number | null = null;
          let profitGrowth: number | null = null;

          if (yoyQuarter && yoyQuarter.revenue > 0) {
            revenueGrowth = Math.round(((latest.revenue - yoyQuarter.revenue) / yoyQuarter.revenue) * 100 * 10) / 10;
          }
          if (yoyQuarter && Math.abs(yoyQuarter.pat) > 0.1) {
            profitGrowth = Math.round(((latest.pat - yoyQuarter.pat) / Math.abs(yoyQuarter.pat)) * 100 * 10) / 10;
          }

          let marginChange: number | null = null;
          if (previous && latest.opm > 0 && previous.opm > 0) {
            marginChange = Math.round((latest.opm - previous.opm) * 100);
            // Cap margin change display at 5000 bps (50%) to catch data anomalies
            if (Math.abs(marginChange) > 5000) {
              marginChange = marginChange > 0 ? 5000 : -5000;
            }
          }

          let resultScore = 50;
          if (revenueGrowth !== null) resultScore += Math.min(15, Math.max(-15, revenueGrowth / 3));
          if (profitGrowth !== null) resultScore += Math.min(20, Math.max(-20, profitGrowth / 4));
          if (marginChange !== null) resultScore += Math.min(10, Math.max(-10, marginChange / 50));
          resultScore = Math.max(0, Math.min(100, Math.round(resultScore)));

          const { grade, color } = gradeFromScore(resultScore);
          const dedupKey = `${sym}_RESULT_${latest.period.replace(/\s+/g, '_')}`;

          if (!seenDedup.has(dedupKey)) {
            seenDedup.add(dedupKey);
            events.push({
              id: `${sym}-res-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
              symbol: sym,
              companyName,
              eventDate: fetchedDate,
              source: 'Screener',
              eventType: 'RESULT',
              revenueGrowth,
              profitGrowth,
              marginChange,
              guidanceRevenue: null,
              guidanceMargin: null,
              guidanceCapex: null,
              guidanceDemand: null,
              operatingLeverage: false,
              deleveraging: false,
              orderBookGrowth: false,
              rawText: `${latest.period}: Revenue ₹${latest.revenue}Cr, OPM ${latest.opm}%, PAT ₹${latest.pat}Cr, EPS ₹${latest.eps}`,
              sentimentScore: resultScore,
              confidenceScore: 80,
              dedupKey,
              createdAt: new Date().toISOString(),
              grade,
              gradeColor: color,
            });
          }
        }
      } catch (e) {
        console.warn(`[guidance/ingest] Error processing ${sym}:`, (e as Error).message);
      }
    }

    events.sort((a, b) => b.sentimentScore - a.sentimentScore);
    console.log(`[guidance/ingest] Generated ${events.length} events from ${processedCount} symbols`);
    return { events, symbolCount: symbols.length, bootstrapped, error: null };

  } catch (e) {
    console.error('[guidance/ingest] Fatal error:', e);
    return { events: [], symbolCount: 0, bootstrapped: 0, error: (e as Error).message };
  }
}

// ==================== LOCKED PIPELINE ====================

async function runLockedPipeline(): Promise<{
  success: boolean;
  ingested: number;
  total: number;
  bootstrapped: number;
  message: string;
  skipped?: boolean;
}> {
  const lockAcquired = await kvSetNX(LOCK_KEY, `pid:${Date.now()}`, LOCK_TTL);
  if (!lockAcquired) {
    console.log('[guidance/ingest] Lock exists — skipping.');
    return { success: true, ingested: 0, total: 0, bootstrapped: 0, message: 'Skipped — another ingestion in progress', skipped: true };
  }

  try {
    const { events, symbolCount, bootstrapped, error } = await ingestFromEarningsScan();

    if (error && events.length === 0) {
      return { success: false, ingested: 0, total: 0, bootstrapped, message: `Ingestion error: ${error}` };
    }

    if (events.length === 0) {
      const existing = await kvGet<GuidanceEvent[]>(PROD_KEY);
      return {
        success: true, ingested: 0, total: existing?.length || 0,
        bootstrapped, message: 'No new events found. Existing data preserved.',
      };
    }

    await kvSet(TEMP_KEY, events, STORE_TTL);
    const swapped = await kvSwap(TEMP_KEY, PROD_KEY, STORE_TTL);
    if (!swapped) {
      await kvSet(PROD_KEY, events, STORE_TTL);
      console.warn('[guidance/ingest] Swap failed, used direct write fallback');
    }

    const meta: GuidanceMeta = {
      computedAt: new Date().toISOString(),
      eventCount: events.length,
      symbolCount,
      version: Date.now(),
      source: 'screener.in',
    };
    await kvSet(META_KEY, meta, STORE_TTL);

    console.log(`[guidance/ingest] Pipeline complete: ${events.length} events (bootstrapped ${bootstrapped} symbols)`);
    return {
      success: true,
      ingested: events.length,
      total: events.length,
      bootstrapped,
      message: `Successfully ingested ${events.length} guidance events (bootstrapped ${bootstrapped} symbols)`,
    };
  } finally {
    await kvDel(LOCK_KEY);
  }
}

// ==================== ROUTE HANDLERS ====================

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get('secret');
    if (secret && secret !== 'mc-bot-2026') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await runLockedPipeline();
    return NextResponse.json({
      ...result,
      eventsCount: result.total,
    });
  } catch (error) {
    console.error('[guidance/ingest/GET]', error);
    return NextResponse.json(
      { success: false, ingested: 0, total: 0, bootstrapped: 0, message: `Failed: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const result = await runLockedPipeline();
    return NextResponse.json({ ...result, eventsCount: result.total });
  } catch (error) {
    console.error('[guidance/ingest/POST]', error);
    return NextResponse.json(
      { success: false, ingested: 0, total: 0, bootstrapped: 0, message: `Failed: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
