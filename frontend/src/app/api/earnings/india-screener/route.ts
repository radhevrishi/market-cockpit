import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Screener.in proxy — the gold-standard public source for Indian financials
// ─────────────────────────────────────────────────────────────────────────────
// Returns:
//   - Top metrics (Market Cap, CMP, P/E, ROE, ROCE, Book Value, etc.) in ₹ Cr
//   - 12-13 quarters of P&L (Sales, OP, OPM, Tax, Net Profit, EPS) in ₹ Cr
//   - 10-12 years of annual P&L
//   - Balance sheet / cash flow rows
//   - Sector / industry classification
//   - Business description
// All numeric values are in ₹ Crores (Screener's native unit) — caller must
// convert to internal canonical (₹ Mn = ₹ Cr × 10) if needed.
// ─────────────────────────────────────────────────────────────────────────────

const SCREENER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Strip suffix and normalize to Screener's symbol format
function toScreenerSymbol(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (s.endsWith('.NS')) return s.slice(0, -3);
  if (s.endsWith('.BO') || s.endsWith('.BSE')) {
    // Screener accepts BSE codes too but most NSE tickers work in upper case
    return s.slice(0, s.lastIndexOf('.'));
  }
  return s;
}

// Strip HTML tags and clean entities
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse a number from screener's "1,234.56" / "₹ 5,123" / "12%" formats
function parseScreenerNumber(s: string | undefined | null): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[₹,\s%]/g, '').replace(/cr|cr\./gi, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '—') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Extract a section by id; returns the inner content
function getSection(html: string, sectionId: string): string | null {
  // Sections in screener are <section id="..."> ... </section>
  // We need to balance section tags since they may contain nested elements
  const startRe = new RegExp(`<section[^>]*\\bid="${sectionId}"[^>]*>`, 'i');
  const startMatch = startRe.exec(html);
  if (!startMatch) return null;
  const start = startMatch.index + startMatch[0].length;

  // Naive: find matching </section> by walking forward and counting open <section> tags
  let depth = 1;
  let pos = start;
  const sectOpen = /<section\b[^>]*>/gi;
  const sectClose = /<\/section>/gi;
  let nextOpen = -1;
  let nextClose = -1;
  while (depth > 0) {
    sectOpen.lastIndex = pos;
    sectClose.lastIndex = pos;
    const om = sectOpen.exec(html);
    const cm = sectClose.exec(html);
    nextOpen = om ? om.index : Infinity;
    nextClose = cm ? cm.index : Infinity;
    if (nextClose === Infinity) break; // unbalanced, bail
    if (nextOpen < nextClose) {
      depth++;
      pos = nextOpen + (om?.[0].length || 0);
    } else {
      depth--;
      pos = nextClose + (cm?.[0].length || 0);
      if (depth === 0) {
        return html.slice(start, nextClose);
      }
    }
  }
  return null;
}

// Extract a key-value top metric (e.g. "Market Cap : ₹ 6,806 Cr.")
function extractTopMetric(html: string, label: string): string | null {
  // Screener uses <li class="..."> <span>Label</span> <span class="number">VAL</span> </li>
  const re = new RegExp(
    `<li[^>]*>\\s*<span[^>]*>\\s*${label}\\s*</span>[\\s\\S]{0,400}?<span[^>]*class="(?:number|sub)[^"]*"[^>]*>([^<]+)</span>`,
    'i',
  );
  const m = html.match(re);
  if (m) return m[1].trim();
  // Fallback to plain text search
  const re2 = new RegExp(`${label}\\s*[\\s\\S]{0,200}?<span[^>]*class="number"[^>]*>([^<]+)</span>`, 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1].trim() : null;
}

// Parse a screener data table: returns headers + row {label: values}
interface ParsedTable {
  headers: string[];
  rows: Record<string, (number | null)[]>;
}

