// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/rating-actions/v2 — production-grade engine endpoint (PATCH 0765)
//
// Wraps lib/rating-actions-engine with NSE-native ingestion for the credit
// rating disclosures. Sources:
//
//   1. NSE corp announcements filtered for credit-rating XBRL category
//   2. NSE Reg 30 SDD credit-rating disclosures (different endpoint surface)
//   3. News fallback via the existing /api/v1/news pipeline
//
// Returns: RatingWidgetState (sourceHealth, totals, rows)
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { nseApiFetch } from '@/lib/nse';
import { assembleRatingWidgetState, type NseCreditRawRow } from '@/lib/rating-actions-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Fetch NSE corp announcements filtered to credit-rating category. NSE's
 * /api/corporate-announcements endpoint accepts a `category` query. The
 * canonical category label for credit ratings on NEAPS varies — we try
 * multiple known labels and merge.
 */
async function fetchNseCreditAnnouncements(): Promise<NseCreditRawRow[]> {
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

  // Categories observed in NEAPS for credit rating disclosures
  const categories = [
    'Credit Rating',
    'Credit%20Rating',
    'Receipt%20of%20Credit%20Rating',
  ];

  const all: NseCreditRawRow[] = [];
  for (const cat of categories) {
    try {
      const path = `/api/corporate-announcements?index=equities&from_date=${from}&to_date=${to}&category=${cat}`;
      const data = await nseApiFetch(path, 5 * 60_000);
      const items = Array.isArray(data) ? data : (data?.rows || data?.data || []);
      for (const item of items) {
        all.push({
          companyName: item.sm_name || item.symbol || item.companyName,
          symbol: item.symbol || item.sm_symbol,
          isin: item.sm_isin || item.isin,
          ratingAgency: item.an_dt_attchmntFileNm || item.subject || item.attchmntText || '',
          creditRating: item.subject || item.attchmntText || '',
          ratingAction: item.subject || '',
          dateOfCreditRating: item.an_dt || item.bDT || item.attchmntDate,
          reportingDate: item.attchmntDate || item.an_dt,
          broadcastDateTime: item.attchmntDate || item.an_dt,
          attachmentUrl: item.attchmntFile ? `https://nsearchives.nseindia.com/${item.attchmntFile}` : undefined,
          remarks: item.smIndustry || item.subject,
        });
      }
    } catch { /* try next category */ }
  }
  return all;
}

/**
 * Fetch news articles that mention rating agencies, via existing /api/v1/news
 * pipeline. We hit our own internal API so we get the cached blob (no
 * duplicate upstream fetches).
 */
async function fetchRatingNews(baseUrl: string): Promise<any[]> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/news?search=${encodeURIComponent('ICRA OR CRISIL OR CARE Ratings OR India Ratings OR rating')}&limit=40`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const j = await res.json();
    const articles = Array.isArray(j) ? j : (j?.articles || j?.items || []);
    return articles;
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const [creditResult, newsResult] = await Promise.allSettled([
    fetchNseCreditAnnouncements(),
    fetchRatingNews(baseUrl),
  ]);

  const nseCreditRows = creditResult.status === 'fulfilled' ? creditResult.value : null;
  const newsArticles = newsResult.status === 'fulfilled' ? newsResult.value : null;

  const state = assembleRatingWidgetState({
    nseCreditRows,
    nseReg30Rows: null, // separate endpoint; can be added in v2.1
    newsArticles,
  });

  return NextResponse.json(state);
}
