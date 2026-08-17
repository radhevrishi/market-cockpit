// zzz397 — Book Watch: the evaluator cron.
//
// Reads the user's persisted book (holdings + conviction bench + watchlist +
// decision snapshots + any client-armed flags) and evaluates SERVER-authoritative
// conditions the app already has the data for, then pushes the NEW ones through
// the alert dispatcher. Runs even when no tab is open — that is the whole point.
//
// Server-authoritative evaluations (need no client, no self-fetch):
//   • EARNINGS_TIER_DOWNGRADE — a held/bench name's latest graded tier is worse
//     than the tier we last recorded for it (baseline stored back into the book).
//   • EARNINGS_PRINT — a held/bench name reported today (severity bumped when a
//     HELD name printed AVOID/MIXED).
//   • BENCH_DRIFT — a BLOCKBUSTER/STRONG bench name is fading hard post-print
//     (move_pct <= -12).
//   • HOLDING_DRAWDOWN — a held name is down materially vs entry/decision price
//     (optional live-quote enrichment; degrades silently if quotes unavailable).
// Plus it RELAYS client-armed flags (thesis drift/break, Stage-4, structural).
//
// Dedup is day-bucketed so a persistent condition alerts at most once/day.
// Fresh flags are appended to the in-app feed AND dispatched (Slack/SMTP/…
// no-op gracefully until env vars are set).
//
// Secret-gated via the shared verifyCronSecret helper (fail-closed).

import { NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/verifyAuth';
import { kvGet } from '@/lib/kv';
import { dispatchAlert } from '@/lib/alert-dispatcher';
import {
  readBookState,
  writeBookState,
  readDispatched,
  markDispatched,
  appendFeed,
  flagFingerprint,
  severityScore,
  BOOK_FLAG_LABEL,
  type BookFlag,
  type BookTicker,
} from '@/lib/book-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ADMIN_CHAT_ID = process.env.NEXT_PUBLIC_CHAT_ID || '5057319640';
const GRADED_KEY = (date: string) => `graded:v10:${date}`;
const GRADED_LOOKBACK_DAYS = 10;
const MAX_DISPATCH_PER_RUN = 40;

const TIER_RANK: Record<string, number> = { AVOID: 0, MIXED: 1, STRONG: 2, BLOCKBUSTER: 3 };

interface GradedInfo {
  ticker: string;
  company?: string;
  tier: string;
  composite?: number;
  move_pct?: number | null;
  d1_pct?: number | null;
  price?: number | null;
  dateKey: string;
  quarter?: string;
}

/** IST date string YYYY-MM-DD, offsetDays back from now (server tz agnostic). */
function istDateStr(offsetDays = 0): string {
  const now = Date.now();
  const istMs = now + 5.5 * 3600 * 1000 - offsetDays * 86400 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

/** Build ticker → most-recent graded info across the last N calendar days. */
async function buildGradedMap(): Promise<Record<string, GradedInfo>> {
  const map: Record<string, GradedInfo> = {};
  const dates: string[] = [];
  for (let i = 0; i < GRADED_LOOKBACK_DAYS; i++) dates.push(istDateStr(i));

  const payloads = await Promise.all(
    dates.map(async (d) => ({ d, payload: await kvGet<any>(GRADED_KEY(d)).catch(() => null) })),
  );

  // newest date first so the first write per ticker wins (most-recent print)
  for (const { d, payload } of payloads) {
    const byTier = payload?.by_tier;
    if (!byTier || typeof byTier !== 'object') continue;
    for (const tier of Object.keys(byTier)) {
      const rows = Array.isArray(byTier[tier]) ? byTier[tier] : [];
      for (const r of rows) {
        const ticker = String(r?.ticker || '').toUpperCase().trim();
        if (!ticker || map[ticker]) continue;
        map[ticker] = {
          ticker,
          company: r?.company,
          tier: String(r?.tier || tier),
          composite: typeof r?.composite_score === 'number' ? r.composite_score : undefined,
          move_pct: typeof r?.move_pct === 'number' ? r.move_pct : null,
          d1_pct: typeof r?.d1_pct === 'number' ? r.d1_pct : null,
          price: typeof r?.price === 'number' ? r.price : null,
          dateKey: d,
          quarter: r?.quarter,
        };
      }
    }
  }
  return map;
}

/** Optional live-quote enrichment for holding-drawdown. Degrades silently. */
async function fetchLivePrices(needUS: boolean): Promise<Record<string, number>> {
  const base = process.env.CRON_BASE_URL || 'https://market-cockpit-production.up.railway.app';
  const prices: Record<string, number> = {};
  const markets = needUS ? ['india', 'us'] : ['india'];
  await Promise.all(
    markets.map(async (mk) => {
      try {
        const ctl = new AbortController();
        const to = setTimeout(() => ctl.abort(), 12000);
        const res = await fetch(`${base}/api/market/quotes?market=${mk}&fields=ticker,price`, {
          signal: ctl.signal,
          cache: 'no-store',
        });
        clearTimeout(to);
        if (!res.ok) return;
        const j = await res.json();
        for (const s of j?.stocks || []) {
          const t = String(s?.ticker || '').toUpperCase().trim();
          const p = typeof s?.price === 'number' ? s.price : null;
          if (t && p && p > 0) prices[t] = p;
        }
      } catch {
        /* degrade silently — drawdown just won't fire this run */
      }
    }),
  );
  return prices;
}

function fmtPct(x: number): string {
  const s = x >= 0 ? '+' : '';
  return `${s}${x.toFixed(1)}%`;
}

function toAlertPayload(f: BookFlag) {
  return {
    rule: { id: `book-watch:${f.kind}`, name: `Book Watch — ${BOOK_FLAG_LABEL[f.kind]}` },
    article: {
      title: f.message,
      source: 'Book Watch',
      published_at: f.armedAt,
      ticker_symbols: [f.ticker],
      importance_score: severityScore(f.severity),
    },
    triggeredAt: new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  const auth = verifyCronSecret(req, { requireSecret: true });
  if (!auth.ok) {
    const status = auth.reason.includes('not configured') ? 503 : 401;
    return NextResponse.json({ error: auth.reason }, { status });
  }

  const { searchParams } = new URL(req.url);
  const chatId = searchParams.get('chatId') || ADMIN_CHAT_ID;
  const dryRun = searchParams.get('dry') === '1';

  const book = await readBookState(chatId);
  if (!book || !Array.isArray(book.tickers) || book.tickers.length === 0) {
    return NextResponse.json({ ok: true, note: 'no book synced yet — open portfolio/watchlists to sync', chatId, dispatched: 0 });
  }

  const watched = book.tickers.filter((t) => t.held || t.benched);
  const gradedMap = await buildGradedMap();
  const today = istDateStr(0);

  const armed: BookFlag[] = [];
  const nowIso = new Date().toISOString();

  // 1) Relay client-armed flags (thesis drift/break, Stage-4, structural risk)
  if (Array.isArray(book.clientFlags)) {
    for (const f of book.clientFlags) armed.push({ ...f, source: 'client' });
  }

  // 2) Server-authoritative earnings evaluations, and update the tier baseline
  const updatedTickers: BookTicker[] = book.tickers.map((t) => ({ ...t }));
  const byTickerIdx: Record<string, number> = {};
  updatedTickers.forEach((t, i) => { byTickerIdx[t.ticker] = i; });

  for (const t of watched) {
    const g = gradedMap[t.ticker];
    if (!g) continue;

    // EARNINGS_PRINT — reported today
    if (g.dateKey === today) {
      const weakHeld = t.held && (g.tier === 'AVOID' || g.tier === 'MIXED');
      armed.push({
        kind: 'EARNINGS_PRINT',
        ticker: t.ticker,
        company: t.company || g.company,
        severity: weakHeld ? 'warning' : 'info',
        message: `${t.ticker} reported today — graded ${g.tier}${g.composite != null ? ` (composite ${Math.round(g.composite)})` : ''}${t.held ? ' · you hold this' : t.benched ? ' · on your bench' : ''}`,
        detail: g.quarter,
        source: 'server',
        armedAt: nowIso,
      });
    }

    // EARNINGS_TIER_DOWNGRADE — worse than last recorded tier
    const prevRank = t.lastTier != null ? TIER_RANK[t.lastTier] : undefined;
    const curRank = TIER_RANK[g.tier];
    if (prevRank != null && curRank != null && curRank < prevRank) {
      const drop = prevRank - curRank;
      armed.push({
        kind: 'EARNINGS_TIER_DOWNGRADE',
        ticker: t.ticker,
        company: t.company || g.company,
        severity: g.tier === 'AVOID' || drop >= 2 ? 'critical' : 'warning',
        message: `${t.ticker} earnings tier downgraded ${t.lastTier} → ${g.tier}${t.held ? ' · you hold this' : ' · on your bench'}`,
        source: 'server',
        armedAt: nowIso,
      });
    }

    // BENCH_DRIFT — a strong bench name fading hard post-print
    if (t.benched && (t.benchTier === 'BLOCKBUSTER' || t.benchTier === 'STRONG') && typeof g.move_pct === 'number' && g.move_pct <= -12) {
      armed.push({
        kind: 'BENCH_DRIFT',
        ticker: t.ticker,
        company: t.company || g.company,
        severity: g.move_pct <= -20 ? 'critical' : 'warning',
        message: `${t.ticker} (${t.benchTier} bench) fading ${fmtPct(g.move_pct)} since its print — the market is questioning the beat`,
        source: 'server',
        armedAt: nowIso,
      });
    }

    // update tier baseline for next run's downgrade detection
    const idx = byTickerIdx[t.ticker];
    if (idx != null) {
      updatedTickers[idx].lastTier = g.tier;
      updatedTickers[idx].lastComposite = g.composite;
    }
  }

  // 3) Holding-drawdown via optional live-quote enrichment
  const heldWithRef = watched.filter((t) => t.held && (t.priceAtDecision || t.entryPrice));
  if (heldWithRef.length) {
    const needUS = heldWithRef.some((t) => t.market === 'US');
    const prices = await fetchLivePrices(needUS);
    for (const t of heldWithRef) {
      const live = prices[t.ticker];
      const ref = t.priceAtDecision || t.entryPrice;
      if (!live || !ref || ref <= 0) continue;
      const dd = (live - ref) / ref;
      if (dd <= -0.15) {
        const refLabel = t.priceAtDecision ? 'your decision price' : 'your entry';
        armed.push({
          kind: 'HOLDING_DRAWDOWN',
          ticker: t.ticker,
          company: t.company,
          severity: dd <= -0.25 ? 'critical' : 'warning',
          message: `${t.ticker} is ${fmtPct(dd * 100)} vs ${refLabel} (₹${Math.round(ref)} → ₹${Math.round(live)}) — recheck the thesis`,
          source: 'server',
          armedAt: nowIso,
        });
      }
    }
  }

  // 4) Dedup against the day-bucketed dispatch ledger
  const dispatched = await readDispatched(chatId);
  const fresh = armed.filter((f) => !dispatched[flagFingerprint(f)]);
  const capped = fresh.slice(0, MAX_DISPATCH_PER_RUN);

  // 5) Persist tier baselines + append to the in-app feed + dispatch
  const results: any[] = [];
  if (!dryRun) {
    await writeBookState({ ...book, tickers: updatedTickers, clientFlags: [] });
    if (capped.length) {
      await appendFeed(chatId, capped);
      for (const f of capped) {
        try {
          const r = await dispatchAlert(toAlertPayload(f));
          results.push({ ticker: f.ticker, kind: f.kind, slack: r.slack, email: r.email, webhook: r.webhook, telegram: r.telegram });
        } catch {
          results.push({ ticker: f.ticker, kind: f.kind, error: true });
        }
      }
      await markDispatched(chatId, capped.map(flagFingerprint));
    }
  }

  return NextResponse.json({
    ok: true,
    chatId,
    dry_run: dryRun,
    watched: watched.length,
    graded_universe: Object.keys(gradedMap).length,
    armed: armed.length,
    fresh: fresh.length,
    dispatched: dryRun ? 0 : capped.length,
    truncated: fresh.length > capped.length,
    flags: capped.map((f) => ({ kind: f.kind, ticker: f.ticker, severity: f.severity, message: f.message })),
    delivery: results,
  });
}

export async function POST(req: Request) {
  return GET(req);
}
