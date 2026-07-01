// zzz154 — TradingView sync v5.
// Fixes zzz153 header-escape bug: friendly names contain commas
// ("Revenue growth %, Quarterly YoY") — they must be CSV-quoted or
// the parser splits them into two columns and parseUSARow finds nothing.
//
// zzz153 — TradingView sync v4.
// Builds on zzz152 (scanner.tradingview.com JSON interception). Adds:
//   1. Field-ID → friendly-name column mapping so parseUSARow() in page.tsx
//      can read the CSVs unchanged.
//   2. ticker-view object handling — extracts Description (company name).
//   3. Unix-timestamp → Excel-serial date conversion for earnings dates
//      (parseUSARow uses usaSerialDate which expects Excel serial).
//   4. Drops noise columns (typespecs, pricescale, minmov, source-logoid, *.tr duplicates).
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'node:fs';
import path from 'node:path';

chromium.use(StealthPlugin());

const SCREENERS = [
  // Technicals tab (Qulla/Zanger/Bonde/Minervini)
  { id: 'sBtiBahk', slug: 'minervini-stocks',          name: 'Minervni Stocks' },
  { id: 'WJDx6FZ9', slug: 'qullamaggie-leaders',       name: 'Qualmaggie Leader Stocks in Bearmarket or Corrections' },
  { id: 'Px4kG2hQ', slug: 'episodic-pivot',            name: 'EPISODIC PIVOT / VOLUME SURGE' },
  { id: '9IcX30Ez', slug: 'liquidity-leaders',         name: 'Liquidity Leaders' },
  { id: 'Neuim2Bm', slug: 'weekly-gainer-usa',         name: 'Weekly Gainer Stocks USA' },
  // Shared: Bonde also used by USA Multibagger
  { id: 'RtSuWTgK', slug: 'sales-eps-growth-bonde',    name: 'Sales And EPS Growth for EP - Pradeep Bonde style' },
  // zzz162 — USA Multibagger (Fisher 100-Bagger framework)
  { id: '5gzenlmQ', slug: 'future-nvda-alab-app-pltr', name: 'Future NVDIA ALAB APP PLTR (USA)' },
  { id: 'GHHf1HVl', slug: 'usa-multibagger-3',         name: 'USA Multibagger (GHHf1HVl)' },
  { id: 'oRvEFfVY', slug: 'future-super-scalers-nbis', name: 'Future Super Scalers like NBIS Full' },
];

