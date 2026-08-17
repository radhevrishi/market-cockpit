// zzz397 — Book Watch: client → server book sync.
//
// The client (portfolio + watchlists pages via lib/book-sync-client) POSTs its
// current book here so it survives a closed tab and the book-watch cron can
// evaluate it. Single-tenant for now: same admin-chatId bypass the portfolio
// route uses (NEXT_PUBLIC_CHAT_ID). Non-admin writers must supply MC_BOT_SECRET.

import { NextRequest, NextResponse } from 'next/server';
import { writeBookState, type BookState, type BookTicker, type BookFlag } from '@/lib/book-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const ADMIN_CHAT_ID = process.env.NEXT_PUBLIC_CHAT_ID || '5057319640';

function authorized(chatId: string, secret: string | undefined): boolean {
  // Admin chat id (the single-tenant owner) may write without a secret — this
  // mirrors /api/portfolio's behavior. Everyone else must match MC_BOT_SECRET.
  if (chatId && chatId === ADMIN_CHAT_ID) return true;
  const expected = process.env.MC_BOT_SECRET || '';
  return !!expected && secret === expected;
}

function sanitizeTicker(raw: any): BookTicker | null {
  if (!raw || typeof raw !== 'object') return null;
  const ticker = String(raw.ticker || '').toUpperCase().trim();
  if (!ticker) return null;
  const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const out: BookTicker = { ticker };
  if (raw.company) out.company = String(raw.company).slice(0, 120);
  if (raw.held) out.held = true;
  if (raw.benched) out.benched = true;
  if (raw.watchlisted) out.watchlisted = true;
  if (raw.market === 'IN' || raw.market === 'US') out.market = raw.market;
  if (['BUY', 'WATCH', 'NEUTRAL', 'REJECTED'].includes(raw.decisionStatus)) out.decisionStatus = raw.decisionStatus;
  out.scoreAtDecision = num(raw.scoreAtDecision);
  out.gradeAtDecision = raw.gradeAtDecision ? String(raw.gradeAtDecision).slice(0, 8) : undefined;
  out.priceAtDecision = num(raw.priceAtDecision);
  if (raw.benchTier === 'BLOCKBUSTER' || raw.benchTier === 'STRONG') out.benchTier = raw.benchTier;
  out.entryPrice = num(raw.entryPrice);
  out.quantity = num(raw.quantity);
  if (raw.lastTier) out.lastTier = String(raw.lastTier).slice(0, 16);
  out.lastComposite = num(raw.lastComposite);
  return out;
}

function sanitizeFlag(raw: any): BookFlag | null {
  if (!raw || typeof raw !== 'object') return null;
  const ticker = String(raw.ticker || '').toUpperCase().trim();
  const kind = raw.kind;
  const message = String(raw.message || '').slice(0, 300);
  const validKinds = [
    'THESIS_DRIFT_REOPEN', 'THESIS_BREAK', 'STAGE4_BREAKDOWN', 'STRUCTURAL_RISK',
    'EARNINGS_TIER_DOWNGRADE', 'EARNINGS_PRINT', 'BENCH_DRIFT', 'HOLDING_DRAWDOWN',
  ];
  if (!ticker || !validKinds.includes(kind) || !message) return null;
  const sev = ['critical', 'warning', 'info'].includes(raw.severity) ? raw.severity : 'warning';
  return {
    kind,
    ticker,
    company: raw.company ? String(raw.company).slice(0, 120) : undefined,
    severity: sev,
    message,
    detail: raw.detail ? String(raw.detail).slice(0, 300) : undefined,
    source: 'client',
    armedAt: typeof raw.armedAt === 'string' ? raw.armedAt : new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const chatId = String(body?.chatId || ADMIN_CHAT_ID);
  if (!authorized(chatId, body?.secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tickers = Array.isArray(body?.tickers)
    ? body.tickers.map(sanitizeTicker).filter(Boolean) as BookTicker[]
    : [];
  const clientFlags = Array.isArray(body?.clientFlags)
    ? body.clientFlags.map(sanitizeFlag).filter(Boolean) as BookFlag[]
    : [];

  const state: BookState = {
    chatId,
    updatedAt: new Date().toISOString(),
    tickers,
    clientFlags,
  };

  await writeBookState(state);

  return NextResponse.json({
    ok: true,
    chatId,
    tickers: tickers.length,
    held: tickers.filter((t) => t.held).length,
    benched: tickers.filter((t) => t.benched).length,
    clientFlags: clientFlags.length,
  });
}
