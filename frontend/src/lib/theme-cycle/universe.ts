// zzz1289 — the sector sets the history chart is built from (long daily histories on Yahoo).
// India: NSE sector indices exist on Yahoo from 2010–11 (Nifty / Bank / IT / Midcap from 2007). For falls that START before
// July 2011 a sector without an index is an equal-weight basket of companies that were large members of it at the time.
// Baskets are chosen with today's knowledge (survivorship bias) — so they are never used after 2011, and the chart labels them.

export interface HistSectorDef { name: string; index?: string; basket?: string[] }

export const HISTORY_SETS: Record<'india' | 'us', { bench: string; benchName: string; basketUntil: string; sectors: HistSectorDef[] }> = {
  india: {
    bench: '^NSEI', benchName: 'Nifty 50', basketUntil: '2011-07-01',
    sectors: [
      { name: 'Bank', index: '^NSEBANK' },
      { name: 'IT', index: '^CNXIT' },
      { name: 'Midcaps', index: '^NSMIDCP' },
      { name: 'Pharma', index: '^CNXPHARMA', basket: ['SUNPHARMA.NS', 'CIPLA.NS', 'DRREDDY.NS', 'LUPIN.NS'] },
      { name: 'FMCG', index: '^CNXFMCG', basket: ['HINDUNILVR.NS', 'ITC.NS', 'NESTLEIND.NS', 'DABUR.NS', 'COLPAL.NS', 'BRITANNIA.NS'] },
      { name: 'Metal', index: '^CNXMETAL', basket: ['TATASTEEL.NS', 'HINDALCO.NS', 'SAIL.NS', 'JSWSTEEL.NS', 'NATIONALUM.NS'] },
      { name: 'Realty', index: '^CNXREALTY', basket: ['DLF.NS', 'UNITECH.NS'] },
      { name: 'Auto', index: '^CNXAUTO', basket: ['MARUTI.NS', 'M&M.NS', 'HEROMOTOCO.NS'] },
      { name: 'Energy', index: '^CNXENERGY', basket: ['RELIANCE.NS', 'ONGC.NS', 'BPCL.NS', 'GAIL.NS', 'NTPC.NS'] },
      { name: 'Infra', index: '^CNXINFRA' },
      { name: 'PSU stocks', index: '^CNXPSE' },
      { name: 'PSU Bank', index: '^CNXPSUBANK' },
      { name: 'Consumption', index: '^CNXCONSUM' },
      { name: 'MNC', index: '^CNXMNC' },
      // Capital goods has no NSE index on Yahoo; basket only for the 2008 / 2010–11 falls (it was the 2007 boom's leader).
      { name: 'Capital goods', basket: ['LT.NS', 'BHEL.NS', 'SIEMENS.NS', 'ABB.NS', 'THERMAX.NS', 'CUMMINSIND.NS'] },
    ],
  },
  us: {
    bench: 'SPY', benchName: 'S&P 500', basketUntil: '1990-01-01',
    sectors: [
      { name: 'Tech', index: 'XLK' }, { name: 'Financials', index: 'XLF' }, { name: 'Energy', index: 'XLE' },
      { name: 'Health care', index: 'XLV' }, { name: 'Consumer disc.', index: 'XLY' }, { name: 'Staples', index: 'XLP' },
      { name: 'Industrials', index: 'XLI' }, { name: 'Materials', index: 'XLB' }, { name: 'Utilities', index: 'XLU' },
      { name: 'Semis', index: 'SOXX' }, { name: 'Software', index: 'IGV' }, { name: 'Biotech', index: 'XBI' },
      { name: 'Regional banks', index: 'KRE' }, { name: 'Defense', index: 'ITA' }, { name: 'Homebuilders', index: 'XHB' },
      { name: 'REITs', index: 'VNQ' }, { name: 'Gold miners', index: 'GDX' }, { name: 'Small caps', index: 'IWM' },
      { name: 'Nasdaq 100', index: 'QQQ' },
    ],
  },
};

/** Falls shown on the chart: 15%+ on the benchmark (configurable). */
export const HISTORY_MIN_DEPTH = 0.15;
