import { NextResponse } from 'next/server';
import { fetchBoardMeetings, fetchFinancialResults, fetchNifty500, fetchNifty50, fetchNiftyNext50, getSectorForSymbol, NIFTY50_SECTORS } from '@/lib/nse';

export const dynamic = 'force-dynamic';

// Determine Indian fiscal quarter from a date
function getFiscalQuarter(date: Date): string {
  const month = date.getMonth() + 1; // 1-12
  const year = date.getFullYear();
  // Indian FY: Apr-Mar
  // Q1: Apr-Jun, Q2: Jul-Sep, Q3: Oct-Dec, Q4: Jan-Mar
  if (month >= 4 && month <= 6) return `Q1 FY${(year + 1).toString().slice(2)}`;
  if (month >= 7 && month <= 9) return `Q2 FY${(year + 1).toString().slice(2)}`;
  if (month >= 10 && month <= 12) return `Q3 FY${(year + 1).toString().slice(2)}`;
  return `Q4 FY${year.toString().slice(2)}`;
}

// Assess earnings quality based on financial metrics
function assessQuality(result: any): 'Good' | 'Weak' | 'Upcoming' {
  if (!result.re_operatingProfit && !result.re_netProfit) return 'Upcoming';

  const revenue = parseFloat(result.re_turnover || result.re_revenue || '0');
  const operatingProfit = parseFloat(result.re_operatingProfit || '0');
  const netProfit = parseFloat(result.re_netProfit || result.re_proLossAftTax || '0');
  const eps = parseFloat(result.re_dilEPS || result.re_basicEPS || '0');

  // Quality assessment: check profitability indicators
  const hasProfit = netProfit > 0;
  const hasHealthyOPM = revenue > 0 ? (operatingProfit / revenue) > 0.05 : false;
  const hasPositiveEPS = eps > 0;

  if (hasProfit && (hasHealthyOPM || hasPositiveEPS)) return 'Good';
  return 'Weak';
}

