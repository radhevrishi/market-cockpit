// ═══════════════════════════════════════════════════════════════════════════
// EO BLOCKBUSTER BACKTEST
//
// Walks the last 90 days of stored `graded:v8:<date>` payloads, pulls every
// BLOCKBUSTER + STRONG card's post-gap move (from `post-gap:v4:...` cache
// when available), and produces:
//
//   • hit rate at T+1, T+5, T+30 (% of cards positive)
//   • average / median return per tier
//   • score-band performance (0-70 / 70-80 / 80-90 / 90+)
//   • best/worst calls in window
//
// Cached 1h. Powers the BLOCKBUSTER backtest tab on /earnings-opportunities.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface GapEntry {
  ticker: string;
  close_move_pct?: number | null;
  live_move_pct?: number | null;
  open_gap_pct?: number | null;
  filing_date?: string;
}
interface CardRow {
  ticker: string;
  company?: string;
  tier: string;
  composite?: number;
  filing_date?: string;
  move_pct_1d?: number | null;
  move_pct_5d?: number | null;
  move_pct_30d?: number | null;
}

const ISO = (d: Date) => d.toISOString().slice(0, 10);
const CACHE_TTL_S = 3600;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.max(7, Math.min(180, parseInt(searchParams.get('days') || '90', 10)));
  const cacheKey = `eo-backtest:v1:${days}d`;

  if (isRedisAvailable() && searchParams.get('force') !== '1') {
    try {
      const cached = await kvGet<any>(cacheKey);
      if (cached) return NextResponse.json({ ...cached, _cache: 'hit' });
    } catch {}
  }

  const today = new Date();
  const fromDate = new Date(today); fromDate.setDate(today.getDate() - days);
  const dates: string[] = [];
  for (let d = new Date(fromDate); d <= today; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day === 0 || day === 6) continue; // skip weekends
    dates.push(ISO(d));
  }

  const cards: CardRow[] = [];
  if (isRedisAvailable()) {
    const settled = await Promise.allSettled(
      dates.map(async (date) => {
        const payload = await kvGet<any>(`graded:v8:${date}`);
        if (!payload?.by_tier) return [];
        const rows: CardRow[] = [];
        for (const [tier, list] of Object.entries(payload.by_tier as Record<string, any[]>)) {
          if (!Array.isArray(list)) continue;
          for (const c of list) {
            rows.push({
              ticker: c.ticker || c.symbol,
              company: c.company || c.company_name,
              tier,
              composite: c.composite || c.score,
              filing_date: c.filing_date || date,
            });
          }
        }
        return rows;
      })
    );
    for (const r of settled) if (r.status === 'fulfilled') cards.push(...r.value);
  }

  // Backfill post-gap moves from the cached post-gap:v4 entries.
  if (isRedisAvailable()) {
    const moveLookups = await Promise.allSettled(cards.map(async (c) => {
      if (!c.ticker || !c.filing_date) return;
      const key = `post-gap:v4:${c.ticker}:${c.filing_date}:pre:`;
      const gap = await kvGet<any>(key);
      if (!gap) return;
      c.move_pct_1d = gap.close_move_pct ?? gap.day1_close_pct ?? null;
      c.move_pct_5d = gap.day5_close_pct ?? null;
      c.move_pct_30d = gap.live_move_pct ?? null;
    }));
    // ignore failures
    void moveLookups;
  }

  // Aggregate
  const byTier: Record<string, { count: number; with_data: number; hit_1d: number; hit_5d: number; hit_30d: number; avg_1d: number[]; avg_5d: number[]; avg_30d: number[] }> = {};
  for (const c of cards) {
    if (!byTier[c.tier]) byTier[c.tier] = { count: 0, with_data: 0, hit_1d: 0, hit_5d: 0, hit_30d: 0, avg_1d: [], avg_5d: [], avg_30d: [] };
    const t = byTier[c.tier];
    t.count++;
    let hasData = false;
    if (typeof c.move_pct_1d === 'number') { t.avg_1d.push(c.move_pct_1d); if (c.move_pct_1d > 0) t.hit_1d++; hasData = true; }
    if (typeof c.move_pct_5d === 'number') { t.avg_5d.push(c.move_pct_5d); if (c.move_pct_5d > 0) t.hit_5d++; }
    if (typeof c.move_pct_30d === 'number') { t.avg_30d.push(c.move_pct_30d); if (c.move_pct_30d > 0) t.hit_30d++; }
    if (hasData) t.with_data++;
  }

  const median = (arr: number[]): number | null => {
    if (arr.length === 0) return null;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
  };
  const avg = (arr: number[]): number | null => arr.length === 0 ? null : arr.reduce((s, n) => s + n, 0) / arr.length;
  const tiers = Object.fromEntries(Object.entries(byTier).map(([tier, s]) => ([tier, {
    count: s.count,
    with_data: s.with_data,
    hit_rate_1d: s.with_data ? Math.round(s.hit_1d / Math.max(1, s.avg_1d.length) * 1000) / 10 : null,
    hit_rate_5d: s.avg_5d.length ? Math.round(s.hit_5d / s.avg_5d.length * 1000) / 10 : null,
    hit_rate_30d: s.avg_30d.length ? Math.round(s.hit_30d / s.avg_30d.length * 1000) / 10 : null,
    avg_1d_pct: avg(s.avg_1d),
    avg_5d_pct: avg(s.avg_5d),
    avg_30d_pct: avg(s.avg_30d),
    median_1d_pct: median(s.avg_1d),
    median_5d_pct: median(s.avg_5d),
    median_30d_pct: median(s.avg_30d),
  }])));

  // Score band performance (only for BLOCKBUSTER + STRONG tiers — those with score data).
  const bands: Array<{ band: string; lo: number; hi: number; count: number; hit_1d: number; avg_1d: number[]; avg_30d: number[] }> = [
    { band: '70–79', lo: 70, hi: 80, count: 0, hit_1d: 0, avg_1d: [], avg_30d: [] },
    { band: '80–89', lo: 80, hi: 90, count: 0, hit_1d: 0, avg_1d: [], avg_30d: [] },
    { band: '90+',   lo: 90, hi: 999, count: 0, hit_1d: 0, avg_1d: [], avg_30d: [] },
  ];
  for (const c of cards) {
    if (typeof c.composite !== 'number') continue;
    if (typeof c.move_pct_1d !== 'number') continue;
    const b = bands.find(x => c.composite! >= x.lo && c.composite! < x.hi);
    if (!b) continue;
    b.count++;
    b.avg_1d.push(c.move_pct_1d);
    if (c.move_pct_1d > 0) b.hit_1d++;
    if (typeof c.move_pct_30d === 'number') b.avg_30d.push(c.move_pct_30d);
  }
  const score_bands = bands.map(b => ({
    band: b.band,
    count: b.count,
    hit_rate_1d: b.avg_1d.length ? Math.round(b.hit_1d / b.avg_1d.length * 1000) / 10 : null,
    avg_1d_pct: avg(b.avg_1d),
    avg_30d_pct: avg(b.avg_30d),
  }));

  // Best / worst by 30d move within BLOCKBUSTER
  const blockbusters = cards.filter(c => c.tier === 'BLOCKBUSTER' && typeof c.move_pct_30d === 'number');
  blockbusters.sort((a, b) => (b.move_pct_30d as number) - (a.move_pct_30d as number));
  const best = blockbusters.slice(0, 10);
  const worst = blockbusters.slice(-10).reverse();

  const payload = {
    window_days: days,
    dates_scanned: dates.length,
    cards_total: cards.length,
    tiers,
    score_bands,
    best,
    worst,
    generated_at: new Date().toISOString(),
  };

  if (isRedisAvailable()) {
    try { await kvSet(cacheKey, payload, CACHE_TTL_S); } catch {}
  }
  return NextResponse.json(payload);
}
