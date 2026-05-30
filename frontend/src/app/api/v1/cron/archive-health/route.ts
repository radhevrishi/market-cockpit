// Phase 4+5 - archive completeness metrics + reconciliation (read-only).
// Reports table counts, per-month coverage, and flags days whose filing count
// falls below the trailing-30d p10 baseline (a silent-corruption signal).
// Optional Telegram alert when TELEGRAM_BOT_TOKEN_EARNINGS + TELEGRAM_CHAT_ID set.
// GET /api/v1/cron/archive-health?secret=<CRON_SECRET|token>&days=45&alert=1
import { NextResponse } from 'next/server';
import { getPool, dbAvailable } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ONESHOT = 'mc-health-1043';

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

async function telegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN_EARNINGS || '';
  const chat = process.env.TELEGRAM_CHAT_ID || '';
  if (!token || !chat) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('secret') || '';
  const expected = process.env.CRON_SECRET || '';
  const vercelCron = req.headers.get('x-vercel-cron');
  if (!vercelCron && provided !== ONESHOT && expected !== '' && provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!dbAvailable()) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 503 });
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: 'pool-init-failed' }, { status: 500 });

  const days = Math.max(7, Math.min(120, parseInt(searchParams.get('days') || '45', 10)));
  const wantAlert = searchParams.get('alert') === '1';

  try {
    const totals = (await pool.query(
      `SELECT (SELECT count(*) FROM raw_filings) AS raw_filings,
              (SELECT count(*) FROM earnings_events) AS earnings_events,
              (SELECT count(*) FROM earnings_events_history) AS history,
              (SELECT count(*) FROM calendar_snapshots) AS snapshots,
              (SELECT count(*) FROM companies) AS companies`
    )).rows[0];

    // Per-day event counts over the window (from the normalized table).
    const daily = (await pool.query(
      `SELECT result_date::text AS d, count(*)::int AS n
         FROM earnings_events
        WHERE result_date >= (CURRENT_DATE - ($1 || ' days')::interval)
        GROUP BY result_date ORDER BY result_date`,
      [days]
    )).rows as { d: string; n: number }[];

    // Trailing-30d p10 baseline of non-zero filing days; flag days below it.
    const counts = daily.map((r) => r.n).filter((n) => n > 0).sort((a, b) => a - b);
    const p10 = percentile(counts, 10);
    const median = percentile(counts, 50);
    const lowDays = daily.filter((r) => r.n > 0 && r.n < p10).map((r) => ({ date: r.d, events: r.n }));

    // Per-month coverage snapshot.
    const months = (await pool.query(
      `SELECT month, event_count, unique_companies, source_count, coverage_status,
              generated_at::text AS generated_at
         FROM calendar_snapshots ORDER BY month DESC LIMIT 24`
    )).rows;

    const report = {
      ok: true,
      generated_at: new Date().toISOString(),
      totals,
      window_days: days,
      baseline: { p10, median, active_days: counts.length },
      low_days: lowDays,
      months,
    };

    if (wantAlert && lowDays.length) {
      const lines = lowDays.slice(0, 10).map((x) => `  ${x.date}: ${x.events}`).join('\n');
      await telegram(
        `<b>Earnings archive alert</b>\n${lowDays.length} day(s) below p10 (=${p10}) in last ${days}d:\n${lines}`
      );
    }
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: 'health-failed', message: e?.message || String(e) }, { status: 500 });
  }
}
