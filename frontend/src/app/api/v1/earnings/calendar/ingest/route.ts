import { NextResponse } from 'next/server';
import { kvSet, kvGet, isRedisAvailable } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── CORS (lets the worker — or one-time Chrome seed — POST cross-origin) ───
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Ingest-Secret',
    'Access-Control-Max-Age': '86400',
  };
}
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/earnings/calendar/ingest — POST (patch 0134)
//
// Accepts a raw NSE-shaped payload (from Claude-in-Chrome scraping the user's
// own browser session against the NSE corporate-financial-results endpoint),
// normalises it, and writes to the same KV keys the /calendar GET endpoint
// reads.
//
// Auth: shared secret in env var EARNINGS_INGEST_SECRET (header X-Ingest-Secret).
// Falls back to 'dev-only' when env not set — DO NOT deploy without setting it.
//
// Body shape (one of):
//   { rows: [ NSE_RAW_ROW, ... ] }        — flat array we'll normalise
//   { items: [ CANONICAL, ... ] }         — pre-normalised
//   { quarterly?: [...], annual?: [...] } — when scraped per-period
// ═══════════════════════════════════════════════════════════════════════════

// KV helper is used directly (kvSet / isRedisAvailable)

interface CanonicalItem {
  symbol: string;
  company: string;
  filing_date: string;
  filing_dt_iso?: string | null;
  quarter?: string;
  period_ended?: string;
  audited?: boolean;
  consolidated?: boolean;
  period_type?: string;
  attachment?: string | null;
  source_url?: string;
  exchange?: string;
  // PATCH 0137: enrichment fields
  sector?: string;
  pe?: number | null;
  market_cap_cr?: number | null;
  market_cap_bucket?: string | null;
  current_price?: number | null;
  high_52w?: number | null;
  low_52w?: number | null;
  pct_from_52w_high?: number | null;
  sales_curr_cr?: number | null;
  sales_prev_cr?: number | null;
  op_profit_curr_cr?: number | null;
  op_profit_prev_cr?: number | null;
  opm_pct?: number | null;
  opm_prev_pct?: number | null;
  pat_curr_cr?: number | null;
  pat_prev_cr?: number | null;
  eps_curr?: number | null;
  eps_prev?: number | null;
  sales_yoy_pct?: number | null;
  pat_yoy_pct?: number | null;
  eps_yoy_pct?: number | null;
  op_profit_yoy_pct?: number | null;
  financials_source?: string;
  financials_scraped_at?: string;
  // PATCH 0145: Screener's latest quarter — used by frontend to skip
  // not-yet-filed companies whose board meeting is scheduled but Screener
  // still has only the prior quarter.
  latest_quarter_label?: string;
  latest_quarter_end_iso?: string;
  // PATCH 0148: Yahoo Finance price overlay
  gap_pct?: number | null;
  d1_pct?: number | null;
  move_pct?: number | null;
  ma_50?: number | null;
  ma_150?: number | null;
  ma_200?: number | null;
  ma_200_slope_30d?: number | null;
  return_1y_pct?: number | null;
  return_12w_pct?: number | null;
  stage?: 1 | 2 | 3 | 4 | null;
  trend_template_passes?: boolean;
  rs_rating?: number | null;
  price_scraped_at?: string;
  // PATCH 0149: OCF / accrual quality
  ocf_annual_cr?: number | null;
  pat_annual_cr?: number | null;
  ocf_to_pat_ratio?: number | null;
}

