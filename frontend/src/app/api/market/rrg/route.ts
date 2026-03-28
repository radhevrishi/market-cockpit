import { NextResponse } from 'next/server';
import { fetchAllIndices } from '@/lib/nse';
import { fetchChart } from '@/lib/yahoo';

export const dynamic = 'force-dynamic';

// NSE sector index names for lookup
const INDIA_SECTOR_NAMES = [
  { nseName: 'NIFTY IT', name: 'IT', color: '#3B82F6' },
  { nseName: 'NIFTY BANK', name: 'Bank Nifty', color: '#F59E0B' },
  { nseName: 'NIFTY PHARMA', name: 'Pharma', color: '#10B981' },
  { nseName: 'NIFTY METAL', name: 'Metal', color: '#EF4444' },
  { nseName: 'NIFTY AUTO', name: 'Auto', color: '#8B5CF6' },
  { nseName: 'NIFTY REALTY', name: 'Realty', color: '#EC4899' },
  { nseName: 'NIFTY FMCG', name: 'FMCG', color: '#14B8A6' },
  { nseName: 'NIFTY MEDIA', name: 'Media', color: '#F97316' },
  { nseName: 'NIFTY ENERGY', name: 'Energy', color: '#06B6D4' },
  { nseName: 'NIFTY PSE', name: 'PSE', color: '#84CC16' },
  { nseName: 'NIFTY INFRA', name: 'Infra', color: '#A855F7' },
  { nseName: 'NIFTY CONSUMPTION', name: 'Consumption', color: '#D946EF' },
  { nseName: 'NIFTY PSU BANK', name: 'PSU Bank', color: '#0EA5E9' },
  { nseName: 'NIFTY FINANCIAL SERVICES', name: 'Fin Services', color: '#F43F5E' },
];

// US Sector ETFs
const US_SECTORS = [
  { symbol: 'XLK', name: 'Technology', color: '#3B82F6' },
  { symbol: 'XLF', name: 'Financials', color: '#F59E0B' },
  { symbol: 'XLV', name: 'Healthcare', color: '#10B981' },
  { symbol: 'XLE', name: 'Energy', color: '#EF4444' },
  { symbol: 'XLI', name: 'Industrials', color: '#8B5CF6' },
  { symbol: 'XLP', name: 'Cons. Staples', color: '#14B8A6' },
  { symbol: 'XLY', name: 'Cons. Disc.', color: '#EC4899' },
  { symbol: 'XLU', name: 'Utilities', color: '#F97316' },
  { symbol: 'XLRE', name: 'Real Estate', color: '#06B6D4' },
  { symbol: 'XLB', name: 'Materials', color: '#84CC16' },
];

function getQuadrant(rsRatio: number, rsMomentum: number): string {
  if (rsRatio >= 100 && rsMomentum >= 100) return 'Leading';
  if (rsRatio >= 100 && rsMomentum < 100) return 'Weakening';
  if (rsRatio < 100 && rsMomentum < 100) return 'Lagging';
  return 'Improving';
}

