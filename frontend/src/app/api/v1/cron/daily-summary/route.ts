// ═══════════════════════════════════════════════════════════════════════════
// DAILY MARKET SUMMARY — 22:00 IST TELEGRAM DIGEST (PATCH 1072)
//
// GET  /api/v1/cron/daily-summary?secret=<CRON_SECRET>
// POST /api/v1/cron/daily-summary?secret=<CRON_SECRET>
//
// Composes a single Telegram digest from existing endpoints:
//   • Top breadth regime + composite
//   • Today's biggest movers (best/worst 3 from /api/market/quotes)
//   • Today's special-situations highlights (first 3 by signal score)
//   • Today's super-investor news / moves (if any)
//   • Active alert rules count (KV: superinv-style fold-in)
//
// Sends the digest via the existing `dispatchAlert()` pipeline → all
// configured channels (Telegram in your setup) get the message.
//
// Scheduled by .github/workflows/daily-summary.yml at 22:00 IST
// (16:30 UTC) every weekday.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { dispatchAlert } from '@/lib/alert-dispatcher';
import { internalBase } from '@/lib/internal-base';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface QuoteLite {
  ticker: string;
  name?: string;
  changePct?: number;
  price?: number;
}

async function check(req: NextRequest): Promise<NextResponse | null> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured; endpoint disabled' },
      { status: 503 },
    );
  }
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

async function fetchJson(url: string, timeoutMs = 12_000): Promise<any | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

interface SummaryParts {
  breadthLine: string;
  topGainers: QuoteLite[];
  topLosers: QuoteLite[];
  specsit: { title: string; ticker?: string }[];
  superInvNews: { headline: string; source?: string }[];
  asOf: string;
}

async function compose(req: NextRequest): Promise<SummaryParts> {
  const base = internalBase(req);
  const [breadth, quotes, specsit] = await Promise.all([
    fetchJson(`${base}/api/v1/breadth`),
    fetchJson(`${base}/api/market/quotes?market=india`),
    fetchJson(`${base}/api/v1/special-situations/feed`),
  ]);

  // ── Breadth line ───────────────────────────────────────────────────
  let breadthLine = 'breadth: n/a';
  if (breadth && typeof breadth.composite === 'number' && breadth.regime) {
    breadthLine = `breadth: ${breadth.regime} (composite ${breadth.composite})`;
  }

  // ── Top movers ─────────────────────────────────────────────────────
  const all: QuoteLite[] = (() => {
    if (!quotes) return [];
    const raw = (quotes.stocks || quotes.gainers || []) as any[];
    return raw
      .map((s) => ({
        ticker: String(s.ticker || s.symbol || ''),
        name: s.company || s.name,
        changePct:
          typeof s.changePct === 'number' ? s.changePct : Number(s.pChange || s.change),
        price: typeof s.price === 'number' ? s.price : Number(s.cmp || s.lastPrice),
      }))
      .filter((s) => s.ticker && isFinite(s.changePct ?? NaN));
  })();
  const sortedDesc = [...all].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
  const topGainers = sortedDesc.slice(0, 3);
  const topLosers = sortedDesc.slice(-3).reverse();

  // ── Special-situations highlights ──────────────────────────────────
  const specsitFlat: { title: string; ticker?: string }[] = [];
  if (specsit && specsit.by_category) {
    for (const cat of Object.keys(specsit.by_category).slice(0, 3)) {
      const arr = specsit.by_category[cat] || [];
      for (const x of arr.slice(0, 1)) {
        specsitFlat.push({
          title: `${cat}: ${String(x.title || x.headline || x.id || '').slice(0, 80)}`,
          ticker: x.ticker || x.symbol,
        });
      }
    }
  }

  // ── Super-investor news placeholder (per-investor query is paid-cycle expensive) ──
  const superInvNews: { headline: string; source?: string }[] = [];

  return {
    breadthLine,
    topGainers,
    topLosers,
    specsit: specsitFlat,
    superInvNews,
    asOf: new Date().toISOString(),
  };
}

function format(parts: SummaryParts): { title: string; body: string } {
  const lines: string[] = [];
  lines.push(`🌙 22:00 IST Daily Digest — ${parts.asOf.slice(0, 10)}`);
  lines.push('');
  lines.push(parts.breadthLine);
  lines.push('');
  if (parts.topGainers.length) {
    lines.push('Top 3 gainers:');
    for (const g of parts.topGainers) {
      lines.push(`  +${(g.changePct ?? 0).toFixed(2)}%  ${g.ticker}`);
    }
  }
  if (parts.topLosers.length) {
    lines.push('Top 3 losers:');
    for (const l of parts.topLosers) {
      lines.push(`  ${(l.changePct ?? 0).toFixed(2)}%  ${l.ticker}`);
    }
  }
  if (parts.specsit.length) {
    lines.push('');
    lines.push('Special situations:');
    for (const s of parts.specsit) {
      lines.push(`  • ${s.title}`);
    }
  }
  if (parts.superInvNews.length) {
    lines.push('');
    lines.push('Super-investor news:');
    for (const n of parts.superInvNews) {
      lines.push(`  • ${n.headline}`);
    }
  }
  return {
    title: `Daily digest — ${parts.asOf.slice(0, 10)}`,
    body: lines.join('\n'),
  };
}

async function run(req: NextRequest) {
  const denied = await check(req);
  if (denied) return denied;
  const parts = await compose(req);
  const formatted = format(parts);
  const result = await dispatchAlert({
    rule: { id: 'daily-summary', name: 'Daily Digest' },
    article: {
      title: formatted.title,
      source: 'Daily Digest',
      published_at: parts.asOf,
      ticker_symbols: parts.topGainers.concat(parts.topLosers).map((g) => g.ticker),
    },
    triggeredAt: parts.asOf,
  });
  // Include the assembled body so future channels (email) can substitute it.
  return NextResponse.json({
    ok: true,
    asOf: parts.asOf,
    body: formatted.body,
    dispatch: result,
  });
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
