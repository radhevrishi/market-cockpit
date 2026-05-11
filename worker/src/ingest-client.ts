// ─── Vercel ingest client ──────────────────────────────────────────────────
// Pushes the canonical event list to the Vercel /api/v1/earnings/calendar/ingest
// endpoint with the X-Ingest-Secret header.

import { CanonicalEvent } from './types.js';

export interface IngestResult {
  ok: boolean;
  status: number;
  ingested?: number;
  dropped?: number;
  dates_covered?: number;
  error?: string;
}

export async function pushToVercel(
  events: CanonicalEvent[],
  opts?: { url?: string; secret?: string },
): Promise<IngestResult> {
  const url = opts?.url || process.env.INGEST_URL || 'https://market-cockpit.vercel.app/api/v1/earnings/calendar/ingest';
  const secret = opts?.secret || process.env.INGEST_SECRET || 'dev-only';

  // Reshape to the ingest endpoint's expected schema
  const items = events.map((e) => ({
    symbol: e.symbol,
    company: e.company,
    filing_date: e.filing_date,
    filing_dt_iso: e.filing_dt_iso,
    quarter: e.quarter,
    period_ended: e.period_ended,
    audited: e.audited,
    consolidated: e.consolidated,
    period_type: e.period_type,
    attachment: e.attachment,
    source_url: e.source_url,
    exchange: e.exchange,
    // PATCH 0137: financial enrichment fields
    sector: e.sector,
    pe: e.pe,
    market_cap_cr: e.market_cap_cr,
    market_cap_bucket: e.market_cap_bucket,
    current_price: e.current_price,
    high_52w: e.high_52w,
    low_52w: e.low_52w,
    pct_from_52w_high: e.pct_from_52w_high,
    sales_curr_cr: e.sales_curr_cr,
    sales_prev_cr: e.sales_prev_cr,
    op_profit_curr_cr: e.op_profit_curr_cr,
    op_profit_prev_cr: e.op_profit_prev_cr,
    opm_pct: e.opm_pct,
    opm_prev_pct: e.opm_prev_pct,
    pat_curr_cr: e.pat_curr_cr,
    pat_prev_cr: e.pat_prev_cr,
    eps_curr: e.eps_curr,
    eps_prev: e.eps_prev,
    sales_yoy_pct: e.sales_yoy_pct,
    pat_yoy_pct: e.pat_yoy_pct,
    eps_yoy_pct: e.eps_yoy_pct,
    op_profit_yoy_pct: e.op_profit_yoy_pct,
    // PATCH 0145: pass latest quarter so frontend can detect not-yet-filed
    latest_quarter_label: e.latest_quarter_label,
    latest_quarter_end_iso: e.latest_quarter_end_iso,
    financials_source: e.financials_source,
    financials_scraped_at: e.financials_scraped_at,
  }));

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingest-Secret': secret,
      },
      body: JSON.stringify({ items }),
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    if (!res.ok) return { ok: false, status: res.status, error: json?.error || text.slice(0, 200) };
    return { ok: true, status: res.status, ...json };
  } catch (e: any) {
    return { ok: false, status: 0, error: e.message };
  }
}