// Determine market cap category
function getCapCategory(marketCap: number): string {
  if (marketCap >= 50000) return 'Large';
  if (marketCap >= 15000) return 'Mid';
  if (marketCap >= 5000) return 'Small';
  return 'Micro';
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'india';
  const month = searchParams.get('month'); // YYYY-MM format
  const includeMovement = searchParams.get('includeMovement') === 'true';

  try {
    if (market !== 'india') {
      return NextResponse.json({ results: [], summary: { total: 0, good: 0, weak: 0, upcoming: 0 }, source: 'Not Available' });
    }

    // Calculate date range - default to current quarter
    const now = new Date();
    let fromDate: Date, toDate: Date;

    if (month) {
      const [year, m] = month.split('-').map(Number);
      fromDate = new Date(year, m - 1, 1);
      toDate = new Date(year, m, 0); // Last day of month
    } else {
      // Current quarter
      const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
      fromDate = new Date(now.getFullYear(), quarterMonth, 1);
      toDate = new Date(now.getFullYear(), quarterMonth + 3, 0);
    }

    const formatNSEDate = (d: Date) => {
      const dd = d.getDate().toString().padStart(2, '0');
      const mm = (d.getMonth() + 1).toString().padStart(2, '0');
      return `${dd}-${mm}-${d.getFullYear()}`;
    };

    // Fetch board meetings and financial results in parallel
    const [boardMeetings, financialResults, stocksData] = await Promise.all([
      fetchBoardMeetings(),
      fetchFinancialResults(formatNSEDate(fromDate), formatNSEDate(toDate)),
      includeMovement ? fetchNifty500().catch(() => fetchNifty50()) : Promise.resolve(null),
    ]);

    // Debug logging
    console.log('Board meetings raw:', boardMeetings ? (typeof boardMeetings === 'object' ? Object.keys(boardMeetings) : 'array') : 'null');
    console.log('Financial results raw:', financialResults ? (typeof financialResults === 'object' ? Object.keys(financialResults) : 'array') : 'null');

    // Build a price lookup from current stocks data
    const priceLookup: Record<string, { price: number; change: number; changePercent: number; volume: number }> = {};
    if (stocksData && stocksData.data) {
      for (const item of stocksData.data) {
        if (item.symbol) {
          priceLookup[item.symbol] = {
            price: item.lastPrice || 0,
            change: item.change || 0,
            changePercent: item.pChange || 0,
            volume: item.totalTradedVolume || 0,
          };
        }
      }
    }

    const results: any[] = [];
    const seenTickers = new Set<string>();

    // Process financial results - handle both array and {data: []} formats
    const financialResultsArray = Array.isArray(financialResults) 
      ? financialResults 
      : (financialResults?.data || financialResults?.results || []);
    
    if (financialResultsArray && Array.isArray(financialResultsArray)) {
      for (const result of financialResultsArray) {
        const ticker = result.symbol || '';
        if (!ticker || seenTickers.has(ticker)) continue;
        seenTickers.add(ticker);

        const resultDate = result.re_broadcastDt || result.an_dt || '';
        let parsedDate: Date | null = null;
        try {
          parsedDate = new Date(resultDate);
          if (isNaN(parsedDate.getTime())) parsedDate = null;
        } catch { parsedDate = null; }

        // Filter by date range
        if (parsedDate && (parsedDate < fromDate || parsedDate > toDate)) continue;

        const sector = await getSectorForSymbol(ticker);
        const quality = assessQuality(result);
        const currentStock = priceLookup[ticker];

        const revenue = parseFloat(result.re_turnover || result.re_revenue || '0');
        const operatingProfit = parseFloat(result.re_operatingProfit || '0');
        const netProfit = parseFloat(result.re_netProfit || result.re_proLossAftTax || '0');
        const eps = parseFloat(result.re_dilEPS || result.re_basicEPS || '0');

        // Calculate price at result and current price
        let priceAtResult: number | null = null;
        let priceChange: number | null = null;

        if (currentStock && parsedDate) {
          // Approximate: use previousClose adjusted by change to estimate
          // For now use current price - we'll improve with chart data
          const currentPrice = currentStock.price;

          // If result was recent (within a few days), approximate result price
          const daysSinceResult = Math.floor((now.getTime() - parsedDate.getTime()) / 86400000);
          if (daysSinceResult <= 90 && currentPrice > 0) {
            // Use daily change to very roughly estimate (improvement: use chart API)
            priceAtResult = currentPrice * (1 - (currentStock.changePercent * daysSinceResult * 0.01) / 30);
            priceChange = ((currentPrice - priceAtResult) / priceAtResult) * 100;
          }
        }

        results.push({
          ticker,
          company: result.sm_name || result.companyName || ticker,
          resultDate: parsedDate ? parsedDate.toISOString().split('T')[0] : resultDate,
          quarter: parsedDate ? getFiscalQuarter(parsedDate) : '',
          quality,
          revenue,
          operatingProfit,
          opm: revenue > 0 ? ((operatingProfit / revenue) * 100).toFixed(1) : '0',
          netProfit,
          eps,
          sector,
          marketCap: getCapCategory(parseFloat(result.re_freeFloat || '0') || 0),
          currentPrice: currentStock?.price || null,
          priceAtResult,
          priceChange: priceChange ? parseFloat(priceChange.toFixed(1)) : null,
          volume: currentStock?.volume || null,
        });
      }
    }

    // Process board meetings - handle both array and {data: []} formats
    const boardMeetingsArray = Array.isArray(boardMeetings)
      ? boardMeetings
      : (boardMeetings?.data || boardMeetings?.results || []);

    if (boardMeetingsArray && Array.isArray(boardMeetingsArray)) {
      for (const meeting of boardMeetingsArray) {
        const ticker = meeting.bm_symbol || meeting.symbol || '';
        if (!ticker || seenTickers.has(ticker)) continue;

        // Only include meetings about financial results
        const purpose = (meeting.bm_purpose || meeting.purpose || '').toLowerCase();
        if (!purpose.includes('result') && !purpose.includes('financial') && !purpose.includes('quarter')) continue;

        const meetingDate = meeting.bm_date || meeting.date || '';
        let parsedDate: Date | null = null;
        try {
          parsedDate = new Date(meetingDate);
          if (isNaN(parsedDate.getTime())) parsedDate = null;
        } catch { parsedDate = null; }

        // Filter by date range
        if (parsedDate && (parsedDate < fromDate || parsedDate > toDate)) continue;

        seenTickers.add(ticker);
        const sector = await getSectorForSymbol(ticker);
        const currentStock = priceLookup[ticker];

        results.push({
          ticker,
          company: meeting.bm_companyName || meeting.sm_name || ticker,
          resultDate: parsedDate ? parsedDate.toISOString().split('T')[0] : meetingDate,
          quarter: parsedDate ? getFiscalQuarter(parsedDate) : '',
          quality: 'Upcoming',
          revenue: null,
          operatingProfit: null,
          opm: null,
          netProfit: null,
          eps: null,
          sector,
          marketCap: '',
          currentPrice: currentStock?.price || null,
          priceAtResult: null,
          priceChange: null,
          volume: currentStock?.volume || null,
        });
      }
    }

    // Sort by date (most recent first)
    results.sort((a, b) => {
      const dateA = new Date(a.resultDate || '').getTime() || 0;
      const dateB = new Date(b.resultDate || '').getTime() || 0;
      return dateB - dateA;
    });

    const goodCount = results.filter(r => r.quality === 'Good').length;
    const weakCount = results.filter(r => r.quality === 'Weak').length;
    const upcomingCount = results.filter(r => r.quality === 'Upcoming').length;

    return NextResponse.json({
      results,
      summary: {
        total: results.length,
        good: goodCount,
        weak: weakCount,
        upcoming: upcomingCount,
      },
      quarter: getFiscalQuarter(fromDate),
      dateRange: {
        from: fromDate.toISOString().split('T')[0],
        to: toDate.toISOString().split('T')[0],
      },
      source: 'NSE India',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Earnings API error:', error);
    return NextResponse.json({
      results: [],
      summary: { total: 0, good: 0, weak: 0, upcoming: 0 },
      source: 'Error',
      error: String(error),
    }, { status: 500 });
  }
}
