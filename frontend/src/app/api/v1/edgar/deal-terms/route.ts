// ═══════════════════════════════════════════════════════════════════════════
// SEC EDGAR — Deal-terms extractor (PATCH 0706)
//
// Counterpart to /api/v1/edgar/filings (P0318) which only returns the
// submissions list. This endpoint fetches the actual primary doc of a
// SC TO-T / DEFM14A / 8-K M&A filing and runs regex extraction for the
// institutional deal terms:
//   - tender / offer price per share
//   - consideration mix (cash vs stock vs mixed)
//   - tender expiration / close date
//   - implied premium (when both spot and offer are mentioned)
//   - minimum tender condition (% threshold)
//   - financing certainty language
//
// Pure regex extraction in v0 — recall over precision. Pulls excerpts so
// analyst can verify before acting. Caches per (cik, accession) in KV 7d
// because deal terms are immutable once the filing is on file.
//
// Usage:
//   GET /api/v1/edgar/deal-terms?cik=<CIK>&accession=<accession-no>[&doc=<primary_doc>]
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const KEY = (cik: string, accession: string) => `edgar-terms:v1:${cik}:${accession}`;
const TTL_SECONDS = 7 * 24 * 60 * 60; // 7d — filings are immutable once filed

interface DealTerms {
  cik: string;
  accession: string;
  primaryDocUrl: string;
  // Extracted terms
  offerPricePerShare: number | null;
  offerPricePerShareCurrency: string;
  offerPriceQuote: string | null;
  considerationMix: 'CASH' | 'STOCK' | 'MIXED' | null;
  considerationQuote: string | null;
  tenderCloseDate: string | null;        // ISO YYYY-MM-DD if parseable
  tenderCloseQuote: string | null;
  impliedPremiumPct: number | null;
  impliedPremiumQuote: string | null;
  minimumTenderConditionPct: number | null;
  minimumConditionQuote: string | null;
  financingCertainty: 'FULLY_COMMITTED' | 'COMMITTED_PARTIAL' | 'CONDITIONAL' | null;
  financingQuote: string | null;
  // Provenance
  charsExtracted: number;
  source: 'EDGAR_DIRECT' | 'EDGAR_BLOCKED' | 'KV_CACHED' | 'FETCH_ERROR';
  cachedAt?: number;
  error?: string;
}

function pad10(s: string): string {
  const n = s.replace(/\D/g, '');
  return n.padStart(10, '0').slice(-10);
}

function normalizeAccession(s: string): string {
  // EDGAR accessions: '0001234567-25-001234' or '0001234567-25-001234' (no dashes acceptable too)
  return s.replace(/[^0-9-]/g, '');
}

