// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/us-book — THE US PORTFOLIO BOOK.                           (zzz790)
//
// Personal data: protected by the site login (lib/site-auth
// PROTECTED_API_PREFIXES → '/api/v1/us-book'). KV key `us-book:v1:<owner>`,
// separate from every India book key.
//
// GET                         → { book }            the full document
// GET ?view=universe          → { universe }        tickers / listing / origin
//                                                   ONLY — what the catalyst
//                                                   engine reads (no price,
//                                                   no quantity, no cost)
// POST { action: 'preview', text }                  parse only, nothing saved
// POST { action: 'import', text, mode }             replace | merge
// POST { action: 'upsert', holding }                manual add / edit
// POST { action: 'remove', ticker, exchange? }
// POST { action: 'cash', currency, amount|null }
// POST { action: 'bench_add', ticker, exchange?, note? }
// POST { action: 'bench_remove', ticker }
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { readUsBook, writeUsBook, US_BOOK_OWNER } from '@/lib/us-book-store';
import { parseUsBookImport } from '@/lib/us-book/import';
import {
  applyImport, upsertHolding, removeHolding, setCash, addBench, removeBench, sanitizeHolding, sanitizeBenchEntry, thesisUniverse,
} from '@/lib/us-book/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const MAX_TEXT = 400_000;

export async function GET(req: NextRequest) {
  const view = new URL(req.url).searchParams.get('view');
  const { book, error, exists } = await readUsBook(US_BOOK_OWNER);
  if (view === 'universe') {
    const universe = thesisUniverse(book);
    return NextResponse.json({
      ok: !error, error, exists, updatedAt: book.updatedAt, universe,
      counts: {
        total: universe.length,
        us: universe.filter((u) => u.listing === 'US').length,
        non_us: universe.filter((u) => u.listing === 'NON_US').length,
        book: universe.filter((u) => u.origin !== 'bench').length,
        bench: universe.filter((u) => u.origin === 'bench').length,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json({ ok: !error, error, exists, book }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  const action = String(body?.action || '');

  if (action === 'preview') {
    const text = String(body?.text || '').slice(0, MAX_TEXT);
    return NextResponse.json({ ok: true, parsed: parseUsBookImport(text) });
  }

  const { book, error } = await readUsBook(US_BOOK_OWNER);
  if (error) return NextResponse.json({ ok: false, error: `the book could not be read: ${error}` }, { status: 503 });
  let next = book;
  let parsed: ReturnType<typeof parseUsBookImport> | null = null;

  switch (action) {
    case 'import': {
      const text = String(body?.text || '');
      if (!text.trim()) return NextResponse.json({ ok: false, error: 'text is required' }, { status: 400 });
      if (text.length > MAX_TEXT) return NextResponse.json({ ok: false, error: 'import too large' }, { status: 413 });
      parsed = parseUsBookImport(text);
      if (!parsed.holdings.length && !Object.keys(parsed.cash).length) {
        return NextResponse.json({ ok: false, error: 'nothing importable was found', parsed }, { status: 422 });
      }
      next = applyImport(book, parsed, body?.mode === 'merge' ? 'merge' : 'replace');
      break;
    }
    case 'upsert': {
      const h = sanitizeHolding(body?.holding);
      if (!h) return NextResponse.json({ ok: false, error: 'holding needs a ticker and a non-zero quantity' }, { status: 400 });
      next = upsertHolding(book, h);
      break;
    }
    case 'remove': {
      if (!body?.ticker) return NextResponse.json({ ok: false, error: 'ticker is required' }, { status: 400 });
      next = removeHolding(book, String(body.ticker), body?.exchange == null ? null : String(body.exchange));
      break;
    }
    case 'cash': {
      const amt = body?.amount == null || body?.amount === '' ? null : Number(body.amount);
      if (amt != null && !Number.isFinite(amt)) return NextResponse.json({ ok: false, error: 'amount must be a number or null' }, { status: 400 });
      next = setCash(book, String(body?.currency || ''), amt);
      break;
    }
    case 'bench_add': {
      const e = sanitizeBenchEntry({ ticker: body?.ticker, exchange: body?.exchange, currency: body?.currency, note: body?.note });
      if (!e) return NextResponse.json({ ok: false, error: 'a valid ticker is required' }, { status: 400 });
      next = addBench(book, e);
      break;
    }
    case 'bench_remove': {
      next = removeBench(book, String(body?.ticker || ''));
      break;
    }
    default:
      return NextResponse.json({ ok: false, error: `unknown action ${action}` }, { status: 400 });
  }

  const saved = await writeUsBook(next);
  return NextResponse.json({ ok: saved.ok, persisted: saved.ok, error: saved.error, book: next, ...(parsed ? { parsed } : {}) }, { status: saved.ok ? 200 : 503 });
}
