import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

let redis: Redis | null = null;
try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
} catch {}

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
    const m = broadcastRaw.match(/(\d{1,2})[- /]([A-Za-z]{3,9}|\d{2})[- /](\d{4})\s*(\d{2}):?(\d{2})?/);
    if (m) {
      const months: Record<string, number> = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
      const mm = isNaN(+m[2]) ? months[m[2].toUpperCase().slice(0, 3)] : (+m[2] - 1);
      if (mm !== undefined) {
        const d = new Date(Date.UTC(+m[3], mm, +m[1], +m[4] - 5, (+(m[5] || 0)) - 30));
        if (!isNaN(d.getTime())) {
          filing_dt_iso = d.toISOString();
          filing_date = filing_dt_iso.slice(0, 10);
        }
      }
    } else {
      const d = new Date(broadcastRaw);
      if (!isNaN(d.getTime())) {
        filing_dt_iso = d.toISOString();
        filing_date = filing_dt_iso.slice(0, 10);
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
    exchange: 'NSE',
  };
}

export async function POST(req: Request) {
  // Auth
  const expected = process.env.EARNINGS_INGEST_SECRET || 'dev-only';
  const provided = req.headers.get('x-ingest-secret') || '';
  if (provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized — missing or wrong X-Ingest-Secret header' }, { status: 401 });
  }
  if (!redis) {
    return NextResponse.json({ error: 'KV not configured' }, { status: 503 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

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
    return NextResponse.json({ error: 'No rows in payload — expected { rows | items | quarterly | annual }' }, { status: 400 });
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

  // Write to KV (7d TTL)
  const ttl = 7 * 24 * 3600;
  try {
    await redis.set('earnings:calendar:nse:v1', JSON.stringify(payload), { ex: ttl });
    // Per-date keys
    for (const [date, dayItems] of Object.entries(byDate)) {
      await redis.set(
        `earnings:calendar:nse:v1:date:${date}`,
        JSON.stringify({ date, items: dayItems, total: dayItems.length, scraped_at: payload.scraped_at }),
        { ex: ttl },
      );
    }
  } catch (e: any) {
    return NextResponse.json({ error: `KV write failed: ${e.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    ingested: deduped.length,
    dropped: rawRows.length - deduped.length,
    dates_covered: allDates.length,
    from, to,
    scraped_at: payload.scraped_at,
  });
}
