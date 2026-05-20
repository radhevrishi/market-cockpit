// PATCH 0363 — Live NSE corporate-announcements scanner for today's
// Financial Results filings.
//
// Purpose: the hub builder (/api/market/earnings) lags actual filing
// time by hours because it relies on slower aggregators. User's
// complaint: "today's companies not showing at all" on filing day.
// This endpoint hits NSE's announcements feed for TODAY (and optionally
// yesterday) and returns every ticker whose subject matches a
// quarterly-results pattern. Cached 3 minutes in KV.
//
// Endpoint: GET /api/v1/earnings/today-live?date=YYYY-MM-DD (optional;
// defaults to today IST).
//
// Returned shape mirrors what the hub uses so the graded route can
// merge results without remapping.

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { fetchBSEAnnouncements } from '@/lib/nse-bse-feed';
import { resolveTicker } from '@/lib/bse-nse-mapping';

export const dynamic = 'force-dynamic';
// PATCH 0500 — bumped 25→40s to accommodate parallel NSE + BSE fetches with
// BSE 3-page pagination. Vercel Pro allows up to 60s on Node runtime.
export const maxDuration = 40;

const KEY = (date: string) => `today-live:v1:${date}`;
const CACHE_TTL_SECONDS = 3 * 60;  // 3 minutes — page auto-polls every 4

// PATCH 0403 — POSITIVE patterns: subjects that genuinely indicate the
// COMPANY HAS ACTUALLY FILED its quarterly/annual financial result on this
// date. "Outcome of Board Meeting" is the canonical NSE/BSE phrase a
// company uses when announcing actual results. The "Financial Results for
// Quarter ended …" and "Audited Financial Results" headers are also direct
// filings. The lone "/financial\s+result/i" pattern WAS BUGGY — it matched
// administrative subjects like "Reply to Clarification- Financial results"
// which are NOT filings, attributing weeks-old data to the wrong date
// (BHAGYANGR/LLOYDSENGG/STLTECH May-14 ghost-filing bug).
const RESULT_PATTERNS = [
  /outcome\s+of\s+board\s+meeting.*(?:financial\s+result|audited)/i,
  /audited\s+(?:standalone\s+|consolidated\s+|standalone\s+(?:and|&)\s+consolidated\s+)?financial\s+result/i,
  /(?:standalone|consolidated)\s+(?:and\s+|&\s+)?(?:audited\s+)?(?:un[- ]?audited\s+)?financial\s+result/i,
  /financial\s+result.*(?:quarter|year)\s+(?:ended|ending)/i,
  /\b(?:quarterly|annual|half[\s-]?yearly)\s+result.*(?:declared|announced)/i,
  /^(?!.*\b(?:reply|notice|intimation|clarification|press\s+release|investor\s+presentation|earnings\s+call|conference|schedule|consider)\b).*(?:quarterly|annual)\s+financial\s+result/i,
];

// PATCH 0403 — NEGATIVE blocklist: subjects that mention "financial result"
// but are NOT the actual filing. If the subject matches any of these, drop
// it even if RESULT_PATTERNS would otherwise accept it.
const SUBJECT_BLOCKLIST = [
  /\breply\b/i,
  /\bclarification\b/i,
  /\bnotice\b/i,
  /\bintimation\b/i,
  /\bconsider(?:ation)?\b.*financial/i,             // "to consider financial results"
  /\bboard\s+meeting\b(?!.*outcome)/i,              // "Board Meeting on …" without "Outcome"
  /\bschedul(?:e|ing)\b/i,
  /\bpress\s+release\b/i,
  /\binvestor\s+presentation\b/i,
  /\binvestor\s+(?:call|conference|meet|meeting)\b/i,
  /\bearnings\s+call\b/i,
  /\banalyst\s+(?:call|meet|meeting)\b/i,
  /\btranscript\b/i,
  /\bdividend\b/i,                                  // dividend-only outcomes
  /\bbuy[\s-]?back\b/i,
  /\bcorrigendum\b/i,
  /\baddendum\b/i,
  /\berratum\b/i,
  /\brevised\b/i,
  /\bcorrection\b/i,
  /\bdelay(?:ed)?\b/i,
];

interface LiveFiling {
  symbol: string;
  company: string;
  subject: string;
  filing_iso: string;
  filing_date: string;
  attachment_url: string | null;
}

