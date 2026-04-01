/**
 * /api/symbols — Symbol Master API
 *
 * GET /api/symbols                → catalog stats + meta
 * GET /api/symbols?search=RELI    → search symbols
 * GET /api/symbols?symbol=RELIANCE → lookup single symbol
 * GET /api/symbols?isin=INE002A01018 → lookup by ISIN
 * GET /api/symbols?refresh=true   → force refresh from NSE CSV
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  refreshSymbolMaster,
  getCatalogStats,
  searchSymbols,
  lookupSymbol,
  lookupByIsin,
  loadCatalog,
} from '@/lib/symbolMaster';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  try {
    // Force refresh
    if (searchParams.get('refresh') === 'true') {
      const meta = await refreshSymbolMaster();
      return NextResponse.json({
        success: true,
        action: 'refresh',
        meta,
      });
    }

    // Single symbol lookup
    const symbolParam = searchParams.get('symbol');
    if (symbolParam) {
      const entry = await lookupSymbol(symbolParam);
      return NextResponse.json({
        success: true,
        action: 'lookup',
        symbol: symbolParam.toUpperCase(),
        entry,
        found: entry !== null,
      });
    }

    // ISIN lookup
    const isinParam = searchParams.get('isin');
    if (isinParam) {
      const entry = await lookupByIsin(isinParam);
      return NextResponse.json({
        success: true,
        action: 'isin_lookup',
        isin: isinParam.toUpperCase(),
        entry,
        found: entry !== null,
      });
    }

    // Search
    const searchQuery = searchParams.get('search') || searchParams.get('q');
    if (searchQuery) {
      const limit = parseInt(searchParams.get('limit') || '10');
      const results = await searchSymbols(searchQuery, Math.min(limit, 50));
      return NextResponse.json({
        success: true,
        action: 'search',
        query: searchQuery,
        count: results.length,
        results,
      });
    }

    // Default: catalog stats
    // Ensure catalog is loaded
    await loadCatalog();
    const stats = await getCatalogStats();
    return NextResponse.json({
      success: true,
      action: 'stats',
      ...stats,
    });
  } catch (error: any) {
    console.error('[Symbols API] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
