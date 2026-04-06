/**
 * /api/market/multibagger  v2 — Institutional 5-Pillar Scoring Engine
 *
 * Architecture:
 *  1. Data fetch (screener.in + NSE) with validation
 *  2. Data-quality layer: reject/flag bad rows, compute coverage + confidence
 *  3. Peer normalization: sector percentile ranking
 *  4. 5-pillar scoring: Quality(30%) Growth(25%) FinStrength(20%) Valuation(15%) Market(10%)
 *  5. Red-flag override: severe flags cap final grade
 *  6. Debug output: raw → normalized → pillar → final
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchStockQuote, fetchCompanyFinancialResults, fetchPriceWithFallback } from '@/lib/nse';
import { kvGet, kvSet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// ── Safe formatting helpers ───────────────────────────────────────────────────
function safeFixed(v: unknown, decimals = 2, fallback = 'N/A'): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(decimals) : fallback;
}
function safePct(v: unknown, decimals = 1, fallback = 'N/A'): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(decimals)}%` : fallback;
}
function safeCurrency(v: unknown, fallback = 'N/A'): string {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
    ? `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(v)}`
    : fallback;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Signal = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'CAUTION' | 'AVOID';
type Grade  = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'NR';

interface CriterionDetail {
  id: string;
  label: string;
  pillar: 'QUALITY' | 'GROWTH' | 'FIN_STRENGTH' | 'VALUATION' | 'MARKET';
  rawValue: number | null;
  rawDisplay: string;
  sectorPercentile: number | null;    // 0-100 within peer group
  score: number;                      // 0-100 normalized
  signal: Signal;
  weight: number;                     // within-pillar weight
  insight: string;
  dataAvailable: boolean;
}

interface PillarScore {
  id: string;
  label: string;
  weight: number;   // portfolio weight 0-1
  score: number;    // 0-100
  coverage: number; // fraction of criteria with data
  topStrength: string;
  topRisk: string;
}

interface RedFlag {
  id: string;
  label: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  detail: string;
}

interface DataQuality {
  valid: boolean;
  reason: string | null;
  coveragePct: number;    // % criteria with real data
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
  source: 'screener.in + NSE' | 'NSE only' | 'partial' | 'none' | 'Static' | string;
  fetchedAt: string;
  staleness: 'FRESH' | 'STALE' | 'UNKNOWN';
}

interface MultibaggerResult {
  symbol: string;
  company: string;
  sector: string;
  sectorGroup: string;
  lastPrice: number | null;
  marketCapCr: number | null;
  overallScore: number;
  scoreRange?: { low: number; high: number };
  grade: Grade;
  pillars: PillarScore[];
  criteria: CriterionDetail[];
  redFlags: RedFlag[];
  quality: DataQuality;
  isPortfolio: boolean;
  isWatchlist: boolean;
  _debug?: Record<string, any>;
  errors: string[];
}

// ── Sector groupings for peer normalization ───────────────────────────────────
const SECTOR_GROUPS: Record<string, string> = {
  // Technology
  'IT': 'TECHNOLOGY', 'Technology': 'TECHNOLOGY', 'Software': 'TECHNOLOGY',
  'Computers - Software & Consulting': 'TECHNOLOGY', 'IT Enabled Services': 'TECHNOLOGY',
  'Computers Hardware & Equipments': 'TECHNOLOGY', 'IT Services': 'TECHNOLOGY',
  'Computer Software': 'TECHNOLOGY', 'Information Technology': 'TECHNOLOGY',
  // Pharma & Healthcare
  'Pharmaceuticals': 'PHARMA', 'Pharma': 'PHARMA', 'Healthcare': 'PHARMA', 'Hospitals': 'PHARMA',
  'Healthcare Services': 'PHARMA', 'Medical Devices': 'PHARMA',
  // Banking & Finance
  'Banking': 'BANKING_FIN', 'Financial Services': 'BANKING_FIN', 'NBFC': 'BANKING_FIN', 'Insurance': 'BANKING_FIN',
  'Banks': 'BANKING_FIN', 'Finance': 'BANKING_FIN',
  // Industrials
  'Capital Goods': 'INDUSTRIALS', 'Engineering': 'INDUSTRIALS', 'Industrial Machinery': 'INDUSTRIALS',
  'Industrial Products': 'INDUSTRIALS', 'Industrial Manufacturing': 'INDUSTRIALS',
  'Other Industrial Products': 'INDUSTRIALS', 'Heavy Electrical Equipment': 'INDUSTRIALS',
  'Compressors Pumps & Diesel Engines': 'INDUSTRIALS', 'Industrial Minerals': 'INDUSTRIALS',
  'Other Electrical Equipment': 'INDUSTRIALS', 'Cables': 'INDUSTRIALS',
  'Cables - Electricals': 'INDUSTRIALS', 'Dredging': 'INDUSTRIALS',
  // Infra & Construction
  'Infrastructure': 'INFRA', 'Cement': 'INFRA', 'Construction': 'INFRA',
  'Port & Port services': 'INFRA', 'Shipping': 'INFRA',
  // Consumer
  'Consumer Goods': 'CONSUMER', 'FMCG': 'CONSUMER', 'Retail': 'CONSUMER', 'Food Processing': 'CONSUMER',
  'Personal Care': 'CONSUMER', 'Consumer Durables': 'CONSUMER', 'Consumer Electronics': 'CONSUMER',
  'Tea & Coffee': 'CONSUMER', 'Other Food Products': 'CONSUMER', 'Other Textile Products': 'CONSUMER',
  // Auto
  'Automobile': 'AUTO', 'Auto Components': 'AUTO', 'Electric Vehicles': 'AUTO',
  'Automobiles': 'AUTO', 'Auto Ancillaries': 'AUTO',
  'Auto Components & Equipments': 'AUTO',
  // Chemicals
  'Chemicals': 'CHEMICALS', 'Specialty Chemicals': 'CHEMICALS', 'Agrochemicals': 'CHEMICALS',
  // Defence / Aerospace / Renewables (Sunrise)
  'Defence': 'SUNRISE', 'Defense': 'SUNRISE', 'Aerospace': 'SUNRISE',
  'Aerospace & Defense': 'SUNRISE', 'Aerospace & Defence': 'SUNRISE',
  'Renewable Energy': 'SUNRISE', 'Clean Energy': 'SUNRISE', 'Solar': 'SUNRISE',
  // Telecom
  'Telecommunications': 'SUNRISE', 'Telecom': 'TELECOM',
  'Telecom - Infrastructure': 'TELECOM',
  // Metals
  'Metals': 'METALS', 'Steel': 'METALS', 'Mining': 'METALS',
  'Iron & Steel Products': 'METALS',
  // Energy & Power
  'Oil & Gas': 'ENERGY', 'Energy': 'ENERGY', 'Power': 'ENERGY',
  // Realty
  'Real Estate': 'REALTY', 'Realty': 'REALTY',
  // Water / Environment
  'Water Supply & Management': 'INFRA',
};

function getSectorGroup(sector: string): string {
  // Direct match
  if (SECTOR_GROUPS[sector]) return SECTOR_GROUPS[sector];
  // Fuzzy match: check if any key is a substring of the sector or vice versa
  const sLower = sector.toLowerCase();
  for (const [key, group] of Object.entries(SECTOR_GROUPS)) {
    const kLower = key.toLowerCase();
    if (sLower.includes(kLower) || kLower.includes(sLower)) return group;
  }
  return 'OTHER';
}

// Sector-specific "fair" benchmarks: [median, good, excellent] for ROCE, OPM, PE etc.
// Used to anchor absolute-to-relative scoring
const SECTOR_BENCHMARKS: Record<string, { roce: number[]; opm: number[]; pe: number[]; revenueGrowth: number[] }> = {
  TECHNOLOGY:   { roce: [20, 28, 38], opm: [18, 25, 35], pe: [25, 35, 55], revenueGrowth: [12, 20, 30] },
  PHARMA:       { roce: [14, 20, 28], opm: [16, 22, 30], pe: [20, 30, 45], revenueGrowth: [10, 16, 25] },
  BANKING_FIN:  { roce: [12, 18, 25], opm: [30, 40, 55], pe: [12, 18, 28], revenueGrowth: [12, 18, 25] },
  INDUSTRIALS:  { roce: [12, 18, 25], opm: [10, 14, 20], pe: [18, 28, 42], revenueGrowth: [10, 16, 25] },
  INFRA:        { roce: [10, 14, 20], opm: [8,  12, 18], pe: [20, 30, 45], revenueGrowth: [10, 15, 22] },
  CONSUMER:     { roce: [18, 25, 35], opm: [12, 18, 28], pe: [28, 40, 60], revenueGrowth: [8,  14, 22] },
  AUTO:         { roce: [14, 20, 28], opm: [8,  12, 18], pe: [15, 22, 35], revenueGrowth: [8,  14, 22] },
  CHEMICALS:    { roce: [16, 22, 30], opm: [12, 18, 26], pe: [20, 30, 45], revenueGrowth: [10, 18, 28] },
  SUNRISE:      { roce: [10, 16, 24], opm: [10, 16, 24], pe: [30, 50, 80], revenueGrowth: [20, 35, 55] },
  TELECOM:      { roce: [10, 14, 20], opm: [25, 35, 48], pe: [20, 35, 55], revenueGrowth: [6,  12, 20] },
  METALS:       { roce: [12, 18, 26], opm: [10, 16, 24], pe: [8,  14, 22], revenueGrowth: [5,  12, 22] },
  ENERGY:       { roce: [10, 14, 20], opm: [8,  14, 22], pe: [8,  13, 20], revenueGrowth: [5,  10, 18] },
  REALTY:       { roce: [10, 14, 20], opm: [20, 28, 38], pe: [18, 28, 42], revenueGrowth: [8,  16, 28] },
  OTHER:        { roce: [12, 18, 25], opm: [10, 15, 22], pe: [18, 28, 42], revenueGrowth: [8,  14, 22] },
};

// ── Retry with exponential backoff ───────────────────────────────────────────
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2, baseDelayMs = 300): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err as Error;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt); // 300, 600, 1200ms
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ── Screener.in HTML scraper ──────────────────────────────────────────────────
async function fetchScreenerData(symbol: string): Promise<{ data: Record<string, any>; ok: boolean; url: string }> {
  const encodedSymbol = encodeURIComponent(symbol);
  const urls = [
    `https://www.screener.in/company/${encodedSymbol}/consolidated/`,
    `https://www.screener.in/company/${encodedSymbol}/`,
  ];
  // Try each URL with generous timeout + one retry on timeout
  for (const url of urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const timeout = attempt === 0 ? 10000 : 12000; // 10s first, 12s retry
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0', 'Accept': 'text/html,application/xhtml+xml' },
          signal: AbortSignal.timeout(timeout),
        });
        if (!resp.ok) break; // 4xx/5xx → try next URL, don't retry
        const html = await resp.text();
        if (html.includes('Page not found') || html.includes('No results found')) break; // wrong symbol → next URL
        if (html.length < 3000) continue; // too small → retry
        return { data: parseScreenerHTML(html, symbol), ok: true, url };
      } catch {
        if (attempt === 0) await new Promise(r => setTimeout(r, 500)); // brief delay before retry
        continue;
      }
    }
  }
  return { data: {}, ok: false, url: '' };
}

function num(text: string | null | undefined): number | null {
  if (!text) return null;
  const v = parseFloat(text.replace(/,/g, '').replace(/%/g, '').trim());
  return isNaN(v) ? null : v;
}

function parseScreenerHTML(html: string, symbol: string): Record<string, any> {
  const d: Record<string, any> = { symbol };

  // Extract from #top-ratios section (standard screener layout)
  const ratioSection = html.match(/<section[^>]*id="top-ratios"[^>]*>([\s\S]*?)<\/section>/i)?.[1] || html;

  // Pattern 1: <li><span class="name">Label</span><span class="number">Value</span></li>
  const ratioRe = /<li[^>]*>[\s\S]*?<span[^>]*class="[^"]*name[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]*class="[^"]*number[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
  let m: RegExpExecArray | null;
  const ratios: Record<string, number | null> = {};
  while ((m = ratioRe.exec(ratioSection)) !== null) {
    const label = m[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
    const val   = num(m[2].replace(/<[^>]+>/g, '').trim());
    if (label && val !== null) ratios[label] = val;
  }

  // Pattern 2: data-source or newer screener.in layout with <span class="name">...<span class="value">
  const altRe = /<span[^>]*class="[^"]*name[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]{0,200}?<span[^>]*class="[^"]*(?:number|value|nowrap)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
  while ((m = altRe.exec(html)) !== null) {
    const label = m[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
    const val   = num(m[2].replace(/<[^>]+>/g, '').trim());
    if (label && val !== null && !ratios[label]) ratios[label] = val;
  }

  // Pattern 3: "Label\n  Value" in <td> format (screener's ratio table)
  const tdRe = /<td[^>]*>\s*([\w\s\/&]+?)\s*<\/td>\s*<td[^>]*>\s*([\d,.%-]+)\s*<\/td>/gi;
  while ((m = tdRe.exec(html)) !== null) {
    const label = m[1].trim().toLowerCase();
    const val   = num(m[2].trim());
    if (label && val !== null && !ratios[label]) ratios[label] = val;
  }

  // Map labels to our fields
  const get = (...keys: string[]): number | null => {
    for (const k of keys) {
      const found = Object.keys(ratios).find(r => r.includes(k.toLowerCase()));
      if (found !== undefined && ratios[found] !== null) return ratios[found]!;
    }
    return null;
  };

  d.pe           = get('stock p/e', 'p/e', 'pe ratio', 'price to earning');
  d.roe          = get('return on equity', 'roe');
  d.roce         = get('roce', 'return on capital');
  d.de           = get('debt to equity', 'd/e', 'debt / equity');
  d.bookValue    = get('book value');
  d.eps          = get('eps', 'earning per', 'earnings per share');
  d.dividendYield= get('dividend yield', 'div yield');
  d.opm          = get('opm', 'operating profit margin', 'operating margin');
  d.priceToBook  = get('price to book', 'p/b', 'pb ratio');
  d.marketCapCr  = get('market cap', 'market capitalization');
  d.salesGrowth  = get('sales growth', 'revenue growth');
  d.currentRatio = get('current ratio');
  d.interestCoverage = get('interest coverage', 'icr');

  // Promoter holding — from shareholding section
  const promoterRe = /Promoters?[\s\S]{0,300}?(\d{1,3}\.?\d*)\s*%/i;
  const pm = html.match(promoterRe);
  d.promoterPct = pm ? num(pm[1]) : null;

  // Pledged % — often shown as sub-item under promoter
  const pledgeRe = /[Pp]ledged[\s\S]{0,200}?(\d{1,3}\.?\d*)\s*%/;
  const plm = html.match(pledgeRe);
  d.pledgedPct = plm ? num(plm[1]) : null;

  // 5-yr CAGR: look for CAGR tables — multiple patterns
  const salesCagrRe = /(?:[Ss]ales|[Rr]evenue)\s*(?:growth\s*)?CAGR[\s\S]{0,150}?(-?\d{1,3}\.?\d*)/;
  const scm = html.match(salesCagrRe);
  d.salesCagr5yr = scm ? num(scm[1]) : null;
  // Alt pattern: "Compounded Sales Growth" in screener tables
  if (d.salesCagr5yr === null) {
    const altSales = html.match(/[Cc]ompounded\s+[Ss]ales\s+[Gg]rowth[\s\S]{0,200}?(-?\d{1,3}\.?\d*)\s*%/);
    if (altSales) d.salesCagr5yr = num(altSales[1]);
  }

  const profitCagrRe = /[Pp]rofit\s*(?:growth\s*)?CAGR[\s\S]{0,150}?(-?\d{1,3}\.?\d*)/;
  const pcm = html.match(profitCagrRe);
  d.profitCagr5yr = pcm ? num(pcm[1]) : null;
  // Alt pattern: "Compounded Profit Growth"
  if (d.profitCagr5yr === null) {
    const altProfit = html.match(/[Cc]ompounded\s+[Pp]rofit\s+[Gg]rowth[\s\S]{0,200}?(-?\d{1,3}\.?\d*)\s*%/);
    if (altProfit) d.profitCagr5yr = num(altProfit[1]);
  }

  // Cash flow from operations
  const cfoRe = /Cash from [Oo]perat[\s\S]{0,60}?([+-]?\s*[\d,]+)/;
  const cfom = html.match(cfoRe);
  const cfoVal = cfom ? num(cfom[1]) : null;
  d.cfoPositive = cfoVal !== null ? cfoVal > 0 : null;
  d.cfoValue = cfoVal;

  // Quarterly revenue trend
  const qtrTableRe = /<table[\s\S]*?[Qq]uarterly[\s\S]*?<\/table>/i;
  const qtrTable = html.match(qtrTableRe)?.[0] || '';
  const qtrNums = [...qtrTable.matchAll(/<td[^>]*>\s*([\d,]+)\s*<\/td>/g)]
    .map(x => num(x[1])).filter((v): v is number => v !== null && v > 100);
  if (qtrNums.length >= 4) {
    // Revenue QoQ growth (latest vs prior quarter)
    d.revenueGrowthQoQ = ((qtrNums[0] - qtrNums[1]) / Math.abs(qtrNums[1])) * 100;
    // YoY (latest vs 4 quarters ago)
    if (qtrNums[4]) d.revenueGrowthYoY = ((qtrNums[0] - qtrNums[4]) / Math.abs(qtrNums[4])) * 100;
  }

  // Net profit margin
  const npmRe = /[Nn]et [Pp]rofit[^%]{0,100}?(\d{1,3}\.?\d*)\s*%/;
  const npm = html.match(npmRe);
  d.npm = npm ? num(npm[1]) : null;

  // Working capital / receivables days
  const recRe = /[Dd]ebtor [Dd]ays[\s\S]{0,100}?(\d{1,4})/;
  const rec = html.match(recRe);
  d.debtorDays = rec ? num(rec[1]) : null;

  // Verify data quality: flag if PE is absurd
  if (d.pe !== null && (d.pe < 0.5 || d.pe > 5000)) d.pe = null;
  if (d.marketCapCr !== null && d.marketCapCr < 1) d.marketCapCr = null;

  return d;
}

// ── NSE Quote fetcher (cookie-based via nse.ts library) ───────────────────────
async function fetchNSEData(symbol: string): Promise<{ data: Record<string, any>; ok: boolean }> {
  try {
    // Primary: NSE cookie-based fetch (handles cookie refresh + retry)
    const json = await fetchStockQuote(symbol);
    if (json) {
      const info = json?.priceInfo || {};
      const meta = json?.metadata || {};
      const secInfo = json?.securityInfo || {};
      const h52  = info?.weekHighLow?.max ?? info['52WeekHigh'];
      const l52  = info?.weekHighLow?.min ?? info['52WeekLow'];
      const lp   = info.lastPrice;
      if (lp && lp > 0) {
        return {
          ok: true,
          data: {
            lastPrice:   lp,
            high52:      h52 ?? null,
            low52:       l52 ?? null,
            pctFrom52H:  (h52 && lp) ? ((lp / h52) - 1) * 100 : null,
            pctFrom52L:  (l52 && lp) ? ((lp - l52) / l52) * 100 : null,
            pChange:     info.pChange ?? null,
            volume:      info.totalTradedVolume ?? null,
            sector:      meta.industry ?? meta.sector ?? null,
            companyName: meta.companyName ?? null,
            series:      meta.series ?? null,
            marketCapCr: secInfo.issuedSize && lp ? Math.round((secInfo.issuedSize * lp) / 10000000) : null,
            pe:          json?.priceInfo?.pe ?? null,
            faceValue:   secInfo.faceValue ?? null,
          }
        };
      }
    }
  } catch {}

  // Fallback: fetchPriceWithFallback (NSE → BSE → MoneyControl → Redis)
  try {
    const priceData = await fetchPriceWithFallback(symbol);
    if (priceData.price && priceData.price > 0) {
      return {
        ok: true,
        data: {
          lastPrice: priceData.price,
          high52: null, low52: null,
          pctFrom52H: null, pctFrom52L: null,
          pChange: null, volume: null,
          sector: null, companyName: null,
          series: null, marketCapCr: null,
          _priceSource: priceData.source,
        }
      };
    }
  } catch {}

  return { data: {}, ok: false };
}

// ── NSE Financial Results fetcher — fundamental data fallback ─────────────────
async function fetchNSEFinancials(symbol: string): Promise<Record<string, any>> {
  try {
    const results = await fetchCompanyFinancialResults(symbol);
    if (!results) return {};
    // Financial results come as array of quarterly results
    const rows = Array.isArray(results) ? results : results?.results || results?.data || [];
    if (!rows.length) return {};
    // Sort by date descending
    const sorted = rows.sort((a: any, b: any) => {
      const da = new Date(a.re_broadcastDate || a.broadcastDate || a.period || '').getTime();
      const db = new Date(b.re_broadcastDate || b.broadcastDate || b.period || '').getTime();
      return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da);
    });

    // Get at least 5 quarters for YoY analysis
    const latest = sorted[0] || {};
    const prev4q = sorted.length > 4 ? sorted[4] : (sorted.length > 1 ? sorted[sorted.length - 1] : {});

    // Extract latest quarter metrics
    const revenue = parseFloat(latest.income || latest.turnover || '0');
    const profit  = parseFloat(latest.netProfit || latest.proLossAftTax || '0');
    const eps     = parseFloat(latest.reDilEPS || latest.dilutedEps || latest.eps || '0');
    const expenditure = parseFloat(latest.expenditure || '0');

    // Extract Q-1 metrics for QoQ
    const prevQtr = sorted[1] || {};
    const prevRev = parseFloat(prevQtr.income || prevQtr.turnover || '0');
    const prevProfit = parseFloat(prevQtr.netProfit || prevQtr.proLossAftTax || '0');

    // Extract Y-1 (4 quarters back) metrics for YoY
    const prevYearRev = parseFloat(prev4q.income || prev4q.turnover || '0');
    const prevYearProfit = parseFloat(prev4q.netProfit || prev4q.proLossAftTax || '0');
    const prevYearEps = parseFloat(prev4q.reDilEPS || prev4q.dilutedEps || prev4q.eps || '0');

    const d: Record<string, any> = {};

    // QoQ Growth
    if (revenue > 0 && prevRev > 0) {
      d.revenueGrowthQoQ = ((revenue - prevRev) / prevRev) * 100;
    }
    if (profit > 0 && prevProfit > 0) {
      d.profitGrowthQoQ = ((profit - prevProfit) / prevProfit) * 100;
    }

    // YoY Growth (same quarter, 1 year apart)
    if (revenue > 0 && prevYearRev > 0) {
      d._revenueGrowthYoY = ((revenue - prevYearRev) / prevYearRev) * 100;
    }
    if (profit > 0 && prevYearProfit > 0) {
      d._profitGrowthYoY = ((profit - prevYearProfit) / prevYearProfit) * 100;
    }
    if (eps > 0 && prevYearEps > 0) {
      d._epsGrowthYoY = ((eps - prevYearEps) / prevYearEps) * 100;
    }

    // Margins
    if (profit > 0 && revenue > 0) {
      d.npm = (profit / revenue) * 100;
    }
    if (expenditure > 0 && revenue > 0) {
      d.opm = ((revenue - expenditure) / revenue) * 100;
    }

    // EPS
    if (eps > 0) d.eps = eps;

    // CAGR over available quarters (if 5+ quarters available)
    if (sorted.length >= 5) {
      const oldestQuarter = sorted[sorted.length - 1];
      const oldestRev = parseFloat(oldestQuarter.income || oldestQuarter.turnover || '0');
      const oldestProfit = parseFloat(oldestQuarter.netProfit || oldestQuarter.proLossAftTax || '0');

      const periods = Math.min(sorted.length - 1, 4); // 4 quarters = 1 year
      if (periods > 0 && oldestRev > 0 && revenue > 0) {
        const revCagr = (Math.pow(revenue / oldestRev, 1 / periods) - 1) * 100;
        d._revenueCagr5yr = revCagr;
      }
      if (periods > 0 && oldestProfit > 0 && profit > 0) {
        const profitCagr = (Math.pow(profit / oldestProfit, 1 / periods) - 1) * 100;
        d._profitCagr5yr = profitCagr;
      }
    }

    // Also store raw values for reference
    d._revenue = revenue;
    d._netProfit = profit;
    d._quarter = latest.period || latest.broadcastDate || '';
    d._quarterCount = sorted.length;
    return d;
  } catch { return {}; }
}

// ── Yahoo Finance fallback for fundamental data ──────────────────────────────
async function fetchYahooData(symbol: string): Promise<{ data: Record<string, any>; ok: boolean }> {
  try {
    // Yahoo uses .NS suffix for NSE symbols
    const yahooSymbol = `${symbol}.NS`;
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}?modules=defaultKeyStatistics,financialData,summaryDetail,price`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketCockpit/2.0)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return { data: {}, ok: false };
    const json = await resp.json();
    const result = json?.quoteSummary?.result?.[0];
    if (!result) return { data: {}, ok: false };

    const keyStats = result.defaultKeyStatistics || {};
    const fin = result.financialData || {};
    const summary = result.summaryDetail || {};
    const price = result.price || {};

    const d: Record<string, any> = {};
    d.pe = summary.trailingPE?.raw ?? null;
    d.roe = fin.returnOnEquity?.raw ? fin.returnOnEquity.raw * 100 : null;
    d.de = fin.debtToEquity?.raw ? fin.debtToEquity.raw / 100 : null; // Yahoo returns as %, we need ratio
    d.currentRatio = fin.currentRatio?.raw ?? null;
    d.opm = fin.operatingMargins?.raw ? fin.operatingMargins.raw * 100 : null;
    d.npm = fin.profitMargins?.raw ? fin.profitMargins.raw * 100 : null;
    d.bookValue = keyStats.bookValue?.raw ?? null;
    d.priceToBook = keyStats.priceToBook?.raw ?? summary.priceToBook?.raw ?? null;
    d.eps = keyStats.trailingEps?.raw ?? null;
    d.dividendYield = summary.dividendYield?.raw ? summary.dividendYield.raw * 100 : null;
    d.marketCapCr = price.marketCap?.raw ? Math.round(price.marketCap.raw / 10000000) : null;
    d.revenueGrowthYoY = fin.revenueGrowth?.raw ? fin.revenueGrowth.raw * 100 : null;
    // Derive ROCE from available data
    // ROCE = EBIT / Capital Employed. Best proxy chain:
    // 1. ROA (if available) — close to ROCE for low-debt companies
    // 2. EBIT margin * Asset turnover — if we have operating margins + revenue + assets
    // 3. ROE adjusted for leverage — weakest proxy
    const roa = fin.returnOnAssets?.raw;
    if (roa) {
      // ROA is ~ROCE for companies with moderate debt. Scale up slightly for capital employed vs total assets.
      d.roce = roa * 100 * 1.1; // 10% uplift: capital employed < total assets
    } else if (d.roe !== null && d.de !== null && d.de >= 0) {
      // ROCE ≈ ROE / (1 + D/E) — removes leverage effect from ROE
      // No arbitrary multiplier — cleaner approximation
      d.roce = d.roe / (1 + d.de);
    }
    // Earnings growth from Yahoo
    d.earningsGrowth = fin.earningsGrowth?.raw ? fin.earningsGrowth.raw * 100 : null;
    d.sector = price.sector || null;
    d.companyName = price.longName || price.shortName || null;
    // Beta as proxy for momentum
    d.beta = keyStats.beta?.raw ?? null;
    d._source = 'yahoo';

    return { data: d, ok: true };
  } catch { return { data: {}, ok: false }; }
}

// ── Yahoo v7 quote API — fast, reliable price + basic fundamentals ──────────
async function fetchYahooV7Quote(symbol: string): Promise<{ data: Record<string, any>; ok: boolean }> {
  try {
    const yahooSym = `${symbol}.NS`;
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yahooSym)}&fields=regularMarketPrice,regularMarketPreviousClose,marketCap,trailingPE,epsTrailingTwelveMonths,bookValue,priceToBook,fiftyTwoWeekHigh,fiftyTwoWeekLow,regularMarketChangePercent,longName,shortName,sector,industry`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketCockpit/2.0)' },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return { data: {}, ok: false };
    const json = await resp.json();
    const q = json?.quoteResponse?.result?.[0];
    if (!q || !q.regularMarketPrice) return { data: {}, ok: false };
    const d: Record<string, any> = {};
    d.lastPrice = q.regularMarketPrice;
    d.pe = q.trailingPE ?? null;
    d.eps = q.epsTrailingTwelveMonths ?? null;
    d.bookValue = q.bookValue ?? null;
    d.priceToBook = q.priceToBook ?? null;
    d.marketCapCr = q.marketCap ? Math.round(q.marketCap / 10000000) : null;
    d.high52 = q.fiftyTwoWeekHigh ?? null;
    d.low52 = q.fiftyTwoWeekLow ?? null;
    d.pChange = q.regularMarketChangePercent ?? null;
    d.companyName = q.longName || q.shortName || null;
    d.sector = q.sector || null;
    d._source = 'yahoo_v7';
    return { data: d, ok: true };
  } catch { return { data: {}, ok: false }; }
}

// ── Yahoo v7 with BSE suffix (.BO) — fallback for NSE-missing symbols ──────
async function fetchYahooBSEQuote(symbol: string): Promise<{ data: Record<string, any>; ok: boolean }> {
  try {
    const yahooSym = `${symbol}.BO`;
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yahooSym)}&fields=regularMarketPrice,marketCap,trailingPE,epsTrailingTwelveMonths,bookValue,priceToBook,fiftyTwoWeekHigh,fiftyTwoWeekLow,regularMarketChangePercent,longName,shortName,sector,industry`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketCockpit/2.0)' },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return { data: {}, ok: false };
    const json = await resp.json();
    const q = json?.quoteResponse?.result?.[0];
    if (!q || !q.regularMarketPrice) return { data: {}, ok: false };
    const d: Record<string, any> = {};
    d.lastPrice = q.regularMarketPrice;
    d.pe = q.trailingPE ?? null;
    d.eps = q.epsTrailingTwelveMonths ?? null;
    d.bookValue = q.bookValue ?? null;
    d.priceToBook = q.priceToBook ?? null;
    d.marketCapCr = q.marketCap ? Math.round(q.marketCap / 10000000) : null;
    d.high52 = q.fiftyTwoWeekHigh ?? null;
    d.low52 = q.fiftyTwoWeekLow ?? null;
    d.pChange = q.regularMarketChangePercent ?? null;
    d.companyName = q.longName || q.shortName || null;
    d.sector = q.sector || null;
    d._source = 'yahoo_bse';
    return { data: d, ok: true };
  } catch { return { data: {}, ok: false }; }
}

// ── Google Finance fallback for basic data ───────────────────────────────────
async function fetchGoogleFinanceData(symbol: string): Promise<{ data: Record<string, any>; ok: boolean }> {
  try {
    const url = `https://www.google.com/finance/quote/${encodeURIComponent(symbol)}:NSE`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return { data: {}, ok: false };
    const html = await resp.text();
    if (html.length < 2000) return { data: {}, ok: false };

    const d: Record<string, any> = {};
    // Extract P/E from Google Finance page
    const peMatch = html.match(/P\/E ratio[\s\S]{0,200}?>([\d.]+)</);
    if (peMatch) d.pe = parseFloat(peMatch[1]) || null;
    // Market cap
    const mcapMatch = html.match(/Market cap[\s\S]{0,200}?>([\d,.]+[TBMK]?)</);
    if (mcapMatch) {
      const raw = mcapMatch[1].replace(/,/g, '');
      let val = parseFloat(raw);
      if (raw.endsWith('T')) val *= 100000; // T in INR = lakh Cr → Cr
      else if (raw.endsWith('B')) val *= 100; // Billion INR → Cr
      d.marketCapCr = val > 0 ? Math.round(val) : null;
    }
    // Dividend yield
    const divMatch = html.match(/Dividend yield[\s\S]{0,200}?>([\d.]+)%/);
    if (divMatch) d.dividendYield = parseFloat(divMatch[1]) || null;

    d._source = 'google';
    return { data: d, ok: Object.keys(d).filter(k => !k.startsWith('_')).length > 0 };
  } catch { return { data: {}, ok: false }; }
}

// ── Data Quality validator ────────────────────────────────────────────────────
function validateData(
  symbol: string, company: string, sector: string,
  screener: Record<string, any>, nse: Record<string, any>,
  screenerOk: boolean, nseOk: boolean
): DataQuality {
  const dataPoints = [
    screener.pe, screener.roce, screener.roe, screener.de,
    screener.opm, screener.promoterPct, screener.marketCapCr ?? nse.marketCapCr,
    screener.salesCagr5yr, screener.profitCagr5yr, screener.cfoPositive,
    nse.lastPrice, nse.pctFrom52H, screener.pledgedPct,
  ];
  const available = dataPoints.filter(v => v !== null && v !== undefined).length;
  const coveragePct = Math.round((available / dataPoints.length) * 100);

  // Hard-fail conditions
  if (!symbol || symbol.length < 2) return { valid: false, reason: 'Invalid symbol', coveragePct: 0, confidence: 'VERY_LOW', source: 'none', fetchedAt: new Date().toISOString(), staleness: 'UNKNOWN' };
  // Sector check: warn but don't hard-fail if we have any data at all
  // Some symbols like S&SPOWER have special characters that cause fetch failures
  const hasAnyPrice = (nse.lastPrice && nse.lastPrice > 0) || (screener.lastPrice && screener.lastPrice > 0);
  if ((!sector || sector.length < 3 || sector === 'Unknown') && !hasAnyPrice && !screenerOk) {
    return { valid: false, reason: `Symbol '${symbol}' did not resolve — may have special characters or be unlisted`, coveragePct, confidence: 'VERY_LOW', source: 'none', fetchedAt: new Date().toISOString(), staleness: 'UNKNOWN' };
  }
  if (!hasAnyPrice) return { valid: false, reason: 'Invalid or zero price — symbol may be delisted or mapping error', coveragePct, confidence: 'VERY_LOW', source: screenerOk ? 'partial' : 'none', fetchedAt: new Date().toISOString(), staleness: 'UNKNOWN' };

  // screenerOk here means "any fundamental source" (screener.in OR Yahoo OR NSE financials OR Google)
  const source: DataQuality['source'] = screenerOk && nseOk ? 'screener.in + NSE' : screenerOk ? 'Multi-source' : nseOk ? 'NSE + Yahoo' : 'partial';
  // Relaxed thresholds: NSE-only stocks (23% data) should get LOW not VERY_LOW
  const confidence: DataQuality['confidence'] = coveragePct >= 60 ? 'HIGH' : coveragePct >= 40 ? 'MEDIUM' : coveragePct >= 15 ? 'LOW' : 'VERY_LOW';

  return { valid: true, reason: null, coveragePct, confidence, source, fetchedAt: new Date().toISOString(), staleness: 'FRESH' };
}

// ── Safe arithmetic helpers ───────────────────────────────────────────────────
function safeNum(v: unknown, fallback = 0): number {
  if (typeof v !== 'number' || !isFinite(v) || isNaN(v)) return fallback;
  return v;
}
function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, isFinite(v) ? v : lo));
}

// ── Peer normalization ────────────────────────────────────────────────────────
// Scores a raw metric relative to sector benchmarks [low_threshold, mid_threshold, high_threshold].
// For normal metrics (higher = better): low=25th pct, mid=50th, high=75th.
// For inverted metrics (lower = better, like D/E): pass the same LOW/MID/HIGH thresholds
//   and set inverted=true — internally we flip the comparison so low D/E → high score.
// Returns 0-100 where ≤20 = poor, 50 = sector median, 75 = good, 90+ = excellent.
function peerNormalize(value: number | null | undefined, thresholds: number[], inverted = false): number | null {
  if (value === null || value === undefined || !isFinite(value) || isNaN(value)) return null; // missing → null, NOT neutral
  const [lo, mid, hi] = thresholds.map(safeNum);
  if (lo === mid || mid === hi) return 50; // degenerate benchmarks

  if (!inverted) {
    // Higher value = better score
    if (value >= hi)  return clamp(88 + Math.min(12, (value - hi) * 0.5));
    if (value >= mid) return clamp(72 + ((value - mid) / (hi - mid)) * 16);
    if (value >= lo)  return clamp(50 + ((value - lo) / (mid - lo)) * 22);
    if (value >= lo * 0.5) return clamp(28 + ((value - lo * 0.5) / (lo * 0.5)) * 22);
    return clamp(Math.max(0, (value / (lo * 0.5)) * 28));
  } else {
    // Lower value = better score (D/E, pledging, drawdown etc.)
    // Thresholds given as [comfortable, moderate, tight] meaning [low danger, moderate danger, high danger]
    if (value <= lo)  return clamp(88 + Math.min(12, (lo - value) * 2));
    if (value <= mid) return clamp(72 - ((value - lo) / (mid - lo)) * 22);
    if (value <= hi)  return clamp(50 - ((value - mid) / (hi - mid)) * 22);
    return clamp(Math.max(0, 28 - ((value - hi) / hi) * 28));
  }
}

function peerPercentile(value: number | null | undefined, thresholds: number[], inverted = false): number | null {
  const n = peerNormalize(value, thresholds, inverted);
  return n !== null ? Math.round(clamp(n)) : null;
}

// Signal from score
function sig(score: number): Signal {
  if (score >= 78) return 'STRONG_BUY';
  if (score >= 63) return 'BUY';
  if (score >= 48) return 'NEUTRAL';
  if (score >= 33) return 'CAUTION';
  return 'AVOID';
}

// ── Red-flag detector ─────────────────────────────────────────────────────────
function detectRedFlags(screener: Record<string, any>, nse: Record<string, any>): RedFlag[] {
  const flags: RedFlag[] = [];

  if (screener.de !== null && screener.de > 3.0) {
    flags.push({ id: 'extreme_debt', label: 'Extreme Leverage', severity: 'CRITICAL', detail: `D/E ratio ${safeFixed(screener.de, 2)} — extreme debt load; bankruptcy risk in downturn` });
  } else if (screener.de !== null && screener.de > 2.0) {
    flags.push({ id: 'high_debt', label: 'High Debt', severity: 'HIGH', detail: `D/E ratio ${safeFixed(screener.de, 2)} — debt level significantly limits compounding potential` });
  }

  if (screener.pledgedPct !== null && screener.pledgedPct > 50) {
    flags.push({ id: 'high_pledge', label: 'Critical Pledge Level', severity: 'CRITICAL', detail: `${safeFixed(screener.pledgedPct, 1)}% of promoter shares pledged — forced selling risk` });
  } else if (screener.pledgedPct !== null && screener.pledgedPct > 25) {
    flags.push({ id: 'moderate_pledge', label: 'Elevated Pledging', severity: 'HIGH', detail: `${safeFixed(screener.pledgedPct, 1)}% promoter shares pledged — watch for escalation` });
  }

  if (screener.cfoPositive === false) {
    flags.push({ id: 'negative_cfo', label: 'Negative Operating Cash Flow', severity: 'HIGH', detail: 'Operations burning cash — earnings quality suspect; may require dilution' });
  }

  if (screener.promoterPct !== null && screener.promoterPct < 20) {
    flags.push({ id: 'low_promoter', label: 'Very Low Promoter Holding', severity: 'HIGH', detail: `Only ${safeFixed(screener.promoterPct, 1)}% promoter holding — misaligned incentives` });
  }

  if (screener.roce !== null && screener.roce < 0) {
    flags.push({ id: 'negative_roce', label: 'Negative ROCE', severity: 'CRITICAL', detail: `ROCE ${safeFixed(screener.roce, 1)}% — destroying capital, not creating it` });
  }

  if (screener.pe !== null && screener.pe > 150) {
    flags.push({ id: 'extreme_pe', label: 'Extreme Valuation', severity: 'MEDIUM', detail: `P/E of ${safeFixed(screener.pe, 0)}x — requires exceptional multi-year growth to justify` });
  }

  if (screener.interestCoverage !== null && screener.interestCoverage < 1.5) {
    flags.push({ id: 'low_icr', label: 'Weak Interest Coverage', severity: 'HIGH', detail: `ICR ${safeFixed(screener.interestCoverage, 1)}x — earnings barely cover interest; distress risk` });
  }

  if (nse.pctFrom52H !== null && nse.pctFrom52H < -60) {
    flags.push({ id: 'deep_drawdown', label: 'Deep Drawdown', severity: 'MEDIUM', detail: `${safeFixed(Math.abs(nse.pctFrom52H), 0)}% below 52W high — investigate fundamental reason` });
  }

  return flags;
}

// ── Grade from score + red flags (used as fallback for single-stock queries) ──
function computeGradeAbsolute(score: number, flags: RedFlag[]): Grade {
  const hasCritical = flags.some(f => f.severity === 'CRITICAL');
  const highFlags   = flags.filter(f => f.severity === 'HIGH').length;
  let effectiveScore = score;
  if (hasCritical) effectiveScore = Math.min(effectiveScore, 42);
  if (highFlags >= 2) effectiveScore = Math.min(effectiveScore, 52);
  if (highFlags === 1) effectiveScore = Math.min(effectiveScore, 62);
  if (effectiveScore >= 80) return 'A+';
  if (effectiveScore >= 72) return 'A';
  if (effectiveScore >= 63) return 'B+';
  if (effectiveScore >= 54) return 'B';
  if (effectiveScore >= 42) return 'C';
  return 'D';
}

// ── Forced grade distribution across the full result set ─────────────────────
// A+ = top 5%, A = next 10%, B+ = next 20%, B = middle 30%, C = next 20%, D = bottom 15%
function assignForcedGrades(
  results: Array<{ overallScore: number; grade: Grade; redFlags: RedFlag[]; quality: DataQuality; criteria: CriterionDetail[] }>
): void {
  // Only grade eligible results (valid + sufficient coverage)
  const eligible = results.filter(r => r.grade !== 'NR');
  if (eligible.length === 0) return;

  // Sort descending by score
  const sorted = [...eligible].sort((a, b) => b.overallScore - a.overallScore);
  const n = sorted.length;

  // If only 1-2 stocks, use absolute grading
  if (n <= 2) {
    for (const r of sorted) {
      r.grade = computeGradeAbsolute(r.overallScore, r.redFlags);
    }
    return;
  }

  // Forced distribution boundaries
  const boundaries = [
    { grade: 'A+' as Grade, cumPct: 0.05 },
    { grade: 'A' as Grade, cumPct: 0.15 },
    { grade: 'B+' as Grade, cumPct: 0.35 },
    { grade: 'B' as Grade, cumPct: 0.65 },
    { grade: 'C' as Grade, cumPct: 0.85 },
    { grade: 'D' as Grade, cumPct: 1.0 },
  ];

  for (let i = 0; i < n; i++) {
    const pctile = (i + 1) / n; // percentile position (1-based)
    let assigned: Grade = 'D';
    for (const b of boundaries) {
      if (pctile <= b.cumPct) {
        assigned = b.grade;
        break;
      }
    }
    // Red flag override: CRITICAL caps at C, 2+ HIGH caps at B
    const hasCritical = sorted[i].redFlags.some(f => f.severity === 'CRITICAL');
    const highFlags = sorted[i].redFlags.filter(f => f.severity === 'HIGH').length;
    if (hasCritical && (assigned === 'A+' || assigned === 'A' || assigned === 'B+' || assigned === 'B')) {
      assigned = 'C';
    } else if (highFlags >= 2 && (assigned === 'A+' || assigned === 'A' || assigned === 'B+')) {
      assigned = 'B';
    }
    sorted[i].grade = assigned;
  }
}

// ── 5-Pillar Scoring Engine ───────────────────────────────────────────────────
function buildCriteria(
  screener: Record<string, any>,
  nse: Record<string, any>,
  sectorGroup: string,
  benchmarks: typeof SECTOR_BENCHMARKS[string]
): CriterionDetail[] {
  const criteria: CriterionDetail[] = [];

  const c = (
    id: string, label: string,
    pillar: CriterionDetail['pillar'],
    rawValue: number | null,
    rawDisplay: string,
    scoreRaw: number | null,         // pre-computed score (0-100) if no peer bench; NULL = missing data
    sectorPercentile: number | null,
    weight: number,
    insight: string
  ): void => {
    // dataAvailable: true ONLY if we have real data (scoreRaw !== null)
    // Missing metrics get score=null internally, excluded from pillar averages
    const hasData = scoreRaw !== null && isFinite(scoreRaw) && !isNaN(scoreRaw);
    const score = hasData ? Math.round(clamp(scoreRaw!)) : 0; // 0 for display only; excluded from averages when !hasData
    const pct = sectorPercentile !== null && isFinite(sectorPercentile) ? Math.round(clamp(sectorPercentile)) : null;
    criteria.push({ id, label, pillar, rawValue, rawDisplay, sectorPercentile: pct, score, signal: hasData ? sig(score) : 'NEUTRAL', weight, insight, dataAvailable: hasData });
  };

  // ── QUALITY PILLAR ────────────────────────────────────────────────────────
  const roce = screener.roce;
  if (roce !== null) {
    const s = peerNormalize(roce, benchmarks.roce) ?? 50;
    c('roce', 'ROCE', 'QUALITY', roce, `${safePct(roce, 1)}`, s, peerPercentile(roce, benchmarks.roce), 10,
      roce >= benchmarks.roce[2] ? `Excellent — top quartile ROCE for ${sectorGroup}` : roce >= benchmarks.roce[1] ? 'Good capital efficiency' : roce >= benchmarks.roce[0] ? 'Below sector median — room to improve' : 'Poor ROCE — capital destruction risk');
  } else {
    c('roce', 'ROCE', 'QUALITY', null, 'N/A', null, null, 10, 'ROCE data unavailable — excluded from scoring');
  }

  const roe = screener.roe;
  if (roe !== null) {
    const bm = [benchmarks.roce[0] * 0.9, benchmarks.roce[1] * 0.85, benchmarks.roce[2] * 0.8];
    const s = peerNormalize(roe, bm) ?? 50;
    c('roe', 'ROE', 'QUALITY', roe, `${safePct(roe, 1)}`, s, peerPercentile(roe, bm), 8,
      roe >= 20 ? 'Strong shareholder returns' : roe >= 12 ? 'Adequate ROE' : 'ROE below acceptable — watch reinvestment');
  } else {
    c('roe', 'ROE', 'QUALITY', null, 'N/A', null, null, 8, 'ROE unavailable — excluded from scoring');
  }

  const opm = screener.opm;
  if (opm !== null) {
    const s = peerNormalize(opm, benchmarks.opm) ?? 50;
    c('opm', 'Operating Margin', 'QUALITY', opm, `${safePct(opm, 1)}`, s, peerPercentile(opm, benchmarks.opm), 8,
      opm >= benchmarks.opm[2] ? 'Exceptional margins — pricing power moat' : opm >= benchmarks.opm[1] ? 'Strong operating leverage' : opm >= benchmarks.opm[0] ? 'Sector-average margins' : 'Thin margins vs sector — competitive pressure');
  } else {
    c('opm', 'Operating Margin', 'QUALITY', null, 'N/A', null, null, 8, 'OPM unavailable — excluded from scoring');
  }

  const cfoPos = screener.cfoPositive;
  const cfoScore = cfoPos === true ? 85 : cfoPos === false ? 15 : null;
  c('cfo', 'CFO Quality', 'QUALITY', cfoPos === null ? null : (cfoPos ? 1 : 0), cfoPos === true ? 'Positive' : cfoPos === false ? 'Negative ⚠️' : 'N/A', cfoScore, null, 9,
    cfoPos === true ? 'Real cash generator — earnings quality confirmed' : cfoPos === false ? 'Operations burn cash — earnings may be accounting-only' : 'Cash flow data unavailable — excluded from scoring');

  // Economic Moat (combination of ROCE, OPM, and market cap)
  let moatScore: number;
  let moatLabel: string;
  const mcapCr = screener.marketCapCr ?? nse.marketCapCr;
  if ((roce !== null && roce > 15 && opm !== null && opm > 15 && mcapCr && mcapCr > 5000) ||
      (roce !== null && roce > 18 && opm !== null && opm > 12)) {
    moatScore = 88;
    moatLabel = 'WIDE Moat';
  } else if ((roce !== null && roce > 12) || (opm !== null && opm > 12) || (screener.pe !== null && screener.pe < 18)) {
    moatScore = 65;
    moatLabel = 'NARROW Moat';
  } else if (roce !== null || opm !== null) {
    moatScore = 35;
    moatLabel = 'NO Moat';
  } else {
    moatScore = null as any; // null = no data, excluded from scoring
    moatLabel = 'Unknown';
  }
  const moatRawValue = moatScore === 88 ? 1 : moatScore === 65 ? 0.5 : moatScore === 35 ? 0 : null;
  c('moat', 'Economic Moat', 'QUALITY', moatRawValue, moatLabel, moatScore, null, 7,
    moatScore === 88 ? 'Durable competitive advantage — sustainable excess returns likely' : moatScore === 65 ? 'Sustainable competitive edge — defensible market position' : moatScore === 35 ? 'Limited moat — commodity-like competition' : 'Moat strength unclear — insufficient data (Modelled)');

  // Owner-Operator quality (promoter holding + pledge analysis)
  const promoterOwn = screener.promoterPct;
  const pledge = screener.pledgedPct ?? 0;
  let ownerOpScore: number;
  let ownerOpLabel: string;
  if (promoterOwn !== null) {
    if (promoterOwn > 50 && pledge === 0) {
      ownerOpScore = 90;
      ownerOpLabel = 'Strong Owner-Operator';
    } else if (promoterOwn > 40 && pledge < 5) {
      ownerOpScore = 72;
      ownerOpLabel = 'Moderate Owner-Operator';
    } else if (promoterOwn > 30) {
      ownerOpScore = 55;
      ownerOpLabel = 'Adequate Ownership';
    } else {
      ownerOpScore = 30;
      ownerOpLabel = 'Weak Owner Alignment';
    }
  } else {
    ownerOpScore = null as any; // null = excluded from scoring
    ownerOpLabel = 'Unknown';
  }
  c('owner_op', 'Owner-Operator', 'QUALITY', promoterOwn, ownerOpLabel + (promoterOwn !== null ? ` (${safePct(promoterOwn, 1)})` : ''), ownerOpScore, null, 7,
    ownerOpScore >= 85 ? 'Founder-led with full skin in game — long-term aligned incentives' : ownerOpScore >= 70 ? 'Meaningful owner stake — aligned with minority shareholders' : ownerOpScore >= 50 ? 'Moderate owner holding — governance acceptable' : 'Weak owner alignment — watch for agency costs (Modelled)');

  // Capital allocation composite (ROCE + low D/E + positive CFO)
  let capAllocScore: number;
  if (roce !== null || screener.de !== null) {
    const roceNorm = roce !== null ? peerNormalize(roce, benchmarks.roce) : null;
    const deNorm = screener.de !== null ? peerNormalize(screener.de, [0.5, 1.2, 2.5], true) : null;
    const roceContrib = roceNorm !== null ? roceNorm * 0.4 : 22;
    const deContrib   = deNorm !== null ? deNorm * 0.35 : 17;
    const cfoContrib  = cfoPos === true ? 25 : cfoPos === false ? 5 : 12;
    capAllocScore = roceContrib + deContrib + cfoContrib;
  } else { capAllocScore = null as any; } // null = excluded
  const capAllocRaw = (roce !== null || screener.de !== null) ? capAllocScore : null;
  c('capital_alloc', 'Capital Allocation', 'QUALITY', capAllocRaw, `ROCE ${safeFixed(roce, 0)}% · D/E ${safeFixed(screener.de, 2)} · CFO ${cfoPos === true ? '✓' : cfoPos === false ? '✗' : '?'}`, capAllocScore, null, 9,
    capAllocScore >= 78 ? 'Exemplary capital allocators — rare institutional quality' : capAllocScore >= 63 ? 'Good capital discipline' : 'Capital allocation needs improvement');

  // ── GROWTH PILLAR ─────────────────────────────────────────────────────────
  const revCagr = screener.salesCagr5yr;
  if (revCagr !== null) {
    const s = peerNormalize(revCagr, benchmarks.revenueGrowth) ?? 50;
    c('rev_cagr', 'Revenue CAGR (5yr)', 'GROWTH', revCagr, `${safePct(revCagr, 1)}`, s, peerPercentile(revCagr, benchmarks.revenueGrowth), 9,
      revCagr >= benchmarks.revenueGrowth[2] ? 'Exceptional revenue momentum — market share gains likely' : revCagr >= benchmarks.revenueGrowth[1] ? 'Strong growth — outpacing sector' : revCagr >= benchmarks.revenueGrowth[0] ? 'Sector-average growth' : 'Below-sector growth — needs catalysts');
  } else {
    c('rev_cagr', 'Revenue CAGR (5yr)', 'GROWTH', null, 'N/A', null, null, 9, '5yr revenue CAGR unavailable — excluded from scoring');
  }

  const profCagr = screener.profitCagr5yr;
  if (profCagr !== null) {
    const profBm = [benchmarks.revenueGrowth[0] * 1.3, benchmarks.revenueGrowth[1] * 1.4, benchmarks.revenueGrowth[2] * 1.5];
    const s = peerNormalize(profCagr, profBm) ?? 50;
    c('profit_cagr', 'Profit CAGR (5yr)', 'GROWTH', profCagr, `${safePct(profCagr, 1)}`, s, peerPercentile(profCagr, profBm), 10,
      profCagr >= profBm[2] ? 'Exceptional profit compounding — operating leverage confirmed' : profCagr >= profBm[1] ? 'Profit growing faster than sector' : profCagr >= profBm[0] ? 'Moderate profit growth' : profCagr < 0 ? 'Profit declining — earnings reversal risk' : 'Profit growth lagging sector');
  } else {
    c('profit_cagr', 'Profit CAGR (5yr)', 'GROWTH', null, 'N/A', null, null, 10, '5yr profit CAGR unavailable — excluded from scoring');
  }

  // Revenue predictability (YoY quarterly growth consistency)
  const yoyRev = screener.revenueGrowthYoY;
  if (yoyRev !== null) {
    const yoyScore = yoyRev >= 20 ? 82 : yoyRev >= 12 ? 68 : yoyRev >= 5 ? 54 : yoyRev >= 0 ? 40 : 22;
    c('rev_visibility', 'Revenue Visibility (YoY)', 'GROWTH', yoyRev, `${safeFixed(yoyRev, 1)}% YoY`, yoyScore, null, 6,
      yoyRev >= 12 ? 'Consistent demand — predictable revenue base' : yoyRev >= 0 ? 'Modest growth — assess order book' : 'Revenue contracting — high risk');
  } else {
    c('rev_visibility', 'Revenue Visibility (YoY)', 'GROWTH', null, 'N/A', null, null, 6, 'Quarterly comparison data unavailable — excluded from scoring');
  }

  // Revenue Growth (recent YoY growth metric)
  const revGrowthYoY = screener.revenueGrowthYoY || screener.salesGrowth || screener.salesCagr5yr;
  if (revGrowthYoY !== null) {
    let revGrowthScore: number;
    if (revGrowthYoY >= 20) revGrowthScore = 88;
    else if (revGrowthYoY >= 12) revGrowthScore = 75;
    else if (revGrowthYoY >= 5) revGrowthScore = 62;
    else if (revGrowthYoY >= 0) revGrowthScore = 50;
    else revGrowthScore = 25;
    c('rev_growth', 'Revenue Growth', 'GROWTH', revGrowthYoY, `${safeFixed(revGrowthYoY, 1)}% (Modelled)`, revGrowthScore, null, 8,
      revGrowthYoY >= 20 ? 'Strong revenue momentum — capturing market opportunity' : revGrowthYoY >= 12 ? 'Healthy revenue growth trajectory' : revGrowthYoY >= 5 ? 'Modest growth — assess sustainability' : revGrowthYoY >= 0 ? 'Flat to minimal growth — maturity phase' : 'Revenue declining — assess turnaround risk');
  } else {
    c('rev_growth', 'Revenue Growth', 'GROWTH', null, 'N/A', null, null, 8, 'Revenue growth data unavailable — excluded from scoring');
  }

  // EPS Growth (YoY earnings growth)
  const epsGrowthYoY = screener._epsGrowthYoY ?? null;
  if (epsGrowthYoY !== null) {
    let epsGrowthScore: number;
    if (epsGrowthYoY >= 25) epsGrowthScore = 90;
    else if (epsGrowthYoY >= 15) epsGrowthScore = 78;
    else if (epsGrowthYoY >= 5) epsGrowthScore = 65;
    else if (epsGrowthYoY >= 0) epsGrowthScore = 50;
    else epsGrowthScore = 22;
    c('eps_growth', 'EPS Growth', 'GROWTH', epsGrowthYoY, `${safeFixed(epsGrowthYoY, 1)}% YoY (Modelled)`, epsGrowthScore, null, 8,
      epsGrowthYoY >= 25 ? 'Exceptional EPS compounding — shareholder value creation' : epsGrowthYoY >= 15 ? 'Strong earnings momentum' : epsGrowthYoY >= 5 ? 'Moderate EPS growth' : epsGrowthYoY >= 0 ? 'Flat earnings — assess margin trends' : 'EPS declining — profit quality at risk');
  } else {
    c('eps_growth', 'EPS Growth', 'GROWTH', null, 'N/A', null, null, 8, 'EPS growth data unavailable — excluded from scoring');
  }

  // ── FINANCIAL STRENGTH PILLAR ─────────────────────────────────────────────
  const de = screener.de;
  if (de !== null) {
    // Lower D/E = better, so inverted. Thresholds: [comfortable, moderate, stretched]
    const s = peerNormalize(de, [0.5, 1.2, 2.5], true) ?? 50;
    c('de_ratio', 'Debt-to-Equity', 'FIN_STRENGTH', de, `${safeFixed(de, 2)}x`, s, null, 10,
      de <= 0.3 ? 'Near debt-free — financial fortress' : de <= 0.7 ? 'Conservative leverage' : de <= 1.5 ? 'Manageable debt — monitor trend' : de <= 3 ? 'High debt — limits compounding' : 'Dangerous leverage — restructuring risk');
  } else {
    c('de_ratio', 'Debt-to-Equity', 'FIN_STRENGTH', null, 'N/A', null, null, 10, 'Debt data unavailable — excluded from scoring');
  }

  const promoter = screener.promoterPct;
  if (promoter !== null) {
    const s = peerNormalize(promoter, [35, 50, 65]) ?? 50;
    c('promoter', 'Promoter Holding', 'FIN_STRENGTH', promoter, `${safePct(promoter, 1)}`, s, null, 8,
      promoter >= 65 ? 'High conviction — founder-led with skin in the game' : promoter >= 50 ? 'Adequate promoter alignment' : promoter >= 35 ? 'Moderate holding — watch for dilution' : 'Low promoter holding — governance concern');
  } else {
    c('promoter', 'Promoter Holding', 'FIN_STRENGTH', null, 'N/A', null, null, 8, 'Shareholding data unavailable — excluded from scoring');
  }

  // Pledge: INVERTED metric — lower is better. null = unknown, not zero.
  const pledgedRaw = screener.pledgedPct;
  const pledged = pledgedRaw ?? null;
  const pledgeScore = pledged !== null ? (pledged <= 3 ? 90 : pledged <= 10 ? 76 : pledged <= 25 ? 55 : pledged <= 50 ? 30 : 8) : null;
  c('pledge', 'Promoter Pledge %', 'FIN_STRENGTH', pledged, pledged !== null ? `${safePct(pledged, 1)}` : 'N/A', pledgeScore, null, 8,
    pledged !== null ? (pledged <= 3 ? 'Zero/minimal pledging — no distress risk' : pledged <= 10 ? 'Low pledging — acceptable' : pledged <= 25 ? 'Moderate pledge — watch for increase' : 'High pledge — forced selling risk') : 'Pledge data unavailable — excluded from scoring');

  const icr = screener.interestCoverage;
  if (icr !== null) {
    const icrScore = icr >= 8 ? 88 : icr >= 4 ? 72 : icr >= 2 ? 52 : icr >= 1 ? 32 : 10;
    c('icr', 'Interest Coverage', 'FIN_STRENGTH', icr, `${safeFixed(icr, 1)}x`, icrScore, null, 7,
      icr >= 8 ? 'Earnings comfortably cover interest — financial resilience' : icr >= 4 ? 'Adequate coverage' : icr >= 2 ? 'Thin coverage — limited buffer' : 'Interest coverage critical');
  } else {
    c('icr', 'Interest Coverage', 'FIN_STRENGTH', null, 'N/A', null, null, 7, 'Interest coverage ratio unavailable — excluded from scoring');
  }

  // ── VALUATION PILLAR ──────────────────────────────────────────────────────
  const pe = screener.pe;
  if (pe !== null) {
    const bm = benchmarks.pe;
    // For valuation, near-median is good; far above is bad; far below might be value trap
    let peScore: number;
    if (pe >= bm[0] * 0.6 && pe <= bm[1]) peScore = 78;           // fair value zone
    else if (pe > bm[1] && pe <= bm[2]) peScore = 68;              // growth premium
    else if (pe < bm[0] * 0.6 && pe > 5) peScore = 60;            // cheap — could be value trap
    else if (pe > bm[2] && pe <= bm[2] * 1.5) peScore = 52;       // expensive
    else if (pe > bm[2] * 1.5) peScore = 32;                       // very expensive
    else peScore = 40;
    c('pe', 'P/E vs Sector', 'VALUATION', pe, `${safeFixed(pe, 1)}x (sector median ${bm[0]}x)`, peScore, null, 9,
      pe <= bm[1] && pe >= bm[0] * 0.6 ? 'Fair to reasonable valuation for sector' : pe > bm[2] ? `Premium valuation — ${safeFixed((pe / bm[0] - 1) * 100, 0)}% above sector median` : pe < bm[0] * 0.6 ? 'Discounted vs sector — check if value trap' : 'Moderate premium');
  } else {
    c('pe', 'P/E vs Sector', 'VALUATION', null, 'N/A', null, null, 9, 'P/E unavailable — excluded from scoring');
  }

  const pb = screener.priceToBook;
  if (pb !== null) {
    const pbScore = pb >= 1 && pb <= 4 ? 72 : pb > 4 && pb <= 8 ? 58 : pb < 1 && pb > 0.3 ? 62 : pb > 8 ? 38 : 45;
    c('pb', 'Price-to-Book', 'VALUATION', pb, `${safeFixed(pb, 2)}x`, pbScore, null, 6,
      pb >= 1 && pb <= 4 ? 'Reasonable P/B — quality at fair price' : pb > 8 ? 'Very expensive vs book' : 'Discounted to book — assess asset quality');
  } else {
    c('pb', 'Price-to-Book', 'VALUATION', null, 'N/A', null, null, 6, 'P/B unavailable — excluded from scoring');
  }

  // FCF yield proxy (positive CFO with reasonable PE)
  let fcfScore: number | null = null;
  if (cfoPos !== null && pe !== null) {
    fcfScore = cfoPos ? (pe <= benchmarks.pe[1] ? 80 : pe <= benchmarks.pe[2] ? 65 : 52) : 20;
  } else if (cfoPos === true) { fcfScore = 68; }
  else if (cfoPos === false) { fcfScore = 20; }
  const fcfRaw = fcfScore !== null ? fcfScore : null;
  c('fcf', 'FCF Quality', 'VALUATION', fcfRaw, cfoPos === true ? 'Positive' : cfoPos === false ? 'Negative' : 'N/A', fcfScore, null, 6,
    fcfScore !== null ? (fcfScore >= 75 ? 'Compounding engine confirmed — FCF supports valuation' : fcfScore <= 25 ? 'Cash-burning at current price — valuation risk elevated' : 'FCF quality moderate') : 'FCF data unavailable — excluded from scoring');

  // Market cap sweet spot (500Cr-15000Cr = highest multibagger probability)
  const mcap = screener.marketCapCr ?? nse.marketCapCr;
  if (mcap && mcap > 0) {
    const mcapScore = (mcap >= 500 && mcap <= 15000) ? 82 : (mcap > 15000 && mcap <= 50000) ? 65 : (mcap < 500 && mcap >= 100) ? 72 : (mcap < 100) ? 50 : 48;
    c('mcap', 'Market Cap Zone', 'VALUATION', mcap, `₹${safeFixed(mcap / 100, 0)}B`, mcapScore, null, 5,
      mcap >= 500 && mcap <= 15000 ? 'Sweet spot — large enough to execute, small enough for 5x+' : mcap > 50000 ? 'Large cap — steady compounder, not a multibagger' : mcap < 100 ? 'Micro cap — high risk, liquidity concern' : 'Reasonable size');
  } else {
    c('mcap', 'Market Cap Zone', 'VALUATION', null, 'Data unavailable', null, null, 5, 'Market cap missing — excluded from scoring');
  }

  // ── MARKET / TECHNICAL PILLAR ─────────────────────────────────────────────
  const pctH = nse.pctFrom52H;
  if (pctH !== null) {
    const below = Math.abs(Math.min(0, pctH));
    const momScore = below <= 8 ? 84 : below <= 20 ? 70 : below <= 35 ? 55 : below <= 55 ? 38 : 22;
    c('momentum', '52W Momentum', 'MARKET', pctH, `${safeFixed(Math.abs(pctH), 1)}% from 52W high`, momScore, null, 7,
      below <= 8 ? 'Near 52W high — institutional accumulation confirmed' : below <= 20 ? 'Modest pull-back — healthy consolidation' : below <= 40 ? 'Meaningful correction — assess fundamental cause' : 'Deep drawdown — high conviction needed');
  } else {
    c('momentum', '52W Momentum', 'MARKET', null, 'N/A', null, null, 7, 'Price data unavailable — excluded from scoring');
  }

  // Sector tailwind (structural multibagger advantage)
  const isSunrise = ['SUNRISE', 'TECHNOLOGY'].includes(sectorGroup);
  const isStable  = ['CONSUMER', 'PHARMA', 'BANKING_FIN'].includes(sectorGroup);
  const tailwindScore = isSunrise ? 86 : isStable ? 70 : 58;
  c('sector_tail', 'Sector Tailwind', 'MARKET', tailwindScore,
    isSunrise ? 'Sunrise/High-growth sector' : isStable ? 'Stable/Quality sector' : 'Cyclical/neutral sector',
    tailwindScore, null, 8,
    isSunrise ? 'Structural decade-long tailwind — policy and global demand behind this sector' : isStable ? 'Stable demand — consistent long-term compounder territory' : 'Sector-specific story — requires careful macro analysis');

  return criteria;
}

// ── Aggregate criteria → pillar scores ───────────────────────────────────────
function buildPillars(criteria: CriterionDetail[]): PillarScore[] {
  const PILLARS: Array<{ id: string; label: string; filter: CriterionDetail['pillar']; weight: number }> = [
    { id: 'QUALITY',      label: 'Quality',           filter: 'QUALITY',      weight: 0.30 },
    { id: 'GROWTH',       label: 'Growth',            filter: 'GROWTH',       weight: 0.25 },
    { id: 'FIN_STRENGTH', label: 'Financial Strength',filter: 'FIN_STRENGTH', weight: 0.20 },
    { id: 'VALUATION',    label: 'Valuation',         filter: 'VALUATION',    weight: 0.15 },
    { id: 'MARKET',       label: 'Market/Technical',  filter: 'MARKET',       weight: 0.10 },
  ];

  return PILLARS.map(p => {
    const items = criteria.filter(c => c.pillar === p.filter);
    // ONLY average criteria with actual data — missing metrics are EXCLUDED, not neutral
    const available = items.filter(c => c.dataAvailable);
    const totalW = available.reduce((a, c) => a + c.weight, 0);
    const weighted = available.reduce((a, c) => a + c.score * c.weight, 0);
    let score = totalW > 0 ? Math.round(weighted / totalW) : 0;
    const coverage = items.length > 0 ? available.length / items.length : 0;
    if (coverage === 0) score = 0;
    const sorted = [...available].sort((a, b) => b.score - a.score);
    return {
      id: p.id,
      label: p.label,
      weight: p.weight,
      score,
      coverage,
      topStrength: sorted[0]?.label ?? '—',
      topRisk: sorted[sorted.length - 1]?.label ?? '—',
    };
  });
}

// ── Final composite score with confidence penalty ────────────────────────────
function compositeScore(pillars: PillarScore[], criteria: CriterionDetail[]): number {
  const rawTotal = pillars.reduce((a, p) => a + p.score * p.weight, 0);
  // Confidence penalty: missing data reduces score, but gently
  // With 23% data (NSE only), old penalty was 0.4*0.77 = 30.8% reduction → score 40 for everything
  // New: 15% max penalty per missing metric — lets available data speak louder
  const totalCriteria = criteria.length;
  const availableCriteria = criteria.filter(c => c.dataAvailable).length;
  const missingRatio = totalCriteria > 0 ? (totalCriteria - availableCriteria) / totalCriteria : 0;
  // Penalty: each missing metric costs 15% of its share (was 40%)
  // Also cap total penalty at 25% — never destroy a stock's score just because data is sparse
  const penaltyMultiplier = Math.max(0.75, 1 - (missingRatio * 0.15));
  const penalized = rawTotal * penaltyMultiplier;
  // Round to nearest integer — precision matters for grade boundaries (A ≥72, A+ ≥80)
  return Math.round(penalized);
}

// ── Sanitize output to ensure no NaN/Infinity in JSON ───────────────────────
function sanitizeForJSON(obj: unknown): unknown {
  if (typeof obj === 'number') return isFinite(obj) && !isNaN(obj) ? obj : null;
  if (Array.isArray(obj)) return obj.map(sanitizeForJSON);
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = sanitizeForJSON(v);
    }
    return out;
  }
  return obj;
}

// ── Main GET handler ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const portfolioRaw = searchParams.get('portfolio') || '';
    const watchlistRaw = searchParams.get('watchlist') || '';
    const debug = searchParams.get('debug') === '1';
    const debugSymbol = (searchParams.get('debugSymbol') || '').toUpperCase();

    const portfolio = portfolioRaw ? portfolioRaw.split(',').map(s => s.trim().toUpperCase()).filter(s => s.length >= 2) : [];
    const watchlist = watchlistRaw ? watchlistRaw.split(',').map(s => s.trim().toUpperCase()).filter(s => s.length >= 2) : [];
    const allSymbols = Array.from(new Set([...portfolio, ...watchlist]));

    // ── STATIC FALLBACK DATA: Last resort for symbols where ALL live sources fail ──
    // Marked with source: 'Static' so the UI can show a badge. Updated periodically.
    // Data from NSE/screener.in as of April 2026.
    const STATIC_FALLBACK: Record<string, { company: string; sector: string; lastPrice: number; marketCapCr: number; pe: number | null; roe: number | null; opm: number | null; de: number | null; promoterPct: number | null }> = {
      'HBLENGINE': { company: 'HBL Power Systems', sector: 'Industrial Manufacturing', lastPrice: 625, marketCapCr: 17400, pe: 48, roe: 22, opm: 16, de: 0.1, promoterPct: 56 },
      'HBLPOWER': { company: 'HBL Power Systems', sector: 'Industrial Manufacturing', lastPrice: 625, marketCapCr: 17400, pe: 48, roe: 22, opm: 16, de: 0.1, promoterPct: 56 },
      'APARINDS': { company: 'Apar Industries', sector: 'Cables', lastPrice: 7800, marketCapCr: 31200, pe: 38, roe: 28, opm: 10, de: 0.5, promoterPct: 55 },
      'APARIND': { company: 'Apar Industries', sector: 'Cables', lastPrice: 7800, marketCapCr: 31200, pe: 38, roe: 28, opm: 10, de: 0.5, promoterPct: 55 },
      'PRICOLLTD': { company: 'Pricol Limited', sector: 'Auto Ancillaries', lastPrice: 430, marketCapCr: 5200, pe: 28, roe: 18, opm: 12, de: 0.3, promoterPct: 48 },
      'TDPOWERSYS': { company: 'TD Power Systems', sector: 'Capital Goods', lastPrice: 420, marketCapCr: 6800, pe: 45, roe: 15, opm: 14, de: 0.1, promoterPct: 58 },
      'ENGINERSIN': { company: 'Engineers India Ltd', sector: 'Engineering', lastPrice: 185, marketCapCr: 10400, pe: 22, roe: 14, opm: 12, de: 0.0, promoterPct: 51 },
      'ECLERX': { company: 'eClerx Services', sector: 'IT Services', lastPrice: 2600, marketCapCr: 11200, pe: 24, roe: 30, opm: 28, de: 0.0, promoterPct: 50 },
      'JAMNAAUTO': { company: 'Jamna Auto Industries', sector: 'Auto Ancillaries', lastPrice: 105, marketCapCr: 4200, pe: 22, roe: 24, opm: 15, de: 0.1, promoterPct: 47 },
      'DATAMATICS': { company: 'Datamatics Global Services', sector: 'IT Services', lastPrice: 510, marketCapCr: 3000, pe: 20, roe: 18, opm: 16, de: 0.1, promoterPct: 66 },
      'SKIPPER': { company: 'Skipper Limited', sector: 'Capital Goods', lastPrice: 420, marketCapCr: 4300, pe: 32, roe: 16, opm: 10, de: 0.8, promoterPct: 55 },
      'BALUFORGE': { company: 'Balu Forge Industries', sector: 'Industrial Manufacturing', lastPrice: 520, marketCapCr: 4000, pe: 35, roe: 14, opm: 18, de: 0.3, promoterPct: 60 },
      'KPIGREEN': { company: 'KPI Green Energy', sector: 'Renewable Energy', lastPrice: 420, marketCapCr: 5200, pe: 32, roe: 18, opm: 22, de: 1.2, promoterPct: 62 },
      'GARUDA': { company: 'Garuda Construction', sector: 'Construction', lastPrice: 110, marketCapCr: 1800, pe: 28, roe: 12, opm: 14, de: 0.5, promoterPct: 55 },
      'INOXWIND': { company: 'Inox Wind Limited', sector: 'Renewable Energy', lastPrice: 180, marketCapCr: 20500, pe: null, roe: 8, opm: 10, de: 0.8, promoterPct: 47 },
      'SAGILITY': { company: 'Sagility India', sector: 'IT Services', lastPrice: 38, marketCapCr: 17800, pe: 60, roe: 10, opm: 18, de: 0.2, promoterPct: 70 },
      'POWERMECH': { company: 'Power Mech Projects', sector: 'Engineering', lastPrice: 1850, marketCapCr: 2900, pe: 18, roe: 16, opm: 10, de: 0.6, promoterPct: 52 },
      'ACMESOLAR': { company: 'Acme Solar Holdings', sector: 'Renewable Energy', lastPrice: 225, marketCapCr: 14500, pe: null, roe: 5, opm: 55, de: 3.5, promoterPct: 68 },
      'RUBICON': { company: 'Rubicon Research', sector: 'Pharma', lastPrice: 55, marketCapCr: 1200, pe: null, roe: null, opm: 8, de: 1.0, promoterPct: 60 },
      'DYNACONS': { company: 'Dynacons Systems', sector: 'IT Services', lastPrice: 1050, marketCapCr: 850, pe: 22, roe: 25, opm: 8, de: 0.1, promoterPct: 50 },
      'JSLL': { company: 'JSL Lifestyle', sector: 'Consumer Durables', lastPrice: 90, marketCapCr: 900, pe: 25, roe: 12, opm: 8, de: 0.5, promoterPct: 55 },
      'SENORES': { company: 'Senores Pharmaceuticals', sector: 'Pharma', lastPrice: 440, marketCapCr: 2800, pe: 30, roe: 15, opm: 20, de: 0.3, promoterPct: 58 },
      'SMLMAH': { company: 'SML Isuzu (Mahindra)', sector: 'Automobiles', lastPrice: 1800, marketCapCr: 3400, pe: 35, roe: 10, opm: 6, de: 0.2, promoterPct: 51 },
      'BELRISE': { company: 'Belrise Industries', sector: 'Auto Ancillaries', lastPrice: 55, marketCapCr: 4200, pe: null, roe: null, opm: 12, de: 1.5, promoterPct: 72 },
      'IZMO': { company: 'IZMO Limited', sector: 'IT Services', lastPrice: 85, marketCapCr: 350, pe: 15, roe: 12, opm: 10, de: 0.1, promoterPct: 50 },
      'LENSKART': { company: 'Lenskart Solutions', sector: 'Retail', lastPrice: 22, marketCapCr: 48000, pe: null, roe: null, opm: null, de: null, promoterPct: 30 },
      'S&SPOWER': { company: 'S&S Power Switchgear', sector: 'Capital Goods', lastPrice: 360, marketCapCr: 1100, pe: 40, roe: 15, opm: 12, de: 0.2, promoterPct: 60 },
      'SIGMA': { company: 'Sigma Solve Limited', sector: 'IT Services', lastPrice: 450, marketCapCr: 750, pe: 30, roe: 18, opm: 14, de: 0.1, promoterPct: 55 },
      // Portfolio stocks — ensure scoring even under timeout
      'HFCL': { company: 'HFCL Limited', sector: 'Telecom Equipment', lastPrice: 110, marketCapCr: 15800, pe: 38, roe: 14, opm: 16, de: 0.3, promoterPct: 38 },
      'GRAVITA': { company: 'Gravita India', sector: 'Non-Ferrous Metals', lastPrice: 2100, marketCapCr: 14500, pe: 42, roe: 28, opm: 10, de: 0.4, promoterPct: 55 },
      'CEINSYS': { company: 'Ceinsys Tech', sector: 'IT Services', lastPrice: 995, marketCapCr: 2500, pe: 55, roe: 18, opm: 15, de: 0.2, promoterPct: 52 },
      'AEROFLEX': { company: 'Aeroflex Industries', sector: 'Industrial Products', lastPrice: 255, marketCapCr: 3400, pe: 45, roe: 16, opm: 18, de: 0.3, promoterPct: 60 },
      'CPPLUS': { company: 'CP Plus (Aditya Infotech)', sector: 'Electronics', lastPrice: 680, marketCapCr: 5000, pe: 35, roe: 15, opm: 10, de: 0.2, promoterPct: 48 },
      'DIXON': { company: 'Dixon Technologies', sector: 'Consumer Electronics', lastPrice: 15500, marketCapCr: 93000, pe: 120, roe: 25, opm: 5, de: 0.2, promoterPct: 34 },
      'IKS': { company: 'IKS Health', sector: 'Healthcare IT', lastPrice: 580, marketCapCr: 4800, pe: 60, roe: 12, opm: 20, de: 0.1, promoterPct: 55 },
      'PARAS': { company: 'Paras Defence', sector: 'Defence', lastPrice: 1050, marketCapCr: 4200, pe: 65, roe: 12, opm: 22, de: 0.2, promoterPct: 58 },
      'QPOWER': { company: 'Quality Power Electrical', sector: 'Capital Goods', lastPrice: 470, marketCapCr: 5200, pe: 40, roe: 18, opm: 14, de: 0.4, promoterPct: 50 },
      'JSWINFRA': { company: 'JSW Infrastructure', sector: 'Infrastructure', lastPrice: 300, marketCapCr: 63000, pe: 55, roe: 10, opm: 45, de: 0.6, promoterPct: 86 },
      'DEEDEV': { company: 'Dee Development Engineers', sector: 'Engineering', lastPrice: 310, marketCapCr: 2200, pe: 32, roe: 15, opm: 12, de: 0.5, promoterPct: 52 },
      'LUMAXTECH': { company: 'Lumax Auto Technologies', sector: 'Auto Ancillaries', lastPrice: 510, marketCapCr: 3500, pe: 28, roe: 18, opm: 9, de: 0.2, promoterPct: 53 },
      'MTARTECH': { company: 'Mtar Technologies', sector: 'Defence/Aerospace', lastPrice: 1650, marketCapCr: 5100, pe: 70, roe: 10, opm: 22, de: 0.1, promoterPct: 52 },
      // Symbols that frequently fail live data fetches
      'SYRMA': { company: 'Syrma SGS Technology', sector: 'Industrial Products', lastPrice: 813, marketCapCr: 15700, pe: 65, roe: 12, opm: 8, de: 0.1, promoterPct: 55 },
      'WAAREEENER': { company: 'Waaree Energies', sector: 'Renewable Energy', lastPrice: 3082, marketCapCr: 88700, pe: 80, roe: 30, opm: 18, de: 0.3, promoterPct: 68 },
      'WELCORP': { company: 'Welspun Corp', sector: 'Steel', lastPrice: 865, marketCapCr: 22800, pe: 14, roe: 18, opm: 12, de: 0.5, promoterPct: 48 },
      'SANSERA': { company: 'Sansera Engineering', sector: 'Auto Ancillaries', lastPrice: 2142, marketCapCr: 13300, pe: 42, roe: 14, opm: 15, de: 0.3, promoterPct: 53 },
      'SAILIFE': { company: 'Sai Life Sciences', sector: 'Pharma', lastPrice: 945, marketCapCr: 20000, pe: 80, roe: 10, opm: 18, de: 0.4, promoterPct: 55 },
      'SJS': { company: 'SJS Enterprises', sector: 'Auto Ancillaries', lastPrice: 1593, marketCapCr: 5100, pe: 55, roe: 12, opm: 20, de: 0.1, promoterPct: 58 },
    };

    // ── SYMBOL ALIAS MAP: NSE symbols that need alternate names on screener.in/Yahoo ──
    // Many NSE symbols have different representations across data sources.
    // Format: { NSE_SYMBOL: { screener: 'screener_slug', yahoo: 'YAHOO.NS', nse: 'NSE_SYMBOL' } }
    const SYMBOL_ALIASES: Record<string, { screener?: string; yahoo?: string; nse?: string }> = {
      'HBLENGINE': { screener: 'HBLPOWER', yahoo: 'HBLPOWER.NS', nse: 'HBLPOWER' },
      'APARINDS': { screener: 'APARIND', yahoo: 'APARIND.NS', nse: 'APARIND' },
      'ENGINERSIN': { screener: 'ENGINERSIN', yahoo: 'ENGINERSIN.NS' },
      'PRICOLLTD': { screener: 'PRICOLLTD', yahoo: 'PRICOLLTD.NS', nse: 'PRICOLLTD' },
      'TDPOWERSYS': { screener: 'TDPOWERSYS', yahoo: 'TDPOWERSYS.NS' },
      'ECLERX': { screener: 'ECLERX', yahoo: 'ECLERX.NS' },
      'JAMNAAUTO': { screener: 'JAMNAAUTO', yahoo: 'JAMNAAUTO.NS' },
      'DATAMATICS': { screener: 'DATAMATICS', yahoo: 'DATAMATICS.NS' },
      'SKIPPER': { screener: 'SKIPPER', yahoo: 'SKIPPER.NS' },
      'BALUFORGE': { screener: 'BALUFORGE', yahoo: 'BALUFORGE.NS' },
      'KPIGREEN': { screener: 'KPIGREEN', yahoo: 'KPIGREEN.NS' },
      'GARUDA': { screener: 'GARUDA', yahoo: 'GARUDA.NS' },
      'INOXWIND': { screener: 'INOXWIND', yahoo: 'INOXWIND.NS' },
      'SAGILITY': { screener: 'SAGILITY', yahoo: 'SAGILITY.NS' },
      'POWERMECH': { screener: 'POWERMECH', yahoo: 'POWERMECH.NS' },
      'ACMESOLAR': { screener: 'ACMESOLAR', yahoo: 'ACMESOLAR.NS' },
      'RUBICON': { screener: 'RUBICON', yahoo: 'RUBICON.NS' },
      'DYNACONS': { screener: 'DYNACONS', yahoo: 'DYNACONS.NS' },
      'JSLL': { screener: 'JSLL', yahoo: 'JSLL.NS' },
      'SENORES': { screener: 'SENORES', yahoo: 'SENORES.NS' },
      'SMLMAH': { screener: 'SMLMAH', yahoo: 'SMLMAH.NS' },
      'BELRISE': { screener: 'BELRISE', yahoo: 'BELRISE.NS' },
      'IZMO': { screener: 'IZMO', yahoo: 'IZMO.NS' },
      'LENSKART': { screener: 'LENSKART', yahoo: 'LENSKART.NS' },
      // Symbols that fail on screener.in — map to correct slugs
      'SYRMA': { screener: 'SYRMASGP', yahoo: 'SYRMA.NS', nse: 'SYRMA' },
      'WAAREEENER': { screener: 'WAAREEENER', yahoo: 'WAAREEENER.NS', nse: 'WAAREEENER' },
      'WELCORP': { screener: 'WELCORP', yahoo: 'WELCORP.NS', nse: 'WELCORP' },
      'SANSERA': { screener: 'SANSERA', yahoo: 'SANSERA.NS', nse: 'SANSERA' },
      'SAILIFE': { screener: 'SAILIFE', yahoo: 'SAILIFE.NS', nse: 'SAILIFE' },
      'SJS': { screener: 'SJSENTERPR', yahoo: 'SJS.NS', nse: 'SJS' },
      'SIGMA': { screener: 'SIGMA', yahoo: 'SIGMA.NS', nse: 'SIGMA' },
      // Portfolio stocks
      'HFCL': { screener: 'HFCL', yahoo: 'HFCL.NS', nse: 'HFCL' },
      'GRAVITA': { screener: 'GRAVITA', yahoo: 'GRAVITA.NS', nse: 'GRAVITA' },
      'CEINSYS': { screener: 'CEINSYS', yahoo: 'CEINSYS.NS', nse: 'CEINSYS' },
      'AEROFLEX': { screener: 'AEROFLEX', yahoo: 'AEROFLEX.NS', nse: 'AEROFLEX' },
      'CPPLUS': { screener: 'ADITYA', yahoo: 'CPPLUS.NS', nse: 'CPPLUS' },
      'DIXON': { screener: 'DIXON', yahoo: 'DIXON.NS', nse: 'DIXON' },
      'IKS': { screener: 'IKSHEALTH', yahoo: 'IKS.NS', nse: 'IKS' },
      'PARAS': { screener: 'PARAS', yahoo: 'PARAS.NS', nse: 'PARAS' },
      'QPOWER': { screener: 'QPOWER', yahoo: 'QPOWER.NS', nse: 'QPOWER' },
      'JSWINFRA': { screener: 'JSWINFRA', yahoo: 'JSWINFRA.NS', nse: 'JSWINFRA' },
      'DEEDEV': { screener: 'DEEDEV', yahoo: 'DEEDEV.NS', nse: 'DEEDEV' },
      'LUMAXTECH': { screener: 'LUMAXTECH', yahoo: 'LUMAXTECH.NS', nse: 'LUMAXTECH' },
      'MTARTECH': { screener: 'MTARTECH', yahoo: 'MTARTECH.NS', nse: 'MTARTECH' },
      // Special character symbols — map to valid NSE names
      'S&SPOWER': { screener: 'SANDHYA', yahoo: 'S&SPOWER.NS', nse: 'S&SPOWER' },
    };

    // Resolve symbol: apply alias if available, return the best NSE symbol
    const resolveSymbol = (sym: string): string => {
      const alias = SYMBOL_ALIASES[sym];
      return alias?.nse || sym;
    };

    // Exclude truly invalid symbols (non-alphanumeric) — but allow aliased ones
    const INVALID_SYMBOLS = new Set<string>(); // Removed S&SPOWER — handled by alias
    const cleanSymbols = allSymbols.filter(s => {
      if (INVALID_SYMBOLS.has(s)) return false;
      // Allow symbols that have aliases even if they contain special chars
      if (SYMBOL_ALIASES[s]) return true;
      return /^[A-Z0-9]+$/.test(s);
    });
    const skippedSymbols = allSymbols.filter(s => !cleanSymbols.includes(s));

    if (cleanSymbols.length === 0) {
      return NextResponse.json({ results: [], message: 'Add companies to your portfolio or watchlist to see multibagger analysis.', skippedSymbols });
    }

    const results: MultibaggerResult[] = [];
    const DEADLINE = Date.now() + 35000; // 35s hard deadline (Vercel Hobby kills at ~50s with cold start overhead)

    // Add skipped symbols as NR results
    for (const sym of skippedSymbols) {
      results.push({
        symbol: sym, company: sym, sector: 'Unknown', sectorGroup: 'UNKNOWN',
        lastPrice: null, marketCapCr: null, overallScore: 0, grade: 'NR' as Grade,
        pillars: [], criteria: [],
        redFlags: [{ id: 'invalid_symbol', label: 'Invalid Symbol', severity: 'CRITICAL', detail: `Symbol '${sym}' contains special characters — cannot fetch data` }],
        quality: { valid: false, reason: `Invalid symbol format: ${sym}`, coveragePct: 0, confidence: 'VERY_LOW', source: 'none', fetchedAt: new Date().toISOString(), staleness: 'UNKNOWN' },
        isPortfolio: portfolio.includes(sym), isWatchlist: watchlist.includes(sym),
        errors: [`Invalid symbol: ${sym}`],
      });
    }

    // Process in batches of 6 (reduced from 8 — 23 symbols needs faster batches to fit in 35s)
    const BATCH = 6;
    for (let i = 0; i < cleanSymbols.length; i += BATCH) {
      // Check deadline before starting next batch
      if (Date.now() > DEADLINE) {
        // Return partial results — use static fallback for symbols that have it
        const remaining = cleanSymbols.slice(i);
        for (const sym of remaining) {
          const aliasSym = SYMBOL_ALIASES[sym]?.nse || sym;
          const sData = STATIC_FALLBACK[sym] || STATIC_FALLBACK[aliasSym];
          if (sData && sData.lastPrice && sData.lastPrice > 0) {
            // Score using static data instead of returning NR
            const sectorGrp = getSectorGroup(sData.sector || 'Unknown');
            const staticRoe = sData.roe || 0;
            const staticOpm = sData.opm || 0;
            const staticDe = sData.de ?? 1;
            const staticPe = sData.pe || 0;
            const staticPromoter = sData.promoterPct || 0;
            const staticRoce = staticRoe / (1 + staticDe);
            // Simplified scoring for static data
            const qualScore = Math.min(30, (staticRoe / 25 * 12) + (staticOpm / 20 * 10) + (staticRoce / 15 * 8));
            const valScore = Math.min(15, staticPe > 0 && staticPe < 50 ? (1 - staticPe / 100) * 15 : 3);
            const mktScore = Math.min(10, (staticPromoter / 75 * 5) + 3);
            const rawScore = Math.round(qualScore + valScore + mktScore + 10); // +10 base for growth/fin
            const penalized = Math.round(Math.max(0, rawScore) * 0.85); // 15% penalty for static
            const grade = penalized >= 72 ? 'A' : penalized >= 55 ? 'B' : penalized >= 35 ? 'C' : 'D';
            results.push({
              symbol: sym, company: sData.company || sym, sector: sData.sector || 'Unknown', sectorGroup: sectorGrp,
              lastPrice: sData.lastPrice, marketCapCr: sData.marketCapCr,
              overallScore: penalized, grade: grade as Grade,
              pillars: [
                { id: 'quality', label: 'Quality', weight: 0.3, score: Math.round(qualScore), coverage: 0.5, topStrength: 'Static data', topRisk: 'Stale values' },
                { id: 'valuation', label: 'Valuation', weight: 0.15, score: Math.round(valScore), coverage: 0.5, topStrength: 'P/E available', topRisk: 'Limited data' },
                { id: 'market', label: 'Market', weight: 0.10, score: Math.round(mktScore), coverage: 0.5, topStrength: 'Promoter holding', topRisk: 'No live data' },
              ],
              criteria: [],
              redFlags: [{ id: 'static-data', label: 'Static Data', severity: 'MEDIUM', detail: 'Scored from cached data — live fetch timed out' }],
              quality: { valid: true, reason: 'Static fallback — deadline reached', coveragePct: 25, confidence: 'LOW', source: 'Static', fetchedAt: new Date().toISOString(), staleness: 'STALE' },
              isPortfolio: portfolio.includes(sym), isWatchlist: watchlist.includes(sym),
              errors: ['Deadline reached — scored from static data'],
            });
          } else {
            results.push({
              symbol: sym, company: sData?.company || sym, sector: sData?.sector || 'Unknown', sectorGroup: 'UNKNOWN',
              lastPrice: null, marketCapCr: sData?.marketCapCr || null, overallScore: 0, grade: 'NR' as Grade,
              pillars: [], criteria: [],
              redFlags: [{ id: 'timeout', label: 'Processing Timeout', severity: 'MEDIUM', detail: 'Server deadline reached — retry for full analysis' }],
              quality: { valid: false, reason: 'Timeout — partial results', coveragePct: 0, confidence: 'VERY_LOW', source: 'none', fetchedAt: new Date().toISOString(), staleness: 'UNKNOWN' },
              isPortfolio: portfolio.includes(sym), isWatchlist: watchlist.includes(sym),
              errors: ['Processing deadline exceeded'],
            });
          }
        }
        break;
      }
      const batch = cleanSymbols.slice(i, i + BATCH);
      const batchOut = await Promise.all(batch.map(async (symbol): Promise<MultibaggerResult> => {
        try {
          const errors: string[] = [];

          // ── Multi-source data fetching with fallback chain ──
          // Priority: screener.in → Yahoo Finance → Google Finance for fundamentals
          // Priority: NSE (cookie) → BSE → MoneyControl for quotes
          // Priority: NSE Financial Results for quarterly data
          // ── Resolve symbol aliases for each data source ──
          const alias = SYMBOL_ALIASES[symbol] || {};
          const screenerSym = alias.screener || symbol;
          const yahooSym = alias.yahoo ? alias.yahoo.replace('.NS', '') : symbol; // fetchYahooData adds .NS
          const nseSym = alias.nse || symbol;

          // ── Multi-source fetching with exponential backoff retry ──
          // Use aliased symbols for each source to maximize resolution rate
          const [scrResult, nseResult, yahooResult, nseFinResult, googleResult, yahooV7Result] = await Promise.all([
            withRetry(() => fetchScreenerData(screenerSym), 2, 300).catch((): { data: Record<string, any>; ok: boolean; url: string } => ({ data: {}, ok: false, url: '' })),
            withRetry(() => fetchNSEData(nseSym), 2, 300).catch((): { data: Record<string, any>; ok: boolean } => ({ data: {}, ok: false })),
            withRetry(() => fetchYahooData(yahooSym), 1, 500).catch((): { data: Record<string, any>; ok: boolean } => ({ data: {}, ok: false })),
            withRetry(() => fetchNSEFinancials(nseSym), 2, 300).catch((): Record<string, any> => ({})),
            withRetry(() => fetchGoogleFinanceData(nseSym), 1, 500).catch((): { data: Record<string, any>; ok: boolean } => ({ data: {}, ok: false })),
            // Yahoo v7 is fast (4s timeout) and gives PE, EPS, bookValue, priceToBook, 52W data
            // Fetching proactively instead of only in fallback chain saves a round-trip
            fetchYahooV7Quote(yahooSym).catch((): { data: Record<string, any>; ok: boolean } => ({ data: {}, ok: false })),
          ]);

          // Merge data: screener is primary, Yahoo is secondary, Google tertiary, NSE financials quaternary
          const screener: Record<string, any> = scrResult.data || {};
          const nse: Record<string, any>      = nseResult.data || {};
          const yahoo: Record<string, any>    = yahooResult.data || {};
          const nseFin: Record<string, any>   = nseFinResult || {};
          const google: Record<string, any>   = googleResult.data || {};

          // Fill screener gaps with Yahoo data (ALWAYS fill nulls, not just when screener fails)
          if (yahooResult.ok) {
            const yahooKeys = ['pe', 'roe', 'de', 'opm', 'npm', 'bookValue', 'priceToBook', 'eps',
              'dividendYield', 'currentRatio', 'marketCapCr', 'revenueGrowthYoY', 'roce', 'earningsGrowth'];
            for (const k of yahooKeys) {
              if ((screener[k] === null || screener[k] === undefined) && yahoo[k] !== null && yahoo[k] !== undefined) {
                screener[k] = yahoo[k];
              }
            }
            // Use Yahoo earningsGrowth as EPS growth proxy
            if (!screener._epsGrowthYoY && yahoo.earningsGrowth) {
              screener._epsGrowthYoY = yahoo.earningsGrowth;
            }
          }

          // Fill gaps with Yahoo v7 (fast quote API — PE, EPS, bookValue, 52W, sector)
          if (yahooV7Result.ok) {
            const v7 = yahooV7Result.data;
            if (!screener.pe && v7.pe) screener.pe = v7.pe;
            if (!screener.eps && v7.eps) screener.eps = v7.eps;
            if (!screener.bookValue && v7.bookValue) screener.bookValue = v7.bookValue;
            if (!screener.priceToBook && v7.priceToBook) screener.priceToBook = v7.priceToBook;
            if (!screener.marketCapCr && v7.marketCapCr) screener.marketCapCr = v7.marketCapCr;
            if (!nse.lastPrice && v7.lastPrice) nse.lastPrice = v7.lastPrice;
            if (!nse.high52 && v7.high52) nse.high52 = v7.high52;
            if (!nse.low52 && v7.low52) nse.low52 = v7.low52;
            if (!nse.pChange && v7.pChange) nse.pChange = v7.pChange;
            if (!nse.companyName && v7.companyName) nse.companyName = v7.companyName;
            if (!nse.sector && v7.sector) nse.sector = v7.sector;
            if (!nse.marketCapCr && v7.marketCapCr) nse.marketCapCr = v7.marketCapCr;
            // Recalculate 52W metrics if we now have them
            if (nse.high52 && nse.lastPrice && !nse.pctFrom52H) {
              nse.pctFrom52H = ((nse.lastPrice / nse.high52) - 1) * 100;
            }
            if (nse.low52 && nse.lastPrice && !nse.pctFrom52L) {
              nse.pctFrom52L = ((nse.lastPrice - nse.low52) / nse.low52) * 100;
            }
          }

          // Fill gaps with Google Finance
          if (googleResult.ok) {
            if (!screener.pe && google.pe) screener.pe = google.pe;
            if (!screener.marketCapCr && google.marketCapCr) screener.marketCapCr = google.marketCapCr;
            if (!screener.dividendYield && google.dividendYield) screener.dividendYield = google.dividendYield;
          }

          // Fill remaining gaps with NSE financial results
          if (nseFin.eps && !screener.eps) screener.eps = nseFin.eps;
          if (nseFin.npm !== undefined && !screener.npm) screener.npm = nseFin.npm;
          if (nseFin.opm !== undefined && !screener.opm) screener.opm = nseFin.opm;
          if (nseFin.revenueGrowthQoQ !== undefined && !screener.revenueGrowthQoQ) screener.revenueGrowthQoQ = nseFin.revenueGrowthQoQ;
          if (nseFin.profitGrowthQoQ !== undefined && !screener.profitCagr5yr) {
            // Use QoQ profit growth as a partial proxy
            screener._profitGrowthQoQ = nseFin.profitGrowthQoQ;
          }
          // Fill YoY metrics from NSE financials
          if (nseFin._revenueGrowthYoY !== undefined && !screener.revenueGrowthYoY) screener.revenueGrowthYoY = nseFin._revenueGrowthYoY;
          if (nseFin._epsGrowthYoY !== undefined) screener._epsGrowthYoY = nseFin._epsGrowthYoY;
          if (nseFin._profitGrowthYoY !== undefined) screener._profitGrowthYoY = nseFin._profitGrowthYoY;
          // D/E ratio from NSE if available (though usually from screener)
          if (nseFin._de !== undefined && !screener.de) screener.de = nseFin._de;
          // Store computed sales CAGR if available
          if (nseFin._revenueCagr5yr !== undefined && !screener.salesCagr5yr) screener.salesCagr5yr = nseFin._revenueCagr5yr;
          if (nseFin._profitCagr5yr !== undefined && !screener.profitCagr5yr) screener.profitCagr5yr = nseFin._profitCagr5yr;

          // Fill NSE gaps with Yahoo (sector, company name)
          if (!nse.sector && yahoo.sector) nse.sector = yahoo.sector;
          if (!nse.companyName && yahoo.companyName) nse.companyName = yahoo.companyName;
          if (!nse.marketCapCr && yahoo.marketCapCr) nse.marketCapCr = yahoo.marketCapCr;
          if (!screener.marketCapCr && yahoo.marketCapCr) screener.marketCapCr = yahoo.marketCapCr;

          // Use NSE P/E if screener didn't get it
          if (!screener.pe && nse.pe) screener.pe = nse.pe;

          // Resolve company name and sector
          const company   = String(nse.companyName || yahoo.companyName || screener.companyName || symbol);
          const rawSector = String(nse.sector || yahoo.sector || screener.sector || '');
          const sector    = rawSector || 'Unknown';

          // Data quality gate — any source counts as data
          const anyFundamentalData = scrResult.ok || yahooResult.ok || yahooV7Result.ok || googleResult.ok || Object.keys(nseFin).length > 0;
          const quality = validateData(symbol, company, sector, screener, nse, anyFundamentalData, nseResult.ok);
          if (!quality.valid) {
            // ── ENHANCED FALLBACK CHAIN ──
            // Layer 1: Check if we already have a price from any source
            let fallbackPrice = nse.lastPrice || yahoo.lastPrice || screener.lastPrice || 0;
            let fallbackSource = yahooResult.ok ? 'partial' : nseResult.ok ? 'NSE only' : '';
            let usedStatic = false;

            // Layer 2: Try Yahoo v7 quote API (fast, reliable)
            if (fallbackPrice <= 0) {
              try {
                const v7Sym = alias.yahoo ? alias.yahoo.replace('.NS', '') : symbol;
                const v7Result = await fetchYahooV7Quote(v7Sym);
                if (v7Result.ok && v7Result.data.lastPrice > 0) {
                  fallbackPrice = v7Result.data.lastPrice;
                  fallbackSource = 'yahoo_v7';
                  // Merge v7 data into our data objects
                  if (!nse.lastPrice) nse.lastPrice = v7Result.data.lastPrice;
                  if (!nse.companyName && v7Result.data.companyName) nse.companyName = v7Result.data.companyName;
                  if (!nse.sector && v7Result.data.sector) nse.sector = v7Result.data.sector;
                  if (!nse.high52 && v7Result.data.high52) nse.high52 = v7Result.data.high52;
                  if (!nse.low52 && v7Result.data.low52) nse.low52 = v7Result.data.low52;
                  if (!nse.pChange && v7Result.data.pChange) nse.pChange = v7Result.data.pChange;
                  if (!nse.marketCapCr && v7Result.data.marketCapCr) nse.marketCapCr = v7Result.data.marketCapCr;
                  if (!screener.pe && v7Result.data.pe) screener.pe = v7Result.data.pe;
                  if (!screener.eps && v7Result.data.eps) screener.eps = v7Result.data.eps;
                  if (!screener.bookValue && v7Result.data.bookValue) screener.bookValue = v7Result.data.bookValue;
                  if (!screener.priceToBook && v7Result.data.priceToBook) screener.priceToBook = v7Result.data.priceToBook;
                  if (!screener.marketCapCr && v7Result.data.marketCapCr) screener.marketCapCr = v7Result.data.marketCapCr;
                  errors.push('Yahoo v7 quote fallback used');
                }
              } catch {}
            }

            // Layer 3: Try BSE listing via Yahoo (.BO suffix)
            if (fallbackPrice <= 0) {
              try {
                const bseSym = alias.yahoo ? alias.yahoo.replace('.NS', '') : symbol;
                const bseResult = await fetchYahooBSEQuote(bseSym);
                if (bseResult.ok && bseResult.data.lastPrice > 0) {
                  fallbackPrice = bseResult.data.lastPrice;
                  fallbackSource = 'yahoo_bse';
                  if (!nse.lastPrice) nse.lastPrice = bseResult.data.lastPrice;
                  if (!nse.companyName && bseResult.data.companyName) nse.companyName = bseResult.data.companyName;
                  if (!nse.sector && bseResult.data.sector) nse.sector = bseResult.data.sector;
                  if (!nse.marketCapCr && bseResult.data.marketCapCr) nse.marketCapCr = bseResult.data.marketCapCr;
                  if (!screener.pe && bseResult.data.pe) screener.pe = bseResult.data.pe;
                  if (!screener.eps && bseResult.data.eps) screener.eps = bseResult.data.eps;
                  if (!screener.marketCapCr && bseResult.data.marketCapCr) screener.marketCapCr = bseResult.data.marketCapCr;
                  errors.push('BSE Yahoo fallback used');
                }
              } catch {}
            }

            // Layer 4: fetchPriceWithFallback from nse.ts (NSE → BSE → MoneyControl → Redis)
            if (fallbackPrice <= 0) {
              try {
                const pfb = await fetchPriceWithFallback(alias.nse || symbol);
                if (pfb.price && pfb.price > 0) {
                  fallbackPrice = pfb.price;
                  fallbackSource = `price_fallback_${pfb.source}`;
                  if (!nse.lastPrice) nse.lastPrice = pfb.price;
                  errors.push(`Price fallback used (${pfb.source})`);
                }
              } catch {}
            }

            // Layer 5: STATIC DATA — absolute last resort
            const staticKey = alias.nse || symbol;
            const staticData = STATIC_FALLBACK[symbol] || STATIC_FALLBACK[staticKey];
            if (fallbackPrice <= 0 && staticData) {
              fallbackPrice = staticData.lastPrice;
              fallbackSource = 'Static';
              usedStatic = true;
              nse.lastPrice = staticData.lastPrice;
              nse.companyName = staticData.company;
              nse.sector = staticData.sector;
              nse.marketCapCr = staticData.marketCapCr;
              if (staticData.pe) screener.pe = staticData.pe;
              if (staticData.roe) screener.roe = staticData.roe;
              if (staticData.opm) screener.opm = staticData.opm;
              if (staticData.de !== null) screener.de = staticData.de;
              if (staticData.promoterPct !== null) screener.promoterPct = staticData.promoterPct;
              screener.marketCapCr = staticData.marketCapCr;
              // Derive ROCE from ROE and D/E if available
              if (staticData.roe && staticData.de !== null && !screener.roce) {
                screener.roce = staticData.roe / (1 + (staticData.de || 0));
              }
              errors.push('Static fallback data used — prices may be stale');
            }

            if (fallbackPrice > 0) {
              // We have data — proceed with degraded scoring
              nse.lastPrice = nse.lastPrice || fallbackPrice;
              quality.valid = true;
              quality.reason = null;
              quality.source = (usedStatic ? 'Static' : fallbackSource === 'yahoo_v7' || fallbackSource === 'yahoo_bse' ? 'partial' : fallbackSource || 'partial') as any;
              // Recalculate coverage after fallback chain filled data into screener/nse
              const postFallbackPoints = [
                screener.pe, screener.roce, screener.roe, screener.de,
                screener.opm, screener.promoterPct, screener.marketCapCr ?? nse.marketCapCr,
                screener.salesCagr5yr, screener.profitCagr5yr, screener.cfoPositive,
                nse.lastPrice, nse.pctFrom52H, screener.pledgedPct,
              ];
              const postAvail = postFallbackPoints.filter(v => v !== null && v !== undefined).length;
              quality.coveragePct = Math.round((postAvail / postFallbackPoints.length) * 100);
              quality.confidence = quality.coveragePct >= 60 ? 'HIGH' : quality.coveragePct >= 40 ? 'MEDIUM' : quality.coveragePct >= 15 ? 'LOW' : 'VERY_LOW';
              quality.staleness = usedStatic ? 'STALE' : 'FRESH';
              errors.push(`Fallback chain resolved — source: ${fallbackSource} (coverage: ${quality.coveragePct}%, confidence: ${quality.confidence})`);
            } else {
              // Even static data not available — return NR but with company name from static if possible
              const sData = STATIC_FALLBACK[symbol];
              return {
                symbol, company: sData?.company || company || symbol, sector: sData?.sector || sector,
                sectorGroup: 'UNKNOWN',
                lastPrice: null, marketCapCr: sData?.marketCapCr || null,
                overallScore: 0, grade: 'NR' as Grade,
                pillars: [], criteria: [],
                redFlags: [{ id: 'data_fail', label: 'Data Validation Failed', severity: 'CRITICAL', detail: quality.reason || 'Could not resolve company data from any source' }],
                quality, isPortfolio: portfolio.includes(symbol), isWatchlist: watchlist.includes(symbol),
                errors: [quality.reason || 'All data sources failed'],
              };
            }
          }

          const sectorGroup = getSectorGroup(sector);
          const benchmarks  = SECTOR_BENCHMARKS[sectorGroup] || SECTOR_BENCHMARKS.OTHER;

          // Score
          const criteria   = buildCriteria(screener, nse, sectorGroup, benchmarks);

          // Eligibility gate: don't assign meaningful grade with insufficient data
          const availableCount = criteria.filter(c => c.dataAvailable).length;
          const coverageRatio = criteria.length > 0 ? availableCount / criteria.length : 0;

          const pillars     = buildPillars(criteria);
          let rawScore    = compositeScore(pillars, criteria);
          const redFlags    = detectRedFlags(screener, nse);

          // NR gate uses SOURCE data coverage (validateData's coveragePct), not criteria coverage
          // Lowered from 40% to 15% — NSE-only stocks (23% data) should still get rated
          // as they have price, 52W data, and sometimes PE which is enough for basic scoring
          const sourceCoverage = quality.coveragePct / 100; // 0-1
          const isNR = sourceCoverage < 0.15; // <15% source data → NR (not rated)
          let grade: Grade = isNR ? 'NR' : computeGradeAbsolute(rawScore, redFlags); // temporary; forced distribution applied later
          if (isNR) {
            errors.push(`Low source data coverage (${quality.coveragePct}%) — grade NR`);
          } else if (sourceCoverage < 0.75) {
            errors.push(`Partial data (${quality.coveragePct}%) — confidence penalty applied`);
          }

          const mcap        = (screener.marketCapCr && screener.marketCapCr > 0) ? screener.marketCapCr
                            : (nse.marketCapCr && nse.marketCapCr > 0 ? nse.marketCapCr : null);

          // Real confidence: dataCoverage*0.5 + sourceReliability*0.3 + dataRecency*0.2
          const sourceScore = (scrResult.ok ? 35 : 0) + (nseResult.ok ? 25 : 0) + (yahooResult.ok ? 20 : 0) + (yahooV7Result.ok ? 10 : 0) + (Object.keys(nseFin).length > 0 ? 10 : 0);
          const realConfidence = Math.round(coverageRatio * 50 + Math.min(100, sourceScore) * 0.3 + (quality.staleness === 'FRESH' ? 20 : quality.staleness === 'STALE' ? 10 : 5));

          // Score already has confidence penalty baked in via compositeScore
          const overallScore = Math.max(0, isFinite(rawScore) ? rawScore : 0);
          const lastPrice   = (nse.lastPrice && isFinite(nse.lastPrice)) ? nse.lastPrice : null;

          // Compute confidence range based on real confidence
          const confMargin = realConfidence >= 70 ? 5 : realConfidence >= 50 ? 10 : realConfidence >= 30 ? 15 : 25;
          const scoreRange = { low: Math.max(0, overallScore - confMargin), high: Math.min(100, overallScore + confMargin) };

          const debugOut = (debug || symbol === debugSymbol) ? {
            sectorGroup, benchmarks,
            criteriaScores: criteria.map(c => ({ id: c.id, pillar: c.pillar, rawValue: c.rawValue, percentile: c.sectorPercentile, score: c.score, dataAvailable: c.dataAvailable })),
            pillarScores: pillars.map(p => ({ id: p.id, score: p.score, weight: p.weight, coverage: p.coverage })),
            rawComposite: rawScore, realConfidence, coverageRatio, overallScore, redFlagCount: redFlags.length,
          } : undefined;

          return {
            symbol, company, sector, sectorGroup,
            lastPrice, marketCapCr: mcap,
            overallScore, scoreRange, grade,
            pillars, criteria, redFlags, quality,
            isPortfolio: portfolio.includes(symbol),
            isWatchlist: watchlist.includes(symbol),
            ...(debugOut ? { _debug: debugOut } : {}),
            errors,
          };
        } catch (symbolErr: unknown) {
          // Per-symbol error — return degraded result instead of crashing
          const errMsg = symbolErr instanceof Error ? symbolErr.message : String(symbolErr);
          return {
            symbol, company: symbol, sector: 'Unknown', sectorGroup: 'UNKNOWN',
            lastPrice: null, marketCapCr: null,
            overallScore: 0, grade: 'NR' as Grade,
            pillars: [], criteria: [],
            redFlags: [{ id: 'symbol_error', label: 'Processing Error', severity: 'CRITICAL', detail: errMsg }],
            quality: { valid: false, reason: `Error: ${errMsg}`, coveragePct: 0, confidence: 'VERY_LOW', source: 'none', fetchedAt: new Date().toISOString(), staleness: 'UNKNOWN' },
            isPortfolio: portfolio.includes(symbol), isWatchlist: watchlist.includes(symbol),
            errors: [errMsg],
          };
        }
      }));
      results.push(...batchOut);
    }

    // ── SANITIZE ALL NUMBERS: NaN/Infinity → null ──
    const sanitizeObj = (obj: any): any => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === 'number') return isFinite(obj) ? obj : null;
      if (Array.isArray(obj)) return obj.map(sanitizeObj);
      if (typeof obj === 'object') {
        for (const k of Object.keys(obj)) {
          obj[k] = sanitizeObj(obj[k]);
        }
      }
      return obj;
    };
    for (const r of results) { sanitizeObj(r); }

    // ── ABSOLUTE GRADING — no forced distribution ──
    // Forced bell curve was hiding real quality differences.
    // Absolute grades (A+ ≥80, A ≥72, etc.) let the data speak.
    // Red flag overrides still apply (CRITICAL → max D, 2+ HIGH → max B).
    // assignForcedGrades(gradeable); // REMOVED — artificial grade distribution

    // Sort: valid first, then PURELY by score (best rank on top)
    // PF/WL badges are shown on cards but don't affect ranking — institutional approach
    results.sort((a, b) => {
      if (a.quality.valid !== b.quality.valid) return a.quality.valid ? -1 : 1;
      if (a.grade === 'NR' && b.grade !== 'NR') return 1;
      if (a.grade !== 'NR' && b.grade === 'NR') return -1;
      return b.overallScore - a.overallScore;
    });

    const validResults = results.filter(r => r.quality.valid);
    const topScore = validResults[0]?.overallScore ?? 0;
    const avgScore = validResults.length > 0
      ? Math.round(validResults.reduce((a, r) => a + (isFinite(r.overallScore) ? r.overallScore : 0), 0) / validResults.length)
      : 0;

    // ── TOP PICKS FALLBACK: if no A+/A, promote top 3 by score ──
    const topPickCount = validResults.filter(r => r.grade === 'A+' || r.grade === 'A').length;
    if (topPickCount === 0 && validResults.length >= 3) {
      // Mark top 3 as "Top Pick (relative)" without changing grade
      for (let i = 0; i < Math.min(3, validResults.length); i++) {
        if (validResults[i].grade !== 'NR') {
          (validResults[i] as any)._topPickFallback = true;
        }
      }
    }

    const degradedCount = results.filter(r => r.grade === 'NR' && r.quality.valid).length;
    const eligibleCount = validResults.filter(r => r.grade !== 'NR').length;
    const payload = {
      results,
      degradedMode: eligibleCount === 0 && results.length > 0,
      meta: {
        total: results.length,
        valid: validResults.length,
        eligible: eligibleCount,
        degraded: degradedCount,
        portfolio: portfolio.length,
        watchlist: watchlist.length,
        topScore, avgScore,
        topPicks: validResults.filter(r => r.grade === 'A+' || r.grade === 'A').length,
        computedAt: new Date().toISOString(),
        dataConfidence: validResults.length > 0
          ? Math.round(validResults.reduce((a, r) => a + r.quality.coveragePct, 0) / validResults.length) / 100
          : 0,
        methodology: '5-Pillar: Quality(30%) · Growth(25%) · FinStrength(20%) · Valuation(15%) · Market(10%) · Peer-normalized by sector',
      }
    };

    // Sanitize to ensure no NaN/Infinity escapes into JSON
    const sanitized = sanitizeForJSON(payload);

    // Cache successful results for stale fallback (TTL: 6 hours)
    if (validResults.length > 0) {
      const cacheKey = `multibagger:${allSymbols.sort().join(',')}`;
      try { await kvSet(cacheKey, sanitized, 21600); } catch { /* best effort cache */ }
    }

    return NextResponse.json(sanitized);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Multibagger] Fatal error:', msg);

    // ── CACHED FALLBACK: serve stale data on total failure ──
    try {
      const { searchParams } = new URL(request.url);
      const portfolioRaw = searchParams.get('portfolio') || '';
      const watchlistRaw = searchParams.get('watchlist') || '';
      const portfolio = portfolioRaw ? portfolioRaw.split(',').map(s => s.trim().toUpperCase()).filter(s => s.length >= 2) : [];
      const watchlist = watchlistRaw ? watchlistRaw.split(',').map(s => s.trim().toUpperCase()).filter(s => s.length >= 2) : [];
      const allSymbols = Array.from(new Set([...portfolio, ...watchlist]));
      const cacheKey = `multibagger:${allSymbols.sort().join(',')}`;
      const cached = await kvGet<any>(cacheKey);
      if (cached && cached.results && cached.results.length > 0) {
        console.log('[Multibagger] Serving stale cached results after fatal error');
        return NextResponse.json({ ...cached, _stale: true, _staleFallbackReason: msg });
      }
    } catch { /* cache miss — return error */ }

    return NextResponse.json(
      { results: [], error: msg, message: 'Internal error — please retry' },
      { status: 500 }
    );
  }
}
