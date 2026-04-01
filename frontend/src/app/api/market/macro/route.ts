import { NextResponse } from 'next/server';
import { fetchAllIndices } from '@/lib/nse';
import { fetchQuotesWithFallback, MACRO_INDICES, MACRO_CURRENCIES, MACRO_COMMODITIES, MACRO_BONDS } from '@/lib/yahoo';

export const dynamic = 'force-dynamic';

export async function GET() {
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

      // NIFTY 50
      const nifty = nseIndexMap['NIFTY 50'] || nseIndexMap['Nifty 50'];
      if (nifty) {
        indices.push({
          symbol: '^NSEI',
          name: 'NIFTY 50',
          region: 'India',
          flag: '🇮🇳',
          value: nifty.last || nifty.lastPrice || 0,
          change: nifty.variation || nifty.change || 0,
          changePercent: nifty.percentChange || nifty.pChange || 0,
          previousClose: nifty.previousClose || nifty.prevClose || 0,
        });
      }

      // SENSEX (from NSE data or BSE)
      const sensex = nseIndexMap['SENSEX'] || nseIndexMap['S&P BSE SENSEX'];
      if (sensex) {
        indices.push({
          symbol: '^BSESN',
          name: 'SENSEX',
          region: 'India',
          flag: '🇮🇳',
          value: sensex.last || sensex.lastPrice || 0,
          change: sensex.variation || sensex.change || 0,
          changePercent: sensex.percentChange || sensex.pChange || 0,
          previousClose: sensex.previousClose || 0,
        });
      }

      // Bank Nifty
      const bankNifty = nseIndexMap['NIFTY BANK'] || nseIndexMap['Nifty Bank'];
      if (bankNifty) {
        indices.push({
          symbol: '^NSEBANK',
          name: 'Bank NIFTY',
          region: 'India',
          flag: '🇮🇳',
          value: bankNifty.last || bankNifty.lastPrice || 0,
          change: bankNifty.variation || bankNifty.change || 0,
          changePercent: bankNifty.percentChange || bankNifty.pChange || 0,
          previousClose: bankNifty.previousClose || 0,
        });
      }

      // NIFTY IT
      const niftyIT = nseIndexMap['NIFTY IT'] || nseIndexMap['Nifty IT'];
      if (niftyIT) {
        indices.push({
          symbol: '^CNXIT',
          name: 'NIFTY IT',
          region: 'India',
          flag: '🇮🇳',
          value: niftyIT.last || niftyIT.lastPrice || 0,
          change: niftyIT.variation || niftyIT.change || 0,
          changePercent: niftyIT.percentChange || niftyIT.pChange || 0,
          previousClose: niftyIT.previousClose || 0,
        });
      }

      // NIFTY Pharma
      const niftyPharma = nseIndexMap['NIFTY PHARMA'] || nseIndexMap['Nifty Pharma'];
      if (niftyPharma) {
        indices.push({
          symbol: '^CNXPHARMA',
          name: 'NIFTY Pharma',
          region: 'India',
          flag: '🇮🇳',
          value: niftyPharma.last || niftyPharma.lastPrice || 0,
          change: niftyPharma.variation || niftyPharma.change || 0,
          changePercent: niftyPharma.percentChange || niftyPharma.pChange || 0,
          previousClose: niftyPharma.previousClose || 0,
        });
      }
    } else {
      // Fallback: use Yahoo Finance for Indian indices
      const indiaQuotes = await fetchQuotesWithFallback(['^NSEI', '^BSESN']);
      for (const item of MACRO_INDICES.filter(i => i.region === 'India')) {
        const q = indiaQuotes.find((quote: any) => quote.symbol === item.symbol);
        if (q) {
          indices.push({
            ...item,
            value: q.regularMarketPrice || 0,
            change: q.regularMarketChange || 0,
            changePercent: q.regularMarketChangePercent || 0,
            previousClose: q.regularMarketPreviousClose || 0,
          });
        }
      }
    }

    // Add global indices from Yahoo Finance
    const globalIndicesList = MACRO_INDICES.filter(i => i.region !== 'India');
    for (const item of globalIndicesList) {
      const q = yfQuotes.find((quote: any) => quote.symbol === item.symbol);
      if (q && q.regularMarketPrice) {
        const val = q.regularMarketPrice || 0;
        const chg = q.regularMarketChange || 0;
        let chgPct = q.regularMarketChangePercent || 0;
        // Fallback: compute change% from change and value if API returns 0
        if (!chgPct && chg !== 0 && val !== 0) {
          chgPct = Math.round((chg / (val - chg)) * 10000) / 100;
        }
        indices.push({
          ...item,
          value: val,
          change: chg,
          changePercent: chgPct,
          previousClose: q.regularMarketPreviousClose || 0,
        });
      }
    }

    // Map currencies, commodities, bonds from Yahoo Finance
    const mapYfData = (items: typeof MACRO_CURRENCIES) =>
      items.map(item => {
        const q = yfQuotes.find((quote: any) => quote.symbol === item.symbol);
        let changePercent = q?.regularMarketChangePercent || 0;

        // Fallback calculation if Yahoo Finance doesn't provide changePercent
        if (!changePercent && q?.regularMarketChange !== undefined && q?.regularMarketPrice) {
          const change = q.regularMarketChange;
          const value = q.regularMarketPrice;
          changePercent = change !== 0 && value !== 0 ? (change / (value - change)) * 100 : 0;
          changePercent = Math.round(changePercent * 100) / 100; // Round to 2 decimal places
        }

        return {
          ...item,
          value: q?.regularMarketPrice || 0,
          change: q?.regularMarketChange || 0,
          changePercent,
          previousClose: q?.regularMarketPreviousClose || 0,
        };
      }).filter(i => i.value > 0);

    return NextResponse.json({
      indices: indices.filter(i => i.value > 0),
      currencies: mapYfData(MACRO_CURRENCIES),
      commodities: mapYfData(MACRO_COMMODITIES),
      bonds: mapYfData(MACRO_BONDS),
      source: nseIndices?.data ? 'NSE India + Yahoo Finance' : 'Yahoo Finance',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Macro data error:', error);
    return NextResponse.json({ error: 'Failed to fetch macro data', indices: [], currencies: [], commodities: [], bonds: [] }, { status: 500 });
  }
}
