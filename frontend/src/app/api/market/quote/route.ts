import { NextResponse } from 'next/server';
import { fetchStockQuote } from '@/lib/nse';

export const dynamic = 'force-dynamic';

/**
 * GET /api/market/quote?symbols=AEROFLEX,CEINSYS,MACPOWER
 * Fetches individual stock quotes from NSE for tickers not in any index.
 * Returns array of normalized stock quote objects.
 * Max 20 symbols per call to stay within Vercel timeout.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get('symbols') || '';

  // Symbol alias map for known mismatches (BUG-03 fix)
  const SYMBOL_ALIASES: Record<string, string> = {
    'SJS': 'SJSENTERPR',
    'S&SPOWER': 'SNSPWR',
    'SENORES': 'SENORES',         // Verify correct NSE ticker — may need BSE fallback
    'LUMAXTECH': 'LUMAXTECH',
    'ATLANTAELE': 'ATLASCYCLE',   // Verify
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
    return NextResponse.json({ stocks: [], error: 'No valid symbols provided' }, { status: 400 });
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

  return NextResponse.json({
    stocks: results,
    count: results.length,
    requested: symbols.length,
    errors: errors.length > 0 ? errors : undefined,
    source: 'nse-individual',
    updatedAt: new Date().toISOString(),
  });
}
