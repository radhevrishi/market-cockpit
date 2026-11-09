// zzz1231 — the owner's broker tradebook.
//   GET                       → uploaded files
//   GET ?analytics=1[&force=1] → returns, holdings, P&L, dividends (lib/tradebook)
//   POST { file, trades, last } → stores the trades not stored yet (the same trade in two files is kept once)
//   DELETE ?confirm=1         → forgets every uploaded trade
import { NextRequest, NextResponse } from 'next/server';
import { clearTradebook, saveTrades, tradebookAnalytics, tradebookFiles } from '@/lib/tradebook/server';
import type { Trade } from '@/lib/tradebook/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  try {
    if (u.searchParams.get('analytics') === '1') return NextResponse.json(await tradebookAnalytics(u.searchParams.get('force') === '1'), { headers: NO_STORE });
    return NextResponse.json({ ok: true, files: await tradebookFiles() }, { headers: NO_STORE });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500, headers: NO_STORE });
  }
}

const str = (v: unknown, n = 80) => String(v ?? '').slice(0, n);
function cleanTrade(x: any): Trade | null {
  const qty = Number(x?.qty), price = Number(x?.price);
  const side = x?.side === 'buy' || x?.side === 'sell' ? x.side : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(x?.date || '')) ? String(x.date) : null;
  if (!side || !date || !(qty > 0) || !(price > 0) || !x?.key || !x?.isin || !x?.symbol) return null;
  return { key: str(x.key, 300), isin: str(x.isin, 20), symbol: str(x.symbol, 30), date, exchange: str(x.exchange, 8), segment: str(x.segment, 8), side, qty, price, orderId: str(x.orderId, 40), tradeId: str(x.tradeId, 40), time: x.time ? str(x.time, 30) : null };
}

export async function POST(req: NextRequest) {
  const body: any = await req.json().catch(() => null);
  const f = body?.file;
  if (!f?.hash || !Array.isArray(body?.trades)) return NextResponse.json({ ok: false, error: 'file and trades required' }, { status: 400 });
  const trades = (body.trades as any[]).slice(0, 5000).map(cleanTrade).filter((t): t is Trade => !!t);
  try {
    const r = await saveTrades({ hash: str(f.hash, 80), name: str(f.name, 200), from: f.from || null, to: f.to || null, rows: Number(f.rows) || trades.length }, trades, !!body.last);
    return NextResponse.json({ ok: true, ...r, received: trades.length }, { headers: NO_STORE });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500, headers: NO_STORE });
  }
}

export async function DELETE(req: NextRequest) {
  if (new URL(req.url).searchParams.get('confirm') !== '1') return NextResponse.json({ ok: false, error: 'add ?confirm=1' }, { status: 400 });
  await clearTradebook();
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
