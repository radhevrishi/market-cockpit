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
