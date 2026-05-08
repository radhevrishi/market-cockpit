import { NextResponse } from 'next/server';
import { fetchCompanyFinancialResults } from '@/lib/nse';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────────────────────
// India earnings proxy — NSE PRIMARY, Screener.in FALLBACK
// ─────────────────────────────────────────────────────────────────────────────
// Source priority for quarterly P&L (Revenue / OP / PAT / EPS / margins):
//   1. NSE corporates-financial-results (authoritative filing data, in Lakhs)
//   2. Screener.in quarterly section (parsed HTML, in Cr)
//
// Source priority for TTM ratios (P/E, ROCE, ROE, Book Value, D/E, etc.),
// annual P&L history, balance sheet, cash flow, shareholding pattern, and
// sector/industry classification — Screener.in only (NSE doesn't expose these).
//
// All numeric values returned in ₹ Crores. The `source` field tells the
// builder whether quarterly figures came from NSE (preferred) or Screener.
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
  // Find the first <table> in the section. Screener uses class="data-table"
  const tableMatch = sectionHtml.match(/<table[^>]*class="[^"]*data-table[^"]*"[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) {
    // Fallback: any <table>
    const fallback = sectionHtml.match(/<table[^>]*>([\s\S]*?)<\/table>/);
    if (!fallback) return null;
    return parseTableHtml(fallback[1]);
  }
  return parseTableHtml(tableMatch[1]);
}

