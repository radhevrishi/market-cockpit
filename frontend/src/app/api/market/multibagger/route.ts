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

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

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
  source: 'screener.in + NSE' | 'NSE only' | 'partial' | 'none';
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
  'IT': 'TECHNOLOGY', 'Technology': 'TECHNOLOGY', 'Software': 'TECHNOLOGY',
  'Pharmaceuticals': 'PHARMA', 'Pharma': 'PHARMA', 'Healthcare': 'PHARMA', 'Hospitals': 'PHARMA',
  'Banking': 'BANKING_FIN', 'Financial Services': 'BANKING_FIN', 'NBFC': 'BANKING_FIN', 'Insurance': 'BANKING_FIN',
  'Capital Goods': 'INDUSTRIALS', 'Engineering': 'INDUSTRIALS', 'Industrial Machinery': 'INDUSTRIALS',
  'Infrastructure': 'INFRA', 'Cement': 'INFRA', 'Construction': 'INFRA',
  'Consumer Goods': 'CONSUMER', 'FMCG': 'CONSUMER', 'Retail': 'CONSUMER', 'Food Processing': 'CONSUMER',
  'Automobile': 'AUTO', 'Auto Components': 'AUTO', 'Electric Vehicles': 'AUTO',
  'Chemicals': 'CHEMICALS', 'Specialty Chemicals': 'CHEMICALS', 'Agrochemicals': 'CHEMICALS',
  'Defence': 'SUNRISE', 'Defense': 'SUNRISE', 'Aerospace': 'SUNRISE',
  'Renewable Energy': 'SUNRISE', 'Clean Energy': 'SUNRISE', 'Solar': 'SUNRISE',
  'Telecommunications': 'TELECOM', 'Telecom': 'TELECOM',
  'Metals': 'METALS', 'Steel': 'METALS', 'Mining': 'METALS',
  'Oil & Gas': 'ENERGY', 'Energy': 'ENERGY', 'Power': 'ENERGY',
  'Real Estate': 'REALTY', 'Realty': 'REALTY',
};