interface LiveResponse {
  date: string;
  fetched_at: string;
  source: 'NSE_DIRECT' | 'NSE_BLOCKED' | 'KV_CACHED' | 'BSE_FALLBACK' | 'NSE_BSE_MERGED';
  cache_age_seconds?: number;
  count: number;
  filings: LiveFiling[];
  error?: string;
  // PATCH 0500 — telemetry for the merged-source debugging
  nse_count?: number;
  bse_count?: number;
}

// Convert YYYY-MM-DD → DD-MM-YYYY (NSE format)
function isoToNseDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

// PATCH 0500 — BSE fallback adapter. Indian companies file Sat/Sun during
// earnings season; NSE corp-announcements often returns empty for weekend
// dates either because companies file via BSE first, OR because NSE
// rate-limits anonymous Vercel IPs more aggressively on quiet days. BSE has
// no such rate-limit and its corporate-announcements API works reliably
// from any IP.
async function fetchBseFilings(date: string, signal?: AbortSignal): Promise<LiveFiling[]> {
  try {
    const { filings, source } = await fetchBSEAnnouncements({
      signal,
      fromIso: date,
      toIso: date,
      // PATCH 0501 — bumped 3 → 10 pages. EarningsPulse shows 72 candidates
      // for May 19 alone; BSE returns ~50/page so 3 pages caps at 150 raw
      // announcements and most legitimate Result filings drop past page 3
      // because dividend/buyback/AGM noise comes first. 10 pages = ~500
      // records, comfortable headroom for the busiest days.
      pages: 10,
    });
    if (source !== 'BSE_OK' || filings.length === 0) return [];

    const out: LiveFiling[] = [];
    const seenSymbols = new Set<string>();
    for (const f of filings) {
      if (SUBJECT_BLOCKLIST.some((re) => re.test(f.subject))) continue;

      // PATCH 0501 — Three-tier acceptance:
      //   Tier A — subject matches RESULT_PATTERNS (the strictest, most
      //            reliable signal — "Outcome of Board Meeting...Financial Result")
      //   Tier B — BSE category/subcategory metadata indicates "Result"
      //            (catches companies who put the actual result narrative
      //            in the attachment but keep a generic subject like
      //            "Outcome of Board Meeting Held On..." without "result")
      //   Tier C — bare phrase: subject contains "result" + "quarter" or
      //            "year" (catch-all for variations the regex missed)
      const catText = `${f.category || ''} ${f.subcategory || ''}`.toLowerCase();
      const tierA = RESULT_PATTERNS.some((re) => re.test(f.subject));
      const tierB = /\bresult\b/i.test(catText) && !/dividend|buyback|allotment|rights/i.test(catText);
      const tierC = /\bresult/i.test(f.subject) && /\b(quarter|year|q[1-4]|h1|h2|fy)\b/i.test(f.subject);
      if (!tierA && !tierB && !tierC) continue;

      // BSE returns scrip code as symbol (e.g. '526612'). Resolve to NSE
      // symbol when we have the mapping; otherwise keep the BSE code so
      // downstream still has a stable key.
      const resolved = resolveTicker(f.symbol);
      const sym = (resolved.nseSymbol || resolved.display || f.symbol).toUpperCase();
      if (!sym || seenSymbols.has(sym)) continue;
      seenSymbols.add(sym);

      const attach = f.attachment_urls?.[0] || f.source_url || null;
      out.push({
        symbol: sym,
        company: resolved.shortName || f.company_name || sym,
        subject: f.subject,
        filing_iso: f.filing_datetime,
        filing_date: f.filing_datetime.slice(0, 10),
        attachment_url: attach,
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchNseAnnouncements(date: string, signal?: AbortSignal): Promise<LiveFiling[] | 'BLOCKED'> {
  const nseDate = isoToNseDate(date);
  const url = `https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=${nseDate}&to_date=${nseDate}`;

  try {
    const res = await fetch(url, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-announcements',
      },
    });
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return 'BLOCKED';
    }
    if (!res.ok) return 'BLOCKED';
    const json: any = await res.json();
    const entries: any[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.data) ? json.data
      : Array.isArray(json?.rows) ? json.rows
      : [];

    const out: LiveFiling[] = [];
    const seenSymbols = new Set<string>();

    for (const e of entries) {
      const subject = String(e.subject || e.desc || e.title || '');
      // PATCH 0403 — Hard blocklist first, then positive match.
      // "Reply to Clarification- Financial results" was leaking through
      // before this gate and producing ghost-filings (companies appearing
      // on dates when they actually filed only an admin reply, not Q4).
      if (SUBJECT_BLOCKLIST.some((re) => re.test(subject))) continue;
      if (!RESULT_PATTERNS.some((re) => re.test(subject))) continue;
      const symbol = String(e.symbol || e.scrip || '').trim().toUpperCase();
      if (!symbol) continue;
      // Keep only the most recent filing per symbol on this date
      if (seenSymbols.has(symbol)) continue;

      const ts = e.an_dt || e.sm_dt || e.dt || e.broadcastdt || e.broadcastDate;
      let isoTs: string;
      let isoDate: string;
      if (ts) {
        const d = new Date(ts);
        if (Number.isFinite(d.getTime())) {
          isoTs = d.toISOString();
          isoDate = isoTs.slice(0, 10);
        } else {
          isoTs = new Date().toISOString();
          isoDate = date;
        }
      } else {
        isoTs = new Date().toISOString();
        isoDate = date;
      }

      seenSymbols.add(symbol);
      out.push({
        symbol,
        company: String(e.company_name || e.companyName || e.sm_name || symbol),
        subject,
        filing_iso: isoTs,
        filing_date: isoDate,
        attachment_url: e.attchmntFile || e.attachmentUrl || e.attachment_url || null,
      });
    }
    return out;
  } catch (err) {
    return 'BLOCKED';
  }
}

export async function GET(req: NextRequest) {
  try {
    return await _handleGET(req);
  } catch (err) {
    // PATCH 0419 — never return HTTP 500. Empty payload + error field.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[today-live] uncaught', msg);
    return NextResponse.json({
      date: '', fetched_at: new Date().toISOString(), source: 'NSE_BLOCKED' as const,
      count: 0, filings: [], error: `today-live failed: ${msg.slice(0, 200)}`,
    });
  }
}

async function _handleGET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  let date = searchParams.get('date') || '';
  if (!date) {
    // Default to today in IST
    const now = new Date();
    const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
    const istNow = new Date(istMs);
    date = istNow.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 });
  }
  const force = searchParams.get('force') === '1';

  // Cache layer
  if (!force && isRedisAvailable()) {
    try {
      const cached: any = await kvGet(KEY(date));
      if (cached?.fetched_at) {
        const ageSec = Math.floor((Date.now() - new Date(cached.fetched_at).getTime()) / 1000);
        if (ageSec < CACHE_TTL_SECONDS) {
          return NextResponse.json({
            ...cached,
            source: 'KV_CACHED',
            cache_age_seconds: ageSec,
          });
        }
      }
    } catch {}
  }

  // PATCH 0500 — Fan out NSE + BSE in parallel. Indian companies frequently
  // file via BSE first (especially weekend filings — BSE accepts them while
  // NSE corporate-announcements rate-limits anonymous traffic). Merging both
  // sources gives the same coverage as EarningsPulse.
  const [nseResult, bseResult] = await Promise.all([
    fetchNseAnnouncements(date, AbortSignal.timeout(8000)).catch(() => 'BLOCKED' as const),
    fetchBseFilings(date, AbortSignal.timeout(10000)).catch(() => [] as LiveFiling[]),
  ]);

  const nseFilings: LiveFiling[] = nseResult === 'BLOCKED' ? [] : nseResult;
  const bseFilings = bseResult;

  // Merge — NSE filings keep priority (have proper symbols), BSE fills gaps.
  const merged: LiveFiling[] = [];
  const seen = new Set<string>();
  for (const f of nseFilings) {
    const key = f.symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(f);
  }
  for (const f of bseFilings) {
    const key = f.symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(f);
  }

  let source: LiveResponse['source'];
  if (nseFilings.length > 0 && bseFilings.length > 0) source = 'NSE_BSE_MERGED';
  else if (nseFilings.length > 0) source = 'NSE_DIRECT';
  else if (bseFilings.length > 0) source = 'BSE_FALLBACK';
  else source = nseResult === 'BLOCKED' ? 'NSE_BLOCKED' : 'NSE_DIRECT';

  const payload: LiveResponse = {
    date,
    fetched_at: new Date().toISOString(),
    source,
    count: merged.length,
    filings: merged,
    nse_count: nseFilings.length,
    bse_count: bseFilings.length,
    ...(source === 'NSE_BLOCKED' && merged.length === 0
      ? { error: 'NSE blocked the request (rate-limit or session cookie). BSE fallback also returned no data for this date.' }
      : {}),
  };

  if (isRedisAvailable()) {
    try { await kvSet(KEY(date), payload, CACHE_TTL_SECONDS); } catch {}
  }

  return NextResponse.json(payload);
}
