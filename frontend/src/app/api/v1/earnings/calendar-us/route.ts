// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/earnings/calendar-us?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// The US equivalent of the India earnings calendar: which companies ANNOUNCED
// results on each date. Cheap by design — it touches the EDGAR full-text index
// plus one `submissions` lookup per 10-Q-only filer (cached 6h), never
// companyfacts or prices — so a two-month sweep is ~100–150 requests once, and
// every completed date is cached for a month afterwards.
//
// WHAT "ANNOUNCED" MEANS HERE
// ────────────────────────────
// The announcement is the 8-K Item 2.02 (the press release). A 10-Q or 10-K
// that lands later is the same result's detail, not a new event — an audit
// found HD, CSCO, KEYS, WMT, TGT and LOW all listed 1–3 weeks after they had
// actually reported, purely because their 10-Q fell in the range. So a 10-Q
// filer is re-dated to its 8-K when one exists in the prior 30 days; if that
// 8-K is before the range it is dropped from the range; only issuers with NO
// 8-K (small companies often skip it) keep the 10-Q date and are tagged so.
//
// EDGAR generates no index on weekends or market holidays, so a date with no
// filings is genuinely empty rather than missing. Weekends are marked
// explicitly so the UI can say "weekend" instead of the ambiguous "no filings".
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { earningsFilersOn, announcementDateFor, type EdgarFiling } from '@/lib/us-edgar';
import { pooled } from '@/lib/us-prices';
import { nasdaqEarningsOn, type ExpectedReporter } from '@/lib/us-nasdaq';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const dayMs = 86_400_000;
const MAX_DAYS = 95;

interface DayTicker { ticker: string; company: string; form: '8-K' | '10-Q' | '10-K'; filing_url: string; }
interface DayEntry {
  date: string;
  weekend: boolean;
  future: boolean;
  count: number;
  tickers: string[];             // kept for backwards compatibility
  entries: DayTicker[];          // ACTUAL filings (EDGAR)
  expected: ExpectedReporter[];  // SCHEDULED reporters (Nasdaq) — the whole list for future dates,
                                 // the not-yet-filed remainder for today, empty for the past
  eightK: number;
  periodic: number;
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
  // Future dates are allowed now (Nasdaq schedule), up to 45 days ahead.
  const maxFuture = new Date(Date.parse(today + 'T00:00:00Z') + 45 * dayMs).toISOString().slice(0, 10);
  if (to > maxFuture) to = maxFuture;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    from = new Date(Date.parse(to + 'T00:00:00Z') - 29 * dayMs).toISOString().slice(0, 10);
  }
  if (from > to) [from, to] = [to, from];
  const span = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / dayMs);
  if (span > MAX_DAYS) {
    from = new Date(Date.parse(to + 'T00:00:00Z') - MAX_DAYS * dayMs).toISOString().slice(0, 10);
  }

  const key = `v3|${from}|${to}`;
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
    const pastDates = workDates.filter((d) => d <= today);
    const scheduleDates = workDates.filter((d) => d >= today);

    const [results, schedules] = await Promise.all([
      pooled(pastDates, 4, async (d) => {
        try { return { d, list: await earningsFilersOn(d) }; }
        catch { return { d, list: [] as EdgarFiling[] }; }
      }),
      pooled(scheduleDates, 4, async (d) => {
        try { return { d, list: await nasdaqEarningsOn(d) }; }
        catch { return { d, list: [] as ExpectedReporter[] }; }
      }),
    ]);

    // Collapse to one event per company: the 8-K wins; a 10-Q/10-K is
    // re-dated to its announcement or dropped if that was before the range.
    type Ev = { f: EdgarFiling; date: string; form: DayTicker['form'] };
    const byCik = new Map<number, Ev>();
    const periodicOnly: EdgarFiling[] = [];
    for (const r of results) {
      if (!r) continue;
      for (const f of r.list) {
        if (!f.ticker) continue;
        if (f.form === '8-K') {
          const prev = byCik.get(f.cikNum);
          if (!prev || prev.form !== '8-K' || f.filed > prev.date) byCik.set(f.cikNum, { f, date: f.filed, form: '8-K' });
        } else {
          periodicOnly.push(f);
        }
      }
    }
    const redated = await pooled(periodicOnly, 5, async (f) => ({ f, a: await announcementDateFor(f.cikNum, f.filed) }));
    for (const x of redated) {
      if (!x) continue;
      const { f, a } = x;
      if (byCik.has(f.cikNum) && byCik.get(f.cikNum)!.form === '8-K') continue;   // already have the release
      if (a.via === '8-K') {
        if (a.date < from) continue;                                              // announced before the range
        byCik.set(f.cikNum, { f, date: a.date, form: '8-K' });
      } else {
        byCik.set(f.cikNum, { f, date: f.filed, form: f.form === '10-K' ? '10-K' : '10-Q' });
      }
    }

    const byDate = new Map<string, DayEntry>();
    for (const d of dates) {
      byDate.set(d, { date: d, weekend: isWeekend(d), future: d > today, count: 0, tickers: [], entries: [], expected: [], eightK: 0, periodic: 0 });
    }
    let total = 0;
    byCik.forEach((ev) => {
      const entry = byDate.get(ev.date);
      if (!entry) return;
      entry.entries.push({ ticker: ev.f.ticker!, company: ev.f.company, form: ev.form, filing_url: ev.f.filing_url });
    });
    // Schedule: whole list for future dates; for today only the ones that
    // have not filed yet (so the row empties as the day goes on).
    for (const s of schedules) {
      if (!s) continue;
      const entry = byDate.get(s.d);
      if (!entry) continue;
      const filed = new Set(entry.entries.map((e) => e.ticker));
      entry.expected = s.list
        .filter((r) => !filed.has(r.ticker))
        .sort((a, b) => (b.market_cap_musd ?? 0) - (a.market_cap_musd ?? 0));
    }
    byDate.forEach((entry) => {
      entry.entries.sort((a, b) => (a.form === '8-K' ? 0 : 1) - (b.form === '8-K' ? 0 : 1) || a.ticker.localeCompare(b.ticker));
      entry.tickers = entry.entries.map((e) => e.ticker);
      entry.eightK = entry.entries.filter((e) => e.form === '8-K').length;
      entry.periodic = entry.entries.length - entry.eightK;
      entry.count = entry.entries.length + entry.expected.length;
      total += entry.count;
    });

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
