// ════════════════════════════════════════════════════════════════════════════
// /api/v1/cron/user-alerts (zzz526) — server-side evaluation of the user's
// Alert Center rules, so alerts fire even with the portal closed. Triggered by
// the book-watch GitHub Actions workflow during market hours.
//
// For each synced rule it pulls fresh Yahoo daily bars for that ticker (tries
// TICKER.NS first, then the bare US symbol), computes ema21/sma50/sma200 and
// the day change SERVER-SIDE (so MA-touch rules use today's real averages, not
// a stale client sync), evaluates, applies a 20h KV cooldown per rule, pushes
// hits through the existing alert-dispatcher (Telegram/Slack via env vars) and
// stores them in KV for the Alert Center to display. decay_flag rules are
// client-only (their data lives in the browser) and are skipped here.
// ════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { dispatchAlert } from '@/lib/alert-dispatcher';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const YH_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const RULES_KEY = 'user-alerts:rules';
const HITS_KEY = 'user-alerts:recent';
const COOLDOWN_S = 20 * 3600;

interface Bars { closes: number[]; last: number; prev: number }

async function fetchBars(symbol: string): Promise<Bars | null> {
  try {
    const res = await fetch(`${YH_BASE}/${encodeURIComponent(symbol)}?range=1y&interval=1d`, {
      headers: { 'User-Agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const closes: number[] = (j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [])
      .filter((c: any) => typeof c === 'number' && Number.isFinite(c));
    if (closes.length < 30) return null;
    return { closes, last: closes[closes.length - 1], prev: closes[closes.length - 2] };
  } catch { return null; }
}

const sma = (c: number[], w: number): number | null => c.length >= w ? c.slice(-w).reduce((a, b) => a + b, 0) / w : null;
function ema(c: number[], w: number): number | null {
  if (c.length < w) return null;
  const k = 2 / (w + 1);
  let e = c.slice(0, w).reduce((a, b) => a + b, 0) / w;
  for (let i = w; i < c.length; i++) e = c[i] * k + e * (1 - k);
  return e;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let rules: any[] = [];
  try { rules = (await kvGet<any[]>(RULES_KEY)) || []; } catch { rules = []; }
  rules = rules.filter((r) => r?.ticker && r?.kind && r.kind !== 'decay_flag').slice(0, 50);
  if (rules.length === 0) return NextResponse.json({ ok: true, evaluated: 0, fired: 0, note: 'no server-evaluable rules synced' });

  // One Yahoo fetch per unique ticker (.NS first, bare fallback for US names)
  const tickers = Array.from(new Set(rules.map((r) => String(r.ticker).toUpperCase())));
  const bars = new Map<string, Bars>();
  await Promise.all(tickers.map(async (t) => {
    const b = (await fetchBars(`${t}.NS`)) || (await fetchBars(t));
    if (b) bars.set(t, b);
  }));

  const fired: Array<{ ruleId: string; ticker: string; message: string; ts: number }> = [];
  for (const r of rules) {
    const b = bars.get(String(r.ticker).toUpperCase());
    if (!b) continue;
    const chg = b.prev > 0 ? (b.last / b.prev - 1) * 100 : 0;
    let msg: string | null = null;
    if (r.kind === 'ma50_touch') {
      const m = sma(b.closes, 50);
      if (m && Math.abs(b.last - m) / m <= 0.015) msg = `${r.ticker} touching its 50DMA (${b.last.toFixed(1)} vs ${m.toFixed(1)})`;
    } else if (r.kind === 'ma200_touch') {
      const m = sma(b.closes, 200);
      if (m && Math.abs(b.last - m) / m <= 0.015) msg = `${r.ticker} touching its 200DMA (${b.last.toFixed(1)} vs ${m.toFixed(1)})`;
    } else if (r.kind === 'price_below') {
      if (typeof r.level === 'number' && b.last <= r.level) msg = `${r.ticker} below ${r.level} (now ${b.last.toFixed(1)})`;
    } else if (r.kind === 'price_above') {
      if (typeof r.level === 'number' && b.last >= r.level) msg = `${r.ticker} above ${r.level} (now ${b.last.toFixed(1)})`;
    } else if (r.kind === 'drop_day') {
      const lvl = typeof r.level === 'number' ? r.level : 5;
      if (chg <= -lvl) msg = `${r.ticker} down ${chg.toFixed(1)}% today (limit ${lvl}%)`;
    }
    if (!msg) continue;
    // 20h cooldown per rule via KV NX-style key
    const cdKey = `user-alerts:cd:${r.id}`;
    try {
      const cd = await kvGet<number>(cdKey);
      if (cd) continue;
      await kvSet(cdKey, Date.now(), COOLDOWN_S);
    } catch { /* no KV — fire anyway, better loud than silent */ }
    fired.push({ ruleId: r.id, ticker: r.ticker, message: msg, ts: Date.now() });
    // Reuse the news alert dispatcher shape (Telegram/Slack via env vars).
    try {
      await dispatchAlert({
        rule: { id: `user-alert:${r.id}`, name: '🔔 Cockpit Alert' },
        article: { title: msg, ticker_symbols: [r.ticker], source: 'Alert Center' },
        triggeredAt: new Date().toISOString(),
      } as any);
    } catch { /* channel not configured — hits still recorded below */ }
  }

  if (fired.length) {
    try {
      const prev = (await kvGet<any[]>(HITS_KEY)) || [];
      await kvSet(HITS_KEY, [...fired, ...prev].slice(0, 30));
    } catch { /* display-only */ }
  }
  return NextResponse.json({ ok: true, evaluated: rules.length, tickersResolved: bars.size, fired: fired.length, hits: fired });
}
