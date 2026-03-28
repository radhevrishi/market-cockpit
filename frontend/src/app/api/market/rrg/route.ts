import { NextResponse } from 'next/server';
import { fetchAllIndices } from '@/lib/nse';
import { fetchChart } from '@/lib/yahoo';

export const dynamic = 'force-dynamic';

// NSE sector index Yahoo Finance symbols for historical data
const INDIA_SECTORS = [
  { yahoo: '^CNXIT', nseName: 'NIFTY IT', name: 'IT', color: '#3B82F6' },
  { yahoo: '^NSEBANK', nseName: 'NIFTY BANK', name: 'Bank Nifty', color: '#F59E0B' },
  { yahoo: '^CNXPHARMA', nseName: 'NIFTY PHARMA', name: 'Pharma', color: '#10B981' },
  { yahoo: '^CNXMETAL', nseName: 'NIFTY METAL', name: 'Metal', color: '#EF4444' },
  { yahoo: '^CNXAUTO', nseName: 'NIFTY AUTO', name: 'Auto', color: '#8B5CF6' },
  { yahoo: '^CNXREALTY', nseName: 'NIFTY REALTY', name: 'Realty', color: '#EC4899' },
  { yahoo: '^CNXFMCG', nseName: 'NIFTY FMCG', name: 'FMCG', color: '#14B8A6' },
  { yahoo: '^CNXMEDIA', nseName: 'NIFTY MEDIA', name: 'Media', color: '#F97316' },
  { yahoo: '^CNXENERGY', nseName: 'NIFTY ENERGY', name: 'Energy', color: '#06B6D4' },
  { yahoo: '^CNXPSE', nseName: 'NIFTY PSE', name: 'PSE', color: '#84CC16' },
  { yahoo: '^CNXINFRA', nseName: 'NIFTY INFRA', name: 'Infra', color: '#A855F7' },
  { yahoo: '^CNXFIN', nseName: 'NIFTY FINANCIAL SERVICES', name: 'Fin Services', color: '#F43F5E' },
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

// ========================================
// JdK RS-Ratio / RS-Momentum Calculation
// ========================================
// The JdK Relative Rotation Graph uses two indicators:
// 1. RS-Ratio: measures the relative strength of a sector vs benchmark, smoothed
// 2. RS-Momentum: measures the rate of change of RS-Ratio (acceleration)
// Both are normalized around 100. Values >100 = outperforming, <100 = underperforming.

function getQuadrant(rsRatio: number, rsMomentum: number): string {
  if (rsRatio >= 100 && rsMomentum >= 100) return 'Leading';
  if (rsRatio >= 100 && rsMomentum < 100) return 'Weakening';
  if (rsRatio < 100 && rsMomentum < 100) return 'Lagging';
  return 'Improving';
}

/**
 * Resample daily closes to weekly closes (Friday close or last available)
 */
function resampleToWeekly(timestamps: number[], closes: number[]): { ts: number[]; closes: number[] } {
  if (!timestamps.length || !closes.length) return { ts: [], closes: [] };

  const weeklyTs: number[] = [];
  const weeklyCloses: number[] = [];

  let currentWeekEnd = -1;
  let lastClose = 0;
  let lastTs = 0;

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const close = closes[i];
    if (close == null || isNaN(close)) continue;

    const date = new Date(ts * 1000);
    // Get the Friday of the current week (week ending)
    const dayOfWeek = date.getDay();
    const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
    const friday = new Date(date);
    friday.setDate(friday.getDate() + daysUntilFriday);
    friday.setHours(0, 0, 0, 0);
    const weekEnd = friday.getTime();

    if (weekEnd !== currentWeekEnd) {
      // Save previous week's last close
      if (currentWeekEnd !== -1 && lastClose > 0) {
        weeklyTs.push(lastTs);
        weeklyCloses.push(lastClose);
      }
      currentWeekEnd = weekEnd;
    }

    lastClose = close;
    lastTs = ts;
  }

  // Don't forget the last week
  if (lastClose > 0) {
    weeklyTs.push(lastTs);
    weeklyCloses.push(lastClose);
  }

  return { ts: weeklyTs, closes: weeklyCloses };
}