// ─── Field ID → friendly column header map ─────────────────────────────────
// Names on the right side must match what parseUSARow() in page.tsx looks for.
// Anything in DROP_FIELDS is skipped entirely; ticker-view is handled separately.
const FIELD_MAP = {
  'market_cap_basic': 'Market capitalization',
  'close': 'Price',
  'sector': 'Sector',
  'industry': 'Industry',
  'gross_profit_yoy_growth_fq': 'Gross profit growth %, Quarterly YoY',
  'total_revenue_yoy_growth_fq': 'Revenue growth %, Quarterly YoY',
  'total_revenue_yoy_growth_fy': 'Revenue growth %, Annual YoY',
  'gross_margin_ttm': 'Gross margin %, Trailing 12 months',
  'gross_margin_fy': 'Gross margin %, Annual',
  'free_cash_flow_margin_fy': 'Free cash flow margin %, Annual',
  'price_earnings_ttm': 'Price to earnings ratio',
  'non_gaap_price_to_earnings_per_share_forecast_next_fy': 'Forward non-GAAP price to earnings, Annual',
  'net_debt_fy': 'Net debt, Annual',
  'enterprise_value_ebitda_ttm': 'Enterprise value to EBITDA ratio, Trailing 12 months',
  'enterprise_value_to_revenue_ttm': 'Enterprise value to revenue ratio, Trailing 12 months',
  'price_sales_current': 'Price to sales ratio',
  'operating_margin_ttm': 'Operating margin %, Trailing 12 months',
  'price_book_fq': 'Price to book ratio',
  'return_on_equity_fq': 'Return on equity %, Trailing 12 months',
  'earnings_release_next_trading_date_fq': 'Upcoming earnings date',
  'cash_n_equivalents_fy': 'Cash and equivalents, Annual',
  'long_term_debt_fy': 'Long term debt, Annual',
  'earnings_per_share_diluted_yoy_growth_ttm': 'Earnings per share diluted growth %, TTM YoY',
  'return_on_invested_capital_fy': 'Return on invested capital %, Annual',
  'debt_to_equity_fq': 'Debt to equity ratio, Quarterly',
  'Perf.Y': 'Performance % 1 year',
  'net_margin_ttm': 'Net margin %, Trailing 12 months',
  'total_revenue_cagr_5y': 'Revenue growth %, 5 year CAGR',
  'price_earnings_growth_ttm': 'Price to earning to growth, Trailing 12 months',
  'AnalystRating': 'Analyst Rating',
  'piotroski_f_score_ttm': 'Piotroski F-score, Trailing 12 months',
  'piotroski_f_score_fy': 'Piotroski F-score, Annual',
  'altman_z_score_ttm': 'Altman Z-score, Trailing 12 months',
  'altman_z_score_fy': 'Altman Z-score, Annual',
  'share_buyback_ratio_fy': 'Shares buyback ratio %, Annual',
  'interst_cover_fy': 'Interest coverage, Annual',
  'return_on_capital_employed_fy': 'Return on capital employed %, Annual',
  'sloan_ratio_fy': 'Sloan ratio %, Annual',
  'buyback_yield': 'Buyback yield %',
  'research_and_dev_ratio_fy': 'Research and development ratio, Annual',
  'net_debt_to_ebitda_fy': 'Net debt to EBITDA ratio, Annual',
  'revenue_per_employee_fy': 'Revenue per employee, Annual',
  'sustainable_growth_rate_fy': 'Sustainable growth rate, Annual',
  'float_shares_percent_current': 'Free float %',
  'free_cash_flow_per_share_ttm': 'Free cash flow per share, Trailing 12 months',
  'EMA50': 'Exponential moving average, 50, 1 day',
  'EMA200': 'Exponential moving average, 200, 1 day',
  'EMA21': 'Exponential moving average, 21, 1 day',
  'cash_n_short_term_invest_fy': 'Cash and short-term investments, Annual',
  'Perf.3M': 'Performance %, 3 months',
  'Perf.6M': 'Performance %, 6 months',
  'Perf.W': 'Performance %, 1 week',
  'Perf.1M': 'Performance %, 1 month',
  'earnings_per_share_forecast_next_fy': 'Earnings per share estimate, Annual',
  'beta_5_year': 'Beta, 5 years',
  'ebitda_margin_ttm': 'EBITDA margin %, Trailing 12 months',
  'capex_per_share_ttm': 'Capital expenditures per share, Trailing 12 months',
  'earnings_per_share_diluted_yoy_growth_fq': 'Earnings per share diluted growth %, Quarterly YoY',
  'price_target_1y': 'Target price, 1 year',
  'average_volume_30d_calc': 'Average volume, 30 days',
  'RSI': 'Relative strength index, 14, 1 day',
  'total_shares_outstanding_current': 'Total common shares outstanding',
  'number_of_employees_fy': 'Number of employees, Annual',
  'free_cash_flow_fy': 'Free cash flow, Annual',
  'free_cash_flow_ttm': 'Free cash flow, Trailing 12 months',
  'price_52_week_high': 'High, 52 weeks',
  'price_52_week_low': 'Low, 52 weeks',
  'ATR': 'Average true range, 14, 1 day',
  'SMA50': 'Simple moving average, 50, 1 day',
  'SMA150': 'Simple moving average, 150, 1 day',
  'SMA200': 'Simple moving average, 200, 1 day',
  'Volatility.M': 'Volatility, 1 month',
  'Volatility.W': 'Volatility, 1 week',
  'relative_volume_10d_calc|1W': 'Relative volume, 1 week',
  'volume': 'Volume',
  'gap': 'Gap',
};