function parseTableHtml(tableHtml: string): ParsedTable | null {

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

// ── NSE quarterly extraction ─────────────────────────────────────────────
// NSE's /api/corporates-financial-results returns rows like:
//   { symbol, fromDate, toDate, consolidated, audited, cumulative,
//     income, expenditure, profitBeforeTax, profitAfterTax, basicEps,
//     financeCost, depreciationAmortisation, ... }
// All numeric fields are in ₹ LAKHS (1 Lakh = 0.01 Cr). We convert to ₹ Cr
// to match Screener's native unit.
function nsePickNum(obj: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (v === undefined || v === null || v === '') continue;
    const n = parseFloat(String(v).replace(/,/g, ''));
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return null;
}

function nsePeriodLabel(toDate: string): string {
  const d = new Date(toDate);
  if (Number.isNaN(d.getTime())) return toDate || 'Latest';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

interface NseQuarter {
  period: string;
  sales: number | null;
  expenses: number | null;
  operatingProfit: number | null;
  opmPct: number | null;
  otherIncome: number | null;
  interest: number | null;
  depreciation: number | null;
  pbt: number | null;
  taxPct: number | null;
  netProfit: number | null;
  eps: number | null;
  netMargin: number | null;
  toDate: string;
}

async function fetchNseQuarters(symbol: string): Promise<NseQuarter[]> {
  let raw: any[] = [];
  try {
    const fin = await fetchCompanyFinancialResults(symbol);
    raw = Array.isArray(fin) ? fin : fin?.data || [];
  } catch {
    return [];
  }
  if (!raw || raw.length === 0) return [];

  // Filter to filings within last 3 years (NSE sometimes returns ancient rows)
  const cutoff = Date.now() - 3 * 365 * 24 * 3600 * 1000;
  const recent = raw.filter((r) => {
    const t = new Date(r.toDate || r.broadCastDate || 0).getTime();
    return t >= cutoff;
  });
  if (recent.length === 0) return [];

  // Sort newest first, then dedupe by toDate, preferring Consolidated rows.
  const byDate = [...recent].sort(
    (a, b) =>
      new Date(b.toDate || b.broadCastDate || 0).getTime() -
      new Date(a.toDate || a.broadCastDate || 0).getTime(),
  );
  const cons = byDate.filter((r) => /consolidated/i.test(r.consolidated || r.re_emp || ''));
  const stand = byDate.filter((r) => !/consolidated/i.test(r.consolidated || r.re_emp || ''));
  const merged = [...cons, ...stand];
  const seen = new Set<string>();
  const dedup: any[] = [];
  for (const r of merged) {
    const key = r.toDate || '';
    if (!seen.has(key) && key) {
      seen.add(key);
      dedup.push(r);
    }
  }

  // Drop rows where the period clearly looks YTD/cumulative (Cumulative=Y or
  // period spans more than ~120 days — NSE does file H1/9M/FY rows here too).
  const quarterly = dedup.filter((r) => {
    const cum = String(r.cumulative || '').toUpperCase();
    if (cum === 'Y' || cum === 'TRUE') return false;
    const from = new Date(r.fromDate || 0).getTime();
    const to = new Date(r.toDate || 0).getTime();
    if (!from || !to) return true;
    const days = (to - from) / (24 * 3600 * 1000);
    return days >= 60 && days <= 130; // single quarter
  });
  if (quarterly.length === 0) return [];

  // Sort oldest first to match Screener's quarterly column ordering.
  quarterly.sort(
    (a, b) =>
      new Date(a.toDate || 0).getTime() - new Date(b.toDate || 0).getTime(),
  );

  const lakhsToCr = (n: number | null): number | null =>
    n === null ? null : Math.round((n / 100) * 100) / 100;

  return quarterly.slice(-12).map((r): NseQuarter => {
    const salesL = nsePickNum(r, [
      'revenueFromOperations',
      'income',
      'totalIncomeFromOperations',
      'netSales',
      'sales',
    ]);
    const expensesL = nsePickNum(r, ['expenditure', 'totalExpenses', 'totalExpenditure']);
    const operatingProfitL = nsePickNum(r, [
      'profitFromOperations',
      'operatingProfit',
      'profitBeforeInterestTaxOtherItems',
    ]);
    const pbtL = nsePickNum(r, ['profitBeforeTax', 'pbt']);
    const taxL = nsePickNum(r, ['tax', 'taxExpense', 'totalTax']);
    const netProfitL = nsePickNum(r, [
      'profitAfterTax',
      'profitLossForPeriod',
      'netProfitLoss',
      'pat',
      'profitLoss',
    ]);
    const interestL = nsePickNum(r, ['financeCost', 'interestExpense', 'interest']);
    const depreciationL = nsePickNum(r, ['depreciationAmortisation', 'depreciation']);
    const otherIncomeL = nsePickNum(r, ['otherIncome', 'otherInc']);
    const eps = nsePickNum(r, ['basicEps', 'epsBasic', 'eps']);

    const salesCr = lakhsToCr(salesL);
    const operatingProfitCr = lakhsToCr(operatingProfitL);
    const netProfitCr = lakhsToCr(netProfitL);
    const pbtCr = lakhsToCr(pbtL);
    const opmPct =
      salesCr && operatingProfitCr !== null && salesCr > 0
        ? Math.round((operatingProfitCr / salesCr) * 1000) / 10
        : null;
    const taxPct =
      taxL !== null && pbtL !== null && pbtL !== 0
        ? Math.round((taxL / pbtL) * 1000) / 10
        : null;
    const netMargin =
      netProfitCr !== null && salesCr && salesCr > 0
        ? Math.round((netProfitCr / salesCr) * 10000) / 100
        : null;

    return {
      period: nsePeriodLabel(r.toDate || r.broadCastDate || ''),
      sales: salesCr,
      expenses: lakhsToCr(expensesL),
      operatingProfit: operatingProfitCr,
      opmPct,
      otherIncome: lakhsToCr(otherIncomeL),
      interest: lakhsToCr(interestL),
      depreciation: lakhsToCr(depreciationL),
      pbt: pbtCr,
      taxPct,
      netProfit: netProfitCr,
      eps,
      netMargin,
      toDate: r.toDate || '',
    };
  });
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

  // ── NSE quarterly fetch runs in parallel with Screener HTML fetch ──────
  // We always issue the NSE call so we have authoritative quarterly numbers
  // ready by the time Screener returns. Screener still supplies TTM ratios,
  // annual P&L, balance sheet, cash flow, shareholding, and sector info.
  const nsePromise = fetchNseQuarters(symbol);

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
    // ── BSE-only fallback: use Screener search API to resolve ticker ──
    // Some companies (AXTEL, smaller midcaps) are BSE-only and Screener
    // routes them by BSE code, e.g. /company/523850/ instead of /company/AXTEL/.
    if (!res.ok) {
      try {
        const searchRes = await fetch(
          `https://www.screener.in/api/company/search/?q=${encodeURIComponent(symbol)}`,
          { headers: SCREENER_HEADERS, signal: AbortSignal.timeout(8000) },
        );
        if (searchRes.ok) {
          const results = await searchRes.json();
          if (Array.isArray(results) && results.length > 0) {
            const url = results[0].url; // e.g. "/company/523850/"
            const fallbackUrl = `https://www.screener.in${url}`;
            debug.warnings.push(`Resolved via Screener search: ${results[0].name} (${url})`);
            res = await fetch(fallbackUrl, {
              headers: SCREENER_HEADERS,
              signal: AbortSignal.timeout(15000),
              next: { revalidate: 3600 },
            });
            debug.url = fallbackUrl;
            debug.status = res.status;
          }
        }
      } catch {
        // search fallback failed — continue with original 404
      }
    }
    if (res.ok) html = await res.text();

    // ── STALENESS RETRY ─────────────────────────────────────────────────
    // Quick scan of the HTML for the most recent quarter header. If it's
    // older than 9 months, the bare-symbol slug probably resolved to an
    // archived / wrong-canonical page. Retry via search API to find the
    // current slug.
    if (html) {
      const headerMatches = html.match(/>(?:Mar|Jun|Sep|Dec)\s+(\d{4})</g) || [];
      let bestYear = 0;
      for (const m of headerMatches) {
        const y = parseInt(m.match(/(\d{4})/)?.[1] || '0', 10);
        if (y > bestYear) bestYear = y;
      }
      const yearsOld = bestYear > 0 ? new Date().getFullYear() - bestYear : 0;
      if (bestYear > 0 && yearsOld >= 1) {
        debug.warnings.push(
          `Initial Screener page yielded latest year ${bestYear} (${yearsOld}+ years old). Retrying via search API to find canonical slug.`,
        );
        try {
          const searchRes = await fetch(
            `https://www.screener.in/api/company/search/?q=${encodeURIComponent(symbol)}`,
            { headers: SCREENER_HEADERS, signal: AbortSignal.timeout(8000) },
          );
          if (searchRes.ok) {
            const results = await searchRes.json();
            if (Array.isArray(results) && results.length > 0) {
              const url = results[0].url;
              const fallbackUrl = `https://www.screener.in${url}consolidated/`;
              debug.warnings.push(`Resolved via search API: ${results[0].name} (${url}consolidated/)`);
              const fallbackRes = await fetch(fallbackUrl, {
                headers: SCREENER_HEADERS,
                signal: AbortSignal.timeout(15000),
                cache: 'no-store',
              });
              if (fallbackRes.ok) {
                const fallbackHtml = await fallbackRes.text();
                // Verify the fallback page is actually fresher
                const fb = fallbackHtml.match(/>(?:Mar|Jun|Sep|Dec)\s+(\d{4})</g) || [];
                let fbYear = 0;
                for (const m of fb) {
                  const y = parseInt(m.match(/(\d{4})/)?.[1] || '0', 10);
                  if (y > fbYear) fbYear = y;
                }
                if (fbYear > bestYear) {
                  debug.url = fallbackUrl;
                  debug.status = fallbackRes.status;
                  html = fallbackHtml;
                  debug.warnings.push(`Replaced stale page (${bestYear}) with fresher canonical (${fbYear}).`);
                } else {
                  // Try non-consolidated variant
                  const altUrl = `https://www.screener.in${url}`;
                  const altRes = await fetch(altUrl, {
                    headers: SCREENER_HEADERS,
                    signal: AbortSignal.timeout(15000),
                    cache: 'no-store',
                  });
                  if (altRes.ok) {
                    const altHtml = await altRes.text();
                    const am = altHtml.match(/>(?:Mar|Jun|Sep|Dec)\s+(\d{4})</g) || [];
                    let altYear = 0;
                    for (const m of am) {
                      const y = parseInt(m.match(/(\d{4})/)?.[1] || '0', 10);
                      if (y > altYear) altYear = y;
                    }
                    if (altYear > bestYear) {
                      debug.url = altUrl;
                      debug.status = altRes.status;
                      html = altHtml;
                      debug.warnings.push(`Replaced stale page (${bestYear}) with standalone variant (${altYear}).`);
                    }
                  }
                }
              }
            }
          }
        } catch {
          // search/retry failed — keep the stale html, banner will warn user
        }
      }
    }
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Screener.in fetch failed: ${err?.message || 'timeout'}`, debug },
      { status: 504 },
    );
  }

  if (!html) {
    // Screener failed — try to salvage with NSE-only payload before 404'ing
    const nseQuartersOnly = await nsePromise.catch(() => [] as NseQuarter[]);
    if (nseQuartersOnly.length >= 4) {
      const latestQ = nseQuartersOnly[nseQuartersOnly.length - 1];
      const yoyQ =
        nseQuartersOnly.length >= 5 ? nseQuartersOnly[nseQuartersOnly.length - 5] : null;
      const qoqQ =
        nseQuartersOnly.length >= 2 ? nseQuartersOnly[nseQuartersOnly.length - 2] : null;
      return NextResponse.json({
        ok: true,
        source: 'nse_primary_screener_unavailable',
        ticker: symbol,
        rawTicker: raw,
        company: null,
        industry: null,
        sector: null,
        subIndustry: null,
        about: null,
        debug: {
          ...debug,
          warnings: [
            ...debug.warnings,
            `Screener.in unavailable (${debug.status}) — returning NSE-only quarterly P&L`,
          ],
        },
        unit: 'INR_Cr',
        topMetrics: {
          marketCap: null,
          currentPrice: null,
          peRatio: null,
          bookValue: null,
          dividendYieldPct: null,
          roce: null,
          roe: null,
          faceValue: null,
          promoterHoldingPct: null,
          debtToEquity: null,
        },
        latest: {
          period: latestQ.period,
          revenue: latestQ.sales,
          operatingProfit: latestQ.operatingProfit,
          ebitdaMargin: latestQ.opmPct,
          netIncome: latestQ.netProfit,
          netMargin: latestQ.netMargin,
          eps: latestQ.eps,
          interestExpense: latestQ.interest,
          depreciation: latestQ.depreciation,
          pbt: latestQ.pbt,
          taxPct: latestQ.taxPct,
          otherIncome: latestQ.otherIncome,
        },
        yoyPriorQuarter: yoyQ
          ? {
              period: yoyQ.period,
              revenue: yoyQ.sales,
              operatingProfit: yoyQ.operatingProfit,
              ebitdaMargin: yoyQ.opmPct,
              netIncome: yoyQ.netProfit,
              eps: yoyQ.eps,
            }
          : null,
        qoqPriorQuarter: qoqQ
          ? {
              period: qoqQ.period,
              revenue: qoqQ.sales,
              operatingProfit: qoqQ.operatingProfit,
              ebitdaMargin: qoqQ.opmPct,
              netIncome: qoqQ.netProfit,
              eps: qoqQ.eps,
            }
          : null,
        quarterly: nseQuartersOnly,
        annual: [],
        balanceSheet: [],
        cashFlow: [],
        ratios: [],
        shareholding: [],
        provenance: {
          financials: 'nse_quarterly_results',
          history: 'nse_quarterly_results',
          ratios: 'unavailable',
          topMetrics: 'unavailable',
          sector: 'unavailable',
        },
      });
    }
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
  const promoterHolding = null; // computed below from meta tooltip
  const debtToEquity = parseScreenerNumber(extractTopMetric(html, 'Debt to equity'));

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

  // ── Sector / industry from breadcrumb metadata ───────────────────────
  // Screener exposes them as: <... title="Sector">Fast Moving Consumer Goods
  let sector: string | null = null;
  let industry: string | null = null;
  let subIndustry: string | null = null;
  const sectorMatch = html.match(new RegExp('title="Sector"[^>]*>\\s*([^\\n<]+?)(?:\\s*<\\/)', 'i'));
  if (sectorMatch) sector = stripTags(sectorMatch[1]).trim();
  const industryMatch = html.match(new RegExp('title="Industry"[^>]*>\\s*([^\\n<]+?)(?:\\s*<\\/)', 'i'));
  if (industryMatch) industry = stripTags(industryMatch[1]).trim();
  const subIndMatch = html.match(new RegExp('title="(?:Sub\\s*-?\\s*Industry|Basic Industry)"[^>]*>\\s*([^\\n<]+?)(?:\\s*<\\/)', 'i'));
  if (subIndMatch) subIndustry = stripTags(subIndMatch[1]).trim();

  let companyName: string | null = null;
  const nameMatch = html.match(/<h1[^>]*class="[^"]*"[^>]*>([^<]+)<\/h1>/);
  if (nameMatch) companyName = stripTags(nameMatch[1]);

  // ── Business description (Screener "About" panel) ────────────────────
  let about: string | null = null;
  // Try the "company-profile" container first
  const aboutMatch = html.match(/<div[^>]*class="company-profile"[\s\S]{0,8000}?<p[^>]*>([\s\S]*?)<\/p>/);
  if (aboutMatch) about = stripTags(aboutMatch[1]);
  // Fallback: extract from the meta title tooltip which contains a 1-line
  // synopsis ("Market Cap … Revenue … Profit … Promoter Holding 43%")
  if (!about) {
    const meta = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/);
    if (meta) about = meta[1];
  }

  // ── Promoter holding from meta tooltip if not on top-ratios list ─────
  let promoterHoldingPct = parseScreenerNumber(extractTopMetric(html, 'Promoter holding'));
  if (promoterHoldingPct === null) {
    const ph = html.match(/Promoter\s+Holding\s*[:\s]+([\d.]+)\s*%/i);
    if (ph) promoterHoldingPct = parseScreenerNumber(ph[1]);
  }

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

  // ── NSE quarterly OVERRIDE / FRESHNESS PATCH ───────────────────────────
  // The default source is Screener.in's quarterly table — but Screener can
  // lag the actual filings by several weeks (JSW Infra Q4 FY26 was filed
  // and published on the company IR site while Screener still showed
  // Dec 2025 / Q3 FY26 as the latest). NSE's corporates-financial-results
  // endpoint refreshes within ~24h of each filing, so we use it as both
  // an authoritative override AND a freshness patch.
  //
  // Logic:
  //  - If NSE returned ≥1 quarter, splice each NSE quarter into the
  //    quarterly array. Any NSE quarter with a more recent period than
  //    Screener's latest replaces / extends the array — fixing the lag.
  //  - Below NSE rows we keep older Screener periods (Screener has 12+
  //    quarters of history, NSE only the most recent few).
  //  - Tag the source as 'nse_primary' whenever ANY NSE row was used so
  //    the user can see in the footer that the latest figure is freshly
  //    sourced from NSE filings.
  const nseQuarters = await nsePromise.catch(() => [] as NseQuarter[]);

  // Helper to coerce a screener-period header (e.g. "Mar 2025") into a
  // sortable timestamp; used to detect freshness gaps. Returns 0 on failure
  // so unparsed Screener rows sort to the back.
  const monthMap: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const periodToTs = (label: string): number => {
    const m = label?.match(/([A-Z][a-z]{2})\s+(\d{4})/);
    if (!m) return 0;
    const mo = monthMap[m[1]];
    if (mo === undefined) return 0;
    return new Date(parseInt(m[2], 10), mo, 28).getTime();
  };

  let mergedQuarterly: typeof quarterly = quarterly;
  let useNse = false;
  let nseLatestNewer = false;
  if (nseQuarters.length > 0) {
    useNse = true;
    const screenerLatestTs = quarterly.length > 0
      ? periodToTs(quarterly[quarterly.length - 1].period)
      : 0;
    const nseLatestTs = periodToTs(nseQuarters[nseQuarters.length - 1].period);
    nseLatestNewer = nseLatestTs > screenerLatestTs && screenerLatestTs > 0;

    // Map NSE rows to the screener-quarterly shape and dedupe by period.
    const nseAsRows = nseQuarters.map((q) => ({
      period: q.period,
      sales: q.sales,
      expenses: q.expenses,
      operatingProfit: q.operatingProfit,
      opmPct: q.opmPct,
      otherIncome: q.otherIncome,
      interest: q.interest,
      depreciation: q.depreciation,
      pbt: q.pbt,
      taxPct: q.taxPct,
      netProfit: q.netProfit,
      eps: q.eps,
      netMargin: q.netMargin,
    }));
    const nsePeriods = new Set(nseAsRows.map((r) => r.period));
    const screenerOnlyOlder = quarterly.filter((sq) => !nsePeriods.has(sq.period));

    // Combine: older Screener-only periods first, then NSE rows. Sort by
    // period timestamp so the most recent is genuinely last.
    mergedQuarterly = [...screenerOnlyOlder, ...nseAsRows]
      .sort((a, b) => periodToTs(a.period) - periodToTs(b.period))
      .slice(-12);
    if (nseLatestNewer) {
      debug.warnings.push(
        `NSE freshness patch: NSE has a more recent quarter (${nseQuarters[nseQuarters.length - 1].period}) than Screener's latest (${quarterly[quarterly.length - 1]?.period}). Using NSE as latest.`,
      );
    } else {
      debug.warnings.push(
        `NSE primary: spliced ${nseQuarters.length} NSE quarter(s) into ${screenerOnlyOlder.length} older Screener period(s)`,
      );
    }
  }

  // Most recent quarter data (caller's "latest reported")
  const latest = mergedQuarterly[mergedQuarterly.length - 1] || null;
  const prevYear = mergedQuarterly.length >= 5 ? mergedQuarterly[mergedQuarterly.length - 5] : null;
  const prevQuarter = mergedQuarterly.length >= 2 ? mergedQuarterly[mergedQuarterly.length - 2] : null;

  // ── STALENESS GATE ─────────────────────────────────────────────────────
  // Indian listed-co quarterly results land within ~45 days of period end.
  // If the latest period is more than 9 months old, the source is wrong —
  // either the slug routes to an archived page (KENNAMET → wrong canonical)
  // or the company has been delisted. Surface this loudly instead of
  // pretending the stale data is current.
  let stalenessMonths: number | null = null;
  if (latest) {
    const latestTs = periodToTs(latest.period);
    if (latestTs > 0) {
      stalenessMonths = Math.round(
        (Date.now() - latestTs) / (30.44 * 24 * 3600 * 1000),
      );
    }
  }
  const isStale = stalenessMonths !== null && stalenessMonths > 9;
  if (isStale) {
    debug.warnings.push(
      `STALE DATA: latest period (${latest?.period}) is ${stalenessMonths} months old. Source slug may be wrong — try /api/company/search to find canonical URL.`,
    );
  }

  return NextResponse.json({
    ok: true,
    source: useNse ? 'nse_primary' : 'screener_in',
    ticker: symbol,
    rawTicker: raw,
    company: companyName,
    industry,
    sector,
    subIndustry,
    about,
    debug,
    unit: 'INR_Cr',
    staleness: {
      monthsOld: stalenessMonths,
      isStale,
      latestPeriod: latest?.period || null,
    },
    provenance: {
      financials: useNse ? 'nse_quarterly_results' : 'screener_in',
      history: useNse ? 'nse_quarterly_results' : 'screener_in',
      ratios: 'screener_in',
      topMetrics: 'screener_in',
      sector: 'screener_in',
      annual: 'screener_in',
      balanceSheet: 'screener_in',
      cashFlow: 'screener_in',
      shareholding: 'screener_in',
    },
    topMetrics: {
      marketCap,           // ₹ Cr
      currentPrice: cmp,   // ₹
      peRatio: pe,
      bookValue,
      dividendYieldPct: dividendYield,
      roce,
      roe,
      faceValue,
      promoterHoldingPct: promoterHoldingPct,
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
    quarterly: mergedQuarterly,
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
