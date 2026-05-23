import { NextResponse } from 'next/server';
import { fetchAllIndices } from '@/lib/nse';
import { fetchQuotesWithFallback, MACRO_INDICES, MACRO_CURRENCIES, MACRO_COMMODITIES, MACRO_BONDS } from '@/lib/yahoo';
import { rateLimitResponse } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// Response-level cache (avoids re-assembly on rapid polls)
const responseCache = new Map<string, { data: any; ts: number }>();
const RESPONSE_TTL = 60_000; // 60s cache for macro data (changes less frequently)

// PATCH 0771: shared pct/change resolver. NSE pChange and Yahoo
// regularMarketChangePercent both report 0 on weekends/holidays even
// when last and previousClose are present (e.g. Friday close vs Sat).
// We always try the reported field first; if it's exactly zero (and
// price/prevClose disagree), compute from prices.
function resolvePctChange(opts: {
  reportedChange?: number | null;
  reportedPct?: number | null;
  price?: number | null;
  prevClose?: number | null;
}): { change: number; changePercent: number } {
  const reportedChange = Number(opts.reportedChange) || 0;
  const reportedPct = Number(opts.reportedPct) || 0;
  const price = Number(opts.price) || 0;
  const prevClose = Number(opts.prevClose) || 0;
  const canCompute = price > 0 && prevClose > 0;
  const computedChange = canCompute ? price - prevClose : 0;
  const computedPct = canCompute ? ((price - prevClose) / prevClose) * 100 : 0;
  return {
    change: reportedChange !== 0 ? reportedChange : computedChange,
    changePercent: reportedPct !== 0 ? reportedPct : computedPct,
  };
}