// Drop columns that are noise or duplicates we don't need
const DROP_FIELDS = new Set([
  'ticker-view',           // object — handled separately to extract Description
  'type',
  'typespecs',
  'fundamental_currency_code',
  'pricescale',
  'minmov',
  'fractional',
  'minmove2',
  'currency',
  'sector.tr',             // duplicate of `sector`
  'industry.tr',           // duplicate of `industry`
  'exchange.tr',           // duplicate — exchange comes from `s` field
  'source-logoid',
  'market',
  'price_to_cash_ratio',
  'AnalystRating.tr',      // duplicate
]);

// Convert Unix timestamp → Excel serial (parseUSARow expects Excel serial via usaSerialDate)
function unixToExcelSerial(unix) {
  if (typeof unix !== 'number' || !isFinite(unix) || unix <= 0) return '';
  // Excel serial: days since Dec 30 1899
  return (unix / 86400 + 25569).toFixed(4);
}

const SESSION = process.env.TRADINGVIEW_SESSIONID;
if (!SESSION) { console.error('[fatal] TRADINGVIEW_SESSIONID not set'); process.exit(1); }

const REPO_ROOT = path.resolve(process.cwd(), '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'frontend/public/data/tradingview');
const DEBUG_DIR = path.join(OUT_DIR, '_debug');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(DEBUG_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
  ],
});
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  viewport: { width: 1600, height: 1000 },
  acceptDownloads: true,
  locale: 'en-US',
  timezoneId: 'America/New_York',
});
await context.addCookies([
  { name: 'sessionid', value: SESSION, domain: '.tradingview.com', path: '/', secure: true, sameSite: 'Lax' },
]);

const shot = async (page, sc, step) => {
  try { await page.screenshot({ path: path.join(DEBUG_DIR, `${sc.slug}-${step}.png`), fullPage: false }); } catch {}
};

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Date columns that need Unix→Excel conversion
const DATE_FIELDS = new Set([
  'earnings_release_next_trading_date_fq',
]);

function scannerJsonToCsv(scanResponse, requestBody) {
  if (!scanResponse || !Array.isArray(scanResponse.data)) return null;
  let columns = [];
  try {
    const reqJson = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
    columns = reqJson?.columns || [];
  } catch {}

  // Build column index map — for each raw column, what's its friendly name?
  // null = drop column. We also track ticker-view index for Description extraction.
  let tickerViewIdx = -1;
  const friendlyCols = []; // [{ srcIdx, name, isDate }]
  columns.forEach((rawCol, i) => {
    if (rawCol === 'ticker-view') { tickerViewIdx = i; return; }
    if (DROP_FIELDS.has(rawCol)) return;
    const friendly = FIELD_MAP[rawCol];
    if (friendly) {
      friendlyCols.push({ srcIdx: i, name: friendly, isDate: DATE_FIELDS.has(rawCol) });
    } else {
      // Unknown column — keep as-is (won't be used by parser but won't break it either)
      friendlyCols.push({ srcIdx: i, name: rawCol, isDate: false });
    }
  });

  // Escape header too — many friendly names contain commas (e.g., "Revenue growth %, Quarterly YoY")
  const header = ['Symbol', 'Exchange', 'Description', ...friendlyCols.map(c => csvEscape(c.name))];
  const rows = scanResponse.data.map(item => {
    const sym = (item.s || '').split(':');
    const exchange = sym[0] || '';
    const ticker = sym[1] || sym[0] || '';
    const d = item.d || [];
    // Extract Description from ticker-view object
    let description = '';
    if (tickerViewIdx >= 0 && d[tickerViewIdx] && typeof d[tickerViewIdx] === 'object') {
      description = d[tickerViewIdx].description || '';
    }
    const vals = friendlyCols.map(c => {
      const raw = d[c.srcIdx];
      if (raw === null || raw === undefined) return '';
      if (c.isDate) return csvEscape(unixToExcelSerial(raw));
      if (Array.isArray(raw)) return csvEscape(raw.join(';'));
      if (typeof raw === 'object') return ''; // unknown object — drop
      return csvEscape(raw);
    });
    return [csvEscape(ticker), csvEscape(exchange), csvEscape(description), ...vals].join(',');
  });
  return [header.join(','), ...rows].join('\n');
}

