import { NextResponse } from 'next/server';
import {
  fetchCompanyFinancialResults,
  fetchStockQuote,
  nseApiFetch,
} from '@/lib/nse';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────────────────────
// India financial-results server-side proxy (NSE + BSE)
// ─────────────────────────────────────────────────────────────────────────────
// Browsers cannot fetch NSE/BSE directly:
//   1. NSE blocks all requests without a session cookie warmed up by visiting
//      the homepage first; cross-origin cookie sharing is blocked anyway.
//   2. NSE/BSE both reject browser fetches with 401/403 (no Origin/Referer match).
//   3. Both expect a desktop User-Agent — browsers won't let JS set User-Agent.
// This route runs server-side and reuses lib/nse.ts which already handles the
// cookie warm-up / retry logic.
// ─────────────────────────────────────────────────────────────────────────────

const BSE_BASE = 'https://api.bseindia.com/BseIndiaAPI/api';
const BSE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.bseindia.com/',
  'Origin': 'https://www.bseindia.com',
};

// Strip exchange suffix (e.g. RELIANCE.NS → RELIANCE, AEROFLEX.BO → AEROFLEX)
function stripSuffix(symbol: string): { base: string; preferred: 'NSE' | 'BSE' | 'AUTO' } {
  const s = symbol.trim().toUpperCase();
  if (s.endsWith('.NS')) return { base: s.slice(0, -3), preferred: 'NSE' };
  if (s.endsWith('.BO') || s.endsWith('.BSE')) {
    return { base: s.slice(0, s.lastIndexOf('.')), preferred: 'BSE' };
  }
  return { base: s, preferred: 'AUTO' };
}

