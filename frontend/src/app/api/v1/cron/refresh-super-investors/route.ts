// ═══════════════════════════════════════════════════════════════════════════
// SUPER INVESTOR HOLDINGS — SCHEDULED REFRESH (PATCH 1068)
//
// Replaces PATCH 1066's static-pump-only implementation with a real
// Trendlyne scraper. Now:
//
//   1. Hit the public Trendlyne listing page
//      (https://trendlyne.com/portfolio/superstar-shareholders/index/) once
//      per cron call. Cache the parsed `name → portfolio-url` map for 24 h.
//   2. For each `SUPER_INVESTORS` entry, look up the investor's portfolio
//      page by name (case-insensitive, alias-aware). If found, GET it and
//      parse the holdings table.
//   3. POST each investor's scraped rows to KV under
//      `superinv:holdings:v1:<id>` with `scrapedAt = now`.
//   4. If an investor isn't on the listing page, can't be scraped, or returns
//      zero holdings, fall back to the curated static list — the chip stays
//      cyan but the data is "static-as-of-quarter-end" instead of "stale".
//
// HTML PARSING — Trendlyne's current portfolio page (2026-06) renders
// holdings as a server-side table with rows like:
//
//   <a class="nolb stockrow" data-stockpk="2105"
//      href="https://trendlyne.com/equity/share-holding/2105/SHAILY/latest/shaily-engineering-plastics-ltd/">
//     Shaily Engineering
//   </a>
//   ...followed by <td>s containing holding-value (Cr), qty held, and
//   per-quarter stake %. We capture the first stake % td after the row
//   (most recent quarter) as `stakePct`.
//
// FAIL-CLOSED auth: same CRON_SECRET as everything else this session.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvSet, kvGet } from '@/lib/kv';
import { SUPER_INVESTORS } from '@/lib/super-investors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;  // scraping ~24 pages × 1.5s each

const TTL_SECONDS = 6 * 60 * 60;
const LISTING_TTL_SECONDS = 24 * 60 * 60;
const LISTING_URL = 'https://trendlyne.com/portfolio/superstar-shareholders/index/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface ScrapedHolding {
  ticker: string;
  company: string;
  stakePct?: number;
  disclosedOn: string;
  tier: 'BSE_1PCT';
  exchange?: 'NSE' | 'BSE';
}

interface CachedPayload {
  scrapedAt: string;
  holdings: ScrapedHolding[];
}

interface RefreshRow {
  id: string;
  source: 'scraped' | 'static' | 'skipped';
  count: number;
  reason?: string;
}

async function check(secret: string | null): Promise<NextResponse | null> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured; endpoint disabled' },
      { status: 503 },
    );
  }
  if (secret !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

// ── Listing page: investor slug → portfolio URL ───────────────────────
//
// Trendlyne's display names diverge from the static roster ('Vijay Kedia' vs
// 'Vijay Kishanlal Kedia', 'Mukul Agrawal' vs 'Mukul Mahavir Agrawal'), so
// matching by normalised full name misses obvious cases. We instead key the
// listing by SLUG and use token-overlap matching at lookup time: an investor
// whose name tokens are all present in some slug wins.
const STOPWORDS = new Set(['and', 'family', 'associates', 'sons', 'huf', 'the']);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && t.length >= 2 && !STOPWORDS.has(t));
}

interface ListingEntry { slug: string; url: string; tokens: string[] }

async function fetchListing(): Promise<ListingEntry[]> {
  const cacheKey = 'superinv:listing:v2';
  try {
    const cached = await kvGet<{ at: string; entries: ListingEntry[] }>(cacheKey);
    if (cached && Array.isArray(cached.entries) && cached.entries.length > 0) {
      const ageMs = Date.now() - new Date(cached.at).getTime();
      if (ageMs < LISTING_TTL_SECONDS * 1000) return cached.entries;
    }
  } catch {}

  const entries: ListingEntry[] = [];
  const seen = new Set<string>();
  try {
    const r = await fetch(LISTING_URL, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' } });
    if (!r.ok) return entries;
    const html = await r.text();
    const re = /href="(\/portfolio\/superstar-shareholders\/\d+\/latest\/([a-z0-9-]+)\/)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const url = m[1];
      const slug = m[2].replace(/-portfolio$/, '');
      if (seen.has(slug)) continue;
      seen.add(slug);
      entries.push({ slug, url, tokens: tokens(slug) });
    }
    try {
      await kvSet(cacheKey, { at: new Date().toISOString(), entries }, LISTING_TTL_SECONDS);
    } catch {}
  } catch {
    // Network blip — return empty so callers fall back to static.
  }
  return entries;
}

function findListingUrl(entries: ListingEntry[], investorName: string): string | null {
  const want = tokens(investorName);
  if (want.length === 0) return null;
  let best: { url: string; score: number } | null = null;
  for (const e of entries) {
    // Every token of the investor's name must appear in the slug to qualify.
    const allPresent = want.every((t) => e.tokens.includes(t));
    if (!allPresent) continue;
    // Score = matching tokens − extra tokens in the slug (prefer tight matches).
    const extra = e.tokens.length - want.length;
    const score = want.length - 0.1 * Math.max(0, extra);
    if (!best || score > best.score) best = { url: e.url, score };
  }
  return best ? best.url : null;
}