const results = [];

for (const sc of SCREENERS) {
  console.log(`\n=== ${sc.name} (${sc.id}) ===`);
  const page = await context.newPage();
  const outPath = path.join(OUT_DIR, `${sc.slug}.csv`);
  const rawJsonPath = path.join(DEBUG_DIR, `${sc.slug}-scanner-response.json`);

  const scannerCalls = [];
  const onRequest = (request) => {
    const url = request.url();
    if (url.includes('scanner.tradingview.com') && url.includes('/scan')) {
      try {
        const postData = request.postData();
        scannerCalls.push({ url, request: postData, response: null });
      } catch {}
    }
  };
  const onResponse = async (response) => {
    const url = response.url();
    if (url.includes('scanner.tradingview.com') && url.includes('/scan')) {
      try {
        const body = await response.json();
        const last = scannerCalls.find(c => c.url === url && c.response === null);
        if (last) last.response = body;
      } catch {}
    }
  };
  page.on('request', onRequest);
  page.on('response', onResponse);

  try {
    const url = `https://www.tradingview.com/screener/${sc.id}/`;
    console.log(`  → ${url}`);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`  HTTP ${resp ? resp.status() : '?'}`);
    await shot(page, sc, '1-loaded');

    try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
    await page.waitForTimeout(5000);
    await shot(page, sc, '2-after-wait');

    console.log(`  captured ${scannerCalls.length} scanner calls`);
    fs.writeFileSync(rawJsonPath, JSON.stringify(scannerCalls, null, 2));

    const bestCall = scannerCalls
      .filter(c => c.response && Array.isArray(c.response.data))
      .sort((a, b) => (b.response.data.length) - (a.response.data.length))[0];

    if (!bestCall) throw new Error('No scanner data captured');
    console.log(`  best call has ${bestCall.response.data.length} rows`);

    const csv = scannerJsonToCsv(bestCall.response, bestCall.request);
    if (!csv) throw new Error('Failed to convert scanner JSON to CSV');
    fs.writeFileSync(outPath, csv);
    const stat = fs.statSync(outPath);
    console.log(`  ✓ ${path.basename(outPath)} (${stat.size} bytes, ${bestCall.response.data.length} rows)`);
    results.push({ ...sc, ok: true, size: stat.size, rowCount: bestCall.response.data.length });
  } catch (e) {
    const errMsg = e.message || String(e);
    console.error(`  ✗ ${sc.slug}: ${errMsg}`);
    await shot(page, sc, '9-FAIL');
    results.push({ ...sc, ok: false, error: errMsg });
  } finally {
    page.off('request', onRequest);
    page.off('response', onResponse);
    await page.close();
    await new Promise(r => setTimeout(r, 2000));
  }
}

await browser.close();

const manifest = {
  lastSync: new Date().toISOString(),
  workflowVersion: 'zzz162',
  approach: 'scanner-api-interception + field-id translation',
  ok: results.filter(r => r.ok).length,
  fail: results.filter(r => !r.ok).length,
  files: results.map(r => ({
    name: `${r.slug}.csv`,
    displayName: r.name,
    screenerId: r.id,
    ok: r.ok,
    size: r.size || 0,
    rowCount: r.rowCount || 0,
    error: r.error || null,
  })),
};
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n=== Manifest: ${manifest.ok} ok, ${manifest.fail} failed ===`);

if (manifest.fail === results.length) {
  console.error('::error::All screeners failed.');
  process.exit(2);
}