function calculateRRGFromPerformance(
  sectorChange: number,
  benchmarkChange: number
): { rsRatio: number; rsMomentum: number } {
  // Simplified RRG calculation based on current performance relative to benchmark
  // rsRatio: Is the sector outperforming the benchmark? (centered at 100)
  // rsMomentum: Is the outperformance accelerating? (centered at 100)

  const relativeStrength = sectorChange - benchmarkChange;

  // RS Ratio: normalized around 100
  const rsRatio = 100 + relativeStrength * 2;

  // RS Momentum: Add some variance based on the magnitude
  const momentum = Math.abs(relativeStrength) > 0.5 ? relativeStrength * 1.5 : relativeStrength * 0.8;
  const rsMomentum = 100 + momentum;

  return {
    rsRatio: Math.max(85, Math.min(115, rsRatio)),
    rsMomentum: Math.max(85, Math.min(115, rsMomentum)),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'india';
  const timeframe = searchParams.get('timeframe') || '3m';

  try {
    if (market === 'india') {
      return await fetchIndiaRRG();
    } else {
      return await fetchUSRRG(timeframe);
    }
  } catch (error) {
    console.error('RRG error:', error);
    return NextResponse.json({ error: 'Failed to fetch RRG data', sectors: [], benchmark: {} }, { status: 500 });
  }
}

async function fetchIndiaRRG() {
  // Try NSE allIndices first - gives us all sector indices with % change
  const allIndices = await fetchAllIndices();

  let benchmarkChange = 0;
  let benchmarkPrice = 0;
  const sectors: any[] = [];

  if (allIndices && allIndices.data) {
    // Find NIFTY 50 as benchmark
    const nifty = allIndices.data.find(
      (idx: any) => idx.index === 'NIFTY 50' || idx.indexSymbol === 'NIFTY 50'
    );
    if (nifty) {
      benchmarkChange = nifty.percentChange || nifty.pChange || 0;
      benchmarkPrice = nifty.last || nifty.lastPrice || 0;
    }

    // Map sector indices
    for (const sectorDef of INDIA_SECTOR_NAMES) {
      const idx = allIndices.data.find(
        (item: any) =>
          (item.index || item.indexSymbol || '').toUpperCase() === sectorDef.nseName.toUpperCase()
      );

      if (idx) {
        const sectorChange = idx.percentChange || idx.pChange || 0;
        const { rsRatio, rsMomentum } = calculateRRGFromPerformance(sectorChange, benchmarkChange);

        sectors.push({
          name: sectorDef.name,
          color: sectorDef.color,
          rsRatio,
          rsMomentum,
          quadrant: getQuadrant(rsRatio, rsMomentum),
          changePercent: sectorChange,
          value: idx.last || idx.lastPrice || 0,
        });
      }
    }
  }

  // Fallback to Yahoo Finance if NSE didn't work
  if (sectors.length === 0) {
    const sectorSymbols = [
      { symbol: '^CNXIT', name: 'IT', color: '#3B82F6' },
      { symbol: '^NSEBANK', name: 'Bank Nifty', color: '#F59E0B' },
      { symbol: '^CNXPHARMA', name: 'Pharma', color: '#10B981' },
      { symbol: '^CNXMETAL', name: 'Metal', color: '#EF4444' },
      { symbol: '^CNXAUTO', name: 'Auto', color: '#8B5CF6' },
      { symbol: '^CNXFMCG', name: 'FMCG', color: '#14B8A6' },
      { symbol: '^CNXENERGY', name: 'Energy', color: '#06B6D4' },
    ];

    const benchmarkChart = await fetchChart('^NSEI', '3mo', '1d');
    benchmarkPrice = benchmarkChart?.regularMarketPrice || 0;
    benchmarkChange = benchmarkChart?.changePercent || 0;

    for (const sec of sectorSymbols) {
      const chart = await fetchChart(sec.symbol, '3mo', '1d');
      const sectorChange = chart?.changePercent || 0;
      const { rsRatio, rsMomentum } = calculateRRGFromPerformance(sectorChange, benchmarkChange);

      sectors.push({
        name: sec.name,
        color: sec.color,
        rsRatio,
        rsMomentum,
        quadrant: getQuadrant(rsRatio, rsMomentum),
        changePercent: sectorChange,
      });
    }
  }

  return NextResponse.json({
    sectors,
    benchmark: {
      symbol: '^NSEI',
      name: 'NIFTY 50',
      price: benchmarkPrice,
      changePercent: benchmarkChange,
    },
    market: 'india',
    source: allIndices?.data ? 'NSE India' : 'Yahoo Finance',
    updatedAt: new Date().toISOString(),
  });
}

async function fetchUSRRG(timeframe: string) {
  const rangeMap: Record<string, string> = { '1m': '1mo', '3m': '3mo', '6m': '6mo', '1y': '1y' };
  const range = rangeMap[timeframe] || '3mo';

  const benchmarkChart = await fetchChart('^GSPC', range, '1d');
  const benchmarkChange = benchmarkChart?.changePercent || 0;

  const sectors: any[] = [];
  for (const sec of US_SECTORS) {
    const chart = await fetchChart(sec.symbol, range, '1d');
    const sectorChange = chart?.changePercent || 0;
    const { rsRatio, rsMomentum } = calculateRRGFromPerformance(sectorChange, benchmarkChange);

    sectors.push({
      name: sec.name,
      color: sec.color,
      rsRatio,
      rsMomentum,
      quadrant: getQuadrant(rsRatio, rsMomentum),
      changePercent: sectorChange,
    });
  }

  return NextResponse.json({
    sectors,
    benchmark: {
      symbol: '^GSPC',
      name: 'S&P 500',
      price: benchmarkChart?.regularMarketPrice || 0,
      changePercent: benchmarkChange,
    },
    market: 'us',
    source: 'Yahoo Finance',
    updatedAt: new Date().toISOString(),
  });
}