/**
 * Calculate the JdK RS-Ratio and RS-Momentum from historical price series.
 *
 * Algorithm:
 * 1. Compute raw relative strength: RS_raw[i] = (sector[i] / benchmark[i]) * 100
 * 2. Normalize RS to start at 100
 * 3. Apply Wilder-style exponential smoothing (period=10) to get RS-Ratio
 * 4. RS-Momentum = (RS-Ratio / RS-Ratio[1 period ago]) * 100
 * 5. Apply smoothing to momentum too
 *
 * The smoothing period adapts to the number of data points available.
 */
function calculateJdKIndicators(
  sectorCloses: number[],
  benchmarkCloses: number[],
): { rsRatio: number; rsMomentum: number; trail: { x: number; y: number }[] } {
  const len = Math.min(sectorCloses.length, benchmarkCloses.length);

  if (len < 4) {
    return { rsRatio: 100, rsMomentum: 100, trail: [] };
  }

  // Step 1: Calculate raw relative strength series
  const rsRaw: number[] = [];
  for (let i = 0; i < len; i++) {
    if (benchmarkCloses[i] > 0 && sectorCloses[i] > 0) {
      rsRaw.push((sectorCloses[i] / benchmarkCloses[i]) * 100);
    } else {
      rsRaw.push(rsRaw.length > 0 ? rsRaw[rsRaw.length - 1] : 100);
    }
  }

  // Step 2: Normalize RS so that the first value = 100
  const baseRS = rsRaw[0] || 100;
  const rsNorm = rsRaw.map(v => (v / baseRS) * 100);

  // Step 3: Apply exponential smoothing for RS-Ratio
  // Use Wilder smoothing: alpha = 1/period
  const period = Math.min(10, Math.floor(len / 2));
  const alpha = 1 / Math.max(period, 2);

  const rsSmoothed: number[] = [rsNorm[0]];
  for (let i = 1; i < rsNorm.length; i++) {
    rsSmoothed.push(rsSmoothed[i - 1] + alpha * (rsNorm[i] - rsSmoothed[i - 1]));
  }

  // Step 4: Calculate RS-Momentum (rate of change of smoothed RS)
  const momLookback = Math.min(5, Math.floor(len / 3));
  const rsMomRaw: number[] = [];
  for (let i = 0; i < rsSmoothed.length; i++) {
    if (i < momLookback) {
      rsMomRaw.push(100);
    } else {
      const prev = rsSmoothed[i - momLookback];
      rsMomRaw.push(prev > 0 ? (rsSmoothed[i] / prev) * 100 : 100);
    }
  }

  // Step 5: Smooth momentum
  const momSmoothed: number[] = [rsMomRaw[0]];
  for (let i = 1; i < rsMomRaw.length; i++) {
    momSmoothed.push(momSmoothed[i - 1] + alpha * (rsMomRaw[i] - momSmoothed[i - 1]));
  }

  // Build trail (last N data points for animation)
  const trailLen = Math.min(8, rsSmoothed.length);
  const trail: { x: number; y: number }[] = [];
  for (let i = rsSmoothed.length - trailLen; i < rsSmoothed.length; i++) {
    if (i >= 0) {
      trail.push({
        x: rsSmoothed[i],
        y: momSmoothed[i] || 100,
      });
    }
  }

  const currentRSRatio = rsSmoothed[rsSmoothed.length - 1];
  const currentMomentum = momSmoothed[momSmoothed.length - 1];

  return {
    rsRatio: currentRSRatio,
    rsMomentum: currentMomentum,
    trail,
  };
}

