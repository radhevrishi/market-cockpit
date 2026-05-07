import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────────────────────
// SEC EDGAR XBRL server-side proxy
// ─────────────────────────────────────────────────────────────────────────────
// Browsers cannot fetch SEC EDGAR directly:
//   1. SEC does not send CORS headers (cross-origin fetch is blocked).
//   2. SEC requires a real User-Agent — browsers refuse to set User-Agent
//      via fetch() (it's a forbidden header).
// This route runs on the server (no CORS, can set any header) and returns
// a clean RawFinancials-ready JSON shape that the page can consume directly.
// ─────────────────────────────────────────────────────────────────────────────

const SEC_HEADERS = {
  // SEC explicitly asks for "Sample Company Name AdminContact@samplecompany.com"
  // style identification. https://www.sec.gov/os/accessing-edgar-data
  'User-Agent': 'MarketCockpit/1.0 info@market-cockpit.com',
  'Accept': 'application/json',
  'Accept-Encoding': 'gzip, deflate',
  'Host': 'www.sec.gov',
};

const SEC_DATA_HEADERS = {
  ...SEC_HEADERS,
  'Host': 'data.sec.gov',
};

// Module-level CIK cache (persists across requests on the same lambda instance)
type TickerEntry = { cik_str: number; ticker: string; title: string };
let cikCache: Record<string, { cik: number; title: string }> | null = null;
let cikCacheTime = 0;
const CIK_TTL = 24 * 60 * 60 * 1000; // 24h

async function getCikMap(): Promise<Record<string, { cik: number; title: string }>> {
  if (cikCache && Date.now() - cikCacheTime < CIK_TTL) return cikCache;

  const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: SEC_HEADERS,
    signal: AbortSignal.timeout(10000),
    // Next.js — cache for 24h; revalidates on next call after expiry
    next: { revalidate: 86400 },
  });
  if (!res.ok) {
    throw new Error(`SEC ticker map returned ${res.status}`);
  }
  const data = (await res.json()) as Record<string, TickerEntry>;
  const map: Record<string, { cik: number; title: string }> = {};
  for (const entry of Object.values(data)) {
    if (entry?.ticker) {
      map[entry.ticker.toUpperCase()] = { cik: entry.cik_str, title: entry.title };
    }
  }
  cikCache = map;
  cikCacheTime = Date.now();
  return map;
}

// ── XBRL extraction helpers ────────────────────────────────────────────────
type Filing = { cur: number; prior: number | null; end: string; form: string };

function extractQuarterly(gaap: any, concepts: string[]): Filing | null {
  for (const concept of concepts) {
    const units: any[] = gaap?.[concept]?.units?.USD ?? [];
    const filings = units
      .filter((u) => (u.form === '10-Q' || u.form === '10-K') && u.val !== undefined && u.val !== null)
      // Quarterly facts: "fp" is Q1/Q2/Q3/FY, "fy" is fiscal year, period (start..end) ~ 90d
      .filter((u) => {
        if (!u.start || !u.end) return true; // instant facts use end only
        const days = (new Date(u.end).getTime() - new Date(u.start).getTime()) / 86400000;
        // Accept ~90d (quarterly) or no period info; filter out YTD/cumulative
        return days >= 80 && days <= 100;
      })
      .sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime());

    if (!filings.length) continue;
    const cur = filings[0];
    // YoY: same period last year, ±45 days
    const targetEnd = new Date(cur.end);
    targetEnd.setFullYear(targetEnd.getFullYear() - 1);
    const prior = filings.find(
      (u) => Math.abs(new Date(u.end).getTime() - targetEnd.getTime()) < 46 * 86400000
    );
    return {
      cur: cur.val as number,
      prior: (prior?.val as number) ?? null,
      end: cur.end as string,
      form: cur.form as string,
    };
  }
  return null;
}

function extractInstant(gaap: any, concepts: string[]): number | null {
  for (const concept of concepts) {
    const units: any[] = gaap?.[concept]?.units?.USD ?? [];
    const sorted = units
      .filter((u) => (u.form === '10-Q' || u.form === '10-K') && u.val !== undefined && u.val !== null)
      .sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime());
    if (sorted.length) return sorted[0].val;
  }
  return null;
}

