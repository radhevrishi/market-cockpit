// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { analyzeDilution, computeReinvestmentEngine, computeFrameworkCoverage, buildMissingDimensions, type DilutionAnalysis, type ReinvestmentEngine, type FrameworkCoverage } from '@/lib/multibagger/framework-extensions';
import type { ExcelRow } from '@/lib/multibagger-india-scoring';

// ═══════════════════════════════════════════════════════════════════════════════
// COLUMN DETECTION — Screener.in + extra custom fields
// ═══════════════════════════════════════════════════════════════════════════════

export function buildColMap(sampleRow: Record<string,unknown>): Record<string,string> {
  const m: Record<string,string> = {};
  for (const col of Object.keys(sampleRow)) {
    const c=col.trim().toLowerCase().replace(/[^a-z0-9%]/g,'');
    const o=col.trim();
    // Screener.in exact names
    if (o==='NSE Code'||o==='NSE code')                            m['symbol']=col;
    else if (o==='BSE Code'||o==='BSE code')                       m['bseCode']=col;
    else if (o==='Name')                                           m['company']=col;
    else if (o==='Industry')          {if(!m['sector'])            m['sector']=col;}
    else if (o==='Industry Group')    {if(!m['sector'])            m['sector']=col;}
    else if (o==='Return on capital employed')                     m['roce']=col;
    else if (o==='Return on equity')                               m['roe']=col;
    else if (o==='OPM')                                            m['opm']=col;
    else if (o==='CFO to PAT')                                     m['cfoToPat']=col;
    else if (o==='Debt to equity')                                 m['de']=col;
    else if (o==='Sales growth')                                   m['revCagr']=col;
    else if (o==='Sales growth 3Years'||o==='Sales growth 3 Years')m['salesGrowth3y']=col;
    else if (o==='Profit growth')                                  m['profitCagr']=col;
    else if (o==='YOY Quarterly sales growth')                     m['yoySalesGrowth']=col;
    else if (o==='YOY Quarterly profit growth')                    m['yoyProfitGrowth']=col;
    else if (o==='Promoter holding')                               m['promoter']=col;
    else if (o==='Change in promoter holding')                     m['changeInPromoter']=col;
    else if (o==='Price to Earning')                               m['pe']=col;
    else if (o==='PEG Ratio')                                      m['peg']=col;
    else if (o==='Market Capitalization')                          m['marketCapCr']=col;
    else if (o==='Intrinsic Value')                                m['intrinsicValue']=col;
    else if (o==='Current Price')                                  m['price']=col;
    else if (o==='DMA 200')                                        m['dma200']=col;
    else if (o==='DMA 50' || o==='DMA50')                            m['dma50']=col;  // PATCH 1060 — explicit DMA 50 parse
    else if (o==='Return over 1month')                             m['return1m']=col;
    else if (o==='Return over 1week')                              m['return1w']=col;
    // New fields users may add
    else if (o==='FII Holding'||o==='FII holding')                 m['fii']=col;
    else if (o==='DII Holding'||o==='DII holding')                 m['dii']=col;
    else if (o==='Free Cash Flow'||o==='FCF')                      m['fcfAbsolute']=col;
    else if (o==='EBITDA')                                         m['ebitda']=col;
    else if (o==='Net Debt'||o==='Net debt')                       m['netDebt']=col;
    else if (o==='EPS'||o==='EPS (TTM)')                           m['eps']=col;
    else if (o==='EPS growth'||o==='EPS Growth')                   m['epsGrowth']=col;
    else if (o==='Pledged percentage'||o==='Pledged Percentage')   m['pledge']=col;
    // ── Kill-switch metrics ──
    else if (o==='Gross profit margin'||o==='Gross Profit Margin'||o==='GPM'||o==='Gross Margin'||o==='GPM latest quarter'||o==='GPM Latest Quarter') m['gpm']=col;
    else if (o==='Return on invested capital'||o==='ROIC'||o==='Return on Invested Capital') m['roic']=col;
    // ── GAP 2: OPM comparison — Screener "OPM last year" or custom "OPM 3Years" ──
    else if (o==='OPM last year'||o==='OPM preceding year')        m['opmPrev']=col;
    else if (o==='OPM 3Years'||o==='OPM 3 Years'||o==='Operating Profit Margin 3Years')
      m['opm3yr']=col;
    // ── GAP 1: ROCE history — requires custom Screener ratio ──
    else if (o==='Return on capital employed 3Years'||o==='ROCE 3Years'||o==='ROCE 3 Years'||o==='Return on capital employed 3 Years')
      m['roce3yr']=col;
    // ── GAP 7: 52W High — Screener calls it "High price" ──
    else if (o==='High price'||o==='52 Week High'||o==='52W High'||o==='52wk High')
      m['high52w']=col;
    // ── GAP 7: % from 52W High — Screener already computes this ("From 52W High") ──
    // PATCH 1024 — added 'From 52w high' (lowercase 'w'+'high') — actual Screener.in export spelling.
    else if (o==='From 52W High'||o==='From 52 week high'||o==='from 52W High'||o==='From 52w high'||o==='From 52w High')
      m['pctFrom52wHighDirect']=col;
    // ── GAP 5: EV/EBITDA direct — user added as custom ratio ("EV / EBITDA") ──
    else if (o==='EV / EBITDA'||o==='EV/EBITDA'||o==='Enterprise Value/EBITDA'||o==='EV to EBITDA')
      m['evEbitdaDirect']=col;
    // ── GAP 5: FCF Yield direct — user added as custom ratio ("FCF Yield") ──
    else if (o==='FCF Yield'||o==='FCF Yield %'||o==='Free cash flow yield'||o==='FCF yield')
      m['fcfYieldDirect']=col;
    // ── PATCH 0317 / 0332: New institutional metrics ────────────────────────
    // Aliases align with the actual Screener.in export column names
    // (see sample upload analysis). Includes both Screener's "Debtor days"
    // and the alternate "Days Receivable Outstanding" naming.
    else if (o==='Debtor Days'||o==='Debtor days'||o==='Days sales outstanding'||o==='DSO'||
             o==='Days Receivable Outstanding')
      m['debtorDays']=col;
    else if (o==='Inventory Days'||o==='Inventory days'||o==='Days inventory outstanding'||
             o==='Days Inventory Outstanding'||o==='DIO')
      m['inventoryDays']=col;
    else if (o==='Creditor Days'||o==='Creditor days'||o==='Days payable outstanding'||
             o==='Days Payable Outstanding'||o==='DPO')
      m['creditorDays']=col;
    else if (o==='Working Capital Days'||o==='Working capital days'||o==='WC Days'||
             o==='Cash Conversion Cycle'||o==='CCC')
      m['workingCapitalDays']=col;
    // PATCH 0332 — Trend metrics from Screener
    else if (o==='Debtor days 3years back'||o==='Debtor Days 3Y back')
      m['debtorDays3y']=col;
    else if (o==='Average Working Capital Days 3years'||o==='Working Capital Days 3Y avg')
      m['workingCapitalDays3y']=col;
    // PATCH 0332 — Other Income raw (Screener exposes as "Other income" ₹ Cr)
    // We use it directly when % vs PBT isn't separately available.
    else if (o==='Other income'||o==='Other Income')
      m['otherIncome']=col;
    // PATCH 0332 — 5Y high/low for volatility range computation
    else if (o==='Low price all time'||o==='Low Price All Time')
      m['lowPriceAllTime']=col;
    else if (o==='High price all time'||o==='High Price All Time')
      m['highPriceAllTime']=col;
    // PATCH 0332 — Equity capital → share count proxy (Equity capital ₹ Cr / par value 10 = share count Cr)
    else if (o==='Equity capital'||o==='Equity Capital'||o==='Equity Share Capital')
      m['equityCapital']=col;
    // PATCH 0334 — Ownership-change-3Years columns from Screener. These let us
    // synthesize multi-period history from a 3Y delta instead of needing 4
    // separate quarter-back columns.
    else if (o==='Change in promoter holding 3Years'||o==='Change in Promoter Holding 3Years'||o==='Promoter holding change 3Y')
      m['changeInPromoter3y']=col;
    else if (o==='Change in FII holding'||o==='Change in FII Holding'||o==='FII change 1Y')
      m['changeInFii1y']=col;
    else if (o==='Change in FII holding 3Years'||o==='Change in FII Holding 3Years'||o==='FII change 3Y')
      m['changeInFii3y']=col;
    else if (o==='Change in DII holding'||o==='Change in DII Holding'||o==='DII change 1Y')
      m['changeInDii1y']=col;
    else if (o==='Change in DII holding 3Years'||o==='Change in DII Holding 3Years'||o==='DII change 3Y')
      m['changeInDii3y']=col;
    else if (o==='Interest Coverage Ratio'||o==='Interest Coverage'||o==='Interest coverage'||o==='ICR')
      m['interestCoverage']=col;
    else if (o==='Tax rate %'||o==='Tax Rate %'||o==='Effective Tax Rate'||o==='Effective tax rate')
      m['effectiveTaxRate']=col;
    else if (o==='Capex 3Yrs'||o==='Capex 3Years'||o==='Capex 3 Years'||o==='Capex 3yr')
      m['capex3yr']=col;
    else if (o==='Dividend Yield'||o==='Dividend yield'||o==='Div Yield'||o==='DY')
      m['dividendYield']=col;
    // Promoter / FII / DII multi-quarter history. Screener export style:
    // "Promoter holding 1 quarters back", "Promoter holding 2 quarters back" …
    else if (/^Promoter holding\s+(\d+)\s+quarters?\s+back$/i.test(o))
      m['promoterHistory_'+o.match(/^Promoter holding\s+(\d+)/i)![1]]=col;
    else if (/^FII\s+holding\s+(\d+)\s+quarters?\s+back$/i.test(o))
      m['fiiHistory_'+o.match(/^FII\s+holding\s+(\d+)/i)![1]]=col;
    else if (/^DII\s+holding\s+(\d+)\s+quarters?\s+back$/i.test(o))
      m['diiHistory_'+o.match(/^DII\s+holding\s+(\d+)/i)![1]]=col;
    else if (o==='Avg traded value'||o==='Average Daily Volume'||o==='ADV'||o==='Avg Daily Value (Cr)')
      m['avgDailyValueCr']=col;
    // ── PATCH 0322: Forensic pump-detection columns ──────────────────────────
    else if (o==='Other Income'||o==='Other income'||o==='Other Inc')
      m['otherIncome']=col;  // raw value; we compute the % ourselves if PBT is available
    else if (o==='Other Income / PBT %'||o==='Other Income % of PBT'||o==='Other Income to PBT')
      m['otherIncomePctPbt']=col;
    else if (o==='Cash and equivalents'||o==='Cash & Equivalents'||o==='Cash Equivalents'||o==='Cash')
      m['cashAndEq']=col;
    else if (o==='Cash and equivalents preceding year'||o==='Cash 1Y ago'||o==='Cash Preceding Year')
      m['cashAndEqPrev']=col;
    else if (o==='Number of equity shares'||o==='Equity Shares'||o==='Shares Outstanding')
      m['numSharesNow']=col;
    else if (o==='Number of equity shares preceding 3 years'||o==='Equity Shares 3Y ago'||o==='Shares 3Y back')
      m['numShares3y']=col;
    else if (o==='Related Party Transactions %'||o==='RPT % Revenue'||o==='Related Party % Revenue')
      m['rptRevenuePct']=col;
    else if (o==='Auditor Changes Last 3Y'||o==='Auditor changes')
      m['auditorChangesLast3y']=col;
    else if (o==='Number of Subsidiaries'||o==='Subsidiary Count'||o==='Subsidiaries')
      m['subsidiaryCount']=col;
    else if (o==='Free Float %'||o==='Free Float'||o==='Public Float %')
      m['freeFloatPct']=col;
    else if (o==='52 Week Range %'||o==='High Low Range %'||o==='52W Range Pct')
      m['highLowRangePct']=col;
    else if (o==='Promoter Group Entities'||o==='Promoter Entities Count')
      m['promoterEntityCount']=col;
    // ── VALUATION-A: columns for the automated valuation models ─────────────
    else if (o==='Book value'||o==='Book Value'||o==='BVPS'||o==='Book Value per Share')
      m['bookValue']=col;
    else if (o==='EBIT')
      m['ebit']=col;
    else if (o==='Enterprise Value'||o==='EV')
      m['enterpriseValue']=col;
    else if (o==='Industry PE'||o==='Industry P/E'||o==='Sector PE')
      m['industryPe']=col;
    else if (o==='Historical PE 5Years'||o==='Historical PE 5 Years'||o==='Historical PE 5Y'||o==='5Y Median PE')
      m['historicalPe5y']=col;
    else if (o==='OPM 5Year'||o==='OPM 5 Year'||o==='OPM 5Y')
      m['opm5y']=col;
    else if (o==='Sales' && !m['salesAnnual'])
      m['salesAnnual']=col;
    // Generic fallbacks
    else if (!m['symbol']&&(c.includes('nsecode')||c.includes('symbol')||c.includes('ticker'))) m['symbol']=col;
    else if (!m['company']&&c.includes('name')&&!c.includes('sector')) m['company']=col;
    else if (!m['sector']&&(c.includes('sector')||c.includes('industry'))) m['sector']=col;
    else if (!m['roce']&&(c==='roce'||c.includes('returnoncap'))) m['roce']=col;
    else if (!m['roe']&&(c==='roe'||c.includes('returnonequit'))) m['roe']=col;
    else if (!m['opm']&&(c==='opm'||c.includes('operatingmargin'))) m['opm']=col;
    else if (!m['cfoToPat']&&(c.includes('cfotopat')||c.includes('cashflowpat'))) m['cfoToPat']=col;
    else if (!m['de']&&(c.includes('debttoequit')||c==='de')) m['de']=col;
    else if (!m['revCagr']&&(c.includes('salescagr')||c.includes('salesgrowth'))) m['revCagr']=col;
    else if (!m['profitCagr']&&(c.includes('profitcagr')||c.includes('profitgrowth')||c.includes('patcagr'))) m['profitCagr']=col;
    else if (!m['promoter']&&c.includes('promoter')&&!c.includes('pledge')&&!c.includes('change')) m['promoter']=col;
    else if (!m['changeInPromoter']&&c.includes('promoter')&&c.includes('change')) m['changeInPromoter']=col;
    else if (!m['pledge']&&c.includes('pledge')) m['pledge']=col;
    else if (!m['icr']&&(c.includes('icr')||c.includes('interestcoverage'))) m['icr']=col;
    else if (!m['pe']&&(c==='pe'||c.includes('priceearning'))) m['pe']=col;
    else if (!m['peg']&&c.includes('peg')) m['peg']=col;
    else if (!m['pb']&&(c==='pb'||c.includes('pricebook'))) m['pb']=col;
    else if (!m['marketCapCr']&&c.includes('marketcap')) m['marketCapCr']=col;
    else if (!m['intrinsicValue']&&(c.includes('intrinsic')||c.includes('fairvalue'))) m['intrinsicValue']=col;
    else if (!m['price']&&c.includes('currentprice')) m['price']=col;
    // PATCH 0446 BUG-031 v2 — Broaden 200-DMA column matching. Audit reported
    // 26+ India stocks showing 'Technical: No data' even when the user's
    // Screener CSV had the column under headers like 'DMA 200' / '200-day
    // moving avg' / 'Price to DMA200 ratio'. Patterns now accept any
    // variant with both 200 + DMA in the header text.
    else if (!m['dma200']&&(c.includes('dma200')||c.includes('200dma')||(c.includes('200')&&c.includes('dma'))||(c.includes('200')&&c.includes('movingavg')))) m['dma200']=col;
    else if (!m['dma50']&&(c.includes('dma50')||c.includes('50dma')||(c.includes('50')&&c.includes('dma'))||(c.includes('50')&&c.includes('movingavg')))) m['dma50']=col;  // PATCH 1060
    else if (!m['fii']&&c.includes('fii')&&!c.includes('change')) m['fii']=col;
    else if (!m['dii']&&c.includes('dii')&&!c.includes('change')) m['dii']=col;
    else if (!m['fcfAbsolute']&&(c.includes('freecash')||c==='fcf')) m['fcfAbsolute']=col;
    else if (!m['ebitda']&&c==='ebitda') m['ebitda']=col;
    else if (!m['netDebt']&&(c.includes('netdebt')||c.includes('borrowing'))) m['netDebt']=col;
    else if (!m['epsGrowth']&&c.includes('epsgrowth')) m['epsGrowth']=col;
    else if (!m['eps']&&(c==='eps'||c.includes('earningspershare'))) m['eps']=col;
    // PATCH 0446 BUG-031 v2 — Broaden 1-month return matching.
    else if (!m['return1m']&&(c.includes('1month')||c.includes('1mreturn')||c.includes('return1m')||c.includes('1mret')||(c.includes('30day')&&c.includes('return')))) m['return1m']=col;
    else if (!m['roce3yr']&&(c.includes('roce')||c.includes('returnoncap'))&&(c.includes('3yr')||c.includes('3year')||c.includes('3y')&&c.includes('ago'))) m['roce3yr']=col;
    else if (!m['opm3yr']&&(c.includes('opm')||c.includes('operatingmargin'))&&(c.includes('3yr')||c.includes('3year'))) m['opm3yr']=col;
    else if (!m['opmPrev']&&(c.includes('opm')||c.includes('operatingmargin'))&&(c.includes('lastyear')||c.includes('preceding')||c.includes('prevyr')||c.includes('lastyear'))) m['opmPrev']=col;
    else if (!m['high52w']&&(c.includes('highprice')||c.includes('52whigh')||(c.includes('52')&&c.includes('high')))) m['high52w']=col;
    else if (!m['pctFrom52wHighDirect']&&(c.includes('from52w')||c.includes('from52week'))) m['pctFrom52wHighDirect']=col;
    else if (!m['evEbitdaDirect']&&(c.includes('evebitda')||c.includes('evtoebitda')||(c.includes('ev')&&c.includes('ebitda')))) m['evEbitdaDirect']=col;
    else if (!m['fcfYieldDirect']&&(c.includes('fcfyield')||c.includes('freecashflowyield'))) m['fcfYieldDirect']=col;
    else if (!m['gpm']&&(c.includes('grossprofit')&&c.includes('margin')||c==='gpm'||c.includes('grossmargin'))) m['gpm']=col;
    else if (!m['roic']&&(c.includes('returnoninvested')||c==='roic')) m['roic']=col;
  }
  return m;
}

