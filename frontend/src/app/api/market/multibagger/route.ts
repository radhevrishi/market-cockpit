/**
 * /api/market/multibagger
 * Institutional-grade multibagger scoring engine.
 * Fetches data from screener.in and NSE for each portfolio/watchlist company.
 * Scores 20 criteria. Returns ranked list with color-coded per-criterion scores.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// ── Multibagger criteria definitions ──────────────────────────────────────────
export interface MultibaggerCriterion {
  id: string;
  label: string;
  description: string;
  weight: number; // 1-10
  score: number;  // 0-100
  signal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'CAUTION' | 'AVOID';
  value: string;  // human-readable current value
  insight: string; // 1-line interpretation
}

export interface MultibaggerResult {
  symbol: string;
  company: string;
  sector: string;
  lastPrice: number | null;
  marketCapCr: number | null;
  overallScore: number;       // 0-100 weighted composite
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D';
  criteria: MultibaggerCriterion[];
  isPortfolio: boolean;
  isWatchlist: boolean;
  computedAt: string;
  dataSource: 'screener.in + NSE' | 'NSE only' | 'partial';
  errors: string[];
}

// Signal → color mapping for UI
export const SIGNAL_COLOR: Record<string, string> = {
  STRONG_BUY: '#10b981',  // emerald
  BUY: '#34d399',
  NEUTRAL: '#f59e0b',
  CAUTION: '#f97316',
  AVOID: '#ef4444',
};

// ── Screener.in HTML scraper ──────────────────────────────────────────────────
async function fetchScreenerData(symbol: string): Promise<Record<string, any>> {
  const urls = [
    `https://www.screener.in/company/${symbol}/consolidated/`,
    `https://www.screener.in/company/${symbol}/`,
  ];

  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MarketCockpit/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      return parseScreenerHTML(html, symbol);
    } catch { continue; }
  }
  return {};
}

function extractNumber(text: string | undefined | null): number | null {
  if (!text) return null;
  const cleaned = text.replace(/,/g, '').replace(/%/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseScreenerHTML(html: string, symbol: string): Record<string, any> {
  const data: Record<string, any> = { symbol };

  const ratio = (label: string): number | null => {
    // Match screener.in ratio tables: "Market Cap", "P/E", etc.
    const patterns = [
      new RegExp(`<li[^>]*>\\s*<span[^>]*>\\s*${label}\\s*<\\/span>\\s*<span[^>]*>([^<]+)<\\/span>`, 'i'),
      new RegExp(`${label}[^\\d]*([\\d,\\.]+)`, 'i'),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) return extractNumber(m[1]);
    }
    return null;
  };

  // Key financial ratios
  data.pe = ratio('Stock P\\/E') ?? ratio('P\\/E');
  data.roe = ratio('Return on equity') ?? ratio('ROE');
  data.roce = ratio('ROCE') ?? ratio('Return on capital');
  data.de = ratio('Debt to equity') ?? ratio('D\\/E');
  data.bookValue = ratio('Book Value');
  data.eps = ratio('EPS');
  data.faceValue = ratio('Face Value');
  data.dividendYield = ratio('Dividend Yield');
  data.salesGrowth = ratio('Sales growth');

  // Market cap (in Cr)
  const mcapRaw = ratio('Market Cap');
  data.marketCapCr = mcapRaw;

  // Promoter holding
  const promoterMatch = html.match(/Promoters?\s*[\s\S]*?(\d+\.?\d*)\s*%/i) ??
                         html.match(/promoter[^%]*?(\d+\.?\d*)\s*%/i);
  data.promoterPct = promoterMatch ? extractNumber(promoterMatch[1]) : null;

  // Pledged %
  const pledgeMatch = html.match(/Pledged\s*[\s\S]*?(\d+\.?\d*)\s*%/i);
  data.pledgedPct = pledgeMatch ? extractNumber(pledgeMatch[1]) : null;

  // Quarterly revenue trend (last 4 quarters)
  const qtrRevMatches = html.match(/<td[^>]*>([0-9,]+)<\/td>/g);
  if (qtrRevMatches && qtrRevMatches.length >= 8) {
    const nums = qtrRevMatches.slice(0, 8).map(m => {
      const inner = m.replace(/<[^>]+>/g, '').replace(/,/g, '');
      return parseFloat(inner);
    }).filter(n => !isNaN(n) && n > 0);
    if (nums.length >= 2) {
      data.revenueGrowthQoQ = ((nums[0] - nums[1]) / Math.abs(nums[1])) * 100;
    }
  }

  // Cash flow from operations (CFO) — positive is good
  const cfoMatch = html.match(/Cash from Operations[^>]*>[\s\S]*?([+-]?\d[\d,\.]*)/i);
  data.cfoPositive = cfoMatch ? (extractNumber(cfoMatch[1]) || 0) > 0 : null;

  // OPM (Operating Profit Margin)
  const opmMatch = html.match(/OPM\s*%[^%]*(\d+\.?\d*)\s*%/i);
  data.opm = opmMatch ? extractNumber(opmMatch[1]) : null;

  // Net profit margin
  const npmMatch = html.match(/Net Profit[^>]*Margin[^%]*(\d+\.?\d*)\s*%/i);
  data.npm = npmMatch ? extractNumber(npmMatch[1]) : null;

  // Sales CAGR
  const salesCagrMatch = html.match(/Sales CAGR[^%]*(\d+\.?\d*)\s*%/i);
  data.salesCagr5yr = salesCagrMatch ? extractNumber(salesCagrMatch[1]) : null;

  // Profit CAGR
  const profitCagrMatch = html.match(/Profit CAGR[^%]*(\d+\.?\d*)\s*%/i);
  data.profitCagr5yr = profitCagrMatch ? extractNumber(profitCagrMatch[1]) : null;

  // Price/Book
  const pbMatch = html.match(/Price to Book[^>]*>[\s\S]*?([+-]?\d[\d,\.]*)/i);
  data.priceToBook = pbMatch ? extractNumber(pbMatch[1]) : null;

  return data;
}

// ── NSE Quote fetcher ─────────────────────────────────────────────────────────
async function fetchNSEQuote(symbol: string): Promise<Record<string, any>> {
  try {
    const url = `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(symbol)}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
        'Referer': 'https://www.nseindia.com/',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) return {};
    const json = await resp.json();
    const info = json?.priceInfo || {};
    const metadata = json?.metadata || {};
    return {
      lastPrice: info.lastPrice || null,
      pct52wHigh: info['52WeekHigh'] ? ((info.lastPrice / info['52WeekHigh']) - 1) * 100 : null,
      pct52wLow: info['52WeekLow'] ? ((info.lastPrice - info['52WeekLow']) / info['52WeekLow']) * 100 : null,
      sector: metadata.industry || metadata.sector || null,
      companyName: metadata.companyName || null,
      series: metadata.series || null,
    };
  } catch { return {}; }
}

// ── 20-Criteria Scoring Engine ────────────────────────────────────────────────
function scoreMultibagger(screener: Record<string, any>, nse: Record<string, any>): MultibaggerCriterion[] {
  const criteria: MultibaggerCriterion[] = [];

  const add = (
    id: string, label: string, description: string, weight: number,
    rawValue: number | null | boolean,
    thresholds: { strong: number; buy: number; neutral: number; caution: number },
    formatter: (v: number) => string,
    insight: string
  ) => {
    if (rawValue === null || rawValue === undefined) {
      criteria.push({ id, label, description, weight, score: 50, signal: 'NEUTRAL', value: 'N/A', insight: 'Data unavailable' });
      return;
    }
    const v = typeof rawValue === 'boolean' ? (rawValue ? 100 : 0) : rawValue;
    let score: number;
    let signal: MultibaggerCriterion['signal'];
    if (v >= thresholds.strong) { score = 85 + Math.min(15, (v - thresholds.strong) * 2); signal = 'STRONG_BUY'; }
    else if (v >= thresholds.buy) { score = 65 + ((v - thresholds.buy) / (thresholds.strong - thresholds.buy)) * 20; signal = 'BUY'; }
    else if (v >= thresholds.neutral) { score = 45 + ((v - thresholds.neutral) / (thresholds.buy - thresholds.neutral)) * 20; signal = 'NEUTRAL'; }
    else if (v >= thresholds.caution) { score = 25 + ((v - thresholds.caution) / (thresholds.neutral - thresholds.caution)) * 20; signal = 'CAUTION'; }
    else { score = Math.max(0, 25 - (thresholds.caution - v) * 2); signal = 'AVOID'; }
    criteria.push({ id, label, description, weight, score: Math.round(Math.min(100, Math.max(0, score))), signal, value: typeof rawValue === 'boolean' ? (rawValue ? 'Yes' : 'No') : formatter(v), insight });
  };

  // 1. Valuation (P/E sweet spot: 18-40 for growth stocks)
  const pe = screener.pe;
  if (pe !== null && pe !== undefined) {
    const peScore = pe >= 18 && pe <= 40 ? 80 : pe > 40 && pe <= 60 ? 60 : pe < 18 && pe > 8 ? 65 : pe > 60 ? 40 : 30;
    const peSig: MultibaggerCriterion['signal'] = peScore >= 75 ? 'BUY' : peScore >= 60 ? 'NEUTRAL' : 'CAUTION';
    criteria.push({ id: 'pe_valuation', label: 'P/E Valuation', description: 'Price-to-earnings in sweet spot (18-40x)', weight: 7, score: peScore, signal: peSig, value: `${pe.toFixed(1)}x`, insight: pe >= 18 && pe <= 40 ? 'Sweet spot — growth at reasonable price' : pe > 40 ? 'Premium valuation — needs execution' : 'Cheap but check earnings quality' });
  } else {
    criteria.push({ id: 'pe_valuation', label: 'P/E Valuation', description: 'Price-to-earnings in sweet spot (18-40x)', weight: 7, score: 50, signal: 'NEUTRAL', value: 'N/A', insight: 'P/E data unavailable' });
  }

  // 2. ROCE (Return on Capital Employed) — quality metric
  add('roce', 'ROCE', 'Return on Capital Employed — capital efficiency', 9, screener.roce,
    { strong: 20, buy: 15, neutral: 10, caution: 5 },
    v => `${v.toFixed(1)}%`,
    screener.roce >= 20 ? 'Excellent capital efficiency' : screener.roce >= 15 ? 'Good ROCE — efficient business' : 'ROCE needs improvement');

  // 3. ROE (Return on Equity)
  add('roe', 'ROE', 'Return on Equity — shareholder value creation', 7, screener.roe,
    { strong: 18, buy: 12, neutral: 8, caution: 3 },
    v => `${v.toFixed(1)}%`,
    screener.roe >= 18 ? 'Strong shareholder returns' : screener.roe >= 12 ? 'Decent ROE' : 'Low ROE — capital allocation concern');

  // 4. Debt-to-Equity (lower is better — inverted)
  const de = screener.de;
  if (de !== null && de !== undefined) {
    const deScore = de <= 0.3 ? 90 : de <= 0.5 ? 80 : de <= 1.0 ? 65 : de <= 1.5 ? 45 : de <= 2.5 ? 30 : 15;
    const deSig: MultibaggerCriterion['signal'] = deScore >= 80 ? 'STRONG_BUY' : deScore >= 65 ? 'BUY' : deScore >= 45 ? 'NEUTRAL' : deScore >= 30 ? 'CAUTION' : 'AVOID';
    criteria.push({ id: 'de_ratio', label: 'Debt-to-Equity', description: 'Low D/E = financial resilience, compound faster', weight: 8, score: deScore, signal: deSig, value: `${de.toFixed(2)}x`, insight: de <= 0.5 ? 'Low debt — financial fortress' : de <= 1.0 ? 'Manageable debt' : 'High debt — leverage risk' });
  } else {
    criteria.push({ id: 'de_ratio', label: 'Debt-to-Equity', description: 'Low D/E = financial resilience', weight: 8, score: 50, signal: 'NEUTRAL', value: 'N/A', insight: 'Debt data unavailable' });
  }

  // 5. Promoter Holding (>50% ideal, >65% excellent)
  add('promoter_holding', 'Promoter Holding', 'Skin in the game — aligned incentives', 8, screener.promoterPct,
    { strong: 65, buy: 50, neutral: 35, caution: 20 },
    v => `${v.toFixed(1)}%`,
    screener.promoterPct >= 65 ? 'High conviction by founder/promoter' : screener.promoterPct >= 50 ? 'Adequate skin in game' : 'Low promoter holding — monitor');

  // 6. Pledged Shares (lower is better — inverted)
  const pledged = screener.pledgedPct ?? 0;
  const pledgeScore = pledged <= 5 ? 90 : pledged <= 15 ? 70 : pledged <= 30 ? 50 : pledged <= 50 ? 30 : 10;
  const pledgeSig: MultibaggerCriterion['signal'] = pledgeScore >= 80 ? 'STRONG_BUY' : pledgeScore >= 65 ? 'BUY' : pledgeScore >= 45 ? 'NEUTRAL' : pledgeScore >= 25 ? 'CAUTION' : 'AVOID';
  criteria.push({ id: 'pledge_pct', label: 'Pledged Shares', description: 'Low pledging = promoter confidence, lower risk', weight: 7, score: pledgeScore, signal: pledgeSig, value: `${pledged.toFixed(1)}%`, insight: pledged <= 5 ? 'Minimal pledging — low distress risk' : pledged <= 15 ? 'Modest pledging — watch trend' : 'High pledging — significant risk flag' });

  // 7. Operating Leverage (OPM expansion)
  add('operating_leverage', 'Operating Margin', 'Higher OPM = scalable, leverageable business model', 8, screener.opm,
    { strong: 20, buy: 15, neutral: 10, caution: 5 },
    v => `${v.toFixed(1)}%`,
    screener.opm >= 20 ? 'Strong operating leverage potential' : screener.opm >= 15 ? 'Good margins — room to expand' : 'Thin margins — needs improvement');

  // 8. Revenue Growth (5yr CAGR)
  add('revenue_growth', 'Revenue CAGR (5yr)', 'Consistent revenue growth — business momentum', 8, screener.salesCagr5yr,
    { strong: 20, buy: 15, neutral: 10, caution: 5 },
    v => `${v.toFixed(1)}%`,
    screener.salesCagr5yr >= 20 ? 'Exceptional revenue momentum' : screener.salesCagr5yr >= 15 ? 'Strong growth trend' : 'Moderate growth — needs acceleration');

  // 9. Profit CAGR (5yr)
  add('profit_growth', 'Profit CAGR (5yr)', 'Profit growing faster than revenue = operating leverage', 9, screener.profitCagr5yr,
    { strong: 25, buy: 18, neutral: 12, caution: 5 },
    v => `${v.toFixed(1)}%`,
    screener.profitCagr5yr >= 25 ? 'Exceptional profit compounding' : screener.profitCagr5yr >= 18 ? 'Strong profit growth' : 'Profit growth needs to accelerate');

  // 10. CFO Positive (cash flow from operations)
  const cfoScore = screener.cfoPositive === true ? 85 : screener.cfoPositive === false ? 20 : 50;
  criteria.push({ id: 'cfo_positive', label: 'CFO Positive', description: 'Operations generate real cash — not accounting fiction', weight: 9, score: cfoScore, signal: cfoScore >= 80 ? 'BUY' : cfoScore >= 50 ? 'NEUTRAL' : 'AVOID', value: screener.cfoPositive === true ? 'Yes' : screener.cfoPositive === false ? 'No' : 'N/A', insight: screener.cfoPositive === true ? 'Real cash generator — quality earnings' : screener.cfoPositive === false ? 'Cash flow negative — watch capex rationale' : 'CFO data unavailable' });

  // 11. Market Cap sweet spot (500Cr - 15000Cr for multibagger potential)
  const mcap = screener.marketCapCr ?? nse.marketCapCr;
  if (mcap !== null && mcap !== undefined) {
    const mcapScore = mcap >= 500 && mcap <= 15000 ? 85 : mcap > 15000 && mcap <= 50000 ? 65 : mcap < 500 && mcap > 100 ? 75 : mcap < 100 ? 50 : 50;
    const mcapSig: MultibaggerCriterion['signal'] = mcapScore >= 80 ? 'STRONG_BUY' : mcapScore >= 65 ? 'BUY' : 'NEUTRAL';
    criteria.push({ id: 'market_cap', label: 'Market Cap Sweet Spot', description: '500Cr-15000Cr = optimal multibagger territory', weight: 6, score: mcapScore, signal: mcapSig, value: `₹${(mcap / 100).toFixed(0)}B`, insight: mcap >= 500 && mcap <= 15000 ? 'Sweet spot — large enough to scale, small enough to multiply' : mcap > 15000 ? 'Large cap — slower multibagger journey' : 'Small cap — high risk/reward' });
  } else {
    criteria.push({ id: 'market_cap', label: 'Market Cap Sweet Spot', description: '500Cr-15000Cr sweet spot', weight: 6, score: 50, signal: 'NEUTRAL', value: 'N/A', insight: 'Market cap data unavailable' });
  }

  // 12. Revenue Predictability (recurring/subscription-like business)
  // Proxy: low QoQ revenue volatility
  const revenueGrowth = screener.revenueGrowthQoQ;
  if (revenueGrowth !== null && revenueGrowth !== undefined) {
    const absGrowth = Math.abs(revenueGrowth);
    const predictScore = absGrowth <= 5 ? 80 : absGrowth <= 10 ? 65 : absGrowth <= 20 ? 50 : 35;
    criteria.push({ id: 'revenue_predict', label: 'Revenue Predictability', description: 'Consistent QoQ revenue = high business quality', weight: 7, score: predictScore, signal: predictScore >= 75 ? 'BUY' : predictScore >= 55 ? 'NEUTRAL' : 'CAUTION', value: `${revenueGrowth.toFixed(1)}% QoQ`, insight: predictScore >= 75 ? 'Stable revenue base — predictable compounding' : 'Revenue variability — seasonal or cyclical business' });
  } else {
    criteria.push({ id: 'revenue_predict', label: 'Revenue Predictability', description: 'Consistent QoQ revenue', weight: 7, score: 50, signal: 'NEUTRAL', value: 'N/A', insight: 'Quarterly data unavailable' });
  }

  // 13. Price-to-Book (quality stocks trade at premium, but not excessive)
  const pb = screener.priceToBook;
  if (pb !== null && pb !== undefined) {
    const pbScore = pb >= 1.5 && pb <= 6 ? 75 : pb < 1.5 ? 60 : pb <= 10 ? 55 : 35;
    const pbSig: MultibaggerCriterion['signal'] = pbScore >= 70 ? 'BUY' : pbScore >= 55 ? 'NEUTRAL' : 'CAUTION';
    criteria.push({ id: 'price_to_book', label: 'Price-to-Book', description: 'Quality commands premium, but not frothy', weight: 5, score: pbScore, signal: pbSig, value: `${pb.toFixed(2)}x`, insight: pb >= 1.5 && pb <= 6 ? 'Reasonable premium — quality pricing' : pb > 10 ? 'Expensive vs book — high expectations' : 'At or below book — potential value trap or bargain' });
  } else {
    criteria.push({ id: 'price_to_book', label: 'Price-to-Book', description: 'Quality premium assessment', weight: 5, score: 50, signal: 'NEUTRAL', value: 'N/A', insight: 'P/B data unavailable' });
  }

  // 14. Dividend Yield (not primary criterion — but capital discipline signal)
  const div = screener.dividendYield ?? 0;
  const divScore = div >= 1 && div <= 3 ? 70 : div > 3 ? 60 : div < 1 ? 55 : 50;
  criteria.push({ id: 'dividend', label: 'Dividend / Capital Return', description: 'Capital discipline signal — not pure yield play', weight: 4, score: divScore, signal: 'NEUTRAL', value: div > 0 ? `${div.toFixed(2)}%` : '0%', insight: div >= 1 ? 'Dividend payer — capital discipline present' : 'No dividend — growth reinvestment mode (OK for multibaggers)' });

  // 15. 52-Week Position (proximity to 52W high — momentum signal)
  const pct52w = nse.pct52wHigh; // negative = below 52W high
  if (pct52w !== null && pct52w !== undefined) {
    const pctBelow = Math.abs(Math.min(0, pct52w)); // how far below 52W high
    const momScore = pctBelow <= 10 ? 80 : pctBelow <= 20 ? 65 : pctBelow <= 35 ? 50 : 35;
    criteria.push({ id: 'momentum_52w', label: '52-Week Momentum', description: 'Near 52W high = institutional accumulation confirmation', weight: 5, score: momScore, signal: momScore >= 75 ? 'BUY' : momScore >= 55 ? 'NEUTRAL' : 'CAUTION', value: pct52w !== null ? `${Math.abs(pct52w).toFixed(1)}% from 52W high` : 'N/A', insight: pctBelow <= 10 ? 'Near highs — strong trend' : pctBelow <= 30 ? 'Moderate pull-back from highs' : 'Deep correction — assess fundamental reason' });
  } else {
    criteria.push({ id: 'momentum_52w', label: '52-Week Momentum', description: 'Near 52W high = momentum confirmation', weight: 5, score: 50, signal: 'NEUTRAL', value: 'N/A', insight: 'Price data unavailable' });
  }

  // 16. Capex / Sunrise Sector (proxy: sales growth + sector keyword)
  const sector = (nse.sector || '').toLowerCase();
  const isSunriseSector = ['defence', 'defense', 'renewable', 'electric', 'semiconductor', 'data center', 'ai ', 'space', 'clean energy', 'pharma'].some(k => sector.includes(k));
  const isCapexSector = ['infrastructure', 'capital goods', 'engineering', 'industrial'].some(k => sector.includes(k));
  const sectorScore = isSunriseSector ? 85 : isCapexSector ? 75 : 55;
  criteria.push({ id: 'sunrise_sector', label: 'Sector Tailwind', description: 'Sunrise / policy-backed sector = structural growth', weight: 7, score: sectorScore, signal: sectorScore >= 80 ? 'STRONG_BUY' : sectorScore >= 70 ? 'BUY' : 'NEUTRAL', value: nse.sector || 'Unknown', insight: isSunriseSector ? 'Sunrise sector — structural decade-long tailwind' : isCapexSector ? 'Capex cycle beneficiary' : 'Neutral sector — stock-specific story' });

  // 17. Chokepoint / Strategic Position (proxy: revenue predictability + high ROCE)
  const chokepointScore = (screener.roce >= 20 && screener.opm >= 18) ? 85 : (screener.roce >= 15 && screener.opm >= 12) ? 70 : 50;
  criteria.push({ id: 'chokepoint', label: 'Chokepoint / Moat', description: 'High ROCE + high OPM = pricing power moat', weight: 8, score: chokepointScore, signal: chokepointScore >= 80 ? 'STRONG_BUY' : chokepointScore >= 65 ? 'BUY' : 'NEUTRAL', value: `ROCE ${screener.roce?.toFixed(1) ?? 'N/A'}% / OPM ${screener.opm?.toFixed(1) ?? 'N/A'}%`, insight: chokepointScore >= 80 ? 'Strong moat — pricing power confirmed by ROCE+OPM' : chokepointScore >= 65 ? 'Developing moat — improving capital efficiency' : 'No clear moat yet — assess competitive advantage' });

  // 18. FCF Yield (positive CFO ÷ market cap proxy)
  const fcfScore = screener.cfoPositive === true && (screener.pe || 0) > 0 ? Math.min(90, 50 + (screener.roce || 0)) : screener.cfoPositive === false ? 20 : 50;
  criteria.push({ id: 'fcf_yield', label: 'FCF Quality', description: 'Free cash flow generation = real compounding engine', weight: 8, score: fcfScore, signal: fcfScore >= 75 ? 'BUY' : fcfScore >= 50 ? 'NEUTRAL' : 'AVOID', value: screener.cfoPositive === true ? 'Positive FCF' : screener.cfoPositive === false ? 'Negative FCF' : 'N/A', insight: screener.cfoPositive === true ? 'FCF positive — self-funding growth machine' : screener.cfoPositive === false ? 'Burns cash — ensure it is for strategic capex' : 'FCF data unavailable' });

  // 19. Management Track Record (proxy: 5yr profit CAGR consistency)
  const profitCagr = screener.profitCagr5yr;
  const mgmtScore = profitCagr >= 20 ? 85 : profitCagr >= 15 ? 72 : profitCagr >= 10 ? 58 : profitCagr >= 0 ? 40 : 20;
  criteria.push({ id: 'mgmt_track', label: 'Management Track Record', description: '5yr profit CAGR = management execution proof', weight: 8, score: mgmtScore ?? 50, signal: mgmtScore >= 80 ? 'STRONG_BUY' : mgmtScore >= 65 ? 'BUY' : mgmtScore >= 45 ? 'NEUTRAL' : 'CAUTION', value: profitCagr != null ? `${profitCagr.toFixed(1)}% 5yr Profit CAGR` : 'N/A', insight: profitCagr >= 20 ? 'Exceptional execution — trust the management' : profitCagr >= 15 ? 'Good track record' : profitCagr >= 0 ? 'Moderate track record — watch delivery' : 'Declining profits — management execution risk' });

  // 20. Capital Allocation Quality (ROCE + D/E + CFO combined)
  const capAllocScore = Math.round(
    ((screener.roce || 0) >= 15 ? 30 : (screener.roce || 0) >= 10 ? 20 : 10) +
    ((screener.de || 99) <= 0.5 ? 30 : (screener.de || 99) <= 1 ? 20 : 10) +
    (screener.cfoPositive === true ? 40 : screener.cfoPositive === false ? 10 : 25)
  );
  criteria.push({ id: 'capital_allocation', label: 'Capital Allocation Quality', description: 'ROCE + D/E + CFO composite — how wisely they deploy capital', weight: 9, score: Math.min(100, capAllocScore), signal: capAllocScore >= 80 ? 'STRONG_BUY' : capAllocScore >= 65 ? 'BUY' : capAllocScore >= 50 ? 'NEUTRAL' : 'CAUTION', value: `ROCE ${screener.roce?.toFixed(0) ?? 'N/A'}% / D/E ${screener.de?.toFixed(2) ?? 'N/A'} / CFO ${screener.cfoPositive === true ? '✓' : screener.cfoPositive === false ? '✗' : '?'}`, insight: capAllocScore >= 80 ? 'Exemplary capital allocators — rare quality' : capAllocScore >= 65 ? 'Good capital discipline' : 'Capital allocation needs improvement' });

  return criteria;
}

// ── Compute overall score ─────────────────────────────────────────────────────
function computeOverallScore(criteria: MultibaggerCriterion[]): { score: number; grade: MultibaggerResult['grade'] } {
  const totalWeight = criteria.reduce((acc, c) => acc + c.weight, 0);
  const weightedScore = criteria.reduce((acc, c) => acc + c.score * c.weight, 0);
  const score = Math.round(weightedScore / totalWeight);
  const grade: MultibaggerResult['grade'] = score >= 80 ? 'A+' : score >= 72 ? 'A' : score >= 64 ? 'B+' : score >= 55 ? 'B' : score >= 45 ? 'C' : 'D';
  return { score, grade };
}

// ── Main GET handler ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const portfolioRaw = searchParams.get('portfolio') || '';
  const watchlistRaw = searchParams.get('watchlist') || '';

  const portfolio = portfolioRaw ? portfolioRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [];
  const watchlist = watchlistRaw ? watchlistRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [];

  const allSymbols = Array.from(new Set([...portfolio, ...watchlist]));

  if (allSymbols.length === 0) {
    return NextResponse.json({ results: [], message: 'Add companies to your portfolio or watchlist to see multibagger analysis.' });
  }

  const results: MultibaggerResult[] = [];

  // Process each symbol (parallel batches of 3 to avoid rate limits)
  const BATCH_SIZE = 3;
  for (let i = 0; i < allSymbols.length; i += BATCH_SIZE) {
    const batch = allSymbols.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (symbol) => {
      const errors: string[] = [];
      let screenerData: Record<string, any> = {};
      let nseData: Record<string, any> = {};

      try { screenerData = await fetchScreenerData(symbol); } catch (e: any) { errors.push(`screener: ${e?.message || 'failed'}`); }
      try { nseData = await fetchNSEQuote(symbol); } catch (e: any) { errors.push(`nse: ${e?.message || 'failed'}`); }

      const criteria = scoreMultibagger(screenerData, nseData);
      const { score, grade } = computeOverallScore(criteria);
      const dataSource: MultibaggerResult['dataSource'] = Object.keys(screenerData).length > 2 && Object.keys(nseData).length > 2
        ? 'screener.in + NSE' : Object.keys(nseData).length > 2 ? 'NSE only' : 'partial';

      return {
        symbol,
        company: nseData.companyName || screenerData.companyName || symbol,
        sector: nseData.sector || screenerData.sector || 'Unknown',
        lastPrice: nseData.lastPrice || null,
        marketCapCr: screenerData.marketCapCr || null,
        overallScore: score,
        grade,
        criteria,
        isPortfolio: portfolio.includes(symbol),
        isWatchlist: watchlist.includes(symbol),
        computedAt: new Date().toISOString(),
        dataSource,
        errors,
      } satisfies MultibaggerResult;
    }));
    results.push(...batchResults);
  }

  // Sort: portfolio first, then by score
  results.sort((a, b) => {
    if (a.isPortfolio && !b.isPortfolio) return -1;
    if (!a.isPortfolio && b.isPortfolio) return 1;
    return b.overallScore - a.overallScore;
  });

  return NextResponse.json({
    results,
    meta: {
      total: results.length,
      portfolio: portfolio.length,
      watchlist: watchlist.length,
      topScore: results[0]?.overallScore ?? 0,
      computedAt: new Date().toISOString(),
    }
  });
}