// ── Route handler ──────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || '').trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ ok: false, error: 'Missing ticker parameter' }, { status: 400 });
  }

  // 1. Look up CIK
  let cikEntry: { cik: number; title: string } | undefined;
  try {
    const map = await getCikMap();
    cikEntry = map[ticker];
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `CIK lookup failed: ${err?.message || 'unknown error'}` },
      { status: 502 },
    );
  }
  if (!cikEntry) {
    return NextResponse.json(
      { ok: false, error: `Ticker "${ticker}" not found on SEC EDGAR. May be a non-US listing.` },
      { status: 404 },
    );
  }

  const cik = cikEntry.cik;
  const padded = String(cik).padStart(10, '0');

  // 2. Fetch company facts AND submissions in parallel
  // Submissions includes SIC description, exchange, business addresses — always
  // available even when FMP profile coverage is sparse. Critical for the theme
  // engine which needs SOME text to anchor matches against.
  const [factsRes, subRes] = await Promise.allSettled([
    fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`, {
      headers: SEC_DATA_HEADERS,
      signal: AbortSignal.timeout(15000),
      next: { revalidate: 3600 },
    }),
    fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
      headers: SEC_DATA_HEADERS,
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 86400 }, // 24h — these change rarely
    }),
  ]);

  let facts: any;
  if (factsRes.status === 'fulfilled' && factsRes.value.ok) {
    facts = await factsRes.value.json().catch(() => null);
  }
  if (!facts) {
    return NextResponse.json(
      {
        ok: false,
        error: `SEC companyfacts unavailable for CIK ${cik} (status: ${
          factsRes.status === 'fulfilled' ? factsRes.value.status : 'rejected'
        })`,
      },
      { status: 502 },
    );
  }

  let submissions: any = null;
  if (subRes.status === 'fulfilled' && subRes.value.ok) {
    submissions = await subRes.value.json().catch(() => null);
  }

  // ── Try to fetch the most recent 10-K's "Item 1. Business" text ────────
  // This is the canonical source for theme detection — but it's heavy (10-K
  // HTML can be 5MB). We pull only the first 200KB and extract the business
  // overview paragraph, which is what gets parsed for themes.
  let businessOverview = '';
  try {
    const recent = submissions?.filings?.recent;
    if (recent?.form && recent?.accessionNumber && recent?.primaryDocument) {
      const forms: string[] = recent.form;
      // Find most recent 10-K
      let idx = forms.findIndex((f) => f === '10-K');
      if (idx === -1) idx = forms.findIndex((f) => f === '10-Q'); // fall back to 10-Q
      if (idx !== -1) {
        const accNum = String(recent.accessionNumber[idx]).replace(/-/g, '');
        const primaryDoc = recent.primaryDocument[idx];
        const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNum}/${primaryDoc}`;
        const filingRes = await fetch(filingUrl, {
          headers: SEC_HEADERS,
          signal: AbortSignal.timeout(10000),
          next: { revalidate: 86400 },
        });
        if (filingRes.ok) {
          // Read up to 250KB — business section is near the top of 10-K
          const reader = filingRes.body?.getReader();
          if (reader) {
            const chunks: Uint8Array[] = [];
            let total = 0;
            const MAX = 250_000;
            while (total < MAX) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              total += value.byteLength;
            }
            try { reader.cancel(); } catch {}
            const buf = new Uint8Array(total);
            let off = 0;
            for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
            const html = new TextDecoder().decode(buf);
            // Strip HTML tags, collapse whitespace, take first 8KB of plain text
            const stripped = html
              .replace(/<script[\s\S]*?<\/script>/gi, ' ')
              .replace(/<style[\s\S]*?<\/style>/gi, ' ')
              .replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&[a-z]+;/gi, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            // Try to find Item 1. Business and grab ~6KB after it
            const m = stripped.match(/item\s+1\.?\s+business[:\.]?\s+/i);
            if (m && m.index !== undefined) {
              businessOverview = stripped.slice(m.index, m.index + 8000);
            } else {
              // Fallback: grab the middle of the document where prose tends to live
              businessOverview = stripped.slice(2000, 10000);
            }
          }
        }
      }
    }
  } catch {
    // best-effort; don't fail the route if 10-K fetch dies
  }

  // ── SIC code → theme seed terms (compensates for generic SIC labels) ───
  // Many companies have a SIC label like "Electronic Computers" that doesn't
  // trigger thematic keywords. We seed the corpus with related vocabulary.
  const SIC_SEEDS: Record<string, string> = {
    '3571': 'computer server compute hardware data center accelerator gpu',                  // Electronic Computers
    '3572': 'computer storage data center server',                                           // Computer Storage Devices
    '3576': 'networking 5g switch router',                                                   // Computer Communications Equipment
    '3577': 'computer peripheral printer',                                                   // Computer Peripheral Equipment
    '3674': 'semiconductor chip foundry wafer fpga asic',                                    // Semiconductors
    '3812': 'defense military radar surveillance aerospace sensor fusion unmanned',          // Search/Detection/Navigation
    '3669': 'communications signal alarm',                                                   // Communications Equipment NEC
    '3663': '5g network telecom radio satellite',                                            // Radio/TV Broadcasting Equipment
    '7372': 'software saas subscription cloud',                                              // Prepackaged Software
    '7370': 'software saas cloud',                                                           // Computer Services
    '7371': 'software it services',                                                          // Computer Services
    '7389': 'business services',                                                             // Services NEC
    '8731': 'biotech clinical trial therapeutic research',                                   // Commercial Physical Research
    '2834': 'pharmaceutical drug therapeutic clinical',                                      // Pharmaceutical Preparations
    '2836': 'biotech biological clinical therapeutic',                                       // Biological Products
    '4813': 'telecom 5g network',                                                            // Telephone Communications
    '6770': 'holding diversified',                                                           // Holding Companies
    '4911': 'energy electric utility power',                                                 // Electric Services
    '1311': 'oil gas energy upstream',                                                       // Crude Petroleum & Natural Gas
    '3711': 'auto vehicle automotive ev electric',                                           // Motor Vehicles
    '5961': 'ecommerce retail consumer',                                                     // Catalog Mail-Order Houses
    '5812': 'restaurant food service consumer',                                              // Eating Places
  };
  const sicSeed = SIC_SEEDS[String(submissions?.sic ?? '').trim()] || '';

  const gaap = facts?.facts?.['us-gaap'] ?? {};

  // 3. Extract concepts
  const rev = extractQuarterly(gaap, [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
    'RevenueFromContractWithCustomer',
  ]);
  if (!rev || !rev.cur) {
    return NextResponse.json(
      {
        ok: false,
        error: `No usable XBRL revenue facts for ${ticker} (CIK ${cik}). Will need FMP fallback.`,
      },
      { status: 404 },
    );
  }

  const gp = extractQuarterly(gaap, ['GrossProfit']);
  const ebit = extractQuarterly(gaap, ['OperatingIncomeLoss']);
  const pat = extractQuarterly(gaap, ['NetIncomeLoss']);
  const epsQ = extractQuarterly(gaap, ['EarningsPerShareBasic', 'EarningsPerShareDiluted']);
  const da = extractQuarterly(gaap, ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization']);
  const rnd = extractQuarterly(gaap, ['ResearchAndDevelopmentExpense']);
  const sga = extractQuarterly(gaap, ['SellingGeneralAndAdministrativeExpense']);
  const intExp = extractQuarterly(gaap, ['InterestExpense']);
  const pbt = extractQuarterly(gaap, [
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
  ]);
  const tax = extractQuarterly(gaap, ['IncomeTaxExpenseBenefit']);
  const cfo = extractQuarterly(gaap, ['NetCashProvidedByUsedInOperatingActivities']);
  const capex = extractQuarterly(gaap, ['PaymentsToAcquirePropertyPlantAndEquipment']);

  const cash = extractInstant(gaap, [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsAndShortTermInvestments',
  ]);
  const totalDebt = extractInstant(gaap, [
    'LongTermDebt',
    'LongTermDebtNoncurrent',
    'DebtCurrent',
    'LongTermDebtCurrent',
  ]);
  const equity = extractInstant(gaap, [
    'StockholdersEquity',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
  ]);
  const totalAssets = extractInstant(gaap, ['Assets']);

  // 4. Period label
  const endDate = new Date(rev.end);
  const mo = endDate.getMonth();
  const quarter = mo < 3 ? 'Q1' : mo < 6 ? 'Q2' : mo < 9 ? 'Q3' : 'Q4';
  const year = endDate.getFullYear();

  // Build a rich descriptive corpus from SEC submissions for theme detection.
  // Layered priority: 10-K business overview (richest) → SIC seed (theme hints
  // for generic SIC codes) → company metadata.
  const businessText = [
    businessOverview,                                    // ← actual 10-K Item 1 prose (highest signal)
    sicSeed,                                             // ← SIC-code seed terms (for generic SICs)
    submissions?.name,
    submissions?.sicDescription,
    submissions?.category,
    facts.entityName,
    ...(submissions?.tickers || []),
    ...(submissions?.formerNames || []).map((f: any) => f.name),
    ...((submissions?.filings?.recent?.primaryDocDescription || []) as string[]).slice(0, 10),
  ].filter(Boolean).join(' · ');

  // Return raw $ values (page applies its own SCALE factor for display)
  return NextResponse.json({
    ok: true,
    source: 'sec_edgar_xbrl',
    ticker,
    cik,
    company: facts.entityName || submissions?.name || cikEntry.title || ticker,
    sicDescription: submissions?.sicDescription || null,
    sicCode: submissions?.sic || null,
    exchange: (submissions?.exchanges || [])[0] || null,
    category: submissions?.category || null,
    stateOfIncorporation: submissions?.stateOfIncorporation || null,
    businessText, // for theme engine
    period: `${quarter} ${year}`,
    periodType: 'quarterly',
    filingType: rev.form === '10-K' ? 'SEC 10-K (EDGAR)' : 'SEC 10-Q (EDGAR)',
    periodEnd: rev.end,
    currency: 'USD',
    // P&L (absolute USD)
    revenue: rev.cur,
    revenuePrior: rev.prior,
    grossProfit: gp?.cur ?? null,
    operatingIncome: ebit?.cur ?? null,
    netIncome: pat?.cur ?? null,
    netIncomePrior: pat?.prior ?? null,
    eps: epsQ?.cur ?? null,
    epsPrior: epsQ?.prior ?? null,
    da: da?.cur ?? null,
    rnd: rnd?.cur ?? null,
    sga: sga?.cur ?? null,
    interestExpense: intExp?.cur ?? null,
    pbt: pbt?.cur ?? null,
    tax: tax?.cur ?? null,
    cfo: cfo?.cur ?? null,
    capex: capex?.cur ?? null,
    // Balance Sheet (absolute USD, instant)
    cash,
    totalDebt,
    equity,
    totalAssets,
  });
}
