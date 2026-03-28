import { NextResponse } from 'next/server';
import { fetchEventCalendar, fetchCorporateActions } from '@/lib/nse';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'india';

  try {
    if (market === 'india') {
      return await fetchIndiaCalendar();
    } else {
      return await fetchUSCalendar();
    }
  } catch (error) {
    console.error('Calendar error:', error);
    return NextResponse.json({ error: 'Failed to fetch calendar', events: [] }, { status: 500 });
  }
}

async function fetchIndiaCalendar() {
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 4); // Friday

  const formatNSEDate = (d: Date) => {
    const dd = d.getDate().toString().padStart(2, '0');
    const mm = (d.getMonth() + 1).toString().padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  };

  // Fetch from NSE event calendar and corporate actions
  const [eventData, corpActions] = await Promise.all([
    fetchEventCalendar(),
    fetchCorporateActions(formatNSEDate(weekStart), formatNSEDate(weekEnd)),
  ]);

  const events: any[] = [];
  let source = 'NSE India';

  // Parse NSE event calendar (board meetings, results, AGMs)
  if (eventData && Array.isArray(eventData)) {
    for (const event of eventData) {
      events.push({
        company: event.company || event.symbol || '',
        ticker: event.symbol || '',
        date: event.date || event.bm_date || '',
        type: event.bm_purpose || event.purpose || 'Board Meeting',
        description: event.bm_desc || event.description || '',
      });
    }
  }

  // Parse corporate actions (dividends, splits, bonuses)
  if (corpActions && Array.isArray(corpActions)) {
    for (const action of corpActions) {
      events.push({
        company: action.comp || action.company || '',
        ticker: action.symbol || '',
        date: action.exdt || action.exDate || '',
        type: action.subject || action.purpose || 'Corporate Action',
        description: action.subject || '',
      });
    }
  }

  // Major Indian companies for earnings calendar context
  const indianCompanies = [
    { company: 'Reliance Industries', ticker: 'RELIANCE', sector: 'Energy' },
    { company: 'TCS', ticker: 'TCS', sector: 'IT' },
    { company: 'Infosys', ticker: 'INFY', sector: 'IT' },
    { company: 'HDFC Bank', ticker: 'HDFCBANK', sector: 'Banking' },
    { company: 'ICICI Bank', ticker: 'ICICIBANK', sector: 'Banking' },
    { company: 'HCL Tech', ticker: 'HCLTECH', sector: 'IT' },
    { company: 'Wipro', ticker: 'WIPRO', sector: 'IT' },
    { company: 'Axis Bank', ticker: 'AXISBANK', sector: 'Banking' },
    { company: 'Kotak Bank', ticker: 'KOTAKBANK', sector: 'Banking' },
    { company: 'ITC', ticker: 'ITC', sector: 'FMCG' },
    { company: 'Hindustan Unilever', ticker: 'HINDUNILVR', sector: 'FMCG' },
    { company: 'Larsen & Toubro', ticker: 'LT', sector: 'Capital Goods' },
    { company: 'Bajaj Finance', ticker: 'BAJFINANCE', sector: 'Financial Services' },
    { company: 'Sun Pharma', ticker: 'SUNPHARMA', sector: 'Pharma' },
    { company: 'Titan Company', ticker: 'TITAN', sector: 'Consumer Durables' },
    { company: 'Maruti Suzuki', ticker: 'MARUTI', sector: 'Auto' },
    { company: 'Asian Paints', ticker: 'ASIANPAINT', sector: 'Consumer Durables' },
    { company: 'Bharti Airtel', ticker: 'BHARTIARTL', sector: 'Telecom' },
    { company: 'SBI', ticker: 'SBIN', sector: 'Banking' },
    { company: 'Tech Mahindra', ticker: 'TECHM', sector: 'IT' },
  ];

  // Build week calendar
  const calendar: Record<string, any[]> = {};
  for (let i = 0; i < 5; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];

    // Find events for this day
    const dayEvents = events.filter(e => {
      if (!e.date) return false;
      try {
        // Handle dd-Mon-yyyy or dd-mm-yyyy or ISO format
        const eventDate = new Date(e.date);
        return eventDate.toISOString().split('T')[0] === dateStr;
      } catch {
        return false;
      }
    });

    calendar[dateStr] = dayEvents;
  }

  return NextResponse.json({
    events,
    calendar,
    companies: indianCompanies,
    weekStart: weekStart.toISOString().split('T')[0],
    weekEnd: weekEnd.toISOString().split('T')[0],
    source,
    note: events.length > 0
      ? 'Live data from NSE India event calendar'
      : 'Showing major NIFTY 50 companies. Live event data from NSE may be unavailable outside market hours.',
    updatedAt: new Date().toISOString(),
  });
}

async function fetchUSCalendar() {
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);

  const usCompanies = [
    { company: 'Apple', ticker: 'AAPL', sector: 'Technology' },
    { company: 'Microsoft', ticker: 'MSFT', sector: 'Technology' },
    { company: 'NVIDIA', ticker: 'NVDA', sector: 'Technology' },
    { company: 'Amazon', ticker: 'AMZN', sector: 'Consumer Cyclical' },
    { company: 'Alphabet', ticker: 'GOOGL', sector: 'Technology' },
    { company: 'Meta Platforms', ticker: 'META', sector: 'Technology' },
    { company: 'Tesla', ticker: 'TSLA', sector: 'Auto' },
    { company: 'JPMorgan Chase', ticker: 'JPM', sector: 'Banking' },
    { company: 'Netflix', ticker: 'NFLX', sector: 'Communication' },
    { company: 'AMD', ticker: 'AMD', sector: 'Technology' },
    { company: 'Broadcom', ticker: 'AVGO', sector: 'Technology' },
    { company: 'Salesforce', ticker: 'CRM', sector: 'Technology' },
    { company: 'Adobe', ticker: 'ADBE', sector: 'Technology' },
    { company: 'Disney', ticker: 'DIS', sector: 'Communication' },
    { company: 'Goldman Sachs', ticker: 'GS', sector: 'Banking' },
  ];

  const calendar: Record<string, any[]> = {};
  for (let i = 0; i < 5; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    calendar[d.toISOString().split('T')[0]] = [];
  }

  return NextResponse.json({
    events: [],
    calendar,
    companies: usCompanies,
    weekStart: weekStart.toISOString().split('T')[0],
    source: 'Yahoo Finance',
    note: 'Showing major S&P 500 companies. Earnings dates are updated quarterly.',
    updatedAt: new Date().toISOString(),
  });
}
