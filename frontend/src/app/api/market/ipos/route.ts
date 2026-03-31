import { NextResponse } from 'next/server';
import { fetchCurrentIPOs, fetchUpcomingIPOs, fetchPastIPOs } from '@/lib/nse';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Fetch from NSE APIs in parallel (catch individually — NSE IPO APIs are unreliable)
    const [currentData, upcomingData, pastData] = await Promise.all([
      fetchCurrentIPOs().catch(() => null),
      fetchUpcomingIPOs().catch(() => null),
      fetchPastIPOs().catch(() => null),
    ]);

    // NSE returns data in nested formats: { data: [...] } or just [...]
    const extractArray = (d: any): any[] => {
      if (!d) return [];
      if (Array.isArray(d)) return d;
      if (d.data && Array.isArray(d.data)) return d.data;
      if (d.currentIssue && Array.isArray(d.currentIssue)) return d.currentIssue;
      if (d.upcomingIssue && Array.isArray(d.upcomingIssue)) return d.upcomingIssue;
      if (d.pastIssue && Array.isArray(d.pastIssue)) return d.pastIssue;
      // Try first array-like property
      for (const key of Object.keys(d)) {
        if (Array.isArray(d[key])) return d[key];
      }
      return [];
    };

    const ipos: any[] = [];
    let source = 'NSE India';

    // Parse current/open IPOs from NSE
    const currentArr = extractArray(currentData);
    if (currentArr.length > 0) {
      for (const ipo of currentArr) {
        ipos.push({
          id: ipos.length + 1,
          company: ipo.companyName || ipo.symbol || 'Unknown',
          symbol: ipo.symbol || '',
          exchange: 'NSE',
          status: 'open',
          priceBand: ipo.issuePrice || ipo.priceRange || 'TBA',
          lotSize: ipo.minBidQuantity || ipo.lotSize || '-',
          issueSize: ipo.issueSize || '-',
          dates: {
            open: ipo.issueStartDate || ipo.openDate || '-',
            close: ipo.issueEndDate || ipo.closeDate || '-',
            listing: ipo.listingDate || '-',
          },
          sector: ipo.industry || ipo.sector || 'Various',
          subscription: {
            retail: ipo.retailSubscription || 0,
            nii: ipo.niiSubscription || 0,
            qib: ipo.qibSubscription || 0,
            total: ipo.totalSubscription || 0,
          },
          gmp: 0,
          description: ipo.companyDescription || '',
        });
      }
    }

    // Parse upcoming IPOs from NSE
    const upcomingArr = extractArray(upcomingData);
    if (upcomingArr.length > 0) {
      for (const ipo of upcomingArr) {
        ipos.push({
          id: ipos.length + 1,
          company: ipo.companyName || ipo.symbol || 'Unknown',
          symbol: ipo.symbol || '',
          exchange: 'NSE',
          status: 'upcoming',
          priceBand: ipo.issuePrice || ipo.priceRange || 'TBA',
          lotSize: ipo.minBidQuantity || ipo.lotSize || '-',
          issueSize: ipo.issueSize || '-',
          dates: {
            open: ipo.issueStartDate || ipo.openDate || '-',
            close: ipo.issueEndDate || ipo.closeDate || '-',
            listing: ipo.listingDate || '-',
          },
          sector: ipo.industry || ipo.sector || 'Various',
          subscription: { retail: 0, nii: 0, qib: 0, total: 0 },
          gmp: 0,
          description: ipo.companyDescription || '',
        });
      }
    }

    // Parse past/recently listed IPOs from NSE
    const pastArr = extractArray(pastData);
    if (pastArr.length > 0) {
      for (const ipo of pastArr.slice(0, 10)) {
        ipos.push({
          id: ipos.length + 1,
          company: ipo.companyName || ipo.symbol || 'Unknown',
          symbol: ipo.symbol || '',
          exchange: 'NSE',
          status: 'listed',
          priceBand: ipo.issuePrice || ipo.priceRange || '-',
          lotSize: ipo.minBidQuantity || ipo.lotSize || '-',
          issueSize: ipo.issueSize || '-',
          dates: {
            open: ipo.issueStartDate || ipo.openDate || '-',
            close: ipo.issueEndDate || ipo.closeDate || '-',
            listing: ipo.listingDate || '-',
          },
          sector: ipo.industry || ipo.sector || 'Various',
          listingPrice: ipo.listingPrice || 0,
          listingGain: ipo.listingGain || ipo.listingDayGainPercent || 0,
          subscription: {
            retail: ipo.retailSubscription || 0,
            nii: ipo.niiSubscription || 0,
            qib: ipo.qibSubscription || 0,
            total: ipo.totalSubscription || 0,
          },
          gmp: 0,
          description: '',
        });
      }
    }

    // If NSE data is empty, try scraping from chittorgarh as fallback
    if (ipos.length === 0) {
      source = 'Fallback';
      try {
        const res = await fetch('https://www.chittorgarh.com/report/ipo-in-india-702-702/702/', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'text/html',
          },
          next: { revalidate: 3600 },
        });

        if (res.ok) {
          const html = await res.text();
          const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
          for (const row of rows.slice(0, 15)) {
            const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
            if (cells.length >= 3) {
              const getText = (h: string | undefined) => (h || '').replace(/<[^>]+>/g, '').trim();
              const name = getText(cells[0]);
              if (name && name.length > 2 && !name.includes('IPO Name') && !name.includes('Company')) {
                ipos.push({
                  id: ipos.length + 1,
                  company: name,
                  exchange: 'NSE/BSE',
                  status: 'upcoming',
                  priceBand: getText(cells[2] || '') || 'TBA',
                  dates: getText(cells[1] || '') || 'TBA',
                  issueSize: getText(cells[3] || '') || '-',
                  sector: 'Various',
                  lotSize: '-',
                  subscription: { retail: 0, nii: 0, qib: 0, total: 0 },
                  gmp: 0,
                });
                source = 'chittorgarh.com';
              }
            }
          }
        }
      } catch {}
    }

    return NextResponse.json({
      ipos,
      summary: {
        open: ipos.filter(i => i.status === 'open').length,
        upcoming: ipos.filter(i => i.status === 'upcoming').length,
        listed: ipos.filter(i => i.status === 'listed').length,
        total: ipos.length,
      },
      source,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('IPO fetch error:', error);
    return NextResponse.json({
      error: 'Failed to fetch IPO data',
      ipos: [],
      summary: { open: 0, upcoming: 0, listed: 0, total: 0 },
      source: 'error',
      updatedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}