export async function GET(request: Request) {
  const limited = rateLimitResponse(request, 60, 60_000);
  if (limited) return limited;
  // Cache key for macro data (single endpoint)
  const cacheKey = 'macro';

  // Check response cache
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < RESPONSE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    // Fetch NSE indices (for Indian data) and Yahoo Finance (for global data) in parallel
    const [nseIndices, yfQuotes] = await Promise.all([
      fetchAllIndices(),
      fetchQuotesWithFallback([
        // Global indices (not Indian - those come from NSE)
        '^GSPC', '^IXIC', '^DJI', '^FTSE', '^GDAXI', '^FCHI', '^N225', '^HSI', '000001.SS', '^AXJO',
        // Currencies
        ...MACRO_CURRENCIES.map(c => c.symbol),
        // Commodities
        ...MACRO_COMMODITIES.map(c => c.symbol),
        // Bonds
        ...MACRO_BONDS.map(b => b.symbol),
      ]),
    ]);

    // Build indices data
    const indices: any[] = [];

    // Add Indian indices from NSE (most accurate)
    if (nseIndices && nseIndices.data) {
      const nseIndexMap: Record<string, any> = {};
      for (const idx of nseIndices.data) {
        nseIndexMap[idx.index || idx.indexSymbol || ''] = idx;
      }

      // Build NSE index rows with P0771 pct-resolution fallback
      const pushNseIndex = (
        sym: string, name: string, raw: any, flag = '🇮🇳'
      ) => {
        const value = raw.last || raw.lastPrice || 0;
        const previousClose = raw.previousClose || raw.prevClose || 0;
        const { change, changePercent } = resolvePctChange({
          reportedChange: raw.variation || raw.change,
          reportedPct: raw.percentChange || raw.pChange,
          price: value,
          prevClose: previousClose,
        });
        indices.push({ symbol: sym, name, region: 'India', flag, value, change, changePercent, previousClose });
      };

      // NIFTY 50
      const nifty = nseIndexMap['NIFTY 50'] || nseIndexMap['Nifty 50'];
      if (nifty) pushNseIndex('^NSEI', 'NIFTY 50', nifty);

      // SENSEX (from NSE data or BSE)
      const sensex = nseIndexMap['SENSEX'] || nseIndexMap['S&P BSE SENSEX'];
      if (sensex) pushNseIndex('^BSESN', 'SENSEX', sensex);

      // Bank Nifty
      const bankNifty = nseIndexMap['NIFTY BANK'] || nseIndexMap['Nifty Bank'];
      if (bankNifty) pushNseIndex('^NSEBANK', 'Bank NIFTY', bankNifty);

      // NIFTY IT
      const niftyIT = nseIndexMap['NIFTY IT'] || nseIndexMap['Nifty IT'];
      if (niftyIT) pushNseIndex('^CNXIT', 'NIFTY IT', niftyIT);

      // NIFTY Pharma
      const niftyPharma = nseIndexMap['NIFTY PHARMA'] || nseIndexMap['Nifty Pharma'];
      if (niftyPharma) pushNseIndex('^CNXPHARMA', 'NIFTY Pharma', niftyPharma);
    } else {
      // Fallback: use Yahoo Finance for Indian indices
      const indiaQuotes = await fetchQuotesWithFallback(['^NSEI', '^BSESN']);
      for (const item of MACRO_INDICES.filter(i => i.region === 'India')) {
        const q = indiaQuotes.find((quote: any) => quote.symbol === item.symbol);
        if (q) {
          const { change, changePercent } = resolvePctChange({
            reportedChange: q.regularMarketChange,
            reportedPct: q.regularMarketChangePercent,
            price: q.regularMarketPrice,
            prevClose: q.regularMarketPreviousClose,
          });
          indices.push({
            ...item,
            value: q.regularMarketPrice || 0,
            change,
            changePercent,
            previousClose: q.regularMarketPreviousClose || 0,
          });
        }
      }
    }

    // Add global indices from Yahoo Finance (P0771 — unified pct resolver)
    const globalIndicesList = MACRO_INDICES.filter(i => i.region !== 'India');
    for (const item of globalIndicesList) {
      const q = yfQuotes.find((quote: any) => quote.symbol === item.symbol);
      if (q && q.regularMarketPrice) {
        const val = q.regularMarketPrice || 0;
        const { change, changePercent } = resolvePctChange({
          reportedChange: q.regularMarketChange,
          reportedPct: q.regularMarketChangePercent,
          price: val,
          prevClose: q.regularMarketPreviousClose,
        });
        indices.push({
          ...item,
          value: val,
          change,
          changePercent: Math.round(changePercent * 100) / 100,
          previousClose: q.regularMarketPreviousClose || 0,
        });
      }
    }

    // Map currencies, commodities, bonds from Yahoo Finance (P0771)
    const mapYfData = (items: typeof MACRO_CURRENCIES) =>
      items.map(item => {
        const q = yfQuotes.find((quote: any) => quote.symbol === item.symbol);
        const { change, changePercent } = resolvePctChange({
          reportedChange: q?.regularMarketChange,
          reportedPct: q?.regularMarketChangePercent,
          price: q?.regularMarketPrice,
          prevClose: q?.regularMarketPreviousClose,
        });
        return {
          ...item,
          value: q?.regularMarketPrice || 0,
          change,
          changePercent: Math.round(changePercent * 100) / 100,
          previousClose: q?.regularMarketPreviousClose || 0,
        };
      }).filter(i => i.value > 0);

    const responseData = {
      indices: indices.filter(i => i.value > 0),
      currencies: mapYfData(MACRO_CURRENCIES),
      commodities: mapYfData(MACRO_COMMODITIES),
      bonds: mapYfData(MACRO_BONDS),
      source: nseIndices?.data ? 'NSE India + Yahoo Finance' : 'Yahoo Finance',
      updatedAt: new Date().toISOString(),
    };

    // Cache the response before returning
    responseCache.set(cacheKey, { data: responseData, ts: Date.now() });

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Macro data error:', error);
    const errorResponse = { error: 'Failed to fetch macro data', indices: [], currencies: [], commodities: [], bonds: [] };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
