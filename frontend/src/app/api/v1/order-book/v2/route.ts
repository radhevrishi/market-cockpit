// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/order-book/v2 — production-grade engine endpoint (PATCH 0766)
//
// Wraps lib/order-book-engine with NSE-native + BSE-native ingestion of
// order/contract disclosures. Sources:
//
//   1. NSE corp announcements filtered for order/contract XBRL category
//      (NEAPS circular categories: "Awarding of Order", "Receipt of Order")
//   2. BSE corp announcements with Receipt-of-Orders subcategory
//   3. News fallback for entries that didn't make it to either exchange feed
//
// Returns: OrderBookWidgetState (sourceHealth, totals, rows)
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { nseApiFetch } from '@/lib/nse';
import {
  assembleOrderBookState,
  type NseAnnouncementRaw,
  type BseAnnouncementRaw,
  type NewsRaw,
} from '@/lib/order-book-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function fetchNseOrderAnnouncements(): Promise<NseAnnouncementRaw[]> {
  const today = new Date();
  const sevenDaysAgo = new Date(today.getTime() - 7 * 86400000);
  const fmt = (d: Date) => {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  };
  const from = fmt(sevenDaysAgo);
  const to = fmt(today);

  // PATCH 0767 — Expanded NEAPS XBRL category variants. SEBI's circular
  // mandates issuers to use specific labels for order/contract intimations
  // and they vary slightly across templates.
  const categories = [
    'Awarding of Order',
    'Awarding%20of%20Order',
    'Receipt of Order',
    'Receipt%20of%20Order',
    'Receipt of Order/Contract',
    'Receipt%20of%20Order%2FContract',
    'Order/Contract',
    'Order%2FContract',
    'Awarding/Bagging/Receiving of orders/contracts',
    'Awarding%2FBagging%2FReceiving%20of%20orders%2Fcontracts',
    'Letter of Award',
    'Letter%20of%20Award',
    'Work Order',
    'Work%20Order',
    'Acquisition (Receipt of Order)',
    'Reg. 30 (LODR)',
    'Reg.%2030%20(LODR)',
  ];

  const all: NseAnnouncementRaw[] = [];
  for (const cat of categories) {
    try {
      const path = `/api/corporate-announcements?index=equities&from_date=${from}&to_date=${to}&category=${cat}`;
      const data = await nseApiFetch(path, 5 * 60_000);
      const items = Array.isArray(data) ? data : (data?.rows || data?.data || []);
      for (const item of items) {
        all.push({
          companyName: item.sm_name || item.companyName,
          symbol: item.symbol || item.sm_symbol,
          isin: item.sm_isin || item.isin,
          headline: item.subject || item.attchmntText || '',
          category: cat.replace(/%20/g, ' ').replace(/%2F/g, '/'),
          subCategory: item.smIndustry,
          description: item.attchmntText || item.subject,
          attachmentUrl: item.attchmntFile ? `https://nsearchives.nseindia.com/${item.attchmntFile}` : undefined,
          announcementTime: item.attchmntDate || item.an_dt,
        });
      }
    } catch { /* try next category */ }
  }
  return all;
}

async function fetchBseOrderAnnouncements(): Promise<BseAnnouncementRaw[]> {
  // BSE doesn't have a direct REST endpoint that's reliably scrape-able; we
  // rely on the existing /api/v1/concall-intel/live-feed pipeline which
  // already merges BSE filings into a normalized blob. The blob includes
  // exchange='BSE' tagged rows we can filter.
  try {
    const res = await fetch('http://localhost:3000/api/v1/concall-intel/live-feed?days=7&bullishOnly=false&cacheOnly=1', {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const j = await res.json();
    const filings: any[] = j?.filings || [];
    return filings
      .filter((f: any) => (f.exchange || '').toUpperCase() === 'BSE')
      .map((f: any): BseAnnouncementRaw => ({
        companyName: f.company_name || f.companyName,
        scripCode: f.symbol,
        headline: f.subject,
        category: f.filing_type,
        subCategory: f.subject || '',
        description: f.subject,
        pdfUrl: f.source_url || f.attachment_urls?.[0],
        time: f.filing_datetime,
      }));
  } catch {
    return [];
  }
}

async function fetchOrderNews(baseUrl: string): Promise<NewsRaw[]> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/news?search=${encodeURIComponent('order OR contract OR LoA OR Letter of Award')}&limit=40`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const j = await res.json();
    const articles = Array.isArray(j) ? j : (j?.articles || j?.items || []);
    return articles.map((a: any): NewsRaw => ({
      sourceName: a.source_name,
      publishedAt: a.published_at,
      headline: a.title || a.headline,
      summary: a.summary || a.description,
      ticker: a.primary_ticker || (Array.isArray(a.ticker_symbols) ? a.ticker_symbols[0] : undefined),
      company: a.company,
      url: a.url || a.source_url || '',
    }));
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const [nseResult, bseResult, newsResult] = await Promise.allSettled([
    fetchNseOrderAnnouncements(),
    fetchBseOrderAnnouncements(),
    fetchOrderNews(baseUrl),
  ]);

  const nseRaw = nseResult.status === 'fulfilled' ? nseResult.value : null;
  const bseRaw = bseResult.status === 'fulfilled' ? bseResult.value : null;
  const newsRaw = newsResult.status === 'fulfilled' ? newsResult.value : null;

  const state = assembleOrderBookState({ nseRaw, bseRaw, newsRaw });

  return NextResponse.json(state);
}