function getSectorGroup(sector: string): string {
  return SECTOR_GROUPS[sector] || 'OTHER';
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

// ── Screener.in HTML scraper ──────────────────────────────────────────────────
async function fetchScreenerData(symbol: string): Promise<{ data: Record<string, any>; ok: boolean; url: string }> {
  const urls = [
    `https://www.screener.in/company/${symbol}/consolidated/`,
    `https://www.screener.in/company/${symbol}/`,
  ];
  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketCockpit/2.0)', 'Accept': 'text/html' },
        signal: AbortSignal.timeout(9000),
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      // Quick validity check: screener shows 404 or empty pages with specific markers
      if (html.includes('Page not found') || html.includes('No results found') || html.length < 5000) continue;
      return { data: parseScreenerHTML(html, symbol), ok: true, url };
    } catch { continue; }
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

  const ratioRe = /<li[^>]*>[\s\S]*?<span[^>]*class="[^"]*name[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]*class="[^"]*number[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
  let m: RegExpExecArray | null;
  const ratios: Record<string, number | null> = {};
  while ((m = ratioRe.exec(ratioSection)) !== null) {
    const label = m[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
    const val   = num(m[2].replace(/<[^>]+>/g, '').trim());
    if (label && val !== null) ratios[label] = val;
  }

  // Map labels to our fields
  const get = (...keys: string[]): number | null => {
    for (const k of keys) {
      const found = Object.keys(ratios).find(r => r.includes(k.toLowerCase()));
      if (found !== undefined && ratios[found] !== null) return ratios[found]!;
    }
    return null;
  };

  d.pe           = get('stock p/e', 'p/e', 'pe ratio');
  d.roe          = get('return on equity', 'roe');
  d.roce         = get('roce', 'return on capital');
  d.de           = get('debt to equity', 'd/e');
  d.bookValue    = get('book value');
  d.eps          = get('eps', 'earning per');
  d.dividendYield= get('dividend yield');
  d.opm          = get('opm', 'operating profit margin');
  d.priceToBook  = get('price to book', 'p/b');
  d.marketCapCr  = get('market cap');
  d.salesGrowth  = get('sales growth');
  d.currentRatio = get('current ratio');
  d.interestCoverage = get('interest coverage');

  // Promoter holding — from shareholding section
  const promoterRe = /Promoters?[\s\S]{0,300}?(\d{1,3}\.?\d*)\s*%/i;
  const pm = html.match(promoterRe);
  d.promoterPct = pm ? num(pm[1]) : null;

  // Pledged % — often shown as sub-item under promoter
  const pledgeRe = /[Pp]ledged[\s\S]{0,200}?(\d{1,3}\.?\d*)\s*%/;
  const plm = html.match(pledgeRe);
  d.pledgedPct = plm ? num(plm[1]) : null;

  // 5-yr CAGR: look for CAGR tables
  const salesCagrRe = /[Ss]ales\s*CAGR[\s\S]{0,100}?(\d{1,3}\.?\d*)/;
  const scm = html.match(salesCagrRe);
  d.salesCagr5yr = scm ? num(scm[1]) : null;

  const profitCagrRe = /[Pp]rofit\s*CAGR[\s\S]{0,100}?(\d{1,3}\.?\d*)/;
  const pcm = html.match(profitCagrRe);
  d.profitCagr5yr = pcm ? num(pcm[1]) : null;

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

// ── NSE Quote fetcher ─────────────────────────────────────────────────────────
async function fetchNSEData(symbol: string): Promise<{ data: Record<string, any>; ok: boolean }> {
  try {
    // Try NSE equity quote
    const resp = await fetch(`https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(symbol)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://www.nseindia.com/' },
      signal: AbortSignal.timeout(7000),
    });
    if (!resp.ok) return { data: {}, ok: false };
    const json = await resp.json();
    const info = json?.priceInfo || {};
    const meta = json?.metadata || {};
    const h52  = info['52WeekHigh'] as number | undefined;
    const l52  = info['52WeekLow'] as number | undefined;
    const lp   = info.lastPrice as number | undefined;
    return {
      ok: true,
      data: {
        lastPrice:   lp ?? null,
        high52:      h52 ?? null,
        low52:       l52 ?? null,
        pctFrom52H:  (h52 && lp) ? ((lp / h52) - 1) * 100 : null,   // negative = below high
        pctFrom52L:  (l52 && lp) ? ((lp - l52) / l52) * 100 : null,
        pChange:     info.pChange ?? null,
        volume:      info.totalTradedVolume ?? null,
        sector:      meta.industry ?? meta.sector ?? null,
        companyName: meta.companyName ?? null,
        series:      meta.series ?? null,
        marketCapCr: meta.marketCap ?? null,
      }
    };
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
  if (sector === 'Unknown' || sector === '' || sector === 'S') return { valid: false, reason: 'Symbol did not resolve to a company', coveragePct, confidence: 'VERY_LOW', source: 'none', fetchedAt: new Date().toISOString(), staleness: 'UNKNOWN' };
  if (!nse.lastPrice || nse.lastPrice <= 0) return { valid: false, reason: 'Invalid or zero price — symbol may be delisted or mapping error', coveragePct, confidence: 'VERY_LOW', source: screenerOk ? 'partial' : 'none', fetchedAt: new Date().toISOString(), staleness: 'UNKNOWN' };

  const source: DataQuality['source'] = screenerOk && nseOk ? 'screener.in + NSE' : nseOk ? 'NSE only' : screenerOk ? 'partial' : 'none';
  const confidence: DataQuality['confidence'] = coveragePct >= 75 ? 'HIGH' : coveragePct >= 50 ? 'MEDIUM' : coveragePct >= 30 ? 'LOW' : 'VERY_LOW';

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
function peerNormalize(value: number, thresholds: number[], inverted = false): number {
  if (!isFinite(value) || isNaN(value)) return 50; // missing data → neutral
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

function peerPercentile(value: number, thresholds: number[], inverted = false): number {
  return Math.round(clamp(peerNormalize(value, thresholds, inverted)));
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
    flags.push({ id: 'extreme_debt', label: 'Extreme Leverage', severity: 'CRITICAL', detail: `D/E ratio ${screener.de.toFixed(2)} — extreme debt load; bankruptcy risk in downturn` });
  } else if (screener.de !== null && screener.de > 2.0) {
    flags.push({ id: 'high_debt', label: 'High Debt', severity: 'HIGH', detail: `D/E ratio ${screener.de.toFixed(2)} — debt level significantly limits compounding potential` });
  }

  if (screener.pledgedPct !== null && screener.pledgedPct > 50) {
    flags.push({ id: 'high_pledge', label: 'Critical Pledge Level', severity: 'CRITICAL', detail: `${screener.pledgedPct.toFixed(1)}% of promoter shares pledged — forced selling risk` });
  } else if (screener.pledgedPct !== null && screener.pledgedPct > 25) {
    flags.push({ id: 'moderate_pledge', label: 'Elevated Pledging', severity: 'HIGH', detail: `${screener.pledgedPct.toFixed(1)}% promoter shares pledged — watch for escalation` });
  }

  if (screener.cfoPositive === false) {
    flags.push({ id: 'negative_cfo', label: 'Negative Operating Cash Flow', severity: 'HIGH', detail: 'Operations burning cash — earnings quality suspect; may require dilution' });
  }

  if (screener.promoterPct !== null && screener.promoterPct < 20) {
    flags.push({ id: 'low_promoter', label: 'Very Low Promoter Holding', severity: 'HIGH', detail: `Only ${screener.promoterPct.toFixed(1)}% promoter holding — misaligned incentives` });
  }

  if (screener.roce !== null && screener.roce < 0) {
    flags.push({ id: 'negative_roce', label: 'Negative ROCE', severity: 'CRITICAL', detail: `ROCE ${screener.roce.toFixed(1)}% — destroying capital, not creating it` });
  }

  if (screener.pe !== null && screener.pe > 150) {
    flags.push({ id: 'extreme_pe', label: 'Extreme Valuation', severity: 'MEDIUM', detail: `P/E of ${screener.pe.toFixed(0)}x — requires exceptional multi-year growth to justify` });
  }

  if (screener.interestCoverage !== null && screener.interestCoverage < 1.5) {
    flags.push({ id: 'low_icr', label: 'Weak Interest Coverage', severity: 'HIGH', detail: `ICR ${screener.interestCoverage.toFixed(1)}x — earnings barely cover interest; distress risk` });
  }

  if (nse.pctFrom52H !== null && nse.pctFrom52H < -60) {
    flags.push({ id: 'deep_drawdown', label: 'Deep Drawdown', severity: 'MEDIUM', detail: `${Math.abs(nse.pctFrom52H).toFixed(0)}% below 52W high — investigate fundamental reason` });
  }

  return flags;
}

// ── Grade from score + red flags ─────────────────────────────────────────────
function computeGrade(score: number, flags: RedFlag[]): Grade {
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
    scoreRaw: number | null,         // pre-computed score (0-100) if no peer bench
    sectorPercentile: number | null,
    weight: number,
    insight: string
  ): void => {
    // Sanitize: NaN / Infinity → neutral 50 to avoid JSON serialization issues
    const rawScore = scoreRaw !== null && isFinite(scoreRaw) && !isNaN(scoreRaw) ? scoreRaw : 50;
    const score = Math.round(clamp(rawScore));
    const pct = sectorPercentile !== null && isFinite(sectorPercentile) ? Math.round(clamp(sectorPercentile)) : null;
    criteria.push({ id, label, pillar, rawValue, rawDisplay, sectorPercentile: pct, score, signal: sig(score), weight, insight, dataAvailable: rawValue !== null });
  };

  // ── QUALITY PILLAR ────────────────────────────────────────────────────────
  const roce = screener.roce;
  if (roce !== null) {
    const s = peerNormalize(roce, benchmarks.roce);
    c('roce', 'ROCE', 'QUALITY', roce, `${roce.toFixed(1)}%`, s, peerPercentile(roce, benchmarks.roce), 10,
      roce >= benchmarks.roce[2] ? `Excellent — top quartile ROCE for ${sectorGroup}` : roce >= benchmarks.roce[1] ? 'Good capital efficiency' : roce >= benchmarks.roce[0] ? 'Below sector median — room to improve' : 'Poor ROCE — capital destruction risk');
  } else {
    c('roce', 'ROCE', 'QUALITY', null, 'N/A', 45, null, 10, 'ROCE data unavailable — confidence reduced');
  }

  const roe = screener.roe;
  if (roe !== null) {
    const bm = [benchmarks.roce[0] * 0.9, benchmarks.roce[1] * 0.85, benchmarks.roce[2] * 0.8];
    const s = peerNormalize(roe, bm);
    c('roe', 'ROE', 'QUALITY', roe, `${roe.toFixed(1)}%`, s, peerPercentile(roe, bm), 8,
      roe >= 20 ? 'Strong shareholder returns' : roe >= 12 ? 'Adequate ROE' : 'ROE below acceptable — watch reinvestment');
  } else {
    c('roe', 'ROE', 'QUALITY', null, 'N/A', 45, null, 8, 'ROE unavailable');
  }

  const opm = screener.opm;
  if (opm !== null) {
    const s = peerNormalize(opm, benchmarks.opm);
    c('opm', 'Operating Margin', 'QUALITY', opm, `${opm.toFixed(1)}%`, s, peerPercentile(opm, benchmarks.opm), 8,
      opm >= benchmarks.opm[2] ? 'Exceptional margins — pricing power moat' : opm >= benchmarks.opm[1] ? 'Strong operating leverage' : opm >= benchmarks.opm[0] ? 'Sector-average margins' : 'Thin margins vs sector — competitive pressure');
  } else {
    c('opm', 'Operating Margin', 'QUALITY', null, 'N/A', 45, null, 8, 'OPM unavailable');
  }

  const cfoPos = screener.cfoPositive;
  const cfoScore = cfoPos === true ? 85 : cfoPos === false ? 15 : 45;
  c('cfo', 'CFO Quality', 'QUALITY', cfoPos === null ? null : (cfoPos ? 1 : 0), cfoPos === true ? 'Positive' : cfoPos === false ? 'Negative ⚠️' : 'N/A', cfoScore, null, 9,
    cfoPos === true ? 'Real cash generator — earnings quality confirmed' : cfoPos === false ? 'Operations burn cash — earnings may be accounting-only' : 'Cash flow data unavailable');

  // Capital allocation composite (ROCE + low D/E + positive CFO)
  let capAllocScore: number;
  if (roce !== null || screener.de !== null) {
    const roceContrib = roce !== null ? peerNormalize(roce, benchmarks.roce) * 0.4 : 22;
    const deContrib   = screener.de !== null ? peerNormalize(screener.de, [0.5, 1.2, 2.5], true) * 0.35 : 17;
    const cfoContrib  = cfoPos === true ? 25 : cfoPos === false ? 5 : 12;
    capAllocScore = roceContrib + deContrib + cfoContrib;
  } else { capAllocScore = 45; }
  c('capital_alloc', 'Capital Allocation', 'QUALITY', null, `ROCE ${roce?.toFixed(0) ?? 'N/A'}% · D/E ${screener.de?.toFixed(2) ?? 'N/A'} · CFO ${cfoPos === true ? '✓' : cfoPos === false ? '✗' : '?'}`, capAllocScore, null, 9,
    capAllocScore >= 78 ? 'Exemplary capital allocators — rare institutional quality' : capAllocScore >= 63 ? 'Good capital discipline' : 'Capital allocation needs improvement');

  // ── GROWTH PILLAR ─────────────────────────────────────────────────────────
  const revCagr = screener.salesCagr5yr;
  if (revCagr !== null) {
    const s = peerNormalize(revCagr, benchmarks.revenueGrowth);
    c('rev_cagr', 'Revenue CAGR (5yr)', 'GROWTH', revCagr, `${revCagr.toFixed(1)}%`, s, peerPercentile(revCagr, benchmarks.revenueGrowth), 9,
      revCagr >= benchmarks.revenueGrowth[2] ? 'Exceptional revenue momentum — market share gains likely' : revCagr >= benchmarks.revenueGrowth[1] ? 'Strong growth — outpacing sector' : revCagr >= benchmarks.revenueGrowth[0] ? 'Sector-average growth' : 'Below-sector growth — needs catalysts');
  } else {
    c('rev_cagr', 'Revenue CAGR (5yr)', 'GROWTH', null, 'N/A', 40, null, 9, '5yr revenue CAGR unavailable — key growth metric missing');
  }

  const profCagr = screener.profitCagr5yr;
  if (profCagr !== null) {
    const profBm = [benchmarks.revenueGrowth[0] * 1.3, benchmarks.revenueGrowth[1] * 1.4, benchmarks.revenueGrowth[2] * 1.5];
    const s = peerNormalize(profCagr, profBm);
    c('profit_cagr', 'Profit CAGR (5yr)', 'GROWTH', profCagr, `${profCagr.toFixed(1)}%`, s, peerPercentile(profCagr, profBm), 10,
      profCagr >= profBm[2] ? 'Exceptional profit compounding — operating leverage confirmed' : profCagr >= profBm[1] ? 'Profit growing faster than sector' : profCagr >= profBm[0] ? 'Moderate profit growth' : profCagr < 0 ? 'Profit declining — earnings reversal risk' : 'Profit growth lagging sector');
  } else {
    c('profit_cagr', 'Profit CAGR (5yr)', 'GROWTH', null, 'N/A', 40, null, 10, '5yr profit CAGR unavailable — growth quality unknown');
  }

  // Revenue predictability (YoY quarterly growth consistency)
  const yoyRev = screener.revenueGrowthYoY;
  if (yoyRev !== null) {
    const yoyScore = yoyRev >= 20 ? 82 : yoyRev >= 12 ? 68 : yoyRev >= 5 ? 54 : yoyRev >= 0 ? 40 : 22;
    c('rev_visibility', 'Revenue Visibility (YoY)', 'GROWTH', yoyRev, `${yoyRev.toFixed(1)}% YoY`, yoyScore, null, 6,
      yoyRev >= 12 ? 'Consistent demand — predictable revenue base' : yoyRev >= 0 ? 'Modest growth — assess order book' : 'Revenue contracting — high risk');
  } else {
    c('rev_visibility', 'Revenue Visibility (YoY)', 'GROWTH', null, 'N/A', 42, null, 6, 'Quarterly comparison data unavailable');
  }

  // ── FINANCIAL STRENGTH PILLAR ─────────────────────────────────────────────
  const de = screener.de;
  if (de !== null) {
    // Lower D/E = better, so inverted. Thresholds: [comfortable, moderate, stretched]
    const s = peerNormalize(de, [0.5, 1.2, 2.5], true);
    c('de_ratio', 'Debt-to-Equity', 'FIN_STRENGTH', de, `${de.toFixed(2)}x`, s, null, 10,
      de <= 0.3 ? 'Near debt-free — financial fortress' : de <= 0.7 ? 'Conservative leverage' : de <= 1.5 ? 'Manageable debt — monitor trend' : de <= 3 ? 'High debt — limits compounding' : 'Dangerous leverage — restructuring risk');
  } else {
    c('de_ratio', 'Debt-to-Equity', 'FIN_STRENGTH', null, 'N/A', 45, null, 10, 'Debt data unavailable');
  }

  const promoter = screener.promoterPct;
  if (promoter !== null) {
    const s = peerNormalize(promoter, [35, 50, 65]);
    c('promoter', 'Promoter Holding', 'FIN_STRENGTH', promoter, `${promoter.toFixed(1)}%`, s, null, 8,
      promoter >= 65 ? 'High conviction — founder-led with skin in the game' : promoter >= 50 ? 'Adequate promoter alignment' : promoter >= 35 ? 'Moderate holding — watch for dilution' : 'Low promoter holding — governance concern');
  } else {
    c('promoter', 'Promoter Holding', 'FIN_STRENGTH', null, 'N/A', 45, null, 8, 'Shareholding data unavailable');
  }

  const pledged = screener.pledgedPct ?? 0;
  const pledgeScore = pledged <= 3 ? 90 : pledged <= 10 ? 76 : pledged <= 25 ? 55 : pledged <= 50 ? 30 : 8;
  c('pledge', 'Promoter Pledge %', 'FIN_STRENGTH', pledged, `${pledged.toFixed(1)}%`, pledgeScore, null, 8,
    pledged <= 3 ? 'Zero/minimal pledging — no distress risk' : pledged <= 10 ? 'Low pledging — acceptable' : pledged <= 25 ? 'Moderate pledge — watch for increase' : 'High pledge — forced selling risk');

  const icr = screener.interestCoverage;
  if (icr !== null) {
    const icrScore = icr >= 8 ? 88 : icr >= 4 ? 72 : icr >= 2 ? 52 : icr >= 1 ? 32 : 10;
    c('icr', 'Interest Coverage', 'FIN_STRENGTH', icr, `${icr.toFixed(1)}x`, icrScore, null, 7,
      icr >= 8 ? 'Earnings comfortably cover interest — financial resilience' : icr >= 4 ? 'Adequate coverage' : icr >= 2 ? 'Thin coverage — limited buffer' : 'Interest coverage critical');
  } else {
    c('icr', 'Interest Coverage', 'FIN_STRENGTH', null, 'N/A', 50, null, 7, 'Interest coverage ratio unavailable');
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
    c('pe', 'P/E vs Sector', 'VALUATION', pe, `${pe.toFixed(1)}x (sector median ${bm[0]}x)`, peScore, null, 9,
      pe <= bm[1] && pe >= bm[0] * 0.6 ? 'Fair to reasonable valuation for sector' : pe > bm[2] ? `Premium valuation — ${((pe / bm[0] - 1) * 100).toFixed(0)}% above sector median` : pe < bm[0] * 0.6 ? 'Discounted vs sector — check if value trap' : 'Moderate premium');
  } else {
    c('pe', 'P/E vs Sector', 'VALUATION', null, 'N/A', 45, null, 9, 'P/E unavailable — valuation pillar weakened');
  }

  const pb = screener.priceToBook;
  if (pb !== null) {
    const pbScore = pb >= 1 && pb <= 4 ? 72 : pb > 4 && pb <= 8 ? 58 : pb < 1 && pb > 0.3 ? 62 : pb > 8 ? 38 : 45;
    c('pb', 'Price-to-Book', 'VALUATION', pb, `${pb.toFixed(2)}x`, pbScore, null, 6,
      pb >= 1 && pb <= 4 ? 'Reasonable P/B — quality at fair price' : pb > 8 ? 'Very expensive vs book' : 'Discounted to book — assess asset quality');
  } else {
    c('pb', 'Price-to-Book', 'VALUATION', null, 'N/A', 45, null, 6, 'P/B unavailable');
  }

  // FCF yield proxy (positive CFO with reasonable PE)
  let fcfScore = 50;
  if (cfoPos !== null && pe !== null) {
    fcfScore = cfoPos ? (pe <= benchmarks.pe[1] ? 80 : pe <= benchmarks.pe[2] ? 65 : 52) : 20;
  } else if (cfoPos === true) { fcfScore = 68; }
  c('fcf', 'FCF Quality', 'VALUATION', null, cfoPos === true ? 'Positive' : cfoPos === false ? 'Negative' : 'N/A', fcfScore, null, 6,
    fcfScore >= 75 ? 'Compounding engine confirmed — FCF supports valuation' : fcfScore <= 25 ? 'Cash-burning at current price — valuation risk elevated' : 'FCF quality moderate');

  // Market cap sweet spot (500Cr-15000Cr = highest multibagger probability)
  const mcap = screener.marketCapCr ?? nse.marketCapCr;
  if (mcap && mcap > 0) {
    const mcapScore = (mcap >= 500 && mcap <= 15000) ? 82 : (mcap > 15000 && mcap <= 50000) ? 65 : (mcap < 500 && mcap >= 100) ? 72 : (mcap < 100) ? 50 : 48;
    c('mcap', 'Market Cap Zone', 'VALUATION', mcap, `₹${(mcap / 100).toFixed(0)}B`, mcapScore, null, 5,
      mcap >= 500 && mcap <= 15000 ? 'Sweet spot — large enough to execute, small enough for 5x+' : mcap > 50000 ? 'Large cap — steady compounder, not a multibagger' : mcap < 100 ? 'Micro cap — high risk, liquidity concern' : 'Reasonable size');
  } else {
    c('mcap', 'Market Cap Zone', 'VALUATION', null, 'Data unavailable', 42, null, 5, 'Market cap missing — cannot assess size risk');
  }

  // ── MARKET / TECHNICAL PILLAR ─────────────────────────────────────────────
  const pctH = nse.pctFrom52H;
  if (pctH !== null) {
    const below = Math.abs(Math.min(0, pctH));
    const momScore = below <= 8 ? 84 : below <= 20 ? 70 : below <= 35 ? 55 : below <= 55 ? 38 : 22;
    c('momentum', '52W Momentum', 'MARKET', pctH, `${Math.abs(pctH).toFixed(1)}% from 52W high`, momScore, null, 7,
      below <= 8 ? 'Near 52W high — institutional accumulation confirmed' : below <= 20 ? 'Modest pull-back — healthy consolidation' : below <= 40 ? 'Meaningful correction — assess fundamental cause' : 'Deep drawdown — high conviction needed');
  } else {
    c('momentum', '52W Momentum', 'MARKET', null, 'N/A', 45, null, 7, 'Price data unavailable from NSE');
  }

  // Sector tailwind (structural multibagger advantage)
  const isSunrise = ['SUNRISE', 'TECHNOLOGY'].includes(sectorGroup);
  const isStable  = ['CONSUMER', 'PHARMA', 'BANKING_FIN'].includes(sectorGroup);
  const tailwindScore = isSunrise ? 86 : isStable ? 70 : 58;
  c('sector_tail', 'Sector Tailwind', 'MARKET', null,
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
    const totalW = items.reduce((a, c) => a + c.weight, 0);
    const weighted = items.reduce((a, c) => a + c.score * c.weight, 0);
    const score = totalW > 0 ? Math.round(weighted / totalW) : 50;
    const coverage = items.length > 0 ? items.filter(c => c.dataAvailable).length / items.length : 0;
    const sorted = [...items].sort((a, b) => b.score - a.score);
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

// ── Final composite score ─────────────────────────────────────────────────────
function compositeScore(pillars: PillarScore[]): number {
  const total = pillars.reduce((a, p) => a + p.score * p.weight, 0);
  return Math.round(total);
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

    if (allSymbols.length === 0) {
      return NextResponse.json({ results: [], message: 'Add companies to your portfolio or watchlist to see multibagger analysis.' });
    }

    const results: MultibaggerResult[] = [];

    // Process in batches of 3 to avoid rate limits
    const BATCH = 3;
    for (let i = 0; i < allSymbols.length; i += BATCH) {
      const batch = allSymbols.slice(i, i + BATCH);
      const batchOut = await Promise.all(batch.map(async (symbol): Promise<MultibaggerResult> => {
        try {
          const errors: string[] = [];

          const [scrResult, nseResult] = await Promise.all([
            fetchScreenerData(symbol).catch((): { data: Record<string, any>; ok: boolean; url: string } => ({ data: {}, ok: false, url: '' })),
            fetchNSEData(symbol).catch((): { data: Record<string, any>; ok: boolean } => ({ data: {}, ok: false })),
          ]);

          const screener: Record<string, any> = scrResult.data || {};
          const nse: Record<string, any>      = nseResult.data || {};

          // Resolve company name and sector
          const company   = String(nse.companyName || screener.companyName || symbol);
          const rawSector = String(nse.sector || screener.sector || '');
          const sector    = rawSector || 'Unknown';

          // Data quality gate
          const quality = validateData(symbol, company, sector, screener, nse, scrResult.ok, nseResult.ok);
          if (!quality.valid) {
            return {
              symbol, company, sector,
              sectorGroup: 'UNKNOWN',
              lastPrice: null, marketCapCr: null,
              overallScore: 0, grade: 'NR' as Grade,
              pillars: [], criteria: [],
              redFlags: [{ id: 'data_fail', label: 'Data Validation Failed', severity: 'CRITICAL', detail: quality.reason || 'Could not resolve company data' }],
              quality, isPortfolio: portfolio.includes(symbol), isWatchlist: watchlist.includes(symbol),
              errors: [quality.reason || 'Data validation failed'],
            };
          }

          const sectorGroup = getSectorGroup(sector);
          const benchmarks  = SECTOR_BENCHMARKS[sectorGroup] || SECTOR_BENCHMARKS.OTHER;

          // Score
          const criteria   = buildCriteria(screener, nse, sectorGroup, benchmarks);
          const pillars     = buildPillars(criteria);
          const rawScore    = compositeScore(pillars);
          const redFlags    = detectRedFlags(screener, nse);
          const grade       = computeGrade(rawScore, redFlags);
          const mcap        = (screener.marketCapCr && screener.marketCapCr > 0) ? screener.marketCapCr
                            : (nse.marketCapCr && nse.marketCapCr > 0 ? nse.marketCapCr : null);
          const confPenalty = quality.confidence === 'LOW' ? 5 : quality.confidence === 'VERY_LOW' ? 12 : 0;
          const overallScore = Math.max(0, isFinite(rawScore) ? rawScore - confPenalty : 0);
          const lastPrice   = (nse.lastPrice && isFinite(nse.lastPrice)) ? nse.lastPrice : null;

          const debugOut = (debug || symbol === debugSymbol) ? {
            sectorGroup, benchmarks,
            criteriaScores: criteria.map(c => ({ id: c.id, pillar: c.pillar, rawValue: c.rawValue, percentile: c.sectorPercentile, score: c.score })),
            pillarScores: pillars.map(p => ({ id: p.id, score: p.score, weight: p.weight, coverage: p.coverage })),
            rawComposite: rawScore, confPenalty, overallScore, redFlagCount: redFlags.length,
          } : undefined;

          return {
            symbol, company, sector, sectorGroup,
            lastPrice, marketCapCr: mcap,
            overallScore, grade,
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

    // Sort: valid first, then portfolio, then by score
    results.sort((a, b) => {
      if (a.quality.valid !== b.quality.valid) return a.quality.valid ? -1 : 1;
      if (a.isPortfolio && !b.isPortfolio) return -1;
      if (!a.isPortfolio && b.isPortfolio) return 1;
      return b.overallScore - a.overallScore;
    });

    const validResults = results.filter(r => r.quality.valid);
    const topScore = validResults[0]?.overallScore ?? 0;
    const avgScore = validResults.length > 0
      ? Math.round(validResults.reduce((a, r) => a + (isFinite(r.overallScore) ? r.overallScore : 0), 0) / validResults.length)
      : 0;

    const payload = {
      results,
      meta: {
        total: results.length,
        valid: validResults.length,
        portfolio: portfolio.length,
        watchlist: watchlist.length,
        topScore, avgScore,
        topPicks: validResults.filter(r => r.grade === 'A+' || r.grade === 'A').length,
        computedAt: new Date().toISOString(),
        methodology: '5-Pillar: Quality(30%) · Growth(25%) · FinStrength(20%) · Valuation(15%) · Market(10%) · Peer-normalized by sector',
      }
    };

    // Sanitize to ensure no NaN/Infinity escapes into JSON
    return NextResponse.json(sanitizeForJSON(payload));

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Multibagger] Fatal error:', msg);
    return NextResponse.json(
      { results: [], error: msg, message: 'Internal error — please retry' },
      { status: 500 }
    );
  }
}