export function rawRowToExcelRow(row: Record<string,unknown>, m: Record<string,string>): ExcelRow|null {
  const n=(val: unknown): number|undefined => {
    if(val===''||val===null||val===undefined) return undefined;
    const v=parseFloat(String(val).replace(/[%,₹ ]/g,''));
    return isNaN(v)?undefined:v;
  };
  // Prefer NSE Code; fall back to BSE Code for BSE-only listings (e.g. AXTEL).
  // If both are empty, derive a sanitized symbol from the company name so we
  // don't silently drop institutionally-relevant rows.
  let sym=String(row[m['symbol']]??'').trim().toUpperCase();
  if (!sym && m['bseCode']) {
    const bse = String(row[m['bseCode']]??'').trim();
    if (bse) sym = `BSE:${bse}`;
  }
  if (!sym) {
    const name = String(row[m['company']??'']??'').trim();
    if (name) sym = name.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 12);
  }
  if(!sym) return null;
  const price=n(m['price']?row[m['price']]:undefined);
  const iv=n(m['intrinsicValue']?row[m['intrinsicValue']]:undefined);
  const dma=n(m['dma200']?row[m['dma200']]:undefined);
  const dma50raw=n(m['dma50']?row[m['dma50']]:undefined);  // PATCH 1060
  const netDebt=n(m['netDebt']?row[m['netDebt']]:undefined);
  const ebitda=n(m['ebitda']?row[m['ebitda']]:undefined);
  const fii=n(m['fii']?row[m['fii']]:undefined);
  const dii=n(m['dii']?row[m['dii']]:undefined);
  const mcap=n(m['marketCapCr']?row[m['marketCapCr']]:undefined);
  const fcfAbs=n(m['fcfAbsolute']?row[m['fcfAbsolute']]:undefined);
  const roce_cur=n(m['roce']?row[m['roce']]:undefined);
  const opm_cur=n(m['opm']?row[m['opm']]:undefined);
  const roce3yr=n(m['roce3yr']?row[m['roce3yr']]:undefined);
  const opm3yr=n(m['opm3yr']?row[m['opm3yr']]:undefined);
  const opmPrev=n(m['opmPrev']?row[m['opmPrev']]:undefined);  // Screener "OPM last year"
  const opm5y=n(m['opm5y']?row[m['opm5y']]:undefined);  // PATCH 1025 5y margin trend
  const high52w=n(m['high52w']?row[m['high52w']]:undefined);  // Screener "High price"
  // Direct columns (user-added custom ratios from Screener):
  const pctFrom52wHighDirect=n(m['pctFrom52wHighDirect']?row[m['pctFrom52wHighDirect']]:undefined);
  const evEbitdaDirect=n(m['evEbitdaDirect']?row[m['evEbitdaDirect']]:undefined);
  const fcfYieldDirect=n(m['fcfYieldDirect']?row[m['fcfYieldDirect']]:undefined);
  // Determine which OPM comparison base is available: prefer 3yr, fall back to 1yr
  const opmBase = opm3yr ?? opmPrev;  // undefined if neither available
  return {
    // VALUATION-A — attach raw CSV row so the valuation engine can read
    // any of the 60+ columns without us having to promote every one. Safe
    // because the row is a plain object of primitives.
    _raw: row,
    symbol:sym,
    company:String(row[m['company']??'']??'').trim(),
    sector:String(row[m['sector']??'']??'INDUSTRIALS').trim()||'INDUSTRIALS',
    roce:n(m['roce']?row[m['roce']]:undefined),
    roe:n(m['roe']?row[m['roe']]:undefined),
    opm:n(m['opm']?row[m['opm']]:undefined),
    cfoToPat:n(m['cfoToPat']?row[m['cfoToPat']]:undefined),
    de:n(m['de']?row[m['de']]:undefined),
    pledge:n(m['pledge']?row[m['pledge']]:undefined),
    icr:n(m['icr']?row[m['icr']]:undefined),
    // PATCH 1027: clamp Sales CAGR — abs >200% means base near zero (demerger/restatement)
    revCagr: (() => { const v = n(m['revCagr']?row[m['revCagr']]:n(m['salesGrowth3y']?row[m['salesGrowth3y']]:undefined)); return (v !== undefined && Math.abs(v) > 200) ? undefined : v; })(),
    // PATCH 1027: clamp Profit CAGR similar to Sales CAGR
    profitCagr: (() => { const v = n(m['profitCagr']?row[m['profitCagr']]:undefined); return (v !== undefined && Math.abs(v) > 300) ? undefined : v; })(),
    yoySalesGrowth:n(m['yoySalesGrowth']?row[m['yoySalesGrowth']]:undefined),
    yoyProfitGrowth:n(m['yoyProfitGrowth']?row[m['yoyProfitGrowth']]:undefined),
    epsGrowth:n(m['epsGrowth']?row[m['epsGrowth']]:undefined),
    eps:n(m['eps']?row[m['eps']]:undefined),
    promoter:n(m['promoter']?row[m['promoter']]:undefined),
    changeInPromoter:n(m['changeInPromoter']?row[m['changeInPromoter']]:undefined),
    pe:n(m['pe']?row[m['pe']]:undefined),
    pb:n(m['pb']?row[m['pb']]:undefined),
    peg:n(m['peg']?row[m['peg']]:undefined),
    marketCapCr:n(m['marketCapCr']?row[m['marketCapCr']]:undefined),
    intrinsicValue:iv,
    price,
    dma200:dma,
    dma50:dma50raw,  // PATCH 1060
    fii,
    dii,
    netDebt,
    ebitda,
    fcfAbsolute:n(m['fcfAbsolute']?row[m['fcfAbsolute']]:undefined),
    return1m:n(m['return1m']?row[m['return1m']]:undefined),
    return1w:n(m['return1w']?row[m['return1w']]:undefined),
    // ── New raw fields ──
    // PATCH 1027: clamp GPM to 0-100%, reject 100% on bank/insurance/exchange (artefact)
    gpm: (() => {
      const g = n(m['gpm']?row[m['gpm']]:undefined);
      if (g === undefined || g < 0 || g > 100) return undefined;
      const s = String(row[m['sector']??'']??'').toLowerCase();
      if (g >= 99.5 && /bank|insurance|capital markets|asset management/.test(s)) return undefined;
      return g;
    })(),
    roic: n(m['roic']?row[m['roic']]:undefined),
    roce3yr,
    opm3yr,
    opmPrev,
    opm5y,  // PATCH 1026: pass through to scorer
    high52w,
    // ── PATCH 0317: Additional institutional metrics ──
    debtorDays: n(m['debtorDays']?row[m['debtorDays']]:undefined),
    inventoryDays: n(m['inventoryDays']?row[m['inventoryDays']]:undefined),
    creditorDays: n(m['creditorDays']?row[m['creditorDays']]:undefined),
    workingCapitalDays: n(m['workingCapitalDays']?row[m['workingCapitalDays']]:undefined),
    debtorDays3y: n(m['debtorDays3y']?row[m['debtorDays3y']]:undefined),
    workingCapitalDays3y: n(m['workingCapitalDays3y']?row[m['workingCapitalDays3y']]:undefined),
    interestCoverage: n(m['interestCoverage']?row[m['interestCoverage']]:undefined),
    effectiveTaxRate: n(m['effectiveTaxRate']?row[m['effectiveTaxRate']]:undefined),
    capex3yr: n(m['capex3yr']?row[m['capex3yr']]:undefined),
    dividendYield: n(m['dividendYield']?row[m['dividendYield']]:undefined),
    avgDailyValueCr: n(m['avgDailyValueCr']?row[m['avgDailyValueCr']]:undefined),
    // Multi-quarter history — collected from m['promoterHistory_N'] entries.
    // Sorted oldest first (highest N back) → latest (1 quarter back / current).
    // PATCH 0334 — fall back to synthesizing a 2-point history from
    // "Change in promoter holding 3Years" + current promoter when 4Q
    // columns aren't present (most users don't add all 4 quarters).
    promoterHistory: (() => {
      const entries: Array<[number, number]> = [];
      for (const k of Object.keys(m)) {
        if (k.startsWith('promoterHistory_')) {
          const qBack = parseInt(k.slice('promoterHistory_'.length), 10);
          const v = n(row[m[k]]);
          if (v !== undefined && Number.isFinite(qBack)) entries.push([qBack, v]);
        }
      }
      if (entries.length > 0) {
        entries.sort((a, b) => b[0] - a[0]); // oldest (highest N) → newest
        return entries.map(([, v]) => v);
      }
      // PATCH 0334 — synthesize [3Y-ago, current] from change-3Y delta
      const current = n(m['promoter']?row[m['promoter']]:undefined);
      const change3y = n(m['changeInPromoter3y']?row[m['changeInPromoter3y']]:undefined);
      if (current !== undefined && change3y !== undefined) {
        return [current - change3y, current];
      }
      return undefined;
    })(),
    fiiHistory: (() => {
      const entries: Array<[number, number]> = [];
      for (const k of Object.keys(m)) {
        if (k.startsWith('fiiHistory_')) {
          const qBack = parseInt(k.slice('fiiHistory_'.length), 10);
          const v = n(row[m[k]]);
          if (v !== undefined && Number.isFinite(qBack)) entries.push([qBack, v]);
        }
      }
      if (entries.length > 0) {
        entries.sort((a, b) => b[0] - a[0]);
        return entries.map(([, v]) => v);
      }
      // PATCH 0334 — synthesize 3-point [3Y-ago, 1Y-ago, current] when
      // Change-1Y + Change-3Y are present. Otherwise just 2 points.
      const current = n(m['fii']?row[m['fii']]:undefined);
      const change1y = n(m['changeInFii1y']?row[m['changeInFii1y']]:undefined);
      const change3y = n(m['changeInFii3y']?row[m['changeInFii3y']]:undefined);
      if (current !== undefined && change3y !== undefined && change1y !== undefined) {
        const oneYearAgo = current - change1y;
        const threeYearsAgo = current - change3y;
        return [threeYearsAgo, oneYearAgo, current];
      }
      if (current !== undefined && change3y !== undefined) {
        return [current - change3y, current];
      }
      return undefined;
    })(),
    diiHistory: (() => {
      const entries: Array<[number, number]> = [];
      for (const k of Object.keys(m)) {
        if (k.startsWith('diiHistory_')) {
          const qBack = parseInt(k.slice('diiHistory_'.length), 10);
          const v = n(row[m[k]]);
          if (v !== undefined && Number.isFinite(qBack)) entries.push([qBack, v]);
        }
      }
      if (entries.length > 0) {
        entries.sort((a, b) => b[0] - a[0]);
        return entries.map(([, v]) => v);
      }
      // PATCH 0334 — synthesize from Change-1Y + Change-3Y for DII too.
      const current = n(m['dii']?row[m['dii']]:undefined);
      const change1y = n(m['changeInDii1y']?row[m['changeInDii1y']]:undefined);
      const change3y = n(m['changeInDii3y']?row[m['changeInDii3y']]:undefined);
      if (current !== undefined && change3y !== undefined && change1y !== undefined) {
        const oneYearAgo = current - change1y;
        const threeYearsAgo = current - change3y;
        return [threeYearsAgo, oneYearAgo, current];
      }
      if (current !== undefined && change3y !== undefined) {
        return [current - change3y, current];
      }
      return undefined;
    })(),
    // PATCH 0322: Forensic fields
    otherIncomePctPbt: (() => {
      // Prefer explicit % column.
      const explicit = n(m['otherIncomePctPbt']?row[m['otherIncomePctPbt']]:undefined);
      if (explicit !== undefined) return explicit;
      // PATCH 0332 — derive from raw "Other Income" (₹ Cr) + EPS + Equity Capital.
      // Net Profit ≈ EPS × share_count (where share_count = EqCap / 10).
      // PBT ≈ Net Profit / (1 - tax_rate); use 0.25 as the standard Indian rate.
      const otherInc = n(m['otherIncome']?row[m['otherIncome']]:undefined);
      const epsVal = n(m['eps']?row[m['eps']]:undefined);
      const eqCap = n(m['equityCapital']?row[m['equityCapital']]:undefined);
      if (otherInc !== undefined && epsVal !== undefined && eqCap !== undefined && eqCap > 0) {
        const shares = eqCap * 10; // crore shares at ₹10 par
        const netProfit = epsVal * shares; // ₹ Cr
        if (netProfit <= 0) return undefined;
        const pbtApprox = netProfit / (1 - 0.25);
        if (pbtApprox <= 0) return undefined;
        return (otherInc / pbtApprox) * 100;
      }
      return undefined;
    })(),
    cashAndEq: n(m['cashAndEq']?row[m['cashAndEq']]:undefined),
    cashAndEqPrev: n(m['cashAndEqPrev']?row[m['cashAndEqPrev']]:undefined),
    numSharesNow: (() => {
      // PATCH 0332 — derive from Equity Capital (₹ Cr) ÷ par value (10 INR default)
      // when Screener doesn't expose share count directly.
      const explicit = n(m['numSharesNow']?row[m['numSharesNow']]:undefined);
      if (explicit !== undefined) return explicit;
      const eqCap = n(m['equityCapital']?row[m['equityCapital']]:undefined);
      if (eqCap !== undefined) return eqCap * 10; // crore shares assuming ₹10 face value (most common)
      return undefined;
    })(),
    numShares3y: n(m['numShares3y']?row[m['numShares3y']]:undefined),
    rptRevenuePct: n(m['rptRevenuePct']?row[m['rptRevenuePct']]:undefined),
    auditorChangesLast3y: n(m['auditorChangesLast3y']?row[m['auditorChangesLast3y']]:undefined),
    subsidiaryCount: n(m['subsidiaryCount']?row[m['subsidiaryCount']]:undefined),
    freeFloatPct: (() => {
      // PATCH 0332 — derive from promoter holding: free float = 100 - promoter - pledged
      const explicit = n(m['freeFloatPct']?row[m['freeFloatPct']]:undefined);
      if (explicit !== undefined) return explicit;
      const prom = n(m['promoter']?row[m['promoter']]:undefined);
      const plg = n(m['pledge']?row[m['pledge']]:undefined);
      if (prom !== undefined) {
        // promoter's pledged shares are also locked, but conservatively
        // subtract only the unpledged promoter % to get effective public float
        return Math.max(0, 100 - prom);
      }
      return undefined;
    })(),
    highLowRangePct: (() => {
      // PATCH 0332 — compute from High price all time / Low price all time if available.
      const explicit = n(m['highLowRangePct']?row[m['highLowRangePct']]:undefined);
      if (explicit !== undefined) return explicit;
      const hi = n(m['highPriceAllTime']?row[m['highPriceAllTime']]:undefined);
      const lo = n(m['lowPriceAllTime']?row[m['lowPriceAllTime']]:undefined);
      if (hi !== undefined && lo !== undefined && lo > 0) {
        return ((hi - lo) / lo) * 100;
      }
      return undefined;
    })(),
    promoterEntityCount: n(m['promoterEntityCount']?row[m['promoterEntityCount']]:undefined),
    // Derived
    marginOfSafety:(iv!==undefined&&price!==undefined&&price>0)?Math.round((iv-price)/price*100):undefined,
    aboveDMA200:(dma!==undefined&&price!==undefined&&dma>0)?Math.round((price-dma)/dma*100):undefined,
    aboveDMA50:(dma50raw!==undefined&&price!==undefined&&dma50raw>0)?Math.round((price-dma50raw)/dma50raw*100):undefined,  // PATCH 1060
    netDebtEbitda:(netDebt!==undefined&&ebitda!==undefined&&ebitda>0)?Math.round(netDebt/ebitda*10)/10:undefined,
    fiiPlusDii:(fii!==undefined&&dii!==undefined)?Math.round((fii+dii)*10)/10:fii!==undefined?fii:undefined,
    opLeverageRatio:(n(m['profitCagr']?row[m['profitCagr']]:undefined)!==undefined&&n(m['revCagr']?row[m['revCagr']]:undefined)!==undefined&&(n(m['revCagr']?row[m['revCagr']]:undefined) as number)>0)?(n(m['profitCagr']?row[m['profitCagr']]:undefined) as number)/(n(m['revCagr']?row[m['revCagr']]:undefined) as number):undefined,
    // ── NEW DERIVED FIELDS ────────────────────────────────────────────────────
    // Gap 5: EV/EBITDA — prefer direct Screener column ("EV / EBITDA"), fallback = computed
    evEbitda: evEbitdaDirect ??
      ((mcap!==undefined&&netDebt!==undefined&&ebitda!==undefined&&ebitda>0)?
        Math.round((mcap+netDebt)/ebitda*10)/10 : undefined),
    // Gap 5: FCF Yield — prefer direct Screener column ("FCF Yield"), fallback = computed
    // Direct value is already in %; computed: FCF(Cr)/MCap(Cr)*100
    fcfYield: fcfYieldDirect ??
      ((fcfAbs!==undefined&&mcap!==undefined&&mcap>0)?
        Math.round(fcfAbs/mcap*1000)/10 : undefined),
    // Gap 1: Incremental ROCE = current ROCE − ROCE 3 years ago (+ve = new capital productive)
    roceExpansion:(roce_cur!==undefined&&roce3yr!==undefined)?
      Math.round((roce_cur-roce3yr)*10)/10 : undefined,
    // Gap 2: OPM expansion — current vs best available historical (3yr preferred, 1yr fallback)
    // opmBase = opm3yr (custom ratio) ?? opmPrev (Screener "OPM last year")
    opmExpansion:(opm_cur!==undefined&&opmBase!==undefined)?
      Math.round((opm_cur-opmBase)*10)/10 : undefined,
    // PATCH 1024 — Screener.in exports this as a FRACTION (0.91 = 91% of high → 9% below).
    // Convert to signed-percent (-9 = "9% below 52w high") so display + gates work.
    pctFrom52wHigh: (() => {
      const raw = pctFrom52wHighDirect;
      if (typeof raw === 'number') {
        if (raw >= 0 && raw <= 1.5) return Math.round((raw - 1) * 1000) / 10;
        if (raw >= -100 && raw <= 20) return raw;
        return undefined;
      }
      if (price !== undefined && high52w !== undefined && high52w > 0) {
        const v = Math.round((price - high52w) / high52w * 100);
        return (typeof v === 'number' && v >= -100 && v <= 20) ? v : undefined;
      }
      return undefined;
    })(),
    // ── ACCELERATION SIGNALS (Framework.docx Core Signal) ────────────────────
    // Compare latest quarter YOY vs historical CAGR to detect trend direction.
    // If recent (YOY) > historical (CAGR): business is ACCELERATING — key buy signal.
    // If recent < historical: DECELERATING — key rejection filter.
    get revenueAcceleration() {
      const yoy=n(m['yoySalesGrowth']?row[m['yoySalesGrowth']]:undefined);
      const cagr=n(m['revCagr']?row[m['revCagr']]:undefined);
      if (yoy===undefined||cagr===undefined) return undefined;
      const delta = Math.round(yoy-cagr);
      // PATCH 1027: clamp extreme acceleration values (base-rate issues)
      if (Math.abs(delta) > 300) return undefined;
      return delta;
    },
    get profitAcceleration() {
      const yoy=n(m['yoyProfitGrowth']?row[m['yoyProfitGrowth']]:undefined);
      const cagr=n(m['profitCagr']?row[m['profitCagr']]:undefined);
      if (yoy===undefined||cagr===undefined) return undefined;
      const delta = Math.round(yoy-cagr);
      // PATCH 1027: clamp extreme acceleration (low-base distortion)
      if (Math.abs(delta) > 500) return undefined;
      return delta;
    },
    get recentOpLev() {
      const yoyP=n(m['yoyProfitGrowth']?row[m['yoyProfitGrowth']]:undefined);
      const yoyS=n(m['yoySalesGrowth']?row[m['yoySalesGrowth']]:undefined);
      return (yoyP!==undefined&&yoyS!==undefined&&yoyS>0)?Math.round(yoyP/yoyS*10)/10:undefined;
    },
    get accelSignal(): 'ACCELERATING'|'STABLE'|'DECELERATING'|undefined {
      const yoy=n(m['yoySalesGrowth']?row[m['yoySalesGrowth']]:undefined);
      const cagr=n(m['revCagr']?row[m['revCagr']]:undefined);
      if(yoy===undefined||cagr===undefined) return undefined;
      const delta=yoy-cagr;
      if(delta>=5) return 'ACCELERATING';
      if(delta<=-5) return 'DECELERATING';
      return 'STABLE';
    },
    // PATCH 0055: framework extension getters — computed from data already collected
    get dilution(): DilutionAnalysis {
      return analyzeDilution({
        profitCagr: n(m['profitCagr']?row[m['profitCagr']]:undefined),
        epsGrowth:  n(m['epsGrowth']?row[m['epsGrowth']]:undefined),
      });
    },
    get reinvestment(): ReinvestmentEngine {
      const d = analyzeDilution({
        profitCagr: n(m['profitCagr']?row[m['profitCagr']]:undefined),
        epsGrowth:  n(m['epsGrowth']?row[m['epsGrowth']]:undefined),
      });
      const roce_cur=n(m['roce']?row[m['roce']]:undefined);
      const roce3yr_v=n(m['roce3yr']?row[m['roce3yr']]:undefined);
      const expansion = (roce_cur!==undefined && roce3yr_v!==undefined)
        ? Math.round((roce_cur-roce3yr_v)*10)/10 : undefined;
      return computeReinvestmentEngine({
        roceExpansion: expansion,
        profitCagr: n(m['profitCagr']?row[m['profitCagr']]:undefined),
        dilutionDragPp: d.drag_pp,
      });
    },
    // PATCH 1025: populate Framework Boundary panel
    missing_dimensions: buildMissingDimensions({
      hasGpm: n(m['gpm']?row[m['gpm']]:undefined) !== undefined,
      hasRoic: n(m['roic']?row[m['roic']]:undefined) !== undefined,
      hasGpm5yTrend: opm5y !== undefined,
      hasFcfTrend: false,
      hasFounderTenure: false,
      hasCustomerConcentration: false,
    }),
    get framework_coverage(): FrameworkCoverage {
      // Build a flat object of present field values for the coverage check
      const flat: Record<string, unknown> = {};
      for (const k of ['roce','opm','cfoToPat','fcfAbsolute','gpm','roic',
                       'revCagr','profitCagr','epsGrowth','yoySalesGrowth',
                       'roce3yr','opm3yr','de','netDebt','ebitda','icr',
                       'promoter','pledge','fii','dii','changeInPromoter',
                       'pe','peg','high52w','marketCapCr']) {
        const col = m[k];
        flat[k] = col ? row[col] : undefined;
      }
      return computeFrameworkCoverage(flat);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXCEL COMPARE TAB — institutional scale UI
// ═══════════════════════════════════════════════════════════════════════════════
