// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/thesis/recent-reporters?days=10&tickers=A,B,C          (zzz763)
//
// Answers ONE question from the exchange feed: which of these tickers filed
// results inside the window, and on what date. It does not read anything, it
// does not call a model, and it does not decide who needs a re-read — that
// decision needs the evidence ledgers, which the page already holds, and it
// is made there by the pure planner in lib/thesis/recent-reporters.ts.
//
// Sources, in order:
//   1. The worker's rolling `/api/results/latest` feed.
//   2. `/api/results/day/<date>` for each weekday in the window, because the
//      rolling feed is exactly that — rolling — and a filing from nine days
//      ago may already have left it (the zzz724 lesson).
// The merged feed is cached for 30 minutes so a second click is free.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { istToday } from '@/lib/market-hours';
import { reportedInWindow, windowStart, type FeedFiling } from '@/lib/thesis/recent-reporters';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const CF_WORKER_URL = process.env.CF_WORKER_URL || 'https://mc-scraper.radhev-232.workers.dev';
const FEED_TTL_S = 30 * 60;
const MAX_DAYS = 30;

async function fetchFeed(path: string, timeoutMs: number): Promise<FeedFiling[]> {
  try {
    const res = await fetch(`${CF_WORKER_URL}${path}`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!res.ok) return [];
    const j = await res.json();
    const arr = Array.isArray(j) ? j : (j?.items || j?.data || j?.results || []);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/** Every weekday from `from` to today inclusive, oldest first. */
function weekdaysSince(from: string, today: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${today}T00:00:00Z`);
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

interface FeedBundle { items: FeedFiling[]; latest: number; days_fetched: number; days_failed: string[]; fetched_at: string }

async function loadWindowFeed(from: string, today: string): Promise<{ bundle: FeedBundle; cached: boolean }> {
  const key = `thesis:recent-reporters:feed:v1:${from}:${today}`;
  try {
    const hit = await kvGet<FeedBundle>(key);
    if (hit && Array.isArray(hit.items)) return { bundle: hit, cached: true };
  } catch { /* a cold cache is not an error */ }
  const days = weekdaysSince(from, today);
  const [latest, ...perDay] = await Promise.all([
    fetchFeed('/api/results/latest', 20_000),
    ...days.map((d) => fetchFeed(`/api/results/day/${d}`, 12_000)),
  ]);
  const seen = new Set<string>();
  const items: FeedFiling[] = [];
  const push = (f: FeedFiling) => {
    const id = `${String(f?.symbol || '').toUpperCase()}|${String(f?.filing_date || '').slice(0, 10)}|${String(f?.attachment_url || f?.subject || '')}`;
    if (seen.has(id)) return;
    seen.add(id);
    items.push({ symbol: String(f?.symbol || ''), subject: String(f?.subject || ''), filing_date: String(f?.filing_date || ''), attachment_url: f?.attachment_url });
  };
  latest.forEach(push);
  const failed: string[] = [];
  perDay.forEach((arr, i) => { if (!arr.length) failed.push(days[i]); arr.forEach(push); });
  const bundle: FeedBundle = { items, latest: latest.length, days_fetched: days.length - failed.length, days_failed: failed, fetched_at: new Date().toISOString() };
  // An entirely empty feed is not cached: it is far more likely to be the
  // worker being down than ten weekdays with no results on the exchange.
  if (items.length) { try { await kvSet(key, bundle, FEED_TTL_S); } catch { /* best-effort */ } }
  return { bundle, cached: false };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(MAX_DAYS, Math.max(1, parseInt(searchParams.get('days') || '10', 10) || 10));
  const tickers = (searchParams.get('tickers') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!tickers.length) return NextResponse.json({ ok: false, error: 'tickers is required' }, { status: 400 });
  const today = istToday();
  const from = windowStart(days);
  const { bundle, cached } = await loadWindowFeed(from, today);
  const reported = reportedInWindow(bundle.items, tickers, from);
  const feedEmpty = !bundle.items.length;
  return NextResponse.json({
    ok: true, days, from, to: today, asked: tickers.length,
    reported,
    feed: { items: bundle.items.length, latest: bundle.latest, days_fetched: bundle.days_fetched, days_failed: bundle.days_failed, fetched_at: bundle.fetched_at, cached },
    // The feed being empty is a fact about the source, not about the book.
    // Said here so the page never renders "nobody reported" over an outage.
    note: feedEmpty ? 'The exchange feed answered nothing for the whole window — treat this as the source being unavailable, not as no company having reported.' : null,
  });
}