function dollarToNum(raw: string): number | null {
  const m = raw.match(/\$?\s*([\d,]+(?:\.\d{1,4})?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function extractOfferPrice(text: string): { price: number | null; quote: string | null } {
  // Common SC TO-T language: "$X.YZ per Share", "$X.YZ in cash for each",
  // "offer price of $X.YZ per share", "purchase price of $X.YZ per share"
  const patterns = [
    /(?:offer\s+(?:to\s+)?(?:purchase|acquire)|tender\s+offer|consideration|offer\s+price)\s+(?:of\s+)?\$\s?([\d,]+\.?\d*)\s+(?:per\s+share|in\s+cash|for\s+each\s+(?:share|outstanding))/i,
    /\$\s?([\d,]+\.?\d*)\s+(?:per\s+share\s+in\s+cash|in\s+cash\s+for\s+each\s+share|per\s+share)/i,
    /purchase\s+price\s+(?:of\s+)?\$\s?([\d,]+\.?\d*)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const price = dollarToNum(m[1] || m[0]);
      const idx = text.search(re);
      const excerpt = text.slice(Math.max(0, idx - 40), idx + 200).replace(/\s+/g, ' ').trim();
      return { price, quote: excerpt };
    }
  }
  return { price: null, quote: null };
}

function extractConsiderationMix(text: string): { mix: DealTerms['considerationMix']; quote: string | null } {
  // Cash-only language is most common in tender offers.
  // Stock-for-stock: "in exchange for X shares of Acquirer"
  // Mixed: "elect to receive either cash or stock"
  if (/elect\s+(?:to\s+)?receive\s+either\s+(?:cash|shares|stock)|mixed\s+consideration|cash[-\s]and[-\s]stock|cash\s+and\s+stock\s+consideration/i.test(text)) {
    const m = text.match(/.{0,80}(?:elect|mixed\s+consideration|cash[-\s]and[-\s]stock|cash\s+and\s+stock).{0,200}/i);
    return { mix: 'MIXED', quote: m ? m[0].replace(/\s+/g, ' ').trim() : null };
  }
  if (/in\s+exchange\s+for\s+[\d.]+\s+(?:shares|share)\s+of/i.test(text)) {
    const m = text.match(/.{0,40}in\s+exchange\s+for\s+[\d.]+\s+shares\s+of.{0,150}/i);
    return { mix: 'STOCK', quote: m ? m[0].replace(/\s+/g, ' ').trim() : null };
  }
  if (/all[-\s]cash|cash\s+(?:offer|consideration|tender)|\$[\d.,]+\s+per\s+share\s+in\s+cash/i.test(text)) {
    const m = text.match(/.{0,40}(?:all[-\s]cash|cash\s+(?:offer|consideration|tender)|\$[\d.,]+\s+per\s+share\s+in\s+cash).{0,150}/i);
    return { mix: 'CASH', quote: m ? m[0].replace(/\s+/g, ' ').trim() : null };
  }
  return { mix: null, quote: null };
}

function extractTenderCloseDate(text: string): { date: string | null; quote: string | null } {
  // Common: "Expiration Date: 5:00 p.m. Eastern Time, on Friday, March 14, 2026"
  // Or: "expire at midnight ... on March 14, 2026"
  const monthNames = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  const datePattern = new RegExp(`(?:expir(?:e|ation)|tender\\s+(?:offer\\s+)?(?:will\\s+)?(?:expire|close)|deadline|close\\s+of\\s+business).{0,80}${monthNames}\\s+\\d{1,2},?\\s+\\d{4}`, 'i');
  const m = text.match(datePattern);
  if (m) {
    const isoMatch = m[0].match(new RegExp(`(${monthNames})\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i'));
    let iso: string | null = null;
    if (isoMatch) {
      const months: Record<string, string> = {
        jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
        apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
        aug: '08', august: '08', sep: '09', september: '09', oct: '10', october: '10',
        nov: '11', november: '11', dec: '12', december: '12',
      };
      const mm = months[isoMatch[1].toLowerCase()];
      const dd = String(isoMatch[2]).padStart(2, '0');
      const yyyy = isoMatch[3];
      if (mm) iso = `${yyyy}-${mm}-${dd}`;
    }
    return { date: iso, quote: m[0].replace(/\s+/g, ' ').trim() };
  }
  return { date: null, quote: null };
}

function extractImpliedPremium(text: string): { pct: number | null; quote: string | null } {
  // "represents a premium of approximately X% to the closing price of $Y.YY"
  // "X% premium to the unaffected price"
  const patterns = [
    /(?:premium\s+of\s+(?:approximately\s+)?(\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)\s*%\s+premium\s+(?:to|over))/i,
    /represents\s+a\s+premium\s+of\s+(?:approximately\s+)?(\d+(?:\.\d+)?)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const pct = parseFloat(m[1] || m[2]);
      const idx = text.search(re);
      const quote = text.slice(Math.max(0, idx - 40), idx + 240).replace(/\s+/g, ' ').trim();
      return { pct: Number.isFinite(pct) ? pct : null, quote };
    }
  }
  return { pct: null, quote: null };
}

function extractMinimumCondition(text: string): { pct: number | null; quote: string | null } {
  // "minimum condition ... a majority of the outstanding shares" or
  // "at least 50% of the outstanding shares" / "at least a majority"
  const patterns = [
    /minimum\s+(?:tender\s+)?condition.{0,80}(\d+(?:\.\d+)?)\s*%/i,
    /at\s+least\s+(\d+(?:\.\d+)?)\s*%\s+of\s+the\s+(?:outstanding|issued)\s+shares/i,
    /more\s+than\s+(?:fifty\s+percent|50\s*%)/i,
    /majority\s+of\s+the\s+(?:outstanding|issued)\s+shares/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      let pct: number | null = null;
      if (m[1]) pct = parseFloat(m[1]);
      else if (/majority|fifty\s+percent|50\s*%/i.test(m[0])) pct = 50;
      const idx = text.search(re);
      const quote = text.slice(Math.max(0, idx - 40), idx + 220).replace(/\s+/g, ' ').trim();
      return { pct, quote };
    }
  }
  return { pct: null, quote: null };
}

function extractFinancingCertainty(text: string): { tier: DealTerms['financingCertainty']; quote: string | null } {
  if (/fully\s+committed\s+financing|committed\s+debt\s+financing|equity\s+commitment\s+letters?\s+(?:in\s+full|to\s+fund\s+the\s+full)|cash\s+on\s+hand\s+to\s+fund\s+(?:the\s+)?(?:entire\s+)?(?:purchase|tender)/i.test(text)) {
    const m = text.match(/.{0,60}(?:fully\s+committed\s+financing|cash\s+on\s+hand\s+to\s+fund\s+the\s+entire|committed\s+debt\s+financing).{0,180}/i);
    return { tier: 'FULLY_COMMITTED', quote: m ? m[0].replace(/\s+/g, ' ').trim() : null };
  }
  if (/financing\s+commitments?\s+(?:for\s+a\s+portion|covering\s+part)|partially\s+committed/i.test(text)) {
    return { tier: 'COMMITTED_PARTIAL', quote: null };
  }
  if (/subject\s+to\s+(?:obtaining|receipt\s+of)\s+financing|conditional\s+(?:on|upon)\s+financing|financing\s+contingency/i.test(text)) {
    const m = text.match(/.{0,60}(?:subject\s+to.{0,30}financing|financing\s+contingency).{0,180}/i);
    return { tier: 'CONDITIONAL', quote: m ? m[0].replace(/\s+/g, ' ').trim() : null };
  }
  return { tier: null, quote: null };
}

async function fetchPrimaryDoc(url: string, signal?: AbortSignal): Promise<{ text: string; status: number }> {
  const res = await fetch(url, {
    signal,
    headers: {
      'User-Agent': 'Market Cockpit institutional-research feedback@market-cockpit.app',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  const html = await res.text();
  // Strip HTML tags but keep text content + whitespace
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, status: res.status };
}

export async function GET(req: NextRequest) {
  const cikRaw = req.nextUrl.searchParams.get('cik');
  const accessionRaw = req.nextUrl.searchParams.get('accession');
  const docOverride = req.nextUrl.searchParams.get('doc');
  if (!cikRaw || !accessionRaw) {
    return NextResponse.json({ error: 'cik + accession required' }, { status: 400 });
  }
  const cik = pad10(cikRaw);
  const accession = normalizeAccession(accessionRaw);
  const noDash = accession.replace(/-/g, '');

  // KV cache
  if (isRedisAvailable()) {
    const cached = await kvGet<DealTerms>(KEY(cik, accession));
    if (cached) {
      return NextResponse.json({ ...cached, source: 'KV_CACHED' });
    }
  }

  // Construct primary doc URL. Caller may pass an explicit `doc` (the
  // primaryDocument from the filings list), otherwise we point at the
  // accession index.
  const baseUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${noDash}`;
  const primaryDocUrl = docOverride
    ? `${baseUrl}/${docOverride.replace(/^\/+/, '')}`
    : `${baseUrl}/`;

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  let docText = '';
  let fetchStatus = 0;
  try {
    const { text, status } = await fetchPrimaryDoc(primaryDocUrl, ctl.signal);
    docText = text;
    fetchStatus = status;
  } catch (err: any) {
    clearTimeout(t);
    const payload: DealTerms = {
      cik, accession, primaryDocUrl,
      offerPricePerShare: null, offerPricePerShareCurrency: 'USD', offerPriceQuote: null,
      considerationMix: null, considerationQuote: null,
      tenderCloseDate: null, tenderCloseQuote: null,
      impliedPremiumPct: null, impliedPremiumQuote: null,
      minimumTenderConditionPct: null, minimumConditionQuote: null,
      financingCertainty: null, financingQuote: null,
      charsExtracted: 0,
      source: 'FETCH_ERROR',
      error: err?.name === 'AbortError' ? 'timeout' : (err?.message || 'fetch failed'),
    };
    return NextResponse.json(payload, { status: 200 });
  }
  clearTimeout(t);

  if (fetchStatus === 403 || fetchStatus === 429) {
    return NextResponse.json({
      cik, accession, primaryDocUrl,
      offerPricePerShare: null, offerPricePerShareCurrency: 'USD', offerPriceQuote: null,
      considerationMix: null, considerationQuote: null,
      tenderCloseDate: null, tenderCloseQuote: null,
      impliedPremiumPct: null, impliedPremiumQuote: null,
      minimumTenderConditionPct: null, minimumConditionQuote: null,
      financingCertainty: null, financingQuote: null,
      charsExtracted: 0,
      source: 'EDGAR_BLOCKED',
      error: `HTTP ${fetchStatus}`,
    } satisfies DealTerms, { status: 200 });
  }

  // Cap extraction text — primary docs can be hundreds of KB. First ~250k
  // chars is plenty for the boilerplate offer / consideration section.
  const text = docText.slice(0, 250_000);

  const offer = extractOfferPrice(text);
  const consideration = extractConsiderationMix(text);
  const close = extractTenderCloseDate(text);
  const premium = extractImpliedPremium(text);
  const minCond = extractMinimumCondition(text);
  const financing = extractFinancingCertainty(text);

  const payload: DealTerms = {
    cik, accession, primaryDocUrl,
    offerPricePerShare: offer.price,
    offerPricePerShareCurrency: 'USD',
    offerPriceQuote: offer.quote,
    considerationMix: consideration.mix,
    considerationQuote: consideration.quote,
    tenderCloseDate: close.date,
    tenderCloseQuote: close.quote,
    impliedPremiumPct: premium.pct,
    impliedPremiumQuote: premium.quote,
    minimumTenderConditionPct: minCond.pct,
    minimumConditionQuote: minCond.quote,
    financingCertainty: financing.tier,
    financingQuote: financing.quote,
    charsExtracted: text.length,
    source: 'EDGAR_DIRECT',
    cachedAt: Date.now(),
  };

  if (isRedisAvailable()) {
    kvSet(KEY(cik, accession), payload, TTL_SECONDS).catch(() => {});
  }

  return NextResponse.json(payload);
}