// Normalise one NSE raw row → canonical
function normaliseRow(r: any): CanonicalItem | null {
  const symbol = String(r?.symbol || r?.SYMBOL || '').trim().toUpperCase();
  if (!symbol) return null;
  const company = String(r?.companyName || r?.COMPANY_NAME || r?.company || symbol).trim();

  const broadcastRaw = String(r?.broadcast_date_time || r?.BROADCAST_DATE || r?.broadcastDateTime || r?.filing_dt_iso || '').trim();
  let filing_date: string | null = null;
  let filing_dt_iso: string | null = null;
  if (broadcastRaw) {
    // PATCH 0146: anchor filing_date to IST calendar day, not UTC slice.
    // Trendlyne's broadcast_date_time is IST-formatted ("08-May-2026 18:45").
    // A late-evening IST filing (22:00 IST May 8 = 16:30 UTC May 8) was correct
    // before, but an after-midnight IST filing (02:00 IST May 9 = 20:30 UTC May 8)
    // was wrongly bucketed under May 8 in UTC. EarningsPulse and every Indian
    // exchange anchor to IST calendar — so should we.
    const m = broadcastRaw.match(/(\d{1,2})[- /]([A-Za-z]{3,9}|\d{2})[- /](\d{4})\s*(\d{2}):?(\d{2})?/);
    if (m) {
      const months: Record<string, number> = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
      const mm = isNaN(+m[2]) ? months[m[2].toUpperCase().slice(0, 3)] : (+m[2] - 1);
      if (mm !== undefined) {
        const istDay = +m[1], istYear = +m[3];
        // Calendar day in IST — never shifted to UTC
        filing_date = `${istYear}-${String(mm + 1).padStart(2, '0')}-${String(istDay).padStart(2, '0')}`;
        // Precise timestamp: convert IST → UTC for filing_dt_iso
        const d = new Date(Date.UTC(istYear, mm, istDay, +m[4] - 5, (+(m[5] || 0)) - 30));
        if (!isNaN(d.getTime())) filing_dt_iso = d.toISOString();
      }
    } else {
      // Fallback: plain Date parse — used when broadcast string is an ISO timestamp
      const d = new Date(broadcastRaw);
      if (!isNaN(d.getTime())) {
        filing_dt_iso = d.toISOString();
        // Compute the IST calendar day by shifting +5:30 then slicing
        const istMs = d.getTime() + (5 * 60 + 30) * 60_000;
        filing_date = new Date(istMs).toISOString().slice(0, 10);
      }
    }
  }
  // Allow filing_date to be passed directly too
  if (!filing_date && r?.filing_date) {
    filing_date = String(r.filing_date).slice(0, 10);
  }
  if (!filing_date) return null;

  const periodEnded = String(r?.period_ended || r?.periodEnded || r?.PERIOD_ENDED || '').trim();
  let quarter = String(r?.quarter || '').toUpperCase();
  if (!quarter && periodEnded) {
    const pm = periodEnded.match(/(\d{1,2})[- /]([A-Za-z]{3,9})[- /](\d{4})/);
    if (pm) {
      const months: Record<string, number> = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
      const mNum = months[pm[2].toUpperCase().slice(0, 3)] ?? -1;
      const yr = +pm[3];
      if (mNum === 2)        quarter = `Q4FY${String(yr).slice(2)}`;
      else if (mNum === 5)   quarter = `Q1FY${String(yr).slice(2)}`;
      else if (mNum === 8)   quarter = `Q2FY${String(yr).slice(2)}`;
      else if (mNum === 11)  quarter = `Q3FY${String(yr).slice(2)}`;
    }
  }

  const attachment = r?.attachment ? String(r.attachment) : null;
  const fullAttachment = attachment
    ? (attachment.startsWith('http') ? attachment : `https://www.nseindia.com/${attachment.replace(/^\//, '')}`)
    : null;

  // Pull through enrichment fields when present
  const num = (v: any): number | null => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    symbol,
    company,
    filing_date,
    filing_dt_iso,
    quarter,
    period_ended: periodEnded,
    audited: !!r?.audited || String(r?.audited || '').toLowerCase() === 'yes',
    consolidated: /consolidated/i.test(r?.consolidated || r?.filing_status || ''),
    period_type: r?.period_type || r?._period || '',
    attachment: fullAttachment,
    source_url: fullAttachment || `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
    exchange: r?.exchange || 'NSE',
    // PATCH 0137: enrichment passthrough
    sector: r?.sector || undefined,
    pe: num(r?.pe),
    market_cap_cr: num(r?.market_cap_cr),
    market_cap_bucket: r?.market_cap_bucket || null,
    current_price: num(r?.current_price),
    high_52w: num(r?.high_52w),
    low_52w: num(r?.low_52w),
    pct_from_52w_high: num(r?.pct_from_52w_high),
    sales_curr_cr: num(r?.sales_curr_cr),
    sales_prev_cr: num(r?.sales_prev_cr),
    op_profit_curr_cr: num(r?.op_profit_curr_cr),
    op_profit_prev_cr: num(r?.op_profit_prev_cr),
    opm_pct: num(r?.opm_pct),
    opm_prev_pct: num(r?.opm_prev_pct),
    pat_curr_cr: num(r?.pat_curr_cr),
    pat_prev_cr: num(r?.pat_prev_cr),
    eps_curr: num(r?.eps_curr),
    eps_prev: num(r?.eps_prev),
    sales_yoy_pct: num(r?.sales_yoy_pct),
    pat_yoy_pct: num(r?.pat_yoy_pct),
    eps_yoy_pct: num(r?.eps_yoy_pct),
    op_profit_yoy_pct: num(r?.op_profit_yoy_pct),
    latest_quarter_label: r?.latest_quarter_label || undefined,
    latest_quarter_end_iso: r?.latest_quarter_end_iso || undefined,
    financials_source: r?.financials_source,
    financials_scraped_at: r?.financials_scraped_at,
    // PATCH 0148 — Yahoo price overlay
    gap_pct: num(r?.gap_pct),
    d1_pct: num(r?.d1_pct),
    move_pct: num(r?.move_pct),
    ma_50: num(r?.ma_50),
    ma_150: num(r?.ma_150),
    ma_200: num(r?.ma_200),
    ma_200_slope_30d: num(r?.ma_200_slope_30d),
    return_1y_pct: num(r?.return_1y_pct),
    return_12w_pct: num(r?.return_12w_pct),
    stage: (typeof r?.stage === 'number' && r.stage >= 1 && r.stage <= 4) ? r.stage : null,
    trend_template_passes: !!r?.trend_template_passes,
    rs_rating: num(r?.rs_rating),
    price_scraped_at: r?.price_scraped_at,
    // PATCH 0149 — OCF
    ocf_annual_cr: num(r?.ocf_annual_cr),
    pat_annual_cr: num(r?.pat_annual_cr),
    ocf_to_pat_ratio: num(r?.ocf_to_pat_ratio),
  };
}

export async function POST(req: Request) {
  // Auth
  // PATCH 0452 P0-7 — Audit flagged this hardcoded 'dev-only' fallback as
  // a calendar-injection vector. Now require the env var to be set in prod;
  // missing env → 503, never accept a default secret.
  const expected = process.env.EARNINGS_INGEST_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'EARNINGS_INGEST_SECRET env not configured on server' },
      { status: 503, headers: corsHeaders() }
    );
  }
  const provided = req.headers.get('x-ingest-secret') || '';
  if (provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized — missing or wrong X-Ingest-Secret header' }, { status: 401, headers: corsHeaders() });
  }
  if (!isRedisAvailable()) {
    return NextResponse.json({ error: 'KV not configured' }, { status: 503, headers: corsHeaders() });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: corsHeaders() }); }

  // Collect raw rows from any of the accepted shapes
  let rawRows: any[] = [];
  if (Array.isArray(body)) rawRows = body;
  else if (Array.isArray(body?.rows)) rawRows = body.rows;
  else if (Array.isArray(body?.items)) rawRows = body.items;
  else {
    if (Array.isArray(body?.quarterly)) rawRows.push(...body.quarterly.map((r: any) => ({ ...r, _period: 'Quarterly' })));
    if (Array.isArray(body?.annual))    rawRows.push(...body.annual.map((r: any)    => ({ ...r, _period: 'Annual' })));
    if (Array.isArray(body?.['half-yearly'])) rawRows.push(...body['half-yearly'].map((r: any) => ({ ...r, _period: 'Half-Yearly' })));
  }
  if (rawRows.length === 0) {
    return NextResponse.json({ error: 'No rows in payload — expected { rows | items | quarterly | annual }' }, { status: 400, headers: corsHeaders() });
  }

  // Normalise
  const items: CanonicalItem[] = [];
  for (const r of rawRows) {
    const n = normaliseRow(r);
    if (n) items.push(n);
  }

  // Dedup by (symbol, filing_date, period_ended)
  const seen = new Set<string>();
  const deduped: CanonicalItem[] = [];
  for (const it of items) {
    const k = `${it.symbol}|${it.filing_date}|${it.period_ended || ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(it);
  }

  // Group by date
  const byDate: Record<string, CanonicalItem[]> = {};
  for (const it of deduped) {
    if (!byDate[it.filing_date]) byDate[it.filing_date] = [];
    byDate[it.filing_date].push(it);
  }
  for (const k of Object.keys(byDate)) {
    byDate[k].sort((a, b) => (b.filing_dt_iso || '').localeCompare(a.filing_dt_iso || ''));
  }

  const allDates = Object.keys(byDate).sort();
  const from = allDates[0] || '';
  const to   = allDates[allDates.length - 1] || '';

  const payload = {
    scraped_at: new Date().toISOString(),
    from, to,
    total: deduped.length,
    by_date: byDate,
    items: deduped,
  };

  // ── Write to KV ──────────────────────────────────────────────────────────
  // PATCH 0143: incremental calendar — past-date entries are sticky.
  //
  //   • Past dates (< today): MERGE new entries with existing KV.
  //     Existing items stay; new items are appended; items that already
  //     exist with same (symbol, period_ended) are UPGRADED if the new
  //     entry has financials (sales_curr_cr) and the old one didn't.
  //   • Today + future: overwrite (Trendlyne is source of truth here).
  //
  // The full-payload key (earnings:calendar:nse:v1) is overwritten too —
  // it's only used by the latest-pass diagnostic, not by the read path.
  // Per-date keys are the canonical read source and they get the merge.
  //
  // Bumped TTL 7d → 35d so past dates survive a long worker outage.
  const ttl = 35 * 24 * 3600;
  const todayIso = new Date().toISOString().slice(0, 10);
  type AnyItem = CanonicalItem & { symbol: string; filing_date: string; period_ended?: string };

  function mergeDayItems(existing: AnyItem[], incoming: AnyItem[]): AnyItem[] {
    const keyOf = (x: AnyItem) => `${x.symbol}|${x.period_ended || ''}`;
    const out = new Map<string, AnyItem>();
    for (const e of existing) out.set(keyOf(e), e);
    for (const n of incoming) {
      const k = keyOf(n);
      const prev = out.get(k);
      if (!prev) {
        out.set(k, n);
      } else {
        // Upgrade-on-financials: if new entry has Sales/PAT data and prev didn't, take new.
        const newHasFin  = n.sales_curr_cr != null || n.pat_curr_cr != null || n.eps_curr != null;
        const prevHasFin = prev.sales_curr_cr != null || prev.pat_curr_cr != null || prev.eps_curr != null;
        if (newHasFin && !prevHasFin) {
          out.set(k, n);
        } else if (newHasFin && prevHasFin) {
          // Both enriched — prefer the one scraped more recently
          const nT = n.financials_scraped_at || '';
          const pT = prev.financials_scraped_at || '';
          if (nT > pT) out.set(k, n);
        }
        // else: keep existing (which already has financials)
      }
    }
    return Array.from(out.values()).sort(
      (a, b) => (b.filing_dt_iso || '').localeCompare(a.filing_dt_iso || ''),
    );
  }

  let mergedCount = 0;
  let overwroteCount = 0;
  try {
    await kvSet('earnings:calendar:nse:v1', payload, ttl);
    for (const [date, dayItems] of Object.entries(byDate)) {
      let finalItems: AnyItem[] = dayItems as AnyItem[];
      if (date < todayIso) {
        // Past date — merge with existing
        const existing = (await kvGet(`earnings:calendar:nse:v1:date:${date}`)) as
          | { items?: AnyItem[] }
          | null;
        if (existing?.items?.length) {
          finalItems = mergeDayItems(existing.items, dayItems as AnyItem[]);
          mergedCount++;
        } else {
          overwroteCount++;
        }
      } else {
        overwroteCount++;
      }
      await kvSet(
        `earnings:calendar:nse:v1:date:${date}`,
        { date, items: finalItems, total: finalItems.length, scraped_at: payload.scraped_at },
        ttl,
      );
    }
  } catch (e: any) {
    return NextResponse.json({ error: `KV write failed: ${e.message}` }, { status: 500, headers: corsHeaders() });
  }

  return NextResponse.json({
    ok: true,
    ingested: deduped.length,
    dropped: rawRows.length - deduped.length,
    dates_covered: allDates.length,
    from, to,
    scraped_at: payload.scraped_at,
  }, { headers: corsHeaders() });
}