function parseScreenerTable(sectionHtml: string): ParsedTable | null {
  // Find the first <table> in the section
  const tableMatch = sectionHtml.match(/<table[^>]*data-result-table[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) return null;
  const tableHtml = tableMatch[1];

  // Headers
  const headers: string[] = [];
  const headRowMatch = tableHtml.match(/<thead[\s\S]*?<\/thead>/);
  if (headRowMatch) {
    const ths = headRowMatch[0].match(/<th[^>]*>([\s\S]*?)<\/th>/g) || [];
    for (const th of ths) {
      const text = stripTags(th);
      if (text) headers.push(text);
    }
  }

  // Rows
  const rows: Record<string, (number | null)[]> = {};
  const tbodyMatch = tableHtml.match(/<tbody[\s\S]*?<\/tbody>/);
  if (!tbodyMatch) return null;
  const trMatches = tbodyMatch[0].match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  for (const tr of trMatches) {
    const tds = tr.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g) || [];
    if (tds.length === 0) continue;
    const cells = tds.map((c) => stripTags(c));
    const label = cells[0]?.replace(/\+$/, '').trim();
    if (!label) continue;
    rows[label] = cells.slice(1).map((c) => parseScreenerNumber(c));
  }

  return { headers, rows };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = (searchParams.get('ticker') || '').trim();
  if (!raw) {
    return NextResponse.json({ ok: false, error: 'Missing ticker parameter' }, { status: 400 });
  }
  const symbol = toScreenerSymbol(raw);
  const isStandalone = searchParams.get('standalone') === 'true';
  const path = isStandalone ? `company/${symbol}/` : `company/${symbol}/consolidated/`;

  const debug: { url: string; status: number | null; sections: string[]; warnings: string[] } = {
    url: `https://www.screener.in/${path}`,
    status: null,
    sections: [],
    warnings: [],
  };

  let html: string | null = null;
  try {
    let res = await fetch(`https://www.screener.in/${path}`, {
      headers: SCREENER_HEADERS,
      signal: AbortSignal.timeout(15000),
      next: { revalidate: 3600 },
    });
    debug.status = res.status;
    if (!res.ok && !isStandalone) {
      // Some companies only file standalone — try standalone fallback
      const standalone = `https://www.screener.in/company/${symbol}/`;
      res = await fetch(standalone, { headers: SCREENER_HEADERS, signal: AbortSignal.timeout(15000) });
      debug.url = standalone;
      debug.status = res.status;
      debug.warnings.push('Consolidated not available — fell back to standalone');
    }
    if (res.ok) html = await res.text();
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Screener.in fetch failed: ${err?.message || 'timeout'}`, debug },
      { status: 504 },
    );
  }

  if (!html) {
    return NextResponse.json(
      { ok: false, error: `Screener.in returned ${debug.status} for ${symbol}`, debug },
      { status: 404 },
    );
  }

  // Detect available sections
  const sectionMatches = html.match(/<section[^>]*id="([^"]+)"/g) || [];
  for (const sm of sectionMatches) {
    const idMatch = sm.match(/id="([^"]+)"/);
    if (idMatch) debug.sections.push(idMatch[1]);
  }

  // ── Top metrics ──────────────────────────────────────────────────────
  const marketCap = parseScreenerNumber(extractTopMetric(html, 'Market Cap'));
  const cmp = parseScreenerNumber(extractTopMetric(html, 'Current Price'));
  const high52 = parseScreenerNumber(extractTopMetric(html, 'High / Low')); // first number
  const pe = parseScreenerNumber(extractTopMetric(html, 'Stock P/E'));
  const bookValue = parseScreenerNumber(extractTopMetric(html, 'Book Value'));
  const dividendYield = parseScreenerNumber(extractTopMetric(html, 'Dividend Yield'));
  const roce = parseScreenerNumber(extractTopMetric(html, 'ROCE'));
  const roe = parseScreenerNumber(extractTopMetric(html, 'ROE'));
  const faceValue = parseScreenerNumber(extractTopMetric(html, 'Face Value'));
  const promoterHolding = parseScreenerNumber(extractTopMetric(html, 'Promoter holding'));
  const debtToEquity = parseScreenerNumber(extractTopMetric(html, 'Debt to equity'));
  const ratiosIntPayout = parseScreenerNumber(extractTopMetric(html, 'Int Coverage'));

  // ── Quarterly P&L ────────────────────────────────────────────────────
  const quartersSection = getSection(html, 'quarters');
  const quartersTable = quartersSection ? parseScreenerTable(quartersSection) : null;

  // ── Annual P&L ───────────────────────────────────────────────────────
  const annualSection = getSection(html, 'profit-loss');
  const annualTable = annualSection ? parseScreenerTable(annualSection) : null;

  // ── Balance sheet annual ─────────────────────────────────────────────
  const bsSection = getSection(html, 'balance-sheet');
  const bsTable = bsSection ? parseScreenerTable(bsSection) : null;

  // ── Cash flow annual ─────────────────────────────────────────────────
  const cfSection = getSection(html, 'cash-flow');
  const cfTable = cfSection ? parseScreenerTable(cfSection) : null;

  // ── Ratios ───────────────────────────────────────────────────────────
  const ratiosSection = getSection(html, 'ratios');
  const ratiosTable = ratiosSection ? parseScreenerTable(ratiosSection) : null;

  // ── Shareholding pattern (last column = current) ─────────────────────
  const shSection = getSection(html, 'shareholding');
  const shTable = shSection ? parseScreenerTable(shSection) : null;

  // ── Sector / industry from breadcrumb / company page ─────────────────
  let industry: string | null = null;
  const industryMatch = html.match(/<a[^>]*href="\/company\/compare\/\d+\/[^"]*\/"[^>]*>([^<]+)<\/a>/);
  if (industryMatch) industry = industryMatch[1].trim();
  let companyName: string | null = null;
  const nameMatch = html.match(/<h1[^>]*class="[^"]*"[^>]*>([^<]+)<\/h1>/);
  if (nameMatch) companyName = stripTags(nameMatch[1]);

  // ── Business description ─────────────────────────────────────────────
  let about: string | null = null;
  const aboutMatch = html.match(/<div[^>]*class="company-profile"[\s\S]{0,8000}?<p[^>]*>([\s\S]*?)<\/p>/);
  if (aboutMatch) about = stripTags(aboutMatch[1]);

  // ── Build normalized output ──────────────────────────────────────────
  // All Screener values are in ₹ Crores. We return them as-is and tag the unit.
  const quarterly = quartersTable
    ? quartersTable.headers.map((header, idx) => {
        const sales = quartersTable.rows['Sales']?.[idx] ?? quartersTable.rows['Revenue']?.[idx] ?? null;
        const expenses = quartersTable.rows['Expenses']?.[idx] ?? null;
        const operatingProfit = quartersTable.rows['Operating Profit']?.[idx] ?? null;
        const opmPct = quartersTable.rows['OPM %']?.[idx] ?? null;
        const otherIncome = quartersTable.rows['Other Income']?.[idx] ?? null;
        const interest = quartersTable.rows['Interest']?.[idx] ?? null;
        const depreciation = quartersTable.rows['Depreciation']?.[idx] ?? null;
        const pbt = quartersTable.rows['Profit before tax']?.[idx] ?? null;
        const taxPct = quartersTable.rows['Tax %']?.[idx] ?? null;
        const netProfit = quartersTable.rows['Net Profit']?.[idx]
          ?? quartersTable.rows['Net profit']?.[idx]
          ?? quartersTable.rows['Profit for the period']?.[idx]
          ?? null;
        const eps = quartersTable.rows['EPS in Rs']?.[idx] ?? quartersTable.rows['EPS']?.[idx] ?? null;
        return {
          period: header,
          sales,
          expenses,
          operatingProfit,
          opmPct,
          otherIncome,
          interest,
          depreciation,
          pbt,
          taxPct,
          netProfit,
          eps,
          netMargin: sales && sales > 0 && netProfit !== null
            ? Math.round((netProfit / sales) * 10000) / 100
            : null,
        };
      })
    : [];

  // Most recent quarter data (caller's "latest reported")
  const latest = quarterly[quarterly.length - 1] || null;
  const prevYear = quarterly.length >= 5 ? quarterly[quarterly.length - 5] : null; // YoY = 4 quarters back
  const prevQuarter = quarterly.length >= 2 ? quarterly[quarterly.length - 2] : null;

  return NextResponse.json({
    ok: true,
    source: 'screener_in',
    ticker: symbol,
    rawTicker: raw,
    company: companyName,
    industry,
    about,
    debug,
    unit: 'INR_Cr',
    topMetrics: {
      marketCap,           // ₹ Cr
      currentPrice: cmp,   // ₹
      peRatio: pe,
      bookValue,
      dividendYieldPct: dividendYield,
      roce,
      roe,
      faceValue,
      promoterHoldingPct: promoterHolding,
      debtToEquity,
    },
    latest: latest
      ? {
          period: latest.period,
          revenue: latest.sales,             // ₹ Cr
          operatingProfit: latest.operatingProfit,
          ebitdaMargin: latest.opmPct,       // already %
          netIncome: latest.netProfit,
          netMargin: latest.netMargin,
          eps: latest.eps,
          interestExpense: latest.interest,
          depreciation: latest.depreciation,
          pbt: latest.pbt,
          taxPct: latest.taxPct,
          otherIncome: latest.otherIncome,
        }
      : null,
    yoyPriorQuarter: prevYear
      ? {
          period: prevYear.period,
          revenue: prevYear.sales,
          operatingProfit: prevYear.operatingProfit,
          ebitdaMargin: prevYear.opmPct,
          netIncome: prevYear.netProfit,
          eps: prevYear.eps,
        }
      : null,
    qoqPriorQuarter: prevQuarter
      ? {
          period: prevQuarter.period,
          revenue: prevQuarter.sales,
          operatingProfit: prevQuarter.operatingProfit,
          ebitdaMargin: prevQuarter.opmPct,
          netIncome: prevQuarter.netProfit,
          eps: prevQuarter.eps,
        }
      : null,
    quarterly,
    annual: annualTable
      ? annualTable.headers.map((header, idx) => ({
          period: header,
          sales: annualTable.rows['Sales']?.[idx] ?? annualTable.rows['Revenue']?.[idx] ?? null,
          operatingProfit: annualTable.rows['Operating Profit']?.[idx] ?? null,
          opmPct: annualTable.rows['OPM %']?.[idx] ?? null,
          netProfit: annualTable.rows['Net Profit']?.[idx] ?? annualTable.rows['Net profit']?.[idx] ?? null,
          eps: annualTable.rows['EPS in Rs']?.[idx] ?? null,
        }))
      : [],
    balanceSheet: bsTable
      ? bsTable.headers.map((header, idx) => ({
          period: header,
          equityCapital: bsTable.rows['Equity Capital']?.[idx] ?? null,
          reserves: bsTable.rows['Reserves']?.[idx] ?? null,
          borrowings: bsTable.rows['Borrowings']?.[idx] ?? null,
          otherLiabilities: bsTable.rows['Other Liabilities']?.[idx] ?? null,
          totalLiabilities: bsTable.rows['Total Liabilities']?.[idx] ?? null,
          fixedAssets: bsTable.rows['Fixed Assets']?.[idx] ?? null,
          investments: bsTable.rows['Investments']?.[idx] ?? null,
          otherAssets: bsTable.rows['Other Assets']?.[idx] ?? null,
          totalAssets: bsTable.rows['Total Assets']?.[idx] ?? null,
        }))
      : [],
    cashFlow: cfTable
      ? cfTable.headers.map((header, idx) => ({
          period: header,
          fromOperating: cfTable.rows['Cash from Operating Activity']?.[idx]
            ?? cfTable.rows['Cash from Operating Activity ']?.[idx]
            ?? null,
          fromInvesting: cfTable.rows['Cash from Investing Activity']?.[idx]
            ?? cfTable.rows['Cash from Investing Activity ']?.[idx]
            ?? null,
          fromFinancing: cfTable.rows['Cash from Financing Activity']?.[idx]
            ?? cfTable.rows['Cash from Financing Activity ']?.[idx]
            ?? null,
          netChange: cfTable.rows['Net Cash Flow']?.[idx] ?? null,
        }))
      : [],
    ratios: ratiosTable
      ? ratiosTable.headers.map((header, idx) => ({
          period: header,
          debtorDays: ratiosTable.rows['Debtor Days']?.[idx] ?? null,
          inventoryDays: ratiosTable.rows['Inventory Days']?.[idx] ?? null,
          daysPayable: ratiosTable.rows['Days Payable']?.[idx] ?? null,
          cashConversionCycle: ratiosTable.rows['Cash Conversion Cycle']?.[idx] ?? null,
          workingCapitalDays: ratiosTable.rows['Working Capital Days']?.[idx] ?? null,
          roce: ratiosTable.rows['ROCE %']?.[idx] ?? null,
        }))
      : [],
    shareholding: shTable
      ? shTable.headers.map((header, idx) => ({
          period: header,
          promoters: shTable.rows['Promoters']?.[idx] ?? null,
          fii: shTable.rows['FIIs']?.[idx] ?? shTable.rows['FIIs+']?.[idx] ?? null,
          dii: shTable.rows['DIIs']?.[idx] ?? shTable.rows['DIIs+']?.[idx] ?? null,
          public: shTable.rows['Public']?.[idx] ?? null,
          numShareholders: shTable.rows['No. of Shareholders']?.[idx] ?? null,
        }))
      : [],
  });
}
