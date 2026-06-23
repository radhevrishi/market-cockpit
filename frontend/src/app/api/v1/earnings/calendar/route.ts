import { NextResponse } from 'next/server';
import { kvGet, isRedisAvailable } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/earnings/calendar — read endpoint (patch 0135)
//
// PURE READ — Vercel does NO scraping.  Data is populated by an external
// worker (worker/ directory, deploy to Hetzner / Railway / Render / fly.io)
// that pushes canonical payloads via /api/v1/earnings/calendar/ingest.
//
// Architecture (10-yr durable stack):
//   Tier 1: Persistent worker w/ Playwright + cookie jar (external host)
//   Tier 2: Multi-source aggregator (NSE + BSE + Trendlyne + Tickertape)
//   Tier 3: Reconciliation + dedup
//   Tier 4: AI = analyst layer (scoring, classification) — NOT transport
//
// Chrome-MCP path is one-time seed / emergency fallback only.
// ═══════════════════════════════════════════════════════════════════════════

interface CalendarItem {
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

interface FullPayload {
  scraped_at: string;
  from: string;
  to: string;
  total: number;
  by_date: Record<string, CalendarItem[]>;
  items: CalendarItem[];
}

function emptyPayload(): FullPayload {
  return { scraped_at: '', from: '', to: '', total: 0, by_date: {}, items: [] };
}

export async function GET(req: Request) {
  if (!isRedisAvailable()) {
    return NextResponse.json({
      error: 'KV not configured.',
      ...emptyPayload(),
    }, { status: 503 });
  }

  const url = new URL(req.url);
  const date  = url.searchParams.get('date');
  const month = url.searchParams.get('month');
  const from  = url.searchParams.get('from');
  const to    = url.searchParams.get('to');

  // PATCH zzz64 — input validation. Reject malformed date/month/from/to with
  // a 400 before we attempt KV lookups, so callers get a clean error instead
  // of silent zero-results. All four params share the same YYYY-MM-DD format
  // (except `month` which is YYYY-MM). Month component must be 01-12.
  const DATE_RE  = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (date && !DATE_RE.test(date)) {
    return NextResponse.json({ error: 'Bad request', code: 'invalid_param', param: 'date' }, { status: 400 });
  }
  if (month && !MONTH_RE.test(month)) {
    return NextResponse.json({ error: 'Bad request', code: 'invalid_param', param: 'month' }, { status: 400 });
  }
  if (from && !DATE_RE.test(from)) {
    return NextResponse.json({ error: 'Bad request', code: 'invalid_param', param: 'from' }, { status: 400 });
  }
  if (to && !DATE_RE.test(to)) {
    return NextResponse.json({ error: 'Bad request', code: 'invalid_param', param: 'to' }, { status: 400 });
  }
  if (from && to && from > to) {
    return NextResponse.json({ error: 'Bad request', code: 'invalid_param', param: 'from_after_to' }, { status: 400 });
  }

  // PATCH zzz64 — extracted fallback builder. Both the original from/to
  // branch and the new date/month fall-through paths use this identical
  // cron+worker fallback chain when KV misses. Returns the full fallback
  // payload (cron auto keys + mc-scraper Worker filings), optionally
  // range-filtered. `rangeFrom`/`rangeTo` are inclusive YYYY-MM-DD bounds.
  async function buildCronWorkerFallback(rangeFrom?: string, rangeTo?: string) {
    const today = new Date();
    const horizonStart = new Date(today); horizonStart.setUTCDate(today.getUTCDate() - 60);
    const horizonEnd   = new Date(today); horizonEnd.setUTCDate(today.getUTCDate() + 60);
    const datesToCheck: string[] = [];
    for (let d = new Date(horizonStart); d <= horizonEnd; d.setUTCDate(d.getUTCDate() + 1)) {
      datesToCheck.push(d.toISOString().slice(0, 10));
    }
    const cronByDate: Record<string, CalendarItem[]> = {};
    let cronTotal = 0;
    await Promise.all(datesToCheck.map(async (d) => {
      try {
        const tickers = await kvGet<string[]>(`earnings-cal:auto:${d}`);
        if (!tickers || !tickers.length) return;
        cronByDate[d] = tickers.map((t) => ({
          symbol: t,
          company: t,
          filing_date: d,
          filing_dt_iso: null,
          quarter: '',
          period_ended: '',
          audited: false,
          consolidated: false,
          period_type: 'Quarterly',
          attachment: `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(t)}`,
          source_url: `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(t)}`,
          exchange: 'NSE',
        } as any));
        cronTotal += tickers.length;
      } catch {}
    }));
    if (cronTotal === 0) {
      try {
        const WORKER_URL = process.env.CF_WORKER_URL || 'https://mc-scraper.radhev-232.workers.dev';
        const r = await fetch(`${WORKER_URL}/api/results/latest`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const wd: any = await r.json();
          const filings: any[] = Array.isArray(wd?.results) ? wd.results : [];
          // PATCH zzz72 — Clarifications are NSE-mandated explanations of prior
          // filings, NOT new earnings. Must filter BEFORE the FR_RE match because
          // subjects like "Clarification - Financial Results" pass /financial\s*result/i.
          const CLARIFICATION_RE = /clarification|reply\s+to/i;
          const FR_RE = /financial\s*result/i;
          const monthMap: Record<string, string> = {
            JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
            JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
          };
          const parseFilingDate = (s: string): string | null => {
            const m = String(s || '').match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
            if (!m) return null;
            const mm = monthMap[m[2].toUpperCase()];
            if (!mm) return null;
            return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
          };
          for (const f of filings) {
            const subj = String(f?.subject || '');
            if (CLARIFICATION_RE.test(subj)) continue;  // zzz72 — skip clarifications, not new earnings
            if (!FR_RE.test(subj)) continue;
            const isoDate = parseFilingDate(f?.filing_date);
            if (!isoDate) continue;
            const sym = String(f?.symbol || '').toUpperCase();
            if (!sym) continue;
            if (!cronByDate[isoDate]) cronByDate[isoDate] = [];
            cronByDate[isoDate].push({
              symbol: sym,
              company: String(f?.company || sym),
              filing_date: isoDate,
              filing_dt_iso: null,
              quarter: '',
              period_ended: '',
              audited: false,
              consolidated: false,
              period_type: subj.includes('Clarification') ? 'Clarification' : 'Quarterly',
              attachment: String(f?.attachment_url || `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(sym)}`),
              source_url: String(f?.attachment_url || `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(sym)}`),
              exchange: 'NSE',
            } as any);
            cronTotal++;
          }
        }
      } catch {}
    }
    const summary = (await kvGet<{ last_run?: string }>('earnings-cal:auto:_summary')) || {};
    const fallbackPayload: any = {
      ...emptyPayload(),
      scraped_at: summary.last_run || new Date().toISOString(),
      from: horizonStart.toISOString().slice(0, 10),
      to: horizonEnd.toISOString().slice(0, 10),
      total: cronTotal,
      by_date: cronByDate,
      source: 'cron+worker-fallback',
      note: 'using cron + mc-scraper Worker results',
    };
    if (rangeFrom || rangeTo) {
      const fromD = rangeFrom || '0000-00-00';
      const toD   = rangeTo   || '9999-99-99';
      const filtered: Record<string, CalendarItem[]> = {};
      let count = 0;
      for (const [d, arr] of Object.entries(cronByDate)) {
        if (d >= fromD && d <= toD) {
          filtered[d] = arr;
          count += arr.length;
        }
      }
      fallbackPayload.from = fromD;
      fallbackPayload.to = toD;
      fallbackPayload.total = count;
      fallbackPayload.by_date = filtered;
    }
    return fallbackPayload;
  }

  try {
    // Fast path: single-date lookup
    if (date) {
      const day: any = await kvGet(`earnings:calendar:nse:v1:date:${date}`);
      if (day) {
        const parsed = typeof day === 'string' ? JSON.parse(day) : day;
        const items = parsed.items || [];
        if (items.length > 0) {
          return NextResponse.json({
            date: parsed.date || date,
            items,
            total: parsed.total ?? items.length,
            scraped_at: parsed.scraped_at || null,
            source: 'NSE',
          });
        }
      }
      // PATCH zzz64 — KV miss/empty: fall through to cron+worker fallback,
      // filtered to this single date. Previously this returned an immediate
      // 0-total which made the graded route show 0 cards even when the
      // worker had real filings for the day.
      const fb = await buildCronWorkerFallback(date, date);
      const dayItems = (fb.by_date && fb.by_date[date]) ? fb.by_date[date] : [];
      return NextResponse.json({
        date,
        items: dayItems,
        total: dayItems.length,
        scraped_at: fb.scraped_at || null,
        source: dayItems.length > 0 ? 'cron+worker-fallback' : 'NSE',
        ...(dayItems.length === 0 ? { empty_reason: 'no_filings_or_scrape_pending' } : {}),
      });
    }

    // PATCH zzz58 part 3/3 — Month-aggregate query (`?month=YYYY-MM`).
    // Before this patch, a `?month=` request would fall through to the
    // legacy full-payload KV (`earnings:calendar:nse:v1`), which is
    // written ONLY by the silent Claude-in-Chrome scraper — so the
    // route returned `total: 0` even when per-date keys
    // (`earnings:calendar:nse:v1:date:YYYY-MM-DD`) were healthy and
    // populated. Fix: when `month` is given, iterate every day in the
    // month, fetch the per-date keys in parallel, and aggregate.
    if (month) {
      const [yStr, mStr] = month.split('-');
      const year = Number(yStr);
      const monthIdx = Number(mStr) - 1; // JS Date months are 0-indexed
      // Days in this month (handles Feb 28/29, 30-day months, etc.)
      const daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
      const dates: string[] = [];
      for (let day = 1; day <= daysInMonth; day++) {
        dates.push(`${month}-${String(day).padStart(2, '0')}`);
      }
      const byDate: Record<string, CalendarItem[]> = {};
      let total = 0;
      let latestScrapedAt: string | null = null;
      await Promise.all(dates.map(async (d) => {
        try {
          const raw: any = await kvGet(`earnings:calendar:nse:v1:date:${d}`);
          if (!raw) return;
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          const items: CalendarItem[] = Array.isArray(parsed?.items) ? parsed.items : [];
          if (items.length === 0) return;
          byDate[d] = items;
          total += items.length;
          if (parsed?.scraped_at && (!latestScrapedAt || parsed.scraped_at > latestScrapedAt)) {
            latestScrapedAt = parsed.scraped_at;
          }
        } catch {}
      }));
      // PATCH zzz64 — when per-date KV came back empty for the whole month,
      // fall through to the cron+worker fallback (scoped to this month)
      // so callers don't get a silent 0-total on healthy months.
      if (total === 0) {
        const monthFrom = `${month}-01`;
        const monthTo = `${month}-${String(daysInMonth).padStart(2, '0')}`;
        const fb = await buildCronWorkerFallback(monthFrom, monthTo);
        return NextResponse.json({
          scraped_at: fb.scraped_at || '',
          from: monthFrom,
          to: monthTo,
          month,
          total: fb.total,
          by_date: fb.by_date,
          source: fb.total > 0 ? 'cron+worker-fallback' : 'NSE',
        });
      }
      return NextResponse.json({
        scraped_at: latestScrapedAt || '',
        from: `${month}-01`,
        to: `${month}-${String(daysInMonth).padStart(2, '0')}`,
        month,
        total,
        by_date: byDate,
        source: 'NSE',
      });
    }

    // Full payload
    const full: any = await kvGet('earnings:calendar:nse:v1');
    // PATCH 1101zzz18 — earnings calendar self-heal. The legacy
    // `earnings:calendar:nse:v1` key is written ONLY by an external
    // Claude-in-Chrome scraper that has gone silent (last write
    // 2026-05-28, 24 days stale on the user's June 21 visit). The
    // GitHub Actions cron `refresh-earnings-calendar` writes a DIFFERENT
    // KV namespace — `earnings-cal:auto:YYYY-MM-DD` — with the same
    // ticker symbols. When the legacy payload is missing OR older than
    // 7 days, fall back to synthesising a minimal calendar from the
    // auto-* keys so the EO page is never stale by more than a day.
    const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
    const parsedFull: FullPayload | null = full
      ? (typeof full === 'string' ? JSON.parse(full) : full)
      : null;
    const legacyScrapedMs = parsedFull?.scraped_at ? Date.parse(parsedFull.scraped_at) : 0;
    const legacyIsFresh = parsedFull && (Date.now() - legacyScrapedMs < SEVEN_DAYS_MS);

    if (!legacyIsFresh) {
      // Build fallback from the cron-written namespace.
      const today = new Date();
      const horizonStart = new Date(today); horizonStart.setUTCDate(today.getUTCDate() - 60);
      const horizonEnd   = new Date(today); horizonEnd.setUTCDate(today.getUTCDate() + 60);
      const datesToCheck: string[] = [];
      for (let d = new Date(horizonStart); d <= horizonEnd; d.setUTCDate(d.getUTCDate() + 1)) {
        datesToCheck.push(d.toISOString().slice(0, 10));
      }
      const cronByDate: Record<string, CalendarItem[]> = {};
      let cronTotal = 0;
      await Promise.all(datesToCheck.map(async (date) => {
        try {
          const tickers = await kvGet<string[]>(`earnings-cal:auto:${date}`);
          if (!tickers || !tickers.length) return;
          // Synthesize CalendarItem stubs (only ticker available — no PE / mcap / financials).
          // The UI tolerates the sparse shape; sub-fields just render as "—".
          cronByDate[date] = tickers.map((t) => ({
            symbol: t,
            company: t,
            filing_date: date,
            filing_dt_iso: null,
            quarter: '',
            period_ended: '',
            audited: false,
            consolidated: false,
            period_type: 'Quarterly',
            attachment: `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(t)}`,
            source_url: `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(t)}`,
            exchange: 'NSE',
          } as any));
          cronTotal += tickers.length;
        } catch {}
      }));
      // PATCH 1101zzz23 — third fallback layer. When the cron has written
      // little or nothing (NSE blocks Railway's egress so the cron's
      // /api/equity-stockIndices fetch fails and universe_size=0), fetch
      // from the mc-scraper Cloudflare Worker's /api/results/latest
      // endpoint. The Worker has ~3000 corporate filings updated every
      // 5 min; we filter to "Financial Results" subjects (~50/week) and
      // group by date. This matches Screener.in's calendar density.
      if (cronTotal === 0) {
        try {
          const WORKER_URL = process.env.CF_WORKER_URL || 'https://mc-scraper.radhev-232.workers.dev';
          const r = await fetch(`${WORKER_URL}/api/results/latest`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(8000),
          });
          if (r.ok) {
            const wd: any = await r.json();
            const filings: any[] = Array.isArray(wd?.results) ? wd.results : [];
            // PATCH zzz72 — Clarifications/Replies are NOT new earnings filings.
            // "Clarification - Financial Results" passes FR_RE; must filter first.
            const CLARIFICATION_RE = /clarification|reply\s+to/i;
            const FR_RE = /financial\s*result/i;
            // 'DD-MMM-YYYY HH:MM:SS' -> 'YYYY-MM-DD'
            const monthMap: Record<string, string> = {
              JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
              JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
            };
            const parseFilingDate = (s: string): string | null => {
              const m = String(s || '').match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
              if (!m) return null;
              const mm = monthMap[m[2].toUpperCase()];
              if (!mm) return null;
              return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
            };
            for (const f of filings) {
              const subj = String(f?.subject || '');
              if (CLARIFICATION_RE.test(subj)) continue;  // zzz72 — skip clarifications, not new earnings
              if (!FR_RE.test(subj)) continue;
              const isoDate = parseFilingDate(f?.filing_date);
              if (!isoDate) continue;
              const sym = String(f?.symbol || '').toUpperCase();
              if (!sym) continue;
              if (!cronByDate[isoDate]) cronByDate[isoDate] = [];
              cronByDate[isoDate].push({
                symbol: sym,
                company: String(f?.company || sym),
                filing_date: isoDate,
                filing_dt_iso: null,
                quarter: '',
                period_ended: '',
                audited: false,
                consolidated: false,
                period_type: subj.includes('Clarification') ? 'Clarification' : 'Quarterly',
                attachment: String(f?.attachment_url || `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(sym)}`),
                source_url: String(f?.attachment_url || `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(sym)}`),
                exchange: 'NSE',
              } as any);
              cronTotal++;
            }
          }
        } catch {
          // Worker fetch failed — keep cron data as-is (likely still empty).
        }
      }
      const summary = (await kvGet<{ last_run?: string }>('earnings-cal:auto:_summary')) || {};
      const fallbackPayload: any = {
        ...emptyPayload(),
        scraped_at: summary.last_run || new Date().toISOString(),
        from: horizonStart.toISOString().slice(0, 10),
        to: horizonEnd.toISOString().slice(0, 10),
        total: cronTotal,
        by_date: cronByDate,
        source: 'cron+worker-fallback',
        note: parsedFull
          ? 'legacy scraper stale (>7d); merging cron data + mc-scraper Worker results'
          : 'legacy scraper has not written; using cron + mc-scraper Worker results',
      };
      // Range filter on fallback
      if (from || to) {
        const fromD = from || '0000-00-00';
        const toD   = to   || '9999-99-99';
        const filtered: Record<string, CalendarItem[]> = {};
        let count = 0;
        for (const [d, arr] of Object.entries(cronByDate)) {
          if (d >= fromD && d <= toD) {
            filtered[d] = arr;
            count += arr.length;
          }
        }
        fallbackPayload.from = fromD;
        fallbackPayload.to = toD;
        fallbackPayload.total = count;
        fallbackPayload.by_date = filtered;
      }
      return NextResponse.json(fallbackPayload);
    }
    const parsed = parsedFull as FullPayload;

    // Range filter
    // PATCH zzz58 part 3/3 — When `from`/`to` is given and the legacy
    // full payload's by_date map is missing the requested range (often
    // the case for future-dated queries, since the legacy scraper only
    // captures filings it has already seen), fall back to per-date KV
    // keys. This restores parity with the month-aggregate path.
    if (from || to) {
      const fromD = from || '0000-00-00';
      const toD   = to   || '9999-99-99';
      const byDateFiltered: Record<string, CalendarItem[]> = {};
      let count = 0;
      for (const [d, arr] of Object.entries(parsed.by_date || {})) {
        if (d >= fromD && d <= toD) {
          byDateFiltered[d] = arr;
          count += arr.length;
        }
      }
      // Second pass: enumerate every day in [from, to] and fill gaps
      // from per-date keys when the legacy payload was empty for them.
      // Only do this when the range is reasonable (<= 90 days) to avoid
      // unbounded KV fan-out on a malicious query.
      try {
        const fromTs = Date.parse(`${fromD}T00:00:00Z`);
        const toTs   = Date.parse(`${toD}T00:00:00Z`);
        if (Number.isFinite(fromTs) && Number.isFinite(toTs) && toTs >= fromTs) {
          const spanDays = Math.round((toTs - fromTs) / 86400000) + 1;
          if (spanDays > 0 && spanDays <= 92) {
            const missingDates: string[] = [];
            for (let i = 0; i < spanDays; i++) {
              const d = new Date(fromTs + i * 86400000).toISOString().slice(0, 10);
              if (!byDateFiltered[d]) missingDates.push(d);
            }
            await Promise.all(missingDates.map(async (d) => {
              try {
                const raw: any = await kvGet(`earnings:calendar:nse:v1:date:${d}`);
                if (!raw) return;
                const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
                const items: CalendarItem[] = Array.isArray(p?.items) ? p.items : [];
                if (!items.length) return;
                byDateFiltered[d] = items;
                count += items.length;
              } catch {}
            }));
          }
        }
      } catch {}
      return NextResponse.json({
        ...parsed,
        from: fromD,
        to: toD,
        total: count,
        by_date: byDateFiltered,
        items: undefined,  // omit huge flat list when range-filtered
      });
    }

    return NextResponse.json(parsed);
  } catch (e: any) {
    // PATCH zzz64 — don't leak exception class/message in the error field.
    console.error('[earnings/calendar] internal error:', e?.message || e);
    return NextResponse.json({
      error: 'Internal error',
      code: 'internal_error',
      ...emptyPayload(),
    }, { status: 500 });
  }
}
