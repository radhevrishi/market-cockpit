// zzz943 — the Yahoo symbol for a ticker as the owner writes it (TradingView style). Index names TradingView uses (NSE:CNXSMALLCAP,
// NSE:NIFTY, SP:SPX …) and renamed companies (TATAMOTORS after the 2025 demerger) are mapped; everything else is TICKER.NS / TICKER
// (US, "." written "-"). Pure.
export type YMarket = 'IN' | 'US';

const IN_ALIAS: Record<string, string> = {
  NIFTY: '^NSEI', NIFTY50: '^NSEI', NIFTY_50: '^NSEI', CNXNIFTY: '^NSEI',
  BANKNIFTY: '^NSEBANK', NIFTYBANK: '^NSEBANK', CNXBANK: '^NSEBANK',
  CNXSMALLCAP: '^CNXSC', NIFTYSMALLCAP: '^CNXSC', NIFTY_SMLCAP_100: '^CNXSC', NIFTYSMLCAP100: '^CNXSC',
  CNXMIDCAP: '^NSEMDCP50', NIFTYMIDCAP50: '^NSEMDCP50', NIFTY_MIDCAP_50: '^NSEMDCP50',
  CNXIT: '^CNXIT', NIFTYIT: '^CNXIT', CNXAUTO: '^CNXAUTO', CNXPHARMA: '^CNXPHARMA', CNXMETAL: '^CNXMETAL', CNXFMCG: '^CNXFMCG',
  CNXENERGY: '^CNXENERGY', CNXREALTY: '^CNXREALTY', CNXINFRA: '^CNXINFRA', CNXPSUBANK: '^CNXPSUBANK',
  INDIAVIX: '^INDIAVIX', SENSEX: '^BSESN', BSESENSEX: '^BSESN',
  // renamed after corporate actions (TradingView keeps the old name in old lists)
  TATAMOTORS: 'TMPV.NS',
};
const US_ALIAS: Record<string, string> = {
  SPX: '^GSPC', SP500: '^GSPC', NDX: '^NDX', IXIC: '^IXIC', NASDAQ: '^IXIC', DJI: '^DJI', DJIA: '^DJI', VIX: '^VIX', RUT: '^RUT', DXY: 'DX-Y.NYB',
};

/** Yahoo symbols to try, best first. */
export function yahooCandidates(market: YMarket, ticker: string): string[] {
  const t = String(ticker || '').trim().toUpperCase();
  if (market === 'IN') { const a = IN_ALIAS[t]; return a ? [a] : [`${t}.NS`, `${t}.BO`]; }
  const a = US_ALIAS[t];
  return a ? [a] : [t.replace(/[./]/g, '-')];
}
export const isIndexAlias = (market: YMarket, ticker: string): boolean => (yahooCandidates(market, ticker)[0] || '').startsWith('^');