// ── Per-investor page: extract holdings table ─────────────────────────
//
// Each row has the shape captured at the top of the file. The first
// `<td ... data-order=N.N>N.N%</td>` after the row open is the most-recent
// stake percentage (Mar 2026 column on the live page today).
function parseHoldingsTable(html: string, asOfIso: string): ScrapedHolding[] {
  const out: ScrapedHolding[] = [];

  // Robust per-row extraction: split on the stockrow anchor.
  const stockRe = /class="nolb stockrow"[^>]+href="https?:\/\/trendlyne\.com\/equity\/share-holding\/\d+\/([A-Z0-9&]+)\/[^"]+"[^>]*>([^<]+)</g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((m = stockRe.exec(html))) {
    const ticker = m[1].trim().toUpperCase();
    const companyRaw = m[2].trim();
    if (!ticker || !companyRaw || seen.has(ticker)) continue;
    seen.add(ticker);

    // Look ahead ~3 KB for the first stake-percentage <td>. The structure on
    // a real row is `<td ... data-order=5.2>5.2%</td>` after Qty Held.
    const slice = html.slice(m.index, m.index + 4000);
    const pctMatch = slice.match(
      /<td[^>]*class="\s*[^"]*bg-superstar-[^"]*"[^>]*data-order=([\d.]+)[^>]*>\s*([\d.]+)%/,
    );
    let stakePct: number | undefined = undefined;
    if (pctMatch) {
      const v = parseFloat(pctMatch[2]);
      if (isFinite(v) && v >= 0 && v <= 100) stakePct = v;
    }

    out.push({
      ticker,
      company: companyRaw.replace(/\s+/g, ' '),
      stakePct,
      disclosedOn: asOfIso.slice(0, 10),
      tier: 'BSE_1PCT',
      exchange: 'NSE',
    });
  }
  return out;
}

async function scrapeInvestor(
  portfolioUrl: string,
  asOfIso: string,
): Promise<ScrapedHolding[]> {
  const fullUrl = portfolioUrl.startsWith('http')
    ? portfolioUrl
    : `https://trendlyne.com${portfolioUrl}`;
  const r = await fetch(fullUrl, {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`trendlyne ${r.status}`);
  const html = await r.text();
  return parseHoldingsTable(html, asOfIso);
}

async function refresh(force: boolean): Promise<{
  fetchedAt: string;
  scraped: number;
  staticFallback: number;
  skipped: number;
  errors: number;
  results: RefreshRow[];
}> {
  const fetchedAt = new Date().toISOString();
  const results: RefreshRow[] = [];

  const listing = await fetchListing();

  for (const inv of SUPER_INVESTORS) {
    // Skip-when-fresh guard — unchanged from PATCH 1066.
    if (!force) {
      try {
        const existing = await kvGet<CachedPayload>(`superinv:holdings:v1:${inv.id}`);
        if (existing && existing.scrapedAt) {
          const ageMs = Date.now() - new Date(existing.scrapedAt).getTime();
          if (ageMs >= 0 && ageMs < 4 * 60 * 60 * 1000) {
            results.push({ id: inv.id, source: 'skipped', count: existing.holdings?.length || 0, reason: 'fresh entry already in KV' });
            continue;
          }
        }
      } catch {}
    }

    // 1) Try Trendlyne scrape.
    const portfolioUrl = findListingUrl(listing, inv.name);
    let scraped: ScrapedHolding[] = [];
    if (portfolioUrl) {
      try {
        scraped = await scrapeInvestor(portfolioUrl, fetchedAt);
      } catch (e: any) {
        results.push({ id: inv.id, source: 'static', count: 0, reason: `scrape failed: ${String(e?.message || e).slice(0, 120)} — falling back to static` });
      }
    }

    let holdings: ScrapedHolding[] = scraped;
    let source: RefreshRow['source'] = 'scraped';

    // 2) Fall back to the static list if scrape returned nothing.
    if (!holdings || holdings.length === 0) {
      const stat = inv.topHoldings || [];
      if (stat.length === 0) {
        results.push({ id: inv.id, source: 'skipped', count: 0, reason: 'no scraped data + no static holdings' });
        continue;
      }
      holdings = stat.map((h) => ({
        ticker: h.ticker,
        company: h.company,
        stakePct: h.stakePct,
        disclosedOn: h.disclosedOn,
        tier: 'BSE_1PCT' as const,
        exchange: h.exchange === 'NSE' || h.exchange === 'BSE' ? h.exchange : undefined,
      }));
      source = 'static';
    }

    try {
      await kvSet(
        `superinv:holdings:v1:${inv.id}`,
        { scrapedAt: fetchedAt, holdings },
        TTL_SECONDS,
      );
      results.push({ id: inv.id, source, count: holdings.length });
    } catch (e: any) {
      results.push({ id: inv.id, source, count: holdings.length, reason: `KV write failed: ${String(e?.message || e).slice(0, 120)}` });
    }
  }

  return {
    fetchedAt,
    scraped: results.filter((r) => r.source === 'scraped').length,
    staticFallback: results.filter((r) => r.source === 'static').length,
    skipped: results.filter((r) => r.source === 'skipped').length,
    errors: results.filter((r) => r.reason && r.source !== 'skipped').length,
    results,
  };
}

export async function GET(req: NextRequest) {
  const denied = await check(req.nextUrl.searchParams.get('secret'));
  if (denied) return denied;
  const force = req.nextUrl.searchParams.get('force') === '1';
  const body = await refresh(force);
  return NextResponse.json({ ok: true, force, ...body });
}

export async function POST(req: NextRequest) {
  const denied = await check(req.nextUrl.searchParams.get('secret'));
  if (denied) return denied;
  const force = req.nextUrl.searchParams.get('force') === '1';
  const body = await refresh(force);
  return NextResponse.json({ ok: true, force, ...body });
}
