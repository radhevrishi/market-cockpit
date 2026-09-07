// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/earnings/calendar-us?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// The US equivalent of the India earnings calendar: which companies filed
// results on each date across a range. Cheap by design — it touches ONLY the
// EDGAR full-text index (no companyfacts, no prices), so a two-month sweep is
// ~90 requests and every completed date is cached for a month afterwards.
//
// EDGAR generates no index on weekends or market holidays, so a date with no
// filings is genuinely empty rather than missing. We mark weekends explicitly
// so the UI can say "weekend" instead of the ambiguous "no filings".
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { earningsFilersOn, cikTickerMap } from '@/lib/us-edgar';
import { pooled } from '@/lib/us-prices';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const dayMs = 86_400_000;
const MAX_DAYS = 95;

interface DayEntry {
  date: string;
  weekend: boolean;
  count: number;
  tickers: string[];
  eightK: number;      // earnings releases (8-K Item 2.02)
  periodic: number;    // 10-Q / 10-K
}

const _cache = new Map<string, { at: number; data: any }>();

function etToday(): string {
  return new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const today = etToday();
  let to = (searchParams.get('to') || '').slice(0, 10);
  let from = (searchParams.get('from') || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = today;
  if (to > today) to = today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    from = new Date(Date.parse(to + 'T00:00:00Z') - 29 * dayMs).toISOString().slice(0, 10);
  }
  if (from > to) [from, to] = [to, from];
  // Clamp the span so one request can never sweep a year of EDGAR.
  const span = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / dayMs);
  if (span > MAX_DAYS) {
    from = new Date(Date.parse(to + 'T00:00:00Z') - MAX_DAYS * dayMs).toISOString().slice(0, 10);
  }

  const key = `${from}|${to}`;
  const hit = _cache.get(key);
  const ttl = to >= today ? 10 * 60_000 : 24 * 3600_000;
  if (hit && Date.now() - hit.at < ttl && searchParams.get('force') !== '1') {
    return NextResponse.json(hit.data, { headers: { 'x-mc-cache': 'hit' } });
  }

  try {
    const dates: string[] = [];
    for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += dayMs) {
      dates.push(new Date(t).toISOString().slice(0, 10));
    }
    const isWeekend = (iso: string) => {
      const d = new Date(iso + 'T00:00:00Z').getUTCDay();
      return d === 0 || d === 6;
    };
    const workDates = dates.filter((d) => !isWeekend(d));

    await cikTickerMap();     // warm once so per-date resolution is free
    const cikMap = await cikTickerMap();

    const results = await pooled(workDates, 4, async (d) => {
      try { return { d, list: await earningsFilersOn(d) }; }
      catch { return { d, list: [] as any[] }; }
    });

    const byDate = new Map<string, DayEntry>();
    for (const d of dates) {
      byDate.set(d, { date: d, weekend: isWeekend(d), count: 0, tickers: [], eightK: 0, periodic: 0 });
    }
    let total = 0;
    for (const r of results) {
      if (!r) continue;
      const entry = byDate.get(r.d)!;
      const seen = new Set<string>();
      for (const f of r.list) {
        const tk = f.ticker || cikMap.get(f.cikNum) || null;
        if (!tk || seen.has(tk)) continue;
        seen.add(tk);
        entry.tickers.push(tk);
        if (f.form === '8-K' || f.form === '8-K/A') entry.eightK++; else entry.periodic++;
      }
      entry.tickers.sort();
      entry.count = entry.tickers.length;
      total += entry.count;
    }

    const payload = {
      from, to, total,
      days: Array.from(byDate.values()),
      generated_at: new Date().toISOString(),
    };
    if (_cache.size > 40) {
      const oldest = Array.from(_cache.entries()).sort((a, b) => a[1].at - b[1].at).slice(0, 10);
      for (const [k] of oldest) _cache.delete(k);
    }
    _cache.set(key, { at: Date.now(), data: payload });
    return NextResponse.json(payload, { headers: { 'x-mc-cache': 'miss' } });
  } catch (err: any) {
    return NextResponse.json(
      { from, to, total: 0, days: [], generated_at: new Date().toISOString(), error: String(err?.message || err) },
      { status: 502 });
  }
}
