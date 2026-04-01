import { NextResponse } from 'next/server';
import { fetchStockQuote } from '@/lib/nse';

export const dynamic = 'force-dynamic';

// Response-level cache (avoids re-assembly on rapid polls)
const responseCache = new Map<string, { data: any; ts: number }>();
const RESPONSE_TTL = 30_000; // 30s cache for assembled response

/**
 * GET /api/market/quote?symbols=AEROFLEX,CEINSYS,MACPOWER
 * Fetches individual stock quotes from NSE for tickers not in any index.
 * Returns array of normalized stock quote objects.
 * Max 20 symbols per call to stay within Vercel timeout.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get('symbols') || '';

  // Build cache key based on symbols param
  const cacheKey = `quote:${symbolsParam}`;

  // Check response cache
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < RESPONSE_TTL) {
    return NextResponse.json(cached.data);
  }

  // Symbol alias map for known mismatches (BUG-03 fix)
  const SYMBOL_ALIASES: Record<string, string> = {
    'SJS': 'SJSENTERPR',
    'S&SPOWER': 'S&SPOWER',    // NSE uses S&SPOWER; fetchStockQuote handles URL encoding
    'SENORES': 'SENORES',         // Verify correct NSE ticker — may need BSE fallback
    'LUMAXTECH': 'LUMAXTECH',
    'ATLANTAELE': 'ATLASCYCLE',   // Verify
    'GVT&D': 'GVTD',
    'SAVERA': 'SAVERAHOTL',
    'DYNACONS': 'DYNACONS',
    'BORANA': 'BORANAIND',
    'DATAPATTNS': 'DATAPATTNS',
    'MACPOWER': 'MACPOWER',
    'SMLMAH': 'SMLMAH',
    'IZMO': 'IZMO',
    'POWERMECH': 'POWERMECH',
    'UTLSOLAR': 'UTLSOLAR',
  };

  const symbols = symbolsParam
    .split(',')
    .map(s => {
      const upper = s.trim().toUpperCase();
      return SYMBOL_ALIASES[upper] || upper;
    })
    .filter(s => s.length > 0 && /^[A-Z0-9&-]+$/.test(s))
    .slice(0, 20); // Cap at 20

  if (symbols.length === 0) {
    const responseData = { stocks: [], error: 'No valid symbols provided' };
    responseCache.set(cacheKey, { data: responseData, ts: Date.now() });
    return NextResponse.json(responseData, { status: 400 });
  }

  const results: any[] = [];
  const errors: string[] = [];

  // Fetch in parallel (batches of 5 to avoid rate limiting)
  for (let i = 0; i < symbols.length; i += 5) {
    const batch = symbols.slice(i, i + 5);
    const promises = batch.map(async (symbol) => {
      try {
        const data = await fetchStockQuote(symbol);
        if (!data || !data.priceInfo) {
          errors.push(`${symbol}: no data`);
          return null;
        }

        const pi = data.priceInfo;
        const info = data.info || {};
        const meta = data.metadata || {};

        return {
          ticker: info.symbol || symbol,
          company: info.companyName || meta.companyName || symbol,
          sector: meta.industry || info.industry || '—',
          industry: meta.industry || info.industry || '—',
          price: pi.lastPrice || pi.close || 0,
          change: pi.change || 0,
          changePercent: pi.pChange || 0,
          dayHigh: pi.intraDayHighLow?.max || pi.lastPrice || 0,
          dayLow: pi.intraDayHighLow?.min || pi.lastPrice || 0,
          open: pi.open || 0,
          previousClose: pi.previousClose || 0,
          weekHigh52: pi.weekHighLow?.max || 0,
          weekLow52: pi.weekHighLow?.min || 0,
          totalTradedVolume: data.preOpenMarket?.totalTradedVolume || 0,
          marketCap: data.securityInfo?.issuedSize ? (data.securityInfo.issuedSize * (pi.lastPrice || 0)) / 10000000 : null,
        };
      } catch (err) {
        errors.push(`${symbol}: ${err instanceof Error ? err.message : 'fetch failed'}`);
        return null;
      }
    });

    const batchResults = await Promise.all(promises);
    results.push(...batchResults.filter(Boolean));
  }

  const responseData = {
    stocks: results,
    count: results.length,
    requested: symbols.length,
    errors: errors.length > 0 ? errors : undefined,
    source: 'nse-individual',
    updatedAt: new Date().toISOString(),
  };

  // Cache the response before returning
  responseCache.set(cacheKey, { data: responseData, ts: Date.now() });
  // Evict old entries if cache grows too large
  if (responseCache.size > 20) {
    const oldest = [...responseCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    responseCache.delete(oldest[0]);
  }

  return NextResponse.json(responseData);
}
