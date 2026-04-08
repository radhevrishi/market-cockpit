import { NextResponse } from 'next/server';
import { fetchBoardMeetings, fetchFinancialResults, fetchCorporateActions, getSectorForSymbol } from '@/lib/nse';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'india';
  const monthParam = searchParams.get('month'); // YYYY-MM

  try {
    if (market === 'india') {
      return await fetchIndiaCalendar(monthParam);
    } else {
      return NextResponse.json({
        events: [],
        calendar: {},
        companies: [],
        source: 'Not Available',
        note: 'US earnings calendar coming soon. Use the Earnings page for live data.',
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('Calendar error:', error);
    return NextResponse.json({ error: 'Failed to fetch calendar', events: [] }, { status: 500 });
  }
}

async function fetchIndiaCalendar(monthParam: string | null) {
  // Date range: current month or specified month
  const now = new Date();
  let fromDate: Date, toDate: Date;

  if (monthParam) {
    const [year, m] = monthParam.split('-').map(Number);
    fromDate = new Date(year, m - 1, 1);
    toDate = new Date(year, m, 0);
  } else {
    // Current week for backward compatibility
    fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - fromDate.getDay() + 1); // Monday
    toDate = new Date(fromDate);
    toDate.setDate(toDate.getDate() + 4); // Friday
  }

  const formatNSEDate = (d: Date) => {
    const dd = d.getDate().toString().padStart(2, '0');
    const mm = (d.getMonth() + 1).toString().padStart(2, '0');
    return `${dd}-${mm}-${d.getFullYear()}`;
  };

  // Fetch all data sources in parallel - ALL LIVE, no hardcoded lists
  const [boardMeetings, corpActions] = await Promise.all([
    fetchBoardMeetings(),
    fetchCorporateActions(formatNSEDate(fromDate), formatNSEDate(toDate)),
  ]);

  const events: any[] = [];

  // Parse board meetings (earnings announcements)
  if (boardMeetings && Array.isArray(boardMeetings)) {
    for (const meeting of boardMeetings) {
      const purpose = (meeting.bm_purpose || meeting.purpose || '').toLowerCase();
      const isEarnings = purpose.includes('result') || purpose.includes('financial') || purpose.includes('quarter');
      
      const ticker = meeting.bm_symbol || meeting.symbol || '';
      const sector = ticker ? await getSectorForSymbol(ticker) : '';

      events.push({
        company: meeting.bm_companyName || meeting.sm_name || ticker,
        ticker,
        date: meeting.bm_date || meeting.date || '',
        type: isEarnings ? 'Earnings' : 'Board Meeting',
        description: meeting.bm_purpose || meeting.purpose || '',
        sector,
      });
    }
  }

  // Parse corporate actions (dividends, splits, bonuses)
  if (corpActions && Array.isArray(corpActions)) {
    for (const action of corpActions) {
      const ticker = action.symbol || '';
      const sector = ticker ? await getSectorForSymbol(ticker) : '';
      
      events.push({
        company: action.comp || action.company || '',
        ticker,
        date: action.exdt || action.exDate || '',
        type: action.subject || action.purpose || 'Corporate Action',
        description: action.subject || '',
        sector,
      });
    }
  }

  // Build calendar grouped by date
  const calendar: Record<string, any[]> = {};
  for (const event of events) {
    if (!event.date) continue;
    try {
      const eventDate = new Date(event.date);
      const dateStr = eventDate.toISOString().split('T')[0];
      if (!calendar[dateStr]) calendar[dateStr] = [];
      calendar[dateStr].push(event);
    } catch {}
  }

  // Build companies list from live events (no hardcoded list)
  const companiesSet = new Map<string, any>();
  for (const event of events) {
    if (event.ticker && !companiesSet.has(event.ticker)) {
      companiesSet.set(event.ticker, {
        company: event.company,
        ticker: event.ticker,
        sector: event.sector,
        type: event.type,
      });
    }
  }

  return NextResponse.json({
    events,
    calendar,
    companies: Array.from(companiesSet.values()),
    weekStart: fromDate.toISOString().split('T')[0],
    weekEnd: toDate.toISOString().split('T')[0],
    source: 'NSE India',
    note: events.length > 0
      ? `Live data from NSE India — ${events.length} events found`
      : 'No events found for this period. NSE data may be limited outside market hours.',
    updatedAt: new Date().toISOString(),
  });
}
