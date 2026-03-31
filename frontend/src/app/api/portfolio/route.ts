import { NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

export const dynamic = 'force-dynamic';

const BOT_SECRET = 'mc-bot-2026';

/* ── Types ─────────────────────────────────────────────── */
export interface PortfolioHolding {
  symbol: string;
  entryPrice: number;     // avg buy price in ₹
  quantity: number;        // number of shares
  weight: number;          // % allocation (0-100) — can be manual or auto-calculated
  addedAt: string;         // ISO date
  notes?: string;          // optional user notes
}

export interface PortfolioData {
  holdings: PortfolioHolding[];
  updatedAt: string;
}

function kvKey(chatId: string): string {
  return `portfolio:${chatId}`;
}

/**
 * GET /api/portfolio?chatId=xxx
 * Returns the full portfolio for a given chat ID
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get('chatId') || 'default';

  const stored = await kvGet<PortfolioData>(kvKey(chatId));
  if (stored && stored.holdings && Array.isArray(stored.holdings)) {
    return NextResponse.json({
      chatId,
      holdings: stored.holdings,
      count: stored.holdings.length,
      source: isRedisAvailable() ? 'redis' : 'memory',
      updatedAt: stored.updatedAt,
    });
  }

  return NextResponse.json({
    chatId,
    holdings: [],
    count: 0,
    source: 'default',
    updatedAt: new Date().toISOString(),
  });
}

/**
 * POST /api/portfolio
 * Actions: 'set' (full replace), 'add', 'update', 'remove'
 * Body: { chatId, secret, action, holdings/holding/symbols }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { chatId = 'default', secret } = body;

    if (secret !== BOT_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const existing = await kvGet<PortfolioData>(kvKey(chatId));
    let holdings: PortfolioHolding[] = existing?.holdings || [];

    if (body.action === 'set' && Array.isArray(body.holdings)) {
      // Full replacement
      holdings = body.holdings.map((h: any) => ({
        symbol: String(h.symbol).trim().toUpperCase(),
        entryPrice: Number(h.entryPrice) || 0,
        quantity: Number(h.quantity) || 0,
        weight: Number(h.weight) || 0,
        addedAt: h.addedAt || new Date().toISOString(),
        notes: h.notes || '',
      })).filter((h: PortfolioHolding) => h.symbol.length > 0 && /^[A-Z0-9&-]+$/.test(h.symbol));
    } else if (body.action === 'add' && body.holding) {
      // Add or update a single holding
      const h = body.holding;
      const symbol = String(h.symbol).trim().toUpperCase();
      if (!symbol || !/^[A-Z0-9&-]+$/.test(symbol)) {
        return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
      }

      const idx = holdings.findIndex(x => x.symbol === symbol);
      const newHolding: PortfolioHolding = {
        symbol,
        entryPrice: Number(h.entryPrice) || 0,
        quantity: Number(h.quantity) || 0,
        weight: Number(h.weight) || 0,
        addedAt: h.addedAt || new Date().toISOString(),
        notes: h.notes || '',
      };

      if (idx >= 0) {
        // Update existing — average the entry price if quantity changes
        const old = holdings[idx];
        if (h.averageIn && newHolding.quantity > 0 && old.quantity > 0) {
          const totalQty = old.quantity + newHolding.quantity;
          newHolding.entryPrice = ((old.entryPrice * old.quantity) + (newHolding.entryPrice * newHolding.quantity)) / totalQty;
          newHolding.quantity = totalQty;
        }
        holdings[idx] = { ...old, ...newHolding };
      } else {
        holdings.push(newHolding);
      }
    } else if (body.action === 'update' && body.holding) {
      // Update specific fields of an existing holding
      const symbol = String(body.holding.symbol).trim().toUpperCase();
      const idx = holdings.findIndex(x => x.symbol === symbol);
      if (idx < 0) {
        return NextResponse.json({ error: 'Holding not found' }, { status: 404 });
      }
      const updates = body.holding;
      if (updates.entryPrice !== undefined) holdings[idx].entryPrice = Number(updates.entryPrice);
      if (updates.quantity !== undefined) holdings[idx].quantity = Number(updates.quantity);
      if (updates.weight !== undefined) holdings[idx].weight = Number(updates.weight);
      if (updates.notes !== undefined) holdings[idx].notes = String(updates.notes);
    } else if (body.action === 'remove' && Array.isArray(body.symbols)) {
      const toRemove = new Set(
        body.symbols.map((s: string) => String(s).trim().toUpperCase())
      );
      holdings = holdings.filter(h => !toRemove.has(h.symbol));
    } else {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Auto-calculate weights if not set
    const totalValue = holdings.reduce((sum, h) => sum + (h.entryPrice * h.quantity), 0);
    if (totalValue > 0) {
      for (const h of holdings) {
        if (!h.weight || h.weight === 0) {
          h.weight = Math.round(((h.entryPrice * h.quantity) / totalValue) * 10000) / 100;
        }
      }
    }

    const data: PortfolioData = {
      holdings,
      updatedAt: new Date().toISOString(),
    };

    await kvSet(kvKey(chatId), data);

    return NextResponse.json({
      ok: true,
      chatId,
      holdings,
      count: holdings.length,
      action: body.action,
      storage: isRedisAvailable() ? 'redis' : 'memory',
      updatedAt: data.updatedAt,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}