// ── BSE: scripcode lookup ──────────────────────────────────────────────────
// BSE uses 6-digit scripcodes, not tickers. Need a search step first.
async function bseScripLookup(symbol: string): Promise<{ code: string; name: string } | null> {
  const url = `${BSE_BASE}/SidCodeSearch/w?scripID=&scripcd=&Type=EQ&text=${encodeURIComponent(symbol)}`;
  try {
    const res = await fetch(url, { headers: BSE_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const arr: any[] = Array.isArray(data) ? data : data?.Table || [];
    // Match by exact ticker / scrip name first
    const exact = arr.find(
      (r) =>
        (r.scrip_id || '').toUpperCase() === symbol.toUpperCase() ||
        (r.SCRIP_CD || '').toString().toUpperCase() === symbol.toUpperCase(),
    );
    const pick = exact || arr[0];
    if (!pick) return null;
    return {
      code: String(pick.scrip_cd || pick.SCRIP_CD || pick.scripcode || '').trim(),
      name: pick.scrip_name || pick.SCRIP_NAME || pick.scrip_id || symbol,
    };
  } catch {
    return null;
  }
}

// ── BSE: quarterly financial results for a scripcode ───────────────────────
async function bseFetchFinancials(scripcode: string): Promise<any[] | null> {
  // BSE Corporate financial results endpoint
  const url = `${BSE_BASE}/CorpannEt/w?scripcode=${encodeURIComponent(scripcode)}&strCat=Result&strType=C`;
  try {
    const res = await fetch(url, { headers: BSE_HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    const arr: any[] = Array.isArray(data) ? data : data?.Table || data?.data || [];
    return arr;
  } catch {
    return null;
  }
}

// ── BSE: company-info quote (price + market cap) ───────────────────────────
async function bseQuote(scripcode: string): Promise<any | null> {
  const url = `${BSE_BASE}/StockReachGraph/w?scripcode=${encodeURIComponent(scripcode)}&flag=0&fromdate=&todate=&seriesid=`;
  try {
    const res = await fetch(url, { headers: BSE_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── NSE: derive most recent quarterly result row ───────────────────────────
type FinResult = {
  symbol: string;
  consolidated?: string;
  re_emp?: string;
  fromDate?: string;
  toDate?: string;
  audited?: string;
  cumulative?: string;
  // Field names vary; capture loosely
  [key: string]: any;
};

function pickLatestNSEResult(rows: any[]): FinResult | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  // NSE returns objects like: { symbol, fromDate, toDate, expenditure, income, profitBeforeTax, ... }
  // Sort by toDate desc, prefer Standalone first (so we don't double-count when consolidated also shown).
  const sorted = [...rows].sort((a, b) => {
    const ad = new Date(a.toDate || a.broadCastDate || 0).getTime();
    const bd = new Date(b.toDate || b.broadCastDate || 0).getTime();
    return bd - ad;
  });
  // Prefer Consolidated if available (gives true picture for groups), fall back to Standalone
  const consolidated = sorted.find((r) => /consolidated/i.test(r.consolidated || r.re_emp || ''));
  return consolidated || sorted[0];
}

// Try to coerce any of the many revenue-like fields NSE returns to a number.
// NSE financial-results values are reported in ₹ Lakhs (1 Lakh = 100,000).
// Caller converts to ₹ Mn for display (₹ Lakh × 0.1 = ₹ Mn).
function pickNum(obj: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (v === undefined || v === null || v === '') continue;
    const n = parseFloat(String(v).replace(/,/g, ''));
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

// ── Route handler ─────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = (searchParams.get('ticker') || '').trim();
  if (!raw) {
    return NextResponse.json({ ok: false, error: 'Missing ticker parameter' }, { status: 400 });
  }
  const { base, preferred } = stripSuffix(raw);

  // ── NSE path ──────────────────────────────────────────────────────────
  let nseResults: any[] | null = null;
  let nseQuote: any = null;
  if (preferred === 'NSE' || preferred === 'AUTO') {
    try {
      const fin = await fetchCompanyFinancialResults(base);
      // NSE returns either an array or an object { data: [...] }
      const arr: any[] = Array.isArray(fin) ? fin : fin?.data || [];
      nseResults = arr;
      // Best-effort quote (price/sector). Don't fail if missing.
      nseQuote = await fetchStockQuote(base).catch(() => null);
    } catch {
      // ignore
    }
  }

  if (nseResults && nseResults.length > 0) {
    const row = pickLatestNSEResult(nseResults);
    if (row) {
      // NSE values are in ₹ Lakhs (1 Lakh = 0.1 Mn). Convert to ₹ Mn.
      const LAKH_TO_MN = 0.1;
      const toMn = (n: number | null) => (n === null ? null : Math.round(n * LAKH_TO_MN * 100) / 100);

      // Field name normalization — NSE column names vary by API revision
      const revenueLakhs = pickNum(row, [
        'revenueFromOperations',
        'income',
        'totalIncomeFromOperations',
        'netSales',
        'sales',
      ]);
      const expensesLakhs = pickNum(row, ['expenditure', 'totalExpenses', 'totalExpenditure']);
      const opIncomeLakhs = pickNum(row, [
        'profitFromOperations',
        'operatingProfit',
        'profitBeforeInterestTaxOtherItems',
      ]);
      const pbtLakhs = pickNum(row, ['profitBeforeTax', 'pbt']);
      const taxLakhs = pickNum(row, ['tax', 'taxExpense', 'totalTax']);
      const patLakhs = pickNum(row, [
        'profitAfterTax',
        'profitLossForPeriod',
        'netProfitLoss',
        'pat',
        'profitLoss',
      ]);
      const epsBasic = pickNum(row, ['basicEps', 'epsBasic', 'eps']);
      const intExpLakhs = pickNum(row, ['financeCost', 'interestExpense', 'interest']);
      const daLakhs = pickNum(row, ['depreciationAmortisation', 'depreciation']);

      // Period label
      const toDate = row.toDate || row.broadCastDate || '';
      let period = 'Latest';
      if (toDate) {
        const d = new Date(toDate);
        if (!Number.isNaN(d.getTime())) {
          const mo = d.getMonth();
          const q = mo < 3 ? 'Q4' : mo < 6 ? 'Q1' : mo < 9 ? 'Q2' : 'Q3'; // India FY: Apr–Mar
          // FY label: Jan–Mar belongs to FY ending that year, others to FY ending next year
          const fyEnd = mo < 3 ? d.getFullYear() : d.getFullYear() + 1;
          period = `${q} FY${String(fyEnd).slice(2)}`;
        }
      }

      const company =
        nseQuote?.info?.companyName ||
        nseQuote?.metadata?.companyName ||
        row.companyName ||
        base;

      const operatingIncome = opIncomeLakhs !== null
        ? opIncomeLakhs
        : (revenueLakhs !== null && expensesLakhs !== null ? revenueLakhs - expensesLakhs : null);

      return NextResponse.json({
        ok: true,
        source: 'nse_financial_results',
        ticker: base,
        company,
        period,
        periodType: 'quarterly',
        filingType: 'NSE Quarterly Results',
        periodEnd: toDate,
        currency: 'INR',
        // All values in ₹ Mn
        revenue: toMn(revenueLakhs),
        revenuePrior: null, // NSE row only has current period — caller can infer YoY from prior rows
        operatingIncome: toMn(operatingIncome),
        netIncome: toMn(patLakhs),
        netIncomePrior: null,
        eps: epsBasic,
        epsPrior: null,
        interestExpense: toMn(intExpLakhs),
        da: toMn(daLakhs),
        pbt: toMn(pbtLakhs),
        tax: toMn(taxLakhs),
        // BS / CF not in NSE results endpoint
        grossProfit: null,
        rnd: null,
        sga: null,
        cfo: null,
        capex: null,
        cash: null,
        totalDebt: null,
        equity: null,
        totalAssets: null,
        // Bonus: include all prior rows so client can compute QoQ / YoY locally
        history: nseResults.slice(0, 12),
      });
    }
  }

  // ── BSE path (when NSE fails OR user explicitly asked for .BO) ─────────
  if (preferred === 'BSE' || preferred === 'AUTO') {
    const scrip = await bseScripLookup(base);
    if (scrip?.code) {
      const [bseFin, quote] = await Promise.all([
        bseFetchFinancials(scrip.code),
        bseQuote(scrip.code),
      ]);

      if (bseFin && bseFin.length > 0) {
        // BSE rows are filings; latest = first. Each links to a PDF.
        const latest = bseFin[0];
        return NextResponse.json({
          ok: true,
          source: 'bse_financial_results',
          ticker: base,
          scripcode: scrip.code,
          company: scrip.name || quote?.CompanyName || base,
          period: latest?.QuarterEndDate || latest?.PeriodEnded || 'Latest',
          periodType: 'quarterly',
          filingType: 'BSE Result Filing',
          periodEnd: latest?.QuarterEndDate || latest?.PeriodEnded || null,
          currency: 'INR',
          // BSE doesn't return numeric line items inline — only the filing record.
          // Numeric values must be parsed from the PDF (latest.Fld_Attachsr, latest.AttachLink).
          attachmentUrl:
            latest?.AttachLink ||
            (latest?.Fld_Attachsr
              ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${latest.Fld_Attachsr}`
              : null),
          revenue: null,
          revenuePrior: null,
          operatingIncome: null,
          netIncome: null,
          netIncomePrior: null,
          eps: null,
          epsPrior: null,
          history: bseFin.slice(0, 12),
          warning:
            'BSE returned only filing metadata, not numeric values. The latest filing PDF link is in `attachmentUrl`. Use PDF upload path or FMP for line-item financials.',
        });
      }

      // No filings — but we at least found the scrip
      return NextResponse.json(
        {
          ok: false,
          error: `Found ${base} on BSE (scripcode ${scrip.code}) but no financial-result filings returned.`,
          ticker: base,
          scripcode: scrip.code,
          company: scrip.name,
        },
        { status: 404 },
      );
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error:
        `No data found on NSE or BSE for "${raw}". ` +
        `Verify the ticker (e.g. RELIANCE.NS, AEROFLEX.BO) — symbol must match the exchange listing exactly.`,
    },
    { status: 404 },
  );
}