// Timeframe to Yahoo Finance range/interval mapping
function getYahooParams(timeframe: string): { range: string; interval: string } {
  switch (timeframe) {
    case '1m': return { range: '3mo', interval: '1d' };   // ~60 daily points → ~12 weekly
    case '3m': return { range: '6mo', interval: '1d' };   // ~120 daily → ~24 weekly
    case '6m': return { range: '1y', interval: '1d' };    // ~250 daily → ~50 weekly
    case '1y': return { range: '2y', interval: '1wk' };   // ~100 weekly
    default: return { range: '6mo', interval: '1d' };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'india';
  const timeframe = searchParams.get('timeframe') || '3m';

  try {
    if (market === 'india') {
      return await fetchIndiaRRG(timeframe);
    } else {
      return await fetchUSRRG(timeframe);
    }
  } catch (error) {
    console.error('RRG error:', error);
    return NextResponse.json({ error: 'Failed to fetch RRG data', sectors: [], benchmark: {} }, { status: 500 });
  }
}

async function fetchIndiaRRG(timeframe: string) {
  const { range, interval } = getYahooParams(timeframe);

  // Fetch benchmark (NIFTY 50) historical data
  const benchmarkChart = await fetchChart('^NSEI', range, interval);
  if (!benchmarkChart || !benchmarkChart.closes || benchmarkChart.closes.length < 4) {
    // Fallback to NSE allIndices daily data
    return await fetchIndiaRRGFallback();
  }

  // Resample to weekly if daily data
  let benchmarkWeekly: { ts: number[]; closes: number[] };
  if (interval === '1d') {
    benchmarkWeekly = resampleToWeekly(benchmarkChart.timestamps, benchmarkChart.closes);
  } else {
    benchmarkWeekly = { ts: benchmarkChart.timestamps, closes: benchmarkChart.closes };
  }

  // Filter out null closes
  const cleanBenchmark = benchmarkWeekly.closes.filter((c: number) => c != null && !isNaN(c));

  // Fetch all sector indices in parallel
  const sectorPromises = INDIA_SECTORS.map(async (sec) => {
    try {
      const chart = await fetchChart(sec.yahoo, range, interval);
      if (!chart || !chart.closes || chart.closes.length < 4) return null;

      let weeklyData: { ts: number[]; closes: number[] };
      if (interval === '1d') {
        weeklyData = resampleToWeekly(chart.timestamps, chart.closes);
      } else {
        weeklyData = { ts: chart.timestamps, closes: chart.closes };
      }

      const cleanCloses = weeklyData.closes.filter((c: number) => c != null && !isNaN(c));

      const { rsRatio, rsMomentum, trail } = calculateJdKIndicators(cleanCloses, cleanBenchmark);

      return {
        name: sec.name,
        color: sec.color,
        rsRatio: parseFloat(rsRatio.toFixed(2)),
        rsMomentum: parseFloat(rsMomentum.toFixed(2)),
        quadrant: getQuadrant(rsRatio, rsMomentum),
        changePercent: chart.changePercent || 0,
        value: chart.regularMarketPrice || 0,
        trail: trail.map(p => ({ x: parseFloat(p.x.toFixed(2)), y: parseFloat(p.y.toFixed(2)) })),
      };
    } catch (e) {
      console.error(`RRG error for ${sec.name}:`, e);
      return null;
    }
  });

  const results = await Promise.all(sectorPromises);
  const sectors = results.filter(Boolean);

  // Also try to get live daily change from NSE for display purposes
  let benchmarkPrice = benchmarkChart.regularMarketPrice || 0;
  let benchmarkDailyChange = benchmarkChart.changePercent || 0;

  try {
    const allIndices = await fetchAllIndices();
    if (allIndices?.data) {
      const nifty = allIndices.data.find((idx: any) =>
        (idx.index || idx.indexSymbol || '').toUpperCase() === 'NIFTY 50'
      );
      if (nifty) {
        benchmarkPrice = nifty.last || nifty.lastPrice || benchmarkPrice;
        benchmarkDailyChange = nifty.percentChange || nifty.pChange || benchmarkDailyChange;
      }
    }
  } catch {}

  return NextResponse.json({
    sectors,
    benchmark: {
      symbol: '^NSEI',
      name: 'NIFTY 50',
      price: benchmarkPrice,
      changePercent: benchmarkDailyChange,
    },
    market: 'india',
    timeframe,
    source: 'Yahoo Finance (JdK RS)',
    updatedAt: new Date().toISOString(),
  });
}

// Fallback using NSE daily data when Yahoo historical data is unavailable
async function fetchIndiaRRGFallback() {
  const allIndices = await fetchAllIndices();
  const sectors: any[] = [];
  let benchmarkChange = 0;
  let benchmarkPrice = 0;

  if (allIndices?.data) {
    const nifty = allIndices.data.find(
      (idx: any) => (idx.index || idx.indexSymbol || '').toUpperCase() === 'NIFTY 50'
    );
    if (nifty) {
      benchmarkChange = nifty.percentChange || nifty.pChange || 0;
      benchmarkPrice = nifty.last || nifty.lastPrice || 0;
    }

    for (const sectorDef of INDIA_SECTORS) {
      const idx = allIndices.data.find(
        (item: any) => (item.index || item.indexSymbol || '').toUpperCase() === sectorDef.nseName.toUpperCase()
      );
      if (idx) {
        const sectorChange = idx.percentChange || idx.pChange || 0;
        const relStrength = sectorChange - benchmarkChange;
        // Approximate: daily data → scale up for visual spread
        const rsRatio = 100 + relStrength * 3;
        const rsMomentum = 100 + relStrength * 2;

        sectors.push({
          name: sectorDef.name,
          color: sectorDef.color,
          rsRatio: parseFloat(rsRatio.toFixed(2)),
          rsMomentum: parseFloat(rsMomentum.toFixed(2)),
          quadrant: getQuadrant(rsRatio, rsMomentum),
          changePercent: sectorChange,
          value: idx.last || idx.lastPrice || 0,
          trail: [],
        });
      }
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
    source: 'NSE India (Daily Fallback)',
    updatedAt: new Date().toISOString(),
  });
}

async function fetchUSRRG(timeframe: string) {
  const { range, interval } = getYahooParams(timeframe);

  // Fetch S&P 500 benchmark
  const benchmarkChart = await fetchChart('^GSPC', range, interval);
  if (!benchmarkChart || !benchmarkChart.closes || benchmarkChart.closes.length < 4) {
    return NextResponse.json({
      sectors: [],
      benchmark: { symbol: '^GSPC', name: 'S&P 500', price: 0, changePercent: 0 },
      market: 'us',
      error: 'Unable to fetch benchmark data',
    });
  }

  let benchmarkWeekly: { ts: number[]; closes: number[] };
  if (interval === '1d') {
    benchmarkWeekly = resampleToWeekly(benchmarkChart.timestamps, benchmarkChart.closes);
  } else {
    benchmarkWeekly = { ts: benchmarkChart.timestamps, closes: benchmarkChart.closes };
  }
  const cleanBenchmark = benchmarkWeekly.closes.filter((c: number) => c != null && !isNaN(c));

  // Fetch all US sector ETFs in parallel
  const sectorPromises = US_SECTORS.map(async (sec) => {
    try {
      const chart = await fetchChart(sec.symbol, range, interval);
      if (!chart || !chart.closes || chart.closes.length < 4) return null;

      let weeklyData: { ts: number[]; closes: number[] };
      if (interval === '1d') {
        weeklyData = resampleToWeekly(chart.timestamps, chart.closes);
      } else {
        weeklyData = { ts: chart.timestamps, closes: chart.closes };
      }
      const cleanCloses = weeklyData.closes.filter((c: number) => c != null && !isNaN(c));

      const { rsRatio, rsMomentum, trail } = calculateJdKIndicators(cleanCloses, cleanBenchmark);

      return {
        name: sec.name,
        color: sec.color,
        rsRatio: parseFloat(rsRatio.toFixed(2)),
        rsMomentum: parseFloat(rsMomentum.toFixed(2)),
        quadrant: getQuadrant(rsRatio, rsMomentum),
        changePercent: chart.changePercent || 0,
        trail: trail.map(p => ({ x: parseFloat(p.x.toFixed(2)), y: parseFloat(p.y.toFixed(2)) })),
      };
    } catch {
      return null;
    }
  });

  const results = await Promise.all(sectorPromises);
  const sectors = results.filter(Boolean);

  return NextResponse.json({
    sectors,
    benchmark: {
      symbol: '^GSPC',
      name: 'S&P 500',
      price: benchmarkChart.regularMarketPrice || 0,
      changePercent: benchmarkChart.changePercent || 0,
    },
    market: 'us',
    timeframe,
    source: 'Yahoo Finance (JdK RS)',
    updatedAt: new Date().toISOString(),
  });
}
