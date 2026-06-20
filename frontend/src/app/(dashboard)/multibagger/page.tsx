'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
// PATCH 0055: Multibagger framework extensions — dilution / reinvestment /
// coverage / historical reference panel.
// PATCH 0058: also archetype matcher
// PATCH 0066: ROIC vs WACC + missing-dimensions
import {
  analyzeDilution, computeReinvestmentEngine, computeFrameworkCoverage,
  computeArchetypeMatch, analyzeRoicVsWacc, buildMissingDimensions,
  HISTORICAL_MULTIBAGGERS, type DilutionAnalysis, type ReinvestmentEngine,
  type FrameworkCoverage, type ArchetypeMatch,
  type RoicWaccSpread, type MissingDimension,
} from '@/lib/multibagger/framework-extensions';
// PATCH 0272 — Conviction Beats overlay on Multibagger results.
import { getConvictionTickers } from '@/lib/conviction-beats';
import { getPortfolioMap } from '@/lib/portfolio-overlay';
import { getDecision, setDecision, clearDecision, subscribeDecisions, readDecisions, DECISION_META, type DecisionStatus } from '@/lib/decisions';
// PATCH 0367 — Export toolbar (TradingView + Screener.in) reused from earnings Scan
import TickerExportToolbar from '@/components/TickerExportToolbar';
// PATCH 0370 — Turnaround scoring engine
import { scoreTurnaroundRow, parseTurnaroundRow, type TurnaroundResult, type TurnaroundStage, type TurnaroundArchetype } from '@/lib/turnaround';
// VALUATION-B — inline fair-value strip from 10 institutional valuation models
import { ValuationStrip } from '@/components/valuation/ValuationStrip';
// PATCH 0578 — Operating Leverage Cluster framework (§17.4(C))
import { computeClusterScore, isClusterSeed, CLUSTER_TIER_META, type ClusterResult } from '@/lib/op-leverage-cluster';
// PATCH 0614 — MNC_ALLOWLIST extracted to lib/multibagger-allowlists.ts as
// first step toward modularising the 9K-line scorer.
import { MNC_ALLOWLIST_IN } from '@/lib/multibagger-allowlists';
// PATCH 0755 — Pure CSV utilities extracted to a sibling lib so the page
// file shrinks further (was 7,140 lines after P0728). No behavior change.
import { parseCsvFlexible, detectCsvMarket } from '@/lib/multibagger-csv-parsers';
// PATCH 1101qqq — auto-sync loader. Fetches CSVs committed by the daily
// GitHub Action and feeds them into the existing handleFiles() pipeline,
// so no separate code path is needed.
import {
  SYNC_ROUTING, getSyncStatus, fetchCsvsAsFiles,
  shouldAutoLoad, markAutoLoaded, resetAutoLoadFlag, type SyncStatus,
} from '@/lib/screener-data-loader';

// Shared API base — respects NEXT_PUBLIC_API_URL env var so all fetch() calls
// resolve consistently when the base URL changes (fixes #13: mixed /api/v1 vs /api)
const API_BASE = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) || '/api/v1';

// ── Design tokens — institutional scale ───────────────────────────────────────
const BG      = '#0a0a0f';
const CARD_BG = '#13131a';
const CARD2   = '#191926';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#e2e8f0';
const MUTED   = '#64748b';
const PURPLE  = '#a78bfa';
const ACCENT  = '#38bdf8';
const GREEN   = '#10b981';
const RED     = '#ef4444';
const ORANGE  = '#f97316';
const YELLOW  = '#f59e0b';

// Font scale — institutional / terminal grade
const F = { xs:11, sm:13, md:15, lg:17, xl:20, h1:24, h2:20, h3:17 };

// PATCH 0728 — Scoring engines extracted to lib/multibagger-india-scoring.ts
// and lib/multibagger-usa-scoring.ts. All India types (ExcelRow/ExcelResult/
// Grade/Bucket/...), constants (SBENCH/OWNERSHIP_CONFIG/BUCKET_CONFIG/
// GRADE_COLOR/CHECKLIST), helpers (getSectorKey/sv/isCyclicalSector/
// getSectorTailwind/classifyOwnership/computeKillSwitch), and the main
// scorer (scoreExcelRow + applyForcedRanking) live in the India lib.
// USARow/USAGrade/USAResult, USA_BENCH, getUSABench/svUS/usaSerialDate,
// scoreUSARow + applyUSARanking live in the USA lib. Re-export here so
// page.tsx call sites are unchanged. Behavior identical to pre-0728.
import {
  GRADE_COLOR, CHECKLIST, OWNERSHIP_CONFIG, BUCKET_CONFIG, SBENCH,
  getSectorKey, applyForcedRanking, scoreExcelRow,
} from '@/lib/multibagger-india-scoring';
import type {
  Grade, NewsArticle, ExcelRow, OwnershipCategory,
  Bucket, ExcelResult,
} from '@/lib/multibagger-india-scoring';
import {
  usaSerialDate, scoreUSARow, applyUSARanking,
} from '@/lib/multibagger-usa-scoring';
import type { USARow, USAGrade, USAResult } from '@/lib/multibagger-usa-scoring';



// ═══════════════════════════════════════════════════════════════════════════════
// COLUMN DETECTION — Screener.in + extra custom fields
// ═══════════════════════════════════════════════════════════════════════════════

function buildColMap(sampleRow: Record<string,unknown>): Record<string,string> {
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

function rawRowToExcelRow(row: Record<string,unknown>, m: Record<string,string>): ExcelRow|null {
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

function ExcelCompare({ rows, setRows }: { rows: ExcelResult[]; setRows:(r:ExcelResult[])=>void }) {
  const [fileName, setFileName] = useState(() => {
    // Restore last session's file label from meta
    try {
      const meta = JSON.parse(localStorage.getItem(STORAGE_META) || '{}');
      if (meta.count && meta.savedAt) {
        const d = new Date(meta.savedAt);
        return `${meta.count} stocks · saved ${d.toLocaleString()}`;
      }
    } catch {}
    return '';
  });
  const [parseError, setParseError] = useState('');
  const [loading, setLoading] = useState(false);
  // PATCH 1083 — orphan-meta detection. If STORAGE_META shows count > 0 but
  // localStorage[STORAGE_KEY] is empty (quota wiped after 5MB cap or app version
  // change), show a red banner so user knows to re-upload. Auto-clears stale
  // meta after dismissal so it doesn't keep firing.
  const [orphanMetaCount, setOrphanMetaCount] = useState<number>(0);
  // PATCH 1084 — sync fileName when the parent clears all data via the
  // mb-upload:updated event. Previously fileName stayed showing "1 file · N
  // stocks" even after Clear because the state lives in this child component.
  useEffect(() => {
    function onUploadEvent(e: Event) {
      const ce = e as CustomEvent<{ cleared?: boolean }>;
      if (ce.detail && ce.detail.cleared) {
        setFileName('');
        setOrphanMetaCount(0);
        setParseError('');
      }
    }
    window.addEventListener('mb-upload:updated', onUploadEvent);
    return () => window.removeEventListener('mb-upload:updated', onUploadEvent);
  }, []);
  // PATCH 1099 — REAL persistence fix. Previous PATCH 1083/1084/1090 patched
  // symptoms; this addresses three structural bugs that kept producing the
  // "Saved data lost (N stocks)" banner even after a successful upload:
  //
  //   (1) META was written in the same call as data, but localStorage data
  //       writes can silently fail (5MB quota) while META always succeeds.
  //       Result: META=345 + data=empty is possible. Fix is in setExcelRows
  //       (in MultibaggerPage below): write IDB first, only write META after
  //       IDB confirms.
  //
  //   (2) This effect ran ONCE on mount and raced the parent's async IDB
  //       hydration. If the child's check resolved first, the banner fired
  //       even when IDB had data the parent would soon load. Fix: rerun on
  //       rows.length change, wait 1.2s for parent hydration to settle, and
  //       always clear the banner the instant rows is populated.
  //
  //   (3) The displayed "✅ N stocks · saved …" came from META alone, so the
  //       success message and warning banner could appear simultaneously —
  //       exactly the user-reported confusion. fileName is now resynced on
  //       rows hydration (see effect below).
  useEffect(() => {
    if (rows.length > 0) {
      setOrphanMetaCount(0);
      return;
    }
    let alive = true;
    const tid = window.setTimeout(async () => {
      if (!alive) return;
      try {
        const metaRaw = localStorage.getItem(STORAGE_META);
        if (!metaRaw) { setOrphanMetaCount(0); return; }
        const meta = JSON.parse(metaRaw);
        if (!meta || !meta.count || meta.count === 0) { setOrphanMetaCount(0); return; }
        const dataRaw = localStorage.getItem(STORAGE_KEY);
        if (dataRaw && dataRaw !== '[]') return; // parent's sync init will restore
        const idbRaw = await mbIdbGet('mb_scored');
        if (!alive) return;
        if (idbRaw && idbRaw !== '[]') {
          try {
            const parsed = JSON.parse(idbRaw) as ExcelResult[];
            if (Array.isArray(parsed) && parsed.length > 0) {
              setRows(applyForcedRanking(parsed));
              return;
            }
          } catch {}
        }
        setOrphanMetaCount(meta.count);
      } catch {}
    }, 1200);
    return () => { alive = false; clearTimeout(tid); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  // PATCH 1099 — keep the file-label honest. Once rows hydrate from any source
  // (localStorage init or parent's IDB rehydrate), refresh fileName from META
  // so the timestamp matches what the user is actually looking at.
  useEffect(() => {
    if (rows.length > 0) {
      try {
        const meta = JSON.parse(localStorage.getItem(STORAGE_META) || '{}');
        if (meta.count && meta.savedAt) {
          const d = new Date(meta.savedAt);
          setFileName(`${meta.count} stocks · saved ${d.toLocaleString()}`);
        }
      } catch {}
    }
  }, [rows.length]);
  const [expRow, setExpRow] = useState<string|null>(null);
  const [expandAll, setExpandAll] = useState(false);
  const [gradeFilter, setGradeFilter] = useState<Set<string>>(new Set(['ALL']));
  const [goodOnly, setGoodOnly] = useState(false);
  const [bucketFilter, setBucketFilter] = useState<Bucket|'ALL'>('ALL');
  // PATCH 0127 — sector dropdown so the analyst can rank within a single
  // industry (e.g. compare HBLENGINE only against Defence peers, not all 84).
  const [sectorFilter, setSectorFilter] = useState<string>('ALL');
  const [accelOnly, setAccelOnly] = useState(false);
  const [fcfOnly, setFcfOnly] = useState(false);
  const [discoveryOnly, setDiscoveryOnly] = useState(false);
  // PATCH 1052 — "Above 50 & 200 DMA" combined-uptrend filter. Most CSV exports
  // only carry 200 DMA, so when 50 DMA isn't available we fall back to a proxy:
  // price > 200 DMA AND 1-month return > -3% (positive short-term momentum
  // implies the price is also above the 50 DMA on most reasonable distributions).
  // User-requested preset for stacking on top of the Good filter.
  const [dmaConfirmedOnly, setDmaConfirmedOnly] = useState(false);
  // PATCH 1046 — fraud risk filter (lets user verify the fraud detection by isolating flagged stocks)
  const [fraudFilter, setFraudFilter] = useState<'ALL'|'CLEAN'|'CRITICAL'|'HIGH'|'ANY'>('ALL');
  const [inflectionOnly, setInflectionOnly] = useState(false);
  // P/E and PEG range filters — 'ALL' means no filter
  const [peMax, setPeMax] = useState<'ALL'|15|25|40|60|100>('ALL');
  const [pegMax, setPegMax] = useState<'ALL'|0.8|1.0|1.5|2.0>('ALL');
  // PATCH 0345 — India institutional-quality composite filters (analogs of USA R40/Piotroski/GPM):
  // "Quality of 50": ROCE + Profit CAGR ≥ threshold — India equivalent of Rule of 40.
  // Captures both moat (ROCE) and growth in one metric.
  const [indQualityMin, setIndQualityMin] = useState<'ALL'|50|75|100>('ALL');
  // ROCE filter standalone — moat signature (>25% = elite, >20% = strong)
  const [indRoceMin, setIndRoceMin] = useState<'ALL'|20|25|30>('ALL');
  // Cash conversion — CFO/PAT ≥ 1.0 = earnings fully cash-backed (≥0.8 = clean, ≥1.0 = elite)
  const [indCfoMin, setIndCfoMin] = useState<'ALL'|0.8|1.0>('ALL');
  // PATCH 0347 — Decision filter (filter India rows by user's logbook status)
  const [indDecisionFilter, setIndDecisionFilter] = useState<'ALL'|'WITH'|'NONE'|DecisionStatus>('ALL');
  // PATCH 0347 — Bump to force re-render when decisions change (cross-tab/edit sync)
  const [decisionsVersion, setDecisionsVersion] = useState(0);
  const bumpDecisions = useCallback(() => setDecisionsVersion(v => v + 1), []);
  useEffect(() => subscribeDecisions(() => bumpDecisions()), [bumpDecisions]);
  // PATCH 1101zzz3 / AUDIT H6 — cache the decision map once per decisionsVersion
  // bump so filter chains and chip counts don't hit localStorage 2000+ times
  // per render. getDecision(symbol) internally calls readDecisions() →
  // localStorage.getItem + JSON.parse, which the audit flagged as the actual
  // 200ms-per-filter-toggle bottleneck. Replacing each call with an O(1)
  // object lookup keeps reactivity (re-reads on decisionsVersion change) and
  // avoids the risky full-filter-chain useMemo refactor.
  const decisionsCache = React.useMemo(() => {
    try { return readDecisions(); } catch { return {} as Record<string, any>; }
  }, [decisionsVersion]);
  const lookupDecision = useCallback((symbol: string | undefined) => {
    if (!symbol) return undefined;
    return decisionsCache[symbol.toUpperCase()] || decisionsCache[symbol];
  }, [decisionsCache]);
  // Guidance tier filter — only applies when guidanceMode is ON
  type GuidanceTier = 'ALL'|'STRONG'|'POS'|'NEUTRAL'|'NEG'|'WEAK';
  const [guidanceTier, setGuidanceTier] = useState<GuidanceTier>('ALL');

  // ── GUIDANCE MODE ──────────────────────────────────────────────────────────
  // When ON: fetches recent earnings/guidance news, scores each company
  // by guidance quality (0.0-1.0), re-scores and re-sorts.
  // When OFF: no change to existing scores.
  const [guidanceMode, setGuidanceMode] = useState(false);
  const [guidanceLoading, setGuidanceLoading] = useState(false);
  const [guidanceScores, setGuidanceScores] = useState<Record<string, number>>({}); // symbol → 0.0-1.0
  const [guidanceArticleCounts, setGuidanceArticleCounts] = useState<Record<string, number>>({});
  // PATCH 1050 — Haiku AI guidance overlay (separate from news-keyword guidance above)
  // Cache key: mc:multibagger:ai-guidance:v1 — 100-day TTL per ticker
  // PATCH 1052 — Extended entry stores rich content: rationale (full), quotes,
  // numbers (metric/value/period rows), catalysts (event/timing rows), sourceUrl.
  type GuidanceQuote = { quote: string; speaker?: string };
  type GuidanceNumber = { metric?: string; value?: string; period?: string };
  type GuidanceCatalyst = { event?: string; timing?: string };
  type AiGuidanceEntry = {
    score: number;
    tier: 'EXCELLENT'|'POSITIVE'|'NEUTRAL'|'CAUTIOUS'|'NEGATIVE'|'NOGUIDANCE';
    summary: string;          // short rationale (300 char) used in hover
    rationale?: string;       // full rationale (kept for the rich expand panel)
    quotes?: GuidanceQuote[];
    numbers?: GuidanceNumber[];
    catalysts?: GuidanceCatalyst[];
    sourceUrl?: string;
    period: string;
    fetchedAt: number;
  };
  const [aiGuidanceMap, setAiGuidanceMap] = useState<Record<string, AiGuidanceEntry>>({});
  const [aiGuidanceLoading, setAiGuidanceLoading] = useState(false);
  const [aiGuidanceProgress, setAiGuidanceProgress] = useState({done:0, total:0, failed:0, configMissing:false});
  const [aiTierFilter, setAiTierFilter] = useState<'ALL'|'EXCELLENT'|'POSITIVE'|'NEUTRAL'|'CAUTIOUS'|'NEGATIVE'|'NOGUIDANCE'>('ALL');
  // Load cached guidance on mount
  React.useEffect(() => {
    try { const raw = localStorage.getItem('mc:multibagger:ai-guidance:v1'); if (raw) setAiGuidanceMap(JSON.parse(raw)); } catch {}
  }, []);
  // Persist cache on change
  React.useEffect(() => {
    try { localStorage.setItem('mc:multibagger:ai-guidance:v1', JSON.stringify(aiGuidanceMap)); } catch {}
  }, [aiGuidanceMap]);

  // Soft fetch: only fetch tickers with no cache OR cache > 100 days old. Hard refresh: bypass cache, re-fetch all.
  async function fetchAIGuidance(hardRefresh: boolean) {
    const STALE_MS = 100 * 86_400_000; // 100 days
    const now = Date.now();
    // Resolve current quarter (FY-Indian: Apr-Mar)
    const d = new Date(); const m = d.getMonth(); const y = d.getFullYear();
    const fy = m >= 3 ? y + 1 : y;
    const q = m >= 3 && m <= 5 ? 'Q4' : m >= 6 && m <= 8 ? 'Q1' : m >= 9 && m <= 11 ? 'Q2' : 'Q3';
    const PERIOD = `${q}-FY${String(fy).slice(-2)}`;
    // Only the GOOD-filtered subset (existing goodCompanies var, score >= 60)
    const targets = (typeof goodCompanies !== 'undefined' ? goodCompanies : rows.filter((r: any) => r.score >= 60))
      .map((r: any) => String(r.symbol || '').toUpperCase()).filter(Boolean);
    const needsFetch = hardRefresh ? targets : targets.filter(t => {
      const e = aiGuidanceMap[t]; return !e || (now - (e.fetchedAt || 0)) > STALE_MS;
    });
    if (needsFetch.length === 0) { alert('All Good-filter stocks already have fresh AI Guidance cached (< 100 days). Use Hard Refresh if needed.'); return; }
    if (hardRefresh && !confirm(`Hard Refresh will re-fetch AI Guidance for ${targets.length} stocks (cost ~$${(targets.length * 0.0014).toFixed(2)} of Anthropic credits). Continue?`)) return;
    setAiGuidanceLoading(true);
    setAiGuidanceProgress({done: 0, total: needsFetch.length, failed: 0, configMissing: false});
    const CHUNK = 5;
    const newMap: Record<string, AiGuidanceEntry> = { ...aiGuidanceMap };
    let done = 0, failed = 0, configMissing = false;
    for (let i = 0; i < needsFetch.length; i += CHUNK) {
      const chunk = needsFetch.slice(i, i + CHUNK).map(t => ({ ticker: t, period: PERIOD }));
      try {
        const r = await fetch('/api/v1/haiku/forward-guidance', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items: chunk, force: hardRefresh }),
          signal: AbortSignal.timeout(55_000),
        });
        if (r.status === 503) {
          const body = await r.json().catch(() => ({}));
          if (typeof body?.error === 'string' && /ANTHROPIC_API_KEY/i.test(body.error)) {
            configMissing = true; failed += chunk.length; done += chunk.length; setAiGuidanceProgress({done, total: needsFetch.length, failed, configMissing});
            break;
          }
          failed += chunk.length; done += chunk.length;
        } else if (!r.ok) {
          failed += chunk.length; done += chunk.length;
        } else {
          const json = await r.json();
          // PATCH — API returns {results: {TICKER: {label, score, rationale, ...}}} (object map, not array)
          const resultsMap: Record<string, any> = (json && typeof json === 'object' && json.results && typeof json.results === 'object') ? json.results : {};
          Object.entries(resultsMap).forEach(([sym, data]) => {
            if (!data || typeof data !== 'object') return;
            const d: any = data;
            const upperSym = sym.toUpperCase();
            const score = typeof d.score === 'number' ? d.score : 0;
            const label = (d.label || '').toString().toUpperCase();
            let tier: AiGuidanceEntry['tier'] = 'NOGUIDANCE';
            if (label.includes('EXCELLENT') || score >= 0.7) tier = 'EXCELLENT';
            else if (label.includes('POSITIVE') || score >= 0.25) tier = 'POSITIVE';
            else if (label.includes('CAUTIOUS') || score <= -0.25) tier = 'CAUTIOUS';
            else if (label.includes('NEGATIVE') || score <= -0.7) tier = 'NEGATIVE';
            else if (typeof d.score === 'number') tier = 'NEUTRAL';
            // PATCH 1052 — keep the rich Anthropic-response fields so the row
            // expansion can show rationale + quotes + numbers + catalysts.
            const rationale = (d.rationale || d.label || '').toString();
            const quotes: GuidanceQuote[] = Array.isArray(d.quotes)
              ? d.quotes.slice(0, 6).map((q: any) => typeof q === 'string'
                  ? { quote: q.slice(0, 280) }
                  : { quote: String(q?.quote || q?.text || '').slice(0, 280), speaker: q?.speaker ? String(q.speaker).slice(0, 60) : undefined })
                .filter((q: any) => q.quote)
              : [];
            const numbers: GuidanceNumber[] = Array.isArray(d.numbers)
              ? d.numbers.slice(0, 8).map((n: any) => typeof n === 'string'
                  ? { value: n.slice(0, 100) }
                  : { metric: n?.metric ? String(n.metric).slice(0, 60) : undefined, value: n?.value !== undefined ? String(n.value).slice(0, 60) : undefined, period: n?.period ? String(n.period).slice(0, 30) : undefined })
                .filter((n: any) => n.metric || n.value)
              : [];
            const catalysts: GuidanceCatalyst[] = Array.isArray(d.catalysts)
              ? d.catalysts.slice(0, 6).map((c: any) => typeof c === 'string'
                  ? { event: c.slice(0, 140) }
                  : { event: c?.event ? String(c.event).slice(0, 140) : undefined, timing: c?.timing ? String(c.timing).slice(0, 40) : undefined })
                .filter((c: any) => c.event)
              : [];
            const sourceUrl = (typeof d.source_url === 'string' && d.source_url.startsWith('http')) ? d.source_url : undefined;
            newMap[upperSym] = { score, tier, summary: rationale.slice(0, 300), rationale: rationale.slice(0, 2000), quotes, numbers, catalysts, sourceUrl, period: PERIOD, fetchedAt: Date.now() };
          });
          done += chunk.length;
        }
      } catch { failed += chunk.length; done += chunk.length; }
      setAiGuidanceProgress({done, total: needsFetch.length, failed, configMissing});
      setAiGuidanceMap({ ...newMap });
    }
    setAiGuidanceLoading(false);
  }


  // PATCH 0272 — Conviction Beats overlay. Subscribes to the institutional
  // bench so we can mark rows that have already passed the BLOCKBUSTER /
  // STRONG earnings filter on /earnings-opportunities. Cross-tab sync via
  // the storage event + the 'conviction-beats:updated' custom event.
  const [convictionSet, setConvictionSet] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set(Array.from(getConvictionTickers()).map((t: string) => t.toUpperCase())); }
    catch { return new Set(); }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      try { setConvictionSet(new Set(Array.from(getConvictionTickers()).map((t: string) => t.toUpperCase()))); }
      catch {}
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('conviction-beats:updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('conviction-beats:updated', refresh);
    };
  }, []);
  // AUDIT_100 #52 — portfolio attribution overlay. When a row is also a
  // holding, render OWN N%/Δ+M% next to the ticker. Cross-tab sync via
  // storage event.
  const [portfolioMap, setPortfolioMap] = useState<Map<string, any>>(() => {
    if (typeof window === 'undefined') return new Map();
    try { return getPortfolioMap(); } catch { return new Map(); }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => { try { setPortfolioMap(getPortfolioMap()); } catch {} };
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('storage', refresh); };
  }, []);
  // Conviction-only filter chip in the toolbar.
  const [convictionOnly, setConvictionOnly] = useState(false);

  const GUIDANCE_POSITIVE = ['raised guidance','guidance upgrade','raised outlook','beats estimates','above estimates','record quarter','record revenue','strong beat','raised earnings','margin expansion','strong growth','upgraded','rerating','guidance raised'];
  const GUIDANCE_NEGATIVE = ['cut guidance','lowered guidance','below estimates','disappointing','warning','cautious','revenue miss','profit miss','guidance cut','margin pressure','revised down','lowered outlook'];

  async function fetchGuidanceScores() {
    if (rows.length === 0) return;
    setGuidanceLoading(true);
    try {
      // For Indian small-caps, earnings coverage in news is sparse.
      // Strategy: fetch ALL recent articles broadly (not type-filtered),
      // try multiple matching approaches, then fall back to trajectory proxy.
      const fetches = await Promise.all([
        fetch(`${API_BASE}/news?limit=500&importance_min=1&article_type=EARNINGS`),
        fetch(`${API_BASE}/news?limit=300&importance_min=1&article_type=CORPORATE`),
        fetch(`${API_BASE}/news?limit=200&importance_min=1&article_type=RATING_CHANGE`),
        fetch(`${API_BASE}/news?limit=200&importance_min=2&article_type=GENERAL`),
        fetch(`${API_BASE}/news?limit=100&importance_min=2&article_type=BOTTLENECK`),
      ]);
      const datas = await Promise.all(fetches.map(r => r.ok ? r.json().catch(()=>[]) : Promise.resolve([])));
      const all = (datas.flat() as NewsArticle[]);
      // Deduplicate by id
      const seen = new Set<string>();
      const articles = all.filter(a => {
        const id = a.id ?? (a.title ?? '') + (a.published_at ?? '');
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      const scores: Record<string, number> = {};
      const counts: Record<string, number> = {};

      // Pre-process articles for fast matching
      const articleTexts = articles.map(a => ({
        a,
        full: ((a.title ?? '') + ' ' + (a.headline ?? '') + ' ' + (a.summary ?? '')).toLowerCase(),
        tickers: ((a.ticker_symbols ?? []) as string[]).map((t: string) =>
          t.toUpperCase().replace(/\.NS$|\.BO$|^NSE:|^BSE:/i, '')
        ),
      }));

      for (const stock of rows) {
        const sym = stock.symbol.toUpperCase().replace(/\.NS$|\.BO$/i, '');

        // Build company name search tokens — multiple strategies for Indian names
        const companyRaw = (stock.company || '').toLowerCase();
        // Remove noise words
        const cleanCompany = companyRaw
          .replace(/\b(ltd|limited|pvt|private|india|industries|solutions|tech|technologies|systems|services|enterprises|group|engineering|energy|power|chemicals|pharma|pharmaceuticals|finance|capital|holdings|infra|infrastructure)\b/gi, '')
          .replace(/[()]/g, '').trim();
        const companyWords = cleanCompany.split(/\s+/).filter(w => w.length >= 4).slice(0, 2);
        // Also try: first 6 chars of symbol as a text match (e.g. "SKIPPER" in article)
        const symShort = sym.toLowerCase().slice(0, 6);

        // Match strategies (OR logic - any match counts)
        const relevant = articleTexts.filter(({ full, tickers }) => {
          // 1. Ticker match (exact, stripping exchange suffixes)
          if (tickers.some(t => t === sym || t.includes(sym.slice(0,6)))) return true;
          // 2. Symbol text appears in article (e.g. "SKIPPER reported...")
          if (full.includes(sym.toLowerCase()) || (symShort.length >= 4 && full.includes(symShort))) return true;
          // 3. Company name keywords (ALL significant words must appear)
          if (companyWords.length >= 2 && companyWords.every(w => full.includes(w))) return true;
          if (companyWords.length === 1 && companyWords[0].length >= 6 && full.includes(companyWords[0])) return true;
          return false;
        }).map(({ a }) => a);

        counts[sym] = relevant.length;

        if (relevant.length > 0) {
          // Score from actual news articles
          let score = 0.5;
          for (const a of relevant.slice(0, 8)) {
            const text = ((a.title ?? '') + ' ' + (a.headline ?? '') + ' ' + (a.summary ?? '')).toLowerCase();
            const isPositive = GUIDANCE_POSITIVE.some(kw => text.includes(kw));
            const isNegative = GUIDANCE_NEGATIVE.some(kw => text.includes(kw));
            if (isPositive && !isNegative)      score = Math.min(1.0, score + 0.15);
            else if (isNegative && !isPositive) score = Math.max(0.0, score - 0.15);
            else if (isPositive && isNegative)  score = Math.min(0.75, score + 0.04);
          }
          scores[sym] = Math.round(score * 10) / 10;
        } else {
          // NO NEWS FOUND — use earnings trajectory as proxy for ALL stocks.
          // For Indian small-caps there is often zero press coverage; the trajectory
          // from quarterly numbers IS the forward signal. Score capped at 0.65.
          // Key fix: STABLE = 0.50 (neutral, not "no data"). ACCELERATING = ≥0.55
          // even when delta is small, because accelSignal itself is meaningful.
          const revAccel  = stock.revenueAcceleration;
          const profAccel = stock.profitAcceleration;
          const trajectory = (revAccel ?? 0) + (profAccel ?? 0);
          const accel = stock.accelSignal;
          const hasMetrics = revAccel !== undefined || profAccel !== undefined ||
                             stock.revCagr !== undefined || stock.profitCagr !== undefined;

          if (accel === 'ACCELERATING') {
            // ACCELERATING signal is meaningful by itself — trajectory shows magnitude
            if (trajectory > 60)      scores[sym] = 0.65;
            else if (trajectory > 30) scores[sym] = 0.60;
            else if (trajectory > 10) scores[sym] = 0.57;
            else                      scores[sym] = 0.55; // low-delta ACCELERATING still positive
          } else if (accel === 'STABLE') {
            // STABLE = performing as expected, no upgrade/downgrade signal
            // Show 0.50 (neutral) NOT -1 — "no surprise" IS information
            scores[sym] = 0.50;
          } else if (accel === 'DECELERATING') {
            if (trajectory < -40)      scores[sym] = 0.25;
            else if (trajectory < -20) scores[sym] = 0.35;
            else                       scores[sym] = 0.40;
          } else if (hasMetrics) {
            // accelSignal undefined (e.g. missing YOY data) but some metrics exist
            scores[sym] = 0.50; // neutral default
          } else {
            scores[sym] = -1;   // truly no information at all
          }
          counts[sym] = 0; // mark as proxy (no actual articles)
        }
      }

      setGuidanceScores(scores);
      setGuidanceArticleCounts(counts);
    } catch (e) {
      console.error('Guidance fetch failed:', e);
    }
    setGuidanceLoading(false);
  }

  function guidanceBonus(sym: string): number {
    const g = guidanceScores[sym];
    if (g === undefined || g === -1) return 0; // no data = no adjustment
    if (g >= 0.85) return 14;  // multiple raises / strong guidance upgrade
    if (g >= 0.70) return 8;   // single raise or beat
    if (g >= 0.55) return 3;   // mildly positive
    if (g <= 0.15) return -14; // multiple cuts or misses
    if (g <= 0.30) return -8;  // guidance cut or miss
    if (g <= 0.45) return -3;  // mildly negative
    return 0; // neutral (0.5)
  }

  function applyGuidance(r: ExcelResult): ExcelResult & { guidanceScore?: number; guidanceAdj?: number } {
    if (!guidanceMode || Object.keys(guidanceScores).length === 0) return r;
    const gs = guidanceScores[r.symbol];
    // -1 = no data found, don't adjust score
    if (gs === -1) return { ...r, guidanceScore: -1, guidanceAdj: 0 };
    const adj = guidanceBonus(r.symbol);
    let newScore = Math.max(0, Math.min(100, r.score + adj));

    // Re-apply quality and valuation caps — guidance cannot bypass these hard limits.
    // A company with poor cash flow or overvalued vs intrinsic value should not
    // jump past its quality-capped ceiling even with great earnings news.
    const b2 = SBENCH[getSectorKey(r.sector)] ?? SBENCH.DEFAULT;
    const hasQualWeakness = (r.cfoToPat !== undefined && r.cfoToPat < 0.6) ||
                            (r.opm !== undefined && r.opm < b2.opm[0]) ||
                            (r.roce !== undefined && r.roce < 15);
    if (hasQualWeakness)                              newScore = Math.min(newScore, 85);
    if ((r.cfoToPat ?? 1) < 0.5)                     newScore = Math.min(newScore, 80);
    if ((r.marginOfSafety ?? 0) < -50)               newScore = Math.min(newScore, 80);
    else if ((r.marginOfSafety ?? 0) < -30)          newScore = Math.min(newScore, 90);

    // PATCH 0336 — Re-apply red-flag structural/cyclical caps after guidance.
    // Without this, a +3 guidance bonus could push a "1 HIGH structural · cap 60"
    // stock to 63, contradicting the audit-panel claim that the cap was binding.
    // Visible symptom (post-0335 deployment): Tips Music score=63 with audit
    // "Active cap: 60 (binding)"; Skipper score=51 with audit "Active cap: 48
    // (binding)". The audit count is correct; the score evaluation also caps
    // correctly inside computeOne(), but applyGuidance() runs afterward and
    // bypasses the structural/cyclical caps. Re-apply them here.
    const critG = r.redFlags.some(f => f.severity === 'CRITICAL');
    const structHighG = r.redFlags.filter(f => f.severity === 'HIGH' && (f.kind ?? 'STRUCTURAL') === 'STRUCTURAL').length;
    const cycHighG    = r.redFlags.filter(f => f.severity === 'HIGH' && f.kind === 'CYCLICAL').length;
    if (critG)                       newScore = Math.min(newScore, 38);
    else if (structHighG >= 2)       newScore = Math.min(newScore, 48);
    else if (structHighG >= 1)       newScore = Math.min(newScore, 60);
    else if (cycHighG >= 2)          newScore = Math.min(newScore, 62);
    else if (cycHighG >= 1)          newScore = Math.min(newScore, 72);
    // Re-apply governance watch cap (Patch 0313)
    if ((r as any).governanceWatch)  newScore = Math.min(newScore, 65);
    // Re-apply decelerating + monitor bucket caps
    if (r.accelSignal === 'DECELERATING') newScore = Math.min(newScore, 52);
    if (r.bucket === 'MONITOR')           newScore = Math.min(newScore, 45);

    // PATCH 0337 — Mirror the new op-lev <1.0 and cyclical-peak caps so
    // guidance bonus can't slip an A-grade past them.
    if (r.recentOpLev !== undefined && r.recentOpLev < 1.0
        && (r.yoySalesGrowth ?? 0) > 15) {
      newScore = Math.min(newScore, 75);
    }
    const b2cyc = (r.sector || '').match(/METAL|CHEMICAL|TEXTILE|OIL|SHIPPING|CEMENT|TIRE|RUBBER|PAPER/i) !== null;
    if (b2cyc && r.opm !== undefined && (b2.opm?.[2] ?? 0) > 0
        && r.opm > b2.opm[2] * 1.5
        && (r.profitCagr ?? 0) > 40
        && !(r as any).isCyclicRecovery) {
      newScore = Math.min(newScore, 80);
    }

    // Re-apply A+ gate — guidance articles cannot grant A+ if quality gates fail
    if (newScore >= 90) {
      const passGate = (r.cfoToPat ?? 0) > 1.0 && (r.roce ?? 0) > 20 &&
                       (r.fcfAbsolute ?? -1) > 0 && (r.promoter ?? 0) > 50;
      if (!passGate) newScore = Math.min(newScore, 89);
    }

    let newGrade: Grade = newScore>=90?'A+':newScore>=80?'A':newScore>=68?'B+':newScore>=55?'B':newScore>=42?'C':'D';

    // ── GUIDANCE TIER PROMOTION ───────────────────────────────────────────────
    // Guidance upgrades can move stocks 10–30% in weeks (market behavior).
    // Binary trigger: if guidance strongly positive AND stock is accelerating →
    // promote one full grade tier. This is the "forward visibility" premium.
    const guidanceScore = guidanceScores[r.symbol];
    const GRADE_UP_MAP: Record<Grade, Grade> = {'D':'C','C':'B','B':'B+','B+':'A','A':'A+','A+':'A+','NR':'NR'};
    const GRADE_DOWN_MAP: Record<Grade, Grade> = {'A+':'A','A':'B+','B+':'B','B':'C','C':'D','D':'D','NR':'NR'};

    if (guidanceScore !== undefined && guidanceScore !== -1) {
      if (guidanceScore >= 0.7 && r.accelSignal === 'ACCELERATING') {
        newGrade = GRADE_UP_MAP[newGrade] as Grade;
      } else if (guidanceScore <= 0.3 && r.accelSignal === 'DECELERATING') {
        newGrade = GRADE_DOWN_MAP[newGrade] as Grade;
      }
    }
    // Consistency gate: guidance promotion cannot create A+ if stock has flags
    const hasCritForG = r.redFlags.some(f => f.severity === 'CRITICAL');
    const highCntForG = r.redFlags.filter(f => f.severity === 'HIGH').length;
    if (hasCritForG && (newGrade === 'A+' || newGrade === 'A')) newGrade = 'B+';
    if (highCntForG >= 2 && newGrade === 'A+') newGrade = 'A';

    return { ...r, score: newScore, grade: newGrade, guidanceScore: guidanceScores[r.symbol], guidanceAdj: adj };
  }

  const fileRef = useRef<HTMLInputElement>(null);

  // ── PATCH 1101qqq — AUTO-SYNC FROM screener.in via GitHub Action ──────────
  // Loads 12 screen CSVs from /data/screener/ (committed daily by the
  // workflow) and runs them through handleFiles(). One-shot on mount when
  // storage is empty + always-available manual refresh button.
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  useEffect(() => { getSyncStatus().then(setSyncStatus); }, []);
  const runAutoSync = useCallback(async (force = false) => {
    if (syncLoading) return;
    setSyncLoading(true);
    try {
      const files = await fetchCsvsAsFiles(SYNC_ROUTING.multibaggerIndia);
      if (files.length === 0) {
        setParseError('Auto-sync failed: no CSVs in /data/screener/. Run the GitHub Action first.');
        return;
      }
      await handleFiles(files);
      markAutoLoaded('multibagger-india');
      if (force) {
        // refresh manifest display
        const s = await getSyncStatus();
        setSyncStatus(s);
      }
    } finally {
      setSyncLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncLoading]);
  // First-mount: if nothing's been loaded yet AND we haven't auto-loaded
  // before, pull from sync. Skips when user has manually uploaded already.
  useEffect(() => {
    if (rows.length > 0) return;
    if (!shouldAutoLoad('multibagger-india')) return;
    // Wait 1.5s so the parent's IDB hydration has time to finish first.
    const t = setTimeout(() => {
      if (rows.length === 0 && shouldAutoLoad('multibagger-india')) {
        runAutoSync(false);
      }
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  // ── SORTABLE COLUMNS ──────────────────────────────────────────────────────
  type IndiaSort = 'score'|'pe'|'peg'|'roce'|'revCagr'|'profitCagr'|'marketCapCr'|'revenueAcceleration'|'opm'|'cfoToPat';
  const [sortField, setSortField] = useState<IndiaSort>('score');
  const [sortAsc,   setSortAsc]   = useState(false);
  function handleSort(field: IndiaSort) {
    if (sortField === field) { setSortAsc(v => !v); return; }
    // Default direction: ascending is "better" for PE/PEG/MCap (lower = better); descending for everything else
    setSortField(field);
    setSortAsc(['pe','peg','marketCapCr'].includes(field));
  }
  // Sort indicator helper
  const sortIcon = (f: IndiaSort) => sortField===f ? (sortAsc?' ▲':' ▼') : '';

  // ── SCORE CHANGE (vs prev upload baseline) ────────────────────────────────
  const PREV_SCORES_KEY = 'mb_india_prev_scores_v1';
  const prevScoreMap = useMemo<Record<string,number>>(() => {
    try { return JSON.parse(localStorage.getItem(PREV_SCORES_KEY)||'{}'); } catch { return {}; }
  }, []); // read once on mount

  async function parseSingleFile(file:File, XLSX: typeof import('xlsx')) {
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:'array'});
    return XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]],{defval:''});
  }

  async function handleFiles(files:FileList|File[]) {
    const arr=Array.from(files);
    setLoading(true); setParseError('');
    // PATCH 0872 — Save PRE-upload score baseline FIRST so the next analytics
    // render can compute genuine score deltas. Previously this was saved
    // AFTER scoring (line ~1039 pre-0872), which meant PREV always equalled
    // CURRENT and every delta-driven panel (RE-RATING, DROP ALERTS,
    // "new since last upload", sector rotation) was permanently zeroed.
    try { localStorage.setItem(PREV_SCORES_KEY, JSON.stringify(Object.fromEntries(rows.map(r=>[r.symbol,r.score])))); } catch {}
    try {
      const XLSX=await import('xlsx');
      // Start with existing rows — new uploads MERGE in, never replace
      const existingSymbols = new Set(rows.map(r => r.symbol));
      const newRows: ExcelRow[] = [];
      const seenNew = new Set<string>();

      // PATCH 0347 — Cross-market detection on India upload (peek first file)
      if (arr.length > 0) {
        const peekBuf = await arr[0].arrayBuffer();
        const peekWb = XLSX.read(peekBuf, { type:'array' });
        const peekRaw = XLSX.utils.sheet_to_json<Record<string,unknown>>(peekWb.Sheets[peekWb.SheetNames[0]], { defval:'' });
        if (peekRaw.length > 0) {
          const headers = Object.keys(peekRaw[0]);
          const detected = detectCsvMarket(headers);
          if (detected === 'US') {
            const proceed = window.confirm(
              `⚠️ This CSV looks like a USA TradingView export (found USA-specific columns like Forward non-GAAP P/E, Piotroski F-score, Altman Z-score).\n\nYou're currently on the India tab.\n\nClick OK to switch to USA Multibagger tab and upload there.\nClick Cancel to upload here anyway (may produce empty/wrong scores).`
            );
            if (proceed) {
              window.dispatchEvent(new CustomEvent('mc:switch-multibagger-tab', { detail: { tab: 'usa' } }));
              setLoading(false);
              return;
            }
          }
        }
      }

      // PATCH 0987 — track per-file screener membership.
      // Same ticker in multiple files now collects ALL file names instead of
      // being deduped to the first appearance. Stocks in 2+ files surface in
      // a new "🎯 MULTI-CONFIRMED" card in Analytics.
      const _screenerMap = new Map<string, string[]>();
      const _newRowByTicker = new Map<string, ExcelRow>();
      for (const file of arr) {
        const raw = await parseSingleFile(file, XLSX);
        if (!raw.length) continue;
        const cm = buildColMap(raw[0] as Record<string, unknown>);
        if (!cm['symbol']) continue;
        for (const r of raw) {
          const row = rawRowToExcelRow(r as Record<string, unknown>, cm);
          if (!row) continue;
          // Always record screener membership (even for tickers we already have)
          const prev = _screenerMap.get(row.symbol) || [];
          if (!prev.includes(file.name)) prev.push(file.name);
          _screenerMap.set(row.symbol, prev);
          // Collect row data only if it's truly new
          if (!existingSymbols.has(row.symbol) && !_newRowByTicker.has(row.symbol)) {
            _newRowByTicker.set(row.symbol, row);
          }
        }
      }
      for (const sym of _newRowByTicker.keys()) seenNew.add(sym);
      newRows.push(..._newRowByTicker.values());

      if(!newRows.length && rows.length > 0) {
        // PATCH 1043 — even when no NEW tickers, a re-upload must flush
        // screener-membership onto existing rows so 🎯 MULTI-CONFIRMED card populates.
        const rowsWithUpdatedScreeners = rows.map(r => {
          const newSources = _screenerMap.get(r.symbol);
          if (!newSources || newSources.length === 0) return r;
          const existing = (r as ExcelResult & { _screeners?: string[] })._screeners || [];
          const mergedScr = Array.from(new Set([...existing, ...newSources]));
          return { ...r, _screeners: mergedScr } as ExcelResult;
        });
        const reranked = applyForcedRanking([...rowsWithUpdatedScreeners].sort((a, b) => b.score - a.score));
        // PATCH 1090 — REGRESSION FIX: was `setExcelRows(reranked)` which is
        // the PARENT scope's setter (defined inside MultibaggerPage). Inside
        // ExcelCompare the prop is named `setRows` — calling the parent name
        // here is a ReferenceError that silently crashed every same-file
        // re-upload since PATCH 1043. That's the "Saved data lost (N stocks)"
        // banner staying visible even after the user re-uploaded.
        setRows(reranked);
        try {
          const existingFiles: string[] = JSON.parse(localStorage.getItem('mb_excel_files_v1') || '[]');
          const mergedFiles = Array.from(new Set([...existingFiles, ...arr.map(f => f.name)]));
          localStorage.setItem('mb_excel_files_v1', JSON.stringify(mergedFiles));
          window.dispatchEvent(new CustomEvent('mb-files:updated'));
        } catch {}
        const updatedCount = rowsWithUpdatedScreeners.filter((r, i) => r !== rows[i]).length;
        setFileName(`Screener membership refreshed on ${updatedCount} existing stocks · ${rows.length} total`);
        setLoading(false); return;
      }
      if(!newRows.length) {
        setParseError('No valid rows found. Ensure files have NSE Code column.');
        setLoading(false); return;
      }

      // Score new rows and merge with existing
      const newScored = newRows.map(r => {
        const scored = scoreExcelRow(r);
        // PATCH 0987 — attach screener membership recorded above
        const sc = _screenerMap.get(r.symbol) || [];
        return { ...scored, _screeners: sc };
      });
      // PATCH 0987 — also append new screener memberships onto existing rows
      // (a stock already in dataset that appears in a new screener should grow
      //  its membership, not stay frozen).
      const rowsWithUpdatedScreeners = rows.map(r => {
        const newSources = _screenerMap.get(r.symbol);
        if (!newSources || newSources.length === 0) return r;
        const existing = (r as ExcelResult & { _screeners?: string[] })._screeners || [];
        const merged = Array.from(new Set([...existing, ...newSources]));
        return { ...r, _screeners: merged };
      });
      const merged = [...rowsWithUpdatedScreeners, ...newScored].sort((a, b) => b.score - a.score);
      const allScored = applyForcedRanking(merged);
      setRows(allScored);
      // PATCH 0872 — Pre-upload baseline now captured at the TOP of this
      // function (saving current scores here turned PREV==CURRENT and broke
      // every score-delta indicator). Intentional no-op write here so the
      // old call site stays grep-able for future devs.

      const addedCount = newRows.length;
      const totalCount = allScored.length;
      setFileName(rows.length > 0
        ? `+${addedCount} new stocks added · ${totalCount} total`
        : `${arr.length} file${arr.length>1?'s':''} · ${totalCount} stocks`
      );
      // PATCH 0984 — persist Screener CSV names so MultibaggerAnalytics
      // can show a compact "N screeners · name1 · name2 · …" chip row.
      try {
        const existing: string[] = JSON.parse(localStorage.getItem('mb_excel_files_v1') || '[]');
        const newNames = arr.map(f => f.name);
        const merged = Array.from(new Set([...existing, ...newNames]));
        localStorage.setItem('mb_excel_files_v1', JSON.stringify(merged));
        window.dispatchEvent(new CustomEvent('mb-files:updated'));
      } catch {}
    } catch(e:unknown){setParseError(`Error: ${e instanceof Error?e.message:String(e)}`);}
    setLoading(false);
  }

  const GRADES:Grade[]=['A+','A','B+','B','C','D'];
  // "Good companies only" = passes all hard survival criteria
  // PATCH 1101d — null-safe optional chaining so a Screener CSV row missing
  // the decisionStrip fields can't crash the filter (silent crash → mystery 0).
  const goodCompanies = rows.filter(r =>
    (r.decisionStrip?.survival?.pass ?? false) &&
    r.accelSignal !== 'DECELERATING' &&
    r.bucket !== 'MONITOR' &&
    r.score >= 60
  );

  // Apply all active filters in order
  let baseRows = goodOnly ? goodCompanies : rows;
  if (bucketFilter !== 'ALL') baseRows = baseRows.filter(r => r.bucket === bucketFilter);
  // PATCH 1050 — AI tier filter (uses cached aiGuidanceMap)
  if (aiTierFilter !== 'ALL') {
    baseRows = baseRows.filter(r => aiGuidanceMap[(r.symbol || '').toUpperCase()]?.tier === aiTierFilter);
  }
  // PATCH 1046 — fraud risk filter
  if (fraudFilter !== 'ALL') {
    baseRows = baseRows.filter(r => {
      const fraudFlags = r.redFlags.filter(f => f.source && f.source.startsWith('fraud:'));
      const hasCrit = fraudFlags.some(f => f.severity === 'CRITICAL');
      const hasHigh = fraudFlags.some(f => f.severity === 'HIGH');
      if (fraudFilter === 'CLEAN')    return fraudFlags.length === 0;
      if (fraudFilter === 'CRITICAL') return hasCrit;
      if (fraudFilter === 'HIGH')     return hasHigh && !hasCrit;
      if (fraudFilter === 'ANY')      return fraudFlags.length > 0;
      return true;
    });
  }
  // PATCH 0127 — sector filter: institutional users want to compare within
  // sector (e.g. all Defence stocks ranked together, not all 84 mixed).
  if (sectorFilter !== 'ALL') baseRows = baseRows.filter(r => r.sector === sectorFilter);
  if (accelOnly)      baseRows = baseRows.filter(r => r.decisionStrip.acceleration.pass);
  if (fcfOnly)        baseRows = baseRows.filter(r => (r.fcfAbsolute ?? -1) > 0 || (r.cfoToPat ?? 0) >= 0.8);
  if (discoveryOnly)   baseRows = baseRows.filter(r => (r.fiiPlusDii ?? 100) < 15);
  // PATCH 1052 — 50/200 DMA confirmed-uptrend filter. Requires aboveDMA200 > 0
  // (price above 200 DMA) AND short-term momentum positive (return1m > -3%) as
  // a proxy for "price above 50 DMA" since most Screener CSV exports only carry
  // 200 DMA. When applied, narrows the list to stocks in confirmed long-term
  // and short-term uptrends — the institutional "trend is your friend" preset.
  // PATCH 1060 — Use actual aboveDMA50 when CSV has it; fall back to
  // pctFrom52wHigh > -15 as proxy when 50DMA is missing; relax return1m
  // requirement (most Screener CSVs ship "Return over 1year" not 1month).
  if (dmaConfirmedOnly) baseRows = baseRows.filter(r => {
    const above200 = (r.aboveDMA200 ?? -100) > 0;
    const above50  = (r as any).aboveDMA50 !== undefined ? ((r as any).aboveDMA50 > 0) : ((r.pctFrom52wHigh ?? -100) > -15);
    return above200 && above50;
  });
  if (inflectionOnly)  baseRows = baseRows.filter(r => r.inflectionSignal || r.triggerBonus >= 10);
  // PATCH 0272 — Conviction-only filter. When ON, narrows the universe to
  // tickers already on the Conviction Beats bench (synced from /earnings-opportunities).
  if (convictionOnly) baseRows = baseRows.filter(r => convictionSet.has((r.symbol || '').toUpperCase()));
  // P/E and PEG filters — only apply when data is available for a stock
  if (peMax  !== 'ALL') baseRows = baseRows.filter(r => r.pe  !== undefined && r.pe  > 0 && r.pe  <= peMax);
  if (pegMax !== 'ALL') baseRows = baseRows.filter(r => r.peg !== undefined && r.peg > 0 && r.peg <= pegMax);
  // PATCH 0345 — India institutional-quality composite filters (AND-style).
  // "Quality of 50": ROCE + Profit CAGR ≥ threshold — India equivalent of USA Rule of 40.
  if (indQualityMin !== 'ALL') baseRows = baseRows.filter(r => {
    const score = (r.roce ?? 0) + (r.profitCagr ?? 0);
    return score >= indQualityMin;
  });
  if (indRoceMin !== 'ALL') baseRows = baseRows.filter(r => (r.roce ?? 0) >= indRoceMin);
  if (indCfoMin !== 'ALL')  baseRows = baseRows.filter(r => (r.cfoToPat ?? 0) >= indCfoMin);
  // PATCH 0347 — decision filter
  // PATCH 1101zzz3 / AUDIT H6 — use cached lookup (decisionsCache) instead of
  // getDecision() to avoid localStorage read per row (~2000 reads → 1 read).
  if (indDecisionFilter !== 'ALL') {
    baseRows = baseRows.filter(r => {
      const d = lookupDecision(r.symbol);
      if (indDecisionFilter === 'WITH') return !!d;
      if (indDecisionFilter === 'NONE') return !d;
      return d?.status === indDecisionFilter;
    });
  }
  // Guidance tier filter — only meaningful when guidance mode is ON
  if (guidanceTier !== 'ALL' && guidanceMode) {
    baseRows = baseRows.filter(r => {
      const gs = guidanceScores[r.symbol];
      if (gs === undefined || gs === -1) return false;
      if (guidanceTier === 'STRONG')  return gs >= 0.70;
      if (guidanceTier === 'POS')     return gs >= 0.55 && gs < 0.70;
      if (guidanceTier === 'NEUTRAL') return gs > 0.45 && gs < 0.55;
      if (guidanceTier === 'NEG')     return gs > 0.30 && gs <= 0.45;
      if (guidanceTier === 'WEAK')    return gs <= 0.30;
      return true;
    });
  }
  const baseFiltered = gradeFilter.has('ALL') ? baseRows : baseRows.filter(r => gradeFilter.has(r.grade));
  // Apply guidance re-scoring when active
  const guidanceApplied = guidanceMode && Object.keys(guidanceScores).length > 0
    ? [...baseFiltered.map(r => applyGuidance(r))] : baseFiltered;
  // Apply sortable column sort (default: score descending — same as before)
  const filtered = [...guidanceApplied].sort((a, b) => {
    const getV = (r: ExcelResult): number => {
      switch(sortField) {
        case 'pe':                  return r.pe ?? (sortAsc ? 999 : -1);
        case 'peg':                 return r.peg ?? (sortAsc ? 999 : -1);
        case 'roce':                return r.roce ?? (sortAsc ? -1 : 999);
        case 'revCagr':             return r.revCagr ?? (sortAsc ? -1 : 999);
        case 'profitCagr':          return r.profitCagr ?? (sortAsc ? -1 : 999);
        case 'marketCapCr':         return r.marketCapCr ?? (sortAsc ? 999999 : -1);
        case 'revenueAcceleration': return r.revenueAcceleration ?? (sortAsc ? -999 : 999);
        case 'opm':                 return r.opm ?? (sortAsc ? -1 : 999);
        case 'cfoToPat':            return r.cfoToPat ?? (sortAsc ? -1 : 999);
        default:                    return r.score; // 'score'
      }
    };
    const av = getV(a), bv = getV(b);
    return sortAsc ? av - bv : bv - av;
  });
  const topPicks = rows.filter(r => ['A+','A','B+'].includes(r.grade) && r.bucket !== 'MONITOR');

  const METRICS: [keyof ExcelRow, string, string][] = [
    ['roce','ROCE %','Quality'],['roe','ROE %','Quality'],['opm','OPM %','Quality'],
    ['cfoToPat','CFO/PAT x','Quality'],['fcfAbsolute','FCF ₹Cr','Quality'],
    ['revCagr','Sales CAGR %','Growth'],['profitCagr','Profit CAGR %','Growth'],
    ['opLeverageRatio','Op Leverage x','Growth'],
    ['yoySalesGrowth','YOY Sales %','Growth'],['yoyProfitGrowth','YOY Profit %','Growth'],
    ['revenueAcceleration','Rev Accel pp','Recent'],['profitAcceleration','Profit Accel pp','Recent'],
    ['recentOpLev','Recent Op Lev x','Recent'],
    ['epsGrowth','EPS Growth %','Growth'],
    ['de','D/E x','Fin Str'],['netDebtEbitda','ND/EBITDA x','Fin Str'],
    ['promoter','Promoter %','Fin Str'],['pledge','Pledge %','Fin Str'],
    ['changeInPromoter','Δ Promoter %','Fin Str'],['icr','ICR x','Fin Str'],
    ['pe','P/E x','Valuation'],['peg','PEG','Valuation'],['pb','P/B x','Valuation'],
    ['marketCapCr','MCap ₹Cr','Valuation'],['marginOfSafety','MoS %','Valuation'],
    ['fiiPlusDii','FII+DII %','SQGLP-S'],['fii','FII %','SQGLP-S'],['dii','DII %','SQGLP-S'],
    ['aboveDMA200','vs DMA200 %','Market'],['return1m','Ret 1M %','Market'],
    ['pctFrom52wHigh','vs 52W High %','Market'],
    ['evEbitda','EV/EBITDA x','Valuation'],['fcfYield','FCF Yield %','Valuation'],
    ['roceExpansion','ROCE Δ 3yr pp','Quality'],['opmExpansion','OPM Δ 3yr pp','Quality'],
    ['gpm','GPM %','Quality'],['roic','ROIC %','Quality'],
  ];

  return (
    <div style={{maxWidth:1800,margin:'0 auto',padding:'28px 20px'}}>
      {/* PATCH 1054 — Compact header. Replaces the 14-card "extra columns"
          grid (read like onboarding marketing) with a single dense status
          strip + one-line CSV hint. Institutional-style: information density
          over decorative cards. */}
      <div style={{marginBottom:16,padding:'10px 14px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:10,display:'flex',alignItems:'baseline',gap:14,flexWrap:'wrap',fontVariantNumeric:'tabular-nums'}}>
        <span style={{fontSize:F.sm,fontWeight:800,color:PURPLE,letterSpacing:0.3}}>MULTIBAGGER ENGINE</span>
        <span style={{fontSize:F.xs,color:MUTED}}>SQGLP · Fisher 100-Bagger · Framework · auto-merge dedup</span>
        {rows.length > 0 && (
          <span style={{fontSize:F.xs,fontWeight:700,color:GREEN,letterSpacing:0.3}}>{rows.length} stocks loaded</span>
        )}
        <details style={{marginLeft:'auto',fontSize:F.xs,color:MUTED,cursor:'pointer'}}>
          <summary style={{listStyle:'none',color:'var(--mc-cyan)'}}>+ Optional CSV columns for full scoring</summary>
          <div style={{marginTop:6,paddingTop:6,borderTop:`1px dashed ${BORDER}`,maxWidth:720,lineHeight:1.55,fontSize:9,color:MUTED}}>
            <strong style={{color:TEXT}}>Quality:</strong> Gross profit margin · Return on invested capital · OPM last year
            &nbsp;·&nbsp;<strong style={{color:TEXT}}>Cash:</strong> Free Cash Flow · FCF Yield · Net Debt · EBITDA · EV/EBITDA
            &nbsp;·&nbsp;<strong style={{color:TEXT}}>Ownership:</strong> FII Holding · DII Holding · Change in promoter holding
            &nbsp;·&nbsp;<strong style={{color:TEXT}}>Trend:</strong> EPS growth · From 52W High · High price
          </div>
        </details>
      </div>

      {/* PATCH 1083 — orphan-meta warning banner. PATCH 1090 — also gate
          on rows.length === 0; once IDB rehydration or re-upload populates
          rows, the banner becomes stale and shouldn't keep firing. */}
      {orphanMetaCount > 0 && rows.length === 0 && (
        <div style={{marginBottom:14,padding:'14px 18px',backgroundColor:`color-mix(in srgb, ${RED} 12%, transparent)`,border:`1px solid ${RED}88`,borderLeft:`4px solid ${RED}`,borderRadius:8,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <div style={{fontSize:18}}>⚠</div>
          <div style={{flex:1,minWidth:200}}>
            <div style={{fontSize:F.sm,fontWeight:800,color:RED}}>Saved data lost ({orphanMetaCount} stocks)</div>
            <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.5,marginTop:4}}>
              Browser localStorage was wiped (5 MB cap reached after other uploads). The metadata
              survived but the actual stock data is gone. Re-upload your Excel file once — future
              uploads also write to IndexedDB which doesn&apos;t have the 5 MB limit, so they will
              persist permanently.
            </div>
          </div>
          <button onClick={() => { try { localStorage.removeItem(STORAGE_META); } catch {} setFileName(''); setOrphanMetaCount(0); }}
            style={{padding:'6px 14px',backgroundColor:'transparent',border:`1px solid ${RED}88`,borderRadius:6,color:RED,fontSize:F.xs,fontWeight:700,cursor:'pointer'}}>
            Dismiss
          </button>
        </div>
      )}

      {/* PATCH 1101m — Cloud save status badge. Visible at all times so the
          user can SEE whether their data has been backed up to Railway
          Postgres (the third persistence layer that survives browser
          eviction). Includes a manual "Backup now" button as an escape
          valve if the auto-save ever fails. */}
      <CloudSaveStatusBadge rows={rows} />


      {/* PATCH 1101qqq — Auto-sync status chip + manual refresh button.
          Shows last-sync date, lets user pull fresh CSVs without leaving tab. */}
      {syncStatus && syncStatus.hasManifest && (
        <div style={{marginBottom:8,padding:'6px 12px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',backgroundColor:syncStatus.isStale?`${RED}10`:`${PURPLE}08`,border:`1px solid ${syncStatus.isStale?RED:PURPLE}30`,borderRadius:8}}>
          <span style={{fontSize:F.xs,color:syncStatus.isStale?RED:MUTED}}>
            🔄 Auto-sync from screener.in · last run {syncStatus.lastSync?.toLocaleString()} ({syncStatus.hoursOld != null ? Math.round(syncStatus.hoursOld) : '?'}h ago)
            {syncStatus.isStale && ' · STALE'}
          </span>
          <button
            onClick={() => { resetAutoLoadFlag('multibagger-india'); runAutoSync(true); }}
            disabled={syncLoading}
            style={{marginLeft:'auto',padding:'4px 10px',backgroundColor:PURPLE,color:'#fff',border:'none',borderRadius:6,fontSize:F.xs,fontWeight:700,cursor:syncLoading?'wait':'pointer'}}
          >
            {syncLoading ? 'Loading...' : 'Refresh now'}
          </button>
        </div>
      )}

      {/* Upload zone */}
      <div
        onClick={()=>fileRef.current?.click()}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();if(e.dataTransfer.files.length)handleFiles(e.dataTransfer.files);}}
        style={{marginBottom:12,padding:'8px 14px',border:`1px dashed ${PURPLE}40`,borderRadius:8,cursor:'pointer',backgroundColor:`${PURPLE}05`,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}
      >
        <span style={{fontSize:16}}>{loading?'⏳':'📁'}</span>
        <span style={{fontSize:F.sm,fontWeight:700,color:PURPLE}}>
          {loading?'Scoring...':fileName?`✅ ${fileName}`:'Click or drop CSV / XLSX'}
        </span>
        <span style={{fontSize:F.xs,color:MUTED}}>
          Screener.in format · auto-detected · duplicates merged
        </span>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,.xls" multiple style={{display:'none'}}
          onChange={e=>{if(e.target.files?.length)handleFiles(e.target.files);}} />
      </div>

      {parseError&&<div style={{marginBottom:14,padding:'12px 16px',backgroundColor:`${RED}10`,border:`1px solid ${RED}30`,borderRadius:10,fontSize:F.md,color:RED}}>{parseError}</div>}

      {/* ── GUIDANCE BUTTON — always visible, prominent ─────────────────────────
          Fetches recent earnings/guidance news and re-scores all loaded stocks.
          Shows disabled state when no data is loaded yet. */}
      <div style={{marginBottom:20,display:'flex',alignItems:'center',gap:14,padding:'16px 20px',backgroundColor:CARD_BG,border:`2px solid ${guidanceMode?'var(--mc-warn)':'color-mix(in srgb, var(--mc-warn) 25%, transparent)'}`,borderRadius:12,flexWrap:'wrap'}}>
        <button
          onClick={() => {
            if (rows.length === 0) return;
            if (guidanceMode) {
              setGuidanceMode(false);
              setGuidanceScores({});
              // PATCH 1101d — reset guidanceTier on mode-off so the hidden
              // filter can't silently empty the result set later (this was
              // the root of the "Good Only shows 0" bug: guidanceTier
              // persisted from an earlier session, its chip hid with
              // guidanceMode, and it kept filtering invisibly).
              setGuidanceTier('ALL');
            } else {
              setGuidanceMode(true);
              fetchGuidanceScores();
            }
          }}
          style={{
            padding:'14px 28px', borderRadius:10,
            cursor: rows.length === 0 ? 'not-allowed' : 'pointer',
            border:`2px solid ${guidanceMode?'var(--mc-warn)':'color-mix(in srgb, var(--mc-warn) 38%, transparent)'}`,
            background: guidanceMode ? 'color-mix(in srgb, var(--mc-warn) 19%, transparent)' : 'color-mix(in srgb, var(--mc-warn) 6%, transparent)',
            color: rows.length === 0 ? 'color-mix(in srgb, var(--mc-warn) 31%, transparent)' : 'var(--mc-warn)',
            display:'flex', alignItems:'center', gap:10,
            opacity: rows.length === 0 ? 0.5 : 1,
            transition:'all 0.15s',
          }}
        >
          <span style={{fontSize:26}}>{guidanceLoading ? '⏳' : '📡'}</span>
          <div>
            <div style={{fontSize:F.lg,fontWeight:900,letterSpacing:'-0.3px'}}>
              {guidanceLoading ? 'Fetching guidance…' : guidanceMode ? 'Guidance: ON' : 'Guidance'}
            </div>
            <div style={{fontSize:F.xs,fontWeight:400,marginTop:2,color:'color-mix(in srgb, var(--mc-warn) 60%, transparent)'}}>
              {rows.length === 0 ? 'Upload data first, then click to score with guidance' :
               guidanceMode ? `${Object.keys(guidanceScores).length} stocks re-scored · click again to reset` :
               `Re-score ${rows.length} stocks using live earnings & guidance news`}
            </div>
          </div>
          {guidanceMode && <span style={{fontSize:F.sm,fontWeight:700,color:'var(--mc-warn)',marginLeft:8}}>✓ ACTIVE</span>}
        </button>
        <div style={{flex:1,minWidth:200}}>
          <div style={{fontSize:F.sm,color:MUTED,lineHeight:1.6}}>
            Fetches latest earnings results + guidance upgrades/cuts from live news feed.
            Re-ranks all stocks: <span style={{color:GREEN}}>raised guidance = +14 pts</span> · <span style={{color:RED}}>cut guidance = −14 pts</span> · shows guidance score (0.0–1.0) per stock.
          </div>
        </div>
        {guidanceMode && !guidanceLoading && Object.keys(guidanceScores).length > 0 && (
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
            {[
              {label:'Strong ▲',  count:Object.values(guidanceScores).filter(v=>v>=0.7).length,           color:GREEN},
              {label:'Positive',  count:Object.values(guidanceScores).filter(v=>v>=0.55&&v<0.7).length,   color:'#34d399'},
              {label:'Neutral',   count:Object.values(guidanceScores).filter(v=>v>0.45&&v<0.55).length,   color:MUTED},
              {label:'Negative',  count:Object.values(guidanceScores).filter(v=>v>0.3&&v<=0.45).length,   color:ORANGE},
              {label:'Weak ▼',   count:Object.values(guidanceScores).filter(v=>v>=0&&v<=0.3).length,      color:RED},
              {label:'No data',  count:Object.values(guidanceScores).filter(v=>v===-1).length,             color:MUTED},
            ].map(({label,count,color})=>(
              <div key={label} style={{padding:'6px 10px',backgroundColor:`${color}14`,border:`1px solid ${color}30`,borderRadius:7,textAlign:'center',minWidth:60}}>
                <div style={{fontSize:F.md,fontWeight:800,color}}>{count}</div>
                <div style={{fontSize:F.xs,color:MUTED}}>{label}</div>
              </div>
            ))}
            {/* Legend */}
            <div style={{fontSize:F.xs,color:MUTED,marginLeft:8,lineHeight:1.5}}>
              <span style={{color:GREEN}}>News-based</span> = from earnings articles ·&nbsp;
              <span style={{color:ACCENT}}>📊 proxy</span> = trajectory signal (no news coverage) ·&nbsp;
              <span style={{color:MUTED}}>— no data</span> = no signal available
            </div>
          </div>
        )}
      </div>

      {rows.length>0&&(
        <>
          {/* Summary + GUIDANCE button on same row */}
          <div style={{display:'flex',gap:14,marginBottom:18,flexWrap:'wrap',alignItems:'stretch'}}>
            {[
              {label:'Scored',value:rows.length,color:PURPLE},
              {label:'Top Picks (B+)',value:topPicks.length,color:GREEN},
              {label:'Best Score',value:rows[0]?.score??0,color:rows[0]?.score>=72?GREEN:YELLOW},
              {label:'Avg Score',value:Math.round(rows.reduce((a,r)=>a+r.score,0)/rows.length),color:MUTED},
            ].map(({label,value,color})=>(
              <div key={label} style={{padding:'14px 22px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:10,textAlign:'center'}}>
                <div style={{fontSize:F.h1,fontWeight:900,color}}>{value}</div>
                <div style={{fontSize:F.sm,color:MUTED,marginTop:2}}>{label}</div>
              </div>
            ))}

            <div style={{display:'flex',gap:6,alignItems:'center',marginLeft:'auto',flexWrap:'wrap'}}>
              {/* Good Companies Only */}
              <button onClick={()=>setGoodOnly(v=>!v)} style={{fontSize:F.sm,fontWeight:800,padding:'8px 16px',borderRadius:8,border:`2px solid ${goodOnly?GREEN+'80':BORDER}`,background:goodOnly?`${GREEN}18`:'transparent',color:goodOnly?GREEN:MUTED,cursor:'pointer'}}>
                {goodOnly?`✅ Good Only (${goodCompanies.length})`:`🔍 Good Only`}
              </button>
              <div style={{width:1,background:BORDER,height:24}}/>
              {/* Grade filter */}
              {(['ALL',...GRADES] as const).map(g=>{
                const active = gradeFilter.has(g);
                const col = GRADE_COLOR[g as Grade] || PURPLE;
                return (
                <button key={g} onClick={()=>{
                  if (g === 'ALL') { setGradeFilter(new Set(['ALL'])); return; }
                  setGradeFilter(prev => {
                    const next = new Set(prev);
                    next.delete('ALL'); // clear ALL when selecting specific grades
                    if (next.has(g)) { next.delete(g); if (next.size === 0) next.add('ALL'); }
                    else next.add(g);
                    return next;
                  });
                }} style={{fontSize:F.sm,fontWeight:700,padding:'7px 12px',borderRadius:8,border:`1px solid ${active?col+'60':BORDER}`,background:active?col+'18':'transparent',color:active?col:MUTED,cursor:'pointer'}}>
                  {g}{g!=='ALL'&&` (${rows.filter(r=>r.grade===g).length})`}
                </button>
                );})}
            </div>
          </div>
          {/* Bucket + quick filters row */}
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>BUCKET:</span>
            {(['ALL','CORE_COMPOUNDER','EMERGING_MULTIBAGGER','HIGH_RISK','MONITOR'] as const).map(b=>{
              const cfg = b==='ALL' ? {label:'All',color:MUTED,icon:'',count:rows.length} :
                {...BUCKET_CONFIG[b], count:rows.filter(r=>r.bucket===b).length};
              return (
                <button key={b} onClick={()=>setBucketFilter(b)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${bucketFilter===b?cfg.color+'60':BORDER}`,background:bucketFilter===b?cfg.color+'18':'transparent',color:bucketFilter===b?cfg.color:MUTED,cursor:'pointer'}}>
                  {cfg.icon && `${cfg.icon} `}{'label' in cfg ? cfg.label : b} ({cfg.count})
                </button>
              );
            })}
            <div style={{width:1,background:BORDER,height:20}}/>
            {/* PATCH 0127 — Sector filter dropdown */}
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>SECTOR:</span>
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              style={{fontSize:F.xs,fontWeight:700,padding:'5px 8px',borderRadius:7,border:`1px solid ${sectorFilter==='ALL'?BORDER:'color-mix(in srgb, var(--mc-cyan) 38%, transparent)'}`,background:sectorFilter==='ALL'?'transparent':'color-mix(in srgb, var(--mc-cyan) 8%, transparent)',color:sectorFilter==='ALL'?MUTED:'var(--mc-cyan)',cursor:'pointer'}}>
              <option value="ALL">All sectors</option>
              {(() => {
                const counts: Record<string, number> = {};
                for (const r of rows) counts[r.sector] = (counts[r.sector] ?? 0) + 1;
                return Object.entries(counts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([s, c]) => (
                    <option key={s} value={s}>{s} ({c})</option>
                  ));
              })()}
            </select>
            <div style={{width:1,background:BORDER,height:20}}/>
            {/* PATCH 1050 — AI GUIDANCE buttons + status + filter chips */}
            {(() => {
              const cachedCount = Object.keys(aiGuidanceMap).length;
              const goodCount = (typeof goodCompanies !== 'undefined' ? goodCompanies : rows.filter((r: any) => r.score >= 60)).length;
              const oldestFetched = cachedCount > 0 ? Math.min(...Object.values(aiGuidanceMap).map(e => e.fetchedAt || Date.now())) : 0;
              const daysAgo = oldestFetched > 0 ? Math.floor((Date.now() - oldestFetched) / 86_400_000) : 0;
              return (
                <>
                  <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>🤖 AI GUIDANCE:</span>
                  <button onClick={()=>fetchAIGuidance(false)} disabled={aiGuidanceLoading || rows.length === 0} title={`Soft fetch: only new tickers or cache > 100 days old. Free if all cached.`} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${PURPLE}80`,background:`${PURPLE}14`,color:PURPLE,cursor:rows.length===0?'not-allowed':'pointer'}}>
                    {aiGuidanceLoading ? `⏳ ${aiGuidanceProgress.done}/${aiGuidanceProgress.total}` : `📡 Fetch (gaps only)`}
                  </button>
                  <button onClick={()=>fetchAIGuidance(true)} disabled={aiGuidanceLoading || rows.length === 0} title={`Hard refresh: re-fetch ALL ${goodCount} Good-filter stocks. Costs ~$${(goodCount * 0.0014).toFixed(2)}.`} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${ORANGE}80`,background:`${ORANGE}14`,color:ORANGE,cursor:rows.length===0?'not-allowed':'pointer'}}>
                    🔄 Hard Refresh
                  </button>
                  <span style={{fontSize:F.xs,color:MUTED}}>{cachedCount > 0 ? `${cachedCount} cached · oldest ${daysAgo}d ago` : 'No cache yet'}</span>
                  {aiGuidanceProgress.configMissing && <span style={{fontSize:F.xs,color:RED,fontWeight:800,padding:'2px 6px',background:`${RED}14`,borderRadius:4}}>🔧 ANTHROPIC_API_KEY not set in Railway</span>}
                  {/* AI tier filter chips */}
                  {([
                    {key:'ALL', label:'All', color:MUTED},
                    {key:'EXCELLENT', label:'🚀 Excellent', color:'#10B981'},
                    {key:'POSITIVE', label:'▲ Positive', color:'#34D399'},
                    {key:'NEUTRAL', label:'● Neutral', color:'#94A3B8'},
                    {key:'CAUTIOUS', label:'▽ Cautious', color:'#F59E0B'},
                    {key:'NEGATIVE', label:'⚠ Negative', color:'#EF4444'},
                  ] as const).map(t => {
                    const cnt = t.key === 'ALL' ? rows.length : Object.values(aiGuidanceMap).filter(e => e.tier === t.key).length;
                    return (
                      <button key={t.key} onClick={()=>setAiTierFilter(t.key as any)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 10px',borderRadius:7,border:`1px solid ${aiTierFilter===t.key?t.color+'80':BORDER}`,background:aiTierFilter===t.key?t.color+'14':'transparent',color:aiTierFilter===t.key?t.color:MUTED,cursor:'pointer'}}>
                        {t.label} ({cnt})
                      </button>
                    );
                  })}
                  <div style={{width:1,background:BORDER,height:20}}/>
                </>
              );
            })()}
            {/* PATCH 1046 — FRAUD RISK filter chips */}
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>🛡 FRAUD:</span>
            {(() => {
              const fraudCounts = {
                CLEAN: rows.filter(r => !r.redFlags.some(f => f.source && f.source.startsWith('fraud:'))).length,
                CRITICAL: rows.filter(r => r.redFlags.some(f => f.source && f.source.startsWith('fraud:') && f.severity === 'CRITICAL')).length,
                HIGH: rows.filter(r => { const ff = r.redFlags.filter(f => f.source && f.source.startsWith('fraud:')); return ff.some(f => f.severity === 'HIGH') && !ff.some(f => f.severity === 'CRITICAL'); }).length,
                ANY: rows.filter(r => r.redFlags.some(f => f.source && f.source.startsWith('fraud:'))).length,
              };
              const opts: Array<{key:'ALL'|'CLEAN'|'CRITICAL'|'HIGH'|'ANY', label:string, color:string, count:number}> = [
                {key:'ALL',      label:'All',                   color:MUTED,  count: rows.length},
                {key:'CLEAN',    label:'✓ Clean only',           color:GREEN,  count: fraudCounts.CLEAN},
                {key:'ANY',      label:'⚠ Any flag',             color:ORANGE, count: fraudCounts.ANY},
                {key:'HIGH',     label:'⚠ HIGH risk',            color:ORANGE, count: fraudCounts.HIGH},
                {key:'CRITICAL', label:'🚨 NEVER BUY (Critical)', color:RED,    count: fraudCounts.CRITICAL},
              ];
              return opts.map(o => (
                <button key={o.key} onClick={()=>setFraudFilter(o.key)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${fraudFilter===o.key?o.color+'80':BORDER}`,background:fraudFilter===o.key?o.color+'14':'transparent',color:fraudFilter===o.key?o.color:MUTED,cursor:'pointer'}}>
                  {o.label} ({o.count})
                </button>
              ));
            })()}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>QUICK:</span>
            {[
              {key:'accel',  label:'🚀 Accelerating', active:accelOnly,  toggle:()=>setAccelOnly(v=>!v),  count:rows.filter(r=>r.decisionStrip.acceleration.pass).length},
              {key:'fcf',    label:'💰 FCF+',         active:fcfOnly,    toggle:()=>setFcfOnly(v=>!v),    count:rows.filter(r=>(r.fcfAbsolute??-1)>0||(r.cfoToPat??0)>=0.8).length},
              {key:'disc',    label:'🔍 Discovery <15%', active:discoveryOnly,  toggle:()=>setDiscoveryOnly(v=>!v),  count:rows.filter(r=>(r.fiiPlusDii??100)<15).length},
      // PATCH 1052 — Combined 50/200 DMA above filter chip. Stacks on top of
      // any other filter; user explicitly requested as the "always-on combo
      // when picking the best stocks" preset.
      {key:'dma',     label:'📈 50/200 DMA ↑',    active:dmaConfirmedOnly, toggle:()=>setDmaConfirmedOnly(v=>!v), count:rows.filter(r=>{const a200=(r.aboveDMA200??-100)>0; const a50=(r as any).aboveDMA50!==undefined?((r as any).aboveDMA50>0):((r.pctFrom52wHigh??-100)>-15); return a200 && a50;}).length},  // PATCH 1060
      {key:'inflect', label:'💥 Inflection',     active:inflectionOnly, toggle:()=>setInflectionOnly(v=>!v), count:rows.filter(r=>r.inflectionSignal||r.triggerBonus>=10).length},
      // PATCH 0272 — Conviction-only chip. Counts how many uploaded rows
      // intersect the Conviction Beats bench so users can see at a glance
      // which of their multibagger candidates ALSO just printed a BLOCKBUSTER/STRONG.
      {key:'cb',     label:'🏆 Conviction',     active:convictionOnly, toggle:()=>setConvictionOnly(v=>!v), count:rows.filter(r=>convictionSet.has((r.symbol||'').toUpperCase())).length},
      // Guidance button — separate from regular toggles, has its own fetch action
            ].map(f=>(
              <button key={f.key} onClick={f.toggle} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${f.active?ACCENT+'60':BORDER}`,background:f.active?ACCENT+'14':'transparent',color:f.active?ACCENT:MUTED,cursor:'pointer'}}>
                {f.label} ({f.count})
              </button>
            ))}
            {/* PATCH 0345 — India "Quality of 50" composite filter (analog of USA R40).
                ROCE + Profit CAGR ≥ threshold. ≥50 = passes (MOSL elite baseline);
                ≥75 = strong compounder; ≥100 = 100-bagger DNA tier.
                Composes AND-style with all other filters. */}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:'var(--mc-state-persistent)',fontWeight:700,letterSpacing:'0.5px'}}>Q50:</span>
            {(['ALL',50,75,100] as const).map(v=>(
              <button key={String(v)} onClick={()=>setIndQualityMin(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                border:`1px solid ${indQualityMin===v?'color-mix(in srgb, var(--mc-state-persistent) 38%, transparent)':BORDER}`,background:indQualityMin===v?'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)':'transparent',color:indQualityMin===v?'var(--mc-state-persistent)':MUTED,cursor:'pointer'}}
                title={v==='ALL'?'No quality filter':`ROCE + Profit CAGR ≥ ${v}${v===100?' = 100-bagger DNA tier':v===75?' = strong compounder':' = MOSL elite baseline'}`}>
                {v==='ALL'?'All':`≥${v}${v===100?' 🏆':''}`}
                {v!=='ALL' && ` (${rows.filter(r=>(r.roce??0)+(r.profitCagr??0)>=v).length})`}
              </button>
            ))}
            {/* PATCH 0345 — ROCE filter standalone (moat signature) */}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:'var(--mc-bullish)',fontWeight:700,letterSpacing:'0.5px'}}>ROCE:</span>
            {(['ALL',20,25,30] as const).map(v=>(
              <button key={String(v)} onClick={()=>setIndRoceMin(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                border:`1px solid ${indRoceMin===v?'color-mix(in srgb, var(--mc-bullish) 38%, transparent)':BORDER}`,background:indRoceMin===v?'color-mix(in srgb, var(--mc-bullish) 8%, transparent)':'transparent',color:indRoceMin===v?'var(--mc-bullish)':MUTED,cursor:'pointer'}}>
                {v==='ALL'?'All':`≥${v}%${v===30?' 💎':''}`}
                {v!=='ALL' && ` (${rows.filter(r=>(r.roce??0)>=v).length})`}
              </button>
            ))}
            {/* PATCH 0345 — CFO/PAT filter (cash conversion / earnings quality) */}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:'#34d399',fontWeight:700,letterSpacing:'0.5px'}}>CFO/PAT:</span>
            {(['ALL',0.8,1.0] as const).map(v=>(
              <button key={String(v)} onClick={()=>setIndCfoMin(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                border:`1px solid ${indCfoMin===v?'#34d39960':BORDER}`,background:indCfoMin===v?'#34d39914':'transparent',color:indCfoMin===v?'#34d399':MUTED,cursor:'pointer'}}>
                {v==='ALL'?'All':`≥${v.toFixed(1)}${v===1.0?'× 💎':'×'}`}
                {v!=='ALL' && ` (${rows.filter(r=>(r.cfoToPat??0)>=v).length})`}
              </button>
            ))}
            {/* Guidance tier filter — only shown when guidance mode is ON */}
            {guidanceMode && <>
              <div style={{width:1,background:BORDER,height:20}}/>
              <span style={{fontSize:F.xs,color:'var(--mc-warn)',fontWeight:700,letterSpacing:'0.5px'}}>GUIDANCE:</span>
              {([
                {k:'ALL' as GuidanceTier,    label:'All',        col:MUTED},
                {k:'STRONG' as GuidanceTier, label:'▲ Strong',   col:GREEN},
                {k:'POS' as GuidanceTier,    label:'↑ Positive', col:'#34d399'},
                {k:'NEUTRAL' as GuidanceTier,label:'→ Neutral',  col:MUTED},
                {k:'NEG' as GuidanceTier,    label:'↓ Negative', col:ORANGE},
                {k:'WEAK' as GuidanceTier,   label:'▼ Weak',     col:RED},
              ] as const).map(({k,label,col})=>(
                <button key={k} onClick={()=>setGuidanceTier(prev=>prev===k?'ALL':k)}
                  style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${guidanceTier===k?col+'60':BORDER}`,background:guidanceTier===k?col+'18':'transparent',color:guidanceTier===k?col:MUTED,cursor:'pointer'}}>
                  {label}
                </button>
              ))}
            </>}
            {/* P/E filter */}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>P/E:</span>
            {(['ALL',15,25,40,60,100] as const).map(v=>(
              <button key={v} onClick={()=>setPeMax(prev=>prev===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 10px',borderRadius:7,
                border:`1px solid ${peMax===v?YELLOW+'60':BORDER}`,background:peMax===v?`${YELLOW}14`:'transparent',color:peMax===v?YELLOW:MUTED,cursor:'pointer'}}>
                {v==='ALL'?'All':`<${v}×`}
              </button>
            ))}
            {/* PEG filter */}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>PEG:</span>
            {(['ALL',0.8,1.0,1.5,2.0] as const).map(v=>(
              <button key={v} onClick={()=>setPegMax(prev=>prev===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 10px',borderRadius:7,
                border:`1px solid ${pegMax===v?GREEN+'60':BORDER}`,background:pegMax===v?`${GREEN}14`:'transparent',color:pegMax===v?GREEN:MUTED,cursor:'pointer'}}>
                {v==='ALL'?'All':`<${v}`}
              </button>
            ))}
            <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>{filtered.length} showing</span>
            <button
              onClick={() => { setExpandAll(v => !v); setExpRow(null); }}
              style={{
                fontSize:F.xs, fontWeight:700, padding:'5px 12px', borderRadius:7, cursor:'pointer',
                border:`1px solid ${expandAll ? ACCENT+'60' : BORDER}`,
                background: expandAll ? ACCENT+'14' : 'transparent',
                color: expandAll ? ACCENT : MUTED,
              }}
            >
              {expandAll ? '⊟ Collapse All' : '⊞ Expand All'}
            </button>

            {/* ── DOWNLOAD DOCX ── */}
            {filtered.length > 0 && (
              <button
                title="Download full report as Word document"
                onClick={async () => {
                  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
                    HeadingLevel, AlignmentType, WidthType, BorderStyle: BS, ShadingType, LevelFormat } = await import('docx');
                  const border = { style: BS.SINGLE, size: 1, color: 'CCCCCC' };
                  const borders = { top: border, bottom: border, left: border, right: border };
                  const cm = { top: 80, bottom: 80, left: 120, right: 120 };
                  const fmtVal = (field: keyof ExcelRow, label: string, v: number) => {
                    if (label.includes('Cr')) return `₹${v.toLocaleString('en-IN', {maximumFractionDigits:2})}`;
                    if (label.endsWith(' x')) return `${v.toFixed(2)}×`;
                    return `${v.toFixed(1)}${label.includes('%') || label.includes('pp') ? '%' : ''}`;
                  };
                  const children: any[] = [
                    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '📊 Multibagger Research Report', bold: true, size: 36 })] }),
                    new Paragraph({ children: [new TextRun({ text: `Generated: ${new Date().toLocaleDateString('en-IN', {day:'numeric',month:'long',year:'numeric'})}  |  Stocks: ${filtered.length}  |  Framework: SQGLP + Fisher 100-Bagger`, size: 20, color: '666666' })] }),
                    new Paragraph({ children: [new TextRun('')] }),
                    // Grade summary table
                    new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [1560,1560,1560,1560,1560,1560], rows: [
                      new TableRow({ children: ['A+','A','B+','B','C','D'].map(g => new TableCell({ borders, margins: cm, width: { size: 1560, type: WidthType.DXA }, shading: { fill: g==='A+'?'E8F5E9':g==='A'?'F1F8E9':g==='B+'?'FFF8E1':g==='B'?'FFF3E0':'FAFAFA', type: ShadingType.CLEAR }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: g, bold: true })] })] })) }),
                      new TableRow({ children: ['A+','A','B+','B','C','D'].map(g => new TableCell({ borders, margins: cm, width: { size: 1560, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(filtered.filter(r=>r.grade===g).length), bold: true, size: 24 })] })] })) }),
                    ]}),
                    new Paragraph({ children: [new TextRun('')] }),
                  ];
                  for (const r of filtered) {
                    const gs = guidanceScores[r.symbol];
                    children.push(
                      new Paragraph({ heading: HeadingLevel.HEADING_2, pageBreakBefore: children.length > 10, children: [new TextRun({ text: `${r.symbol}  —  ${r.company || r.sector}`, bold: true })] }),
                      new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [2340,2340,2340,2340], rows: [
                        new TableRow({ children: [
                          new TableCell({ borders, margins: cm, width: { size: 2340, type: WidthType.DXA }, shading: { fill: 'F5F5F5', type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: `Score: ${r.score} | Grade: ${r.grade}`, bold: true })] })] }),
                          new TableCell({ borders, margins: cm, width: { size: 2340, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun(`Bucket: ${r.bucket.replace(/_/g,' ')}`)] })] }),
                          new TableCell({ borders, margins: cm, width: { size: 2340, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun(`Ownership: ${r.ownershipCategory.replace(/_/g,' ')}`)] })] }),
                          new TableCell({ borders, margins: cm, width: { size: 2340, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun(gs !== undefined && gs !== -1 ? `Guidance: ${gs.toFixed(1)}` : 'Guidance: —')] })] }),
                        ]}),
                      ]}),
                    );
                    // Metrics table
                    const metricRows = METRICS.filter(([f]) => r[f] !== undefined && r[f] !== null);
                    if (metricRows.length > 0) {
                      children.push(new Paragraph({ children: [new TextRun({ text: 'Metrics', bold: true, size: 22 })] }));
                      const half = Math.ceil(metricRows.length / 2);
                      for (let i = 0; i < half; i++) {
                        const left = metricRows[i], right = metricRows[i + half];
                        children.push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [2600,2080,2600,2080], rows: [
                          new TableRow({ children: [
                            new TableCell({ borders, margins: cm, width: { size: 2600, type: WidthType.DXA }, shading: { fill: 'F9F9F9', type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: left[1], size: 18 })] })] }),
                            new TableCell({ borders, margins: cm, width: { size: 2080, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: fmtVal(left[0], left[1], r[left[0]] as number), bold: true, size: 18 })] })] }),
                            ...(right ? [
                              new TableCell({ borders, margins: cm, width: { size: 2600, type: WidthType.DXA }, shading: { fill: 'F9F9F9', type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: right[1], size: 18 })] })] }),
                              new TableCell({ borders, margins: cm, width: { size: 2080, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: fmtVal(right[0], right[1], r[right[0]] as number), bold: true, size: 18 })] })] }),
                            ] : [
                              new TableCell({ borders, margins: cm, width: { size: 2600, type: WidthType.DXA }, children: [new Paragraph({ children: [] })] }),
                              new TableCell({ borders, margins: cm, width: { size: 2080, type: WidthType.DXA }, children: [new Paragraph({ children: [] })] }),
                            ]),
                          ]}),
                        ]}));
                      }
                    }
                    // Strengths
                    if (r.strengths.length > 0) {
                      children.push(new Paragraph({ children: [new TextRun({ text: '✅ Strengths', bold: true, size: 22, color: '1B7F4F' })] }));
                      r.strengths.forEach(s => children.push(new Paragraph({ indent: { left: 360 }, children: [new TextRun({ text: `• ${s}`, size: 18 })] })));
                    }
                    // Risks
                    if (r.risks.length > 0 || r.redFlags.length > 0) {
                      children.push(new Paragraph({ children: [new TextRun({ text: '⚠ Risks & Flags', bold: true, size: 22, color: 'B91C1C' })] }));
                      r.redFlags.forEach(f => children.push(new Paragraph({ indent: { left: 360 }, children: [new TextRun({ text: `🚩 [${f.severity}] ${f.label}`, size: 18, color: 'B91C1C' })] })));
                      r.risks.filter(s => !s.startsWith('Hard ')).forEach(s => children.push(new Paragraph({ indent: { left: 360 }, children: [new TextRun({ text: `• ${s}`, size: 18 })] })));
                    }
                    children.push(new Paragraph({ children: [new TextRun({ text: `Sector: ${r.sector}  |  Data: ${r.coverage}%  |  Pillar weights: ${r.pillarScores.map(p=>`${p.label} ${p.weight}%`).join(' · ')}`, size: 16, color: '888888' })] }));
                    children.push(new Paragraph({ children: [new TextRun('')] }));
                  }
                  const doc = new Document({ sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children }] });
                  const blob = await Packer.toBlob(doc);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = `multibagger-${new Date().toISOString().slice(0,10)}.docx`; a.click(); URL.revokeObjectURL(url);
                }}
                style={{ fontSize:F.xs, fontWeight:700, padding:'5px 12px', borderRadius:7, cursor:'pointer', border:`1px solid ${BORDER}`, background:'transparent', color:'var(--mc-state-persistent)' }}
              >⬇ DOCX</button>
            )}

            {/* ── DOWNLOAD PDF ── */}
            {filtered.length > 0 && (
              <button
                title="Download full report as PDF"
                onClick={async () => {
                  const { jsPDF } = await import('jspdf');
                  const autoTable = (await import('jspdf-autotable')).default;
                  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                  const pageW = doc.internal.pageSize.getWidth();
                  const margin = 14;
                  const contentW = pageW - margin * 2;
                  const fmtV = (label: string, v: number) => {
                    if (label.includes('Cr')) return `₹${v.toLocaleString('en-IN',{maximumFractionDigits:1})}`;
                    if (label.endsWith(' x')) return `${v.toFixed(2)}×`;
                    return `${v.toFixed(1)}${label.includes('%')||label.includes('pp')?'%':''}`;
                  };
                  // Cover page
                  doc.setFontSize(22); doc.setFont('helvetica','bold');
                  doc.text('Multibagger Research Report', pageW/2, 40, { align: 'center' });
                  doc.setFontSize(11); doc.setFont('helvetica','normal');
                  doc.text(`SQGLP · Fisher 100-Bagger · ${filtered.length} stocks · ${new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}`, pageW/2, 50, { align: 'center' });
                  // Grade summary
                  const gradeSummary = ['A+','A','B+','B','C','D'].map(g => [g, String(filtered.filter(r=>r.grade===g).length)]);
                  autoTable(doc, { startY: 60, margin: { left: margin }, head: [['A+','A','B+','B','C','D']], body: [gradeSummary.map(([,n])=>n)], theme: 'grid', headStyles: { fillColor: [88,28,135], textColor: 255, fontStyle: 'bold', halign: 'center' }, bodyStyles: { halign: 'center', fontStyle: 'bold', fontSize: 13 }, tableWidth: contentW });
                  for (let i = 0; i < filtered.length; i++) {
                    const r = filtered[i];
                    doc.addPage();
                    const gs = guidanceScores[r.symbol];
                    // Stock header
                    doc.setFillColor(15, 23, 42); doc.rect(0, 0, pageW, 22, 'F');
                    doc.setTextColor(255,255,255); doc.setFontSize(14); doc.setFont('helvetica','bold');
                    doc.text(`${r.symbol}  —  ${r.company || r.sector}`, margin, 10);
                    doc.setFontSize(9); doc.setFont('helvetica','normal');
                    const gradeColor: Record<string,[number,number,number]> = {'A+':[16,185,129],'A':[52,211,153],'B+':[245,158,11],'B':[249,115,22],'C':[251,146,60],'D':[239,68,68]};
                    const gc = gradeColor[r.grade] || [100,100,100];
                    doc.setTextColor(...gc); doc.setFontSize(18); doc.setFont('helvetica','bold');
                    doc.text(r.grade, pageW - margin - 10, 13, { align: 'right' });
                    doc.setTextColor(200,200,200); doc.setFontSize(9); doc.setFont('helvetica','normal');
                    doc.text(`Score: ${r.score}  |  ${r.bucket.replace(/_/g,' ')}  |  ${r.ownershipCategory.replace(/_/g,' ')}  |  Guidance: ${gs !== undefined && gs !== -1 ? gs.toFixed(1) : '—'}`, margin, 18);
                    doc.setTextColor(0,0,0);
                    // Metrics table
                    const metricRows = METRICS.filter(([f]) => r[f] !== undefined && r[f] !== null)
                      .map(([f,label]) => [label, fmtV(label, r[f] as number)]);
                    const half = Math.ceil(metricRows.length / 2);
                    const leftCol = metricRows.slice(0, half);
                    const rightCol = metricRows.slice(half);
                    const tableBody = leftCol.map((row, i) => [...row, ...(rightCol[i] || ['',''])]);
                    autoTable(doc, { startY: 26, margin: { left: margin }, head: [['Metric','Value','Metric','Value']], body: tableBody, theme: 'striped', headStyles: { fillColor: [30,41,59], textColor: 255, fontSize: 8 }, bodyStyles: { fontSize: 7.5 }, columnStyles: { 0: { cellWidth: contentW*0.32 }, 1: { cellWidth: contentW*0.18, halign:'right' }, 2: { cellWidth: contentW*0.32 }, 3: { cellWidth: contentW*0.18, halign:'right' } }, tableWidth: contentW });
                    const afterMetrics = (doc as any).lastAutoTable?.finalY || 80;
                    // Strengths
                    if (r.strengths.length > 0) {
                      doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(27,127,79);
                      doc.text('✅ STRENGTHS', margin, afterMetrics + 6);
                      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(40,40,40);
                      let y = afterMetrics + 11;
                      for (const s of r.strengths.slice(0,12)) {
                        const lines = doc.splitTextToSize(`• ${s}`, contentW - 4);
                        doc.text(lines, margin + 2, y); y += lines.length * 4;
                        if (y > 260) break;
                      }
                      // Risks
                      if (r.risks.length > 0 || r.redFlags.length > 0) {
                        doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(185,28,28);
                        doc.text('⚠ RISKS', margin, y + 4);
                        doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(60,40,40);
                        y += 9;
                        for (const f of r.redFlags.slice(0,5)) {
                          const lines = doc.splitTextToSize(`🚩 [${f.severity}] ${f.label}`, contentW - 4);
                          doc.text(lines, margin + 2, y); y += lines.length * 4;
                          if (y > 275) break;
                        }
                        for (const s of r.risks.filter(x=>!x.startsWith('Hard ')).slice(0,8)) {
                          const lines = doc.splitTextToSize(`• ${s}`, contentW - 4);
                          doc.text(lines, margin + 2, y); y += lines.length * 4;
                          if (y > 275) break;
                        }
                      }
                    }
                    // Footer
                    doc.setFontSize(7); doc.setTextColor(140,140,140);
                    doc.text(`Sector: ${r.sector}  |  Data: ${r.coverage}%  |  ${i+1}/${filtered.length}`, margin, 289);
                  }
                  doc.save(`multibagger-${new Date().toISOString().slice(0,10)}.pdf`);
                }}
                style={{ fontSize:F.xs, fontWeight:700, padding:'5px 12px', borderRadius:7, cursor:'pointer', border:`1px solid ${BORDER}`, background:'transparent', color:'var(--mc-warn)' }}
              >⬇ PDF</button>
            )}

            {/* ── CSV EXPORT ── */}
            {filtered.length > 0 && (
              <button
                title="Export as CSV (Excel-compatible)"
                onClick={async () => {
                  const XLSX = await import('xlsx');
                  const data = filtered.map(r => ({
                    Symbol: r.symbol, Company: r.company, Score: r.score, Grade: r.grade,
                    Bucket: r.bucket, Sector: r.sector,
                    'ROCE %': r.roce, 'ROE %': r.roe, 'OPM %': r.opm, 'CFO/PAT': r.cfoToPat,
                    'FCF Cr': r.fcfAbsolute, 'Rev CAGR %': r.revCagr, 'Profit CAGR %': r.profitCagr,
                    'YOY Sales %': r.yoySalesGrowth, 'YOY Profit %': r.yoyProfitGrowth,
                    'D/E': r.de, 'Pledge %': r.pledge, 'Promoter %': r.promoter, 'Δ Promoter': r.changeInPromoter,
                    'P/E': r.pe, 'PEG': r.peg, 'MCap Cr': r.marketCapCr, 'MoS %': r.marginOfSafety,
                    'FII+DII %': r.fiiPlusDii, 'GPM %': r.gpm, 'ROIC %': r.roic,
                    'Rev Accel pp': r.revenueAcceleration, 'Profit Accel pp': r.profitAcceleration,
                    'Accel Signal': r.accelSignal, 'EV/EBITDA': r.evEbitda, 'FCF Yield %': r.fcfYield,
                    'ROCE Δ 3yr': r.roceExpansion, 'OPM Δ': r.opmExpansion,
                    'KS Pass': (r.killSwitch??[]).filter(t=>t.pass&&t.checks.some(c=>c.pass!==null)).length + '/' +
                              (r.killSwitch??[]).filter(t=>t.checks.some(c=>c.pass!==null)).length,
                    'Rerating': r.reratingBonus, Coverage: r.coverage,
                  }));
                  const ws = XLSX.utils.json_to_sheet(data);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'India');
                  XLSX.writeFile(wb, `india-multibagger-${new Date().toISOString().slice(0,10)}.csv`, { bookType: 'csv' });
                }}
                style={{ fontSize:F.xs, fontWeight:700, padding:'5px 12px', borderRadius:7, cursor:'pointer', border:`1px solid ${BORDER}`, background:'transparent', color:'#06b6d4' }}
              >⬇ CSV</button>
            )}
          </div>

          {/* ── GAP 6: PORTFOLIO CONSTRUCTION PANEL ─────────────────────────── */}
          {(() => {
            // Grade → position size recommendation (SQGLP-based, risk-adjusted)
            const sizeMap: Record<Grade,string> = {'A+':'8–12%','A':'5–8%','B+':'3–5%','B':'1–3%','C':'0%','D':'0%','NR':'0%'};
            const actionMap: Record<Grade,string> = {'A+':'Core position','A':'Standard position','B+':'Pilot / accumulate on dips','B':'Watchlist only','C':'Avoid','D':'Avoid','NR':'No data'};
            const actionColor: Record<Grade,string> = {'A+':GREEN,'A':'#34d399','B+':YELLOW,'B':MUTED,'C':RED,'D':RED,'NR':MUTED};
            // Bucket allocation caps
            const bucketCaps: Record<Bucket, { maxPct: number; label: string; color: string }> = {
              CORE_COMPOUNDER:      { maxPct:40, label:'Core (≤40% total)', color:GREEN },
              EMERGING_MULTIBAGGER: { maxPct:35, label:'Emerging (≤35% total)', color:PURPLE },
              HIGH_RISK:            { maxPct:15, label:'High-Risk (≤15% total)', color:ORANGE },
              MONITOR:              { maxPct:5,  label:'Monitor (≤5% total)', color:MUTED },
            };
            const actionableRows = rows.filter(r => ['A+','A','B+'].includes(r.grade) && r.bucket !== 'MONITOR');
            // Sector concentration
            const sectorCounts = actionableRows.reduce((acc, r) => {
              acc[r.sector] = (acc[r.sector] || 0) + 1;
              return acc;
            }, {} as Record<string,number>);
            const concentratedSectors = Object.entries(sectorCounts).filter(([,c]) => c >= 3);
            // Bucket breakdowns of actionable picks
            const bucketGroups = (['CORE_COMPOUNDER','EMERGING_MULTIBAGGER','HIGH_RISK'] as Bucket[]).map(b => ({
              b, cfg: bucketCaps[b],
              stocks: actionableRows.filter(r => r.bucket === b),
            }));
            return (
              <details style={{marginBottom:16}} open={false}>
                <summary style={{cursor:'pointer',padding:'12px 16px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:10,
                  fontSize:F.md,fontWeight:700,color:PURPLE,userSelect:'none',
                  display:'flex',gap:10,alignItems:'center',listStyle:'none'}}>
                  📐 Portfolio Construction (Gap 6)
                  <span style={{fontSize:F.xs,fontWeight:400,color:MUTED,marginLeft:4}}>
                    {actionableRows.length} actionable picks — allocation guide, sizing, concentration check
                  </span>
                </summary>
                <div style={{padding:'18px',backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderTop:'none',borderRadius:'0 0 10px 10px'}}>
                  {/* Position sizing by grade */}
                  <div style={{marginBottom:18}}>
                    <div style={{fontSize:F.sm,fontWeight:800,color:MUTED,letterSpacing:'0.5px',marginBottom:10}}>POSITION SIZING BY GRADE</div>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      {(['A+','A','B+','B'] as Grade[]).map(g => {
                        const cnt = actionableRows.filter(r => r.grade === g).length;
                        return (
                          <div key={g} style={{padding:'12px 18px',backgroundColor:CARD_BG,borderRadius:8,border:`1px solid ${GRADE_COLOR[g]}30`,minWidth:140}}>
                            <div style={{display:'flex',gap:8,alignItems:'baseline',marginBottom:4}}>
                              <span style={{fontSize:F.xl,fontWeight:900,color:GRADE_COLOR[g]}}>{g}</span>
                              <span style={{fontSize:F.xs,color:MUTED}}>{cnt} stocks</span>
                            </div>
                            <div style={{fontSize:F.md,fontWeight:700,color:TEXT}}>{sizeMap[g]}</div>
                            <div style={{fontSize:F.xs,color:actionColor[g],marginTop:3}}>{actionMap[g]}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {/* Bucket allocation limits */}
                  <div style={{marginBottom:18}}>
                    <div style={{fontSize:F.sm,fontWeight:800,color:MUTED,letterSpacing:'0.5px',marginBottom:10}}>BUCKET ALLOCATION CAPS</div>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      {bucketGroups.map(({b, cfg, stocks}) => (
                        <div key={b} style={{padding:'12px 16px',backgroundColor:CARD_BG,borderRadius:8,border:`1px solid ${cfg.color}30`,flex:'1 1 160px'}}>
                          <div style={{fontSize:F.xs,fontWeight:700,color:cfg.color,marginBottom:4}}>{BUCKET_CONFIG[b].icon} {BUCKET_CONFIG[b].label}</div>
                          <div style={{fontSize:F.lg,fontWeight:800,color:TEXT,marginBottom:2}}>{stocks.length} picks</div>
                          <div style={{fontSize:F.xs,color:MUTED}}>{cfg.label}</div>
                          {stocks.slice(0,3).map(s => (
                            <div key={s.symbol} style={{fontSize:F.xs,color:MUTED,marginTop:3}}>
                              <span style={{color:GRADE_COLOR[s.grade],fontWeight:700}}>{s.grade}</span> {s.symbol} ({sizeMap[s.grade]})
                            </div>
                          ))}
                          {stocks.length > 3 && <div style={{fontSize:F.xs,color:MUTED,marginTop:2}}>+{stocks.length-3} more</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Sector concentration warning */}
                  {concentratedSectors.length > 0 && (
                    <div style={{padding:'12px 16px',backgroundColor:`${ORANGE}10`,border:`1px solid ${ORANGE}30`,borderRadius:8,marginBottom:16}}>
                      <div style={{fontSize:F.sm,fontWeight:800,color:ORANGE,marginBottom:6}}>⚠️ Sector Concentration Risk</div>
                      {concentratedSectors.map(([sector, cnt]) => (
                        <div key={sector} style={{fontSize:F.xs,color:TEXT,marginBottom:3}}>
                          <strong>{sector}</strong>: {cnt} picks in top grades — consider capping at 2 per sector for diversification
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Ownership allocation guidance */}
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:8}}>
                    {(['FOUNDER_CONTROLLED','INSTITUTIONALIZING','MATURE','OWNERSHIP_VACUUM'] as OwnershipCategory[]).map(cat => {
                      const cfg = OWNERSHIP_CONFIG[cat];
                      const cnt = actionableRows.filter(r => r.ownershipCategory === cat).length;
                      return (
                        <div key={cat} style={{padding:'10px 14px',backgroundColor:CARD_BG,borderRadius:8,border:`1px solid ${cfg.color}20`}}>
                          <div style={{fontSize:F.xs,fontWeight:700,color:cfg.color}}>{cfg.icon} {cfg.label}</div>
                          <div style={{fontSize:F.xs,color:MUTED,marginTop:2}}>{cnt} picks · {cfg.allocation}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </details>
            );
          })()}

          {/* PATCH 0367 — India export toolbar. Filtered tickers from `filtered`.
              Builds ticker -> company map for Screener.in name-based matching
              (NSE symbols like '360ONE' don't match Screener fuzzy search;
              'Three Sixty One Capital' / '360 ONE WAM Ltd' does). */}
          {filtered.length > 0 && (() => {
            const tickerCompanyMap: Record<string, string> = {};
            for (const r of filtered) {
              if (r.symbol && r.company) tickerCompanyMap[r.symbol.toUpperCase()] = r.company;
            }
            return (
              <div style={{ margin: '10px 0' }}>
                <TickerExportToolbar
                  tickers={filtered.map(r => r.symbol).filter(Boolean)}
                  exchange="NSE"
                  filenameHint="multibagger-india"
                  tickerCompanyMap={tickerCompanyMap}
                  compact
                />
              </div>
            );
          })()}

          {/* Table header */}
          <div style={{display:'grid',gridTemplateColumns:'130px 130px 65px 90px 96px 86px 120px 1fr 76px',gap:8,padding:'10px 14px',fontSize:F.xs,fontWeight:700,letterSpacing:'0.6px',color:MUTED,borderBottom:`1px solid ${BORDER}`}}>
            {/* Clickable sort headers */}
            <span>TICKER</span><span>COMPANY</span>
            <span onClick={()=>handleSort('score')} style={{cursor:'pointer',userSelect:'none',color:sortField==='score'?ACCENT:MUTED}}>SCORE{sortIcon('score')}</span>
            <span>GRADE</span>
            <span onClick={()=>handleSort('pe')} style={{cursor:'pointer',userSelect:'none',color:sortField==='pe'||sortField==='peg'?YELLOW:MUTED}}>P/E{sortIcon('pe')} · <span onClick={e=>{e.stopPropagation();handleSort('peg')}} style={{cursor:'pointer'}}>PEG{sortIcon('peg')}</span></span>
            <span style={{color:guidanceMode?'var(--mc-warn)':MUTED}}>GUIDANCE{!guidanceMode&&<span style={{fontSize:9,fontWeight:400}}> ↑📡</span>}</span>
            <span>DECISION STRIP</span>
            <span onClick={()=>handleSort('revenueAcceleration')} style={{cursor:'pointer',userSelect:'none',color:sortField==='revenueAcceleration'?GREEN:MUTED}}>SQGLP PILLARS{sortIcon('revenueAcceleration')}</span>
            <span onClick={()=>handleSort('marketCapCr')} style={{cursor:'pointer',userSelect:'none',color:sortField==='marketCapCr'?'var(--mc-warn)':MUTED}}>COV{sortIcon('marketCapCr')}</span>
          </div>

          {/* PATCH 1101d — Empty-state diagnostic. When the filter chain reduces
              the row list to zero but rows are loaded, surface which filters
              are active + a one-click reset, so silent zero-row states no
              longer look like a phantom data loss. */}
          {filtered.length === 0 && rows.length > 0 && (() => {
            const active: string[] = [];
            if (goodOnly) active.push('Good Only');
            if (!gradeFilter.has('ALL')) active.push(`Grade: ${Array.from(gradeFilter).join(', ')}`);
            if (bucketFilter !== 'ALL') active.push(`Bucket: ${bucketFilter}`);
            if (sectorFilter !== 'ALL') active.push(`Sector: ${sectorFilter}`);
            if (aiTierFilter !== 'ALL') active.push(`AI tier: ${aiTierFilter}`);
            if (fraudFilter !== 'ALL') active.push(`Fraud: ${fraudFilter}`);
            if (accelOnly) active.push('Accelerating');
            if (fcfOnly) active.push('FCF+');
            if (discoveryOnly) active.push('Discovery <15%');
            if (dmaConfirmedOnly) active.push('50/200 DMA ↑');
            if (inflectionOnly) active.push('Inflection');
            if (convictionOnly) active.push('Conviction');
            if (peMax !== 'ALL') active.push(`PE ≤ ${peMax}`);
            if (pegMax !== 'ALL') active.push(`PEG ≤ ${pegMax}`);
            if (indQualityMin !== 'ALL') active.push(`Q50 ≥ ${indQualityMin}`);
            if (indRoceMin !== 'ALL') active.push(`ROCE ≥ ${indRoceMin}%`);
            if (indCfoMin !== 'ALL') active.push(`CFO/PAT ≥ ${indCfoMin}×`);
            if (indDecisionFilter !== 'ALL') active.push(`Decision: ${indDecisionFilter}`);
            if (guidanceMode && guidanceTier !== 'ALL') active.push(`Guidance tier: ${guidanceTier}`);
            return (
              <div style={{padding:'24px 18px',textAlign:'center',backgroundColor:CARD_BG,borderRadius:8,margin:'14px 0',border:`1px dashed ${BORDER}`}}>
                <div style={{fontSize:F.md,color:TEXT,fontWeight:700,marginBottom:8}}>No stocks match the current filters</div>
                <div style={{fontSize:F.sm,color:MUTED,marginBottom:12,lineHeight:1.5}}>
                  {active.length > 0
                    ? <>Active filters: <strong style={{color:YELLOW}}>{active.join(' · ')}</strong></>
                    : <>All filters set to All — but no rows after sort/grade gate. Try reloading the CSV.</>}
                </div>
                {active.length > 0 && (
                  <button onClick={() => {
                    setGoodOnly(false);
                    setGradeFilter(new Set(['ALL']));
                    setBucketFilter('ALL');
                    setSectorFilter('ALL');
                    setAiTierFilter('ALL');
                    setFraudFilter('ALL');
                    setAccelOnly(false);
                    setFcfOnly(false);
                    setDiscoveryOnly(false);
                    setDmaConfirmedOnly(false);
                    setInflectionOnly(false);
                    setConvictionOnly(false);
                    setPeMax('ALL');
                    setPegMax('ALL');
                    setIndQualityMin('ALL');
                    setIndRoceMin('ALL');
                    setIndCfoMin('ALL');
                    setIndDecisionFilter('ALL');
                    setGuidanceTier('ALL');
                  }} style={{padding:'8px 18px',borderRadius:8,border:`1px solid ${ACCENT}50`,background:`${ACCENT}14`,color:ACCENT,fontSize:F.sm,fontWeight:700,cursor:'pointer'}}>
                    Clear all filters
                  </button>
                )}
              </div>
            );
          })()}

          {filtered.map((r,idx)=>{
            const isExp=expandAll || expRow===r.symbol;
            // PATCH 1101d — null-safe redFlags access (Screener CSV gaps).
            const hasCrit=(r.redFlags ?? []).some(f=>f.severity==='CRITICAL');
            return (
              <div key={r.symbol+idx} style={{borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                <button onClick={()=>setExpRow(isExp?null:r.symbol)} style={{width:'100%',background:isExp?CARD_BG:'transparent',border:'none',cursor:'pointer',textAlign:'left',padding:'12px 14px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'130px 130px 65px 90px 96px 86px 180px 1fr 76px',gap:8,alignItems:'center'}}>
                    {/* Ticker + bucket + accel badge */}
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      <div style={{display:'flex',alignItems:'center',gap:5}}>
                        <span style={{fontSize:F.lg,fontWeight:800,color:hasCrit?RED:r.bucket==='MONITOR'?MUTED:TEXT}}>{r.symbol}</span>
                        {idx<3&&r.bucket!=='MONITOR'&&<span style={{fontSize:F.md}}>⭐</span>}
                        {/* PATCH 1050 — AI guidance score chip from cache, shows without expanding row */}
                        {(() => {
                          const ai = aiGuidanceMap[(r.symbol || '').toUpperCase()];
                          if (!ai) return null;
                          const c = ai.tier === 'EXCELLENT' ? '#10B981' : ai.tier === 'POSITIVE' ? '#34D399' : ai.tier === 'NEUTRAL' ? '#94A3B8' : ai.tier === 'CAUTIOUS' ? '#F59E0B' : ai.tier === 'NEGATIVE' ? '#EF4444' : '#6B7280';
                          const ic = ai.tier === 'EXCELLENT' ? '🚀' : ai.tier === 'POSITIVE' ? '▲' : ai.tier === 'NEUTRAL' ? '●' : ai.tier === 'CAUTIOUS' ? '▽' : ai.tier === 'NEGATIVE' ? '⚠' : '◌';
                          const days = Math.floor((Date.now() - ai.fetchedAt) / 86_400_000);
                          return (
                            <span title={`AI Guidance ${ai.tier} (${ai.score>=0?'+':''}${ai.score.toFixed(2)}) · ${ai.period} · fetched ${days}d ago\n${ai.summary}`} style={{fontSize:9,fontWeight:800,color:c,border:`1px solid ${c}60`,backgroundColor:`${c}14`,padding:'1px 5px',borderRadius:3,letterSpacing:0.3}}>🤖 {ic} {ai.score>=0?'+':''}{ai.score.toFixed(2)}</span>
                          );
                        })()}
                        {/* PATCH 0272 — Conviction Beats overlay badge. Amber 🏆 means
                            this ticker is on the institutional Conviction Beats bench
                            (synced from /earnings-opportunities BLOCKBUSTER/STRONG output). */}
                        {convictionSet.has((r.symbol || '').toUpperCase()) && (
                          <span
                            title="On Conviction Beats bench (BLOCKBUSTER/STRONG earnings)"
                            style={{
                              fontSize: 9, fontWeight: 800, color: 'var(--mc-warn)',
                              border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', backgroundColor: 'rgba(245,158,11,0.10)',
                              padding: '1px 5px', borderRadius: 3, letterSpacing: 0.3,
                            }}
                          >🏆 CB</span>
                        )}
                        {/* AUDIT_100 #52 — Portfolio attribution. If user already
                            holds this ticker show OWN/Δ chip so they don't double-buy
                            without seeing the existing position. */}
                        {(() => {
                          const h = portfolioMap.get((r.symbol || '').toUpperCase());
                          if (!h) return null;
                          const wt = typeof h.weight === 'number' ? `${h.weight.toFixed(1)}%` : '';
                          const pnl = typeof h.pnlPercent === 'number'
                            ? `${h.pnlPercent >= 0 ? '+' : ''}${h.pnlPercent.toFixed(1)}%` : '';
                          const tip = `In your portfolio${wt ? ` · weight ${wt}` : ''}${pnl ? ` · P&L ${pnl}` : ''}. Open /portfolio to view.`;
                          return (
                            <span title={tip} style={{
                              fontSize: 9, fontWeight: 800,
                              color: (h.pnlPercent ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)',
                              border: '1px solid currentColor',
                              padding: '1px 5px', borderRadius: 3, letterSpacing: 0.3,
                              backgroundColor: 'rgba(16,185,129,0.08)',
                            }}>💼 OWN{wt && ` ${wt}`}{pnl && ` ${pnl}`}</span>
                          );
                        })()}
                      </div>
                      {/* Bucket badge */}
                      <span style={{fontSize:F.xs,fontWeight:700,color:BUCKET_CONFIG[r.bucket].color,border:`1px solid ${BUCKET_CONFIG[r.bucket].color}40`,padding:'1px 5px',borderRadius:3,width:'fit-content'}}>
                        {BUCKET_CONFIG[r.bucket].icon} {BUCKET_CONFIG[r.bucket].label.split(' ').slice(0,2).join(' ')}
                      </span>
                      {/* Ownership category badge */}
                      {r.ownershipCategory && (
                        <span title={OWNERSHIP_CONFIG[r.ownershipCategory].strategy} style={{fontSize:9,fontWeight:700,color:OWNERSHIP_CONFIG[r.ownershipCategory].color,border:`1px solid ${OWNERSHIP_CONFIG[r.ownershipCategory].color}40`,padding:'1px 4px',borderRadius:3,width:'fit-content'}}>
                          {OWNERSHIP_CONFIG[r.ownershipCategory].icon} {r.ownershipCategory === 'FOUNDER_CONTROLLED' ? 'Founder' : r.ownershipCategory === 'INSTITUTIONALIZING' ? 'Institutnlzg' : r.ownershipCategory === 'MATURE' ? 'Mature' : 'Vac⚠'}
                        </span>
                      )}
                      {/* PATCH 0313 — Governance Watch badge. Fires when the
                          pump-and-dump fingerprint is present (promoter ≤25%,
                          FII+DII ≤5%, mcap <₹2000Cr). Composite score is
                          capped at 65 in this state. */}
                      {(r as any).governanceWatch && (
                        <span
                          title={`GOVERNANCE WATCH: classic operator-driven small-cap setup (low promoter + zero institutional + small mcap). Score capped at 65 regardless of fundamentals because the financial quality itself can't be independently verified without institutional auditor pressure.`}
                          style={{
                            fontSize: 9, fontWeight: 800, color: 'var(--mc-bearish)',
                            border: '1px solid color-mix(in srgb, var(--mc-bearish) 38%, transparent)',
                            backgroundColor: 'rgba(239,68,68,0.12)',
                            padding: '1px 4px', borderRadius: 3, width: 'fit-content',
                            letterSpacing: 0.3,
                          }}
                        >🛑 GOV⚠</span>
                      )}
                      {/* PATCH 0326 — Forensic pump-score chip. Visible on
                          row when forensic signals fire. Hover shows the
                          individual flags. Red ≥5 = CRITICAL, orange ≥3 =
                          HIGH, yellow ≥1 = soft signal. */}
                      {(r as any).pumpScore > 0 && (() => {
                        const ps = (r as any).pumpScore;
                        const flags = ((r as any).pumpFlags as string[]) || [];
                        const tone = ps >= 5 ? '#EF4444' : ps >= 3 ? '#F97316' : '#F59E0B';
                        const label = ps >= 5 ? `🔥 PUMP ${ps}` : ps >= 3 ? `⚠ PUMP ${ps}` : `· pump ${ps}`;
                        return (
                          <span
                            title={`Forensic pump-detector: ${ps} signals fired. ${flags.length > 0 ? '\n\n' + flags.slice(0, 6).map(f => '• ' + f).join('\n') : ''}`}
                            style={{
                              fontSize: 9, fontWeight: 800, color: tone,
                              border: `1px solid ${tone}60`,
                              backgroundColor: `${tone}14`,
                              padding: '1px 4px', borderRadius: 3, width: 'fit-content',
                              letterSpacing: 0.3,
                            }}
                          >{label}</span>
                        );
                      })()}
                      {/* Signals: inflection/trigger/trajectory/rerating */}
                      <div style={{display:'flex',gap:3,flexWrap:'wrap',marginTop:2}}>
                        {r.inflectionSignal&&<span title="Early inflection phase: low-base high profit growth" style={{fontSize:9,fontWeight:800,color:'var(--mc-warn)',border:'1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)',padding:'0 4px',borderRadius:3}}>💥 INFLECT</span>}
                        {r.triggerBonus>=10&&<span title={`Trigger bonus +${r.triggerBonus}: turnaround/new engine/industry shift proxy`} style={{fontSize:9,fontWeight:700,color:'var(--mc-bullish)',border:'1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)',padding:'0 4px',borderRadius:3}}>⚡+{r.triggerBonus}</span>}
                        {r.trajectoryScore>20&&<span title={`Trajectory +${r.trajectoryScore.toFixed(0)}pp above historical`} style={{fontSize:9,fontWeight:700,color:'#38bdf8',border:'1px solid #38bdf840',padding:'0 4px',borderRadius:3}}>↑T+{r.trajectoryScore.toFixed(0)}</span>}
                        {r.trajectoryScore<-20&&<span title={`Trajectory ${r.trajectoryScore.toFixed(0)}pp below historical`} style={{fontSize:9,color:RED}}>↓T{r.trajectoryScore.toFixed(0)}</span>}
                        {r.reratingBonus!==0&&<span style={{fontSize:9,color:r.reratingBonus>0?GREEN:RED}}>{r.reratingBonus>0?'↑':'↓'}{Math.abs(r.reratingBonus)}r</span>}
                      </div>
                    </div>

                    {/* Company */}
                    <span style={{fontSize:F.sm,color:MUTED,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.company||r.sector}</span>

                    {/* Score */}
                    <span style={{fontSize:F.h2,fontWeight:900,color:GRADE_COLOR[r.grade]??MUTED}}>{r.score}</span>

                    {/* PATCH 1101e — Wrap Grade chip + 1101a NOT A SETUP / NEVER
                        BUY chip in a single grid cell so column count stays at
                        9 and the SQGLP pillar block (col 8) doesn't wrap. */}
                    <div style={{display:'flex',flexDirection:'column',gap:3,alignItems:'flex-start'}}>
                      {/* Grade */}
                      <span style={{fontSize:F.md,fontWeight:800,padding:'4px 8px',borderRadius:6,color:GRADE_COLOR[r.grade],backgroundColor:`${GRADE_COLOR[r.grade]}18`,border:`1px solid ${GRADE_COLOR[r.grade]}30`,textAlign:'center',alignSelf:'stretch'}}>{r.grade}</span>
                      {/* PATCH 1101a — Grade D label split (fraud vs not-a-setup) */}
                      {r.grade === 'D' && (() => {
                        const isFraudFlagged = (r.redFlags ?? []).some(f => f.source && f.source.startsWith('fraud:') && f.severity === 'CRITICAL');
                        if (isFraudFlagged) {
                          return (
                            <span title="Critical fraud-pattern flag fired" style={{fontSize:9,fontWeight:800,padding:'1px 4px',borderRadius:4,color:RED,backgroundColor:`${RED}18`,border:`1px solid ${RED}50`,letterSpacing:'0.3px',whiteSpace:'nowrap',lineHeight:1.2}}>🚨 NEVER BUY</span>
                          );
                        }
                        return (
                          <span title="Doesn't fit megawinner setup — not necessarily a bad business" style={{fontSize:9,fontWeight:700,padding:'1px 4px',borderRadius:4,color:MUTED,backgroundColor:'transparent',border:`1px solid ${MUTED}40`,letterSpacing:'0.3px',whiteSpace:'nowrap',lineHeight:1.2}}>NOT A SETUP</span>
                        );
                      })()}
                    </div>

                    {/* P/E + PEG — always visible for every stock */}
                    {(() => {
                      const pe = r.pe;
                      const peg = r.peg;
                      const mcap = r.marketCapCr;
                      // P/E color: sector-appropriate. Green < sector mid, Orange = mid-high, Red > 2× sector p75
                      const b2 = SBENCH[getSectorKey(r.sector)] ?? SBENCH.DEFAULT;
                      const peColor = pe === undefined ? MUTED :
                        pe < b2.pe[1]   ? GREEN :
                        pe < b2.pe[2]   ? YELLOW :
                        pe > b2.pe[2]*1.5 ? RED : ORANGE;
                      // PEG color: < 1 = green (cheap growth), 1-1.5 = yellow, > 2 = red
                      const pegColor = peg === undefined || peg <= 0 ? MUTED :
                        peg < 1.0 ? GREEN : peg < 1.5 ? YELLOW : peg < 2.5 ? ORANGE : RED;
                      return (
                        <div style={{display:'flex',flexDirection:'column',gap:3}}>
                          {pe !== undefined
                            ? <div style={{display:'flex',alignItems:'baseline',gap:3}}>
                                <span style={{fontSize:F.xs,color:MUTED,fontWeight:600}}>PE</span>
                                <span style={{fontSize:F.md,fontWeight:800,color:peColor}}>{pe.toFixed(0)}×</span>
                              </div>
                            : <span style={{fontSize:F.xs,color:`${MUTED}60`}}>PE —</span>
                          }
                          {peg !== undefined && peg > 0
                            ? <div style={{display:'flex',alignItems:'baseline',gap:3}}>
                                <span style={{fontSize:F.xs,color:MUTED,fontWeight:600}}>PEG</span>
                                <span style={{fontSize:F.md,fontWeight:800,color:pegColor}}>{peg.toFixed(2)}</span>
                              </div>
                            : <span style={{fontSize:F.xs,color:`${MUTED}60`}}>PEG —</span>
                          }
                          {mcap !== undefined &&
                            <span style={{fontSize:9,color:MUTED}}>
                              {mcap >= 100000 ? `₹${(mcap/100000).toFixed(1)}L Cr` :
                               mcap >= 1000   ? `₹${(mcap/1000).toFixed(1)}k Cr`  :
                                                `₹${mcap.toFixed(0)}Cr`}
                            </span>
                          }
                          {/* PATCH 0166 — MC-Efficiency = rev_growth × ROCE / log10(MCap_Cr)
                              Higher = small company growing fast at high ROCE = great compounding setup.
                              ROCE/FCF Quality = ROCE / (FCF/Revenue) — high ROCE backed by strong FCF wins. */}
                          {(() => {
                            const roce = (r as any).roce as number | undefined;
                            const revG = (r as any).revenue_growth as number | undefined ?? (r as any).rev_g as number | undefined;
                            const fcf = (r as any).fcfAbsolute as number | undefined;
                            const rev = (r as any).revenue_cr as number | undefined ?? (r as any).sales as number | undefined;
                            if (roce != null && revG != null && mcap != null && mcap > 0) {
                              const denom = Math.log10(Math.max(mcap, 10));
                              const mcEff = (revG * roce) / denom;
                              const col = mcEff >= 200 ? GREEN : mcEff >= 100 ? YELLOW : mcEff >= 50 ? ORANGE : MUTED;
                              return (
                                <span title={`MC-Efficiency = revG × ROCE / log(MCap). ${mcEff.toFixed(0)} (rev growth ${revG.toFixed(0)}% × ROCE ${roce.toFixed(0)}% / log MCap ${denom.toFixed(2)}).`}
                                  style={{fontSize:9, color: col, fontWeight: 700, marginTop: 2}}>
                                  MC-Eff {mcEff.toFixed(0)}
                                </span>
                              );
                            }
                            return null;
                          })()}
                          {(() => {
                            const roce = (r as any).roce as number | undefined;
                            const fcf = (r as any).fcfAbsolute as number | undefined;
                            const rev = (r as any).revenue_cr as number | undefined ?? (r as any).sales as number | undefined;
                            if (roce != null && fcf != null && rev != null && rev > 0) {
                              const fcfPct = (fcf / rev) * 100;
                              const ratio = fcfPct > 0 ? roce / fcfPct : 0;
                              const col = fcfPct >= 8 ? GREEN : fcfPct >= 3 ? YELLOW : RED;
                              return (
                                <span title={`ROCE/FCF Quality. ROCE ${roce.toFixed(0)}%, FCF/Rev ${fcfPct.toFixed(1)}% → ratio ${ratio.toFixed(2)} (closer-to-1 = high-quality earnings backed by cash).`}
                                  style={{fontSize:9, color: col, fontWeight: 700}}>
                                  ROCE/FCF {fcfPct.toFixed(1)}%
                                </span>
                              );
                            }
                            return null;
                          })()}
                          {/* VALUATION-B — Inline fair-value strip from 10 valuation models.
                              Shows FV, MoS%, and how many models agree. Click → /valuations?symbol=X */}
                          <div style={{ marginTop: 3, paddingTop: 3, borderTop: '1px dashed rgba(255,255,255,0.06)' }}>
                            <ValuationStrip
                              row={r}
                              onClick={() => {
                                if (typeof window !== 'undefined') {
                                  window.location.href = `/valuations?symbol=${encodeURIComponent(r.symbol)}`;
                                }
                              }}
                            />
                          </div>
                        </div>
                      );
                    })()}

                    {/* Guidance column — always shown, populated when guidance mode active */}
                    {!guidanceMode
                      ? <div style={{fontSize:F.xs,color:MUTED,textAlign:'center'}}>—</div>
                      : (() => {
                      const rAny = r as ExcelResult & { guidanceScore?: number; guidanceAdj?: number };
                      const gs = rAny.guidanceScore;
                      const adj = rAny.guidanceAdj ?? 0;
                      const articleCount = guidanceArticleCounts[r.symbol] ?? 0;
                      // -1 = no matching articles found
                      if (gs === undefined || gs === -1) {
                        return <div style={{fontSize:F.xs,color:MUTED,fontStyle:'italic'}}>—<br/><span style={{fontSize:9}}>no data</span></div>;
                      }
                      const gColor = gs >= 0.7 ? GREEN : gs <= 0.3 ? RED : gs >= 0.55 ? '#34d399' : gs <= 0.45 ? ORANGE : MUTED;
                      const gLabel = gs >= 0.85 ? '▲ Strong' : gs >= 0.70 ? '▲ Positive' : gs >= 0.55 ? '↑ Mild +' : gs <= 0.15 ? '▼ Weak' : gs <= 0.30 ? '▼ Negative' : gs <= 0.45 ? '↓ Mild −' : '→ Neutral';
                      return (
                        <div style={{display:'flex',flexDirection:'column',gap:2}}>
                          <div style={{display:'flex',alignItems:'center',gap:4}}>
                            <div style={{width:32,height:5,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:2,overflow:'hidden'}}>
                              <div style={{height:'100%',width:`${Math.round(gs*100)}%`,backgroundColor:gColor,borderRadius:2}}/>
                            </div>
                            <span style={{fontSize:F.xs,fontWeight:700,color:gColor}}>{gs.toFixed(1)}</span>
                          </div>
                          <span style={{fontSize:9,color:gColor,fontWeight:600}}>{gLabel}{adj !== 0 ? ` (${adj>0?'+':''}${adj}pts)` : ''}</span>
                          <span style={{fontSize:9,color:MUTED}}>
                            {articleCount > 0 ? `${articleCount} article${articleCount!==1?'s':''}` : '📊 trajectory proxy'}
                          </span>
                        </div>
                      );
                    })()}

                    {/* Decision strip — PATCH 1052: institutional-density layout.
                        Removed the 60px maxWidth + nowrap on the detail span so the
                        full "+32% vs DMA" / "PEG 0.6" / "FII+DII 28%" text is visible
                        instead of being chopped to "+32% v..." Layout now uses
                        column-gap label-and-detail with detail wrapping when needed. */}
                    <div style={{display:'flex',flexDirection:'column',gap:3,minWidth:0}}>
                      {([
                        {key:'survival',   s:r.decisionStrip.survival},
                        {key:'acceleration',s:r.decisionStrip.acceleration},
                        {key:'valuation',  s:r.decisionStrip.valuation},
                        {key:'discovery',  s:r.decisionStrip.discovery},
                        {key:'technical',  s:r.decisionStrip.technical},
                      ] as const).map(({key,s})=>(
                        <div key={key} title={`${s.label}: ${s.detail}`} style={{display:'flex',alignItems:'baseline',gap:4,minWidth:0}}>
                          <div style={{width:8,height:8,borderRadius:2,backgroundColor:s.pass?GREEN:RED,flexShrink:0,marginTop:3}}/>
                          <span style={{fontSize:9,color:s.pass?`${GREEN}CC`:`${RED}CC`,fontWeight:700,letterSpacing:0.2,flexShrink:0}}>{s.label}</span>
                          <span style={{fontSize:9,color:MUTED,wordBreak:'break-word',whiteSpace:'normal',lineHeight:1.25,fontVariantNumeric:'tabular-nums'}}>{s.detail}</span>
                        </div>
                      ))}
                    </div>

                    {/* SQGLP pillar bars */}
                    <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                      {r.pillarScores.map(p=>(
                        <div key={p.id} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2,minWidth:32}}>
                          <span style={{fontSize:F.sm,fontWeight:700,color:p.color}}>{p.score}</span>
                          <div style={{width:26,height:5,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:2,overflow:'hidden'}}>
                            <div style={{height:'100%',width:`${p.score}%`,backgroundColor:p.color}}/>
                          </div>
                          <span style={{fontSize:9,color:MUTED}}>{p.label.split(' ')[0].slice(0,4)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Coverage + kill-switch + score delta */}
                    <div style={{display:'flex',flexDirection:'column',gap:2}}>
                      <span style={{fontSize:F.sm,color:r.coverage>=70?GREEN:r.coverage>=50?YELLOW:ORANGE}}>{r.coverage}%</span>
                      {r.redFlags.length>0&&<span style={{fontSize:F.xs,color:hasCrit?RED:ORANGE}}>⚠{r.redFlags.length}</span>}
                      {/* Kill-switch badge — N/8 tests pass */}
                      {(() => {
                        const ks = r.killSwitch ?? [];
                        const tested = ks.filter(t => t.checks.some(c=>c.pass!==null));
                        if (tested.length < 4) return null;
                        const passed = tested.filter(t=>t.pass).length;
                        const col = passed>=6?GREEN:passed>=4?YELLOW:ORANGE;
                        return <span title="Kill-switch: N/8 tests pass" style={{fontSize:9,fontWeight:700,color:col}}>🛡{passed}/{tested.length}</span>;
                      })()}
                      {/* PATCH 0056: Reinvestment Engine verdict (data from patch 0055) */}
                      {r.reinvestment && r.reinvestment.verdict !== 'NA' && (() => {
                        const verdict = r.reinvestment.verdict;
                        const score = r.reinvestment.score;
                        const col = verdict === 'COMPOUNDING' ? GREEN
                                  : verdict === 'BUILDING' ? '#22d3ee'
                                  : verdict === 'STALLING' ? RED
                                  : MUTED;
                        const icon = verdict === 'COMPOUNDING' ? '⚙' : verdict === 'BUILDING' ? '↗' : verdict === 'STALLING' ? '✗' : '·';
                        const lbl = verdict === 'COMPOUNDING' ? 'COMP' : verdict === 'BUILDING' ? 'BUILD' : verdict === 'STALLING' ? 'STALL' : 'ord';
                        return (
                          <span title={`Reinvestment Engine ${score}/100 — ${r.reinvestment.note}`}
                                style={{fontSize:9,fontWeight:700,color:col}}>
                            {icon} {lbl} {score}
                          </span>
                        );
                      })()}
                      {/* PATCH 0056: Dilution verdict (data from patch 0055) */}
                      {r.dilution && r.dilution.verdict !== 'NA' && r.dilution.verdict !== 'NEUTRAL' && (() => {
                        const v = r.dilution.verdict;
                        const drag = r.dilution.drag_pp;
                        const col = v === 'SEVERELY_DILUTIVE' ? RED
                                  : v === 'DILUTIVE' ? ORANGE
                                  : GREEN;
                        const icon = v === 'SEVERELY_DILUTIVE' || v === 'DILUTIVE' ? '⤓' : '⤒';
                        const lbl = v === 'SEVERELY_DILUTIVE' ? 'DIL!!' : v === 'DILUTIVE' ? 'DIL' : 'ACCR';
                        return (
                          <span title={`Dilution: ${r.dilution.note}`}
                                style={{fontSize:9,fontWeight:700,color:col}}>
                            {icon} {lbl} {drag !== null ? (drag > 0 ? '+' : '') + drag.toFixed(1) + 'pp' : ''}
                          </span>
                        );
                      })()}
                      {/* PATCH 0056: Framework data coverage indicator */}
                      {r.framework_coverage && (() => {
                        const conf = r.framework_coverage.confidence;
                        const pct = r.framework_coverage.coverage_pct;
                        const col = conf === 'HIGH' ? GREEN : conf === 'MEDIUM' ? YELLOW : ORANGE;
                        return (
                          <span title={`Framework coverage: ${pct}% of ideal data present. ${r.framework_coverage.note}`}
                                style={{fontSize:9,fontWeight:600,color:col,opacity:0.85}}>
                            ◔ {pct}%
                          </span>
                        );
                      })()}
                      {/* PATCH 0058: Archetype match badge — most important addition */}
                      {r.archetype && r.archetype.strength !== 'NO_MATCH' && (() => {
                        const s = r.archetype.strength;
                        const col = s === 'STRONG' ? PURPLE : s === 'PARTIAL' ? '#22d3ee' : MUTED;
                        const icon = s === 'STRONG' ? '🎯' : s === 'PARTIAL' ? '◓' : '○';
                        const archShort = (r.archetype.closest_archetype ?? '').replace(/\s\d+$/, '');
                        return (
                          <span title={`Closest historical 100× archetype: ${r.archetype.closest_archetype} (${r.archetype.ten_year_return_x}×). Match strength ${s}. Score ${r.archetype.match_score}/100.\n\n${r.archetype.verdict}`}
                                style={{fontSize:9,fontWeight:700,color:col}}>
                            {icon} {archShort.length > 14 ? archShort.slice(0, 12) + '…' : archShort} ({r.archetype.match_score})
                          </span>
                        );
                      })()}
                      {/* PATCH 0327 — Score-change vs prev upload, upgraded to
                          institutional-visible chip. Shows prior score in
                          hover tooltip. "NEW" chip for stocks with no prior. */}
                      {(() => {
                        const prev = prevScoreMap[r.symbol];
                        if (prev === undefined) {
                          return (
                            <span
                              title="No prior score on file — this is a new entry since the last Multibagger upload."
                              style={{
                                fontSize: 9, fontWeight: 700, color: PURPLE,
                                border: `1px solid ${PURPLE}60`,
                                backgroundColor: `${PURPLE}14`,
                                padding: '1px 5px', borderRadius: 3,
                                letterSpacing: 0.3,
                              }}
                            >NEW</span>
                          );
                        }
                        const delta = r.score - prev;
                        if (delta === 0) {
                          return (
                            <span
                              title={`Score unchanged from prior upload (${prev}).`}
                              style={{ fontSize: 9, fontWeight: 700, color: MUTED }}
                            >=</span>
                          );
                        }
                        const tone = delta > 0 ? GREEN : RED;
                        const arrow = delta > 0 ? '▲' : '▼';
                        return (
                          <span
                            title={`Score changed from ${prev} → ${r.score} since prior upload (${delta > 0 ? '+' : ''}${delta} pts).`}
                            style={{
                              fontSize: 10, fontWeight: 800, color: tone,
                              border: `1px solid ${tone}60`,
                              backgroundColor: `${tone}14`,
                              padding: '1px 6px', borderRadius: 3,
                              letterSpacing: 0.3,
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >{arrow} {delta > 0 ? '+' : ''}{delta}</span>
                        );
                      })()}
                    </div>
                  </div>
                </button>

                {isExp&&(
                  <div style={{padding:'16px 14px 20px',backgroundColor:`${CARD_BG}CC`,borderTop:`1px solid ${BORDER}`}}>
                    {/* PATCH 0347 — Decision logbook bar (per-stock BUY/WATCH/NEUTRAL/REJECTED + reason) */}
                    <DecisionBar symbol={r.symbol} company={r.company} market="IN" score={r.score} grade={r.grade} currentPrice={(r as any).cmp} bump={bumpDecisions} />
                    {/* PATCH 1056 — Two-column layout. LEFT = numbers / audit / fraud
                        (the analytical "facts" column). RIGHT = AI guidance + analysis
                        + framework (the narrative "judgment" column). Reduces vertical
                        scroll by ~50% on wide screens; gracefully stacks to 1-col
                        below 1100px so mobile/narrow windows still work. */}
                    <div style={{display:'grid',gridTemplateColumns:'minmax(280px, 1fr) minmax(360px, 1.4fr)',gap:18,alignItems:'flex-start'}}>
                      {/* ═════ LEFT COLUMN — METRICS + SCORE AUDIT + FRAUD RISK ═════ */}
                      <div style={{display:'flex',flexDirection:'column',gap:14,minWidth:0}}>
                      {/* Metrics by group */}
                      <div>
                        <div style={{fontSize:F.sm,color:MUTED,fontWeight:700,letterSpacing:'0.8px',marginBottom:8}}>ALL METRICS</div>
                        {METRICS.filter(([field])=>(r[field]!==undefined&&r[field]!==null)).map(([field,label,group])=>{
                          const v=r[field] as number;
                          const isPercent=label.includes('%');
                          const isX=label.includes('x')||field==='peg'; // PATCH 1029: PEG label has no 'x' suffix; treat as multiplier
                          const isCr=label.includes('Cr');
                          return (
                            <div key={String(field)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:F.md,padding:'5px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                              <span style={{color:MUTED}}>{label}<span style={{fontSize:F.xs,color:`${MUTED}70`,marginLeft:4}}>[{group}]</span></span>
                              <span style={{color:TEXT,fontWeight:700}}>{isCr?`₹${v.toLocaleString()}`:isX?`${v.toFixed(field==='de'||field==='cfoToPat'||field==='peg'||field==='netDebtEbitda'||field==='opLeverageRatio'?2:1)}×`:`${v.toFixed(1)}%`}</span>
                            </div>
                          );
                        })}
                      </div>
                      {/* PATCH 0316 — SCORING AUDIT BREAKDOWN. Shows the caps
                          that fired and the count of each severity tier so
                          the user can see at-a-glance why a stock landed at
                          its score (e.g. "1 STRUCTURAL HIGH → cap 60"). */}
                      {(() => {
                        const crit = r.redFlags.filter(f => f.severity === 'CRITICAL').length;
                        const structHigh = r.redFlags.filter(f => f.severity === 'HIGH' && (f.kind ?? 'STRUCTURAL') === 'STRUCTURAL').length;
                        const cycHigh = r.redFlags.filter(f => f.severity === 'HIGH' && f.kind === 'CYCLICAL').length;
                        const meds = r.redFlags.filter(f => f.severity === 'MEDIUM').length;
                        const cap = crit > 0 ? 38
                          : structHigh >= 2 ? 48
                          : structHigh >= 1 ? 60
                          : cycHigh >= 2 ? 62
                          : cycHigh >= 1 ? 72
                          : 100;
                        const govWatch = (r as any).governanceWatch;
                        return (
                          <div style={{marginBottom:12,padding:'10px 12px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:8}}>
                            <div style={{fontSize:F.xs,fontWeight:800,letterSpacing:'0.7px',color:ACCENT,marginBottom:8}}>📋 SCORE AUDIT — WHY {r.score}?</div>
                            <div style={{display:'flex',flexWrap:'wrap',gap:8,fontSize:F.xs}}>
                              <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${BORDER}`,color:TEXT}}>Composite: <strong>{r.score}</strong> · Grade <strong style={{color:GRADE_COLOR[r.grade]}}>{r.grade}</strong></span>
                              {crit > 0 && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${RED}60`,backgroundColor:`${RED}14`,color:RED,fontWeight:700}}>{crit} CRITICAL · cap 38</span>}
                              {structHigh > 0 && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${ORANGE}60`,backgroundColor:`${ORANGE}14`,color:ORANGE,fontWeight:700}}>{structHigh} HIGH structural · cap {structHigh>=2?48:60}</span>}
                              {cycHigh > 0 && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${YELLOW}60`,backgroundColor:`${YELLOW}14`,color:YELLOW,fontWeight:700}}>{cycHigh} HIGH cyclical · cap {cycHigh>=2?62:72}</span>}
                              {meds > 0 && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${MUTED}60`,color:MUTED,fontWeight:700}}>{meds} MEDIUM · −{meds*5}</span>}
                              {govWatch && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${RED}60`,backgroundColor:`${RED}14`,color:RED,fontWeight:700}}>🛑 GOVERNANCE WATCH · cap 65</span>}
                              {r.accelSignal === 'DECELERATING' && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${RED}60`,color:RED,fontWeight:700}}>DECELERATING · cap 52</span>}
                              {r.bucket === 'MONITOR' && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${MUTED}60`,color:MUTED,fontWeight:700}}>MONITOR bucket · cap 45</span>}
                              {cap < 100 && (
                                <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${ACCENT}60`,backgroundColor:`${ACCENT}14`,color:ACCENT,fontWeight:700}}>
                                  Active cap: {cap}{r.score < cap ? '' : ' (binding)'}
                                </span>
                              )}
                              {/* PATCH 1030: mcap > ₹20kCr forces grade cap at B (multibagger math floor) — surface it honestly */}
                              {(r.marketCapCr ?? 0) > 20000 && (
                                <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${ORANGE}60`,backgroundColor:`${ORANGE}14`,color:ORANGE,fontWeight:700}}>MCap &gt; ₹20kCr · grade capped at B (multibagger math)</span>
                              )}
                              {cap === 100 && r.redFlags.length === 0 && (r.marketCapCr ?? 0) <= 20000 && (
                                <span style={{padding:'2px 8px',borderRadius:4,color:GREEN,fontWeight:700}}>No red-flag caps active — score is uncapped</span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      {/* PATCH 1045 — FRAUD RISK panel: counts fraud:* flags from PATCH 1044's computeFraudRiskFlags */}
                      {(() => {
                        const fraudFlags = r.redFlags.filter(f => f.source && f.source.startsWith('fraud:'));
                        const critF = fraudFlags.filter(f => f.severity === 'CRITICAL').length;
                        const highF = fraudFlags.filter(f => f.severity === 'HIGH').length;
                        const medF  = fraudFlags.filter(f => f.severity === 'MEDIUM').length;
                        const fraudScore = Math.min(100, critF*30 + highF*15 + medF*5);
                        const FRAUD_RULES_TOTAL = 19; // PATCH 1101j — added C7 revenue-inflation archetype (Rajesh Exports)
                        const passed = FRAUD_RULES_TOTAL - fraudFlags.length;
                        const verdict = critF>=2?'NEVER BUY': critF>=1?'AVOID': highF>=2?'HIGH RISK': highF>=1?'CAUTION': medF>=2?'MINOR FLAGS':'CLEAN';
                        const color = critF>=1?RED: highF>=1?ORANGE: medF>=1?YELLOW:GREEN;
                        return (
                          <div style={{marginTop:14,marginBottom:10,padding:'10px 14px',backgroundColor:`${color}10`,border:`1px solid ${color}40`,borderRadius:8}}>
                            <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                              <span style={{fontSize:F.sm,fontWeight:800,color:color,letterSpacing:'0.5px'}}>🛡 FRAUD RISK</span>
                              <span style={{fontSize:F.md,fontWeight:900,color:color}}>{verdict}</span>
                              <span style={{fontSize:F.xs,color:MUTED,fontWeight:700}}>Score: <strong style={{color:color}}>{fraudScore}/100</strong></span>
                              <span style={{fontSize:F.xs,color:MUTED}}>· {passed}/{FRAUD_RULES_TOTAL} fraud checks passed</span>
                              {critF>0 && <span style={{fontSize:F.xs,padding:'1px 6px',borderRadius:3,backgroundColor:`${RED}20`,color:RED,fontWeight:700}}>{critF} CRITICAL</span>}
                              {highF>0 && <span style={{fontSize:F.xs,padding:'1px 6px',borderRadius:3,backgroundColor:`${ORANGE}20`,color:ORANGE,fontWeight:700}}>{highF} HIGH</span>}
                              {medF>0 && <span style={{fontSize:F.xs,padding:'1px 6px',borderRadius:3,backgroundColor:`${YELLOW}20`,color:YELLOW,fontWeight:700}}>{medF} MEDIUM</span>}
                            </div>
                            {fraudFlags.length === 0 && (
                              <div style={{fontSize:F.xs,color:MUTED,marginTop:4}}>✓ No fraud patterns detected: earnings-without-cash, pledge cascade, smart-money exit, operator/shell, ghost ROCE, banking NPA proxy, debtor buildup, rollup proxy, ICR leverage, microcap stretch — all clean.</div>
                            )}
                            {fraudFlags.length > 0 && (
                              <div style={{marginTop:6}}>
                                {fraudFlags.map((f,i) => (
                                  <div key={i} style={{fontSize:F.xs,color:f.severity==='CRITICAL'?RED:f.severity==='HIGH'?ORANGE:YELLOW,padding:'2px 0'}}>▸ [{f.severity}] {f.label}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      </div>
                      {/* ═════ RIGHT COLUMN — AI GUIDANCE + STRENGTHS/RISKS + FRAMEWORK ═════ */}
                      <div style={{display:'flex',flexDirection:'column',gap:14,minWidth:0}}>
                      {/* PATCH 1052 — Rich AI Guidance panel. Shows full
                          rationale, direct quotes, hard numbers (metric/value/period)
                          and forward catalysts (event/timing) when the row has a
                          cached entry from the Haiku forward-guidance API.
                          Hidden when no AI guidance fetched for this ticker. */}
                      {(() => {
                        const ai = aiGuidanceMap[(r.symbol || '').toUpperCase()];
                        if (!ai) return null;
                        const tierColor = ai.tier === 'EXCELLENT' ? '#10B981' : ai.tier === 'POSITIVE' ? '#34D399' : ai.tier === 'NEUTRAL' ? '#94A3B8' : ai.tier === 'CAUTIOUS' ? '#F59E0B' : ai.tier === 'NEGATIVE' ? '#EF4444' : '#6B7280';
                        const tierIcon = ai.tier === 'EXCELLENT' ? '🚀' : ai.tier === 'POSITIVE' ? '▲' : ai.tier === 'NEUTRAL' ? '●' : ai.tier === 'CAUTIOUS' ? '▽' : ai.tier === 'NEGATIVE' ? '⚠' : '◌';
                        const ageDays = Math.floor((Date.now() - ai.fetchedAt) / 86_400_000);
                        return (
                          <div style={{marginBottom:12,padding:'10px 12px',backgroundColor:`${tierColor}08`,border:`1px solid ${tierColor}30`,borderLeft:`3px solid ${tierColor}`,borderRadius:7}}>
                            <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:6,flexWrap:'wrap'}}>
                              <span style={{fontSize:F.sm,fontWeight:800,color:tierColor,letterSpacing:'0.5px'}}>🤖 AI FORWARD GUIDANCE</span>
                              <span style={{fontSize:F.xs,fontWeight:700,color:tierColor}}>{tierIcon} {ai.tier} · {ai.score >= 0 ? '+' : ''}{ai.score.toFixed(2)}</span>
                              <span style={{fontSize:F.xs,color:MUTED}}>· {ai.period} · fetched {ageDays}d ago</span>
                              {ai.sourceUrl && <a href={ai.sourceUrl} target="_blank" rel="noopener noreferrer" style={{fontSize:F.xs,color:'var(--mc-cyan)',marginLeft:'auto',textDecoration:'none'}}>↗ Source</a>}
                            </div>
                            {(ai.rationale || ai.summary) && (
                              <div style={{fontSize:F.sm,color:TEXT,lineHeight:1.5,marginBottom:8}}>
                                {ai.rationale || ai.summary}
                              </div>
                            )}
                            {Array.isArray(ai.numbers) && ai.numbers.length > 0 && (
                              <div style={{marginTop:8,paddingTop:8,borderTop:`1px dashed ${tierColor}30`}}>
                                <div style={{fontSize:F.xs,fontWeight:700,color:'var(--mc-cyan)',letterSpacing:'0.4px',marginBottom:4}}>📊 NUMBERS</div>
                                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:6}}>
                                  {ai.numbers.map((n,i) => (
                                    <div key={i} style={{fontSize:F.xs,padding:'4px 6px',backgroundColor:CARD2,borderRadius:4,fontVariantNumeric:'tabular-nums'}}>
                                      {n.metric && <span style={{color:MUTED}}>{n.metric}: </span>}
                                      {n.value && <span style={{color:TEXT,fontWeight:700}}>{n.value}</span>}
                                      {n.period && <span style={{color:MUTED,fontSize:9}}> · {n.period}</span>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {Array.isArray(ai.catalysts) && ai.catalysts.length > 0 && (
                              <div style={{marginTop:8,paddingTop:8,borderTop:`1px dashed ${tierColor}30`}}>
                                <div style={{fontSize:F.xs,fontWeight:700,color:'var(--mc-warn)',letterSpacing:'0.4px',marginBottom:4}}>⚡ FORWARD CATALYSTS</div>
                                {ai.catalysts.map((c,i) => (
                                  <div key={i} style={{fontSize:F.xs,color:MUTED,padding:'2px 0',lineHeight:1.4}}>
                                    › <span style={{color:TEXT}}>{c.event}</span>
                                    {c.timing && <span style={{color:'var(--mc-warn)',fontWeight:700}}> · {c.timing}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                            {Array.isArray(ai.quotes) && ai.quotes.length > 0 && (
                              <div style={{marginTop:8,paddingTop:8,borderTop:`1px dashed ${tierColor}30`}}>
                                <div style={{fontSize:F.xs,fontWeight:700,color:'var(--mc-state-persistent)',letterSpacing:'0.4px',marginBottom:4}}>💬 KEY QUOTES (CONCALL)</div>
                                {ai.quotes.map((q,i) => (
                                  <div key={i} style={{fontSize:F.xs,color:MUTED,padding:'4px 0',lineHeight:1.45,borderLeft:`2px solid ${tierColor}30`,paddingLeft:8,marginBottom:3,fontStyle:'italic'}}>
                                    "{q.quote}"{q.speaker && <span style={{color:'var(--mc-state-persistent)',fontStyle:'normal',fontWeight:700}}> — {q.speaker}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
{/* Analysis */}
                      <div>
                        {r.strengths.length>0&&(() => {
                          // PATCH 1056 — Strengths grouped by pillar so 17 bullets aren't
                          // an undifferentiated wall. Heuristic: classify each bullet by
                          // the metric/keyword it cites. Keeps the engine output untouched
                          // — purely a display rollup. Pillars match the SQGLP framework.
                          type Pillar = {key:string;label:string;icon:string;col:string;keys:RegExp};
                          const PILLARS: Pillar[] = [
                            {key:'quality', label:'Quality',         icon:'◆', col:'#a78bfa', keys:/roce|roe|opm|gpm|roic|cfo|fcf|cash|moat|incremental/i},
                            {key:'growth',  label:'Growth & Accel',  icon:'▲', col:'#38bdf8', keys:/cagr|growth|acceler|profit|sales|eps|inflection|breakout|leverage|trajectory|engine/i},
                            {key:'fin',     label:'Balance Sheet',   icon:'■', col:'#34d399', keys:/debt|pledge|d\/e|leverage|interest|coverage|net cash|debt-free/i},
                            {key:'ownership',label:'Ownership',      icon:'◉', col:'#f59e0b', keys:/promoter|fii|dii|founder|institution|insider|conviction|ownership|mnc/i},
                            {key:'value',   label:'Valuation',       icon:'$', col:'#22d3ee', keys:/peg|p\/e|valuation|mos|margin of safety|fcf yield|ev\/ebitda|undervalued/i},
                            {key:'tech',    label:'Trend / Market',  icon:'~', col:'#10b981', keys:/dma|trend|52w|re-rating|technical|near 52w/i},
                            {key:'dna',     label:'DNA / Archetype', icon:'◆', col:'#ef4444', keys:/dna|archetype|bagger|page|astral|avanti|caplin|symphony|bajaj|eicher/i},
                          ];
                          const groups: Record<string,string[]> = Object.fromEntries(PILLARS.map(p=>[p.key,[]]));
                          const orphans: string[] = [];
                          for (const s of r.strengths) {
                            let placed = false;
                            for (const p of PILLARS) {
                              if (p.keys.test(s)) { groups[p.key].push(s); placed = true; break; }
                            }
                            if (!placed) orphans.push(s);
                          }
                          return (
                            <>
                              <div style={{fontSize:F.sm,color:GREEN,fontWeight:700,letterSpacing:'0.8px',marginBottom:6}}>✅ STRENGTHS <span style={{color:MUTED,fontWeight:600,fontSize:F.xs}}>({r.strengths.length})</span></div>
                              {PILLARS.filter(p=>groups[p.key].length>0).map(p=>(
                                <div key={p.key} style={{marginBottom:6}}>
                                  <div style={{fontSize:9,fontWeight:800,color:p.col,letterSpacing:0.4,marginBottom:2}}>{p.icon} {p.label.toUpperCase()} <span style={{color:MUTED,fontWeight:600}}>({groups[p.key].length})</span></div>
                                  {groups[p.key].map((s,i)=><div key={i} style={{fontSize:F.xs,color:MUTED,padding:'2px 0 2px 14px',lineHeight:1.4}}>› {s}</div>)}
                                </div>
                              ))}
                              {orphans.length>0 && (
                                <div style={{marginBottom:6}}>
                                  <div style={{fontSize:9,fontWeight:800,color:'var(--mc-text-3)',letterSpacing:0.4,marginBottom:2}}>· OTHER ({orphans.length})</div>
                                  {orphans.map((s,i)=><div key={i} style={{fontSize:F.xs,color:MUTED,padding:'2px 0 2px 14px',lineHeight:1.4}}>› {s}</div>)}
                                </div>
                              )}
                            </>
                          );
                        })()}
                        {r.risks.length>0&&<>
                          <div style={{fontSize:F.sm,color:ORANGE,fontWeight:700,letterSpacing:'0.8px',marginTop:12,marginBottom:6}}>⚠️ RISKS <span style={{color:MUTED,fontWeight:600,fontSize:F.xs}}>({r.risks.length})</span></div>
                          {r.risks.map((s,i)=><div key={i} style={{fontSize:F.xs,color:MUTED,padding:'2px 0',lineHeight:1.4}}>› {s}</div>)}
                        </>}
                        
                        {r.redFlags.length>0&&<>
                          <div style={{fontSize:F.sm,color:RED,fontWeight:700,letterSpacing:'0.8px',marginTop:12,marginBottom:6}}>🚨 RED FLAGS</div>
                          {r.redFlags.map((f,i)=>{
                            const isStruct = (f.kind ?? 'STRUCTURAL') === 'STRUCTURAL';
                            const cost = f.severity === 'CRITICAL' ? -25 : f.severity === 'HIGH' ? (isStruct ? -12 : -6) : -5;
                            return (
                              <div key={i} style={{fontSize:F.md,color:f.severity==='CRITICAL'?RED:ORANGE,padding:'3px 0'}}>
                                ⛔ {f.label}
                                <span style={{fontSize:F.xs,color:f.severity==='CRITICAL'?RED:ORANGE,fontWeight:700,marginLeft:6}}>{cost} pts</span>
                                <span style={{fontSize:F.xs,color:MUTED,marginLeft:6}}>[{f.severity} · {isStruct?'structural':'cyclical'} · {f.source}]</span>
                              </div>
                            );
                          })}
                        </>}

                        {/* ── PATCH 0056+0058: MULTIBAGGER FRAMEWORK PANEL ── */}
                        {(r.dilution || r.reinvestment || r.framework_coverage || r.archetype) && (
                          <div style={{marginTop:16,borderTop:`1px solid ${BORDER}`,paddingTop:12}}>
                            <div style={{fontSize:F.sm,fontWeight:800,letterSpacing:'0.8px',color:'var(--mc-cyan)',marginBottom:10}}>
                              🧬 MULTIBAGGER FRAMEWORK ANALYSIS
                            </div>
                            {/* PATCH 0058: Archetype card — featured first */}
                            {r.archetype && r.archetype.strength !== 'NO_MATCH' && (() => {
                              const s = r.archetype.strength;
                              const col = s === 'STRONG' ? PURPLE : s === 'PARTIAL' ? '#22d3ee' : MUTED;
                              return (
                                <div style={{marginBottom:8,padding:'10px 12px',backgroundColor:`${col}10`,border:`1px solid ${col}40`,borderLeft:`3px solid ${col}`,borderRadius:7}}>
                                  <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:6}}>
                                    <span style={{fontSize:F.sm,fontWeight:800,color:col,letterSpacing:'0.5px'}}>
                                      🎯 ARCHETYPE MATCH: {s}
                                    </span>
                                    <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>{r.archetype.closest_archetype}</span>
                                    <span style={{fontSize:F.xs,color:GREEN,fontWeight:700}}>{r.archetype.ten_year_return_x}× in 10y</span>
                                    <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>match score {r.archetype.match_score}/100</span>
                                  </div>
                                  <div style={{fontSize:F.xs,color:TEXT,lineHeight:1.5,marginBottom:8}}>{r.archetype.verdict}</div>
                                  {r.archetype.matching_dimensions.length > 0 && (
                                    <div style={{marginBottom:6}}>
                                      <div style={{fontSize:9,color:GREEN,fontWeight:700,marginBottom:3}}>✓ MATCHING DIMENSIONS</div>
                                      <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                                        {r.archetype.matching_dimensions.map((d,i) => (
                                          <span key={i} style={{fontSize:9,padding:'2px 6px',backgroundColor:`${GREEN}15`,color:GREEN,border:`1px solid ${GREEN}30`,borderRadius:4}}>{d}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {r.archetype.missing_dimensions.length > 0 && (
                                    <div>
                                      <div style={{fontSize:9,color:ORANGE,fontWeight:700,marginBottom:3}}>⚠ MISSING vs ARCHETYPE</div>
                                      <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                                        {r.archetype.missing_dimensions.map((d,i) => (
                                          <span key={i} style={{fontSize:9,padding:'2px 6px',backgroundColor:`${ORANGE}15`,color:ORANGE,border:`1px solid ${ORANGE}30`,borderRadius:4}}>{d}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            {r.archetype && r.archetype.strength === 'NO_MATCH' && (
                              <div style={{marginBottom:8,padding:'10px 12px',backgroundColor:`${MUTED}10`,border:`1px solid ${MUTED}40`,borderLeft:`3px solid ${MUTED}`,borderRadius:7}}>
                                <div style={{fontSize:F.xs,fontWeight:700,color:MUTED,marginBottom:4}}>○ NO ARCHETYPE MATCH</div>
                                <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.5}}>{r.archetype.verdict}</div>
                              </div>
                            )}
                            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:8}}>
                              {/* PATCH 0066: ROIC vs sector WACC */}
                              {r.roic_vs_wacc && r.roic_vs_wacc.verdict !== 'NA' && (() => {
                                const v = r.roic_vs_wacc.verdict;
                                const col = v==='VALUE_CREATING'?GREEN:v==='VALUE_DESTROYING'?RED:MUTED;
                                const label = v.replace('_',' ').toLowerCase();
                                return (
                                  <div style={{backgroundColor:CARD2,border:`1px solid ${col}30`,borderLeft:`3px solid ${col}`,borderRadius:7,padding:'8px 10px'}}>
                                    <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
                                      <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>📈 ROIC vs WACC</span>
                                      <span style={{fontSize:F.xs,fontWeight:800,color:col}}>{label}</span>
                                      {r.roic_vs_wacc.spread_pp !== null && (
                                        <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>
                                          {r.roic_vs_wacc.spread_pp >= 0 ? '+' : ''}{r.roic_vs_wacc.spread_pp.toFixed(1)}pp
                                        </span>
                                      )}
                                    </div>
                                    <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.4}}>{r.roic_vs_wacc.note}</div>
                                  </div>
                                );
                              })()}
                              {r.reinvestment && r.reinvestment.verdict !== 'NA' && (() => {
                                const v = r.reinvestment.verdict;
                                const col = v==='COMPOUNDING'?GREEN:v==='BUILDING'?'#22d3ee':v==='STALLING'?RED:MUTED;
                                return (
                                  <div style={{backgroundColor:CARD2,border:`1px solid ${col}30`,borderLeft:`3px solid ${col}`,borderRadius:7,padding:'8px 10px'}}>
                                    <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
                                      <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>⚙ Reinvestment Engine</span>
                                      <span style={{fontSize:F.xs,fontWeight:800,color:col}}>{v}</span>
                                      <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>{r.reinvestment.score}/100</span>
                                    </div>
                                    <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.4}}>{r.reinvestment.note}</div>
                                  </div>
                                );
                              })()}
                              {r.dilution && r.dilution.verdict !== 'NA' && (() => {
                                const v = r.dilution.verdict;
                                const col = v==='SEVERELY_DILUTIVE'?RED:v==='DILUTIVE'?ORANGE:v==='ACCRETIVE'?GREEN:MUTED;
                                return (
                                  <div style={{backgroundColor:CARD2,border:`1px solid ${col}30`,borderLeft:`3px solid ${col}`,borderRadius:7,padding:'8px 10px'}}>
                                    <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
                                      <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>{v.includes('DILUTIVE')?'⤓':'⤒'} Dilution Trajectory</span>
                                      <span style={{fontSize:F.xs,fontWeight:800,color:col}}>{v.replace('_',' ')}</span>
                                      {r.dilution.drag_pp !== null && (
                                        <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>
                                          {r.dilution.drag_pp > 0 ? '+' : ''}{r.dilution.drag_pp.toFixed(1)}pp drag
                                        </span>
                                      )}
                                    </div>
                                    <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.4}}>{r.dilution.note}</div>
                                  </div>
                                );
                              })()}
                              {r.framework_coverage && (() => {
                                const c = r.framework_coverage;
                                const col = c.confidence==='HIGH'?GREEN:c.confidence==='MEDIUM'?YELLOW:ORANGE;
                                return (
                                  <div style={{backgroundColor:CARD2,border:`1px solid ${col}30`,borderLeft:`3px solid ${col}`,borderRadius:7,padding:'8px 10px'}}>
                                    <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
                                      <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>◔ Framework Coverage</span>
                                      <span style={{fontSize:F.xs,fontWeight:800,color:col}}>{c.confidence}</span>
                                      <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>{c.coverage_pct}%</span>
                                    </div>
                                    <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.4,marginBottom:4}}>{c.note}</div>
                                    {c.missing.length > 0 && c.missing.length <= 6 && (
                                      <div style={{fontSize:9,color:'var(--mc-text-4)',lineHeight:1.4}}>
                                        Missing: {c.missing.join(', ')}
                                      </div>
                                    )}
                                    {c.missing.length > 6 && (
                                      <div style={{fontSize:9,color:'var(--mc-text-4)',lineHeight:1.4}}>
                                        Missing {c.missing.length} fields incl. {c.missing.slice(0,3).join(', ')}…
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>

                            {/* PATCH 1054 — Compact dimensions table. Replaces the 5-card
                                grid with a dense status table — institutional style: status
                                column, dimension column, one-line explanation. Hint hidden
                                inside hover-tooltip to avoid visual noise. */}
                            {r.missing_dimensions && r.missing_dimensions.length > 0 && (
                              <div style={{marginTop:10,padding:'8px 12px',backgroundColor:`${MUTED}05`,border:`1px solid ${MUTED}20`,borderLeft:`3px solid ${MUTED}`,borderRadius:6}}>
                                <div style={{fontSize:F.xs,fontWeight:700,color:'var(--mc-text-3)',marginBottom:6,letterSpacing:0.4,display:'flex',alignItems:'baseline',gap:8}}>
                                  <span>FRAMEWORK BOUNDARY</span>
                                  <span style={{color:MUTED,fontSize:9,fontWeight:600}}>· qualitative dimensions outside Screener export · verify manually for high-conviction picks</span>
                                </div>
                                <div style={{display:'grid',gridTemplateColumns:'auto auto 1fr',rowGap:3,columnGap:10,fontSize:F.xs,lineHeight:1.4}}>
                                  {r.missing_dimensions.map((d, i) => {
                                    const col = d.status === 'MEASURED' ? GREEN : d.status === 'PROXY' ? YELLOW : ORANGE;
                                    const icon = d.status === 'MEASURED' ? '●' : d.status === 'PROXY' ? '◐' : '○';
                                    const tip = d.upload_hint && d.status !== 'MEASURED' ? `${d.explanation}\n→ ${d.upload_hint}` : d.explanation;
                                    return (
                                      <React.Fragment key={i}>
                                        <span style={{color:col,fontWeight:700}}>{icon} {d.status}</span>
                                        <span style={{color:TEXT,fontWeight:600}}>{d.dimension}</span>
                                        <span title={tip} style={{color:MUTED,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.explanation}</span>
                                      </React.Fragment>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* ── 8-TEST KILL-SWITCH PANEL ── */}
                        {r.killSwitch && r.killSwitch.length > 0 && (() => {
                          const tested = r.killSwitch.filter(t => t.checks.some(c => c.pass !== null));
                          if (tested.length === 0) return null;
                          const passed = tested.filter(t => t.pass).length;
                          const failed = tested.filter(t => !t.pass).length;
                          const pColor = passed >= 6 ? GREEN : passed >= 4 ? YELLOW : ORANGE;
                          return (
                            <div style={{marginTop:16,borderTop:`1px solid ${BORDER}`,paddingTop:12}}>
                              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                                <span style={{fontSize:F.sm,fontWeight:800,letterSpacing:'0.8px',color:PURPLE}}>🛡 8-TEST KILL-SWITCH</span>
                                <span style={{fontSize:F.xs,color:pColor,fontWeight:700}}>{passed}/{tested.length} pass</span>
                                {failed > 0 && <span style={{fontSize:F.xs,color:failed>=5?RED:ORANGE}}>· {failed} fail{failed>=4?' (grade capped)':''}</span>}
                              </div>
                              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8}}>
                                {r.killSwitch.map(t => {
                                  const hasTested = t.checks.some(c => c.pass !== null);
                                  const tColor = !hasTested ? MUTED : t.pass ? GREEN : ORANGE;
                                  const passedC = t.checks.filter(c=>c.pass===true).length;
                                  const failedC = t.checks.filter(c=>c.pass===false).length;
                                  return (
                                    <details key={t.id} style={{backgroundColor:CARD2,border:`1px solid ${tColor}30`,borderLeft:`3px solid ${tColor}`,borderRadius:7,padding:'8px 10px'}}>
                                      <summary style={{cursor:'pointer',listStyle:'none',display:'flex',alignItems:'center',gap:6,userSelect:'none'}}>
                                        <span style={{fontSize:14}}>{t.icon}</span>
                                        <span style={{fontSize:F.xs,fontWeight:700,color:TEXT,flex:1}}>{t.label}</span>
                                        <span style={{fontSize:F.xs,fontWeight:700,color:tColor}}>
                                          {!hasTested ? '⬜ No data' : t.pass ? `✅ ${passedC}/${t.checks.filter(c=>c.pass!==null).length}` : `❌ ${passedC}/${t.checks.filter(c=>c.pass!==null).length}`}
                                        </span>
                                      </summary>
                                      <div style={{marginTop:8,borderTop:`1px solid ${BORDER}`,paddingTop:6}}>
                                        {t.checks.map((c,ci)=>(
                                          <div key={ci} style={{display:'flex',gap:6,alignItems:'flex-start',padding:'3px 0'}}>
                                            <span style={{fontSize:12,flexShrink:0,marginTop:1}}>
                                              {c.pass===true?'✅':c.pass===false?'❌':'⬜'}
                                            </span>
                                            <div>
                                              <div style={{fontSize:F.xs,fontWeight:600,color:c.pass===true?GREEN:c.pass===false?RED:MUTED}}>{c.label}</div>
                                              <div style={{fontSize:10,color:`${MUTED}CC`,lineHeight:1.4}}>{c.detail}</div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </details>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      </div>{/* PATCH 1056 — close RIGHT column */}
                    </div>
                    <div style={{fontSize:F.sm,color:MUTED,borderTop:`1px solid ${BORDER}`,paddingTop:8,marginTop:12}}>
                      <span>Sector: {r.sector}</span> · <span>Data: {r.coverage}%</span> ·
                      <span style={{color:BUCKET_CONFIG[r.bucket].color}}>{BUCKET_CONFIG[r.bucket].icon} {BUCKET_CONFIG[r.bucket].label}</span> ·
                      {r.reratingBonus!==0&&<span style={{color:r.reratingBonus>0?GREEN:RED}}>Rerating {r.reratingBonus>0?'+':''}{r.reratingBonus}pts</span>}
                      {r.ownershipCategory&&<span style={{color:OWNERSHIP_CONFIG[r.ownershipCategory].color,fontWeight:700}}>{OWNERSHIP_CONFIG[r.ownershipCategory].icon} {OWNERSHIP_CONFIG[r.ownershipCategory].label}: {OWNERSHIP_CONFIG[r.ownershipCategory].strategy}</span>}
                      {guidanceMode && (() => {
                        const rAny = r as ExcelResult & { guidanceScore?: number; guidanceAdj?: number };
                        if (rAny.guidanceScore === undefined) return null;
                        const gColor = (rAny.guidanceScore ?? 0.5) >= 0.7 ? GREEN : (rAny.guidanceScore ?? 0.5) <= 0.3 ? RED : '#F59E0B';
                        return <span style={{color:gColor}}>Guidance {rAny.guidanceScore?.toFixed(1)} → score adj {rAny.guidanceAdj && rAny.guidanceAdj>0?'+':''}{rAny.guidanceAdj}pts</span>;
                      })()}
                      <span style={{color:MUTED,fontSize:F.xs}}>Wts: Q{r.pillarScores[0].weight}% G{r.pillarScores[1].weight}% L{r.pillarScores[2].weight}% F{r.pillarScores[3].weight}% V{r.pillarScores[4].weight}%</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {!rows.length&&!loading&&!parseError&&(
        <div style={{textAlign:'center',padding:56,color:MUTED}}>
          <div style={{fontSize:48}}>📤</div>
          <div style={{fontSize:F.h2,color:TEXT,fontWeight:700,marginTop:14}}>Upload Screener.in exports to score all stocks</div>
          <div style={{fontSize:F.md,color:MUTED,marginTop:8,lineHeight:1.8}}>
            SQGLP framework (MOSL 100×) · Fisher 100-Bagger · Multibagger Framework<br/>
            All {METRICS.length} fields scored · New: LONGEVITY pillar · Operating Leverage · Net Debt/EBITDA · FII/DII undiscovered check
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKLIST TAB — 37 criteria, institutional scale, auto-checks from Excel data
// ═══════════════════════════════════════════════════════════════════════════════

function MultibaggerChecklist({excelRows}:{excelRows:ExcelResult[]}) {
  const [symbol,setSymbol]=useState('');
  const [activeSymbol,setActiveSymbol]=useState('');
  const [savedSymbols,setSavedSymbols]=useState<string[]>([]);
  const [checks,setChecks]=useState<Record<string,boolean>>({});
  const [notes,setNotes]=useState<Record<string,string>>({});

  function loadSymbol(sym:string){
    setActiveSymbol(sym);
    // Load saved checks
    let savedChecks: Record<string,boolean> = {};
    try{ savedChecks = JSON.parse(localStorage.getItem(`mb3_checks_${sym}`)||'{}'); } catch{}
    // Auto-tick items where autoPass fires for this stock
    const stock = excelRows.find(r => r.symbol.toUpperCase() === sym.toUpperCase());
    if (stock) {
      for (const item of CHECKLIST) {
        if (item.autoField && item.autoPass) {
          const val = stock[item.autoField as keyof ExcelResult];
          if (val !== undefined) {
            savedChecks[item.id] = item.autoPass(val as number, stock);
          }
        }
      }
      localStorage.setItem(`mb3_checks_${sym}`, JSON.stringify(savedChecks));
    }
    setChecks(savedChecks);
    try{setNotes(JSON.parse(localStorage.getItem(`mb3_notes_${sym}`)||'{}'));}catch{setNotes({});}
  }
  function addSymbol(){
    const s=symbol.trim().toUpperCase();
    if(!s||savedSymbols.includes(s)) return;
    const next=[...savedSymbols,s];
    setSavedSymbols(next);
    localStorage.setItem('mb3_symbols',JSON.stringify(next));
    loadSymbol(s);setSymbol('');
  }
  function removeSymbol(sym:string){
    const next=savedSymbols.filter(x=>x!==sym);
    setSavedSymbols(next);
    localStorage.setItem('mb3_symbols',JSON.stringify(next));
    if(activeSymbol===sym){setActiveSymbol(next[0]??'');setChecks({});setNotes({});}
  }
  function toggleCheck(id:string){
    const next={...checks,[id]:!checks[id]};
    setChecks(next);
    if(activeSymbol) localStorage.setItem(`mb3_checks_${activeSymbol}`,JSON.stringify(next));
  }
  function setNote(id:string,val:string){
    const next={...notes,[id]:val};
    setNotes(next);
    if(activeSymbol) localStorage.setItem(`mb3_notes_${activeSymbol}`,JSON.stringify(next));
  }

  useMemo(()=>{
    try{
      const syms=JSON.parse(localStorage.getItem('mb3_symbols')||'[]') as string[];
      setSavedSymbols(syms);
      if(syms.length>0&&!activeSymbol)loadSymbol(syms[0]);
    }catch{}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const excelStock=excelRows.find(r=>r.symbol.toUpperCase()===activeSymbol.toUpperCase());
  const autoChecks=useMemo(():Record<string,{pass:boolean;note:string}|null>=>{
    if(!excelStock) return {};
    const result:Record<string,{pass:boolean;note:string}|null>={};
    for (const item of CHECKLIST){
      if(!item.autoField||!item.autoPass) continue;
      // Handle both numeric fields and derived non-numeric fields (accelSignal etc.)
      const rawVal=excelStock[item.autoField as keyof ExcelResult];
      // For string-type fields (accelSignal), pass 0 as numeric placeholder — autoPass uses row
      const numVal = typeof rawVal === 'number' ? rawVal : (rawVal !== undefined ? 0 : undefined);
      if(numVal===undefined && rawVal===undefined) continue;
      const pass=item.autoPass(numVal??0, excelStock);
      const formatted = item.autoFormat ? item.autoFormat(numVal??0, excelStock) : (typeof rawVal==='number'?rawVal.toFixed(2):String(rawVal??''));
      if(!formatted) continue; // skip if format returns empty (derived field not available)
      const note=`Auto: ${formatted} → ${pass?'✅ PASS':'❌ FAIL'}`;
      result[item.id]={pass,note};
    }
    return result;
  },[excelStock]);

  const pillars=[...new Set(CHECKLIST.map(i=>i.pillar))];
  const completed=CHECKLIST.filter(i=>autoChecks[i.id]?.pass||checks[i.id]).length;
  const autoPassed=Object.values(autoChecks).filter(v=>v?.pass).length;
  const pct=Math.round((completed/CHECKLIST.length)*100);
  const grade:Grade=pct>=90?'A+':pct>=80?'A':pct>=68?'B+':pct>=55?'B':pct>=42?'C':'D';

  return (
    <div style={{maxWidth:1800,margin:'0 auto',padding:'28px 20px'}}>
      {excelRows.length>0&&(
        <div style={{marginBottom:14,padding:'12px 18px',backgroundColor:`${GREEN}08`,border:`1px solid ${GREEN}20`,borderRadius:10,fontSize:F.md,color:GREEN}}>
          🤖 {excelRows.length} stocks from uploaded Excel — click any to auto-verify {CHECKLIST.filter(i=>i.autoField).length} criteria · {autoPassed>0?`${autoPassed} already verified for ${activeSymbol||'selected stock'}`:'select a stock below'}
        </div>
      )}

      {/* Ticker selector */}
      <div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap',alignItems:'center'}}>
        <input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} onKeyDown={e=>e.key==='Enter'&&addSymbol()}
          placeholder="Add ticker (e.g. HBLENGINE, APARINDS)" maxLength={20}
          style={{flex:'0 0 260px',padding:'10px 14px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:10,color:TEXT,fontSize:F.md,fontWeight:600,outline:'none'}}/>
        <button onClick={addSymbol} style={{padding:'10px 18px',backgroundColor:`${PURPLE}20`,border:`1px solid ${PURPLE}40`,borderRadius:10,color:PURPLE,fontSize:F.md,fontWeight:700,cursor:'pointer'}}>Add</button>
        {/* Quick buttons from top Excel scores */}
        {excelRows.slice(0,10).map(r=>(
          <button key={r.symbol} onClick={()=>{
            if(!savedSymbols.includes(r.symbol)){const n=[...savedSymbols,r.symbol];setSavedSymbols(n);localStorage.setItem('mb3_symbols',JSON.stringify(n));}
            loadSymbol(r.symbol);
          }} style={{padding:'8px 14px',borderRadius:8,border:`1px solid ${activeSymbol===r.symbol?GRADE_COLOR[r.grade]:BORDER}`,background:activeSymbol===r.symbol?`${GRADE_COLOR[r.grade]}15`:'transparent',color:activeSymbol===r.symbol?GRADE_COLOR[r.grade]:MUTED,fontSize:F.sm,fontWeight:700,cursor:'pointer'}}>
            {r.symbol} <span style={{color:GRADE_COLOR[r.grade]}}>{r.grade}</span>
          </button>
        ))}
        {savedSymbols.map(s=>(
          <div key={s} style={{display:'flex',borderRadius:10,border:`1px solid ${activeSymbol===s?`${PURPLE}60`:BORDER}`,overflow:'hidden'}}>
            <button onClick={()=>loadSymbol(s)} style={{padding:'8px 14px',background:activeSymbol===s?`${PURPLE}20`:'transparent',border:'none',cursor:'pointer',color:activeSymbol===s?PURPLE:MUTED,fontSize:F.md,fontWeight:700}}>{s}</button>
            <button onClick={()=>removeSymbol(s)} style={{padding:'8px 10px',background:'none',border:'none',borderLeft:`1px solid ${BORDER}`,cursor:'pointer',color:MUTED,fontSize:F.md}}>×</button>
          </div>
        ))}
      </div>

      {!activeSymbol?(
        <div style={{textAlign:'center',padding:60,color:MUTED}}>
          <div style={{fontSize:52}}>📋</div>
          <div style={{fontSize:F.h2,color:TEXT,fontWeight:700,marginTop:16}}>37 criteria from SQGLP + Fisher + Framework</div>
          <div style={{fontSize:F.md,color:MUTED,marginTop:8,lineHeight:1.8}}>
            Add a ticker above or click any scored stock · Auto-verification from uploaded Excel data<br/>
            Sources: MOSL 100× (SQGLP) · Philip Fisher 100-Bagger · Multibagger Framework
          </div>
        </div>
      ):(
        <>
          {/* Progress header */}
          <div style={{marginBottom:20,padding:'18px 20px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:12}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <div>
                <span style={{fontSize:F.h2,fontWeight:800,color:TEXT}}>{activeSymbol}</span>
                {excelStock&&<span style={{fontSize:F.md,color:MUTED,marginLeft:12}}>{excelStock.company} · {excelStock.sector} · Excel Score: <strong style={{color:GRADE_COLOR[excelStock.grade]}}>{excelStock.score} {excelStock.grade}</strong></span>}
              </div>
              <div style={{textAlign:'right'}}>
                <span style={{fontSize:F.h1,fontWeight:900,color:GRADE_COLOR[grade]??MUTED}}>{grade}</span>
                <span style={{fontSize:F.md,color:MUTED,marginLeft:8}}>{completed}/{CHECKLIST.length} criteria ({pct}%)</span>
              </div>
            </div>
            <div style={{height:10,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:5,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${pct}%`,background:pct>=70?GREEN:pct>=50?YELLOW:RED,borderRadius:5,transition:'width 0.3s'}}/>
            </div>
            <div style={{display:'flex',gap:20,marginTop:8,flexWrap:'wrap'}}>
              <span style={{fontSize:F.sm,color:GREEN}}>✅ {completed} passed</span>
              <span style={{fontSize:F.sm,color:ACCENT}}>🤖 {autoPassed} auto-verified from Excel</span>
              <span style={{fontSize:F.sm,color:MUTED}}>{CHECKLIST.length-completed} remaining</span>
              {!excelStock&&excelRows.length>0&&<span style={{fontSize:F.sm,color:YELLOW}}>⚠ Upload {activeSymbol} in Excel to enable auto-checks</span>}
            </div>
          </div>

          {/* Checklist by pillar */}
          {pillars.map(pillar=>{
            const items=CHECKLIST.filter(i=>i.pillar===pillar);
            const pc=items[0].pillarColor;
            const passed=items.filter(i=>autoChecks[i.id]?.pass||checks[i.id]).length;
            return (
              <div key={pillar} style={{marginBottom:24}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                  <span style={{fontSize:F.md,fontWeight:800,letterSpacing:'1px',color:pc}}>{pillar.replace('_',' ')}</span>
                  <span style={{fontSize:F.sm,color:MUTED}}>({passed}/{items.length} passed)</span>
                  <div style={{flex:1,height:1,backgroundColor:`${pc}25`}}/>
                </div>
                {items.map(item=>{
                  const auto=autoChecks[item.id];
                  const isChecked=auto?.pass||checks[item.id];
                  const isFail=auto&&!auto.pass;
                  const isAuto=!!auto;
                  return (
                    <div key={item.id} style={{marginBottom:8,borderRadius:10,border:`1px solid ${isChecked?`${pc}35`:isFail?`${RED}30`:BORDER}`,backgroundColor:isChecked?`${pc}07`:isFail?`${RED}05`:CARD_BG,overflow:'hidden'}}>
                      <div style={{display:'flex',alignItems:'flex-start',gap:12,padding:'14px 16px'}}>
                        <button onClick={()=>!isAuto&&toggleCheck(item.id)} style={{background:'none',border:`2px solid ${isChecked?pc:isFail?RED:MUTED}`,borderRadius:5,width:22,height:22,cursor:isAuto?'default':'pointer',flexShrink:0,marginTop:2,display:'flex',alignItems:'center',justifyContent:'center',color:isChecked?pc:isFail?RED:'transparent',fontSize:F.md,fontWeight:900}}>
                          {isChecked?'✓':isFail?'✗':''}
                        </button>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                            <span style={{fontSize:F.md,color:TEXT,fontWeight:600}}>{item.label}</span>
                            {isAuto&&<span style={{fontSize:F.xs,fontWeight:800,color:ACCENT,border:`1px solid ${ACCENT}30`,padding:'1px 6px',borderRadius:4}}>AUTO</span>}
                            <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>wt {item.weight}% · {item.source}</span>
                          </div>
                          <div style={{fontSize:F.sm,color:MUTED,marginBottom:4}}><strong>Target:</strong> {item.target}</div>
                          {auto?.note&&<div style={{fontSize:F.sm,color:auto.pass?GREEN:RED,marginBottom:4,fontWeight:600}}>{auto.note}</div>}
                          {!isAuto&&(
                            <input value={notes[item.id]||''} onChange={e=>setNote(item.id,e.target.value)}
                              placeholder="Your research note / evidence…"
                              style={{width:'100%',marginTop:6,padding:'6px 10px',backgroundColor:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,borderRadius:6,color:MUTED,fontSize:F.sm,outline:'none',boxSizing:'border-box'}}/>
                          )}
                        </div>
                      </div>
                      <div style={{padding:'0 16px 10px 50px',fontSize:F.sm,color:`${MUTED}90`,lineHeight:1.6}}>{item.why}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// USA MULTIBAGGER SYSTEM — TradingView CSV format
// Framework: Revenue Acceleration + Gross Margin + FCF Quality + US Valuation
// PATCH 0728 — Scoring engine moved to @/lib/multibagger-usa-scoring (imported
// alongside the India lib at the top of this file).
// ═══════════════════════════════════════════════════════════════════════════════

function parseUSARow(row: Record<string,unknown>): USARow | null {
  const n = (v: unknown): number|undefined => {
    if (v===''||v===null||v===undefined) return undefined;
    const parsed = parseFloat(String(v).replace(/[,$%]/g,''));
    return isNaN(parsed) ? undefined : parsed;
  };
  const sym = String(row['Symbol']??'').trim().toUpperCase();
  if (!sym) return null;
  const mcapRaw = n(row['Market capitalization']);
  // PATCH 0342: TradingView exports use "Cash and equivalents" (with "and"),
  // not "Cash & equivalents" (with ampersand). Old parser missed this column.
  const cashRaw = n(
    row['Cash and equivalents, Annual'] ??
    row['Cash & equivalents, Annual'] ??
    row['Cash and equivalents']
  );
  const ltDebtRaw = n(row['Long term debt, Annual']);
  const netDebtRaw = n(row['Net debt, Annual']);
  const revQtr = n(row['Revenue growth %, Quarterly YoY']);
  const revAnn = n(row['Revenue growth %, Annual YoY']);
  return {
    symbol: sym,
    company: String(row['Description']??'').trim(),
    sector:  String(row['Sector']??'').trim() || 'Technology services',
    exchange: String(row['Exchange']??'').trim(),
    marketCapUsd: mcapRaw,
    marketCapB: mcapRaw !== undefined ? Math.round(mcapRaw/1e9*100)/100 : undefined,
    revenueGrowthQtr: revQtr,
    revenueGrowthAnn: revAnn,
    // Gross margin: use TTM (TradingView now provides Trailing 12 months) OR Annual as fallback
    grossMarginAnn:   n(row['Gross margin %, Annual'] ??
                        row['Gross margin %, Trailing 12 months']),  // TTM = primary if Annual missing
    fcfMarginAnn:     n(row['Free cash flow margin %, Annual']),
    grossProfitGrowthQtr: n(row['Gross profit growth %, Quarterly YoY']),
    pe:          n(row['Price to earnings ratio']),
    forwardPe:   n(row['Forward non-GAAP price to earnings, Annual']),
    netDebtUsd:  netDebtRaw,
    evEbitda:    n(row['Enterprise value to EBITDA ratio, Trailing 12 months']),
    evRevenue:   n(row['Enterprise value to revenue ratio, Trailing 12 months']),
    ps:          n(row['Price to sales ratio']),
    opmTtm:      n(row['Operating margin %, Trailing 12 months']),
    pb:          n(row['Price to book ratio']),
    roe:         n(row['Return on equity %, Trailing 12 months']),
    cashUsd:     cashRaw,
    ltDebtUsd:   ltDebtRaw,
    // Fix: TradingView exports dates as Excel serial numbers (e.g. 46148.08 = May 4 2026)
    nextEarnings: usaSerialDate(row['Upcoming earnings date']),
    // Optional extra fields — maps both TradingView exact names AND common variants
    epsGrowth: n(
      row['Earnings per share diluted growth %, TTM YoY'] ??   // TradingView exact
      row['EPS diluted growth %, TTM YoY'] ??
      row['EPS growth %, TTM YoY']
    ),
    roic: n(
      row['Return on invested capital %, Annual'] ??            // TradingView exact
      row['ROIC']
    ),
    de: n(
      row['Debt to equity ratio, Quarterly'] ??                 // TradingView exact
      row['Debt / equity ratio'] ??
      row['Debt to equity ratio']
    ),
    netProfitMargin: n(
      row['Net margin %, Trailing 12 months'] ??                // TradingView exact
      row['Net profit margin %, TTM'] ??
      row['Net profit margin %, Annual']
    ),
    perf1y: n(
      row['Performance % 1 year'] ??                            // TradingView exact
      row['Performance, 1 Year %'] ??
      row['1-year performance %'] ??
      row['Perf.Y']
    ),
    pctFrom52wHigh: n(
      row['Change from 52-week high, %'] ??
      row['% from 52W high'] ??
      row['Change from 52W High']
    ),
    // ── TradingView fields (confirmed to exist) ──────────────────────────────
    // 5-year CAGR (TradingView column: "Revenue growth %, 5 year CAGR")
    revGrowth3yr: n(
      row['Revenue growth %, 5 year CAGR'] ??  // TradingView exact name
      row['Revenue growth %, 3-year CAGR'] ??  // fallback for old exports
      row['Revenue 3-year CAGR, %'] ??
      row['Revenue growth %, 3 year CAGR']
    ),
    // Gross margin TTM (TradingView: "Gross margin %, Trailing 12 months")
    grossMarginTtm: n(
      row['Gross margin %, Trailing 12 months'] ??  // TradingView exact
      row['Gross margin %, TTM']
    ),
    // PEG ratio TTM (TradingView: "Price to earning to growth, Trailing 12 months")
    peg: n(
      row['Price to earning to growth, Trailing 12 months'] ??  // TradingView exact
      row['Price to earnings growth ratio'] ??
      row['PEG ratio'] ??
      row['PEG']
    ),
    // Analyst Rating (TradingView: "Analyst Rating" — string: Strong buy/Buy/Neutral/Sell)
    analystRating: (() => {
      const v = String(row['Analyst Rating'] ?? row['Analyst rating'] ?? '').trim();
      return v || undefined;
    })(),
    // RSI (TradingView: "Relative strength index, 14")
    rsi14: n(
      row['Relative strength index, 14'] ??
      row['RSI, 14'] ??
      row['RSI']
    ),
    // P/FCF (TradingView: "Price to free cash flow, TTM")
    pFcf: n(
      row['Price to free cash flow, TTM'] ??
      row['Price to free cash flow ratio, TTM'] ??
      row['P/FCF']
    ),
    // ── PATCH 0341: NEW FORENSIC COLUMNS (TradingView confirmed names) ───────
    piotroskiFScore: n(
      row['Piotroski F-score, Annual'] ??
      row['Piotroski F-score, Trailing 12 months'] ??
      row['Piotroski F-score']
    ),
    altmanZScore: n(
      row['Altman Z-score, Annual'] ??
      row['Altman Z-score, Trailing 12 months'] ??  // PATCH 0342: NVDIA-format file uses TTM
      row['Altman Z-score']
    ),
    sloanRatio: n(
      row['Sloan ratio %, Trailing 12 months'] ??
      row['Sloan ratio %, Annual'] ??
      row['Sloan ratio %']
    ),
    sharesBuybackRatio: n(
      row['Shares buyback ratio %, Annual'] ??
      row['Shares buyback ratio %, Quarterly'] ??
      row['Shares buyback ratio %']
    ),
    buybackYield: n(row['Buyback yield %']),
    rdRatio: n(
      row['Research and development ratio, Trailing 12 months'] ??
      row['Research and development ratio, Annual'] ??
      row['Research and development ratio'] ??
      row['Research & development to revenue ratio %']
    ),
    interestCoverage: n(
      row['Interest coverage, Annual'] ??
      row['Interest coverage, Trailing 12 months'] ??
      row['Interest coverage']
    ),
    netDebtEbitda: n(
      row['Net debt to EBITDA ratio, Trailing 12 months'] ??
      row['Net debt to EBITDA ratio, Annual'] ??
      row['Net debt to EBITDA ratio']
    ),
    cashStInvest: n(
      row['Cash and short-term investments, Annual'] ??
      row['Cash and short-term investments, Quarterly'] ??
      row['Cash and short-term investments']
    ),
    revPerEmployee: n(
      row['Revenue per employee, Annual'] ??
      row['Revenue per employee']
    ),
    sustainableGrowth: n(
      row['Sustainable growth rate, Annual'] ??
      row['Sustainable growth rate']
    ),
    freeFloatPct: n(row['Free float %']),
    fcfPerEmployee: n(
      row['Free cash flow per employee, Annual'] ??
      row['Free cash flow per employee']
    ),
    fcfAnnUsd: n(row['Free cash flow, Annual']),
    fcfTtmUsd: n(
      row['Free cash flow, Trailing 12 months'] ??
      row['Free cash flow, TTM']
    ),
    totalSharesOutstanding: n(
      row['Total common shares outstanding'] ??
      row['Total common shares outstanding, Quarterly'] ??
      row['Shares outstanding']
    ),
    numEmployees: n(
      row['Number of employees, Annual'] ??
      row['Number of employees']
    ),
    ebitdaPerEmployee: n(
      row['EBITDA per employee, Annual'] ??
      row['EBITDA per employee']
    ),
    // PATCH 0342: FCF per share TTM (NVDIA-style export has this instead
    // of absolute FCF). Wired as a separate signal — positive value is a
    // clean cash-generation signal even without absolute FCF.
    fcfPerShareTtm: n(
      row['Free cash flow per share, Trailing 12 months'] ??
      row['Free cash flow per share, TTM'] ??
      row['Free cash flow per share']
    ),
    roce: n(
      row['Return on capital employed %, Annual'] ??
      row['Return on capital employed %, Trailing 12 months'] ??
      row['Return on capital employed %']
    ),
    // ── Kept for forward compatibility but not standard in TradingView ───────
    insiderOwnership: n(row['Insider ownership, %'] ?? row['Insider ownership %']),
    analystCount:     n(row['Number of analyst estimates'] ?? row['Analysts']),
    forwardRevGrowth: n(row['Forward revenue growth %, FY1'] ?? row['Revenue growth %, next year']),
    // PATCH 0577 — Liquidity intelligence. TradingView CSV usually has Price
    // and either "Average Volume (30 day)" or just "Volume" (daily). When
    // both are present we derive avgDailyValueUsdM in millions; otherwise
    // fall back to the single value we have. Heavy-instituional desks need
    // ADV ≥ $10M before position sizing can be 5%+; this surfaces it.
    price: n(row['Price'] ?? row['Last'] ?? row['Close']),
    avgVolume30d: n(
      row['Average Volume (30 day)'] ??
      row['Average Volume, 30 day'] ??
      row['Avg Volume (30d)'] ??
      row['Volume'] ??  // Single-day fallback; less ideal but better than nothing
      row['Average Volume']
    ),
    avgDailyValueUsdM: (() => {
      const p = n(row['Price'] ?? row['Last'] ?? row['Close']);
      const v = n(
        row['Average Volume (30 day)'] ??
        row['Average Volume, 30 day'] ??
        row['Avg Volume (30d)'] ??
        row['Volume'] ??
        row['Average Volume']
      );
      if (typeof p === 'number' && typeof v === 'number' && p > 0 && v > 0) {
        return Math.round((p * v) / 1e6 * 10) / 10;
      }
      return undefined;
    })(),
    // PATCH 1101qq — New TradingView fields user added in latest export.
    perf3m: n(row['Performance %, 3 months'] ?? row['Performance % 3 months']),
    perf6m: n(row['Performance %, 6 months'] ?? row['Performance % 6 months']),
    epsEstimateAnnual: n(row['Earnings per share estimate, Annual'] ?? row['EPS estimate, Annual']),
    beta5y: n(row['Beta, 5 years'] ?? row['Beta 5y'] ?? row['Beta']),
    ebitdaMargin: n(row['EBITDA margin %, Trailing 12 months'] ?? row['EBITDA margin %, TTM']),
    capexPerShareTtm: n(row['Capital expenditures per share, Trailing 12 months'] ?? row['Capital expenditures per share, TTM']),
    epsGrowthQtr: n(row['Earnings per share diluted growth %, Quarterly YoY'] ?? row['EPS diluted growth %, Quarterly YoY']),
    targetPrice1y: n(row['Target price, 1 year'] ?? row['Target price 1 year'] ?? row['Price target - mean']),
    ema50: n(row['Exponential moving average, 50, 1 day'] ?? row['EMA 50']),
    ema200: n(row['Exponential moving average, 200, 1 day'] ?? row['EMA 200']),
    // Derived at parse time
    revenueAccel: (revQtr !== undefined && revAnn !== undefined) ? Math.round(revQtr - revAnn) : undefined,
    accelSignal: (revQtr !== undefined && revAnn !== undefined)
      ? (revQtr - revAnn >= 5 ? 'ACCELERATING' : revQtr - revAnn <= -5 ? 'DECELERATING' : 'STABLE')
      : undefined,
    // Rule of 40 = revenue growth + FCF margin (≥40 = institutional benchmark)
    // PATCH 0346 — R40 uses Quarterly Rev + FCF margin (more current view).
    // Falls back to Annual when Quarterly missing.
    ruleOf40: ((revQtr ?? revAnn) !== undefined && n(row['Free cash flow margin %, Annual']) !== undefined)
      ? Math.round(((revQtr ?? revAnn) as number) + (n(row['Free cash flow margin %, Annual']) as number))
      : undefined,
    // Gross margin expansion = TTM vs Annual (positive = improving pricing power)
    grossMarginExpansion: (() => {
      const ttm = n(row['Gross margin %, TTM'] ?? row['Gross margin %, Trailing 12 months']);
      const ann = n(row['Gross margin %, Annual']);
      return (ttm !== undefined && ann !== undefined) ? Math.round((ttm - ann) * 10) / 10 : undefined;
    })(),
    // PATCH 0341: RUNWAY MONTHS = cash / (annual FCF burn rate, only meaningful when FCF<0)
    runwayMonths: (() => {
      const cash = n(row['Cash and short-term investments, Annual'])
                ?? n(row['Cash and short-term investments, Quarterly']);
      const fcfTtm = n(row['Free cash flow, Trailing 12 months'])
                  ?? n(row['Free cash flow, TTM']);
      const fcfAnn = n(row['Free cash flow, Annual']);
      const fcf = fcfTtm ?? fcfAnn;
      if (cash === undefined || fcf === undefined || fcf >= 0) return undefined;
      const annualBurn = Math.abs(fcf);
      return Math.round(cash / annualBurn * 12); // months of runway at current burn
    })(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// USA RESEARCH CHECKLIST — 28 criteria covering US multibagger framework
// Fisher 100-Bagger + MOSL SQGLP adapted for US growth stocks + Rule of 40
// ═══════════════════════════════════════════════════════════════════════════════

interface USAChecklistItem {
  id: string; label: string; pillar: string; pillarColor: string;
  target: string; why: string; weight: number; source: string;
}

const USA_CHECKLIST: USAChecklistItem[] = [
  // ── QUALITY / MOAT ────────────────────────────────────────────────────────
  { id:'us_gm', pillar:'QUALITY', pillarColor:'#a78bfa', weight:8, source:'Fisher + SaaS benchmark',
    label:'Gross Margin ≥ 60% (software) or ≥ 50% (semis/hardware)', target:'Software: >65% elite · Hardware: >50% · <35% = weak moat',
    why:'Gross margin is the first test of pricing power. High GM = durable competitive advantage. Google 55%, NVDA 74%, AAPL 46%. Below 35% = no moat.' },
  { id:'us_gm_expand', pillar:'QUALITY', pillarColor:'#a78bfa', weight:7, source:'Institutional standard',
    label:'Gross Margin expanding QoQ / TTM vs Annual (direction > absolute)', target:'TTM GM > Annual GM = pricing power strengthening',
    why:'A rising GM trend proves the moat is durably improving, not just high. The direction is more important than the level for predicting future multiples.' },
  { id:'us_fcf', pillar:'QUALITY', pillarColor:'#a78bfa', weight:8, source:'Fisher + Buffett',
    label:'FCF Margin ≥ 15% AND positive (free cash machine)', target:'>25% = excellent · >15% = good · <0% = risk',
    why:'US tech multibaggers are defined by FCF generation. NVDA 55% FCF margin, MSFT 29%. FCF funds buybacks, R&D, M&A without dilution.' },
  { id:'us_roe', pillar:'QUALITY', pillarColor:'#a78bfa', weight:6, source:'Buffett',
    label:'ROE ≥ 20% consistently (without excessive leverage)', target:'>30% = exceptional · >20% = good · <10% = weak',
    why:'Buffett rule: ROE > 20% without leverage = true earnings power. With leverage = false signal.' },
  { id:'us_roic', pillar:'QUALITY', pillarColor:'#a78bfa', weight:7, source:'Fisher ROIC test',
    label:'ROIC ≥ 15% AND stable or rising (not diluting from new investments)', target:'>20% = moat confirmed · 10–20% = acceptable · <10% = below WACC',
    why:"Fisher key test: 'Does new capital earn at least as much as legacy capital?' Rising ROIC = each dollar invested creates more value than before." },
  { id:'us_r40', pillar:'QUALITY', pillarColor:'#a78bfa', weight:9, source:'SaaS/tech institutional benchmark',
    label:'Rule of 40: (Revenue growth% + FCF margin%) ≥ 40', target:'≥60 = elite · ≥40 = investment grade · <20 = value trap for SaaS',
    why:'The primary institutional benchmark for evaluating tech/SaaS companies. Combines growth + profitability into one number. Palantir at 78, NVDA at ~100+. BELOW 20 = no premium multiple justified.' },
  { id:'us_moat_type', pillar:'QUALITY', pillarColor:'#a78bfa', weight:6, source:'Fisher 100-Bagger',
    label:'Moat type: network effects / switching cost / ecosystem (Tier 1)', target:'Network > Switching > Brand > Cost > Regulatory (weakest)',
    why:'Fisher: verify moat type matters more than gross margin. A 90% gross margin with zero switching costs (commoditizable) is not a moat.' },
  // ── GROWTH ────────────────────────────────────────────────────────────────
  { id:'us_revgrowth', pillar:'GROWTH', pillarColor:'#38bdf8', weight:9, source:'MOSL adapted',
    label:'Revenue CAGR ≥ 20% (3-year or annual)', target:'>30% = hypergrowth · >20% = multibagger zone · <15% = insufficient',
    why:'US multibaggers need higher base growth than India. NVDA 3yr CAGR 90%+. Palantir 24%. Rule: if a company cannot grow 20%+ annually, it cannot 10× in 5 years.' },
  { id:'us_rev_accel', pillar:'GROWTH', pillarColor:'#38bdf8', weight:9, source:'Framework core signal',
    label:'Revenue ACCELERATING: Quarterly YoY > Annual YoY (+5pp threshold)', target:'QoQ YoY % > Annual % by ≥5pp = structural acceleration',
    why:'MOST important signal for entry timing. NVDA went from 20% growth to 200% in 2023 before consensus caught on. Catch this inflection, not after.' },
  { id:'us_eps_growth', pillar:'GROWTH', pillarColor:'#38bdf8', weight:7, source:'Fisher Twin Engine',
    label:'EPS growth ≥ 20% AND faster than revenue (op leverage proof)', target:'EPS CAGR > Revenue CAGR × 1.3 = operating leverage firing',
    why:'Fisher Twin Engine: EPS growth + stable/expanding PE = compounding. EPS growing faster than revenue = operating leverage visible.' },
  { id:'us_growth_sustained', pillar:'GROWTH', pillarColor:'#38bdf8', weight:6, source:'MOSL consistency check',
    label:'3-year CAGR ≥ 15% (not a one-year spike)', target:'3yr CAGR ≥ 15% confirms sustainability. Annual/3yr ratio < 2× = not a spike.',
    why:'COVID-reopening, one-off contracts, and AI hype create fake spikes. 3yr CAGR confirms the growth is structural, not cyclical.' },
  { id:'us_gp_expansion', pillar:'GROWTH', pillarColor:'#38bdf8', weight:5, source:'Operating leverage',
    label:'Gross profit growing faster than revenue (margin expansion real-time)', target:'Gross profit growth QoQ % > Revenue growth QoQ % = live margin expansion',
    why:'If GP grows faster than revenue, OPM will expand next quarter. Lead indicator of upcoming profitability improvement.' },
  // ── VALUATION ─────────────────────────────────────────────────────────────
  { id:'us_peg', pillar:'VALUATION', pillarColor:'#f59e0b', weight:7, source:'Fisher PEG adapted',
    label:'PEG Ratio < 1.5 (growth at reasonable price)', target:'<0.8 = exceptional · 0.8–1.5 = fair GARP · >2.5 = expensive growth',
    why:'Fisher: PEG adjusts P/E for growth rate. Paying 40× PE for 40% growth = fair (PEG=1). Paying 40× for 10% growth = expensive (PEG=4).' },
  { id:'us_ev_ebitda', pillar:'VALUATION', pillarColor:'#f59e0b', weight:6, source:'Institutional standard',
    label:'EV/EBITDA < sector median (enterprise value discipline)', target:'Tech: <35× fair · <20× cheap · >80× very expensive',
    why:'EV/EBITDA is capital-structure neutral — works even with buybacks, debt, or net-cash. More reliable than P/E for comparing companies.' },
  { id:'us_fwd_pe', pillar:'VALUATION', pillarColor:'#f59e0b', weight:5, source:'Growth investing',
    label:'Forward P/E < 40× (or justified by growth trajectory)', target:'<25× = cheap · 25–40× = fair growth premium · >80× = requires exceptional execution',
    why:'Forward PE anchors valuation to expected earnings. NVDA at 25× fwd PE in 2023 was cheap for 400% EPS growth ahead. Context matters.' },
  { id:'us_mcap', pillar:'VALUATION', pillarColor:'#f59e0b', weight:8, source:'MOSL SQGLP adapted',
    label:'Market Cap $1B–$50B = multibagger runway zone', target:'$1–5B = maximum runway · $5–50B = solid runway · >$150B = limited 10× potential',
    why:'MOSL: sheer size militates against great growth. A $1B company can 100× to $100B. A $300B company needs to become $30T. Focus on $1–50B.' },
  // ── BALANCE SHEET ─────────────────────────────────────────────────────────
  { id:'us_debt', pillar:'BALANCE SHEET', pillarColor:'#10b981', weight:6, source:'Fisher survival filter',
    label:'D/E ≤ 0.5 (low leverage = resilience in downturns)', target:'D/E < 0.5 = clean · <1.0 = acceptable · >2.0 = existential risk in rate hikes',
    why:'US tech cycles can be brutal. High leverage during 2022 rate cycle destroyed companies. D/E < 0.5 = survives any cycle.' },
  { id:'us_net_cash', pillar:'BALANCE SHEET', pillarColor:'#10b981', weight:5, source:'Buffett',
    label:'Net cash position OR ND/EBITDA < 1.5', target:'Net cash = maximum flexibility · ND/EBITDA < 1.0 = safe · >3.0 = CRITICAL',
    why:'Net cash = can fund growth internally, return capital, make acquisitions. Best companies self-fund.' },
  // ── DISCOVERY / SQGLP "S" ─────────────────────────────────────────────────
  { id:'us_discovery', pillar:'DISCOVERY', pillarColor:'#06b6d4', weight:8, source:'MOSL SQGLP "S" adapted',
    label:'Analyst coverage ≤ 10 (undiscovered = institutional re-rating ahead)', target:'≤5 = essentially undiscovered · ≤12 = early · >30 = fully discovered, alpha gone',
    why:'MOSL: low institutional holding = undiscovered. US equivalent = low analyst coverage. When Goldman/MS initiate coverage, the re-rating happens. Be there first.' },
  { id:'us_insider', pillar:'DISCOVERY', pillarColor:'#06b6d4', weight:6, source:'Fisher insider signal',
    label:'Insider ownership ≥ 10% (management skin in game)', target:'>20% = strong alignment · 10–20% = good · <2% = watch carefully',
    why:'Fisher Scuttlebutt: insiders who own significant equity behave differently. Founder-led companies with 15%+ insider ownership consistently outperform.' },
  { id:'us_fwd_growth', pillar:'DISCOVERY', pillarColor:'#06b6d4', weight:5, source:'Forward visibility',
    label:'Forward revenue growth ≥ 20% FY1 (analysts confirm acceleration continues)', target:'>25% = analysts highly confident · <10% = slowdown expected',
    why:'Forward guidance from management + analyst consensus. If consensus sees 25%+ growth ahead, institutional money will follow.' },
  // ── TECHNICAL / MARKET ────────────────────────────────────────────────────
  { id:'us_technical', pillar:'TECHNICAL', pillarColor:'#f97316', weight:5, source:'MOSL price action',
    label:'Price above DMA200 OR within 20% (trend not broken)', target:'Above = uptrend intact · 0 to -20% = consolidating · >-30% = wait for reversal',
    why:'Price action validates fundamental thesis. 100-baggers rarely give long entry windows below DMA200.' },
  { id:'us_52wk', pillar:'TECHNICAL', pillarColor:'#f97316', weight:4, source:'Relative strength',
    label:'Near 52-week high (within 10%) = price confirming thesis', target:'0 to -10% = institutional buying confirmed · <-40% = requires deep dive',
    why:'When fundamentals are accelerating AND price is making new highs, institutions are actively buying. Breakout patterns precede the biggest moves.' },
  { id:'us_perf1y', pillar:'TECHNICAL', pillarColor:'#f97316', weight:3, source:'Momentum',
    label:'1-year performance > 20% (momentum confirming fundamentals)', target:'>50% = exceptional momentum · >20% = positive · Negative = wait for catalyst',
    why:'Price reflects accumulated fundamental insight. Strong 1-year performance with accelerating fundamentals = thesis intact, market agreeing.' },
  // ── SECTOR / TAILWIND ────────────────────────────────────────────────────
  { id:'us_tailwind', pillar:'SECTOR', pillarColor:'#8b5cf6', weight:7, source:'Fisher Stage 1',
    label:'Sector structural tailwind — NOT at cyclical peak', target:'AI infra · Defence · Healthcare IT · Fintech · Space tech = HIGH tailwind',
    why:"Fisher: 'Buy the right industry at the right cycle point.' 100-baggers ride tailwinds + execution, not execution alone. Semiconductor in AI build-out = tailwind. Crypto at peak = cyclical trap." },
  { id:'us_not_cyclical', pillar:'SECTOR', pillarColor:'#8b5cf6', weight:5, source:'Fisher Stage 1',
    label:'Not at peak cyclical moment (avoid sector top)', target:'Avoid: energy at high prices · semis at peak cycle · banks at credit peak',
    why:'Fisher: peak cyclical earnings = P/E looks cheap but earnings will collapse. Cyclical peaks are value traps disguised as value buys.' },
  // ── CATALYSTS ────────────────────────────────────────────────────────────
  { id:'us_catalyst', pillar:'CATALYST', pillarColor:'#ec4899', weight:6, source:'Framework mandatory',
    label:'Visible catalyst for re-rating in next 4–8 quarters', target:'New product launch / margin improvement / market share gain / international expansion',
    why:'Without a visible catalyst, a fundamentally good company can stay cheap for years. Identify the specific trigger that will move valuation.' },
  { id:'us_repeat', pillar:'CATALYST', pillarColor:'#ec4899', weight:5, source:'Framework final filter',
    label:'Growth repeatable for next 4–6 quarters (not one-quarter wonder)', target:"'Did this quarter materially increase probability of higher future earnings?' YES = buy",
    why:'The most important question: can this quarter structurally repeat? Framework: final filter before conviction sizing.' },
];

const USA_CHECKLIST_STORAGE = 'mb_usa_checklist_v1';

function USAChecklist() {
  // PATCH 0461 — memoize the re-score so this component doesn't burn
  // 200-800ms re-parsing localStorage + re-running scoreUSARow on every
  // render. The dependency intentionally includes nothing — we only need
  // to re-score on mount; manual upload/clear is driven through events
  // captured below. (Audit found this was the biggest perf hog on the
  // USA tab.)
  // AUDIT_100 #18 — bump `tick` on cross-tab storage event AND on the existing
  // 'mc:switch-multibagger-tab' custom event so a fresh CSV upload is reflected
  // immediately. Previously deps were [] with no listeners → re-uploads were
  // invisible until a hard browser reload.
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const bump = () => setTick(x => x + 1);
    const onStorage = (e: StorageEvent) => { if (e.key === 'mb_usa_scored_v1') bump(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mc:switch-multibagger-tab', bump as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mc:switch-multibagger-tab', bump as EventListener);
    };
  }, []);
  const usaRows = React.useMemo(() => {
    try {
      const saved = localStorage.getItem('mb_usa_scored_v1');
      if (!saved) return [];
      const parsed = JSON.parse(saved) as USAResult[];
      return parsed.map(r => scoreUSARow(r as unknown as USARow));
    } catch { return []; }
  }, [tick]);
  const [checks, setChecks] = React.useState<Record<string,boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(USA_CHECKLIST_STORAGE)||'{}'); } catch { return {}; }
  });
  const [selectedTicker, setSelectedTicker] = React.useState('');
  const [notes, setNotes] = React.useState<Record<string,string>>(() => {
    try { return JSON.parse(localStorage.getItem('mb_usa_notes_v1')||'{}'); } catch { return {}; }
  });

  const selRow = usaRows.find(r => r.symbol === selectedTicker);

  function toggleCheck(id: string) {
    const next = { ...checks, [id]: !checks[id] };
    setChecks(next);
    localStorage.setItem(USA_CHECKLIST_STORAGE, JSON.stringify(next));
  }
  function updateNote(id: string, v: string) {
    const next = { ...notes, [id]: v };
    setNotes(next);
    localStorage.setItem('mb_usa_notes_v1', JSON.stringify(next));
  }

  const pillars = [...new Set(USA_CHECKLIST.map(c=>c.pillar))];
  const passed = USA_CHECKLIST.filter(c=>checks[c.id]).length;
  const total  = USA_CHECKLIST.length;
  const weightedPass = USA_CHECKLIST.filter(c=>checks[c.id]).reduce((s,c)=>s+c.weight,0);
  const weightedTotal = USA_CHECKLIST.reduce((s,c)=>s+c.weight,0);

  // Auto-check from scored data when ticker selected
  // Returns true/false for items with data, null for missing columns or qualitative items.
  // CRITICAL: optional fields (user hasn't added column) MUST return null not false.
  const autoStatus = (r: USAResult, id: string): boolean | null => {
    switch(id) {
      // ── Always available in base TradingView export ───────────────────────
      case 'us_gm':        return r.grossMarginAnn !== undefined ? r.grossMarginAnn >= 50 : null;
      case 'us_fcf':       return r.fcfMarginAnn !== undefined ? r.fcfMarginAnn >= 15 : null;
      case 'us_revgrowth': return r.revenueGrowthAnn !== undefined ? r.revenueGrowthAnn >= 20 : null;
      case 'us_rev_accel': return r.accelSignal !== undefined ? r.accelSignal === 'ACCELERATING' : null;
      case 'us_ev_ebitda': return r.evEbitda !== undefined ? r.evEbitda < 40 : null;
      case 'us_fwd_pe':    return r.forwardPe !== undefined && r.forwardPe > 0 ? r.forwardPe < 45 : null;
      case 'us_mcap':      return r.marketCapB !== undefined ? r.marketCapB < 50 : null;
      case 'us_net_cash':  return r.netDebtUsd !== undefined ? r.netDebtUsd <= 0 : null;
      // ── Computed from base export (recomputed in scoreUSARow now) ─────────
      case 'us_r40':       return r.ruleOf40 !== undefined ? r.ruleOf40 >= 40 : null;
      case 'us_gm_expand': return r.grossMarginExpansion !== undefined ? r.grossMarginExpansion > 0 : null;
      case 'us_gp_expand': return (r.grossProfitGrowthQtr !== undefined && r.revenueGrowthQtr !== undefined)
                               ? r.grossProfitGrowthQtr > r.revenueGrowthQtr : null;
      // ── Optional: user must add column to TradingView export ─────────────
      case 'us_roe':       return r.roe !== undefined ? r.roe >= 20 : null;
      case 'us_roic':      return r.roic !== undefined ? r.roic >= 15 : null;
      case 'us_eps_growth': return r.epsGrowth !== undefined ? r.epsGrowth >= 20 : null;
      case 'us_growth_sustained': return r.revGrowth3yr !== undefined ? r.revGrowth3yr >= 15 : null;
      case 'us_peg':       return r.peg !== undefined && r.peg > 0 ? r.peg < 1.5 : null;
      case 'us_debt':      return r.de !== undefined ? r.de <= 0.5 : null;
      case 'us_discovery': return r.analystCount !== undefined ? r.analystCount <= 10 : null;
      case 'us_insider':   return r.insiderOwnership !== undefined ? r.insiderOwnership >= 10 : null;
      case 'us_fwd_growth': return r.forwardRevGrowth !== undefined ? r.forwardRevGrowth >= 20 : null;
      case 'us_technical': return r.pctFrom52wHigh !== undefined ? r.pctFrom52wHigh >= -20 : null;
      case 'us_52wk':      return r.pctFrom52wHigh !== undefined ? r.pctFrom52wHigh >= -10 : null;
      case 'us_perf1y':    return r.perf1y !== undefined ? r.perf1y >= 20 : null;
      // ── Qualitative — user must assess manually ───────────────────────────
      default: return null;
    }
  };

  // Auto-tick all auto-determinable items when ticker changes
  // FIX: "if auto-pass it should be ticked already" — auto-pass = auto-check
  const applyAutoChecks = (row: USAResult) => {
    const autoUpdates: Record<string, boolean> = {};
    for (const item of USA_CHECKLIST) {
      const result = autoStatus(row, item.id);
      if (result !== null) autoUpdates[item.id] = result; // tick=true for pass, untick=false for fail
    }
    setChecks(prev => {
      // Qualitative items (result===null) keep manual state; auto items get overridden
      const merged = { ...prev, ...autoUpdates };
      localStorage.setItem(USA_CHECKLIST_STORAGE, JSON.stringify(merged));
      return merged;
    });
  };

  return (
    <div style={{maxWidth:1800,margin:'0 auto',padding:'28px 20px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24,flexWrap:'wrap',gap:12}}>
        <div>
          <div style={{fontSize:F.h2,fontWeight:800,color:'#38bdf8',marginBottom:4}}>🇺🇸 USA Research Checklist</div>
          <div style={{fontSize:F.md,color:MUTED}}>{total} criteria · Fisher 100-Bagger + MOSL SQGLP adapted + Rule of 40</div>
        </div>
        <div style={{display:'flex',gap:12,alignItems:'center'}}>
          {usaRows.length > 0 && (
            <select value={selectedTicker} onChange={e=>{
              const ticker = e.target.value;
              setSelectedTicker(ticker);
              if (ticker) {
                const row = usaRows.find(r => r.symbol === ticker);
                if (row) applyAutoChecks(row);
              }
            }}
              style={{padding:'8px 14px',backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:8,color:TEXT,fontSize:F.sm,cursor:'pointer'}}>
              <option value=''>Select stock — auto-ticks all checkable items...</option>
              {usaRows.slice(0,20).map(r=><option key={r.symbol} value={r.symbol}>{r.symbol} — {r.grade} ({r.score})</option>)}
            </select>
          )}
          <div style={{padding:'10px 18px',backgroundColor:passed>=20?`${GREEN}18`:passed>=12?`${YELLOW}18`:`${RED}18`,border:`1px solid ${passed>=20?GREEN:passed>=12?YELLOW:RED}30`,borderRadius:10,textAlign:'center'}}>
            <div style={{fontSize:F.h2,fontWeight:900,color:passed>=20?GREEN:passed>=12?YELLOW:RED}}>{passed}/{total}</div>
            <div style={{fontSize:F.xs,color:MUTED}}>checked · {Math.round(weightedPass/weightedTotal*100)}% weighted</div>
          </div>
        </div>
      </div>

      {pillars.map(pillar => {
        const items = USA_CHECKLIST.filter(c=>c.pillar===pillar);
        const pPassed = items.filter(c=>checks[c.id]).length;
        const pColor = items[0].pillarColor;
        return (
          <div key={pillar} style={{marginBottom:24}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,borderBottom:`1px solid ${BORDER}`,paddingBottom:8}}>
              <span style={{fontSize:F.md,fontWeight:800,color:pColor,letterSpacing:'0.5px'}}>{pillar}</span>
              <span style={{fontSize:F.xs,color:MUTED,fontWeight:600}}>{pPassed}/{items.length} checked</span>
              <div style={{flex:1,height:4,backgroundColor:`rgba(255,255,255,0.06)`,borderRadius:2}}>
                <div style={{height:'100%',width:`${pPassed/items.length*100}%`,backgroundColor:pColor,borderRadius:2,transition:'width 0.3s'}}/>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(460px,1fr))',gap:10}}>
              {items.map(item => {
                const auto = selRow ? autoStatus(selRow, item.id) : null;
                const checked = checks[item.id] ?? false;
                const note = notes[item.id] ?? '';
                return (
                  <div key={item.id} style={{
                    padding:'14px 16px',backgroundColor:checked?`${pColor}08`:CARD_BG,
                    border:`1px solid ${checked?pColor+'40':BORDER}`,
                    borderLeft:`3px solid ${checked?pColor:auto===true?`${pColor}60`:auto===false?`${RED}40`:BORDER}`,
                    borderRadius:8,transition:'all 0.15s',
                  }}>
                    <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                      <button onClick={()=>toggleCheck(item.id)} style={{
                        width:22,height:22,borderRadius:5,border:`2px solid ${checked?pColor:BORDER}`,
                        backgroundColor:checked?pColor:'transparent',flexShrink:0,marginTop:2,cursor:'pointer',
                        display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:14,
                      }}>{checked?'✓':''}</button>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                          <span style={{fontSize:F.md,fontWeight:700,color:checked?TEXT:`${TEXT}CC`}}>{item.label}</span>
                          <span style={{fontSize:F.xs,color:MUTED}}>w:{item.weight}</span>
                          {auto !== null && (
                            <span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:10,
                              backgroundColor:auto?`${GREEN}18`:`${RED}18`,color:auto?GREEN:RED}}>
                              {auto?'✅ data confirms':'❌ data fails'}
                            </span>
                          )}
                          {auto === null && selRow && (
                            <span style={{fontSize:10,color:MUTED,padding:'2px 6px',borderRadius:10,backgroundColor:`${MUTED}10`}}>
                              ⬜ no data / qualitative
                            </span>
                          )}
                        </div>
                        <div style={{fontSize:F.xs,color:YELLOW,marginBottom:4}}>🎯 {item.target}</div>
                        <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.5}}>{item.why}</div>
                        <div style={{fontSize:F.xs,color:`${MUTED}70`,marginTop:3}}>Source: {item.source}</div>
                        <textarea
                          value={note}
                          onChange={e=>updateNote(item.id,e.target.value)}
                          placeholder="Your notes..."
                          rows={1}
                          style={{width:'100%',marginTop:6,backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:6,padding:'6px 10px',color:MUTED,fontSize:F.xs,resize:'none',boxSizing:'border-box'}}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const USA_STORAGE_KEY = 'mb_usa_scored_v1';

function USACompare() {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [rows, setRowsState] = React.useState<USAResult[]>(() => {
    try {
      const saved = localStorage.getItem(USA_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as USAResult[];
        const rescored = parsed.map(r => scoreUSARow(r as unknown as USARow));
        return applyUSARanking(rescored.sort((a,b)=>b.score-a.score));
      }
    } catch {}
    return [];
  });
  const [loading, setLoading] = React.useState(false);
  const [parseError, setParseError] = React.useState('');
  const [fileName, setFileName] = React.useState('');
  const [expRow, setExpRow] = React.useState<string|null>(null);
  const [expandAll, setExpandAll] = React.useState(false);
  const [gradeFilter, setGradeFilter] = React.useState<Set<string>>(new Set(['ALL']));
  const [accelOnly, setAccelOnly] = React.useState(false);
  // PATCH 1101dd — Good Only toggle for USA tab (parity with India).
  // "Good" = score ≥ 60 AND accelerating (not decelerating) AND no critical fraud
  // risks AND R40 ≥ 0. Catches the spirit of India's gooCompanies filter.
  const [usGoodOnly, setUsGoodOnly] = React.useState(false);
  const [usPeMax,       setUsPeMax]       = React.useState<'ALL'|15|25|40|60|100>('ALL');
  const [usPegMax,      setUsPegMax]      = React.useState<'ALL'|0.8|1.0|1.5|2.0>('ALL');
  const [usFcfOnly,     setUsFcfOnly]     = React.useState(false);
  const [usRatingFilter,setUsRatingFilter]= React.useState<'ALL'|'BUY'|'STRONG_BUY'>('ALL');
  // PATCH 0345 — Rule of 40 tiered filter. R40 is the canonical SaaS/growth
  // institutional benchmark. ≥40 = passes; ≥60 = strong; ≥80 = elite (NVDA/PLTR tier).
  const [usR40Min,      setUsR40Min]      = React.useState<'ALL'|40|60|80>('ALL');
  // PATCH 0345 — Piotroski quality filter (≥7 = elite Greenblatt/Piotroski tier)
  const [usPiotroskiMin,setUsPiotroskiMin]= React.useState<'ALL'|5|7>('ALL');
  // PATCH 0345 — GPM quality filter (≥50% = real moat; ≥70% = elite SaaS)
  const [usGpmMin,      setUsGpmMin]      = React.useState<'ALL'|40|60|70>('ALL');
  // PATCH 0347 — Decision filter for USA tab
  const [usDecisionFilter, setUsDecisionFilter] = React.useState<'ALL'|'WITH'|'NONE'|DecisionStatus>('ALL');
  const [usDecisionsV, setUsDecisionsV] = React.useState(0);
  const bumpUsDecisions = React.useCallback(() => setUsDecisionsV(v => v + 1), []);
  React.useEffect(() => subscribeDecisions(() => bumpUsDecisions()), [bumpUsDecisions]);
  // Touch usDecisionsV so it's read on render (avoids unused-var lint)
  void usDecisionsV;
  // USA sortable columns
  type USASort = 'score'|'fwdPe'|'peg'|'revGrowthAnn'|'ruleOf40'|'fcfMargin'|'marketCapB'|'grossMargin';
  const [usSortField, setUsSortField] = React.useState<USASort>('score');
  const [usSortAsc,   setUsSortAsc]   = React.useState(false);
  function handleUSASort(field: USASort) {
    if (usSortField===field) { setUsSortAsc(v=>!v); return; }
    setUsSortField(field);
    setUsSortAsc(['fwdPe','peg','marketCapB'].includes(field));
  }
  const usSortIcon = (f: USASort) => usSortField===f ? (usSortAsc?' ▲':' ▼') : '';
  // USA score baseline
  const USA_PREV_KEY = 'mb_usa_prev_scores_v1';
  const usPrevScores = React.useMemo<Record<string,number>>(() => {
    try { return JSON.parse(localStorage.getItem(USA_PREV_KEY)||'{}'); } catch { return {}; }
  }, []);

  function setRows(r: USAResult[]) {
    const ranked = applyUSARanking(r);
    setRowsState(ranked);
    const __mbUsa = JSON.stringify(ranked);
    try {
      localStorage.setItem(USA_STORAGE_KEY, __mbUsa);
      // AUDIT_100 #77 — stamp the upload time so we can warn when the
      // CSV is > 60 days old (stale fundamentals vs fresh price risk
      // called out in CLAUDE.md §10.10).
      localStorage.setItem('mb_usa_uploaded_at_v1', String(Date.now()));
      // PATCH 0471 — broadcast cross-tab update so Re-rating/Signals refresh
      // their derived universes immediately after a USA upload (matches
      // India behaviour set up in 0453 P1-18).
      window.dispatchEvent(new CustomEvent('mb-upload:updated', { detail: { market: 'USA', count: ranked.length } }));
    } catch {}
    // PATCH 1101v — Mirror to Railway snapshot so USA survives browser eviction
    // (same architecture as 1101m for India). Fire-and-forget — UI doesn't wait.
    mbServerSnapshotSave(__mbUsa, ranked.length, 'USA').then((ok) => {
      try { console.log('[mb-persist] USA server snapshot save →', ok ? 'OK' : 'FAILED'); } catch {}
    });
  }
  // PATCH 1101v — Hydrate USA from Railway on mount when localStorage has
  // fewer rows. Same pattern as India hydration but for the USA market key.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const lsRaw = localStorage.getItem(USA_STORAGE_KEY);
        let localCount = 0;
        try { localCount = lsRaw ? (JSON.parse(lsRaw) as any[])?.length || 0 : 0; } catch {}
        const serverRaw = await mbServerSnapshotLoad('USA');
        if (!alive || !serverRaw) return;
        let serverRows: any[] = [];
        try { serverRows = JSON.parse(serverRaw); } catch {}
        if (!Array.isArray(serverRows) || !serverRows.length) return;
        if (serverRows.length < localCount) {
          try { console.log(`[mb-usa] Railway has ${serverRows.length} < local ${localCount}, keeping local`); } catch {}
          return;
        }
        try { console.log(`[mb-usa] restored ${serverRows.length} USA stocks from Railway (local had ${localCount})`); } catch {}
        setRowsState(applyUSARanking(serverRows as USAResult[]));
        try { localStorage.setItem(USA_STORAGE_KEY, serverRaw); } catch {}
        try { window.dispatchEvent(new CustomEvent('mb-upload:updated', { detail: { market: 'USA', count: serverRows.length } })); } catch {}
      } catch (e) {
        try { console.warn('[mb-usa] Railway hydrate failed', e); } catch {}
      }
    })();
    return () => { alive = false; };
  }, []);
  // AUDIT_100 #77 — age of the loaded data set in days
  const usaUploadAgeDays = React.useMemo(() => {
    try {
      const stamp = parseInt(localStorage.getItem('mb_usa_uploaded_at_v1') || '0', 10);
      if (!stamp || isNaN(stamp)) return null;
      return Math.floor((Date.now() - stamp) / (1000 * 60 * 60 * 24));
    } catch { return null; }
  }, [rows.length]);

  async function handleFiles(files: FileList | File[]) {
    setParseError(''); setLoading(true);
    // PATCH 0872 — Capture pre-upload USA baseline FIRST (was previously
    // written AFTER scoring, which made PREV==CURRENT and zeroed every
    // USA score-delta indicator in MultibaggerAnalytics).
    try { localStorage.setItem(USA_PREV_KEY, JSON.stringify(Object.fromEntries(rows.map(r=>[r.symbol,r.score])))); } catch {}
    try {
      const XLSX = await import('xlsx');
      const arr = Array.from(files);
      const allRows: USARow[] = [];
      const seenSymbols = new Set(rows.map(r=>r.symbol));
      // PATCH 0347 — Cross-market detection on USA upload
      const allHeaders: string[] = [];
      // PATCH 1101kk — Track which TradingView CSV each ticker came from so
      // 🎯 MULTI-CONFIRMED PICKS populates for USA too. India does this via
      // _screenerMap during parsing; USA was just scoring + merging blindly,
      // so user kept seeing "Re-upload your screens" even after 3 uploads.
      const _usaScreenerMap = new Map<string, string[]>();
      for (const file of arr) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type:'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet, { defval:'' });
        if (raw.length > 0) allHeaders.push(...Object.keys(raw[0]));
        for (const r of raw) {
          const parsed = parseUSARow(r as Record<string,unknown>);
          if (!parsed) continue;
          // Record which file this ticker appeared in (even for duplicates).
          const existing = _usaScreenerMap.get(parsed.symbol) ?? [];
          if (!existing.includes(file.name)) existing.push(file.name);
          _usaScreenerMap.set(parsed.symbol, existing);
          if (seenSymbols.has(parsed.symbol)) continue;
          seenSymbols.add(parsed.symbol);
          allRows.push(parsed);
        }
      }
      const detectedMarket = detectCsvMarket(allHeaders);
      if (detectedMarket === 'IN') {
        const proceed = window.confirm(
          `⚠️ This CSV looks like an INDIA Screener.in export (found Indian-specific columns like Promoter holding, ROCE, Sales growth).\n\nYou're currently on the USA tab.\n\nClick OK to switch to India Multibagger tab and upload there.\nClick Cancel to upload here anyway (may produce empty/wrong scores).`
        );
        if (proceed) {
          // Dispatch a custom event the parent page can listen to
          window.dispatchEvent(new CustomEvent('mc:switch-multibagger-tab', { detail: { tab: 'excel' } }));
          setLoading(false);
          return;
        }
      }
      // PATCH 1101kk — Re-upload-only case: every ticker already in dataset.
      // Still flush screener-membership onto existing rows so MULTI-CONFIRMED
      // picks update without forcing user to clear data first.
      if (!allRows.length && rows.length > 0) {
        const rowsWithScreeners = rows.map(r => {
          const newSources = _usaScreenerMap.get(r.symbol);
          if (!newSources || newSources.length === 0) return r;
          const existing = ((r as any)._screeners as string[] | undefined) ?? [];
          const merged = Array.from(new Set([...existing, ...newSources]));
          return { ...r, _screeners: merged } as any;
        });
        setRows(rowsWithScreeners);
        setFileName(`Screener membership refreshed · ${arr.length} file${arr.length>1?'s':''} · ${rows.length} stocks`);
        setLoading(false); return;
      }
      if (!allRows.length) { setParseError('No valid rows found. Ensure the file has a Symbol column.'); setLoading(false); return; }
      // PATCH 1101kk — Attach _screeners from CSVs to each newly-scored row.
      const scored = allRows.map(r => {
        const s = scoreUSARow(r);
        const sc = _usaScreenerMap.get(r.symbol) ?? [];
        return { ...s, _screeners: sc } as any;
      });
      // PATCH 1101kk — Also merge new screener files onto pre-existing rows.
      const existingMerged = rows.map(r => {
        const newSources = _usaScreenerMap.get(r.symbol);
        if (!newSources || newSources.length === 0) return r;
        const existing = ((r as any)._screeners as string[] | undefined) ?? [];
        const m = Array.from(new Set([...existing, ...newSources]));
        return { ...r, _screeners: m } as any;
      });
      const merged = [...existingMerged, ...scored].sort((a,b)=>b.score-a.score);
      setRows(merged);
      // PATCH 0872 — Pre-upload baseline saved at TOP of handleFiles now.
      setFileName(`${arr.length} file${arr.length>1?'s':''} · ${merged.length} stocks`);
    } catch(e) { setParseError(`Error: ${e instanceof Error?e.message:String(e)}`); }
    setLoading(false);
  }

  const GRADES: USAGrade[] = ['A+','A','B+','B','C','D'];
  const GRADE_COLOR_US: Record<USAGrade,string> = {'A+':'#10b981','A':'#34d399','B+':'#f59e0b','B':'#f97316','C':'#fb923c','D':'#ef4444'};
  let filtered = gradeFilter.has('ALL') ? rows : rows.filter(r=>gradeFilter.has(r.grade));
  if (accelOnly)        filtered = filtered.filter(r=>r.accelSignal==='ACCELERATING');
  if (usFcfOnly)        filtered = filtered.filter(r=>(r.fcfMarginAnn ?? -99) >= 10);
  // PATCH 1101dd — Good Only USA composite filter
  const usaGoodCompanies = rows.filter(r =>
       r.score >= 60
    && r.accelSignal !== 'DECELERATING'
    && (r.ruleOf40 ?? 0) >= 0
    && !(r.risks || []).some((s: string) => s.includes('🛑') || s.includes('NEVER BUY') || s.includes('CRITICAL'))
  );
  if (usGoodOnly) filtered = filtered.filter(r => usaGoodCompanies.includes(r));
  // PATCH 0345 — Rule of 40 / Piotroski / GPM filters compose AND-style
  if (usR40Min !== 'ALL')       filtered = filtered.filter(r=>(r.ruleOf40 ?? -999) >= usR40Min);
  if (usPiotroskiMin !== 'ALL') filtered = filtered.filter(r=>(r.piotroskiFScore ?? -1) >= usPiotroskiMin);
  if (usGpmMin !== 'ALL')       filtered = filtered.filter(r=>{
    const gm = r.grossMarginTtm ?? r.grossMarginAnn;
    return gm !== undefined && gm >= usGpmMin;
  });
  // PATCH 0347 — decision filter for USA
  if (usDecisionFilter !== 'ALL') {
    filtered = filtered.filter(r => {
      const d = getDecision(r.symbol);
      if (usDecisionFilter === 'WITH') return !!d;
      if (usDecisionFilter === 'NONE') return !d;
      return d?.status === usDecisionFilter;
    });
  }
  // Analyst Rating filter
  if (usRatingFilter === 'BUY')       filtered = filtered.filter(r => r.analystRating?.toLowerCase().includes('buy'));
  if (usRatingFilter === 'STRONG_BUY')filtered = filtered.filter(r => r.analystRating?.toLowerCase().includes('strong buy'));
  // P/E filter uses forwardPe first (more forward-looking), falls back to trailing P/E
  if (usPeMax  !== 'ALL') filtered = filtered.filter(r=>{
    const pe = r.forwardPe && r.forwardPe > 0 ? r.forwardPe : r.pe;
    return pe !== undefined && pe > 0 && pe <= usPeMax;
  });
  if (usPegMax !== 'ALL') filtered = filtered.filter(r=>r.peg !== undefined && r.peg > 0 && r.peg <= usPegMax);
  // Apply USA sort
  filtered = [...filtered].sort((a,b) => {
    const getV = (r: USAResult): number => {
      switch(usSortField) {
        case 'fwdPe':       return (r.forwardPe&&r.forwardPe>0?r.forwardPe:r.pe) ?? (usSortAsc?999:-1);
        case 'peg':         return r.peg ?? (usSortAsc?999:-1);
        case 'revGrowthAnn':return r.revenueGrowthAnn ?? (usSortAsc?-1:999);
        case 'ruleOf40':    return r.ruleOf40 ?? (usSortAsc?-1:999);
        case 'fcfMargin':   return r.fcfMarginAnn ?? (usSortAsc?-1:999);
        case 'marketCapB':  return r.marketCapB ?? (usSortAsc?999:-1);
        case 'grossMargin': return (r.grossMarginTtm??r.grossMarginAnn) ?? (usSortAsc?-1:999);
        default:            return r.score;
      }
    };
    const av=getV(a), bv=getV(b);
    return usSortAsc ? av-bv : bv-av;
  });

  return (
    <div style={{maxWidth:1800,margin:'0 auto',padding:'28px 20px'}}>
      {/* Header */}
      <div style={{marginBottom:20,padding:'18px 20px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:12}}>
        <div style={{fontSize:F.lg,fontWeight:800,color:'#38bdf8',marginBottom:8}}>🇺🇸 USA Multibagger — TradingView Export</div>
        <div style={{fontSize:F.md,color:MUTED,lineHeight:1.8,marginBottom:12}}>
          Export from TradingView Screener as CSV and upload. All columns auto-detected.
          <span style={{color:YELLOW}}> Recommended extra columns to add:</span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8}}>
          {[
            // ── Base export (always present in TradingView) ──────────────────
            {field:'Gross margin %, Trailing 12 months', why:'GPM TTM — pricing power & moat ✅ confirmed in TradingView'},
            {field:'Free cash flow margin %, Annual', why:'FCF quality ✅ confirmed in TradingView'},
            {field:'Operating margin %, Trailing 12 months', why:'Operational efficiency ✅ in TradingView'},
            {field:'Return on equity %, Trailing 12 months', why:'Returns quality ✅ in TradingView'},
            // ── Add these — confirmed to exist in TradingView ────────────────
            {field:'Earnings per share diluted growth %, TTM YoY', why:'EPS growth — Fisher Twin Engine ✅ added'},
            {field:'Return on invested capital %, Annual', why:'ROIC — capital efficiency ✅ added'},
            {field:'Debt to equity ratio, Quarterly', why:'Leverage ✅ added'},
            {field:'Net margin %, Trailing 12 months', why:'Net profitability ✅ added'},
            {field:'Performance % 1 year', why:'1-year momentum ✅ added'},
            {field:'Revenue growth %, 5 year CAGR', why:'Sustained growth vs spike check ✅ added'},
            {field:'Price to earning to growth, Trailing 12 months', why:'PEG — growth-adjusted valuation ✅ added'},
            {field:'Analyst Rating', why:'Buy/Strong Buy/Sell — consensus signal ✅ added'},
            // ── Still to add — exist in TradingView ──────────────────────────
            {field:'Relative strength index, 14', why:'🆕 RSI momentum — overbought/oversold signal'},
            {field:'Price to free cash flow, TTM', why:'🆕 P/FCF — Buffett preferred valuation metric'},
          ].map(({field,why})=>(
            <div key={field} style={{padding:'8px 12px',backgroundColor:CARD2,borderRadius:6,border:`1px solid ${BORDER}`}}>
              <div style={{fontSize:F.sm,fontWeight:700,color:ACCENT}}>{field}</div>
              <div style={{fontSize:F.xs,color:MUTED}}>{why}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Upload */}
      <div
        onClick={()=>fileRef.current?.click()}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();if(e.dataTransfer.files.length)handleFiles(e.dataTransfer.files);}}
        style={{marginBottom:20,padding:'32px 24px',border:`2px dashed #38bdf840`,borderRadius:14,textAlign:'center',cursor:'pointer',backgroundColor:'#38bdf805'}}
      >
        <div style={{fontSize:40,marginBottom:10}}>{loading?'⏳':'📁'}</div>
        <div style={{fontSize:F.xl,fontWeight:700,color:'#38bdf8'}}>
          {loading?'Scoring...' : fileName?`✅ ${fileName}` : 'Upload TradingView CSV'}
        </div>
        <div style={{fontSize:F.md,color:MUTED,marginTop:6}}>Export any TradingView screen · .csv · all columns auto-detected</div>
        <input ref={fileRef} type="file" accept=".csv,.xlsx" multiple style={{display:'none'}}
          onChange={e=>{if(e.target.files?.length)handleFiles(e.target.files);}} />
      </div>
      {parseError && <div style={{marginBottom:14,padding:'12px',backgroundColor:`${RED}10`,border:`1px solid ${RED}30`,borderRadius:10,fontSize:F.md,color:RED}}>{parseError}</div>}

      {rows.length>0&&(
        <>
          {/* AUDIT_100 #77 — data-staleness banner. When the loaded CSV is more
              than 60 days old, warn that fundamentals may not reflect recent
              earnings releases / price moves. */}
          {usaUploadAgeDays != null && usaUploadAgeDays > 60 && (
            <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8,
              backgroundColor: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)',
              color: 'var(--mc-warn)', fontSize: 12, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 16 }}>⚠</span>
              <span>
                STALE FUNDAMENTALS: this CSV was uploaded <strong>{usaUploadAgeDays} days ago</strong>.
                New earnings + price action since then are not reflected. Re-export from TradingView for current scores.
              </span>
            </div>
          )}
          {/* Summary */}
          <div style={{display:'flex',gap:14,marginBottom:18,flexWrap:'wrap',alignItems:'stretch'}}>
            {[
              {label:'Scored',value:rows.length,color:'#38bdf8'},
              {label:'Top Picks (B+)',value:rows.filter(r=>['A+','A','B+'].includes(r.grade)).length,color:GREEN},
              {label:'Best Score',value:rows[0]?.score??0,color:rows[0]?.score>=72?GREEN:YELLOW},
              {label:'Avg Score',value:Math.round(rows.reduce((a,r)=>a+r.score,0)/rows.length),color:MUTED},
            ].map(({label,value,color})=>(
              <div key={label} style={{padding:'14px 22px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:10,textAlign:'center'}}>
                <div style={{fontSize:F.h1,fontWeight:900,color}}>{value}</div>
                <div style={{fontSize:F.sm,color:MUTED,marginTop:2}}>{label}</div>
              </div>
            ))}
            <div style={{display:'flex',gap:6,alignItems:'center',marginLeft:'auto',flexWrap:'wrap'}}>
              {/* PATCH 1101dd — Good Only filter on USA tab (parity with India). */}
              <button
                onClick={()=>setUsGoodOnly(v=>!v)}
                style={{
                  fontSize:F.sm,fontWeight:800,padding:'8px 16px',borderRadius:8,
                  border:`2px solid ${usGoodOnly?GREEN+'80':BORDER}`,
                  background:usGoodOnly?`${GREEN}18`:'transparent',
                  color:usGoodOnly?GREEN:MUTED,
                  cursor:'pointer',
                }}
                title="Score ≥ 60 · not decelerating · R40 ≥ 0 · no critical fraud / NEVER-BUY risks"
              >
                {usGoodOnly?`✅ Good Only (${usaGoodCompanies.length})`:`🔍 Good Only`}
              </button>
              <div style={{width:1,background:BORDER,height:24}}/>
              {(['ALL',...GRADES] as const).map(g=>{
                const active=gradeFilter.has(g);
                const col=GRADE_COLOR_US[g as USAGrade]||'#38bdf8';
                return <button key={g} onClick={()=>{
                  if(g==='ALL'){setGradeFilter(new Set(['ALL']));return;}
                  setGradeFilter(prev=>{const n=new Set(prev);n.delete('ALL');if(n.has(g)){n.delete(g);if(n.size===0)n.add('ALL');}else n.add(g);return n;});
                }} style={{fontSize:F.sm,fontWeight:700,padding:'7px 12px',borderRadius:8,border:`1px solid ${active?col+'60':BORDER}`,background:active?col+'18':'transparent',color:active?col:MUTED,cursor:'pointer'}}>
                  {g}{g!=='ALL'&&` (${rows.filter(r=>r.grade===g).length})`}
                </button>;
              })}
              <button onClick={()=>setAccelOnly(v=>!v)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${accelOnly?GREEN+'60':BORDER}`,background:accelOnly?`${GREEN}14`:'transparent',color:accelOnly?GREEN:MUTED,cursor:'pointer'}}>
                🚀 Accelerating ({rows.filter(r=>r.accelSignal==='ACCELERATING').length})
              </button>
              <button onClick={()=>setUsFcfOnly(v=>!v)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${usFcfOnly?'#38bdf8'+'60':BORDER}`,background:usFcfOnly?`${'#38bdf8'}14`:'transparent',color:usFcfOnly?'#38bdf8':MUTED,cursor:'pointer'}}>
                💰 FCF≥10% ({rows.filter(r=>(r.fcfMarginAnn??-99)>=10).length})
              </button>

              {/* PATCH 0345 — Rule of 40 tiered filter (composes AND-style with others) */}
              <div style={{width:1,background:BORDER,height:18}}/>
              <span style={{fontSize:F.xs,color:'var(--mc-state-persistent)',fontWeight:700}}>R40:</span>
              {(['ALL',40,60,80] as const).map(v=>(
                <button key={String(v)} onClick={()=>setUsR40Min(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${usR40Min===v?'color-mix(in srgb, var(--mc-state-persistent) 38%, transparent)':BORDER}`,background:usR40Min===v?'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)':'transparent',color:usR40Min===v?'var(--mc-state-persistent)':MUTED,cursor:'pointer'}}>
                  {v==='ALL'?'All':`≥${v}${v===80?' 🏆':''}`}
                  {v!=='ALL' && ` (${rows.filter(r=>(r.ruleOf40 ?? -999) >= v).length})`}
                </button>
              ))}

              {/* PATCH 0345 — Piotroski F-score filter (≥5 clean, ≥7 elite) */}
              {rows.some(r=>r.piotroskiFScore !== undefined) && <>
                <div style={{width:1,background:BORDER,height:18}}/>
                <span style={{fontSize:F.xs,color:'var(--mc-bullish)',fontWeight:700}}>Piotroski:</span>
                {(['ALL',5,7] as const).map(v=>(
                  <button key={String(v)} onClick={()=>setUsPiotroskiMin(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                    border:`1px solid ${usPiotroskiMin===v?'color-mix(in srgb, var(--mc-bullish) 38%, transparent)':BORDER}`,background:usPiotroskiMin===v?'color-mix(in srgb, var(--mc-bullish) 8%, transparent)':'transparent',color:usPiotroskiMin===v?'var(--mc-bullish)':MUTED,cursor:'pointer'}}>
                    {v==='ALL'?'All':`≥${v}${v===7?'/9 💎':''}`}
                    {v!=='ALL' && ` (${rows.filter(r=>(r.piotroskiFScore ?? -1) >= v).length})`}
                  </button>
                ))}
              </>}

              {/* PATCH 0345 — Gross margin filter (moat signature) */}
              <div style={{width:1,background:BORDER,height:18}}/>
              <span style={{fontSize:F.xs,color:'#34d399',fontWeight:700}}>GPM:</span>
              {(['ALL',40,60,70] as const).map(v=>(
                <button key={String(v)} onClick={()=>setUsGpmMin(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${usGpmMin===v?'#34d39960':BORDER}`,background:usGpmMin===v?'#34d39914':'transparent',color:usGpmMin===v?'#34d399':MUTED,cursor:'pointer'}}>
                  {v==='ALL'?'All':`≥${v}%`}
                  {v!=='ALL' && ` (${rows.filter(r=>{const gm=r.grossMarginTtm??r.grossMarginAnn;return gm!==undefined && gm>=v;}).length})`}
                </button>
              ))}

              {/* PATCH 0347 — Decision logbook filter */}
              <div style={{width:1,background:BORDER,height:18}}/>
              <span style={{fontSize:F.xs,color:'#38bdf8',fontWeight:700}}>📒 Decision:</span>
              {([
                {k:'ALL' as const, label:'All', col:MUTED},
                {k:'BUY' as const, label:'✅ BUY', col:'#10b981'},
                {k:'WATCH' as const, label:'👁 WATCH', col:'#f59e0b'},
                {k:'NEUTRAL' as const, label:'⚪ NEUTRAL', col:'#94a3b8'},
                {k:'REJECTED' as const, label:'❌ REJECTED', col:'#ef4444'},
              ]).map(({k,label,col})=>(
                <button key={k} onClick={()=>setUsDecisionFilter(p=>p===k?'ALL':k)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${usDecisionFilter===k?col+'60':BORDER}`,background:usDecisionFilter===k?col+'18':'transparent',color:usDecisionFilter===k?col:MUTED,cursor:'pointer'}}>
                  {label} {k!=='ALL' && `(${rows.filter(r=>getDecision(r.symbol)?.status===k).length})`}
                </button>
              ))}

              {/* Analyst Rating filter — only shown when data has ratings */}
              {rows.some(r=>r.analystRating) && <>
                <div style={{width:1,background:BORDER,height:18}}/>
                <span style={{fontSize:F.xs,color:'var(--mc-warn)',fontWeight:700}}>ANALYST:</span>
                {([
                  {k:'ALL' as const, label:'All', col:MUTED},
                  {k:'BUY' as const, label:'Buy+', col:GREEN},
                  {k:'STRONG_BUY' as const, label:'Strong Buy', col:'#10b981'},
                ] as const).map(({k,label,col})=>(
                  <button key={k} onClick={()=>setUsRatingFilter(p=>p===k?'ALL':k)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                    border:`1px solid ${usRatingFilter===k?col+'60':BORDER}`,background:usRatingFilter===k?col+'18':'transparent',color:usRatingFilter===k?col:MUTED,cursor:'pointer'}}>
                    {label} {k!=='ALL'&&`(${rows.filter(r=>k==='BUY'?r.analystRating?.toLowerCase().includes('buy'):r.analystRating?.toLowerCase().includes('strong buy')).length})`}
                  </button>
                ))}
              </>}

              {/* Fwd P/E filter */}
              <div style={{width:1,background:BORDER,height:18}}/>
              <span style={{fontSize:F.xs,color:MUTED,fontWeight:700}}>Fwd P/E:</span>
              {(['ALL',15,25,40,60,100] as const).map(v=>(
                <button key={String(v)} onClick={()=>setUsPeMax(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${usPeMax===v?YELLOW+'60':BORDER}`,background:usPeMax===v?`${YELLOW}14`:'transparent',color:usPeMax===v?YELLOW:MUTED,cursor:'pointer'}}>
                  {v==='ALL'?'All':`<${v}×`}
                </button>
              ))}

              {/* PEG filter */}
              <div style={{width:1,background:BORDER,height:18}}/>
              <span style={{fontSize:F.xs,color:MUTED,fontWeight:700}}>PEG:</span>
              {(['ALL',0.8,1.0,1.5,2.0] as const).map(v=>(
                <button key={String(v)} onClick={()=>setUsPegMax(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${usPegMax===v?GREEN+'60':BORDER}`,background:usPegMax===v?`${GREEN}14`:'transparent',color:usPegMax===v?GREEN:MUTED,cursor:'pointer'}}>
                  {v==='ALL'?'All':`<${v}`}
                </button>
              ))}

              <button onClick={()=>{setExpandAll(v=>!v);setExpRow(null);}} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,cursor:'pointer',border:`1px solid ${expandAll?ACCENT+'60':BORDER}`,background:expandAll?ACCENT+'14':'transparent',color:expandAll?ACCENT:MUTED}}>
                {expandAll?'⊟ Collapse All':'⊞ Expand All'}
              </button>
              <span style={{fontSize:F.xs,color:MUTED}}>{filtered.length} showing</span>
              {/* CSV Export USA */}
              {filtered.length > 0 && (
                <button onClick={async ()=>{
                  const XLSX = await import('xlsx');
                  const data = filtered.map(r=>({
                    Symbol:r.symbol, Company:r.company, Score:r.score, Grade:r.grade,
                    Sector:r.sector, Exchange:r.exchange, 'MCap $B':r.marketCapB,
                    'Rev Growth Ann %':r.revenueGrowthAnn, 'Rev Growth Qtr %':r.revenueGrowthQtr,
                    'Gross Margin %':r.grossMarginTtm??r.grossMarginAnn, 'FCF Margin %':r.fcfMarginAnn,
                    'OPM %':r.opmTtm, 'Net Margin %':r.netProfitMargin,
                    ROE:r.roe, ROIC:r.roic, 'EPS Growth %':r.epsGrowth,
                    'Fwd P/E':r.forwardPe, 'P/E':r.pe, 'PEG':r.peg,
                    'EV/EBITDA':r.evEbitda, 'P/S':r.ps,
                    'Rule of 40':r.ruleOf40, 'Accel Signal':r.accelSignal,
                    'Net Debt $':r.netDebtUsd, 'D/E':r.de,
                    '1Y Perf %':r.perf1y, 'Analyst Rating':r.analystRating,
                    'RSI 14':r.rsi14, 'P/FCF':r.pFcf, 'Next Earnings':r.nextEarnings,
                  }));
                  const ws = XLSX.utils.json_to_sheet(data);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'USA');
                  XLSX.writeFile(wb, `usa-multibagger-${new Date().toISOString().slice(0,10)}.csv`, {bookType:'csv'});
                }} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${BORDER}`,background:'transparent',color:'#06b6d4',cursor:'pointer'}}>
                  ⬇ CSV
                </button>
              )}
              <button onClick={()=>{ if(window.confirm(`Clear all ${rows.length} stocks?`)){setRowsState([]);localStorage.removeItem(USA_STORAGE_KEY);setFileName('');try{window.dispatchEvent(new CustomEvent('mb-upload:updated',{detail:{cleared:true,market:'USA'}}));}catch{}} }} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${RED}40`,background:`${RED}10`,color:RED,cursor:'pointer'}}>
                🗑 Clear
              </button>
            </div>
          </div>

          {/* PATCH 0367 — USA export toolbar. NSE/NYSE/NASDAQ tickers go to
              TradingView with the exchange prefix. Screener.in is India-only
              so no company-name remap here — TradingView handles it natively
              for US listings. Screener button still works (bare ticker
              fallback) but is mostly unused for US workflow. */}
          {filtered.length > 0 && (() => {
            // Use the first row's exchange to pick the TradingView prefix.
            // Most USA rows are NASDAQ; NYSE is the only common alternative.
            const firstExch = (filtered[0]?.exchange || '').toUpperCase();
            const tvExchange: 'NASDAQ' | 'NYSE' = firstExch.includes('NYSE') ? 'NYSE' : 'NASDAQ';
            return (
              <div style={{ margin: '10px 0' }}>
                <TickerExportToolbar
                  tickers={filtered.map(r => r.symbol).filter(Boolean)}
                  exchange={tvExchange}
                  filenameHint="multibagger-usa"
                  compact
                />
              </div>
            );
          })()}

          {/* Table Header — sortable */}
          {/* PATCH 0346 — Added dedicated R40 column (Quarterly Rev + FCF margin),
              made sortable. Grid now has 9 columns instead of 8. */}
          <div style={{display:'grid',gridTemplateColumns:'120px 140px 60px 55px 90px 100px 70px 1fr 60px',gap:8,padding:'10px 14px',fontSize:F.xs,fontWeight:700,letterSpacing:'0.6px',color:MUTED,borderBottom:`1px solid ${BORDER}`}}>
            <span>TICKER</span><span>COMPANY</span>
            <span onClick={()=>handleUSASort('score')} style={{cursor:'pointer',color:usSortField==='score'?ACCENT:MUTED}}>SCORE{usSortIcon('score')}</span>
            <span>GRADE</span>
            <span onClick={()=>handleUSASort('fwdPe')} style={{cursor:'pointer',color:usSortField==='fwdPe'||usSortField==='peg'?YELLOW:MUTED}}>VAL{usSortIcon('fwdPe')}</span>
            <span onClick={()=>handleUSASort('revGrowthAnn')} style={{cursor:'pointer',color:usSortField==='revGrowthAnn'?GREEN:MUTED}}>ACCEL{usSortIcon('revGrowthAnn')}</span>
            <span onClick={()=>handleUSASort('ruleOf40')} style={{cursor:'pointer',color:usSortField==='ruleOf40'?'var(--mc-state-persistent)':MUTED}} title="Rule of 40 = Quarterly Rev Growth + FCF Margin (≥40 = institutional benchmark)">R40{usSortIcon('ruleOf40')}</span>
            <span onClick={()=>handleUSASort('grossMargin')} style={{cursor:'pointer',color:usSortField==='grossMargin'||usSortField==='fcfMargin'?'var(--mc-state-persistent)':MUTED}}>PILLARS{usSortIcon('grossMargin')}</span>
            <span onClick={()=>handleUSASort('marketCapB')} style={{cursor:'pointer',color:usSortField==='marketCapB'?ORANGE:MUTED}}>COV{usSortIcon('marketCapB')}</span>
          </div>

          {filtered.map((r,idx)=>{
            const isExp=expandAll||expRow===r.symbol;
            return (
              <div key={r.symbol+idx} style={{borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                <button onClick={()=>setExpRow(isExp?null:r.symbol)} style={{width:'100%',background:isExp?CARD_BG:'transparent',border:'none',cursor:'pointer',textAlign:'left',padding:'12px 14px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'120px 140px 60px 55px 90px 100px 70px 1fr 60px',gap:8,alignItems:'center'}}>
                    <div>
                      <div style={{display:'flex',alignItems:'center',gap:5}}>
                        <span style={{fontSize:F.lg,fontWeight:800,color:TEXT}}>{r.symbol}</span>
                        {idx<3&&<span style={{fontSize:F.md}}>⭐</span>}
                      </div>
                      <span style={{fontSize:F.xs,color:MUTED}}>{r.exchange}</span>
                      {/* PATCH 0349 — risk + position-size chips, surfaced inline */}
                      {r.earningsProximityDays !== undefined && r.earningsProximityDays >= 0 && r.earningsProximityDays <= 7 && (
                        <div title={`Earnings in ${r.earningsProximityDays} day${r.earningsProximityDays===1?'':'s'} (${r.nextEarnings}). Gap risk elevated — institutional desks halve position size in this window.`}
                             style={{fontSize:9,fontWeight:800,color:RED,background:`${RED}18`,border:`1px solid ${RED}40`,padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                          ⚠ EARNINGS {r.earningsProximityDays}d
                        </div>
                      )}
                      {r.postRunStretched && (
                        <div title={`+${r.perf1y?.toFixed(0)}% past year at FwdPE ${(r.forwardPe ?? r.pe)?.toFixed(0)}× — priced for perfection. Mean-reversion drag historically -15% to -20% from this setup.`}
                             style={{fontSize:9,fontWeight:800,color:YELLOW,background:`${YELLOW}18`,border:`1px solid ${YELLOW}40`,padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                          🌡 STRETCHED
                        </div>
                      )}
                      {r.fcfOpDivergence && (
                        <div title={`FCF margin ${r.fcfMarginAnn?.toFixed(0)}% vs Op margin ${r.opmTtm?.toFixed(0)}% — FCF likely inflated by working-capital release / SBC add-back / deferred revenue, not sustainable from operations.`}
                             style={{fontSize:9,fontWeight:800,color:RED,background:`${RED}18`,border:`1px solid ${RED}40`,padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                          🚨 FCF SUSPECT
                        </div>
                      )}
                      {r.suggestedMaxPositionPct !== undefined && (
                        <div title={`Position-size guidance based on market cap. Microcap volatility is structurally 2-3× large-cap, so size should reflect liquidity, not just composite score.`}
                             style={{fontSize:9,fontWeight:700,color:'var(--mc-text-3)',background:'rgba(148,163,184,0.10)',border:'1px solid rgba(148,163,184,0.25)',padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                          MAX {r.suggestedMaxPositionPct}%
                        </div>
                      )}
                      {/* PATCH 0577 — ADV (Average Daily $ Value) chip.
                          Tier colors mirror institutional thresholds:
                          ≥ $50M = green (any desk can size), $10-50M = amber
                          (be careful), < $10M = red (institutional slippage
                          risk). Derived from TradingView price × volume. */}
                      {r.avgDailyValueUsdM !== undefined && r.avgDailyValueUsdM > 0 && (() => {
                        const v = r.avgDailyValueUsdM;
                        const tier = v >= 50 ? { c: '#10b981', bg: '#10b98118', bd: '#10b98140', hint: 'Heavy-institutional liquid — any desk can scale.' }
                                  : v >= 10 ? { c: '#f59e0b', bg: '#f59e0b18', bd: '#f59e0b40', hint: 'Mid-cap liquid — size with slippage discipline.' }
                                  :            { c: '#ef4444', bg: '#ef444418', bd: '#ef444440', hint: 'Thin tape — institutional desks avoid above 1% ADV.' };
                        const label = v >= 1000 ? `$${(v / 1000).toFixed(1)}B`
                                    : v >= 1   ? `$${v.toFixed(1)}M`
                                                : `$${(v * 1000).toFixed(0)}K`;
                        return (
                          <div title={`Average Daily $ Volume ≈ ${label} (price × 30-day avg volume). ${tier.hint}`}
                               style={{fontSize:9,fontWeight:800,color:tier.c,background:tier.bg,border:`1px solid ${tier.bd}`,padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                            ADV {label}
                          </div>
                        );
                      })()}
                      {/* PATCH 0576 — Per-row stale-fundamentals chip. Fires
                          when this CSV upload is > 60 days old AND the row's
                          1-year perf has moved ≥ 15% since the snapshot.
                          Per-row variant of the page-level banner from #77 —
                          this lets the analyst spot WHICH names specifically
                          need a re-export (high-momentum names, where the
                          stale-fundamentals risk is highest). */}
                      {usaUploadAgeDays != null && usaUploadAgeDays > 60 &&
                        typeof r.perf1y === 'number' && Math.abs(r.perf1y) >= 15 && (
                        <div title={`Fundamentals captured ${usaUploadAgeDays}d ago, but 1y perf is ${r.perf1y.toFixed(0)}%. The scorecard may not reflect the current setup — re-export the row from TradingView before acting.`}
                             style={{fontSize:9,fontWeight:800,color:ORANGE,background:`${ORANGE}18`,border:`1px solid ${ORANGE}40`,padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                          ⏳ STALE {usaUploadAgeDays}d
                        </div>
                      )}
                      {r.nextEarnings&&<div style={{fontSize:9,color:'var(--mc-warn)'}}>📅 {r.nextEarnings}</div>}
                      {r.analystRating && (() => {
                        const rating = r.analystRating.toLowerCase();
                        const col = rating.includes('strong buy') ? GREEN : rating.includes('buy') ? '#34d399' : rating.includes('strong sell') ? RED : rating.includes('sell') ? ORANGE : MUTED;
                        return <div style={{fontSize:9,fontWeight:700,color:col}}>{r.analystRating}</div>;
                      })()}
                    </div>
                    <span style={{fontSize:F.sm,color:MUTED,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.company}</span>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:1}}>
                      <span style={{fontSize:F.h2,fontWeight:900,color:GRADE_COLOR_US[r.grade]}}>{r.score}</span>
                      {/* PATCH 1101rr — RS Rating below score (O'Neil-style 1-99 momentum).
                          Color: green ≥80, cyan 60-80, muted 40-60, orange <40. */}
                      {typeof (r as any).rsRating === 'number' && (
                        <span style={{fontSize:F.xxs,fontWeight:800,color:(r as any).rsRating>=80?GREEN:(r as any).rsRating>=60?'#22D3EE':(r as any).rsRating>=40?MUTED:ORANGE,letterSpacing:'0.3px'}}
                          title={`RS Rating: O'Neil-style 1-99 momentum composite (30% 3M + 40% 6M + 30% 1Y)`}>
                          RS {(r as any).rsRating}
                        </span>
                      )}
                    </div>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:1}}>
                      <span style={{fontSize:F.md,fontWeight:800,padding:'4px 8px',borderRadius:6,color:GRADE_COLOR_US[r.grade],backgroundColor:`${GRADE_COLOR_US[r.grade]}18`,border:`1px solid ${GRADE_COLOR_US[r.grade]}30`,textAlign:'center'}}>{r.grade}</span>
                      {/* PATCH 1101rr — Implied Upside % below grade. Green positive, red negative. */}
                      {typeof (r as any).impliedUpsidePct === 'number' && (
                        <span style={{fontSize:F.xxs,fontWeight:800,color:(r as any).impliedUpsidePct>=20?GREEN:(r as any).impliedUpsidePct>=0?'#22D3EE':RED,letterSpacing:'0.3px'}}
                          title={`Implied upside vs analyst 1-year mean target price`}>
                          {(r as any).impliedUpsidePct>=0?'↑':'↓'} {Math.abs((r as any).impliedUpsidePct)}%
                        </span>
                      )}
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      {r.forwardPe !== undefined && r.forwardPe > 0
                        ? <div style={{display:'flex',alignItems:'baseline',gap:3}}><span style={{fontSize:F.xs,color:MUTED}}>Fwd P/E</span><span style={{fontSize:F.md,fontWeight:800,color:r.forwardPe<25?GREEN:r.forwardPe<50?YELLOW:ORANGE}}>{r.forwardPe.toFixed(0)}×</span></div>
                        : r.pe !== undefined && r.pe > 0
                        ? <div style={{display:'flex',alignItems:'baseline',gap:3}}><span style={{fontSize:F.xs,color:MUTED}}>P/E</span><span style={{fontSize:F.md,fontWeight:800,color:r.pe<25?GREEN:r.pe<50?YELLOW:ORANGE}}>{r.pe.toFixed(0)}×</span></div>
                        : <span style={{fontSize:F.xs,color:`${MUTED}60`}}>P/E —</span>
                      }
                      {r.evEbitda !== undefined && r.evEbitda > 0
                        ? <span style={{fontSize:10,color:MUTED}}>EV/EBITDA {r.evEbitda.toFixed(0)}×</span>
                        : null}
                      {r.marketCapB !== undefined && <span style={{fontSize:9,color:MUTED}}>${r.marketCapB >= 1 ? r.marketCapB.toFixed(1)+'B' : (r.marketCapB*1000).toFixed(0)+'M'}</span>}
                    </div>
                    {/* ACCEL cell — signal + QoQ/Annual % only (R40 moved to own column) */}
                    <div style={{display:'flex',flexDirection:'column',gap:2}}>
                      <span style={{fontSize:F.xs,fontWeight:700,color:r.accelSignal==='ACCELERATING'?GREEN:r.accelSignal==='DECELERATING'?RED:MUTED}}>
                        {r.accelSignal??'—'}
                      </span>
                      {r.revenueGrowthQtr !== undefined && <span style={{fontSize:10,color:MUTED}}>QoQ +{r.revenueGrowthQtr.toFixed(0)}%</span>}
                      {r.revenueGrowthAnn !== undefined && <span style={{fontSize:10,color:MUTED}}>Ann +{r.revenueGrowthAnn.toFixed(0)}%</span>}
                    </div>
                    {/* PATCH 0346 — R40 dedicated column: big number + tier color + composition */}
                    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                      {r.ruleOf40 !== undefined ? (
                        <>
                          <span style={{fontSize:F.lg,fontWeight:900,
                            color:r.ruleOf40>=80?GREEN:r.ruleOf40>=60?'#34d399':r.ruleOf40>=40?YELLOW:r.ruleOf40>=20?ORANGE:RED}}>
                            {r.ruleOf40}
                          </span>
                          <span style={{fontSize:9,color:MUTED}}>
                            {r.ruleOf40>=80?'🏆 elite':r.ruleOf40>=60?'strong':r.ruleOf40>=40?'passes':r.ruleOf40>=20?'weak':'fail'}
                          </span>
                          {r.revenueGrowthQtr !== undefined && r.fcfMarginAnn !== undefined && (
                            <span style={{fontSize:9,color:`${MUTED}90`}} title={`R40 = Qtr Rev ${r.revenueGrowthQtr.toFixed(0)}% + FCF ${r.fcfMarginAnn.toFixed(0)}%`}>
                              {r.revenueGrowthQtr.toFixed(0)}+{r.fcfMarginAnn.toFixed(0)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{fontSize:F.xs,color:`${MUTED}60`}}>—</span>
                      )}
                    </div>
                    <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                      {r.pillarScores.map(p=>(
                        <div key={p.id} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2,minWidth:32}}>
                          <span style={{fontSize:F.sm,fontWeight:700,color:p.color}}>{p.score}</span>
                          <div style={{width:26,height:5,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:2,overflow:'hidden'}}>
                            <div style={{height:'100%',width:`${p.score}%`,backgroundColor:p.color}}/>
                          </div>
                          <span style={{fontSize:9,color:MUTED}}>{p.label.slice(0,4)}</span>
                        </div>
                      ))}
                    </div>
                    {/* COV + score delta */}
                    <div style={{display:'flex',flexDirection:'column',gap:2}}>
                      <span style={{fontSize:F.sm,color:r.coverage>=70?GREEN:r.coverage>=50?YELLOW:ORANGE}}>{r.coverage}%</span>
                      {(() => {
                        const prev = usPrevScores[r.symbol];
                        if (prev===undefined) return null;
                        const d = r.score - prev;
                        if (d===0) return null;
                        return <span style={{fontSize:9,fontWeight:700,color:d>0?GREEN:RED}}>{d>0?`↑${d}`:`↓${Math.abs(d)}`}</span>;
                      })()}
                    </div>
                  </div>
                </button>
                {isExp&&(
                  <div style={{padding:'16px 14px 20px',backgroundColor:`${CARD_BG}CC`,borderTop:`1px solid ${BORDER}`}}>
                    {/* PATCH 0347 — Decision logbook bar (USA) */}
                    <DecisionBar symbol={r.symbol} company={r.company} market="US" score={r.score} grade={r.grade} currentPrice={(r as any).cmp} bump={bumpUsDecisions} />
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:16}}>
                      <div>
                        <div style={{fontSize:F.sm,color:MUTED,fontWeight:700,letterSpacing:'0.8px',marginBottom:8}}>KEY METRICS</div>
                        {[
                          ['Rev Growth (Ann)','revenueGrowthAnn','%'],['Rev Growth (Qtr YoY)','revenueGrowthQtr','%'],
                          ['Gross Margin','grossMarginAnn','%'],['FCF Margin','fcfMarginAnn','%'],
                          ['Operating Margin','opmTtm','%'],['Net Profit Margin','netProfitMargin','%'],
                          ['ROE','roe','%'],['ROIC','roic','%'],
                          ['P/E','pe','×'],['Forward P/E','forwardPe','×'],['EV/EBITDA','evEbitda','×'],['P/S','ps','×'],
                          ['Market Cap','marketCapB','$B'],['D/E','de','×'],['EPS Growth','epsGrowth','%'],
                          ['1Y Performance','perf1y','%'],['vs 52W High','pctFrom52wHigh','%'],
                        ].filter(([,f])=>(r as any)[f]!==undefined).map(([label,field,unit])=>{
                          const v=(r as any)[field] as number;
                          return (
                            <div key={String(field)} style={{display:'flex',justifyContent:'space-between',fontSize:F.md,padding:'5px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                              <span style={{color:MUTED}}>{label}</span>
                              <span style={{color:TEXT,fontWeight:700}}>{unit==='$B'?`$${v.toFixed(1)}B`:unit==='%'?`${v.toFixed(1)}%`:`${v.toFixed(1)}×`}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div>
                        {r.strengths.length>0&&<>
                          <div style={{fontSize:F.sm,color:GREEN,fontWeight:700,marginBottom:6}}>✅ STRENGTHS</div>
                          {r.strengths.map((s,i)=><div key={i} style={{fontSize:F.md,color:MUTED,padding:'3px 0'}}>› {s}</div>)}
                        </>}
                        {r.risks.length>0&&<>
                          <div style={{fontSize:F.sm,color:ORANGE,fontWeight:700,marginTop:12,marginBottom:6}}>⚠️ RISKS</div>
                          {r.risks.map((s,i)=><div key={i} style={{fontSize:F.md,color:MUTED,padding:'3px 0'}}>› {s}</div>)}
                        </>}
                        <div style={{fontSize:F.sm,color:MUTED,marginTop:12,borderTop:`1px solid ${BORDER}`,paddingTop:8}}>
                          {r.sector} · {r.exchange} · Data: {r.coverage}% · {r.nextEarnings&&`Next earnings: ${r.nextEarnings}`}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
      {!rows.length&&!loading&&(
        <div style={{textAlign:'center',padding:56,color:MUTED}}>
          <div style={{fontSize:48}}>🇺🇸</div>
          <div style={{fontSize:F.h2,color:TEXT,fontWeight:700,marginTop:14}}>Upload TradingView CSV to score US stocks</div>
          <div style={{fontSize:F.md,color:MUTED,marginTop:8}}>Go to TradingView Screener → add the columns above → Export CSV → upload here</div>
        </div>
      )}
    </div>
  );
}

const STORAGE_KEY = 'mb_excel_scored_v2';
const STORAGE_META = 'mb_excel_meta_v2';
const MB_IDB_DB = 'mc-mb';
const MB_IDB_STORE = 'kv';
function mbIdbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(MB_IDB_DB, 1);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(MB_IDB_STORE)) db.createObjectStore(MB_IDB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}
// PATCH 1101i — Persistence primitives hardened. The outer `.catch(() => {})`
// on mbIdbSet was swallowing all IDB write failures and resolving the Promise
// to undefined — meaning callers' `.then()` would fire even when the write
// had silently failed. That's exactly why META was being written without
// IDB data (the "Saved data lost (N stocks)" banner root cause).
//
// Now: writes that fail REJECT the Promise so callers can branch correctly.
// Also: console.warn on failure so the user (and us) can see what happened
// in DevTools instead of silent loss.
function mbIdbSet(key: string, val: string): Promise<void> {
  return mbIdbOpen().then(db => new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction(MB_IDB_STORE, 'readwrite');
      tx.objectStore(MB_IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        try { console.warn('[mb-idb] write tx error', key, tx.error); } catch {}
        reject(tx.error || new Error('IDB tx error'));
      };
      tx.onabort = () => {
        try { console.warn('[mb-idb] write tx abort', key, tx.error); } catch {}
        reject(tx.error || new Error('IDB tx abort'));
      };
    } catch (e) {
      try { console.warn('[mb-idb] write threw', key, e); } catch {}
      reject(e);
    }
  })).catch((e) => {
    // Surface the failure to the caller so they can stop writing META.
    try { console.warn('[mb-idb] write failed (rethrowing)', key, e); } catch {}
    throw e;
  });
}
function mbIdbGet(key: string): Promise<string | null> {
  return mbIdbOpen().then(db => new Promise<string | null>((resolve, reject) => {
    try {
      const tx = db.transaction(MB_IDB_STORE, 'readonly');
      const r = tx.objectStore(MB_IDB_STORE).get(key);
      r.onsuccess = () => resolve((r.result as string) ?? null);
      r.onerror = () => {
        try { console.warn('[mb-idb] read request error', key, r.error); } catch {}
        reject(r.error || new Error('IDB read error'));
      };
    } catch (e) {
      reject(e);
    }
  })).catch((e) => {
    // Read failure → return null so caller treats as "no data", but log it
    // so future debugging of empty hydration is possible. Differs from write:
    // a failed read isn't catastrophic, but we don't want to silently lie
    // either when investigating the orphan-META mystery.
    try { console.warn('[mb-idb] read failed → returning null', key, e); } catch {}
    return null;
  });
}
function mbIdbDel(key: string): Promise<void> {
  return mbIdbOpen().then(db => new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(MB_IDB_STORE, 'readwrite');
      tx.objectStore(MB_IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  })).catch(() => {});
}

// PATCH 1101i — Resilient IDB read with retry. The browser's IDB layer can
// be slow to initialize on cold start or after heavy other-tab activity, so
// a single read attempt occasionally returns null even when data exists.
// Retry up to 4 times with backoff before giving up.
async function mbIdbGetWithRetry(key: string, retries = 4, delayMs = 250): Promise<string | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const raw = await mbIdbGet(key);
      if (raw && raw !== '[]') return raw;
    } catch {}
    if (i < retries - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
  }
  return null;
}

// PATCH 1101l — Server-side persistence layer (Upstash Redis via Railway).
// localStorage + IDB are both subject to browser eviction under storage
// pressure — the "Saved data lost (N stocks)" banner kept recurring even
// after 1101i hardened the IDB write path. This third layer survives ALL
// local browser eviction by stashing the scored JSON on Railway under an
// anonymous client UUID stored in localStorage. POST happens after every
// successful upload; GET happens on hydration ONLY when both local layers
// are empty.
const MB_CLIENT_ID_KEY = 'mb_client_id_v1';
function mbGetClientId(): string {
  try {
    let cid = localStorage.getItem(MB_CLIENT_ID_KEY);
    if (cid && /^[a-zA-Z0-9_-]{8,64}$/.test(cid)) return cid;
    // Generate a new anonymous UUID. Format: 12 chars random base36.
    cid = 'mb-' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
    localStorage.setItem(MB_CLIENT_ID_KEY, cid);
    return cid;
  } catch {
    // localStorage unavailable (private browsing) — fall back to session UUID.
    return 'mb-' + Math.random().toString(36).slice(2, 11);
  }
}
async function mbServerSnapshotSave(snapshot: string, count: number, market: 'IN' | 'USA' = 'IN'): Promise<boolean> {
  try {
    const clientId = mbGetClientId();
    const res = await fetch('/api/v1/multibagger/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, snapshot, count, market }),
      // Don't block UI on this — but do await so we surface failures.
    });
    if (!res.ok) {
      try { console.warn('[mb-server-snapshot] save failed', res.status, await res.text()); } catch {}
      return false;
    }
    return true;
  } catch (e) {
    try { console.warn('[mb-server-snapshot] save threw', e); } catch {}
    return false;
  }
}
async function mbServerSnapshotLoad(market: 'IN' | 'USA' = 'IN'): Promise<string | null> {
  try {
    const clientId = mbGetClientId();
    const res = await fetch(`/api/v1/multibagger/snapshot?clientId=${encodeURIComponent(clientId)}&market=${market}`);
    if (!res.ok) return null;
    const j = await res.json();
    return (j?.snapshot as string) || null;
  } catch (e) {
    try { console.warn('[mb-server-snapshot] load threw', e); } catch {}
    return null;
  }
}
// PATCH 1101m — Visible cloud save status badge. Listens for cloud save
// events and shows the user where their data lives right now. Includes a
// "Backup now" button as a manual escape valve when auto-save fails.
function CloudSaveStatusBadge({ rows }: { rows: ExcelResult[] }): React.ReactElement | null {
  const [status, setStatus] = React.useState<'idle' | 'saving' | 'ok' | 'failed'>(() => {
    try { return (localStorage.getItem('mb_server_save_status') as any) || 'idle'; } catch { return 'idle'; }
  });
  const [savedAt, setSavedAt] = React.useState<string | null>(() => {
    try { return localStorage.getItem('mb_server_save_at'); } catch { return null; }
  });
  const [forcing, setForcing] = React.useState(false);
  React.useEffect(() => {
    const onStatus = (e: Event) => {
      const ce = e as CustomEvent<'saving' | 'ok' | 'failed'>;
      if (ce.detail) {
        setStatus(ce.detail);
        if (ce.detail === 'ok') {
          try { setSavedAt(localStorage.getItem('mb_server_save_at')); } catch {}
        }
      }
    };
    window.addEventListener('mb-cloud-save:status', onStatus);
    return () => window.removeEventListener('mb-cloud-save:status', onStatus);
  }, []);
  if (!rows || rows.length === 0) return null;
  const forceBackup = async () => {
    setForcing(true);
    try {
      const __mbR = JSON.stringify(rows);
      try { localStorage.setItem('mb_server_save_status', 'saving'); window.dispatchEvent(new CustomEvent('mb-cloud-save:status', { detail: 'saving' })); } catch {}
      const ok = await mbServerSnapshotSave(__mbR, rows.length, 'IN');
      try {
        if (ok) {
          localStorage.setItem('mb_server_save_status', 'ok');
          localStorage.setItem('mb_server_save_at', new Date().toISOString());
        } else {
          localStorage.setItem('mb_server_save_status', 'failed');
        }
        window.dispatchEvent(new CustomEvent('mb-cloud-save:status', { detail: ok ? 'ok' : 'failed' }));
      } catch {}
    } finally {
      setForcing(false);
    }
  };
  const color = status === 'ok' ? '#22c55e' : status === 'saving' ? '#3b82f6' : status === 'failed' ? '#ef4444' : '#94a3b8';
  const icon = status === 'ok' ? '☁ ✓' : status === 'saving' ? '☁ ⏳' : status === 'failed' ? '☁ ⚠' : '☁ ?';
  const label = status === 'ok' ? `Backed up to Railway · ${savedAt ? new Date(savedAt).toLocaleString() : ''}`
              : status === 'saving' ? 'Saving to Railway cloud…'
              : status === 'failed' ? 'Cloud backup failed — local data only'
              : 'Not yet backed up to cloud';
  return (
    <div style={{marginBottom:14,padding:'8px 14px',backgroundColor:`color-mix(in srgb, ${color} 8%, transparent)`,border:`1px solid ${color}55`,borderLeft:`3px solid ${color}`,borderRadius:6,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',fontSize:12}}>
      <span style={{color, fontWeight:800, letterSpacing:0.4}}>{icon}</span>
      <span style={{color:'var(--mc-text-2)', fontWeight:600}}>{label}</span>
      <span style={{flex:1}}/>
      <button
        onClick={forceBackup}
        disabled={forcing || status === 'saving'}
        style={{padding:'4px 12px',backgroundColor:'transparent',border:`1px solid ${color}77`,borderRadius:5,color,fontSize:11,fontWeight:700,cursor:forcing?'wait':'pointer',opacity:forcing?0.5:1}}>
        {forcing ? 'Saving…' : 'Backup now'}
      </button>
    </div>
  );
}

// Request persistent storage so browsers don't evict IDB under pressure.
// This is best-effort — Safari rarely honors it, Chrome/Firefox usually do.
function mbRequestPersistentStorage(): void {
  try {
    if (typeof navigator !== 'undefined'
        && navigator.storage
        && typeof navigator.storage.persist === 'function') {
      navigator.storage.persist().then((granted) => {
        try { console.log('[mb-persist] navigator.storage.persist() →', granted); } catch {}
      }).catch(() => {});
    }
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0347 — DECISION BAR COMPONENT
// Used in both India and USA expanded rows.
// Shows 4 status buttons (BUY/WATCH/NEUTRAL/REJECTED) + reason input.
// Persists to localStorage via lib/decisions.ts — survives data clears.
// ═══════════════════════════════════════════════════════════════════════════
function DecisionBar({ symbol, company, market, score, grade, currentPrice, bump }: {
  symbol: string; company?: string; market: 'IN' | 'US';
  score?: number; grade?: string;
  currentPrice?: number;  // PATCH 0852 — snapshotted at decision time for buy-the-dip helper
  bump: () => void;
}) {
  const existing = getDecision(symbol);
  const [reason, setReason] = React.useState(existing?.reason ?? '');
  const [status, setStatus] = React.useState<DecisionStatus | undefined>(existing?.status);
  React.useEffect(() => {
    // Re-sync when symbol changes
    const e = getDecision(symbol);
    setReason(e?.reason ?? '');
    setStatus(e?.status);
  }, [symbol]);

  const apply = (newStatus: DecisionStatus) => {
    setStatus(newStatus);
    setDecision({
      symbol, market, status: newStatus, reason,
      company, scoreAtDecision: score, gradeAtDecision: grade,
      priceAtDecision: currentPrice && currentPrice > 0 ? currentPrice : undefined,
    });
    bump();
  };
  const onSaveReason = () => {
    if (!status) return;
    setDecision({
      symbol, market, status, reason,
      company, scoreAtDecision: score, gradeAtDecision: grade,
      priceAtDecision: currentPrice && currentPrice > 0 ? currentPrice : undefined,
    });
    bump();
  };
  const onClear = () => {
    clearDecision(symbol);
    setStatus(undefined);
    setReason('');
    bump();
  };

  return (
    <div style={{
      marginBottom: 12, padding: '10px 14px',
      backgroundColor: '#0f172a', border: '1px solid var(--mc-bg-3)', borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.7px', color: '#38bdf8' }}>
          📒 DECISION LOG{existing && ` · last updated ${new Date(existing.date).toLocaleDateString()}`}
        </span>
        {(['BUY', 'WATCH', 'NEUTRAL', 'REJECTED'] as DecisionStatus[]).map(s => {
          const meta = DECISION_META[s];
          const active = status === s;
          return (
            <button key={s} onClick={() => apply(s)}
              style={{
                fontSize: 11, fontWeight: 800, padding: '5px 11px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${active ? meta.color + 'AA' : 'var(--mc-bg-3)'}`,
                background: active ? `${meta.color}25` : 'transparent',
                color: active ? meta.color : 'var(--mc-text-3)',
              }}>
              {meta.emoji} {meta.label}
            </button>
          );
        })}
        {status && (
          <button onClick={onClear} style={{
            fontSize: 10, padding: '4px 9px', borderRadius: 5, cursor: 'pointer',
            border: '1px solid var(--mc-bg-3)', background: 'transparent', color: 'var(--mc-text-3)', marginLeft: 'auto',
          }} title="Remove this decision">
            ✕ Clear
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={onSaveReason}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSaveReason(); } }}
          placeholder="Why? Add your reason — saved permanently even if you clear the list"
          style={{
            flex: 1, fontSize: 12, padding: '7px 10px', borderRadius: 6,
            background: '#0a1124', border: '1px solid var(--mc-bg-3)', color: '#e2e8f0', outline: 'none',
          }}
        />
        <button onClick={onSaveReason}
          style={{
            fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid #38bdf860', background: '#38bdf818', color: '#38bdf8',
          }}>
          💾 Save
        </button>
      </div>
      {existing && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--mc-text-4)' }}>
          Decision recorded when score was <strong style={{ color: 'var(--mc-text-3)' }}>{existing.scoreAtDecision ?? '—'} {existing.gradeAtDecision ?? ''}</strong>.
          This persists even after you clear your upload — useful as a personal logbook.
        </div>
      )}
    </div>
  );
}

// Compact decision badge for collapsed rows
function DecisionBadge({ symbol }: { symbol: string }) {
  const d = getDecision(symbol);
  if (!d) return null;
  const meta = DECISION_META[d.status];
  return (
    <span
      title={`${meta.label}${d.reason ? ' — ' + d.reason : ''} · ${new Date(d.date).toLocaleDateString()}`}
      style={{
        fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
        color: meta.color, background: meta.color + '20', border: `1px solid ${meta.color}50`,
      }}>
      {meta.emoji} {meta.label}
    </span>
  );
}

// PATCH 0347 — Cross-market upload detection.
// USA TradingView CSV has these unique headers; India Screener CSV does not.
// PATCH 0755 — detectCsvMarket extracted to lib/multibagger-csv-parsers.ts.

export default function MultibaggerPage() {
  // PATCH 0492 — 'analytics' tab added as DEFAULT landing view. User wanted to land
  // on the cross-stock analytics overview, not the per-row ranking table.
  // PATCH 0872 — Added 'usa-analytics' and 'turnaround-analytics' as
  // dedicated dashboards for the USA Multibagger universe and the
  // Turnaround universe respectively. The original 'analytics' tab stays
  // as the cross-market overview (India-led).
  const [activeTab, setActiveTab] = useState<'analytics'|'excel'|'usa'|'usa-analytics'|'turnaround'|'turnaround-analytics'|'usa-checklist'|'checklist'|'capital-alloc'|'reference'>('analytics');
  React.useEffect(() => {
    const onSwitch = (e: Event) => {
      const ce = e as CustomEvent<{ tab: 'excel' | 'usa' }>;
      if (ce.detail?.tab === 'usa' || ce.detail?.tab === 'excel') setActiveTab(ce.detail.tab);
    };
    window.addEventListener('mc:switch-multibagger-tab', onSwitch);
    return () => window.removeEventListener('mc:switch-multibagger-tab', onSwitch);
  }, []);

  // Lazy-init from localStorage — data survives navigation and page refresh.
  // Only cleared when user explicitly clicks "Clear All Data".
  const [excelRows, setExcelRowsState] = useState<ExcelResult[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ExcelResult[];
        // RE-SCORE on every load — ExcelResult extends ExcelRow, so all raw fields
        // are preserved in localStorage. Re-running scoreExcelRow picks up any
        // scoring formula changes (e.g. new -30 growth filter) without re-upload.
        const rescored = parsed.map(r => scoreExcelRow(r as unknown as ExcelRow));
        const sorted = rescored.sort((a, b) => b.score - a.score);
        return applyForcedRanking(sorted);
      }
    } catch {}
    return [];
  });
  // PATCH 1101i — Removed the redundant background-write effect that fired on
  // every excelRows change. setExcelRows (below) is the single writer now —
  // it awaits IDB success before writing META, which is the only way to
  // prevent orphan-META "Saved data lost" banners. The old effect wrote IDB
  // without awaiting and ignored failures, contributing to the bug.

  // PATCH 1101i + 1101l — Three-layer hydration on mount.
  //   1. localStorage initializer (synchronous, line above) tries first.
  //   2. IDB retry — catches localStorage 5MB eviction with IDB still intact.
  //   3. SERVER fetch (Railway Upstash Redis) — catches the case where BOTH
  //      local layers were evicted by the browser. This is the bulletproof
  //      tier the user explicitly asked for after 1101i still wasn't holding.
  // Each layer only fires if the prior one returned empty. Once data lands,
  // the data is written back DOWN to local layers so next session is fast.
  useEffect(() => {
    let alive = true;
    // Ask the browser to mark our origin's storage as persistent so IDB
    // doesn't get evicted under storage pressure (best-effort).
    mbRequestPersistentStorage();
    (async () => {
      // Layer 2: IDB
      const idbRaw = await mbIdbGetWithRetry('mb_scored');
      if (!alive) return;
      if (idbRaw) {
        try {
          const parsed = JSON.parse(idbRaw) as ExcelResult[];
          if (Array.isArray(parsed) && parsed.length) {
            const rescored = parsed.map(r => {
              try { return scoreExcelRow(r as unknown as ExcelRow); } catch { return r; }
            });
            const sorted = rescored.sort((a, b) => b.score - a.score);
            setExcelRowsState((prev) => (prev && prev.length ? prev : applyForcedRanking(sorted)));
            return;
          }
        } catch (e) {
          try { console.warn('[mb-idb] hydrate parse failed', e); } catch {}
        }
      }
      // Layer 3: SERVER. Both local layers came up empty — try the Upstash
      // backup before letting the orphan-META banner fire.
      try { console.log('[mb-persist] local layers empty, trying server snapshot'); } catch {}
      const serverRaw = await mbServerSnapshotLoad('IN');
      if (!alive || !serverRaw) {
        try { console.log('[mb-persist] server snapshot also empty'); } catch {}
        return;
      }
      try {
        const parsed = JSON.parse(serverRaw) as ExcelResult[];
        if (Array.isArray(parsed) && parsed.length) {
          try { console.log(`[mb-persist] restored ${parsed.length} stocks from server`); } catch {}
          const rescored = parsed.map(r => {
            try { return scoreExcelRow(r as unknown as ExcelRow); } catch { return r; }
          });
          const sorted = rescored.sort((a, b) => b.score - a.score);
          setExcelRowsState((prev) => (prev && prev.length ? prev : applyForcedRanking(sorted)));
          // Write back DOWN to IDB + localStorage so future hydrations are fast
          // and don't require a server round-trip.
          const __mbS = JSON.stringify(sorted);
          mbIdbSet('mb_scored', __mbS).then(() => {
            try { localStorage.setItem(STORAGE_KEY, __mbS); } catch {}
            try {
              localStorage.setItem(STORAGE_META, JSON.stringify({
                savedAt: new Date().toISOString(),
                count: sorted.length,
                restoredFrom: 'server',
              }));
            } catch {}
          }).catch(() => {});
        }
      } catch (e) {
        try { console.warn('[mb-server-snapshot] parse failed', e); } catch {}
      }
    })();
    return () => { alive = false; };
  }, []);

  // Wrapper: always applies forced ranking before saving/setting state
  function setExcelRows(rows: ExcelResult[]) {
    const ranked = applyForcedRanking(rows); // sort already done by caller
    setExcelRowsState(ranked);
    // PATCH 1099 + 1101i — IDB is the source of truth (essentially unlimited
    // storage). Write IDB FIRST; only write META AFTER IDB confirms. With
    // 1101i the mbIdbSet primitive now properly rejects on failure (instead
    // of swallowing the error and falsely resolving), so the .then() branch
    // below ACTUALLY only fires on successful writes. Previously, an IDB
    // failure would silently resolve, META would write, localStorage might
    // also fail, and the next session would show orphan META + no data.
    const __mbR = JSON.stringify(ranked);
    mbIdbSet('mb_scored', __mbR).then(() => {
      // IDB write confirmed succeeded.
      try { localStorage.setItem(STORAGE_KEY, __mbR); } catch {}
      try {
        localStorage.setItem(STORAGE_META, JSON.stringify({
          savedAt: new Date().toISOString(),
          count: ranked.length,
        }));
      } catch {}
      // PATCH 1101l + 1101m — Server backup via Railway Postgres. Track save
      // status in localStorage so the UI can show a "☁ Cloud OK" / "⚠ Local
      // only" badge — user needs to SEE whether persistence is working.
      try { localStorage.setItem('mb_server_save_status', 'saving'); window.dispatchEvent(new CustomEvent('mb-cloud-save:status', { detail: 'saving' })); } catch {}
      mbServerSnapshotSave(__mbR, ranked.length, 'IN').then((ok) => {
        try { console.log('[mb-persist] server snapshot save →', ok ? 'OK' : 'FAILED'); } catch {}
        try {
          if (ok) {
            localStorage.setItem('mb_server_save_status', 'ok');
            localStorage.setItem('mb_server_save_at', new Date().toISOString());
          } else {
            localStorage.setItem('mb_server_save_status', 'failed');
          }
          window.dispatchEvent(new CustomEvent('mb-cloud-save:status', { detail: ok ? 'ok' : 'failed' }));
        } catch {}
      });
      // PATCH 0471 — broadcast cross-tab update so consumers (Re-rating,
      // Signals, Earnings Scan) refresh their derived universes immediately
      // after a fresh India upload.
      try { window.dispatchEvent(new CustomEvent('mb-upload:updated', { detail: { market: 'India', count: ranked.length } })); } catch {}
    }).catch(async (e) => {
      // PATCH 1101i — IDB write FAILED (genuinely now, not swallowed). Try
      // localStorage as a fallback for small datasets, but DO NOT write META
      // unless that localStorage write succeeds with the actual data.
      // PATCH 1101n — CRITICAL: also attempt the server save in this path.
      // Previously the server-save call only lived in the .then() branch, so
      // when local writes failed, the user lost their data even though the
      // server backup could have saved it. Now we try ALL three (IDB-was-
      // already-tried, localStorage, server) and only alert if literally
      // every layer failed. Also: log the actual JSON size so the user can
      // see how big their dataset has gotten.
      const sizeMB = (__mbR.length / 1024 / 1024).toFixed(2);
      try { console.warn(`[mb-persistence] IDB write failed (${sizeMB}MB), trying fallbacks`, e); } catch {}
      let localOk = false;
      try { localStorage.setItem(STORAGE_KEY, __mbR); localOk = true; } catch (lsErr) {
        try { console.warn('[mb-persistence] localStorage also failed', lsErr); } catch {}
      }
      // Server save — this is the key 1101n fix. Try regardless of local state.
      try { localStorage.setItem('mb_server_save_status', 'saving'); window.dispatchEvent(new CustomEvent('mb-cloud-save:status', { detail: 'saving' })); } catch {}
      const serverOk = await mbServerSnapshotSave(__mbR, ranked.length, 'IN');
      try {
        localStorage.setItem('mb_server_save_status', serverOk ? 'ok' : 'failed');
        if (serverOk) localStorage.setItem('mb_server_save_at', new Date().toISOString());
        window.dispatchEvent(new CustomEvent('mb-cloud-save:status', { detail: serverOk ? 'ok' : 'failed' }));
      } catch {}
      if (localOk) {
        try {
          localStorage.setItem(STORAGE_META, JSON.stringify({
            savedAt: new Date().toISOString(),
            count: ranked.length,
            fallback: 'localStorage-only',
          }));
        } catch {}
      }
      // Only alert if EVERY persistence layer failed.
      if (!localOk && !serverOk) {
        try {
          alert(`⚠ Save failed across all layers (${sizeMB}MB):\n• IndexedDB: failed\n• localStorage: quota exceeded\n• Railway cloud: unreachable\n\nYour data is live in this session but will be lost on refresh. Use "Download Screener CSV" to export, or click "Backup now" once your connection returns.`);
        } catch {}
      } else if (serverOk && !localOk) {
        try { console.log('[mb-persistence] Local writes failed but server backup succeeded — data is safe.'); } catch {}
      }
      try { window.dispatchEvent(new CustomEvent('mb-upload:updated', { detail: { market: 'India', count: ranked.length } })); } catch {}
    });
  }

  // Clear all data — explicit user action only
  function clearExcelRows() {
    setExcelRowsState([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_META);
      localStorage.removeItem('mb_excel_files_v1'); // PATCH 0984
      mbIdbDel('mb_scored');
      // PATCH 0453 P1-18 — Audit found cross-tab pages (Rerating, Signals,
      // Earnings Scan) kept showing ghost tickers from a cleared upload
      // because they only listened to the conviction-beats custom event,
      // not a multibagger-specific signal. Now broadcast 'mb-upload:updated'
      // so consumers can refresh their derived universes immediately.
      window.dispatchEvent(new CustomEvent('mb-upload:updated', { detail: { cleared: true } }));
    } catch {}
  }

  return (
    <div style={{background:BG,minHeight:'100vh',color:TEXT,fontFamily:'system-ui,-apple-system,sans-serif'}}>
      {/* Header */}
      <div style={{backgroundColor:'#13131a',borderBottom:'1px solid rgba(255,255,255,0.08)',padding:'20px 24px 0'}}>
        <div style={{maxWidth:1800,margin:'0 auto'}}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16,gap:12}}>
            <div>
              <h1 style={{fontSize:F.h1,fontWeight:900,color:PURPLE,margin:0}}>🚀 Multibagger Research Engine</h1>
              <p style={{fontSize:F.md,color:MUTED,margin:'5px 0 0'}}>
                SQGLP (MOSL 100×) · Fisher 100-Bagger · Multibagger Framework · Upload Screener.in → instant institutional scoring
              </p>
            </div>
            {/* Tab-specific clear buttons — India and USA are independent datasets */}
            {(activeTab==='excel'||activeTab==='checklist') && excelRows.length > 0 && (
              <button
                onClick={() => { if (window.confirm(`Clear all ${excelRows.length} India stocks? This cannot be undone.`)) clearExcelRows(); }}
                style={{padding:'8px 16px',backgroundColor:`${RED}14`,border:`1px solid ${RED}40`,borderRadius:8,color:RED,fontSize:F.sm,fontWeight:700,cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}
              >
                🗑 Clear India Data ({excelRows.length})
              </button>
            )}
            {(activeTab==='usa'||activeTab==='usa-checklist') && (() => {
              try {
                const d = JSON.parse(localStorage.getItem('mb_usa_scored_v1')||'[]');
                const count = Array.isArray(d) ? d.length : 0;
                if (count === 0) return null;
                return (
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Clear all ${count} USA stocks? This cannot be undone.`)) return;
                      // PATCH 1101bb — also delete Railway snapshot so stale USA
                      // stocks (like the VCTR/LPG ghost the user kept seeing)
                      // don't re-appear on refresh. Previously the button only
                      // cleared localStorage, leaving Railway as the silent
                      // source of truth that re-hydrated on next visit.
                      try {
                        const cid = localStorage.getItem('mb_client_id_v1');
                        if (cid) {
                          await fetch(`/api/v1/multibagger/snapshot?clientId=${encodeURIComponent(cid)}&market=USA`, { method: 'DELETE' });
                          try { console.log('[mb-usa] Railway snapshot deleted'); } catch {}
                        }
                      } catch (e) {
                        try { console.warn('[mb-usa] Railway delete failed', e); } catch {}
                      }
                      localStorage.removeItem('mb_usa_scored_v1');
                      localStorage.removeItem('mb_usa_uploaded_at_v1');
                      try { window.dispatchEvent(new CustomEvent('mb-upload:updated', { detail: { cleared: true, market: 'USA' } })); } catch {}
                      window.location.reload();
                    }}
                    style={{padding:'8px 16px',backgroundColor:`${RED}14`,border:`1px solid ${RED}40`,borderRadius:8,color:RED,fontSize:F.sm,fontWeight:700,cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}
                  >
                    🗑 Clear USA Data ({count})
                  </button>
                );
              } catch { return null; }
            })()}
          </div>
          {/* PATCH 1086 — tab overflow. Last tab ("Multibagger Reference") was
              clipping to "Res..." on viewports < ~1500px because the flex row
              had no horizontal scroll fallback. Adding overflowX:auto +
              whiteSpace:nowrap lets the row scroll instead of truncating;
              child buttons already use flexShrink:0 so they keep full width. */}
          <div style={{display:'flex',gap:0,overflowX:'auto',whiteSpace:'nowrap',scrollbarWidth:'thin'}}>
            {([
              // PATCH 0492 — Analytics tab is FIRST (default landing). User asked
              // to see analytics first, not the ranking table.
              // PATCH 0872 — Dedicated USA Analytics and Turnaround Analytics
              // tabs placed RIGHT NEXT to their data tabs so user can flip
              // between raw ranking and the institutional dashboard.
              {id:'analytics',              label:'📊 Analytics'},
              {id:'excel',                  label:'🇮🇳 India Multibagger Ranking'},
              {id:'usa',                    label:'🇺🇸 USA Multibagger'},
              {id:'usa-analytics',          label:'📊 USA Analytics'},
              {id:'turnaround',             label:'🔄 Turnarounds'},
              {id:'turnaround-analytics',   label:'📈 Turnaround Analytics'},
              {id:'usa-checklist',          label:'🇺🇸 USA Checklist'},
              {id:'checklist',              label:`📋 Research Checklist${excelRows.length?` (${excelRows.length} loaded)`:''}`},
              {id:'capital-alloc',          label:'💰 Capital Allocation'},
              {id:'reference',              label:'📚 Multibagger Reference'},
            ] as const).map(tab=>{
              const active=activeTab===tab.id;
              return (
                <button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{padding:'12px 22px',border:'none',cursor:'pointer',backgroundColor:'transparent',color:active?PURPLE:MUTED,fontSize:F.md,fontWeight:active?700:400,borderBottom:active?`2px solid ${PURPLE}`:'2px solid transparent',marginBottom:-1,flexShrink:0,transition:'all 0.15s'}}>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {activeTab==='analytics'             && <MultibaggerAnalytics indiaRows={excelRows} onSwitchTab={(t) => setActiveTab(t as any)} />}
      {activeTab==='excel'                 && <ExcelCompare rows={excelRows} setRows={setExcelRows} />}
      {activeTab==='usa'                   && <USACompare />}
      {/* PATCH 0872 — dedicated USA + Turnaround analytics dashboards */}
      {/* PATCH 1101ff — route USA Analytics through the full MultibaggerAnalytics
          component (which already supports INDIA/USA/BOTH scope) instead of the
          much smaller standalone USAAnalytics widget. User now gets full feature
          parity: 10-KPI stats strip, score histogram, Strong Buy / Avoid / Watch
          buckets with sub-categories, Operating Leverage Cluster, Cash-Rich lens,
          Valuation Gateway (PEG/PB-ROE), Today's Top 3 Buys, Decision Bridge,
          sector ranking, conviction overlap stats. The old USAAnalytics function
          is retained as dead code below for reference but no longer mounted. */}
      {activeTab==='usa-analytics'         && <MultibaggerAnalytics indiaRows={excelRows} onSwitchTab={(t) => setActiveTab(t as any)} initialScope="USA" />}
      {activeTab==='turnaround'            && <TurnaroundCompare />}
      {activeTab==='turnaround-analytics'  && <TurnaroundAnalytics />}
      {activeTab==='usa-checklist'         && <USAChecklist />}
      {activeTab==='checklist'             && <MultibaggerChecklist excelRows={excelRows} />}
      {activeTab==='capital-alloc'         && <CapitalAllocationPanel />}
      {activeTab==='reference'             && <MultibaggerReference excelRows={excelRows} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0492 — MULTIBAGGER ANALYTICS TAB (default landing)
//
// Cross-stock overview built from the uploaded India + USA scoring data.
// Stats strip · Grade distribution · Sector exposure · R40/PEG outliers ·
// Conviction-Beats / Decision-Logbook crossover · Super Investor overlap.
// ═══════════════════════════════════════════════════════════════════════════

type MbMarketScope = 'INDIA' | 'USA' | 'BOTH';

interface MbAnalyticsStock {
  symbol: string;
  company?: string;
  score: number;
  grade: string;
  sector?: string;
  market: 'INDIA' | 'USA';
}

// PATCH 0984 — Compact screener provenance chip row.
// Shows "N SCREENERS · name1 · name2 · …" at top of Multibagger Analytics
// so the user can see at a glance which Screener.in exports built this view.
function MbScreenerChips() {
  const [files, setFiles] = React.useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem('mb_excel_files_v1') || '[]'); } catch { return []; }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      try { setFiles(JSON.parse(localStorage.getItem('mb_excel_files_v1') || '[]')); } catch {}
    };
    window.addEventListener('mb-files:updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('mb-files:updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  if (files.length === 0) return null;
  const cleanName = (n: string) =>
    n.replace(/\.(csv|xlsx?|tsv)$/i, '')
     .replace(/^Screener[._-]+/i, '')
     .replace(/[_-]+/g, ' ')
     .replace(/\s+/g, ' ')
     .trim();
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
      padding: '6px 10px', borderRadius: 6,
      border: '1px solid #1E3A5F', background: '#0F1B2D',
    }}>
      <span style={{ fontSize: 10, color: 'var(--mc-cyan)', fontWeight: 800, letterSpacing: '0.5px' }}>
        📊 {files.length} SCREENER{files.length === 1 ? '' : 'S'}
      </span>
      <span style={{ width: 1, height: 12, background: '#1E3A5F' }} />
      {files.slice(0, 12).map((f, i) => (
        <span key={f + '_' + i} style={{
          fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 600,
          padding: '2px 7px', borderRadius: 3, background: 'var(--mc-bg-4)',
          fontFamily: 'ui-sans-serif, system-ui',
          maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={f}>
          {cleanName(f)}
        </span>
      ))}
      {files.length > 12 && (
        <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontStyle: 'italic' }}>
          +{files.length - 12} more
        </span>
      )}
    </div>
  );
}

// PATCH 0987/0990 — Multi-confirmed picks: stocks that appear in 2+ uploaded
// Screener.in CSVs. Classic conviction-by-consensus signal.
function MultiConfirmedCard({ stocks }: { stocks: any[] }) {
  const cleanName = (n: string) =>
    n.replace(/\.(csv|xlsx?|tsv)$/i, '')
     .replace(/^Screener[._-]+/i, '')
     .replace(/[_-]+/g, ' ')
     .trim();
  const multi = React.useMemo(() => {
    return stocks
      .filter((s: any) => Array.isArray(s._screeners) && s._screeners.length >= 2
                       && s.grade !== 'D'
                       && (s.redFlagSummary?.critical ?? 0) === 0)
      .map((s: any) => ({ ...s, _scrCount: s._screeners.length }))
      .sort((a: any, b: any) => (b._scrCount - a._scrCount) || (b.score - a.score))
      .slice(0, 15);
  }, [stocks]);

  const cardStyle: React.CSSProperties = {
    background: '#0E1822', padding: 14, borderRadius: 8,
    border: '1px solid #22D3EE40',
  };

  if (multi.length === 0) {
    // PATCH 1101gg — detect whether ANY row in the current dataset has the
    // screenerFiles field tracked. If at least one row has it, the user HAS
    // re-uploaded after the tracking patch landed — so the stale "re-upload"
    // copy is wrong. Show a different message: they've re-uploaded but no
    // single ticker appears in 2+ different CSVs.
    // PATCH 1101jj — Fix `rows is not defined` build error from 1101gg. This
    // function uses `stocks`, not `rows`. The mistake broke USA Analytics
    // entirely with "Page — Something went wrong". Renamed reference.
    const hasTrackedScreenerData = (stocks as any[]).some(r =>
      Array.isArray((r as any)._screeners) && (r as any)._screeners.length > 0
    );
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
          🎯 MULTI-CONFIRMED PICKS (0)
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', lineHeight: 1.5 }}>
          Stocks appearing in 2+ uploaded Screener.in CSVs land here.{' '}
          {hasTrackedScreenerData ? (
            <>No ticker is currently in your dataset in 2 or more different uploaded CSVs.
            Upload another screen (different focus — e.g. cash-rich, FII-favourites, low-debt) to find overlaps.</>
          ) : (
            <><strong style={{ color: 'var(--mc-text-3)' }}>Re-upload your screens</strong> to populate —
            screener membership wasn't tracked before this patch, so existing rows show 0.</>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
        🎯 MULTI-CONFIRMED PICKS ({multi.length})
      </div>
      <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
        Stocks that surfaced in 2+ Screener.in screens. Classic conviction-by-consensus.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {multi.map((s: any) => (
          <a key={s.symbol}
            href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
            style={{
              display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 9px', borderRadius: 4,
              border: '1px solid color-mix(in srgb, var(--mc-cyan) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-cyan) 3%, transparent)', textDecoration: 'none',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--mc-cyan)', fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 70 }}>
                {s.symbol.replace(/\.(NS|BO)$/i, '')}
              </span>
              <span style={{ flex: 1, fontSize: 11, color: 'var(--mc-text-1)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s.company || s.symbol}
              </span>
              <span style={{
                fontSize: 10, color: 'var(--mc-cyan)', fontWeight: 800,
                padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                📂 {s._scrCount}
              </span>
              <span style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {s.score} {s.grade}
              </span>
            </div>
            <div style={{
              fontSize: 9.5, color: '#67E8F9CC', fontStyle: 'italic', lineHeight: 1.35,
              maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }} title={(s._screeners || []).join(', ')}>
              In: {(s._screeners || []).map(cleanName).join(' · ')}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function MultibaggerAnalytics({
  indiaRows,
  onSwitchTab,
  initialScope,
}: {
  indiaRows: ExcelResult[];
  onSwitchTab: (t: string) => void;
  /* PATCH 1101ff — Allow caller to set the initial scope so the USA Analytics
     tab boots into USA view instead of INDIA. User reported USA analytics
     much worse than India because the separate USAAnalytics() function only
     had ~480 lines of widgets vs MultibaggerAnalytics' ~3000 lines. Route
     the USA tab through this full component instead. */
  initialScope?: MbMarketScope;
}) {
  const [scope, setScope] = React.useState<MbMarketScope>(initialScope ?? 'INDIA');

  // PATCH 0874 — USA rows + prev-score baselines now live in state with
  // a tick-bumping listener pair (storage + mb-upload:updated), so this
  // Analytics tab stays LIVE when the user uploads to the USA tab.
  // Previous useMemo([]) reads were one-shot at mount and went stale the
  // moment a fresh CSV was scored — the user reported a USA leaderboard
  // that refused to update without a full page reload.
  const [dataTick, bumpData] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => bumpData();
    const onStorage = (e: StorageEvent) => {
      if (!e.key) { refresh(); return; }
      if (e.key === USA_STORAGE_KEY || e.key === 'mb_india_prev_scores_v1' || e.key === 'mb_usa_prev_scores_v1') refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mb-upload:updated', refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mb-upload:updated', refresh);
    };
  }, []);

  const usaRows = React.useMemo<any[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(USA_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }, [dataTick]);

  // PATCH 0548 — Read prev-score baselines directly from LS so we can compute
  // score deltas, "new since last upload", and sector rotation.
  // PATCH 0874 — dep on dataTick so a fresh upload from another tab
  // refreshes the baseline view.
  const prevScoreMap = React.useMemo<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const ind = JSON.parse(localStorage.getItem('mb_india_prev_scores_v1') || '{}');
      const us  = JSON.parse(localStorage.getItem('mb_usa_prev_scores_v1')   || '{}');
      // Merge — symbols are unique across markets in practice (RELIANCE vs RELIANCE.NS).
      return { ...ind, ...us };
    } catch { return {}; }
  }, [dataTick]);

  // Conviction Beats overlay.
  // PATCH 0872 — was a one-shot useMemo, meaning Analytics overlays
  // (STRONG BUY, Add Candidates, Triple-Confirmed) went stale the moment
  // the user adjusted the CB list on /earnings-opportunities. Convert to
  // state + listener (matches the pattern already used elsewhere on the
  // page — search for `conviction-beats:updated`).
  const [convictionSet, setConvictionSet] = React.useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set<string>();
    try { return new Set<string>(getConvictionTickers()); } catch { return new Set<string>(); }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => { try { setConvictionSet(new Set<string>(getConvictionTickers())); } catch {} };
    window.addEventListener('storage', refresh);
    window.addEventListener('conviction-beats:updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('conviction-beats:updated', refresh);
    };
  }, []);

  // PATCH 0554 — listen for cross-tab decision updates so the
  // Decision-Bridge / Triple-Confirmed panels reflect new BUY / WATCH /
  // REJECTED tags without a page reload.
  // PATCH 0872 — Expose decisionTick so the `stats` useMemo can include it
  // in its deps; previously forceDecRefresh re-rendered the component but
  // the memo was cached against unchanged inputs, defeating the listener
  // (Decision Bridge / Triple-Confirmed / Decision Coverage % stayed stale
  // until the user manually switched tabs).
  const [decisionTick, forceDecRefresh] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => subscribeDecisions(() => forceDecRefresh()), []);

  // Build unified analytics rows.  PATCH 0548 / 0554 — also expose `prevScore`,
  // `marketCap` (in ₹ Cr for India, $ B for USA), red-flag counts (India),
  // and the USA forensic-flag triple (FCF/Op divergence, post-run stretched,
  // earnings proximity).  This lets every downstream block — Decision Bridge,
  // Quality Audit, Triple-Confirmed — operate off one in-memory list.
  type AnaStock = MbAnalyticsStock & {
    prevScore?: number;
    marketCapCr?: number;
    marketCapB?: number;
    redFlagSummary?: {
      critical: number;
      structural: number;   // HIGH STRUCTURAL count
      cyclical: number;     // HIGH CYCLICAL count
      medium: number;
      total: number;
    };
    fcfOpDivergence?: boolean;
    postRunStretched?: boolean;
    earningsProximityDays?: number;
    suggestedMaxPositionPct?: number;
    // PATCH 0991 — Screener.in CSV file names this stock appeared in.
    // Powers the 🎯 MULTI-CONFIRMED PICKS card + per-row "📂 N" badge.
    _screeners?: string[];
  };
  const stocks: AnaStock[] = React.useMemo(() => {
    const stripSym = (s: string) => (s || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
    const ind = (indiaRows || []).map((r) => {
      const flags = (r as any).redFlags as { severity: string; kind?: string }[] | undefined;
      const summary = flags && flags.length > 0 ? {
        critical: flags.filter((f) => f.severity === 'CRITICAL').length,
        structural: flags.filter((f) => f.severity === 'HIGH' && f.kind === 'STRUCTURAL').length,
        cyclical: flags.filter((f) => f.severity === 'HIGH' && f.kind === 'CYCLICAL').length,
        medium: flags.filter((f) => f.severity === 'MEDIUM').length,
        total: flags.length,
      } : { critical: 0, structural: 0, cyclical: 0, medium: 0, total: 0 };
      return {
        symbol: r.symbol,
        // PATCH 0585 — Field is `company` on parsed India rows, not `companyName`.
        // Earlier mismatch silently emptied every company display across analytics.
        company: (r as any).company,
        score: r.score,
        grade: r.grade,
        sector: (r as any).sector,
        market: 'INDIA' as const,
        prevScore: prevScoreMap[r.symbol] ?? prevScoreMap[stripSym(r.symbol)],
        marketCapCr: (r as any).marketCapCr as number | undefined,
        redFlagSummary: summary,
        // PATCH 0991 — pass through screener-file membership for MULTI-CONFIRMED card
        _screeners: ((r as any)._screeners as string[] | undefined) ?? [],
      };
    });
    const us = (usaRows || []).map((r: any) => ({
      symbol: r.symbol,
      // PATCH 0585 — Field is `company` on parsed USA rows (parser stores
      // `company: String(row['Description']??'').trim()`), not `companyName`.
      company: r.company || r.companyName,
      score: r.score,
      grade: r.grade,
      sector: r.sector,
      market: 'USA' as const,
      prevScore: prevScoreMap[r.symbol] ?? prevScoreMap[stripSym(r.symbol)],
      marketCapB: r.marketCapB as number | undefined,
      fcfOpDivergence: r.fcfOpDivergence === true,
      postRunStretched: r.postRunStretched === true,
      earningsProximityDays: typeof r.earningsProximityDays === 'number' ? r.earningsProximityDays : undefined,
      suggestedMaxPositionPct: typeof r.suggestedMaxPositionPct === 'number' ? r.suggestedMaxPositionPct : undefined,
      // PATCH 1101mm — pass _screeners + USA-specific fields through to stocks.
      // Previously USA mapping stripped these fields (only India side carried
      // _screeners), so MULTI-CONFIRMED PICKS always showed 0 + the new R40
      // widget had no data to read.
      _screeners: ((r as any)._screeners as string[] | undefined) ?? [],
      ruleOf40: typeof r.ruleOf40 === 'number' ? r.ruleOf40
              : (typeof r.revenueGrowthAnn === 'number' && typeof r.fcfMarginAnn === 'number'
                  ? r.revenueGrowthAnn + r.fcfMarginAnn
                  : undefined),
      revenueGrowthAnn: r.revenueGrowthAnn,
      fcfMarginAnn: r.fcfMarginAnn,
      capTier: r.capTier,
      // PATCH 1101mm — also surface common quality metrics for richer USA widgets
      roic: r.roic,
      roe: r.roe,
      grossMarginTtm: r.grossMarginTtm ?? r.grossMarginAnn,
      piotroskiFScore: r.piotroskiFScore,
    }));
    const merged: AnaStock[] = [...ind, ...us];
    return scope === 'BOTH' ? merged : merged.filter((s) => s.market === scope);
  }, [indiaRows, usaRows, scope, prevScoreMap]);

  // PATCH 0548 — Richer stats including median, P25/P75, score histogram,
  // sector rotation, decision buckets, hidden gems, concentration risk.
  const stats = React.useMemo(() => {
    const total = stocks.length;
    const grades: Record<string, number> = {};
    const sectorMap: Record<string, { count: number; avgScore: number; total: number; prevTotal: number; prevCount: number }> = {};
    const scoreArr: number[] = [];
    const stripSym = (s: string) => (s || '').toUpperCase().replace(/\.(NS|BO)$/i, '');

    for (const s of stocks) {
      grades[s.grade] = (grades[s.grade] || 0) + 1;
      scoreArr.push(s.score || 0);
      const sec = s.sector || 'Unclassified';
      if (!sectorMap[sec]) sectorMap[sec] = { count: 0, avgScore: 0, total: 0, prevTotal: 0, prevCount: 0 };
      sectorMap[sec].count++;
      sectorMap[sec].total += s.score || 0;
      if (typeof s.prevScore === 'number') {
        sectorMap[sec].prevTotal += s.prevScore;
        sectorMap[sec].prevCount++;
      }
    }

    // Score quartiles
    const sortedScores = [...scoreArr].sort((a, b) => a - b);
    const pct = (q: number) => {
      if (sortedScores.length === 0) return 0;
      const idx = Math.floor((sortedScores.length - 1) * q);
      return sortedScores[idx];
    };
    const p25 = pct(0.25), p50 = pct(0.50), p75 = pct(0.75);
    const avg = total > 0 ? Math.round(scoreArr.reduce((a, b) => a + b, 0) / total) : 0;

    // Sector rollups + rotation (Δ avg vs prev upload)
    const sectorRanked = Object.entries(sectorMap)
      .map(([sector, v]) => {
        const curAvg = Math.round(v.total / Math.max(1, v.count));
        const prevAvg = v.prevCount > 0 ? Math.round(v.prevTotal / v.prevCount) : null;
        const delta = prevAvg !== null ? curAvg - prevAvg : null;
        return { sector, count: v.count, avgScore: curAvg, prevAvg, delta };
      })
      .sort((a, b) => b.count - a.count);
    const sectorAvgLookup: Record<string, number> = {};
    for (const s of sectorRanked) sectorAvgLookup[s.sector] = s.avgScore;

    const aPlus = grades['A+'] || 0;
    const aOnly = grades['A'] || 0;
    const aTotal = aPlus + aOnly;
    const aPct = total > 0 ? Math.round((aTotal / total) * 100) : 0;

    // Score histogram (10-wide bins)
    const histogram: { bin: string; min: number; max: number; count: number }[] = [];
    for (let lo = 0; lo <= 90; lo += 10) {
      const hi = lo === 90 ? 100 : lo + 9;
      const count = scoreArr.filter((v) => v >= lo && v <= hi).length;
      histogram.push({ bin: `${lo}-${hi}`, min: lo, max: hi, count });
    }

    // Δ score vs prev upload
    let deltaSum = 0, deltaN = 0;
    let newCount = 0;
    for (const s of stocks) {
      if (typeof s.prevScore === 'number') {
        deltaSum += (s.score || 0) - s.prevScore;
        deltaN++;
      } else {
        newCount++;
      }
    }
    const meanDelta = deltaN > 0 ? Math.round((deltaSum / deltaN) * 10) / 10 : 0;

    // ── Decision buckets ────────────────────────────────────────────────
    // PATCH 0587 — STRONG BUY criteria RELAXED per user feedback:
    // was (Grade A/A+ AND on CB AND sector ≥65 avg) — produced only 2 picks
    // out of 83. New rule: Grade A/A+ AND (on CB OR sector ≥60 avg) AND
    // clean (≤ 1 red flag). Expected: ~8-12 names of an 83-row universe,
    // matching realistic portfolio construction.
    const isInCb = (sym: string) => convictionSet.has(stripSym(sym));
    const strongBuy = stocks
      .filter((s) => {
        if (!(s.grade === 'A+' || s.grade === 'A')) return false;
        // PATCH 0988 — defense in depth (avoid set computed below this hook,
        // so we re-check the same red-flag conditions here)
        const crit = s.redFlagSummary?.critical ?? 0;
        const struc = s.redFlagSummary?.structural ?? 0;
        if (crit > 0 || struc > 0) return false;
        const cb = isInCb(s.symbol);
        const sectorHot = (sectorAvgLookup[s.sector || 'Unclassified'] ?? 0) >= 60;
        if (!cb && !sectorHot) return false;
        const flagTotal = s.redFlagSummary?.total ?? 0;
        const critical = s.redFlagSummary?.critical ?? 0;
        const structural = s.redFlagSummary?.structural ?? 0;
        // Must be reasonably clean. ≤1 medium flag OK; critical or
        // structural flags disqualify.
        if (critical > 0 || structural > 0) return false;
        if (flagTotal > 1) return false;
        return true;
      })
      .sort((a, b) => b.score - a.score);

    // 📈 RE-RATING — score up ≥5 vs prev, still grade A/A+ and not flagged
    const rerating = stocks
      .filter((s) => typeof s.prevScore === 'number'
        && (s.score - (s.prevScore as number)) >= 5
        && (s.grade === 'A+' || s.grade === 'A')
        // PATCH 0988 — exclude flagged stocks even if score jumped
        && (s.redFlagSummary?.critical ?? 0) === 0
        && (s.redFlagSummary?.structural ?? 0) === 0)
      .sort((a, b) => (b.score - (b.prevScore as number)) - (a.score - (a.prevScore as number)));

    // PATCH 0587 — Split AVOID into TWO buckets per user feedback:
    //   - AVOID (Fundamental): true deterioration confirmed (D, C+drop)
    //     OR critical/structural red flags surfaced.
    //   - REVIEW (Data): rows where the scorer can't render a confident
    //     verdict because of missing data (very low scores with no flags,
    //     usually < 30 with red-flag count = 0). These were silently
    //     mixed into AVOID and made the bucket look like everything was
    //     failing when half of it was just "we don't know yet".
    const looksLikeDataGap = (s: typeof stocks[number]) => {
      const t = s.redFlagSummary?.total ?? 0;
      return s.score < 30 && t === 0;
    };
    const avoid = stocks
      .filter((s) => !looksLikeDataGap(s) && (
        s.grade === 'D'
        || (s.grade === 'C' && typeof s.prevScore === 'number' && (s.prevScore - s.score) >= 5)
        || ((s.redFlagSummary?.critical ?? 0) > 0)
      ))
      .sort((a, b) => a.score - b.score);
    const reviewDataGap = stocks
      .filter(looksLikeDataGap)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // PATCH 0554 — Decision Bridge replaces the Sectors Heating/Cooling block,
    // which was visually broken without a prior-upload baseline. The bridge
    // surfaces names where SCORE + CONVICTION BEATS + DECISION LOGBOOK
    // disagree, because that disagreement IS the actionable insight.
    const decisionMap = (() => {
      try { return readDecisions(); } catch { return {}; }
    })();
    const decisionOf = (sym: string) => decisionMap[stripSym(sym).toUpperCase()];

    // (1) ADD CANDIDATES — Score A+/A but NOT on Conviction Beats.
    //     Already a strong fundamental but not yet on the institutional bench.
    const addCandidates = stocks
      .filter((s) => (s.grade === 'A+' || s.grade === 'A') && !isInCb(s.symbol))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // (2) DROP ALERTS — On Conviction Beats but score DROPPED ≥5 OR grade is
    //     now B/B+/C/D. The CB list is curated separately (filings-driven), so
    //     when the multibagger score deteriorates this is a genuine trim flag.
    const dropAlerts = stocks
      .filter((s) => isInCb(s.symbol) && (
        s.grade === 'B' || s.grade === 'B+' || s.grade === 'C' || s.grade === 'D' ||
        (typeof s.prevScore === 'number' && (s.prevScore - s.score) >= 5)
      ))
      .sort((a, b) => {
        // Sort by score-drop descending, then by absolute score ascending.
        const da = typeof a.prevScore === 'number' ? (a.prevScore - a.score) : 0;
        const db = typeof b.prevScore === 'number' ? (b.prevScore - b.score) : 0;
        if (db !== da) return db - da;
        return a.score - b.score;
      })
      .slice(0, 10);

    // (3) RE-EVALUATE — Previously decided REJECTED but now grade A+/A.
    //     This is the "am I being too conservative?" check.
    const reEvaluate = stocks
      .filter((s) => {
        const d = decisionOf(s.symbol);
        return d && d.status === 'REJECTED' && (s.grade === 'A+' || s.grade === 'A');
      })
      .map((s) => ({ ...s, _decision: decisionOf(s.symbol)! }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // (4) DECISION COVERAGE — % of A-roster that has any logbook decision.
    //     Helps the user spot uncovered A+ names that haven't been triaged.
    const aDecisionCount = stocks
      .filter((s) => (s.grade === 'A+' || s.grade === 'A'))
      .filter((s) => !!decisionOf(s.symbol)).length;

    // ── QUALITY AUDIT — how clean is the A-roster? ───────────────────────
    // For the user's PAYS post-mortem: A+ universe shouldn't be celebrated
    // until we know how many of those A+ names carry latent forensic risk.
    const aOnlyRoster = stocks.filter((s) => s.grade === 'A+' || s.grade === 'A');
    const qaIndia = aOnlyRoster.filter((s) => s.market === 'INDIA');
    const qaUsa   = aOnlyRoster.filter((s) => s.market === 'USA');

    const indCriticalCount   = qaIndia.filter((s) => (s.redFlagSummary?.critical ?? 0) > 0).length;
    const indStructuralCount = qaIndia.filter((s) => (s.redFlagSummary?.structural ?? 0) > 0).length;
    const indCyclicalCount   = qaIndia.filter((s) => (s.redFlagSummary?.cyclical ?? 0) > 0).length;
    const indCleanCount      = qaIndia.filter((s) => (s.redFlagSummary?.total ?? 0) === 0).length;

    const usaFcfDivCount     = qaUsa.filter((s) => s.fcfOpDivergence).length;
    const usaPostRunCount    = qaUsa.filter((s) => s.postRunStretched).length;
    const usaEarnSoonCount   = qaUsa.filter((s) =>
      typeof s.earningsProximityDays === 'number' && s.earningsProximityDays >= 0 && s.earningsProximityDays <= 7
    ).length;
    const usaCleanCount      = qaUsa.filter((s) =>
      !s.fcfOpDivergence && !s.postRunStretched &&
      !(typeof s.earningsProximityDays === 'number' && s.earningsProximityDays >= 0 && s.earningsProximityDays <= 7)
    ).length;

    // Build per-flag drill-through lists (cap at 6 for compact display).
    const indFlaggedRoster = qaIndia
      .filter((s) => (s.redFlagSummary?.critical ?? 0) > 0 || (s.redFlagSummary?.structural ?? 0) > 0)
      .sort((a, b) => (b.redFlagSummary?.critical ?? 0) - (a.redFlagSummary?.critical ?? 0)
                   || (b.redFlagSummary?.structural ?? 0) - (a.redFlagSummary?.structural ?? 0))
      .slice(0, 8);
    const usaFcfDivList     = qaUsa.filter((s) => s.fcfOpDivergence).slice(0, 6);
    const usaPostRunList    = qaUsa.filter((s) => s.postRunStretched).slice(0, 6);
    const usaEarnSoonList   = qaUsa
      .filter((s) => typeof s.earningsProximityDays === 'number' && s.earningsProximityDays >= 0 && s.earningsProximityDays <= 7)
      .sort((a, b) => (a.earningsProximityDays ?? 99) - (b.earningsProximityDays ?? 99))
      .slice(0, 6);

    // ── TRIPLE-CONFIRMED — score + CB + decision = BUY/WATCH ─────────────
    // The highest-conviction quadrant.  These are names where the
    // fundamental scorer, the curated CB bench, AND the user's explicit
    // logbook decision ALL agree it deserves capital.
    const tripleConfirmed = stocks
      .filter((s) => {
        if (!(s.grade === 'A+' || s.grade === 'A')) return false;
        if (!isInCb(s.symbol)) return false;
        const d = decisionOf(s.symbol);
        return d && (d.status === 'BUY' || d.status === 'WATCH');
      })
      .map((s) => ({ ...s, _decision: decisionOf(s.symbol)! }))
      .sort((a, b) => b.score - a.score);

    const qualityAudit = {
      aTotal: aOnlyRoster.length,
      indiaTotal: qaIndia.length,
      indCriticalCount, indStructuralCount, indCyclicalCount, indCleanCount,
      indFlaggedRoster,
      usaTotal: qaUsa.length,
      usaFcfDivCount, usaPostRunCount, usaEarnSoonCount, usaCleanCount,
      usaFcfDivList, usaPostRunList, usaEarnSoonList,
    };

    const decisionBridge = {
      addCandidates,
      dropAlerts,
      reEvaluate,
      aDecisionCount,
      aTotal: aOnlyRoster.length,
    };

    // Cap-size breakdown (India only — uses ₹ Cr).
    const indiaWithMcap = stocks.filter((s) => s.market === 'INDIA' && typeof s.marketCapCr === 'number');
    const capBuckets: { label: string; min: number; max: number; count: number; avgScore: number; total: number }[] = [
      { label: 'Large Cap (≥ ₹20,000 Cr)',     min: 20000, max: Infinity, count: 0, avgScore: 0, total: 0 },
      { label: 'Mid Cap (₹5,000–20,000 Cr)',   min: 5000,  max: 20000,    count: 0, avgScore: 0, total: 0 },
      { label: 'Small Cap (₹500–5,000 Cr)',    min: 500,   max: 5000,     count: 0, avgScore: 0, total: 0 },
      { label: 'Micro Cap (< ₹500 Cr)',        min: 0,     max: 500,      count: 0, avgScore: 0, total: 0 },
    ];
    for (const s of indiaWithMcap) {
      const mcap = s.marketCapCr as number;
      for (const b of capBuckets) {
        if (mcap >= b.min && mcap < b.max) { b.count++; b.total += s.score || 0; break; }
      }
    }
    for (const b of capBuckets) b.avgScore = b.count > 0 ? Math.round(b.total / b.count) : 0;
    const hasCapData = indiaWithMcap.length > 0;

    // Hidden Gems — score ≥70, NOT on CB, sector avg <60
    const hiddenGems = stocks
      .filter((s) => (s.score || 0) >= 70
        && !isInCb(s.symbol)
        && (sectorAvgLookup[s.sector || 'Unclassified'] ?? 100) < 60)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // Concentration risk — % of A/A+ in top-3 sectors
    const aRoster = stocks.filter((s) => s.grade === 'A+' || s.grade === 'A');
    const aSectorCounts: Record<string, number> = {};
    for (const s of aRoster) {
      const sec = s.sector || 'Unclassified';
      aSectorCounts[sec] = (aSectorCounts[sec] || 0) + 1;
    }
    const aSectorRanked = Object.entries(aSectorCounts).sort((a, b) => b[1] - a[1]);
    const top3Sectors = aSectorRanked.slice(0, 3);
    const top3Count = top3Sectors.reduce((sum, [, c]) => sum + c, 0);
    const top3Pct = aRoster.length > 0 ? Math.round((top3Count / aRoster.length) * 100) : 0;
    const concentrationRisk = top3Pct > 60 && aRoster.length >= 8;

    // PATCH 0988 — single-classification precedence: AVOID is terminal.
    // Build a stable Set of AVOID-classified symbols, then EXCLUDE them
    // from every positive-classification section so the same stock never
    // appears in both AVOID and BUY/TOP 25/MULTI-CONFIRMED/CONVICTION.
    const _avoidSyms = new Set(avoid.map((s) => s.symbol));
    // Top picks expanded to 25 — excludes AVOID
    const topPicks = [...stocks]
      .filter((s) => !_avoidSyms.has(s.symbol))
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);

    // Conviction overlap also excludes AVOID (a flagged stock shouldn't
    // surface as a "strongest decision-ready candidate" just because the
    // CB bench has it from an old quarter).
    const convictionOverlap = stocks.filter((s) => isInCb(s.symbol) && !_avoidSyms.has(s.symbol));

    // PATCH 0578 — Operating Leverage Cluster scores. Compute on the raw
    // India rows (which carry the per-row fundamentals the cluster formula
    // needs); USA rows aren't included because the cluster framework is
    // India-centric (Indian industrial-capex theme).
    const clusterEntries = (indiaRows || []).map((r: any) => {
      const cluster = computeClusterScore(r);
      const sym = (r.symbol || '').toUpperCase();
      return {
        symbol: r.symbol,
        company: r.company, // PATCH 0585 — was r.companyName (wrong field)
        sector: r.sector,
        score: r.score,
        grade: r.grade,
        cluster,
        isSeed: isClusterSeed(sym),
      };
    });
    // PATCH 0586 — split scored vs data-incomplete so the analytics card
    // can show the gap clearly instead of mixing DATA_INCOMPLETE rows into
    // the low end of the ranking.
    const clusterRankedAll = [...clusterEntries].sort((a, b) =>
      (b.isSeed ? 1 : 0) - (a.isSeed ? 1 : 0) || b.cluster.score - a.cluster.score
    );
    const clusterRanked = clusterRankedAll.filter(x => x.cluster.tier !== 'DATA_INCOMPLETE');
    const clusterIncomplete = clusterRankedAll.filter(x => x.cluster.tier === 'DATA_INCOMPLETE');
    const clusterHighConv = clusterRanked.filter(x => x.cluster.tier === 'HIGH_CONVICTION');
    const clusterEmerging = clusterRanked.filter(x => x.cluster.tier === 'EMERGING');

    // PATCH 0578.5 — Cash-Rich / Net-Zero Debt hunting lens. User-requested
    // (mid-session): "next hunting process" target is companies sitting on
    // meaningful cash with effectively no debt. Computed per-market so we
    // can show both India and USA candidates side by side.
    type CashRichRow = {
      symbol: string; company?: string; sector?: string;
      score: number; grade: string; market: 'INDIA' | 'USA';
      cashAbsLabel: string;       // e.g. '₹ 850 Cr' or '$ 2.4B'
      cashToMcapPct: number;      // 0-100
      debtIndicator: string;      // 'Net cash' | 'D/E 0.08' | 'ND/EBITDA -1.2×'
    };
    const indiaCashRich: CashRichRow[] = (indiaRows || []).map((r: any) => {
      const cash = num(r.cashAndEq);
      const mcap = num(r.marketCapCr);
      const de = num(r.de);
      const nde = num(r.netDebtEbitda);
      if (typeof cash !== 'number' || typeof mcap !== 'number' || mcap <= 0) return null;
      const ratio = (cash / mcap) * 100;
      const noDebt =
        (typeof de === 'number' && de < 0.10) ||
        (typeof nde === 'number' && nde <= 0);
      if (ratio < 20 || !noDebt) return null;
      const debtIndicator =
        (typeof nde === 'number' && nde <= 0) ? 'Net cash'
        : (typeof de === 'number') ? `D/E ${de.toFixed(2)}`
        : 'low debt';
      return {
        symbol: r.symbol,
        company: r.company, // PATCH 0585 — was r.companyName (wrong field)
        sector: r.sector,
        score: r.score,
        grade: r.grade,
        market: 'INDIA' as const,
        cashAbsLabel: `₹ ${cash.toFixed(0)} Cr`,
        cashToMcapPct: Math.round(ratio),
        debtIndicator,
      };
    }).filter(Boolean) as CashRichRow[];
    const usaCashRich: CashRichRow[] = (usaRows || []).map((r: any) => {
      const cash = num(r.cashUsd ?? r.cashStInvest);
      const mcap = num(r.marketCapUsd);
      const de = num(r.de);
      const nd = num(r.netDebtUsd);
      if (typeof cash !== 'number' || typeof mcap !== 'number' || mcap <= 0) return null;
      const ratio = (cash / mcap) * 100;
      const noDebt =
        (typeof de === 'number' && de < 0.10) ||
        (typeof nd === 'number' && nd <= 0);
      if (ratio < 20 || !noDebt) return null;
      const cashB = cash / 1e9;
      const debtIndicator =
        (typeof nd === 'number' && nd <= 0) ? 'Net cash'
        : (typeof de === 'number') ? `D/E ${de.toFixed(2)}`
        : 'low debt';
      return {
        symbol: r.symbol,
        company: r.company || r.companyName, // PATCH 0585 — was r.companyName (wrong field)
        sector: r.sector,
        score: r.score,
        grade: r.grade,
        market: 'USA' as const,
        cashAbsLabel: cashB >= 1 ? `$ ${cashB.toFixed(1)}B` : `$ ${(cash / 1e6).toFixed(0)}M`,
        cashToMcapPct: Math.round(ratio),
        debtIndicator,
      };
    }).filter(Boolean) as CashRichRow[];
    const cashRich = [...indiaCashRich, ...usaCashRich]
      .sort((a, b) => b.cashToMcapPct - a.cashToMcapPct);

    return {
      total, grades, avg, p25, p50, p75,
      sectorRanked, sectorAvgLookup,
      aPlus, aOnly, aTotal, aPct, topPicks, convictionOverlap,
      histogram, meanDelta, newCount,
      strongBuy, rerating, avoid, reviewDataGap,
      // PATCH 0588 — Valuation Gateway (PEG / PB-ROE)
      valuationGate: (() => {
        const rated = stocks.map((s: any) => {
          const peg = num(s.peg);
          const pb = num(s.pb);
          const roe = num(s.roe);
          let vScore = 0;
          const notes: string[] = [];
          if (typeof peg === 'number') {
            if (peg < 1.0) { vScore += 15; notes.push(`PEG ${peg.toFixed(2)} (cheap)`); }
            else if (peg < 1.5) { vScore += 10; notes.push(`PEG ${peg.toFixed(2)}`); }
            else if (peg < 2.0) { vScore += 5; notes.push(`PEG ${peg.toFixed(2)}`); }
            else { notes.push(`PEG ${peg.toFixed(2)} (expensive)`); }
          }
          if (typeof pb === 'number' && typeof roe === 'number' && pb < 1.5 && roe > 15) {
            vScore += 5;
            notes.push(`PB ${pb.toFixed(1)} + ROE ${roe.toFixed(0)}%`);
          }
          return { ...s, valuationScore: vScore, valuationNotes: notes.join(' · ') };
        });
        // Only surface A-grade names that ALSO clear the valuation gate (score ≥ 10).
        return rated
          .filter((s: any) => (s.grade === 'A+' || s.grade === 'A') && s.valuationScore >= 10)
          .sort((a: any, b: any) => b.valuationScore - a.valuationScore)
          .slice(0, 12);
      })(),
      // PATCH 0589 — Today's Top 3 Buys widget (auto-picked from STRONG BUY
      // and ADD TO BENCH where the row is NOT already on Conviction Beats —
      // surface the names you haven't actioned yet).
      top3Today: (() => {
        const candidates = [
          ...strongBuy,
          ...stocks
            .filter((s) => (s.grade === 'A+' || s.grade === 'A') && !isInCb(s.symbol))
            .sort((a, b) => b.score - a.score),
        ];
        const seen = new Set<string>();
        const out: typeof stocks = [];
        for (const c of candidates) {
          const key = (c.symbol || '').toUpperCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(c);
          if (out.length >= 3) break;
        }
        return out;
      })(),
      // PATCH 0554 — replaces heatingUp / cooling (broken w/o baseline)
      decisionBridge, qualityAudit, tripleConfirmed,
      capBuckets, hasCapData,
      hiddenGems,
      top3Sectors, top3Pct, concentrationRisk,
      // PATCH 0578 — cluster scores + cash-rich lens
      clusterRanked, clusterHighConv, clusterEmerging, clusterIncomplete,
      cashRich,
    };
    // PATCH 0872 — `decisionTick` added so any BUY/WATCH/REJECTED tag
    // change anywhere in the app re-computes this memo (Decision Bridge,
    // Triple-Confirmed, Decision Coverage %). Was previously cached.
  }, [stocks, convictionSet, indiaRows, usaRows, decisionTick]);

  // Local num helper for the new memos.
  function num(v: any): number | undefined {
    if (v === undefined || v === null) return undefined;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#0D1623', border: '1px solid #1A2540',
    borderRadius: 6, padding: '12px 14px',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: '#6B7A8D', letterSpacing: '0.3px', marginBottom: 4,
  };

  // PATCH 0573 — Per-row "why" reason text shown in the decision-ready
  // buckets (STRONG BUY / ADD TO BENCH / TRIM ALERTS / RE-EVALUATE).
  // Reasons are heuristic and derive purely from signals we already have
  // on the stock object + the stats cache: grade, score, prevScore,
  // sector momentum, conviction-bench membership, red-flag summary,
  // forensic flags (USA), and prior decision log entry. Keeps the analyst
  // honest — they see WHY a row landed in a bucket, not just that it did.
  type ReasonKind = 'STRONG_BUY' | 'ADD' | 'TRIM' | 'REEVAL';
  const reasonFor = (s: typeof stats.topPicks[number] & { _decision?: { reason?: string; date?: string } }, kind: ReasonKind): string => {
    const sectorAvg = stats.sectorAvgLookup?.[s.sector || 'Unclassified'];
    const delta = typeof s.prevScore === 'number' ? s.score - s.prevScore : null;
    const flagSummary = s.redFlagSummary;
    if (kind === 'STRONG_BUY') {
      const parts: string[] = [];
      parts.push(`Grade ${s.grade}`);
      if (typeof sectorAvg === 'number') parts.push(`sector hot (avg ${sectorAvg})`);
      parts.push('on Conviction Beats');
      if (delta != null && delta > 0) parts.push(`▲+${delta} vs prev`);
      if (flagSummary && flagSummary.total === 0) parts.push('clean');
      return parts.join(' · ');
    }
    if (kind === 'ADD') {
      const parts: string[] = [];
      parts.push(`Grade ${s.grade}`);
      if (typeof sectorAvg === 'number' && sectorAvg >= 60) parts.push(`sector strong (avg ${sectorAvg})`);
      else parts.push('not yet on bench');
      if (s.fcfOpDivergence) parts.push('⚠ FCF/op divergence');
      if (s.postRunStretched) parts.push('⚠ post-run stretched');
      if (flagSummary && flagSummary.critical > 0) parts.push(`⚠ ${flagSummary.critical} critical flag`);
      else if (flagSummary && flagSummary.structural > 0) parts.push(`⚠ ${flagSummary.structural} structural flag`);
      else if (flagSummary && flagSummary.total === 0) parts.push('clean');
      return parts.join(' · ');
    }
    if (kind === 'TRIM') {
      const parts: string[] = [];
      if (delta != null && delta <= -5) parts.push(`Score ▼${Math.abs(delta)} vs prev`);
      else if (delta != null && delta < 0) parts.push(`Score ▼${Math.abs(delta)}`);
      if (['B','C','D'].includes(s.grade)) parts.push(`grade dropped to ${s.grade}`);
      else if (s.grade === 'B+') parts.push(`grade slipped to ${s.grade}`);
      if (flagSummary && flagSummary.critical > 0) parts.push(`${flagSummary.critical} critical flag`);
      else if (flagSummary && flagSummary.structural > 0) parts.push(`${flagSummary.structural} structural flag`);
      if (parts.length === 0) parts.push(`Watching — ${s.grade} grade`);
      return parts.join(' · ');
    }
    if (kind === 'REEVAL') {
      const parts: string[] = [];
      parts.push(`Rejected → ${s.grade}`);
      if (s._decision?.reason) parts.push(`(reason: "${s._decision.reason.slice(0, 60)}${s._decision.reason.length > 60 ? '…' : ''}")`);
      if (s._decision?.date) parts.push(`on ${String(s._decision.date).slice(0, 10)}`);
      return parts.join(' ');
    }
    return '';
  };

  // PATCH 0573 / 0585 — Stacked cell. After user feedback (0585), company
  // name is now the primary line (12px bold sans) and the ticker is the
  // smaller monospaced badge below it. Earlier version had it flipped and
  // the parser-field bug (`r.companyName` vs `r.company`) made the company
  // never render at all — analytics looked ticker-only. Both fixed.
  const TickerCompanyCell = ({ ticker, company }: { ticker: string; company?: string }) => (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {company ? (
        <>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mc-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{company}</span>
          <span style={{ fontSize: 9, color: 'var(--mc-text-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 600, letterSpacing: '0.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticker}</span>
        </>
      ) : (
        // No company name available — fall back to ticker as the headline.
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-text-1)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticker}</span>
      )}
    </div>
  );

  if (stats.total === 0) {
    return (
      <div style={{ padding: 30, textAlign: 'center', color: 'var(--mc-text-3)' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
        <p style={{ margin: 0, fontWeight: 700, color: 'var(--mc-text-1)' }}>No Multibagger data uploaded yet</p>
        <p style={{ margin: '8px 0 16px', fontSize: 12, lineHeight: 1.5, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
          Upload your Screener.in CSV (India) or TradingView CSV (USA) on the ranking tabs.
          The analytics view will populate the moment data is loaded.
        </p>
        <div style={{ display: 'inline-flex', gap: 8 }}>
          <button onClick={() => onSwitchTab('excel')} style={{
            padding: '6px 14px', borderRadius: 6, border: '1px solid color-mix(in srgb, var(--mc-bullish) 38%, transparent)',
            background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', color: 'var(--mc-bullish)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>🇮🇳 Upload India CSV</button>
          <button onClick={() => onSwitchTab('usa')} style={{
            padding: '6px 14px', borderRadius: 6, border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)',
            background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', color: 'var(--mc-cyan)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>🇺🇸 Upload USA CSV</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── MARKET SCOPE TOGGLE ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', marginRight: 6 }}>MARKET</span>
        {(['INDIA', 'USA', 'BOTH'] as MbMarketScope[]).map((m) => {
          const isActive = scope === m;
          const color = m === 'INDIA' ? '#10B981' : m === 'USA' ? '#22D3EE' : '#8B5CF6';
          return (
            <button
              key={m}
              onClick={() => setScope(m)}
              style={{
                fontSize: 11, fontWeight: 800, letterSpacing: '0.4px', cursor: 'pointer',
                border: `1px solid ${isActive ? color : 'var(--mc-bg-4)'}`,
                backgroundColor: isActive ? `${color}22` : 'transparent',
                color: isActive ? color : 'var(--mc-text-4)',
                padding: '4px 12px', borderRadius: 4,
              }}
            >
              {m === 'INDIA' ? '🇮🇳 INDIA' : m === 'USA' ? '🇺🇸 USA' : '🌐 BOTH'}
            </button>
          );
        })}
      </div>

      {/* PATCH 0984 — compact screener chip row */}
      <MbScreenerChips />

      {/* ── STATS STRIP (PATCH 0548: 10-KPI grid) ───────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <div style={cardStyle}>
          <div style={labelStyle}>Total stocks</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-cyan)', fontVariantNumeric: 'tabular-nums' }}>{stats.total}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Avg / Median score</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--mc-bullish)', fontVariantNumeric: 'tabular-nums' }}>
            {stats.avg} <span style={{ color: 'var(--mc-text-4)', fontSize: 13 }}>/ {stats.p50}</span>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>P75 / P25 thresholds</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--mc-info)', fontVariantNumeric: 'tabular-nums' }}>
            {stats.p75} <span style={{ color: 'var(--mc-text-4)', fontSize: 13 }}>/ {stats.p25}</span>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>A+ / A counts</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--mc-bullish)', fontVariantNumeric: 'tabular-nums' }}>
            {stats.aPlus} <span style={{ color: 'var(--mc-cyan)' }}>/ {stats.aOnly}</span>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>% A-or-better</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-warn)', fontVariantNumeric: 'tabular-nums' }}>{stats.aPct}%</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Conviction overlap</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#EC4899', fontVariantNumeric: 'tabular-nums' }}>{stats.convictionOverlap.length}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Sectors represented</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-state-persistent)', fontVariantNumeric: 'tabular-nums' }}>{stats.sectorRanked.length}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>New since last upload</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#06B6D4', fontVariantNumeric: 'tabular-nums' }}>{stats.newCount}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Mean Δ vs last upload</div>
          <div style={{
            fontSize: 22, fontWeight: 900,
            color: stats.meanDelta > 0 ? 'var(--mc-bullish)' : stats.meanDelta < 0 ? 'var(--mc-bearish)' : 'var(--mc-text-3)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {stats.meanDelta > 0 ? '▲ +' : stats.meanDelta < 0 ? '▼ ' : '• '}{Math.abs(stats.meanDelta).toFixed(1)}
          </div>
        </div>
      </div>

      {/* ── CONCENTRATION RISK BANNER (PATCH 0548) ──────────────────────── */}
      {stats.concentrationRisk && (
        <div style={{
          border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 6%, transparent)',
          borderRadius: 6, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 18 }}>⚠</span>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--mc-warn)', fontWeight: 600, lineHeight: 1.5 }}>
            <span style={{ fontWeight: 800 }}>Concentration risk:</span>{' '}
            {stats.top3Pct}% of your A-grade names sit in{' '}
            {stats.top3Sectors.map(([sec, n]) => (
              <span key={sec} style={{ fontWeight: 700 }}>{sec} ({n}){', '}</span>
            ))}
            <span style={{ color: 'var(--mc-text-2)', fontWeight: 500 }}>— diversify exposure across sectors to avoid single-cycle drawdown.</span>
          </div>
        </div>
      )}

      {/* ── 🚀 TODAY'S TOP 3 BUYS (PATCH 0589) ───────────────────────────
          Auto-picked headline widget: highest-conviction A+/A names you
          haven't actioned yet (STRONG BUY ∪ ADD-TO-BENCH minus already
          on Conviction Beats). Sits at the top of analytics so the
          analyst sees the next 3 actions before scrolling. */}
      {stats.top3Today && stats.top3Today.length > 0 && (
        <div style={{
          ...cardStyle,
          borderColor: 'color-mix(in srgb, var(--mc-warn) 44%, transparent)',
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--mc-warn) 8%, transparent) 0%, transparent 100%)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, color: 'var(--mc-warn)', fontWeight: 900, letterSpacing: '0.4px' }}>
              🚀 TODAY&apos;S TOP {stats.top3Today.length} BUYS
            </div>
            <span style={{ fontSize: 10, color: 'var(--mc-warn)', background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>ACTION-READY</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 10, lineHeight: 1.5 }}>
            The highest-conviction A+/A names you have not yet added to the bench. Open the row in Earnings
            Opportunities to add, or click the company name to open the stock sheet.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
            {stats.top3Today.map((s, i) => (
              <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', borderRadius: 6,
                  border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', background: 'color-mix(in srgb, var(--mc-warn) 6%, transparent)', textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 900, color: 'var(--mc-warn)' }}>#{i + 1}</span>
                  <TickerCompanyCell ticker={s.symbol} company={s.company} />
                  <span style={{ fontSize: 12, color: 'var(--mc-bullish)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{s.score}{s.grade}</span>
                </div>
                <span style={{ fontSize: 10, color: 'var(--mc-text-2)', lineHeight: 1.4 }}>
                  {s.sector || '—'} · {reasonFor(s as any, convictionSet.has((s.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '')) ? 'STRONG_BUY' : 'ADD')}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── DECISION-READY BUCKETS (PATCH 0548) ─────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        {/* STRONG BUY */}
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' }}>
          <div style={{ fontSize: 13, color: 'var(--mc-bullish)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            🎯 STRONG BUY ({stats.strongBuy.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            Grade A/A+, on Conviction Beats, sector avg ≥ 65.
          </div>
          {stats.strongBuy.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>No names meet all three gates yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {stats.strongBuy.slice(0, 8).map((s) => (
                <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 9px', borderRadius: 4,
                    border: '1px solid color-mix(in srgb, var(--mc-bullish) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-bullish) 3%, transparent)', textDecoration: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TickerCompanyCell ticker={s.symbol} company={s.company} />
                    <span style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}</span>
                    {/* PATCH 0991 — screener-membership badge */}
                    {Array.isArray((s as any)._screeners) && (s as any)._screeners.length >= 2 && (
                      <span title={(s as any)._screeners.join(', ')} style={{
                        fontSize: 9, color: 'var(--mc-cyan)', fontWeight: 800,
                        padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)',
                        fontVariantNumeric: 'tabular-nums',
                      }}>📂 {(s as any)._screeners.length}</span>
                    )}
                    <span style={{ fontSize: 9, color: 'var(--mc-text-3)', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sector || '—'}</span>
                  </div>
                  <span style={{ fontSize: 9.5, color: 'color-mix(in srgb, var(--mc-bullish) 80%, transparent)', fontStyle: 'italic', lineHeight: 1.35 }}>
                    Why: {reasonFor(s, 'STRONG_BUY')}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* PATCH 0927 — RE-RATING block: only render when ≥1 row.
            User feedback: "remove these in multibagger analytics" because
            empty 0-state blocks waste real estate. Block re-appears the
            moment any score jumps ≥5 vs last upload. */}
        {stats.rerating.length > 0 && (
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-cyan) 25%, transparent)' }}>
          <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            📈 RE-RATING in progress ({stats.rerating.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            Score jumped ≥ 5 vs last upload, still grade A/A+.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {stats.rerating.slice(0, 8).map((s) => {
              const delta = s.score - (s.prevScore as number);
              return (
                <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 9px', borderRadius: 4,
                    border: '1px solid color-mix(in srgb, var(--mc-cyan) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-cyan) 3%, transparent)', textDecoration: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TickerCompanyCell ticker={s.symbol} company={s.company} />
                    <span style={{ fontSize: 10, color: 'var(--mc-text-3)', fontVariantNumeric: 'tabular-nums' }}>{s.prevScore} →</span>
                    <span style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}</span>
                    <span style={{ fontSize: 10, color: 'var(--mc-bullish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>▲+{delta}</span>
                  </div>
                  <span style={{ fontSize: 9.5, color: '#67E8F9', fontStyle: 'italic', lineHeight: 1.35 }}>
                    Why: Score jumped ▲+{delta} vs last upload · still grade {s.grade}{s.sector ? ` · ${s.sector}` : ''}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
        )}

        {/* PATCH 0987 — MULTI-CONFIRMED screener picks */}
        <MultiConfirmedCard stocks={stocks} />

        {/* AVOID / TRIM */}
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)' }}>
          <div style={{ fontSize: 13, color: 'var(--mc-bearish)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            ⚠️ AVOID / TRIM ({stats.avoid.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            Grade D, or grade C with ≥ 5-point drop.
          </div>
          {stats.avoid.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>Clean roster — no warning candidates.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {stats.avoid.slice(0, 5).map((s) => {
                const delta = typeof s.prevScore === 'number' ? s.score - s.prevScore : null;
                return (
                  <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                    style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 9px', borderRadius: 4,
                      border: '1px solid color-mix(in srgb, var(--mc-bearish) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-bearish) 3%, transparent)', textDecoration: 'none' }}>
                    {/* PATCH 1101a — Grade D label split. A clean Grade D is
                        "doesn't fit the megawinner mandate" (legit large cap,
                        cyclical conglomerate, etc.). Only fraud:* CRITICAL
                        flags warrant the 🚨 NEVER BUY treatment. */}
                    {(() => {
                      const isFraudFlagged = (s.redFlagSummary?.critical ?? 0) > 0;
                      const labelColor = isFraudFlagged ? 'var(--mc-bearish)' : 'var(--mc-text-4)';
                      const labelText  = isFraudFlagged ? '🚨 NEVER BUY' : 'NOT A SETUP';
                      return (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <TickerCompanyCell ticker={s.symbol} company={s.company} />
                            <span style={{ fontSize: 11, color: 'var(--mc-bearish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score} {s.grade}</span>
                            <span style={{ fontSize: 9.5, fontWeight: 800, padding: '1px 5px', borderRadius: 3, color: labelColor, border: `1px solid ${labelColor}50`, letterSpacing: '0.4px' }}>{labelText}</span>
                            {delta !== null && delta < 0 && (
                              <span style={{ fontSize: 10, color: 'var(--mc-bearish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>▼{delta}</span>
                            )}
                          </div>
                          <span style={{ fontSize: 9.5, color: isFraudFlagged ? '#FCA5A5' : 'var(--mc-text-3)', fontStyle: 'italic', lineHeight: 1.35 }}>
                            {(() => {
                              if (isFraudFlagged) {
                                return `Why avoid: critical fraud-pattern flag fired${s.sector ? ` · ${s.sector}` : ''}`;
                              }
                              if (s.grade === 'D') {
                                return `Not a multibagger candidate by this framework's mandate (large-cap or cyclical without the early-compounder DNA). The business may still be perfectly fine to own — just not via this engine${s.sector ? ` · ${s.sector}` : ''}`;
                              }
                              return `Grade ${s.grade} with ${delta != null && delta < 0 ? `${Math.abs(delta)}-pt drop` : 'weak fundamentals'}${s.sector ? ` · ${s.sector}` : ''}`;
                            })()}
                          </span>
                        </>
                      );
                    })()}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── 🔬 REVIEW · DATA INCOMPLETE (PATCH 0587) ──────────────────────
          Rows whose composite score landed below 30 but carry no red flags.
          Almost always means the Screener export was missing core metrics
          (debtor days / working capital / interest coverage etc.) rather
          than the business deteriorating. Splitting these out of AVOID
          per user feedback: "CRAFTSMAN 0D / QPOWER 5D / GARUDA 10D are
          probably data gaps, not deterioration." */}
      {stats.reviewDataGap && stats.reviewDataGap.length > 0 && (
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)' }}>
          <div style={{ fontSize: 13, color: 'var(--mc-state-persistent)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            🔬 REVIEW · DATA INCOMPLETE ({stats.reviewDataGap.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            {/* PATCH 1101pp — copy is scope-aware (USA needs different columns). */}
            {scope === 'USA' ? (
              <>Very low score but no red flags — likely missing data in the TradingView export
              (P/E, EV/EBITDA, FCF margin, Piotroski F-score, ROIC). Re-export from TradingView with
              the &quot;Recommended extra columns&quot; listed on the USA Multibagger tab.</>
            ) : (
              <>Very low score but no red flags — likely missing data in the CSV (debtor days, working
              capital, interest coverage). Don&apos;t auto-avoid; verify the row in Screener and re-upload
              with the missing columns. METRICS_TO_ADD.md lists what to include.</>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {stats.reviewDataGap.slice(0, 8).map((s) => (
              <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 9px', borderRadius: 4,
                  border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-state-persistent) 3%, transparent)', textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TickerCompanyCell ticker={s.symbol} company={s.company} />
                  <span style={{ fontSize: 11, color: 'var(--mc-state-persistent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}{s.grade}</span>
                </div>
                <span style={{ fontSize: 9.5, color: '#C4B5FD', fontStyle: 'italic', lineHeight: 1.35 }}>
                  Why review: 0 flags but score &lt; 30 — check Screener export for missing metrics{s.sector ? ` · ${s.sector}` : ''}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── 💎 VALUATION GATEWAY (PATCH 0588) ─────────────────────────────
          A-grade names that ALSO clear a valuation discipline: PEG <2,
          plus PB/ROE bonus when PB<1.5 + ROE>15%. Separates "expensive
          A-grade" (NMDC at 90, MAYURUNIQ at 30 P/E both score A) from
          "cheap A-grade you can actually buy". Pulled in directly from
          the existing row fields — no new data required. */}
      {stats.valuationGate && stats.valuationGate.length > 0 && (
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-cyan) 25%, transparent)', background: 'linear-gradient(180deg, color-mix(in srgb, var(--mc-cyan) 6%, transparent) 0%, transparent 100%)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 800, letterSpacing: '0.4px' }}>
              💎 VALUATION GATEWAY ({stats.valuationGate.length})
            </div>
            <span style={{ fontSize: 10, color: 'var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>
              A-GRADE + CHEAP
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.5 }}>
            A-grade names that <strong>also clear the valuation gate</strong> (PEG &lt; 2 + optional
            PB/ROE bonus). Separates expensive quality from buyable quality. PEG &lt;1 = 15pts,
            &lt;1.5 = 10pts, &lt;2 = 5pts; PB&lt;1.5 with ROE&gt;15% adds 5pts. Minimum 10 to qualify.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 6 }}>
            {stats.valuationGate.map((s: any) => (
              <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent((s.symbol || '').replace(/\.(NS|BO)$/i, ''))}`}
                title={`Valuation score ${s.valuationScore}/20 — ${s.valuationNotes || 'PEG / PB / ROE composite'}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 10px', borderRadius: 4,
                  border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', background: 'color-mix(in srgb, var(--mc-cyan) 6%, transparent)', textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TickerCompanyCell ticker={s.symbol} company={s.company} />
                  <span style={{ fontSize: 10, color: 'var(--mc-cyan)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{s.score}{s.grade}</span>
                  <span style={{ fontSize: 9, color: 'var(--mc-cyan)', fontWeight: 800, padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' }}>
                    V {s.valuationScore}
                  </span>
                </div>
                <span style={{ fontSize: 9.5, color: '#67E8F9', fontStyle: 'italic', lineHeight: 1.35 }}>
                  {s.valuationNotes || '—'}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── 🎯 TRIPLE-CONFIRMED (PATCH 0554) ─────────────────────────────────
          Scored A+/A  ∩  Conviction Beats bench  ∩  decision = BUY / WATCH.
          The intersection of three independent signals.  Highest-conviction
          names — show them first because they're the actionable shortlist. */}
      {stats.tripleConfirmed.length > 0 && (
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-warn) 44%, transparent)', background: 'linear-gradient(180deg, color-mix(in srgb, var(--mc-warn) 6%, transparent) 0%, transparent 100%)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ fontSize: 13, color: 'var(--mc-warn)', fontWeight: 800, letterSpacing: '0.4px' }}>
              🎯 TRIPLE-CONFIRMED ({stats.tripleConfirmed.length})
            </div>
            <span style={{ fontSize: 10, color: 'var(--mc-warn)', background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>HIGHEST CONVICTION</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 10, lineHeight: 1.5 }}>
            Score <span style={{ color: 'var(--mc-bullish)', fontWeight: 700 }}>A+/A</span>  ∩  on{' '}
            <span style={{ color: 'var(--mc-warn)', fontWeight: 700 }}>Conviction Beats</span>  ∩  decision ={' '}
            <span style={{ color: 'var(--mc-cyan)', fontWeight: 700 }}>BUY/WATCH</span>. Independent confirmation from three layers.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 6 }}>
            {stats.tripleConfirmed.slice(0, 18).map((s) => {
              const dec = (s as any)._decision as { status: DecisionStatus; reason: string } | undefined;
              const decColor = dec?.status === 'BUY' ? '#10B981' : '#22D3EE';
              return (
                <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                  title={dec?.reason ? `Logbook reason: ${dec.reason}` : ''}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 4,
                    border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', background: 'color-mix(in srgb, var(--mc-warn) 6%, transparent)', textDecoration: 'none' }}>
                  <TickerCompanyCell ticker={s.symbol} company={s.company} />
                  <span style={{ fontSize: 10, color: 'var(--mc-warn)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}{s.grade}</span>
                  <span style={{ fontSize: 9, color: decColor, fontWeight: 800, padding: '1px 5px', borderRadius: 3, border: `1px solid ${decColor}50` }}>{dec?.status}</span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 🎯 DECISION BRIDGE (PATCH 0554) ─────────────────────────────────
          Three side-by-side panels that answer: "what should I do NEXT
          given the disagreement between my scorer, my bench, and my
          logbook?". Each panel is a one-click drill-in. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 12 }}>
        {/* ADD CANDIDATES — A+ but NOT on CB */}
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' }}>
          <div style={{ fontSize: 13, color: 'var(--mc-bullish)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            ➕ ADD TO BENCH ({stats.decisionBridge.addCandidates.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            Score A+/A but not yet on Conviction Beats. Open the row in Earnings Opportunities to add.
          </div>
          {stats.decisionBridge.addCandidates.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>All A-grade names already on the bench.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {stats.decisionBridge.addCandidates.map((s) => (
                <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 9px', borderRadius: 4,
                    border: '1px solid color-mix(in srgb, var(--mc-bullish) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-bullish) 3%, transparent)', textDecoration: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TickerCompanyCell ticker={s.symbol} company={s.company} />
                    <span style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}{s.grade}</span>
                    <span style={{ fontSize: 9, color: 'var(--mc-text-3)', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sector || '—'}</span>
                  </div>
                  <span style={{ fontSize: 9.5, color: 'color-mix(in srgb, var(--mc-bullish) 80%, transparent)', fontStyle: 'italic', lineHeight: 1.35 }}>
                    Why: {reasonFor(s, 'ADD')}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* DROP ALERTS — on CB but score deteriorated */}
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)' }}>
          <div style={{ fontSize: 13, color: 'var(--mc-bearish)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            ⚠ TRIM ALERTS ({stats.decisionBridge.dropAlerts.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            On Conviction Beats but score has dropped ≥5 or grade fell to B or below. Review for trim.
          </div>
          {stats.decisionBridge.dropAlerts.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>Bench is clean — no deterioration flagged.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {stats.decisionBridge.dropAlerts.map((s) => {
                const delta = typeof s.prevScore === 'number' ? s.score - (s.prevScore as number) : null;
                return (
                  <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                    style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 9px', borderRadius: 4,
                      border: '1px solid color-mix(in srgb, var(--mc-bearish) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-bearish) 3%, transparent)', textDecoration: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <TickerCompanyCell ticker={s.symbol} company={s.company} />
                      <span style={{ fontSize: 11, color: 'var(--mc-bearish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}{s.grade}</span>
                      {delta !== null && delta < 0 && (
                        <span style={{ fontSize: 10, color: 'var(--mc-bearish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>▼{delta}</span>
                      )}
                    </div>
                    <span style={{ fontSize: 9.5, color: '#FCA5A5', fontStyle: 'italic', lineHeight: 1.35 }}>
                      Why trim: {reasonFor(s, 'TRIM')}
                    </span>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* PATCH 0927 — RE-EVALUATE block: only render when ≥1 row.
            Block re-appears the moment any REJECTED ticker re-grades to A+/A. */}
        {stats.decisionBridge.reEvaluate.length > 0 && (
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)' }}>
          <div style={{ fontSize: 13, color: 'var(--mc-state-persistent)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            🔄 RE-EVALUATE ({stats.decisionBridge.reEvaluate.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            You earlier marked these REJECTED, but the scorer now grades them A+/A. Was the rejection too early?
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {stats.decisionBridge.reEvaluate.map((s) => {
                const dec = (s as any)._decision as { reason: string; date: string } | undefined;
                return (
                  <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                    title={dec ? `Reason: ${dec.reason || '—'}\nDate: ${(dec.date || '').slice(0, 10)}` : ''}
                    style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 9px', borderRadius: 4,
                      border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-state-persistent) 3%, transparent)', textDecoration: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <TickerCompanyCell ticker={s.symbol} company={s.company} />
                      <span style={{ fontSize: 11, color: 'var(--mc-state-persistent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}{s.grade}</span>
                    </div>
                  <span style={{ fontSize: 9.5, color: '#C4B5FD', fontStyle: 'italic', lineHeight: 1.35 }}>
                    Why revisit: {reasonFor(s as any, 'REEVAL')}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
        )}
      </div>

      {/* ── 🔍 QUALITY AUDIT (PATCH 0554) ────────────────────────────────────
          "How clean is my A+ universe?" — the PAYS-post-mortem question.
          One side per market (India structural / cyclical; USA forensic). */}
      {stats.qualityAudit.aTotal > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 4 }}>
            🔍 QUALITY AUDIT — A-roster ({stats.qualityAudit.aTotal})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            Don't trust the A+ label until you know what's flagged inside it. Audit the latent risk.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 12 }}>
            {/* India structural / cyclical */}
            {stats.qualityAudit.indiaTotal > 0 && (
              <div style={{ border: '1px solid var(--mc-bg-4)', borderRadius: 4, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 800, marginBottom: 6 }}>🇮🇳 INDIA ({stats.qualityAudit.indiaTotal})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)', color: 'var(--mc-bullish)', fontWeight: 700 }}>
                    ✓ CLEAN {stats.qualityAudit.indCleanCount}
                  </span>
                  {stats.qualityAudit.indCriticalCount > 0 && (
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)', color: 'var(--mc-bearish)', fontWeight: 700 }}>
                      🛑 CRITICAL {stats.qualityAudit.indCriticalCount}
                    </span>
                  )}
                  {stats.qualityAudit.indStructuralCount > 0 && (
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', color: 'var(--mc-warn)', fontWeight: 700 }}>
                      ⚠ HIGH STRUCTURAL {stats.qualityAudit.indStructuralCount}
                    </span>
                  )}
                  {stats.qualityAudit.indCyclicalCount > 0 && (
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)', color: 'var(--mc-cyan)', fontWeight: 700 }}>
                      ◐ CYCLICAL {stats.qualityAudit.indCyclicalCount}
                    </span>
                  )}
                </div>
                {stats.qualityAudit.indFlaggedRoster.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {stats.qualityAudit.indFlaggedRoster.map((s) => (
                      <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 3,
                          border: '1px solid color-mix(in srgb, var(--mc-warn) 15%, transparent)', background: 'color-mix(in srgb, var(--mc-warn) 3%, transparent)', textDecoration: 'none' }}>
                        <TickerCompanyCell ticker={s.symbol} company={s.company} />
                        {(s.redFlagSummary?.critical ?? 0) > 0 && (
                          <span style={{ fontSize: 9, color: 'var(--mc-bearish)', fontWeight: 700 }}>🛑{s.redFlagSummary?.critical}</span>
                        )}
                        {(s.redFlagSummary?.structural ?? 0) > 0 && (
                          <span style={{ fontSize: 9, color: 'var(--mc-warn)', fontWeight: 700 }}>⚠{s.redFlagSummary?.structural}</span>
                        )}
                        {(s.redFlagSummary?.cyclical ?? 0) > 0 && (
                          <span style={{ fontSize: 9, color: 'var(--mc-cyan)', fontWeight: 700 }}>◐{s.redFlagSummary?.cyclical}</span>
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* USA forensic flags */}
            {stats.qualityAudit.usaTotal > 0 && (
              <div style={{ border: '1px solid var(--mc-bg-4)', borderRadius: 4, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, color: 'var(--mc-cyan)', fontWeight: 800, marginBottom: 6 }}>🇺🇸 USA ({stats.qualityAudit.usaTotal})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)', color: 'var(--mc-bullish)', fontWeight: 700 }}>
                    ✓ CLEAN {stats.qualityAudit.usaCleanCount}
                  </span>
                  {stats.qualityAudit.usaFcfDivCount > 0 && (
                    <span title="FCF margin > 2× Op-Income margin: working-capital / SBC noise inflating FCF" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)', color: 'var(--mc-bearish)', fontWeight: 700 }}>
                      🚨 FCF SUSPECT {stats.qualityAudit.usaFcfDivCount}
                    </span>
                  )}
                  {stats.qualityAudit.usaPostRunCount > 0 && (
                    <span title="Up >100% in 1y AND FwdPE >25 — priced for perfection (PAYS pattern)" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', color: 'var(--mc-warn)', fontWeight: 700 }}>
                      🌡 STRETCHED {stats.qualityAudit.usaPostRunCount}
                    </span>
                  )}
                  {stats.qualityAudit.usaEarnSoonCount > 0 && (
                    <span title="Reports within 7 days — wait for the print" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)', color: 'var(--mc-state-persistent)', fontWeight: 700 }}>
                      ⚠ EARNINGS &lt;7d {stats.qualityAudit.usaEarnSoonCount}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {stats.qualityAudit.usaFcfDivList.map((s) => (
                    <a key={`fcf-${s.symbol}`} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 3,
                        border: '1px solid color-mix(in srgb, var(--mc-bearish) 15%, transparent)', background: 'color-mix(in srgb, var(--mc-bearish) 3%, transparent)', textDecoration: 'none' }}>
                      <TickerCompanyCell ticker={s.symbol} company={s.company} />
                      <span style={{ fontSize: 9, color: 'var(--mc-bearish)', fontWeight: 700 }}>🚨 FCF</span>
                    </a>
                  ))}
                  {stats.qualityAudit.usaPostRunList.map((s) => (
                    <a key={`pr-${s.symbol}`} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 3,
                        border: '1px solid color-mix(in srgb, var(--mc-warn) 15%, transparent)', background: 'color-mix(in srgb, var(--mc-warn) 3%, transparent)', textDecoration: 'none' }}>
                      <TickerCompanyCell ticker={s.symbol} company={s.company} />
                      <span style={{ fontSize: 9, color: 'var(--mc-warn)', fontWeight: 700 }}>🌡 STR</span>
                    </a>
                  ))}
                  {stats.qualityAudit.usaEarnSoonList.map((s) => (
                    <a key={`er-${s.symbol}`} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 3,
                        border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 15%, transparent)', background: 'color-mix(in srgb, var(--mc-state-persistent) 3%, transparent)', textDecoration: 'none' }}>
                      <TickerCompanyCell ticker={s.symbol} company={s.company} />
                      <span style={{ fontSize: 9, color: 'var(--mc-state-persistent)', fontWeight: 700 }}>⚠ {s.earningsProximityDays}d</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Decision-coverage strip */}
          {stats.decisionBridge.aTotal > 0 && (
            <div style={{ marginTop: 10, padding: '6px 8px', borderTop: '1px solid var(--mc-bg-4)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              <span style={{ color: 'var(--mc-text-4)', fontWeight: 700 }}>DECISION COVERAGE</span>
              <span style={{ color: 'var(--mc-cyan)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {stats.decisionBridge.aDecisionCount}/{stats.decisionBridge.aTotal}
              </span>
              <span style={{ color: 'var(--mc-text-3)' }}>
                A-roster names have a Decision Logbook entry —{' '}
                <span style={{ color: stats.decisionBridge.aTotal - stats.decisionBridge.aDecisionCount > 0 ? 'var(--mc-warn)' : 'var(--mc-bullish)', fontWeight: 700 }}>
                  {stats.decisionBridge.aTotal - stats.decisionBridge.aDecisionCount} still untagged
                </span>.
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── 🏭 OPERATING LEVERAGE CLUSTER (PATCH 0578) ───────────────────────
          §17.4(C) ranking-framework upgrade. 2×2 cluster + weighted Cluster
          Score formula derives a 0-100 conviction number per India row:
            0.30·Utilization-Evidence (ROCE, sales accel, OPM trend)
          + 0.25·Margin-Inflection (EBITDA/Sales growth ratio, OPM)
          + 0.20·BS-Repair (D/E, ICR, FCF)
          + 0.15·Demand-Durability (sector prior + 3yr CAGR)
          + 0.10·Value-Added-Mix (GPM, ROIC)
          minus downgrade triggers (OPM compress / debt rising / capex peaking).
          User-seeded core lights up with a ⭐.
          PATCH 1101ii — The cluster formula uses India-specific fields (ROCE,
          cfoToPat, capex trend, debt creep history) that the USA scorer
          doesn't compute. When the user is on USA scope, this widget was
          showing leftover Indian rows. Now hidden unless scope === 'INDIA'. */}
      {scope === 'INDIA' && stats.clusterRanked && stats.clusterRanked.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 800, letterSpacing: '0.4px' }}>
              🏭 OPERATING LEVERAGE CLUSTER ({stats.clusterHighConv.length} high-conviction · {stats.clusterEmerging.length} emerging)
            </div>
            <span style={{ fontSize: 10, color: 'var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>§17.4(C)</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.5 }}>
            Cluster Score = 0.30·Utilization + 0.25·Margin-Inflection + 0.20·BS-Repair + 0.15·Demand-Durability + 0.10·Value-Added-Mix.
            ⭐ marks user-curated cluster seeds (SHYAMMETL, AJAXENGG, NELCAST, GOPAL, JNKINDIA, TRITURBINE).
            Downgrades penalize capex peaks, debt creep, margin compression.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 8 }}>
            {stats.clusterRanked.slice(0, 18).map((c) => {
              const meta = CLUSTER_TIER_META[c.cluster.tier];
              return (
                <a key={c.symbol} href={`/stock-sheet?ticker=${encodeURIComponent((c.symbol || '').replace(/\.(NS|BO)$/i, ''))}`}
                  title={[
                    `Cluster Score: ${c.cluster.score}/100  (${meta.label})`,
                    `Factors: util ${c.cluster.factors.utilizationEvidence}/10 · margin ${c.cluster.factors.marginInflection}/10 · BS ${c.cluster.factors.bsRepair}/10 · demand ${c.cluster.factors.demandDurability}/10 · VA ${c.cluster.factors.valueAddedMix}/10`,
                    c.cluster.notes.length ? `Notes: ${c.cluster.notes.join(' | ')}` : '',
                    c.cluster.downgrades.length ? `Downgrades: ${c.cluster.downgrades.join(' | ')}` : '',
                  ].filter(Boolean).join('\n')}
                  style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 10px', borderRadius: 4,
                    border: `1px solid ${meta.color}40`, background: `${meta.color}10`, textDecoration: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TickerCompanyCell ticker={c.isSeed ? `⭐ ${c.symbol}` : c.symbol} company={c.company} />
                    <span style={{ fontSize: 13, fontWeight: 800, color: meta.color, fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right' }}>{c.cluster.score}</span>
                    <span style={{ fontSize: 9, fontWeight: 800, color: meta.color, padding: '1px 5px', borderRadius: 3, background: `${meta.color}22`, letterSpacing: '0.3px' }}>{meta.emoji} {meta.label}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--mc-text-3)' }}>
                    <span title="Utilization Evidence">UTIL {c.cluster.factors.utilizationEvidence}</span>
                    <span style={{ color: 'var(--mc-bg-4)' }}>·</span>
                    <span title="Margin Inflection">MARG {c.cluster.factors.marginInflection}</span>
                    <span style={{ color: 'var(--mc-bg-4)' }}>·</span>
                    <span title="Balance-Sheet Repair">BS {c.cluster.factors.bsRepair}</span>
                    <span style={{ color: 'var(--mc-bg-4)' }}>·</span>
                    <span title="Demand Durability">DEM {c.cluster.factors.demandDurability}</span>
                    <span style={{ color: 'var(--mc-bg-4)' }}>·</span>
                    <span title="Value-Added Mix">VA {c.cluster.factors.valueAddedMix}</span>
                    <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{c.score}{c.grade}</span>
                  </div>
                  {c.cluster.downgrades.length > 0 && (
                    <div style={{ fontSize: 9, color: 'var(--mc-warn)', fontStyle: 'italic' }}>
                      ⚠ {c.cluster.downgrades.join(' · ')}
                    </div>
                  )}
                </a>
              );
            })}
          </div>
          {stats.clusterRanked.length > 18 && (
            <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 6, fontStyle: 'italic' }}>
              Showing top 18 of {stats.clusterRanked.length} ranked. Lower tiers (WATCH / SKIP) hidden.
            </div>
          )}
          {/* PATCH 0586 — DATA INCOMPLETE block. User reported all rows
              showing UTIL 4 / MARG 0 — root cause was that rows lacking
              key fundamentals were silently scored at 0. Now those rows
              are clearly labeled and surfaced as a separate strip so the
              analyst knows to add the missing columns to their Screener
              export rather than thinking the company is poor quality. */}
          {stats.clusterIncomplete && stats.clusterIncomplete.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px dashed var(--mc-bg-4)' }}>
              <div style={{ fontSize: 11, color: 'var(--mc-state-persistent)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 6 }}>
                ❓ DATA INCOMPLETE ({stats.clusterIncomplete.length})
              </div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 8 }}>
                Cluster formula needs at least 2 of: ROCE · OPM (TTM/Annual) · sales growth · D/E.
                Add the missing columns to the Screener export and re-upload to score these.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {stats.clusterIncomplete.slice(0, 18).map((c) => (
                  <a key={c.symbol} href={`/stock-sheet?ticker=${encodeURIComponent((c.symbol || '').replace(/\.(NS|BO)$/i, ''))}`}
                    style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-state-persistent)',
                      border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 19%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-state-persistent) 3%, transparent)',
                      padding: '3px 8px', borderRadius: 4, textDecoration: 'none' }}>
                    {c.isSeed && '⭐ '}{c.company || c.symbol}
                  </a>
                ))}
                {stats.clusterIncomplete.length > 18 && (
                  <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontStyle: 'italic' }}>+ {stats.clusterIncomplete.length - 18} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 💰 CASH-RICH · NET-ZERO DEBT (PATCH 0578.5) ─────────────────────
          User-requested "next hunting process" lens. Surfaces names with
          cash ≥ 20% of market cap AND effectively no debt (D/E < 0.10
          or net cash by ND/EBITDA / netDebtUsd). Pure balance-sheet
          filter — composite score / grade are shown but don't gate. */}
      {stats.cashRich && stats.cashRich.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--mc-bullish)', fontWeight: 800, letterSpacing: '0.4px' }}>
              💰 CASH RICH · NET-ZERO DEBT ({stats.cashRich.length})
            </div>
            <span style={{ fontSize: 10, color: 'var(--mc-bullish)', background: 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>NEXT-HUNT LENS</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.5 }}>
            Cash ≥ 20% of market cap <strong>AND</strong> effectively zero debt (D/E &lt; 0.10 or net-cash by ND/EBITDA).
            These names have optionality — they can buyback, acquire, or weather a downturn without dilution.
            Composite score is informational only; the lens is pure balance-sheet quality.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {stats.cashRich.slice(0, 24).map((r) => (
              <a key={r.market + ':' + r.symbol} href={`/stock-sheet?ticker=${encodeURIComponent((r.symbol || '').replace(/\.(NS|BO)$/i, ''))}`}
                title={`${r.cashAbsLabel} cash · ${r.cashToMcapPct}% of market cap · ${r.debtIndicator}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 10px', borderRadius: 4,
                  border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', background: 'color-mix(in srgb, var(--mc-bullish) 6%, transparent)', textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TickerCompanyCell ticker={r.symbol} company={r.company} />
                  <span style={{ fontSize: 9, color: r.market === 'INDIA' ? 'var(--mc-bullish)' : 'var(--mc-cyan)', fontWeight: 800 }}>{r.market === 'INDIA' ? '🇮🇳' : '🇺🇸'}</span>
                  <span style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{r.score}{r.grade}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--mc-text-3)' }}>
                  <span style={{ color: 'var(--mc-bullish)', fontWeight: 700 }}>{r.cashAbsLabel}</span>
                  <span style={{ color: 'var(--mc-bg-4)' }}>·</span>
                  <span>{r.cashToMcapPct}% of mcap</span>
                  <span style={{ color: 'var(--mc-bg-4)' }}>·</span>
                  <span style={{ color: 'var(--mc-bullish)', fontStyle: 'italic' }}>{r.debtIndicator}</span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--mc-text-4)' }}>{r.sector || '—'}</div>
              </a>
            ))}
          </div>
          {stats.cashRich.length > 24 && (
            <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 6, fontStyle: 'italic' }}>
              Showing top 24 of {stats.cashRich.length} qualifying. Sort: highest cash/mcap ratio first.
            </div>
          )}
        </div>
      )}

      {/* ── SCORE HISTOGRAM (PATCH 0548) ────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
          📊 SCORE HISTOGRAM
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10 }}>
          Shape of your universe — bimodal? Top-heavy? Long tail?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(() => {
            const maxCount = Math.max(1, ...stats.histogram.map((b) => b.count));
            return stats.histogram.map((b) => {
              const pct = stats.total > 0 ? Math.round((b.count / stats.total) * 100) : 0;
              const widthPct = Math.round((b.count / maxCount) * 100);
              const tone = b.min >= 80 ? '#10B981' : b.min >= 70 ? '#22D3EE' : b.min >= 60 ? '#3B82F6'
                : b.min >= 50 ? '#F59E0B' : b.min >= 40 ? '#94A3B8' : '#EF4444';
              return (
                <div key={b.bin} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--mc-text-4)', fontWeight: 700, minWidth: 50, fontVariantNumeric: 'tabular-nums' }}>{b.bin}</span>
                  <span style={{ fontSize: 11, color: 'var(--mc-text-3)', minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{b.count}</span>
                  <div style={{ flex: 1, height: 8, background: 'var(--mc-bg-4)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${widthPct}%`, height: '100%', background: tone }} />
                  </div>
                  <span style={{ fontSize: 11, color: tone, fontWeight: 700, minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* ── CAP-SIZE BREAKDOWN (PATCH 0548, India only) ─────────────────── */}
      {stats.hasCapData && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            🏛 CAP-SIZE BREAKDOWN (India)
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10 }}>
            Balance your portfolio concentration across size buckets.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {stats.capBuckets.map((b) => {
              const tone = b.avgScore >= 70 ? '#10B981' : b.avgScore >= 55 ? '#22D3EE' : b.avgScore >= 40 ? '#F59E0B' : '#94A3B8';
              return (
                <div key={b.label} style={{ padding: '8px 10px', border: '1px solid var(--mc-bg-4)', borderRadius: 4 }}>
                  <div style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, marginBottom: 4 }}>{b.label}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--mc-text-1)', fontVariantNumeric: 'tabular-nums' }}>{b.count}</span>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>stocks</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: tone, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>avg {b.avgScore}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {!stats.hasCapData && scope !== 'USA' && (
        <div style={{ fontSize: 10, color: 'var(--mc-text-4)', fontStyle: 'italic', padding: '0 4px' }}>
          (Cap-size breakdown skipped — no market-cap data in current upload.)
        </div>
      )}

      {/* ── HIDDEN GEMS (PATCH 0548) ────────────────────────────────────── */}
      {stats.hiddenGems.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: 'var(--mc-state-persistent)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            💎 HIDDEN GEMS ({stats.hiddenGems.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.5 }}>
            Score ≥ 70, not yet on Conviction Beats, in sectors with avg &lt; 60 —
            <span style={{ color: 'var(--mc-text-2)' }}> they passed your quality bar but the rest of their sector hasn't moved. Alpha window.</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6 }}>
            {stats.hiddenGems.map((s) => (
              <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 4,
                  border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)', background: 'color-mix(in srgb, var(--mc-state-persistent) 6%, transparent)', textDecoration: 'none' }}>
                <TickerCompanyCell ticker={s.symbol} company={s.company} />
                <span style={{ fontSize: 10, color: 'var(--mc-state-persistent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}</span>
                <span style={{ fontSize: 9, color: 'var(--mc-text-3)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sector || '—'}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── 🇺🇸 USA RULE OF 40 + CAP TIER (PATCH 1101ll) ─────────────────────
          USA-specific widget that surfaces the metrics that actually matter
          for US multibagger hunting: Rule of 40 buckets, cap-tier breakdown,
          and the top R40 names. The India side has its own composite (Q50,
          ROCE etc.) — different mental model. Hidden when scope === INDIA. */}
      {scope === 'USA' && (() => {
        // PATCH 1101mm — stocks uses `market` (not `_market`); ruleOf40 is now
        // carried through the USA mapping so we read it directly.
        const usaRows = (stocks as any[]).filter((r: any) => r.market === 'USA');
        const r40s = usaRows
          .map(r => ({ s: r, v: (r.ruleOf40 ?? (typeof r.revenueGrowthAnn === 'number' && typeof r.fcfMarginAnn === 'number' ? r.revenueGrowthAnn + r.fcfMarginAnn : undefined)) }))
          .filter(x => typeof x.v === 'number') as { s: any; v: number }[];
        if (r40s.length === 0) return null;
        const buckets = [
          { label: '🏆 Elite ≥80', test: (v: number) => v >= 80, color: '#10B981' },
          { label: 'Strong 60-80', test: (v: number) => v >= 60 && v < 80, color: '#22D3EE' },
          { label: 'Passes 40-60', test: (v: number) => v >= 40 && v < 60, color: '#3B82F6' },
          { label: 'Weak 20-40',   test: (v: number) => v >= 20 && v < 40, color: '#F59E0B' },
          { label: 'Below 0-20',   test: (v: number) => v >= 0 && v < 20, color: '#FB923C' },
          { label: 'Burning <0',   test: (v: number) => v < 0,            color: '#EF4444' },
        ].map(b => ({ ...b, count: r40s.filter(x => b.test(x.v)).length, names: r40s.filter(x => b.test(x.v)).slice(0, 5).map(x => x.s.symbol) }));
        const top10R40 = [...r40s].sort((a, b) => b.v - a.v).slice(0, 20);
        const tiers = ['MICRO', 'SMALL', 'MID', 'LARGE', 'MEGA'] as const;
        // PATCH 1101pp — Use MEDIAN instead of MEAN for R40. Outliers like
        // HGRAF (-11438) wreck mean averages — SMALL was showing -553 even
        // when 9 of 30 stocks are elite (R40 ≥ 60). Median ignores tails.
        const median = (arr: number[]) => {
          if (!arr.length) return 0;
          const s = [...arr].sort((a, b) => a - b);
          const m = Math.floor(s.length / 2);
          return s.length % 2 === 0 ? Math.round((s[m - 1] + s[m]) / 2) : Math.round(s[m]);
        };
        const byTier = tiers.map(t => {
          const subset = usaRows.filter((r: any) => r.capTier === t);
          if (subset.length === 0) return null;
          const r40sub = subset.map((r: any) => r.ruleOf40 ?? 0);
          const medR40 = median(r40sub);
          const elite = subset.filter((r: any) => (r.ruleOf40 ?? 0) >= 60).length;
          const passing = subset.filter((r: any) => (r.ruleOf40 ?? 0) >= 40).length;
          return { tier: t, count: subset.length, avgR40: medR40, elite, passing };
        }).filter(Boolean) as { tier: string; count: number; avgR40: number; elite: number; passing: number }[];
        return (
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 13, color: '#22D3EE', fontWeight: 800, letterSpacing: '0.4px' }}>
                🇺🇸 RULE OF 40 · USA SIGNATURE METRIC
              </div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>
                R40 = revenue growth + FCF margin · institutional benchmark for SaaS-era compounders.
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6, marginBottom: 12 }}>
              {buckets.map(b => (
                <div key={b.label} style={{ padding: '8px 10px', background: `${b.color}10`, border: `1px solid ${b.color}40`, borderRadius: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontSize: 11, color: b.color, fontWeight: 800 }}>{b.label}</span>
                    <span style={{ fontSize: 14, color: b.color, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{b.count}</span>
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--mc-text-3)', marginTop: 3, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.names.length > 0 ? b.names.join(' · ') : '—'}
                  </div>
                </div>
              ))}
            </div>
            {byTier.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.3px' }}>
                  Cap-Tier Breakdown · median R40 (outlier-resistant) + R40 ≥ 40 (passes) and ≥ 60 (elite)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6, marginBottom: 12 }}>
                  {byTier.map(t => (
                    <div key={t.tier} style={{ padding: '6px 10px', background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 5 }}>
                      <div style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px' }}>{t.tier}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
                        <span style={{ fontSize: 13, color: 'var(--mc-text-1)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{t.count}</span>
                        <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>names</span>
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#22D3EE', fontWeight: 700 }}>R40 med {t.avgR40}</span>
                      </div>
                      <div style={{ fontSize: 9, color: '#10B981', fontWeight: 700, marginTop: 1 }}>{t.elite} elite · {t.passing} pass</div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.3px' }}>
              Top 20 by Rule of 40
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 4 }}>
              {top10R40.map((x, i) => (
                <a key={x.s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(x.s.symbol)}&market=us`}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 4,
                    background: x.v >= 80 ? '#10B98114' : x.v >= 60 ? '#22D3EE14' : 'transparent',
                    border: `1px solid ${x.v >= 80 ? '#10B98140' : x.v >= 60 ? '#22D3EE40' : 'var(--mc-bg-4)'}`,
                    textDecoration: 'none' }}>
                  <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 800, minWidth: 18 }}>#{i + 1}</span>
                  <TickerCompanyCell ticker={x.s.symbol} company={x.s.company} />
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: x.v >= 80 ? '#10B981' : x.v >= 60 ? '#22D3EE' : 'var(--mc-text-2)', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{Math.round(x.v)}</span>
                </a>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── 💎 USA QUALITY LEADERS (PATCH 1101mm) ────────────────────────────
          Top ROIC + ROE + Piotroski names. The "true compounder DNA" check —
          can the business consistently turn capital into returns above cost?
          Surfaces the actual highest-quality franchises across cap tiers. */}
      {scope === 'USA' && (() => {
        const usaRows = (stocks as any[]).filter((r: any) => r.market === 'USA');
        const withRoic = usaRows.filter((r: any) => typeof r.roic === 'number').sort((a: any, b: any) => (b.roic ?? 0) - (a.roic ?? 0)).slice(0, 8);
        const withPiotroski = usaRows.filter((r: any) => typeof r.piotroskiFScore === 'number' && r.piotroskiFScore >= 7).sort((a: any, b: any) => (b.piotroskiFScore ?? 0) - (a.piotroskiFScore ?? 0)).slice(0, 8);
        const cashBurners = usaRows.filter((r: any) => typeof r.fcfMarginAnn === 'number' && r.fcfMarginAnn < -10).sort((a: any, b: any) => (a.fcfMarginAnn ?? 0) - (b.fcfMarginAnn ?? 0)).slice(0, 8);
        if (withRoic.length === 0 && withPiotroski.length === 0 && cashBurners.length === 0) return null;
        const sec = (color: string, title: string, sub: string, rows: any[], valueFn: (r: any) => string, valueColor: string) => (
          rows.length === 0 ? null : (
            <div style={{ padding: '8px 10px', background: `${color}10`, border: `1px solid ${color}40`, borderRadius: 5 }}>
              <div style={{ fontSize: 11, color, fontWeight: 800, letterSpacing: '0.3px' }}>{title}</div>
              <div style={{ fontSize: 9, color: 'var(--mc-text-4)', marginBottom: 6 }}>{sub}</div>
              {rows.map((r: any) => (
                <a key={r.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(r.symbol)}&market=us`}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', textDecoration: 'none' }}>
                  <span style={{ fontSize: 11, color: 'var(--mc-text-2)', fontWeight: 700, minWidth: 50 }}>{r.symbol}</span>
                  <span style={{ fontSize: 10, color: 'var(--mc-text-4)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</span>
                  <span style={{ fontSize: 11, color: valueColor, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{valueFn(r)}</span>
                </a>
              ))}
            </div>
          )
        );
        return (
          <div style={cardStyle}>
            <div style={{ fontSize: 13, color: '#22D3EE', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 8 }}>
              💎 USA QUALITY LEADERS
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 }}>
              {sec('#10B981', '🏆 ROIC Leaders', 'Returns on invested capital — Buffett tier', withRoic, (r) => `${r.roic?.toFixed(0)}%`, '#10B981')}
              {sec('#3B82F6', '🛡 Piotroski ≥ 7/9', 'Earnings-quality score, accruals + leverage check', withPiotroski, (r) => `${r.piotroskiFScore}/9`, '#3B82F6')}
              {sec('#EF4444', '🛑 Cash Burners (FCF < -10%)', 'Negative FCF margin — needs growth or capital raise', cashBurners, (r) => `${r.fcfMarginAnn?.toFixed(0)}%`, '#EF4444')}
            </div>
          </div>
        );
      })()}

      {/* ── 🇺🇸 USA SECTOR-R40 HEATMAP (PATCH 1101mm) ────────────────────────
          Average R40 per sector — finds which sectors are firing on growth +
          cash flow simultaneously. Sectors with avg R40 ≥ 40 are the hunting
          ground; sectors with avg < 0 are deathtraps. */}
      {scope === 'USA' && (() => {
        const usaRows = (stocks as any[]).filter((r: any) => r.market === 'USA' && typeof r.ruleOf40 === 'number');
        if (usaRows.length === 0) return null;
        // PATCH 1101pp — Sector heatmap also switched to median R40. Mean
        // was producing "Producer manufacturing R40 -878" because of a handful
        // of crypto-miner / SPAC outliers in that bucket.
        const sectorMapM = new Map<string, { r40s: number[]; scores: number[]; elite: number; passing: number }>();
        for (const r of usaRows) {
          const sec = r.sector || 'Unclassified';
          const cur = sectorMapM.get(sec) ?? { r40s: [], scores: [], elite: 0, passing: 0 };
          cur.r40s.push(r.ruleOf40 ?? 0);
          cur.scores.push(r.score ?? 0);
          if ((r.ruleOf40 ?? 0) >= 60) cur.elite++;
          if ((r.ruleOf40 ?? 0) >= 40) cur.passing++;
          sectorMapM.set(sec, cur);
        }
        const medianN = (a: number[]) => {
          if (!a.length) return 0;
          const s = [...a].sort((x, y) => x - y);
          const m = Math.floor(s.length / 2);
          return s.length % 2 === 0 ? Math.round((s[m - 1] + s[m]) / 2) : Math.round(s[m]);
        };
        const ranked = Array.from(sectorMapM.entries())
          .filter(([_, v]) => v.r40s.length >= 2)
          .map(([sec, v]) => ({ sec, count: v.r40s.length, avgR40: medianN(v.r40s), avgScore: medianN(v.scores), elite: v.elite, passing: v.passing }))
          .sort((a, b) => b.avgR40 - a.avgR40);
        if (ranked.length === 0) return null;
        return (
          <div style={cardStyle}>
            <div style={{ fontSize: 13, color: '#22D3EE', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 4 }}>
              🇺🇸 SECTOR R40 HEATMAP
            </div>
            <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginBottom: 8 }}>
              Sectors ranked by <strong>median</strong> Rule of 40 (outlier-resistant) · ≥ 40 = institutional hunting ground · &lt; 0 = capital-destroyers
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {ranked.map(r => {
                const color = r.avgR40 >= 60 ? '#10B981' : r.avgR40 >= 40 ? '#22D3EE' : r.avgR40 >= 20 ? '#F59E0B' : r.avgR40 >= 0 ? '#FB923C' : '#EF4444';
                const widthPct = Math.max(2, Math.min(100, (r.avgR40 + 50) / 1.5));
                return (
                  <div key={r.sec} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 80px 60px 110px', gap: 8, alignItems: 'center', fontSize: 11 }}>
                    <span style={{ color: 'var(--mc-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sec}</span>
                    <div style={{ position: 'relative', height: 12, background: 'var(--mc-bg-2)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${widthPct}%`, background: color }} />
                    </div>
                    <span style={{ color, fontWeight: 800, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>med {r.avgR40}</span>
                    <span style={{ color: 'var(--mc-text-4)', textAlign: 'right' }}>{r.count} cos</span>
                    <span style={{ color: '#10B981', fontWeight: 700, textAlign: 'right' }}>{r.elite}/{r.passing} elite/pass</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── GRADE DISTRIBUTION ──────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 10 }}>
          🎯 GRADE DISTRIBUTION
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(['A+', 'A', 'B+', 'B', 'C', 'D'] as const).map((g) => {
            const count = stats.grades[g] || 0;
            const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
            const tone = g === 'A+' ? '#10B981' : g === 'A' ? '#22D3EE'
              : g === 'B+' ? '#3B82F6' : g === 'B' ? '#F59E0B'
              : g === 'C' ? '#94A3B8' : '#EF4444';
            return (
              <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: tone, minWidth: 30 }}>{g}</span>
                <span style={{ fontSize: 11, color: 'var(--mc-text-4)', minWidth: 35, textAlign: 'right' }}>{count}</span>
                <div style={{ flex: 1, height: 10, background: 'var(--mc-bg-4)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: tone }} />
                </div>
                <span style={{ fontSize: 11, color: tone, fontWeight: 700, minWidth: 40, textAlign: 'right' }}>{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── SECTOR EXPOSURE ─────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
          🧭 SECTOR EXPOSURE
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10 }}>
          Which sectors dominate your roster and what's the average score per bucket.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {stats.sectorRanked.slice(0, 15).map((s) => {
            const max = stats.sectorRanked[0]?.count || 1;
            const pct = Math.round((s.count / max) * 100);
            const tone = s.avgScore >= 78 ? '#10B981' : s.avgScore >= 60 ? '#22D3EE'
              : s.avgScore >= 45 ? '#F59E0B' : '#94A3B8';
            return (
              <div key={s.sector} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--mc-text-1)', fontWeight: 600, minWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sector}</span>
                <span style={{ fontSize: 10, color: 'var(--mc-text-4)', minWidth: 28, textAlign: 'right' }}>{s.count}</span>
                <div style={{ flex: 1, height: 8, background: 'var(--mc-bg-4)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: tone }} />
                </div>
                <span style={{ fontSize: 11, color: tone, fontWeight: 700, minWidth: 70, textAlign: 'right' }}>avg {s.avgScore}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── TOP 25 BY SCORE (PATCH 0548 — expanded + Δ columns) ─────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 10 }}>
          🏆 TOP 25 BY SCORE
        </div>
        {/* PATCH 0573 — COMPANY column added between TICKER and SECTOR so
            unfamiliar symbols (especially BSE: scrip codes) are readable
            at a glance. Truncates with ellipsis on narrow viewports;
            tooltip shows the full company name on hover. */}
        <div style={{ border: '1px solid var(--mc-bg-4)', borderRadius: 4, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              {/* PATCH 0585 — COMPANY first, TICKER second per user feedback.
                  Company name is the primary identity; ticker is the small
                  accessory for power-users. Score column kept right. */}
              <tr style={{ backgroundColor: 'var(--mc-bg-0)' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>RANK</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>COMPANY</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>TICKER</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>SECTOR</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>PREV</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>SCORE</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>Δ</th>
                <th style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>GRADE</th>
                {/* PATCH 0991 — Screener-count column */}
                <th title="Number of uploaded Screener.in CSVs this stock appeared in" style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>📂</th>
                <th style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>MKT</th>
              </tr>
            </thead>
            <tbody>
              {stats.topPicks.map((s, i) => {
                const inCb = convictionSet.has(s.symbol.toUpperCase().replace(/\.(NS|BO)$/i, ''));
                const hasPrev = typeof s.prevScore === 'number';
                const delta = hasPrev ? s.score - (s.prevScore as number) : null;
                const deltaColor = delta === null ? '#94A3B8' : delta > 0 ? '#10B981' : delta < 0 ? '#EF4444' : '#94A3B8';
                const deltaSym = delta === null ? 'NEW' : delta > 0 ? `▲+${delta}` : delta < 0 ? `▼${delta}` : '•0';
                return (
                  <tr key={s.symbol + i} style={{ borderTop: '1px solid var(--mc-bg-4)' }}>
                    <td style={{ padding: '6px 10px', color: 'var(--mc-text-4)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                    <td title={s.company || s.symbol} style={{ padding: '6px 10px', color: 'var(--mc-text-1)', fontSize: 12, fontWeight: 700, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <a href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`} style={{ color: 'var(--mc-text-1)', textDecoration: 'none' }}>
                        {s.company || s.symbol}
                      </a>
                      {inCb && <span title="In Conviction Beats" style={{ marginLeft: 5, fontSize: 10, color: 'var(--mc-warn)' }}>🏆</span>}
                    </td>
                    <td style={{ padding: '6px 10px', color: 'var(--mc-text-3)', fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 600 }}>{s.symbol}</td>
                    <td style={{ padding: '6px 10px', color: 'var(--mc-text-3)', fontSize: 11 }}>{s.sector || '—'}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--mc-text-4)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{hasPrev ? s.prevScore : '—'}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--mc-bullish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', color: deltaColor, fontWeight: 700, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{deltaSym}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'center', color: s.grade === 'A+' ? 'var(--mc-bullish)' : 'var(--mc-cyan)', fontWeight: 700 }}>{s.grade}</td>
                    {/* PATCH 0991 — Screener-count cell */}
                    <td title={Array.isArray((s as any)._screeners) ? (s as any)._screeners.join(', ') : ''} style={{ padding: '6px 10px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: ((s as any)._screeners?.length ?? 0) >= 2 ? 'var(--mc-cyan)' : 'var(--mc-text-4)', fontVariantNumeric: 'tabular-nums' }}>
                      {((s as any)._screeners?.length ?? 0) >= 1 ? (s as any)._screeners.length : '—'}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'center', color: s.market === 'INDIA' ? 'var(--mc-bullish)' : 'var(--mc-cyan)', fontSize: 10, fontWeight: 700 }}>{s.market === 'INDIA' ? '🇮🇳' : '🇺🇸'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── CONVICTION BEATS OVERLAP ────────────────────────────────────── */}
      {stats.convictionOverlap.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: 'var(--mc-warn)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            🏆 CONVICTION BEATS OVERLAP ({stats.convictionOverlap.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10 }}>
            Stocks from your Multibagger upload that also sit on the Conviction Beats bench — strongest decision-ready candidates.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {stats.convictionOverlap.slice(0, 30).map((s) => (
              <a
                key={s.symbol}
                href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                title={s.company || ''}
                style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--mc-warn)',
                  border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 6%, transparent)',
                  padding: '3px 8px', borderRadius: 4, textDecoration: 'none',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  display: 'inline-flex', flexDirection: 'column', gap: 1,
                }}
              >
                <span>{s.symbol} <span style={{ color: 'var(--mc-text-3)', fontWeight: 500 }}>· {s.score} {s.grade}</span></span>
                {s.company && (
                  <span style={{ fontSize: 9, color: 'var(--mc-text-2)', fontWeight: 500, fontFamily: 'system-ui, sans-serif', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.company}</span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0370 — TURNAROUND COMPARE TAB
//
// Specialised view for distressed-to-recovery setups. Different from
// regular Multibagger because:
//   - 7-dimension scoring (earnings inflection / op reset / balance sheet
//     repair / concall narrative / industry tailwind / governance / valuation)
//   - Stage classifier: DISTRESS → EARLY-SHOOTS → PATTERN → CONFIRMED → MATURE
//   - BUY-ZONE filter highlights Early-Shoots + Pattern stages (the alpha
//     window before consensus arrives)
//   - Concall paste-text per row contributes to scoring (15 of 100 pts)
// ═══════════════════════════════════════════════════════════════════════════

const TURNAROUND_STORAGE_KEY = 'mb_turnaround_scored_v1';
const TURNAROUND_CONCALLS_KEY = 'mb_turnaround_concalls_v1';

function TurnaroundCompare() {
  const [rows, setRows] = useState<TurnaroundResult[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem(TURNAROUND_STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      // Re-score on load so any code changes apply
      return parsed.map((r: any) => scoreTurnaroundRow(r)).sort((a, b) => b.totalScore - a.totalScore);
    } catch { return []; }
  });
  const [fileName, setFileName] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [expRow, setExpRow] = useState<string | null>(null);
  // PATCH 0386 — Expand All toggle (matches Multibagger India/USA tabs)
  const [expandAll, setExpandAll] = useState(false);
  const [stageFilter, setStageFilter] = useState<TurnaroundStage | 'BUY-ZONE' | 'ALL'>('ALL');
  // PATCH 0374 — Archetype filter so user can hide growth/quality/value-trap rows
  const [archetypeFilter, setArchetypeFilter] = useState<TurnaroundArchetype | 'ALL'>('ALL');
  const [showOnlyHighConcall, setShowOnlyHighConcall] = useState(false);
  const [showLossRecovery, setShowLossRecovery] = useState(false);
  // PATCH 0381 — "Best candidates only" filter — institutional buy-zone shortlist
  const [showBestOnly, setShowBestOnly] = useState(false);
  // PATCH 0381 — turnaround Type and Phase filters
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CYCLICAL' | 'OPERATIONAL' | 'DISTRESSED'>('ALL');
  const [phaseFilter, setPhaseFilter] = useState<'ALL' | 1 | 2 | 3 | 4>('ALL');
  // Concall map: ticker -> pasted text
  const [concallMap, setConcallMap] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(TURNAROUND_CONCALLS_KEY) || '{}'); } catch { return {}; }
  });

  // Persist concall map and trigger re-score when concall changes for a symbol
  const updateConcall = useCallback((symbol: string, text: string) => {
    setConcallMap(prev => {
      const next = { ...prev, [symbol]: text };
      try { localStorage.setItem(TURNAROUND_CONCALLS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    // Re-score this row
    setRows(prev => prev.map(r => {
      if (r.symbol !== symbol) return r;
      return scoreTurnaroundRow({ ...r, concallText: text });
    }).sort((a, b) => b.totalScore - a.totalScore));
  }, []);

  // PATCH 0374 / 0375 — Multi-CSV upload. Accepts MULTIPLE files in one
  // picker, processes them all, then merges into existing rows via
  // functional setState (avoids stale closure on rows).
  // User typically has several Screener screens (e.g. 'Loss recovery
  // candidates', 'Sector turnaround', 'Microcap turnaround') and wants to
  // pool them into one analysis.
  const handleFiles = async (files: File[]) => {
    setParseError(null);
    if (files.length === 0) return;
    const allNewScored: TurnaroundResult[] = [];
    const fileNames: string[] = [];
    const failed: string[] = [];
    for (const file of files) {
      try {
        const text = await file.text();
        const parsed = parseCsvFlexible(text);
        if (parsed.length === 0) { failed.push(`${file.name}: empty`); continue; }
        const tRows = parsed
          .map(r => parseTurnaroundRow(r))
          .filter((r): r is NonNullable<typeof r> => r != null)
          .map(r => ({ ...r, concallText: concallMap[r.symbol] || '' }));
        if (tRows.length === 0) { failed.push(`${file.name}: no valid tickers`); continue; }
        for (const r of tRows) allNewScored.push(scoreTurnaroundRow(r));
        fileNames.push(file.name);
      } catch (e: any) {
        failed.push(`${file.name}: ${e?.message || 'parse failed'}`);
      }
    }
    if (allNewScored.length === 0) {
      setParseError(`No valid rows in ${files.length} file(s)${failed.length ? ': ' + failed.join('; ') : ''}`);
      return;
    }
    // Merge with existing rows — functional setState so we don't capture
    // a stale rows snapshot when multiple files come through one batch.
    setRows(prev => {
      const merged = new Map<string, TurnaroundResult>();
      for (const r of prev) merged.set(r.symbol, r);
      for (const r of allNewScored) merged.set(r.symbol, r);
      const finalRows = Array.from(merged.values()).sort((a, b) => b.totalScore - a.totalScore);
      try { localStorage.setItem(TURNAROUND_STORAGE_KEY, JSON.stringify(finalRows)); } catch {}
      return finalRows;
    });
    setFileName(prev => {
      const joined = fileNames.join(', ');
      return prev ? `${prev}, ${joined}` : joined;
    });
    if (failed.length > 0) {
      setParseError(`Loaded ${allNewScored.length} rows from ${fileNames.length} file(s). ${failed.length} file(s) failed: ${failed.join('; ')}`);
    }
  };

  // Filter chain
  const filtered = useMemo(() => {
    let out = rows;
    if (stageFilter === 'BUY-ZONE') {
      out = out.filter(r => r.inBuyZone);
    } else if (stageFilter !== 'ALL') {
      out = out.filter(r => r.stage === stageFilter);
    }
    // PATCH 0374 — archetype filter
    if (archetypeFilter !== 'ALL') {
      out = out.filter(r => r.archetype === archetypeFilter);
    }
    if (showOnlyHighConcall) {
      out = out.filter(r => r.concallScore >= 12);  // 0381: threshold tracks new /25 max
    }
    if (showLossRecovery) {
      out = out.filter(r =>
        (r.lossMakingYears5y ?? 0) >= 1 &&
        r.patQ1 != null && r.patQ1 > 0
      );
    }
    // PATCH 0381 — institutional filters
    if (showBestOnly) {
      out = out.filter(r => r.isBestCandidate);
    }
    if (typeFilter !== 'ALL') {
      out = out.filter(r => r.turnaroundType === typeFilter);
    }
    if (phaseFilter !== 'ALL') {
      out = out.filter(r => r.phase === phaseFilter);
    }
    return out;
  }, [rows, stageFilter, archetypeFilter, showOnlyHighConcall, showLossRecovery, showBestOnly, typeFilter, phaseFilter]);

  // Stage + archetype counts
  const stageCounts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length, 'BUY-ZONE': 0, DISTRESS: 0, SETUP: 0, 'EARLY-SHOOTS': 0, PATTERN: 0, CONFIRMED: 0, MATURE: 0, 'NOT-TURNAROUND': 0 };
    for (const r of rows) {
      c[r.stage]++;
      if (r.inBuyZone) c['BUY-ZONE']++;
    }
    return c;
  }, [rows]);

  // PATCH 0374 — Archetype counts for the new filter rail
  const archetypeCounts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length, TURNAROUND: 0, GROWTH: 0, QUALITY: 0, 'VALUE-TRAP': 0, DECLINING: 0, WAIT: 0, NEUTRAL: 0 };
    for (const r of rows) c[r.archetype]++;
    return c;
  }, [rows]);

  // Company-name map for Screener export
  const tickerCompanyMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of filtered) {
      if (r.symbol && r.company) m[r.symbol.toUpperCase()] = r.company;
    }
    return m;
  }, [filtered]);

  return (
    <div style={{ padding: '20px 24px 60px', maxWidth: 1800, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: F.h2, fontWeight: 800, color: 'var(--mc-cyan)', margin: 0, marginBottom: 5 }}>
          🔄 Turnaround Research Engine
        </h2>
        <p style={{ fontSize: F.sm, color: MUTED, margin: 0, lineHeight: 1.5 }}>
          Earnings power restoration scoring · 7 dimensions · Stage classifier · Concall narrative weighted heavily.
          Upload Screener.in CSV with quarterly P&L columns. Paste concall narrative per row to unlock the full 15-point Concall dimension.
        </p>
      </div>

      {/* PATCH 0374 — Upload + Add Another CSV (multi-file pool) */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', backgroundColor: rows.length === 0 ? 'var(--mc-cyan)' : 'var(--mc-state-persistent)', color: 'var(--mc-bg-0)', borderRadius: 8, fontWeight: 800, fontSize: F.sm, cursor: 'pointer' }}>
          📁 {rows.length === 0 ? 'Upload Screener.in CSV(s) — multi-select OK' : `+ Add more CSVs (pool with ${rows.length} existing) — multi-select OK`}
          {/* PATCH 0375 — multiple attr lets user pick several CSVs at once.
              All files in the selection get parsed + merged in a single batch. */}
          <input
            type="file"
            accept=".csv"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length > 0) {
                handleFiles(files);
                e.target.value = '';
              }
            }}
            style={{ display: 'none' }}
          />
        </label>
        {fileName && <span style={{ fontSize: F.xs, color: MUTED }}>{fileName} · {rows.length} unique rows</span>}
        {parseError && <span style={{ fontSize: F.xs, color: RED, fontWeight: 700 }}>⚠ {parseError}</span>}
        {rows.length > 0 && (
          <button
            onClick={() => { if (window.confirm(`Clear all ${rows.length} turnaround rows?`)) { setRows([]); localStorage.removeItem(TURNAROUND_STORAGE_KEY); setFileName(''); } }}
            style={{ marginLeft: 'auto', padding: '6px 14px', backgroundColor: `${RED}14`, border: `1px solid ${RED}40`, borderRadius: 6, color: RED, fontSize: F.xs, fontWeight: 700, cursor: 'pointer' }}>
            🗑 Clear All
          </button>
        )}
      </div>

      {rows.length === 0 && (
        <div style={{ padding: 24, border: '1px dashed var(--mc-bg-4)', borderRadius: 10, color: MUTED, fontSize: F.sm, lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--mc-cyan)' }}>How to use:</strong>
          <ol style={{ marginTop: 8, paddingLeft: 22 }}>
            <li>Build a Screener.in custom screen (e.g. "PAT growth &gt; 50%" or "Loss making years &gt; 0 AND latest qtr PAT &gt; 0")</li>
            <li>Export columns to CSV — see <strong style={{ color: 'var(--mc-warn)' }}>📚 Required Fields</strong> below</li>
            <li>Upload here — every row gets scored across 7 dimensions and classified into a stage</li>
            <li>BUY-ZONE = Early-Shoots + Pattern stages. These are the alpha entries before consensus arrives.</li>
            <li>Expand any row to paste concall narrative (unlocks 15-pt Concall dimension)</li>
          </ol>
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--mc-warn)', fontWeight: 700 }}>📚 Screener.in column names (use these exact strings in 'Edit Columns')</summary>
            <div style={{ marginTop: 10, fontSize: F.xs, lineHeight: 1.6 }}>
              <p><strong style={{ color: 'var(--mc-bullish)' }}>✅ AVAILABLE in Screener — add these (engine-critical):</strong></p>
              <ul style={{ margin: '4px 0 8px 18px', padding: 0 }}>
                <li><strong>Quarterly trail:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>Sales Qtr Rs.Cr. · Sales Prev Qtr Rs.Cr. · Sales 2Qtr Bk Rs.Cr. · Sales 3Qtr Bk Rs.Cr.</code></li>
                <li><strong>PAT trail:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>PAT Qtr Rs.Cr. · PAT Prev Qtr Rs.Cr. · NP 2Qtr Bk Rs.Cr. · NP 3Qtr Bk Rs.Cr.</code></li>
                <li><strong>YoY signals:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>Qtr Profit Var % · Qtr Sales Var % · Profit Var 3Yrs % · Sales Var 3Yrs %</code></li>
                <li><strong>Operating:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>OPM % · OPM Qtr % · ROCE % · ROCE 3Yr % · ROIC % · CFO/PAT</code></li>
                <li><strong>Balance sheet:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>Debt Rs.Cr. · Debt / Eq · Int Coverage · WC Days · WC Days 3yrs</code></li>
                <li><strong>Governance:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>Prom. Hold. % · Chg in Prom Hold 3Yr % · Pledged % · FII Hold % · DII Hold %</code></li>
                <li><strong>Valuation:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>P/E · PEG · EV / EBITDA · From 52w high · Ind PE · CMP / BV</code></li>
                <li><strong>Returns:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>1Yr return %</code></li>
                <li><strong>Annual:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>Sales Rs.Cr. · Mar Cap Rs.Cr. · EPS 12M Rs. · Free Cash Flow Rs.Cr. · Sales growth % · Profit growth %</code></li>
              </ul>

              <p style={{ marginTop: 10 }}><strong style={{ color: 'var(--mc-warn)' }}>⚠️ NOT in Screener (engine scores 0 for these dimensions — that's OK):</strong></p>
              <ul style={{ margin: '4px 0 8px 18px', padding: 0, color: MUTED }}>
                <li><code style={{ fontSize: 10 }}>OPM Prev Qtr / OPM 2Qtr Bk / OPM 3Qtr Bk</code> — Screener only exposes current quarter OPM. Sequential OPM trend signal (3 pts) will be 0.</li>
                <li><code style={{ fontSize: 10 }}>EPS Prev Qtr / EPS 2Qtr Bk / EPS 3Qtr Bk</code> — same, EPS trail not available.</li>
                <li><code style={{ fontSize: 10 }}>Loss making years</code> — Screener may have this; check 'Edit Columns' search. If not, add manually for distressed candidates.</li>
                <li><code style={{ fontSize: 10 }}>PE 5Yrs Median</code> — Screener has this internally but may not export. Falls back to absolute-PE buckets.</li>
                <li><code style={{ fontSize: 10 }}>Debt 3yrs back / Interest Coverage 3yrs back</code> — debt-reduction trajectory degrades. Can still score from current values.</li>
                <li><code style={{ fontSize: 10 }}>Sales/PAT 5Yr back annual values</code> — annual 5y trail not in Screener export.</li>
                <li><code style={{ fontSize: 10 }}>Auditor changes</code> — not exposed by Screener; manual flag only.</li>
              </ul>

              <p style={{ marginTop: 10 }}><strong style={{ color: 'var(--mc-cyan)' }}>Smart aliases:</strong> the parser already maps your real column names — just upload the CSV as-is from Screener and the engine will recognise everything.</p>
            </div>
          </details>
        </div>
      )}

      {rows.length > 0 && (
        <>
          {/* PATCH 0376 — "Not turnarounds" hint banner. Surfaces when user
              uploaded a screen that's mostly quality/growth compounders. */}
          {(() => {
            const nonTurnaroundCount = (archetypeCounts['GROWTH'] || 0) + (archetypeCounts['QUALITY'] || 0) + (archetypeCounts['NEUTRAL'] || 0);
            const turnaroundCount = (archetypeCounts['TURNAROUND'] || 0) + (archetypeCounts['WAIT'] || 0) + (archetypeCounts['VALUE-TRAP'] || 0) + (archetypeCounts['DECLINING'] || 0);
            if (rows.length >= 5 && nonTurnaroundCount / rows.length >= 0.5) {
              return (
                <div style={{ marginBottom: 14, padding: '10px 14px', backgroundColor: 'color-mix(in srgb, var(--mc-cyan) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 4 }}>💡 Heads-up — most of your uploaded rows aren&apos;t turnarounds</div>
                  <div style={{ fontSize: 11, color: 'var(--mc-text-2)', lineHeight: 1.5 }}>
                    {nonTurnaroundCount} of {rows.length} rows are quality/growth compounders or neutral — not turnaround setups. Only <strong style={{ color: 'var(--mc-warn)' }}>{turnaroundCount}</strong> rows match the turnaround pattern (TURNAROUND / WAIT / VALUE-TRAP / DECLINING).
                    <br />
                    <strong>What to do:</strong> Click <code style={{ background: 'var(--mc-bg-0)', padding: '1px 5px', borderRadius: 3, color: 'var(--mc-warn)' }}>🔄 Turnaround</code> in the ARCHETYPE filter above to see only real turnaround candidates. The quality/growth ones belong on the <strong>🇮🇳 India Multibagger</strong> tab.
                  </div>
                </div>
              );
            }
            return null;
          })()}

          {/* Summary strip — PATCH 0378: clickable filters. Total clears all
              filters; archetype cells set archetypeFilter; stage cells set
              stageFilter. Active cell ring shows current selection. */}
          <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
            {([
              { label: 'Total', value: rows.length, color: '#94A3B8', kind: 'reset' as const },
              { label: 'BUY-ZONE', value: stageCounts['BUY-ZONE'], color: '#10B981', kind: 'stage' as const, target: 'BUY-ZONE' as const },
              { label: '🔄 Turnarounds', value: archetypeCounts['TURNAROUND'] || 0, color: '#F59E0B', kind: 'archetype' as const, target: 'TURNAROUND' as const },
              { label: '🔥 SETUP', value: stageCounts.SETUP || 0, color: '#A78BFA', kind: 'stage' as const, target: 'SETUP' as const },
              { label: '🌱 EARLY-SHOOTS', value: stageCounts['EARLY-SHOOTS'], color: '#F59E0B', kind: 'stage' as const, target: 'EARLY-SHOOTS' as const },
              { label: '📈 PATTERN', value: stageCounts.PATTERN, color: '#22D3EE', kind: 'stage' as const, target: 'PATTERN' as const },
              { label: '✅ CONFIRMED', value: stageCounts.CONFIRMED, color: '#10B981', kind: 'stage' as const, target: 'CONFIRMED' as const },
              { label: 'Not-Turnaround', value: stageCounts['NOT-TURNAROUND'] || 0, color: '#94A3B8', kind: 'stage' as const, target: 'NOT-TURNAROUND' as const },
              { label: '🚫 DISTRESS', value: stageCounts.DISTRESS, color: '#EF4444', kind: 'stage' as const, target: 'DISTRESS' as const },
            ]).map(s => {
              const isActive =
                (s.kind === 'reset' && stageFilter === 'ALL' && archetypeFilter === 'ALL') ||
                (s.kind === 'stage' && stageFilter === (s as any).target) ||
                (s.kind === 'archetype' && archetypeFilter === (s as any).target);
              const onClick = () => {
                if (s.kind === 'reset') {
                  setStageFilter('ALL');
                  setArchetypeFilter('ALL');
                } else if (s.kind === 'stage') {
                  setStageFilter(isActive ? 'ALL' : (s as any).target);
                  setArchetypeFilter('ALL');
                } else if (s.kind === 'archetype') {
                  setArchetypeFilter(isActive ? 'ALL' : (s as any).target);
                  setStageFilter('ALL');
                }
              };
              return (
                <button
                  key={s.label}
                  onClick={onClick}
                  title={s.kind === 'reset' ? 'Clear all filters' : `Filter to ${s.label}`}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: isActive ? `${s.color}22` : '#13131a',
                    border: `2px solid ${isActive ? s.color : s.color + '40'}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: 9, color: isActive ? s.color : MUTED, fontWeight: 700, letterSpacing: '0.4px' }}>{s.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: s.color }}>{s.value}</div>
                </button>
              );
            })}
          </div>

          {/* PATCH 0374 — Archetype filter rail (TOP — most useful for user
              who mostly uploads turnarounds but wants to spot mis-categorised
              rows like growth stocks, quality compounders, value traps). */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: F.xs, color: MUTED, fontWeight: 700, marginRight: 4 }}>ARCHETYPE:</span>
            {([
              { id: 'ALL',         label: 'All',           color: '#94A3B8' },
              { id: 'TURNAROUND',  label: '🔄 Turnaround', color: '#F59E0B' },
              { id: 'GROWTH',      label: '🚀 Growth',     color: '#10B981' },
              { id: 'QUALITY',     label: '💎 Quality',    color: '#22D3EE' },
              { id: 'WAIT',        label: '⏸ Wait',        color: '#94A3B8' },
              { id: 'VALUE-TRAP',  label: '🧊 Value trap', color: '#EF4444' },
              { id: 'DECLINING',   label: '📉 Declining',  color: '#EF4444' },
              { id: 'NEUTRAL',     label: '❓ Neutral',    color: '#6B7A8D' },
            ] as const).map(a => {
              const active = archetypeFilter === a.id;
              return (
                <button key={a.id} onClick={() => setArchetypeFilter(a.id)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${active ? a.color : BORDER}`, background: active ? `${a.color}20` : 'transparent', color: active ? a.color : MUTED, cursor: 'pointer' }}>
                  {a.label} · {archetypeCounts[a.id] ?? 0}
                </button>
              );
            })}
          </div>

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: F.xs, color: MUTED, fontWeight: 700, marginRight: 4 }}>STAGE:</span>
            {(['ALL', 'BUY-ZONE', 'EARLY-SHOOTS', 'PATTERN', 'CONFIRMED', 'MATURE', 'SETUP', 'DISTRESS'] as const).map(s => {
              const active = stageFilter === s;
              const color = s === 'BUY-ZONE' ? '#10B981' : s === 'EARLY-SHOOTS' ? '#F59E0B' : s === 'PATTERN' ? '#22D3EE' : s === 'CONFIRMED' ? '#10B981' : s === 'SETUP' ? '#A78BFA' : s === 'MATURE' ? '#94A3B8' : s === 'DISTRESS' ? '#EF4444' : '#94A3B8';
              return (
                <button key={s} onClick={() => setStageFilter(s)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${active ? color : BORDER}`, background: active ? `${color}20` : 'transparent', color: active ? color : MUTED, cursor: 'pointer' }}>
                  {s} {stageCounts[s] !== undefined && `· ${stageCounts[s]}`}
                </button>
              );
            })}
            <span style={{ width: 1, height: 18, background: BORDER, margin: '0 6px' }} />
            <button onClick={() => setShowOnlyHighConcall(v => !v)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${showOnlyHighConcall ? 'var(--mc-state-persistent)' : BORDER}`, background: showOnlyHighConcall ? 'color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)' : 'transparent', color: showOnlyHighConcall ? 'var(--mc-state-persistent)' : MUTED, cursor: 'pointer' }}>
              🎙 High Concall {showOnlyHighConcall ? '✓' : ''}
            </button>
            <button onClick={() => setShowLossRecovery(v => !v)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${showLossRecovery ? 'var(--mc-warn)' : BORDER}`, background: showLossRecovery ? 'color-mix(in srgb, var(--mc-warn) 13%, transparent)' : 'transparent', color: showLossRecovery ? 'var(--mc-warn)' : MUTED, cursor: 'pointer' }}>
              💎 Loss→Profit recovery {showLossRecovery ? '✓' : ''}
            </button>
            {/* PATCH 0386 — Expand All / Collapse All toggle */}
            <button onClick={() => { setExpandAll(v => !v); setExpRow(null); }} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${expandAll ? 'var(--mc-cyan)' : BORDER}`, background: expandAll ? 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' : 'transparent', color: expandAll ? 'var(--mc-cyan)' : MUTED, cursor: 'pointer' }}>
              {expandAll ? '▲ Collapse All' : '▼ Expand All'}
            </button>
            <span style={{ marginLeft: 'auto', fontSize: F.xs, color: MUTED }}>{filtered.length} showing</span>
          </div>

          {/* PATCH 0381 — Institutional filter row (Best/Type/Phase per playbook) */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center', padding: '8px 10px', background: 'var(--mc-bg-0)', border: `1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)`, borderRadius: 8 }}>
            <span style={{ fontSize: F.xs, color: 'var(--mc-warn)', fontWeight: 800, letterSpacing: '0.5px', marginRight: 4 }}>★ INSTITUTIONAL:</span>
            <button
              onClick={() => setShowBestOnly(v => !v)}
              title="Best candidates only: TURNAROUND + Phase 3 INFLECTION + Survival ≥ 6/8 + zero killers + score ≥ 50"
              style={{
                fontSize: F.xs, fontWeight: 800, padding: '6px 12px', borderRadius: 6,
                border: `2px solid ${showBestOnly ? 'var(--mc-warn)' : 'color-mix(in srgb, var(--mc-warn) 50%, transparent)'}`,
                background: showBestOnly ? 'color-mix(in srgb, var(--mc-warn) 19%, transparent)' : 'transparent',
                color: showBestOnly ? 'var(--mc-warn)' : 'color-mix(in srgb, var(--mc-warn) 75%, transparent)',
                cursor: 'pointer',
              }}>
              ★ BEST ONLY {showBestOnly ? '✓' : ''} · {rows.filter(r => r.isBestCandidate).length}
            </button>
            <span style={{ width: 1, height: 18, background: BORDER, margin: '0 6px' }} />
            <span style={{ fontSize: F.xs, color: MUTED, fontWeight: 700 }}>TYPE:</span>
            {(['ALL', 'CYCLICAL', 'OPERATIONAL', 'DISTRESSED'] as const).map(t => {
              const active = typeFilter === t;
              const color = t === 'CYCLICAL' ? '#10B981' : t === 'OPERATIONAL' ? '#F59E0B' : t === 'DISTRESSED' ? '#EF4444' : '#94A3B8';
              const count = t === 'ALL' ? rows.length : rows.filter(r => r.turnaroundType === t).length;
              return (
                <button key={t} onClick={() => setTypeFilter(t)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${active ? color : BORDER}`, background: active ? `${color}20` : 'transparent', color: active ? color : MUTED, cursor: 'pointer' }}>
                  {t === 'ALL' ? 'All' : t} · {count}
                </button>
              );
            })}
            <span style={{ width: 1, height: 18, background: BORDER, margin: '0 6px' }} />
            <span style={{ fontSize: F.xs, color: MUTED, fontWeight: 700 }}>PHASE:</span>
            {([
              { id: 'ALL' as const, label: 'All',                    color: '#94A3B8' },
              { id: 1 as const,     label: '1 Collapse',             color: '#EF4444' },
              { id: 2 as const,     label: '2 Stabilisation',        color: '#A78BFA' },
              { id: 3 as const,     label: '3 INFLECTION ★ (BUY)',   color: '#10B981' },
              { id: 4 as const,     label: '4 Re-rating',            color: '#22D3EE' },
            ]).map(p => {
              const active = phaseFilter === p.id;
              const count = p.id === 'ALL' ? rows.length : rows.filter(r => r.phase === p.id).length;
              return (
                <button key={String(p.id)} onClick={() => setPhaseFilter(p.id)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${active ? p.color : BORDER}`, background: active ? `${p.color}20` : 'transparent', color: active ? p.color : MUTED, cursor: 'pointer' }}>
                  {p.label} · {count}
                </button>
              );
            })}
          </div>

          {/* PATCH 0381 — Best Candidates Leaderboard (top 5 institutional picks) */}
          {(() => {
            const best = [...rows].filter(r => r.isBestCandidate).sort((a, b) => b.totalScore - a.totalScore).slice(0, 5);
            if (best.length === 0) return null;
            return (
              <div style={{ marginBottom: 14, padding: 12, background: 'linear-gradient(135deg, color-mix(in srgb, var(--mc-warn) 6%, transparent), color-mix(in srgb, var(--mc-warn) 2%, transparent))', border: '1px solid color-mix(in srgb, var(--mc-warn) 31%, transparent)', borderRadius: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-warn)', letterSpacing: '0.5px' }}>★ BEST RISK/REWARD — INSTITUTIONAL SHORTLIST</div>
                    <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>TURNAROUND archetype · Phase 3 INFLECTION · Survival ≥ 6/8 · Zero killers · Score ≥ 50</div>
                  </div>
                  <button onClick={() => { setShowBestOnly(true); }} style={{ fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 6, border: '1px solid var(--mc-warn)', background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', color: 'var(--mc-warn)', cursor: 'pointer' }}>
                    View all {rows.filter(r => r.isBestCandidate).length} →
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {best.map(b => (
                    <div key={b.symbol} style={{ flex: '1 1 240px', minWidth: 240, padding: 10, background: 'var(--mc-bg-0)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderRadius: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <div style={{ fontSize: 14, fontWeight: 900, color: '#F8FAFC' }}>{b.symbol}</div>
                        <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--mc-warn)' }}>{b.totalScore.toFixed(0)}</div>
                      </div>
                      <div style={{ fontSize: 10, color: MUTED, marginBottom: 6 }}>{b.company}</div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 9 }}>
                        <span style={{ padding: '2px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', color: 'var(--mc-warn)', fontWeight: 700 }}>{b.turnaroundType}</span>
                        <span style={{ padding: '2px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)', color: 'var(--mc-bullish)', fontWeight: 700 }}>Surv {b.survivalScore}/8</span>
                        <span style={{ padding: '2px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)', color: 'var(--mc-cyan)', fontWeight: 700 }}>Max {b.suggestedPositionPct}%</span>
                        {b.concallScore >= 12 && <span style={{ padding: '2px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)', color: 'var(--mc-state-persistent)', fontWeight: 700 }}>🎙 CC {b.concallScore.toFixed(0)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Export toolbar */}
          {filtered.length > 0 && (
            <div style={{ margin: '10px 0' }}>
              <TickerExportToolbar
                tickers={filtered.map(r => r.symbol).filter(Boolean)}
                exchange="NSE"
                filenameHint="turnarounds"
                tickerCompanyMap={tickerCompanyMap}
                compact
              />
            </div>
          )}

          {/* Rows */}
          <div style={{ marginTop: 6 }}>
            {filtered.map((r) => {
              const isExp = expandAll || expRow === r.symbol;
              return (
                <div key={r.symbol} style={{ borderBottom: `1px solid rgba(255,255,255,0.05)`, background: isExp ? '#13131a' : 'transparent' }}>
                  <button onClick={() => setExpRow(isExp ? null : r.symbol)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '12px 14px', color: 'inherit' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 70px 70px 1fr 110px 70px', gap: 10, alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: F.md, fontWeight: 800, color: TEXT }}>{r.symbol}</div>
                        <div style={{ fontSize: 9, color: MUTED }}>{r.exchange}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: F.sm, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</div>
                        <div style={{ fontSize: 9, color: MUTED }}>{r.sector || '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: F.h2, fontWeight: 900, color: 'var(--mc-state-persistent)' }}>{r.totalScore}</div>
                        <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>{r.grade}</div>
                      </div>
                      <div>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 4, background: `${r.stageColor}20`, color: r.stageColor, border: `1px solid ${r.stageColor}40` }}>
                          {r.stageEmoji} {r.stage}
                        </span>
                        {r.inBuyZone && <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--mc-bullish)', marginTop: 3 }}>🎯 BUY-ZONE</div>}
                        {/* PATCH 0374 — Archetype badge */}
                        <div title={r.archetypeNote}
                          style={{ fontSize: 9, fontWeight: 800, color: r.archetypeColor, marginTop: 3, padding: '1px 5px', display: 'inline-block', borderRadius: 3, background: `${r.archetypeColor}15`, border: `1px solid ${r.archetypeColor}40` }}>
                          {r.archetypeLabel}
                        </div>
                        {/* PATCH 0381 — Institutional chips: BEST + Type + Phase + Survival */}
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 4 }}>
                          {r.isBestCandidate && (
                            <span title="Best Risk/Reward candidate: TURNAROUND + Phase 3 + Survival ≥ 6/8 + zero killers" style={{ fontSize: 8, fontWeight: 900, color: 'var(--mc-warn)', padding: '1px 4px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-warn) 15%, transparent)', border: '1px solid var(--mc-warn)' }}>★ BEST</span>
                          )}
                          {r.turnaroundType !== 'UNKNOWN' && (
                            <span title={r.turnaroundTypeNote} style={{
                              fontSize: 8, fontWeight: 800, padding: '1px 4px', borderRadius: 3,
                              color: r.turnaroundType === 'CYCLICAL' ? 'var(--mc-bullish)' : r.turnaroundType === 'OPERATIONAL' ? 'var(--mc-warn)' : 'var(--mc-bearish)',
                              background: r.turnaroundType === 'CYCLICAL' ? 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)' : r.turnaroundType === 'OPERATIONAL' ? 'color-mix(in srgb, var(--mc-warn) 8%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)',
                              border: `1px solid ${r.turnaroundType === 'CYCLICAL' ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : r.turnaroundType === 'OPERATIONAL' ? 'color-mix(in srgb, var(--mc-warn) 25%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)'}`,
                            }}>{r.turnaroundType.slice(0, 4)}</span>
                          )}
                          <span title={`${r.phaseLabel} — ${r.phaseAction}`} style={{
                            fontSize: 8, fontWeight: 800, padding: '1px 4px', borderRadius: 3,
                            color: r.phase === 3 ? 'var(--mc-bullish)' : r.phase === 4 ? 'var(--mc-cyan)' : r.phase === 2 ? 'var(--mc-state-persistent)' : 'var(--mc-bearish)',
                            background: '#13131a',
                            border: `1px solid ${r.phase === 3 ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : r.phase === 4 ? 'color-mix(in srgb, var(--mc-cyan) 25%, transparent)' : r.phase === 2 ? 'color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)'}`,
                          }}>Ph{r.phase}{r.phase === 3 ? '★' : ''}</span>
                          <span title={`Survival ${r.survivalScore}/8 — playbook Ch.4 gate`} style={{
                            fontSize: 8, fontWeight: 800, padding: '1px 4px', borderRadius: 3,
                            color: r.survivalScore >= 7 ? 'var(--mc-bullish)' : r.survivalScore >= 5 ? 'var(--mc-cyan)' : 'var(--mc-bearish)',
                            background: '#13131a',
                            border: `1px solid ${r.survivalScore >= 7 ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : r.survivalScore >= 5 ? 'color-mix(in srgb, var(--mc-cyan) 25%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)'}`,
                          }}>S {r.survivalScore}/8</span>
                          {r.suggestedPositionPct > 0 && (
                            <span title="Max position size suggestion (playbook Ch.6)" style={{ fontSize: 8, fontWeight: 800, padding: '1px 4px', borderRadius: 3, color: 'var(--mc-text-3)', border: '1px solid color-mix(in srgb, var(--mc-text-3) 25%, transparent)' }}>Max {r.suggestedPositionPct}%</span>
                          )}
                          {r.killers.length > 0 && (
                            <span title={`Killers: ${r.killers.join(' · ')}`} style={{ fontSize: 8, fontWeight: 900, padding: '1px 4px', borderRadius: 3, color: 'var(--mc-bearish)', background: 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)', border: '1px solid var(--mc-bearish)' }}>⚠ {r.killers.length} killer{r.killers.length > 1 ? 's' : ''}</span>
                          )}
                        </div>
                      </div>
                      {/* Dimension bars — PATCH 0381: max values rebalanced (E 20, O 10, CC 25) */}
                      <div style={{ display: 'flex', gap: 5 }}>
                        {[
                          { label: 'EARN', val: r.earningsScore, max: 20, color: '#10B981' },
                          { label: 'OPS', val: r.operationalScore, max: 10, color: '#22D3EE' },
                          { label: 'BAL', val: r.balanceSheetScore, max: 15, color: '#A78BFA' },
                          { label: 'CC', val: r.concallScore, max: 25, color: '#F59E0B' },
                          { label: 'IND', val: r.industryScore, max: 10, color: '#34d399' },
                          { label: 'GOV', val: r.governanceScore, max: 10, color: '#fbbf24' },
                          { label: 'VAL', val: r.valuationScore, max: 10, color: '#f97316' },
                        ].map(d => {
                          const pct = (d.val / d.max) * 100;
                          return (
                            <div key={d.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 30 }}>
                              <span style={{ fontSize: 10, fontWeight: 800, color: d.color }}>{Math.round(d.val)}</span>
                              <div style={{ width: 24, height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
                                <div style={{ height: '100%', width: `${pct}%`, backgroundColor: d.color, borderRadius: 2 }} />
                              </div>
                              <span style={{ fontSize: 8, color: MUTED }}>{d.label}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 10, color: MUTED, textAlign: 'center' }}>
                        <div style={{ color: r.pe != null ? TEXT : MUTED }}>PE {r.pe?.toFixed(0) ?? '—'}</div>
                        <div>ROCE {r.roce?.toFixed(0) ?? '—'}</div>
                      </div>
                      <div style={{ fontSize: 10, color: r.coverage >= 70 ? GREEN : r.coverage >= 50 ? 'var(--mc-warn)' : 'var(--mc-bearish)', textAlign: 'center', fontWeight: 700 }}>
                        {r.coverage}%
                      </div>
                    </div>
                  </button>
                  {isExp && (
                    <div style={{ padding: '4px 14px 16px', background: '#13131a' }}>
                      {/* PATCH 0374 — Archetype diagnostic block: tells the user
                          IMMEDIATELY whether this row belongs in the Turnaround
                          tab, and if not, what it actually is. */}
                      <div style={{ marginBottom: 12, padding: '10px 12px', background: `${r.archetypeColor}10`, border: `1px solid ${r.archetypeColor}40`, borderRadius: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: r.archetypeColor, letterSpacing: '0.4px', marginBottom: 3 }}>
                          {r.archetypeLabel} — verdict
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--mc-text-2)', lineHeight: 1.5 }}>{r.archetypeNote}</div>
                      </div>

                      {/* PATCH 0381 — Institutional panel: Type / Phase / Survival / Killers / Position */}
                      <div style={{ marginBottom: 12, padding: '12px', background: 'var(--mc-bg-0)', border: '1px solid color-mix(in srgb, var(--mc-warn) 19%, transparent)', borderRadius: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--mc-warn)', letterSpacing: '0.5px', marginBottom: 8 }}>★ INSTITUTIONAL PLAYBOOK READING</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, fontSize: 11, color: 'var(--mc-text-2)' }}>
                          <div>
                            <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, letterSpacing: '0.4px', marginBottom: 4 }}>TURNAROUND TYPE (Ch.1)</div>
                            <div style={{ fontWeight: 800, color: r.turnaroundType === 'CYCLICAL' ? 'var(--mc-bullish)' : r.turnaroundType === 'OPERATIONAL' ? 'var(--mc-warn)' : r.turnaroundType === 'DISTRESSED' ? 'var(--mc-bearish)' : 'var(--mc-text-3)', marginBottom: 2 }}>{r.turnaroundType}</div>
                            <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.4 }}>{r.turnaroundTypeNote}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, letterSpacing: '0.4px', marginBottom: 4 }}>PHASE (Ch.2)</div>
                            <div style={{ fontWeight: 800, color: r.phase === 3 ? 'var(--mc-bullish)' : r.phase === 4 ? 'var(--mc-cyan)' : r.phase === 2 ? 'var(--mc-state-persistent)' : 'var(--mc-bearish)', marginBottom: 2 }}>{r.phaseLabel}</div>
                            <div style={{ fontSize: 10, color: MUTED }}>Action: <strong style={{ color: 'var(--mc-text-2)' }}>{r.phaseAction}</strong></div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, letterSpacing: '0.4px', marginBottom: 4 }}>SURVIVAL FILTER (Ch.4) — {r.survivalScore}/8</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {r.survivalChecks.map((c, i) => (
                                <div key={i} title={c.note} style={{ fontSize: 10, color: c.pass ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
                                  {c.pass ? '✓' : '✗'} {c.label} <span style={{ color: MUTED }}>({c.note})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, letterSpacing: '0.4px', marginBottom: 4 }}>POSITION SIZE (Ch.6)</div>
                            <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--mc-cyan)' }}>Max {r.suggestedPositionPct}% of portfolio</div>
                            <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>Based on type + survival + killers</div>
                          </div>
                          {r.killers.length > 0 && (
                            <div style={{ gridColumn: '1 / -1' }}>
                              <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--mc-bearish)', letterSpacing: '0.4px', marginBottom: 4 }}>⚠ KILLERS DETECTED (PART VII) — {r.killers.length}</div>
                              {r.killers.map((k, i) => (
                                <div key={i} style={{ fontSize: 11, color: '#FCA5A5', padding: '2px 0' }}>› {k}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* PATCH 0374 — Missing-fields hint when coverage is low */}
                      {r.coverage < 70 && r.missingFields.length > 0 && (
                        <div style={{ marginBottom: 12, padding: '8px 12px', background: 'color-mix(in srgb, var(--mc-warn) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderRadius: 6 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.4px', marginBottom: 4 }}>
                            ⚠ DATA COVERAGE {r.coverage}% — {r.missingFields.length} fields missing
                          </div>
                          <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.5 }}>
                            Not in this CSV: <strong style={{ color: 'var(--mc-text-2)' }}>{r.missingFields.join(' · ')}</strong>
                          </div>
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                        {/* Inflection Signals */}
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--mc-bullish)', fontWeight: 800, letterSpacing: '0.5px', marginBottom: 6 }}>📈 INFLECTION SIGNALS</div>
                          {r.inflectionSignals.length > 0 ? r.inflectionSignals.map((s, i) => (
                            <div key={i} style={{ fontSize: 11, color: 'var(--mc-text-2)', padding: '2px 0' }}>› {s}</div>
                          )) : <div style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>No earnings inflection detected yet</div>}
                        </div>
                        {/* Quarterly trail */}
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--mc-cyan)', fontWeight: 800, letterSpacing: '0.5px', marginBottom: 6 }}>📊 QUARTERLY TRAIL</div>
                          <div style={{ fontSize: 10, color: MUTED, fontFamily: 'ui-monospace, monospace' }}>
                            <div>Sales: {r.salesQ4?.toFixed(0) ?? '—'} → {r.salesQ3?.toFixed(0) ?? '—'} → {r.salesQ2?.toFixed(0) ?? '—'} → <span style={{ color: TEXT }}>{r.salesQ1?.toFixed(0) ?? '—'}</span></div>
                            <div>OPM: {r.opmQ4?.toFixed(0) ?? '—'}% → {r.opmQ3?.toFixed(0) ?? '—'}% → {r.opmQ2?.toFixed(0) ?? '—'}% → <span style={{ color: TEXT }}>{r.opmQ1?.toFixed(0) ?? '—'}%</span></div>
                            <div>PAT: {r.patQ4?.toFixed(0) ?? '—'} → {r.patQ3?.toFixed(0) ?? '—'} → {r.patQ2?.toFixed(0) ?? '—'} → <span style={{ color: (r.patQ1 ?? 0) > 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{r.patQ1?.toFixed(0) ?? '—'}</span></div>
                            <div>EPS: {r.epsQ4?.toFixed(1) ?? '—'} → {r.epsQ3?.toFixed(1) ?? '—'} → {r.epsQ2?.toFixed(1) ?? '—'} → <span style={{ color: TEXT }}>{r.epsQ1?.toFixed(1) ?? '—'}</span></div>
                          </div>
                        </div>
                        {/* Concall paste */}
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--mc-warn)', fontWeight: 800, letterSpacing: '0.5px', marginBottom: 6 }}>🎙 CONCALL NARRATIVE — paste to unlock score</div>
                          <textarea
                            value={concallMap[r.symbol] || ''}
                            onChange={(e) => updateConcall(r.symbol, e.target.value)}
                            placeholder="Paste recent concall transcript / Q&A / management commentary. Engine auto-detects institutional phrases (capacity expansion, margin recovery, deleveraging, demand recovery, etc.) and scores up to 15 points."
                            style={{ width: '100%', minHeight: 90, padding: '6px 9px', backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 4, color: 'var(--mc-text-1)', fontSize: 11, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
                          />
                          <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
                            Concall score: <span style={{ color: r.concallScore >= 8 ? 'var(--mc-bullish)' : r.concallScore >= 4 ? 'var(--mc-warn)' : MUTED, fontWeight: 700 }}>{r.concallScore.toFixed(1)} / 15</span>
                            {r.concallPhrases.length > 0 && <> · phrases: {r.concallPhrases.join(', ')}</>}
                          </div>
                        </div>
                      </div>

                      {/* Strengths + Risks */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--mc-bullish)', fontWeight: 800, marginBottom: 5 }}>✅ STRENGTHS</div>
                          {r.strengths.length > 0 ? r.strengths.map((s, i) => (
                            <div key={i} style={{ fontSize: 11, color: 'var(--mc-text-2)', padding: '2px 0' }}>› {s}</div>
                          )) : <div style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>No notable strengths captured yet</div>}
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--mc-bearish)', fontWeight: 800, marginBottom: 5 }}>⚠️ RISKS</div>
                          {r.risks.length > 0 ? r.risks.map((s, i) => (
                            <div key={i} style={{ fontSize: 11, color: 'var(--mc-text-2)', padding: '2px 0' }}>› {s}</div>
                          )) : <div style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>No specific risks flagged</div>}
                        </div>
                      </div>

                      {/* PATCH 0386 — SIX-FACTOR MASTER CHECKLIST (playbook Ch.5) */}
                      <div style={{ marginTop: 14, padding: 12, background: 'var(--mc-bg-0)', border: `1px solid color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)`, borderRadius: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--mc-state-persistent)', letterSpacing: '0.5px', marginBottom: 8 }}>📋 SIX-FACTOR MASTER CHECKLIST (Ch.5)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, fontSize: 11 }}>
                          {(() => {
                            const factors = [
                              { name: 'F1 Balance Sheet Survival', score: `${r.survivalScore}/8`, pass: r.survivalScore >= 6, note: 'gate condition — see survival panel' },
                              { name: 'F2 Earnings Inflection', score: `${r.earningsScore.toFixed(0)}/20`, pass: r.earningsScore >= 8, note: 'most important for timing' },
                              { name: 'F3 Industry Cycle Turn', score: `${r.industryScore.toFixed(0)}/10`, pass: r.industryScore >= 5, note: 'sector-wide vs company-specific' },
                              { name: 'F4 Management Quality', score: `${r.governanceScore.toFixed(0)}/10`, pass: r.governanceScore >= 5, note: 'check pledge, promoter buying' },
                              { name: 'F5 Liquidity Tailwind', score: `${r.balanceSheetScore.toFixed(0)}/15`, pass: r.balanceSheetScore >= 7, note: 'macro + credit spreads + sector' },
                              { name: 'F6 Concall / Narrative', score: `${r.concallScore.toFixed(0)}/25`, pass: r.concallScore >= 10, note: 'paste-text confirms thesis' },
                            ];
                            return factors.map((f, i) => (
                              <div key={i} style={{ padding: '8px 10px', background: '#13131a', border: `1px solid ${f.pass ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : 'color-mix(in srgb, var(--mc-text-3) 25%, transparent)'}`, borderRadius: 5 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: f.pass ? 'var(--mc-bullish)' : 'var(--mc-text-3)', marginBottom: 2 }}>{f.pass ? '✓' : '○'} {f.name}</div>
                                <div style={{ fontSize: 13, fontWeight: 900, color: f.pass ? 'var(--mc-bullish)' : 'var(--mc-text-2)' }}>{f.score}</div>
                                <div style={{ fontSize: 9, color: MUTED, marginTop: 1, lineHeight: 1.3 }}>{f.note}</div>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>

                      {/* PATCH 0386 — ENTRY / EXIT STAGING (playbook Ch.6) */}
                      <div style={{ marginTop: 14, padding: 12, background: 'var(--mc-bg-0)', border: `1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)`, borderRadius: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--mc-bullish)', letterSpacing: '0.5px', marginBottom: 8 }}>🎯 ENTRY & EXIT STAGING (Ch.6)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 11 }}>
                          {(() => {
                            const max = r.suggestedPositionPct;
                            const cur = r.phase === 3 && r.isBestCandidate ? 'NOW' : r.phase === 2 ? 'NOW' : r.phase === 1 ? 'WAIT' : '—';
                            const stages = [
                              { label: '🪨 STAGE 1 STARTER', pct: (max * 0.225).toFixed(1), trigger: 'Stabilisation confirmed; balance sheet survival clear; rate of deterioration slowing', active: r.phase === 2 && cur === 'NOW' },
                              { label: '🧱 STAGE 2 CONFIRM', pct: (max * 0.325).toFixed(1), trigger: 'First estimate revision up; insider buying confirmed; higher lows on chart', active: r.phase === 3 && !r.isBestCandidate },
                              { label: '🏛️ STAGE 3 FULL', pct: (max * 0.45).toFixed(1), trigger: 'Recovery thesis clearly underway; sequential rev growth; margin expansion visible', active: r.phase === 3 && r.isBestCandidate },
                            ];
                            return stages.map((s, i) => (
                              <div key={i} style={{ padding: '8px 10px', background: s.active ? 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)' : '#13131a', border: `1px solid ${s.active ? 'var(--mc-bullish)' : 'color-mix(in srgb, var(--mc-text-3) 25%, transparent)'}`, borderRadius: 5 }}>
                                <div style={{ fontSize: 10, fontWeight: 800, color: s.active ? 'var(--mc-bullish)' : MUTED, marginBottom: 3 }}>{s.label}{s.active ? ' · ACTIVE' : ''}</div>
                                <div style={{ fontSize: 14, fontWeight: 900, color: s.active ? 'var(--mc-bullish)' : 'var(--mc-text-2)' }}>{s.pct}% of portfolio</div>
                                <div style={{ fontSize: 9, color: MUTED, marginTop: 2, lineHeight: 1.4 }}>{s.trigger}</div>
                              </div>
                            ));
                          })()}
                        </div>
                        <div style={{ marginTop: 10, padding: '8px 10px', background: 'color-mix(in srgb, var(--mc-bearish) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 25%, transparent)', borderRadius: 5 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mc-bearish)', marginBottom: 4 }}>🚪 EXIT TRIGGERS</div>
                          <div style={{ fontSize: 10, color: 'var(--mc-text-2)', lineHeight: 1.5 }}>
                            <strong>TRIM</strong> when stock up 100%+ and valuation approaching normalised fair value · <strong>SELL</strong> if thesis broken, material new negative, management credibility destroyed · <strong>IMMEDIATE EXIT</strong> on covenant breach, surprise maturity, CCC downgrade, accounting restatement, key contract loss
                          </div>
                        </div>
                      </div>

                      {/* PATCH 0386 — ALL METRICS table (matches Multibagger India depth) */}
                      <details style={{ marginTop: 14, padding: 12, background: 'var(--mc-bg-0)', border: `1px solid ${BORDER}`, borderRadius: 6 }}>
                        <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 900, color: 'var(--mc-cyan)', letterSpacing: '0.5px' }}>📐 ALL METRICS (click to expand raw data)</summary>
                        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                          {(() => {
                            const sections: Array<{ title: string; fields: Array<[string, unknown, string?]> }> = [
                              { title: 'Spot', fields: [
                                ['CMP', r.cmp, '₹'],
                                ['Mar Cap', r.marketCapCr, '₹Cr'],
                                ['P/E', r.pe],
                                ['P/E 5y med', r.pe5yMedian],
                                ['EV/EBITDA', r.evEbitda],
                                ['1Y perf', r.perf1y, '%'],
                              ]},
                              { title: 'Quarterly', fields: [
                                ['Sales Q1', r.salesQ1, '₹Cr'],
                                ['Sales Q2', r.salesQ2, '₹Cr'],
                                ['OPM Q1', r.opmQ1, '%'],
                                ['OPM Q2', r.opmQ2, '%'],
                                ['PAT Q1', r.patQ1, '₹Cr'],
                                ['PAT Q2', r.patQ2, '₹Cr'],
                                ['EPS Q1', r.epsQ1, '₹'],
                                ['Qtr PAT YoY', r.patQ1Yoy != null && r.patQ1 != null ? ((r.patQ1 - r.patQ1Yoy) / Math.abs(r.patQ1Yoy) * 100) : null, '%'],
                              ]},
                              { title: 'Annual', fields: [
                                ['Rev growth 1y', r.revenueGrowth1y, '%'],
                                ['Rev growth 3y', r.revenueGrowth3y, '%'],
                                ['Rev growth 5y', r.revenueGrowth5y, '%'],
                                ['PAT growth 1y', r.patGrowth1y, '%'],
                                ['PAT growth 3y', r.patGrowth3y, '%'],
                                ['Sales Y1', r.salesY1, '₹Cr'],
                                ['Sales Y2', r.salesY2, '₹Cr'],
                                ['PAT Y1', r.patY1, '₹Cr'],
                                ['PAT Y2', r.patY2, '₹Cr'],
                                ['Loss years', r.lossMakingYears5y, '/5'],
                              ]},
                              { title: 'Balance Sheet', fields: [
                                ['Debt', r.debtCurr, '₹Cr'],
                                ['Debt 3y back', r.debt3yBack, '₹Cr'],
                                ['D/E', r.de],
                                ['Int Coverage', r.interestCoverage, 'x'],
                                ['Int Cov 3y', r.interestCoverage3yBack, 'x'],
                                ['WC days', r.workingCapitalDays],
                                ['WC days 3y', r.workingCapitalDays3yBack],
                              ]},
                              { title: 'Returns', fields: [
                                ['ROCE', r.roce, '%'],
                                ['ROCE 3y', r.roce3yBack, '%'],
                                ['ROE', r.roe, '%'],
                              ]},
                              { title: 'Governance', fields: [
                                ['Promoter', r.promoterHolding, '%'],
                                ['Prom 3y back', r.promoterHolding3yBack, '%'],
                                ['Pledge', r.promoterPledgePct, '%'],
                              ]},
                            ];
                            return sections.map((s, i) => (
                              <div key={i}>
                                <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, letterSpacing: '0.4px', marginBottom: 4 }}>{s.title.toUpperCase()}</div>
                                {s.fields.map(([k, v, suf], j) => {
                                  const display = v == null || (typeof v === 'number' && isNaN(v as number))
                                    ? '—'
                                    : typeof v === 'number' ? `${(v as number).toFixed(Math.abs(v as number) >= 100 ? 0 : 1)}${suf ? ' ' + suf : ''}` : String(v);
                                  return (
                                    <div key={j} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                      <span style={{ color: MUTED }}>{k}</span>
                                      <span style={{ color: display === '—' ? MUTED : 'var(--mc-text-2)', fontWeight: 700 }}>{display}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            ));
                          })()}
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Lightweight CSV parser used by TurnaroundCompare. Handles quoted commas, BOM, trimming.
// PATCH 0755 — parseCsvFlexible extracted to lib/multibagger-csv-parsers.ts.
// Local re-export keeps existing callsites working without changes.

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0057 — HISTORICAL MULTIBAGGER REFERENCE PANEL
//
// Renders HISTORICAL_MULTIBAGGERS[] as cards so users can compare their
// uploaded stocks against canonical 100×–500× winners at the moment they
// were buyable. Includes pattern-matching: which canonical stock looks
// most similar to each upload.
// ═══════════════════════════════════════════════════════════════════════════

function MultibaggerReference({ excelRows }: { excelRows: ExcelResult[] }) {
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [filterMatch, setFilterMatch] = useState(false);

  // Pattern-match each canonical stock against the user's uploads
  const matches: Record<string, ExcelResult[]> = useMemo(() => {
    const out: Record<string, ExcelResult[]> = {};
    for (const hist of HISTORICAL_MULTIBAGGERS) {
      const matched = excelRows.filter(r => {
        // Multibagger archetype scoring — how closely does this stock match
        // the historical pattern at its entry point?
        let pts = 0;
        // Market cap proximity (within 3x band)
        if (r.marketCapCr !== undefined) {
          const ratio = r.marketCapCr / hist.market_cap_cr;
          if (ratio >= 0.3 && ratio <= 5) pts += 2;
        }
        // ROCE within ±8pp
        if (r.roce !== undefined && Math.abs(r.roce - hist.roce_pct) <= 8) pts += 2;
        // Profit CAGR within ±15pp
        if (r.profitCagr !== undefined && Math.abs(r.profitCagr - hist.profit_cagr_pct) <= 15) pts += 2;
        // Dilution drag similar (within ±3pp)
        if (r.dilution?.drag_pp !== null && r.dilution?.drag_pp !== undefined &&
            Math.abs(r.dilution.drag_pp - hist.dilution_drag_pp) <= 3) pts += 1;
        // Promoter holding within ±15pp
        if (r.promoter !== undefined && Math.abs(r.promoter - hist.promoter_pct) <= 15) pts += 2;
        // FII+DII within ±10pp
        if (r.fiiPlusDii !== undefined && Math.abs(r.fiiPlusDii - hist.fii_dii_pct) <= 10) pts += 1;
        return pts >= 5; // need a meaningful number of matching dimensions
      });
      out[hist.ticker] = matched;
    }
    return out;
  }, [excelRows]);

  return (
    <div style={{padding:'20px 24px',maxWidth:1400,margin:'0 auto'}}>
      <div style={{marginBottom:20}}>
        <h2 style={{fontSize:F.h2,fontWeight:800,color:TEXT,margin:'0 0 6px'}}>
          📚 Historical 100×–500× Reference
        </h2>
        <p style={{fontSize:F.md,color:MUTED,margin:0,lineHeight:1.5}}>
          Each canonical multibagger profiled at the moment it was buyable. Compare against your
          uploaded stocks to see which historical pattern your candidates resemble. The framework
          uses these to validate scoring calibration — every one of these scored
          {' '}<span style={{color:GREEN,fontWeight:600}}>BUILDING or COMPOUNDING (76-87)</span>{' '}
          on the patch 0055 reinvestment engine at their entry year.
        </p>
        {excelRows.length > 0 && (
          <label style={{display:'flex',alignItems:'center',gap:6,marginTop:10,fontSize:F.md,color:MUTED,cursor:'pointer'}}>
            <input
              type="checkbox"
              checked={filterMatch}
              onChange={e => setFilterMatch(e.target.checked)}
            />
            <span>Show only canonical stocks with at least one match in your {excelRows.length} uploaded stocks</span>
          </label>
        )}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(380px,1fr))',gap:14}}>
        {HISTORICAL_MULTIBAGGERS
          .filter(h => !filterMatch || (matches[h.ticker]?.length ?? 0) > 0)
          .map(h => {
            const isOpen = expandedCard === h.ticker;
            const matchedStocks = matches[h.ticker] ?? [];
            return (
              <div key={h.ticker} style={{
                backgroundColor:CARD_BG,
                border:`1px solid ${BORDER}`,
                borderLeft:`3px solid ${PURPLE}`,
                borderRadius:10,
                padding:'12px 14px',
              }}>
                <div
                  onClick={() => setExpandedCard(isOpen ? null : h.ticker)}
                  style={{cursor:'pointer'}}
                >
                  <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:8,marginBottom:6}}>
                    <div style={{display:'flex',alignItems:'baseline',gap:8}}>
                      <span style={{fontSize:F.h2,fontWeight:800,color:TEXT}}>{h.name}</span>
                      <span style={{fontSize:F.xs,color:MUTED}}>{h.entry_year}</span>
                    </div>
                    <span style={{fontSize:F.h2,fontWeight:900,color:GREEN}}>
                      {h.ten_year_return_x}×
                    </span>
                  </div>
                  <div style={{fontSize:F.xs,color:MUTED,marginBottom:8,lineHeight:1.4}}>
                    {h.inflection}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,fontSize:9}}>
                    <div>
                      <div style={{color:MUTED}}>MCap</div>
                      <div style={{color:TEXT,fontWeight:700}}>₹{h.market_cap_cr}Cr</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>ROCE</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.roce_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>Promoter</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.promoter_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>Rev CAGR</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.revenue_cagr_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>Profit CAGR</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.profit_cagr_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>FII+DII</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.fii_dii_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>EPS Growth</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.eps_growth_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>Dilution drag</div>
                      <div style={{color:h.dilution_drag_pp <= 0 ? GREEN : TEXT,fontWeight:700}}>
                        {h.dilution_drag_pp > 0 ? '+' : ''}{h.dilution_drag_pp}pp
                      </div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>Matches</div>
                      <div style={{color:matchedStocks.length>0?GREEN:MUTED,fontWeight:700}}>
                        {matchedStocks.length} stock{matchedStocks.length===1?'':'s'}
                      </div>
                    </div>
                  </div>
                </div>
                {isOpen && (
                  <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${BORDER}`}}>
                    <div style={{fontSize:F.xs,fontWeight:700,color:'var(--mc-cyan)',marginBottom:6,letterSpacing:'0.6px'}}>
                      FRAMEWORK SIGNALS THAT WOULD HAVE CAUGHT IT
                    </div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:10}}>
                      {h.framework_signals.map((s,i) => (
                        <span key={i} style={{
                          fontSize:9,padding:'3px 7px',borderRadius:4,
                          backgroundColor:`${PURPLE}20`,color:PURPLE,
                          border:`1px solid ${PURPLE}40`,fontWeight:600,
                        }}>{s}</span>
                      ))}
                    </div>
                    {matchedStocks.length > 0 && (
                      <>
                        <div style={{fontSize:F.xs,fontWeight:700,color:GREEN,marginBottom:6,letterSpacing:'0.6px'}}>
                          🎯 YOUR STOCKS WITH SIMILAR ARCHETYPE
                        </div>
                        <div style={{display:'flex',flexDirection:'column',gap:4}}>
                          {matchedStocks.slice(0,8).map(s => (
                            <div key={s.symbol} style={{
                              display:'flex',alignItems:'center',gap:8,
                              padding:'6px 8px',backgroundColor:CARD2,borderRadius:5,fontSize:F.xs,
                            }}>
                              <span style={{fontWeight:700,color:TEXT,minWidth:80}}>{s.symbol}</span>
                              <span style={{color:MUTED,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                                {s.company}
                              </span>
                              <span style={{
                                color: s.score>=80?GREEN:s.score>=68?'var(--mc-cyan)':s.score>=55?YELLOW:ORANGE,
                                fontWeight:700,minWidth:30,textAlign:'right',
                              }}>{s.score}</span>
                              <span style={{color:MUTED,minWidth:60,textAlign:'right'}}>
                                ₹{s.marketCapCr ? (s.marketCapCr >= 1000 ? (s.marketCapCr/1000).toFixed(1)+'k Cr' : s.marketCapCr+'Cr') : '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                <div style={{
                  marginTop:8,fontSize:9,color:MUTED,textAlign:'center',cursor:'pointer',
                }}
                  onClick={() => setExpandedCard(isOpen ? null : h.ticker)}
                >
                  {isOpen ? '▲ collapse' : '▼ click to expand'}
                </div>
              </div>
            );
          })}
      </div>

      <div style={{
        marginTop:24,padding:'12px 14px',backgroundColor:`${PURPLE}0A`,
        border:`1px solid ${PURPLE}30`,borderLeft:`3px solid ${PURPLE}`,borderRadius:8,
      }}>
        <div style={{fontSize:F.sm,fontWeight:700,color:PURPLE,marginBottom:6}}>
          📖 How to use this reference
        </div>
        <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.6}}>
          1. Toggle <strong style={{color:TEXT}}>'Show only canonical stocks with matches'</strong> to focus on patterns relevant to your uploads.<br/>
          2. Click any card to see which of your stocks match the historical archetype + which framework signals would have caught it.<br/>
          3. Match thresholds: cap within 0.3-5×, ROCE ±8pp, Profit CAGR ±15pp, Promoter ±15pp, FII+DII ±10pp. Need 5+ matching dimensions.<br/>
          4. A high match doesn't guarantee multibagger outcome — these are NECESSARY characteristics, not sufficient. Sector tailwind, founder execution, and reinvestment runway determine the rest.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CAPITAL ALLOCATION PANEL — embedded inside Multibagger as a sub-tab.
// Per-ticker scorecard: capex efficiency (ΔEBIT / cumulative capex),
// ROCE shift, equity dilution, buyback quality, dividend rationality,
// reinvestment runway. Computed from /api/earnings/india-screener annual
// data (no new pipeline). Composite score 0-100 with grade A-F.
// ─────────────────────────────────────────────────────────────────────────
interface CapAllocAnalysis {
  ticker: string; company: string;
  capexEfficiency: { value: number | null; grade: string; label: string };
  roceShift: { before: number | null; after: number | null; delta: number | null };
  dilution: { sharesYoYPct: number | null; verdict: string };
  buybackQuality: { sharesRepurchasedPct: number | null; verdict: string };
  dividendRationality: { payoutPct: number | null; epsGrowthPct: number | null; verdict: string };
  reinvestmentRunway: { years: number | null; verdict: string };
  overall: { score: number; grade: string; label: string };
}

async function analyseCapAlloc(ticker: string): Promise<CapAllocAnalysis | null> {
  const norm = ticker.includes('.') ? ticker : `${ticker}.NS`;
  const res = await fetch(`/api/earnings/india-screener?ticker=${encodeURIComponent(norm)}`);
  const json = await res.json().catch(() => null);
  if (!json?.ok) return null;
  const annual: any[] = json.annual || [];
  const cf: any[] = json.cashFlow || [];
  const bs: any[] = json.balanceSheet || [];
  const recent = annual.slice(-3);
  const recentCf = cf.slice(-3);
  const capexSum = recentCf.reduce((s: number, q: any) => {
    const inv = q.fromInvesting ?? 0;
    return s + (typeof inv === 'number' && inv < 0 ? Math.abs(inv) : 0);
  }, 0);
  const ebitStart = recent[0]?.operatingProfit ?? null;
  const ebitEnd = recent[recent.length - 1]?.operatingProfit ?? null;
  const ebitDelta = ebitStart != null && ebitEnd != null ? ebitEnd - ebitStart : null;
  const capexEff = capexSum > 0 && ebitDelta != null ? Math.round((ebitDelta / capexSum) * 10000) / 100 : null;
  let capexGrade = 'C';
  let capexLabel = 'Capex deployed but EBIT lift unclear';
  if (capexEff !== null) {
    if (capexEff >= 50) { capexGrade = 'A'; capexLabel = `Each Rs 1 of capex generated Rs ${(capexEff / 100).toFixed(2)} of incremental EBIT — excellent`; }
    else if (capexEff >= 25) { capexGrade = 'B'; capexLabel = `Reasonable capex returns (${capexEff.toFixed(0)}% incremental EBIT/capex)`; }
    else if (capexEff >= 10) { capexGrade = 'C'; capexLabel = `Modest returns (${capexEff.toFixed(0)}%) — capex deploying but EBIT lagging`; }
    else if (capexEff >= 0) { capexGrade = 'D'; capexLabel = `Weak returns (${capexEff.toFixed(0)}%) — capex not translating to EBIT`; }
    else { capexGrade = 'F'; capexLabel = 'Negative incremental EBIT despite capex — value destruction'; }
  }
  const ratios: any[] = json.ratios || [];
  const roceArr = ratios.map((r) => r.roce).filter((r: any) => r !== null && r !== undefined);
  const roceBefore = roceArr.length >= 3 ? roceArr[Math.max(0, roceArr.length - 3)] : null;
  const roceAfter = roceArr.length >= 1 ? roceArr[roceArr.length - 1] : null;
  const roceDelta = roceBefore != null && roceAfter != null ? Math.round((roceAfter - roceBefore) * 100) / 100 : null;
  const equityArr = bs.map((b: any) => b.equityCapital).filter((v: any) => v != null);
  const dilutionPct = equityArr.length >= 2 && equityArr[0] !== 0
    ? Math.round(((equityArr[equityArr.length - 1] - equityArr[0]) / equityArr[0]) * 10000) / 100
    : null;
  let dilutionVerdict = 'Share count steady';
  if (dilutionPct !== null) {
    if (dilutionPct > 10) dilutionVerdict = `Heavy dilution +${dilutionPct.toFixed(1)}% — value-destructive unless deployed accretively`;
    else if (dilutionPct > 3) dilutionVerdict = `Moderate dilution +${dilutionPct.toFixed(1)}%`;
    else if (dilutionPct < -3) dilutionVerdict = `Buybacks shrinking float ${dilutionPct.toFixed(1)}% — shareholder-friendly`;
  }
  const lastEps = recent[recent.length - 1]?.eps ?? null;
  const firstEps = recent[0]?.eps ?? null;
  const epsGrowth = firstEps != null && lastEps != null && firstEps !== 0 ? Math.round(((lastEps - firstEps) / Math.abs(firstEps)) * 10000) / 100 : null;
  const div = (json.topMetrics?.dividendYieldPct ?? null);
  const pe = (json.topMetrics?.peRatio ?? null);
  const payoutPct = div != null && pe != null ? Math.round(div * pe * 100) / 100 : null;
  let divVerdict = 'No dividend data';
  if (payoutPct !== null) {
    if (payoutPct < 15 && epsGrowth !== null && epsGrowth > 15) divVerdict = `Low payout (${payoutPct.toFixed(0)}%) + strong EPS growth — reinvesting well`;
    else if (payoutPct > 60 && epsGrowth !== null && epsGrowth < 5) divVerdict = `High payout (${payoutPct.toFixed(0)}%) + weak EPS growth — over-distributing`;
    else if (payoutPct > 80) divVerdict = `Very high payout (${payoutPct.toFixed(0)}%) — limited reinvestment`;
    else divVerdict = `Payout ${payoutPct.toFixed(0)}% — ${epsGrowth !== null ? `EPS ${epsGrowth >= 0 ? '+' : ''}${epsGrowth.toFixed(0)}% over period` : 'EPS context unclear'}`;
  }
  const lastReserves = bs[bs.length - 1]?.reserves ?? null;
  const lastCapex = recentCf[recentCf.length - 1]?.fromInvesting ? Math.abs(recentCf[recentCf.length - 1].fromInvesting) : null;
  const reinvestYears = lastReserves != null && lastCapex && lastCapex > 0 ? Math.round((lastReserves / lastCapex) * 10) / 10 : null;
  const reinvestVerdict = reinvestYears == null ? 'No data'
    : reinvestYears >= 8 ? `${reinvestYears.toFixed(1)} years of capex covered by reserves — long runway`
    : reinvestYears >= 3 ? `${reinvestYears.toFixed(1)}y runway — adequate`
    : `${reinvestYears.toFixed(1)}y runway — short, may need external funding`;
  const gradeMap: Record<string, number> = { A: 90, B: 75, C: 55, D: 35, F: 15 };
  const overall = Math.round(
    (gradeMap[capexGrade] || 50) * 0.4 +
    (roceDelta !== null ? Math.max(0, Math.min(100, 60 + roceDelta * 5)) : 50) * 0.2 +
    (dilutionPct !== null ? (dilutionPct < 0 ? 80 : dilutionPct < 3 ? 70 : dilutionPct < 10 ? 50 : 25) : 60) * 0.15 +
    (payoutPct !== null && epsGrowth !== null
      ? (epsGrowth > 15 ? 80 : epsGrowth > 5 ? 65 : epsGrowth > 0 ? 50 : 35)
      : 55) * 0.15 +
    (reinvestYears !== null
      ? (reinvestYears >= 8 ? 90 : reinvestYears >= 3 ? 70 : 45)
      : 60) * 0.10
  );
  let overallGrade = 'F'; let overallLabel = '';
  if (overall >= 80) { overallGrade = 'A'; overallLabel = 'Disciplined capital allocator — capex returns + clean balance sheet'; }
  else if (overall >= 65) { overallGrade = 'B'; overallLabel = 'Solid capital allocation, minor inefficiencies'; }
  else if (overall >= 50) { overallGrade = 'C'; overallLabel = 'Mixed — capex deploying but returns not yet visible'; }
  else if (overall >= 35) { overallGrade = 'D'; overallLabel = 'Capital deployment outpacing incremental returns'; }
  else { overallGrade = 'F'; overallLabel = 'Material capital-allocation concerns'; }
  return {
    ticker: norm, company: json.company || norm,
    capexEfficiency: { value: capexEff, grade: capexGrade, label: capexLabel },
    roceShift: { before: roceBefore, after: roceAfter, delta: roceDelta },
    dilution: { sharesYoYPct: dilutionPct, verdict: dilutionVerdict },
    buybackQuality: { sharesRepurchasedPct: dilutionPct !== null && dilutionPct < 0 ? -dilutionPct : null, verdict: dilutionPct !== null && dilutionPct < -1 ? `Buyback of ~${(-dilutionPct).toFixed(1)}% of float` : 'No material buybacks' },
    dividendRationality: { payoutPct, epsGrowthPct: epsGrowth, verdict: divVerdict },
    reinvestmentRunway: { years: reinvestYears, verdict: reinvestVerdict },
    overall: { score: overall, grade: overallGrade, label: overallLabel },
  };
}

function CapitalAllocationPanel() {
  const [ticker, setTicker] = useState('');
  const [analysis, setAnalysis] = useState<CapAllocAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const onSubmit = async () => {
    if (!ticker.trim()) return;
    setLoading(true); setError(''); setAnalysis(null);
    try {
      const a = await analyseCapAlloc(ticker.trim().toUpperCase());
      if (!a) setError('No data — verify ticker (e.g. RELIANCE.NS, BAJAJCON.NS)');
      else setAnalysis(a);
    } catch (e: any) {
      setError(e?.message || 'Analysis failed');
    }
    setLoading(false);
  };
  return (
    <div style={{ padding: '24px', maxWidth: 1800, margin: '0 auto' }}>
      <div style={{ fontSize: 13, color: MUTED, marginBottom: 16, lineHeight: 1.5 }}>
        How disciplined is management with shareholder capital? Capex efficiency · ROCE shift · dilution · buybacks · dividend rationality · reinvestment runway. Computed from Screener annual data.
      </div>
      {/* PATCH 0445 BUG-031 — Help text + auto-suffix hint */}
      <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>
        Tip: bare tickers like <span style={{ color: TEXT }}>RELIANCE</span> auto-normalise to <span style={{ color: TEXT }}>RELIANCE.NS</span> on submit.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
          placeholder="e.g. RELIANCE or RELIANCE.NS"
          style={{ flex: 1, padding: '10px 14px', background: '#13131a', color: TEXT, border: '1px solid rgba(255,255,255,0.10)', borderRadius: 6, fontSize: 13 }}
        />
        <button onClick={onSubmit} disabled={loading || !ticker.trim()}
          style={{ padding: '10px 18px', background: PURPLE, color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
          {loading ? 'Analysing…' : 'Analyse'}
        </button>
      </div>
      {error && <div style={{ color: 'var(--mc-warn)', fontSize: 12, marginBottom: 12 }}>WARN: {error}</div>}
      {analysis && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: '#13131a', border: '1px solid rgba(255,255,255,0.06)', borderLeft: `3px solid ${PURPLE}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>{analysis.company}</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{analysis.ticker}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14 }}>
              <div>
                <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Capital Allocation Score</div>
                <div style={{ fontSize: 36, fontWeight: 800, fontFamily: 'ui-monospace,monospace', color: analysis.overall.score >= 70 ? 'var(--mc-bullish)' : analysis.overall.score >= 50 ? 'var(--mc-warn)' : 'var(--mc-warn)' }}>
                  {analysis.overall.score}<span style={{ fontSize: 14, color: MUTED }}>/100</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Grade {analysis.overall.grade}</div>
              </div>
              <div style={{ flex: 1, fontSize: 12, color: TEXT, lineHeight: 1.5 }}>{analysis.overall.label}</div>
            </div>
          </div>
          {[
            { title: 'Capex Efficiency', value: analysis.capexEfficiency.value !== null ? `${analysis.capexEfficiency.value.toFixed(1)}% EBIT/capex` : '-', grade: analysis.capexEfficiency.grade, body: analysis.capexEfficiency.label },
            { title: 'ROCE Shift (3y)', value: analysis.roceShift.delta !== null ? `${analysis.roceShift.delta >= 0 ? '+' : ''}${analysis.roceShift.delta.toFixed(1)} pp` : '-', grade: '', body: `Before: ${analysis.roceShift.before?.toFixed(1) ?? '-'}%   |   After: ${analysis.roceShift.after?.toFixed(1) ?? '-'}%` },
            { title: 'Equity Dilution', value: analysis.dilution.sharesYoYPct !== null ? `${analysis.dilution.sharesYoYPct >= 0 ? '+' : ''}${analysis.dilution.sharesYoYPct.toFixed(1)}%` : '-', grade: '', body: analysis.dilution.verdict },
            { title: 'Buyback Quality', value: analysis.buybackQuality.sharesRepurchasedPct !== null ? `${analysis.buybackQuality.sharesRepurchasedPct.toFixed(1)}%` : '-', grade: '', body: analysis.buybackQuality.verdict },
            { title: 'Dividend Rationality', value: analysis.dividendRationality.payoutPct !== null ? `Payout ${analysis.dividendRationality.payoutPct.toFixed(0)}%` : '-', grade: '', body: analysis.dividendRationality.verdict },
            { title: 'Reinvestment Runway', value: analysis.reinvestmentRunway.years !== null ? `${analysis.reinvestmentRunway.years.toFixed(1)} years` : '-', grade: '', body: analysis.reinvestmentRunway.verdict },
          ].map((row) => (
            <div key={row.title} style={{ background: '#13131a', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ minWidth: 180 }}>
                <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>{row.title}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, fontFamily: 'ui-monospace,monospace' }}>{row.value}</div>
                {row.grade && <div style={{ fontSize: 11, fontWeight: 700, color: row.grade === 'A' ? 'var(--mc-bullish)' : row.grade === 'F' ? 'var(--mc-bearish)' : 'var(--mc-warn)' }}>Grade {row.grade}</div>}
              </div>
              <div style={{ flex: 1, fontSize: 12, color: TEXT, lineHeight: 1.5 }}>{row.body}</div>
            </div>
          ))}
        </div>
      )}
      {!analysis && !loading && !error && (
        <div style={{ background: '#13131a', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 20, fontSize: 12, color: MUTED }}>
          Enter an Indian ticker and we will compute capex efficiency, ROCE shift, equity dilution, buyback quality, dividend rationality, and reinvestment runway from Screener annual data.
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0872 — USA ANALYTICS TAB
//
// Self-contained analytics dashboard for the USA Multibagger universe.
// Reads USAResult[] from localStorage with proper listeners so it stays
// LIVE when the user uploads / clears / edits decisions / adjusts the
// conviction beats list — no manual refresh needed.
//
// Panels:
//   • Stats strip (count · avg score · A+/A count · R40 ≥40 · Piotroski ≥7)
//   • Grade distribution
//   • Sector exposure (top 8)
//   • Rule of 40 buckets (<0 / 0-20 / 20-40 / 40-60 / 60-80 / ≥80)
//   • Piotroski F-Score buckets (0-3 / 4-6 / 7-9)
//   • Forensic flag summary (FCF-Op divergence / post-run stretched / earnings prox)
//   • Decision overlay (BUY / WATCH / REJECTED counts)
//   • Conviction-Beats overlap
//   • Top 15 leaderboard
// ═══════════════════════════════════════════════════════════════════════════

function USAAnalytics() {
  // Live USA dataset — single source of truth read from LS, refreshed on
  // every relevant event so this tab never shows stale data.
  const [rows, setRows] = React.useState<USAResult[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(USA_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      try {
        const raw = localStorage.getItem(USA_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        setRows(Array.isArray(parsed) ? parsed : []);
      } catch { setRows([]); }
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === USA_STORAGE_KEY) refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mb-upload:updated', refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mb-upload:updated', refresh);
    };
  }, []);

  // Conviction-Beats overlay (live).
  const [convictionSet, setConvictionSet] = React.useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set<string>(getConvictionTickers()); } catch { return new Set(); }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => { try { setConvictionSet(new Set<string>(getConvictionTickers())); } catch {} };
    window.addEventListener('storage', refresh);
    window.addEventListener('conviction-beats:updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('conviction-beats:updated', refresh);
    };
  }, []);

  // Decision-log tick — included in every consumer memo so BUY/WATCH/REJECT
  // changes propagate without a page reload.
  const [decisionTick, bumpDec] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => subscribeDecisions(() => bumpDec()), []);

  // Pre-upload baseline for score-delta panels.
  const prevScoreMap = React.useMemo<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem('mb_usa_prev_scores_v1') || '{}'); } catch { return {}; }
  }, [rows.length]);

  const empty = rows.length === 0;
  const F2 = F;
  const GRADE_COLOR_US: Record<string, string> = { 'A+': '#10b981', 'A': '#34d399', 'B+': '#f59e0b', 'B': '#f97316', 'C': '#fb923c', 'D': '#ef4444' };

  const stats = React.useMemo(() => {
    const n = rows.length;
    const avgScore = n ? rows.reduce((s, r) => s + (r.score || 0), 0) / n : 0;
    const topGradeCount = rows.filter(r => r.grade === 'A+' || r.grade === 'A').length;
    const r40Pass = rows.filter(r => (r.ruleOf40 ?? -999) >= 40).length;
    const r40Elite = rows.filter(r => (r.ruleOf40 ?? -999) >= 60).length;
    const piotroskiPass = rows.filter(r => (r.piotroskiFScore ?? -1) >= 7).length;
    const altmanSafe = rows.filter(r => (r.altmanZScore ?? -1) >= 3).length;
    const acceleratingCount = rows.filter(r => r.accelSignal === 'ACCELERATING').length;
    const fcfDivCount = rows.filter(r => r.fcfOpDivergence).length;
    const postRunCount = rows.filter(r => r.postRunStretched).length;
    const earningsCloseCount = rows.filter(r => (r.earningsProximityDays ?? 999) <= 7).length;
    const totalMcapB = rows.reduce((s, r) => s + (r.marketCapB || 0), 0);
    const avgMcapB = n ? totalMcapB / n : 0;
    // Grade distribution
    const gradeBuckets: Record<string, number> = { 'A+': 0, 'A': 0, 'B+': 0, 'B': 0, 'C': 0, 'D': 0 };
    rows.forEach(r => { if (r.grade && gradeBuckets[r.grade] != null) gradeBuckets[r.grade]++; });
    // Sector exposure
    const sectorMap = new Map<string, number>();
    rows.forEach(r => {
      const s = (r.sector || 'Unknown').trim() || 'Unknown';
      sectorMap.set(s, (sectorMap.get(s) || 0) + 1);
    });
    // PATCH 0876 — Trim sector exposure 8 → 5 (top 5 is enough for
    // concentration risk; longer tail is noise on a screen-glance).
    const topSectors = Array.from(sectorMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    // PATCH 0876 — R40 buckets collapsed 6 → 4. The <0 / 0–20 / 20–40
    // tiers all mean "fails the Rule of 40" institutionally — there's
    // no decision difference between them. The right cuts are:
    // FAIL (<40) · PASS (40–60) · STRONG (60–80) · ELITE (≥80).
    const r40Buckets: Array<{ label: string; n: number; color: string }> = [
      { label: 'FAIL (<40)',   n: rows.filter(r => (r.ruleOf40 ?? -999) < 40).length,                                            color: RED },
      { label: 'PASS (40–60)', n: rows.filter(r => { const x = r.ruleOf40 ?? -999; return x >= 40 && x < 60; }).length,           color: GREEN },
      { label: 'STRONG (60–80)', n: rows.filter(r => { const x = r.ruleOf40 ?? -999; return x >= 60 && x < 80; }).length,         color: ACCENT },
      { label: 'ELITE (≥80)',  n: rows.filter(r => (r.ruleOf40 ?? -999) >= 80).length,                                          color: PURPLE },
    ];
    // Piotroski buckets
    const piotroskiBuckets = [
      { label: '0–3 (weak)',   n: rows.filter(r => (r.piotroskiFScore ?? -1) >= 0 && (r.piotroskiFScore ?? -1) <= 3).length, color: RED },
      { label: '4–6 (mid)',    n: rows.filter(r => (r.piotroskiFScore ?? -1) >= 4 && (r.piotroskiFScore ?? -1) <= 6).length, color: YELLOW },
      { label: '7–9 (elite)',  n: rows.filter(r => (r.piotroskiFScore ?? -1) >= 7).length,                                   color: GREEN },
    ];
    // Decision overlay
    const decisionCounts = { BUY: 0, WATCH: 0, REJECTED: 0, NONE: 0 };
    rows.forEach(r => {
      const d = getDecision(r.symbol);
      if (!d) decisionCounts.NONE++;
      else if (d.status === 'BUY') decisionCounts.BUY++;
      else if (d.status === 'WATCH') decisionCounts.WATCH++;
      else if (d.status === 'REJECTED') decisionCounts.REJECTED++;
    });
    // Conviction overlap (case-insensitive)
    const cbUpper = new Set<string>([...convictionSet].map(s => s.toUpperCase().trim()));
    const convictionOverlap = rows.filter(r => cbUpper.has((r.symbol || '').toUpperCase().trim())).length;
    // Score deltas (vs pre-upload baseline)
    const scoreDeltas = rows.map(r => {
      const prev = prevScoreMap[r.symbol];
      return prev === undefined ? null : (r.score - prev);
    }).filter((x): x is number => x !== null);
    const newSinceLast = rows.filter(r => prevScoreMap[r.symbol] === undefined).length;
    const reratingUp = rows.filter(r => {
      const prev = prevScoreMap[r.symbol];
      return prev !== undefined && (r.score - prev) >= 5;
    }).sort((a, b) => (b.score - prevScoreMap[b.symbol]) - (a.score - prevScoreMap[a.symbol]));
    const ratingDown = rows.filter(r => {
      const prev = prevScoreMap[r.symbol];
      return prev !== undefined && (r.score - prev) <= -5;
    }).sort((a, b) => (a.score - prevScoreMap[a.symbol]) - (b.score - prevScoreMap[b.symbol]));
    // Leaderboard — top 10 (was top 15; tighter view).
    const top10 = [...rows].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
    // PATCH 0876 — Institutional TOP BUYS shortlist. The right question
    // isn't "what's the average grade" — it's "of 300 rows, which 5-10
    // would I actually open a position on right now". Filter chain:
    //  • Grade A+ or A           — fundamentals pass institutional bar
    //  • R40 ≥ 40                — growth + cash-gen efficiency
    //  • Piotroski ≥ 6           — financial-strength gate (Piotroski 2000)
    //  • No FCF/Op divergence    — earnings quality clean
    //  • Not post-run stretched  — entry not late-cycle
    //  • Earnings > 7 days away  — no print-risk window
    // The strict version (≥7 Piotroski, no flags) is too narrow for a
    // 300-stock universe; relaxing Piotroski to ≥6 + dropping flag-free
    // requirement to "no critical flags" yields a useful 5-15 candidate
    // shortlist on a typical universe.
    const topBuys = [...rows]
      .filter(r => (r.grade === 'A+' || r.grade === 'A'))
      .filter(r => (r.ruleOf40 ?? -999) >= 40)
      .filter(r => (r.piotroskiFScore ?? -1) >= 6)
      .filter(r => !r.fcfOpDivergence)
      .filter(r => !r.postRunStretched)
      .filter(r => (r.earningsProximityDays ?? 999) > 7)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 12);
    // PATCH 0876 — AT-RISK shortlist. The user explicitly wants warnings,
    // not just opportunities. Surface every row that has at least one
    // forensic flag, sorted by score (so the highest-conviction risks
    // appear first — those are the most dangerous because the user is
    // most likely to act on them without realising the flag).
    const atRiskRows = [...rows]
      .filter(r => r.fcfOpDivergence || r.postRunStretched || (r.earningsProximityDays ?? 999) <= 7)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 12);
    return {
      n, avgScore, topGradeCount, r40Pass, r40Elite, piotroskiPass, altmanSafe,
      acceleratingCount, fcfDivCount, postRunCount, earningsCloseCount,
      totalMcapB, avgMcapB, gradeBuckets, topSectors, r40Buckets, piotroskiBuckets,
      decisionCounts, convictionOverlap, scoreDeltas, newSinceLast,
      reratingUp, ratingDown, top10, topBuys, atRiskRows,
    };
  }, [rows, convictionSet, prevScoreMap, decisionTick]);

  if (empty) {
    return (
      <div style={{ maxWidth: 1800, margin: '0 auto', padding: '24px' }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '40px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🇺🇸</div>
          <h2 style={{ fontSize: F.h2, color: TEXT, margin: '0 0 8px' }}>USA Analytics — no data yet</h2>
          <p style={{ fontSize: F.md, color: MUTED, margin: 0 }}>
            Upload a USA TradingView export on the <strong style={{ color: PURPLE }}>🇺🇸 USA Multibagger</strong> tab. This dashboard will then summarise grade distribution, Rule of 40, Piotroski, forensic flags, decision tags, and conviction-beats overlap.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1800, margin: '0 auto', padding: '20px 24px 32px' }}>
      {/* ── PATCH 0876 STATS STRIP — trimmed 10 → 6 actionable KPIs ────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 18 }}>
        {[
          { label: 'STOCKS',        value: stats.n.toString(),                          sub: 'in current upload',           color: PURPLE },
          { label: 'TOP-TIER',      value: `${stats.topGradeCount}`,                    sub: `A+/A grade · ${stats.n ? (100 * stats.topGradeCount / stats.n).toFixed(0) : 0}%`, color: stats.topGradeCount > 0 ? GREEN : MUTED },
          { label: 'R40 ELITE',     value: stats.r40Elite.toString(),                   sub: 'rule of 40 ≥60',              color: stats.r40Elite > 0 ? PURPLE : MUTED },
          { label: 'PIOTROSKI ≥7',  value: stats.piotroskiPass.toString(),              sub: 'elite financial quality',     color: stats.piotroskiPass > 0 ? GREEN : MUTED },
          { label: 'FORENSIC ⚠',    value: (stats.fcfDivCount + stats.postRunCount).toString(), sub: 'flagged risks',       color: (stats.fcfDivCount + stats.postRunCount) > 0 ? RED : MUTED },
          { label: 'CONVICTION',    value: stats.convictionOverlap.toString(),          sub: 'overlap with your bench',     color: stats.convictionOverlap > 0 ? PURPLE : MUTED },
        ].map((s) => (
          <div key={s.label} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: 0.6 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, fontFamily: 'ui-monospace,monospace', marginTop: 2 }}>{s.value}</div>
            {s.sub && <div style={{ fontSize: 9, color: MUTED, marginTop: 2, letterSpacing: 0.3 }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── PATCH 0876: ACTIONABLE SHORTLISTS — what to buy, what to avoid ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
        <div style={{ background: CARD_BG, border: `1px solid ${GREEN}40`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: GREEN, marginBottom: 4 }}>🎯 TOP BUYS ({stats.topBuys.length})</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 10, lineHeight: 1.5 }}>
            Grade A+/A · R40 ≥40 · Piotroski ≥6 · clean forensics · earnings &gt;7d away
          </div>
          {stats.topBuys.length === 0 ? (
            <div style={{ fontSize: 11, color: MUTED, padding: 12, textAlign: 'center', background: '#0a0a0f', borderRadius: 6 }}>
              No rows pass the institutional buy gate today. Likely cause: too few A+/A grades, or every top-graded row has a forensic flag or earnings in the next 7 days.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stats.topBuys.map(r => {
                const d = getDecision(r.symbol);
                const inCb = convictionSet.has(r.symbol.toUpperCase());
                return (
                  <div key={r.symbol} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#0a0a0f', borderRadius: 6 }}>
                    <div style={{ width: 70, fontSize: 12, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace,monospace' }}>{r.symbol}</div>
                    <div style={{ flex: 1, fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.sector}>{r.sector || ''}</div>
                    <div style={{ fontSize: 10, color: GRADE_COLOR_US[r.grade] || TEXT, padding: '2px 6px', background: `${GRADE_COLOR_US[r.grade] || TEXT}20`, borderRadius: 4, fontWeight: 700 }}>{r.grade}</div>
                    <div style={{ fontSize: 10, color: ACCENT, padding: '2px 6px', background: `${ACCENT}20`, borderRadius: 4, fontWeight: 700, fontFamily: 'ui-monospace,monospace' }} title="Rule of 40">R40 {r.ruleOf40 != null ? r.ruleOf40.toFixed(0) : '—'}</div>
                    <div style={{ width: 36, fontSize: 12, color: TEXT, fontFamily: 'ui-monospace,monospace', fontWeight: 800, textAlign: 'right' }}>{(r.score || 0).toFixed(0)}</div>
                    {d && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: d.status === 'BUY' ? `${GREEN}30` : d.status === 'WATCH' ? `${YELLOW}30` : `${RED}30`, color: d.status === 'BUY' ? GREEN : d.status === 'WATCH' ? YELLOW : RED, fontWeight: 700 }}>{d.status}</span>}
                    {inCb && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: `${PURPLE}30`, color: PURPLE, fontWeight: 700 }}>CB</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ background: CARD_BG, border: `1px solid ${RED}40`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: RED, marginBottom: 4 }}>⚠ AT-RISK ROWS ({stats.atRiskRows.length})</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 10, lineHeight: 1.5 }}>
            Has at least one forensic flag: FCF/Op divergence · post-run stretched · earnings ≤7d. Sorted by score (highest-conviction risk first).
          </div>
          {stats.atRiskRows.length === 0 ? (
            <div style={{ fontSize: 11, color: GREEN, padding: 12, textAlign: 'center', background: '#0a0a0f', borderRadius: 6 }}>
              ✓ No row in the universe is currently flagged for forensic risk, post-run extension, or near-term earnings.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stats.atRiskRows.map(r => {
                const flags: Array<{ label: string; color: string }> = [];
                if (r.fcfOpDivergence) flags.push({ label: 'FCF≠OP', color: RED });
                if (r.postRunStretched) flags.push({ label: 'STRETCHED', color: ORANGE });
                if ((r.earningsProximityDays ?? 999) <= 7) flags.push({ label: `ER ${r.earningsProximityDays}d`, color: YELLOW });
                const d = getDecision(r.symbol);
                return (
                  <div key={r.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#0a0a0f', borderRadius: 6 }}>
                    <div style={{ width: 70, fontSize: 12, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace,monospace' }}>{r.symbol}</div>
                    <div style={{ flex: 1, fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sector || ''}</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {flags.map(f => (
                        <span key={f.label} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: `${f.color}25`, color: f.color, fontWeight: 700 }}>{f.label}</span>
                      ))}
                    </div>
                    <div style={{ width: 36, fontSize: 12, color: TEXT, fontFamily: 'ui-monospace,monospace', fontWeight: 800, textAlign: 'right' }}>{(r.score || 0).toFixed(0)}</div>
                    {d && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: d.status === 'BUY' ? `${GREEN}30` : d.status === 'WATCH' ? `${YELLOW}30` : `${RED}30`, color: d.status === 'BUY' ? GREEN : d.status === 'WATCH' ? YELLOW : RED, fontWeight: 700 }}>{d.status}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── DISTRIBUTIONS ROW ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 18 }}>
        {/* Grade distribution */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: TEXT, marginBottom: 12 }}>GRADE DISTRIBUTION</div>
          {(['A+','A','B+','B','C','D'] as const).map(g => {
            const c = stats.gradeBuckets[g] || 0;
            const pct = stats.n ? (100 * c / stats.n) : 0;
            return (
              <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 28, fontSize: 12, fontWeight: 800, color: GRADE_COLOR_US[g] }}>{g}</div>
                <div style={{ flex: 1, height: 14, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: GRADE_COLOR_US[g], transition: 'width 0.3s' }} />
                </div>
                <div style={{ width: 64, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{c} · {pct.toFixed(0)}%</div>
              </div>
            );
          })}
        </div>

        {/* Sector exposure */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: TEXT, marginBottom: 12 }}>SECTOR EXPOSURE (TOP 8)</div>
          {stats.topSectors.length === 0 && <div style={{ fontSize: 12, color: MUTED }}>No sector tags found in dataset.</div>}
          {stats.topSectors.map(([sector, count]) => {
            const pct = stats.n ? (100 * count / stats.n) : 0;
            return (
              <div key={sector} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 130, fontSize: 11, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sector}>{sector}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: ACCENT }} />
                </div>
                <div style={{ width: 56, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{count} · {pct.toFixed(0)}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── QUALITY HISTOGRAMS ROW ───────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 18 }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>RULE OF 40 BUCKETS</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>RevGrowth + FCF Margin · ≥40 institutional pass · ≥60 strong · ≥80 elite</div>
          {stats.r40Buckets.map(b => {
            const pct = stats.n ? (100 * b.n / stats.n) : 0;
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                <div style={{ width: 60, fontSize: 11, color: TEXT }}>{b.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color }} />
                </div>
                <div style={{ width: 36, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{b.n}</div>
              </div>
            );
          })}
        </div>

        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>PIOTROSKI F-SCORE</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>9-pt financial-strength scale · ≥7 = elite quality (Piotroski 2000)</div>
          {stats.piotroskiBuckets.map(b => {
            const pct = stats.n ? (100 * b.n / stats.n) : 0;
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                <div style={{ width: 100, fontSize: 11, color: TEXT }}>{b.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color }} />
                </div>
                <div style={{ width: 36, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{b.n}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── FORENSIC FLAGS + DECISION OVERLAY ─────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 18 }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: TEXT, marginBottom: 12 }}>FORENSIC FLAGS</div>
          {[
            { label: 'FCF / OP divergence', n: stats.fcfDivCount, color: RED, hint: 'Operating profit grows but FCF lags — accrual/working-cap warning' },
            { label: 'Post-run stretched',  n: stats.postRunCount, color: ORANGE, hint: 'Big 1Y run + extended valuation — late-cycle entry risk' },
            { label: 'Earnings ≤7 days',    n: stats.earningsCloseCount, color: YELLOW, hint: 'Print imminent — sizing should reflect event risk' },
          ].map(f => (
            <div key={f.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${BORDER}` }}>
              <div>
                <div style={{ fontSize: 12, color: TEXT, fontWeight: 700 }}>{f.label}</div>
                <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{f.hint}</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: f.n > 0 ? f.color : MUTED, fontFamily: 'ui-monospace,monospace' }}>{f.n}</div>
            </div>
          ))}
        </div>

        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>DECISION OVERLAY</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>Live counts from your decision logbook · refreshes immediately on tag change</div>
          {[
            { label: 'BUY',      n: stats.decisionCounts.BUY,      color: GREEN },
            { label: 'WATCH',    n: stats.decisionCounts.WATCH,    color: YELLOW },
            { label: 'REJECTED', n: stats.decisionCounts.REJECTED, color: RED },
            { label: 'No tag',   n: stats.decisionCounts.NONE,     color: MUTED },
          ].map(d => {
            const pct = stats.n ? (100 * d.n / stats.n) : 0;
            return (
              <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 80, fontSize: 12, color: d.color, fontWeight: 700 }}>{d.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: d.color }} />
                </div>
                <div style={{ width: 70, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{d.n} · {pct.toFixed(0)}%</div>
              </div>
            );
          })}
          <div style={{ marginTop: 12, padding: 10, background: '#0a0a0f', borderRadius: 6, fontSize: 11, color: MUTED }}>
            Decision coverage: <span style={{ color: TEXT, fontWeight: 700 }}>{stats.n ? (100 * (stats.n - stats.decisionCounts.NONE) / stats.n).toFixed(0) : 0}%</span> of universe tagged
          </div>
        </div>
      </div>

      {/* ── RE-RATING DELTAS ──────────────────────────────────────── */}
      {(stats.reratingUp.length > 0 || stats.ratingDown.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 18 }}>
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: F2.sm, fontWeight: 800, color: GREEN, marginBottom: 4 }}>↑ RE-RATING (score +5 or better)</div>
            <div style={{ fontSize: 10, color: MUTED, marginBottom: 10 }}>Vs your last upload baseline — fundamentals improving</div>
            {stats.reratingUp.slice(0, 8).map(r => {
              const prev = prevScoreMap[r.symbol];
              const delta = r.score - prev;
              return (
                <div key={r.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 12, color: TEXT, fontFamily: 'ui-monospace,monospace' }}>{r.symbol}</div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace' }}>{prev.toFixed(0)} → {r.score.toFixed(0)}</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: GREEN, fontFamily: 'ui-monospace,monospace' }}>+{delta.toFixed(0)}</div>
                  </div>
                </div>
              );
            })}
            {stats.reratingUp.length === 0 && <div style={{ fontSize: 11, color: MUTED, padding: 8 }}>No upward re-ratings in this batch.</div>}
          </div>
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: F2.sm, fontWeight: 800, color: RED, marginBottom: 4 }}>↓ DROP ALERTS (score −5 or worse)</div>
            <div style={{ fontSize: 10, color: MUTED, marginBottom: 10 }}>Vs your last upload baseline — review or trim</div>
            {stats.ratingDown.slice(0, 8).map(r => {
              const prev = prevScoreMap[r.symbol];
              const delta = r.score - prev;
              return (
                <div key={r.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 12, color: TEXT, fontFamily: 'ui-monospace,monospace' }}>{r.symbol}</div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace' }}>{prev.toFixed(0)} → {r.score.toFixed(0)}</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: RED, fontFamily: 'ui-monospace,monospace' }}>{delta.toFixed(0)}</div>
                  </div>
                </div>
              );
            })}
            {stats.ratingDown.length === 0 && <div style={{ fontSize: 11, color: MUTED, padding: 8 }}>No score drops in this batch.</div>}
          </div>
        </div>
      )}

      {/* ── TOP 15 LEADERBOARD ────────────────────────────────────── */}
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: F2.sm, fontWeight: 800, color: TEXT, marginBottom: 12 }}>TOP 10 BY SCORE</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: MUTED, textAlign: 'left' }}>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>#</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>SYMBOL</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>SECTOR</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>SCORE</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>GRADE</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>R40</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>PIOTROSKI</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>MCAP $B</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>TAGS</th>
              </tr>
            </thead>
            <tbody>
              {stats.top10.map((r, i) => {
                const d = getDecision(r.symbol);
                const inCb = convictionSet.has(r.symbol.toUpperCase());
                return (
                  <tr key={r.symbol} style={{ color: TEXT }}>
                    <td style={{ padding: '6px 8px', color: MUTED, fontFamily: 'ui-monospace,monospace' }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px', fontWeight: 700, fontFamily: 'ui-monospace,monospace' }}>{r.symbol}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: MUTED, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sector || ''}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', fontWeight: 700 }}>{(r.score || 0).toFixed(1)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: GRADE_COLOR_US[r.grade] || TEXT, fontWeight: 800 }}>{r.grade}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: (r.ruleOf40 ?? -999) >= 40 ? GREEN : MUTED }}>{r.ruleOf40 != null ? r.ruleOf40.toFixed(0) : '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: (r.piotroskiFScore ?? -1) >= 7 ? GREEN : MUTED }}>{r.piotroskiFScore != null ? r.piotroskiFScore.toFixed(0) : '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: MUTED }}>{r.marketCapB != null ? r.marketCapB.toFixed(1) : '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      {d && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: d.status === 'BUY' ? `${GREEN}30` : d.status === 'WATCH' ? `${YELLOW}30` : `${RED}30`, color: d.status === 'BUY' ? GREEN : d.status === 'WATCH' ? YELLOW : RED, fontWeight: 700, marginLeft: 4 }}>{d.status}</span>}
                      {inCb && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${PURPLE}30`, color: PURPLE, fontWeight: 700, marginLeft: 4 }}>CB</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0872 — TURNAROUND ANALYTICS TAB
//
// Self-contained analytics dashboard for the Turnaround universe. Reads
// TurnaroundResult[] from localStorage with proper listeners (storage +
// mb-upload:updated) plus a decision-tick reducer so BUY/WATCH/REJECTED
// tag changes flow through immediately.
//
// Panels (institutional playbook order — Phase ↔ Stage ↔ Survival):
//   • Stats strip (count · avg · BUY-ZONE · BEST · survival pass · concall ≥15)
//   • Stage distribution (DISTRESS → SETUP → EARLY-SHOOTS → PATTERN →
//     CONFIRMED → MATURE → NOT-TURNAROUND)
//   • Archetype breakdown (TURNAROUND vs GROWTH / QUALITY / VALUE-TRAP /
//     DECLINING / WAIT / NEUTRAL — tells user which rows belong on this tab)
//   • Turnaround Type breakdown (CYCLICAL / OPERATIONAL / DISTRESSED)
//   • Phase distribution (1 Collapse / 2 Stabilisation / 3 Inflection BUY /
//     4 Re-rating)
//   • Survival score histogram (0-8 from playbook Ch.4 gate filter)
//   • Best candidates leaderboard (isBestCandidate === true)
//   • Top 12 by total score
// ═══════════════════════════════════════════════════════════════════════════

function TurnaroundAnalytics() {
  const [rows, setRows] = React.useState<TurnaroundResult[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(TURNAROUND_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      try {
        const raw = localStorage.getItem(TURNAROUND_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        setRows(Array.isArray(parsed) ? parsed : []);
      } catch { setRows([]); }
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === TURNAROUND_STORAGE_KEY) refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mb-upload:updated', refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mb-upload:updated', refresh);
    };
  }, []);

  const [convictionSet, setConvictionSet] = React.useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set<string>(getConvictionTickers()); } catch { return new Set(); }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => { try { setConvictionSet(new Set<string>(getConvictionTickers())); } catch {} };
    window.addEventListener('storage', refresh);
    window.addEventListener('conviction-beats:updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('conviction-beats:updated', refresh);
    };
  }, []);

  const [decisionTick, bumpDec] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => subscribeDecisions(() => bumpDec()), []);

  // PATCH 0875 — Default view = real turnarounds only. User uploaded 100
  // rows from a general-purpose Screener, of which ~80 are quality
  // compounders or growth stocks that don't belong on this tab. Showing
  // analytics over all 100 diluted every signal (avg score 8.7, BUY-ZONE
  // 0, ALL panels 0). The toggle exposes the full dataset when the user
  // explicitly wants the mis-classification breakdown.
  const [viewMode, setViewMode] = React.useState<'TURNAROUNDS' | 'ALL'>('TURNAROUNDS');

  const empty = rows.length === 0;
  const GRADE_COLOR_TA: Record<string, string> = { 'A+': '#10b981', 'A': '#34d399', 'B+': '#f59e0b', 'B': '#f97316', 'C': '#fb923c', 'D': '#ef4444' };

  // PATCH 0875 — Pre-compute the dataset composition so the context banner
  // can warn when the upload is mostly non-turnaround rows.
  const datasetMix = React.useMemo(() => {
    const total = rows.length;
    const real = rows.filter(r => r.archetype === 'TURNAROUND').length;
    const quality = rows.filter(r => r.archetype === 'QUALITY').length;
    const growth = rows.filter(r => r.archetype === 'GROWTH').length;
    const valueTrap = rows.filter(r => r.archetype === 'VALUE-TRAP').length;
    const declining = rows.filter(r => r.archetype === 'DECLINING').length;
    const realPct = total ? Math.round(100 * real / total) : 0;
    const misclassified = total - real;
    return { total, real, quality, growth, valueTrap, declining, realPct, misclassified };
  }, [rows]);

  const stats = React.useMemo(() => {
    // PATCH 0875 — analytics now compute over the active view's subset.
    const displayRows = viewMode === 'TURNAROUNDS'
      ? rows.filter(r => r.archetype === 'TURNAROUND')
      : rows;
    const n = displayRows.length;
    const avgScore = n ? displayRows.reduce((s, r) => s + (r.totalScore || 0), 0) / n : 0;
    const buyZone = displayRows.filter(r => r.inBuyZone).length;
    const best = displayRows.filter(r => r.isBestCandidate).length;
    const confirmed = displayRows.filter(r => r.stage === 'CONFIRMED').length;
    const survivalPass = displayRows.filter(r => (r.survivalScore || 0) >= 6).length;
    const highConcall = displayRows.filter(r => (r.concallScore || 0) >= 15).length;
    const realTurnarounds = displayRows.filter(r => r.archetype === 'TURNAROUND').length;
    const valueTraps = displayRows.filter(r => r.archetype === 'VALUE-TRAP').length;
    // Inflection phase = institutional BUY window
    const inflection = displayRows.filter(r => r.phase === 3).length;
    // Stage distribution — filter zeros to keep the panel clean
    const stages: TurnaroundStage[] = ['DISTRESS', 'SETUP', 'EARLY-SHOOTS', 'PATTERN', 'CONFIRMED', 'MATURE', 'NOT-TURNAROUND'];
    const stageBucketsAll = stages.map(s => ({
      label: s,
      n: displayRows.filter(r => r.stage === s).length,
      color: s === 'EARLY-SHOOTS' ? GREEN : s === 'PATTERN' ? ACCENT : s === 'CONFIRMED' ? PURPLE : s === 'MATURE' ? YELLOW : s === 'SETUP' ? '#94a3b8' : s === 'DISTRESS' ? ORANGE : RED,
      emoji: s === 'EARLY-SHOOTS' ? '🌱' : s === 'PATTERN' ? '📈' : s === 'CONFIRMED' ? '✅' : s === 'MATURE' ? '🌅' : s === 'SETUP' ? '⏳' : s === 'DISTRESS' ? '🚫' : '❌',
    }));
    const stageBuckets = stageBucketsAll.filter(b => b.n > 0);
    // Archetype distribution
    const archetypes: TurnaroundArchetype[] = ['TURNAROUND', 'GROWTH', 'QUALITY', 'VALUE-TRAP', 'DECLINING', 'WAIT', 'NEUTRAL'];
    const archetypeBucketsAll = archetypes.map(a => ({
      label: a,
      n: displayRows.filter(r => r.archetype === a).length,
      color: a === 'TURNAROUND' ? PURPLE : a === 'GROWTH' ? GREEN : a === 'QUALITY' ? ACCENT : a === 'VALUE-TRAP' ? RED : a === 'DECLINING' ? ORANGE : a === 'WAIT' ? YELLOW : MUTED,
    }));
    const archetypeBuckets = archetypeBucketsAll.filter(b => b.n > 0);
    // Turnaround type
    const typeBucketsAll: Array<{ label: string; n: number; color: string }> = [
      { label: 'CYCLICAL',    n: displayRows.filter(r => r.turnaroundType === 'CYCLICAL').length,    color: ACCENT },
      { label: 'OPERATIONAL', n: displayRows.filter(r => r.turnaroundType === 'OPERATIONAL').length, color: PURPLE },
      { label: 'DISTRESSED',  n: displayRows.filter(r => r.turnaroundType === 'DISTRESSED').length,  color: ORANGE },
      { label: 'UNKNOWN',     n: displayRows.filter(r => r.turnaroundType === 'UNKNOWN' || !r.turnaroundType).length, color: MUTED },
    ];
    const typeAllUnknown = typeBucketsAll.find(b => b.label === 'UNKNOWN')?.n === n && n > 0;
    const typeBuckets = typeBucketsAll;
    // Phase
    const phaseBucketsAll = ([1, 2, 3, 4] as const).map(p => ({
      label: p === 1 ? '1 · COLLAPSE' : p === 2 ? '2 · STABILISATION' : p === 3 ? '3 · INFLECTION (BUY)' : '4 · RE-RATING',
      n: displayRows.filter(r => r.phase === p).length,
      color: p === 1 ? RED : p === 2 ? ORANGE : p === 3 ? GREEN : ACCENT,
    }));
    const phaseAllZero = phaseBucketsAll.every(b => b.n === 0) && n > 0;
    const phaseBuckets = phaseBucketsAll;
    // Survival score buckets
    const survivalBucketsAll = [
      { label: '0–2 (fragile)', n: displayRows.filter(r => (r.survivalScore ?? -1) >= 0 && (r.survivalScore ?? -1) <= 2).length, color: RED },
      { label: '3–5 (mid)',     n: displayRows.filter(r => (r.survivalScore ?? -1) >= 3 && (r.survivalScore ?? -1) <= 5).length, color: YELLOW },
      { label: '6–8 (robust)',  n: displayRows.filter(r => (r.survivalScore ?? -1) >= 6).length,                                  color: GREEN },
    ];
    const survivalAllFragile = survivalBucketsAll[0].n === n && n > 0;
    const survivalBuckets = survivalBucketsAll;
    // Decision overlay
    const decisionCounts = { BUY: 0, WATCH: 0, REJECTED: 0, NONE: 0 };
    displayRows.forEach(r => {
      const d = getDecision(r.symbol);
      if (!d) decisionCounts.NONE++;
      else if (d.status === 'BUY') decisionCounts.BUY++;
      else if (d.status === 'WATCH') decisionCounts.WATCH++;
      else if (d.status === 'REJECTED') decisionCounts.REJECTED++;
    });
    // Conviction overlap
    const cbUpper = new Set<string>([...convictionSet].map(s => s.toUpperCase().trim()));
    const convictionOverlap = displayRows.filter(r => cbUpper.has((r.symbol || '').toUpperCase().trim())).length;
    // Best candidates
    const bestList = [...displayRows].filter(r => r.isBestCandidate).sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    // Top 12 overall
    const top12 = [...displayRows].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0)).slice(0, 12);
    return {
      displayRows, n, avgScore, buyZone, best, confirmed, survivalPass, highConcall, realTurnarounds, valueTraps, inflection,
      stageBuckets, archetypeBuckets, typeBuckets, phaseBuckets, survivalBuckets,
      typeAllUnknown, phaseAllZero, survivalAllFragile,
      decisionCounts, convictionOverlap, bestList, top12,
    };
  }, [rows, convictionSet, decisionTick, viewMode]);

  if (empty) {
    return (
      <div style={{ maxWidth: 1800, margin: '0 auto', padding: '24px' }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '40px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🔄</div>
          <h2 style={{ fontSize: F.h2, color: TEXT, margin: '0 0 8px' }}>Turnaround Analytics — no data yet</h2>
          <p style={{ fontSize: F.md, color: MUTED, margin: 0 }}>
            Upload a turnaround Screener CSV on the <strong style={{ color: PURPLE }}>🔄 Turnarounds</strong> tab. This dashboard summarises stage, archetype, phase, survival score, and the institutional best-candidate shortlist.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1800, margin: '0 auto', padding: '20px 24px 32px' }}>
      {/* ── PATCH 0875: CONTEXT BANNER — surfaces dataset mis-classification ─ */}
      {datasetMix.realPct < 80 && datasetMix.total > 0 && (
        <div style={{
          background: `linear-gradient(90deg, ${PURPLE}15, ${ACCENT}10)`,
          border: `1px solid ${PURPLE}40`,
          borderRadius: 10,
          padding: '14px 18px',
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 20 }}>🔍</div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: F.sm, color: TEXT, fontWeight: 700, marginBottom: 4 }}>
              Dataset mix · {datasetMix.real} real turnarounds in {datasetMix.total} uploaded rows ({datasetMix.realPct}%)
            </div>
            <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.5 }}>
              {datasetMix.quality > 0 && <span>💎 {datasetMix.quality} QUALITY compounders · </span>}
              {datasetMix.growth > 0 && <span>🚀 {datasetMix.growth} GROWTH stocks · </span>}
              {datasetMix.valueTrap > 0 && <span style={{ color: RED }}>🧊 {datasetMix.valueTrap} VALUE-TRAPS · </span>}
              {datasetMix.declining > 0 && <span style={{ color: ORANGE }}>📉 {datasetMix.declining} DECLINING · </span>}
              <span>the others go on different tabs.</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, padding: 4, background: '#0a0a0f', borderRadius: 8 }}>
            <button
              onClick={() => setViewMode('TURNAROUNDS')}
              style={{
                padding: '6px 14px',
                background: viewMode === 'TURNAROUNDS' ? PURPLE : 'transparent',
                color: viewMode === 'TURNAROUNDS' ? '#0a0a0f' : MUTED,
                border: 'none', borderRadius: 6, cursor: 'pointer',
                fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
              }}
            >TURNAROUNDS ONLY ({datasetMix.real})</button>
            <button
              onClick={() => setViewMode('ALL')}
              style={{
                padding: '6px 14px',
                background: viewMode === 'ALL' ? PURPLE : 'transparent',
                color: viewMode === 'ALL' ? '#0a0a0f' : MUTED,
                border: 'none', borderRadius: 6, cursor: 'pointer',
                fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
              }}
            >ALL ROWS ({datasetMix.total})</button>
          </div>
        </div>
      )}

      {/* ── STATS STRIP — PATCH 0875: trimmed 10 → 6 actionable KPIs ───── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 18 }}>
        {[
          { label: viewMode === 'TURNAROUNDS' ? 'TURNAROUNDS' : 'ALL ROWS', value: stats.n.toString(), sub: viewMode === 'TURNAROUNDS' ? `of ${datasetMix.total} uploaded` : undefined, color: PURPLE },
          { label: 'AVG SCORE',          value: stats.avgScore.toFixed(1),                                                       sub: 'out of 100', color: ACCENT },
          { label: 'BUY-ZONE',           value: stats.buyZone.toString(),                                                        sub: 'EARLY-SHOOTS + PATTERN', color: stats.buyZone > 0 ? GREEN : MUTED },
          { label: 'INFLECTION (P3)',    value: stats.inflection.toString(),                                                     sub: 'institutional buy window', color: stats.inflection > 0 ? GREEN : MUTED },
          { label: 'BEST CAND.',         value: stats.best.toString(),                                                           sub: 'survival≥6 · concall≥15', color: stats.best > 0 ? GREEN : MUTED },
          { label: 'CONVICTION',         value: stats.convictionOverlap.toString(),                                              sub: 'overlap with your bench', color: stats.convictionOverlap > 0 ? PURPLE : MUTED },
        ].map((s) => (
          <div key={s.label} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: 0.6 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, fontFamily: 'ui-monospace,monospace', marginTop: 2 }}>{s.value}</div>
            {s.sub && <div style={{ fontSize: 9, color: MUTED, marginTop: 2, letterSpacing: 0.3 }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── STAGE + ARCHETYPE DISTRIBUTIONS ─────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14, marginBottom: 18 }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>STAGE DISTRIBUTION</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>Lifecycle: DISTRESS → EARLY-SHOOTS (BUY-ZONE 1) → PATTERN (BUY-ZONE 2) → CONFIRMED → MATURE</div>
          {stats.stageBuckets.map(b => {
            const pct = stats.n ? (100 * b.n / stats.n) : 0;
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 18, fontSize: 14 }}>{b.emoji}</div>
                <div style={{ width: 130, fontSize: 11, color: TEXT, fontWeight: 700 }}>{b.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color }} />
                </div>
                <div style={{ width: 56, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{b.n} · {pct.toFixed(0)}%</div>
              </div>
            );
          })}
        </div>

        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>ARCHETYPE BREAKDOWN</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>What each row really IS — non-TURNAROUND archetypes belong on different tabs</div>
          {stats.archetypeBuckets.map(b => {
            const pct = stats.n ? (100 * b.n / stats.n) : 0;
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 100, fontSize: 11, color: b.color, fontWeight: 700 }}>{b.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color }} />
                </div>
                <div style={{ width: 56, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{b.n} · {pct.toFixed(0)}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── TYPE + PHASE + SURVIVAL ─────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 18 }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>TURNAROUND TYPE</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>Cyclical = sector-driven · Operational = mgmt-driven · Distressed = balance-sheet first</div>
          {stats.typeAllUnknown ? (
            <div style={{ fontSize: 11, color: ORANGE, padding: '10px 12px', background: `${ORANGE}10`, border: `1px solid ${ORANGE}40`, borderRadius: 6, lineHeight: 1.5 }}>
              <strong>Data missing.</strong> All rows classified UNKNOWN. The type classifier needs: <span style={{ color: TEXT }}>Loss-making years 5y</span>, <span style={{ color: TEXT }}>OPM history (Y2-Y5)</span>, and <span style={{ color: TEXT }}>D/E history</span>. Add these as custom Screener.in ratios and re-upload.
            </div>
          ) : stats.typeBuckets.map(b => {
            const pct = stats.n ? (100 * b.n / stats.n) : 0;
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 100, fontSize: 11, color: TEXT, fontWeight: 700 }}>{b.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color }} />
                </div>
                <div style={{ width: 36, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{b.n}</div>
              </div>
            );
          })}
        </div>

        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>PLAYBOOK PHASE</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>Phase 3 is the institutional BUY window — alpha before consensus</div>
          {stats.phaseAllZero ? (
            <div style={{ fontSize: 11, color: ORANGE, padding: '10px 12px', background: `${ORANGE}10`, border: `1px solid ${ORANGE}40`, borderRadius: 6, lineHeight: 1.5 }}>
              <strong>Data missing.</strong> Phase classifier returned 0 for every row. It needs <span style={{ color: TEXT }}>5-year sales/PAT/OPM history</span> + <span style={{ color: TEXT }}>concall paste-text</span> per row (the Turnarounds tab has a per-row concall input — paste the latest transcript or guidance bullets there).
            </div>
          ) : stats.phaseBuckets.map(b => {
            const pct = stats.n ? (100 * b.n / stats.n) : 0;
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 140, fontSize: 11, color: b.color, fontWeight: 700 }}>{b.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color }} />
                </div>
                <div style={{ width: 36, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{b.n}</div>
              </div>
            );
          })}
        </div>

        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>SURVIVAL SCORE</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>Playbook Ch.4 gate — ≥6 = cleared institutional bankruptcy filter</div>
          {stats.survivalAllFragile ? (
            <div style={{ fontSize: 11, color: ORANGE, padding: '10px 12px', background: `${ORANGE}10`, border: `1px solid ${ORANGE}40`, borderRadius: 6, lineHeight: 1.5 }}>
              <strong>Data missing.</strong> Survival ≡ 0 for every row. Add <span style={{ color: TEXT }}>Interest coverage ratio</span>, <span style={{ color: TEXT }}>Pledged percentage</span>, and <span style={{ color: TEXT }}>D/E (current)</span> columns from Screener.in and re-upload to populate the bankruptcy-gate score.
            </div>
          ) : stats.survivalBuckets.map(b => {
            const pct = stats.n ? (100 * b.n / stats.n) : 0;
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 110, fontSize: 11, color: TEXT, fontWeight: 700 }}>{b.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color }} />
                </div>
                <div style={{ width: 36, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{b.n}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── BEST CANDIDATES + DECISION OVERLAY ─────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 18 }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: GREEN, marginBottom: 4 }}>⭐ BEST CANDIDATES ({stats.bestList.length})</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 10 }}>Pass: archetype = TURNAROUND · survival ≥6 · phase 2-3 · concall ≥15</div>
          {stats.bestList.length === 0 && <div style={{ fontSize: 11, color: MUTED, padding: 12, textAlign: 'center' }}>No row passes the institutional best-candidate filter today.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stats.bestList.slice(0, 10).map(r => {
              const d = getDecision(r.symbol);
              const inCb = convictionSet.has(r.symbol.toUpperCase());
              return (
                <div key={r.symbol} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#0a0a0f', borderRadius: 6 }}>
                  <div style={{ width: 110, fontSize: 12, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace,monospace' }}>{r.symbol}</div>
                  <div style={{ flex: 1, fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.company}>{r.company}</div>
                  <div style={{ fontSize: 10, color: r.stageColor, padding: '2px 6px', background: `${r.stageColor}20`, borderRadius: 4, fontWeight: 700 }}>{r.stageEmoji} {r.stage}</div>
                  <div style={{ fontSize: 10, color: ACCENT, padding: '2px 6px', background: `${ACCENT}20`, borderRadius: 4, fontWeight: 700 }}>P{r.phase}</div>
                  <div style={{ width: 50, fontSize: 12, color: TEXT, fontFamily: 'ui-monospace,monospace', fontWeight: 800, textAlign: 'right' }}>{(r.totalScore || 0).toFixed(0)}</div>
                  {d && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: d.status === 'BUY' ? `${GREEN}30` : d.status === 'WATCH' ? `${YELLOW}30` : `${RED}30`, color: d.status === 'BUY' ? GREEN : d.status === 'WATCH' ? YELLOW : RED, fontWeight: 700 }}>{d.status}</span>}
                  {inCb && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: `${PURPLE}30`, color: PURPLE, fontWeight: 700 }}>CB</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 12 }}>DECISION OVERLAY</div>
          {[
            { label: 'BUY',      n: stats.decisionCounts.BUY,      color: GREEN },
            { label: 'WATCH',    n: stats.decisionCounts.WATCH,    color: YELLOW },
            { label: 'REJECTED', n: stats.decisionCounts.REJECTED, color: RED },
            { label: 'No tag',   n: stats.decisionCounts.NONE,     color: MUTED },
          ].map(d => {
            const pct = stats.n ? (100 * d.n / stats.n) : 0;
            return (
              <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 64, fontSize: 11, color: d.color, fontWeight: 700 }}>{d.label}</div>
                <div style={{ flex: 1, height: 10, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: d.color }} />
                </div>
                <div style={{ width: 50, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{d.n}</div>
              </div>
            );
          })}
          <div style={{ marginTop: 12, padding: 10, background: '#0a0a0f', borderRadius: 6, fontSize: 11, color: MUTED }}>
            Decision coverage: <span style={{ color: TEXT, fontWeight: 700 }}>{stats.n ? (100 * (stats.n - stats.decisionCounts.NONE) / stats.n).toFixed(0) : 0}%</span>
          </div>
        </div>
      </div>

      {/* ── TOP 12 BY TOTAL SCORE ───────────────────────────────── */}
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 12 }}>TOP 12 BY TOTAL SCORE</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: MUTED, textAlign: 'left' }}>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>#</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>SYMBOL</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>COMPANY</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>STAGE</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>PHASE</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>TYPE</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>SCORE</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>GRADE</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>CONCALL</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>SURVIVAL</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>TAGS</th>
              </tr>
            </thead>
            <tbody>
              {stats.top12.map((r, i) => {
                const d = getDecision(r.symbol);
                const inCb = convictionSet.has(r.symbol.toUpperCase());
                return (
                  <tr key={r.symbol} style={{ color: TEXT }}>
                    <td style={{ padding: '6px 8px', color: MUTED, fontFamily: 'ui-monospace,monospace' }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px', fontWeight: 700, fontFamily: 'ui-monospace,monospace' }}>{r.symbol}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: MUTED, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.company}>{r.company}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: r.stageColor, fontWeight: 700 }}>{r.stageEmoji} {r.stage}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: ACCENT, fontWeight: 700 }}>{r.phase ? `P${r.phase}` : '—'}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: MUTED }}>{r.turnaroundType || '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', fontWeight: 800 }}>{(r.totalScore || 0).toFixed(0)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: GRADE_COLOR_TA[r.grade] || TEXT, fontWeight: 800 }}>{r.grade}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: (r.concallScore ?? -1) >= 15 ? GREEN : MUTED }}>{r.concallScore != null ? r.concallScore.toFixed(0) : '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: (r.survivalScore ?? -1) >= 6 ? GREEN : MUTED }}>{r.survivalScore != null ? r.survivalScore.toFixed(0) : '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      {r.isBestCandidate && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: `${GREEN}30`, color: GREEN, fontWeight: 700, marginLeft: 2 }}>BEST</span>}
                      {d && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: d.status === 'BUY' ? `${GREEN}30` : d.status === 'WATCH' ? `${YELLOW}30` : `${RED}30`, color: d.status === 'BUY' ? GREEN : d.status === 'WATCH' ? YELLOW : RED, fontWeight: 700, marginLeft: 2 }}>{d.status}</span>}
                      {inCb && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: `${PURPLE}30`, color: PURPLE, fontWeight: 700, marginLeft: 2 }}>CB</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
